const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

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
const timerManager = new TimerManager(io, gameState, bettingEngine);

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
    timerManager.startTimer(nextPlayerId);
  } else {
    timerManager.clearTimer();
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
app.post('/api/upload-profile', upload.single('profileImage'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  res.json({ imageUrl: `/uploads/player-images/${req.file.filename}` });
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

    if (result.complete) {
      const phaseResult = gameState.completePositionAssignment();
      if (!phaseResult.skippedBetting) {
        bettingEngine.initializeBetting();
      }
    }

    emitGameState();
    maybeStartNextBettingTimer();
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
});