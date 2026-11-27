'use strict';
// TRA-01 B2: Baustein für die Trainingsbücher (Registry-Plugin, Logik in server/sim/training-erkennung.js; Ziel-Ids dort im Kopfkommentar).
//   training_ziel { id }   Prüfung (intern: nur Bücher mit kopf.art "intern"): das Trainingsziel id ist in diesem Versuch erreicht und bleibt es bis zum Neustart
//   training_aktion { name }     Aktion (intern): benannte Aktion des Trainingsmodus (server/sim/training-captain.js AKTIONEN: uebungsziele, uebungsziele_weg, schaeden)
//   training_vergessen { praefix } Aktion (intern): Ziele mit diesem Präfix zurücknehmen (der Schritt verlangt die Handlung frisch, training-erkennung.js vergessen)
const E = () => require('../../sim/training-erkennung.js');
const T = () => require('../../sim/training.js');

module.exports = (Registry) => {
  Registry.define({ id: 'training_ziel', art: 'pruefung', intern: true,
    beschreibung: 'Trainingsziel ist erreicht (dauerhaft bis zum Neustart der Szene; Ziel-Ids siehe server/sim/training-erkennung.js)',
    params: { id: { typ: 'string', pflicht: true } },
    argsPruefen: (args) => (E().istZielId(args.id) ? [] : [{ code: 'PARAM-WERT', text: `kennt das Trainingsziel '${args.id}' nicht (server/sim/training-erkennung.js)` }]),
    test: (m, a) => E().erreicht(m.game, a.id) });
  Registry.define({ id: 'training_aktion', art: 'aktion', intern: true, effekt: 'gegner',
    beschreibung: 'Benannte Aktion des Trainingsmodus (Übungsziele stellen oder abräumen, Systeme beschädigen; server/sim/training-captain.js AKTIONEN)',
    params: { name: { typ: 'string', pflicht: true } },
    run: (m, a) => { T().aktion(m.game, a.name); } });
  Registry.define({ id: 'training_vergessen', art: 'aktion', intern: true,
    beschreibung: 'Trainingsziele mit diesem Präfix zurücknehmen (z. B. bot_befehl:ops.feuer_halt): der Schritt verlangt die Handlung frisch',
    params: { praefix: { typ: 'string', pflicht: true } },
    run: (m, a) => { E().vergessen(m.game, a.praefix); } });
};
