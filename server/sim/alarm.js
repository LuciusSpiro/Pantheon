'use strict';
// EK2 Raum-Alarm: Alarmstufe je Raumszene, Patrouillen mit Sensorkreisen, Signatur (Schleichfahrt A13), Minen, Einsprung von Jägern.
// Briefing: Vault Coop-Spiel/Briefing Eisenwald-Kampagne (EK1-EK9), Abschnitt EK2. Alle Zahlen: CONFIG.alarm.
//
// Zustand (nur im Raum, je Szene neu): game.space.alarm (null = die Szene kennt keinen Alarm) und game.space.minen.
//   alarm = { aktiv, stufe 0|1|2, wissen, einsprung, schleich, ziel, laermListe [{t, w}], laermT, laermPos, einsprungAt, einsprungFertig,
//             pingBis, schildeUnten, hochBis, sig, antriebT, grund }
//   Stufen: 0 ruhig, 1 misstrauisch, 2 alarmiert. Auslöser: laerm (Waffenfeuer, Antrieb Energie 4, Reaktor überladen),
//   entdeckt (Patrouille sieht die Lerche oder wird getroffen), mine (Explosion). Alarmiert bleibt bis zum Verlassen der Szene.
//   Folge „alarmiert“: alle Patrouillen greifen an; gibt es in der Szene keine Patrouille, springen nach einsprung.verzoegerung s
//   zwei Jäger am nächstgelegenen Sprungpunkt ein (Ansage sofort).
//   Ohne an() (Baustein raum_alarm_an u. a.) ist alles aus: Golden m1–m3 und alle bisherigen Szenen laufen unverändert.
// Patrouille: e.pat = { a, b, s, d, v } (Strecke a–b, Anteil s, Richtung d, Tempo v), e.patrolle = true (war je eine Patrouille),
//   e.sensor, e.verdacht (s im Sensorkreis), e.sichtBis (nach Weitscan sichtbar bis).
// Mine: { id, x, y, besitzer: 'gegner'|'lerche', ohneStrom, gesehen, tag }
const Locations = require('../../shared/locations.js');
const Sektoren = require('../../shared/sektoren.js');
const Physics = require('../../shared/physics.js');
const interior = require('./interior.js');
const Pilot = require('./pilot.js');
const { makeRng, clamp, dist } = require('../util.js');

let spaceMod = null;   // lazy wegen Zirkelbezug space -> alarm
const space = () => spaceMod || (spaceMod = require('./space.js'));
const r1 = (v) => Math.round(v * 10) / 10;
const STUFEN = ['ruhig', 'misstrauisch', 'alarmiert'];

function C(game) { return game.C.alarm || {}; }
function st(game) { return game.space.alarm || null; }
function aktiv(game) { const s = game.space.alarm; return !!(s && s.aktiv); }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// ---------- Zustand ----------
function szeneBetreten(game) {
  game.space.alarm = null;
  game.space.minen = [];
}
function ensure(game) {
  const sp = game.space;
  if (!sp.alarm) {
    sp.alarm = { aktiv: false, stufe: 0, wissen: false, einsprung: true, einsprungN: null, schleich: false, ziel: null, laermListe: [], laermT: -99,
      laermPos: null, einsprungAt: null, einsprungFertig: false, pingBis: 0, schildeUnten: false, hochBis: 0, sig: 1, antriebT: 0, grund: null };
  }
  if (!sp.minen) sp.minen = [];
  return sp.alarm;
}
// Alarm in dieser Szene einschalten. o: { wissen (Gegner wissen von der Lerche), einsprung (Standard true), jaeger (Zahl), schleichfahrt }
function an(game, o) {
  const s = ensure(game); const q = o || {};
  s.aktiv = true;
  if (q.wissen !== undefined) s.wissen = !!q.wissen;
  if (q.einsprung !== undefined) s.einsprung = q.einsprung !== false;
  if (q.jaeger != null) s.einsprungN = Math.max(1, Math.min(4, Math.round(Number(q.jaeger)) || 2));
  if (q.schleichfahrt !== undefined) s.schleich = !!q.schleichfahrt;
  if (s.wissen && s.stufe < 1) { s.stufe = 1; s.grund = 'wissen'; }
  return s;
}
function stufe(game) { const s = st(game); return s && s.aktiv ? s.stufe : 0; }
function stufeName(game) { return STUFEN[stufe(game)]; }

