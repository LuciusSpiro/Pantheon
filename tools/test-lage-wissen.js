'use strict';
// SUND-01 Paket C (Server): Wissensmodell von Rom, Anzeigeblock world.lage, Lagefunk, Notruf-Marken.
//   Sichtweite 2 Sprünge, 1 Tick Verzögerung, eigene Gebiete exakt, Altstand mit Alter, Lerche als Sensorknoten, Sonden-Sichtung (Abnahme 6)
//   Funk bei Sammelbeginn nur wenn gesehen, nie doppelt, auch im Schnellsprung und nach dem Laden (Abnahme 8)
//   Rom erfährt nie das wahre Ziel · Block bei drei Verbindungen gleich, kein Sim-Zustand im Snapshot, Größe, nur bei Änderung (Abnahme 12)
//   Speichern und Laden des Wissens, Altstand ohne Wissensblock, Kampagne ohne Block
//   node tools/test-lage-wissen.js   (npm run test:lage-wissen)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const { Game } = require('../server/game.js');
const Weltstand = require('../server/weltstand.js');
const Sektoren = require('../shared/sektoren.js');
const Kern = require('../server/weltsim/kern.js');
const Daten = require('../server/weltsim/daten.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Wissen = require('../server/sim/kriegslage-wissen.js');
const Sektorplan = require('../server/sim/sektorplan.js');
const Sprung = require('../server/sim/sprung.js');
const Reise = require('../server/sim/reise.js');
const KT = require('../public/js/karte-tokens.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const kopie = (x) => JSON.parse(JSON.stringify(x));
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const ROOT_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-lage-'));
let dirSeq = 0;
const freshDir = () => { const d = path.join(ROOT_TMP, 'w' + (++dirSeq)); fs.mkdirSync(d, { recursive: true }); return d; };
const CODES = KT.hexReihenfolge(require('../content/welt/sund_frei.json'));

function setup(dir, start, np) {
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(ROOT_TMP, 'regie') }, log: () => {} });
  const cs = [];
  for (let i = 0; i < (np || 1); i++) {
    const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'K' + i, name: 'Crew' + i, color: i });
    cs.push(c);
  }
  const c = cs[0];
  const send = (m) => g.handleMessage(c, m);
  const run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) g.step(); };
  const startFn = () => { send({ t: 'lobbyOpt', startMission: start }); for (const x of cs) g.handleMessage(x, { t: 'ready', ready: true }); run(1); g.space.enemies = []; };
  return { g, c, cs, send, run, start: startFn, radios: () => c.inbox.filter((m) => m.t === 'event' && m.kind === 'radio'), events: (k) => c.inbox.filter((m) => m.t === 'event' && m.kind === k) };
}
function place(g, x, y) { const s = g.ship; s.helm.stage = 1; s.docked = false; s.dockedAt = null; s.x = x; s.y = y; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; }

// ---------------------------------------------------------------------------------------------------------------- Szenen
// Ruhige Welt (alle Flotten daheim, keine Feldzüge), Posten Kantenstein (0603) nach Wunsch, die Lerche in Ostia Nova (0305). Wissen beginnt dort neu.
// Distanzen im Flottennetz: Kantenstein 0603 – Eisfeld 0703 (1) – Ulfsvakt 0803 (2) – Skjaldborg 0904 (3) – Gullfjord 1003 (4)
function szene(opt) {
  opt = opt || {};
  const t = setup(opt.dir || freshDir(), 'freie_fahrt', opt.spieler); t.start();
  const g = t.g, ws = g.weltsim, z = ws.zustand;
  for (const fl of z.flotten) { fl.befehl = 'heim'; fl.ziel = null; fl.ort = fl.heimat; fl.angriff = null; }
  z.angriffe.length = 0;
  if (opt.posten !== false) Object.assign(z.hexe['0603'], { besitzer: 'rom', posten: true, garnison: 4 });
  if (opt.mod) opt.mod(z);
  g.ship.scene = 'ostia_nova';
  Wissen.starten(g);
  g.sektorplan = g.sektorplan || { gesichtet: {} };
  const s = { t, g, ws, z, lerche: opt.lerche || '0305' };
  s.schritt = (aendere, ev, lerche) => { const vor = Kriegslage.abbild(ws.zustand); if (aendere) aendere(ws.zustand); ws.tickZahl++; ws.zustand.tick++; Wissen.nachTick(g, vor, ev || [], lerche || s.lerche); return Wissen.lage(g); };
  s.block = () => Wissen.lage(g);
  return s;
}
const flotteVon = (z, heimat) => z.flotten.find((f) => f.heimat === heimat && f.fraktion !== 'pirat');
function sammelt(z, fl, an, stuetz, ziel) {
  fl.befehl = 'sammeln'; fl.ziel = stuetz; fl.ort = stuetz; fl.angriff = an;
  z.angriffe.push({ id: an, t0: z.tick, ziel: ziel || '0403', von: fl.fraktion, art: 'reich', relevant: true, zielArt: 'hafen', t_an: null, t_ende: null, ausgang: null, phase: 'sammeln', t_marsch: null, stuetz, flotten: [fl.id] });
}
const eintrag = (b, h, f) => b.f.find((q) => q.h === h && (!f || q.f === f));
const hxVon = (b) => KT.hxLesen(b.hx, CODES);

// =============================================================================================================================
section('Sichtweite: 2 Sprünge ja, 3 Sprünge nein (Abnahme 6)');
{
  const s = szene();
  const a = flotteVon(s.z, '0803'), b = flotteVon(s.z, '0904');
  sammelt(s.z, a, 1, '0803'); sammelt(s.z, b, 2, '0904', '0803');
  s.schritt(); const bl = s.schritt();
  const ea = eintrag(bl, '0803', 'g');
  ok(ea && ea.p === 's' && ea.k >= 1, 'Ulfsvakt (2 Sprünge vom Posten Kantenstein): Flotte sammelt, gesehen');
  ok(!eintrag(bl, '0904'), 'Skjaldborg (3 Sprünge vom nächsten Knoten): keine Flotte im Block');
  const h = hxVon(bl);
  ok(h['0803'].f === 'g' && h['0803'].alter === 1, 'Hex Ulfsvakt: Germanen, Alter 1 (gesehen)');
  ok(h['0904'].f === 'g' && h['0904'].alter === null, 'Hex Skjaldborg: nie gesehen, Besitz laut Karte (Kartenstand), Alter unbekannt');
  ok(KT.wissensstufe(h['0904'].alter, bl.vz) === 'unbekannt' && KT.wissensstufe(h['0803'].alter, bl.vz) === 'gesehen', 'Wissensstufen: Skjaldborg unbekannt, Ulfsvakt gesehen');
  ok(h['0603'].f === 'r' && h['0603'].posten === true && h['0603'].alter === 0, 'eigener Posten Kantenstein: Rom, Posten, jetzt (exakt)');
  ok(bl.sw === 2 && bl.vz === 1, 'Block nennt Sichtweite 2 und Verzögerung 1 (Daten der Sim)');
}
{
  // Sichtweite und Verzögerung sind Daten: Weite 3 zeigt Skjaldborg, Weite 1 zeigt Ulfsvakt nicht
  const s3 = szene({ mod: (z) => { z.werte.sicht.weite = 3; } });
  sammelt(s3.z, flotteVon(s3.z, '0904'), 2, '0904', '0803'); s3.schritt(); const b3 = s3.schritt();
  ok(eintrag(b3, '0904', 'g') && b3.sw === 3, 'Sichtweite 3 (Datei/Werte): Skjaldborg wird gesehen');
  const s1 = szene({ mod: (z) => { z.werte.sicht.weite = 1; } });
  sammelt(s1.z, flotteVon(s1.z, '0803'), 1, '0803'); s1.schritt(); const b1 = s1.schritt();
  ok(!eintrag(b1, '0803'), 'Sichtweite 1: Ulfsvakt (2 Sprünge) wird nicht gesehen');
}

