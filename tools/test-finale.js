'use strict';
// SUND-04a-3 Finale-Kern (server/sim/finale.js, content/welt/finale-werte.json, Wirkung hauptwelt_erobert). Direkt gegen die Game-Klasse, ohne Netz (Netz: tools/test-finale-ws.js).
// Erwartungen aus dem Vertrag des Pakets, nicht aus dem Code:
//   Daten · bereit() je Grund · Angebot ab Tribun, Rangverlust zieht es zurück · zweistufige Bestätigung (Frist, erste Bestätigung gilt, Ablehnen kostet nichts) ·
//   Zustandsübergänge mit Stubs (sieg / niederlage / flucht / crew_gefallen, Neubeginn ohne Game Over) · Wirkung hauptwelt_erobert (nur im Finale gültig, genau ein Tick) ·
//   Befehl angreifen auf Hauptwelten bleibt gesperrt · Weltstand unverändert, nicht speicherbar · Snapshot (nur bei Änderung, Löschsignal).
//   node tools/test-finale.js [begriff …]   (npm run test:finale)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
process.chdir(path.join(__dirname, '..'));
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const Kern = require('../server/weltsim/kern.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Finale = require('../server/sim/finale.js');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, fn) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n' + name);
  try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
}
const gleich = (a, b) => { try { assert.deepStrictEqual(a, b); return true; } catch (e) { return false; } };

const DATEN = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'welt', 'finale-werte.json'), 'utf8'));
const W = DATEN.werte, T = DATEN.texte;
const RW = require('../content/welt/ruf-werte.json').werte;
const RAENGE = RW.raenge.wert;
const ab = (id) => RAENGE.find((r) => r.id === id).ab;
const TRIBUN = ab('tribun');
const ZIEL = W.ziel.wert;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-finale-'));
let seq = 0;
const HZ = CONFIG.tickHz;

function neu(opts) {
  const o = opts || {};
  const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: o.seed || 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const cs = [];
  for (let i = 0; i < (o.crew || 1); i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 800) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'A' + i, name: 'A' + i, color: i }); cs.push(c);
  }
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: o.start || 'freie_fahrt' });
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  run(g, 1);
  g.space.enemies = [];
  const funk = () => cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'radio').map((m) => m.text);
  return { g, cs, funk };
}
const run = (g, sek) => { for (let i = 0; i < Math.round(sek * HZ); i++) g.step(); };
const ws = (g) => g.weltsim;
const z = (g) => g.weltsim.zustand;
const tick = (g, k) => { for (let i = 0; i < (k || 1); i++) Kriegslage.tick(g, 'test'); };
const rang = (g, id) => { g.weltsim.ruf.rom = ab(id); };
const mitAngebot = (o) => { const t = neu(o); rang(t.g, 'tribun'); tick(t.g); return t; };

// Stubs der Nachbarpakete (Orbit-Szene, Boden, Abspann), mit Zähler
function stubs(opt) {
  const o = Object.assign({ szene: true, boden: true }, opt || {});
  const s = { szene: 0, boden: 0, abspann: [], szeneArgs: null };
  Finale.ersetzen('szene', { finaleStarten: (game, a) => { s.szene++; s.szeneArgs = a; return o.szene ? { id: 1 } : null; } });
  Finale.ersetzen('boden', { bodenStarten: () => { s.boden++; return o.boden; } });
  Finale.ersetzen('abspann', { beenden: (game, art) => { s.abspann.push(art); return true; } });
  return s;
}
const ohneStubs = () => { Finale.ersetzen('szene', null); Finale.ersetzen('boden', null); Finale.ersetzen('abspann', null); };
// Finale bis in den Orbit bringen (zweistufig)
function laufend(t) {
  const g = t.g;
  ok2(Finale.waehlen(g) === null && Finale.bestaetigen(g) === null, 'Finale gestartet');
}
// der erste Snapshot trägt die großen seltenen Teile (world.sektoren, …) und nie die Blöcke bei Änderung: bis zum ersten Snapshot ohne sie weitermachen
const nimm = (g) => { for (let i = 0; i < 40; i++) { const s = g.snapshot(); if (s.world && 'finale' in s.world) return s; } return { world: {} }; };
const keiner = (g) => { for (let i = 0; i < 40; i++) { const s = g.snapshot(); if (s.world && 'finale' in s.world) return false; } return true; };
const ok2 = (c, t) => { if (!c) ok(false, t); };

