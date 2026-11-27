'use strict';
// BOT-05 B1: das freie Gespraech mit einem Bot (Action-Layer). Ein Mensch schreibt (oder spricht) einem Bot einen Satz; der Server antwortet in der Persoenlichkeit der Figur mit dem echten Spielzustand,
// satzweise als Text und als WAV in der Stimme der Figur. Das Gespraech VERAENDERT NICHTS im Spiel und loest nie einen Befehl aus; es laeuft nur lokal (Ollama + Voicebox auf Sleipnir), nie ueber Claude.
//   annehmen(game, spieler, msg)   Client -> Server { t: 'bot.gespraech', an: botId, text, quelle: 'text'|'sprache' }; antwortet NUR dem Fragenden mit { t: 'bot.rede', ... } (siehe unten). Wirft nie.
//   verdrahten({ agent })          einmalig aus game.js: Zugriff auf den Agenten eines Bots (lauf.js agent). Dieses Modul laedt lauf.js NICHT (Wirkungsfreiheit, siehe unten); ohne Zugriff steht "unbekannt" in Zustand und Absicht
//   vorwaermen(game)               mit BOT_GESPRAECH_VORWAERMEN=1 beim Start einer Partie mit Bots: Ollama und Voicebox anwaermen (sonst nichts)
//   beenden(game)                  alle laufenden Anfragen des Games abbrechen (nur Tests, Partieende prueft die runId selbst)
// Nachricht bot.rede (Server -> Client, direkt, keine event-Huelle): { t, botId, gid, zustand, nr?, text?, audio?, grund? }
//   gid     Gespraechs-ID je Anfrage (jede Anfrage bekommt eine, auch die abgelehnte)
//   zustand denkt (sofort nach der Annahme) | satz (nr ab 0, text) | ton (nr, audio = URL /api/bot-rede/<id>.wav; ohne audio, wenn die Sprachausgabe ausfaellt) | ende
//           | nicht_erreichbar (LLM nicht erreichbar oder Zeitlimit ohne Antwort; grund: 'llm' | 'zeit' | 'leer') | abgelehnt (grund: kein_bot | phase | rate | text | quelle | ersetzt)
//   Reihenfolge je gid: denkt, dann satz 0, ton 0 (oder spaeter), satz 1, ...; ton kommt je nr genau einmal und in Satzreihenfolge; zum Schluss genau ein ende (oder nicht_erreichbar/abgelehnt als Abschluss).
// Ablauf: je Mensch eine Anfrage (eine neue ersetzt die alte, auch eine laufende: die alte bekommt abgelehnt/ersetzt); global hoechstens eine LLM-Anfrage zugleich; Rate-Limit je Spieler (Standard 6 je Minute);
//   Zeitlimits (Env): erstes Token und gesamt je 30 s (gespraech-dienste.js), TTS 30 s je Satz. Hoechstens 3 Saetze werden gesprochen. Faellt die Sprachausgabe aus, kommen die Saetze als Text, ton ohne audio.
//   Wartezeit in der Schlange hoechstens 20 s (BOT_GESPRAECH_WARTE_MS): danach nicht_erreichbar mit grund 'zeit' (B-Nacharbeit K2). Die Voicebox wird nur mit gesetzter VOICEBOX_URL angesprochen (K4), sonst reiner Text.
//   Kommt das Zeitlimit mitten in der Antwort, zaehlt das bisher Gesprochene als Antwort (ende), ohne einen Satz ist es nicht_erreichbar.
// Zustand je Game (WeakMap, zusaetzlich nach runId): laufende Anfragen, Rate, Verlauf (die letzten 3 Wortwechsel je Bot, nie im Weltstand), Entprellung des Gedaechtnis-Hakens. Die Warteschlange fuer das LLM ist prozessweit.
// Wirkungsfreiheit: lesend (Spielzustand, Gedaechtnis); die einzige Ausnahme ist Gedaechtnis.gespraech (hoechstens einmal je 10 Minuten Spielzeit und Bot, nur „sprach mit dem Captain“, nie der Inhalt).
//   Dieses Modul und seine Hilfsmodule laden weder bots/annahme.js noch bots/befehle/*, lauf.js, absicht.js, mission/llm.js, transport-router.js oder transport-ollama.js (Quellscan in tools/test-bot-gespraech.js).
//   Der Anzeigename des Captains kommt nur in den lokalen Prompt (gespraech-prompt.js), nie in einen Spielleiter-Kontext oder an Claude.
const crypto = require('crypto');
const Crew = require('../sim/crew.js');
const Figuren = require('./figuren.js');
const Gedaechtnis = require('./gedaechtnis.js');
const Prompt = require('./gespraech-prompt.js');
const Dienste = require('./gespraech-dienste.js');
const Audio = require('./gespraech-audio.js');
const STIMMEN = require('../../content/bots/stimmen.json');

