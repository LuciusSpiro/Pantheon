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
      ladeVersion: () => root.fetch('/version.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
    });
    root.MenueFluss.ladeVersion();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Feste Texte der Menü-Oberfläche, die die Tokens nicht kennen (Test: jede Glyphe existiert in art.js)
  const TEXT = {
    titel: { knopf: 'Spielen' },
    version: { praefix: 'v' },   // HYG-02 A: „v0.1.0“ unten rechts
    detail: { spieler: '1–4 Spieler', neuerWeltstand: 'neuer Weltstand {n}/{max}', weltstandVoll: 'Alle {max} Plätze belegt · F löscht', weltstandVollKurz: 'Alle {max} Plätze belegt', weltstandVollLang: 'Alle {max} Plätze belegt – erst einen löschen (F)', keinWeltstand: 'kein Weltstand', raumOeffnen: 'Raum öffnen', fortsetzen: 'Fortsetzen', tutorial: 'Tutorial', an: 'an', aus: 'aus', optionen: 'OPTIONEN', inLobby: 'In der Lobby', crew: 'Crew' },
    fortsetzen: { keiner: 'Noch kein Weltstand gespeichert', weitere: '+ {n} weitere · F öffnet die Liste', liste: 'F öffnet die Liste', unlesbar: 'nicht ladbar' },
    hinweise: { waehlen: 'wählen', charakter: 'Charakter', optionen: 'Optionen', zurueck: 'Titel', bereit: 'bereit', farbe: 'Farbe', modus: 'Modus', link: 'Link', menue: 'Hauptmenü', hilfe: 'Hilfe' },
    lobby: { gruppeModus: 'MODUS', modusAendern: 'Modus ändern (alle)', fortsetzenVon: 'FORTSETZEN', bereit: 'BEREIT', bereitZurueck: 'Enter: zurück', bereitMelden: 'Bereit melden', alleBereit: 'alle bereit', wartetAuf: 'wartet auf', verbindet: 'verbinde …', warteServer: 'warte auf Server …', verlassen: 'Esc: Hauptmenü', ohneCode: 'ohne Raumcode', getrennt: 'getrennt' },
    modus: { titel: 'MODUS WÄHLEN', enter: 'setzen', knopf: 'Modus setzen', esc: 'schließen', weltstaende: 'Weltstände', aktiv: 'aktiv' },
    einladung: { gruppe: 'EINLADUNG', holtDich: 'holt dich an Bord.', modus: 'Modus', raum: 'Raum', anBord: 'An Bord', anBordMitDir: '{n} an Bord + du', nurDu: 'nur du', wem: 'MIT WEM GEHST DU AN BORD?', deinPlatz: 'DEIN PLATZ', farbe: 'Farbe', nameCharakter: 'Name = Charaktername', crewWaehlt: 'Modus und Weltstand wählt die Crew in der Lobby.', anBordMit: 'Mit {name} an Bord', nichtBeitreten: 'Esc: nicht beitreten', frei: 'FREI', neuHinweis: 'N legt an', niemand: 'noch niemand an Bord', karteVoll: 'Alle Plätze sind belegt.' },
    hinweisEinladung: { charakter: 'Charakter', neu: 'neu', liste: 'Liste', anBord: 'an Bord', abbrechen: 'ablehnen' },
    status: { crewEinheit: '/4' },
    tasten: { auswahl: '↑↓', ziffern: '1–4', enter: 'Enter', esc: 'Esc', stellen: '←→' },
    opt: { seedFest: 'Seed {n} fest', seedNeu: 'neuer Seed je Start', zuletzt: 'zuletzt W{n}', waffeStandard: 'Standard', karte: 'Karte', waffe: 'Waffe', szene: 'Szene', umsetzung: 'Umsetzung', staerke: 'Stärke', seed: 'Seed', god: 'Unverwundbar', hafenUebung: 'Hafen-Übung', liveSpielleiter: 'Live-Spielleiter', liveAn: 'an (Claude, Abo)', liveHinweis: 'Echter Claude, läuft auf dem Abo. Deckel: Zähler CLAUDE_TOKEN_BUDGET.', abschnitt: 'Abschnitt', standard: 'Standard', zufaellig: 'zufällig', altweg: 'Altweg', keschKlassisch: 'Kesh (klassisch)', rekord: 'Rekord W{n}', an: 'an', aus: 'aus', leer: '–', laborBoden: 'Boden', laborRaum: 'Raum', laborStart: 'Start: {z}', karteNamen: { wreck: 'Wrack', platform: 'Plattform' } },
    ton: { kappe: 'Taste', hinweis: 'oder Klick schaltet den Ton ein' },
    eingang: { abgelehnt: 'EINLADUNG ABGELEHNT', raumcode: 'RAUMCODE', satz: 'Code eingeben, den du vom Gastgeber bekommst.', knopf: 'An Bord gehen', falsch: 'Falscher Raumcode – bitte nachfragen.' },
    kammer: { lobby: 'In die Lobby', einladung: 'Zur Einladung', menue: 'Zum Hauptmenü', titel: 'Zum Titel' },
    karte: { du: 'DU', escZeile: ['Esc geht zum', 'Hauptmenü'], linkKopiert: 'Link kopiert!' },
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
      { id: 'arena_forschung', taste: 'S', modi: ['arena_forschung'], art: 'ÜBUNGSPLATZ' },   // UEB-01: Forschungsstation direkt; Buchstabe statt Ziffer (alle Ziffern belegt), kein Optionsfeld (Name/Hinweis aus START_LABELS/START_HINTS)
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
    // abgelehnt = die Einladung wurde bewusst abgelehnt (der Raumcode-Eingang zeigt dann keinen Fehlerton); modusOffen = Moduswahl-Überlagerung in der Lobby; tutorial = Eisenwald mit Tutorial (Merker für den nächsten Start); lobbyModus = zuletzt gesehener Modus der Lobby (nur dessen Wechsel setzt den Merker); einladungCursor = Platz in der Charakterliste der Einladung
    const store = { schirm: 'titel', auswahl: null, modusOffen: false, tutorial: true, lobbyModus: null, modusPruefen: false, einladungCursor: 0, abgelehnt: false, version: null, rev: 0 };
    const aenderung = () => { store.rev++; };
    // HYG-02 A: Versionsnummer (Server: GET /version.json = package.json); null = unbekannt, die Zeile bleibt dann leer. Ein Fehler beim Holen ändert nichts am Menü.
    function setzeVersion(v) { store.version = typeof v === 'string' && /^\d+\.\d+\.\d+[\w.+-]*$/.test(v) ? v : null; aenderung(); return store.version; }
    function ladeVersion() {
      if (typeof opt.ladeVersion !== 'function') return Promise.resolve(null);
      try { return Promise.resolve(opt.ladeVersion()).then((d) => setzeVersion(d && d.version), () => null); } catch (e) { return Promise.resolve(null); }
    }
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
    // Titel eines Menüeintrags: immer der Name des Eintrags (Eisenwald heißt „Kampagne Eisenwald“, mit oder ohne Tutorial; der Tutorial-Zustand steht nur im Chip)
    const START_LABEL = (modus) => (proto().START_LABELS && proto().START_LABELS[modus]) || String(modus || '');
    const eintragTitel = (e) => (e && e.modi.length ? START_LABEL(e.modi[0]) : '');
    const modusTitel = (modus) => { const e = eintragZuModus(modus); return e && e.modi.length ? eintragTitel(e) : START_LABEL(modus); };
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
      store.abgelehnt = false;   // wieder im Raum: die Ablehnung ist erledigt
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
      store.modusOffen = false; store.abgelehnt = false; store.modusPruefen = !!o.direkt; aenderung();   // Direkteintritt in die Lobby: der erste Snapshot prüft, ob der Modus der Lobby sichtbar ist (snapshotEingang)
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
      store.schirm = 'menue'; store.modusOffen = false; store.abgelehnt = true; aenderung();
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

    // ------------------------------------------------------------------ Bereit-Knopf der START-Kachel (abgeleitet aus dem Spieler)
    // Nicht bereit: goldener Hauptknopf (Kappe Enter, „Bereit melden“); bereit: mintfarbene Fläche „BEREIT“ mit „Enter: zurück“
    function bereitAnzeige(ich) {
      if (ich && ich.ready) return { bereit: true, art: 'mint', titel: TEXT.lobby.bereit, zeile: TEXT.lobby.bereitZurueck };
      return { bereit: false, art: 'gold', kappe: TEXT.tasten.enter, text: TEXT.lobby.bereitMelden };
    }
    // Moduswahl-Überlagerung: ist der Eintrag der Modus, der in der Lobby gerade gilt? (die Überlagerung kennzeichnet ihn mit „aktiv“)
    function eintragAktiv(e, lob) { const a = aktuellerEintrag(lob); return !!(store.modusOffen && e && a && a.id === e.id); }
    // Wohin der Hauptknopf der Charakterliste (Enter) führt: die Kleiderkammer liegt über dem Bildschirm, aus dem sie geöffnet wurde; Enter übernimmt den Charakter und kehrt dorthin zurück
    function kammerKnopfText() { return TEXT.kammer[store.schirm] || TEXT.kammer.lobby; }

    // ------------------------------------------------------------------ Titel und Zeilen der Lobby (rein)
    const text = (vorlage, werte) => String(vorlage).replace(/\{(\w+)\}/g, (_, k) => (werte && werte[k] != null ? werte[k] : ''));
    // Titel in Zeilen setzen: die größte Skala aus `skalen`, bei der er auf eine Zeile passt; passt er auch bei der kleinsten nicht, bricht er dort an Wortgrenzen auf zwei Zeilen um
    // (nie auf eine kleinere Skala). mass(text, skala) -> Breite in px. Mehr als zwei Zeilen: der Rest hängt an der zweiten (die Oberfläche kürzt sie).
    function titelUmbruch(titel, mass, maxB, skalen) {
      titel = String(titel); skalen = skalen && skalen.length ? skalen : [1];
      for (const sk of skalen) if (mass(titel, sk) <= maxB) return { skala: sk, zeilen: [titel] };
      const sk = skalen[skalen.length - 1], zeilen = [''];
      for (const w of titel.split(' ').filter(Boolean)) {
        const z = zeilen[zeilen.length - 1], k = z ? z + ' ' + w : w;
        if (!z || mass(k, sk) <= maxB) zeilen[zeilen.length - 1] = k; else zeilen.push(w);
      }
      return { skala: sk, zeilen: zeilen.length > 2 ? [zeilen[0], zeilen.slice(1).join(' ')] : zeilen };
    }
    // Senkrechte Verteilung des Lobby-Kopfes (relativ zu Modus-y): Titel in einer Zeile → Satzzeile und Chips darunter; zwei Titelzeilen → keine Satzzeile, die Chips rücken auf
    function lobbyKopf(titelZeilen) {
      return titelZeilen > 1 ? { titelY: [13, 29], satzY: null, chipY: 46 } : { titelY: [13], satzY: 38, chipY: 51 };
    }
    // Satzzeile aus Teilen in Reihenfolge der Wichtigkeit: passt sie nicht in maxB, entfallen ganze Teile von hinten (nie mitten im Wort abgeschnitten); der erste Teil bleibt immer
    function satzZeile(teile, mass, maxB) {
      const t = (teile || []).filter(Boolean);
      while (t.length > 1 && mass(t.join(' · ')) > maxB) t.pop();
      return t.join(' · ');
    }
    // Chips der Lobby: „M Modus ändern“ + jede sichtbare Zusatzoption des Modus als { taste, name, wert, aktion, arg }; wertVon(option) liefert den Wert aus dem Lobby-Snapshot (Oberfläche)
    function lobbyChips(modus, lob, welt, wertVon) {
      const chips = [{ taste: 'M', name: TEXT.lobby.modusAendern, wert: null, aktion: 'menue.modusWahl' }];
      for (const o of optionenFuer(modus, lob, welt)) if (!o.versteckt) chips.push({ taste: o.taste, name: o.label, wert: wertVon ? wertVon(o) : '', aktion: o.aktion, arg: o.arg });
      return chips;
    }
    // Chips in Reihen setzen: nichts wird verworfen. Passt alles nicht in maxReihen Reihen, werden die Werte gekürzt (160 → 110 → 80 → 56 px), erst dann bleibt ein Überlauf (ueberlauf > 0).
    // mass = { kappe(taste) -> px inkl. Abstand, text(s) -> px, kuerze(s, px) -> s }, o = { maxB, abstand, maxReihen }
    function chipReihen(chips, mass, o) {
      const maxB = o.maxB, ab = o.abstand != null ? o.abstand : 12, maxR = o.maxReihen || 2;
      let reihen = [];
      for (const wm of [160, 110, 80, 56]) {
        reihen = []; let x = 0, r = [];
        for (const c of chips) {
          const wert = c.wert == null ? null : mass.kuerze(String(c.wert), wm), w = (c.taste ? mass.kappe(c.taste) : 0) + mass.text(wert == null ? c.name : c.name + ': ' + wert);
          if (r.length && x + w > maxB) { reihen.push(r); r = []; x = 0; }
          r.push(Object.assign({}, c, { wert, x, w })); x += w + ab;
        }
        if (r.length) reihen.push(r);
        if (reihen.length <= maxR) break;
      }
      return { reihen, ueberlauf: Math.max(0, reihen.length - maxR), anzahl: reihen.reduce((a, r) => a + r.length, 0) };
    }
    // Grabenangriff: wählbare Abschnitte (mindestens zwei Varianten, höchstens so viele wie Tasten) bekommen K/N/B; alle übrigen stehen als Textteile „Abschnitt: Variante“ in der Satzzeile
    const GRABEN_TASTEN = [['K', 'KeyK'], ['N', 'KeyN'], ['B', 'KeyB']];
    function grabenAbschnitte(lob) {
      const liste = lob && Array.isArray(lob.grabenListe) ? lob.grabenListe : [], gewaehlt = (lob && lob.graben) || {};
      const wahl = [], texte = [];
      liste.forEach((a, i) => {
        const varianten = a.varianten || [], v = varianten.find((x) => x.id === gewaehlt[a.abschnitt]) || varianten[0];
        if (varianten.length >= 2 && wahl.length < GRABEN_TASTEN.length) wahl.push({ index: i, name: a.name || TEXT.opt.abschnitt, taste: GRABEN_TASTEN[wahl.length] });
        else texte.push((a.name || TEXT.opt.abschnitt) + ': ' + (v ? v.name : TEXT.opt.leer));
      });
      return { wahl, texte };
    }
    // Labor: Satzzeile der Lobby = Name der Umsetzung · Ort · Karten (lesbar, ohne interne Bezeichner); „Start: …“ nur, wenn der Name es nicht schon sagt.
    // lesbar = { ort(id) -> Name, karte(id) -> Name }
    function laborSatz(le, lesbar) {
      if (!le) return '';
      const karten = (le.kartenarten || []).map((k) => lesbar.karte(k)), kurz = karten.length > 2 ? karten.slice(0, 2).join('/') + ' u. a.' : karten.join('/');
      const start = le.startzustand && !String(le.name || '').toLowerCase().includes(String(le.startzustand).toLowerCase()) ? text(TEXT.opt.laborStart, { z: le.startzustand }) : '';
      return [le.name || le.id, le.ort ? lesbar.ort(le.ort) : '', kurz, start].filter(Boolean).join(' · ');
    }

    // ------------------------------------------------------------------ Einladung: Besatzung und Raumcode-Eingang (rein)
    // Wer schon an Bord ist, ohne den Eingeladenen selbst: Liste, Zahl und Text („2 an Bord + du“)
    function einladungBesatzung(spieler, pid) {
      const andere = verbunden(spieler).filter((p) => p.id !== pid);
      return { andere, n: andere.length, text: andere.length ? text(TEXT.einladung.anBordMitDir, { n: andere.length }) : TEXT.einladung.nurDu };
    }
    // Raumcode-Eingang (der Server hat den Beitritt mit badcode abgelehnt, es gibt noch keinen Spieler): null, wenn er nicht gezeigt wird;
    // sonst Überschrift (bewusst abgelehnte Einladung: „EINLADUNG ABGELEHNT“), Satz und – nur nach einem eingegebenen, falschen Code – eine Fehlerzeile.
    // p = { badCode, verbunden, hatSpieler, roomCode }
    function raumcodeEingang(p) {
      if (!(p && p.badCode && p.verbunden && !p.hatSpieler)) return null;
      const abgelehnt = store.abgelehnt && !p.roomCode;
      return { abgelehnt, ueberschrift: abgelehnt ? TEXT.eingang.abgelehnt : TEXT.eingang.raumcode, satz: TEXT.eingang.satz, fehler: p.roomCode ? TEXT.eingang.falsch : null };
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
        for (const a of grabenAbschnitte(lob).wahl) o.push({ taste: a.taste[0], code: a.taste[1], aktion: 'toggleGraben', arg: a.index, label: a.name });
        o.push(waffe);
      }
      if (modus === 'labor') o.push(
        { taste: TEXT.tasten.auswahl, code: 'ArrowUp', aktion: 'laborWahl', arg: -1, label: TEXT.opt.umsetzung }, { code: 'ArrowDown', aktion: 'laborWahl', arg: 1, versteckt: true },
        { taste: TEXT.tasten.stellen, code: 'ArrowLeft', aktion: 'laborStaerke', arg: -1, label: TEXT.opt.staerke }, { code: 'ArrowRight', aktion: 'laborStaerke', arg: 1, versteckt: true },
        { taste: 'R', code: 'KeyR', aktion: 'laborSeed', label: TEXT.opt.seed }, { taste: 'G', code: 'KeyG', aktion: 'laborGod', label: TEXT.opt.god }, waffe);
      if (modus === 'eisenwald' || modus === 'eisenwald_ohne') o.push({ taste: 'U', code: 'KeyU', aktion: 'menue.tutorialRunde', label: TEXT.detail.tutorial });
      if (modus === 'freie_fahrt') o.push({ taste: 'V', code: 'KeyV', aktion: 'toggleLiveSpielleiter', label: TEXT.opt.liveSpielleiter });   // FRE-01 B: Kostenentscheidung, Standard aus; V ist in Lobby und Menü frei (M, F, L, O, H, C, U, 1–4 belegt)
      if (modus === 'm1') o.push({ taste: 'U', code: 'KeyU', aktion: 'toggleSkipDrill', label: TEXT.opt.hafenUebung });
      return o;
    }
    function optionFuerTaste(code, modus, lob, welt) { return optionenFuer(modus, lob, welt).find((x) => x.code === code) || null; }

    return {
      TEXT, GRUPPEN, ALLE, lies, setzeVersion, ladeVersion, eintragMitId, eintragZuModus, zugeordneteModi,
      sichtbar, gruppen, modusVon, aktuellerEintrag, auswahlEintrag, synchronisiere, snapshotEingang, welten, neuesteWelt,
      bewege, waehleTaste, waehleEintragId, schalteTutorialMerker, schalteTutorialDerRunde, nachrichtFuer, bestaetige, oeffneModusWahl, schliesseModusWahl,
      starte, weiter, zurueck, imRaum, weltstaende, weltstandGewaehlt, neuerWeltstandGewaehlt, sichtbarenModusSichern, einladungAblehnen, einladungNeuerCharakter, laborAuswahl, startOptionen, bewegeEinladung, setzeEinladungCursor, einladungAnnehmen, einladungAufGewaehlten,
      gastgeber, zaehlung, verbunden, optionenFuer, optionFuerTaste,
      eintragTitel, modusTitel, bereitAnzeige, eintragAktiv, kammerKnopfText, titelUmbruch, lobbyKopf, satzZeile, lobbyChips, chipReihen, grabenAbschnitte, laborSatz, einladungBesatzung, raumcodeEingang,
    };
  }

  return { TEXT, GRUPPEN, erzeuge, eintragZuModus, zugeordneteModi, startOptionen };
});
