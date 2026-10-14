'use strict';
// EK8 (CONTRACT-EK8): Bausteine für die Kampagnenkette (Registry-Plugin).
//   fracht_zuteilen { art, n? }   Aktion: n Ladungen (Standard 1) der Art direkt in den Frachtraum legen, soweit Platz ist
//                                 (Belohnung „Behaltet einen Teil“, Ersatz einer verlorenen Sprengladung). Ereignis frachtAnBord.
// Die übrigen Wege der Kette laufen über vorhandene Bausteine (fracht_*, sperrriegel_oeffnen, welt_fakt, npc_gedaechtnis, chronik).
const ARTEN = ['sprengstoff', 'fracht', 'deuterium'];   // SL6: Deuterium
const fracht = () => require('../../sim/fracht.js');

module.exports = (Registry) => {
  // SL11: Szene des Kapitels starten (Hub-Buch). Läuft über die Warteschlange der Engine, damit der Hub nicht mitten in seinen eigenen
  // Aktionen abgebrochen wird. Die Szene kommt aus kapitel.szenen der Kette; am Ende beginnt der Hub neu (server/mission/kampagne.js).
  Registry.define({ id: 'buch_starten', art: 'aktion',
    beschreibung: 'Szene des laufenden Kapitels starten (kapitel.szenen der Kette): das Kapitelbuch wird abgebrochen und beginnt nach der Szene neu; Flags bleiben',
    params: { buch: { typ: 'string', pflicht: true } },
    run(m, a) {
      if (!m.kette) { m.game.countError('mission-hook', new Error('buch_starten: keine Kette aktiv')); return; }
      m.pending.push({ at: m.game.time + 0.2, actions: [{ do: 'kette_szene_los', buch: a.buch }] });
    } });
  // SL11: Debug-Sprünge für Labor, Tests und Bots (skip): Signal bzw. Spur ohne Minispiel/Fahren als erledigt setzen
  Registry.define({ id: 'debug_entschluesselt', art: 'aktion', intern: true, beschreibung: 'Signal id sofort als entschlüsselt setzen (Qualität q, Standard 3)',
    params: { id: { typ: 'string', pflicht: true }, q: { typ: 'number', min: 0, max: 3 } },
    run(m, a) {
      const g = m.game; const q = a.q != null ? a.q : 3;
      g.entschlErgebnis = g.entschlErgebnis || {}; g.entschlErgebnis[a.id] = q;
      if (g.weltstand && typeof g.weltstand.fact === 'function') g.weltstand.fact('entschl_' + a.id, q, 'Debug');
      if (g.entschl && g.entschl.id === a.id) g.entschl = null;
      g.missionEvent('entschluesselt', { id: a.id, qualitaet: q });
    } });
  Registry.define({ id: 'debug_spur_ende', art: 'aktion', intern: true, beschreibung: 'Spur id sofort bis zum Ende gelesen setzen (verborgene Kante enthüllt)',
    params: { id: { typ: 'string', pflicht: true } },
    run(m, a) {
      const g = m.game; const S = require('../../sim/spur.js');
      if (!g.spur || g.spur.id !== a.id) S.starten(g, a.id);
      const d = S.datei(a.id);
      if (!g.spur || !d) return;
      g.spur.idx = d.weg.length - 1; g.spur.gelesen = true; g.spur.fertig = true;
      require('../../sim/marken.js').entferne(g, 'spur:' + a.id);
      require('../../sim/sprung.js').kanteEnthuellen(g, d.ende.kante);
      g.missionEvent('spurGelesen', { id: a.id, hex: d.weg[d.weg.length - 1], ende: true });
    } });
  Registry.define({ id: 'kette_szene_los', art: 'aktion', intern: true, beschreibung: 'intern: startet die Szene (buch_starten)',
    params: { buch: { typ: 'string', pflicht: true } },
    run(m, a) { const err = m.kette ? m.kette.szeneStarten(a.buch) : 'keine Kette'; if (err) m.game.countError('mission-hook', new Error('buch_starten: ' + err)); } });
  Registry.define({ id: 'fracht_zuteilen', art: 'aktion', ereignisse: ['frachtAnBord'],
    beschreibung: 'n Ladungen (Standard 1) der Art direkt in den Frachtraum der Lerche legen (Belohnung, Ersatz einer verlorenen Sprengladung); ohne freien Platz wird nur gelegt, was hineinpasst',
    params: { art: { typ: 'string', pflicht: true, werte: ARTEN }, n: { typ: 'number', min: 1, max: 4 } },
    run(m, a) {
      const g = m.game; const F = fracht();
      for (let i = 0; i < (a.n != null ? a.n : 1); i++) if (!F.anBordLegen(g, a.art)) break;
    } });
};
