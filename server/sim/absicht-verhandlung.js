'use strict';
// SPL-02 C0: die Verhandlung mit dem Inszenierer als Pruefer. Ein Nein der Welt (Ort, Welt, Staerke, nicht ausdrueckbar: inszenierer.js) geht in DIESELBE eine Verhandlungsrunde wie ein Nein des Absichts-Pruefers
// (absicht-pruefer.js, Paket A): der Pruefer aus A ist die erste Stufe, der Inszenierer die zweite. Dieses Modul haelt keinen Zustand und ruft kein Modell (der Aufrufer ruft es und haelt v); es verdrahtet nur
// die beiden Pruefer mit dem Ablauf aus absicht-pruefer.js (verhandlungStartMit/-AntwortMit). Es liegt eigens hier, weil inszenierer.js absicht-pruefer.js laedt und umgekehrt ein Zyklus entstuende.
// Es kennt weder Absichts- noch Beat-Namen. runden_max steht in den Daten (content/faeden/absichten.json werte).
//
//   pruefeUndInszeniere(game, absicht, katalog?) -> { ok, absicht, fehler, inszenierung? }   Stufe 1: pruefeAbsicht; nur wenn ok, Stufe 2: inszeniere. Format wie pruefeAbsicht
//        (fehlerText, gegenvorschlagPatch, wendePatchAn gelten); bei ok liegt das Ergebnis des Inszenierers (plan, hex, bezug, locker, ...) als `inszenierung` daran
//   verhandlungStart(game, absicht, katalog?) -> v        v wie in absicht-pruefer.js ({ stand: offen | angenommen | abgelehnt, runde, runden_max, absicht, ergebnis, text }); bei `angenommen` zusaetzlich v.inszenierung
//   verhandlungAntwort(game, v, antwort, katalog?) -> v'  antwort = Patch (Liste oder { patch }) oder korrigierte Absicht; nach runden_max Antworten ohne Erfolg: abgelehnt mit Grund (text), endgueltig
const AP = require('./absicht-pruefer.js');
const INS = require('./inszenierer.js');

function pruefeUndInszeniere(game, absicht, katalog) {
  const e = AP.pruefeAbsicht(game, absicht, katalog);
  if (!e.ok) return e;
  const r = INS.inszeniere(game, e.absicht, katalog);
  return r.ok ? { ok: true, absicht: e.absicht, fehler: [], inszenierung: r } : { ok: false, absicht: e.absicht, fehler: r.fehler };
}
const mitInszenierung = (v) => (v && v.stand === 'angenommen' && !v.inszenierung && v.ergebnis && v.ergebnis.inszenierung ? Object.assign({}, v, { inszenierung: v.ergebnis.inszenierung }) : v);

const verhandlungStart = (game, absicht, katalog) => mitInszenierung(AP.verhandlungStartMit(pruefeUndInszeniere, game, absicht, katalog));
const verhandlungAntwort = (game, v, antwort, katalog) => mitInszenierung(AP.verhandlungAntwortMit(pruefeUndInszeniere, game, v, antwort, katalog));

module.exports = { pruefeUndInszeniere, verhandlungStart, verhandlungAntwort };
