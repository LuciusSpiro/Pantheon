'use strict';
// AUS-01 B: Ausrüstungsstation (Konsole 'ausruestung', Transferkammer): Kachel erreichbar, Betreten/Verlassen, mehrere Spieler zugleich,
// ausruestung.slot nur an der Station (an 'transfer' abgelehnt), Stand-Ereignis nur an den Absender, Titel/Protokoll konsistent.
//   node tools/test-ausruestung.js  (npm run test:ausruestung)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Game } = require('../server/game.js');
const interior = require('../server/sim/interior.js');
const Loadout = require('../server/sim/loadout.js');
const Protocol = require('../shared/protocol.js');
const W = require('../shared/maps.js');

let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const ROOT_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-ausr-'));
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

section('Karte und Protokoll');
const ship = (W.Maps || W).ship;
const info = ship.info(13, 9);
ok(info.console === 'ausruestung' && info.interact === 'console' && info.solid === true, 'Kachel (13,9): Konsole ausruestung, solide');
ok(ship.info(13, 9).kind === 'console_ausruestung', 'Kachel-Art console_ausruestung (Optik: art.js)');
const SH = W.SHIP_ROOMS ? W.SHIP_ROOMS : (W.Maps || W).SHIP_ROOMS;
const raum = (SH || []).find((r) => r.id === 'transfer');
ok(!raum || (13 >= raum.x0 && 13 <= raum.x1 && 9 >= raum.y0 && 9 <= raum.y1), 'Kachel liegt in der Transferkammer');
let n = 0; for (let y = 0; y < ship.h; y++) for (let x = 0; x < ship.w; x++) if ((ship.info(x, y) || {}).console === 'ausruestung') n++;
ok(n === 1, 'genau eine Ausrüstungsstation an Bord (' + n + ')');
// begehbare Nachbarn, von der Tür der Transferkammer (10,8) aus erreichbar
const seen = new Set(['10,9']); const q = [[10, 9]];
while (q.length) { const [x, y] = q.shift(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = (x + dx) + ',' + (y + dy); if (!seen.has(k) && !ship.solid(x + dx, y + dy)) { seen.add(k); q.push([x + dx, y + dy]); } } }
ok(seen.has('12,9') && seen.has('13,10'), 'beide Nachbarkacheln (12,9) und (13,10) von der Tür aus begehbar erreichbar');
ok(Protocol.CONSOLES.includes('ausruestung'), 'Protocol.CONSOLES enthält ausruestung');
ok(Protocol.CMD_LOADOUT_SLOT === 'ausruestung.slot' && Protocol.CMD_AUSRUESTUNG_STAND === 'ausruestung.stand', 'Befehle ausruestung.slot / ausruestung.stand');
ok(/TITLES = \{[^}]*ausruestung: 'AUSRÜSTUNGSSTATION'/.test(read('public/js/consoles.js')), 'Titel in consoles.js');
ok(/CONSOLE_NAMES = \{[^}]*ausruestung: 'Ausrüstung'/.test(read('public/js/hud.js')), 'Name in hud.js');
ok(/console_ausruestung: \{ body/.test(read('public/js/art.js')) && /case 'console_ausruestung'/.test(read('public/js/art.js')), 'art.js zeichnet console_ausruestung');
ok(/ausruestung: 'ausruestung', finale: 'shop' \}/.test(read('server/game.js')) && !/loadout: 'transfer'/.test(read('server/game.js')), 'CMD_CONSOLE: ausruestung -> ausruestung, kein loadout-Präfix mehr (AUS-01 C)');
ok(Protocol.CMD_LOADOUT_WAFFE === undefined && !/loadout\.waffe/.test(read('server/game.js')) && !/loadout\.waffe/.test(read('public/js/consoles.js')), 'loadout.waffe entfernt (Protokoll, Server, Client)');

section('Betreten, mehrere Spieler gleichzeitig, Befehle');
const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: fs.mkdtempSync(path.join(ROOT_TMP, 'w')), seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(ROOT_TMP, 'regie') } });
const conns = [];
for (let i = 0; i < 3; i++) {
  const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'A' + i, name: 'Crew' + i, color: i });
  conns.push(c);
}
const send = (i, m) => g.handleMessage(conns[i], m);
for (let i = 0; i < 3; i++) send(i, { t: 'ready', ready: true });
for (let k = 0; k < 6; k++) g.step();
const [p0, p1, p2] = g.players;
const hin = (p, tx, ty, dir) => { p.x = tx * 32 + 16; p.y = ty * 32 + 16; p.dir = dir; p.vx = 0; p.vy = 0; };
const act = (i) => { send(i, { t: 'act', down: true }); send(i, { t: 'act', down: false }); };
const ereignisse = (i) => conns[i].inbox.filter((m) => m.kind === 'ausruestungStand');
const cmd = (i, m) => send(i, Object.assign({ t: 'cmd' }, m));
const notices = (i) => conns[i].inbox.filter((m) => m.kind === 'notice').map((m) => m.text);

