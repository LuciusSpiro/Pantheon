'use strict';
// KAT-01 A: Kern der Paarmatrix der Beat-Folgen (aus tools/messe-paare.js hierher verschoben, damit der Katalog des Abenteuer-Prompts sie nutzen kann; server/sim liest nie aus tools/). Rein, deterministisch, kein Netz, kein Zustand ausser dem Cache.
// Welches Paar `A direkt vor B` besteht den Bauplan-Pruefer, welches nur mit Verzweigung, welches nie (Details und Kuerzel: Kopf von tools/messe-paare.js, dem duennen Aufrufer fuer Konsole, --json und --md).
// Planbar sind alle Beats mit `bauplan`, ohne `nur_inszenierer`, ohne `abschluss` (Quelle: faden-daten.js = content/faeden/beats.json). Je geordnetes Paar (A, B, auch A = B) wird der Plan [A, B, abschluss] ueber denselben Weg geprueft wie Claudes Antwort (faden-bauplan.js pruefe).
//
//   matrix(opt)     -> Ergebnisobjekt (zellen, nurV, nurVOrt, nurVArt, verzweigung_noetig_bei, als_erster, vor_abschluss_nie, neutral, ...). Ohne opt.mutiere gecacht; opt.mutiere(BEATS) verfaelscht die Katalogdaten NUR im Speicher (Test), nie gecacht; danach sind die Katalogdaten wieder wie vorher (auch wenn die Mutation Beats hinzufuegt oder loescht).
//   Proben je Paar: ohne Verzweigung; mit Verzweigung an A (gescheitert -> abschluss, gelungen -> abschluss); bei B mit Optionen-Pflicht im Vierer-Plan an B und an A+B (je beide Arten). Zelle: klasse, ort (A, B, A+B), art (gescheitert | gelungen | beide | gemischt).
//   neuLesen()      Cache verwerfen (nach Aenderung der Daten im Speicher, zusammen mit faden-bauplan katalogNeuLesen)
//   planFuer(typen, verzA, verzB), kontextCode(code)   Hilfen der Proben (Test)
const D = require('./faden-daten.js');
const BP = require('./faden-bauplan.js');
const ORTE = require('../../content/welt/abenteuer-orte.json');

const KONTEXT_PRAEFIX = ['LAGE_', 'SABOTAGE_', 'NSC_ALT_', 'NSC_VON'];
// Planregeln sind strukturell (Plan bzw. Beat-Zeile), kein Kontext: sabotage zweimal; wiedersehen nur als erster Beat (Paare X > wiedersehen sind damit nie)
const PLANREGELN = ['SABOTAGE_NUR_EINMAL', 'NSC_ALT_NICHT_ERSTER'];
const kontextCode = (c) => !PLANREGELN.includes(c) && KONTEXT_PRAEFIX.some((p) => c.startsWith(p));
const planregelCode = (c) => PLANREGELN.includes(c);
const klon = (x) => JSON.parse(JSON.stringify(x));

const planbar = () => Object.keys(D.BEATS).filter((n) => D.BEATS[n].bauplan && !D.BEATS[n].nur_inszenierer && !D.BEATS[n].abschluss);
const abschlussName = () => Object.keys(D.BEATS).find((n) => D.BEATS[n].abschluss);
const brauchtPlatz = (n) => !!(D.BEATS[n].braucht && D.BEATS[n].braucht.landeplatz);
const artenVon = (n) => (Array.isArray(D.BEATS[n].landeplatz_art) ? D.BEATS[n].landeplatz_art : ORTE.arten);

