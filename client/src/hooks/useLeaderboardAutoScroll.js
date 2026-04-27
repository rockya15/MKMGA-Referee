import { useRef, useEffect, useCallback } from 'react';

/**
 * useLeaderboardAutoScroll
 *
 * RAF-driven ping-pong auto-scroll with focus lock, manual override, and
 * sub-pixel carry to avoid integer-quantization stalls.
 *
 * Returns onManualWheel — attach to the scrollable container's onWheel prop.
 */
export function useLeaderboardAutoScroll({
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
