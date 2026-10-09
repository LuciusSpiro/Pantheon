'use strict';
// Tests der Sektorkarte (CONTRACT-B3 §3–§5, Team SEKTOR) headless gegen die Game-Klasse.
//   node tools/test-sektoren.js
// Abgedeckt: Geometrie/Daten, Tutorial-Schutz (Faltsprung von überall), Anflugpflicht im freien Spiel, nur offene und
// bekannte Kanten, gesperrte Hexe mit Begründung, Leerraum nur über temporäre Kanten, Notfallsprung nur in spielbare
// Hexe (Seeds), zweiter Notfallsprung als Ausweg aus dem Leerraum, Erkundung überlebt Speichern/Laden, v1/v2-Migration.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Game } = require('../server/game.js');
const Weltstand = require('../server/weltstand.js');
const Sektoren = require('../shared/sektoren.js');
const Locations = require('../shared/locations.js');
const Sprung = require('../server/sim/sprung.js');
const space = require('../server/sim/space.js');
const { dist } = require('../server/util.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const ROOT_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sektoren-'));
let dirSeq = 0;
const freshDir = () => { const d = path.join(ROOT_TMP, 'w' + (++dirSeq)); fs.mkdirSync(d, { recursive: true }); return d; };

// Partie mit einem Spieler; startMission 'm1' (Tutorial), 'free' (Kampagne ohne Tutorial) oder 'm3' (Direktstart)
function setup(startMission, opts) {
  const dir = (opts && opts.dir) || freshDir();
  const g = new Game(Object.assign({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: (opts && opts.seed) || 7, debug: true,
    env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(ROOT_TMP, 'regie') }, log: () => {} }, (opts && opts.game) || {}));
  const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'S0', name: 'Crew', color: 0 });
  if (startMission) {
    g.handleMessage(c, { t: 'lobbyOpt', startMission });
    g.handleMessage(c, { t: 'ready', ready: true });
  }
  const run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) g.step(); };
  const events = (kind) => c.inbox.filter((m) => m.t === 'event' && m.kind === kind);
  return { g, c, dir, run, events };
}
// Lerche frei im Raum an (x, y), Stillstand
function place(g, x, y) {
  const s = g.ship; s.docked = false; s.dockedAt = null; s.x = x; s.y = y; s.vx = 0; s.vy = 0; s.speed = 0;
  s.helm.thrust = 0; s.helm.turn = 0;
}
function jpOf(g, zielHex) { return Sprung.sprungpunkt(g, zielHex); }
// Sprung so weit vorbereiten, dass er auslösbar ist (laden lassen); -> Grund oder null
function charge(t) { const j = t.g.ship.jump; for (let i = 0; i < 30 * 30 && !j.ready; i++) t.g.step(); return j.ready ? null : j.blockedReason; }
function clearEnemies(g) { g.space.enemies = []; }

