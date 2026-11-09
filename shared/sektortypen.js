// KAC-01 A: Lader und Schema-Pruefung des Sektortypen-Katalogs (content/welt/sektortypen.json). UMD: window.Shared_Sektortypen / require.
// Reine Funktionen, deterministisch, kein game-Zustand. Node laedt die JSON selbst (lade()); im Browser gibt es die Datei nicht,
// dort bekommt leser(daten) den Katalog als Parameter (z. B. aus einer Server-Nachricht) und liefert dieselben Funktionen.
// Alle Fehler sind deutsche Klartexte mit Typ und Feld.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared_Sektortypen = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const GUETER = ['T', 'M', 'U', 'E', 'N', 'R'];
  const KOERPERARTEN = ['planet', 'gasriese', 'station', 'siedlung', 'asteroid'];
  const KARTENARTEN = ['wildnis', 'hoehle', 'station', 'aussenposten'];
  const BIOME = ['wueste', 'wiesenwald', 'vulkan'];   // identisch zu GenGelaende.BIOME (tools/test-sektortypen.js prueft das)
  const MENGEN = ['wenig', 'normal', 'viel'];
  const PFLICHT_TYP = ['id', 'name', 'icon', 'szene', 'koerper', 'boden', 'quelle', 'szenen'];
  const PFLICHT_SZENE = ['sterne', 'bojen', 'brocken', 'nebel', 'zonen'];
  const SPANNEN_SZENE = ['sterne', 'bojen', 'brocken', 'w', 'h'];

  const istObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const spanneFehler = (v) => !Array.isArray(v) || v.length !== 2 || !v.every((n) => Number.isFinite(n)) ? 'muss eine Spanne [min,max] aus zwei Zahlen sein'
    : v[0] > v[1] ? `Spanne [${v[0]},${v[1]}] ist verkehrt (min groesser als max)` : null;

  function gueterPruefen(quelle, wo, f) {
    if (!Array.isArray(quelle)) { f.push(`${wo}: muss eine Liste sein`); return; }
    quelle.forEach((q, i) => {
      if (!istObj(q) || !GUETER.includes(q.gut)) { f.push(`${wo}[${i}].gut: Guetercode '${q && q.gut}' unbekannt (erlaubt: ${GUETER.join('/')})`); return; }
      if (q.menge != null && !MENGEN.includes(q.menge)) f.push(`${wo}[${i}].menge: '${q.menge}' unbekannt (erlaubt: ${MENGEN.join('/')})`);
      if (q.p != null && !(q.p >= 0 && q.p <= 1)) f.push(`${wo}[${i}].p: Wahrscheinlichkeit ${q.p} ausserhalb 0..1`);
    });
  }

  function planetenartenPruefen(pa, f) {
    for (const [name, a] of Object.entries(pa)) {
      const wo = `Planetenart '${name}'`;
      if (!istObj(a)) { f.push(`${wo}: kein Objekt`); continue; }
      if (typeof a.landbar !== 'boolean') f.push(`${wo}.landbar: muss true/false sein`);
      if (a.landbar === true && !BIOME.includes(a.biom)) f.push(`${wo}: landbar, aber biom '${a.biom}' ist kein Gelaende-Biom (${BIOME.join('/')})`);
      if (a.landbar === false && a.biom != null) f.push(`${wo}: nicht landbar, aber biom '${a.biom}' gesetzt`);
      gueterPruefen(a.quelle || [], `${wo}.quelle`, f);
    }
  }

  function bodenPruefen(b, wo, f) {
    if (!istObj(b)) { f.push(`${wo}.boden: kein Objekt`); return; }
    if (b.kartenart != null && !KARTENARTEN.includes(b.kartenart)) f.push(`${wo}.boden.kartenart: '${b.kartenart}' unbekannt (erlaubt: ${KARTENARTEN.join('/')})`);
    if (b.biom != null && b.biom !== 'aus_planetenart') f.push(`${wo}.boden.biom: '${b.biom}' unbekannt (null oder 'aus_planetenart')`);
    if (b.biom === 'aus_planetenart' && b.kartenart !== 'wildnis') f.push(`${wo}.boden: biom 'aus_planetenart' gibt es nur bei kartenart 'wildnis'`);
    if (b.zugang != null && b.zugang !== 'transportpunkt') f.push(`${wo}.boden.zugang: '${b.zugang}' unbekannt (nur 'transportpunkt')`);
  }

  function szenePruefen(s, wo, f) {
    if (!istObj(s)) { f.push(`${wo}.szene: kein Objekt`); return; }
    for (const p of PFLICHT_SZENE) if (s[p] === undefined) f.push(`${wo}.szene.${p}: fehlt`);
    for (const p of SPANNEN_SZENE) if (s[p] !== undefined) { const e = spanneFehler(s[p]); if (e) f.push(`${wo}.szene.${p}: ${e}`); }
    if (s.nebel !== undefined && typeof s.nebel !== 'boolean') f.push(`${wo}.szene.nebel: muss true/false sein`);
    if (s.zonen != null && s.zonen !== 'gasriese') f.push(`${wo}.szene.zonen: '${s.zonen}' unbekannt (null oder 'gasriese')`);
  }

  // Prueft die Koerper eines Typs; gibt zurueck, ob mindestens einer landbar ist
  function koerperPruefen(liste, wo, pa, ka, f) {
    if (!Array.isArray(liste)) { f.push(`${wo}.koerper: muss eine Liste sein`); return false; }
    let hatLandbar = false;
    const kid = new Set();
    liste.forEach((v, i) => {
      const kw = `${wo}.koerper[${i}]`;
      if (!istObj(v)) { f.push(`${kw}: kein Objekt`); return; }
      if (!v.id) f.push(`${kw}.id: fehlt`);
      else if (kid.has(v.id)) f.push(`${kw}: doppelter Koerper '${v.id}'`);
      kid.add(v.id);
      if (!KOERPERARTEN.includes(v.art)) { f.push(`${kw}.art: Koerperart '${v.art}' unbekannt (erlaubt: ${KOERPERARTEN.join('/')})`); return; }
      let e = spanneFehler(v.anzahl); if (e) f.push(`${kw}.anzahl: ${e}`);
      e = spanneFehler(v.radius); if (e) f.push(`${kw}.radius: ${e}`);
      if (v.landbar !== undefined && typeof v.landbar !== 'boolean') f.push(`${kw}.landbar: muss true/false sein`);
      const landbar = v.landbar === true;
      if (landbar && ka[v.art] && ka[v.art].landbar !== true) f.push(`${kw}: Koerperart '${v.art}' ist nicht landbar`);
      if (landbar) hatLandbar = true;
      if (landbar && !istObj(v.beam)) f.push(`${kw}.beam: landbarer Koerper braucht beam { extra: Zahl }`);
      if (v.beam !== undefined && !(istObj(v.beam) && Number.isFinite(v.beam.extra) && v.beam.extra >= 0)) f.push(`${kw}.beam: muss { extra: Zahl >= 0 } sein`);
      if (v.art === 'planet') {
        if (!Array.isArray(v.arten) || !v.arten.length) f.push(`${kw}.arten: Planet braucht eine Liste von Planetenarten`);
        else for (const a of v.arten) {
          if (!pa[a]) f.push(`${kw}.arten: Planetenart '${a}' existiert nicht im Block planetenarten`);
          else if (pa[a].landbar !== landbar) f.push(`${kw}.arten: Planetenart '${a}' ist ${pa[a].landbar ? '' : 'nicht '}landbar, der Koerper '${v.id}' aber ${landbar ? '' : 'nicht '}landbar`);
        }
      }
    });
    return hatLandbar;
  }

  // Liste aller Schema-Fehler (leer = in Ordnung)
  function fehlerListe(k) {
    const f = [];
    if (!istObj(k)) return ['Katalog: kein Objekt'];
    if (!istObj(k.planetenarten)) f.push('Katalog: Block planetenarten fehlt');
    if (!istObj(k.koerperarten)) f.push('Katalog: Block koerperarten fehlt');
    if (!Array.isArray(k.typen) || !k.typen.length) { f.push('Katalog: Liste typen fehlt oder ist leer'); return f; }
    const pa = istObj(k.planetenarten) ? k.planetenarten : {};
    const ka = istObj(k.koerperarten) ? k.koerperarten : {};
    planetenartenPruefen(pa, f);
    for (const [name, a] of Object.entries(ka)) {
      if (!KOERPERARTEN.includes(name)) f.push(`Koerperart '${name}' unbekannt (erlaubt: ${KOERPERARTEN.join('/')})`);
      else if (!istObj(a) || typeof a.landbar !== 'boolean') f.push(`Koerperart '${name}'.landbar: muss true/false sein`);
    }
    for (const art of KOERPERARTEN) if (!ka[art]) f.push(`Koerperart '${art}' fehlt im Block koerperarten`);
    const ids = new Set();
    for (const t of k.typen) {
      if (!istObj(t)) { f.push('Typ: kein Objekt'); continue; }
      const tid = t.id != null ? String(t.id) : '(ohne id)';
      const wo = `Typ '${tid}'`;
      for (const p of PFLICHT_TYP) if (t[p] === undefined) f.push(`${wo}: Pflichtfeld '${p}' fehlt`);
      if (ids.has(tid)) f.push(`${wo}: doppelte Typ-ID`);
      ids.add(tid);
      if (t.szene !== undefined) szenePruefen(t.szene, wo, f);
      if (t.quelle !== undefined) gueterPruefen(t.quelle, `${wo}.quelle`, f);
      if (t.szenen !== undefined && (!Array.isArray(t.szenen) || t.szenen.some((s) => typeof s !== 'string'))) f.push(`${wo}.szenen: muss eine Liste von Szenentyp-IDs sein`);
      if (t.boden !== undefined) bodenPruefen(t.boden, wo, f);
      const hatLandbar = t.koerper !== undefined ? koerperPruefen(t.koerper, wo, pa, ka, f) : false;
      if (istObj(t.boden) && t.koerper !== undefined) {
        if (hatLandbar && t.boden.kartenart == null) f.push(`${wo}.boden.kartenart: Typ hat landbare Koerper, aber keine Kartenart`);
        if (!hatLandbar && t.boden.kartenart != null) f.push(`${wo}.boden.kartenart: '${t.boden.kartenart}' gesetzt, aber kein landbarer Koerper`);
      }
    }
    return f;
  }

  // wirft bei Schema-Verstoss mit allen Befunden (eine Zeile je Befund)
  function pruefe(katalog) {
    const f = fehlerListe(katalog);
    if (f.length) throw new Error('Sektortypen-Katalog ungueltig:\n  ' + f.join('\n  '));
    return true;
  }

  // Leser auf einem Katalog (Parameter statt Datei: Browser, Tests mit Mutation). Prueft beim Anlegen.
  function leser(katalog) {
    pruefe(katalog);
    const nachId = new Map(katalog.typen.map((t) => [t.id, t]));
    const gueltig = () => Array.from(nachId.keys()).join(', ');
    return {
      katalog: () => katalog,
      typen: () => Array.from(nachId.keys()),
      istTyp: (id) => typeof id === 'string' && nachId.has(id),
      typ(id) {
        if (id === undefined || id === null || id === '') throw new Error(`Sektortyp fehlt (gueltig: ${gueltig()})`);
        const t = nachId.get(id);
        if (!t) throw new Error(`Sektortyp '${id}' unbekannt (gueltig: ${gueltig()})`);
        return t;
      },
      planetenart(art) {
        const a = katalog.planetenarten[art];
        if (!Object.prototype.hasOwnProperty.call(katalog.planetenarten, art)) throw new Error(`Planetenart '${art}' unbekannt (gueltig: ${Object.keys(katalog.planetenarten).join(', ')})`);
        return a;
      },
    };
  }

  // Node: Standardkatalog aus content/welt/sektortypen.json (einmal geladen und geprueft)
  let standard = null;
  function lade() {
    if (!standard) {
      if (!(typeof module === 'object' && module.exports)) throw new Error('Sektortypen: die Katalogdatei laedt nur Node; im Browser leser(daten) mit dem Katalog verwenden');
      standard = leser(require('../content/welt/sektortypen.json'));
    }
    return standard;
  }
  const katalog = () => lade().katalog();
  const typ = (id) => lade().typ(id);
  const istTyp = (id) => lade().istTyp(id);
  const planetenart = (art) => lade().planetenart(art);
  const typen = () => lade().typen();

  return { lade, katalog, pruefe, fehlerListe, leser, typ, istTyp, planetenart, typen, GUETER, KOERPERARTEN, KARTENARTEN, BIOME };
});
