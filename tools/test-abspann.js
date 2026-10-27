'use strict';
// SUND-04a-3: Abspaenne der Freien Fahrt Sund (server/sim/abspann.js, content/welt/abspann.json). Direkt gegen die Game-Klasse, ohne Netz.
// Die Erwartungen stammen aus dem VERTRAG und den DATEN (Texte aus abspann.json, Zahlen aus bekannten Fixtures), nie aus einem Nachbau des Produktivcodes.
//   Daten und Sprache `wenn` · Fakten aus bekannten Staenden · bauen (jeder Bedingungsblock genau dann, wenn er soll) · beenden idempotent, Marker auch ungedockt gespeichert ·
//   Laden mit und ohne Marker · Palatina faellt / Hrafnheim faellt ohne Finale (konstruierter Zustand, echter Tick) · Kampagne und ohne Weltsim unberuehrt · Weltstand gueltig,
//   main liest den Stand · Layout des Abspanns (Schlusszeile letzte Zeile, sichtbar, Kampagnen-Abspann unveraendert).
//   node tools/test-abspann.js [begriff …]   (npm run test:abspann)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
process.chdir(path.join(__dirname, '..'));
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const Weltstand = require('../server/weltstand.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Chronik = require('../server/sim/chronik.js');
const Abspann = require('../server/sim/abspann.js');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, fn) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n' + name);
  try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
}
const kopie = (o) => JSON.parse(JSON.stringify(o));
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const DOC = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'welt', 'abspann.json'), 'utf8'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-abspann-'));
let seq = 0;
const freshDir = () => { const d = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(d, { recursive: true }); return d; };
const HZ = CONFIG.tickHz;
const run = (g, sek) => { for (let i = 0; i < Math.round(sek * HZ); i++) g.step(); };
const ENV = () => ({ MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') });
const SCHLUSS = 'Hätte Palatina nur jemand retten können.';

function neu(o) {
  o = o || {};
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: o.dir || freshDir(), seed: o.seed || 7, debug: true, env: ENV(), log: () => {} });
  const c = { inbox: [], send(m) { if (this.inbox.length < 600) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'A0', name: 'A0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: o.start || 'freie_fahrt' });
  g.handleMessage(c, { t: 'ready', ready: true });
  run(g, 1);
  g.space.enemies = [];
  return { g, c };
}
const ungedockt = (g) => { const s = g.ship; s.docked = false; s.dockedAt = null; s.helm.stage = 1; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; };
const weltDatei = (dir) => { const f = fs.readdirSync(dir).find((x) => /^w-.*\.json$/.test(x) && !/bak/.test(x)); return f ? path.join(dir, f) : null; };
const lesen = (dir) => JSON.parse(fs.readFileSync(weltDatei(dir), 'utf8'));
const idVon = (dir) => path.basename(weltDatei(dir), '.json');
function laden(dir, id, seed) {
  Weltstand.unlock(dir, id);
  const g2 = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: seed || 7, debug: true, env: ENV(), log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g2.addConnection(c); g2.handleMessage(c, { t: 'hello', clientId: 'A0', name: 'A0', color: 0 });
  g2.continueWorld(id); run(g2, 2);
  return { g2, c };
}
const endings = (c) => c.inbox.filter((m) => m.t === 'event' && m.kind === 'ending');

// Hilfen auf den DATEN: Block mit Id, Zeilentexte (Reihenfolge der Datei)
const blockDaten = (art, id) => DOC.abspaenne[art].bloecke.find((b) => b.id === id);
const texteVon = (art, id) => blockDaten(art, id).zeilen.map((z) => (typeof z === 'string' ? z : z.text));
const erwartet = (art, id, idx) => { const b = blockDaten(art, id); const t = texteVon(art, id); return { kopf: b.kopf, zeilen: idx ? idx.map((i) => t[i]) : t }; };
const zeilenAus = (a) => a.bloecke.reduce((s, b) => s.concat(b.zeilen), []);

const FAKTEN = (o) => Object.assign({ haefenVerloren: 0, postenVerloren: 0, rang: 'miles', rangName: 'Miles', kommandantenGefallen: 0, faedenAusgang: {}, chronikZahl: 0, hauptweltGefallen: false, finaleGespielt: false }, o || {});

// =============================================================================================================================
section('Daten und Schema', () => {
  ok(gleich(Abspann.pruefen(DOC), []), 'content/welt/abspann.json besteht Schema und Regeln (keine Fehler)');
  ok(DOC.format === 'abspann/1' && Object.keys(DOC.abspaenne).sort().join() === 'palatina,sieg', 'Format abspann/1, genau die Abspaenne palatina und sieg');
  ok(DOC.abspaenne.palatina.schluss === SCHLUSS, 'palatina.schluss ist exakt „Hätte Palatina nur jemand retten können.“');
  const mitWenn = DOC.abspaenne.palatina.bloecke.filter((b) => b.wenn !== undefined || b.zeilen.some((z) => typeof z === 'object' && z.wenn));
  ok(mitWenn.length >= 3, `palatina: mindestens drei Bloecke mit Bedingungen (${mitWenn.length})`);
  const verwendet = JSON.stringify(DOC.abspaenne.palatina.bloecke);
  ok(/rang_(min|max)/.test(verwendet) && /haefenVerloren/.test(verwendet) && /faedenAusgang/.test(verwendet), 'palatina: Bedingungen auf Rang, Haefen-Verluste und Faeden-Ausgaenge');
  const alleTexte = [DOC.abspaenne.palatina.text].concat(DOC.abspaenne.palatina.bloecke.reduce((s, b) => s.concat(b.zeilen.map((z) => (typeof z === 'string' ? z : z.text))), []));
  ok(!alleTexte.some((t) => /\d/.test(t)), 'palatina: keine Zahl in den Texten („viele ließen ihr Leben“ ohne Zahl)');
  ok(/viele ließen ihr Leben/i.test(alleTexte.join(' ')) && /Sektor/.test(DOC.abspaenne.palatina.text + ' ' + alleTexte.join(' ')), 'palatina: der Sektor geht verloren, viele ließen ihr Leben');
  const sm = DOC.abspaenne.sieg.bloecke;
  ok(sm.some((b) => b.wenn && b.wenn.finaleGespielt === false) && sm.some((b) => b.wenn && /rang_/.test(JSON.stringify(b.wenn))) && JSON.stringify(sm).includes('faedenAusgang'), 'sieg: Bloecke fuer kampflos/Finale, Rang und Faeden');
  ok(!/Kai|Spieler/.test(JSON.stringify(DOC.abspaenne)), 'keine Spielernamen in den Daten');
  // Jede Zeile hoechstens 70 Zeichen (Schema) und passt in die Spalte (400 px bei 5 px je Zeichen)
  const langste = Math.max(...['palatina', 'sieg'].map((a) => Math.max(...DOC.abspaenne[a].bloecke.map((b) => Math.max(...b.zeilen.map((z) => (typeof z === 'string' ? z : z.text).length))))));
  ok(langste <= 70, `laengste Zeile ${langste} Zeichen (Spalte fasst 80)`);
});

section('Datenfehler: unbekannte Schluessel und Operatoren werden nie still ignoriert', () => {
  const fehlerMit = (w) => Abspann.wennPruefen(w).length > 0;
  ok(fehlerMit({ unbekannt: 1 }), 'unbekannter Schluessel');
  ok(fehlerMit({ haefenVerloren: { gleich: 1 } }), 'unbekannter Operator in einer Zahlenbedingung');
  ok(fehlerMit({ haefenVerloren: 1 }) && fehlerMit({ haefenVerloren: {} }) && fehlerMit({ haefenVerloren: { min: -1 } }) && fehlerMit({ haefenVerloren: { min: 1.5 } }) && fehlerMit({ haefenVerloren: { min: 3, max: 1 } }), 'Zahlenbedingung: Zahl statt Objekt, leer, negativ, nicht ganz, min > max');
  ok(fehlerMit({ rang_min: 'general' }) && fehlerMit({ rang_max: 3 }), 'unbekannter Rang');
  ok(fehlerMit({ faedenAusgang: { falscher_haendler: 'vielleicht' } }) && fehlerMit({ faedenAusgang: { gibt_es_nicht: 'gelungen' } }) && fehlerMit({ faedenAusgang: {} }), 'Faeden: unbekannter Ausgang, unbekannte Vorlage, leer');
  ok(fehlerMit({ finaleGespielt: 'ja' }) && fehlerMit({ hauptweltGefallen: 1 }), 'Wahrheitswerte muessen wahr/falsch sein');
  ok(fehlerMit({}) && fehlerMit([]) && fehlerMit(null) && fehlerMit('x'), 'leere und falsche Bedingung');
  ok(fehlerMit({ nicht: { unbekannt: true } }) && fehlerMit({ oder: [] }) && fehlerMit({ oder: [{ rang_min: 'xx' }] }), 'nicht/oder pruefen ihre Teile');
  ok(!fehlerMit({ rang_min: 'tribun', haefenVerloren: { min: 1, max: 4 }, faedenAusgang: { falscher_haendler: 'laufend' }, nicht: { finaleGespielt: true }, oder: [{ rang_min: 'legat' }, { hauptweltGefallen: false }] }), 'gueltige Bedingung ohne Fehler');
  let wirft = false; try { Abspann.wennGilt({ unbekannt: 1 }, FAKTEN()); } catch (e) { wirft = true; }
  ok(wirft, 'wennGilt wirft bei unbekanntem Schluessel (statt wahr oder falsch zu raten)');
  // Daten mit Fehler: pruefen meldet es
  const d1 = kopie(DOC); d1.abspaenne.palatina.bloecke[1].wenn = { haefenVerloren: { gleich: 0 } };
  ok(Abspann.pruefen(d1).some((m) => /operator/i.test(m)), 'Datei mit unbekanntem Operator: pruefen meldet ihn');
  const d2 = kopie(DOC); d2.abspaenne.sieg.bloecke[0].zeilen = [{ text: 'x', wenn: { rang_min: 'kaiser' } }];
  ok(Abspann.pruefen(d2).length > 0, 'Datei mit unbekanntem Rang in einer Zeile: Fehler');
  const d3 = kopie(DOC); d3.abspaenne.palatina.bloecke[1].id = d3.abspaenne.palatina.bloecke[0].id;
  ok(Abspann.pruefen(d3).some((m) => /doppelte Id/.test(m)), 'doppelte Block-Id: Fehler');
  const d4 = kopie(DOC); delete d4.abspaenne.sieg;
  ok(Abspann.pruefen(d4).length > 0, 'Abspann sieg fehlt: Fehler');
  const d5 = kopie(DOC); d5.format = 'abspann/2';
  ok(Abspann.pruefen(d5).length > 0, 'falsches Format: Fehler');
  const d6 = kopie(DOC); d6.abspaenne.palatina.zusatz = 1;
  ok(Abspann.pruefen(d6).length > 0, 'unbekanntes Feld im Abspann: Fehler');
});

section('wenn-Sprache: je Operator', () => {
  const G = (w, f) => Abspann.wennGilt(w, FAKTEN(f));
  ok(G({ rang_min: 'centurio' }, { rang: 'centurio' }) && G({ rang_min: 'centurio' }, { rang: 'legat' }) && !G({ rang_min: 'centurio' }, { rang: 'optio' }), 'rang_min: ab dem Rang');
  ok(G({ rang_max: 'optio' }, { rang: 'miles' }) && G({ rang_max: 'optio' }, { rang: 'optio' }) && !G({ rang_max: 'optio' }, { rang: 'centurio' }), 'rang_max: bis zum Rang');
  ok(G({ rang_min: 'optio', rang_max: 'tribun' }, { rang: 'centurio' }) && !G({ rang_min: 'optio', rang_max: 'tribun' }, { rang: 'legat' }), 'beide Raenge: Band (alle Schluessel gelten zugleich)');
  ok(G({ haefenVerloren: { min: 1 } }, { haefenVerloren: 1 }) && !G({ haefenVerloren: { min: 1 } }, { haefenVerloren: 0 }), 'min');
  ok(G({ haefenVerloren: { max: 0 } }, { haefenVerloren: 0 }) && !G({ haefenVerloren: { max: 0 } }, { haefenVerloren: 1 }), 'max');
  ok(G({ postenVerloren: { min: 2, max: 3 } }, { postenVerloren: 3 }) && !G({ postenVerloren: { min: 2, max: 3 } }, { postenVerloren: 4 }) && !G({ postenVerloren: { min: 2, max: 3 } }, { postenVerloren: 1 }), 'min und max zusammen, Grenzen eingeschlossen');
  ok(G({ kommandantenGefallen: { min: 1 } }, { kommandantenGefallen: 5 }) && G({ chronikZahl: { min: 10 } }, { chronikZahl: 10 }) && !G({ chronikZahl: { min: 10 } }, { chronikZahl: 9 }), 'kommandantenGefallen und chronikZahl');
  ok(G({ faedenAusgang: { falscher_haendler: 'gelungen' } }, { faedenAusgang: { falscher_haendler: 'gelungen' } }) && !G({ faedenAusgang: { falscher_haendler: 'gelungen' } }, { faedenAusgang: { falscher_haendler: 'gescheitert' } }) && !G({ faedenAusgang: { falscher_haendler: 'gelungen' } }, { faedenAusgang: {} }), 'faedenAusgang: gleicher Ausgang; fehlender Faden gilt nie');
  ok(G({ faedenAusgang: { falscher_haendler: 'gelungen', dankbarer_captain: 'laufend' } }, { faedenAusgang: { falscher_haendler: 'gelungen', dankbarer_captain: 'laufend' } }) && !G({ faedenAusgang: { falscher_haendler: 'gelungen', dankbarer_captain: 'laufend' } }, { faedenAusgang: { falscher_haendler: 'gelungen' } }), 'zwei Faeden: beide muessen passen');
  ok(G({ finaleGespielt: false }, { finaleGespielt: false }) && !G({ finaleGespielt: false }, { finaleGespielt: true }) && G({ finaleGespielt: true }, { finaleGespielt: true }), 'finaleGespielt');
  ok(G({ hauptweltGefallen: true }, { hauptweltGefallen: { fraktion: 'rom', tick: 4 } }) && G({ hauptweltGefallen: false }, { hauptweltGefallen: false }) && !G({ hauptweltGefallen: true }, { hauptweltGefallen: false }), 'hauptweltGefallen: Objekt gilt als wahr');
  ok(G({ nicht: { rang_min: 'tribun' } }, { rang: 'optio' }) && !G({ nicht: { rang_min: 'tribun' } }, { rang: 'legat' }), 'nicht');
  ok(G({ oder: [{ rang_min: 'legat' }, { haefenVerloren: { min: 2 } }] }, { rang: 'miles', haefenVerloren: 2 }) && !G({ oder: [{ rang_min: 'legat' }, { haefenVerloren: { min: 2 } }] }, { rang: 'miles', haefenVerloren: 1 }), 'oder');
});

// =============================================================================================================================
section('Fakten aus bekannten Weltstaenden', () => {
  const { g } = neu({ seed: 3 });
  const ws = g.weltsim, z = ws.zustand;
  // Anfangsstand der Freien Fahrt: alles neutral
  const f0 = Abspann.fakten(g);
  ok(f0.haefenVerloren === 0 && f0.postenVerloren === 0 && f0.rang === 'miles' && f0.rangName === 'Miles' && f0.kommandantenGefallen === 0 && gleich(f0.faedenAusgang, {}) && f0.chronikZahl === 0 && f0.hauptweltGefallen === false && f0.finaleGespielt === false, 'Anfangsstand: alles neutral, Rang Miles');
  // Fixture: Carrara (0105) und Campania (0203) sind roemische Haefen der Karte; Palatina (0204) ist die Hauptwelt Roms und zaehlt nicht mit
  z.hexe['0105'].besitzer = 'ger'; z.hexe['0203'].besitzer = 'pirat'; z.hexe['0204'].besitzer = 'ger';
  ws.ruf.rom = 55;   // Tribun ab 50, Legat ab 180
  ws.kommandanten = { A: { fraktion: 'ger', schicksal: 'gefallen', begegnungen: 1, tick: 1 }, B: { fraktion: 'ger', schicksal: 'entkommen', begegnungen: 1, tick: 2 }, C: { fraktion: 'pirat', schicksal: 'gefallen', begegnungen: 2, tick: 3 } };
  ws.faeden.liste = [
    { vorlage: 'falscher_haendler', ausgang: { art: 'gelungen', status: 'verbuendet', tick: 5 } },
    { vorlage: 'falscher_haendler', ausgang: { art: 'gescheitert', status: 'aktiv', tick: 3 } },
    { vorlage: 'falscher_haendler', ausgang: null },
    { vorlage: 'dankbarer_captain', ausgang: null },
    { vorlage: 'entfuehrter_haendler', ausgang: { art: 'gescheitert', status: 'tot', tick: 9 } },
  ];
  ws.chronik = [];
  Chronik.eintragen(g, { art: 'posten', ref: '0505', kurz: 'Posten gefallen: Brachland an ger' });
  Chronik.eintragen(g, { art: 'posten', ref: '0603', kurz: 'Posten gegründet: Gasfeld' });
  Chronik.eintragen(g, { art: 'posten', ref: '0603', kurz: 'Posten gefallen: Gasfeld an pirat' });
  Chronik.eintragen(g, { art: 'welt', ref: '0105', kurz: 'Hafen gefallen: Carrara (rom an ger)' });
  ws.hauptweltGefallen = { fraktion: 'rom', tick: 12 };
  g.weltstand.fact('finale_gespielt', true, 'test');
  const f = Abspann.fakten(g);
  ok(f.haefenVerloren === 2, `zwei Haefen verloren (Carrara, Campania), Palatina nicht mitgezaehlt (${f.haefenVerloren})`);
  ok(f.postenVerloren === 2, `zwei Posten der Crew gefallen (${f.postenVerloren}); Gruendung und Hafen zaehlen nicht`);
  ok(f.rang === 'tribun' && f.rangName === 'Tribun', `Rang Tribun bei Ruf 55 (${f.rang}/${f.rangName})`);
  ok(f.kommandantenGefallen === 2, `zwei gefallene Kommandanten (${f.kommandantenGefallen})`);
  ok(gleich(f.faedenAusgang, { falscher_haendler: 'gelungen', dankbarer_captain: 'laufend', entfuehrter_haendler: 'gescheitert' }), 'Faeden: ein gelungener genuegt, ohne Ausgang = laufend, gescheitert');
  ok(f.chronikZahl === 4, `Chronik zaehlt vier Eintraege (${f.chronikZahl})`);
  ok(gleich(f.hauptweltGefallen, { fraktion: 'rom', tick: 12 }), 'Hauptwelt gefallen mit Fraktion und Tick');
  ok(f.finaleGespielt === true, 'Fakt finale_gespielt = true: finaleGespielt');
  // Rangwechsel an den Schwellen
  ws.ruf.rom = 49; ok(Abspann.fakten(g).rang === 'centurio', 'Ruf 49: Centurio');
  ws.ruf.rom = 180; ok(Abspann.fakten(g).rang === 'legat', 'Ruf 180: Legat');
  // rein lesend
  const vor = JSON.stringify([ws.zustand.hexe, ws.chronik, ws.faeden.liste, ws.kommandanten, ws.ruf, g.weltstand.data.fakten]);
  Abspann.fakten(g); Abspann.fakten(g);
  ok(vor === JSON.stringify([ws.zustand.hexe, ws.chronik, ws.faeden.liste, ws.kommandanten, ws.ruf, g.weltstand.data.fakten]), 'fakten() aendert nichts');
  // Altstand ohne Bloecke und Muell: neutrale Vorgaben, kein Wurf
  ws.chronik = undefined; ws.faeden = undefined; ws.kommandanten = undefined; ws.ruf = undefined; ws.hauptweltGefallen = null;
  const fa = Abspann.fakten(g);
  ok(fa.postenVerloren === 0 && fa.chronikZahl === 0 && fa.kommandantenGefallen === 0 && gleich(fa.faedenAusgang, {}) && fa.rang === 'miles' && fa.hauptweltGefallen === false, 'Altstand ohne Chronik, Faeden, Kommandanten, Ruf: neutrale Vorgaben');
  ws.faeden = { liste: [null, 5, 'x', { vorlage: 7 }, { vorlage: 'falscher_haendler', ausgang: { art: 'kaputt' } }] }; ws.chronik = [null, 3, { art: 'posten' }]; ws.kommandanten = { x: null, y: 7 };
  const fm = Abspann.fakten(g);
  ok(gleich(fm.faedenAusgang, { falscher_haendler: 'laufend' }) && fm.postenVerloren === 0 && fm.kommandantenGefallen === 0, 'Muell in den Listen: ignoriert, kein Wurf (ein Faden mit kaputtem Ausgang gilt als laufend)');
  z.hexe = undefined;
  ok(Abspann.fakten(g).haefenVerloren === 0, 'Sim-Zustand ohne Hexe: 0, kein Wurf');
  const k = Abspann.fakten({});
  ok(k.haefenVerloren === 0 && k.rang === 'miles' && gleich(k.faedenAusgang, {}) && k.finaleGespielt === false, 'ohne Weltsim (Kampagne): neutrale Vorgaben');
  ok(Abspann.fakten(null).rang === 'miles', 'null: neutrale Vorgaben');
});

// =============================================================================================================================
section('bauen: jeder Bedingungsblock erscheint genau dann, wenn er soll', () => {
  const P = (o) => Abspann.bauen(FAKTEN(o), 'palatina');
  const S = (o) => Abspann.bauen(FAKTEN(o), 'sieg');
  const a = P({ rang: 'miles', haefenVerloren: 0 });
  ok(a.titel === DOC.abspaenne.palatina.titel && a.text === DOC.abspaenne.palatina.text && a.schluss === SCHLUSS, 'palatina: Titel, Text und exakter Schluss aus den Daten');
  ok(gleich(a.bloecke, [erwartet('palatina', 'sektor'), erwartet('palatina', 'haefen_gehalten'), erwartet('palatina', 'rang_niedrig')]), 'Miles, keine Verluste, keine Faeden: Sektor, Haefen gehalten, Rolle niedrig (Geschichten ohne Zeile entfallen)');
  const b = P({ rang: 'optio', haefenVerloren: 2, postenVerloren: 1, kommandantenGefallen: 3, faedenAusgang: { falscher_haendler: 'gescheitert', dankbarer_captain: 'gelungen' } });
  ok(gleich(b.bloecke, [erwartet('palatina', 'sektor'), erwartet('palatina', 'haefen_verloren'), erwartet('palatina', 'rang_niedrig'),
    { kopf: 'DIE GESCHICHTEN', zeilen: [texteVon('palatina', 'geschichten')[0], texteVon('palatina', 'geschichten')[4]] }, erwartet('palatina', 'gefallene'), erwartet('palatina', 'posten')]),
  'Optio, zwei Haefen, Posten, Gefallene, zwei Faeden: genau diese Bloecke und genau die zwei passenden Zeilen, in Dateireihenfolge');
  ok(gleich(P({ rang: 'centurio' }).bloecke.map((x) => x.zeilen), [texteVon('palatina', 'sektor'), texteVon('palatina', 'haefen_gehalten'), texteVon('palatina', 'rang_mittel')]), 'Centurio: nur der mittlere Rollenblock');
  ok(gleich(P({ rang: 'tribun' }).bloecke[2], erwartet('palatina', 'rang_hoch')) && gleich(P({ rang: 'legat' }).bloecke[2], erwartet('palatina', 'rang_hoch')), 'Tribun und Legat: der hohe Rollenblock');
  for (const r of ['miles', 'optio', 'centurio', 'tribun', 'legat']) {
    const rollen = P({ rang: r }).bloecke.filter((x) => x.kopf === 'EURE ROLLE');
    ok(rollen.length === 1, `Rang ${r}: genau ein Rollenblock (${rollen.length})`);
  }
  ok(P({ haefenVerloren: 0 }).bloecke.filter((x) => x.kopf === 'DIE HÄFEN').length === 1 && P({ haefenVerloren: 1 }).bloecke.filter((x) => x.kopf === 'DIE HÄFEN').length === 1 && P({ haefenVerloren: 1 }).bloecke.find((x) => x.kopf === 'DIE HÄFEN').zeilen[0] === texteVon('palatina', 'haefen_verloren')[0], 'Haefen 0 und >= 1: je genau ein Block, die Grenze liegt bei 1');
  ok(!P({}).bloecke.some((x) => x.kopf === 'DIE GEFALLENEN' || x.kopf === 'EURE POSTEN') && P({ kommandantenGefallen: 1 }).bloecke.some((x) => x.kopf === 'DIE GEFALLENEN') && P({ postenVerloren: 1 }).bloecke.some((x) => x.kopf === 'EURE POSTEN'), 'Gefallene und Posten erscheinen erst ab einem');
  ok(gleich(P({ faedenAusgang: { entfuehrter_haendler: 'laufend' } }).bloecke.map((x) => x.kopf), ['DER SEKTOR', 'DIE HÄFEN', 'EURE ROLLE']), 'ein laufender Faden erzeugt keine Zeile');
  ok(zeilenAus(a).every((t) => typeof t === 'string' && t) && !JSON.stringify(a).includes('wenn'), 'Ausgabe: nur Kopf und Zeilen, keine Bedingungen');
  // Sieg
  const s1 = S({ finaleGespielt: false, rang: 'tribun', haefenVerloren: 0 });
  ok(s1.titel === DOC.abspaenne.sieg.titel && s1.schluss === DOC.abspaenne.sieg.schluss, 'sieg: Titel und Schluss aus den Daten');
  ok(gleich(s1.bloecke, [erwartet('sieg', 'sieg'), erwartet('sieg', 'kampflos'), erwartet('sieg', 'haefen_gehalten'), erwartet('sieg', 'rang_hoch')]), 'Sieg kampflos, Tribun, keine Verluste: Sieg, Kampflos, Haefen gehalten, Rolle hoch');
  const s2 = S({ finaleGespielt: true, rang: 'centurio', haefenVerloren: 1, faedenAusgang: { entfuehrter_haendler: 'gelungen', falscher_haendler: 'gescheitert' } });
  ok(gleich(s2.bloecke, [erwartet('sieg', 'sieg'), erwartet('sieg', 'schrein'), erwartet('sieg', 'haefen_verloren'), erwartet('sieg', 'rang_mittel'),
    { kopf: 'DIE GESCHICHTEN', zeilen: [texteVon('sieg', 'geschichten')[1], texteVon('sieg', 'geschichten')[2]] }]), 'Finale gespielt, Centurio, ein Hafen, zwei Faeden: Schrein statt Kampflos, passende Zeilen');
  ok(!s2.bloecke.some((x) => x.kopf === 'OHNE EUCH') && !s1.bloecke.some((x) => x.kopf === 'DER SCHREIN'), 'kampflos und Schrein schliessen sich aus');
  ok(S({ rang: 'miles' }).bloecke.some((x) => x.zeilen[0] === texteVon('sieg', 'rang_niedrig')[0]), 'Sieg: Miles bekommt den niedrigen Rollenblock');
  // Unterschied zwischen Zustaenden
  ok(!gleich(P({ rang: 'miles' }), P({ rang: 'legat' })) && !gleich(P({ haefenVerloren: 0 }), P({ haefenVerloren: 2 })) && !gleich(S({ finaleGespielt: true }), S({ finaleGespielt: false })), 'verschiedene Zustaende ergeben verschiedene Abspaenne');
  // Muell
  ok(Abspann.bauen(null, 'palatina').schluss === SCHLUSS && Abspann.bauen({ rang: 'general', haefenVerloren: -4, faedenAusgang: 'x' }, 'palatina').bloecke.length >= 1, 'Muell in den Fakten: neutrale Vorgaben, kein Wurf');
  ok(Abspann.bauen(FAKTEN(), 'kaiser') === null && Abspann.bauen(FAKTEN(), undefined) === null, 'unbekannte Art: null');
  const vorher = JSON.stringify(DOC);
  P({ rang: 'legat', faedenAusgang: { falscher_haendler: 'gelungen' } });
  ok(JSON.stringify(Abspann.daten()) === vorher, 'bauen veraendert die Daten nicht');
  ok(S({}).schluss !== undefined && Object.prototype.hasOwnProperty.call(P({}), 'schluss'), 'schluss steht als Feld im Ergebnis');
});

// =============================================================================================================================
section('beenden: idempotent, Marker auch ungedockt gespeichert', () => {
  const dir = freshDir();
  const { g, c } = neu({ dir, seed: 3 });
  ungedockt(g);
  ok(!g.ship.docked && g.phase === 'play', 'Ausgangslage: im Flug, Spiel laeuft');
  ok(Abspann.beenden(g, 'kaiser') === false && g.phase === 'play' && endings(c).length === 0, 'unbekannte Art: false, nichts geschieht');
  const faktenVor = Object.keys(g.weltstand.data.fakten).sort();
  const erst = Abspann.beenden(g, 'palatina', 'test');
  ok(erst === true && g.phase === 'end', 'beenden gibt true, Phase end');
  ok(g.abspann && g.abspann.schluss === SCHLUSS && g.abspann.titel === DOC.abspaenne.palatina.titel && Array.isArray(g.abspann.bloecke) && g.abspann.bloecke.length >= 1, 'Abspann am Spiel: Titel, Bloecke, exakter Schluss');
  ok(endings(c).length === 1 && endings(c)[0].abspann === true, 'genau ein ending-Ereignis');
  ok(endings(c)[0].title === 'Freie Fahrt Sund' && endings(c)[0].title === DOC.szenario && endings(c)[0].title !== g.abspann.titel, 'Untertitel unter dem Titel ist das Szenario („Freie Fahrt Sund", aus den Daten szenario), nicht der Titel noch einmal');
  {   // K7: der Untertitel kommt aus den Daten, nicht fest aus dem Code
    const alt = Abspann.daten().szenario;
    Abspann.daten().szenario = 'Probe-Szenario';
    try { const k = neu({ dir: freshDir(), seed: 4 }); ungedockt(k.g); Abspann.beenden(k.g, 'sieg', 'test'); ok(endings(k.c)[0] && endings(k.c)[0].title === 'Probe-Szenario', 'Untertitel folgt den Daten (szenario geaendert: ' + (endings(k.c)[0] && endings(k.c)[0].title) + ')'); } finally { Abspann.daten().szenario = alt; }
  }
  ok(gleich(Object.keys(g.weltstand.data.fakten).sort(), faktenVor.concat(['szenario_ende']).sort()), 'beenden schreibt genau einen Fakt (szenario_ende) in den Weltstand');
  const kopie1 = JSON.stringify(g.abspann);
  ok(Abspann.beenden(g, 'palatina') === false && Abspann.beenden(g, 'sieg') === false, 'zweiter Aufruf (auch mit anderer Art): false');
  ok(endings(c).length === 1 && JSON.stringify(g.abspann) === kopie1, 'zweiter Aufruf wirkungslos: ein endGame, Abspann unveraendert');
  ok(g.weltstand.data.fakten.szenario_ende === 'palatina' && g.weltstand.data.faktenQuelle.szenario_ende === 'test', 'Fakt szenario_ende = palatina, Quelle gemerkt');
  run(g, 2);
  ok(!g.ship.docked, 'weiterhin ungedockt');
  const d = lesen(dir);
  ok(d.welt.fakten.szenario_ende === 'palatina', 'BELEG: die Weltstand-Datei enthaelt fakten.szenario_ende, obwohl das Schiff nicht angedockt war');
  ok(Weltstand.validate(d).length === 0, 'der gespeicherte Stand mit Marker ist schemagueltig (Fakt braucht kein Schemafeld)');
  // ohne markSaveDue (Gegenprobe der Messung): endGame allein speichert ungedockt nicht
  const dir2 = freshDir();
  const t2 = neu({ dir: dir2, seed: 3 }); ungedockt(t2.g);
  const mt = fs.statSync(weltDatei(dir2)).mtimeMs, inh = fs.readFileSync(weltDatei(dir2), 'utf8');
  t2.g.weltstand.fact('szenario_ende', 'sieg', 'x'); t2.g.endGame({ title: 'x', text: 'y', abspann: { titel: 't', text: 'y', bloecke: [] } }); run(t2.g, 2);
  ok(fs.readFileSync(weltDatei(dir2), 'utf8') === inh && fs.statSync(weltDatei(dir2)).mtimeMs === mt, 'Gegenprobe: ohne markSaveDue speichert endGame ungedockt NICHT (darum ruft beenden es)');
  // Sieg
  const t3 = neu({ seed: 4 }); ungedockt(t3.g);
  ok(Abspann.beenden(t3.g, 'sieg', 'finale') && t3.g.abspann.titel === DOC.abspaenne.sieg.titel && t3.g.abspann.schluss === DOC.abspaenne.sieg.schluss && t3.g.weltstand.data.fakten.szenario_ende === 'sieg', 'Art sieg: Siegabspann und Marker sieg');
  // angedockt: auch gespeichert
  const dir4 = freshDir(); const t4 = neu({ dir: dir4, seed: 5 });
  ok(t4.g.ship.docked, 'Start der Freien Fahrt ist angedockt');
  Abspann.beenden(t4.g, 'palatina'); run(t4.g, 1);
  ok(lesen(dir4).welt.fakten.szenario_ende === 'palatina', 'angedockt: Marker ebenfalls gespeichert');
  // Enter am Abspann: Partie endet, Lobby
  t4.g.endSession(null);
  ok(t4.g.phase === 'lobby', 'Enter (menu end): zurueck in die Lobby');
});

// =============================================================================================================================
section('Laden: mit Marker zeigt den Abspann, ohne Marker unveraendert', () => {
  const dir = freshDir();
  const { g } = neu({ dir, seed: 3 }); ungedockt(g);
  const id = idVon(dir);
  Abspann.beenden(g, 'palatina', 'test'); run(g, 2);
  const erwartetAbspann = JSON.stringify(g.abspann);
  g.endSession(null);
  const { g2, c } = laden(dir, id, 3);
  ok(g2.phase === 'end', 'Laden mit Marker: Phase end (kein Weiterspielen)');
  ok(g2.abspann && g2.abspann.schluss === SCHLUSS && g2.abspann.titel === DOC.abspaenne.palatina.titel, 'Abspann wird wieder gezeigt (Palatina, exakter Schluss)');
  ok(endings(c).length >= 1, 'ending-Ereignis an den Client');
  ok(JSON.stringify(g2.abspann) === erwartetAbspann, 'der erneut gezeigte Abspann ist derselbe wie beim Ende (gleiche Fakten)');
  ok(g2.errors === 0 || (Array.isArray(g2.errors) ? g2.errors.length === 0 : !g2.errors), 'keine Fehler beim Laden');
  g2.endSession(null);
  ok(g2.phase === 'lobby', 'Enter nach dem Laden: Lobby');
  // Sieg-Marker
  const dirS = freshDir(); const ts = neu({ dir: dirS, seed: 5 }); ungedockt(ts.g); const idS = idVon(dirS);
  Abspann.beenden(ts.g, 'sieg', 'finale'); run(ts.g, 2); ts.g.endSession(null);
  const ls = laden(dirS, idS, 5);
  ok(ls.g2.phase === 'end' && ls.g2.abspann.titel === DOC.abspaenne.sieg.titel, 'Laden mit Marker sieg: Siegabspann');
  // ohne Marker
  const dirN = freshDir(); const tn = neu({ dir: dirN, seed: 3 }); const idN = idVon(dirN);
  run(tn.g, 2); tn.g.saveWorld('test', { sync: true }); tn.g.endSession(null);
  const ln = laden(dirN, idN, 3);
  ok(ln.g2.phase === 'play' && !ln.g2.abspann && endings(ln.c).length === 0, 'Laden ohne Marker: das Spiel laeuft weiter, kein Abspann, kein ending');
  ok(ln.g2.weltsim && !('szenario_ende' in ln.g2.weltstand.data.fakten), 'kein Marker im geladenen Stand');
  // Marker in einem Stand ohne Freie Fahrt (Kampagne): nichts
  let gerufen = 0;
  const fremd = { weltsim: null, phase: 'play', weltstand: { data: { fakten: { szenario_ende: 'sieg' } } }, endGame() { gerufen++; } };
  Abspann.nachLaden(fremd);
  ok(gerufen === 0, 'Marker, aber keine Freie Fahrt (kein game.weltsim): nichts');
  const fremd2 = { weltsim: {}, phase: 'play', weltstand: { data: { fakten: { szenario_ende: 'unsinn' } } }, endGame() { gerufen++; } };
  Abspann.nachLaden(fremd2); Abspann.nachLaden({}); Abspann.nachLaden(null);
  ok(gerufen === 0, 'unbekannter Markerwert, leeres und null-Spiel: nichts, kein Wurf');
});

// =============================================================================================================================
// Konstruierter Zustand wie in test-weltsim-kopplung: starke Flotte vor der Hauptwelt, echte Ticks bis zum Fall
function fallPalatina(g) {
  const z = g.weltsim.zustand;
  z.flotten = z.flotten.filter((fl) => !(fl.fraktion === 'rom' && fl.ort === '0204'));
  z.vorrat.ger.U = z.vorrat.ger.T = 60;
  z.flotten.push({ id: z.naechsteId++, fraktion: 'ger', heimat: '1004', ort: '0204', staerke: 40, kap: 12, befehl: 'angriff', ziel: '0204', warte: 0, versorgung: 1, angriff: null });
  let i = 0; while (g.phase !== 'end' && !g.weltsim.hauptweltGefallen && i++ < 12) Kriegslage.tick(g, 'sprung');
}
function fallHrafnheim(g) {
  const z = g.weltsim.zustand;
  z.flotten = z.flotten.filter((fl) => !(fl.fraktion === 'ger' && fl.ort === '1004'));
  z.vorrat.rom.U = z.vorrat.rom.T = 60;
  z.flotten.push({ id: z.naechsteId++, fraktion: 'rom', heimat: '0204', ort: '1004', staerke: 40, kap: 12, befehl: 'angriff', ziel: '1004', warte: 0, versorgung: 1, angriff: null });
  let i = 0; while (g.phase !== 'end' && i++ < 12) Kriegslage.tick(g, 'sprung');
}
section('Fall der Hauptwelt: Palatina -> Abspann palatina, Hrafnheim ohne Finale -> Abspann sieg kampflos', () => {
  const dir = freshDir(); const { g, c } = neu({ dir, seed: 7 }); ungedockt(g);
  g.weltsim.ruf.rom = 60;   // Tribun
  fallPalatina(g);
  ok(g.weltsim.zustand.hexe['0204'].besitzer === 'ger', 'Ausgangslage: Palatina ist in germanischer Hand (echter Tick)');
  ok(g.phase === 'end' && endings(c).length === 1, 'Palatina gefallen: Phase end, ein ending');
  ok(g.abspann && g.abspann.titel === DOC.abspaenne.palatina.titel && g.abspann.schluss === SCHLUSS, 'Abspann palatina mit dem exakten Schluss');
  ok(g.weltstand.data.fakten.szenario_ende === 'palatina', 'Marker palatina im Weltstand');
  const rolle = g.abspann.bloecke.find((b) => b.kopf === 'EURE ROLLE');
  ok(rolle && gleich(rolle.zeilen, texteVon('palatina', 'rang_hoch')), 'der Abspann reagiert auf den Rang (Tribun: „Man hörte auf euch …“)');
  ok(g.abspann.bloecke.some((b) => b.kopf === 'DIE HÄFEN' && gleich(b.zeilen, texteVon('palatina', 'haefen_gehalten'))), 'nur Palatina gefallen: „Kein anderer Hafen war vorher gefallen.“');
  ok(g.weltsim.hauptweltGefallen && g.weltsim.hauptweltGefallen.fraktion === 'rom', 'Merker hauptweltGefallen bleibt');
  run(g, 2);
  ok(lesen(dir).welt.fakten.szenario_ende === 'palatina', 'gespeichert (ungedockt)');
  const n1 = endings(c).length; Kriegslage.tick(g, 'sprung'); run(g, 1);
  ok(endings(c).length === n1, 'weitere Ticks: kein zweites Ende');
  // mehr Verluste: ein zweiter Hafen vor Palatina verloren
  const t2 = neu({ seed: 8 }); ungedockt(t2.g);
  t2.g.weltsim.zustand.hexe['0105'].besitzer = 'ger';
  fallPalatina(t2.g);
  ok(t2.g.abspann && t2.g.abspann.bloecke.some((b) => b.kopf === 'DIE HÄFEN' && gleich(b.zeilen, texteVon('palatina', 'haefen_verloren'))), 'ein Hafen vorher verloren: Block „Schon vor Palatina gingen Häfen verloren.“');
  // Hrafnheim ohne Finale
  const dirH = freshDir(); const th = neu({ dir: dirH, seed: 9 }); ungedockt(th.g);
  fallHrafnheim(th.g);
  ok(th.g.weltsim.zustand.hexe['1004'].besitzer === 'rom', 'Ausgangslage: Hrafnheim ist in roemischer Hand (echter Tick)');
  ok(th.g.phase === 'end' && th.g.abspann && th.g.abspann.titel === DOC.abspaenne.sieg.titel, 'Hrafnheim gefallen: Siegabspann');
  ok(th.g.abspann.bloecke.some((b) => b.kopf === 'OHNE EUCH') && !th.g.abspann.bloecke.some((b) => b.kopf === 'DER SCHREIN'), 'ohne Finale: der Block „kampflos“, nicht der Schrein');
  ok(th.g.weltstand.data.fakten.szenario_ende === 'sieg' && th.g.weltsim.hauptweltGefallen === null, 'Marker sieg; Merker hauptweltGefallen nur fuer Rom');
  ok(!th.g.abspann.bloecke.some((b) => b.kopf === 'EURE ROLLE' && b.zeilen[0] === texteVon('palatina', 'rang_hoch')[0]), 'der Siegabspann nutzt die Texte des Siegs, nicht die von Palatina');
  // Finale gespielt: das Finale (anderes Paket) setzt den Fakt und ruft beenden selbst
  const tf = neu({ seed: 10 }); ungedockt(tf.g);
  tf.g.weltstand.fact('finale_gespielt', true, 'finale');
  ok(Abspann.beenden(tf.g, 'sieg', 'finale') && tf.g.abspann.bloecke.some((b) => b.kopf === 'DER SCHREIN') && !tf.g.abspann.bloecke.some((b) => b.kopf === 'OHNE EUCH'), 'Finale gespielt (Fakt finale_gespielt): Block „Schrein“, nicht „kampflos“');
  // Fall nach dem Ende: nichts doppelt
  const tz = neu({ seed: 11 }); ungedockt(tz.g);
  Abspann.beenden(tz.g, 'sieg', 'finale'); const a0 = JSON.stringify(tz.g.abspann); fallPalatina(tz.g);
  ok(JSON.stringify(tz.g.abspann) === a0 && tz.g.weltstand.data.fakten.szenario_ende === 'sieg', 'nach dem Sieg faellt Palatina nicht mehr ins Gewicht: Abspann und Marker bleiben');
});

// =============================================================================================================================
section('Kampagne und Modi ohne Freie Fahrt: unberuehrt', () => {
  const t = neu({ start: 'm1' }); const g = t.g;
  ok(!g.weltsim, 'Kampagne (m1): kein game.weltsim');
  let ende = 0; const eg = g.endGame.bind(g); g.endGame = (o) => { ende++; return eg(o); };
  ok(Abspann.beenden(g, 'palatina') === false && Abspann.beenden(g, 'sieg') === false, 'beenden ohne Weltsim: false');
  Abspann.nachLaden(g); Kriegslage.nachLaden(g);
  ok(ende === 0 && g.phase === 'play' && !g.abspann, 'nachLaden ohne Weltsim: nichts, kein endGame');
  ok(!('szenario_ende' in (g.weltstand ? g.weltstand.data.fakten : {})), 'kein Marker im Weltstand der Kampagne');
  ok(Abspann.debug(g, ['palatina']) === 'Nur in der Freien Fahrt Sund.' && g.phase === 'play', 'Debug abspann ohne Freie Fahrt: Fehlertext, nichts');
  // Kampagnen-Abspann (endGame mit abspann ohne schluss) bleibt, wie er ist
  const t2 = neu({ start: 'm1' });
  t2.g.endGame({ title: 'X', text: 'Y', abspann: { titel: 'T', text: 'Y', bloecke: [{ kopf: 'K', zeilen: ['a'] }] } });
  const sn = t2.g.snapshot();
  ok(sn.abspann && !('schluss' in sn.abspann) && gleich(sn.abspann.bloecke, [{ kopf: 'K', zeilen: ['a'] }]), 'Kampagnen-Abspann: Snapshot ohne Feld schluss');
});

section('Debug: abspann palatina|sieg (nur Freie Fahrt, ohne Marker)', () => {
  const dir = freshDir(); const { g, c } = neu({ dir, seed: 3 }); ungedockt(g);
  g.handleMessage(c, { t: 'debug', cmd: 'abspann', args: 'sieg' });
  ok(g.phase === 'end' && g.abspann && g.abspann.titel === DOC.abspaenne.sieg.titel && g.abspann.schluss === DOC.abspaenne.sieg.schluss, 'abspann sieg zeigt den Siegabspann');
  ok(!('szenario_ende' in g.weltstand.data.fakten), 'Debug setzt keinen Marker (die Welt bleibt spielbar)');
  const t2 = neu({ seed: 3 });
  ok(Abspann.debug(t2.g, ['unsinn']) === 'abspann palatina|sieg' && t2.g.phase === 'play', 'unbekannte Art: Hinweistext');
  Abspann.debug(t2.g, ['palatina']);
  ok(t2.g.phase === 'end' && t2.g.abspann.schluss === SCHLUSS, 'abspann palatina zeigt den Abspann mit dem Schluss');
  ok(Abspann.debug(t2.g, ['sieg']) === 'Das Szenario ist schon beendet.', 'im laufenden Abspann: Hinweis');
});

// =============================================================================================================================
section('Weltstand: ohne Ende unveraendert, main liest die Staende', () => {
  const dir = freshDir(); const { g } = neu({ dir, seed: 3 }); run(g, 3); g.saveWorld('test', { sync: true });
  const d = lesen(dir);
  ok(!('szenario_ende' in d.welt.fakten) && !('szenario_ende' in (d.welt.faktenQuelle || {})), 'Stand ohne Ende: kein Marker, kein Feld');
  ok(Weltstand.validate(d).length === 0, 'Stand ohne Ende schemagueltig');
  const dirE = freshDir(); const te = neu({ dir: dirE, seed: 3 }); ungedockt(te.g); Abspann.beenden(te.g, 'palatina'); run(te.g, 2);
  const de = lesen(dirE);
  const ohneMarker = kopie(de); delete ohneMarker.welt.fakten.szenario_ende; delete ohneMarker.welt.faktenQuelle.szenario_ende;
  ok(gleich(Object.keys(de).sort(), Object.keys(d).sort()), 'Stand mit Ende: dieselben Felder auf oberster Ebene (nur der Fakt kommt dazu)');
  ok(gleich(Object.keys(ohneMarker.welt).sort(), Object.keys(d.welt).sort()), 'Stand mit Ende: dieselben Felder in welt');
  // main liest unveraendert
  const main = path.join(__dirname, '..', '..', 'Pantheon-main');
  if (!fs.existsSync(path.join(main, 'server', 'weltstand.js'))) { console.log('  --   Pantheon-main nicht gefunden: readChecked-Pruefung uebersprungen'); }
  else {
    const dateien = { ohne: weltDatei(dir), mit: weltDatei(dirE) };
    const skript = "const W=require('./server/weltstand.js');const out={};for(const [k,f] of Object.entries(JSON.parse(process.argv[1]))){const r=W.readChecked(f);out[k]={ok:!!(r&&r.data&&!r.error),err:r&&r.error?String(r.error):null,keys:r&&r.data?Object.keys(r.data.welt||{}).sort():null,marker:r&&r.data&&r.data.welt&&r.data.welt.fakten?r.data.welt.fakten.szenario_ende||null:null};}console.log(JSON.stringify(out));";
    const r = spawnSync(process.execPath, ['-e', skript, JSON.stringify(dateien)], { cwd: main, encoding: 'utf8' });
    let aus = null; try { aus = JSON.parse(r.stdout.trim().split('\n').pop()); } catch (e) { /* unten gemeldet */ }
    ok(!!aus && aus.ohne.ok && aus.ohne.marker === null, 'readChecked aus Pantheon-main liest einen Stand OHNE Marker' + (aus ? '' : ' (Aufruf: ' + (r.stderr || '').slice(0, 160) + ')'));
    ok(!!aus && aus.mit.ok && aus.mit.marker === 'palatina', 'readChecked aus Pantheon-main liest auch einen Stand MIT Marker (Fakt ist eine offene Map)');
  }
});

// =============================================================================================================================
// Layout des Abspanns im Client (Node, ohne Browser): drawAbspann aus dem Quelltext laden, mit echtem Zeilenumbruch (Art) und aufzeichnendem Kontext
function hudZeichner(quelle) {
  const vm = require('vm');
  const w = {}; w.window = w; w.document = { createElement: () => ({ getContext: () => ({}), style: {} }) }; w.console = console;
  vm.createContext(w);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'art.js'), 'utf8'), w);
  const m = /drawAbspann\(ctx, view\) \{[\s\S]*?\n {4}\},\n {4}drawEnd/.exec(quelle);
  if (!m) return null;
  const body = m[0].replace(/,\n {4}drawEnd$/, '');
  const mess = (t, s) => w.Art.measureText(String(t), s || 1);
  const R = {
    wrap(str, maxW, scale) { const words = String(str || '').split(/\s+/); const lines = []; let line = ''; for (const x of words) { const t = line ? line + ' ' + x : x; if (mess(t, scale) > maxW && line) { lines.push(line); line = x; } else line = t; } if (line) lines.push(line); return lines; },
    text(ctx, s, x, y, o) { ctx.log.push({ s: String(s), x, y, c: (o && o.color) || null, sc: (o && o.scale) || 1, mess: mess(s, (o && o.scale) || 1) }); },
    button(ctx, x, y, bw, bh, label) { ctx.log.push({ button: label, x, y }); },
  };
  const PAL = { amber: 'AMBER', mint: 'MINT', star: 'STAR', brass: 'BRASS', panelLight: 'PL', alarmrot: 'ROT' };
  const fn = new Function('R', 'PAL', 'VW', 'VH', 'fmtTime', 'return { ' + body.trim().replace(/,$/, '') + ' }')(R, PAL, 640, 360, (s) => 'T' + Math.round(s));
  return (ab, zeit, extra) => {
    const log = [];
    const clips = []; log.clips = clips;   // Ausschnitte (ctx.rect vor ctx.clip), Eigenschaft am Array: gleich() vergleicht nur die Einträge
    const ctx = { log, save() {}, restore() {}, beginPath() {}, rect(x, y, bw, bh) { clips.push([x, y, bw, bh]); }, clip() {}, fillRect(x, y, bw, bh) { log.push({ rect: [x, y, bw, bh] }); } };
    const hud = Object.assign({ endTitle: 'Freie Fahrt Sund', abspannKey: (ab.titel || '') + '|' + (ab.text || ''), abspannT0: 0 }, extra);   // Startzeit 0: view.time ist die Zeit seit Beginn des Abspanns
    fn.drawAbspann.call(hud, ctx, { state: { abspann: ab, stats: { elapsed: 125, kills: 7, repairs: 3 }, time: 0 }, time: zeit, actions: { abspannEnde() {} } });
    return log;
  };
}
section('Client: Schlusszeile im Abspann (Layout)', () => {
  const quelle = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'hud.js'), 'utf8').split('\r\n').join('\n');
  const zeichne = hudZeichner(quelle);
  ok(!!zeichne, 'drawAbspann steht in hud.js');
  if (!zeichne) return;
  const top = 30, bottom = 306;
  const palatina = Abspann.bauen(FAKTEN({ rang: 'tribun', haefenVerloren: 1, kommandantenGefallen: 2, postenVerloren: 1, faedenAusgang: { falscher_haendler: 'gescheitert', dankbarer_captain: 'gelungen' } }), 'palatina');
  const mini = { titel: 'Kurz', text: 'Kurzer Text.', bloecke: [{ kopf: 'K', zeilen: ['eine Zeile'] }], schluss: SCHLUSS };
  for (const [name, ab] of [['voller Palatina-Abspann', palatina], ['kurzer Abspann', mini]]) {
    const log = zeichne(ab, 1000);   // lange nach dem Stillstand der Zeilen
    const texte = log.filter((l) => l.s !== undefined);
    const bil = texte.findIndex((l) => l.s === 'BILANZ'), sch = texte.findIndex((l) => l.s === SCHLUSS);
    ok(bil >= 0 && sch > bil, `${name}: der Schluss steht NACH der Bilanz`);
    const liste = texte.filter((l) => !/^Beendet die Partie/.test(l.s));   // die Zeile unter dem Knopf gehoert nicht zur laufenden Liste
    ok(liste[liste.length - 1].s === SCHLUSS, `${name}: der Schluss ist die letzte Zeile der Liste (nach der Bilanz)`);
    const t = texte[sch];
    ok(t.y >= top - 6 && t.y + 11 <= bottom + 6, `${name}: der Schluss liegt im sichtbaren Fenster (y ${t.y}, Fenster ${top - 6}..${bottom + 6})`);
    ok(t.c === 'STAR', `${name}: Schluss in Hell (Star), weder Mint noch Rot (Welle 5, K2)`);
    ok(t.x === 320 && t.mess <= 400, `${name}: mittig, Breite ${t.mess} px in der 400-px-Spalte`);
    const zeilen = texte.filter((l) => l.s !== 'Zum Hauptmenü' && !/^Beendet die Partie/.test(l.s));
    ok(zeilen.every((l) => l.mess <= 400), `${name}: keine Zeile breiter als die Spalte (${Math.max(...zeilen.map((l) => l.mess))} px)`);
    const sichtbar = texte.filter((l) => l.y >= top - 6 && l.y + 10 <= bottom + 6 && l.s !== 'Zum Hauptmenü' && !/^Beendet die Partie/.test(l.s));
    ok(sichtbar.some((l) => l.s === 'BILANZ') && sichtbar.some((l) => l.s.startsWith('Abschüsse')) && sichtbar.some((l) => l.s === SCHLUSS), `${name}: Bilanz und Schluss am Ende komplett sichtbar`);
  }
  // Welle 5 (M2): Titel und Untertitel stehen fest, auch wenn die Liste nicht ins Bild passt; der Scrollbereich beginnt darunter; die Ausschnitte bleiben innerhalb der Linien (top-8 / bottom+8)
  for (const [name, ab] of [['voller Palatina-Abspann', palatina], ['kurzer Abspann', mini]]) {
    for (const zeit of [1000, 40]) {
      const log = zeichne(ab, zeit), texte = log.filter((l) => l.s !== undefined);
      const ti = texte.find((l) => l.s === ab.titel.toUpperCase()), su = texte.find((l) => l.s === 'Freie Fahrt Sund');
      ok(!!ti && ti.y === top + 8 && ti.sc === 2, `${name} (t=${zeit}): der Titel steht fest oben (y ${ti && ti.y})`);
      ok(!!su && su.y === top + 8 + 26, `${name} (t=${zeit}): der Untertitel steht unter dem Titel (y ${su && su.y})`);
      const rest = texte.filter((l) => l !== ti && l !== su && l.s !== 'Zum Hauptmenü' && !/^Beendet die Partie/.test(l.s));
      const scrollOben = top + 8 + 26 + 14;
      ok(log.clips.every((c) => c[1] >= top - 7 && c[1] + c[3] <= bottom + 7), `${name}: kein Ausschnitt reicht über die Linien (${JSON.stringify(log.clips)})`);
      ok(log.clips.some((c) => c[1] >= scrollOben - 3 - 1e-9 && c[1] <= scrollOben), `${name}: der Scrollbereich beginnt unter dem Kopf (Ausschnitt ab y ${scrollOben - 3})`);
      if (zeit === 1000) ok(rest.filter((l) => l.y >= scrollOben - 3 && l.y + 8 <= bottom + 3).length >= 3, `${name}: unter dem Kopf stehen sichtbare Zeilen`);
    }
  }
  // Der Titel wiederholt sich in keinem Block (Palatina und Sieg): weder als Zeile noch als Text
  for (const art of ['palatina', 'sieg']) {
    const a = DOC.abspaenne[art], titel = a.titel.replace(/[.]$/, '').toLowerCase();
    const alle = a.bloecke.reduce((s, b) => s.concat(b.zeilen.map((z) => (typeof z === 'string' ? z : z.text))), []).concat([a.text, a.schluss]);
    ok(alle.every((z) => z.replace(/[.]$/, '').toLowerCase() !== titel), `${art}: keine Zeile doppelt den Titel „${a.titel}“`);
  }
  // am Anfang (kurz nach dem Start) liegt der Schluss ausserhalb, nicht im Bild
  const frueh = zeichne(palatina, 0).filter((l) => l.s === SCHLUSS);
  ok(frueh.length === 0 || frueh[0].y > bottom, 'zu Beginn laeuft der Schluss noch unten ausserhalb des Fensters');
  // laengerer Schluss bricht um (hoechstens drei Zeilen)
  const lang = zeichne(Object.assign({}, mini, { schluss: 'Dies ist ein sehr langer Schlusssatz, der nicht in eine einzige Zeile der Spalte passt und deshalb umbrechen muss, damit nichts abgeschnitten wird.' }), 1000).filter((l) => l.s !== undefined);
  ok(lang.filter((l) => /Schlusssatz|umbrechen|abgeschnitten|Spalte/.test(l.s)).length >= 2 && lang.every((l) => l.mess <= 400), 'langer Schluss bricht um, jede Zeile passt in die Spalte');
  // Kampagnen-Abspann (ohne schluss) unveraendert: Vergleich mit dem Stand vor SUND-04a-3 aus der Git-Historie (3f23967), falls verfuegbar
  const kampagne = { titel: 'Feldzug', text: 'Eine Koop-Kampagne.', bloecke: [{ kopf: 'DIE KETTE', zeilen: ['1  Statio', '2  Rabenpass'] }, { kopf: 'ROM', zeilen: ['Legat Marcus', 'Mars hat gesprochen.'] }] };
  const neuLog = zeichne(kampagne, 1000);
  ok(!neuLog.some((l) => l.s === SCHLUSS) && neuLog.filter((l) => l.s !== undefined).slice(-1)[0].s.startsWith('Beendet die Partie'), 'Abspann ohne schluss: letzte Zeilen sind Bilanz und die Knopfzeile wie bisher');
  const alt = spawnSync('git', ['show', '3f23967:public/js/hud.js'], { cwd: path.join(__dirname, '..'), encoding: 'utf8', maxBuffer: 1 << 26 });
  if (alt.status !== 0 || !alt.stdout) console.log('  --   Git-Stand 3f23967 nicht verfuegbar: Pixelvergleich mit dem alten hud.js uebersprungen');
  else {
    const zeichneAlt = hudZeichner(alt.stdout.split('\r\n').join('\n'));
    for (const zeit of [0, 3, 8, 1000]) ok(gleich(zeichneAlt(kampagne, zeit), zeichne(kampagne, zeit)), `Kampagnen-Abspann bei t=${zeit} s: alle Zeichenaufrufe gleich dem Stand vor SUND-04a-3`);
    ok(gleich(zeichneAlt(mini, 1000).filter((l) => l.s !== SCHLUSS).length, zeichne(Object.assign({}, mini, { schluss: undefined }), 1000).length), 'ein Abspann mit schluss: undefined zeichnet nichts Zusaetzliches');
  }
});

console.log(`\n${n - fails} von ${n} Pruefungen bestanden` + (fails ? `, ${fails} FEHLER` : ''));
process.exit(fails ? 1 : 0);
