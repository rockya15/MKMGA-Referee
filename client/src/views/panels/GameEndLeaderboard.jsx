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
    // Players with no eliminationSummary (still alive, non-king) survived all races
    _sortRaces: p.id === kingId
      ? Infinity
      : (p.eliminationSummary?.survivedRaces ?? totalRaces),
    _name: (p.displayName || p.realName || '').toLowerCase(),
    displayedRaces: p.id === kingId
      ? totalRaces
      : (p.eliminationSummary?.survivedRaces ?? totalRaces),
  }));

  mapped.sort((a, b) => {
    if (b._sortRaces !== a._sortRaces) return b._sortRaces - a._sortRaces;
    return a._name.localeCompare(b._name);
  });

  let pos = 0;
  let lastRaces = null;
  return mapped.map((p) => {
    if (p._sortRaces !== lastRaces) { pos++; lastRaces = p._sortRaces; }
    return { ...p, finalPosition: pos };
  });
}

// Distribute N tiles into rows of max 6, as evenly as possible.
function distributeRows(n) {
  if (n === 0) return [];
  const rows = Math.ceil(n / 6);
  const perRow = Math.ceil(n / rows);
  const result = [];
  let rem = n;
  for (let r = 0; r < rows; r++) {
    const count = Math.min(perRow, rem);
    result.push(count);
    rem -= count;
  }
  return result;
}

const MIN_TOTAL_ITEMS = 22;