// =============================================================================================================================
section('Die Anzeige hängt einen Tick nach (Abnahme 6)');
{
  const s = szene();
  const a = flotteVon(s.z, '0803');
  sammelt(s.z, a, 1, '0803'); s.schritt(); s.schritt();
  // Tick n: der Verband bricht auf und steht schon in Eisfeld (Marsch zum Ziel Speculum)
  const bn = s.schritt((z) => { a.befehl = 'angriff'; a.ziel = '0403'; a.ort = '0703'; z.angriffe[0].phase = 'marsch'; });
  ok(eintrag(bn, '0803', 'g') && eintrag(bn, '0803', 'g').p === 's' && !eintrag(bn, '0703'), 'Tick n: der Block zeigt noch den Stand von n-1 (sammelt in Ulfsvakt, nicht Eisfeld)');
  const bn1 = s.schritt();
  ok(eintrag(bn1, '0703', 'g') && eintrag(bn1, '0703', 'g').p === 'm' && !eintrag(bn1, '0803'), 'Tick n+1: jetzt Marsch in Eisfeld, Ulfsvakt leer');
  ok(eintrag(bn1, '0703').a === 1, 'Alter der Plakette: 1 Tick (gesehen)');
  // Verzögerung 0 (Daten): kein Nachhängen
  const s0 = szene({ mod: (z) => { z.werte.sicht.verzoegerung = 0; } });
  const a0 = flotteVon(s0.z, '0803'); sammelt(s0.z, a0, 1, '0803');
  const b0 = s0.schritt();
  ok(eintrag(b0, '0803', 'g') && eintrag(b0, '0803', 'g').a === 0, 'Verzögerung 0: schon im selben Tick sichtbar');
}

// =============================================================================================================================
section('Eigene Gebiete und Flotten exakt, ohne Verzögerung');
{
  const s = szene();
  const rf = flotteVon(s.z, '0403'); // Speculum, römisch
  const b1 = s.schritt((z) => { rf.befehl = 'anspruch'; rf.ziel = '0503'; rf.ort = '0503'; });
  const e = eintrag(b1, '0503', 'r');
  ok(e && e.a === 0 && e.p === 'h', 'eigene Flotte steht sofort am neuen Ort, Alter 0 (anspruch am Ziel = hält)');
  const b2 = s.schritt((z) => { Object.assign(z.hexe['0403'], { besitzer: 'ger' }); });
  ok(hxVon(b2)['0403'].f === 'g' && hxVon(b2)['0403'].alter === 0, 'verlorener eigener Hafen (Speculum): sofort der neue Besitzer, exakt');
  const bz = s.schritt((z) => { rf.befehl = 'rueckzug'; rf.ort = rf.heimat; rf.ziel = rf.heimat; });
  ok(!bz.f.some((q) => q.f === 'r' && q.h === '0403'), 'eine Flotte im Rückzug, die den Heimathafen erreicht hat, steht nicht auf der Karte');
  const b3 = s.schritt((z) => { Object.assign(z.hexe['0603'], { posten: false, besitzer: null }); });
  ok(hxVon(b3)['0603'].f === '-' && hxVon(b3)['0603'].posten === false, 'verlorener Posten: sofort herrenlos, ohne Posten');
}

// =============================================================================================================================
section('Altstand mit Alter, Hex bleibt, Plakette verfällt nach altMax');
{
  const s = szene();
  const a = flotteVon(s.z, '0803'); sammelt(s.z, a, 1, '0803'); s.schritt(); s.schritt();
  ok(eintrag(s.block(), '0803'), 'Ausgang: Ulfsvakt gesehen');
  // Kantenstein verloren, Lerche weit weg: Ulfsvakt außer Sicht
  const b = s.schritt((z) => { Object.assign(z.hexe['0603'], { posten: false, besitzer: null }); });
  const q = eintrag(b, '0803', 'g');
  ok(q && q.a === 2 && KT.wissensstufe(q.a, b.vz) === 'alt', 'außer Sicht: Plakette bleibt als Altstand, Alter 2');
  ok(hxVon(b)['0803'].alter === 2 && hxVon(b)['0803'].f === 'g', 'Hex Ulfsvakt: zuletzt bekannter Besitzer, Alter 2');
  let bl = b;
  for (let i = 0; i < 4; i++) bl = s.schritt();
  ok(eintrag(bl, '0803').a === 6 && hxVon(bl)['0803'].alter === 6, 'nach weiteren 4 Ticks: Alter 6');
  for (let i = 0; i < 8; i++) bl = s.schritt();
  ok(!eintrag(bl, '0803'), 'älter als altMax (' + KT.WERTE.altMax + '): Plakette verfällt');
  ok(hxVon(bl)['0803'].f === 'g' && hxVon(bl)['0803'].alter === 14, 'der Hex behält den letzten Besitzer mit Alter 14');
  // wieder in Sicht: Altstand wird ersetzt, nicht verdoppelt
  Object.assign(s.z.hexe['0603'], { besitzer: 'rom', posten: true, garnison: 4 });
  s.schritt(); const bn = s.schritt();
  ok(bn.f.filter((x) => x.h === '0803').length <= 1, 'wieder in Sicht: höchstens eine Plakette in Ulfsvakt');
}

