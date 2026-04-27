import { useState, useEffect } from 'react';

const POSITIONS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'DNF'];

// ── PlayerCard ──────────────────────────────────────────────────────────────
function PlayerCard({ p, gameState, socket, onError, onSuccess }) {
  const [expanded, setExpanded] = useState(false);
  const [balanceInput, setBalanceInput] = useState('');
  const [selectedPositions, setSelectedPositions] = useState(p.positions ?? []);
  const [confirmKick, setConfirmKick] = useState(false);

  // Keep local position mirror in sync if game state changes while not editing
  useEffect(() => { setSelectedPositions(p.positions ?? []); }, [p.positions]);

  const adminAction = (action, extra = {}) => {
    socket.emit('host-admin', { action, playerId: p.id, ...extra });
  };

  const handleSetBalance = () => {
    const val = parseFloat(balanceInput);
    if (!Number.isFinite(val) || val < 0) { onError('Enter a valid balance (≥ 0).'); return; }
    adminAction('set-balance', { balance: val });
    onSuccess(`Balance set to $${val.toFixed(2)} for ${p.displayName}`);
    setBalanceInput('');
  };

  const handleSetPositions = () => {
    adminAction('set-positions', { positions: selectedPositions });
    onSuccess(`Positions updated for ${p.displayName}`);
  };

  const togglePos = (pos) => {
    setSelectedPositions((prev) =>
      prev.includes(pos) ? prev.filter((x) => x !== pos) : [...prev, pos]
    );
  };

  const { currentStage } = gameState;
  let statusColor = '#555';
  let statusLabel = '';
  if (currentStage === 'PRE_BET') {
    if (p.balance <= 0) { statusColor = '#555'; statusLabel = 'elim'; }
    else if (p.paidEntry) { statusColor = '#2ecc71'; statusLabel = 'PAID'; }
    else if (p.skippedRace) { statusColor = '#e67e22'; statusLabel = 'SKIP'; }
    else { statusColor = '#e74c3c'; statusLabel = 'wait'; }
  }

  return (
    <div style={{ ...styles.playerCard, ...(expanded ? styles.playerCardExpanded : {}) }}>
      {/* Header row */}
      <div style={styles.playerCardHeader}>
        <div style={styles.playerCardLeft}>
          <span style={styles.playerName}>{p.displayName}</span>
          {p.isBot && <span style={styles.botBadge}>BOT</span>}
          <span style={styles.playerReal}>({p.realName})</span>
          <span style={styles.playerBal}>${Number(p.balance).toFixed(2)}</span>
          {statusLabel && <span style={{ ...styles.playerStatus, color: statusColor }}>{statusLabel}</span>}
          {!p.connected && <span style={styles.dcBadge}>DC</span>}
          {!p.skipFoldTokenAvailable && <span style={styles.noToken}>NO TOKEN</span>}
          {p.positions?.length > 0 && (
            <span style={styles.positions}>[{p.positions.join(', ')}]</span>
          )}
        </div>
        <button
          style={styles.expandBtn}
          onClick={() => { setExpanded((v) => !v); setConfirmKick(false); }}
          title="Player controls"
        >
          {expanded ? '✕' : '···'}
        </button>
      </div>

      {/* Expanded controls */}
      {expanded && (
        <div style={styles.playerControls}>
          {/* Balance */}
          <div style={styles.controlGroup}>
            <div style={styles.controlLabel}>Set Balance ($)</div>
            <div style={styles.controlRow}>
              <input
                style={styles.smallInput}
                type="number"
                step="0.25"
                min="0"
                placeholder={Number(p.balance).toFixed(2)}
                value={balanceInput}
                onChange={(e) => setBalanceInput(e.target.value)}
              />
              <button style={styles.smallBtn} onClick={handleSetBalance}>Apply</button>
            </div>
          </div>

          {/* Positions */}
          <div style={styles.controlGroup}>
            <div style={styles.controlLabel}>Set Positions</div>
            <div style={styles.posGrid}>
              {POSITIONS.map((pos) => (
                <button
                  key={pos}
                  style={{
                    ...styles.posToggle,
                    ...(selectedPositions.includes(pos) ? styles.posToggleOn : {}),
                    ...(pos === 'DNF' ? styles.posToggleDnf : {}),
                    ...(selectedPositions.includes(pos) && pos === 'DNF' ? styles.posToggleDnfOn : {}),
                  }}
                  onClick={() => togglePos(pos)}
                >
                  {pos}
                </button>
              ))}
            </div>
            <button style={{ ...styles.smallBtn, marginTop: 4 }} onClick={handleSetPositions}>
              Save Positions
            </button>
          </div>

          {/* Kick */}
          <div style={styles.controlGroup}>
            <div style={styles.controlLabel}>Remove Player</div>
            {!confirmKick ? (
              <button
                style={{ ...styles.smallBtn, background: '#5a1a1a', color: '#f88' }}
                onClick={() => setConfirmKick(true)}
              >
                Kick {p.displayName}
              </button>
            ) : (
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  style={{ ...styles.smallBtn, background: '#8a0000', color: '#fff' }}
                  onClick={() => { adminAction('kick'); setExpanded(false); setConfirmKick(false); }}
                >
                  Confirm Kick
                </button>
                <button
                  style={{ ...styles.smallBtn, background: '#333', color: '#aaa' }}
                  onClick={() => setConfirmKick(false)}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function HostControls({ gameState, socket }) {
  const [resultPlacement, setResultPlacement] = useState('1');
  const [maxCashCap, setMaxCashCap] = useState('10');
  const [botAddCount, setBotAddCount] = useState('4');
  const [botStartingCash, setBotStartingCash] = useState('5');
  const [botAutoPick, setBotAutoPick] = useState(true);
  const [botDelayMs, setBotDelayMs] = useState('1000');
  const [botPreBetMode, setBotPreBetMode] = useState('AUTO');
  const [botPositionMode, setBotPositionMode] = useState('AUTO');
  const [botBettingMode, setBotBettingMode] = useState('AUTO');
  const [botCascadeMode, setBotCascadeMode] = useState('AUTO');
  const [botVoteMode, setBotVoteMode] = useState('AUTO');
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
  const botPlayers = players.filter((p) => p.isBot);
  const pendingPreBet = alivePlayers.filter((p) => !p.paidEntry && !p.skippedRace);
  const payingPlayers = players.filter((p) => p.paidEntry);
  const allReady = pendingPreBet.length === 0 && alivePlayers.length > 0;

  const entryFeeDisplay = entryFee === 'ALL_IN' ? 'ALL IN' : `$${Number(entryFee).toFixed(2)}`;

  // Current picker name during position assignment
  const currentPickerId = positionDraft ? wheelOrder?.[positionDraft.currentPlayerIndex] : null;
  const currentPicker = players.find((p) => p.id === currentPickerId);

  useEffect(() => {
    const cfg = gameState.debugTools;
    if (!cfg) return;
    setBotAutoPick(Boolean(cfg.autoPick));
    setBotDelayMs(String(cfg.decisionDelayMs ?? 1000));
    setBotPreBetMode(cfg.preBetMode ?? 'AUTO');
    setBotPositionMode(cfg.positionMode ?? 'AUTO');
    setBotBettingMode(cfg.bettingMode ?? 'AUTO');
    setBotCascadeMode(cfg.cascadeMode ?? 'AUTO');
    setBotVoteMode(cfg.voteMode ?? 'AUTO');
  }, [gameState.debugTools]);

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

      {/* ── PLAYER GRID ── */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Players ({players.length})</div>
        {players.length === 0 && <div style={styles.hint}>No players yet.</div>}
        <div style={styles.playerGrid}>
          {players.map((p) => (
            <PlayerCard
              key={p.id}
              p={p}
              gameState={gameState}
              socket={socket}
              onError={(msg) => setErrorMsg(msg)}
              onSuccess={(msg) => { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(null), 3000); }}
            />
          ))}
        </div>
      </div>

      {/* ── DEBUG BOTS ── */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Debug Bots</div>
        <div style={styles.hint}>Bots in game: <strong>{botPlayers.length}</strong> {gameState.debugTools?.autoPick ? '· auto-pick ON' : '· auto-pick OFF'}</div>

        <div style={styles.rowWrap}>
          <div style={styles.row}>
            <label style={styles.label}>Add Bots</label>
            <input style={styles.input} type="number" min="1" max="24" value={botAddCount} onChange={(e) => setBotAddCount(e.target.value)} />
            <label style={styles.labelTight}>Cash</label>
            <input style={styles.input} type="number" min="0.25" step="0.25" value={botStartingCash} onChange={(e) => setBotStartingCash(e.target.value)} />
            <button
              style={styles.smallBtn}
              onClick={() => handleAction('debug-add-bots', { count: Number(botAddCount), startingCash: Number(botStartingCash) })}
            >
              Add
            </button>
            <button style={{ ...styles.smallBtn, background: '#5a1a1a', color: '#f88' }} onClick={() => handleAction('debug-clear-bots')}>
              Clear Bots
            </button>
          </div>
        </div>

        <label style={styles.checkLabelInline}>
          <input type="checkbox" checked={botAutoPick} onChange={(e) => setBotAutoPick(e.target.checked)} />
          Auto-pick when bot choices arise
        </label>

        <div style={styles.row}>
          <label style={styles.label}>Decision Delay (ms)</label>
          <input style={styles.inputWide} type="number" min="0" step="100" value={botDelayMs} onChange={(e) => setBotDelayMs(e.target.value)} />
        </div>

        <div style={styles.selectGrid}>
          <label style={styles.selectLabel}>Pre-Bet
            <select style={styles.select} value={botPreBetMode} onChange={(e) => setBotPreBetMode(e.target.value)}>
              <option value="AUTO">AUTO</option>
              <option value="PAY">PAY</option>
              <option value="SKIP">SKIP</option>
              <option value="RANDOM">RANDOM</option>
            </select>
          </label>
          <label style={styles.selectLabel}>Position
            <select style={styles.select} value={botPositionMode} onChange={(e) => setBotPositionMode(e.target.value)}>
              <option value="AUTO">AUTO</option>
              <option value="RANDOM">RANDOM</option>
              <option value="SAFE_FIRST">SAFE_FIRST</option>
              <option value="PREFER_DNF">PREFER_DNF</option>
            </select>
          </label>
          <label style={styles.selectLabel}>Betting
            <select style={styles.select} value={botBettingMode} onChange={(e) => setBotBettingMode(e.target.value)}>
              <option value="AUTO">AUTO</option>
              <option value="CHECK_CALL">CHECK_CALL</option>
              <option value="FOLD_IF_POSSIBLE">FOLD_IF_POSSIBLE</option>
              <option value="RANDOM">RANDOM</option>
            </select>
          </label>
          <label style={styles.selectLabel}>Cascade
            <select style={styles.select} value={botCascadeMode} onChange={(e) => setBotCascadeMode(e.target.value)}>
              <option value="AUTO">AUTO</option>
              <option value="CASCADE">CASCADE</option>
              <option value="ACCEPT_DNF">ACCEPT_DNF</option>
              <option value="RANDOM">RANDOM</option>
            </select>
          </label>
          <label style={styles.selectLabel}>Votes
            <select style={styles.select} value={botVoteMode} onChange={(e) => setBotVoteMode(e.target.value)}>
              <option value="AUTO">AUTO</option>
              <option value="RANDOM">RANDOM</option>
              <option value="FIRST">FIRST</option>
            </select>
          </label>
        </div>

        <div style={styles.row}>
          <button
            style={styles.btn}
            onClick={() => handleAction('debug-bot-config', {
              settings: {
                autoPick: botAutoPick,
                decisionDelayMs: Number(botDelayMs),
                preBetMode: botPreBetMode,
                positionMode: botPositionMode,
                bettingMode: botBettingMode,
                cascadeMode: botCascadeMode,
                voteMode: botVoteMode,
              }
            })}
          >
            Apply Bot Settings
          </button>
          <button style={{ ...styles.smallBtn, background: '#333', color: '#ddd' }} onClick={() => handleAction('debug-run-bot-step')}>
            Run One Bot Step
          </button>
        </div>
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
  rowWrap: { display: 'flex', flexWrap: 'wrap', gap: 10 },
  label: { fontSize: 13, color: '#aaa', minWidth: 120 },
  labelTight: { fontSize: 12, color: '#888' },
  input: {
    background: '#222',
    border: '1px solid #444',
    color: '#fff',
    padding: '6px 10px',
    borderRadius: 4,
    fontSize: 14,
    width: 100,
  },
  inputWide: {
    background: '#222',
    border: '1px solid #444',
    color: '#fff',
    padding: '6px 10px',
    borderRadius: 4,
    fontSize: 14,
    width: 140,
  },
  checkLabelInline: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    color: '#ccc',
    marginTop: 2,
  },
  selectGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 8,
  },
  selectLabel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    fontSize: 12,
    color: '#9fb3c8',
  },
  select: {
    background: '#1a1a1a',
    border: '1px solid #3a3a3a',
    color: '#e6edf5',
    padding: '6px 8px',
    borderRadius: 4,
    fontSize: 12,
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
  playerGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: 10,
  },
  playerCard: {
    background: '#141414',
    border: '1px solid #2a2a2a',
    borderRadius: 8,
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
  },
  playerCardExpanded: {
    border: '1px solid #3a5a8a',
    background: '#0e1520',
  },
  playerCardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  playerCardLeft: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 5,
    flex: 1,
    minWidth: 0,
  },
  expandBtn: {
    background: 'none',
    border: '1px solid #333',
    color: '#aaa',
    borderRadius: 4,
    padding: '2px 8px',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 'bold',
    flexShrink: 0,
    lineHeight: 1.4,
  },
  playerControls: {
    marginTop: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    borderTop: '1px solid #2a2a2a',
    paddingTop: 10,
  },
  controlGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
  },
  controlLabel: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#f0c040',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  controlRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  smallInput: {
    background: '#1e1e1e',
    border: '1px solid #444',
    color: '#fff',
    padding: '5px 8px',
    borderRadius: 4,
    fontSize: 13,
    width: 80,
  },
  smallBtn: {
    background: '#1a3a8a',
    color: '#fff',
    border: 'none',
    padding: '5px 12px',
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  posGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: 3,
  },
  posToggle: {
    background: '#1a1a1a',
    border: '1px solid #333',
    color: '#888',
    borderRadius: 3,
    padding: '4px 0',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  posToggleOn: {
    background: '#1a4a8a',
    border: '1px solid #4a9aff',
    color: '#fff',
  },
  posToggleDnf: {
    background: '#1a1a1a',
    border: '1px solid #3a1a1a',
    color: '#c44',
  },
  posToggleDnfOn: {
    background: '#4a0a0a',
    border: '1px solid #e74c3c',
    color: '#ff8888',
  },
  playerName: { fontWeight: 'bold', color: '#eee', fontSize: 13 },
  botBadge: { background: '#173f2a', color: '#69d394', fontSize: 10, padding: '1px 5px', borderRadius: 3, fontWeight: 'bold' },
  playerReal: { color: '#555', fontSize: 11 },
  playerBal: { color: '#2ecc71', fontSize: 12 },
  playerStatus: { fontSize: 10, fontWeight: 'bold' },
  dcBadge: { background: '#333', color: '#888', fontSize: 10, padding: '1px 5px', borderRadius: 3 },
  noToken: { background: '#3a1a1a', color: '#f66', fontSize: 10, padding: '1px 5px', borderRadius: 3 },
  positions: { color: '#888', fontSize: 11 },
};

export default HostControls;