'use strict';
// SPT-02 7 (E Abgaenge): ein Schiff verlaesst die Szene OHNE Tod und ohne Rueckzug-Flug, der Spieler soll es sehen.
//   melde(game, o, art)   Ereignis abgang { x, y, art } an die Clients (ausserhalb des Snapshots, 0 B Budget; Client: case 'abgang' -> R.addFx abgang_<art>).
//                          art: 'sprung' (Sprungblitz: Notsprung, Zielschiff der Verfolgung, Transporter, Verbuendete am Szenenende)
//                                'rueck'  (Rueckzug nach der Zeitgrenze von escort.updateLeaving: der Gegner loest sich mitten im Feld auf)
//   Kein Ton (der Sprung bringt sein sfx jump schon mit), keine Mechanik: nur das Bild.
const ARTEN = ['sprung', 'rueck'];
function melde(game, o, art) {
  if (!o || !ARTEN.includes(art) || !Number.isFinite(o.x) || !Number.isFinite(o.y)) return;
  game.emit('abgang', { x: Math.round(o.x), y: Math.round(o.y), art });
}
module.exports = { melde, ARTEN };
