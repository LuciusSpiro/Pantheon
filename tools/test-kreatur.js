'use strict';
// MON-01 P1: Kreaturen-Rahmen (server/sim/kreatur.js, content/kampf/kreaturen.json). Echtes Spiel (Game), Debug `kreatur <typ>`.
// Geprüft: Daten laden, Validator lehnt kaputte Daten ab, Kreatur nur mit Debug, Zyklus (Aufladen → Rammen → Pause, Dauern), Hindernis im Rammweg, Wahrnehmung und Verfolgen,
// Türen-Schalter, Registry (neuer Baustein ohne Umbau), kein Zufallsverbrauch aus game.rng, Station-Monster-Bahn mit/ohne Kreatur gleich, ohne Kreaturen unverändert,
// kein Typname im server/. Nacharbeit: Station-Monster gegen den festen Sollwert aus main da8d19c (tools/fixtures/mon01-station-bahn.json), Schott-Aufbrechen mit gemessener Rammzeit,
// Maske gegen feste Referenzen, Validator-Lücken (Größe nur 1 und 2 (MON-02 G), unbekannte Felder, Sackgasse, Namenskollisionen, unerreichbare Zustände), kein Update ohne Außenteam.
//   node tools/test-kreatur.js   (npm run test:kreatur)
const fs = require('fs');
const path = require('path');
const CONFIG = require('../shared/config.js');
const Mon = require('../shared/monster.js');
const Locations = require('../shared/locations.js');
const { Game } = require('../server/game.js');
const interior = require('../server/sim/interior.js');
const combat = require('../server/sim/combat.js');
const space = require('../server/sim/space.js');
const Welt = require('../server/sim/welt.js');
const away = require('../server/sim/away.js');
const Anker = require('../server/sim/anker.js');
const Monster = require('../server/sim/monster.js');
const Kreatur = require('../server/sim/kreatur.js');
const Protocol = require('../shared/protocol.js');
const KREATUREN = require('../content/kampf/kreaturen.json');
const Soll = require('./fixture-station-bahn.js');
const SOLL = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'mon01-station-bahn.json'), 'utf8'));

const DT = 1 / CONFIG.tickHz;
const TILE = 32;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (name, body) => {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
};
const kopie = (o) => JSON.parse(JSON.stringify(o));
const nahe = (a, b, tol) => Math.abs(a - b) <= tol;

// ---------- Szene: Station Helix (lange breite Gänge), Station-Monster aus (aw.monster = null), ein Spieler unverwundbar ----------
function stationRoh(debug) {
  const g = new Game({ noStore: true, worlds: false, seed: 21, debug, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send() {}, sendRaw() {} };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'T0', name: 'Kre', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'free' }); g.handleMessage(c, { t: 'ready', ready: true });
  Welt.waehle(g, 'sund'); g.god = true; space.enterScene(g, 'helix', {});
  const sc = Locations.get('helix').scene; g.ship.x = sc.station.x - 100; g.ship.y = sc.station.y;
  const run = (sec, each) => { for (let k = 0; k < Math.round(sec / DT); k++) { if (each && each(k * DT) === true) return true; g.step(); } return false; };
  run(0.2);
  g.chooseLandepunkt(g.players[0], 'helix.station');
  away.executeBeam(g, g.players.map((q) => q.id), 'down');
  run(0.3);
  return { g, c, run, p: g.players[0] };
}
function szene(debug) {
  const T = stationRoh(debug); const g = T.g; const p = T.p;
  g.away.monster = null;   // kein Station-Monster (eigener Test unten)
  p.x = 3 * TILE; p.y = 3 * TILE; p.downed = false;
  const notes = [];
  const n0 = g.notice.bind(g); g.notice = (q, t) => { notes.push(t); return n0(q, t); };
  const k = g.karteOf(g.away.map);
  const S = { g, c: T.c, p, k, m: Monster.maskeVon(k), notes, pad: { x: p.x, y: p.y } };
  S.dbg = (cmd, extra) => g.handleMessage(T.c, Object.assign({ t: 'debug', cmd }, extra || {}));
  S.lauf = (sek, each) => T.run(sek, each);
  S.setz = (x, y) => { p.x = x; p.y = y; p.downed = false; };
  S.tilePos = (cx, cy) => ({ x: cx * TILE, y: cy * TILE });   // Ankerpunkt-Mitte
  return S;
}
// Längste waagerechte Strecke von Ankerpunkten der Maske (zusammenhängend), Zeile cy, von cx0 bis cx1; dahinter sperrt die Maske (Wand/Objekt)
function strecken(m, min) {
  const out = [];
  for (let cy = 2; cy < m.h - 1; cy++) {
    let cx = 1;
    while (cx < m.w) {
      if (!m.geht(cx, cy)) { cx++; continue; }
      let e = cx; while (m.geht(e + 1, cy)) e++;
      // Zeile cy-1/cy+1 ebenfalls frei: Breite für Abweichungen beim Rammen
      if (e - cx + 1 >= min && !m.geht(e + 1, cy) && e + 1 < m.w) out.push({ cy, cx0: cx, cx1: e });
      cx = e + 1;
    }
  }
  return out.sort((a, b) => (b.cx1 - b.cx0) - (a.cx1 - a.cx0));
}
function kreaturIn(S, typ, cx, cy) {
  const pos = S.tilePos(cx, cy);
  combat.ensureV2(S.g, S.g.away);
  return Kreatur.erzeugen(S.g, typ, pos.x, pos.y);
}
// Aufzeichnung der Zustandswechsel: [{ z, t }] ab Aufruf
function aufzeichnung(S, K) {
  const log = []; let last = K.z; let t0 = 0;
  return { log, tick(t) { if (K.z !== last) { log.push({ von: last, z: K.z, t, dauer: t - t0 }); t0 = t; last = K.z; } return false; } };
}

