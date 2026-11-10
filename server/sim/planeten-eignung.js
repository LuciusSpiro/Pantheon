'use strict';
// DYN-01 C: Planeten-Eignung. Welche Kartenart ein Abenteuer-Ort (server/sim/abenteuer-orte.js) an einem Koerper haben darf, steht in content/welt/planeten-eignung.json (kein Wert im Code).
// Auskunft fuer bestellenAmKoerper, den Plan-Pruefer (DYN-01 B) und BEA-02:
//   artenFuerPlanet(planetenart) -> [art]              erlaubte Kartenarten am Koerper (unbekannte Planetenart: [] = nicht landbar, kein Absturz)
//   artPasstAmKoerper(planetenart, art) -> bool
//   grundGegen(planetenart, art) -> string | null      Klartext, warum die Art dort nicht geht (null = passt)
//   biomFuerPlanet(planetenart) -> biom | null          Biom der Wildnis-Karte an diesem Planeten (aus sektortypen.json), null = auto
//   artenAmHex(hex) -> { koerper: [{ id, planetenart, arten }], punkt: [art] }   die Szene des Hex (auch Leerraum: koerper leer, nur Punkt-Arten; Hex ohne Szene: beides leer)
//   pruefe(daten) -> [Fehlertext]                      Schema-/Konsistenzpruefung der Datei (laedt beim Start und wirft bei Fehlern)
// id eines Koerpers: Index in scene.planeten (Hex ohne typ) bzw. Kachel-Id (typ-Hex, dort gilt die Kachel: arten = [Kartenart der Kachel], leer wenn nicht landbar).
const DATEN = require('../../content/welt/planeten-eignung.json');
const ORTE = require('../../content/welt/abenteuer-orte.json');
const Sektortypen = require('../../shared/sektortypen.js');
const Sektoren = require('../../shared/sektoren.js');
const Locations = require('../../shared/locations.js');
const GenGelaende = require('../../shared/gen-gelaende.js');

const istObjekt = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const planetenartenBekannt = () => Object.keys(Sektortypen.katalog().planetenarten).concat('gasriese');

function pruefe(d, arten, bekannt) {
  arten = arten || ORTE.arten; bekannt = bekannt || planetenartenBekannt();
  const f = [];
  if (!istObjekt(d)) return ['planeten-eignung: kein Objekt'];
  if (d.format !== 'planeten-eignung/1') f.push(`format: '${d.format}' unbekannt (erwartet 'planeten-eignung/1')`);
  const listeP = (liste, wo) => {
    if (!Array.isArray(liste)) { f.push(`${wo}: muss eine Liste von Kartenarten sein`); return; }
    liste.forEach((a, i) => { if (!arten.includes(a)) f.push(`${wo}[${i}]: Kartenart '${a}' unbekannt (erlaubt: ${arten.join('/')})`); });
    if (new Set(liste).size !== liste.length) f.push(`${wo}: Kartenart doppelt`);
  };
  if (!istObjekt(d.planetenarten)) f.push('planetenarten: fehlt oder kein Objekt');
  else {
    for (const [name, liste] of Object.entries(d.planetenarten)) {
      if (!bekannt.includes(name)) f.push(`Planetenart '${name}': unbekannt (erlaubt: ${bekannt.join('/')})`);
      listeP(liste, `Planetenart '${name}'`);
    }
    for (const name of bekannt) if (!(name in d.planetenarten)) f.push(`Planetenart '${name}': fehlt in planetenarten (leere Liste = keine Landung)`);
  }
  listeP(d.punkt, 'punkt');
  return f;
}
{
  const f = pruefe(DATEN);
  if (f.length) throw new Error('content/welt/planeten-eignung.json ungueltig:\n  ' + f.join('\n  '));
}

const artenFuerPlanet = (planetenart) => (typeof planetenart === 'string' && Object.prototype.hasOwnProperty.call(DATEN.planetenarten, planetenart) ? DATEN.planetenarten[planetenart].slice() : []);
const artPasstAmKoerper = (planetenart, art) => artenFuerPlanet(planetenart).includes(art);
function grundGegen(planetenart, art) {
  if (artPasstAmKoerper(planetenart, art)) return null;
  const erlaubt = artenFuerPlanet(planetenart);
  return `Kartenart '${art}' passt nicht zur Planetenart '${planetenart}'` + (erlaubt.length ? ` (erlaubt: ${erlaubt.join('/')})` : ' (keine Landung am Koerper; station oder schiff gehoeren an einen Raumpunkt)');
}

// DYN-01 Nacharbeit (Pruefung 4): das Biom einer Wildnis-Karte folgt der Planetenart (content/welt/sektortypen.json planetenarten[art].biom, dieselbe Quelle wie die Kachel-Landung); null = kein Biom (fels, eis, ozean, gasriese: 'auto')
function biomFuerPlanet(planetenart) {
  const k = Sektortypen.katalog().planetenarten;
  const b = typeof planetenart === 'string' && Object.prototype.hasOwnProperty.call(k, planetenart) ? k[planetenart].biom : null;
  return typeof b === 'string' && GenGelaende.BIOME.includes(b) ? b : null;
}

function artenAmHex(hex) {
  const out = { koerper: [], punkt: [] };
  const ort = typeof hex === 'string' ? Sektoren.ortVonHex(hex) : null;
  const l = ort && Locations.get(ort);
  const sc = l && l.scene;
  if (!sc) return out;   // kein Hex der Karte oder ohne Szene: nichts bestellbar
  out.punkt = DATEN.punkt.slice();
  if (Array.isArray(sc.koerper)) {   // typ-Hex: die Kachel entscheidet (kachelDef), nicht die Eignungsliste
    const LP = require('./landepunkte.js');
    for (const k of sc.koerper) {
      if (k.art !== 'planet' && k.art !== 'gasriese') continue;
      const d = k.landbar ? LP.kachelDef(ort + '.' + k.id) : null;
      out.koerper.push({ id: k.id, planetenart: k.art === 'gasriese' ? 'gasriese' : k.planetenart || null, arten: d ? [d.art] : [] });
    }
    return out;
  }
  (Array.isArray(sc.planeten) ? sc.planeten : []).forEach((p, i) => out.koerper.push({ id: i, planetenart: p.art, arten: artenFuerPlanet(p.art) }));
  return out;
}

module.exports = { artenFuerPlanet, artPasstAmKoerper, grundGegen, biomFuerPlanet, artenAmHex, pruefe, DATEN };
