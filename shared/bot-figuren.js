// BOT-05 A1: Pruefung der Bot-Stammcrew (content/bots/figuren.json). Rein, wirft nie: pruefeFiguren(daten, katalog, stimmen) gibt die Liste der Fehler zurueck (leer = gueltig).
// Liegt in shared/, weil nur shared/charakter.js die Karte lesen darf (tools/test-trefferbox.js sperrt den Zugriff fuer server/); der Loader server/bots/figuren.js wirft beim Start bei jedem Fehler.
// UMD: window.Shared_BotFiguren / require.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./charakter.js'));
  else root.Shared_BotFiguren = factory(root.Shared_Charakter);
})(typeof self !== 'undefined' ? self : this, function (Charakter) {
  'use strict';
  const FORMAT = 'bot-figuren/1';
  const ANZAHL = 3;
  const istObjekt = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

  function pruefeFiguren(daten, katalog, stimmen) {
    const f = [];
    if (!istObjekt(daten) || daten.format !== FORMAT) return ['Format ist nicht ' + FORMAT];
    if (!Array.isArray(daten.figuren) || daten.figuren.length !== ANZAHL) return ['es braucht genau ' + ANZAHL + ' Figuren'];
    const frei = new Set((Array.isArray(katalog && katalog.teile) ? katalog.teile : []).filter((t) => t.herkunft === undefined || t.herkunft === 'frei').map((t) => t.id));
    const ids = new Set(), namen = new Set();
    daten.figuren.forEach((x, i) => {
      const w = 'Figur ' + i + ': ';
      if (!istObjekt(x)) { f.push(w + 'kein Objekt'); return; }
      if (typeof x.botId !== 'string' || !/^b\d$/.test(x.botId)) f.push(w + 'botId fehlt oder hat falsche Form');
      else if (ids.has(x.botId)) f.push(w + 'botId ' + x.botId + ' doppelt'); else ids.add(x.botId);
      const name = Charakter.pruefeName(x.name);
      if (name === null || name !== x.name) f.push(w + 'Name ungueltig (' + JSON.stringify(x.name) + ')');
      else if (namen.has(name.toLowerCase())) f.push(w + 'Name ' + name + ' doppelt'); else namen.add(name.toLowerCase());
      if (!istObjekt(stimmen) || typeof x.stimme !== 'string' || !Object.prototype.hasOwnProperty.call(stimmen, x.stimme)) f.push(w + 'Stimme ' + JSON.stringify(x.stimme) + ' fehlt in stimmen.json');
      if (typeof x.persoenlichkeit !== 'string' || !x.persoenlichkeit.trim()) f.push(w + 'persoenlichkeit fehlt');
      if (!istObjekt(x.karte)) { f.push(w + 'Karte fehlt'); return; }
      if (JSON.stringify(Charakter.pruefeKarte(x.karte, katalog)) !== JSON.stringify(x.karte)) f.push(w + 'Karte besteht pruefeKarte nicht unveraendert');
      if (x.karte.name !== x.name) f.push(w + 'Kartenname ' + JSON.stringify(x.karte.name) + ' ist nicht der Figurname');
      const teile = (Array.isArray(katalog && katalog.plaetze) ? katalog.plaetze : []).map((p) => p.id + '/' + (p.gruppe === 'outfit' ? (x.karte.outfit || {})[p.id] : x.karte[p.id]));
      for (const t of teile) if (!frei.has(t)) f.push(w + 'Teil ' + t + ' ist nicht frei');
    });
    return f;
  }

  return { FORMAT, ANZAHL, pruefeFiguren };
});