section('Daten und Validator', () => {
  const d = Kreatur.daten();
  ok(d && d.typen && d.typen.probe, 'kreaturen.json geladen, Typ probe vorhanden');
  ok(Kreatur.pruefen(KREATUREN).length === 0, 'Validator: Daten der Auslieferung fehlerfrei');
  const t = d.typen.probe;
  ok(typeof t.name === 'string' && t.groesse === 2 && t.sicht > 0 && t.hitRadius > 0 && t.schild && t.wunden >= 1 && t.frontArc > 0 && typeof t.tuerenAufbrechen === 'boolean' && t.zustaende && t.bausteine.zyklus,
    'Typ probe trägt Name-Schlüssel, Größe, Sicht, hitRadius, Schild, Wunden, frontArc, tuerenAufbrechen, Zustandstabelle, Bausteine');
  ok(Object.values(t.zustaende).every((z) => typeof z.tempo === 'number'), 'Tempo je Zustand');
  // keine Anzeigetexte: keine Textfelder, und jeder String der Typen ist ein Bezeichner/Schlüssel (kein Leerzeichen, keine Umlaute, keine Satzzeichen)
  const verboten = ['text', 'zeile', 'hinweis', 'beschreibung', 'titel', 'label', 'anzeige'];
  const schlechte = [];
  const geh = (v, pfad) => {
    if (typeof v === 'string') { if (!/^[A-Za-z0-9_.]+$/.test(v)) schlechte.push(pfad + '="' + v + '"'); }
    else if (Array.isArray(v)) v.forEach((x, i) => geh(x, pfad + '[' + i + ']'));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (verboten.includes(k)) schlechte.push(pfad + '.' + k + ' (Textfeld)'); geh(x, pfad + '.' + k); }
  };
  geh(d.typen, 'typen');
  ok(schlechte.length === 0, 'keine Anzeigetexte in den Typen (nur Schlüssel und Zahlen)' + (schlechte.length ? ': ' + schlechte.slice(0, 3).join('; ') : ''));
  { const k = kopie(d); k.typen.probe.zustaende.jagd.hinweis = 'Der Jäger sucht'; schlechte.length = 0; geh(k.typen, 'typen'); ok(schlechte.length === 2, 'Gegenprobe: ein Textfeld mit Satz wird erkannt (' + schlechte.length + ' Befunde)'); }
  // kaputte Daten: jeweils eine gezielte Beschädigung muss mit Pfad im Text abgelehnt werden
  const kaputt = (name, mut, erwartet) => {
    const k = kopie(KREATUREN); mut(k);
    const F = Kreatur.pruefen(k);
    ok(F.length > 0 && F.some((x) => x.includes(erwartet)), 'Validator lehnt ab: ' + name + (F.length ? ' (' + F[0] + ')' : ''));
  };
  kaputt('Nicht-Objekt', (k) => { k.typen = []; }, 'typen');
  kaputt('Name fehlt', (k) => { delete k.typen.probe.name; }, 'typen.probe.name');
  kaputt('Größe 9', (k) => { k.typen.probe.groesse = 9; }, 'groesse');
  for (const gr of [0, 3, 4, '1', 1.5, null]) kaputt('Größe ' + JSON.stringify(gr) + ' (nur 1 und 2 zugelassen)', (k) => { k.typen.probe.groesse = gr; }, 'muss 1 oder 2 sein');
  for (const gr of [1, 2]) { const k = kopie(KREATUREN); k.typen.probe.groesse = gr; ok(!Kreatur.pruefen(k).some((x) => /groesse/.test(x)), 'Validator lässt Größe ' + gr + ' zu'); }
  kaputt('Größe als Text', (k) => { k.typen.probe.groesse = '2'; }, 'groesse');
  kaputt('Sicht negativ', (k) => { k.typen.probe.sicht = -1; }, 'sicht');
  kaputt('Schild seg > max', (k) => { k.typen.probe.schild = { seg: 5, max: 4 }; }, 'schild');
  kaputt('tuerenAufbrechen kein Boolean', (k) => { k.typen.probe.tuerenAufbrechen = 'ja'; }, 'tuerenAufbrechen');
  kaputt('unbekanntes Feld', (k) => { k.typen.probe.sonderlogik = 1; }, 'sonderlogik');
  kaputt('Start fehlt in der Tabelle', (k) => { k.typen.probe.start = 'nirgends'; }, 'start');
  kaputt('Übergang auf unbekannten Zustand', (k) => { k.typen.probe.zustaende.jagd.uebergang[0].nach = 'weg'; }, 'nach');
  kaputt('unbekannter Auslöser', (k) => { k.typen.probe.zustaende.jagd.uebergang[0].auf = 'zauber'; }, 'Auslöser');
  kaputt('ablauf ohne dauer', (k) => { delete k.typen.probe.zustaende.aufladen.dauer; }, 'dauer');
  kaputt('nah ohne abstand', (k) => { delete k.typen.probe.zustaende.jagd.uebergang[0].abstand; }, 'abstand');
  kaputt('unbekannter Modus', (k) => { k.typen.probe.zustaende.pause.modus = 'fliegen'; }, 'Modus');
  kaputt('unbekannter Baustein', (k) => { k.typen.probe.bausteine.magie = {}; }, 'unbekannter Baustein');
  kaputt('Modus ramme ohne eingeschalteten Baustein zyklus', (k) => { k.typen.probe.bausteine = {}; }, 'Modus');
  kaputt('Baustein-Parameter falsch', (k) => { k.typen.probe.bausteine.zyklus.hindernisAb = 5; }, 'hindernisAb');
  kaputt('Version', (k) => { k.version = 2; }, 'version');
  kaputt('schild: unbekanntes Feld', (k) => { k.typen.probe.schild.bonus = 1; }, 'schild.bonus');
  kaputt('schildRegen: unbekanntes Feld', (k) => { k.typen.probe.schildRegen = { verzoegerung: 1, schritt: 1, extra: 1 }; }, 'schildRegen.extra');
  kaputt('Übergang: unbekanntes Feld', (k) => { k.typen.probe.zustaende.jagd.uebergang[0].bonus = 1; }, 'uebergang[0].bonus');
  kaputt('abstand bei Auslöser ≠ nah', (k) => { k.typen.probe.zustaende.pause.uebergang[0].abstand = 3; }, 'abstand gilt nur für den Auslöser nah');
  kaputt('Sackgasse: ramme mit tempo 0, einziger Ausgang blockiert', (k) => { const z = k.typen.probe.zustaende.rammen; z.tempo = 0; z.uebergang = [{ auf: 'blockiert', nach: 'steckt' }]; }, 'Sackgasse');
  kaputt('unerreichbarer Zustand', (k) => { k.typen.probe.zustaende.insel = { modus: 'steht', tempo: 0, uebergang: [{ auf: 'sieht', nach: 'jagd' }] }; }, 'zustaende.insel: unerreichbar');
  { // gültige Gegenproben: ramme mit tempo 0 UND einem weiteren Ausgang ist keine Sackgasse; ein eigener Typ, der alles erreicht, bleibt gültig
    const k = kopie(KREATUREN); const z = k.typen.probe.zustaende.rammen; z.tempo = 0; z.uebergang.push({ auf: 'ablauf', nach: 'pause' });
    ok(!Kreatur.pruefen(k).some((x) => /Sackgasse/.test(x)), 'Gegenprobe: ramme mit tempo 0 und weiterem Ausgang ist keine Sackgasse');
  }
  // Namenskollisionen unter Bausteinen (Modi und Auslöser): erst mit zwei temporär angemeldeten Bausteinen
  { const abm = [
      Kreatur.kreaturBausteinAnmelden('__dopp1', { modi: { gleich: { tick() {} } }, ausloeser: { gleichA: () => false } }),
      Kreatur.kreaturBausteinAnmelden('__dopp2', { modi: { gleich: { tick() {} } }, ausloeser: { gleichA: () => false } }),
      Kreatur.kreaturBausteinAnmelden('__kern', { modi: { zielen: { tick() {} } }, ausloeser: { sieht: () => false } }),
    ];
    try {
      const mitB = (namen) => { const k = kopie(KREATUREN); for (const b of namen) k.typen.probe.bausteine[b] = {}; return Kreatur.pruefen(k); };
      ok(!mitB(['__dopp1']).some((x) => /gibt es schon|Kernname/.test(x)), 'Gegenprobe: ein einzelner Baustein mit eigenem Modusnamen ist gültig');
      const F2 = mitB(['__dopp1', '__dopp2']);
      ok(F2.some((x) => /Modus "gleich" gibt es schon im Baustein __dopp1/.test(x)) && F2.some((x) => /Auslöser "gleichA" gibt es schon/.test(x)), 'Validator lehnt ab: zwei Bausteine mit gleichem Modus- und Auslösernamen (' + (F2[0] || '-') + ')');
      const F3 = mitB(['__kern']);
      ok(F3.some((x) => /Modus "zielen" ist ein Kernname/.test(x)) && F3.some((x) => /Auslöser "sieht" ist ein Kernname/.test(x)), 'Validator lehnt ab: Baustein überdeckt Kernmodus und Kernauslöser (' + (F3[0] || '-') + ')');
    } finally { abm.forEach((a) => a()); }
  }
  // Laden: kaputte Daten sind beim Laden ein Fehler mit klarer Meldung (alle Befunde in einem Text)
  const alt = KREATUREN.typen.probe.start;
  const abm = Kreatur.kreaturBausteinAnmelden('__cache__', {}); // Anmelden/Abmelden verwirft die geprüften Daten (nächster Gebrauch lädt neu)
  KREATUREN.typen.probe.start = 'nirgends'; KREATUREN.typen.probe.sicht = -2; abm();
  let msg = null; try { Kreatur.daten(); } catch (e) { msg = e.message; }
  ok(msg && /kreaturen\.json ungültig/.test(msg) && /typen\.probe\.start/.test(msg) && /typen\.probe\.sicht/.test(msg), 'Laden mit kaputten Daten: Exception mit Dateiname und allen Befunden');
  KREATUREN.typen.probe.start = alt; KREATUREN.typen.probe.sicht = 9;
  const abm2 = Kreatur.kreaturBausteinAnmelden('__cache__', {}); abm2();
  ok(Kreatur.daten().typen.probe.start === alt, 'danach wieder ladbar');
});

