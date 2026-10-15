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

const JAMMERS = ['raider', 'korvette', 'fregatte', 'kreuzer'];   // Rostmeute: Störsender blockieren den Faltsprung
const TUTORIAL_MISSIONS = ['m1', 'm2', 'm3'];
const isDown = (st) => st === 'broken' || st === 'offline';
let spaceMod = null;   // lazy wegen Zirkelbezug space -> sprung
const space = () => spaceMod || (spaceMod = require('./space.js'));
let reiseMod = null;
const Reise = () => reiseMod || (reiseMod = require('./reise.js'));
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

// EK7: Nachbarorte eines Ortes über offene Kanten der Karte (spielbare Hexe mit Ort, kein Leerraum). Für die Routenplanung der
// Bots über Orte aus Daten (deren `links` bleiben leer, damit LOCATIONS, Snapshot und Tutorial unverändert sind).
function nachbarOrte(game, ort) {
  const here = Sektoren.hexVonOrt(ort);
  if (!here) return [];
  return Sektoren.nachbarn(here).filter((h) => Sektoren.spielbar(h) && !Sektoren.istLeerraum(h) && Sektoren.ortVonHex(h)
    && game.explore.kanteOffen(Sektoren.kanteId(here, h))).map((h) => Sektoren.ortVonHex(h));
}

// Hex-Regel für ein Ziel (B3 §4 „Ziel wählen“): null = erlaubt, sonst Begründung
function hexGrund(game, here, ziel) {
  const ex = game.explore;
  if (!here || !ziel) return 'Kein Sprungpunkt dorthin.';
  const id = Sektoren.kanteId(here, ziel);
  const e = Sektoren.kante(here, ziel); const temp = ex.tempKante(id);
  if (!Sektoren.spielbar(ziel)) { const t = Sektoren.sperrtext(ziel); return 'Sektor gesperrt' + (t ? ' – ' + t : '.'); }
  if (temp) return null;
  if (!e || (e.art === 'hidden' && !ex.kanteEnthuellt(e)) || !Sektoren.sindNachbarn(here, ziel)) {
    if (e && e.art === 'far') return 'Fernsprungpunkt gesperrt.';
    return Sektoren.istLeerraum(ziel) ? 'Leerraum – kein Sprungpunkt dorthin.' : 'Kein Sprungpunkt dorthin.';
  }
  if (e.art === 'far') return 'Fernsprungpunkt gesperrt.';
  if (!ex.bojeBekannt(id)) return 'Kein bekannter Sprungpunkt dorthin – Boje suchen (Weitscan).';
  if (!ex.kanteOffen(id)) { const t = Sektoren.sperrtext(ziel); return t || 'Sprungpunkt gesperrt.'; }
  return null;
}

// Sprungpunkt-Automatik (außerhalb des Tutorials): Wer nah genug an einem nutzbaren Sprungpunkt ist, hat ihn als Ziel – ohne
// Zielwahl des Captains (die Sternkarte bleibt Übersicht und Weg-Hilfe). Die Boje gilt dann als gefunden. Den Sprungpunkt der
// Kante, über die man gerade angekommen ist, ignoriert sie, bis die Lerche ihn einmal verlassen hat (kein Rücksprung aus Versehen).
function autoZiel(game) {
  const ex = game.explore; const here = hexHier(game);
  if (!here) return null;
  const r = SK(game).sprungpunktRadius || 250;
  let best = null;
  // U1 (Kai 2026-10-14): auch temporäre Sprungpunkte zu Hexen ohne Kartenkante (Leerraum, Helix) und enthüllte verborgene Kanten zählen – vorher
  // blieb die Lerche am sichtbaren Sprungpunkt stehen („Kein Sprungpunkt in Reichweite“), weil die Schleife nur über Kartenkanten lief
  for (const other of Sektoren.nachbarn(here)) {
    const id = Sektoren.kanteId(here, other); const e = Sektoren.kante(id);
    if (!ex.tempKante(id) && !(e && (e.art === 'open' || e.art === 'locked' || (e.art === 'hidden' && ex.kanteEnthuellt(e))))) continue;
    const p = sprungpunkt(game, other); if (!p) continue;
    const d = dist(game.ship.x, game.ship.y, p.x, p.y);
    if (game._jumpSperre === id) { if (d > r) game._jumpSperre = null; else continue; }
    if (d > r) continue;
    ex.markBoje(id);
    if (hexGrund(game, here, other)) continue;
    const ort = Sektoren.ortVonHex(other);
    if (!ort || !Locations.get(ort) || game.mission.destBlocked(ort)) continue;
    if (!best || d < best.d) best = { d, ort };
  }
  return best ? best.ort : null;
}
function jumpAutomatik(game) {
  const j = game.ship.jump;
  if (tutorialLaeuft(game)) return;   // Tutorial: Zielwahl wie bisher (m1–m3 fragen danach)
  const a = autoZiel(game);
  if (a) {
    if (j.dest !== a) { j.dest = a; j.charge = 0; j.ready = false; game.missionEvent('destSelected', { dest: a }); }
    game._jumpAuto = true;
  } else if (game._jumpAuto) { game._jumpAuto = false; if (j.dest) { j.dest = null; j.charge = 0; j.ready = false; } }
}

