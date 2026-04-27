import { useState, useEffect, useRef, useCallback } from 'react';
import SpinningWheel from '../components/SpinningWheel';
import MoneyTicker from '../components/MoneyTicker';
import MoneyDelta from '../components/MoneyDelta';
import Avatar from '../components/Avatar';
import StackedAvatars from '../components/StackedAvatars';

// Which stages show the wheel panel
const WHEEL_STAGES = ['POSITION_ASSIGNMENT'];
const CASCADE_PRE_SPIN_DELAY_MS = 5000;
const ACTIVE_PANEL_TRANSITION_MS = 760;
const LEADERBOARD_AUTO_SCROLL_SPEED_PX_PER_SECOND = 52;
const LEADERBOARD_AUTO_SCROLL_PAUSE_MS = 3000;
const LEADERBOARD_FOCUS_OVERRIDE_MS = 2600;
const LEADERBOARD_MANUAL_OVERRIDE_MS = 4500;
const LEADERBOARD_PANEL_WIDTH = 460;
const LEADERBOARD_POSITION_ORDER = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'DNF'];
const LEADERBOARD_POSITION_RANK = new Map(LEADERBOARD_POSITION_ORDER.map((position, index) => [position, index]));
// How long to hold the cascade result on-screen before telling the server the spin is done.
// For DNF (no displaced player) this is the full hold; for swaps the displaced player's
// response is what eventually clears the card anyway.
const CASCADE_RESULT_HOLD_MS = 7000;

function getLeaderboardPosition(player) {
  const positions = Array.isArray(player?.positions) ? player.positions : [];
  if (!positions.length) return null;

  return [...positions].sort((left, right) => {
    const leftRank = LEADERBOARD_POSITION_RANK.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = LEADERBOARD_POSITION_RANK.get(right) ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank;
  })[0];
}

function isTokenSpentThisRace(player) {
  return Boolean(!player?.skipFoldTokenAvailable && (player?.skippedRace || player?.folded));
}