section('Daten', () => {
  ok(W.mindestrang.wert === 'tribun' && RAENGE.some((r) => r.id === W.mindestrang.wert), 'Mindestrang Tribun, ein Rang der Daten');
  ok(ZIEL.hex === '1004' && ZIEL.an === 'rom', 'Ziel: Hrafnheim (Hex 1004), erobert von Rom');
  ok(W.bestaetigung.wert.fenster > 0 && W.abstand_nach_ablehnen.wert >= 0 && W.abstand_nach_scheitern.wert >= 0, 'Frist und Pausen als Zahlen in den Daten');
  const funkKeys = ['angebot', 'anfrage', 'angefragt_verfallen', 'start', 'orbit_sieg', 'orbit_niederlage', 'orbit_flucht', 'boden_nicht', 'crew_gefallen', 'sieg'];
  ok(funkKeys.every((k) => typeof T.funk[k] === 'string' && T.funk[k]), 'Funktexte aller Phasen');
  ok(/\{sek\}/.test(T.funk.anfrage) && /gefährlich/i.test(T.funk.anfrage), 'die Anfrage kündigt die Gefahr an und nennt die Frist');
  ok(/hart|Gefahr|gefährlich/i.test(T.funk.angebot + T.anzeige.text), 'die Gefahr wird vorab angekündigt');
  ok(!/müsst jetzt|Strafe|Abzug|Pflicht/i.test(JSON.stringify(T)), 'kein Text droht oder verpflichtet (kein Zwang)');
  ok(!/\b(Ada|Bo|Cem)\b/.test(JSON.stringify(T)), 'keine Spielernamen in den Texten');
  ok(['modus', 'rang', 'laeuft', 'beendet', 'szene', 'kein_angebot', 'schon_angefragt', 'keine_anfrage', 'start'].every((k) => T.weigerung[k]), 'Weigerungstexte da');
  ok(!Object.keys(RW.quellen.wert).some((k) => /finale/i.test(k)), 'ruf-werte.json hat keine Ruf-Quelle fürs Finale (Ablehnen und Ignorieren kosten nichts)');
});

section('bereit() je Grund', () => {
  ohneStubs();
  const t = neu(); const g = t.g;
  for (const id of ['miles', 'optio', 'centurio']) {
    rang(g, id);
    ok(gleich(Finale.bereit(g), { ok: false, grund: 'rang' }), `Rang ${id}: nicht bereit, Grund rang`);
  }
  ok(Finale.bereit(g).grund === 'rang' && Finale.bereit(g).ok === false, 'Rang knapp unter Tribun: nein');
  g.weltsim.ruf.rom = TRIBUN - 0.01; ok(Finale.bereit(g).grund === 'rang', 'Ruf unter der Tribun-Schwelle: rang');
  rang(g, 'tribun');
  ok(gleich(Finale.bereit(g), { ok: true, grund: null }), 'Rang Tribun: bereit');
  rang(g, 'legat'); ok(Finale.bereit(g).ok === true || RAENGE.every((r) => r.id !== 'legat'), 'höherer Rang: bereit');
  const hoechster = RAENGE[RAENGE.length - 1].id; rang(g, hoechster); ok(Finale.bereit(g).ok, 'höchster Rang: bereit');
  rang(g, 'tribun');
  // Szene
  g.simSzene = { id: 1, phase: 'anflug' };
  ok(gleich(Finale.bereit(g), { ok: false, grund: 'szene' }), 'in einer Sim-Szene: Grund szene');
  g.simSzene = { id: 1, phase: 'ende' }; ok(Finale.bereit(g).ok, 'eine beendete Sim-Szene sperrt nicht');
  g.simSzene = null;
  g.fadenSzene = { id: 1, phase: 'kampf' };
  ok(gleich(Finale.bereit(g), { ok: false, grund: 'szene' }), 'in einer Faden-Szene: Grund szene');
  g.fadenSzene = null;
  ok(Finale.bereit(g).ok, 'Szene zu Ende: wieder bereit');
  // starten prüft bereit() selbst: ohne Rang oder in einer Szene wird nichts gebaut
  const s0 = stubs();
  rang(g, 'centurio'); ok(Finale.starten(g) === false && Finale.phase(g) === null && s0.szene === 0, 'starten ohne Rang: false, keine Szene gebaut');
  rang(g, 'tribun'); g.simSzene = { id: 1, phase: 'anflug' };
  ok(Finale.starten(g) === false && Finale.phase(g) === null && s0.szene === 0, 'starten in einer Szene: false, keine Szene gebaut');
  g.simSzene = null;
  // laeuft / beendet
  const s = stubs();
  ok(Finale.starten(g) === true && Finale.phase(g) === 'orbit', 'starten: phase orbit');
  ok(gleich(Finale.bereit(g), { ok: false, grund: 'laeuft' }), 'Finale läuft: Grund laeuft');
  Finale.orbitEnde(g, 'sieg');
  ok(gleich(Finale.bereit(g), { ok: false, grund: 'laeuft' }), 'auch am Boden: laeuft');
  Finale.bodenEnde(g, 'sieg');
  ok(Finale.phase(g) === 'ende' && gleich(Finale.bereit(g), { ok: false, grund: 'beendet' }), 'beendet: Grund beendet');
  // Modus
  const k = neu({ start: 'eisenwald_ohne' });
  ok(!k.g.weltsim && gleich(Finale.bereit(k.g), { ok: false, grund: 'modus' }), 'Kampagne (kein Modus): Grund modus');
  ok(Finale.phase(k.g) === null && Finale.schluessel(k.g) === null && Finale.snapshot(k.g) === null, 'Kampagne: phase null, kein Block');
  ok(Finale.starten(k.g) === false && (Finale.waehlen(k.g) || {}).code === 'modus', 'Kampagne: starten false, waehlen „modus“');
  ohneStubs();
});

