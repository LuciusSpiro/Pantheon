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
//   flaggschiff_gefallen { flotte, kommandant?: {name, schicksal: 'entkommen'|'gefallen'} }   die Flotte bricht ab (Rückzug, auch mit Reststärke); Merken im Gedächtnis macht kriegslage.js, nur MIT kommandant (ohne: kein Eintrag).
//   ort_gehalten         { ort, angriff?: id }                 laufende Belagerung des Ortes endet: Flotten des Feldzugs Rückzug, Feldzug „abgewehrt“ (Ereignis angriff_abgewehrt).
//   ort_gefallen         { ort, an: fraktion }                 nur bei laufender Belagerung des Ortes durch Flotten von `an`. Hafen: wie erobern() (Ereignis hafen_gefallen); Posten: wie der Posten-Verlust im Gefecht (Ereignis posten_verloren).
//   ruf_aenderung        { fraktion: 'rom'|'ger'|'kon', delta: Zahl ≠ 0, grund: Schlüssel aus content/welt/ruf-werte.json (quellen) }   Ruf der Crew bei einer Fraktion (SUND-02b B). Gehört NICHT zum Sim-Zustand: der Kern ignoriert sie (der Anwender im Katalog ist leer, Markierung `aufsatz`),
//                        angewandt wird sie vom Spielaufsatz nach dem Tick (kriegslage.js -> server/sim/ruf.js, welt.sim.ruf), atomar mit dem Tick. Damit bleibt der Kern rein und bitgleich zum Prototyp.
//   posten_gehisst       { ort }                               (SUND-02b A1) die Crew gründet einen Posten in einem freien Hex in Roms Anspruch (content/welt/posten-werte.json): Besitzer rom, Garnison werte.garrison, Merkmal crew true
//                        (Dock und Werft, nur der Spielaufsatz liest es) und ohneErtrag true (der Kern: ein Vorposten der Crew liefert keine Güter). Prüfer: Hex ohne Hafen, ohne Besitzer, ohne Posten, ohne feindliche Flotte, im Anspruch. Ereignis posten_gehisst (nicht posten_gegruendet: Kennzahlen zählen nur Posten der Sim).
//   posten_ausgebaut     { ort }                               (SUND-02b A1) die Crew baut einen vorhandenen römischen Posten zum Stützpunkt aus: Merkmal crew true, Garnison mindestens werte.garrison. Prüfer: Posten, Besitzer rom, ohne Hafen, noch ohne crew, ohne feindliche Flotte. Ereignis posten_ausgebaut.
//   posten_gesprengt     { ort }                               (SUND-02b A2) die Crew sprengt den Posten eines Gegners (Besitzer ger oder pirat, laut Kern-Regel feindlich zu Rom; Konkordat ist neutral, Rom nie ein Ziel: Beschuss auf Rom ist Paket E):
//                        der Posten wird frei wie beim Verlust im Gefecht (postenVerlieren, Ereignis posten_verloren mit durch rom). Prüfer: Posten, kein Hafen, Besitzer feindlich zu rom, Garnison höchstens
//                        werte.sprengen.garnison_max (posten-werte.json). Die Szene liefert den Rest der Garnison als abwehr_verlust im SELBEN Paket davor: die Prüfung läuft der Reihe nach gegen den Zustand
//                        nach den früheren Wirkungen (Kern.filtereWirkungen), ein Posten mit voller Garnison lässt sich also nie „einfach“ sprengen.
//   haltung_aenderung    { npc: Kennung eines NSC der Geschichtsfäden (n<Zahl>), delta: Zahl ≠ 0, grund: Schlüssel aus content/faeden/haltung-werte.json (quellen) }   Haltung eines NSC zur Crew (SUND-04a-1 B). Wie ruf_aenderung eine Aufsatz-Wirkung:
//                        der Kern ignoriert sie, angewandt wird sie vom Spielaufsatz (server/sim/faden.js, welt.sim.faeden). Der Prüfer hier prüft die Form (delta klein, Vorzeichen und Betrag wie der Grund, Grund bekannt);
//                        dass der NSC existiert, prüft der Aufsatz (faden.haltungPruefen): der Sim-Zustand kennt keine Fäden.
// Das Merkmal crew fehlt in Altständen und im Prototyp (additiv, optional); postenVerlieren räumt es weg (kern.js).
// Neue Wirkung = neuer Eintrag in KATALOG (pruefe + anwenden), kein Umbau. pruefe liefert null (gültig) oder den Grund der Ablehnung.
const Daten = require('./daten.js');

