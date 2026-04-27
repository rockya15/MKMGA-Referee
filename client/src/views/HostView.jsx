import { useState, useEffect, useRef, useCallback } from 'react';
import SpinningWheel from '../components/SpinningWheel';
import MoneyTicker from '../components/MoneyTicker';
import MoneyDelta from '../components/MoneyDelta';

// Which stages show the wheel panel
const WHEEL_STAGES = ['POSITION_ASSIGNMENT'];
const CASCADE_PRE_SPIN_DELAY_MS = 5000;
const ACTIVE_PANEL_TRANSITION_MS = 760;
// How long to hold the cascade result on-screen before telling the server the spin is done.
// For DNF (no displaced player) this is the full hold; for swaps the displaced player's
// response is what eventually clears the card anyway.
const CASCADE_RESULT_HOLD_MS = 7000;

function PresenceSlide({ show, direction = 'down', duration = 760, children, style }) {
  const [shouldRender, setShouldRender] = useState(show);
  const [phase, setPhase] = useState(show ? 'enter' : 'hidden');

  useEffect(() => {
    let timeout;
    if (show) {
      setShouldRender(true);
      setPhase('pre-enter');
      requestAnimationFrame(() => setPhase('enter'));
    } else if (shouldRender) {
      setPhase('exit');
      timeout = setTimeout(() => setShouldRender(false), duration);
    }
    return () => clearTimeout(timeout);
  }, [show, shouldRender, duration]);

  if (!shouldRender) return null;

  const offsets = {
    left: 'translate3d(-10vw, 0, 0)',
    right: 'translate3d(10vw, 0, 0)',
    up: 'translate3d(0, -10vh, 0)',
    down: 'translate3d(0, 10vh, 0)',
  };
  const entering = phase === 'pre-enter';
  const exiting = phase === 'exit';

  return (
    <div
      style={{
        opacity: entering || exiting ? 0 : 1,
        transform: entering || exiting ? offsets[direction] : 'translate3d(0, 0, 0)',
        transition: `transform ${duration}ms cubic-bezier(0.21, 0.72, 0.2, 1), opacity ${duration}ms ease`,
        willChange: 'transform, opacity',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function ActiveElementFrame({ ready, children }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        opacity: ready ? 1 : 0,
        transform: ready ? 'translate3d(0,0,0)' : 'translate3d(0,10px,0)',
        transition: 'opacity 900ms ease, transform 900ms ease',
        willChange: 'opacity, transform',
      }}
    >
      {children}
    </div>
  );
}

function VoteActiveElement({ players, groupVote, voteResult, voteTimeLeft, voteCounts, positionVote, positionVoteResult, positionVoteTimeLeft }) {
  if (groupVote || voteResult) {
    if (voteResult) {
      return (
        <div style={styles.voteResultBanner}>
          Vote resolved - <strong>{players.find((p) => p.id === voteResult.timedOutPlayer)?.displayName ?? 'Player'}</strong> will <strong>{voteResult.result.toUpperCase()}</strong>
        </div>
      );
    }
    return (
      <div style={styles.votePanel}>
        <div style={styles.votePanelTitle}>
          GROUP VOTE - <span style={{ color: '#e07070' }}>{players.find((p) => p.id === groupVote.timedOutPlayer)?.displayName ?? 'Player'}</span> timed out
        </div>
        <div style={styles.votePanelSub}>Other players are voting... {voteTimeLeft}s remaining</div>
        <div style={styles.votePanelTimerBarWrap}>
          <div
            style={{
              ...styles.votePanelTimerBarFill,
              width: `${(voteTimeLeft / 30) * 100}%`,
              background: voteTimeLeft <= 10 ? '#e74c3c' : '#f0c040',
            }}
          />
        </div>
        <div style={styles.votePanelTally}>
          {groupVote.options.map((opt) => (
            <div key={opt} style={styles.votePanelTallyCell}>
              <div style={styles.votePanelTallyCount}>{voteCounts[opt] ?? 0}</div>
              <div style={styles.votePanelTallyLabel}>{opt.toUpperCase()}</div>
            </div>
          ))}
        </div>
        <div style={styles.votePanelVoters}>{groupVote.voters.length} eligible voter{groupVote.voters.length !== 1 ? 's' : ''}</div>
      </div>
    );
  }

  if (positionVote || positionVoteResult) {
    if (positionVoteResult) {
      return (
        <div style={styles.voteResultBanner}>
          Position vote resolved - <strong>{players.find((p) => p.id === positionVoteResult.timedOutPlayer)?.displayName ?? 'Player'}</strong> assigned: <strong>{positionVoteResult.assignedPositions.join(', ')}</strong>
        </div>
      );
    }
    return (
      <div style={{ ...styles.votePanel, borderColor: '#cc8844', boxShadow: '0 0 40px rgba(200,140,80,0.5)' }}>
        <div style={{ ...styles.votePanelTitle, color: '#ffaa55' }}>
          POSITION VOTE - <span style={{ color: '#e07070' }}>{players.find((p) => p.id === positionVote.timedOutPlayer)?.displayName ?? 'Player'}</span> timed out ({positionVote.picksNeeded} pick{positionVote.picksNeeded > 1 ? 's' : ''} needed)
        </div>
        <div style={styles.votePanelSub}>Players are voting on their position{positionVote.picksNeeded > 1 ? 's' : ''}... {positionVoteTimeLeft}s remaining</div>
        <div style={styles.votePanelTimerBarWrap}>
          <div
            style={{
              ...styles.votePanelTimerBarFill,
              width: `${(positionVoteTimeLeft / 30) * 100}%`,
              background: positionVoteTimeLeft <= 10 ? '#e74c3c' : '#e67e22',
            }}
          />
        </div>
        <div style={styles.votePanelVoters}>{positionVote.voters.length} eligible voter{positionVote.voters.length !== 1 ? 's' : ''}</div>
      </div>
    );
  }

  return null;
}

function HostView({ gameState, socket }) {
  const { currentStage, players, wheelOrder, positionDraft, pot, raceNumber, entryFee } = gameState;

  const [groupVote, setGroupVote] = useState(null);
  const [voteTimeLeft, setVoteTimeLeft] = useState(0);
  const [voteCounts, setVoteCounts] = useState({});
  const [voteResult, setVoteResult] = useState(null);

  const [activeTimer, setActiveTimer] = useState(null);
  const [positionVote, setPositionVote] = useState(null);
  const [positionVoteTimeLeft, setPositionVoteTimeLeft] = useState(0);
  const [positionVoteCounts, setPositionVoteCounts] = useState({});
  const [positionVoteResult, setPositionVoteResult] = useState(null);

  const [cascadeSpinData, setCascadeSpinData] = useState(null);
  const [cascadeSpinning, setCascadeSpinning] = useState(false);
  const [cascadeSpinResult, setCascadeSpinResult] = useState(null);
  const cascadeSpinDataRef = useRef(null);
  const cascadeSpinStartTimeoutRef = useRef(null);
  const cascadeResultHoldTimeoutRef = useRef(null);

  const clearCascadeSpinStartTimeout = useCallback(() => {
    if (cascadeSpinStartTimeoutRef.current) {
      clearTimeout(cascadeSpinStartTimeoutRef.current);
      cascadeSpinStartTimeoutRef.current = null;
    }
  }, []);

  const clearCascadeResultHoldTimeout = useCallback(() => {
    if (cascadeResultHoldTimeoutRef.current) {
      clearTimeout(cascadeResultHoldTimeoutRef.current);
      cascadeResultHoldTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    const onTimerUpdate = (data) => setActiveTimer(data);
    const onTimerClear = () => setActiveTimer(null);
    socket.on('timer-update', onTimerUpdate);
    socket.on('timer-clear', onTimerClear);
    return () => {
      socket.off('timer-update', onTimerUpdate);
      socket.off('timer-clear', onTimerClear);
    };
  }, [socket]);

  useEffect(() => {
    const onPosVoteStart = (data) => {
      setPositionVote(data);
      setPositionVoteTimeLeft(data.endsInSeconds);
      setPositionVoteCounts({});
      setPositionVoteResult(null);
    };
    const onPosVoteResult = (data) => {
      setPositionVoteResult(data);
      setPositionVote(null);
      setPositionVoteTimeLeft(0);
      setTimeout(() => setPositionVoteResult(null), 4000);
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
    const onCascadeSpin = ({ targetPosition, mode, level, dnfSlots, roll, segments, initiatorName, forcedDnf, token }) => {
      if (currentStage !== 'POSITION_ASSIGNMENT') return;
      const segs = Array.isArray(segments) && segments.length === 13 ? segments : (() => {
        const fallback = new Array(13).fill(null);
        fallback[roll - 1] = targetPosition;
        const used = new Set(targetPosition !== 'DNF' ? [targetPosition] : []);
        let fillNum = 1;
        for (let i = 0; i < 13; i++) {
          if (fallback[i] !== null) continue;
          while (used.has(String(fillNum))) fillNum++;
          fallback[i] = String(fillNum);
          used.add(String(fillNum++));
        }
        return fallback;
      })();
      const palette = ['#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#e91e63', '#00bcd4', '#8bc34a', '#ff5722', '#607d8b', '#795548'];
      const segColors = segs.map((s) => (s === 'DNF' ? '#e74c3c' : palette.shift() ?? '#888'));
      const spinData = {
        targetPosition,
        mode,
        level,
        dnfSlots,
        initiatorName,
        forcedDnf,
        token,
        segments: segs.map((label, i) => ({ id: i, label })),
        segmentColors: segColors,
        targetIndex: roll - 1,
      };
      clearCascadeSpinStartTimeout();
      cascadeSpinDataRef.current = spinData;
      setWheelSpawnKey((k) => k + 1);
      setCascadeSpinData(spinData);
      setCascadeSpinning(false);
      setCascadeSpinResult(null);
      cascadeSpinStartTimeoutRef.current = setTimeout(() => {
        if (cascadeSpinDataRef.current?.token !== spinData.token) return;
        setCascadeSpinning(true);
        cascadeSpinStartTimeoutRef.current = null;
      }, CASCADE_PRE_SPIN_DELAY_MS);
    };
    socket.on('cascade-spin', onCascadeSpin);
    return () => socket.off('cascade-spin', onCascadeSpin);
  }, [socket, currentStage, clearCascadeSpinStartTimeout]);

  useEffect(() => {
    if (currentStage !== 'POSITION_ASSIGNMENT') {
      clearCascadeSpinStartTimeout();
      clearCascadeResultHoldTimeout();
      setCascadeSpinData(null);
      setCascadeSpinning(false);
      setCascadeSpinResult(null);
      cascadeSpinDataRef.current = null;
    }
  }, [currentStage, clearCascadeSpinStartTimeout, clearCascadeResultHoldTimeout]);

  useEffect(() => () => {
    clearCascadeSpinStartTimeout();
    clearCascadeResultHoldTimeout();
  }, [clearCascadeSpinStartTimeout, clearCascadeResultHoldTimeout]);

  useEffect(() => {
    const onVoteStart = (data) => {
      setGroupVote(data);
      setVoteTimeLeft(data.endsInSeconds);
      setVoteCounts({});
      setVoteResult(null);
    };
    const onVoteResult = (data) => {
      setVoteResult(data);
      setGroupVote(null);
      setVoteTimeLeft(0);
      setTimeout(() => setVoteResult(null), 4000);
    };
    const onVoteTimerUpdate = ({ timeLeft }) => setVoteTimeLeft(timeLeft);
    const onVoteUpdate = ({ voteCounts: vc }) => setVoteCounts(vc);
    socket.on('group-vote-start', onVoteStart);
    socket.on('group-vote-result', onVoteResult);
    socket.on('vote-timer-update', onVoteTimerUpdate);
    socket.on('vote-update', onVoteUpdate);
    return () => {
      socket.off('group-vote-start', onVoteStart);
      socket.off('group-vote-result', onVoteResult);
      socket.off('vote-timer-update', onVoteTimerUpdate);
      socket.off('vote-update', onVoteUpdate);
    };
  }, [socket]);

  const [segments, setSegments] = useState([]);
  const [targetIndex, setTargetIndex] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [pickerName, setPickerName] = useState(null);
  const [pickerPlayer, setPickerPlayer] = useState(null);
  const [highlightIndex, setHighlightIndex] = useState(null);
  const [wheelOpacity, setWheelOpacity] = useState(1);
  const [avatarScale, setAvatarScale] = useState(0.3);
  const [avatarOpacity, setAvatarOpacity] = useState(0);
  const [wheelSpawnKey, setWheelSpawnKey] = useState(0);
  const [activeElementReady, setActiveElementReady] = useState(false);
  const [leaderboardExpanded, setLeaderboardExpanded] = useState(!WHEEL_STAGES.includes(currentStage));
  const leaderboardRef = useRef(null);
  const rowRefs = useRef(new Map());
  const autoScrollDirectionRef = useRef(1);
  const autoScrollRafRef = useRef(null);
  const autoScrollLastTsRef = useRef(0);

  const prevPickerIndexRef = useRef(null);
  const positionDraftRef = useRef(positionDraft);
  useEffect(() => { positionDraftRef.current = positionDraft; }, [positionDraft]);
  const wheelOrderRef = useRef(wheelOrder);
  useEffect(() => { wheelOrderRef.current = wheelOrder; }, [wheelOrder]);
  const playersRef = useRef(players);
  useEffect(() => { playersRef.current = players; }, [players]);

  const revealPicker = useCallback((player, winnerSegIndex) => {
    socket.emit('spin-complete');
    setPickerName(player?.displayName ?? null);
    setPickerPlayer(player ?? null);
    if (winnerSegIndex !== null) setHighlightIndex(winnerSegIndex);
    const holdMs = winnerSegIndex !== null ? 1000 : 0;
    setTimeout(() => {
      setWheelOpacity(0);
      setTimeout(() => {
        setAvatarOpacity(1);
        setAvatarScale(1);
      }, 400);
    }, holdMs);
  }, [socket]);

  useEffect(() => {
    if (currentStage !== 'POSITION_ASSIGNMENT') {
      prevPickerIndexRef.current = null;
      setSpinning(false);
      setSegments([]);
      setPickerName(null);
      return;
    }
    const draft = positionDraftRef.current;
    const order = wheelOrderRef.current;
    const allPlayers = playersRef.current;
    if (!draft || !order) {
      prevPickerIndexRef.current = null;
      setSpinning(false);
      setSegments([]);
      setPickerName(null);
      return;
    }

    const newSegments = order
      .filter((id) => (draft.remainingByPlayer?.[id] ?? 0) > 0)
      .map((id) => {
        const p = allPlayers.find((pl) => pl.id === id);
        return {
          id,
          label: p?.displayName ?? id,
          imageUrl: p?.profileImageUrl ?? null,
          color: getFavoriteColor(p),
        };
      });
    const currentPickerId = order[draft.currentPlayerIndex] ?? null;
    const currentPlayer = allPlayers.find((p) => p.id === currentPickerId) ?? null;
    const skipAndReveal = () => {
      setSpinning(false);
      setWheelOpacity(0);
      setAvatarScale(0.3);
      setAvatarOpacity(0);
      setPickerPlayer(null);
      setPickerName(null);
      setHighlightIndex(null);
      setTimeout(() => revealPicker(currentPlayer, null), 50);
    };

    if (prevPickerIndexRef.current === null || draft.currentPlayerIndex !== prevPickerIndexRef.current) {
      prevPickerIndexRef.current = draft.currentPlayerIndex;
      setSegments(newSegments);
      const idx = newSegments.findIndex((s) => s.id === currentPickerId);
      setTargetIndex(Math.max(0, idx));
      setPickerName(null);
      if (newSegments.length <= 1) {
        skipAndReveal();
      } else {
        setCascadeSpinData(null);
        setCascadeSpinning(false);
        setCascadeSpinResult(null);
        cascadeSpinDataRef.current = null;
        setWheelSpawnKey((k) => k + 1);
        setSpinning(true);
      }
    }
  }, [currentStage, positionDraft?.currentPlayerIndex, revealPicker]);

  useEffect(() => {
    if (spinning) {
      setWheelOpacity(1);
      setAvatarScale(0.3);
      setAvatarOpacity(0);
      setPickerPlayer(null);
      setPickerName(null);
      setHighlightIndex(null);
    }
  }, [spinning]);

  const handleSpinComplete = useCallback(() => {
    setSpinning(false);
    const draft = positionDraftRef.current;
    const order = wheelOrderRef.current;
    const allPlayers = playersRef.current;
    const currentPickerId = order?.[draft?.currentPlayerIndex] ?? null;
    const player = allPlayers.find((p) => p.id === currentPickerId) ?? null;
    revealPicker(player, targetIndex);
  }, [targetIndex, revealPicker]);

  const sortedPlayers = [...players].sort((a, b) => b.balance - a.balance);
  const getFavoriteColor = (player) => {
    const raw = String(player?.favoriteColor || '').trim();
    return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw) ? raw : '#2a2a4a';
  };
  const wheelSegmentColors = segments.map((seg) => seg.color ?? '#2a2a4a');
  const entryFeeDisplay = entryFee === 'ALL_IN' ? 'ALL IN' : `$${Number(entryFee).toFixed(2)}`;
  const cascadeActive = !!cascadeSpinData;
  const cascadeWaitingToSpin = cascadeActive && !cascadeSpinning && !cascadeSpinResult;
  const cascadeResultVisible = cascadeActive && !!cascadeSpinResult;
  const cascadePromptPlayer = players.find((p) => p.id === positionDraft?.cascadeChain?.pendingDisplacedId) ?? null;
  const cascadeFocusPlayerId = positionDraft?.cascadeChain?.pendingDisplacedId ?? null;
  const wheelActionPlayerId = activeTimer?.mode === 'position' ? activeTimer.playerId : null;
  const wheelFocusPlayerId = cascadeFocusPlayerId ?? wheelActionPlayerId;
  const spinContextLine1 = cascadeActive
    ? (cascadeWaitingToSpin
      ? `${cascadeSpinData.initiatorName} chose not to accept DNF and wishes to swap`
      : cascadeResultVisible
      ? (cascadePromptPlayer ? `${cascadePromptPlayer.displayName}, look at your phone!` : 'Cascade result locked in.')
      : 'The cascade continues to roll — they could swap with YOU')
    : (spinning ? 'Spinning for who gets to choose next...' : null);
  const spinContextLine2 = cascadeActive
    ? (cascadeWaitingToSpin
      ? 'The cascade continues to roll — they could swap with YOU'
      : cascadeResultVisible
      ? (cascadePromptPlayer
        ? `Swapped with ${cascadePromptPlayer.displayName}. Awaiting their choice.`
        : 'No swap occurred. Cascade resolved on DNF.')
      : `${cascadeSpinData.mode === 'gentle' ? `Gentle Level ${cascadeSpinData.level + 1}` : `Harsh Spin ${cascadeSpinData.level + 1}`} · ${cascadeSpinData.dnfSlots}/13 DNF slots (${Math.round((cascadeSpinData.dnfSlots / 13) * 100)}% DNF chance)`)
    : null;
  const wheelContextTitle = cascadeWaitingToSpin
    ? 'LOOK AT THE TV'
    : (cascadeResultVisible && cascadeSpinResult !== 'DNF' && cascadePromptPlayer)
      ? `${cascadeSpinData?.initiatorName ?? 'Someone'} took ${cascadePromptPlayer.displayName}'s position!`
      : 'THE WHEEL IS SPINNING';
  const hasVoteElement = !!(groupVote || voteResult || positionVote || positionVoteResult);
  const hasWheelElement = WHEEL_STAGES.includes(currentStage);
  const activeElementType = hasVoteElement ? 'vote' : hasWheelElement ? 'wheel' : null;
  const hasActiveElement = !!activeElementType;
  const leaderboardFocusPlayerId = wheelFocusPlayerId ?? activeTimer?.playerId ?? null;

  useEffect(() => {
    let timeout;
    if (hasActiveElement) {
      setActiveElementReady(false);
      timeout = setTimeout(() => setActiveElementReady(true), ACTIVE_PANEL_TRANSITION_MS);
    } else {
      // Keep content visible while panel slides out; clear after exit completes.
      timeout = setTimeout(() => setActiveElementReady(false), ACTIVE_PANEL_TRANSITION_MS);
    }
    return () => clearTimeout(timeout);
  }, [hasActiveElement, activeElementType]);

  useEffect(() => {
    let timeout;
    if (hasActiveElement) {
      setLeaderboardExpanded(false);
    } else {
      timeout = setTimeout(() => setLeaderboardExpanded(true), ACTIVE_PANEL_TRANSITION_MS);
    }
    return () => clearTimeout(timeout);
  }, [hasActiveElement]);

  useEffect(() => {
    const leaderboardEl = leaderboardRef.current;
    if (!leaderboardEl) return undefined;
    if (autoScrollRafRef.current) {
      cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }
    const maxScroll = Math.max(0, leaderboardEl.scrollHeight - leaderboardEl.clientHeight);
    if (maxScroll <= 0) return undefined;

    if (leaderboardFocusPlayerId) {
      const row = rowRefs.current.get(leaderboardFocusPlayerId);
      if (row) {
        const target = row.offsetTop - (leaderboardEl.clientHeight / 2) + (row.clientHeight / 2);
        leaderboardEl.scrollTo({ top: Math.max(0, Math.min(maxScroll, target)), behavior: 'smooth' });
      }
      return undefined;
    }

    autoScrollLastTsRef.current = 0;
    const speedPxPerSecond = 16;
    const tick = (ts) => {
      const el = leaderboardRef.current;
      if (!el) return;
      if (!autoScrollLastTsRef.current) autoScrollLastTsRef.current = ts;
      const dt = (ts - autoScrollLastTsRef.current) / 1000;
      autoScrollLastTsRef.current = ts;
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      if (max <= 0) return;
      let next = el.scrollTop + (autoScrollDirectionRef.current * speedPxPerSecond * dt);
      if (next >= max) {
        next = max;
        autoScrollDirectionRef.current = -1;
      } else if (next <= 0) {
        next = 0;
        autoScrollDirectionRef.current = 1;
      }
      el.scrollTop = next;
      autoScrollRafRef.current = requestAnimationFrame(tick);
    };
    autoScrollRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (autoScrollRafRef.current) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
    };
  }, [leaderboardFocusPlayerId, sortedPlayers.length]);

  const onLeaderboardWheel = useCallback((e) => {
    const el = leaderboardRef.current;
    if (!el) return;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    if (max <= 0) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const atTop = el.scrollTop <= 0;
    const atBottom = el.scrollTop >= max - 1;
    if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const next = Math.max(0, Math.min(max, el.scrollTop + e.deltaY));
    if (next !== el.scrollTop) {
      e.preventDefault();
      el.scrollTop = next;
    }
  }, []);

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>MKMGA — Race {raceNumber}</span>
        <span style={styles.headerStage}>{currentStage.replace(/_/g, ' ')}</span>
        <span style={styles.headerPot}>POT: <MoneyDelta value={pot}><MoneyTicker value={pot} prefix="$" /></MoneyDelta></span>
        <span style={styles.headerFee}>ENTRY: {entryFeeDisplay}</span>
      </div>

      <div style={styles.stageLayout}>
        <PresenceSlide show direction="down" style={styles.topRowSlide}>
          <div style={styles.topRow}>
            <PresenceSlide show={hasActiveElement} direction="left" duration={ACTIVE_PANEL_TRANSITION_MS} style={styles.activePanel}>
                <ActiveElementFrame ready={activeElementReady}>
                {activeElementType === 'vote' ? (
                  <div style={styles.voteActiveWrap}>
                    <VoteActiveElement
                      players={players}
                      groupVote={groupVote}
                      voteResult={voteResult}
                      voteTimeLeft={voteTimeLeft}
                      voteCounts={voteCounts}
                      positionVote={positionVote}
                      positionVoteResult={positionVoteResult}
                      positionVoteTimeLeft={positionVoteTimeLeft}
                    />
                  </div>
                ) : (
                <div style={styles.wheelPanel}>
                  {(cascadeActive || segments.length > 0) ? (
                    <>
                      <div style={{ position: 'relative', width: 420, height: 420, flexShrink: 0 }}>
                        {!cascadeActive ? (
                          <>
                            <div style={{ opacity: wheelOpacity, transition: 'opacity 400ms ease', position: 'absolute', inset: 0 }}>
                              <div className="wheel-spawn-in" key={`pos-spin-${wheelSpawnKey}`}>
                                <SpinningWheel
                                  segments={segments}
                                  targetIndex={targetIndex}
                                  spinning={activeElementReady && spinning}
                                  onSpinComplete={handleSpinComplete}
                                  size={420}
                                  highlightIndex={highlightIndex}
                                  dimAmount={0.2}
                                  segmentColors={wheelSegmentColors}
                                />
                              </div>
                            </div>
                            {pickerPlayer && (
                              <div style={{
                                position: 'absolute', inset: 0,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                opacity: avatarOpacity,
                                transform: `scale(${avatarScale})`,
                                transition: 'opacity 500ms ease, transform 500ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                                pointerEvents: 'none',
                              }}>
                                {pickerPlayer.profileImageUrl ? (
                                  <img src={pickerPlayer.profileImageUrl} alt={pickerPlayer.displayName} style={{ width: 315, height: 315, borderRadius: '50%', objectFit: 'cover', border: '4px solid #f0c040', boxShadow: '0 0 40px rgba(240,192,64,0.8)' }} />
                                ) : (
                                  <div style={{ width: 315, height: 315, borderRadius: '50%', background: getFavoriteColor(pickerPlayer), border: '4px solid #f0c040', boxShadow: '0 0 40px rgba(240,192,64,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 120, fontWeight: 'bold', color: '#f0c040' }}>
                                    {pickerPlayer.displayName?.[0]?.toUpperCase() ?? '?'}
                                  </div>
                                )}
                              </div>
                            )}
                          </>
                        ) : (
                          <div style={styles.cascadeWheelStage}>
                            <div className="wheel-spawn-in" key={`cascade-spin-${wheelSpawnKey}`} style={{ ...styles.cascadeWheelFadeLayer, opacity: cascadeSpinResult ? 0 : 1 }}>
                              <div className={`cascade-wheel-pop${cascadeSpinning ? ' cascade-wheel-spinning' : ''}`} style={styles.cascadeWheelRing}>
                                <SpinningWheel
                                  segments={cascadeSpinData.segments}
                                  targetIndex={cascadeSpinData.targetIndex}
                                  spinning={activeElementReady && cascadeSpinning}
                                  onSpinComplete={() => {
                                    const finalTarget = cascadeSpinDataRef.current?.targetPosition ?? cascadeSpinData.targetPosition;
                                    const spinToken = cascadeSpinDataRef.current?.token ?? cascadeSpinData.token;
                                    setCascadeSpinning(false);
                                    setCascadeSpinResult(finalTarget);
                                    clearCascadeResultHoldTimeout();
                                    cascadeResultHoldTimeoutRef.current = setTimeout(() => {
                                      cascadeResultHoldTimeoutRef.current = null;
                                      socket.emit('cascade-spin-complete', { token: spinToken });
                                    }, CASCADE_RESULT_HOLD_MS);
                                  }}
                                  size={420}
                                  segmentColors={cascadeSpinData.segmentColors}
                                />
                              </div>
                            </div>
                            <div style={{ ...styles.cascadeResultLayer, opacity: cascadeSpinResult ? 1 : 0, pointerEvents: cascadeSpinResult ? 'auto' : 'none' }}>
                              <div style={cascadeSpinResult === 'DNF' ? styles.cascadeResultBigDnf : styles.cascadeResultBig} className={cascadeSpinResult === 'DNF' ? 'cascade-dnf-result-pulse' : undefined}>
                                <div style={cascadeSpinResult === 'DNF' ? styles.cascadeResultValueDnf : styles.cascadeResultValue}>
                                  {cascadeSpinResult === 'DNF' ? 'DNF' : `#${cascadeSpinResult}`}
                                </div>
                                <div style={cascadeSpinResult === 'DNF' ? styles.cascadeResultSublineDnf : styles.cascadeResultSubline}>
                                  {cascadeSpinResult === 'DNF' ? 'Confirmed DNF — chain ends here.' : cascadePromptPlayer ? `Swapped with ${cascadePromptPlayer.displayName}` : 'No swap. DNF locked in.'}
                                </div>
                                {cascadeSpinResult === 'DNF' && <div style={styles.cascadeResultDnfLabel}>The cascade chain is over!</div>}
                                {cascadePromptPlayer && cascadeSpinResult !== 'DNF' && <div style={styles.cascadeResultPrompt}>{cascadePromptPlayer.displayName} look at your phone!</div>}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                      {(spinContextLine1 || spinContextLine2) && (
                        <div style={styles.wheelContextBox} className="cascade-title-fade">
                          <div style={styles.wheelContextTitle}>{wheelContextTitle}</div>
                          {spinContextLine1 && <div style={styles.wheelContextLine1}>{spinContextLine1}</div>}
                          {spinContextLine2 && <div style={styles.wheelContextLine2}>{spinContextLine2}</div>}
                        </div>
                      )}
                      {pickerName && !spinning && !cascadeActive && (
                        <div style={{ ...styles.pickerLabel, opacity: avatarOpacity, transition: 'opacity 500ms ease' }}>
                          <span style={styles.pickerArrow}>▶</span> {pickerName} — pick your position!
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={styles.wheelDone}>All positions assigned!</div>
                  )}

                  {positionDraft && (
                    <div style={styles.positionGrid}>
                      {Array.from({ length: 13 }, (_, i) => {
                        const slot = i < 12 ? String(i + 1) : 'DNF';
                        const ownerId = positionDraft.occupiedPositions?.[slot];
                        const ownerName = ownerId ? players.find((p) => p.id === ownerId)?.displayName : null;
                        return (
                          <div key={slot} style={{ ...styles.positionCell, background: ownerId ? '#1e3a2f' : '#1a1a1a' }}>
                            <div style={styles.positionSlot}>{slot}</div>
                            <div style={styles.positionOwner}>{ownerName ?? '—'}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                )}
                </ActiveElementFrame>
            </PresenceSlide>

            <div
              ref={leaderboardRef}
              style={{ ...styles.leaderboard, ...(!hasActiveElement && leaderboardExpanded ? styles.leaderboardFullWidth : null) }}
              onWheel={onLeaderboardWheel}
            >
              <div style={styles.lbTitle}>PLAYERS</div>
              {sortedPlayers.map((p, i) => {
                const isOnClock = activeTimer?.playerId === p.id;
                const timerUrgent = isOnClock && activeTimer.timeLeft <= 10;
                const isWheelFocus = WHEEL_STAGES.includes(currentStage) && wheelFocusPlayerId === p.id;
                return (
                  <div
                    key={p.id}
                    ref={(el) => {
                      if (el) rowRefs.current.set(p.id, el);
                      else rowRefs.current.delete(p.id);
                    }}
                    style={{
                      ...styles.lbRow,
                      opacity: p.balance <= 0 ? 0.4 : 1,
                      background: isOnClock ? (timerUrgent ? '#2a0000' : '#001a0a') : isWheelFocus ? '#2a2410' : p.balance <= 0 ? '#1a0000' : i % 2 === 0 ? '#151515' : '#1c1c1c',
                      border: isOnClock ? `1px solid ${timerUrgent ? '#e74c3c' : '#2ecc71'}` : isWheelFocus ? '1px solid #f0c040' : '1px solid transparent',
                    }}
                  >
                    <span style={styles.lbRank}>#{i + 1}</span>
                    {p.profileImageUrl ? <img src={p.profileImageUrl} alt="" style={styles.lbAvatar} /> : <div style={{ ...styles.lbAvatarPlaceholder, background: getFavoriteColor(p), borderColor: getFavoriteColor(p) }}>{p.displayName?.[0]?.toUpperCase() ?? '?'}</div>}
                    <span style={styles.lbName}>{p.displayName}</span>
                    {isWheelFocus && !isOnClock && <span style={styles.lbFocusBadge}>FOCUS</span>}
                    {isOnClock && (
                      <span style={{ ...styles.lbTimerBadge, color: timerUrgent ? '#e74c3c' : '#2ecc71', borderColor: timerUrgent ? '#e74c3c' : '#2ecc71' }}>
                        {activeTimer.timeLeft}s
                      </span>
                    )}
                    <MoneyDelta value={p.balance}><MoneyTicker value={p.balance} prefix="$" style={styles.lbBalance} /></MoneyDelta>
                    {p.positions?.length > 0 && <span style={styles.lbPositions}>[{p.positions.join(', ')}]</span>}
                    {!p.skipFoldTokenAvailable && <span style={styles.lbNoToken}>NO TOKEN</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </PresenceSlide>

        <div style={styles.footer} />
      </div>
    </div>
  );
}
const styles = {
  root: {
    width: '100vw',
    height: '100vh',
    background: '#0d0d0d',
    color: '#fff',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: "'Segoe UI', sans-serif",
    overflow: 'hidden',
    position: 'relative',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 32,
    padding: '12px 24px',
    background: '#111',
    borderBottom: '2px solid #333',
    flexShrink: 0,
  },
  headerTitle: { fontSize: 22, fontWeight: 'bold', color: '#f0c040', letterSpacing: 1 },
  headerStage: { fontSize: 14, color: '#aaa', textTransform: 'uppercase', letterSpacing: 2 },
  headerPot: { fontSize: 18, fontWeight: 'bold', color: '#2ecc71' },
  headerFee: { fontSize: 16, color: '#e67e22' },
  stageLayout: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    overflow: 'hidden',
  },
  topRowSlide: {
    flex: 1,
    overflow: 'hidden',
  },
  topRow: {
    display: 'flex',
    gap: 0,
    height: '100%',
    overflow: 'hidden',
  },
  activePanel: {
    flex: 1,
    minWidth: 0,
    borderRight: '1px solid #222',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'stretch',
  },
  wheelPanel: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '20px 16px',
    overflowY: 'auto',
    gap: 16,
  },
  voteActiveWrap: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
  },
  spinningLabel: {
    fontSize: 20,
    color: '#aaa',
    fontStyle: 'italic',
    animation: 'pulse 0.8s ease-in-out infinite alternate',
  },
  wheelContextBox: {
    width: '100%',
    maxWidth: 460,
    background: 'linear-gradient(180deg, rgba(16,22,31,0.95) 0%, rgba(11,16,24,0.98) 100%)',
    border: '1px solid #2c3b52',
    borderRadius: 10,
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    textAlign: 'center',
    boxShadow: '0 0 24px rgba(35, 90, 150, 0.28)',
  },
  wheelContextTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#dbe9ff',
    letterSpacing: 1.6,
  },
  wheelContextLine1: {
    fontSize: 14,
    color: '#a8cdf2',
    fontWeight: 'bold',
  },
  wheelContextLine2: {
    fontSize: 12,
    color: '#90a5c2',
  },
  pickerLabel: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#2ecc71',
    textAlign: 'center',
    padding: '8px 16px',
    background: '#0d2b1e',
    borderRadius: 8,
    border: '1px solid #2ecc71',
    willChange: 'opacity',
  },
  pickerArrow: { color: '#f0c040' },
  wheelDone: {
    fontSize: 20,
    color: '#2ecc71',
    fontWeight: 'bold',
    marginTop: 40,
  },
  positionGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: 6,
    width: '100%',
    marginTop: 8,
  },
  positionCell: {
    borderRadius: 6,
    padding: '6px 4px',
    textAlign: 'center',
    border: '1px solid #333',
  },
  positionSlot: { fontSize: 13, fontWeight: 'bold', color: '#f0c040' },
  positionOwner: { fontSize: 11, color: '#ccc', marginTop: 2, wordBreak: 'break-word' },
  leaderboard: {
    width: 460,
    flexShrink: 0,
    padding: '20px 18px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    background: '#101010',
    overscrollBehavior: 'contain',
  },
  leaderboardFullWidth: {
    width: '100%',
  },
  lbTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 2,
    color: '#f0c040',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  lbRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 14px',
    borderRadius: 6,
    fontSize: 15,
  },
  lbRank: { color: '#666', width: 28, flexShrink: 0 },
  lbAvatar: { width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 },
  lbAvatarPlaceholder: { width: 32, height: 32, borderRadius: '50%', background: '#333', border: '1px solid #444', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 'bold', color: '#e8ecf6', flexShrink: 0 },
  lbName: { flex: 1, fontWeight: 'bold' },
  lbBalance: { color: '#2ecc71', fontWeight: 'bold', minWidth: 60, textAlign: 'right' },
  lbPositions: { color: '#888', fontSize: 12, marginLeft: 8 },
  lbNoToken: {
    fontSize: 10,
    background: '#5a1a1a',
    color: '#f66',
    padding: '2px 6px',
    borderRadius: 4,
    marginLeft: 4,
  },
  lbFocusBadge: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#f0c040',
    border: '1px solid #f0c040',
    borderRadius: 4,
    padding: '1px 6px',
    marginRight: 4,
    letterSpacing: 0.6,
  },
  lbTimerBadge: {
    fontSize: 13,
    fontWeight: 'bold',
    border: '1px solid',
    borderRadius: 4,
    padding: '1px 6px',
    marginRight: 4,
    fontVariantNumeric: 'tabular-nums',
  },
  footer: {
    borderTop: '1px solid #222',
    background: 'linear-gradient(180deg, #101214 0%, #090a0c 100%)',
    minHeight: 120,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: '8px 12px 10px',
    overflow: 'hidden',
  },
  timerStrip: {
    position: 'relative',
    height: 32,
    background: '#0a0d12',
    border: '1px solid #202932',
    borderRadius: 6,
    overflow: 'hidden',
    flexShrink: 0,
  },
  timerStripFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: '100%',
    transition: 'width 0.85s linear, background 0.3s',
    opacity: 0.4,
  },
  timerStripLabel: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    fontSize: 13,
    whiteSpace: 'nowrap',
    letterSpacing: 0.5,
    transition: 'color 0.3s',
  },
  votePanel: {
    background: '#0d0d2e',
    border: '2px solid #4444cc',
    borderRadius: 12,
    padding: '20px 28px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    boxShadow: '0 0 40px rgba(80,80,200,0.5)',
  },
  votePanelTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#a0a0ff',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  votePanelSub: { fontSize: 14, color: '#888' },
  votePanelTimerBarWrap: {
    height: 8,
    background: '#1a1a1a',
    borderRadius: 4,
    overflow: 'hidden',
  },
  votePanelTimerBarFill: {
    height: '100%',
    borderRadius: 4,
    transition: 'width 0.8s linear, background 0.3s',
  },
  votePanelTally: {
    display: 'flex',
    gap: 32,
    justifyContent: 'center',
    marginTop: 4,
  },
  votePanelTallyCell: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
  },
  votePanelTallyCount: { fontSize: 40, fontWeight: 'bold', color: '#fff' },
  votePanelTallyLabel: { fontSize: 13, color: '#aaa', textTransform: 'uppercase', letterSpacing: 2 },
  votePanelVoters: { fontSize: 12, color: '#555', textAlign: 'right' },
  voteResultBanner: {
    background: '#0d2b1e',
    border: '2px solid #2ecc71',
    borderRadius: 10,
    padding: '16px 24px',
    fontSize: 18,
    color: '#2ecc71',
    textAlign: 'center',
    boxShadow: '0 0 30px rgba(46,204,113,0.4)',
  },
  cascadeChainPanel: {
    background: '#1a0d1a',
    border: '2px solid #aa44aa',
    borderRadius: 10,
    padding: '14px 18px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    width: '100%',
    boxShadow: '0 0 24px rgba(180,80,180,0.4)',
  },
  cascadeChainTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#dd88dd',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  cascadeFocusCard: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #a03030',
    background: '#220b0b',
  },
  cascadeFocusAvatar: {
    width: 44,
    height: 44,
    borderRadius: '50%',
    objectFit: 'cover',
    border: '2px solid #e74c3c',
    flexShrink: 0,
  },
  cascadeFocusAvatarFallback: {
    width: 44,
    height: 44,
    borderRadius: '50%',
    background: '#3a1a1a',
    border: '2px solid #e74c3c',
    color: '#ffb0b0',
    fontWeight: 'bold',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cascadeFocusMeta: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  cascadeFocusName: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#ff9f9f',
  },
  cascadeFocusPrompt: {
    fontSize: 12,
    color: '#ffc6c6',
  },
  cascadeChainDisplaced: {
    fontSize: 15,
    color: '#ccc',
  },
  cascadeChainInfo: {
    fontSize: 13,
    color: '#aaa',
  },
  cascadeChainWaiting: {
    fontSize: 12,
    color: '#666',
    fontStyle: 'italic',
  },
  cascadeWheelStage: {
    position: 'absolute',
    inset: 0,
    background: 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    border: 'none',
    boxShadow: 'none',
    zIndex: 20,
  },
  cascadeWheelRing: {
    width: 420,
    height: 420,
    borderRadius: '50%',
    border: '2px solid #2a3a50',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'radial-gradient(circle at 50% 50%, rgba(20, 35, 55, 0.26) 0%, rgba(9, 16, 27, 0.78) 100%)',
    overflow: 'hidden',
  },
  cascadeWheelFadeLayer: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'opacity 500ms ease',
  },
  cascadeResultLayer: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'opacity 500ms ease',
  },
  cascadeResultBig: {
    width: 420,
    height: 420,
    borderRadius: '50%',
    border: '4px solid rgba(115, 205, 255, 0.78)',
    background: 'radial-gradient(circle at 50% 35%, rgba(35, 79, 124, 0.9) 0%, rgba(11, 22, 37, 0.98) 68%, rgba(6, 10, 16, 1) 100%)',
    boxShadow: '0 0 46px rgba(64, 170, 255, 0.36), inset 0 0 50px rgba(70, 170, 255, 0.18)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: '32px 40px',
    textAlign: 'center',
    transition: 'opacity 500ms ease, transform 500ms ease',
  },
  cascadeResultBigDnf: {
    width: 420,
    height: 420,
    borderRadius: '50%',
    border: '4px solid rgba(231, 76, 60, 0.9)',
    background: 'radial-gradient(circle at 50% 35%, rgba(120, 20, 20, 0.95) 0%, rgba(40, 8, 8, 0.98) 68%, rgba(10, 2, 2, 1) 100%)',
    boxShadow: '0 0 60px rgba(231, 76, 60, 0.55), inset 0 0 50px rgba(180, 30, 30, 0.25)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: '32px 40px',
    textAlign: 'center',
    transition: 'opacity 500ms ease, transform 500ms ease',
  },
  cascadeResultValue: {
    fontSize: 86,
    fontWeight: 'bold',
    color: '#f8fbff',
    letterSpacing: 2,
    textShadow: '0 0 22px rgba(70, 170, 255, 0.85)',
  },
  cascadeResultValueDnf: {
    fontSize: 100,
    fontWeight: 'bold',
    color: '#ff6b6b',
    letterSpacing: 3,
    textShadow: '0 0 32px rgba(231, 76, 60, 1), 0 0 60px rgba(180, 30, 30, 0.7)',
  },
  cascadeResultSubline: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#a9d8ff',
    lineHeight: 1.25,
    textShadow: '0 0 16px rgba(60, 140, 220, 0.55)',
  },
  cascadeResultSublineDnf: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffaaaa',
    lineHeight: 1.25,
    textShadow: '0 0 14px rgba(231, 76, 60, 0.6)',
  },
  cascadeResultDnfLabel: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#ff8888',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    opacity: 0.8,
  },
  cascadeResultPrompt: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#f0c040',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    textShadow: '0 0 14px rgba(240, 192, 64, 0.5)',
  },
  cascadeHeadline: {
    marginTop: 2,
    fontSize: 21,
    fontWeight: 'bold',
    color: '#a9d8ff',
    textAlign: 'center',
    lineHeight: 1.25,
    textShadow: '0 0 16px rgba(60, 140, 220, 0.55)',
  },
  cascadeSpinInfoInline: {
    fontSize: 14,
    color: '#98a6bb',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
};

export default HostView;
