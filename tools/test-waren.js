'use strict';
// LAD-01 A1: Warenmodell als Daten (content/waren.json, shared/waren.js).
//   8 Arten vollständig; eine TESTWARE, zur Laufzeit in die Daten injiziert (keine Codeänderung), ist artOk, ladbar (anBordLegen),
//   im Weltstand speicher- und ladbar (toSave/restore, Datei) und schema-gültig; Deuterium behält Preis 40 und Gewichtsabzug;
//   Altverhalten (artDefault, Sprengstoff, unbekannte Art, Personen) unverändert; Namen kommen aus den Daten.
const fs = require('fs');
const os = require('os');
const path = require('path');
const CONFIG = require('../shared/config.js');
const Waren = require('../shared/waren.js');
const Frachtliste = require('../shared/frachtliste.js');
const Weltstand = require('../server/weltstand.js');
const { Game } = require('../server/game.js');
const Fracht = require('../server/sim/fracht.js');
const Ladung = require('../server/sim/ladung.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, body) {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-waren-'));
let dirSeq = 0;
const freshDir = () => { const d = path.join(TMP, 'w' + (++dirSeq)); fs.mkdirSync(d, { recursive: true }); return d; };

function setup(opts) {
  const o = opts || {};
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: o.dir, seed: 21, debug: true,
    env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'W0', name: 'Waren0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'free', ...(o.world ? { world: o.world } : {}) });
  g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.space.enemies = []; g.space.projectiles = [];
  const run = (sec) => { for (let k = 0; k < Math.round(sec * CONFIG.tickHz); k++) g.step(); };
  return { g, c, run, send: (m) => g.handleMessage(c, m) };
}

const ACHT = ['fracht', 'waffen', 'erz', 'bergungsgut', 'deuterium', 'sprengstoff', 'hilfsgueter', 'person'];

section('Daten: 8 Arten vollständig', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'waren.json'), 'utf8'));
  ok(Array.isArray(raw.waren) && raw.waren.length === 8, 'content/waren.json hat 8 Waren');
  for (const id of ACHT) {
    const w = Waren.get(id);
    ok(!!w, id + ' vorhanden');
    if (!w) continue;
    ok(Waren.pruefe(w).length === 0, id + ' vollständig und gültig ' + Waren.pruefe(w).join('; '));
    ok(Waren.FELDER.every((f) => f in w), id + ' trägt alle Felder');
  }
  ok(Waren.get('person').kategorie === 'person' && ACHT.filter((a) => a !== 'person').every((a) => Waren.get(a).kategorie === 'ware'), 'Kategorie: nur person ist person');
  ok(JSON.stringify(Waren.arten()) === JSON.stringify(ACHT.filter((a) => a !== 'person')), 'Ladungsarten = alle Waren ohne Person');
  ok(Waren.name('hilfsgueter') === 'Hilfsgüter' && Waren.name('sprengstoff') === 'Sprengstoff' && Waren.name('kaviar') === 'kaviar', 'Namen aus den Daten, unbekannt = Kennung');
  ok(Waren.pruefe({ id: 'x' }).length > 0 && Waren.pruefe(null).length > 0, 'unvollständige Ware wird gemeldet');
});

section('Altverhalten unverändert', () => {
  const g = new Game({ noStore: true, seed: 3, log: () => {} });
  ok(CONFIG.fracht.artDefault === 'sprengstoff' && g.C.fracht.artDefault === 'sprengstoff', 'artDefault bleibt sprengstoff');
  ok(['sprengstoff', 'fracht', 'deuterium'].every((a) => Fracht.artOk(g, a)), 'sprengstoff, fracht, deuterium sind Arten');
  ok(!Fracht.artOk(g, 'kaviar') && !Fracht.artOk(g, 'person') && !Fracht.artOk(g, undefined), 'unbekannte Art und Person sind keine Ladungsart');
  ok(CONFIG.fracht.preise.deuterium === 40 && CONFIG.fracht.gewicht.deuterium === 0.15, 'Config: Deuterium 40 Marken, Gewicht 0,15');
  ok(Object.keys(CONFIG.fracht.gewicht).length === 1, 'nur Deuterium hat Gewicht');
  ok(Fracht.artName('sprengstoff') === 'Sprengstoff' && Fracht.artName('fracht') === 'Fracht' && Frachtliste.artName('deuterium') === 'Deuterium', 'Namen wie vorher');
  ok(CONFIG.fracht.beamRange === 320 && require('../shared/maps.js').CARGO_PER_RAUM === 4, 'Beamreichweite 320 und 4 Plätze je Frachtraum (LAD-01 A2)');
  const h = new Game({ noStore: true, seed: 3, log: () => {} });
  ok(Fracht.anBordLegen(h, null) === true && Fracht.lagerArten(h)[0] === 'sprengstoff', 'anBordLegen ohne Art legt die Standardart');
  ok(Fracht.anBordLegen(h, 'kaviar') === false, 'unbekannte Art wird abgelehnt');
});

