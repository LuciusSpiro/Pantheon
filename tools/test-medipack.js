'use strict';
// ITM-01 A: Medipack als Slot-Item mit Ladungen (server/sim/medipack.js). Echtes Spiel (Game, Außenkarte kesh, Kampf v2), nur Server.
// Geprüft: Standardloadout mit Medipack, Vergabe nur an Träger (wirksames Loadout) mit N Ladungen aus dem Lager, Revive-Zeit/Segmente Träger vs. Nichtträger,
// eine Ladung je Revive, Rückgabe (voller Pack bzw. Rest als medipackCharges, lazy), angebrochener Rest zuerst, Lager leer, Bruchteil-Bestand, 1–4 Spieler (Slotzahl),
// Taste im Slot (nur Anzeige), Aufheben/Nachschub, NSC-Heilen, Snapshot, Weltstand-Roundtrip.
//   node tools/test-medipack.js   (npm run test:medipack)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Game } = require('../server/game.js');
const interior = require('../server/sim/interior.js');
const Loadout = require('../server/sim/loadout.js');
const combat = require('../server/sim/combat.js');
const Medipack = require('../server/sim/medipack.js');
const Vorrat = require('../server/sim/vorrat.js');
const Away = require('../server/sim/away.js');
const Weltstand = require('../server/weltstand.js');
const Registry = require('../server/mission/registry.js');
const Physics = require('../shared/physics.js');
const Protocol = require('../shared/protocol.js');
const CONFIG = require('../shared/config.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const N = CONFIG.medipack.ladungen;
const AC = CONFIG.awayCombat;
const ROOT_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-medipack-'));
let dirSeq = 0;
const freshDir = () => { const d = path.join(ROOT_TMP, 'w' + (++dirSeq)); fs.mkdirSync(d, { recursive: true }); return d; };

// Szene: `anzahl` Spieler (clientId M0..), Lager `lager` Packs; slots(i) -> Loadout-Slots des Spielers i (undefined = Standardloadout).
// Alle sind an Bord; hinunter geht es mit S.runter(i) (Karte kesh = Kampf v2, ruft combat.onArrive wie das echte Beamen).
function szene(anzahl, opts) {
  const o = opts || {};
  const g = new Game({ noStore: true, seed: 11, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const cs = Array.from({ length: anzahl }, () => ({ inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } }));
  for (const [i, c] of cs.entries()) { g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'M' + i, name: 'Med' + i, color: i }); }
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  for (let k = 0; k < 6; k++) g.step();
  g.ship.module = g.ship.module.filter((m) => m.id !== 'krankenstation');   // wie test-combat: die alte Regel (kein Ausbluten-Umbau)
  if (o.lager != null) Vorrat.standSetzen(g, 'medipack', o.lager, 'debug');
  if (o.slots) for (const [i, p] of g.players.entries()) { const s = o.slots(i); if (s) for (let k = 0; k < Math.min(s.length, g.slotzahl); k++) { const e = Loadout.slotSetzen(g, p, k, s[k]); if (e) throw new Error('slotSetzen ' + e); } }
  g.setAwayMap('kesh');
  g.aways.kesh.active = true;
  const S = { g, cs, P: (i) => g.players[i] };
  S.runter = (i) => interior.placeOnAwayPad(g, g.players[i], i);
  S.hoch = (i) => interior.placeOnShipPad(g, g.players[i], i);
  S.lauf = (sek) => { for (let k = 0; k < Math.round(sek * CONFIG.tickHz); k++) { g.away.drones.length = 0; g.step(); } };
  S.platz = (i, tx, ty, dir) => { const p = g.players[i]; const c = Physics.tileCenter(tx, ty); p.x = c.x; p.y = c.y; p.dir = dir || 'down'; p.input.mx = 0; p.input.my = 0; };
  S.cmd = (i, c, extra) => g.handleMessage(cs[i], Object.assign({ t: 'cmd', c }, extra || {}));
  S.notices = (i) => cs[i].inbox.filter((m) => m.t === 'event' && m.kind === 'notice').map((m) => m.text);
  // Helfer h belebt Spieler z wieder (nebeneinander); -> { dur (Haltezeit), seg (Segmente danach), da (z steht wieder) }
  S.revive = (h, z) => {
    S.platz(h, 4, 18, 'right'); S.platz(z, 5, 18);
    combat.woundPlayer(g, g.players[z], 'test');
    g.handleMessage(cs[h], { t: 'act', down: true });
    const dur = g.players[h].hold ? g.players[h].hold.dur : null;
    S.lauf((dur || 4) + 0.3);
    g.handleMessage(cs[h], { t: 'act', down: false });
    return { dur, seg: g.players[z].shield ? g.players[z].shield.seg : null, da: !g.players[z].downed };
  };
  return S;
}
section('Konfiguration, Registry, Standardloadout');
ok(Number.isInteger(N) && N >= 2, 'config medipack.ladungen: ganze Zahl >= 2 (' + N + ')');
ok(CONFIG.economy.startInventory.medipack === 2, 'Startbestand Lager bleibt 2 Packs');
ok(Loadout.istErlaubt('medipack') && Loadout.erlaubteIds().includes('medipack'), 'Registry: medipack ist in einen Slot erlaubt');
ok(Vorrat.GUETER.includes('medipackCharges') && Vorrat.GRUENDE.includes('medkit'), 'Vorrat kennt das Gut medipackCharges und den Grund medkit');
{
  const S = szene(1);
  ok(JSON.stringify(Loadout.loadoutFuer(S.g, S.P(0))) === '["blaster","medipack",null]', 'Standardloadout: [blaster, medipack, leer]');
  ok(Loadout.aktiveWaffe(S.g, S.P(0)) === 'blaster', 'aktive Waffe im Standardloadout bleibt der Blaster');
  S.g.slotzahl = 2;
  ok(JSON.stringify(Loadout.wirksam(S.g, S.P(0))) === '["blaster","medipack"]', 'bei 2 wirksamen Slots: [blaster, medipack]');
  ok(Medipack.traegt(S.g, S.P(0)), 'Standardspieler trägt das Medipack');
}

