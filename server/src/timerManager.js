const ALL_POSITIONS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'DNF'];

class TimerManager {
  constructor(io, gameState, bettingEngine, onVoteResolved, onPositionTimeout, onCascadeResponseTimeout) {
    this.io = io;
    this.gameState = gameState;
    this.bettingEngine = bettingEngine;
    this.onVoteResolved = onVoteResolved || null;
    this.onPositionTimeout = onPositionTimeout || null;
    this.onCascadeResponseTimeout = onCascadeResponseTimeout || null;
    this.currentTimer = null;
    this.timeoutPlayer = null;
    this.timerMode = 'betting'; // 'betting' | 'position' | 'cascade-response'
    this.timeLeft = 0;
    this.voteSession = null;
    this.voteTickInterval = null;
    this.positionVoteSession = null;
    this.positionVoteTickInterval = null;
    this.cascadeResponseVoteSession = null;
    this.cascadeResponseVoteTickInterval = null;
  }

  // Start a countdown timer for a player.
  // mode: 'betting' (60s, triggers group vote on timeout)
  //       'position' (30s, auto-picks on timeout)
  startTimer(playerId, duration, mode = 'betting') {
    this._stopInterval();
    this.timeoutPlayer = playerId;
    this.timerMode = mode;
    this.timeLeft = duration !== undefined ? duration : (mode === 'position' ? 30 : 60);
    this.initialDuration = this.timeLeft;

    console.log(`[TimerManager] startTimer — player=${playerId} mode=${mode} duration=${this.timeLeft}s`);
    this.io.emit('timer-update', { playerId, timeLeft: this.timeLeft, mode: this.timerMode });

    this.currentTimer = setInterval(() => {
      try {
        this.timeLeft--;
        if (this.timeLeft % 10 === 0 || this.timeLeft <= 5) {
          console.log(`[TimerManager] tick — player=${playerId} timeLeft=${this.timeLeft}s`);
        }
        this.io.emit('timer-update', { playerId, timeLeft: this.timeLeft, mode: this.timerMode });
        if (this.timeLeft <= 0) {
          this.handleTimeout();
        }
      } catch (err) {
        console.error('[TimerManager] Error in timer tick:', err);
      }
    }, 1000);
  }

  // Extend the running timer by `seconds`. Emits the updated value immediately.
  addTime(seconds) {
    if (!this.currentTimer || !this.timeoutPlayer) return;
    const cap = this.initialDuration ?? this.timeLeft;
    this.timeLeft = Math.min(this.timeLeft + seconds, cap);
    console.log(`[TimerManager] addTime +${seconds}s — player=${this.timeoutPlayer} newTotal=${this.timeLeft}s (cap=${cap}s)`);
    this.io.emit('timer-update', {
      playerId: this.timeoutPlayer,
      timeLeft: this.timeLeft,
      mode: this.timerMode,
      bonusAdded: seconds,
    });
  }

  // Stop the countdown interval only — does NOT clear timeoutPlayer,
  // because startGroupVote and resolveVote still need it.
  _stopInterval() {
    if (this.currentTimer) {
      clearInterval(this.currentTimer);
      this.currentTimer = null;
    }
  }

  // Full reset: stop all timers and clear state.
  clearTimer() {
    console.log(`[TimerManager] clearTimer — was tracking player=${this.timeoutPlayer}`);
    this._stopInterval();
    this._stopVoteTick();
    if (this.voteSession) {
      clearTimeout(this.voteSession.voteTimer);
      this.voteSession = null;
    }
    this._stopPositionVoteTick();
    if (this.positionVoteSession) {
      clearTimeout(this.positionVoteSession.voteTimer);
      this.positionVoteSession = null;
    }
    this._stopCascadeResponseVoteTick();
    if (this.cascadeResponseVoteSession) {
      clearTimeout(this.cascadeResponseVoteSession.voteTimer);
      this.cascadeResponseVoteSession = null;
    }
    this.timeoutPlayer = null;
    this.timeLeft = 0;
    this.io.emit('timer-clear');
  }