const TYPE_REDE = 'bot.rede';
const TEXT_MAX = 200;
const QUELLEN = ['text', 'sprache'];
const BOT_ID = /^b[0-9]$/;
const SAETZE_MAX = 3;
const SATZ_MIN = 12;
const SATZ_ZEICHEN_MAX = 300;
const VERLAUF_MAX = 3;
const HAKEN_PAUSE_S = 600;   // Gedaechtnis-Haken: hoechstens einmal je 10 Minuten Spielzeit und Bot
const RATE_FENSTER_MS = 60000;
const RATE_STANDARD = 6;
const WARTE_STANDARD_MS = 20000;   // so lange wartet eine Anfrage hoechstens auf das LLM, das eine andere Anfrage belegt
const warteMs = () => { const n = Number(process.env.BOT_GESPRAECH_WARTE_MS); return Number.isFinite(n) && n > 0 ? n : WARTE_STANDARD_MS; };

let agentQuelle = null;
function verdrahten(o) { agentQuelle = o && typeof o.agent === 'function' ? o.agent : null; }

// ---------- Zustand je Game ----------
const ZUSTAND = new WeakMap();
function zustand(game) {
  let z = ZUSTAND.get(game);
  if (z && z.runId !== game.runId) { for (const r of z.anfragen.values()) abbrechen(r); z = null; }   // neue Partie: alles zurueck
  if (!z) { z = { runId: game.runId, anfragen: new Map(), rate: new Map(), verlauf: new Map(), hakenT: new Map(), warm: false }; ZUSTAND.set(game, z); }
  return z;
}
let gidZaehler = 0;
const neueGid = () => 'g' + (++gidZaehler).toString(36) + crypto.randomBytes(3).toString('hex');
const spielzeit = (game) => { try { const t = game.mission.playTime(); if (Number.isFinite(t)) return t; } catch (e) { /* weiter */ } return Number.isFinite(game.time) ? game.time : 0; };

// ---------- Senden ----------
function gueltig(r) {
  const g = r.game;
  return !r.beendet && g.phase === 'play' && g.runId === r.runId && g.players.includes(r.spieler) && !!r.spieler.conn && r.spieler.connected !== false;
}
function senden(r, msg) {
  if (!gueltig(r)) { abbrechen(r); return false; }
  r.game.sendTo(r.spieler.conn, Object.assign({ t: TYPE_REDE, botId: r.botId, gid: r.gid }, msg));
  return true;
}
function abbrechen(r) {   // still: ohne Nachricht (Partie vorbei, Mensch weg)
  if (r.beendet) return;
  r.beendet = true; r.ac.abort();
  const z = ZUSTAND.get(r.game); if (z && z.anfragen.get(r.spieler.id) === r) z.anfragen.delete(r.spieler.id);
  warteEntfernen(r);
}
function abschluss(r, msg) {   // genau ein Abschluss je Anfrage
  if (r.beendet) return;
  const ok = gueltig(r);
  r.beendet = true; r.ac.abort();
  const z = ZUSTAND.get(r.game); if (z && z.anfragen.get(r.spieler.id) === r) z.anfragen.delete(r.spieler.id);
  warteEntfernen(r);
  if (ok) r.game.sendTo(r.spieler.conn, Object.assign({ t: TYPE_REDE, botId: r.botId, gid: r.gid }, msg));
}

// ---------- globale Warteschlange: hoechstens eine LLM-Anfrage zugleich ----------
const warteschlange = [];
let llmBelegt = false;
// Ergebnis: true (LLM gehoert der Anfrage), false (beendet, solange sie wartete), 'zeit' (Wartelimit)
function erwerben(r) {
  return new Promise((resolve) => {
    if (r.beendet) return resolve(false);
    if (!llmBelegt) { llmBelegt = true; return resolve(true); }
    const timer = setTimeout(() => warteEntfernen(r, 'zeit'), warteMs());
    if (timer.unref) timer.unref();
    r.warte = { resolve: (v) => { clearTimeout(timer); resolve(v); } }; warteschlange.push(r);
  });
}
function warteEntfernen(r, wert) {
  const i = warteschlange.indexOf(r);
  if (i >= 0) { warteschlange.splice(i, 1); const w = r.warte; r.warte = null; if (w) w.resolve(wert === undefined ? false : wert); }
}
function freigeben() {
  const n = warteschlange.shift();
  if (n) { const w = n.warte; n.warte = null; w.resolve(true); } else llmBelegt = false;
}

