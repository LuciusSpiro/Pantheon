'use strict';
// S2 (CONTRACT-S2 §6, Team BAUSTEINE): Tests der Welt-Bausteine (server/mission/bausteine/welt.js) headless.
//   node tools/test-bausteine.js
// map_reset je Außenkarte nach Tutorial-Endzustand (über Objekt-Abfragen aus objects.js geprüft), Ereignis bought,
// spawn_person/person_rescued (Person retten auf Wrack und Kesh), ship_near/ship_hold_position, Anker.
const { Game } = require('../server/game.js');
const SNAP_MAX = require('../shared/config.js').net.snapMax;   // W1 AP1: Snapshot-Grenze (Bytes)
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
    Away.hauptPerson(g.aways.platform).rescued = true; Away.hauptPerson(g.aways.platform).present = false;
    g.aways.platform.items = [];
    for (const dr of g.aways.platform.drones) dr.alive = false;
    ok(st(g, 'platform', 'datenkern') === 'taken' && st(g, 'platform', 'ivo') === 'rescued', 'Vorher: Kern weg, Ivo gerettet');
    act('map_reset', g, { map: 'platform', grund: 'B-7 ist wieder ausgefallen.' });
    ok(st(g, 'platform', 'sonde') === 'on' && g.aways.platform.doorOpen === false, 'Sonde wieder an, Tür zu');
    ok(st(g, 'platform', 'core') === 'off', 'Bojenkern aus');
    ok(st(g, 'platform', 'datenkern') === 'present', 'neuer Datenkern liegt bereit');
    ok(st(g, 'platform', 'ivo') === 'rescued' && !Away.hauptPerson(g.aways.platform).present,'Ivo bleibt gerettet (nicht wieder auf der Plattform)');
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
    const npc = Away.personMit(g.aways.wreck, 'mira');
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
    ok(Away.personMit(g.aways.kesh, 'sela').name === 'Sela', 'Name aus dem NSC-Datensatz (person = sela)');
    beamDown(t, 'kesh', 0);
    p.medkit = 1;
    const npc = Away.personMit(g.aways.kesh, 'sela');
    p.x = npc.x; p.y = npc.y;
    interior.onAct(g, p, true); interior.onAct(g, p, false);
    ok(!npc.injured && npc.following === p.id && p.medkit === 0, 'Kesh: eingestecktes Medipack verarztet, folgt');
    act('debug_rescue_person', g, { map: 'kesh', person: 'sela' });
    ok(chk('person_rescued', g, { map: 'kesh', person: 'sela' }), 'debug_rescue_person -> person_rescued');
  }
  {
    const t = setup(1); const g = t.g;   // Ivo unverändert
    const npc = Away.hauptPerson(g.aways.platform);
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

  // ---------------------------------------------------------------------------------------------------------
  section('B3: Bausteine Sektor (sektor.js) und Prüfer-Codes');
  {
    const recS = Registry.PLUGINS.find((p) => p.name === 'sektor.js');
    const idsS = ['sprungpunkt_oeffnen', 'sprungpunkt_schliessen', 'boje_aufdecken', 'im_hex', 'sprungpunkt_erreicht', 'notgesprungen'];
    ok(!!recS && !recS.errors.length && idsS.every((id) => Registry.get(id)), 'sektor.js: ' + idsS.join(', '));
    const Sek = require('../shared/sektoren.js');
    const t = setup(1); const g = t.g;
    t.conns[0].inbox.length = 0;
    g.handleMessage(t.conns[0], { t: 'ready', ready: true });
    const hafen = Sek.hexVonOrt('hafen');
    ok(chk('im_hex', g, { hex: hafen }) && !chk('im_hex', g, { hex: '0107' }), `im_hex ${hafen} (Hafen)`);
    // Nachbar-Leerraum für eine temporäre Kante
    const leer = Sek.nachbarn(hafen).find((h) => Sek.istLeerraum(h) && Sek.spielbar(h));
    if (leer) {
      act('sprungpunkt_oeffnen', g, { von: hafen, nach: leer, temp: true, bis: 'mission' });
      const k = Sek.kanteId(hafen, leer);
      ok(g.explore.temp.some((x) => x.id === k), `sprungpunkt_oeffnen: temporäre Kante ${k}`);
      const snap = g.snapshot();
      ok(snap.world.sektoren && snap.world.sektoren.t.includes(k), 'Snapshot world.sektoren.t enthält die Kante');
      const snap2 = g.snapshot();
      ok(!snap2.world.sektoren, 'world.sektoren nur bei geänderter Version');
      act('sprungpunkt_schliessen', g, { kante: k });
      ok(!g.explore.temp.some((x) => x.id === k), 'sprungpunkt_schliessen');
    } else ok(false, 'kein Leerraum-Nachbar des Hafens gefunden');
    const welcome = t.conns[0].inbox.find((m) => m.t === 'welcome');
    ok(true, 'welcome (vor ready) geprüft unten');
    const t2 = setup(1);
    const w2 = t2.conns[0].inbox.find((m) => m.t === 'welcome');
    ok(w2 && w2.sektorkarte && w2.sektorkarte.hexe && !('praesenz' in w2.sektorkarte), `welcome.sektorkarte ohne praesenz (${w2 && JSON.stringify(w2.sektorkarte).length} B)`);
    void welcome;
    ok(!chk('notgesprungen', g, {}), 'notgesprungen: false ohne Notfallsprung');
    const s = g.snapshot();
    ok(s.ship.jump && 'blockedReason' in s.ship.jump, 'ship.jump im Snapshot (jp/d, sobald sprung.js sie setzt)');
    ok(Buffer.byteLength(JSON.stringify(s)) < SNAP_MAX, `Snapshot im Raum ${Buffer.byteLength(JSON.stringify(s))} B < ${SNAP_MAX} B`);
    // Prüfer
    const Checker = require('../server/mission/checker.js');
    const book = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'content', 'regiebuecher', 'm3.regiebuch.json'), 'utf8'));
    const st0 = book.steps[0];
    st0.enter = (st0.enter || []).concat([{ do: 'boje_aufdecken', kante: '0101-0909' }]);
    let r = Checker.check(book);
    ok(r.errors.some((e) => e.code === 'SPRUNG-KANTE'), 'Prüfer: SPRUNG-KANTE bei unbekannter Kante');
    const hidden = (Sek.KARTE.kanten || []).find((e) => e.art === 'hidden');
    st0.enter[st0.enter.length - 1] = { do: 'boje_aufdecken', kante: Sek.kanteId(hidden.a, hidden.b) };
    r = Checker.check(book);
    ok(r.warnings.some((e) => e.code === 'SPRUNG-HIDDEN'), 'Prüfer: SPRUNG-HIDDEN (Warnung) bei verborgener Kante');
    st0.enter.pop();
    st0.next = [{ if: { check: { name: 'im_hex', hex: '0107' } }, goto: st0.next && st0.next[0] && st0.next[0].goto }].concat(st0.next || []);
    r = Checker.check(book);
    ok(r.errors.some((e) => e.code === 'HEX-UNSPIELBAR'), 'Prüfer: HEX-UNSPIELBAR (Rostnest 0107)');
  }

  // ---------------------------------------------------------------------------------------------------------
  section('B1: Ankermodell (objects.js) und Bausteine Bühne (buehne.js)');
  {
    const idsB = ['anker_zustand', 'kante_zustand', 'landepunkt_alarm', 'ladung_geben', 'besetzen', 'entern_ziel', 'anker_state', 'download_fertig', 'ladung_gezuendet', 'alarm', 'team_im_bereich'];
    const recB = Registry.PLUGINS.find((p) => p.name === 'buehne.js');
    ok(!!recB && !recB.errors.length && idsB.every((id) => Registry.get(id)), 'buehne.js: ' + idsB.join(', '));
    const t = setup(1); const g = t.g;
    g.handleMessage(t.conns[0], { t: 'ready', ready: true });
    // Adapter Kesh: tor = vault, raetsel = key, fund = tablet
    ok(Objects.ankerState(g, 'kesh', Objects.resolveAnker(g, 'kesh', 'tor')[0]) === 'zu', 'kesh tor (vault closed) = zu');
    ok(chk('anker_state', g, { map: 'kesh', anker: 'fund', state: 'da' }), 'kesh fund (tablet present) = da');
    ok(chk('anker_state', g, { map: 'kesh', anker: 'raetsel', state: 'ruhe', all: true }), 'kesh raetsel (key idle) = ruhe, alle');
    act('anker_zustand', g, { map: 'kesh', anker: 'tor', zustand: 'offen' });
    ok(st(g, 'kesh', 'vault') === 'open' && chk('anker_state', g, { map: 'kesh', anker: 'tor', state: 'offen' }), 'anker_zustand tor offen -> vault open');
    ok(chk('anker_state', g, { map: 'kesh', anker: 'raetsel', state: 'geloest', all: true }), 'Gewölbe offen -> Rätselpaar geloest');
    ok(chk('object_state', g, { map: 'kesh', anker: 'tor', state: 'offen' }) && chk('object_state', g, { map: 'kesh', object: 'vault', state: 'open' }), 'object_state: neue Form { anker } und Altform { object }');
    // Wrack: beute = container, terminal = lore, versteck = hollow
    ok(chk('anker_state', g, { map: 'wreck', anker: 'beute', state: 'voll', all: true }), 'wreck beute (container full) = voll');
    act('set_object_state', g, { map: 'wreck', anker: 'terminal', state: 'geladen' });
    ok(st(g, 'wreck', 'lore') === 'read' && chk('download_fertig', g, { map: 'wreck' }), 'wreck terminal geladen -> lore read, download_fertig');
    ok(chk('anker_state', g, { map: 'platform', anker: 'ziel', state: 'frei' }), 'platform ziel (datenkern present) = frei');
    ok(chk('anker_state', g, { map: 'platform', anker: 'abholpunkt', state: 'bereit' }), 'Pads = abholpunkt bereit');
    act('ladung_geben', g, { anzahl: 2 });
    ok(g.inventory.ladung === 2, 'ladung_geben: Inventar ladung 2');
    // buehne_braucht
    const ruine = { art: 'ruine', anker: [{ rolle: 'tor' }, { rolle: 'fund' }, { rolle: 'raetsel', paar: 'A' }, { rolle: 'raetsel', paar: 'A' }, { rolle: 'eingang' }, { rolle: 'eingang' }], bereiche: { hof: { gefecht: true } } };
    ok(Objects.pruefeBuehneBraucht({ kartenarten: ['ruine', 'kesh'], anker: ['tor', 'fund', { rolle: 'raetsel', paar: 1 }], min: { eingang: 2 }, gefecht: true }, ruine).length === 0, 'buehne_braucht erfüllt (Ruine)');
    const f = Objects.pruefeBuehneBraucht({ kartenarten: ['station'], anker: ['terminal'], min: { eingang: 3 } }, ruine);
    ok(f.some((x) => x.code === 'BUEHNE-ART') && f.filter((x) => x.code === 'BUEHNE-ANKER').length === 2, 'buehne_braucht verletzt: BUEHNE-ART + 2× BUEHNE-ANKER');
    // Landepunkte
    ok(Objects.landepunkt('kesh') && Objects.landepunkt('kesh').art === 'hand', 'Landepunkt kesh = Handkarte');
    const lpr = Objects.landepunkt('rostnest.kastell');
    ok(!lpr || lpr.gesperrt === true, 'rostnest.kastell gesperrt');
    ok(Objects.landepunkt('splitter.station-2') && Objects.landepunkt('splitter.prise') && Objects.landepunkt('splitter.wrack-1') && !Objects.landepunkt('gibts.station-1'), 'dynamische Landepunkte <ort>.<art>-<n>, <ort>.prise, <ort>.wrack-<n>');
    // katalog.pruefeBesetzung (B2 §7): nur ausdrückliche neue_rolle zählt für BESETZUNG-NEU
    const Kat = require('../server/mission/katalog.js');
    const kat = { gegner: { a: { rolle: 'grundtyp' }, b: { rolle: 'niederhalter' }, c: { rolle: 'enterer' }, d: { rolle: 'haescher' } },
      fraktionen: { rostmeute: { id: 'rostmeute', staerke: { klein: 1, mittel: 2, gross: 3 }, rezepte: { rotte: [{ rolle: 'grundtyp', n: 2 }, { rolle: 'niederhalter', n: 1 }], jagd: [{ rolle: 'enterer', n: 2 }, { rolle: 'haescher', n: 1 }] } } } };
    const r1 = Kat.pruefeBesetzung([{ fraktion: 'rostmeute', staerke: 'mittel', haltung: 'ruhig' }], { katalog: kat, rollen_gesehen: [], spieler: 3 });
    ok(!r1.fehler.length && r1.warnungen.some((w) => w.code === 'BESETZUNG-NEU' && /jagd/.test(w.msg)) && !r1.warnungen.some((w) => /rotte/.test(w.msg)), 'pruefeBesetzung: Rezeptrollen zählen nicht; Warnung nur für Rezept aus lauter ungesehenen Rollen');
    const r2 = Kat.pruefeBesetzung([{ fraktion: 'rostmeute', staerke: 'mittel', haltung: 'wach', neue_rolle: 'niederhalter' }, { fraktion: 'rostmeute', staerke: 'klein', haltung: 'wach', neue_rolle: 'enterer' }], { katalog: kat, rollen_gesehen: [], spieler: 3 });
    ok(r2.fehler.some((e) => e.code === 'BESETZUNG-NEU'), 'pruefeBesetzung: zwei ungesehene neue_rolle -> Fehler BESETZUNG-NEU');
    const r3 = Kat.pruefeBesetzung([{ fraktion: 'rostmeute', staerke: 'riesig', neue_rolle: 'laserhai' }, { fraktion: 'gibtsnicht' }], { katalog: kat, rollen_gesehen: ['niederhalter'], spieler: 1 });
    ok(['FRAKTION', 'GEGNER-TYP'].every((c) => r3.fehler.some((e) => e.code === c)) && r3.warnungen.some((w) => w.code === 'BESETZUNG-SOLO'), 'pruefeBesetzung: FRAKTION, GEGNER-TYP, BESETZUNG-SOLO');
    const Ck = require('../server/mission/checker.js'); const sch = Ck.schema();
    const kr = (id) => Ck.validate(id, sch.$defs.kartenRef, '$', [], sch).length === 0;
    ok(['kesh', 'kesh.kastell', 'splitter.prise', 'hafen.station-2', 'splitter.wrack-1'].every(kr) && !kr('a.b.c') && !kr('Kesh.X'), 'regiebuch.schema kartenRef nimmt Landepunkt-IDs (aussenkarten, allowBeam, besetzung.map)');
  }

  // ---------------------------------------------------------------------------------------------------------
  section('B1: game.js – Direktstart arena_away, transfer.ziel, awayMap, Snapshot');
  {
    const Gm = require('../server/game.js').Game;
    ok(Gm.arenaParams({ art: 'ruine', seed: '3', bauweise: 'rom', besitz: 'herrenlos', zustand: 'verfallen', quatsch: 1 }).seed === 3 && Gm.arenaParams({ art: 'hand' }) === null && Gm.arenaParams(null) === null, 'arenaParams: prüft Felder, Handkarte/leer -> null (Kesh)');
    const t = setup(2); const g = t.g;
    g.handleMessage(t.conns[0], { t: 'lobbyOpt', startMission: 'arena_away', arena: { art: 'ruine', seed: 3, bauweise: 'rom', besitz: 'herrenlos', zustand: 'verfallen' } });
    for (const c of t.conns) g.handleMessage(c, { t: 'ready', ready: true });
    const lp = g.arena && g.arena.lp;
    const live = !!(lp && g.aways[lp]);
    ok(live, `arena_away mit Karte: Landepunkt ${lp} gebaut und betreten`);
    if (live) {
      ok(g.players.every((p) => p.zone === 'away') && g.away.map === lp, 'Team unten auf der gebauten Karte');
      t.run(0.2);
      const am = t.conns[0].inbox.filter((m) => m.t === 'event' && m.kind === 'awayMap');
      const bytes = am.length ? Buffer.byteLength(JSON.stringify(am[0])) : 0;
      ok(am.length === 1 && am[0].id === lp && Array.isArray(am[0].kanten) && Array.isArray(am[0].plaetze) && am[0].kv, `awayMap einmal gesendet (kanten ${am[0] && am[0].kanten.length}, plaetze ${am[0] && am[0].plaetze.length}, ${bytes} B)`);
      ok(bytes <= 10240, `awayMap ≤ 10 KB (${bytes} B)`);
      const s = g.snapshot();
      ok(s.away.map === lp && s.away.kv === am[0].kv && Array.isArray(s.away.ao) && s.away.al === 0, 'Snapshot away: map, kv, ao, al');
      const tor = Objects.resolveAnker(g, lp, 'tor')[0] || Objects.resolveAnker(g, lp, 'fund')[0];
      if (tor) {
        const z = Objects.rolleZustaende(tor.rolle)[1];
        act('anker_zustand', g, { map: lp, anker: tor.id, zustand: z, merken: true });
        ok(chk('anker_state', g, { map: lp, anker: tor.id, state: z }), `anker_zustand auf gebauter Karte: ${tor.id} = ${z}`);
        const s2 = g.snapshot();
        ok(s2.away.ao.length >= 1, 'Snapshot away.ao meldet die Abweichung');
      }
      act('landepunkt_alarm', g, { map: lp, an: true });
      ok(chk('alarm', g, { map: lp }) && g.snapshot().away.al === 1, 'landepunkt_alarm -> Prüfung alarm, Snapshot al 1');
      t.conns[1].inbox.length = 0;
      g.handleMessage(t.conns[1], { t: 'cmd', c: 'awayMap.get', id: lp });
      ok(t.conns[1].inbox.some((m) => m.kind === 'awayMap' && m.id === lp), 'cmd awayMap.get schickt die Karte erneut');
    }
    if (live) {
      // Nachauftrag: spawn_person über Anker, mehrere Personen, map_reset, anker_state min, download_fertig Kern
      const Lp = require('../server/sim/landepunkte.js');
      const lp2 = Lp.neu(g, 'kesh', { art: 'aussenposten', seed: 5 }); Lp.get(g, lp2);   // Außenposten: Pflichtsatz mit zelle
      const nsc = Objects.resolveAnker(g, lp2, 'nsc').concat(Objects.resolveAnker(g, lp2, 'zelle'));
      act('spawn_person', g, { map: lp2, person: 'p1', name: 'Eins', verletzt: true });
      act('spawn_person', g, { map: lp2, person: 'p2', name: 'Zwei' });
      act('spawn_person', g, { map: lp2, person: 'p3', name: 'Drei' });
      act('spawn_person', g, { map: lp2, person: 'p4', name: 'Vier' });
      const aw2 = g.aways[lp2];
      const npc = Away.personMit(aw2, 'p1');
      ok(nsc.length > 0 && !!npc && npc.present && npc.person === 'p1' && Math.floor(npc.x / 32) === nsc[0].x && Math.floor(npc.y / 32) === nsc[0].y, `spawn_person auf gebauter Karte am Anker ${nsc[0] && nsc[0].id}`);
      // W2 AP6 (E6): bis CONFIG.personen.maxGleichzeitig = 3 gleichzeitig, jede an ihrem eigenen Anker; die vierte wartet
      const offen = Away.offenePersonen(aw2);
      const kach = new Set(offen.map((n) => Math.floor(n.x / 32) + ',' + Math.floor(n.y / 32)));
      ok(offen.length === 3 && offen.map((n) => n.person).join() === 'p1,p2,p3', `3 Personen gleichzeitig auf der Karte (${offen.map((n) => n.person).join(', ')})`);
      ok(kach.size === 3, `jede Person auf eigener Kachel (Anker, bei zu wenigen Ankern daneben: ${[...kach].join(' ')})`);
      ok((aw2.personen || []).length === 1 && aw2.personen[0].person === 'p4' && chk('person_state', g, { map: lp2, person: 'p4', state: 'ok' }), 'vierte Person wartet (p4), person_state kennt sie');
      const sn = g.snapshot().away;
      ok(Array.isArray(sn.npcs) && sn.npcs.length === 0 && !('npc' in sn), 'Snapshot: away.npcs[] nur für die aktive Karte, kein away.npc mehr');
      // Snapshot-Form direkt aus der Karte: Name, Zustand, Standardfelder fehlen
      const ps = Away.personenSnap(aw2);
      ok(ps.length === 3 && ps[0].id === 'p1' && ps[0].name === 'Eins' && ps[0].injured === true && !('following' in ps[0]) && !('rescued' in ps[1]) && !('injured' in ps[1]),
        'personenSnap: id, name, injured nur wenn wahr, Standardfelder fehlen');
      // Rettung: p2 folgt einem Spieler und wird mit hochgebeamt
      const p0 = t.p;
      const p2 = Away.personMit(aw2, 'p2');
      g.away = aw2; p0.zone = 'away'; p0.x = p2.x; p0.y = p2.y;
      p2.following = p0.id;
      ok(Away.folgendePersonen(aw2).length === 1 && chk('person_state', g, { map: lp2, person: 'p2', state: 'following' }), 'p2 folgt (person_state following)');
      require('../server/sim/away.js').executeBeam(g, [p0.id], 'up');
      ok(chk('person_rescued', g, { map: lp2, person: 'p2' }) && Away.personMit(aw2, 'p2').rescued, 'p2 mit hochgebeamt -> person_rescued');
      t.run(0.1);
      const nach = Away.offenePersonen(aw2).map((n) => n.person);
      ok(nach.length === 3 && nach.includes('p4') && !(aw2.personen || []).length, `nach der Rettung rückt p4 in den freien Platz nach (${nach.join(', ')})`);
      ok(Away.personenSnap(aw2).some((n) => n.id === 'p2' && n.rescued === true), 'gerettete Person bleibt in der Liste (HUD: gerettet)');
      npc.rescued = true; npc.present = false; require('../server/sim/away.js').markRescued(g, lp2, 'p1');
      t.run(0.1);
      ok(Away.offenePersonen(aw2).length === 2 && chk('person_rescued', g, { map: lp2, person: 'p1' }), 'p1 gerettet, niemand wartet mehr: 2 offen');
      const ziele = Objects.resolveAnker(g, lp, 'beute');
      if (ziele.length >= 2) {
        act('anker_zustand', g, { map: lp, anker: ziele[0].id, zustand: 'leer' });
        ok(chk('anker_state', g, { map: lp, anker: 'beute', state: 'leer', min: 1 }) && !chk('anker_state', g, { map: lp, anker: 'beute', state: 'leer', min: 2 }), 'anker_state min: 1 von n ja, 2 von n nein');
      }
      const seed0 = g.landepunkte.eintraege[lp].seed;
      act('map_reset', g, { map: lp });
      ok(g.aways[lp] && !g.aways[lp].alarm && Object.keys(g.landepunkte.eintraege[lp].zustaende || {}).length === 0 && g.landepunkte.eintraege[lp].seed === seed0, 'map_reset gebaute Karte: Zustände/Alarm zurück, Seed bleibt');
      act('map_reset', g, { map: lp, neuer_seed: true });
      // B1 F1: neuer Seed = neuer Bau – nie im Tick; die Karte wird außerhalb des Ticks gebaut und dann registriert
      ok(g.landepunkte.eintraege[lp].seed !== seed0, `map_reset neuer_seed: ${seed0} -> ${g.landepunkte.eintraege[lp].seed}`);
      require('../server/sim/landepunkte.js').get(g, lp);   // Betreten (sonst nach dem Bau außerhalb des Ticks)
      // Snapshot transfer
      const st0 = g.snapshot();
      ok(!st0.transfer || Array.isArray(st0.transfer.lp), 'Snapshot transfer (falls Landepunkte am Ort)');
      ok(Buffer.byteLength(JSON.stringify(st0)) < SNAP_MAX, `Snapshot auf gebauter Karte ${Buffer.byteLength(JSON.stringify(st0))} B < ${SNAP_MAX} B`);
    }
    {   // download_fertig mit Kern-Terminal (Mock-Karte über world.register)
      const Wd = require('../server/world.js');
      const t3 = setup(1); const g3 = t3.g;
      const k = { id: 'hafen.station-9', art: 'station', rows: ['....'], w: 4, h: 1, anker: [{ id: 'a.terminal.1', rolle: 'terminal', x: 0, y: 0 }, { id: 'b.terminal', rolle: 'terminal', x: 2, y: 0, kern: true }], bereiche: {}, zustaende: {} };
      Wd.register('hafen.station-9', k);
      g3.aways['hafen.station-9'] = { map: 'hafen.station-9', zustaende: { 'a.terminal.1': 'geladen' }, drones: [] };
      ok(!chk('download_fertig', g3, { map: 'hafen.station-9' }), 'download_fertig: Neben-Terminal geladen zählt nicht, wenn ein Kern-Terminal da ist');
      g3.aways['hafen.station-9'].zustaende['b.terminal'] = 'geladen';
      ok(chk('download_fertig', g3, { map: 'hafen.station-9' }), 'download_fertig: Kern-Terminal geladen');
      Wd.unregister('hafen.station-9');
    }
    {   // Handkarten: Ivo, Wächter, Container setzbar
      const t4 = setup(1); const g4 = t4.g;
      act('set_object_state', g4, { map: 'platform', object: 'ivo', state: 'ok' });
      ok(st(g4, 'platform', 'ivo') === 'ok', 'set_object_state platform.ivo ok');
      act('set_object_state', g4, { map: 'kesh', object: 'warden', state: 'dead' });
      ok(st(g4, 'kesh', 'warden') === 'dead', 'set_object_state kesh.warden dead');
      const c1 = Objects.resolveAnker(g4, 'wreck', 'beute')[1];
      act('anker_zustand', g4, { map: 'wreck', anker: c1.id, zustand: 'leer' });
      ok(Objects.ankerState(g4, 'wreck', c1) === 'leer' && chk('anker_state', g4, { map: 'wreck', anker: 'beute', state: 'leer', min: 1 }), 'anker_zustand einzelner Container (auch Hohlraum) leer');
      act('set_object_state', g4, { map: 'wreck', object: 'container', state: 'taken' });
      ok(st(g4, 'wreck', 'container').every((x) => x === 'taken'), 'set_object_state wreck.container taken (alle)');
    }
    // transfer.ziel an der Konsole
    const t2 = setup(1); const g2 = t2.g; const p2 = g2.players[0];
    g2.handleMessage(t2.conns[0], { t: 'ready', ready: true });
    p2.console = 'transfer';
    g2.handleMessage(t2.conns[0], { t: 'cmd', c: 'transfer.ziel', landepunkt: 'gibts.nicht' });
    ok(t2.conns[0].inbox.some((m) => m.kind === 'notice' && /unbekannt|nicht/i.test(m.text)), 'transfer.ziel unbekannt -> Hinweis');
    g2.handleMessage(t2.conns[0], { t: 'cmd', c: 'loadout.waffe', waffe: 'laserschwert' });
    ok(t2.conns[0].inbox.some((m) => m.kind === 'notice' && /Unbekannte Waffe/.test(m.text)), 'loadout.waffe prüft die Waffe');
  }

  section('[B1 F2: Lexikon-Schlüssel der Umsetzungen]');
  {
    const fs = require('fs'); const path = require('path');
    const Lexikon = require('../server/mission/lexikon.js');
    const known = Lexikon.bekannt(); const dir = path.join(__dirname, '..', 'content', 'katalog', 'molekuele');
    const fehlt = []; let zahl = 0;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const txt = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const m of txt.matchAll(/\{\{\s*lex\.([a-z0-9_]+)\s*\}\}/g)) { zahl++; if (!known.has(m[1])) fehlt.push(f + ': ' + m[1]); }
    }
    // Sachnamen (Nominativ mit Artikel) nie direkt nach einer Präposition; Eigennamen (name, ziel_name) dürfen
    const PRAEP = /(^|[^A-Za-zÄÖÜäöüß])(zu|zum|zur|mit|von|vom|aus|bei|nach|seit|durch|für|gegen|ohne|um|in|im|an|am|auf|hinter|vor|unter|über|neben|zwischen)\s+\{\{([a-z_]+)\}\}/gi;
    const praep = [];
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      for (const u of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).umsetzungen || []) {
        const sach = new Set(Object.entries(u.params || {}).filter(([k, d]) => d.typ === 'text' && !['name', 'ziel_name'].includes(k)
          && (/^(der|die|das|ein|eine) /i.test(String(d.default || '')) || /:(der|ein)\}\}$/.test(String(d.default || '')) || /_name$|^was$|^gegenstand$|^gesucht$/.test(k))).map(([k]) => k));
        for (const t of Object.values((u.vorlage && u.vorlage.texte) || {})) for (const m of String(t).matchAll(PRAEP)) if (sach.has(m[3])) praep.push(`${f} ${u.id}: ${m[2]} {{${m[3]}}}`);
      }
    }
    ok(!praep.length, `Sachnamen nie direkt nach Präposition${praep.length ? ' – ' + praep.join(', ') : ''}`);
    ok(zahl > 0 && !fehlt.length, `${zahl} {{lex.*}} in Umsetzungen, alle im Lexikon${fehlt.length ? ' – fehlen: ' + fehlt.join(', ') : ''}`);
    for (const bw of ['germanen', 'rom', 'vorlaeufer', null]) {
      const roh = [...known].filter((k) => k !== 'namen' && k !== 'ort_muster' && !Lexikon.wort(k, bw));   // Auswahllisten des Spielleiters
      ok(!roh.length, `Bauweise ${bw || 'ohne'}: jeder Schlüssel hat ein Wort (sonst neutral)${roh.length ? ' – fehlt: ' + roh.join(', ') : ''}`);
    }
  }

  w1Gefangenschaft();

  console.log(`\n${n - fails}/${n} ok${fails ? ', ' + fails + ' FEHLER' : ''}`);
  process.exit(fails ? 1 : 0);
}

