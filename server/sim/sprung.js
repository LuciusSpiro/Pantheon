'use strict';
// Reisen / Faltsprung (§9.2) und Sektorkarte (CONTRACT-B3 §4, Team SEKTOR).
// Welle 0: selectDest/updateJump/doJump wörtlich aus server/sim/space.js verschoben; space.js ruft sie weiter auf.
// B3:
//   - Anflug (E29, Nachtrag W1 AP2): Sprungpunkt anfliegen gilt überall, auch in m1–m3; Ankunft am Gegen-Sprungpunkt.
//     Im Tutorial bleibt nur die Zielwahl über Ort-Links (zielwahlUeberOrtLinks), damit kein Ort an einer unbekannten
//     Boje hängt.
//   - Ziele sind Nachbarhexe über bekannte, offene Kanten oder offene temporäre Kanten; Leerraum nur über temporäre Kanten.
//   - Notfallsprung (helm.notsprung): zufällige Kante, bevorzugt in Flugrichtung, nur in spielbare Hexe; Reaktor offline.
//   - Temporäre Sprungpunkte, Bojen, Debug-Hilfen und `space.jp` für den Snapshot.
const Locations = require('../../shared/locations.js');
const Sektoren = require('../../shared/sektoren.js');
const { dist } = require('../util.js');

const JAMMERS = ['raider', 'gunboat'];   // Rostmeute: Störsender blockieren den Faltsprung
const TUTORIAL_MISSIONS = ['m1', 'm2', 'm3'];
const isDown = (st) => st === 'broken' || st === 'offline';
let spaceMod = null;   // lazy wegen Zirkelbezug space -> sprung
const space = () => spaceMod || (spaceMod = require('./space.js'));
const SK = (game) => (game.C && game.C.sektoren) || {};

// ---------- Tutorial (CONTRACT-B3 §0.1, CONTRACT-W1 §4) ----------
// Tutorial läuft: Kampagne mit Tutorial, solange m1–m3 nicht alle erledigt sind; jede Partie ohne Kampagnen-Weltstand
// (Direktstart m3, Testgelände, Golden-Läufe, Tests). Kampagne ohne Tutorial bzw. nach dem Tutorial: läuft nicht.
// Nutzer: zielwahlUeberOrtLinks (hier) und away.js (alter Bodenkampf).
function tutorialLaeuft(game) {
  const ws = game.weltstand;
  if (!ws || !ws.persistent) return true;
  const t = ws.data && ws.data.tutorial;
  if (t === 'uebersprungen' || t === 'erledigt') return false;
  const ms = (game.mission && game.mission.missions) || {};
  return !TUTORIAL_MISSIONS.every((id) => ms[id] && (ms[id].state === 'done' || ms[id].status === 'erledigt'));
}
// Anflug (Sperrgrund, Ankunft am Gegen-Sprungpunkt): gilt immer (E29, Nachtrag W1). Bleibt als Funktion, weil Snapshot
// (ship.jump.anflug), Clients und explore.js danach fragen.
function anflugPflicht(game) { return true; }
// Zielwahl: im Tutorial über Ort-Links wie heute (Boje muss nicht bekannt sein), sonst nach der Hex-Regel (hexGrund)
function zielwahlUeberOrtLinks(game) { return tutorialLaeuft(game); }

