'use strict';
// EIS-01 P2: Regiebuch-Bausteine des Bunkers (server/mission/bausteine/bunker.js): Aktion bunker_aufbauen, Prüfungen bunker_welle_tot, bunker_offen, bunker_gesprengt, bunker_sieg_bereit.
// Echtes Game, echte Regiebuch-Ausführung (Buch per registerBook, Mission gestartet, mission.update je Tick), KEIN game.arena (die Kampagne kennt keines). Die feste Karte grabenangriff
// hängt an einem Debug-Landepunkt (landepunkte.neu mit gen.fest); der Zustand liegt in aw.graben.
//   1 Katalog, Prüfer   2 Aufbau Germanen (raubzug), Sperre aus, Ladung unberührt (0 und 2)   3 Sperre an, Texte aus dem Regiebuch   4 Takt genau einmal je Tick
//   5 Knall, Nachschub, Sieg erst wenn alle oben   6 map_reset und erneuter Aufbau: frischer Zustand   7 Zustand nicht im Snapshot
//   node tools/test-bunker-bausteine.js   (npm run test:bunker-bausteine)
const fs = require('fs');
const path = require('path');
const CONFIG = require('../shared/config.js');
const Physics = require('../shared/physics.js');
const { Game } = require('../server/game.js');
const combat = require('../server/sim/combat.js');
const Anker = require('../server/sim/anker.js');
const interior = require('../server/sim/interior.js');
const Graben = require('../server/sim/graben.js');
const L = require('../server/sim/landepunkte.js');
const W = require('../server/world.js');
const Locations = require('../shared/locations.js');
const Registry = require('../server/mission/registry.js');
const Checker = require('../server/mission/checker.js');

let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); };
const section = (t, fn) => { console.log('\n[' + t + ']'); try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); } };
const tile = (o) => Physics.toTile(o.x, o.y);
const SP = 'bk.reaktor.sprengpunkt';

// Buch mit einem Bunker-Schritt. Die Takt-Bedingung steht als ERSTE Bedingung der ersten next-Zeile (so soll ein Regiebuch es schreiben).
function buch(lp, o) {
  o = o || {};
  const aufbau = Object.assign({ do: 'bunker_aufbauen', map: lp, fraktion: 'raubzug', sperre: 'aus' }, o.aufbau || {});
  return {
    format: 'regiebuch/1', id: o.id || 'ar_1_bunker',
    kopf: { titel: 'Bunker', art: 'archiv', auftraggeber: 'tesk', zielspieldauer_min: 15 },
    erinnerung: { npc: 'tesk', ereignis: 'tafel_uebergeben' },
    buch: { von: [{ npc: 'tesk' }], briefing: '@b', belohnung: '@b', ziel: 'splitter', dauer_min: 15, erinnerung: '@b' },
    buehne: { orte: ['hafen', 'splitter'], aussenkarten: [lp] }, besetzung: { npc: ['tesk'] },
    steps: [
      { id: 'bunker', umsetzung: 'kette/wartet', enter: [aufbau], timers: [{ at: 900, oda: '@b', garantie: 'hinweis' }],
        rules: [{ if: { check: { name: 'bunker_gesprengt', map: lp } }, do: [{ set: { geknallt: true } }] }],
        objectives: [
          { id: 'oben', text: '@b', done: { check: { name: 'bunker_welle_tot', map: lp, welle: 2 } } },
          { id: 'offen', text: '@b', done: { check: { name: 'bunker_offen', map: lp } } },
        ],
        next: [{ if: { check: { name: 'bunker_sieg_bereit', map: lp } }, complete: 'erfolg' }], skip: [] },
    ],
    ausgaenge: { erfolg: { beschreibung: 'ok', folgen: [{ do: 'chronik', text: '@b' }] } },
    texte: Object.assign({ b: 'Text' }, o.texte || {}),
  };
}

