import { useRef, useEffect } from 'react';

/**
 * BalanceGraph
 *
 * Props:
 *   history       — array of { race: number, balance: number }
 *   width         — canvas width in px (default 280)
 *   height        — canvas height in px (default 90)
 *   color         — override line/fill color (defaults to green/red based on trend)
 *   style         — extra style on the canvas
 *   label         — optional label shown above the graph
 */
export default function BalanceGraph({ history = [], width = 280, height = 90, color = null, style, label }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    canvas.width  = width  * dpr;
    canvas.height = height * dpr;
    canvas.style.width  = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    const pts = Array.isArray(history) ? history.filter(
      (p) => typeof p === 'object' && Number.isFinite(p.race) && Number.isFinite(p.balance)
    ) : [];

    if (pts.length < 2) {
      // Not enough data — draw a single centred placeholder dash
      ctx.strokeStyle = '#444';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(width * 0.2, height / 2);
      ctx.lineTo(width * 0.8, height / 2);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }

    const PAD_L = 8;
    const PAD_R = 8;
    const PAD_T = 10;
    const PAD_B = 14;
    const W = width  - PAD_L - PAD_R;
    const H = height - PAD_T - PAD_B;

    const minRace = pts[0].race;
    const maxRace = pts[pts.length - 1].race;
    const allBalances = pts.map((p) => p.balance);
    let minBal = Math.min(...allBalances);
    let maxBal = Math.max(...allBalances);
    // Give a little breathing room when flat
    if (maxBal === minBal) { minBal -= 1; maxBal += 1; }
    const raceSpan = maxRace - minRace || 1;
    const balSpan  = maxBal - minBal;

    const toX = (race)    => PAD_L + ((race - minRace) / raceSpan) * W;
    const toY = (balance) => PAD_T + (1 - (balance - minBal) / balSpan) * H;

    const startBal  = pts[0].balance;
    const endBal    = pts[pts.length - 1].balance;
    const isUp      = endBal >= startBal;
    const lineColor = color ?? (isUp ? '#2ecc71' : '#e74c3c');
    const fillColor = color
      ? `${color}22`
      : isUp ? 'rgba(46,204,113,0.12)' : 'rgba(231,76,60,0.12)';

    // Zero / reference line (starting balance)
    const refY = toY(startBal);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(PAD_L, refY);
    ctx.lineTo(PAD_L + W, refY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Fill area under line
    ctx.beginPath();
    ctx.moveTo(toX(pts[0].race), toY(pts[0].balance));
    pts.forEach((p) => ctx.lineTo(toX(p.race), toY(p.balance)));
    ctx.lineTo(toX(pts[pts.length - 1].race), PAD_T + H);
    ctx.lineTo(toX(pts[0].race), PAD_T + H);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();

    // Main line
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = toX(p.race);
      const y = toY(p.balance);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Data point dots
    pts.forEach((p) => {
      const x = toX(p.race);
      const y = toY(p.balance);
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = lineColor;
      ctx.fill();
    });

    // X-axis labels: first and last race number
    ctx.fillStyle = '#666';
    ctx.font = `${10 * dpr / dpr}px sans-serif`; // normalize for dpr-scaled context
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`R${pts[0].race}`, PAD_L, height - PAD_B + 3);
    ctx.textAlign = 'right';
    ctx.fillText(`R${pts[pts.length - 1].race}`, PAD_L + W, height - PAD_B + 3);

    // End balance label
    const lastX = toX(pts[pts.length - 1].race);
    const lastY = toY(pts[pts.length - 1].balance);
    const balLabel = `$${endBal.toFixed(2)}`;
    ctx.font = `bold ${11 * dpr / dpr}px sans-serif`;
    ctx.fillStyle = lineColor;
    ctx.textAlign = lastX > width / 2 ? 'right' : 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(balLabel, lastX, Math.max(PAD_T + 1, lastY - 3));
  }, [history, width, height, color]);

  const delta = (() => {
    if (!Array.isArray(history) || history.length < 2) return null;
    const start = history[0]?.balance;
    const end   = history[history.length - 1]?.balance;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return end - start;
  })();

  const deltaColor = delta === null ? '#888' : delta >= 0 ? '#2ecc71' : '#e74c3c';
  const deltaStr   = delta === null ? '' : `${delta >= 0 ? '+' : ''}$${delta.toFixed(2)}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, ...style }}>
      {(label || delta !== null) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '0 2px' }}>
          {label && <span style={{ fontSize: 11, color: '#888', letterSpacing: 0.5, textTransform: 'uppercase' }}>{label}</span>}
          {delta !== null && (
            <span style={{ fontSize: 12, fontWeight: 'bold', color: deltaColor }}>{deltaStr}</span>
          )}
        </div>
      )}
      <canvas ref={canvasRef} style={{ display: 'block', borderRadius: 4 }} />
    </div>
  );
}