section('Angebot ab Tribun', () => {
  ohneStubs();
  const t = neu(); const g = t.g;
  rang(g, 'centurio'); tick(g, 3);
  ok(!ws(g).finale || !ws(g).finale.angebot, 'vor Tribun: kein Angebot');
  ok(!t.funk().some((x) => x === T.funk.angebot), 'vor Tribun: kein Angebots-Funk');
  rang(g, 'tribun'); tick(g);
  ok(ws(g).finale.angebot === 1 && t.funk().filter((x) => x === T.funk.angebot).length === 1, 'ab Tribun: ein Angebot, ein Funk');
  tick(g, 3);
  ok(t.funk().filter((x) => x === T.funk.angebot).length === 1, 'weitere Ticks: das Angebot bleibt, kein zweiter Funk');
  rang(g, 'centurio'); tick(g);
  ok(ws(g).finale.angebot === 0, 'fällt der Rang, zieht Rom das Angebot zurück');
  rang(g, 'tribun'); tick(g);
  ok(ws(g).finale.angebot === 1, 'steigt er wieder: neues Angebot');
  ok(Finale.anbieten(g) === false, 'anbieten bei vorhandenem Angebot: false');
  // Szene: kein Angebot mitten im Gefecht
  const u = neu(); rang(u.g, 'tribun'); u.g.simSzene = { id: 1, phase: 'anflug' }; Finale.nachTick(u.g);
  ok(!ws(u.g).finale.angebot, 'in einer Szene entsteht kein Angebot');
});

section('zweistufige Bestätigung', () => {
  const s = stubs();
  const t = mitAngebot({ crew: 2 }); const g = t.g;
  // ohne Anfrage kein Start
  let e = Finale.bestaetigen(g);
  ok(e && e.code === 'keine_anfrage' && Finale.phase(g) === null && s.szene === 0, 'Bestätigen ohne Anfrage: abgelehnt, nichts gestartet');
  // Anfrage
  e = Finale.waehlen(g);
  ok(e === null && ws(g).finale.anfrage && Finale.phase(g) === null && s.szene === 0, 'Anfrage (Stufe 1): gestellt, noch nichts gestartet');
  ok(t.funk().some((x) => /Bestätigt innerhalb von \d+ Sekunden/.test(x) && /gefährlich/i.test(x)), 'Funk kündigt Gefahr und Frist an');
  ok(Finale.snapshot(g).anfrage === W.bestaetigung.wert.fenster, 'Snapshot nennt die Frist');
  // zweite Anfrage während der Frist: „schon angefragt“
  e = Finale.waehlen(g); ok(e && e.code === 'schon_angefragt', 'zweite Anfrage in der Frist: schon angefragt');
  // Frist läuft ab
  const f = W.bestaetigung.wert.fenster;
  g.time += f + 1;
  e = Finale.bestaetigen(g);
  ok(e && e.code === 'keine_anfrage' && Finale.phase(g) === null && s.szene === 0, 'Bestätigung nach der Frist: abgelehnt');
  g.time -= f + 1;
  // neue Anfrage, Bestätigung kurz vor Fristende gilt
  ws(g).finale.anfrage = null;
  Finale.waehlen(g);
  g.time += f - 1;
  ok(Finale.bestaetigen(g) === null && Finale.phase(g) === 'orbit' && s.szene === 1, 'Bestätigung innerhalb der Frist: Finale beginnt (phase orbit, Szene einmal gebaut)');
  ok(s.szeneArgs && s.szeneArgs.hex === ZIEL.hex, 'die Szene wird für Hrafnheim (1004) gebaut');
  ok(ws(g).finale.angebot === 0 && ws(g).finale.anfrage === null, 'Angebot und Anfrage sind verbraucht');
  // die erste Bestätigung gilt, die zweite wird abgewiesen
  e = Finale.bestaetigen(g); ok(e && e.code === 'laeuft' && s.szene === 1, 'eine zweite Bestätigung: „läuft schon“, Szene nicht noch einmal gebaut');
  e = Finale.waehlen(g); ok(e && e.code === 'laeuft', 'eine neue Anfrage während des Finales: abgewiesen');
  ok(t.funk().some((x) => x === T.funk.start), 'Funk zum Start');
  ohneStubs();
});

