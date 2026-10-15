'use strict';
// SL11: die Sund-Kette "Die Schuld der Lerche" per Bot (GenericAgent aus sim-headless.js).
//   node tools/sim-sund.js [--weg loesegeld|soeldner|beide] [--crew 1|3] [--seed S] [--kapitel alle|k4_gestrandet] [--von k4_gestrandet] [--verbose]
// Läufe: ganze Kette ab Kapitel 1 (Lobby-Modus schuld_der_lerche) bzw. Labor-Einstieg je Kapitel (--kapitel alle, stoppt nach dem Kapitel).
const Sim = require('./sim-headless.js');
const Kampagne = require('../server/mission/kampagne.js');
const fs = require('fs'), os = require('os'), path = require('path');
const args = process.argv.slice(2);
const argVal = (k, d) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
const log = (...a) => console.log(...a);
const TRACE = args.includes('--trace');

const stepHook = (a, S, p, info) => {
  const fn = HOOKS[info.m.activeId + '/' + info.step.id];
  return fn ? fn(a, S, p, info) : fallback(a, S, p, info);
};
const BEKANNT = /^$a/;   // keine bekannten Befunde mehr (notruf-tor/0706 behoben, T7)
const Away = require('../server/sim/away.js');
const Lpscan = require('../server/sim/lpscan.js');
const Locations = require('../shared/locations.js');
const Fracht = require('../server/sim/fracht.js');
const CONFIG = require('../shared/config.js');
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const tileOf = (v) => Math.floor(v / 32);

