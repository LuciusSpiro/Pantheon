'use strict';
// MON-01 P1: Kreaturen-Rahmen. Ein Typ für alle künftigen Monster (Rudeltier, Schwarm, Energiewesen). Action-Layer; Zustand lebt in der Außenkarte
// (game.away.kreaturen, mit der Karte zurückgesetzt), nie im Weltstand. Das Station-Monster (server/sim/monster.js, aw.monster) bleibt davon getrennt und unverändert.
//
// Alles Verhalten kommt aus Daten (content/kampf/kreaturen.json): Zustandstabelle (Zustände, Auslöser, Dauer, Übergang), Wahrnehmung, Tempo je Zustand, Werte für
// Schild/Wunden/Frontbogen und eingeschaltete Bausteine mit Parametern. Der Server kennt keinen Typnamen: kein `if (typ === …)`.
//
//   update(game, dt)                         je Tick (aus combat.update, nach dem Station-Monster); ohne Kreaturen sofort zurück, ohne Zufallsverbrauch
//   kreaturBausteinAnmelden(name, def)       Registry der Bausteine. def = { beiTick?, beiTreffer?, beiLaerm?, modi?, ausloeser?, pruefen? } -> Abmelder
//       beiTick(game, K, dt, par, ctx)        je Tick vor dem Zustandswechsel (ctx = { E, m, typ, ziel, k })
//       beiTreffer(game, K, treffer, par)     Aufruf über bausteinTreffer (Treffer-Hooks kommen in P2)
//       beiLaerm(game, K, laerm, par)         Aufruf über bausteinLaerm (Lärm-Leser kommt in P2b)
//       modi: { name: { betreten?(game, K, ctx, par, zustand), tick(game, K, dt, ctx, par, zustand) } }   Bewegungsmodi, die Zustände der Tabelle verwenden dürfen
//       ausloeser: { name(game, K, ctx, par, uebergang) -> bool }                                         zusätzliche Auslöser für `uebergang[].auf`
//       pruefen(par) -> [Fehlertext]          Parameter-Prüfung des Validators
//   Eingebaut: Modi steht, zielen, streife, verfolge; Auslöser sieht, verloren, ablauf, nah (abstand), blockiert; Baustein `zyklus` (Modus `ramme`).
//   ziele(aw)                                Drohnen + Kreaturen für Treffer-Schleifen; ohne Kreaturen DIESELBE Referenz aw.drones (P2a)
//   ausruesten(game, K)                      Kämpfer-Vertrag (aus combat.kaempfer): Schild, Wunden, Frontbogen, Blickrichtung, Trefferradius aus dem Typ (P2a)
//   raeumen(aw)                              Kreaturen einer Karte entfernen (Szenario-Start, P2a)
//   daten() / pruefen(daten)                 Laden und Validator (lazy beim ersten Gebrauch, damit sich Bausteine vorher anmelden können; Fehler = Exception mit allen Befunden)
//   erzeugen(game, typ, x, y) / debugKreatur(game, p, typ)   Anlegen; Debug `kreatur <typ>` (nur Server --debug)
//
// Zufall NUR über aw.rng (nie game.rng, sonst verschiebt sich der Strom des Station-Monsters). Wahrnehmung wie Station: Sicht in Kacheln, Sichtlinie über combat.losBetween.
const Mon = require('../../shared/monster.js');
const Physics = require('../../shared/physics.js');
const Monster = require('./monster.js');
const KREATUREN = require('../../content/kampf/kreaturen.json');

let combatMod = null;
const combat = () => combatMod || (combatMod = require('./combat.js'));
let waffenMod = null;
const waffen = () => waffenMod || (waffenMod = require('./waffen.js'));
const TILE = Physics.TILE;
const KOERPER_PRO_FUSS = 14;   // px Kollisionsbox je Kachel Fußabdruck (Größe 2 = 28×28 = Station)
const hbVon = (typ) => ({ w: typ.groesse * KOERPER_PRO_FUSS, h: typ.groesse * KOERPER_PRO_FUSS });

