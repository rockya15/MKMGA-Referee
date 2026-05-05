import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import Avatar from '../../components/Avatar';
import MoneyTicker from '../../components/MoneyTicker';
import MoneyDelta from '../../components/MoneyDelta';
import LeaderboardCanvas from '../../components/LeaderboardCanvas';
import { usePanelProgress } from '../../context/PanelProgressContext';
import { useLeaderboardAutoScroll } from '../../hooks/useLeaderboardAutoScroll';

// ─── Layout constants ────────────────────────────────────────────────────────
const LEADERBOARD_PANEL_WIDTH = 460;
const ROW_HEIGHT = 56;
const ROW_GAP = 4;
const DIVIDER_HEIGHT = 36;
const DEATH_GIF_SRC = '/assets/death.gif';

// ─── Scroll constants ────────────────────────────────────────────────────────
const LEADERBOARD_AUTO_SCROLL_SPEED_PX_PER_SECOND = 52;
const LEADERBOARD_AUTO_SCROLL_PAUSE_MS = 3000;
const LEADERBOARD_FOCUS_OVERRIDE_MS = 2600;
const LEADERBOARD_MANUAL_OVERRIDE_MS = 4500;

// ─── Movement table constants ───────────────────────────────────────────────
const MOVE_DELAY_MS    = 2000;
const MOVE_TICK_MS     = 100;
const MOVE_TWEEN_MS    = 60;
const MOVE_SETTLE_PX   = 0.4;
const TRANSITION_IN_ZONE_MS = 1000;
const TRANSITION_FADE_MS = 420;
const TRANSITION_POP_MS = 380;
const SCHEDULER_STATE  = {
  IDLE: 'IDLE',
  HOLDING: 'HOLDING',
  STEPPING: 'STEPPING',
  TWEENING: 'TWEENING',
  SETTLING: 'SETTLING',
};

// ─── Position rank tables ────────────────────────────────────────────────────
const LEADERBOARD_POSITION_ORDER = ['1','2','3','4','5','6','7','8','9','10','11','12','DNF'];
const LEADERBOARD_POSITION_RANK  = new Map(LEADERBOARD_POSITION_ORDER.map((p, i) => [p, i]));
const CATEGORY_LABELS = {
  paying:    'Payout Positions',
  awaiting:  'Awaiting Positions',
  skipped:   'Skipped / Folded',
  eliminated: 'Eliminated',
};
const LAYOUT_CATEGORY_ORDER = ['paying', 'awaiting', 'skipped', 'eliminated'];

// ─── Pure helper functions ───────────────────────────────────────────────────

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
  return Boolean(player?.skippedRace || player?.folded);
}

function isEliminatedPlayer(player) {
  if (!player) return false;
  if (
    player.eliminationState === 'pending_resurrection' ||
    player.eliminationState === 'failed_resurrection'
  ) return true;
  return Number(player.balance) <= 0 && !player.paidEntry;
}

function getClosestPositionRankToResult(player, resultRank) {
  const positions = Array.isArray(player?.positions) ? player.positions : [];
  if (!Number.isFinite(resultRank) || positions.length === 0) return Number.MAX_SAFE_INTEGER;
  let bestRank = Number.MAX_SAFE_INTEGER;
  let bestDist = Number.MAX_SAFE_INTEGER;
  for (const pos of positions) {
    const rank = LEADERBOARD_POSITION_RANK.get(String(pos));
    if (!Number.isFinite(rank)) continue;
    const dist = Math.abs(rank - resultRank);
    if (dist < bestDist || (dist === bestDist && rank < bestRank)) {
      bestDist = dist;
      bestRank = rank;
    }
  }
  return bestRank;
}

function arraysEqual(a, b) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function comparePlayersByLobbyName(a, b) {
  const aName = getPlayerDisplayName(a);
  const bName = getPlayerDisplayName(b);

  // Primary: case-insensitive alphabetical, matching lobby feel.
  const ci = aName.localeCompare(bName, undefined, { sensitivity: 'base' });
  if (ci !== 0) return ci;

  // Secondary: case-sensitive to make equal-base names deterministic.
  const cs = aName.localeCompare(bName);
  if (cs !== 0) return cs;

  // Final tie-break: stable id ordering (prevents periodic flip-flops).
  return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
}

function stripBotSuffix(name) {
  return String(name ?? '').replace(/\s*\(BOT\)\s*$/i, '').trim();
}

function isBotPlayer(player) {
  if (!player) return false;
  if (Boolean(player.isBot)) return true;
  const id = String(player.id ?? '').toLowerCase();
  const realName = String(player.realName ?? '').toLowerCase();
  return id.startsWith('bot-') || realName.startsWith('bot_');
}

function getPlayerDisplayName(player) {
  const base = player?.displayName ?? player?.realName ?? String(player?.id ?? '');
  return stripBotSuffix(base);
}

function seedDisplayedOrder(currentOrder, desiredOrder) {
  const desiredSet = new Set(desiredOrder);
  const surviving = currentOrder.filter((id) => desiredSet.has(id));
  const survivingSet = new Set(surviving);
  const newIds = desiredOrder.filter((id) => !survivingSet.has(id));
  return [...newIds, ...surviving];
}

function computeDisplayLayout(order, rowMetaById, sectionLabels = {}) {
  const rows = [];
  const dividers = [];
  let y = 0;
  let firstSection = true;

  const orderedRows = order.map((id) => rowMetaById.get(id)).filter(Boolean);
  const n = orderedRows.length;

  // Determine how many bottom cards have PHYSICALLY arrived in each bottom zone
  // by scanning contiguously from the bottom of displayOrder.
  // This drives which cards render inside each section — cards only enter a
  // section visually once they have descended there via adjacent swaps.
  // The divider is shown as soon as the category exists in game state, so the
  // section header appears upfront (no mid-animation layout jump).
  let bottomCursor = n - 1;

  let elimCount = 0;
  while (bottomCursor >= 0 && orderedRows[bottomCursor].category === 'eliminated') {
    elimCount++;
    bottomCursor--;
  }

  let skipCount = 0;
  while (bottomCursor >= 0 && orderedRows[bottomCursor].category === 'skipped') {
    skipCount++;
    bottomCursor--;
  }

  // Top zone — contiguous scan from the TOP for paying, same principle as
  // skipped/eliminated from the bottom.  We scan through paying AND transit
  // cards (skipped/eliminated mid-descent) — stopping only at a genuine
  // 'awaiting' card.  This prevents a folding card that's still physically
  // inside the paying block from creating a spurious "Awaiting Positions" section.
  let payCount = 0;
  while (payCount <= bottomCursor && orderedRows[payCount].category !== 'awaiting') {
    payCount++;
  }
  const awaitCount = bottomCursor + 1 - payCount;

  // Build section list — only include a section when cards are physically present.
  // Headers appear/disappear as cards actually arrive, never ahead of time.
  const sections = [];
  if (payCount   > 0) sections.push({ category: 'paying',    count: payCount   });
  if (awaitCount > 0) sections.push({ category: 'awaiting',  count: awaitCount });
  if (skipCount  > 0) sections.push({ category: 'skipped',   count: skipCount  });
  if (elimCount  > 0) sections.push({ category: 'eliminated', count: elimCount  });

  let cursor = 0;
  for (const section of sections) {
    const baseLabel = sectionLabels[section.category] ?? CATEGORY_LABELS[section.category] ?? section.category;
    dividers.push({
      key: `${section.category}-${dividers.length}`,
      label: `${baseLabel} (${section.count})`,
      targetY: y,
    });
    if (!firstSection) y += DIVIDER_HEIGHT;
    firstSection = false;

    for (let i = 0; i < section.count; i += 1) {
      const meta = orderedRows[cursor];
      rows.push({ ...meta, targetY: y, rowIndex: rows.length });
      y += ROW_HEIGHT + ROW_GAP;
      cursor += 1;
    }
  }

  return { rows, dividers, totalHeight: y };
}