// ---------- Reisen / Faltsprung (§9.2) ----------
function jammersPresent(game) { return game.space.enemies.some((e) => JAMMERS.includes(e.kind)); }

function updateJump(game, dt) {
  const C = game.C; const ship = game.ship; const j = ship.jump;
  const loc = Locations.get(ship.scene); const sc = loc.scene;
  jumpAutomatik(game);
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
  if (!j.dest) reason = tutorialLaeuft(game) ? 'Kein Sprungziel gewählt (Captain, Sternkarte).' : 'Kein Sprungpunkt in Reichweite – Boje am Sektorrand anfliegen.';
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
  if (game.reise) return 'Schnellsprung läuft – Steuer: G bricht ab.';
  if (!j.ready) return j.blockedReason || 'Sprungantrieb lädt noch.';
  const dest = j.dest;
  if (!Locations.get(dest)) return 'Kein gültiges Sprungziel.';
  springeNach(game, dest);
  Reise().nachSprung(game, Sektoren.hexVonOrt(dest));   // eine gewählte Route rückt um einen Hop vor
  return null;
}
// Der Sprung selbst (ein Hop): auch der Schnellsprung (reise.js) springt Hop für Hop darüber – dieselben Ereignisse wie ein natürlicher Sprung
function springeNach(game, dest) {
  const from = game.ship.scene;
  const vonHex = Sektoren.hexVonOrt(from), nachHex = Sektoren.hexVonOrt(dest);
  const pflicht = anflugPflicht(game);
  game._jumpAuto = false;
  if (vonHex && nachHex) game._jumpSperre = Sektoren.kanteId(vonHex, nachHex);   // Gegen-Sprungpunkt der Ankunft: erst verlassen, dann wieder Ziel
  game.emit('sfx', { name: 'jump' });
  space().enterScene(game, dest, {});
  // B3 §4 Ankunft: am Sprungpunkt der Gegenkante, Blick in Flugrichtung (seit W1 auch im Tutorial)
  if (pflicht && vonHex && nachHex) ankunftAmSprungpunkt(game, vonHex, nachHex);
  game.emit('jump', { scene: dest, location: dest, from });
  game.explore.arrive(dest);
  if (vonHex && nachHex) game.explore.markBoje(Sektoren.kanteId(vonHex, nachHex));   // durchflogen
  game.missionEvent('jumped', { scene: dest, loc: dest, from });
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
  if (game.reise) return 'Schnellsprung läuft – Steuer: G bricht ab.';
  let routeDest = null; let routeN = 0;
  const here = hexHier(game); const ziel = Sektoren.hexVonOrt(id);
  if (zielwahlUeberOrtLinks(game)) {
    // Tutorial (E29): Ort-Links wie heute (Boje muss nicht bekannt sein); Leerraum/temporäre Kanten nach der Hex-Regel
    const beideOrte = !Sektoren.istLeerId(id) && !Sektoren.istLeerId(game.ship.scene);
    if (!ex.isLinked(game.ship.scene, id)) {
      if (beideOrte && !ex.tempKante(Sektoren.kanteId(here, ziel))) {
        // nicht nebenan: der erste Hop der Route wird das Sprungziel („erst über einen Nachbarort“), kein Fehlerton
        const hops = Reise().weich(game, here, ziel, true);
        if (!hops || hops.length < 2) return 'Keine bekannte Route dorthin – erst über einen Nachbarort.';
        routeDest = Sektoren.ortVonHex(hops[0]); routeN = hops.length;
      } else {
        const why = hexGrund(game, here, ziel);
        if (why) return why;
      }
    }
  } else {
    const why = hexGrund(game, here, ziel);
    if (why) {   // nicht nebenan: Schnellsprung-Route über erkundete Sektoren (reise.js), erster Hop wird das Sprungziel
      const leer = Sektoren.istLeerId(id);
      const hops = leer ? null : Reise().planen(game, here, ziel);
      if (hops && hops.length >= 2) { game.reisePlan = { ziel: id, hops }; routeDest = Sektoren.ortVonHex(hops[0]); }
      else {   // Ziel oder Zwischensektor noch unerkundet: kein Schnellsprung, aber der nächste Sprung Richtung Ziel wird das Sprungziel
        const weich = leer ? null : Reise().weich(game, here, ziel, false);
        if (!weich || weich.length < 2) return why;
        game.reisePlan = null; routeDest = Sektoren.ortVonHex(weich[0]); routeN = weich.length;
      }
    } else game.reisePlan = null;
  }
  const why = game.mission.destBlocked(routeDest || id);
  if (why) return why;
  if (zielwahlUeberOrtLinks(game)) game.reisePlan = null;
  game.ship.jump.dest = routeDest || id; game._jumpAuto = false;
  game.emit('sfx', { name: 'jump_charge' });
  game.missionEvent('destSelected', { dest: routeDest || id });
  if (routeN) game.oda(`Nächster Sprung: ${Locations.get(routeDest).name} (Weg nach ${Locations.get(id).name}: ${routeN} Sprünge).`, null);
  return null;
}

