import { useState, useEffect } from 'react';
import Avatar from '../../components/Avatar';
import GameEndLeaderboard from './GameEndLeaderboard';

// Stagger = half of fall duration so at any moment:
// player N is landing, N+1 is halfway, N+2 is just starting
const STAGGER_MS = 300;
const FALL_ANIM_MS = 600;
const SUSPENSE_MS = 1500;
const V_SPACING = 42;   // vertical gap between pyramid rows
const H_SPACING = 50;   // horizontal gap between avatar centers in a row
const PILE_ANCHOR_PCT = 83; // % from top of pile container where row-0 sits

// Compute pyramid row sizes bottom-to-top: [4,3,2,1] etc.
function pyramidRows(n) {
  if (n === 0) return [];
  let maxRow = 1;
  while (maxRow * (maxRow + 1) / 2 < n) maxRow++;
  const rows = [];
  let rem = n;
  for (let size = maxRow; size >= 1 && rem > 0; size--) {
    const count = Math.min(size, rem);
    rows.push(count);
    rem -= count;
  }
  return rows; // rows[0] = bottom (widest), rows[last] = top (narrowest)
}

export default function KingOfMKMGAScreen({ players, kingId, getFavoriteColor, gameState }) {
  const king = players.find((p) => p.id === kingId) ?? null;

  const [pileData] = useState(() => {
    const nonKing = players
      .filter((p) => p.id !== kingId)
      .map((p) => ({
        p,
        rand: Math.random(),
        races: p.eliminationSummary?.survivedRaces ?? Infinity,
      }))
      .sort((a, b) => a.races - b.races || a.rand - b.rand)
      .map(({ p }) => p);

    const rows = pyramidRows(nonKing.length);
    const numRows = rows.length;

    // Assign a {x, y, rot} position for each player in pyramid order
    // y is negative = up (row 0 is at y=0, row 1 at y=-V_SPACING, etc.)
    const positions = [];
    rows.forEach((count, rowIdx) => {
      const totalWidth = (count - 1) * H_SPACING;
      for (let j = 0; j < count; j++) {
        const x = count === 1 ? 0 : (j / (count - 1) - 0.5) * totalWidth;
        const y = -rowIdx * V_SPACING;
        positions.push({
          x: x + (Math.random() - 0.5) * 10,
          y: y + (Math.random() - 0.5) * 8,
          rot: (Math.random() - 0.5) * 20,
        });
      }
    });

    // King sits one full V_SPACING above the apex row, plus extra clearance
    const kingY = -(numRows * V_SPACING + 18);

    return {
      layout: nonKing.map((player, i) => ({ player, ...positions[i] })),
      kingY,
    };
  });

  const { layout: pileLayout, kingY } = pileData;
  const n = pileLayout.length;
  const kingSlamAt = n * STAGGER_MS + FALL_ANIM_MS + SUSPENSE_MS;

  const [kingVisible, setKingVisible] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [flash, setFlash] = useState(false);
  const [titleVisible, setTitleVisible] = useState(false);
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [crownVisible, setCrownVisible] = useState(false);
  const [kingFading, setKingFading] = useState(false);

  // Leaderboard transition: 20s after the king slams onto the pile
  const leaderboardAt = kingSlamAt + 20000;

  useEffect(() => {
    const T = (fn, ms) => setTimeout(fn, ms);
    const timers = [
      T(() => setKingVisible(true), kingSlamAt),
      T(() => { setShaking(true); setFlash(true); }, kingSlamAt),
      T(() => setShaking(false), kingSlamAt + 480),
      T(() => setFlash(false), kingSlamAt + 360),
      T(() => setTitleVisible(true), kingSlamAt + 700),
      T(() => setDetailsVisible(true), kingSlamAt + 2700),
      T(() => setCrownVisible(true), kingSlamAt + 3800),
      T(() => setKingFading(true), leaderboardAt),
    ];
    return () => timers.forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!king) return null;

  // Leaderboard renders beneath the king screen from the start.
  // When kingFading fires, the king screen fades to 0 revealing the leaderboard instantly.
  return (
    <>
      <GameEndLeaderboard
        players={players}
        kingId={kingId}
        getFavoriteColor={getFavoriteColor}
        gameState={gameState}
      />
      <div style={{
        ...s.root,
        opacity: kingFading ? 0 : 1,
        transition: 'opacity 1.4s ease',
        pointerEvents: kingFading ? 'none' : undefined,
      }}>
      {flash && <div className="king-flash-overlay" style={s.flash} />}

      <div className={shaking ? 'king-screen-shake' : undefined} style={s.inner}>

        {/* Title — space always reserved so layout doesn't shift when it appears */}
        <div
          style={{ ...s.title, opacity: titleVisible ? 1 : 0 }}
          className={titleVisible ? 'king-title-slam' : undefined}
        >
          THE KING OF MKMGA!!
        </div>

        {/* Center row: #1 · pile · name */}
        <div style={s.centerRow}>

          <div style={{
            ...s.posNumber,
            opacity: detailsVisible ? 1 : 0,
            transform: detailsVisible ? 'translateY(0)' : 'translateY(20px)',
            transition: 'opacity 0.9s ease, transform 0.9s ease',
          }}>
            #1
          </div>

          {/* Pile container — grows upward from anchor at PILE_ANCHOR_PCT */}
          <div style={s.pile}>

            {/* Greyed-out eliminated player avatars in pyramid */}
            {pileLayout.map(({ player, x, y, rot }, i) => (
              <div
                key={player.id}
                style={{
                  position: 'absolute',
                  top: `calc(${PILE_ANCHOR_PCT}% + ${y}px)`,
                  left: `calc(50% + ${x}px)`,
                  zIndex: i + 1,
                }}
              >
                <div
                  className="king-pile-fall"
                  style={{
                    '--rot': `${rot}deg`,
                    animationDelay: `${i * STAGGER_MS}ms`,
                    animationDuration: `${FALL_ANIM_MS}ms`,
                    animationFillMode: 'both',
                  }}
                >
                  <Avatar
                    player={player}
                    size={56}
                    borderWidth={2}
                    getFavoriteColor={getFavoriteColor}
                    style={{ filter: 'grayscale(1) brightness(0.5)' }}
                  />
                </div>
              </div>
            ))}

            {/* King slams down above the pyramid apex */}
            {kingVisible && (
              <div
                className="king-slam"
                style={{
                  position: 'absolute',
                  top: `calc(${PILE_ANCHOR_PCT}% + ${kingY}px)`,
                  left: '50%',
                  zIndex: n + 10,
                }}
              >
                {/* Crown is nested inside king wrapper so it stays above the king's head */}
                <div style={{ position: 'relative' }}>
                  <Avatar
                    player={king}
                    size={112}
                    borderWidth={5}
                    borderColor="#f0c040"
                    getFavoriteColor={getFavoriteColor}
                    style={{ boxShadow: '0 0 40px rgba(240,192,64,0.9), 0 0 90px rgba(240,192,64,0.4)' }}
                  />
                  {crownVisible && (
                    <div
                      className="king-crown-fall"
                      style={{
                        position: 'absolute',
                        top: -50,
                        left: '50%',
                        fontSize: 60,
                        lineHeight: 1,
                        zIndex: 1,
                        userSelect: 'none',
                      }}
                    >
                      👑
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div style={{
            ...s.kingName,
            opacity: detailsVisible ? 1 : 0,
            transform: detailsVisible ? 'translateY(0)' : 'translateY(20px)',
            transition: 'opacity 0.9s ease, transform 0.9s ease',
          }}>
            {king.displayName || king.realName}
          </div>
        </div>
      </div>
    </div>
    </>
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
  flash: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(255, 215, 80, 0.5)',
    zIndex: 500,
    pointerEvents: 'none',
  },
  inner: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 48,
    width: '100%',
  },
  title: {
    fontSize: 'clamp(28px, 5vw, 68px)',
    fontWeight: 900,
    color: '#f0c040',
    letterSpacing: 4,
    textTransform: 'uppercase',
    fontFamily: "'Segoe UI', 'Impact', 'Arial Black', sans-serif",
    textShadow: '0 0 30px rgba(240,192,64,0.8), 0 0 70px rgba(240,192,64,0.35)',
    textAlign: 'center',
    padding: '0 24px',
  },
  centerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 52,
  },
  posNumber: {
    fontSize: 'clamp(48px, 8vw, 96px)',
    fontWeight: 900,
    color: '#f0c040',
    fontFamily: "'Segoe UI', 'Impact', 'Arial Black', sans-serif",
    textShadow: '0 0 24px rgba(240,192,64,0.7)',
    lineHeight: 1,
    width: 140,
    textAlign: 'center',
    flexShrink: 0,
  },
  pile: {
    position: 'relative',
    width: 420,
    height: 310,
    overflow: 'visible',
    flexShrink: 0,
  },
  kingName: {
    fontSize: 'clamp(20px, 3vw, 38px)',
    fontWeight: 900,
    color: '#ffffff',
    fontFamily: "'Segoe UI', 'Arial Black', sans-serif",
    textShadow: '0 0 20px rgba(255,255,255,0.35)',
    width: 220,
    textAlign: 'center',
    flexShrink: 0,
    lineHeight: 1.25,
    wordBreak: 'break-word',
  },
};
