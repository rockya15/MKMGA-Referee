import { useState, useEffect, useRef, useCallback } from 'react';
import SpinningWheel from '../components/SpinningWheel';

// Which stages show the wheel panel
const WHEEL_STAGES = ['POSITION_ASSIGNMENT'];

function HostView({ gameState, socket }) {
  const { currentStage, players, wheelOrder, positionDraft, pot, raceNumber, entryFee } = gameState;

  const GENTLE_DNF_SLOTS = [1, 2, 4, 8, 13];
  const HARSH_DNF_SLOTS = [4, 8, 13];

  // ── Group-vote state ───────────────────────────────────────────────────
  const [groupVote, setGroupVote] = useState(null); // { timedOutPlayer, voters, options }
  const [voteTimeLeft, setVoteTimeLeft] = useState(0);
  const [voteCounts, setVoteCounts] = useState({});
  const [voteResult, setVoteResult] = useState(null); // shown briefly after resolution

  // ── Active-turn timer ──────────────────────────────────────────────────
  const [activeTimer, setActiveTimer] = useState(null); // { playerId, timeLeft, mode }
  // ── Position draft vote state ────────────────────────────────────
  const [positionVote, setPositionVote] = useState(null);
  const [positionVoteTimeLeft, setPositionVoteTimeLeft] = useState(0);
  const [positionVoteCounts, setPositionVoteCounts] = useState({});
  const [positionVoteResult, setPositionVoteResult] = useState(null);

  // ── Cascade spin overlay ─────────────────────────────────────────────────────
  const [cascadeSpinData, setCascadeSpinData] = useState(null);
  const [cascadeSpinning, setCascadeSpinning] = useState(false);
  const [cascadeSpinResult, setCascadeSpinResult] = useState(null);
  // Ref so onSpinComplete callback never captures stale cascadeSpinData
  const cascadeSpinDataRef = useRef(null);
  useEffect(() => {
    const onTimerUpdate = (data) => setActiveTimer(data);
    const onTimerClear = () => setActiveTimer(null);
    socket.on('timer-update', onTimerUpdate);
    socket.on('timer-clear', onTimerClear);
    return () => {
      socket.off('timer-update', onTimerUpdate);
      socket.off('timer-clear', onTimerClear);
    };
  }, [socket]);

  useEffect(() => {
    const onPosVoteStart = (data) => {
      setPositionVote(data);
      setPositionVoteTimeLeft(data.endsInSeconds);
      setPositionVoteCounts({});
      setPositionVoteResult(null);
    };
    const onPosVoteResult = (data) => {
      setPositionVoteResult(data);
      setPositionVote(null);
      setPositionVoteTimeLeft(0);
      setTimeout(() => setPositionVoteResult(null), 4000);
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

  useEffect(() => {
    const onCascadeSpin = ({ targetPosition, mode, level, dnfSlots, roll, initiatorName, forcedDnf }) => {
      console.log('[CASCADE] cascade-spin received:', { targetPosition, mode, level, dnfSlots, roll, initiatorName });
      // Build 13-segment wheel: first dnfSlots entries are DNF, rest are numbered positions.
      // The segment at index (roll - 1) must equal targetPosition.
      const segs = new Array(13).fill(null);
      for (let i = 0; i < dnfSlots; i++) segs[i] = 'DNF';
      segs[roll - 1] = targetPosition;
      const used = new Set(targetPosition !== 'DNF' ? [targetPosition] : []);
      let fillNum = 1;
      for (let i = dnfSlots; i < 13; i++) {
        if (segs[i] !== null) continue;
        while (used.has(String(fillNum))) fillNum++;
        segs[i] = String(fillNum);
        used.add(String(fillNum++));
      }
      // Colors: all DNF slots red, numbered slots use palette
      const palette = ['#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#e91e63','#00bcd4','#8bc34a','#ff5722','#607d8b','#795548'];
      const segColors = segs.map((s) => s === 'DNF' ? '#e74c3c' : palette.shift() ?? '#888');
      const spinData = {
        targetPosition, mode, level, dnfSlots, initiatorName, forcedDnf,
        segments: segs.map((label, i) => ({ id: i, label })),
        segmentColors: segColors,
        targetIndex: roll - 1,
      };
      console.log('[CASCADE] Setting cascadeSpinData, targetIndex:', spinData.targetIndex, 'segments:', segs);
      cascadeSpinDataRef.current = spinData;
      setCascadeSpinData(spinData);
      setCascadeSpinning(true);
      setCascadeSpinResult(null);
    };
    socket.on('cascade-spin', onCascadeSpin);
    return () => socket.off('cascade-spin', onCascadeSpin);
  }, [socket]);

  useEffect(() => {
    const onVoteStart = (data) => {
      setGroupVote(data);
      setVoteTimeLeft(data.endsInSeconds);
      setVoteCounts({});
      setVoteResult(null);
    };
    const onVoteResult = (data) => {
      setVoteResult(data);
      setGroupVote(null);
      setVoteTimeLeft(0);
      setTimeout(() => setVoteResult(null), 4000);
    };
    const onVoteTimerUpdate = ({ timeLeft }) => setVoteTimeLeft(timeLeft);
    const onVoteUpdate = ({ voteCounts: vc }) => setVoteCounts(vc);
    socket.on('group-vote-start', onVoteStart);
    socket.on('group-vote-result', onVoteResult);
    socket.on('vote-timer-update', onVoteTimerUpdate);
    socket.on('vote-update', onVoteUpdate);
    return () => {
      socket.off('group-vote-start', onVoteStart);
      socket.off('group-vote-result', onVoteResult);
      socket.off('vote-timer-update', onVoteTimerUpdate);
      socket.off('vote-update', onVoteUpdate);
    };
  }, [socket]);

  // ── Wheel state ──────────────────────────────────────────────────────────────
  const [segments, setSegments] = useState([]);
  const [targetIndex, setTargetIndex] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [pickerName, setPickerName] = useState(null);
  const [pickerPlayer, setPickerPlayer] = useState(null);
  const [highlightIndex, setHighlightIndex] = useState(null);
  const [wheelOpacity, setWheelOpacity] = useState(1);
  const [avatarScale, setAvatarScale] = useState(0.3);
  const [avatarOpacity, setAvatarOpacity] = useState(0);

  // Track the previous currentPlayerIndex so we know when it changes
  const prevPickerIndexRef = useRef(null);
  // Keep a ref to latest positionDraft for the spin-complete callback (avoid stale closure)
  const positionDraftRef = useRef(positionDraft);
  useEffect(() => { positionDraftRef.current = positionDraft; }, [positionDraft]);
  const wheelOrderRef = useRef(wheelOrder);
  useEffect(() => { wheelOrderRef.current = wheelOrder; }, [wheelOrder]);
  const playersRef = useRef(players);
  useEffect(() => { playersRef.current = players; }, [players]);

  // Shared reveal logic — called after spin lands OR when wheel is skipped (1 player left)
  // player: the player object to reveal; winnerSegIndex: null when wheel is skipped
  const revealPicker = useCallback((player, winnerSegIndex) => {
    socket.emit('spin-complete'); // tell server the wheel landed — start the picker's timer
    setPickerName(player?.displayName ?? null);
    // Mount avatar div immediately (opacity 0) so CSS transitions fire correctly
    setPickerPlayer(player ?? null);
    // Highlight winner segment if wheel was shown
    if (winnerSegIndex !== null) setHighlightIndex(winnerSegIndex);

    const HOLD_MS = winnerSegIndex !== null ? 1000 : 0;
    const FADE_MS = 400;

    setTimeout(() => {
      setWheelOpacity(0);
      setTimeout(() => {
        setAvatarOpacity(1);
        setAvatarScale(1);
      }, FADE_MS);
    }, HOLD_MS);
  }, [socket]);

  useEffect(() => {
    if (currentStage !== 'POSITION_ASSIGNMENT') {
      prevPickerIndexRef.current = null;
      setSpinning(false);
      setSegments([]);
      setPickerName(null);
      return;
    }

    const draft = positionDraftRef.current;
    const order = wheelOrderRef.current;
    const allPlayers = playersRef.current;

    if (!draft || !order) {
      prevPickerIndexRef.current = null;
      setSpinning(false);
      setSegments([]);
      setPickerName(null);
      return;
    }

    const newSegments = order
      .filter((id) => (draft.remainingByPlayer?.[id] ?? 0) > 0)
      .map((id) => {
        const p = allPlayers.find((pl) => pl.id === id);
        return { id, label: p?.displayName ?? id };
      });
    const currentPickerId = order[draft.currentPlayerIndex] ?? null;
    const currentPlayer = allPlayers.find((p) => p.id === currentPickerId) ?? null;

    // Helper: skip wheel, reveal player immediately
    const skipAndReveal = () => {
      setSpinning(false);
      setWheelOpacity(0);
      setAvatarScale(0.3);
      setAvatarOpacity(0);
      setPickerPlayer(null);
      setPickerName(null);
      setHighlightIndex(null);
      // Small delay so state flushes before reveal starts
      setTimeout(() => revealPicker(currentPlayer, null), 50);
    };

    // First time entering POSITION_ASSIGNMENT — spin immediately (or skip if 1 player)
    if (prevPickerIndexRef.current === null) {
      prevPickerIndexRef.current = draft.currentPlayerIndex;
      setSegments(newSegments);
      const idx = newSegments.findIndex((s) => s.id === currentPickerId);
      setTargetIndex(Math.max(0, idx));
      setPickerName(null);
      if (newSegments.length <= 1) {
        skipAndReveal();
      } else {
        setSpinning(true);
      }
      return;
    }

    // Picker index changed — re-spin for next player (or skip if 1 player left)
    if (draft.currentPlayerIndex !== prevPickerIndexRef.current) {
      prevPickerIndexRef.current = draft.currentPlayerIndex;
      setSegments(newSegments);
      const idx = newSegments.findIndex((s) => s.id === currentPickerId);
      setTargetIndex(Math.max(0, idx));
      setPickerName(null);
      if (newSegments.length <= 1) {
        skipAndReveal();
      } else {
        setSpinning(true);
      }
    }
  }, [currentStage, positionDraft?.currentPlayerIndex, revealPicker]);

  // Reset reveal state whenever a new spin starts
  useEffect(() => {
    if (spinning) {
      setWheelOpacity(1);
      setAvatarScale(0.3);
      setAvatarOpacity(0);
      setPickerPlayer(null);
      setPickerName(null);
      setHighlightIndex(null);
    }
  }, [spinning]);

  const handleSpinComplete = useCallback(() => {
    setSpinning(false);
    const draft = positionDraftRef.current;
    const order = wheelOrderRef.current;
    const allPlayers = playersRef.current;
    const currentPickerId = order?.[draft?.currentPlayerIndex] ?? null;
    const player = allPlayers.find((p) => p.id === currentPickerId) ?? null;
    revealPicker(player, targetIndex);
  }, [targetIndex, revealPicker]);

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

      {/* Timer strip — full width, below the header */}
      {activeTimer && !groupVote && (() => {
        const timerPlayer = players.find((p) => p.id === activeTimer.playerId);
        const maxDuration = activeTimer.mode === 'position' ? 30 : 60;
        const pct = Math.max(0, (activeTimer.timeLeft / maxDuration) * 100);
        const urgent = activeTimer.timeLeft <= 10;
        const warning = activeTimer.timeLeft <= 20;
        const barColor = urgent ? '#e74c3c' : warning ? '#e67e22' : '#2ecc71';
        return (
          <div style={styles.timerStrip}>
            <div style={{ ...styles.timerStripFill, width: `${pct}%`, background: barColor }} />
            <span style={{ ...styles.timerStripLabel, color: urgent ? '#e74c3c' : '#fff' }}>
              {timerPlayer?.displayName ?? 'Player'}
              {' — '}
              <strong>{activeTimer.timeLeft}s</strong>
              {activeTimer.mode === 'position' ? ' to pick' : ' to act'}
            </span>
          </div>
        );
      })()}

      {/* Group-vote overlay (betting) */}
      {(groupVote || voteResult) && (
        <div style={styles.voteOverlay}>
          {voteResult ? (
            /* Result banner */
            <div style={styles.voteResultBanner}>
              ✅ Vote resolved —{' '}
              <strong>
                {players.find((p) => p.id === voteResult.timedOutPlayer)?.displayName ?? 'Player'}
              </strong>{' '}
              will <strong>{voteResult.result.toUpperCase()}</strong>
            </div>
          ) : (
            /* Active vote panel */
            <div style={styles.votePanel}>
              <div style={styles.votePanelTitle}>
                ⏳ GROUP VOTE —{' '}
                <span style={{ color: '#e07070' }}>
                  {players.find((p) => p.id === groupVote.timedOutPlayer)?.displayName ?? 'Player'}
                </span>{' '}
                timed out
              </div>
              <div style={styles.votePanelSub}>
                Other players are voting… {voteTimeLeft}s remaining
              </div>
              <div style={styles.votePanelTimerBarWrap}>
                <div
                  style={{
                    ...styles.votePanelTimerBarFill,
                    width: `${(voteTimeLeft / 30) * 100}%`,
                    background: voteTimeLeft <= 10 ? '#e74c3c' : '#f0c040',
                  }}
                />
              </div>
              <div style={styles.votePanelTally}>
                {groupVote.options.map((opt) => (
                  <div key={opt} style={styles.votePanelTallyCell}>
                    <div style={styles.votePanelTallyCount}>{voteCounts[opt] ?? 0}</div>
                    <div style={styles.votePanelTallyLabel}>{opt.toUpperCase()}</div>
                  </div>
                ))}
              </div>
              <div style={styles.votePanelVoters}>
                {groupVote.voters.length} eligible voter{groupVote.voters.length !== 1 ? 's' : ''}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Position-vote overlay (draft phase) */}
      {(positionVote || positionVoteResult) && (
        <div style={styles.voteOverlay}>
          {positionVoteResult ? (
            <div style={styles.voteResultBanner}>
              🎯 Position vote resolved —{' '}
              <strong>
                {players.find((p) => p.id === positionVoteResult.timedOutPlayer)?.displayName ?? 'Player'}
              </strong>{' '}
              assigned: <strong>{positionVoteResult.assignedPositions.join(', ')}</strong>
            </div>
          ) : (
            <div style={{ ...styles.votePanel, borderColor: '#cc8844', boxShadow: '0 0 40px rgba(200,140,80,0.5)' }}>
              <div style={{ ...styles.votePanelTitle, color: '#ffaa55' }}>
                🗳 POSITION VOTE —{' '}
                <span style={{ color: '#e07070' }}>
                  {players.find((p) => p.id === positionVote.timedOutPlayer)?.displayName ?? 'Player'}
                </span>{' '}
                timed out ({positionVote.picksNeeded} pick{positionVote.picksNeeded > 1 ? 's' : ''} needed)
              </div>
              <div style={styles.votePanelSub}>
                Players are voting on their position{positionVote.picksNeeded > 1 ? 's' : ''}… {positionVoteTimeLeft}s remaining
              </div>
              <div style={styles.votePanelTimerBarWrap}>
                <div
                  style={{
                    ...styles.votePanelTimerBarFill,
                    width: `${(positionVoteTimeLeft / 30) * 100}%`,
                    background: positionVoteTimeLeft <= 10 ? '#e74c3c' : '#e67e22',
                  }}
                />
              </div>
              {/* Top voted positions */}
              {Object.keys(positionVoteCounts).length > 0 && (() => {
                const sorted = positionVote.options
                  .map((pos) => ({ pos, count: positionVoteCounts[pos] ?? 0 }))
                  .filter((x) => x.count > 0)
                  .sort((a, b) => b.count - a.count)
                  .slice(0, 6);
                return sorted.length > 0 ? (
                  <div style={styles.votePanelTally}>
                    {sorted.map(({ pos, count }) => (
                      <div key={pos} style={styles.votePanelTallyCell}>
                        <div style={{ ...styles.votePanelTallyCount, fontSize: 28 }}>{count}</div>
                        <div style={styles.votePanelTallyLabel}>P{pos}</div>
                      </div>
                    ))}
                  </div>
                ) : null;
              })()}
              <div style={styles.votePanelVoters}>
                {positionVote.voters.length} eligible voter{positionVote.voters.length !== 1 ? 's' : ''}
              </div>
            </div>
          )}
        </div>
      )}

      <div style={styles.body}>
        {/* Wheel panel */}
        {WHEEL_STAGES.includes(currentStage) && (
          <div style={styles.wheelPanel}>
            <div style={styles.wheelTitle}>THE WHEEL</div>

            {segments.length > 0 ? (
              <>
                {/* Wheel + avatar overlay share the same space */}
                <div style={{ position: 'relative', width: 420, height: 420, flexShrink: 0 }}>
                  {/* Wheel fades out via CSS transition */}
                  <div style={{
                    opacity: wheelOpacity,
                    transition: 'opacity 400ms ease',
                    position: 'absolute', inset: 0,
                  }}>
                    <SpinningWheel
                      segments={segments}
                      targetIndex={targetIndex}
                      spinning={spinning}
                      onSpinComplete={handleSpinComplete}
                      size={420}
                      highlightIndex={highlightIndex}
                      dimAmount={0.2}
                    />
                  </div>
                  {/* Avatar — rendered as soon as pickerPlayer is set so CSS transitions fire correctly */}
                  {pickerPlayer && (
                    <div style={{
                      position: 'absolute', inset: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      opacity: avatarOpacity,
                      transform: `scale(${avatarScale})`,
                      transition: 'opacity 500ms ease, transform 500ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                      pointerEvents: 'none',
                    }}>
                      {pickerPlayer.profileImageUrl ? (
                        <img
                          src={pickerPlayer.profileImageUrl}
                          alt={pickerPlayer.displayName}
                          style={{
                            width: 315, height: 315,
                            borderRadius: '50%',
                            objectFit: 'cover',
                            border: '4px solid #f0c040',
                            boxShadow: '0 0 40px rgba(240,192,64,0.8)',
                          }}
                        />
                      ) : (
                        <div style={{
                          width: 315, height: 315,
                          borderRadius: '50%',
                          background: '#2a2a2a',
                          border: '4px solid #f0c040',
                          boxShadow: '0 0 40px rgba(240,192,64,0.8)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 120, fontWeight: 'bold', color: '#f0c040',
                        }}>
                          {pickerPlayer.displayName?.[0]?.toUpperCase() ?? '?'}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {spinning && (
                  <div style={styles.spinningLabel}>Spinning…</div>
                )}
                {pickerName && !spinning && (
                  <div style={{ ...styles.pickerLabel, opacity: avatarOpacity, transition: 'opacity 500ms ease' }}>
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
            {/* Cascade chain status panel */}
            {positionDraft?.cascadeChain && (() => {
              const chain = positionDraft.cascadeChain;
              const displacedPlayer = players.find((p) => p.id === chain.pendingDisplacedId);
              const table = chain.nextMode === 'gentle' ? GENTLE_DNF_SLOTS : HARSH_DNF_SLOTS;
              const safeLevel = Math.min(chain.nextLevel, table.length - 1);
              const dnfSlots = table[safeLevel];
              const dnfPct = Math.round((dnfSlots / 13) * 100);
              const label = chain.nextMode === 'gentle'
                ? `Gentle Level ${safeLevel + 1}`
                : `Harsh Spin ${safeLevel + 1}`;
              return (
                <div style={styles.cascadeChainPanel}>
                  <div style={styles.cascadeChainTitle}>🎡 CASCADE CHAIN ACTIVE</div>
                  <div style={styles.cascadeChainDisplaced}>
                    <span style={{ color: '#e74c3c', fontWeight: 'bold' }}>
                      {displacedPlayer?.displayName ?? 'Unknown'}
                    </span>
                    {' was displaced to DNF'}
                  </div>
                  <div style={styles.cascadeChainInfo}>
                    {label} — {dnfSlots}/13 DNF slots ({dnfPct}% DNF chance)
                  </div>
                  <div style={styles.cascadeChainWaiting}>Awaiting their decision…</div>
                </div>
              );
            })()}          </div>
        )}

        {/* Leaderboard */}
        <div style={styles.leaderboard}>
          <div style={styles.lbTitle}>PLAYERS</div>
          {sortedPlayers.map((p, i) => {
            const isOnClock = activeTimer?.playerId === p.id;
            const timerUrgent = isOnClock && activeTimer.timeLeft <= 10;
            return (
            <div key={p.id} style={{
              ...styles.lbRow,
              opacity: p.balance <= 0 ? 0.4 : 1,
              background: isOnClock
                ? (timerUrgent ? '#2a0000' : '#001a0a')
                : p.balance <= 0 ? '#1a0000' : i % 2 === 0 ? '#151515' : '#1c1c1c',
              border: isOnClock ? `1px solid ${timerUrgent ? '#e74c3c' : '#2ecc71'}` : '1px solid transparent',
            }}>
              <span style={styles.lbRank}>#{i + 1}</span>
              {p.profileImageUrl ? (
                <img src={p.profileImageUrl} alt="" style={styles.lbAvatar} />
              ) : (
                <div style={styles.lbAvatarPlaceholder}>{p.displayName?.[0]?.toUpperCase() ?? '?'}</div>
              )}
              <span style={styles.lbName}>{p.displayName}</span>
              {isOnClock && (
                <span style={{ ...styles.lbTimerBadge, color: timerUrgent ? '#e74c3c' : '#2ecc71', borderColor: timerUrgent ? '#e74c3c' : '#2ecc71' }}>
                  {activeTimer.timeLeft}s
                </span>
              )}
              <span style={styles.lbBalance}>${Number(p.balance).toFixed(2)}</span>
              {p.positions?.length > 0 && (
                <span style={styles.lbPositions}>[{p.positions.join(', ')}]</span>
              )}
              {!p.skipFoldTokenAvailable && <span style={styles.lbNoToken}>NO TOKEN</span>}
            </div>
          );
          })}
        </div>
      </div>

    {/* ── Cascade spin overlay ───────────────────────────────────────────── */}
    {cascadeSpinData && (
      <div style={styles.cascadeSpinOverlay}>
        <div style={styles.cascadeSpinPanel}>
          <div style={styles.cascadeSpinTitle}>🎡 CASCADE WHEEL</div>
          <div style={styles.cascadeSpinInitiator}>{cascadeSpinData.initiatorName}</div>
          <div style={styles.cascadeSpinInfo}>
            {cascadeSpinData.mode === 'gentle'
              ? `Gentle Level ${cascadeSpinData.level + 1}`
              : `Harsh Spin ${cascadeSpinData.level + 1}`}
            {' · '}
            <span style={{ color: '#e74c3c' }}>{cascadeSpinData.dnfSlots}</span>/13 DNF slots
            {' · '}
            {Math.round((cascadeSpinData.dnfSlots / 13) * 100)}% DNF chance
          </div>
          {!cascadeSpinResult ? (
            <SpinningWheel
              segments={cascadeSpinData.segments}
              targetIndex={cascadeSpinData.targetIndex}
              spinning={cascadeSpinning}
              onSpinComplete={() => {
                const finalTarget = cascadeSpinDataRef.current?.targetPosition ?? cascadeSpinData.targetPosition;
                console.log('[CASCADE] onSpinComplete fired, result:', finalTarget);
                setCascadeSpinning(false);
                setCascadeSpinResult(finalTarget);
                setTimeout(() => {
                  setCascadeSpinData(null);
                  setCascadeSpinResult(null);
                  cascadeSpinDataRef.current = null;
                }, 2800);
              }}
              size={360}
              segmentColors={cascadeSpinData.segmentColors}
            />
          ) : (
            <div style={{
              fontSize: 72,
              fontWeight: 'bold',
              color: cascadeSpinResult === 'DNF' ? '#e74c3c' : '#2ecc71',
              padding: '32px 48px',
              textAlign: 'center',
              textShadow: `0 0 30px ${cascadeSpinResult === 'DNF' ? 'rgba(231,76,60,0.8)' : 'rgba(46,204,113,0.8)'}`,
            }}>
              {cascadeSpinResult === 'DNF' ? '💀 DNF' : `🎯 #${cascadeSpinResult}`}
            </div>
          )}
        </div>
      </div>
    )}
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
    position: 'relative',
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
    willChange: 'opacity',
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
  lbAvatar: { width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 },
  lbAvatarPlaceholder: { width: 32, height: 32, borderRadius: '50%', background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 'bold', color: '#888', flexShrink: 0 },
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
  lbTimerBadge: {
    fontSize: 13,
    fontWeight: 'bold',
    border: '1px solid',
    borderRadius: 4,
    padding: '1px 6px',
    marginRight: 4,
    fontVariantNumeric: 'tabular-nums',
  },
  // ── Full-width turn timer strip
  timerStrip: {
    position: 'relative',
    height: 32,
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
    opacity: 0.4,
  },
  timerStripLabel: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    fontSize: 13,
    whiteSpace: 'nowrap',
    letterSpacing: 0.5,
    transition: 'color 0.3s',
  },
  // ── Group vote overlay
  voteOverlay: {
    position: 'absolute',
    top: 64,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 100,
    minWidth: 480,
    maxWidth: 640,
  },
  votePanel: {
    background: '#0d0d2e',
    border: '2px solid #4444cc',
    borderRadius: 12,
    padding: '20px 28px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    boxShadow: '0 0 40px rgba(80,80,200,0.5)',
  },
  votePanelTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#a0a0ff',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  votePanelSub: { fontSize: 14, color: '#888' },
  votePanelTimerBarWrap: {
    height: 8,
    background: '#1a1a1a',
    borderRadius: 4,
    overflow: 'hidden',
  },
  votePanelTimerBarFill: {
    height: '100%',
    borderRadius: 4,
    transition: 'width 0.8s linear, background 0.3s',
  },
  votePanelTally: {
    display: 'flex',
    gap: 32,
    justifyContent: 'center',
    marginTop: 4,
  },
  votePanelTallyCell: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
  },
  votePanelTallyCount: { fontSize: 40, fontWeight: 'bold', color: '#fff' },
  votePanelTallyLabel: { fontSize: 13, color: '#aaa', textTransform: 'uppercase', letterSpacing: 2 },
  votePanelVoters: { fontSize: 12, color: '#555', textAlign: 'right' },
  voteResultBanner: {
    background: '#0d2b1e',
    border: '2px solid #2ecc71',
    borderRadius: 10,
    padding: '16px 24px',
    fontSize: 18,
    color: '#2ecc71',
    textAlign: 'center',
    boxShadow: '0 0 30px rgba(46,204,113,0.4)',
  },
  cascadeChainPanel: {
    background: '#1a0d1a',
    border: '2px solid #aa44aa',
    borderRadius: 10,
    padding: '14px 18px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    width: '100%',
    boxShadow: '0 0 24px rgba(180,80,180,0.4)',
  },
  cascadeChainTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#dd88dd',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  cascadeChainDisplaced: {
    fontSize: 15,
    color: '#ccc',
  },
  cascadeChainInfo: {
    fontSize: 13,
    color: '#aaa',
  },
  cascadeChainWaiting: {
    fontSize: 12,
    color: '#666',
    fontStyle: 'italic',
  },
  // ── Cascade spin overlay
  cascadeSpinOverlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(0,0,0,0.82)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 200,
  },
  cascadeSpinPanel: {
    background: '#111',
    border: '2px solid #f0c040',
    borderRadius: 16,
    padding: '28px 36px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    boxShadow: '0 0 60px rgba(240,192,64,0.35)',
    minWidth: 420,
  },
  cascadeSpinTitle: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#f0c040',
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  cascadeSpinInitiator: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  cascadeSpinInfo: {
    fontSize: 14,
    color: '#aaa',
    letterSpacing: 0.5,
  },
};

export default HostView;
