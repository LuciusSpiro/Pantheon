'use strict';
// S2 §5 (CONTRACT-S2, Team SCHUETZLING): Bausteine für Schützlinge als Registry-Plugin.
//   spawn_escort    { tag*, kind*, name?, npc?, verhalten?, von?, nach?, reparatur_s?, huelle? }   Schützling erscheinen lassen
//   escort_order    { tag?, befehl* }          Befehl aus dem Regiebuch (sofort, ohne Gehorsamsprüfung)
//   enemies_retreat { tag?, unter_pct? }       Gegner (alle bzw. mit Tag) unter unter_pct % Hülle drehen ab (100 = alle sofort)
//   escort_state    { tag*, state* }           Prüfung: ok | beschaedigt | kampfunfaehig | entkommen
//   escort_hp_below { tag*, pct* }             Prüfung: Hülle unter pct % (auch nach entkommen/kampfunfähig)
//   escort_arrived  { tag* }                   Prüfung: Schützling hat sein Ziel erreicht
// Punkte für von/nach: west|ost|nord|sued|mitte|station|dock|lerche|vorn|achtern|rand (oder eine Orts-ID: Ziel ist ein
// anderer Ort, der Schützling springt mit der Lerche). Fehlende Angaben kommen aus besetzung.schiffe.<tag> des Buchs.
// tag (außer bei enemies_retreat = Gegner-Tag) hat typ 'ship': der Prüfer verlangt den Tag in besetzung.schiffe (REF-SCHIFF).
// Flags <tag>_heil | _beschaedigt | _verloren setzt escort.js bei jeder Zustandsänderung (genau eins true).
// Platzhalter {escortHp:<tag>} baut ENGINE in mission.tpl() (ruft escort.hpPct).
let escortMod = null;
const escort = () => escortMod || (escortMod = require('../../sim/escort.js'));

const KINDS = ['frachter', 'karawane', 'bergungsboot'];
const VERHALTEN = ['treibt', 'folgt_kurs', 'flieht'];
const BEFEHLE = ['halten', 'folgen', 'volle_kraft', 'andocken'];
const STATES = ['ok', 'beschaedigt', 'kampfunfaehig', 'entkommen'];

function shipDef(m, tag) {
  const s = m && m.def && m.def.besetzung && m.def.besetzung.schiffe;
  return s && tag != null && s[tag] && typeof s[tag] === 'object' ? s[tag] : {};
}

module.exports = (Registry) => {
  Registry.define({ id: 'spawn_escort', art: 'aktion', ereignisse: ['escortSpawn'],
    beschreibung: 'Schützling (NSC-Schiff) im Raum erscheinen lassen: Geleit (folgt_kurs), Havarist (treibt, reparatur_s = Sekunden Flicken längsseits) oder Flüchtling (flieht). Höchstens 2.',
    params: {
      tag: { typ: 'ship', pflicht: true }, kind: { typ: 'string', pflicht: true, werte: KINDS },
      name: { typ: 'string' }, npc: { typ: 'npc' }, verhalten: { typ: 'string', werte: VERHALTEN },
      von: { typ: 'string' }, nach: { typ: 'string' }, reparatur_s: { typ: 'number', min: 0, max: 600 }, huelle: { typ: 'number', min: 1, max: 100 },
    },
    run(m, a) {
      const g = m.game; const d = shipDef(m, a.tag);
      const opts = {
        tag: a.tag, kind: a.kind || d.kind, name: a.name != null ? m.tpl(a.name) : (d.name != null ? m.tpl(d.name) : undefined),
        npc: a.npc || d.npc || null, verhalten: a.verhalten || d.verhalten, von: a.von, nach: a.nach, reparatur_s: a.reparatur_s, huelle: a.huelle,
      };
      if (!escort().spawn(g, opts)) g.countError('mission-hook', new Error(`spawn_escort: ${a.tag} nicht angelegt`));
    } });
  Registry.define({ id: 'escort_order', art: 'aktion', ereignisse: ['escortOrder'],
    beschreibung: 'Befehl an einen Schützling aus dem Regiebuch (sofort): halten, folgen, volle_kraft, andocken',
    params: { tag: { typ: 'ship' }, befehl: { typ: 'string', pflicht: true, werte: BEFEHLE } },
    run(m, a) { escort().setOrder(m.game, a.tag == null ? null : a.tag, a.befehl); } });
  Registry.define({ id: 'enemies_retreat', art: 'aktion', ereignisse: ['enemyRetreat', 'enemyLeft'],
    beschreibung: 'Gegner im Raum (alle bzw. mit Tag/Art) drehen ab und verlassen das Feld, sobald ihre Hülle unter unter_pct % liegt (100 = alle sofort). Gilt bis zum Ortswechsel.',
    params: { tag: { typ: 'string' }, unter_pct: { typ: 'number', min: 0, max: 100 } },
    run(m, a) {
      const pct = a.unter_pct == null || a.unter_pct >= 100 ? 101 : a.unter_pct;
      escort().retreat(m.game, { tag: a.tag || null, unter_pct: pct });
    } });

  Registry.define({ id: 'escort_state', art: 'pruefung', beschreibung: 'Schützling ist im Zustand ok | beschaedigt | kampfunfaehig | entkommen',
    params: { tag: { typ: 'ship', pflicht: true }, state: { typ: 'string', pflicht: true, werte: STATES } },
    test: (m, a) => escort().stateOf(m.game, a.tag) === a.state });
  Registry.define({ id: 'escort_hp_below', art: 'pruefung', beschreibung: 'Hülle des Schützlings liegt unter pct % (zählt auch nach entkommen/kampfunfähig)',
    params: { tag: { typ: 'ship', pflicht: true }, pct: { typ: 'number', pflicht: true, min: 0, max: 100 } },
    test: (m, a) => escort().stateOf(m.game, a.tag) != null && escort().hpPct(m.game, a.tag) < a.pct });
  Registry.define({ id: 'escort_arrived', art: 'pruefung', beschreibung: 'Schützling hat sein Ziel (nach) erreicht',
    params: { tag: { typ: 'ship', pflicht: true } },
    test: (m, a) => escort().arrived(m.game, a.tag) });
};
