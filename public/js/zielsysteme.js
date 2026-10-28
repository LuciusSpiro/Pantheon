// SYS-01 C1b-2 „Ziel-Scan“: Zielsysteme der Ops am gescannten Gegner (Systemziel, Taste 0). Globales `Zielsysteme`, in Node als Modul (Tests).
// Daten: store.daten = content/kampf/gegner-systeme.json (vom Server ausgeliefert): je Klasse die Systeme in Reihenfolge mit Zone, Name, Kurzname, Funktion.
// Zustand, Integrität, Zonen und die anwählbaren Systeme kommen aus dem Snapshot (keine Regel hier):
//   ship.zielSys   flach [Zustand 0/1/2, Integrität %] je System in der Reihenfolge der Daten, letztes Element = Countdown-Rest (Zehntelsekunden, -1 kein Countdown)
//   ship.zielZon   { z (Sektor der zugewandten Seite, -1 keiner), pct (je Seite), leer (je Seite 0/1) }
//   ship.zielWahl  Indizes der anwählbaren Systeme (Erreichbarkeit prüft der Server)
//   ship.zs        gewähltes Systemziel (System-Id)
// Action: der Knopf „Systemziel“ (Taste 0) sendet weapons.systemziel { id | null }; reihum über die anwählbaren Systeme, nach dem letzten: aus.
// Anzeige: Funktionsfarben kommen aus den Daten (`funktion`, Token FN), Texte aus PultSysteme.TOKENS.TEXT.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Zielsysteme = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const req = (p) => (typeof require === 'function' ? require(p) : null);
  const ps = () => root.PultSysteme || req('./pult-systeme-tokens.js');
  const store = { daten: null };
  const ZUST = ['ok', 'besch', 'zer'];   // Code im Snapshot: 0 heil, 1 beschädigt, 2 zerstört
  const klassen = () => (store.daten && store.daten.klassen && typeof store.daten.klassen === 'object' ? store.daten.klassen : {});
  function systeme(kind) { const k = klassen()[kind]; return k && Array.isArray(k.systeme) ? k.systeme : []; }
  // Systeme des gescannten Ziels (Reihenfolge der Daten); ungescannt, Station, verborgen oder ohne Klasse: keine
  function systemeFuer(target) {
    if (!target || !target.scanned || target.station || target.hidden || !target.kind) return [];
    return systeme(target.kind).map((d) => d.id);
  }
  // Gültiger Snapshot des Ziels (Länge 2 je System + Countdown), sonst null (müll-fest: keine Anzeige)
  function liste(state, target) {
    const ship = state && state.ship;
    const sys = target && target.scanned ? systeme(target.kind) : [];
    const zs = ship && Array.isArray(ship.zielSys) ? ship.zielSys : null;
    return sys.length && zs && zs.length === 2 * sys.length + 1 ? sys : null;
  }
  const gewaehlt = (state) => { const z = state && state.ship && state.ship.zs; return typeof z === 'string' && z ? z : null; };
  const zielZon = (state) => { const z = state && state.ship && state.ship.zielZon; return z && typeof z === 'object' ? z : null; };
  // Sektor-Namen wie der Server (0 Bug, 1 Stb, 2 Heck, 3 Bb) und Zone-Namen der Daten (bug, stb, heck, bb, mitte)
  const SEITEN = ['bug', 'stb', 'heck', 'bb'];
  // Grund, warum ein System nicht anwählbar ist (Texte aus den Tokens)
  function grund(state, zone) {
    const T = ps().TOKENS.TEXT, Z = ps().TOKENS.TEXT.zone, zz = zielZon(state), zug = zz && zz.z >= 0 ? SEITEN[zz.z] : null;
    if (zone === 'mitte') return T.nichtWaehlbar.mitte.replace('{zone}', zug ? Z[zug] : '–');
    return T.nichtWaehlbar.seite.replace('{zone}', Z[zone] || zone);
  }
  // Zeilen des Ziel-Scans: je System { id, name, kurz, zone, funktion, zust ('ok'|'besch'|'zer'), pct, wahl, gewaehlt, grund }
  function zeilen(state, target) {
    const sys = liste(state, target); if (!sys) return [];
    const zs = state.ship.zielSys, wahl = new Set(Array.isArray(state.ship.zielWahl) ? state.ship.zielWahl : []), g = gewaehlt(state);
    return sys.map((d, i) => {
      const w = wahl.has(i), zu = ZUST[zs[2 * i]] || 'ok';
      // SYS-01 C2a: ein zerstörtes System ist nicht anwählbar (der Server liefert es nicht in zielWahl)
      return { id: d.id, name: String(d.name || d.id), kurz: String(d.kurz || d.name || d.id), zone: String(d.zone), funktion: String(d.funktion || 'neutral'),
        zust: zu, pct: Number(zs[2 * i + 1]) || 0, wahl: w, gewaehlt: g === d.id, grund: w ? '' : (zu === 'zer' ? ps().TOKENS.TEXT.nichtWaehlbar.zerstoert : grund(state, d.zone)) };
    });
  }
  // Anwählbare System-Ids (Erreichbarkeit wie der Server)
  function wahlbar(state, target) { return zeilen(state, target).filter((z) => z.wahl).map((z) => z.id); }
  // Nächstes Ziel reihum: nach dem letzten anwählbaren System kommt null (aus), dann wieder das erste. Ohne anwählbares System: undefined.
  function reihum(state, target) {
    const list = wahlbar(state, target); if (!list.length) return undefined;
    const cur = gewaehlt(state), i = list.indexOf(cur);
    if (cur == null || i < 0) return list[0];
    return i + 1 < list.length ? list[i + 1] : null;
  }
  // Countdown des Reaktors am Ziel in Sekunden (null ohne Countdown)
  function reaktorRest(state, target) {
    const zs = state && state.ship && state.ship.zielSys; if (!Array.isArray(zs) || !liste(state, target)) return null;
    const r = zs[zs.length - 1]; return r >= 0 ? r / 10 : null;
  }
  // Name der Klasse zum Index aus ship.zielAufKl (Reihenfolge der Schlüssel in gegner-systeme.json), null ohne Eintrag
  function klasseName(index) {
    const keys = Object.keys(klassen()); if (!(index >= 0) || index >= keys.length) return null;
    return String(klassen()[keys[index]].name || keys[index]);
  }
  // SYS-01 C1b-2 Nacharbeit: Bresche des gescannten Ziels auf der Karte (zugewandte Seite leer): Seite und Winkel zum Gegner (Bug 0, Steuerbord +90°, Heck 180°, Backbord −90°), sonst null
  function bresche(state) {
    const z = zielZon(state); if (!z || !(z.z >= 0) || !Array.isArray(z.leer) || z.leer[z.z] !== 1) return null;
    return { seite: z.z, winkel: [0, Math.PI / 2, Math.PI, -Math.PI / 2][z.z] || 0 };
  }
  // Antrieb am Gegner (Snapshot az, nur Verfolgung): Stufe 0 voll, 1 beschädigt, 2 ausgefallen. Für die Karte, nicht für den Ziel-Scan.
  function antriebZustand(e) { const s = e && e.az > 0 ? Math.min(2, Math.floor(e.az)) : 0; return { stufe: s, schaden: s > 0 }; }
  function laden() {
    if (typeof fetch !== 'function') return;
    fetch('/content/kampf/gegner-systeme.json').then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.klassen && typeof j.klassen === 'object') store.daten = j; }).catch(() => { /* ohne Daten: keine Anzeige */ });
  }
  if (root && typeof root.document !== 'undefined') laden();
  return { store, systemeFuer, systemeVon: systeme, zeilen, wahlbar, reihum, gewaehlt, zielZon, reaktorRest, bresche, klasseName, antriebZustand, laden };
});
