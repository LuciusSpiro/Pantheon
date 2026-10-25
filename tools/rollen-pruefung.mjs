// ORT-01 Paket 1: Prüfung des Rollenformats rollen/1 (content/buehnen/rollen/<kartenart>.json) und der Parität Rom ↔ Germanen.
// Reine Funktion (Daten rein, Meldungen raus), damit check-assets.mjs (checkRollen) und tools/test-rollen-paritaet.js dieselbe
// Prüfung nutzen. Format und Regeln: CONTRACT-ROLLEN-ORT.md.
//
// Meldungen: { lvl: 'err' | 'warn' | 'info', msg }. Fehler (err): Format verletzt, Belegung rom ODER germanen fehlt, Modell-ID ohne
// Manifest-Eintrag (der Client lädt nur Manifest-IDs; ein Modell nur in index.json bliebe unsichtbar), streu-Modell größer als 1×1,
// leit-Modell ohne leit_fuss, streu-Modell, das in der Bauweise Deckungs-Prop ist (deckung_props; kit.js nimmt es aus der Deko, die Rolle bliebe leer).
// Warnungen: Rollenzahl je Raumtyp außerhalb 5–7, unbenutzte Rolle, unbekannte Zusatzfelder.

export const BAUWEISEN = ['rom', 'germanen'];
export const KINDS = ['streu', 'leit', 'anker'];
export const KARTENARTEN = ['station', 'aussenposten'];
export const ROLLEN_JE_RAUMTYP = [5, 7];   // Erkundung F5: 1 Hauptstück, 2 Hauptrollen, 2–3 Nebenrollen, 1 Streurolle
export const MAX_ZUG = 6;                  // Stück je Rolle und Platz (MAX_JE_ZELLE = 12 gilt zusätzlich)

const FELDER_ROLLE_EINTRAG = ['rolle', 'kind', 'zug', 'wandnah', 'pflicht', 'ankerRolle'];
const FELDER_RAUMTYP = ['frei_halten', 'rollen', 'hinweis'];
const FELDER_ROLLE_DEF = [...BAUWEISEN, 'hinweis'];
const FELDER_DATEI = ['format', 'kartenart', 'hinweis', 'raumtypen', 'rollen'];

const istObjekt = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Belegung (String oder nicht leere Liste von Strings) → Liste, sonst null. */
export function belegungListe(v) {
  if (typeof v === 'string' && v) return [v];
  if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string' && x)) return v;
  return null;
}

/**
 * j: Inhalt einer Rollen-Datei; name: Dateiname (für Meldungen, erwartet <kartenart>.json)
 * ctx: { manifestIds: Set, indexModels?: Set (nur für die Meldung), modelle?: { id: { footprint, height } },
 *        leitFuss?: { <bauweise>: { <modell-id>: [fw, fd] } }, ankerRollen?: Set (Rollen aus anker.json),
 *        deckung?: { <bauweise>: { <kartenart>: Set (deckung_props-IDs) } } }
 */