  handleTimeout() {
    console.log(`[TimerManager] TIMEOUT — player=${this.timeoutPlayer} mode=${this.timerMode}`);
    this._stopInterval();
    if (this.timerMode === 'position') {
      this.handlePositionTimeout();
    } else if (this.timerMode === 'cascade-response') {
      this.handleCascadeResponseTimeout();
    } else {
      this.startGroupVote();
    }
  }

  handlePositionTimeout() {
    // Keep this.timeoutPlayer alive — startPositionGroupVote needs it
    console.log(`[TimerManager] starting position group vote for player=${this.timeoutPlayer}`);
    // Clear the countdown UI before showing the vote
    this.io.emit('timer-clear');
    this.startPositionGroupVote();
  }

  startPositionGroupVote() {
    const playerId = this.timeoutPlayer;
    const draft = this.gameState.positionDraft;

    if (!draft) {
      // No draft state — fall back to random picks
      this._fallbackPositionPicks(playerId);
      return;
    }

    const picksNeeded = draft.remainingByPlayer?.[playerId] ?? 1;
    const availablePositions =
      draft.mode === 'NON_EXCLUSIVE'
        ? [...ALL_POSITIONS]
        : ALL_POSITIONS.filter((p) => !draft.occupiedPositions?.[p]);

    const voterIds = this.gameState.players
      .filter((p) => p.paidEntry && p.id !== playerId)
      .map((p) => p.id);

    let voteTimeLeft = 30;

    this.positionVoteSession = {
      timedOutPlayer: playerId,
      votes: {},
      voterIds,
      availablePositions,
      picksNeeded,
      voteTimer: setTimeout(() => {
        this._stopPositionVoteTick();
        this.resolvePositionVote();
      }, 30000),
    };

    console.log(`[TimerManager] position-vote-start — player=${playerId} picks=${picksNeeded} voters=${voterIds.length}`);
    this.io.emit('position-vote-start', {
      timedOutPlayer: playerId,
      voters: voterIds,
      options: availablePositions,
      picksNeeded,
      endsInSeconds: voteTimeLeft,
    });

    this.positionVoteTickInterval = setInterval(() => {
      voteTimeLeft--;
      this.io.emit('position-vote-timer-update', { timeLeft: voteTimeLeft });
      if (voteTimeLeft <= 0) {
        this._stopPositionVoteTick();
      }
    }, 1000);
  }

  _stopPositionVoteTick() {
    if (this.positionVoteTickInterval) {
      clearInterval(this.positionVoteTickInterval);
      this.positionVoteTickInterval = null;
    }
  }

  _buildPositionVoteCounts() {
    const counts = {};
    this.positionVoteSession.availablePositions.forEach((p) => { counts[p] = 0; });
    Object.values(this.positionVoteSession.votes).forEach((p) => {
      if (counts[p] !== undefined) counts[p]++;
    });
    return counts;
  }

  submitPositionVote(voterId, position) {
    if (!this.positionVoteSession) {
      return { error: 'No active position vote.' };
    }
    if (!this.positionVoteSession.voterIds.includes(voterId)) {
      return { error: 'You are not eligible to vote.' };
    }
    if (!this.positionVoteSession.availablePositions.includes(position)) {
      return { error: 'Invalid position.' };
    }

    this.positionVoteSession.votes[voterId] = position;
    const voteCounts = this._buildPositionVoteCounts();

    this.io.emit('position-vote-update', {
      voteCounts,
      totalVotes: Object.keys(this.positionVoteSession.votes).length,
      totalVoters: this.positionVoteSession.voterIds.length,
    });

    // Auto-resolve early if every eligible voter has voted
    if (Object.keys(this.positionVoteSession.votes).length >= this.positionVoteSession.voterIds.length) {
      this._stopPositionVoteTick();
      clearTimeout(this.positionVoteSession.voteTimer);
      this.resolvePositionVote();
    }

    return { success: true };
  }

