/**
 * FooterPanel
 *
 * Stateless renderer. Transition state is managed by FooterDisplay.
 * FooterDisplay also renders the floating badge above the panel.
 */

import { } from 'react';
import BalanceGraph from '../../components/BalanceGraph';

export const TRANSITION_MS = 320;

export const TYPE_ACCENT = {
  'fun-statement':  '#f0c040',
  'player-drawing': '#9b59b6',
  'stat':           '#2ecc71',
  'event':          '#e74c3c',
  'balance-graph':  '#e67e22',
  'elimination':    '#e74c3c',
};

function formatMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return '$' + n.toFixed(2);
}

// ── Item renderers ────────────────────────────────────────────────────────────

function FunStatementItem({ player, text }) {
  const accent = TYPE_ACCENT['fun-statement'];
  return (
    <div style={s.row}>
      {player?.profileImageUrl && (
        <img src={player.profileImageUrl} alt={player.displayName} style={s.avatar} />
      )}
      <div style={s.name(accent)}>{player?.displayName}</div>
      <div style={s.divider} />
      <div style={s.text}>"{text}"</div>
    </div>
  );
}

function DrawingItem({ player, height }) {
  const accent = TYPE_ACCENT['player-drawing'];
  const imgHeight = (height || 220) - 16;
  return (
    <div style={s.drawingRow}>
      <img
        src={player.drawingImageUrl}
        alt="Drawing"
        style={{ ...s.drawingFull(accent), height: imgHeight }}
      />
      <div style={s.drawingMeta}>
        <div style={s.drawingPromptLabel}>PROMPT</div>
        <div style={s.drawingPromptText}>{player.drawingPrompt || '(no prompt)'}</div>
        <div style={{ ...s.name(accent), marginTop: 6 }}>{player?.displayName}</div>
      </div>
    </div>
  );
}

function StatItem({ label, player, value, icon, raw }) {
  const accent = TYPE_ACCENT['stat'];
  const displayValue = raw ? String(value) : formatMoney(value);
  return (
    <div style={s.row}>
      {player && <div style={s.name(accent)}>{player.displayName}</div>}
      {player && <div style={s.divider} />}
      <div style={{ ...s.text, fontSize: 20, fontWeight: 800, color: accent, fontVariantNumeric: 'tabular-nums' }}>
        {displayValue}
      </div>
    </div>
  );
}

