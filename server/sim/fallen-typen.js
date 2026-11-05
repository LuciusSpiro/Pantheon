'use strict';
// ITM-01 D: die drei ersten Fallentypen (Wirkungen im Register von fallen.js). Nur Server und Daten, kein Client.
//   schott   Schott schließt sich: keine Verletzung. Kanten der Art schott im Wirkbereich (CONFIG.anker.falle.schott.radius, nur die Karte, auf der die Falle liegt) gehen vom Zustand
//            offen/gehackt auf zu und öffnen nach schott.dauer s wieder (auf ihren Zustand davor), oder früher durch Hacken (E halten, der vorhandene Weg: Schott-Füllplatz E 1 s,
//            technischer Eingang Hacken 6 s -> gehackt). Zustand zu, nicht verschlossen: nur zu ist über beide Wege hackbar (verschlossen kennt am freien Schott nur "Verschlossen.").
//            Geschlossen wird erst, wenn niemand (Spieler, Gegner) auf der Kachel steht: nie jemand in einer festen Kachel. Ein Schott im Wirkbereich fehlt nie still: ohne Kante meldet
//            die Falle falleWirkungslos (Ereignis, Hinweis an den Auslöser mit game.debug) und shared/buehne.js warnt vorab (K-FALLE).
//   Gefahrenfeld (druck und weitere Varianten per Config): CONFIG.anker.falle.feld[typ] = { dauer, takt, segmente, bereich, radius, quelle }. Ohne Kollisionsbox. Jeder Spieler im Bereich verliert
//            alle takt s (Zeit je Spieler und Falle, zählt nur im Bereich, Verlassen setzt sie zurück) segmente Segmente, bis die Dauer endet. feldAnmelden(typ) hängt eine Variante ein.
//   schuss   Selbstschussanlage (Kollisionsbox über CONFIG.anker.falle.blockiert, interior.awaySolid): Salve aus schuesse Schuss im Takt, der erste nach verzug s. Jeder Schuss trifft den
//            nächsten Spieler in Reichweite mit Sichtlinie (Schuss-Sperre der Karte, geduckt hinter niedriger Deckung sicher: combat.losBetween), segmente Segmente. Ohne Ziel verfällt der Schuss.
// Ziele aller drei Typen: nur Spieler am Boden (zone away, verbunden, nicht downed, nicht beamLock, nicht an einem Lift, zustand ok). Gegner werden nie getroffen. god: hitPlayer meldet
// 'god', kein Schaden (Takt und Ereignisse laufen wie sonst). Die Zeitwirkung liegt nicht im Weltstand: nach Laden/Verdrängen der Außenkarte ist sie weg; geschlossene Schotts speichert
// beimSichern mit ihrem Zustand davor (landepunkte.sichern), die Falle bleibt ausgelöst.
// Ereignisse (Client, Paket E): falleSchott { map, anker, kanten[], dauer, an: 1 } und { …, an: 0 } beim Öffnen; falleFeld { map, anker, typ, an: 1|0, dauer, rect [x,y,w,h] Kacheln | r Kacheln, x, y };
//   selbstschuss { map, anker, i, x, y, tx, ty, pid } je abgegebenem Schuss (Pixel); falleWirkungslos { map, anker, typ, grund }. Zustände der Kanten über ko/ankerZustand wie immer.
const W = require('../world.js');
const Physics = require('../../shared/physics.js');
const Buehne = require('../../shared/buehne.js');
const CONFIG = require('../../shared/config.js');
const Fallen = require('./fallen.js');
const Anker = require('./anker.js');

const TILE = Physics.TILE;
const EPS = 1e-6;
const combat = () => require('./combat.js');   // lazy: combat lädt anker.js lädt fallen.js

const cfg = (game) => (game.C && game.C.anker && game.C.anker.falle) || CONFIG.anker.falle;
const texte = (game) => cfg(game).texte || {};
const karteVon = (aw) => { const e = W.AWAY_MAPS[aw.map]; return e && e.karte && Array.isArray(e.karte.rows) ? e.karte : null; };
const runden = (v) => Math.round(v);

// Spieler, die eine Falle treffen kann (gleiche Regeln wie beim Auslösen, dazu: nicht verwundet/bewusstlos/gefesselt)
function trifft(p) {
  return p.zone === 'away' && p.connected !== false && !p.downed && !p.beamLock && !p.lift && (p.zustand || 'ok') === 'ok';
}
function meldeAllen(game, text) {
  if (!text) return;
  for (const q of game.players) if (q.zone === 'away' && q.connected !== false && game.notice) game.notice(q, text);
}
function wirkungslos(game, aw, f, p, grund) {
  game.emit('falleWirkungslos', { map: aw.map, anker: f.id, typ: f.typ, grund });
  if (game.debug && p && game.notice) game.notice(p, texte(game).wirkungslos || 'Falle ausgelöst – ohne Wirkung.');
}