section('Vergabe beim Herunterbeamen: nur Träger, N Ladungen, ein Pack aus dem Lager');
{
  const S = szene(2, { slots: (i) => (i === 1 ? ['blaster', null, null] : undefined) });
  const p0 = S.P(0), p1 = S.P(1);
  ok(p0.zone === 'ship' && p0.medkit === 0 && S.g.inventory.medipack === 2, 'vorher: an Bord, kein Medipack am Mann, Lager 2');
  S.runter(0); S.runter(1);
  ok(p0.zone === 'away' && p0.medkit === N, 'Träger: ' + N + ' Ladungen');
  ok(p1.medkit === 0 && !Medipack.traegt(S.g, p1), 'Nichtträger (Medipack aus dem Loadout genommen): kein Kit');
  ok(S.g.inventory.medipack === 1, 'genau ein Pack aus dem Lager genommen (2 -> 1)');
  ok(!('medipackCharges' in S.g.inventory), 'lazy: ohne Rest kein Konto medipackCharges');
  const sn = S.g.snapshot().players;
  ok(sn[0].medkit === N && !('medkit' in sn[1]), 'Snapshot: Träger medkit = ' + N + ', Nichtträger ohne Feld (Standardwert 0 fällt weg)');
}

section('Revive: Zeit und Segmente Träger vs. Nichtträger, eine Ladung je Revive');
{
  const S = szene(3, { slots: (i) => (i === 1 ? ['blaster', null, null] : undefined) });
  for (let i = 0; i < 3; i++) S.runter(i);
  const lagerVor = S.g.inventory.medipack;
  // Nichtträger (1) belebt Träger (2): 4 s, 1 Segment, nichts verbraucht
  let r = S.revive(1, 2);
  ok(r.dur === AC.wounded.reviveTime && r.da && r.seg === AC.wounded.reviveSegments, 'Nichtträger: ' + AC.wounded.reviveTime + ' s, ' + AC.wounded.reviveSegments + ' Segment (dur ' + r.dur + ', seg ' + r.seg + ')');
  ok(S.P(1).medkit === 0 && S.P(2).medkit === N && S.g.inventory.medipack === lagerVor, 'Nichtträger belebt: keine Ladung verbraucht, Lager unverändert');
  // Träger (0) belebt (1): schnell, 2 Segmente, eine Ladung weg
  for (let k = 1; k <= N; k++) {
    r = S.revive(0, 1);
    ok(r.dur === AC.wounded.medkitReviveTime && r.da && r.seg === AC.wounded.medkitSegments && S.P(0).medkit === N - k,
      'Träger, Revive ' + k + ': ' + AC.wounded.medkitReviveTime + ' s, ' + AC.wounded.medkitSegments + ' Segmente, Rest ' + (N - k) + ' (dur ' + r.dur + ', seg ' + r.seg + ', medkit ' + S.P(0).medkit + ')');
  }
  r = S.revive(0, 1);
  ok(r.dur === AC.wounded.reviveTime && r.da && r.seg === AC.wounded.reviveSegments && S.P(0).medkit === 0, 'ohne Ladung: wie Nichtträger (' + AC.wounded.reviveTime + ' s, ' + AC.wounded.reviveSegments + ' Segment), Zähler bleibt 0');
  // Verbrauch erst beim Vollenden: Abbruch kostet nichts
  S.P(2).medkit = 2;
  S.platz(2, 4, 18, 'right'); S.platz(0, 5, 18);
  combat.woundPlayer(S.g, S.P(0), 'test');
  S.g.handleMessage(S.cs[2], { t: 'act', down: true }); S.lauf(0.5); S.g.handleMessage(S.cs[2], { t: 'act', down: false });
  ok(S.P(0).downed && S.P(2).medkit === 2, 'Abbruch vor dem Ende: keine Ladung verbraucht, Ziel liegt noch');
}

