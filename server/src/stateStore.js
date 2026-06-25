const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

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

function buildRaceXlsxBuffer(snapshot, options = {}) {
  const winners = Array.isArray(options.winners) ? options.winners : [];
  const players = Array.isArray(snapshot?.players) ? [...snapshot.players] : [];
  players.sort((a, b) => Number(b.balance ?? 0) - Number(a.balance ?? 0));
  const raceLog = Array.isArray(snapshot?.raceLog) ? snapshot.raceLog : [];

  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Summary ──────────────────────────────────────────────────────
  const summaryRows = [
    ['Field', 'Value'],
    ['Saved At', new Date().toISOString()],
    ['Race Number', snapshot?.raceNumber ?? '?'],
    ['Stage', snapshot?.currentStage ?? 'N/A'],
    ['Race Result', snapshot?.raceResult ?? 'N/A'],
    ['Pot Remaining', Number(snapshot?.pot ?? 0)],
    ['Races Logged', raceLog.length],
    ['Winners (last race)', winners.length ? winners.join(', ') : 'None'],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = [{ wch: 22 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  // ── Sheet 2: Leaderboard ──────────────────────────────────────────────────
  const lbHeader = ['Rank', 'Display Name', 'Real Name', 'Balance ($)', 'Starting Balance ($)', 'Net Change ($)', 'Status'];
  const lbRows = players.map((p, i) => {
    const balance = Number(p.balance ?? 0);
    const start   = Number(p.startingBalance ?? 0);
    const net     = balance - start;
    const statusFlags = [
      p.eliminationState === 'failed_resurrection' ? 'ELIMINATED (no revive)' : null,
      p.eliminationState === 'pending_resurrection' ? 'ELIMINATED' : null,
      p.connected === false ? 'DISCONNECTED' : null,
      p.noRevive ? 'NO REVIVE' : null,
    ].filter(Boolean);
    return [i + 1, p.displayName ?? p.realName ?? 'Unknown', p.realName ?? '', balance, start, net, statusFlags.join(', ') || 'Active'];
  });
  const wsLeaderboard = XLSX.utils.aoa_to_sheet([lbHeader, ...lbRows]);
  wsLeaderboard['!cols'] = [6, 22, 22, 14, 20, 14, 24].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, wsLeaderboard, 'Leaderboard');

  // ── Sheet 3: Race History (one row per player per race) ───────────────────
  if (raceLog.length > 0) {
    const histHeader = [
      'Race #', 'Result', 'Entry Fee ($)', 'Pot ($)',
      'Player', 'Balance Before ($)', 'Balance After ($)', 'Net This Race ($)',
      'Positions', 'Contributed ($)', 'Action', 'Won?',
    ];
    const histRows = [];
    raceLog.forEach((entry) => {
      const raceNum    = entry.raceNumber ?? '?';
      const result     = entry.raceResult ?? '?';
      const entryFee   = entry.entryFee === 'ALL_IN' ? 'ALL IN' : Number(entry.entryFee ?? 0);
      const pot        = Number(entry.potBeforePayout ?? 0);
      (entry.players ?? []).forEach((p) => {
        const before = Number(p.balanceBefore ?? 0);
        const after  = Number(p.balanceAfter ?? 0);
        const action = p.skippedRace ? 'Skipped'
          : p.folded   ? 'Folded'
          : p.allIn    ? 'All In'
          : p.paidEntry ? 'Paid'
          : 'Skipped';
        histRows.push([
          raceNum, result, entryFee, pot,
          p.displayName ?? 'Unknown',
          before, after, after - before,
          (p.positions ?? []).join(', ') || '-',
          Number(p.contributedThisRace ?? 0),
          action,
          p.won ? 'YES' : '',
        ]);
      });
    });
    const wsHistory = XLSX.utils.aoa_to_sheet([histHeader, ...histRows]);
    wsHistory['!cols'] = [8, 10, 14, 10, 22, 18, 16, 16, 16, 18, 10, 8].map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, wsHistory, 'Race History');
  }

  // ── Sheet 4: Balance by Race (pivot — players as columns) ─────────────────
  if (raceLog.length > 0) {
    const allPlayerNames = [...new Set(raceLog.flatMap((e) => (e.players ?? []).map((p) => p.displayName ?? 'Unknown')))];
    const pivotHeader = ['Race #', 'Result', ...allPlayerNames];
    const pivotRows = raceLog.map((entry) => {
      const byName = new Map((entry.players ?? []).map((p) => [p.displayName ?? 'Unknown', p.balanceAfter ?? 0]));
      return [entry.raceNumber ?? '?', entry.raceResult ?? '?', ...allPlayerNames.map((name) => (byName.has(name) ? Number(byName.get(name)) : ''))];
    });
    const wsPivot = XLSX.utils.aoa_to_sheet([pivotHeader, ...pivotRows]);
    wsPivot['!cols'] = [8, 10, ...allPlayerNames.map(() => 14)].map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, wsPivot, 'Balance by Race');
  }

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
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
  buildRaceXlsxBuffer,
  raceSummaryFile
};
