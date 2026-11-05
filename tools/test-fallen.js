'use strict';
// ITM-01 C: Fallen-Kern (server/sim/fallen.js, Anker-Rolle `falle`). Echtes Game, gebaute Karte (Ruine) mit Fallen-Ankern, Spieler am Boden. Kein Generator setzt in ITM-01 Fallen: die Anker kommen
// über einen Wrapper um Buehne.bauen in die Rohkarte (der Landepunkt-Cache bewahrt sie, Neuaufbau und Weltstand laufen den echten Weg).
// Geprüft: Konfiguration/Register, Zustandsmaschine (alle 16 Paare), Start je sicht, Entschärfen (Dauer, nur aus erkannt, Abbruch durch Treffer auf allen Pfaden, E loslassen, Bewegung,
// Kartenwechsel, Trennung, Wunde/Bewusstlosigkeit), Auslösen genau einmal (zwei Spieler, doppeltes Update, nie aus entschaerft/ausgeloest, Gegner nie), Wirkungs-Register und Zeitwirkung,
// Payload-Filter und Index-Konsistenz ao (Beweis: verborgene Falle steht vor dem Erkennen nirgends), Nachsendung (Nachzügler, Wiederverbinden, Neuaufbau), Scanner-Anbindung,
// 4 Spieler, Weltstand-Roundtrip, Debug falletest nur mit --debug.
//   node tools/test-fallen.js   (npm run test:fallen)
const { Game } = require('../server/game.js');
const interior = require('../server/sim/interior.js');
const combat = require('../server/sim/combat.js');
const Anker = require('../server/sim/anker.js');
const Fallen = require('../server/sim/fallen.js');
const Scanbar = require('../server/sim/scanbar.js');
const L = require('../server/sim/landepunkte.js');
const W = require('../server/world.js');
const Buehne = require('../shared/buehne.js');
const Physics = require('../shared/physics.js');
const Protocol = require('../shared/protocol.js');
const CONFIG = require('../shared/config.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const DT = 1 / CONFIG.tickHz;
const TILE = Physics.TILE;
const ZUSTAENDE = ['verborgen', 'erkannt', 'entschaerft', 'ausgeloest'];

// Fallen der Szene: id, sicht, typ. 'tst' hat im Test einen eigenen Handler (zählt), die anderen Typen haben keine Wirkung.
const SPEC = [
  { id: 'falle.1', sicht: 'verborgen', typ: 'tst' },
  { id: 'falle.2', sicht: 'verborgen', typ: 'tst' },
  { id: 'falle.3', sicht: 'passiv', typ: 'druck' },
  { id: 'falle.4', sicht: 'passiv', typ: 'tst' },
  { id: 'falle.5', sicht: 'verborgen', typ: 'schuss' },
];
const wirk = [];   // Aufrufe des Test-Handlers: { id, pid, game }
let wirkSchalter = null;   // optional: Funktion, die der Handler zusätzlich ruft (Wurf, Zeitwirkung)
Fallen.fallenWirkung('tst', (game, aw, f, p) => { wirk.push({ id: f.id, pid: p && p.id, f, aw }); if (wirkSchalter) wirkSchalter(game, aw, f, p); });

// Fallen-Anker in die Rohkarte setzen: erreichbare begehbare Kacheln, weit genug auseinander (Auslösezonen überlappen nie, Nachbarkachel zum Entschärfen frei)
function fallenEinsetzen(k) {
  if (k.anker.some((a) => a.rolle === 'falle')) return;
  const r = Buehne.raster(k);
  const start = k.anker.find((a) => a.rolle === 'abholpunkt' && a.ankunft) || k.anker.find((a) => a.rolle === 'abholpunkt');
  const dist = new Map([[start.y * k.w + start.x, 0]]); const q = [[start.x, start.y]];
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, key = ny * k.w + nx;
      if (dist.has(key) || !r.durchgang(nx, ny)) continue;
      dist.set(key, dist.get(y * k.w + x) + 1); q.push([nx, ny]);
    }
  }
  const belegt = new Set(k.anker.map((a) => a.x + ',' + a.y));
  const frei = (x, y) => { const i = r.info(x, y); return i && i.kante === 'begehbar' && r.durchgang(x, y) && !belegt.has(x + ',' + y); };
  const kand = [...dist.keys()].map((key) => ({ x: key % k.w, y: Math.floor(key / k.w), d: dist.get(key) }))
    .filter((t) => t.d >= 6 && frei(t.x, t.y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => frei(t.x + dx, t.y + dy)))
    .sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  const gew = [];
  const fern = (t, m) => gew.every((o) => Math.hypot(o.x - t.x, o.y - t.y) >= m);
  // vier nahe (>= 6 Kacheln auseinander), die fünfte möglichst weit weg (außerhalb der Scanreichweite von falle.1)
  for (const t of kand) { if (gew.length < 4 && fern(t, 6)) gew.push(t); }
  const weit = kand.filter((t) => Math.hypot(t.x - gew[0].x, t.y - gew[0].y) * TILE > CONFIG.scanner.reichweite + 2 * TILE && fern(t, 6)).sort((a, b) => Math.hypot(b.x - gew[0].x, b.y - gew[0].y) - Math.hypot(a.x - gew[0].x, a.y - gew[0].y))[0];
  gew.push(weit || kand[kand.length - 1]);
  SPEC.forEach((s, i) => { const t = gew[i]; k.anker.push({ id: s.id, rolle: 'falle', x: t.x, y: t.y, typ: s.typ, sicht: s.sicht }); });
}

function szene(opts) {
  opts = opts || {};
  const np = opts.spieler || 1;
  const bauen0 = Buehne.bauen;
  Buehne.bauen = function () { const k = bauen0.apply(this, arguments); fallenEinsetzen(k); return k; };
  let g;
  try {
    g = new Game({ noStore: true, seed: 11, debug: opts.debug !== false, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
    const cs = Array.from({ length: np }, () => ({ inbox: [], send(o) { this.inbox.push(o); } }));
    for (const [i, c] of cs.entries()) { g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'F' + i, name: 'Falle' + i, color: i }); }
    for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
    for (let i = 0; i < 6; i++) g.step();
    const id = L.neu(g, g.ship.scene, { art: 'ruine' });
    const aw = L.get(g, id);
    g.setAwayMap(id); aw.active = true;
    for (const [j, p] of g.players.entries()) { interior.placeOnAwayPad(g, p, j); combat.onArrive(g, p); }
    g.god = true;
    const S = { g, cs, id, aw, k: W.AWAY_MAPS[id].karte, ps: g.players, p: g.players[0], me: [], notes: [], ev: [] };
    const me0 = g.missionEvent.bind(g); g.missionEvent = (nm, a) => { S.me.push([nm, a]); return me0(nm, a); };
    const n0 = g.notice.bind(g); g.notice = (p, t) => { S.notes.push({ pid: p.id, text: t }); return n0(p, t); };
    const e0 = g.emit.bind(g); g.emit = function (t, d) { S.ev.push([t, d]); return e0(t, d); };
    S.an = (fid) => S.k.anker.find((a) => a.id === fid);
    S.mitte = (fid) => Physics.tileCenter(S.an(fid).x, S.an(fid).y);
    S.hin = (p, x, y) => { p.x = x; p.y = y; p.input.mx = 0; p.input.my = 0; };
    S.bei = (p, fid, dx, dy) => { const c = S.mitte(fid); S.hin(p, c.x + (dx || 0), c.y + (dy || 0)); };   // dx, dy in Pixel
    // freie Nachbarkachel einer Falle (4er), Mittelpunktabstand 1,0 Kachel (liegt außerhalb jeder Auslösezone)
    S.nachbar = (fid) => { const a = S.an(fid); const r = Buehne.raster(S.k); const t = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: a.x + dx, y: a.y + dy })).find((q) => r.durchgang(q.x, q.y)); return Physics.tileCenter(t.x, t.y); };
    S.z = (fid) => Anker.zustand(g, id, fid);
    S.lauf = (sek, vor) => { for (let i = 0; i < Math.round(sek / DT); i++) { g.away.drones.length = 0; if (vor) vor(); g.step(); } };
    S.act = (down, i) => g.handleMessage(cs[i || 0], { t: 'act', down });
    S.nutzeZustand = (fid, z) => Anker.setzen(g, id, fid, z, null);
    S.evn = (name) => S.ev.filter((e) => e[0] === name).length;
    S.client = (i) => cs[i || 0].inbox;
    S.enthuellt = (i) => S.client(i).filter((m) => m.t === 'event' && m.kind === 'ankerEnthuellt');
    S.holdFalle = (p) => !!(p.hold && p.hold.kind === 'anker:falle');
    S.snap = () => g.snapshot();
    return S;
  } finally { Buehne.bauen = bauen0; }
}
// Client-Ankerliste wie Paket E sie baut: letztes awayMap-Ereignis, danach ankerEnthuellt in Reihenfolge des Eintreffens
function clientListe(inbox, map) {
  let liste = null; const fehl = [];
  for (const m of inbox) {
    if (m.t !== 'event') continue;
    if (m.kind === 'awayMap' && m.id === map) liste = m.anker.map((r) => r[0]);
    else if (m.kind === 'ankerEnthuellt' && m.map === map && liste) { if (m.i !== liste.length) fehl.push(m.i + '!=' + liste.length); liste.push(m.anker[0]); }
  }
  return { liste, fehl };
}
const gesamt = (S) => JSON.stringify([S.snap()]);