function useLeaderboardAutoScroll({
  containerRef,
  rowRefs,
  enabled,
  focusPlayerId,
  speedPxPerSecond,
  edgePauseMs,
  focusOverrideMs,
  manualOverrideMs,
  debugReporter,
}) {
  const rafRef = useRef(null);
  const directionRef = useRef(1);
  const lastTsRef = useRef(0);
  const carryPxRef = useRef(0);
  const edgePauseUntilTsRef = useRef(0);
  const suspendUntilTsRef = useRef(0);
  const lastFocusedPlayerIdRef = useRef(null);
  const lastDebugEmitTsRef = useRef(0);

  useEffect(() => {
    if (!enabled || !focusPlayerId) {
      lastFocusedPlayerIdRef.current = null;
      return;
    }

    const focusChanged = lastFocusedPlayerIdRef.current !== focusPlayerId;
    lastFocusedPlayerIdRef.current = focusPlayerId;
    if (!focusChanged) return;

    const el = containerRef.current;
    if (!el) return;
    const row = rowRefs.current.get(focusPlayerId);
    if (!row) return;

    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    const target = row.offsetTop - (el.clientHeight / 2) + (row.clientHeight / 2);
    el.scrollTo({ top: Math.max(0, Math.min(max, target)), behavior: 'smooth' });
    suspendUntilTsRef.current = performance.now() + focusOverrideMs;
  }, [containerRef, rowRefs, enabled, focusPlayerId, focusOverrideMs]);

  useEffect(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const emitDebug = (ts, phase) => {
      if (typeof debugReporter !== 'function') return;
      if (ts - lastDebugEmitTsRef.current < 400) return;
      lastDebugEmitTsRef.current = ts;
      const el = containerRef.current;
      const maxScroll = el ? Math.max(0, el.scrollHeight - el.clientHeight) : 0;
      debugReporter({
        algoVersion: 'v2-carry-52',
        phase,
        enabled,
        focusPlayerId: focusPlayerId ?? null,
        scrollTop: Number(el?.scrollTop ?? 0),
        maxScroll,
        direction: directionRef.current,
        edgePauseMsRemaining: Math.max(0, Math.round(edgePauseUntilTsRef.current - ts)),
        suspendMsRemaining: Math.max(0, Math.round(suspendUntilTsRef.current - ts)),
      });
    };

    const tick = (ts) => {
      const el = containerRef.current;
      if (!el) {
        emitDebug(ts, 'no-container');
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      if (!enabled) {
        lastTsRef.current = ts;
        emitDebug(ts, 'disabled');
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      if (!lastTsRef.current) lastTsRef.current = ts;

      if (ts < edgePauseUntilTsRef.current || ts < suspendUntilTsRef.current) {
        lastTsRef.current = ts;
        emitDebug(ts, 'paused');
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;

      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      if (maxScroll <= 0) {
        emitDebug(ts, 'no-overflow');
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const signedDelta = (directionRef.current * speedPxPerSecond * dt) + carryPxRef.current;
      const wholePx = signedDelta >= 0 ? Math.floor(signedDelta) : Math.ceil(signedDelta);
      carryPxRef.current = signedDelta - wholePx;
      let next = el.scrollTop + wholePx;
      const hitBottom = next >= maxScroll && directionRef.current > 0 && wholePx > 0;
      const hitTop = next <= 0 && directionRef.current < 0 && wholePx < 0;

      if (hitBottom) {
        next = maxScroll;
        directionRef.current = -1;
        carryPxRef.current = 0;
        edgePauseUntilTsRef.current = ts + edgePauseMs;
      } else if (hitTop) {
        next = 0;
        directionRef.current = 1;
        carryPxRef.current = 0;
        edgePauseUntilTsRef.current = ts + edgePauseMs;
      }
      el.scrollTop = next;
      emitDebug(ts, 'scrolling');

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [containerRef, enabled, focusPlayerId, speedPxPerSecond, edgePauseMs, debugReporter]);

  const onManualWheel = useCallback((e) => {
    const el = containerRef.current;
    if (!el) return;

    suspendUntilTsRef.current = performance.now() + manualOverrideMs;

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
  }, [containerRef, manualOverrideMs]);

  return onManualWheel;
}

function getFirstName(name) {
  const safe = String(name || '').trim();
  if (!safe) return 'Player';
  return safe.split(/\s+/)[0];
}

function getClosestPositionRankToResult(player, resultRank) {
  const positions = Array.isArray(player?.positions) ? player.positions : [];
  if (!Number.isFinite(resultRank) || positions.length === 0) return Number.MAX_SAFE_INTEGER;

  let bestRank = Number.MAX_SAFE_INTEGER;
  let bestDistance = Number.MAX_SAFE_INTEGER;
  for (const pos of positions) {
    const rank = LEADERBOARD_POSITION_RANK.get(String(pos));
    if (!Number.isFinite(rank)) continue;
    const distance = Math.abs(rank - resultRank);
    if (distance < bestDistance || (distance === bestDistance && rank < bestRank)) {
      bestDistance = distance;
      bestRank = rank;
    }
  }
  return bestRank;
}

function PayoutActiveElement({ winners, raceResult, getFavoriteColor }) {
  const shown = winners.slice(0, 3);
  const overflow = winners.slice(3);
  const overflowNames = overflow.map((player) => getFirstName(player.displayName || player.realName || player.id));

  if (winners.length === 0) {
    return (
      <div style={styles.payoutPanel}>
        <div style={styles.payoutTitle}>Payout</div>
        <div style={styles.payoutSubtitle}>No winning cards for position {raceResult ?? 'N/A'} this race.</div>
      </div>
    );
  }

  return (
    <div style={styles.payoutPanel}>
      <div style={styles.payoutTitle}>{winners.length === 1 ? 'Winner' : 'Winners'}</div>
      <div style={styles.payoutSubtitle}>Hit position: <strong>{raceResult ?? 'N/A'}</strong></div>
      <div style={styles.payoutWinnersRow}>
        {shown.map((player) => {
          const firstName = getFirstName(player.displayName || player.realName || player.id);
          return (
            <div key={player.id} style={styles.payoutWinnerTile}>
              <Avatar player={player} size={80} borderWidth={3} getFavoriteColor={getFavoriteColor} />
              <div style={styles.payoutWinnerName}>{firstName}</div>
            </div>
          );
        })}
      </div>
      {overflow.length > 0 && (
        <div style={styles.payoutOverflowText}>
          +{overflow.length} more: {overflowNames.join(', ')}
        </div>
      )}
    </div>
  );
}

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
  const { currentStage, players, wheelOrder, positionDraft, pot, raceNumber, entryFee, raceResult } = gameState;

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
  const lbStickyHeaderRef = useRef(null);
  const [lbHeaderHeight, setLbHeaderHeight] = useState(58);
  useEffect(() => {
    const el = lbStickyHeaderRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setLbHeaderHeight(el.getBoundingClientRect().height));
    ro.observe(el);
    setLbHeaderHeight(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, []);
  const rowRefs = useRef(new Map());

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

  const getFavoriteColor = (player) => {
    const raw = String(player?.favoriteColor || '').trim();
    return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw) ? raw : '#2a2a4a';
  };
  const skippedOrFoldedPlayers = [...players]
    .filter((player) => isTokenSpentThisRace(player));
  const activePlayers = [...players]
    .filter((player) => !isTokenSpentThisRace(player));
  const wheelOrderRank = new Map((wheelOrder ?? []).map((playerId, index) => [playerId, index]));
  const compareByWheelOrder = (left, right) => {
    const leftRank = wheelOrderRank.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = wheelOrderRank.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' });
  };
  const payoutResultRank = LEADERBOARD_POSITION_RANK.get(String(raceResult ?? ''));
  const compareByPayoutCloseness = (left, right) => {
    const leftClosestRank = getClosestPositionRankToResult(left, payoutResultRank);
    const rightClosestRank = getClosestPositionRankToResult(right, payoutResultRank);
    const leftDistance = Number.isFinite(leftClosestRank) ? Math.abs(leftClosestRank - payoutResultRank) : Number.MAX_SAFE_INTEGER;
    const rightDistance = Number.isFinite(rightClosestRank) ? Math.abs(rightClosestRank - payoutResultRank) : Number.MAX_SAFE_INTEGER;
    if (leftDistance !== rightDistance) return leftDistance - rightDistance;
    if (leftClosestRank !== rightClosestRank) return leftClosestRank - rightClosestRank;
    return compareByWheelOrder(left, right);
  };

  const usePayoutClosenessOrder = currentStage === 'PAYOUT' && Number.isFinite(payoutResultRank);
  const useBettingOrder = currentStage === 'BETTING' || currentStage === 'RACE_PENDING_RESULT';
  const payingPlayers = useBettingOrder
    ? activePlayers
      .filter((player) => getLeaderboardPosition(player) !== null)
      .sort(compareByWheelOrder)
    : usePayoutClosenessOrder
      ? activePlayers
        .filter((player) => getLeaderboardPosition(player) !== null)
        .sort(compareByPayoutCloseness)
    : activePlayers
      .filter((player) => getLeaderboardPosition(player) !== null)
      .sort((left, right) => {
        const positionDiff = (LEADERBOARD_POSITION_RANK.get(getLeaderboardPosition(left)) ?? Number.MAX_SAFE_INTEGER)
          - (LEADERBOARD_POSITION_RANK.get(getLeaderboardPosition(right)) ?? Number.MAX_SAFE_INTEGER);
        if (positionDiff !== 0) return positionDiff;
        return left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' });
      });
  const awaitingPositionPlayers = useBettingOrder
    ? activePlayers
      .filter((player) => getLeaderboardPosition(player) === null)
      .sort(compareByWheelOrder)
    : usePayoutClosenessOrder
      ? activePlayers
        .filter((player) => getLeaderboardPosition(player) === null)
        .sort(compareByPayoutCloseness)
    : activePlayers
      .filter((player) => getLeaderboardPosition(player) === null)
      .sort((left, right) => left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' }));
  const sortedSkippedOrFoldedPlayers = useBettingOrder
    ? skippedOrFoldedPlayers.sort(compareByWheelOrder)
    : usePayoutClosenessOrder
      ? skippedOrFoldedPlayers.sort(compareByPayoutCloseness)
    : skippedOrFoldedPlayers.sort((left, right) => left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' }));
  const payingSectionLabel = usePayoutClosenessOrder
    ? `Closest To #${raceResult}`
    : useBettingOrder
      ? 'Betting Order'
      : 'Paying Players';
  const payingSectionDisplay = `${payingSectionLabel} (${payingPlayers.length})`;
  const awaitingSectionDisplay = `Awaiting Position (${awaitingPositionPlayers.length})`;
  const skippedSectionDisplay = `Skipped/Folded (${sortedSkippedOrFoldedPlayers.length})`;
  const leaderboardPlayerCount = payingPlayers.length + awaitingPositionPlayers.length + skippedOrFoldedPlayers.length;
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
  const payoutWinners = currentStage === 'PAYOUT'
    ? players.filter((player) => player.paidEntry && !player.folded && player.positions?.includes(raceResult))
    : [];
  const payoutWinnerIds = new Set(payoutWinners.map((player) => player.id));
  const hasPayoutElement = currentStage === 'PAYOUT';
  const activeElementType = hasVoteElement ? 'vote' : hasWheelElement ? 'wheel' : hasPayoutElement ? 'payout' : null;
  const hasActiveElement = !!activeElementType;
  const leaderboardFocusPlayerId = wheelFocusPlayerId ?? activeTimer?.playerId ?? null;
  const wheelIsBusy = hasWheelElement && (spinning || cascadeSpinning);
  const leaderboardAutoScrollEnabled = currentStage !== 'RACE_PENDING_RESULT' && !wheelIsBusy;

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

  const onLeaderboardWheel = useLeaderboardAutoScroll({
    containerRef: leaderboardRef,
    rowRefs,
    enabled: leaderboardAutoScrollEnabled,
    focusPlayerId: leaderboardFocusPlayerId,
    speedPxPerSecond: LEADERBOARD_AUTO_SCROLL_SPEED_PX_PER_SECOND,
    edgePauseMs: LEADERBOARD_AUTO_SCROLL_PAUSE_MS,
    focusOverrideMs: LEADERBOARD_FOCUS_OVERRIDE_MS,
    manualOverrideMs: LEADERBOARD_MANUAL_OVERRIDE_MS,
    debugReporter: useCallback((payload) => {
      socket.emit('system-debug-print', {
        source: 'host-view-leaderboard',
        algoVersion: 'v2-carry-52',
        stage: currentStage,
        ...payload,
      });
    }, [socket, currentStage]),
  });

  useEffect(() => {
    const intervalId = setInterval(() => {
      const el = leaderboardRef.current;
      const maxScroll = el ? Math.max(0, el.scrollHeight - el.clientHeight) : 0;
      socket.emit('system-debug-print', {
        source: 'host-view-heartbeat',
        algoVersion: 'v2-carry-52',
        stage: currentStage,
        phase: 'heartbeat',
        enabled: leaderboardAutoScrollEnabled,
        focusPlayerId: leaderboardFocusPlayerId ?? null,
        scrollTop: Number(el?.scrollTop ?? 0),
        maxScroll,
        direction: 1,
        edgePauseMsRemaining: 0,
        suspendMsRemaining: 0,
      });
    }, 1000);

    return () => clearInterval(intervalId);
  }, [socket, currentStage, leaderboardAutoScrollEnabled, leaderboardFocusPlayerId]);

  const renderLeaderboardRow = (player, index, { dimmed = false, showRank = true } = {}) => {
    const isOnClock = activeTimer?.playerId === player.id;
    const timerUrgent = isOnClock && activeTimer.timeLeft <= 10;
    const isWheelFocus = WHEEL_STAGES.includes(currentStage) && wheelFocusPlayerId === player.id;
    const tokenSpentThisRace = isTokenSpentThisRace(player);
    const tokenLabel = tokenSpentThisRace
      ? (player.skippedRace ? 'SKIPPED' : 'FOLDED')
      : (!player.skipFoldTokenAvailable ? 'NO TOKEN' : null);
    const rowDimmed = dimmed || tokenSpentThisRace;
    const isPayoutWinner = currentStage === 'PAYOUT' && payoutWinnerIds.has(player.id);
    const payoutTextColor = '#161204';
    const normalBackground = isOnClock
      ? (timerUrgent ? '#2a0000' : '#001a0a')
      : isWheelFocus
        ? '#2a2410'
        : player.balance <= 0
          ? '#1a0000'
          : rowDimmed
            ? '#161616'
            : index % 2 === 0
              ? '#151515'
              : '#1c1c1c';

    return (
      <div
        key={player.id}
        ref={(el) => {
          if (el) rowRefs.current.set(player.id, el);
          else rowRefs.current.delete(player.id);
        }}
        style={{
          ...styles.lbRow,
          opacity: player.balance <= 0 ? 0.4 : rowDimmed ? 0.7 : 1,
          filter: rowDimmed ? 'grayscale(0.45)' : 'none',
          background: isPayoutWinner
            ? 'linear-gradient(90deg, rgba(133,95,30,0.95) 0%, rgba(199,156,53,0.96) 52%, rgba(133,95,30,0.95) 100%)'
            : normalBackground,
          border: isPayoutWinner
            ? '1px solid #f2d57a'
            : isOnClock
              ? `1px solid ${timerUrgent ? '#e74c3c' : '#2ecc71'}`
              : isWheelFocus
                ? '1px solid #f0c040'
                : rowDimmed
                  ? '1px solid #2b2b2b'
                  : '1px solid transparent',
          boxShadow: isPayoutWinner ? '0 0 18px rgba(240, 192, 64, 0.45), inset 0 0 14px rgba(255, 220, 120, 0.25)' : 'none',
              color: isPayoutWinner ? payoutTextColor : undefined,
        }}
      >
            <span style={{ ...styles.lbRank, color: isPayoutWinner ? payoutTextColor : styles.lbRank.color }}>{showRank ? `#${index + 1}` : '...'}</span>
        <Avatar player={player} size={40} borderColor={getFavoriteColor(player)} getFavoriteColor={getFavoriteColor} />
            <span style={{ ...styles.lbName, color: isPayoutWinner ? payoutTextColor : undefined }}>{player.displayName}</span>
        {isWheelFocus && !isOnClock && <span style={styles.lbFocusBadge}>FOCUS</span>}
        {isOnClock && (
          <span style={{ ...styles.lbTimerBadge, color: timerUrgent ? '#e74c3c' : '#2ecc71', borderColor: timerUrgent ? '#e74c3c' : '#2ecc71' }}>
            {activeTimer.timeLeft}s
          </span>
        )}
            <MoneyDelta value={player.balance}><MoneyTicker value={player.balance} prefix="$" style={{ ...styles.lbBalance, color: isPayoutWinner ? payoutTextColor : styles.lbBalance.color }} /></MoneyDelta>
            {player.positions?.length > 0 && <span style={{ ...styles.lbPositions, color: isPayoutWinner ? payoutTextColor : styles.lbPositions.color }}>[{player.positions.join(', ')}]</span>}
            {tokenLabel && <span style={{ ...styles.lbNoToken, background: isPayoutWinner ? '#3e3210' : styles.lbNoToken.background, color: isPayoutWinner ? '#121212' : styles.lbNoToken.color }}>{tokenLabel}</span>}
      </div>
    );
  };

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
                ) : activeElementType === 'payout' ? (
                  <div style={styles.voteActiveWrap}>
                    <PayoutActiveElement winners={payoutWinners} raceResult={raceResult} getFavoriteColor={getFavoriteColor} />
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
                                <Avatar
                                  player={pickerPlayer}
                                  size={315}
                                  borderWidth={4}
                                  borderColor="#f0c040"
                                  style={{ boxShadow: '0 0 40px rgba(240,192,64,0.8)' }}
                                  getFavoriteColor={getFavoriteColor}
                                />
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
                        const slotOwners = players.filter((player) => Array.isArray(player.positions) && player.positions.includes(slot));
                        return (
                          <div key={slot} style={{ ...styles.positionCell, background: slotOwners.length > 0 ? '#1e3a2f' : '#1a1a1a' }}>
                            <div style={styles.positionSlot}>{slot}</div>
                            <div style={styles.positionOwner}>
                              {slotOwners.length > 0 ? (
                                <StackedAvatars
                                  players={slotOwners}
                                  size={32}
                                  maxDisplay={3}
                                  stackOffset={-10}
                                  getFavoriteColor={getFavoriteColor}
                                />
                              ) : (
                                <div style={{ color: '#666', fontSize: 12 }}>—</div>
                              )}
                            </div>
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
              className="host-leaderboard-scroll"
              style={{ ...styles.leaderboard, ...(!hasActiveElement && leaderboardExpanded ? styles.leaderboardFullWidth : null) }}
              onWheel={onLeaderboardWheel}
            >
              <div ref={lbStickyHeaderRef} style={styles.lbStickyHeader}>
                <div style={styles.lbTitle}>LEADEROARD</div>
              </div>
              {payingPlayers.length > 0 && (
                <>
                  <div style={{ ...styles.lbDivider, top: lbHeaderHeight }}>
                    <span style={styles.lbDividerLine} />
                    <span style={styles.lbDividerLabel}>{payingSectionDisplay}</span>
                    <span style={styles.lbDividerLine} />
                  </div>
                  {payingPlayers.map((player, index) => renderLeaderboardRow(player, index))}
                </>
              )}
              {awaitingPositionPlayers.length > 0 && (
                <>
                  <div style={{ ...styles.lbDivider, top: lbHeaderHeight }}>
                    <span style={styles.lbDividerLine} />
                    <span style={styles.lbDividerLabel}>{awaitingSectionDisplay}</span>
                    <span style={styles.lbDividerLine} />
                  </div>
                  {awaitingPositionPlayers.map((player, index) => renderLeaderboardRow(player, index, { dimmed: true, showRank: false }))}
                </>
              )}
              {sortedSkippedOrFoldedPlayers.length > 0 && (
                <>
                  <div style={{ ...styles.lbDivider, top: lbHeaderHeight }}>
                    <span style={styles.lbDividerLine} />
                    <span style={styles.lbDividerLabel}>{skippedSectionDisplay}</span>
                    <span style={styles.lbDividerLine} />
                  </div>
                  {sortedSkippedOrFoldedPlayers.map((player, index) => renderLeaderboardRow(player, index, { dimmed: true, showRank: false }))}
                </>
              )}
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
    background: `linear-gradient(90deg, #111 0%, #111 calc(100% - ${LEADERBOARD_PANEL_WIDTH}px), #101010 calc(100% - ${LEADERBOARD_PANEL_WIDTH}px), #101010 100%)`,
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
    minHeight: 0,
    overflow: 'hidden',
  },
  topRowSlide: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  topRow: {
    display: 'flex',
    gap: 0,
    height: '100%',
    minHeight: 0,
    overflow: 'hidden',
  },
  activePanel: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
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
  positionOwner: {
    fontSize: 11,
    color: '#ccc',
    marginTop: 4,
    minHeight: 34,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    wordBreak: 'break-word',
  },
  leaderboard: {
    width: LEADERBOARD_PANEL_WIDTH,
    flexShrink: 0,
    minHeight: 0,
    height: '100%',
    padding: '0 18px 20px',
    overflowY: 'auto',
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
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
    marginBottom: 6,
  },
  lbStickyHeader: {
    position: 'sticky',
    top: 0,
    zIndex: 6,
    background: 'linear-gradient(180deg, rgba(16,16,16,0.97) 0%, rgba(16,16,16,0.97) 100%)',
    backdropFilter: 'blur(2px)',
    padding: '14px 18px 8px',
    margin: '0 -18px 0',
  },
  lbDivider: {
    position: 'sticky',
    top: 0,
    zIndex: 5,
    background: 'rgba(16,16,16,0.97)',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    margin: '0 -18px 6px',
    padding: '6px 18px',
  },
  lbDividerLine: {
    flex: 1,
    height: 1,
    background: '#313131',
  },
  lbDividerLabel: {
    color: '#8a8a8a',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
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
  payoutPanel: {
    width: '100%',
    maxWidth: 720,
    background: 'linear-gradient(180deg, rgba(35,28,12,0.96) 0%, rgba(18,14,8,0.98) 100%)',
    border: '2px solid #cba44a',
    borderRadius: 14,
    padding: '22px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    boxShadow: '0 0 38px rgba(240,192,64,0.34)',
    alignItems: 'center',
    textAlign: 'center',
  },
  payoutTitle: {
    fontSize: 30,
    fontWeight: 'bold',
    color: '#f2d57a',
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    textShadow: '0 0 18px rgba(240,192,64,0.45)',
  },
  payoutSubtitle: {
    fontSize: 15,
    color: '#e6d7b0',
  },
  payoutWinnersRow: {
    width: '100%',
    display: 'flex',
    alignItems: 'stretch',
    justifyContent: 'center',
    gap: 14,
    flexWrap: 'wrap',
  },
  payoutWinnerTile: {
    minWidth: 140,
    maxWidth: 180,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    padding: '10px 10px 8px',
    borderRadius: 10,
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(242, 213, 122, 0.3)',
  },
  payoutWinnerAvatar: {
    width: 84,
    height: 84,
    borderRadius: '50%',
    objectFit: 'cover',
    border: '3px solid #f2d57a',
    boxShadow: '0 0 16px rgba(240, 192, 64, 0.55)',
  },
  payoutWinnerAvatarFallback: {
    width: 84,
    height: 84,
    borderRadius: '50%',
    border: '3px solid #f2d57a',
    color: '#fff3cc',
    boxShadow: '0 0 16px rgba(240, 192, 64, 0.55)',
    fontSize: 13,
    fontWeight: 'bold',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: '0 8px',
    lineHeight: 1.1,
  },
  payoutWinnerName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#f5e6bc',
  },
  payoutOverflowText: {
    fontSize: 13,
    color: '#d8c58f',
    lineHeight: 1.3,
    maxWidth: '100%',
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
