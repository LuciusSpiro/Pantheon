'use strict';
// SUND-03b A: Funk-Antworten mit Folgen (Freie Fahrt Sund, game.weltsim). Action-Layer wie absicht.js und reise-ereignis.js. Ausgewählte Reise-Ereignisse OHNE Gefahr (Funkmeldungen, römische Streife,
// Havarie-Notrufe nach dem Dank) bieten der Crew 2 bis 3 Antwortoptionen am Funk; jede Option hat Folgen aus dem Wirkungen-Katalog (ausschließlich ruf_aenderung, Gründe aus content/welt/ruf-werte.json).
// Das GERÜST steht in den Daten (content/reise/ereignisse.json, Feld `antworten` je Eintrag: { id, text, reaktion, folge: [Grund] }), Zahlen und Weigerungstexte in content/reise/werte.json.
// Keine Scheinwahl (die Optionen eines Eintrags haben unterschiedliche Folgen, höchstens eine ist ausdrücklich folgenlos), kein Zeitdruck (das Angebot gilt antwort_gilt_spruenge Sprünge), kein freies Sprechen.
// Bei Gefahr gibt es NIE Optionen (Ausweichen ist dort nicht möglich). Die Option „Nicht antworten“ gibt es immer, sie kostet nichts.
//
// Deckel: der Gewinn an Rom-Ruf aus Antworten ist hart gedeckelt (werte.antwort_rom_max_je_100 je 100 Sprünge), dazu läuft jede Folge unter dem Reise-Ruf-Deckel (ruf_max_je_100; dort zählen nur die Rom-Wirkungen der Antworten, Konkordat-Antworten verdrängen sonst die Rom-Folgen der
// Ereignisse): ohne den Rom-Deckel verkürzten die Antworten die Rangleiter von 02b. Sind sie ausgeschöpft,
// entfallen die Optionen mit Rom-Gewinn aus dem Angebot (keine Scheinwahl: jede angezeigte Option kann ihre Folge auch buchen); bleiben weniger als zwei Optionen, gibt es kein Angebot.
//
// Beim Antworten gilt, was die Crew angeklickt hat (der Text im Angebot, off.optionen), nie ein neu gezogener Text. Die Deckel werden beim Antworten erneut geprüft (zwischen Angebot und Antwort können sie sich füllen):
// ist die Folge nicht mehr buchbar, wird das Angebot zurückgezogen (Code `deckel`), ohne Funk, Chronik und Reaktion.
//
// Zustand: game.weltsim.funkwahl = { lfd, offen: { lfd, id, ev, von, optionen: [{ id, text }], bis } | null, reaktion: { ab, von, text } | null, zuletzt: { lfd, n, id, gebucht } | null, romLog: [[Sprung, Gewinn]] }.
// Er gilt für die ganze Crew, nur der Server schreibt, er steht NICHT im Weltstand (ein offenes Angebot geht beim Laden verloren, das ist ausdrücklich in Ordnung) und nicht im Sim-Zustand.
// Das Angebot zieht keinen Zufall und verändert weder die Entscheidung der Reise-Ereignisse noch die Sim: Sim-Zustand und Ereignisring sind mit und ohne Angebot byte-gleich.
// Schalter: wie die Reise-Ereignisse (REISE_EREIGNISSE / Lage-Spielleiter, reise-ereignis.js aktiv()): ohne Schalter entsteht nie ein Angebot.
//
//   anbieten(game, ev) -> Angebot | null      (Aufrufer: reise-ereignis.js) macht das Angebot, wenn der Eintrag antworten hat, keine Gefahr, ruhige Lage und der Schalter an ist; ein neues ersetzt ein altes
//   nachSprung(game)                          (Aufrufer: reise-ereignis.nachSprung) nach dem Sprungzähler: abgelaufenes Angebot verwerfen
//   update(game)                              (Aufrufer: reise-ereignis.update) Reaktion des Sprechers zeitverzögert senden; Angebot in unruhiger Lage zurückziehen
//   beantworten(game, id, lfd?) -> null | { code, text }   Befehl funk.antworten { id, nr? }: die ERSTE Antwort gilt, jede weitere bekommt „schon beantwortet“; id 'ignorieren' schließt ohne Folge
//   textFuer(ev, slot, optionId, game?) -> { von, text } | null   BENANNTE STELLE für die Texte (slot 'antwort' | 'reaktion'). 'antwort' (Beschriftung der Option) ist IMMER der Katalogtext (Daten): Text und Folge gehören zusammen,
//        ein Modell kennt die Folge nicht (Scheinwahl). 'reaktion' (Antwort des Sprechers): mit TEXTE_POOL zuerst ein Pooltext (setzePool() bzw. poolEntnehmen), sonst der Katalogtext
//   setzePool(fn)                             Paket T: fn(art, id, slot, optionId) -> Text | null (Pool von Gemma-Texten, nur für die Reaktion); Rückfall bei null, Fehler, zu langem Text (texte-werte slots.reaktion.max) oder Spielername = Katalogtext
//   weigerung(code) -> { code, text }         Weigerungstext aus den Daten (für den Server, z. B. 'am_boden')
//   snapshot(game) / schluessel(game)         Anzeigeblock world.funkwahl (null = kein Angebot, Löschsignal) und sein Änderungsschlüssel
const Chronik = require('./chronik.js');
const Ausschnitt = require('./lage-ausschnitt.js');
const RE = require('./reise-ereignis.js');
const Pruefer = require('./texte-pruefer.js');