// Beat des Plans: optionen:true wo der Typ Optionen mit Standard hat, landeplatz-Parameter wo er einen braucht
function beatVon(typ, id, platz) {
  const c = D.BEATS[typ], b = { id, typ };
  if (c.optionen === 'erlaubt' && c.bauplan.optionen) b.optionen = true;
  if (brauchtPlatz(typ)) b.parameter = { landeplatz: platz };
  return b;
}
// Plan [typen..., abschluss]; verzweigungA = Id des Ziels von typen[0].verzweigung.gescheitert (String) oder { gelungen: Id } bzw. { gescheitert: Id } (oder null); verzweigungB = dasselbe fuer typen[1] (oder null)
const verz = (v) => (typeof v === 'string' ? { gescheitert: v } : v);
function planFuer(typen, verzweigungA, verzweigungB) {
  const ab = abschlussName();
  const ids = typen.map((t, i) => 'b' + (i + 1)).concat('z');
  const mitPlatz = typen.filter(brauchtPlatz);
  const plaetze = [];
  let platzIds = {};
  if (mitPlatz.length) {
    const gemeinsam = mitPlatz.map(artenVon).reduce((a, x) => a.filter((k) => x.includes(k)));
    if (gemeinsam.length) { plaetze.push({ id: 'p', art: gemeinsam[0] }); typen.forEach((t, i) => { if (brauchtPlatz(t)) platzIds[i] = 'p'; }); }
    else typen.forEach((t, i) => { if (brauchtPlatz(t)) { const id = 'p' + i; plaetze.push({ id, art: artenVon(t)[0] }); platzIds[i] = id; } });
  }
  const beats = typen.map((t, i) => beatVon(t, ids[i], platzIds[i]));
  if (verzweigungA) beats[0].verzweigung = verz(verzweigungA);
  if (verzweigungB) beats[1].verzweigung = verz(verzweigungB);
  beats.push({ id: 'z', typ: ab });
  const plan = { format: 'faden-bauplan/1', titel: 'Paarprobe ' + typen.join(' ') , beats };
  if (plaetze.length) plan.landeplaetze = plaetze;
  return plan;
}

