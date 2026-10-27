// SUND-04a Welle 5 (M1): Funk des Oberkommandos in zwei benannten Wegen statt einer Flag. Meldung (Angebot, Anfrage, Sieg, Vorwarnung): `ton: 'meldung'`, der Client färbt den Akzent
// Messing wie den Funk der Fäden. Gefahr (Angriff, Niederlage, Landung unter Beschuss): `ton: 'gefahr'`, Rot. Beide laufen über den Lagefunk-Pfad (lage: 1); `extra` trägt die Felder
// des Aufrufers (r: 1 = Funk-Reiter, sz: 1 = Szenenfunk, kz). Ohne ton (alter Lagefunk der Kriegslage) bleibt der Akzent Rot.
'use strict';
const TON = Object.freeze({ meldung: 'meldung', gefahr: 'gefahr' });
function senden(game, ton, von, text, extra) {
  if (!text) return;
  game.emit('radio', Object.assign({ from: von || 'Oberkommando', text: String(text), lage: 1, ton }, extra));
}
const meldung = (game, von, text, extra) => senden(game, TON.meldung, von, text, extra);
const gefahr = (game, von, text, extra) => senden(game, TON.gefahr, von, text, extra);
module.exports = { TON, meldung, gefahr };
