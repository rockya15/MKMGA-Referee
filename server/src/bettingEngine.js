const { STAGES } = require('./gameState');

class BettingEngine {
  constructor(gameState) {
    this.gameState = gameState;
  }

  roundToQuarter(value) {
    return Math.round(value * 4) / 4;
  }

  initializeBetting() {
    const playersInRound = this.gameState.getPayingPlayers().filter((player) => !player.allIn);
    const actionQueue = this.gameState.wheelOrder.filter((playerId) => {
      return playersInRound.some((player) => player.id === playerId);
    });

    let betCap = 0;
    if (playersInRound.length > 0) {
      betCap = Math.min(...playersInRound.map((player) => player.balance));
    }

    this.gameState.bettingState.currentBet = 0;
    this.gameState.bettingState.playersInRound = playersInRound.map((player) => player.id);
    this.gameState.bettingState.actionQueue = actionQueue;
    this.gameState.bettingState.betCap = betCap;
    this.gameState.bettingState.initialBetCap = betCap;
    this.gameState.bettingState.raiseLockedPlayers = {};

    this.gameState.setStage(STAGES.BETTING);
  }

  getPlayer(playerId) {
    return this.gameState.getPlayerById(playerId);
  }

  isPlayerInRound(playerId) {
    return this.gameState.bettingState.playersInRound.includes(playerId);
  }

  getCurrentActor() {
    return this.gameState.bettingState.actionQueue[0] || null;
  }

  removeFromQueue(playerId) {
    this.gameState.bettingState.actionQueue = this.gameState.bettingState.actionQueue.filter((id) => id !== playerId);
  }

  contribute(player, amount) {
    player.balance = this.roundToQuarter(player.balance - amount);
    player.roundBet = this.roundToQuarter(player.roundBet + amount);
    player.contributedThisRace = this.roundToQuarter(player.contributedThisRace + amount);
    this.gameState.pot = this.roundToQuarter(this.gameState.pot + amount);
    if (player.balance === 0) {
      player.allIn = true;
    }
  }

  canFold(player) {
    return player.skipFoldTokenAvailable;
  }

  recalculateBetCapAfterFold() {
    const activeIds = this.gameState.bettingState.playersInRound;
    const activePlayers = this.gameState.players.filter((player) => {
      return activeIds.includes(player.id) && !player.folded;
    });

    if (activePlayers.length === 0) {
      this.gameState.bettingState.betCap = 0;
      return;
    }

    this.gameState.bettingState.betCap = Math.min(...activePlayers.map((player) => player.balance));
  }

  requeueAfterRaise(raiserId) {
    const raiserIndex = this.gameState.wheelOrder.indexOf(raiserId);
    const alreadyQueued = new Set(this.gameState.bettingState.actionQueue);
    const requeue = [];

    for (let i = 0; i < raiserIndex; i += 1) {
      const candidateId = this.gameState.wheelOrder[i];
      const candidate = this.getPlayer(candidateId);
      if (!candidate || candidate.folded || candidate.allIn || !this.isPlayerInRound(candidateId)) {
        continue;
      }
      if (!alreadyQueued.has(candidateId)) {
        requeue.push(candidateId);
        this.gameState.bettingState.raiseLockedPlayers[candidateId] = true;
      }
    }

    this.gameState.bettingState.actionQueue = [...requeue, ...this.gameState.bettingState.actionQueue];
  }

  processAction(playerId, action, amount = 0) {
    if (this.gameState.currentStage !== STAGES.BETTING) {
      return { error: 'Betting is not active.' };
    }

    const player = this.getPlayer(playerId);
    if (!player || !this.isPlayerInRound(playerId) || player.folded || player.allIn) {
      return { error: 'Invalid betting player.' };
    }

    const currentActor = this.getCurrentActor();
    if (currentActor !== playerId) {
      return { error: 'Not your turn.' };
    }

    const state = this.gameState.bettingState;
    const toCall = this.roundToQuarter(Math.max(0, state.currentBet - player.roundBet));

    if (action === 'check') {
      if (toCall !== 0) {
        return { error: 'Cannot check when there is an active bet.' };
      }
      this.removeFromQueue(playerId);
      return this.finalizeIfComplete();
    }

    if (action === 'fold') {
      if (!this.canFold(player)) {
        return { error: 'Fold is unavailable. Skip/Fold token already used.' };
      }
      player.skipFoldTokenAvailable = false;
      player.folded = true;
      state.playersInRound = state.playersInRound.filter((id) => id !== playerId);
      this.removeFromQueue(playerId);
      this.recalculateBetCapAfterFold();
      return this.finalizeIfComplete();
    }

    if (action === 'call') {
      if (toCall === 0) {
        return { error: 'No call amount required.' };
      }

      if (player.balance >= toCall) {
        this.contribute(player, toCall);
      } else {
        // Forced all-in call
        this.contribute(player, player.balance);
      }

      this.removeFromQueue(playerId);
      return this.finalizeIfComplete();
    }

    if (action === 'raise') {
      if (state.raiseLockedPlayers[playerId]) {
        return { error: 'You were re-queued and cannot raise again this cycle.' };
      }

      const raiseTo = Number(amount);
      if (!Number.isFinite(raiseTo)) {
        return { error: 'Raise amount is required.' };
      }

      if (raiseTo <= state.currentBet) {
        return { error: 'Raise must be greater than the current bet.' };
      }

      if (raiseTo > state.betCap) {
        return { error: 'Raise exceeds current bet cap.' };
      }

      const needed = this.roundToQuarter(raiseTo - player.roundBet);
      if (needed > player.balance) {
        return { error: 'Insufficient balance for this raise.' };
      }

      this.contribute(player, needed);
      state.currentBet = raiseTo;
      this.removeFromQueue(playerId);
      this.requeueAfterRaise(playerId);
      return this.finalizeIfComplete();
    }

    return { error: 'Invalid betting action.' };
  }

  finalizeIfComplete() {
    if (this.gameState.bettingState.actionQueue.length > 0) {
      return { success: true, complete: false };
    }

    this.gameState.setStage(STAGES.RACE_PENDING_RESULT);
    return { success: true, complete: true };
  }
}

module.exports = BettingEngine;