function probe(typen, verzA, verzB) {
  const r = BP.pruefe(planFuer(typen, verzA, verzB));
  return { ok: r.ok, codes: r.ok ? [] : [...new Set(r.codes)], fehler: r.ok ? [] : r.fehler };
}
const pflichtBeat = (n) => !!(D.BEATS[n].bauplan && D.BEATS[n].bauplan.optionen_pflicht);
const endZustaende = (n, ags) => [...new Set(ags.flatMap((ag) => D.BEATS[n].bauplan.aus[ag].status || []))];
// Neutralbeat C fuer B (siehe Kopf); { beat, regel } oder { beat: null, regel: 'kein Neutralbeat gefunden' }
function neutralFuer(b, namen) {
  const nurStatus = (c) => { const k = Object.keys(D.BEATS[c].braucht || {}); return k.length === 1 && k[0] === 'nsc_status'; };
  const kandidaten = namen.filter((c) => !pflichtBeat(c) && nurStatus(c));
  const zulaesst = (c, zustaende) => zustaende.every((z) => D.BEATS[c].braucht.nsc_status.includes(z));
  const streng = kandidaten.find((c) => zulaesst(c, endZustaende(b, ['gelungen', 'gescheitert'])));
  if (streng) return { beat: streng, regel: 'laesst alle Endzustaende von ' + b + ' zu' };
  const weich = kandidaten.find((c) => zulaesst(c, endZustaende(b, ['gelungen'])));
  if (weich) return { beat: weich, regel: 'laesst alle Zustaende von ' + b + '.gelungen zu (kein Beat laesst alle Endzustaende zu; ' + b + '.gescheitert geht in den abschluss)' };
  return { beat: null, regel: 'kein Neutralbeat gefunden' };
}
// Proben eines Paares: 1 ohne Verzweigung; A = Verzweigung an A, je Art gescheitert/gelungen -> abschluss; B (nur fuer B mit Optionen-Pflicht und gefundenem C, Plan [A, B, C, abschluss]) = Verzweigung an B, je Art;
// AB = beide, alle vier Artenpaare. Eine Stufe wird nur gerechnet, wenn die davor in keiner Art gueltig war.
const ARTEN = { gescheitert: 'z', gelungen: { gelungen: 'z' } };
const alsPlan = (typen, ort, art) => (ort === 'A' ? probe(typen, ARTEN[art], null) : probe(typen, null, ARTEN[art]));
const gueltigeArten = (o) => Object.keys(o).filter((k) => o[k].ok);
function proben(a, b, c) {
  const p = { p1: probe([a, b], null, null) };
  if (p.p1.ok) return p;
  p.A = {}; for (const art of Object.keys(ARTEN)) p.A[art] = alsPlan([a, b], 'A', art);
  if (gueltigeArten(p.A).length || !pflichtBeat(b) || !c) return p;
  p.B = {}; for (const art of Object.keys(ARTEN)) p.B[art] = alsPlan([a, b, c], 'B', art);
  if (gueltigeArten(p.B).length) return p;
  p.AB = {};
  for (const x of Object.keys(ARTEN)) for (const y of Object.keys(ARTEN)) p.AB[x + '/' + y] = probe([a, b, c], ARTEN[x], ARTEN[y]);
  return p;
}
const alleProben = (p) => [p.p1].concat(Object.values(p.A || {}), Object.values(p.B || {}), Object.values(p.AB || {}));
const letzteStufe = (p) => Object.values(p.AB || p.B || p.A || { p1: p.p1 });
// welche Verzweigungsart reicht: 'gescheitert' | 'gelungen' | 'beide' (jede Art allein; bei A+B: an beiden Beats dieselbe Art) | 'gemischt' (nur verschiedene Arten an A und B)
function artVon(ok) {
  const allein = Object.keys(ARTEN).filter((art) => ok.some((k) => k.split('/').every((x) => x === art)));
  return allein.length === 2 ? 'beide' : allein.length === 1 ? allein[0] : 'gemischt';
}
function klasse(p) {
  if (p.p1.ok) return { klasse: 'ok', ort: null, art: null };
  if (p.p1.codes.some(kontextCode)) return { klasse: 'kontext', ort: null, art: null };
  for (const [ort, st] of [['A', p.A], ['B', p.B], ['A+B', p.AB]]) {
    const ok = st ? gueltigeArten(st) : [];
    if (ok.length) return { klasse: 'nurV', ort, art: artVon(ok) };
  }
  const codes = [...new Set(letzteStufe(p).flatMap((x) => x.codes))];
  if (codes.some(kontextCode)) return { klasse: 'kontext', ort: null, art: null };
  if (codes.length && codes.every((c) => c === 'HINWEIS_FEHLT')) return { klasse: 'hinweis', ort: null, art: null };
  return { klasse: 'nie', ort: null, art: null };
}
const codesVon = (o, k) => (o && o[k] ? o[k].codes : null);

