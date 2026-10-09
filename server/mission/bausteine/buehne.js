'use strict';
// B1 §6.4 (CONTRACT-B1, Team ENGINE): Bausteine für gebaute Außenkarten (Landepunkte, Anker, Besetzung).
//   anker_zustand    { map*, anker*, zustand*, merken? }   Anker (Rolle = alle dieser Rolle, oder Anker-ID) in einen Zustand setzen
//   kante_zustand    { map*, kante*, zustand*, merken? }   innere Kante (Durchgang) setzen (verschlossen, offen …)
//   landepunkt_alarm { map*, an* }                         Alarm des Landepunkts setzen/löschen (zweiter Besuch -> wach)
//   ladung_geben     { anzahl* }                           Sprengladungen ins Inventar (für sprengpunkt)
//   besetzen         { map*, bereich?, fraktion*, staerke*, haltung*, tag*, neue_rolle? }   Trupps an wache-Ankern (BODENKAMPF)
//   entern_ziel      { tag*, merken?, fraktion? }           Gegner (Raum) mit diesem Tag bleibt bei Hülle 0 als Prise (ENTERN)
//   anker_state      { map*, anker*, state*, all?, min? }  Prüfung: Anker im Zustand (min: mindestens n Stück)
//   download_fertig  { map*, anker? }                      Prüfung: Download fertig (terminal geladen; ohne anker: Kern-Terminal, falls vorhanden)
//   ladung_gezuendet { map*, anker? }                      Prüfung: Ladung explodiert (sprengpunkt 'zerstoert')
//   alarm            { map* }                              Prüfung: Landepunkt im Alarm
//   team_im_bereich  { map*, bereich*, min? }              Prüfung: Außenteam im Bereich (Altname area_occupied bleibt)
// Laufzeit liegt bei BUEHNE (server/sim/anker.js, landepunkte.js), BODENKAMPF (combat/squad: besetzen), ENTERN (entern.js).
// Fehlt ein Modul, zählt der Baustein einen Fehler (game.countError) und tut nichts – nie ein Wurf in den Tick.
// Registrierung der Karte (F1): Aktionen mit map-Parameter laufen erst, wenn die Karte registriert ist – das erledigt
// mission.js (aufKarten -> landepunkte.sobaldGeladen) für alle Bausteine; hier kein eigener Zugriff auf unregistrierte Karten.
const Objects = require('../objects.js');

const STAERKEN = ['klein', 'mittel', 'gross'];
const HALTUNGEN = ['ruhig', 'wach'];
const ROLLEN = ['grundtyp', 'niederhalter', 'grenadier', 'schuetze', 'enterer', 'haescher', 'waechter'];

function sim(name) {
  try { const m = require('../../sim/' + name + '.js'); return m && !m.stub ? m : null; } catch (e) { return null; }
}
// fn aus dem ersten Modul, das sie hat: call(g, ['anker', 'landepunkte'], 'setzeKante', ...args)
function call(g, mods, fn, ...args) {
  for (const n of mods) {
    const m = sim(n);
    if (m && typeof m[fn] === 'function') {
      try { return { ok: true, r: m[fn](g, ...args) }; } catch (e) { g.countError('mission-buehne', e); return { ok: false }; }
    }
  }
  g.countError('mission-buehne', new Error(`${mods.join('/')}.${fn} fehlt`));
  return { ok: false };
}
const aw = (g, map) => (g.aways ? g.aways[map] : null);

