'use strict';
// AUS-01 A: Loadout-Slots (server/sim/loadout.js): Slotzahl, Slots setzen, aktive Waffe, Speichern/Laden, Migration, Schema.
//   node tools/test-loadout.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Game } = require('../server/game.js');
const Weltstand = require('../server/weltstand.js');
const Waffen = require('../server/sim/waffen.js');
const Loadout = require('../server/sim/loadout.js');
const Protocol = require('../shared/protocol.js');
const CONFIG = require('../shared/config.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const ROOT_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-loadout-'));
let dirSeq = 0;
const freshDir = () => { const d = path.join(ROOT_TMP, 'w' + (++dirSeq)); fs.mkdirSync(d, { recursive: true }); return d; };

function setup(players, lobby, dir) {
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir || freshDir(), seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(ROOT_TMP, 'regie') } });
  const conns = [];
  for (let i = 0; i < players; i++) {
    const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'L' + i, name: 'Crew' + i, color: i });
    conns.push(c);
  }
  const send = (i, m) => g.handleMessage(conns[i], m);
  if (lobby) send(0, Object.assign({ t: 'lobbyOpt' }, lobby));
  const ready = () => { for (let i = 0; i < conns.length; i++) send(i, { t: 'ready', ready: true }); };
  const run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) g.step(); };
  const notices = (i) => conns[i || 0].inbox.filter((m) => m.kind === 'notice').map((m) => m.text);
  return { g, conns, send, ready, run, notices };
}
const welt = () => { const g = { C: JSON.parse(JSON.stringify(CONFIG)), time: 0, events: [], players: [] }; g.emit = (name, d) => g.events.push(Object.assign({ name }, d)); return g; };
const spieler = (id, clientId) => ({ id, clientId, name: 'Kai' });
const loadoutEreignisse = (g) => g.events.filter((e) => e.name === 'loadout');

section('Slotzahl nach Spielerzahl, fest nach startGame');
for (const [count, erwartet] of [[1, 3], [2, 3], [3, 2], [4, 2]]) {
  const t = setup(count, { startMission: 'free' });
  t.ready(); t.run(0.2);
  ok(t.g.phase === 'play' && t.g.slotzahl === erwartet && Loadout.slotzahl(t.g) === erwartet, `${count} Spieler -> ${erwartet} Slots`);
}
{
  const t = setup(2, { startMission: 'free' });
  t.ready(); t.run(0.2);
  const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  t.g.addConnection(c); t.g.handleMessage(c, { t: 'hello', clientId: 'Lx', name: 'Neu', color: 3 });
  t.run(0.2);
  ok(t.g.slotzahl === 3, '2 Spieler, Nachzügler: Slotzahl bleibt 3');
  const t2 = setup(3, { startMission: 'free' });
  t2.ready(); t2.run(0.2);
  t2.g.players[2].connected = false; t2.run(0.1);
  ok(t2.g.slotzahl === 2, '3 Spieler, einer geht: bleibt bei 2 Slots');
}
{
  const g = welt();
  g.players = [{ connected: true }, { connected: false }, { connected: false }, { connected: true }];
  ok(Loadout.slotzahlFestsetzen(g) === 3, 'nur verbundene Spieler zählen (2 von 4 -> 3 Slots)');
  ok(Loadout.slotzahl({}) === 3, 'ohne Festsetzung gilt 3 (Einzelspieler/Standard)');
}

