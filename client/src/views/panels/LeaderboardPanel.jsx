import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
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
const DEATH_GIF_SRC = '/assets/death.gif';
const ROW_HEIGHT = 56; // Fixed height per row in pixels
const ROW_GAP = 4; // Gap between rows
const DIVIDER_HEIGHT = 36; // Height for section divider labels
const ANIMATION_DURATION_MS = 450; // Spring animation duration

// Spring easing that overshoots slightly (like Balatro)
const SPRING_EASING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

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

function isEliminatedPlayer(player) {
  if (!player) return false;
  if (player.eliminationState === 'pending_resurrection' || player.eliminationState === 'failed_resurrection') {
    return true;
  }
  return Number(player.balance) <= 0 && !player.paidEntry;
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
 * LeaderboardPanel V2 — Balatro-style spring animations
 *
 * Players are positioned absolutely and move smoothly between categories
 * with spring physics. Z-index swaps at 50% of animation for climbing effect.
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
  const scrollEnabled = autoScrollEnabled && progress >= 0.95;

  const leaderboardRef = useRef(null);
  const lbStickyHeaderRef = useRef(null);
  const containerRef = useRef(null);
  const [lbHeaderHeight, setLbHeaderHeight] = useState(58);
  const rowRefs = useRef(new Map());
  const prevPositionsRef = useRef(new Map()); // Track previous visual positions
  const [animationState, setAnimationState] = useState({}); // { playerId: { fromY, toY, startTime } }
  const [playerTransitions, setPlayerTransitions] = useState({});
  const [stickyPlayerId, setStickyPlayerId] = useState(null);
  const [stickyScrolled, setStickyScrolled] = useState(false);
  const [lbScrollTop, setLbScrollTop] = useState(0);
  const activePlayerId = activeTimer?.playerId ?? null;

  // --- Categorization and Sorting (same as before) ---
  const WHEEL_STAGES = ['POSITION_ASSIGNMENT'];
  const eliminatedPlayers = players.filter(isEliminatedPlayer);
  const nonEliminatedPlayers = players.filter((p) => !isEliminatedPlayer(p));
  const skippedOrFoldedPlayers = nonEliminatedPlayers.filter(isTokenSpentThisRace);
  const activePlayers = nonEliminatedPlayers.filter((p) => !isTokenSpentThisRace(p));

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
    return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
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

  // --- Build flat player list with calculated positions ---
  const allPlayersList = useMemo(() => {
    const list = [];
    let yOffset = 0; // Start flush with the sticky section bar
    let globalRowIndex = 0; // For stable alternating backgrounds

    const payingSectionLabel = usePayoutClosenessOrder
      ? `Closest To #${raceResult}`
      : useBettingOrder ? 'Betting Order' : 'Paying Players';


    // Track if this is the first section divider
    let isFirstDivider = true;

    // Paying section
    if (payingPlayers.length > 0) {
      list.push({ type: 'divider', key: 'divider-paying', label: `${payingSectionLabel} (${payingPlayers.length})`, targetY: yOffset });
      // Do NOT increment yOffset here; rows start immediately after divider
      payingPlayers.forEach((p, i) => {
        yOffset += DIVIDER_HEIGHT * (i === 0 ? 1 : 0); // Only increment for the first row
        list.push({
          type: 'row',
          player: p,
          category: 'paying',
          index: i,
          rowIndex: globalRowIndex++,
          targetY: yOffset,
          rank: usePayoutClosenessOrder ? i + 1 : (wheelOrderRank.get(p.id) ?? i) + 1,
          dimmed: false,
        });
        yOffset += ROW_HEIGHT + ROW_GAP;
      });
      isFirstDivider = false;
    }

    // Awaiting section
    if (awaitingPositionPlayers.length > 0) {
      if (!isFirstDivider) yOffset += 8; // Only add gap if not first divider
      list.push({ type: 'divider', key: 'divider-awaiting', label: `Awaiting Position (${awaitingPositionPlayers.length})`, targetY: yOffset });
      awaitingPositionPlayers.forEach((p, i) => {
        yOffset += DIVIDER_HEIGHT * (i === 0 ? 1 : 0);
        list.push({
          type: 'row',
          player: p,
          category: 'awaiting',
          index: i,
          rowIndex: globalRowIndex++,
          targetY: yOffset,
          rank: null,
          dimmed: true,
        });
        yOffset += ROW_HEIGHT + ROW_GAP;
      });
      isFirstDivider = false;
    }

    // Skipped/Folded section
    if (sortedSkippedOrFoldedPlayers.length > 0) {
      if (!isFirstDivider) yOffset += 8;
      list.push({ type: 'divider', key: 'divider-skipped', label: `Skipped/Folded (${sortedSkippedOrFoldedPlayers.length})`, targetY: yOffset });
      sortedSkippedOrFoldedPlayers.forEach((p, i) => {
        yOffset += DIVIDER_HEIGHT * (i === 0 ? 1 : 0);
        list.push({
          type: 'row',
          player: p,
          category: 'skipped',
          index: i,
          rowIndex: globalRowIndex++,
          targetY: yOffset,
          rank: null,
          dimmed: true,
        });
        yOffset += ROW_HEIGHT + ROW_GAP;
      });
      isFirstDivider = false;
    }

    // Eliminated section
    if (eliminatedPlayers.length > 0) {
      if (!isFirstDivider) yOffset += 8;
      list.push({ type: 'divider', key: 'divider-eliminated', label: `Eliminated Players (${eliminatedPlayers.length})`, targetY: yOffset });
      eliminatedPlayers
        .slice()
        .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }))
        .forEach((p, i) => {
          yOffset += DIVIDER_HEIGHT * (i === 0 ? 1 : 0);
          list.push({
            type: 'row',
            player: p,
            category: 'eliminated',
            index: i,
            rowIndex: globalRowIndex++,
            targetY: yOffset,
            rank: null,
            dimmed: true,
          });
          yOffset += ROW_HEIGHT + ROW_GAP;
        });
      isFirstDivider = false;
    }

    return list;
  }, [payingPlayers, awaitingPositionPlayers, sortedSkippedOrFoldedPlayers, eliminatedPlayers, usePayoutClosenessOrder, useBettingOrder, raceResult]);

  // --- Detect position changes and trigger animations ---
  useEffect(() => {
    const newAnimationState = {};

    allPlayersList.forEach((entry) => {
      if (entry.type !== 'row') return; // Skip dividers
      const playerId = entry.player.id;
      const prevY = prevPositionsRef.current.get(playerId);
      const targetY = entry.targetY;

      if (prevY !== undefined && prevY !== targetY) {
        // Player has moved — initiate animation
        newAnimationState[playerId] = {
          fromY: prevY,
          toY: targetY,
          startTime: Date.now(),
        };
      }

      prevPositionsRef.current.set(playerId, targetY);
    });

    if (Object.keys(newAnimationState).length > 0) {
      setAnimationState((prev) => ({ ...prev, ...newAnimationState }));
    }
  }, [allPlayersList]);

  // --- Update animation progress ---
  useEffect(() => {
    const animFrame = setInterval(() => {
      setAnimationState((prev) => {
        const updated = { ...prev };
        const now = Date.now();

        Object.entries(updated).forEach(([playerId, anim]) => {
          const elapsed = now - anim.startTime;
          if (elapsed >= ANIMATION_DURATION_MS) {
            delete updated[playerId];
          }
        });

        return updated;
      });
    }, 16); // 60fps

    return () => clearInterval(animFrame);
  }, []);

  // --- Detect transition labels (only for skip/folded/eliminated state changes) ---
  const prevCategoriesRef = useRef({});
  useEffect(() => {
    const getPlayerCategory = (p) => {
      if (isEliminatedPlayer(p)) return 'eliminated';
      if (isTokenSpentThisRace(p)) return 'skipped';
      if (getLeaderboardPosition(p) === null) return 'awaiting';
      return 'paying';
    };

    const currentCategories = {};
    players.forEach((p) => {
      currentCategories[p.id] = getPlayerCategory(p);
    });

    const newTransitions = { ...playerTransitions };
    Object.keys(currentCategories).forEach((playerId) => {
      const prev = prevCategoriesRef.current[playerId];
      const curr = currentCategories[playerId];
      if (prev && prev !== curr && curr !== 'paying' && curr !== 'awaiting') {
        const player = players.find((p) => p.id === playerId);
        if (player) {
          let label = 'ELIMINATED';
          if (curr === 'skipped') {
            label = player.skippedRace ? 'SKIPPED' : 'FOLDED';
          }
          newTransitions[playerId] = { phase: 'announcing', label, startTime: Date.now() };
        }
      }
    });
    setPlayerTransitions(newTransitions);
    prevCategoriesRef.current = currentCategories;
  }, [players, playerTransitions]);

  useEffect(() => {
    const timer = setInterval(() => {
      setPlayerTransitions((prev) => {
        const updated = { ...prev };
        const now = Date.now();
        Object.entries(updated).forEach(([playerId, trans]) => {
          if (trans.phase === 'announcing' && now - trans.startTime >= 1000) {
            updated[playerId] = { ...trans, phase: 'done' };
          }
        });
        return updated;
      });
    }, 50);
    return () => clearInterval(timer);
  }, []);

  // --- Header height measurement ---
  useEffect(() => {
    const el = lbStickyHeaderRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setLbHeaderHeight(el.getBoundingClientRect().height));
    ro.observe(el);
    setLbHeaderHeight(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, []);

  // --- Track scroll position for sticky section headers ---
  useEffect(() => {
    const el = leaderboardRef.current;
    if (!el) return undefined;
    const onScroll = () => setLbScrollTop(el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // --- Compute sticky section label from scroll position ---
  const dividers = useMemo(
    () => allPlayersList.filter((e) => e.type === 'divider'),
    [allPlayersList]
  );

  const stickySectionLabel = useMemo(() => {
    if (dividers.length === 0) return null;
    let currentIdx = -1;
    for (let i = 0; i < dividers.length; i++) {
      if (dividers[i].targetY <= lbScrollTop) currentIdx = i;
    }
    if (currentIdx === -1) return null;
    return dividers[currentIdx].label;
  }, [dividers, lbScrollTop]);

  // --- Sticky active player ---
  useEffect(() => {
    const stickPhases = ['POSITION_ASSIGNMENT', 'BETTING', 'RACE_PENDING_RESULT'];
    if (stickPhases.includes(currentStage) && activePlayerId) {
      if (stickyPlayerId !== activePlayerId) {
        setStickyPlayerId(activePlayerId);
        setStickyScrolled(false);
      }
    } else {
      setStickyPlayerId(null);
      setStickyScrolled(false);
    }
  }, [currentStage, activePlayerId, stickyPlayerId]);

  useEffect(() => {
    if (stickyPlayerId && !stickyScrolled && leaderboardRef.current) {
      const playerEl = rowRefs.current.get(stickyPlayerId);
      if (playerEl) {
        setTimeout(() => {
          playerEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setStickyScrolled(true);
        }, 100);
      }
    }
  }, [stickyPlayerId, stickyScrolled]);

  // --- Auto scroll (reuse existing hook) ---
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
        channel: 'leaderboard-scroll',
        algoVersion: 'v2-spring-animations',
        stage: currentStage,
        ...payload,
      });
    }, [socket, currentStage]),
  });

  // --- Compute current Y position for player (animated or static) ---
  const getPlayerYPosition = (playerId) => {
    const entry = allPlayersList.find((e) => e.type === 'row' && e.player.id === playerId);
    if (!entry) return 0;

    const anim = animationState[playerId];
    if (!anim) return entry.targetY;

    const elapsed = Date.now() - anim.startTime;
    const progress = Math.min(elapsed / ANIMATION_DURATION_MS, 1);

    // Cubic-bezier spring easing manually calculated
    const t = progress;
    // cubic-bezier(0.34, 1.56, 0.64, 1)
    const p0 = 0.34;
    const p1 = 1.56;
    const p2 = 0.64;
    const p3 = 1;
    const mt = 1 - t;
    const eased = mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;

    return anim.fromY + (anim.toY - anim.fromY) * eased;
  };

  // --- Compute z-index (swap at 50% of animation) ---
  const getPlayerZIndex = (playerId) => {
    const anim = animationState[playerId];
    if (!anim) return 0;

    const elapsed = Date.now() - anim.startTime;
    const progress = Math.min(elapsed / ANIMATION_DURATION_MS, 1);

    // If moving UP (fromY > toY) and past 50%, bring to front
    if (anim.fromY > anim.toY && progress > 0.5) {
      return 10;
    }
    // If moving DOWN and before 50%, keep at front
    if (anim.fromY < anim.toY && progress < 0.5) {
      return 10;
    }
    return 0;
  };

  // --- Row renderer ---
  const renderRow = (player, { dimmed = false, showRank = null, rowIndex = 0 } = {}) => {
    const isOnClock = activeTimer?.playerId === player.id;
    const timerUrgent = isOnClock && activeTimer.timeLeft <= 10;
    const isWheelFocus = WHEEL_STAGES.includes(currentStage) && wheelFocusPlayerId === player.id;
    const tokenSpentThisRace = isTokenSpentThisRace(player);
    const tokenLabel = tokenSpentThisRace
      ? (player.skippedRace ? 'SKIPPED' : 'FOLDED')
      : (!player.skipFoldTokenAvailable ? 'NO TOKEN' : null);
    const noReviveLabel = (player.noRevive || player.eliminationState === 'failed_resurrection') ? 'NO REVIVE' : null;
    const rowDimmed = dimmed || tokenSpentThisRace;
    const rowEliminated = isEliminatedPlayer(player);
    const isPayoutWinner = currentStage === 'PAYOUT' && payoutWinnerIds.has(player.id);
    const isPayoutSilver = currentStage === 'PAYOUT' && !isPayoutWinner && showRank === 2;
    const isPayoutBronze = currentStage === 'PAYOUT' && !isPayoutWinner && !isPayoutSilver && showRank === 3;
    const isPayoutPodium = isPayoutWinner || isPayoutSilver || isPayoutBronze;
    const payoutTextColor = '#0e0c08';
    const transition = playerTransitions[player.id];
    const showTransitionLabel = transition?.phase === 'announcing';
    const normalBackground = isOnClock
      ? (timerUrgent ? '#2a0000' : '#001a0a')
      : isWheelFocus ? '#2a2410'
      : rowEliminated ? '#1a0000'
      : rowDimmed ? '#161616'
      : rowIndex % 2 === 0 ? '#151515' : '#1c1c1c';

    return (
      <div
        style={{
          ...s.lbRow,
          opacity: rowEliminated ? 0.4 : rowDimmed ? 0.7 : 1,
          filter: rowDimmed ? 'grayscale(0.45)' : 'none',
          background: isPayoutWinner
            ? 'linear-gradient(90deg, rgba(133,95,30,0.95) 0%, rgba(199,156,53,0.96) 52%, rgba(133,95,30,0.95) 100%)'
            : isPayoutSilver
            ? 'linear-gradient(90deg, rgba(55,58,68,0.95) 0%, rgba(140,148,160,0.96) 52%, rgba(55,58,68,0.95) 100%)'
            : isPayoutBronze
            ? 'linear-gradient(90deg, rgba(65,40,18,0.95) 0%, rgba(148,90,40,0.96) 52%, rgba(65,40,18,0.95) 100%)'
            : normalBackground,
          border: isPayoutWinner ? '1px solid #f2d57a'
            : isPayoutSilver ? '1px solid #b8c4d0'
            : isPayoutBronze ? '1px solid #c47c30'
            : isOnClock ? `1px solid ${timerUrgent ? '#e74c3c' : '#2ecc71'}`
            : isWheelFocus ? '1px solid #f0c040'
            : rowDimmed ? '1px solid #2b2b2b'
            : '1px solid transparent',
          boxShadow: isPayoutWinner
            ? '0 0 18px rgba(240,192,64,0.45), inset 0 0 14px rgba(255,220,120,0.25)'
            : isPayoutSilver
            ? '0 0 14px rgba(180,195,210,0.35), inset 0 0 10px rgba(200,215,230,0.2)'
            : isPayoutBronze
            ? '0 0 14px rgba(195,125,55,0.35), inset 0 0 10px rgba(215,145,75,0.2)'
            : 'none',
          color: isPayoutPodium ? payoutTextColor : undefined,
        }}
      >
        <span style={{ ...s.lbRank, color: isPayoutPodium ? payoutTextColor : s.lbRank.color }}>
          {showRank !== null ? `#${showRank}` : '...'}
        </span>
        <Avatar player={player} size={40} borderColor={getFavoriteColor(player)} getFavoriteColor={getFavoriteColor} />
        <span style={{ ...s.lbName, color: isPayoutPodium ? payoutTextColor : undefined }}>{player.displayName}</span>
        {isWheelFocus && !isOnClock && <span style={s.lbFocusBadge}>FOCUS</span>}
        {isOnClock && (
          <span style={{ ...s.lbTimerBadge, color: timerUrgent ? '#e74c3c' : '#2ecc71', borderColor: timerUrgent ? '#e74c3c' : '#2ecc71' }}>
            {activeTimer.timeLeft}s
          </span>
        )}
        {tokenLabel && (
          <span style={{ ...s.lbNoToken, background: isPayoutPodium ? '#3e3210' : s.lbNoToken.background, color: isPayoutPodium ? '#121212' : s.lbNoToken.color }}>
            {tokenLabel}
          </span>
        )}
        {noReviveLabel && (
          <span style={{ ...s.lbNoRevive, background: isPayoutPodium ? '#3e3210' : s.lbNoRevive.background, color: isPayoutPodium ? '#121212' : s.lbNoRevive.color }}>
            {noReviveLabel}
          </span>
        )}
        <MoneyDelta value={player.balance}>
          <MoneyTicker value={player.balance} prefix="$" style={{ ...s.lbBalance, color: isPayoutPodium ? payoutTextColor : s.lbBalance.color }} />
        </MoneyDelta>
        {player.positions?.length > 0 && (
          <span style={{ ...s.lbPositions, color: isPayoutPodium ? payoutTextColor : s.lbPositions.color }}>
            [{player.positions.join(', ')}]
          </span>
        )}
        {rowEliminated && !showTransitionLabel && (
          <img
            src={DEATH_GIF_SRC}
            alt="Eliminated"
            style={s.lbDeathOverlay}
          />
        )}
        {showTransitionLabel && (
          <div style={s.lbTransitionOverlay} className="lb-transition-label-show">
            <div style={s.lbTransitionLabel}>{transition.label}</div>
          </div>
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
      {/* Header */}
      <div ref={lbStickyHeaderRef} style={s.lbStickyHeader}>
        <div style={s.lbTitle}>LEADERBOARD</div>
        {/* Clip always rendered so lbHeaderHeight stays stable */}
        <div style={s.lbStickySectionClip}>
          {stickySectionLabel && (
            <div style={{ ...s.lbStickySection, position: 'absolute', top: 0, left: 0, right: 0 }}>
              <span style={s.lbDividerLine} />
              <span style={s.lbDividerLabel}>{stickySectionLabel}</span>
              <span style={s.lbDividerLine} />
            </div>
          )}
        </div>
      </div>

      {/* Absolute-positioned player container */}
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          width: '100%',
          height: Math.max(
            ...allPlayersList.map((e) => e.type === 'divider' ? e.targetY + DIVIDER_HEIGHT : e.targetY + ROW_HEIGHT),
            ROW_HEIGHT
          ) + 20,
        }}
      >
        {allPlayersList.map((entry) => {
          // Render section dividers
          if (entry.type === 'divider') {
            // Hide only once this divider reaches the sticky boundary.
            const inHeaderZone = entry.targetY <= lbScrollTop;
            return (
              <div
                key={entry.key}
                style={{
                  position: 'absolute',
                  top: entry.targetY,
                  left: 0,
                  right: 0,
                  height: DIVIDER_HEIGHT,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  zIndex: 2,
                  visibility: inHeaderZone ? 'hidden' : 'visible',
                }}
              >
                <span style={s.lbDividerLine} />
                <span style={s.lbDividerLabel}>{entry.label}</span>
                <span style={s.lbDividerLine} />
              </div>
            );
          }

          // Render player rows
          const { player } = entry;
          const currentY = getPlayerYPosition(player.id);
          const zIdx = getPlayerZIndex(player.id);
          const isStickyThisRow = stickyPlayerId === player.id;

          return (
            <div
              key={player.id}
              ref={(el) => {
                if (el) rowRefs.current.set(player.id, el);
                else rowRefs.current.delete(player.id);
              }}
              style={{
                position: isStickyThisRow ? 'sticky' : 'absolute',
                top: isStickyThisRow ? lbHeaderHeight + 40 : currentY,
                left: 0,
                right: 0,
                zIndex: isStickyThisRow ? 20 : zIdx,
                transition: Object.keys(animationState).includes(player.id)
                  ? `top ${ANIMATION_DURATION_MS}ms ${SPRING_EASING}`
                  : undefined,
              }}
            >
              {renderRow(player, { dimmed: entry.dimmed, showRank: entry.rank, rowIndex: entry.rowIndex })}
            </div>
          );
        })}
      </div>
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
    gap: 0,
    background: '#101010',
    overscrollBehavior: 'contain',
  },
  leaderboardFullWidth: { minWidth: 0 },
  lbTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 2,
    color: '#f0c040',
    textTransform: 'uppercase',
    marginBottom: 0,
  },
  lbStickyHeader: {
    position: 'sticky',
    top: 0,
    zIndex: 30,
    background: 'rgba(16,16,16,0.97)',
    backdropFilter: 'blur(2px)',
    padding: '14px 18px 0',
    margin: '0 -18px 0',
  },
  lbRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 14px',
    borderRadius: 6,
    fontSize: 15,
    height: ROW_HEIGHT,
  },
  lbRank: { color: '#666', width: 28, flexShrink: 0 },
  lbName: { flex: 1, fontWeight: 'bold' },
  lbBalance: { color: '#2ecc71', fontWeight: 'bold', minWidth: 60, textAlign: 'right' },
  lbPositions: {
    color: '#888',
    fontSize: 12,
    position: 'absolute',
    left: '50%',
    transform: 'translateX(-50%)',
    textAlign: 'center',
    pointerEvents: 'none',
    background: 'rgba(0, 0, 0, 0.2)',
    borderRadius: 4,
    padding: '1px 6px',
  },
  lbNoToken: {
    fontSize: 10,
    background: '#5a1a1a',
    color: '#f66',
    padding: '2px 6px',
    borderRadius: 4,
    marginLeft: 4,
    position: 'relative',
    zIndex: 10,
  },
  lbNoRevive: {
    fontSize: 10,
    background: '#4a3412',
    color: '#f0c040',
    padding: '2px 6px',
    borderRadius: 4,
    marginLeft: 4,
    position: 'relative',
    zIndex: 10,
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
    position: 'relative',
    zIndex: 10,
  },
  lbTimerBadge: {
    fontSize: 13,
    fontWeight: 'bold',
    border: '1px solid',
    borderRadius: 4,
    padding: '1px 6px',
    marginRight: 4,
    fontVariantNumeric: 'tabular-nums',
    zIndex: 10,
    position: 'relative',
  },
  lbDeathOverlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 54,
    height: 54,
    transform: 'translate(-50%, -50%)',
    opacity: 0.5,
    pointerEvents: 'none',
    objectFit: 'cover',
    borderRadius: 6,
  },
  lbTransitionOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0, 0, 0, 0.75)',
    borderRadius: 6,
    backdropFilter: 'blur(1px)',
  },
  lbTransitionLabel: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ff6b6b',
    textTransform: 'uppercase',
    letterSpacing: 2.2,
    textShadow: '0 0 18px rgba(255, 107, 107, 0.8)',
  },
  lbStickySectionClip: {
    position: 'relative',
    height: DIVIDER_HEIGHT,
    overflow: 'hidden',
  },
  lbStickySection: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    height: DIVIDER_HEIGHT,
  },
  lbDividerLine: { flex: 1, height: 1, background: '#313131' },
  lbDividerLabel: {
    color: '#8a8a8a',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  },
};