// Spiel mit np Spielern, Kampagne ohne Tutorial-Zwang; o: { aufbau, texte, ladung (Teaminventar vor dem Aufbau), buchOhneStart }
function szene(np, o) {
  o = o || {};
  const g = new Game({ noStore: true, seed: 11, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < np; i++) { const c = { inbox: [], send(m) { if (this.inbox.length < 3000) this.inbox.push(m); } }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'B' + i, name: 'B' + i, color: i }); cs.push(c); }
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  for (let i = 0; i < 6; i++) g.step();
  const fehler = [];
  g.countError = (w, e) => { fehler.push(w + ': ' + (e && e.message)); };
  const lp = L.neu(g, g.ship.scene, { art: 'aussenposten', seed: 7, besitz: 'rom', gen: { fest: CONFIG.graben.fest, abschnitte: Graben.auswahl(g, null) } });
  L.get(g, lp);   // Karte im Cache: Aktionen mit map laufen sofort (mission.aufKarten)
  const K = W.AWAY_MAPS[lp].karte;
  if (o.ladung !== undefined) g.inventory.ladung = o.ladung;
  const ev = [], oda = [];
  const emit = g.emit; g.emit = function (t, d) { ev.push([t, d]); return emit.apply(this, arguments); };
  const odaF = g.oda; g.oda = function (txt) { oda.push(String(txt)); return odaF.apply(this, arguments); };
  const m = g.mission;
  const b = buch(lp, o);
  const r = m.registerBook(b, { origin: 'archiv' });
  const t = { g, cs, lp, K, fehler, ev, oda, buch: b, reg: r, m, takte: 0 };
  // Tick-Zähler der Mechanik (wie oft läuft graben.mechanikTick)
  const mt = Graben.mechanikTick; t.mt = mt;
  t.zaehler = () => { Graben.mechanikTick = function () { t.takte++; return mt.apply(this, arguments); }; };
  t.start = () => {
    m.activeId = null; m.def = null; m.step = null;
    m.startMission(b.id);
    return g.aways[lp];
  };
  t.betreten = () => {
    const aw = g.aways[lp];
    // Schiff am Transferpunkt des Orts, Landepunkt als Transferziel (wie arena.bodenSzene): damit gilt das Hochbeamen am Pad wirklich
    const st = (Locations.get(g.ship.scene).scene || {}).station || { x: 1200, y: 900 };
    g.ship.x = st.x - 60; g.ship.y = st.y; g.ship.vx = 0; g.ship.vy = 0; g.ship.speed = 0;
    g.transferZiel = { lp, scene: g.ship.scene };
    if (g.ship.systems.transfer !== 'ok') interior.damageSystem(g, 'transfer', 'ok', { quiet: true });
    g.setAwayMap(lp); aw.active = true;
    for (const [j, p] of g.players.entries()) { interior.placeOnAwayPad(g, p, j); combat.onArrive(g, p); }
    return aw;
  };
  const platz = (p, x, y) => { const c = Physics.tileCenter(x, y); p.x = c.x; p.y = c.y; p.input.mx = 0; p.input.my = 0; };
  t.am = (p, id) => { const a = K.anker.find((q) => q.id === id); platz(p, a.x, a.y); };
  t.laufe = (sek) => { for (let i = 0; i < Math.round(sek * CONFIG.tickHz); i++) { for (const p of g.players) { if (p.zone !== 'away') continue; if (p.shield) p.shield.seg = 3; p.downed = false; p.hp = 100; } g.step(); } };
  t.send = (i, msg) => g.handleMessage(cs[i], msg);
  t.faellen = (ids, aw) => { for (const e of aw.drones) if (ids.includes(e.id)) for (let i = 0; i < 12 && e.alive; i++) combat.hitEnemy(g, e, 99, { x: e.x - 40, y: e.y }); };
  t.zuenden = (i) => { t.am(g.players[i], SP); t.send(i, { t: 'act', down: true }); t.laufe(CONFIG.anker.halten.sprengpunkt + 0.4); t.send(i, { t: 'act', down: false }); };
  t.padHoch = (i) => { t.am(g.players[i], 'bunker.pad'); t.send(i, { t: 'act', down: true }); t.laufe(CONFIG.ship.beamTime + 0.6); t.send(i, { t: 'act', down: false }); };
  t.pruef = (name, args) => !!Registry.get(name).test(m, Object.assign({ map: lp }, args || {}));
  t.nachschub = (aw) => aw.drones.filter((e) => e.squad === 'graben.nachschub');
  t.evN = (name) => ev.filter((e) => e[0] === name).length;
  t.blockiert = () => { const sp = K.anker.find((a) => a.id === SP); const l = []; Anker.interactionsAt(g, g.players[0], sp.x, sp.y, l); return l.length > 0 && l.every((q) => q.blocked); };
  return t;
}
const fehlerOk = (t) => t.fehler.length === 0;

