'use strict';
// SL1 Karte Sund: Kartenwahl beim Spielstart, Startort der Karte, Boden-Start (Gruppe auf dem Planeten, Lerche im Orbit),
// verborgene Kanten enthüllen, Lobby-Modus schuld_der_lerche.   node tools/test-welt.js   (npm run test:welt)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Game } = require('../server/game.js');
const Protocol = require('../shared/protocol.js');
const Sektoren = require('../shared/sektoren.js');
const Locations = require('../shared/locations.js');
const Welt = require('../server/sim/welt.js');
const Sprung = require('../server/sim/sprung.js');
const Kampagne = require('../server/mission/kampagne.js');
const { dist } = require('../server/util.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-welt-'));
let seq = 0;

function setup(dir, players, lobby) {
  const d = dir || path.join(TMP, 'w' + (++seq));
  fs.mkdirSync(d, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: d, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const conns = [];
  for (let i = 0; i < (players || 1); i++) {
    const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'W' + i, name: 'Crew' + i, color: i });
    conns.push(c);
  }
  if (lobby) g.handleMessage(conns[0], Object.assign({ t: 'lobbyOpt' }, lobby));
  const ready = () => { for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true }); };
  const run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) g.step(); };
  return { g, conns, ready, run, dir: d };
}
// Fehler außer dem erwarteten „Kette fehlt noch“ (die Kette schuld-der-lerche.json entsteht erst mit SL11)
const echteFehler = (g) => Object.keys(g.errorLog || {}).filter((k) => k !== 'kette-laden');

section('Karte Sund (content/welt/sund.json)');
const K = Welt.karte('sund');
ok(!!K && K.format === 'sektorkarte/1' && K.id === 'sund' && K.spalten === 11 && K.zeilen === 7, 'sund.json: Format sektorkarte/1, 11×7');
ok(Welt.ids().join() === 'limes,sund', 'Welt.ids: limes, sund');
Welt.waehle(null, 'sund');
{
  const hexe = Object.keys(K.hexe);
  ok(hexe.length >= 27 && K.kanten.length === 38, `mindestens die 27 Systeme des Entwurfs (dazu Orte der Kampagne wie Helix: ${hexe.length}), 38 Kanten (${K.kanten.length}), Leerraum ${K.spalten * K.zeilen - hexe.length} Felder`);
  ok(['0204', '0603', '0604', '0605', '0606', '0602', '0503', '1004'].every((h) => K.hexe[h]) && K.spalten * K.zeilen - hexe.length >= 49, 'Systeme des Entwurfs vorhanden, mindestens 49 Felder Leerraum');
  ok(hexe.every((h) => Sektoren.imRaster(h) && K.regionen[K.hexe[h].region] && typeof K.hexe[h].spielbar === 'boolean'), 'alle Systeme im Raster, mit Region und spielbar');
  const ids = K.kanten.map((e) => Sektoren.kanteId(e.a, e.b));
  ok(new Set(ids).size === ids.length, 'Kanten eindeutig');
  ok(K.kanten.every((e) => K.hexe[e.a] && K.hexe[e.b] && Sektoren.sindNachbarn(e.a, e.b)), 'jede Kante verbindet zwei Systeme, die Nachbarn sind');
  ok(K.kanten.filter((e) => e.art === 'hidden').map((e) => e.key).sort().join() === 'altrost-weg,lager-schrottkante', 'zwei verborgene Kanten mit Schlüssel (Altrost, Schrottkante)');
  ok(K.kanten.every((e) => e.art === 'open' || e.art === 'hidden'), 'keine Fernkanten (Kai 2026-10-13), nur open und hidden');
  const spielbar = hexe.filter((h) => K.hexe[h].spielbar).sort();
  ok(['0503', '0603', '0604', '0605', '0606'].every((h) => spielbar.includes(h)) && !spielbar.includes('0204') && !spielbar.includes('0602') && !spielbar.includes('0703'), 'spielbar: Gasfeld, Kantenstein, Concordia, Pulverhorn, Schrottkante (dazu Orte der Kampagne wie Helix), nicht Rom, Altrost, Eisfeld');
  ok(spielbar.every((h) => K.hexe[h].gen === true && K.hexe[h].ort), 'spielbare Systeme: Szene aus Daten (gen + ort)');
  const reach = (start, hidden) => {
    const seen = new Set([start]); const todo = [start];
    while (todo.length) {
      const x = todo.pop();
      for (const e of K.kanten) {
        if (e.art === 'hidden' && !hidden) continue;
        for (const [u, v] of [[e.a, e.b], [e.b, e.a]]) if (u === x && !seen.has(v)) { seen.add(v); todo.push(v); }
      }
    }
    return seen;
  };
  ok(['0604', '0605', '0503'].every((h) => reach('0603', false).has(h)), 'Kantenstein -> Concordia -> Pulverhorn und Gasfeld über offene Kanten');
  ok(!reach('0603', false).has('0606') && !reach('0603', false).has('0602'), 'Schrottkante und Altrost nur über verborgene Kanten');
  ok(reach('0603', true).has('0606') && reach('0603', true).has('0602'), 'mit enthüllten Kanten erreichbar');
  ok(Sektoren.istLeerraum('0706') && Sektoren.spielbar('0706') && Sektoren.ortVonHex('0706') === 'leer-0706', 'Leerraum-Hex 0706 (neben Pulverhorn) ist Ort leer-0706');
  ok(Sektoren.startOrt() === 'kantenstein' && Sektoren.bodenStart() === true && Sektoren.kartenId() === 'sund', 'Karte Sund: Start Kantenstein, am Boden');
  ok(Locations.START === 'kantenstein' && Locations.KNOWN_AT_START.join() === 'kantenstein,concordia,pulverhorn,gasfeld', 'Locations.START / KNOWN_AT_START folgen der Karte');
  ok(Sektoren.hexVonOrt('kantenstein') === '0603' && Sektoren.ortVonHex('0604') === 'concordia' && !!Locations.get('schrottkante'), 'Orte <-> Hexe, Szenen aus Daten');
  ok(Sektoren.istVerborgen('0606') && Sektoren.istVerborgen('0602') && !Sektoren.istVerborgen('0605'), 'verborgene Hexe: Schrottkante, Altrost');
}
Welt.waehle(null, 'limes');
ok(Sektoren.kartenId() === 'limes' && Locations.START === 'hafen' && Locations.KNOWN_AT_START.join() === 'hafen,splitter', 'zurück auf Limes: Start hafen, Wissen hafen + splitter');
ok(Welt.waehle(null, 'gibtsnicht') === 'limes' && Welt.waehle(null, '../limes') === 'limes', 'unbekannte oder unsichere Karten-Id fällt auf Limes zurück');