// =============================================================================================================================
section('Die Lerche ist Sensorknoten');
{
  const s = szene({ posten: false });
  const a = flotteVon(s.z, '0803'); sammelt(s.z, a, 1, '0803');
  const b = flotteVon(s.z, '0904'); sammelt(s.z, b, 2, '0904', '0803');
  const c = flotteVon(s.z, '1003'); sammelt(s.z, c, 3, '1003', '0803');
  s.schritt(null, [], '0305'); const fern = s.schritt(null, [], '0305');
  ok(fern.f.length === 0, 'Lerche in Ostia Nova, kein Posten: keine Flotte der Germanen im Block');
  s.schritt(null, [], '0703'); const nah = s.schritt(null, [], '0703');
  ok(eintrag(nah, '0803', 'g') && eintrag(nah, '0904', 'g') && !eintrag(nah, '1003'), 'Lerche in Eisfeld: Ulfsvakt (1) und Skjaldborg (2) ja, Gullfjord (3) nein');
  ok(hxVon(nah)['0703'].f === '-' && hxVon(nah)['0703'].alter === 1, 'Lerche-Hex selbst: gesehen (herrenlos, fremd = verzögert)');
  // Lerche in einem Hex ohne Kanten der Sim (Helix 0506): sieht nur sich selbst, kein Fehler
  const s2 = szene({ posten: false }); s2.schritt(null, [], '0506'); const bh = s2.schritt(null, [], '0506');
  ok(hxVon(bh)['0506'].alter === 1 && s2.g.errors === 0, 'Lerche in Helix (nicht im Flottennetz): sieht ihr Hex, kein Fehler');
}

// =============================================================================================================================
section('Sonden-Sichtung: sofort, ohne Verzögerung (Erweiterungspunkt zusatzSicht)');
{
  const s = szene();
  const b = flotteVon(s.z, '0904'); sammelt(s.z, b, 2, '0904', '0803');
  s.schritt(); s.schritt();
  ok(!eintrag(s.block(), '0904') && hxVon(s.block())['0904'].alter === null, 'vorher: Skjaldborg unbekannt');
  const key0 = Wissen.schluessel(s.g);
  s.g.time = 50;
  Sektorplan.sichten(s.g, '0904', 'sonde');
  const bl = s.block();
  ok(eintrag(bl, '0904', 'g') && eintrag(bl, '0904', 'g').a === 0, 'Sonde meldet Skjaldborg: Flotte sofort im Block, Alter 0 (ohne Verzögerung, ohne Tick)');
  ok(hxVon(bl)['0904'].alter === 0 && Wissen.schluessel(s.g) !== key0, 'Hex Skjaldborg jetzt sichtbar, Änderungsschlüssel hat sich geändert');
  s.schritt();
  const nach = s.block();
  ok(eintrag(nach, '0904', 'g') && eintrag(nach, '0904', 'g').a === 1 && !s.g.errors, 'ein Tick später: Altstand (Alter 1), kein Fehler');
  const ks = Wissen.schluessel(s.g);
  Sektorplan.sichten(s.g, '1003', 'karte');
  ok(Wissen.schluessel(s.g) === ks, 'Kartenwissen (Quelle karte) ändert das Wissen von Rom nicht');
  // zusatzSicht ist der benannte Erweiterungspunkt und liefert eine Menge von Hex-Codes
  const zs = Wissen.zusatzSicht(s.g, 0);
  ok(zs instanceof Set && zs.has('0904'), 'zusatzSicht(game, seit) liefert die gesichteten Hexe als Set');
}

// =============================================================================================================================
section('Rom erfährt nie mehr, als es sieht');
{
  const bauen = (mutiere) => {
    const s = szene();
    sammelt(s.z, flotteVon(s.z, '0803'), 1, '0803');
    s.schritt(); s.schritt();
    s.schritt((z) => { if (mutiere) mutiere(z); });
    s.schritt();   // die Anzeige hängt einen Tick nach: erst jetzt wäre Geändertes zu sehen
    return s;
  };
  const A = bauen(null), B = bauen((z) => {
    // alles Unsichtbare darf anders sein: Flotten, Vorräte, Besitz, Zufall, Absichten, ferne Feldzüge
    const f = flotteVon(z, '1005'); f.befehl = 'sammeln'; f.ziel = '1005'; f.ort = '1005'; f.angriff = 9; f.staerke = 11;
    z.angriffe.push({ id: 9, t0: z.tick, ziel: '0403', von: 'ger', art: 'reich', relevant: true, zielArt: 'hafen', t_an: null, t_ende: null, ausgang: null, phase: 'sammeln', t_marsch: null, stuetz: '1005', flotten: [f.id] });
    z.hexe['1105'].besitzer = 'kon'; z.hexe['0805'].abwehr = 0.1; z.vorrat.ger.U = 0; z.zufall = 99; z.absichten.ger = { aggr: 1 };
    // das wahre Ziel des Sammlers in Ulfsvakt ist ein anderes: es steht nirgends im Block
    z.angriffe[0].ziel = '0305';
  });
  const bA = Wissen.lage(A.g), bB = Wissen.lage(B.g);
  ok(gleich(bA, bB), 'Block identisch, obwohl sich Unsichtbares und das wahre Ziel unterscheiden');
  ok(!/ziel|"z":/.test(JSON.stringify(bA)), 'Sammeln: der Block enthält kein Ziel (weder Feld ziel noch z)');
  const C = bauen((z) => { z.flotten.find((f) => f.befehl === 'sammeln' && f.ort === '0803').staerke = 20; });
  ok(!gleich(Wissen.lage(C.g), bA), 'Gegenprobe: ändert sich etwas Gesehenes (Stärkeklasse in Ulfsvakt), ändert sich der Block');
  // Marsch: die Schätzung hängt nicht von der wahren Absicht ab
  const marsch = (wahrZiel) => {
    const s = szene();
    const fl = flotteVon(s.z, '0803'); sammelt(s.z, fl, 1, '0803', '0403'); s.schritt();
    s.schritt((z) => { fl.befehl = 'angriff'; fl.ziel = wahrZiel; fl.ort = '0703'; z.angriffe[0].phase = 'marsch'; z.angriffe[0].ziel = wahrZiel; });
    return { s, b: s.schritt() };
  };
  const m1 = marsch('0403'), m2 = marsch('0503');
  const q1 = eintrag(m1.b, '0703', 'g'), q2 = eintrag(m2.b, '0703', 'g');
  ok(q1 && q1.p === 'm' && q1.v === '0803' && !('n' in q1) && q1.z === '0603', 'Marsch: Kurs = kam von Ulfsvakt (beobachtet, kein n), vermutetes Ziel = erstes römisches Ziel in beobachteter Marschrichtung (Posten Kantenstein), nicht Speculum');
  ok(gleich(q1, q2), 'zwei verschiedene wahre Ziele (Speculum, Gasfeld) mit gleichem nächsten Hex: identische Anzeige (die Schätzung liest die Absicht nicht)');
  ok(m1.s.z.flotten.find((f) => f.id === flotteVon(m1.s.z, '0803').id).ziel === '0403', 'Gegenprobe: das wahre Ziel steht in der Sim wirklich anders (Speculum)');
}