section('1. Katalog, Registry und Prüfer', () => {
  const d = Registry.describe();
  const ids = ['bunker_aufbauen', 'bunker_welle_tot', 'bunker_offen', 'bunker_gesprengt', 'bunker_sieg_bereit'];
  ok(ids.every((id) => d.find((x) => x.id === id)) && Registry.PLUGINS.every((p) => !p.errors.length), 'fünf Bausteine registriert, keine Plugin-Fehler');
  const a = d.find((x) => x.id === 'bunker_aufbauen');
  ok(a.art === 'aktion' && a.params.map.pflicht && a.params.fraktion.pflicht && a.params.sperre.pflicht && a.params.sperre.werte.join() === 'an,aus' && !('ladung' in a.params) && !('texte' in a.params), 'bunker_aufbauen: map, fraktion, sperre (an|aus) Pflicht; kein Parameter ladung (das Regiebuch besitzt sie)');
  ok(ids.slice(1).every((id) => d.find((x) => x.id === id).art === 'pruefung'), 'die vier übrigen sind Prüfungen');
  const bs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'regiebuch', 'bausteine.json'), 'utf8'));
  const gleich = ids.every((id) => { const j = bs.aktionen[id] || bs.pruefungen[id]; const r = d.find((x) => x.id === id); return j && j.status === 'registriert' && Object.keys(j.params).sort().join() === Object.keys(r.params).sort().join() && Object.entries(j.params).every(([k, v]) => v.typ === r.params[k].typ && !!v.pflicht === !!r.params[k].pflicht); });
  ok(gleich, 'bausteine.json stimmt mit der Registry in Parametern, Typ und Pflicht überein');
  const t = szene(1);
  ok(t.reg.ok, 'Buch mit Bunker-Schritt besteht den Prüfer (' + (t.reg.ok ? '' : JSON.stringify(t.reg.errors.slice(0, 3))) + ')');
  const pruefe = (aend) => { const b = JSON.parse(JSON.stringify(t.buch)); b.id = 'ar_1_bunker_x'; aend(b); return Checker.check(b); };
  const e0 = (b) => b.steps[0].enter[0];
  ok(pruefe((b) => { e0(b).sperre = 'vielleicht'; }).errors.some((e) => e.code === 'PARAM-WERT'), "sperre 'vielleicht': PARAM-WERT");
  ok(pruefe((b) => { delete e0(b).fraktion; }).errors.some((e) => e.code === 'PARAM-FEHLT'), 'ohne fraktion: PARAM-FEHLT');
  ok(pruefe((b) => { e0(b).ladung = 'setzen'; }).errors.some((e) => e.code === 'PARAM-UNBEKANNT'), 'Parameter ladung gibt es nicht: PARAM-UNBEKANNT');
  ok(pruefe((b) => { e0(b).ziel_offen = '@fehlt'; }).errors.some((e) => e.code === 'REF-TEXT'), 'Textparameter mit unbekanntem @-Verweis: REF-TEXT');
  ok(pruefe((b) => { e0(b).ziel_offen = '@z'; b.texte.z = 'x'.repeat(130); }).errors.some((e) => e.code === 'ODA-LAENGE'), 'ODA-Text über 120 Zeichen: ODA-LAENGE');
  ok(pruefe((b) => { b.steps[0].objectives[0].done.check.welle = 0; }).errors.some((e) => e.code === 'PARAM-WERT'), 'welle 0: PARAM-WERT');
  ok(pruefe((b) => { delete b.steps[0].objectives[0].done.check.welle; }).errors.some((e) => e.code === 'PARAM-FEHLT'), 'bunker_welle_tot ohne welle: PARAM-FEHLT');
  ok(pruefe((b) => { b.steps[0].objectives[0].done.check.map = 'kesh.hof'; }).errors.some((e) => /map|Karte|Landepunkt/i.test(e.msg || '')), 'unbekannte Karte in der Prüfung: Prüferfehler');
  // EIS-01 P4: TAKT-BUNKER, ein Schritt mit bunker_aufbauen braucht eine Bunker-Prüfung als erste Bedingung der ersten next-Zeile
  const takt = (aend) => pruefe(aend).errors.filter((e) => e.code === 'TAKT-BUNKER');
  const sieg = () => ({ check: { name: 'bunker_sieg_bereit', map: t.lp } });
  ok(takt(() => {}).length === 0, 'TAKT-BUNKER positiv: bunker_sieg_bereit allein in next[0]: kein Fehler');
  ok(takt((b) => { b.steps[0].next[0].if = { all: [sieg(), { v: 'x' }] }; }).length === 0, 'TAKT-BUNKER positiv: Bunker-Prüfung als erstes Glied eines all: kein Fehler');
  ok(takt((b) => { b.steps[0].next[0].if = { check: { name: 'bunker_gesprengt', map: t.lp } }; }).length === 0, 'TAKT-BUNKER positiv: eine andere Bunker-Prüfung genügt');
  ok(takt((b) => { b.steps[0].next[0].if = { elapsed: 30 }; }).length === 1, 'TAKT-BUNKER negativ: next[0] ohne Bunker-Prüfung: Fehler');
  ok(takt((b) => { b.steps[0].next[0].if = { all: [{ v: 'x' }, sieg()] }; }).length === 1, 'TAKT-BUNKER negativ: Prüfung hinter einem kurzschließenden all (nicht zuerst): Fehler');
  ok(takt((b) => { b.steps[0].next.unshift({ if: { elapsed: 5 }, goto: 'bunker' }); }).length === 1, 'TAKT-BUNKER negativ: Bunker-Prüfung erst in der zweiten next-Zeile: Fehler');
  ok(takt((b) => { b.steps[0].next = []; }).length === 1, 'TAKT-BUNKER negativ: Schritt ohne next: Fehler');
  const tm = takt((b) => { b.steps[0].next[0].if = { elapsed: 30 }; })[0];
  ok(tm && /bunker_sieg_bereit/.test(tm.msg) && /CONTRACT-EK8/.test(tm.msg) && /next\[0\]/.test(tm.p), 'TAKT-BUNKER: Meldung nennt Prüfung, Fundort und Vertrag');
  ok(takt((b) => { b.steps[0].enter = []; b.steps[0].next[0].if = { elapsed: 30 }; }).length === 0, 'TAKT-BUNKER: Schritt ohne bunker_aufbauen wird nicht geprüft');
  ok(takt((b) => { b.steps[0].enter = []; b.steps[0].skip = [e0(b)]; b.steps[0].next[0].if = { elapsed: 30 }; }).length === 0, 'TAKT-BUNKER: bunker_aufbauen nur im skip zählt nicht');
});