// ---------- Hilfen ----------
function hexHier(game) { return Sektoren.hexVonOrt(game.ship.scene); }
// Ziel aus cmd: Ort-ID, 'leer-<hex>' oder Hex-Code -> Ort-ID (bzw. Leerraum-ID); Hex ohne Raumszene -> null
function zielId(dest) {
  if (typeof dest !== 'string') return null;
  if (/^\d{4}$/.test(dest)) return Sektoren.ortVonHex(dest);
  return dest;
}
// Lage des Sprungpunkts der Kante here -> nach in der aktuellen Szene (bzw. in der Szene von `ort`)
function sprungpunkt(game, nachHex, ort) {
  const loc = Locations.get(ort || game.ship.scene); const von = Sektoren.hexVonOrt(ort || game.ship.scene);
  if (!loc || !von || !nachHex) return null;
  return Sektoren.sprungpunktLage(loc.scene.w, loc.scene.h, Sektoren.richtung(von, nachHex), SK(game).randAbstand);
}
// Abstand der Lerche zum Sprungpunkt einer Kante (der aktuellen Szene); null, wenn die Kante nicht hier liegt
function abstandSprungpunkt(game, kanteId) {
  const k = Sektoren.kanteAusId(kanteId); const here = hexHier(game);
  if (!k || !here || (k.a !== here && k.b !== here)) return null;
  const p = sprungpunkt(game, k.a === here ? k.b : k.a);
  return p ? dist(game.ship.x, game.ship.y, p.x, p.y) : null;
}
function amSprungpunkt(game, kanteId) {
  const d = abstandSprungpunkt(game, kanteId);
  return d != null && d <= (SK(game).sprungpunktRadius || 250);
}

// Hex-Regel für ein Ziel (B3 §4 „Ziel wählen“): null = erlaubt, sonst Begründung
function hexGrund(game, here, ziel) {
  const ex = game.explore;
  if (!here || !ziel) return 'Kein Sprungpunkt dorthin.';
  const id = Sektoren.kanteId(here, ziel);
  const e = Sektoren.kante(here, ziel); const temp = ex.tempKante(id);
  if (!Sektoren.spielbar(ziel)) { const t = Sektoren.sperrtext(ziel); return 'Sektor gesperrt' + (t ? ' – ' + t : '.'); }
  if (temp) return null;
  if (!e || e.art === 'hidden' || !Sektoren.sindNachbarn(here, ziel)) {
    if (e && e.art === 'far') return 'Fernsprungpunkt gesperrt.';
    return Sektoren.istLeerraum(ziel) ? 'Leerraum – kein Sprungpunkt dorthin.' : 'Kein Sprungpunkt dorthin.';
  }
  if (e.art === 'far') return 'Fernsprungpunkt gesperrt.';
  if (!ex.bojeBekannt(id)) return 'Kein bekannter Sprungpunkt dorthin – Boje suchen (Weitscan).';
  if (!ex.kanteOffen(id)) { const t = Sektoren.sperrtext(ziel); return t || 'Sprungpunkt gesperrt.'; }
  return null;
}

// ---------- Reisen / Faltsprung (§9.2) ----------
function jammersPresent(game) { return game.space.enemies.some((e) => JAMMERS.includes(e.kind)); }

function updateJump(game, dt) {
  const C = game.C; const ship = game.ship; const j = ship.jump;
  const loc = Locations.get(ship.scene); const sc = loc.scene;
  // B3 Snapshot: Kante des gewählten Ziels und Abstand zu ihrem Sprungpunkt
  const zielHex = j.dest ? Sektoren.hexVonOrt(j.dest) : null; const here = hexHier(game);
  let anflug = null;
  if (zielHex && here) {
    j.jp = Sektoren.kanteId(here, zielHex);
    const p = sprungpunkt(game, zielHex);
    j.d = p ? Math.round(dist(ship.x, ship.y, p.x, p.y)) : null;
    if (p && anflugPflicht(game) && j.d > (SK(game).sprungpunktRadius || 250)) anflug = `Sprungpunkt ${Sektoren.hexName(zielHex)} anfliegen (${j.d} m)`;
  } else { if (j.jp !== undefined) delete j.jp; if (j.d !== undefined) delete j.d; }
  let reason = null;
  if (!j.dest) reason = 'Kein Sprungziel gewählt (Captain, Sternkarte).';
  else if (ship.docked) reason = 'Erst ablegen.';
  else if (isDown(ship.systems.engines)) reason = 'Antrieb ausgefallen – reparieren.';
  else if (ship.power.engines <= 0) reason = 'Antrieb ohne Energie.';
  else if (game.players.some((p) => p.zone === 'away')) reason = 'Außenteam noch unten – erst alle zurückbeamen.';
  else if (game.transfer.isBeaming(game)) reason = 'Transfer läuft.';
  else if (jammersPresent(game)) reason = 'Störsender der Rostmeute – erst die Gegner abwehren.';
  else if (sc.dock && dist(ship.x, ship.y, (sc.station || sc.dock).x, (sc.station || sc.dock).y) < C.travel.jumpMinStationDist) reason = 'Zu nah an der Station (≥ 300).';
  else if (anflug) reason = anflug;
  else {
    const why = game.mission.jumpBlocked(j.dest);
    if (why) reason = why;
  }
  j.blockedReason = reason;
  if (!reason) {
    if (j.charge < 1 && j.charge + dt / C.ship.jumpCharge >= 1) game.missionEvent('jumpReady', {});
    j.charge = Math.min(1, j.charge + dt / C.ship.jumpCharge);
  } else j.charge = Math.max(0, j.charge - dt / C.ship.jumpCharge);
  j.ready = !reason && j.charge >= 1;
}

