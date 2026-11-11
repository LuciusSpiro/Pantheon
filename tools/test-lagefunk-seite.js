'use strict';
// FRE-04b: Lagefunk nennt die Seite (B1) und die Auswahl der Übersichtskarte folgt der Lerche (B6)
//   Hafen/Posten x Rom verliert / Rom gewinnt / ohne Rom: Text, Logzeile, Pool-Kennung (nur bei Roms Verlust)
//   KarteLage.auswahlFolgen: folgt dem Anker, manuelle Auswahl gilt bis sich der Anker ändert
//   node tools/test-lagefunk-seite.js
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const Wissen = require('../server/sim/kriegslage-wissen.js');
const KL = require('../public/js/karte-lage.js');
const Kern = require('../server/weltsim/kern.js');
const Daten = require('../server/weltsim/daten.js');
const TextePool = require('../server/sim/texte-pool.js');

let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const d = { hex: { '0403': { name: 'Speculum' }, '0603': { name: 'Kantenstein' } } };
const hf = (f, eigen) => Wissen.funkVerlust(d, 5, { e: 'hf', h: '0403', f, eigen });
const pv = (f, dd) => Wissen.funkVerlust(d, 5, { e: 'pv', h: '0603', f, d: dd, eigen: f === 'r' });

console.log('\nHafen');
let v = hf('g', true);
ok(v.text === 'Speculum ist an die Germanen gefallen.' && v.romVerliert === true && v.log === 'Gefallen an die Germanen. Tick 5.', 'Rom verliert: „… ist an die Germanen gefallen.“, Pool erlaubt');
v = hf('k', true); ok(v.text === 'Speculum ist an das Konkordat gefallen.', 'Rom verliert an das Konkordat');
v = hf('r', true);
ok(v.text === 'Speculum ist in römischer Hand.' && v.romVerliert === false && !/gefallen|verloren/.test(v.text + v.log), 'Rom gewinnt: „… ist in römischer Hand.“, kein Pool, kein „gefallen/verloren“');
v = hf('p', false);
ok(v.text === 'Speculum hat einen neuen Herrn: Piraten.' && v.romVerliert === false, 'ohne Rom: neuer Herr genannt, kein Pool');

console.log('\nPosten');
v = pv('r', 'g');
ok(v.text === 'Posten Kantenstein an die Germanen verloren.' && v.romVerliert === true, 'römischer Posten verloren an die Germanen, Pool erlaubt');
v = pv('r', '-'); ok(v.text === 'Posten Kantenstein verloren.' && v.romVerliert === true, 'römischer Posten, Gegenseite unbekannt: schlichte Fassung');
v = pv('g', 'r');
ok(v.text === 'Posten Kantenstein (Germanen) durch Rom ausgeschaltet.' && v.romVerliert === false && !/gefallen|verloren/.test(v.text + v.log), 'Rom nimmt fremden Posten: kein „verloren“, kein Pool');
v = pv('g', 'p'); ok(v.text === 'Posten Kantenstein (Germanen) durch die Piraten ausgeschaltet.' && v.romVerliert === false, 'fremd gegen fremd: beide Seiten genannt');
v = pv('g', '-'); ok(v.text === 'Posten Kantenstein (Germanen) ausgeschaltet.', 'fremd, Sieger unbekannt');

console.log('\nPool-Sperre: kein Pool-Text bei römischem Gewinn (M1)');
{
  const D = Daten.laden(), z = Kern.erzeuge({ karte: D.karte, werte: D.werte, seed: 3 }), dd = Daten.datenVon(z);
  const lauf = (W, ev) => Wissen.berechne(W, { z, d: dd, T: 5, vor: null, prev: null, lerche: null, ereignisse: ev });
  const hfEv = (ort, alt, neu) => ({ typ: 'hafen_gefallen', tick: 5, fraktion: neu, ort, ortName: ort, alt, neu });
  const pvEv = (ort, besitzer, durch) => ({ typ: 'posten_verloren', tick: 5, fraktion: besitzer, ort, ortName: ort, besitzer, durch });
  const gerufen = [];
  const orig = TextePool.poolText;
  TextePool.poolText = (game, art, id) => { gerufen.push(id); return 'POOL ' + id; };
  const ausgabe = (aus) => { const radio = []; Wissen.ausgeben({ emit: (k, x) => { if (k === 'radio') radio.push(x.text); } }, aus); return radio; };
  try {
    // Hafen: Rom gewinnt (alt ger, neu rom) -> Vorlage, Pool nie gefragt; Rom verliert (alt rom, neu ger) -> Pool-Text
    const r1 = lauf(Wissen.neuLeer(), [hfEv('0403', 'ger', 'rom'), hfEv('0404', 'rom', 'ger')]);
    const f1 = r1.aus.funk;
    ok(f1.length === 2 && f1[0].verlust === null && f1[1].verlust && f1[1].verlust.id === 'hafen_gefallen', 'berechne: Hafen, den Rom gewinnt, ohne Pool-Kennung; den Rom verliert, mit');
    const rad = ausgabe(r1.aus);
    ok(rad[0] === 'Speculum ist in römischer Hand.', 'ausgeben: bei römischem Gewinn kein Pool-Text');
    ok(rad[1] === 'POOL hafen_gefallen' && gerufen.join() === 'hafen_gefallen', 'ausgeben: bei römischem Verlust der Pool-Text (Pool genau einmal gefragt)');
    // Posten: Rom nimmt einen fremden Posten (spätere Meldung, Rom hält das Hex dann) -> kein Pool; Rom verliert einen Posten -> Pool
    gerufen.length = 0;
    z.hexe['0603'].besitzer = 'rom';
    const r2a = lauf(Wissen.neuLeer(), [pvEv('0603', 'ger', 'rom')]);
    const r2 = lauf(r2a.W, [pvEv('0605', 'rom', 'ger')]);
    const f2 = r2a.aus.funk.concat(r2.aus.funk).filter((f) => /^Posten/.test(f.text));
    ok(f2.some((f) => /ausgeschaltet/.test(f.text) && f.verlust === null), 'berechne: Posten, den Rom nimmt, ohne Pool-Kennung');
    ok(f2.some((f) => /verloren/.test(f.text) && f.verlust && f.verlust.id === 'posten_verloren'), 'berechne: Posten, den Rom verliert, mit Pool-Kennung');
    const rad2 = ausgabe({ funk: f2, markenSetzen: [], markenEntfernen: [] });
    ok(rad2.filter((t) => /ausgeschaltet/.test(t)).length === 1 && gerufen.join() === 'posten_verloren', 'ausgeben: Posten-Gewinn ohne Pool-Text, Posten-Verlust mit');
  } finally { TextePool.poolText = orig; }
}