section('Slot setzen: Prüfungen');
{
  const g = welt(); g.slotzahl = 3;
  const p = spieler('P1', 'browser-a');
  const h = Waffen.hashKennung('browser-a');
  ok(Loadout.slotSetzen(g, p, 0, 'lanze') === null && Loadout.loadoutFuer(g, p)[0] === 'lanze', 'Slot 1 auf Lanze');
  ok(Loadout.slotSetzen(g, p, 1, 'blaster') === null && Loadout.loadoutFuer(g, p)[1] === 'blaster', 'Slot 2 auf Blaster');
  ok(/Unbekannte Waffe/.test(Loadout.slotSetzen(g, p, 2, 'laserschwert')) && Loadout.loadoutFuer(g, p)[2] === null, 'ungültige Id abgelehnt');
  ok(/Unbekannte Waffe/.test(Loadout.slotSetzen(g, p, 2, 'faust')) && /Unbekannte Waffe/.test(Loadout.slotSetzen(g, p, 2, 'medipack')), 'Faust und Items nicht wählbar (noch keine Item-Ids)');
  ok([3, -1, 1.5, '1', null].every((s) => /Slot/.test(Loadout.slotSetzen(g, p, s, 'lanze'))), 'Slot außerhalb/kein Integer abgelehnt');
  ok(/anderen Slot/.test(Loadout.slotSetzen(g, p, 2, 'lanze')) && Loadout.loadoutFuer(g, p)[2] === null, 'doppelte Waffe abgelehnt');
  ok(Loadout.slotSetzen(g, p, 0, 'lanze') === null, 'dieselbe Waffe in demselben Slot ist kein Doppel');
  g.slotzahl = 2;
  ok(/Slot/.test(Loadout.slotSetzen(g, p, 2, 'nahkampf')), 'bei 2 Slots ist Slot 3 gesperrt');
  ok(Loadout.slotSetzen(g, p, 1, null) === null && Loadout.loadoutFuer(g, p)[1] === null, 'Slot leeren mit null');
  ok(Loadout.slotSetzen(g, { id: 'P2' }, 0, 'lanze') !== null, 'ohne Kennung kein Loadout');
  ok(JSON.stringify(Object.keys(Loadout.toSave(g))) === JSON.stringify([h]) && !JSON.stringify(Loadout.toSave(g)).includes('Kai'), 'Speicherschlüssel = Hash, kein Name');
}

section('Aktive Waffe');
{
  const g = welt(); g.slotzahl = 3;
  const p = spieler('P1', 'browser-b');
  ok(Waffen.waffeFuer(g, p) === 'blaster' && Loadout.aktiveWaffe(g, p) === 'blaster', 'ohne gespeichertes Loadout: Blaster');
  ok(Waffen.waffeFuer(g, { id: 'X' }) === 'blaster', 'ohne Kennung: Blaster');
  Loadout.slotSetzen(g, p, 0, null);   // Blaster-Standard bewusst leeren
  Loadout.slotSetzen(g, p, 1, 'granatwerfer');
  ok(Waffen.waffeFuer(g, p) === 'granatwerfer' && p.waffe === 'granatwerfer', 'erste belegte Waffe ist aktiv (Slot 1 leer, Slot 2 Granatwerfer)');
  Loadout.slotSetzen(g, p, 0, 'lanze');
  ok(Waffen.waffeFuer(g, p) === 'lanze' && p.waffe === 'lanze', 'Slot 1 hat Vorrang');
  const evs = loadoutEreignisse(g).length;
  Loadout.slotSetzen(g, p, 2, 'nahkampf');
  ok(Waffen.waffeFuer(g, p) === 'lanze' && loadoutEreignisse(g).length === evs, 'Änderung hinter der aktiven Waffe: kein Neusetzen, kein Ereignis');
  p.hitze = 55; p.ladung = { t: 1 };
  Loadout.slotSetzen(g, p, 0, 'blaster');
  const letztes = loadoutEreignisse(g).pop();
  ok(p.waffe === 'blaster' && p.hitze === 0 && p.ladung === null && letztes.waffe === 'blaster' && letztes.pid === 'P1', 'aktive Waffe wechselt: Hitze/Ladung zurück, Ereignis loadout { pid, waffe }');
  Loadout.slotSetzen(g, p, 0, null); Loadout.slotSetzen(g, p, 1, null); Loadout.slotSetzen(g, p, 2, null);
  ok(Waffen.waffeFuer(g, p) === 'faust' && p.waffe === 'faust', 'Loadout ohne Waffe: Faust');
  ok(Object.keys(g.crewWaffen).length === 0, 'Spiegel crew.waffen ohne Waffe leer');
  Loadout.slotSetzen(g, p, 1, 'sturmgewehr');
  ok(g.crewWaffen[Waffen.hashKennung('browser-b')] === 'sturmgewehr', 'Spiegel crew.waffen = erste Waffe');
}
{
  // alter Pfad: waffeSetzen setzt Slot 1, Tausch statt Doppel
  const g = welt(); g.slotzahl = 3;
  const p = spieler('P1', 'browser-c');
  Loadout.slotSetzen(g, p, 0, 'blaster'); Loadout.slotSetzen(g, p, 1, 'lanze');
  Waffen.waffeSetzen(g, p, 'lanze');
  ok(JSON.stringify(Loadout.loadoutFuer(g, p)) === '["lanze","blaster",null]' && p.waffe === 'lanze', 'waffeSetzen (intern): Waffe wird Slot 1, steckte sie in Slot 2 -> Tausch');
  Waffen.waffeSetzen(g, p, 'faust');
  ok(JSON.stringify(Loadout.loadoutFuer(g, p)) === '["lanze","blaster",null]' && p.waffe === 'faust', 'waffeSetzen(faust) (Zelle) verändert das Loadout nicht');
}