section('Rückgabe beim Hochbeamen: voller Pack bzw. Rest');
{
  const S = szene(2);
  S.runter(0); S.runter(1);
  const lager = S.g.inventory.medipack;   // 2 Packs, beide Spieler tragen je einen? nur 2 vorhanden -> 0
  ok(lager === 0 && S.P(0).medkit === N && S.P(1).medkit === N, 'zwei Träger leeren das Lager (2 Packs)');
  S.hoch(0);
  ok(S.P(0).medkit === 0 && S.g.inventory.medipack === 1 && !('medipackCharges' in S.g.inventory), 'unbenutzt (N Ladungen): ganzer Pack zurück, kein Rest-Konto');
}
{
  const Haken = require('../server/telemetrie/haken.js');
  const orig = Haken.buchung; const gebucht = [];
  Haken.buchung = (game, gut, art, grund, betrag, stand) => { gebucht.push({ gut, art, grund, betrag, stand }); return orig(game, gut, art, grund, betrag, stand); };
  const S = szene(2);
  S.runter(0); S.runter(1);
  S.revive(0, 1);   // eine Ladung verbraucht
  ok(S.P(0).medkit === N - 1, 'eine Ladung verbraucht');
  const vor = S.g.inventory.medipack;
  S.hoch(0);
  ok(S.P(0).medkit === 0 && S.g.inventory.medipack === vor && S.g.inventory.medipackCharges === N - 1, 'Teilmenge: kein Pack, Rest ' + (N - 1) + ' als medipackCharges');
  const bu = gebucht.filter((x) => x.gut === 'medipackCharges');
  ok(bu.length === 1 && bu[0].betrag === N - 1 && bu[0].stand === N - 1 && bu[0].grund === 'medkit', 'Protokoll: erste Rest-Buchung mit Betrag ' + (N - 1) + ' (nicht NaN), Grund medkit (' + JSON.stringify(bu[0]) + ')');
  // angebrochener Rest wird zuerst genommen
  Vorrat.standSetzen(S.g, 'medipack', 1, 'debug');
  S.runter(0);
  ok(S.P(0).medkit === N - 1 && S.g.inventory.medipackCharges === 0 && S.g.inventory.medipack === 1, 'Rest zuerst: ' + (N - 1) + ' Ladungen, Rest-Konto leer, Pack bleibt im Lager');
  S.hoch(0);
  ok(S.g.inventory.medipackCharges === N - 1 && S.g.inventory.medipack === 1, 'wieder hoch: derselbe Rest, kein Pack dazu oder weg (keine Verdopplung)');
  // Rest größer als ein Pack: Überschuss bleibt im Lager
  Vorrat.standSetzen(S.g, 'medipackCharges', N + 2, 'debug');
  S.runter(0);
  ok(S.P(0).medkit === N && S.g.inventory.medipackCharges === 2, 'Rest über N: ein Pack voll, Überschuss bleibt');
  S.hoch(0);
  Haken.buchung = orig;
}
{
  // alle Ladungen verbraucht: Hochbeamen bucht nichts
  const S = szene(2);
  S.runter(0); S.runter(1);
  for (let k = 0; k < N; k++) S.revive(0, 1);
  ok(S.P(0).medkit === 0, 'alle Ladungen verbraucht');
  const vor = JSON.stringify(S.g.inventory);
  S.hoch(0);
  ok(JSON.stringify(S.g.inventory) === vor, 'Hochbeamen mit 0 Ladungen: nichts gebucht');
}
{
  // Verbindungsabbruch/Rückholung eines Trägers: Ladungen gehen nicht verloren und nicht doppelt zurück
  const S = szene(2);
  S.runter(0); S.runter(1);
  S.revive(0, 1);
  const lager = S.g.inventory.medipack, rest = S.P(0).medkit;
  S.hoch(0); S.hoch(0);   // zweimal verlassen: das zweite Mal ist ein No-op
  ok(S.g.inventory.medipack === lager && S.g.inventory.medipackCharges === rest, 'doppeltes Verlassen: Rest genau einmal zurückgebucht');
  const lager2 = S.g.inventory.medipack;
  combat.onLeave(S.g, S.P(1));
  ok(S.g.inventory.medipack === lager2 + 1 && S.P(1).medkit === 0, 'combat.onLeave (Rückholung/Trennung): voller Pack zurück');
}