console.log('\nAuswahl folgt der Lerche (B6)');
const zs = { sel: null, manuell: false, anker: null };
const gilt = () => true;
ok(KL.auswahlFolgen(zs, 'ostia', gilt) && zs.sel === 'ostia', 'erste Belegung: Ort der Lerche');
ok(!KL.auswahlFolgen(zs, 'ostia', gilt) && zs.sel === 'ostia', 'unverändert: keine Änderung');
ok(KL.auswahlFolgen(zs, 'gull', gilt) && zs.sel === 'gull', 'Lerche wechselt, nichts angeklickt: Auswahl folgt');
zs.sel = 'eis'; zs.manuell = true;
ok(!KL.auswahlFolgen(zs, 'gull', gilt) && zs.sel === 'eis' && zs.manuell, 'manuelle Auswahl bleibt, solange der Anker gleich ist');
ok(KL.auswahlFolgen(zs, 'skj', gilt) && zs.sel === 'skj' && !zs.manuell, 'Ort/Sprungziel der Lerche ändert sich: Auswahl folgt wieder');
zs.sel = 'weg'; zs.manuell = true;
ok(KL.auswahlFolgen(zs, 'skj', (id) => id !== 'weg') && zs.sel === 'skj', 'manuelle Auswahl nicht mehr gültig: zurück zur Lerche');

console.log('\nMeldeliste (M2)');
{
  const name = (h) => ({ '0403': 'Speculum', '0603': 'Kantenstein' }[h] || h);
  const zt = (ev) => KL.zeilenText({ ereignis: ev }, { name }, false);
  ok(zt({ e: 'hf', h: '0403', f: 'r' }) === 'Speculum römisch', 'Meldeliste: Hafen, den Rom gewinnt: „… römisch“');
  ok(zt({ e: 'hf', h: '0403', f: 'g' }) === 'Speculum gefallen', 'Meldeliste: Hafen gefallen bleibt „… gefallen“');
  ok(zt({ e: 'pv', h: '0603', f: 'g' }) === 'Posten Kantenstein ausgeschaltet', 'Meldeliste: fremder Posten ausgeschaltet');
  ok(zt({ e: 'pv', h: '0603', f: 'r' }) === 'Posten Kantenstein verloren', 'Meldeliste: römischer Posten bleibt „verloren“');
}

console.log('\nBeschriftung');
const rec = [];
const ctx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? (s) => ({ width: String(s).length * 5 }) : typeof k === 'string' && k !== 'canvas' ? (k === 'fillText' ? (s) => rec.push(String(s)) : () => {}) : undefined), set: () => true });
const A = { stufe: () => 'jetzt', hex: {}, fl: [], m: [], neu: new Set(), codes: [] };
const o = (sel, hier, ausgewaehlt) => ({ rx: 0, y: 0, rw: 200, sel, hier, ausgewaehlt: ausgewaehlt !== false, name: (h) => h, art: () => '', hafen: () => '', karteFraktion: () => '-', dist: () => undefined, maxZeilen: 4, verborgen: () => false });
KL.env.Render = { text: (c, s) => rec.push(String(s)), measure: (s) => String(s).length * 6 };
try {
  rec.length = 0; KL.ortsinfo(ctx, A, o('0403', '0403'));
  ok(rec.some((s) => s.startsWith('ORT · SEKTOR 0403')), 'Auswahl = Lerchenort: „ORT“');
  rec.length = 0; KL.ortsinfo(ctx, A, o('0403', '1003'));
  ok(rec.some((s) => s.startsWith('AUSWAHL · SEKTOR 0403')), 'manuelle Auswahl ≠ Lerche: „AUSWAHL“');
  rec.length = 0; KL.ortsinfo(ctx, A, o('0403', '1003', false));
  ok(rec.some((s) => s.startsWith('ORT · SEKTOR 0403')) && !rec.some((s) => /^AUSWAHL/.test(s)), 'Hover ≠ Lerche, keine Auswahl: „ORT“, nicht „AUSWAHL“');
} catch (e) { ok(false, 'ortsinfo mit Zeichen-Stub: ' + e.message); }

console.log(fails ? `\n${fails} FEHLER` : '\nalle ok');
process.exit(fails ? 1 : 0);
