// TEC-01 B2: Lesepunkt für das Komponentenformat der Schildkette (UMD: window.Shared_KomponentenFormat / require). Rein, ohne Abhängigkeiten.
// Leser: Client (Bedienung der Komponentenwahl, später Übersicht TEC-01 D) und Tests. Der Server schreibt das Format in server/sim/komponenten.js (kodiere/dekodiere);
// tools/test-komp-bedienung.js hält beide Seiten gleich (Gegenprobe), solange der Server nicht auf dieses Modul umgestellt ist.
//
// Format (Snapshot ship.komp[sys], Weltstand schiff.komp[sys]): ein Zustandscode je Komponente in Rezeptreihenfolge (o ok, d defekt, g geflickt, - unbekannt),
// bei gesetzten Zählern folgt ';Ausfall1,Ausfall2..;Sprung1,Sprung2..'. Fehlt das System im Snapshot, weicht keine Komponente ab (alles ok).
// Rezepte: config.systemModell.komponenten { rezepte: { name: [Art..] }, systeme: { sys: name }, ausfallSperre }.
//
// Aktionen der Zielwahl: 'flick' (nur defekte), 'swap' (defekte, dann geflickte), 'minigame' (nur das Relais R, nicht verschlissen). Dieselben Regeln wie komponenten.reparaturZiel.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared_KomponentenFormat = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const OK = 'ok', DEFEKT = 'defekt', GEFLICKT = 'geflickt';
  const VON_CODE = { o: OK, d: DEFEKT, g: GEFLICKT };
  const NAMEN = { K: 'Steuerkern', S: 'Spannungsregler', R: 'Relais', L: 'Leitung' };
  const MINISPIEL_ART = 'R';
  const AUSFALL_SPERRE = 3;
  const MAX_DEFEKT_BROKEN = 2;

  function name(t) { return NAMEN[t] || String(t); }

  // Rezept (Liste der Arten) eines Systems aus config.systemModell.komponenten; null ohne Rezept
  function rezeptVon(daten, sys) {
    const n = daten && daten.systeme && daten.systeme[sys];
    const r = n && daten.rezepte && daten.rezepte[n];
    return Array.isArray(r) ? r : null;
  }
  function sperreVon(daten) { const v = Number(daten && daten.ausfallSperre); return v >= 1 ? v : AUSFALL_SPERRE; }

  // Text -> [{ t, z, n, sp }] in Rezeptreihenfolge (z null bei '-'); null, wenn der Text nicht zum Rezept passt
  function dekodiere(text, rezept) {
    if (!Array.isArray(rezept) || typeof text !== 'string') return null;
    const teile = text.split(';');
    const codes = teile[0];
    if (codes.length !== rezept.length || ![...codes].every((c) => c in VON_CODE || c === '-')) return null;
    const zahlen = (t) => { const a = String(t || '').split(',').map((x) => Math.max(0, Math.min(9999, parseInt(x, 10) || 0))); return a.length === rezept.length ? a : rezept.map(() => 0); };
    const n = zahlen(teile[1]), sp = zahlen(teile[2]);
    return rezept.map((t, i) => ({ t, z: VON_CODE[codes[i]] || null, n: n[i], sp: sp[i] }));
  }
  // Wie der Server ohne Komponentenliste: damaged = letzte Komponente defekt, broken = die letzten zwei (die Rezeptenden fallen zuerst aus)
  function ausZustand(rezept, zustand) {
    const zahl = Math.min(zustand === 'broken' ? MAX_DEFEKT_BROKEN : zustand === 'damaged' ? 1 : 0, rezept.length);
    return rezept.map((t, i) => ({ t, z: i >= rezept.length - zahl ? DEFEKT : OK, n: 0, sp: 0 }));
  }
  // Komponenten eines Systems aus dem Snapshot: st = Snapshot (st.ship.komp, st.ship.systems), daten = config.systemModell.komponenten.
  // null: das System hat kein Rezept. Fehlt der Text (oder passt nicht), gilt der Systemzustand.
  function liste(st, daten, sys) {
    const rezept = rezeptVon(daten, sys);
    if (!rezept) return null;
    const ship = (st && st.ship) || {};
    const text = ship.komp && ship.komp[sys];
    const l = text == null ? null : dekodiere(text, rezept);
    if (l && l.every((k) => k.z)) return l;
    const zust = ship.systems && ship.systems[sys];
    const basis = ausZustand(rezept, zust === 'damaged' || zust === 'broken' ? zust : 'ok');
    if (l) l.forEach((k, i) => { basis[i].n = k.n; basis[i].sp = k.sp; });   // '-' im Text: nur die Zähler gelten
    return basis;
  }

  // Zulässige Ziele (Arten) einer Aktion in Wechselreihenfolge; der erste Eintrag ist der Standard des Servers
  function zulaessigeZiele(l, aktion, sperre) {
    if (!Array.isArray(l)) return [];
    const art = (z) => l.filter((k) => k.z === z).map((k) => k.t);
    if (aktion === 'flick') return art(DEFEKT);
    if (aktion === 'swap') return art(DEFEKT).concat(art(GEFLICKT));
    if (aktion === 'minigame') {
      const k = l.find((q) => q.t === MINISPIEL_ART);
      return k && k.z !== OK && k.z != null && k.n < (sperre >= 1 ? sperre : AUSFALL_SPERRE) ? [MINISPIEL_ART] : [];
    }
    return [];
  }
  function standardZiel(l, aktion, sperre) { return zulaessigeZiele(l, aktion, sperre)[0] || null; }
  // Gewähltes Ziel, solange es zulässig ist; sonst Standard (Rückfall); null, wenn nichts zulässig ist
  function zielWahl(l, aktion, gewaehlt, sperre) {
    const z = zulaessigeZiele(l, aktion, sperre);
    return gewaehlt && z.includes(gewaehlt) ? gewaehlt : (z[0] || null);
  }
  // Wechsel-Taste: das nächste zulässige Ziel nach dem aktuellen (rund herum); null, wenn nichts zulässig ist
  function naechstesZiel(l, aktion, gewaehlt, sperre) {
    const z = zulaessigeZiele(l, aktion, sperre);
    if (!z.length) return null;
    const i = z.indexOf(zielWahl(l, aktion, gewaehlt, sperre));
    return z[(i + 1) % z.length];
  }
  // Aktion des E-Haltens: Ersatzteil in der Hand = Tausch, sonst Flicken
  function aktionFuerHand(traegt) { return traegt === 'ersatzteil' ? 'swap' : 'flick'; }

  // Bedienung an einer Station: was E (Flicken/Tausch) und R (Minispiel) jetzt tun und wie viele Ziele die Wechsel-Taste hat.
  // { aktion, ziel, anzahl, minispiel (R ist zulässig), geflickt: [Arten] } – ziel null: E hat nichts zu tun (nichts defekt bzw. nichts zu tauschen)
  function bedienung(l, traegt, gewaehlt, sperre) {
    const aktion = aktionFuerHand(traegt);
    const z = zulaessigeZiele(l, aktion, sperre);
    return { aktion, ziel: zielWahl(l, aktion, gewaehlt, sperre), anzahl: z.length, minispiel: zulaessigeZiele(l, 'minigame', sperre).length > 0, geflickt: (l || []).filter((k) => k.z === GEFLICKT).map((k) => k.t) };
  }

  return { NAMEN, MINISPIEL_ART, AUSFALL_SPERRE, name, rezeptVon, sperreVon, dekodiere, ausZustand, liste, zulaessigeZiele, standardZiel, zielWahl, naechstesZiel, aktionFuerHand, bedienung };
});
