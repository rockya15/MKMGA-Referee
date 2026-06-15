import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import MoneyTicker from '../components/MoneyTicker';
import MoneyDelta from '../components/MoneyDelta';
import AnimatedPanel from '../components/AnimatedPanel';
import LeaderboardPanel from './panels/LeaderboardPanel';
import ActiveElementPanel from './panels/ActiveElementPanel';
import FooterDisplay from './panels/FooterDisplay';
import { usePanelLayout } from '../hooks/usePanelLayout';

// Which stages show the wheel panel
const WHEEL_STAGES = ['POSITION_ASSIGNMENT'];
const CASCADE_PRE_SPIN_DELAY_MS = 5000;
const ACTIVE_PANEL_TRANSITION_MS = 760;
const LEADERBOARD_PANEL_WIDTH = 460;
const LEADERBOARD_POSITION_ORDER = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'DNF'];
const LEADERBOARD_POSITION_RANK = new Map(LEADERBOARD_POSITION_ORDER.map((position, index) => [position, index]));
// How long to hold the cascade result on-screen before telling the server the spin is done.
const CASCADE_RESULT_HOLD_MS = 7000;

function getFavoriteColorStatic(player) {
  const raw = String(player?.favoriteColor || '').trim();
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw) ? raw : '#2a2a4a';
}