function stepDisplayedOrder(currentOrder, desiredIndexMap, movingIds) {
  const nextOrder = [...currentOrder];
  let changed = false;

  for (let index = 0; index < nextOrder.length - 1; index += 1) {
    const upperId = nextOrder[index];
    const lowerId = nextOrder[index + 1];
    const upperTarget = desiredIndexMap.get(upperId) ?? index;
    const lowerTarget = desiredIndexMap.get(lowerId) ?? (index + 1);
    const inverted = upperTarget > lowerTarget;
    const pairReady = movingIds.has(upperId) || movingIds.has(lowerId);

    if (inverted && pairReady) {
      nextOrder[index] = lowerId;
      nextOrder[index + 1] = upperId;
      changed = true;
      index += 1;
    }
  }

  return changed ? nextOrder : currentOrder;
}

function getBottomContiguousMembership(order, rowMetaById) {
  const skipped = new Set();
  const eliminated = new Set();

  const ordered = order
    .map((id) => ({ id, meta: rowMetaById.get(id) }))
    .filter((entry) => entry.meta);

  let cursor = ordered.length - 1;
  while (cursor >= 0 && ordered[cursor].meta.category === 'eliminated') {
    eliminated.add(ordered[cursor].id);
    cursor -= 1;
  }

  while (cursor >= 0 && ordered[cursor].meta.category === 'skipped') {
    skipped.add(ordered[cursor].id);
    cursor -= 1;
  }

  return { skipped, eliminated };
}

function isCardSettledInCurrentLayout(id, order, rowMetaById, desiredIndexMap) {
  const index = order.indexOf(id);
  if (index < 0) return true;

  const desiredIndex = desiredIndexMap.get(id) ?? index;
  if (desiredIndex !== index) return false;

  const category = rowMetaById.get(id)?.category;
  if (category !== 'skipped' && category !== 'eliminated') return true;

  const membership = getBottomContiguousMembership(order, rowMetaById);
  return category === 'skipped'
    ? membership.skipped.has(id)
    : membership.eliminated.has(id);
}

function isCardInCorrectCategoryZone(id, order, rowMetaById) {
  const category = rowMetaById.get(id)?.category;
  if (category !== 'skipped' && category !== 'eliminated') return true;
  const membership = getBottomContiguousMembership(order, rowMetaById);
  return category === 'skipped'
    ? membership.skipped.has(id)
    : membership.eliminated.has(id);
}

function easeTickProgress(progress) {
  return 0.5 - (Math.cos(progress * Math.PI) / 2);
}

// ─── Layout engine ────────────────────────────────────────────────────────────
/**
 * computeSlots — pure function, no side effects.
 *
 * Returns:
 *   rows[]     { id, player, targetY, rank, dimmed, category, podiumTier, rowIndex }
 *   dividers[] { key, label, targetY }
 *   totalHeight
 *
 * rank is always a number for paying-section players (never the position string).
 *   - useBettingOrder stages  → 1-based wheel-order index
 *   - usePayoutCloseness      → tie-grouped closeness rank (#1 = closest to result)
 * Non-paying sections → rank = null → renders '...'
 *
 * podiumTier: 'gold' | 'silver' | 'bronze' | null
 */