{
  // mehr Ladungen am Mann als ein Pack fasst (config unterwegs gesenkt): ganze Packs plus Rest
  const S = szene(1, { lager: 0 });
  S.runter(0);
  S.P(0).medkit = N + 1;
  S.hoch(0);
  ok(S.g.inventory.medipack === 1 && S.g.inventory.medipackCharges === 1, 'N+1 Ladungen zurück: ein Pack und 1 Rest (kein doppelter Rest)');
  // veralteter Zähler beim Ankommen (ohne Verlassen) wird nicht mitgenommen
  S.g.inventory.medipack = 0; S.g.inventory.medipackCharges = 0;
  S.P(0).medkit = 2;
  Medipack.ausgeben(S.g, S.P(0));
  ok(S.P(0).medkit === 0, 'Lager leer: ein veralteter Zähler wird auf 0 gesetzt');
  Loadout.slotSetzen(S.g, S.P(0), 1, null);
  S.P(0).medkit = 2;
  Medipack.ausgeben(S.g, S.P(0));
  ok(S.P(0).medkit === 0, 'Nichtträger: ein veralteter Zähler wird auf 0 gesetzt');
}

section('Lager leer, Bruchteil-Bestand');
{
  const S = szene(1, { lager: 0 });
  S.runter(0);
  ok(S.P(0).medkit === 0 && S.g.inventory.medipack === 0, 'Lager leer: 0 Ladungen, Bestand bleibt 0');
  ok(S.notices(0).some((t) => /Medipack/.test(t) && /Lager/.test(t)), 'Lager leer: Hinweis an den Spieler (' + S.notices(0).join(' | ') + ')');
}
{
  const S = szene(1, { lager: 0 });
  S.g.inventory.medipack = 0.5;   // wie test-buchungen: Bruchteil-Bestand bucht unbedingt ab (verbrauchen, nicht entnehmen)
  S.runter(0);
  ok(S.g.inventory.medipack === -0.5 && S.P(0).medkit === N, 'Bestand 0,5: -0,5 und ' + N + ' Ladungen (wie früher ein Medipack)');
  S.hoch(0);
  S.g.inventory.medipack = 1.5;
  S.runter(0);
  ok(S.g.inventory.medipack === 0.5 && S.P(0).medkit === N, 'Bestand 1,5: 0,5');
}

