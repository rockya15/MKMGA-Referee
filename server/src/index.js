const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

process.on('uncaughtException', (err) => {
  console.error('[CRASH] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[CRASH] Unhandled Promise Rejection:', reason);
});

const { GameState, STAGES } = require('./gameState');
const BettingEngine = require('./bettingEngine');
const TimerManager = require('./timerManager');
const stateStore = require('./stateStore');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Initialize game components
const gameState = new GameState();
const persistedSnapshot = stateStore.loadState();
if (persistedSnapshot) {
  gameState.hydrate(persistedSnapshot);
}
const bettingEngine = new BettingEngine(gameState);
const timerManager = new TimerManager(
  io,
  gameState,
  bettingEngine,
  // onVoteResolved
  () => {
    emitGameState();
    maybeStartNextBettingTimer();
  },
  // onPositionTimeout — receives all positions to assign at once (voted or random)
  (playerId, assignedPositions) => {
    // Auto-resolve any pending cascade chain before processing the timeout
    gameState.clearPendingCascade();

    let phaseComplete = false;
    let phaseResult = null;

    for (const pos of assignedPositions) {
      const result = gameState.assignPositionWithOptions(playerId, pos, { cascade: false });
      if (result.error) break;
      if (result.complete) {
        phaseComplete = true;
        phaseResult = gameState.completePositionAssignment();
        break;
      }
    }

    if (phaseComplete) {
      if (phaseResult && !phaseResult.skippedBetting) {
        bettingEngine.initializeBetting();
      }
      emitGameState();
      maybeStartNextBettingTimer();
    } else {
      // More players still need to pick — wheel will re-spin, spin-complete starts timer
      emitGameState();
    }
  }
);

function sanitizePlayerForClient(player) {
  const { passwordHash, salt, ...rest } = player;
  return rest;
}

function getClientGameState() {
  const snapshot = gameState.toSnapshot();
  return {
    ...snapshot,
    players: snapshot.players.map(sanitizePlayerForClient)
  };
}

function emitGameState() {
  stateStore.saveState(gameState.toSnapshot());
  io.emit('game-state', getClientGameState());
}

function maybeStartNextBettingTimer() {
  if (gameState.currentStage !== STAGES.BETTING) {
    timerManager.clearTimer();
    return;
  }

  const nextPlayerId = bettingEngine.getCurrentActor();
  if (nextPlayerId) {
    timerManager.startTimer(nextPlayerId, 60, 'betting');
  } else {
    timerManager.clearTimer();
  }
}

function maybeStartPositionTimer() {
  if (gameState.currentStage !== STAGES.POSITION_ASSIGNMENT) return;
  const draft = gameState.positionDraft;
  if (!draft) return;
  const currentPickerId = gameState.wheelOrder?.[draft.currentPlayerIndex];
  if (currentPickerId) {
    timerManager.startTimer(currentPickerId, 30, 'position');
  }
}

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads/player-images');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  }
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../../client/dist'))); // Assuming client build
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// API routes
app.post('/api/upload-profile', (req, res) => {
  upload.single('profileImage')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large. Maximum size is 5MB.' });
      }
      return res.status(400).json({ error: 'Upload failed.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    res.json({ imageUrl: `/uploads/player-images/${req.file.filename}` });
  });
});

