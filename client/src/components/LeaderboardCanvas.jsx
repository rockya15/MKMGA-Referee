import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import * as PIXI from 'pixi.js';

// ── Layout constants (must match LeaderboardPanel) ─────────────────────────
const ROW_H       = 56;
const CARD_RADIUS = 6;
const CARD_PAD_H  = 14;
const AVATAR_SZ   = 40;
const RANK_W      = 28;
const EL_GAP      = 10;
const BALANCE_ZONE = 104; // px reserved on right for balance text + ticker width

const WHEEL_STAGES = ['POSITION_ASSIGNMENT'];

// ── Pure helpers (duplicated from LeaderboardPanel) ────────────────────────
function isTokenSpentThisRace(player) {
  return Boolean(player?.skippedRace || player?.folded);
}

function isEliminatedPlayer(player) {
  if (!player) return false;
  if (
    player.eliminationState === 'pending_resurrection' ||
    player.eliminationState === 'failed_resurrection'
  ) return true;
  return Number(player.balance) <= 0 && !player.paidEntry;
}

function stripBotSuffix(name) {
  return String(name ?? '').replace(/\s*\(BOT\)\s*$/i, '').trim();
}

function isBotPlayer(player) {
  if (!player) return false;
  if (Boolean(player.isBot)) return true;
  const id = String(player.id ?? '').toLowerCase();
  const realName = String(player.realName ?? '').toLowerCase();
  return id.startsWith('bot-') || realName.startsWith('bot_');
}

function getPlayerDisplayName(player) {
  const base = player?.displayName ?? player?.realName ?? String(player?.id ?? '');
  return stripBotSuffix(base);
}

// ── Async texture cache ────────────────────────────────────────────────────
const _texCache = new Map(); // url → Promise<PIXI.Texture|null>

function loadTexture(url) {
  if (_texCache.has(url)) return _texCache.get(url);
  const p = PIXI.Assets.load(url).catch(() => null);
  _texCache.set(url, p);
  return p;
}

// ── Badge layout constants ─────────────────────────────────────────────────
const BADGE_PAD_H  = 6;
const BADGE_PAD_V  = 2;
const BADGE_RADIUS = 4;
const BADGE_FONT   = 10;
const BADGE_GAP    = 4;

// ── CardObject ─────────────────────────────────────────────────────────────
class CardObject {
  constructor(app) {
    this._app       = app;
    this._destroyed = false;
    this._avatarUrl = undefined; // undefined = never attempted

    this.container = new PIXI.Container();
    this.container.sortableChildren = true;

    // BG
    this.bg = new PIXI.Graphics();
    this.bg.zIndex = 0;
    this.container.addChild(this.bg);

    // Rank text
    this.rankText = new PIXI.Text('', {
      fontSize: 13, fill: '#666666',
      fontFamily: '"Segoe UI", Arial, sans-serif',
    });
    this.rankText.zIndex = 1;
    this.container.addChild(this.rankText);

    // Avatar fallback circle
    this.avatarFallback = new PIXI.Graphics();
    this.avatarFallback.zIndex = 1;
    this.container.addChild(this.avatarFallback);

    // Avatar initial letter (shown over fallback circle)
    this.avatarInitial = new PIXI.Text('', {
      fontSize: 15, fontWeight: 'bold', fill: '#ffffff',
      fontFamily: '"Segoe UI", Arial, sans-serif',
    });
    this.avatarInitial.zIndex = 2;
    this.container.addChild(this.avatarInitial);

    // Avatar sprite + mask + ring (created on texture load)
    this.avatarSprite = null;
    this.avatarMask   = null;
    this.avatarRing   = null;

    // Player name
    this.nameText = new PIXI.Text('', {
      fontSize: 15, fontWeight: 'bold', fill: '#ffffff',
      fontFamily: '"Segoe UI", Arial, sans-serif',
    });
    this.nameText.zIndex = 1;
    this.container.addChild(this.nameText);

    // BOT badge near name
    this.botBadgeCont = new PIXI.Container();
    this.botBadgeCont.zIndex = 2;
    this.container.addChild(this.botBadgeCont);

    // Balance text (rendered directly in card layer)
    this.balanceText = new PIXI.Text('', {
      fontSize: 15,
      fontWeight: 'bold',
      fill: '#2ecc71',
      fontFamily: '"Segoe UI", Arial, sans-serif',
    });
    this.balanceText.zIndex = 2;
    this.container.addChild(this.balanceText);

    // Badges container (rebuilt on each update)
    this.badgeCont = new PIXI.Container();
    this.badgeCont.zIndex = 2;
    this.container.addChild(this.badgeCont);

    app.stage.addChild(this.container);
  }

