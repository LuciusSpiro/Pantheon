'use strict';
// Tests des Review-Werkzeugs für Mitschnitte (MIT-01 Paket D) – npm run test:mitschnitt-werkzeug.
// Offline; schreibt nur in ein mkdtemp-Verzeichnis (nie nach content/ oder data/ des Repos).
//   1 liste (Spalten, Sortierung, Filter)   2 zeigen (Lauf, Mission, Teilstring, mehrdeutig, unbekannt)
//   3 bewerten (gültig, ungültig, nie status)   4 Bewertung überlebt schreibeLauf   5 Wurzel fehlt/leer   6 Hilfe

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const R = require('../server/telemetrie/mitschnitt-render.js');
const FIX = path.join(__dirname, 'fixtures', 'mitschnitt', 'beispiel.verlauf.json');
const TOOL = path.join(__dirname, 'mitschnitt.js');

const results = [];
const check = (name, cond, detail) => { results.push({ name, ok: !!cond, detail }); };
const verlauf = () => JSON.parse(fs.readFileSync(FIX, 'utf8'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-mitschnitt-werkzeug-'));
const REPO_DATA = path.join(ROOT, 'data', 'mitschnitt');
const repoBefore = fs.existsSync(REPO_DATA) ? fs.readdirSync(REPO_DATA).sort().join(',') : '';

const env = { ...process.env }; delete env.MITSCHNITT_DIR;
function werkzeug(args, extraEnv) {
  const r = cp.spawnSync(process.execPath, [TOOL, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 60000, env: { ...env, ...(extraEnv || {}) } });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '', text: (r.stdout || '') + (r.stderr || '') };
}
const frontmatter = (t) => (/^---\r?\n([\s\S]*?)\r?\n---/.exec(t) || [])[1] || '';

// Wurzel mit zwei Läufen (altes Datum, neues Datum)
const wurzel = path.join(TMP, 'mit');
const NEU = '2026-11-08_spiel-faden', ALT = '2026-10-01_alt-lauf';
const v = verlauf();
const mission = v.gruppen.find((g) => g.art === 'mission');
const szene = v.gruppen.find((g) => g.art === 'szene');
R.schreibeLauf(v, path.join(wurzel, NEU), { jetzt: '2026-11-08T10:00:00Z' });
const v2 = verlauf(); v2.lauf.id = 'alt-lauf';
R.schreibeLauf(v2, path.join(wurzel, ALT), { jetzt: '2026-10-01T10:00:00Z' });
const mdDatei = (lauf, teil) => {
  const ord = fs.readdirSync(path.join(wurzel, lauf)).find((n) => n.includes(teil) && fs.existsSync(path.join(wurzel, lauf, n, 'mission.md')));
  return path.join(wurzel, lauf, ord, 'mission.md');
};
const mFile = mdDatei(NEU, mission.kennung);

// 1 liste
{
  const r = werkzeug(['liste', '--dir', wurzel]);
  check('liste: Exit 0', r.code === 0, r.text);
  check('liste: Kopf mit Spalten', /Lauf\s+Nr\s+Titel\s+Art\s+Ausgang\s+Bewertung\s+Einträge/.test(r.out), r.out);
  check('liste: beide Läufe, je Mission eine Zeile', (r.out.match(new RegExp(NEU, 'g')) || []).length === v.gruppen.length && (r.out.match(new RegExp(ALT, 'g')) || []).length === v.gruppen.length, r.out);
  check('liste: neuester Lauf zuerst', r.out.indexOf(NEU) >= 0 && r.out.indexOf(NEU) < r.out.indexOf(ALT));
  check('liste: Titel, Art und Ausgang der Mission', r.out.includes(String(mission.titel).slice(0, 20)) && /mission/.test(r.out) && r.out.includes(String(mission.ausgang).slice(0, 8)), r.out);
  const mz = r.out.split('\n').find((z) => z.startsWith(NEU) && z.includes(String(mission.titel).slice(0, 20))) || '';
  check('liste: Einträge der Mission gezählt', mz.trim().endsWith(String(v.eintraege.filter((e) => e.nr >= mission.von_nr && e.nr <= mission.bis_nr).length)), mz);
  check('liste ohne Befehl wie liste', werkzeug(['--dir', wurzel]).out === r.out);
  const f = werkzeug(['liste', '--dir', wurzel, '--lauf', 'alt-lauf']);
  check('liste --lauf filtert', f.code === 0 && f.out.includes(ALT) && !f.out.includes(NEU), f.out);
  const o = werkzeug(['liste', '--dir', wurzel, '--bewertung', 'gut']);
  check('liste --bewertung gut: keine Treffer, Exit 0', o.code === 0 && !o.out.includes(NEU), o.text);
  const bad = werkzeug(['liste', '--dir', wurzel, '--bewertung', 'super']);
  check('liste --bewertung ungültig: Exit 1 mit erlaubten Werten', bad.code === 1 && /offen, gut, schwach, verwerfen/.test(bad.text), bad.text);
  const viaEnv = werkzeug(['liste'], { MITSCHNITT_DIR: wurzel });
  check('MITSCHNITT_DIR lenkt um', viaEnv.code === 0 && viaEnv.out.includes(NEU), viaEnv.text);
}

// 2 zeigen
{
  const lauf = werkzeug(['zeigen', NEU, '--dir', wurzel]);
  check('zeigen Lauf: index.md', lauf.code === 0 && lauf.out.trim() === fs.readFileSync(path.join(wurzel, NEU, 'index.md'), 'utf8').trim(), lauf.text.slice(0, 200));
  const teil = werkzeug(['zeigen', 'spiel-faden', '--dir', wurzel]);
  check('zeigen Lauf per Teilstring', teil.code === 0 && teil.out.trim() === lauf.out.trim());
  const ord = path.basename(path.dirname(mFile));
  const m = werkzeug(['zeigen', `${NEU}/${ord}`, '--dir', wurzel]);
  check('zeigen Mission: mission.md', m.code === 0 && m.out.trim() === fs.readFileSync(mFile, 'utf8').trim() && m.out.includes('## Zeitleiste'), m.text.slice(0, 200));
  const mt = werkzeug(['zeigen', `spiel-faden/${ord}`, '--dir', wurzel]);
  check('zeigen Mission per Teilstring mit Lauf', mt.code === 0 && mt.out.trim() === m.out.trim(), mt.text.slice(0, 200));
  const mk = werkzeug(['zeigen', `${NEU}/${ord.replace(/^\d+_/, '')}`, '--dir', wurzel]);
  check('zeigen Mission per Kennung ohne Nummer', mk.code === 0 && mk.out.trim() === m.out.trim(), mk.text.slice(0, 200));
  const mehr = werkzeug(['zeigen', mission.kennung, '--dir', wurzel]);
  check('zeigen mehrdeutig: Exit 1 mit Kandidaten', mehr.code === 1 && mehr.err.includes('nicht eindeutig') && mehr.err.includes(NEU) && mehr.err.includes(ALT), mehr.text);
  const mehrL = werkzeug(['zeigen', '2026-', '--dir', wurzel]);
  check('zeigen mehrdeutiger Lauf: Exit 1 mit Kandidaten', mehrL.code === 1 && mehrL.err.includes(NEU) && mehrL.err.includes(ALT), mehrL.text);
  const nix = werkzeug(['zeigen', 'gibtsnicht', '--dir', wurzel]);
  check('zeigen unbekannt: Exit 1', nix.code === 1 && /gefunden/.test(nix.err), nix.text);
  check('zeigen ohne Name: Exit 1', werkzeug(['zeigen', '--dir', wurzel]).code === 1);
}

// 3 bewerten
{
  const ziel = `${NEU}/${path.basename(path.dirname(mFile))}`;
  const vorher = fs.readFileSync(mFile, 'utf8');
  const r = werkzeug(['bewerten', ziel, 'gut', '--dir', wurzel]);
  const nachher = fs.readFileSync(mFile, 'utf8');
  check('bewerten gut: Exit 0, Frontmatter gesetzt', r.code === 0 && /^bewertung: gut$/m.test(frontmatter(nachher)), r.text);
  check('bewerten: kein status im Frontmatter', !/^status:/m.test(frontmatter(nachher)));
  check('bewerten: Rest unverändert', nachher.replace(/^bewertung: gut$/m, 'bewertung: offen') === vorher);
  const l = werkzeug(['liste', '--dir', wurzel, '--bewertung', 'gut']);
  check('liste --bewertung gut zeigt die Mission', l.out.includes(NEU) && !l.out.includes(ALT) && l.out.split('\n').filter((z) => z.startsWith(NEU)).length === 1, l.out);
  const off = werkzeug(['liste', '--dir', wurzel, '--bewertung', 'offen']);
  check('liste --bewertung offen zeigt den Rest', off.out.includes(ALT) && off.out.split('\n').filter((z) => z.startsWith(NEU)).length === v.gruppen.length - 1, off.out);
  const bad = werkzeug(['bewerten', ziel, 'mittel', '--dir', wurzel]);
  check('bewerten ungültig: Exit 1 mit erlaubten Werten, Datei unverändert', bad.code === 1 && /offen, gut, schwach, verwerfen/.test(bad.err) && fs.readFileSync(mFile, 'utf8') === nachher, bad.text);
  check('bewerten ohne Wert: Exit 1', werkzeug(['bewerten', ziel, '--dir', wurzel]).code === 1);
  check('bewerten mehrdeutig: Exit 1', werkzeug(['bewerten', mission.kennung, 'schwach', '--dir', wurzel]).code === 1);
  check('bewerten unbekannt: Exit 1', werkzeug(['bewerten', 'gibtsnicht', 'gut', '--dir', wurzel]).code === 1);
  check('bewerten per Lauf-Ordner nicht möglich: Exit 1', werkzeug(['bewerten', NEU, 'gut', '--dir', wurzel]).code === 1);
  for (const w of ['schwach', 'verwerfen', 'offen']) {
    const x = werkzeug(['bewerten', ziel, w, '--dir', wurzel]);
    check(`bewerten ${w}`, x.code === 0 && new RegExp(`^bewertung: ${w}$`, 'm').test(frontmatter(fs.readFileSync(mFile, 'utf8'))), x.text);
  }
  werkzeug(['bewerten', ziel, 'schwach', '--dir', wurzel]);
}

// 4 Bewertung und Notizen überleben schreibeLauf
{
  const text = fs.readFileSync(mFile, 'utf8');
  fs.writeFileSync(mFile, text.replace(/\s+$/, '') + '\n\nMeine Anmerkung zum Review.\n');
  R.schreibeLauf(verlauf(), path.join(wurzel, NEU), { jetzt: '2026-11-08T11:00:00Z' });
  const nach = fs.readFileSync(mdDatei(NEU, mission.kennung), 'utf8');
  check('nach schreibeLauf: bewertung schwach bleibt', /^bewertung: schwach$/m.test(frontmatter(nach)));
  check('nach schreibeLauf: Notiz bleibt', nach.includes('Meine Anmerkung zum Review.'));
  check('nach schreibeLauf: kein status', !/^status:/m.test(frontmatter(nach)));
  const andere = fs.readFileSync(mdDatei(NEU, szene.kennung), 'utf8');
  check('andere Mission bleibt offen', /^bewertung: offen$/m.test(frontmatter(andere)));
}

// 5 Wurzel fehlt / leer
{
  const fehlt = path.join(TMP, 'gibtsnicht');
  const a = werkzeug(['liste', '--dir', fehlt]);
  check('Wurzel fehlt: liste verständlich, Exit 0, kein Absturz', a.code === 0 && /Keine Mitschnitte/.test(a.out) && !/at .*\.js:\d+/.test(a.text), a.text);
  check('Wurzel fehlt: Ordner wird nicht angelegt', !fs.existsSync(fehlt));
  const leer = path.join(TMP, 'leer'); fs.mkdirSync(leer);
  const b = werkzeug(['liste', '--dir', leer]);
  check('Wurzel leer: liste verständlich, Exit 0', b.code === 0 && /Keine Mitschnitte/.test(b.out), b.text);
  const c = werkzeug(['zeigen', 'x', '--dir', leer]);
  check('Wurzel leer: zeigen Exit 1 mit Meldung ohne Absturz', c.code === 1 && /Keine Mitschnitte/.test(c.err) && !/at .*\.js:\d+/.test(c.err), c.text);
  const d = werkzeug(['bewerten', 'x', 'gut', '--dir', fehlt]);
  check('Wurzel fehlt: bewerten Exit 1 mit Meldung', d.code === 1 && /Keine Mitschnitte/.test(d.err), d.text);
}

// 6 Hilfe, unbekannter Befehl
{
  const h = werkzeug(['--help']);
  check('--help: Exit 0, deutsch, nennt Befehle', h.code === 0 && /liste/.test(h.out) && /zeigen/.test(h.out) && /bewerten/.test(h.out) && /Optionen/.test(h.out), h.text);
  const u = werkzeug(['quatsch', '--dir', wurzel]);
  check('unbekannter Befehl: Exit 1', u.code === 1 && /Unbekannter Befehl/.test(u.err), u.text);
}
check('Repo bleibt sauber (data/mitschnitt unverändert)', (fs.existsSync(REPO_DATA) ? fs.readdirSync(REPO_DATA).sort().join(',') : '') === repoBefore);

fs.rmSync(TMP, { recursive: true, force: true });
let bad = 0;
for (const r of results) { if (!r.ok) { bad++; console.log(`✗ ${r.name}${r.detail ? ' – ' + String(r.detail).slice(0, 300) : ''}`); } }
console.log(`${results.length - bad}/${results.length} Prüfungen ok`);
process.exit(bad ? 1 : 0);