section('1 bis 4 Spieler: Slotzahl und Verteilung');
for (const [anzahl, slots] of [[1, 3], [2, 3], [3, 2], [4, 2]]) {
  const S = szene(anzahl);
  ok(S.g.slotzahl === slots && S.g.players.every((p) => Medipack.traegt(S.g, p)), anzahl + ' Spieler: ' + slots + ' Slots, Standardloadout trägt überall das Medipack');
  for (let i = 0; i < anzahl; i++) S.runter(i);
  const mit = S.g.players.filter((p) => p.medkit === N).length;
  const ohne = S.g.players.filter((p) => p.medkit === 0).length;
  ok(mit === Math.min(anzahl, 2) && mit + ohne === anzahl && S.g.inventory.medipack === Math.max(0, 2 - anzahl), anzahl + ' Spieler, 2 Packs: ' + mit + ' Träger mit Kit, ' + ohne + ' ohne');
  if (anzahl > 2) ok(S.notices(anzahl - 1).some((t) => /Lager/.test(t)), anzahl + ' Spieler: wer leer ausgeht, bekommt einen Hinweis');
}
{
  // Medipack im dritten Slot zählt bei 2 Slots (ab 3 Spielern) nicht, bei 3 Slots schon
  const S4 = szene(4, { slots: () => ['blaster', 'sturmgewehr', null] });
  const p = S4.P(0);
  Loadout.slotSetzen(S4.g, p, 1, null);   // Slot 2 frei
  S4.g.slotzahl = 3; Loadout.slotSetzen(S4.g, p, 2, 'medipack'); S4.g.slotzahl = 2;
  ok(JSON.stringify(Loadout.loadoutFuer(S4.g, p)) === '["blaster",null,"medipack"]' && !Medipack.traegt(S4.g, p), 'Medipack im versteckten dritten Slot: gespeichert, aber nicht wirksam');
  S4.runter(0);
  ok(p.medkit === 0 && S4.g.inventory.medipack === 2, '4 Spieler, Medipack nur im versteckten Slot: kein Kit, Lager unberührt');
  const S2 = szene(2, { slots: (i) => (i === 0 ? ['blaster', null, 'medipack'] : undefined) });
  S2.runter(0);
  ok(S2.P(0).medkit === N, '2 Spieler (3 Slots): Medipack im dritten Slot wirkt');
}

section('Taste im Medipack-Slot: nur Anzeige');
{
  const S = szene(1);
  S.runter(0);
  const p = S.P(0);
  const waffe = p.waffe;
  S.cmd(0, Protocol.CMD_SLOT_NUTZEN, { slot: 1 });
  ok(S.notices(0).includes('Medipack: ' + N + ' Ladungen'), 'Taste zeigt "Medipack: ' + N + ' Ladungen" (' + S.notices(0).join(' | ') + ')');
  ok(p.medkit === N && p.waffe === waffe && Loadout.aktiveWaffe(S.g, p) === 'blaster', 'Taste ändert weder Ladungen noch aktive Waffe');
  p.medkit = 1; S.cmd(0, Protocol.CMD_SLOT_NUTZEN, { slot: 1 });
  p.medkit = 0; S.cmd(0, Protocol.CMD_SLOT_NUTZEN, { slot: 1 });
  const nt = S.notices(0);
  ok(/^Medipack: 1 Ladung$/.test(nt[nt.length - 2]) && nt[nt.length - 1] === 'Medipack leer', 'ein Rest "1 Ladung", leer "Medipack leer"');
  ok(Loadout.slotNutzen(S.g, p, 1) === null && Medipack.nutzen(S.g, p) === null, 'Handler gibt null zurück (Texte laufen über game.notice)');
}

