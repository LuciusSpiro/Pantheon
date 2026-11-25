'use strict';
// BOT-05 B2: die Stimme zu bot.status. Der Text einer Statusantwort ist dynamisch (status.js), also gibt es dafuer keinen vorgefertigten Clip; der Server spricht ihn in der Stimme der Figur
// (gleiche Voicebox und Audio-Ablage wie das Gespraech) und schickt an den Fragenden { t: 'bot.rede', botId, gid, zustand: 'ton', nr: 0, audio, zu: 'bot.status', runde }, danach { zustand: 'ende', zu: 'bot.status', runde } (beide tragen zu: ein Gespraech erkennt sie daran nicht als seine).
// Kein denkt, kein satz: der Text steht schon in der bot.antwort (Untertitel). Mehrere Bots (bot.status an alle): einer nach dem anderen, in der Reihenfolge der Antworten.
// Aktiv NUR mit gesetzter VOICEBOX_URL (BOT-05 B-Nacharbeit K4: eine Regel fuer Gespraech und Statuston, kein Standardwert im Server) und nie im Sinne einer Bedingung fuer den Befehl: ohne Voicebox, bei Fehlern
// oder Zeitlimit bleibt alles wie bisher (Untertitel plus Bestaetigungs-Clip).
// Begrenzung (B-Nacharbeit W3): je Spieler hoechstens EINE laufende Runde; eine neue Runde macht die alte ungueltig (ihr laufendes Ergebnis wird verworfen, noch nicht gesendete Toene gehen nie hinaus). Alle Runden
//   zusammen sprechen hoechstens PARALLEL Anfragen zugleich an die Voicebox (eine Runde = ein Bot nach dem anderen); wer wartet, wartet nur, solange seine Runde die aktuelle ist.
//   Die Clips liegen in der Ablage im eigenen kleinen Topf (gespraech-audio.js, Art 'status'): sie verdraengen kein Gespraechsaudio.
// Protokoll-Zusatz fuer den Client (Untertitel laeuft mit dem Ton): vorbereiten() setzt auf die ok-Antworten tonRunde (die Runde); der Client haelt den Antworttext, bis der Ton dieser Runde und dieses Bots gelaufen oder
//   ausgefallen ist. Faellt der Rest einer Runde aus (Voicebox weg, 401, Zeitlimit, Fehler), kommt EINMAL { t: 'bot.rede', gid, zustand: 'ausfall', zu: 'bot.status', runde } statt der fehlenden Toene.
// Aufgerufen von annahme.js (Befehl bot.status); dieses Modul laedt weder annahme noch befehle noch lauf und fuehrt keinen Befehl aus.
const crypto = require('crypto');
const Dienste = require('./gespraech-dienste.js');
const Audio = require('./gespraech-audio.js');
const Figuren = require('./figuren.js');
const STIMMEN = require('../../content/bots/stimmen.json');

const TTS_MS = 8000;   // kuerzer als beim Gespraech: ein Status ist ein Satz
const PARALLEL = 3;    // hoechstens so viele Status-Anfragen zugleich bei der Voicebox (je Bot einer Runde)
const aktiv = () => Dienste.voiceboxAktiv();
let zaehler = 0;
const neueGid = () => 's' + (++zaehler).toString(36) + crypto.randomBytes(3).toString('hex');
const neueRunde = () => 'r' + (++zaehler).toString(36) + crypto.randomBytes(3).toString('hex');

const laufend = new WeakMap();   // spieler -> aktuelle Runde { id }
let belegt = 0;
const wartende = [];             // { runde, weiter }
function platz(runde) {
  return new Promise((resolve) => {
    if (belegt < PARALLEL) { belegt++; return resolve(true); }
    wartende.push({ runde, weiter: resolve });
  });
}
function frei() {
  belegt--;
  while (wartende.length && belegt < PARALLEL) {
    const w = wartende.shift();
    if (w.runde.gueltig) { belegt++; return w.weiter(true); }
    w.weiter(false);   // die Runde wurde ersetzt: sie braucht keinen Platz mehr
  }
}
const profilVon = (botId) => { const f = Figuren.figurMitId(botId); return f ? (STIMMEN[f.stimme] || {}).profilName || null : null; };
const sprechbar = (a) => !!a && a.befehl === 'bot.status' && a.status === 'ok' && typeof a.text === 'string' && !!a.text && typeof a.botId === 'string' && !!profilVon(a.botId);

// Vor dem Senden der Antworten: eine neue Runde beginnt, die alte des Spielers wird ungueltig; die sprechbaren Antworten bekommen tonRunde. Gibt die Runde zurueck (oder null: es wird nichts gesprochen).
function vorbereiten(game, spieler, antworten) {
  try {
    if (!aktiv() || !game || !spieler) return null;
    const alt = laufend.get(spieler); if (alt) alt.gueltig = false;
    laufend.delete(spieler);
    const liste = antworten.filter(sprechbar);
    if (!liste.length) return null;
    const runde = { id: neueRunde(), gueltig: true, game, runId: game.runId };
    for (const a of liste) a.tonRunde = runde.id;
    laufend.set(spieler, runde);
    return runde;
  } catch (e) { return null; }
}

// antworten: dieselben Antworten wie bei vorbereiten (mit botId, befehl 'bot.status', status 'ok', text). Gibt ein Promise zurueck, das nie ablehnt.
async function sprechen(game, spieler, antworten, runde) {
  const bereit = () => runde && runde.gueltig && game.runId === runde.runId && game.phase === 'play' && !!spieler.conn && spieler.connected !== false && game.players.includes(spieler);
  let rest = [];
  try {
    if (!runde || !game || !spieler) return;
    rest = antworten.filter((a) => a && a.tonRunde === runde.id);
    while (rest.length) {
      const a = rest[0];
      if (!(await platz(runde))) return;   // ersetzt, solange sie wartete
      let buf = null, fehler = false;
      try {
        if (bereit()) buf = await Dienste.sprechen({ voice: profilVon(a.botId), text: a.text, timeoutMs: TTS_MS });
      } catch (e) { fehler = true; } finally { frei(); }
      if (!bereit()) return;   // ersetzt, Partie vorbei, Mensch weg: nichts mehr senden (bei Ersetzung meldet die neue Runde sich selbst)
      if (fehler || !buf) break;
      rest.shift();
      const gid = neueGid();
      game.sendTo(spieler.conn, { t: 'bot.rede', botId: a.botId, gid, zustand: 'ton', nr: 0, audio: Audio.ablegen(buf, 'status').url, zu: 'bot.status', runde: runde.id });
      game.sendTo(spieler.conn, { t: 'bot.rede', botId: a.botId, gid, zustand: 'ende', zu: 'bot.status', runde: runde.id });
    }
    if (rest.length && bereit()) game.sendTo(spieler.conn, { t: 'bot.rede', botId: rest[0].botId, gid: neueGid(), zustand: 'ausfall', zu: 'bot.status', runde: runde.id });   // Voicebox weg, 401 oder Zeitlimit: der Rest der Runde ohne Ton
  } catch (e) {
    try { game.countError('bot.statuston', e); } catch (x) { /* egal */ }
    try { if (rest.length && bereit()) game.sendTo(spieler.conn, { t: 'bot.rede', botId: rest[0].botId, gid: neueGid(), zustand: 'ausfall', zu: 'bot.status', runde: runde.id }); } catch (x) { /* egal */ }
  }
}

module.exports = { vorbereiten, sprechen, aktiv, PARALLEL };
