'use strict';
// B2 „Bodenkampf“ – Waffen-Modul (CONTRACT-B2 §2/§3; Team WAFFEN). Dieselben Regeln für Spieler und Gegner.
// Reine Funktionen auf „Kämpfern“ (§3.1). Alle Zahlen kommen bei jedem Aufruf frisch aus CONFIG.awayCombat (per `tune`).
// Aktiv standardmäßig (Welle 2, Einbau in combat.js durch BODENKAMPF); `WAFFEN=aus` schaltet ab (altes Verhalten).
//
// Kämpfer (BODENKAMPF legt die Felder an, `ausstatten` füllt sie):
//   { id, team: 'crew'|'feind', x, y, crouch, facing?, frontArc?, hitRadius?,
//     waffe, hitze 0..1, gesperrtBis, ladung { t, stufe, x, y, tx, ty } | null, ausholen { t, dauer, winkel } | null,
//     schild { seg, max, lastHitAt, regenT }, wunden { n, max },
//     zustand 'ok'|'verwundet'|'bewusstlos'|'gefesselt'|'gefangen'|'aus', betaeubtBis, bewusstBis }
//   Zusätzlich (intern, von waffen.js gepflegt): schussAt (letzter Schuss, für `pause`), bereitAt (Kadenz/Erholung),
//   ausblutenBis (nur Gegner, liegend).
//
// Welt-Adapter (BODENKAMPF setzt ihn beim Einbau; Tests setzen ihn selbst):
//   game.waffenWelt = { kaempfer() -> [Kämpfer beider Teams], wand(x0,y0,x1,y1) -> true wenn eine Wand die Linie sperrt }
//   Fehlt er, gibt es keine Ziele für Schlag, Strahl und Fläche und keine Wände.
//   Optional getroffen(ziel, ergebnis, wirkung, quelle): Rückmeldung nach jedem Treffer, den waffen.js selbst verteilt
//   (Fläche, Lanzenstrahl, Schlag) – BODENKAMPF sendet dieselben Treffer-Ereignisse wie bei Projektilen (B2-NACH).
// Projektile (Blaster, Sturmgewehr, Betäuber, Wächter, Granate) landen in game.away.projectiles; der Flug bleibt in
// combat.js. Auf einen Projektiltreffer ruft combat.js `treffer(game, ziel, q.wirkung, { id: q.owner, team: q.seite, x: q.sx, y: q.sy })`,
// Granaten treibt `granateFlug(game, q, dt)` (true = gelandet, Wirkung ausgeführt, Projektil entfernen).
const crypto = require('crypto');
const Physics = require('../../shared/physics.js');

const TILE = Physics.TILE;
const EPS = 1e-6;
// Waffen, die ein Spieler am Transporter wählen kann (faust ist nur die Ersatzwaffe in der Zelle und wird nie gespeichert)
const WAHL = ['blaster', 'sturmgewehr', 'granatwerfer', 'lanze', 'nahkampf', 'betaeuber'];
const ZUSTAENDE = ['ok', 'verwundet', 'bewusstlos', 'gefesselt', 'gefangen', 'aus'];

// ---------- Hilfen ----------
function ac(game) { return game.C.awayCombat; }
function now(game) { return Number(game.time) || 0; }
function emit(game, name, data) { if (typeof game.emit === 'function') game.emit(name, data); }
function rng(game) { return (game.away && typeof game.away.rng === 'function') ? game.away.rng : Math.random; }
function welt(game) { return game.waffenWelt || null; }
function alleKaempfer(game) { const w = welt(game); return (w && typeof w.kaempfer === 'function' && w.kaempfer()) || []; }
function wand(game, x0, y0, x1, y1) { const w = welt(game); return !!(w && typeof w.wand === 'function' && w.wand(x0, y0, x1, y1)); }
const rund = (v) => Math.round(v * 1000) / 1000;
const r = Math.round;
function normAngle(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay; const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(ax + dx * t - px, ay + dy * t - py);
}
function hitR(k) { return Number(k.hitRadius) || 12; }
// ziel: { x, y } (Punkt/Kämpfer) | { angle, dist? } (dist = Zielabstand in Kacheln, z. B. Mauszeiger; ohne: volle Reichweite)
function zielPunkt(k, ziel, reichweitePx) {
  if (ziel && Number.isFinite(ziel.x) && Number.isFinite(ziel.y)) return { x: ziel.x, y: ziel.y };
  const a = ziel && Number.isFinite(ziel.angle) ? ziel.angle : (Number.isFinite(k.facing) ? k.facing : 0);
  const l = ziel && Number.isFinite(ziel.dist) && ziel.dist >= 0 ? Math.max(1, Math.min(ziel.dist * TILE, reichweitePx)) : reichweitePx;   // ≥ 1 px: Richtung bleibt
  return { x: k.x + Math.cos(a) * l, y: k.y + Math.sin(a) * l };
}
// Treffer, den waffen.js selbst verteilt (Fläche, Strahl, Schlag): Regeln wie treffer, danach Rückmeldung an die Welt
function wirken(game, ziel, w, q) {
  const e = treffer(game, ziel, w, q);
  const W = welt(game);
  if (W && typeof W.getroffen === 'function') W.getroffen(ziel, e, w, q);
  return e;
}

