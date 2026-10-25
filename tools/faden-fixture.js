'use strict';
// SUND-04a-1 B: gemeinsame Hilfen der Tests zu den Geschichtsfaeden (test-faden-*.js, mutation-faden.js).
//   vorlageTest() -> frische Kopie der Testvorlage (tools/fixtures/faeden/test-vorlage.json; sie ist NUR Daten: alle sechs Beats, Hinweis, Verfolgung mit Fluchtziel)
//   alsVorlage(id, aendern?) -> Kopie mit anderer Id (und optional veraendert), nicht registriert        registriere(v) -> Ergebnis des Pruefers (D.registriere)
//   spiel(o) -> { g, cs, funk } ein Spiel im Modus Freie Fahrt Sund mit FAEDEN=1 (o.env ergaenzt, o.aus: ohne Schalter) und der registrierten Testvorlage
//   angebot(g, o?) -> Angebot (Notruf bewaeltigt, ausgangMitPerson)      oeffne(g, vorlageId?) -> Faden (ueber den Befehl faden_oeffnen)
//   grenzen(g, n, art?) -> n Taetigkeitsgrenzen ueber den ECHTEN Hook game.lageGrenze (nie faden.taetigkeit direkt)
const fs = require('fs');
const path = require('path');
const F = require('./regie-fixture.js');
const D = require('../server/sim/faden-daten.js');
const Faden = require('../server/sim/faden.js');

const DATEI = path.join(__dirname, 'fixtures', 'faeden', 'test-vorlage.json');
const klon = (x) => JSON.parse(JSON.stringify(x));
const vorlageTest = () => JSON.parse(fs.readFileSync(DATEI, 'utf8'));
function alsVorlage(id, aendern) { const v = vorlageTest(); v.id = id; if (aendern) aendern(v); return v; }
const registriere = (v) => D.registriere(v);

function spiel(o) {
  o = o || {};
  const r = registriere(vorlageTest());
  if (!r.ok) throw new Error('Testvorlage ungueltig: ' + r.fehler.join('; '));
  return F.neuesSpiel(Object.assign({ crew: 1, seed: 7 }, o, { env: Object.assign(o.aus ? {} : { FAEDEN: '1' }, o.env || {}) }));
}
let nr = 0;
function angebot(g, o) { return Faden.ausgangMitPerson(g, Object.assign({ art: 'notruf', id: 'notruf_t' + (++nr), hex: '0305', sprecher: 'Sprecher', ausgang: 'gelungen' }, o || {})); }
function oeffne(g, vorlage) {
  const a = angebot(g);
  if (!a) return null;
  const r = Faden.befehlAnwenden(g, { typ: 'faden_oeffnen', vorlage: vorlage || 'test_geschichte', parameter: { angebot: a.nr } });
  return r.ok ? r.faden : null;
}
const grenzen = (g, n, art) => { for (let i = 0; i < n; i++) g.lageGrenze(art || 'andocken'); };

module.exports = { F, D, Faden, klon, vorlageTest, alsVorlage, registriere, spiel, angebot, oeffne, grenzen, DATEI };