// =============================================================================================================================
section('Kurs fremder Flotten = beobachtete Bewegung (kam von), nie die jetzige Position (SUND-01 E, Abnahme 6)');
{
  // Metamorphe Prüfung: bis zum Stand nach Tick 3 gleiche Geschichte; was im Tick 4 danach geschieht, liegt hinter der Verzögerung und darf den Block nicht ändern.
  const lauf = (variante) => {
    const s = szene();
    const fl = flotteVon(s.z, '0803'), fern = flotteVon(s.z, '1005'), fern2 = flotteVon(s.z, '1003');
    sammelt(s.z, fl, 1, '0803', '0403');
    s.schritt(); s.schritt();
    s.schritt((z) => { fl.befehl = 'angriff'; fl.ziel = '0403'; fl.ort = '0703'; z.angriffe[0].phase = 'marsch'; if (variante === 'C') fl.staerke = 20; });   // Tick 3: Marsch, steht in Eisfeld
    const b3 = kopie(s.block());
    const b4 = kopie(s.schritt((z) => {
      if (variante === 'A') { fl.ort = '0603'; }   // Tick 4: zieht weiter (in den römischen Posten)
      if (variante === 'B') {   // Tick 4: ganz anders, alles hinter der Verzögerung
        fl.ort = '0803'; fl.befehl = 'rueckzug'; fl.ziel = fl.heimat; fl.staerke = 0.7; fl.angriff = null;
        z.angriffe[0].ziel = '0305'; z.angriffe[0].t_ende = z.tick; z.angriffe[0].ausgang = 'abgewehrt';
        z.hexe['0803'].besitzer = null; z.hexe['0803'].abwehr = 0; z.hexe['0703'].besitzer = 'kon'; z.hexe['0703'].posten = true;
        fern.befehl = 'angriff'; fern.ziel = '0603'; fern.ort = '0904'; fern2.befehl = 'sammeln'; fern2.ziel = '1003'; fern2.ort = '1003'; fern2.angriff = 9; fern2.staerke = 11;   // 0904 liegt 3 Sprünge entfernt: außer Sicht
        z.vorrat.ger.U = 0; z.zufall = 99;
      }
    }));
    return { s, fl, b3, b4 };
  };
  const A = lauf('A'), B = lauf('B'), C = lauf('C');
  const qA = eintrag(A.b4, '0703', 'g');
  ok(qA && qA.p === 'm' && qA.v === '0803' && !('n' in qA), 'Marsch in Eisfeld: Kurs v = Ulfsvakt (beobachtet), kein n');
  ok(A.s.z.flotten.find((f) => f.id === A.fl.id).ort === '0603' && qA.h === '0703', 'Gegenprobe: die Flotte steht jetzt im Posten, die Anzeige noch in Eisfeld');
  ok(!A.b4.f.some((q) => q.f === 'g' && (q.v === '0603' || q.n === '0603' || q.h === '0603')), 'Block verrät nichts über den jetzigen Stand der Flotte (kein germanischer Eintrag im Posten, kein Kurs dorthin)');
  ok(gleich(A.b4, B.b4), 'Metamorph: jetziger Ort, Befehl, Ziel, Stärke, Besitz in Sicht, ferne Flotten, Vorräte, Zufall verschieden -> Block identisch');
  ok(gleich(A.b3, B.b3), 'und schon im Tick davor identisch');
  ok(!gleich(A.b4, C.b4), 'Gegenprobe: ändert sich etwas Gesehenes (Stärke der marschierenden Flotte im Stand von Tick 3), ändert sich der Block');
  // v nur aus der Beobachtung: eine Flotte, die erst jetzt in Sicht kommt, hat keinen Kurs
  const s2 = szene();
  const f2 = flotteVon(s2.z, '0904'); sammelt(s2.z, f2, 2, '0904', '0803');
  s2.schritt(); s2.schritt((z) => { f2.befehl = 'angriff'; f2.ziel = '0403'; f2.ort = '0803'; z.angriffe[0].phase = 'marsch'; });
  const e0 = s2.schritt();   // im Stand von Tick 2 ist sie in Ulfsvakt, vorher war sie nie in Sicht
  ok(eintrag(e0, '0803', 'g') && eintrag(e0, '0803', 'g').p === 'm' && !('v' in eintrag(e0, '0803', 'g')) && !('n' in eintrag(e0, '0803', 'g')), 'erst jetzt in Sicht: Marsch ohne Kursangabe (weder v noch n)');
  s2.schritt((z) => { f2.ort = '0703'; });
  const e1 = s2.schritt();
  ok(eintrag(e1, '0703', 'g') && eintrag(e1, '0703', 'g').v === '0803', 'ein Tick später: Kurs v = Ulfsvakt');
  // eigene Flotte: weiter der echte nächste Schritt n (Alter 0), kein v
  const s3 = szene();
  const rf = flotteVon(s3.z, '0403');
  const e3 = s3.schritt((z) => { rf.befehl = 'angriff'; rf.ziel = '0503'; rf.ort = '0403'; });
  const qr = eintrag(e3, '0403', 'r');
  ok(qr && qr.a === 0 && qr.n && !('v' in qr) && qr.p === 'm', 'eigener Marsch: n (echter nächster Schritt), kein v');
  // Speichern und Laden: die Spur bleibt, Altstand mit n an fremden Flotten verliert n
  const W = kopie(Wissen.toSave(A.s.ws));
  ok(W.spur && Object.keys(W.spur).length > 0, 'die Spur steht im gespeicherten Wissen');
  const W2 = kopie(W); W2.flotten.push({ f: 'g', h: '0703', k: 1, p: 'm', a: W2.t - 1, n: '0603', ids: [999] }); delete W2.spur;
  const sx = szene(); sx.ws.zustand.tick = W2.t; sx.ws.tickZahl = W2.t; Wissen.restore(sx.g, W2);
  ok(sx.ws.wissen.flotten.every((r) => r.f === 'r' || !('n' in r)) && gleich(sx.ws.wissen.spur, {}), 'Altstand: n an fremden Flotten entfernt, fehlende Spur leer');
  // Messung (8 Seeds x 400 Ticks wie die Prüfung des Reviewers): kein n an fremden Plaketten, Kurs nur aus der Bewegung
  let fremd = 0, mitN = 0, mitV = 0, selbst = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const dir = freshDir();
    const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(ROOT_TMP, 'regie') }, log: () => {} });
    const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(sx2) { this.inbox.push(JSON.parse(sx2)); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'Crew', color: 0 });
    g.handleMessage(c, { t: 'lobbyOpt', startMission: 'freie_fahrt' }); g.handleMessage(c, { t: 'ready', ready: true });
    for (let k = 0; k < 30; k++) g.step();
    for (let i = 1; i <= 400; i++) {
      Kriegslage.tick(g, 'test');
      const L = Wissen.lage(g), z = g.weltsim.zustand, T = g.weltsim.wissen.t;
      for (const q of L.f) {
        if (q.f === 'r' || q.a < 1) continue;
        fremd++; if ('n' in q) mitN++;
        if (q.v) {
          mitV++;
          const rec = g.weltsim.wissen.flotten.find((r) => r.f === q.f && r.h === q.h && r.a === T - q.a);
          if (rec && z.flotten.some((fl) => rec.ids.includes(fl.id) && fl.ort === q.v)) selbst++;   // die Flotte selbst steht jetzt wieder auf v (Umkehr), kein Leck
        }
      }
    }
    ok(g.weltsim.fehler === 0 && g.errors === 0, 'Seed ' + seed + ': 400 Ticks ohne Fehler');
  }
  console.log(`  Messung: ${fremd} fremde Plaketten (Alter >= 1), mit n: ${mitN}, mit Kurs v: ${mitV}, davon die Flotte selbst jetzt auf v (Umkehr): ${selbst}`);
  ok(fremd > 1000 && mitN === 0, 'kein fremder Eintrag trägt n (' + mitN + ' von ' + fremd + ')');
  ok(mitV > 100 && selbst <= 0.05 * mitV, 'v ist (fast) nie die jetzige Position der Flotte selbst: ' + selbst + ' von ' + mitV + ' (Umkehr im Tick), vorher verriet n sie in 98,7 % der Fälle');
}