section('Entstehen nur mit Debug', () => {
  ok(Protocol.DEBUG_CMDS.includes('kreatur'), 'kreatur ist ein Debug-Kommando');
  const S0 = szene(false);
  S0.dbg('kreatur', { typ: 'probe' });
  ok(S0.g.away.kreaturen === undefined, 'ohne --debug: keine Kreatur (Befehl wird schon vom Spiel abgewiesen)');
  S0.lauf(1);
  ok(S0.g.away.kreaturen === undefined, 'ohne --debug auch nach Ticks keine Kreatur');
  const S1 = szene(true);
  { const lang = strecken(S1.m, 8)[0]; const q = S1.tilePos(lang.cx0 + 3, lang.cy); S1.setz(q.x, q.y); }   // Spieler im Gang
  S1.dbg('kreatur', { typ: 'probe' });
  const lst = S1.g.away.kreaturen;
  ok(lst && lst.length === 1, 'mit --debug: eine Kreatur in aw.kreaturen');
  const K = lst[0];
  ok(K.kind === 'kreatur' && K.kreatur === true && K.typ === 'probe' && K.id === 'K1' && Number.isFinite(K.x) && Number.isFinite(K.y) && Number.isFinite(K.facing), 'Felder kind, kreatur, typ, id K1, Position, facing');
  ok(K.z === 'patrouille' && Array.isArray(K.pfad), 'Zustand = Start der Tabelle, Pfad');
  ok(K.seg === 4 && K.max === 4 && K.wunden.n === 3 && K.frontArc === 120 && K.hitRadius === 24 && K.team === 'feind', 'Werte aus den Daten: Schild, Wunden, frontArc, hitRadius, Team');
  ok(S1.g.away.drones.every((d) => d.kind !== 'kreatur') && !S1.g.away.monster, 'nicht in aw.drones, nicht aw.monster');
  S1.dbg('kreatur', { typ: 'probe' });
  ok(S1.g.away.kreaturen.length === 2 && S1.g.away.kreaturen[1].id === 'K2', 'zweiter Aufruf: K2');
  const nach = S1.notes.length;
  S1.dbg('kreatur', { typ: 'gibtsnicht' });
  ok(S1.g.away.kreaturen.length === 2 && /unbekannter Typ/.test(S1.notes[S1.notes.length - 1]) && S1.notes.length > nach, 'unbekannter Typ: Hinweis, nichts erzeugt');
  S1.dbg('kreatur', {});
  ok(/probe/.test(S1.notes[S1.notes.length - 1]), 'ohne Typ: Liste der Typen');
  // Karte wechseln: Zustand lebt in der Karte und ist nicht im Weltstand
  ok(!JSON.stringify(S1.g.weltstand || {}).includes('"kreaturen"'), 'nichts im Weltstand');
  // nicht am Boden
  const g = new Game({ noStore: true, seed: 11, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(x) { this.inbox.push(x); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'K9', name: 'X', color: 0 }); g.handleMessage(c, { t: 'ready', ready: true });
  for (let i = 0; i < 6; i++) g.step();
  const notes = []; const n0 = g.notice.bind(g); g.notice = (q, t) => { notes.push(t); return n0(q, t); };
  g.handleMessage(c, { t: 'debug', cmd: 'kreatur', typ: 'probe' });
  ok(/nur am Boden/.test(notes[notes.length - 1] || ''), 'an Bord: Hinweis, keine Kreatur');
});

section('Zyklus: Aufladen → Rammen → Pause', () => {
  const S = szene(true);
  const lang = strecken(S.m, 16)[0];
  ok(!!lang, 'Strecke von mindestens 16 Ankerpunkten gefunden (' + (lang ? lang.cx1 - lang.cx0 + 1 : 0) + ')');
  const K = kreaturIn(S, 'probe', lang.cx0, lang.cy);
  Kreatur.zustandSetzen(S.g, K, 'jagd');
  K.facing = 0;
  const ps = S.tilePos(lang.cx0 + 5, lang.cy);   // 5 Kacheln voraus: in Sicht und in `nah`-Abstand
  S.setz(ps.x, ps.y);
  const A = aufzeichnung(S, K);
  S.lauf(8, (t) => A.tick(t));
  const folge = A.log.map((e) => e.z).join('>');
  ok(folge.startsWith('aufladen>rammen>pause>jagd>aufladen'), 'Zustandsfolge jagd → aufladen → rammen → pause → jagd → aufladen (' + folge + ')');
  const dauer = (z) => { const e = A.log.find((x) => x.von === z); return e ? e.dauer : null; };
  const tab = Kreatur.daten().typen.probe.zustaende;
  ok(nahe(dauer('aufladen'), tab.aufladen.dauer, 2 * DT), 'Aufladen dauert ' + tab.aufladen.dauer + ' s (gemessen ' + (dauer('aufladen') || 0).toFixed(2) + ')');
  ok(nahe(dauer('rammen'), tab.rammen.dauer, 2 * DT), 'Rammen dauert ' + tab.rammen.dauer + ' s (gemessen ' + (dauer('rammen') || 0).toFixed(2) + ')');
  ok(nahe(dauer('pause'), tab.pause.dauer, 2 * DT), 'Pause dauert ' + tab.pause.dauer + ' s (gemessen ' + (dauer('pause') || 0).toFixed(2) + ')');
  ok(!A.log.some((e) => e.z === 'steckt'), 'freie Bahn: kein Steckenbleiben');
  // Datengetrieben: andere Dauer in den Daten = andere Dauer im Lauf
  const alt = tab.aufladen.dauer; tab.aufladen.dauer = 0.5;
  const S2 = szene(true); const K2 = kreaturIn(S2, 'probe', lang.cx0, lang.cy); Kreatur.zustandSetzen(S2.g, K2, 'jagd'); S2.setz(ps.x, ps.y);
  const A2 = aufzeichnung(S2, K2); S2.lauf(3, (t) => A2.tick(t));
  tab.aufladen.dauer = alt;
  const d2 = A2.log.find((x) => x.von === 'aufladen');
  ok(d2 && nahe(d2.dauer, 0.5, 2 * DT), 'Dauer kommt aus den Daten (0,5 s gesetzt, gemessen ' + (d2 ? d2.dauer.toFixed(2) : '-') + ')');
  // Rammen läuft in Blickrichtung (Richtung steht nach dem Aufladen fest) und legt Strecke zurück
  const S3 = szene(true); const K3 = kreaturIn(S3, 'probe', lang.cx0, lang.cy); Kreatur.zustandSetzen(S3.g, K3, 'rammen'); K3.facing = 0;
  const x0 = K3.x; S3.setz(S3.pad.x, S3.pad.y);
  S3.lauf(0.5);
  ok(K3.x - x0 > 0.45 * tab.rammen.tempo * 0.9 && Math.abs(K3.y - lang.cy * TILE) < 1, 'Rammen: geradeaus in Blickrichtung mit Tempo ' + tab.rammen.tempo + ' (' + Math.round(K3.x - x0) + ' px in 0,5 s)');
});

section('Hindernis im Rammweg', () => {
  const S = szene(true);
  const st = strecken(S.m, 8)[0];
  // Ende der Strecke ist Hindernis: 4 Kacheln davor starten
  const cx = st.cx1 - 4;
  const K = kreaturIn(S, 'probe', cx, st.cy);
  Kreatur.zustandSetzen(S.g, K, 'rammen'); K.facing = 0;
  S.setz(S.pad.x, S.pad.y);
  const wandX = (st.cx1 + 1) * TILE;   // erste gesperrte Ankerspalte; der Fußabdruck stößt spätestens hier an
  const A = aufzeichnung(S, K);
  S.lauf(4, (t) => A.tick(t));
  const folge = A.log.map((e) => e.z).join('>');
  ok(folge.startsWith('steckt>pause'), 'Hindernis: rammen → steckt → pause (' + folge + ')');
  const e1 = A.log[0];
  ok(e1 && e1.t < 0.9 * 0.9, 'angehalten, bevor die Rammzeit um war (nach ' + (e1 ? e1.t.toFixed(2) : '-') + ' s)');
  ok(K.x < wandX + 20 && K.x > st.cx0 * TILE, 'Position vor dem Hindernis (x ' + Math.round(K.x) + ', Sperre ab ' + wandX + ')');
  const tab = Kreatur.daten().typen.probe.zustaende;
  const eSt = A.log.find((e) => e.von === 'steckt');
  ok(eSt && nahe(eSt.dauer, tab.steckt.dauer, 2 * DT), 'bleibt ' + tab.steckt.dauer + ' s stecken (gemessen ' + (eSt ? eSt.dauer.toFixed(2) : '-') + ')');
  // Gegenprobe: gleiche Kreatur weit vor der Wand kommt ohne Stocken durch
  const S2 = szene(true); const lang = strecken(S2.m, 16)[0];
  const K2 = kreaturIn(S2, 'probe', lang.cx1 - 14, lang.cy); Kreatur.zustandSetzen(S2.g, K2, 'rammen'); K2.facing = 0;
  S2.setz(S2.pad.x, S2.pad.y); const A2 = aufzeichnung(S2, K2); S2.lauf(1.2, (t) => A2.tick(t));
  ok(A2.log.length >= 1 && A2.log[0].z === 'pause', 'Gegenprobe: freie Bahn → direkt pause, kein steckt');
});

section('Wahrnehmung und Verfolgen', () => {
  const S = szene(true);
  const lang = strecken(S.m, 16)[0];
  const K = kreaturIn(S, 'probe', lang.cx0 + 1, lang.cy);
  const sicht = Kreatur.daten().typen.probe.sicht;
  // außerhalb der Sicht (14 Kacheln, freie Linie): bleibt in der Patrouille
  const fern = S.tilePos(lang.cx0 + 1 + 14, lang.cy);
  S.setz(fern.x, fern.y);
  S.lauf(1.5);
  ok(K.z === 'patrouille' && Math.hypot(S.p.x - K.x, S.p.y - K.y) > sicht * TILE, 'Spieler außerhalb der Sicht (> ' + sicht + ' Kacheln): Patrouille bleibt');
  // in Sicht (7 Kacheln, freie Linie) -> Jagd, dann Nähern bis zum Aufladen
  K.x = S.tilePos(lang.cx0 + 1, lang.cy).x; K.y = S.tilePos(lang.cx0 + 1, lang.cy).y; K.pfad = [];
  const nah = S.tilePos(lang.cx0 + 1 + 8, lang.cy); S.setz(nah.x, nah.y);
  const d0 = Math.hypot(S.p.x - K.x, S.p.y - K.y);
  S.lauf(0.2);
  ok(K.z === 'jagd', 'Spieler in Sicht (8 Kacheln, Sichtlinie frei): Jagd');
  const ok1 = S.lauf(4, () => K.z === 'aufladen');
  ok(ok1 && Math.hypot(S.p.x - K.x, S.p.y - K.y) < d0 - 30, 'Verfolgen: die Kreatur nähert sich (' + Math.round(d0) + ' → ' + Math.round(Math.hypot(S.p.x - K.x, S.p.y - K.y)) + ' px) und lädt auf, sobald `nah` (6 Kacheln) erreicht ist');
  // Verlust: Spieler weg -> nach verlustZeit zurück zur Patrouille
  Kreatur.zustandSetzen(S.g, K, 'jagd'); K.verlust = 0;
  S.setz(S.pad.x, S.pad.y);
  const vz = Kreatur.daten().typen.probe.verlustZeit;
  S.lauf(vz - 0.5);
  ok(K.z === 'jagd', 'Spieler verschwunden: noch Jagd vor Ablauf von verlustZeit');
  S.lauf(1.2);
  ok(K.z === 'patrouille', 'nach verlustZeit (' + vz + ' s) wieder Patrouille');
  // Sichtlinie: ein Spieler hinter einer Wand wird nicht wahrgenommen (nah genug für die Sicht, aber ohne Linie)
  const S2 = szene(true); const E = combat.env(S2.g); let paar = null;
  const probeK = { x: 0, y: 0 };
  suche: for (let cy = 2; cy < S2.m.h - 1; cy++) for (let cx = 2; cx < S2.m.w - 1; cx++) {
    if (!S2.m.geht(cx, cy)) continue;
    for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) {
      const d = Math.hypot(dx, dy); if (d < 4 || d > 7) continue;
      const tx = cx + dx, ty = cy + dy; if (tx < 1 || ty < 1 || tx >= S2.m.w || ty >= S2.m.h) continue;
      probeK.x = cx * TILE; probeK.y = cy * TILE;
      const pp = { x: tx * TILE + 16, y: ty * TILE + 16 };
      if (!S2.m.raster.begehbar(tx, ty)) continue;
      if (!combat.losBetween(E, probeK, pp)) { paar = { cx, cy, px: pp.x, py: pp.y }; break suche; }
    }
  }
  ok(!!paar, 'Karte hat ein Paar nah beieinander ohne Sichtlinie');
  if (paar) {
    const K2 = kreaturIn(S2, 'probe', paar.cx, paar.cy);
    S2.setz(paar.px, paar.py); K2.wait = 0;
    S2.lauf(1.2);
    ok(K2.z === 'patrouille' && Math.hypot(S2.p.x - K2.x, S2.p.y - K2.y) < sicht * TILE, 'ohne Sichtlinie keine Wahrnehmung (Abstand ' + Math.round(Math.hypot(S2.p.x - K2.x, S2.p.y - K2.y)) + ' px < Sicht)');
  }
  // Bewusstlose/verwundete Spieler werden nicht wahrgenommen (Wahrnehmung wie die Station)
  const S3 = szene(true); const K3 = kreaturIn(S3, 'probe', lang.cx0 + 1, lang.cy);
  const q = S3.tilePos(lang.cx0 + 1 + 5, lang.cy); S3.setz(q.x, q.y); S3.p.downed = true;
  S3.lauf(0.6);
  ok(K3.z === 'patrouille', 'verwundeter Spieler wird nicht verfolgt');
});