// ---------- Definitionen ----------
// Waffendefinition aus CONFIG.awayCombat.waffen.<waffe>. 'waechter' (Wächterschuss) ist der Blaster mit
// gegner.waechter.schussSeg Segmenten, ohne Streuung, mit dem Geschosstempo des heutigen Wächters.
function def(game, waffe) {
  const C = ac(game); const W = C.waffen || {};
  if (W[waffe]) return W[waffe];
  if (waffe === 'waechter' && W.blaster) {
    const g = (C.gegner && C.gegner.waechter) || {};
    const alt = (C.enemy && C.enemy.warden) || {};
    return Object.assign({}, W.blaster, { schaden: g.schussSeg || alt.shotSegments || 2, tempo: alt.shotSpeed || W.blaster.tempo, streuung: 0, waechter: true });
  }
  return null;
}
function art(d) {
  if (!d) return null;
  if (d.flaeche) return 'granate';
  if (Array.isArray(d.laden)) return 'lanze';
  if (d.ausholen != null) return 'schlag';
  return 'geschoss';
}
// Ausholdauer: Was den Schild umgeht (Nahkampf: wunde) oder mehr als 1 Segment nimmt, wird ≥ koerper.ankuendigung
// vorher angekündigt (Ankündigungsregel B2 §0.13), auch wenn `ausholen` per tune kürzer gestellt wird.
function ausholDauer(game, d) {
  const a = Number(d.ausholen) || 0;
  const mehr = d.wunde || (Number(d.schaden) || 1) > 1;
  return mehr ? Math.max(a, Number(ac(game).koerper.ankuendigung) || 0) : a;
}
function streuungGrad(d, hitze) {
  const s = d.streuung;
  if (Array.isArray(s)) return s[0] + (s[1] - s[0]) * Math.max(0, Math.min(1, hitze || 0));
  return Number(s) || 0;
}

// Kämpfer-Felder für eine Rolle (gegner.<rolle>) oder 'spieler' setzen. Rückgabe: k.
function ausstatten(game, k, rolle) {
  const C = ac(game);
  if (rolle === 'spieler') {
    const n = C.shield.segments;
    k.team = k.team || 'crew';
    k.waffe = k.waffe || 'blaster';
    k.schild = k.schild || { seg: n, max: n, lastHitAt: -99, regenT: 0 };
    k.wunden = { n: 1, max: 1 };
    k.hitRadius = k.hitRadius || (C.hitRadius && C.hitRadius.player) || 12;
  } else {
    const g = C.gegner[rolle];
    if (!g) throw new Error('waffen.ausstatten: unbekannte Rolle ' + rolle);
    k.team = k.team || 'feind';
    k.rolle = rolle;
    k.waffe = g.waffe;
    k.schild = { seg: g.seg, max: g.seg, lastHitAt: -99, regenT: 0 };
    k.wunden = { n: g.wunden, max: g.wunden };
    k.hitRadius = g.hitRadius;
    if (g.frontArc) { k.frontArc = g.frontArc; if (!Number.isFinite(k.facing)) k.facing = 0; }
  }
  k.hitze = 0; k.gesperrtBis = 0; k.ladung = null; k.ausholen = null;
  k.zustand = 'ok'; k.betaeubtBis = 0; k.bewusstBis = 0; k.schussAt = -99; k.bereitAt = 0;
  return k;
}

// ---------- Zustand ----------
function betaeubt(game, k) { return now(game) < (k.betaeubtBis || 0); }
function ueberhitzt(game, k) { return now(game) < (k.gesperrtBis || 0); }
// Darf sich bewegen und handeln (nicht liegend/bewusstlos/gefesselt, nicht betäubt)
function handlungsfaehig(game, k) { return (k.zustand || 'ok') === 'ok' && !betaeubt(game, k); }