function doJump(game) {
  const j = game.ship.jump;
  if (!j.ready) return j.blockedReason || 'Sprungantrieb lädt noch.';
  const dest = j.dest;
  if (!Locations.get(dest)) return 'Kein gültiges Sprungziel.';
  const from = game.ship.scene;
  const vonHex = Sektoren.hexVonOrt(from), nachHex = Sektoren.hexVonOrt(dest);
  const pflicht = anflugPflicht(game);
  game.emit('sfx', { name: 'jump' });
  space().enterScene(game, dest, {});
  // B3 §4 Ankunft: am Sprungpunkt der Gegenkante, Blick in Flugrichtung (seit W1 auch im Tutorial)
  if (pflicht && vonHex && nachHex) ankunftAmSprungpunkt(game, vonHex, nachHex);
  game.emit('jump', { scene: dest, location: dest, from });
  game.explore.arrive(dest);
  if (vonHex && nachHex) game.explore.markBoje(Sektoren.kanteId(vonHex, nachHex));   // durchflogen
  game.missionEvent('jumped', { scene: dest, loc: dest, from });
  return null;
}
function ankunftAmSprungpunkt(game, vonHex, nachHex) {
  const p = sprungpunkt(game, vonHex, game.ship.scene);
  if (!p) return;
  const ship = game.ship;
  ship.x = p.x; ship.y = p.y;
  ship.angle = Sektoren.winkel(Sektoren.richtung(vonHex, nachHex));
  freiVonBrocken(game);
}
// Ankunftspunkt frei von Asteroiden (makeAsteroids hält nur arrive/station/dock frei): schrittweise zur Szenenmitte
function freiVonBrocken(game) {
  const ship = game.ship; const sp = game.space;
  const cx = sp.w / 2, cy = sp.h / 2;
  for (let i = 0; i < 30; i++) {
    if (!(sp.asteroids || []).some((a) => dist(ship.x, ship.y, a.x, a.y) < a.r + 70)) return;
    const d = dist(ship.x, ship.y, cx, cy) || 1;
    ship.x = Math.round(ship.x + (cx - ship.x) / d * 40); ship.y = Math.round(ship.y + (cy - ship.y) / d * 40);
  }
}

