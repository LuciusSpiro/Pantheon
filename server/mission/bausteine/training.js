'use strict';
// TRA-01 B2: Baustein für die Trainingsbücher (Registry-Plugin, Logik in server/sim/training-erkennung.js; Ziel-Ids dort im Kopfkommentar).
//   training_ziel { id }   Prüfung (intern: nur Bücher mit kopf.art "intern"): das Trainingsziel id ist in diesem Versuch erreicht und bleibt es bis zum Neustart
//   reise_laeuft           Prüfung (intern): ein Schnellsprung ist unterwegs (zwischen den Hops steht die Lerche kurz im Zwischenort; abgebrochen oder fertig: nein)
//   training_sprungziel { ziel }   Aktion (intern): der Modus setzt das Sprungziel (Ort-Id; liegt es nicht nebenan, legt selectDest die Schnellsprung-Route an); zählt nicht als sprungziel_gewaehlt
const E = () => require('../../sim/training-erkennung.js');
const T = () => require('../../sim/training.js');

module.exports = (Registry) => {
  Registry.define({ id: 'training_ziel', art: 'pruefung', intern: true,
    beschreibung: 'Trainingsziel ist erreicht (dauerhaft bis zum Neustart der Szene; Ziel-Ids siehe server/sim/training-erkennung.js)',
    params: { id: { typ: 'string', pflicht: true } },
    argsPruefen: (args) => (E().istZielId(args.id) ? [] : [{ code: 'PARAM-WERT', text: `kennt das Trainingsziel '${args.id}' nicht (server/sim/training-erkennung.js)` }]),
    test: (m, a) => E().erreicht(m.game, a.id) });
  Registry.define({ id: 'reise_laeuft', art: 'pruefung', intern: true, beschreibung: 'Ein Schnellsprung ist unterwegs (game.reise)', params: {},
    test: (m) => !!m.game.reise });
  Registry.define({ id: 'training_sprungziel', art: 'aktion', intern: true,
    beschreibung: 'Der Trainingsmodus setzt das Sprungziel (selectDest; der Navigator wählt nie selbst, der Captain braucht es im Fliegen-Training nicht)',
    params: { ziel: { typ: 'loc', pflicht: true } },
    run: (m, a) => { T().sprungzielSetzen(m.game, a.ziel); } });
};