// ---------- schott ----------
function legendeInfo(k, typ) { return Object.values(k.legende || {}).find((i) => i.kind === typ) || {}; }
// Steht jemand auf einer Kachel der Kante (Hitbox der Figur, Rand 2 px)? Dann wird (noch) nicht geschlossen.
function belegt(game, aw, kante) {
  const set = new Set(kante.tiles.map((t) => t[0] + ',' + t[1]));
  const fest = (tx, ty) => set.has(tx + ',' + ty);
  const hb = (game.C && game.C.player && game.C.player.hitbox) || { w: 18, h: 12 };
  for (const q of game.players) if (q.zone === 'away' && Physics.boxHits(fest, q.x, q.y, hb.w + 4, hb.h + 4)) return true;
  for (const e of aw.drones || []) if (e.alive && Physics.boxHits(fest, e.x, e.y, 28, 28)) return true;
  return false;
}
function schottWirkung(game, aw, f, p) {
  const k = karteVon(aw); if (!k) return;
  const C = cfg(game).schott;
  const kanten = Buehne.fallenSchottKanten(k, f, C.radius);
  if (!kanten.length) { wirkungslos(game, aw, f, p, 'kein_schott'); return; }
  const offen = new Set(legendeInfo(k, 'schott').begehbarIn || ['offen', 'gehackt']);
  const rec = aw.fallenSchott || (aw.fallenSchott = {});   // Kante -> { von: Falle, vorher: Zustand davor }, nur für beimSichern
  const wartend = kanten.filter((q) => offen.has(Anker.zustand(game, aw.map, q.id)));   // schon zu oder verschlossen: bleibt, wie es ist
  const zu = [];
  const schritt = () => {
    for (const q of wartend.slice()) {
      const z = Anker.zustand(game, aw.map, q.id);
      if (!offen.has(z)) { wartend.splice(wartend.indexOf(q), 1); continue; }   // inzwischen anderweitig geschlossen
      if (belegt(game, aw, q)) continue;   // nie in eine feste Kachel hinein: später noch einmal
      if (Anker.setzen(game, aw.map, q.id, 'zu', p ? p.id : null)) { wartend.splice(wartend.indexOf(q), 1); continue; }
      rec[q.id] = { von: f.id, vorher: z };
      zu.push(q.id); wartend.splice(wartend.indexOf(q), 1);
    }
  };
  schritt();
  game.emit('falleSchott', { map: aw.map, anker: f.id, kanten: kanten.map((q) => q.id), dauer: C.dauer, an: 1 });
  meldeAllen(game, texte(game).schott);
  Fallen.zeitwirkung(game, aw, f, (gm, w, dt, e) => {
    if (e.t < C.dauer - EPS) { if (wartend.length) schritt(); return true; }
    for (const id of zu) {   // öffnen: nur, was noch von dieser Falle geschlossen ist (Hacken hat vorher geöffnet: unberührt)
      const r = rec[id];
      if (r && r.von === f.id) {
        if (Anker.zustand(gm, w.map, id) === 'zu') Anker.setzen(gm, w.map, id, r.vorher, null);
        delete rec[id];
      }
    }
    gm.emit('falleSchott', { map: w.map, anker: f.id, kanten: kanten.map((q) => q.id), dauer: C.dauer, an: 0 });
    return false;
  });
}
// Weltstand: eine laufende Schott-Falle wird nicht gespeichert; ihre Kanten stehen mit dem Zustand davor in z (Aufruf aus landepunkte.sichern; start = Zustände der Karte, k = Karte für den Kantenstart)
function beimSichern(aw, z, start, k) {
  const rec = aw && aw.fallenSchott;
  if (!rec) return;
  for (const id of Object.keys(rec)) {
    if (aw.zustaende && aw.zustaende[id] !== 'zu') continue;
    const s = (start || {})[id] != null ? start[id] : (k && k.kanten && k.kanten[id] ? k.kanten[id].zustand : undefined);
    if (rec[id].vorher === s) delete z[id]; else z[id] = rec[id].vorher;
  }
}