// ---------- Registry der Bausteine ----------
const bausteine = new Map();
let zwischenDaten = null;   // geprüfte Daten (lazy), wird beim Anmelden/Abmelden eines Bausteins verworfen
function kreaturBausteinAnmelden(name, def) {
  if (typeof name !== 'string' || !name) throw new Error('kreaturBausteinAnmelden: Name fehlt');
  if (!def || typeof def !== 'object') throw new Error('kreaturBausteinAnmelden: Definition fehlt (' + name + ')');
  if (bausteine.has(name)) throw new Error('kreaturBausteinAnmelden: Baustein bereits angemeldet (' + name + ')');
  for (const k of ['beiTick', 'beiTreffer', 'beiLaerm', 'pruefen']) if (def[k] !== undefined && typeof def[k] !== 'function') throw new Error('kreaturBausteinAnmelden: ' + k + ' muss eine Funktion sein (' + name + ')');
  for (const [gruppe, fn] of [['modi', 'tick'], ['ausloeser', null]]) {
    for (const [n, f] of Object.entries(def[gruppe] || {})) if (fn ? !f || typeof f[fn] !== 'function' : typeof f !== 'function') throw new Error('kreaturBausteinAnmelden: ' + gruppe + '.' + n + ' ungültig (' + name + ')');
  }
  const eintrag = def;
  bausteine.set(name, eintrag);
  zwischenDaten = null;   // Validierung beim nächsten Gebrauch neu
  return () => { if (bausteine.get(name) === eintrag) { bausteine.delete(name); zwischenDaten = null; } };
}

// ---------- Kern: Modi und Auslöser ----------
const KERN_MODI = {
  steht: { tick() {} },
  // Blick zum letzten bekannten Ziel drehen, stehen bleiben (Aufladen)
  zielen: { tick(game, K) { if (K.letzte) K.facing = Math.atan2(K.letzte.y - K.y, K.letzte.x - K.x); } },
  // Zufälliges Ziel im Umkreis (zustand.radius Kacheln) über aw.rng, dorthin gehen
  streife: {
    tick(game, K, dt, ctx, par, z) {
      if (!K.pfad.length && K.replan <= 0) {
        const aw = game.away; const r = z.radius || 8;
        const base = Mon.ankerVon(K.x, K.y);
        for (let i = 0; i < 12; i++) {
          const cx = base.cx + Math.round((aw.rng() * 2 - 1) * r), cy = base.cy + Math.round((aw.rng() * 2 - 1) * r);
          if (ctx.m.geht(cx, cy)) { Monster.setzePfad(K, ctx.m, { cx, cy }); break; }
        }
        K.replan = 1.2;
      }
      gehe(game, K, dt, ctx, z.tempo);
    },
  },
  // Dem letzten bekannten Ziel folgen (Pfad über dieselbe Maske wie die Kollision)
  verfolge: {
    tick(game, K, dt, ctx, par, z) {
      if (K.letzte && (K.replan <= 0 || !K.pfad.length)) {
        const a = Mon.naechster(ctx.m, Math.floor(K.letzte.x / TILE), Math.floor(K.letzte.y / TILE), 3);
        if (a) Monster.setzePfad(K, ctx.m, a);
        K.replan = ctx.typ.replan;
      }
      gehe(game, K, dt, ctx, z.tempo);
    },
  },
};
function gehe(game, K, dt, ctx, tempo) {
  const r = Monster.gehenMit(game, ctx.E, K, dt, tempo, { hb: hbVon(ctx.typ), rammZeit: ctx.typ.rammZeit, tueren: ctx.typ.tuerenAufbrechen ? 'aufbrechen' : 'sperren' });
  if (r === 'tuer') { K.pfad = []; K.replan = Math.max(K.replan, 1); K.tuerGesperrt = true; }   // Tür bleibt zu: Pfad verwerfen, später neu planen
  return r;
}
const KERN_AUSLOESER = {
  sieht: (game, K, ctx) => !!ctx.ziel,
  verloren: (game, K, ctx) => K.verlust >= ctx.typ.verlustZeit,
  ablauf: (game, K) => K.t != null && K.t <= 0,
  nah: (game, K, ctx, par, u) => !!ctx.ziel && Math.hypot(ctx.ziel.x - K.x, ctx.ziel.y - K.y) <= u.abstand * TILE,
  blockiert: (game, K) => !!K.blockiert,
};
const KERN_NAMEN = { modi: Object.keys(KERN_MODI), ausloeser: Object.keys(KERN_AUSLOESER) };