// ---------- Türen: Station Helix (Schotts) ----------
const station = stationRoh.bind(null, true);
// Schott mit Ankerpunkt davor/dahinter, Weg zwischen beiden führt über das Schott
function schottWeg(g) {
  const k = g.karteOf(g.away.map); const m = Monster.maskeVon(k);
  for (const [kid, kt] of Object.entries(k.kanten || {})) {
    if (kt.typ !== 'schott' || !kt.tiles || kt.tiles.length < 2) continue;
    const [a, b] = kt.tiles;
    const senkrecht = a[0] === b[0];   // Tür in einer Spalte: Durchgang in x-Richtung
    const mx = Math.round((a[0] + b[0]) / 2) + (senkrecht ? 1 : 0), my = Math.round((a[1] + b[1]) / 2) + (senkrecht ? 0 : 1);
    const vor = Mon.naechster(m, senkrecht ? a[0] - 3 : mx, senkrecht ? my : a[1] - 3, 1);
    const hin = Mon.naechster(m, senkrecht ? a[0] + 4 : mx, senkrecht ? my : a[1] + 4, 1);
    if (!vor || !hin) continue;
    const w = Mon.weg(m, vor, hin, 4000);
    if (!w || w.length < 4 || w.length > 14) continue;
    // der Weg muss die Kante wirklich kreuzen
    const kreuzt = w.some((s) => [[-1, -1], [0, -1], [-1, 0], [0, 0]].some(([dx, dy]) => (s.cx + dx) + ',' + (s.cy + dy) === a[0] + ',' + a[1] || (s.cx + dx) + ',' + (s.cy + dy) === b[0] + ',' + b[1]));
    if (kreuzt) return { kid, vor, hin, w };
  }
  return null;
}

