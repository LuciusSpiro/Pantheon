'use strict';
// PAR-01 B: Probe-Beats. Node-Preload, der N zusaetzliche planbare Beats NUR IM SPEICHER in den Beat-Katalog (faden-daten.js BEATS) legt.
// Keine Datei wird veraendert. Zweck: pruefen, dass kein Test rot wird, nur weil ein neuer planbarer Beat im Katalog steht (der Mock
// wuerfelt dann andere Plaene, der Katalog wird laenger). Aufruf:
//   PROBE_BEATS=2 node -r ./tools/probe-beat.js tools/test-xyz.js
//   NODE_OPTIONS="--require <abs>/tools/probe-beat.js" PROBE_BEATS=2 ...   (wirkt auch in Kindprozessen; so faehrt tools/probe-kette.js)
// PROBE_BEATS = 0|1|2 (leer/0 = nichts tun). probe_a: Kopie von spontanhilfe, probe_b: Kopie von notruf (beide ohne Pflichtparameter,
// mit bauplan, ohne nur_inszenierer); der zweck wird so aufgefuellt, dass die Katalogzeile rund 440 Zeichen lang ist (PROBE_ZEILE aendert das).
const path = require('path');
const FD = require(path.join(__dirname, '..', 'server', 'sim', 'faden-daten.js'));

const ZEILE = parseInt(process.env.PROBE_ZEILE || '440', 10);
const BASEN = ['spontanhilfe', 'notruf'];
const REST = [210, 387];   // gemessen: Zeichen der Katalogzeile ausser dem zweck (Flags, Optionen, Parameter, NSC danach)
const FUELL = ' Dieser Probe-Beat steht nur im Speicher und beschreibt ein Ereignis, bei dem die Crew eine Aufgabe erledigt, etwas findet und danach weiterfliegt.';

function legeProbeBeatsAn(n) {
  const angelegt = [];
  for (let i = 0; i < n && i < BASEN.length; i++) {
    const id = 'probe_' + 'ab'[i];
    if (FD.BEATS[id]) continue;
    const b = JSON.parse(JSON.stringify(FD.BEATS[BASEN[i]]));
    delete b.nur_inszenierer;
    const laenge = Math.max(ZEILE - REST[i], 20);
    let zweck = 'Probe-Beat ' + id + '.';
    while (zweck.length < laenge) zweck += FUELL;
    b.zweck = zweck.slice(0, laenge - 1).replace(/\s+\S*$/, '') + '.';
    FD.BEATS[id] = b;
    angelegt.push(id);
  }
  return angelegt;
}

const n = parseInt(process.env.PROBE_BEATS || '0', 10);
const angelegt = n > 0 ? legeProbeBeatsAn(n) : [];
module.exports = { legeProbeBeatsAn, angelegt };