// ---------- Baustein zyklus: Aufladen → Rammen → Pause ----------
// Die Zustände und Dauern stehen in der Tabelle des Typs; der Baustein liefert den Modus `ramme`: geradeaus in Blickrichtung mit dem Tempo des Zustands.
// Hindernis (Wand, Tür, Möbel): kommt die Kreatur in Blickrichtung weniger als `hindernisAb` des Schritts voran, gilt sie als blockiert (Auslöser `blockiert`).
kreaturBausteinAnmelden('zyklus', {
  modi: {
    ramme: {
      betreten(game, K) { K.pfad = []; },
      tick(game, K, dt, ctx, par, z) {
        const s = z.tempo * dt; if (s <= 0) return;
        const dx = Math.cos(K.facing), dy = Math.sin(K.facing);
        const res = Physics.moveWithCollision(ctx.E.solid, K.x, K.y, dx * s, dy * s, hbVon(ctx.typ));
        const voran = (res.x - K.x) * dx + (res.y - K.y) * dy;
        K.x = res.x; K.y = res.y;
        if (voran < s * par.hindernisAb) K.blockiert = true;
      },
    },
  },
  pruefen(par) {
    const F = [];
    if (!par || typeof par.hindernisAb !== 'number' || !(par.hindernisAb > 0 && par.hindernisAb <= 1)) F.push('hindernisAb muss eine Zahl in (0, 1] sein');
    return F;
  },
});

// ---------- Daten laden und prüfen ----------
const TYP_FELDER = ['name', 'groesse', 'sicht', 'verlustZeit', 'replan', 'hitRadius', 'schild', 'schildRegen', 'wunden', 'frontArc', 'tuerenAufbrechen', 'rammZeit', 'start', 'zustaende', 'bausteine'];
const ZUSTAND_FELDER = ['modus', 'tempo', 'dauer', 'radius', 'uebergang'];
const zahl = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && (max === undefined || v <= max);

