'use strict';
// LIV-01 A1: Kontingent-Schranke des Token-Zählers (server/mission/llm.js, EIN Zähler je Serverlauf). Action-Layer wie abenteuer-brett.js. Der Zähler bekommt eine Schwelle (90 % des Limits, bei 500 000 also 450 000):
// ab used >= schwelle fragen Lage-, Abenteuer- und Missions-Spielleiter das Modell nicht mehr (kein CLI-Prozess), der bestehende Rückfallpfad greift, das Spiel bleibt spielbar. Die Spielleiter fragen DIESES Modul
// (eine zentrale Stelle), sie bekommen keine Flag durchgereicht. Die Schwelle ist das einzige Gate; das alte min_budget-Gate wird auf den Abstand Limit - Schwelle gedeckelt (mindestRest).
// LIV-02 P1: Kontingent-Ende ist eine Systeminfo, kein Spielinhalt: kein Funk, kein Snapshot-Feld, kein Notbetrieb-Hinweis. Der Server meldet das Erreichen EINMAL je Schwelle: Systemzeile im Server-Log
// ("[Kontingent] ...", game.log), Regie-Logbuch (art kontingent, ausgang erreicht) und eine offene Frage "Limit erhoehen?". Die Frage geht per Einmal-Ereignis kontingentFrage { pid } (ohne Zahlen) NUR an den Spieler
// mit p.color === 0 (blaue Markierung, erster Slot); sie bleibt offen, bis er antwortet, und wird beim Beitritt/Wiederverbinden/Uebernahme eines Spielers mit color 0 erneut zugestellt. Ja = Befehl kontingent.freigeben,
// Nein = Befehl kontingent.ablehnen (eigene Funktion, kein Flag): Nein ist Nein, fuer dieselbe Schwelle keine neue Frage und keine Freigabe mehr. Der Zaehler gehoert nicht zum Weltstand (Version 3 unveraendert).
//
//   live(game)               Live-Modus (Env des Spiels)
//   schwelle()               Schwelle des laufenden Limits (90 %, plus alle Freigaben)
//   erreicht()               used >= schwelle (rein lesend)
//   pruefen(game)            erreicht() und meldet das Erreichen einmal je Schwelle (Systemzeile, Logbuch, Frage oeffnen und zustellen); -> erreicht
//   sperrt(game, minBudget)  das Gate der drei Spielleiter: pruefen(game) oder Rest < mindestRest(minBudget)
//   sperrtClaude(game, llm, kind, stufe, minBudget)  wie sperrt, aber nur fuer Anfragen, die an Claude gehen (Ollama-Stufe: false); sperrtEskalation(game, minBudget): jede Eskalation geht an Claude
//   mindestRest(minBudget)   min(minBudget, Limit - Schwelle); ist das Limit hoechstens minBudget, bleibt minBudget (Anfragen waeren ohnehin unmoeglich)
//   frageZustellen(game, p)  offene Frage an p, wenn p.color === 0 und verbunden (ohne p: an den Spieler mit color 0); nur in der Spielphase (nicht in der Lobby) und im Live-Spielleiter dieser Partie (nicht im Rueckfall); sonst nichts.
//                            startGame stellt eine noch offene Frage beim Start nach. Frage und "Nein" gehoeren wie der Zaehler zum Prozess, nicht zur Partie (bewusst: Nein ist Nein)
//   freigeben(game)          Befehl kontingent.freigeben: Limit UND Schwelle +500 000, nur wenn erreicht, nicht abgelehnt (Einmal-Sperre) und eine OFFENE Frage der aktuellen Schwelle steht -> null | { code, text }; schliesst die Frage; Logbuch
//   ablehnen(game)           Befehl kontingent.ablehnen: schliesst die offene Frage fuer diese Schwelle endgueltig -> null | { code, text }; Logbuch
//   weigerung(code)          { code, text }  (codes: nicht_erreicht, abgelehnt, keine_frage, fehler)
const LLM = require('../mission/llm.js');

const FREIGABE = 500000;
const MIN_BUDGET = 30000;                        // Standard-Rest für Aufrufer ohne eigenen Wert (Text-Pool); die Spielleiter geben ihr min_budget mit
const ANTEIL_ZAEHLER = 9, ANTEIL_NENNER = 10;   // Schwelle = 90 % des Limits (ganzzahlig gerechnet)
const LOG_PRAEFIX = '[Kontingent] ';
const FRAGE_FARBE = 0;                           // die Frage gehoert dem Spieler mit p.color === 0 (PLAYER_COLORS[0], blau)
const TEXTE = {
  nicht_erreicht: 'Das Kontingent ist noch nicht aufgebraucht.',
  abgelehnt: 'Das Limit wurde abgelehnt; fuer diese Schwelle wird nicht erneut gefragt.',
  keine_frage: 'Es gibt keine offene Frage zum Limit.',
  fehler: 'Die Freigabe ist fehlgeschlagen.',
};

const weigerung = (code) => ({ code, text: Object.prototype.hasOwnProperty.call(TEXTE, code) ? TEXTE[code] : code });
const live = (game) => { const e = (game && game.env) || process.env; return String(e.SPIELLEITER_LLM || '').toLowerCase() === 'live' && e.LLM_LIVE === '1'; };

function schwelle() {
  const plus = LLM.budgetPlus();
  const b = LLM.budget();
  return Math.floor(((b.limit - plus) * ANTEIL_ZAEHLER) / ANTEIL_NENNER) + plus;
}
function erreicht() { return LLM.budget().used >= schwelle(); }
function mindestRest(minBudget) {
  const b = LLM.budget();
  if (b.limit <= minBudget) return minBudget;
  return Math.min(minBudget, b.limit - schwelle());
}