function main() {
  // ------------------------------------------------------------------------------------------------------------
  section('Daten und Geometrie (shared/sektoren.js, shared/locations.js)');
  ok(Sektoren.KARTE && Sektoren.KARTE.id === 'limes', 'Karte Limes geladen');
  ok(JSON.stringify(Sektoren.nachbarn('0206')) === JSON.stringify(['0205', '0306', '0307', '0207', '0107', '0106']), 'nachbarn(0206) in Richtungsfolge N, NO, SO, S, SW, NW');
  ok(Sektoren.kanteId('0306', '0206') === '0206-0306' && Sektoren.kante('0306', '0206').art === 'open', 'kanteId sortiert, kante(a, b) in beide Richtungen');
  ok(!Sektoren.kante('0307', '0405') && Sektoren.kante('0405', '0406').art === 'open', 'E32: nebel–wrack entfällt, b7–wrack kommt dazu');
  ok(Sektoren.kantenVon('0308').length === 2 && Sektoren.kantenVon('0308').some((e) => e.art === 'far'), 'Relais: Nebel-Kante + Fernsprung Eridu');
  ok(Locations.get('leer-0106') && Locations.get('leer-0106').kind === 'void' && Locations.get('leer-0106') === Locations.get('leer-0106'), "Locations.get('leer-0106') liefert die (gleiche) Leerraum-Szene");
  ok(!Locations.get('leer-0206') && !Locations.get('leer-9999'), 'leer-<hex> nur für Leerraum im Raster');
  ok(Locations.get('wrack').links.join() === 'splitter,b7' && Locations.get('nebel').links.join() === 'b7,vaelen,relais', 'Ort-Links aus limes.json abgeleitet');
  ok(Sektoren.fuerClient() && !('praesenz' in Sektoren.fuerClient()), 'welcome.sektorkarte ohne praesenz');
  {
    const p = Sektoren.sprungpunktLage(2000, 1400, 0, 180);
    const q = Sektoren.sprungpunktLage(2000, 1400, 2, 180);
    ok(p.x === 1000 && p.y === 180 && q.x > 1000 && q.y > 700, 'Sprungpunkt vor dem Szenenrand in Kantenrichtung (randAbstand)');
  }

  // ------------------------------------------------------------------------------------------------------------
  section('Tutorial-Schutz (§0.1): Faltsprung von überall, Ort-Links wie heute');
  {
    const t = setup('m1'); const g = t.g;
    ok(g.weltstand.persistent && Sprung.tutorialLaeuft(g) && !Sprung.anflugPflicht(g), 'Kampagne mit Tutorial: keine Anflugpflicht');
    place(g, 1200, 300); clearEnemies(g);
    ok(Sprung.selectDest(g, 'splitter') === null, 'Hafen -> Splittergürtel wählbar');
    ok(charge(t) === null, 'Antrieb lädt ohne Anflug (Abstand zur Station ≥ 300)');
    ok(Sprung.doJump(g) === null && g.ship.scene === 'splitter', 'Faltsprung zum Splittergürtel');
    const arr = Locations.get('splitter').scene.arrive;
    ok(g.ship.x === arr.x && g.ship.y === arr.y, 'Ankunft an scene.arrive wie heute');
    ok(g.explore.erkundet.has('0306') && t.events('hexErkundet').some((e) => e.hex === '0306'), 'Hex 0306 erkundet (Ereignis hexErkundet)');
    ok(Sprung.selectDest(g, 'relais') === 'Keine bekannte Route dorthin – erst über einen Nachbarort.', 'kein Nachbar: alte Begründung');
    const t3 = setup('m3');
    ok(!t3.g.weltstand.persistent && !Sprung.anflugPflicht(t3.g), 'Direktstart m3: keine Anflugpflicht');
    const prev = g.C.sektoren.tutorialFrei; g.C.sektoren.tutorialFrei = false;
    ok(Sprung.anflugPflicht(g), 'CONFIG.sektoren.tutorialFrei = false schaltet den Schutz ab');
    g.C.sektoren.tutorialFrei = prev;
  }

  // ------------------------------------------------------------------------------------------------------------
  section('Freies Spiel (Kampagne ohne Tutorial): offene Kanten, Anflug, Ankunft am Sprungpunkt');
  {
    const t = setup('free'); const g = t.g; const ex = g.explore;
    ok(g.weltstand.data.tutorial === 'uebersprungen' && Sprung.anflugPflicht(g), 'Kampagne ohne Tutorial: Anflugpflicht');
    place(g, 1200, 300); clearEnemies(g);
    ok(Sprung.selectDest(g, 'splitter') === null, 'Hafen -> Splittergürtel (bekannte, offene Kante)');
    g.step();
    ok(/^Sprungpunkt Splittergürtel anfliegen \(\d+ m\)$/.test(g.ship.jump.blockedReason || ''), `Grund: „${g.ship.jump.blockedReason}“`);
    ok(g.ship.jump.jp === '0206-0306' && g.ship.jump.d > 250, 'ship.jump.jp = Kante, d = Abstand');
    const p = jpOf(g, '0306'); place(g, p.x - 100, p.y);
    ok(charge(t) === null, 'im Radius: Antrieb lädt');
    ok(Sprung.doJump(g) === null && g.ship.scene === 'splitter', 'Sprung über die Kante');
    const back = Sprung.sprungpunkt(g, '0206');
    ok(dist(g.ship.x, g.ship.y, back.x, back.y) <= g.C.sektoren.sprungpunktRadius && Math.abs(g.ship.angle - Sektoren.winkel(Sektoren.richtung('0206', '0306'))) < 1e-9,
      'Ankunft am Sprungpunkt der Gegenkante, Blick in Flugrichtung');
    ok(Sprung.selectDest(g, 'relais') === 'Kein Sprungpunkt dorthin.', 'kein Nachbar -> abgelehnt');
    ok(/^Sektor gesperrt – Grenzposten Statio Limitis/.test(Sprung.selectDest(g, '0305') || ''), 'Statio Limitis: „Sektor gesperrt“ mit sperrtext der Region');
    ex.linksOpen.delete('kesh'); ex.version++;
    ok(Sprung.selectDest(g, 'kesh') === 'Sprungpunkt gesperrt.', 'gesperrte Kante (kesh zu) -> „Sprungpunkt gesperrt.“');
    ex.linksOpen.add('kesh');
    ok(Sprung.selectDest(g, 'kesh') === null, 'nach Öffnen des Schlüssels wählbar');
    ok(Sprung.selectDest(g, '0306') === 'Da sind wir doch schon.' && Sprung.selectDest(g, '0406') === null && g.ship.jump.dest === 'b7', 'Ziel als Hex-Code (SSZZ) wird zur Ort-ID');
    // Jagd auf unbekannte Bojen: Erkundungsstand wie am Anfang
    ex.known = new Set(['hafen', 'splitter']); ex.visited = new Set(['hafen', 'splitter']); ex.bojenGefunden = new Set(); ex.version++;
    ok(!ex.bojeBekannt('0306-0406') && /Boje suchen/.test(Sprung.selectDest(g, 'b7') || ''), 'unbekannte Boje (B-7 unbekannt) -> nicht wählbar');
    const q = jpOf(g, '0406'); place(g, q.x - 300, q.y); t.c.inbox.length = 0;
    ex.widescanAt(g.ship.x, g.ship.y, g.C.widescan.radius);
    ok(ex.bojeBekannt('0306-0406') && t.events('bojeGefunden').some((e) => e.kante === '0306-0406'), 'Weitscan findet die Boje (Ereignis bojeGefunden)');
    ok(Sprung.selectDest(g, 'b7') === null, 'danach wählbar');
    const nord = jpOf(g, '0305'); place(g, nord.x, nord.y + 200);
    ex.widescanAt(g.ship.x, g.ship.y, g.C.widescan.radius);
    ok(ex.bojeBekannt('0305-0306'), 'Weitscan findet auch die Boje nach Statio Limitis (gesperrte Kante)');
    const jp = Sprung.jpSnapshot(g);
    ok(jp.length >= 3 && jp.length <= 6 && jp.every((b) => b.k && Number.isFinite(b.x) && b.n && ['aktiv', 'gesperrt', 'temporaer', 'ohne_strom'].includes(b.z)), `space.jp: ${jp.length} bekannte Bojen`);
    ok(jp.find((b) => b.n === '0305').z === 'gesperrt' && jp.find((b) => b.n === '0406').z === 'aktiv', 'Bojen-Zustand: Statio gesperrt, B-7 aktiv');
    const snap = ex.sektorenSnapshot();
    ok(snap.e.includes('0306') && snap.b.includes('0306-0406') && Number.isFinite(snap.v), 'world.sektoren { e, b, t, o, v }');
  }

  // ------------------------------------------------------------------------------------------------------------
  section('Rostnest (E33) und Leerraum (E30): nur über temporäre Sprungpunkte');
  {
    const t = setup('free'); const g = t.g; const ex = g.explore;
    clearEnemies(g);
    space.enterScene(g, 'vaelen', {}); ex.arrive('vaelen');
    ok(/^Sektor gesperrt/.test(Sprung.selectDest(g, '0107') || ''), 'Rostnest (0107): Sektor gesperrt');
    ok(Sprung.oeffnen(g, { von: 'vaelen', nach: '0107', temp: true }) !== null, 'temporärer Sprungpunkt ins Rostnest abgelehnt');
    ok(Sprung.bojeAufdecken(g, '0107-0207') !== null && !ex.bojeBekannt('0107-0207'), 'hidden-Kante Vaelen–Rostnest bleibt verborgen');
    space.enterScene(g, 'hafen', {}); ex.arrive('hafen'); place(g, 1000, 300);
    ok(/Leerraum/.test(Sprung.selectDest(g, 'leer-0106') || ''), 'Leerraum ohne temporären Sprungpunkt nicht wählbar');
    ok(Sprung.oeffnen(g, { von: 'hafen', nach: '0105', temp: true }) !== null, 'temporär nur zwischen Nachbarn');
    ok(Sprung.oeffnen(g, { von: 'hafen', nach: '0106', temp: true, bis: 'mission' }) === null && t.events('sprungpunktOffen').some((e) => e.kante === '0106-0206' && e.temp), 'temporärer Sprungpunkt Hafen -> 0106 (sprungpunktOffen)');
    ok(Sprung.selectDest(g, 'leer-0106') === null, 'jetzt wählbar');
    ok(Sprung.jpSnapshot(g).some((b) => b.k === '0106-0206' && b.z === 'temporaer'), 'Boje „temporaer“ in space.jp');
    const p = jpOf(g, '0106'); place(g, p.x, p.y);
    ok(charge(t) === null && Sprung.doJump(g) === null && g.ship.scene === 'leer-0106', 'Sprung in den Leerraum (leere Szene aus Daten)');
    ok(g.space.asteroids.length === 0 && g.space.w === g.C.sektoren.leerraumSzene.w && ex.erkundet.has('0106') && !ex.visited.has('leer-0106'), 'Leerraum: leere Szene, Hex erkundet, kein Ort');
    Sprung.missionEnde(g);
    ok(!ex.tempKante('0106-0206') && t.events('sprungpunktZu').some((e) => e.kante === '0106-0206'), 'Missionsende schließt den temporären Sprungpunkt');
    ok(Sprung.selectDest(g, 'hafen') !== null, 'ohne temporäre Kante kein regulärer Weg hinaus');
  }

  // ------------------------------------------------------------------------------------------------------------
  section('Notfallsprung: nur spielbare Hexe, Reaktor offline, zweiter Sprung als Ausweg');
  {
    const t = setup('free'); const g = t.g;
    ok(Sprung.notsprung(g) === 'Erst ablegen.', 'angedockt: kein Notfallsprung');
    place(g, 1000, 300); clearEnemies(g);
    const p = g.players[0]; p.zone = 'away';
    ok(/Außenteam/.test(Sprung.notsprung(g) || ''), 'Außenteam unten: kein Notfallsprung');
    p.zone = 'ship';
    const hull = g.ship.hull; t.c.inbox.length = 0;
    ok(Sprung.notsprung(g) === null, 'Notfallsprung aus dem Hafen');
    const ev = t.events('notsprung')[0];
    ok(ev && ev.von === '0206' && Sektoren.sindNachbarn('0206', ev.nach) && Sektoren.spielbar(ev.nach) && Sektoren.hexVonOrt(g.ship.scene) === ev.nach, `Ereignis notsprung { von: 0206, nach: ${ev && ev.nach} }`);
    ok(g.ship.reactorCtl.state === 'offline' && g.ship.hull === hull - g.C.sektoren.notsprung.huelle, 'Reaktor offline, Hülle −15');
    ok(/Reaktor offline/.test(Sprung.notsprung(g) || ''), 'zweiter Notfallsprung erst nach dem Reaktor-Neustart');
    const sc = Locations.get(g.ship.scene).scene;
    ok(g.ship.x >= sc.w / 3 - 1 && g.ship.x <= sc.w * 2 / 3 + 1 && g.ship.y >= sc.h / 3 - 1 && g.ship.y <= sc.h * 2 / 3 + 1, 'Ankunft im mittleren Drittel');
  }
  {
    // Seeds: aus Vaelen (Nachbarn: Rostnest 0107 nicht spielbar, Leerraum 0108/0106/…) landet er nie in einem gesperrten Hex
    const ziele = {}; let schlecht = 0; const det = [];
    for (let seed = 1; seed <= 40; seed++) {
      const t = setup('free', { seed }); const g = t.g; clearEnemies(g);
      space.enterScene(g, 'vaelen', {}); g.explore.arrive('vaelen'); place(g, 1100, 800); g.ship.angle = seed * 0.7;
      Sprung.notsprung(g);
      const h = Sektoren.hexVonOrt(g.ship.scene);
      if (!Sektoren.spielbar(h) || !Sektoren.sindNachbarn('0207', h)) schlecht++;
      ziele[h] = (ziele[h] || 0) + 1;
      if (seed <= 3) det.push(h);
    }
    ok(schlecht === 0 && !ziele['0107'], `40 Seeds aus Vaelen: nur spielbare Nachbarhexe (${Object.entries(ziele).map(([h, k]) => h + '×' + k).join(', ')})`);
    const again = [1, 2, 3].map((seed) => { const t = setup('free', { seed }); const g = t.g; clearEnemies(g); space.enterScene(g, 'vaelen', {}); g.explore.arrive('vaelen'); place(g, 1100, 800); g.ship.angle = seed * 0.7; Sprung.notsprung(g); return Sektoren.hexVonOrt(g.ship.scene); });
    ok(JSON.stringify(again) === JSON.stringify(det), 'deterministisch (game.rng): gleicher Seed, gleiches Ziel');
    // Flugrichtung: Kurs Süd (Richtung 3) -> Ziel Süd bevorzugt (erwartet 4/9,5 ≈ 42 %, gleichverteilt 20 %)
    const zaehl = {};
    for (let seed = 1; seed <= 150; seed++) {
      const g = new Game({ noStore: true, worlds: false, seed, log: () => {}, env: { MISSION_SOURCE: 'fallback' } });
      g.weltstand.persistent = true; g.weltstand.data.tutorial = 'uebersprungen';   // freies Spiel ohne Kampagnenstart
      place(g, 1000, 300); clearEnemies(g); g.ship.angle = Sektoren.winkel(3);
      Sprung.notsprung(g);
      const h = Sektoren.hexVonOrt(g.ship.scene); zaehl[h] = (zaehl[h] || 0) + 1;
    }
    const sued = zaehl['0207'] || 0;
    ok(sued >= 45 && Object.values(zaehl).every((k) => k <= sued), `bevorzugt in Flugrichtung: Kurs Süd -> Vaelen ${sued}/150 (${Object.entries(zaehl).map(([h, k]) => h + '×' + k).join(', ')})`);
  }
  {
    // Ausweg aus dem Leerraum über viele Seeds: Notfallsprung -> Leerraum, Reaktor-Neustart, zweiter Notfallsprung -> System
    let rein = 0, raus = 0, versuche = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const t = setup('free', { seed }); const g = t.g; clearEnemies(g);
      space.enterScene(g, 'leer-0106', {}); g.explore.arrive('leer-0106'); place(g, 1200, 900);
      versuche++;
      if (Sektoren.istLeerraum(Sektoren.hexVonOrt(g.ship.scene))) rein++;
      space.reactorOnline(g, 'Test');
      const e = Sprung.notsprung(g);
      const h = Sektoren.hexVonOrt(g.ship.scene);
      if (!e && !Sektoren.istLeerraum(h) && Sektoren.spielbar(h)) raus++;
    }
    ok(rein === versuche && raus === versuche, `aus dem Leerraum 0106: ${raus}/${versuche} Notfallsprünge führen in ein System`);
    // Kette: Hafen -> (Notsprung, bis Leerraum) -> Neustart -> Notsprung hinaus
    let gezeigt = false;
    for (let seed = 1; seed <= 60 && !gezeigt; seed++) {
      const t = setup('free', { seed }); const g = t.g; clearEnemies(g); place(g, 1000, 300);
      g.ship.angle = Sektoren.winkel(5);   // Kurs NW -> 0106
      Sprung.notsprung(g);
      if (!g.ship.scene.startsWith('leer-')) continue;
      ok(/Reaktor offline/.test(Sprung.notsprung(g) || ''), `Seed ${seed}: im Leerraum ${g.ship.scene}, Reaktor offline -> noch kein zweiter Sprung`);
      g.ship.reactorCtl.offlineT = g.C.reactorM1.autoRestartAfter; t.run(0.1);
      ok(g.ship.reactorCtl.state === 'online', 'Reaktor-Neustart (Hilfsbatterie nach autoRestartAfter)');
      ok(Sprung.notsprung(g) === null && !g.ship.scene.startsWith('leer-'), `zweiter Notfallsprung führt hinaus: ${g.ship.scene}`);
      gezeigt = true;
    }
    ok(gezeigt, 'Kette Hafen -> Leerraum -> hinaus gezeigt');
  }

  // ------------------------------------------------------------------------------------------------------------
  section('Erkundung überlebt Speichern und Laden (welt.sektoren), Migration v1/v2');
  {
    const t = setup('free'); const g = t.g; const ex = g.explore;
    ex.erkunde('0105'); ex.markBoje('0306-0405');
    Sprung.oeffnen(g, { von: '0206', nach: '0106', temp: true, bis: 'immer' });
    Sprung.oeffnen(g, { von: '0206', nach: '0105', temp: true });   // keine Nachbarn -> abgelehnt
    const vorher = ex.sektorenToSave();
    ok(vorher.erkundet.includes('0105') && vorher.temp.some((x) => x.id === '0106-0206' && x.bis === 'immer'), 'Stand vor dem Speichern: erkundet + temp');
    const data = Weltstand.capture(g);
    ok(data.welt && data.welt.sektoren && JSON.stringify(data.welt.sektoren.erkundet) === JSON.stringify(vorher.erkundet), 'capture: welt.sektoren (ENGINE) = explore.sektorenToSave()');
    const t2 = setup(null); const g2 = t2.g;
    Weltstand.apply(g2, JSON.parse(JSON.stringify(data)));
    const nachher = g2.explore.sektorenToSave();
    ok(JSON.stringify(nachher.erkundet) === JSON.stringify(vorher.erkundet), 'erkundete Hexe identisch');
    ok(JSON.stringify(nachher.bojen.slice().sort()) === JSON.stringify(vorher.bojen.slice().sort()), 'gefundene Bojen identisch');
    ok(JSON.stringify(nachher.temp) === JSON.stringify(vorher.temp) && JSON.stringify(nachher.offen) === JSON.stringify(vorher.offen), 'temporäre und offene Kanten identisch');
    ok(Sprung.toSave(g2).erkundet.length === nachher.erkundet.length, 'sprung.toSave/restore delegieren an explore');
  }
  for (const f of ['v1.nach-tutorial.json', 'v2.mitten-m2.json']) {
    const dir = freshDir();
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'weltstand', f), 'utf8'));
    fs.writeFileSync(path.join(dir, raw.id + '.json'), JSON.stringify(raw));
    const t = setup(null, { dir }); const g = t.g;
    const r = Weltstand.load(dir, raw.id, g);
    if (!r.ok) { ok(false, `${f}: laden (${r.error})`); continue; }
    Weltstand.apply(g, r.data);
    const ex = g.explore;
    const hexBesucht = raw.welt.orte.besucht.map((id) => Sektoren.hexVonOrt(id));
    ok(hexBesucht.every((h) => ex.erkundet.has(h)), `${f}: erkundet = Hexe aller besuchten Orte (${ex.erkundet.size})`);
    ok(ex.bojeBekannt('0206-0306') && (raw.welt.orte.bekannt.includes('wrack') ? ex.bojeBekannt('0306-0405') : true), `${f}: Bojen zwischen bekannten Orten bekannt`);
    ok((raw.welt.verbindungen_offen || []).includes('kesh') === ex.kanteOffen('0205-0206'), `${f}: offen aus verbindungen_offen`);
  }

  console.log(`\n${n - fails}/${n} Prüfungen bestanden.`);
  try { fs.rmSync(ROOT_TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
  if (fails) { console.log(`${fails} FEHLER.`); process.exit(1); }
  console.log('Sektoren-Tests OK.');
  process.exit(0);
}

main();