function pruefen(d) {
  const F = [];
  const f = (pfad, text) => F.push(pfad + ': ' + text);
  if (!d || typeof d !== 'object' || Array.isArray(d)) return ['kreaturen.json: Objekt erwartet'];
  if (d.version !== 1) f('version', 'muss 1 sein');
  if (!d.typen || typeof d.typen !== 'object' || Array.isArray(d.typen)) { f('typen', 'Objekt erwartet'); return F; }
  for (const [id, t] of Object.entries(d.typen)) {
    const P = 'typen.' + id;
    if (!t || typeof t !== 'object' || Array.isArray(t)) { f(P, 'Objekt erwartet'); continue; }
    for (const k of Object.keys(t)) if (!TYP_FELDER.includes(k)) f(P + '.' + k, 'unbekanntes Feld');
    if (typeof t.name !== 'string' || !t.name) f(P + '.name', 'Name-Schlüssel (String) fehlt');
    if (!Number.isInteger(t.groesse) || t.groesse < 1 || t.groesse > 4) f(P + '.groesse', 'ganze Zahl 1..4 (Kanten des Fußabdrucks in Kacheln)');
    if (!zahl(t.sicht, 0.1)) f(P + '.sicht', 'Zahl > 0 (Kacheln)');
    if (!zahl(t.verlustZeit, 0)) f(P + '.verlustZeit', 'Zahl >= 0 (s)');
    if (!zahl(t.replan, 0.05)) f(P + '.replan', 'Zahl >= 0,05 (s)');
    if (!zahl(t.hitRadius, 1)) f(P + '.hitRadius', 'Zahl >= 1 (px)');
    if (!t.schild || !zahl(t.schild.seg, 0) || !zahl(t.schild.max, 1) || t.schild.seg > t.schild.max || !Number.isInteger(t.schild.seg) || !Number.isInteger(t.schild.max)) f(P + '.schild', '{ seg, max } ganze Zahlen, 0 <= seg <= max, max >= 1');
    if (t.schildRegen !== undefined && (!t.schildRegen || !zahl(t.schildRegen.verzoegerung, 0) || !zahl(t.schildRegen.schritt, 0.05))) f(P + '.schildRegen', 'optional: { verzoegerung (s ohne Treffer) >= 0, schritt (s je Segment) >= 0,05 }; fehlt = keine Regeneration');
    if (!Number.isInteger(t.wunden) || t.wunden < 1) f(P + '.wunden', 'ganze Zahl >= 1');
    if (!zahl(t.frontArc, 0, 360)) f(P + '.frontArc', 'Zahl 0..360 (Grad, 0 = keine Frontpanzerung)');
    if (typeof t.tuerenAufbrechen !== 'boolean') f(P + '.tuerenAufbrechen', 'true oder false');
    if (!zahl(t.rammZeit, 0.05)) f(P + '.rammZeit', 'Zahl >= 0,05 (s)');
    const bs = t.bausteine;
    if (!bs || typeof bs !== 'object' || Array.isArray(bs)) f(P + '.bausteine', 'Objekt erwartet (leer erlaubt)');
    const aktiv = bs && typeof bs === 'object' ? Object.keys(bs) : [];
    for (const b of aktiv) {
      const def = bausteine.get(b);
      if (!def) { f(P + '.bausteine.' + b, 'unbekannter Baustein (angemeldet: ' + [...bausteine.keys()].join(', ') + ')'); continue; }
      if (def.pruefen) for (const m of def.pruefen(bs[b])) f(P + '.bausteine.' + b, m);
    }
    const modi = new Set(KERN_NAMEN.modi), ausl = new Set(KERN_NAMEN.ausloeser);
    for (const b of aktiv) { const def = bausteine.get(b); if (def) { for (const n of Object.keys(def.modi || {})) modi.add(n); for (const n of Object.keys(def.ausloeser || {})) ausl.add(n); } }
    const Z = t.zustaende;
    if (!Z || typeof Z !== 'object' || Array.isArray(Z) || !Object.keys(Z).length) { f(P + '.zustaende', 'mindestens ein Zustand'); continue; }
    if (typeof t.start !== 'string' || !Z[t.start]) f(P + '.start', 'muss ein Zustand der Tabelle sein');
    for (const [zn, z] of Object.entries(Z)) {
      const ZP = P + '.zustaende.' + zn;
      if (!z || typeof z !== 'object' || Array.isArray(z)) { f(ZP, 'Objekt erwartet'); continue; }
      for (const k of Object.keys(z)) if (!ZUSTAND_FELDER.includes(k)) f(ZP + '.' + k, 'unbekanntes Feld');
      if (!modi.has(z.modus)) f(ZP + '.modus', 'unbekannter Modus "' + z.modus + '" (bekannt bei diesem Typ: ' + [...modi].join(', ') + ')');
      if (!zahl(z.tempo, 0)) f(ZP + '.tempo', 'Zahl >= 0 (px/s)');
      if (z.dauer !== undefined && !zahl(z.dauer, 0.05)) f(ZP + '.dauer', 'Zahl >= 0,05 (s)');
      if (z.radius !== undefined && !zahl(z.radius, 1)) f(ZP + '.radius', 'Zahl >= 1 (Kacheln)');
      if (!Array.isArray(z.uebergang)) { f(ZP + '.uebergang', 'Liste erwartet (leer erlaubt)'); continue; }
      z.uebergang.forEach((u, i) => {
        const UP = ZP + '.uebergang[' + i + ']';
        if (!u || typeof u !== 'object') { f(UP, 'Objekt erwartet'); return; }
        if (!ausl.has(u.auf)) f(UP + '.auf', 'unbekannter Auslöser "' + u.auf + '" (bekannt bei diesem Typ: ' + [...ausl].join(', ') + ')');
        if (typeof u.nach !== 'string' || !Z[u.nach]) f(UP + '.nach', 'Zustand "' + u.nach + '" gibt es nicht');
        if (u.auf === 'ablauf' && z.dauer === undefined) f(UP, 'Auslöser ablauf braucht eine dauer im Zustand');
        if (u.auf === 'nah' && !zahl(u.abstand, 0.1)) f(UP + '.abstand', 'Auslöser nah braucht abstand > 0 (Kacheln)');
      });
    }
  }
  return F;
}

