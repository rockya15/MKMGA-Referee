import { useState, useEffect, useRef, useCallback } from 'react';
import SpinningWheel from '../components/SpinningWheel';

// Which stages show the wheel panel
const WHEEL_STAGES = ['POSITION_ASSIGNMENT'];

function HostView({ gameState, socket }) {
  const { currentStage, players, wheelOrder, positionDraft, pot, raceNumber, entryFee } = gameState;

  // ── Wheel state ──────────────────────────────────────────────────────────────
  // segments = paying players still with picks remaining, in wheelOrder order
  const buildSegments = useCallback(() => {
    if (!wheelOrder || !positionDraft) return [];
    return wheelOrder
      .filter((id) => (positionDraft.remainingByPlayer?.[id] ?? 0) > 0)
      .map((id) => {
        const p = players.find((pl) => pl.id === id);
        return { id, label: p?.displayName ?? id };
      });
  }, [wheelOrder, positionDraft, players]);

  const [segments, setSegments] = useState([]);
  const [targetIndex, setTargetIndex] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [pickerName, setPickerName] = useState(null);

  // Track the previous currentPlayerIndex so we know when it changes
  const prevPickerIndexRef = useRef(null);
  // Keep a ref to latest positionDraft for the spin-complete callback (avoid stale closure)
  const positionDraftRef = useRef(positionDraft);
  useEffect(() => { positionDraftRef.current = positionDraft; }, [positionDraft]);
  const wheelOrderRef = useRef(wheelOrder);
  useEffect(() => { wheelOrderRef.current = wheelOrder; }, [wheelOrder]);
  const playersRef = useRef(players);
  useEffect(() => { playersRef.current = players; }, [players]);

  useEffect(() => {
    if (currentStage !== 'POSITION_ASSIGNMENT' || !positionDraft) {
      prevPickerIndexRef.current = null;
      setSpinning(false);
      setSegments([]);
      setPickerName(null);
      return;
    }

    const newSegments = buildSegments();
    const currentPickerId = wheelOrder?.[positionDraft.currentPlayerIndex] ?? null;
    const newPickerName = players.find((p) => p.id === currentPickerId)?.displayName ?? null;

    // First time entering POSITION_ASSIGNMENT — spin immediately
    if (prevPickerIndexRef.current === null) {
      prevPickerIndexRef.current = positionDraft.currentPlayerIndex;
      setSegments(newSegments);
      const idx = newSegments.findIndex((s) => s.id === currentPickerId);
      setTargetIndex(Math.max(0, idx));
      setPickerName(null); // will be set after spin
      setSpinning(true);
      return;
    }

    // Picker changed — rebuild segments (remove finished player) and spin again
    if (positionDraft.currentPlayerIndex !== prevPickerIndexRef.current) {
      prevPickerIndexRef.current = positionDraft.currentPlayerIndex;
      setSegments(newSegments);
      const idx = newSegments.findIndex((s) => s.id === currentPickerId);
      setTargetIndex(Math.max(0, idx));
      setPickerName(null);
      setSpinning(true);
    }
  }, [currentStage, positionDraft, wheelOrder, players, buildSegments]);

  const handleSpinComplete = useCallback(() => {
    setSpinning(false);
    // Use refs to avoid stale closure
    const draft = positionDraftRef.current;
    const order = wheelOrderRef.current;
    const allPlayers = playersRef.current;
    const currentPickerId = order?.[draft?.currentPlayerIndex] ?? null;
    const name = allPlayers.find((p) => p.id === currentPickerId)?.displayName ?? null;
    setPickerName(name);
  }, []);

  // ── Leaderboard ──────────────────────────────────────────────────────────────
  const sortedPlayers = [...players].sort((a, b) => b.balance - a.balance);

  const entryFeeDisplay = entryFee === 'ALL_IN' ? 'ALL IN' : `$${Number(entryFee).toFixed(2)}`;

  return (
    <div style={styles.root}>
      {/* Header bar */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>MKMGA — Race {raceNumber}</span>
        <span style={styles.headerStage}>{currentStage.replace(/_/g, ' ')}</span>
        <span style={styles.headerPot}>POT: ${Number(pot).toFixed(2)}</span>
        <span style={styles.headerFee}>ENTRY: {entryFeeDisplay}</span>
      </div>

      <div style={styles.body}>
        {/* Wheel panel */}
        {WHEEL_STAGES.includes(currentStage) && (
          <div style={styles.wheelPanel}>
            <div style={styles.wheelTitle}>THE WHEEL</div>

            {segments.length > 0 ? (
              <>
                <SpinningWheel
                  segments={segments}
                  targetIndex={targetIndex}
                  spinning={spinning}
                  onSpinComplete={handleSpinComplete}
                  size={420}
                />
                {spinning && (
                  <div style={styles.spinningLabel}>Spinning…</div>
                )}
                {!spinning && pickerName && (
                  <div style={styles.pickerLabel}>
                    <span style={styles.pickerArrow}>▶</span> {pickerName} — pick your position!
                  </div>
                )}
              </>
            ) : (
              <div style={styles.wheelDone}>All positions assigned!</div>
            )}

            {/* Positions taken so far */}
            {positionDraft && (
              <div style={styles.positionGrid}>
                {Array.from({ length: 13 }, (_, i) => {
                  const slot = i < 12 ? String(i + 1) : 'DNF';
                  const ownerId = positionDraft.occupiedPositions?.[slot];
                  const ownerName = ownerId ? players.find((p) => p.id === ownerId)?.displayName : null;
                  return (
                    <div key={slot} style={{ ...styles.positionCell, background: ownerId ? '#1e3a2f' : '#1a1a1a' }}>
                      <div style={styles.positionSlot}>{slot}</div>
                      <div style={styles.positionOwner}>{ownerName ?? '—'}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Leaderboard */}
        <div style={styles.leaderboard}>
          <div style={styles.lbTitle}>PLAYERS</div>
          {sortedPlayers.map((p, i) => (
            <div key={p.id} style={{
              ...styles.lbRow,
              opacity: p.balance <= 0 ? 0.4 : 1,
              background: p.balance <= 0 ? '#1a0000' : i % 2 === 0 ? '#151515' : '#1c1c1c'
            }}>
              <span style={styles.lbRank}>#{i + 1}</span>
              <span style={styles.lbName}>{p.displayName}</span>
              <span style={styles.lbBalance}>${Number(p.balance).toFixed(2)}</span>
              {p.positions?.length > 0 && (
                <span style={styles.lbPositions}>[{p.positions.join(', ')}]</span>
              )}
              {!p.skipFoldTokenAvailable && <span style={styles.lbNoToken}>NO TOKEN</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const styles = {
  root: {
    width: '100vw',
    height: '100vh',
    background: '#0d0d0d',
    color: '#fff',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: "'Segoe UI', sans-serif",
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 32,
    padding: '12px 24px',
    background: '#111',
    borderBottom: '2px solid #333',
    flexShrink: 0,
  },
  headerTitle: { fontSize: 22, fontWeight: 'bold', color: '#f0c040', letterSpacing: 1 },
  headerStage: { fontSize: 14, color: '#aaa', textTransform: 'uppercase', letterSpacing: 2 },
  headerPot: { fontSize: 18, fontWeight: 'bold', color: '#2ecc71' },
  headerFee: { fontSize: 16, color: '#e67e22' },
  body: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  wheelPanel: {
    flex: '0 0 520px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '20px 16px',
    borderRight: '1px solid #222',
    overflowY: 'auto',
    gap: 16,
  },
  wheelTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    letterSpacing: 3,
    color: '#f0c040',
    textTransform: 'uppercase',
  },
  spinningLabel: {
    fontSize: 20,
    color: '#aaa',
    fontStyle: 'italic',
    animation: 'pulse 0.8s ease-in-out infinite alternate',
  },
  pickerLabel: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#2ecc71',
    textAlign: 'center',
    padding: '8px 16px',
    background: '#0d2b1e',
    borderRadius: 8,
    border: '1px solid #2ecc71',
  },
  pickerArrow: { color: '#f0c040' },
  wheelDone: {
    fontSize: 20,
    color: '#2ecc71',
    fontWeight: 'bold',
    marginTop: 40,
  },
  positionGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: 6,
    width: '100%',
    marginTop: 8,
  },
  positionCell: {
    borderRadius: 6,
    padding: '6px 4px',
    textAlign: 'center',
    border: '1px solid #333',
  },
  positionSlot: { fontSize: 13, fontWeight: 'bold', color: '#f0c040' },
  positionOwner: { fontSize: 11, color: '#ccc', marginTop: 2, wordBreak: 'break-word' },
  leaderboard: {
    flex: 1,
    padding: '20px 24px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  lbTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 2,
    color: '#f0c040',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  lbRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 14px',
    borderRadius: 6,
    fontSize: 15,
  },
  lbRank: { color: '#666', width: 28, flexShrink: 0 },
  lbName: { flex: 1, fontWeight: 'bold' },
  lbBalance: { color: '#2ecc71', fontWeight: 'bold', minWidth: 60, textAlign: 'right' },
  lbPositions: { color: '#888', fontSize: 12, marginLeft: 8 },
  lbNoToken: {
    fontSize: 10,
    background: '#5a1a1a',
    color: '#f66',
    padding: '2px 6px',
    borderRadius: 4,
    marginLeft: 4,
  },
};

export default HostView;