function HostView({ gameState, socket }) {
  const { currentStage, players: rawPlayers, wheelOrder, positionDraft, pot, raceNumber, entryFee, raceResult, cascadeSpinsThisRound = 0, publicJoinUrl } = gameState;
  // Memoize so footer and other child components don't re-render from unrelated HostView state changes
  const players = useMemo(() => Array.isArray(rawPlayers) ? rawPlayers : [], [rawPlayers]);

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

  const [payoutTotalAmount, setPayoutTotalAmount] = useState(0);
  const [payoutScrollReady, setPayoutScrollReady] = useState(false);
  const handlePayoutEffectDone = useCallback(() => setPayoutScrollReady(true), []);
  const prevGameStateRef = useRef({ currentStage, players });

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

  // Track total amount distributed when entering PAYOUT stage
  useEffect(() => {
    const prev = prevGameStateRef.current;
    if (prev.currentStage !== 'PAYOUT' && currentStage === 'PAYOUT') {
      setPayoutScrollReady(false);
      const winners = players.filter(
        (p) => p.paidEntry && !p.folded && p.positions?.includes(raceResult),
      );
      let totalDelta = 0;
      winners.forEach((w) => {
        const prevPlayer = prev.players.find((p) => p.id === w.id);
        totalDelta += w.balance - (prevPlayer?.balance ?? w.balance);
      });
      setPayoutTotalAmount(Math.max(0, totalDelta));
    }
    prevGameStateRef.current = { currentStage, players };
  }, [currentStage, players, raceResult]);

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

  const getFavoriteColor = (player) => getFavoriteColorStatic(player);

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
  const wheelIsBusy = hasWheelElement && (spinning || cascadeSpinning);
  const leaderboardAutoScrollEnabled = currentStage !== 'RACE_PENDING_RESULT' && !wheelIsBusy;

  const footerVisible = players.length > 0;
  const footerMode = activeElementType ? 'leaderboard' : 'full';
  const layout = usePanelLayout({ currentStage, activeElementType });

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>MKMGA — Race {raceNumber}</span>
        <span style={styles.headerStage}>{currentStage.replace(/_/g, ' ')}</span>
        <span style={styles.headerPot}>POT: <MoneyDelta value={pot}><MoneyTicker value={pot} prefix="$" /></MoneyDelta></span>
        <span style={styles.headerFee}>ENTRY: {entryFeeDisplay}</span>
        <span style={styles.headerJoinUrl}>{gameState.publicJoinUrl || 'NO URL FOUND'}</span>
      </div>

      <div style={styles.stageLayout}>
        <div style={styles.topRow}>
          <AnimatedPanel
            visible={layout.activeElement.visible}
            enterFrom={layout.activeElement.enterFrom}
            exitTo={layout.activeElement.exitTo}
            duration={layout.activeElement.duration}
            ease={layout.activeElement.ease}
            animateWidth={true}
            style={{ ...styles.activePanel, flex: layout.activeElement.flexWeight }}
          >
            <ActiveElementPanel
              elementType={activeElementType}
              players={players}
              gameState={gameState}
              groupVote={groupVote}
              voteResult={voteResult}
              voteTimeLeft={voteTimeLeft}
              voteCounts={voteCounts}
              positionVote={positionVote}
              positionVoteResult={positionVoteResult}
              positionVoteTimeLeft={positionVoteTimeLeft}
              segments={segments}
              targetIndex={targetIndex}
              spinning={spinning}
              highlightIndex={highlightIndex}
              wheelOpacity={wheelOpacity}
              avatarOpacity={avatarOpacity}
              avatarScale={avatarScale}
              pickerPlayer={pickerPlayer}
              pickerName={pickerName}
              wheelSpawnKey={wheelSpawnKey}
              cascadeActive={cascadeActive}
              cascadeSpinData={cascadeSpinData}
              cascadeSpinning={cascadeSpinning}
              cascadeSpinResult={cascadeSpinResult}
              cascadeSpinDataRef={cascadeSpinDataRef}
              cascadeResultHoldTimeoutRef={cascadeResultHoldTimeoutRef}
              handleSpinComplete={handleSpinComplete}
              clearCascadeResultHoldTimeout={clearCascadeResultHoldTimeout}
              setCascadeSpinResult={setCascadeSpinResult}
              setCascadeSpinning={setCascadeSpinning}
              socket={socket}
              wheelContextTitle={wheelContextTitle}
              spinContextLine1={spinContextLine1}
              spinContextLine2={spinContextLine2}
              cascadePromptPlayer={cascadePromptPlayer}
              payoutWinners={payoutWinners}
              payoutTotalAmount={payoutTotalAmount}
              onPayoutEffectDone={handlePayoutEffectDone}
              getFavoriteColor={getFavoriteColor}
            />
          </AnimatedPanel>

          {/* Leaderboard column — contains the leaderboard + leaderboard-mode footer */}
          <div style={{ ...styles.leaderboardCol, flex: layout.leaderboard.flexWeight, minWidth: layout.leaderboard.minWidth }}>
          <AnimatedPanel
            visible={layout.leaderboard.visible}
            enterFrom={layout.leaderboard.enterFrom}
            exitTo={layout.leaderboard.exitTo}
            duration={layout.leaderboard.duration}
            ease={layout.leaderboard.ease}
            style={styles.leaderboardPanel}
          >
            <LeaderboardPanel
              players={players}
              gameState={gameState}
              activeTimer={activeTimer}
              wheelFocusPlayerId={wheelFocusPlayerId}
              payoutWinnerIds={payoutWinnerIds}
              payoutTotalAmount={payoutTotalAmount}
              payoutScrollReady={payoutScrollReady}
              autoScrollEnabled={leaderboardAutoScrollEnabled}
              socket={socket}
              getFavoriteColor={getFavoriteColor}
              fullWidth={layout.leaderboard.fullWidth}
            />
          </AnimatedPanel>

          {/* Footer — leaderboard-only mode (sits below leaderboard column) */}
          <FooterDisplay players={players} visible={footerMode === 'leaderboard' && footerVisible} raceNumber={raceNumber} cascadeSpinsThisRound={cascadeSpinsThisRound} />
        </div>{/* end leaderboardCol */}
        </div>{/* end topRow */}

        {/* Footer — full-width mode (sits below both panels) */}
        <FooterDisplay players={players} visible={footerMode === 'full' && footerVisible} raceNumber={raceNumber} cascadeSpinsThisRound={cascadeSpinsThisRound} />
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
  headerJoinUrl: {
    fontSize: 12,
    color: '#2ecc71',
    fontFamily: 'monospace',
    marginLeft: 'auto',
    background: 'rgba(0, 0, 0, 0.3)',
    padding: '4px 8px',
    borderRadius: 4,
  },
  stageLayout: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  topRow: {
    display: 'flex',
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  activePanel: {
    minWidth: 0,
    minHeight: 0,
    borderRight: '1px solid #222',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'stretch',
  },
  leaderboardCol: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
  },
  leaderboardPanel: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'stretch',
  },
};

export default HostView;
