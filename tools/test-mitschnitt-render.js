'use strict';
// Tests des Mitschnitt-Renderers (MIT-01 Paket B, CONTRACT-MIT01.md) – npm run test:mitschnitt-render.
// Reine Funktionen und Ablage; schreibt nur in ein mkdtemp-Verzeichnis (nie nach content/ oder data/ des Repos).
//   1 Pflichtabschnitte, Frontmatter (nie status)     5 schreibeLauf: Dateien, idempotent
//   2 Reihenfolge nach nr, Optionen und Wahl, Bot-Regel 6 Bewertung und Notizen überleben (auch bei Umnummerierung)
//   3 künstlich-Hinweis, Heuristik-Hinweis             7 unbekannte Art, kein Namensfilter, Index
//   4 rein und deterministisch                          8 ablage.js unverändert im Verhalten

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const R = require('../server/telemetrie/mitschnitt-render.js');
const MD = require('../server/mission/md-ablage.js');
const Ablage = require('../server/mission/ablage.js');
const FIX = path.join(__dirname, 'fixtures', 'mitschnitt', 'beispiel.verlauf.json');

const results = [];
const check = (name, cond, detail) => { results.push({ name, ok: !!cond, detail }); };
const clone = (o) => JSON.parse(JSON.stringify(o));
const verlauf = () => clone(JSON.parse(fs.readFileSync(FIX, 'utf8')));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-mitschnitt-render-'));
const tmp = (n) => { const d = path.join(TMP, n); fs.mkdirSync(d, { recursive: true }); return d; };
const read = (f) => fs.readFileSync(f, 'utf8');
const frontmatter = (t) => (/^---\n([\s\S]*?)\n---/.exec(t) || [])[1] || '';
const REPO_DATA = path.join(ROOT, 'data', 'mitschnitt');
const repoBefore = fs.existsSync(REPO_DATA) ? fs.readdirSync(REPO_DATA).sort().join(',') : '';

const v = verlauf();
const mission = v.gruppen.find((g) => g.art === 'mission');
const szene = v.gruppen.find((g) => g.art === 'szene');
const md = R.renderMission(v, mission);

// 1 Pflichtabschnitte, Frontmatter
for (const h of ['## Anlass', '## Zeitleiste', '## Funk- und Anzeigetexte', '## Optionen und Wahl', '## Folgen', '## Beteiligte NSC', '## Modellweg', '## Prüfer-Warnungen', '## Notizen']) {
  check(`mission.md hat Abschnitt ${h}`, md.includes('\n' + h), h);
}
const fm = frontmatter(md);
for (const k of ['titel', 'kennung', 'lauf', 'seed', 'crew', 'quelle', 'werkzeug', 'bot_regel', 'ausgang', 'verlauf_kuenstlich', 'bewertung']) {
  check(`Frontmatter hat ${k}`, new RegExp('^' + k + ':', 'm').test(fm), k);
}
check('Frontmatter: bewertung offen', /^bewertung: offen$/m.test(fm));
check('Frontmatter enthält nie status (mission.md, Szene, Index)', !/^status:/m.test(fm) && !/^status:/m.test(frontmatter(R.renderMission(v, szene))) && !/^status:/m.test(frontmatter(R.renderIndex(v))));
check('Review-Hinweiszeile', /^> Review:/m.test(md));
check('Anlass aus plan', md.includes('Ein Konvoi bei Speculum wird bedrängt.') && md.includes('b_notruf, b_geleit'));
check('Szene ohne Plan: Anlass-Platzhalter, Modell-Platzhalter', R.renderMission(v, szene).includes('_Kein Plan erfasst._') && R.renderMission(v, szene).includes('_Kein Modell beteiligt'));

