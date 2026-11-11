'use strict';
// EIS-01 P1: Die Mechanik des Grabenangriffs (server/sim/graben.js) als Kampagnen-Einstieg: Aufbau ohne game.arena (aufbauen), Tick ohne sieg()/endSession (mechanikTick,
// zielTick, abschuesseZaehlen), Siegprüfung rein lesend (siegBereit), Varianten im Optionenobjekt (fraktion, sperreAktiv, ladung, texte). Headless.
// Die Karte baut der Lobby-Start (arena_graben); danach wird game.arena = null gesetzt (wie in der Kampagne), der Zustand neu über graben.aufbauen erzeugt
// und je Schritt von Hand getickt (mechanikTick statt arena.update -> wellen.update).
//   node tools/test-graben-mechanik.js
const CONFIG = require('../shared/config.js');
const Physics = require('../shared/physics.js');
const { Game } = require('../server/game.js');
const combat = require('../server/sim/combat.js');
const Anker = require('../server/sim/anker.js');
const interior = require('../server/sim/interior.js');
const Graben = require('../server/sim/graben.js');
const W = require('../server/world.js');

let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); };
const section = (t, fn) => { console.log('\n[' + t + ']'); try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); } };
const fehlerZahl = (g) => (Array.isArray(g.errors) ? g.errors.length : g.errors | 0);
const tile = (o) => Physics.toTile(o.x, o.y);
const SP = 'bk.reaktor.sprengpunkt';

// Spiel mit np Spielern; opt = Optionenobjekt für graben.aufbauen; vorher = Teaminventar-Ladung vor dem Aufbau (undefined = unverändert)
function start(np, opt, vorher) {
  const g = new Game({ noStore: true, seed: 11, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < np; i++) { const c = { inbox: [], send(m) { if (this.inbox.length < 3000) this.inbox.push(m); } }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'X' + i, name: 'X' + i, color: i }); cs.push(c); }
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: 'arena_graben' });
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  const S0 = g.arena.wellen, aw = g.aways[S0.lp], K = W.AWAY_MAPS[S0.lp].karte;
  // ab hier Kampagne: kein game.arena, der Lobby-Zustand ist verworfen
  g.arena = null;
  for (const nm of Object.keys(aw.spawned || {})) if (/^graben\./.test(nm)) delete aw.spawned[nm];
  if (vorher !== undefined) g.inventory.ladung = vorher;
  const S = Graben.aufbauen(g, { karte: S0.karte, seed: S0.seed, lp: S0.lp, auswahl: S0.auswahl }, opt);
  const anker = (id) => K.anker.find((a) => a.id === id);
  const ev = [], oda = [];
  const emit = g.emit; g.emit = function (t, d) { ev.push([t, d]); return emit.apply(this, arguments); };
  const odaF = g.oda; g.oda = function (txt) { oda.push(String(txt)); return odaF.apply(this, arguments); };
  const platz = (p, x, y) => { const c = Physics.tileCenter(x, y); p.x = c.x; p.y = c.y; p.input.mx = 0; p.input.my = 0; };
  const am = (p, id) => { const a = anker(id); platz(p, a.x, a.y); };
  const letzt = { r: null };
  // läuft sek Sekunden, Spieler unverwundbar; der Aufrufer (Agent der Kampagne) tickt die Mechanik von Hand
  const laufe = (sek) => { for (let i = 0; i < Math.round(sek * CONFIG.tickHz); i++) { for (const p of g.players) { if (p.zone !== 'away') continue; if (p.shield) p.shield.seg = 3; p.downed = false; p.hp = 100; } g.step(); letzt.r = Graben.mechanikTick(g, S); } };
  const send = (i, m) => g.handleMessage(cs[i], m);
  const faellen = (ids) => { for (const e of aw.drones) if (ids.includes(e.id)) for (let i = 0; i < 12 && e.alive; i++) combat.hitEnemy(g, e, 99, { x: e.x - 40, y: e.y }); };
  const nachschub = () => aw.drones.filter((e) => e.squad === 'graben.nachschub');
  const evN = (name) => ev.filter((e) => e[0] === name).length;
  const zuenden = (i) => { am(g.players[i], SP); send(i, { t: 'act', down: true }); laufe(CONFIG.anker.halten.sprengpunkt + 0.4); send(i, { t: 'act', down: false }); };
  const padHoch = (i) => { am(g.players[i], 'bunker.pad'); send(i, { t: 'act', down: true }); laufe(CONFIG.ship.beamTime + 0.6); send(i, { t: 'act', down: false }); };
  return { g, cs, S, aw, K, anker, ev, oda, platz, am, laufe, send, faellen, nachschub, evN, zuenden, padHoch, letzt };
}
const blockiert = (g, S, i) => { const sp = W.AWAY_MAPS[S.lp].karte.anker.find((a) => a.id === SP); const l = []; Anker.interactionsAt(g, g.players[i], sp.x, sp.y, l); return l.length > 0 && l.every((q) => q.blocked); };