  resolvePositionVote() {
    if (!this.positionVoteSession) return;

    const { timedOutPlayer, availablePositions, picksNeeded } = this.positionVoteSession;
    const voteCounts = this._buildPositionVoteCounts();

    // Sort by votes descending, random tiebreaker
    const sorted = [...availablePositions].sort((a, b) => {
      const diff = (voteCounts[b] || 0) - (voteCounts[a] || 0);
      return diff !== 0 ? diff : Math.random() - 0.5;
    });

    // Take the top N positions; fill any remaining with random picks from leftovers
    const assigned = sorted.slice(0, Math.min(picksNeeded, sorted.length));
    if (assigned.length < picksNeeded) {
      const pool = availablePositions.filter((p) => !assigned.includes(p));
      while (assigned.length < picksNeeded && pool.length > 0) {
        const idx = Math.floor(Math.random() * pool.length);
        assigned.push(pool.splice(idx, 1)[0]);
      }
    }

    console.log(`[TimerManager] position-vote-result — player=${timedOutPlayer} assigned=${assigned.join(',')}`);
    this.io.emit('position-vote-result', {
      timedOutPlayer,
      assignedPositions: assigned,
      voteCounts,
    });

    this.positionVoteSession = null;
    this.timeoutPlayer = null;
    this.timeLeft = 0;

    if (this.onPositionTimeout) {
      this.onPositionTimeout(timedOutPlayer, assigned);
    }
  }

  // Fallback: assign all remaining picks randomly (used if positionDraft is missing)
  _fallbackPositionPicks(playerId) {
    const draft = this.gameState.positionDraft;
    const picksNeeded = draft?.remainingByPlayer?.[playerId] ?? 1;
    const available =
      draft?.mode === 'NON_EXCLUSIVE'
        ? [...ALL_POSITIONS]
        : ALL_POSITIONS.filter((p) => !draft?.occupiedPositions?.[p]);

    const assigned = [];
    const pool = [...available];
    for (let i = 0; i < picksNeeded && pool.length > 0; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      assigned.push(pool.splice(idx, 1)[0]);
    }

    this.timeoutPlayer = null;
    this.timeLeft = 0;

    if (this.onPositionTimeout) {
      this.onPositionTimeout(playerId, assigned);
    }
  }

  // ── Cascade-response timeout & vote ──────────────────────────────────────
  handleCascadeResponseTimeout() {
    console.log(`[TimerManager] cascade-response TIMEOUT — player=${this.timeoutPlayer}`);
    this.io.emit('timer-clear');
    this.startCascadeResponseGroupVote();
  }

  startCascadeResponseGroupVote() {
    const playerId = this.timeoutPlayer;
    const voterIds = this.gameState.players
      .filter((p) => p.paidEntry && p.id !== playerId)
      .map((p) => p.id);

    let voteTimeLeft = 30;

    this.cascadeResponseVoteSession = {
      timedOutPlayer: playerId,
      votes: {},
      voterIds,
      voteTimer: setTimeout(() => {
        this._stopCascadeResponseVoteTick();
        this.resolveCascadeResponseVote();
      }, 30000),
    };

    console.log(`[TimerManager] cascade-response-vote-start — player=${playerId} voters=${voterIds.length}`);
    this.io.emit('cascade-response-vote-start', {
      timedOutPlayer: playerId,
      voters: voterIds,
      endsInSeconds: voteTimeLeft,
    });

    this.cascadeResponseVoteTickInterval = setInterval(() => {
      voteTimeLeft--;
      this.io.emit('cascade-response-vote-timer-update', { timeLeft: voteTimeLeft });
      if (voteTimeLeft <= 0) {
        this._stopCascadeResponseVoteTick();
      }
    }, 1000);
  }

  _stopCascadeResponseVoteTick() {
    if (this.cascadeResponseVoteTickInterval) {
      clearInterval(this.cascadeResponseVoteTickInterval);
      this.cascadeResponseVoteTickInterval = null;
    }
  }

  submitCascadeResponseVote(voterId, choice) {
    if (!this.cascadeResponseVoteSession) return { error: 'No active cascade response vote.' };
    if (!this.cascadeResponseVoteSession.voterIds.includes(voterId)) return { error: 'Not eligible to vote.' };
    if (choice !== 'cascade' && choice !== 'accept') return { error: 'Invalid vote choice.' };

    this.cascadeResponseVoteSession.votes[voterId] = choice;
    const cascadeVotes = Object.values(this.cascadeResponseVoteSession.votes).filter((v) => v === 'cascade').length;
    const acceptVotes = Object.values(this.cascadeResponseVoteSession.votes).filter((v) => v === 'accept').length;

    this.io.emit('cascade-response-vote-update', {
      cascadeVotes,
      acceptVotes,
      totalVotes: Object.keys(this.cascadeResponseVoteSession.votes).length,
      totalVoters: this.cascadeResponseVoteSession.voterIds.length,
    });

    if (Object.keys(this.cascadeResponseVoteSession.votes).length >= this.cascadeResponseVoteSession.voterIds.length) {
      this._stopCascadeResponseVoteTick();
      clearTimeout(this.cascadeResponseVoteSession.voteTimer);
      this.resolveCascadeResponseVote();
    }

    return { success: true };
  }