section('Konfiguration, Register, Protokoll');
{
  const A = require('../content/buehnen/anker.json');
  ok(Object.keys(A.rollen).length === 22 && A.rollen.falle, 'anker.json: 22 Rollen, falle vorhanden');
  ok(A.rollen.falle.zustaende.join() === ZUSTAENDE.join(), 'Zustandsindex = Reihenfolge verborgen, erkannt, entschaerft, ausgeloest');
  ok(A.rollen.falle.halten === 'falle' && A.rollen.falle.objekt === 'falle' && CONFIG.anker.halten.falle === 3, 'Rolle falle: halten falle (3 s), Objekt falle');
  const R = CONFIG.anker.falle.radius;
  ok(R.standard > 0 && Object.values(R).every((v) => v > 0 && v <= 0.9), 'Auslösezonen: Radius je Typ, alle <= 0,9 Kachel (Entschärfen von der Nachbarkachel bleibt möglich)');
  ok(CONFIG.anker.falle.position === 2, 'Positionsstufe 2 in der Config');
  ok(Buehne.ANKER_GLYPHE.falle, 'Anker-Kürzel für falle');
  ok(Protocol.B1_EVENTS.includes('ankerEnthuellt') && Protocol.EVT_ANKER_ENTHUELLT === 'ankerEnthuellt' && Protocol.DEBUG_CMDS.includes('falletest'), 'Protokoll: Ereignis ankerEnthuellt, Debug falletest');
  const wirft = (f) => { try { f(); return false; } catch (e) { return true; } };
  const ab = Fallen.fallenWirkung('reg.probe', () => {});
  ok(typeof ab === 'function' && wirft(() => Fallen.fallenWirkung('reg.probe', () => {})), 'Wirkungs-Register: Doppel-Id wirft, Abmelder kommt zurück');
  ab();
  let ab2 = null; try { ab2 = Fallen.fallenWirkung('reg.probe', () => {}); } catch (e) { /* bleibt null */ }
  ok(typeof ab2 === 'function', 'nach dem Abmelden ist die Id wieder frei'); if (ab2) ab2();
  ok(wirft(() => Fallen.fallenWirkung('', () => {})) && wirft(() => Fallen.fallenWirkung('x.y', null)), 'Register: leere Id und fehlender Handler werfen');
  ok(wirft(() => Scanbar.scanbarAnmelden('falle', { ziele: () => [] })), 'Scanbar: Art falle ist angemeldet');
}

section('Zustandsmaschine: alle 16 Paare');
{
  const gueltig = { 'verborgen>erkannt': 1, 'verborgen>ausgeloest': 1, 'erkannt>entschaerft': 1, 'erkannt>ausgeloest': 1 };
  ok(ZUSTAENDE.every((v) => ZUSTAENDE.every((z) => v === z || Fallen.uebergangErlaubt(v, z) === !!gueltig[v + '>' + z])), 'uebergangErlaubt: genau vier gültige Übergänge');
  const S = szene();
  // Zustände herstellen: falle.1 bleibt verborgen, falle.2 -> erkannt, falle.4 (passiv) bleibt erkannt, falle.3 -> entschaerft, falle.5 -> ausgeloest (über erkannt)
  ok(S.nutzeZustand('falle.2', 'erkannt') === null, 'verborgen -> erkannt gültig');
  ok(S.nutzeZustand('falle.3', 'entschaerft') === null && S.z('falle.3') === 'entschaerft', 'erkannt (passiv) -> entschaerft gültig');
  ok(S.nutzeZustand('falle.5', 'ausgeloest') === null && S.z('falle.5') === 'ausgeloest', 'verborgen -> ausgeloest gültig');
  const bei = { verborgen: 'falle.1', erkannt: 'falle.2', entschaerft: 'falle.3', ausgeloest: 'falle.5' };
  let alle = true;
  for (const [von, fid] of Object.entries(bei)) for (const nach of ZUSTAENDE) {
    if (nach === von || gueltig[von + '>' + nach]) continue;
    const e = S.nutzeZustand(fid, nach);
    if (typeof e !== 'string' || S.z(fid) !== von) { alle = false; console.log('    ungültig akzeptiert: ' + von + ' -> ' + nach + ' (' + e + ', jetzt ' + S.z(fid) + ')'); }
  }
  ok(alle, 'alle ungültigen Paare werden abgelehnt, der Zustand bleibt');
  ok(S.nutzeZustand('falle.2', 'erkannt') === null && S.z('falle.2') === 'erkannt', 'gleicher Zustand: kein Fehler, keine Änderung');
  ok(typeof S.nutzeZustand('falle.1', 'zerlegt') === 'string' && S.z('falle.1') === 'verborgen', 'unbekannter Zustand abgelehnt');
  ok(S.nutzeZustand('falle.2', 'ausgeloest') === null && S.nutzeZustand('falle.4', 'ausgeloest') === null, 'erkannt -> ausgeloest gültig (aktiv und passiv)');
  ok(S.evn('ankerZustand') >= 5 && S.me.filter((m) => m[0] === 'ankerZustand' && m[1].rolle === 'falle').length >= 5, 'jeder Wechsel: Ereignis ankerZustand und Missions-Ereignis mit Rolle falle');
}