section('(a) Standardoptionen: Sperre gesetzt, Welle 1 und 2 töten öffnet sie; keine Lobby-Seiteneffekte', () => {
  const r = start(2); const { g, S, aw, faellen, laufe, ev, oda } = r;
  ok(g.arena === null, '(g) game.arena bleibt null nach aufbauen');
  ok(S.buehne === 'graben' && S.ph === 'kampf' && S.sperreAktiv === true && S.ladung === 'setzen' && S.texte === null && S.fraktion === 'rom', 'Standardwerte in S: sperreAktiv true, ladung setzen, texte null, fraktion rom');
  ok(S.ziel === 'gesperrt' && /Erst die Verteidiger/.test(aw.ankerSperre[SP]) && blockiert(g, S, 0), 'Sprengpunkt gesperrt (Hinweis sperre), E blockiert');
  ok(!ev.some((e) => e[0] === 'wellenEnde') && !oda.length, 'aufbauen: kein ODA, kein Siegbild');
  ok(g.inventory.ladung === 1, 'Ladung auf genau 1 gesetzt (' + g.inventory.ladung + ')');
  ok(S.gesamt === 9 + 4 && Object.keys(S.ids).length === 3 && aw.drones.filter((e) => e.alive).length === S.gesamt, 'Gegner aufgestellt: ' + S.gesamt + ' (Welle 1 und 2 oben, Welle 3 im Bunker)');
  laufe(1);
  ok(letzt(r).ziel === 'gesperrt' && blockiert(g, S, 0), 'Tick bei lebenden Wellen: weiter gesperrt');
  faellen(S.ids[1]); laufe(1);
  ok(S.ziel === 'gesperrt' && blockiert(g, S, 0), 'nur Welle 1 tot: weiter gesperrt');
  faellen(S.ids[2]); laufe(1);
  ok(S.ziel === 'offen' && letzt(r).ziel === 'offen' && !aw.ankerSperre[SP] && !blockiert(g, S, 0), 'Welle 2 tot: offen, Sperre weg (Welle 3 im Bunker lebt)');
  ok(oda.some((t) => /Weg zum Bunker ist frei/.test(t)) && ev.some((e) => e[0] === 'sfx' && e[1].name === 'repair_done'), 'ODA und Ton beim Öffnen');
  ok(g.arena === null && fehlerZahl(g) === 0, '(g) game.arena null, keine Fehler');
});

section('(b) sperreAktiv false: nie gesperrt, Sprengpunkt sofort zündbar', () => {
  const r = start(2, { sperreAktiv: false }); const { g, S, aw, laufe, zuenden } = r;
  ok(S.sperreAktiv === false && S.ziel === 'offen' && !(aw.ankerSperre && aw.ankerSperre[SP]) && !blockiert(g, S, 0), 'S.ziel startet offen, keine Sperre auf dem Sprengpunkt');
  ok(aw.drones.filter((e) => e.alive && S.ids[1].includes(e.id)).length > 0 && aw.drones.filter((e) => e.alive && S.ids[2].includes(e.id)).length > 0, 'Welle 1 und 2 leben');
  laufe(3);
  ok(S.ziel === 'offen' && !r.oda.some((t) => /Weg zum Bunker ist frei/.test(t)), 'Ticks bei lebenden Wellen: bleibt offen, kein Öffnen-ODA');
  zuenden(0);
  ok(Anker.zustand(g, S.lp, SP) === 'scharf' && g.inventory.ladung === 0, 'E 4 s halten bei lebenden Wellen: Ladung scharf');
  ok(g.arena === null && fehlerZahl(g) === 0, '(g) game.arena null, keine Fehler');
});