function kannFeuern(game, k) {
  const d = def(game, k.waffe);
  if (!d) return 'waffe';
  if ((k.zustand || 'ok') !== 'ok') return 'zustand';
  if (betaeubt(game, k)) return 'betaeubt';
  if (ueberhitzt(game, k)) return 'ueberhitzt';
  if (k.ausholen) return 'ausholen';
  if (now(game) < (k.bereitAt || 0) - EPS) return 'kadenz';
  return null;
}

// Hitze nach einem Schuss/Schlag; bei 1 überhitzt (gesperrt für `sperre` s, danach 0)
function heizen(game, k, d, anteil) {
  const t = now(game);
  k.hitze = Math.min(1, (k.hitze || 0) + (anteil == null ? 1 : anteil) / Math.max(EPS, Number(d.schuss) || 1));
  k.schussAt = t;
  if (k.hitze >= 1 - EPS) {
    k.hitze = 1; k.gesperrtBis = t + (Number(d.sperre) || 0);
    emit(game, 'ueberhitzt', { id: k.id });
    return true;
  }
  return false;
}

// ---------- Lärm (B2 §2, §6) ----------
// Erzeugt ein Lärmereignis am Ort (Kacheln laut laerm[stufe]). BODENKAMPF liest game.away.laerm (älteste zuerst) und
// alarmiert Trupps im Radius (`hoert`). Rückgabe: das Ereignis.
function laerm(game, x, y, stufe) {
  const L = ac(game).laerm || {};
  const kacheln = Number(L[stufe]) || 0;
  const ev = { x: r(x), y: r(y), stufe, kacheln, radius: kacheln * TILE, t: now(game) };
  if (game.away) {
    if (!Array.isArray(game.away.laerm)) game.away.laerm = [];
    game.away.laerm.push(ev);
    if (game.away.laerm.length > 32) game.away.laerm.splice(0, game.away.laerm.length - 32);
  }
  return ev;
}
function hoert(ev, x, y) { return !!ev && Math.hypot(x - ev.x, y - ev.y) <= ev.radius + EPS; }

// ---------- Sicht und Reichweite (B2 §2 „Sicht“, E16) ----------
// opts: { sichtlinie: bool, aussicht: bool (Schütze steht am `aussicht`-Anker), geteilt: bool (Captain-Markierung bzw.
// Trupp-Funk) }. Rückgabe null (darf zielen) oder Grund: 'reichweite' | 'zu_nah' | 'keine_sicht' | 'zu_weit'.
function sichtPruefen(game, k, ziel, opts) {
  const o = opts || {}; const C = ac(game);
  const d = def(game, k.waffe) || {};
  const kach = Math.hypot(ziel.x - k.x, ziel.y - k.y) / TILE;
  const maxW = Number(d.max != null ? d.max : d.reichweite) || 0;
  if (kach > maxW + EPS) return 'reichweite';
  if (d.min != null && kach < Number(d.min) - EPS) return 'zu_nah';
  const normal = Number(C.sightTiles) || 10;
  if (o.geteilt) return null;
  if (kach <= normal + EPS) return o.sichtlinie ? null : 'keine_sicht';
  if (o.aussicht && o.sichtlinie && kach <= (Number(C.sicht && C.sicht.aussicht) || normal) + EPS) return null;
  return o.aussicht && !o.sichtlinie ? 'keine_sicht' : 'zu_weit';
}
// Ablauf einer geteilten Sicht (Captain-Markierung) ab jetzt
function geteiltBis(game) { return now(game) + (Number(ac(game).sicht && ac(game).sicht.geteiltTtl) || 0); }

// ---------- Feuern ----------
// ziel: { angle } | { x, y } (auch ein Kämpfer). Rückgabe null (ausgeführt bzw. begonnen) oder Grund (kannFeuern).
// Geschoss: Projektil in game.away.projectiles. Lanze: beginnt das Laden (erneuter Aufruf = Ziel nachführen),
// Schuss mit `loslassen`. Nahkampf/Faust: beginnt das Ausholen, der Schlag folgt in `update`. Granate: Bogen zum Ziel.
function feuern(game, k, ziel) {
  const d = def(game, k.waffe);
  if (k.ladung && d && art(d) === 'lanze') {
    if ((k.zustand || 'ok') !== 'ok' || betaeubt(game, k)) return 'zustand';
    const p = zielPunkt(k, ziel, (Number(d.reichweite) || 0) * TILE);
    k.ladung.tx = p.x; k.ladung.ty = p.y;
    return null;
  }
  const grund = kannFeuern(game, k);
  if (grund) return grund;
  const a = art(d);
  if (a === 'lanze') return ladenBeginnen(game, k, d, ziel);
  if (a === 'schlag') return ausholenBeginnen(game, k, d, ziel);
  if (a === 'granate') return granateWerfen(game, k, d, ziel);
  return geschoss(game, k, d, ziel);
}

