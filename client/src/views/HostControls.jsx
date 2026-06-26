import { useState, useEffect, useRef } from 'react';

const POSITIONS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'DNF'];

function stripBotSuffix(name) {
  return String(name ?? '').replace(/\s*\(BOT\)\s*$/i, '').trim();
}

// ── PlayerCard ──────────────────────────────────────────────────────────────
function PlayerCard({ p, gameState, socket, onError, onSuccess, resurrectionBaseCash, onHostAction }) {
  const [expanded, setExpanded] = useState(false);
  const [balanceInput, setBalanceInput] = useState('');
  const [selectedPositions, setSelectedPositions] = useState(p.positions ?? []);
  const [confirmKick, setConfirmKick] = useState(false);
  const [confirmDeclareKing, setConfirmDeclareKing] = useState(false);

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
  if (p.eliminationState === 'pending_resurrection') {
    statusColor = '#f0c040';
    statusLabel = 'REVIVE?';
  } else if (p.eliminationState === 'failed_resurrection') {
    statusColor = '#e74c3c';
    statusLabel = 'OUT';
  } else if (currentStage === 'PRE_BET') {
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
          <span style={styles.playerName}>{stripBotSuffix(p.displayName)}</span>
          {p.isBot && <span style={styles.botBadge}>BOT</span>}
          <span style={styles.playerReal}>({p.realName})</span>
          <span style={styles.playerBal}>${Number(p.balance).toFixed(2)}</span>
          {statusLabel && <span style={{ ...styles.playerStatus, color: statusColor }}>{statusLabel}</span>}
          {!p.connected && <span style={styles.dcBadge}>DC</span>}
          {!p.skipFoldTokenAvailable && <span style={styles.noToken}>NO TOKEN</span>}
          {p.noRevive && <span style={styles.noRevive}>NO REVIVE</span>}
          {p.positions?.length > 0 && (
            <span style={styles.positions}>[{p.positions.join(', ')}]</span>
          )}
        </div>
        <button
          style={styles.expandBtn}
          onClick={() => { setExpanded((v) => !v); setConfirmKick(false); setConfirmDeclareKing(false); }}
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

          {p.eliminationState === 'alive' && (
            <div style={styles.controlGroup}>
              <div style={styles.controlLabel}>Elimination</div>
              <button
                style={{ ...styles.smallBtn, background: '#5a3a00', color: '#f0c040' }}
                onClick={() => {
                  onHostAction('manual-eliminate', { playerId: p.id }, (response) => {
                    if (response?.error) {
                      onError(response.error);
                      return;
                    }
                    onSuccess(`${p.displayName} has been manually eliminated.`);
                  });
                }}
              >
                Eliminate Player
              </button>
            </div>
          )}

          {p.eliminationState === 'pending_resurrection' && !p.noRevive && (
            <div style={styles.controlGroup}>
              <div style={styles.controlLabel}>Resurrection Decision</div>
              <div style={styles.hint}>Revive with ${Number(resurrectionBaseCash).toFixed(2)} base cash or mark as failed.</div>
              <div style={styles.controlRow}>
                <button
                  style={{ ...styles.smallBtn, background: '#1f4d2d', color: '#c6ffd8' }}
                  onClick={() => {
                    adminAction('resolve-resurrection', { outcome: 'success' });
                    onSuccess(`${p.displayName} has been revived.`);
                  }}
                >
                  Revive Player
                </button>
                <button
                  style={{ ...styles.smallBtn, background: '#4d1f1f', color: '#ffb6b6' }}
                  onClick={() => {
                    adminAction('resolve-resurrection', { outcome: 'failed' });
                    onSuccess(`${p.displayName} failed resurrection.`);
                  }}
                >
                  Fail Revival
                </button>
              </div>
            </div>
          )}

          <div style={styles.controlGroup}>
            <div style={styles.controlLabel}>Declare Winner</div>
            {!confirmDeclareKing ? (
              <button
                style={{ ...styles.smallBtn, background: '#3a2a00', color: '#f0c040', border: '1px solid #8a6a00' }}
                onClick={() => setConfirmDeclareKing(true)}
              >
                DECLARE KING OF MKMGA
              </button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 12, color: '#f0c040', lineHeight: 1.4 }}>
                  End the game now and crown <strong>{p.displayName}</strong> as King of MKMGA?
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    style={{ ...styles.smallBtn, background: '#6a4a00', color: '#ffe066' }}
                    onClick={() => {
                      adminAction('declare-king');
                      onSuccess(`${p.displayName} has been declared King of MKMGA!`);
                      setConfirmDeclareKing(false);
                      setExpanded(false);
                    }}
                  >
                    Confirm
                  </button>
                  <button
                    style={{ ...styles.smallBtn, background: '#333', color: '#aaa' }}
                    onClick={() => setConfirmDeclareKing(false)}
                  >
                    Cancel
                  </button>
                </div>
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
  const [maxCashCap, setMaxCashCap] = useState('20');
  const [publicUrlInput, setPublicUrlInput] = useState('');
  const [botAddCount, setBotAddCount] = useState('4');
  const [botAutoPick, setBotAutoPick] = useState(true);
  const [botDelayMinSec, setBotDelayMinSec] = useState('0.5');
  const [botDelayMaxSec, setBotDelayMaxSec] = useState('1.5');
  const [botPreBetMode, setBotPreBetMode] = useState('AUTO');
  const [botPositionMode, setBotPositionMode] = useState('AUTO');
  const [botBettingMode, setBotBettingMode] = useState('AUTO');
  const [botRaiseAggression, setBotRaiseAggression] = useState('NORMAL');
  const [botCascadeMode, setBotCascadeMode] = useState('AUTO');
  const [botVoteMode, setBotVoteMode] = useState('AUTO');
  const [instantWheelSpin, setInstantWheelSpin] = useState(false);
  const [skipWheelAnimation, setSkipWheelAnimation] = useState(false);
  const [playerPanelOpen, setPlayerPanelOpen] = useState(true);
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const [debugSystemOpen, setDebugSystemOpen] = useState(false);
  const [debugBotsOpen, setDebugBotsOpen] = useState(false);
  const [isBotSettingsDirty, setIsBotSettingsDirty] = useState(false);
  const [systemDebugPrints, setSystemDebugPrints] = useState([]);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmGameOverReset, setConfirmGameOverReset] = useState(false);
  const [pendingResurrectionPromptOpen, setPendingResurrectionPromptOpen] = useState(false);
  const [newDebugChannel, setNewDebugChannel] = useState('');
  const playerCardRefs = useRef(new Map());

  useEffect(() => {
    const onError = (msg) => {
      setErrorMsg(typeof msg === 'string' ? msg : JSON.stringify(msg));
      setTimeout(() => setErrorMsg(null), 4000);
    };
    const onSystemDebugSnapshot = (items) => {
      if (!Array.isArray(items)) return;
      setSystemDebugPrints(items.slice(-120));
    };
    const onSystemDebugPrint = (entry) => {
      if (!entry || typeof entry !== 'object') return;
      setSystemDebugPrints((prev) => [...prev, entry].slice(-120));
    };
    socket.on('error', onError);
    socket.on('system-debug-snapshot', onSystemDebugSnapshot);
    socket.on('system-debug-print', onSystemDebugPrint);
    return () => {
      socket.off('error', onError);
      socket.off('system-debug-snapshot', onSystemDebugSnapshot);
      socket.off('system-debug-print', onSystemDebugPrint);
    };
  }, [socket]);

  const handleAction = (action, data = {}, onAck) => {
    setErrorMsg(null);
    socket.emit('host-action', { action, ...data }, (response) => {
      if (response?.error) {
        setErrorMsg(response.error);
        setTimeout(() => setErrorMsg(null), 4000);
      }
      if (typeof onAck === 'function') {
        onAck(response);
      }
    });
  };

  const buildBotSettingsPayload = (overrides = {}) => ({
    autoPick: overrides.autoPick ?? botAutoPick,
    instantWheelSpin: overrides.instantWheelSpin ?? instantWheelSpin,
    skipWheelAnimation: overrides.skipWheelAnimation ?? skipWheelAnimation,
    decisionDelayMinMs: overrides.decisionDelayMinMs ?? Math.max(0, Math.round(Number(botDelayMinSec || 0) * 1000)),
    decisionDelayMaxMs: overrides.decisionDelayMaxMs ?? Math.max(0, Math.round(Number(botDelayMaxSec || 0) * 1000)),
    preBetMode: overrides.preBetMode ?? botPreBetMode,
    positionMode: overrides.positionMode ?? botPositionMode,
    bettingMode: overrides.bettingMode ?? botBettingMode,
    raiseAggression: overrides.raiseAggression ?? botRaiseAggression,
    cascadeMode: overrides.cascadeMode ?? botCascadeMode,
    voteMode: overrides.voteMode ?? botVoteMode,
  });

  const applyBotSettings = (overrides = {}) => {
    handleAction('debug-bot-config', { settings: buildBotSettingsPayload(overrides) });
  };

  const handleSaveRaceData = () => {
    setErrorMsg(null);
    socket.emit('host-action', { action: 'save-race-data' }, (response) => {
      if (response?.error) {
        setErrorMsg(response.error);
        setTimeout(() => setErrorMsg(null), 4000);
        return;
      }
      setSuccessMsg('Race data saved. Downloading Excel…');
      setTimeout(() => setSuccessMsg(null), 5000);
      // Trigger browser Save As dialog for Excel download
      const a = document.createElement('a');
      a.href = '/api/export-race-xlsx';
      a.download = '';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  };

  const { currentStage, players, pot, raceNumber, entryFee, positionDraft, wheelOrder } = gameState;

  const alivePlayers = players.filter((p) => p.balance > 0);
  const pendingResurrectionPlayers = players.filter((p) => p.eliminationState === 'pending_resurrection');
  const botPlayers = players.filter((p) => p.isBot);
  const pendingPreBet = alivePlayers.filter((p) => !p.paidEntry && !p.skippedRace);
  const payingPlayers = players.filter((p) => p.paidEntry);
  const allReady = pendingPreBet.length === 0 && alivePlayers.length > 0;

  const entryFeeDisplay = entryFee === 'ALL_IN' ? 'ALL IN' : `$${Number(entryFee).toFixed(2)}`;

  // Current picker name during position assignment
  const currentPickerId = positionDraft ? wheelOrder?.[positionDraft.currentPlayerIndex] : null;
  const currentPicker = players.find((p) => p.id === currentPickerId);
  const botStartingCash = String(gameState.hostSettings?.maxCashCap ?? maxCashCap);
  const botLogicDisabled = !botAutoPick;
  const resurrectionBaseCash = Number(gameState.hostSettings?.resurrectionBaseCash ?? 1);
  const systemDebugChannels = gameState.systemDebugPrintConfig?.channels || {};

  const normalizeDebugChannel = (value) =>
    String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-');

  const toggleSystemDebugChannel = (channel) => {
    const key = normalizeDebugChannel(channel);
    if (!key) return;
    handleAction('debug-system-print-set-channel', {
      channel: key,
      enabled: !Boolean(systemDebugChannels[key]),
    });
  };

  const addSystemDebugChannel = () => {
    const key = normalizeDebugChannel(newDebugChannel);
    if (!key) {
      setErrorMsg('Enter a channel name to add.');
      setTimeout(() => setErrorMsg(null), 3000);
      return;
    }
    handleAction('debug-system-print-set-channel', {
      channel: key,
      enabled: false,
    });
    setNewDebugChannel('');
  };

  const focusPlayerCard = (playerId) => {
    if (!playerId) return;
    setPlayerPanelOpen(true);
    const scrollToCard = () => {
      const card = playerCardRefs.current.get(playerId);
      if (card && typeof card.scrollIntoView === 'function') {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };
    setTimeout(scrollToCard, 0);
  };

  const handleStartPositionAssignment = (forceIgnorePendingResurrection = false) => {
    handleAction('start-position-assignment', { forceIgnorePendingResurrection });
    setPendingResurrectionPromptOpen(false);
  };

  useEffect(() => {
    const cfg = gameState.debugTools;
    if (!cfg) return;
    if (isBotSettingsDirty) return;
    setBotAutoPick(Boolean(cfg.autoPick));
    const minMs = Number(cfg.decisionDelayMinMs ?? cfg.timeoutDelayMinMs ?? 500);
    const maxMs = Number(cfg.decisionDelayMaxMs ?? cfg.timeoutDelayMaxMs ?? 1500);
    setBotDelayMinSec((minMs / 1000).toString());
    setBotDelayMaxSec((maxMs / 1000).toString());
    setBotPreBetMode(cfg.preBetMode ?? 'AUTO');
    setBotPositionMode(cfg.positionMode ?? 'AUTO');
    setBotBettingMode(cfg.bettingMode ?? 'AUTO');
    setBotRaiseAggression(cfg.raiseAggression ?? 'NORMAL');
    setBotCascadeMode(cfg.cascadeMode ?? 'AUTO');
    setBotVoteMode(cfg.voteMode ?? 'AUTO');
    setInstantWheelSpin(Boolean(cfg.instantWheelSpin));
    setSkipWheelAnimation(Boolean(cfg.skipWheelAnimation));
  }, [gameState.debugTools, isBotSettingsDirty]);

  useEffect(() => {
    const cfg = gameState.debugTools;
    if (!cfg || !isBotSettingsDirty) return;

    const expected = buildBotSettingsPayload();
    const actual = {
      autoPick: Boolean(cfg.autoPick),
      instantWheelSpin: Boolean(cfg.instantWheelSpin),
      skipWheelAnimation: Boolean(cfg.skipWheelAnimation),
      decisionDelayMinMs: Number(cfg.decisionDelayMinMs ?? cfg.timeoutDelayMinMs ?? 500),
      decisionDelayMaxMs: Number(cfg.decisionDelayMaxMs ?? cfg.timeoutDelayMaxMs ?? 1500),
      preBetMode: cfg.preBetMode ?? 'AUTO',
      positionMode: cfg.positionMode ?? 'AUTO',
      bettingMode: cfg.bettingMode ?? 'AUTO',
      raiseAggression: cfg.raiseAggression ?? 'NORMAL',
      cascadeMode: cfg.cascadeMode ?? 'AUTO',
      voteMode: cfg.voteMode ?? 'AUTO',
    };

    if (
      expected.autoPick === actual.autoPick &&
      expected.instantWheelSpin === actual.instantWheelSpin &&
      expected.skipWheelAnimation === actual.skipWheelAnimation &&
      expected.decisionDelayMinMs === actual.decisionDelayMinMs &&
      expected.decisionDelayMaxMs === actual.decisionDelayMaxMs &&
      expected.preBetMode === actual.preBetMode &&
      expected.positionMode === actual.positionMode &&
      expected.bettingMode === actual.bettingMode &&
      expected.raiseAggression === actual.raiseAggression &&
      expected.cascadeMode === actual.cascadeMode &&
      expected.voteMode === actual.voteMode
    ) {
      setIsBotSettingsDirty(false);
    }
  }, [
    gameState.debugTools,
    isBotSettingsDirty,
    botAutoPick,
    botDelayMinSec,
    botDelayMaxSec,
    botPreBetMode,
    botPositionMode,
    botBettingMode,
    botRaiseAggression,
    botCascadeMode,
    botVoteMode,
    instantWheelSpin,
    skipWheelAnimation,
  ]);

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <span style={styles.title}>HOST CONTROLS</span>
        <span style={styles.stageBadge}>{currentStage.replace(/_/g, ' ')}</span>
        <span style={styles.meta}>Race {raceNumber} · Entry: {entryFeeDisplay} · Pot: ${Number(pot).toFixed(2)}</span>
      </div>

      {errorMsg && <div style={styles.errorBanner}>{errorMsg}</div>}
      {successMsg && <div style={styles.successBanner}>{successMsg}</div>}

      {/* ── PUBLIC URL INPUT ── */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Cloudflare Tunnel URL</div>
        <div style={styles.row}>
          <input
            style={{ ...styles.input, flex: 1 }}
            type="text"
            placeholder="Paste Cloudflare Tunnel URL here..."
            value={publicUrlInput}
            onChange={(e) => setPublicUrlInput(e.target.value)}
          />
          <button
            style={styles.btn}
            onClick={() => {
              if (!publicUrlInput.trim()) {
                setErrorMsg('Please enter a URL');
                setTimeout(() => setErrorMsg(null), 3000);
                return;
              }
              socket.emit('set-public-url', { url: publicUrlInput.trim() });
              setSuccessMsg('URL updated!');
              setTimeout(() => setSuccessMsg(null), 3000);
              setPublicUrlInput('');
            }}
          >
            Set URL
          </button>
        </div>
        {gameState.publicJoinUrl && (
          <div style={{ ...styles.hint, marginTop: 8, color: '#2ecc71' }}>
            Current: {gameState.publicJoinUrl}
          </div>
        )}
      </div>

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
              {`${payingPlayers.length} players paid, ${players.filter((p) => p.skippedRace).length} players skipped, ${pendingResurrectionPlayers.length} players awaiting resurrection`}
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
            onClick={() => {
              if (pendingResurrectionPlayers.length > 0) {
                setPendingResurrectionPromptOpen(true);
                return;
              }
              handleStartPositionAssignment(false);
            }}
          >
            {allReady ? 'Go to Position Assignment →' : 'Force Go to Position Assignment'}
          </button>

          {pendingResurrectionPromptOpen && (
            <div style={styles.warningModal}>
              <div style={styles.warningModalTitle}>Pending Resurrection Decisions</div>
              <div style={styles.warningModalText}>
                These players are eliminated and still waiting for a resurrection outcome:
              </div>
              <div style={styles.pendingList}>
                {pendingResurrectionPlayers.map((p) => (
                  <button
                    key={p.id}
                    style={styles.pendingPillButton}
                    onClick={() => focusPlayerCard(p.id)}
                    title={`Focus ${p.displayName} in Players panel`}
                  >
                    {p.displayName}
                  </button>
                ))}
              </div>
              <div style={styles.warningModalActions}>
                <button style={styles.btn} onClick={() => setPendingResurrectionPromptOpen(false)}>
                  Go Back
                </button>
                <button style={{ ...styles.btn, ...styles.btnWarn }} onClick={() => handleStartPositionAssignment(true)}>
                  Ignore And Continue
                </button>
              </div>
            </div>
          )}
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

      {/* ── ELIMINATION SCREEN ── */}
      {currentStage === 'ELIMINATION_SCREEN' && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Elimination Screen</div>
          <div style={styles.hint}>
            {(gameState.newlyEliminatedIds ?? []).length} player(s) eliminated this round.
            Wait for skull animations to finish, then continue.
          </div>
          <button style={styles.btn} onClick={() => handleAction('advance-from-elimination')}>
            Continue to Pre-Bet →
          </button>
        </div>
      )}

      {/* ── GAME OVER ── */}
      {currentStage === 'GAME_OVER' && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Game Over</div>
          {gameState.kingId && (() => {
            const king = players.find((p) => p.id === gameState.kingId);
            return king ? (
              <div style={{ fontSize: 14, color: '#f0c040', fontWeight: 'bold' }}>
                KING OF MKMGA: {king.displayName}
              </div>
            ) : null;
          })()}
          {!confirmGameOverReset ? (
            <button style={{ ...styles.btn, background: '#7a1a1a', color: '#f88' }}
              onClick={() => setConfirmGameOverReset(true)}>
              Reset &amp; Start New Game
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ color: '#f88', fontSize: 13 }}>
                ⚠️ This will wipe ALL players, balances, and history. Are you sure?
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  style={{ ...styles.btn, background: '#7a1a1a', color: '#fff' }}
                  onClick={() => { handleAction('reset-game'); setConfirmGameOverReset(false); }}
                >
                  Yes, Reset Everything
                </button>
                <button
                  style={{ ...styles.btn, background: '#333', color: '#aaa' }}
                  onClick={() => setConfirmGameOverReset(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── PLAYER GRID ── */}
      <div style={styles.section}>
        <button
          style={styles.panelToggleBtn}
          onClick={() => setPlayerPanelOpen((v) => !v)}
        >
          <span style={styles.sectionTitle}>Players ({players.length})</span>
          <span style={styles.panelToggleIcon}>{playerPanelOpen ? '▾' : '▸'}</span>
        </button>

        {playerPanelOpen && (
          <>
            {players.length === 0 && <div style={styles.hint}>No players yet.</div>}
            <div style={styles.playerGrid}>
              {players.map((p) => (
                <div key={p.id} ref={(el) => {
                  if (el) playerCardRefs.current.set(p.id, el);
                  else playerCardRefs.current.delete(p.id);
                }}>
                  <PlayerCard
                    p={p}
                    gameState={gameState}
                    socket={socket}
                    resurrectionBaseCash={resurrectionBaseCash}
                    onHostAction={handleAction}
                    onError={(msg) => setErrorMsg(msg)}
                    onSuccess={(msg) => { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(null), 3000); }}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── DEBUG PANEL ── */}
      <div style={styles.section}>
        <button
          style={styles.panelToggleBtn}
          onClick={() => setDebugPanelOpen((v) => !v)}
        >
          <span style={styles.sectionTitle}>Debug Panel</span>
          <span style={styles.panelToggleIcon}>{debugPanelOpen ? '▾' : '▸'}</span>
        </button>

        {debugPanelOpen && (
          <div style={styles.debugPanelBody}>
            <button
              style={styles.subPanelToggleBtn}
              onClick={() => setDebugSystemOpen((v) => !v)}
            >
              <span style={styles.subPanelTitle}>System Debug Prints</span>
              <span style={styles.panelToggleIcon}>{debugSystemOpen ? '▾' : '▸'}</span>
            </button>

            {debugSystemOpen && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                  {Object.keys(systemDebugChannels).sort().map((channel) => {
                    const isOn = Boolean(systemDebugChannels[channel]);
                    return (
                      <button
                        key={channel}
                        style={{
                          ...styles.debugToggleBtn,
                          ...(isOn ? styles.debugToggleBtnOn : styles.debugToggleBtnOff),
                        }}
                        onClick={() => toggleSystemDebugChannel(channel)}
                      >
                        {channel}: {isOn ? 'ON' : 'OFF'}
                      </button>
                    );
                  })}
                  <button
                    style={{ ...styles.smallBtn, background: '#5a1a1a', color: '#ffb3b3', marginLeft: 'auto' }}
                    onClick={() => handleAction('debug-clear-system-prints')}
                  >
                    Clear
                  </button>
                </div>
                <div ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }} style={styles.debugPrintBox}>
                  {systemDebugPrints.length === 0 ? (
                    <div style={styles.debugPrintRow}>No debug prints yet. Open host view and wait a second.</div>
                  ) : (
                    systemDebugPrints.map((entry, idx) => {
                      const ts = entry.at?.slice(11, 19) ?? '--:--:--';
                      const ch = entry.channel ?? entry.source ?? 'unknown';
                      // Server debug messages have a .msg field; leaderboard telemetry has scroll fields
                      const line = entry.msg
                        ? `[${ts}] [${ch}] ${entry.msg}`
                        : `[${ts}] [${ch}] v=${entry.algoVersion ?? '-'} stage=${entry.stage ?? ''} phase=${entry.phase ?? ''} enabled=${String(Boolean(entry.enabled))} top=${Number(entry.scrollTop ?? 0).toFixed(1)} max=${Number(entry.maxScroll ?? 0).toFixed(1)} dir=${entry.direction === -1 ? 'up' : 'down'} focus=${entry.focusPlayerId ?? '-'} pause=${entry.edgePauseMsRemaining ?? 0}ms suspend=${entry.suspendMsRemaining ?? 0}ms`;
                      return (
                        <div key={`${entry.at ?? 't'}-${idx}`} style={styles.debugPrintRow}>
                          {line}
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}

            <button
              style={styles.subPanelToggleBtn}
              onClick={() => setDebugBotsOpen((v) => !v)}
            >
              <span style={styles.subPanelTitle}>Bots</span>
              <span style={styles.panelToggleIcon}>{debugBotsOpen ? '▾' : '▸'}</span>
            </button>

            {debugBotsOpen && (
              <>
                <div style={styles.hint}>Bots in game: <strong>{botPlayers.length}</strong></div>

                <div style={botLogicDisabled ? styles.botControlsDimmed : null}>
                  <div style={styles.rowWrap}>
                    <div style={styles.row}>
                      <label style={styles.label}>Add Bots</label>
                      <input style={styles.input} type="number" min="1" max="24" value={botAddCount} onChange={(e) => setBotAddCount(e.target.value)} />
                      <label style={styles.labelTight}>Cash</label>
                      <input style={{ ...styles.input, ...styles.inputDisabled }} type="number" min="0.25" step="0.25" value={botStartingCash} readOnly disabled />
                      <button
                        style={styles.smallBtn}
                        onClick={() => handleAction('debug-add-bots', {
                          count: Number(botAddCount),
                          startingCash: Number(gameState.hostSettings?.maxCashCap ?? maxCashCap),
                        })}
                      >
                        Add
                      </button>
                      <button style={{ ...styles.smallBtn, background: '#5a1a1a', color: '#f88' }} onClick={() => handleAction('debug-clear-bots')}>
                        Clear Bots
                      </button>
                    </div>
                  </div>

                  <div style={styles.rowWrap}>
                    <div style={styles.row}>
                      <label style={styles.label}>Decision Delay Min (sec)</label>
                      <input style={styles.input} type="number" min="0" step="0.1" value={botDelayMinSec} disabled={botLogicDisabled} onChange={(e) => { setBotDelayMinSec(e.target.value); setIsBotSettingsDirty(true); }} />
                      <label style={styles.labelTight}>Max (sec)</label>
                      <input style={styles.input} type="number" min="0" step="0.1" value={botDelayMaxSec} disabled={botLogicDisabled} onChange={(e) => { setBotDelayMaxSec(e.target.value); setIsBotSettingsDirty(true); }} />
                    </div>
                  </div>

                  <div style={styles.selectGrid}>
                    <label style={styles.selectLabel}>Pre-Bet
                      <select style={styles.select} value={botPreBetMode} disabled={botLogicDisabled} onChange={(e) => { setBotPreBetMode(e.target.value); setIsBotSettingsDirty(true); }}>
                        <option value="AUTO">AUTO</option>
                        <option value="PAY">PAY</option>
                        <option value="SKIP">SKIP</option>
                        <option value="RANDOM">RANDOM</option>
                      </select>
                    </label>
                    <label style={styles.selectLabel}>Position
                      <select style={styles.select} value={botPositionMode} disabled={botLogicDisabled} onChange={(e) => { setBotPositionMode(e.target.value); setIsBotSettingsDirty(true); }}>
                        <option value="AUTO">AUTO</option>
                        <option value="RANDOM">RANDOM</option>
                        <option value="SAFE_FIRST">SAFE_FIRST</option>
                        <option value="PREFER_DNF">PREFER_DNF</option>
                      </select>
                    </label>
                    <label style={styles.selectLabel}>Betting
                      <select style={styles.select} value={botBettingMode} disabled={botLogicDisabled} onChange={(e) => { setBotBettingMode(e.target.value); setIsBotSettingsDirty(true); }}>
                        <option value="AUTO">AUTO</option>
                        <option value="CHECK_CALL">CHECK_CALL</option>
                        <option value="FOLD_IF_POSSIBLE">FOLD_IF_POSSIBLE</option>
                        <option value="RANDOM">RANDOM</option>
                      </select>
                    </label>
                    <label style={styles.selectLabel}>Raise Risk
                      <select style={styles.select} value={botRaiseAggression} disabled={botLogicDisabled} onChange={(e) => { setBotRaiseAggression(e.target.value); setIsBotSettingsDirty(true); }}>
                        <option value="PASSIVE">PASSIVE</option>
                        <option value="NORMAL">NORMAL</option>
                        <option value="AGGRESSIVE">AGGRESSIVE</option>
                        <option value="MANIAC">MANIAC</option>
                      </select>
                    </label>
                    <label style={styles.selectLabel}>Cascade
                      <select style={styles.select} value={botCascadeMode} disabled={botLogicDisabled} onChange={(e) => { setBotCascadeMode(e.target.value); setIsBotSettingsDirty(true); }}>
                        <option value="AUTO">AUTO</option>
                        <option value="CASCADE">CASCADE</option>
                        <option value="ACCEPT_DNF">ACCEPT_DNF</option>
                        <option value="RANDOM">RANDOM</option>
                      </select>
                    </label>
                    <label style={styles.selectLabel}>Votes
                      <select style={styles.select} value={botVoteMode} disabled={botLogicDisabled} onChange={(e) => { setBotVoteMode(e.target.value); setIsBotSettingsDirty(true); }}>
                        <option value="AUTO">AUTO</option>
                        <option value="RANDOM">RANDOM</option>
                        <option value="FIRST">FIRST</option>
                      </select>
                    </label>
                  </div>
                </div>

                <div style={styles.row}>
                  <button
                    style={styles.btn}
                    disabled={botLogicDisabled}
                    onClick={() => applyBotSettings()}
                  >
                    Apply Bot Settings
                  </button>
                  <button style={{ ...styles.smallBtn, background: '#333', color: '#ddd' }} disabled={botLogicDisabled} onClick={() => handleAction('debug-run-bot-step')}>
                    Run One Bot Step
                  </button>
                  <label style={styles.botMasterSwitchLabel}>
                    <input
                      type="checkbox"
                      checked={botAutoPick}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        setBotAutoPick(enabled);
                        setIsBotSettingsDirty(true);
                        applyBotSettings({ autoPick: enabled });
                      }}
                    />
                    Bot Logic Enabled
                  </label>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── WHEEL DEBUG ── */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Wheel Debug</div>
        <div style={{ display: 'flex', flexDirection: 'row', gap: 16, flexWrap: 'wrap', marginTop: 6 }}>
          <label style={styles.botMasterSwitchLabel}>
            <input
              type="checkbox"
              checked={instantWheelSpin}
              onChange={(e) => {
                const enabled = e.target.checked;
                setInstantWheelSpin(enabled);
                setIsBotSettingsDirty(true);
                applyBotSettings({ instantWheelSpin: enabled });
              }}
            />
            Instant Wheel Spin
          </label>
          <label style={styles.botMasterSwitchLabel}>
            <input
              type="checkbox"
              checked={skipWheelAnimation}
              onChange={(e) => {
                const enabled = e.target.checked;
                setSkipWheelAnimation(enabled);
                setIsBotSettingsDirty(true);
                applyBotSettings({ skipWheelAnimation: enabled });
              }}
            />
            Skip Wheel (Auto-Assign All)
          </label>
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Data Archive</div>
        <div style={styles.hint}>Save a permanent copy of the current race/game state to a new timestamped folder.</div>
        <button style={styles.btn} onClick={handleSaveRaceData}>
          Save Current Race Data
        </button>
      </div>

      {/* ── FOOTER ── */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Footer Display</div>
        <div style={styles.hint}>Clear old player data from the footer ticker on the host screen.</div>
        <button
          style={styles.btn}
          onClick={() => handleAction('clear-footer')}
        >
          Clear Footer Content
        </button>
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
  panelToggleBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    width: '100%',
    background: '#151515',
    border: '1px solid #262626',
    borderRadius: 6,
    padding: '10px 12px',
    cursor: 'pointer',
  },
  panelToggleIcon: {
    color: '#888',
    fontSize: 14,
    lineHeight: 1,
  },
  debugPanelBody: {
    marginTop: 10,
    border: '1px solid #222',
    borderRadius: 6,
    padding: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    background: '#111',
  },
  subPanelToggleBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    width: '100%',
    background: '#171717',
    border: '1px solid #2a2a2a',
    borderRadius: 6,
    padding: '8px 10px',
    cursor: 'pointer',
  },
  subPanelTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#f0c040',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  debugPrintBox: {
    background: '#0c0f14',
    border: '1px solid #243140',
    borderRadius: 6,
    maxHeight: 220,
    overflowY: 'auto',
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  debugToggleRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  },
  debugChannelBuilderRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  debugChannelItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  debugToggleBtn: {
    border: '1px solid #3a3a3a',
    borderRadius: 999,
    background: '#1a1a1a',
    color: '#dbe6f5',
    fontSize: 11,
    padding: '4px 10px',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  debugToggleBtnOn: {
    border: '1px solid #2a7a4f',
    background: '#123022',
    color: '#9bf1c8',
  },
  debugToggleBtnOff: {
    border: '1px solid #5a2a2a',
    background: '#2a1717',
    color: '#f2abab',
  },
  debugToggleRemoveBtn: {
    border: '1px solid #6b2525',
    background: '#2a1212',
    color: '#ffb3b3',
    borderRadius: 999,
    cursor: 'pointer',
    width: 22,
    height: 22,
    lineHeight: '18px',
    fontWeight: 'bold',
    padding: 0,
  },
  debugPrintRow: {
    fontFamily: "Consolas, 'Courier New', monospace",
    fontSize: 11,
    lineHeight: 1.35,
    color: '#9fb3c8',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  hint: { fontSize: 13, color: '#aaa' },
  row: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  rowWrap: { display: 'flex', flexWrap: 'wrap', gap: 10 },
  botControlsDimmed: {
    opacity: 0.45,
    filter: 'grayscale(0.35)',
  },
  botFooterRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginTop: 6,
  },
  botMasterSwitchLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: '#d7dde7',
    background: '#171717',
    border: '1px solid #2d2d2d',
    borderRadius: 999,
    padding: '6px 10px',
    cursor: 'pointer',
  },
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
  inputDisabled: {
    opacity: 0.7,
    cursor: 'not-allowed',
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
  warningModal: {
    marginTop: 8,
    background: '#221707',
    border: '1px solid #8b5a17',
    borderRadius: 8,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  warningModalTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#f0c040',
  },
  warningModalText: {
    fontSize: 13,
    color: '#d9c39a',
    lineHeight: 1.4,
  },
  warningModalActions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
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
  pendingPillButton: {
    background: '#3a1a1a',
    color: '#f66',
    padding: '4px 10px',
    borderRadius: 12,
    fontSize: 12,
    border: '1px solid #6a2a2a',
    cursor: 'pointer',
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
  noRevive: { background: '#3a2a1a', color: '#f0c040', fontSize: 10, padding: '1px 5px', borderRadius: 3 },
  positions: { color: '#888', fontSize: 11 },
};

export default HostControls;