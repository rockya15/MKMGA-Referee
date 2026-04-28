import { useState, useEffect, useRef } from 'react';

// ── MoneyDelta ────────────────────────────────────────────────────────────────
// Wrapper that watches `value` and spawns a floating +$X / -$X indicator
// whenever the value changes. The indicator floats upward and fades over ~1s.
//
// Usage:
//   <MoneyDelta value={someNumber}>
//     <MoneyTicker value={someNumber} ... />
//   </MoneyDelta>

let _deltaId = 0;

function MoneyDelta({ value, children }) {
  const numericValue = Number(value) || 0;
  const prevRef = useRef(numericValue);
  const [deltas, setDeltas] = useState([]);

  useEffect(() => {
    const prev = prevRef.current;
    const diff = numericValue - prev;
    prevRef.current = numericValue;

    if (Math.abs(diff) < 0.005) return; // ignore sub-cent noise

    const id = ++_deltaId;
    // Random physics parameters per indicator
    const drift    = (Math.random() - 0.5) * 56;
    const peakX    = drift * 0.35;
    const peakY    = -(26 + Math.random() * 18);
    const fallX    = drift * 0.68;
    const fallY    = -(46 + Math.random() * 18);
    const endX     = drift;
    const endY     = -(64 + Math.random() * 22);
    const rotPeak  = (Math.random() - 0.5) * 26;
    const rotFall  = (Math.random() - 0.5) * 18;
    const rotEnd   = (Math.random() - 0.5) * 10;
    const duration = (0.88 + Math.random() * 0.38).toFixed(2);
    const physicsStyle = {
      '--delta-peak-x':    `${peakX}px`,
      '--delta-peak-y':    `${peakY}px`,
      '--delta-fall-x':    `${fallX}px`,
      '--delta-fall-y':    `${fallY}px`,
      '--delta-end-x':     `${endX}px`,
      '--delta-end-y':     `${endY}px`,
      '--delta-rot-peak':  `${rotPeak}deg`,
      '--delta-rot-fall':  `${rotFall}deg`,
      '--delta-rot-end':   `${rotEnd}deg`,
      '--delta-duration':  `${duration}s`,
    };

    setDeltas((d) => [...d, { id, diff, physicsStyle }]);
    setTimeout(() => {
      setDeltas((d) => d.filter((x) => x.id !== id));
    }, 1200);
  }, [numericValue]);

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      {children}
      {deltas.map(({ id, diff, physicsStyle }) => (
        <span
          key={id}
          className="money-delta-indicator"
          style={{ color: diff > 0 ? '#2ecc71' : '#e74c3c', ...physicsStyle }}
        >
          {diff > 0 ? '+$' : '-$'}{Math.abs(diff).toFixed(2)}
        </span>
      ))}
    </span>
  );
}

export default MoneyDelta;
