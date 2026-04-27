const fs = require('fs');
const path = require('path');

const stateDir = path.join(__dirname, '../data');
const stateFile = path.join(stateDir, 'game-state.json');
const raceSummaryFile = path.join(stateDir, 'latest-race-summary.txt');
const raceArchiveRootDir = path.join(__dirname, '../../exports/race-archives');

function ensureDir() {
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
}

function formatMoney(value) {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

function buildRaceSummaryLines(snapshot, options = {}) {
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

  return lines;
}

function buildArchiveFolderName(snapshot) {
  const now = new Date();
  const pad2 = (n) => String(n).padStart(2, '0');
  const pad3 = (n) => String(n).padStart(3, '0');
  const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}-${pad3(now.getMilliseconds())}`;
  const race = Number.isFinite(Number(snapshot?.raceNumber)) ? Number(snapshot.raceNumber) : 'x';
  const stage = String(snapshot?.currentStage || 'unknown').toLowerCase();
  return `race-${race}-${stage}-${stamp}`;
}

function saveRaceSummary(snapshot, options = {}) {
  try {
    ensureDir();
    const lines = buildRaceSummaryLines(snapshot, options);

    fs.writeFileSync(raceSummaryFile, `${lines.join('\n')}\n`, 'utf8');
  } catch (error) {
    console.warn('Failed to persist race summary:', error.message);
  }
}

function saveRaceArchive(snapshot, options = {}) {
  try {
    ensureDir();
    fs.mkdirSync(raceArchiveRootDir, { recursive: true });

    const folderName = buildArchiveFolderName(snapshot);
    const archiveDir = path.join(raceArchiveRootDir, folderName);
    fs.mkdirSync(archiveDir, { recursive: false });

    const summaryLines = buildRaceSummaryLines(snapshot, options);
    const summaryPath = path.join(archiveDir, 'race-summary.txt');
    const snapshotPath = path.join(archiveDir, 'game-state-snapshot.json');
    const metadataPath = path.join(archiveDir, 'metadata.json');

    fs.writeFileSync(summaryPath, `${summaryLines.join('\n')}\n`, 'utf8');
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf8');
    fs.writeFileSync(metadataPath, JSON.stringify({
      savedAt: new Date().toISOString(),
      raceNumber: snapshot?.raceNumber ?? null,
      stage: snapshot?.currentStage ?? null,
      raceResult: snapshot?.raceResult ?? null,
      winners: Array.isArray(options.winners) ? options.winners : [],
    }, null, 2), 'utf8');

    return {
      success: true,
      archiveDir,
      folderName,
    };
  } catch (error) {
    console.warn('Failed to persist race archive:', error.message);
    return { error: 'Failed to save race archive.' };
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
  saveRaceArchive,
  raceSummaryFile
};
