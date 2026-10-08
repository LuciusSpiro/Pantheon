'use strict';
// Kampagnen-Protokoll (data/campaign.json). Nur protokollierend – jede Partie startet frisch.
// Atomar: in temporäre Datei schreiben, dann umbenennen.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'campaign.json');
const MAX_RUNS = 50;

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return { runs: [] }; }
}

function writeAtomic(obj) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

// entry: { startedAt, endedAt?, players, stats, flags, teaser, worldId (S1: Weltstand der Kampagne oder null) }
// Weltstände selbst liegen nicht hier, sondern in server/weltstand.js (WORLD_DIR).
function logRun(entry, opts) {
  if (opts && opts.disabled) return;
  try {
    const data = read();
    if (!Array.isArray(data.runs)) data.runs = [];
    const idx = data.runs.findIndex((r) => r.id === entry.id);
    if (idx >= 0) data.runs[idx] = entry; else data.runs.push(entry);
    if (data.runs.length > MAX_RUNS) data.runs = data.runs.slice(-MAX_RUNS);
    data.updatedAt = new Date().toISOString();
    writeAtomic(data);
  } catch (e) {
    console.warn('[Pantheon] campaign.json nicht geschrieben:', e.message);
  }
}

module.exports = { logRun, read, FILE };
