'use strict';
// Wirkungen der Crew auf die Weltsimulation (SUND-02 A, Paket B): Katalog, Prüfer, Anwender.
//
// Eine Wirkung ist ein reines JSON-Objekt { typ, ...Felder }. Eine Szene (Paket A2) liefert am Ende eine Liste davon; kriegslage.js prüft sie
// (pruefe), reicht die gültigen an Kern.tick, das sie VOR dem Schritt anwendet. Der Kern bleibt rein: nur Zustand, kein Spielzugriff.
// Das Gedächtnis der Kommandanten gehört nicht zum Sim-Zustand, sondern zum Spielaufsatz (kriegslage.js, welt.sim.kommandanten).
//
// Katalog (jede Zeile: Typ, Felder, Wirkung):
//   flotte_verlust       { flotte: id, punkte: >0 }            Stärke -= punkte (nicht mehr als vorhanden). Unter 0,5: Stärke 0,5, Rückzug nach Heimat, wie gefecht().
//   abwehr_verlust       { ort, punkte: >0 }                   Abwehr des Hafens bzw. Garnison des Postens -= punkte (nicht mehr als vorhanden, nie unter 0).
//   flaggschiff_gefallen { flotte, kommandant: {name, schicksal: 'entkommen'|'gefallen'} }   die Flotte bricht ab (Rückzug, auch mit Reststärke); Merken im Gedächtnis macht kriegslage.js.
//   ort_gehalten         { ort, angriff?: id }                 laufende Belagerung des Ortes endet: Flotten des Feldzugs Rückzug, Feldzug „abgewehrt“ (Ereignis angriff_abgewehrt).
//   ort_gefallen         { ort, an: fraktion }                 Hafen: wie erobern() (Ereignis hafen_gefallen); Posten: wie der Posten-Verlust im Gefecht (Ereignis posten_verloren).
// Neue Wirkung = neuer Eintrag in KATALOG (pruefe + anwenden), kein Umbau. pruefe liefert null (gültig) oder den Grund der Ablehnung.
const Daten = require('./daten.js');

const SCHICKSALE = ['entkommen', 'gefallen'];
const NAME_MAX = 60;
const istZahl = (x) => typeof x === 'number' && Number.isFinite(x);
const istId = (x) => Number.isInteger(x) && x >= 1;
let H = null;   // Helfer des Kerns (melde, erobern, ...), von installiere() gesetzt

const flotteMit = (z, id) => z.flotten.find((fl) => fl.id === id);
const hexKnoten = (z, d, ort) => (typeof ort === 'string' && Object.prototype.hasOwnProperty.call(z.hexe, ort) ? { nd: z.hexe[ort], hafen: d.hex[ort].hafen !== '' } : null);
const feind = (a, b) => require('./kern.js').feindlich(a, b);
const punkteFehler = (p, max, was) => {
  if (!istZahl(p) || p <= 0) return 'punkte muss eine Zahl > 0 sein';
  if (p > max + 1e-9) return `punkte ${p} übersteigt ${was} (${Math.round(max * 100) / 100})`;
  return null;
};
// laufende Belagerung eines Ortes: Feldzug mit Ziel ort, nicht beendet, Marsch/Direkt (nicht Sammeln), erste Flotte angekommen
const belagerungen = (z, ort, angriff) => z.angriffe.filter((r) => r.ziel === ort && r.t_ende === null && r.phase !== 'sammeln' && r.phase !== 'abgebrochen' && r.t_an !== null && (angriff === undefined || r.id === angriff));