const W = RE.WERTE;
const QUELLEN = require('../../content/welt/ruf-werte.json').werte.quellen.wert;
const RUF_FENSTER = 100;   // Sprünge, über die der Rom-Deckel zählt (wie der Reise-Ruf-Deckel)
const OPT_MAX = 3;
const REAKTION_MAX = Pruefer.WERTE.slots.reaktion.max;   // dieselbe Zahl wie beim Prüfer des Pools (texte-werte.json): ein Pooltext, der den Prüfer besteht, wird hier nie still verworfen
const IGNORIEREN = 'ignorieren';

const neu = () => ({ lfd: 0, offen: null, reaktion: null, zuletzt: null, romLog: [] });
function zustandVon(game) {
  const ws = game && game.weltsim;
  if (!ws) return null;
  if (!ws.funkwahl) ws.funkwahl = neu();
  return ws.funkwahl;
}
const fehl = (code) => ({ code, text: (W.weigerung && W.weigerung[code]) || code });
const weigerung = fehl;
const optionen = (e) => (e && Array.isArray(e.antworten) ? e.antworten : []);
const optionVon = (e, id) => optionen(e).find((o) => o.id === id) || null;

// ---------- Rom-Deckel: positiver Rom-Gewinn einer Option (Grund und Nebenwirkung `folge`), Raum im Fenster
function romGewinn(gruende) {
  let s = 0;
  for (const g of Array.isArray(gruende) ? gruende : []) {
    const q = QUELLEN[g];
    if (q) s += Math.max(0, (q.fraktion === 'rom' ? q.delta : 0) + ((q.folge && q.folge.rom) || 0));
  }
  return s;
}
// Betrag, den die Option im Reise-Ruf-Deckel kostet (nur die Rom-Wirkungen zählen, siehe RE.gruendeBuchen)
const romBetrag = (gruende) => (Array.isArray(gruende) ? gruende : []).reduce((s, g) => s + (QUELLEN[g] && QUELLEN[g].fraktion === 'rom' ? Math.abs(QUELLEN[g].delta) : 0), 0);
function romRaum(F, n) {
  F.romLog = F.romLog.filter((x) => n - x[0] < RUF_FENSTER);
  return W.antwort_rom_max_je_100 - F.romLog.reduce((s, x) => s + x[1], 0);
}

// Darf die Folge jetzt gebucht werden (Rom-Deckel der Antworten und Reise-Ruf-Deckel)? Dieselbe Regel wie beim Filtern der Optionen im Angebot.
function folgeBuchbar(game, F, gruende) {
  return romGewinn(gruende) <= romRaum(F, game.weltsim.reise.n) + 1e-9 && romBetrag(gruende) <= RE.rufRaum(game) + 1e-9;
}

