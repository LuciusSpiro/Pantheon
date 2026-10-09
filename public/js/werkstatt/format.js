// Werkstatt: Dateiformat der Module (modul/1) und Schablonen (schablone/1) – CONTRACT-B1 §5.1/§5.2, Team WERKSTATT.
// UMD: window.WerkstattFormat (Werkstatt im Browser) und require (server/werkstatt.js prüft damit vor dem Speichern).
// Nur Struktur und Dateiform. Die Bühnenregeln (§11.3, K-*) prüft ausschließlich shared/buehne.js.
//   pruefeModul(m)      -> [{ code: 'FORMAT', msg }]
//   pruefeSchablone(s)  -> [{ code: 'FORMAT', msg }]
//   art(o) / dateiPfad(o) -> '<art>/module/<id>.json' bzw. '<art>/schablonen/<id>.json' (relativ zu content/buehnen)
//   alsText(o)          -> JSON-Text in der Hausform (rows/anker/belegungen eine Zeile je Rasterzeile)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WerkstattFormat = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KARTENARTEN = ['aussenposten', 'station', 'ruine', 'schiff'];
  const ID_TEIL = /^[a-z0-9_]+$/;
  const SEITEN = ['N', 'O', 'S', 'W'];
  const EINGANG_ARTEN = ['laut', 'leise', 'technisch'];
  const KANTEN_TYPEN = ['offen', 'tuer', 'wand', 'frei'];
  const SCHIFF_BREITEN = [5, 6, 8, 12];
  const MODUL_SCHLUESSEL = ['format', 'id', 'art', 'typ', 'name', 'hinweis', 'groesse', 'deck', 'drehen', 'spiegeln', 'gewicht', 'bauweise',
    'rows', 'anker', 'anker_legende', 'belegungen'];
  const SCHABLONE_SCHLUESSEL = ['format', 'id', 'art', 'name', 'hinweis', 'zellen', 'spiegeln', 'fuellung', 'plaetze', 'decks', 'bereiche',
    'gefecht', 'paare', 'kanten_fest', 'pflicht'];

  const istInt = (v) => typeof v === 'number' && Number.isInteger(v);
  const istObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

  function istSchiffModul(m) { return m && (m.art === 'schiff' || (Array.isArray(m.groesse) && m.groesse[1] === 13)); }

  function raster(name, r, H, W, F) {
    if (!Array.isArray(r)) { F(`${name}: Liste von Zeilen erwartet`); return; }
    if (H != null && r.length !== H) F(`${name}: ${r.length} Zeilen, erwartet ${H}`);
    r.forEach((z, y) => {
      if (typeof z !== 'string') F(`${name}[${y}]: Text erwartet`);
      else if (W != null && z.length !== W) F(`${name}[${y}]: Länge ${z.length}, erwartet ${W}`);
    });
  }

  function pruefeModul(m) {
    const out = [];
    const F = (msg) => out.push({ code: 'FORMAT', msg });
    if (!istObj(m)) { F('Modul muss ein Objekt sein'); return out; }
    if (m.format !== 'modul/1') F(`format muss "modul/1" sein`);
    if (typeof m.art !== 'string' || !KARTENARTEN.includes(m.art)) F(`art "${m.art}" unbekannt (${KARTENARTEN.join(', ')})`);
    if (typeof m.typ !== 'string' || !ID_TEIL.test(m.typ)) F(`typ "${m.typ}" ungültig (a–z, 0–9, _)`);
    const teile = String(m.id || '').split('.');
    if (teile.length !== 3 || !teile.every((t) => ID_TEIL.test(t))) F(`id "${m.id}" nicht im Schema <art>.<typ>.<variante>`);
    else if (teile[0] !== m.art || teile[1] !== m.typ) F(`id "${m.id}" passt nicht zu art/typ (${m.art}.${m.typ}.…)`);
    let W = null, H = null;
    if (!Array.isArray(m.groesse) || m.groesse.length !== 2 || !m.groesse.every(istInt)) F('groesse: [breite, hoehe] erwartet');
    else if (istSchiffModul(m)) {
      W = m.groesse[0]; H = 13;
      if (m.groesse[1] !== 13) F('Schiff: groesse [breite, 13] in Kacheln');
      if (!SCHIFF_BREITEN.includes(W)) F(`Schiffsbreite ${W} nicht im Raster ${SCHIFF_BREITEN.join('/')}`);
      if (m.deck != null && m.deck !== 1 && m.deck !== 2) F('deck: null, 1 oder 2');
    } else {
      const ok = [[1, 1], [2, 1], [1, 2], [2, 2]].some((p) => p[0] === m.groesse[0] && p[1] === m.groesse[1]);
      if (!ok) F(`groesse ${JSON.stringify(m.groesse)} ungültig ([1,1], [2,1], [1,2], [2,2])`);
      W = m.groesse[0] * 8; H = m.groesse[1] * 8;
    }
    for (const k of ['drehen', 'spiegeln']) if (m[k] != null && typeof m[k] !== 'boolean') F(`${k}: true/false`);
    if (m.gewicht != null && !(typeof m.gewicht === 'number' && m.gewicht > 0)) F('gewicht: Zahl > 0');
    if (m.bauweise != null && !(Array.isArray(m.bauweise) && m.bauweise.every((b) => typeof b === 'string' && ID_TEIL.test(b)))) F('bauweise: null oder Liste von IDs');
    raster('rows', m.rows, H, W, F);
    if (m.anker != null) raster('anker', m.anker, H, W, F);
    if (m.anker_legende != null) {
      if (!istObj(m.anker_legende)) F('anker_legende: Objekt erwartet');
      else for (const c of Object.keys(m.anker_legende)) {
        if (c.length !== 1 || c === '.' || c === ' ') F(`anker_legende: Schlüssel "${c}" muss ein Zeichen ≠ "." sein`);
        const e = m.anker_legende[c];
        if (!istObj(e) || typeof e.rolle !== 'string') F(`anker_legende "${c}": { rolle } erwartet`);
      }
    }
    if (m.belegungen != null) {
      if (!Array.isArray(m.belegungen)) F('belegungen: Liste erwartet');
      else m.belegungen.forEach((b, i) => raster(`belegungen[${i}]`, b, H, W, F));
    }
    return out;
  }

  function pruefeSchablone(s) {
    const out = [];
    const F = (msg) => out.push({ code: 'FORMAT', msg });
    if (!istObj(s)) { F('Schablone muss ein Objekt sein'); return out; }
    if (s.format !== 'schablone/1') F('format muss "schablone/1" sein');
    if (typeof s.art !== 'string' || !KARTENARTEN.includes(s.art)) F(`art "${s.art}" unbekannt`);
    const teile = String(s.id || '').split('.');
    if (teile.length !== 2 || !teile.every((t) => ID_TEIL.test(t))) F(`id "${s.id}" nicht im Schema <art>.<name>`);
    else if (teile[0] !== s.art) F(`id-Präfix ${teile[0]} ≠ art ${s.art}`);
    if (s.spiegeln != null && !(Array.isArray(s.spiegeln) && s.spiegeln.every((a) => a === 'x' || a === 'y'))) F('spiegeln: Liste aus "x"/"y"');
    const bereiche = istObj(s.bereiche) ? s.bereiche : {};
    if (s.bereiche != null && !istObj(s.bereiche)) F('bereiche: Objekt erwartet');
    const alle = [];
    const platzBasis = (p, wo) => {
      if (!istObj(p)) { F(`${wo}: Objekt erwartet`); return false; }
      if (typeof p.id !== 'string' || !ID_TEIL.test(p.id)) F(`${wo}: id "${p.id}" ungültig (a–z, 0–9, _)`);
      if (typeof p.typ !== 'string' || !ID_TEIL.test(p.typ)) F(`${wo} ${p.id}: typ "${p.typ}" ungültig`);
      if (p.bereich != null && !bereiche[p.bereich]) F(`${wo} ${p.id}: bereich "${p.bereich}" nicht in bereiche`);
      if (p.eingang_art != null && !EINGANG_ARTEN.includes(p.eingang_art)) F(`${wo} ${p.id}: eingang_art "${p.eingang_art}" unbekannt`);
      for (const k of ['kern', 'ankunft', 'fest']) if (p[k] != null && typeof p[k] !== 'boolean') F(`${wo} ${p.id}: ${k} true/false`);
      alle.push(p);
      return true;
    };
    if (s.decks != null) {
      if (s.zellen != null) F('Schiff: decks statt zellen');
      if (!Array.isArray(s.decks) || !s.decks.length || s.decks.length > 2) F('decks: Liste mit 1–2 Decks');
      else s.decks.forEach((d, di) => {
        if (!istObj(d) || !Array.isArray(d.plaetze)) { F(`decks[${di}].plaetze fehlt`); return; }
        let sum = 0;
        d.plaetze.forEach((p, i) => {
          if (!platzBasis(p, `decks[${di}].plaetze[${i}]`)) return;
          if (!SCHIFF_BREITEN.includes(p.breite)) F(`Platz ${p.id}: breite ${p.breite} nicht im Raster ${SCHIFF_BREITEN.join('/')}`);
          else sum += p.breite;
        });
        if (di > 0 && Array.isArray(s.decks[0].plaetze)) {
          const sum0 = s.decks[0].plaetze.reduce((a, p) => a + ((p && p.breite) | 0), 0);
          if (sum0 !== sum) F(`Deck ${di + 1} ist ${sum} breit, Deck 1 ${sum0} (gleiches Breitenraster)`);
        }
      });
    } else {
      if (!Array.isArray(s.zellen) || s.zellen.length !== 2 || !s.zellen.every((v) => istInt(v) && v > 0 && v <= 16)) F('zellen: [breite, hoehe] in Zellen');
      if (!Array.isArray(s.plaetze)) F('plaetze: Liste erwartet');
      else {
        const [CW, CH] = Array.isArray(s.zellen) ? s.zellen : [0, 0];
        const belegt = {};
        s.plaetze.forEach((p, i) => {
          if (!platzBasis(p, `plaetze[${i}]`)) return;
          const w = p.w == null ? 1 : p.w, h = p.h == null ? 1 : p.h;
          if (![p.x, p.y, w, h].every(istInt)) { F(`Platz ${p.id}: x, y, w, h ganzzahlig`); return; }
          if (w < 1 || h < 1 || w > 2 || h > 2) F(`Platz ${p.id}: w/h 1–2`);
          if (p.x < 0 || p.y < 0 || p.x + w > CW || p.y + h > CH) F(`Platz ${p.id} liegt außerhalb der Schablone`);
          if (p.richtung != null && !SEITEN.includes(p.richtung)) F(`Platz ${p.id}: richtung N/O/S/W`);
          for (let y = p.y; y < p.y + h; y++) for (let x = p.x; x < p.x + w; x++) {
            const k = x + ',' + y;
            if (belegt[k]) F(`Plätze ${belegt[k]} und ${p.id} überlappen bei ${k}`);
            belegt[k] = p.id;
          }
        });
      }
    }
    const ids = {};
    for (const p of alle) { if (ids[p.id]) F(`Platz-id ${p.id} doppelt`); ids[p.id] = true; }
    const ank = alle.filter((p) => p.ankunft === true).length;
    if (ank !== 1) F(`genau ein Platz mit ankunft: true (sind ${ank})`);
    if (s.gefecht != null) {
      if (!Array.isArray(s.gefecht)) F('gefecht: Liste von Platz-IDs');
      else for (const g of s.gefecht) if (!ids[g]) F(`gefecht: Platz ${g} unbekannt`);
    }
    if (s.paare != null) {
      if (!istObj(s.paare)) F('paare: Objekt { Buchstabe: [platzA, platzB] }');
      else for (const k of Object.keys(s.paare)) {
        const v = s.paare[k];
        if (!/^[A-Z]$/.test(k)) F(`paare: Schlüssel "${k}" muss ein Großbuchstabe sein`);
        if (!Array.isArray(v) || v.length !== 2) F(`paare.${k}: genau 2 Plätze`);
        else for (const q of v) if (!ids[q]) F(`paare.${k}: Platz ${q} unbekannt`);
      }
    }
    if (s.kanten_fest != null) {
      if (!Array.isArray(s.kanten_fest)) F('kanten_fest: Liste');
      else s.kanten_fest.forEach((k, i) => {
        if (!istObj(k) || !ids[k.a] || !ids[k.b]) F(`kanten_fest[${i}]: a/b müssen Platz-IDs sein`);
        else if (!KANTEN_TYPEN.includes(k.typ)) F(`kanten_fest[${i}]: typ ${k.typ} unbekannt`);
      });
    }
    if (s.pflicht != null) {
      if (!istObj(s.pflicht)) F('pflicht: Objekt { rolle: anzahl }');
      else for (const k of Object.keys(s.pflicht)) if (!istInt(s.pflicht[k]) || s.pflicht[k] < 0) F(`pflicht.${k}: ganze Zahl ≥ 0`);
    }
    return out;
  }

  function art(o) { return o && typeof o.art === 'string' ? o.art : null; }
  function istSchablone(o) { return !!o && o.format === 'schablone/1'; }
  function dateiPfad(o) {
    if (!o || !art(o) || typeof o.id !== 'string') return null;
    return `${o.art}/${istSchablone(o) ? 'schablonen' : 'module'}/${o.id}.json`;
  }
  function pruefe(o) { return istSchablone(o) ? pruefeSchablone(o) : pruefeModul(o); }

  // ---------------- Hausform als Text ----------------
  function ordne(o, reihe) {
    const out = {};
    for (const k of reihe) if (o[k] !== undefined) out[k] = o[k];
    for (const k of Object.keys(o)) if (out[k] === undefined && o[k] !== undefined && k.charAt(0) !== '_') out[k] = o[k];
    return out;
  }
  const ist = (v) => v === null || typeof v !== 'object';
  function kompakt(v) {
    if (Array.isArray(v)) return '[' + v.map(kompakt).join(', ') + ']';
    if (v && typeof v === 'object') return '{ ' + Object.keys(v).map((k) => JSON.stringify(k) + ': ' + kompakt(v[k])).join(', ') + ' }';
    return JSON.stringify(v);
  }
  function rasterArtig(v) { return Array.isArray(v) && v.length > 1 && v.every((x) => typeof x === 'string') && v.some((x) => x.length >= 5); }
  function fmt(v, ein) {
    const ein2 = ein + '  ';
    if (ist(v)) return JSON.stringify(v);
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      if (rasterArtig(v)) return '[\n' + v.map((x) => ein2 + JSON.stringify(x)).join(',\n') + '\n' + ein + ']';
      const k = kompakt(v);
      if (v.every(ist) && k.length <= 100) return k;
      if (v.every((x) => x && typeof x === 'object' && !Array.isArray(x) && !Object.values(x).some((y) => rasterArtig(y) || (y && typeof y === 'object' && !Array.isArray(y))))) {
        return '[\n' + v.map((x) => ein2 + kompakt(x)).join(',\n') + '\n' + ein + ']';
      }
      return '[\n' + v.map((x) => ein2 + fmt(x, ein2)).join(',\n') + '\n' + ein + ']';
    }
    const keys = Object.keys(v).filter((k) => v[k] !== undefined);
    if (!keys.length) return '{}';
    const k = kompakt(v);
    if (k.length <= 100 && !keys.some((q) => rasterArtig(v[q]))) return k;
    return '{\n' + keys.map((q) => ein2 + JSON.stringify(q) + ': ' + fmt(v[q], ein2)).join(',\n') + '\n' + ein + '}';
  }
  function alsText(o) {
    const geordnet = istSchablone(o) ? ordne(o, SCHABLONE_SCHLUESSEL) : (o && o.format === 'modul/1') ? ordne(o, MODUL_SCHLUESSEL) : o;
    if (geordnet && Array.isArray(geordnet.plaetze)) {
      geordnet.plaetze = geordnet.plaetze.map((p) => ordne(p, ['id', 'typ', 'x', 'y', 'w', 'h', 'breite', 'fest', 'bereich', 'kern', 'richtung', 'eingang_art', 'ankunft']));
    }
    return fmt(geordnet, '') + '\n';
  }

  return { KARTENARTEN, SEITEN, EINGANG_ARTEN, KANTEN_TYPEN, SCHIFF_BREITEN, pruefeModul, pruefeSchablone, pruefe, art, istSchablone,
    istSchiffModul, dateiPfad, alsText };
});
