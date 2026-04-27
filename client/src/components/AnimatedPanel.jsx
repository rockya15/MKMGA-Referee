import { useMemo } from 'react';
import { PanelProgressContext } from '../context/PanelProgressContext';
import { usePanelAnimation } from '../hooks/usePanelAnimation';

/**
 * AnimatedPanel
 *
 * A generic panel wrapper that uses GSAP to slide in/out from a screen edge.
 * Provides PanelProgressContext to all children so they can gate behavior on visibility.
 *
 * Props:
 *   visible       {boolean}   – whether the panel should be shown
 *   enterFrom     {string}    – 'left' | 'right' | 'top' | 'bottom'
 *   exitTo        {string}    – defaults to enterFrom
 *   duration      {number}    – animation duration in seconds (default 0.55)
 *   ease          {string}    – GSAP ease string (default 'power2.inOut')
 *   thresholds    {number[]}  – progress thresholds to fire onThreshold at
 *   onThreshold   {Function}  – (value, direction: 'in'|'out') => void
 *   animateWidth  {boolean}   – also tween width from 0 → '100%'
 *   animateHeight {boolean}   – also tween height from 0 → '100%'
 *   style         {object}    – inline styles for the outer div
 *   className     {string}
 *   children
 */
export default function AnimatedPanel({
  visible,
  enterFrom = 'left',
  exitTo,
  duration = 0.55,
  ease = 'power2.inOut',
  thresholds,
  onThreshold,
  animateWidth = false,
  animateHeight = false,
  style,
  className,
  children,
}) {
  const { panelRef, progress, isFullyVisible } = usePanelAnimation({
    visible,
    enterFrom,
    exitTo,
    duration,
    ease,
    thresholds,
    onThreshold,
    animateWidth,
    animateHeight,
  });

  const contextValue = useMemo(
    () => ({ progress, isFullyVisible }),
    [progress, isFullyVisible],
  );

  return (
    <PanelProgressContext.Provider value={contextValue}>
      <div
        ref={panelRef}
        className={className}
        style={{
          overflow: 'hidden',
          willChange: 'transform, opacity',
          ...style,
        }}
      >
        {children}
      </div>
    </PanelProgressContext.Provider>
  );
}