section('Türen-Schalter tuerenAufbrechen', () => {
  const probeTyp = KREATUREN.typen.probe;
  for (const aufbrechen of [false, true]) {
    const T = station(); const g = T.g; const aw = g.away;
    const sw = schottWeg(g);
    ok(!!sw, 'Schott mit Weg gefunden (' + (sw ? sw.kid + ', ' + sw.w.length + ' Schritte' : '-') + ')');
    if (!sw) continue;
    const altA = probeTyp.tuerenAufbrechen; probeTyp.tuerenAufbrechen = aufbrechen;
    try {
      ok(!Anker.setzen(g, aw.map, sw.kid, 'zu', null, { still: true }), 'Schott geschlossen');
      T.p.x = 3 * 32; T.p.y = 3 * 32;   // Spieler weit weg
      aw.monster = null;   // kein Station-Monster in dieser Szene
      combat.ensureV2(g, aw);
      const pos = Mon.mitte(sw.vor);
      const K = Kreatur.erzeugen(g, 'probe', pos.x, pos.y);
      Kreatur.zustandSetzen(g, K, 'jagd');
      const ziel = Mon.mitte(sw.hin); K.letzte = { x: ziel.x, y: ziel.y };
      const zielNah = () => Math.hypot(K.x - ziel.x, K.y - ziel.y) < 40;
      T.run(9, () => { K.verlust = 0; K.letzte = { x: ziel.x, y: ziel.y }; return zielNah(); });
      const z = Anker.zustand(g, aw.map, sw.kid);
      if (aufbrechen) ok(z === 'offen' && zielNah(), 'tuerenAufbrechen true: Schott aufgebrochen (' + z + '), Kreatur durch');
      else ok(z === 'zu' && !zielNah(), 'tuerenAufbrechen false: Schott bleibt zu (' + z + '), Kreatur steht davor (' + Math.round(Math.hypot(K.x - ziel.x, K.y - ziel.y)) + ' px vom Ziel)');
    } finally { probeTyp.tuerenAufbrechen = altA; }
  }
});