// ---------- Notfallsprung (CONTRACT-B3 §4, cmd helm.notsprung) ----------
// Kandidaten: spielbare Nachbarhexe (Saumraum + Leerraum). Aus dem Leerraum nur Nachbarn mit System, sofern es welche
// gibt – so führt der zweite Notfallsprung garantiert hinaus (E30). Gewicht 1 + richtung·max(0, cos(Kurs − Kante)),
// Kurs = Bewegungsrichtung (bzw. Bug bei Stillstand) ± streuung (game.rng, deterministisch).
function notsprungKandidaten(game) {
  const here = hexHier(game);
  if (!here) return [];
  let c = Sektoren.nachbarn(here).filter((h) => Sektoren.spielbar(h) && Sektoren.ortVonHex(h)
    && (!Sektoren.istVerborgen(h) || game.explore.kanteOffen(Sektoren.kanteId(here, h)))   // SL1: verborgene Hexe nur über enthüllte Kante
    && !(Sektoren.hexDaten(h) && Sektoren.hexDaten(h).notsprung === false));   // SL3: Hex mit "notsprung": false ist nie Ziel eines Notfallsprungs (z. B. Helix nur über temporären Sprungpunkt)
  // EK7: Solange das Tutorial läuft, führt der Notfallsprung nie aus dem Saumraum hinaus (Statio Limitis grenzt an den Splittergürtel)
  if (tutorialLaeuft(game)) c = c.filter((h) => { const d = Sektoren.hexDaten(h); return !d || d.region === 'saumraum'; });
  // Leerraum oder ein Hex ohne befahrbare Kante (z. B. Bojenfeld vor der Enthüllung): der Notfallsprung führt in ein System (E30), nie tiefer in den Leerraum
  const ohneKante = !Sektoren.kantenVon(here).some((e) => game.explore.kanteOffen(typeof e === 'string' ? e : Sektoren.kanteId(e.a, e.b)));
  if (Sektoren.istLeerraum(here) || ohneKante) { const sys = c.filter((h) => !Sektoren.istLeerraum(h)); if (sys.length) c = sys; }
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
  game.notsprungVon = vonOrt; game.notsprungT = game.time;   // EK2: Baustein rueckzug (Ausgang „Rückzug“ einer Schleichfahrt)
  const evt = { von: vonHex, nach: nachHex || vonHex };
  game.emit('notsprung', evt);
  if (nachOrt !== vonOrt) game.explore.arrive(nachOrt);
  game.oda(nachOrt !== vonOrt
    ? `Notfallsprung! Wir sind in ${Sektoren.hexName(nachHex)} (${nachHex}). Reaktor überladen und offline – Neustart: Schalter A und B halten – gleichzeitig oder nacheinander (der erste rastet ein).`
    : 'Notfallsprung ins Leere – wir sind noch im selben Sektor, nur woanders. Reaktor offline: Schalter A und B halten – gleichzeitig oder nacheinander (der erste rastet ein).', null);
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
  if (e && e.art === 'hidden' && !ex.kanteEnthuellt(e)) return 'Verborgene Kante – erst enthüllen (kanteEnthuellen).';
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
  // U1 (Kai): wer einen Sprungpunkt öffnet, kennt das Ziel mit Namen (Helix stand als „?“ auf der Karte, ohne dass die Crew wusste, wohin)
  for (const hex of [a, b]) { const ort = Sektoren.ortVonHex(hex); if (ort && !Sektoren.istLeerId(ort) && Locations.get(ort)) ex.knowSilently(ort); }
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
  if (e.art === 'hidden' && !game.explore.kanteEnthuellt(e)) return 'Verborgene Kante – erst enthüllen (kanteEnthuellen).';
  if (e.art === 'far') return 'Fernsprungpunkt – in B3 gesperrt.';
  game.explore.markBoje(kanteId);
  return null;
}
// SL1: verborgene Kante enthüllen: ihr Weltstand-Schlüssel wird offen, die Boje gilt als gefunden, die Kante ist befahrbar.
// ref: Kanten-ID ('0603-0602'), Schlüssel der Kante ('altrost-weg') oder { von, nach } (Hexe oder Orte).
// Gespeichert über verbindungen_offen (Weltstand), wirkt auch nach dem Laden. -> null | Begründung
function kanteEnthuellen(game, ref) {
  const ex = game.explore;
  let id = null;
  if (ref && typeof ref === 'object') {
    const a = /^\d{4}$/.test(String(ref.von)) ? ref.von : Sektoren.hexVonOrt(ref.von);
    const b = /^\d{4}$/.test(String(ref.nach)) ? ref.nach : Sektoren.hexVonOrt(ref.nach);
    id = a && b ? Sektoren.kanteId(a, b) : null;
  } else if (typeof ref === 'string') id = ref;
  const alle = ((Sektoren.KARTE && Sektoren.KARTE.kanten) || []).filter((e) => e.art === 'hidden' && (e.key === id || Sektoren.kanteId(e.a, e.b) === id));
  if (!alle.length) return 'Keine verborgene Kante dazu.';
  let neu = false;
  for (const e of alle) {
    if (!e.key) return 'Verborgene Kante ohne Schlüssel (Karte).';
    if (!ex.linksOpen.has(e.key)) { ex.openLink(e.key); neu = true; }
    ex.markBoje(Sektoren.kanteId(e.a, e.b));
    for (const hex of [e.a, e.b]) { const ort = Sektoren.ortVonHex(hex); if (ort && !Sektoren.istLeerId(ort) && Locations.get(ort)) ex.knowSilently(ort); }
  }
  if (!neu) return null;
  ex.sektorVersion++;
  const k = Sektoren.kanteId(alle[0].a, alle[0].b);
  game.emit('kanteEnthuellt', { kante: k, key: alle[0].key });
  game.missionEvent('kanteEnthuellt', { kante: k, key: alle[0].key });
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
  tutorialLaeuft, anflugPflicht, springeNach, zielwahlUeberOrtLinks, zielId, nachbarOrte, sprungpunkt, abstandSprungpunkt, amSprungpunkt, hexGrund,
  notsprung, notsprungGrund, notsprungKandidaten, oeffnen, schliessen, missionEnde, bojeAufdecken, kanteEnthuellen, jpSnapshot,
  toSave, restore, debugHex, debugErkundeAlle,
};