section('Wirksam nur die ersten N, gespeichert wird alles');
{
  const g = welt(); g.slotzahl = 3;
  const p = spieler('P1', 'browser-d');
  Loadout.slotSetzen(g, p, 0, null);   // Standardloadout (Blaster in Slot 1) bewusst leeren
  Loadout.slotSetzen(g, p, 2, 'nahkampf');
  g.slotzahl = 2;
  ok(Loadout.wirksam(g, p).length === 2 && JSON.stringify(Loadout.loadoutFuer(g, p)) === '[null,null,"nahkampf"]', 'bei 2 Slots wirksam 2, Slot 3 bleibt gespeichert');
  ok(Waffen.waffeFuer(g, p) === 'faust', 'Waffe in Slot 3 zählt bei 2 Slots nicht');
  g.slotzahl = 3;
  ok(Waffen.waffeFuer(g, p) === 'nahkampf', 'bei 3 Slots wieder wirksam');
  g.slotzahl = 2;
  ok(JSON.stringify(Loadout.toSave(g)[Waffen.hashKennung('browser-d')]) === '[null,null,"nahkampf"]', 'toSave schneidet nicht ab');
}

section('Speichern/Laden und Migration (Modul)');
{
  const g = welt(); g.slotzahl = 3;
  const p = spieler('P1', 'browser-e'); const h = Waffen.hashKennung('browser-e');
  Loadout.slotSetzen(g, p, 0, 'sturmgewehr'); Loadout.slotSetzen(g, p, 2, 'betaeuber');
  const wsave = Waffen.toSave(g), lsave = Loadout.toSave(g);
  const g2 = welt(); g2.slotzahl = 3;
  Waffen.restore(wsave, g2); Loadout.restore(lsave, g2);
  ok(JSON.stringify(Loadout.loadoutFuer(g2, p)) === '["sturmgewehr",null,"betaeuber"]' && Waffen.waffeFuer(g2, p) === 'sturmgewehr', 'toSave -> restore: gleiche Slots, gleiche aktive Waffe');
  const g3 = welt(); g3.slotzahl = 3;
  Waffen.restore({ [h]: 'lanze' }, g3); Loadout.restore({}, g3);
  ok(JSON.stringify(Loadout.loadoutFuer(g3, p)) === '["lanze",null,null]' && Waffen.waffeFuer(g3, p) === 'lanze', 'Altstand: crew.waffen = Slot 1');
  const g4 = welt(); g4.slotzahl = 3;
  Waffen.restore({ [h]: 'lanze' }, g4); Loadout.restore({ [h]: [null, 'blaster', null] }, g4);
  ok(Waffen.waffeFuer(g4, p) === 'blaster' && g4.crewWaffen[h] === 'blaster', 'crew.loadout hat Vorrang, crew.waffen wird als Spiegel neu abgeleitet');
  const g5 = welt(); g5.slotzahl = 3;
  Loadout.restore({ kaputt: ['blaster'], '0123456789ab': ['kanone', 'lanze', 'lanze', 'blaster'], fedcba987654: 'lanze' }, g5);
  ok(JSON.stringify(g5.crewLoadout) === '{"0123456789ab":[null,"lanze",null]}', 'restore: ungültige Schlüssel/Ids/Doppel/Überlänge verworfen');
  const g6 = welt(); Waffen.restore({ [h]: 'betaeuber' }, g6);
  ok(Waffen.waffeFuer(g6, p) === 'betaeuber', 'nur crewWaffen gesetzt: Fallback auf Slot 1');
  ok(Loadout.istErlaubt('lanze') && !Loadout.istErlaubt('faust') && !Loadout.istErlaubt(null) && Loadout.erlaubteIds().length === Protocol.WAFFEN_WAHL.length + 1 && Loadout.erlaubteIds().includes('scanner'), 'erlaubte Ids an einer Stelle = WAFFEN_WAHL + Item scanner (SCA-01)');
}

