const crypto = require('crypto');

function hashPassword(password, salt) {
  return crypto.createHmac('sha256', salt).update(String(password)).digest('hex');
}

const STAGES = {
  LOBBY: 'LOBBY',
  PRE_BET: 'PRE_BET',
  POSITION_ASSIGNMENT: 'POSITION_ASSIGNMENT',
  BETTING: 'BETTING',
  RACE_PENDING_RESULT: 'RACE_PENDING_RESULT',
  PAYOUT: 'PAYOUT',
  GAME_OVER: 'GAME_OVER'
};

const POSITIONS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'DNF'];
const GENTLE_DNF_SLOTS = [1, 2, 4, 8, 13];
const HARSH_DNF_SLOTS = [4, 8, 13];

class GameState {
  constructor() {
    this.currentStage = STAGES.LOBBY;
    this.players = [];
    this.hostSettings = {
      maxCashCap: null,
      lobbyOpen: false
    };
    this.raceNumber = 1;
    this.pot = 0;
    this.wheelOrder = [];
    this.entryFee = this.getEntryFee();
    this.positionDraft = null;
    this.bettingState = this.createEmptyBettingState();
    this.raceResult = null;
    this.preservePositionsNextRace = false;
  }

  getAllSnapshotFields() {
    return {
      currentStage: this.currentStage,
      players: this.players,
      hostSettings: this.hostSettings,
      raceNumber: this.raceNumber,
      pot: this.pot,
      wheelOrder: this.wheelOrder,
      entryFee: this.entryFee,
      positionDraft: this.positionDraft,
      bettingState: this.bettingState,
      raceResult: this.raceResult,
      preservePositionsNextRace: this.preservePositionsNextRace
    };
  }

  toSnapshot() {
    return this.getAllSnapshotFields();
  }

  hydrate(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
      return { error: 'Invalid snapshot.' };
    }

    const merged = {
      ...this.getAllSnapshotFields(),
      ...snapshot
    };

    this.currentStage = merged.currentStage;
    this.players = Array.isArray(merged.players) ? merged.players : [];
    this.hostSettings = merged.hostSettings || { maxCashCap: null, lobbyOpen: false };
    this.raceNumber = Number.isFinite(merged.raceNumber) ? merged.raceNumber : 1;
    this.pot = Number.isFinite(merged.pot) ? merged.pot : 0;
    this.wheelOrder = Array.isArray(merged.wheelOrder) ? merged.wheelOrder : [];
    this.entryFee = merged.entryFee ?? this.getEntryFee();
    this.positionDraft = merged.positionDraft || null;
    this.bettingState = merged.bettingState || this.createEmptyBettingState();
    this.raceResult = merged.raceResult || null;
    this.preservePositionsNextRace = Boolean(merged.preservePositionsNextRace);

