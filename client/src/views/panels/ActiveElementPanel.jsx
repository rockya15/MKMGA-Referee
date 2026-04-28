import { useState, useEffect, useRef } from 'react';
import SpinningWheel from '../../components/SpinningWheel';
import Avatar from '../../components/Avatar';
import StackedAvatars from '../../components/StackedAvatars';
import { usePanelProgress } from '../../context/PanelProgressContext';

function getFirstName(name) {
  const safe = String(name || '').trim();
  if (!safe) return 'Player';
  return safe.split(/\s+/)[0];
}

// ---------- Sub-components ----------

function VoteElement({ players, groupVote, voteResult, voteTimeLeft, voteCounts, positionVote, positionVoteResult, positionVoteTimeLeft }) {
  if (groupVote || voteResult) {
    if (voteResult) {
      return (
        <div style={s.voteResultBanner}>
          Vote resolved — <strong>{players.find((p) => p.id === voteResult.timedOutPlayer)?.displayName ?? 'Player'}</strong> will <strong>{voteResult.result.toUpperCase()}</strong>
        </div>
      );
    }
    return (
      <div style={s.votePanel}>
        <div style={s.votePanelTitle}>
          GROUP VOTE — <span style={{ color: '#e07070' }}>{players.find((p) => p.id === groupVote.timedOutPlayer)?.displayName ?? 'Player'}</span> timed out
        </div>
        <div style={s.votePanelSub}>Other players are voting... {voteTimeLeft}s remaining</div>
        <div style={s.votePanelTimerBarWrap}>
          <div style={{ ...s.votePanelTimerBarFill, width: `${(voteTimeLeft / 30) * 100}%`, background: voteTimeLeft <= 10 ? '#e74c3c' : '#f0c040' }} />
        </div>
        <div style={s.votePanelTally}>
          {groupVote.options.map((opt) => (
            <div key={opt} style={s.votePanelTallyCell}>
              <div style={s.votePanelTallyCount}>{voteCounts[opt] ?? 0}</div>
              <div style={s.votePanelTallyLabel}>{opt.toUpperCase()}</div>
            </div>
          ))}
        </div>
        <div style={s.votePanelVoters}>{groupVote.voters.length} eligible voter{groupVote.voters.length !== 1 ? 's' : ''}</div>
      </div>
    );
  }

  if (positionVote || positionVoteResult) {
    if (positionVoteResult) {
      return (
        <div style={s.voteResultBanner}>
          Position vote resolved — <strong>{players.find((p) => p.id === positionVoteResult.timedOutPlayer)?.displayName ?? 'Player'}</strong> assigned: <strong>{positionVoteResult.assignedPositions.join(', ')}</strong>
        </div>
      );
    }
    return (
      <div style={{ ...s.votePanel, borderColor: '#cc8844', boxShadow: '0 0 40px rgba(200,140,80,0.5)' }}>
        <div style={{ ...s.votePanelTitle, color: '#ffaa55' }}>
          POSITION VOTE — <span style={{ color: '#e07070' }}>{players.find((p) => p.id === positionVote.timedOutPlayer)?.displayName ?? 'Player'}</span> timed out ({positionVote.picksNeeded} pick{positionVote.picksNeeded > 1 ? 's' : ''} needed)
        </div>
        <div style={s.votePanelSub}>Players are voting on their position{positionVote.picksNeeded > 1 ? 's' : ''}... {positionVoteTimeLeft}s remaining</div>
        <div style={s.votePanelTimerBarWrap}>
          <div style={{ ...s.votePanelTimerBarFill, width: `${(positionVoteTimeLeft / 30) * 100}%`, background: positionVoteTimeLeft <= 10 ? '#e74c3c' : '#e67e22' }} />
        </div>
        <div style={s.votePanelVoters}>{positionVote.voters.length} eligible voter{positionVote.voters.length !== 1 ? 's' : ''}</div>
      </div>
    );
  }

  return null;
}