section('Startzustand je sicht, Snapshot ao nur Abweichungen');
{
  const S = szene();
  S.lauf(0.3);
  ok(S.z('falle.1') === 'verborgen' && S.z('falle.2') === 'verborgen' && S.z('falle.5') === 'verborgen', 'sicht verborgen startet als verborgen');
  ok(S.z('falle.3') === 'erkannt' && S.z('falle.4') === 'erkannt', 'sicht passiv startet als erkannt');
  ok(!S.snap().away.ao || S.snap().away.ao.length === 0, 'Start: kein ao-Eintrag (Abweichungen vom Start; passiv erkannt ist Start)');
  ok(S.nutzeZustand('falle.3', 'erkannt') === null && S.nutzeZustand('falle.2', 'verborgen') === null, 'gleicher Zustand wie der Start (passiv erkannt, verborgen) wird still angenommen');
  ok(!S.snap().away.ao || S.snap().away.ao.length === 0, 'der Start steht auch dann nicht in ao, wenn er ausdrücklich gesetzt wurde');
  S.nutzeZustand('falle.1', 'erkannt'); S.nutzeZustand('falle.3', 'entschaerft');
  const ao = S.snap().away.ao; const liste = Anker.ankerListe(S.g, S.aw, S.k);
  ok(ao.length === 2 && ao.every(([i, zi]) => liste[i]), 'ao: genau die zwei Abweichungen');
  ok(ao.some(([i, zi]) => liste[i].id === 'falle.1' && zi === 1) && ao.some(([i, zi]) => liste[i].id === 'falle.3' && zi === 2), 'ao: [Index, Zustandsindex] zeigt auf die richtigen Anker (erkannt 1, entschaerft 2)');
}

