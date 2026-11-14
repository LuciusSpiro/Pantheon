'use strict';
// KAT-01 0.3: Katalogvarianten NUR zum Messen fuer tools/messe-abenteuer.js (--katalog-variante <name>); kein Spielcode, server/sim/abenteuer-prompt.js bleibt unveraendert.
//   VARIANTEN                                  erlaubte Namen: landeplatz-vorn, landeplatz-hinten-ohne-absatz
//   umbauen(text, variante, beats, opt)        -> neuer Katalogtext; text = Original von AP.katalogText(), beats = D.BEATS (content/faeden/beats.json); wirft bei unbekannter Variante
//       landeplatz-vorn                        die Beat-Zeilen (`- <typ>`, typ aus den Daten) der Beats mit braucht.landeplatz stehen vor allen anderen Beat-Zeilen (je Gruppe Reihenfolge der Daten/des Originals); der Rest bleibt byte-gleich
//       landeplatz-hinten-ohne-absatz          Reihenfolge unveraendert, aber die Zeile, die mit `Landeplatz (Ort fuer die Dauer des Abenteuers` beginnt, entfaellt (Plan-Gueltigkeit dann nicht aussagekraeftig: im Index vermerkt)
//       opt.aus = true schaltet den Umbau ab (nur fuer die Mutationsprobe in tools/test-messe-profil.js)
//   pruefen(original, neu, variante, beats)    -> Liste von Fehlern ([] = ok): gleich viele Zeilen (bei ohne-absatz eine weniger), exakt dieselbe Multimenge der Beat-Zeilen, Reihenfolge bzw. fehlender Absatz wie die Variante verlangt
//   anwenden(AP, variante, beats)              -> { name, zeichen, original_zeichen, differenz, hinweis }; ersetzt AP.katalogText und umhuellt AP.baue (der Katalog steht in baue als <katalog>-Block des Prompts; die lokale Funktion katalogText ist von aussen nicht ersetzbar),
//                                                 Prompt-Laenge und Zeichenzahl des Ergebnisses werden angepasst. Wirft, wenn pruefen() Fehler findet oder der Katalog im Prompt nicht gefunden wird.
const ABSATZ_ANFANG = 'Landeplatz (Ort fuer die Dauer des Abenteuers';
const VARIANTEN = ['landeplatz-vorn', 'landeplatz-hinten-ohne-absatz'];
const HINWEISE = {
  'landeplatz-vorn': null,
  'landeplatz-hinten-ohne-absatz': 'Landeplatz-Absatz fehlt im Katalog: Plan-Gueltigkeit ist nicht aussagekraeftig (nur die Wahl der Beats, nicht die Gueltigkeit des Plans)',
};