function computeSlots(players, gameState, payoutWinnerIds) {
  const { currentStage, wheelOrder, raceResult } = gameState;
  const rows     = [];
  const dividers = [];

  // ── Categorise ──────────────────────────────────────────────────────────
  const eliminated    = players.filter(isEliminatedPlayer);
  const nonEliminated = players.filter((p) => !isEliminatedPlayer(p));
  const skippedFolded = nonEliminated.filter(isTokenSpentThisRace);
  const active        = nonEliminated.filter((p) => !isTokenSpentThisRace(p));

  // ── Sort helpers ─────────────────────────────────────────────────────────
  const wheelOrderRank = new Map((wheelOrder ?? []).map((id, i) => [id, i]));
  const byWheelOrder = (a, b) => {
    const ar = wheelOrderRank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const br = wheelOrderRank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return ar !== br ? ar - br
      : comparePlayersByLobbyName(a, b);
  };

  const payoutResultRank = LEADERBOARD_POSITION_RANK.get(String(raceResult ?? ''));
  const payoutDistanceById = new Map();
  if (Number.isFinite(payoutResultRank)) {
    active.forEach((p) => {
      const closestRank = getClosestPositionRankToResult(p, payoutResultRank);
      const dist = Number.isFinite(closestRank)
        ? Math.abs(closestRank - payoutResultRank)
        : Number.MAX_SAFE_INTEGER;
      payoutDistanceById.set(p.id, dist);
    });
  }

  const byCloseness = (a, b) => {
    const ad = payoutDistanceById.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const bd = payoutDistanceById.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return ad !== bd ? ad - bd
      : comparePlayersByLobbyName(a, b);
  };
  const byPosition = (a, b) => {
    const ar = LEADERBOARD_POSITION_RANK.get(getLeaderboardPosition(a)) ?? Number.MAX_SAFE_INTEGER;
    const br = LEADERBOARD_POSITION_RANK.get(getLeaderboardPosition(b)) ?? Number.MAX_SAFE_INTEGER;
    return ar !== br ? ar - br
      : comparePlayersByLobbyName(a, b);
  };
  const byName = (a, b) => comparePlayersByLobbyName(a, b);

  // ── Mode flags ───────────────────────────────────────────────────────────
  const useBettingOrder = currentStage === 'BETTING' ||
                          currentStage === 'POSITION_ASSIGNMENT' ||
                          currentStage === 'RACE_PENDING_RESULT';
  const usePayoutCloseness = currentStage === 'PAYOUT' && Number.isFinite(payoutResultRank);

  // ── Sorted lists ─────────────────────────────────────────────────────────
  const paying = active
    .filter((p) => getLeaderboardPosition(p) !== null)
    .sort(useBettingOrder ? byWheelOrder : usePayoutCloseness ? byCloseness : byPosition);

  const awaiting = active
    .filter((p) => getLeaderboardPosition(p) === null)
    .sort(byName);

  const skipped = skippedFolded.slice().sort(useBettingOrder ? byWheelOrder : byName);
  const elim    = eliminated.slice().sort(byName);

  // ── Closeness rank map for paying section ────────────────────────────────
  // Dense ranking: ties share the same rank, next distinct distance group
  // gets rank+1 (not rank+tieCount). So #1,#2,#2,#3,#3,#4,… not #1,#2,#2,#4.
  const closenessRankMap = new Map();
  if (usePayoutCloseness) {
    let relRank  = 1;
    let prevDist = null;
    paying.forEach((p) => {
      const dist = payoutDistanceById.get(p.id) ?? Number.MAX_SAFE_INTEGER;
      if (prevDist !== null && dist !== prevDist) relRank++;
      closenessRankMap.set(p.id, relRank);
      prevDist = dist;
    });
  }

  // ── Flatten to rows + dividers ───────────────────────────────────────────
  let yOffset      = 0;
  let globalIndex  = 0;
  let firstSection = true;

  const addSection = (label, list, category, dimmed, getRank, getPodium) => {
    if (list.length === 0) return;
    if (!firstSection) yOffset += 8;
    dividers.push({ key: `div-${category}`, label: `${label} (${list.length})`, targetY: yOffset });
    list.forEach((p, i) => {
      if (i === 0 && !firstSection) yOffset += DIVIDER_HEIGHT;
      rows.push({
        id:         p.id,
        player:     p,
        targetY:    yOffset,
        rank:       getRank(p, i),
        dimmed,
        category,
        podiumTier: getPodium ? getPodium(p) : null,
        rowIndex:   globalIndex++,
      });
      yOffset += ROW_HEIGHT + ROW_GAP;
    });
    firstSection = false;
  };

  const payingSectionLabel = usePayoutCloseness
    ? `Closest To #${raceResult}`
    : useBettingOrder ? 'Betting Order' : 'Paying Players';

  addSection(
    payingSectionLabel,
    paying,
    'paying',
    false,
    (_p, i) => (usePayoutCloseness ? closenessRankMap.get(_p.id) ?? i + 1 : i + 1),
    (p) => {
      if (payoutWinnerIds?.has(p.id)) return 'gold';
      const r = closenessRankMap.get(p.id);
      if (r === 2) return 'silver';
      if (r === 3) return 'bronze';
      return null;
    },
  );

  addSection('Awaiting Position', awaiting, 'awaiting',  true, () => null, null);
  addSection('Skipped / Folded',  skipped,  'skipped',   true, () => null, null);
  addSection('Eliminated Players',elim,     'eliminated', true, () => null, null);

  return { rows, dividers, totalHeight: yOffset + 20 };
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function LeaderboardPanel({
  players,
  gameState,
  activeTimer,
  wheelFocusPlayerId,
  payoutWinnerIds,
  payoutTotalAmount,
  payoutScrollReady,
  autoScrollEnabled,
  socket,
  getFavoriteColor,
  fullWidth = false,
  style,
}) {
  const { currentStage, wheelOrder, raceResult } = gameState;
  const { progress } = usePanelProgress();
  const scrollEnabled = autoScrollEnabled && progress >= 0.95;

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const leaderboardRef    = useRef(null);
  const lbStickyHeaderRef = useRef(null);
  const containerRef      = useRef(null);
  const rowRefs           = useRef(new Map()); // id → outer wrapper (for auto-scroll hook)
  const canvasRef         = useRef(null);      // LeaderboardCanvas imperative ref

  // ── Movement table refs (never trigger React re-renders) ──────────────────
  const cardElsRef          = useRef(new Map()); // id → wrapper div DOM node
  const visualYRef          = useRef(new Map()); // id → current rendered Y (px)
  const desiredIndexRef     = useRef(new Map()); // id → desired row index in final order
  const holdUntilRef        = useRef(new Map()); // id → performance.now() when card may join movement table
  const movingIdsRef        = useRef(new Set()); // ids currently in the movement table
  const pendingArrivalRef   = useRef(new Set()); // ids that still need an arrival event
  const displayOrderRef     = useRef([]);        // ids in current visual order
  const displayIndexRef     = useRef(new Map()); // id → index in current visual order
  const rowMetaByIdRef      = useRef(new Map()); // id → latest row meta from computeSlots
  const tweenRef            = useRef(null);
  const engineTimeoutRef    = useRef(null);
  const rafRef              = useRef(null);
  const rafRunning          = useRef(false);
  const scheduleEngineRef   = useRef(() => {});
  const schedulerStateRef   = useRef(SCHEDULER_STATE.IDLE);
  const transitionZoneSinceRef = useRef(new Map()); // id -> performance.now() when entered correct zone
  const transitionFadeTimersRef = useRef(new Map()); // id -> timeout handle
  const transitionPopTimersRef = useRef(new Map()); // id -> timeout handle

  // ── React state (layout-level only) ──────────────────────────────────────
  const [lbHeaderHeight,    setLbHeaderHeight]    = useState(58);
  const [lbScrollTop,       setLbScrollTop]        = useState(0);
  const [playerTransitions, setPlayerTransitions]  = useState({});
  const [displayOrder,      setDisplayOrder]       = useState([]);
  const [containerWidth,    setContainerWidth]     = useState(LEADERBOARD_PANEL_WIDTH - 36);
  const stickyPlayerIdRef = useRef(null);
  const activePlayerId = activeTimer?.playerId ?? null;
  const WHEEL_STAGES   = ['POSITION_ASSIGNMENT'];

  // ── Layout engine ──────────────────────────────────────────────────────────
  // Build value-based signatures so layout recomputes when upstream mutates
  // player objects in place (same array identity), while avoiding per-render
  // movement-table resets that break spawn animation.
  const playersLayoutSignature = (players ?? [])
    .map((p) => [
      p?.id,
      p?.displayName ?? '',
      p?.paidEntry ? 1 : 0,
      p?.skipFoldTokenAvailable ? 1 : 0,
      p?.skippedRace ? 1 : 0,
      p?.folded ? 1 : 0,
      p?.eliminationState ?? '',
      Array.isArray(p?.positions) ? p.positions.join(',') : '',
    ].join(':'))
    .join('|');

  const wheelOrderSignature = Array.isArray(wheelOrder) ? wheelOrder.join('|') : '';
  const wheelOrderSet = useMemo(() => new Set(Array.isArray(wheelOrder) ? wheelOrder : []), [wheelOrderSignature]);
  const payoutWinnerSignature = payoutWinnerIds
    ? [...payoutWinnerIds].sort().join('|')
    : '';

  const slots = useMemo(
    () => computeSlots(players, gameState, payoutWinnerIds),
    [playersLayoutSignature, currentStage, raceResult, wheelOrderSignature, payoutWinnerSignature],
  );
  const desiredOrder = useMemo(() => slots.rows.map((row) => row.id), [slots.rows]);
  const desiredIndexMap = useMemo(
    () => new Map(desiredOrder.map((id, index) => [id, index])),
    [desiredOrder],
  );
  const rowMetaById = useMemo(
    () => new Map(slots.rows.map((row) => [row.id, row])),
    [slots.rows],
  );

  const payingSectionLabel = useMemo(() => {
    const useBettingOrder = currentStage === 'BETTING' ||
      currentStage === 'POSITION_ASSIGNMENT' ||
      currentStage === 'RACE_PENDING_RESULT';
    const payoutResultRank = LEADERBOARD_POSITION_RANK.get(String(raceResult ?? ''));
    const usePayoutCloseness = currentStage === 'PAYOUT' && Number.isFinite(payoutResultRank);
    if (usePayoutCloseness) return `Closest To #${raceResult}`;
    if (useBettingOrder) return 'Betting Order';
    return 'Paying Players';
  }, [currentStage, raceResult]);

  const displayLayout = useMemo(
    () => computeDisplayLayout(displayOrder, rowMetaById, { paying: payingSectionLabel }),
    [displayOrder, rowMetaById, payingSectionLabel],
  );

  desiredIndexRef.current = desiredIndexMap;
  rowMetaByIdRef.current = rowMetaById;

  const clearTransitionTimer = useCallback((id) => {
    const handle = transitionFadeTimersRef.current.get(id);
    if (handle) {
      clearTimeout(handle);
      transitionFadeTimersRef.current.delete(id);
    }
  }, []);

  const clearTransitionPopTimer = useCallback((id) => {
    const handle = transitionPopTimersRef.current.get(id);
    if (handle) {
      clearTimeout(handle);
      transitionPopTimersRef.current.delete(id);
    }
  }, []);

  const startTransitionFade = useCallback((id) => {
    clearTransitionPopTimer(id);
    setPlayerTransitions((prev) => {
      const entry = prev[id];
      if (!entry || entry.phase === 'fading') return prev;
      return {
        ...prev,
        [id]: { ...entry, phase: 'fading' },
      };
    });

    clearTransitionTimer(id);
    const timer = setTimeout(() => {
      setPlayerTransitions((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      transitionFadeTimersRef.current.delete(id);
    }, TRANSITION_FADE_MS);
    transitionFadeTimersRef.current.set(id, timer);
  }, [clearTransitionPopTimer, clearTransitionTimer]);

  const startTransitionPopIn = useCallback((id, label) => {
    clearTransitionPopTimer(id);
    setPlayerTransitions((prev) => {
      const existing = prev[id];
      if (existing && existing.label === label && (existing.phase === 'pop-in' || existing.phase === 'announcing')) {
        return prev;
      }
      return {
        ...prev,
        [id]: { label, phase: 'pop-in' },
      };
    });

    const timer = setTimeout(() => {
      setPlayerTransitions((prev) => {
        const entry = prev[id];
        if (!entry || entry.phase !== 'pop-in') return prev;
        return {
          ...prev,
          [id]: { ...entry, phase: 'announcing' },
        };
      });
      transitionPopTimersRef.current.delete(id);
    }, TRANSITION_POP_MS);
    transitionPopTimersRef.current.set(id, timer);
  }, [clearTransitionPopTimer]);

  const maybeFadeTagsInCorrectZone = useCallback((order) => {
    const now = performance.now();
    pendingArrivalRef.current.forEach((id) => {
      if (!isCardInCorrectCategoryZone(id, order, rowMetaByIdRef.current)) {
        transitionZoneSinceRef.current.delete(id);
        return;
      }

      const enteredAt = transitionZoneSinceRef.current.get(id) ?? now;
      transitionZoneSinceRef.current.set(id, enteredAt);
      if (now - enteredAt >= TRANSITION_IN_ZONE_MS) {
        startTransitionFade(id);
      }
    });
  }, [startTransitionFade]);

  const emitCardArrival = useCallback((id) => {
    const el = cardElsRef.current.get(id);
    if (el) {
      el.dispatchEvent(new CustomEvent('leaderboardcardarrived', {
        bubbles: true,
        detail: { playerId: id },
      }));
    }

    startTransitionFade(id);
  }, [startTransitionFade]);

  const commitDisplayOrder = useCallback((nextOrder) => {
    displayOrderRef.current = nextOrder;
    displayIndexRef.current = new Map(nextOrder.map((id, index) => [id, index]));
    setDisplayOrder(nextOrder);
  }, []);

  const setRenderedCardPosition = useCallback((id, y, zIndex = 0) => {
    visualYRef.current.set(id, y);

    const el = cardElsRef.current.get(id);
    if (el && id !== stickyPlayerIdRef.current) {
      el.style.top = `${y}px`;
      el.style.zIndex = String(zIndex);
    }

    canvasRef.current?.setCardPosition?.(id, y, zIndex);
  }, []);

  const setSchedulerState = useCallback((nextState) => {
    schedulerStateRef.current = nextState;
  }, []);

  // ── Tick tween loop ────────────────────────────────────────────────────────
  const startRaf = useCallback(() => {
    if (rafRunning.current) return;
    rafRunning.current = true;

    const tick = (ts) => {
      const tween = tweenRef.current;
      if (!tween) {
        rafRunning.current = false;
        rafRef.current     = null;
        if (!engineTimeoutRef.current && movingIdsRef.current.size === 0 && holdUntilRef.current.size === 0) {
          setSchedulerState(SCHEDULER_STATE.IDLE);
        }
        return;
      }

      const rawProgress = Math.min((ts - tween.startTs) / tween.durationMs, 1);
      const progress = easeTickProgress(rawProgress);

      tween.order.forEach((id) => {
        if (id === stickyPlayerIdRef.current) return;

        const startY = tween.startYById.get(id) ?? 0;
        const endY = tween.endYById.get(id) ?? startY;
        const visualY = startY + ((endY - startY) * progress);

        setRenderedCardPosition(id, visualY, endY < startY ? 10 : 0);
      });

      if (rawProgress >= 1) {
        setSchedulerState(SCHEDULER_STATE.SETTLING);
        tween.order.forEach((id) => {
          const finalY = tween.endYById.get(id) ?? 0;
          if (id === stickyPlayerIdRef.current) return;
          setRenderedCardPosition(id, finalY, 0);
        });

        tweenRef.current = null;
        rafRunning.current = false;
        rafRef.current = null;

        maybeFadeTagsInCorrectZone(tween.order);

        tween.order.forEach((id) => {
          if (isCardSettledInCurrentLayout(id, tween.order, rowMetaByIdRef.current, desiredIndexRef.current)) {
            movingIdsRef.current.delete(id);
            holdUntilRef.current.delete(id);
            if (pendingArrivalRef.current.has(id)) {
              pendingArrivalRef.current.delete(id);
              emitCardArrival(id);
            }
          }
        });

        scheduleEngineRef.current();
        return;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [emitCardArrival, maybeFadeTagsInCorrectZone, setRenderedCardPosition, setSchedulerState]);

  const beginTween = useCallback((nextOrder, durationMs = MOVE_TICK_MS) => {
    const currentLayout = computeDisplayLayout(displayOrderRef.current, rowMetaByIdRef.current);
    const currentYById = new Map(currentLayout.rows.map((row) => [row.id, row.targetY]));
    const nextLayout = computeDisplayLayout(nextOrder, rowMetaByIdRef.current);
    const endYById = new Map(nextLayout.rows.map((row) => [row.id, row.targetY]));
    const startYById = new Map();

    nextOrder.forEach((id) => {
      const fallbackY = currentYById.get(id) ?? endYById.get(id) ?? 0;
      startYById.set(id, visualYRef.current.get(id) ?? fallbackY);
    });

    commitDisplayOrder(nextOrder);
    tweenRef.current = {
      startTs: performance.now(),
      durationMs,
      order: nextOrder,
      startYById,
      endYById,
    };
    setSchedulerState(SCHEDULER_STATE.TWEENING);
    startRaf();
  }, [commitDisplayOrder, setSchedulerState, startRaf]);

  const runMovementStep = useCallback(() => {
    setSchedulerState(SCHEDULER_STATE.STEPPING);
    const now = performance.now();
    [...holdUntilRef.current.entries()].forEach(([id, readyAt]) => {
      if (readyAt <= now) {
        holdUntilRef.current.delete(id);
        movingIdsRef.current.add(id);
      }
    });

    const currentOrder = displayOrderRef.current;
    if (!currentOrder.length) {
      setSchedulerState(SCHEDULER_STATE.IDLE);
      return;
    }

    const nextOrder = stepDisplayedOrder(currentOrder, desiredIndexRef.current, movingIdsRef.current);
    const layoutForStep = computeDisplayLayout(nextOrder, rowMetaByIdRef.current);
    const layoutYById = new Map(layoutForStep.rows.map((row) => [row.id, row.targetY]));
    // Trigger a tween whenever cards swapped (order changed) OR a moving card
    // hasn't yet visually settled at its layout target.
    const swapped = nextOrder !== currentOrder;
    const needsTween = swapped || nextOrder.some((id) => {
      if (!movingIdsRef.current.has(id)) return false;
      const visualY = visualYRef.current.get(id) ?? layoutYById.get(id) ?? 0;
      const targetY = layoutYById.get(id) ?? visualY;
      return Math.abs(visualY - targetY) > MOVE_SETTLE_PX;
    });

    if (needsTween) {
      beginTween(nextOrder, MOVE_TWEEN_MS);
      return;
    }

    setSchedulerState(SCHEDULER_STATE.SETTLING);
    maybeFadeTagsInCorrectZone(currentOrder);
    currentOrder.forEach((id) => {
      const settled = isCardSettledInCurrentLayout(
        id,
        currentOrder,
        rowMetaByIdRef.current,
        desiredIndexRef.current,
      );
      if (movingIdsRef.current.has(id) && settled) {
        movingIdsRef.current.delete(id);
        holdUntilRef.current.delete(id);
        if (pendingArrivalRef.current.has(id)) {
          pendingArrivalRef.current.delete(id);
          emitCardArrival(id);
        }
      }
    });

    scheduleEngineRef.current();
  }, [beginTween, emitCardArrival, maybeFadeTagsInCorrectZone, setSchedulerState]);

  const scheduleEngine = useCallback(() => {
    if (engineTimeoutRef.current) return;
    if (tweenRef.current) {
      setSchedulerState(SCHEDULER_STATE.TWEENING);
      return;
    }

    const now = performance.now();
    const hasMoving = movingIdsRef.current.size > 0;
    const hasHolding = holdUntilRef.current.size > 0;
    let nextDelay = null;

    if (hasMoving) nextDelay = MOVE_TICK_MS;
    [...holdUntilRef.current.values()].forEach((readyAt) => {
      const wait = Math.max(0, readyAt - now);
      nextDelay = nextDelay === null ? wait : Math.min(nextDelay, wait);
    });

    if (nextDelay === null) {
      setSchedulerState(SCHEDULER_STATE.IDLE);
      return;
    }

    setSchedulerState(hasHolding && !hasMoving ? SCHEDULER_STATE.HOLDING : SCHEDULER_STATE.STEPPING);

    engineTimeoutRef.current = setTimeout(() => {
      engineTimeoutRef.current = null;
      setSchedulerState(SCHEDULER_STATE.STEPPING);
      runMovementStep();
    }, nextDelay);
  }, [runMovementStep, setSchedulerState]);

  scheduleEngineRef.current = scheduleEngine;

  // ── Sync desired order + movement table whenever layout changes ─────────
  useEffect(() => {
    const nextIds = new Set(desiredOrder);
    const now = performance.now();

    // Remove stale entries for players no longer in the list
    [...displayIndexRef.current.keys()].forEach((id) => {
      if (!nextIds.has(id)) {
        visualYRef.current.delete(id);
        desiredIndexRef.current.delete(id);
        holdUntilRef.current.delete(id);
        movingIdsRef.current.delete(id);
        pendingArrivalRef.current.delete(id);
        transitionZoneSinceRef.current.delete(id);
        clearTransitionTimer(id);
        clearTransitionPopTimer(id);
        cardElsRef.current.delete(id);
      }
    });

    const hasPendingMovement =
      pendingArrivalRef.current.size > 0
      || movingIdsRef.current.size > 0
      || holdUntilRef.current.size > 0
      || currentStage === 'POSITION_ASSIGNMENT'
      || currentStage === 'PAYOUT'
      || [...rowMetaById.values()].some((row) => row.category === 'skipped' || row.category === 'eliminated');

    // In quiet states (no bottom-transition context), use the computed layout
    // order directly so initial spawns and lobby updates stay alphabetically
    // sorted without transient pre-seeding jitter.
    const seededOrder = hasPendingMovement
      ? seedDisplayedOrder(displayOrderRef.current, desiredOrder)
      : desiredOrder;
    if (!arraysEqual(seededOrder, displayOrderRef.current)) commitDisplayOrder(seededOrder);

    const currentLayout = computeDisplayLayout(seededOrder, rowMetaById);
    const currentYById = new Map(currentLayout.rows.map((row) => [row.id, row.targetY]));
    const finalLayout = computeDisplayLayout(desiredOrder, rowMetaById);
    const finalYById = new Map(finalLayout.rows.map((row) => [row.id, row.targetY]));

    // Ensure every visible card has a stable visualY baseline before any
    // tween begins. This prevents a one-frame snap to targetY on first swap.
    seededOrder.forEach((id) => {
      if (!visualYRef.current.has(id)) {
        visualYRef.current.set(id, currentYById.get(id) ?? 0);
      }
    });

    // Quiet alphabetical mode: no skip/elim transition context is active.
    // Keep display order locked to desiredOrder and reflow all cards to their
    // exact slots so new inserts shift neighbors cleanly without overlap.
    if (!hasPendingMovement) {
      desiredOrder.forEach((id, desiredIndex) => {
        desiredIndexRef.current.set(id, desiredIndex);
        const targetY = currentYById.get(id) ?? 0;
        visualYRef.current.set(id, targetY);
        holdUntilRef.current.delete(id);
        movingIdsRef.current.delete(id);
        pendingArrivalRef.current.delete(id);
        transitionZoneSinceRef.current.delete(id);
        setRenderedCardPosition(id, targetY, 0);
      });

      scheduleEngine();
      return;
    }

    desiredOrder.forEach((id, desiredIndex) => {
      const isNew = !displayIndexRef.current.has(id);
      const displayIndex = seededOrder.indexOf(id);
      const rowMeta = rowMetaById.get(id);
      const desiredY = currentYById.get(id) ?? 0;
      const finalY = finalYById.get(id) ?? desiredY;
      const visualY = visualYRef.current.get(id) ?? desiredY;
      const needsTravel = displayIndex !== desiredIndex
        || Math.abs(visualY - desiredY) > MOVE_SETTLE_PX;
      const alreadyEnrolled = pendingArrivalRef.current.has(id)
        || movingIdsRef.current.has(id)
        || holdUntilRef.current.has(id);
      const isPositionAssignmentMover = currentStage === 'POSITION_ASSIGNMENT' && wheelOrderSet.has(id);
      const isPayoutMover = currentStage === 'PAYOUT' && rowMeta?.category === 'paying';
      const canDriveMovement = rowMeta?.category === 'skipped'
        || rowMeta?.category === 'eliminated'
        || isPositionAssignmentMover
        || isPayoutMover
        || alreadyEnrolled;

      desiredIndexRef.current.set(id, desiredIndex);

      if (isNew) {
        // Spawn directly at final slot to avoid stacked cards at the top when
        // many players are added in a single batch.
        visualYRef.current.set(id, finalY);
        holdUntilRef.current.delete(id);
        movingIdsRef.current.delete(id);
        pendingArrivalRef.current.delete(id);
        transitionZoneSinceRef.current.delete(id);
        canvasRef.current?.setCardPosition?.(id, finalY, 0);
      } else if (needsTravel && canDriveMovement) {
        if (!alreadyEnrolled) {
          const holdDelayMs = (isPositionAssignmentMover || isPayoutMover) ? 0 : MOVE_DELAY_MS;
          holdUntilRef.current.set(id, now + holdDelayMs);
          movingIdsRef.current.delete(id);
          pendingArrivalRef.current.add(id);
        }
      } else if (alreadyEnrolled) {
        // Keep enrolled movers/holders alive; the movement engine is the
        // source of truth for when they are truly settled.
      } else {
        holdUntilRef.current.delete(id);
        movingIdsRef.current.delete(id);
        if (pendingArrivalRef.current.has(id)) {
          pendingArrivalRef.current.delete(id);
          transitionZoneSinceRef.current.delete(id);
          emitCardArrival(id);
        }
      }
    });

    scheduleEngine();
  }, [
    clearTransitionTimer,
    commitDisplayOrder,
    currentStage,
    desiredOrder,
    emitCardArrival,
    rowMetaById,
    scheduleEngine,
    setRenderedCardPosition,
    wheelOrderSet,
  ]);

  // Cleanup active timers on unmount
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (engineTimeoutRef.current) clearTimeout(engineTimeoutRef.current);
    transitionFadeTimersRef.current.forEach((handle) => clearTimeout(handle));
    transitionFadeTimersRef.current.clear();
    transitionPopTimersRef.current.forEach((handle) => clearTimeout(handle));
    transitionPopTimersRef.current.clear();
    transitionZoneSinceRef.current.clear();
    setSchedulerState(SCHEDULER_STATE.IDLE);
  }, [setSchedulerState]);

  // ── Category-change transition labels ─────────────────────────────────────
  const prevCategoriesRef = useRef({});
  useEffect(() => {
    const getCategory = (p) => {
      if (isEliminatedPlayer(p)) return 'eliminated';
      if (isTokenSpentThisRace(p)) return 'skipped';
      if (getLeaderboardPosition(p) === null) return 'awaiting';
      return 'paying';
    };
    const currentCats = {};
    players.forEach((p) => { currentCats[p.id] = getCategory(p); });

    let changed = false;
    const next = { ...playerTransitions };
    Object.keys(currentCats).forEach((pid) => {
      const prev = prevCategoriesRef.current[pid];
      const curr = currentCats[pid];
      if (!prev || prev === curr) return;

      // If a player returns to paying/awaiting, always clear stale transition labels.
      if (curr === 'paying' || curr === 'awaiting') {
        pendingArrivalRef.current.delete(pid);
        transitionZoneSinceRef.current.delete(pid);
        if (next[pid]) startTransitionFade(pid);
        return;
      }

      const p = players.find((pl) => pl.id === pid);
      if (p) {
        const isAlreadySettled =
          !pendingArrivalRef.current.has(pid)
          && !movingIdsRef.current.has(pid)
          && !holdUntilRef.current.has(pid);

        if (isAlreadySettled) {
          pendingArrivalRef.current.delete(pid);
          transitionZoneSinceRef.current.delete(pid);
          if (next[pid]) startTransitionFade(pid);
        } else {
          const label = curr === 'eliminated'
            ? 'ELIMINATED'
            : p.skippedRace
              ? 'SKIPPED'
              : p.folded
                ? 'FOLDED'
                : 'SKIPPED';
          const existing = next[pid];
          if (!existing || existing.label !== label || existing.phase === 'fading') {
            next[pid] = { phase: 'pop-in', label };
            startTransitionPopIn(pid, label);
            changed = true;
          }
        }
      }
    });
    if (changed) setPlayerTransitions(next);
    prevCategoriesRef.current = currentCats;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearTransitionPopTimer, clearTransitionTimer, players, playerTransitions, startTransitionFade, startTransitionPopIn]);

  // ── Header height ───────────────────────────────────────────────────────────
  useEffect(() => {
    const el = lbStickyHeaderRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setLbHeaderHeight(el.getBoundingClientRect().height));
    ro.observe(el);
    setLbHeaderHeight(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, []);

  // ── Container width (drives canvas and Pixi card width) ───────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setContainerWidth(Math.round(w));
    });
    ro.observe(el);
    const w = el.getBoundingClientRect().width;
    if (w > 0) setContainerWidth(Math.round(w));
    return () => ro.disconnect();
  }, []);

  // ── Scroll tracking ────────────────────────────────────────────────────────
  useEffect(() => {
    const el = leaderboardRef.current;
    if (!el) return undefined;
    const onScroll = () => setLbScrollTop(el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // ── Scroll to top on PAYOUT entry ─────────────────────────────────────────
  const prevStageRef = useRef(currentStage);
  const [payoutScrollLocked, setPayoutScrollLocked] = useState(false);
  useEffect(() => {
    const entering = currentStage === 'PAYOUT' && prevStageRef.current !== 'PAYOUT';
    prevStageRef.current = currentStage;
    if (!entering) {
      if (currentStage !== 'PAYOUT') setPayoutScrollLocked(false);
      return undefined;
    }
    leaderboardRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    setPayoutScrollLocked(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStage]);

  // Unlock scroll once the payout effect signals it has finished
  useEffect(() => {
    if (payoutScrollReady && currentStage === 'PAYOUT') {
      setPayoutScrollLocked(false);
    }
  }, [payoutScrollReady, currentStage]);

  // ── Sticky section label ───────────────────────────────────────────────────
  const stickySectionLabel = useMemo(() => {
    const divs = displayLayout.dividers;
    if (!divs.length) return null;
    let idx = -1;
    for (let i = 0; i < divs.length; i++) if (divs[i].targetY < lbScrollTop) idx = i;
    return divs[Math.max(0, idx)].label;
  }, [displayLayout.dividers, lbScrollTop]);

  // ── Sticky active player — only pin when the card has scrolled off-screen ─
  const STICKY_PHASES = ['POSITION_ASSIGNMENT', 'BETTING', 'RACE_PENDING_RESULT'];
  const activeStickyPlayerId = useMemo(() => {
    if (!STICKY_PHASES.includes(currentStage) || !activePlayerId) return null;
    const row = displayLayout.rows.find((r) => r.id === activePlayerId);
    if (!row) return null;
    // Only sticky when the card has fully scrolled above the visible area
    // (bottom edge past the scroll top) so visible top-cards are never pinned.
    return (row.targetY + ROW_HEIGHT) < lbScrollTop ? activePlayerId : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStage, activePlayerId, displayLayout.rows, lbScrollTop]);

  // When a card leaves sticky, restore its rAF-tracked top immediately
  const prevActiveStickyRef = useRef(null);
  useEffect(() => {
    const prev = prevActiveStickyRef.current;
    if (prev && prev !== activeStickyPlayerId) {
      const el = cardElsRef.current.get(prev);
      if (el) el.style.top = `${visualYRef.current.get(prev) ?? 0}px`;
      canvasRef.current?.setCardPosition?.(prev, visualYRef.current.get(prev) ?? 0, 0);
    }
    prevActiveStickyRef.current = activeStickyPlayerId;
  }, [activeStickyPlayerId]);

  stickyPlayerIdRef.current = activeStickyPlayerId;

  // ── Canvas sync ────────────────────────────────────────────────────────────
  // Must be after activeStickyPlayerId (useMemo) to avoid temporal dead zone.
  const _canvasSyncOpts = {
    activeTimer,
    wheelFocusPlayerId,
    currentStage,
    getFavoriteColor,
    playerTransitions,
    stickyPlayerId: activeStickyPlayerId,
    cardWidth: containerWidth,
  };
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.syncCards(displayLayout.rows, _canvasSyncOpts);
    displayLayout.rows.forEach((row) => {
      const y = visualYRef.current.get(row.id) ?? row.targetY ?? 0;
      canvas.setCardPosition?.(row.id, y, 0);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayLayout, playerTransitions, activeTimer, wheelFocusPlayerId, currentStage, getFavoriteColor, activeStickyPlayerId, containerWidth]);

  // ── Auto scroll ────────────────────────────────────────────────────────────
  // While the payout lock is active, keep the leaderboard pinned at the top.
  useEffect(() => {
    if (!payoutScrollLocked) return undefined;
    const id = setInterval(() => {
      const el = leaderboardRef.current;
      if (el && el.scrollTop > 0) el.scrollTo({ top: 0, behavior: 'smooth' });
    }, 800);
    return () => clearInterval(id);
  }, [payoutScrollLocked]);

  const onLeaderboardWheel = useLeaderboardAutoScroll({
    containerRef: leaderboardRef,
    rowRefs,
    enabled: scrollEnabled && !payoutScrollLocked,
    focusPlayerId:    wheelFocusPlayerId ?? activeTimer?.playerId ?? null,
    speedPxPerSecond: LEADERBOARD_AUTO_SCROLL_SPEED_PX_PER_SECOND,
    edgePauseMs:      LEADERBOARD_AUTO_SCROLL_PAUSE_MS,
    focusOverrideMs:  LEADERBOARD_FOCUS_OVERRIDE_MS,
    manualOverrideMs: LEADERBOARD_MANUAL_OVERRIDE_MS,
    debugReporter: useCallback((payload) => {
      socket?.emit('system-debug-print', {
        source: 'host-view-leaderboard',
        channel: 'leaderboard-scroll',
        algoVersion: 'v3-raf-spring',
        stage: currentStage,
        ...payload,
      });
    }, [socket, currentStage]),
  });

  // ── Row renderer ───────────────────────────────────────────────────────────
  const renderRow = (row) => {
    const { player, rank, dimmed, podiumTier, rowIndex } = row;

    const isOnClock   = activeTimer?.playerId === player.id;
    const timerUrgent = isOnClock && activeTimer.timeLeft <= 10;
    const isWheelFocus = WHEEL_STAGES.includes(currentStage) && wheelFocusPlayerId === player.id;
    const tokenSpent  = isTokenSpentThisRace(player);
    const tokenLabel  = tokenSpent
      ? (player.skippedRace ? 'SKIPPED' : player.folded ? 'FOLDED' : 'SKIPPED')
      : (!player.skipFoldTokenAvailable ? 'NO TOKEN' : null);
    const noReviveLabel = (player.noRevive || player.eliminationState === 'failed_resurrection')
      ? 'NO REVIVE' : null;
    const rowDimmed   = dimmed || tokenSpent;
    const rowElim     = isEliminatedPlayer(player);
    const transition  = playerTransitions[player.id];
    const showTransition = Boolean(transition);

    const isPodium = podiumTier !== null;
    const podiumText = '#0e0c08';

    const normalBg = isOnClock
      ? (timerUrgent ? '#2a0000' : '#001a0a')
      : isWheelFocus ? '#2a2410'
      : rowElim ? '#1a0000'
      : rowDimmed ? '#161616'
      : rowIndex % 2 === 0 ? '#151515' : '#1c1c1c';

    const podiumBg =
      podiumTier === 'gold'
        ? 'linear-gradient(90deg, rgba(133,95,30,0.95) 0%, rgba(199,156,53,0.96) 52%, rgba(133,95,30,0.95) 100%)'
        : podiumTier === 'silver'
        ? 'linear-gradient(90deg, rgba(55,58,68,0.95) 0%, rgba(140,148,160,0.96) 52%, rgba(55,58,68,0.95) 100%)'
        : 'linear-gradient(90deg, rgba(65,40,18,0.95) 0%, rgba(148,90,40,0.96) 52%, rgba(65,40,18,0.95) 100%)';

    const podiumBorder =
      podiumTier === 'gold' ? '1px solid #f2d57a'
      : podiumTier === 'silver' ? '1px solid #b8c4d0'
      : '1px solid #c47c30';

    const podiumShadow =
      podiumTier === 'gold'
        ? '0 0 18px rgba(240,192,64,0.45), inset 0 0 14px rgba(255,220,120,0.25)'
        : podiumTier === 'silver'
        ? '0 0 14px rgba(180,195,210,0.35), inset 0 0 10px rgba(200,215,230,0.2)'
        : '0 0 14px rgba(195,125,55,0.35), inset 0 0 10px rgba(215,145,75,0.2)';

    return (
      <div
        style={{
          ...s.lbRow,
          opacity:    rowElim ? 0.4 : rowDimmed ? 0.7 : 1,
          filter:     rowDimmed ? 'grayscale(0.45)' : 'none',
          background: isPodium ? podiumBg : normalBg,
          border:     isPodium ? podiumBorder
            : isOnClock ? `1px solid ${timerUrgent ? '#e74c3c' : '#2ecc71'}`
            : isWheelFocus ? '1px solid #f0c040'
            : rowDimmed ? '1px solid #2b2b2b'
            : '1px solid transparent',
          boxShadow:  isPodium ? podiumShadow : 'none',
          color:      isPodium ? podiumText : undefined,
        }}
      >
        <span style={{ ...s.lbRank, color: isPodium ? podiumText : s.lbRank.color }}>
          {rank !== null ? `#${rank}` : '...'}
        </span>
        <Avatar
          player={player}
          size={40}
          borderColor={getFavoriteColor(player)}
          getFavoriteColor={getFavoriteColor}
        />
        <span style={{ ...s.lbName, color: isPodium ? podiumText : undefined }}>
          {getPlayerDisplayName(player)}
        </span>
        {isBotPlayer(player) && <span style={s.lbBotBadge}>BOT</span>}
        {isWheelFocus && !isOnClock && <span style={s.lbFocusBadge}>FOCUS</span>}
        {isOnClock && (
          <span style={{
            ...s.lbTimerBadge,
            color:       timerUrgent ? '#e74c3c' : '#2ecc71',
            borderColor: timerUrgent ? '#e74c3c' : '#2ecc71',
          }}>
            {activeTimer.timeLeft}s
          </span>
        )}
        {tokenLabel && (
          <span style={{
            ...s.lbNoToken,
            background: isPodium ? '#3e3210' : s.lbNoToken.background,
            color:      isPodium ? '#121212' : s.lbNoToken.color,
          }}>
            {tokenLabel}
          </span>
        )}
        {noReviveLabel && (
          <span style={{
            ...s.lbNoRevive,
            background: isPodium ? '#3e3210' : s.lbNoRevive.background,
            color:      isPodium ? '#121212' : s.lbNoRevive.color,
          }}>
            {noReviveLabel}
          </span>
        )}
        <MoneyDelta value={player.balance}>
          <MoneyTicker
            value={player.balance}
            prefix="$"
            style={{ ...s.lbBalance, color: isPodium ? podiumText : s.lbBalance.color }}
          />
        </MoneyDelta>
        {player.positions?.length > 0 && (
          <span style={{ ...s.lbPositions, color: isPodium ? podiumText : s.lbPositions.color }}>
            [{player.positions.join(', ')}]
          </span>
        )}
        {rowElim && !showTransition && (
          <img src={DEATH_GIF_SRC} alt="Eliminated" style={s.lbDeathOverlay} />
        )}
        {showTransition && (
          <div
            style={s.lbTransitionOverlay}
            className={
              transition?.phase === 'fading'
                ? 'lb-transition-label-fade'
                : transition?.phase === 'pop-in'
                  ? 'lb-transition-label-pop-in'
                  : 'lb-transition-label-announcing'
            }
          >
            <div style={s.lbTransitionLabel}>{transition.label}</div>
          </div>
        )}
      </div>
    );
  };

  // ── JSX ────────────────────────────────────────────────────────────────────
  return (
    <div
      ref={leaderboardRef}
      className="host-leaderboard-scroll"
      onWheel={onLeaderboardWheel}
      style={{ ...s.leaderboard, ...(fullWidth ? s.leaderboardFullWidth : null), ...style }}
    >
      {/* Sticky header */}
      <div ref={lbStickyHeaderRef} style={s.lbStickyHeader}>
        <div style={s.lbTitle}>LEADERBOARD</div>
        <div style={{ ...s.lbStickySectionClip, height: stickySectionLabel ? DIVIDER_HEIGHT : 0 }}>
          {stickySectionLabel && (
            <div style={{ ...s.lbStickySection, position: 'absolute', top: 0, left: 0, right: 0 }}>
              <span style={s.lbDividerLine} />
              <span style={s.lbDividerLabel}>{stickySectionLabel}</span>
              <span style={s.lbDividerLine} />
            </div>
          )}
        </div>
      </div>

      {/* Absolute-positioned card container — rAF owns el.style.top for each card */}
      <div
        ref={containerRef}
        style={{ position: 'relative', width: '100%', height: displayLayout.totalHeight }}
      >
        {/* Section dividers — static (first section label lives in sticky, not in-flow) */}
        {displayLayout.dividers.filter((div) => div.targetY > 0).map((div) => (
          <div
            key={div.key}
            style={{
              position:   'absolute',
              top:        div.targetY,
              left: 0, right: 0,
              height:     DIVIDER_HEIGHT,
              display:    'flex', alignItems: 'center', gap: 10,
              zIndex:     2,
              visibility: div.targetY < lbScrollTop ? 'hidden' : 'visible',
            }}
          >
            <span style={s.lbDividerLine} />
            <span style={s.lbDividerLabel}>{div.label}</span>
            <span style={s.lbDividerLine} />
          </div>
        ))}

        {/* PixiJS canvas — renders card backgrounds, rank, avatar, name, badges */}
        <LeaderboardCanvas
          ref={canvasRef}
          totalHeight={displayLayout.totalHeight}
          cardWidth={containerWidth}
          visualYRef={visualYRef}
          stickyPlayerId={activeStickyPlayerId}
        />

        {/* HTML overlay layer — MoneyTicker/MoneyDelta, death GIF, transition overlay */}
        {/* Sticky cards also render their full card here so they appear correctly when pinned */}
        {displayLayout.rows.map((row) => {
          const { id, targetY, player, podiumTier } = row;
          const isSticky    = activeStickyPlayerId === id;
          const isPodium    = podiumTier !== null;
          const podiumText  = '#0e0c08';
          const rowElim     = isEliminatedPlayer(player);
          const transition  = playerTransitions[player.id];
          const showTransition = Boolean(transition);

          return (
            <div
              key={id}
              ref={(el) => {
                if (el) {
                  rowRefs.current.set(id, el);
                  cardElsRef.current.set(id, el);
                  if (isSticky) {
                    el.style.top = `${lbScrollTop + 4}px`;
                  } else {
                    el.style.top = `${visualYRef.current.get(id) ?? targetY}px`;
                  }
                } else {
                  rowRefs.current.delete(id);
                  cardElsRef.current.delete(id);
                }
              }}
              style={{
                position: 'absolute',
                left: 0, right: 0,
                height: ROW_HEIGHT,
                pointerEvents: 'none',
                ...(isSticky ? { top: lbScrollTop + 4, zIndex: 20 } : {}),
              }}
            >
              {/* Sticky card: render full HTML card so it looks correct when pinned */}
              {isSticky && renderRow(row)}

              {/* Player positions — centered */}
              {!isSticky && !showTransition && player.positions?.length > 0 && (
                <span style={{ ...s.lbPositions, color: isPodium ? podiumText : s.lbPositions.color }}>
                  [{player.positions.join(', ')}]
                </span>
              )}

              {/* Death GIF */}
              {!isSticky && rowElim && !showTransition && (
                <img src={DEATH_GIF_SRC} alt="Eliminated" style={s.lbDeathOverlay} />
              )}

              {/* Transition overlay (SKIPPED / FOLDED / ELIMINATED) */}
              {!isSticky && showTransition && (
                <div
                  style={s.lbTransitionOverlay}
                  className={
                    transition?.phase === 'fading'
                      ? 'lb-transition-label-fade'
                      : transition?.phase === 'pop-in'
                        ? 'lb-transition-label-pop-in'
                        : 'lb-transition-label-announcing'
                  }
                >
                  <div style={s.lbTransitionLabel}>{transition.label}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
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
  lbRank:    { color: '#666', width: 28, flexShrink: 0 },
  lbName:    { flex: 1, fontWeight: 'bold' },
  lbBotBadge: {
    background: '#173f2a',
    color: '#69d394',
    fontSize: 10,
    padding: '1px 5px',
    borderRadius: 3,
    fontWeight: 'bold',
    letterSpacing: 0.4,
  },
  lbBalance: { color: '#2ecc71', fontWeight: 'bold', minWidth: 60, textAlign: 'right' },
  lbPositions: {
    color: '#888',
    fontSize: 12,
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    textAlign: 'center',
    pointerEvents: 'none',
    background: 'rgba(0,0,0,0.2)',
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
    top: '50%', left: '50%',
    width: 54, height: 54,
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
    background: 'rgba(0,0,0,0.75)',
    borderRadius: 6,
    backdropFilter: 'blur(1px)',
  },
  lbTransitionLabel: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ff6b6b',
    textTransform: 'uppercase',
    letterSpacing: 2.2,
    textShadow: '0 0 18px rgba(255,107,107,0.8)',
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
  lbDividerLine:  { flex: 1, height: 1, background: '#313131' },
  lbDividerLabel: {
    color: '#8a8a8a',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  },
};