section('Registry: neuer Baustein ohne Umbau', () => {
  const S = szene(true);
  const zaehl = { tick: 0, treffer: 0, laerm: 0, modus: 0, betreten: 0 };
  let abm = null;
  const def = {
    beiTick: (game, K, dt, par) => { zaehl.tick++; zaehl.par = par; },
    beiTreffer: (game, K, tr, par) => { zaehl.treffer++; zaehl.trPar = par; },
    beiLaerm: (game, K, lm, par) => { zaehl.laerm++; },
    modi: { wippen: { betreten() { zaehl.betreten++; }, tick() { zaehl.modus++; } } },
    ausloeser: { immerNach: () => true },
    pruefen: (par) => (par && par.x === 1 ? [] : ['x muss 1 sein']),
  };
  abm = Kreatur.kreaturBausteinAnmelden('testbau', def);
  let doppelt = null; try { Kreatur.kreaturBausteinAnmelden('testbau', def); } catch (e) { doppelt = e.message; }
  ok(/bereits angemeldet/.test(doppelt || ''), 'doppelte Anmeldung ist eine Ausnahme');
  let kaputt = null; try { Kreatur.kreaturBausteinAnmelden('schlecht', { beiTick: 5 }); } catch (e) { kaputt = e.message; }
  ok(/Funktion/.test(kaputt || ''), 'ungültige Definition ist eine Ausnahme');
  KREATUREN.typen.t2 = { name: 'kreatur.t2', groesse: 2, sicht: 5, verlustZeit: 1, replan: 0.5, hitRadius: 20, schild: { seg: 1, max: 1 }, wunden: 1, frontArc: 0, tuerenAufbrechen: false, rammZeit: 1, start: 'a',
    zustaende: { a: { modus: 'wippen', tempo: 0, dauer: 0.3, uebergang: [{ auf: 'ablauf', nach: 'b' }] }, b: { modus: 'steht', tempo: 0, uebergang: [{ auf: 'immerNach', nach: 'a' }] } },
    bausteine: { testbau: { x: 1 } } };
  try {
    ok(Kreatur.pruefen(KREATUREN).length === 0, 'Typ mit dem neuen Baustein (Modus, Auslöser, Parameter) besteht den Validator');
    KREATUREN.typen.t2.bausteine.testbau.x = 2;
    ok(Kreatur.pruefen(KREATUREN).some((f) => f.includes('x muss 1 sein')), 'Parameter-Prüfung des Bausteins greift');
    KREATUREN.typen.t2.bausteine.testbau.x = 1;
    combat.ensureV2(S.g, S.g.away);
    const K = Kreatur.erzeugen(S.g, 't2', S.pad.x + 200, S.pad.y - 100);
    S.lauf(1.0);
    ok(zaehl.tick > 20 && zaehl.par && zaehl.par.x === 1, 'beiTick läuft mit den Parametern aus den Daten (' + zaehl.tick + ' Ticks)');
    ok(zaehl.modus > 5 && zaehl.betreten >= 2, 'eigener Bewegungsmodus und Auslöser des Bausteins werden von der Tabelle benutzt (Modus ' + zaehl.modus + 'x, betreten ' + zaehl.betreten + 'x)');
    Kreatur.bausteinTreffer(S.g, K, { schaden: 1 });
    Kreatur.bausteinLaerm(S.g, K, { x: 0, y: 0 });
    ok(zaehl.treffer === 1 && zaehl.trPar.x === 1 && zaehl.laerm === 1, 'beiTreffer und beiLaerm werden an die eingeschalteten Bausteine verteilt');
  } finally {
    delete KREATUREN.typen.t2;
    abm();
  }
  ok(Kreatur.daten().typen.probe && !Kreatur.daten().typen.t2, 'nach dem Abmelden wieder der ursprüngliche Zustand');
});

section('Zufall und Station-Monster', () => {
  // Kreatur zieht Zufall nur aus aw.rng: game.rng bleibt gleich
  const A = szene(true), B = szene(true);
  const lang = strecken(A.m, 16)[0];
  A.g.away.drones.length = 0; B.g.away.drones.length = 0;
  const KA = kreaturIn(A, 'probe', lang.cx0 + 2, lang.cy);
  A.setz(A.pad.x, A.pad.y);
  A.lauf(20); B.lauf(20);
  const nextA = A.g.rng(), nextB = B.g.rng();
  ok(KA.z && nextA === nextB, 'game.rng nach 20 s mit und ohne Kreatur identisch (' + nextA.toFixed(6) + ' = ' + nextB.toFixed(6) + ')');
  const streifte = Math.hypot(KA.x - (lang.cx0 + 2) * TILE, KA.y - lang.cy * TILE) > 20;
  ok(streifte, 'die Kreatur hat in dieser Zeit tatsächlich gestreift (Zufall über aw.rng)');
  // ohne Kreaturen: update ändert nichts und verbraucht keinen Zufall
  const C = szene(true), D = szene(true);
  const orig = Kreatur.update; Kreatur.update = () => {};
  try { D.lauf(5); } finally { Kreatur.update = orig; }
  C.lauf(5);
  ok(C.g.away.kreaturen === undefined, 'ohne Kreaturen entsteht auch aw.kreaturen nicht');
  ok(JSON.stringify(C.g.away) === JSON.stringify(D.g.away) && C.g.rng() === D.g.rng() && C.g.away.rng() === D.g.away.rng(), 'ohne Kreaturen: Außenkarte, game.rng und aw.rng identisch zu einem Lauf ohne Kreatur-Update');
  // Station-Monster: dieselbe Bahn mit und ohne Kreatur (gleicher Seed, gleiche Schritte)
  const bahn = (mitKreatur) => {
    const T = station(); const g = T.g; const aw = g.away; const M = aw.monster;
    T.p.x = 3 * 32; T.p.y = 3 * 32; g.god = true;
    if (mitKreatur) {
      combat.ensureV2(g, aw);
      const k = g.karteOf(aw.map); const m = Monster.maskeVon(k);
      const a = Mon.naechster(m, 40, 30, 20); const pos = Mon.mitte(a);
      const K = Kreatur.erzeugen(g, 'probe', pos.x, pos.y);
      void K;
    }
    const spur = [];
    T.run(30, () => { spur.push(M.x.toFixed(2) + ',' + M.y.toFixed(2) + ',' + M.z); return false; });
    return { spur: spur.join(';'), rng: g.rng(), kre: aw.kreaturen ? aw.kreaturen[0] : null };
  };
  const o = bahn(false), mk = bahn(true);
  ok(o.spur.length > 100 && o.spur === mk.spur, 'Station-Monster: Bahn über 30 s mit und ohne Kreatur identisch');
  ok(o.rng === mk.rng, 'Station-Monster: game.rng danach gleich');
  ok(mk.kre && Math.hypot(mk.kre.x - 0, mk.kre.y - 0) > 0, 'die Kreatur lief in dieser Szene mit');
});

