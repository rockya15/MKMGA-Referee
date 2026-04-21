import { useState, useEffect, useRef } from 'react';

const ALL_POSITIONS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'DNF'];
const GENTLE_DNF_SLOTS = [1, 2, 4, 8, 13];
const HARSH_DNF_SLOTS = [4, 8, 13];

function PlayerView({ gameState, socket }) {
  const [mode, setMode] = useState('menu'); // 'menu' | 'joining' | 'reconnecting'
  const [serverError, setServerError] = useState(null);
  const [pendingDnf, setPendingDnf] = useState(false);
  const [raiseInput, setRaiseInput] = useState('');
  const [errorMsg, setErrorMsg] = useState(null);
  const storedCreds = useRef(null);

  // ── Group-vote & timer state ─────────────────────────────────────────────────
  const [groupVote, setGroupVote] = useState(null); // { timedOutPlayer, voters, options }
  const [voteTimeLeft, setVoteTimeLeft] = useState(0);
  const [voteCounts, setVoteCounts] = useState({});
  const [myVote, setMyVote] = useState(null);
  const [activeTimer, setActiveTimer] = useState(null); // { playerId, timeLeft, mode }

  // ── Position-vote state ──────────────────────────────────────────────────────
  const [positionVote, setPositionVote] = useState(null);
  const [positionVoteTimeLeft, setPositionVoteTimeLeft] = useState(0);
  const [positionVoteCounts, setPositionVoteCounts] = useState({});
  const [myPositionVote, setMyPositionVote] = useState(null);

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

  useEffect(() => {
    const onVoteStart = (data) => {
      setGroupVote(data);
      setVoteTimeLeft(data.endsInSeconds);
      setVoteCounts({});
      setMyVote(null);
    };
    const onVoteResult = () => {
      setGroupVote(null);
      setVoteTimeLeft(0);
      setVoteCounts({});
      setMyVote(null);
    };
    const onVoteTimerUpdate = ({ timeLeft }) => setVoteTimeLeft(timeLeft);
    const onVoteUpdate = ({ voteCounts: vc }) => setVoteCounts(vc);
  const onTimerUpdate = (data) => {
      console.log('[Timer] timer-update received:', data);
      setActiveTimer(data);
    };
    const onTimerClear = () => {
      console.log('[Timer] timer-clear received');
      setActiveTimer(null);
    };
    socket.on('group-vote-start', onVoteStart);
    socket.on('group-vote-result', onVoteResult);
    socket.on('vote-timer-update', onVoteTimerUpdate);
    socket.on('vote-update', onVoteUpdate);
    socket.on('timer-update', onTimerUpdate);
    socket.on('timer-clear', onTimerClear);
    return () => {
      socket.off('group-vote-start', onVoteStart);
      socket.off('group-vote-result', onVoteResult);
      socket.off('vote-timer-update', onVoteTimerUpdate);
      socket.off('vote-update', onVoteUpdate);
      socket.off('timer-update', onTimerUpdate);
      socket.off('timer-clear', onTimerClear);
    };
  }, [socket]);

  useEffect(() => {
    const onPosVoteStart = (data) => {
      setPositionVote(data);
      setPositionVoteTimeLeft(data.endsInSeconds);
      setPositionVoteCounts({});
      setMyPositionVote(null);
    };
    const onPosVoteResult = () => {
      setPositionVote(null);
      setPositionVoteTimeLeft(0);
      setPositionVoteCounts({});
      setMyPositionVote(null);
    };
    const onPosVoteTimerUpdate = ({ timeLeft }) => setPositionVoteTimeLeft(timeLeft);
    const onPosVoteUpdate = ({ voteCounts: vc }) => setPositionVoteCounts(vc);
    socket.on('position-vote-start', onPosVoteStart);
    socket.on('position-vote-result', onPosVoteResult);
    socket.on('position-vote-timer-update', onPosVoteTimerUpdate);
    socket.on('position-vote-update', onPosVoteUpdate);
    return () => {
      socket.off('position-vote-start', onPosVoteStart);
      socket.off('position-vote-result', onPosVoteResult);
      socket.off('position-vote-timer-update', onPosVoteTimerUpdate);
      socket.off('position-vote-update', onPosVoteUpdate);
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
  const cascadeChain = positionDraft?.cascadeChain ?? null;
  const iAmDisplacedInChain = !!(cascadeChain && cascadeChain.pendingDisplacedId === me?.id);
  // Cascade is available for DNF picks when: EXCLUSIVE mode, chain not spent, no chain pending
  const cascadeAvailable =
    positionDraft?.mode === 'EXCLUSIVE' && !cascadeSpent && !cascadeChain;

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
          maxCashCap={gameState.hostSettings?.maxCashCap}
        />
      );
    }
    if (mode === 'reconnecting') {
      return (
        <ReconnectForm
          players={gameState.players}
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

  // Timer badge: only show when the server says it's MY timer
  const myTimer = activeTimer?.playerId === me.id ? activeTimer : null;
  const timerUrgent = myTimer !== null && myTimer.timeLeft <= 10;

  return (
    <div style={styles.root}>
      {/* Header */}
      <div style={styles.playerHeader}>
        <span style={styles.playerName}>{me.displayName}</span>
        <span style={styles.playerBalance}>${Number(me.balance).toFixed(2)}</span>
      </div>

      {/* Full-width countdown strip — visible whenever any timer is active */}
      {activeTimer && (
        <div style={styles.timerStrip}>
          <div
            style={{
              ...styles.timerStripFill,
              width: `${Math.max(0, (activeTimer.timeLeft / (activeTimer.mode === 'position' ? 30 : 60)) * 100)}%`,
              background: activeTimer.timeLeft <= 10 ? '#e74c3c' : activeTimer.timeLeft <= 20 ? '#e67e22' : '#2ecc71',
            }}
          />
          <span style={styles.timerStripLabel}>
            {activeTimer.playerId === me.id
              ? `⏱ YOUR TURN — ${activeTimer.timeLeft}s remaining`
              : `⏳ ${gameState.players.find((p) => p.id === activeTimer.playerId)?.displayName ?? 'Someone'} is deciding… ${activeTimer.timeLeft}s`}
          </span>
        </div>
      )}

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

          {/* Cascade displacement prompt — shown when I was displaced by a cascade chain */}
          {iAmDisplacedInChain && (() => {
            const table = cascadeChain.nextMode === 'gentle' ? GENTLE_DNF_SLOTS : HARSH_DNF_SLOTS;
            const safeLevel = Math.min(cascadeChain.nextLevel, table.length - 1);
            const dnfSlots = table[safeLevel];
            const dnfPct = Math.round((dnfSlots / 13) * 100);
            const label = cascadeChain.nextMode === 'gentle'
              ? `Gentle Level ${safeLevel + 1}`
              : `Harsh Spin ${safeLevel + 1}`;
            return (
              <div style={{ ...styles.cascadeBox, borderColor: '#a03030', background: '#1a0808' }}>
                <div style={{ color: '#e74c3c', fontWeight: 'bold', fontSize: 18, marginBottom: 2 }}>
                  ⚠️ You were displaced to DNF!
                </div>
                <div style={styles.phaseInfo}>
                  {label} — {dnfSlots}/13 DNF slots ({dnfPct}% chance of DNF)
                </div>
                <div style={styles.actionRow}>
                  <button
                    style={{ ...styles.actionBtn, background: '#1a3a1a', color: '#2ecc71' }}
                    onClick={() => socket.emit('cascade-response', { cascade: true })}
                  >
                    🎡 Cascade
                  </button>
                  <button
                    style={{ ...styles.actionBtn, background: '#3a1a1a', color: '#e74c3c' }}
                    onClick={() => socket.emit('cascade-response', { cascade: false })}
                  >
                    ✋ Accept DNF
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Position vote overlay / normal pick UI — hidden while I'm the pending displaced player */}
          {!iAmDisplacedInChain && (positionVote ? (
            positionVote.timedOutPlayer === me.id ? (
              /* I’m the timed-out player */
              <div style={styles.voteWaitBox}>
                <div style={styles.voteWaitIcon}>⏳</div>
                <div style={styles.voteWaitTitle}>Your peers are voting for your position{positionVote.picksNeeded > 1 ? 's' : ''}!</div>
                <div style={styles.voteWaitSub}>You took too long — other players are choosing {positionVote.picksNeeded} position{positionVote.picksNeeded > 1 ? 's' : ''} for you.</div>
                <div style={styles.voteCountdown}>{positionVoteTimeLeft}s remaining</div>
                {Object.keys(positionVoteCounts).length > 0 && (
                  <div style={styles.voteTally}>
                    {positionVote.options.map((pos) => (positionVoteCounts[pos] ?? 0) > 0 ? (
                      <div key={pos} style={styles.voteTallyRow}>
                        <span style={styles.voteTallyLabel}>P{pos}</span>
                        <span style={styles.voteTallyCount}>{positionVoteCounts[pos]}</span>
                      </div>
                    ) : null)}
                  </div>
                )}
              </div>
            ) : positionVote.voters.includes(me.id) ? (
              myPositionVote ? (
                /* Already voted */
                <div style={styles.voteWaitBox}>
                  <div style={styles.voteWaitTitle}>Voted: <strong>Position {myPositionVote}</strong></div>
                  <div style={styles.voteCountdown}>{positionVoteTimeLeft}s remaining</div>
                  {Object.keys(positionVoteCounts).length > 0 && (
                    <div style={styles.voteTally}>
                      {positionVote.options.map((pos) => (positionVoteCounts[pos] ?? 0) > 0 ? (
                        <div key={pos} style={styles.voteTallyRow}>
                          <span style={styles.voteTallyLabel}>P{pos}</span>
                          <span style={styles.voteTallyCount}>{positionVoteCounts[pos]}</span>
                        </div>
                      ) : null)}
                    </div>
                  )}
                </div>
              ) : (
                /* Cast your vote */
                <div style={styles.voteBox}>
                  <div style={styles.voteTitle}>
                    🗽 Vote for{' '}
                    <strong>
                      {gameState.players.find((p) => p.id === positionVote.timedOutPlayer)?.displayName ?? 'them'}
                    </strong>
                  </div>
                  <div style={styles.voteSub}>
                    They timed out — pick a position for them! ({positionVote.picksNeeded} pick{positionVote.picksNeeded > 1 ? 's' : ''} needed, {positionVoteTimeLeft}s)
                  </div>
                  <div style={styles.positionGrid}>
                    {positionVote.options.map((pos) => (
                      <button
                        key={pos}
                        style={{ ...styles.posBtn, background: pos === 'DNF' ? '#3a1a1a' : '#1a2a3a', color: pos === 'DNF' ? '#e74c3c' : '#4fc3f7' }}
                        onClick={() => {
                          socket.emit('position-vote', { position: pos });
                          setMyPositionVote(pos);
                        }}
                      >
                        {pos}
                      </button>
                    ))}
                  </div>
                </div>
              )
            ) : (
              /* Not a voter (skipped race, etc.) */
              <div style={styles.phaseInfo}>🗽 Position vote in progress… ({positionVoteTimeLeft}s)</div>
            )
          ) : (
            /* Normal pick UI */
            !me.paidEntry ? (
              <div style={styles.phaseInfo}>You skipped this race.</div>
            ) : isMyPickTurn && myTimer ? (
            <>
              <div style={styles.phaseInfo}>Your turn! Pick {picksRemaining} position(s).</div>
              <div style={styles.positionGrid}>
                {availablePositions.map((pos) => {
                  const isDnf = pos === 'DNF';
                  const showGlow = isDnf && cascadeAvailable;
                  return (
                    <button
                      key={pos}
                      className={showGlow ? 'cascade-dnf-available' : undefined}
                      style={{
                        ...styles.posBtn,
                        background: isDnf ? (showGlow ? '#2a1500' : '#3a1a1a') : '#1a2a1a',
                        color: isDnf ? '#e74c3c' : '#fff',
                        border: showGlow ? '1px solid #ff6400' : '1px solid #444',
                      }}
                      onClick={() => {
                        if (isDnf && !cascadeSpent) {
                          setPendingDnf(true);
                        } else {
                          pickPosition(pos);
                        }
                      }}
                    >
                      {pos}
                    </button>
                  );
                })}
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
          ) : isMyPickTurn ? (
            <div style={styles.phaseInfo}>🎡 Spinning… get ready to pick!</div>
          ) : (
            <div style={styles.phaseInfo}>
              {me.positions?.length > 0
                ? `Your positions: ${me.positions.join(', ')} — waiting for others…`
                : 'Waiting for your turn…'}
            </div>
          )
          ))} {/* end !iAmDisplacedInChain block */}
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

          {/* ── Group vote is active ─────────────────────────────── */}
          {groupVote ? (
            groupVote.timedOutPlayer === me.id ? (
              /* I'm the timed-out player */
              <div style={styles.voteWaitBox}>
                <div style={styles.voteWaitIcon}>⏳</div>
                <div style={styles.voteWaitTitle}>Your peers are deciding for you</div>
                <div style={styles.voteWaitSub}>You took too long — other players are voting on your action.</div>
                <div style={styles.voteCountdown}>{voteTimeLeft}s remaining</div>
                {Object.keys(voteCounts).length > 0 && (
                  <div style={styles.voteTally}>
                    {groupVote.options.map((opt) => (
                      <div key={opt} style={styles.voteTallyRow}>
                        <span style={styles.voteTallyLabel}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</span>
                        <span style={styles.voteTallyCount}>{voteCounts[opt] ?? 0}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : groupVote.voters.includes(me.id) ? (
              /* I'm an eligible voter */
              myVote ? (
                <div style={styles.voteWaitBox}>
                  <div style={styles.voteWaitTitle}>Vote cast: <strong>{myVote.charAt(0).toUpperCase() + myVote.slice(1)}</strong></div>
                  <div style={styles.voteCountdown}>{voteTimeLeft}s remaining</div>
                  {Object.keys(voteCounts).length > 0 && (
                    <div style={styles.voteTally}>
                      {groupVote.options.map((opt) => (
                        <div key={opt} style={styles.voteTallyRow}>
                          <span style={styles.voteTallyLabel}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</span>
                          <span style={styles.voteTallyCount}>{voteCounts[opt] ?? 0}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div style={styles.voteBox}>
                  <div style={styles.voteTitle}>
                    🗳 Vote for{' '}
                    <strong>
                      {gameState.players.find((p) => p.id === groupVote.timedOutPlayer)?.displayName ?? 'them'}
                    </strong>
                  </div>
                  <div style={styles.voteSub}>They timed out — choose their action! ({voteTimeLeft}s)</div>
                  <div style={styles.actionCol}>
                    {groupVote.options.map((opt) => (
                      <button
                        key={opt}
                        style={{
                          ...styles.actionBtn,
                          background: opt === 'fold' ? '#3a1a1a' : '#1a3a1a',
                          color: opt === 'fold' ? '#e74c3c' : '#2ecc71',
                          fontSize: 18,
                          padding: '14px 20px',
                        }}
                        onClick={() => {
                          socket.emit('group-vote', { action: opt });
                          setMyVote(opt);
                        }}
                      >
                        {opt.charAt(0).toUpperCase() + opt.slice(1)}
                        {opt === 'fold' ? ' (uses their token)' : ''}
                      </button>
                    ))}
                  </div>
                </div>
              )
            ) : (
              /* I'm not involved in this vote (skipped / folded / all-in) */
              <div style={styles.phaseInfo}>Vote in progress… ({voteTimeLeft}s)</div>
            )
          ) : (
            /* ── Normal betting UI ───────────────────────────────── */
            me.allIn ? (
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
            )
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
function JoinForm({ onJoin, onBack, error, maxCashCap }) {
  const [formData, setFormData] = useState({
    displayName: '',
    realName: '',
    cashAmount: '',
    funStatement: '',
    password: '',
    confirmPassword: '',
    profileImageUrl: '',
  });
  const [checks, setChecks] = useState({ rules: false, fairy: false, bibi: false, opcc: false, fy: false });
  const [localError, setLocalError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);

  const handleImageChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setLocalError(null);
    try {
      const body = new FormData();
      body.append('profileImage', file);
      const res = await fetch('/api/upload-profile', { method: 'POST', body });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Upload failed');
      }
      const { imageUrl } = await res.json();
      setFormData((prev) => ({ ...prev, profileImageUrl: imageUrl }));
      setPreviewUrl(imageUrl);
    } catch (err) {
      setLocalError(err.message || 'Image upload failed. Try a smaller file (max 5MB, JPEG/PNG/WebP).');
    } finally {
      setUploading(false);
    }
  };

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

        {/* Profile picture */}
        <div style={styles.avatarRow}>
          {previewUrl ? (
            <img src={previewUrl} alt="avatar" style={styles.avatarPreview} />
          ) : (
            <div style={styles.avatarPlaceholder}>?</div>
          )}
          <label style={styles.avatarUploadBtn}>
            {uploading ? 'Uploading…' : previewUrl ? 'Change Photo' : 'Upload Photo (optional)'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: 'none' }}
              onChange={handleImageChange}
              disabled={uploading}
            />
          </label>
        </div>

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
          placeholder={maxCashCap != null ? `Cash Amount (Max: $${Number(maxCashCap).toFixed(2)})` : 'Cash Amount (e.g. $21.00)'}
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
function ReconnectForm({ players, onReconnect, onBack, error }) {
  const [selected, setSelected] = useState(null); // player object
  const [password, setPassword] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onReconnect({ realName: selected.realName, password });
  };

  // Step 2 — password input after selecting a player
  if (selected) {
    const initial = (selected.displayName || selected.realName || '?')[0].toUpperCase();
    return (
      <div style={styles.root}>
        <div style={styles.joinHeaderRow}>
          <div style={styles.joinHeader}>Reconnect</div>
          <button type="button" style={styles.backBtn} onClick={() => { setSelected(null); setPassword(''); }}>← Back</button>
        </div>
        <div style={styles.rcSelectedCard}>
          {selected.profileImageUrl
            ? <img src={selected.profileImageUrl} alt="" style={styles.rcSelectedAvatar} />
            : <div style={{ ...styles.rcSelectedAvatar, ...styles.rcAvatarFallback }}>{initial}</div>}
          <div>
            <div style={styles.rcSelectedName}>{selected.displayName}</div>
            <div style={styles.rcSelectedReal}>{selected.realName}</div>
          </div>
        </div>
        <form onSubmit={handleSubmit} style={{ ...styles.joinForm, marginTop: 0 }}>
          {error && <div style={{ ...styles.joinWarning, marginBottom: 10 }}>{error}</div>}
          <input
            style={styles.joinInput}
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            required
          />
          <button type="submit" style={{ ...styles.joinBtn, marginTop: 16 }}>Reconnect</button>
        </form>
      </div>
    );
  }

  // Step 1 — pick a player card
  return (
    <div style={styles.root}>
      <div style={styles.joinHeaderRow}>
        <div style={styles.joinHeader}>Who are you?</div>
        <button type="button" style={styles.backBtn} onClick={onBack}>← Back</button>
      </div>
      {error && <div style={{ ...styles.joinWarning, margin: '0 20px 10px' }}>{error}</div>}
      <div style={styles.rcGrid}>
        {players.map((p) => {
          const init = (p.displayName || p.realName || '?')[0].toUpperCase();
          return (
            <button key={p.realName} style={styles.rcCard} onClick={() => setSelected(p)}>
              {p.profileImageUrl
                ? <img src={p.profileImageUrl} alt="" style={styles.rcCardAvatar} />
                : <div style={{ ...styles.rcCardAvatar, ...styles.rcAvatarFallback }}>{init}</div>}
              <div style={styles.rcCardDisplayName}>{p.displayName}</div>
              <div style={styles.rcCardRealName}>{p.realName}</div>
            </button>
          );
        })}
        {players.length === 0 && (
          <div style={{ color: '#888', textAlign: 'center', padding: '40px 20px' }}>No players found.</div>
        )}
      </div>
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
  // ── Reconnect card picker
  rcGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 14,
    padding: '16px 20px',
  },
  rcCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    background: '#1a1a2e',
    border: '2px solid #333',
    borderRadius: 12,
    padding: '16px 10px',
    cursor: 'pointer',
    color: '#fff',
    fontFamily: "'Segoe UI', sans-serif",
    transition: 'border-color 0.15s',
  },
  rcCardAvatar: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    objectFit: 'cover',
    border: '2px solid #555',
  },
  rcAvatarFallback: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#2a2a4a',
    color: '#f0c040',
    fontSize: 26,
    fontWeight: 'bold',
  },
  rcCardDisplayName: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#f0c040',
    textAlign: 'center',
    wordBreak: 'break-word',
  },
  rcCardRealName: {
    fontSize: 12,
    color: '#aaa',
    textAlign: 'center',
    wordBreak: 'break-word',
  },
  rcSelectedCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    background: '#1a1a2e',
    border: '2px solid #f0c040',
    borderRadius: 12,
    padding: '16px 20px',
    margin: '0 20px 20px',
  },
  rcSelectedAvatar: {
    width: 72,
    height: 72,
    borderRadius: '50%',
    objectFit: 'cover',
    border: '2px solid #f0c040',
    flexShrink: 0,
  },
  rcSelectedName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#f0c040',
  },
  rcSelectedReal: {
    fontSize: 13,
    color: '#aaa',
    marginTop: 2,
  },
  avatarRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '4px 0',
  },
  avatarPreview: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    objectFit: 'cover',
    border: '2px solid #444',
    flexShrink: 0,
  },
  avatarPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    background: '#222',
    border: '2px solid #444',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 28,
    color: '#555',
    flexShrink: 0,
  },
  avatarUploadBtn: {
    background: '#1a2a3a',
    color: '#4fc3f7',
    border: '1px solid #2a4a5a',
    borderRadius: 6,
    fontSize: 14,
    padding: '8px 14px',
    cursor: 'pointer',
  },
  // ── In-game screens
  playerHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 20px',
    background: '#111',
    borderBottom: '1px solid #333',
  },
  playerName: { fontSize: 16, fontWeight: 'bold', color: '#f0c040', flex: 1 },
  playerBalance: { fontSize: 20, fontWeight: 'bold', color: '#2ecc71', flex: 1, textAlign: 'right' },
  // ── Timer badge (center of header)
  timerBadge: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    border: '2px solid',
    borderRadius: 10,
    padding: '3px 16px',
    minWidth: 60,
    transition: 'border-color 0.3s, background 0.3s',
  },
  timerBadgeNum: {
    fontSize: 28,
    fontWeight: 'bold',
    lineHeight: 1,
    transition: 'color 0.3s',
    fontVariantNumeric: 'tabular-nums',
  },
  timerBadgeLabel: {
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 1,
    transition: 'color 0.3s',
  },
  errorBanner: {
    background: '#3a0000',
    color: '#ff6b6b',
    padding: '10px 20px',
    fontSize: 14,
    borderBottom: '1px solid #660000',
  },
  // ── Full-width timer strip (below header)
  timerStrip: {
    position: 'relative',
    height: 36,
    background: '#0a0a0a',
    borderBottom: '1px solid #222',
    overflow: 'hidden',
    flexShrink: 0,
  },
  timerStripFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: '100%',
    transition: 'width 0.85s linear, background 0.3s',
    opacity: 0.35,
  },
  timerStripLabel: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    fontSize: 13,
    fontWeight: 'bold',
    color: '#fff',
    whiteSpace: 'nowrap',
    letterSpacing: 0.5,
  },
  // ── Debug box
  debugBox: {
    background: '#0a0a20',
    border: '1px solid #2244aa',
    color: '#8899ff',
    fontSize: 11,
    padding: '6px 14px',
    lineHeight: 1.6,
    fontFamily: 'monospace',
    flexShrink: 0,
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
  // ── Group vote (voter)
  voteBox: {
    background: '#1a1a2e',
    border: '2px solid #4444aa',
    borderRadius: 10,
    padding: '18px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  voteTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#a0a0ff',
  },
  voteSub: {
    fontSize: 13,
    color: '#888',
  },
  // ── Group vote (timed-out / waiting)
  voteWaitBox: {
    background: '#1a0a0a',
    border: '2px solid #884444',
    borderRadius: 10,
    padding: '18px 16px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    textAlign: 'center',
  },
  voteWaitIcon: { fontSize: 36 },
  voteWaitTitle: { fontSize: 18, fontWeight: 'bold', color: '#e07070' },
  voteWaitSub: { fontSize: 13, color: '#888' },
  voteCountdown: { fontSize: 22, fontWeight: 'bold', color: '#f0c040', marginTop: 4 },
  voteTally: {
    display: 'flex',
    gap: 16,
    marginTop: 6,
    justifyContent: 'center',
  },
  voteTallyRow: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
  },
  voteTallyLabel: { fontSize: 12, color: '#888', textTransform: 'uppercase' },
  voteTallyCount: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
};

export default PlayerView;