section('Gleitkomma: Bestätigung im selben game.time wie die Anfrage', () => {
  const f = W.bestaetigung.wert.fenster;
  // ein game.time, bei dem (time + f) - time knapp über f liegt (Kehrwert-Zeiten wie 1/30-Ticks erzeugen das ständig)
  let zeit = null;
  for (let k = 1; k < 100000 && zeit === null; k++) { const x = k / 30 + 0.1; if ((x + f) - x > f) zeit = x; }
  ok(zeit !== null, 'Testzeit mit (time + fenster) - time > fenster gefunden');
  const s = stubs();
  const t = mitAngebot({}); const g = t.g;
  g.time = zeit;
  ok(Finale.waehlen(g) === null, 'Anfrage gestellt');
  ok(Finale.snapshot(g).anfrage === f, 'Snapshot nennt die Frist (nicht f + Rundungsrest)');
  const e = Finale.waehlen(g);
  ok(e && e.code === 'schon_angefragt' && /noch 20 /.test(e.text), 'zweite Anfrage im selben game.time: schon angefragt, Rest 20 s (nicht 21)' + (e ? ' ' + e.text : ''));
  ok(Finale.bestaetigen(g) === null && Finale.phase(g) === 'orbit' && s.szene === 1, 'Bestätigung im selben game.time: Finale beginnt');
  // Randfälle: genau am Fristende und knapp danach
  const t2 = mitAngebot({}); const g2 = t2.g; g2.time = zeit; Finale.waehlen(g2);
  g2.time = zeit + f;
  ok(Finale.bestaetigen(g2) && Finale.phase(g2) === null, 'genau am Fristende ist die Anfrage verfallen (bis > time gilt nicht mehr)');
  const t3 = mitAngebot({}); const g3 = t3.g; g3.time = zeit; Finale.waehlen(g3);
  g3.time = zeit + f - 0.001;
  ok(Finale.bestaetigen(g3) === null && Finale.phase(g3) === 'orbit', 'eine Millisekunde vor dem Fristende gilt sie noch');
  ohneStubs();
});

section('Ablehnen kostet nichts', () => {
  stubs();
  const t = mitAngebot(); const g = t.g;
  const rufVor = JSON.stringify(ws(g).ruf), zVor = JSON.stringify(z(g));
  ok(Finale.ablehnen(g) === null && ws(g).finale.angebot === 0, 'Ablehnen: Angebot geschlossen');
  ok(JSON.stringify(ws(g).ruf) === rufVor && JSON.stringify(z(g)) === zVor, 'Ablehnen ändert weder Ruf noch Sim-Zustand');
  ok(Finale.ablehnen(g).code === 'kein_angebot', 'zweites Ablehnen: kein Angebot, keine Folge');
  ok((Finale.waehlen(g) || {}).code === 'kein_angebot' && !ws(g).finale.anfrage, 'ohne Angebot keine Anfrage');
  tick(g, W.abstand_nach_ablehnen.wert - 1);
  ok(ws(g).finale.angebot === 0, 'in der Pause kommt kein Angebot');
  tick(g, 1 + 1);
  ok(ws(g).finale.angebot === 1, 'nach der Pause wieder ein Angebot');
  // Ablehnen mit offener Anfrage schließt beide
  Finale.waehlen(g); ok(Finale.ablehnen(g) === null && ws(g).finale.anfrage === null && ws(g).finale.angebot === 0, 'Ablehnen mit offener Anfrage: beides weg');
  // Ignorieren: Anfrage verfällt, Angebot bleibt, Ruf unverändert
  const u = mitAngebot(); Finale.waehlen(u.g); u.g.time += W.bestaetigung.wert.fenster + 1;
  const r2 = JSON.stringify(ws(u.g).ruf);
  tick(u.g);
  ok(ws(u.g).finale.anfrage === null && ws(u.g).finale.angebot === 1 && JSON.stringify(ws(u.g).ruf) === r2, 'Ignorieren: die Anfrage verfällt ohne Folgen, das Angebot steht weiter');
  ok(u.funk().some((x) => x === T.funk.angefragt_verfallen), 'Funk: Anfrage verfallen');
  // Ablehnen während des Finales geht nicht
  stubs(); const l = mitAngebot(); Finale.waehlen(l.g); Finale.bestaetigen(l.g);
  ok(Finale.ablehnen(l.g).code === 'laeuft', 'Ablehnen mitten im Finale: nicht möglich');
  ohneStubs();
});