// 2 Reihenfolge, Optionen, Wahl, Bot-Regel
{
  const z = md.slice(md.indexOf('## Zeitleiste'), md.indexOf('## Funk- und Anzeigetexte'));
  const nrs = [...z.matchAll(/^\| \d+:\d\d \| (\d+) \|/gm)].map((m) => +m[1]);
  check('Zeitleiste nach nr aufsteigend, nur Gruppe', nrs.length === 14 && nrs.every((n, i) => i === 0 || n > nrs[i - 1]) && nrs[0] === 3 && nrs[13] === 16, nrs.join(','));
  const shuffled = clone(v); shuffled.eintraege.reverse();
  check('Eingabereihenfolge egal (Sortierung nach nr)', R.renderMission(shuffled, mission) === md);
  check('Zeitleiste: Funk mit Sprecher und Volltext', z.includes('**Quintus Serran:** Freunde! Könnt ihr uns bei Speculum decken? Danke.') && z.includes('**ODA:** Sprung nach Speculum'));
  const w = md.slice(md.indexOf('## Optionen und Wahl'), md.indexOf('## Folgen'));
  check('Optionsliste vollständig', w.includes('o1: Wir kommen.') && w.includes('o2: Keine Zeit.') && w.includes('o3: Später.'));
  check('gewählte Option hervorgehoben, andere nicht', w.includes('- **o1: Wir kommen.** ← gewählt') && w.includes('- o2: Keine Zeit.') && !w.includes('**o2'));
  check('Bot-Regel neben der Wahl', w.includes('Wahlregel des Bots:') && w.includes('Brett: annehmen; Bitte: erste Option') && w.indexOf('Wahlregel') > w.indexOf('← gewählt'));
  const ohneRegel = clone(v); ohneRegel.lauf.regel = ''; ohneRegel.lauf.quelle = 'spieler';
  check('Quelle spieler: kein Bot-Hinweis', !R.renderMission(ohneRegel, mission).includes('des Bots'));
  const f = md.slice(md.indexOf('## Folgen'), md.indexOf('## Beteiligte NSC'));
  check('Folgen: Wirkung, Haltung, Chronik', f.includes('Konvoi gedeckt') && f.includes('Hilfe geleistet') && f.includes('Der Konvoi erreichte Speculum.'));
  check('NSC (Kanon) und Modellweg mit Rückfall', md.includes('Quintus Serran | rom') && md.includes('qwen-klein ausgefallen') && md.includes('| eskaliert') && md.includes('| ausfall |'));
  check('Prüfer-Ablehnung erscheint', md.includes('Beat ohne Ausgang; Ort unbekannt') && md.includes('Folge ohne Deckel geplant'));
}

// 3 Hinweise
check('künstlich-Hinweis mit Liste', md.includes('Verlauf teilweise gesetzt:** teleport'));
{
  const k = clone(v); k.lauf.kuenstlich = ['teleport', 'testhelfer-kill'];
  check('künstlich-Hinweis mehrere', R.renderMission(k, mission).includes('teleport, testhelfer-kill') && /^verlauf_kuenstlich: \["teleport","testhelfer-kill"\]$/m.test(R.renderMission(k, mission)));
  const n = clone(v); n.lauf.kuenstlich = [];
  check('ohne künstlich: kein Hinweis', !R.renderMission(n, mission).includes('teilweise gesetzt') && /^verlauf_kuenstlich: \[\]$/m.test(R.renderMission(n, mission)));
}
check('Heuristik-Hinweis zur Funk-Zuordnung', md.includes('heuristisch'));