export function pruefeRollenDatei(j, name, ctx) {
  const lines = [];
  const err = (m) => lines.push({ lvl: 'err', msg: `${name}: ${m}` });
  const warn = (m) => lines.push({ lvl: 'warn', msg: `${name}: ${m}` });
  if (!istObjekt(j)) { err('keine Objekt-Datei'); return lines; }
  if (j.format !== 'rollen/1') err(`format "${j.format}" statt "rollen/1"`);
  const art = name.replace(/\.json$/, '');
  if (!KARTENARTEN.includes(art)) warn(`Kartenart "${art}" ist keine von ${KARTENARTEN.join(', ')} (Dateiname = Kartenart)`);
  if (j.kartenart !== art) err(`kartenart "${j.kartenart}" passt nicht zum Dateinamen (${art})`);
  for (const f of Object.keys(j)) if (!FELDER_DATEI.includes(f)) warn(`unbekanntes Feld ${f}`);
  const raumtypen = istObjekt(j.raumtypen) ? j.raumtypen : null, rollen = istObjekt(j.rollen) ? j.rollen : null;
  if (!raumtypen) err('raumtypen fehlt (Objekt, darf leer sein)');
  if (!rollen) err('rollen fehlt (Objekt, darf leer sein)');
  if (!raumtypen || !rollen) return lines;

  const benutzt = new Set();
  let nRollenEintraege = 0;
  for (const [rt, def] of Object.entries(raumtypen)) {
    const wo = `raumtypen.${rt}`;
    if (!/^[a-z][a-z0-9]*$/.test(rt)) err(`${wo}: Raumtyp = Präfix der Platz-ID in Kleinbuchstaben ohne _n (z. B. kommando, werkstatt)`);
    if (!istObjekt(def)) { err(`${wo}: Objekt erwartet`); continue; }
    for (const f of Object.keys(def)) if (!FELDER_RAUMTYP.includes(f)) warn(`${wo}: unbekanntes Feld ${f}`);
    if (def.frei_halten !== undefined && !(Number.isInteger(def.frei_halten) && def.frei_halten >= 1 && def.frei_halten <= 4)) err(`${wo}.frei_halten: ganze Zahl 1–4 (Anker/Türen bleiben mindestens 1 Kachel frei)`);
    if (!Array.isArray(def.rollen)) { err(`${wo}.rollen: Liste erwartet`); continue; }
    nRollenEintraege += def.rollen.length;
    if (def.rollen.length < ROLLEN_JE_RAUMTYP[0] || def.rollen.length > ROLLEN_JE_RAUMTYP[1]) warn(`${wo}: ${def.rollen.length} Rollen (Erkundung: ${ROLLEN_JE_RAUMTYP[0]}–${ROLLEN_JE_RAUMTYP[1]} je Raumtyp)`);
    const gesehen = new Set();
    let summeMax = 0;
    def.rollen.forEach((e, i) => {
      const w = `${wo}.rollen[${i}]`;
      if (!istObjekt(e)) { err(`${w}: Objekt erwartet`); return; }
      for (const f of Object.keys(e)) if (!FELDER_ROLLE_EINTRAG.includes(f)) warn(`${w}: unbekanntes Feld ${f}`);
      if (typeof e.rolle !== 'string' || !e.rolle) { err(`${w}.rolle: Rollenname fehlt`); return; }
      if (gesehen.has(e.rolle)) err(`${w}: Rolle ${e.rolle} kommt im Raumtyp doppelt vor`);
      gesehen.add(e.rolle); benutzt.add(e.rolle);
      if (!e.rolle.startsWith(rt + '.') && !e.rolle.startsWith('gemein.')) warn(`${w}: Rollenname ${e.rolle} beginnt weder mit "${rt}." noch mit "gemein."`);
      if (!rollen[e.rolle]) err(`${w}: Rolle ${e.rolle} ist in "rollen" nicht definiert`);
      const kind = e.kind === undefined ? 'streu' : e.kind;
      if (!KINDS.includes(kind)) err(`${w} (${e.rolle}): kind "${e.kind}" nicht in ${KINDS.join('|')}`);
      if (e.wandnah !== undefined && typeof e.wandnah !== 'boolean') err(`${w} (${e.rolle}): wandnah muss true/false sein`);
      if (e.pflicht !== undefined && typeof e.pflicht !== 'boolean') err(`${w} (${e.rolle}): pflicht muss true/false sein`);
      if (e.zug !== undefined) {
        const z = e.zug;
        if (!(Array.isArray(z) && z.length === 2 && z.every((n) => Number.isInteger(n) && n >= 0 && n <= MAX_ZUG) && z[0] <= z[1])) err(`${w} (${e.rolle}): zug = [min, max] ganze Zahlen 0–${MAX_ZUG}, min ≤ max`);
        else if (kind === 'streu') summeMax += z[1];
      } else if (kind === 'streu') summeMax += 1;
      if (kind === 'streu' && e.pflicht && Array.isArray(e.zug) && e.zug[1] === 0) err(`${w} (${e.rolle}): pflicht mit zug-max 0`);
      if (kind !== 'streu' && e.zug !== undefined) warn(`${w} (${e.rolle}): zug gilt nur für kind streu (Hauptstücke: ein Stück am Anker)`);
      if (kind === 'anker') {
        if (typeof e.ankerRolle !== 'string' || !e.ankerRolle) err(`${w} (${e.rolle}): kind anker braucht ankerRolle (Rolle aus anker.json, z. B. terminal)`);
        else if (ctx.ankerRollen && !ctx.ankerRollen.has(e.ankerRolle)) err(`${w} (${e.rolle}): ankerRolle ${e.ankerRolle} steht nicht in anker.json`);
      } else if (e.ankerRolle !== undefined) warn(`${w} (${e.rolle}): ankerRolle gilt nur für kind anker`);
    });
    if (summeMax > 12) warn(`${wo}: Summe der zug-Höchstwerte ${summeMax} > 12 (MAX_JE_ZELLE; der Platz wird nie voll)`);
  }

  let nBelegungen = 0;
  for (const [name_, def] of Object.entries(rollen)) {
    const wo = `rollen.${name_}`;
    if (!istObjekt(def)) { err(`${wo}: Objekt { rom, germanen } erwartet`); continue; }
    for (const f of Object.keys(def)) if (!FELDER_ROLLE_DEF.includes(f)) warn(`${wo}: unbekanntes Feld ${f} (erlaubt: ${FELDER_ROLLE_DEF.join(', ')})`);
    if (!benutzt.has(name_)) warn(`${wo}: von keinem Raumtyp benutzt`);
    // Art der Rolle: aus den Raumtyp-Einträgen (gleiche Rolle in mehreren Raumtypen muss gleiche kind haben)
    const kinds = new Set();
    for (const d of Object.values(raumtypen)) for (const e of (d && d.rollen) || []) if (e && e.rolle === name_) kinds.add(e.kind || 'streu');
    if (kinds.size > 1) err(`${wo}: wird mit unterschiedlicher kind benutzt (${[...kinds].join(', ')})`);
    const kind = [...kinds][0] || 'streu';
    for (const bw of BAUWEISEN) {
      const l = belegungListe(def[bw]);
      if (!l) { err(`${wo}: Belegung für ${bw} fehlt (jede Rolle braucht ${BAUWEISEN.join(' UND ')})`); continue; }
      nBelegungen += l.length;
      if (kind !== 'streu' && l.length > 1) warn(`${wo}.${bw}: ${l.length} Belegungen, ein Hauptstück am Anker nimmt nur die erste (Bauweisen-Tabelle)`);
      for (const id of l) {
        if (!ctx.manifestIds.has(id)) {
          err(`${wo}.${bw}: ${id} ${ctx.indexModels && ctx.indexModels.has(id) ? 'steht in index.json, hat aber keinen Manifest-Eintrag (assets/manifest) – der Client lädt es nicht' : 'weder im Manifest noch in index.json'}`);
          continue;
        }
        if (kind === 'streu' && ctx.deckung && ctx.deckung[bw] && ctx.deckung[bw][art] && ctx.deckung[bw][art].has(id)) { err(`${wo}.${bw}: ${id} ist Deckungs-Prop der ${bw}-Bauweise (deckung_props.${art}) und wird als Deko ausgeschlossen – die Rolle bliebe in dieser Bauweise leer`); continue; }
        const m = ctx.modelle && ctx.modelle[id];
        if (kind === 'streu' && m && Array.isArray(m.footprint) && Math.max(m.footprint[0], m.footprint[1]) > 1.05) err(`${wo}.${bw}: ${id} ist ${m.footprint[0]}×${m.footprint[1]} m groß – Deko ist 1×1 (Hauptstücke als kind leit/anker)`);
        if (kind === 'leit') {
          const f = ctx.leitFuss && ctx.leitFuss[bw] && ctx.leitFuss[bw][id];
          if (ctx.leitFuss && !(Array.isArray(f) && f.length === 2)) err(`${wo}.${bw}: Leitstück ${id} hat keinen Eintrag in leit_fuss von bauweisen/${bw}.json`);
        }
      }
    }
  }
  lines.push({ lvl: 'info', msg: `${name}: ${Object.keys(raumtypen).length} Raumtypen, ${nRollenEintraege} Rollen-Einträge, ${Object.keys(rollen).length} Rollen, ${nBelegungen} Belegungen` });
  return lines;
}
