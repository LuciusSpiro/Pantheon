'use strict';
// TEC-01 E: Aufgabenwahl der Bots für die Komponenten der Schildkette. Eine reine Funktion an EINER Stelle; Schrauber (sim/bots.js), Spieler-Bot (bots/kern.js)
// und der Befehl tech.reparieren (bots/befehle/technik.js) nutzen sie, keiner kopiert die Regeln.
//
// reparaturPlan(game, sys, kontext) -> { aktion: 'flick' | 'swap' | 'minigame', komp: Art } | null
//   null = nichts zu tun (nichts defekt, und in der ruhigen Phase nichts zu tauschen, kein Teil übrig, oder das System hat keine Komponenten).
//   kontext: { druck: Gefecht/Ladung läuft (nur Flicken, schnell), ersatzteile: verfügbare Teile (Lager plus in der Hand), minispiel: der Ausführende kann das Relais-Minispiel spielen
//              (Spieler-Bot ja, Schrauber nein), reserve: Teile, die für die ruhige Tauschrunde NICHT angetastet werden (Standard 0) }.
//
// Regeln (Kai/Leiter): Bots flicken und tauschen alle Komponenten, das Relais ohne Druck per Minispiel (wenn es nicht verschlissen ist, n < Sperre).
//   Defektes geht vor Geflicktem (zerstört -> beschädigt zuerst). Unter Druck: Flicken. Ohne Druck: zerstörtes System mit Teil -> Tausch (zuerst eine Komponente, die kein Minispiel hat
//   oder verschlissen ist, damit das Relais später per Minispiel kostenlos folgt); sonst Relais-Minispiel; sonst Tausch mit Teil; sonst Flicken.
//   Nichts defekt, aber geflickt: nur ohne Druck und nur mit Teilen über der Reserve wird die erste geflickte Komponente getauscht (sonst bricht der Flicken beim Sprung).
//   Die Reihenfolge innerhalb gleicher Güte ist die Rezeptreihenfolge (Generator: Steuerkern, Spannungsregler, Relais).
const Komp = require('./komponenten.js');

const DEFEKT = 'defekt';
const GEFLICKT = 'geflickt';

const TEILE_RESERVE = 1;   // Ersatzteile, die ein beschädigtes oder nur geflicktes System nicht anrühren darf: sie bleiben für ein zerstörtes System

// Gefecht = ein Gegner (außer Relais) ist im Raum
const gefecht = (game) => !!(game.space && game.space.enemies && game.space.enemies.some((e) => e.kind !== 'relay'));
// Kontext aus dem Spielzustand: druck (Standard: Gefecht), Teile im Lager plus eines in der Hand, abzüglich der Reserve (außer das System ist zerstört).
// o: { druck (überschreibt das Gefecht, z. B. Ladung des Gegners), traegtTeil (der Ausführende hält ein Ersatzteil), minispiel }
function kontextFuer(game, sys, o) {
  const opt = o || {};
  const zerstoert = game.ship.systems[sys] === 'broken';
  const lager = (game.inventory && game.inventory.ersatzteil) | 0;
  return { druck: opt.druck == null ? gefecht(game) : !!opt.druck, ersatzteile: Math.max(0, lager + (opt.traegtTeil ? 1 : 0) - (zerstoert ? 0 : TEILE_RESERVE)), minispiel: !!opt.minispiel };
}
// Art der Arbeit für die Reparaturliste (Eintrag mode): Tausch -> 'part', sonst 'flick'; null = nichts zu tun
function listenModus(plan) { return plan ? (plan.aktion === 'swap' ? 'part' : 'flick') : null; }

function zahl(v) { return Math.max(0, Number(v) | 0); }

function reparaturPlan(game, sys, kontext) {
  const lage = Komp.lage(game, sys);
  if (!lage) return null;
  const k = kontext || {};
  const druck = !!k.druck;
  const teile = zahl(k.ersatzteile);
  const defekt = lage.filter((c) => c.z === DEFEKT);
  if (!defekt.length) {
    const geflickt = lage.filter((c) => c.z === GEFLICKT);
    if (druck || !geflickt.length || teile - zahl(k.reserve) <= 0) return null;
    return { aktion: 'swap', komp: geflickt[0].t };
  }
  if (druck) return { aktion: 'flick', komp: defekt[0].t };
  const relaisMinispiel = !!k.minispiel && Komp.minispielMoeglich(game, sys);
  const ohneMinispiel = defekt.filter((c) => !(relaisMinispiel && c.t === Komp.MINISPIEL_ART));
  if (defekt.length >= 2 && teile > 0) return { aktion: 'swap', komp: (ohneMinispiel[0] || defekt[0]).t };
  if (relaisMinispiel && defekt.some((c) => c.t === Komp.MINISPIEL_ART)) return { aktion: 'minigame', komp: Komp.MINISPIEL_ART };
  if (teile > 0) return { aktion: 'swap', komp: defekt[0].t };
  return { aktion: 'flick', komp: defekt[0].t };
}

// Ist ein vorgemerkter Komponentenwunsch (Reparaturliste: Eintrag mit komp) für die Aktion zulässig? aktion 'flick' | 'swap'. Dann gilt er statt der Wahl des Plans.
function wunschZulaessig(game, sys, aktion, komp) {
  const lage = Komp.lage(game, sys);
  const c = lage && lage.find((q) => q.t === komp);
  if (!c) return false;
  return aktion === 'flick' ? c.z === DEFEKT : c.z !== 'ok';
}

module.exports = { reparaturPlan, wunschZulaessig, kontextFuer, listenModus, gefecht, TEILE_RESERVE };