section('Zustandsübergänge (Stubs)', () => {
  // Orbit sieg -> boden
  let s = stubs();
  let t = mitAngebot(); let g = t.g;
  const tickVor = ws(g).tickZahl;
  Finale.waehlen(g); Finale.bestaetigen(g);
  ok(Finale.phase(g) === 'orbit', 'Start: orbit');
  ok(Finale.orbitEnde(g, 'sieg') === true && Finale.phase(g) === 'boden' && s.boden === 1, 'Orbit sieg: phase boden, Landung vorbereitet (Stub bodenStarten)');
  ok(ws(g).tickZahl === tickVor, 'Orbit-Ende löst keinen Sim-Tick aus');
  ok(Finale.orbitEnde(g, 'sieg') === false, 'Orbit-Ende im Boden: ohne Wirkung');
  ok(Finale.bodenEnde(g, 'quatsch') === false && Finale.phase(g) === 'boden', 'unbekannter Boden-Ausgang: ohne Wirkung');
  // Boden sieg -> ende + Abspann
  const tickBoden = ws(g).tickZahl;
  ok(z(g).hexe[ZIEL.hex].besitzer === 'ger', 'vor dem Sieg gehört Hrafnheim den Germanen');
  ok(Finale.bodenEnde(g, 'sieg') === true && Finale.phase(g) === 'ende', 'Boden sieg: phase ende');
  ok(gleich(s.abspann, ['sieg']), 'Abspann: beenden(game, "sieg") genau einmal');
  ok(g.weltstand.data.fakten.finale_gespielt === true, 'Fakt finale_gespielt gesetzt');
  ok(g.phase === 'end' && g.abspann && g.abspann.bloecke.some((b) => b.kopf === 'DER SCHREIN') && !g.abspann.bloecke.some((b) => b.kopf === 'OHNE EUCH'), 'Fakt steht VOR dem Abspann: der Fall der Hauptwelt in der Siegwirkung ruft ihn schon, er zeigt den Block Schrein statt kampflos');
  ok(ws(g).tickZahl === tickBoden + 1, 'Siegwirkungen: GENAU EIN Sim-Tick');
  ok(z(g).hexe[ZIEL.hex].besitzer === 'rom', 'Hafen 1004 gehört Rom');
  ok(t.funk().includes(T.funk.sieg) && !g.errors, 'Funk zum Sieg, kein Serverfehler');
  const evs = ws(g).ereignisse.filter((e) => e.n === ws(g).tickZahl);
  ok(evs.some((e) => e.typ === 'hafen_gefallen' && e.ort === ZIEL.hex && e.neu === 'rom') && evs.some((e) => e.typ === 'hauptwelt_gefallen' && e.ort === ZIEL.hex && e.alt === 'ger' && e.neu === 'rom'), 'Ereignisse hafen_gefallen und hauptwelt_gefallen (alt ger)');
  ok(Finale.bodenEnde(g, 'sieg') === false && s.abspann.length === 1, 'ein zweites Boden-Ende: nichts doppelt');
  ohneStubs();

  // Niederlage und Flucht im Orbit: Neubeginn, kein Game Over
  for (const aus of ['niederlage', 'flucht']) {
    s = stubs(); t = mitAngebot(); g = t.g;
    const tk = ws(g).tickZahl;
    Finale.waehlen(g); Finale.bestaetigen(g);
    ok(Finale.orbitEnde(g, aus) === true && Finale.phase(g) === null, `Orbit ${aus}: Finale beginnt von vorn (phase null)`);
    ok(g.phase === 'play' && g.players.every((p) => !p.downed) && !g.errors, `Orbit ${aus}: kein Game Over, die Crew lebt`);
    ok(ws(g).tickZahl === tk && s.abspann.length === 0 && s.boden === 0, `Orbit ${aus}: kein Tick, kein Abspann, kein Boden`);
    ok(t.funk().includes(T.funk['orbit_' + aus]), `Orbit ${aus}: Funk`);
    ok(ws(g).finale.angebot === 1 && Finale.bereit(g).ok, `Orbit ${aus}: das Angebot ist wieder möglich`);
    // und es lässt sich noch einmal spielen
    ok(Finale.waehlen(g) === null && Finale.bestaetigen(g) === null && Finale.phase(g) === 'orbit' && s.szene === 2, `Orbit ${aus}: zweiter Versuch startet erneut`);
    ok(z(g).hexe[ZIEL.hex].besitzer === 'ger', `Orbit ${aus}: Hrafnheim bleibt germanisch`);
  }
  ok(Finale.orbitEnde(g, 'sieg') === true && Finale.phase(g) === 'boden', 'zweiter Versuch: Orbit-Sieg');
  // Boden: Crew gefallen -> Neubeginn
  s = stubs(); t = mitAngebot(); g = t.g;
  Finale.waehlen(g); Finale.bestaetigen(g); Finale.orbitEnde(g, 'sieg');
  const tk2 = ws(g).tickZahl;
  ok(Finale.bodenEnde(g, 'crew_gefallen') === true && Finale.phase(g) === null, 'Boden crew_gefallen: Neubeginn (phase null)');
  ok(g.phase === 'play' && !g.errors && ws(g).tickZahl === tk2 && s.abspann.length === 0, 'crew_gefallen: kein Game Over, kein Tick, kein Abspann');
  ok(z(g).hexe[ZIEL.hex].besitzer === 'ger' && ws(g).finale.angebot === 1, 'Hrafnheim bleibt germanisch, Angebot wieder da');
  ok(t.funk().includes(T.funk.crew_gefallen), 'Funk: Crew gefallen');
  // Boden lässt sich nicht aufbauen -> Neubeginn
  s = stubs({ boden: false }); t = mitAngebot(); g = t.g;
  Finale.waehlen(g); Finale.bestaetigen(g);
  ok(Finale.orbitEnde(g, 'sieg') === true && Finale.phase(g) === null && t.funk().includes(T.funk.boden_nicht), 'Boden nicht aufbaubar: Neubeginn mit Funk');
  // Orbit lässt sich nicht aufbauen -> Finale startet nicht
  s = stubs({ szene: false }); t = mitAngebot(); g = t.g;
  Finale.waehlen(g); const e = Finale.bestaetigen(g);
  ok(e && e.code === 'start' && Finale.phase(g) === null && ws(g).finale.angebot === 1, 'Szene lässt sich nicht bauen: kein Start, das Angebot bleibt');
  // ohne Ersatz: die echte Orbit-Szene von kriegslage-szene.js (SUND-04a-3 Orbit) baut den Orbit; Tests dazu: tools/test-finale-orbit.js
  ohneStubs(); t = mitAngebot(); g = t.g; Finale.waehlen(g);
  ok(Finale.bestaetigen(g) === null && Finale.phase(g) === 'orbit' && g.simSzene && g.simSzene.modus === 'finale', 'echte Orbit-Szene (finaleStarten): das Finale startet im Orbit');
  // Abspann-Stub fehlt: das Finale endet trotzdem
  Finale.ersetzen('szene', { finaleStarten: () => ({}) });
  t = mitAngebot(); g = t.g; Finale.waehlen(g); Finale.bestaetigen(g); Finale.orbitEnde(g, 'sieg');
  Finale.bodenEnde(g, 'sieg');
  ok(Finale.phase(g) === 'ende' && !g.errors, 'ohne Abspann-Paket endet das Finale trotzdem sauber');
  ohneStubs();
});

