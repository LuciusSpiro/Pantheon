(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GenFest = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // Feste Karten (BOD-01, Format festkarte/1, BOD-03: festkarte/2 mit mehreren Decks, Beispiel content/buehnen/festkarten/grabenangriff.json): eine handgebaute Karte aus
  // austauschbaren Abschnitten (Wiese, Wald, Eingangsbereich ...) mit Varianten. Der Erzeuger setzt die Abschnitte links nach rechts
  // zu einem Raster zusammen und liefert dasselbe Roh-Objekt wie gen-siedlung/gen-station (rows, w, h, anker, bereiche, plaetze,
  // meta.pflicht, art) für Buehne.ausRaster. Die Definition kommt als Objekt herein (Laden der Datei: server/sim/landepunkte.js),
  // der Erzeuger liest keine Dateien.
  //
  // Format (Kurzfassung, Einzelheiten und Platzhalter-Hinweise stehen in der JSON):
  //   format             festkarte/1 (ein Deck) oder festkarte/2 (BOD-03: ein oder mehrere Decks, Bunker unter der Oberfläche)
  //   decks[]            Deck 0 = Oberfläche; weitere Decks (Bunker) nur in festkarte/2
  //   decks[n].reihenfolge   Abschnitts-IDs links nach rechts
  //   decks[n].abschnitte    { id: { name, waehlbar?, standard, varianten: { id: { name, breite, rows[], anker[], bereiche{} } } } }
  //   decks[n].hoehe     (optional, ab Deck 1) Zeilen des Decks, sonst def.hoehe; decks[n].rand / .fuellung (optional): Randzeichen, Füllzeichen ('_')
  //   links              (nur festkarte/2) [{ a, b, via? }] Deck-Links zwischen Anker-IDs (Lift/Leiter), via fehlt -> Rolle des Ankers a
  //   bauweise           (optional) Bauweise der Karte (z. B. rom_feld, VOX-01 5a); fehlt sie, gilt die des Landepunkts (server/sim/landepunkte.js festBauen)
  //   zeichen            Platzhalter-Zeichen im Raster -> echte Kachel ({ kachel, platzhalter }); Tausch eines Platzhalters = kachel ändern
  //   pflicht, wellen, ziel  -> meta.pflicht, meta.wellen, meta.ziel
  // Koordinaten der Anker und Bereiche sind abschnittslokal (x ab linker Kante, y absolut IM DECK) und werden hier umgesetzt: x um den
  // Abschnittsversatz, y um n x stride (Deck n). Stride = höchstes Deck; alle Decks sind gleich breit (schmalere werden rechts mit '_'
  // aufgefüllt, der Client verträgt keine kürzeren Zeilen), Lücke zwischen den Decks = Zeilen aus '_'. Abschnitts-IDs sind über alle Decks eindeutig.
  // Genau ein Deck -> decks: null und die Karte byteweise wie vor BOD-03.
  function pruefeDef(def) {
    if (!def || (def.format !== 'festkarte/1' && def.format !== 'festkarte/2')) throw new Error('Feste Karte: Format festkarte/1 oder festkarte/2 erwartet');
    if (!Array.isArray(def.decks) || !def.decks.length) throw new Error('Feste Karte: decks fehlt');
    if (def.decks.length > 1 && def.format !== 'festkarte/2') throw new Error('Feste Karte: mehrere Decks brauchen Format festkarte/2');
    const gesehen = new Set();
    for (const d of def.decks) for (const aid of d.reihenfolge || []) {
      if (gesehen.has(aid)) throw new Error(`Feste Karte: Abschnitt ${aid} kommt in mehreren Decks/Reihenfolgen vor`);
      gesehen.add(aid);
    }
  }
  // Abschnittsliste aller Decks: [[deckIndex, abschnittsId, abschnitt]] in Deck- und Kartenreihenfolge
  function alleAbschnitte(def) {
    const o = [];
    def.decks.forEach((d, di) => { for (const id of d.reihenfolge) o.push([di, id, d.abschnitte[id]]); });
    return o;
  }
  // varianten(def) -> [{ abschnitt, name, waehlbar, standard, varianten: [{ id, name }] }] in Kartenreihenfolge (für die Lobby)
  function varianten(def) {
    pruefeDef(def);
    return alleAbschnitte(def).map(([, id, a]) => {
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
    const abschnitte = {};
    for (const d of def.decks) Object.assign(abschnitte, d.abschnitte);
    for (const k of Object.keys(auswahl || {})) {
      const eigen = (o, key) => Object.prototype.hasOwnProperty.call(o, key);   // kein Treffer auf Object.prototype (constructor, __proto__)
      const a = eigen(abschnitte, k) ? abschnitte[k] : null;
      if (!a) return `Abschnitt ${k} unbekannt`;
      if (!eigen(a.varianten, auswahl[k]) || !a.varianten[auswahl[k]]) return `Abschnitt ${k}: Variante ${auswahl[k]} unbekannt`;
    }
    return null;
  }
  // deckBauen: ein Deck aus seinen Abschnitten -> { rows, w, anker, bereiche }. yVersatz = n x stride; Gruppen, Anker-IDs und Platzhalter
  // laufen über alle Decks in den gemeinsamen Sammlern (ids, gruppen, platzhalter).
  function deckBauen(def, d, H, yVersatz, wahl, sammler) {
    const rand = d.rand || def.rand || 'F', zeichen = def.zeichen || {};
    const rows = new Array(H).fill(rand);   // linker Rand
    const anker = [], bereiche = {};
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
          if (z) { out += z.kachel; if (z.platzhalter) sammler.platzhalter[z.platzhalter] = (sammler.platzhalter[z.platzhalter] || 0) + 1; } else out += ch;
        }
        rows[y] += out;
      }
      for (const an of v.anker || []) {
        if (sammler.ids.has(an.id)) throw new Error(`Feste Karte: Anker ${an.id} doppelt`);
        sammler.ids.add(an.id);
        const o = Object.assign({}, an, { x: an.x + x0 });
        if (yVersatz) o.y = an.y + yVersatz;
        anker.push(o);
        if (an.gruppe) (sammler.gruppen[an.gruppe] = sammler.gruppen[an.gruppe] || []).push(an.id);
      }
      for (const bid of Object.keys(v.bereiche || {})) {
        const b = v.bereiche[bid];
        bereiche[bid] = Object.assign({}, b, { rects: b.rects.map((q) => [q[0] + x0, q[1] + yVersatz, q[2], q[3]]) });
      }
      x0 += v.breite;
    }
    for (let y = 0; y < H; y++) rows[y] += rand;   // rechter Rand
    return { rows, w: x0 + 1, anker, bereiche };
  }
  // linksBauen: def.links (Anker-IDs) -> [{ a: [x, y], b: [x, y], via }] für karte.decks.links; prüft, dass beide Enden Lift/Leiter auf
  // verschiedenen Decks sind
  function linksBauen(def, anker, stride) {
    const nachId = new Map(anker.map((q) => [q.id, q]));
    return (def.links || []).map((l) => {
      const a = nachId.get(l.a), b = nachId.get(l.b);
      if (!a || !b) throw new Error(`Feste Karte: Deck-Link ${l.a} -> ${l.b}: Anker fehlt`);
      const via = l.via || a.rolle;
      if (via !== 'lift' && via !== 'leiter') throw new Error(`Feste Karte: Deck-Link ${l.a} -> ${l.b}: via ${via} ist weder lift noch leiter`);
      if (a.rolle !== via || b.rolle !== via) throw new Error(`Feste Karte: Deck-Link ${l.a} -> ${l.b}: beide Anker brauchen die Rolle ${via}`);
      if (Math.floor(a.y / stride) === Math.floor(b.y / stride)) throw new Error(`Feste Karte: Deck-Link ${l.a} -> ${l.b}: beide Enden im selben Deck`);
      return { a: [a.x, a.y], b: [b.x, b.y], via };
    });
  }
  // karteRoh(def, opts { id, bauweise, besitz, zustand, seed, abschnitte: { abschnittId: varianteId } }) -> Roh-Objekt
  function karteRoh(def, opts) {
    pruefeDef(def);
    opts = opts || {};
    const H = def.hoehe;
    const wahl = Object.assign(standardAuswahl(def), opts.abschnitte || {});
    const fe = auswahlPruefen(def, wahl);
    if (fe) throw new Error('Feste Karte: ' + fe);
    const sammler = { ids: new Set(), gruppen: {}, platzhalter: {} };
    const mehrere = def.decks.length > 1;
    const hoehen = def.decks.map((d, di) => (di > 0 && d.hoehe) || H);
    const stride = Math.max(...hoehen);
    const decks = def.decks.map((d, di) => deckBauen(def, d, hoehen[di], di * stride, wahl, sammler));
    const { gruppen, ids, platzhalter } = sammler;
    const anker = [], bereiche = {};
    for (const dk of decks) { anker.push(...dk.anker); Object.assign(bereiche, dk.bereiche); }
    let rows, w;
    if (!mehrere) { rows = decks[0].rows; w = decks[0].w; }
    else {
      // alle Decks gleich breit (schmalere rechts mit '_' auffüllen), zwischen den Decks Lücke aus '_' bis zum Stride
      w = Math.max(...decks.map((dk) => dk.w));
      rows = [];
      decks.forEach((dk, di) => {
        const fuell = def.decks[di].fuellung || '_';
        for (const r of dk.rows) rows.push(r + fuell.repeat(w - r.length));
        if (di < decks.length - 1) for (let y = hoehen[di]; y < stride; y++) rows.push('_'.repeat(w));
      });
    }
    const wellen = def.wellen || {};
    for (const wl of Object.keys(wellen)) for (const g of wellen[wl]) if (!gruppen[g]) throw new Error(`Feste Karte: Welle ${wl} nennt Gruppe ${g}, die es in der Auswahl nicht gibt`);
    if (def.ziel && !ids.has(def.ziel)) throw new Error(`Feste Karte: Ziel-Anker ${def.ziel} fehlt`);
    const links = mehrere ? linksBauen(def, anker, stride) : [];
    const sig = alleAbschnitte(def).map(([, aid]) => aid + '=' + wahl[aid]).join(',');
    const ab = anker.filter((q) => q.rolle === 'abholpunkt');
    return {
      id: opts.id || null, erzeuger: mehrere ? 'gen-fest/2' : 'gen-fest/1', art: def.kartenart || 'aussenposten', bauweise: opts.bauweise || 'germanen', besitz: opts.besitz || null,
      zustand: opts.zustand || 'intakt', seed: opts.seed | 0, bauversion: `fest.${def.id}.${def.version || 1}[${sig}]`, schablone: 'gen-fest', spiegel: null, w, h: rows.length, rows, legende: null, anker,
      bereiche, plaetze: {}, eingaenge: anker.filter((q) => q.rolle === 'eingang').map((q) => q.id), abholpunkte: ab.map((q) => q.id),
      ankunft: (ab.find((q) => q.ankunft) || {}).id || null,
      patrouillen: [], coverSpots: [], decks: mehrere ? { stride, links } : null, kanten: {}, zustaende: {}, gelaende: null,
      meta: { versuche: 1, kennzahlen: null, linear: false, pflicht: Object.assign({}, def.pflicht), zellen: null, schiffDecks: null, torStart: 'offen', huelle: true, typ: 'militaer', titel: {},
        fest: def.id, abschnitte: wahl, gruppen, wellen, ziel: def.ziel || null, platzhalter, ...(def.boden ? { boden: def.boden } : {}), ...(def.boden2 ? { boden2: def.boden2 } : {}) },
    };
  }
  return { karteRoh, varianten, standardAuswahl, auswahlPruefen };
});