function selectDest(game, dest) {
  const ex = game.explore;
  const id = zielId(dest);
  if (!id || !Locations.get(id)) {
    if (typeof dest === 'string' && /^\d{4}$/.test(dest) && Sektoren.imRaster(dest)) { const t = Sektoren.sperrtext(dest); return 'Sektor gesperrt' + (t ? ' – ' + t : '.'); }
    return 'Unbekanntes Ziel.';
  }
  if (id === game.ship.scene) return 'Da sind wir doch schon.';
  const here = hexHier(game); const ziel = Sektoren.hexVonOrt(id);
  if (zielwahlUeberOrtLinks(game)) {
    // Tutorial (E29): Ort-Links wie heute (Boje muss nicht bekannt sein); Leerraum/temporäre Kanten nach der Hex-Regel
    const beideOrte = !Sektoren.istLeerId(id) && !Sektoren.istLeerId(game.ship.scene);
    if (!ex.isLinked(game.ship.scene, id)) {
      if (beideOrte && !ex.tempKante(Sektoren.kanteId(here, ziel))) return 'Keine bekannte Route dorthin – erst über einen Nachbarort.';
      const why = hexGrund(game, here, ziel);
      if (why) return why;
    }
  } else {
    const why = hexGrund(game, here, ziel);
    if (why) return why;
  }
  const why = game.mission.destBlocked(id);
  if (why) return why;
  game.ship.jump.dest = id;
  game.emit('sfx', { name: 'jump_charge' });
  game.missionEvent('destSelected', { dest: id });
  return null;
}

// ---------- Notfallsprung (CONTRACT-B3 §4, cmd helm.notsprung) ----------
// Kandidaten: spielbare Nachbarhexe (Saumraum + Leerraum). Aus dem Leerraum nur Nachbarn mit System, sofern es welche
// gibt – so führt der zweite Notfallsprung garantiert hinaus (E30). Gewicht 1 + richtung·max(0, cos(Kurs − Kante)),
// Kurs = Bewegungsrichtung (bzw. Bug bei Stillstand) ± streuung (game.rng, deterministisch).
function notsprungKandidaten(game) {
  const here = hexHier(game);
  if (!here) return [];
  let c = Sektoren.nachbarn(here).filter((h) => Sektoren.spielbar(h) && Sektoren.ortVonHex(h));
  if (Sektoren.istLeerraum(here)) { const sys = c.filter((h) => !Sektoren.istLeerraum(h)); if (sys.length) c = sys; }
  return c;
}
function notsprungGrund(game) {
  const ship = game.ship; const rc = ship.reactorCtl;
  if (isDown(ship.systems.reactor) || (rc && rc.state === 'offline')) return 'Reaktor offline – erst neu starten (Maschinenraum, beide Schalter).';
  if (ship.docked) return 'Erst ablegen.';
  if (game.players.some((p) => p.zone === 'away')) return 'Außenteam noch unten – erst alle zurückbeamen.';
  if (game.transfer && game.transfer.isBeaming(game)) return 'Transfer läuft.';
  return null;
}
function notsprung(game) {
  const why = notsprungGrund(game);
  if (why) return why;
  const N = SK(game).notsprung || {};
  const ship = game.ship; const rng = game.rng;
  const vonOrt = ship.scene; const vonHex = hexHier(game);
  const sp = Math.hypot(ship.vx || 0, ship.vy || 0);
  const kurs = (sp > 20 ? Math.atan2(ship.vy, ship.vx) : ship.angle) + (rng() * 2 - 1) * (Number(N.streuung) || 0);
  const kand = notsprungKandidaten(game);
  let nachHex = null;
  if (kand.length) {
    const gew = kand.map((h) => 1 + (Number(N.richtung) || 0) * Math.max(0, Math.cos(kurs - Sektoren.winkel(Sektoren.richtung(vonHex, h)))));
    let r = rng() * gew.reduce((s, x) => s + x, 0);
    nachHex = kand[kand.length - 1];
    for (let i = 0; i < kand.length; i++) { r -= gew[i]; if (r <= 0) { nachHex = kand[i]; break; } }
  }
  const nachOrt = nachHex ? Sektoren.ortVonHex(nachHex) : vonOrt;
  // Wirkung: Reaktor offline (Neustart über die Schalter), Hülle −huelle (nie unter 1), Sprung
  const rc = ship.reactorCtl;
  if (rc) { rc.state = 'offline'; rc.offlineT = 0; rc.restartProgress = 0; rc.aloneT = 0; rc.overloadLeft = 0; rc.warned = false; }
  ship.hull = Math.max(1, (ship.hull || 0) - (Number(N.huelle) || 0));
  game.emit('sfx', { name: 'jump' });
  game.emit('sfx', { name: 'reactor_down' });
  if (nachOrt !== vonOrt) space().enterScene(game, nachOrt, {});
  else { ship.vx = 0; ship.vy = 0; ship.speed = 0; ship.jump.dest = null; ship.jump.charge = 0; ship.jump.ready = false; }
  // Ankunft ohne Gegenkante: zufällig im mittleren Drittel, Blick in Flugrichtung
  const sc = Locations.get(ship.scene).scene;
  ship.x = Math.round(sc.w / 3 + rng() * sc.w / 3);
  ship.y = Math.round(sc.h / 3 + rng() * sc.h / 3);
  if (nachHex && vonHex) ship.angle = Sektoren.winkel(Sektoren.richtung(vonHex, nachHex));
  freiVonBrocken(game);
  const evt = { von: vonHex, nach: nachHex || vonHex };
  game.emit('notsprung', evt);
  if (nachOrt !== vonOrt) game.explore.arrive(nachOrt);
  game.oda(nachOrt !== vonOrt
    ? `Notfallsprung! Wir sind in ${Sektoren.hexName(nachHex)} (${nachHex}). Reaktor überladen und offline – Neustart: Schalter A und B gleichzeitig halten.`
    : 'Notfallsprung ins Leere – wir sind noch im selben Sektor, nur woanders. Reaktor offline: Schalter A und B gleichzeitig halten.', null);
  game.missionEvent('reactorOffline', {});
  game.missionEvent('notsprung', { von: evt.von, nach: evt.nach, scene: ship.scene });
  return null;
}