section('(c) ladung: unberuehrt lässt das Teaminventar in Ruhe, setzen setzt auf 1', () => {
  for (const vorher of [0, 2]) {
    const u = start(2, { ladung: 'unberuehrt' }, vorher);
    ok(u.S.ladung === 'unberuehrt' && u.g.inventory.ladung === vorher, `unberuehrt, vorher ${vorher}: ladung bleibt ${u.g.inventory.ladung}`);
    const s = start(2, { ladung: 'setzen' }, vorher);
    ok(s.g.inventory.ladung === 1, `setzen, vorher ${vorher}: ladung ist ${s.g.inventory.ladung} (Stand auf genau 1, nicht addiert)`);
    ok(u.g.arena === null && s.g.arena === null, '(g) game.arena null');
  }
  let fehler = null; try { start(2, { ladung: 'xyz' }); } catch (e) { fehler = e; }
  ok(fehler && /unbekannt/.test(fehler.message), 'unbekannter Wert für ladung wirft');
  // Neubeginn der Lobby nutzt dieselbe Variante: unberuehrt fasst auch dort nichts an
  const u = start(2, { ladung: 'unberuehrt' }, 0); Graben.neuBeginnen(u.g, u.S);
  ok(u.g.inventory.ladung === 0 && u.S.versuch === 2 && u.S.ziel === 'gesperrt', 'neuBeginnen bei unberuehrt: Ladung unberührt, Versuch 2, Ziel gesperrt');
  const f = start(2, { sperreAktiv: false }); Graben.neuBeginnen(f.g, f.S);
  ok(f.S.ziel === 'offen' && !(f.aw.ankerSperre && f.aw.ankerSperre[SP]), 'neuBeginnen bei sperreAktiv false: Ziel offen, keine Sperre');
});

section('(d) Knall: genau einmal Nachschub (vier Mann, oben); Ergebnis des Ticks', () => {
  const r = start(2); const { g, S, aw, K, anker, faellen, laufe, nachschub, evN, oda, letzt, am } = r;
  faellen(S.ids[1]); faellen(S.ids[2]); faellen(S.ids[3]); laufe(1);
  ok(letzt.r.ziel === 'offen' && letzt.r.siegBereit === false && evN('nachschub') === 0, 'vor dem Knall: ziel offen, kein Nachschub');
  g.players.forEach((p) => am(p, 'bunker.lift.unten'));
  Anker.ladungScharf(g, S.lp, SP, 0.3);
  let knall = 0; let zt = null;
  for (let i = 0; i < 2 * CONFIG.tickHz; i++) { g.step(); const t = Graben.zielTick(g, S); Graben.abschuesseZaehlen(g, S); if (t.knall) { knall++; zt = t; } }
  ok(knall === 1 && zt.ziel === 'erreicht' && S.ziel === 'erreicht', 'zielTick meldet den Knall genau einmal (knall ' + knall + '), ziel erreicht');
  const ns = nachschub(); const lo = anker('bunker.lift.oben');
  ok(ns.length === 4 && ns.every((e) => e.alive && e.rolle === 'grundtyp' && Math.floor(tile(e).y / K.decks.stride) === 0), 'vier Mann Nachschub, Rolle grundtyp, alle oben (Deck 0)');
  ok(ns.every((e) => { const d = Math.max(Math.abs(tile(e).x - lo.x), Math.abs(tile(e).y - lo.y)); return d >= 2 && d <= 10; }), 'am Lift oben');
  ok(evN('nachschub') === 1 && S.nachschub === 'gesendet' && S.nachschubIds.length === 4 && oda.filter((t) => /^ALARM – Nachschub kommt/.test(t)).length === 1, 'Ereignis nachschub 1x, ODA 1x, S.nachschub gesendet');
  laufe(20);
  ok(nachschub().length === 4 && evN('nachschub') === 1 && Graben.nachschubSenden(g, S) === 0 && nachschub().length === 4, 'weitere Ticks und ein zweiter Aufruf von nachschubSenden lösen nichts neu aus');
  ok(S.ph === 'kampf' && g.phase === 'play', 'kein sieg(): Phase bleibt kampf');
  ok(g.arena === null && fehlerZahl(g) === 0, '(g) game.arena null, keine Fehler');
});