// =============================================================================================================================
section('Funk bei Sammelbeginn: nur wenn gesehen, nie doppelt (Abnahme 8)');
{
  // nicht gesehen: kein Funk
  const s0 = szene({ posten: false });
  sammelt(s0.z, flotteVon(s0.z, '0803'), 1, '0803'); s0.schritt(); s0.schritt(); s0.schritt();
  ok(s0.t.radios().filter((r) => r.lage).length === 0, 'Sammeln außer Sicht: kein Funk');
  ok(s0.g.explore.log.filter((e) => /sammelt sich/.test(e.text)).length === 0, 'und kein Logbucheintrag');
  // gesehen: genau eine Meldung
  const s = szene();
  s.schritt((z) => sammelt(z, flotteVon(z, '0803'), 1, '0803'));
  ok(s.t.radios().filter((r) => r.lage).length === 0, 'im Tick des Beginns selbst noch nichts (Anzeige hängt einen Tick nach)');
  s.schritt();
  const r = s.t.radios().filter((x) => x.lage);
  ok(r.length === 1 && r[0].text === 'Germanische Flotte sammelt sich bei Ulfsvakt. Stärke klein, Ziel unbekannt.' && r[0].from === 'POSTEN KANTENSTEIN', 'eine Funkmeldung mit Vorlage, Absender Posten Kantenstein: ' + JSON.stringify(r[0] && r[0].text));
  ok(r[0].tick === 2 && r[0].lage === 1, 'Ereignis trägt lage und tick');
  const lg = s.g.explore.log.filter((e) => /sammelt sich/.test(e.text));
  ok(lg.length === 1 && lg[0].loc === 'ulfsvakt' && /^Germanische Flotte sammelt sich \(klein\)\. Tick 2\.$/.test(lg[0].text), 'ein Logbucheintrag (Ort Ulfsvakt): ' + JSON.stringify(lg[0] && lg[0].text));
  for (let i = 0; i < 6; i++) s.schritt();
  ok(s.t.radios().filter((x) => x.lage).length === 1 && s.g.explore.log.filter((e) => /sammelt sich/.test(e.text)).length === 1, '6 weitere Ticks im Sammeln: keine zweite Meldung');
  // zweite Flotte desselben Feldzugs dazu: keine neue Meldung
  const z2 = s.z.flotten.find((f) => f.fraktion === 'ger' && f.heimat === '0803' && f.befehl === 'heim');
  s.schritt((z) => { if (z2) { z2.befehl = 'sammeln'; z2.ziel = '0803'; z2.angriff = 1; z.angriffe[0].flotten.push(z2.id); } });
  s.schritt(); s.schritt();
  ok(s.t.radios().filter((x) => x.lage).length === 1, 'weitere Flotte im selben Feldzug: weiter nur eine Meldung');
  // gesehen, wenn später in Sicht (Posten wird gegründet, während das Sammeln noch läuft): einmal bei der Entdeckung
  const s3 = szene({ posten: false });
  sammelt(s3.z, flotteVon(s3.z, '0803'), 1, '0803'); s3.schritt(); s3.schritt();
  s3.schritt((z) => { Object.assign(z.hexe['0603'], { besitzer: 'rom', posten: true, garnison: 4 }); }); s3.schritt(); s3.schritt();
  ok(s3.t.radios().filter((x) => x.lage).length === 1, 'später entdeckt (Posten gegründet): einmal bei der Entdeckung, danach nie wieder');
}