section('Befehl loadout.slot (Game)');
{
  const t = setup(2, { startMission: 'free' });
  t.ready(); t.run(0.2);
  const p = t.g.players[0];
  const cmd = (m) => t.send(0, Object.assign({ t: 'cmd' }, m));
  ok(Protocol.CMD_LOADOUT_SLOT === 'ausruestung.slot', 'Protokoll: CMD_LOADOUT_SLOT (AUS-01 B: ausruestung.slot)');
  p.console = null;
  cmd({ c: 'ausruestung.slot', slot: 0, id: 'lanze' });
  ok(Loadout.loadoutFuer(t.g, p)[0] === 'blaster', 'ohne Konsole nichts (Standardloadout bleibt)');
  p.console = 'transfer';
  cmd({ c: 'ausruestung.slot', slot: 0, id: 'lanze' });
  ok(Loadout.loadoutFuer(t.g, p)[0] === 'blaster', 'an der Transfer-Konsole abgelehnt (AUS-01 B)');
  p.console = 'ausruestung';
  cmd({ c: 'ausruestung.slot', slot: 0, id: 'lanze' });
  ok(Loadout.loadoutFuer(t.g, p)[0] === 'lanze' && p.waffe === 'lanze', 'an der Ausrüstungsstation: Slot gesetzt, aktive Waffe neu');
  p.console = 'transfer';
  p.console = 'ausruestung';
  cmd({ c: 'ausruestung.slot', slot: 1, id: 'lanze' });
  ok(t.notices(0).some((x) => /anderen Slot/.test(x)), 'Doppel: deutscher Hinweis');
  cmd({ c: 'ausruestung.slot', slot: 5, id: 'blaster' });
  ok(t.notices(0).some((x) => /Slot gibt es/.test(x)), 'Slot außerhalb: Hinweis');
  cmd({ c: 'ausruestung.slot', slot: 1, id: 'laserschwert' });
  ok(t.notices(0).filter((x) => /Unbekannte Waffe/.test(x)).length === 1, 'unbekannte Id: Hinweis');
  cmd({ c: 'ausruestung.slot', slot: 1, id: 'nahkampf' });
  const vorher = JSON.stringify(Loadout.loadoutFuer(t.g, p));
  p.console = 'transfer';
  cmd({ c: 'loadout.waffe', waffe: 'nahkampf' });
  ok(JSON.stringify(Loadout.loadoutFuer(t.g, p)) === vorher && t.notices(0).some((x) => /Unbekannter Befehl/.test(x)), 'alter Befehl loadout.waffe entfallen (AUS-01 C): Loadout unverändert, unbekannter Befehl');
}