// Schritt-Handler der Kette (opts.stepHook): true = der Schritt ist behandelt. Je Kapitel/Schritt eine kleine Funktion; alles, was hier fehlt,
// läuft über die allgemeinen Bot-Pfade (Anflug, Kampf, Ops-Pfade entschlBot/spurBot/personenBot ...).
const HOOKS = {
  // Kap. 1: am Boden mit Evert sprechen, "annehmen"
  'k1_kantenstein/aussenposten'(a, S, p, info) {
    const unten = (a.game.simAgents || []).filter((x) => { const q = x.me(S); return q && q.zone === 'away'; });
    if (!unten.length) {   // Labor-Einstieg: Gruppe an Bord im Orbit -> hinunterbeamen (wie ein Spieler, ohne Scan)
      a.buehneScene(S, p, Object.assign({}, info.step, { allowBeam: ['kantenstein.siedlung'] })); return true;
    }
    if (p.zone !== 'away') { a.idleStations(S, p); return true; }
    if (unten[0] !== a) { a.input(0, 0); return true; }   // einer spricht
    return a.sundGespraech(S, p, 'evert', 'annehmen');
  },
  'k1_kantenstein/aufbruch'(a, S, p) { a.input(0, 0); return true; },
  // Kap. 2: alle hoch, Ops scannt den Landepunkt, personenBot beamt Evert (Fracht), Reise ohne Besonderheiten
  'k2_ueberfahrt/einladen'(a, S, p) {
    if (p.zone === 'away') { a.padsUp(S, p); return true; }
    const g = a.game;
    if (a.is('helm') && S.ship.scene === 'kantenstein') { /* Bahn: Orbit halten, ggf. näher an den Landepunkt */ }
    if (a.is('weapons') && !Lpscan.gescannt(g, 'kantenstein.siedlung') && !g.lpscan) {
      if (a.enter(S, 'weapons')) a.cmd('weapons.landescan');
      return true;
    }
    a.idleStations(S, p); return true;
  },
  // Kap. 2 Ende: am Handelsposten von Pulverhorn an die Station, Ops gibt Evert ab
  'k2_ueberfahrt/abgabe'(a, S, p) {
    if (p.zone === 'away') { a.padsUp(S, p); return true; }
    if (S.ship.scene !== 'pulverhorn') { a.approach(S, p, 'pulverhorn'); return true; }
    const st = a.station(S); const sh = S.ship;
    if (a.is('helm') && st) { if (a.enter(S, 'helm')) { if (dist(sh.x, sh.y, st.x, st.y) > 150) a.steer(S, st.x, st.y, 60); else a.brake(S); } if (!a.is('weapons')) return true; }
    if (a.is('weapons') && sh.speed < 15 && dist(sh.x, sh.y, st.x, st.y) < 200 && (S.fracht && (S.fracht.pers || []).length) && !S.fracht.halt) { if (a.enter(S, 'weapons')) a.cmd('weapons.person_ab'); return true; }
    if (!a.is('helm')) a.idleStations(S, p);
    return true;
  },
  // Kap. 3: Notfallsprung (Helm) – Gegenwehr hat die Lerche gegen Kreuzer + Korvetten + Jäger nicht
  'k3_falle/falle'(a, S, p) {
    if (p.zone === 'away') { a.padsUp(S, p); return true; }
    if (a.is('helm')) { if (a.enter(S, 'helm') && S.time - (a.memo.falleT0 || (a.memo.falleT0 = S.time)) > 8) a.cmd('helm.notsprung'); return true; }
    a.idleStations(S, p); return true;
  },
  // Kap. 7a Gasfeld: Helm fliegt in die Schöpfschicht (0,8 Planetenradius) und hält dort, bis Deuterium an Bord ist, dann hinaus. Ops hält Systeme (Reaktor-Pflicht allgemein).
  // U2: Navigation (Helm) hält die Höhe in der Förderschicht (Antrieb VOLL, Kurs radial nach außen + Querhalt, sodass die Radialfahrt den Zug ausgleicht),
  // Ops STARTET das Schöpfen (weapons.schoepfen; nichts füllt sich von selbst) und beobachtet es, Captain/Technik halten Station. Ist eine Einheit an Bord:
  // auftauchen (Sprung nach Concordia; wer die Hülle verliert, wird vom Notfallprotokoll hinausgeworfen und beginnt von vorn).
  'sl_gasriese/schoepfen'(a, S, p) {
    if (p.zone === 'away') { a.padsUp(S, p); return true; }
    const g = a.game; const sh = S.ship;
    const pl = (Locations.get('gasfeld').scene.planeten || []).find((q) => q.art === 'gasriese');
    const voll = Fracht.anBord(g, 'deuterium') >= 1;
    const d = pl ? dist(sh.x, sh.y, pl.x, pl.y) : 0;
    if (TRACE && a.is('helm') && S.time - (a.memo.trT || 0) > 10) { a.memo.trT = S.time; log(`  [trace ${S.time.toFixed(0)}] schoepfen pos ${Math.round(sh.x)},${Math.round(sh.y)} planet ${pl && pl.x},${pl && pl.y},${pl && pl.r} d ${pl && Math.round(d)} v ${Math.round(sh.speed)} hülle ${Math.round(sh.hull)} deut ${Fracht.anBord(g, 'deuterium')} halt ${g.fracht && g.fracht.halt && g.fracht.halt.kind} kons ${p.console} stufe ${sh.helm.stage} zonen ${JSON.stringify((S.zonen && S.zonen.i) || null)}`); }
    // Eine Einheit genügt (jede Ladung nimmt 15 % Antrieb, bei zwei Einheiten hält Energie 2 die Höhe nicht mehr): die Ops beendet das Schöpfen
    if (voll && (a.role === 'weapons' || a.role === 'solo') && g.fracht && g.fracht.halt && g.fracht.halt.kind === 'schoepf') { if (a.enter(S, 'weapons')) a.cmd('weapons.schoepfen', { off: true }); return true; }
    if (voll && pl && d < pl.r * 2.05 && a.is('helm')) {   // Auftauchen: erst aus der Atmosphäre (Antrieb VOLL, schräg nach außen Richtung Süden, wo die Sprungpunkte liegen), dann der normale Weg
      if (!a.enter(S, 'helm')) return true;
      const ang = Math.atan2(sh.y - pl.y, sh.x - pl.x);
      let dw = Math.PI / 2 - ang; while (dw > Math.PI) dw -= 2 * Math.PI; while (dw < -Math.PI) dw += 2 * Math.PI;
      const at = ang + Math.max(-1.0, Math.min(1.0, dw));
      const tx = pl.x + Math.cos(at) * pl.r * 2.2, ty = pl.y + Math.sin(at) * pl.r * 2.2;
      let ziel = Math.atan2(ty - sh.y, tx - sh.x);
      if (d < pl.r * 1.1) ziel = ang + 0.25;   // noch in der Förderschicht (Zug 72, tiefer tödlich): erst radial nach außen aufsteigen, nicht quer durch die Ringe
      let diff = ziel - sh.angle; while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
      a.helmS(S, a.turnCmd(S, diff), sh.helm.stages.length - 1);
      return true;
    }
    if (voll) { a.travel(S, p, 'concordia'); return true; }   // auftauchen = den Ort verlassen (Sprung nach Concordia; Captain wählt, Helm fliegt)
    if (!pl) { a.idleStations(S, p); return true; }
    const foerder = d > pl.r * 0.62 && d < pl.r * 1.03;
    const laeuft = !!(g.fracht && g.fracht.halt && g.fracht.halt.kind === 'schoepf');
    // Solo (eine Person, eine Konsole): Kurs setzen, an die Ops wechseln und schöpfen, solange das Schiff geradeaus in der Schicht bleibt; dann zurück ans Steuer
    // (das Schöpfen läuft auch ohne besetzte Ops weiter: solo startet die Ops es und geht zurück ans Steuer)
    // Solo wechselt erst, wenn das Schiff mit VOLL im inneren Teil der Schicht steht (die unbesetzte Steuer fliegt geradeaus weiter und steigt dabei nach außen)
    const soloStart = a.role === 'solo' && foerder && !laeuft && !(g.fracht && g.fracht.halt) && Fracht.frei(g) > 0 && d < pl.r * 0.78 && sh.helm.stage === sh.helm.stages.length - 1;
    if (a.role === 'weapons' || soloStart || (a.role === 'solo' && p.console === 'weapons' && !laeuft && foerder && Fracht.frei(g) > 0)) {
      a.keepStage = a.role === 'solo';   // die Steuer behält VOLL, während die Ops (solo derselbe Spieler) das Schöpfen startet
      if (!a.enter(S, 'weapons')) return true;
      if (foerder && !(g.fracht && g.fracht.halt) && Fracht.frei(g) > 0) a.cmd('weapons.schoepfen');
      return true;
    }
    if (!a.is('helm')) { a.idleStations(S, p); return true; }
    a.keepStage = false;
    if (!a.enter(S, 'helm')) return true;
    const ang = Math.atan2(sh.y - pl.y, sh.x - pl.x);
    // Anflug in die Förderschicht: schräg (Zielpunkt 0,7 rad vor dem Ort auf dem Ring), damit das Schiff nicht mit Kurs auf die Mitte eintaucht (Zug + Antrieb = Absturz)
    if (d > pl.r * 1.0) { a.steer(S, pl.x + Math.cos(ang + 0.7) * pl.r * 0.9, pl.y + Math.sin(ang + 0.7) * pl.r * 0.9, 30, 80); return true; }
    // Höhe halten: Radialgeschwindigkeit = Zug + Korrektur zum Soll-Ring (0,82 r); Kurs = radial nach außen, um acos(Radial/Höchsttempo) im Uhrzeigersinn gedreht
    const Zonen = require('../shared/zonen.js'); const zug = Zonen.wirkung(require('../server/sim/zonen.js').szeneZonen(g), sh.x, sh.y).zug;
    const vmax = (sh.helm.stages[sh.helm.stages.length - 1] || 130) * (sh.helm.speedFactor || 1);
    const radial = zug + (pl.r * (a.role === 'solo' && !laeuft ? 0.72 : 0.82) - d) * 0.6;
    const th = Math.acos(Math.max(-0.2, Math.min(0.97, radial / Math.max(20, vmax))));
    let diff = ang + th - sh.angle; while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
    a.helmS(S, a.turnCmd(S, diff), sh.helm.stages.length - 1);
    return true;
  },
  // Kap. 7a Verkauf in Concordia: an die Station, Ops verkauft
  'sl_gasriese/verkauf'(a, S, p) {
    if (p.zone === 'away') { a.padsUp(S, p); return true; }
    const g = a.game; const sh = S.ship; const st = a.station(S);
    if (!st) { a.idleStations(S, p); return true; }
    const nah = dist(sh.x, sh.y, st.x, st.y) < 200 && sh.speed < 15;
    if (a.is('helm') && !nah) { if (a.enter(S, 'helm')) { if (dist(sh.x, sh.y, st.x, st.y) > 150) a.steer(S, st.x, st.y, 60); else a.brake(S); } if (!a.is('weapons')) return true; }
    if (a.is('weapons') && nah && Fracht.anBord(g, 'deuterium') > 0) { if (a.enter(S, 'weapons')) a.cmd('weapons.verkaufen'); return true; }
    if (!a.is('helm') || nah) a.idleStations(S, p);
    return true;
  },
  // Kap. 4 Finden: kein Weg nach Concordia (Notfallsprung hat in den Leerraum/Bojenfeld geführt, E30) -> zweiter Notfallsprung (Helm), wie im Spiel vorgesehen
  'k4_gestrandet/finden'(a, S, p, info) {
    if (S.ship.scene === 'concordia' || p.zone !== 'ship' || S.ship.docked) return fallback(a, S, p, info);
    if (S.ship.scene === 'bojenfeld' || (a.game.simStats.noRoute && a.game.simStats.noRoute.from === S.ship.scene)) {
      if (a.is('helm') && a.enter(S, 'helm')) { (a.game.simStats.befunde = a.game.simStats.befunde || {}).k4Leerraum = S.ship.scene; a.cmd('helm.notsprung'); }
      return true;
    }
    return fallback(a, S, p, info);
  },
  // Kap. 8: nach Concordia und andocken (die Wahl kommt im Schritt "entscheidung")
  'k8_entscheidung/anflug'(a, S, p) { return anDocken(a, S, p, 'concordia'); },
  // Kap. 8: Wahl nach opts.weg; ist die Option gesperrt (zu wenig Marken), "nachverdienen" – ehrlich, kein Ersatzweg
  'k8_entscheidung/entscheidung'(a, S, p) {
    const ch = S.mission.choice;
    if (!ch) return false;
    if (!a.is('captain') || p.zone !== 'ship') { a.idleStations(S, p); return true; }
    if (a.role === 'solo' && p.console === 'helm' && !a.brake(S)) return true;
    if (!a.enter(S, 'captain') || (a.memo.choiceAt || 0) > S.time) return true;
    a.memo.choiceAt = S.time + 1;
    const frei = ch.options.filter((o) => !o.disabled).map((o) => o.id);
    const opt = frei.includes(a.opts.weg) ? a.opts.weg : 'nachverdienen';
    a.cmd('captain.choice', { option: opt });
    (a.game.simStats.choices || (a.game.simStats.choices = [])).push({ mission: 'k8_entscheidung', id: ch.id, option: opt });
    return true;
  },
  // Kap. 9B: Söldner-Kontakt in Concordia andocken; Schlacht über die allgemeinen Kampfpfade
  'k9b_soeldner/kontakt'(a, S, p) { return S.mission.choice ? false : anDocken(a, S, p, 'concordia'); },
  // Kap. 9B Lager: Ops scannt das Lager, Team beamt hinunter, holt Evert (folgt), zurück zu den Pads. Gebaute Karte wie die Labor-Szenen (buehneScene).
  'k9b_soeldner/lager'(a, S, p, info) { return lagerEinsatz(a, S, p, info, 'schrottkante.lager'); },
  // ABKÜRZUNGEN (benannt, im Bericht gezählt): Szenen, die ein eigener Bot (tools/sl-bots.js, T4) einzeln spielt, in der Kette per forceStep
  'sl_forschung/gravimetrie'(a, S, p) { return abkuerzung(a, 'sl_forschung', 'gravimetrie', 'station'); },
  'sl_forschung/station'(a, S, p) { return abkuerzung(a, 'sl_forschung', 'station', 'rueckbeamen'); },
  'sl_forschung/finale'(a, S, p) { return abkuerzung(a, 'sl_forschung', 'finale', 'abliefern_anflug'); },
  // Boje: Buch-Skip (Zähler 100 = Energie voll), Adresse/Feld bleiben echte Spielzustände; Schiff steht im Feld, danach läuft die Boje von selbst
  'k10_boje/boje'(a, S, p) {
    if (!a.opts.abkuerzungen) return false;
    const g = a.game; const sc = Locations.get('bojenfeld').scene;
    if (a.idx !== 0) return true;
    const ab = g.simStats.abkuerzungen || (g.simStats.abkuerzungen = []);
    if (!ab.includes('k10_boje/boje')) ab.push('k10_boje/boje (Skip: Energiezähler; Adresse und Feld nicht gespielt)');
    if (sc.bojeFeld && dist(g.ship.x, g.ship.y, sc.bojeFeld.x, sc.bojeFeld.y) > 120) { g.ship.x = sc.bojeFeld.x + 30; g.ship.y = sc.bojeFeld.y; g.ship.vx = 0; g.ship.vy = 0; }
    if ((a.memo.bskip || 0) < g.time) { a.memo.bskip = g.time + 2; g.mission.skip(); }
    return true;
  },
  // Nachverdienen (T7): kein Skip mehr. Wie der ODA-Hinweis sagt, wiederholt der Bot das Gasfeld (freies Farmen, ohne Buch) und verkauft in Concordia,
  // bis die Marken für den gewählten Weg reichen; danach laufen die normalen Pfade (Rückflug nach Schrottkante bzw. Concordia).
  'k8_entscheidung/nachverdienen'(a, S, p) { return farmGeld(a, S, p, a.opts.weg === 'soeldner' ? 'soeldner' : 'loesegeld'); },
  // Kap. 7 frei: beide Pflichtaufträge erledigt, aber das Geldziel fehlt (z. B. nach einem Notfallprotokoll im Gas, −50 Marken): Gasfeld weiter farmen
  'k7_geld/frei'(a, S, p, info) {
    const fl = a.game.mission.flags || {};
    if (fl.gasVerkauft && fl.forschungFertig && farmGeld(a, S, p, 'geldziel')) return true;
    return fallback(a, S, p, info);
  },
  'k9a_uebergabe/nachverdienen'(a, S, p) { return farmGeld(a, S, p, 'loesegeld'); },
  'k9b_soeldner/nachverdienen'(a, S, p) { return farmGeld(a, S, p, 'soeldner'); },
  // Kap. 7: Hub. Erst Gasfeld, dann Forschungsstation, sonst "frei" (Geld per Notruf/Warten)
  'k7_geld/wahl'(a, S, p) {
    const ch = S.mission.choice;
    if (!ch) { a.idleStations(S, p); return true; }
    if (!a.is('captain') || p.zone !== 'ship') { a.idleStations(S, p); return true; }
    if (a.role === 'solo' && p.console === 'helm' && !a.brake(S)) return true;
    if (!a.enter(S, 'captain') || (a.memo.choiceAt || 0) > S.time) return true;
    a.memo.choiceAt = S.time + 1;
    const fl = a.game.mission.flags || {};
    const ok = ch.options.filter((o) => !o.disabled).map((o) => o.id);
    const opt = !fl.gasVerkauft && ok.includes('gas') ? 'gas' : !fl.forschungFertig && ok.includes('forschung') ? 'forschung' : 'frei';
    a.cmd('captain.choice', { option: opt });
    (a.game.simStats.choices || (a.game.simStats.choices = [])).push({ mission: 'k7_geld', id: ch.id, option: opt });
    return true;
  },
};
// Benannte Abkürzung: Schritt per forceStep überspringen (nur, wenn kein echter Bot-Handler in sim-headless dafür existiert)
function abkuerzung(a, buch, von, nach) {
  const g = a.game; const ab = g.simStats.abkuerzungen || (g.simStats.abkuerzungen = []);
  if (!a.opts.abkuerzungen) return false;
  if (a.idx !== 0) return true;
  if (!ab.includes(buch + '/' + von)) { ab.push(buch + '/' + von); g.mission.forceStep(buch, nach); }
  return true;
}
// Freies Gasfeld-Farmen (kein Buch): eine Einheit schöpfen (wie der Bot in 7a), in Concordia verkaufen, wiederholen, bis Marken >= posten.
// -> true (beschäftigt) | false (Geld reicht, allgemeine Pfade übernehmen)
function farmGeld(a, S, p, posten) {
  const g = a.game; const need = Number(CONFIG.campaign.sund[posten]);
  if (g.inventory.marks >= need) return false;
  if (p.zone === 'away') { a.padsUp(S, p); return true; }
  if (S.space.enemies.length) { a.combatGeneric(S, p); return true; }
  const n = Fracht.anBord(g, 'deuterium');
  if (n >= 1 && S.ship.scene !== 'gasfeld') {
    if (S.ship.scene !== 'concordia') { a.travel(S, p, 'concordia'); return true; }
    return HOOKS['sl_gasriese/verkauf'](a, S, p);
  }
  if (S.ship.scene !== 'gasfeld') { a.travel(S, p, 'gasfeld'); return true; }
  return HOOKS['sl_gasriese/schoepfen'](a, S, p);
}
// Hinfliegen und andocken (Helm); die übrigen halten Station. false, wenn schon angedockt (der allgemeine Pfad nimmt Funk/Wahl an)
function anDocken(a, S, p, loc) {
  if (S.mission.choice || (S.mission.radio && S.mission.radio.needsAccept)) return false;
  if (S.space.enemies.length) { a.combatGeneric(S, p); return true; }
  if (S.ship.docked && S.ship.dockedAt === loc) return false;
  if (p.zone === 'away') { a.padsUp(S, p); return true; }
  if (S.ship.scene !== loc) { a.approach(S, p, loc); return true; }
  if (a.is('helm')) { a.dock(S, p, loc); return true; }
  a.idleStations(S, p); return true;
}
// Landepunkt-Einsatz mit Person (Evert am Boden): Scan (Ops), hinunter, Person holen, hoch. Nutzt buehneScene mit einem synthetischen Schritt.
function lagerEinsatz(a, S, p, info, lp) {
  const g = a.game;
  if (TRACE && a.idx === 0 && S.time - (a.memo.trT || 0) > 10) { a.memo.trT = S.time; log(`  [trace ${S.time.toFixed(0)}] lager scan ${Lpscan.gescannt(g, lp)} lpscan ${!!g.lpscan} zonen ${S.players.map((q) => q.zone + ':' + (q.console || '-')).join(' ')} schiff ${Math.round(S.ship.x)},${Math.round(S.ship.y)} v${Math.round(S.ship.speed)} ziel ${JSON.stringify(g.transferZiel)} feinde ${S.space.enemies.length} beam ${JSON.stringify(a.lpBeam(lp))} ziele ${JSON.stringify(Lpscan.ziele(g))} notices ${JSON.stringify(S.players.length ? (g.simAgents || []).map((x) => x.notices.slice(-2)) : 0)}`); }
  if (p.zone === 'ship' && a.is('weapons') && !Lpscan.gescannt(g, lp) && !S.space.enemies.length) {   // Scan: Ops bleibt an der Konsole, bis er fertig ist (Weggehen bricht ab)
    if (a.enter(S, 'weapons') && !g.lpscan && Lpscan.ziele(g).length) a.cmd('weapons.landescan');
    return true;
  }
  // Die Ops bleibt an Bord: sie beamt Evert vom Landepunkt hoch (personenBot, Fracht), wie in Kap. 2
  if (p.zone === 'ship' && a.role === 'weapons' && Lpscan.gescannt(g, lp)) { a.enter(S, 'weapons'); return true; }
  const step = Object.assign({}, info.step, { allowBeam: [lp], objectives: [{ id: 'evert', done: { check: { name: 'person_rescued', map: lp, person: 'evert' } } }] });
  a.buehneScene(S, p, step);
  return true;
}
// Fallback für Schritte ohne Umsetzung: Ziel "atLocation" anfliegen (Reise), sonst nichts Besonderes (Zeit-/Ereignis-Schritte laufen allein)
function fallback(a, S, p, info) {
  const st = info.step;
  if (st.umsetzung) return false;
  if (S.mission.choice || (S.mission.radio && S.mission.radio.needsAccept)) return false;   // Funk annehmen / Wahl: allgemeiner Pfad
  if (p.zone === 'away') { a.padsUp(S, p); return true; }   // Schritte ohne Umsetzung spielen am Schiff (Rückbeamen)
  const loc = a.anflugLoc(st);
  if (loc && S.ship.scene !== loc) { a.approach(S, p, loc); return true; }
  const dk = (st.objectives || []).find((o) => o.done && typeof o.done.docked === 'string');
  if (dk) {   // Hafen-Schritt: andocken (Helm), die übrigen stehen auf Station
    if (S.space.enemies.length) { a.combatGeneric(S, p); return true; }
    if (S.ship.docked && S.ship.dockedAt === dk.done.docked) return false;
    if (p.zone === 'away') { a.padsUp(S, p); return true; }
    if (S.ship.scene !== dk.done.docked) { a.approach(S, p, dk.done.docked); return true; }
    if (a.is('helm')) { a.dock(S, p, dk.done.docked); return true; }
    a.idleStations(S, p); return true;
  }
  return false;
}

