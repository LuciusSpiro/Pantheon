(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GenFest = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // Feste Karten (BOD-01, Format festkarte/1, Beispiel content/buehnen/festkarten/grabenangriff.json): eine handgebaute Karte aus
  // austauschbaren Abschnitten (Wiese, Wald, Eingangsbereich ...) mit Varianten. Der Erzeuger setzt die Abschnitte links nach rechts
  // zu einem Raster zusammen und liefert dasselbe Roh-Objekt wie gen-siedlung/gen-station (rows, w, h, anker, bereiche, plaetze,
  // meta.pflicht, art) für Buehne.ausRaster. Die Definition kommt als Objekt herein (Laden der Datei: server/sim/landepunkte.js),
  // der Erzeuger liest keine Dateien.
  //
  // Format (Kurzfassung, Einzelheiten und Platzhalter-Hinweise stehen in der JSON):
  //   decks[]            Deck 0 = Oberfläche; weitere Decks (Bunker, BOD-03) sind vorgesehen, werden heute abgewiesen
  //   decks[0].reihenfolge   Abschnitts-IDs links nach rechts
  //   decks[0].abschnitte    { id: { name, waehlbar?, standard, varianten: { id: { name, breite, rows[], anker[], bereiche{} } } } }
  //   zeichen            Platzhalter-Zeichen im Raster -> echte Kachel ({ kachel, platzhalter }); Tausch eines Platzhalters = kachel ändern
  //   pflicht, wellen, ziel  -> meta.pflicht, meta.wellen, meta.ziel
  // Koordinaten der Anker und Bereiche sind abschnittslokal (x ab linker Kante, y absolut) und werden hier umgesetzt.
  function pruefeDef(def) {
    if (!def || def.format !== 'festkarte/1') throw new Error('Feste Karte: Format festkarte/1 erwartet');
    if (!Array.isArray(def.decks) || !def.decks.length) throw new Error('Feste Karte: decks fehlt');
    if (def.decks.length > 1) throw new Error('Feste Karte: mehrere Decks sind noch nicht umgesetzt (BOD-03)');
  }
  // varianten(def) -> [{ abschnitt, name, waehlbar, standard, varianten: [{ id, name }] }] in Kartenreihenfolge (für die Lobby)
  function varianten(def) {
    pruefeDef(def);
    const d = def.decks[0];
    return d.reihenfolge.map((id) => {
      const a = d.abschnitte[id];
      return { abschnitt: id, name: a.name, waehlbar: a.waehlbar !== false, standard: a.standard, varianten: Object.keys(a.varianten).map((v) => ({ id: v, name: a.varianten[v].name })) };
    });
  }
  // standardAuswahl(def) -> { abschnittId: varianteId }
  function standardAuswahl(def) {
    const o = {};
    for (const v of varianten(def)) o[v.abschnitt] = v.standard;
    return o;
  }
  // auswahlPruefen(def, auswahl) -> Fehlertext oder null (Lobby/Szenario prüft eine Wahl vor dem Bau)
  function auswahlPruefen(def, auswahl) {
    pruefeDef(def);
    const d = def.decks[0];
    for (const k of Object.keys(auswahl || {})) {
      const a = d.abschnitte[k];
      if (!a) return `Abschnitt ${k} unbekannt`;
      if (!a.varianten[auswahl[k]]) return `Abschnitt ${k}: Variante ${auswahl[k]} unbekannt`;
    }
    return null;
  }
  // karteRoh(def, opts { id, bauweise, besitz, zustand, seed, abschnitte: { abschnittId: varianteId } }) -> Roh-Objekt
  function karteRoh(def, opts) {
    pruefeDef(def);
    opts = opts || {};
    const d = def.decks[0], H = def.hoehe, rand = def.rand || 'F';
    const wahl = Object.assign(standardAuswahl(def), opts.abschnitte || {});
    const fe = auswahlPruefen(def, wahl);
    if (fe) throw new Error('Feste Karte: ' + fe);
    const zeichen = def.zeichen || {};
    const rows = new Array(H).fill(rand);   // linker Rand
    const anker = [], bereiche = {}, gruppen = {}, ids = new Set(), platzhalter = {};
    let x0 = 1;
    for (const aid of d.reihenfolge) {
      const a = d.abschnitte[aid], v = a.varianten[wahl[aid]];
      if (!Array.isArray(v.rows) || v.rows.length !== H) throw new Error(`Feste Karte ${aid}/${wahl[aid]}: ${v.rows && v.rows.length} Zeilen statt ${H}`);
      const sz = Object.assign({}, zeichen, v.zeichen || {});
      for (let y = 0; y < H; y++) {
        const r = v.rows[y];
        if (r.length !== v.breite) throw new Error(`Feste Karte ${aid}/${wahl[aid]}: Zeile ${y} hat Länge ${r.length} statt ${v.breite}`);
        let out = '';
        for (const ch of r) {
          const z = sz[ch];
          if (z) { out += z.kachel; if (z.platzhalter) platzhalter[z.platzhalter] = (platzhalter[z.platzhalter] || 0) + 1; } else out += ch;
        }
        rows[y] += out;
      }
      for (const an of v.anker || []) {
        if (ids.has(an.id)) throw new Error(`Feste Karte: Anker ${an.id} doppelt`);
        ids.add(an.id);
        const o = Object.assign({}, an, { x: an.x + x0 });
        anker.push(o);
        if (an.gruppe) (gruppen[an.gruppe] = gruppen[an.gruppe] || []).push(an.id);
      }
      for (const bid of Object.keys(v.bereiche || {})) {
        const b = v.bereiche[bid];
        bereiche[bid] = Object.assign({}, b, { rects: b.rects.map((q) => [q[0] + x0, q[1], q[2], q[3]]) });
      }
      x0 += v.breite;
    }
    for (let y = 0; y < H; y++) rows[y] += rand;   // rechter Rand
    const w = x0 + 1;
    const wellen = def.wellen || {};
    for (const wl of Object.keys(wellen)) for (const g of wellen[wl]) if (!gruppen[g]) throw new Error(`Feste Karte: Welle ${wl} nennt Gruppe ${g}, die es in der Auswahl nicht gibt`);
    if (def.ziel && !ids.has(def.ziel)) throw new Error(`Feste Karte: Ziel-Anker ${def.ziel} fehlt`);
    const sig = d.reihenfolge.map((aid) => aid + '=' + wahl[aid]).join(',');
    const ab = anker.filter((q) => q.rolle === 'abholpunkt');
    return {
      id: opts.id || null, erzeuger: 'gen-fest/1', art: def.kartenart || 'aussenposten', bauweise: opts.bauweise || 'germanen', besitz: opts.besitz || null,
      zustand: opts.zustand || 'intakt', seed: opts.seed | 0, bauversion: `fest.${def.id}.${def.version || 1}[${sig}]`, schablone: 'gen-fest', spiegel: null, w, h: H, rows, legende: null, anker,
      bereiche, plaetze: {}, eingaenge: anker.filter((q) => q.rolle === 'eingang').map((q) => q.id), abholpunkte: ab.map((q) => q.id),
      ankunft: (ab.find((q) => q.ankunft) || {}).id || null,
      patrouillen: [], coverSpots: [], decks: null, kanten: {}, zustaende: {}, gelaende: null,
      meta: { versuche: 1, kennzahlen: null, linear: false, pflicht: Object.assign({}, def.pflicht), zellen: null, schiffDecks: null, torStart: 'offen', huelle: true, typ: 'militaer', titel: {},
        fest: def.id, abschnitte: wahl, gruppen, wellen, ziel: def.ziel || null, platzhalter, ...(def.boden ? { boden: def.boden } : {}) },
    };
  }
  return { karteRoh, varianten, standardAuswahl, auswahlPruefen };
});