section('Doppelprüfung nur über wirksame Slots');
{
  const g = welt(); g.slotzahl = 2;
  const p = spieler('P1', 'browser-d');
  const h = Waffen.hashKennung('browser-d');
  g.crewLoadout = { [h]: ['blaster', 'sturmgewehr', 'lanze'] };
  ok(Loadout.slotSetzen(g, p, 0, 'lanze') === null, 'Slotzahl 2, Lanze nur in verstecktem Slot 3: Slot 1 darf Lanze nehmen');
  ok(JSON.stringify(Loadout.loadoutFuer(g, p)) === '["lanze","sturmgewehr",null]', 'versteckter Slot 3 stillschweigend geleert, Lanze nie doppelt');
  g.crewLoadout[h] = ['blaster', 'sturmgewehr', 'lanze'];
  ok(Loadout.slotSetzen(g, p, 1, 'lanze') === null && JSON.stringify(Loadout.loadoutFuer(g, p)) === '["blaster","lanze",null]', 'Slot 2 auf Lanze: ebenfalls erlaubt, Slot 3 geleert');
  ok(/anderen Slot/.test(Loadout.slotSetzen(g, p, 0, 'lanze')) && JSON.stringify(Loadout.loadoutFuer(g, p)) === '["blaster","lanze",null]', 'Doppelung unter wirksamen Slots bleibt abgelehnt (nichts verändert)');
  g.crewLoadout[h] = ['blaster', null, 'lanze'];
  ok(/anderen Slot/.test(Loadout.slotSetzen(g, p, 1, 'blaster')) && Loadout.loadoutFuer(g, p)[2] === 'lanze', 'abgelehnte Doppelung lässt versteckten Slot unberührt');
  ok(Loadout.slotSetzen(g, p, 1, null) === null && Loadout.loadoutFuer(g, p)[2] === 'lanze', 'Leeren eines wirksamen Slots rührt versteckten Slot nicht an');
  const g3 = welt(); g3.slotzahl = 3;
  g3.crewLoadout = { [h]: ['blaster', 'sturmgewehr', 'lanze'] };
  ok(/anderen Slot/.test(Loadout.slotSetzen(g3, p, 0, 'lanze')) && /anderen Slot/.test(Loadout.slotSetzen(g3, p, 1, 'lanze')), 'Slotzahl 3: Doppelung über alle 3 Slots abgelehnt wie bisher');
  ok(JSON.stringify(Loadout.loadoutFuer(g3, p)) === '["blaster","sturmgewehr","lanze"]', 'Slotzahl 3: Speicher unverändert');
}

section('Weltstand: capture/restore, Migration, Schema');
{
  const dir = freshDir();
  const t = setup(2, { startMission: 'free' }, dir);
  t.ready(); t.run(0.2);
  const p = t.g.players[0]; const h = Waffen.hashKennung(p.clientId);
  p.console = 'ausruestung';
  t.send(0, { t: 'cmd', c: 'ausruestung.slot', slot: 0, id: 'sturmgewehr' });
  t.send(0, { t: 'cmd', c: 'ausruestung.slot', slot: 2, id: 'betaeuber' });
  const cap = Weltstand.capture(t.g);
  ok(cap.version === 3 && JSON.stringify(cap.crew.loadout[h]) === '["sturmgewehr",null,"betaeuber"]' && cap.crew.waffen[h] === 'sturmgewehr', 'capture: Version bleibt 3, crew.loadout und Spiegel crew.waffen');
  const fehler = Weltstand.validate(cap);
  ok(fehler.length === 0, 'capture schemagültig' + fehler.slice(0, 2).map((x) => ' – ' + x).join(''));
  ok(!JSON.stringify(cap).includes('slotzahl'), 'Slotzahl nicht im Weltstand');
  const id = t.g.weltstand.id;
  t.send(0, { t: 'menu', op: 'end' });

  const t2 = setup(2, { world: id }, dir);
  t2.ready(); t2.run(0.2);
  const q = t2.g.players[0];
  ok(JSON.stringify(Loadout.loadoutFuer(t2.g, q)) === '["sturmgewehr",null,"betaeuber"]' && Waffen.waffeFuer(t2.g, q) === 'sturmgewehr', 'Fortsetzen: Loadout wiederhergestellt');
  ok(t2.g.slotzahl === 3, 'Fortsetzen: Slotzahl in startGame festgesetzt');
  t2.send(0, { t: 'menu', op: 'end' });

  const alt = JSON.parse(JSON.stringify(cap)); alt.id = 'w-loadout-alt'; delete alt.crew.loadout; alt.crew.waffen = { [h]: 'lanze' };
  ok(Weltstand.validate(alt).length === 0, 'Altstand ohne crew.loadout schemagültig');
  fs.writeFileSync(path.join(dir, alt.id + '.json'), JSON.stringify(alt));
  const t3 = setup(3, { world: alt.id }, dir);
  t3.ready(); t3.run(0.2);
  const p3 = t3.g.players[0];
  ok(JSON.stringify(Loadout.loadoutFuer(t3.g, p3)) === '["lanze",null,null]' && Waffen.waffeFuer(t3.g, p3) === 'lanze', 'Altstand: crew.waffen gilt als Slot 1');
  ok(t3.g.slotzahl === 2, 'Fortsetzen mit 3 Spielern: 2 Slots');
  const cap3 = Weltstand.capture(t3.g);
  ok(JSON.stringify(cap3.crew.loadout[h]) === '["lanze",null,null]' && Weltstand.validate(cap3).length === 0, 'nächster Save schreibt das migrierte Loadout, schemagültig');
  t3.send(0, { t: 'menu', op: 'end' });

  const mut = (f) => { const d = JSON.parse(JSON.stringify(cap)); f(d); return Weltstand.validate(d).length; };
  ok(mut(() => {}) === 0, 'Schema: gültiger Block');
  ok(mut((d) => { d.crew.loadout = { Kai: ['lanze'] }; }) > 0, 'Schema: Schlüssel nur als Hash');
  ok(mut((d) => { d.crew.loadout[h] = ['a', 'b', 'c', 'd']; }) > 0, 'Schema: höchstens 3 Slots');
  ok(mut((d) => { d.crew.loadout[h] = [1, null]; }) > 0, 'Schema: Einträge string oder null');
  ok(mut((d) => { d.crew.loadout[h] = 'lanze'; }) > 0, 'Schema: Wert ist ein Array');
  ok(mut((d) => { d.crew.loadout[h] = [null, null, null]; }) === 0, 'Schema: leere Slots (null) gültig');
}
{
  const t = setup(1, { startMission: 'free' });
  t.ready(); t.run(0.2);
  const cap = Weltstand.capture(t.g);
  ok(JSON.stringify(cap.crew) === '{"waffen":{},"rollen_gesehen":[]}', 'neue Kampagne: kein crew.loadout (additiv, Altform bleibt)');
  t.send(0, { t: 'menu', op: 'end' });
}