section('2. Germanen (raubzug), Sperre aus: sofort zündbar; game.arena null; Ladung unberührt (0 und 2)', () => {
  for (const vorher of [0, 2]) {
    const t = szene(2, { ladung: vorher }); const { g, lp } = t;
    ok(t.reg.ok, 'Buch gültig');
    const aw = t.start(); const S = aw && aw.graben;
    ok(!!S && S.buehne === 'graben' && S.lp === lp && S.karte === CONFIG.graben.fest && S.seed === 7, 'bunker_aufbauen im enter des Schritts: Zustand in aw.graben (Karte ' + (S && S.karte) + ', Seed ' + (S && S.seed) + ' aus dem Landepunkt)');
    ok(g.arena === null && !Object.prototype.hasOwnProperty.call(g, 'arenaWellen'), 'game.arena bleibt null');
    ok(S.fraktion === 'raubzug' && S.sperreAktiv === false && S.ladung === 'unberuehrt' && S.ziel === 'offen', 'S: fraktion raubzug, sperreAktiv false, ladung unberuehrt, ziel offen');
    const lebend = aw.drones.filter((e) => e.alive);
    const kat = combat.katalogDaten(g).fraktionen;
    ok(lebend.length === S.gesamt && lebend.length > 0 && lebend.every((e) => e.fraktion === 'raubzug' && e.palette !== kat.rom.palette), 'alle ' + lebend.length + ' Gegner raubzug (nicht Rom), Palette nicht römisch');
    ok(Object.values(aw.squads).every((s) => s.fraktion === 'raubzug'), 'Trupps tragen die Fraktion raubzug');
    ok(g.inventory.ladung === vorher, 'Teaminventar ladung bleibt ' + vorher + ' (ist ' + g.inventory.ladung + ')');
    ok(!(aw.ankerSperre && aw.ankerSperre[SP]) && !t.blockiert(), 'Sprengpunkt nicht gesperrt (E nicht blockiert), obwohl alle Wellen leben');
    ok(aw.ausbruchErlaubt === false && aw.ohneZaehler === true, 'aw.ausbruchErlaubt false, aw.ohneZaehler true (BOD-03, in der Kampagne so gewollt)');
    ok(t.oda.length === 0 || !t.oda.some((x) => /Verteidiger halten|Rüstphase/.test(x)), 'kein Lobby-ODA (Start, Rüstphase) beim Aufbau');
    ok(!g.players.some((p) => p.zone === 'away'), 'keine Beamung durch den Aufbau: alle Spieler bleiben an Bord');
    t.betreten();
    t.laufe(2);
    ok(S.ziel === 'offen' && !t.oda.some((x) => /Weg zum Bunker ist frei/.test(x)), 'Ticks bei lebenden Wellen: bleibt offen, kein Öffnen-Text');
    ok(t.pruef('bunker_offen') && !t.pruef('bunker_gesprengt') && !t.pruef('bunker_welle_tot', { welle: 1 }) && !t.pruef('bunker_welle_tot', { welle: 2 }) && !t.pruef('bunker_sieg_bereit'), 'Prüfungen: offen ja; gesprengt, Wellen tot, sieg_bereit nein');
    const objs = Object.fromEntries(g.mission.state.objectives.map((q) => [q.id, q.done]));
    ok(objs.offen === true && objs.oben === false, 'Ziele des Schritts folgen den Prüfungen (offen erledigt, oben nicht)');
    if (vorher === 2) {
      t.zuenden(0);
      ok(Anker.zustand(g, lp, SP) === 'scharf' && g.inventory.ladung === 1, 'E 4 s halten bei lebenden Wellen: Ladung scharf, eine Ladung verbraucht (' + g.inventory.ladung + ')');
    }
    ok(g.arena === null && fehlerOk(t), 'game.arena null, keine Fehler (' + t.fehler.join('|') + ')');
  }
});

