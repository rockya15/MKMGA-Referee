import { useState, useEffect, useRef } from 'react';

const ALL_POSITIONS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'DNF'];

function PlayerView({ gameState, socket }) {
  const [mode, setMode] = useState('menu'); // 'menu' | 'joining' | 'reconnecting'
  const [serverError, setServerError] = useState(null);
  const [pendingDnf, setPendingDnf] = useState(false);
  const [raiseInput, setRaiseInput] = useState('');
  const [errorMsg, setErrorMsg] = useState(null);
  const storedCreds = useRef(null);

  // Auto-reconnect when socket gets a new ID after a drop
  useEffect(() => {
    const handleConnect = () => {
      if (storedCreds.current) {
        socket.emit('reconnect-player', storedCreds.current);
      }
    };
    socket.on('connect', handleConnect);
    return () => socket.off('connect', handleConnect);
  }, [socket]);

  useEffect(() => {
    const onError = (msg) => {
      setErrorMsg(typeof msg === 'string' ? msg : JSON.stringify(msg));
      setTimeout(() => setErrorMsg(null), 4000);
    };
    const onJoinError = (msg) => {
      // Clear stored creds so the holding screen doesn't block the menu
      storedCreds.current = null;
      setServerError(typeof msg === 'string' ? msg : JSON.stringify(msg));
    };
    socket.on('error', onError);
    socket.on('join-error', onJoinError);
    return () => {
      socket.off('error', onError);
      socket.off('join-error', onJoinError);
    };
  }, [socket]);

  const currentMe = gameState.players.find((p) => p.id === socket.id);
  const lastMeRef = useRef(null);
  if (currentMe) lastMeRef.current = currentMe;
  // While reconnecting, use the last known player data so the UI doesn't flicker.
  const me = currentMe ?? (storedCreds.current ? lastMeRef.current : null);

  const lobbyOpen = gameState.hostSettings?.lobbyOpen;
  const inLobby = gameState.currentStage === 'LOBBY';
  const canRegister = lobbyOpen && inLobby;

  const pickPosition = (position, cascade = false) => {
    setPendingDnf(false);
    socket.emit('position-select', { position, cascade });
  };

  // ── Derive available positions ───────────────────────────────────────────────
  const { positionDraft, wheelOrder } = gameState;
  const isMyPickTurn =
    gameState.currentStage === 'POSITION_ASSIGNMENT' &&
    me &&
    positionDraft &&
    wheelOrder?.[positionDraft.currentPlayerIndex] === me.id;

  const picksRemaining = isMyPickTurn ? (positionDraft.remainingByPlayer?.[me.id] ?? 0) : 0;

  const availablePositions = (() => {
    if (!positionDraft) return ALL_POSITIONS;
    if (positionDraft.mode === 'NON_EXCLUSIVE') return ALL_POSITIONS;
    return ALL_POSITIONS.filter((pos) => !positionDraft.occupiedPositions?.[pos]);
  })();

  const cascadeSpent = positionDraft?.cascadeChainSpent ?? false;

  // ── Betting helpers ──────────────────────────────────────────────────────────
  const isMyBetTurn =
    gameState.currentStage === 'BETTING' &&
    me &&
    gameState.bettingState?.actionQueue?.[0] === me.id;

  const currentBet = gameState.bettingState?.currentBet ?? 0;
  const canCheck = currentBet === 0 || (me?.roundBet ?? 0) >= currentBet;
  const canRaise = !gameState.bettingState?.raiseLockedPlayers?.[me?.id];

  // ── Not joined yet ───────────────────────────────────────────────────────────
  if (!me) {
    // Has creds but lastMeRef not yet populated (very early reconnect) — hold.
    if (storedCreds.current) {
      return (
        <div style={styles.root}>
          <div style={{ ...styles.joinHeader, padding: '30px 20px 10px' }}>MKMGA</div>
          <div style={{ ...styles.joinWarning, margin: '0 20px' }}>Reconnecting…</div>
        </div>
      );
    }
    if (mode === 'joining') {
      return (
        <JoinForm
          onJoin={(data) => {
            setServerError(null);
            storedCreds.current = { realName: data.realName, password: data.password };
            socket.emit('join', data);
          }}
          onBack={() => { setMode('menu'); setServerError(null); }}
          error={serverError}
        />
      );
    }
    if (mode === 'reconnecting') {
      return (
        <ReconnectForm
          onReconnect={(data) => {
            setServerError(null);
            storedCreds.current = { realName: data.realName, password: data.password };
            socket.emit('reconnect-player', data);
          }}
          onBack={() => { setMode('menu'); setServerError(null); }}
          error={serverError}
        />
      );
    }
    // Menu
    return (
      <div style={styles.root}>
        <div style={{ ...styles.joinHeader, padding: '30px 20px 10px' }}>MKMGA</div>
        {!canRegister && (
          <div style={{ ...styles.joinWarning, margin: '0 20px' }}>
            Registration is closed — the game is already in progress.
          </div>
        )}
        {serverError && <div style={{ ...styles.joinWarning, margin: '0 20px' }}>{serverError}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '20px' }}>
          {canRegister && (
            <button style={styles.joinBtn} onClick={() => { setServerError(null); setMode('joining'); }}>
              Join Game
            </button>
          )}
          <button
            style={{ ...styles.joinBtn, background: '#3a3a1a', color: '#f0c040' }}
            onClick={() => { setServerError(null); setMode('reconnecting'); }}
          >
            Reconnect to Existing Account
          </button>
        </div>
      </div>
    );
  }

  // ── Joined — render game phase ───────────────────────────────────────────────
  const stage = gameState.currentStage;

  return (
    <div style={styles.root}>
      {/* Header */}
      <div style={styles.playerHeader}>
        <span style={styles.playerName}>{me.displayName}</span>
        <span style={styles.playerBalance}>${Number(me.balance).toFixed(2)}</span>
      </div>

      {errorMsg && <div style={styles.errorBanner}>{errorMsg}</div>}

      {/* LOBBY */}
      {stage === 'LOBBY' && (
        <div style={styles.phaseBox}>
          <div style={styles.phaseTitle}>Waiting for game to start…</div>
          {me.positions?.length > 0 && (
            <div style={styles.phaseInfo}>Your positions: {me.positions.join(', ')}</div>
          )}
        </div>
      )}

      {/* PRE_BET */}
      {stage === 'PRE_BET' && (
        <div style={styles.phaseBox}>
          <div style={styles.phaseTitle}>Race {gameState.raceNumber} — Entry Phase</div>
          <div style={styles.phaseInfo}>
            Entry fee:{' '}
            <strong>
              {gameState.entryFee === 'ALL_IN' ? 'ALL IN' : `$${Number(gameState.entryFee).toFixed(2)}`}
            </strong>
          </div>
          {me.balance <= 0 ? (
            <div style={styles.phaseInfo}>You have been eliminated.</div>
          ) : me.paidEntry ? (
            <div style={styles.phaseInfo}>✅ Paid entry — waiting for others…</div>
          ) : me.skippedRace ? (
            <div style={styles.phaseInfo}>⏭ Skipping this race — waiting for others…</div>
          ) : (
            <div style={styles.actionRow}>
              <button style={styles.actionBtn} onClick={() => socket.emit('pre-bet-choice', { choice: 'PAY' })}>
                Pay Entry
              </button>
              {me.skipFoldTokenAvailable && (
                <button
                  style={{ ...styles.actionBtn, background: '#3a3a1a', color: '#f0c040' }}
                  onClick={() => socket.emit('pre-bet-choice', { choice: 'SKIP' })}
                >
                  Skip Race (use token)
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* POSITION_ASSIGNMENT */}
      {stage === 'POSITION_ASSIGNMENT' && (
        <div style={styles.phaseBox}>
          <div style={styles.phaseTitle}>Position Draft</div>
          {!me.paidEntry ? (
            <div style={styles.phaseInfo}>You skipped this race.</div>
          ) : isMyPickTurn ? (
            <>
              <div style={styles.phaseInfo}>Your turn! Pick {picksRemaining} position(s).</div>
              <div style={styles.positionGrid}>
                {availablePositions.map((pos) => (
                  <button
                    key={pos}
                    style={{ ...styles.posBtn, background: pos === 'DNF' ? '#3a1a1a' : '#1a2a1a' }}
                    onClick={() => {
                      if (pos === 'DNF' && !cascadeSpent) {
                        setPendingDnf(true);
                      } else {
                        pickPosition(pos);
                      }
                    }}
                  >
                    {pos}
                  </button>
                ))}
              </div>
              {pendingDnf && (
                <div style={styles.cascadeBox}>
                  <div style={styles.phaseInfo}>You picked DNF. Attempt cascade?</div>
                  <div style={styles.actionRow}>
                    <button style={styles.actionBtn} onClick={() => pickPosition('DNF', true)}>
                      Yes, cascade
                    </button>
                    <button
                      style={{ ...styles.actionBtn, background: '#333' }}
                      onClick={() => pickPosition('DNF', false)}
                    >
                      No, stay DNF
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={styles.phaseInfo}>
              {me.positions?.length > 0
                ? `Your positions: ${me.positions.join(', ')} — waiting for others…`
                : 'Waiting for your turn…'}
            </div>
          )}
        </div>
      )}

      {/* BETTING */}
      {stage === 'BETTING' && (
        <div style={styles.phaseBox}>
          <div style={styles.phaseTitle}>Betting Round</div>
          <div style={styles.phaseInfo}>
            Pot: <strong>${Number(gameState.pot).toFixed(2)}</strong> · Current bet:{' '}
            <strong>${Number(currentBet).toFixed(2)}</strong>
          </div>
          {me.positions?.length > 0 && (
            <div style={styles.phaseInfo}>Your positions: {me.positions.join(', ')}</div>
          )}
          {me.allIn ? (
            <div style={styles.phaseInfo}>You are all-in — waiting for others…</div>
          ) : me.folded ? (
            <div style={styles.phaseInfo}>You folded — waiting for others…</div>
          ) : !me.paidEntry ? (
            <div style={styles.phaseInfo}>You skipped this race.</div>
          ) : isMyBetTurn ? (
            <div style={styles.actionCol}>
              {canCheck ? (
                <button style={styles.actionBtn} onClick={() => socket.emit('betting-action', { action: 'check' })}>
                  Check
                </button>
              ) : (
                <button style={styles.actionBtn} onClick={() => socket.emit('betting-action', { action: 'call' })}>
                  Call ${Number(Math.min(currentBet - (me.roundBet ?? 0), me.balance)).toFixed(2)}
                </button>
              )}
              {me.skipFoldTokenAvailable && (
                <button
                  style={{ ...styles.actionBtn, background: '#3a1a1a' }}
                  onClick={() => socket.emit('betting-action', { action: 'fold' })}
                >
                  Fold (use token)
                </button>
              )}
              {canRaise && (
                <div style={styles.raiseRow}>
                  <input
                    style={styles.raiseInput}
                    type="number"
                    step="0.25"
                    min={currentBet + 0.25}
                    max={me.balance + (me.roundBet ?? 0)}
                    placeholder="Raise to…"
                    value={raiseInput}
                    onChange={(e) => setRaiseInput(e.target.value)}
                  />
                  <button
                    style={styles.actionBtn}
                    onClick={() => {
                      socket.emit('betting-action', { action: 'raise', amount: parseFloat(raiseInput) });
                      setRaiseInput('');
                    }}
                  >
                    Raise
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div style={styles.phaseInfo}>Waiting for your turn…</div>
          )}
        </div>
      )}

      {/* RACE_PENDING_RESULT */}
      {stage === 'RACE_PENDING_RESULT' && (
        <div style={styles.phaseBox}>
          <div style={styles.phaseTitle}>Race in Progress!</div>
          <div style={styles.phaseInfo}>
            Pot: <strong>${Number(gameState.pot).toFixed(2)}</strong>
          </div>
          {me.positions?.length > 0 && (
            <div style={styles.phaseInfo}>Your positions: {me.positions.join(', ')}</div>
          )}
          <div style={styles.phaseInfo}>Waiting for host to enter result…</div>
        </div>
      )}

      {/* PAYOUT */}
      {stage === 'PAYOUT' && (
        <div style={styles.phaseBox}>
          <div style={styles.phaseTitle}>Race Result: {gameState.raceResult}</div>
          <div style={styles.phaseInfo}>
            Your balance: <strong>${Number(me.balance).toFixed(2)}</strong>
          </div>
          {me.positions?.includes(gameState.raceResult) ? (
            <div style={{ ...styles.phaseInfo, color: '#2ecc71' }}>🏆 You won this race!</div>
          ) : me.paidEntry ? (
            <div style={{ ...styles.phaseInfo, color: '#e74c3c' }}>Your positions didn't hit.</div>
          ) : (
            <div style={styles.phaseInfo}>You skipped this race.</div>
          )}
          <div style={styles.phaseInfo}>Waiting for next race…</div>
        </div>
      )}

      {/* GAME_OVER */}
      {stage === 'GAME_OVER' && (
        <div style={styles.phaseBox}>
          <div style={styles.phaseTitle}>Game Over!</div>
          <div style={styles.phaseInfo}>
            Final balance: <strong>${Number(me.balance).toFixed(2)}</strong>
          </div>
          {me.balance > 0 && (
            <div style={{ ...styles.phaseInfo, color: '#2ecc71' }}>🏆 You survived!</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── JoinForm ─────────────────────────────────────────────────────────────────
function JoinForm({ onJoin, onBack, error }) {
  const [formData, setFormData] = useState({
    displayName: '',
    realName: '',
    cashAmount: '',
    funStatement: '',
    password: '',
    confirmPassword: '',
  });
  const [checks, setChecks] = useState({ rules: false, fairy: false, bibi: false, opcc: false, fy: false });
  const [localError, setLocalError] = useState(null);

  const allChecked = checks.rules && checks.fairy && checks.bibi && checks.opcc && checks.fy;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (formData.password.length < 1) {
      setLocalError('Type a fucking password RETARD.');
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setLocalError('Hey DIPSHIT one of your passwords are wrong.');
      return;
    }
    if (!allChecked) {
      const uncheckedCount = [checks.rules, checks.fairy, checks.bibi, checks.opcc, checks.fy].filter(Boolean).length;
      const onlyOneLeft = uncheckedCount === 4;
      if (onlyOneLeft && !checks.rules) {
        setLocalError("You haven't agreed to the official rules. Read them or go home.");
        return;
      }
      if (onlyOneLeft && !checks.fairy) {
        setLocalError('You need to accept the fairy clause. No exceptions.');
        return;
      }
      if (onlyOneLeft && !checks.bibi) {
        setLocalError('Benjamin Netanyahu did nothing wrong. Acknowledge it.');
        return;
      }
      if (onlyOneLeft && !checks.opcc) {
        setLocalError('yeah, sure buddy.');
        return;
      }
      if (onlyOneLeft && !checks.fy) {
        setLocalError("You haven't said fuck you. Say it.");
        return;
      }
      setLocalError('You must check all boxes before joining.');
      return;
    }
    setLocalError(null);
    const { confirmPassword, ...submitData } = formData;
    const rawCash = parseFloat(String(formData.cashAmount).replace(/[^0-9.]/g, ''));
    onJoin({ ...submitData, cashAmount: rawCash });
  };

  const displayError = localError || error;

  return (
    <div style={styles.root}>
      <div style={styles.joinHeaderRow}>
        <div style={styles.joinHeader}>Join MKMGA</div>
        <button type="button" style={styles.backBtn} onClick={onBack}>← Back</button>
      </div>
      <form onSubmit={handleSubmit} style={styles.joinForm}>
        {displayError && (
          <div style={{ ...styles.joinWarning, marginBottom: 10 }}>{displayError}</div>
        )}
        <input
          style={styles.joinInput}
          type="text"
          placeholder="Display Name"
          value={formData.displayName}
          onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
          required
        />
        <input
          style={styles.joinInput}
          type="text"
          placeholder="Real Name"
          value={formData.realName}
          onChange={(e) => setFormData({ ...formData, realName: e.target.value })}
          required
        />
        <input
          style={styles.joinInput}
          type="text"
          inputMode="decimal"
          placeholder="Cash Amount (e.g. $21.00)"
          value={formData.cashAmount}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9.]/g, '');
            setFormData({ ...formData, cashAmount: raw });
          }}
          onBlur={(e) => {
            const num = parseFloat(e.target.value.replace(/[^0-9.]/g, ''));
            if (!isNaN(num)) {
              setFormData((prev) => ({ ...prev, cashAmount: `$${num.toFixed(2)}` }));
            }
          }}
          onFocus={(e) => {
            const raw = e.target.value.replace(/[^0-9.]/g, '');
            setFormData((prev) => ({ ...prev, cashAmount: raw }));
          }}
          required
        />
        <input
          style={styles.joinInput}
          type="text"
          placeholder="Fun Statement (optional)"
          value={formData.funStatement}
          onChange={(e) => setFormData({ ...formData, funStatement: e.target.value })}
        />
        <input
          style={styles.joinInput}
          type="password"
          placeholder="Password"
          value={formData.password}
          onChange={(e) => setFormData({ ...formData, password: e.target.value })}
          required
        />
        <input
          style={styles.joinInput}
          type="password"
          placeholder="Confirm Password"
          value={formData.confirmPassword}
          onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
          required
        />

        <div style={styles.joinWarning}>
          ⚠️ You are responsible for keeping track of your own coins.
        </div>

        <label style={styles.checkLabel}>
          <input type="checkbox" checked={checks.rules} onChange={(e) => setChecks({ ...checks, rules: e.target.checked })} />
          I have read the MKMGA FUN ENFORCEMENT Players Handbook
        </label>
        <label style={styles.checkLabel}>
          <input type="checkbox" checked={checks.fairy} onChange={(e) => setChecks({ ...checks, fairy: e.target.checked })} />
          I accept that I like boys and I am ready to be a fairy
        </label>
        <label style={styles.checkLabel}>
          <input type="checkbox" checked={checks.bibi} onChange={(e) => setChecks({ ...checks, bibi: e.target.checked })} />
          Benjamin Netanyahu did nothing wrong
        </label>
        <label style={styles.checkLabel}>
          <input type="checkbox" checked={checks.opcc} onChange={(e) => setChecks({ ...checks, opcc: e.target.checked })} />
          OPCC release date 2036
        </label>
        <label style={styles.checkLabel}>
          <input type="checkbox" checked={checks.fy} onChange={(e) => setChecks({ ...checks, fy: e.target.checked })} />
          Fuck you
        </label>

        <button
          type="submit"
          style={{
            ...styles.joinBtn,
            opacity: allChecked ? 1 : 0.4,
            cursor: allChecked ? 'pointer' : 'not-allowed',
            marginTop: 16,
          }}
        >
          Join
        </button>
      </form>
    </div>
  );
}

// ── ReconnectForm ─────────────────────────────────────────────────────────────
function ReconnectForm({ onReconnect, onBack, error }) {
  const [formData, setFormData] = useState({ realName: '', password: '' });

  const handleSubmit = (e) => {
    e.preventDefault();
    onReconnect(formData);
  };

  return (
    <div style={styles.root}>
      <div style={styles.joinHeaderRow}>
        <div style={styles.joinHeader}>Reconnect</div>
        <button type="button" style={styles.backBtn} onClick={onBack}>← Back</button>
      </div>
      <form onSubmit={handleSubmit} style={styles.joinForm}>
        {error && <div style={{ ...styles.joinWarning, marginBottom: 10 }}>{error}</div>}
        <input
          style={styles.joinInput}
          type="text"
          placeholder="Real Name"
          value={formData.realName}
          onChange={(e) => setFormData({ ...formData, realName: e.target.value })}
          required
        />
        <input
          style={styles.joinInput}
          type="password"
          placeholder="Password"
          value={formData.password}
          onChange={(e) => setFormData({ ...formData, password: e.target.value })}
          required
        />
        <button type="submit" style={{ ...styles.joinBtn, marginTop: 16 }}>
          Reconnect
        </button>
      </form>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = {
  root: {
    minHeight: '100vh',
    background: '#0d0d0d',
    color: '#fff',
    fontFamily: "'Segoe UI', sans-serif",
    display: 'flex',
    flexDirection: 'column',
  },
  // ── Join / Reconnect screens
  joinHeaderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '24px 20px 10px',
  },
  joinHeader: {
    fontSize: 28,
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
  joinForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: '0 20px 30px',
  },
  joinInput: {
    background: '#1a1a1a',
    border: '1px solid #333',
    borderRadius: 6,
    color: '#fff',
    fontSize: 16,
    padding: '10px 12px',
  },
  joinWarning: {
    background: '#2a1a00',
    border: '1px solid #664400',
    borderRadius: 6,
    color: '#f0a040',
    fontSize: 13,
    padding: '8px 12px',
  },
  checkLabel: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    color: '#ccc',
    fontSize: 13,
    cursor: 'pointer',
  },
  joinBtn: {
    background: '#1a3a1a',
    color: '#2ecc71',
    border: 'none',
    borderRadius: 8,
    fontSize: 18,
    fontWeight: 'bold',
    padding: '14px',
    cursor: 'pointer',
  },
  // ── In-game screens
  playerHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 20px',
    background: '#111',
    borderBottom: '1px solid #333',
  },
  playerName: { fontSize: 18, fontWeight: 'bold', color: '#f0c040' },
  playerBalance: { fontSize: 20, fontWeight: 'bold', color: '#2ecc71' },
  errorBanner: {
    background: '#3a0000',
    color: '#ff6b6b',
    padding: '10px 20px',
    fontSize: 14,
    borderBottom: '1px solid #660000',
  },
  phaseBox: {
    padding: '24px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  phaseTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#f0c040',
  },
  phaseInfo: {
    fontSize: 15,
    color: '#ccc',
    lineHeight: 1.5,
  },
  actionRow: {
    display: 'flex',
    gap: 12,
    flexWrap: 'wrap',
  },
  actionCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  actionBtn: {
    background: '#1a3a1a',
    color: '#2ecc71',
    border: 'none',
    borderRadius: 8,
    fontSize: 16,
    fontWeight: 'bold',
    padding: '12px 20px',
    cursor: 'pointer',
  },
  positionGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  posBtn: {
    color: '#fff',
    border: '1px solid #444',
    borderRadius: 6,
    fontSize: 16,
    fontWeight: 'bold',
    padding: '10px 16px',
    cursor: 'pointer',
    minWidth: 52,
  },
  cascadeBox: {
    background: '#1a1a2a',
    border: '1px solid #335',
    borderRadius: 8,
    padding: '14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  raiseRow: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
  },
  raiseInput: {
    background: '#1a1a1a',
    border: '1px solid #333',
    borderRadius: 6,
    color: '#fff',
    fontSize: 16,
    padding: '10px 12px',
    width: 120,
  },
};

export default PlayerView;
