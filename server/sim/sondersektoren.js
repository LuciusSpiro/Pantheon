'use strict';
// SON-01 A: Daten der Sondersektoren (content/welt/sondersektoren.json) und deren Pruefung gegen die Karte sund_frei. Reine Daten und Nachschlagen, kein Spielzustand, kein Beat.
//   laden()        die Liste (einmal gelesen, eingefroren); SONDERSEKTOREN_DATEI (Pfad) ersetzt sie fuer Tests und Mutationsproben
//   ladeDatei(f)   eine Datei lesen und das Format pruefen, ohne den Merker zu beruehren
//   alle()         alle Eintraege in der Reihenfolge der Datei
//   sektor(id)     ein Eintrag oder null
//   ids()          die Ids (Beat-Parameter `sektor` darf nur daraus erlaubt werden)
//   pruefe(daten, karte?) -> { ok, fehler: [Text] }   Regeln gegen sund_frei (setzt die Karte kurz und stellt die vorherige zurueck); karte nur fuer Tests (kaputte Kartenkopie)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DATEI = path.join(ROOT, 'content', 'welt', 'sondersektoren.json');
const BUECHER = path.join(ROOT, 'content', 'regiebuecher-sund');
const KARTE_DATEI = path.join(ROOT, 'content', 'welt', 'sund_frei.json');
const EINMAL = ['bei_erfolg'];

function ladeDatei(f) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!j || j.format !== 'sondersektoren/1' || !Array.isArray(j.sektoren)) throw new Error(`${f}: Format sondersektoren/1 mit Liste 'sektoren' erwartet`);
  return j;
}
let merk = null;
function laden() {
  if (!merk) {
    const j = ladeDatei(process.env.SONDERSEKTOREN_DATEI || DATEI);
    merk = Object.freeze(j.sektoren.map((s) => Object.freeze(JSON.parse(JSON.stringify(s)))));
  }
  return merk;
}
const alle = () => laden().slice();
const sektor = (id) => laden().find((s) => s.id === id) || null;
const ids = () => laden().map((s) => s.id);

const istHex = (h) => typeof h === 'string' && /^\d{4}$/.test(h);
function pruefe(daten, karte) {
  const fehler = [];
  const liste = Array.isArray(daten) ? daten : (daten && daten.sektoren);
  if (!Array.isArray(liste)) return { ok: false, fehler: ["Sondersektoren: Liste 'sektoren' fehlt"] };
  const Sektoren = require('../../shared/sektoren.js');
  const Orte = require('./abenteuer-orte.js');
  const vorher = Sektoren.KARTE;
  try {
    Sektoren.setzeKarte(karte || JSON.parse(fs.readFileSync(KARTE_DATEI, 'utf8')));
    const gesehen = new Set();
    liste.forEach((s, i) => {
      const w = `Sondersektor ${s && s.id !== undefined ? "'" + s.id + "'" : '#' + i}`;
      const F = (t) => fehler.push(`${w}: ${t}`);
      if (!s || typeof s !== 'object') { F('kein Objekt'); return; }
      if (typeof s.id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(s.id)) F(`id '${s.id}' fehlt oder ist kein Name (a-z, 0-9, _)`);
      else if (gesehen.has(s.id)) F('id kommt mehrfach vor'); else gesehen.add(s.id);
      // echtes Kartensystem (kein Leerraum: der ist anfliegbar, aber kein Ort einer Geschichte), spielbar, mit Szene
      const szene = (h) => istHex(h) && Sektoren.imRaster(h) && !Sektoren.istLeerraum(h) && Sektoren.spielbar(h) && Sektoren.hatSzene(h) && Orte.moeglicheArten(h).length > 0;
      if (!szene(s.hex)) F(`hex '${s.hex}' ist auf sund_frei nicht spielbar oder hat keine Szene`);
      if (!istHex(s.von) || !Sektoren.imRaster(s.von)) F(`von '${s.von}' ist kein Hex der Karte`);
      else if (!Sektoren.sindNachbarn(s.von, s.hex)) F(`von '${s.von}' ist kein geometrischer Nachbar von hex '${s.hex}'`);
      else if (!szene(s.von)) F(`von '${s.von}' ist auf sund_frei nicht spielbar oder hat keine Szene`);
      if (typeof s.buch !== 'string' || !s.buch) F('buch fehlt');
      else {
        const f = path.join(BUECHER, s.buch + '.regiebuch.json');
        let ok = false;
        try { ok = JSON.parse(fs.readFileSync(f, 'utf8')).id === s.buch; } catch (e) { ok = false; }
        if (!ok) F(`buch '${s.buch}' fehlt im Regiebuch-Katalog content/regiebuecher-sund`);
      }
      if (!EINMAL.includes(s.einmal)) F(`einmal '${s.einmal}' unbekannt (erlaubt: ${EINMAL.join(', ')})`);
      const z = s.ziel && s.ziel.erreichbar_max;
      if (!Number.isInteger(z) || z < 1) F(`ziel.erreichbar_max '${z}' muss eine ganze Zahl >= 1 sein`);
      const a = s.ausgang;
      if (!a || typeof a !== 'object') F('ausgang fehlt');
      else {
        if (!szene(a.hex)) F(`ausgang.hex '${a.hex}' ist auf sund_frei nicht spielbar oder hat keine Szene`);
        else if (a.hex === s.hex) F(`ausgang.hex '${a.hex}' darf nicht der Sondersektor selbst sein`);
        if (typeof a.funk !== 'string' || !a.funk.trim()) F('ausgang.funk fehlt');
      }
      const fk = s.funk;
      for (const k of ['start', 'erfolg', 'verlust']) if (!fk || typeof fk[k] !== 'string' || !fk[k].trim()) F(`funk.${k} fehlt`);
    });
  } finally { Sektoren.setzeKarte(vorher); }
  return { ok: fehler.length === 0, fehler };
}

module.exports = { laden, ladeDatei, alle, sektor, ids, pruefe, EINMAL };