section('3. Sperre an: gesperrt bis die Oberflächenwellen tot sind; Texte aus dem Regiebuch (Rest aus CONFIG)', () => {
  const t = szene(2, { ladung: 2, aufbau: { sperre: 'an', fraktion: 'raubzug', ziel_offen: '@bunker.ziel_offen', sperre_text: '@bunker.sperre', nachschub: '@bunker.nachschub' },
    texte: { 'bunker.ziel_offen': 'Germanen: der Weg ist frei', 'bunker.sperre': 'Germanen: erst die Wachen', 'bunker.nachschub': 'Germanen: Verstärkung' } });
  const { g, lp } = t; ok(t.reg.ok, 'Buch mit Textparametern gültig (' + (t.reg.ok ? '' : JSON.stringify(t.reg.errors.slice(0, 3))) + ')');
  const aw = t.start(); const S = aw.graben; t.betreten();
  ok(S.sperreAktiv === true && S.ziel === 'gesperrt' && aw.ankerSperre[SP] === 'Germanen: erst die Wachen' && t.blockiert(), 'gesperrt, Hinweis aus dem Regiebuch, E blockiert');
  ok(aw.ankerSperre[S.stillId] && /Reaktorraum/.test(aw.ankerSperre[S.stillId]), 'nicht gesetzter Text ziel_still: Konfigurationstext');
  t.laufe(1);
  ok(!t.pruef('bunker_offen') && g.mission.state.objectives.every((q) => !q.done), 'lebende Wellen: weder offen noch Ziele erledigt');
  t.faellen(S.ids[1], aw); t.laufe(1);
  ok(!t.pruef('bunker_welle_tot', { welle: 2 }) && t.pruef('bunker_welle_tot', { welle: 1 }) && S.ziel === 'gesperrt' && t.blockiert(), 'nur Welle 1 tot: welle_tot 1 ja, 2 nein, weiter gesperrt');
  t.faellen(S.ids[2], aw); t.laufe(1);
  ok(S.ziel === 'offen' && t.pruef('bunker_offen') && t.pruef('bunker_welle_tot', { welle: 2 }) && !t.pruef('bunker_welle_tot', { welle: 3 }) && !aw.ankerSperre[SP] && !t.blockiert(), 'Welle 2 tot: offen, Sperre weg (Welle 3 im Bunker lebt)');
  ok(t.oda.filter((x) => x === 'Germanen: der Weg ist frei').length === 1, 'Öffnen-Text aus dem Regiebuch, genau einmal');
  const objs = Object.fromEntries(g.mission.state.objectives.map((q) => [q.id, q.done]));
  ok(objs.oben && objs.offen, 'Ziele oben und offen erledigt');
  ok(!t.pruef('bunker_welle_tot', { welle: 7 }) && t.fehler.length === 1 && /keine Welle 7/.test(t.fehler[0]), 'Welle, die es nicht gibt: false und einmal gemeldet');
  t.pruef('bunker_welle_tot', { welle: 7 });
  ok(t.fehler.length === 1, 'wiederholt: keine zweite Meldung');
  t.fehler.length = 0;
  t.faellen(S.ids[3], aw); t.laufe(1);
  Anker.ladungScharf(g, lp, SP, 0.3); t.laufe(2);
  ok(S.ziel === 'erreicht' && t.oda.some((x) => x === 'Germanen: Verstärkung') && t.oda.some((x) => /Der Bunker ist gesprengt/.test(x)), 'Nachschub-Text aus dem Regiebuch, ziel_erreicht fällt auf CONFIG zurück');
  ok(g.arena === null && fehlerOk(t), 'game.arena null, keine Fehler (' + t.fehler.join('|') + ')');
});

