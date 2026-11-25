'use strict';
// BOT-05 B2: die Stimme zu bot.status. Der Text einer Statusantwort ist dynamisch (status.js), also gibt es dafuer keinen vorgefertigten Clip; der Server spricht ihn in der Stimme der Figur
// (gleiche Voicebox und Audio-Ablage wie das Gespraech) und schickt an den Fragenden { t: 'bot.rede', botId, gid, zustand: 'ton', nr: 0, audio, zu: 'bot.status' }, danach { zustand: 'ende', zu: 'bot.status' } (beide tragen zu: ein Gespraech erkennt sie daran nicht als seine).
// Kein denkt, kein satz: der Text steht schon in der bot.antwort (Untertitel). Mehrere Bots (bot.status an alle): einer nach dem anderen, in der Reihenfolge der Antworten.
// Aktiv nur mit konfigurierter Voicebox (VOICEBOX_URL oder VOICEBOX_AUTH gesetzt) und nie im Sinne einer Bedingung fuer den Befehl: ohne Voicebox, bei Fehlern oder Zeitlimit bleibt alles wie bisher
// (Untertitel plus Bestaetigungs-Clip). Faellt eine Anfrage aus, entfallen die uebrigen Toene dieser Runde (die Voicebox ist dann weg, kein Warten je Bot).
// Aufgerufen von annahme.js (Befehl bot.status); dieses Modul laedt weder annahme noch befehle noch lauf und fuehrt keinen Befehl aus.
const crypto = require('crypto');
const Dienste = require('./gespraech-dienste.js');
const Audio = require('./gespraech-audio.js');
const Figuren = require('./figuren.js');
const STIMMEN = require('../../content/bots/stimmen.json');

const TTS_MS = 8000;   // kuerzer als beim Gespraech: ein Status ist ein Satz
const aktiv = () => !!(process.env.VOICEBOX_URL || process.env.VOICEBOX_AUTH);
let zaehler = 0;
const neueGid = () => 's' + (++zaehler).toString(36) + crypto.randomBytes(3).toString('hex');

// antworten: die bot.antwort-Nachrichten (mit botId, befehl 'bot.status', status 'ok', text). Gibt ein Promise zurueck, das nie ablehnt.
async function sprechen(game, spieler, antworten) {
  try {
    if (!aktiv() || !game || !spieler) return;
    const runId = game.runId;
    for (const a of antworten) {
      if (!a || a.befehl !== 'bot.status' || a.status !== 'ok' || typeof a.text !== 'string' || !a.text || typeof a.botId !== 'string') continue;
      const figur = Figuren.figurMitId(a.botId);
      const profil = figur ? (STIMMEN[figur.stimme] || {}).profilName : null;
      if (!profil) continue;
      let buf;
      try { buf = await Dienste.sprechen({ voice: profil, text: a.text, timeoutMs: TTS_MS }); } catch (e) { return; }
      if (game.runId !== runId || game.phase !== 'play' || !spieler.conn || spieler.connected === false || !game.players.includes(spieler)) return;
      const gid = neueGid();
      game.sendTo(spieler.conn, { t: 'bot.rede', botId: a.botId, gid, zustand: 'ton', nr: 0, audio: Audio.ablegen(buf).url, zu: 'bot.status' });
      game.sendTo(spieler.conn, { t: 'bot.rede', botId: a.botId, gid, zustand: 'ende', zu: 'bot.status' });
    }
  } catch (e) { try { game.countError('bot.statuston', e); } catch (x) { /* egal */ } }
}

module.exports = { sprechen, aktiv };