function installHelpers(GA) {
  // Gespräch am Boden: zur Person gehen, E tippen, Zeilen weiterklicken, Option wählen. -> true (beschäftigt)
  GA.prototype.sundGespraech = function (S, p, person, opt) {
    const g = this.game;
    if (S.gp) {
      if ((this.memo.gpAt || 0) > S.time) return true;
      this.memo.gpAt = S.time + 0.4;
      if (S.gp.w) this.cmd('gespraech.pick', { opt }); else this.cmd('gespraech.next');
      return true;
    }
    const n = Away.personMit(g.away, person);
    if (!n || !n.present) { this.input(0, 0); return true; }
    this.interact(S, tileOf(n.x), tileOf(n.y), {});
    return true;
  };
}

// Speichern und Laden an jedem Kapitelübergang: beim Wechsel des Kapitels (Fakt kapitel) kurz warten, Weltstand speichern, in einem zweiten Game aus
// demselben Ordner fortsetzen und prüfen (Karte, Kapitel, laufende Mission, Flags). Der Bot spielt im ersten Game weiter.
function ladePruefung(dir) {
  const { Game } = require('../server/game.js');
  const Welt = require('../server/sim/welt.js');
  const os = require('os');
  const st = { last: null, due: null, bad: 0 };
  return (g, res) => {
    const k = g.weltstand && g.weltstand.data && g.weltstand.data.fakten.kapitel;
    const list = res.saveLoad || (res.saveLoad = []);
    if (k && k !== st.last) { st.last = k; st.due = g.time + 0.7; }
    if (st.due == null || g.time < st.due) return;
    st.due = null;
    const eintrag = { kap: k, ok: false, info: '' };
    list.push(eintrag);
    try {
      const r = g.saveWorld('sim-sund', { sync: true });
      if (!r || !r.ok) { eintrag.info = 'Speichern abgelehnt ' + JSON.stringify(r && r.error || r); return; }
      const id = g.weltstand.id; const flags0 = JSON.stringify(g.mission.flags || {});
      const mission0 = g.mission.activeId;
      g.releaseWorldLock();
      Welt.waehle(null, 'limes');
      const h = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(os.tmpdir(), 'pantheon-regie-bots') }, log: () => {} });
      const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
      h.addConnection(c); h.handleMessage(c, { t: 'hello', clientId: 'L0', name: 'Lade', color: 0 });
      h.handleMessage(c, Object.assign({ t: 'lobbyOpt' }, { world: id }));
      h.handleMessage(c, { t: 'ready', ready: true });
      for (let i = 0; i < 60; i++) h.step();
      const k2 = h.weltstand && h.weltstand.data.fakten.kapitel;
      const mission1 = h.mission.activeId;
      const flags1 = JSON.stringify(h.mission.flags || {});
      eintrag.ok = h.phase === 'play' && h.weltId === 'sund' && k2 === k && (!mission0 || mission1 === mission0 || !!mission1) && !Object.keys(h.errorLog || {}).length;
      eintrag.info = `phase ${h.phase} welt ${h.weltId} kapitel ${k2} mission ${mission0}->${mission1}${flags0 === flags1 ? '' : ' flags abweichend'}`;
      h.releaseWorldLock();
      Welt.waehle(null, 'sund');
    } catch (e) { eintrag.info = 'Ausnahme ' + e.message; }
    if (!eintrag.ok) st.bad++;
  };
}