ok(g.slotzahl === 2, 'Vorbedingung: 3 Spieler = 2 Slots');
hin(p0, 12, 9, 'right'); hin(p1, 13, 10, 'up'); hin(p2, 11, 11, 'right');
act(0); act(1);
ok(p0.console === 'ausruestung' && p1.console === 'ausruestung', 'zwei Spieler sitzen gleichzeitig an der Station (nicht exklusiv)');
ok(ereignisse(0).length === 1 && ereignisse(1).length === 1 && ereignisse(2).length === 0, 'Stand-Ereignis beim Betreten nur an den jeweiligen Spieler');
const e0 = ereignisse(0)[0];
ok(e0.pid === p0.id && e0.slotzahl === 2 && Array.isArray(e0.slots) && e0.slots.length === 2, 'Ereignis: Slotzahl 2, genau 2 Slots (versteckter dritter Slot nicht gesendet)');
ok(!e0.fehler, 'kein Fehler beim Betreten');
act(2);
ok(p2.console === 'transfer', 'Transfer-Konsole bleibt benutzbar (Spieler 3 an (12,11))');
// Exklusivität von transfer bleibt: ein vierter Zugriff wäre blockiert; hier: Spieler 3 sitzt, Station daneben unberührt
cmd(0, { c: 'ausruestung.slot', slot: 0, id: 'lanze' });
cmd(1, { c: 'ausruestung.slot', slot: 0, id: 'sturmgewehr' });
ok(Loadout.loadoutFuer(g, p0)[0] === 'lanze' && Loadout.loadoutFuer(g, p1)[0] === 'sturmgewehr', 'Loadout je Spieler getrennt');
const a0 = ereignisse(0), a1 = ereignisse(1);
ok(a0[a0.length - 1].slots[0] === 'lanze' && a1[a1.length - 1].slots[0] === 'sturmgewehr' && !a0[a0.length - 1].fehler, 'Antwort-Ereignis trägt das neue Loadout, jeweils nur an den Absender');
cmd(0, { c: 'ausruestung.slot', slot: 1, id: 'lanze' });
const f0 = ereignisse(0); const letzte = f0[f0.length - 1];
ok(/anderen Slot/.test(letzte.fehler || '') && letzte.slots[1] === null && notices(0).some((x) => /anderen Slot/.test(x)), 'Doppelte Waffe: Fehlertext im Ereignis und als Hinweis, Stand unverändert');
cmd(0, { c: 'ausruestung.slot', slot: 2, id: 'blaster' });
ok(/Slot gibt es/.test(ereignisse(0).slice(-1)[0].fehler || '') && Loadout.loadoutFuer(g, p0)[2] === null, 'dritter Slot bei 2 Slots abgelehnt');
cmd(0, { c: 'ausruestung.stand' });
ok(ereignisse(0).slice(-1)[0].slots[0] === 'lanze' && !ereignisse(0).slice(-1)[0].fehler, 'ausruestung.stand liefert den Stand erneut');

section('Nur an der Station');
const vorher = JSON.stringify(Loadout.loadoutFuer(g, p2));
cmd(2, { c: 'ausruestung.slot', slot: 0, id: 'granatwerfer' });
ok(JSON.stringify(Loadout.loadoutFuer(g, p2)) === vorher && notices(2).some((x) => /passenden Konsole/.test(x)), 'an der Transfer-Konsole abgelehnt, Hinweis');
cmd(2, { c: 'ausruestung.stand' });
ok(ereignisse(2).length === 0, 'ausruestung.stand an der Transfer-Konsole: keine Antwort');
const wAlt = p2.waffe;
cmd(2, { c: 'loadout.waffe', waffe: 'betaeuber' });
ok(JSON.stringify(Loadout.loadoutFuer(g, p2)) === vorher && p2.waffe === wAlt && notices(2).some((x) => /Unbekannter Befehl/.test(x)), 'loadout.waffe an der Transfer-Konsole: unbekannter Befehl, Loadout und Waffe unverändert (AUS-01 C)');
interior.konsoleVerlassen(g, p0, 'test');
ok(p0.console === null && p1.console === 'ausruestung', 'Verlassen gibt nur den eigenen Platz frei');
cmd(0, { c: 'ausruestung.slot', slot: 0, id: 'blaster' });
ok(Loadout.loadoutFuer(g, p0)[0] === 'lanze', 'nach dem Verlassen wirkt der Befehl nicht mehr');
hin(p0, 12, 9, 'right'); act(0);
ok(p0.console === 'ausruestung' && ereignisse(0).length >= 2, 'erneutes Betreten möglich, Stand wird wieder gesendet');

