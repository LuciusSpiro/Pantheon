'use strict';
// MIT-01 N3: Befunde 1, 2, 4, 5, 6, 8 des unabhängigen Reviews, je mit einem Test, der vor der Korrektur rot war. Schreibt nur in mkdtemp-Verzeichnisse.
//   node tools/test-mitschnitt-n3.js
//   1 fremde Wahlen/Folgen im Dokument (Gruppe)   2 abgebrochene Mission schließt die Gruppe   4 verworfen in verlauf.json/Index
//   5 Kennung aus gefiltertem Titel                6 zwei Läufe, ein Ordner                      8 einzeilig(): Zeilenumbrüche in Titel/Sprecher
const fs = require('fs');
const os = require('os');
const path = require('path');
const F = require('./regie-fixture.js');
const { Game } = require('../server/game.js');
const { Mitschnitt } = require('../server/telemetrie/mitschnitt.js');
const R = require('../server/telemetrie/mitschnitt-render.js');

let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-mit-n3-'));
let zaehler = 0;
const neuesVerz = () => path.join(root, 'm' + (++zaehler));
const ROH_LADER = Mitschnitt.renderLader;
const lesen = (f) => fs.readFileSync(f, 'utf8');
const NOTIZ = '## Notizen';

function kampagne(dir, namen) {
  const env = { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', MITSCHNITT: '1', MITSCHNITT_DIR: path.join(dir, 'mit'), REGIE_DIR: path.join(dir, 'regie') };
  const g = new Game({ noStore: true, worlds: false, seed: 21, debug: true, env, log: () => {} });
  const c = { inbox: [], send() {}, sendRaw() {} };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'K0', name: (namen && namen[0]) || 'Kai', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'm1' });
  g.handleMessage(c, { t: 'ready', ready: true });
  return g;
}