// 4 rein, deterministisch
check('zweimal rendern = gleich', R.renderMission(v, mission) === R.renderMission(v, mission) && R.renderIndex(v) === R.renderIndex(v));
check('kein Datum ohne opts.jetzt', !/\d{4}-\d{2}-\d{2}(?!_)/.test(md.replace(/lauf: "[^"]*"/, '').replace(/\| Lauf \|[^\n]*/, '')) && !/^erzeugt:/m.test(md));
check('Datum nur über opts.jetzt', /^erzeugt: 2026-11-09$/m.test(R.renderMission(v, mission, { jetzt: new Date(2026, 10, 9, 12) })));
{
  const vor = JSON.stringify(v);
  R.renderMission(v, mission); R.renderIndex(v);
  check('Eingabe wird nicht verändert', JSON.stringify(v) === vor);
}

// 5 schreibeLauf
const D = tmp('lauf');
const r1 = R.schreibeLauf(v, D, { jetzt: new Date(2026, 10, 8, 12) });
const erwartet = ['01_konvoi/mission.md', '01_konvoi/verlauf.json', '02_graben_1/mission.md', '02_graben_1/verlauf.json', 'index.md', 'verlauf.json'];
check('schreibeLauf: Rückgabe dir und dateien', r1.dir === D && erwartet.every((f) => r1.dateien.includes(f)) && r1.dateien.length === erwartet.length, r1.dateien.join(','));
check('schreibeLauf: alle Dateien existieren', erwartet.every((f) => fs.existsSync(path.join(D, f))));
check('verlauf.json des Laufs = Eingabe', JSON.stringify(JSON.parse(read(path.join(D, 'verlauf.json')))) === JSON.stringify(v));
{
  const g = JSON.parse(read(path.join(D, '01_konvoi', 'verlauf.json')));
  check('verlauf.json der Gruppe: nur eigene Einträge und Angebot', g.format === 'mitschnitt/1' && g.gruppe.id === 'f3' && g.eintraege.length === 14 && g.angebote.length === 1 && g.angebote[0].angebot === 1);
}
const snap = () => Object.fromEntries(r1.dateien.map((f) => [f, read(path.join(D, f))]));
const s1 = snap();
R.schreibeLauf(v, D, { jetzt: new Date(2026, 10, 8, 12) });
check('schreibeLauf idempotent (byte-gleich)', JSON.stringify(snap()) === JSON.stringify(s1));
check('keine tmp-Reste', !fs.readdirSync(D, { recursive: true }).some((f) => String(f).endsWith('.tmp')));
check('schreibeLauf lehnt fremdes Format ab', (() => { try { R.schreibeLauf({ format: 'x' }, tmp('x')); return false; } catch (e) { return true; } })());

// 6 Bewertung und Notizen überleben
{
  const mdf = path.join(D, '01_konvoi', 'mission.md');
  MD.setFrontmatter(mdf, 'bewertung', 'gut');
  fs.appendFileSync(mdf, '\nMeine Anmerkung: die Wahl wirkt mechanisch.\n\n- Punkt 2\n');
  const idxf = path.join(D, 'index.md');
  fs.appendFileSync(idxf, '\nLauf insgesamt brauchbar.\n');
  const v2 = clone(v);
  v2.eintraege.find((e) => e.nr === 7).text = 'Wir kommen mit euch, versprochen.';
  R.schreibeLauf(v2, D, { jetzt: new Date(2026, 10, 9, 12) });
  const t = read(mdf);
  check('Inhalt wurde neu geschrieben', t.includes('versprochen'));
  check('bewertung bleibt erhalten', /^bewertung: gut$/m.test(frontmatter(t)));
  check('Notizen bleiben erhalten (bis Dateiende)', t.includes('Meine Anmerkung: die Wahl wirkt mechanisch.') && t.includes('- Punkt 2') && (t.match(/^## Notizen$/gm) || []).length === 1);
  check('Index: Notizen bleiben, Bewertung erscheint', read(idxf).includes('Lauf insgesamt brauchbar.') && /\| gut \|/.test(read(idxf)));
  check('Frontmatter weiter ohne status', !/^status:/m.test(frontmatter(t)));
  // Umnummerierung: neue Gruppe vorn, Konvoi rutscht auf 02
  const v3 = clone(v2);
  v3.eintraege.forEach((e) => { e.nr += 1; });
  v3.gruppen.forEach((g) => { g.von_nr += 1; g.bis_nr += 1; });
  v3.eintraege.unshift({ nr: 1, spielzeit: 0.5, art: 'sprung', szene: 'x', ort: 'y', von: 'z' });
  v3.gruppen.unshift({ id: 'f0', art: 'szene', titel: 'Vorspiel', kennung: 'vorspiel', von_nr: 1, bis_nr: 1, ausgang: 'offen', angebot: null, plan: null, nsc: [], modell: null, pruefer: [] });
  R.schreibeLauf(v3, D, { jetzt: new Date(2026, 10, 9, 12) });
  const neu = path.join(D, '02_konvoi', 'mission.md');
  check('Umnummerierung: Datei über Kennung gefunden, bewertung + Notizen erhalten', fs.existsSync(neu) && /^bewertung: gut$/m.test(frontmatter(read(neu))) && read(neu).includes('Meine Anmerkung'));
  check('Umnummerierung: alter Ordner entfernt', !fs.existsSync(path.join(D, '01_konvoi')));
  check('Neue Gruppe startet mit bewertung offen', /^bewertung: offen$/m.test(frontmatter(read(path.join(D, '01_vorspiel', 'mission.md')))));
}

// 7 unbekannte Art, kein Namensfilter, Index
check('unbekannte Art erscheint mit Feldern', md.includes('| pruefung_unbekannt | foo: bar; zahl: 4 |'));
{
  const u = clone(v);
  u.eintraege.push({ nr: 22, spielzeit: 9.5, art: 'neuer_beat_typ', alpha: 'a|b', beta: { x: 1 }, gamma: [1, 2] });
  u.gruppen[0].bis_nr = 22;
  const t = R.renderMission(u, u.gruppen[0]);
  check('neue Art ohne Renderer-Änderung (Pipe maskiert, Objekt/Liste lesbar)', t.includes('| neuer_beat_typ | alpha: a\\|b; beta: x: 1; gamma: 1, 2 |'));
  const name = clone(v);
  name.eintraege.find((e) => e.nr === 7).text = 'Ada, bist du da? Danke Ada.';
  const t2 = R.renderMission(name, mission);
  check('Renderer filtert keine Namen (Zuständigkeit beim Recorder)', (t2.match(/Ada, bist du da\? Danke Ada\./g) || []).length === 2 && R.renderIndex(name).length > 0);
  const inj = clone(v);
  inj.eintraege.find((e) => e.nr === 7).text = 'zeile\n## Notizen\nuntergeschoben';
  const t3 = R.renderMission(inj, mission);
  check('Text mit eigener Notizen-Überschrift verfälscht Notizen nicht', MD.notizenAus(t3) === '_Platz für Anmerkungen zum Review – dieser Abschnitt bleibt beim Neuschreiben erhalten._');
}
{
  const ix = R.renderIndex(v, { ordner: { f3: '01_konvoi', s1: '02_graben_1' }, bewertungen: { f3: 'schwach' } });
  check('Index: Lauf-Kopf', ix.includes('| Werkzeug | spiel-faden |') && ix.includes('| Wahlregel | Brett: annehmen; Bitte: erste Option |') && ix.includes('teleport'));
  check('Index: Gruppentabelle mit Dauer, Bewertung, Link', ix.includes('| 1 | Der letzte Konvoi | mission | gelungen | 0:03 | schwach | [01_konvoi](01_konvoi/mission.md) |') && ix.includes('| 2 | Graben bei Hafen Ulfsvakt | szene | gelungen | 0:02 | offen |'));
  check('Index: Angebote mit Zählung', ix.includes('gespielt 1, verfallen 1') && ix.includes('| 2 | Rauch ueber dem Hafen | verfallen |'));
  const z = ix.slice(ix.indexOf('## Zwischen den Aufträgen'));
  check('Index: Zwischen den Aufträgen (Einträge ohne Gruppe)', z.includes('Neuer Auftrag am Brett: Der letzte Konvoi') && z.includes('| 17 | sprung |') && !z.includes('Quintus Serran:'));
  check('Index: Notizen-Abschnitt', /^## Notizen$/m.test(ix));
}

// 8 ablage.js unverändert im Verhalten
check('ablage.js re-exportiert weiter readMdState/renderMarkdown/setStatus', ['readMdState', 'renderMarkdown', 'setStatus', 'list', 'rewrite', 'create'].every((k) => typeof Ablage[k] === 'function'));
{
  const f = path.join(tmp('ablage'), 'mission.md');
  fs.writeFileSync(f, '---\r\nstatus: angenommen\r\ntitel: "A"\r\n---\r\n\r\n# A\r\n\r\n## Notizen\r\n\r\nText A\r\nZeile 2\r\n');
  const st = Ablage.readMdState(f);
  check('readMdState: Status und Notizen (CRLF)', st.status === 'angenommen' && st.notizen === 'Text A\nZeile 2', JSON.stringify(st));
  check('readMdState: fehlende Datei', JSON.stringify(Ablage.readMdState(path.join(TMP, 'gibtsnicht.md'))) === '{"status":null,"notizen":null}');
  const g = MD.readMdFelder(f, ['status', 'titel', 'bewertung']);
  check('readMdFelder: Schlüssel wählbar', g.felder.status === 'angenommen' && g.felder.titel === 'A' && g.felder.bewertung === null && g.notizen === 'Text A\nZeile 2');
  check('setFrontmatter: setzt Wert, behält CRLF, ergänzt fehlenden Schlüssel', (() => {
    MD.setFrontmatter(f, 'status', 'offen'); MD.setFrontmatter(f, 'bewertung', 'gut');
    const t = fs.readFileSync(f, 'utf8');
    return /^status: offen\r$/m.test(t) && /^bewertung: gut\r$/m.test(t) && !/(^|[^\r])\n/.test(t.replace(/\r\n/g, '')) && t.includes('Text A');
  })());
}
{
  const r = cp.spawnSync(process.execPath, [path.join(__dirname, 'test-ablage.js')], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  check('tools/test-ablage.js grün', r.status === 0, (r.stdout || '').split('\n').slice(-3).join(' | '));
}
check('Repo bleibt sauber (data/mitschnitt unverändert, nichts in content/)', (fs.existsSync(REPO_DATA) ? fs.readdirSync(REPO_DATA).sort().join(',') : '') === repoBefore);

fs.rmSync(TMP, { recursive: true, force: true });
let bad = 0;
for (const r of results) { if (!r.ok) { bad++; console.log(`✗ ${r.name}${r.detail ? ' – ' + r.detail : ''}`); } }
console.log(`${results.length - bad}/${results.length} Prüfungen ok`);
process.exit(bad ? 1 : 0);