// opt.mutiere(BEATS): verfaelscht die Katalogdaten im Speicher (Test); nach der Auswertung wird alles zurueckgesetzt, die Dateien bleiben unberuehrt
let cache = null;
const neuLesen = () => { cache = null; };
function matrix(opt) {
  const o = opt || {};
  if (!o.mutiere && cache) return cache;
  const B = D.BEATS, sicher = klon(B);
  let ergebnis;
  try {
    if (o.mutiere) { o.mutiere(B); BP.katalogNeuLesen(); }
    const namen = planbar(), ab = abschlussName();
    const zellen = {}, abschluss = {};
    const neutral = {};
    for (const b of namen) if (pflichtBeat(b)) neutral[b] = neutralFuer(b, namen);
    for (const a of namen) {
      zellen[a] = {};
      for (const b of namen) {
        const p = proben(a, b, neutral[b] && neutral[b].beat), k = klasse(p);
        // mit/mitGel: Verzweigung an A (gescheitert/gelungen); mitB/mitBGel: an B (Vierer-Plan); beide: an A und B gescheitert (beideKombi: alle vier Artenpaare); letzte: Codes der letzten gerechneten Stufe
        zellen[a][b] = { klasse: k.klasse, ort: k.ort, art: k.art, ziel: p.A ? 'abschluss' : null, ohne: p.p1.codes, mit: codesVon(p.A, 'gescheitert'), mitGel: codesVon(p.A, 'gelungen'), mitB: codesVon(p.B, 'gescheitert'), mitBGel: codesVon(p.B, 'gelungen'), beide: codesVon(p.AB, 'gescheitert/gescheitert'), beideKombi: p.AB ? Object.fromEntries(Object.entries(p.AB).map(([x, r]) => [x, r.codes])) : null, letzte: [...new Set(letzteStufe(p).flatMap((x) => x.codes))], fehler: alleProben(p).flatMap((x) => x.fehler) };
      }
    }
    for (const b of namen) { const p = probe([b], null); abschluss[b] = { klasse: p.ok ? 'ok' : p.codes.some(kontextCode) ? 'kontext' : (p.codes.every((c) => c === 'HINWEIS_FEHLT') ? 'hinweis' : 'nie'), codes: p.codes }; }
    const je = (k) => { const r = {}; for (const a of namen) r[a] = namen.filter((b) => zellen[a][b].klasse === k); return r; };
    const nurVOrt = {}, nurVArt = {}, noetig = {};
    for (const a of namen) {
      nurVOrt[a] = {}; nurVArt[a] = {}; noetig[a] = { A: [], B: [], 'A+B': [] };
      for (const b of namen) if (zellen[a][b].klasse === 'nurV') { nurVOrt[a][b] = zellen[a][b].ort; noetig[a][zellen[a][b].ort].push(b); nurVArt[a][b] = zellen[a][b].art; }
    }
    // als_erster[B]: B an Position 0 (der NSC steht im start_status): Plan [B, abschluss] und Paare [B, X, abschluss]; gueltig, wenn einer davon besteht (ok oder nurV)
    const alsErster = {};
    for (const b of namen) { const folger = namen.filter((x) => zellen[b][x].klasse === 'ok' || zellen[b][x].klasse === 'nurV'); alsErster[b] = { direkt: abschluss[b].klasse, folger, gueltig: abschluss[b].klasse === 'ok' || folger.length > 0 }; }
    const vorNie = namen.filter((b) => abschluss[b].klasse === 'nie').map((b) => ({ beat: b, optionen_pflicht: pflichtBeat(b), codes: abschluss[b].codes }));
    const zaehl = { ok: 0, nurV: 0, nie: 0, kontext: 0, hinweis: 0 };
    for (const a of namen) for (const b of namen) zaehl[zellen[a][b].klasse] = (zaehl[zellen[a][b].klasse] || 0) + 1;
    ergebnis = { format: 'messung-paare/1', werkzeug: 'tools/messe-paare.js', beats: namen, abschluss_beat: ab, zellen, neutral, vor_abschluss: abschluss, vor_abschluss_nie: vorNie, nurV: je('nurV'), nurVOrt, nurVArt, verzweigung_noetig_bei: noetig, als_erster: alsErster, nie: je('nie'), kontext: je('kontext'), hinweis: je('hinweis'), zaehlung: zaehl };
  } finally {
    if (o.mutiere) {
      // Vereinigung beider Schluesselmengen: hinzugefuegte Beats fallen weg, geloeschte kommen zurueck, Reihenfolge der Schluessel wie vorher (planbar() liest sie)
      const jetzt = Object.assign({}, B);
      for (const k of Object.keys(B)) delete B[k];
      for (const k of Object.keys(sicher)) { const x = jetzt[k] || {}; for (const f of Object.keys(x)) delete x[f]; B[k] = Object.assign(x, sicher[k]); }
      BP.katalogNeuLesen();
    }
  }
  if (!o.mutiere) cache = ergebnis;
  return ergebnis;
}

module.exports = { matrix, kontextCode, planregelCode, planFuer, neuLesen };