section('Aufheben auf v2 (Bodenpack, Nachschub)');
{
  const S = szene(3, { slots: (i) => (i === 2 ? ['blaster', null, null] : undefined), lager: 5 });
  for (let i = 0; i < 3; i++) S.runter(i);
  const [t0, t1, nt] = [S.P(0), S.P(1), S.P(2)];
  t0.medkit = 1;   // angebraucht
  S.platz(0, 4, 18); S.platz(1, 12, 18); S.platz(2, 20, 18);
  const aw = S.g.away;
  aw.items.push({ id: 'mk0', kind: 'medipack', x: t0.x, y: t0.y });
  S.lauf(0.1);
  ok(t0.medkit === N && !aw.items.some((i) => i.id === 'mk0'), 'Träger mit Rest: Bodenpack füllt auf ' + N + ' auf, Pack weg');
  aw.items.push({ id: 'mk1', kind: 'medipack', x: t1.x, y: t1.y });   // t1 ist voll
  S.lauf(1.0);
  ok(t1.medkit === N && aw.items.some((i) => i.id === 'mk1'), 'voller Träger: Pack bleibt liegen');
  ok(S.notices(1).filter((t) => /voll/.test(t)).length === 1, 'voller Träger: genau eine Meldung (kein Spam je Tick): ' + S.notices(1).filter((t) => /voll/.test(t)).length);
  aw.items.push({ id: 'mk2', kind: 'medipack', x: nt.x, y: nt.y });
  S.lauf(1.0);
  ok(nt.medkit === 0 && aw.items.some((i) => i.id === 'mk2') && S.notices(2).some((t) => /Medipack-Slot/.test(t)), 'Nichtträger: kein Kit, Pack bleibt liegen, Hinweis "Kein Medipack-Slot"');
  aw.items.length = 0;
  // E-Weg (pickupItem -> pickupMedkit)
  const it = { id: 'mk3', kind: 'medipack', x: t1.x, y: t1.y };
  aw.items.push(it);
  ok(combat.pickupMedkit(S.g, t1, it) === false && aw.items.includes(it), 'E am Boden, voller Träger: abgelehnt, Pack bleibt');
  t1.medkit = 0;
  ok(combat.pickupMedkit(S.g, t1, it) === true && t1.medkit === N && !aw.items.includes(it), 'E am Boden, leerer Träger: ' + N + ' Ladungen');
  const it2 = { id: 'mk4', kind: 'medipack', x: nt.x, y: nt.y };
  aw.items.push(it2);
  ok(combat.pickupMedkit(S.g, nt, it2) === false && aw.items.includes(it2) && nt.medkit === 0, 'E am Boden, Nichtträger: abgelehnt');
  // aufgehobener Pack wird beim Verlassen wie jeder andere zurückgebucht
  const vor = S.g.inventory.medipack;
  t0.medkit = 1; aw.items.push({ id: 'mk5', kind: 'medipack', x: t0.x, y: t0.y }); S.lauf(0.1);
  S.hoch(0);
  ok(t0.medkit === 0 && S.g.inventory.medipack === vor + 1, 'aufgehobener Pack: beim Hochbeamen als voller Pack zurückgebucht');
  // Nachschub (away.supply): nur wenn ein Träger unten ist
  aw.marker = { x: t1.x, y: t1.y }; S.g.ship.systems.transfer = 'ok';
  S.g.support.supply = 0; S.g.ship.systems.transfer = 'ok';
  const lagerVor = S.g.inventory.medipack;
  const fehl = Away.supply(S.g);
  ok(fehl === null && S.g.inventory.medipack === lagerVor - 1 && aw.items.some((i) => i.kind === 'medipack'), 'Nachschub mit Träger unten: ein Pack aus dem Lager, liegt auf der Markierung');
}
{
  const S = szene(2, { slots: () => ['blaster', null, null] });
  S.runter(0); S.runter(1);
  S.g.away.marker = { x: S.P(0).x, y: S.P(0).y };
  S.g.support.supply = 0; S.g.ship.systems.transfer = 'ok';
  const vor = S.g.inventory.medipack;
  const fehl = Away.supply(S.g);
  ok(typeof fehl === 'string' && /Medipack-Slot/.test(fehl) && S.g.inventory.medipack === vor && !S.g.away.items.some((i) => i.kind === 'medipack'), 'Nachschub ohne Träger unten: abgelehnt, nichts gebucht (' + fehl + ')');
}

section('NSC verarzten: eine Ladung');
{
  const S = szene(1);
  Registry.get('spawn_person').run(S.g.mission, { map: 'kesh', person: 'sela', verletzt: true, anker: 'hof' });
  S.runter(0);
  const p = S.P(0);
  const npc = Away.personMit(S.g.aways.kesh, 'sela');
  p.x = npc.x; p.y = npc.y;
  ok(p.medkit === N, 'Träger unten mit ' + N + ' Ladungen');
  interior.onAct(S.g, p, true); interior.onAct(S.g, p, false);
  ok(!npc.injured && npc.following === p.id && p.medkit === N - 1, 'Verarzten kostet genau eine Ladung (' + p.medkit + ' übrig)');
  const lager = S.g.inventory.medipack;
  S.hoch(0);
  ok(S.g.inventory.medipackCharges === N - 1 && S.g.inventory.medipack === lager, 'Rest nach dem Verarzten kommt als Rest zurück');
}
{
  const S = szene(1, { slots: () => ['blaster', null, null] });
  Registry.get('spawn_person').run(S.g.mission, { map: 'kesh', person: 'sela', verletzt: true, anker: 'hof' });
  S.runter(0);
  const p = S.P(0);
  const npc = Away.personMit(S.g.aways.kesh, 'sela');
  p.x = npc.x; p.y = npc.y;
  interior.onAct(S.g, p, true); interior.onAct(S.g, p, false);
  ok(npc.injured && p.medkit === 0, 'Nichtträger: kann nicht verarzten');
}