// =============================================================================================================================
section('Funk im Schnellsprung: je Feldzug einmal, nichts verloren (Abnahme 8)');
{
  const dir = freshDir();
  const t = setup(dir, 'freie_fahrt'); const g = t.g; t.start();
  g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0; g.C.reise.feindChance = 0;
  const z = g.weltsim.zustand;
  for (const fl of z.flotten) { fl.befehl = 'heim'; fl.ziel = null; fl.ort = fl.heimat; fl.angriff = null; }
  Object.assign(z.hexe['0603'], { besitzer: 'rom', posten: true, garnison: 4 });
  Wissen.starten(g);
  // eingreifendes Drehbuch im Sim-Kern: nach Tick 2 beginnt in Ulfsvakt das Sammeln, nach Tick 3 steht eine zweite Flotte im Marsch (zweiter Feldzug, Sammeln in Eisfeld bleibt unbemerkt)
  const kernTick = Kern.tick;
  Kern.tick = function (zz, o) {
    const r = kernTick.call(this, zz, o);
    if (zz.tick === 2) { const f = flotteVon(zz, '0803'); sammelt(zz, f, 1, '0803'); }
    return r;
  };
  try {
    const ZYKLUS = ['0305', '0205', '0204'];
    const route = (hexe) => { let von = Sektoren.hexVonOrt(g.ship.scene); for (const h of hexe) { g.explore.markBoje(Sektoren.kanteId(von, h)); g.explore.erkunde(h); von = h; } g.explore.erkunde(Sektoren.hexVonOrt(g.ship.scene)); };
    const i0 = ZYKLUS.indexOf(Sektoren.hexVonOrt(g.ship.scene));
    const hexe = [1, 2, 3, 4].map((k) => ZYKLUS[(i0 + k) % 3]).slice(0, 4);
    // vier Hops: Tick 1, 2 (Sammeln beginnt), 3 (Anzeige hängt nach: Funk), 4
    route(hexe);
    g.reisePlan = { ziel: Sektoren.ortVonHex(hexe[hexe.length - 1]), hops: hexe.slice() };
    g.ship.jump.dest = Sektoren.ortVonHex(hexe[0]);
    const p = Sprung.sprungpunkt(g, hexe[0]); place(g, p.x - 80, p.y); t.run(40); g.space.enemies = [];
    const t0 = g.weltsim.tickZahl;
    ok(Reise.befehl(g) === null && g.reise && g.reise.hops.length === 4, 'Schnellsprung über 4 Hops gestartet');
    const hopZeit = g.C.reise.hopZeit;
    t.run(hopZeit - 1);
    const proTick = [];
    for (let i = 0; i < 6 && g.reise; i++) { t.run(hopZeit + 0.2); proTick.push([g.weltsim.tickZahl - t0, t.radios().filter((x) => x.lage).length]); }
    const lagefunk = t.radios().filter((x) => x.lage);
    ok(!g.reise && g.weltsim.tickZahl === t0 + 4, 'vier Hops, vier Ticks');
    ok(lagefunk.length === 1 && /sammelt sich bei Ulfsvakt/.test(lagefunk[0].text), 'im Schnellsprung genau eine Funkmeldung zum Sammelbeginn: ' + lagefunk.length + ' ' + JSON.stringify(proTick));
    ok(proTick.length >= 3 && proTick[1][1] === 0 && proTick[2][1] === 1, 'Meldung kommt im dritten Hop (Beginn nach Tick 2, plus ein Tick Verzögerung), nicht früher');
    ok(g.explore.log.filter((e) => /sammelt sich/.test(e.text)).length === 1, 'ein Logbucheintrag');
    // Speichern, Neustart, Laden: gleicher Feldzug meldet nicht erneut
    g.debugGoto('ostia_nova', true); t.run(1);
    const sr = g.saveWorld('lage', { sync: true });
    ok(sr.ok, 'gesichert angedockt');
    const id = g.weltstand.id; t.send({ t: 'menu', op: 'end' });
    const b = setup(dir, 'free'); b.send({ t: 'lobbyOpt', world: id }); b.send({ t: 'ready', ready: true }); b.run(2);
    const gb = b.g;
    ok(gb.weltsim && gb.weltsim.wissen && gb.weltsim.wissen.gesehen.some((k) => /^s:1$/.test(k)), 'Wissen und gemerkte Id nach dem Laden da');
    for (let i = 0; i < 4; i++) { const vor = Kriegslage.abbild(gb.weltsim.zustand); gb.weltsim.tickZahl++; gb.weltsim.zustand.tick++; Wissen.nachTick(gb, vor, [], '0305'); }
    ok(b.radios().filter((x) => x.lage).length === 0, 'nach dem Laden und weiteren Ticks im selben Feldzug: keine erneute Meldung');
    b.send({ t: 'menu', op: 'end' });
  } finally { Kern.tick = kernTick; }
}

// =============================================================================================================================
section('Weitere Funkmeldungen (Belagerung, Fall) und Meldungen; Marsch funkt nicht');
{
  const s = szene();
  const a = flotteVon(s.z, '0803'); sammelt(s.z, a, 1, '0803', '0403'); s.schritt(); s.schritt();
  const nF = () => s.t.radios().filter((x) => x.lage).length;
  const n0 = nF();
  s.schritt((z) => { a.befehl = 'angriff'; a.ziel = '0403'; a.ort = '0703'; z.angriffe[0].phase = 'marsch'; }); const bm = s.schritt();
  ok(nF() === n0 && bm.m.some((m) => m.e === 'ma' && m.h === '0703'), 'Marsch: Meldung auf der Karte (ma), aber kein Funk');
  // Belagerung von Speculum (eigener Hafen): Verband steht am Ziel
  s.schritt((z) => { a.ort = '0403'; z.angriffe[0].t_an = z.tick; }); const bb = s.schritt();
  ok(nF() === n0 + 1 && /Speculum wird belagert\. Germanische Flotte, Stärke klein\./.test(s.t.radios().filter((x) => x.lage).pop().text), 'Belagerung gesehen: Funk „… wird belagert“');
  ok(eintrag(bb, '0403', 'g') && eintrag(bb, '0403', 'g').p === 'b', 'Plakette B (belagert) in Speculum');
  const vd = bb.f.find((q) => q.h === '0403' && q.f === 'r' && q.p === 'h');
  ok(!!vd && vd.a === 0, 'zweite Plakette: Verteidiger (Rom, hält) im selben Hex');
  s.schritt(); s.schritt();
  ok(nF() === n0 + 1, 'weitere Ticks der Belagerung: kein zweiter Funk');
  // Hafen fällt (Rom ist Beteiligter: sofort)
  const ev = [{ typ: 'hafen_gefallen', tick: s.z.tick, fraktion: 'ger', ort: '0403', ortName: 'Speculum', alt: 'rom', neu: 'ger' }];
  const bf = s.schritt((z) => { z.hexe['0403'].besitzer = 'ger'; a.befehl = 'heim'; a.ort = '0803'; a.angriff = null; z.angriffe[0].t_ende = z.tick; }, ev);
  ok(nF() === n0 + 2 && /Speculum ist gefallen\./.test(s.t.radios().filter((x) => x.lage).pop().text), 'Hafen gefallen: Funk „… ist gefallen“, sofort (eigener Hafen)');
  ok(bf.m.some((m) => m.e === 'hf' && m.h === '0403' && m.f === 'g'), 'Meldung hf (Hafen gefallen) im Block');
  // Fall eines fremden Hafens außer Sicht: keine Meldung; in Sicht: einen Tick später
  const evF = (ort, alt, neu) => [{ typ: 'hafen_gefallen', tick: s.z.tick, fraktion: neu, ort, ortName: ort, alt, neu }];
  const nv = nF();
  s.schritt((z) => { z.hexe['1005'].besitzer = 'kon'; }, evF('1005', 'ger', 'kon')); s.schritt(); s.schritt();
  ok(nF() === nv, 'fremder Hafen außer Sicht (Eisenhall) fällt: keine Meldung');
  s.schritt((z) => { z.hexe['0504'].besitzer = 'pirat'; }, evF('0504', 'kon', 'pirat'));
  ok(nF() === nv && !s.block().m.some((m) => m.h === '0504'), 'fremder Hafen in Sicht (Hammerwerke) fällt in Tick n: noch nichts');
  s.schritt();
  ok(nF() === nv + 1 && s.block().m.some((m) => m.e === 'hf' && m.h === '0504'), 'in Tick n+1: Meldung und Funk');
}

