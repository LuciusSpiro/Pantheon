// LAD-01 A1: Warenmodell als Daten (content/waren.json). Eine Ware ist ein Baustein mit Eigenschaften, eine neue Ware braucht keine Codeänderung.
// UMD: window.Shared_Waren / require. Server und Tests lesen die Datei direkt; der Browser holt /content/waren.json selbst (bis dahin: Anzeigename = Art-Kennung).
// Kategorie 'ware' = im Frachtraum als Art-Eintrag (fracht.artOk), 'person' = eigener Weg (personen-bord.js). Reine Daten, keine Spielregel.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../content/waren.json'));
  else root.Shared_Waren = factory(null, root);
})(typeof self !== 'undefined' ? self : this, function (daten, root) {
  'use strict';
  const FELDER = ['id', 'name', 'grundpreis', 'gewicht', 'eigenschaften', 'darstellung', 'kategorie'];
  const KATEGORIEN = ['ware', 'person'];
  let standard = 'sprengstoff';
  const index = new Map();

  // -> Liste von Fehlertexten (leer = gültig)
  function pruefe(w) {
    const f = [];
    if (!w || typeof w !== 'object') return ['keine Ware'];
    if (typeof w.id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(w.id)) f.push('id');
    if (typeof w.name !== 'string' || !w.name) f.push('name');
    if (!Number.isFinite(w.grundpreis) || w.grundpreis < 0) f.push('grundpreis');
    if (!Number.isFinite(w.gewicht) || w.gewicht < 0) f.push('gewicht');
    if (!Array.isArray(w.eigenschaften) || w.eigenschaften.some((e) => typeof e !== 'string')) f.push('eigenschaften');
    if (typeof w.darstellung !== 'string' || !w.darstellung) f.push('darstellung');
    if (!KATEGORIEN.includes(w.kategorie)) f.push('kategorie');
    return f.map((x) => (w && w.id ? w.id + ': ' : '') + 'Feld ' + x + ' fehlt oder ist ungültig');
  }
  function registrieren(w) {
    const f = pruefe(w);
    if (f.length) throw new Error('Ware ungültig: ' + f.join('; '));
    index.set(w.id, w);
    return w;
  }
  function entfernen(id) { return index.delete(id); }
  // Daten (neu) setzen: { standard, waren: [...] }; ungültige Einträge werden übersprungen (Browser) bzw. melden sich über pruefe
  function setze(d) {
    if (!d || !Array.isArray(d.waren)) return;
    index.clear();
    for (const w of d.waren) if (!pruefe(w).length) index.set(w.id, w);
    if (typeof d.standard === 'string') standard = d.standard;
  }

  const get = (id) => index.get(id) || null;
  const liste = () => Array.from(index.values());
  const artOk = (id) => { const w = index.get(id); return !!w && w.kategorie === 'ware'; };   // Ladungsart im Frachtraum (Personen nicht)
  const arten = () => liste().filter((w) => w.kategorie === 'ware').map((w) => w.id);
  const name = (id) => { const w = index.get(id); return w ? w.name : String(id); };
  const grundpreis = (id) => { const w = index.get(id); return w ? w.grundpreis : 0; };
  const gewicht = (id) => { const w = index.get(id); return w ? w.gewicht : 0; };

  if (daten) setze(daten);
  else if (root && typeof root.fetch === 'function') {
    root.fetch('/content/waren.json').then((r) => (r.ok ? r.json() : null)).then(setze).catch(() => { /* ohne Daten: Anzeigename = Kennung */ });
  }

  return { FELDER, KATEGORIEN, pruefe, registrieren, entfernen, setze, get, liste, artOk, arten, name, grundpreis, gewicht, standard: () => standard };
});
