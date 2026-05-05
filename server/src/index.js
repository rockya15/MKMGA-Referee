const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

process.on('uncaughtException', (err) => {
  console.error('[CRASH] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[CRASH] Unhandled Promise Rejection:', reason);
});

const { GameState, STAGES } = require('./gameState');
const BettingEngine = require('./bettingEngine');
const TimerManager = require('./timerManager');
const stateStore = require('./stateStore');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Global cascade-spin synchronization state (shared across all sockets)
let pendingPositionAssignmentFinalize = false;
let expectedCascadeSpinToken = null;
let cascadeSpinTokenCounter = 0;
let cascadeCompletionTimeout = null;
let expectedCascadeSpinDeadlineAt = 0;
const CASCADE_COMPLETION_TIMEOUT_MS = 14000;
const CASCADE_DNF_COMPLETION_TIMEOUT_MS = 8000;
const POSITION_TIMER_FAILSAFE_DELAY_MS = 8500;
const BOT_POSITION_SPIN_WAIT_MS = 6500;
const BOT_POSITION_SPIN_WAIT_MS_INSTANT = 120;

function randomHexColor() {
  return `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`;
}
const BOT_DEFAULTS = {
  autoPick: true,
  instantWheelSpin: false,
  skipWheelAnimation: false,
  decisionDelayMinMs: 500,
  decisionDelayMaxMs: 1500,
  preBetMode: 'AUTO',
  positionMode: 'AUTO',
  bettingMode: 'AUTO',
  raiseAggression: 'NORMAL',
  cascadeMode: 'AUTO',
  voteMode: 'AUTO',
};
const BOT_POSITION_POST_SPIN_GRACE_MS = 1400;
const BOT_CASCADE_POST_SPIN_GRACE_MS = 700;
const BOT_POSITION_POST_SPIN_GRACE_MS_INSTANT = 80;
const BOT_CASCADE_POST_SPIN_GRACE_MS_INSTANT = 80;
const BOT_AUTOMATION_HEARTBEAT_MS = 250;
const PRE_BET_DEBUG_LOG_PATH = path.join(__dirname, '..', 'data', 'bot-prebet-debug.log');
// Pre-defined debug channels — all start OFF
const KNOWN_DEBUG_CHANNELS = ['cascade', 'bots', 'position', 'timers', 'betting', 'connections', 'leaderboard-scroll'];
const SYSTEM_DEBUG_PRINT_DEFAULT_CONFIG = {
  channels: Object.fromEntries(KNOWN_DEBUG_CHANNELS.map((k) => [k, false])),
};

let botSettings = { ...BOT_DEFAULTS };
let botActionTimeout = null;
let preBetBotDecisionAtById = new Map();
let preBetBotDecisionTimeoutById = new Map();
let botPositionActionsAllowedAt = 0;
let botCascadeActionsAllowedAt = 0;
let positionTimerMissingSince = 0;
let botPositionSpinFallbackTimeout = null;
const SYSTEM_DEBUG_PRINT_LIMIT = 200;
let systemDebugPrints = [];
let systemDebugPrintConfig = { ...SYSTEM_DEBUG_PRINT_DEFAULT_CONFIG };

function sanitizeSystemDebugPrint(raw = {}) {
  const source = String(raw.source || 'unknown');
  const channelRaw = String(raw.channel || source || 'unknown');
  const channel = channelRaw.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-') || 'unknown';
  return {
    at: new Date().toISOString(),
    source,
    channel,
    algoVersion: String(raw.algoVersion || ''),
    stage: String(raw.stage || ''),
    phase: String(raw.phase || ''),
    enabled: Boolean(raw.enabled),
    focusPlayerId: raw.focusPlayerId ? String(raw.focusPlayerId) : null,
    scrollTop: Number.isFinite(Number(raw.scrollTop)) ? Number(raw.scrollTop) : 0,
    maxScroll: Number.isFinite(Number(raw.maxScroll)) ? Number(raw.maxScroll) : 0,
    direction: Number(raw.direction) === -1 ? -1 : 1,
    edgePauseMsRemaining: Number.isFinite(Number(raw.edgePauseMsRemaining)) ? Math.max(0, Math.round(Number(raw.edgePauseMsRemaining))) : 0,
    suspendMsRemaining: Number.isFinite(Number(raw.suspendMsRemaining)) ? Math.max(0, Math.round(Number(raw.suspendMsRemaining))) : 0,
  };
}

function pushSystemDebugPrint(entry) {
  systemDebugPrints.push(entry);
  if (systemDebugPrints.length > SYSTEM_DEBUG_PRINT_LIMIT) {
    systemDebugPrints = systemDebugPrints.slice(-SYSTEM_DEBUG_PRINT_LIMIT);
  }
}

// Route server-side log to terminal always; relay to clients if channel is enabled.
function serverDebug(channel, msg) {
  console.log(msg);
  if (!shouldRelaySystemDebugPrint({ channel })) return;
  const entry = { at: new Date().toISOString(), source: 'server', channel, msg: String(msg) };
  pushSystemDebugPrint(entry);
  // io may not be defined yet at module load time — guard it
  if (typeof io !== 'undefined') {
    io.emit('system-debug-print', entry);
  }
}