const RUF = require('../../content/welt/ruf-werte.json');   // Daten der Wirkung ruf_aenderung (Fraktionen, Grenzen, Gründe)
const HALTUNG = require('../../content/faeden/haltung-werte.json');   // SUND-04a-1 B: Daten der Wirkung haltung_aenderung (Grenzen, Gruende)
const POSTEN = require('../../content/welt/posten-werte.json').werte;   // Daten der Wirkungen posten_gehisst und posten_ausgebaut (Anspruch von Rom)
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
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
// angriff (optional): nur dieser Feldzug; von (optional): nur Feldzüge dieser Fraktion
const belagerungen = (z, ort, angriff, von) => z.angriffe.filter((r) => r.ziel === ort && r.t_ende === null && r.phase !== 'sammeln' && r.phase !== 'abgebrochen' && r.t_an !== null && (angriff === undefined || r.id === angriff) && (von === undefined || r.von === von));

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
      if (k === undefined) return null;   // ohne Kommandant (kein Name aus dem Plan): die Flotte bricht ab, ins Gedächtnis kommt nichts
      if (!k || typeof k !== 'object') return 'kommandant ungültig';
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
  posten_gehisst: {
    pruefe(z, d, wk) {
      const k = hexKnoten(z, d, wk.ort);
      if (!k) return 'unbekannter Ort';
      if (k.hafen) return 'Ort hat einen Hafen';
      if (k.nd.besitzer !== null) return 'Ort hat schon einen Besitzer';
      if (k.nd.posten) return 'Ort hat schon einen Posten';
      if (!POSTEN.anspruch.wert.rom.includes(wk.ort)) return 'Sektor liegt nicht in Roms Anspruch';
      if (z.flotten.some((fl) => fl.ort === wk.ort && fl.staerke > 0 && feind('rom', fl.fraktion))) return 'feindliche Flotte im Sektor';
      return null;
    },
    anwenden(c, wk) {
      const nd = c.z.hexe[wk.ort];
      nd.posten = true; nd.besitzer = 'rom'; nd.garnison = c.w.garrison; nd.anspruch = {}; nd.crew = true; nd.ohneErtrag = true;
      H.melde(c, 'posten_gehisst', 'rom', { ort: wk.ort });
    },
  },
  posten_ausgebaut: {
    pruefe(z, d, wk) {
      const k = hexKnoten(z, d, wk.ort);
      if (!k) return 'unbekannter Ort';
      if (k.hafen) return 'Ort hat einen Hafen';
      if (!k.nd.posten || k.nd.besitzer !== 'rom') return 'kein römischer Posten';
      if (k.nd.crew === true) return 'Posten ist schon ein Stützpunkt';
      if (z.flotten.some((fl) => fl.ort === wk.ort && fl.staerke > 0 && feind('rom', fl.fraktion))) return 'feindliche Flotte im Sektor';
      return null;
    },
    anwenden(c, wk) {
      const nd = c.z.hexe[wk.ort];
      nd.crew = true; nd.garnison = Math.max(nd.garnison, c.w.garrison);
      H.melde(c, 'posten_ausgebaut', 'rom', { ort: wk.ort });
    },
  },
  posten_gesprengt: {
    pruefe(z, d, wk) {
      const k = hexKnoten(z, d, wk.ort);
      if (!k) return 'unbekannter Ort';
      if (k.hafen) return 'Ort hat einen Hafen';
      if (!k.nd.posten) return 'Ort hat keinen Posten';
      if (k.nd.besitzer === null || !feind('rom', k.nd.besitzer)) return 'Posten gehört keinem Feind von Rom';
      if (k.nd.garnison > POSTEN.sprengen.wert.garnison_max + 1e-9) return 'Garnison ist noch zu stark';
      return null;
    },
    anwenden(c, wk) {
      H.postenVerlieren(c, wk.ort, c.z.hexe[wk.ort].besitzer, 'rom');
    },
  },
  ruf_aenderung: {
    aufsatz: true,   // gehört dem Spielaufsatz (ruf.js), nicht dem Sim-Zustand: der Kern nimmt sie an und tut nichts
    pruefe(z, d, wk) {
      const W = RUF.werte;
      if (typeof wk.fraktion !== 'string' || !has(W.fraktionen.wert, wk.fraktion)) return 'unbekannte Fraktion (fraktion)';
      if (!istZahl(wk.delta) || wk.delta === 0) return 'delta muss eine Zahl ungleich 0 sein';
      if (Math.abs(wk.delta) > W.delta_max.wert) return `delta ${wk.delta} übersteigt die Grenze ${W.delta_max.wert}`;
      if (typeof wk.grund !== 'string' || !has(W.quellen.wert, wk.grund)) return 'unbekannter Grund (grund)';
      if (W.quellen.wert[wk.grund].fraktion !== wk.fraktion) return `Grund ${wk.grund} gehört zu ${W.quellen.wert[wk.grund].fraktion}, nicht zu ${wk.fraktion}`;
      return null;
    },
    anwenden() { /* Spielaufsatz: ruf.js, nach dem Tick */ },
  },
  haltung_aenderung: {
    aufsatz: true,   // gehört dem Spielaufsatz (faden.js), nicht dem Sim-Zustand: der Kern nimmt sie an und tut nichts
    pruefe(z, d, wk) {
      const W = HALTUNG.werte;
      if (typeof wk.npc !== 'string' || !/^n[0-9]{1,6}$/.test(wk.npc)) return 'npc muss die Kennung eines NSC sein (npc)';
      if (!istZahl(wk.delta) || wk.delta === 0) return 'delta muss eine Zahl ungleich 0 sein';
      if (Math.abs(wk.delta) > W.delta_max.wert) return `delta ${wk.delta} übersteigt die Grenze ${W.delta_max.wert}`;
      if (typeof wk.grund !== 'string' || !has(W.quellen.wert, wk.grund)) return 'unbekannter Grund (grund)';
      const q = W.quellen.wert[wk.grund].delta;
      if (Math.sign(wk.delta) !== Math.sign(q) || Math.abs(wk.delta) > Math.abs(q)) return `delta ${wk.delta} passt nicht zum Grund ${wk.grund} (${q})`;
      return null;
    },
    anwenden() { /* Spielaufsatz: faden.js */ },
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
      if (!belagerungen(z, wk.ort, undefined, wk.an).length) return 'keine laufende Belagerung des Ortes durch ' + wk.an;   // ohne Feldzug hätte die Sim nie erobert
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

const istAufsatz = (typ) => has(KATALOG, typ) && KATALOG[typ].aufsatz === true;   // Wirkung, die der Spielaufsatz anwendet (der Kern ignoriert sie)

module.exports = { KATALOG, SCHICKSALE, pruefe, installiere, istAufsatz, belagerungen };   // belagerungen: auch server/sim/preise.js (nur lesen)