section('Protokoll und Lobby-Modus');
ok(Protocol.LOBBY_MODI.includes('schuld_der_lerche') && Protocol.CAMPAIGN_STARTS.includes('schuld_der_lerche'), 'LOBBY_MODI und CAMPAIGN_STARTS kennen schuld_der_lerche');
ok(Protocol.START_LABELS.schuld_der_lerche === 'Die Schuld der Lerche' && !!Protocol.START_HINTS.schuld_der_lerche, 'Beschriftung und Hinweis');
ok(Protocol.CAMPAIGN_KETTEN.schuld_der_lerche.welt === 'sund' && Protocol.CAMPAIGN_KETTEN.schuld_der_lerche.tutorial === false && Protocol.CAMPAIGN_KETTEN.schuld_der_lerche.kampagne === 'schuld-der-lerche', 'Kette: Karte sund, ohne Tutorial');
ok(!Protocol.CAMPAIGN_KETTEN.eisenwald.welt && !Protocol.CAMPAIGN_KETTEN.eisenwald_ohne.welt, 'Eisenwald-Modi ohne welt (= Limes)');
{
  const pr = Kampagne.pruefen({ format: 'kampagne/1', id: 'schuld-der-lerche', titel: 'T', start: 'a', kapitel: [], ende: { titel: 't', text: 't', abspann: [{ kopf: 'k', zeilen: [] }] } });
  ok(!pr.errors.some((e) => /tutorial/i.test(e.p + ' ' + e.msg)) && !pr.errors.some((e) => /^id/.test(e.p)), 'Kettenschema: tutorial optional, id mit Bindestrich erlaubt');
}