// ---------- Stufen und Auslöser ----------
function setzeStufe(game, n, grund) {
  const s = st(game);
  if (!s || !s.aktiv || n <= s.stufe) return;
  s.stufe = n; s.grund = grund;
  game.emit('raumAlarm', { stufe: n, grund });
  game.emit('sfx', { name: n >= 2 ? 'alarm_red' : 'alarm_yellow' });
  if (n === 1) game.oda('Funkverkehr der Gegner nimmt zu – sie sind misstrauisch. Leise bleiben!', null);
  if (n >= 2) {
    const t = { laerm: 'Lärm hat uns verraten', entdeckt: 'Eine Patrouille hat uns entdeckt', mine: 'Die Explosion hat alles geweckt' }[grund] || 'Die Gegner wissen von uns';
    game.oda(`ALARM! ${t} – alle Patrouillen greifen an.`, null);
  }
  game.missionEvent('raumAlarm', { stufe: n, grund });
  if (n >= 2) angriff(game);
}
// Auslöser melden: 'entdeckt' | 'mine' (sofort alarmiert), 'laerm' siehe laerm()
function ausloeser(game, grund) {
  const s = st(game);
  if (!s || !s.aktiv) return;
  if (grund === 'laerm') return laerm(game, 'waffen');
  setzeStufe(game, 2, grund);
}
// Lärm: art 'waffen' (Lanze, Salve, Bolzen der Lerche) | 'antrieb' | 'reaktor' (überladen)
function laerm(game, art) {
  const s = st(game);
  if (!s || !s.aktiv || s.stufe >= 2) return;
  const L = C(game).laerm || {};
  if (game.time - s.laermT < (L.takt != null ? L.takt : 1)) return;
  s.laermT = game.time;
  s.laermListe.push({ t: game.time, w: (L.gewicht && L.gewicht[art]) != null ? L.gewicht[art] : 1 });
  s.laermPos = { x: Math.round(game.ship.x), y: Math.round(game.ship.y) };
  stufeAusPunkten(game);
}
// Lärmpunkte = Summe der Gewichte aller Ereignisse der letzten misstrauenDauer Sekunden
function laermPunkte(game, s) {
  const L = C(game).laerm || {};
  const von = game.time - (L.misstrauenDauer || 30);
  if (s.laermListe.length && s.laermListe[0].t <= von) s.laermListe = s.laermListe.filter((e) => e.t > von);
  return s.laermListe.reduce((a, e) => a + e.w, 0);
}
function stufeAusPunkten(game) {
  const s = st(game); const L = C(game).laerm || {};
  if (!s || s.stufe >= 2) return;
  const p = laermPunkte(game, s);
  const ab = s.wissen ? 1 : (L.alarmAb != null ? L.alarmAb : 2);
  if (p >= ab) setzeStufe(game, 2, 'laerm');
  else if (p > 0) setzeStufe(game, 1, 'laerm');
}

// Folge „alarmiert“: Patrouillen greifen an, ohne Patrouille springen Jäger ein
function angriff(game) {
  const s = st(game);
  for (const e of game.space.enemies) if (e.pat) freigeben(game, e);
  const hatPatrouille = game.space.enemies.some((e) => e.patrolle);
  if (!hatPatrouille && s.einsprung && !s.einsprungFertig && s.einsprungAt == null) {
    const E = C(game).einsprung || {};
    const n = s.einsprungN || E.n || 2;
    s.einsprungAt = game.time + (E.verzoegerung != null ? E.verzoegerung : 5);
    s.einsprungN = n;
    game.oda(`Sprungsignatur am nächsten Sprungpunkt: ${n} feindliche Jäger springen in ${Math.round(s.einsprungAt - game.time)} Sekunden ein!`, null);
    game.emit('einsprungAnsage', { in: Math.round(s.einsprungAt - game.time), n });
    game.missionEvent('einsprungAnsage', { n });
  }
}
function freigeben(game, e) {
  delete e.pat;
  e.alarmiert = true;
  e.verdacht = 0;
  if (Pilot.flies(game, e)) Pilot.initSpawn(game, e);
}

