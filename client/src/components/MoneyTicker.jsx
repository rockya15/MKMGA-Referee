import { useState, useEffect, useRef } from 'react';

// ── MoneyTicker ───────────────────────────────────────────────────────────────
// Animated money counter that smoothly counts up/down to a target value.
// Duration scales with delta magnitude (~1400ms for $1, up to 6s for $20+).
// Rapid successive updates resume from the current displayed value so digits
// never jump backward.
// Flashes green when value increases, red when it decreases.
function MoneyTicker({ value, prefix = '$', className, style }) {
  const numericValue = Number(value) || 0;
  const [displayed, setDisplayed] = useState(numericValue);
  // 'gain' | 'loss' | null
  const [flashDir, setFlashDir] = useState(null);
  const flashTimeoutRef = useRef(null);
  const rafRef = useRef(null);
  const animRef = useRef({
    currentVal: numericValue,
    startVal: numericValue,
    targetVal: numericValue,
    startTime: 0,
    duration: 0,
  });

  useEffect(() => {
    const target = numericValue;
    const anim = animRef.current;
    if (Math.abs(target - anim.targetVal) < 0.001) return;

    // Flash direction based on whether value went up or down
    const dir = target > anim.targetVal ? 'gain' : 'loss';
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    setFlashDir(dir);
    flashTimeoutRef.current = setTimeout(() => setFlashDir(null), 700);

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const startVal = anim.currentVal;
    const delta = Math.abs(target - startVal);
    // ~1400ms for $1 change, up to 6000ms for large jumps; minimum 600ms
    const duration = delta < 0.001 ? 0 : Math.min(6000, Math.max(600, Math.pow(delta, 0.65) * 1400));

    anim.startVal = startVal;
    anim.targetVal = target;
    anim.startTime = performance.now();
    anim.duration = duration;

    if (duration === 0) {
      anim.currentVal = target;
      setDisplayed(target);
      return;
    }

    const animate = (now) => {
      const elapsed = now - anim.startTime;
      const progress = Math.min(1, elapsed / anim.duration);
      // ease-out cubic for natural deceleration
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = anim.startVal + (anim.targetVal - anim.startVal) * ease;
      anim.currentVal = current;
      setDisplayed(current);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        anim.currentVal = anim.targetVal;
        setDisplayed(anim.targetVal);
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(animate);
  }, [numericValue]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    };
  }, []);

  // Flash color temporarily overrides whatever color the caller's style provides.
  // When flash clears, transition back smoothly.
  const flashOverride =
    flashDir === 'gain' ? { color: '#2ecc71' } :
    flashDir === 'loss' ? { color: '#e74c3c' } :
    {};

  return (
    <span
      className={className}
      style={{
        transition: `color ${flashDir ? '0.08s' : '0.55s'}`,
        ...style,
        ...flashOverride,
      }}
    >
      {prefix}{displayed.toFixed(2)}
    </span>
  );
}

export default MoneyTicker;