const logbuch = (game, e) => { try { require('./regie-befehle.js').schreibe(game, Object.assign({ art: 'kontingent' }, e)); } catch (err) { if (game && game.countError) game.countError('kontingent-logbuch', err); } };
const zustand = (game) => { if (!game.kontingent) game.kontingent = { gemeldetBei: null }; return game.kontingent; };

function pruefen(game) {
  if (!erreicht()) return false;
  const s = schwelle();
  const z = game ? zustand(game) : null;
  if (z && z.gemeldetBei !== s) {
    z.gemeldetBei = s;   // zuerst merken: auch ein Fehler in der Systemzeile meldet nicht zweimal
    z.frage = { schwelle: s, offen: true, abgelehnt: false };   // die Frage nur im Live-Modus (sonst zaehlt kein Modell gegen das Limit)
    const b = LLM.budget();
    try { if (typeof game.log === 'function') game.log(`${LOG_PRAEFIX}Limit erreicht (${b.used} von ${b.limit}, Schwelle ${s}): die Spielleiter fragen das Modell nicht mehr.`); } catch (e) { if (game.countError) game.countError('kontingent-log', e); }
    logbuch(game, { ausgang: 'erreicht', begruendung: `Kontingent erreicht (${b.used} von ${b.limit}, Schwelle ${s}): Spielleiter fragen nicht mehr`, budget: { used: b.used, limit: b.limit } });
    frageZustellen(game);
  }
  return true;
}
// Offene Frage als Einmal-Ereignis an den Spieler mit color 0 (ohne Zahlen). Aufruf beim Erreichen und nach dem welcome eines Spielers (dann mit p).
function frageZustellen(game, p) {
  try {
    const z = game && game.kontingent;
    if (!z || !z.frage || !z.frage.offen) return false;
    if (game.phase === 'lobby' || !live(game)) return false;   // LIV-02 Nacharbeit: nur in der Spielphase und nur im Live-Spielleiter dieser Partie (in der Lobby werden Befehle verworfen); startGame stellt beim Start nach
    const ziel = p || (Array.isArray(game.players) ? game.players.find((o) => o && o.color === FRAGE_FARBE && o.connected && o.conn) : null);
    if (!ziel || ziel.color !== FRAGE_FARBE || !ziel.conn || typeof game.sendTo !== 'function') return false;
    game.sendTo(ziel.conn, { t: 'event', kind: 'kontingentFrage', pid: ziel.id });
    return true;
  } catch (e) { if (game && game.countError) game.countError('kontingent-frage', e); return false; }
}
function sperrt(game, minBudget) { const mb = minBudget == null ? MIN_BUDGET : minBudget; return pruefen(game) || LLM.budget().remaining < mindestRest(mb); }
// Jeder Weg zu Claude fragt hier: die Eskalation geht immer an Claude; eine normale Anfrage nur, wenn die Stufe nicht bei Ollama liegt. Ollama zählt nicht gegen den Zähler und bleibt frei.
function sperrtClaude(game, llm, kind, stufe, minBudget) {
  if (!llm || llm.mode !== 'live') return false;
  if (typeof llm.anbieterFuer === 'function' && llm.anbieterFuer(kind, stufe) === 'ollama') return false;
  return sperrt(game, minBudget);
}
function sperrtEskalation(game, minBudget) { return sperrt(game, minBudget); }

function freigeben(game) {
  if (!erreicht()) return weigerung('nicht_erreicht');   // Einmal-Sperre: nach der Freigabe liegt used unter der neuen Schwelle, ein zweiter Druck erhoeht nichts
  const z = game ? zustand(game) : null;
  if (z && z.frage && z.frage.schwelle === schwelle() && z.frage.abgelehnt) return weigerung('abgelehnt');   // Nein ist Nein: keine Freigabe fuer diese Schwelle
  if (!(z && z.frage && z.frage.offen && z.frage.schwelle === schwelle() && live(game))) return weigerung('keine_frage');   // LIV-02 Nacharbeit: wie ablehnen nur auf eine OFFENE Frage der aktuellen Schwelle (nie ohne pruefen(), nie im Nicht-Live-Betrieb: die Frage bleibt dann offen, wird aber nicht zugestellt und nicht beantwortet, bis der Live-Spielleiter laeuft)
  const vor = LLM.budget();
  const b = LLM.raiseBudget(FREIGABE);
  if (z && z.frage) z.frage.offen = false;
  logbuch(game, { ausgang: 'freigabe', begruendung: `Kontingent freigegeben: +${FREIGABE} (Limit ${vor.limit} -> ${b.limit}, Schwelle ${schwelle()}, verbraucht ${b.used})`, budget: { used: b.used, limit: b.limit } });
  return null;
}
function ablehnen(game) {
  const z = game ? zustand(game) : null;
  if (!z || !z.frage || !z.frage.offen || z.frage.schwelle !== schwelle() || !live(game)) return weigerung('keine_frage');   // ohne offene Frage (auch nach Antwort) wirkungslos
  z.frage.offen = false; z.frage.abgelehnt = true;
  const b = LLM.budget();
  logbuch(game, { ausgang: 'abgelehnt', begruendung: `Kontingent abgelehnt (${b.used} von ${b.limit}, Schwelle ${z.frage.schwelle}): keine weitere Frage fuer diese Schwelle`, budget: { used: b.used, limit: b.limit } });
  return null;
}

module.exports = { FREIGABE, MIN_BUDGET, sperrtClaude, sperrtEskalation, live, schwelle, erreicht, pruefen, sperrt, mindestRest, frageZustellen, freigeben, ablehnen, weigerung };
