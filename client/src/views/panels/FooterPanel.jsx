/**
 * FooterPanel
 *
 * Currently an empty animated info dock. Future content:
 * - Fun facts about the game / players
 * - Knockout notifications
 * - Player statistics
 * - Live game info snippets
 *
 * Controlled by AnimatedPanel in HostView (visible=false until wired up).
 */
export default function FooterPanel({ children }) {
  return (
    <div style={s.root}>
      {children}
    </div>
  );
}

const s = {
  root: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: '8px 12px 10px',
    background: 'linear-gradient(180deg, #101214 0%, #090a0c 100%)',
    overflow: 'hidden',
    color: '#fff',
    fontFamily: "'Segoe UI', sans-serif",
  },
};
