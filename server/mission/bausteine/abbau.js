'use strict';
// GEL-03 D: Regiebuch-Bausteine für den Abbau von Erzadern (Registry-Plugin, Zustandslogik in server/sim/anker.js, Rolle abbau).
//   abbau_neu { map* }              Aktion: frische Erzadern auf einer gebauten Karte (Anker.abbauNeu): Runde + 1, die Auswahl der Vorkommen (da/leer) neu aus Karte-Seed und Runde, laufende Halter abgebrochen,
//                                   Karte (JSON) unverändert. Ereignis abbauNeu { map, runde, adern } (Spiel und Mission). Fehlertext von Anker.abbauNeu (keine gebaute Karte, keine Adern): game.countError('mission-abbau'), kein Wurf.
//     Bewusst ohne Parameter Anzahl und Art (Auftrag nannte „Ort, Anzahl, Art"): Die Anzahl der Vorkommen je Runde steuert allein der Generator (GenHoehle.adernWahl: 2 bis 3 von 4 bis 6 Kandidaten), eine
//     zweite Stellschraube im Regiebuch würde an der Auswahlregel vorbeigehen; die Art ist heute nur erz (Attribut art der Ader, ABBAU_ARTEN in anker.js), ein Parameter hätte nur einen Wert.
//   abbau_fertig { min*, map? }     Prüfung: erfüllt, wenn mindestens min Adern der Karte (alle Anker der Rolle abbau) im Zustand abgebaut sind. Nach abbau_neu hat jede Kandidaten-Ader einen neuen Zustand
//                                   (da oder leer): die Zählung beginnt je Runde neu. leer zählt nie. Ohne map gilt die aktuelle Außenkarte. Nicht geladene/unbekannte Karte oder ohne jede Ader: falsch (Karte ohne Adern
//                                   meldet einmal 'mission-abbau', weil das ein Fehler im Buch ist). min größer als die Adern mit Vorkommen (da, laeuft, abgebaut) der Runde ist unerfüllbar: falsch und einmal gemeldet.
//                                   Handgesetzte abbau-Anker (keine Kandidaten) setzt abbau_neu nicht zurück; sie zählen weiter, solange sie abgebaut sind.
//   Weltstand-Fakt: kein automatischer Fakt (kein neues Fakten-System). Ein Regiebuch setzt ihn über den vorhandenen Weg aus dem Ereignis: "on": { "abbauFertig": [ { "do": "welt_fakt", "key": "…", "value": true } ] }
//   (oder ein welt_fakt in den Folgen eines Ausgangs, wenn abbau_fertig die Mission schließt). Ereignisnamen in "on" sind frei (checker.js prüft sie nicht gegen eine Liste): abbauStart, abbauFertig { map, anker, pid,
//   menge, art }, abbauLaerm { map, anker, pid, x, y } und abbauNeu { map, runde, adern } sind ohne Eintrag verwendbar.
const Anker = () => require('../../sim/anker.js');
const World = () => require('../../world.js');
const Landepunkte = () => require('../../sim/landepunkte.js');
const GenHoehle = () => require('../../../shared/gen-hoehle.js');

const ZAEHLT_ALS_VORKOMMEN = new Set(['da', 'laeuft', 'abgebaut']);
const gemeldet = new WeakMap();   // game -> Set(Schlüssel): jede Meldung einmal je Spiel, Karte und Fall (nicht je Tick)
function einmal(g, schluessel, text) {
  let s = gemeldet.get(g); if (!s) { s = new Set(); gemeldet.set(g, s); }
  if (s.has(schluessel)) return;
  s.add(schluessel);
  g.countError('mission-abbau', new Error(text));
}
// Größte Zahl an Kandidaten einer Höhle (ADERN_ZIEL der größten Fläche): mehr Adern kann kein Buch verlangen. Aus dem Generator abgeleitet, nicht doppelt festgeschrieben.
const adernMax = () => GenHoehle().ADERN_ZIEL(Number.MAX_SAFE_INTEGER);

