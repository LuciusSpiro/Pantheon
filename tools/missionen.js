'use strict';
// Review-Werkzeug für erzeugte Missionen (CONTRACT-S2 §8c) – npm run missionen -- <befehl>
//   liste                      Status, Titel, Quelle, Auftraggeber, gespielt (Standard ohne Befehl)
//   zeigen <ordner|name>       lesbare Fassung (mission.md) ausgeben; auch Archiv-Namen (archiv/<name>.md)
//   annehmen <ordner>          status: angenommen  -> gehört ab dem nächsten Serverstart zum Vorrat (Archiv)
//   ablehnen <ordner>          status: abgelehnt
//   offen <ordner>             status: offen (zurücksetzen)
//   md <ordner> | md --alle    Textfassung aus mission.json neu erzeugen (Status und Notizen bleiben)
//   md --archiv                Textfassung der Archiv-Missionen (content/spielleiter/archiv/<name>.md) neu erzeugen
// Optionen: --dir <pfad> (sonst ERZEUGT_DIR bzw. content/spielleiter/erzeugt), --archiv-dir <pfad>
// <ordner> darf abgekürzt werden, solange er eindeutig ist (z. B. nur die Kennung ohne Datum).

const fs = require('fs');
const path = require('path');
const Ablage = require('../server/mission/ablage.js');
const Archiv = require('../server/mission/archiv.js');

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const DIR = path.resolve(opt('--dir') || process.env.ERZEUGT_DIR || Ablage.DIR);
const ARCHIV_DIR = path.resolve(opt('--archiv-dir') || Archiv.DIR);
const cmd = args[0] || 'liste';
const arg = args[1];

function out(s) { process.stdout.write(s.endsWith('\n') ? s : s + '\n'); }
function die(msg, code) { out(msg); process.exit(code == null ? 1 : code); }
const pad = (s, n) => { const t = String(s == null ? '–' : s); return t.length >= n ? t.slice(0, n - 1) + '…' : t + ' '.repeat(n - t.length); };

function resolveFolder(name) {
  if (!name) die(`Ordner fehlt: npm run missionen -- ${cmd} <ordner>`);
  const rows = Ablage.list(DIR);
  const exact = rows.find((r) => r.ordner === name);
  if (exact) return exact.ordner;
  const hits = rows.filter((r) => r.ordner.includes(name));
  if (hits.length === 1) return hits[0].ordner;
  if (hits.length > 1) die(`'${name}' ist nicht eindeutig: ${hits.map((r) => r.ordner).join(', ')}`);
  return null;
}

switch (cmd) {
  case 'liste': {
    const rows = Ablage.list(DIR);
    out(`Erzeugte Missionen in ${path.relative(process.cwd(), DIR) || DIR}: ${rows.length}`);
    if (rows.length) {
      out(`${pad('Status', 11)} ${pad('Ordner', 40)} ${pad('Titel', 30)} ${pad('Quelle', 7)} ${pad('Von', 10)} Gespielt`);
      for (const r of rows) out(`${pad(r.status, 11)} ${pad(r.ordner, 40)} ${pad(r.titel, 30)} ${pad(r.quelle, 7)} ${pad(r.auftraggeber, 10)} ${r.gespielt}${r.ausgaenge && r.ausgaenge.length ? ' (' + r.ausgaenge.join(', ') + ')' : ''}${r.fehler ? '  ! ' + r.fehler : ''}`);
      const n = (s) => rows.filter((r) => r.status === s).length;
      out(`offen ${n('offen')} · angenommen ${n('angenommen')} · abgelehnt ${n('abgelehnt')}`);
    }
    let arch = [];
    try { arch = fs.readdirSync(ARCHIV_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')); } catch (e) { arch = []; }
    out(`Archiv (immer im Vorrat): ${arch.join(', ') || '–'}`);
    break;
  }
  case 'zeigen': {
    const o = resolveFolder(arg);
    let file = o ? path.join(DIR, o, 'mission.md') : null;
    if (!o) { const a = path.join(ARCHIV_DIR, `${arg}.md`); if (fs.existsSync(a)) file = a; }
    if (!file) die(`Keine Mission '${arg}' gefunden (npm run missionen -- liste).`);
    if (!fs.existsSync(file) && o) { const r = Ablage.rewrite(DIR, o); if (!r.ok) die('Textfassung nicht erzeugbar: ' + r.error); }
    out(fs.readFileSync(file, 'utf8'));
    break;
  }
  case 'annehmen': case 'ablehnen': case 'offen': {
    const o = resolveFolder(arg);
    if (!o) die(`Keine Mission '${arg}' gefunden (npm run missionen -- liste).`);
    const status = cmd === 'annehmen' ? 'angenommen' : (cmd === 'ablehnen' ? 'abgelehnt' : 'offen');
    const r = Ablage.setStatus(DIR, o, status);
    if (!r.ok) die('Fehler: ' + r.error);
    out(`${o}: status ${status}${status === 'angenommen' ? ' – gehört ab dem nächsten Serverstart zum Vorrat' : ''}`);
    break;
  }
  case 'md': {
    if (arg === '--archiv') {
      const res = Ablage.writeArchivMarkdown(ARCHIV_DIR);
      for (const r of res) out(r.ok ? `${r.name}: ${path.relative(process.cwd(), r.file)}${r.fehler ? ` (${r.fehler} Prüferfehler)` : ''}` : `${r.name}: Fehler ${r.error}`);
      process.exit(res.every((r) => r.ok) ? 0 : 1);
    }
    const list = arg === '--alle' ? Ablage.list(DIR).map((r) => r.ordner) : [resolveFolder(arg)];
    if (list.some((x) => !x)) die(`Keine Mission '${arg}' gefunden (npm run missionen -- liste).`);
    let bad = 0;
    for (const o of list) { const r = Ablage.rewrite(DIR, o); if (!r.ok) bad++; out(`${o}: ${r.ok ? 'mission.md neu geschrieben' : 'Fehler ' + r.error}`); }
    if (!list.length) out('Keine erzeugten Missionen.');
    process.exit(bad ? 1 : 0);
    break;
  }
  default:
    die('Befehle: liste | zeigen <ordner> | annehmen <ordner> | ablehnen <ordner> | offen <ordner> | md <ordner>|--alle|--archiv', 2);
}
