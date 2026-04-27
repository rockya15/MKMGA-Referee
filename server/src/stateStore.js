const fs = require('fs');
const path = require('path');

const stateDir = path.join(__dirname, '../data');
const stateFile = path.join(stateDir, 'game-state.json');
const raceSummaryFile = path.join(stateDir, 'latest-race-summary.txt');

function ensureDir() {
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
}

function formatMoney(value) {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

function saveRaceSummary(snapshot, options = {}) {
  try {
    ensureDir();

    const winners = Array.isArray(options.winners) ? options.winners : [];
    const players = Array.isArray(snapshot?.players) ? [...snapshot.players] : [];
    players.sort((a, b) => Number(b.balance ?? 0) - Number(a.balance ?? 0));

    const lines = [];
    lines.push('MKMGA RACE SUMMARY');
    lines.push(`Saved: ${new Date().toISOString()}`);
    lines.push(`Race Number: ${snapshot?.raceNumber ?? '?'}`);
    lines.push(`Result: ${snapshot?.raceResult ?? 'N/A'}`);
    lines.push(`Stage: ${snapshot?.currentStage ?? 'N/A'}`);
    lines.push(`Pot Remaining: ${formatMoney(snapshot?.pot ?? 0)}`);
    lines.push('');
    lines.push(`Winners (${winners.length}): ${winners.length ? winners.join(', ') : 'None'}`);
    lines.push('');
    lines.push('Players (sorted by balance):');

    players.forEach((player, index) => {
      const displayName = player.displayName ?? player.realName ?? 'Unknown';
      const delta = Number(player.balance ?? 0) - Number(player.startingBalance ?? 0);
      const statusFlags = [
        player.paidEntry ? 'PAID' : null,
        player.skippedRace ? 'SKIPPED' : null,
        player.folded ? 'FOLDED' : null,
        player.allIn ? 'ALL-IN' : null,
        player.connected === false ? 'DC' : null,
      ].filter(Boolean);

      lines.push(
        `${index + 1}. ${displayName} | balance=${formatMoney(player.balance)} | start=${formatMoney(player.startingBalance)} | net=${delta >= 0 ? '+' : ''}${formatMoney(delta).slice(1)} | in=${formatMoney(player.contributedThisRace)} | positions=${(player.positions ?? []).join(', ') || '-'}${statusFlags.length ? ` | ${statusFlags.join(' / ')}` : ''}`
      );
    });

    fs.writeFileSync(raceSummaryFile, `${lines.join('\n')}\n`, 'utf8');
  } catch (error) {
    console.warn('Failed to persist race summary:', error.message);
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
  saveState,
  saveRaceSummary,
  raceSummaryFile
};
