'use strict';
// SUND-04b E3: Wiederholungsregeln fuer Abenteuer (Freie Fahrt Sund, nur mit FAEDEN=1). Ein Abenteuer darf sich nicht in kurzer Folge wiederholen: nicht dieselbe Typenfolge, nicht derselbe Ort mit demselben ersten Beat,
// nicht derselbe NSC als Hauptfigur. Die Zahlen stehen in den Daten (content/faeden/abenteuer-brett.json werte.wiederholung), der Verlauf im Kanon (abenteuer-kanon.js: die zuletzt BEGONNENEN Abenteuer, neueste zuerst).
// Das Brett (abenteuer-brett.js anbieten) erzwingt sie fuer jeden Plan des Spielleiters; der Anschluss-Rueckfall nimmt dieselben Regeln, lockert sie aber STUFENWEISE (zuerst der Ort, dann die Folge, dann der NSC),
// damit er nie verklemmt: die Anschluss-Garantie geht vor. Die Faden-Pruefung selbst (faden-pruefer.js: ist der Plan gueltig?) kennt keine Wiederholung; das ist Angebotspolitik des Bretts.
//
//   pruefe(game, vorlage, hex) -> null | 'CODE: Text'             alle Regeln (Stufe 0)
//   pruefeGelockert(game, vorlage, hex, stufe) -> null | 'CODE: Text'   Stufe 0 alles, 1 ohne Ort, 2 ohne Ort und Folge, ab 3 nichts (STUFEN_MAX)
//   kandidatenFrisch(game, vorlage) -> [NSC-Kennung]              die Kandidaten eines Wiedersehens ohne die Hauptfiguren der letzten Abenteuer
//   kandidatenGelockert(game, vorlage, stufe) -> [NSC-Kennung]    ab Stufe 3 alle Kandidaten
//   zahlenFrisch(game) -> { Volk: Zahl }                          Kontext der Komposition: Zahl der frischen Kandidaten je Volk (nur Zahlen)
//   letzteFolgen(game) -> [[Typ]]                                 die Typenfolgen der letzten Abenteuer (Kontext, ohne Titel und Namen)
const D = require('./faden-daten.js');

const R = D.BRETT.werte.wiederholung, W = D.WERTE, B = D.BEATS;
const Kanon = () => require('./abenteuer-kanon.js');
const Faden = () => require('./faden.js');
const P = () => require('./faden-pruefer.js');
const fehl = (code, text) => `${code}: ${text}`;
const STUFEN_MAX = 3;   // Ort (1), Folge (2), NSC (3): danach gilt keine Sperre mehr

const faden = (game) => (game && game.weltsim && game.weltsim.faeden) || null;
const typenVon = (v) => Kanon().typenVon(v);
const folgeText = (t) => t.join('>');
// die zuletzt begonnenen ABENTEUER (nicht die Fadendateien), neueste zuerst
const verlauf = (game) => { const F = faden(game); return F ? Kanon().liste(F).filter((e) => typeof e.titel === 'string').reverse() : []; };

function folgeFehler(game, v) {
  const f = folgeText(typenVon(v));
  const F = faden(game);
  const e = verlauf(game).slice(0, R.folge_zuletzt).find((x) => folgeText(x.folge) === f) || ((F && F.abenteuerAngebote) || []).find((a) => folgeText(typenVon(a.vorlage)) === f);   // auch ein offenes Angebot gleicher Folge zaehlt: nie dreimal dasselbe auf dem Brett
  return e ? fehl('WIEDERHOLUNG_FOLGE', `dieselbe Typenfolge (${f}) wie eines der letzten ${R.folge_zuletzt} Abenteuer`) : null;
}
function ortFehler(game, v, hex) {
  const erster = typenVon(v)[0];
  const e = verlauf(game).slice(0, R.ort_typ_zuletzt).find((x) => x.ort === hex && x.folge[0] === erster);
  return e ? fehl('WIEDERHOLUNG_ORT', `derselbe Ort (${hex}) mit demselben ersten Beat (${erster}) wie eines der letzten ${R.ort_typ_zuletzt} Abenteuer`) : null;
}
// die Hauptfiguren der letzten Abenteuer (Namen: nur im Server, nie im Prompt)
const juengsteNamen = (game) => new Set(verlauf(game).slice(0, R.nsc_zuletzt).map((e) => e.name));
function kandidaten(game, v) {   // alle Kandidaten eines Wiedersehens (wie der Pruefer sie kennt), juengster zuerst
  return v && P().nscAlt(v) ? Faden().wiedersehenKandidaten(game, v) : [];
}
function kandidatenFrisch(game, v) {
  const F = faden(game);
  if (!F || !v || !P().nscAlt(v)) return [];
  const jung = juengsteNamen(game);
  return P().wiedersehenNsc(F, v).filter((n) => !jung.has(n.name)).map((n) => n.id);
}
const kandidatenGelockert = (game, v, stufe) => (stufe >= STUFEN_MAX ? kandidaten(game, v) : kandidatenFrisch(game, v));
function nscFehler(game, v) {
  if (!P().nscAlt(v)) return null;
  if (kandidatenFrisch(game, v).length) return null;
  return fehl('WIEDERHOLUNG_NSC', `jeder NSC, der sich erinnert, war die Hauptfigur eines der letzten ${R.nsc_zuletzt} Abenteuer`);
}

function pruefeGelockert(game, v, hex, stufe) {
  if (!v || !Array.isArray(v.beats)) return null;
  return (stufe >= 1 ? null : ortFehler(game, v, hex)) || (stufe >= 2 ? null : folgeFehler(game, v)) || (stufe >= STUFEN_MAX ? null : nscFehler(game, v));
}
const pruefe = (game, v, hex) => pruefeGelockert(game, v, hex, 0);

function zahlenFrisch(game) {
  const typ = Object.keys(B).find((t) => B[t].braucht && B[t].braucht.nsc_alt === true);
  const out = {};
  for (const volk of W.voelker) out[volk] = typ ? kandidatenFrisch(game, { beats: [{ typ }], volk_erlaubt: [volk] }).length : 0;
  return out;
}
const letzteFolgen = (game) => verlauf(game).slice(0, R.folge_zuletzt).reverse().map((e) => e.folge.slice());

module.exports = { pruefe, pruefeGelockert, kandidatenFrisch, kandidatenGelockert, zahlenFrisch, letzteFolgen, STUFEN_MAX, verlauf };
