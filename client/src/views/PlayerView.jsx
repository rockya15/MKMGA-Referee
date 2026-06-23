import { useState, useEffect, useRef } from 'react';
import MoneyTicker from '../components/MoneyTicker';
import Avatar from '../components/Avatar';
import DrawingPrompt from '../components/DrawingPrompt';

const ALL_POSITIONS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'DNF'];
const GENTLE_DNF_SLOTS = [1, 2, 4, 8, 13];
const HARSH_DNF_SLOTS = [4, 8, 13];
const DEATH_GIF_SRC = '/assets/death.gif';

function PlayerView({ gameState, socket }) {
  const [mode, setMode] = useState('menu'); // 'menu' | 'joining' | 'reconnecting'
  const [serverError, setServerError] = useState(null);
  const [pendingDnf, setPendingDnf] = useState(false);
  const [showCascadeHelp, setShowCascadeHelp] = useState(false);
  const [showDisplacedCascadeHelp, setShowDisplacedCascadeHelp] = useState(false);
  const [raiseTotal, setRaiseTotal] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [forcedCallNotice, setForcedCallNotice] = useState(null);
  const storedCreds = useRef(null);
  const forcedCallNoticeTimeoutRef = useRef(null);

  // ── Group-vote & timer state ─────────────────────────────────────────────────
  const [groupVote, setGroupVote] = useState(null); // { timedOutPlayer, voters, options }
  const [voteTimeLeft, setVoteTimeLeft] = useState(0);
  const [voteCounts, setVoteCounts] = useState({});
  const [myVote, setMyVote] = useState(null);
  const [activeTimer, setActiveTimer] = useState(null); // { playerId, timeLeft, mode }
  const [myPlayerId, setMyPlayerId] = useState(null);

  // ── Position-vote state ──────────────────────────────────────────────────────
  const [positionVote, setPositionVote] = useState(null);
  const [positionVoteTimeLeft, setPositionVoteTimeLeft] = useState(0);
  const [positionVoteCounts, setPositionVoteCounts] = useState({});
  const [myPositionVote, setMyPositionVote] = useState(null);
  const [positionPulseKeys, setPositionPulseKeys] = useState({});
  const [maxBetFlash, setMaxBetFlash] = useState(false);
  const maxBetFlashTimeoutRef = useRef(null);

  // ── Cascade-response vote state ──────────────────────────────────────────────
  const [cascadeResponseVote, setCascadeResponseVote] = useState(null);
  const [cascadeResponseVoteTimeLeft, setCascadeResponseVoteTimeLeft] = useState(0);
  const [cascadeResponseVoteCounts, setCascadeResponseVoteCounts] = useState({ cascadeVotes: 0, acceptVotes: 0 });
  const [myCascadeResponseVote, setMyCascadeResponseVote] = useState(null);

  // Auto-reconnect when socket gets a new ID after a drop
  useEffect(() => {
    const handleConnect = () => {
      if (storedCreds.current) {
        socket.emit('reconnect-player', storedCreds.current);
      }
    };
    socket.on('connect', handleConnect);
    return () => socket.off('connect', handleConnect);
  }, [socket]);

  // Receive stable player ID from server after join or reconnect
  useEffect(() => {
    const onYourPlayerId = (id) => setMyPlayerId(id);
    socket.on('your-player-id', onYourPlayerId);
    return () => socket.off('your-player-id', onYourPlayerId);
  }, [socket]);

  // Fallback: if your-player-id was missed but game-state arrived, find self by realName
  useEffect(() => {
    if (myPlayerId && gameState.players.find((p) => p.id === myPlayerId)) return;
    const realName = storedCreds.current?.realName;
    if (!realName) return;
    const byName = gameState.players.find(
      (p) => String(p.realName || '').toLowerCase().trim() === String(realName).toLowerCase().trim()
    );
    if (byName && byName.id !== myPlayerId) {
      setMyPlayerId(byName.id);
    }
  }, [gameState.players, myPlayerId]);

  // Return to main menu if kicked or game is reset
  useEffect(() => {
    const handleKicked = () => {
      storedCreds.current = null;
      setMode('menu');
      setServerError('You were removed from the game by the host.');
    };
    const handleGameReset = () => {
      storedCreds.current = null;
      setMode('menu');
      setServerError(null);
      setMyPlayerId(null);
      lastMeRef.current = null;
    };
    socket.on('kicked', handleKicked);
    socket.on('game-reset', handleGameReset);
    return () => {
      socket.off('kicked', handleKicked);
      socket.off('game-reset', handleGameReset);
    };
  }, [socket]);

  useEffect(() => {
    const onError = (msg) => {
      setErrorMsg(typeof msg === 'string' ? msg : JSON.stringify(msg));
      setTimeout(() => setErrorMsg(null), 4000);
    };
    const onJoinError = (msg) => {
      // Clear stored creds so the holding screen doesn't block the menu
      storedCreds.current = null;
      setServerError(typeof msg === 'string' ? msg : JSON.stringify(msg));
    };
    socket.on('error', onError);
    socket.on('join-error', onJoinError);
    return () => {
      socket.off('error', onError);
      socket.off('join-error', onJoinError);
    };
  }, [socket]);

  useEffect(() => {
    const onForcedCallInfo = (data) => {
      const message = String(data?.message || '').trim() || 'Auto-called because only CALL was available.';
      const durationMs = Number.isFinite(Number(data?.durationMs)) ? Number(data.durationMs) : 5000;
      setForcedCallNotice(message);
      if (forcedCallNoticeTimeoutRef.current) {
        clearTimeout(forcedCallNoticeTimeoutRef.current);
      }
      forcedCallNoticeTimeoutRef.current = setTimeout(() => {
        setForcedCallNotice(null);
        forcedCallNoticeTimeoutRef.current = null;
      }, Math.max(250, durationMs));
    };

    socket.on('forced-call-info', onForcedCallInfo);
    return () => {
      socket.off('forced-call-info', onForcedCallInfo);
      if (forcedCallNoticeTimeoutRef.current) {
        clearTimeout(forcedCallNoticeTimeoutRef.current);
        forcedCallNoticeTimeoutRef.current = null;
      }
    };
  }, [socket]);

  useEffect(() => {
    const onVoteStart = (data) => {
      setGroupVote(data);
      setVoteTimeLeft(data.endsInSeconds);
      setVoteCounts({});
      setMyVote(null);
    };
    const onVoteResult = () => {
      setGroupVote(null);
      setVoteTimeLeft(0);
      setVoteCounts({});
      setMyVote(null);
    };
    const onVoteTimerUpdate = ({ timeLeft }) => setVoteTimeLeft(timeLeft);
    const onVoteUpdate = ({ voteCounts: vc }) => setVoteCounts(vc);
  const onTimerUpdate = (data) => {
      console.log('[Timer] timer-update received:', data);
      setActiveTimer(data);
    };
    const onTimerClear = () => {
      console.log('[Timer] timer-clear received');
      setActiveTimer(null);
    };
    socket.on('group-vote-start', onVoteStart);
    socket.on('group-vote-result', onVoteResult);
    socket.on('vote-timer-update', onVoteTimerUpdate);
    socket.on('vote-update', onVoteUpdate);
    socket.on('timer-update', onTimerUpdate);
    socket.on('timer-clear', onTimerClear);
    return () => {
      socket.off('group-vote-start', onVoteStart);
      socket.off('group-vote-result', onVoteResult);
      socket.off('vote-timer-update', onVoteTimerUpdate);
      socket.off('vote-update', onVoteUpdate);
      socket.off('timer-update', onTimerUpdate);
      socket.off('timer-clear', onTimerClear);
    };
  }, [socket]);

  useEffect(() => {
    const onPosVoteStart = (data) => {
      setPositionVote(data);
      setPositionVoteTimeLeft(data.endsInSeconds);
      setPositionVoteCounts({});
      setMyPositionVote(null);
    };
    const onPosVoteResult = () => {
      setPositionVote(null);
      setPositionVoteTimeLeft(0);
      setPositionVoteCounts({});
      setMyPositionVote(null);
    };
    const onPosVoteTimerUpdate = ({ timeLeft }) => setPositionVoteTimeLeft(timeLeft);
    const onPosVoteUpdate = ({ voteCounts: vc }) => setPositionVoteCounts(vc);
    socket.on('position-vote-start', onPosVoteStart);
    socket.on('position-vote-result', onPosVoteResult);
    socket.on('position-vote-timer-update', onPosVoteTimerUpdate);
    socket.on('position-vote-update', onPosVoteUpdate);
    return () => {
      socket.off('position-vote-start', onPosVoteStart);
      socket.off('position-vote-result', onPosVoteResult);
      socket.off('position-vote-timer-update', onPosVoteTimerUpdate);
      socket.off('position-vote-update', onPosVoteUpdate);
    };
  }, [socket]);

  useEffect(() => {
    const onCRVoteStart = (data) => {
      setCascadeResponseVote(data);
      setCascadeResponseVoteTimeLeft(data.endsInSeconds);
      setCascadeResponseVoteCounts({ cascadeVotes: 0, acceptVotes: 0 });
      setMyCascadeResponseVote(null);
    };
    const onCRVoteResult = () => {
      setCascadeResponseVote(null);
      setCascadeResponseVoteTimeLeft(0);
      setCascadeResponseVoteCounts({ cascadeVotes: 0, acceptVotes: 0 });
      setMyCascadeResponseVote(null);
    };
    const onCRVoteTimerUpdate = ({ timeLeft }) => setCascadeResponseVoteTimeLeft(timeLeft);
    const onCRVoteUpdate = (data) => setCascadeResponseVoteCounts({ cascadeVotes: data.cascadeVotes, acceptVotes: data.acceptVotes });
    socket.on('cascade-response-vote-start', onCRVoteStart);
    socket.on('cascade-response-vote-result', onCRVoteResult);
    socket.on('cascade-response-vote-timer-update', onCRVoteTimerUpdate);
    socket.on('cascade-response-vote-update', onCRVoteUpdate);
    return () => {
      socket.off('cascade-response-vote-start', onCRVoteStart);
      socket.off('cascade-response-vote-result', onCRVoteResult);
      socket.off('cascade-response-vote-timer-update', onCRVoteTimerUpdate);
      socket.off('cascade-response-vote-update', onCRVoteUpdate);
    };
  }, [socket]);

  const currentMe = gameState.players.find((p) => p.id === myPlayerId);
  const lastMeRef = useRef(null);
  if (currentMe) lastMeRef.current = currentMe;
  // While reconnecting, use the last known player data so the UI doesn't flicker.
  const me = currentMe ?? (storedCreds.current ? lastMeRef.current : null);

  const lobbyOpen = gameState.hostSettings?.lobbyOpen;
  const inLobby = gameState.currentStage === 'LOBBY';
  const canRegister = lobbyOpen && inLobby;

  const pickPosition = (position, cascade = false) => {
    setPendingDnf(false);
    setShowCascadeHelp(false);
    socket.emit('position-select', { position, cascade });
  };

  const roundToQuarter = (value) => Math.round(value * 4) / 4;

  // ── Derive available positions ───────────────────────────────────────────────
  const { positionDraft, wheelOrder } = gameState;
  const isMyPickTurn =
    gameState.currentStage === 'POSITION_ASSIGNMENT' &&
    me &&
    positionDraft &&
    wheelOrder?.[positionDraft.currentPlayerIndex] === me.id;

  const picksRemaining = isMyPickTurn ? (positionDraft.remainingByPlayer?.[me.id] ?? 0) : 0;

  const availablePositions = (() => {
    if (!positionDraft) return ALL_POSITIONS;
    if (positionDraft.mode === 'NON_EXCLUSIVE') return ALL_POSITIONS;
    return ALL_POSITIONS.filter((pos) => !positionDraft.occupiedPositions?.[pos]);
  })();

  const cascadeSpent = positionDraft?.cascadeChainSpent ?? false;
  const cascadeChain = positionDraft?.cascadeChain ?? null;
  const iAmPendingDisplacedInChain = !!(cascadeChain && cascadeChain.pendingDisplacedId === me?.id);
  const iAmDisplacedInChain = !!(iAmPendingDisplacedInChain && cascadeChain?.promptReady);
  const hasRemainingPicks = (positionDraft?.remainingByPlayer?.[me?.id] ?? 0) > 0;
  const isCascadeWheelSpinning = !!(cascadeChain && !cascadeChain?.promptReady);
  const isPositionDraftWheelSpinning =
    gameState.currentStage === 'POSITION_ASSIGNMENT' &&
    !positionVote &&
    !isCascadeWheelSpinning &&
    !activeTimer;
  const showWheelSpinTvPrompt =
    gameState.currentStage === 'POSITION_ASSIGNMENT' &&
    me?.paidEntry &&
    !iAmDisplacedInChain &&
    !positionVote &&
    ((isCascadeWheelSpinning && iAmPendingDisplacedInChain) || (isPositionDraftWheelSpinning && hasRemainingPicks));
  // Cascade is available for DNF picks when: EXCLUSIVE mode, chain not spent, no chain pending
  const cascadeAvailable = // eslint-disable-line no-unused-vars
    positionDraft?.mode === 'EXCLUSIVE' && !cascadeSpent && !cascadeChain;

  // ── Betting helpers ──────────────────────────────────────────────────────────
  const isMyBetTurn =
    gameState.currentStage === 'BETTING' &&
    me &&
    gameState.bettingState?.actionQueue?.[0] === me.id;

  const currentBet = gameState.bettingState?.currentBet ?? 0;
  const betCap = gameState.bettingState?.betCap ?? 0;
  const minRaiseTo = roundToQuarter(currentBet + 0.25);
  const maxRaiseTo = roundToQuarter(
    Math.min(betCap, (me?.balance ?? 0) + (me?.roundBet ?? 0))
  );
  const playersInRound = gameState.bettingState?.playersInRound ?? [];
  const bettingActivePlayers = gameState.players.filter(
    (p) => playersInRound.includes(p.id) && !p.folded && !p.allIn
  );
  const limitingPlayers = bettingActivePlayers.filter(
    (p) => Math.abs(p.balance - betCap) < 0.01 && p.id !== me?.id
  );
  const betCapHint =
    limitingPlayers.length === 1
      ? limitingPlayers[0].displayName
      : limitingPlayers.length > 1
        ? `${limitingPlayers.length} people`
        : null;
  const raiseDenominations = [
    { value: 0.25, label: '0.25' },
    { value: 0.5, label: '0.5' },
    { value: 1, label: '1' },
    { value: 2, label: '$2' },
    { value: 5, label: '$5' },
  ];
  const canCheck = currentBet === 0 || (me?.roundBet ?? 0) >= currentBet;
  const canRaise = !gameState.bettingState?.raiseLockedPlayers?.[me?.id];
  const hasValidRaise =
    Number.isFinite(raiseTotal) && raiseTotal > currentBet && raiseTotal <= maxRaiseTo;
  const bettingIdlePrompt = forcedCallNotice || '👀 Look at the TV!';

  useEffect(() => {
    if (!isMyBetTurn || !canRaise || maxRaiseTo <= currentBet) {
      setRaiseTotal(null);
      return;
    }
    setRaiseTotal((prev) => {
      if (Number.isFinite(prev) && prev > currentBet && prev <= maxRaiseTo) {
        return prev;
      }
      return minRaiseTo;
    });
  }, [isMyBetTurn, canRaise, currentBet, minRaiseTo, maxRaiseTo]);

  const addRaiseChip = (chipValue) => {
    if (maxRaiseTo <= currentBet) return;
    setRaiseTotal((prev) => {
      const base = Number.isFinite(prev) ? prev : minRaiseTo;
      return roundToQuarter(Math.min(maxRaiseTo, base + chipValue));
    });
  };

  const stage = gameState.currentStage;
  const myTimer = activeTimer?.playerId === me?.id ? activeTimer : null;
  const timerUrgent = myTimer !== null && myTimer.timeLeft <= 10;
  const rawPositions = me?.positions ?? [];
  // Only show positions that are "settled" — hide ones gained while a cascade chain wheel
  // is still mid-spin (i.e. chain exists but promptReady is false).
  const cascadeWheelActive = !!(cascadeChain && !cascadeChain.promptReady);
  // We track a committed copy of positions; it gets updated only when the wheel is NOT spinning.
  const committedPositionsRef = useRef(rawPositions);
  if (!cascadeWheelActive) {
    committedPositionsRef.current = rawPositions;
  }
  const playerPositions = cascadeWheelActive ? committedPositionsRef.current : rawPositions;
  const previousPositionsRef = useRef(playerPositions);

  useEffect(() => {
    if (!me) return;

    const prevPositions = previousPositionsRef.current ?? [];
    const currentPositions = playerPositions;

    if (stage === 'POSITION_ASSIGNMENT' && currentPositions.length > prevPositions.length) {
      const newKeys = {};
      for (let idx = prevPositions.length; idx < currentPositions.length; idx += 1) {
        newKeys[`${currentPositions[idx]}-${idx}`] = true;
      }
      setPositionPulseKeys((prev) => ({ ...prev, ...newKeys }));

      setTimeout(() => {
        setPositionPulseKeys((prev) => {
          const next = { ...prev };
          Object.keys(newKeys).forEach((key) => {
            delete next[key];
          });
          return next;
        });
      }, 1000);
    }

    previousPositionsRef.current = [...currentPositions];
  }, [me, playerPositions, stage]);

  // ── Not joined yet ───────────────────────────────────────────────────────────
  if (!me) {
    // Has creds but lastMeRef not yet populated (very early reconnect) — hold.
    if (storedCreds.current) {
      return (
        <div style={styles.root}>
          <div style={{ ...styles.joinHeader, padding: '30px 20px 10px' }}>MKMGA</div>
          <div style={{ ...styles.joinWarning, margin: '0 20px' }}>Reconnecting…</div>
        </div>
      );
    }
    if (mode === 'joining') {
      return (
        <JoinForm
          onJoin={(data) => {
            setServerError(null);
            storedCreds.current = { realName: data.realName, password: data.password };
            socket.emit('join', data);
          }}
          onBack={() => { setMode('menu'); setServerError(null); }}
          error={serverError}
          maxCashCap={gameState.hostSettings?.maxCashCap}
        />
      );
    }
    if (mode === 'reconnecting') {
      return (
        <ReconnectForm
          players={gameState.players}
          onReconnect={(data) => {
            setServerError(null);
            storedCreds.current = { realName: data.realName, password: data.password };
            socket.emit('reconnect-player', data);
          }}
          onBack={() => { setMode('menu'); setServerError(null); }}
          error={serverError}
        />
      );
    }
    // Menu
    return (
      <div style={styles.root}>
        <div style={{ ...styles.joinHeader, padding: '30px 20px 10px' }}>MKMGA</div>
        {!canRegister && (
          <div style={{ ...styles.joinWarning, margin: '0 20px' }}>
            {inLobby && !gameState.hostSettings?.lobbyOpen
              ? 'Registration is closed — the game has not been started yet.'
              : 'Registration is closed — the game is already in progress.'}
          </div>
        )}
        {serverError && <div style={{ ...styles.joinWarning, margin: '0 20px' }}>{serverError}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '20px' }}>
          {canRegister && (
            <button style={styles.joinBtn} onClick={() => { setServerError(null); setMode('joining'); }}>
              Join Game
            </button>
          )}
          <button
            style={{ ...styles.joinBtn, background: '#3a3a1a', color: '#f0c040' }}
            onClick={() => { setServerError(null); setMode('reconnecting'); }}
          >
            Reconnect to Existing Account
          </button>
        </div>
      </div>
    );
  }

  const eliminationState = String(me.eliminationState || 'alive');
  const isPendingResurrection = eliminationState === 'pending_resurrection';
  const isFailedResurrection = eliminationState === 'failed_resurrection';
  const eliminationSummary = me.eliminationSummary || {};

  if (isPendingResurrection) {
    return (
      <div style={styles.eliminationScreen}>
        <div style={styles.eliminationTitle}>YOU HAVE BEEN ELIMINATED</div>
        <img src={DEATH_GIF_SRC} alt="Eliminated" style={styles.eliminationGifLarge} />
        <div style={styles.eliminationLine}>BUT <span className="elimination-gold-pulse">YOU STILL HAVE A CHANCE</span></div>
        <div style={styles.eliminationLine}>SEE THE BARTENDER FOR A POSSIBLE</div>
        <div style={styles.eliminationLine}><span className="elimination-gold-pulse">LUCKY BASTARD REVIVAL</span></div>
      </div>
    );
  }

  if (isFailedResurrection) {
    return (
      <div style={styles.eliminationScreen}>
        <div style={styles.eliminationTitle}>YOU HAVE BEEN ELIMINATED</div>
        <img src={DEATH_GIF_SRC} alt="Eliminated" style={styles.eliminationGifLarge} />
        <div style={styles.eliminationLine}>YOU SURVIVED {Number(eliminationSummary.survivedRaces ?? 0)} RACES</div>
        <div style={styles.eliminationLine}>YOU OUTLIVED {Number(eliminationSummary.outlivedPlayers ?? 0)} PLAYERS</div>
        <div style={styles.eliminationLine}>
          YOU GAMBLED AWAY <span style={styles.eliminationMoneyRed}>${Number(eliminationSummary.gambledAway ?? 0).toFixed(2)}</span>
        </div>
        <div style={styles.eliminationGoldLine}>YOU WILL HELP DECIDE WHO THE KING OF MKMGA IS!</div>
      </div>
    );
  }

  return (
    <div style={styles.root}>
      {/* Player HUD */}
      <div style={styles.playerHud}>
        <div style={styles.playerHudTopRow}>
          <div style={styles.playerHudName}>{me.displayName}</div>
          <MoneyTicker value={me.balance} style={styles.playerHudBalance} />
        </div>

        <div style={styles.playerHudGrid}>
          <div style={styles.playerHudStatCard}>
            <div style={styles.playerHudStatLabel}>Pot</div>
            <MoneyTicker value={gameState.pot} style={styles.playerHudStatValue} />
          </div>
          <div style={styles.playerHudStatCard}>
            <div style={styles.playerHudStatLabel}>You Put In</div>
            <MoneyTicker value={me.contributedThisRace ?? 0} style={styles.playerHudStatValue} />
          </div>
          <div style={{ ...styles.playerHudStatCard, ...(maxBetFlash ? styles.maxBetFlashCard : null) }}>
            <div style={styles.playerHudStatLabel}>Max Bet</div>
            <MoneyTicker value={betCap} style={{ ...styles.playerHudStatValue, ...(maxBetFlash ? styles.maxBetFlashValue : null) }} />
            {stage === 'BETTING' && betCapHint && (
              <div style={styles.betCapHint}>{betCapHint}</div>
            )}
          </div>
          <div style={styles.playerHudStatCard}>
            <div style={styles.playerHudStatLabel}>Skip/Fold Token</div>
            <div style={{ ...styles.playerHudStatValue, ...(me.skipFoldTokenAvailable ? styles.tokenReady : styles.tokenUsed) }}>
              {me.skipFoldTokenAvailable ? 'Ready' : 'Spent'}
            </div>
          </div>
        </div>

        <div style={styles.playerHudPositionsWrap}>
          <div style={styles.playerHudPositionsLabel}>Your Positions</div>
          {playerPositions.length > 0 ? (
            <div style={styles.playerHudPositionsRow}>
              {playerPositions.map((pos, index) => {
                const posKey = `${pos}-${index}`;
                return (
                <span
                  key={posKey}
                  className={positionPulseKeys[posKey] ? 'position-pill-select' : undefined}
                  style={styles.playerHudPositionPill}
                >
                  {pos}
                </span>
                );
              })}
            </div>
          ) : (
            <div style={styles.playerHudNoPositions}>No positions yet</div>
          )}
        </div>
      </div>

      {/* Full-width countdown strip — visible whenever any timer is active */}
      {activeTimer && (
        <div style={styles.timerStrip}>
          <div
            style={{
              ...styles.timerStripFill,
              width: `${Math.max(0, (activeTimer.timeLeft / (activeTimer.mode === 'betting' ? 60 : 30)) * 100)}%`,
              background: activeTimer.timeLeft <= 10 ? '#e74c3c' : activeTimer.timeLeft <= 20 ? '#e67e22' : '#2ecc71',
            }}
          />
          <span style={styles.timerStripLabel}>
            {activeTimer.playerId === me.id
              ? activeTimer.mode === 'cascade-response'
                ? `⚠️ RESPOND TO CASCADE — ${activeTimer.timeLeft}s or your peers decide!`
                : `⏱ YOUR TURN — ${activeTimer.timeLeft}s remaining`
              : activeTimer.mode === 'cascade-response'
              ? `⏳ ${gameState.players.find((p) => p.id === activeTimer.playerId)?.displayName ?? 'Someone'} deciding cascade… ${activeTimer.timeLeft}s`
              : `⏳ ${gameState.players.find((p) => p.id === activeTimer.playerId)?.displayName ?? 'Someone'} is deciding… ${activeTimer.timeLeft}s`}
          </span>
        </div>
      )}

      {errorMsg && <div style={styles.errorBanner}>{errorMsg}</div>}

      {/* LOBBY */}
      {stage === 'LOBBY' && (
        <div style={styles.phaseBox}>
          <div style={styles.phaseTitle}>Waiting for game to start…</div>
        </div>
      )}

      {/* PRE_BET */}
      {stage === 'PRE_BET' && (
        <div style={styles.phaseBox}>
          <div style={styles.phaseTitle}>Race {gameState.raceNumber} — Entry Phase</div>
          <div style={styles.phaseInfo}>
            Entry fee:{' '}
            <strong>
              {gameState.entryFee === 'ALL_IN' ? 'ALL IN' : `$${Number(gameState.entryFee).toFixed(2)}`}
            </strong>
          </div>
          {me.balance <= 0 ? (
            <div style={styles.phaseInfo}>You have been eliminated.</div>
          ) : me.paidEntry ? (
            <div style={styles.phaseInfo}>✅ Paid entry — waiting for others…</div>
          ) : me.skippedRace ? (
            <div style={styles.phaseInfo}>⏭ Skipping this race — waiting for others…</div>
          ) : (
            <div style={styles.actionRow}>
              <button style={styles.actionBtn} onClick={() => socket.emit('pre-bet-choice', { choice: 'PAY' })}>
                Pay Entry
              </button>
              {me.skipFoldTokenAvailable && (
                <button
                  style={{ ...styles.actionBtn, background: '#3a3a1a', color: '#f0c040' }}
                  onClick={() => socket.emit('pre-bet-choice', { choice: 'SKIP' })}
                >
                  Skip Race (use token)
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* POSITION_ASSIGNMENT */}
      {stage === 'POSITION_ASSIGNMENT' && (
        <div style={styles.phaseBox}>
          <div style={styles.phaseTitle}>Position Draft</div>

          {/* Cascade displacement prompt — shown when I was displaced by a cascade chain */}
          {iAmDisplacedInChain && (() => {
            const table = cascadeChain.nextMode === 'gentle' ? GENTLE_DNF_SLOTS : HARSH_DNF_SLOTS;
            const safeLevel = Math.min(cascadeChain.nextLevel, table.length - 1);
            const dnfSlots = table[safeLevel];
            const dnfPct = Math.round((dnfSlots / 13) * 100);
            const label = cascadeChain.nextMode === 'gentle'
              ? `Gentle Level ${safeLevel + 1}`
              : `Harsh Spin ${safeLevel + 1}`;
            return (
              <div style={{ ...styles.cascadeBox, borderColor: '#a03030', background: '#1a0808' }}>
                <div style={{ color: '#e74c3c', fontWeight: 'bold', fontSize: 18, marginBottom: 2 }}>
                  ⚠️ You were displaced to DNF!
                </div>
                <div style={{ ...styles.phaseInfo, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                  <span>{label} — {dnfSlots}/13 DNF slots ({dnfPct}% chance of DNF)</span>
                  <button
                    type="button"
                    style={styles.cascadeHelpBtn}
                    onClick={() => setShowDisplacedCascadeHelp((prev) => !prev)}
                  >
                    {showDisplacedCascadeHelp ? 'Hide' : 'What is cascade?'}
                  </button>
                </div>
                {showDisplacedCascadeHelp && (
                  <div style={styles.cascadeHelpText}>
                    Someone picked your position and chose to cascade. A wheel was spun — and it landed on
                    your position, displacing you to DNF. Now it&apos;s your turn: <strong>Cascade</strong> to
                    spin the wheel again and try to escape DNF (at the odds shown above), or{' '}
                    <strong>Accept DNF</strong> to lock in your DNF result.
                  </div>
                )}
                <div style={styles.actionRow}>
                  <button
                    style={{ ...styles.actionBtn, background: '#1a3a1a', color: '#2ecc71' }}
                    onClick={() => socket.emit('cascade-response', { cascade: true })}
                  >
                    🎡 Cascade
                  </button>
                  <button
                    style={{ ...styles.actionBtn, background: '#3a1a1a', color: '#e74c3c' }}
                    onClick={() => socket.emit('cascade-response', { cascade: false })}
                  >
                    ✋ Accept DNF
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Position vote overlay / normal pick UI */}
          {!iAmDisplacedInChain && (

          /* Cascade-response vote: other players vote on behalf of timed-out displaced player */
          cascadeResponseVote ? (
            cascadeResponseVote.timedOutPlayer === me.id ? (
              <div style={styles.voteWaitBox}>
                <div style={styles.voteWaitIcon}>⏳</div>
                <div style={styles.voteWaitTitle}>Your peers are deciding for you!</div>
                <div style={styles.voteWaitSub}>You took too long — others are voting whether to cascade or accept DNF on your behalf.</div>
                <div style={styles.voteCountdown}>{cascadeResponseVoteTimeLeft}s remaining</div>
                {(cascadeResponseVoteCounts.cascadeVotes > 0 || cascadeResponseVoteCounts.acceptVotes > 0) && (
                  <div style={styles.voteTally}>
                    <div style={styles.voteTallyRow}><span style={styles.voteTallyLabel}>🎡 Cascade</span><span style={styles.voteTallyCount}>{cascadeResponseVoteCounts.cascadeVotes}</span></div>
                    <div style={styles.voteTallyRow}><span style={styles.voteTallyLabel}>✋ Accept DNF</span><span style={styles.voteTallyCount}>{cascadeResponseVoteCounts.acceptVotes}</span></div>
                  </div>
                )}
              </div>
            ) : cascadeResponseVote.voters.includes(me.id) ? (
              myCascadeResponseVote ? (
                <div style={styles.voteWaitBox}>
                  <div style={styles.voteWaitTitle}>Voted: <strong>{myCascadeResponseVote === 'cascade' ? '🎡 Cascade' : '✋ Accept DNF'}</strong></div>
                  <div style={styles.voteCountdown}>{cascadeResponseVoteTimeLeft}s remaining</div>
                  {(cascadeResponseVoteCounts.cascadeVotes > 0 || cascadeResponseVoteCounts.acceptVotes > 0) && (
                    <div style={styles.voteTally}>
                      <div style={styles.voteTallyRow}><span style={styles.voteTallyLabel}>🎡 Cascade</span><span style={styles.voteTallyCount}>{cascadeResponseVoteCounts.cascadeVotes}</span></div>
                      <div style={styles.voteTallyRow}><span style={styles.voteTallyLabel}>✋ Accept DNF</span><span style={styles.voteTallyCount}>{cascadeResponseVoteCounts.acceptVotes}</span></div>
                    </div>
                  )}
                </div>
              ) : (
                <div style={styles.voteBox}>
                  <div style={styles.voteTitle}>
                    ⏱ Vote for{' '}
                    <strong>
                      {gameState.players.find((p) => p.id === cascadeResponseVote.timedOutPlayer)?.displayName ?? 'them'}
                    </strong>
                  </div>
                  <div style={styles.voteSub}>
                    They ran out of time — should they cascade or accept DNF? ({cascadeResponseVoteTimeLeft}s)
                  </div>
                  <div style={styles.actionRow}>
                    <button
                      style={{ ...styles.actionBtn, background: '#1a3a1a', color: '#2ecc71' }}
                      onClick={() => {
                        setMyCascadeResponseVote('cascade');
                        socket.emit('cascade-response-vote', { choice: 'cascade' });
                      }}
                    >
                      🎡 Cascade
                    </button>
                    <button
                      style={{ ...styles.actionBtn, background: '#3a1a1a', color: '#e74c3c' }}
                      onClick={() => {
                        setMyCascadeResponseVote('accept');
                        socket.emit('cascade-response-vote', { choice: 'accept' });
                      }}
                    >
                      ✋ Accept DNF
                    </button>
                  </div>
                </div>
              )
            ) : (
              <div style={styles.tvSpinPrompt}>⏳ Waiting for cascade response vote…</div>
            )
          ) :

          positionVote ? (
            positionVote.timedOutPlayer === me.id ? (
              /* I’m the timed-out player */
              <div style={styles.voteWaitBox}>
                <div style={styles.voteWaitIcon}>⏳</div>
                <div style={styles.voteWaitTitle}>Your peers are voting for your position{positionVote.picksNeeded > 1 ? 's' : ''}!</div>
                <div style={styles.voteWaitSub}>You took too long — other players are choosing {positionVote.picksNeeded} position{positionVote.picksNeeded > 1 ? 's' : ''} for you.</div>
                <div style={styles.voteCountdown}>{positionVoteTimeLeft}s remaining</div>
                {Object.keys(positionVoteCounts).length > 0 && (
                  <div style={styles.voteTally}>
                    {positionVote.options.map((pos) => (positionVoteCounts[pos] ?? 0) > 0 ? (
                      <div key={pos} style={styles.voteTallyRow}>
                        <span style={styles.voteTallyLabel}>P{pos}</span>
                        <span style={styles.voteTallyCount}>{positionVoteCounts[pos]}</span>
                      </div>
                    ) : null)}
                  </div>
                )}
              </div>
            ) : positionVote.voters.includes(me.id) ? (
              myPositionVote ? (
                /* Already voted */
                <div style={styles.voteWaitBox}>
                  <div style={styles.voteWaitTitle}>Voted: <strong>Position {myPositionVote}</strong></div>
                  <div style={styles.voteCountdown}>{positionVoteTimeLeft}s remaining</div>
                  {Object.keys(positionVoteCounts).length > 0 && (
                    <div style={styles.voteTally}>
                      {positionVote.options.map((pos) => (positionVoteCounts[pos] ?? 0) > 0 ? (
                        <div key={pos} style={styles.voteTallyRow}>
                          <span style={styles.voteTallyLabel}>P{pos}</span>
                          <span style={styles.voteTallyCount}>{positionVoteCounts[pos]}</span>
                        </div>
                      ) : null)}
                    </div>
                  )}
                </div>
              ) : (
                /* Cast your vote */
                <div style={styles.voteBox}>
                  <div style={styles.voteTitle}>
                    🗽 Vote for{' '}
                    <strong>
                      {gameState.players.find((p) => p.id === positionVote.timedOutPlayer)?.displayName ?? 'them'}
                    </strong>
                  </div>
                  <div style={styles.voteSub}>
                    They timed out — pick a position for them! ({positionVote.picksNeeded} pick{positionVote.picksNeeded > 1 ? 's' : ''} needed, {positionVoteTimeLeft}s)
                  </div>
                  <div style={styles.positionGrid}>
                    {positionVote.options.map((pos) => (
                      <button
                        key={pos}
                        style={{ ...styles.posBtn, background: pos === 'DNF' ? '#3a1a1a' : '#1a2a3a', color: pos === 'DNF' ? '#e74c3c' : '#4fc3f7' }}
                        onClick={() => {
                          socket.emit('position-vote', { position: pos });
                          setMyPositionVote(pos);
                        }}
                      >
                        {pos}
                      </button>
                    ))}
                  </div>
                </div>
              )
            ) : (
              <div style={styles.tvSpinPrompt}>👀 Look at the TV!</div>
            )
          ) : (
            /* Normal pick UI */
            !me.paidEntry ? (
              <div style={styles.phaseInfo}>You skipped this race.</div>
            ) : isMyPickTurn && myTimer ? (
            <>
              <div style={styles.phaseInfo}>Your turn! Pick {picksRemaining} position(s).</div>
              <div style={styles.positionGrid}>
                {availablePositions.map((pos) => {
                  const isDnf = pos === 'DNF';
                  const showGlow = isDnf && cascadeAvailable;
                  return (
                    <button
                      key={pos}
                      className={showGlow ? 'cascade-dnf-available' : undefined}
                      style={{
                        ...styles.posBtn,
                        background: isDnf ? (showGlow ? '#2a1500' : '#3a1a1a') : '#1a2a1a',
                        color: isDnf ? '#e74c3c' : '#fff',
                        border: showGlow ? '1px solid #ff6400' : '1px solid #444',
                      }}
                      onClick={() => {
                        if (isDnf && !cascadeSpent) {
                          setPendingDnf(true);
                        } else {
                          pickPosition(pos);
                        }
                      }}
                    >
                      {pos}
                    </button>
                  );
                })}
              </div>
              {pendingDnf && (
                <div style={styles.cascadeBox}>
                  <div style={{ ...styles.phaseInfo, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                    <strong style={{ color: '#fff' }}>You picked DNF. Attempt cascade?</strong>
                    <button
                      type="button"
                      style={styles.cascadeHelpBtn}
                      onClick={() => setShowCascadeHelp((prev) => !prev)}
                    >
                      {showCascadeHelp ? 'Hide explanation' : 'How cascade works'}
                    </button>
                  </div>
                  {showCascadeHelp && (
                    <div style={styles.cascadeHelpText}>
                      Cascade spins a wheel with DNF odds. If it lands on a numbered position, you take it.
                      If that position is already occupied, that player is displaced to DNF and may choose to
                      cascade next.
                    </div>
                  )}
                  <div style={{ ...styles.phaseInfo, fontSize: 13, color: '#aeb8c8' }}>
                    Cascade gives you a chance to escape DNF, but you might still land DNF.
                  </div>
                  <div style={styles.actionRow}>
                    <button style={styles.actionBtn} onClick={() => pickPosition('DNF', true)}>
                      Yes, cascade
                    </button>
                    <button
                      style={{ ...styles.actionBtn, background: '#333' }}
                      onClick={() => pickPosition('DNF', false)}
                    >
                      Keep DNF
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={styles.tvSpinPrompt}>👀 Look at the TV!</div>
          )
          ))}
        </div>
      )}

      {/* BETTING */}
      {stage === 'BETTING' && (
        <div style={styles.phaseBox}>
          <div style={styles.phaseTitle}>Betting Round</div>


          {/* ── Group vote is active ─────────────────────────────── */}
          {groupVote ? (
            groupVote.timedOutPlayer === me.id ? (
              /* I'm the timed-out player */
              <div style={styles.voteWaitBox}>
                <div style={styles.voteWaitIcon}>⏳</div>
                <div style={styles.voteWaitTitle}>Your peers are deciding for you</div>
                <div style={styles.voteWaitSub}>You took too long — other players are voting on your action.</div>
                <div style={styles.voteCountdown}>{voteTimeLeft}s remaining</div>
                {Object.keys(voteCounts).length > 0 && (
                  <div style={styles.voteTally}>
                    {groupVote.options.map((opt) => (
                      <div key={opt} style={styles.voteTallyRow}>
                        <span style={styles.voteTallyLabel}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</span>
                        <span style={styles.voteTallyCount}>{voteCounts[opt] ?? 0}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : groupVote.voters.includes(me.id) ? (
              /* I'm an eligible voter */
              myVote ? (
                <div style={styles.voteWaitBox}>
                  <div style={styles.voteWaitTitle}>Vote cast: <strong>{myVote.charAt(0).toUpperCase() + myVote.slice(1)}</strong></div>
                  <div style={styles.voteCountdown}>{voteTimeLeft}s remaining</div>
                  {Object.keys(voteCounts).length > 0 && (
                    <div style={styles.voteTally}>
                      {groupVote.options.map((opt) => (
                        <div key={opt} style={styles.voteTallyRow}>
                          <span style={styles.voteTallyLabel}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</span>
                          <span style={styles.voteTallyCount}>{voteCounts[opt] ?? 0}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div style={styles.voteBox}>
                  <div style={styles.voteTitle}>
                    🗳 Vote for{' '}
                    <strong>
                      {gameState.players.find((p) => p.id === groupVote.timedOutPlayer)?.displayName ?? 'them'}
                    </strong>
                  </div>
                  <div style={styles.voteSub}>They timed out — choose their action! ({voteTimeLeft}s)</div>
                  <div style={styles.actionCol}>
                    {groupVote.options.map((opt) => (
                      <button
                        key={opt}
                        style={{
                          ...styles.actionBtn,
                          background: opt === 'fold' ? '#3a1a1a' : '#1a3a1a',
                          color: opt === 'fold' ? '#e74c3c' : '#2ecc71',
                          fontSize: 18,
                          padding: '14px 20px',
                        }}
                        onClick={() => {
                          socket.emit('group-vote', { action: opt });
                          setMyVote(opt);
                        }}
                      >
                        {opt.charAt(0).toUpperCase() + opt.slice(1)}
                        {opt === 'fold' ? ' (uses their token)' : ''}
                      </button>
                    ))}
                  </div>
                </div>
              )
            ) : (
              <div style={styles.tvSpinPrompt}>👀 Look at the TV!</div>
            )
          ) : (
            /* ── Normal betting UI ───────────────────────────────── */
            me.allIn ? (
              <div style={forcedCallNotice ? styles.forcedCallPrompt : styles.tvSpinPrompt}>{bettingIdlePrompt}</div>
            ) : me.folded ? (
              <div style={forcedCallNotice ? styles.forcedCallPrompt : styles.tvSpinPrompt}>{bettingIdlePrompt}</div>
            ) : !me.paidEntry ? (
              <div style={styles.phaseInfo}>You skipped this race.</div>
            ) : isMyBetTurn ? (
              <div style={styles.actionCol}>
                {canCheck ? (
                  <button style={styles.actionBtn} onClick={() => socket.emit('betting-action', { action: 'check' })}>
                    Check
                  </button>
                ) : (
                  <button style={styles.actionBtn} onClick={() => socket.emit('betting-action', { action: 'call' })}>
                    Call ${Number(Math.min(currentBet - (me.roundBet ?? 0), me.balance)).toFixed(2)}
                  </button>
                )}
                {me.skipFoldTokenAvailable && (
                  <button
                    style={{ ...styles.actionBtn, background: '#3a1a1a' }}
                    onClick={() => socket.emit('betting-action', { action: 'fold' })}
                  >
                    Fold (use token)
                  </button>
                )}
                {canRaise && (
                  <div style={styles.raisePanel}>
                    <div style={styles.raiseInfo}>Tap chips to build your raise total.</div>
                    <div style={styles.raiseTotalDisplay}>
                      Raise to: <strong><MoneyTicker value={raiseTotal ?? minRaiseTo} /></strong>
                    </div>
                    <div style={styles.raiseChipRow}>
                      {raiseDenominations.map((chip) => (
                        <button
                          key={chip.label}
                          style={styles.raiseChipBtn}
                          onClick={() => addRaiseChip(chip.value)}
                          disabled={maxRaiseTo <= currentBet}
                        >
                          {chip.label}
                        </button>
                      ))}
                      <button
                        style={{ ...styles.raiseChipBtn, ...styles.raiseChipAllInBtn }}
                        onClick={() => setRaiseTotal(maxRaiseTo)}
                        disabled={maxRaiseTo <= currentBet}
                      >
                        ALL IN
                      </button>
                    </div>
                    <div style={styles.raiseActionsRow}>
                      <button
                        style={{ ...styles.actionBtn, ...(hasValidRaise ? null : styles.disabledBtn) }}
                        onClick={() => {
                          if (!hasValidRaise) {
                            if (maxBetFlashTimeoutRef.current) clearTimeout(maxBetFlashTimeoutRef.current);
                            setMaxBetFlash(true);
                            maxBetFlashTimeoutRef.current = setTimeout(() => {
                              setMaxBetFlash(false);
                              maxBetFlashTimeoutRef.current = null;
                            }, 700);
                            return;
                          }
                          socket.emit('betting-action', { action: 'raise', amount: raiseTotal });
                          setRaiseTotal(null);
                        }}
                      >
                        Raise
                      </button>
                      <button
                        style={styles.secondaryBtn}
                        onClick={() => setRaiseTotal(minRaiseTo)}
                        disabled={maxRaiseTo <= currentBet}
                      >
                        Reset
                      </button>
                    </div>
                    {maxRaiseTo <= currentBet && (
                      <div style={styles.phaseInfo}>No raise available at the current cap.</div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div style={forcedCallNotice ? styles.forcedCallPrompt : styles.tvSpinPrompt}>{bettingIdlePrompt}</div>
            )
          )}
        </div>
      )}

      {/* RACE_PENDING_RESULT */}
      {stage === 'RACE_PENDING_RESULT' && (
        <div style={styles.phaseBox}>
          <div style={styles.phaseTitle}>Race in Progress!</div>
          <div style={styles.tvSpinPrompt}>👀 Watch the race on the TV!</div>
        </div>
      )}

      {/* PAYOUT */}
      {stage === 'PAYOUT' && (
        <div style={styles.phaseBox}>
          <div style={styles.phaseTitle}>Race Result: {gameState.raceResult}</div>
          {me.positions?.includes(gameState.raceResult) ? (
            <div style={{ ...styles.phaseInfo, color: '#2ecc71' }}>🏆 You won this race!</div>
          ) : me.paidEntry ? (
            <div style={{ ...styles.phaseInfo, color: '#e74c3c' }}>Your positions didn't hit.</div>
          ) : (
            <div style={styles.phaseInfo}>You skipped this race.</div>
          )}
          <div style={styles.phaseInfo}>Waiting for next race…</div>
        </div>
      )}

      {/* GAME_OVER */}
      {stage === 'GAME_OVER' && (
        <div style={styles.phaseBox}>
          <div style={styles.phaseTitle}>Game Over!</div>
          {me.balance > 0 && (
            <div style={{ ...styles.phaseInfo, color: '#2ecc71' }}>🏆 You survived!</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── JoinForm ─────────────────────────────────────────────────────────────────
function JoinForm({ onJoin, onBack, error, maxCashCap }) {
  const [step, setStep] = useState('details'); // 'details' | 'drawing'
  const pendingData = useRef(null);
  const [formData, setFormData] = useState({
    displayName: '',
    realName: '',
    cashAmount: '',
    funStatement: '',
    password: '',
    favoriteColor: '#2a2a4a',
    profileImageUrl: '',
  });
  const [checks, setChecks] = useState({ rules: false, fairy: false, bibi: false, opcc: false, fy: false });
  const [localError, setLocalError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);

  const handleImageChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setLocalError(null);
    try {
      const body = new FormData();
      body.append('profileImage', file);
      const res = await fetch('/api/upload-profile', { method: 'POST', body });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Upload failed');
      }
      const { imageUrl } = await res.json();
      setFormData((prev) => ({ ...prev, profileImageUrl: imageUrl }));
      setPreviewUrl(imageUrl);
    } catch (err) {
      setLocalError(err.message || 'Image upload failed. Try a smaller file (max 5MB, JPEG/PNG/WebP).');
    } finally {
      setUploading(false);
    }
  };

  const allChecked = checks.rules && checks.fairy && checks.bibi && checks.opcc && checks.fy;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!/^#[0-9a-fA-F]{6}$/.test(formData.favoriteColor)) {
      setLocalError('Choose a valid color.');
      return;
    }
    if (!allChecked) {
      const uncheckedCount = [checks.rules, checks.fairy, checks.bibi, checks.opcc, checks.fy].filter(Boolean).length;
      const onlyOneLeft = uncheckedCount === 4;
      if (onlyOneLeft && !checks.rules) {
        setLocalError("You haven't agreed to the official rules. Read them or go home.");
        return;
      }
      if (onlyOneLeft && !checks.fairy) {
        setLocalError('You need to accept the fairy clause. No exceptions.');
        return;
      }
      if (onlyOneLeft && !checks.bibi) {
        setLocalError('Benjamin Netanyahu did nothing wrong. Acknowledge it.');
        return;
      }
      if (onlyOneLeft && !checks.opcc) {
        setLocalError('yeah, sure buddy.');
        return;
      }
      if (onlyOneLeft && !checks.fy) {
        setLocalError("You haven't said fuck you. Say it.");
        return;
      }
      setLocalError('You must check all boxes before joining.');
      return;
    }
    if (!formData.password.trim()) {
      const ok = window.confirm("Are you sure you don't want a password? Anyone can log into your account and make choices on your behalf during the game.");
      if (!ok) {
        return;
      }
    }
    setLocalError(null);
    const rawCash = parseFloat(String(formData.cashAmount).replace(/[^0-9.]/g, ''));
    setValidating(true);
    try {
      const res = await fetch('/api/validate-join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, cashAmount: rawCash }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLocalError(data.error || `Something went wrong (HTTP ${res.status}). Please try again.`);
        return;
      }
    } catch {
      setLocalError('Could not reach server. Please try again.');
      return;
    } finally {
      setValidating(false);
    }
    pendingData.current = { ...formData, cashAmount: rawCash };
    setStep('drawing');
  };

  const displayError = localError || error;

  if (step === 'drawing') {
    return (
      <DrawingPrompt
        onDone={(drawingData) => onJoin({ ...pendingData.current, ...drawingData })}
        onBack={() => setStep('details')}
      />
    );
  }

  return (
    <div style={styles.root}>
      <div style={styles.joinHeaderRow}>
        <div style={styles.joinHeader}>Join MKMGA</div>
        <button type="button" style={styles.backBtn} onClick={onBack}>← Back</button>
      </div>
      <form onSubmit={handleSubmit} style={styles.joinForm}>
        {displayError && (
          <div style={{ ...styles.joinWarning, marginBottom: 10 }}>{displayError}</div>
        )}

        {/* Profile picture */}
        <div style={styles.avatarRow}>
          <Avatar
            player={{ displayName: formData.displayName, realName: formData.realName, profileImageUrl: previewUrl, favoriteColor: formData.favoriteColor }}
            size={64}
            getFavoriteColor={(p) => (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(p?.favoriteColor || '').trim()) ? p.favoriteColor : '#2a2a4a')}
          />
          <label style={styles.avatarUploadBtn}>
            {uploading ? 'Uploading…' : previewUrl ? 'Change Photo' : 'Upload Photo (optional)'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: 'none' }}
              onChange={handleImageChange}
              disabled={uploading}
            />
          </label>
        </div>

        <input
          style={styles.joinInput}
          type="text"
          placeholder="Display Name"
          value={formData.displayName}
          onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
          required
        />
        <input
          style={styles.joinInput}
          type="text"
          placeholder="Real Name"
          value={formData.realName}
          onChange={(e) => setFormData({ ...formData, realName: e.target.value })}
          required
        />
        <input
          style={styles.joinInput}
          type="text"
          inputMode="decimal"
          placeholder={maxCashCap != null ? `Cash Amount (Max: $${Number(maxCashCap).toFixed(2)})` : 'Cash Amount (e.g. $21.00)'}
          value={formData.cashAmount}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9.]/g, '');
            setFormData({ ...formData, cashAmount: raw });
          }}
          onBlur={(e) => {
            const num = parseFloat(e.target.value.replace(/[^0-9.]/g, ''));
            if (!isNaN(num)) {
              setFormData((prev) => ({ ...prev, cashAmount: `$${num.toFixed(2)}` }));
            }
          }}
          onFocus={(e) => {
            const raw = e.target.value.replace(/[^0-9.]/g, '');
            setFormData((prev) => ({ ...prev, cashAmount: raw }));
          }}
          required
        />
        <input
          style={styles.joinInput}
          type="text"
          placeholder="Fun Statement (optional)"
          value={formData.funStatement}
          onChange={(e) => setFormData({ ...formData, funStatement: e.target.value })}
        />
        <div style={styles.colorPickerRow}>
          <label style={styles.colorPickerLabel} htmlFor="favoriteColorInput">Choose your favorite color</label>
          <div style={styles.colorPickerControlWrap}>
            <input
              id="favoriteColorInput"
              style={styles.colorPickerInput}
              type="color"
              value={formData.favoriteColor}
              onChange={(e) => setFormData({ ...formData, favoriteColor: e.target.value })}
            />
            <span style={styles.colorPickerValue}>{formData.favoriteColor.toUpperCase()}</span>
          </div>
        </div>
        <input
          style={styles.joinInput}
          type="password"
          placeholder="Password (optional)"
          value={formData.password}
          onChange={(e) => setFormData({ ...formData, password: e.target.value })}
        />

        <div style={styles.joinWarning}>
          ⚠️ You are responsible for keeping track of your own coins.
        </div>

        <label style={styles.checkLabel}>
          <input type="checkbox" checked={checks.rules} onChange={(e) => setChecks({ ...checks, rules: e.target.checked })} />
          I have read the MKMGA FUN ENFORCEMENT Players Handbook
        </label>
        <label style={styles.checkLabel}>
          <input type="checkbox" checked={checks.fairy} onChange={(e) => setChecks({ ...checks, fairy: e.target.checked })} />
          I accept that I like boys and I am ready to be a fairy
        </label>
        <label style={styles.checkLabel}>
          <input type="checkbox" checked={checks.bibi} onChange={(e) => setChecks({ ...checks, bibi: e.target.checked })} />
          Benjamin Netanyahu did nothing wrong
        </label>
        <label style={styles.checkLabel}>
          <input type="checkbox" checked={checks.opcc} onChange={(e) => setChecks({ ...checks, opcc: e.target.checked })} />
          OPCC release date 2036
        </label>
        <label style={styles.checkLabel}>
          <input type="checkbox" checked={checks.fy} onChange={(e) => setChecks({ ...checks, fy: e.target.checked })} />
          Fuck you
        </label>

        <button
          type="submit"
          disabled={validating}
          style={{
            ...styles.joinBtn,
            opacity: allChecked && !validating ? 1 : 0.4,
            cursor: allChecked && !validating ? 'pointer' : 'not-allowed',
            marginTop: 16,
          }}
        >
          {validating ? 'Checking…' : 'Join'}
        </button>
      </form>
    </div>
  );
}

// ── ReconnectForm ─────────────────────────────────────────────────────────────
function ReconnectForm({ players, onReconnect, onBack, error }) {
  const [selected, setSelected] = useState(null); // player object
  const [password, setPassword] = useState('');

  const getFavoriteColor = (player) => (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(player?.favoriteColor || '').trim()) ? player.favoriteColor : '#2a2a4a');

  const handleSubmit = (e) => {
    e.preventDefault();
    onReconnect({ realName: selected.realName, password: selected?.hasPassword ? password : '' });
  };

  // Step 2 — password input after selecting a player
  if (selected) {
    return (
      <div style={styles.root}>
        <div style={styles.joinHeaderRow}>
          <div style={styles.joinHeader}>Reconnect</div>
          <button type="button" style={styles.backBtn} onClick={() => { setSelected(null); setPassword(''); }}>← Back</button>
        </div>
        <div style={styles.rcSelectedCard}>
          <Avatar player={selected} size={72} getFavoriteColor={getFavoriteColor} />
          <div>
            <div style={styles.rcSelectedName}>{selected.displayName}</div>
            <div style={styles.rcSelectedReal}>{selected.realName}</div>
          </div>
        </div>
        <form onSubmit={handleSubmit} style={{ ...styles.joinForm, marginTop: 0 }}>
          {error && <div style={{ ...styles.joinWarning, marginBottom: 10 }}>{error}</div>}
          {selected.hasPassword ? (
            <input
              style={styles.joinInput}
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              required
            />
          ) : (
            <div style={styles.joinWarning}>
              This account has no password. Anyone can reconnect as this player.
            </div>
          )}
          <button type="submit" style={{ ...styles.joinBtn, marginTop: 16 }}>Reconnect</button>
        </form>
      </div>
    );
  }

  // Step 1 — pick a player card
  return (
    <div style={styles.root}>
      <div style={styles.joinHeaderRow}>
        <div style={styles.joinHeader}>Who are you?</div>
        <button type="button" style={styles.backBtn} onClick={onBack}>← Back</button>
      </div>
      {error && <div style={{ ...styles.joinWarning, margin: '0 20px 10px' }}>{error}</div>}
      <div style={styles.rcGrid}>
        {players.map((p) => {
          return (
            <button key={p.realName} style={styles.rcCard} onClick={() => setSelected(p)}>
              <Avatar player={p} size={64} getFavoriteColor={getFavoriteColor} />
              <div style={styles.rcCardDisplayName}>{p.displayName}</div>
              <div style={styles.rcCardRealName}>{p.realName}</div>
            </button>
          );
        })}
        {players.length === 0 && (
          <div style={{ color: '#888', textAlign: 'center', padding: '40px 20px' }}>No players found.</div>
        )}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = {
  root: {
    minHeight: '100vh',
    background: '#0d0d0d',
    color: '#fff',
    fontFamily: "'Segoe UI', sans-serif",
    display: 'flex',
    flexDirection: 'column',
  },
  eliminationScreen: {
    minHeight: '100vh',
    background: 'radial-gradient(circle at 50% 0%, #2a1313 0%, #130909 48%, #050505 100%)',
    color: '#fff',
    fontFamily: "'Segoe UI', sans-serif",
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    gap: 14,
    padding: '24px 18px',
  },
  eliminationTitle: {
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 1.1,
    lineHeight: 1.15,
    color: '#fff',
    textTransform: 'uppercase',
    textShadow: '0 0 18px rgba(255, 90, 90, 0.45)',
  },
  eliminationGifLarge: {
    width: 'min(78vw, 320px)',
    aspectRatio: '1 / 1',
    objectFit: 'cover',
    borderRadius: 16,
  },
  eliminationLine: {
    fontSize: 21,
    fontWeight: '800',
    lineHeight: 1.25,
    textTransform: 'uppercase',
  },
  eliminationGoldLine: {
    fontSize: 20,
    fontWeight: '900',
    lineHeight: 1.25,
    textTransform: 'uppercase',
    color: '#f0c040',
  },
  eliminationMoneyRed: {
    color: '#e74c3c',
    fontWeight: '900',
  },
  // ── Join / Reconnect screens
  joinHeaderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '24px 20px 10px',
  },
  joinHeader: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#f0c040',
    letterSpacing: 1,
  },
  backBtn: {
    background: '#7a1a1a',
    color: '#fff',
    border: 'none',
    fontWeight: 'bold',
    fontSize: 14,
    borderRadius: 6,
    padding: '8px 14px',
    cursor: 'pointer',
  },
  joinForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: '0 20px 30px',
  },
  joinInput: {
    background: '#1a1a1a',
    border: '1px solid #333',
    borderRadius: 6,
    color: '#fff',
    fontSize: 16,
    padding: '10px 12px',
  },
  colorPickerRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    background: '#121212',
    border: '1px solid #2a2a2a',
    borderRadius: 6,
    padding: '9px 12px',
  },
  colorPickerLabel: {
    fontSize: 13,
    color: '#9fb3c8',
  },
  colorPickerControlWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  colorPickerInput: {
    width: 44,
    height: 32,
    border: '1px solid #3a3a3a',
    borderRadius: 6,
    background: 'transparent',
    padding: 0,
    cursor: 'pointer',
  },
  colorPickerValue: {
    fontFamily: 'monospace',
    color: '#d7e4f2',
    fontSize: 13,
  },
  joinWarning: {
    background: '#2a1a00',
    border: '1px solid #664400',
    borderRadius: 6,
    color: '#f0a040',
    fontSize: 13,
    padding: '8px 12px',
  },
  checkLabel: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    color: '#ccc',
    fontSize: 13,
    cursor: 'pointer',
  },
  joinBtn: {
    background: '#1a3a1a',
    color: '#2ecc71',
    border: 'none',
    borderRadius: 8,
    fontSize: 18,
    fontWeight: 'bold',
    padding: '14px',
    cursor: 'pointer',
  },
  // ── Reconnect card picker
  rcGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 14,
    padding: '16px 20px',
  },
  rcCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    background: '#1a1a2e',
    border: '2px solid #333',
    borderRadius: 12,
    padding: '16px 10px',
    cursor: 'pointer',
    color: '#fff',
    fontFamily: "'Segoe UI', sans-serif",
    transition: 'border-color 0.15s',
  },
  rcCardAvatar: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    objectFit: 'cover',
    border: '2px solid #555',
  },
  rcAvatarFallback: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#2a2a4a',
    color: '#f0c040',
    fontSize: 26,
    fontWeight: 'bold',
  },
  rcCardDisplayName: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#f0c040',
    textAlign: 'center',
    wordBreak: 'break-word',
  },
  rcCardRealName: {
    fontSize: 12,
    color: '#aaa',
    textAlign: 'center',
    wordBreak: 'break-word',
  },
  rcSelectedCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    background: '#1a1a2e',
    border: '2px solid #f0c040',
    borderRadius: 12,
    padding: '16px 20px',
    margin: '0 20px 20px',
  },
  rcSelectedAvatar: {
    width: 72,
    height: 72,
    borderRadius: '50%',
    objectFit: 'cover',
    border: '2px solid #f0c040',
    flexShrink: 0,
  },
  rcSelectedName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#f0c040',
  },
  rcSelectedReal: {
    fontSize: 13,
    color: '#aaa',
    marginTop: 2,
  },
  avatarRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '4px 0',
  },
  avatarPreview: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    objectFit: 'cover',
    border: '2px solid #444',
    flexShrink: 0,
  },
  avatarPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    background: '#222',
    border: '2px solid #444',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 28,
    color: '#555',
    flexShrink: 0,
  },
  avatarUploadBtn: {
    background: '#1a2a3a',
    color: '#4fc3f7',
    border: '1px solid #2a4a5a',
    borderRadius: 6,
    fontSize: 14,
    padding: '8px 14px',
    cursor: 'pointer',
  },
  // ── In-game screens
  playerHud: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: '12px 14px',
    background: 'linear-gradient(180deg, #121212 0%, #0f141b 100%)',
    borderBottom: '1px solid #273446',
  },
  playerHudTopRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 12,
  },
  playerHudName: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#f0c040',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  playerHudBalance: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2ecc71',
    letterSpacing: 0.2,
    fontVariantNumeric: 'tabular-nums',
  },
  playerHudMoneyWrap: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  },
  moneyTicketBadge: {
    display: 'inline-block',
    fontSize: 15,
    lineHeight: 1,
  },
  inlineMoneyTicket: {
    display: 'inline-block',
    fontSize: 13,
    lineHeight: 1,
  },
  playerHudGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 8,
  },
  playerHudStatCard: {
    background: '#131a23',
    border: '1px solid #2a3f58',
    borderRadius: 9,
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  playerHudStatLabel: {
    fontSize: 11,
    color: '#89a2be',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  playerHudStatValue: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#e8f2ff',
    fontVariantNumeric: 'tabular-nums',
  },
  tokenReady: {
    color: '#2ecc71',
  },
  tokenUsed: {
    color: '#e74c3c',
  },
  betCapHint: {
    fontSize: 11,
    color: 'rgba(138, 162, 190, 0.55)',
    marginTop: 2,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  maxBetFlashCard: {
    border: '1px solid #e74c3c',
    background: '#1f0a0a',
    transition: 'border-color 0.1s, background 0.1s',
  },
  maxBetFlashValue: {
    color: '#e74c3c',
    transition: 'color 0.1s',
  },
  playerHudPositionsWrap: {
    background: '#10161f',
    border: '1px solid #2a3f58',
    borderRadius: 9,
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  playerHudPositionsLabel: {
    fontSize: 11,
    color: '#89a2be',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  playerHudPositionsRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  },
  playerHudPositionPill: {
    background: '#1c2b3d',
    color: '#9dd7ff',
    border: '1px solid #376086',
    borderRadius: 999,
    padding: '4px 10px',
    fontSize: 13,
    fontWeight: 'bold',
    minWidth: 34,
    textAlign: 'center',
  },
  playerHudNoPositions: {
    color: '#70869f',
    fontSize: 13,
  },
  // ── Timer badge (center of header)
  timerBadge: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    border: '2px solid',
    borderRadius: 10,
    padding: '3px 16px',
    minWidth: 60,
    transition: 'border-color 0.3s, background 0.3s',
  },
  timerBadgeNum: {
    fontSize: 28,
    fontWeight: 'bold',
    lineHeight: 1,
    transition: 'color 0.3s',
    fontVariantNumeric: 'tabular-nums',
  },
  timerBadgeLabel: {
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 1,
    transition: 'color 0.3s',
  },
  errorBanner: {
    background: '#3a0000',
    color: '#ff6b6b',
    padding: '10px 20px',
    fontSize: 14,
    borderBottom: '1px solid #660000',
  },
  // ── Full-width timer strip (below header)
  timerStrip: {
    position: 'relative',
    height: 36,
    background: '#0a0a0a',
    borderBottom: '1px solid #222',
    overflow: 'hidden',
    flexShrink: 0,
  },
  timerStripFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: '100%',
    transition: 'width 0.85s linear, background 0.3s',
    opacity: 0.35,
  },
  timerStripLabel: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    fontSize: 13,
    fontWeight: 'bold',
    color: '#fff',
    whiteSpace: 'nowrap',
    letterSpacing: 0.5,
  },
  // ── Debug box
  debugBox: {
    background: '#0a0a20',
    border: '1px solid #2244aa',
    color: '#8899ff',
    fontSize: 11,
    padding: '6px 14px',
    lineHeight: 1.6,
    fontFamily: 'monospace',
    flexShrink: 0,
  },
  phaseBox: {
    padding: '24px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  phaseTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#f0c040',
  },
  phaseInfo: {
    fontSize: 15,
    color: '#ccc',
    lineHeight: 1.5,
  },
  actionRow: {
    display: 'flex',
    gap: 12,
    flexWrap: 'wrap',
  },
  actionCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  actionBtn: {
    background: '#1a3a1a',
    color: '#2ecc71',
    border: 'none',
    borderRadius: 8,
    fontSize: 16,
    fontWeight: 'bold',
    padding: '12px 20px',
    cursor: 'pointer',
  },
  positionGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  posBtn: {
    color: '#fff',
    border: '1px solid #444',
    borderRadius: 6,
    fontSize: 16,
    fontWeight: 'bold',
    padding: '10px 16px',
    cursor: 'pointer',
    minWidth: 52,
  },
  cascadeBox: {
    background: '#1a1a2a',
    border: '1px solid #335',
    borderRadius: 8,
    padding: '14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  cascadeHelpBtn: {
    background: '#1a2a3f',
    color: '#9dc0ff',
    border: '1px solid #3c5f8a',
    borderRadius: 999,
    padding: '6px 10px',
    fontSize: 12,
    fontWeight: 'bold',
    cursor: 'pointer',
    flexShrink: 0,
  },
  cascadeHelpText: {
    background: '#111827',
    border: '1px solid #30445f',
    borderRadius: 8,
    padding: '10px 12px',
    color: '#c7d6ea',
    fontSize: 13,
    lineHeight: 1.4,
  },
  tvSpinPrompt: {
    background: '#162338',
    border: '1px solid #2b4f7a',
    borderRadius: 8,
    color: '#8fc7ff',
    fontSize: 16,
    fontWeight: 'bold',
    padding: '12px 14px',
    textAlign: 'center',
  },
  forcedCallPrompt: {
    background: '#2b2209',
    border: '1px solid #9a7a2e',
    borderRadius: 8,
    color: '#f0c040',
    fontSize: 15,
    fontWeight: 'bold',
    padding: '12px 14px',
    textAlign: 'center',
  },
  raisePanel: {
    background: '#14141a',
    border: '1px solid #2b2b35',
    borderRadius: 10,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  raiseInfo: {
    fontSize: 13,
    color: '#8ea0b2',
  },
  raiseTotalDisplay: {
    fontSize: 16,
    color: '#d2d8e0',
  },
  raiseChipRow: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
  },
  raiseChipBtn: {
    background: '#1a2a3a',
    border: '1px solid #32526a',
    borderRadius: 6,
    color: '#7fc8ff',
    fontWeight: 'bold',
    minWidth: 66,
    fontSize: 16,
    padding: '10px 12px',
    cursor: 'pointer',
  },
  raiseChipAllInBtn: {
    background: '#3a1a1a',
    border: '1px solid #7a2a2a',
    color: '#ff9d9d',
    minWidth: 92,
  },
  raiseActionsRow: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
  },
  secondaryBtn: {
    background: '#2a2a2a',
    color: '#bbb',
    border: '1px solid #3a3a3a',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 'bold',
    padding: '10px 14px',
    cursor: 'pointer',
  },
  disabledBtn: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  // ── Group vote (voter)
  voteBox: {
    background: '#1a1a2e',
    border: '2px solid #4444aa',
    borderRadius: 10,
    padding: '18px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  voteTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#a0a0ff',
  },
  voteSub: {
    fontSize: 13,
    color: '#888',
  },
  // ── Group vote (timed-out / waiting)
  voteWaitBox: {
    background: '#1a0a0a',
    border: '2px solid #884444',
    borderRadius: 10,
    padding: '18px 16px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    textAlign: 'center',
  },
  voteWaitIcon: { fontSize: 36 },
  voteWaitTitle: { fontSize: 18, fontWeight: 'bold', color: '#e07070' },
  voteWaitSub: { fontSize: 13, color: '#888' },
  voteCountdown: { fontSize: 22, fontWeight: 'bold', color: '#f0c040', marginTop: 4 },
  voteTally: {
    display: 'flex',
    gap: 16,
    marginTop: 6,
    justifyContent: 'center',
  },
  voteTallyRow: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
  },
  voteTallyLabel: { fontSize: 12, color: '#888', textTransform: 'uppercase' },
  voteTallyCount: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
};

export default PlayerView;