section('Standardloadout: Spieler ohne gespeichertes Loadout trägt den Blaster in Slot 1 (AUS-01 Nacharbeit)');
{
  const g = welt(); g.slotzahl = 3;
  const p = spieler('P1', 'browser-neu');
  ok(JSON.stringify(Loadout.loadoutFuer(g, p)) === '["blaster",null,null]' && JSON.stringify(Loadout.wirksam(g, p)) === '["blaster",null,null]', 'loadoutFuer/wirksam ohne Eintrag: [blaster, null, null]');
  ok(Loadout.aktiveWaffe(g, p) === 'blaster', 'aktive Waffe passt zum angezeigten Stand: Blaster');
  g.slotzahl = 2;
  ok(JSON.stringify(Loadout.wirksam(g, p)) === '["blaster",null]', 'bei 2 Slots: [blaster, null]');
  ok(Object.keys(g.crewLoadout || {}).length === 0, 'Lesen legt keinen Eintrag an');
  Loadout.slotSetzen(g, p, 1, 'lanze');
  ok(JSON.stringify(Loadout.loadoutFuer(g, p)) === '["blaster","lanze",null]' && Loadout.aktiveWaffe(g, p) === 'blaster', 'Slot 2 füllen behält den Blaster in Slot 1 (Standard wird zur Basis)');
  const q = spieler('P2', 'browser-leer');
  Loadout.slotSetzen(g, q, 0, null);
  ok(JSON.stringify(Loadout.loadoutFuer(g, q)) === '[null,null,null]' && Loadout.aktiveWaffe(g, q) === 'faust' && q.waffe === 'faust', 'Slot 1 leeren (Standard -> leer): Fäuste');
}
{
  const dir = freshDir();
  const t = setup(2, { startMission: 'free' }, dir);
  t.ready(); t.run(0.2);
  const p = t.g.players[0]; const h = Waffen.hashKennung(p.clientId);
  const staende = () => t.conns[0].inbox.filter((m) => m.kind === 'ausruestungStand');
  p.console = 'ausruestung';
  t.send(0, { t: 'cmd', c: 'ausruestung.stand' });
  const e = staende().pop();
  ok(e && JSON.stringify(e.slots) === '["blaster",null,null]', 'neuer Spieler öffnet die Station: Stand [blaster, null, null]');
  const cap = Weltstand.capture(t.g);
  ok(!(cap.crew.loadout && h in cap.crew.loadout) && !(h in (cap.crew.waffen || {})), 'ausruestung.stand allein erzeugt keinen Weltstand-Eintrag');
  t.send(0, { t: 'cmd', c: 'ausruestung.slot', slot: 0, id: null });
  ok(JSON.stringify(staende().pop().slots) === '[null,null,null]' && p.waffe === 'faust', 'Leeren von Slot 1: Stand leer, Waffe Fäuste');
  const cap2 = Weltstand.capture(t.g);
  ok(JSON.stringify(cap2.crew.loadout[h]) === '[null,null,null]' && Weltstand.validate(cap2).length === 0, 'erst die Änderung erzeugt den Eintrag (bewusst leer), schemagültig');
  t.send(0, { t: 'menu', op: 'end' });
}

