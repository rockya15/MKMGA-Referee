import { useRef, useEffect, useState, useCallback } from 'react';
import Avatar from '../../components/Avatar';
import MoneyTicker from '../../components/MoneyTicker';
import MoneyDelta from '../../components/MoneyDelta';
import { usePanelProgress } from '../../context/PanelProgressContext';
import { useLeaderboardAutoScroll } from '../../hooks/useLeaderboardAutoScroll';

const LEADERBOARD_PANEL_WIDTH = 460;
const LEADERBOARD_AUTO_SCROLL_SPEED_PX_PER_SECOND = 52;
const LEADERBOARD_AUTO_SCROLL_PAUSE_MS = 3000;
const LEADERBOARD_FOCUS_OVERRIDE_MS = 2600;
const LEADERBOARD_MANUAL_OVERRIDE_MS = 4500;

const LEADERBOARD_POSITION_ORDER = ['1','2','3','4','5','6','7','8','9','10','11','12','DNF'];
const LEADERBOARD_POSITION_RANK = new Map(LEADERBOARD_POSITION_ORDER.map((p, i) => [p, i]));

function getLeaderboardPosition(player) {
  const positions = Array.isArray(player?.positions) ? player.positions : [];
  if (!positions.length) return null;
  return [...positions].sort((a, b) => {
    const ar = LEADERBOARD_POSITION_RANK.get(a) ?? Number.MAX_SAFE_INTEGER;
    const br = LEADERBOARD_POSITION_RANK.get(b) ?? Number.MAX_SAFE_INTEGER;
    return ar - br;
  })[0];
}

