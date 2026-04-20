const fs = require('fs');
const path = require('path');

const stateDir = path.join(__dirname, '../data');
const stateFile = path.join(stateDir, 'game-state.json');

function ensureDir() {
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
}

function loadState() {
  try {
    if (!fs.existsSync(stateFile)) {
      return null;
    }
    const raw = fs.readFileSync(stateFile, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    console.warn('Failed to load persisted state:', error.message);
    return null;
  }
}

function saveState(snapshot) {
  try {
    ensureDir();
    const tmpPath = `${stateFile}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), 'utf8');
    fs.renameSync(tmpPath, stateFile);
  } catch (error) {
    console.warn('Failed to persist state:', error.message);
  }
}

module.exports = {
  loadState,
  saveState
};
