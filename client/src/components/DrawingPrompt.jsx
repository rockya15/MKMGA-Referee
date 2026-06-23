import { useRef, useState, useEffect, useCallback } from 'react';

// ── Palette & tool definitions ────────────────────────────────────────────────
const LEFT_COLORS = [
  { id: 'blue',   hex: '#2563eb', label: 'Blue'   },
  { id: 'green',  hex: '#16a34a', label: 'Green'  },
  { id: 'yellow', hex: '#eab308', label: 'Yellow' },
  { id: 'red',    hex: '#dc2626', label: 'Red'    },
  { id: 'purple', hex: '#9333ea', label: 'Purple' },
];

const RIGHT_TOOLS = [
  { id: 'black',  type: 'color', hex: '#000000', label: 'Black'  },
  { id: 'white',  type: 'color', hex: '#ffffff', label: 'White'  },
  { id: 'eraser', type: 'tool',  label: 'Erase'  },
  { id: 'bucket', type: 'tool',  label: 'Bucket' },
  { id: 'brush',  type: 'tool',  label: 'Brush'  },
];

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function floodFill(canvas, startX, startY, fillHex) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const sx = Math.floor(startX);
  const sy = Math.floor(startY);
  if (sx < 0 || sx >= width || sy < 0 || sy >= height) return;
  const startIdx = (sy * width + sx) * 4;
  const sR = data[startIdx];
  const sG = data[startIdx + 1];
  const sB = data[startIdx + 2];
  const [fR, fG, fB] = hexToRgb(fillHex);
  if (sR === fR && sG === fG && sB === fB) return;
  const TOL = 32;
  const matches = (i) =>
    Math.abs(data[i]     - sR) <= TOL &&
    Math.abs(data[i + 1] - sG) <= TOL &&
    Math.abs(data[i + 2] - sB) <= TOL;
  const visited = new Uint8Array(width * height);
  const stack = [sx + sy * width];
  while (stack.length) {
    const pos = stack.pop();
    if (visited[pos]) continue;
    visited[pos] = 1;
    const pi = pos * 4;
    if (!matches(pi)) continue;
    data[pi]     = fR;
    data[pi + 1] = fG;
    data[pi + 2] = fB;
    data[pi + 3] = 255;
    const x = pos % width;
    const y = Math.floor(pos / width);
    if (x > 0)          stack.push(pos - 1);
    if (x < width - 1)  stack.push(pos + 1);
    if (y > 0)          stack.push(pos - width);
    if (y < height - 1) stack.push(pos + width);
  }
  ctx.putImageData(imageData, 0, 0);
}

const DRAWING_PROMPTS = [
  'Draw a monkey',
  'Draw a happy family',
  'Draw a reddit mod',
  'Draw your ex',
  'Draw a self-portrait',
  'Draw your spirit animal',
  'Draw XQC',
  'Draw what $5 looks like',
  'Draw a politician doing the right thing',
  'Draw a pedo',
  'Draw your biggest fear',
  'Draw a French person',
  'Draw the average EVADE mod',
  'Draw a fish with ambitions',
  'Draw the person next to you',
  'Draw a raccoon in a tuxedo',
  'Draw someone about to make a terrible decision',
  'Draw a very disappointing trophy',
  'Draw the king of MKMGA',
  'Draw the average Michigan woman',
  "Draw what's happening in the Middle East",
  'Draw someone who definitely cheated',
  'Draw the GOAT',
  'Draw a disappointed parent',
  'Draw a gamer in their natural habitat',
  'Draw capitalism',
  'Draw someone who has never lost a bet',
  'Draw your doctor when you describe your symptoms',
];

const CANVAS_SIZE = 320;

/**
 * DrawingPrompt
 *
 * Shows a random drawing prompt and a canvas for the player to draw on.
 * Calls onDone({ drawingImageUrl, drawingPrompt }) when the player submits.
 * Calls onBack() when the player wants to go back.
 */
