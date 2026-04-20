import { useState, useEffect } from 'react';

const POSITIONS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'DNF'];

function HostControls({ gameState, socket }) {
  const [resultPlacement, setResultPlacement] = useState('1');
  const [maxCashCap, setMaxCashCap] = useState('10');
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    const onError = (msg) => {
      setErrorMsg(typeof msg === 'string' ? msg : JSON.stringify(msg));
      setTimeout(() => setErrorMsg(null), 4000);
    };
    socket.on('error', onError);
    return () => socket.off('error', onError);
  }, [socket]);

  const handleAction = (action, data = {}) => {
    setErrorMsg(null);
    socket.emit('host-action', { action, ...data });
  };

  const { currentStage, players, pot, raceNumber, entryFee, positionDraft, wheelOrder } = gameState;

  const alivePlayers = players.filter((p) => p.balance > 0);
  const pendingPreBet = alivePlayers.filter((p) => !p.paidEntry && !p.skippedRace);
  const payingPlayers = players.filter((p) => p.paidEntry);
  const allReady = pendingPreBet.length === 0 && alivePlayers.length > 0;

  const entryFeeDisplay = entryFee === 'ALL_IN' ? 'ALL IN' : `$${Number(entryFee).toFixed(2)}`;

  // Current picker name during position assignment
  const currentPickerId = positionDraft ? wheelOrder?.[positionDraft.currentPlayerIndex] : null;
  const currentPicker = players.find((p) => p.id === currentPickerId);

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <span style={styles.title}>HOST CONTROLS</span>
        <span style={styles.stageBadge}>{currentStage.replace(/_/g, ' ')}</span>
        <span style={styles.meta}>Race {raceNumber} · Entry: {entryFeeDisplay} · Pot: ${Number(pot).toFixed(2)}</span>
      </div>

      {errorMsg && <div style={styles.errorBanner}>{errorMsg}</div>}
      {successMsg && <div style={styles.successBanner}>{successMsg}</div>}

      {/* ── LOBBY ── */}
      {currentStage === 'LOBBY' && !gameState.hostSettings.lobbyOpen && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Open Lobby</div>
          <div style={styles.row}>
            <label style={styles.label}>Max Cash Cap ($)</label>
            <input
              style={styles.input}
              type="number"
              step="0.25"
              min="0.25"
              value={maxCashCap}
              onChange={(e) => setMaxCashCap(e.target.value)}
            />
          </div>
          <button style={styles.btn} onClick={() => handleAction('open-lobby', { maxCashCap: parseFloat(maxCashCap) })}>
            Open Lobby
          </button>
        </div>
      )}

      {currentStage === 'LOBBY' && gameState.hostSettings.lobbyOpen && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Lobby is Open</div>
          <div style={styles.hint}>
            Cap: ${gameState.hostSettings.maxCashCap?.toFixed(2)} · {players.length} player(s) joined
          </div>
          <button style={styles.btn} onClick={() => handleAction('start-game')}>
            Start Pre-Bet →
          </button>
        </div>
      )}

      {/* ── PRE-BET ── */}
      {currentStage === 'PRE_BET' && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Pre-Bet Phase</div>

          <div style={styles.readyRow}>
            <span style={{ color: allReady ? '#2ecc71' : '#e67e22' }}>
              {allReady
                ? `✓ All ${alivePlayers.length} players ready (${payingPlayers.length} paying)`
                : `Waiting on ${pendingPreBet.length} player(s)…`}
            </span>
          </div>

          {pendingPreBet.length > 0 && (
            <div style={styles.pendingList}>
              {pendingPreBet.map((p) => (
                <span key={p.id} style={styles.pendingPill}>{p.displayName}</span>
              ))}
            </div>
          )}

          <button
            style={{ ...styles.btn, ...(allReady ? {} : styles.btnWarn) }}
            onClick={() => handleAction('start-position-assignment')}
          >
            {allReady ? 'Spin the Wheel →' : 'Force Start Position Assignment'}
          </button>
        </div>
      )}

      {/* ── POSITION ASSIGNMENT ── */}
      {currentStage === 'POSITION_ASSIGNMENT' && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Position Assignment</div>
          {currentPicker ? (
            <div style={styles.hint}>
              Now picking: <strong>{currentPicker.displayName}</strong>
              {positionDraft && (
                <span> ({positionDraft.remainingByPlayer?.[currentPickerId] ?? 0} pick(s) left)</span>
              )}
            </div>
          ) : (
            <div style={{ color: '#2ecc71' }}>All positions assigned!</div>
          )}
          <div style={styles.hint}>
            Cascade spent: {positionDraft?.cascadeChainSpent ? 'Yes' : 'No'}
          </div>
        </div>
      )}

      {/* ── BETTING ── */}
      {currentStage === 'BETTING' && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Betting in Progress</div>
          <div style={styles.hint}>
            Current bet: ${Number(gameState.bettingState?.currentBet ?? 0).toFixed(2)} ·
            Cap: ${Number(gameState.bettingState?.betCap ?? 0).toFixed(2)}
          </div>
          {gameState.bettingState?.actionQueue?.[0] && (
            <div style={styles.hint}>
              Acting: <strong>{players.find((p) => p.id === gameState.bettingState.actionQueue[0])?.displayName ?? '?'}</strong>
            </div>
          )}
        </div>
      )}

      {/* ── RACE PENDING RESULT ── */}
      {currentStage === 'RACE_PENDING_RESULT' && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Record Race Result</div>
          <div style={styles.placementGrid}>
            {POSITIONS.map((pos) => (
              <button
                key={pos}
                style={{
                  ...styles.posBtn,
                  ...(resultPlacement === pos ? styles.posBtnSelected : {})
                }}
                onClick={() => setResultPlacement(pos)}
              >
                {pos}
              </button>
            ))}
          </div>
          <div style={styles.hint}>Selected: <strong>{resultPlacement}</strong></div>
          <button style={styles.btn} onClick={() => handleAction('record-race-result', { placement: resultPlacement })}>
            Confirm Result: {resultPlacement}
          </button>
        </div>
      )}

      {/* ── PAYOUT ── */}
      {currentStage === 'PAYOUT' && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Race Settled</div>
          <div style={styles.hint}>Result: <strong>{gameState.raceResult}</strong></div>
          <button style={styles.btn} onClick={() => handleAction('next-race')}>
            Next Race →
          </button>
        </div>
      )}

      {/* ── GAME OVER ── */}
      {currentStage === 'GAME_OVER' && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Game Over</div>
          <button style={{ ...styles.btn, background: '#7a1a1a', color: '#f88' }}
            onClick={() => setConfirmReset(true)}>
            🔄 Reset &amp; Start New Game
          </button>
        </div>
      )}

      {/* ── PLAYER LIST ── */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Players ({players.length})</div>
        {players.length === 0 && <div style={styles.hint}>No players yet.</div>}
        {players.map((p) => {
          let statusColor = '#666';
          let statusLabel = '';
          if (currentStage === 'PRE_BET') {
            if (p.balance <= 0) { statusColor = '#555'; statusLabel = 'eliminated'; }
            else if (p.paidEntry) { statusColor = '#2ecc71'; statusLabel = 'PAID'; }
            else if (p.skippedRace) { statusColor = '#e67e22'; statusLabel = 'SKIP'; }
            else { statusColor = '#e74c3c'; statusLabel = 'pending'; }
          }
          return (
            <div key={p.id} style={styles.playerRow}>
              <span style={styles.playerName}>{p.displayName}</span>
              <span style={styles.playerReal}>({p.realName})</span>
              <span style={styles.playerBal}>${Number(p.balance).toFixed(2)}</span>
              {statusLabel && <span style={{ ...styles.playerStatus, color: statusColor }}>{statusLabel}</span>}
              {!p.connected && <span style={styles.dcBadge}>DC</span>}
              {!p.skipFoldTokenAvailable && <span style={styles.noToken}>NO TOKEN</span>}
              {p.positions?.length > 0 && (
                <span style={styles.positions}>[{p.positions.join(', ')}]</span>
              )}
            </div>
          );
        })}
      </div>

      {/* ── DANGER ZONE ── */}
      <div style={{ ...styles.section, borderTop: '2px solid #3a1a1a', marginTop: 20 }}>
        <div style={{ ...styles.sectionTitle, color: '#f66' }}>Danger Zone</div>
        {!confirmReset ? (
          <button
            style={{ ...styles.btn, background: '#2a0000', color: '#f66', border: '1px solid #5a1a1a' }}
            onClick={() => setConfirmReset(true)}
          >
            Reset Game from Scratch
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ color: '#f88', fontSize: 13 }}>
              ⚠️ This will wipe ALL players, balances, and history. Are you sure?
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                style={{ ...styles.btn, background: '#7a1a1a', color: '#fff' }}
                onClick={() => { handleAction('reset-game'); setConfirmReset(false); }}
              >
                Yes, Reset Everything
              </button>
              <button
                style={{ ...styles.btn, background: '#333', color: '#aaa' }}
                onClick={() => setConfirmReset(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  root: {
    minHeight: '100vh',
    background: '#0d0d0d',
    color: '#eee',
    fontFamily: "'Segoe UI', sans-serif",
    padding: '0 0 40px 0',
  },
  header: {
    background: '#111',
    borderBottom: '2px solid #333',
    padding: '14px 20px',
    display: 'flex',
    alignItems: 'center',
    gap: 20,
    flexWrap: 'wrap',
  },
  title: { fontSize: 20, fontWeight: 'bold', color: '#f0c040', letterSpacing: 2 },
  stageBadge: {
    background: '#222',
    color: '#aaa',
    fontSize: 12,
    letterSpacing: 2,
    padding: '4px 10px',
    borderRadius: 4,
    textTransform: 'uppercase',
  },
  meta: { fontSize: 13, color: '#888' },
  errorBanner: {
    background: '#5a1a1a',
    color: '#f88',
    padding: '12px 20px',
    fontSize: 14,
    borderBottom: '1px solid #933',
  },
  successBanner: {
    background: '#0d3a1e',
    color: '#4e4',
    padding: '12px 20px',
    fontSize: 14,
    borderBottom: '1px solid #2a7a3a',
  },
  section: {
    borderBottom: '1px solid #1a1a1a',
    padding: '18px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  sectionTitle: { fontSize: 13, fontWeight: 'bold', color: '#f0c040', textTransform: 'uppercase', letterSpacing: 1 },
  hint: { fontSize: 13, color: '#aaa' },
  row: { display: 'flex', alignItems: 'center', gap: 10 },
  label: { fontSize: 13, color: '#aaa', minWidth: 120 },
  input: {
    background: '#222',
    border: '1px solid #444',
    color: '#fff',
    padding: '6px 10px',
    borderRadius: 4,
    fontSize: 14,
    width: 100,
  },
  btn: {
    background: '#1a3a8a',
    color: '#fff',
    border: 'none',
    padding: '10px 20px',
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 'bold',
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },
  btnWarn: {
    background: '#5a3a00',
    color: '#f0c040',
  },
  readyRow: { fontSize: 14 },
  pendingList: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  pendingPill: {
    background: '#3a1a1a',
    color: '#f66',
    padding: '4px 10px',
    borderRadius: 12,
    fontSize: 12,
  },
  placementGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: 6,
    maxWidth: 380,
  },
  posBtn: {
    background: '#1a1a2e',
    border: '1px solid #333',
    color: '#ccc',
    padding: '8px 0',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 'bold',
  },
  posBtnSelected: {
    background: '#1a3a8a',
    border: '1px solid #4a7aff',
    color: '#fff',
  },
  playerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 0',
    borderBottom: '1px solid #1a1a1a',
    fontSize: 13,
  },
  playerName: { fontWeight: 'bold', color: '#eee', minWidth: 100 },
  playerReal: { color: '#666', fontSize: 12 },
  playerBal: { color: '#2ecc71', minWidth: 55 },
  playerStatus: { fontSize: 11, fontWeight: 'bold' },
  dcBadge: { background: '#333', color: '#888', fontSize: 10, padding: '1px 5px', borderRadius: 3 },
  noToken: { background: '#3a1a1a', color: '#f66', fontSize: 10, padding: '1px 5px', borderRadius: 3 },
  positions: { color: '#888', fontSize: 11 },
};

export default HostControls;