// CHA-01 E: Startmenü (Titelbild, Hauptmenü, Crew-Lobby, Einladung) – Zustand und Regeln an EINER Stelle (Kais 3-Layer-Regel für Datentool-Teile):
//   Store    = dieses Objekt (`lies()`): Bildschirm, Auswahl, Moduswahl-Überlagerung, Eisenwald-Tutorial (Merker), zuletzt gesehener Lobby-Modus, Cursor der Einladung
//   Actions  = benannte Funktionen je Absicht (weiter, oeffneRaum, bestaetige, oeffneModusWahl, einladungAnnehmen, einladungAblehnen, zurueck, optionenFuer …); jede Regel steht hier
//   Oberfläche = public/js/menue-ui.js: zeichnet nur und bildet Tasten auf diese Actions ab; Tokens = public/js/menue-tokens.js (Globales `Menue`)
// Die Menüs sind reiner Client-Zustand. Die Verbindung steht schon beim Laden; wer im Titel oder Hauptmenü steht, ist in der Lobby „nicht bereit“.
// Die Modus-Gruppierung entsteht hier aus Shared_Protocol.LOBBY_MODI (bleibt unverändert): jeder Modus gehört genau einem Eintrag (Test: tools/test-menue.js).
// UMD: im Browser `window.MenueFluss` (eine Instanz, Abhängigkeiten werden beim Aufruf aufgelöst), in Node `require('…/menue.js').erzeuge({ protokoll, senden, debug, szenenIds, charaktere, weltstandMax, verlasseRaum })`.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.MenueFluss = api.erzeuge({
      protokoll: () => root.Shared_Protocol,
      senden: (m) => (root.Net ? root.Net.send(m) : false),
      debug: () => { try { return new URLSearchParams(root.location.search).get('debug') === '1'; } catch (e) { return false; } },
      szenenIds: () => { const c = root.Shared_Config; return ((c && c.arena && c.arena.szenen) || []).map((z) => z.id); },
      charaktere: () => root.Charaktere,
      weltstandMax: () => { const c = root.Shared_Config; return (c && c.weltstand && c.weltstand.max) || 5; },
      oeffneKammer: () => { const c = root.Client; if (!(c && c.actions && c.actions.openKammer)) return false; c.actions.openKammer(); return true; },
      verlasseRaum: () => { const c = root.Client; return !!(c && c.actions && c.actions.verlasseRaum && c.actions.verlasseRaum()); },
    });
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Feste Texte der Menü-Oberfläche, die die Tokens nicht kennen (Test: jede Glyphe existiert in art.js)
  const TEXT = {
    titel: { knopf: 'Spielen' },
    detail: { spieler: '1–4 Spieler', neuerWeltstand: 'neuer Weltstand {n}/{max}', weltstandVoll: 'Alle {max} Plätze belegt · F löscht', weltstandVollKurz: 'Alle {max} Plätze belegt', weltstandVollLang: 'Alle {max} Plätze belegt – erst einen löschen (F)', keinWeltstand: 'kein Weltstand', raumOeffnen: 'Raum öffnen', fortsetzen: 'Fortsetzen', tutorial: 'Tutorial', an: 'an', aus: 'aus', optionen: 'OPTIONEN', inLobby: 'In der Lobby', crew: 'Crew' },
    fortsetzen: { keiner: 'Noch kein Weltstand gespeichert', weitere: '+ {n} weitere · F öffnet die Liste', liste: 'F öffnet die Liste', unlesbar: 'nicht ladbar' },
    hinweise: { waehlen: 'wählen', charakter: 'Charakter', optionen: 'Optionen', zurueck: 'Titel', bereit: 'bereit', farbe: 'Farbe', modus: 'Modus', link: 'Link', menue: 'Hauptmenü', hilfe: 'Hilfe' },
    lobby: { gruppeModus: 'MODUS', modusAendern: 'Modus ändern (alle)', fortsetzenVon: 'FORTSETZEN', bereit: 'BEREIT', bereitZurueck: 'Enter: zurück', bereitMelden: 'Enter: bereit', alleBereit: 'alle bereit', wartetAuf: 'wartet auf', verbindet: 'verbinde …', warteServer: 'warte auf Server …', verlassen: 'Esc: Hauptmenü', ohneCode: 'ohne Raumcode', getrennt: 'getrennt', gewaehlt: 'gewählt' },
    modus: { titel: 'MODUS WÄHLEN', enter: 'setzen', knopf: 'Modus setzen', esc: 'schließen', weltstaende: 'Weltstände' },
    einladung: { gruppe: 'EINLADUNG', holtDich: 'holt dich an Bord.', modus: 'Modus', raum: 'Raum', anBord: 'An Bord', von: 'von', wem: 'MIT WEM GEHST DU AN BORD?', deinPlatz: 'DEIN PLATZ', farbe: 'Farbe', nameCharakter: 'Name = Charaktername', crewWaehlt: 'Modus und Weltstand wählt die Crew in der Lobby.', anBordMit: 'Mit {name} an Bord', nichtBeitreten: 'Esc: nicht beitreten', frei: 'FREI', neuHinweis: 'N legt an', niemand: 'noch niemand an Bord', karteVoll: 'Alle Plätze sind belegt.' },
    hinweisEinladung: { charakter: 'Charakter', neu: 'neu', liste: 'Liste', anBord: 'an Bord', abbrechen: 'ablehnen' },
    status: { crewEinheit: '/4' },
    tasten: { auswahl: '↑↓', ziffern: '1–4', enter: 'Enter', esc: 'Esc', stellen: '←→' },
    opt: { seedFest: 'Seed {n} fest', seedNeu: 'neuer Seed je Start', zuletzt: 'zuletzt W{n}', waffeStandard: 'Standard', karte: 'Karte', waffe: 'Waffe', szene: 'Szene', umsetzung: 'Umsetzung', staerke: 'Stärke', seed: 'Seed', god: 'god', hafenUebung: 'Hafen-Übung', abschnitt: 'Abschnitt', standard: 'Standard', zufaellig: 'zufällig', altweg: 'Altweg', keschKlassisch: 'Kesh (klassisch)', rekord: 'Rekord W{n}', an: 'AN', aus: 'aus', leer: '–', laborBoden: 'Boden', laborRaum: 'Raum', laborStart: 'Start: {z}' },
    ton: { hinweis: 'Klick oder Taste aktiviert den Ton' },
    karte: { du: 'DU', escZeile: ['Esc geht zum', 'Hauptmenü'], linkKopiert: 'Link kopiert!', vonVier: '{n} von 4' },
    gruppen: { spielen: 'SPIELEN', fortsetzen: 'FORTSETZEN', uebung: 'ÜBUNGSPLATZ', debug: 'STERNENSCHICHT (DEBUG)' },
  };

  // Alle Einträge des Hauptmenüs. `modi` = die Lobby-Modi (LOBBY_MODI), die der Eintrag abdeckt – zusammen genau LOBBY_MODI, jeder genau einmal.
  // Eisenwald deckt zwei Modi ab: das Tutorial ist ein Schalter im Eintrag (U), kein zweiter Eintrag. Debug-Einträge erscheinen nur mit ?debug=1.
  const GRUPPEN = [
    { id: 'spielen', eintraege: [
      { id: 'schuld_der_lerche', taste: '1', modi: ['schuld_der_lerche'], art: 'KAMPAGNE', weltstand: true },
      { id: 'freie_fahrt', taste: '2', modi: ['freie_fahrt'], art: 'OFFENE WELT', weltstand: true },
      { id: 'eisenwald', taste: '3', modi: ['eisenwald', 'eisenwald_ohne'], art: 'KAMPAGNE', weltstand: true, tutorial: true },
    ] },
    { id: 'fortsetzen', eintraege: [
      { id: 'fortsetzen', taste: 'F', modi: [], art: 'WELTSTAND', fortsetzen: true },
    ] },
    { id: 'uebung', eintraege: [
      { id: 'arena_graben', taste: '4', modi: ['arena_graben'], art: 'ÜBUNGSPLATZ' },
      { id: 'arena_away', taste: '5', modi: ['arena_away'], art: 'ÜBUNGSPLATZ' },
      { id: 'arena_space', taste: '6', modi: ['arena_space'], art: 'ÜBUNGSPLATZ' },
      { id: 'labor', taste: '7', modi: ['labor'], art: 'ÜBUNGSPLATZ', nurMit: 'laborAn' },
    ] },
    { id: 'debug', debug: true, eintraege: [
      { id: 'm1', taste: '8', modi: ['m1'], art: 'STERNENSCHICHT', weltstand: true },
      { id: 'free', taste: '9', modi: ['free'], art: 'STERNENSCHICHT', weltstand: true },
      { id: 'm3', taste: '0', modi: ['m3'], art: 'STERNENSCHICHT' },
    ] },
  ];
  const ALLE = GRUPPEN.flatMap((g) => g.eintraege.map((e) => Object.assign({ gruppe: g.id }, e)));
  const eintragMitId = (id) => ALLE.find((e) => e.id === id) || null;
  const eintragZuModus = (modus) => ALLE.find((e) => e.modi.includes(modus)) || null;
  const zugeordneteModi = () => ALLE.flatMap((e) => e.modi);

  // Womit das Startmenü beginnt (rein): ?menue=1 erzwingt den Ablauf Titel → Hauptmenü → Lobby (bzw. Einladung bei ?code=), ?menue=0 die Lobby.
  // Ohne Angabe beginnen Direktstarts (?arena=) und ferngesteuerte Browser (navigator.webdriver) in der Lobby, ein Einladungslink (?code=) mit der Einladung, sonst der Titel.
  // p = { menue: Wert von ?menue, arena: Wert von ?arena (null = fehlt), link: es gibt einen gültigen ?code=, webdriver }
  function startOptionen(p) {
    p = p || {};
    if (p.menue === '1') return { link: !!p.link };
    if (p.menue === '0' || p.arena != null || p.webdriver) return { direkt: true };
    return { link: !!p.link };
  }

  function erzeuge(opt) {
    const proto = () => (typeof opt.protokoll === 'function' ? opt.protokoll() : opt.protokoll) || {};
    const senden = (m) => opt.senden(m);
    const debugAn = () => !!(typeof opt.debug === 'function' ? opt.debug() : opt.debug);
    const szenenIds = () => (opt.szenenIds ? opt.szenenIds() : []) || [];
    const charaktere = () => (typeof opt.charaktere === 'function' ? opt.charaktere() : opt.charaktere) || null;
    const LOBBY_OPT = () => (proto().C && proto().C.LOBBY_OPT) || 'lobbyOpt';
    const maxWelten = () => +(typeof opt.weltstandMax === 'function' ? opt.weltstandMax() : opt.weltstandMax) || 5;
    const READY = () => (proto().C && proto().C.READY) || 'ready';

    // ------------------------------------------------------------------ Store
    // schirm: 'titel' | 'menue' | 'lobby' | 'einladung'; auswahl = id des gewählten Eintrags (Hauptmenü und Moduswahl-Überlagerung teilen sie);
    // modusOffen = Moduswahl-Überlagerung in der Lobby; tutorial = Eisenwald mit Tutorial (Merker für den nächsten Start); lobbyModus = zuletzt gesehener Modus der Lobby (nur dessen Wechsel setzt den Merker); einladungCursor = Platz in der Charakterliste der Einladung
    const store = { schirm: 'titel', auswahl: null, modusOffen: false, tutorial: true, lobbyModus: null, modusPruefen: false, einladungCursor: 0, rev: 0 };
    const aenderung = () => { store.rev++; };
    const lies = () => store;

    // ------------------------------------------------------------------ Gruppierung (rein, aus Protokoll und Lobby-Snapshot)
    const welten = (lob) => (lob && Array.isArray(lob.worlds) ? lob.worlds.filter((w) => w && w.id != null) : []);
    // Belegung der Weltstand-Plätze: EINE Ableitung für Hauptmenü, Detailkachel und Lobby (Zähler n/max, voll, Nummer des nächsten neuen Weltstands)
    function weltstaende(lob) {
      const n = welten(lob).length, max = maxWelten();
      return { anzahl: n, max, zaehler: n + '/' + max, voll: !!(lob && lob.worldsFull) || n >= max, naechste: Math.min(max, n + 1) };
    }
    const neuesteWelt = (lob) => welten(lob).find((w) => !w.state || w.state === 'ok') || null;
    // Modus-ID eines Eintrags (Eisenwald je nach Tutorial-Schalter)
    function modusVon(e) {
      if (!e || !e.modi.length) return null;
      if (e.tutorial) return store.tutorial ? 'eisenwald' : 'eisenwald_ohne';
      return e.modi[0];
    }
    // sichtbare Einträge in Menüreihenfolge: Debug nur mit ?debug=1, Labor nur wenn der Server es anbietet (lobby.laborAn), Fortsetzen nur mit Weltstand
    function sichtbar(lob) {
      const dbg = debugAn();
      return ALLE.filter((e) => {
        if (e.gruppe === 'debug' && !dbg) return false;
        if (e.nurMit && !(lob && lob[e.nurMit])) return false;
        if (e.fortsetzen && !neuesteWelt(lob)) return false;
        return true;
      });
    }
    // Gruppen für die Anzeige (auch „Fortsetzen“ ohne Weltstand: die Oberfläche zeigt dann die Zeile „Noch kein Weltstand“)
    function gruppen(lob) {
      const sicht = new Set(sichtbar(lob).map((e) => e.id)), dbg = debugAn();
      return GRUPPEN.filter((g) => !g.debug || dbg).map((g) => ({ id: g.id, eintraege: g.eintraege.filter((e) => sicht.has(e.id)).map((e) => Object.assign({ gruppe: g.id }, e)) }));
    }
    // Eintrag zum aktuellen Lobby-Zustand: gewählter Weltstand → Fortsetzen, sonst der Eintrag des Modus
    function aktuellerEintrag(lob) {
      if (lob && lob.world != null && welten(lob).some((w) => w.id === lob.world)) return eintragMitId('fortsetzen');
      return eintragZuModus((lob && lob.startMission) || 'm1');
    }
    function auswahlEintrag(lob) {
      const s = sichtbar(lob), e = s.find((x) => x.id === store.auswahl);
      return e || s[0] || null;
    }
    function synchronisiere(lob) {   // Auswahl auf einen sichtbaren Eintrag; der Tutorial-Merker folgt dem Lobby-Modus nur, wenn dieser sich ändert (U im Hauptmenü darf nicht überschrieben werden)
      const mode = lob && lob.startMission;
      if (mode !== store.lobbyModus) { store.lobbyModus = mode; if (mode === 'eisenwald') store.tutorial = true; else if (mode === 'eisenwald_ohne') store.tutorial = false; }
      const s = sichtbar(lob);
      if (!s.some((e) => e.id === store.auswahl)) { const a = aktuellerEintrag(lob); store.auswahl = (a && s.some((e) => e.id === a.id) ? a : s[0] || {}).id || null; }
      aenderung();
    }

    // CHA-01 Nacharbeit K2: Snapshot eingegangen – Auswahl und Tutorial-Merker nachführen, nur solange Hauptmenü oder Lobby gezeigt werden (das Zeichnen ändert nichts mehr)
    function snapshotEingang(lob) {
      if (store.schirm !== 'menue' && store.schirm !== 'lobby') return { ok: false };
      // CHA-01 Nacharbeit Gesamt (Prüfer-Befund 10): Direkteintritt (ferngesteuerter Browser, ?arena=) zeigt sonst den unsichtbaren Server-Standard m1 als „Kampagne“; einmal beim ersten Lobby-Snapshot sichern
      if (store.modusPruefen && store.schirm === 'lobby' && lob) { store.modusPruefen = false; sichtbarenModusSichern(lob); }
      synchronisiere(lob || {}); return { ok: true };
    }

    // ------------------------------------------------------------------ Navigation im Menü
    function bewege(d, lob) {
      const s = sichtbar(lob); if (!s.length) return { ok: false };
      const i = Math.max(0, s.findIndex((e) => e.id === store.auswahl));
      store.auswahl = s[(i + (d < 0 ? -1 : 1) + s.length) % s.length].id; aenderung();
      return { ok: true, auswahl: store.auswahl };
    }
    function waehleTaste(taste, lob) {
      const t = String(taste).toUpperCase(), e = sichtbar(lob).find((x) => x.taste === t);
      if (!e) return { ok: false, grund: 'unbekannt' };
      store.auswahl = e.id; aenderung();
      return { ok: true, auswahl: e.id };
    }
    function waehleEintragId(id, lob) {
      const e = sichtbar(lob).find((x) => x.id === id); if (!e) return { ok: false, grund: 'unbekannt' };
      store.auswahl = id; aenderung();
      return { ok: true, auswahl: id };
    }
    // Eisenwald: Tutorial an/aus (U). Zwei Absichten, zwei Actions: im Hauptmenü und in der Moduswahl nur der Merker für den nächsten Start (sendet nichts),
    // in der Lobby der Modus der Runde (jeder darf umschalten).
    function schalteTutorialMerker() { store.tutorial = !store.tutorial; aenderung(); return { ok: true, tutorial: store.tutorial }; }
    function schalteTutorialDerRunde(lob) {
      const mode = lob && lob.startMission;
      if (mode !== 'eisenwald' && mode !== 'eisenwald_ohne') return { ok: false, grund: 'kein-eisenwald' };
      const neu = mode === 'eisenwald' ? 'eisenwald_ohne' : 'eisenwald';
      store.tutorial = neu === 'eisenwald'; aenderung();
      senden({ t: LOBBY_OPT(), startMission: neu });
      return { ok: true, tutorial: store.tutorial, gesendet: neu };
    }

    // ------------------------------------------------------------------ Modus festlegen (lobbyOpt)
    // Nachricht für einen Eintrag: Modus, neuer Weltstand (world: null), bei Wellen Boden/All die Kartenwahl (ohne sie startet der Server den Altweg)
    function nachrichtFuer(e, lob) {
      if (e.fortsetzen) { const w = neuesteWelt(lob); return w ? { t: LOBBY_OPT(), world: w.id } : null; }
      const modus = modusVon(e), msg = { t: LOBBY_OPT(), startMission: modus, world: null };
      if (modus === 'arena_away') msg.wellen = (lob && lob.wellen) || (proto().WELLEN_KARTEN || ['aussenposten'])[0];
      if (modus === 'arena_space') msg.szene = (lob && lob.szene) || szenenIds()[0] || null;
      return msg;
    }
    // Den gewählten Eintrag als Modus der Runde setzen und in die Lobby wechseln (Enter im Hauptmenü und in der Moduswahl-Überlagerung)
    function bestaetige(lob) {
      const e = auswahlEintrag(lob); if (!e) return { ok: false, grund: 'leer' };
      const msg = nachrichtFuer(e, lob); if (!msg) return { ok: false, grund: 'kein-weltstand' };
      senden(msg);
      store.schirm = 'lobby'; store.modusOffen = false; store.auswahl = e.id; aenderung();
      return { ok: true, eintrag: e.id, modus: msg.startMission || null, welt: msg.world || null };
    }
    // Moduswahl-Überlagerung der Lobby (M)
    function oeffneModusWahl(lob) {
      if (store.schirm !== 'lobby') return { ok: false };
      const a = aktuellerEintrag(lob), s = sichtbar(lob);
      store.auswahl = (a && s.some((e) => e.id === a.id) ? a : s[0] || {}).id || null;
      store.modusOffen = true; aenderung();
      return { ok: true };
    }
    function schliesseModusWahl() { if (store.modusOffen) { store.modusOffen = false; aenderung(); } return { ok: true }; }
    // Ein Weltstand wurde gewählt (Liste mit F): aus dem Hauptmenü in die Lobby, aus der Moduswahl-Überlagerung zurück in die Lobby
    function weltstandGewaehlt() { return store.schirm === 'menue' ? imRaum() : schliesseModusWahl(); }
    // „Neue Kampagne“ aus der Weltstandliste: wie weltstandGewaehlt, und der Modus der Lobby wird ein im Menü sichtbarer (der Server-Standard m1 ist ohne Debug unsichtbar)
    function neuerWeltstandGewaehlt(lob) { const r = weltstandGewaehlt(), m = sichtbarenModusSichern(lob); return Object.assign({}, r, { modus: m.gesendet }); }
    // Steht die Lobby auf einem Modus, den das Menü nicht anbietet (m1 ohne ?debug=1), den ersten sichtbaren Eintrag als Modus setzen
    function sichtbarenModusSichern(lob) {
      const s = sichtbar(lob).filter((e) => e.modi.length), e = eintragZuModus((lob && lob.startMission) || 'm1');
      if (!s.length || (e && s.some((x) => x.id === e.id))) return { ok: true, gesendet: null };
      const msg = nachrichtFuer(s[0], lob); senden(msg); store.auswahl = s[0].id; aenderung();
      return { ok: true, gesendet: msg.startMission };
    }
    // Das Labor: Liste, gewählte Umsetzung (Position i von n) und deren Eintrag
    function laborAuswahl(lob) {
      const liste = lob && Array.isArray(lob.laborListe) ? lob.laborListe : [], l = (lob && lob.labor) || {}, i = Math.max(0, liste.findIndex((e) => e.id === l.id));
      return { liste, n: liste.length, position: liste.length ? i + 1 : 0, eintrag: liste[i] || null, labor: l };
    }

    // ------------------------------------------------------------------ Bildschirmfluss
    // Start: per Einladungslink → Einladung; Direktstart (?arena=, Automation) → Lobby; sonst Titel
    function starte(o) {
      o = o || {};
      store.schirm = o.link ? 'einladung' : o.direkt ? 'lobby' : 'titel';
      store.modusOffen = false; store.modusPruefen = !!o.direkt; aenderung();   // Direkteintritt in die Lobby: der erste Snapshot prüft, ob der Modus der Lobby sichtbar ist (snapshotEingang)
      return { ok: true, schirm: store.schirm };
    }
    function weiter() { if (store.schirm === 'titel') { store.schirm = 'menue'; aenderung(); return { ok: true }; } return { ok: false }; }
    // Esc: Moduswahl zu → Lobby → Hauptmenü (bereit zurücknehmen) → Titel (die Einladung hat ihr eigenes Esc: einladungAblehnen)
    function zurueck(ich) {
      if (store.modusOffen) { store.modusOffen = false; aenderung(); return { ok: true, schirm: store.schirm }; }
      if (store.schirm === 'lobby') {
        if (ich && ich.ready) senden({ t: READY(), ready: false });   // im Hauptmenü zählt man als „nicht bereit“
        store.schirm = 'menue'; aenderung(); return { ok: true, schirm: 'menue' };
      }
      if (store.schirm === 'menue') { store.schirm = 'titel'; aenderung(); return { ok: true, schirm: 'titel' }; }
      return { ok: false };
    }
    // Einladung ablehnen (Esc): den fremden Raum wirklich verlassen (Verbindung trennen, Raumcode vergessen – sonst käme man sofort wieder hinein) und ins Hauptmenü
    function einladungAblehnen() {
      if (store.schirm !== 'einladung') return { ok: false, grund: 'keine-einladung' };
      const verlassen = !!(opt.verlasseRaum && opt.verlasseRaum());
      store.schirm = 'menue'; store.modusOffen = false; aenderung();
      return { ok: true, schirm: 'menue', verlassen };
    }
    // Einladung: N legt einen neuen Charakter an – Kleiderkammer öffnen (Charakterliste), dann die Erstellung; ohne Kammer/Charaktere nichts
    function einladungNeuerCharakter() {
      if (store.schirm !== 'einladung') return { ok: false, grund: 'keine-einladung' };
      const C = charaktere(); if (!C) return { ok: false, grund: 'charaktere' };
      if (!(opt.oeffneKammer && opt.oeffneKammer())) return { ok: false, grund: 'kammer' };
      return C.neuAnlegen();
    }
    // Die Runde endet und der Server holt alle zurück in die Lobby
    function imRaum() { store.schirm = 'lobby'; store.modusOffen = false; aenderung(); return { ok: true }; }
    function bewegeEinladung(d) { const n = (charaktere() && charaktere().MAX) || 4; store.einladungCursor = (store.einladungCursor + (d < 0 ? -1 : 1) + n) % n; aenderung(); return { ok: true, cursor: store.einladungCursor }; }
    function setzeEinladungCursor(i) { const n = (charaktere() && charaktere().MAX) || 4; if (!(i >= 0 && i < n)) return { ok: false }; store.einladungCursor = i; aenderung(); return { ok: true, cursor: i }; }
    // Einladung annehmen: den Charakter am Cursor wählen (Charaktere.waehle sendet das hello neu), dann in die Lobby; freier Platz → nichts
    function einladungAnnehmen() {
      const C = charaktere(); if (!C) return { ok: false, grund: 'charaktere' };
      const c = C.lies().liste[store.einladungCursor];
      if (!c) return { ok: false, grund: 'frei' };
      if (C.lies().gewaehlt !== c.id) { const r = C.waehle(c.id); if (!r.ok) return r; }
      store.schirm = 'lobby'; aenderung();
      return { ok: true, id: c.id };
    }
    // Cursor der Einladung folgt dem gewählten Charakter (beim Öffnen und nach Neuanlage)
    function einladungAufGewaehlten() {
      const C = charaktere(); if (!C) return;
      const s = C.lies(), i = s.liste.findIndex((c) => c.id === s.gewaehlt);
      store.einladungCursor = i >= 0 ? i : 0; aenderung();
    }

    // ------------------------------------------------------------------ Crew (rein, aus dem Snapshot)
    // Gastgeber = wer zuerst im Raum ist: der Server führt kein Feld dafür, die Spielerliste hält die Beitrittsreihenfolge → der erste verbundene Spieler
    const verbunden = (spieler) => (spieler || []).filter((p) => p && p.connected !== false);
    const gastgeber = (spieler) => verbunden(spieler)[0] || null;
    function zaehlung(spieler) {
      const v = verbunden(spieler), bereit = v.filter((p) => p.ready);
      return { an: v.length, bereit: bereit.length, alleBereit: v.length > 0 && bereit.length === v.length, wartend: v.filter((p) => !p.ready) };
    }

    // ------------------------------------------------------------------ Zusatzoptionen je Modus (Tasten der Lobby)
    // Liefert die Optionen des Modus, der in der Lobby (oder im Detail des gewählten Eintrags) gilt. Jede Option: { taste, code, aktion, arg?, label }.
    // Die Oberfläche bildet Tasten darauf ab (optionFuerTaste) und ruft view.actions[aktion](arg); die Werte stehen im Lobby-Snapshot.
    function optionenFuer(modus, lob, welt) {
      const o = [];
      if (welt) return o;   // Weltstand fortsetzen: keine Startauswahl
      const waffe = { taste: 'W', code: 'KeyW', aktion: 'lobbyWaffe', label: TEXT.opt.waffe };
      if (modus === 'arena_away') o.push({ taste: 'K', code: 'KeyK', aktion: 'toggleWellenKarte', label: TEXT.opt.karte }, waffe);
      if (modus === 'arena_space') o.push({ taste: 'K', code: 'KeyK', aktion: 'toggleWellenKarte', label: TEXT.opt.szene });
      if (modus === 'arena_graben') {
        const liste = lob && Array.isArray(lob.grabenListe) ? lob.grabenListe : [], tasten = [['K', 'KeyK'], ['N', 'KeyN'], ['B', 'KeyB']];
        liste.slice(0, tasten.length).forEach((a, i) => { if ((a.varianten || []).length >= 2) o.push({ taste: tasten[i][0], code: tasten[i][1], aktion: 'toggleGraben', arg: i, label: a.name || TEXT.opt.abschnitt }); });
        o.push(waffe);
      }
      if (modus === 'labor') o.push(
        { taste: TEXT.tasten.auswahl, code: 'ArrowUp', aktion: 'laborWahl', arg: -1, label: TEXT.opt.umsetzung }, { code: 'ArrowDown', aktion: 'laborWahl', arg: 1, versteckt: true },
        { taste: TEXT.tasten.stellen, code: 'ArrowLeft', aktion: 'laborStaerke', arg: -1, label: TEXT.opt.staerke }, { code: 'ArrowRight', aktion: 'laborStaerke', arg: 1, versteckt: true },
        { taste: 'R', code: 'KeyR', aktion: 'laborSeed', label: TEXT.opt.seed }, { taste: 'G', code: 'KeyG', aktion: 'laborGod', label: TEXT.opt.god }, waffe);
      if (modus === 'eisenwald' || modus === 'eisenwald_ohne') o.push({ taste: 'U', code: 'KeyU', aktion: 'menue.tutorialRunde', label: TEXT.detail.tutorial });
      if (modus === 'm1') o.push({ taste: 'U', code: 'KeyU', aktion: 'toggleSkipDrill', label: TEXT.opt.hafenUebung });
      return o;
    }
    function optionFuerTaste(code, modus, lob, welt) { return optionenFuer(modus, lob, welt).find((x) => x.code === code) || null; }

    return {
      TEXT, GRUPPEN, ALLE, lies, eintragMitId, eintragZuModus, zugeordneteModi,
      sichtbar, gruppen, modusVon, aktuellerEintrag, auswahlEintrag, synchronisiere, snapshotEingang, welten, neuesteWelt,
      bewege, waehleTaste, waehleEintragId, schalteTutorialMerker, schalteTutorialDerRunde, nachrichtFuer, bestaetige, oeffneModusWahl, schliesseModusWahl,
      starte, weiter, zurueck, imRaum, weltstaende, weltstandGewaehlt, neuerWeltstandGewaehlt, sichtbarenModusSichern, einladungAblehnen, einladungNeuerCharakter, laborAuswahl, startOptionen, bewegeEinladung, setzeEinladungCursor, einladungAnnehmen, einladungAufGewaehlten,
      gastgeber, zaehlung, verbunden, optionenFuer, optionFuerTaste,
    };
  }

  return { TEXT, GRUPPEN, erzeuge, eintragZuModus, zugeordneteModi, startOptionen };
});
