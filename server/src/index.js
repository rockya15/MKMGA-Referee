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

const BOT_COLOR_PALETTE = ['#2a2a4a', '#2f4f4f', '#5b2c6f', '#1f5f8b', '#2b7a4b', '#8b5a2b', '#6f4f28', '#4a5d23'];
const BOT_DEFAULTS = {
  autoPick: true,
  decisionDelayMs: 1000,
  variableTimeoutDelay: false,
  timeoutDelayMinMs: 500,
  timeoutDelayMaxMs: 5000,
  preBetMode: 'AUTO',
  positionMode: 'AUTO',
  bettingMode: 'AUTO',
  cascadeMode: 'AUTO',
  voteMode: 'AUTO',
};
const BOT_POSITION_POST_SPIN_GRACE_MS = 1400;
const BOT_CASCADE_POST_SPIN_GRACE_MS = 700;
const BOT_AUTOMATION_HEARTBEAT_MS = 250;

let botSettings = { ...BOT_DEFAULTS };
let botActionTimeout = null;
let botPositionActionsAllowedAt = 0;
let botCascadeActionsAllowedAt = 0;
let positionTimerMissingSince = 0;
let botPositionSpinFallbackTimeout = null;
const SYSTEM_DEBUG_PRINT_LIMIT = 200;
let systemDebugPrints = [];

function sanitizeSystemDebugPrint(raw = {}) {
  return {
    at: new Date().toISOString(),
    source: String(raw.source || 'unknown'),
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
    console.warn(`[POSITION] Bot spin fallback timer start for picker=${pickerId}.`);
    maybeStartPositionTimer();
  }, BOT_POSITION_SPIN_WAIT_MS);
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
      console.error('[CASCADE] onCascadeResponseTimeout error:', result.error);
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
  }
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
    players: snapshot.players.map(sanitizePlayerForClient)
  };
}

function emitGameState() {
  stateStore.saveState(gameState.toSnapshot());
  io.emit('game-state', getClientGameState());
  queueBotAutoAction();
}

function maybeStartNextBettingTimer() {
  if (gameState.currentStage !== STAGES.BETTING) {
    timerManager.clearTimer();
    return;
  }

  const nextPlayerId = bettingEngine.getCurrentActor();
  if (nextPlayerId) {
    timerManager.startTimer(nextPlayerId, 60, 'betting');
    queueBotAutoAction();
  } else {
    timerManager.clearTimer();
  }
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
    botPositionActionsAllowedAt = Date.now() + BOT_POSITION_POST_SPIN_GRACE_MS;
    positionTimerMissingSince = 0;
    clearBotPositionSpinFallback();
    queueBotAutoAction();
  }
}