// -> { abgebaut, vorkommen, adern } | null (Karte unbekannt/nicht geladen). Geladene Karte: Zustände der Sitzung; sonst der Weltstand-Eintrag des Landepunkts.
function adernStand(g, map) {
  const e = typeof map === 'string' && map ? World().AWAY_MAPS[map] : null;
  const k = e && e.karte;
  if (!k || !Array.isArray(k.anker)) return null;
  const adern = k.anker.filter((a) => a.rolle === 'abbau');
  const aw = g.aways && g.aways[map];
  let eintrag = null;
  if (!aw) { try { eintrag = Landepunkte().eintrag(g, map); } catch (x) { eintrag = null; } }
  // Nicht geladen: gespeicherter Zustand, sonst die Auswahl der Runde (dieselbe Regel, die beim Laden der Karte wirkt, landepunkte.makeAway)
  const wahl = !aw && eintrag ? Anker().abbauWahlZustaende(k, eintrag.abbau_runde | 0) : {};
  const zustand = (id) => (aw ? Anker().zustand(g, map, id) : (eintrag && eintrag.zustaende && eintrag.zustaende[id]) || wahl[id] || null);
  let abgebaut = 0, vorkommen = 0;
  for (const a of adern) { const z = zustand(a.id); if (z === 'abgebaut') abgebaut++; if (ZAEHLT_ALS_VORKOMMEN.has(z)) vorkommen++; }
  return { abgebaut, vorkommen, adern: adern.length };
}

module.exports = (Registry) => {
  Registry.define({ id: 'abbau_neu', art: 'aktion', ereignisse: ['abbauNeu'],
    beschreibung: 'Erzadern einer gebauten Karte (Höhle) neu setzen: nächste Runde, andere Adern tragen ein frisches Vorkommen, die übrigen sind leer; laufender Abbau wird abgebrochen. Die Karte selbst bleibt unverändert. '
      + 'Anzahl und Art gibt es nicht als Parameter: wie viele Adern je Runde Erz tragen, steuert der Generator (2 bis 3), die Art ist heute nur Erz. Fehler (keine gebaute Karte, keine Adern) werden gemeldet, nichts wird geändert',
    params: { map: { typ: 'map', pflicht: true } },
    run(m, a) {
      const g = m.game;
      let fehler;
      try { fehler = Anker().abbauNeu(g, a.map); }
      catch (e) { g.countError('mission-abbau', e); return; }
      if (fehler) g.countError('mission-abbau', new Error('abbau_neu: ' + fehler));
    } });
  Registry.define({ id: 'abbau_fertig', art: 'pruefung',
    beschreibung: 'Mindestens min Erzadern der Karte (Standard: aktuelle Außenkarte) sind in dieser Runde abgebaut. Leere Adern zählen nicht; nach abbau_neu beginnt die Zählung neu. '
      + 'Karte nicht geladen: nicht erfüllt. Ein min über der Zahl der Adern mit Vorkommen ist unerfüllbar und wird einmal gemeldet',
    params: { min: { typ: 'number', pflicht: true, min: 1 }, map: { typ: 'map' } },
    // Prüfer: min ganzzahlig und nicht größer als die größte Zahl an Ader-Kandidaten einer Höhle (die Adern je Karte stehen erst zur Laufzeit fest)
    argsPruefen: (args) => {
      const out = []; const v = args && args.min;
      if (typeof v !== 'number') return out;   // fehlend/Typ meldet der Prüfer selbst, Konfigurationsverweis bleibt Laufzeit
      if (!Number.isInteger(v)) out.push({ code: 'PARAM-WERT', text: `'min' = ${v} muss eine ganze Zahl sein` });
      else if (v > adernMax()) out.push({ code: 'PARAM-WERT', text: `'min' = ${v} ist größer als die größte Zahl an Erzadern einer Höhle (${adernMax()})` });
      return out;
    },
    test: (m, a) => {
      const g = m.game;
      const map = a.map != null ? a.map : (g.away && g.away.map) || null;
      const s = adernStand(g, map);
      if (!s) return false;
      if (!s.adern) { einmal(g, 'keine:' + map, `abbau_fertig: Karte ${map} hat keine Erzadern`); return false; }
      if (a.min > s.vorkommen) einmal(g, `min:${map}:${a.min}:${s.vorkommen}`, `abbau_fertig: min ${a.min} ist größer als die Adern mit Vorkommen (${s.vorkommen}) auf ${map}`);
      return s.abgebaut >= a.min;
    } });
};
