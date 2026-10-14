'use strict';
// SL5 (CONCEPT-SL5): Bausteine für das Entschlüsseln (Registry-Plugin, Aktionen und Prüfung, Logik in server/sim/entschluesseln.js).
//   entschluesseln_starten { id, absender?, schicht0, schicht1?, schicht2?, schicht3? }   Aktion: ein verschlüsseltes Signal liegt an der Ops an
//       (V öffnet die Abstimmung). Schicht n ist ab Qualität n lesbar; schicht3 ist die versteckte zweite Schicht (nur bei sauberem Signal).
//       Ereignisse: signalEmpfangen { id }, entschluesselt { id, qualitaet, schichten }
//   entschluesselt { id, min? }   Prüfung: Signal id entschlüsselt (Qualität ≥ min, Standard 0 = irgendwie fertig)
// Das Ergebnis steht auch als Weltstand-Fakt entschl_<id> (Zahl 0..3).
const E = () => require('../../sim/entschluesseln.js');

module.exports = (Registry) => {
  Registry.define({ id: 'entschluesseln_starten', art: 'aktion', ereignisse: ['signalEmpfangen', 'entschluesselt'],
    beschreibung: 'Verschlüsseltes Signal an die Ops legen (Minispiel Frequenz abstimmen). schicht0..schicht3: Text ab Qualität 0..3; schicht3 ist die versteckte zweite Schicht.',
    params: { id: { typ: 'string', pflicht: true }, absender: { typ: 'text' }, schicht0: { typ: 'text', pflicht: true },
      schicht1: { typ: 'text' }, schicht2: { typ: 'text' }, schicht3: { typ: 'text' } },
    run(m, a) {
      const schichten = [];
      for (let i = 0; i < 4; i++) { const t = a['schicht' + i]; if (t != null && String(t).trim()) schichten.push({ ab: i, text: m.tpl(t) }); }
      const err = E().starten(m.game, { id: a.id, absender: a.absender != null ? m.tpl(a.absender) : null, schichten });
      if (err) m.game.countError('mission-hook', new Error('entschluesseln_starten: ' + err));
    } });
  Registry.define({ id: 'entschluesselt', art: 'pruefung', beschreibung: 'Signal id ist entschlüsselt (Qualität mindestens min, Standard 0)',
    params: { id: { typ: 'string', pflicht: true }, min: { typ: 'number', min: 0, max: 3 } },
    test: (m, a) => { const q = E().ergebnis(m.game, a.id); return q != null && q >= (a.min != null ? a.min : 0); } });
};