section('Partie auf Sund: Kartenwahl und Boden-Start');
let dirSund, weltId;
{
  const t = setup(null, 2, { startMission: 'schuld_der_lerche' });
  const g = t.g;
  ok(Sektoren.kartenId() === 'limes', 'vor dem Start: Limes (Lobby)');
  t.ready(); t.run(2);
  ok(g.phase === 'play' && g.weltId === 'sund' && Sektoren.kartenId() === 'sund', 'Spielstart wählt die Karte Sund');
  ok(t.conns[0].inbox.some((m) => m.t === 'sektorkarte' && m.sektorkarte && m.sektorkarte.id === 'sund'), 'Clients bekommen die Karte Sund (Nachricht sektorkarte)');
  const ws = g.weltstand;
  ok(ws && ws.persistent && ws.data.fakten.welt_karte === 'sund' && ws.data.tutorial === 'uebersprungen', 'Weltstand merkt die Karte (Fakt welt_karte), kein Tutorial');
  ok(g.ship.scene === 'kantenstein' && !g.ship.docked && g.ship.dockedAt == null, 'Lerche steht im Orbit von Kantenstein (nicht angedockt)');
  ok(g.players.every((p) => p.zone === 'away') && g.away.map === 'kantenstein.siedlung', 'Gruppe startet auf dem Planeten (Außenkarte kantenstein.siedlung)');
  const lp = require('../server/sim/landepunkte.js').defs().byId['kantenstein.siedlung'];
  ok(dist(g.ship.x, g.ship.y, lp.beam.x, lp.beam.y) < 5 && lp.beam.range >= 360, 'Lerche am Beam-Punkt des Landepunkts (Hochbeamen möglich)');
  ok(g.explore.visited.has('kantenstein') && g.explore.known.has('concordia') && !g.explore.known.has('hafen'), 'Wissen: Kantenstein besucht, Concordia bekannt, Hafen Lichtkordon nicht');
  ok(echteFehler(g).length === 0, 'keine Fehler (' + JSON.stringify(echteFehler(g)).slice(0, 200) + ')');
  ok(!g.mission.missions.m1 && !g.mission.missions.m2 && !g.mission.missions.m3, 'keine Tutorial-Missionen im Spiel');
  ok(Object.keys(g.explore.sektorenSnapshot()).length > 0 && !g.explore.sektorenSnapshot().e.some((h) => /^02/.test(h)), 'Sektorenstand ohne Limes-Hexe');
  // Hochbeamen: Lerche über den Pads, Captain beamt (consoleBeam). Hier direkt: Selbstbeamen am Pad
  const away = require('../server/sim/away.js');
  away.executeBeam(g, g.players.map((p) => p.id), 'up');
  ok(g.players.every((p) => p.zone === 'ship'), 'Hochbeamen von Kantenstein klappt');
  dirSund = t.dir; weltId = g.weltstand.id;

  section('Verborgene Kanten enthüllen');
  g.debugGoto('pulverhorn', false);
  const ex = g.explore;
  const lager = '0605-0606';
  ok(!ex.kanteOffen(lager) && !ex.bojeBekannt(lager), 'Schrottkante-Kante vor dem Enthüllen weder offen noch bekannt');
  ok(typeof Sprung.hexGrund(g, '0605', '0606') === 'string', 'Zielwahl nach Schrottkante gesperrt (' + Sprung.hexGrund(g, '0605', '0606') + ')');
  ok(typeof Sprung.oeffnen(g, { von: '0605', nach: '0606', temp: true }) === 'string', 'oeffnen (temp) auf eine verborgene Kante wird abgelehnt');
  ok(typeof Sprung.bojeAufdecken(g, lager) === 'string', 'bojeAufdecken auf eine verborgene Kante wird abgelehnt');
  ok(!Sprung.notsprungKandidaten(g).includes('0606'), 'Notfallsprung führt nie in ein verborgenes Hex');
  ok(!ex.sektorenSnapshot().o.includes(lager) && !ex.sektorenSnapshot().b.includes(lager), 'Snapshot zeigt die Kante nicht');
  ok(typeof Sprung.kanteEnthuellen(g, 'unsinn') === 'string' && typeof Sprung.kanteEnthuellen(g, '0605-0705') === 'string', 'kanteEnthuellen auf unbekannte oder offene Kante: Begründung');
  const ev = [];
  const orig = g.emit.bind(g); g.emit = (k, d) => { ev.push(k); return orig(k, d); };
  ok(Sprung.kanteEnthuellen(g, 'lager-schrottkante') === null, 'kanteEnthuellen (Schlüssel) -> null');
  ok(ex.kanteOffen(lager) && ex.bojeBekannt(lager) && ex.linksOpen.has('lager-schrottkante'), 'Kante offen und Boje bekannt, Schlüssel im Weltstand (verbindungen_offen)');
  ok(ev.includes('kanteEnthuellt'), 'Ereignis kanteEnthuellt');
  ok(Sprung.hexGrund(g, '0605', '0606') === null, 'Zielwahl nach Schrottkante frei');
  ok(ex.sektorenSnapshot().o.includes(lager) && ex.sektorenSnapshot().b.includes(lager), 'Snapshot: Kante offen und Boje bekannt');
  ok(Sprung.notsprungKandidaten(g).includes('0606'), 'Notfallsprung kann jetzt auch nach Schrottkante führen');
  ok(Sprung.kanteEnthuellen(g, lager) === null && ev.filter((k) => k === 'kanteEnthuellt').length === 1, 'zweites Enthüllen ist wirkungslos (kein zweites Ereignis)');
  ok(!ex.kanteOffen('0602-0603'), 'die andere verborgene Kante (Altrost) bleibt zu');
  Sprung.springeNach(g, 'schrottkante');
  ok(g.ship.scene === 'schrottkante' && ex.erkundet.has('0606'), 'Sprung nach Schrottkante, Hex erkundet');
  g.debugGoto('pulverhorn', false);
  // Regiebuch-Bausteine
  const Registry = require('../server/mission/registry.js');
  ok(!!Registry.get('kante_enthuellen') && !!Registry.get('kante_offen'), 'Bausteine kante_enthuellen und kante_offen registriert');

  section('Speichern und Fortsetzen');
  ex.openLink('lager-schrottkante');
  const r = g.saveWorld('test', { sync: true });
  ok(r && r.ok, 'Weltstand gespeichert');
  g.releaseWorldLock();
}
Welt.waehle(null, 'limes');
{
  const u = setup(dirSund, 1, { world: weltId });
  u.ready(); u.run(1);
  const g = u.g;
  ok(g.phase === 'play' && g.weltId === 'sund' && Sektoren.kartenId() === 'sund', 'Fortsetzen wählt die Karte des Standes (Sund) vor dem Laden');
  ok(g.explore.kanteOffen('0605-0606') && g.explore.bojeBekannt('0605-0606'), 'enthüllte Kante bleibt nach dem Laden offen');
  ok(!g.explore.kanteOffen('0602-0603'), 'unenthüllte Kante bleibt zu');
  ok(Locations.get(g.ship.scene) && Sektoren.hexVonOrt(g.ship.scene), 'Lerche an einem Ort der Karte Sund (' + g.ship.scene + ')');
  ok(u.conns[0].inbox.some((m) => m.t === 'sektorkarte' && m.sektorkarte.id === 'sund'), 'Client bekommt die Karte Sund');
  g.releaseWorldLock();
}

