'use strict';
// LIV-01 D: gemeinsame Teile der Bot-Crew (drei WebSocket-Clients am echten Server), aus tools/spiel-faden.js herausgeloest. Verwendet von tools/spiel-faden.js und tools/live-abend.js.
//   client(WebSocket, port, code, hello, name, namen)   ein Client: sammelt Snapshot-Bloecke (bitte, abenteuer, kontingent), Funk (nur der erste Client, mit Zeit), Antworten (Bitte, Abenteuer, Kontingent)
//   werkzeug({ g, cl, zeile, k })                         { sleep, hierHex, flieg, konsole, wegNach, springe, wartenAuf, spruenge } : Ort setzen, an eine Konsole setzen, Weg ueber offene Kanten,
//                                                         ECHTE Spruenge (Weitscan weapons.widescan, helm.jump). k(...arten) meldet kuenstlich gesetzte Schritte (Mitschnitt, Verlauf).
// Das Verhalten ist das von spiel-faden (Zeile fuer Zeile uebernommen); neu ist nur der Zaehler `spruenge` (gelungene Hops) und die Zeitmarke im Funk.
const Sektoren = require('../../shared/sektoren.js');
const Sprung = require('../../server/sim/sprung.js');
const Physics = require('../../shared/physics.js');
const World = require('../../server/world.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(WebSocket, port, code, hello, name, namen) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const c = { ws, name, funk: [], funkZeit: [], antw: 0, bitte: null, abenteuer: undefined, abAntw: [], kontingent: null, kontAntw: [], radioAlle: [] };
    ws.on('message', (data) => {
      const m = JSON.parse(data.toString());
      if (m.t === 'snap') {
        if (m.world && 'bitte' in m.world) c.bitte = m.world.bitte;
        if (m.world && 'abenteuer' in m.world) c.abenteuer = m.world.abenteuer;
        if (m.world && 'kontingent' in m.world) c.kontingent = m.world.kontingent;
        return;
      }
      if (m.t === 'event' && m.kind === 'radio') {
        c.radioAlle.push({ von: m.from, text: m.text, wall: Date.now() });
        if (name === namen[0]) { c.funk.push(`${m.from}: ${m.text}`); c.funkZeit.push(Date.now()); }
      }
      if (m.t === 'event' && m.kind === 'fadenBitteAntwort') c.antw++;
      if (m.t === 'event' && m.kind === 'abenteuerAntwort') c.abAntw.push({ op: m.op, ok: m.ok, code: m.code });
      if (m.t === 'event' && m.kind === 'kontingentAntwort') c.kontAntw.push({ ok: m.ok, code: m.code, text: m.text, wall: Date.now() });
    });
    c.send = (o) => ws.send(JSON.stringify(o));
    ws.on('open', () => { c.send(Object.assign({ t: 'hello', code }, hello)); resolve(c); });
  });
}