function projektil(game, o) {
  const t = Physics.toTile(o.x, o.y);
  const id = typeof game.nextId === 'function' ? game.nextId('ap') : 'ap' + Math.floor(rng(game)() * 1e9);
  const q = Object.assign({ id, stx: t.x, sty: t.y, sx: o.x, sy: o.y, checked: [] }, o);
  if (game.away) { if (!Array.isArray(game.away.projectiles)) game.away.projectiles = []; game.away.projectiles.push(q); }
  return q;
}
function wirkungAus(waffe, d, extra) {
  return Object.assign({ waffe, schaden: Number(d.schaden) || 1, schildReset: !!d.schildReset, nichttoedlich: !!d.nichttoedlich,
    wunde: !!d.wunde, flaeche: !!d.flaeche, durchschlagFront: !!d.durchschlagFront }, extra || {});
}

function geschoss(game, k, d, ziel) {
  const t = now(game);
  const p = zielPunkt(k, ziel, (Number(d.reichweite) || 0) * TILE);
  const s = streuungGrad(d, k.hitze) * Math.PI / 180;
  const angle = Math.atan2(p.y - k.y, p.x - k.x) + s * (rng(game)() * 2 - 1);
  const tempo = Number(d.tempo) || 380;
  const q = projektil(game, { kind: k.waffe, waffe: k.waffe, x: k.x, y: k.y, angle, speed: tempo,
    ttl: (Number(d.reichweite) || 13) * TILE / tempo, dmg: Number(d.schaden) || 1, owner: k.id,
    team: k.team === 'crew' ? 'player' : 'enemy', seite: k.team, crouch: !!k.crouch, wirkung: wirkungAus(k.waffe, d) });
  k.bereitAt = t + (Number(d.kadenz) || 0);
  heizen(game, k, d);
  laerm(game, k.x, k.y, d.laerm);
  return q ? null : 'projektil';
}

function granateWerfen(game, k, d, ziel) {
  const t = now(game);
  const p = zielPunkt(k, ziel, (Number(d.max) || 0) * TILE);
  // Landepunkt = Zielabstand, begrenzt auf [min, max] – gleich für Spieler (Mauszeiger, shoot.dist) und Gegner (Abstand
  // zum Ziel; die KI zielt ohnehin erst ab min, siehe sichtPruefen). Nur Winkel ohne Abstand: volle Weite (wie bisher).
  let dx = p.x - k.x, dy = p.y - k.y; let kach = Math.hypot(dx, dy) / TILE;
  const lo = Number(d.min) || 0, hi = Number(d.max) || 0;
  if (kach < EPS) { const a = Number.isFinite(k.facing) ? k.facing : 0; dx = Math.cos(a) * TILE; dy = Math.sin(a) * TILE; kach = 1; }
  const soll = Math.max(lo, Math.min(hi, kach));
  if (Math.abs(soll - kach) > EPS) { const f = soll / kach; dx *= f; dy *= f; kach = soll; }
  const R = rng(game); const st = (Number(d.streuung) || 0) * TILE;
  const tx = k.x + dx + st * (R() * 2 - 1), ty = k.y + dy + st * (R() * 2 - 1);
  const flug = Number(d.flug) || 0.8;
  projektil(game, { kind: 'granate', waffe: k.waffe, x: k.x, y: k.y, tx, ty, flug, t: 0, angle: Math.atan2(dy, dx), speed: 0,
    ttl: flug + 1, dmg: Number(d.schaden) || 1, owner: k.id, team: k.team === 'crew' ? 'player' : 'enemy', seite: k.team,
    wirkung: wirkungAus(k.waffe, d, { betaeubt: Number(d.betaeubt) || 0, radius: Number(d.radius) || 1 }) });
  k.bereitAt = t + (Number(d.kadenz) || 0);
  heizen(game, k, d);
  emit(game, 'granate', { id: k.id, x: r(k.x), y: r(k.y), tx: r(tx), ty: r(ty), flug });
  laerm(game, k.x, k.y, d.laerm);
  return null;
}
// Granate im Flug: kein Treffer unterwegs, Wirkung am Ziel. true = gelandet (combat.js entfernt das Projektil).
function granateFlug(game, q, dt) {
  q.t = (q.t || 0) + dt;
  if (q.t < q.flug - EPS) return false;
  if (q.gelandet) return true;
  q.gelandet = true;
  explosion(game, q.tx, q.ty, q.wirkung, { id: q.owner, team: q.seite, x: q.tx, y: q.ty });
  return true;
}
// Flächenwirkung: trifft **jeden** Kämpfer im Radius (beide Teams), fliegt über Deckung; nur Wände sperren.
// Rückgabe [{ id, ergebnis }].
function explosion(game, x, y, wirkung, quelle) {
  const w = Object.assign({ schaden: 1, flaeche: true }, wirkung || {});
  const rad = (Number(w.radius) || 1) * TILE;
  emit(game, 'granateEinschlag', { x: r(x), y: r(y), radius: Number(w.radius) || 1 });
  const d = w.waffe ? def(game, w.waffe) : null;
  laerm(game, x, y, (d && d.laerm) || 'laut');
  const out = [];
  for (const k of alleKaempfer(game)) {
    if (Math.hypot(k.x - x, k.y - y) > rad + EPS) continue;
    if (wand(game, x, y, k.x, k.y)) continue;
    out.push({ id: k.id, ergebnis: wirken(game, k, w, Object.assign({ x, y }, quelle || {}, { x, y })) });
  }
  return out;
}