function getPromptTitle(prompt) {
  if (!prompt) return '';
  let t = prompt.replace(/^draw\s+/i, '');
  t = t.replace(/^(a|an|the)\s+/i, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// --- Scroll panel ---
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

// --- Banner cards ---
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

function DrawingCard({ player, getFavoriteColor }) {
  const name = player.displayName || player.realName;
  const nameColor = getFavoriteColor?.(player) ?? '#e0e0e0';
  const title = getPromptTitle(player.drawingPrompt);
  return (
    <div style={s.drawingCard}>
      <img
        src={player.drawingImageUrl}
        alt=""
        style={s.drawingImg}
      />
      <div style={s.drawingOverlay}>
        <Avatar player={player} size={28} borderWidth={2} getFavoriteColor={getFavoriteColor} />
        <div style={s.drawingOverlayText}>
          <span style={{ color: nameColor, fontWeight: 700 }}>{name}</span>
          {title && <span style={{ color: '#ddd' }}>'s {title}</span>}
        </div>
      </div>
    </div>
  );
}

function QuoteCard({ player, getFavoriteColor }) {
  const name = player.displayName || player.realName;
  const nameColor = getFavoriteColor?.(player) ?? '#e0e0e0';
  return (
    <div style={s.quoteCard}>
      <Avatar player={player} size={36} borderWidth={2} getFavoriteColor={getFavoriteColor} />
      <div style={s.quoteText}>
        <span style={{ color: nameColor, fontWeight: 800 }}>{name}</span>
        <span style={{ color: '#ccc' }}> says: </span>
        <span style={{ color: '#fff', fontStyle: 'italic' }}>"{player.funStatement}"</span>
      </div>
    </div>
  );
}

// --- Center: tile-based placement groups ---
function PlacementTile({ player, isFirst, getFavoriteColor }) {
  const nameColor = getFavoriteColor?.(player) ?? '#d0d0d0';
  const name = player.displayName || player.realName;
  return (
    <div style={{ ...s.tile, ...(isFirst ? s.tileFirst : {}) }}>
      <Avatar
        player={player}
        size={isFirst ? 52 : 44}
        borderWidth={isFirst ? 3 : 2}
        borderColor={isFirst ? '#f0c040' : undefined}
        getFavoriteColor={getFavoriteColor}
      />
      <div style={{ ...s.tileName, color: nameColor }}>{name}</div>
    </div>
  );
}

function PlacementGroup({ position, players, getFavoriteColor }) {
  const isFirst = position === 1;
  const rowSizes = distributeRows(players.length);
  let idx = 0;

  return (
    <div style={s.group}>
      <div style={{ ...s.groupLabel, ...(isFirst ? s.groupLabelFirst : {}) }}>
        {isFirst ? '👑' : `#${position}`}
      </div>
      {rowSizes.map((count, r) => {
        const rowPlayers = players.slice(idx, idx + count);
        idx += count;
        return (
          <div key={r} style={s.tileRow}>
            {rowPlayers.map((p) => (
              <div key={p.id} style={{ flex: 1, minWidth: 0, maxWidth: `${100 / count}%` }}>
                <PlacementTile player={p} isFirst={isFirst} getFavoriteColor={getFavoriteColor} />
              </div>
            ))}
          </div>
        );
      })}
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

  // Group by finalPosition, preserving sort order
  const groups = useMemo(() => {
    const map = new Map();
    rankings.forEach((p) => {
      if (!map.has(p.finalPosition)) map.set(p.finalPosition, []);
      map.get(p.finalPosition).push(p);
    });
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [rankings]);

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

    items.push(<StatCard key="races" icon="🏁" label="Total Races" value={totalRaces} />);
    items.push(<StatCard key="players" icon="👥" label="Players" value={players.length} />);
    if (king) {
      items.push(<StatCard key="king" icon="🏆" label="King of MKMGA"
        value={king.displayName || king.realName}
        sub={`${king.displayedRaces} races survived`}
      />);
    }
    if (longestRun && longestRun.id !== firstOut?.id) {
      items.push(<StatCard key="longest" icon="🏅" label="Longest Runner-Up"
        value={longestRun.displayName || longestRun.realName}
        sub={`${longestRun.eliminationSummary.survivedRaces} races`}
      />);
    }
    if (firstOut) {
      items.push(<StatCard key="first" icon="⚡" label="First Out"
        value={firstOut.displayName || firstOut.realName}
        sub={`Eliminated at race ${(firstOut.eliminationSummary.survivedRaces ?? 0) + 1}`}
      />);
    }
    if (avgSurvival) {
      items.push(<StatCard key="avg" icon="📊" label="Avg. Survival" value={`${avgSurvival} races`} />);
    }

    players.filter((p) => p.drawingImageUrl).forEach((p) => {
      items.push(<DrawingCard key={`draw-${p.id}`} player={p} getFavoriteColor={getFavoriteColor} />);
    });

    players.filter((p) => p.funStatement?.trim()).forEach((p) => {
      items.push(<QuoteCard key={`quote-${p.id}`} player={p} getFavoriteColor={getFavoriteColor} />);
    });

    return items;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankings, players, kingId, totalRaces]);

  const leftItems  = useMemo(() => shuffle(allItems), [allItems]);
  const rightItems = useMemo(() => shuffle(allItems), [allItems]);

  return (
    <div style={s.root}>
      <div style={s.scanlines} />

      <CreditsPanel items={leftItems} borderSide="right" />

      <div style={s.center}>
        <div style={s.centerTitle}>FINAL STANDINGS</div>
        <div style={s.groupList}>
          {groups.map(([pos, grpPlayers]) => (
            <PlacementGroup
              key={pos}
              position={pos}
              players={grpPlayers}
              getFavoriteColor={getFavoriteColor}
            />
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

  // Scroll panels
  panelOuter: {
    width: '25%',
    flexShrink: 0,
    position: 'relative',
    overflow: 'hidden',
    zIndex: 2,
  },
  panelFadeTop: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 100,
    background: 'linear-gradient(to bottom, #050508 0%, transparent 100%)',
    zIndex: 3, pointerEvents: 'none',
  },
  panelFadeBot: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 100,
    background: 'linear-gradient(to top, #050508 0%, transparent 100%)',
    zIndex: 3, pointerEvents: 'none',
  },

  // Banner cards
  statCard: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    padding: '14px 12px', margin: '4px 8px',
    background: 'rgba(255,255,255,0.04)', borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.08)', textAlign: 'center',
  },
  statIcon: { fontSize: 'clamp(22px, 2vw, 32px)', marginBottom: 6, lineHeight: 1 },
  statLabel: {
    fontSize: 'clamp(9px, 0.75vw, 12px)', fontWeight: 700, color: '#aaa', letterSpacing: 2,
    textTransform: 'uppercase', fontFamily: 'monospace', marginBottom: 4,
  },
  statValue: {
    fontSize: 'clamp(15px, 1.4vw, 22px)', fontWeight: 900, color: '#fff',
    fontFamily: "'Segoe UI', 'Arial Black', sans-serif", marginBottom: 2,
  },
  statSub: { fontSize: 'clamp(11px, 0.85vw, 14px)', color: '#ccc', fontFamily: "'Segoe UI', sans-serif" },

  drawingCard: {
    margin: '4px 8px', borderRadius: 10, overflow: 'hidden', position: 'relative',
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
  },
  drawingImg: {
    width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', display: 'block',
  },
  drawingOverlay: {
    position: 'absolute', bottom: 0, left: 0,
    display: 'flex', alignItems: 'center', gap: 8,
    padding: 'clamp(8px, 1vmin, 12px) clamp(12px, 1.4vmin, 18px)',
    background: 'rgba(8, 8, 16, 0.88)',
    borderRadius: '0 clamp(10px, 1.4vw, 16px) 0 10px',
  },
  drawingOverlayText: {
    whiteSpace: 'nowrap',
    fontSize: 'clamp(13px, 1.3vw, 20px)', lineHeight: 1.25,
    fontFamily: "'Segoe UI', sans-serif",
  },

  quoteCard: {
    display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 'clamp(14px, 1.8vmin, 26px) 14px', margin: '4px 8px',
    background: 'rgba(255,255,255,0.04)', borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.08)',
    minHeight: 'clamp(64px, 9vmin, 110px)',
  },
  quoteText: {
    flex: 1, fontSize: 'clamp(13px, 1.15vw, 19px)', lineHeight: 1.45,
    fontFamily: "'Segoe UI', sans-serif", color: '#fff',
  },

  // Center panel
  center: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    padding: '24px 12px 16px',
    borderLeft: '1px solid rgba(255,255,255,0.06)',
    borderRight: '1px solid rgba(255,255,255,0.06)',
    zIndex: 2,
    overflow: 'hidden',
  },
  centerTitle: {
    fontSize: 'clamp(16px, 2.4vw, 32px)',
    fontWeight: 900, color: '#f0c040', letterSpacing: 6,
    textTransform: 'uppercase',
    fontFamily: "'Segoe UI', 'Impact', 'Arial Black', sans-serif",
    textShadow: '0 0 20px rgba(240,192,64,0.6)',
    marginBottom: 16, flexShrink: 0, textAlign: 'center',
  },
  groupList: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    overflowY: 'auto',
    overflowX: 'hidden',
  },

  // Placement groups
  group: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  groupLabel: {
    fontSize: 'clamp(12px, 1.2vw, 17px)', fontWeight: 900, color: '#bbb',
    fontFamily: "'Segoe UI', 'Arial Black', sans-serif",
    paddingLeft: 4, marginBottom: 2,
  },
  groupLabelFirst: {
    fontSize: 'clamp(18px, 2vw, 28px)', color: '#f0c040',
    textShadow: '0 0 12px rgba(240,192,64,0.5)',
  },
  tileRow: {
    display: 'flex',
    flexDirection: 'row',
    gap: 3,
  },

  // Individual tile
  tile: {
    height: 100,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    padding: '8px 4px',
    background: 'rgba(255,255,255,0.04)',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  tileFirst: {
    background: 'rgba(240,192,64,0.1)',
    border: '1px solid rgba(240,192,64,0.3)',
    boxShadow: '0 0 14px rgba(240,192,64,0.1)',
  },
  tileName: {
    fontSize: 'clamp(12px, 1.2vw, 17px)', fontWeight: 700,
    fontFamily: "'Segoe UI', 'Arial', sans-serif",
    textAlign: 'center', lineHeight: 1.2,
    overflow: 'hidden', textOverflow: 'ellipsis',
    whiteSpace: 'nowrap', width: '100%', padding: '0 6px',
  },
};