// Socket.io connection
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Send current game state
  socket.emit('game-state', getClientGameState());

  // Handle player join (new registration, lobby only)
  socket.on('join', (data) => {
    const result = gameState.addOrRejoinPlayer(socket.id, data || {});
    if (result.error) {
      socket.emit('join-error', result.error);
      return;
    }
    emitGameState();
  });

  // Handle player reconnect (any stage, password-verified)
  socket.on('reconnect-player', (data) => {
    const result = gameState.reconnectPlayer(socket.id, data?.realName, data?.password);
    if (result.error) {
      socket.emit('join-error', result.error);
      return;
    }
    emitGameState();
  });

  socket.on('pre-bet-choice', (data) => {
    const choice = String(data?.choice || '').toUpperCase();
    const result = gameState.applyPreBetChoice(socket.id, choice);
    if (result.error) {
      socket.emit('error', result.error);
      return;
    }
    emitGameState();
  });

  socket.on('position-select', (data) => {
    const position = String(data?.position || '');
    const result = gameState.assignPositionWithOptions(socket.id, position, {
      cascade: Boolean(data?.cascade)
    });
    if (result.error) {
      socket.emit('error', result.error);
      return;
    }

    // Emit cascade spin event BEFORE game state so HostView can animate first
    if (result.cascade) {
      const cascade = result.cascade;
      const initiator = gameState.getPlayerById(socket.id);
      console.log('[CASCADE] Emitting cascade-spin:', { targetPosition: cascade.finalPosition, mode: cascade.mode, level: cascade.level, dnfSlots: cascade.dnfSlots, roll: cascade.roll });
      io.emit('cascade-spin', {
        targetPosition: cascade.finalPosition,
        mode: cascade.mode,
        level: cascade.level,
        dnfSlots: cascade.dnfSlots,
        roll: cascade.roll,
        initiatorName: initiator?.displayName ?? 'Unknown',
        forcedDnf: cascade.forcedDnf ?? false,
      });
    }

    if (result.complete) {
      timerManager.clearTimer();
      const phaseResult = gameState.completePositionAssignment();
      if (!phaseResult.skippedBetting) {
        bettingEngine.initializeBetting();
        emitGameState();
        maybeStartNextBettingTimer();
      } else {
        emitGameState();
      }
    } else {
      // Check if the same player still has more picks remaining
      const draft = gameState.positionDraft;
      const currentPickerId = gameState.wheelOrder?.[draft?.currentPlayerIndex];
      if (currentPickerId === socket.id) {
        // Still their turn — extend the timer by 10 seconds
        timerManager.addTime(10);
      } else {
        // Turn passed to next player — kill the old timer so it doesn't fire
        // while the wheel is spinning. Timer restarts after 'spin-complete'.
        timerManager.clearTimer();
      }
      emitGameState();
    }
  });

  // Handle betting actions
  socket.on('betting-action', (data) => {
    const result = bettingEngine.processAction(socket.id, data.action, data.amount);
    if (result.error) {
      socket.emit('error', result.error);
    } else {
      emitGameState();
      maybeStartNextBettingTimer();
    }
  });

  socket.on('group-vote', (data) => {
    const result = timerManager.submitVote(socket.id, data?.action);
    if (result.error) {
      socket.emit('error', result.error);
    }
  });

  // Position draft timeout vote
  socket.on('position-vote', (data) => {
    const result = timerManager.submitPositionVote(socket.id, data?.position);
    if (result.error) {
      socket.emit('error', result.error);
    }
  });

  // HostView emits this when the wheel animation finishes — start the picker's timer now
  socket.on('spin-complete', () => {
    if (gameState.currentStage === STAGES.POSITION_ASSIGNMENT) {
      maybeStartPositionTimer();
    }
  });

  // Displaced player's response to an active cascade chain
  socket.on('cascade-response', (data) => {
    const doCascade = Boolean(data?.cascade);
    const result = gameState.respondToDisplacedCascade(socket.id, doCascade);
    if (result.error) {
      socket.emit('error', result.error);
      return;
    }

    // Emit cascade spin event before game state update
    if (result.cascaded && result.outcome) {
      const outcome = result.outcome;
      const responder = gameState.getPlayerById(socket.id);
      console.log('[CASCADE] Emitting cascade-spin (response):', { targetPosition: outcome.finalPosition, mode: outcome.mode, level: outcome.level, dnfSlots: outcome.dnfSlots, roll: outcome.roll });
      io.emit('cascade-spin', {
        targetPosition: outcome.finalPosition,
        mode: outcome.mode,
        level: outcome.level,
        dnfSlots: outcome.dnfSlots,
        roll: outcome.roll,
        initiatorName: responder?.displayName ?? 'Unknown',
        forcedDnf: false,
      });
    }

    if (result.complete) {
      timerManager.clearTimer();
      const phaseResult = gameState.completePositionAssignment();
      if (!phaseResult.skippedBetting) {
        bettingEngine.initializeBetting();
        emitGameState();
        maybeStartNextBettingTimer();
      } else {
        emitGameState();
      }
    } else {
      emitGameState();
    }
  });

  // Handle host actions
  socket.on('host-action', (data) => {
    let result = { success: true };
    switch (data.action) {
      case 'open-lobby':
        result = gameState.openLobby(data.maxCashCap);
        break;
      case 'start-game':
        result = gameState.startPreBet();
        break;
      case 'start-position-assignment':
        if (!gameState.allPreBetChoicesSubmitted()) {
          result = { error: 'Waiting for all active players to choose PAY or SKIP.' };
          break;
        }
        result = gameState.startPositionAssignment();
        if (result.success && result.preserved) {
          const phaseResult = gameState.completePositionAssignment();
          if (!phaseResult.skippedBetting) {
            bettingEngine.initializeBetting();
          }
        } else if (result.success) {
          // Timer starts when HostView emits 'spin-complete' after the wheel animation finishes
        }
        break;
      case 'next-race':
        result = gameState.nextRace();
        break;
      case 'record-race-result':
        result = gameState.settleRace(String(data.placement));
        break;
      case 'reset-game': {
        timerManager.clearTimer();
        result = gameState.resetGame();
        // Clear persisted state
        stateStore.saveState(gameState.toSnapshot());
        // Delete all uploaded player images
        try {
          const files = fs.readdirSync(uploadsDir);
          for (const file of files) {
            fs.unlinkSync(path.join(uploadsDir, file));
          }
        } catch (_) { /* non-fatal */ }
        break;
      }
      default:
        result = { error: 'Unknown host action.' };
        break;
    }

    if (result.error) {
      socket.emit('error', result.error);
      return;
    }

    emitGameState();
    maybeStartNextBettingTimer();
  });

  // Handle race complete from sidecar
  socket.on('race-complete', (data) => {
    const result = gameState.settleRace(String(data.placement));
    if (result.error) {
      socket.emit('error', result.error);
      return;
    }
    emitGameState();
    maybeStartNextBettingTimer();
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    gameState.markDisconnected(socket.id);
    emitGameState();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  // If the server restarted mid-game, resume the active timer so players
  // don't get stuck waiting forever with no countdown.
  const stage = gameState.currentStage;
  if (stage === STAGES.BETTING) {
    console.log('[Startup] Resuming betting timer after restart…');
    maybeStartNextBettingTimer();
  } else if (stage === STAGES.POSITION_ASSIGNMENT) {
    console.log('[Startup] Resuming position timer after restart…');
    maybeStartPositionTimer();
  }
});