// ---------- Ruhige Lage: keine Sim-Szene, keine laufende (angekündigte) Gefahr, keine Gegner im Sektor
function ruhig(game) {
  const R = game.weltsim && game.weltsim.reise;
  if (game.simSzene) return false;
  if (R && R.laufend && R.laufend.length) return false;
  return !((game.space && game.space.enemies) || []).length;
}

// ---------- Text (benannte Stelle für Paket T: Pool von Gemma-Texten)
let pool = null;
const setzePool = (fn) => { pool = typeof fn === 'function' ? fn : null; };
// Standard-Quelle: der Pool von Paket T, nur wenn TEXTE_POOL an ist (sonst nie ein Pool-Text); setzePool überschreibt (Tests)
const standardPool = (game) => {
  const P = require('./texte-pool.js');
  return P.aktiv(game) && P.freigegeben() ? P.poolEntnehmen : null;
};
function ausPool(game, art, id, slot, optionId, max) {
  const quelle = pool || standardPool(game);
  if (!quelle) return null;
  try {
    const t = quelle(art, id, slot, optionId);
    const s = typeof t === 'string' ? t.replace(/\s+/g, ' ').trim() : '';
    if (!s || s.length > max) return null;
    if (game && Ausschnitt.ohneNamen(s, Ausschnitt.spielerNamen(game)) !== s) return null;   // nie ein Spielername im Text
    return s;
  } catch (e) { return null; }
}
function textFuer(ev, slot, optionId, game) {
  const e = ev && RE.eintrag(ev.id);
  const o = e && optionVon(e, optionId);
  if (!o || (slot !== 'antwort' && slot !== 'reaktion')) return null;
  if (slot === 'antwort') return { von: W.antwort_von, text: o.text };   // Beschriftung = Daten, nie aus dem Pool
  return { von: e.sprecher || 'Aufklärung', text: ausPool(game, e.art, e.id, slot, o.id, REAKTION_MAX) || o.reaktion };
}
function funkSenden(game, von, text) {
  if (!text) return;
  try { game.emit('radio', { from: von, text, lage: 1, r: 1 }); } catch (e) { if (game.countError) game.countError('funk-antwort', e); }
}

// ---------- Angebot
function anbieten(game, ev) {
  const e = ev && RE.eintrag(ev.id);
  if (!e || e.gefahr || !optionen(e).length) return null;   // bei Gefahr nie Optionen
  if (!RE.aktiv(game) || !ruhig(game)) return null;
  if (game.weltsim.faeden && game.weltsim.faeden.bitte) return null;   // SUND-04a-2 P2: eine offene Bitte der Faeden hat die Leiste (hoechstens eine Antwortleiste)
  const F = zustandVon(game), R = game.weltsim.reise;
  const erlaubt = optionen(e).slice(0, OPT_MAX).filter((o) => folgeBuchbar(game, F, o.folge));   // Optionen, deren Rom-Gewinn die Deckel nicht mehr zuließen, entfallen
  if (erlaubt.length < 2) return null;
  F.offen = {
    lfd: ++F.lfd, id: e.id, ev, von: e.sprecher || 'Aufklärung', bis: R.n + W.antwort_gilt_spruenge,
    optionen: erlaubt.map((o) => ({ id: o.id, text: textFuer(ev, 'antwort', o.id, game).text })),   // Katalogtext der Beschriftung
  };
  return F.offen;
}
function nachSprung(game) {
  const F = game.weltsim && game.weltsim.funkwahl;
  if (F && F.offen && game.weltsim.reise.n > F.offen.bis) F.offen = null;   // verfallen ohne Folge
}
function update(game) {
  const F = game.weltsim && game.weltsim.funkwahl;
  if (!F) return;
  if (F.offen && !ruhig(game)) F.offen = null;   // die Lage ist nicht mehr ruhig: das Angebot verfällt
  if (F.reaktion && game.time >= F.reaktion.ab) { const r = F.reaktion; F.reaktion = null; funkSenden(game, r.von, r.text); }
}