function sanitizeSystemDebugPrintConfig(raw = {}) {
  const next = {
    channels: {
      ...(systemDebugPrintConfig?.channels || {}),
    },
  };

  if (raw && typeof raw === 'object' && raw.channels && typeof raw.channels === 'object') {
    for (const [name, enabled] of Object.entries(raw.channels)) {
      const key = String(name || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-');
      if (!key) continue;
      next.channels[key] = Boolean(enabled);
    }
  }

  if (raw && typeof raw === 'object' && raw.setChannel && typeof raw.setChannel === 'object') {
    const key = String(raw.setChannel.name || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-');
    if (key) {
      next.channels[key] = Boolean(raw.setChannel.enabled);
    }
  }

  if (raw && typeof raw === 'object' && raw.removeChannel) {
    const key = String(raw.removeChannel || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-');
    if (key) {
      delete next.channels[key];
    }
  }

  return next;
}

function shouldRelaySystemDebugPrint(entry) {
  const key = String(entry?.channel || entry?.source || 'unknown').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-');
  return Boolean(systemDebugPrintConfig?.channels?.[key]);
}

function logPreBetDebug(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  serverDebug('bots', line);
  try {
    fs.appendFileSync(PRE_BET_DEBUG_LOG_PATH, `${line}\n`);
  } catch (error) {
    console.error('[BOTS][PRE_BET][DBG] Failed to write debug log:', error);
  }
}

function resetPreBetDebugLog() {
  try {
    fs.writeFileSync(PRE_BET_DEBUG_LOG_PATH, '');
  } catch (error) {
    console.error('[BOTS][PRE_BET][DBG] Failed to reset debug log:', error);
  }
}

function clampInt(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function pickMode(value, allowed, fallback) {
  const upper = String(value || '').toUpperCase();
  return allowed.includes(upper) ? upper : fallback;
}

function isBotPlayer(player) {
  if (!player) return false;
  if (Boolean(player.isBot)) return true;
  const id = String(player.id || '');
  const realName = String(player.realName || '');
  return id.startsWith('bot-') || realName.startsWith('bot_');
}

function hasBotPlayers() {
  return gameState.players.some((player) => isBotPlayer(player));
}

function getBotPositionSpinWaitMs() {
  return botSettings.instantWheelSpin ? BOT_POSITION_SPIN_WAIT_MS_INSTANT : BOT_POSITION_SPIN_WAIT_MS;
}

function getBotPositionPostSpinGraceMs() {
  return botSettings.instantWheelSpin ? BOT_POSITION_POST_SPIN_GRACE_MS_INSTANT : BOT_POSITION_POST_SPIN_GRACE_MS;
}

function getBotCascadePostSpinGraceMs() {
  return botSettings.instantWheelSpin ? BOT_CASCADE_POST_SPIN_GRACE_MS_INSTANT : BOT_CASCADE_POST_SPIN_GRACE_MS;
}

function getBotDebugState() {
  return {
    ...botSettings,
    botCount: gameState.players.filter((p) => isBotPlayer(p)).length,
  };
}

function clearBotActionTimeout() {
  if (botActionTimeout) {
    clearTimeout(botActionTimeout);
    botActionTimeout = null;
  }
}

function clearPreBetDecisionSchedule() {
  if (preBetBotDecisionTimeoutById.size > 0 || preBetBotDecisionAtById.size > 0) {
    logPreBetDebug(`[BOTS][PRE_BET][DBG] Clearing schedule: timers=${preBetBotDecisionTimeoutById.size}, pendingDueAt=${preBetBotDecisionAtById.size}`);
  }
  for (const timeoutId of preBetBotDecisionTimeoutById.values()) {
    clearTimeout(timeoutId);
  }
  preBetBotDecisionTimeoutById.clear();
  preBetBotDecisionAtById.clear();
}

function getPendingPreBetBots() {
  return gameState.players.filter(
    (p) => isBotPlayer(p) && p.balance > 0 && !p.paidEntry && !p.skippedRace,
  );
}

function executeScheduledPreBetChoice(botId) {
  if (gameState.currentStage !== STAGES.PRE_BET) {
    logPreBetDebug(`[BOTS][PRE_BET][DBG] Fire ignored for ${botId}: stage=${gameState.currentStage}`);
    preBetBotDecisionAtById.delete(botId);
    return false;
  }

  const bot = gameState.getPlayerById(botId);
  if (!isBotPlayer(bot) || !bot || bot.balance <= 0 || bot.paidEntry || bot.skippedRace) {
    logPreBetDebug(`[BOTS][PRE_BET][DBG] Fire ignored for ${botId}: botMissing=${!bot} paid=${Boolean(bot?.paidEntry)} skipped=${Boolean(bot?.skippedRace)} balance=${Number(bot?.balance ?? 0)}`);
    preBetBotDecisionAtById.delete(botId);
    return false;
  }

  const dueAt = Number(preBetBotDecisionAtById.get(bot.id));
  const now = Date.now();
  const lateMs = Number.isFinite(dueAt) ? now - dueAt : null;
  logPreBetDebug(`[BOTS][PRE_BET][DBG] Fire ${bot.displayName ?? bot.id} id=${bot.id} now=${now} dueAt=${dueAt} lateMs=${lateMs ?? 'n/a'}`);

  const initialChoice = pickBotPreBetChoice(bot);
  let result = gameState.applyPreBetChoice(bot.id, initialChoice);
  if (result?.error && initialChoice === 'SKIP') {
    result = gameState.applyPreBetChoice(bot.id, 'PAY');
  }

  if (result?.error) {
    serverDebug('bots', `[BOTS][PRE_BET] ${bot.id} could not submit pre-bet choice: ${result.error}`);
    return false;
  }

  preBetBotDecisionAtById.delete(bot.id);
  logPreBetDebug(`[BOTS][PRE_BET][DBG] Applied ${bot.displayName ?? bot.id} choice=${initialChoice} remaining=${getPendingPreBetBots().length - 1}`);
  return true;
}

function ensurePreBetDecisionSchedule() {
  if (gameState.currentStage !== STAGES.PRE_BET || !botSettings.autoPick) {
    clearPreBetDecisionSchedule();
    return;
  }

  const pendingBots = getPendingPreBetBots();
  if (pendingBots.length === 0) {
    clearPreBetDecisionSchedule();
    return;
  }

  logPreBetDebug(`[BOTS][PRE_BET][DBG] Ensure schedule: pending=${pendingBots.length} min=${botSettings.decisionDelayMinMs} max=${botSettings.decisionDelayMaxMs}`);

  const pendingIds = new Set(pendingBots.map((p) => p.id));
  for (const [botId, timeoutId] of Array.from(preBetBotDecisionTimeoutById.entries())) {
    if (!pendingIds.has(botId)) {
      logPreBetDebug(`[BOTS][PRE_BET][DBG] Removing stale timer for ${botId}`);
      clearTimeout(timeoutId);
      preBetBotDecisionTimeoutById.delete(botId);
      preBetBotDecisionAtById.delete(botId);
    }
  }

  for (const bot of pendingBots) {
    if (preBetBotDecisionTimeoutById.has(bot.id)) {
      continue;
    }

    const delay = getBotActionDelayMs();
    const scheduledAt = Date.now();
    const dueAt = scheduledAt + delay;
    preBetBotDecisionAtById.set(bot.id, dueAt);
    logPreBetDebug(`[BOTS][PRE_BET][DBG] Schedule ${bot.displayName ?? bot.id} id=${bot.id} delayMs=${delay} scheduledAt=${scheduledAt} dueAt=${dueAt}`);
    const timeoutId = setTimeout(() => {
      preBetBotDecisionTimeoutById.delete(bot.id);
      const acted = executeScheduledPreBetChoice(bot.id);
      if (acted) {
        emitGameState();
      } else {
        ensurePreBetDecisionSchedule();
      }
    }, delay);
    preBetBotDecisionTimeoutById.set(bot.id, timeoutId);
  }
}

function clearBotPositionSpinFallback() {
  if (botPositionSpinFallbackTimeout) {
    clearTimeout(botPositionSpinFallbackTimeout);
    botPositionSpinFallbackTimeout = null;
  }
}

function scheduleBotPositionSpinFallback() {
  clearBotPositionSpinFallback();
  botPositionSpinFallbackTimeout = setTimeout(() => {
    botPositionSpinFallbackTimeout = null;
    if (gameState.currentStage !== STAGES.POSITION_ASSIGNMENT) return;
    if (pendingPositionAssignmentFinalize || expectedCascadeSpinToken) return;
    const draft = gameState.positionDraft;
    if (!draft || draft.cascadeChain) return;
    const pickerId = gameState.wheelOrder?.[draft.currentPlayerIndex];
    const picker = gameState.getPlayerById(pickerId);
    if (!isBotPlayer(picker)) return;
    if (hasActiveTurnTimer(pickerId, 'position')) return;
    serverDebug('position', `[POSITION] Bot spin fallback timer start for picker=${pickerId}.`);
    maybeStartPositionTimer();
  }, getBotPositionSpinWaitMs());
}

function hasActiveTurnTimer(playerId, mode) {
  return Boolean(
    timerManager?.currentTimer &&
    timerManager?.timeoutPlayer === playerId &&
    timerManager?.timerMode === mode
  );
}

function isBotActionWindowOpen(mode) {
  const now = Date.now();
  if (mode === 'position') {
    return now >= botPositionActionsAllowedAt;
  }
  if (mode === 'cascade-response') {
    return now >= botCascadeActionsAllowedAt;
  }
  return true;
}

// Initialize game components
const gameState = new GameState();
const persistedSnapshot = stateStore.loadState();
if (persistedSnapshot) {
  gameState.hydrate(persistedSnapshot);
}
const bettingEngine = new BettingEngine(gameState);
const timerManager = new TimerManager(
  io,
  gameState,
  bettingEngine,
  // onVoteResolved
  () => {
    emitGameState();
    maybeStartNextBettingTimer();
  },
  // onPositionTimeout — receives all positions to assign at once (voted or random)
  (playerId, assignedPositions) => {
    // Auto-resolve any pending cascade chain before processing the timeout
    gameState.clearPendingCascade();

    let phaseComplete = false;
    let phaseResult = null;

    for (const pos of assignedPositions) {
      const result = gameState.assignPositionWithOptions(playerId, pos, { cascade: false });
      if (result.error) break;
      if (result.complete) {
        phaseComplete = true;
        phaseResult = gameState.completePositionAssignment();
        break;
      }
    }

    if (phaseComplete) {
      if (phaseResult && !phaseResult.skippedBetting) {
        bettingEngine.initializeBetting();
      }
      emitGameState();
      maybeStartNextBettingTimer();
    } else {
      // More players still need to pick — wheel will re-spin, spin-complete starts timer
      emitGameState();
    }
  },
  // onCascadeResponseTimeout — timeout or vote resolved; auto-submit response
  (playerId, doCascade) => {
    const result = gameState.respondToDisplacedCascade(playerId, doCascade);
    if (result.error) {
      serverDebug('cascade', `[CASCADE] onCascadeResponseTimeout error: ${result.error}`);
      return;
    }

    if (result.cascaded && result.outcome) {
      const outcome = result.outcome;
      const responder = gameState.getPlayerById(playerId);
      emitCascadeSpin({
        targetPosition: outcome.finalPosition,
        mode: outcome.mode,
        level: outcome.level,
        dnfSlots: outcome.dnfSlots,
        roll: outcome.roll,
        segments: outcome.segments,
        initiatorName: responder?.displayName ?? 'Unknown',
        forcedDnf: false,
      });
    }

    if (result.complete) {
      if (result.cascaded) {
        pendingPositionAssignmentFinalize = true;
        emitGameState();
      } else {
        finalizePositionAssignmentPhase();
      }
    } else {
      emitGameState();
      if (!result.cascaded) {
        maybeStartPositionTimer();
      }
    }
  },
  // logger — routes timerManager debug messages through the server debug channel system
  (channel, msg) => serverDebug(channel, msg)
);

function sanitizePlayerForClient(player) {
  const { passwordHash, salt, ...rest } = player;
  return {
    ...rest,
    hasPassword: Boolean(passwordHash && salt),
  };
}

function getClientGameState() {
  const snapshot = gameState.toSnapshot();
  return {
    ...snapshot,
    debugTools: getBotDebugState(),
    systemDebugPrintConfig: { ...systemDebugPrintConfig },
    players: snapshot.players.map(sanitizePlayerForClient)
  };
}

function emitGameState() {
  stateStore.saveState(gameState.toSnapshot());
  io.emit('game-state', getClientGameState());
  queueBotAutoAction();
}

function roundToQuarter(value) {
  return Math.round(Number(value || 0) * 4) / 4;
}

function isForcedCallOnly(playerId) {
  const state = gameState.bettingState;
  const player = gameState.getPlayerById(playerId);
  if (!state || !player) return false;

  const currentBet = Number(state.currentBet || 0);
  const roundBet = Number(player.roundBet || 0);
  const toCall = roundToQuarter(Math.max(0, currentBet - roundBet));
  if (toCall <= 0) return false;
  if (player.skipFoldTokenAvailable) return false;

  const minRaiseTo = roundToQuarter(currentBet + 0.25);
  const maxRaiseTo = roundToQuarter(Math.min(
    Number(state.betCap || 0),
    Number(player.balance || 0) + roundBet
  ));
  const canRaise = !state.raiseLockedPlayers?.[playerId] && maxRaiseTo >= minRaiseTo;

  return !canRaise;
}

function resolveForcedCallIfNeeded() {
  if (gameState.currentStage !== STAGES.BETTING) return false;
  const actorId = bettingEngine.getCurrentActor();
  if (!actorId || !isForcedCallOnly(actorId)) return false;

  const actor = gameState.getPlayerById(actorId);
  const currentBet = Number(gameState.bettingState.currentBet || 0);
  const roundBet = Number(actor?.roundBet || 0);
  const toCall = roundToQuarter(Math.max(0, currentBet - roundBet));

  const result = bettingEngine.processAction(actorId, 'call');
  if (result?.error) {
    serverDebug('betting', `[BETTING] Forced-call failed for ${actorId}: ${result.error}`);
    return false;
  }

  io.to(actorId).emit('forced-call-info', {
    message: `Auto-called $${toCall.toFixed(2)} because your Skip/Fold token is spent and raising is unavailable.`,
    durationMs: 5000,
  });
  return true;
}

function maybeStartNextBettingTimer() {
  if (gameState.currentStage !== STAGES.BETTING) {
    timerManager.clearTimer();
    return;
  }

  // Fast-forward any actor that only has CALL available.
  let guard = 0;
  while (gameState.currentStage === STAGES.BETTING && guard < 64) {
    const changed = resolveForcedCallIfNeeded();
    if (!changed) break;
    emitGameState();
    guard += 1;
  }

  const nextPlayerId = bettingEngine.getCurrentActor();
  if (nextPlayerId) {
    timerManager.startTimer(nextPlayerId, 60, 'betting');
    queueBotAutoAction();
  } else {
    timerManager.clearTimer();
  }
}

function autoAssignAllRemainingPositions() {
  if (gameState.currentStage !== STAGES.POSITION_ASSIGNMENT) return;
  timerManager.clearTimer();
  clearBotActionTimeout();

  let guard = 0;
  while (guard++ < 50) {
    const draft = gameState.positionDraft;
    if (!draft) break;
    const pickerId = gameState.wheelOrder?.[draft.currentPlayerIndex];
    if (!pickerId) break;

    const position = pickBotPosition(draft);
    if (!position) break;

    const result = gameState.assignPositionWithOptions(pickerId, position, { cascade: false });
    if (result.error) break;

    if (result.complete) {
      finalizePositionAssignmentPhase();
      emitGameState();
      return;
    }
  }

  // Should not reach here normally, but emit state to reflect partial progress
  emitGameState();
}

function maybeStartPositionTimer() {
  if (gameState.currentStage !== STAGES.POSITION_ASSIGNMENT) return;
  const draft = gameState.positionDraft;
  if (!draft) return;
  if (draft.cascadeChain) {
    timerManager.clearTimer();
    return;
  }
  const currentPickerId = gameState.wheelOrder?.[draft.currentPlayerIndex];
  if (currentPickerId) {
    timerManager.startTimer(currentPickerId, 30, 'position');
    botPositionActionsAllowedAt = Date.now() + getBotPositionPostSpinGraceMs();
    positionTimerMissingSince = 0;
    clearBotPositionSpinFallback();
    queueBotAutoAction();
  }
}

function queueBotAutoAction() {
  if (!botSettings.autoPick || !hasBotPlayers()) return;
  if (botActionTimeout) return;

  if (gameState.currentStage !== STAGES.PRE_BET && preBetBotDecisionAtById.size > 0) {
    clearPreBetDecisionSchedule();
  }

  if (gameState.currentStage === STAGES.PRE_BET) {
    ensurePreBetDecisionSchedule();
    return;
  }

  const delay = getBotActionDelayMs();
  botActionTimeout = setTimeout(() => {
    botActionTimeout = null;
    let acted = runOneBotAction();
    if (acted && isBurstBotPhaseActive()) {
      // Pre-bet and vote sessions should share one delay and resolve in one burst.
      let burstGuard = 0;
      while (burstGuard < 128) {
        const progressed = runOneBotAction();
        if (!progressed) break;
        acted = true;
        burstGuard += 1;
      }
    }
    if (acted) {
      emitGameState();
      if (gameState.currentStage === STAGES.BETTING) {
        maybeStartNextBettingTimer();
      } else if (shouldRetryBotAutoAction()) {
        // Keep draining pending work immediately without waiting for heartbeat.
        queueBotAutoAction();
      }
      return;
    }

    // If we woke up before the action window opens (e.g., wheel just ended),
    // keep polling briefly so bots still act once legal.
    if (shouldRetryBotAutoAction()) {
      const retryDelay = Math.min(300, Math.max(80, Math.floor(delay / 3)));
      botActionTimeout = setTimeout(() => {
        botActionTimeout = null;
        queueBotAutoAction();
      }, retryDelay);
    }
  }, delay);
}

function hasPendingBotVoteAction() {
  if (timerManager.voteSession) {
    return timerManager.voteSession.voterIds.some((id) => isBotPlayer(gameState.getPlayerById(id)) && !timerManager.voteSession.votes[id]);
  }
  if (timerManager.positionVoteSession) {
    return timerManager.positionVoteSession.voterIds.some((id) => isBotPlayer(gameState.getPlayerById(id)) && !timerManager.positionVoteSession.votes[id]);
  }
  if (timerManager.cascadeResponseVoteSession) {
    return timerManager.cascadeResponseVoteSession.voterIds.some((id) => isBotPlayer(gameState.getPlayerById(id)) && !timerManager.cascadeResponseVoteSession.votes[id]);
  }
  return false;
}

function hasPendingBotTurnAction() {
  if (gameState.currentStage === STAGES.PRE_BET) {
    return gameState.players.some((p) => isBotPlayer(p) && p.balance > 0 && !p.paidEntry && !p.skippedRace);
  }

  if (gameState.currentStage === STAGES.POSITION_ASSIGNMENT) {
    const chain = gameState.positionDraft?.cascadeChain;
    if (chain?.promptReady) {
      const displaced = gameState.getPlayerById(chain.pendingDisplacedId);
      return isBotPlayer(displaced);
    }
    if (!chain) {
      const draft = gameState.positionDraft;
      const pickerId = gameState.wheelOrder?.[draft?.currentPlayerIndex];
      const picker = gameState.getPlayerById(pickerId);
      return isBotPlayer(picker);
    }
  }

  if (gameState.currentStage === STAGES.BETTING) {
    const actor = gameState.getPlayerById(bettingEngine.getCurrentActor());
    return isBotPlayer(actor);
  }

  return false;
}

function shouldRetryBotAutoAction() {
  if (!botSettings.autoPick || !hasBotPlayers()) return false;
  return hasPendingBotVoteAction() || hasPendingBotTurnAction();
}

function isBurstBotPhaseActive() {
  if (hasPendingBotVoteAction()) return true;
  return gameState.currentStage === STAGES.PRE_BET;
}

function getBotActionDelayMs() {
  const minDelay = clampInt(botSettings.decisionDelayMinMs, 0, 15000);
  const maxDelay = clampInt(botSettings.decisionDelayMaxMs, 0, 15000);
  const low = Math.min(minDelay, maxDelay);
  const high = Math.max(minDelay, maxDelay);
  if (low === high) return low;
  return low + Math.floor(Math.random() * (high - low + 1));
}

function chooseFrom(array) {
  if (!Array.isArray(array) || array.length === 0) return null;
  return array[Math.floor(Math.random() * array.length)];
}

function getBotRandomRaiseTo(minRaiseTo, maxRaiseTo) {
  const min = roundToQuarter(minRaiseTo);
  const max = roundToQuarter(maxRaiseTo);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
    return min;
  }

  const aggression = botSettings.raiseAggression ?? 'NORMAL';
  // Jam probability by aggression level
  const jamChance = aggression === 'PASSIVE' ? 0.04
    : aggression === 'AGGRESSIVE' ? 0.30
    : aggression === 'MANIAC' ? 0.55
    : 0.12; // NORMAL
  if (Math.random() < jamChance) return max;

  // Early-stop probability (higher = smaller raises on average)
  const earlyStopChance = aggression === 'PASSIVE' ? 0.65
    : aggression === 'AGGRESSIVE' ? 0.18
    : aggression === 'MANIAC' ? 0.05
    : 0.35; // NORMAL

  const chips = [0.25, 0.5, 1, 2, 5];
  let total = min;
  const maxAdds = 1 + Math.floor(Math.random() * 14);
  for (let i = 0; i < maxAdds; i += 1) {
    if (total >= max) break;
    const chip = chooseFrom(chips) ?? 0.25;
    total = roundToQuarter(Math.min(max, total + chip));
    if (Math.random() < earlyStopChance) break;
  }

  return total;
}

function pickBotPreBetChoice(player) {
  const mode = botSettings.preBetMode;
  if (mode === 'PAY') return 'PAY';
  if (mode === 'SKIP') return player.skipFoldTokenAvailable ? 'SKIP' : 'PAY';
  if (mode === 'RANDOM') {
    if (!player.skipFoldTokenAvailable) return 'PAY';
    return Math.random() < 0.5 ? 'PAY' : 'SKIP';
  }
  // AUTO
  if (!player.skipFoldTokenAvailable) return 'PAY';
  return player.balance <= Number(gameState.entryFee || 0) ? 'PAY' : (Math.random() < 0.2 ? 'SKIP' : 'PAY');
}

function getAvailablePositionsForDraft(draft) {
  if (!draft) return [];
  if (draft.mode === 'NON_EXCLUSIVE') return ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'DNF'];
  return ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'DNF'].filter((p) => !draft.occupiedPositions?.[p]);
}

function pickBotPosition(draft) {
  const options = getAvailablePositionsForDraft(draft);
  if (options.length === 0) return null;
  const mode = botSettings.positionMode;

  if (mode === 'SAFE_FIRST') {
    const nonDnf = options.filter((p) => p !== 'DNF');
    return nonDnf.sort((a, b) => Number(a) - Number(b))[0] || options[0];
  }
  if (mode === 'PREFER_DNF') {
    return options.includes('DNF') ? 'DNF' : options[options.length - 1];
  }
  if (mode === 'RANDOM') {
    return chooseFrom(options);
  }

  // AUTO: prefer non-DNF unless it is forced.
  const nonDnf = options.filter((p) => p !== 'DNF');
  if (nonDnf.length === 0) return 'DNF';
  if (options.length > 1 && options.includes('DNF') && Math.random() < 0.15) {
    return 'DNF';
  }
  return chooseFrom(nonDnf);
}

function shouldBotCascade() {
  const mode = botSettings.cascadeMode;
  if (mode === 'CASCADE') return true;
  if (mode === 'ACCEPT_DNF') return false;
  if (mode === 'RANDOM') return Math.random() < 0.5;
  // AUTO
  return Math.random() < 0.65;
}

function pickBotVote(options) {
  const clean = Array.isArray(options) ? options.filter(Boolean) : [];
  if (clean.length === 0) return null;
  const mode = botSettings.voteMode;
  if (mode === 'FIRST') return clean[0];
  return chooseFrom(clean);
}

function pickBotBetAction(player) {
  const state = gameState.bettingState;
  const currentBet = roundToQuarter(Number(state.currentBet || 0));
  const roundBet = roundToQuarter(Number(player.roundBet || 0));
  const toCall = roundToQuarter(Math.max(0, currentBet - roundBet));
  const canFold = Boolean(player.skipFoldTokenAvailable);
  const canRaise = !state.raiseLockedPlayers?.[player.id] &&
    Number(state.betCap || 0) > currentBet &&
    roundToQuarter(Number(player.balance || 0) + roundBet) > currentBet;

  const minRaiseTo = roundToQuarter(currentBet + 0.25);
  const maxRaiseTo = roundToQuarter(Math.min(Number(state.betCap || 0), Number(player.balance || 0) + roundBet));

  const mode = botSettings.bettingMode;
  if (mode === 'CHECK_CALL') {
    return { action: toCall > 0 ? 'call' : 'check' };
  }
  if (mode === 'FOLD_IF_POSSIBLE') {
    if (canFold) return { action: 'fold' };
    return { action: toCall > 0 ? 'call' : 'check' };
  }
  if (mode === 'RANDOM') {
    const choices = [toCall > 0 ? 'call' : 'check'];
    if (canFold) choices.push('fold');
    if (canRaise && maxRaiseTo >= minRaiseTo) choices.push('raise');
    const action = chooseFrom(choices);
    if (action === 'raise') {
      return { action, amount: getBotRandomRaiseTo(minRaiseTo, maxRaiseTo) };
    }
    return { action };
  }

  // AUTO: raise probability scales with raiseAggression.
  const aggression = botSettings.raiseAggression ?? 'NORMAL';
  const raiseChance = aggression === 'PASSIVE' ? 0.04
    : aggression === 'AGGRESSIVE' ? 0.35
    : aggression === 'MANIAC' ? 0.65
    : 0.15; // NORMAL
  if (canRaise && maxRaiseTo >= minRaiseTo && Math.random() < raiseChance) {
    return { action: 'raise', amount: getBotRandomRaiseTo(minRaiseTo, maxRaiseTo) };
  }
  // Fold probability inversely scales (aggressive bots rarely fold).
  const foldChance = aggression === 'PASSIVE' ? 0.22
    : aggression === 'AGGRESSIVE' ? 0.06
    : aggression === 'MANIAC' ? 0.02
    : 0.12; // NORMAL
  if (toCall > 0 && canFold && Math.random() < foldChance) {
    return { action: 'fold' };
  }
  return { action: toCall > 0 ? 'call' : 'check' };
}

function runPreBetBotBurst() {
  const pendingBots = gameState.players.filter(
    (p) => isBotPlayer(p) && p.balance > 0 && !p.paidEntry && !p.skippedRace,
  );

  let preBetActed = false;
  for (const target of pendingBots) {
    const initialChoice = pickBotPreBetChoice(target);
    let result = gameState.applyPreBetChoice(target.id, initialChoice);

    // If a skip choice is rejected (e.g., token consumed), force PAY and continue.
    if (result?.error && initialChoice === 'SKIP') {
      result = gameState.applyPreBetChoice(target.id, 'PAY');
    }

    if (result?.error) {
      serverDebug('bots', `[BOTS][PRE_BET] ${target.id} could not submit pre-bet choice: ${result.error}`);
      continue;
    }

    preBetActed = true;
  }

  return preBetActed;
}

function runOneBotAction() {
  let acted = false;

  // 1) Active vote sessions: cast one pending bot vote
  if (timerManager.voteSession) {
    // Burst all pending bot votes in this session so they share one delay window.
    while (timerManager.voteSession) {
      const pending = timerManager.voteSession.voterIds.filter((id) => isBotPlayer(gameState.getPlayerById(id)) && !timerManager.voteSession.votes[id]);
      if (pending.length === 0) break;
      const voterId = pending[0];
      const choice = pickBotVote(timerManager.voteSession.options);
      if (choice) {
        timerManager.submitVote(voterId, choice);
        acted = true;
      } else {
        break;
      }
    }
  }

  if (timerManager.positionVoteSession) {
    while (timerManager.positionVoteSession) {
      const pending = timerManager.positionVoteSession.voterIds.filter((id) => isBotPlayer(gameState.getPlayerById(id)) && !timerManager.positionVoteSession.votes[id]);
      if (pending.length === 0) break;
      const voterId = pending[0];
      const choice = pickBotVote(timerManager.positionVoteSession.availablePositions);
      if (choice) {
        timerManager.submitPositionVote(voterId, choice);
        acted = true;
      } else {
        break;
      }
    }
  }

  if (timerManager.cascadeResponseVoteSession) {
    while (timerManager.cascadeResponseVoteSession) {
      const pending = timerManager.cascadeResponseVoteSession.voterIds.filter((id) => isBotPlayer(gameState.getPlayerById(id)) && !timerManager.cascadeResponseVoteSession.votes[id]);
      if (pending.length === 0) break;
      const voterId = pending[0];
      const choice = pickBotVote(['cascade', 'accept']);
      if (choice) {
        timerManager.submitCascadeResponseVote(voterId, choice);
        acted = true;
      } else {
        break;
      }
    }
  }

  if (acted) {
    return true;
  }

  // 2) Stage-driven bot actions
  if (gameState.currentStage === STAGES.PRE_BET) {
    return runPreBetBotBurst();
  }

  if (gameState.currentStage === STAGES.POSITION_ASSIGNMENT) {
    const chain = gameState.positionDraft?.cascadeChain;

    if (chain?.promptReady) {
      const displaced = gameState.getPlayerById(chain.pendingDisplacedId);
      if (isBotPlayer(displaced)) {
        // Wait until the host has finished cascade spin animation and the displaced
        // player's response timer is actually running.
        if (!hasActiveTurnTimer(displaced.id, 'cascade-response')) {
          return false;
        }
        if (!isBotActionWindowOpen('cascade-response')) {
          return false;
        }
        const doCascade = shouldBotCascade();
        timerManager.clearTimer();
        const result = gameState.respondToDisplacedCascade(displaced.id, doCascade);
        if (result.error) return false;

        if (result.cascaded && result.outcome) {
          emitCascadeSpin({
            targetPosition: result.outcome.finalPosition,
            mode: result.outcome.mode,
            level: result.outcome.level,
            dnfSlots: result.outcome.dnfSlots,
            roll: result.outcome.roll,
            segments: result.outcome.segments,
            initiatorName: displaced.displayName ?? 'Bot',
            forcedDnf: false,
          });
        }

        if (result.complete) {
          if (result.cascaded) {
            pendingPositionAssignmentFinalize = true;
            timerManager.clearTimer();
          } else {
            finalizePositionAssignmentPhase();
          }
        } else if (!result.cascaded) {
          maybeStartPositionTimer();
        }

        return true;
      }
    }

    if (!chain) {
      const draft = gameState.positionDraft;
      const pickerId = gameState.wheelOrder?.[draft?.currentPlayerIndex];
      const picker = gameState.getPlayerById(pickerId);
      if (!isBotPlayer(picker)) return false;

      // Wait until the host has finished the wheel animation and the picker timer
      // has started before allowing a bot to choose a position.
      if (!hasActiveTurnTimer(picker.id, 'position')) {
        return false;
      }
      if (!isBotActionWindowOpen('position')) {
        return false;
      }

      const position = pickBotPosition(draft);
      if (!position) return false;
      const doCascade = position === 'DNF' && shouldBotCascade();
      const result = gameState.assignPositionWithOptions(picker.id, position, { cascade: doCascade });
      if (result.error) return false;

      if (result.cascade) {
        emitCascadeSpin({
          targetPosition: result.cascade.finalPosition,
          mode: result.cascade.mode,
          level: result.cascade.level,
          dnfSlots: result.cascade.dnfSlots,
          roll: result.cascade.roll,
          segments: result.cascade.segments,
          initiatorName: picker.displayName ?? 'Bot',
          forcedDnf: result.cascade.forcedDnf ?? false,
        });
      }

      if (result.complete) {
        if (result.cascade) {
          pendingPositionAssignmentFinalize = true;
          timerManager.clearTimer();
          clearBotPositionSpinFallback();
        } else {
          finalizePositionAssignmentPhase();
        }
      } else {
        const currentPickerId = gameState.wheelOrder?.[gameState.positionDraft?.currentPlayerIndex];
        if (currentPickerId === picker.id) {
          timerManager.addTime(10);
          clearBotPositionSpinFallback();
        } else {
          timerManager.clearTimer();
          const nextPicker = gameState.getPlayerById(currentPickerId);
          if (isBotPlayer(nextPicker)) {
            scheduleBotPositionSpinFallback();
          } else {
            clearBotPositionSpinFallback();
          }
        }
      }

      return true;
    }
  }

  if (gameState.currentStage === STAGES.BETTING) {
    const actorId = bettingEngine.getCurrentActor();
    const actor = gameState.getPlayerById(actorId);
    if (!isBotPlayer(actor)) return false;
    const decision = pickBotBetAction(actor);
    const result = bettingEngine.processAction(actor.id, decision.action, decision.amount);
    if (!result?.error && result?.complete) {
      // If the bot was the final actor, betting just advanced to RACE_PENDING_RESULT.
      // Ensure the old betting timer cannot time out and open a stale vote session.
      timerManager.clearTimer();
    }
    return !result.error;
  }

  return false;
}

function settleRaceAndPersistSummary(placement) {
  const result = gameState.settleRace(String(placement));
  if (result.error) {
    return result;
  }

  const winnerNames = gameState.players
    .filter((player) => result.winners?.includes(player.id))
    .map((player) => player.displayName ?? player.realName ?? player.id);

  stateStore.saveRaceSummary(gameState.toSnapshot(), { winners: winnerNames });
  return result;
}

function getCurrentWinnerNames(snapshot) {
  const result = String(snapshot?.raceResult || '').trim();
  if (!result) return [];

  return (snapshot?.players || [])
    .filter((player) => player?.paidEntry && !player?.folded && Array.isArray(player?.positions) && player.positions.includes(result))
    .map((player) => player.displayName ?? player.realName ?? player.id);
}

const BOT_COMMON_NAMES = [
  'Jerry', 'Timmy', 'Karen', 'Dave', 'Steve', 'Linda', 'Mike', 'Susan',
  'Gary', 'Brenda', 'Todd', 'Cindy', 'Frank', 'Diane', 'Larry', 'Pam',
  'Carl', 'Donna', 'Barry', 'Cheryl', 'Dennis', 'Janet', 'Roger', 'Patty',
  'Randy', 'Vicky', 'Phil', 'Carol', 'Glen', 'Debbie', 'Chad', 'Becky',
  'Earl', 'Tammy', 'Hank', 'Nancy', 'Dale', 'Peggy', 'Bobby', 'Luanne',
];
const BOT_RARE_NAMES = [
  'Bogard', 'Don Kreig', 'Buttercup', 'Chud', 'Discord Mod', 'Nathantiel',
  'berezaa', 'I love Cock', 'Cock Chaser', 'Cock Cat', 'Hermann Ziggy',
  'Viscous', 'Squeaker',
];
// ~10% chance of drawing a rare name
function pickBotName(usedNames) {
  const pool = Math.random() < 0.10 ? BOT_RARE_NAMES : BOT_COMMON_NAMES;
  const available = pool.filter((n) => !usedNames.has(n));
  if (available.length === 0) {
    // fall back to opposite pool, then numbered fallback
    const fallback = (pool === BOT_RARE_NAMES ? BOT_COMMON_NAMES : BOT_RARE_NAMES).filter((n) => !usedNames.has(n));
    if (fallback.length > 0) return fallback[Math.floor(Math.random() * fallback.length)];
    return `Bot ${usedNames.size + 1}`;
  }
  return available[Math.floor(Math.random() * available.length)];
}

function addDebugBots(count, startingCash) {
  if (gameState.currentStage !== STAGES.LOBBY || !gameState.hostSettings.lobbyOpen) {
    return { error: 'Bots can only be added while the lobby is open.' };
  }

  const wanted = clampInt(count, 1, 24);
  const baseCash = Number(startingCash);
  const maxCap = Number(gameState.hostSettings.maxCashCap || 0);
  const safeCash = maxCap > 0
    ? maxCap
    : (Number.isFinite(baseCash) && baseCash > 0 ? baseCash : 15);

  const usedBotNames = new Set(
    gameState.players
      .filter((p) => isBotPlayer(p))
      .map((p) => {
        const dn = p.displayName;
        if (dn.endsWith(' (BOT)')) return dn.slice(0, -6);
        if (dn.startsWith('BOT ')) return dn.slice(4);
        return dn;
      })
  );

  let added = 0;
  for (let i = 0; i < wanted; i += 1) {
    const n = gameState.players.filter((p) => isBotPlayer(p)).length + 1;
    const name = pickBotName(usedBotNames);
    usedBotNames.add(name);
    const displayName = name;
    const realName = `bot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const color = randomHexColor();
    const fakeSocketId = `bot-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const result = gameState.addOrRejoinPlayer(fakeSocketId, {
      displayName,
      realName,
      cashAmount: safeCash,
      funStatement: 'Debug bot',
      password: '',
      isBot: true,
      favoriteColor: color,
    });

    if (result.error) {
      if (added === 0) return result;
      break;
    }
    added += 1;
  }

  return { success: true, added };
}

function clearDebugBots() {
  const botIds = gameState.players.filter((p) => isBotPlayer(p)).map((p) => p.id);
  if (botIds.length === 0) return { success: true, removed: 0 };

  timerManager.clearTimer();
  for (const botId of botIds) {
    gameState.adminKickPlayer(botId);
  }
  pendingPositionAssignmentFinalize = false;
  expectedCascadeSpinToken = null;
  clearCascadeCompletionTimeout();
  clearBotActionTimeout();
  clearPreBetDecisionSchedule();
  clearBotPositionSpinFallback();

  return { success: true, removed: botIds.length };
}

function updateBotSettings(payload = {}) {
  const nextMin = clampInt(
    payload.decisionDelayMinMs ?? payload.timeoutDelayMinMs ?? botSettings.decisionDelayMinMs,
    0,
    15000
  );
  const nextMax = clampInt(
    payload.decisionDelayMaxMs ?? payload.timeoutDelayMaxMs ?? botSettings.decisionDelayMaxMs,
    0,
    15000
  );

  botSettings = {
    autoPick: typeof payload.autoPick === 'boolean' ? payload.autoPick : botSettings.autoPick,
    instantWheelSpin: typeof payload.instantWheelSpin === 'boolean' ? payload.instantWheelSpin : botSettings.instantWheelSpin,
    skipWheelAnimation: typeof payload.skipWheelAnimation === 'boolean' ? payload.skipWheelAnimation : botSettings.skipWheelAnimation,
    decisionDelayMinMs: nextMin,
    decisionDelayMaxMs: nextMax,
    preBetMode: pickMode(payload.preBetMode, ['AUTO', 'PAY', 'SKIP', 'RANDOM'], botSettings.preBetMode),
    positionMode: pickMode(payload.positionMode, ['AUTO', 'RANDOM', 'SAFE_FIRST', 'PREFER_DNF'], botSettings.positionMode),
    bettingMode: pickMode(payload.bettingMode, ['AUTO', 'CHECK_CALL', 'FOLD_IF_POSSIBLE', 'RANDOM'], botSettings.bettingMode),
    raiseAggression: pickMode(payload.raiseAggression, ['PASSIVE', 'NORMAL', 'AGGRESSIVE', 'MANIAC'], botSettings.raiseAggression),
    cascadeMode: pickMode(payload.cascadeMode, ['AUTO', 'CASCADE', 'ACCEPT_DNF', 'RANDOM'], botSettings.cascadeMode),
    voteMode: pickMode(payload.voteMode, ['AUTO', 'RANDOM', 'FIRST'], botSettings.voteMode),
  };

  if (!botSettings.autoPick) {
    clearBotActionTimeout();
    clearPreBetDecisionSchedule();
  } else if (gameState.currentStage === STAGES.PRE_BET) {
    logPreBetDebug(`[BOTS][PRE_BET][DBG] Re-rolling pending timers after settings update: min=${botSettings.decisionDelayMinMs} max=${botSettings.decisionDelayMaxMs}`);
    clearPreBetDecisionSchedule();
    queueBotAutoAction();
  }

  return { success: true, settings: botSettings };
}

function clearCascadeCompletionTimeout() {
  if (cascadeCompletionTimeout) {
    clearTimeout(cascadeCompletionTimeout);
    cascadeCompletionTimeout = null;
  }
  expectedCascadeSpinDeadlineAt = 0;
}

function handleCascadeSpinConcluded(reason) {
  if (gameState.currentStage !== STAGES.POSITION_ASSIGNMENT) {
    pendingPositionAssignmentFinalize = false;
    expectedCascadeSpinToken = null;
    clearCascadeCompletionTimeout();
    return;
  }

  expectedCascadeSpinToken = null;
  clearCascadeCompletionTimeout();

  if (pendingPositionAssignmentFinalize) {
    finalizePositionAssignmentPhase();
    return;
  }

  if (gameState.markCascadePromptReady()) {
    serverDebug('cascade', `[CASCADE] Spin conclusion applied via ${reason}; prompt is now ready.`);
    // Start 30s timer for the displaced player
    const displacedId = gameState.positionDraft?.cascadeChain?.pendingDisplacedId;
    if (displacedId) {
      timerManager.startTimer(displacedId, 30, 'cascade-response');
      botCascadeActionsAllowedAt = Date.now() + getBotCascadePostSpinGraceMs();
      queueBotAutoAction();
    }
    emitGameState();
  }
}

function scheduleCascadeCompletionFallback(token, timeoutMs) {
  clearCascadeCompletionTimeout();
  const delayMs = Number.isFinite(timeoutMs) ? timeoutMs : CASCADE_COMPLETION_TIMEOUT_MS;
  expectedCascadeSpinDeadlineAt = Date.now() + delayMs;
  cascadeCompletionTimeout = setTimeout(() => {
    if (expectedCascadeSpinToken !== token) {
      return;
    }
    serverDebug('cascade', `[CASCADE] Fallback completion fired for token=${token}.`);
    handleCascadeSpinConcluded('fallback-timeout');
  }, delayMs);
}

function emitCascadeSpin(payload) {
  gameState.cascadeSpinsThisRound = (gameState.cascadeSpinsThisRound || 0) + 1;
  const token = `${Date.now()}-${++cascadeSpinTokenCounter}-${Math.random().toString(36).slice(2, 8)}`;
  expectedCascadeSpinToken = token;
  const fallbackMs = payload?.targetPosition === 'DNF'
    ? CASCADE_DNF_COMPLETION_TIMEOUT_MS
    : CASCADE_COMPLETION_TIMEOUT_MS;
  scheduleCascadeCompletionFallback(token, fallbackMs);
  io.emit('cascade-spin', { ...payload, token });
  return token;
}

function finalizePositionAssignmentPhase() {
  pendingPositionAssignmentFinalize = false;
  expectedCascadeSpinToken = null;
  clearCascadeCompletionTimeout();
  clearBotPositionSpinFallback();
  timerManager.clearTimer();
  const phaseResult = gameState.completePositionAssignment();
  if (!phaseResult.skippedBetting) {
    bettingEngine.initializeBetting();
    emitGameState();
    maybeStartNextBettingTimer();
  } else {
    emitGameState();
  }
}

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads/player-images');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Ensure player drawings directory exists
const drawingsDir = path.join(__dirname, '../uploads/player-drawings');
if (!fs.existsSync(drawingsDir)) {
  fs.mkdirSync(drawingsDir, { recursive: true });
}

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  }
});