section('Eisenwald und freie Spielmodi laufen weiter auf Limes');
{
  const t = setup(null, 1, { startMission: 'eisenwald_ohne' });
  t.ready(); t.run(2);
  const g = t.g;
  ok(g.weltId === 'limes' && Sektoren.kartenId() === 'limes', 'Eisenwald wählt Limes (auch nach einer Sund-Partie im selben Prozess)');
  ok(g.ship.scene === 'hafen' && g.ship.docked && g.ship.dockedAt === 'hafen', 'Start im Hafen Lichtkordon, angedockt');
  ok(g.players.every((p) => p.zone === 'ship'), 'Gruppe an Bord');
  ok(g.weltstand.data.fakten.welt_karte === undefined, 'kein Fakt welt_karte bei Eisenwald (Fortsetzen: Standard Limes)');
  g.releaseWorldLock();
  const s = setup(null, 1, { startMission: 'm3' }); s.ready(); s.run(1);
  ok(s.g.weltId === 'limes' && Sektoren.kartenId() === 'limes', 'Direktstart m3: Limes');
  s.g.endSession(null);
  ok(s.g.phase === 'lobby' && Sektoren.kartenId() === 'limes', 'Partie beenden: Lobby auf Limes');
}

console.log(`\n${n - fails}/${n} bestanden${fails ? ', ' + fails + ' FEHLER' : ''}`);
process.exit(fails ? 1 : 0);