module.exports = (Registry) => {
  // ---------- Aktionen ----------
  Registry.define({ id: 'anker_zustand', art: 'aktion', ereignisse: ['ankerZustand'],
    beschreibung: 'Anker einer Außenkarte in einen Zustand setzen (Rolle = alle Anker dieser Rolle, oder eine Anker-ID). merken: bleibt im Weltstand (zweiter Besuch)',
    params: { map: { typ: 'map', pflicht: true }, anker: { typ: 'anker', pflicht: true }, zustand: { typ: 'string', pflicht: true }, merken: { typ: 'bool' } },
    run(m, a) {
      const g = m.game;
      Objects.setAnkerState(g, a.map, a.anker, a.zustand, { merken: !!a.merken });   // merken: anker.setzen schreibt in den Landepunkt-Eintrag
    } });
  Registry.define({ id: 'kante_zustand', art: 'aktion', ereignisse: ['ankerZustand'],
    beschreibung: 'Inneren Anschluss (Kante <platzA>~<platzB>) einer gebauten Karte setzen, z. B. verschlossen. merken: bleibt im Weltstand',
    params: { map: { typ: 'map', pflicht: true }, kante: { typ: 'kante', pflicht: true }, zustand: { typ: 'string', pflicht: true }, merken: { typ: 'bool' } },
    run(m, a) {
      const g = m.game;
      const r = call(g, ['anker'], 'setzen', a.map, a.kante, a.zustand, null, { merken: !!a.merken });   // anker.setzen kennt auch Kanten-IDs
      if (r.ok && typeof r.r === 'string' && r.r) g.countError('mission-buehne', new Error('kante_zustand: ' + r.r));
    } });
  Registry.define({ id: 'landepunkt_alarm', art: 'aktion', ereignisse: ['landepunktAlarm'],
    beschreibung: 'Alarm eines Landepunkts setzen (an: true) oder löschen. Der Weltstand merkt ihn (zweiter Besuch: Besetzung wach)',
    params: { map: { typ: 'map', pflicht: true }, an: { typ: 'bool', pflicht: true } },
    run(m, a) {
      const g = m.game;
      const r = call(g, ['anker', 'landepunkte'], 'alarm', a.map, !!a.an);
      if (!r.ok) { const x = aw(g, a.map); if (x) x.alarm = !!a.an; }
    } });
  Registry.define({ id: 'ladung_geben', art: 'aktion', beschreibung: 'Sprengladungen ins Inventar legen (für sprengpunkt-Anker)',
    params: { anzahl: { typ: 'number', pflicht: true, min: 1, max: 9 } },
    run(m, a) { const inv = m.game.inventory; inv.ladung = Math.max(0, Math.min(99, (inv.ladung || 0) + Math.round(a.anzahl))); } });
  Registry.define({ id: 'besetzen', art: 'aktion', effekt: 'gegner', ereignisse: ['squadSpawn'],
    beschreibung: 'Außenkarte mit Gegnern der Fraktion besetzen (Trupps an wache-Ankern des Bereichs, ohne Bereich in den Gefechtsplätzen). Rollen aus den Rezepten der Fraktion; höchstens eine neue_rolle',
    params: { map: { typ: 'map', pflicht: true }, bereich: { typ: 'area' }, fraktion: { typ: 'string', pflicht: true },
      staerke: { typ: 'string', pflicht: true, werte: STAERKEN }, haltung: { typ: 'string', pflicht: true, werte: HALTUNGEN },
      tag: { typ: 'string', pflicht: true }, neue_rolle: { typ: 'string', werte: ROLLEN } },
    run(m, a) {
      const opts = { map: a.map, bereich: a.bereich || null, fraktion: a.fraktion, staerke: a.staerke, haltung: a.haltung, tag: a.tag, neue_rolle: a.neue_rolle || null };
      call(m.game, ['combat', 'squad'], 'besetzen', opts);
    } });
  Registry.define({ id: 'entern_ziel', art: 'aktion', beschreibung: 'Raum: Gegner mit diesem Tag bleibt bei Hülle 0 als treibende Prise liegen (betretbar, Landepunkt <ort>.prise). merken: die Prise bleibt nach der Szene als treibendes Wrack; fraktion: Besitz der Prise (sonst Fraktion des Gegners). Nie im Tutorial',
    params: { tag: { typ: 'string', pflicht: true }, merken: { typ: 'bool' }, fraktion: { typ: 'string' } },
    run(m, a) {
      const g = m.game;
      const r = call(g, ['entern'], 'markieren', a.tag, { merken: !!a.merken, fraktion: a.fraktion || null });
      if (r.ok && typeof r.r === 'string' && r.r) g.countError('mission-buehne', new Error('entern_ziel: ' + r.r));
    } });

  // ---------- Prüfungen ----------
  Registry.define({ id: 'anker_state', art: 'pruefung', beschreibung: 'Anker der Karte im Zustand (Rolle: einer, alle mit all, bzw. mindestens min Stück, z. B. 3 von 5 ziel)',
    params: { map: { typ: 'map', pflicht: true }, anker: { typ: 'anker', pflicht: true }, state: { typ: 'state', pflicht: true }, all: { typ: 'bool' }, min: { typ: 'number', min: 1 } },
    test: (m, a) => (a.min != null ? Objects.ankerCount(m.game, a.map, a.anker, a.state) >= a.min : Objects.ankerInState(m.game, a.map, a.anker, a.state, !!a.all)) });
  Registry.define({ id: 'download_fertig', art: 'pruefung', beschreibung: 'Download an einem terminal-Anker fertig (Zustand geladen). Ohne anker: gibt es Terminals mit kern: true, zählt nur der Kern (wissen_aufteilen)',
    params: { map: { typ: 'map', pflicht: true }, anker: { typ: 'anker' } },
    test: (m, a) => {
      const g = m.game;
      if (a.anker != null) return Objects.ankerInState(g, a.map, a.anker, 'geladen', false);
      const term = Objects.resolveAnker(g, a.map, 'terminal');
      const kern = term.filter((x) => x.kern);
      return (kern.length ? kern : term).some((x) => Objects.ankerState(g, a.map, x) === 'geladen');
    } });
  Registry.define({ id: 'ladung_gezuendet', art: 'pruefung', beschreibung: 'Ladung an einem sprengpunkt-Anker explodiert (Zustand zerstoert)',
    params: { map: { typ: 'map', pflicht: true }, anker: { typ: 'anker' } },
    test: (m, a) => Objects.ankerInState(m.game, a.map, a.anker || 'sprengpunkt', 'zerstoert', false) });
  Registry.define({ id: 'alarm', art: 'pruefung', beschreibung: 'Landepunkt ist im Alarm (ein Trupp hat die Crew bemerkt)',
    params: { map: { typ: 'map', pflicht: true } },
    test: (m, a) => {
      const g = m.game;
      for (const n of ['landepunkte', 'anker']) {
        const mod = sim(n);
        if (mod && typeof mod.istAlarm === 'function') { try { return !!mod.istAlarm(g, a.map); } catch (e) { g.countError('mission-buehne', e); return false; } }
      }
      const x = aw(g, a.map);
      return !!(x && (x.alarm || x.al));
    } });
  Registry.define({ id: 'team_im_bereich', art: 'pruefung', beschreibung: 'Mindestens min Spieler (Standard 1) im Bereich der Karte (Altname area_occupied)',
    params: { map: { typ: 'map', pflicht: true }, bereich: { typ: 'area', pflicht: true }, min: { typ: 'number', min: 1 } },
    test: (m, a) => Objects.teamOn(m.game, a.map).filter((p) => Objects.inArea(m.game, a.map, a.bereich, p.x, p.y)).length >= (a.min || 1) });
};