// Configure multer for drawing uploads (PNG only, 2MB max)
const drawingStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, drawingsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '.png');
  }
});
const uploadDrawing = multer({
  storage: drawingStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/png') return cb(null, true);
    cb(new Error('Only PNG files are allowed for drawings!'));
  }
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../../client/dist'))); // Assuming client build
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// API routes
app.post('/api/upload-profile', (req, res) => {
  upload.single('profileImage')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large. Maximum size is 5MB.' });
      }
      return res.status(400).json({ error: 'Upload failed.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    res.json({ imageUrl: `/uploads/player-images/${req.file.filename}` });
  });
});

app.post('/api/upload-drawing', (req, res) => {
  uploadDrawing.single('drawing')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large. Maximum drawing size is 2MB.' });
      }
      return res.status(400).json({ error: 'Upload failed.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    res.json({ imageUrl: `/uploads/player-drawings/${req.file.filename}` });
  });
});

// Pre-validate join fields before the drawing step (no state mutation)
app.post('/api/validate-join', (req, res) => {
  try {
    const result = gameState.validateJoin(req.body || {});
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error during validation. Please try again.' });
  }
});

// Socket.io connection
io.on('connection', (socket) => {
  serverDebug('connections', `A user connected: ${socket.id}`);

  // Send current game state
  socket.emit('game-state', getClientGameState());
  socket.emit('system-debug-snapshot', systemDebugPrints);

  // Handle player join (new registration, lobby only)
  socket.on('join', (data) => {
    const result = gameState.addOrRejoinPlayer(socket.id, data || {});
    if (result.error) {
      socket.emit('join-error', result.error);
      return;
    }
    emitGameState();
  });

  // Handle player reconnect (any stage, password-verified)
  socket.on('reconnect-player', (data) => {
    const result = gameState.reconnectPlayer(socket.id, data?.realName, data?.password);
    if (result.error) {
      socket.emit('join-error', result.error);
      return;
    }
    emitGameState();
  });

  socket.on('pre-bet-choice', (data) => {
    const choice = String(data?.choice || '').toUpperCase();
    const result = gameState.applyPreBetChoice(socket.id, choice);
    if (result.error) {
      socket.emit('error', result.error);
      return;
    }
    emitGameState();
  });

  socket.on('position-select', (data) => {
    const position = String(data?.position || '');
    const result = gameState.assignPositionWithOptions(socket.id, position, {
      cascade: Boolean(data?.cascade)
    });
    if (result.error) {
      socket.emit('error', result.error);
      return;
    }

    // Emit cascade spin event BEFORE game state so HostView can animate first
    if (result.cascade) {
      const cascade = result.cascade;
      const initiator = gameState.getPlayerById(socket.id);
      serverDebug('cascade', `[CASCADE] Emitting cascade-spin: ${JSON.stringify({ targetPosition: cascade.finalPosition, mode: cascade.mode, level: cascade.level, dnfSlots: cascade.dnfSlots, roll: cascade.roll })}`);
      emitCascadeSpin({
        targetPosition: cascade.finalPosition,
        mode: cascade.mode,
        level: cascade.level,
        dnfSlots: cascade.dnfSlots,
        roll: cascade.roll,
        segments: cascade.segments,
        initiatorName: initiator?.displayName ?? 'Unknown',
        forcedDnf: cascade.forcedDnf ?? false,
      });
    }

    if (result.complete) {
      if (result.cascade) {
        // Wait until host wheel animation completes before advancing stage.
        pendingPositionAssignmentFinalize = true;
        timerManager.clearTimer();
        emitGameState();
      } else {
        finalizePositionAssignmentPhase();
      }
    } else {
      // Check if the same player still has more picks remaining
      const draft = gameState.positionDraft;
      const currentPickerId = gameState.wheelOrder?.[draft?.currentPlayerIndex];
      if (currentPickerId === socket.id) {
        // Still their turn — extend the timer by 10 seconds
        timerManager.addTime(10);
      } else {
        // Turn passed to next player — kill the old timer so it doesn't fire
        // while the wheel is spinning. Timer restarts after 'spin-complete'.
        timerManager.clearTimer();
      }
      emitGameState();
    }
  });

  // Handle betting actions
  socket.on('betting-action', (data) => {
    const result = bettingEngine.processAction(socket.id, data.action, data.amount);
    if (result.error) {
      socket.emit('error', result.error);
    } else {
      emitGameState();
      maybeStartNextBettingTimer();
    }
  });

  socket.on('group-vote', (data) => {
    const result = timerManager.submitVote(socket.id, data?.action);
    if (result.error) {
      socket.emit('error', result.error);
    }
  });

  // Position draft timeout vote
  socket.on('position-vote', (data) => {
    const result = timerManager.submitPositionVote(socket.id, data?.position);
    if (result.error) {
      socket.emit('error', result.error);
    }
  });

  // Cascade-response timeout vote (other players vote cascade vs accept-dnf for timed-out player)
  socket.on('cascade-response-vote', (data) => {
    const result = timerManager.submitCascadeResponseVote(socket.id, data?.choice);
    if (result.error) {
      socket.emit('error', result.error);
    }
  });

  // HostView emits this when the wheel animation finishes — start the picker's timer now
  socket.on('spin-complete', () => {
    if (gameState.currentStage === STAGES.POSITION_ASSIGNMENT) {
      if (botSettings.skipWheelAnimation) {
        autoAssignAllRemainingPositions();
      } else {
        maybeStartPositionTimer();
        queueBotAutoAction();
      }
    }
  });

  socket.on('cascade-spin-complete', (data) => {
    if (gameState.currentStage !== STAGES.POSITION_ASSIGNMENT) {
      return;
    }

    const spinToken = String(data?.token || '');
    if (!spinToken || spinToken !== expectedCascadeSpinToken) {
      return;
    }

    handleCascadeSpinConcluded('client-event');
  });

  // Displaced player's response to an active cascade chain
  socket.on('cascade-response', (data) => {
    const doCascade = Boolean(data?.cascade);
    // Clear the countdown timer — the player responded manually
    timerManager.clearTimer();
    const result = gameState.respondToDisplacedCascade(socket.id, doCascade);
    if (result.error) {
      socket.emit('error', result.error);
      return;
    }

    // Emit cascade spin event before game state update
    if (result.cascaded && result.outcome) {
      const outcome = result.outcome;
      const responder = gameState.getPlayerById(socket.id);
      serverDebug('cascade', `[CASCADE] Emitting cascade-spin (response): ${JSON.stringify({ targetPosition: outcome.finalPosition, mode: outcome.mode, level: outcome.level, dnfSlots: outcome.dnfSlots, roll: outcome.roll })}`);
      emitCascadeSpin({
        targetPosition: outcome.finalPosition,
        mode: outcome.mode,
        level: outcome.level,
        dnfSlots: outcome.dnfSlots,
        roll: outcome.roll,
        segments: outcome.segments,
        initiatorName: responder?.displayName ?? 'Unknown',
        forcedDnf: false,
      });
    }

    if (result.complete) {
      if (result.cascaded) {
        // A cascade spin was just emitted; complete phase only after wheel completion event.
        pendingPositionAssignmentFinalize = true;
        timerManager.clearTimer();
        emitGameState();
      } else {
        finalizePositionAssignmentPhase();
      }
    } else {
      emitGameState();
      if (!result.cascaded) {
        maybeStartPositionTimer();
      }
    }
  });

  // Lightweight runtime diagnostics emitted by HostView and displayed in HostControls.
  socket.on('system-debug-print', (data) => {
    const entry = sanitizeSystemDebugPrint(data);
    if (!shouldRelaySystemDebugPrint(entry)) {
      return;
    }
    pushSystemDebugPrint(entry);
    io.emit('system-debug-print', entry);
  });

  // ── Host admin actions (kick, eliminate, set-balance, set-positions) ───────
  socket.on('host-admin', (data) => {
    const { action, playerId } = data || {};
    if (!playerId) { socket.emit('error', 'Missing playerId.'); return; }

    let result;
    if (action === 'kick') {
      result = gameState.adminKickPlayer(playerId);
      if (!result.error) {
        timerManager.clearTimer();
        // Notify the kicked player's socket if still connected
        io.to(playerId).emit('kicked', { reason: 'You were removed by the host.' });
      }
    } else if (['manual-eliminate', 'manual_eliminate', 'eliminate-player', 'eliminate'].includes(String(action || '').toLowerCase())) {
      result = gameState.adminEliminatePlayer(playerId);
      if (!result.error) {
        timerManager.clearTimer();
      }
    } else if (action === 'resolve-resurrection') {
      result = gameState.adminResolveResurrection(playerId, data.outcome);
    } else if (action === 'set-balance') {
      result = gameState.adminSetBalance(playerId, data.balance);
    } else if (action === 'set-positions') {
      result = gameState.adminSetPositions(playerId, data.positions);
    } else {
      socket.emit('error', `Unknown admin action: ${String(action ?? 'undefined')}`); return;
    }

    if (result.error) { socket.emit('error', result.error); return; }
    emitGameState();
  });

  // Handle host actions
  socket.on('host-action', (data, ack) => {
    const rawAction = String(data?.action || '');
    const action = rawAction.trim().toLowerCase();
    const actionCompact = action.replace(/[^a-z0-9]/g, '');
    let result = { success: true };
    switch (action) {
      case 'open-lobby':
        pendingPositionAssignmentFinalize = false;
        expectedCascadeSpinToken = null;
        clearCascadeCompletionTimeout();
        clearBotPositionSpinFallback();
        result = gameState.openLobby(data.maxCashCap);
        break;
      case 'start-game':
        pendingPositionAssignmentFinalize = false;
        expectedCascadeSpinToken = null;
        clearCascadeCompletionTimeout();
        clearBotPositionSpinFallback();
        resetPreBetDebugLog();
        result = gameState.startPreBet();
        break;
      case 'start-position-assignment':
        pendingPositionAssignmentFinalize = false;
        expectedCascadeSpinToken = null;
        clearCascadeCompletionTimeout();
        clearBotPositionSpinFallback();
        if (!Boolean(data.forceIgnorePendingResurrection) && gameState.hasPendingResurrectionPlayers()) {
          const names = gameState.getPendingResurrectionPlayers().map((p) => p.displayName).join(', ');
          result = { error: `Pending resurrection decisions: ${names}. Resolve them or force continue.` };
          break;
        }
        if (!gameState.allPreBetChoicesSubmitted()) {
          result = { error: 'Waiting for all active players to choose PAY or SKIP.' };
          break;
        }
        result = gameState.startPositionAssignment();
        if (result.success && result.preserved) {
          const phaseResult = gameState.completePositionAssignment();
          if (!phaseResult.skippedBetting) {
            bettingEngine.initializeBetting();
          }
        } else if (result.success) {
          // Timer starts when HostView emits 'spin-complete' after the wheel animation finishes
        }
        break;
      case 'next-race':
        pendingPositionAssignmentFinalize = false;
        expectedCascadeSpinToken = null;
        clearCascadeCompletionTimeout();
        clearBotPositionSpinFallback();
        result = gameState.nextRace();
        break;
      case 'record-race-result':
        result = settleRaceAndPersistSummary(data.placement);
        break;
      case 'manual-eliminate':
      case 'manual_eliminate':
      case 'eliminate-player':
      case 'eliminate':
        if (!data.playerId) {
          result = { error: 'Missing playerId for eliminate action.' };
          break;
        }
        result = gameState.adminEliminatePlayer(data.playerId);
        if (!result.error) {
          timerManager.clearTimer();
        }
        break;
      case 'save-race-data': {
        const snapshot = gameState.toSnapshot();
        const winners = getCurrentWinnerNames(snapshot);
        const archiveResult = stateStore.saveRaceArchive(snapshot, { winners });
        if (archiveResult.error) {
          result = { error: archiveResult.error };
          break;
        }
        result = {
          success: true,
          archiveDir: archiveResult.archiveDir,
          folderName: archiveResult.folderName,
        };
        break;
      }
      case 'reset-game': {
        pendingPositionAssignmentFinalize = false;
        expectedCascadeSpinToken = null;
        clearCascadeCompletionTimeout();
        timerManager.clearTimer();
        clearBotActionTimeout();
        clearPreBetDecisionSchedule();
        clearBotPositionSpinFallback();
        result = gameState.resetGame();
        // Clear persisted state
        stateStore.saveState(gameState.toSnapshot());
        // Delete all uploaded player images
        try {
          const files = fs.readdirSync(uploadsDir);
          for (const file of files) {
            fs.unlinkSync(path.join(uploadsDir, file));
          }
        } catch (_) { /* non-fatal */ }
        // Tell all player clients to return to the main menu
        io.emit('game-reset');
        break;
      }
      case 'debug-add-bots':
        result = addDebugBots(data.count, data.startingCash);
        break;
      case 'debug-clear-bots':
        result = clearDebugBots();
        break;
      case 'debug-bot-config':
        result = updateBotSettings(data.settings || {});
        break;
      case 'debug-system-print-config':
        systemDebugPrintConfig = sanitizeSystemDebugPrintConfig(data.settings || {});
        result = { success: true, systemDebugPrintConfig: { ...systemDebugPrintConfig } };
        break;
      case 'debug-system-print-set-channel':
        systemDebugPrintConfig = sanitizeSystemDebugPrintConfig({
          setChannel: {
            name: data.channel,
            enabled: data.enabled,
          },
        });
        result = { success: true, systemDebugPrintConfig: { ...systemDebugPrintConfig } };
        break;
      case 'debug-system-print-remove-channel':
        systemDebugPrintConfig = sanitizeSystemDebugPrintConfig({ removeChannel: data.channel });
        result = { success: true, systemDebugPrintConfig: { ...systemDebugPrintConfig } };
        break;
      case 'debug-clear-system-prints':
        systemDebugPrints = [];
        io.emit('system-debug-snapshot', systemDebugPrints);
        result = { success: true };
        break;
      case 'debug-run-bot-step': {
        const acted = runOneBotAction();
        result = { success: true, acted };
        break;
      }
      default:
        if (['manualeliminate', 'eliminateplayer', 'eliminate'].includes(actionCompact)) {
          if (!data.playerId) {
            result = { error: 'Missing playerId for eliminate action.' };
            break;
          }
          result = gameState.adminEliminatePlayer(data.playerId);
          if (!result.error) {
            timerManager.clearTimer();
          }
          break;
        }
        result = { error: `Unknown host action: ${rawAction || '(empty)'}` };
        break;
    }

    if (result.error) {
      socket.emit('error', result.error);
      if (typeof ack === 'function') ack(result);
      return;
    }

    emitGameState();
    maybeStartNextBettingTimer();
    if (typeof ack === 'function') ack(result);
  });

  // Handle race complete from sidecar
  socket.on('race-complete', (data) => {
    const result = settleRaceAndPersistSummary(data.placement);
    if (result.error) {
      socket.emit('error', result.error);
      return;
    }
    emitGameState();
    maybeStartNextBettingTimer();
  });

  socket.on('disconnect', () => {
    serverDebug('connections', `User disconnected: ${socket.id}`);
    gameState.markDisconnected(socket.id);
    emitGameState();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  // If the server restarted mid-game, resume the active timer so players
  // don't get stuck waiting forever with no countdown.
  const stage = gameState.currentStage;
  if (stage === STAGES.BETTING) {
    console.log('[Startup] Resuming betting timer after restart…');
    maybeStartNextBettingTimer();
  } else if (stage === STAGES.POSITION_ASSIGNMENT) {
    console.log('[Startup] Resuming position timer after restart…');
    maybeStartPositionTimer();
  }
});

// Independent watchdog in case the timer callback is missed or delayed unexpectedly.
setInterval(() => {
  if (gameState.currentStage !== STAGES.POSITION_ASSIGNMENT) {
    return;
  }

  if (!expectedCascadeSpinToken || !expectedCascadeSpinDeadlineAt) {
    return;
  }

  if (Date.now() < expectedCascadeSpinDeadlineAt) {
    return;
  }

  serverDebug('cascade', `[CASCADE] Watchdog completion fired for token=${expectedCascadeSpinToken}.`);
  handleCascadeSpinConcluded('watchdog-interval');
}, 1000);

// Position timer failsafe: if spin-complete is missed and no position timer is active
// after the wheel animation window, start the timer server-side.
setInterval(() => {
  if (gameState.currentStage !== STAGES.POSITION_ASSIGNMENT) {
    positionTimerMissingSince = 0;
    return;
  }

  const draft = gameState.positionDraft;
  if (!draft) {
    positionTimerMissingSince = 0;
    return;
  }

  if (pendingPositionAssignmentFinalize || expectedCascadeSpinToken || draft.cascadeChain) {
    positionTimerMissingSince = 0;
    return;
  }

  const currentPickerId = gameState.wheelOrder?.[draft.currentPlayerIndex];
  if (!currentPickerId) {
    positionTimerMissingSince = 0;
    return;
  }

  const timerRunningForPicker = Boolean(
    timerManager.currentTimer &&
    timerManager.timerMode === 'position' &&
    timerManager.timeoutPlayer === currentPickerId
  );

  if (timerRunningForPicker) {
    positionTimerMissingSince = 0;
    return;
  }

  if (!positionTimerMissingSince) {
    positionTimerMissingSince = Date.now();
    return;
  }

  if (Date.now() - positionTimerMissingSince < POSITION_TIMER_FAILSAFE_DELAY_MS) {
    return;
  }

  serverDebug('position', `[POSITION] Failsafe timer start fired for picker=${currentPickerId}.`);
  positionTimerMissingSince = 0;
  maybeStartPositionTimer();
}, 500);

// Heartbeat: if a bot-relevant decision is pending and no action timeout is queued,
// schedule bot automation. This catches vote/session starts that don't emit game-state.
setInterval(() => {
  if (!botSettings.autoPick || !hasBotPlayers()) return;
  if (botActionTimeout) return;
  if (!shouldRetryBotAutoAction()) return;
  queueBotAutoAction();
}, BOT_AUTOMATION_HEARTBEAT_MS);