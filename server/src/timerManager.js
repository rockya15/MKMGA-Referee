class TimerManager {
  constructor(io, gameState, bettingEngine) {
    this.io = io;
    this.gameState = gameState;
    this.bettingEngine = bettingEngine;
    this.currentTimer = null;
    this.timeoutPlayer = null;
    this.voteSession = null;
  }

  // Start timer for the current bettor.
  startTimer(playerId, duration = 60) {
    this.clearTimer();
    this.timeoutPlayer = playerId;
    
    let timeLeft = duration;
    
    this.currentTimer = setInterval(() => {
      timeLeft--;
      
      // Emit timer update to all clients
      this.io.emit('timer-update', { playerId, timeLeft });
      
      if (timeLeft <= 0) {
        this.handleTimeout();
      }
    }, 1000);
  }

  clearTimer() {
    if (this.currentTimer) {
      clearInterval(this.currentTimer);
      this.currentTimer = null;
    }
    this.timeoutPlayer = null;
  }

  handleTimeout() {
    this.clearTimer();

    this.startGroupVote();
  }

  getVoteOptionsForTimedOutPlayer() {
    const player = this.gameState.getPlayerById(this.timeoutPlayer);
    if (!player) return ['fold'];

    const toCall = Math.max(0, this.gameState.bettingState.currentBet - player.roundBet);
    if (toCall > 0) {
      return player.skipFoldTokenAvailable ? ['call', 'fold'] : ['call'];
    }
    return player.skipFoldTokenAvailable ? ['check', 'fold'] : ['check'];
  }

  startGroupVote() {
    const voterIds = this.gameState.bettingState.playersInRound.filter((id) => id !== this.timeoutPlayer);
    const options = this.getVoteOptionsForTimedOutPlayer();

    this.voteSession = {
      votes: {},
      voterIds,
      options,
      voteTimer: setTimeout(() => {
        this.resolveVote();
      }, 30000)
    };

    this.io.emit('group-vote-start', {
      timedOutPlayer: this.timeoutPlayer,
      voters: voterIds,
      options,
      endsInSeconds: 30
    });
  }

  submitVote(voterId, action) {
    if (!this.voteSession) {
      return { error: 'No active vote.' };
    }

    if (!this.voteSession.voterIds.includes(voterId)) {
      return { error: 'You are not eligible to vote in this session.' };
    }

    if (!this.voteSession.options.includes(action)) {
      return { error: 'Invalid vote action.' };
    }

    this.voteSession.votes[voterId] = action;
    return { success: true };
  }

  resolveVote() {
    if (!this.voteSession) {
      return;
    }

    clearTimeout(this.voteSession.voteTimer);

    const voteCounts = {};
    this.voteSession.options.forEach((option) => {
      voteCounts[option] = 0;
    });

    Object.values(this.voteSession.votes).forEach((vote) => {
      if (voteCounts[vote] !== undefined) {
        voteCounts[vote] += 1;
      }
    });

    let result = this.voteSession.options[0];
    let best = -1;
    this.voteSession.options.forEach((option) => {
      if (voteCounts[option] > best) {
        best = voteCounts[option];
        result = option;
      }
    });

    const actionResult = this.bettingEngine.processAction(this.timeoutPlayer, result);
    this.io.emit('group-vote-result', {
      timedOutPlayer: this.timeoutPlayer,
      result,
      voteCounts,
      votes: this.voteSession.votes,
      actionResult
    });

    this.voteSession = null;
  }
}

module.exports = TimerManager;