section('Deuterium: Preis 40 und Gewichtsabzug', () => {
  const T = setup();
  T.run(0.3);
  ok(Waren.grundpreis('deuterium') === 40 && Waren.gewicht('deuterium') === 0.15, 'Daten: 40 und 0,15');
  ok(Ladung.gewichtFaktor(T.g) === 1, 'ohne Ladung Faktor 1');
  Fracht.anBordLegen(T.g, 'deuterium');
  ok(Math.abs(Ladung.gewichtFaktor(T.g) - 0.85) < 1e-9, 'eine Einheit Deuterium: Faktor 0,85');
  Fracht.anBordLegen(T.g, 'deuterium');
  ok(Math.abs(Ladung.gewichtFaktor(T.g) - 0.7) < 1e-9, 'zwei Einheiten: Faktor 0,7');
  T.g.fracht.lager = []; Fracht.anBordLegen(T.g, 'sprengstoff'); Fracht.anBordLegen(T.g, 'fracht');
  ok(Ladung.gewichtFaktor(T.g) === 1, 'Sprengstoff und Fracht wiegen nichts');
});

section('TESTWARE ohne Codeänderung', () => {
  const dir = freshDir();
  const tw = { id: 'testware', name: 'Testware', grundpreis: 12, gewicht: 0.1, eigenschaften: ['illegal'], darstellung: 'kiste', kategorie: 'ware' };
  const T = setup({ dir });
  T.run(0.3);
  ok(!Fracht.artOk(T.g, 'testware'), 'vorher unbekannt');
  ok(!Weltstand.validate({ schiff: { fracht: ['testware'] } }).some((f) => /testware/.test(f)), 'vorher lehnt die Prüfung den Stand NICHT ab (tolerant: restore verwirft die Art)');
  Waren.registrieren(tw);
  try {
    ok(Fracht.artOk(T.g, 'testware'), 'artOk nach dem Einspielen');
    ok(Fracht.artName('testware') === 'Testware' && Frachtliste.artName('testware') === 'Testware', 'Name aus den Daten (Server und Anzeige)');
    ok(Fracht.anBordLegen(T.g, 'testware') === true && Fracht.lagerArten(T.g)[0] === 'testware', 'per anBordLegen geladen');
    ok(Math.abs(Ladung.gewichtFaktor(T.g) - 0.9) < 1e-9, 'Gewicht aus den Daten wirkt');
    ok(T.g.snapshot().fracht.lager[0] === 'testware', 'Snapshot nennt die Art');
    ok(!!Fracht.fracht_abwerfen(T.g, T.g.ship.x + 50, T.g.ship.y, 'testware'), 'als Fracht im Raum ablegbar (beamfähig)');
    const gespeichert = Fracht.toSave(T.g);
    ok(JSON.stringify(gespeichert) === '["testware"]', 'toSave: ' + JSON.stringify(gespeichert));
    const R = new Game({ noStore: true, seed: 3, log: () => {} });
    Fracht.restore(R, gespeichert);
    ok(JSON.stringify(Fracht.lagerArten(R)) === '["testware"]', 'restore bringt sie zurück');
    const id = T.g.weltstand.id;
    T.send({ t: 'menu', op: 'end' });
    const data = JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8'));
    ok(JSON.stringify(data.schiff && data.schiff.fracht) === '["testware"]', 'Stand enthält die Testware ' + JSON.stringify(data.schiff && data.schiff.fracht));
    ok(Weltstand.validate(data).length === 0, 'Stand ist schema-gültig ' + (Weltstand.validate(data)[0] || ''));
    ok(Weltstand.fallbackValidate(data, Weltstand.schema()).length === 0, 'auch für den Fallback-Prüfer');
    const L = setup({ dir, world: id });
    L.run(0.3);
    ok(JSON.stringify(Fracht.lagerArten(L.g)) === '["testware"]', 'nach dem Laden an Bord');
  } finally { Waren.entfernen('testware'); }
  ok(!Fracht.artOk(T.g, 'testware'), 'nach dem Entfernen wieder unbekannt');
  const R2 = new Game({ noStore: true, seed: 3, log: () => {} });
  Fracht.restore(R2, ['testware', 'fracht']);
  ok(JSON.stringify(Fracht.lagerArten(R2)) === '["fracht"]', 'Altstand mit entfernter Ware: Art fällt beim Laden weg, Rest bleibt');
});

section('Schema: keine feste Liste mehr', () => {
  const schemaText = JSON.stringify(Weltstand.schema());
  ok(!/"enum":\s*\["sprengstoff"/.test(schemaText), 'Schema enthält keine feste Artenliste');
  const mit = (fracht) => ({ schiff: { fracht } });
  ok(Weltstand.validate(mit(['erz', 'waffen', 'hilfsgueter'])).filter((f) => /fracht/.test(f)).length === 0, 'neue Arten des Modells sind gültig');
  ok(Weltstand.validate(mit(['kaviar'])).length > 0, 'unbekannte Art wird abgelehnt');
  ok(Weltstand.validate(mit(['Gross Schreibung'])).length > 0, 'ungültige Kennung wird abgelehnt');
});

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* Aufräumen ist nicht kritisch */ }
console.log('\n' + (fails ? fails + ' FEHLER' : 'alles ok') + ' (' + n + ' Prüfungen)');
process.exit(fails ? 1 : 0);