section('Wirkung hauptwelt_erobert', () => {
  const t = neu(); const g = t.g;
  const wk = { typ: 'hauptwelt_erobert', ort: ZIEL.hex, an: 'rom' };
  const zz = z(g);
  ok(Object.prototype.hasOwnProperty.call(Kern.WIRKUNGEN, 'hauptwelt_erobert'), 'im Katalog');
  ok(Kern.pruefeWirkung(zz, wk).ok === false && /Finale/.test(Kern.pruefeWirkung(zz, wk).grund), 'ohne Kontext (ohne Finale): abgelehnt');
  for (const f of [null, undefined, 'ende', 'quatsch']) ok(Kern.filtereWirkungen(zz, [wk], { finale: f }).gueltig.length === 0, `Finale-Phase ${f}: abgelehnt`);
  ok(Kern.filtereWirkungen(zz, [wk], {}).gueltig.length === 0 && Kern.filtereWirkungen(zz, [wk]).gueltig.length === 0, 'ohne Kontext und mit leerem Kontext: abgelehnt');
  for (const f of ['orbit', 'boden']) ok(Kern.filtereWirkungen(zz, [wk], { finale: f }).gueltig.length === 1, `Finale-Phase ${f}: gültig`);
  const bad = (w, was) => { const r = Kern.filtereWirkungen(zz, [w], { finale: 'boden' }); ok(r.gueltig.length === 0 && r.verworfen.length === 1, was + ': ' + (r.verworfen[0] && r.verworfen[0].grund)); };
  bad({ typ: 'hauptwelt_erobert', ort: ZIEL.hex, an: 'ger' }, 'Germanen erobern ihre eigene Hauptwelt');
  bad({ typ: 'hauptwelt_erobert', ort: ZIEL.hex, an: 'kon' }, 'Konkordat ist nicht feindlich zu Germanen');
  bad({ typ: 'hauptwelt_erobert', ort: ZIEL.hex, an: 'pirat' }, 'unbekannte Fraktion pirat');
  ok(Kern.filtereWirkungen(zz, [{ typ: 'hauptwelt_erobert', ort: '0204', an: 'ger' }], { finale: 'boden' }).gueltig.length === 1, 'allgemein: die Hauptwelt jedes Feindes von `an` (Palatina durch ger) ist im Finale gültig, ohne Finale nie');
  bad({ typ: 'hauptwelt_erobert', ort: 'zzzz', an: 'rom' }, 'unbekannter Ort');
  bad({ typ: 'hauptwelt_erobert', ort: '0403', an: 'rom' }, 'Ort ohne Hauptwelt (anderer Hafen/Posten)');
  const dd = require('../server/weltsim/daten.js').datenVon(zz);
  const gerHafen = Object.keys(zz.hexe).filter((c) => zz.hexe[c].besitzer === 'ger' && dd.hex[c].hafen !== '' && c !== ZIEL.hex);
  ok(gerHafen.length > 0, 'die Karte hat einen weiteren germanischen Hafen (' + gerHafen.join(',') + ')');
  for (const c of gerHafen) bad({ typ: 'hauptwelt_erobert', ort: c, an: 'rom' }, 'feindlicher Hafen ' + c + ', der keine Hauptwelt ist');
  bad({ typ: 'hauptwelt_erobert', an: 'rom' }, 'ohne Ort');
  // Zustand bleibt beim Prüfen unberührt
  ok(zz.hexe[ZIEL.hex].besitzer === 'ger', 'Prüfen verändert den Sim-Zustand nicht');
  // im Tick OHNE Finale verworfen (über den Spielaufsatz)
  const eV = ws(g).wirkungenVerworfen;
  Kriegslage.tickMit(g, 'test', undefined, [wk]);
  ok(z(g).hexe[ZIEL.hex].besitzer === 'ger' && ws(g).wirkungenVerworfen === eV + 1 && /Finale/.test(ws(g).letzteWirkungen.verworfen[0].grund), 'im Tick ohne Finale: verworfen, Hrafnheim bleibt germanisch');
  Kriegslage.wirkungenVormerken(g, [wk]); tick(g);
  ok(z(g).hexe[ZIEL.hex].besitzer === 'ger', 'auch vorgemerkt (Flucht per Sprung): ohne Finale ohne Auswirkung');
  // im Tick MIT Finale
  const s = stubs(); rang(g, 'tribun'); tick(g);
  Finale.waehlen(g); Finale.bestaetigen(g);
  const tk = ws(g).tickZahl;
  const r = Kriegslage.tickMit(g, 'test', undefined, [wk]);
  ok(r && z(g).hexe[ZIEL.hex].besitzer === 'rom' && ws(g).tickZahl === tk + 1, 'im Tick mit laufendem Finale: Hrafnheim gehört Rom, ein Tick');
  ok(r.some((e) => e.typ === 'hafen_gefallen') && r.some((e) => e.typ === 'hauptwelt_gefallen' && e.alt === 'ger'), 'Ereignisse hafen_gefallen + hauptwelt_gefallen');
  void s; ohneStubs();
  // Hauptwelt-Befehle bleiben gesperrt
  const z2 = Kern.erzeuge({ karte: require('../server/weltsim/daten.js').laden().karte, werte: require('../server/weltsim/daten.js').laden().werte, seed: 3 });
  const p1 = Kern.pruefeBefehl(z2, { typ: 'angreifen', fraktion: 'rom', ziel: ZIEL.hex });
  const p2 = Kern.pruefeBefehl(z2, { typ: 'angreifen', fraktion: 'ger', ziel: '0204' });
  ok(p1.ok === false && /Hauptwelten/.test(p1.grund) && p2.ok === false && /Hauptwelten/.test(p2.grund), 'angreifen auf Hauptwelten bleibt gesperrt (Hrafnheim und Palatina)');
});