// ---------- Sprungpunkte der Szene ----------
function sprungpunkte(game) {
  const loc = Locations.get(game.ship.scene);
  if (!loc) return [];
  const w = loc.scene.w, h = loc.scene.h;
  const here = Sektoren.hexVonOrt(game.ship.scene);
  const out = [];
  if (here) {
    const rand = (game.C.sektoren || {}).randAbstand;
    for (const n of Sektoren.nachbarn(here)) {
      if (!Sektoren.spielbar(n)) continue;
      const p = Sektoren.sprungpunktLage(w, h, Sektoren.richtung(here, n), rand);
      if (p) out.push({ x: p.x, y: p.y, hex: n });
    }
  }
  if (!out.length) out.push({ x: 90, y: h / 2 }, { x: w - 90, y: h / 2 }, { x: w / 2, y: 90 }, { x: w / 2, y: h - 90 });
  return out;
}
function naechsterSprungpunkt(game) {
  const L = game.ship;
  return sprungpunkte(game).sort((a, b) => dist(a.x, a.y, L.x, L.y) - dist(b.x, b.y, L.x, L.y))[0];
}
function einspringen(game) {
  const s = st(game); const E = C(game).einsprung || {};
  s.einsprungFertig = true; s.einsprungAt = null;
  const p = naechsterSprungpunkt(game);
  const n = s.einsprungN || E.n || 2;
  const L = game.ship;
  const a = Math.atan2(L.y - p.y, L.x - p.x);
  const out = [];
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * (E.versatz != null ? E.versatz : 45);
    const e = space().spawnEnemy(game, E.kind || 'raider', { x: p.x - Math.sin(a) * off, y: p.y + Math.cos(a) * off, facing: a, tag: 'einsprung' });
    e.eingesprungen = true;
    out.push(e);
  }
  game.emit('einsprung', { x: Math.round(p.x), y: Math.round(p.y), n });
  game.emit('sfx', { name: 'jump' });
  game.oda(`Feindliche Jäger sind eingesprungen (${n})! Sie kommen von ${Sektoren.imRaster && p.hex ? Sektoren.hexName(p.hex) : 'dem Sprungpunkt'}.`, null);
  game.missionEvent('einsprung', { n, x: p.x, y: p.y });
  return out;
}

// ---------- Signatur ----------
function schildeUnten(game) { const s = st(game); return !!(s && s.schildeUnten); }
function imAsteroidenfeld(game, abstand) {
  const L = game.ship;
  return space().brocken(game).some((a) => dist(L.x, L.y, a.x, a.y) - a.r < abstand);
}
function signatur(game) {
  const s = st(game); const K = C(game).signatur || {};
  if (!s || !s.schleich) return 1;
  const ship = game.ship;
  if (game.time < s.pingBis) return K.pingSig != null ? K.pingSig : 1;
  const sp = Math.hypot(ship.vx || 0, ship.vy || 0);
  const ruhe = K.ruhe != null ? K.ruhe : 0.15;
  let v = ruhe + (1 - ruhe) * Math.min(1, Math.pow(sp / (K.tempoRef || 130), K.exponent || 1));
  if (s.schildeUnten && !s.hochBis) v *= K.schildeUnten != null ? K.schildeUnten : 0.5;
  const A = K.asteroid || {};
  if (A.faktor != null && imAsteroidenfeld(game, A.abstand != null ? A.abstand : 110)) v *= A.faktor;
  const N = K.nebel || {};
  const loc = Locations.get(ship.scene);
  if (N.schalter && loc && loc.fog) v *= N.faktor != null ? N.faktor : 0.6;   // E4: Schalter, in der Kampagne aus
  return Math.max(K.min != null ? K.min : 0.04, Math.min(1, v));
}
function sensorRadius(game, e) {
  const s = st(game); const D = C(game).patrouille || {};
  let r = (e.sensor || D.sensor || 420) * (s ? s.sig : 1);
  if (s && s.stufe >= 1) r *= 1 + (D.misstrauenBonus || 0);
  if (s && s.wissen) r *= 1 + (D.wissenBonus || 0);
  return r;
}

