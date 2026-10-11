'use strict';
// B2 §6/§7 (CONTRACT-B2, Team ENGINE): Bausteine des Bodenkampfs. Laufzeit liegt bei BODENKAMPF (combat.js/squad.js).
//   trupp_geraeumt { map*, tag* }   Prüfung: alle über besetzen { tag } gesetzten Gegner sind aus, bewusstlos, gefesselt
//                                    oder entfernt (Wunsch KATALOG, genehmigt)
//   trupp_ruhig    { map*, tag* }   Prüfung: der Trupp mit diesem Tag ist in Haltung 'ruhig' (Schleichen)
//   team_gefangen  { landepunkt* }  Aktion (W1 AP4): Crew gefangen, Start in der Zelle (combat.teamGefangenNehmen)
//   besetzen_paare   { map*, fraktion*, tag*, gruppen*, groesse?, max? }  Aktion (EK5): Zweiergruppen auf Patrouille (combat.besetzenPatrouillen), höchstens max (8) Gegner gleichzeitig
//   nachschub_baracken { map*, fraktion*, tag*, gruppen*, groesse?, max? } Aktion (EK5): Nachschub aus den Baracken ohne Alarm (combat.nachschubBaracken), gleiche Obergrenze
//   angriff_starten { map*, fraktion*, tag*, gegner?, boss? }  Aktion (EK6): einmalig 10 Gegner und ein Anführer verteilt um den Flaggenpunkt, alle wach (endkampf.angriffStarten)
//   gegner_abziehen { map*, tag? }  Aktion (EK6): Sieg – alle Gegner beamen raus (endkampf.gegnerAbziehen)
//   boss_besiegt   { map*, tag? }   Prüfung (EK6): der Anführer des Angriffs steht nicht mehr
//   crew_gefallen  { map* }         Prüfung (EK6): Notrückholung der Crew während des Angriffs (die Szene setzt die Siedlung zurück)
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
  // EK5 (Methalle): Zweiergruppen. Die Obergrenze zählt alle Gegner der Karte, nicht nur die dieses tag.
  const paarParams = { map: { typ: 'map', pflicht: true }, fraktion: { typ: 'string', pflicht: true }, tag: { typ: 'string', pflicht: true },
    gruppen: { typ: 'number', pflicht: true, min: 1, max: 4 }, groesse: { typ: 'number', min: 1, max: 3 }, max: { typ: 'number', min: 2, max: 8 } };
  const paarLauf = (fn) => (m, a) => {
    const C = combat();
    if (!C || typeof C[fn] !== 'function') { m.game.countError('mission-bodenkampf', new Error('combat.' + fn + ' fehlt')); return; }
    C[fn](m.game, { map: a.map, fraktion: a.fraktion, tag: a.tag, gruppen: a.gruppen, groesse: a.groesse || 2, max: a.max || 8 });
  };
  Registry.define({ id: 'besetzen_paare', art: 'aktion', effekt: 'gegner', ereignisse: ['squadSpawn'],
    beschreibung: 'Außenkarte mit Zweiergruppen auf Patrouille besetzen (Anfang eines Patrouillenwegs je Gruppe, ruhig). Höchstens max (8) Gegner gleichzeitig auf der Karte',
    params: paarParams, run: paarLauf('besetzenPatrouillen') });
  Registry.define({ id: 'nachschub_baracken', art: 'aktion', effekt: 'gegner', ereignisse: ['squadSpawn'],
    beschreibung: 'Nachschub in Zweiergruppen an den Baracken (baracke-Anker), ruhig und ohne Alarm, danach auf Patrouille. Füllt nur bis zur Obergrenze (max, 8) auf',
    params: paarParams, run: paarLauf('nachschubBaracken') });
  // EK6 (Siedlung Eisenwald): Angriff nach dem Hissen, Anführer, Sieg und Niederlage
  const endkampf = () => { try { return require('../../sim/endkampf.js'); } catch (e) { return null; } };
  Registry.define({ id: 'angriff_starten', art: 'aktion', effekt: 'gegner', ereignisse: ['squadSpawn', 'endkampfAngriff'],
    beschreibung: 'Endkampf: einmalig gegner (Standard 10) Angreifer und ein Anführer erscheinen verteilt um den Flaggenpunkt (Angriff von allen Seiten, alle wach). Der Anführer ist ein Sturmgewehr-Gegner mit +50 % Leben und Schaden, 25 % größer. Sonst gibt es keinen Nachschub',
    params: { map: { typ: 'map', pflicht: true }, fraktion: { typ: 'string', pflicht: true }, tag: { typ: 'string', pflicht: true },
      gegner: { typ: 'number', min: 1, max: 14 }, boss: { typ: 'number', min: 0, max: 1 } },
    run(m, a) {
      const E = endkampf();
      if (!E) { m.game.countError('mission-bodenkampf', new Error('endkampf.js fehlt')); return; }
      E.angriffStarten(m.game, { map: a.map, fraktion: a.fraktion, tag: a.tag, gegner: a.gegner, boss: a.boss });
    } });
  Registry.define({ id: 'gegner_abziehen', art: 'aktion', effekt: 'gegner', ereignisse: ['gegnerAbgezogen'],
    beschreibung: 'Sieg im Endkampf: alle Gegner der Karte (bzw. dieses tag) beamen raus und verschwinden',
    params: { map: { typ: 'map', pflicht: true }, tag: { typ: 'string' } },
    run(m, a) {
      const E = endkampf();
      if (!E) { m.game.countError('mission-bodenkampf', new Error('endkampf.js fehlt')); return; }
      E.gegnerAbziehen(m.game, a.map, a.tag || null);
    } });
  Registry.define({ id: 'boss_besiegt', art: 'pruefung',
    beschreibung: 'Der Anführer des Angriffs (angriff_starten) steht nicht mehr (liegt, bewusstlos, gefesselt oder entfernt); ohne Angriff false',
    params: { map: { typ: 'map', pflicht: true }, tag: { typ: 'string' } },
    test: (m, a) => { const E = endkampf(); return !!(E && E.bossBesiegt(m.game, a.map, a.tag || null)); } });
  Registry.define({ id: 'crew_gefallen', art: 'pruefung',
    beschreibung: 'Die Crew wurde während des Endkampfs per Notrückholung abgezogen (alle lagen); gilt bis die Karte zurückgesetzt wird (map_reset)',
    params: { map: { typ: 'map', pflicht: true } },
    test: (m, a) => { const E = endkampf(); return !!(E && E.crewGefallen(m.game, a.map)); } });
  Registry.define({ id: 'trupp_geraeumt', art: 'pruefung',
    beschreibung: 'Alle Gegner, die besetzen mit diesem tag gesetzt hat, sind aus dem Gefecht (aus, bewusstlos, gefesselt oder entfernt)',
    params: { map: { typ: 'map', pflicht: true }, tag: { typ: 'string', pflicht: true } },
    test: (m, a) => { const s = status(m, a.map, a.tag); return !!(s && s.gesetzt && s.aktiv === 0); } });
  Registry.define({ id: 'trupp_ruhig', art: 'pruefung',
    beschreibung: 'Der Trupp mit diesem tag ist ruhig (nicht alarmiert) – für Schleich-Ziele',
    params: { map: { typ: 'map', pflicht: true }, tag: { typ: 'string', pflicht: true } },
    test: (m, a) => { const s = status(m, a.map, a.tag); return !!(s && s.gesetzt && s.haltung === 'ruhig'); } });
};
