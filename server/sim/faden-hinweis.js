'use strict';
// SUND-04a-2 Nacharbeit (Welle 2, Sichtbarkeit und Fairness): Hinweise der Geschichtsfaeden WERDEN GESENDET. Vorher bestaetigten die Bausteine einen Hinweis nur formal (hinweisGezeigt): die Crew
// sah vor der Enthuellung nie etwas, die Fairness-Regel („vor jeder Enthuellung mindestens ein Hinweis auf jedem Weg“) galt nur auf dem Papier.
//
//   senden(game, fadenId, hinweisId) -> { ok, gesendet?, grund? }
//       Text aus der Vorlage (hinweise.<id>.text, Platzhalter {name} {ort}, Pflicht laut Pruefer HINWEIS_TEXT), Sprecher aus dem Kanal (werte.json hinweis_sprecher: scan, geruecht, papiere;
//       funk = der NSC selbst mit Porträt). Die Funkzeile geht als Lagefunk an alle Clients (radio mit lage und fd), ERST DANACH gilt der Hinweis als gestreut (faden.hinweisGezeigt).
//       Ein Hinweis, der schon gestreut ist, wird nicht noch einmal gesendet (ok, gesendet false). Kann der Baustein nicht senden, gilt der Hinweis nicht (ok false).
const D = require('./faden-daten.js');
const Sektoren = require('../../shared/sektoren.js');
const Faden = () => require('./faden.js');
const Bitte = () => require('./faden-bitte.js');

const hexName = (hex) => { try { return (typeof hex === 'string' && /^\d{4}$/.test(hex) && Sektoren.hexName(hex)) || 'hier'; } catch (e) { return 'hier'; } };
const fmt = (t, v) => String(t).replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? v[k] : m));

function senden(game, fadenId, hinweisId) {
  if (!Faden().aktiv(game)) return { ok: false, grund: 'INAKTIV' };
  const F = Faden().zustandVon(game);
  const f = F && F.liste.find((x) => x.id === fadenId);
  if (!f || f.phase !== 'laeuft' || !f.laufend) return { ok: false, grund: 'kein laufender Beat' };
  const v = D.vorlage(f.vorlage), beat = v && v.beats[f.beat];
  if (!beat || !(beat.hinweise || []).includes(hinweisId)) return { ok: false, grund: 'der laufende Beat hat diesen Hinweis nicht' };
  if (f.hinweise.includes(hinweisId)) return { ok: true, gesendet: false };
  const h = v.hinweise && v.hinweise[hinweisId];
  if (!h || typeof h.text !== 'string' || !h.text.trim()) return { ok: false, grund: 'der Hinweis hat keinen Text' };
  const text = fmt(h.text, { name: f.nsc.name, ort: hexName(f.parameter && f.parameter.ort) });
  const sprecher = Object.prototype.hasOwnProperty.call(D.WERTE.hinweis_sprecher, h.kanal) ? D.WERTE.hinweis_sprecher[h.kanal] : undefined;
  if (sprecher === undefined) return { ok: false, grund: 'der Kanal hat keinen Sprecher' };
  const z = sprecher === null ? Bitte().funkVon(game, f.nsc, text) : Bitte().funkSprecher(game, sprecher, text);
  if (!z) return { ok: false, grund: 'Funk nicht gesendet' };
  const r = Faden().hinweisGezeigt(game, fadenId, hinweisId);
  return r.ok ? { ok: true, gesendet: true } : r;
}

module.exports = { senden };