// ---------- Lanze ----------
function ladenBeginnen(game, k, d, ziel) {
  const p = zielPunkt(k, ziel, (Number(d.reichweite) || 0) * TILE);
  k.ladung = { t: 0, stufe: 0, x: k.x, y: k.y, tx: p.x, ty: p.y };
  emit(game, 'ladungLanze', { id: k.id, x: r(k.x), y: r(k.y), tx: r(p.x), ty: r(p.y) });
  return null;
}
// Lanze abfeuern (Spieler lässt los, KI bei gewünschter Stufe). Unter Stufe 1: Abbruch ohne Schuss.
// Strahl sofort, trifft den ersten Kämpfer der Gegenseite auf der Linie (Wand stoppt). Rückgabe null | Grund.
function loslassen(game, k) {
  const d = def(game, k.waffe); const L = k.ladung;
  if (!L || art(d) !== 'lanze') return 'keine_ladung';
  k.ladung = null;
  if (!L.stufe) return 'zu_kurz';
  const max = (Number(d.reichweite) || 0) * TILE;
  let dx = L.tx - k.x, dy = L.ty - k.y; const len = Math.hypot(dx, dy) || 1;
  dx = dx / len * max; dy = dy / len * max;
  const ex = k.x + dx, ey = k.y + dy;
  const kand = alleKaempfer(game)
    .filter((z) => z !== k && z.team !== k.team && (z.zustand || 'ok') === 'ok' && segDist(z.x, z.y, k.x, k.y, ex, ey) < hitR(z))
    .map((z) => ({ z, s: (z.x - k.x) * dx + (z.y - k.y) * dy }))
    .filter((o) => o.s > 0)
    .sort((a, b) => a.s - b.s);
  const schaden = Array.isArray(d.schaden) ? d.schaden[Math.min(L.stufe, d.schaden.length) - 1] : (Number(d.schaden) || 1);
  let tx = ex, ty = ey; let getroffen = null;
  for (const o of kand) {
    if (wand(game, k.x, k.y, o.z.x, o.z.y)) break;
    getroffen = o.z; tx = o.z.x; ty = o.z.y; break;
  }
  emit(game, 'lanzeSchuss', { id: k.id, x: r(k.x), y: r(k.y), tx: r(tx), ty: r(ty), stufe: L.stufe });
  heizen(game, k, d, L.stufe / d.laden.length);
  laerm(game, k.x, k.y, d.laerm);
  if (getroffen) wirken(game, getroffen, wirkungAus(k.waffe, d, { schaden }), { id: k.id, team: k.team, x: k.x, y: k.y });
  return null;
}

