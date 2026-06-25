import { useMemo } from 'react';
import Avatar from '../../components/Avatar';

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function computeRankings(players, kingId, totalRaces) {
  const mapped = players.map((p) => ({
    ...p,
    _sortRaces: p.id === kingId ? Infinity : (p.eliminationSummary?.survivedRaces ?? 0),
    _name: (p.displayName || p.realName || '').toLowerCase(),
    displayedRaces: p.id === kingId ? totalRaces : (p.eliminationSummary?.survivedRaces ?? 0),
  }));
  mapped.sort((a, b) => {
    if (b._sortRaces !== a._sortRaces) return b._sortRaces - a._sortRaces;
    return a._name.localeCompare(b._name);
  });
  let pos = 1;
  return mapped.map((p, i) => {
    if (i > 0 && p._sortRaces !== mapped[i - 1]._sortRaces) pos = i + 1;
    return { ...p, finalPosition: pos };
  });
}

// Repeat items until total >= MIN_TOTAL for a seamless infinite loop.
// Translates by -1/reps of track height = exactly one copy = seamless.
const MIN_TOTAL_ITEMS = 22;

function CreditsPanel({ items, borderSide }) {
  const reps = Math.max(2, Math.ceil(MIN_TOTAL_ITEMS / Math.max(1, items.length)));
  const scrollEnd = `-${(100 / reps).toFixed(4)}%`;
  const duration = Math.max(14, items.length * 3.8);
  const borderStyle = borderSide === 'right'
    ? { borderRight: '1px solid rgba(255,255,255,0.06)' }
    : { borderLeft: '1px solid rgba(255,255,255,0.06)' };

  return (
    <div style={{ ...s.panelOuter, ...borderStyle }}>
      <div style={s.panelFadeTop} />
      <div style={s.panelFadeBot} />
      <div
        className="end-credits-scroll-track"
        style={{ animationDuration: `${duration}s`, '--scroll-end': scrollEnd }}
      >
        {Array.from({ length: reps }, (_, r) =>
          items.map((item, i) => <div key={`${r}-${i}`}>{item}</div>)
        )}
      </div>
    </div>
  );
}

// --- Generic stat card ---
function StatCard({ icon, label, value, sub }) {
  return (
    <div style={s.statCard}>
      {icon && <div style={s.statIcon}>{icon}</div>}
      <div style={s.statLabel}>{label}</div>
      <div style={s.statValue}>{value}</div>
      {sub && <div style={s.statSub}>{sub}</div>}
    </div>
  );
}