// Schilde hoch/runter (Taktik, nur Schleichfahrt): runter = Signatur ×schildeUnten, Treffer gehen ohne Schildabzug durch;
// hoch = nach signatur.schildeHoch s wieder geschützt
function schildeSchalten(game, unten) {
  const s = st(game); const K = C(game).signatur || {};
  if (!s || !s.aktiv || !s.schleich) return 'Die Schilde lassen sich nur in einer Schleichfahrt herunterfahren.';
  if (unten) {
    if (s.schildeUnten && !s.hochBis) return null;
    s.schildeUnten = true; s.hochBis = 0;
    game.emit('sfx', { name: 'ui_click' });
    game.oda('Schilde runter – wir sind leiser, aber ungeschützt.', null);
  } else {
    if (!s.schildeUnten || s.hochBis) return null;
    s.hochBis = game.time + (K.schildeHoch != null ? K.schildeHoch : 3);
    game.emit('sfx', { name: 'ui_click' });
    game.oda('Schilde fahren hoch …', null);
  }
  game.missionEvent('schildeSchalter', { unten: !!unten });
  return null;
}
// Treffer auf die Lerche: mit heruntergefahrenen Schilden geht jeder Treffer an den Schilden vorbei (space.shipHit)
function trefferOpts(game, opts) {
  if (!schildeUnten(game)) return opts;
  return Object.assign({}, opts || {}, { pierce: true });
}

// ---------- Patrouillen ----------
// o: { kind, n, tag, x, y, x2, y2, sensor, tempo } – n Schiffe auf der Strecke (x,y)–(x2,y2); ohne x2/y2 stehen sie (Wache)
function patrouilleSetzen(game, o) {
  an(game, {});
  const D = C(game).patrouille || {};
  const out = [];
  const n = Math.max(1, Math.round(Number(o.n) || 1));
  const a = { x: Number(o.x), y: Number(o.y) };
  const b = o.x2 != null && o.y2 != null ? { x: Number(o.x2), y: Number(o.y2) } : { x: a.x, y: a.y };
  const len = dist(a.x, a.y, b.x, b.y);
  for (let i = 0; i < n; i++) {
    const s0 = n > 1 ? i / n : 0;
    const x = a.x + (b.x - a.x) * s0, y = a.y + (b.y - a.y) * s0;
    const ang = len > 1 ? Math.atan2(b.y - a.y, b.x - a.x) : 0;
    const e = space().spawnEnemy(game, o.kind || D.kind || 'raider', { x, y, facing: ang, tag: o.tag || 'patrouille' });
    e.pat = { a, b, s: s0, d: i % 2 ? -1 : 1, v: o.tempo != null ? Number(o.tempo) : (D.tempo || 55) };
    e.patrolle = true;
    if (o.sensor != null) e.sensor = Number(o.sensor);
    e.verdacht = 0;
    out.push(e);
  }
  return out;
}
// Bewegung einer Patrouille; true = patrouilliert noch (Aufrufer überspringt Flug und Feuer)
function patrouille(game, e, dt) {
  const p = e.pat;
  if (!p) return false;
  const len = dist(p.a.x, p.a.y, p.b.x, p.b.y);
  if (len < 1) { e.vx = 0; e.vy = 0; return true; }
  p.s += p.d * p.v * dt / len;
  if (p.s >= 1) { p.s = 1; p.d = -1; } else if (p.s <= 0) { p.s = 0; p.d = 1; }
  const nx = p.a.x + (p.b.x - p.a.x) * p.s, ny = p.a.y + (p.b.y - p.a.y) * p.s;
  const ang = Math.atan2((p.b.y - p.a.y) * p.d, (p.b.x - p.a.x) * p.d);
  e.angle = ang; e.vx = Math.cos(ang) * p.v; e.vy = Math.sin(ang) * p.v;
  e.x = nx; e.y = ny;
  return true;
}
// Sichtbar im Snapshot? Ohne Alarm in der Szene alles wie bisher. Patrouillen: nah, nach Weitscan, nach dem Alarm
function sichtbar(game, e) {
  const s = st(game);
  if (!s || !s.aktiv || !e.pat) return true;
  const D = C(game).patrouille || {};
  return game.time < (e.sichtBis || 0) || dist(e.x, e.y, game.ship.x, game.ship.y) <= (D.sichtNah != null ? D.sichtNah : 260);
}
function patrouillenSnap(game, e) {
  return e.pat && st(game) ? Math.round(sensorRadius(game, e)) : null;
}