section('Weltstand: Loadout mit medipack, Rest im Lager (Version 3)');
{
  const dir = freshDir();
  const mk = (extra) => {
    const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(ROOT_TMP, 'regie') } });
    const cs = [];
    for (let i = 0; i < 2; i++) { const c = { inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'W' + i, name: 'Crew' + i, color: i }); cs.push(c); }
    g.handleMessage(cs[0], Object.assign({ t: 'lobbyOpt' }, extra));
    for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
    for (let k = 0; k < 6; k++) g.step();
    return { g, cs };
  };
  const t = mk({ startMission: 'free' });
  const p = t.g.players[0]; const h = require('../server/sim/waffen.js').hashKennung(p.clientId);
  p.console = 'ausruestung';
  t.g.handleMessage(t.cs[0], { t: 'cmd', c: 'ausruestung.slot', slot: 0, id: 'sturmgewehr' });
  t.g.handleMessage(t.cs[0], { t: 'cmd', c: 'ausruestung.slot', slot: 1, id: null });
  t.g.handleMessage(t.cs[0], { t: 'cmd', c: 'ausruestung.slot', slot: 2, id: 'medipack' });
  Vorrat.standSetzen(t.g, 'medipackCharges', 2, 'debug');
  const cap = Weltstand.capture(t.g);
  ok(cap.version === 3 && JSON.stringify(cap.crew.loadout[h]) === '["sturmgewehr",null,"medipack"]', 'capture: Version bleibt 3, crew.loadout mit medipack im dritten Slot');
  ok(cap.schiff.lager.medipackCharges === 2, 'capture: Rest im Lager (schiff.lager.medipackCharges)');
  const fehler = Weltstand.validate(cap);
  ok(fehler.length === 0, 'capture schemagültig' + fehler.slice(0, 2).map((x) => ' – ' + x).join(''));
  const id = t.g.weltstand.id;
  t.g.handleMessage(t.cs[0], { t: 'menu', op: 'end' });
  const t2 = mk({ world: id });
  const q = t2.g.players[0];
  ok(JSON.stringify(Loadout.loadoutFuer(t2.g, q)) === '["sturmgewehr",null,"medipack"]' && Medipack.traegt(t2.g, q), 'Fortsetzen: Loadout mit medipack wiederhergestellt (Item vor restore registriert)');
  ok(t2.g.inventory.medipackCharges === 2, 'Fortsetzen: Rest im Lager wiederhergestellt');
  ok(Medipack.traegt(t2.g, t2.g.players[1]), 'Fortsetzen: Mitspieler ohne gespeicherten Eintrag behält das Standardloadout mit Medipack');
  t2.g.handleMessage(t2.cs[0], { t: 'menu', op: 'end' });
  // gespeicherter Altstand mit explizitem Loadout ohne Medipack bleibt unverändert
  const g5 = { C: JSON.parse(JSON.stringify(CONFIG)), time: 0, events: [], players: [] };
  Loadout.restore({ '0123456789ab': ['lanze', null, null] }, g5);
  ok(JSON.stringify(g5.crewLoadout['0123456789ab']) === '["lanze",null,null]', 'Altstand mit explizitem Loadout (ohne Medipack): unverändert');
}

section('Fehlerzähler');
{
  const S = szene(2);
  S.runter(0); S.runter(1);
  S.revive(0, 1); S.hoch(0); S.runter(0);
  ok(S.g.errors === 0, 'keine gezählten Fehler (' + S.g.errors + ')');
}

console.log(`\n${n - fails}/${n} ok` + (fails ? `, ${fails} FEHLER` : ''));
try { fs.rmSync(ROOT_TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
process.exit(fails ? 1 : 0);