// Optionen für Speichern/Laden (Weltstand-Ordner je Lauf); --ohne-laden schaltet es ab
function laden() {
  if (args.includes('--ohne-laden')) return {};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sund-'));
  return { gameOpts: { worlds: true, worldSaveSync: true, worldDir: dir, debug: true }, tickHook: ladePruefung(dir) };
}

async function main() {
  installHelpers(Sim.GenericAgent);
  const doc = Kampagne.laden('schuld-der-lerche');
  const wege = argVal('--weg', 'beide') === 'beide' ? ['loesegeld', 'soeldner'] : [argVal('--weg', 'loesegeld')];
  const crews = argVal('--crew', null) ? [Number(argVal('--crew'))] : [3];
  const seed = Number(argVal('--seed', 1));
  const kap = argVal('--kapitel', null), von = argVal('--von', null);
  const jobs = [];
  if (kap) for (const c of doc.kapitel) { if (kap === 'alle' || kap === c.id) jobs.push({ label: 'Einstieg ' + c.id, einstieg: c.id, stopNach: Kampagne.buecherVon(c).slice(-1)[0], weg: /^k9b/.test(c.id) ? 'soeldner' : 'loesegeld' }); }
  else for (const weg of wege) jobs.push({ label: 'Kette ' + (von ? 'ab ' + von : 'komplett') + ' Weg ' + weg, einstieg: von, stopNach: null, weg });
  const rows = []; let bad = 0;
  for (const crew of crews) for (const j of jobs) {
    const t0 = Date.now();
    const r = await Sim.runGeneric({ seed, crew, mode: 'kette', start: 'schuld_der_lerche', einstieg: j.einstieg, stopNach: j.stopNach, weg: j.weg, abkuerzungen: !args.includes('--ohne-abkuerzung'), stepHook, stepLimit: () => 1500, pilot: 'maneuver', maxSec: j.stopNach ? 5000 : 30000, missionMax: 4000, funk: 'a', notrufeBot: null, ...laden(j) });
    r.befunde = r.errList.filter((e) => BEKANNT.test(e)); r.errors -= r.befunde.length;
    const gut = !r.aborted && !r.errors && (j.stopNach ? (r.stopNach === j.stopNach || r.ende) : r.ende);
    if (!gut) bad++;
    rows.push({ j, crew, r, gut, wall: Date.now() - t0 });
    Sim.printGenericRun(r, j.label + ' Crew ' + crew);
    if (r.sim.abkuerzungen && r.sim.abkuerzungen.length) log('  ABKÜRZUNGEN (forceStep): ' + r.sim.abkuerzungen.join(', '));
    for (const s of r.saveLoad || []) { if (!s.ok) bad++; if (!s.ok || args.includes('--verbose')) log(`  Speichern/Laden ${s.kap}: ${s.ok ? 'ok' : 'FEHL'} ${s.info}`); }
    if (r.saveLoad && r.saveLoad.length) log(`  Speichern/Laden an ${r.saveLoad.length} Kapitelübergängen, ${r.saveLoad.filter((s) => s.ok).length} ok`);
    if (r.befunde.length) log('  BEFUND (bekannt): ' + [...new Set(r.befunde)].join(' | '));
  }
  log('\n| Lauf | Crew | Ergebnis | Spielzeit (min) | Wand (s) | Kapitel |');
  log('|---|---|---|---|---|---|');
  for (const x of rows) log(`| ${x.j.label} | ${x.crew} | ${x.gut ? 'ok' : 'FEHL' + (x.r.aborted ? ' (' + x.r.aborted + ')' : '')} | ${Sim.fmtMin(x.r.gameTime)} | ${(x.wall / 1000).toFixed(0)} | ${x.r.missions.map((m) => m.id.split('_')[0] + (m.skips ? ' skip' + m.skips.length : '') + (m.success ? '' : ' offen')).join(', ')} |`);
  log(bad ? '\nSIM SUND FEHLGESCHLAGEN (' + bad + ')' : '\nSIM SUND OK');
  return bad;
}
main().then((bad) => process.exit(bad ? 1 : 0), (e) => { console.error(e); process.exit(2); });