  resolveCascadeResponseVote() {
    if (!this.cascadeResponseVoteSession) return;
    const { timedOutPlayer, votes } = this.cascadeResponseVoteSession;
    const cascadeVotes = Object.values(votes).filter((v) => v === 'cascade').length;
    const acceptVotes = Object.values(votes).filter((v) => v === 'accept').length;
    // cascade wins on tie (gives displaced player the benefit of the doubt)
    const doCascade = cascadeVotes >= acceptVotes;

    console.log(`[TimerManager] cascade-response-vote-result — player=${timedOutPlayer} doCascade=${doCascade} (${cascadeVotes} cascade / ${acceptVotes} accept)`);
    this.io.emit('cascade-response-vote-result', { timedOutPlayer, doCascade, cascadeVotes, acceptVotes });

    this.cascadeResponseVoteSession = null;
    this.timeoutPlayer = null;
    this.timeLeft = 0;

    if (this.onCascadeResponseTimeout) {
      this.onCascadeResponseTimeout(timedOutPlayer, doCascade);
    }
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

    let voteTimeLeft = 30;

    this.voteSession = {
      votes: {},
      voterIds,
      options,
      voteTimer: setTimeout(() => {
        this._stopVoteTick();
        this.resolveVote();
      }, 30000),
    };

    this.io.emit('group-vote-start', {
      timedOutPlayer: this.timeoutPlayer,
      voters: voterIds,
      options,
      endsInSeconds: voteTimeLeft,
    });

    this.voteTickInterval = setInterval(() => {
      voteTimeLeft--;
      this.io.emit('vote-timer-update', { timeLeft: voteTimeLeft });
      if (voteTimeLeft <= 0) {
        this._stopVoteTick();
      }
    }, 1000);
  }

  _stopVoteTick() {
    if (this.voteTickInterval) {
      clearInterval(this.voteTickInterval);
      this.voteTickInterval = null;
    }
  }

  _buildVoteCounts() {
    const counts = {};
    this.voteSession.options.forEach((opt) => { counts[opt] = 0; });
    Object.values(this.voteSession.votes).forEach((v) => {
      if (counts[v] !== undefined) counts[v]++;
    });
    return counts;
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

    // Broadcast live tally (without revealing who voted what)
    const voteCounts = this._buildVoteCounts();
    this.io.emit('vote-update', {
      voteCounts,
      totalVotes: Object.keys(this.voteSession.votes).length,
      totalVoters: this.voteSession.voterIds.length,
    });

    // Auto-resolve early if every eligible voter has voted
    if (Object.keys(this.voteSession.votes).length >= this.voteSession.voterIds.length) {
      this._stopVoteTick();
      clearTimeout(this.voteSession.voteTimer);
      this.resolveVote();
    }

    return { success: true };
  }

  resolveVote() {
    if (!this.voteSession) {
      return;
    }

    const voteCounts = this._buildVoteCounts();

    let result = this.voteSession.options[0];
    let best = -1;
    this.voteSession.options.forEach((option) => {
      if (voteCounts[option] > best) {
        best = voteCounts[option];
        result = option;
      }
    });

    const timedOutPlayer = this.timeoutPlayer;
    const individualVotes = { ...this.voteSession.votes };

    this.voteSession = null;
    this.timeoutPlayer = null;

    const actionResult = this.bettingEngine.processAction(timedOutPlayer, result);
    this.io.emit('group-vote-result', {
      timedOutPlayer,
      result,
      voteCounts,
      votes: individualVotes,
      actionResult,
    });

    if (this.onVoteResolved) {
      this.onVoteResolved();
    }
  }
}

module.exports = TimerManager;