function isTokenSpentThisRace(player) {
  return Boolean(!player?.skipFoldTokenAvailable && (player?.skippedRace || player?.folded));
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

/**
 * LeaderboardPanel
 *
 * Props:
 *   players            {Array}
 *   gameState          {object}  – needs: currentStage, wheelOrder, raceResult, entryFee
 *   activeTimer        {object|null}
 *   wheelFocusPlayerId {string|null}
 *   payoutWinnerIds    {Set}
 *   autoScrollEnabled  {boolean}
 *   socket             {object}
 *   getFavoriteColor   {Function}
 *   fullWidth          {boolean}  – expand to full container width
 *   style              {object}
 */
export default function LeaderboardPanel({
  players,
  gameState,
  activeTimer,
  wheelFocusPlayerId,
  payoutWinnerIds,
  autoScrollEnabled,
  socket,
  getFavoriteColor,
  fullWidth = false,
  style,
}) {
  const { currentStage, wheelOrder, raceResult } = gameState;
  const { progress } = usePanelProgress();

  // Gate auto-scroll until panel is substantially visible
  const scrollEnabled = autoScrollEnabled && progress >= 0.95;

  const leaderboardRef = useRef(null);
  const lbStickyHeaderRef = useRef(null);
  const [lbHeaderHeight, setLbHeaderHeight] = useState(58);
  const rowRefs = useRef(new Map());

  useEffect(() => {
    const el = lbStickyHeaderRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setLbHeaderHeight(el.getBoundingClientRect().height));
    ro.observe(el);
    setLbHeaderHeight(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, []);

  // --- Sorting ---
  const WHEEL_STAGES = ['POSITION_ASSIGNMENT'];
  const skippedOrFoldedPlayers = players.filter(isTokenSpentThisRace);
  const activePlayers = players.filter((p) => !isTokenSpentThisRace(p));
  const wheelOrderRank = new Map((wheelOrder ?? []).map((id, i) => [id, i]));
  const compareByWheelOrder = (a, b) => {
    const ar = wheelOrderRank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const br = wheelOrderRank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    if (ar !== br) return ar - br;
    return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
  };
  const payoutResultRank = LEADERBOARD_POSITION_RANK.get(String(raceResult ?? ''));
  const compareByPayoutCloseness = (a, b) => {
    const ac = getClosestPositionRankToResult(a, payoutResultRank);
    const bc = getClosestPositionRankToResult(b, payoutResultRank);
    const ad = Number.isFinite(ac) ? Math.abs(ac - payoutResultRank) : Number.MAX_SAFE_INTEGER;
    const bd = Number.isFinite(bc) ? Math.abs(bc - payoutResultRank) : Number.MAX_SAFE_INTEGER;
    if (ad !== bd) return ad - bd;
    if (ac !== bc) return ac - bc;
    return compareByWheelOrder(a, b);
  };

  const usePayoutClosenessOrder = currentStage === 'PAYOUT' && Number.isFinite(payoutResultRank);
  const useBettingOrder = currentStage === 'BETTING' || currentStage === 'RACE_PENDING_RESULT';

  const payingPlayers = useBettingOrder
    ? activePlayers.filter((p) => getLeaderboardPosition(p) !== null).sort(compareByWheelOrder)
    : usePayoutClosenessOrder
      ? activePlayers.filter((p) => getLeaderboardPosition(p) !== null).sort(compareByPayoutCloseness)
      : activePlayers.filter((p) => getLeaderboardPosition(p) !== null).sort((a, b) => {
          const diff = (LEADERBOARD_POSITION_RANK.get(getLeaderboardPosition(a)) ?? Number.MAX_SAFE_INTEGER)
                     - (LEADERBOARD_POSITION_RANK.get(getLeaderboardPosition(b)) ?? Number.MAX_SAFE_INTEGER);
          return diff !== 0 ? diff : a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
        });

  const awaitingPositionPlayers = useBettingOrder
    ? activePlayers.filter((p) => getLeaderboardPosition(p) === null).sort(compareByWheelOrder)
    : usePayoutClosenessOrder
      ? activePlayers.filter((p) => getLeaderboardPosition(p) === null).sort(compareByPayoutCloseness)
      : activePlayers.filter((p) => getLeaderboardPosition(p) === null)
          .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }));

  const sortedSkippedOrFoldedPlayers = useBettingOrder
    ? skippedOrFoldedPlayers.sort(compareByWheelOrder)
    : usePayoutClosenessOrder
      ? skippedOrFoldedPlayers.sort(compareByPayoutCloseness)
      : skippedOrFoldedPlayers.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }));

  const payingSectionLabel = usePayoutClosenessOrder
    ? `Closest To #${raceResult}`
    : useBettingOrder ? 'Betting Order' : 'Paying Players';
  const payingSectionDisplay = `${payingSectionLabel} (${payingPlayers.length})`;
  const awaitingSectionDisplay = `Awaiting Position (${awaitingPositionPlayers.length})`;
  const skippedSectionDisplay = `Skipped/Folded (${sortedSkippedOrFoldedPlayers.length})`;

  // --- Auto scroll ---
  const onLeaderboardWheel = useLeaderboardAutoScroll({
    containerRef: leaderboardRef,
    rowRefs,
    enabled: scrollEnabled,
    focusPlayerId: wheelFocusPlayerId ?? activeTimer?.playerId ?? null,
    speedPxPerSecond: LEADERBOARD_AUTO_SCROLL_SPEED_PX_PER_SECOND,
    edgePauseMs: LEADERBOARD_AUTO_SCROLL_PAUSE_MS,
    focusOverrideMs: LEADERBOARD_FOCUS_OVERRIDE_MS,
    manualOverrideMs: LEADERBOARD_MANUAL_OVERRIDE_MS,
    debugReporter: useCallback((payload) => {
      socket?.emit('system-debug-print', {
        source: 'host-view-leaderboard',
        algoVersion: 'v2-carry-52',
        stage: currentStage,
        ...payload,
      });
    }, [socket, currentStage]),
  });

  // --- Row renderer ---
  const renderRow = (player, index, { dimmed = false, showRank = true } = {}) => {
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
      : isWheelFocus ? '#2a2410'
      : player.balance <= 0 ? '#1a0000'
      : rowDimmed ? '#161616'
      : index % 2 === 0 ? '#151515' : '#1c1c1c';

    return (
      <div
        key={player.id}
        ref={(el) => {
          if (el) rowRefs.current.set(player.id, el);
          else rowRefs.current.delete(player.id);
        }}
        style={{
          ...s.lbRow,
          opacity: player.balance <= 0 ? 0.4 : rowDimmed ? 0.7 : 1,
          filter: rowDimmed ? 'grayscale(0.45)' : 'none',
          background: isPayoutWinner
            ? 'linear-gradient(90deg, rgba(133,95,30,0.95) 0%, rgba(199,156,53,0.96) 52%, rgba(133,95,30,0.95) 100%)'
            : normalBackground,
          border: isPayoutWinner ? '1px solid #f2d57a'
            : isOnClock ? `1px solid ${timerUrgent ? '#e74c3c' : '#2ecc71'}`
            : isWheelFocus ? '1px solid #f0c040'
            : rowDimmed ? '1px solid #2b2b2b'
            : '1px solid transparent',
          boxShadow: isPayoutWinner ? '0 0 18px rgba(240,192,64,0.45), inset 0 0 14px rgba(255,220,120,0.25)' : 'none',
          color: isPayoutWinner ? payoutTextColor : undefined,
        }}
      >
        <span style={{ ...s.lbRank, color: isPayoutWinner ? payoutTextColor : s.lbRank.color }}>
          {showRank ? `#${index + 1}` : '...'}
        </span>
        <Avatar player={player} size={40} borderColor={getFavoriteColor(player)} getFavoriteColor={getFavoriteColor} />
        <span style={{ ...s.lbName, color: isPayoutWinner ? payoutTextColor : undefined }}>{player.displayName}</span>
        {isWheelFocus && !isOnClock && <span style={s.lbFocusBadge}>FOCUS</span>}
        {isOnClock && (
          <span style={{ ...s.lbTimerBadge, color: timerUrgent ? '#e74c3c' : '#2ecc71', borderColor: timerUrgent ? '#e74c3c' : '#2ecc71' }}>
            {activeTimer.timeLeft}s
          </span>
        )}
        <MoneyDelta value={player.balance}>
          <MoneyTicker value={player.balance} prefix="$" style={{ ...s.lbBalance, color: isPayoutWinner ? payoutTextColor : s.lbBalance.color }} />
        </MoneyDelta>
        {player.positions?.length > 0 && (
          <span style={{ ...s.lbPositions, color: isPayoutWinner ? payoutTextColor : s.lbPositions.color }}>
            [{player.positions.join(', ')}]
          </span>
        )}
        {tokenLabel && (
          <span style={{ ...s.lbNoToken, background: isPayoutWinner ? '#3e3210' : s.lbNoToken.background, color: isPayoutWinner ? '#121212' : s.lbNoToken.color }}>
            {tokenLabel}
          </span>
        )}
      </div>
    );
  };

  return (
    <div
      ref={leaderboardRef}
      className="host-leaderboard-scroll"
      onWheel={onLeaderboardWheel}
      style={{
        ...s.leaderboard,
        ...(fullWidth ? s.leaderboardFullWidth : null),
        ...style,
      }}
    >
      <div ref={lbStickyHeaderRef} style={s.lbStickyHeader}>
        <div style={s.lbTitle}>LEADEROARD</div>
      </div>

      {payingPlayers.length > 0 && (
        <>
          <div style={{ ...s.lbDivider, top: lbHeaderHeight }}>
            <span style={s.lbDividerLine} />
            <span style={s.lbDividerLabel}>{payingSectionDisplay}</span>
            <span style={s.lbDividerLine} />
          </div>
          {payingPlayers.map((p, i) => renderRow(p, i))}
        </>
      )}

      {awaitingPositionPlayers.length > 0 && (
        <>
          <div style={{ ...s.lbDivider, top: lbHeaderHeight }}>
            <span style={s.lbDividerLine} />
            <span style={s.lbDividerLabel}>{awaitingSectionDisplay}</span>
            <span style={s.lbDividerLine} />
          </div>
          {awaitingPositionPlayers.map((p, i) => renderRow(p, i, { dimmed: true, showRank: false }))}
        </>
      )}

      {sortedSkippedOrFoldedPlayers.length > 0 && (
        <>
          <div style={{ ...s.lbDivider, top: lbHeaderHeight }}>
            <span style={s.lbDividerLine} />
            <span style={s.lbDividerLabel}>{skippedSectionDisplay}</span>
            <span style={s.lbDividerLine} />
          </div>
          {sortedSkippedOrFoldedPlayers.map((p, i) => renderRow(p, i, { dimmed: true, showRank: false }))}
        </>
      )}
    </div>
  );
}

const s = {
  leaderboard: {
    width: '100%',
    minWidth: LEADERBOARD_PANEL_WIDTH,
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
  leaderboardFullWidth: { minWidth: 0 },
  // ^^ clear the minWidth constraint when leaderboard is full-width (no active panel competing)
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
    background: 'rgba(16,16,16,0.97)',
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
  lbDividerLine: { flex: 1, height: 1, background: '#313131' },
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
};
