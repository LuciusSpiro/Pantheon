// CHA-01 B1: Charakterkarte – Format, Standard, Prüfung, Namen. UMD: window.Shared_Charakter / require. Reine Funktionen, keine Seiteneffekte, werfen nie.
// Katalog: content/katalog/charakter.json (Plätze mit Gruppe 'charakter' | 'outfit' und Standard, Teile { id: '<platz>/<name>', platz, gruppe }, farben.haut/haar).
// Karte: { v: 1, name, koerper, <Charakterplätze…>, haut: Index, haar: Index, outfit: { <Outfitplätze…> } } – in der Karte steht je Platz nur der Teilename.
// Prüfung je Feld: unbekanntes Teil, Teil eines anderen Platzes oder einer anderen Gruppe, Farbindex außerhalb/kein Integer, falscher Typ, fehlendes Feld → Standard dieses Feldes.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared_Charakter = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const VERSION = 1;
  const NAME_MIN = 2, NAME_MAX = 12;
  const STANDARD_NAME = 'Crew';

  const istObjekt = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const hat = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  // Katalog einmal in Nachschlagetabellen auflösen (Ergebnis je Katalogobjekt gemerkt)
  const cache = new WeakMap();
  function sicht(katalog) {
    if (!istObjekt(katalog)) return null;
    let s = cache.get(katalog);
    if (s) return s;
    const plaetze = (Array.isArray(katalog.plaetze) ? katalog.plaetze : []).filter((p) => istObjekt(p) && typeof p.id === 'string');
    const teile = new Set();
    for (const t of Array.isArray(katalog.teile) ? katalog.teile : []) {
      if (istObjekt(t) && typeof t.id === 'string' && typeof t.platz === 'string') teile.add(t.id);
    }
    const f = istObjekt(katalog.farben) ? katalog.farben : {};
    s = {
      charakter: plaetze.filter((p) => p.gruppe === 'charakter'),
      outfit: plaetze.filter((p) => p.gruppe === 'outfit'),
      teile,
      koerper: (Array.isArray(katalog.koerper) ? katalog.koerper : []).filter((k) => istObjekt(k) && typeof k.id === 'string').map((k) => k.id),
      nHaut: Array.isArray(f.haut) ? f.haut.length : 0,
      nHaar: Array.isArray(f.haar) ? f.haar.length : 0,
    };
    cache.set(katalog, s);
    return s;
  }

  // ---- Name ----
  // Steuerzeichen, <>, und alles außer Buchstaben/Ziffern/Leerzeichen/Bindestrich fliegt raus; trimmen, Mehrfach-Leerzeichen zu einem; 2–12 Zeichen sonst null (zu lang wird nicht gekürzt).
  function pruefeName(roh) {
    if (typeof roh !== 'string') return null;
    const t = roh.slice(0, 200).replace(/[^\p{L}\p{N} -]/gu, '').replace(/ {2,}/g, ' ').trim();
    const len = Array.from(t).length;
    return len >= NAME_MIN && len <= NAME_MAX ? t : null;
  }

  // Bei Kollision (Groß/klein egal) ` 2`, ` 3`, … anhängen; vorher kürzen, damit 12 Zeichen gelten.
  function eindeutigerName(name, andereNamen) {
    const base = typeof name === 'string' ? name : '';
    const belegt = new Set((Array.isArray(andereNamen) ? andereNamen : []).filter((n) => typeof n === 'string').map((n) => n.toLowerCase()));
    if (!belegt.has(base.toLowerCase())) return base;
    for (let i = 2; i < 1000; i++) {
      const suffix = ' ' + i;
      const kopf = Array.from(base).slice(0, NAME_MAX - suffix.length).join('').trimEnd();
      const kandidat = kopf + suffix;
      if (!belegt.has(kandidat.toLowerCase())) return kandidat;
    }
    return base;
  }

  // ---- Teile ----
  const standardVon = (p) => (typeof p.standard === 'string' ? p.standard : null);
  function teil(s, platz, roh) {
    // gültig nur, wenn '<platz>/<roh>' im Katalog steht – das schließt Teile anderer Plätze und Gruppen aus (Teile-IDs sind pro Platz eindeutig)
    return typeof roh === 'string' && roh.length <= 64 && s.teile.has(platz.id + '/' + roh) ? roh : standardVon(platz);
  }
  function outfitVon(s, roh) {
    const r = istObjekt(roh) ? roh : {};
    const out = {};
    for (const p of s.outfit) out[p.id] = teil(s, p, hat(r, p.id) ? r[p.id] : undefined);
    return out;
  }
  const farbe = (roh, n) => (Number.isInteger(roh) && roh >= 0 && roh < n ? roh : 0);

  function standardKarte(name, katalog) {
    const s = sicht(katalog);
    const k = { v: VERSION, name: pruefeName(name) || STANDARD_NAME, koerper: s && s.koerper.length ? s.koerper[0] : 'standard' };
    if (s) for (const p of s.charakter) k[p.id] = standardVon(p);
    k.haut = 0; k.haar = 0;
    k.outfit = {};
    if (s) for (const p of s.outfit) k.outfit[p.id] = standardVon(p);
    return k;
  }

  function pruefeKarte(roh, katalog) {
    const s = sicht(katalog);
    const r = istObjekt(roh) ? roh : {};
    const eigen = (f) => (hat(r, f) ? r[f] : undefined);   // nur eigene Eigenschaften, nie über den Prototyp
    const k = standardKarte(pruefeName(eigen('name')), katalog);
    if (!s) return k;
    const kb = eigen('koerper');
    if (typeof kb === 'string' && s.koerper.includes(kb)) k.koerper = kb;
    for (const p of s.charakter) k[p.id] = teil(s, p, hat(r, p.id) ? r[p.id] : undefined);
    k.haut = farbe(eigen('haut'), s.nHaut);
    k.haar = farbe(eigen('haar'), s.nHaar);
    k.outfit = outfitVon(s, eigen('outfit'));
    return k;
  }

  function pruefeOutfit(roh, katalog) {
    const s = sicht(katalog);
    return s ? outfitVon(s, roh) : {};
  }

  // CHA-01 B2: Figur-Parameter und Farben der Voxelfigur aus einer Karte. params = Teil je Platz (Charakter + Outfit) und koerper, colors = skin/skin_shadow/hair
  // aus katalog.farben (nie eine Spielerfarbe). Die Karte wird vorher geprüft; ohne brauchbaren Katalog null (Aufrufer nimmt dann die heutige Figur).
  function figurAusKarte(karte, katalog) {
    const s = sicht(katalog);
    if (!s || !s.nHaut || !s.nHaar) return null;
    const k = pruefeKarte(karte, katalog);
    const params = { koerper: k.koerper };
    for (const p of s.charakter) params[p.id] = k[p.id];
    for (const p of s.outfit) params[p.id] = k.outfit[p.id];
    const haut = katalog.farben.haut[k.haut], haar = katalog.farben.haar[k.haar];
    if (!istObjekt(haut) || typeof haut.skin !== 'string' || typeof haut.skin_shadow !== 'string' || typeof haar !== 'string') return null;
    return { params, colors: { skin: haut.skin, skin_shadow: haut.skin_shadow, hair: haar } };
  }

  return { VERSION, NAME_MIN, NAME_MAX, STANDARD_NAME, standardKarte, pruefeKarte, pruefeOutfit, pruefeName, eindeutigerName, figurAusKarte };
});
