import { useRef, useEffect, useCallback, useState } from 'react';
import { gsap } from 'gsap';

/**
 * usePanelAnimation
 *
 * Drives a GSAP timeline that slides a panel in from an edge and back out.
 * Tracks progress (0–1) and fires threshold callbacks.
 *
 * @param {object} opts
 * @param {boolean}  opts.visible         – whether the panel should be shown
 * @param {string}   opts.enterFrom       – 'left' | 'right' | 'top' | 'bottom'
 * @param {string}   [opts.exitTo]        – defaults to enterFrom
 * @param {number}   [opts.duration=0.55] – seconds
 * @param {string}   [opts.ease='power2.inOut']
 * @param {number[]} [opts.thresholds]    – e.g. [0.5, 1.0] — fires onThreshold at these progress values
 * @param {Function} [opts.onThreshold]   – (value: number, direction: 'in'|'out') => void
 * @param {boolean}  [opts.animateWidth]  – if true, also tweens width 0→'100%'
 * @param {boolean}  [opts.animateHeight] – if true, also tweens height 0→'100%'
 *
 * @returns {{ panelRef, progress, isFullyVisible }}
 */
export function usePanelAnimation({
  visible,
  enterFrom = 'left',
  exitTo,
  duration = 0.55,
  ease = 'power2.inOut',
  thresholds = [],
  onThreshold,
  animateWidth = false,
  animateHeight = false,
}) {
  const resolvedExitTo = exitTo ?? enterFrom;
  const panelRef = useRef(null);
  const tlRef = useRef(null);
  const [progress, setProgress] = useState(visible ? 1 : 0);
  const prevProgressRef = useRef(visible ? 1 : 0);
  const prevVisibleRef = useRef(visible);
  const thresholdsRef = useRef(thresholds);
  const onThresholdRef = useRef(onThreshold);
  useEffect(() => { thresholdsRef.current = thresholds; }, [thresholds]);
  useEffect(() => { onThresholdRef.current = onThreshold; }, [onThreshold]);

  // Build the direction offset for enter / exit directions
  const getFromVars = useCallback((dir) => {
    switch (dir) {
      case 'left':   return { x: '-100%', opacity: 0 };
      case 'right':  return { x: '100%',  opacity: 0 };
      case 'top':    return { y: '-100%', opacity: 0 };
      case 'bottom': return { y: '100%',  opacity: 0 };
      default:       return { x: '-100%', opacity: 0 };
    }
  }, []);

  // Create / recreate timeline when config changes
  const buildTimeline = useCallback(() => {
    const el = panelRef.current;
    if (!el) return;

    if (tlRef.current) {
      tlRef.current.kill();
    }

    // When animating a dimension (width/height), translateX/Y can't work correctly
    // because transform doesn't affect flex layout. Instead, animate maxWidth/maxHeight
    // from 0 so the flex item genuinely collapses and takes no layout space when hidden.
    const fromVars = (animateWidth || animateHeight) ? { opacity: 0 } : getFromVars(enterFrom);
    const toVars   = { x: 0, y: 0, opacity: 1, ease, duration };

    // Extra dimension tweens (maxWidth/maxHeight collapse the flex item to 0 when hidden)
    if (animateWidth)  { fromVars.maxWidth  = 0; toVars.maxWidth  = 9999; }
    if (animateHeight) { fromVars.maxHeight = 0; toVars.maxHeight = 9999; }

    const tl = gsap.timeline({
      paused: true,
      onUpdate() {
        const p = tl.progress();
        setProgress(p);

        const prev = prevProgressRef.current;
        for (const threshold of thresholdsRef.current) {
          const crossed = (prev < threshold && p >= threshold);
          const receded = (prev > threshold && p <= threshold);
          if (crossed && typeof onThresholdRef.current === 'function') {
            onThresholdRef.current(threshold, 'in');
          } else if (receded && typeof onThresholdRef.current === 'function') {
            onThresholdRef.current(threshold, 'out');
          }
        }
        prevProgressRef.current = p;
      },
    });

    tl.fromTo(el, fromVars, toVars);

    // If the exit direction is different from enter, set up a separate reverse path.
    // We handle this by building a "to" tween for exit that we play when reversing only
    // if exitTo !== enterFrom. For simplicity we store the exit fromVars in a ref and
    // apply them manually in the visibility effect.
    tlRef.current = tl;

    // Immediately position without animation based on current state
    const currentVisible = prevVisibleRef.current;
    if (currentVisible) {
      tl.progress(1).pause();
    } else {
      tl.progress(0).pause();
    }
  }, [enterFrom, ease, duration, animateWidth, animateHeight, getFromVars]);

  // Build timeline once on mount and whenever key config changes
  useEffect(() => {
    buildTimeline();
    return () => { tlRef.current?.kill(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enterFrom, exitTo, duration, ease, animateWidth, animateHeight]);

  // Re-build when the ref element is attached (in case it wasn't ready on first mount)
  const setRef = useCallback((el) => {
    panelRef.current = el;
    if (el) buildTimeline();
  }, [buildTimeline]);

  // Play / reverse when visible changes
  useEffect(() => {
    const tl = tlRef.current;
    if (!tl) return;
    prevVisibleRef.current = visible;

    if (visible) {
      // If exit direction differs, we need to start from the exit edge, not the enter edge.
      // Re-build the from state in that case.
      if (resolvedExitTo !== enterFrom && tl.progress() <= 0.02) {
        const fromVars = getFromVars(resolvedExitTo);
        const el = panelRef.current;
        if (el) gsap.set(el, fromVars);
      }
      tl.play();
    } else {
      if (resolvedExitTo !== enterFrom) {
        // Animate to the exit direction instead of reversing
        const el = panelRef.current;
        if (!el) return;
        const exitVars = getFromVars(resolvedExitTo);
        gsap.to(el, { ...exitVars, duration, ease, overwrite: true, onUpdate() {
          // Manually update progress as a reverse (1 → 0 scale)
          // We approximate by reading opacity
        }});
        // Also update progress manually via a separate timeline progress tracker
        gsap.to({}, { duration, onUpdate() {
          const p = 1 - (this.ratio ?? 0);
          setProgress(p);
          prevProgressRef.current = p;
        }});
        return;
      }
      tl.reverse();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const isFullyVisible = progress >= 0.98;

  return { panelRef: setRef, progress, isFullyVisible };
}
