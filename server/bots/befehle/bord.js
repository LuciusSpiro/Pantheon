'use strict';
// BOT-01 B3: Registry der Bot-Befehle fuer den Bord-Dienst (Katalog v1: bord.rueckholen, bord.sensor, bord.kuppel). Jede Funktion: (game, bot, args) => { ok: true | false, code?, text? }
// BOT-02 B1: Geruest. Die Annahme (annahme.js) ruft sie nur, wenn es einen Bord-Bot gibt (lauf.js bordBot), sonst antwortet sie kein_bot. Bis B2 bis B4 sie fuellen, liefern alle nicht_jetzt (Text aus content/bots/texte.json).
// Gilt wie in den anderen Registries: nur lesen, nie Spielzustand schreiben (Quellscan tools/test-bot-befehle-nav.js); die Wirkung laeuft als cmd durch den Wachposten des Agenten (transfer.*, captain.*, nur im Bord-Dienst).
const NICHT_JETZT = { ok: false, code: 'nicht_jetzt' };

const bord = {};
bord['bord.rueckholen'] = () => NICHT_JETZT;   // B2
bord['bord.sensor'] = () => NICHT_JETZT;   // B3
bord['bord.kuppel'] = () => NICHT_JETZT;   // B3

module.exports = bord;