  setY(y)       { if (!this._destroyed) this.container.y = Math.round(y); }
  setZIndex(z)  { if (!this._destroyed) this.container.zIndex = z; }
  setVisible(v) { if (!this._destroyed) this.container.visible = v; }

  // ── Full update ──────────────────────────────────────────────────────────
  update(row, cardWidth, opts) {
    if (this._destroyed) return;

    const { player, podiumTier, rank, dimmed, rowIndex } = row;
    const {
      activeTimer, wheelFocusPlayerId, currentStage,
      getFavoriteColor, playerTransitions,
    } = opts;

    const ws            = WHEEL_STAGES;
    const isOnClock     = activeTimer?.playerId === player.id;
    const timerUrgent   = isOnClock && activeTimer.timeLeft <= 10;
    const isWheelFocus  = ws.includes(currentStage) && wheelFocusPlayerId === player.id;
    const tokenSpent    = isTokenSpentThisRace(player);
    const rowDimmed     = dimmed || tokenSpent;
    const rowElim       = isEliminatedPlayer(player);
    const isPodium      = podiumTier !== null;
    const transition    = playerTransitions?.[player.id];
    const showAnnounce  = transition?.phase === 'announcing';
    const podiumFill    = '#0e0c08';

    // ── Background ──────────────────────────────────────────────────────────
    this.bg.clear();

    let bgFill;
    if (isPodium) {
      bgFill = podiumTier === 'gold'   ? 0xc79c35
             : podiumTier === 'silver' ? 0x8c94a0
             :                          0x945a28;
    } else {
      bgFill = isOnClock     ? (timerUrgent ? 0x2a0000 : 0x001a0a)
             : isWheelFocus  ? 0x2a2410
             : rowElim       ? 0x1a0000
             : rowDimmed     ? 0x161616
             : rowIndex % 2 === 0 ? 0x151515 : 0x1c1c1c;
    }

    let borderColor = null;
    if (isPodium) {
      borderColor = podiumTier === 'gold'   ? 0xf2d57a
                  : podiumTier === 'silver' ? 0xb8c4d0
                  :                          0xc47c30;
    } else if (isOnClock) {
      borderColor = timerUrgent ? 0xe74c3c : 0x2ecc71;
    } else if (isWheelFocus) {
      borderColor = 0xf0c040;
    } else if (rowDimmed) {
      borderColor = 0x2b2b2b;
    }

    if (borderColor !== null) this.bg.lineStyle(1, borderColor, 1);
    this.bg.beginFill(bgFill);
    this.bg.drawRoundedRect(0, 0, cardWidth, ROW_H, CARD_RADIUS);
    this.bg.endFill();

    // Transition overlay — drawn in bg layer so cards below are dimmed
    if (showAnnounce) {
      this.bg.lineStyle(0);
      this.bg.beginFill(0x000000, 0.75);
      this.bg.drawRoundedRect(0, 0, cardWidth, ROW_H, CARD_RADIUS);
      this.bg.endFill();
    }

    this.container.alpha = rowElim ? 0.4 : rowDimmed ? 0.7 : 1;

    // ── Rank ────────────────────────────────────────────────────────────────
    this.rankText.style.fill = isPodium ? podiumFill : '#666666';
    this.rankText.text = rank !== null ? `#${rank}` : '...';
    this.rankText.x = CARD_PAD_H;
    this.rankText.y = Math.round(ROW_H / 2 - this.rankText.height / 2);

    // ── Avatar ──────────────────────────────────────────────────────────────
    const avatarX  = CARD_PAD_H + RANK_W + EL_GAP;
    const avatarY  = Math.round(ROW_H / 2 - AVATAR_SZ / 2);
    const favColor = getFavoriteColor?.(player) ?? '#2a2a4a';

    if (player.profileImageUrl !== this._avatarUrl) {
      this._loadAvatar(player, avatarX, avatarY, favColor);
    }

    // ── Name ────────────────────────────────────────────────────────────────
    const nameX   = avatarX + AVATAR_SZ + EL_GAP;
    const rawName = getPlayerDisplayName(player);
    const showBot = isBotPlayer(player);
    this.nameText.style.fill = isPodium ? podiumFill : (rowDimmed ? '#999999' : '#ffffff');
    this.nameText.text = rawName;
    this.nameText.x = nameX;
    this.nameText.y = Math.round(ROW_H / 2 - this.nameText.height / 2);

    // Truncate name if it would overlap badges / balance zone
    const botReserve = showBot ? 38 : 0;
    const maxNameEnd = cardWidth - BALANCE_ZONE - CARD_PAD_H - botReserve;
    if (this.nameText.x + this.nameText.width > maxNameEnd) {
      let truncated = rawName;
      while (truncated.length > 1 && nameX + this.nameText.width > maxNameEnd) {
        truncated = truncated.slice(0, -1);
        this.nameText.text = truncated + '\u2026';
      }
    }

    this.botBadgeCont.removeChildren();
    if (showBot) {
      const txt = new PIXI.Text('BOT', {
        fontSize: 10,
        fontWeight: 'bold',
        fill: '#69d394',
        fontFamily: 'Arial, sans-serif',
      });
      const bw = txt.width + 10;
      const bh = txt.height + 4;
      const rect = new PIXI.Graphics();
      rect.beginFill(0x173f2a);
      rect.drawRoundedRect(0, 0, bw, bh, 3);
      rect.endFill();
      txt.x = 5;
      txt.y = 2;
      this.botBadgeCont.addChild(rect);
      this.botBadgeCont.addChild(txt);
      this.botBadgeCont.x = this.nameText.x + this.nameText.width + 6;
      this.botBadgeCont.y = Math.round(ROW_H / 2 - bh / 2);
    }

    // ── Balance ─────────────────────────────────────────────────────────────
    const numericBalance = Number(player.balance) || 0;
    this.balanceText.text = `$${numericBalance.toFixed(2)}`;
    this.balanceText.style.fill = isPodium ? podiumFill : '#2ecc71';
    this.balanceText.x = cardWidth - CARD_PAD_H - this.balanceText.width;
    this.balanceText.y = Math.round(ROW_H / 2 - this.balanceText.height / 2);

    // ── Badges ──────────────────────────────────────────────────────────────
    this._updateBadges(row, opts, cardWidth, isPodium, podiumFill);
  }