// ---------- Nahkampf, Faust ----------
function ausholenBeginnen(game, k, d, ziel) {
  const p = zielPunkt(k, ziel, (Number(d.reichweite) || 1) * TILE);
  k.ausholen = { t: 0, dauer: ausholDauer(game, d), winkel: Math.atan2(p.y - k.y, p.x - k.x) };
  emit(game, 'ausholen', { id: k.id, winkel: Math.round(k.ausholen.winkel * 100) / 100 });
  return null;
}
// Schlag im 90°-Bogen bis `reichweite` (+ Trefferradius des Ziels); nur die Gegenseite (direkt = kein Friendly Fire)
function schlag(game, k, d) {
  const A = k.ausholen; k.ausholen = null;
  const t = now(game);
  const reich = (Number(d.reichweite) || 1) * TILE;
  emit(game, 'schlag', { id: k.id, x: r(k.x), y: r(k.y), winkel: Math.round(A.winkel * 100) / 100 });
  laerm(game, k.x, k.y, d.laerm);
  heizen(game, k, d);
  k.bereitAt = t + (Number(d.erholung) || 0);
  // „Atem“: Erholung gehört zum Schlag, die Kühlpause beginnt erst danach (sonst überhitzt Dauerschlagen nie)
  if (!ueberhitzt(game, k)) k.schussAt = k.bereitAt;
  const out = [];
  for (const z of alleKaempfer(game)) {
    if (z === k || z.team === k.team) continue;
    const dist = Math.hypot(z.x - k.x, z.y - k.y);
    if (dist > reich + hitR(z)) continue;
    if (dist > EPS && Math.abs(normAngle(Math.atan2(z.y - k.y, z.x - k.x) - A.winkel)) > Math.PI / 4 + EPS) continue;
    out.push({ id: z.id, ergebnis: wirken(game, z, wirkungAus(k.waffe, d, { nahkampf: true }), { id: k.id, team: k.team, x: k.x, y: k.y }) });
  }
  return out;
}

// ---------- Unterbrechen (E13) ----------
// Bricht Laden und Ausholen ab. Rückgabe true, wenn etwas abgebrochen wurde. grund: 'treffer'|'bewegt'|'betaeubt'|…
function unterbrechen(game, k, grund) {
  const war = !!(k.ladung || k.ausholen);
  k.ladung = null; k.ausholen = null;
  if (war) k.unterbrochen = { grund: grund || 'treffer', t: now(game) };
  return war;
}

// ---------- Treffer (für alle) ----------
// wirkung: { waffe, schaden, flaeche?, wunde? (Schild ignorieren), nichttoedlich?, durchschlagFront?, schildReset?,
//            betaeubt? (s), strike? (Orbitalschlag) }   quelle: { id?, team, x, y }
// Rückgabe: 'schild'|'wunde'|'gefallen'|'bewusstlos'|'abgelenkt'|'kuppel'|'ignoriert'
function treffer(game, ziel, wirkung, quelle) {
  const w = wirkung || {}; const q = quelle || {}; const C = ac(game); const t = now(game);
  const zs = ziel.zustand || 'ok';
  if (zs !== 'ok') return 'ignoriert';
  // Friendly Fire nur über Fläche (E17)
  if (!w.flaeche && q.team && q.team === ziel.team) return 'ignoriert';
  // Schildkuppel des Außenteams (heute in hitPlayer)
  const aw = game.away;
  if (ziel.team === 'crew' && aw && aw.kuppelHp > 0 && t < (aw.kuppelUntil || 0)) {
    aw.kuppelHp = Math.max(0, aw.kuppelHp - (Number(C.kuppelPerHit) || 0));
    return 'kuppel';
  }
  // Frontschild (E14): Treffer aus dem Frontbogen abgelenkt, auch Nahkampf; Lanze und Orbitalschlag gehen durch
  if (ziel.frontArc && Number.isFinite(ziel.facing) && !w.durchschlagFront && !w.strike && Number.isFinite(q.x) &&
      Math.hypot(q.x - ziel.x, q.y - ziel.y) > EPS) {
    const rel = normAngle(Math.atan2(q.y - ziel.y, q.x - ziel.x) - ziel.facing);
    if (Math.abs(rel) <= (ziel.frontArc * Math.PI / 180) / 2 + EPS) {
      emit(game, 'abgelenkt', { id: ziel.id, waffe: w.waffe || null });
      return 'abgelenkt';
    }
  }
  // Getroffen: Ausholen/Laden brechen ab (E13), Schildladen beginnt neu
  unterbrechen(game, ziel, 'treffer');
  if (!ziel.schild) ziel.schild = { seg: 0, max: 0, lastHitAt: -99, regenT: 0 };
  if (!ziel.wunden) ziel.wunden = { n: 1, max: 1 };
  const sh = ziel.schild;
  sh.lastHitAt = t; sh.regenT = 0;
  if (w.betaeubt > 0) {
    ziel.betaeubtBis = Math.max(ziel.betaeubtBis || 0, t + w.betaeubt);
    emit(game, 'betaeubt', { id: ziel.id, waffe: w.waffe || null });
  }
  if (!w.wunde && sh.seg > EPS) {
    sh.seg = rund(Math.max(0, sh.seg - (Number(w.schaden) || 1)));
    return 'schild';
  }
  if (w.nichttoedlich && !w.wunde) {
    ziel.zustand = 'bewusstlos'; ziel.bewusstBis = t + (Number(C.koerper.bewusstlos) || 0);
    sh.seg = 0;
    emit(game, 'bewusstlos', { id: ziel.id, waffe: w.waffe || null });
    return 'bewusstlos';
  }
  ziel.wunden.n = Math.max(0, ziel.wunden.n - 1);
  if (ziel.wunden.n > 0) return 'wunde';
  ziel.zustand = 'verwundet'; sh.seg = 0;
  if (ziel.team !== 'crew') ziel.ausblutenBis = t + (Number(C.koerper.gegnerBleedout) || 0);
  return 'gefallen';
}