// ---------- Station-Monster gegen den festen Sollwert (main da8d19c, vor dem Umbau gehen -> gehenMit) ----------
section('Station-Monster gegen den Sollwert aus main da8d19c', () => {
  const R = Soll.messen(path.join(__dirname, '..'));
  ok(SOLL.seed === 21 && SOLL.patrouille.ticks === 900 && /^[0-9a-f]{64}$/.test(SOLL.patrouille.sha256), 'Fixture geladen (Seed ' + SOLL.seed + ', ' + SOLL.patrouille.ticks + ' Ticks, Hash ' + SOLL.patrouille.sha256.slice(0, 10) + ')');
  ok(R.patrouille.ticks === SOLL.patrouille.ticks && R.patrouille.sha256 === SOLL.patrouille.sha256, 'Bahn über 30 s (Patrouille) identisch zum Sollwert aus main' + (R.patrouille.sha256 === SOLL.patrouille.sha256 ? '' : ' (Abweichung, erste Probe: ' + R.patrouille.probe.find((s, i) => s !== SOLL.patrouille.probe[i]) + ' statt ' + SOLL.patrouille.probe.find((s, i) => s !== R.patrouille.probe[i]) + ')'));
  // Tür: Schott zu, das Station-Monster bricht es auf und braucht dafür die Rammzeit (Konfiguration, 1,2 s); Spur bis zum Ziel hinter dem Schott wie in main
  const s = R.schott, S0 = SOLL.schott;
  ok(!s.fehler && s.offenAbTick > 0 && s.zielAbTick > 0, 'Schott zu: das Station-Monster bricht es auf (offen ab Tick ' + s.offenAbTick + ') und kommt durch (Ziel ab Tick ' + s.zielAbTick + ')');
  ok(Math.abs(s.rammSekunden - Monster.STANDARD.rammZeit) <= 1.5 * DT, 'Aufbrechen dauert rammZeit ' + Monster.STANDARD.rammZeit + ' s (gemessen ' + s.rammSekunden + ' s zwischen Rammbeginn und offener Tür)');
  ok(s.rammAbTick === S0.rammAbTick && s.offenAbTick === S0.offenAbTick && s.zielAbTick === S0.zielAbTick && s.sha256 === S0.sha256, 'Schott-Spur identisch zum Sollwert (Rammbeginn ' + s.rammAbTick + '/' + S0.rammAbTick + ', offen ' + s.offenAbTick + '/' + S0.offenAbTick + ', Ziel ' + s.zielAbTick + '/' + S0.zielAbTick + ')');
  // Kollisionsbox 28×28: Endlage beim Anstoßen an die Wand
  const w = R.wand, W0 = SOLL.wand;
  ok(Monster.HB.w === 28 && Monster.HB.h === 28, 'Kollisionsbox des Station-Monsters 28×28');
  ok(Math.abs(w.endeX - W0.endeX) < 0.01 && Math.abs(w.endeY - W0.endeY) < 0.01 && w.sha256 === W0.sha256, 'Anstoßen an die Wand: Endlage (' + w.endeX + ', ' + w.endeY + ') wie in main (' + W0.endeX + ', ' + W0.endeY + '), Sperre bei x ' + w.sperreX);
  ok(R.maskeHash.sha256 === SOLL.maskeHash.sha256 && R.maskeHash.ankerpunkte === SOLL.maskeHash.ankerpunkte, 'Maske der Station (Größe 2) identisch zu main (' + R.maskeHash.ankerpunkte + ' Ankerpunkte)');
});

// ---------- Ohne Außenteam rührt sich keine Kreatur (der Cursor des Lärm-Lesers läuft allein mit) ----------
section('Kein Update ohne Außenteam', () => {
  const bau = () => { const S = szene(true); const lang = strecken(S.m, 16)[0]; S.g.away.drones.length = 0; const K = kreaturIn(S, 'probe', lang.cx0 + 2, lang.cy); S.setz(S.pad.x, S.pad.y); return { S, K, x0: K.x, y0: K.y }; };
  const A = bau(), B = bau(), C = bau();
  A.S.p.zone = 'ship';   // niemand mehr am Boden: Kreatur.update direkt aufrufen (kein Spielschritt, damit nur dieser Pfad geprüft wird)
  for (let i = 0; i < Math.round(5 / DT); i++) Kreatur.update(A.S.g, DT);
  A.S.p.zone = 'away';
  ok(A.K.x === A.x0 && A.K.y === A.y0 && A.K.pfad.length === 0 && A.K.z === 'patrouille', 'ohne Spieler am Boden: Kreatur bleibt stehen (kein Pfad, Zustand ' + A.K.z + ')');
  ok(A.S.g.away.rng() === B.S.g.away.rng(), 'ohne Spieler am Boden: kein Zufallsverbrauch aus aw.rng (Strom wie ohne Update)');
  // Kontrolle: mit Spieler am Boden zieht dasselbe Update Zufall und bewegt die Kreatur (sonst wäre die Prüfung oben leer)
  for (let i = 0; i < Math.round(5 / DT); i++) Kreatur.update(C.S.g, DT);
  ok(C.K.pfad.length > 0 || Math.hypot(C.K.x - C.x0, C.K.y - C.y0) > 5, 'Kontrolle: mit Spieler am Boden plant und bewegt sich dieselbe Kreatur');
  ok(C.S.g.away.rng() !== B.S.g.away.rng(), 'Kontrolle: mit Spieler am Boden wird aw.rng verbraucht');
});