const KATALOG = {
  flotte_verlust: {
    pruefe(z, d, wk) {
      const fl = istId(wk.flotte) ? flotteMit(z, wk.flotte) : null;
      if (!fl) return 'unbekannte Flotte';
      return punkteFehler(wk.punkte, fl.staerke, 'die Stärke der Flotte');
    },
    anwenden(c, wk) {
      const fl = flotteMit(c.z, wk.flotte);
      fl.staerke = Math.max(0, fl.staerke - wk.punkte);
      if (fl.staerke < 0.5) { fl.staerke = 0.5; fl.ort = fl.heimat; fl.befehl = 'heim'; fl.ziel = null; }   // Konvention von gefecht()
    },
  },
  abwehr_verlust: {
    pruefe(z, d, wk) {
      const k = hexKnoten(z, d, wk.ort);
      if (!k) return 'unbekannter Ort';
      if (!k.hafen && !k.nd.posten) return 'Ort hat weder Hafen noch Posten';
      return punkteFehler(wk.punkte, k.hafen ? k.nd.abwehr : k.nd.garnison, k.hafen ? 'die Abwehr' : 'die Garnison');
    },
    anwenden(c, wk) {
      const nd = c.z.hexe[wk.ort];
      if (H.istHafen(c, wk.ort)) nd.abwehr = Math.max(0, nd.abwehr - wk.punkte); else nd.garnison = Math.max(0, nd.garnison - wk.punkte);
    },
  },
  flaggschiff_gefallen: {
    pruefe(z, d, wk) {
      if (!istId(wk.flotte) || !flotteMit(z, wk.flotte)) return 'unbekannte Flotte';
      const k = wk.kommandant;
      if (!k || typeof k !== 'object') return 'kommandant fehlt';
      if (typeof k.name !== 'string' || !k.name.trim() || k.name.length > NAME_MAX) return 'kommandant.name fehlt oder ungültig';
      if (!SCHICKSALE.includes(k.schicksal)) return 'kommandant.schicksal muss entkommen oder gefallen sein';
      return null;
    },
    anwenden(c, wk) {
      const fl = flotteMit(c.z, wk.flotte);
      const rec = fl.angriff !== null ? c.z.angriffe.find((r) => r.id === fl.angriff) : null;
      fl.befehl = 'rueckzug'; fl.ziel = fl.heimat;
      if (rec && rec.phase === 'sammeln') fl.angriff = null;   // wie sammeln() beim Abbruch; sonst bleibt der Feldzug verknüpft und schließt sich als abgewehrt
    },
  },
  ort_gehalten: {
    pruefe(z, d, wk) {
      if (!hexKnoten(z, d, wk.ort)) return 'unbekannter Ort';
      if (wk.angriff !== undefined && !istId(wk.angriff)) return 'angriff ungültig';
      if (!belagerungen(z, wk.ort, wk.angriff).length) return 'keine laufende Belagerung des Ortes';
      return null;
    },
    anwenden(c, wk) {
      for (const rec of belagerungen(c.z, wk.ort, wk.angriff)) {
        for (const fl of c.z.flotten) if (fl.angriff === rec.id && fl.befehl === 'angriff') { fl.befehl = 'rueckzug'; fl.ziel = fl.heimat; }
        rec.ausgang = 'abgewehrt'; rec.t_ende = c.z.tick;
        H.meldeAbgewehrt(c, rec);
      }
    },
  },
  ort_gefallen: {
    pruefe(z, d, wk) {
      const k = hexKnoten(z, d, wk.ort);
      if (!k) return 'unbekannter Ort';
      if (typeof wk.an !== 'string' || !['rom', 'ger', 'kon', 'pirat'].includes(wk.an)) return 'unbekannte Fraktion (an)';
      const alt = k.nd.besitzer;
      if (!k.hafen && !k.nd.posten) return 'Ort hat weder Hafen noch Posten';
      if (!alt) return 'Ort hat keinen Besitzer';
      if (!feind(wk.an, alt)) return `${wk.an} ist nicht feindlich zu ${alt}`;
      if (k.hafen && wk.an === 'pirat') return 'Piraten erobern keinen Hafen';
      return null;
    },
    anwenden(c, wk) {
      const nd = c.z.hexe[wk.ort];
      if (H.istHafen(c, wk.ort)) H.erobern(c, wk.ort, wk.an); else H.postenVerlieren(c, wk.ort, nd.besitzer, wk.an);
    },
  },
};

// Prüft eine Wirkung gegen den Zustand. -> { ok, grund }
function pruefe(zustand, wirkung) {
  if (!wirkung || typeof wirkung !== 'object' || Array.isArray(wirkung)) return { ok: false, grund: 'keine Wirkung' };
  if (typeof wirkung.typ !== 'string' || !Object.prototype.hasOwnProperty.call(KATALOG, wirkung.typ)) return { ok: false, grund: `unbekannter Typ "${wirkung.typ}"` };
  let grund;
  try { grund = KATALOG[wirkung.typ].pruefe(zustand, Daten.datenVon(zustand), wirkung); } catch (e) { grund = 'Prüfung fehlgeschlagen: ' + e.message; }
  return grund ? { ok: false, grund } : { ok: true, grund: null };
}

// Trägt den Katalog in die WIRKUNGEN des Kerns ein (einmal, beim Laden von kern.js). Die Prüfung der Felder macht pruefe(), nicht der Anwender.
function installiere(WIRKUNGEN, helfer) {
  H = helfer;
  for (const [typ, e] of Object.entries(KATALOG)) WIRKUNGEN[typ] = e.anwenden;
}

module.exports = { KATALOG, SCHICKSALE, pruefe, installiere };