// ---------- 1. fremde Wahlen und Folgen ----------
console.log('Befund 1: Gruppenzuordnung im Dokument');
{
  const e = (nr, art, f, gr) => Object.assign({ nr, spielzeit: nr, art }, f || {}, gr ? { gruppe: gr } : {});
  const v = {
    format: 'mitschnitt/1', lauf: { id: 'x', werkzeug: 't', quelle: 'bot', regel: 'r', seed: 1, crew: 1, modus: 'm', kuenstlich: [] }, angebote: [],
    gruppen: [
      { id: 'f1', art: 'faden', titel: 'Faden Eins', kennung: 'eins', von_nr: 10, bis_nr: 100, ausgang: 'gelungen', angebot: null, plan: null, nsc: [], modell: null, pruefer: [] },
      { id: 'f2', art: 'faden', titel: 'Faden Zwei', kennung: 'zwei', von_nr: 50, bis_nr: 60, ausgang: 'gelungen', angebot: null, plan: null, nsc: [], modell: null, pruefer: [] },
    ],
    eintraege: [
      e(10, 'faden', { ausgang: 'geoeffnet' }, 'f1'),
      e(20, 'bitte', { von: 'ErsterBitter', text: 'Eigene Bitte eins', bitte_nr: 1, optionen: [{ id: 'a1', text: 'Ja eins' }] }, 'f1'),
      e(25, 'wahl', { quelle: 'bitte', id: 'a1', option: 'a1', text: 'Ja eins', bitte_nr: 1, optionen: [{ id: 'a1', text: 'Ja eins' }] }, 'f1'),
      e(50, 'bitte', { von: 'ZweiterBitter', text: 'Fremde Bitte zwei', bitte_nr: 2, optionen: [{ id: 'b1', text: 'Ja zwei' }] }, 'f2'),
      e(55, 'wahl', { quelle: 'bitte', id: 'b1', option: 'b1', text: 'Ja zwei', bitte_nr: 2, optionen: [{ id: 'b1', text: 'Ja zwei' }] }, 'f2'),
      e(56, 'wirkung', { konto: 'ruf', ziel: 'FremdFraktion', grund: 'fremd', betrag: 5, stand: 5 }, 'f2'),
      e(57, 'haltung', { npc: 'FremdNsc', delta: 1, stand: 3 }, 'f2'),
      e(58, 'chronik', { chronik_art: 'x', ref: 'FremdRef', kurz: 'Fremde Chronik' }, 'f2'),
      e(60, 'wirkung', { konto: 'ruf', ziel: 'HeuristikFraktion', grund: 'h', betrag: 1, stand: 6 }, 'f2'),
      e(70, 'wirkung', { konto: 'ruf', ziel: 'OhneGruppeFraktion', grund: 'o', betrag: 1, stand: 7 }),
      e(100, 'faden', { ausgang: 'abgeschlossen' }, 'f1'),
    ],
  };
  v.eintraege[8].zuordnung = 'heuristik';
  const md = R.renderMission(v, v.gruppen[0]);
  const wahl = md.slice(md.indexOf('## Optionen und Wahl'), md.indexOf('## Folgen'));
  const folgen = md.slice(md.indexOf('## Folgen'), md.indexOf('## Beteiligte NSC'));
  const zeit = md.slice(md.indexOf('## Zeitleiste'), md.indexOf('## Funk- und Anzeigetexte'));
  ok(wahl.includes('Eigene Bitte eins') && wahl.includes('Ja eins'), 'Optionen und Wahl: die eigene Bitte steht da');
  ok(!wahl.includes('Fremde Bitte zwei') && !wahl.includes('Ja zwei') && !wahl.includes('ZweiterBitter'), 'Optionen und Wahl: Bitte und Wahl von f2 stehen nicht als eigene da');
  ok(!folgen.includes('FremdFraktion') && !folgen.includes('FremdNsc') && !folgen.includes('Fremde Chronik'), 'Folgen: Wirkung, Haltung, Chronik von f2 stehen nicht als eigene da');
  ok(folgen.includes('HeuristikFraktion') && folgen.includes('OhneGruppeFraktion'), 'Folgen: heuristisch zugeordnete und gruppenlose Einträge bleiben sichtbar');
  ok(/\| 50 \| bitte \|.*\(Faden f2\)/.test(zeit) && /\| 55 \| wahl \|.*\(Faden f2\)/.test(zeit), 'Zeitleiste: fremde Einträge bleiben, mit Marker (Faden f2)');
  ok(!/\| 20 \| bitte \|.*\(Faden f/.test(zeit) && !/\| 70 \| wirkung \|.*\(Faden f/.test(zeit), 'Zeitleiste: eigene und gruppenlose Einträge ohne Marker');
  const md2 = R.renderMission(v, v.gruppen[1]);
  ok(md2.includes('Fremde Bitte zwei') && !md2.includes('Eigene Bitte eins'), 'f2 zeigt seine eigene Bitte und nicht die von f1');
}

// ---------- 2. abgebrochene Mission ----------
console.log('Befund 2: Abbruch schließt die Missions-Gruppe');
{
  const d = neuesVerz();
  const g = kampagne(d);
  for (let i = 0; i < 60; i++) g.step();
  const id1 = g.mission.activeId;
  g.mission.abbrechen();
  for (let i = 0; i < 10; i++) g.step();
  g.mission.startMission('m2');
  for (let i = 0; i < 90; i++) g.step();
  const m = g.mitschnitt; const v = m.verlauf();
  const gr = v.gruppen.find((x) => x.art === 'mission' && x.kennung === id1);
  const ende = v.eintraege.find((x) => x.art === 'szene' && x.ereignis === 'ende' && x.szene === id1);
  ok(id1 === 'm1' && gr && ende && ende.ausgang === 'abgebrochen', 'Szenario: m1 abgebrochen (szene_ende abgebrochen im Verlauf)');
  ok(gr && gr.ausgang === 'abgebrochen', 'alte Gruppe: Ausgang abgebrochen (nicht offen) [' + (gr && gr.ausgang) + ']');
  ok(gr && ende && gr.bis_nr === ende.nr, 'alte Gruppe endet beim Abbruch (bis_nr ' + (gr && gr.bis_nr) + ' = ' + (ende && ende.nr) + ')');
  const g2 = v.gruppen.find((x) => x.art === 'mission' && x.kennung === 'm2');
  ok(g2 && g2.ausgang === 'offen' && g2.von_nr > (ende ? ende.nr : 0), 'neue Mission m2 läuft als eigene, offene Gruppe');
  m.ende();
}

// ---------- 4. verworfen ----------
console.log('Befund 4: verworfene Einträge sind sichtbar');
{
  const d = neuesVerz();
  const g = kampagne(d);
  const m = g.mitschnitt;
  const gesehen = [];
  Mitschnitt.renderLader = () => ({ schreibeLauf(verlauf, dir) { gesehen.push(verlauf); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'verlauf.json'), JSON.stringify(verlauf)); } });
  try {
    m.v.eintraege.length = 0;
    for (let i = 0; i < 200000; i++) m.v.eintraege.push({ nr: i + 1, spielzeit: 0, art: 'oda', text: '' });
    m.nr = 200000;
    g.oda('Eins'); g.oda('Zwei'); g.oda('Drei');
    ok(m.verworfen === 3, 'Kappe erreicht: 3 verworfen gezählt (' + m.verworfen + ')');
    m.ende();
    ok(gesehen.length === 1 && gesehen[0].lauf.verworfen === 3, 'verlauf.json führt lauf.verworfen = 3');
  } finally { Mitschnitt.renderLader = ROH_LADER; }
  const v = { format: 'mitschnitt/1', lauf: { id: 'x', werkzeug: 't', quelle: 'bot', regel: '', seed: 1, crew: 1, modus: '', kuenstlich: [], verworfen: 7 }, gruppen: [], angebote: [], eintraege: [{ nr: 1, spielzeit: 0, art: 'oda', text: 'a' }] };
  ok(/verworfen/i.test(R.renderIndex(v)) && R.renderIndex(v).includes('7'), 'index.md weist bei verworfen > 0 darauf hin');
  v.lauf.verworfen = 0;
  ok(!/verworfen/i.test(R.renderIndex(v)), 'index.md: ohne verworfene Einträge kein Hinweis');
}