section('restore: ungültige Ids (entfernte Waffe) (AUS-01 Nacharbeit)');
{
  const p = spieler('P1', 'browser-r'); const h = Waffen.hashKennung('browser-r');
  const mit = (e) => { const g = welt(); g.slotzahl = 3; Loadout.restore({ [h]: e }, g); return g; };
  let g = mit(['plasmakanone', null, null]);
  ok(!(h in g.crewLoadout) && JSON.stringify(Loadout.loadoutFuer(g, p)) === '["blaster",null,null]' && Loadout.aktiveWaffe(g, p) === 'blaster', 'nur ungültige Id: Eintrag verworfen, Standard (Blaster)');
  g = mit([null, null, null]);
  ok(JSON.stringify(g.crewLoadout[h]) === '[null,null,null]' && Loadout.aktiveWaffe(g, p) === 'faust', 'bewusst leeres Loadout bleibt leer: Fäuste');
  g = mit(['plasmakanone', 'lanze', null]);
  ok(JSON.stringify(g.crewLoadout[h]) === '[null,"lanze",null]' && Loadout.aktiveWaffe(g, p) === 'lanze', 'gemischt: ungültige Id entfernt, Lanze bleibt in Slot 2');
  g = mit(['faust', 42, 'x']);
  ok(!(h in g.crewLoadout), 'mehrere ungültige Ids, keine gültige: verworfen');
}

section('Fortsetzen: 3 belegte Slots in einer Partie mit 2 Slots (AUS-01 Nacharbeit)');
{
  const away = require('../server/sim/away.js');
  const dir = freshDir();
  const t = setup(2, { startMission: 'free' }, dir);
  t.ready(); t.run(0.2);
  const h = Waffen.hashKennung(t.g.players[0].clientId);
  t.g.players[0].console = 'ausruestung';
  ['sturmgewehr', 'lanze', 'betaeuber'].forEach((id, slot) => t.send(0, { t: 'cmd', c: 'ausruestung.slot', slot, id }));
  const id1 = t.g.weltstand.id;
  t.send(0, { t: 'menu', op: 'end' });

  const t2 = setup(3, { world: id1 }, dir);
  t2.ready(); t2.run(0.2);
  const p = t2.g.players[0];
  ok(t2.g.slotzahl === 2 && JSON.stringify(Loadout.loadoutFuer(t2.g, p)) === '["sturmgewehr","lanze","betaeuber"]', 'Fortsetzen mit 3 Spielern: 2 Slots, alle 3 Einträge noch gespeichert');
  p.console = 'ausruestung';
  t2.conns[0].inbox.length = 0;
  t2.send(0, { t: 'cmd', c: 'ausruestung.stand' });
  const e = t2.conns[0].inbox.filter((m) => m.kind === 'ausruestungStand').pop();
  ok(e && e.slotzahl === 2 && JSON.stringify(e.slots) === '["sturmgewehr","lanze"]', 'Station: Slot 3 unsichtbar');
  p.console = null;
  t2.g.setAwayMap('kesh');
  away.executeBeam(t2.g, [p.id], 'down');
  ok(p.zone === 'away' && p.waffe === 'sturmgewehr', 'nach dem Beamen: aktive Waffe = Slot 1 (Sturmgewehr)');
  const cap = Weltstand.capture(t2.g);
  ok(JSON.stringify(cap.crew.loadout[h]) === '["sturmgewehr","lanze","betaeuber"]', 'Speichern in der 2er-Partie schneidet den dritten Slot nicht ab');
  const id2 = t2.g.weltstand.id;
  t2.send(0, { t: 'menu', op: 'end' });

  const t3 = setup(2, { world: id2 }, dir);
  t3.ready(); t3.run(0.2);
  const p3 = t3.g.players[0];
  p3.console = 'ausruestung';
  t3.send(0, { t: 'cmd', c: 'ausruestung.stand' });
  const e3 = t3.conns[0].inbox.filter((m) => m.kind === 'ausruestungStand').pop();
  ok(t3.g.slotzahl === 3 && e3 && JSON.stringify(e3.slots) === '["sturmgewehr","lanze","betaeuber"]', 'spätere 2er-Partie: wieder 3 Slots, Slot 3 sichtbar');
  t3.send(0, { t: 'menu', op: 'end' });
}

