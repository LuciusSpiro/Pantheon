'use strict';
// KAT-01 A: Kern der Paarmatrix der Beat-Folgen (aus tools/messe-paare.js hierher verschoben, damit der Katalog des Abenteuer-Prompts sie nutzen kann; server/sim liest nie aus tools/). Rein, deterministisch, kein Netz, kein Zustand ausser dem Cache.
// Welches Paar `A direkt vor B` besteht den Bauplan-Pruefer, welches nur mit Verzweigung, welches nie (Details und Kuerzel: Kopf von tools/messe-paare.js, dem duennen Aufrufer fuer Konsole, --json und --md).
// Planbar sind alle Beats mit `bauplan`, ohne `nur_inszenierer`, ohne `abschluss` (Quelle: faden-daten.js = content/faeden/beats.json). Je geordnetes Paar (A, B, auch A = B) wird der Plan [A, B, abschluss] ueber denselben Weg geprueft wie Claudes Antwort (faden-bauplan.js pruefe).
//
//   matrix(opt)     -> Ergebnisobjekt (zellen, nurV, nurVOrt, verzweigung_noetig_bei, vor_abschluss_nie, neutral, ...). Ohne opt.mutiere gecacht; opt.mutiere(BEATS) verfaelscht die Katalogdaten NUR im Speicher (Test), nie gecacht, danach wird alles zurueckgesetzt.
//   neuLesen()      Cache verwerfen (nach Aenderung der Daten im Speicher, zusammen mit faden-bauplan katalogNeuLesen)
//   planFuer(typen, verzA, verzB), kontextCode(code)   Hilfen der Proben (Test)
const D = require('./faden-daten.js');
const BP = require('./faden-bauplan.js');
const ORTE = require('../../content/welt/abenteuer-orte.json');

const KONTEXT_PRAEFIX = ['LAGE_', 'SABOTAGE_', 'NSC_ALT_', 'NSC_VON'];
const kontextCode = (c) => c !== 'SABOTAGE_NUR_EINMAL' && KONTEXT_PRAEFIX.some((p) => c.startsWith(p));
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
// Plan [typen..., abschluss]; verzweigungA = Id des Ziels von typen[0].verzweigung.gescheitert (oder null); verzweigungB = dasselbe fuer typen[1] (oder null)
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
  if (verzweigungA) beats[0].verzweigung = { gescheitert: verzweigungA };
  if (verzweigungB) beats[1].verzweigung = { gescheitert: verzweigungB };
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
// Proben eines Paares in der Reihenfolge 1..4 (3 und 4 nur fuer B mit Optionen-Pflicht und gefundenem C)
function proben(a, b, c) {
  const p = { p1: probe([a, b], null, null) };
  if (p.p1.ok) return p;
  p.p2 = probe([a, b], 'z', null);
  if (p.p2.ok || !pflichtBeat(b) || !c) return p;
  p.p3 = probe([a, b, c], null, 'z');
  if (p.p3.ok) return p;
  p.p4 = probe([a, b, c], 'z', 'z');
  return p;
}
function klasse(p) {
  if (p.p1.ok) return { klasse: 'ok', ort: null };
  if (p.p1.codes.some(kontextCode)) return { klasse: 'kontext', ort: null };
  if (p.p2.ok) return { klasse: 'nurV', ort: 'A' };
  if (p.p3 && p.p3.ok) return { klasse: 'nurV', ort: 'B' };
  if (p.p4 && p.p4.ok) return { klasse: 'nurV', ort: 'A+B' };
  const letzte = p.p4 || p.p2;
  if (letzte.codes.some(kontextCode)) return { klasse: 'kontext', ort: null };
  if (letzte.codes.length && letzte.codes.every((c) => c === 'HINWEIS_FEHLT')) return { klasse: 'hinweis', ort: null };
  return { klasse: 'nie', ort: null };
}


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
        const letzte = p.p4 || p.p3 || p.p2 || p.p1;
        zellen[a][b] = { klasse: k.klasse, ort: k.ort, ziel: p.p2 ? 'abschluss' : null, ohne: p.p1.codes, mit: p.p2 ? p.p2.codes : null, mitB: p.p3 ? p.p3.codes : null, beide: p.p4 ? p.p4.codes : null, letzte: letzte.codes, fehler: [p.p1, p.p2, p.p3, p.p4].filter(Boolean).flatMap((x) => x.fehler) };
      }
    }
    for (const b of namen) { const p = probe([b], null); abschluss[b] = { klasse: p.ok ? 'ok' : p.codes.some(kontextCode) ? 'kontext' : (p.codes.every((c) => c === 'HINWEIS_FEHLT') ? 'hinweis' : 'nie'), codes: p.codes }; }
    const je = (k) => { const r = {}; for (const a of namen) r[a] = namen.filter((b) => zellen[a][b].klasse === k); return r; };
    const nurVOrt = {}, noetig = {};
    for (const a of namen) {
      nurVOrt[a] = {}; noetig[a] = { A: [], B: [], 'A+B': [] };
      for (const b of namen) if (zellen[a][b].klasse === 'nurV') { nurVOrt[a][b] = zellen[a][b].ort; noetig[a][zellen[a][b].ort].push(b); }
    }
    const vorNie = namen.filter((b) => abschluss[b].klasse === 'nie').map((b) => ({ beat: b, optionen_pflicht: pflichtBeat(b), codes: abschluss[b].codes }));
    const zaehl = {};
    for (const a of namen) for (const b of namen) zaehl[zellen[a][b].klasse] = (zaehl[zellen[a][b].klasse] || 0) + 1;
    ergebnis = { format: 'messung-paare/1', werkzeug: 'tools/messe-paare.js', beats: namen, abschluss_beat: ab, zellen, neutral, vor_abschluss: abschluss, vor_abschluss_nie: vorNie, nurV: je('nurV'), nurVOrt, verzweigung_noetig_bei: noetig, nie: je('nie'), kontext: je('kontext'), hinweis: je('hinweis'), zaehlung: zaehl };
  } finally {
    if (o.mutiere) {
      for (const k of Object.keys(B)) { for (const f of Object.keys(B[k])) delete B[k][f]; Object.assign(B[k], sicher[k]); }
      BP.katalogNeuLesen();
    }
  }
  if (!o.mutiere) cache = ergebnis;
  return ergebnis;
}

module.exports = { matrix, kontextCode, planFuer, neuLesen };