function daten() {
  if (zwischenDaten) return zwischenDaten;
  const F = pruefen(KREATUREN);
  if (F.length) throw new Error('content/kampf/kreaturen.json ungültig (' + F.length + ' Fehler):\n  ' + F.join('\n  '));
  zwischenDaten = KREATUREN;
  return zwischenDaten;
}
const typVon = (id) => { const t = daten().typen[id]; return t || null; };
const typIds = () => Object.keys(daten().typen);

// ---------- Instanzen ----------
const kreaturen = (game) => { const aw = game.away; return aw && aw.kreaturen ? aw.kreaturen : null; };
function betreten(game, K, zn, ctx) {
  const typ = typVon(K.typ); const z = typ.zustaende[zn];
  K.z = zn; K.zt = 0; K.t = z.dauer !== undefined ? z.dauer : null; K.blockiert = false; K.ramm = null; K.pfad = []; K.replan = 0; K.tuerGesperrt = false;
  const modus = modusVon(typ, z.modus);
  if (modus && modus.betreten) modus.betreten(game, K, ctx || null, parVon(typ, z.modus), z);
}
function modusVon(typ, name) {
  if (KERN_MODI[name]) return KERN_MODI[name];
  for (const b of Object.keys(typ.bausteine)) { const def = bausteine.get(b); if (def && def.modi && def.modi[name]) return def.modi[name]; }
  return null;
}
function parVon(typ, modusName) {
  for (const b of Object.keys(typ.bausteine)) { const def = bausteine.get(b); if (def && def.modi && def.modi[modusName]) return typ.bausteine[b]; }
  return null;
}
function ausloeserVon(typ, name) {
  if (KERN_AUSLOESER[name]) return { fn: KERN_AUSLOESER[name], par: null };
  for (const b of Object.keys(typ.bausteine)) { const def = bausteine.get(b); if (def && def.ausloeser && def.ausloeser[name]) return { fn: def.ausloeser[name], par: typ.bausteine[b] }; }
  return null;
}

// Zustand von außen setzen (Szenenbausteine, Tests): durchläuft dieselbe Eintrittsroutine wie ein Übergang der Tabelle
function zustandSetzen(game, K, zustand) {
  const typ = typVon(K.typ);
  if (!typ.zustaende[zustand]) throw new Error('zustandSetzen: Zustand ' + zustand + ' gibt es bei ' + K.typ + ' nicht');
  betreten(game, K, zustand, null);
}

// Neue Kreatur in aw.kreaturen. Liefert die Instanz. Nur über Debug oder (später) über Karten-/Szenenbausteine aufrufen.
function erzeugen(game, typId, x, y) {
  const aw = game.away; if (!aw) throw new Error('erzeugen: keine Außenkarte');
  const typ = typVon(typId); if (!typ) throw new Error('erzeugen: unbekannter Typ ' + typId);
  if (!aw.kreaturen) aw.kreaturen = [];
  aw.kreaturSeq = (aw.kreaturSeq || 0) + 1;
  const K = { id: 'K' + aw.kreaturSeq, kind: 'kreatur', kreatur: true, typ: typId, x, y, facing: 0, alive: true, team: 'feind',
    seg: typ.schild.seg, max: typ.schild.max, hp: typ.schild.seg, lastHitAt: -99, regenT: 0, wunden: { n: typ.wunden, max: typ.wunden }, frontArc: typ.frontArc, hitRadius: typ.hitRadius,
    z: null, zt: 0, t: null, pfad: [], ziel: null, ramm: null, replan: 0, blockiert: false, tuerGesperrt: false, verlust: 0, letzte: null, stuckT: 0, ref: { x, y } };
  betreten(game, K, typ.start, null);
  aw.kreaturen.push(K);
  return K;
}

