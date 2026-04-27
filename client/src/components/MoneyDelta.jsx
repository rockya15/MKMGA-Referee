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
    setDeltas((d) => [...d, { id, diff }]);
    setTimeout(() => {
      setDeltas((d) => d.filter((x) => x.id !== id));
    }, 1200);
  }, [numericValue]);

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      {children}
      {deltas.map(({ id, diff }) => (
        <span
          key={id}
          className="money-delta-indicator"
          style={{ color: diff > 0 ? '#2ecc71' : '#e74c3c' }}
        >
          {diff > 0 ? '+$' : '-$'}{Math.abs(diff).toFixed(2)}
        </span>
      ))}
    </span>
  );
}

export default MoneyDelta;
