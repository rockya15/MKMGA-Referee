import { useState, useEffect, useRef, useCallback } from 'react';

const DISPLAY_DURATION_MS = 7000;
// Brief null window between items so FooterPanel can animate out before new content appears
const EXIT_GAP_MS = 380;

// Height constants
const DRAWING_HEIGHT     = 220;
const GRAPH_HEIGHT       = 144;
const ELIMINATION_HEIGHT = 144;
const DEFAULT_HEIGHT     = 72;

const FLAVOR_MESSAGES = [
  'Statistics say someone is about to lose big.',
  'God bless Israel',
  'LET IT RIDE',
  'GOLD GOLD GOLD',
];

function shuffleArray(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Build user-generated items (fun statements + drawings) from current players. */
function buildUserItems(players) {
  const items = [];
  players.forEach((p) => {
    if (String(p.funStatement || '').trim()) {
      items.push({
        id: `fun-${p.id}`,
        type: 'fun-statement',
        duration: DISPLAY_DURATION_MS,
        data: { player: p, text: p.funStatement },
      });
    }
    if (p.drawingImageUrl) {
      items.push({
        id: `drawing-${p.id}`,
        type: 'player-drawing',
        duration: DISPLAY_DURATION_MS,
        data: { player: p },
      });
    }
  });
  return shuffleArray(items);
}

/** Build general items (stats + flavor). Reshuffled every time they exhaust. */
function buildGeneralItems(players, raceNumber, cascadeSpinsThisRound) {
  const items = [];

  // Only count players who are not eliminated (pending_resurrection or failed_resurrection)
  const active = players.filter((p) =>
    p.balance != null &&
    Number.isFinite(p.balance) &&
    p.eliminationState !== 'failed_resurrection' &&
    p.eliminationState !== 'pending_resurrection'
  );
  if (active.length >= 2) {
    const byBal = [...active].sort((a, b) => b.balance - a.balance);

    items.push({
      id: 'stat-leader',
      type: 'stat',
      duration: DISPLAY_DURATION_MS,
      data: { label: 'LEADING THE PACK', player: byBal[0], value: byBal[0].balance, icon: '👑' },
    });
    const lowestPlayer = byBal[byBal.length - 1];
    if (lowestPlayer.balance === 0) {
      items.push({
        id: 'stat-last',
        type: 'stat',
        duration: DISPLAY_DURATION_MS,
        data: { label: 'DUE FOR A WIN', player: lowestPlayer, value: lowestPlayer.balance, icon: '💸' },
      });
    }

    const total = active.reduce((s, p) => s + p.balance, 0);
    items.push({
      id: 'stat-total',
      type: 'stat',
      duration: DISPLAY_DURATION_MS,
      data: { label: 'TOTAL MONEY IN PLAY', value: total, icon: '💰' },
    });

    if (active.length >= 3) {
      const avg = total / active.length;
      items.push({
        id: 'stat-avg',
        type: 'stat',
        duration: DISPLAY_DURATION_MS,
        data: { label: 'AVERAGE BALANCE', value: avg, icon: '📊' },
      });
    }

    // Cascade spins this round (only if at least 1 has happened)
    if (cascadeSpinsThisRound > 0) {
      items.push({
        id: 'stat-cascades',
        type: 'stat',
        duration: DISPLAY_DURATION_MS,
        data: { label: 'CASCADE SPINS THIS ROUND', value: cascadeSpinsThisRound, icon: '🌀', raw: true },
      });
    }

    // Balance graph (only if race 2+, and at least one player has 2+ data points)
    if (raceNumber >= 2) {
      const playersWithHistory = active.filter(
        (p) => Array.isArray(p.balanceHistory) && p.balanceHistory.length >= 2
      );
      if (playersWithHistory.length > 0) {
        items.push({
          id: 'stat-balance-graph',
          type: 'balance-graph',
          duration: DISPLAY_DURATION_MS,
          data: { label: 'BALANCE HISTORY', players: playersWithHistory },
        });
      }
    }
  }

  FLAVOR_MESSAGES.forEach((text, i) => {
    items.push({
      id: `flavor-${i}`,
      type: 'flavor',
      duration: DISPLAY_DURATION_MS,
      data: { text },
    });
  });

  return shuffleArray(items);
}

/**
 * useFooterContent
 *
 * Manages the footer content queue.
 * - User-generated content (fun statements, drawings) cycles through its entire pool
 *   exactly once before any item repeats. New items added mid-game are injected into
 *   the remaining pool immediately.
 * - General content (stats, flavor) reshuffles every time it exhausts.
 * - Accepts priority event items via pushEvent().
 */
export function useFooterContent({ players, raceNumber = 1, cascadeSpinsThisRound = 0 }) {
  const playersRef          = useRef(players);
  const raceNumberRef       = useRef(raceNumber);
  const cascadeRef          = useRef(cascadeSpinsThisRound);

  useEffect(() => { playersRef.current = players; }, [players]);
  useEffect(() => { raceNumberRef.current = raceNumber; }, [raceNumber]);
  useEffect(() => { cascadeRef.current = cascadeSpinsThisRound; }, [cascadeSpinsThisRound]);

  const [currentItem, setCurrentItem] = useState(null);

  // User pool: each item shown exactly once per cycle. Refills when exhausted or new content arrives.
  const userPoolRef     = useRef([]);  // remaining items not yet shown this cycle
  const userShownIdsRef = useRef(new Set()); // IDs shown in the current user cycle

  // General pool: reshuffles whenever exhausted
  const generalPoolRef  = useRef([]);

  // How many consecutive general items shown since last user item (for interleaving 1:3)
  const generalSinceUserRef = useRef(0);

  // Priority queue for event-driven items
  const priorityRef = useRef([]);

  const displayTimerRef    = useRef(null);
  const transitionTimerRef = useRef(null);
  const cycleRef           = useRef(null);

  /** Add any user items that aren't already shown or pending */
  const refreshUserPool = useCallback(() => {
    const allUserItems = buildUserItems(playersRef.current);
    const pendingIds   = new Set(userPoolRef.current.map((i) => i.id));
    const newItems     = allUserItems.filter(
      (item) => !userShownIdsRef.current.has(item.id) && !pendingIds.has(item.id)
    );
    if (newItems.length > 0) {
      // Shuffle new items into the remaining pool
      userPoolRef.current = shuffleArray([...userPoolRef.current, ...newItems]);
    }
  }, []);

  /** Rebuild general pool from current state */
  const refreshGeneralPool = useCallback(() => {
    generalPoolRef.current = buildGeneralItems(
      playersRef.current,
      raceNumberRef.current,
      cascadeRef.current
    );
  }, []);

  const getNextItem = useCallback(() => {
    if (priorityRef.current.length > 0) return priorityRef.current.shift();

    // Interleave: 1 user item for every ~3 general items (if user pool has items)
    const shouldShowUser =
      userPoolRef.current.length > 0 && generalSinceUserRef.current >= 3;

    if (shouldShowUser) {
      const item = userPoolRef.current.shift();
      userShownIdsRef.current.add(item.id);
      generalSinceUserRef.current = 0;
      // If user pool just exhausted, clear shown set so the next cycle can start fresh
      if (userPoolRef.current.length === 0) {
        userShownIdsRef.current.clear();
      }
      return item;
    }

    // General item
    if (generalPoolRef.current.length === 0) {
      refreshGeneralPool();
    }
    if (generalPoolRef.current.length === 0) return null;

    const item = generalPoolRef.current.shift();
    generalSinceUserRef.current++;
    return item;
  }, [refreshGeneralPool]);

  const cycle = useCallback(() => {
    clearTimeout(displayTimerRef.current);
    setCurrentItem(null);
    clearTimeout(transitionTimerRef.current);
    transitionTimerRef.current = setTimeout(() => {
      const next = getNextItem();
      setCurrentItem(next ?? null);
      if (next) {
        displayTimerRef.current = setTimeout(() => cycleRef.current?.(), next.duration);
      }
    }, EXIT_GAP_MS);
  }, [getNextItem]);

  useEffect(() => { cycleRef.current = cycle; }, [cycle]);

  // Mount: build both pools, then start cycling after startup delay
  useEffect(() => {
    refreshUserPool();
    refreshGeneralPool();
    const init = setTimeout(() => {
      const first = getNextItem();
      setCurrentItem(first ?? null);
      if (first) {
        displayTimerRef.current = setTimeout(() => cycleRef.current?.(), first.duration);
      }
    }, 1200);
    return () => {
      clearTimeout(init);
      clearTimeout(displayTimerRef.current);
      clearTimeout(transitionTimerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh user pool when new players or drawings arrive
  const playersLen    = players.length;
  const drawingsCount = players.filter((p) => p.drawingImageUrl).length;
  useEffect(() => {
    if (playersLen > 0) refreshUserPool();
  }, [playersLen, drawingsCount, refreshUserPool]);

  // Refresh general pool when stats-relevant values change
  useEffect(() => {
    refreshGeneralPool();
  }, [cascadeSpinsThisRound, raceNumber, playersLen, refreshGeneralPool]);

  /**
   * pushEvent — queue a priority content item that will be shown next.
   * item shape: { id, type, duration?, data }
   * Interrupts current display immediately.
   */
  const pushEvent = useCallback((item) => {
    priorityRef.current.unshift({ ...item, duration: item.duration ?? DISPLAY_DURATION_MS });
    clearTimeout(displayTimerRef.current);
    cycle();
  }, [cycle]);

  const footerHeight =
    currentItem?.type === 'player-drawing' ? DRAWING_HEIGHT :
    currentItem?.type === 'balance-graph'  ? GRAPH_HEIGHT :
    currentItem?.type === 'elimination'    ? ELIMINATION_HEIGHT :
    DEFAULT_HEIGHT;

  const footerVisible = players.length > 0;

  return { currentItem, footerHeight, footerVisible, pushEvent };
}
