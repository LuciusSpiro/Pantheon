// ORT-01 Prüf-Sperre: Orte (Kartenart station/aussenposten, Bauweise rom und germanen) lösen keine Altstücke auf.
// Reine Funktion (Daten rein, Meldungen raus), genutzt von check-assets.mjs und tools/test-orte-sperre.js.
//
// Aufgelöst wie in kit.js / deko.js: anker[rolle][art | '*'], leit[platztyp][art | '*'], deckung_props[art][kind], deko/<bw>.json regeln[platztyp | '*'],
// besitz (paletten/<besitz>.json streu, nach besitzStreuFuerOrt aus deko.js: genau die Liste, die kit.js streut).
// Deko (ORT-01 9): Orte lesen nur die Schlüssel '<kartenart>:<platztyp>' bzw. '<kartenart>:*' (deko.js regelFuer), nie die Altstück-Regeln ohne Präfix (Schiff, Ruine).
// Verboten (Fehler):
//   - alles unter */ruine/*, truhe, kaefig_zelle, thing_stein, legionskasse, carcer, die Holzwerkbank prop/germanen/gemein/werkzeug,
//     Kette, Fass und Feuerschale (prop/germanen/gemein/…, Altstücke der Holz- und Fass-Welt)
//   - in Rom jedes Modell mit germanen/-Segment (prop/germanen/*)
// Ausnahmen stehen EXPLIZIT in AUSNAHMEN (id → Grund, optional nur für eine Stelle), nie stillschweigend. ALT_ERLAUBT: Altstücke, die
// bewusst noch stehen (Warnung "Altstück", kein Fehler), bis ein ORT-Ersatz existiert.
import { besitzStreuFuerOrt } from '../public/js/voxel/deko.js';
export const KARTENARTEN = ['station', 'aussenposten'];
export const VERBOTEN = [
  [/\/ruine\//, 'Ruine-Modell'], [/(^|\/)truhe$/, 'Truhe'], [/kaefig_zelle$/, 'Käfigzelle'], [/thing_stein$/, 'Thing-Stein'],
  [/gemein\/werkzeug$/, 'Holzwerkbank'], [/legionskasse$/, 'Legionskasse'], [/carcer$/, 'Carcer'],
  [/kette$/, 'Kette (Altstueck, ORT-01 6M)'], [/gemein\/fass$/, 'Fass (Altstück, ORT-01 6M)'], [/feuerschale$/, 'Feuerschale (Altstueck, ORT-01 6M)'],
];
// Ausnahmen: { id, wo (Regex auf die Stelle, optional), art (optional), grund }. Ohne Ausnahme für Deko: ORT-01 9 hat alle Altstücke aus den Orten ersetzt.
export const AUSNAHMEN = [
  { id: /prop\/rom\/ruine\/kassengewoelbe_tor$/, wo: /^anker\.tor$/, grund: 'Anker tor wird nie als Prop gerendert (Türen, kit.js), der Eintrag steht nur als Rückfall der Bauweise' },
  { id: /prop\/rom\/ruine\/aquaedukt_verteiler$/, wo: /^anker\.raetsel$/, grund: 'Rätsel kommen auf Station und Außenposten nicht vor (nur Ruine), Eintrag nur Rückfall' },
];
export const ALT_ERLAUBT = [
  { id: /leit\/(rom|germanen)\/aussenposten\/statue_platz$/, grund: 'Wahrzeichen des Dorfplatzes (kein ORT-Ersatz)' },
  { id: /leit\/germanen\/aussenposten\/kraehenwacht_turm$/, grund: 'Wachturm-Herzstück der Module (Bestand)' },
  { id: /prop\/germanen\/station\/met_kessel$/, grund: 'Anker fund (Methalle-Kampagne, Bestand)' },
  { id: /prop\/germanen\/schiff\//, grund: 'Schiff innen bleibt germanisch (nicht Station/Außenposten)' },
];
const istObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const idVon = (v) => (typeof v === 'string' ? v : istObj(v) && typeof v.id === 'string' ? v.id : null);
/** Eintrag einer Tabelle (String | {id} | {'*': ..., <platztyp>: ...}) → Liste von IDs für eine Kartenart. */
function aufloesen(e, art) {
  let v = typeof e === 'string' ? e : istObj(e) ? (e[art] ?? e['*'] ?? null) : null;
  const out = [];
  if (istObj(v) && !v.id) { for (const x of Object.values(v)) { const i = idVon(x); if (i) out.push(i); } return out; }
  const i = idVon(v); if (i) out.push(i);
  return out;
}
/**
 * ctx: { bauweisen: { rom, germanen: <bauweisen-json> }, deko: { rom, germanen }, platztypen: { station: [..], aussenposten: [..] },
 *        raumRollen?: { station, aussenposten: rollen-json }, besitz?: { <besitz>: <paletten-json> } }
 * opts: { ausnahmen?, altErlaubt?, besitzFilter? (Standard besitzStreuFuerOrt; Tests prüfen damit die Sperre ohne Filter) }
 * -> [{ lvl: 'err' | 'info', msg }]
 */
export function pruefeOrte(ctx, opts = {}) {
  const lines = [];
  const ausn = opts.ausnahmen || AUSNAHMEN, alt = opts.altErlaubt || ALT_ERLAUBT;
  const besitzFilter = opts.besitzFilter || besitzStreuFuerOrt;
  const seen = new Set();
  const melde = (bw, art, wo, id) => {
    const stelle = `${bw}/${art} ${wo}`;
    const key = stelle + '|' + id;
    if (seen.has(key)) return; seen.add(key);
    let grund = VERBOTEN.find(([re]) => re.test(id));
    if (!grund && bw === 'rom' && /(^|\/)germanen\//.test(id)) grund = [null, 'germanisches Modell in der römischen Bauweise'];
    if (grund) {
      const a = ausn.find((x) => x.id.test(id) && (!x.wo || x.wo.test(wo)) && (!x.art || x.art === art));
      if (a) { lines.push({ lvl: 'info', msg: `Ausnahme ${stelle}: ${id} (${a.grund})` }); return; }
      lines.push({ lvl: 'err', msg: `${stelle}: ${id} ist ${grund[1]} – Orte lösen das nicht auf (Ausnahme nur explizit in tools/orte-sperre.mjs AUSNAHMEN)` });
      return;
    }
    const a2 = alt.find((x) => x.id.test(id));
    if (a2) lines.push({ lvl: 'info', msg: `Altstück erlaubt ${stelle}: ${id} (${a2.grund})` });
  };
  for (const bw of ['rom', 'germanen']) {
    const b = ctx.bauweisen[bw]; if (!b) continue;
    for (const art of KARTENARTEN) {
      for (const [rolle, e] of Object.entries(b.anker || {})) if (rolle !== 'hinweis') for (const id of aufloesen(e, art)) melde(bw, art, `anker.${rolle}`, id);
      for (const [typ, je] of Object.entries(b.leit || {})) if (istObj(je) && typ !== 'hinweis') for (const id of aufloesen(je, art)) melde(bw, art, `leit.${typ}`, id);
      const dp = b.deckung_props && b.deckung_props[art];
      if (istObj(dp)) for (const [kind, l] of Object.entries(dp)) if (Array.isArray(l)) for (const id of l) melde(bw, art, `deckung_props.${kind}`, id);
      // Deko: jeder Platztyp der Kartenart und '*' (Freiland ohne Platz). Ohne eigene Regel gilt '*'.
      const d = ctx.deko && ctx.deko[bw] && ctx.deko[bw].regeln;
      if (d) for (const typ of [...(ctx.platztypen[art] || []), '*']) { const r = d[art + ':' + typ] || d[art + ':*']; if (r) for (const id of r.props || []) melde(bw, art, `deko.${art}:${typ}`, id); }
      const rr = ctx.raumRollen && ctx.raumRollen[art];
      if (rr && istObj(rr.rollen)) for (const [name, def] of Object.entries(rr.rollen)) for (const id of [].concat(def[bw] || [])) melde(bw, art, `rollen.${name}`, id);
    }
  }
  // Besitz-Streu (wie kit.js gefiltert): bleibt dort ein Altstück, ist der Filter für diese Kartenart nicht wirksam
  for (const art of KARTENARTEN) for (const [name, pal] of Object.entries(ctx.besitz || {})) {
    for (const e of besitzFilter(art, pal && pal.streu)) { const id = idVon(e); if (id) melde('besitz.' + name, art, 'streu', id); }
  }
  return lines;
}