export default function DrawingPrompt({ onDone, onBack }) {
  const canvasRef = useRef(null);
  const isDrawing = useRef(false);
  const lastPos = useRef(null);

  // Use refs so callbacks never go stale
  const activeColorRef = useRef('#000000');
  const activeToolRef  = useRef('brush');

  const [activeColor, setActiveColorState] = useState('#000000');
  const [activeTool,  setActiveToolState]  = useState('brush');

  const setColor = (hex) => { activeColorRef.current = hex; setActiveColorState(hex); setActiveToolState('brush'); activeToolRef.current = 'brush'; };
  const setTool  = (id)  => { activeToolRef.current  = id;  setActiveToolState(id);  };

  const [hasDrawn,  setHasDrawn]  = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error,     setError]     = useState(null);
  const [prompt] = useState(
    () => DRAWING_PROMPTS[Math.floor(Math.random() * DRAWING_PROMPTS.length)]
  );

  // Undo/redo history — store ImageData snapshots
  const historyRef    = useRef([]);
  const historyPosRef = useRef(-1);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const saveSnapshot = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const snap = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // Discard any redo history ahead of current position
    historyRef.current = historyRef.current.slice(0, historyPosRef.current + 1);
    historyRef.current.push(snap);
    historyPosRef.current = historyRef.current.length - 1;
    setCanUndo(historyPosRef.current > 0);
    setCanRedo(false);
  }, []);

  const handleUndo = () => {
    if (historyPosRef.current <= 0) return;
    historyPosRef.current -= 1;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(historyRef.current[historyPosRef.current], 0, 0);
    setCanUndo(historyPosRef.current > 0);
    setCanRedo(true);
    setHasDrawn(historyPosRef.current > 0);
  };

  const handleRedo = () => {
    if (historyPosRef.current >= historyRef.current.length - 1) return;
    historyPosRef.current += 1;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(historyRef.current[historyPosRef.current], 0, 0);
    setCanUndo(true);
    setCanRedo(historyPosRef.current < historyRef.current.length - 1);
    setHasDrawn(true);
  };

  // Initialize canvas with white background
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Save the blank canvas as the first history entry
    const snap = ctx.getImageData(0, 0, canvas.width, canvas.height);
    historyRef.current = [snap];
    historyPosRef.current = 0;
  }, []);

  const getPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const src = e.touches ? e.touches[0] : e;
    return {
      x: (src.clientX - rect.left) * scaleX,
      y: (src.clientY - rect.top)  * scaleY,
    };
  };

  const startDraw = useCallback((e) => {
    e.preventDefault();
    const tool  = activeToolRef.current;
    const color = activeColorRef.current;
    const pos = getPos(e);
    if (tool === 'bucket') {
      saveSnapshot();
      floodFill(canvasRef.current, pos.x, pos.y, color);
      saveSnapshot();
      setHasDrawn(true);
      return;
    }
    isDrawing.current = true;
    lastPos.current = pos;
    const ctx = canvasRef.current.getContext('2d');
    const drawColor = tool === 'eraser' ? '#ffffff' : color;
    const dotR = tool === 'eraser' ? 8 : 2;
    ctx.fillStyle = drawColor;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, dotR, 0, Math.PI * 2);
    ctx.fill();
    setHasDrawn(true);
  }, [saveSnapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  const draw = useCallback((e) => {
    if (!isDrawing.current) return;
    e.preventDefault();
    const tool  = activeToolRef.current;
    const color = activeColorRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const pos = getPos(e);
    ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color;
    ctx.lineWidth   = tool === 'eraser' ? 18 : 4;
    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPos.current = pos;
    setHasDrawn(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stopDraw = useCallback((e) => {
    if (!isDrawing.current) return;
    if (e) e.preventDefault();
    isDrawing.current = false;
    lastPos.current = null;
    // Save snapshot after stroke ends
    saveSnapshot();
  }, [saveSnapshot]);

  // Attach touch listeners with passive:false
  useEffect(() => {
    const canvas = canvasRef.current;
    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove',  draw,      { passive: false });
    canvas.addEventListener('touchend',   stopDraw,  { passive: false });
    return () => {
      canvas.removeEventListener('touchstart', startDraw);
      canvas.removeEventListener('touchmove',  draw);
      canvas.removeEventListener('touchend',   stopDraw);
    };
  }, [startDraw, draw, stopDraw]);

  const handleClear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    saveSnapshot();
    setHasDrawn(false);
  };

  const handleSubmit = async () => {
    setUploading(true);
    setError(null);
    try {
      const canvas = canvasRef.current;
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const body = new FormData();
      body.append('drawing', blob, 'drawing.png');
      const res = await fetch('/api/upload-drawing', { method: 'POST', body });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Upload failed');
      }
      const { imageUrl } = await res.json();
      onDone({ drawingImageUrl: imageUrl, drawingPrompt: prompt });
    } catch (err) {
      setError(err.message || 'Upload failed. Try again.');
    } finally {
      setUploading(false);
    }
  };

  // Cursor based on active tool
  const canvasCursor = activeTool === 'bucket' ? 'cell' : activeTool === 'eraser' ? 'cell' : 'crosshair';

  return (
    <div style={s.root}>
      <div style={s.headerRow}>
        <div style={s.header}>Join MKMGA</div>
        <button type="button" style={s.backBtn} onClick={onBack} disabled={uploading}>
          ← Back
        </button>
      </div>

      <div style={s.promptBox}>
        <div style={s.promptLabel}>Your drawing prompt</div>
        <div style={s.promptText}>{prompt}</div>
        <div style={s.promptSub}>Draw it below. Everyone will see this later.</div>
      </div>

      {error && <div style={s.errorBox}>{error}</div>}

      {/* ── Drawing area: [left colors] [canvas] [right tools] ─────────── */}
      <div style={s.middle}>
        <div style={s.drawRow}>

        {/* Left: color buttons */}
        <div style={s.toolCol}>
          {LEFT_COLORS.map((c) => {
            const selected = (activeTool === 'brush' || activeTool === 'bucket') && activeColor === c.hex;
            return (
              <button
                key={c.id}
                type="button"
                aria-label={c.label}
                style={{ ...s.toolBtn, background: c.hex, boxShadow: selected ? '0 0 0 3px #fff, 0 0 0 5px #f0c040' : '0 0 0 1px #444' }}
                onClick={() => setColor(c.hex)}
              />
            );
          })}
        </div>

        {/* Canvas — wrapper keeps it square, filling available height */}
        <div style={s.canvasWrap}>
          {/* Undo / Redo row above canvas */}
          <div style={s.undoRow}>
            <button type="button" aria-label="Undo" style={{ ...s.toolBtn, ...s.toolBtnIcon, opacity: canUndo ? 1 : 0.3 }} onClick={handleUndo} disabled={!canUndo}>
              {UNDO_ICON}
            </button>
            <button type="button" aria-label="Redo" style={{ ...s.toolBtn, ...s.toolBtnIcon, opacity: canRedo ? 1 : 0.3 }} onClick={handleRedo} disabled={!canRedo}>
              {REDO_ICON}
            </button>
          </div>
          <canvas
            ref={canvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            style={{ ...s.canvas, cursor: canvasCursor }}
            onMouseDown={startDraw}
            onMouseMove={draw}
            onMouseUp={stopDraw}
            onMouseLeave={stopDraw}
          />
        </div>

        {/* Right: tool buttons */}
        <div style={s.toolCol}>
          {RIGHT_TOOLS.map((t) => {
            const isActive = t.type === 'color'
              ? (activeTool === 'brush' || activeTool === 'bucket') && activeColor === t.hex
              : activeTool === t.id;
            const ring = isActive ? '0 0 0 3px #fff, 0 0 0 5px #f0c040' : '0 0 0 1px #444';
            if (t.type === 'color') {
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-label={t.label}
                  style={{
                    ...s.toolBtn,
                    background: t.hex,
                    boxShadow: ring,
                    border: t.hex === '#ffffff' ? '1px solid #555' : 'none',
                  }}
                  onClick={() => setColor(t.hex)}
                />
              );
            }
            return (
              <button
                key={t.id}
                type="button"
                aria-label={t.label}
                style={{ ...s.toolBtn, ...s.toolBtnIcon, boxShadow: ring }}
                onClick={() => setTool(t.id)}
              >
                {TOOL_ICONS[t.id]}
              </button>
            );
          })}
        </div>
      </div>{/* end drawRow */}
      </div>{/* end middle */}

      <div style={s.btnRow}>
        <button
          type="button"
          style={{ ...s.clearBtn, opacity: hasDrawn && !uploading ? 1 : 0.35 }}
          onClick={handleClear}
          disabled={!hasDrawn || uploading}
        >
          Clear
        </button>
        <button
          type="button"
          style={{ ...s.submitBtn, opacity: hasDrawn && !uploading ? 1 : 0.35, cursor: hasDrawn && !uploading ? 'pointer' : 'not-allowed' }}
          onClick={handleSubmit}
          disabled={!hasDrawn || uploading}
        >
          {uploading ? 'Uploading…' : 'Submit Drawing →'}
        </button>
      </div>
    </div>
  );
}

// Simple SVG icon labels for the tool buttons (right column)
const UNDO_ICON = (
  <svg viewBox="0 0 24 24" width="min(5.5vmin, 36px)" height="min(5.5vmin, 36px)" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 10h10a5 5 0 0 1 0 10H7"/>
    <polyline points="3 10 7 6 3 6"/>
  </svg>
);

const REDO_ICON = (
  <svg viewBox="0 0 24 24" width="min(5.5vmin, 36px)" height="min(5.5vmin, 36px)" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10H11a5 5 0 0 0 0 10h6"/>
    <polyline points="21 10 17 6 21 6"/>
  </svg>
);

const TOOL_ICONS = {
  eraser: (
    <svg viewBox="0 0 24 24" width="min(5.5vmin, 36px)" height="min(5.5vmin, 36px)" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 20H7L3 16l10-10 7 7-3.5 3.5"/>
      <path d="M6.5 17.5l4-4"/>
    </svg>
  ),
  bucket: (
    <svg viewBox="0 0 24 24" width="min(5.5vmin, 36px)" height="min(5.5vmin, 36px)" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 11c0 5-3.5 9-7.5 9S4 16 4 11l7.5-8 7.5 8z"/>
      <line x1="4" y1="11" x2="20" y2="11"/>
      <circle cx="20" cy="18" r="2" fill="#fff" stroke="none"/>
    </svg>
  ),
  brush: (
    <svg viewBox="0 0 24 24" width="min(5.5vmin, 36px)" height="min(5.5vmin, 36px)" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 17c0 2.5 2 3 3 3 1.5 0 3-1 3-3v-1H3v1z"/>
      <path d="M9 16V5l3-2 3 2v11"/>
      <line x1="9" y1="12" x2="15" y2="12"/>
    </svg>
  ),
};

const s = {
  root: {
    height: '100dvh',
    maxHeight: '100dvh',
    overflow: 'hidden',
    background: '#0d0d0d',
    color: '#fff',
    fontFamily: "'Segoe UI', sans-serif",
    display: 'flex',
    flexDirection: 'column',
    boxSizing: 'border-box',
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 14px 6px',
  },
  header: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#f0c040',
    letterSpacing: 1,
  },
  backBtn: {
    background: '#7a1a1a',
    color: '#fff',
    border: 'none',
    fontWeight: 'bold',
    fontSize: 14,
    borderRadius: 6,
    padding: '8px 14px',
    cursor: 'pointer',
  },
  promptBox: {
    margin: '4px 8px 8px',
    background: '#1a1a2e',
    borderRadius: 8,
    padding: '8px 12px',
    border: '1px solid #2a2a4a',
  },
  promptLabel: {
    fontSize: 10,
    color: '#666',
    marginBottom: 3,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  promptText: {
    fontSize: 17,
    fontWeight: 800,
    color: '#f0c040',
    lineHeight: 1.2,
    marginBottom: 3,
  },
  promptSub: {
    fontSize: 11,
    color: '#777',
  },
  errorBox: {
    margin: '0 20px 10px',
    padding: '8px 12px',
    background: '#2a1010',
    border: '1px solid #aa3333',
    borderRadius: 8,
    color: '#ff8888',
    fontSize: 13,
  },
  // ── Drawing area ──────────────────────────────────────────────────────────
  middle: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawRow: {
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 6,
  },
  toolCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    justifyContent: 'space-evenly',
    flexShrink: 0,
    height: 'min(72vmin, 480px)',
  },
  toolBtn: {
    width: 'min(12.96vmin, 86px)',
    height: 'min(12.96vmin, 86px)',
    borderRadius: 7,
    border: 'none',
    cursor: 'pointer',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    transition: 'box-shadow 0.1s',
  },
  toolBtnIcon: {
    background: '#1e1e1e',
  },
  canvasWrap: {
    width: 'min(72vmin, 480px)',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  undoRow: {
    width: 'min(72vmin, 480px)',
    display: 'flex',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    paddingBottom: 4,
  },
  canvas: {
    width: 'min(72vmin, 480px)',
    height: 'min(72vmin, 480px)',
    display: 'block',
    borderRadius: 10,
    border: '2px solid #333',
    touchAction: 'none',
    background: '#fff',
  },
  btnRow: {
    display: 'flex',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    padding: '10px 0 16px',
    flexShrink: 0,
    width: 'calc(min(72vmin, 480px) + 2 * min(12.96vmin, 86px) + 12px)',
    alignSelf: 'center',
  },
  clearBtn: {
    background: '#2a2a2a',
    border: '1px solid #444',
    color: '#ccc',
    borderRadius: 8,
    padding: '12px 28px',
    cursor: 'pointer',
    fontSize: 17,
    fontWeight: 600,
  },
  submitBtn: {
    background: '#1a3a1a',
    border: 'none',
    color: '#2ecc71',
    borderRadius: 8,
    padding: '12px 36px',
    fontSize: 17,
    fontWeight: 700,
  },
};