// =============================================================================================================================
section('Notruf-Marken nur wenn gesehen');
{
  const s = szene();
  const nr = (an, ort, opfer) => [{ typ: 'notruf', tick: s.z.tick, fraktion: opfer, art: 'belagerung', ort, ortName: ort, opfer, angreifer: 'ger', staerke: 5, klasse: 2, angriff: an }];
  const marken = () => s.g.marken.filter((m) => m.t === 'notruf');
  const rec = (id, ziel) => s.z.angriffe.push({ id, t0: 0, ziel, von: 'ger', art: 'reich', relevant: true, zielArt: 'hafen', t_an: 1, t_ende: null, ausgang: null, phase: 'marsch', t_marsch: 0, stuetz: null, flotten: [] });
  rec(1, '0403'); rec(2, '0504'); rec(3, '1005');
  s.schritt(null, nr(1, '0403', 'rom'));
  ok(marken().length === 1 && marken()[0].h === '0403' && marken()[0].id === 'lage:a1', 'Notruf eines eigenen Hafens: Marke sofort');
  ok(s.g.snapshot().world.marken.some((m) => m.h === '0403' && m.t === 'notruf'), 'Marke im Snapshot (world.marken)');
  s.schritt(null, nr(3, '1005', 'ger')); s.schritt(); s.schritt();
  ok(!marken().some((m) => m.h === '1005'), 'Notruf außer Sicht (Eisenhall): keine Marke');
  s.schritt(null, nr(2, '0504', 'kon'));
  ok(!marken().some((m) => m.h === '0504'), 'fremder Notruf in Sicht: Tick n noch keine Marke');
  s.schritt();
  ok(marken().some((m) => m.h === '0504'), 'Tick n+1: Marke (gesehen)');
  s.schritt((z) => { z.angriffe[0].t_ende = z.tick; z.angriffe[0].ausgang = 'abgewehrt'; });
  ok(!marken().some((m) => m.h === '0403') && marken().some((m) => m.h === '0504'), 'Marke endet mit der Lage (Feldzug beendet), die andere bleibt');
  ok(s.g.errors === 0, 'keine Fehler');
}

// =============================================================================================================================
section('Block: Größe, Inhalt, kein Sim-Zustand');
{
  const s = szene();
  const W = s.ws.wissen, T = W.t = 40;
  const arten = ['s', 'm', 'b', 'u', 'r', 'h'];
  W.flotten = [];
  for (let i = 0; i < 14; i++) {
    const h = CODES[i + 4];
    W.flotten.push({ f: i % 2 ? 'g' : 'r', h, k: 1 + (i % 3), p: arten[i % 6], a: i % 4 === 3 ? T - 11 : i % 3 === 0 ? T : T - 1, [i % 2 ? 'v' : 'n']: CODES[i + 5], z: CODES[i + 6], d: 3, ids: [i], an: [i] });
  }
  W.meldungen = [];
  for (let i = 0; i < 8; i++) W.meldungen.push({ e: ['sa', 'ma', 'be', 'hf', 'hh', 'pv'][i % 6], h: CODES[i], t: T - (i % 2), f: 'g', k: 3 });
  W.ver++;
  const b = Wissen.lage(s.g), js = JSON.stringify(b);
  ok(b.f.length === KT.WERTE.flottenMax && b.m.length === 8, 'Anzeige-Grenzen: Flotten auf ' + KT.WERTE.flottenMax + ' gekappt (Meldungen schneidet die Pflege des Wissens, nicht lage())');
  b.m.length = KT.WERTE.meldungenMax;
  const worst = JSON.stringify(Object.assign({}, b, { m: b.m.slice(0, 6) }));
  ok(Buffer.byteLength(worst) <= 1200, 'Block bei 12 Flotten und 6 Meldungen (alle Felder belegt): ' + Buffer.byteLength(worst) + ' B ≤ 1200 B');
  ok(b.hx.length === 2 * CODES.length && /^[rgkpv\-RGKPV][e1-9a-z?]/.test(b.hx), 'hx: zwei Zeichen je Kartenhex (' + b.hx.length + ' Zeichen)');
  const SIM = ['vorrat', 'zufall', 'angriffe', 'absichten', 'naechsteId', 'garnison', 'abwehr', 'anspruch', 'versorgung', 'heimat', 'ids', 'ziel', 'befehl', 'staerke', 'wartend', 'erst', 'gesehen'];
  const keys = (o, out) => { if (o && typeof o === 'object') for (const k of Object.keys(o)) { out.push(k); keys(o[k], out); } return out; };
  const gefunden = keys(b, []).filter((k) => SIM.includes(k));
  ok(gefunden.length === 0, 'kein Sim-Schlüssel im Block ' + JSON.stringify(gefunden));
}

// =============================================================================================================================
section('Mehrspieler: drei Verbindungen sehen denselben Block; nur bei Änderung; Snapshot ohne Sim-Zustand (Abnahme 12)');
{
  const s = szene({ spieler: 3 });
  const { g, t } = s;
  g.step();
  const sammeln = () => { sammelt(s.z, flotteVon(s.z, '0803'), 1, '0803'); };
  sammeln(); s.schritt(); s.schritt();
  // Snapshots über viele Ticks sammeln: Änderungen, Slots
  const proc = [];
  for (let i = 0; i < 90; i++) {
    if (i === 20) s.schritt();
    if (i === 40) s.schritt((z) => { Object.assign(z.hexe['0603'], { posten: false, besitzer: null }); });
    g.step(); if (g.wantsSnapshot()) g.broadcast(g.snapshot());
  }
  const lagen = t.cs.map((c) => c.inbox.filter((m) => m.t === 'snap' && m.world && m.world.lage).map((m) => JSON.stringify(m.world.lage)));
  ok(lagen[0].length >= 2 && gleich(lagen[0], lagen[1]) && gleich(lagen[0], lagen[2]), 'alle drei Verbindungen: dieselben Blöcke in derselben Reihenfolge (' + lagen[0].length + ' Blöcke)');
  const alle = t.cs[0].inbox.filter((m) => m.t === 'snap');
  const mitLage = alle.filter((m) => m.world && m.world.lage).length;
  ok(mitLage >= 2 && mitLage <= 6, 'Block nur bei Änderung gesendet: ' + mitLage + ' von ' + alle.length + ' Snapshots');
  ok(!alle.some((m) => m.world && m.world.lage && (m.space && m.space.asteroids || m.world.locations || (m.mission && (m.mission.log || m.mission.book)))), 'nie im selben Snapshot wie Asteroiden, Ortsliste, Logbuch oder Buch');
  const SIM = ['vorrat', 'zufall', 'angriffe', 'absichten', 'naechsteId', 'garnison', 'abwehr', 'anspruch', 'versorgung', 'weltsim', 'zustand'];
  const keys = (o, out, pfad) => { if (o && typeof o === 'object') for (const k of Object.keys(o)) { out.push(pfad + '.' + k); keys(o[k], out, pfad + '.' + k); } return out; };
  const treffer = []; for (const m of alle.slice(-12)) for (const p of keys(m, [], 'snap')) if (SIM.some((k) => p.endsWith('.' + k))) treffer.push(p);
  ok(treffer.length === 0, 'Tiefensuche im Snapshot: kein Sim-Schlüssel ' + JSON.stringify(treffer.slice(0, 3)));
  const worst = Math.max(...lagen[0].map((x) => Buffer.byteLength(x)));
  ok(worst <= 1200, 'größter gesendeter Block: ' + worst + ' B');
  // Neuverbindung bekommt den Block neu
  const c4 = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(sx) { this.inbox.push(JSON.parse(sx)); } };
  g.addConnection(c4); g.handleMessage(c4, { t: 'hello', clientId: 'K0', name: 'Crew0', color: 0 });
  for (let i = 0; i < 40; i++) { g.step(); if (g.wantsSnapshot()) g.broadcast(g.snapshot()); }
  ok(c4.inbox.some((m) => m.t === 'snap' && m.world && m.world.lage), 'Wiederverbindung: der Block wird neu gesendet');
}

