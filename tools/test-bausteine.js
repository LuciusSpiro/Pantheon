'use strict';
// S2 (CONTRACT-S2 §6, Team BAUSTEINE): Tests der Welt-Bausteine (server/mission/bausteine/welt.js) headless.
//   node tools/test-bausteine.js
// map_reset je Außenkarte nach Tutorial-Endzustand (über Objekt-Abfragen aus objects.js geprüft), Ereignis bought,
// spawn_person/person_rescued (Person retten auf Wrack und Kesh), ship_near/ship_hold_position, Anker.
const { Game } = require('../server/game.js');
const Registry = require('../server/mission/registry.js');
const Objects = require('../server/mission/objects.js');
const Welt = require('../server/mission/bausteine/welt.js');
const Away = require('../server/sim/away.js');
const interior = require('../server/sim/interior.js');
const shop = require('../server/sim/shop.js');
const Maps = require('../shared/maps.js');
const Physics = require('../shared/physics.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);

function setup(players) {
  const g = new Game({ noStore: true, seed: 11, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const conns = [];
  for (let i = 0; i < (players || 1); i++) {
    const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'B' + i, name: 'Crew' + i, color: i });
    conns.push(c);
  }
  const events = [];
  const orig = g.mission.onEvent.bind(g.mission);
  g.mission.onEvent = (name, data) => { events.push({ name, data }); return orig(name, data); };
  const ev = (name) => events.filter((e) => e.name === name);
  const oda = () => conns[0].inbox.filter((m) => m.t === 'event' && m.kind === 'oda').map((m) => m.text);
  const radio = () => conns[0].inbox.filter((m) => m.t === 'event' && m.kind === 'radio');
  const run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) g.step(); };
  return { g, conns, events, ev, oda, radio, run, p: g.players[0] };
}
const act = (name, g, args) => Registry.get(name).run(g.mission, args);
const chk = (name, g, args) => !!Registry.get(name).test(g.mission, args);
const st = (g, map, obj) => Objects.state(g, map, obj);
function beamDown(t, map, i) {
  t.g.setAwayMap(map);
  interior.placeOnAwayPad(t.g, t.g.players[i || 0], i || 0);
  t.g.aways[map].active = true;
}