function werkzeug({ g, cl, zeile, k }) {
  const Space = require('../../server/sim/space.js');
  const Station = require('../../server/sim/station.js');
  const stat = { spruenge: 0 };
  const hierHex = () => Sektoren.hexVonOrt(g.ship.scene);
  const flieg = (hex) => { k('teleport'); const o = Sektoren.ortVonHex(hex) || ('leer-' + hex); Space.enterScene(g, o, {}); g.explore.location = o; const s = g.ship; s.docked = false; s.dockedAt = null; s.vx = 0; s.vy = 0; s.speed = 0; };
  // Die Crew sitzt an einer Konsole (Platz und Taste Benutzen, wie die Ops bei der Spur): der Sprung geht ueber die echten Befehle weapons.widescan und helm.jump
  const konsole = async (name) => {
    let platz = null;
    for (const t of [].concat(World.CONSOLE_TILES[name])) for (const [dx, dy, dir] of [[0, 1, 'up'], [0, -1, 'down'], [-1, 0, 'right'], [1, 0, 'left']]) { const q = { x: t.x + dx, y: t.y + dy, dir }; if (!platz && !World.ship.solid(q.x, q.y)) platz = q; }
    const mitte = Physics.tileCenter(platz.x, platz.y), me = g.players[0];
    k('spieler-setzen');   // Platz an der Konsole wird gesetzt, nicht gelaufen
    const station = () => Station.stationOf(me);
    if (!me.console) { me.x = mitte.x; me.y = mitte.y; me.dir = platz.dir; cl[0].send({ t: 'act', down: true }); cl[0].send({ t: 'act', down: false }); await sleep(250); }
    for (let i = 0; i < 4 && station() !== name; i++) { cl[0].send({ t: 'cmd', c: 'station.tab', dir: 1 }); await sleep(150); }   // schon an einer Konsole: Tab schaltet das Interface (Steuer, Ops, ...)
  };
  // Weg ueber offene Kanten (kuerzester, Breitensuche) -> [Hex ...] ohne den Start
  const wegNach = (ziel) => {
    const von = hierHex(), vor = new Map([[von, null]]); let rand = [von];
    while (rand.length && !vor.has(ziel)) { const next = []; for (const h of rand) for (const e of Sektoren.kantenVon(h)) { const n = Sektoren.anderes(e, h); if (!vor.has(n) && Sektoren.spielbar(n) && g.explore.kanteOffen(Sektoren.kanteId(e.a, e.b))) { vor.set(n, h); next.push(n); } } rand = next; }
    if (!vor.has(ziel)) return null;
    const weg = []; for (let h = ziel; h !== von; h = vor.get(h)) weg.unshift(h);
    return weg;
  };
  // ECHTE Spruenge statt Space.enterScene: Ops macht den Weitscan am Sprungpunkt (findet die Boje), Helm springt (Antrieb laedt, Sprungpunkt-Automatik waehlt das Ziel). Der Bot setzt das Schiff an den Sprungpunkt
  // (das Anfliegen ist in test-flight geprueft) und kuerzt nichts am Antrieb. -> true, wenn die Crew im Zielsektor ist
  const springe = async (ziel) => {
    const weg = wegNach(ziel);
    if (!weg) { zeile('Sprung: kein Weg ueber offene Sprungpunkte nach ' + ziel); return false; }
    for (const h of weg) {
      const p = Sprung.sprungpunkt(g, h), s = g.ship;
      k('ort-setzen');   // das Schiff wird an den Sprungpunkt gesetzt (der Sprung selbst laeuft ueber die echten Befehle)
      s.docked = false; s.dockedAt = null; s.x = p.x - 80; s.y = p.y; s.vx = 0; s.vy = 0; s.speed = 0;
      await konsole('weapons'); cl[0].send({ t: 'cmd', c: 'weapons.widescan' }); await sleep(400);
      await konsole('helm');
      for (let i = 0; i < 300 && !s.jump.ready; i++) await sleep(100);
      if (!s.jump.ready) { zeile('Sprung nach ' + h + ' nicht bereit: ' + (s.jump.blockedReason || 'unbekannt')); return false; }
      const vorher = hierHex(), ziel0 = s.jump.dest; cl[0].send({ t: 'cmd', c: 'helm.jump' });
      for (let i = 0; i < 50 && hierHex() === vorher; i++) await sleep(100);
      zeile('Sprung ' + Sektoren.hexName(vorher) + ' > ' + Sektoren.hexName(hierHex()) + ' (Weitscan, Antrieb, helm.jump; Ziel vor dem Sprung ' + ziel0 + ', Station ' + Station.stationOf(g.players[0]) + ', Antrieb bereit ' + s.jump.ready + ', Ort ' + g.ship.scene + ')');
      if (hierHex() !== h) return false;
      stat.spruenge++;
      s.vx = 0; s.vy = 0; s.speed = 0;
    }
    return true;
  };
  const wartenAuf = async (fn, ms) => { for (let i = 0; i < (ms || 40); i++) { if (fn()) return true; await sleep(100); } return !!fn(); };
  return { sleep, hierHex, flieg, konsole, wegNach, springe, wartenAuf, stat };
}

module.exports = { client, werkzeug, sleep };
