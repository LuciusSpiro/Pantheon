'use strict';
// SPL-02 E2: die Namenslisten der Welt als Wortmengen (Action-Layer ohne Zustand ausser dem Zwischenspeicher): Vor- und Nachnamen (namen.json), Schiffsnamen, Kommandanten (kommandanten.json) und die Ortsnamen der
// gesetzten Karte. Gebraucht von zwei Pruefern: dem Pruefer der Absichten (absicht-pruefer.js, TEXT_UNZULAESSIG) und dem Pruefer der Zeilen mit Bezug (texte-pruefer.js, Namen nur als Platzhalter). Der Zwischenspeicher
// gilt je Karte (Shared_Sektoren.setzeKarte ersetzt KARTE): wer die Karte wechselt, bekommt neue Ortsnamen.
//
//   namenMengen() -> { tokens: Set<Wort>, phrasen: [Name] }      Woerter (Gross-/Kleinschreibung zaehlt) und Mehrwortnamen
//   kommandantenNamen() -> [Name]       woerter(text) -> [Wort]       alsPhrase(text, phrase) -> bool (ganze Woerter, Gross-/Kleinschreibung egal)
//   istEigenname(N, gewoehnlich, frei, wort) -> bool     ein Wort der Namenslisten, nicht frei (der Bezug) und nicht in `gewoehnlich` (Menge kleingeschriebener Woerter: Dorn, Rabe)
//   klartextNamen(text, gewoehnlich: [Wort]) -> [Name]     Eigennamen im Klartext (Platzhalter {..} zaehlen nicht)
const D = require('./faden-daten.js');
const Sektoren = () => require('../../shared/sektoren.js');
const KOMMANDANTEN = () => require('../../content/welt/kommandanten.json').kommandanten;

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const woerter = (t) => String(t).match(/[\p{L}][\p{L}'-]*/gu) || [];
const alsPhrase = (t, p) => new RegExp('(^|[^\\p{L}])' + esc(p) + '(?![\\p{L}])', 'iu').test(t);
const teile = (n) => String(n).trim().split(/\s+/);
const kommandantenNamen = () => [].concat(...Object.values(KOMMANDANTEN())).map((k) => k.name);

let cache = null, cacheKarte;
function namenMengen() {
  const karte = Sektoren().KARTE;
  if (cache && cacheKarte === karte) return cache;
  const tokens = new Set(), phrasen = new Set();
  for (const L of Object.values(D.NAMEN)) {
    for (const n of L.vornamen.concat(L.nachnamen)) tokens.add(n);
    for (const s of L.schiffe) phrasen.add(s);
  }
  for (const n of kommandantenNamen()) {
    const t = teile(n);
    if (t.length === 1) { if (n.length >= 4) tokens.add(n); } else { phrasen.add(n); const l = t[t.length - 1]; if (l.length >= 4) tokens.add(l); }
  }
  try { for (const h of Object.values(karte.hexe)) if (h && typeof h.name === 'string' && h.name.length >= 4 && h.name !== '?') phrasen.add(h.name); } catch (e) { /* ohne Karte: keine Ortsnamen */ }
  cache = { tokens, phrasen: Array.from(phrasen) };
  cacheKarte = karte;
  return cache;
}
// Gilt dieses Wort als Eigenname (SPL-02 C0)? Ja, wenn es gross geschrieben in den Namenslisten steht (Vorname, Nachname, Kommandant) und weder der Bezug (frei) noch in der Datenliste gewoehnliche_woerter steht (Dorn, Rabe:
// auch ein deutsches Wort). Auch am Satzanfang: dort sagt die Grossschreibung nichts, aber ein Wort ausserhalb der Listen ist ohnehin kein Name; ein Listenwort bleibt einer.
const istEigenname = (N, gewoehnlich, frei, w) => N.tokens.has(w) && !frei.has(w) && !gewoehnlich.has(w.toLowerCase());

function klartextNamen(text, gewoehnlichListe) {
  const t = String(text == null ? '' : text).replace(/\{\w+\}/g, ' ');
  const N = namenMengen();
  const gewoehnlich = new Set((gewoehnlichListe || []).map((x) => String(x).toLowerCase()));
  const out = [];
  for (const w of woerter(t)) if (istEigenname(N, gewoehnlich, new Set(), w)) out.push(w);
  for (const p of N.phrasen) if (!(teile(p).length === 1 && gewoehnlich.has(p.toLowerCase())) && alsPhrase(t, p)) out.push(p);
  return Array.from(new Set(out));
}

module.exports = { namenMengen, kommandantenNamen, woerter, alsPhrase, istEigenname, klartextNamen, teile };