section('Weltstand: nicht speicherbar, ohne Finale unverändert', () => {
  const s = stubs();
  const a = neu({ seed: 11 }), b = neu({ seed: 11 });
  tick(a.g, 5); tick(b.g, 5);
  const sa = Kriegslage.toSave(a.g);
  ok(!('finale' in sa) && !JSON.stringify(sa).includes('finale'), 'Weltstand ohne Finale: kein finale-Feld');
  // mit Angebot und laufendem Finale: Weltstand bis auf Tick/Ruf/Absicht gleich, kein finale-Feld
  rang(b.g, 'tribun'); tick(b.g);
  Finale.waehlen(b.g); Finale.bestaetigen(b.g);
  ok(Finale.phase(b.g) === 'orbit', 'Finale läuft');
  const sb = Kriegslage.toSave(b.g);
  ok(!JSON.stringify(sb).includes('finale') && !('finale' in sb), 'laufendes Finale: Weltstand trägt nichts davon');
  // Laden: phase null, Angebot kann neu entstehen
  const c = neu({ seed: 11 });
  Kriegslage.restore(c.g, JSON.parse(JSON.stringify(sb)));
  ok(Finale.phase(c.g) === null && !(c.g.weltsim.finale && c.g.weltsim.finale.phase), 'nach dem Laden: phase null (Abbruch = Neubeginn)');
  ok(Finale.bereit(c.g).ok === true, 'nach dem Laden: bereit, wenn der Rang stimmt');
  tick(c.g);
  ok(c.g.weltsim.finale.angebot === 1, 'das Angebot entsteht nach dem Laden neu');
  // Ruf aus dem Altstand stimmt
  ok(JSON.stringify(Kriegslage.toSave(c.g)).includes('finale') === false, 'wieder gespeichert: kein finale-Feld');
  // sieg: Weltstand trägt Hrafnheim als römisch (Sim-Zustand), sonst nichts Neues
  Finale.orbitEnde(b.g, 'sieg'); Finale.bodenEnde(b.g, 'sieg');
  const sc = Kriegslage.toSave(b.g);
  ok(sc.zustand.hexe[ZIEL.hex].besitzer === 'rom' && !JSON.stringify(sc).includes('finale'), 'nach dem Sieg: Hrafnheim römisch im Weltstand, kein finale-Feld');
  void s; ohneStubs();
});