// ---------------------------------------------------------------------------------------------------------
// W1 AP4 (CONTRACT-W1 §5.4 Nr. 1–6): team_gefangen (Laufzeit und Prüfer), ausbruch_erlaubt, fraktion_haltung
function w1Gefangenschaft() {
  const Combat = require('../server/sim/combat.js');
  const L = require('../server/sim/landepunkte.js');
  const Checker = require('../server/mission/checker.js');
  const K = require('../server/mission/katalog.js');
  const LP = 'vaelen.handelsschiff';
  section('W1 AP4: Gefangennahme ohne Kampf (team_gefangen, combat.teamGefangenNehmen)');
  ok(Registry.get('team_gefangen') && Registry.get('team_gefangen').params.landepunkt.typ === 'map' && Registry.get('fraktion_haltung'), 'Bausteine registriert: team_gefangen { landepunkt* (map) }, fraktion_haltung');
  const t = setup(2);
  t.g.debugGoto('vaelen', true);
  t.run(0.2);
  ok(t.g.ship.docked && t.g.ship.dockedAt === 'vaelen', 'Lerche liegt an Vaelen');
  L.get(t.g, LP);
  t.g.players.forEach((p) => { p.waffe = 'blaster'; });
  act('team_gefangen', t.g, { landepunkt: LP });
  const aw = t.g.aways[LP];
  const ps = t.g.players;
  const zellen = Objects.resolveAnker(t.g, LP, 'zelle');
  ok(t.g.away === aw && ps.every((p) => p.zone === 'away'), 'ganze Crew unten auf dem Landepunkt (Transfer, executeBeam)');
  ok(ps.every((p) => p.gefangen && !p.gefangen.offen && p.waffe === 'faust' && p.waffeVorher === 'blaster' && p.zustand === 'ok'), 'gefangen: Faust, Ausrüstung weg (waffeVorher), Zustand ok');
  const z = zellen.find((a) => a.id === ps[0].gefangen.zelle);
  ok(!!z && ps.every((p) => { const tt = Physics.toTile(p.x, p.y); return Math.abs(tt.x - z.x) <= 1 && Math.abs(tt.y - z.y) <= 1; }), 'alle an der Zelle');
  ok(aw.ausbruchGehabt === true && t.ev('teamGefangen').length === 1 && t.oda().some((x) => /in einer Zelle zu euch/.test(x)), 'Ereignis teamGefangen, ODA, ausbruchGehabt (zweites Mal -> Notrückholung)');
  ok(Objects.ankerState(t.g, LP, z) === 'zu', 'Zelle zu');
  const ia = interior.interactionsAt(t.g, ps[0], z.x, z.y, false).filter((x) => !x.blocked);
  ok(ia[0] && ia[0].kind === 'zellentuer' && Combat.holdDurationB2(t.g, ps[0], 'zellentuer') === 8, `an der Zelle zuerst die Zellentür (8 s), nicht anker:zelle (${ia.map((x) => x.kind).join(', ')})`);
  Combat.completeHoldB2(t.g, ps[0], { kind: 'zellentuer' });
  ok(Objects.ankerState(t.g, LP, z) === 'offen' && ps.every((p) => p.gefangen.offen) && t.ev('zelleOffen').length === 1 && (aw.laerm || []).length > 0, 'Zellentür von innen: offen für alle, laut (Lärm), Ereignis zelleOffen');
  const b = Objects.resolveAnker(t.g, LP, 'beute').find((a) => a.id === ps[0].gefangen.beute);
  const ib = interior.interactionsAt(t.g, ps[0], b.x, b.y, false).filter((x) => !x.blocked);
  ok(ib[0] && ib[0].kind === 'ausruestung', `an der Truhe zuerst die eigene Ausrüstung, nicht anker:beute (${ib.map((x) => x.kind).join(', ')})`);
  Combat.completeHoldB2(t.g, ps[0], { kind: 'ausruestung' });
  const halb = Objects.ankerState(t.g, LP, b);
  Combat.completeHoldB2(t.g, ps[1], { kind: 'ausruestung' });
  ok(halb === 'voll' && Objects.ankerState(t.g, LP, b) === 'leer' && ps.every((p) => p.waffe === 'blaster' && !p.waffeVorher), 'Truhe leer erst, wenn alle ihre Ausrüstung haben (Vorlage: anker_state beute leer)');
  Combat.update(t.g, 1 / 30);   // Testspiel steht in der Lobby: Kampf-Tick direkt (updateGefangen)
  ok(ps.every((p) => !p.gefangen), 'nach Tür und Ausrüstung: nicht mehr gefangen');
  const t2 = setup(1);
  t2.g.debugGoto('kesh', false);
  const err = Combat.teamGefangenNehmen(t2.g, 'kesh');
  ok(typeof err === 'string' && /zelle/.test(err) && t2.g.players[0].zone === 'ship', `Landepunkt ohne zelle/beute: Fehlertext, niemand wird verschoben (${err})`);

  section('W1 AP4: Schrittfeld ausbruch_erlaubt (Standard true, Tutorial false)');
  const t3 = setup(1);
  const m = t3.g.mission;
  m.step = { id: 'x' }; m.activeId = null;
  const std = m.ausbruchErlaubt();
  m.step = { id: 'x', ausbruch_erlaubt: false };
  const aus = m.ausbruchErlaubt();
  m.step = { id: 'x', ausbruch_erlaubt: true }; m.activeId = 'm3';
  const tut = m.ausbruchErlaubt();
  ok(std === true && aus === false && tut === false, `mission.ausbruchErlaubt(): Standard ${std}, Feld false ${aus}, Tutorial m3 ${tut}`);
  // combat.ausbruchMoeglich liest das Feld: Team liegt gefesselt auf einer Karte mit zelle und beute
  m.activeId = null; m.step = { id: 'x' };
  L.get(t3.g, LP); t3.g.setAwayMap(LP);
  const p3 = t3.g.players[0];
  interior.placeOnAwayPad(t3.g, p3, 0); t3.g.aways[LP].active = true;
  p3.downed = true; p3.zustand = 'gefesselt';
  const ja = Combat.ausbruchMoeglich(t3.g, [p3]);
  m.step = { id: 'x', ausbruch_erlaubt: false };
  const nein = Combat.ausbruchMoeglich(t3.g, [p3]);
  ok(ja === true && nein === false, `combat.ausbruchMoeglich: Standard ${ja}, ausbruch_erlaubt false -> ${nein} (Notrückholung)`);
  const SCH = require('../content/regiebuch/regiebuch.schema.json');
  const feld = (v) => Checker.validate({ id: 's', objectives: [], ausbruch_erlaubt: v }, SCH.$defs.schritt, '$', [], SCH).filter(([p]) => /ausbruch_erlaubt/.test(p));
  ok(!feld(false).length && feld('nein').length === 1, `Schema: ausbruch_erlaubt ist ein Schrittfeld (bool) – ${feld('nein').map((x) => x.join(' ')).join(' | ')}`);

  section('W1 AP4: Prüfer GEFANGEN-OHNE-DOCK, GEFANGEN-HEIMATHAFEN, Anker zelle/beute');
  const kat = K.load();
  const uA = kat.molekuele.verhandeln.umsetzungen.find((u) => u.id === 'andockkontrolle_eskaliert');
  const uZ = kat.molekuele.ausbruch.umsetzungen.find((u) => u.id === 'zelle_und_kammer');
  const buch = (u, params, molId) => { const { frag } = K.instantiate(u, params, 's1', 'test_ende'); return K.testRegiebuch(frag, molId, u); };
  const codes = (r) => r.errors.map((e) => e.code);
  const gut = Checker.check(buch(uA, uA.test.params, 'verhandeln'));
  ok(gut.ok && !gut.warnings.length && uA.status === 'verfuegbar', 'andockkontrolle_eskaliert (Vaelen) besteht den Prüfer ohne Warnung');
  // Funkduell-Folge an einem Ort ohne Liegeplatz (Nebel, nebel.havarist ist ein Schiff mit Zelle)
  const ohneDock = buch(uA, uA.test.params, 'verhandeln');
  const umziehen = (node) => {   // Ort vaelen -> nebel, Landepunkt vaelen.handelsschiff -> nebel.havarist (überall im Buch)
    if (Array.isArray(node)) { node.forEach((x, i) => { if (x === 'vaelen') node[i] = 'nebel'; else if (x === LP) node[i] = 'nebel.havarist'; else umziehen(x); }); return; }
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) { if (v === 'vaelen') node[k] = 'nebel'; else if (v === LP) node[k] = 'nebel.havarist'; else umziehen(v); }
  };
  umziehen(ohneDock);
  const r1 = Checker.check(ohneDock);
  ok(codes(r1).includes('GEFANGEN-OHNE-DOCK'), `Funkduell-Folge ohne Andock-Ort: GEFANGEN-OHNE-DOCK (${codes(r1).join(', ')})`);
  const heim = buch(uZ, { loc: 'hafen', map: 'hafen.kontor' }, 'ausbruch');
  const r2 = Checker.check(heim);
  ok(codes(r2).includes('GEFANGEN-HEIMATHAFEN'), `Landepunkt am Heimathafen: GEFANGEN-HEIMATHAFEN (${codes(r2).join(', ')})`);
  const hand = buch(uZ, { loc: 'kesh', map: 'kesh' }, 'ausbruch');
  const r3 = Checker.check(hand);
  ok(r3.errors.some((e) => e.code === 'BUEHNE-ANKER' && /team_gefangen/.test(e.msg)), `Landepunkt ohne zelle/beute: BUEHNE-ANKER (${codes(r3).join(', ')})`);
  const stelle = buch(uZ, uZ.test.params, 'ausbruch');
  stelle.steps[0].rules.push({ if: { elapsed: 5 }, do: [{ do: 'team_gefangen', landepunkt: uZ.test.params.map }] });
  const r4 = Checker.check(stelle);
  ok(codes(r4).includes('GEFANGEN-STELLE') && Checker.check(buch(uZ, uZ.test.params, 'ausbruch')).ok, `team_gefangen nur im enter oder als Funkduell-Folge: GEFANGEN-STELLE in rules (${codes(r4).join(', ')})`);

  section('W1 AP4: fraktion_haltung (Weltstand, Fakt haltung_<fraktion>)');
  const Weltstand = require('../server/weltstand.js');
  const t5 = setup(1);
  t5.g.weltstand = Weltstand.create(t5.g, { persistent: false, tutorial: false });
  act('fraktion_haltung', t5.g, { fraktion: 'kontor', delta: -1 });
  act('fraktion_haltung', t5.g, { fraktion: 'kontor', delta: -5 });
  const ws = t5.g.weltstand;
  ok(ws.fraktionHaltung('kontor') === -3 && ws.data.fakten.haltung_kontor === -3 && ws.fraktionHaltung('rostmeute') === 0, `Haltung Kontor −1, dann −5 gekappt auf −3 (Fakt ${ws.data.fakten.haltung_kontor}), andere Fraktion 0`);
}
main();
