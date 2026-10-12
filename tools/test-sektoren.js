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
  section('Tutorial (E29, Nachtrag W1): Anflug wie überall, Zielwahl über Ort-Links');
  {
    const t = setup('m1'); const g = t.g;
    ok(g.weltstand.persistent && Sprung.tutorialLaeuft(g) && Sprung.anflugPflicht(g) && Sprung.zielwahlUeberOrtLinks(g), 'Kampagne mit Tutorial: Anflugpflicht, Zielwahl über Ort-Links');
    ok(!('tutorialFrei' in g.C.sektoren), 'CONFIG.sektoren.tutorialFrei entfällt');
    place(g, 1200, 300); clearEnemies(g);
    ok(Sprung.selectDest(g, 'splitter') === null, 'Hafen -> Splittergürtel wählbar');
    g.step();
    ok(/^Sprungpunkt Splittergürtel anfliegen \(\d+ m\)$/.test(g.ship.jump.blockedReason || ''), `ohne Anflug gesperrt: „${g.ship.jump.blockedReason}“`);
    ok(g.snapshot().ship.jump.anflug === true, 'Snapshot ship.jump.anflug = true im Tutorial');
    ok((g.snapshot().space.jp || []).some((b) => b.k === '0206-0306'), 'space.jp enthält die Kante des Ziels');
    const p = jpOf(g, '0306'); place(g, p.x - 100, p.y);
    ok(charge(t) === null, 'am Sprungpunkt: Antrieb lädt');
    ok(Sprung.doJump(g) === null && g.ship.scene === 'splitter', 'Faltsprung zum Splittergürtel');
    const q = Sprung.sprungpunkt(g, '0206');
    ok(q && g.ship.x === q.x && g.ship.y === q.y, 'Ankunft am Gegen-Sprungpunkt (nicht mehr scene.arrive)');
    ok(g.explore.erkundet.has('0306') && t.events('hexErkundet').some((e) => e.hex === '0306'), 'Hex 0306 erkundet (Ereignis hexErkundet)');
    ok(Sprung.selectDest(g, 'relais') === 'Keine bekannte Route dorthin – erst über einen Nachbarort.', 'kein Nachbar: alte Begründung');
    // Ziel über Ort-Link wählbar, auch wenn die Boje noch unbekannt ist; jp enthält sie trotzdem (Ring/Randpfeil/Bots)
    const kw = Sektoren.kanteId('0306', Sektoren.hexVonOrt('wrack'));
    g.explore.known.delete('wrack'); g.explore.erkundet.delete(Sektoren.hexVonOrt('wrack')); g.explore.bojenGefunden.delete(kw);
    ok(!g.explore.bojeBekannt(kw) && Sprung.selectDest(g, 'wrack') === null, 'Tutorial: Ziel mit unbekannter Boje über Ort-Link wählbar');
    ok((g.snapshot().space.jp || []).some((b) => b.k === kw), 'space.jp enthält die unbekannte Boje des gewählten Ziels');
    const t3 = setup('m3');
    ok(!t3.g.weltstand.persistent && Sprung.anflugPflicht(t3.g) && Sprung.zielwahlUeberOrtLinks(t3.g), 'Direktstart m3: Anflugpflicht, Zielwahl über Ort-Links');
  }

  // ------------------------------------------------------------------------------------------------------------
  section('Sprungpunkt-Automatik (Kampagne ohne Tutorial): kein Zielwahl-Zwang');
  {
    const t = setup('free'); const g = t.g; const j = g.ship.jump;
    place(g, 1200, 700); clearEnemies(g); g.step();
    ok(j.dest === null && !!j.blockedReason, 'weit weg vom Sprungpunkt: kein Ziel');
    const p = jpOf(g, '0306'); place(g, p.x - 100, p.y); g.step();
    ok(j.dest === 'splitter', 'im Radius: Sprungpunkt wird von selbst Ziel (ohne selectDest)');
    ok(g.explore.bojeBekannt('0206-0306'), 'Boje gilt als gefunden');
    for (let i = 0; i < 30 * 40 && !j.ready; i++) g.step();
    ok(j.ready && Sprung.doJump(g) === null && g.ship.scene === 'splitter', 'Leiste voll: Sprung möglich');
    for (let i = 0; i < 60; i++) g.step();
    ok(j.dest === null && !j.ready, 'Ankunft am Gegen-Sprungpunkt: kein Rücksprung-Ziel, bis die Lerche ihn verlassen hat');
  }

  section('Freies Spiel (Kampagne ohne Tutorial): offene Kanten, Anflug, Ankunft am Sprungpunkt');
  {
    const t = setup('free'); const g = t.g; const ex = g.explore;
    ok(g.weltstand.data.tutorial === 'uebersprungen' && Sprung.anflugPflicht(g), 'Kampagne ohne Tutorial: Anflugpflicht');
    place(g, 1200, 700); clearEnemies(g);
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
    ok(Sprung.selectDest(g, 'relais') === null && ['nebel', 'b7'].includes(g.ship.jump.dest), 'kein Nachbar, aber Weg über bekannte Sprungpunkte: der nächste Sprung wird das Ziel (' + g.ship.jump.dest + ')');
    ok(Sprung.selectDest(g, 'leer-0106') === 'Leerraum – kein Sprungpunkt dorthin.' || Sprung.selectDest(g, 'leer-0106') === 'Kein Sprungpunkt dorthin.', 'ohne Weg -> abgelehnt');
    ok(/Boje suchen/.test(Sprung.selectDest(g, '0305') || ''), 'Splittergürtel -> Statio Limitis (EK7: spielbar): Boje unbekannt, erst suchen');
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
    ok(Sprung.selectDest(g, '0305') === 'Imperium: Durchflug gesperrt.', 'bekannte Boje, Kante tutorial-ende zu: Sperrtext der Region');
    ex.openLink('tutorial-ende');
    ok(Sprung.selectDest(g, '0305') === null && g.ship.jump.dest === 'statio_limitis', 'tutorial-ende offen: Splittergürtel -> Statio Limitis wählbar (Ort-ID statio_limitis)');
    ex.linksOpen.delete('tutorial-ende'); g.ship.jump.dest = null;
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
  section('EK7: Szenen aus Daten (gen), Tutorial unverändert');
  {
    const t = setup('m1'); const g = t.g;
    ok(Locations.LOCATIONS.length === 8 && Locations.get('statio_limitis') && !Locations.LOCATIONS.some((l) => l.gen), 'LOCATIONS bleibt bei 8 Orten, Szenen aus Daten stehen nicht darin');
    ok(Locations.get('statio_limitis') === Locations.get('statio_limitis') && Locations.get('statio_limitis').hex === '0305' && Sektoren.hexVonOrt('statio_limitis') === '0305' && Sektoren.ortVonHex('0305') === 'statio_limitis', 'Ort statio_limitis = Hex 0305');
    ok(Locations.LOCATIONS.map((l) => l.id + ':' + l.links.join('+')).join(' ') === 'hafen:splitter+vaelen+kesh splitter:hafen+b7+wrack+kesh b7:splitter+wrack+nebel vaelen:hafen+nebel wrack:splitter+b7 nebel:b7+vaelen+relais relais:nebel kesh:hafen+splitter', 'Ort-Links der Saumraum-Orte unverändert (wie vor EK7)');
    ok(!Locations.get('splitter').links.includes('statio_limitis') && Locations.get('statio_limitis').links.length === 0, 'Ort-Links: Statio Limitis kommt in keinem Ort-Link vor (Tutorial-Schutz)');
    ok(g.explore.locationsSnapshot().length <= 8 && g.explore.locationsSnapshot().every((l) => !Locations.get(l.id).gen), 'Snapshot world.locations: nur Saumraum-Orte');
    // Notfallsprung aus dem Splittergürtel (Nachbar Statio Limitis): im Tutorial nie dorthin, im freien Spiel manchmal
    let imTutorial = 0, frei = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const a = setup('m1', { seed }); clearEnemies(a.g); space.enterScene(a.g, 'splitter', {}); a.g.explore.arrive('splitter'); place(a.g, 1500, 800);
      Sprung.notsprung(a.g); if (Sektoren.hexVonOrt(a.g.ship.scene) === '0305') imTutorial++;
      const b = setup('free', { seed }); clearEnemies(b.g); space.enterScene(b.g, 'splitter', {}); b.g.explore.arrive('splitter'); place(b.g, 1500, 800);
      Sprung.notsprung(b.g); if (Sektoren.hexVonOrt(b.g.ship.scene) === '0305') frei++;
    }
    ok(imTutorial === 0, `60 Seeds im Tutorial: Notfallsprung aus dem Splittergürtel nie nach Statio Limitis (${imTutorial})`);
    ok(frei > 0, `freies Spiel: Notfallsprung aus dem Splittergürtel erreicht Statio Limitis (${frei}/60)`);
    // Ankunft in einer Szene aus Daten: Erstbesuch, bekannt/besucht, Weltstand merkt den Ort
    const f = setup('free'); const gf = f.g; clearEnemies(gf);
    Sprung.debugErkundeAlle(gf); Sprung.debugHex(gf, '0304');
    ok(gf.ship.scene === 'ferraria' && gf.space.asteroids.length === 24 && gf.space.w === 3000 && gf.explore.visited.has('ferraria') && gf.explore.erkundet.has('0304'), 'Ferraria: Szene aus Daten (24 Brocken, 3000 × 2200), besucht, erkundet');
    const data = Weltstand.capture(gf);
    ok(data.welt.orte.besucht.includes('ferraria'), 'Weltstand: besuchter Ort ferraria gespeichert');
    const f2 = setup(null); Weltstand.apply(f2.g, JSON.parse(JSON.stringify(data)));
    ok(f2.g.explore.visited.has('ferraria') && f2.g.explore.known.has('ferraria'), 'Weltstand laden: ferraria bleibt besucht (Ort-ID gültig)');
  }

  // ------------------------------------------------------------------------------------------------------------
  section('EK7: sperrriegel (Weltstand-Schlüssel) öffnet 0504–0604, 0604–0605, 0604–0705');
  {
    const SK = ['0504-0604', '0604-0605', '0604-0705'];
    const t = setup('free'); const g = t.g; const ex = g.explore; clearEnemies(g);
    Sprung.debugErkundeAlle(g); Sprung.debugHex(g, '0504');
    ok(SK.every((k) => !ex.kanteOffen(k)) && !ex.sperrriegelOffen(), 'zu Beginn alle drei Kanten zu');
    ok(Sprung.selectDest(g, '0604') === 'Germanisches Gebiet: Sperrflotten an allen Sprungpunkten.', 'Vorfeld -> Wolfstor: Sperrtext der Region');
    ok(ex.kanteOffen('0604-0704') && ex.kanteOffen('0504-0505') && ex.kanteOffen('0505-0605') && ex.kanteOffen('0605-0705'), 'Vorfeld–Dunkelriff–Nebelheim–Methalle sind offen, Wolfstor–Eisenwald auch (nur über Wolfstor erreichbar)');
    t.c.inbox.length = 0;
    const snap0 = g.snapshot().world.sektoren;
    ok(ex.sperrriegelOeffnen() === true && ex.sperrriegelOffen() && ex.linksOpen.has('sperrriegel'), 'sperrriegelOeffnen(): Schlüssel gesetzt');
    ok(ex.sperrriegelOeffnen() === false, 'zweiter Aufruf: nichts mehr zu tun');
    ok(SK.every((k) => ex.kanteOffen(k)) && !ex.kanteOffen('0305-0306'), 'genau die drei Kanten offen, tutorial-ende bleibt zu');
    ok(g.weltstand.data.fakten.sperrriegel === true && g.weltstand.data.faktenQuelle.sperrriegel === 'Methalle', 'Weltstand-Fakt sperrriegel = true (Quelle Methalle)');
    ok(t.events('sperrriegelOffen').length === 1 && SK.every((k) => ex.bojeBekannt(k)), 'Ereignis sperrriegelOffen, Bojen der drei Kanten bekannt');
    const snap1 = g.snapshot().world.sektoren;
    ok(snap1 && SK.every((k) => snap1.o.includes(k)) && (!snap0 || snap1.v !== snap0.v), 'Snapshot world.sektoren.o enthält die Kanten, Version ändert sich');
    ok(Sprung.selectDest(g, '0604') === null && g.ship.jump.dest === 'wolfstor', 'Vorfeld -> Wolfstor jetzt wählbar');
    g.ship.jump.dest = null;
    // Speichern und Laden
    const data = Weltstand.capture(g);
    ok(SK.every((k) => data.welt.sektoren.offen.includes(k)) && data.welt.verbindungen_offen.includes('sperrriegel') && data.welt.fakten.sperrriegel === true, 'capture: verbindungen_offen, sektoren.offen und fakten tragen sperrriegel');
    const t2 = setup(null); Weltstand.apply(t2.g, JSON.parse(JSON.stringify(data)));
    ok(SK.every((k) => t2.g.explore.kanteOffen(k)) && t2.g.explore.sperrriegelOffen(), 'nach Laden: Kanten offen');
    // Der Fakt allein (Baustein welt_fakt / Spielleiter) öffnet die Kanten ebenfalls
    const t3 = setup('free'); t3.g.weltstand.fact('sperrriegel', true, 'test');
    ok(SK.every((k) => t3.g.explore.kanteOffen(k)) && !t3.g.explore.linksOpen.has('sperrriegel'), 'welt_fakt sperrriegel = true öffnet die Kanten (ohne verbindungen_offen)');
    ok(t3.g.explore.sperrriegelOeffnen() === true && SK.every((k) => t3.g.explore.bojeBekannt(k)), 'Fakt zuerst, dann sperrriegelOeffnen(): setzt trotzdem Schlüssel und macht die Bojen bekannt');
    const t4 = setup('free'); t4.g.weltstand.fact('sperrriegel', false, 'test');
    ok(SK.every((k) => !t4.g.explore.kanteOffen(k)), 'Fakt false: Kanten bleiben zu');
    // Baustein
    const Registry = require('../server/mission/registry.js');
    const e = Registry.get('sperrriegel_oeffnen');
    ok(e && e.art === 'aktion' && !Object.keys(e.params).length, 'Baustein sperrriegel_oeffnen {} registriert');
    const t5 = setup('free'); e.run({ game: t5.g }, {});
    ok(SK.every((k) => t5.g.explore.kanteOffen(k)), 'Baustein sperrriegel_oeffnen öffnet die Kanten');
  }

  // ------------------------------------------------------------------------------------------------------------
  section('EK7: Häfen Castra Martis und Statio Limitis (Einkauf, Marken, ohne Ruf)');
  {
    const shop = require('../server/sim/shop.js');
    for (const [ort, hex] of [['castra_martis', '0202'], ['statio_limitis', '0305']]) {
      const t = setup('free'); const g = t.g; clearEnemies(g);
      Sprung.debugErkundeAlle(g); Sprung.debugHex(g, hex);
      const sc = Locations.get(ort).scene;
      ok(!g.ship.docked && sc.dock && shop.shopContext(g) === null, `${ort}: Liegeplatz vorhanden, frei fliegend, kein Hafenterminal`);
      place(g, sc.dock.x + 30, sc.dock.y); g.ship.dockArmed = true; g.step();
      ok(g.ship.docked && g.ship.dockedAt === ort && g.snapshot().shopContext === 'hafen', `${ort}: Dock-Ring langsam angeflogen -> angedockt, shopContext hafen`);
      const marks = g.inventory.marks; const p = g.players[0];
      ok(shop.buy(g, p, 'ersatzteil') === null && g.inventory.marks === marks - 40, `${ort}: Ersatzteil gekauft (−40 Marken)`);
      g.inventory.marks += 500;
      ok(shop.buy(g, p, 'schildpool') === null && g.upgrades.schildpool === true, `${ort}: Hafensortiment (Schildpool) wie Lichtkordon`);
      ok(shop.buy(g, p, 'kristalllampe') !== null, `${ort}: Vaelen-Sortiment bleibt bei der Karawane`);
      ok(g.weltstand.fraktionHaltung('kontor') === 0 && !Object.keys(g.weltstand.data.fakten).some((k) => /^haltung_/.test(k)), `${ort}: kein Ruf (keine Haltung gesetzt oder verlangt)`);
      // Weltstand fortsetzen: angedockt im Hafen
      const data = Weltstand.capture(g);
      const t2 = setup(null); Weltstand.apply(t2.g, JSON.parse(JSON.stringify(data)));
      ok(t2.g.ship.scene === ort && t2.g.ship.docked && t2.g.ship.dockedAt === ort, `${ort}: Weltstand laden setzt die Lerche wieder an den Liegeplatz`);
    }
    ok(!Locations.get('kreuzweg').scene.dock && !Locations.get('methalle').scene.dock && !Locations.get('eisenwald').scene.dock, 'andere Hexe mit Hafenklasse haben (noch) keinen Liegeplatz');
    const h = setup('free'); h.g.step();
    ok(h.g.ship.docked && h.g.ship.dockedAt === 'hafen' && shop.shopContext(h.g) === 'hafen', 'Lichtkordon unverändert: shopContext hafen');
  }

  // ------------------------------------------------------------------------------------------------------------
  section('EK7: Sprungkette Statio Limitis -> Eisenwald per Bot (tools/sprungkette.js)');
  {
    const Kette = require('./sprungkette.js');
    const R = Kette.fahreKette();
    const ok15 = R.zeilen.filter((z) => z.ok);
    ok(!R.abbruch && ok15.length === 15 && !R.zeilen.some((z) => z.ok === false), `Bot fliegt ${ok15.length} Sprünge ohne Fehler (Flugzeit ${Math.round(ok15.reduce((s, z) => s + z.t, 0))} s)`);
    const besucht = new Set(R.szenen.map((s) => s.hex));
    ok(['0305', '0304', '0303', '0202', '0203', '0403', '0402', '0502', '0503', '0504', '0505', '0605', '0705', '0604', '0704'].every((h) => besucht.has(h)), 'alle 15 Hexe der Kette besucht');
    ok(R.szenen.every((s) => s.snap < 20 * 1024), `Snapshot in jeder Szene unter 20 KB (max ${Math.max(...R.szenen.map((s) => s.snap))} B)`);
    ok(R.gesperrt.length === 5 && R.gesperrt.every((s) => s.grund !== 'WÄHLBAR'), 'gesperrte Ziele bleiben gesperrt (Wolfstor vor der Sprengung, Kernland, Krähenwacht, Vigilia, tutorial-ende)');
    ok(R.gesperrt[0].von === '0705' && R.gesperrt[0].ziel === '0604', 'Methalle -> Wolfstor erst nach der Sprengung');
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