// ---------- Minen ----------
// o: { n, x, y, radius, besitzer, ohneStrom, tag, positionen: [{x,y}] }
function minenSetzen(game, o) {
  an(game, {});
  const sp = game.space; const M = C(game).mine || {};
  const loc = Locations.get(game.ship.scene);
  const sc = loc ? loc.scene : { w: sp.w, h: sp.h };
  const tag = o.tag || 'minen';
  const rng = makeRng((game.seed ^ 0x3A11 ^ hashStr(game.ship.scene + tag + sp.minen.length)) >>> 0);
  const n = Math.max(1, Math.round(Number(o.n) || (o.positionen ? o.positionen.length : 1)));
  const out = [];
  const meiden = [sc.arrive, sc.station, sc.dock].filter(Boolean).map((k) => ({ x: k.x, y: k.y, r: (k.r || 0) + 260 }));
  let guard = 0;
  while (out.length < n && guard++ < 4000) {
    let x, y;
    if (o.positionen && o.positionen[out.length]) { x = Number(o.positionen[out.length].x); y = Number(o.positionen[out.length].y); }
    else {
      const R = Number(o.radius) > 0 ? Number(o.radius) : Math.min(sc.w, sc.h) * 0.4;
      const cx = o.x != null ? Number(o.x) : sc.w / 2, cy = o.y != null ? Number(o.y) : sc.h / 2;
      const a = rng.range(-Math.PI, Math.PI), d = R * Math.sqrt(rng());
      x = cx + Math.cos(a) * d; y = cy + Math.sin(a) * d;
    }
    x = Math.round(clamp(x, 80, sc.w - 80)); y = Math.round(clamp(y, 80, sc.h - 80));
    if (!o.positionen) {
      if (meiden.some((k) => dist(x, y, k.x, k.y) < k.r)) continue;
      if (sp.minen.concat(out).some((m) => dist(m.x, m.y, x, y) < (M.abstand != null ? M.abstand : 90))) continue;
      if (space().brocken(game).some((a2) => dist(x, y, a2.x, a2.y) < a2.r + 30)) continue;
    }
    const m = { id: game.nextId('m'), x, y, besitzer: o.besitzer === 'lerche' ? 'lerche' : 'gegner', ohneStrom: !!o.ohneStrom, gesehen: false, tag };
    sp.minen.push(m); out.push(m);
  }
  return out;
}
function mineById(game, id) { return id == null ? null : (game.space.minen || []).find((m) => m.id === id) || null; }
function mineAt(game, x, y) {
  const M = C(game).mine || {}; const rad = M.treffer != null ? M.treffer : 22;
  return (game.space.minen || []).find((m) => dist(m.x, m.y, x, y) < rad) || null;
}
// Strahl (Lanze): erste Mine nahe der Linie ab (ox, oy) in Richtung (dx, dy) innerhalb range -> { m, t } | null
function mineImStrahl(game, ox, oy, dx, dy, range) {
  const M = C(game).mine || {}; const rad = M.treffer != null ? M.treffer : 22;
  let best = null;
  for (const m of game.space.minen || []) {
    const rx = m.x - ox, ry = m.y - oy;
    const t = rx * dx + ry * dy;
    if (t < 0 || t > range) continue;
    if (Math.abs(-rx * dy + ry * dx) >= rad) continue;
    if (!best || t < best.t) best = { m, t };
  }
  return best;
}
function mineSichtbar(game, m) {
  const M = C(game).mine || {};
  return m.gesehen || dist(m.x, m.y, game.ship.x, game.ship.y) <= (M.sicht != null ? M.sicht : 180);
}
function minenSnap(game) {
  const out = [];
  for (const m of game.space.minen || []) {
    if (!mineSichtbar(game, m)) continue;
    const o = { id: m.id, x: m.x, y: m.y };
    if (m.ohneStrom) o.s = 0;
    out.push(o);
  }
  return out.length ? out : null;
}
// Systemschaden: punkte Schritte, je Schritt ein zufälliges nicht zerstörtes System eine Stufe tiefer (ok → beschädigt = 1,
// beschädigt → zerstört = 1, zusammen 2). -> [{ system, state }] (Endzustand je betroffenem System)
function systemSchaden(game, punkte) {
  const ship = game.ship; const res = {};
  for (let i = 0; i < punkte; i++) {
    const cand = interior.SYSTEM_ORDER.filter((k) => ship.systems[k] != null && ship.systems[k] !== 'broken' && ship.systems[k] !== 'offline');
    if (!cand.length) break;
    const k = game.rng.pick(cand);
    const to = ship.systems[k] === 'ok' ? 'damaged' : 'broken';
    interior.damageSystem(game, k, to, { quiet: true });
    res[k] = ship.systems[k];
  }
  return Object.keys(res).map((k) => ({ system: k, state: res[k] }));
}
function minenTreffer(game, m) {
  const M = C(game).mine || {};
  const list = systemSchaden(game, M.punkte != null ? M.punkte : 6);
  const sector = Physics.sectorOf(game.ship.x, game.ship.y, game.ship.angle, m.x, m.y);
  game.emit('hit', { sector, shield: false, dmg: 3, heavy: true, mine: true });
  game.emit('sfx', { name: 'hull_hit' });
  const lab = (k) => (interior.SYS_LABEL && interior.SYS_LABEL[k]) || k;
  const zerst = list.filter((x) => x.state === 'broken').map((x) => lab(x.system));
  const besch = list.filter((x) => x.state !== 'broken').map((x) => lab(x.system));
  game.oda(`Minentreffer! Die Schilde haben nichts gebremst.${zerst.length ? ' Zerstört: ' + zerst.join(', ') + '.' : ''}${besch.length ? ' Beschädigt: ' + besch.join(', ') + '.' : ''}`, null);
  return list;
}
// Explosion: Lerche im Sprengradius -> Systemschaden (ignoriert Schilde); Schiffe im Radius -> Schaden ohne Schilde; löst Alarm aus
function explodiere(game, m, grund) {
  const sp = game.space; const M = C(game).mine || {};
  sp.minen = sp.minen.filter((q) => q !== m);
  const R = M.spreng != null ? M.spreng : 160;
  game.emit('explosion', { x: Math.round(m.x), y: Math.round(m.y), zone: 'space' });
  game.emit('sfx', { name: 'explosion_big' });
  let getroffen = false; let liste = [];
  if (dist(m.x, m.y, game.ship.x, game.ship.y) <= R && !game.ship.docked) { liste = minenTreffer(game, m); getroffen = true; }
  for (const e of sp.enemies.slice()) {
    if (dist(m.x, m.y, e.x, e.y) <= R) space().damageEnemy(game, e, M.gegner != null ? M.gegner : 20, m.x, m.y, { pierce: 99 });
  }
  if (game.ship.target === m.id) game.ship.target = null;
  ausloeser(game, 'mine');
  game.missionEvent(grund === 'abschuss' ? 'mineAbgeschossen' : 'mineGezuendet', { id: m.id, getroffen, systeme: liste.length });
  game.missionEvent('mineExploded', { id: m.id, grund, getroffen });
  return { getroffen, systeme: liste };
}
// Abschuss (Strahl, Geschoss, Salve): Explosion auf Distanz, macht trotzdem Alarm. Stromlose Mine = Blindgänger
function abschuss(game, m) {
  if (m.ohneStrom) {
    game.space.minen = game.space.minen.filter((q) => q !== m);
    if (game.ship.target === m.id) game.ship.target = null;
    game.oda('Stromlose Mine getroffen – ein Blindgänger, es passiert nichts.', null);
    game.missionEvent('mineAbgeschossen', { id: m.id, blind: true });
    return { blind: true };
  }
  return explodiere(game, m, 'abschuss');
}
function minenUpdate(game) {
  const sp = game.space; const M = C(game).mine || {}; const L = game.ship;
  if (!sp.minen || !sp.minen.length) return;
  const zuend = M.zuend != null ? M.zuend : 70;
  for (const m of sp.minen.slice()) {
    if (m.ohneStrom) continue;
    if (m.besitzer !== 'lerche' && !L.docked && dist(m.x, m.y, L.x, L.y) <= zuend) { explodiere(game, m, 'zuendung'); continue; }
    // Schiffe zünden Minen der Lerche (nicht ihre eigenen: m.besitzer 'gegner' zündet nicht bei Gegnern)
    if (m.besitzer === 'lerche' && sp.enemies.some((e) => dist(m.x, m.y, e.x, e.y) <= zuend)) explodiere(game, m, 'zuendung');
  }
}