// ---------- 5. Kennung aus gefiltertem Titel ----------
console.log('Befund 5: Kennung ohne Spielername');
{
  const d = neuesVerz();
  const g = kampagne(d, ['Bo']);
  const m = g.mitschnitt;
  g.oda('Bo ist da.');   // der Name wird dem Filter bekannt
  const fd = { id: 'f77', vorlage: 'x', plan: null, nsc: null };   // ohne Plan: der Titel kommt aus dem Kanon (ungefiltert im Spielzustand)
  g.weltsim = g.weltsim || {}; g.weltsim.faeden = g.weltsim.faeden || { liste: [] }; g.weltsim.faeden.liste = [fd]; g.weltsim.faeden.kanon = [{ f: 'f77', titel: 'Bo hilft Cem' }];
  const e = m._neu('faden', { ausgang: 'geoeffnet' }, { gruppe: null });
  m._fadenOeffnen('f77', e, {});
  m._neu('funk', { von: 'Lerche', text: 'Bo, bitte kommen.' }, { gruppe: 'f77' });   // Inhalt, damit der Faden nicht als leerer Versuch gilt
  const gr = m.v.gruppen.find((x) => x.id === 'f77');
  ok(gr && gr.titel === 'Crew hilft Cem' && !/\bbo\b/i.test(gr.kennung), 'Gruppe: Titel gefiltert, Kennung ohne Namen (' + (gr && gr.kennung) + ')');
  m.lauf({ werkzeug: 'n3' });
  const dir = m.ende();
  const namen = fs.readdirSync(dir);
  const mdDatei = namen.find((n) => fs.existsSync(path.join(dir, n, 'mission.md')) && /hilft/.test(n));
  ok(mdDatei && !/(^|[_-])bo([_-]|$)/i.test(mdDatei), 'Ordnername ohne Namen (' + mdDatei + ')');
  const md = mdDatei ? lesen(path.join(dir, mdDatei, 'mission.md')) : '';
  ok(md && !/\bBo\b/.test(md) && /kennung: "crew-hilft/.test(md), 'Frontmatter: kennung ohne Namen');
}

// ---------- 6. zwei Läufe, ein Ordner ----------
console.log('Befund 6: Ordner exklusiv');
{
  const d = neuesVerz();
  const env = { MISSION_SOURCE: 'fallback', MITSCHNITT: '1', MITSCHNITT_DIR: path.join(d, 'mit'), REGIE_DIR: path.join(d, 'regie') };
  const a = F.neuesSpiel({ crew: 1, seed: 2, names: ['Zed'], env }).g.mitschnitt;
  const b = F.neuesSpiel({ crew: 1, seed: 2, names: ['Zed'], env }).g.mitschnitt;
  b._beginn = a._beginn; b.v.lauf.gestartet = a.v.lauf.gestartet;
  for (const x of [a, b]) x.lauf({ werkzeug: 'gleich', seed: 2, crew: 1, modus: 'm' });
  a.vonEmit('oda', { text: 'Lauf A' }); b.vonEmit('oda', { text: 'Lauf B' });
  const oa = a.ende(), ob = b.ende();
  ok(oa && ob && oa !== ob, 'zwei Läufe gleichen Namens und gleicher Millisekunde: verschiedene Ordner (' + (oa && path.basename(oa)) + ', ' + (ob && path.basename(ob)) + ')');
  ok(oa && ob && /Lauf A/.test(lesen(path.join(oa, 'verlauf.json'))) && /Lauf B/.test(lesen(path.join(ob, 'verlauf.json'))), 'jeder Ordner enthält den eigenen Lauf');
  ok(ob && /-2$/.test(ob), 'der zweite bekommt den Suffix -2');
}

// ---------- 8. einzeilig ----------
console.log('Befund 8: Zeilenumbrüche in Titel und Sprecher');
{
  const dir = neuesVerz();
  const v = {
    format: 'mitschnitt/1', lauf: { id: 'lauf1', werkzeug: 't\n' + NOTIZ, quelle: 'bot', regel: 'r', seed: 1, crew: 1, modus: 'm', kuenstlich: [] }, angebote: [],
    gruppen: [{ id: 'f1', art: 'faden', titel: 'Böser\n' + NOTIZ + '\nTitel', kennung: 'boese', von_nr: 1, bis_nr: 3, ausgang: 'gelungen', angebot: null, plan: { titel: 'Plan\n' + NOTIZ }, nsc: [], modell: null, pruefer: [] }],
    eintraege: [
      { nr: 1, spielzeit: 0, art: 'funk', von: 'Sprecher\n' + NOTIZ, text: 'Hallo', gruppe: 'f1' },
      { nr: 2, spielzeit: 1, art: 'entscheidung', id: 'e\n' + NOTIZ, optionen: [{ id: 'a', text: 'A' }], gruppe: 'f1' },
      { nr: 3, spielzeit: 2, art: 'wahl', quelle: 'buch\n' + NOTIZ, id: 'a', option: 'a', text: 'A\n' + NOTIZ, gruppe: 'f1' },
    ],
  };
  const anzahl = (t) => t.split('\n').filter((z) => z === NOTIZ).length;
  const md = R.renderMission(v, v.gruppen[0]);
  ok(anzahl(md) === 1, 'genau eine Überschrift „## Notizen“ trotz Umbruch in Titel, Sprecher, Plan, Id (' + anzahl(md) + ')');
  const lauf = path.join(dir, 'lauf');
  const r = R.schreibeLauf(v, lauf, { jetzt: new Date() });
  const mdDatei = r.dateien.find((x) => x.endsWith('mission.md'));
  const f = path.join(lauf, mdDatei);
  fs.writeFileSync(f, lesen(f).replace(/\n## Notizen\n[\s\S]*$/, '\n## Notizen\n\nMeine Anmerkung bleibt.\n'));
  R.schreibeLauf(v, lauf, { jetzt: new Date() });
  ok(/Meine Anmerkung bleibt\./.test(lesen(f)), 'Notizen bleiben beim Neuschreiben erhalten');
  ok(anzahl(lesen(path.join(lauf, 'index.md'))) === 1, 'index.md: genau eine Notizen-Überschrift');
  ok(typeof R.einzeilig === 'function' && R.einzeilig('a\r\nb\u0007c|d') === 'a b c|d', 'einzeilig(): Umbrüche und Kontrollzeichen zu Leerzeichen, | bleibt (Tabellenzellen escapen selbst)');
}

// ---------- 7. tools/spiel-faden.js (Quelltext-Prüfung: das Werkzeug braucht einen Server und Sekunden) ----------
console.log('Befund 7: spiel-faden');
{
  const q = lesen(path.join(__dirname, 'spiel-faden.js'));
  const letzte = q.split(/\r?\n/).filter((x) => x.includes('.catch((e)')).pop() || '';
  ok(letzte.includes('MitLauf.beenden('), 'catch-Pfad ruft MitLauf.beenden (Konsolenzeile Mitschnitt: ...)');
  const z = q.split(/\r?\n/).find((x) => x.includes('const runde = async')) || '';
  ok(z.indexOf("k('aufrufe-zuruecksetzen')") > z.indexOf('aufrufe > 4'), 'künstlich-Markierung aufrufe-zuruecksetzen nur, wenn tatsächlich zurückgesetzt wird');
}

console.log(fails ? `\n${fails} FEHLER` : '\nalle ok');
process.exit(fails ? 1 : 0);