function PayoutElement({ winners, raceResult, getFavoriteColor, payoutTotalAmount }) {
  const shown = winners.slice(0, 3);
  const overflow = winners.slice(3);
  const overflowNames = overflow.map((p) => getFirstName(p.displayName || p.realName || p.id));
  const totalAmount = Number(payoutTotalAmount) || 0;
  const perWinner = winners.length > 0 ? totalAmount / winners.length : 0;

  // phase: 'idle' -> 'total' -> 'split' -> 'done'
  const [phase, setPhase] = useState('idle');
  const [coins, setCoins] = useState([]);
  const [caughtSet, setCaughtSet] = useState(new Set());
  const containerRef = useRef(null);
  const sourceRef = useRef(null);
  const winnerTileRefs = useRef([]);

  const winnerIds = winners.map((w) => w.id).join(',');
  useEffect(() => {
    setPhase('idle');
    setCoins([]);
    setCaughtSet(new Set());
    if (winners.length === 0 || totalAmount === 0) return undefined;
    const t1 = setTimeout(() => setPhase('total'), 300);
    const t2 = setTimeout(() => setPhase('split'), 5300);
    const t3 = setTimeout(() => setPhase('done'), 8800);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winnerIds, totalAmount]);

  useEffect(() => {
    if (phase !== 'split') return;
    if (!containerRef.current || !sourceRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const srcRect = sourceRef.current.getBoundingClientRect();
    const sx = srcRect.left + srcRect.width / 2 - containerRect.left;
    const sy = srcRect.top + srcRect.height / 2 - containerRect.top;
    const newCoins = shown.map((winner, i) => {
      const tileEl = winnerTileRefs.current[i];
      let tx = sx + (i - (shown.length - 1) / 2) * 60;
      let ty = sy + 80;
      if (tileEl) {
        const r = tileEl.getBoundingClientRect();
        tx = r.left + r.width / 2 - containerRect.left;
        ty = r.top + r.height / 2 - containerRect.top;
      }
      const arcPeakX = (sx + tx) / 2 + (Math.random() - 0.5) * 80;
      const arcPeakY = Math.min(sy, ty) - 70 - Math.random() * 50;
      return { id: i, sx, sy, tx, ty, arcPeakX, arcPeakY, delay: i * 180 };
    });
    setCoins(newCoins);
    newCoins.forEach((coin) => {
      setTimeout(() => setCaughtSet((prev) => new Set([...prev, coin.id])), coin.delay + 1050);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const fmt = (val) => `$${Math.abs(val).toFixed(2)}`;

  if (winners.length === 0) {
    return (
      <div style={s.payoutPanel}>
        <div style={s.payoutTitle}>Payout</div>
        <div style={s.payoutSubtitle}>No winning cards for position {raceResult ?? 'N/A'} this race.</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ ...s.payoutPanel, position: 'relative', overflow: 'visible' }}>
      <div style={s.payoutTitle}>{winners.length === 1 ? 'Winner' : 'Winners'}</div>
      <div style={s.payoutSubtitle}>Hit position: <strong>{raceResult ?? 'N/A'}</strong></div>

      {/* Phase 1 — total earnings */}
      {(phase === 'total' || phase === 'split') && totalAmount > 0 && (
        <div
          ref={sourceRef}
          className={phase === 'split' ? 'payout-total-exit' : 'payout-total-enter'}
          style={s.payoutTotalDisplay}
        >
          <div style={s.payoutTotalLabel}>TOTAL POT DISTRIBUTED</div>
          <div style={s.payoutTotalAmount}>{fmt(totalAmount)}</div>
          {winners.length > 1 && (
            <div style={s.payoutSplitHint}>{fmt(perWinner)} × {winners.length} winners</div>
          )}
        </div>
      )}

      {/* Winner tiles */}
      <div style={s.payoutWinnersRow}>
        {shown.map((player, i) => (
          <div
            key={player.id}
            ref={(el) => { winnerTileRefs.current[i] = el; }}
            style={s.payoutWinnerTile}
            className={caughtSet.has(i) ? 'payout-winner-catch' : undefined}
          >
            <Avatar player={player} size={80} borderWidth={3} getFavoriteColor={getFavoriteColor} />
            <div style={s.payoutWinnerName}>{getFirstName(player.displayName || player.realName || player.id)}</div>
            {(phase === 'done' || caughtSet.has(i)) && perWinner > 0 && (
              <div style={s.payoutWinnerShare} className="payout-share-pop">{fmt(perWinner)}</div>
            )}
          </div>
        ))}
      </div>

      {overflow.length > 0 && (
        <div style={s.payoutOverflowText}>+{overflow.length} more: {overflowNames.join(', ')}</div>
      )}

      {/* Flying coins */}
      {coins.map((coin) => (
        <div
          key={coin.id}
          className="payout-coin-fly"
          style={{
            position: 'absolute',
            left: coin.sx,
            top: coin.sy,
            '--arc-x': `${coin.arcPeakX - coin.sx}px`,
            '--arc-y': `${coin.arcPeakY - coin.sy}px`,
            '--end-x': `${coin.tx - coin.sx}px`,
            '--end-y': `${coin.ty - coin.sy}px`,
            animationDelay: `${coin.delay}ms`,
            pointerEvents: 'none',
            zIndex: 300,
          }}
        >
          {fmt(perWinner)}
        </div>
      ))}
    </div>
  );
}

// ---------- Main component ----------

/**
 * ActiveElementPanel
 *
 * Renders the correct sub-feature (vote | wheel | payout) based on elementType.
 * Reads PanelProgressContext to fade content in once the panel is sufficiently visible.
 *
 * Props: see HostView for shape
 */
export default function ActiveElementPanel({
  elementType,
  players,
  gameState,
  // vote state
  groupVote, voteResult, voteTimeLeft, voteCounts,
  positionVote, positionVoteResult, positionVoteTimeLeft,
  // wheel state
  segments, targetIndex, spinning, highlightIndex,
  wheelOpacity, avatarOpacity, avatarScale, pickerPlayer, pickerName,
  wheelSpawnKey, cascadeActive, cascadeSpinData, cascadeSpinning, cascadeSpinResult,
  cascadeSpinDataRef, cascadeResultHoldTimeoutRef,
  handleSpinComplete, clearCascadeResultHoldTimeout,
  setCascadeSpinResult, setCascadeSpinning,
  socket, wheelContextTitle, spinContextLine1, spinContextLine2, cascadePromptPlayer,
  // payout state
  payoutWinners,
  payoutTotalAmount,
  getFavoriteColor,
}) {
  const { progress } = usePanelProgress();
  const contentOpacity = Math.min(1, Math.max(0, (progress - 0.5) * 2));
  // Gate wheel spinning until panel is sufficiently visible
  const panelReady = progress >= 0.95;

  const { positionDraft, currentStage, raceResult } = gameState;

  const wheelSegmentColors = segments.map((seg) => seg.color ?? '#2a2410');
  const CASCADE_RESULT_HOLD_MS = 7000;

  return (
    <div style={{ ...s.root, opacity: contentOpacity }}>
      {elementType === 'vote' && (
        <div style={s.centeredWrap}>
          <VoteElement
            players={players}
            groupVote={groupVote}
            voteResult={voteResult}
            voteTimeLeft={voteTimeLeft}
            voteCounts={voteCounts}
            positionVote={positionVote}
            positionVoteResult={positionVoteResult}
            positionVoteTimeLeft={positionVoteTimeLeft}
          />
        </div>
      )}

      {elementType === 'payout' && (
        <div style={s.centeredWrap}>
          <PayoutElement winners={payoutWinners} raceResult={raceResult} getFavoriteColor={getFavoriteColor} payoutTotalAmount={payoutTotalAmount} />
        </div>
      )}

      {elementType === 'wheel' && (
        <div style={s.wheelPanel}>
          {(cascadeActive || segments.length > 0) ? (
            <>
              <div style={{ position: 'relative', width: 420, height: 420, flexShrink: 0 }}>
                {!cascadeActive ? (
                  <>
                    <div style={{ opacity: wheelOpacity, transition: 'opacity 400ms ease', position: 'absolute', inset: 0 }}>
                      <div className="wheel-spawn-in" key={`pos-spin-${wheelSpawnKey}`}>
                        <SpinningWheel
                          segments={segments}
                          targetIndex={targetIndex}
                          spinning={panelReady && spinning}
                          onSpinComplete={handleSpinComplete}
                          size={420}
                          highlightIndex={highlightIndex}
                          dimAmount={0.2}
                          segmentColors={wheelSegmentColors}
                        />
                      </div>
                    </div>
                    {pickerPlayer && (
                      <div style={{
                        position: 'absolute', inset: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        opacity: avatarOpacity,
                        transform: `scale(${avatarScale})`,
                        transition: 'opacity 500ms ease, transform 500ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                        pointerEvents: 'none',
                      }}>
                        <Avatar player={pickerPlayer} size={315} borderWidth={4} borderColor="#f0c040" style={{ boxShadow: '0 0 40px rgba(240,192,64,0.8)' }} getFavoriteColor={getFavoriteColor} />
                      </div>
                    )}
                  </>
                ) : (
                  <div style={s.cascadeWheelStage}>
                    <div className="wheel-spawn-in" key={`cascade-spin-${wheelSpawnKey}`} style={{ ...s.cascadeWheelFadeLayer, opacity: cascadeSpinResult ? 0 : 1 }}>
                      <div className={`cascade-wheel-pop${cascadeSpinning ? ' cascade-wheel-spinning' : ''}`} style={s.cascadeWheelRing}>
                        <SpinningWheel
                          segments={cascadeSpinData.segments}
                          targetIndex={cascadeSpinData.targetIndex}
                          spinning={panelReady && cascadeSpinning}
                          onSpinComplete={() => {
                            const finalTarget = cascadeSpinDataRef.current?.targetPosition ?? cascadeSpinData.targetPosition;
                            const spinToken = cascadeSpinDataRef.current?.token ?? cascadeSpinData.token;
                            setCascadeSpinning(false);
                            setCascadeSpinResult(finalTarget);
                            clearCascadeResultHoldTimeout();
                            cascadeResultHoldTimeoutRef.current = setTimeout(() => {
                              cascadeResultHoldTimeoutRef.current = null;
                              socket.emit('cascade-spin-complete', { token: spinToken });
                            }, CASCADE_RESULT_HOLD_MS);
                          }}
                          size={420}
                          segmentColors={cascadeSpinData.segmentColors}
                        />
                      </div>
                    </div>
                    <div style={{ ...s.cascadeResultLayer, opacity: cascadeSpinResult ? 1 : 0, pointerEvents: cascadeSpinResult ? 'auto' : 'none' }}>
                      <div style={cascadeSpinResult === 'DNF' ? s.cascadeResultBigDnf : s.cascadeResultBig} className={cascadeSpinResult === 'DNF' ? 'cascade-dnf-result-pulse' : undefined}>
                        <div style={cascadeSpinResult === 'DNF' ? s.cascadeResultValueDnf : s.cascadeResultValue}>
                          {cascadeSpinResult === 'DNF' ? 'DNF' : `#${cascadeSpinResult}`}
                        </div>
                        <div style={cascadeSpinResult === 'DNF' ? s.cascadeResultSublineDnf : s.cascadeResultSubline}>
                          {cascadeSpinResult === 'DNF' ? 'Confirmed DNF — chain ends here.' : cascadePromptPlayer ? `Swapped with ${cascadePromptPlayer.displayName}` : 'No swap. DNF locked in.'}
                        </div>
                        {cascadeSpinResult === 'DNF' && <div style={s.cascadeResultDnfLabel}>The cascade chain is over!</div>}
                        {cascadePromptPlayer && cascadeSpinResult !== 'DNF' && <div style={s.cascadeResultPrompt}>{cascadePromptPlayer.displayName} look at your phone!</div>}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {(spinContextLine1 || spinContextLine2) && (
                <div style={s.wheelContextBox} className="cascade-title-fade">
                  <div style={s.wheelContextTitle}>{wheelContextTitle}</div>
                  {spinContextLine1 && <div style={s.wheelContextLine1}>{spinContextLine1}</div>}
                  {spinContextLine2 && <div style={s.wheelContextLine2}>{spinContextLine2}</div>}
                </div>
              )}
              {pickerName && !spinning && !cascadeActive && (
                <div style={{ ...s.pickerLabel, opacity: avatarOpacity, transition: 'opacity 500ms ease' }}>
                  <span style={s.pickerArrow}>▶</span> {pickerName} — pick your position!
                </div>
              )}
            </>
          ) : (
            <div style={s.wheelDone}>All positions assigned!</div>
          )}

          {positionDraft && (
            <div style={s.positionGrid}>
              {Array.from({ length: 13 }, (_, i) => {
                const slot = i < 12 ? String(i + 1) : 'DNF';
                const slotOwners = players.filter((p) => Array.isArray(p.positions) && p.positions.includes(slot));
                return (
                  <div key={slot} style={{ ...s.positionCell, background: slotOwners.length > 0 ? '#1e3a2f' : '#1a1a1a' }}>
                    <div style={s.positionSlot}>{slot}</div>
                    <div style={s.positionOwner}>
                      {slotOwners.length > 0 ? (
                        <StackedAvatars players={slotOwners} size={32} maxDisplay={3} stackOffset={-10} getFavoriteColor={getFavoriteColor} />
                      ) : (
                        <div style={{ color: '#666', fontSize: 12 }}>—</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Styles ----------
const s = {
  root: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'stretch',
    transition: 'opacity 300ms ease',
  },
  centeredWrap: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
  },
  wheelPanel: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '20px 16px',
    overflowY: 'auto',
    gap: 16,
  },
  wheelContextBox: {
    width: '100%',
    maxWidth: 460,
    background: 'linear-gradient(180deg, rgba(16,22,31,0.95) 0%, rgba(11,16,24,0.98) 100%)',
    border: '1px solid #2c3b52',
    borderRadius: 10,
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    textAlign: 'center',
    boxShadow: '0 0 24px rgba(35,90,150,0.28)',
  },
  wheelContextTitle: { fontSize: 18, fontWeight: 'bold', color: '#dbe9ff', letterSpacing: 1.6 },
  wheelContextLine1: { fontSize: 14, color: '#a8cdf2', fontWeight: 'bold' },
  wheelContextLine2: { fontSize: 12, color: '#90a5c2' },
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
  wheelDone: { fontSize: 20, color: '#2ecc71', fontWeight: 'bold', marginTop: 40 },
  positionGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: 6,
    width: '100%',
    marginTop: 8,
    maxWidth: 400,
    margin: '8px auto 0',
  },
  positionCell: { borderRadius: 6, padding: '6px 4px', textAlign: 'center', border: '1px solid #333' },
  positionSlot: { fontSize: 13, fontWeight: 'bold', color: '#f0c040' },
  positionOwner: {
    fontSize: 11, color: '#ccc', marginTop: 4, minHeight: 34,
    display: 'flex', alignItems: 'center', justifyContent: 'center', wordBreak: 'break-word',
  },
  cascadeWheelStage: {
    position: 'absolute', inset: 0, background: 'transparent',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 10, border: 'none', boxShadow: 'none', zIndex: 20,
  },
  cascadeWheelRing: {
    width: 420, height: 420, borderRadius: '50%', border: '2px solid #2a3a50',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'radial-gradient(circle at 50% 50%, rgba(20,35,55,0.26) 0%, rgba(9,16,27,0.78) 100%)',
    overflow: 'hidden',
  },
  cascadeWheelFadeLayer: {
    position: 'absolute', inset: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'opacity 500ms ease',
  },
  cascadeResultLayer: {
    position: 'absolute', inset: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'opacity 500ms ease',
  },
  cascadeResultBig: {
    width: 420, height: 420, borderRadius: '50%',
    border: '4px solid rgba(115,205,255,0.78)',
    background: 'radial-gradient(circle at 50% 35%, rgba(35,79,124,0.9) 0%, rgba(11,22,37,0.98) 68%, rgba(6,10,16,1) 100%)',
    boxShadow: '0 0 46px rgba(64,170,255,0.36), inset 0 0 50px rgba(70,170,255,0.18)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 12, padding: '32px 40px', textAlign: 'center',
    transition: 'opacity 500ms ease, transform 500ms ease',
  },
  cascadeResultBigDnf: {
    width: 420, height: 420, borderRadius: '50%',
    border: '4px solid rgba(231,76,60,0.9)',
    background: 'radial-gradient(circle at 50% 35%, rgba(120,20,20,0.95) 0%, rgba(40,8,8,0.98) 68%, rgba(10,2,2,1) 100%)',
    boxShadow: '0 0 60px rgba(231,76,60,0.55), inset 0 0 50px rgba(180,30,30,0.25)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 12, padding: '32px 40px', textAlign: 'center',
    transition: 'opacity 500ms ease, transform 500ms ease',
  },
  cascadeResultValue: {
    fontSize: 86, fontWeight: 'bold', color: '#f8fbff', letterSpacing: 2,
    textShadow: '0 0 22px rgba(70,170,255,0.85)',
  },
  cascadeResultValueDnf: {
    fontSize: 100, fontWeight: 'bold', color: '#ff6b6b', letterSpacing: 3,
    textShadow: '0 0 32px rgba(231,76,60,1), 0 0 60px rgba(180,30,30,0.7)',
  },
  cascadeResultSubline: {
    fontSize: 22, fontWeight: 'bold', color: '#a9d8ff', lineHeight: 1.25,
    textShadow: '0 0 16px rgba(60,140,220,0.55)',
  },
  cascadeResultSublineDnf: {
    fontSize: 20, fontWeight: 'bold', color: '#ffaaaa', lineHeight: 1.25,
    textShadow: '0 0 14px rgba(231,76,60,0.6)',
  },
  cascadeResultDnfLabel: {
    fontSize: 15, fontWeight: 'bold', color: '#ff8888',
    textTransform: 'uppercase', letterSpacing: 1.5, opacity: 0.8,
  },
  cascadeResultPrompt: {
    fontSize: 18, fontWeight: 'bold', color: '#f0c040',
    textTransform: 'uppercase', letterSpacing: 1.2,
    textShadow: '0 0 14px rgba(240,192,64,0.5)',
  },
  votePanel: {
    background: '#0d0d2e', border: '2px solid #4444cc', borderRadius: 12,
    padding: '20px 28px', display: 'flex', flexDirection: 'column', gap: 12,
    boxShadow: '0 0 40px rgba(80,80,200,0.5)',
  },
  votePanelTitle: { fontSize: 22, fontWeight: 'bold', color: '#a0a0ff', textTransform: 'uppercase', letterSpacing: 1 },
  votePanelSub: { fontSize: 14, color: '#888' },
  votePanelTimerBarWrap: { height: 8, background: '#1a1a1a', borderRadius: 4, overflow: 'hidden' },
  votePanelTimerBarFill: { height: '100%', borderRadius: 4, transition: 'width 0.8s linear, background 0.3s' },
  votePanelTally: { display: 'flex', gap: 32, justifyContent: 'center', marginTop: 4 },
  votePanelTallyCell: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 },
  votePanelTallyCount: { fontSize: 40, fontWeight: 'bold', color: '#fff' },
  votePanelTallyLabel: { fontSize: 13, color: '#aaa', textTransform: 'uppercase', letterSpacing: 2 },
  votePanelVoters: { fontSize: 12, color: '#555', textAlign: 'right' },
  voteResultBanner: {
    background: '#0d2b1e', border: '2px solid #2ecc71', borderRadius: 10,
    padding: '16px 24px', fontSize: 18, color: '#2ecc71', textAlign: 'center',
    boxShadow: '0 0 30px rgba(46,204,113,0.4)',
  },
  payoutPanel: {
    width: '100%', maxWidth: 720,
    background: 'linear-gradient(180deg, rgba(35,28,12,0.96) 0%, rgba(18,14,8,0.98) 100%)',
    border: '2px solid #cba44a', borderRadius: 14, padding: '22px 24px',
    display: 'flex', flexDirection: 'column', gap: 12,
    boxShadow: '0 0 38px rgba(240,192,64,0.34)', alignItems: 'center', textAlign: 'center',
  },
  payoutTitle: {
    fontSize: 30, fontWeight: 'bold', color: '#f2d57a', letterSpacing: 1.8,
    textTransform: 'uppercase', textShadow: '0 0 18px rgba(240,192,64,0.45)',
  },
  payoutSubtitle: { fontSize: 15, color: '#e6d7b0' },
  payoutWinnersRow: { width: '100%', display: 'flex', alignItems: 'stretch', justifyContent: 'center', gap: 14, flexWrap: 'wrap' },
  payoutWinnerTile: {
    minWidth: 140, maxWidth: 180, display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: 8, padding: '10px 10px 8px', borderRadius: 10,
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(242,213,122,0.3)',
  },
  payoutWinnerName: { fontSize: 16, fontWeight: 'bold', color: '#f5e6bc' },
  payoutWinnerShare: {
    fontSize: 16, fontWeight: 'bold', color: '#2ecc71',
    textShadow: '0 0 10px rgba(46,204,113,0.6)',
  },
  payoutTotalDisplay: {
    textAlign: 'center',
    padding: '16px 28px',
    background: 'linear-gradient(180deg, rgba(40,28,6,0.97) 0%, rgba(20,14,2,0.99) 100%)',
    border: '1px solid #b8920a',
    borderRadius: 12,
    boxShadow: '0 0 48px rgba(240,192,64,0.4), inset 0 0 24px rgba(240,192,64,0.12)',
    width: '100%',
  },
  payoutTotalLabel: {
    fontSize: 11, letterSpacing: 2.5, color: '#b8920a',
    textTransform: 'uppercase', marginBottom: 6,
  },
  payoutTotalAmount: {
    fontSize: 52, fontWeight: 'bold', color: '#f0c040',
    textShadow: '0 0 24px rgba(240,192,64,0.75)',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1.1,
  },
  payoutSplitHint: { fontSize: 13, color: '#c8a830', marginTop: 6 },
  payoutOverflowText: { fontSize: 13, color: '#d8c58f', lineHeight: 1.3, maxWidth: '100%' },
};
