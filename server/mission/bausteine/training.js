'use strict';
// TRA-01 B2: Baustein für die Trainingsbücher (Registry-Plugin, Logik in server/sim/training-erkennung.js; Ziel-Ids dort im Kopfkommentar).
//   training_ziel { id }   Prüfung (intern: nur Bücher mit kopf.art "intern"): das Trainingsziel id ist in diesem Versuch erreicht und bleibt es bis zum Neustart
const E = () => require('../../sim/training-erkennung.js');

module.exports = (Registry) => {
  Registry.define({ id: 'training_ziel', art: 'pruefung', intern: true,
    beschreibung: 'Trainingsziel ist erreicht (dauerhaft bis zum Neustart der Szene; Ziel-Ids siehe server/sim/training-erkennung.js)',
    params: { id: { typ: 'string', pflicht: true } },
    argsPruefen: (args) => (E().istZielId(args.id) ? [] : [{ code: 'PARAM-WERT', text: `kennt das Trainingsziel '${args.id}' nicht (server/sim/training-erkennung.js)` }]),
    test: (m, a) => E().erreicht(m.game, a.id) });
};