// ---------- Tick ----------
function wahrnehmung(game, E, K, typ) { return Monster.ziel(game, E, K, { sicht: typ.sicht }); }

function tickEine(game, E, k, K, dt) {
  const typ = typVon(K.typ);
  const m = Monster.maskeVonGroesse(k, typ.groesse);
  K.zt += dt; if (K.t != null) K.t -= dt; K.replan -= dt;
  const ziel = wahrnehmung(game, E, K, typ);
  if (ziel) { K.verlust = 0; K.letzte = { x: ziel.x, y: ziel.y }; K.zielId = ziel.id; }
  else K.verlust += dt;
  const ctx = { game, E, m, typ, ziel, k };
  for (const b of Object.keys(typ.bausteine)) { const def = bausteine.get(b); if (def && def.beiTick) def.beiTick(game, K, dt, typ.bausteine[b], ctx); }
  // Zustandswechsel: der erste zutreffende Übergang der Tabelle (einmal je Tick)
  const z0 = typ.zustaende[K.z];
  for (const u of z0.uebergang) {
    const a = ausloeserVon(typ, u.auf);
    if (a && a.fn(game, K, ctx, a.par, u)) { betreten(game, K, u.nach, ctx); break; }
  }
  const z = typ.zustaende[K.z];
  const modus = modusVon(typ, z.modus);
  if (modus) modus.tick(game, K, dt, ctx, parVon(typ, z.modus), z);
  // Anti-Hängen (Pfadmodi): bewegt sich die Kreatur 3 s nicht, obwohl sie einen Pfad hat, Pfad verwerfen
  if (K.pfad.length) {
    if (Math.hypot(K.x - K.ref.x, K.y - K.ref.y) > 6) { K.ref = { x: K.x, y: K.y }; K.stuckT = 0; }
    else if ((K.stuckT += dt) >= 3) { K.pfad = []; K.replan = 0; K.stuckT = 0; }
  } else { K.stuckT = 0; K.ref = { x: K.x, y: K.y }; }
}

function update(game, dt) {
  const aw = game.away; if (!aw || !aw.kreaturen || !aw.kreaturen.length) return;
  if (!game.players.some((p) => p.zone === 'away')) return;   // ohne Außenteam steht alles still (wie die Station)
  const k = game.karteOf ? game.karteOf(aw.map) : null; if (!k) return;
  const E = combat().env(game);
  const Wf = waffen();
  for (const K of aw.kreaturen) {
    if (!K.alive) continue;   // gefallen/liegend: tot oder bewusstlos, keine Bewegung (Aufstehen zieht combat.folgenAbgleich nach)
    schildRegeneration(game, K, dt);
    if (Wf && !Wf.handlungsfaehig(game, K)) continue;   // betäubt/bewusstlos: steht still
    tickEine(game, E, k, K, dt);
  }
}