section('Nachzügler mit eigenem gespeicherten Loadout bekommt nach dem Beamen seine Waffe (AUS-01 Nacharbeit)');
{
  const away = require('../server/sim/away.js');
  const dir = freshDir();
  const t = setup(2, { startMission: 'free' }, dir);   // L0, L1
  t.ready(); t.run(0.2);
  t.g.players[1].console = 'ausruestung';
  t.send(1, { t: 'cmd', c: 'ausruestung.slot', slot: 0, id: 'granatwerfer' });
  const id1 = t.g.weltstand.id;
  t.send(0, { t: 'menu', op: 'end' });

  const t2 = setup(1, { world: id1 }, dir);   // nur L0 beim Start
  t2.ready(); t2.run(0.2);
  const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  t2.g.addConnection(c); t2.g.handleMessage(c, { t: 'hello', clientId: 'L1', name: 'Spaet', color: 1 });
  t2.run(0.2);
  const n = t2.g.players.find((x) => x.clientId === 'L1');
  ok(!!n && t2.g.slotzahl === 3, 'Nachzügler L1 ist in der laufenden Partie');
  t2.g.setAwayMap('kesh');
  away.executeBeam(t2.g, [n.id], 'down');
  ok(n.zone === 'away' && n.waffe === 'granatwerfer' && Waffen.waffeFuer(t2.g, n) === 'granatwerfer', 'Nachzügler beamt hinunter: Granatwerfer aus seinem gespeicherten Loadout');
  t2.send(0, { t: 'menu', op: 'end' });
}

section('Übernahme eines freien Platzes am Boden (AUS-01 Nacharbeit)');
{
  const away = require('../server/sim/away.js');
  const t = setup(4, { startMission: 'free' });
  t.ready(); t.run(0.2);
  const vor = t.g.players[3];
  vor.console = 'ausruestung';
  t.send(3, { t: 'cmd', c: 'ausruestung.slot', slot: 0, id: 'lanze' });
  vor.console = null;
  t.g.setAwayMap('kesh');
  away.executeBeam(t.g, [vor.id], 'down');
  ok(vor.zone === 'away' && vor.waffe === 'lanze', 'Vorbesitzer am Boden mit Lanze');
  vor.connected = false; vor.conn = null;
  const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  t.g.addConnection(c);
  t.g.handleMessage(c, { t: 'hello', clientId: 'Neuling', name: 'Neu', color: 2 });
  ok(t.g.players.length === 4 && vor.clientId === 'Neuling' && vor.zone === 'away', 'Neuer übernimmt den freien Platz am Boden');
  const st = c.inbox.filter((m) => m.kind === 'ausruestungStand');
  ok(st.length === 1 && st[0].pid === vor.id && JSON.stringify(st[0].slots) === '["blaster",null]', 'Stand des Neuen gesendet (4 Spieler = 2 Slots, Standardloadout)');
  ok(vor.waffe === 'blaster' && Waffen.waffeFuer(t.g, vor) === 'blaster', 'Waffe = Loadout des Neuen (nicht die Lanze des Vorbesitzers)');
}

console.log(`\n${n - fails}/${n} ok` + (fails ? `, ${fails} FEHLER` : ''));
try { fs.rmSync(ROOT_TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
process.exit(fails ? 1 : 0);