// ---------- Fesseln, Befreien, Aufrichten (Abschluss der Halte-Interaktion; Dauer: haltedauer) ----------
function haltedauer(game, was) { return Number(ac(game).koerper[was]) || 0; }
function fesseln(game, k, durch) {
  if (k.zustand !== 'bewusstlos') return 'nicht_bewusstlos';
  if (!durch || durch.team === k.team) return 'eigene_seite';
  k.zustand = 'gefesselt'; k.bewusstBis = 0;
  emit(game, 'gefesselt', { id: k.id, durch: durch.id });
  return null;
}
function befreien(game, k, durch) {
  if (k.zustand !== 'gefesselt') return 'nicht_gefesselt';
  if (!durch || durch.team !== k.team || durch === k) return 'gegenseite';
  k.zustand = 'ok'; k.betaeubtBis = 0;
  if (k.schild) k.schild.seg = Math.min(k.schild.max, 1);
  emit(game, 'befreit', { id: k.id });
  return null;
}
function aufrichten(game, k, durch) {
  if (k.zustand !== 'verwundet') return 'nicht_verwundet';
  if (!durch || durch.team !== k.team || durch === k) return 'gegenseite';
  if (!handlungsfaehig(game, durch)) return 'helfer';
  const segs = Number(ac(game).wounded.reviveSegments) || 1;
  k.zustand = 'ok'; k.ausblutenBis = 0;
  if (k.wunden) k.wunden.n = Math.max(1, k.wunden.n);
  if (k.schild) { k.schild.seg = Math.min(k.schild.max, segs); k.schild.lastHitAt = now(game); k.schild.regenT = 0; }
  emit(game, 'aufgerichtet', { id: k.id });
  return null;
}

// ---------- Update je Tick (Hitze, Laden, Ausholen, Aufwachen, Ausbluten der Gegner) ----------
function update(game, k, dt) {
  const t = now(game);
  if (k.zustand === 'bewusstlos' && t >= (k.bewusstBis || 0)) {
    k.zustand = 'ok';
    if (k.schild) { k.schild.seg = Math.max(k.schild.seg, Math.min(k.schild.max, 1)); k.schild.lastHitAt = t; k.schild.regenT = 0; }
  }
  if (k.zustand === 'verwundet' && k.team !== 'crew' && k.ausblutenBis && t >= k.ausblutenBis) k.zustand = 'aus';
  const d = def(game, k.waffe);
  // Hitze
  if (k.gesperrtBis) {
    if (t >= k.gesperrtBis - EPS) { k.gesperrtBis = 0; k.hitze = 0; }
  } else if (d && k.hitze > 0 && !k.ausholen && !k.ladung) {   // Ausholen und Laden gehören zum Angriff: keine Abkühlung
    const kuehl = Math.min(dt, t - (k.schussAt == null ? -99 : k.schussAt) - (Number(d.pause) || 0));
    if (kuehl > 0) { k.hitze = k.hitze - kuehl / Math.max(EPS, Number(d.kalt) || 1); if (k.hitze < EPS) k.hitze = 0; }
  }
  if ((k.zustand || 'ok') !== 'ok') { unterbrechen(game, k, k.zustand); return; }
  if (betaeubt(game, k)) { unterbrechen(game, k, 'betaeubt'); return; }
  if (k.ladung && d) {
    if (d.stehen && Math.hypot(k.x - k.ladung.x, k.y - k.ladung.y) > 2) unterbrechen(game, k, 'bewegt');
    else {
      k.ladung.t += dt;
      let st = 0; for (const s of d.laden || []) if (k.ladung.t >= s - EPS) st++;
      k.ladung.stufe = st;
    }
  }
  if (k.ausholen && d) {
    k.ausholen.t += dt;
    if (k.ausholen.t >= k.ausholen.dauer - EPS) schlag(game, k, d);
  }
}

