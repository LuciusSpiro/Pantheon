// Frachtraum-Liste (Action-Layer der Anzeige): macht aus dem Snapshot-Feld `fracht` (lager = Waren-Arten, pers = Personen an Bord) die eine, überall
// gleiche Aufstellung "FRACHTRAUM 2/2: Deuterium, Evert Kroeger". Ops, Captain und Transfer-Terminal lesen dieselbe Funktion (kein eigenes Formatieren).
// UMD: window.Shared_Frachtliste / require. Reine Darstellung, keine Spielregel (Kapazität: Maps.cargoCapacity, 4 Plätze je Modul Frachtraum).
// LAD-01 E: Kennzeichen je Eintrag (le: 1 illegal, 2 war getarnt, 4 Auftrag), Füllstand je Modul (Maps.frachtBelegung) und die Verkaufsgründe (fracht.vg) als kleine, testbare Funktionen.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./waren.js'), require('./maps.js'));
  else root.Shared_Frachtliste = factory(root.Shared_Waren, root.Shared_Maps);
})(typeof self !== 'undefined' ? self : this, function (Waren, Maps) {
  'use strict';
  const artName = (a) => (Waren ? Waren.name(a) : String(a));   // LAD-01 A1: Anzeigename aus content/waren.json; unbekannte Ware: die Kennung

  const LE = { ILLEGAL: 1, ENTTARNT: 2, AUFTRAG: 4 };   // Bitmaske fracht.le (Server: fracht.snapshot, nur aufgedeckte Flags)
  // Kennzeichen-Text hinter dem Namen: "Waffen (ILLEGAL, enttarnt, Auftrag)"; ohne Kennzeichen nur der Name
  function kennzeichen(le) {
    const k = [];
    if (le & LE.ILLEGAL) k.push('ILLEGAL');
    if (le & LE.ENTTARNT) k.push('enttarnt');
    if (le & LE.AUFTRAG) k.push('Auftrag');
    return k;
  }

  // Verkaufsgrund-Code (fracht.vg, ladung.verkaufOrt) -> Text. Fehlt der Code (alter Server), bleibt der allgemeine Satz.
  const VERKAUFSGRUND = {
    2: 'Auftragsware lässt sich nicht verkaufen – sie gehört dem Auftraggeber',
    3: 'Hier kauft niemand Ware (kein Hafen, kein Markt)',
    4: 'Andocken nicht erlaubt – kein Handel',
    5: 'Zu weit vom Händler – näher heran oder andocken',
    6: 'Der Händler kauft diese Ware nicht',
    7: 'Personen lassen sich nicht verkaufen',
    8: 'Handel hier gesperrt',
  };
  // -> null (verkaufbar: vk) | Text, warum nicht
  function verkaufGrund(fracht) {
    const fr = fracht || {};
    if (fr.vk) return null;
    if (!(fr.lager || []).length) return 'Keine Ware an Bord';
    return VERKAUFSGRUND[fr.vg] || 'Kein Händler in Reichweite';
  }

  // Füllstand je Frachtraum-Modul aus dem Snapshot-Feld ship.mod und fracht (gemeinsame Belegungsfunktion Maps.frachtBelegung).
  // -> [{ raum, art | null, name, anzahl, kap, text: "Erz 2/4" | "leer 0/4" }]; ohne Maps oder ohne Module: []
  // raeume = Nummern der Räume mit Frachtraum (Maps.frachtRaeumeAusMod(ship.mod)).
  function modulFuellung(fracht, raeume) {
    if (!Maps || !Maps.frachtBelegung || !(raeume || []).length) return [];
    const fr = fracht || {};
    const b = Maps.frachtBelegung(raeume, fr.lager || [], (fr.pers || []).length);
    return b.module.map((m) => {
      const kap = m.plaetze.length;
      const name = m.art === 'person' ? 'Personen' : m.art ? artName(m.art) : 'leer';
      return { raum: m.raum, art: m.art, name, anzahl: m.anzahl, kap, text: name + ' ' + m.anzahl + '/' + kap };
    });
  }

  // Typ-Regel im Client (Knopf-Hinweis vor dem Beamen): passt eine Ladung dieser Art (art = 'person' für eine Person) noch in ein Modul? -> null (passt / keine Aussage) | Text
  // Gleiche Rechnung wie der Server (Maps.frachtBelegung); die Tarnung kennt der Client nicht (er rechnet mit der angezeigten Art), der Server entscheidet endgültig.
  function platzGrund(fracht, raeume, art) {
    if (!Maps || !Maps.frachtBelegung || !(raeume || []).length || !art) return null;
    const fr = fracht || {};
    const lager = fr.lager || [], pers = (fr.pers || []).length;
    const b = art === 'person' ? Maps.frachtBelegung(raeume, lager, pers + 1) : Maps.frachtBelegung(raeume, lager.concat([art]), pers);
    if (b.ueber <= 0) return null;
    if (lager.length + pers >= raeume.length * 4) return null;   // voll: eigener Hinweis „Frachtraum voll“
    return 'Kein Frachtraum frei für ' + (art === 'person' ? 'Personen' : artName(art)) + ': jedes Modul fasst nur eine Art Ladung';
  }

  // fracht = snapshot.fracht (kann fehlen), cap = Anzahl Frachtplätze, raeume (optional) = Räume mit Frachtraum für den Füllstand je Modul.
  // -> { belegt, cap, frei, gesichert, eintraege: [{ art, name, text, illegal, enttarnt, auftrag }], module, modulText, warnung, titel, text }
  // gesichert = false (Snapshot fracht.g, PAN-01 A: Modul Frachtraum aus) hängt „UNGESICHERT“ an den Text.
  // Aufgedeckte Tarnung: der Snapshot nennt dann die echte Art (Flag enttarnt); die Tarnbezeichnung kennt nur der Server.
  function frachtListe(fracht, cap, raeume) {
    const fr = fracht || {};
    const eintraege = [];
    (fr.lager || []).forEach((a, i) => {
      const le = (fr.le || [])[i] | 0;
      const k = kennzeichen(le);
      const name = artName(a);
      eintraege.push({ art: a, name, text: name + (k.length ? ' (' + k.join(', ') + ')' : ''), illegal: !!(le & LE.ILLEGAL), enttarnt: !!(le & LE.ENTTARNT), auftrag: !!(le & LE.AUFTRAG) });
    });
    for (const p of (fr.pers || [])) eintraege.push({ art: 'person', name: String(p.n || p.id || 'Person'), text: String(p.n || p.id || 'Person'), illegal: false, enttarnt: false, auftrag: false });
    const c = Math.max(0, cap | 0);
    const belegt = eintraege.length;
    const frei = Math.max(0, c - belegt);
    const titel = 'FRACHTRAUM ' + belegt + '/' + c;
    const gesichert = fr.g !== false;
    const module = modulFuellung(fr, raeume);
    const modulText = module.map((m) => m.text).join(' · ');
    const illegal = eintraege.filter((e) => e.illegal).length;
    const warnung = illegal ? illegal + ' × ILLEGAL' : '';
    const text = titel + ': ' + (belegt ? eintraege.map((e) => e.text).join(', ') : 'leer') + (belegt && frei ? ' · ' + frei + ' frei' : '') + (gesichert ? '' : ' · UNGESICHERT');
    return { belegt, cap: c, frei, gesichert, eintraege, module, modulText, warnung, titel, text };
  }

  return { frachtListe, artName, kennzeichen, modulFuellung, platzGrund, verkaufGrund, VERKAUFSGRUND, LE };
});