  // ── Badge rendering ──────────────────────────────────────────────────────
  _updateBadges(row, opts, cardWidth, isPodium, podiumFill) {
    const { player } = row;
    const { activeTimer, wheelFocusPlayerId, currentStage } = opts;
    const isOnClock    = activeTimer?.playerId === player.id;
    const timerUrgent  = isOnClock && activeTimer.timeLeft <= 10;
    const isWheelFocus = WHEEL_STAGES.includes(currentStage) && wheelFocusPlayerId === player.id;
    const tokenSpent   = isTokenSpentThisRace(player);
    const tokenLabel   = tokenSpent
      ? (player.skippedRace ? 'SKIPPED' : player.folded ? 'FOLDED' : 'SKIPPED')
      : (!player.skipFoldTokenAvailable ? 'NO TOKEN' : null);
    const noReviveLabel = (player.noRevive || player.eliminationState === 'failed_resurrection')
      ? 'NO REVIVE' : null;

    this.badgeCont.removeChildren();

    const badges = [];
    if (isOnClock) badges.push({
      text: `${activeTimer.timeLeft}s`,
      bg: timerUrgent ? 0x2a0000 : 0x001a0a,
      color: timerUrgent ? '#e74c3c' : '#2ecc71',
      border: timerUrgent ? 0xe74c3c : 0x2ecc71,
    });
    if (isWheelFocus && !isOnClock) badges.push({
      text: 'FOCUS', bg: null, color: '#f0c040', border: 0xf0c040,
    });
    if (tokenLabel) badges.push({
      text: tokenLabel,
      bg:    isPodium ? 0x3e3210 : 0x5a1a1a,
      color: isPodium ? podiumFill : '#ff6666',
      border: null,
    });
    if (noReviveLabel) badges.push({
      text: noReviveLabel,
      bg:    isPodium ? 0x3e3210 : 0x4a3412,
      color: isPodium ? podiumFill : '#f0c040',
      border: null,
    });

    if (!badges.length) return;

    // Layout right-to-left before the balance zone
    let xRight = cardWidth - BALANCE_ZONE - CARD_PAD_H;

    for (let i = badges.length - 1; i >= 0; i--) {
      const b    = badges[i];
      const wrap = new PIXI.Container();
      const txt  = new PIXI.Text(b.text, {
        fontSize: BADGE_FONT, fill: b.color,
        fontFamily: 'Arial, sans-serif', fontWeight: 'bold',
      });
      const bw = txt.width  + BADGE_PAD_H * 2;
      const bh = txt.height + BADGE_PAD_V * 2;

      if (b.bg !== null) {
        const rect = new PIXI.Graphics();
        rect.beginFill(b.bg);
        rect.drawRoundedRect(0, 0, bw, bh, BADGE_RADIUS);
        rect.endFill();
        wrap.addChild(rect);
      }
      if (b.border !== null) {
        const bord = new PIXI.Graphics();
        bord.lineStyle(1, b.border);
        bord.drawRoundedRect(0, 0, bw, bh, BADGE_RADIUS);
        wrap.addChild(bord);
      }
      txt.x = BADGE_PAD_H;
      txt.y = BADGE_PAD_V;
      wrap.addChild(txt);

      wrap.x = xRight - bw;
      wrap.y = Math.round(ROW_H / 2 - bh / 2);
      this.badgeCont.addChild(wrap);
      xRight = xRight - bw - BADGE_GAP;
    }
  }