section('4. Takt genau einmal je Spieltick, auch bei mehrfacher Auswertung im selben Tick', () => {
  const t = szene(2, { aufbau: { sperre: 'aus' } }); const { g, lp, m } = t;
  const aw = t.start(); const S = aw.graben; t.betreten();
  t.zaehler();
  const tick0 = g.tick; t.laufe(3);
  const ticks = g.tick - tick0;
  ok(ticks > 80 && t.takte === ticks, 'Spielticks ' + ticks + ', Aufrufe von graben.mechanikTick ' + t.takte + ' (Ziele, Regel und next werten je Tick mehrfach aus: Takt trotzdem einmal)');
  const vor = t.takte; const nach = S.taktTick;
  for (let i = 0; i < 5; i++) { t.pruef('bunker_offen'); t.pruef('bunker_gesprengt'); t.pruef('bunker_sieg_bereit'); m.cond({ check: { name: 'bunker_welle_tot', map: lp, welle: 1 } }); }
  ok(t.takte === vor && S.taktTick === nach, 'zwanzig Auswertungen im selben Tick: kein weiterer Takt');
  // Knall im selben Tick mehrfach ausgewertet: Nachschub kommt genau einmal
  for (const id of [1, 2, 3]) t.faellen(S.ids[id], aw);
  t.laufe(1);
  Anker.ladungScharf(g, lp, SP, 0.3);
  for (let i = 0; i < 2 * CONFIG.tickHz; i++) { g.step(); for (let j = 0; j < 3; j++) { t.pruef('bunker_gesprengt'); t.pruef('bunker_sieg_bereit'); } }
  ok(S.ziel === 'erreicht' && t.nachschub(aw).length === 4 && t.evN('nachschub') === 1 && t.oda.filter((x) => /^ALARM – Nachschub kommt/.test(x)).length === 1, 'Knall, je Tick mehrfach ausgewertet: Nachschub 4 Mann, Ereignis und Ansage genau einmal');
  Graben.mechanikTick = t.mt;
  ok(fehlerOk(t) && g.arena === null, 'keine Fehler, game.arena null');
});