// ---------- Gefahrenfeld ----------
// Wirkbereich: Platz-Rect (Modul) der Karte, in dem die Falle liegt (kleinstes umschließendes), sonst Kreis radius. -> { rect: [x,y,w,h] } | { r }
function feldBereich(k, f, C) {
  if (C.bereich !== 'radius' && k) {
    let best = null;
    for (const id of Object.keys(k.plaetze || {}).sort()) {
      const r = k.plaetze[id] && k.plaetze[id].rect;
      if (!Array.isArray(r) || f.x < r[0] || f.y < r[1] || f.x >= r[0] + r[2] || f.y >= r[1] + r[3]) continue;
      if (!best || r[2] * r[3] < best[2] * best[3]) best = r;
    }
    if (best) return { rect: best.slice() };
  }
  return { r: Number(C.radius) || 0 };
}
function imBereich(b, f, p) {
  if (b.rect) { const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE); return tx >= b.rect[0] && ty >= b.rect[1] && tx < b.rect[0] + b.rect[2] && ty < b.rect[1] + b.rect[3]; }
  return Math.hypot(p.x - f.px, p.y - f.py) <= b.r * TILE;
}
function feldHandler(typ) {
  return (game, aw, f, p) => {
    const C = (cfg(game).feld || {})[typ];
    if (!C) throw new Error('Gefahrenfeld ' + typ + ': keine Config in anker.falle.feld');
    const b = feldBereich(karteVon(aw), f, C);
    const acc = {};   // Spieler-Id -> Sekunden im Bereich seit dem letzten Schaden
    const kind = C.quelle || typ;
    const ev = (an) => Object.assign({ map: aw.map, anker: f.id, typ, an, dauer: C.dauer, x: runden(f.px), y: runden(f.py) }, b.rect ? { rect: b.rect } : { r: b.r });
    game.emit('falleFeld', ev(1));
    meldeAllen(game, texte(game)[typ]);
    Fallen.zeitwirkung(game, aw, f, (gm, w, dt, e) => {
      const ende = e.t >= C.dauer - EPS;
      for (const q of gm.players) {
        if (!trifft(q) || !imBereich(b, f, q)) { delete acc[q.id]; continue; }
        acc[q.id] = (acc[q.id] || 0) + dt;
        if (acc[q.id] >= C.takt - EPS) {
          acc[q.id] -= C.takt;
          combat().hitPlayer(gm, q, C.segmente, { kind, x: f.px, y: f.py });
        }
      }
      if (!ende) return true;
      gm.emit('falleFeld', ev(0));
      return false;
    });
  };
}
const feldAbmelder = [];
// Eine Gefahrenfeld-Variante einhängen (Config unter anker.falle.feld[typ] muss stehen). Beim Laden des Moduls für alle Einträge der Config; spätere Varianten (Test) rufen das selbst. -> Abmelder
function feldAnmelden(typ) {
  const ab = Fallen.fallenWirkung(typ, feldHandler(typ));
  feldAbmelder.push(ab);
  return ab;
}

// ---------- schuss ----------
function ziel(game, aw, f, C, E) {
  const reich = C.reichweite * TILE;
  const kand = game.players.filter((q) => trifft(q) && Math.hypot(q.x - f.px, q.y - f.py) <= reich)
    .map((q, i) => ({ q, d: Math.hypot(q.x - f.px, q.y - f.py), i })).sort((a, b) => a.d - b.d || a.i - b.i);
  const von = { x: f.px, y: f.py };
  for (const c of kand) if (combat().losBetween(E, von, c.q)) return c.q;   // E.blocked = Schuss-Sperre (Fenster stoppt, Wand, geschlossene Tür), geduckt: niedrige Deckung schützt
  return null;
}
function schuss(game, aw, f, C, i) {
  const cb = combat();
  const E0 = cb.env(game);
  const E = Object.assign({}, E0, { blocked: E0.shotBlocked });
  const q = ziel(game, aw, f, C, E);
  if (!q) return false;
  game.emit('selbstschuss', { map: aw.map, anker: f.id, i, x: runden(f.px), y: runden(f.py), tx: runden(q.x), ty: runden(q.y), pid: q.id });
  cb.hitPlayer(game, q, C.segmente, { kind: 'selbstschuss', x: f.px, y: f.py });
  return true;
}
function schussWirkung(game, aw, f) {
  const C = cfg(game).schuss;
  let n = 0;
  meldeAllen(game, texte(game).schuss);
  Fallen.zeitwirkung(game, aw, f, (gm, w, dt, e) => {
    while (n < C.schuesse && e.t >= C.verzug + n * C.takt - EPS) { schuss(gm, w, f, C, n); n++; }
    return n < C.schuesse;
  });
}

Fallen.fallenWirkung('schott', schottWirkung);
for (const typ of Object.keys((CONFIG.anker.falle && CONFIG.anker.falle.feld) || {})) feldAnmelden(typ);
Fallen.fallenWirkung('schuss', schussWirkung);

module.exports = { feldAnmelden, beimSichern, trifft, feldBereich };
