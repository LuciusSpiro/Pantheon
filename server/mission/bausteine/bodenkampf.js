'use strict';
// B2 §6/§7 (CONTRACT-B2, Team ENGINE): Bausteine des Bodenkampfs. Laufzeit liegt bei BODENKAMPF (combat.js/squad.js).
//   trupp_geraeumt { map*, tag* }   Prüfung: alle über besetzen { tag } gesetzten Gegner sind aus, bewusstlos, gefesselt
//                                    oder entfernt (Wunsch KATALOG, genehmigt)
//   trupp_ruhig    { map*, tag* }   Prüfung: der Trupp mit diesem Tag ist in Haltung 'ruhig' (Schleichen)
//   team_gefangen  { landepunkt* }  Aktion (W1 AP4): Crew gefangen, Start in der Zelle (combat.teamGefangenNehmen)
// Datenquelle (bevorzugt): combat.truppStatus(game, map, tag) -> { gesetzt: bool, gesamt, aktiv, haltung: 'ruhig'|'wach' }.
// Ersatz, solange es fehlt: Gegner in game.aways[map].drones mit d.tag === tag (Zustand d.zs bzw. alive).
// Fehlt beides, ist die Prüfung false und zählt einmal je Prozess einen Fehler (game.countError).
const RAUS = ['aus', 'bewusstlos', 'gefesselt'];
let gemeldet = false;
function combat() { try { return require('../../sim/combat.js'); } catch (e) { return null; } }
function status(m, map, tag) {
  const g = m.game;
  const C = combat();
  if (C && typeof C.truppStatus === 'function') {
    try { return C.truppStatus(g, map, tag) || null; } catch (e) { g.countError('mission-bodenkampf', e); return null; }
  }
  const aw = g.aways && g.aways[map];
  const list = ((aw && aw.drones) || []).filter((d) => d.tag === tag);
  if (!list.length) {
    if (!gemeldet) { gemeldet = true; g.countError('mission-bodenkampf', new Error('combat.truppStatus fehlt und kein Gegner mit tag ' + tag + ' (BODENKAMPF)')); }
    return null;
  }
  const aktiv = list.filter((d) => d.alive !== false && !RAUS.includes(d.zs || d.zustand)).length;
  const wach = list.some((d) => d.alert || d.haltung === 'wach');
  return { gesetzt: true, gesamt: list.length, aktiv, haltung: wach ? 'wach' : 'ruhig' };
}

module.exports = (Registry) => {
  // W1 AP4 (§5.4 Nr. 2): Gefangennahme ohne Kampf. Gültig im enter eines Schritts (Szenenstart in der Zelle) und als
  // Folge eines Funkduells, solange das Schiff angedockt ist (Prüfer: GEFANGEN-OHNE-DOCK, GEFANGEN-HEIMATHAFEN, Anker
  // zelle + beute auf dem Landepunkt). Typ map: mission.js registriert die Karte vor dem Aufruf (aufKarten).
  Registry.define({ id: 'team_gefangen', art: 'aktion', ereignisse: ['gefangen', 'teamGefangen'],
    beschreibung: 'Crew wird gefangen genommen und kommt in der Zelle des Landepunkts zu sich (ohne Waffen, Ausrüstung am beute-Anker, Zellentür von innen per E halten, laut). Nur im enter eines Schritts oder als Folge eines Funkduells beim Andocken; nicht am Heimathafen',
    params: { landepunkt: { typ: 'map', pflicht: true } },
    run(m, a) {
      const C = combat();
      if (!C || typeof C.teamGefangenNehmen !== 'function') { m.game.countError('mission-bodenkampf', new Error('combat.teamGefangenNehmen fehlt')); return; }
      const err = C.teamGefangenNehmen(m.game, a.landepunkt);
      if (err) m.game.countError('mission-bodenkampf', new Error('team_gefangen: ' + err));
    } });
  Registry.define({ id: 'trupp_geraeumt', art: 'pruefung',
    beschreibung: 'Alle Gegner, die besetzen mit diesem tag gesetzt hat, sind aus dem Gefecht (aus, bewusstlos, gefesselt oder entfernt)',
    params: { map: { typ: 'map', pflicht: true }, tag: { typ: 'string', pflicht: true } },
    test: (m, a) => { const s = status(m, a.map, a.tag); return !!(s && s.gesetzt && s.aktiv === 0); } });
  Registry.define({ id: 'trupp_ruhig', art: 'pruefung',
    beschreibung: 'Der Trupp mit diesem tag ist ruhig (nicht alarmiert) – für Schleich-Ziele',
    params: { map: { typ: 'map', pflicht: true }, tag: { typ: 'string', pflicht: true } },
    test: (m, a) => { const s = status(m, a.map, a.tag); return !!(s && s.gesetzt && s.haltung === 'ruhig'); } });
};