// ---------- Kampf-Anbindung (P2a) ----------
// Treffer-Schleifen (Projektil, Orbitalschlag, Folgen, Waffen-Update): Drohnen und Kreaturen. Ohne Kreaturen dieselbe Referenz wie aw.drones (kein neues Array, gleiche Reihenfolge).
function ziele(aw) { return aw.kreaturen && aw.kreaturen.length ? aw.drones.concat(aw.kreaturen) : aw.drones; }
// Kämpfer-Vertrag für waffen.js: Felder kommen vom Typ der Kreatur selbst (nie aus den Rollen-Tabellen der Drohnen)
function ausruesten(game, K) {
  const typ = typVon(K.typ); if (!typ) return K;
  if (K.max == null) K.max = typ.schild.max;
  if (K.seg == null) K.seg = typ.schild.seg;
  if (K.hp == null) K.hp = K.seg;
  if (!K.wunden) K.wunden = { n: typ.wunden, max: typ.wunden };
  if (K.frontArc == null) K.frontArc = typ.frontArc;
  if (!Number.isFinite(K.facing)) K.facing = 0;
  if (K.hitRadius == null) K.hitRadius = typ.hitRadius;
  if (K.lastHitAt == null) K.lastHitAt = -99;
  if (K.regenT == null) K.regenT = 0;
  return K;
}
// Eigene Schildregeneration je Typ (Datenfeld schildRegen { verzoegerung, schritt }); ohne Feld keine Regeneration (nie die Plünderer-Werte von updateEnemyShields)
function schildRegeneration(game, K, dt) {
  const typ = typVon(K.typ); const r = typ && typ.schildRegen;
  if (!r || K.seg >= K.max) { K.regenT = 0; return; }
  if (game.time - K.lastHitAt < r.verzoegerung) { K.regenT = 0; return; }
  K.regenT += dt;
  if (K.regenT < r.schritt) return;
  K.regenT = 0; K.seg++; K.hp = K.seg;
}
// Alle Kreaturen einer Außenkarte entfernen (Szenario-Start räumt die Karte wie aw.drones)
function raeumen(aw) { if (aw && aw.kreaturen && aw.kreaturen.length) aw.kreaturen = []; }

// Dispatcher für die Hooks der Bausteine (Aufrufer: Treffer-Auswertung P2, Lärm-Leser P2b)
function bausteinTreffer(game, K, treffer) { const typ = typVon(K.typ); for (const b of Object.keys(typ.bausteine)) { const def = bausteine.get(b); if (def && def.beiTreffer) def.beiTreffer(game, K, treffer, typ.bausteine[b]); } }
function bausteinLaerm(game, K, laerm) { const typ = typVon(K.typ); for (const b of Object.keys(typ.bausteine)) { const def = bausteine.get(b); if (def && def.beiLaerm) def.beiLaerm(game, K, laerm, typ.bausteine[b]); } }

// ---------- Debug ----------
// `kreatur <typ>`: eine Kreatur in etwa 6 Kacheln Abstand vom Spieler (nächster freier Ankerpunkt ihrer Maske). Ohne Typ: Liste der Typen.
function debugKreatur(game, p, typId) {
  if (!game.debug) return 'kreatur: nur mit Server --debug.';
  if (p.zone !== 'away' || !game.away) return 'kreatur: nur am Boden.';
  let ids;
  try { ids = typIds(); } catch (e) { return 'kreatur: ' + e.message.split('\n')[0]; }
  if (!typId) return 'kreatur <typ>: ' + ids.join(', ');
  if (!ids.includes(typId)) return 'kreatur: unbekannter Typ "' + typId + '" (' + ids.join(', ') + ').';
  const k = game.karteOf ? game.karteOf(game.away.map) : null;
  if (!k) return 'kreatur: keine Karte.';
  combat().ensureV2(game, game.away);   // aw.rng u. a. vorhanden
  const typ = typVon(typId);
  const m = Monster.maskeVonGroesse(k, typ.groesse);
  const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
  let a = null;
  for (const [dx, dy] of [[6, 0], [-6, 0], [0, 6], [0, -6], [4, 4], [-4, 4], [4, -4], [-4, -4], [3, 0], [-3, 0], [0, 3], [0, -3]]) {
    a = Mon.naechster(m, tx + dx, ty + dy, 2); if (a) break;
  }
  if (!a) return 'kreatur: kein freier Platz in der Nähe.';
  const pos = Mon.mitte(a);
  const K = erzeugen(game, typId, pos.x, pos.y);
  if (game.notice) game.notice(p, 'kreatur: ' + typId + ' ' + K.id + ' bei (' + a.cx + ',' + a.cy + ').');
  return null;
}

module.exports = { update, kreaturBausteinAnmelden, bausteinTreffer, bausteinLaerm, daten, pruefen, typVon, erzeugen, zustandSetzen, debugKreatur, kreaturen, ziele, ausruesten, raeumen };