section('(e) Siegprüfung: erst wahr, wenn niemand mehr unten ist (und erst nach dem Knall)', () => {
  const r = start(2); const { g, S, aw, faellen, laufe, nachschub, padHoch, am, letzt } = r;
  faellen(S.ids[1]); faellen(S.ids[2]); faellen(S.ids[3]); laufe(1);
  g.players.forEach((p) => { p.zone = 'ship'; });
  ok(Graben.siegBereit(g, S) === false, 'alle an Bord, aber noch keine Sprengung: nicht bereit');
  g.players.forEach((p) => { p.zone = 'away'; });
  Anker.ladungScharf(g, S.lp, SP, 0.3); laufe(2);
  ok(S.ziel === 'erreicht' && nachschub().length === 4, 'gesprengt');
  ok(Graben.siegBereit(g, S) === false && letzt.r.siegBereit === false, 'beide unten: nicht bereit');
  faellen(S.nachschubIds);
  am(g.players[1], 'bunker.lift.unten');   // Spieler 1 bleibt im Bunker
  padHoch(0); laufe(1);
  ok(g.players[0].zone === 'ship' && g.players[1].zone === 'away' && Graben.siegBereit(g, S) === false && letzt.r.siegBereit === false, 'Spieler 0 an Bord, Spieler 1 unten: nicht bereit');
  padHoch(1); laufe(1);
  ok(g.players.every((p) => p.zone === 'ship') && Graben.siegBereit(g, S) === true && letzt.r.siegBereit === true && letzt.r.ziel === 'erreicht', 'beide an Bord: bereit (mechanikTick { ziel erreicht, siegBereit true })');
  ok(S.ph === 'kampf' && S.ergebnis === null && !r.ev.some((e) => e[0] === 'wellenEnde'), 'die Prüfung selbst löst kein Siegbild aus (sieg() ruft der Aufrufer)');
  // Nicht verbundene Spieler zählen nicht
  g.players[1].zone = 'away'; g.players[1].connected = false;
  ok(Graben.siegBereit(g, S) === true, 'ein getrennter Spieler unten blockiert nicht');
  ok(g.arena === null && fehlerZahl(g) === 0, '(g) game.arena null, keine Fehler');
});

section('(f) fraktion: raubzug gegen rom ändert Fraktion und Palette der Gegner (auch Nachschub)', () => {
  const rom = start(2); const rz = start(2, { fraktion: 'raubzug' });
  const kat = combat.katalogDaten(rz.g).fraktionen;
  const pRom = kat.rom && kat.rom.palette, pRz = kat.raubzug && kat.raubzug.palette;
  ok(pRom && pRom !== pRz, 'Katalog: rom hat eine Palette (' + pRom + '), raubzug eine andere bzw. keine (' + pRz + ')');
  const palOk = (e, erwartet) => (erwartet ? e.palette === erwartet : e.palette == null);   // Fraktion ohne Palette: keine auf dem Gegner (nie die römische)
  const lebend = (r) => r.aw.drones.filter((e) => e.alive);
  ok(rom.S.fraktion === 'rom' && lebend(rom).length > 0 && lebend(rom).every((e) => e.fraktion === 'rom' && palOk(e, pRom)), 'Standard: alle Gegner rom, Palette rom');
  ok(rz.S.fraktion === 'raubzug' && lebend(rz).length === lebend(rom).length && lebend(rz).every((e) => e.fraktion === 'raubzug' && palOk(e, pRz) && e.palette !== pRom), 'raubzug: alle Gegner raubzug, Palette raubzug');
  ok(Object.values(rz.aw.squads).every((s) => s.fraktion === 'raubzug'), 'Trupps tragen die Fraktion');
  Graben.nachschubSenden(rz.g, rz.S);
  ok(rz.nachschub().length === 4 && rz.nachschub().every((e) => e.fraktion === 'raubzug' && palOk(e, pRz) && e.palette !== pRom), 'Nachschub: ebenfalls raubzug');
  ok(rom.g.arena === null && rz.g.arena === null && fehlerZahl(rz.g) === 0, '(g) game.arena null, keine Fehler');
});

section('texte: Textquelle S.texte statt CONFIG.graben.texte (je Schlüssel, fehlender Schlüssel fällt auf die Konfiguration zurück)', () => {
  const r = start(2, { texte: { ziel_offen: 'EIGEN offen', nachschub: 'EIGEN Nachschub {0}', zeile_ziel: 'EIGEN Zeile' } }); const { g, S, faellen, laufe, oda } = r;
  ok(/Erst die Verteidiger/.test(r.aw.ankerSperre[SP]), 'fehlender Schlüssel sperre: Konfigurationstext');
  faellen(S.ids[1]); faellen(S.ids[2]); laufe(1);
  ok(oda.includes('EIGEN offen') && Graben.zeile(g, S) === 'EIGEN Zeile', 'eigener Text beim Öffnen und in der Zielzeile');
  Graben.nachschubSenden(g, S);
  ok(oda.some((t) => /^EIGEN Nachschub/.test(t)), 'eigener Nachschub-Text');
  ok(g.arena === null && fehlerZahl(g) === 0, '(g) game.arena null, keine Fehler');
});

function letzt(r) { return r.letzt.r; }

console.log(`\n${n - fails}/${n} ok`);
if (fails) { console.log(`${fails} FEHLER`); process.exit(1); }
console.log('TEST GRABEN-MECHANIK OK');