// ---------- Weitscan ----------
// Minen im Radius werden sichtbar (für den Rest der Szene), Patrouillen im Radius pingSicht s lang; die Lerche ist pingDauer s
// lang mit voller Signatur zu sehen. -> Anzahl neuer Funde (Minen + sichtbare Patrouillen)
function onWidescan(game, radius) {
  const L = game.ship; const s = st(game); const K = C(game).signatur || {}; const D = C(game).patrouille || {};
  let minen = 0, pat = 0;
  for (const m of game.space.minen || []) if (!m.gesehen && dist(m.x, m.y, L.x, L.y) <= radius) { m.gesehen = true; minen++; }
  for (const e of game.space.enemies) if (e.pat && dist(e.x, e.y, L.x, L.y) <= radius) { e.sichtBis = game.time + (D.pingSicht != null ? D.pingSicht : 8); pat++; }
  if (s && s.aktiv && s.schleich) {
    s.pingBis = game.time + (K.pingDauer != null ? K.pingDauer : 4);
    if (pat) game.oda('Weitscan: Patrouillen erfasst – aber auch wir sind für einen Moment zu sehen!', null);
  }
  if (minen) game.oda(`Weitscan: ${minen} Mine${minen > 1 ? 'n' : ''} im Umkreis. Auf der Taktikkarte markiert.`, null);
  return minen + pat;
}