// --- Drawing card: full-width square image ---
function DrawingCard({ player, getFavoriteColor }) {
  const name = player.displayName || player.realName;
  const nameColor = getFavoriteColor?.(player) ?? '#e0e0e0';
  return (
    <div style={s.drawingCard}>
      <img
        src={player.drawingImageUrl}
        alt=""
        style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', display: 'block' }}
      />
      <div style={s.drawingLabel}>
        <Avatar player={player} size={28} borderWidth={2} getFavoriteColor={getFavoriteColor} />
        <div style={s.drawingLabelText}>
          <div style={{ color: nameColor, fontWeight: 800, fontSize: 14, lineHeight: 1.2 }}>{name}</div>
          {player.drawingPrompt && (
            <div style={{ color: '#ccc', fontSize: 12, lineHeight: 1.3, marginTop: 2 }}>{player.drawingPrompt}</div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Quote card: avatar + "{name} says: {prompt}" ---
function QuoteCard({ player, getFavoriteColor }) {
  const name = player.displayName || player.realName;
  const nameColor = getFavoriteColor?.(player) ?? '#e0e0e0';
  return (
    <div style={s.quoteCard}>
      <Avatar player={player} size={36} borderWidth={2} getFavoriteColor={getFavoriteColor} />
      <div style={s.quoteText}>
        <span style={{ color: nameColor, fontWeight: 800 }}>{name}</span>
        <span style={{ color: '#888' }}> says: </span>
        <span style={{ color: '#ccc', fontStyle: 'italic' }}>"{player.funStatement}"</span>
      </div>
    </div>
  );
}

// --- Center leaderboard row ---
function RankRow({ player, getFavoriteColor, compact }) {
  const isFirst = player.finalPosition === 1;
  const nameColor = getFavoriteColor?.(player) ?? '#d0d0d0';
  return (
    <div style={{
      ...s.rankRow,
      ...(isFirst ? s.rankRowFirst : {}),
      padding: compact ? '7px 16px' : '11px 18px',
    }}>
      <div style={{ ...s.rankPos, fontSize: compact ? 14 : 18, width: compact ? 32 : 44 }}>
        {isFirst ? '👑' : `#${player.finalPosition}`}
      </div>
      <Avatar
        player={player}
        size={isFirst ? (compact ? 42 : 52) : (compact ? 32 : 42)}
        borderWidth={isFirst ? 3 : 2}
        borderColor={isFirst ? '#f0c040' : undefined}
        getFavoriteColor={getFavoriteColor}
      />
      <div style={{ ...s.rankName, fontSize: compact ? 14 : 18, color: nameColor }}>
        {player.displayName || player.realName}
      </div>
      <div style={{ ...s.rankRaces, fontSize: compact ? 12 : 14 }}>
        {player.displayedRaces} race{player.displayedRaces !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

// --- Main ---
export default function GameEndLeaderboard({ players, kingId, getFavoriteColor, gameState }) {
  const totalRaces = gameState?.raceNumber ?? 0;
  const rankings = useMemo(
    () => computeRankings(players, kingId, totalRaces),
    [players, kingId, totalRaces],
  );
  const compact = rankings.length > 8;

  // Build the full pool of banner content items
  const allItems = useMemo(() => {
    const king = rankings.find((p) => p.finalPosition === 1);
    const eliminated = players.filter((p) => p.id !== kingId && p.eliminationSummary);

    const longestRun = [...eliminated].sort(
      (a, b) => (b.eliminationSummary.survivedRaces ?? 0) - (a.eliminationSummary.survivedRaces ?? 0),
    )[0];
    const firstOut = [...eliminated].sort(
      (a, b) => (a.eliminationSummary.survivedRaces ?? 0) - (b.eliminationSummary.survivedRaces ?? 0),
    )[0];
    const avgSurvival = eliminated.length > 0
      ? (eliminated.reduce((a, p) => a + (p.eliminationSummary?.survivedRaces ?? 0), 0) / eliminated.length).toFixed(1)
      : null;

    const items = [];

    // Game-level stat cards
    items.push(<StatCard key="races" icon="🏁" label="Total Races" value={totalRaces} />);
    items.push(<StatCard key="players" icon="👥" label="Players" value={players.length} />);
    if (king) {
      items.push(
        <StatCard key="king" icon="🏆" label="King of MKMGA"
          value={king.displayName || king.realName}
          sub={`${king.displayedRaces} races survived`}
        />
      );
    }
    if (longestRun && longestRun.id !== firstOut?.id) {
      items.push(
        <StatCard key="longest" icon="🏅" label="Longest Runner-Up"
          value={longestRun.displayName || longestRun.realName}
          sub={`${longestRun.eliminationSummary.survivedRaces} races`}
        />
      );
    }
    if (firstOut) {
      items.push(
        <StatCard key="first" icon="⚡" label="First Out"
          value={firstOut.displayName || firstOut.realName}
          sub={`Eliminated at race ${(firstOut.eliminationSummary.survivedRaces ?? 0) + 1}`}
        />
      );
    }
    if (avgSurvival) {
      items.push(<StatCard key="avg" icon="📊" label="Avg. Survival" value={`${avgSurvival} races`} />);
    }

    // UGC: drawings
    players.filter((p) => p.drawingImageUrl).forEach((p) => {
      items.push(
        <DrawingCard key={`draw-${p.id}`} player={p} getFavoriteColor={getFavoriteColor} />
      );
    });

    // UGC: fun statements as player "says" cards
    players.filter((p) => p.funStatement?.trim()).forEach((p) => {
      items.push(
        <QuoteCard key={`quote-${p.id}`} player={p} getFavoriteColor={getFavoriteColor} />
      );
    });

    return items;
  // getFavoriteColor is a stable module-level function, safe to omit from deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankings, players, kingId, totalRaces]);

  // Each side gets its own independent shuffle — different order, same pool
  const leftItems  = useMemo(() => shuffle(allItems), [allItems]);
  const rightItems = useMemo(() => shuffle(allItems), [allItems]);

  return (
    <div style={s.root}>
      <div style={s.scanlines} />

      <CreditsPanel items={leftItems} borderSide="right" />

      <div style={s.center}>
        <div style={s.centerTitle}>FINAL STANDINGS</div>
        <div style={s.rankList}>
          {rankings.map((p) => (
            <RankRow key={p.id} player={p} getFavoriteColor={getFavoriteColor} compact={compact} />
          ))}
        </div>
      </div>

      <CreditsPanel items={rightItems} borderSide="left" />
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
    flexDirection: 'row',
    alignItems: 'stretch',
    overflow: 'hidden',
  },
  scanlines: {
    position: 'absolute',
    inset: 0,
    backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.08) 3px, rgba(0,0,0,0.08) 4px)',
    pointerEvents: 'none',
    zIndex: 1,
  },
  panelOuter: {
    width: '25%',
    flexShrink: 0,
    position: 'relative',
    overflow: 'hidden',
    zIndex: 2,
  },
  panelFadeTop: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 100,
    background: 'linear-gradient(to bottom, #050508 0%, transparent 100%)',
    zIndex: 3,
    pointerEvents: 'none',
  },
  panelFadeBot: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: 100,
    background: 'linear-gradient(to top, #050508 0%, transparent 100%)',
    zIndex: 3,
    pointerEvents: 'none',
  },

  // Generic stat card
  statCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '14px 12px',
    margin: '4px 8px',
    background: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.08)',
    textAlign: 'center',
  },
  statIcon: { fontSize: 26, marginBottom: 6, lineHeight: 1 },
  statLabel: {
    fontSize: 9, fontWeight: 700, color: '#888',
    letterSpacing: 2, textTransform: 'uppercase', fontFamily: 'monospace', marginBottom: 4,
  },
  statValue: {
    fontSize: 18, fontWeight: 900, color: '#e8e8e8',
    fontFamily: "'Segoe UI', 'Arial Black', sans-serif", marginBottom: 2,
  },
  statSub: { fontSize: 11, color: '#999', fontFamily: "'Segoe UI', sans-serif" },

  // Drawing card — no side margins so image stretches full panel width
  drawingCard: {
    margin: '4px 0',
    overflow: 'hidden',
  },
  drawingLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 12px',
    background: 'rgba(0,0,0,0.75)',
  },
  drawingLabelText: {
    flex: 1,
    minWidth: 0,
  },

  // Quote card
  quoteCard: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: '12px 14px',
    margin: '4px 8px',
    background: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.08)',
  },
  quoteText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 1.4,
    fontFamily: "'Segoe UI', sans-serif",
    color: '#ccc',
  },

  // Center panel
  center: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '28px 0 20px',
    borderLeft: '1px solid rgba(255,255,255,0.06)',
    borderRight: '1px solid rgba(255,255,255,0.06)',
    zIndex: 2,
    overflow: 'hidden',
  },
  centerTitle: {
    fontSize: 'clamp(18px, 2.8vw, 38px)',
    fontWeight: 900,
    color: '#f0c040',
    letterSpacing: 6,
    textTransform: 'uppercase',
    fontFamily: "'Segoe UI', 'Impact', 'Arial Black', sans-serif",
    textShadow: '0 0 20px rgba(240,192,64,0.6)',
    marginBottom: 20,
    flexShrink: 0,
  },
  rankList: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    overflowY: 'auto',
    padding: '0 8px',
  },
  rankRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    background: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.07)',
  },
  rankRowFirst: {
    background: 'rgba(240,192,64,0.1)',
    border: '1px solid rgba(240,192,64,0.3)',
    boxShadow: '0 0 18px rgba(240,192,64,0.12)',
  },
  rankPos: {
    textAlign: 'center',
    fontWeight: 900,
    color: '#888',
    flexShrink: 0,
    fontFamily: "'Segoe UI', 'Arial Black', sans-serif",
  },
  rankName: {
    flex: 1,
    fontWeight: 700,
    fontFamily: "'Segoe UI', 'Arial', sans-serif",
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rankRaces: {
    color: '#888',
    fontFamily: 'monospace',
    flexShrink: 0,
    textAlign: 'right',
    paddingRight: 4,
  },
};