section('5. Knall -> Nachschub 4 Mann oben (Germanen); Sieg bereit erst, wenn alle oben sind; Regiebuch schließt die Mission', () => {
  const t = szene(2, { aufbau: { sperre: 'aus' } }); const { g, lp, K, m } = t;
  const aw = t.start(); const S = aw.graben; t.betreten();
  for (const id of [1, 2, 3]) t.faellen(S.ids[id], aw);
  t.laufe(1);
  ok(t.pruef('bunker_welle_tot', { welle: 1 }) && t.pruef('bunker_welle_tot', { welle: 2 }) && t.pruef('bunker_welle_tot', { welle: 3 }), 'alle drei Wellen tot (welle_tot 1, 2, 3)');
  g.players.forEach((p) => { p.zone = 'ship'; });
  t.laufe(1);
  ok(!t.pruef('bunker_sieg_bereit') && m.step.id === 'bunker', 'alle an Bord, aber noch keine Sprengung: nicht bereit, Mission läuft');
  g.players.forEach((p) => { p.zone = 'away'; });
  g.players.forEach((p) => t.am(p, 'bunker.lift.unten'));
  ok(t.evN('nachschub') === 0 && !t.pruef('bunker_gesprengt'), 'vor dem Knall: kein Nachschub, nicht gesprengt');
  Anker.ladungScharf(g, lp, SP, 0.3); t.laufe(2);
  ok(t.pruef('bunker_gesprengt') && m.v.geknallt === true, 'Knall: bunker_gesprengt wahr, die Regel des Schritts hat gefeuert (m.v.geknallt)');
  const ns = t.nachschub(aw); const lo = K.anker.find((a) => a.id === 'bunker.lift.oben');
  ok(ns.length === 4 && ns.every((e) => e.alive && e.rolle === 'grundtyp' && Math.floor(tile(e).y / K.decks.stride) === 0 && e.fraktion === 'raubzug'), 'vier Mann Nachschub, grundtyp, alle oben (Deck 0), Fraktion raubzug');
  ok(ns.every((e) => { const d = Math.max(Math.abs(tile(e).x - lo.x), Math.abs(tile(e).y - lo.y)); return d >= 2 && d <= 10; }), 'am Lift oben');
  ok(!t.pruef('bunker_sieg_bereit') && m.step.id === 'bunker', 'beide unten: nicht bereit');
  t.faellen(S.nachschubIds, aw);
  t.am(g.players[1], 'bunker.lift.unten');
  t.padHoch(0); t.laufe(1);
  ok(g.players[0].zone === 'ship' && g.players[1].zone === 'away' && !t.pruef('bunker_sieg_bereit') && m.step.id === 'bunker' && m.missions.ar_1_bunker.state === 'active', 'Spieler 0 an Bord, Spieler 1 im Bunker: nicht bereit, Mission läuft');
  t.padHoch(1); t.laufe(1);
  ok(g.players.every((p) => p.zone === 'ship') && m.missions.ar_1_bunker.state === 'done' && m.missions.ar_1_bunker.ausgang === 'erfolg', 'beide an Bord: Mission endet über das Regiebuch (next -> complete erfolg)');
  ok(g.arena === null && fehlerOk(t), 'game.arena null, keine Fehler (' + t.fehler.join('|') + ')');
});