// ---------- Tick ----------
function update(game, dt) {
  const sp = game.space; const s = sp.alarm;
  if (s && s.aktiv) {
    const L = C(game).laerm || {}; const D = C(game).patrouille || {}; const ship = game.ship;
    s.sig = signatur(game);
    // Lärm klingt ab; ohne Lärm (und ohne Vorwissen) beruhigt sich die Szene wieder
    if (s.stufe < 2) {
      if (s.stufe === 1 && laermPunkte(game, s) <= 0 && !s.wissen) { s.stufe = 0; s.grund = null; game.oda('Der Funkverkehr der Gegner beruhigt sich.', null); game.missionEvent('raumAlarm', { stufe: 0, grund: 'beruhigt' }); }
      // Antrieb auf Energie 4 ist laut
      if (!ship.docked && ship.power && ship.power.engines >= (L.antriebEnergie || 4)) {
        s.antriebT += dt;
        if (s.antriebT >= (L.antriebTakt || 4)) { s.antriebT = 0; laerm(game, 'antrieb'); }
      } else s.antriebT = 0;
    }
    // Schilde hochfahren
    if (s.schildeUnten && s.hochBis && game.time >= s.hochBis) { s.schildeUnten = false; s.hochBis = 0; game.oda('Schilde oben.', null); game.emit('sfx', { name: 'ui_click' }); }
    // Entdeckung durch Patrouillen
    for (const e of sp.enemies) {
      if (!e.pat) continue;
      const r = sensorRadius(game, e);
      if (dist(e.x, e.y, ship.x, ship.y) <= r && !ship.docked) {
        if (!(e.verdacht > 0) && game.time - (e.verdachtMeldeT || -99) > 12) { e.verdachtMeldeT = game.time; game.oda('Eine Patrouille streift uns mit dem Sensor – Tempo raus, Schilde runter, Deckung suchen!', null); }
        e.verdacht = (e.verdacht || 0) + dt;
        if (e.verdacht >= (D.zeit != null ? D.zeit : 1.2)) { game.missionEvent('entdeckt', { enemy: e }); ausloeser(game, 'entdeckt'); break; }
      } else if (e.verdacht > 0) e.verdacht = Math.max(0, e.verdacht - dt * 0.5);
    }
    // Einsprung
    if (s.einsprungAt != null && game.time >= s.einsprungAt) einspringen(game);
  }
  minenUpdate(game);
}