function queueBotAutoAction() {
  if (!botSettings.autoPick || !hasBotPlayers()) return;
  if (botActionTimeout) return;
  const delay = getBotActionDelayMs();
  botActionTimeout = setTimeout(() => {
    botActionTimeout = null;
    const acted = runOneBotAction();
    if (acted) {
      emitGameState();
      if (gameState.currentStage === STAGES.BETTING) {
        maybeStartNextBettingTimer();
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

function isTimeoutSensitiveBotContext() {
  if (timerManager.voteSession || timerManager.positionVoteSession || timerManager.cascadeResponseVoteSession) {
    return true;
  }

  const activeTimerMode = timerManager?.timerMode;
  return activeTimerMode === 'position' || activeTimerMode === 'betting' || activeTimerMode === 'cascade-response';
}

function getBotActionDelayMs() {
  const baseDelay = clampInt(botSettings.decisionDelayMs, 0, 15000);
  if (!botSettings.variableTimeoutDelay) return baseDelay;
  if (!isTimeoutSensitiveBotContext()) return baseDelay;

  const minDelay = clampInt(botSettings.timeoutDelayMinMs, 0, 15000);
  const maxDelay = clampInt(botSettings.timeoutDelayMaxMs, 0, 15000);
  const low = Math.min(minDelay, maxDelay);
  const high = Math.max(minDelay, maxDelay);
  if (low === high) return low;
  return low + Math.floor(Math.random() * (high - low + 1));
}

function chooseFrom(array) {
  if (!Array.isArray(array) || array.length === 0) return null;
  return array[Math.floor(Math.random() * array.length)];
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
  const currentBet = Number(state.currentBet || 0);
  const toCall = Math.max(0, currentBet - Number(player.roundBet || 0));
  const canFold = Boolean(player.skipFoldTokenAvailable);
  const canRaise = !state.raiseLockedPlayers?.[player.id] &&
    Number(state.betCap || 0) > currentBet &&
    Number(player.balance || 0) + Number(player.roundBet || 0) > currentBet;

  const minRaiseTo = Math.round((currentBet + 0.25) * 4) / 4;
  const maxRaiseTo = Math.round((Math.min(Number(state.betCap || 0), Number(player.balance || 0) + Number(player.roundBet || 0))) * 4) / 4;

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
      return { action, amount: minRaiseTo };
    }
    return { action };
  }

  // AUTO: mostly check/call, occasional fold, rare min-raise when legal.
  if (canRaise && maxRaiseTo >= minRaiseTo && Math.random() < 0.15) {
    return { action: 'raise', amount: minRaiseTo };
  }
  if (toCall > 0 && canFold && Math.random() < 0.12) {
    return { action: 'fold' };
  }
  return { action: toCall > 0 ? 'call' : 'check' };
}

function runOneBotAction() {
  // 1) Active vote sessions: cast one pending bot vote
  if (timerManager.voteSession) {
    const pending = timerManager.voteSession.voterIds.filter((id) => isBotPlayer(gameState.getPlayerById(id)) && !timerManager.voteSession.votes[id]);
    if (pending.length > 0) {
      const voterId = pending[0];
      const choice = pickBotVote(timerManager.voteSession.options);
      if (choice) {
        timerManager.submitVote(voterId, choice);
        return true;
      }
    }
  }

  if (timerManager.positionVoteSession) {
    const pending = timerManager.positionVoteSession.voterIds.filter((id) => isBotPlayer(gameState.getPlayerById(id)) && !timerManager.positionVoteSession.votes[id]);
    if (pending.length > 0) {
      const voterId = pending[0];
      const choice = pickBotVote(timerManager.positionVoteSession.availablePositions);
      if (choice) {
        timerManager.submitPositionVote(voterId, choice);
        return true;
      }
    }
  }

  if (timerManager.cascadeResponseVoteSession) {
    const pending = timerManager.cascadeResponseVoteSession.voterIds.filter((id) => isBotPlayer(gameState.getPlayerById(id)) && !timerManager.cascadeResponseVoteSession.votes[id]);
    if (pending.length > 0) {
      const voterId = pending[0];
      const choice = pickBotVote(['cascade', 'accept']);
      if (choice) {
        timerManager.submitCascadeResponseVote(voterId, choice);
        return true;
      }
    }
  }

  // 2) Stage-driven bot actions
  if (gameState.currentStage === STAGES.PRE_BET) {
    const target = gameState.players.find((p) => isBotPlayer(p) && p.balance > 0 && !p.paidEntry && !p.skippedRace);
    if (!target) return false;
    const choice = pickBotPreBetChoice(target);
    const result = gameState.applyPreBetChoice(target.id, choice);
    return !result.error;
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

  let added = 0;
  for (let i = 0; i < wanted; i += 1) {
    const n = gameState.players.filter((p) => isBotPlayer(p)).length + 1;
    const displayName = `Bot ${n}`;
    const realName = `bot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const color = BOT_COLOR_PALETTE[(n - 1) % BOT_COLOR_PALETTE.length];
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
  clearBotPositionSpinFallback();

  return { success: true, removed: botIds.length };
}

function updateBotSettings(payload = {}) {
  botSettings = {
    autoPick: typeof payload.autoPick === 'boolean' ? payload.autoPick : botSettings.autoPick,
    decisionDelayMs: clampInt(payload.decisionDelayMs ?? botSettings.decisionDelayMs, 0, 15000),
    variableTimeoutDelay: typeof payload.variableTimeoutDelay === 'boolean' ? payload.variableTimeoutDelay : botSettings.variableTimeoutDelay,
    timeoutDelayMinMs: clampInt(payload.timeoutDelayMinMs ?? botSettings.timeoutDelayMinMs, 0, 15000),
    timeoutDelayMaxMs: clampInt(payload.timeoutDelayMaxMs ?? botSettings.timeoutDelayMaxMs, 0, 15000),
    preBetMode: pickMode(payload.preBetMode, ['AUTO', 'PAY', 'SKIP', 'RANDOM'], botSettings.preBetMode),
    positionMode: pickMode(payload.positionMode, ['AUTO', 'RANDOM', 'SAFE_FIRST', 'PREFER_DNF'], botSettings.positionMode),
    bettingMode: pickMode(payload.bettingMode, ['AUTO', 'CHECK_CALL', 'FOLD_IF_POSSIBLE', 'RANDOM'], botSettings.bettingMode),
    cascadeMode: pickMode(payload.cascadeMode, ['AUTO', 'CASCADE', 'ACCEPT_DNF', 'RANDOM'], botSettings.cascadeMode),
    voteMode: pickMode(payload.voteMode, ['AUTO', 'RANDOM', 'FIRST'], botSettings.voteMode),
  };

  if (!botSettings.autoPick) {
    clearBotActionTimeout();
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
    console.warn(`[CASCADE] Spin conclusion applied via ${reason}; prompt is now ready.`);
    // Start 30s timer for the displaced player
    const displacedId = gameState.positionDraft?.cascadeChain?.pendingDisplacedId;
    if (displacedId) {
      timerManager.startTimer(displacedId, 30, 'cascade-response');
      botCascadeActionsAllowedAt = Date.now() + BOT_CASCADE_POST_SPIN_GRACE_MS;
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
    console.warn(`[CASCADE] Fallback completion fired for token=${token}.`);
    handleCascadeSpinConcluded('fallback-timeout');
  }, delayMs);
}

function emitCascadeSpin(payload) {
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

// Socket.io connection
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

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
      console.log('[CASCADE] Emitting cascade-spin:', { targetPosition: cascade.finalPosition, mode: cascade.mode, level: cascade.level, dnfSlots: cascade.dnfSlots, roll: cascade.roll });
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
      maybeStartPositionTimer();
      queueBotAutoAction();
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
      console.log('[CASCADE] Emitting cascade-spin (response):', { targetPosition: outcome.finalPosition, mode: outcome.mode, level: outcome.level, dnfSlots: outcome.dnfSlots, roll: outcome.roll });
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
    pushSystemDebugPrint(entry);
    io.emit('system-debug-print', entry);
  });

  // ── Host admin actions (kick, set-balance, set-positions) ───────────────────
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
    } else if (action === 'set-balance') {
      result = gameState.adminSetBalance(playerId, data.balance);
    } else if (action === 'set-positions') {
      result = gameState.adminSetPositions(playerId, data.positions);
    } else {
      socket.emit('error', 'Unknown admin action.'); return;
    }

    if (result.error) { socket.emit('error', result.error); return; }
    emitGameState();
  });

  // Handle host actions
  socket.on('host-action', (data, ack) => {
    let result = { success: true };
    switch (data.action) {
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
        result = gameState.startPreBet();
        break;
      case 'start-position-assignment':
        pendingPositionAssignmentFinalize = false;
        expectedCascadeSpinToken = null;
        clearCascadeCompletionTimeout();
        clearBotPositionSpinFallback();
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
      case 'debug-run-bot-step': {
        const acted = runOneBotAction();
        result = { success: true, acted };
        break;
      }
      default:
        result = { error: 'Unknown host action.' };
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
    console.log('User disconnected:', socket.id);
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

  console.warn(`[CASCADE] Watchdog completion fired for token=${expectedCascadeSpinToken}.`);
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

  console.warn(`[POSITION] Failsafe timer start fired for picker=${currentPickerId}.`);
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