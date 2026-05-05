/**
 * FooterDisplay
 *
 * Self-contained footer wrapper. Runs useFooterContent internally so that
 * its cycling timer state changes NEVER propagate up to HostView (which would
 * otherwise cause HostView to re-render and potentially re-trigger wheel logic).
 *
 * Wrapped in React.memo so it only re-renders when its own props change
 * (players list, visible flag), not when HostView state changes.
 *
 * The type badge is rendered OUTSIDE the height-clipping div so it can
 * bleed upward over the leaderboard border without being clipped.
 *
 * Props:
 *   players                {Array}   – player list from game state
 *   visible                {boolean} – whether to show (height transitions to 0 when false)
 *   raceNumber             {number}  – current race number (for balance graph condition)
 *   cascadeSpinsThisRound  {number}  – cascade spins so far this race
 */
import { memo, useState, useEffect, useRef } from 'react';
import { useFooterContent } from '../../hooks/useFooterContent';
import FooterPanel, { TRANSITION_MS, TYPE_ACCENT } from './FooterPanel';

// ── Badge label by item type ──────────────────────────────────────────────────

function getBadgeLabel(item) {
  if (!item) return null;
  switch (item.type) {
    case 'fun-statement':  return 'FUN FACT';
    case 'player-drawing': return 'DRAWING';
    case 'stat':           return (item.data?.icon ? item.data.icon + ' ' : '') + (item.data?.label || 'STAT');
    case 'flavor':         return 'MKMGA';
    case 'balance-graph':  return item.data?.label || 'BALANCE HISTORY';
    case 'elimination':    return '💀 ELIMINATED';
    case 'event':          return null;
    default:               return null;
  }
}

// ── Main component ────────────────────────────────────────────────────────────

function FooterDisplay({ players, visible, raceNumber = 1, cascadeSpinsThisRound = 0 }) {
  const { currentItem, footerHeight, pushEvent } = useFooterContent({ players, raceNumber, cascadeSpinsThisRound });

  // ── Transition state (was inside FooterPanel) ────────────────────────────
  const [displayItem, setDisplayItem]   = useState(currentItem);
  const [itemVisible, setItemVisible]   = useState(!!currentItem);
  const transitionTimerRef              = useRef(null);

  useEffect(() => {
    if (currentItem === null) {
      setItemVisible(false);
    } else if (currentItem.id !== displayItem?.id) {
      clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = setTimeout(() => {
        setDisplayItem(currentItem);
        setItemVisible(true);
      }, TRANSITION_MS + 30);
    }
    return () => clearTimeout(transitionTimerRef.current);
  }, [currentItem]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Elimination detection ────────────────────────────────────────────────
  const prevElimIdsRef = useRef(null);

  useEffect(() => {
    const eliminated = players.filter(
      (p) =>
        p.eliminationState === 'failed_resurrection' ||
        p.eliminationState === 'pending_resurrection'
    );
    const currentIds = new Set(eliminated.map((p) => p.id));

    if (prevElimIdsRef.current === null) {
      prevElimIdsRef.current = currentIds;
      return;
    }

    const hasNew = [...currentIds].some((id) => !prevElimIdsRef.current.has(id));
    prevElimIdsRef.current = currentIds;

    if (hasNew && eliminated.length > 0) {
      pushEvent({
        id: `elim-${Date.now()}`,
        type: 'elimination',
        duration: 10000,
        data: { players: eliminated },
      });
    }
  }, [players]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ───────────────────────────────────────────────────────────────
  const accent     = TYPE_ACCENT[displayItem?.type] ?? '#f0c040';
  const badgeLabel = getBadgeLabel(displayItem);

  return (
    // Outer wrapper: position:relative gives the badge its positioning context.
    // No overflow constraint here so the badge can bleed upward.
    <div style={{ position: 'relative', flexShrink: 0 }}>

      {/* Floating badge — box stays visible; only the inner text fades on transitions */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 10,
        pointerEvents: 'none',
        background: '#111318',
        color: accent,
        border: `1px solid ${accent}88`,
        borderRadius: 4,
        padding: '4px 12px',
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: 2,
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        opacity: visible ? 1 : 0,
        transition: `opacity 0.5s ease, border-color 0.5s ease, color 0.5s ease, box-shadow 0.5s ease`,
        boxShadow: `0 0 8px ${accent}33`,
      }}>
        <span style={{
          opacity: itemVisible ? 1 : 0,
          transition: `opacity ${TRANSITION_MS}ms ease`,
        }}>
          {badgeLabel || ''}
        </span>
      </div>

      {/* Height-animating clipping div — badge is NOT a child of this */}
      <div style={{
        height: visible ? footerHeight : 0,
        overflow: 'hidden',
        transition: 'height 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
      }}>
        <FooterPanel displayItem={displayItem} itemVisible={itemVisible} height={footerHeight} />
      </div>

    </div>
  );
}

export default memo(FooterDisplay);