section('Beamen nimmt das Loadout mit (AUS-01 C)');
{
  const away = require('../server/sim/away.js');
  const gb = new Game({ noStore: true, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const cb = [];
  for (let i = 0; i < 2; i++) {
    const c = { inbox: [], send(o) { this.inbox.push(o); } };
    gb.addConnection(c); gb.handleMessage(c, { t: 'hello', clientId: 'B' + i, name: 'Beam' + i, color: i }); gb.handleMessage(c, { t: 'ready', ready: true }); cb.push(c);
  }
  for (let k = 0; k < 6; k++) gb.step();
  gb.setAwayMap('kesh');
  const [a, b] = gb.players;
  const aktiv = (p) => Loadout.aktiveWaffe(gb, p);
  const runter = (...ps) => away.executeBeam(gb, ps.map((p) => p.id), 'down');
  const hoch = (...ps) => away.executeBeam(gb, ps.map((p) => p.id), 'up');
  // an der Station gesetzt (Befehl), dann gebeamt
  a.console = 'ausruestung'; b.console = 'ausruestung';
  gb.handleMessage(cb[0], { t: 'cmd', c: 'ausruestung.slot', slot: 0, id: 'lanze' });
  gb.handleMessage(cb[0], { t: 'cmd', c: 'ausruestung.slot', slot: 1, id: 'blaster' });
  gb.handleMessage(cb[1], { t: 'cmd', c: 'ausruestung.slot', slot: 0, id: 'sturmgewehr' });
  a.console = null; b.console = null;
  runter(a);
  ok(a.zone === 'away' && a.waffe === 'lanze' && aktiv(a) === 'lanze', 'Loadout gesetzt, Beamen: aktive Waffe unten = erste Waffe (Lanze)');
  // Nachzügler beamt später allein hinunter
  runter(b);
  ok(b.zone === 'away' && b.waffe === 'sturmgewehr', 'Nachzügler: eigenes Loadout (Sturmgewehr), nicht das des anderen');
  // zurück an Bord, Loadout ändern, erneut hinunter
  hoch(a, b);
  a.console = 'ausruestung';
  gb.handleMessage(cb[0], { t: 'cmd', c: 'ausruestung.slot', slot: 0, id: 'nahkampf' });
  a.console = null;
  runter(a, b);
  ok(a.waffe === 'nahkampf' && b.waffe === 'sturmgewehr', 'Loadout an Bord geändert, erneut gebeamt: neue Waffe (Klinge), Nachzügler unverändert');
  // Rückholung (recall), Loadout leeren (Faust), wieder hinunter
  gb.support.recall = 0; gb.ship.systems.transfer = 'ok';
  ok(away.recall(gb, a.id) === null && a.zone === 'ship', 'Notrückholung bringt den Spieler an Bord');
  a.console = 'ausruestung';
  gb.handleMessage(cb[0], { t: 'cmd', c: 'ausruestung.slot', slot: 0, id: null });
  gb.handleMessage(cb[0], { t: 'cmd', c: 'ausruestung.slot', slot: 1, id: null });
  gb.handleMessage(cb[0], { t: 'cmd', c: 'ausruestung.slot', slot: 2, id: null });
  a.console = null;
  runter(a);
  ok(a.waffe === 'faust', 'nach Rückholung, Loadout ohne Waffe: Faust unten');
  // Waffe an Bord an anderer Stelle verstellt (Labor/Zelle/Debug ohne Loadout): Beamen holt wieder das Loadout
  hoch(a);
  a.console = 'ausruestung';
  gb.handleMessage(cb[0], { t: 'cmd', c: 'ausruestung.slot', slot: 0, id: 'granatwerfer' });
  a.console = null;
  require('../server/sim/waffen.js').waffeAnlegen(gb, a, 'betaeuber');
  ok(a.waffe === 'betaeuber' && aktiv(a) === 'granatwerfer', 'Vorbedingung: getragene Waffe weicht vom Loadout ab');
  runter(a);
  ok(a.waffe === 'granatwerfer', 'Beamen: aktive Waffe kommt aus dem Loadout, nicht aus der zuletzt getragenen');
}

console.log(fails ? `\n${fails} FEHLER` : '\nAUSRÜSTUNG OK');
process.exit(fails ? 1 : 0);