// =============================================================================================================================
section('Kampagne und Limes: kein Block, kein Wissen');
{
  for (const start of ['free', 'schuld_der_lerche']) {
    const t = setup(freshDir(), start); t.start();
    t.run(2);
    const sn = t.g.snapshot();
    ok(t.g.weltsim === null && !(sn.world && sn.world.lage), start + ': weltsim null, kein world.lage');
    ok(!('wissen' in (Weltstand.capture(t.g).welt.sim || {})) && !Weltstand.capture(t.g).welt.sim, start + ': kein welt.sim im Stand');
  }
}

// =============================================================================================================================
section('Speichern und Laden des Wissens; Altstand ohne Wissensblock');
{
  const dir = freshDir();
  const s = szene({ dir });
  const { g, t } = s;
  sammelt(s.z, flotteVon(s.z, '0803'), 1, '0803'); s.schritt(); s.schritt(); s.schritt((z) => { Object.assign(z.hexe['0603'], { posten: false, besitzer: null }); });
  const vorher = kopie(Wissen.toSave(g.weltsim)), blockVor = kopie(Wissen.lage(g));
  g.debugGoto('ostia_nova', true); t.run(1);
  const sr = g.saveWorld('lage', { sync: true }); const id = g.weltstand.id;
  ok(sr.ok, 'gesichert');
  const file = path.join(dir, id + '.json');
  ok(fs.existsSync(file), 'Datei des Standes da');
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  ok(d.welt.sim.wissen && gleich(d.welt.sim.wissen.hexe, vorher.hexe) && d.welt.sim.wissen.t === d.welt.sim.tick, 'welt.sim.wissen im Stand, gleicher Tick');
  ok(Weltstand.validate(d).length === 0, 'Stand mit Wissen ist schemagültig');
  const dk = kopie(d); dk.welt.sim.wissen.hexe['0803'].f = 'x';
  ok(Weltstand.validate(kopie(dk)).length === 0, '(Schema prüft die Struktur, nicht jeden Wert; die Wertprüfung macht restore)');
  t.send({ t: 'menu', op: 'end' });
  const wdirReal = dir;
  const b = setup(wdirReal, 'free'); b.send({ t: 'lobbyOpt', world: id }); b.send({ t: 'ready', ready: true }); b.run(2);
  const gb = b.g;
  ok(gb.weltsim && gb.weltsim.wissen && gleich(Wissen.toSave(gb.weltsim), vorher), 'nach dem Laden: Wissen tief gleich');
  ok(gleich(Wissen.lage(gb), blockVor) || (Wissen.lage(gb).hx === blockVor.hx && gleich(Wissen.lage(gb).f, blockVor.f)), 'Anzeigeblock nach dem Laden gleich');
  ok(gb.errors === 0, 'keine Fehler beim Laden');
  b.send({ t: 'menu', op: 'end' });
  // Altstand ohne Wissensblock
  const dohne = kopie(d); delete dohne.welt.sim.wissen; fs.writeFileSync(file, JSON.stringify(dohne));
  const c = setup(wdirReal, 'free'); c.send({ t: 'lobbyOpt', world: id }); c.send({ t: 'ready', ready: true }); c.run(2);
  const gc = c.g;
  ok(gc.weltsim && gc.weltsim.wissen && gc.errors === 0, 'Altstand ohne Wissen lädt ohne Fehler, Wissen beginnt neu');
  const bc = Wissen.lage(gc);
  ok(hxVon(bc)['0803'].alter === null && hxVon(bc)['0305'].f === 'r' && bc.f.length === 0 && bc.m.length === 0, 'neues Wissen: Kartenstand, nichts gesehen, keine Flotten, keine Meldungen');
  c.send({ t: 'menu', op: 'end' });
  // unbrauchbarer Wissensblock: kein Absturz, neu beginnen, Fehler gezählt
  const dk2 = kopie(d); dk2.welt.sim.wissen.hexe = { '0105': { f: 'q', p: 0, a: 1 } }; fs.writeFileSync(file, JSON.stringify(dk2));
  const e = setup(wdirReal, 'free');
  const log = console.warn, logE = console.error; console.warn = () => {}; console.error = () => {};
  try { e.send({ t: 'lobbyOpt', world: id }); e.send({ t: 'ready', ready: true }); e.run(2); } finally { console.warn = log; console.error = logE; }
  ok(e.g.phase === 'play' && e.g.weltsim && e.g.weltsim.wissen && e.g.errors >= 1, 'unbrauchbarer Wissensblock: neu begonnen, Fehler gezählt, Spiel läuft');
  e.send({ t: 'menu', op: 'end' });
}

// =============================================================================================================================
section('Ein Tick im echten Sprung füllt das Wissen (Lerche am Ziel als Sensorknoten)');
{
  const t = setup(freshDir(), 'freie_fahrt'); const g = t.g; t.start();
  g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0; g.C.reise.feindChance = 0;
  const route = (von, h) => { g.explore.markBoje(Sektoren.kanteId(von, h)); g.explore.erkunde(h); };
  route('0305', '0205');
  Sprung.selectDest(g, Sektoren.ortVonHex('0205'));
  const p = Sprung.sprungpunkt(g, '0205'); place(g, p.x - 80, p.y); t.run(40); g.space.enemies = [];
  const t0 = g.weltsim.tickZahl;
  ok(Sprung.doJump(g) === null && g.weltsim.tickZahl === t0 + 1, 'Sprung nach Vulcania: ein Tick');
  const b = Wissen.lage(g);
  ok(b.t === t0 + 1 && g.weltsim.wissen.t === b.t, 'Wissen hat denselben Tick');
  ok(g.errors === 0, 'keine Fehler');
}

console.log('\n' + (n - fails) + '/' + n + ' Prüfungen ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
process.exit(fails ? 1 : 0);