// Schild laden (wie heute: nach regenDelay ohne Treffer je regenStep +1, höchstens max; halbe Segmente erlaubt)
function schildUpdate(game, k, dt, werte) {
  const sh = k.schild; if (!sh || (k.zustand || 'ok') !== 'ok') return false;
  if (sh.seg >= sh.max) { sh.regenT = 0; return false; }
  if (now(game) - sh.lastHitAt < werte.regenDelay) { sh.regenT = 0; return false; }
  sh.regenT += dt;
  if (sh.regenT < werte.regenStep) return false;
  sh.regenT = 0; sh.seg = Math.min(sh.max, sh.seg + 1);
  return true;
}

// ---------- Snapshot-Felder (B2 §8; ENGINE trägt sie ein) ----------
function snapFelder(game, k) {
  const d = def(game, k.waffe) || {};
  const out = { wf: k.waffe, ht: Math.round((k.hitze || 0) * 100), ov: ueberhitzt(game, k) ? 1 : 0, zs: k.zustand || 'ok', bt: betaeubt(game, k) ? 1 : 0 };
  if (k.ladung && Array.isArray(d.laden)) out.ch = Math.min(100, Math.round(k.ladung.t / d.laden[d.laden.length - 1] * 100));
  if (k.ausholen) out.wu = Math.min(100, Math.round(k.ausholen.t / Math.max(EPS, k.ausholen.dauer) * 100));
  return out;
}

// ---------- Waffenwahl, Weltstand crew.waffen (E26) ----------
function hashKennung(clientId) { return crypto.createHash('sha1').update(String(clientId)).digest('hex').slice(0, 12); }
function wahl(game) { if (!game.crewWaffen || typeof game.crewWaffen !== 'object') game.crewWaffen = {}; return game.crewWaffen; }
// Waffe setzen (Transfer-Konsole, Debug, Zelle). Gespeichert wird nur eine wählbare Waffe (nie 'faust') über den Hash.
function waffeSetzen(game, p, waffe) {
  if (!def(game, waffe) || waffe === 'waechter') return 'unbekannt';
  p.waffe = waffe; p.hitze = 0; p.gesperrtBis = 0; p.ladung = null; p.ausholen = null; p.bereitAt = 0;
  if (WAHL.includes(waffe) && p.clientId != null) wahl(game)[hashKennung(p.clientId)] = waffe;
  emit(game, 'loadout', { pid: p.id, waffe });
  return null;
}
// Gespeicherte Wahl eines Spielers, sonst Blaster (neue Spieler)
function waffeFuer(game, p) {
  const w = p && p.clientId != null ? wahl(game)[hashKennung(p.clientId)] : null;
  return WAHL.includes(w) ? w : 'blaster';
}
function toSave(game) { return game ? Object.assign({}, wahl(game)) : {}; }
function restore(obj, game) {
  if (!game) return;
  const out = {};
  for (const [h, w] of Object.entries(obj && typeof obj === 'object' ? obj : {})) if (/^[0-9a-f]{12}$/.test(h) && WAHL.includes(w)) out[h] = w;
  game.crewWaffen = out;
}

module.exports = {
  aktiv: process.env.WAFFEN !== 'aus',
  WAHL, ZUSTAENDE,
  def, art, ausstatten, kannFeuern, feuern, loslassen, update, treffer, explosion, granateFlug, laerm, hoert,
  sichtPruefen, geteiltBis, unterbrechen, fesseln, befreien, aufrichten, haltedauer, handlungsfaehig, betaeubt, ueberhitzt,
  schildUpdate, snapFelder, waffeSetzen, waffeFuer, toSave, restore, hashKennung,
};