section('Karte und Maske: Größenparameter', () => {
  // feste Referenz (von Hand gerechnet): 5×5, eine Wandkachel (2,2). Anker (cx,cy) deckt die Kacheln cx−1..cx, cy−1..cy (Größe 2)
  const kl = { w: 5, h: 5, rows: ['.....', '.....', '..#..', '.....', '.....'], legende: { '.': { kind: 'boden', solid: false }, '#': { kind: 'wand', solid: true } }, anker: [] };
  const rasterRef = (m) => { const z = []; for (let cy = 1; cy <= 4; cy++) { let r = ''; for (let cx = 1; cx <= 4; cx++) r += m.geht(cx, cy) ? '1' : '0'; z.push(r); } return z; };
  const m2k = Mon.maske(kl);
  ok(JSON.stringify(rasterRef(m2k)) === JSON.stringify(['1111', '1001', '1001', '1111']), 'Maske Größe 2 auf der 5×5-Referenzkarte: ' + rasterRef(m2k).join('/') + ' (soll 1111/1001/1001/1111, auch die letzte Zeile und Spalte)');
  let alle2 = 0; for (let cy = 0; cy <= 6; cy++) for (let cx = 0; cx <= 6; cx++) if (m2k.geht(cx, cy)) alle2++;
  ok(alle2 === 12 && !m2k.geht(0, 1) && !m2k.geht(5, 1) && !m2k.geht(1, 5) && !m2k.geht(2, 2), 'genau 12 Ankerpunkte, keiner außerhalb 1..4 und keiner an der Wand (' + alle2 + ')');
  // Größe 1 (Ankerpunkt 1..4, die Randspalte 5 ist nur mit Rand-Wänden gedacht): Anker (3,3) deckt die Wandkachel (2,2), alle anderen sind frei
  // Größe 1: Ankerpunkt = die Kachel selbst (0..w−1). Referenz 5×5 mit Wandkacheln (0,2) und (2,2): 23 Ankerpunkte; das rohe ok-Feld hat genau diese 23 Einsen (Randfehler: cx = w lief früher in die nächste Zeile)
  const k1 = { w: 5, h: 5, rows: ['.....', '.....', '#.#..', '.....', '.....'], legende: kl.legende, anker: [] };
  const m1k = Mon.maske(k1, 1); let alle1 = 0; for (let cy = 0; cy < 5; cy++) for (let cx = 0; cx < 5; cx++) if (m1k.geht(cx, cy)) alle1++;
  const einsen = Array.from(m1k.ok).reduce((s, v) => s + v, 0);
  ok(alle1 === 23 && !m1k.geht(0, 2) && !m1k.geht(2, 2) && m1k.geht(0, 0) && m1k.geht(4, 4) && !m1k.geht(5, 0) && !m1k.geht(5, 1) && !m1k.geht(1, 5) && !m1k.geht(-1, 0), 'Maske Größe 1 auf der Referenzkarte: 23 von 25 Ankerpunkten (Wände (0,2) und (2,2)), nichts außerhalb (' + alle1 + ')');
  ok(einsen === 23 && m1k.ok[2 * 5 + 0] === 0 && m1k.ok.length === 25, 'Maske Größe 1: ok-Feld ohne Überlauf in die nächste Zeile (' + einsen + ' Einsen, Wandkachel (0,2) bleibt 0)');
  ok(m1k.fuss === 1 && Mon.maske(kl).fuss === 2, 'Maske trägt ihren Fußabdruck');
  const S = szene(true);
  const m2 = Mon.maske(S.k), m2b = Monster.maskeVon(S.k), m1 = Mon.maske(S.k, 1), m3 = Monster.maskeVonGroesse(S.k, 3);
  let gleich = true; for (let cy = 0; cy <= m2.h; cy++) for (let cx = 0; cx <= m2.w; cx++) if (m2.geht(cx, cy) !== m2b.geht(cx, cy)) gleich = false;
  ok(gleich && Mon.FUSS === 2, 'Standardgröße 2 unverändert (Maske ohne Parameter = Größe 2)');
  let n1 = 0, n2 = 0, n3 = 0; for (let cy = 0; cy <= m2.h; cy++) for (let cx = 0; cx <= m2.w; cx++) { if (m1.geht(cx, cy)) n1++; if (m2.geht(cx, cy)) n2++; if (m3.geht(cx, cy)) n3++; }
  ok(n1 > n2 && n2 > n3 && n3 > 0, 'Größe 1 hat mehr, Größe 3 weniger Ankerpunkte als Größe 2 (' + n1 + ' > ' + n2 + ' > ' + n3 + ')');
  ok(Monster.maskeVonGroesse(S.k, 3) === m3 && Monster.maskeVonGroesse(S.k, 2) === m2b, 'Masken je Größe gecacht');
});

section('Kein Typname im server/', () => {
  const namen = [];
  for (const [id, t] of Object.entries(KREATUREN.typen)) { namen.push(id); namen.push(t.name); }
  const dateien = [];
  const geh = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) geh(p); else if (e.name.endsWith('.js')) dateien.push(p); } };
  geh(path.join(__dirname, '..', 'server'));
  ok(dateien.length > 50 && namen.length >= 2, 'server/ gelesen (' + dateien.length + ' Dateien), ' + namen.length + ' Namen aus den Daten');
  const treffer = [];
  for (const f of dateien) {
    const text = fs.readFileSync(f, 'utf8');
    for (const nm of namen) {
      const esc = nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('[\'"`]' + esc + '[\'"`]|\\.' + esc + '\\b');
      if (re.test(text)) treffer.push(path.relative(path.join(__dirname, '..'), f) + ' ~ ' + nm);
    }
  }
  const kernText = fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'kreatur.js'), 'utf8');
  const kern = kernText.split(/\r?\n/).filter((z) => !z.trim().startsWith('//')).join('\n');
  ok(!/\btyp\s*[!=]==?\s*['"]/.test(kern), "kein typ === '...' im Kern-Modul");
  ok(treffer.length === 0, 'kein Typname (Id oder Name-Schlüssel) im Servercode' + (treffer.length ? ': ' + treffer.slice(0, 5).join('; ') : ''));
});

console.log('\n' + (n - fails) + '/' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
process.exit(fails ? 1 : 0);