// Konsolenanzeige der Schleichfahrt (Snapshot ship.sf): sig 0..100, d = Schilde unten (1), h = Sekunden bis oben, p = Sekunden Ping
function schleichSnap(game) {
  const s = st(game);
  if (!s || !s.aktiv || !s.schleich) return null;
  const o = { sig: Math.round(s.sig * 100) };
  if (s.schildeUnten) o.d = 1;
  if (s.hochBis) o.h = Math.max(0, Math.ceil(s.hochBis - game.time));
  if (game.time < s.pingBis) o.p = Math.ceil(s.pingBis - game.time);
  if (s.ziel) o.z = [s.ziel.x, s.ziel.y, s.ziel.r];
  return o;
}

// Zielkreis der Schleichfahrt
function zielSetzen(game, x, y, r) {
  const s = ensure(game);
  s.ziel = { x: Math.round(x), y: Math.round(y), r: Math.round(r) };
}
function amZiel(game, x, y, r) {
  return dist(game.ship.x, game.ship.y, x, y) <= r;
}

// Schleichfahrt in einem Zug einrichten (Katalog-Umsetzung): Alarm mit Signatur, Patrouillen in Bändern zwischen Ankunft und Ziel,
// Minen im Korridor. Eigener Zufall (Seed, Ort), game.rng bleibt unberührt. o: { ziel_x, ziel_y, ziel_r, patrouillen, minen, ohne_strom,
// wissen, einsprung, jaeger, kind }
function schleichfahrtEinrichten(game, o) {
  const loc = Locations.get(game.ship.scene);
  const sc = loc.scene; const D = C(game).patrouille || {};
  an(game, { wissen: o.wissen, einsprung: o.einsprung, jaeger: o.jaeger, schleichfahrt: true });
  const ziel = { x: Number(o.ziel_x), y: Number(o.ziel_y), r: Number(o.ziel_r) || 150 };
  zielSetzen(game, ziel.x, ziel.y, ziel.r);
  const von = sc.arrive || { x: 150, y: sc.h / 2 };
  const ang = Math.atan2(ziel.y - von.y, ziel.x - von.x);
  const px = -Math.sin(ang), py = Math.cos(ang);
  const len = dist(von.x, von.y, ziel.x, ziel.y);
  const n = Math.max(0, Math.round(Number(o.patrouillen) || 0));
  const out = { patrouillen: [], minen: [] };
  const halb = Math.min(Math.min(sc.w, sc.h) * 0.22, 420);
  for (let i = 0; i < n; i++) {
    const f = 0.2 + 0.6 * ((i + 0.5) / n);
    const cx = von.x + Math.cos(ang) * len * f, cy = von.y + Math.sin(ang) * len * f;
    const a = { x: clamp(cx + px * halb, 100, sc.w - 100), y: clamp(cy + py * halb, 100, sc.h - 100) };
    const b = { x: clamp(cx - px * halb, 100, sc.w - 100), y: clamp(cy - py * halb, 100, sc.h - 100) };
    out.patrouillen.push(...patrouilleSetzen(game, { kind: o.kind || D.kind, n: 1, tag: 'patrouille', x: a.x, y: a.y, x2: b.x, y2: b.y }));
  }
  const m = Math.max(0, Math.round(Number(o.minen) || 0));
  if (m) {
    const korridor = halb * 0.9;
    const mx = von.x + Math.cos(ang) * len * 0.5, my = von.y + Math.sin(ang) * len * 0.5;
    out.minen = minenSetzen(game, { n: m, x: mx, y: my, radius: Math.max(korridor, len * 0.42), besitzer: 'gegner', ohneStrom: !!o.ohne_strom, tag: 'schleich' });
  }
  space().setMarker(game, 'captain', ziel.x, ziel.y, false);
  return out;
}

module.exports = {
  STUFEN, szeneBetreten, ensure, an, aktiv, stufe, stufeName, setzeStufe, ausloeser, laerm, angriff, freigeben,
  sprungpunkte, naechsterSprungpunkt, einspringen,
  signatur, sensorRadius, schildeSchalten, schildeUnten, trefferOpts,
  patrouilleSetzen, patrouille, sichtbar, patrouillenSnap,
  minenSetzen, mineById, mineAt, mineImStrahl, mineSichtbar, minenSnap, explodiere, abschuss, systemSchaden,
  onWidescan, update, schleichSnap, zielSetzen, amZiel, schleichfahrtEinrichten,
};