  // ── Avatar loading ───────────────────────────────────────────────────────
  _loadAvatar(player, x, y, favColor) {
    this._avatarUrl = player.profileImageUrl;

    // Teardown old sprite
    if (this.avatarSprite) { this.avatarSprite.destroy(); this.avatarSprite = null; }
    if (this.avatarMask)   { this.avatarMask.destroy();   this.avatarMask   = null; }
    if (this.avatarRing)   { this.avatarRing.destroy();   this.avatarRing   = null; }

    // Draw color fallback immediately
    this._drawFallback(player, x, y, favColor);

    if (!player.profileImageUrl) return;

    loadTexture(player.profileImageUrl).then((tex) => {
      if (this._destroyed || this._avatarUrl !== player.profileImageUrl || !tex) return;

      // Replace fallback with real sprite
      this.avatarFallback.clear();
      this.avatarInitial.text = '';

      const sprite = new PIXI.Sprite(tex);
      sprite.width  = AVATAR_SZ;
      sprite.height = AVATAR_SZ;
      sprite.x = x;
      sprite.y = y;
      sprite.zIndex = 1;

      const mask = new PIXI.Graphics();
      mask.beginFill(0xffffff);
      mask.drawCircle(x + AVATAR_SZ / 2, y + AVATAR_SZ / 2, AVATAR_SZ / 2);
      mask.endFill();
      sprite.mask = mask;

      const ring = new PIXI.Graphics();
      const colorNum = parseInt(favColor.replace('#', ''), 16);
      ring.lineStyle(2, isNaN(colorNum) ? 0x555555 : colorNum);
      ring.drawCircle(x + AVATAR_SZ / 2, y + AVATAR_SZ / 2, AVATAR_SZ / 2);
      ring.zIndex = 3;

      this.avatarSprite = sprite;
      this.avatarMask   = mask;
      this.avatarRing   = ring;

      if (!this._destroyed) {
        this.container.addChild(mask, sprite, ring);
      }
    });
  }