function EliminationItem({ players }) {
  return (
    <div style={s.elimRow}>
      <div style={s.elimPlayersWrap}>
        {players.slice(0, 6).map((player) => {
          const accent = TYPE_ACCENT['elimination'];
          return (
            <div key={player.id} style={s.elimPlayerBlock}>
              {player.profileImageUrl ? (
                <img src={player.profileImageUrl} alt={player.displayName} style={s.elimAvatar} />
              ) : (
                <div style={s.elimAvatarPlaceholder(accent)}>
                  {(player.displayName || '?')[0].toUpperCase()}
                </div>
              )}
              <div style={s.elimPlayerName(accent)}>
                {(player.displayName || player.id).split(' ')[0]}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BalanceGraphItem({ label, players }) {
  const accent = TYPE_ACCENT['balance-graph'];
  // Show up to 4 players, each with their own mini graph
  const shown = players.slice(0, 4);
  return (
    <div style={s.graphRow}>
      <div style={s.graphChartsWrap}>
        {shown.map((player) => (
          <div key={player.id} style={s.graphChartBlock}>
            {player.profileImageUrl ? (
              <img src={player.profileImageUrl} alt={player.displayName} style={s.graphAvatar(accent)} />
            ) : (
              <div style={s.graphAvatarPlaceholder(accent)}>
                {(player.displayName || '?')[0].toUpperCase()}
              </div>
            )}
            <div style={s.graphChartContent}>
              <BalanceGraph
                history={player.balanceHistory}
                width={shown.length === 1 ? 180 : 130}
                height={60}
                color={null}
              />
              <div style={s.graphChartName(accent)}>{player.displayName?.split(' ')[0] ?? player.id}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EventItem({ content }) {
  return (
    <div style={s.row}>
      {content}
    </div>
  );
}

function ItemRenderer({ item, height }) {
  if (!item) return null;
  switch (item.type) {
    case 'fun-statement':  return <FunStatementItem {...item.data} />;
    case 'player-drawing': return <DrawingItem {...item.data} height={height} />;
    case 'stat':           return <StatItem {...item.data} />;
    case 'event':          return <EventItem {...item.data} />;
    case 'balance-graph':  return <BalanceGraphItem {...item.data} />;
    case 'elimination':    return <EliminationItem {...item.data} />;
    default:               return null;
  }
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * FooterPanel — stateless.
 * displayItem: the item to render (managed by FooterDisplay).
 * itemVisible: opacity/translate state (managed by FooterDisplay).
 */
export default function FooterPanel({ displayItem, itemVisible, height = 72 }) {
  const accent = TYPE_ACCENT[displayItem?.type] ?? '#f0c040';

  return (
    <div style={s.root(accent, height)}>
      <div
        style={{
          ...s.inner,
          opacity: itemVisible ? 1 : 0,
          transform: itemVisible ? 'translateY(0)' : 'translateY(6px)',
          transition: `opacity ${TRANSITION_MS}ms ease, transform ${TRANSITION_MS}ms ease`,
        }}
      >
        <ItemRenderer item={displayItem} height={height} />
      </div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const s = {
  root: (accent, height) => ({
    width: '100%',
    height: height,
    minHeight: height,
    background: 'linear-gradient(180deg, #111318 0%, #0a0b0e 100%)',
    borderTop: `2px solid ${accent}55`,
    display: 'flex',
    alignItems: 'center',
    overflow: 'hidden',
    fontFamily: "'Segoe UI', sans-serif",
    color: '#fff',
    transition: 'border-color 0.5s ease',
    boxSizing: 'border-box',
  }),
  inner: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 20px',
    boxSizing: 'border-box',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    maxWidth: '100%',
    overflow: 'hidden',
  },
  badge: (color) => ({
    background: color + '1a',
    color: color,
    border: `1px solid ${color}44`,
    borderRadius: 4,
    padding: '3px 8px',
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  }),
  avatar: {
    width: 44,
    height: 44,
    borderRadius: '50%',
    objectFit: 'cover',
    flexShrink: 0,
    border: '2px solid #333',
  },
  name: (color) => ({
    color: color,
    fontWeight: 700,
    fontSize: 15,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  }),
  divider: {
    width: 1,
    height: 32,
    background: '#2a2a2a',
    flexShrink: 0,
  },
  text: {
    color: '#ccc',
    fontSize: 15,
    maxWidth: 420,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  drawingRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    height: '100%',
    width: '100%',
    padding: '8px 0',
    boxSizing: 'border-box',
  },
  drawingFull: (accent) => ({
    width: 'auto',
    maxWidth: '45%',
    objectFit: 'contain',
    borderRadius: 8,
    border: `2px solid ${accent}55`,
    flexShrink: 0,
  }),
  drawingMeta: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    maxWidth: 320,
    overflow: 'hidden',
    minWidth: 0,
  },
  drawingPromptLabel: {
    fontSize: 9,
    color: '#555',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  drawingPromptText: {
    fontSize: 14,
    color: '#ccc',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  graphRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    width: '100%',
    overflow: 'hidden',
  },
  graphChartsWrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    flex: 1,
    width: '100%',
    overflow: 'hidden',
  },
  graphChartBlock: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  graphAvatar: (color) => ({
    width: 40,
    height: 40,
    borderRadius: '50%',
    objectFit: 'cover',
    border: `2px solid ${color}`,
    flexShrink: 0,
  }),
  graphAvatarPlaceholder: (color) => ({
    width: 40,
    height: 40,
    borderRadius: '50%',
    background: '#1a1a1a',
    border: `2px solid ${color}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 18,
    fontWeight: 800,
    color,
    flexShrink: 0,
  }),
  graphChartContent: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
  },
  graphChartName: (color) => ({
    fontSize: 10,
    fontWeight: 700,
    color: color,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  }),
  elimRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    width: '100%',
    overflow: 'hidden',
  },
  elimPlayersWrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    flex: 1,
    overflow: 'hidden',
  },
  elimPlayerBlock: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  elimAvatar: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    objectFit: 'cover',
    border: '2px solid #e74c3c',
    flexShrink: 0,
    filter: 'grayscale(60%)',
  },
  elimAvatarPlaceholder: (color) => ({
    width: 64,
    height: 64,
    borderRadius: '50%',
    background: '#1a1a1a',
    border: `2px solid ${color}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 24,
    fontWeight: 800,
    color: color,
    flexShrink: 0,
  }),
  elimPlayerName: (color) => ({
    fontSize: 11,
    fontWeight: 700,
    color: color,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    whiteSpace: 'nowrap',
    maxWidth: 70,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }),
};