// ---------- Befehl funk.antworten
function beantworten(game, id, lfd) {
  const ws = game.weltsim;
  if (!ws) return fehl('modus');
  if (!RE.aktiv(game)) return fehl('kein_angebot');
  const F = zustandVon(game);
  const off = F.offen;
  if (!off) return fehl(F.zuletzt && F.zuletzt.n === ws.reise.n ? 'schon_beantwortet' : 'kein_angebot');
  if (lfd != null && lfd !== off.lfd) return fehl('kein_angebot');   // der Klick galt einem älteren Angebot (oder trug eine unsinnige Nummer: NaN ist nie gleich)
  if (!ruhig(game)) { F.offen = null; return fehl('unruhig'); }
  const e = RE.eintrag(off.id);
  const kat = id === IGNORIEREN || !off.optionen.some((o) => o.id === id) ? null : optionVon(e, id);   // nur, was im Angebot steht (nicht, was der Rom-Deckel ausgeblendet hat)
  if (id !== IGNORIEREN && !kat) return fehl('unbekannt');
  F.offen = null;
  if (id === IGNORIEREN) { F.zuletzt = { lfd: off.lfd, n: ws.reise.n, id, gebucht: 0 }; return null; }   // kostet nichts, kein Funk, keine Chronik
  if (!folgeBuchbar(game, F, kat.folge)) return fehl('deckel');   // der Deckel hat sich seit dem Angebot gefüllt: das Angebot ist zurückgezogen (F.offen ist schon null), keine Scheinwirkung
  const gezeigt = off.optionen.find((o) => o.id === id);
  const antwort = { von: W.antwort_von, text: gezeigt.text };   // genau der Text, den die Crew angeklickt hat (nicht neu gezogen)
  const gebucht = RE.gruendeBuchen(game, Array.isArray(kat.folge) ? kat.folge : [], 'rom');   // im Reise-Ruf-Deckel zählt nur Rom
  F.zuletzt = { lfd: off.lfd, n: ws.reise.n, id, gebucht };
  const gewinn = romGewinn(kat.folge);
  if (gebucht && gewinn > 0) F.romLog.push([ws.reise.n, gewinn]);   // nur gebuchter Gewinn zählt (entfällt die Folge unter dem Reise-Ruf-Deckel, bleibt der Raum)
  Chronik.eintragen(game, { art: 'reise', ref: off.id, kurz: `Funkantwort an ${off.von}: ${antwort.text}`, param: { art: 'antwort', wahl: id } });
  funkSenden(game, antwort.von, antwort.text);   // alle sehen die Antwort der Crew
  const reaktion = textFuer(off.ev, 'reaktion', id, game);
  F.reaktion = { ab: game.time + W.antwort_reaktion_s, von: reaktion.von, text: reaktion.text };   // der Sprecher antwortet ein paar Sekunden später
  return null;
}

// ---------- Anzeige (nur Daten)
// world.funkwahl = { nr, von: Sprecher, optionen: [{ id, text }] (2 bis 3), ignorieren: Beschriftung, rest: Sprünge bis zum Verfall } | null (kein Angebot; null ist das Löschsignal)
function snapshot(game) {
  const F = game.weltsim && game.weltsim.funkwahl;
  if (!F || !F.offen || !RE.aktiv(game)) return null;
  return { nr: F.offen.lfd, von: F.offen.von, optionen: F.offen.optionen.map((o) => ({ id: o.id, text: o.text })), ignorieren: W.ignorieren_text, rest: Math.max(0, F.offen.bis - game.weltsim.reise.n) };
}
function schluessel(game) {
  const s = snapshot(game);
  return s ? s.nr + ':' + s.rest : null;
}

module.exports = { IGNORIEREN, OPT_MAX, neu, ruhig, romGewinn, romRaum, anbieten, nachSprung, update, beantworten, weigerung, textFuer, setzePool, snapshot, schluessel };