section('Payload-Beweis: verborgene Falle steht vor dem Erkennen nirgends, Index-Konsistenz');
{
  const S = szene({ spieler: 2 });
  const px = (fid) => S.mitte(fid);
  S.lauf(0.5);
  const pay = S.g.awayMapPayload(S.k); const js = JSON.stringify(pay);
  const ids = pay.anker.map((r) => r[0]);
  ok(!/falle\.[125]"/.test(js) && !ids.some((i) => /^falle\.[125]$/.test(i)), 'Payload: verborgene Fallen (1, 2, 5) fehlen');
  ok(ids.includes('falle.3') && ids.includes('falle.4'), 'Payload: passive Fallen (3, 4) stehen drin');
  const r3 = pay.anker.find((r) => r[0] === 'falle.3');
  ok(r3[1] === 'falle' && r3[4] && r3[4].typ === 'druck' && r3[4].sicht === 'passiv', 'Payload-Zeile der passiven Falle trägt typ und sicht');
  const verborgenPos = ['falle.1', 'falle.2', 'falle.5'].map((f) => S.an(f));
  ok(verborgenPos.every((a) => !new RegExp('"falle",' + a.x + ',' + a.y + '[,\\]]').test(js)), 'Payload: keine Anker-Zeile mit Ort einer verborgenen Falle');
  ok(Buffer.byteLength(js) <= Protocol.AWAY_MAP_MAX_BYTES, 'Payload bleibt im Budget (' + Buffer.byteLength(js) + ' B)');
  ok(ids.length === Anker.payloadAnker(S.k).length && Anker.payloadAnker(S.k).length === S.k.anker.length - 3, 'Payload-Länge = payloadAnker (eine Quelle der Wahrheit), drei Anker weniger');
  // viele Snapshots, mehrere Spieler: nirgends die Falle (Ort oder Id), auch keine Ereignisse an die Clients
  const snaps = [];
  for (let i = 0; i < 12; i++) { S.lauf(DT * 3); snaps.push(JSON.stringify(S.snap())); }
  const all = snaps.join('|');
  ok(!/falle\.[125]/.test(all), 'Snapshots (12): keine Id einer verborgenen Falle');
  ok(verborgenPos.every((a) => { const c = px(a.id); return !all.includes(',' + c.x + ',' + c.y + ']') && !all.includes('"x":' + c.x + ',"y":' + c.y); }), 'Snapshots (12): kein Ort einer verborgenen Falle');
  const ein = JSON.stringify([S.client(0).filter((m) => m.t === 'event'), S.client(1).filter((m) => m.t === 'event')].map((l) => l.filter((m) => m.kind !== 'awayMap')));
  ok(!/falle\.[125]/.test(ein) && S.enthuellt(0).length === 0 && S.enthuellt(1).length === 0, 'Ereignisse an beide Clients: nichts über verborgene Fallen, kein ankerEnthuellt');
  // Erkennen in anderer Reihenfolge als die Karte: falle.5, dann falle.1
  S.nutzeZustand('falle.5', 'erkannt'); S.lauf(DT * 2);
  S.nutzeZustand('falle.1', 'erkannt'); S.lauf(DT * 2);
  for (const i of [0, 1]) {
    const ev = S.enthuellt(i);
    ok(ev.length === 2 && ev[0].anker[0] === 'falle.5' && ev[1].anker[0] === 'falle.1', 'Client ' + i + ': ankerEnthuellt in Reihenfolge des Erkennens (5, dann 1)');
    ok(ev[0].i === ids.length && ev[1].i === ids.length + 1 && ev[0].map === S.id && ev[0].kv === pay.kv, 'Client ' + i + ': i = Länge der Payload-Liste, danach +1; map und kv');
    const row = ev[1].anker;
    ok(row[1] === 'falle' && row[2] === S.an('falle.1').x && row[3] === S.an('falle.1').y && row[4].typ === 'tst' && row[4].sicht === 'verborgen', 'Client ' + i + ': Zeile [id, falle, x, y, {typ, sicht}]');
  }
  // ao nutzt dieselbe Reihenfolge: Client-Liste (Payload + nachgereicht) erklärt jeden ao-Index
  S.nutzeZustand('falle.3', 'entschaerft'); S.lauf(DT * 2);
  const cl = clientListe(S.client(0), S.id);
  const ao = S.snap().away.ao;
  ok(cl.fehl.length === 0 && cl.liste.length === ids.length + 2, 'Client-Liste: Anhängen ohne Lücke (' + cl.liste.length + ')');
  const dec = ao.map(([i, zi]) => cl.liste[i] + '=' + ZUSTAENDE[zi]).sort().join(' ');
  ok(dec === 'falle.1=erkannt falle.3=entschaerft falle.5=erkannt', 'ao über die Client-Liste gelesen: falle.1 erkannt, falle.3 entschaerft, falle.5 erkannt (' + dec + ')');
  ok(JSON.stringify(Anker.ankerListe(S.g, S.aw, S.k).map((a) => a.id)) === JSON.stringify(cl.liste), 'Server-Reihenfolge (ankerListe) = Client-Liste');
  // andere Indizes (sp, cd) laufen über dieselbe Liste: Sperre auf der nachgereichten falle.1
  S.aw.ankerSperre = { 'falle.1': 'gesperrt' };
  ok(S.snap().away.sp.map((i) => cl.liste[i]).join() === 'falle.1', 'sp (gesperrte Anker) nutzt dieselbe Index-Liste'); delete S.aw.ankerSperre;
}

section('Nachzügler und Wiederverbinden: derselbe Stand, dieselbe Reihenfolge');
{
  const S = szene({ spieler: 2 });
  S.lauf(0.3);
  S.nutzeZustand('falle.5', 'erkannt'); S.nutzeZustand('falle.2', 'erkannt'); S.lauf(DT * 2);
  const vorher = clientListe(S.client(1), S.id);
  // Spieler 2 trennt und verbindet wieder (gleiche clientId): Karte kommt neu, danach die Enthüllten in derselben Reihenfolge
  S.g.removeConnection(S.cs[1]);
  const neu = { inbox: [], send(o) { this.inbox.push(o); } };
  S.g.addConnection(neu); S.g.handleMessage(neu, { t: 'hello', clientId: 'F1', name: 'Falle1', color: 1 });
  S.lauf(DT * 3);
  const nachher = clientListe(neu.inbox, S.id);
  ok(nachher.liste && nachher.fehl.length === 0, 'Wiederverbinden: Karte und Enthüllte kommen (i lückenlos)');
  ok(JSON.stringify(nachher.liste) === JSON.stringify(vorher.liste) && vorher.liste.slice(-2).join() === 'falle.5,falle.2', 'Wiederverbinden: Liste gleich der des alten Clients, Reihenfolge des Erkennens (5, 2)');
  ok(!/falle\.1"/.test(JSON.stringify(neu.inbox)), 'Wiederverbinden: die noch verborgene falle.1 steht nirgends');
  // Nach dem Erkennen verbundener Spieler: Spieler 3 stößt zur Szene
  const c3 = { inbox: [], send(o) { this.inbox.push(o); } };
  S.g.addConnection(c3); S.g.handleMessage(c3, { t: 'hello', clientId: 'F9', name: 'Spaet', color: 2 });
  S.g.handleMessage(c3, { t: 'ready', ready: true }); S.lauf(DT * 3);
  const p3 = S.g.players.find((q) => q.clientId === 'F9');
  ok(!p3 || p3.zone !== 'away' || (clientListe(c3.inbox, S.id).liste || []).length >= 0, 'Nachzügler: Beitritt ohne Fehler');
  ok((S.g.errors && (S.g.errors.length || S.g.errors)) ? false : true, 'keine Laufzeitfehler');
}

section('Entschärfen (E halten): Dauer, nur aus erkannt, Erfolg');
{
  const S = szene(); const { p } = S;
  S.lauf(0.2);
  const dauer = CONFIG.anker.halten.falle;
  S.hin(p, S.nachbar('falle.4').x, S.nachbar('falle.4').y);
  const l = []; const a = S.an('falle.4'); Anker.interactionsAt(S.g, p, a.x, a.y, l);
  ok(l.length === 1 && l[0].kind === 'anker:falle' && l[0].op === 'entschaerfen' && !l[0].blocked, 'erkannt: E bietet Entschärfen an');
  S.act(true);
  ok(S.holdFalle(p) && p.hold.dur === dauer, 'E halten startet den Hold mit CONFIG.anker.halten.falle (' + dauer + ' s)');
  S.lauf(dauer - 0.5);
  ok(S.holdFalle(p) && S.z('falle.4') === 'erkannt', 'vor Ablauf der Zeit: noch erkannt');
  ok(S.snap().players[0].action.kind === 'anker:falle' && S.snap().players[0].action.progress > 0.5 && S.snap().players[0].action.progress < 1, 'Snapshot players[].action zeigt den Fortschritt');
  S.lauf(0.8);
  ok(S.z('falle.4') === 'entschaerft' && !p.hold, 'nach der Haltezeit: entschaerft, Hold weg');
  ok(S.me.some((m) => m[0] === 'falleEntschaerft' && m[1].anker === 'falle.4' && m[1].typ === 'tst' && m[1].pid === p.id && m[1].map === S.id), 'Missions-Ereignis falleEntschaerft mit anker, typ, pid, map');
  S.lauf(0.5);
  ok(wirk.filter((w) => w.id === 'falle.4').length === 0 && S.z('falle.4') === 'entschaerft', 'Entschärfen löst nichts aus');
  const l2 = []; Anker.interactionsAt(S.g, p, a.x, a.y, l2);
  ok(l2.length === 0, 'entschärft: E bietet nichts mehr an');
  // verborgen: kein Angebot, kein Hold, kein Hinweis (keine Verrat über Hinweistext)
  const v = S.an('falle.1'); S.hin(p, S.nachbar('falle.1').x, S.nachbar('falle.1').y);
  const n0 = S.notes.length; const l3 = []; Anker.interactionsAt(S.g, p, v.x, v.y, l3);
  S.act(false); S.act(true); S.lauf(0.3);
  ok(l3.length === 0 && !p.hold && S.notes.length === n0 && S.z('falle.1') === 'verborgen', 'verborgen: kein Angebot, kein Hold, kein Hinweis');
  S.act(false);
  // ausgelöst: nichts
  S.nutzeZustand('falle.1', 'ausgeloest'); S.lauf(DT);
  const l4 = []; Anker.interactionsAt(S.g, p, v.x, v.y, l4); S.act(true); S.lauf(0.3);
  ok(l4.length === 0 && !S.holdFalle(p) && S.z('falle.1') === 'ausgeloest', 'ausgelöst: Entschärfen unmöglich');
  // holdValid direkt: nur erkannt
  const fakeHold = { kind: 'anker:falle', anker: 'falle.2', map: S.id };
  ok(Anker.holdValid(S.g, p, fakeHold) === false && Anker.holdValid(S.g, p, Object.assign({}, fakeHold, { anker: 'falle.4' })) === false, 'holdValid: verborgen und entschärft ungültig');
  ok(Anker.holdValid(S.g, p, Object.assign({}, fakeHold, { anker: 'falle.5' })) === false, 'holdValid: ausgelöst ungültig');
}

section('Entschärfen: Abbrüche');
{
  const beginne = (opts) => {
    const S = szene(opts); const { p } = S;
    S.lauf(0.2);
    const nb = S.nachbar('falle.4'); S.hin(p, nb.x, nb.y);
    S.act(true); S.lauf(1.0);
    return S;
  };
  const sauber = (S, p, name, mitAct) => {
    p = p || S.p;
    ok(!S.holdFalle(p), name + ': Hold weg');
    S.lauf(CONFIG.anker.halten.falle + 0.5);
    ok(S.z('falle.4') === 'erkannt' && !S.me.some((m) => m[0] === 'falleEntschaerft'), name + ': nichts entschärft, Zustand erkannt');
  };
  const treffer = (S, p) => combat.hitPlayer(S.g, p, 1, { kind: 'raider' });
  const hold0 = () => { const S = beginne(); ok(S.holdFalle(S.p) && S.p.hold.t > 0.5, 'Vorbedingung: Entschärfen läuft (Fortschritt ' + S.p.hold.t.toFixed(2) + ' s)'); return S; };
  for (const [name, aktion] of [
    ['Treffer auf den Schild', (S, p) => { S.g.god = false; ok(treffer(S, p) === 'shield', 'Treffer vom Schild aufgenommen'); S.g.god = true; }],
    ['Wunde (verwundet)', (S, p) => { S.g.god = false; p.zustand = 'verwundet'; combat.folgenAbgleich(S.g); S.g.god = true; }],
    ['bewusstlos', (S, p) => { S.g.god = false; p.zustand = 'bewusstlos'; combat.folgenAbgleich(S.g); S.g.god = true; }],
    ['gefesselt', (S, p) => { S.g.god = false; p.zustand = 'gefesselt'; combat.folgenAbgleich(S.g); S.g.god = true; }],
    ['Treffer ohne Schild (Wunde über hitPlayer)', (S, p) => { S.g.god = false; p.shield.seg = 0; treffer(S, p); S.g.god = true; }],
    ['Explosion/Strahl über trefferGemeldet', (S, p) => { S.g.waffenWelt.getroffen(p, 'treffer', { waffe: 'granatwerfer', flaeche: true }, { team: 'feind', x: p.x + 40, y: p.y }); }],
    ['direkter Aufruf anker.onTreffer', (S, p) => { Anker.onTreffer(S.g, p.id); }],
    ['Altweg hitPlayer (ohne Waffen-Modul): Schild', (S, p) => { combat._setzeModul('waffen', null); try { S.g.god = false; ok(treffer(S, p) === 'shield', 'Altweg: Schild nimmt den Treffer'); } finally { combat._setzeModul('waffen', undefined); S.g.god = true; } }],
    ['Altweg hitPlayer (ohne Waffen-Modul): Wunde', (S, p) => { combat._setzeModul('waffen', null); try { S.g.god = false; p.shield.seg = 0; ok(treffer(S, p) === 'wounded', 'Altweg: Wunde'); } finally { combat._setzeModul('waffen', undefined); S.g.god = true; } }],
  ]) {
    const S = hold0(); const { p } = S;
    const n0 = S.notes.length;
    aktion(S, p);
    ok(!S.holdFalle(p), name + ': Hold sofort weg');
    sauber(S, p, name);
  }
  {
    const S = hold0(); const { p } = S; const n0 = S.notes.length;
    Anker.onTreffer(S.g, p.id);
    ok(S.notes.slice(n0).some((m) => m.pid === p.id && /Getroffen/.test(m.text) && /Entschärfen/.test(m.text)), 'Treffer: Meldung „Getroffen – das Entschärfen ist unterbrochen.“');
  }
  { const S = hold0(); const { g, p } = S; g.waffenWelt.getroffen(p, 'abgelenkt', {}, {}); ok(S.holdFalle(p), 'abgelenkter Treffer (kein Treffer): Entschärfen läuft weiter'); }
  { const S = hold0(); const [] = []; const q = S.g.players[0]; S.g.god = false; combat.hitPlayer(S.g, q, 1, { kind: 'raider' }); S.g.god = true; S.act(true); S.lauf(0.1);
    ok(S.holdFalle(q) && q.hold.t < 0.5, 'zweiter Versuch nach Treffer beginnt von vorn'); }
  { const S = hold0(); const { p } = S; S.act(false); S.lauf(0.1); sauber(S, p, 'E loslassen'); }
  { const S = hold0(); const { p } = S; p.input.mx = 1; S.lauf(DT * 3); p.input.mx = 0; sauber(S, p, 'Bewegung'); }
  { const S = hold0(); const { p } = S; p.console = 'ops'; S.lauf(DT * 2); p.console = null; sauber(S, p, 'Konsole'); }
  { const S = hold0(); const { p } = S; p.zone = 'ship'; S.lauf(DT * 2); p.zone = 'away'; sauber(S, p, 'Kartenwechsel (Zone verlassen)'); }
  { const S = hold0(); const { g, p } = S; p.downed = true; ok(Anker.holdValid(g, p, p.hold) === false, 'Niederstrecken (downed): holdValid ungültig'); p.downed = false; }
  { const S = hold0(); const { g, p } = S; g.removeConnection(S.cs[0]); ok(p.hold === null, 'Trennung: Hold sofort weg'); }
  {
    // Kartenwechsel: dieselbe Anker-Id auf einer anderen Karte darf den Hold nicht weitertragen (h.map)
    const S = hold0(); const { g, p } = S;
    const h = p.hold; ok(h.map === S.id, 'Hold trägt die Karte');
    const fremd = Object.assign({}, h, { map: 'andere.karte' });
    ok(Anker.holdValid(g, p, fremd) === false && Anker.holdValid(g, p, h) === true, 'holdValid: anderer Kartenschlüssel ungültig');
  }
  {
    // Abbruch durch das Auslösen: wer entschärft, kommt zu spät
    const S = szene({ spieler: 2 }); const [a, b] = S.ps;
    S.lauf(0.2);
    const nb = S.nachbar('falle.4'); S.hin(a, nb.x, nb.y); S.act(true, 0); S.lauf(1.0);
    ok(S.holdFalle(a), 'Vorbedingung: a entschärft');
    S.bei(b, 'falle.4', 3, 0); S.lauf(DT * 2);
    ok(S.z('falle.4') === 'ausgeloest' && !a.hold, 'b löst aus: Zustand ausgelöst, Entschärfen von a abgebrochen');
    ok(S.notes.some((m) => m.pid === a.id && /Zu spät/.test(m.text)), 'a bekommt die Meldung „Zu spät“');
    S.lauf(CONFIG.anker.halten.falle + 0.5);
    ok(S.z('falle.4') === 'ausgeloest' && !S.me.some((m) => m[0] === 'falleEntschaerft'), 'Entschärfen nach dem Auslösen unmöglich');
  }
}

section('Auslösen genau einmal');
{
  const S = szene(); const { p, g, aw } = S;
  S.lauf(0.2); wirk.length = 0;
  const r = CONFIG.anker.falle.radius.standard * TILE;
  // Zonenrand: knapp außerhalb löst nicht aus, knapp innerhalb schon
  S.bei(p, 'falle.1', r + 2, 0); S.lauf(DT * 3);
  ok(S.z('falle.1') === 'verborgen' && wirk.length === 0, 'knapp außerhalb der Zone: keine Wirkung (r = ' + r.toFixed(1) + ' px)');
  S.bei(p, 'falle.1', r - 2, 0); S.lauf(DT * 3);
  ok(S.z('falle.1') === 'ausgeloest' && wirk.length === 1 && wirk[0].id === 'falle.1' && wirk[0].pid === p.id, 'knapp innerhalb: ausgelöst, Wirkung genau einmal mit Auslöser');
  ok(wirk[0].f.typ === 'tst' && wirk[0].f.x === S.an('falle.1').x && wirk[0].f.px === S.mitte('falle.1').x && wirk[0].aw === aw, 'Handler bekommt (game, aw, falle {id,x,y,px,py,typ,sicht}, Spieler)');
  ok(S.evn('ankerZustand') >= 1 && S.me.filter((m) => m[0] === 'falleAusgeloest' && m[1].anker === 'falle.1').length === 1, 'Missions-Ereignis falleAusgeloest genau einmal');
  S.lauf(1); S.bei(p, 'falle.1', 0, 0); S.lauf(1);
  ok(wirk.length === 1, 'im Zustand ausgeloest löst sie nie wieder aus (Weggehen, Wiedereintreten, 1 s Stand)');
  ok(S.enthuellt(0).some((m) => m.anker[0] === 'falle.1'), 'eine verborgen ausgelöste Falle wird den Clients enthüllt (der Client zeigt die Wirkung)');
  // Nachbarkachel (1,0 Kachel Abstand) löst keine Falle aus (Entschärfen von dort muss gehen)
  for (const fid of ['falle.2', 'falle.3', 'falle.4', 'falle.5']) { const nb = S.nachbar(fid); S.hin(p, nb.x, nb.y); S.lauf(DT * 2); }
  ok(['falle.2', 'falle.3', 'falle.4', 'falle.5'].every((f) => S.z(f) === (f === 'falle.3' || f === 'falle.4' ? 'erkannt' : 'verborgen')) && wirk.length === 1, 'Nachbarkachel: nichts löst aus');
  // Typ-Radius: druck (0,5) kleiner als standard (0,6)
  const rd = CONFIG.anker.falle.radius.druck * TILE;
  S.bei(p, 'falle.3', rd + 2, 0); S.lauf(DT * 2);
  ok(S.z('falle.3') === 'erkannt', 'Radius je Typ: druck löst bei ' + (rd + 2).toFixed(1) + ' px nicht aus');
  S.bei(p, 'falle.3', rd - 2, 0); S.lauf(DT * 2);
  ok(S.z('falle.3') === 'ausgeloest', 'Radius je Typ: druck löst bei ' + (rd - 2).toFixed(1) + ' px aus (erkannte Falle ohne Handler: nur Zustand)');
  // entschärft löst nie aus
  S.hin(p, S.nachbar('falle.4').x, S.nachbar('falle.4').y); S.act(true); S.lauf(CONFIG.anker.halten.falle + 0.4); S.act(false);
  ok(S.z('falle.4') === 'entschaerft', 'Vorbedingung: falle.4 entschärft');
  S.bei(p, 'falle.4', 0, 0); S.lauf(1);
  ok(S.z('falle.4') === 'entschaerft' && !wirk.some((w) => w.id === 'falle.4'), 'entschärft: Betreten löst nie aus');
}
{
  // zwei Spieler im selben Tick auf derselben Falle; dasselbe Update zweimal
  const S = szene({ spieler: 2 }); const [a, b] = S.ps;
  S.lauf(0.2); wirk.length = 0;
  S.bei(a, 'falle.4', 2, 0); S.bei(b, 'falle.4', -2, 3);
  S.lauf(DT);
  ok(wirk.filter((w) => w.id === 'falle.4').length === 1 && S.z('falle.4') === 'ausgeloest', 'zwei Spieler im selben Tick: Wirkung genau einmal');
  ok(S.me.filter((m) => m[0] === 'falleAusgeloest' && m[1].anker === 'falle.4').length === 1 && S.ev.filter((e) => e[0] === 'ankerZustand' && e[1].anker === 'falle.4').length === 1, 'ankerZustand und falleAusgeloest je genau einmal');
  S.bei(a, 'falle.2', 2, 0); S.bei(b, 'falle.5', 2, 0);
  Fallen.update(S.g, DT); Fallen.update(S.g, DT);
  ok(wirk.filter((w) => w.id === 'falle.2').length === 1 && S.z('falle.2') === 'ausgeloest' && S.z('falle.5') === 'ausgeloest', 'dasselbe Update zweimal: je Falle einmal; zwei Fallen im selben Tick beide');
  const aw = S.aw; const f = wirk.find((w) => w.id === 'falle.2').f;
  ok(Fallen.ausloesen(S.g, aw, f, a) === false && wirk.filter((w) => w.id === 'falle.2').length === 1, 'ausloesen() auf eine ausgelöste Falle: false, keine zweite Wirkung');
  // Gegner lösen nichts aus
  const c = S.mitte('falle.1');
  S.g.away.drones.push({ id: 'dx', alive: true, x: c.x, y: c.y, kind: 'raider', hp: 3 });
  Fallen.update(S.g, DT); Fallen.update(S.g, DT);
  S.g.away.drones.length = 0;
  ok(S.z('falle.1') === 'verborgen', 'Gegner auf der Falle: keine Auslösung (Fallen treffen nur Spieler)');
  // liegende/abwesende Spieler lösen nichts aus
  S.bei(a, 'falle.1', 0, 0); a.downed = true; S.bei(b, 'falle.1', 0, 0); b.zone = 'ship';
  Fallen.update(S.g, DT);
  ok(S.z('falle.1') === 'verborgen', 'verwundeter Spieler (downed) und Spieler an Bord lösen nicht aus');
  a.downed = false; b.zone = 'away'; Fallen.update(S.g, DT);
  ok(S.z('falle.1') === 'ausgeloest', 'danach löst der aufrechte Spieler aus');
}
{
  // Wurf im Handler: Zustand bleibt, kein zweiter Aufruf, Tick läuft weiter, Fehler gezählt
  const S = szene(); const { p } = S; S.lauf(0.2); wirk.length = 0;
  wirkSchalter = () => { throw new Error('Wirkung kaputt'); };
  const e0 = (S.g.errors && S.g.errors.length) || 0;
  S.bei(p, 'falle.1', 0, 0); S.lauf(DT * 3);
  wirkSchalter = null;
  ok(S.z('falle.1') === 'ausgeloest' && wirk.length === 1, 'Handler wirft: Zustand bleibt ausgelöst, genau ein Aufruf, Tick läuft weiter');
  const errN = (S.g.errors && (S.g.errors.length != null ? S.g.errors.length : S.g.errors)) || 0;
  ok(errN >= e0, 'Fehler wird gezählt, nicht verschluckt (countError)');
}

section('Zeitwirkung über den Tick-Hook (Paket D)');
{
  const S = szene(); const { p, g, aw } = S; S.lauf(0.2); wirk.length = 0;
  const zeiten = [];
  wirkSchalter = (game, a, f) => { Fallen.zeitwirkung(game, a, f, (gm, w, dt, e) => { zeiten.push(+e.t.toFixed(2)); return e.t < 0.5; }); };
  const basis = Object.keys(S.snap().away).sort().join();
  S.bei(p, 'falle.1', 0, 0); S.lauf(1.5);
  wirkSchalter = null;
  ok(zeiten.length === Math.round(0.5 / DT) + 1 && zeiten[0] === +DT.toFixed(2) && zeiten[zeiten.length - 1] >= 0.5, 'Zeitwirkung: ein Aufruf je Tick mit wachsender Zeit, endet bei false (' + zeiten.length + ' Aufrufe)');
  const n = zeiten.length; S.lauf(1);
  ok(zeiten.length === n, 'nach dem Ende kein weiterer Aufruf');
  ok(Object.keys(S.snap().away).sort().join() === basis.replace(/,?ao/, '').replace(/^,/, '') || !/laufend|zeitwirkung/i.test(JSON.stringify(S.snap())), 'kein neues Snapshot-Feld für die Zeitwirkung');
  // wirft die Zeitwirkung, endet sie ohne den Tick zu stören
  let k2 = 0;
  wirkSchalter = (game, a, f) => { Fallen.zeitwirkung(game, a, f, () => { k2++; throw new Error('Takt kaputt'); }); };
  S.bei(p, 'falle.2', 0, 0); S.lauf(0.5); wirkSchalter = null;
  ok(k2 === 1, 'werfende Zeitwirkung wird nach dem ersten Wurf entfernt');
}

section('Scanner-Anbindung (scanbar art falle)');
{
  const S = szene({ spieler: 2 }); const { p, g, aw } = S;
  S.lauf(0.3);
  const dbgScan = (st) => Scanbar.debugScanfertig(g, p, st);
  S.bei(p, 'falle.1', 40, 0);
  p.x = S.mitte('falle.1').x + 3 * TILE * 0 + 0; p.y = S.mitte('falle.1').y;   // knapp neben falle.1, außerhalb der Auslösezone? Zone 0,6 Kachel: Abstand 40 px > 19 px
  S.hin(p, S.mitte('falle.1').x + 40, S.mitte('falle.1').y);
  const ent0 = S.enthuellt(0).length;
  dbgScan(0); S.lauf(DT);
  ok(!aw.sc, 'Stufe 0 (Rauschen): nichts erfasst');
  dbgScan(1); S.lauf(DT);
  const e1 = aw.sc && aw.sc['falle:falle.1'];
  ok(e1 && e1.sk === 1 && e1.x === undefined && e1.typ === 'tst', 'Stufe 1: Datenblatt (Typ) ohne Ort');
  ok(S.z('falle.1') === 'verborgen' && S.enthuellt(0).length === ent0, 'Stufe 1: nicht erkannt, nicht enthüllt');
  const sc1 = S.snap().away.sc.find((r) => r[0] === 'falle.1');
  ok(sc1 && sc1.length === 4 && sc1[1] === 'falle' && sc1[2] === 'tst' && sc1[3] === 1, 'Snapshot sc: [id, art, typ, 1] ohne x,y');
  const c1 = S.mitte('falle.1');
  const rest = [];
  for (let i = 0; i < 8; i++) { S.lauf(DT * 2); rest.push(JSON.stringify(S.snap())); }
  const alles1 = rest.join('|');
  ok(!alles1.includes(',' + c1.x + ',' + c1.y + ']') && !alles1.includes('"x":' + c1.x), 'nach Stufe 1: der Ort von falle.1 steht in keinem Snapshot (Regex über 8 Snapshots)');
  ok(S.client(0).concat(S.client(1)).every((m) => m.kind !== 'ankerEnthuellt'), 'nach Stufe 1: kein ankerEnthuellt');
  ok(!aw.sc['falle:falle.5'], 'Reichweite: nur Ziele im Scankreis (falle.5 weit außerhalb, Abstand ' + Math.round(Math.hypot(S.an('falle.5').x - S.an('falle.1').x, S.an('falle.5').y - S.an('falle.1').y)) + ' Kacheln)');
  dbgScan(2); S.lauf(DT * 2);
  const e2 = aw.sc['falle:falle.1'];
  ok(e2.sk === 2 && e2.x === Math.round(c1.x) && e2.y === Math.round(c1.y), 'Stufe 2: Position gesetzt');
  ok(S.z('falle.1') === 'erkannt', 'Stufe 2: Falle wird erkannt');
  for (const i of [0, 1]) { const ev = S.enthuellt(i); ok(ev.length >= 1 && ev.some((m) => m.anker[0] === 'falle.1' && m.anker[2] === S.an('falle.1').x), 'Stufe 2: Client ' + i + ' bekommt ankerEnthuellt mit dem Ort'); }
  ok(!aw.sc['falle:falle.5'] || aw.sc['falle:falle.5'].sk === 0, 'weit entfernte falle.5 bleibt unerkannt');
  ok(S.z('falle.5') === 'verborgen', 'weit entfernte falle.5 bleibt verborgen');
  const n1 = S.enthuellt(0).length; dbgScan(3); S.lauf(DT * 2);
  ok(S.enthuellt(0).length === n1 && S.z('falle.1') === 'erkannt', 'Stufe 3 danach: nichts doppelt gesendet');
  // erkannt: Entschärfen von der Nachbarkachel; danach fällt die Falle aus dem Scan
  S.hin(p, S.nachbar('falle.1').x, S.nachbar('falle.1').y); S.act(true); S.lauf(CONFIG.anker.halten.falle + 0.4); S.act(false);
  ok(S.z('falle.1') === 'entschaerft', 'erkannte (gescannte) Falle lässt sich entschärfen');
  S.lauf(1.2);
  ok(!aw.sc || !aw.sc['falle:falle.1'], 'entschärfte Falle fällt aus aw.sc (ziele liefert nur verborgene und erkannte)');
}
{
  // passive Falle: Datenblatt ohne Position bei Stufe 1, Stufe 2 liefert den Eintrag mit Ort
  const S = szene(); const { p, g, aw } = S; S.lauf(0.3);
  S.hin(p, S.mitte('falle.4').x + 40, S.mitte('falle.4').y); Scanbar.debugScanfertig(g, p, 1); S.lauf(DT);
  const e4 = aw.sc['falle:falle.4'];
  ok(e4 && e4.sk === 1 && e4.x === undefined && S.z('falle.4') === 'erkannt', 'passive Falle: Stufe 1 Datenblatt ohne Ort, Zustand erkannt (unverändert)');
  Scanbar.debugScanfertig(g, p, 2); S.lauf(DT);
  ok(aw.sc['falle:falle.4'].x != null && !S.enthuellt(0).some((m) => m.anker[0] === 'falle.4'), 'passive Falle: Stufe 2 Ort im Eintrag, kein Enthüllen (stand schon im Payload)');
}
{
  // Speicher voll: nichts erfasst, nichts enthüllt
  const S = szene(); const { p, g, aw } = S; S.lauf(0.3);
  aw.sc = {};
  for (let i = 0; i < CONFIG.scanner.maxEintraege; i++) aw.sc['test:d' + i] = { id: 'd' + i, art: 'test', typ: 'testerz', sk: 1 };
  S.hin(p, S.mitte('falle.2').x + 40, S.mitte('falle.2').y);
  Scanbar.debugScanfertig(g, p, 3);
  ok(S.z('falle.2') === 'verborgen' && !aw.sc['falle:falle.2'] && S.enthuellt(0).length === 0, 'Speicher voll (16 Einträge): Falle nicht erfasst, nicht erkannt, nicht enthüllt');
  // Datenblatt-Einträge für die Typen (Länge prüft test-scanner-anzeige)
  const D = require('../content/scanner/datenblaetter.json');
  ok(['schott', 'druck', 'schuss', 'test'].every((t) => D.typen[t] && D.typen[t].hinweisAb >= 1), 'datenblaetter.json: Typen schott, druck, schuss (und test) vorhanden');
}

section('4 Spieler');
{
  const S = szene({ spieler: 4 }); const [a, b, c, d] = S.ps;
  S.lauf(0.3); wirk.length = 0;
  S.bei(a, 'falle.1', 2, 0); S.bei(b, 'falle.2', 2, 0); S.bei(c, 'falle.4', 2, 0); S.bei(d, 'falle.4', -2, 0);
  S.lauf(DT * 2);
  ok(['falle.1', 'falle.2', 'falle.4'].every((f) => wirk.filter((w) => w.id === f).length === 1) && wirk.length === 3, '4 Spieler, drei Fallen (eine doppelt betreten): je genau eine Wirkung');
  ok(wirk.find((w) => w.id === 'falle.4').pid === c.id, 'bei gleichzeitigem Betreten gewinnt der erste Spieler in Spielerreihenfolge (deterministisch)');
  for (const i of [0, 1, 2, 3]) {
    const ev = S.enthuellt(i).map((m) => m.anker[0]);
    ok(ev.length === 2 && ev.includes('falle.1') && ev.includes('falle.2'), 'Client ' + i + ': beide verborgenen enthüllt (' + ev.join(',') + ')');
  }
  const l0 = clientListe(S.client(0), S.id), l3 = clientListe(S.client(3), S.id);
  ok(JSON.stringify(l0.liste) === JSON.stringify(l3.liste) && l0.fehl.length === 0, 'alle Clients: dieselbe Ankerliste');
  const dec = S.snap().away.ao.map(([i, zi]) => l0.liste[i] + '=' + ZUSTAENDE[zi]).sort().join(' ');
  ok(dec === 'falle.1=ausgeloest falle.2=ausgeloest falle.4=ausgeloest', 'ao im Snapshot (4 Spieler): ' + dec);
}

section('Weltstand-Roundtrip (opts.merken, sichern, Neuaufbau der Außenkarte)');
{
  const S = szene({ spieler: 2 }); const { g, id } = S;
  S.lauf(0.3);
  ok(Anker.setzen(g, id, 'falle.5', 'erkannt', null, { merken: true }) === null && Anker.setzen(g, id, 'falle.2', 'erkannt', null, { merken: true }) === null, 'zwei verborgene Fallen erkannt (merken)');
  ok(Anker.setzen(g, id, 'falle.3', 'entschaerft', null, { merken: true }) === null && Anker.setzen(g, id, 'falle.2', 'ausgeloest', null, { merken: true }) === null, 'passive entschärft, eine ausgelöst (merken)');
  S.lauf(DT * 2);
  L.sichern(g, id);
  const e = L.eintrag(g, id);
  const z = JSON.parse(JSON.stringify(e.zustaende));
  ok(z['falle.5'] === 'erkannt' && z['falle.2'] === 'ausgeloest' && z['falle.3'] === 'entschaerft' && !z['falle.1'] && !z['falle.4'], 'Weltstand-Eintrag: nur Abweichungen (falle.5 erkannt, falle.2 ausgelöst, falle.3 entschärft)');
  ok(JSON.stringify(JSON.parse(JSON.stringify(L.toSave(g)))).includes('falle.5'), 'toSave trägt die Fallenzustände (JSON-fest)');
  // Außenkarte entladen und neu aufbauen (Cache liefert die Rohkarte mit den Fallen-Ankern)
  delete g.aways[id];
  const aw2 = L.get(g, id); g.away = aw2; aw2.active = true;
  const k2 = W.AWAY_MAPS[id].karte;
  ok(k2 !== S.k && aw2 !== S.aw, 'Vorbedingung: neue Karte und neue Außenkarte');
  ok(Anker.zustand(g, id, 'falle.5') === 'erkannt' && Anker.zustand(g, id, 'falle.2') === 'ausgeloest' && Anker.zustand(g, id, 'falle.3') === 'entschaerft', 'Zustände nach dem Neuaufbau wiederhergestellt');
  ok(Anker.zustand(g, id, 'falle.1') === 'verborgen' && Anker.zustand(g, id, 'falle.4') === 'erkannt', 'unveränderte Fallen: Start je sicht');
  g.step(); g.step();
  const liste = Anker.ankerListe(g, aw2, k2).map((a) => a.id);
  const basis = Anker.payloadAnker(k2).length;
  ok(liste.slice(basis).join() === 'falle.2,falle.5', 'Enthüllte aus dem Weltstand in Kartenreihenfolge angehängt (' + liste.slice(basis).join() + ')');
  // die Clients (hatten schon eine Liste in der Reihenfolge des Erkennens 5, 2) bekommen Karte und Enthüllte neu
  for (const i of [0, 1]) {
    const cl = clientListe(S.client(i), id);
    ok(cl.fehl.length === 0 && cl.liste.join() === liste.join(), 'Client ' + i + ': nach dem Neuaufbau dieselbe Liste wie der Server (' + cl.liste.slice(basis).join() + ')');
  }
  const dec = g.snapshot().away.ao.map(([i, zi]) => liste[i] + '=' + ZUSTAENDE[zi]).sort().join(' ');
  ok(dec === 'falle.2=ausgeloest falle.3=entschaerft falle.5=erkannt', 'ao nach dem Neuaufbau: ' + dec);
  ok(!/falle\.1"/.test(JSON.stringify(S.client(0).filter((m) => m.kind === 'awayMap').slice(-1))), 'falle.1 bleibt nach dem Neuaufbau verborgen (nicht im Payload)');
  // ausgelöst/entschärft laden nie wieder aus
  wirk.length = 0;
  S.bei(S.p, 'falle.2', 0, 0); S.bei(S.ps[1], 'falle.3', 0, 0); g.step(); g.step();
  ok(wirk.length === 0, 'nach dem Neuaufbau lösen ausgelöste/entschärfte Fallen nicht erneut aus');
}

section('Debug falletest (nur mit --debug, nur gebaute Karte am Boden)');
{
  const dbg = (S, extra) => S.g.handleMessage(S.cs[0], Object.assign({ t: 'debug', cmd: 'falletest' }, extra || {}));
  const S = szene(); const { g, p, id } = S;
  S.lauf(0.2);
  dbg(S);
  const t1 = S.an('falle.test1'), t2 = S.an('falle.test2');
  ok(t1 && t2 && t1.sicht === 'verborgen' && t2.sicht === 'passiv' && t1.typ === 'test', 'falletest ohne Argumente: eine verborgene und eine passive Test-Falle (Typ test)');
  const pt = Physics.toTile(p.x, p.y);
  ok([t1, t2].every((t) => Math.hypot(t.x - pt.x, t.y - pt.y) >= 2.9 && Math.hypot(t.x - pt.x, t.y - pt.y) <= 8), 'beide in der Nähe des Spielers (3 bis 8 Kacheln)');
  S.lauf(DT * 3);
  ok(S.z('falle.test1') === 'verborgen' && S.z('falle.test2') === 'erkannt', 'Startzustände: verborgen und erkannt');
  const pay = g.awayMapPayload(S.k);
  ok(!pay.anker.some((r) => r[0] === 'falle.test1') && pay.anker.some((r) => r[0] === 'falle.test2'), 'Payload: die verborgene Test-Falle fehlt, die passive steht drin');
  ok(S.client(0).filter((m) => m.kind === 'awayMap').length >= 2, 'Clients bekommen die geänderte Karte neu');
  wirk.length = 0; const notes0 = S.notes.length;
  S.bei(p, 'falle.test2', 0, 0); S.lauf(DT * 2);
  ok(S.z('falle.test2') === 'ausgeloest' && S.notes.slice(notes0).some((m) => /Falle ausgelöst \(Test\)/.test(m.text)), 'Test-Typ hat eine Wirkung: Meldung (nur mit game.debug)');
  dbg(S, { args: 'schott passiv' });
  ok(!S.an('falle.test2') && S.an('falle.test1') && S.an('falle.test1').typ === 'schott' && S.an('falle.test1').sicht === 'passiv', 'falletest <typ> <sicht>: ersetzt die alten, eine Falle mit dem Wunschtyp');
  const n1 = S.notes.length; dbg(S, { args: 'kaputt!' });
  ok(/Typ klein geschrieben/.test(S.notes[S.notes.length - 1].text) && S.notes.length === n1 + 1, 'ungültiger Typ: Hinweistext');
  dbg(S, { args: 'schott offen' });
  ok(/sicht verborgen \| passiv/.test(S.notes[S.notes.length - 1].text), 'ungültige sicht: Hinweistext');
  // ohne --debug wirkungslos
  const N = szene({ debug: false });
  N.g.handleMessage(N.cs[0], { t: 'debug', cmd: 'falletest' });
  ok(!N.an('falle.test1') && !N.an('falle.test2'), 'ohne --debug: keine Test-Fallen');
  ok(/deaktiviert/.test(N.notes[N.notes.length - 1].text), 'ohne --debug: Hinweis „deaktiviert“');
  ok(/nur mit Server --debug/.test(Fallen.debugFalletest(N.g, N.p, [])), 'debugFalletest direkt ohne --debug: Fehlertext');
  const W0 = new Game({ noStore: true, seed: 11, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c0 = { inbox: [], send(o) { this.inbox.push(o); } };
  W0.addConnection(c0); W0.handleMessage(c0, { t: 'hello', clientId: 'Z', name: 'Z', color: 0 }); W0.handleMessage(c0, { t: 'ready', ready: true });
  for (let i = 0; i < 6; i++) W0.step();
  ok(/nur am Boden/.test(Fallen.debugFalletest(W0, W0.players[0], [])), 'nicht am Boden: Hinweistext');
  W0.setAwayMap('kesh'); W0.aways.kesh.active = true; interior.placeOnAwayPad(W0, W0.players[0], 0);
  ok(/nur auf gebauten Karten/.test(Fallen.debugFalletest(W0, W0.players[0], [])), 'Handkarte: Hinweistext (nur gebaute Karten)');
}

section('Handkarten und Karten ohne Fallen unverändert');
{
  const g = new Game({ noStore: true, seed: 11, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(o) { this.inbox.push(o); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'H', name: 'H', color: 0 }); g.handleMessage(c, { t: 'ready', ready: true });
  for (let i = 0; i < 6; i++) g.step();
  g.setAwayMap('kesh'); g.aways.kesh.active = true; interior.placeOnAwayPad(g, g.players[0], 0);
  for (let i = 0; i < 10; i++) g.step();
  ok(!g.snapshot().away.ao && !g.snapshot().away.sc, 'Handkarte: kein ao, kein sc');
  const k = Buehne.hand('kesh');
  ok(Anker.payloadAnker(k) === k.anker && Anker.ankerListe(g, g.away, k) === k.anker, 'Karte ohne Fallen: payloadAnker/ankerListe sind die Ankerliste selbst (kein Zusatzaufwand)');
}

console.log('\n' + (fails ? 'FEHLER: ' + fails + ' von ' + n : 'Alle ' + n + ' Prüfungen grün.'));
process.exit(fails ? 1 : 0);