// ---------- Temporäre Sprungpunkte und Bojen (Bausteine, CONTRACT-B3 §4/§7) ----------
// opts: { von, nach (Hex oder Ort-ID), temp: bool, bis: 'mission'|'immer' } -> null | Begründung
function oeffnen(game, opts) {
  const o = opts || {}; const ex = game.explore;
  const a = /^\d{4}$/.test(String(o.von)) ? o.von : Sektoren.hexVonOrt(o.von);
  const b = /^\d{4}$/.test(String(o.nach)) ? o.nach : Sektoren.hexVonOrt(o.nach);
  if (!a || !b || !Sektoren.sindNachbarn(a, b)) return 'Kante gibt es nicht (keine Nachbarn).';
  if (!Sektoren.spielbar(a) || !Sektoren.spielbar(b)) return 'Sektor nicht spielbar.';
  const id = Sektoren.kanteId(a, b); const e = Sektoren.kante(id);
  if (e && e.art === 'hidden') return 'Verborgene Kante – in B3 nicht zu öffnen.';
  if (o.temp) {
    if (e && ex.kanteOffen(id)) { ex.markBoje(id); return null; }
    if (ex.tempKante(id)) return null;
    ex.temp.push({ id, a, b, bis: o.bis === 'immer' ? 'immer' : 'mission' });
  } else {
    if (!e) return 'Dauerhaft öffnen nur für Kanten der Karte – sonst temp: true.';
    if (ex.kanteOffen(id)) { ex.markBoje(id); return null; }
    ex.offenExtra.add(id);
    ex.markBoje(id);
  }
  ex.sektorVersion++;
  game.emit('sprungpunktOffen', { kante: id, temp: !!o.temp });
  return null;
}
function schliessen(game, kanteId) {
  const ex = game.explore;
  const i = ex.temp.findIndex((t) => t.id === kanteId);
  let zu = false;
  if (i >= 0) { ex.temp.splice(i, 1); zu = true; }
  if (ex.offenExtra.delete(kanteId)) zu = true;
  if (!zu) return 'Kein geöffneter Sprungpunkt.';
  ex.sektorVersion++;
  if (game.ship.jump.dest && Sektoren.kanteId(hexHier(game) || '', Sektoren.hexVonOrt(game.ship.jump.dest) || '') === kanteId && !ex.kanteOffen(kanteId)) {
    game.ship.jump.dest = null; game.ship.jump.charge = 0; game.ship.jump.ready = false;
  }
  game.emit('sprungpunktZu', { kante: kanteId });
  return null;
}
// Missionsende: temporäre Kanten mit bis 'mission' schließen (ENGINE ruft das am Ende jeder Mission)
function missionEnde(game) {
  for (const t of game.explore.temp.filter((x) => x.bis !== 'immer')) schliessen(game, t.id);
}
function bojeAufdecken(game, kanteId) {
  const e = Sektoren.kante(kanteId);
  if (!e) return 'Kante gibt es nicht.';
  if (e.art === 'hidden') return 'Verborgene Kante – in B3 nicht aufzudecken.';
  if (e.art === 'far') return 'Fernsprungpunkt – in B3 gesperrt.';
  game.explore.markBoje(kanteId);
  return null;
}