  _drawFallback(player, x, y, favColor) {
    this.avatarFallback.clear();
    const colorNum = parseInt(favColor.replace('#', ''), 16);
    this.avatarFallback.beginFill(isNaN(colorNum) ? 0x2a2a4a : colorNum);
    this.avatarFallback.drawCircle(x + AVATAR_SZ / 2, y + AVATAR_SZ / 2, AVATAR_SZ / 2);
    this.avatarFallback.endFill();

    const initial = (getPlayerDisplayName(player) || '?')[0]?.toUpperCase() ?? '?';
    this.avatarInitial.text = initial;
    this.avatarInitial.x = x + AVATAR_SZ / 2 - this.avatarInitial.width  / 2;
    this.avatarInitial.y = y + AVATAR_SZ / 2 - this.avatarInitial.height / 2;
  }

  destroy() {
    this._destroyed = true;
    this.container.destroy({ children: true });
  }
}

// ── LeaderboardCanvas ──────────────────────────────────────────────────────
const LeaderboardCanvas = forwardRef(function LeaderboardCanvas(
  { totalHeight, cardWidth, visualYRef, stickyPlayerId },
  ref,
) {
  const canvasRef      = useRef(null);
  const appRef         = useRef(null);
  const cardsRef       = useRef(new Map()); // id → CardObject
  const prevStickyRef  = useRef(null);

  // ── Mount Pixi App ────────────────────────────────────────────────────────
  useEffect(() => {
    const app = new PIXI.Application({
      view:            canvasRef.current,
      width:           cardWidth,
      height:          Math.max(1, totalHeight),
      backgroundAlpha: 0,
      antialias:       true,
      resolution:      window.devicePixelRatio || 1,
      autoDensity:     true,
    });
    appRef.current = app;

    // Each Pixi tick: read shared visualYRef and position all containers
    app.ticker.add(() => {
      const yMap = visualYRef.current;
      cardsRef.current.forEach((card, id) => {
        const y = yMap.get(id);
        if (y !== undefined) card.setY(y);
      });
    });

    return () => {
      app.destroy(false);
      appRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Resize when dimensions change ─────────────────────────────────────────
  useEffect(() => {
    const app = appRef.current;
    if (!app) return;
    app.renderer.resize(cardWidth, Math.max(1, totalHeight));
  }, [totalHeight, cardWidth]);

  // ── Sticky player visibility ──────────────────────────────────────────────
  useEffect(() => {
    const prev = prevStickyRef.current;
    if (prev && prev !== stickyPlayerId) {
      cardsRef.current.get(prev)?.setVisible(true);
    }
    if (stickyPlayerId) {
      cardsRef.current.get(stickyPlayerId)?.setVisible(false);
    }
    prevStickyRef.current = stickyPlayerId;
  }, [stickyPlayerId]);

  // ── Imperative API ─────────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    syncCards(rows, opts) {
      const app = appRef.current;
      if (!app) return;

      const incoming = new Set(rows.map((r) => r.id));

      // Remove stale cards
      cardsRef.current.forEach((card, id) => {
        if (!incoming.has(id)) {
          card.destroy();
          cardsRef.current.delete(id);
        }
      });

      // Create or update
      rows.forEach((row) => {
        let card = cardsRef.current.get(row.id);
        if (!card) {
          card = new CardObject(app);
          cardsRef.current.set(row.id, card);
          // Seed initial Y so the card appears in-place before the ticker runs
          const initY = visualYRef.current.get(row.id) ?? row.targetY ?? 0;
          card.setY(initY);
        }
        card.update(row, opts.cardWidth ?? cardWidth, opts);
        // Always hard-sync Y on each data sync to avoid transient stacking at
        // y=0 when rows are added in batches before ticker settles.
        const syncedY = visualYRef.current.get(row.id) ?? row.targetY ?? 0;
        card.setY(syncedY);
        // Mirror current sticky state
        card.setVisible(row.id !== opts.stickyPlayerId);
      });
    },
    setCardPosition(id, y, zIndex = 0) {
      const card = cardsRef.current.get(id);
      if (!card) return;
      card.setY(y);
      card.setZIndex(zIndex);
    },
  }), [cardWidth, visualYRef]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
    />
  );
});

export default LeaderboardCanvas;
