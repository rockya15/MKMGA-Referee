import { useState, useEffect, useRef } from 'react';

const LETTERS = ['M', 'K', 'M', 'G', 'A'];
const LETTER_COLORS = ['#f0c040', '#e74c3c', '#3498db', '#2ecc71', '#c084fc'];
const FULL_NAME = 'MARIO KART MONEY GAMBLING ASSOCIATION';

export default function MKMGAEntryScreen() {
  const [typedCount, setTypedCount] = useState(0);
  const [glitchIndex, setGlitchIndex] = useState(-1);
  const [dots, setDots] = useState(0);
  const glitchTimerRef = useRef(null);

  // Typewriter effect — starts after 1.2s, then types one char every 55ms
  useEffect(() => {
    if (typedCount >= FULL_NAME.length) return;
    const delay = typedCount === 0 ? 1200 : 55;
    const t = setTimeout(() => setTypedCount((n) => n + 1), delay);
    return () => clearTimeout(t);
  }, [typedCount]);

  // Animated waiting dots
  useEffect(() => {
    const t = setInterval(() => setDots((d) => (d + 1) % 4), 500);
    return () => clearInterval(t);
  }, []);

  // Periodic random glitch on one letter
  useEffect(() => {
    const scheduleNext = () => {
      const wait = 2200 + Math.random() * 3800;
      glitchTimerRef.current = setTimeout(() => {
        const idx = Math.floor(Math.random() * LETTERS.length);
        setGlitchIndex(idx);
        setTimeout(() => setGlitchIndex(-1), 280);
        scheduleNext();
      }, wait);
    };
    scheduleNext();
    return () => clearTimeout(glitchTimerRef.current);
  }, []);

  return (
    <div style={s.root}>
      {/* Radial ambient glow behind letters */}
      <div style={s.bgGlow} />
      {/* CRT scanlines */}
      <div style={s.scanlines} />
      {/* Vignette */}
      <div style={s.vignette} />

      <div style={s.content}>
        <div style={s.lettersRow}>
          {LETTERS.map((letter, i) => (
            <span
              key={i}
              className={`mkmga-letter${glitchIndex === i ? ' mkmga-glitch' : ''}`}
              style={{
                ...s.letter,
                color: LETTER_COLORS[i],
                textShadow: `0 0 20px ${LETTER_COLORS[i]}, 0 0 55px ${LETTER_COLORS[i]}88, 0 0 100px ${LETTER_COLORS[i]}44`,
                animationDelay: `${-(i * 0.55)}s`,
              }}
            >
              {letter}
            </span>
          ))}
        </div>

        <div style={s.fullName}>
          {FULL_NAME.slice(0, typedCount)}
          {typedCount < FULL_NAME.length && <span className="mkmga-cursor">|</span>}
        </div>

        <div style={s.divider} />

        <div style={s.waiting} className="mkmga-waiting">
          Waiting for host to open lobby{'.'.repeat(dots)}
        </div>
      </div>
    </div>
  );
}

const s = {
  root: {
    position: 'absolute',
    inset: 0,
    zIndex: 200,
    background: '#050508',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  bgGlow: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: '120vw',
    height: '80vh',
    transform: 'translate(-50%, -50%)',
    background: 'radial-gradient(ellipse at center, rgba(30,10,60,0.85) 0%, rgba(5,5,8,0) 70%)',
    pointerEvents: 'none',
  },
  scanlines: {
    position: 'absolute',
    inset: 0,
    backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.1) 3px, rgba(0,0,0,0.1) 4px)',
    pointerEvents: 'none',
    zIndex: 1,
  },
  vignette: {
    position: 'absolute',
    inset: 0,
    background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.75) 100%)',
    pointerEvents: 'none',
    zIndex: 1,
  },
  content: {
    position: 'relative',
    zIndex: 2,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 0,
  },
  lettersRow: {
    display: 'flex',
    gap: 4,
    alignItems: 'center',
    marginBottom: 20,
  },
  letter: {
    fontSize: 'clamp(90px, 16vw, 170px)',
    fontWeight: 900,
    fontFamily: "'Segoe UI', 'Impact', 'Arial Black', sans-serif",
    lineHeight: 1,
    display: 'inline-block',
    letterSpacing: -4,
    userSelect: 'none',
  },
  fullName: {
    fontSize: 15,
    fontWeight: 700,
    color: '#999',
    letterSpacing: 4,
    fontFamily: 'monospace',
    minHeight: 22,
    textAlign: 'center',
    marginBottom: 36,
  },
  divider: {
    width: 120,
    height: 1,
    background: 'linear-gradient(90deg, transparent, #444, transparent)',
    marginBottom: 24,
  },
  waiting: {
    fontSize: 12,
    color: '#444',
    letterSpacing: 3,
    textTransform: 'uppercase',
    fontFamily: "'Segoe UI', sans-serif",
    display: 'flex',
    alignItems: 'center',
    gap: 2,
  },
};
