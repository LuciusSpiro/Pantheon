#!/usr/bin/env node
'use strict';
// SCH-02 C1: Lexikon-Variante je Kartenart (server/mission/lexikon.js eintragFuerArt / aufloesenFuerArt, content/buehnen/lexikon/rom.json art.schiff).
//   node tools/test-lexikon-art.js
// Rom-Schiff redet nicht vom Kastell; alle anderen Kombinationen (Bauweise ohne art-Abschnitt, andere Kartenart, keine Kartenart) loesen byte-gleich zu aufloesen() auf.
const Lex = require('../server/mission/lexikon.js');
let n = 0, bad = 0;
const ok = (c, t) => { n++; if (!c) { bad++; console.log('  FEHLER ' + t); } else if (process.env.VERBOSE) console.log('  ok   ' + t); };

const T = 'Weiter {{lex.abholpunkt:zum}}: {{lex.terminal:der}} lesen, {{lex.sprengpunkt:den}} sprengen, {{lex.ziel:der}} halten, {{lex.wachen}} beachten, {{lex.herzstueck:zum}} vor, {{lex.tor_station}} schließen.';
const schiff = Lex.aufloesenFuerArt(T, 'rom', 'schiff');
const kastell = Lex.aufloesen(T, 'rom');
console.log('  Rom-Schiff : ' + schiff + '\n  Rom-Kastell: ' + kastell);
ok(/Logbuchpult/.test(schiff) && /Reaktorkern/.test(schiff) && /Steuerpult/.test(schiff) && /Besatzungsw/.test(schiff) && /Praetorium/.test(schiff) && /Schott/.test(schiff), 'rom/schiff: Raumschiff-Woerter');
ok(!/Wachbuch|Pulverkammer|Feldzeichen|Kastell|Fahnenheiligtum|Vorfeld/.test(schiff), 'rom/schiff: kein Kastell-Vokabular in den ersetzten Schluesseln');
ok(/Wachbuch/.test(kastell) && /Pulverkammer/.test(kastell), 'rom ohne art: Kastell-Woerter wie zuvor');
ok(Lex.aufloesenFuerArt(T, 'rom', null) === kastell && Lex.aufloesenFuerArt(T, 'rom', undefined) === kastell && Lex.aufloesenFuerArt(T, 'rom', 'aussenposten') === kastell && Lex.aufloesenFuerArt(T, 'rom', 'ruine') === kastell, 'rom: andere/keine Kartenart identisch zu aufloesen');
for (const bw of ['germanen', 'vorlaeufer', null, 'gibtsnicht']) for (const art of ['schiff', 'station', null]) ok(Lex.aufloesenFuerArt(T, bw, art) === Lex.aufloesen(T, bw), `${bw}/${art}: identisch zu aufloesen`);
// Rueckfall: Schluessel, den art.schiff nicht fuehrt, kommt aus eintraege der Bauweise
ok(Lex.aufloesenFuerArt('{{lex.fund}} / {{lex.zelle}}', 'rom', 'schiff') === Lex.aufloesen('{{lex.fund}} / {{lex.zelle}}', 'rom'), 'rom/schiff: fehlender Schluessel faellt auf eintraege zurueck');
// Formen (Genus/Plural) vollstaendig, auch fuer jede art-Variante
for (const k of Object.keys(Lex.laden().lex.rom.art.schiff.eintraege)) {
  if (k === 'ort_muster' || k === 'wachen') continue;
  const e = Lex.eintragFuerArt(k, 'rom', 'schiff');
  ok(e && e.genus && e.plural, `art.schiff.${k}: genus und plural`);
}
ok(Lex.offene('{{lex.terminal:der}} {{lex.sprengpunkt:den}} {{lex.herzstueck:zum}} {{lex.abholpunkt:pl}} {{lex.ziel:ein}}').length === 0, 'Pruefer meldet die Formen aller Varianten ohne Fehler');
ok(Lex.laengste('{{lex.ziel}}') >= Math.max(Lex.aufloesenFuerArt('{{lex.ziel}}', 'rom', 'schiff').length, 1), 'laengste beruecksichtigt die Variante');
// artVon: Kartenart aus Landepunkt-Eintrag, Handkarte/leer = null
ok(Lex.artVon({ landepunkte: { eintraege: { m1: { art: 'schiff' } } } }, 'm1') === 'schiff' && Lex.artVon({ landepunkte: { dyn: { m2: { art: 'hand' } } } }, 'm2') === null && Lex.artVon({}, null) === null, 'artVon: Eintrag, hand, leer');

// Verdrahtung: Mission.tpl loest {{lex.*}} ueber die Kartenart des Landepunkts auf (server/sim/mission.js tpl -> lexBauweise/lexArt -> Lexikon.aufloesenFuerArt).
// Faellt die Zeile auf Lexikon.aufloesen(text, bauweise) zurueck, bleibt das Rom-Schiff beim Kastell-Wort (Mutationsprobe im Bericht SCH-02 Nacharbeit).
{
  const path = require('path');
  process.chdir(path.join(__dirname, '..'));
  const { Mission } = require('../server/sim/mission.js');
  const mission = (eintrag) => new Mission({ landepunkte: { dyn: { kz: eintrag } }, aways: {}, countError() { /* kein @-Text */ } });
  const def = { buehne: { aussenkarten: ['kz'] } };   // einzige Aussenkarte der Buehne = Landepunkt (lexKarte)
  const TT = 'Lies {{lex.terminal:den}} und sprenge {{lex.sprengpunkt:den}}.';
  const m = (eintrag) => mission(eintrag).tpl(TT, def);
  const rS = m({ art: 'schiff', bauweise: 'rom' });
  ok(/Logbuchpult/.test(rS) && /Reaktorkern/.test(rS) && !/Wachbuch|Pulverkammer/.test(rS), 'Mission.tpl: Landepunkt art schiff + bauweise rom -> Logbuchpult/Reaktorkern (' + rS + ')');
  ok(rS === Lex.aufloesenFuerArt(TT, 'rom', 'schiff'), 'Mission.tpl rom/schiff = Lexikon.aufloesenFuerArt');
  ok(m({ art: 'station', bauweise: 'rom' }) === Lex.aufloesen(TT, 'rom') && m({ art: 'aussenposten', bauweise: 'rom' }) === Lex.aufloesen(TT, 'rom'), 'Mission.tpl rom/station und rom/aussenposten: unveraendert');
  ok(/Wachbuch/.test(m({ art: 'station', bauweise: 'rom' })), 'Mission.tpl rom/station: weiter Kastell-Wort (Wachbuch)');
  ok(m({ art: 'schiff', bauweise: 'germanen' }) === Lex.aufloesen(TT, 'germanen') && m({ art: 'station', bauweise: 'germanen' }) === Lex.aufloesen(TT, 'germanen'), 'Mission.tpl germanen (Schiff und Station): unveraendert');
  ok(mission({ art: 'hand' }).tpl(TT, def) === Lex.aufloesen(TT, null), 'Mission.tpl Handkarte ohne Bauweise: neutral wie zuvor');
}

console.log(`\n${n - bad}/${n} ok${bad ? ', ' + bad + ' FEHLER' : ''}`);
process.exit(bad ? 1 : 0);
