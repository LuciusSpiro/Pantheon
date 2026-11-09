'use strict';
// LIV-01 A1: Kontingent-Schranke des Token-Zählers (server/mission/llm.js, EIN Zähler je Serverlauf). Action-Layer wie abenteuer-brett.js. Der Zähler bekommt eine Schwelle (90 % des Limits, bei 500 000 also 450 000):
// ab used >= schwelle fragen Lage-, Abenteuer- und Missions-Spielleiter das Modell nicht mehr (kein CLI-Prozess), der bestehende Rückfallpfad greift, das Spiel bleibt spielbar. Die Spielleiter fragen DIESES Modul
// (eine zentrale Stelle), sie bekommen keine Flag durchgereicht. Die Schwelle ist das einzige Gate; das alte min_budget-Gate wird auf den Abstand Limit - Schwelle gedeckelt (mindestRest).
// Der Server meldet das Erreichen EINMAL je Schwelle: Funk „Kontingent aufgebraucht“ und Regie-Logbuch (art kontingent, ausgang erreicht). Snapshot world.kontingent nur im Live-Modus
// (SPIELLEITER_LLM=live und LLM_LIVE=1), sonst bleibt der Snapshot byte-gleich. Der Zähler gehört nicht zum Weltstand (Version 3 unverändert).
//
//   live(game)               Live-Modus (Env des Spiels)
//   schwelle()               Schwelle des laufenden Limits (90 %, plus alle Freigaben)
//   erreicht()               used >= schwelle (rein lesend)
//   pruefen(game)            erreicht() und meldet das Erreichen einmal je Schwelle (Funk nur im Live-Modus, Logbuch immer); -> erreicht
//   sperrt(game, minBudget)  das Gate der drei Spielleiter: pruefen(game) oder Rest < mindestRest(minBudget)
//   mindestRest(minBudget)   min(minBudget, Limit - Schwelle); ist das Limit höchstens minBudget, bleibt minBudget (Anfragen wären ohnehin unmöglich)
//   freigeben(game)          Befehl kontingent.freigeben: Limit UND Schwelle +500 000, nur wenn erreicht (Einmal-Sperre) -> null | { code, text }; Logbuch
//   weigerung(code)          { code, text }  (codes: nicht_erreicht, fehler)
//   snapshotFeld(game) / schluessel(game)   world.kontingent { used, limit, schwelle, erreicht } | null (nicht live); der Schlüssel ändert sich bei Stufe, Erreichen und Freigabe
const LLM = require('../mission/llm.js');

const FREIGABE = 500000;
const ANTEIL_ZAEHLER = 9, ANTEIL_NENNER = 10;   // Schwelle = 90 % des Limits (ganzzahlig gerechnet)
const SCHRITT = 10000;                           // Schlüssel: Zähler grob in Stufen, damit der Snapshot nicht je Anfrage wechselt
const FUNK_VON = 'Bordrechner';
const FUNK_TEXT = 'Kontingent aufgebraucht: der Spielleiter antwortet aus der Konserve, bis die Captain-Konsole weitere 500 000 Tokens freigibt.';
const TEXTE = {
  nicht_erreicht: 'Das Kontingent ist noch nicht aufgebraucht.',
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
    z.gemeldetBei = s;   // zuerst merken: auch ein Fehler im Funk meldet nicht zweimal
    const b = LLM.budget();
    logbuch(game, { ausgang: 'erreicht', begruendung: `Kontingent erreicht (${b.used} von ${b.limit}, Schwelle ${s}): Spielleiter fragen nicht mehr`, budget: { used: b.used, limit: b.limit } });
    if (live(game)) { try { game.emit('radio', { from: FUNK_VON, text: FUNK_TEXT }); } catch (e) { if (game.countError) game.countError('kontingent-funk', e); } }
  }
  return true;
}
function sperrt(game, minBudget) { return pruefen(game) || LLM.budget().remaining < mindestRest(minBudget); }

function freigeben(game) {
  if (!erreicht()) return weigerung('nicht_erreicht');   // Einmal-Sperre: nach der Freigabe liegt used unter der neuen Schwelle, ein zweiter Druck erhöht nichts
  const vor = LLM.budget();
  const b = LLM.raiseBudget(FREIGABE);
  zustand(game).gemeldetBei = null;
  logbuch(game, { ausgang: 'freigabe', begruendung: `Kontingent freigegeben: +${FREIGABE} (Limit ${vor.limit} -> ${b.limit}, Schwelle ${schwelle()}, verbraucht ${b.used})`, budget: { used: b.used, limit: b.limit } });
  return null;
}

function snapshotFeld(game) {
  if (!live(game)) return null;
  const b = LLM.budget();
  return { used: b.used, limit: b.limit, schwelle: schwelle(), erreicht: b.used >= schwelle() };
}
function schluessel(game) {
  if (!live(game)) return null;
  const b = LLM.budget();
  return [Math.floor(b.used / SCHRITT), b.limit, schwelle(), b.used >= schwelle() ? 1 : 0].join('|');
}

module.exports = { FREIGABE, live, schwelle, erreicht, pruefen, sperrt, mindestRest, freigeben, weigerung, snapshotFeld, schluessel };