function beatTyp(zeile, beats) {
  const m = /^- ([^\s:\[]+)(?=[:\s\[])/.exec(zeile);
  return m && Object.prototype.hasOwnProperty.call(beats, m[1]) ? m[1] : null;
}
const brauchtLandeplatz = (beats, typ) => !!(beats[typ] && beats[typ].braucht && beats[typ].braucht.landeplatz);

function umbauen(text, variante, beats, opt) {
  if (!VARIANTEN.includes(variante)) throw new Error(`unbekannte Katalog-Variante "${variante}" (erlaubt: ${VARIANTEN.join(', ')})`);
  if (opt && opt.aus) return text;
  const zeilen = text.split('\n');
  if (variante === 'landeplatz-hinten-ohne-absatz') return zeilen.filter((z) => !z.startsWith(ABSATZ_ANFANG)).join('\n');
  const idx = [];
  zeilen.forEach((z, i) => { if (beatTyp(z, beats)) idx.push(i); });
  const vorn = idx.filter((i) => brauchtLandeplatz(beats, beatTyp(zeilen[i], beats)));
  const hinten = idx.filter((i) => !brauchtLandeplatz(beats, beatTyp(zeilen[i], beats)));
  const neu = zeilen.slice();
  // die Beat-Zeilen liegen im Original zusammenhaengend; die Plaetze werden neu belegt (Landeplatz-Beats zuerst)
  const reihe = vorn.concat(hinten);
  idx.forEach((platz, k) => { neu[platz] = zeilen[reihe[k]]; });
  return neu.join('\n');
}

function pruefen(original, neu, variante, beats) {
  const f = [];
  const o = original.split('\n'), n = neu.split('\n');
  const oBeat = o.filter((z) => beatTyp(z, beats)), nBeat = n.filter((z) => beatTyp(z, beats));
  if (!oBeat.length) f.push('Original enthaelt keine Beat-Zeile');
  if (oBeat.slice().sort().join('\n') !== nBeat.slice().sort().join('\n')) f.push('Multimenge der Beat-Zeilen weicht ab');
  const abs = o.filter((z) => z.startsWith(ABSATZ_ANFANG)).length;
  if (variante === 'landeplatz-hinten-ohne-absatz') {
    if (abs !== 1) f.push(`Original hat ${abs} Landeplatz-Absaetze (erwartet 1)`);
    if (n.length !== o.length - abs) f.push(`Zeilenzahl ${n.length}, erwartet ${o.length - abs}`);
    if (n.some((z) => z.startsWith(ABSATZ_ANFANG))) f.push('Landeplatz-Absatz steht noch im Katalog');
    if (oBeat.join('\n') !== nBeat.join('\n')) f.push('Reihenfolge der Beat-Zeilen hat sich geaendert');
    if (n.join('\n') !== o.filter((z) => !z.startsWith(ABSATZ_ANFANG)).join('\n')) f.push('Rest weicht ab');
  } else {
    if (n.length !== o.length) f.push(`Zeilenzahl ${n.length}, erwartet ${o.length}`);
    const typen = nBeat.map((z) => beatTyp(z, beats));
    const erstesAnderes = typen.findIndex((t) => !brauchtLandeplatz(beats, t));
    if (erstesAnderes >= 0 && typen.slice(erstesAnderes).some((t) => brauchtLandeplatz(beats, t))) f.push('ein Landeplatz-Beat steht nach einem anderen Beat');
    const gruppe = (zl, ja) => zl.filter((z) => brauchtLandeplatz(beats, beatTyp(z, beats)) === ja).join('\n');
    if (gruppe(oBeat, true) !== gruppe(nBeat, true) || gruppe(oBeat, false) !== gruppe(nBeat, false)) f.push('Reihenfolge innerhalb einer Gruppe hat sich geaendert');
    const nichtBeat = (zl) => zl.filter((z) => !beatTyp(z, beats)).join('\n');
    if (nichtBeat(o) !== nichtBeat(n)) f.push('Zeilen ausserhalb der Beat-Zeilen weichen ab');
  }
  return f;
}

function anwenden(AP, variante, beats) {
  const original = AP.katalogText();
  const neu = umbauen(original, variante, beats);
  const fehler = pruefen(original, neu, variante, beats);
  if (fehler.length) throw new Error('Katalog-Variante ' + variante + ': ' + fehler.join('; '));
  const baue0 = AP.baue;
  const alt = `<katalog>\n${original}\n</katalog>`, nach = `<katalog>\n${neu}\n</katalog>`;
  AP.katalogText = () => neu;
  AP.baue = function (...a) {
    const r = baue0.apply(this, a);
    if (!r || typeof r.prompt !== 'string') return r;
    if (!r.prompt.startsWith(alt)) throw new Error('Katalog-Variante: Katalog nicht am Anfang des Prompts gefunden');
    const prompt = nach + r.prompt.slice(alt.length);
    return Object.assign({}, r, { prompt, zeichen: prompt.length });
  };
  return { name: variante, zeichen: neu.length, original_zeichen: original.length, differenz: neu.length - original.length, hinweis: HINWEISE[variante] };
}

module.exports = { VARIANTEN, ABSATZ_ANFANG, umbauen, pruefen, anwenden };