function main() {
  // ---------------------------------------------------------------------------------------------------------
  section('Plugin und Beschreibung');
  const rec = Registry.PLUGINS.find((p) => p.name === 'welt.js');
  ok(!!rec && !rec.errors.length, 'welt.js als Registry-Plugin geladen, ohne Fehler');
  const ids = ['map_reset', 'spawn_person', 'person_rescued', 'person_state', 'purchased', 'ship_near', 'ship_hold_position', 'debug_rescue_person'];
  ok(ids.every((id) => Registry.get(id)), 'Bausteine registriert: ' + ids.join(', '));
  const d = Registry.describe().find((e) => e.id === 'map_reset');
  ok(d && d.params.map.pflicht && d.params.grund.typ === 'text' && d.params.grund.oda && d.art === 'aktion', 'describe(): map_reset { map*, grund (Text, ODA) }');
  const sp = Registry.describe().find((e) => e.id === 'spawn_person');
  ok(sp && sp.params.map.pflicht && sp.params.person.pflicht && sp.params.name && sp.params.verletzt, 'describe(): spawn_person { map*, person*, name, verletzt }');
  const pr = Registry.describe().find((e) => e.id === 'person_rescued');
  ok(pr && pr.art === 'pruefung' && pr.params.map.pflicht && pr.params.person.pflicht, 'describe(): person_rescued { map*, person* }');
  ok(Registry.get('debug_rescue_person').intern === true, 'debug_rescue_person ist intern');

  // ---------------------------------------------------------------------------------------------------------
  section('map_reset kesh nach Tutorial-Endzustand (Tafel im Konkordat-Archiv)');
  {
    const t = setup(1); const g = t.g;
    // Endzustand m3: Relais aus, Tor offen, Tafel genommen und abgegeben, Trupps erschienen, Fakt gesetzt
    Objects.setState(g, 'kesh', 'jammer', 'off');
    Objects.setState(g, 'kesh', 'vault', 'open');
    Objects.setState(g, 'kesh', 'tablet', 'taken');
    Objects.setState(g, 'kesh', 'warden', 'awake');
    g.inventory.tafel = 0;
    require('../server/sim/combat.js').spawnSquad(g, 'squad1', {});
    g.weltstand.fact('tafel_von_kesh', 'konkordat_archiv', 'm3');
    beamDown(t, 'kesh', 0);
    for (const e of g.aways.kesh.drones) if (e.squad === 'squad1') e.alive = false;
    ok(st(g, 'kesh', 'vault') === 'open' && st(g, 'kesh', 'tablet') === 'taken', 'Vorher: Tor offen, Tafel weg');
    t.conns[0].inbox.length = 0;
    act('map_reset', g, { map: 'kesh', grund: 'Neue Plünderer haben das Archiv wieder verriegelt und besetzt.' });
    ok(st(g, 'kesh', 'vault') === 'closed', 'Tor wieder zu (kesh.vault = closed)');
    ok(st(g, 'kesh', 'jammer').every((s) => s === 'on'), 'Störrelais wieder an');
    ok(st(g, 'kesh', 'key').every((s) => s === 'idle'), 'Archivschlüssel idle');
    ok(st(g, 'kesh', 'tablet') === 'taken' && g.aways.kesh.tablet.empty === true, 'Sockel leer (Tafel bleibt im Archiv)');
    ok((g.inventory.tafel || 0) === 0, 'keine neue Tafel im Inventar');
    ok(st(g, 'kesh', 'warden') === 'asleep', 'Wächter schläft wieder');
    ok(Object.keys(g.aways.kesh.spawned).length === 0 && !chk('squad_cleared', g, { map: 'kesh', squad: 'squad1' }), 'Trupps zurückgesetzt (squad1 nicht erschienen)');
    ok(g.aways.kesh.active === false && g.away === g.aways.kesh, 'Karte inaktiv, game.away zeigt auf die neue Karte');
    ok(g.players[0].zone === 'ship', 'Spieler auf der Karte wurde vorher an Bord geholt');
    ok(t.oda().some((s) => s.startsWith('Neue Plünderer')), 'grund als ODA');
    ok(g.explore.log.some((l) => l.text.startsWith('Neue Plünderer') && l.loc === 'kesh'), 'grund im Logbuch (Ort kesh)');
    ok(t.ev('mapReset').length === 1 && t.ev('mapReset')[0].data.map === 'kesh', 'Ereignis mapReset an mission.onEvent');
    // Sockel-Hinweis
    const T = Maps.kesh.find('T')[0];
    Objects.setState(g, 'kesh', 'vault', 'open');
    beamDown(t, 'kesh', 0);
    const list = interior.interactionsAt(g, g.players[0], T.x, T.y, false);
    ok(list.some((i) => i.kind === 'tablet' && /Konkordat-Archiv/.test(i.blocked || '')), 'Sockel-Hinweis: Tafel liegt im Konkordat-Archiv');
    // Zweites Zurücksetzen: anderer RNG-Salz, Zähler steigt
    act('map_reset', g, { map: 'kesh', grund: 'Wieder da.' });
    ok(g.aways.kesh.resets === 2 && g.mapResets.kesh === 2, 'Reset-Zähler je Karte');
    ok(g.errors === 0, 'keine gezählten Fehler (' + g.errors + ')');
  }
  {
    const t = setup(1); const g = t.g;
    g.weltstand.fact('tafel_von_kesh', 'konkordat_archiv', 'm3');
    g.weltstand.fact('waechter_kesh', 'zerstoert', 'm3');
    act('map_reset', g, { map: 'kesh', grund: 'x', fund: 'artefakt' });
    ok(st(g, 'kesh', 'warden') === 'dead', 'Fakt waechter_kesh = zerstoert: Wächter bleibt zerstört');
    ok(st(g, 'kesh', 'tablet') === 'present' && g.aways.kesh.tablet.item === 'artefakt', 'fund: neuer Gegenstand auf dem Sockel');
    Objects.setState(g, 'kesh', 'vault', 'open');
    Objects.setState(g, 'kesh', 'tablet', 'taken');
    ok(g.inventory.artefakt === 1 && !(g.inventory.tafel > 0), 'Fund ins Inventar (artefakt), keine Tafel');
    ok(t.ev('tabletTaken').some((e) => e.data.item === 'artefakt'), 'tabletTaken mit item');
  }
  {
    const t = setup(1); const g = t.g;   // ohne Fakten (Direktstart/Test): Tafel bleibt liegen
    act('map_reset', g, { map: 'kesh', grund: 'x' });
    ok(st(g, 'kesh', 'tablet') === 'present' && !g.aways.kesh.tablet.empty, 'ohne Fakt und ohne m3: Tafel liegt noch auf dem Sockel');
    Away.applyWorldFacts(g);
    ok(st(g, 'kesh', 'tablet') === 'present', 'applyWorldFacts ohne Fakt: keine Änderung');
    const t2 = setup(1);
    t2.g.weltstand.fact('tafel_von_kesh', 'konkordat_archiv', 'geruecht');
    Away.applyWorldFacts(t2.g);
    ok(st(t2.g, 'kesh', 'tablet') === 'taken', 'applyWorldFacts (nach dem Laden): Sockel leer, wenn die Tafel im Archiv liegt');
  }

  // ---------------------------------------------------------------------------------------------------------
  section('map_reset platform nach m1-Endzustand');
  {
    const t = setup(1); const g = t.g;
    const code0 = g.aways.platform.sonde.symbols.join(',');
    Objects.setState(g, 'platform', 'sonde', 'off');
    Objects.setState(g, 'platform', 'core', 'rebooted');
    g.aways.platform.npc.rescued = true; g.aways.platform.npc.present = false;
    g.aways.platform.items = [];
    for (const dr of g.aways.platform.drones) dr.alive = false;
    ok(st(g, 'platform', 'datenkern') === 'taken' && st(g, 'platform', 'ivo') === 'rescued', 'Vorher: Kern weg, Ivo gerettet');
    act('map_reset', g, { map: 'platform', grund: 'B-7 ist wieder ausgefallen.' });
    ok(st(g, 'platform', 'sonde') === 'on' && g.aways.platform.doorOpen === false, 'Sonde wieder an, Tür zu');
    ok(st(g, 'platform', 'core') === 'off', 'Bojenkern aus');
    ok(st(g, 'platform', 'datenkern') === 'present', 'neuer Datenkern liegt bereit');
    ok(st(g, 'platform', 'ivo') === 'rescued' && !g.aways.platform.npc.present, 'Ivo bleibt gerettet (nicht wieder auf der Plattform)');
    ok(g.aways.platform.drones.length === require('../server/world.js').DRONE_SPAWNS.length && g.aways.platform.drones.every((x) => x.alive), 'Drohnen zurück');
    ok(g.aways.platform.sonde.symbols.length === code0.split(',').length, 'neuer Sondencode gleicher Länge');
    act('map_reset', g, { map: 'platform', grund: 'x', datenkern: false });
    ok(st(g, 'platform', 'datenkern') === 'taken', 'datenkern: false -> kein Kern');
  }

  // ---------------------------------------------------------------------------------------------------------
  section('map_reset wreck nach Zaunkönig-Endzustand');
  {
    const t = setup(1); const g = t.g;
    const hollowHid = require('../shared/locations.js').LOCATIONS.flatMap((l) => l.hidden || []).find((h) => h.kind === 'hollow');
    if (hollowHid) g.explore.revealHidden(hollowHid, true);
    for (const s of g.aways.wreck.salvage) s.done = true;
    Objects.setState(g, 'wreck', 'hollow', 'open');
    Objects.setState(g, 'wreck', 'lore', 'read');
    for (const x of g.aways.wreck.drones) x.alive = false;
    ok(st(g, 'wreck', 'container').every((s) => s === 'taken'), 'Vorher: Container leer');
    act('map_reset', g, { map: 'wreck', grund: 'Neues Treibgut im Laderaum.' });
    ok(st(g, 'wreck', 'container').every((s) => s === 'full'), 'Container wieder voll');
    ok(st(g, 'wreck', 'hollow') === 'closed' && st(g, 'wreck', 'lore') === 'unread', 'Hohlraum zu, Logbuch ungelesen');
    ok(!hollowHid || g.aways.wreck.hollow.marked === true, 'Hohlraum bleibt markiert (schon per Weitscan bekannt)');
    ok(g.aways.wreck.drones.every((x) => x.alive), 'Plünderer zurück');
  }

  // ---------------------------------------------------------------------------------------------------------
  section('Ereignis bought + purchased');
  {
    const t = setup(1); const g = t.g; const p = t.p;
    ok(g.ship.docked, 'Start angedockt im Hafen');
    g.inventory.marks = 500;
    const err = shop.buy(g, p, 'ersatzteil');
    const b = t.ev('bought')[0];
    ok(!err && b && b.data.item === 'ersatzteil' && b.data.n === 1 && b.data.marks === 40, 'bought { item, n, marks } an mission.onEvent');
    ok(g.inventory.marks === 460, 'Marken abgezogen');
    ok(chk('purchased', g, {}) && chk('purchased', g, { item: 'ersatzteil' }) && !chk('purchased', g, { item: 'ersatzteil', min: 2 }), 'purchased (min/item)');
    ok(!chk('purchased', g, { item: 'medipack' }), 'purchased: anderer Artikel zählt nicht');
  }

  // ---------------------------------------------------------------------------------------------------------
  section('spawn_person / person_rescued');
  for (const [map, anker] of [['wreck', 'nsc'], ['kesh', 'nsc'], ['platform', 'nsc'], ['wreck', 'laderaum'], ['kesh', 'hof'], ['platform', 'kernraum'], ['wreck', '4,12']]) {
    const tile = Welt.anchorTile(map, anker);
    ok(!!tile && (Maps.MAP_AREAS[map][anker] ? Maps.inArea(map, anker, tile.x, tile.y) : true) && !Maps[map].solid(tile.x, tile.y),
      `Anker ${map}.${anker} -> begehbare Kachel ${tile ? tile.x + ',' + tile.y : '-'}`);
  }
  const ivoTile = Welt.anchorTile('platform', 'nsc');
  ok(ivoTile && ivoTile.x === Maps.platform.find('N')[0].x && ivoTile.y === Maps.platform.find('N')[0].y, 'NSC-Anker B-7 = Ivos Platz N');
  ok(Welt.anchorTile('wreck', 'gibtsnicht') === null, 'unbekannter Anker -> null');
  {
    const t = setup(1); const g = t.g; const p = t.p;
    act('spawn_person', g, { map: 'wreck', person: 'mira', name: 'Mira', verletzt: true });
    const A = { map: 'wreck', person: 'mira' };
    ok(chk('person_state', g, Object.assign({ state: 'injured' }, A)) && !chk('person_rescued', g, A), 'Mira verletzt am NSC-Anker, nicht gerettet');
    ok(!chk('person_rescued', g, { map: 'kesh', person: 'mira' }), 'person_rescued: andere Karte -> false');
    beamDown(t, 'wreck', 0);
    const npc = g.aways.wreck.npc;
    p.x = npc.x; p.y = npc.y;
    interior.onAct(g, p, true); interior.onAct(g, p, false);
    ok(!npc.following, 'ohne Medipack: folgt nicht (Hinweis)');
    p.carry = 'medipack';
    interior.onAct(g, p, true); interior.onAct(g, p, false);
    ok(!npc.injured && npc.following === p.id && p.carry === null, 'mit Medipack verarztet, folgt');
    ok(t.radio().some((r) => r.from === 'Mira'), 'Funk von Mira');
    ok(chk('person_state', g, Object.assign({ state: 'following' }, A)), 'person_state following');
    // zu den Pads führen: Spieler aufs Pad, Person folgt
    const pad = Maps.WRECK_PADS[0];
    const c = Physics.tileCenter(pad.x, pad.y);
    p.x = c.x; p.y = c.y;
    for (let k = 0; k < 12 * 30; k++) { g.time += 1 / 30; g.transfer.update(g, 1 / 30); }
    ok(Math.hypot(npc.x - p.x, npc.y - p.y) <= g.C.awayExtra.rescueRange, 'Person ist dem Spieler zu den Pads gefolgt');
    g.transfer.executeBeam(g, [p.id], 'up');
    ok(chk('person_rescued', g, A) && npc.rescued && !npc.present, 'person_rescued nach dem Hochbeamen');
    ok(t.ev('npcRescued').some((e) => e.data.person === 'mira' && e.data.name === 'Mira' && e.data.map === 'wreck'), 'npcRescued { person, name, map }');
    ok(!g.flags.npcMet, 'Ivos Flag npcMet unberührt');
    ok(g.errors === 0, 'keine gezählten Fehler (' + g.errors + ')');
  }
  {
    const t = setup(1); const g = t.g; const p = t.p;   // Kesh: eingestecktes Medipack (Kampf v2) heilt
    act('spawn_person', g, { map: 'kesh', person: 'sela', verletzt: true, anker: 'hof' });
    ok(g.aways.kesh.npc.name === 'Sela', 'Name aus dem NSC-Datensatz (person = sela)');
    beamDown(t, 'kesh', 0);
    p.medkit = 1;
    const npc = g.aways.kesh.npc;
    p.x = npc.x; p.y = npc.y;
    interior.onAct(g, p, true); interior.onAct(g, p, false);
    ok(!npc.injured && npc.following === p.id && p.medkit === 0, 'Kesh: eingestecktes Medipack verarztet, folgt');
    act('debug_rescue_person', g, { map: 'kesh', person: 'sela' });
    ok(chk('person_rescued', g, { map: 'kesh', person: 'sela' }), 'debug_rescue_person -> person_rescued');
  }
  {
    const t = setup(1); const g = t.g;   // Ivo unverändert
    const npc = g.aways.platform.npc;
    ok(npc.present && npc.injured && !npc.name, 'Ivo liegt wie bisher verletzt auf B-7 (ohne Namen)');
    beamDown(t, 'platform', 0);
    const p = t.p; p.x = npc.x; p.y = npc.y;
    const list = interior.interactionsAt(g, p, Physics.toTile(npc.x, npc.y).x, Physics.toTile(npc.x, npc.y).y, true);
    ok(list.some((i) => i.kind === 'npc' && i.blocked === 'Ivo ist verletzt – er braucht ein Medipack (Lager an Bord oder Nachschub per Transfer auf die Markierung).'), 'Ivo-Hinweis wortgleich');
  }

  // ---------------------------------------------------------------------------------------------------------
  section('ship_near / ship_hold_position');
  {
    const t = setup(1); const g = t.g;
    g.debugGoto('b7');
    const loc = require('../shared/locations.js').get('b7');
    const s = loc.scene.station;
    g.ship.x = s.x + 100; g.ship.y = s.y;
    ok(chk('ship_near', g, { dist: 150 }) && !chk('ship_near', g, { dist: 50 }), 'ship_near an der Station');
    ok(!chk('ship_near', g, { dist: 150, loc: 'kesh' }), 'ship_near mit anderem Ort -> false');
    const a = { dist: 150, sec: 3, loc: 'b7' };
    let held = false;
    for (let k = 0; k < 30 * 4; k++) { g.time += 1 / 30; g.ship.x = s.x + 100; g.ship.y = s.y; held = chk('ship_hold_position', g, a) || held; if (k === 30) ok(!held, 'nach 1 s noch nicht gehalten'); }
    ok(held, 'nach 3 s gehalten');
    g.ship.x = s.x + 400; chk('ship_hold_position', g, a); g.ship.x = s.x + 100;
    ok(!chk('ship_hold_position', g, a), 'verlassen -> Zähler beginnt neu');
  }

  console.log(`\n${n - fails}/${n} ok${fails ? ', ' + fails + ' FEHLER' : ''}`);
  process.exit(fails ? 1 : 0);
}
main();