// ---------- Saetze ----------
// Satzgrenze: [.!?] (mit eventuellen Schlusszeichen) plus Leerraum; ein Satz hat mindestens SATZ_MIN Zeichen (sonst wird bis zur naechsten Grenze weitergelesen: "Kurs 270. Dann ..." bleibt zusammen)
function naechsterSatz(puffer) {
  const re = /[.!?]+["“”»)]*\s/g;
  let m;
  while ((m = re.exec(puffer))) {
    const ende = m.index + m[0].length;
    if (puffer.slice(0, ende).trim().length >= SATZ_MIN) return { satz: puffer.slice(0, ende), rest: puffer.slice(ende) };
  }
  return null;
}
const EMOJI = /[\p{Extended_Pictographic}️‍]/gu;
function saeubern(s) {
  return String(s).replace(/[*_#`~|<>]/g, '').replace(EMOJI, '').replace(/\s+/g, ' ').trim().replace(/^["„“»]+|["“”«]+$/g, '').trim().slice(0, SATZ_ZEICHEN_MAX);
}
const hatInhalt = (s) => /[\p{L}\p{N}]/u.test(s);

// ---------- Ablauf einer Anfrage ----------
async function laufen(r) {
  const game = r.game;
  const profil = (STIMMEN[r.figur.stimme] || {}).profilName || null;
  const saetze = [];
  let puffer = '', genug = false, ohneTon = false, ttsKette = Promise.resolve();
  const llmAc = new AbortController();
  r.ac.signal.addEventListener('abort', () => llmAc.abort(), { once: true });

  const ton = async (nr, text) => {
    if (r.beendet) return;
    if (!ohneTon && profil && Dienste.voiceboxAktiv()) {
      try {
        const buf = await Dienste.sprechen({ voice: profil, text, signal: r.ac.signal });
        if (r.beendet) return;
        senden(r, { zustand: 'ton', nr, audio: Audio.ablegen(buf).url });
        return;
      } catch (e) {
        if (r.beendet) return;
        ohneTon = true;   // Voicebox weg, 401 oder Zeitlimit: der Rest der Antwort ohne Ton, kein Warten je Satz
      }
    }
    senden(r, { zustand: 'ton', nr });
  };
  const satzAus = (roh) => {
    if (genug) return;
    const text = saeubern(roh);
    if (!text || !hatInhalt(text)) return;
    const nr = saetze.length;
    saetze.push(text);
    if (!senden(r, { zustand: 'satz', nr, text })) return;
    ttsKette = ttsKette.then(() => ton(nr, text));
    if (saetze.length >= SAETZE_MAX) { genug = true; llmAc.abort(); }
  };
  const onText = (c) => {
    if (genug) return;
    puffer += c;
    let x;
    while (!genug && (x = naechsterSatz(puffer))) { puffer = x.rest; satzAus(x.satz); }
  };

  let ergebnis = null, fehlerCode = null;
  const erlaubt = await erwerben(r);
  if (erlaubt === 'zeit') return abschluss(r, { zustand: 'nicht_erreichbar', grund: 'zeit' });   // zu lange in der Schlange gewartet
  if (!erlaubt) return;
  try {
    if (!gueltig(r)) return;
    const agent = agentQuelle ? (() => { try { return agentQuelle(game, r.bot); } catch (e) { return null; } })() : null;
    const verlauf = zustand(game).verlauf.get(r.botId) || [];
    const p = Prompt.baue({ game, bot: r.bot, agent, figur: r.figur, captain: r.spieler.name, text: r.text, verlauf });
    ergebnis = await Dienste.ollamaStrom({ messages: p.messages, signal: llmAc.signal, onText });
  } catch (e) {
    fehlerCode = e && e.code === 'nicht_erreichbar' ? (/Zeitlimit/.test(e.message) ? 'zeit' : 'llm') : 'intern';
    if (fehlerCode === 'intern') game.countError('bot.gespraech', e);
  } finally {
    freigeben();
  }
  if (r.beendet) return;
  if (!genug && puffer.trim()) satzAus(puffer);   // Rest ohne Satzende (Ende des Stroms, Zeitlimit, num_predict)
  if (!saetze.length) {
    const zeit = ergebnis && ergebnis.ende === 'zeit';
    return abschluss(r, { zustand: 'nicht_erreichbar', grund: fehlerCode === 'intern' ? 'llm' : fehlerCode || (zeit ? 'zeit' : 'leer') });
  }
  await ttsKette;
  if (r.beendet) return;
  abschluss(r, { zustand: 'ende' });
  fertig(r, saetze);
}

// nach einem erfolgreichen Gespraech: Verlauf (letzte 3 Wortwechsel je Bot, nur im Prozessspeicher) und der Gedaechtnis-Haken (entprellt)
function fertig(r, saetze) {
  const game = r.game;
  const z = zustand(game);
  if (z.runId !== r.runId) return;
  const l = z.verlauf.get(r.botId) || [];
  l.push({ von: r.spieler.name, frage: r.text, antwort: saetze.join(' ') });
  while (l.length > VERLAUF_MAX) l.shift();
  z.verlauf.set(r.botId, l);
  const t = spielzeit(game), alt = z.hakenT.get(r.botId);
  if (alt === undefined || t - alt >= HAKEN_PAUSE_S || t < alt) {
    z.hakenT.set(r.botId, t);
    try { Gedaechtnis.gespraech(game, r.botId); } catch (e) { game.countError('bot.gespraech.gedaechtnis', e); }
  }
}

// ---------- Eingang ----------
const bereinigt = (s) => String(s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const rateMax = () => { const n = Number(process.env.BOT_GESPRAECH_RATE_PRO_MINUTE); return Number.isFinite(n) && n > 0 ? n : RATE_STANDARD; };
function rateFrei(z, spieler) {
  const t = Date.now();
  const l = (z.rate.get(spieler.id) || []).filter((x) => t - x < RATE_FENSTER_MS);
  if (l.length >= rateMax()) { z.rate.set(spieler.id, l); return false; }
  l.push(t); z.rate.set(spieler.id, l);
  return true;
}

function annehmen(game, spieler, msg) {
  try {
    if (!spieler || !spieler.conn || Crew.istBot(spieler) || !msg || typeof msg !== 'object') return;
    game.missionEvent('botGespraech', { p: spieler });   // TRA-01 E: Ereignis fuer die Trainingserkennung (bot_gespraech), unabhaengig vom Ausgang der Anfrage; ohne Wirkung auf das Spiel
    const an = typeof msg.an === 'string' && BOT_ID.test(msg.an) ? msg.an : null;
    const ablehnen = (grund) => game.sendTo(spieler.conn, { t: TYPE_REDE, botId: an, gid: neueGid(), zustand: 'abgelehnt', grund });
    if (game.phase !== 'play') return ablehnen('phase');
    const z = zustand(game);
    const bot = an ? game.players.find((p) => p && p.bot && p.connected && p.botId === an) : null;
    const figur = bot ? Figuren.figurMitId(bot.botId) : null;
    if (!bot || !figur) return ablehnen('kein_bot');
    if (typeof msg.quelle !== 'string' || !QUELLEN.includes(msg.quelle)) return ablehnen('quelle');
    const text = typeof msg.text === 'string' ? bereinigt(msg.text) : '';
    if (!text || text.length > TEXT_MAX || !hatInhalt(text)) return ablehnen('text');
    if (!rateFrei(z, spieler)) return ablehnen('rate');
    const alt = z.anfragen.get(spieler.id);
    const r = { game, runId: game.runId, spieler, bot, botId: an, figur, text, quelle: msg.quelle, gid: neueGid(), ac: new AbortController(), beendet: false, warte: null };
    if (alt) { abschluss(alt, { zustand: 'abgelehnt', grund: 'ersetzt' }); }
    z.anfragen.set(spieler.id, r);
    senden(r, { zustand: 'denkt' });
    laufen(r).catch((e) => { game.countError('bot.gespraech', e); abschluss(r, { zustand: 'nicht_erreichbar', grund: 'llm' }); });
  } catch (e) { try { game.countError('bot.gespraech', e); } catch (x) { /* egal */ } }
}

function beenden(game) { const z = ZUSTAND.get(game); if (z) for (const r of Array.from(z.anfragen.values())) abbrechen(r); }

// optional (BOT_GESPRAECH_VORWAERMEN=1): beim Start einer Partie mit Bots das Modell laden und die Stimme anwaermen; ein Mal je Partie, ohne Wirkung auf das Spiel, Fehler werden verschluckt
function vorwaermen(game) {
  try {
    if (!/^(1|true|on|an)$/i.test(String(process.env.BOT_GESPRAECH_VORWAERMEN || ''))) return false;
    const bot = (game.players || []).find((p) => p && p.bot && Figuren.figurMitId(p.botId));
    if (!bot) return false;
    const z = zustand(game);
    if (z.warm) return false;
    z.warm = true;
    const profil = (STIMMEN[Figuren.figurMitId(bot.botId).stimme] || {}).profilName || null;
    Dienste.vorwaermen(profil).catch(() => { /* egal */ });
    return true;
  } catch (e) { return false; }
}

module.exports = { annehmen, verdrahten, vorwaermen, beenden, naechsterSatz, TYPE_REDE, TEXT_MAX, VERLAUF_MAX, HAKEN_PAUSE_S };
