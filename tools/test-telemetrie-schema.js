'use strict';
// TEL-01 B: Schema-Test und Namenstest ueber volle Bot-Laeufe (Boden: Grabenangriff zu dritt, Raum: Kampagne zu dritt), Protokoll in einen Ordner ausserhalb des Repos.
//   node tools/test-telemetrie-schema.js  (npm run test:telemetrie-schema)
// Prueft: jeder vorkommende Typ steht in server/telemetrie/schema.js, jede Zeile hat nur Felder aus dem Schema, jedes Feld ist flach (Zahl, Text, Wahrheitswert, null, Liste
// davon <= 64; nur der Sessionkopf darf verschachtelt sein), die Zeitreihe traegt alle ihre Felder, Kopf/Ende je Datei, Fehler und verworfene Zeilen 0,
// jeder Schema-Typ der Pakete kommt mindestens einmal vor (oder steht in NUR_IM_MENSCHENSPIEL, dann prueft ihn ein Test mit gescriptetem Spiel), und im ganzen Ordner
// (inkl. tuning) kommt kein Name und keine clientId der Bots vor (Ada, Bo, Cem, sim-<n>).
// Wer ein Paket ergaenzt (B1: Schuss, Treffer, Kill, Szenen ...), traegt seine Typen in SCHEMA ein und in PAKET_TYPEN.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { SCHEMA } = require('../server/telemetrie/schema.js');

const PAKET_TYPEN = {
  B2: ['buchung', 'deckung', 'energie', 'konsole', 'loeschen', 'reparatur', 'zeitreihe', 'zone_wieder'],
};
// Nur im Menschenspiel (bzw. nur mit Weltsim/LLM) erreichbar, nicht im Bot-Lauf: getestet in tools/test-telemetrie-b2.js mit gescriptetem Spiel.
const NUR_IM_MENSCHENSPIEL = ['ruf', 'spielleiter_warten'];
const KOPF = ['v', 'typ', 'sitzung', 'tick', 't'];
const BOT_NAMEN = ['Ada', 'Bo', 'Cem'];

let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-schema-'));
const flach = (v) => v === null || typeof v === 'boolean' || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
const alle = (d, out) => { if (!fs.existsSync(d)) return out; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) alle(f, out); else out.push(f); } return out; };

function lauf(name, args) {
  return new Promise((resolve) => {
    const dir = path.join(root, name);
    const p = spawn(process.execPath, [path.join(__dirname, 'sim-headless.js'), ...args], { env: Object.assign({}, process.env, { TELEMETRIE: 'an', TELEMETRIE_DIR: dir }), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ name, dir, code, out }));
  });
}

(async () => {
  console.log('Bot-Laeufe (Grabenangriff zu dritt, Kampagne zu dritt) mit Protokoll');
  const t0 = Date.now();
  const L = await Promise.all([lauf('graben', ['graben', '--players', '3', '--seed', '1']), lauf('raum', ['3', '--seed', '7'])]);
  for (const l of L) ok(l.code === 0, `${l.name}: Bot-Lauf Exit ${l.code} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);

  const gesehen = new Set(); const fremdeTypen = new Set(); const fremdeFelder = new Set(); const unflach = []; let zeilenGesamt = 0, bytesGesamt = 0, dauerGesamt = 0;
  for (const l of L) {
    const fl = alle(l.dir, []).filter((f) => f.endsWith('.jsonl'));
    ok(fl.length === 1, `${l.name}: genau eine Protokolldatei (${fl.length})`);
    for (const f of fl) {
      const text = fs.readFileSync(f, 'utf8');
      const z = text.split('\n').filter(Boolean).map(JSON.parse);
      zeilenGesamt += z.length; bytesGesamt += Buffer.byteLength(text);
      ok(z[0].typ === 'kopf' && z[z.length - 1].typ === 'session_ende', `${l.name}: erste Zeile kopf, letzte session_ende`);
      const ende = z[z.length - 1];
      dauerGesamt += ende.dauer || 0;
      ok(ende.fehler === 0 && ende.verworfen === 0, `${l.name}: Fehler ${ende.fehler}, verworfen ${ende.verworfen}`);
      for (const x of z) {
        gesehen.add(x.typ);
        const s = SCHEMA[x.typ];
        if (!s) { fremdeTypen.add(x.typ); continue; }
        for (const k of Object.keys(x)) {
          if (KOPF.includes(k)) continue;
          if (!s.felder.includes(k)) fremdeFelder.add(x.typ + '.' + k);
          if (s.flach !== false && !(Array.isArray(x[k]) ? x[k].length <= 64 && x[k].every(flach) : flach(x[k]))) unflach.push(x.typ + '.' + k);
        }
        if (x.typ === 'zeitreihe') for (const k of s.felder) if (!(k in x)) fremdeFelder.add('zeitreihe fehlt ' + k);
      }
    }
    // Namenstest ueber den ganzen Ordner inkl. tuning
    const dateien = alle(l.dir, []);
    let treffer = 0;
    for (const f of dateien) {
      const t = fs.readFileSync(f, 'utf8');
      for (const n of BOT_NAMEN) if (t.includes('"' + n + '"')) { treffer++; console.log('    Treffer Name', n, 'in', path.basename(f)); }
      if (/sim-\d/.test(t)) { treffer++; console.log('    Treffer clientId in', path.basename(f)); }
    }
    ok(dateien.length >= 2 && treffer === 0, `${l.name}: Namenstest 0 Treffer in ${dateien.length} Dateien (Ordner inkl. tuning)`);
  }
  ok(fremdeTypen.size === 0, 'jeder vorkommende Typ steht im Schema' + (fremdeTypen.size ? ': ' + [...fremdeTypen].join(',') : ''));
  ok(fremdeFelder.size === 0, 'jede Zeile hat nur Felder aus dem Schema (Zeitreihe vollstaendig)' + (fremdeFelder.size ? ': ' + [...fremdeFelder].join(',') : ''));
  ok(unflach.length === 0, 'alle Felder flach' + (unflach.length ? ': ' + [...new Set(unflach)].join(',') : ''));
  for (const [paket, typen] of Object.entries(PAKET_TYPEN)) {
    const fehlt = typen.filter((t) => !gesehen.has(t) && !NUR_IM_MENSCHENSPIEL.includes(t));
    ok(fehlt.length === 0 && typen.every((t) => SCHEMA[t]), `Paket ${paket}: jeder Typ kommt vor${fehlt.length ? ' – fehlt: ' + fehlt.join(',') : ''}`);
  }
  ok(NUR_IM_MENSCHENSPIEL.every((t) => SCHEMA[t]), 'Nur-im-Menschenspiel-Typen stehen im Schema (' + NUR_IM_MENSCHENSPIEL.join(', ') + ')');
  console.log(`  Info: ${zeilenGesamt} Zeilen, ${(bytesGesamt / 1048576).toFixed(2)} MB, ${(zeilenGesamt / (dauerGesamt / 60)).toFixed(0)} Zeilen/min, ${(bytesGesamt / 1048576 / (dauerGesamt / 3600)).toFixed(1)} MB/h Spielzeit`);

  try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { /* egal */ }
  console.log(fails ? `\n${fails} FEHLER` : '\nTELEMETRIE SCHEMA OK');
  process.exit(fails ? 1 : 0);
})();