    return { success: true };
  }

  createEmptyBettingState() {
    return {
      currentBet: 0,
      playersInRound: [],
      actionQueue: [],
      betCap: 0,
      raiseLockedPlayers: {},
      initialBetCap: 0
    };
  }

  setStage(stage) {
    this.currentStage = stage;
  }

  roundToQuarter(value) {
    return Math.round(value * 4) / 4;
  }

  isQuarterMultiple(value) {
    return Number.isFinite(value) && Math.abs(value * 4 - Math.round(value * 4)) < 1e-8;
  }

  getEntryFee() {
    if (this.raceNumber >= 10) return 'ALL_IN';
    return this.roundToQuarter(0.25 * Math.pow(2, this.raceNumber - 1));
  }

  getPlayerById(playerId) {
    return this.players.find((player) => player.id === playerId);
  }

  getPayingPlayers() {
    return this.players.filter((player) => player.paidEntry);
  }

  getAlivePlayers() {
    return this.players.filter((player) => player.balance > 0);
  }

  getDisplayNameTaken(displayName, exceptPlayerId = null) {
    return this.players.some((player) => player.id !== exceptPlayerId && player.displayName.toLowerCase() === String(displayName).toLowerCase());
  }

  getRealNameTaken(realName, exceptPlayerId = null) {
    return this.players.some((player) => player.id !== exceptPlayerId && player.realName.toLowerCase() === String(realName).toLowerCase());
  }

  addOrRejoinPlayer(socketId, playerData) {
    if (!this.hostSettings.lobbyOpen || this.currentStage !== STAGES.LOBBY) {
      return { error: 'Registration is closed. The game is already in progress.' };
    }

    const displayName = String(playerData.displayName || '').trim();
    const realName = String(playerData.realName || '').trim();
    const cashAmount = Number(playerData.cashAmount);
    const password = String(playerData.password || '').trim();

    if (!displayName || !realName) {
      return { error: 'Display name and real name are required.' };
    }

    if (!password || password.length < 1) {
      return { error: 'Password is required.' };
    }

    if (this.getDisplayNameTaken(displayName)) {
      return { error: 'Display name already exists.' };
    }

    if (this.getRealNameTaken(realName)) {
      return { error: 'Real name already exists.' };
    }

    if (!Number.isFinite(cashAmount) || cashAmount <= 0) {
      return { error: 'Cash amount must be greater than $0.00.' };
    }

    if (!this.isQuarterMultiple(cashAmount)) {
      return { error: 'Cash amount must be a multiple of $0.25.' };
    }

    if (Number.isFinite(this.hostSettings.maxCashCap) && cashAmount > this.hostSettings.maxCashCap) {
      return { error: `Cash amount exceeds max cap of $${this.hostSettings.maxCashCap.toFixed(2)}.` };
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);

    const player = {
      id: socketId,
      connected: true,
      displayName,
      realName,
      denomination: playerData.denomination || 'quarters',
      funStatement: String(playerData.funStatement || '').trim(),
      startingBalance: this.roundToQuarter(cashAmount),
      balance: this.roundToQuarter(cashAmount),
      skipFoldTokenAvailable: true,
      paidEntry: false,
      skippedRace: false,
      allIn: false,
      folded: false,
      contributedThisRace: 0,
      roundBet: 0,
      positions: [],
      profileImageUrl: String(playerData.profileImageUrl || '').trim() || null,
      passwordHash,
      salt
    };

    this.players.push(player);
    return { player, rejoined: false };
  }

  reconnectPlayer(socketId, realName, password) {
    // Match by realName regardless of connected status — allows reconnect even
    // when the disconnect event hasn't been processed yet (race condition).
    const candidate = this.players.find(
      (p) => p.realName.toLowerCase() === String(realName).toLowerCase()
    );

    if (!candidate) {
      return { error: 'No account found with that name.' };
    }

    // Already on this exact socket — nothing to do.
    if (candidate.id === socketId && candidate.connected) {
      return { player: candidate, rejoined: true };
    }

    if (!candidate.salt || !candidate.passwordHash) {
      return { error: 'This account has no password set. Please contact the host.' };
    }

    const hash = hashPassword(String(password), candidate.salt);
    if (hash !== candidate.passwordHash) {
      return { error: 'Incorrect password.' };
    }

    candidate.id = socketId;
    candidate.connected = true;
    return { player: candidate, rejoined: true };
  }

  markDisconnected(socketId) {
    const player = this.getPlayerById(socketId);
    if (player) {
      player.connected = false;
    }
  }

  openLobby(maxCashCap) {
    const cap = Number(maxCashCap);
    if (!Number.isFinite(cap) || cap <= 0 || !this.isQuarterMultiple(cap)) {
      return { error: 'Max cash cap must be a positive multiple of $0.25.' };
    }
    this.hostSettings.maxCashCap = this.roundToQuarter(cap);
    this.hostSettings.lobbyOpen = true;
    this.setStage(STAGES.LOBBY);
    return { success: true };
  }

  startPreBet() {
    if (this.currentStage !== STAGES.LOBBY) {
      return { error: 'Can only start pre-bet from lobby.' };
    }

    const alive = this.getAlivePlayers();
    if (alive.length === 0) {
      return { error: 'No active players available.' };
    }

    this.entryFee = this.getEntryFee();
    this.players.forEach((player) => {
      player.paidEntry = false;
      player.skippedRace = false;
      player.allIn = false;
      player.folded = false;
      player.contributedThisRace = 0;
      player.roundBet = 0;

      if (!this.preservePositionsNextRace) {
        player.positions = [];
      }
    });

    this.positionDraft = null;
    this.bettingState = this.createEmptyBettingState();
    this.raceResult = null;
    this.setStage(STAGES.PRE_BET);
    return { success: true };
  }

  applyPreBetChoice(playerId, choice) {
    if (this.currentStage !== STAGES.PRE_BET) {
      return { error: 'Not in pre-bet phase.' };
    }

    const player = this.getPlayerById(playerId);
    if (!player) {
      return { error: 'Player not found.' };
    }

    if (player.balance <= 0) {
      return { error: 'Eliminated players cannot act.' };
    }

    if (player.paidEntry || player.skippedRace) {
      return { error: 'Choice already submitted for this race.' };
    }

    if (choice === 'SKIP') {
      if (!player.skipFoldTokenAvailable) {
        return { error: 'Skip/Fold token already used. You must pay.' };
      }
      player.skipFoldTokenAvailable = false;
      player.skippedRace = true;
      return { success: true };
    }

    if (choice !== 'PAY') {
      return { error: 'Invalid pre-bet choice.' };
    }

    const isAllInEntry = this.entryFee === 'ALL_IN' || player.balance <= this.entryFee;
    const entryAmount = isAllInEntry ? player.balance : this.entryFee;

    player.balance = this.roundToQuarter(player.balance - entryAmount);
    player.contributedThisRace = this.roundToQuarter(player.contributedThisRace + entryAmount);
    player.paidEntry = true;
    player.allIn = player.balance === 0;

    return { success: true, allInEntry: isAllInEntry };
  }

  allPreBetChoicesSubmitted() {
    return this.players
      .filter((player) => player.balance > 0)
      .every((player) => player.paidEntry || player.skippedRace);
  }

  startPositionAssignment() {
    if (this.currentStage !== STAGES.PRE_BET) {
      return { error: 'Position assignment can only start from pre-bet phase.' };
    }

    const payingPlayers = this.getPayingPlayers();

    if (payingPlayers.length === 0) {
      this.setStage(STAGES.PRE_BET);
      return { success: true, skippedRace: true };
    }

    if (this.preservePositionsNextRace) {
      this.wheelOrder = payingPlayers.map((player) => player.id);
      return { success: true, preserved: true };
    }

    this.wheelOrder = [...payingPlayers]
      .sort(() => Math.random() - 0.5)
      .map((player) => player.id);

    const picksByPlayer = {};
    if (payingPlayers.length > POSITIONS.length) {
      this.wheelOrder.forEach((playerId) => {
        picksByPlayer[playerId] = 1;
      });
    } else {
      const base = Math.floor(POSITIONS.length / payingPlayers.length);
      const remainder = POSITIONS.length % payingPlayers.length;
      this.wheelOrder.forEach((playerId, index) => {
        picksByPlayer[playerId] = base + (index < remainder ? 1 : 0);
      });
    }

    this.positionDraft = {
      mode: payingPlayers.length > POSITIONS.length ? 'NON_EXCLUSIVE' : 'EXCLUSIVE',
      picksByPlayer,
      remainingByPlayer: { ...picksByPlayer },
      occupiedPositions: {},
      currentPlayerIndex: 0,
      selectedCount: 0,
      cascadeChainSpent: false,
      cascadeChain: null,
    };

    this.setStage(STAGES.POSITION_ASSIGNMENT);
    return { success: true };
  }

  getCurrentPositionPicker() {
    if (!this.positionDraft) return null;
    return this.wheelOrder[this.positionDraft.currentPlayerIndex] || null;
  }

  assignPosition(playerId, position) {
    return this.assignPositionWithOptions(playerId, position, {});
  }

  getAvailableExclusivePositions() {
    if (!this.positionDraft || this.positionDraft.mode !== 'EXCLUSIVE') {
      return [...POSITIONS];
    }

    return POSITIONS.filter((slot) => !this.positionDraft.occupiedPositions[slot]);
  }

  isForcedDnfPick() {
    const available = this.getAvailableExclusivePositions();
    return available.length === 1 && available[0] === 'DNF';
  }

  replacePlayerPosition(player, oldPosition, nextPosition) {
    const index = player.positions.indexOf(oldPosition);
    if (index >= 0) {
      player.positions[index] = nextPosition;
    } else {
      player.positions.push(nextPosition);
    }
  }

  rollCascadeResult(mode, level) {
    const table = mode === 'gentle' ? GENTLE_DNF_SLOTS : HARSH_DNF_SLOTS;
    const safeLevel = Math.max(0, Math.min(level, table.length - 1));
    const dnfSlots = table[safeLevel];
    // Roll 1–13: slots 1..dnfSlots = DNF, slots dnfSlots+1..13 = numbered positions
    const roll = Math.floor(Math.random() * 13) + 1;

    if (roll <= dnfSlots) {
      return { finalPosition: 'DNF', roll, dnfSlots, mode, level: safeLevel };
    }

    // Map roll slot (dnfSlots+1 .. 13) → position number (1 .. 13-dnfSlots)
    const positionIndex = roll - dnfSlots; // 1-based index among non-DNF slots
    const landedPosition = String(positionIndex);
    return { finalPosition: landedPosition, roll, dnfSlots, mode, level: safeLevel };
  }

  applyCascadeOutcome(player, outcome) {
    const removedIndex = player.positions.indexOf('DNF');
    if (removedIndex >= 0 && outcome.finalPosition !== 'DNF') {
      player.positions.splice(removedIndex, 1);
    }

    if (outcome.finalPosition !== 'DNF') {
      player.positions.push(outcome.finalPosition);
    }

    if (outcome.finalPosition === 'DNF') {
      this.positionDraft.occupiedPositions.DNF = player.id;
      return outcome;
    }

    const displacedId = this.positionDraft.occupiedPositions[outcome.finalPosition];
    this.positionDraft.occupiedPositions[outcome.finalPosition] = player.id;

    if (!displacedId) {
      delete this.positionDraft.occupiedPositions.DNF;
      return outcome;
    }

    const displacedPlayer = this.getPlayerById(displacedId);
    if (displacedPlayer) {
      this.replacePlayerPosition(displacedPlayer, outcome.finalPosition, 'DNF');
      this.positionDraft.occupiedPositions.DNF = displacedPlayer.id;
    }

    return { ...outcome, displacedPlayerId: displacedId };
  }

  respondToDisplacedCascade(playerId, doCascade) {
    if (!this.positionDraft?.cascadeChain) {
      return { error: 'No pending cascade chain.' };
    }

    const chain = this.positionDraft.cascadeChain;
    if (chain.pendingDisplacedId !== playerId) {
      return { error: 'Not your cascade to respond to.' };
    }

    if (!doCascade) {
      // Accept DNF — chain ends
      this.positionDraft.cascadeChain = null;
      this.positionDraft.cascadeChainSpent = true;
      const complete = this.wheelOrder.every((id) => this.positionDraft.remainingByPlayer[id] === 0);
      return { success: true, cascaded: false, complete };
    }

    // Player chooses to cascade
    const { nextMode, nextLevel, originalCascaderId, originalCascaderNextHarshLevel } = chain;
    const player = this.getPlayerById(playerId);
    if (!player) return { error: 'Player not found.' };

    const outcome = this.rollCascadeResult(nextMode, nextLevel);
    const cascadeResult = this.applyCascadeOutcome(player, outcome);
    cascadeResult.mode = nextMode;
    cascadeResult.level = nextLevel;

    if (outcome.finalPosition === 'DNF' || !cascadeResult.displacedPlayerId) {
      // Chain ends: rolled DNF or landed on free position
      this.positionDraft.cascadeChain = null;
      this.positionDraft.cascadeChainSpent = true;
    } else {
      const newDisplacedId = cascadeResult.displacedPlayerId;
      if (newDisplacedId === originalCascaderId && originalCascaderNextHarshLevel !== null) {
        // Original harsh cascader re-displaced — continues harsh progression
        const harshLevel = originalCascaderNextHarshLevel;
        if (harshLevel >= HARSH_DNF_SLOTS.length) {
          // Harsh table exhausted — guaranteed DNF, chain ends
          this.positionDraft.cascadeChain = null;
          this.positionDraft.cascadeChainSpent = true;
        } else {
          this.positionDraft.cascadeChain = {
            originalCascaderId,
            originalCascaderNextHarshLevel: harshLevel + 1,
            pendingDisplacedId: newDisplacedId,
            nextMode: 'harsh',
            nextLevel: harshLevel,
          };
        }
      } else {
        // Regular gentle continuation
        const newNextLevel = nextLevel + 1;
        if (newNextLevel >= GENTLE_DNF_SLOTS.length) {
          // Gentle table at maximum — guaranteed DNF level, chain ends
          this.positionDraft.cascadeChain = null;
          this.positionDraft.cascadeChainSpent = true;
        } else {
          this.positionDraft.cascadeChain = {
            originalCascaderId,
            originalCascaderNextHarshLevel,
            pendingDisplacedId: newDisplacedId,
            nextMode: 'gentle',
            nextLevel: newNextLevel,
          };
        }
      }
    }

    const complete = this.wheelOrder.every((id) => this.positionDraft.remainingByPlayer[id] === 0);
    return { success: true, cascaded: true, outcome: cascadeResult, complete };
  }

  clearPendingCascade() {
    if (this.positionDraft?.cascadeChain) {
      this.positionDraft.cascadeChain = null;
      this.positionDraft.cascadeChainSpent = true;
    }
  }

  assignPositionWithOptions(playerId, position, options = {}) {
    if (this.currentStage !== STAGES.POSITION_ASSIGNMENT) {
      return { error: 'Not in position assignment phase.' };
    }

    const player = this.getPlayerById(playerId);
    if (!player || !player.paidEntry) {
      return { error: 'Invalid player for position assignment.' };
    }

    if (!POSITIONS.includes(position)) {
      return { error: 'Invalid position.' };
    }

    if (!this.positionDraft) {
      return { error: 'Position draft is not initialized.' };
    }

    const currentPicker = this.getCurrentPositionPicker();
    if (currentPicker !== playerId) {
      return { error: 'Not your turn to pick.' };
    }

    if (this.positionDraft.mode === 'EXCLUSIVE' && this.positionDraft.occupiedPositions[position]) {
      return { error: 'Position already taken.' };
    }

    const forcedDnf = position === 'DNF' && this.positionDraft.mode === 'EXCLUSIVE' ? this.isForcedDnfPick() : false;

    player.positions.push(position);
    this.positionDraft.remainingByPlayer[playerId] -= 1;
    this.positionDraft.selectedCount += 1;

    if (this.positionDraft.mode === 'EXCLUSIVE') {
      this.positionDraft.occupiedPositions[position] = playerId;
    }

    let cascade = null;
    if (
      this.positionDraft.mode === 'EXCLUSIVE' &&
      position === 'DNF' &&
      Boolean(options.cascade) &&
      !this.positionDraft.cascadeChainSpent &&
      !this.positionDraft.cascadeChain
    ) {
      const mode = forcedDnf ? 'gentle' : 'harsh';
      const outcome = this.rollCascadeResult(mode, 0);
      cascade = this.applyCascadeOutcome(player, outcome);
      cascade.forcedDnf = forcedDnf;
      cascade.mode = mode;
      cascade.level = 0;
      if (outcome.finalPosition === 'DNF' || !cascade.displacedPlayerId) {
        // Rolled DNF or landed on a free position — chain ends
        this.positionDraft.cascadeChainSpent = true;
      } else {
        // Displaced someone — per spec, displaced enters gentle at "level 2" (0-indexed: 1)
        this.positionDraft.cascadeChain = {
          originalCascaderId: playerId,
          originalCascaderNextHarshLevel: mode === 'harsh' ? 1 : null,
          pendingDisplacedId: cascade.displacedPlayerId,
          nextMode: 'gentle',
          nextLevel: 1,
        };
      }
    }

    while (this.positionDraft.currentPlayerIndex < this.wheelOrder.length) {
      const activePlayerId = this.wheelOrder[this.positionDraft.currentPlayerIndex];
      if (this.positionDraft.remainingByPlayer[activePlayerId] > 0) break;
      this.positionDraft.currentPlayerIndex += 1;
    }

    const complete = this.wheelOrder.every((id) => this.positionDraft.remainingByPlayer[id] === 0);
    if (complete) {
      this.positionDraft.currentPlayerIndex = this.wheelOrder.length;
    }

    return { success: true, complete, cascade };
  }

  shouldSkipBetting() {
    const payingPlayers = this.getPayingPlayers();
    if (payingPlayers.length <= 1) {
      return true;
    }
    return payingPlayers.every((player) => player.allIn || player.balance <= 0);
  }

  completePositionAssignment() {
    if (this.shouldSkipBetting()) {
      this.setStage(STAGES.RACE_PENDING_RESULT);
      return { skippedBetting: true };
    }
    this.setStage(STAGES.BETTING);
    return { skippedBetting: false };
  }

  settleRace(placement) {
    if (!POSITIONS.includes(String(placement))) {
      return { error: 'Invalid race result placement.' };
    }

    this.raceResult = String(placement);

    const winners = this.players.filter((player) => {
      return player.paidEntry && !player.folded && player.positions.includes(this.raceResult);
    });

    if (winners.length > 0) {
      const share = this.roundToQuarter(Math.floor((this.pot / winners.length) * 4) / 4);
      const totalPaid = this.roundToQuarter(share * winners.length);
      this.pot = this.roundToQuarter(this.pot - totalPaid);

      winners.forEach((winner) => {
        winner.balance = this.roundToQuarter(winner.balance + share);
      });
    }

    this.setStage(STAGES.PAYOUT);

    const alive = this.getAlivePlayers();
    if (alive.length <= 1) {
      this.setStage(STAGES.GAME_OVER);
    }

    const payingPlayers = this.getPayingPlayers();
    this.preservePositionsNextRace = payingPlayers.length > 0 && payingPlayers.every((player) => player.balance === 0);

    return {
      success: true,
      winners: winners.map((winner) => winner.id),
      stage: this.currentStage
    };
  }

  nextRace() {
    if (this.currentStage === STAGES.GAME_OVER) {
      return { error: 'Game is over.' };
    }

    this.raceNumber += 1;
    this.entryFee = this.getEntryFee();
    this.positionDraft = null;
    this.bettingState = this.createEmptyBettingState();
    this.raceResult = null;
    this.setStage(STAGES.PRE_BET);

    this.players.forEach((player) => {
      player.paidEntry = false;
      player.skippedRace = false;
      player.allIn = false;
      player.folded = false;
      player.contributedThisRace = 0;
      player.roundBet = 0;

      if (!this.preservePositionsNextRace) {
        player.positions = [];
      }
    });

    return { success: true };
  }

  resetGame() {
    this.currentStage = STAGES.LOBBY;
    this.players = [];
    this.hostSettings = { maxCashCap: null, lobbyOpen: false };
    this.raceNumber = 1;
    this.pot = 0;
    this.wheelOrder = [];
    this.entryFee = this.getEntryFee();
    this.positionDraft = null;
    this.bettingState = this.createEmptyBettingState();
    this.raceResult = null;
    this.preservePositionsNextRace = false;
    return { success: true };
  }
}

module.exports = { GameState, STAGES, POSITIONS };