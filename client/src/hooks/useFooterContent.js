import { useState, useEffect, useRef, useCallback } from 'react';

const DISPLAY_DURATION_MS = 7000;
// Brief null window between items so FooterPanel can animate out before new content appears
const EXIT_GAP_MS = 380;

// Height constants
const DRAWING_HEIGHT     = 220;
const GRAPH_HEIGHT       = 144;
const ELIMINATION_HEIGHT = 144;
const DEFAULT_HEIGHT     = 72;

function shuffleArray(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function isBotPlayer(p) {
  if (Boolean(p?.isBot)) return true;
  const id = String(p?.id ?? '').toLowerCase();
  const name = String(p?.realName ?? '').toLowerCase();
  return id.startsWith('bot-') || name.startsWith('bot_');
}

/** Build user-generated items (fun statements + drawings) from real players only. */
function buildUserItems(players) {
  const items = [];
  players.filter((p) => !isBotPlayer(p)).forEach((p) => {
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

  return shuffleArray(items);
}

/**
 * useFooterContent
 *
 * Manages the footer content queue.
 * - User-generated content (fun statements, drawings) cycles through its entire pool
 *   exactly once before any item repeats. New items added mid-game are injected into
 *   the remaining pool immediately. Bot players are excluded from UGC.
 * - General content (stats, flavor) reshuffles every time it exhausts.
 *   Stats will not appear back-to-back.
 * - ugcFirst: when true (leaderboard phase), UGC is shown after every 1 general item
 *   instead of every 2.
 * - Accepts priority event items via pushEvent().
 */
export function useFooterContent({ players, raceNumber = 1, cascadeSpinsThisRound = 0, ugcFirst = false }) {
  const playersRef          = useRef(players);
  const raceNumberRef       = useRef(raceNumber);
  const cascadeRef          = useRef(cascadeSpinsThisRound);
  const ugcFirstRef         = useRef(ugcFirst);

  useEffect(() => { playersRef.current = players; }, [players]);
  useEffect(() => { raceNumberRef.current = raceNumber; }, [raceNumber]);
  useEffect(() => { cascadeRef.current = cascadeSpinsThisRound; }, [cascadeSpinsThisRound]);
  useEffect(() => { ugcFirstRef.current = ugcFirst; }, [ugcFirst]);

  const [currentItem, setCurrentItem] = useState(null);

  // User pool: each item shown exactly once per cycle. Refills when exhausted or new content arrives.
  const userPoolRef     = useRef([]);  // remaining items not yet shown this cycle
  const userShownIdsRef = useRef(new Set()); // IDs shown in the current user cycle

  // General pool: reshuffles whenever exhausted
  const generalPoolRef  = useRef([]);

  // How many consecutive general items shown since last user item
  const generalSinceUserRef = useRef(0);

  // Type of the last item shown — used to prevent back-to-back stats
  const lastItemTypeRef = useRef(null);

  // Priority queue for event-driven items
  const priorityRef = useRef([]);

  const displayTimerRef    = useRef(null);
  const transitionTimerRef = useRef(null);
  const cycleRef           = useRef(null);
  // true when the cycle stopped due to empty pools (no timer pending)
  const cycleIdleRef       = useRef(true);

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

    // ugcFirst (leaderboard phase): show UGC after 1 general item; otherwise after 2
    const ugcThreshold = ugcFirstRef.current ? 1 : 2;
    const shouldShowUser =
      userPoolRef.current.length > 0 && generalSinceUserRef.current >= ugcThreshold;

    if (shouldShowUser) {
      const item = userPoolRef.current.shift();
      userShownIdsRef.current.add(item.id);
      generalSinceUserRef.current = 0;
      lastItemTypeRef.current = item.type;
      // If user pool just exhausted, clear shown set so the next cycle can start fresh
      if (userPoolRef.current.length === 0) {
        userShownIdsRef.current.clear();
      }
      return item;
    }

    // General item — avoid back-to-back stats
    if (generalPoolRef.current.length === 0) {
      refreshGeneralPool();
    }
    // No general content available (e.g. lobby) — fall back to UGC directly
    if (generalPoolRef.current.length === 0) {
      if (userPoolRef.current.length > 0) {
        const item = userPoolRef.current.shift();
        userShownIdsRef.current.add(item.id);
        generalSinceUserRef.current = 0;
        lastItemTypeRef.current = item.type;
        if (userPoolRef.current.length === 0) userShownIdsRef.current.clear();
        return item;
      }
      return null;
    }

    let item;
    if (lastItemTypeRef.current === 'stat' && generalPoolRef.current.length > 1) {
      const nonStatIdx = generalPoolRef.current.findIndex((i) => i.type !== 'stat');
      if (nonStatIdx !== -1) {
        item = generalPoolRef.current.splice(nonStatIdx, 1)[0];
      } else {
        item = generalPoolRef.current.shift();
      }
    } else {
      item = generalPoolRef.current.shift();
    }

    lastItemTypeRef.current = item.type;
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
        cycleIdleRef.current = false;
        displayTimerRef.current = setTimeout(() => cycleRef.current?.(), next.duration);
      } else {
        cycleIdleRef.current = true;
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
        cycleIdleRef.current = false;
        displayTimerRef.current = setTimeout(() => cycleRef.current?.(), first.duration);
      } else {
        cycleIdleRef.current = true;
      }
    }, 1200);
    return () => {
      clearTimeout(init);
      clearTimeout(displayTimerRef.current);
      clearTimeout(transitionTimerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear all pools and current item when players list empties (e.g. after game reset)
  const playersLen    = players.length;
  const drawingsCount = players.filter((p) => p.drawingImageUrl).length;
  useEffect(() => {
    if (playersLen === 0) {
      userPoolRef.current = [];
      userShownIdsRef.current = new Set();
      generalPoolRef.current = [];
      priorityRef.current = [];
      generalSinceUserRef.current = 0;
      lastItemTypeRef.current = null;
      clearTimeout(displayTimerRef.current);
      clearTimeout(transitionTimerRef.current);
      setCurrentItem(null);
    }
  }, [playersLen]);

  // Refresh user pool when new players or drawings arrive; restart cycle if it went idle
  useEffect(() => {
    if (playersLen > 0) {
      refreshUserPool();
      if (cycleIdleRef.current) {
        // Cycle stopped because pools were empty — kick it off now that content exists
        const t = setTimeout(() => { if (cycleIdleRef.current) cycleRef.current?.(); }, 400);
        return () => clearTimeout(t);
      }
    }
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