section('6. map_reset und erneuter Aufbau: frischer Zustand, keine Altlast; einmal je Karte', () => {
  const t = szene(2, { ladung: 1, aufbau: { sperre: 'an' } }); const { g, lp, m } = t;
  const aw1 = t.start(); const S1 = aw1.graben; t.betreten();
  ok(!!S1 && S1.versuch === 1, 'Aufbau 1');
  m.act({ do: 'bunker_aufbauen', map: lp, fraktion: 'rom', sperre: 'aus' });
  ok(aw1.graben === S1 && S1.fraktion === 'raubzug' && S1.sperreAktiv === true, 'zweiter Aufruf ohne map_reset: nichts (derselbe Zustand, alte Fraktion und Sperre)');
  const gesamt1 = S1.gesamt;
  t.faellen(S1.ids[1], aw1); t.faellen(S1.ids[2], aw1); t.laufe(1);
  t.faellen(S1.ids[3], aw1); t.laufe(1);
  g.players.forEach((p) => t.am(p, 'bunker.lift.unten'));
  Anker.ladungScharf(g, lp, SP, 0.3); t.laufe(2);
  ok(S1.ziel === 'erreicht' && t.nachschub(aw1).length === 4, 'Altlast aufgebaut: gesprengt, Nachschub da');
  const ladungVor = g.inventory.ladung;
  m.act({ do: 'map_reset', map: lp });
  const aw2 = g.aways[lp];
  ok(aw2 && aw2 !== aw1 && aw2.graben === undefined && !('graben' in aw2), 'map_reset: neue Karte, aw.graben weg (der Zustand wird mit aw verworfen)');
  ok(!t.pruef('bunker_offen') && !t.pruef('bunker_gesprengt') && !t.pruef('bunker_sieg_bereit') && !t.pruef('bunker_welle_tot', { welle: 1 }), 'alle vier Prüfungen falsch ohne Bunker (kein Wurf, keine Meldung)');
  t.laufe(1);
  ok(fehlerOk(t), 'Ticks ohne Bunker: keine Fehler (' + t.fehler.join('|') + ')');
  ok(aw2.drones.length === 0 && !aw2.squads['graben.nachschub'] && g.inventory.ladung === ladungVor, 'keine Gegner, kein Nachschub-Trupp, Ladung unberührt');
  m.act({ do: 'bunker_aufbauen', map: lp, fraktion: 'raubzug', sperre: 'an' });
  const S2 = aw2.graben;
  ok(!!S2 && S2 !== S1 && S2.versuch === 1 && S2.ziel === 'gesperrt' && S2.nachschub === null && S2.nachschubIds.length === 0 && S2.abschuesse === 0 && S2.taktTick === undefined, 'erneuter Aufbau: neuer Zustand, Versuch 1, gesperrt, kein Nachschub, keine Abschüsse');
  const lebend = aw2.drones.filter((e) => e.alive);
  ok(S2.gesamt === gesamt1 && lebend.length === gesamt1 && lebend.every((e) => e.fraktion === 'raubzug') && !aw2.squads['graben.nachschub'], 'wieder alle ' + gesamt1 + ' Verteidiger, kein Nachschub-Trupp');
  ok(Anker.zustand(g, lp, SP) !== 'zerstoert' && /Erst die Verteidiger/.test(aw2.ankerSperre[SP]), 'Sprengpunkt wieder intakt und gesperrt');
  ok(!t.pruef('bunker_gesprengt') && !t.pruef('bunker_offen') && t.pruef('bunker_welle_tot', { welle: 1 }) === false, 'Prüfungen nach dem Neuaufbau: frisch falsch');
  ok(g.arena === null && fehlerOk(t), 'game.arena null, keine Fehler (' + t.fehler.join('|') + ')');
  // Fehlerfälle: nie ein Wurf
  const t2 = szene(1); t2.start(); t2.m.act({ do: 'map_reset', map: t2.lp });
  t2.m.act({ do: 'bunker_aufbauen', map: t2.lp, fraktion: 'gibtsnicht', sperre: 'an' });
  ok(!t2.g.aways[t2.lp].graben && t2.fehler.some((e) => /Fraktion 'gibtsnicht' unbekannt/.test(e)), 'unbekannte Fraktion: kein Aufbau, Fehler gezählt');
  const t3 = szene(1); const lpK = L.neu(t3.g, t3.g.ship.scene, { art: 'aussenposten', seed: 3 }); L.get(t3.g, lpK);
  t3.m.act({ do: 'bunker_aufbauen', map: lpK, fraktion: 'raubzug', sperre: 'an' });
  ok(!t3.g.aways[lpK].graben && t3.fehler.some((e) => /keine feste Karte/.test(e)), 'Landepunkt ohne gen.fest: kein Aufbau, Fehler gezählt');
});

section('7. aw.graben gelangt nicht in Snapshot und Weltstand', () => {
  const t = szene(2, { aufbau: { sperre: 'an' } }); const { g } = t;
  const aw = t.start(); t.betreten(); t.laufe(2);
  ok(aw.graben && aw.graben.lebt instanceof Set, 'Zustand vorhanden (S.lebt ist ein Set)');
  const schluessel = (o, tief, out) => { if (tief > 8 || !o || typeof o !== 'object') return out; for (const k of Object.keys(o)) { out.push(k); schluessel(o[k], tief + 1, out); } return out; };
  const snap = g.snapshot();
  let json = null; try { json = JSON.stringify(snap); } catch (e) { json = null; }
  ok(json !== null, 'Snapshot lässt sich serialisieren');
  const keys = new Set(schluessel(snap, 0, []));
  ok(!keys.has('graben') && !keys.has('lebt') && !keys.has('nachschubIds') && !keys.has('zielId'), 'Snapshot enthält keinen Schlüssel des Zustands (graben, lebt, nachschubIds, zielId)');
  ok(!keys.has('wellen') && !(snap.arena), 'Snapshot ohne wellen-Block und ohne arena');
  let ws = null; try { ws = JSON.stringify(g.weltstand && g.weltstand.data || {}); } catch (e) { ws = null; }
  ok(ws !== null && !/"buehne":"graben"|"nachschubIds"|"zielId"/.test(ws), 'Weltstand-Daten ohne Bunkerzustand');
  ok(fehlerOk(t), 'keine Fehler (' + t.fehler.join('|') + ')');
});

console.log(`\n${n - fails}/${n} ok`);
if (fails) { console.log(`${fails} FEHLER`); process.exit(1); }
console.log('TEST BUNKER-BAUSTEINE OK');