// ---------- Snapshot `space.jp` (CONTRACT-B3 §6): bekannte Bojen der Szene, ≤ 6 ----------
function jpSnapshot(game) {
  const ex = game.explore; const here = hexHier(game);
  if (!here) return [];
  const loc = Locations.get(game.ship.scene);
  const out = [];
  // W1 AP2: Die Kante des gewählten Ziels steht immer drin – im Tutorial ist das Ziel über Ort-Links wählbar, ohne dass
  // seine Boje bekannt ist; Ring, Randpfeil und Bots brauchen trotzdem ihre Lage. (Ohne Tutorial setzt selectDest die
  // bekannte Boje ohnehin voraus.)
  const dest = game.ship.jump && game.ship.jump.dest;
  const zielHex = dest ? Sektoren.hexVonOrt(dest) : null;
  for (const n of Sektoren.nachbarn(here)) {
    const id = Sektoren.kanteId(here, n);
    if (!ex.bojeBekannt(id) && n !== zielHex) continue;
    const p = Sektoren.sprungpunktLage(loc.scene.w, loc.scene.h, Sektoren.richtung(here, n), SK(game).randAbstand);
    const z = ex.tempKante(id) ? 'temporaer' : (!Sektoren.spielbar(n) || !ex.kanteOffen(id)) ? 'gesperrt' : 'aktiv';
    out.push({ k: id, x: p.x, y: p.y, z, n });
  }
  return out;
}

// ---------- Weltstand `welt.sektoren` (Block von ENGINE, Inhalt hier/explore.js) ----------
function toSave(game) { return game.explore.sektorenToSave(); }
function restore(game, block, welt) { game.explore.sektorenRestore(block, welt); }

// ---------- Debug (CONTRACT-B3 §6) ----------
function debugHex(game, hex) {
  if (!Sektoren.imRaster(hex)) return 'Hex gibt es nicht.';
  if (!Sektoren.spielbar(hex)) return 'Sektor nicht spielbar.';
  const ort = Sektoren.ortVonHex(hex);
  if (!ort || !Locations.get(ort)) return 'Keine Raumszene.';
  if (game.ship.docked) { game.ship.docked = false; game.ship.dockedAt = null; }
  space().enterScene(game, ort, {});
  game.explore.arrive(ort);
  return null;
}
function debugErkundeAlle(game) {
  const ex = game.explore; const K = Sektoren.KARTE;
  for (const hex of Object.keys(K.hexe)) if (K.hexe[hex].spielbar) ex.erkunde(hex);
  for (const e of K.kanten) if (e.art === 'open' || e.art === 'locked') ex.markBoje(Sektoren.kanteId(e.a, e.b));
  ex.sektorVersion++;
  return null;
}

module.exports = {
  jammersPresent, updateJump, doJump, selectDest, JAMMERS,
  tutorialLaeuft, anflugPflicht, zielwahlUeberOrtLinks, zielId, sprungpunkt, abstandSprungpunkt, amSprungpunkt, hexGrund,
  notsprung, notsprungGrund, notsprungKandidaten, oeffnen, schliessen, missionEnde, bojeAufdecken, jpSnapshot,
  toSave, restore, debugHex, debugErkundeAlle,
};