section('Snapshot', () => {
  stubs();
  const t = neu(); const g = t.g;
  ok(Finale.schluessel(g) === null && Finale.snapshot(g) !== undefined, 'vor Tribun: kein Block (Schlüssel null)');
  ok(keiner(g), 'vor Tribun: world.finale fehlt im Snapshot');
  rang(g, 'tribun'); tick(g);
  const s1 = nimm(g);
  ok(s1.world && s1.world.finale && s1.world.finale.frei === 1 && s1.world.finale.angebot === 1 && s1.world.finale.ab === 'Tribun' && s1.world.finale.name === T.anzeige.name, 'Tribun mit Angebot: world.finale { frei 1, angebot 1, ab Tribun, name }');
  g.sentFinaleKey = null; g.sentExploreVersion = -1;
  { const sn = g.snapshot(); ok(sn.world && sn.world.locations && !('finale' in sn.world), 'ein Snapshot mit den großen seltenen Teilen trägt den Block nicht (er kommt im nächsten)'); }
  { const nx = nimm(g); ok(nx.world.finale && gleich(nx.world.finale, Finale.snapshot(g)), 'der Block kommt danach, unverändert'); }
  ok(keiner(g), 'unverändert: der Block wird nicht noch einmal gesendet');
  Finale.waehlen(g); const s3 = nimm(g);
  ok(s3.world && s3.world.finale && s3.world.finale.anfrage === W.bestaetigung.wert.fenster, 'Anfrage: neuer Block mit der Frist');
  Finale.bestaetigen(g); const s4 = nimm(g);
  ok(s4.world && s4.world.finale && s4.world.finale.phase === 'orbit' && s4.world.finale.angebot === undefined && s4.world.finale.anfrage === undefined, 'Finale läuft: Block mit phase orbit');
  ok(Buffer.byteLength(JSON.stringify(Finale.snapshot(g))) < 400, 'der Block ist klein (' + Buffer.byteLength(JSON.stringify(Finale.snapshot(g))) + ' B)');
  // Löschsignal: der Modus endet
  const merk = g.weltsim; g.weltsim = null;
  const s5 = nimm(g);
  ok(s5.world && s5.world.finale === null, 'Modus endet: world.finale = null (Löschsignal)');
  ok(keiner(g), 'und danach nicht noch einmal');
  g.weltsim = merk;
  ok(!g.errors, 'kein Serverfehler');
  ohneStubs();
});

section('Protokoll', () => {
  const Protocol = require('../shared/protocol.js');
  ok(gleich(Protocol.CMD_FINALE, ['finale.waehlen', 'finale.bestaetigen', 'finale.ablehnen']), 'CMD_FINALE: genau waehlen, bestaetigen, ablehnen');
  ok(Protocol.DEBUG_CMDS.includes('finale'), 'Debug-Befehl finale ist im Protokoll');
});

section('Befehle über handleMessage', () => {
  stubs();
  const t = mitAngebot({ crew: 3 }); const g = t.g;
  const antw = (c) => c.inbox.filter((m) => m.t === 'event' && m.kind === 'finaleAntwort');
  for (const [i, p] of g.players.entries()) { p.console = 'shop'; void i; }
  const send = (i, c) => g.handleMessage(t.cs[i], { t: 'cmd', c });
  send(1, 'finale.bestaetigen');
  ok(Finale.phase(g) === null && antw(t.cs[1])[0] && antw(t.cs[1])[0].ok === false && antw(t.cs[1])[0].code === 'keine_anfrage', 'Bestätigen ohne Anfrage: Antwort mit Grund, nichts gestartet');
  send(2, 'finale.waehlen'); send(0, 'finale.bestaetigen'); send(1, 'finale.bestaetigen');
  ok(Finale.phase(g) === 'orbit' && antw(t.cs[0])[0].ok === true && antw(t.cs[1]).slice(-1)[0].ok === false && antw(t.cs[1]).slice(-1)[0].code === 'laeuft', 'Spieler A bestätigt die Anfrage von C: es gilt die erste Bestätigung, B bekommt „läuft schon“');
  // Konsole nötig
  const u = mitAngebot({ crew: 1 }); u.g.players[0].console = 'helm';
  u.g.handleMessage(u.cs[0], { t: 'cmd', c: 'finale.waehlen' });
  ok(!u.g.weltsim.finale.anfrage, 'ohne Konsole shop: nichts');
  ohneStubs();
});

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(`\n${n} Prüfungen, ${fails ? fails + ' FEHLER' : 'FINALE OK'}`);
void laufend;
process.exit(fails ? 1 : 0);
