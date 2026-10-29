// PAN-01 D2: Hafenterminal (Handel und Werft) als Konsole `shop`. Globales `TerminalUI`.
// SUND-02b D: dritter Bereich „Lage“ (nur Freie Fahrt Sund, world.absicht über public/js/absicht.js): Angebot von 2–3 Absichten, laufende Absicht; Befehle absicht.waehlen / absicht.ablehnen,
// jeder am Terminal darf, die erste Wahl gilt (der Server antwortet absichtAntwort). SUND-04a-3: in demselben Bereich die Karte der Entscheidungsschlacht (public/js/finale.js, finaleAntwort). Ruf ist ein Kann: Ablehnen und Liegenlassen kosten nichts.
// SUND-03b I: vierter Bereich „Information“ (nur an Konkordat-Häfen der Freien Fahrt Sund, world.info über public/js/handel-info.js): 2–3 Themen, Gerücht (billig, kann falsch sein) oder Beleg (teuer, exakt)
// kaufen; Befehl info.kaufen, der Server entscheidet und antwortet infoAntwort; die Marken sind geteilt, alle sehen das Ergebnis (Funk, Karte).
// Schichten: Storage = Snapshot (state.werft, ship.st/mounts/mod, inventory.marks, shopContext) und die Ansichtswahl dieser Datei (s);
// Action = Modell aufbauen und Befehle senden (werft.freischalten / umbau / modul / vorschau / ansicht / zusehen, shop.buy); Frontend = PultTerminal.zeichneTerminal.
// SUND-04b D: fünfter Bereich „Brett“ (Auftragsbrett, Freie Fahrt Sund mit FAEDEN=1, world.abenteuer über public/js/brett.js): Angebote annehmen oder ablehnen (abenteuer.annehmen / abenteuer.ablehnen, Antwort abenteuerAntwort);
// die Crew entscheidet, die erste Antwort gilt, alle sehen das Ergebnis aus dem Snapshot (lokal nur Auswahl und Fokus).
// Der Server entscheidet alles: nichts wird lokal vorweggenommen, Antworten kommen als Ereignisse werftAntwort / werftVorschau / werft.
// Keine Farben, keine Schrift hier (tools/check-terminal-farben.js): nur Token-Namen und PultTerminal-Bausteine.
// Mehrspieler: ein Nutzer am Gerät (Snapshot werft.nutzer), die anderen können zusehen (Taste E am besetzten Terminal): sie sehen die Ansicht des Nutzers
// (werft.ui) rein lesend; der Server nimmt von ihnen nur werft.zusehen und werft.vorschau an.
(function () {
  'use strict';
  const R = window.Render, P = window.Pult, T = window.PultTerminal;
  const KAT = window.Shared_Schiffskatalog, M = window.Shared_Maps, CFG = window.Shared_Config || {};
  if (!R || !P || !T || !KAT || !M) return;
  const PROTO = window.Shared_Protocol || {};
  const n = (v, d) => (typeof v === 'number' && isFinite(v) ? v : (d || 0));
  const now = () => performance.now();
  const STUFE_MAX = M.STUFE_MAX != null ? M.STUFE_MAX : 3;
  const SEITE = { Bb: 'BACKBORD', Stb: 'STEUERBORD', vorn: 'BUG', Heck: 'HECK' };
  const ART = { seite: 'Seitenwaffe', bug: 'Bugwaffe', heck: 'Heckwaffe' };
  const KOMMENTAR_MS = 5000;   // so lange bleibt die Rückmeldung unter dem Hauptknopf stehen
  const ENTPRELL_MS = 150;     // Vorschau erst anfordern, wenn die Auswahl so lange steht

  // ---------------------------------------------------------------- Storage: Ansicht dieses Clients
  const s = {
    bereich: 'werft', auswahl: 'platz', platz: 8, raum: 1, teil: null, handel: null,   // teil/handel = Id des gewählten Teils bzw. Artikels
    antwort: null,                                                                       // { ok, text, t } letzte Rückmeldung des Servers
    wartet: null,                                                                        // { t } Befehl unterwegs
    kauf: null,                                                                          // { item, marks, t } Handelskauf unterwegs (Antwort: Kontostand sinkt oder notice)
    vorschau: { cache: {}, sent: null, wechsel: 0, key: null },
    gesendet: null, gesendetT: 0,                                                        // zuletzt gesendete werft.ansicht
    zusehen: false, geoeffnet: false, letzterKauf: null,
    lageId: null,                                                                        // SUND-02b D: gewählte Karte im Bereich Lage (Id der Absicht)
    infoId: null,                                                                        // SUND-03b I: gewähltes Thema im Bereich Information (Id im Angebot)
    brettId: null,   // SUND-04b D: gewähltes Angebot im Bereich Brett (Id aus world.abenteuer)
    finaleT: 0,                                                                          // SUND-04a-3: Zeitpunkt der eigenen Anfrage zur Entscheidungsschlacht (Entprellen des Bestätigens)
  };
  function zuruecksetzen() {
    s.bereich = 'werft'; s.auswahl = 'platz'; s.platz = 8; s.raum = 1; s.teil = null; s.handel = null; s.antwort = null; s.wartet = null; s.kauf = null;
    s.vorschau = { cache: {}, sent: null, wechsel: 0, key: null }; s.gesendet = null; s.gesendetT = 0; s.geoeffnet = false; s.lageId = null; s.infoId = null; s.brettId = null; s.finaleT = 0;
  }

  // ---------------------------------------------------------------- Lesen aus dem Snapshot
  function lage(view) {
    const st = view.state || {}, ship = st.ship || {}, w = st.werft || null;
    const codes = (CFG.module && CFG.module.codes) || {}, id = {}; for (const k of Object.keys(codes)) id[codes[k]] = k;
    const best = {}; (ship.mounts || []).forEach((m) => { const p = KAT.platzVonMount(m.id); if (p != null) best[p] = m.typ || KAT.START_BESTUECKUNG[p] || null; });
    const mod = {}; (ship.mod || []).forEach((q) => { mod[q[1]] = id[q[0]] || q[0]; });
    const loc = window.Shared_Locations && Shared_Locations.get ? Shared_Locations.get(ship.dockedAt) : null;
    return {
      st, ship, w, marks: n((st.inventory || {}).marks), stufe: n(ship.st), best, mod,
      aktiv: !!(w && w.aktiv), geladen: !!w, test: !!(w && w.test), ruest: !!(st.wellen && st.wellen.ph === 'vorbereitung'),   // test = Testumgebung (Werft überall), ruest = Rüstphase der Wellenmodi
      ort: (loc && loc.name) || (ship.dockedAt === 'vaelen' ? 'Vaelen-Karawane' : ship.dockedAt) || 'Nicht angedockt',
      frei: (w && w.frei) || { stufe: 0, waffen: [], module: [] }, sperre: (w && w.sperre) || {}, preise: (w && w.preise) || { stufe: {}, waffe: {}, modul: {} },
    };
  }
  const istFrei = (L, art, id) => (art === 'stufe' ? id <= L.frei.stufe : (art === 'waffe' ? L.frei.waffen : L.frei.module).indexOf(id) >= 0);
  const preisVon = (L, art, id) => { const t = L.preise[art]; return t && t[id] != null ? t[id] : null; };
  // Kurzname aus dem Katalogfeld kurz (STANDARD, STREU, LANZ-BT …), gemischt geschrieben; dieselbe Quelle wie die Zellen von Ops und Terminal
  const kurzName = (id) => { const k = KAT.BY_ID[id] && KAT.BY_ID[id].kurz; return k ? k.charAt(0) + k.slice(1).toLowerCase().replace(/-bt$/, '-BT') : id; };
  const raumAn = (x, y) => (M.SHIP_ROOMS.find((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) || {}).name || '';
  const deckName = (y) => T.TOKENS.RASTER.deckName[M.deckOf(y)];

  // Ansicht, die gerade gilt: der Nutzer = lokal gewählt, Zuschauer = die Ansicht des Nutzers aus dem Snapshot
  function ansicht(L) {
    if (s.bereich === 'info' && !info()) s.bereich = 'werft';   // SUND-03b I: kein Konkordat-Hafen mehr (abgelegt) oder Modus zu Ende: den Bereich gibt es nicht mehr
    if (s.bereich === 'brett' && !brett()) s.bereich = 'werft';   // SUND-04b D: kein Angebot und kein laufendes Abenteuer mehr (oder kein FAEDEN=1): den Bereich gibt es nicht
    if (s.bereich === 'lage' && !absicht()) s.bereich = 'werft';   // der Modus ist zu Ende (Kampagne, Lobby): der Bereich Kurs gibt es nicht mehr, sonst schluckte er die Tasten
    if (!L.geladen) return { bereich: 'handel', auswahl: 'platz', platz: 8, raum: 1, teil: null, handel: s.handel };   // Block kommt erst nach dem Hinsetzen: bis dahin der Handel
    if (!s.zusehen) return { bereich: s.bereich, auswahl: s.auswahl, platz: s.platz, raum: s.raum, teil: s.teil, handel: s.handel, lage: s.lageId, info: s.infoId, brett: s.brettId };
    const u = (L.w && L.w.ui) || { b: 'w', a: 'p', n: 8, i: null };
    if (u.b === 'b') return { bereich: 'brett', auswahl: 'platz', platz: 8, raum: 1, teil: null, handel: null, brett: u.i };   // SUND-04b D: Zuschauer sehen das Brett mit dem gewählten Angebot des Nutzers
    if (u.b === 'i') return { bereich: 'info', auswahl: 'platz', platz: 8, raum: 1, teil: null, handel: null, info: u.i };   // SUND-03b I: Zuschauer sehen das gewählte Thema des Nutzers
    if (u.b === 'l') return { bereich: 'lage', auswahl: 'platz', platz: 8, raum: 1, teil: null, handel: null, lage: u.i };   // SUND-02b D: Zuschauer sehen den Bereich Lage mit der Karte des Nutzers
    return { bereich: u.b === 'h' ? 'handel' : 'werft', auswahl: u.a === 'm' ? 'modul' : u.a === 's' ? 'stufe' : 'platz', platz: u.a === 'p' ? u.n || 8 : 8, raum: u.a === 'm' ? u.n || 1 : 1, teil: u.i, handel: u.i };
  }

  // ---------------------------------------------------------------- Teile
  function waffenTeile(L, platz) {
    const art = KAT.PLATZ[platz].art, ein = L.best[platz] || null;
    const t = KAT.fuerPlatzart(art).map((w) => {
      const frei = istFrei(L, 'waffe', w.id), pr = preisVon(L, 'waffe', w.id);
      return { id: w.id, art: 'waffe', name: w.name, wirkung: w.wirkung, energie: w.energie ? 'Ladepool' : 'Munition', zustand: ein === w.id ? 'eingebaut' : frei ? 'frei' : 'kostet', preis: pr };
    });
    t.push({ id: 'leer', art: 'waffe', name: 'Leer lassen', wirkung: 'Der Platz bleibt unbestückt. Umbauen kostet nichts, die Waffe bleibt freigeschaltet.', energie: '', zustand: ein ? 'frei' : 'eingebaut' });
    return t;
  }
  function modulTeile(L, raum) {
    const ein = L.mod[raum] || null, names = KAT.MODUL_NAMEN || {}, wirk = KAT.MODUL_WIRKUNG || {};
    const t = ((CFG.module && CFG.module.ids) || Object.keys(names)).map((id) => {
      const frei = istFrei(L, 'modul', id), pr = preisVon(L, 'modul', id);
      return { id, art: 'modul', name: names[id] || id, wirkung: wirk[id] || '', energie: '1 Energie', zustand: ein === id ? 'eingebaut' : frei ? 'frei' : 'kostet', preis: pr };
    });
    t.push({ id: 'leer', art: 'modul', name: 'Leer lassen', wirkung: 'Der Raum bleibt leer und zieht keine Energie. Das Modul bleibt freigeschaltet.', energie: '', zustand: ein ? 'frei' : 'eingebaut' });
    return t;
  }
  function teileAktuell(L, a) { return a.auswahl === 'modul' ? modulTeile(L, a.raum) : a.auswahl === 'platz' ? waffenTeile(L, a.platz) : []; }
  function gewaehltesTeil(L, a) {
    const teile = teileAktuell(L, a); if (!teile.length) return null;
    return teile.find((q) => q.id === a.teil) || teile.find((q) => q.zustand === 'eingebaut') || teile[0];
  }
  function platzOffen(L, p) { const pl = M.waffenplatz(p); return !!pl && L.stufe >= pl.stufe; }
  function raumOffen(L, r) { const q = M.MODUL_RAEUME.find((x) => x.raum === r); return !!q && L.stufe >= q.stufe; }

  // ---------------------------------------------------------------- Befehle (Action)
  function cmd(view, c, extra) { view.send(Object.assign({ t: 'cmd', c }, extra || {})); }
  function warten() { s.wartet = { t: now() }; }
  function freischalten(view, L, art, id) {
    if (s.zusehen) return;
    s.letzterKauf = { art, id };
    cmd(view, 'werft.freischalten', { art, id }); warten();
  }
  function umbauen(view, L, a, teil) {
    if (s.zusehen || !teil) return;
    if (a.auswahl === 'platz') cmd(view, 'werft.umbau', { platz: a.platz, waffe: teil.id });
    else cmd(view, 'werft.modul', { raum: a.raum, id: teil.id });
    warten();
  }
  function kaufen(view, row) {
    if (s.zusehen || !row || row.reason) return;
    s.kauf = { item: row.id, name: row.name, marks: n(((view.state || {}).inventory || {}).marks), t: now() };
    cmd(view, 'shop.buy', { item: row.id });
    view.actions.sfx(((view.state || {}).shopContext === 'vaelen') ? 'trade' : 'buy');
  }
  // Kurztexte je Fehlercode (Protocol.WERFT_CODES) für die schmale Zeile unter dem Hauptknopf; der volle Serbertext bleibt in s.antwort.text und im Tooltip
  const CODE_KURZ = { nicht_angedockt: 'Nicht angedockt', keine_flottenbasis: 'Nur an Flottenbasen', unbekannt: 'Unbekanntes Teil', schon_freigeschaltet: 'Schon freigeschaltet', nicht_freigeschaltet: 'Erst freischalten',
    stufe_reihenfolge: 'Erst die Stufe davor', zu_wenig_marken: 'Nicht genug Marken', ruf: 'Rang fehlt', platz_unbekannt: 'Unbekannter Platz', platz_gesperrt: 'Platz noch gesperrt', platzart: 'Passt nicht auf den Platz',
    raum_unbekannt: 'Unbekannter Modulraum', raum_gesperrt: 'Raum noch gesperrt', fracht_belegt: 'Erst Fracht abliefern', person_im_raum: 'Person im Frachtraum', unveraendert: 'Sitzt schon dort', umbau: 'Umbau nicht möglich' };
  const meldung = (ok, text, code) => { s.antwort = { ok, text, code: code || null, kurz: (code && CODE_KURZ[code]) || null, t: now() }; };
  // Text auf die Breite kürzen (Pixelschrift über PultTerminal.tw)
  function kurz(text, w) {
    text = String(text == null ? '' : text); if (!T.tw) return text;
    while (text.length > 3 && T.tw(text) > w) text = text.slice(0, -2).replace(/\s+$/, '') + '…';
    return text;
  }
  const MODUL_KURZ = { frachtraum: 'Fracht', krankenstation: 'Kranken', werkstatt: 'Werkst.' };

  // ---------------------------------------------------------------- Auswahl (Eingabe-Layer des Nutzers)
  function waehlePlatz(view, p) {
    if (s.zusehen) return;
    s.bereich = 'werft'; s.auswahl = 'platz'; s.platz = p; s.teil = null; s.antwort = null;
  }
  function waehleRaum(view, r) { if (s.zusehen) return; s.bereich = 'werft'; s.auswahl = 'modul'; s.raum = r; s.teil = null; s.antwort = null; }
  function bereichWechseln(b) { if (s.zusehen) return; if (b === 'brett' && !brett()) return; if (b === 'lage' && !absicht()) return; if (b === 'info' && !info()) return; s.bereich = b; s.antwort = null; }
  function teilWeiter(view, d) {
    if (s.zusehen) return;
    const L = lage(view), a = ansicht(L);
    if (a.bereich === 'handel') {
      const rows = handelZeilen(view); if (!rows.length) return;
      const i = Math.max(0, rows.findIndex((r) => r.id === a.handel));
      s.handel = rows[(i + rows.length + d) % rows.length].id; return;
    }
    const teile = teileAktuell(L, a); if (!teile.length) return;
    const cur = gewaehltesTeil(L, a), i = Math.max(0, teile.findIndex((q) => cur && q.id === cur.id));
    s.teil = teile[(i + teile.length + d) % teile.length].id; s.antwort = null;
  }
  function hauptTaste(view, L, a) {
    if (s.zusehen) return;
    if (a.bereich === 'handel') { const rows = handelZeilen(view); const r = rows.find((q) => q.id === a.handel) || rows[0]; if (r && r.reason) K().denied(r.reason); else kaufen(view, r); return; }
    if (!L.aktiv) return;
    if (a.auswahl === 'stufe') { stufenKauf(view, L); return; }
    const t = gewaehltesTeil(L, a);
    if (!t) return;
    if (t.zustand === 'eingebaut') { meldung(false, 'Das sitzt schon dort.'); return; }
    if (t.zustand === 'kostet') { meldung(false, 'Erst freischalten (' + T.kappe('terminal.freischalten', 'F') + ').'); return; }
    umbauen(view, L, a, t);
  }
  function freischaltenTaste(view, L, a) {
    if (s.zusehen || a.bereich !== 'werft' || !L.aktiv) return;
    if (a.auswahl === 'stufe') { stufenKauf(view, L); return; }
    const t = gewaehltesTeil(L, a);
    if (!t) return;
    if (t.zustand !== 'kostet') { meldung(false, t.zustand === 'eingebaut' ? 'Das sitzt schon dort.' : 'Schon freigeschaltet: Enter baut um.'); return; }
    freischalten(view, L, t.art, t.id);
  }
  function stufenZiel(L) { return Math.min(STUFE_MAX, L.frei.stufe + 1); }
  function stufenKauf(view, L) { if (L.frei.stufe >= STUFE_MAX) { meldung(false, 'Das Schiff ist voll ausgebaut.'); return; } freischalten(view, L, 'stufe', stufenZiel(L)); }
  // Rüstphase der Testumgebung beenden (Wellen All: Countdown beginnt; Wellen Boden: die Crew beamt hinunter)
  function szeneStart(view) { if (s.zusehen) return; cmd(view, 'werft.start', {}); }
  function ausbauTaste(view) { if (s.zusehen) return; s.bereich = 'werft'; if (s.auswahl === 'stufe') s.auswahl = s.platzVorher || 'platz'; else { s.platzVorher = s.auswahl; s.auswahl = 'stufe'; } s.antwort = null; }

  // ---------------------------------------------------------------- Vorschau (angefordert, entprellt, vom Server berechnet)
  function vorschauAnfrage(a, L, teil) {
    if (!L.aktiv || a.bereich !== 'werft' || !teil) return null;
    if (a.auswahl === 'platz' && platzOffen(L, a.platz)) return { art: 'waffe', platz: a.platz, id: teil.id };
    if (a.auswahl === 'modul' && raumOffen(L, a.raum)) return { art: 'modul', raum: a.raum, id: teil.id };
    return null;
  }
  const schluessel = (q) => (q ? q.art + '|' + (q.platz != null ? q.platz : q.raum) + '|' + q.id : null);
  function vorschauPflegen(view, L, a, teil) {
    const v = s.vorschau, q = vorschauAnfrage(a, L, teil), key = schluessel(q);
    if (key !== v.key) { v.key = key; v.wechsel = now(); }
    if (!q || v.sent === key || now() - v.wechsel < ENTPRELL_MS) return;
    v.sent = key;
    view.send({ t: 'cmd', c: 'werft.vorschau', art: q.art, platz: q.platz, raum: q.raum, id: q.id, rid: key });   // der Server gibt rid in werftVorschau zurück: Antworten kommen nie dem falschen Schlüssel zu
  }
  function vorschauNeu() { s.vorschau.cache = {}; s.vorschau.sent = null; }

  // ---------------------------------------------------------------- Ansicht an den Server (damit Zuschauer dasselbe sehen)
  function ansichtSenden(view, L) {
    if (s.zusehen || !L.geladen) return;
    const a = ansicht(L), teil = a.bereich === 'handel' ? a.handel : a.bereich === 'info' ? ((infoThema(info(), a.info) || {}).id || null) : a.bereich === 'brett' ? ((brettKarte(brett(), a.brett) || {}).id || null) : a.bereich === 'lage' ? ((lageKarte(absicht(), a.lage) || {}).id || null) : (gewaehltesTeil(L, a) || {}).id;
    const m = { b: a.bereich === 'handel' ? 'h' : a.bereich === 'brett' ? 'b' : a.bereich === 'lage' ? 'l' : a.bereich === 'info' ? 'i' : 'w', a: a.auswahl === 'modul' ? 'm' : a.auswahl === 'stufe' ? 's' : 'p', n: a.auswahl === 'modul' ? a.raum : a.auswahl === 'stufe' ? stufenZiel(L) : a.platz, i: teil || null };
    const key = JSON.stringify(m);
    if (key === s.gesendet || now() - s.gesendetT < 120) return;
    s.gesendet = key; s.gesendetT = now();
    cmd(view, 'werft.ansicht', m);
  }

  // ---------------------------------------------------------------- Handel (Zeilen wie die alte Konsole: Consoles.shopRows)
  const K = () => window.Consoles;
  const HANDEL_ART = { item: 'Vorrat', gear: 'Ausrüstung', deko: 'Deko', upgrade: 'Umbau' };
  const HANDEL_TEXT = {
    werkzeuggurt: 'Du reparierst 30 % schneller (nur du).', ersatzteil: 'Repariert ausgefallene Systeme.', loeschgel: 'Fünf Löschladungen.', flickblech: 'Flickt einen Hüllenbruch.',
    bolzen: 'Torpedo für den Torpedowerfer (Heck, Platz 2): zielsuchend, trifft die Hülle. Das Lager fasst höchstens ' + KAT.TORPEDO.lagerMax + '.',
    medipack: 'Heilt 50 HP (Nachschub fürs Außenteam).', sonde: 'Sonde für die Ops: erkundet Nachbarsektoren.',
    ladung: 'Sprengstoff für das Außenteam: am Sprengziel platzieren (E halten). Keine Explosion, die Folge kommt nach dem Hochbeamen.',
    kristalllampe: 'Vaelen-Handwerk: leuchtet in Mint. Nur hier zu haben.',
  };
  function handelZeilen(view) {
    let rows = (K() && K().shopRows ? K().shopRows(view) : []).slice();
    const hs = ((view.state || {}).werft || {}).hs;   // SUND-02b A1: Stützpunkt der Crew: Werft ja, Handel gesperrt (Text vom Server, jede Zeile mit demselben Grund)
    if (hs) rows = rows.map((r) => Object.assign({}, r, { reason: hs }));
    const order = { item: 0, gear: 1, upgrade: 1, deko: 2 };
    return rows.map((r, i) => ({ r, i })).sort((x, y) => (order[x.r.kind] - order[y.r.kind]) || (x.i - y.i)).map((x) => x.r);
  }

  // ---------------------------------------------------------------- Kurs (SUND-02b D): Absichten von Rom, Anzeige aus world.absicht (Absicht.modell), Befehle an den Server, Texte aus content/flotte/absichten.json
  // (intern heißt der Bereich weiter 'lage'). Reihenfolge der Zustände: Rang nie vor laufender Absicht prüfen (Rangverlust lässt sie zu Ende laufen).
  const absicht = () => (window.Absicht && Absicht.modell ? Absicht.modell() : null);   // null: kein Modus (Kampagne, Limes), dann gibt es den Bereich nicht
  const AT = (key, w) => (window.Absicht && Absicht.text ? Absicht.text(key, w) : '');
  const sprung = (n) => (window.Absicht && Absicht.sprung ? Absicht.sprung(n) : String(n));
  const lageKarte = (AB, id) => (AB && (AB.angebot.find((k) => k.id === id) || AB.angebot[0])) || null;   // gewählte Karte, sonst die erste
  function annehmen(view, AB, id) {
    if (s.zusehen || !AB || !AB.angebot.length || !id || abgesagt()) return;
    cmd(view, 'absicht.waehlen', { id }); warten();
  }
  function ablehnen(view, AB) {
    if (s.zusehen || !AB || !AB.angebot.length || abgesagt()) return;
    cmd(view, 'absicht.ablehnen'); warten();
  }
  function lageWeiter(view, d) {
    const AB = absicht(); if (s.zusehen || !AB || AB.angebot.length < 2) return;
    const i = Math.max(0, AB.angebot.findIndex((k) => k.id === s.lageId));
    s.lageId = AB.angebot[(i + AB.angebot.length + d) % AB.angebot.length].id; s.antwort = null;
  }
  // ---------------------------------------------------------------- Entscheidungsschlacht (SUND-04a-3 Finale-UI): Karte rechts im Bereich Kurs, Anzeige aus world.finale (Finale.modell), Befehle finale.waehlen / .bestaetigen / .ablehnen.
  // Zweistufig wie der Verrat: erst die Anfrage (E), dann „Bestätigen (n s)“ (E) innerhalb der Frist; N lehnt ab und kostet nichts. Alle am Terminal sehen die Anfrage, die erste Bestätigung gilt (Server).
  const finale = () => (window.Finale && Finale.modell ? Finale.modell() : null);   // null: kein Angebot, kein Finale (dann keine Karte)
  const FT = (key, w) => (window.Finale && Finale.text ? Finale.text(key, w) : '');
  const FINALE_ENTPRELL_MS = 600;   // so lange nach der eigenen Anfrage ignoriert das Terminal ein Bestätigen (ein Doppeldruck bestätigt nicht aus Versehen)
  const wartetJetzt = () => !!s.wartet && now() - s.wartet.t < 3000;
  function finaleAnfragen(view) {
    const fi = finale(); if (s.zusehen || !fi || fi.zustand !== 'angebot' || wartetJetzt()) return;
    s.finaleT = now(); warten(); cmd(view, 'finale.waehlen');
  }
  function finaleBestaetigen(view) {
    const fi = finale(); if (s.zusehen || !fi || fi.zustand !== 'anfrage' || fi.rest <= 0 || wartetJetzt() || now() - s.finaleT < FINALE_ENTPRELL_MS) return;
    warten(); cmd(view, 'finale.bestaetigen');
  }
  function finaleAblehnen(view) {
    const fi = finale(); if (s.zusehen || !fi || (fi.zustand !== 'angebot' && fi.zustand !== 'anfrage') || wartetJetzt()) return;
    warten(); cmd(view, 'finale.ablehnen');
  }
  const finaleTaste = (view) => { const fi = finale(); if (fi && fi.zustand === 'anfrage') finaleBestaetigen(view); else finaleAnfragen(view); };
  // Modell der Karte für T.zeichneFinale; bei laufendem Finale (Phase) gibt es keine Knöpfe und keine Klickflächen
  function finaleKarte(view, bedienbar) {
    const fi = finale(); if (!fi) return null;
    // Neubeginn (Niederlage, Flucht, gefallene Crew): die Rückmeldung der Wahl davor („Die Schlacht beginnt.“) steht nicht mehr da (Welle 5, S4)
    if (s.finaleWechsel !== undefined && s.finaleWechsel !== fi.wechsel && s.antwort && s.antwort.finale) s.antwort = null;
    s.finaleWechsel = fi.wechsel;
    const k = { zustand: fi.zustand, name: fi.name, text: fi.text, rest: fi.rest, frist: fi.frist, neuerAnlauf: !!fi.neuerAnlauf };
    if (fi.zustand === 'phase') {
      const orbit = fi.phase === 'orbit', ende = fi.phase === 'ende';
      return Object.assign(k, { tag: FT(ende ? 'tag_ende' : 'tag_laeuft'), hinweis: FT('status_' + fi.phase), schritte: [{ label: FT('orbit'), fertigLabel: FT('orbit_frei'), aktiv: orbit, fertig: !orbit }, { label: FT('boden'), fertigLabel: FT('boden_frei'), aktiv: fi.phase === 'boden', fertig: ende }], haupt: null, ablehnen: null });
    }
    const wartet = wartetJetzt(), grund = !bedienbar ? FT('zuschauer') : wartet ? FT('wartet') : null, anfrage = fi.zustand === 'anfrage';
    return Object.assign(k, {
      tag: FT(anfrage ? 'tag_anfrage' : 'tag_angebot'), hinweis: anfrage ? FT('frist') : fi.neuerAnlauf ? FT('neuer_anlauf') : FT('angebot_hinweis'),
      haupt: { text: anfrage ? FT('bestaetigen', { n: fi.rest }) : FT('anfragen'), disabled: !!grund || !bedienbar, grund, onClick: bedienbar ? () => finaleTaste(view) : null },
      ablehnen: { text: FT('ablehnen'), disabled: !!grund || !bedienbar, grund, onClick: bedienbar ? () => finaleAblehnen(view) : null },
    });
  }
  // „Schon gewählt“ vom Server: die Karten sind sofort gesperrt, bis der neue Snapshot das Angebot wegnimmt (kein bedienbares Angebot neben der Absage)
  const abgesagt = () => !!s.antwort && s.antwort.ok === false && s.antwort.code === 'schon_gewaehlt' && now() - s.antwort.t < KOMMENTAR_MS;
  // Modell des Bereichs für T.zeichneLage (a.lage = gewählte Id, bei Zuschauern die des Nutzers)
  function lageModell(view, AB, a, bedienbar, ant) {
    const warnung = ant && !ant.ok ? ant.text : null;   // Antwort des Servers („Schon gewählt …“) ersetzt die Infozeile (Warnfarbe)
    if (AB.laufend) return { zustand: 'laeuft', laufend: AB.laufend, info: { text: AT('laeuft_info'), grund: warnung } };   // zuerst: eine laufende Absicht läuft auch nach einem Rangverlust zu Ende
    if (!AB.frei) return { zustand: 'gesperrt', titel: AT('gesperrt_titel'), text: AT('gesperrt_text', { ab: AB.ab }), info: warnung ? { text: '', grund: warnung } : null };
    if (!AB.angebot.length) return { zustand: 'leer', titel: AT('leer_titel'), text: AT('leer_text'), info: warnung ? { text: '', grund: warnung } : null };
    const gew = lageKarte(AB, a.lage), sperre = abgesagt();
    return {
      zustand: 'angebot', hilfe: bedienbar && !sperre ? T.kappe('terminal.teil', '↑↓') + ' ' + AT('hilfe_waehlen') + ' · ' + T.kappe('terminal.annehmen', 'Ent') + ' ' + AT('hilfe_annehmen') + ' · ' + T.kappe('terminal.ablehnen', 'X') + ' ' + AT('hilfe_ablehnen') : '',
      karten: AB.angebot.map((k) => Object.assign({}, k, { gewaehlt: !!gew && k.id === gew.id, onClick: bedienbar && !sperre ? () => { s.lageId = k.id; s.antwort = null; } : null })),
      info: { text: AT('angebot_info', { n: sprung(AB.rest) }), grund: warnung },
    };
  }
  function lageBauen(view, m, L, a, bedienbar, hinweis, wartet, ant) {
    const AB = absicht();
    m.bereich = 'lage';
    m.kopf = { ort: AT('kopf'), art: 'lage', marken: L.marks };
    m.lage = Object.assign(lageModell(view, AB, a, bedienbar, ant), { bereich: AT('bereich') });
    const fk = finaleKarte(view, bedienbar); if (fk) m.lage.finale = fk;   // SUND-04a-3: Karte der Entscheidungsschlacht (nur mit Angebot oder laufendem Finale)
    // Welle 5 (S1): solange die Karte Tasten hat (Angebot, Anfrage), nennt die Tastenzeile oben rechts auch E und N; bei laufendem Finale sind sie ohne Wirkung und stehen nicht da
    if (fk && fk.haupt && bedienbar) m.lage.hilfe = [m.lage.hilfe, T.kappe('terminal.finale', 'E') + ' ' + FT('hilfe_schlacht'), T.kappe('terminal.finaleAblehnen', 'N') + ' ' + FT('hilfe_ablehnen')].filter(Boolean).join(' · ');
    m.schnitt = null; m.kreuz = { plaetze: plaetzeModell(L), gesperrt: true, grund: 'Zur Werft: ' + T.kappe('terminal.werft', 'W'), onPlatz: bedienbar ? (p) => waehlePlatz(view, p) : null };   // wie im Handel: Kreuz und Module gedimmt
    m.module = { module: moduleModell(L), gesperrt: true, energie: energieText(L), onModul: bedienbar ? (r) => waehleRaum(view, r) : null };
    const gew = lageKarte(AB, a.lage), sperre = abgesagt(), hat = AB.frei && !AB.laufend && AB.angebot.length > 0 && !sperre;
    const grund = !bedienbar ? AT('zuschauer') : wartet ? AT('wartet') : AB.laufend ? null : !AB.frei ? AT('ab_rang', { ab: AB.ab }) : sperre ? AT('abgesagt') : !hat ? AT('kein_angebot') : null;
    m.aktionen = {
      haupt: { art: 'annehmen', text: AB.laufend ? AT('laeuft_noch', { n: sprung(AB.laufend.rest) }) : AT('annehmen'), disabled: !hat || !bedienbar || wartet, grund, onClick: () => annehmen(view, AB, gew && gew.id) },
      hinweis: hinweis(hat && gew ? gew.name : AB.laufend ? AB.laufend.name : '', 'dim'),
      ausbau: { label: AT('ablehnen'), aktion: 'terminal.ablehnen', taste: 'X', disabled: !hat || !bedienbar, grund: hat ? null : AT('kein_angebot'), onClick: () => ablehnen(view, AB) },
      teil: { label: AT('option'), disabled: !hat || AB.angebot.length < 2 || !bedienbar, onClick: () => lageWeiter(view, 1) },
    };
    return m;
  }

  // ---------------------------------------------------------------- Brett (SUND-04b D): Auftragsbrett, Anzeige aus world.abenteuer (Brett.modell), Befehle abenteuer.annehmen / abenteuer.ablehnen, Antwort abenteuerAntwort
  // Die Crew entscheidet: jeder darf antworten, die erste Antwort gilt (der Server sagt schon_beantwortet). Ablehnen kostet nichts. Angenommen sehen es alle aus dem Snapshot (laufend), nicht aus einem lokalen Zustand.
  const brett = () => (window.Brett && Brett.modell ? Brett.modell() : null);   // null: kein Block (kein FAEDEN=1, Kampagne, Lobby, nichts am Brett): dann gibt es den Bereich nicht
  const BT = () => (window.PultAuftrag && PultAuftrag.TOKENS ? PultAuftrag.TOKENS.TEXT : {});
  const brettKarte = (BR, id) => (BR && (BR.angebote.find((k) => k.id === id) || BR.angebote[0])) || null;   // gewähltes Angebot, sonst das erste
  const brettKannAntworten = (BR) => !s.zusehen && !!BR && BR.angebote.length > 0 && !wartetJetzt();
  function brettAnnehmen(view, BR, id) {
    if (!brettKannAntworten(BR) || !BR.ok || BR.laufend || !id) return;
    if (Brett.annehmen((m) => view.send(m), id)) warten();
  }
  function brettAblehnen(view, BR, id) {
    if (!brettKannAntworten(BR) || !id) return;
    if (Brett.ablehnen((m) => view.send(m), id)) warten();
  }
  function brettWeiter(view, d) {
    const BR = brett(); if (s.zusehen || !BR || BR.angebote.length < 2) return;
    const i = Math.max(0, BR.angebote.findIndex((k) => k.id === s.brettId));
    s.brettId = BR.angebote[(i + BR.angebote.length + d) % BR.angebote.length].id; s.antwort = null;
  }
  function brettNummer(BR, nr) { if (s.zusehen || !BR || !BR.angebote[nr - 1]) return; s.brettId = BR.angebote[nr - 1].id; s.antwort = null; }
  // Modell des Bereichs für T.zeichneBrett; a.brett = gewählte Id (bei Zuschauern die des Nutzers). Zeile 1 der Infozeile: Absage des Servers (gelb) vor ANGENOMMEN (mint, aus dem Snapshot)
  function brettBauen(view, m, L, a, bedienbar, wartet, ant) {
    const BR = brett(), TX = BT(), gew = brettKarte(BR, a.brett), lauf = BR.laufend, frei = bedienbar && !wartet;
    m.bereich = 'brett';
    m.kopf = { ort: L.ort, art: 'hafen', marken: L.marks };
    m.brett = {
      titel: BR.kopf || TX.bereich, laufend: lauf, gewaehlt: gew ? gew.id : null, geruechte: BR.geruechte, leerText: '',
      hilfe: bedienbar && gew ? T.kappe('terminal.teil', '↑↓') + ' wählen · ' + T.kappe('terminal.brettAnnehmen', 'Ent') + ' annehmen · ' + T.kappe('terminal.brettAblehnen', 'X') + ' ablehnen' : '',
      angebote: BR.angebote.map((k, i) => Object.assign({}, k, { nr: i + 1, kappe: T.kappe('terminal.brett' + (i + 1), String(i + 1)), onClick: bedienbar ? () => { s.brettId = k.id; s.antwort = null; } : null })),
      info: ant && !ant.ok ? { grund: ant.text } : Brett.frisch(lauf) ? { angenommen: lauf.titel } : null,
    };
    m.schnitt = null; m.kreuz = { plaetze: plaetzeModell(L), gesperrt: true, grund: 'Zur Werft: ' + T.kappe('terminal.werft', 'W'), onPlatz: bedienbar ? (p) => waehlePlatz(view, p) : null };
    m.module = { module: moduleModell(L), gesperrt: true, energie: energieText(L), onModul: bedienbar ? (r) => waehleRaum(view, r) : null };
    const grundAnnehmen = !bedienbar || wartet ? null : lauf ? TX.gesperrtGrund.replace('{titel}', lauf.titel) : !BR.ok ? Brett.antwortText('kein_spielleiter') : !gew ? Brett.antwortText('kein_angebot') : null;
    const kann = frei && !!gew && !lauf && BR.ok;
    m.aktionen = {
      haupt: { art: 'brettAnnehmen', text: TX.annehmen, disabled: !kann, grund: grundAnnehmen, onClick: () => brettAnnehmen(view, BR, gew && gew.id) },
      hinweis: s.zusehen ? { text: 'Du siehst zu · Esc zurück', fn: 'dim' } : lauf ? { text: TX.gesperrt, fn: 'warn' } : !BR.ok ? { text: Brett.antwortText('kein_spielleiter'), fn: 'warn' } : gew ? { text: BR.ablehnen ? BR.ablehnen.replace(/\.$/, '') : TX.kostetNichts, fn: 'modul' } : { text: '', fn: 'dim' },
      ausbau: { label: TX.ablehnen, aktion: 'terminal.brettAblehnen', taste: 'X', kontur: true, disabled: !(frei && !!gew), grund: gew ? null : Brett.antwortText('kein_angebot'), onClick: () => brettAblehnen(view, BR, gew && gew.id) },
      teil: { label: 'Angebot', disabled: BR.angebote.length < 2 || !bedienbar, onClick: () => brettWeiter(view, 1) },
    };
    return m;
  }

  // ---------------------------------------------------------------- Information (SUND-03b I): Informationshandel des Konkordats, Anzeige aus world.info (HandelInfo.modell), Befehl info.kaufen, Texte und Preise aus content/welt/handel-info-werte.json
  const info = () => (window.HandelInfo && HandelInfo.modell ? HandelInfo.modell() : null);   // null: kein Konkordat-Hafen (oder Kampagne, Limes): dann gibt es den Bereich nicht
  const IT = (key) => (window.HandelInfo && HandelInfo.text ? HandelInfo.text(key) : '');
  const infoThema = (IN, id) => (IN && (IN.themen.find((t) => t.id === id) || IN.themen[0])) || null;   // gewähltes Thema, sonst das erste
  function infoWeiter(view, d) {
    const IN = info(); if (s.zusehen || !IN || IN.themen.length < 2) return;
    const i = Math.max(0, IN.themen.findIndex((t) => t.id === s.infoId));
    s.infoId = IN.themen[(i + IN.themen.length + d) % IN.themen.length].id; s.antwort = null;
  }
  function infoKaufen(view, IN, id, stufe) {
    if (s.zusehen || !IN || !id || (s.wartet && now() - s.wartet.t < 3000)) return;
    const t = IN.themen.find((q) => q.id === id), preis = IN.preise[stufe];
    if (!t || (stufe === 'gerucht' ? t.gerucht : t.beleg)) return;
    if (n(((view.state || {}).inventory || {}).marks) < preis) { meldung(false, IT('zu_wenig_marken'), 'zu_wenig_marken'); return; }
    cmd(view, 'info.kaufen', { thema: id, stufe, art: t.art, k: t.k }); warten();   // Art und Kennung wie angezeigt: hat sich das Angebot inzwischen geändert, kauft der Server nichts
  }
  function infoBauen(view, m, L, a, bedienbar, hinweis, wartet, ant) {
    const IN = info(), gew = infoThema(IN, a.info), bw = (stufe) => !gew || (stufe === 'gerucht' ? gew.gerucht : gew.beleg);
    m.bereich = 'info';
    m.kopf = { ort: L.ort, art: 'info', marken: L.marks };
    const grundVon = (stufe) => !gew ? IT('kein_angebot') : bw(stufe) ? IT('gekauft') : L.marks < IN.preise[stufe] ? IT('zu_wenig_marken') : null;
    const nummer = (t, i) => (IN.themen.filter((q) => q.name === t.name).length > 1 ? ' ' + IN.themen.filter((q, j) => q.name === t.name && j <= i).length : '');   // zwei Themen derselben Art: 1, 2
    m.info = {
      titel: IT('bereich'), hilfe: bedienbar && gew ? T.kappe('terminal.teil', '↑↓') + ' wählen · ' + T.kappe('terminal.gerucht', 'Ent') + ' ' + IT('gerucht_name') + ' · ' + T.kappe('terminal.beleg', 'B') + ' ' + IT('beleg_name') : '',
      leer: IN.themen.length ? null : { titel: IT('angebot_kopf'), text: IT('kein_angebot') },   // keine Themen: das Terminal sagt es, es gibt nichts zu kaufen
      karten: IN.themen.map((t, i) => ({ id: t.id, name: t.name + nummer(t, i), sub: [t.gerucht ? IT('gerucht_name') + ' ' + IT('gekauft_kurz') : '', t.beleg ? IT('beleg_name') + ' ' + IT('gekauft_kurz') : ''].filter(Boolean).join(' · '), gewaehlt: !!gew && t.id === gew.id, onClick: bedienbar ? () => { s.infoId = t.id; s.antwort = null; } : null })),
      stufen: [{ name: IT('gerucht_name'), preis: IN.preise.gerucht, text: IT('gerucht_hinweis'), aktiv: false }, { name: IT('beleg_name'), preis: IN.preise.beleg, text: IT('beleg_hinweis'), aktiv: false }],
      letzte: IN.letzte,
      info: { text: '', grund: ant && !ant.ok ? ant.text : null },
    };
    m.schnitt = null; m.kreuz = { plaetze: plaetzeModell(L), gesperrt: true, grund: 'Zur Werft: ' + T.kappe('terminal.werft', 'W'), onPlatz: bedienbar ? (p) => waehlePlatz(view, p) : null };
    m.module = { module: moduleModell(L), gesperrt: true, energie: energieText(L), onModul: bedienbar ? (r) => waehleRaum(view, r) : null };
    const gg = grundVon('gerucht'), gb = grundVon('beleg');
    const marksFehlt = gew ? (!gew.gerucht && fehlt(IN.preise.gerucht, L.marks)) || (!gew.beleg && fehlt(IN.preise.beleg, L.marks)) || null : null;   // dieselbe Warnzeile wie im Handel
    m.aktionen = {
      haupt: { art: 'gerucht', text: gew ? IT('gerucht_name') + ' kaufen · ' + IN.preise.gerucht + ' M' : 'Nichts im Angebot', disabled: !gew || !bedienbar || wartet || !!gg, grund: !bedienbar ? IT('zuschauer') : wartet ? IT('wartet') : gg, onClick: () => infoKaufen(view, IN, gew && gew.id, 'gerucht') },
      hinweis: marksFehlt ? hinweis(marksFehlt, 'warn') : hinweis(gew ? gew.name : '', 'dim'),
      ausbau: { label: gew ? IT('beleg_name') + ' ' + IN.preise.beleg : IT('beleg_name'), aktion: 'terminal.beleg', taste: 'B', disabled: !gew || !bedienbar || wartet || !!gb, grund: !bedienbar ? IT('zuschauer') : wartet ? IT('wartet') : gb, onClick: () => infoKaufen(view, IN, gew && gew.id, 'beleg') },
      teil: { label: 'Thema', disabled: IN.themen.length < 2 || !bedienbar, onClick: () => infoWeiter(view, 1) },
    };
    return m;
  }

  // ---------------------------------------------------------------- Modell (Action-Layer: alles, was das Frontend zeichnet)
  function plaetzeModell(L, neuStufe) {
    const out = {};
    M.WAFFENPLAETZE.forEach((p) => { const offen = p.stufe <= L.stufe, w = L.best[p.platz] || null; out[p.platz] = { zustand: offen ? (w ? 'bestueckt' : 'offen') : (neuStufe === p.stufe ? 'neu' : 'zu'), waffe: w, stufe: p.stufe }; });
    return out;
  }
  function moduleModell(L, neuStufe) {
    const out = {};
    M.MODUL_RAEUME.forEach((r) => { const offen = r.stufe <= L.stufe, md = L.mod[r.raum] || null; out[r.raum] = { zustand: offen ? (md ? 'bestueckt' : 'offen') : (neuStufe === r.stufe ? 'neu' : 'zu'), modul: md, stufe: r.stufe }; });
    return out;
  }
  function energieText(L) { const k = Object.keys(L.mod).length; return 'ENERGIE  Module ' + k + ' · frei ' + Math.max(0, n((CFG.power || {}).reactor, 8) - k); }
  function seitenTeile(best, seite, neu) { return [7, 4, 1, 9, 6, 3, 8, 5, 2].filter((p) => KAT.PLATZ[p].seite === seite && best[p]).map((p) => ({ t: p + ' ' + kurzName(best[p]), neu: p === neu })); }
  function vorschauModell(L, a, teil) {
    const q = vorschauAnfrage(a, L, teil);
    const leer = { titel: 'VORSCHAU', fn: a.auswahl === 'modul' ? 'modul' : 'waffe', zeilen: [], seiten: [] };
    if (!q) return leer;
    const d = s.vorschau.cache[schluessel(q)];
    if (!d) return leer;   // Antwort noch unterwegs (entprellt, ~0,2 s)
    if (!d.moeglich && d.code !== 'unveraendert') return leer;
    const V = d.vorher, N = d.nachher;   // unverändert (das Teil sitzt schon dort): vorher = nachher, die Zeilen zeigen „gleich“
    if (q.art === 'waffe') {
      const cnt = (x) => Object.keys(x.alloc || {}).length;
      const seiten = KAT.PLATZ[a.platz].art === 'seite' ? [['BB', 'Bb'], ['STB', 'Stb']] : [['BUG', 'vorn'], ['HECK', 'Heck']];
      const nb = {}; [].concat(N.seiten.Bb, N.seiten.Stb, N.seiten.vorn, N.seiten.Heck).forEach((e) => { nb[e.platz] = e.id; });
      return { titel: 'VORSCHAU', fn: 'waffe',
        zeilen: [{ label: 'LADEPOOL', vorher: V.ladepunkte, nachher: N.ladepunkte, segs: Math.max(6, V.ladepunkte, N.ladepunkte), gleichText: false }, { label: 'ENERGIEWAFFEN', vorher: cnt(V), nachher: cnt(N), fn: 'dim', gleichText: false }],
        seiten: seiten.map(([label, k]) => { const t = seitenTeile(nb, k, a.platz); return { label, teile: t.length ? t : [{ t: 'leer' }] }; }) };
    }
    const names = KAT.MODUL_NAMEN || {};
    const nm = {}; N.module.forEach((e) => { nm[e.raum] = e.id; });
    const nach = N.module.map((e) => ({ t: (MODUL_KURZ[e.id] || names[e.id] || e.id), neu: e.raum === a.raum }));
    return { titel: 'VORSCHAU', fn: 'modul',
      zeilen: [{ label: 'ENERGIE', vorher: V.energie.frei, nachher: N.energie.frei, segs: Math.max(1, V.energie.reaktor), gleichText: false }, { label: 'VERT.', verteilung: { vorher: [V.energie.engines, V.energie.shields, V.energie.weapons], nachher: [N.energie.engines, N.energie.shields, N.energie.weapons] } }],
      seiten: [{ label: 'F' + a.raum, teile: [{ t: teil.id === 'leer' ? 'leer' : (MODUL_KURZ[teil.id] || names[teil.id] || teil.id), neu: true }] }, { label: '', teile: nach.length ? [{ t: nach.map((e) => e.t).join(' · ') }] : [{ t: 'keine Module' }] }] };
  }
  function ziffern(p) { return String(p); }

  // Stufenansicht (rechts „STUFE n ÖFFNET“, Marken vorher -> nachher) für die Ausbau-Taste und für einen noch gesperrten Platz oder Raum
  function stufenBlock(L, ziel) {
    const preis = preisVon(L, 'stufe', ziel), voll = L.frei.stufe >= STUFE_MAX;
    const opens = M.WAFFENPLAETZE.filter((p) => p.stufe === ziel).sort((x, y) => y.platz - x.platz).map((p) => ({ kappe: ziffern(p.platz), text: (p.art === 'bug' ? 'Zweite Bugwaffe' : p.art === 'heck' ? 'Heckwaffe' : 'Seitenwaffe') + ' · ' + raumAn(p.x, p.y) + ', ' + deckName(p.y) }))
      .concat(M.MODUL_RAEUME.filter((r) => r.stufe === ziel).map((r) => { const rr = M.SHIP_ROOMS.find((q) => q.id === r.room); return { kappe: 'F' + r.raum, text: rr.name + ' · ' + deckName(rr.y0) }; }));
    const stufen = []; for (let i = 0; i <= STUFE_MAX; i++) stufen.push({ waffen: M.WAFFENPLAETZE.filter((p) => p.stufe <= i).length, module: M.MODUL_RAEUME.filter((r) => r.stufe <= i).length, preis: i ? n(L.preise.stufe[i], 0) : 0, sperre: i > L.frei.stufe ? L.sperre[i] || null : null });
    return { preis, voll, stufen: { stufe: L.frei.stufe, ziel, stufen, sperre: voll ? null : L.sperre[ziel] || null, oeffnet: voll ? [] : opens, marken: [L.marks, voll || preis == null ? L.marks : L.marks - preis], voll,
      hinweis: voll ? 'Das Schiff ist voll ausgebaut.' : 'Die neuen Plätze sind danach leer. Bestücken kostet nichts, nur die Stufe kostet Marken.', energie: 'unverändert, bis bestückt' } };
  }
  const KAUF_TEXT_W = 128;   // Platz für den Text im Hauptknopf (160 px minus Kappe „Ent“)
  const gross = (t) => String(t || '').replace(/^./, (c) => c.toUpperCase());   // der Server schickt „teurer: …“, angezeigt wird „Teurer: …“
  // Text des Kaufknopfs (160 px, davon ~130 für den Text): mit Lagepreis „Torpedo kaufen · ↑15 M (sonst 10)“; passt das nicht, fällt erst „kaufen“, dann der Name weg (der Preis bleibt immer); gilt auch ohne Lagepreis (lange Namen liefen vorher über den Knopf)
  function kaufText(sel) {
    const anders = sel.basis != null && sel.basis !== sel.price, pf = sel.teurer ? '↑' : sel.cheaper ? '↓' : '';
    const preis = anders ? pf + sel.price + ' M (sonst ' + sel.basis + ')' : sel.price + ' M', name = kurz(sel.name, 100);
    const vari = [name + ' kaufen · ' + preis, name + ' · ' + preis, name + ' ' + preis, name + ' ' + pf + sel.price + ' M (' + sel.basis + ')', preis];
    return vari.slice(0, anders ? 5 : 2).find((v) => T.tw(v) <= KAUF_TEXT_W) || (anders ? preis : sel.price + ' M');
  }
  const fehlt = (preis, marks) => (preis != null && marks < preis ? 'Nicht genug Marken (fehlen ' + (preis - marks) + ')' : null);

  // Modell für den Zuschauer: dieselbe Ansicht, aber alles gesperrt, Titel ZUSEHEN, Rahmen in der Farbe des Nutzers
  function modell(view) {
    const m = bauen(view);
    if (!s.zusehen) return m;
    const L = lage(view), u = L.w && L.w.nutzer != null ? L.w.nutzer : null, namen = T.TOKENS.SPIELER_NAMEN || [];
    m.titel = 'ZUSEHEN'; if (u != null) m.rahmenFarbe = u;
    if (m.kreuz) { m.kreuz.gesperrt = true; m.kreuz.grund = null; }
    if (m.module) m.module.gesperrt = true;
    const h = m.aktionen && m.aktionen.haupt;
    if (h) { h.text = (u != null && namen[u] ? namen[u] : 'Der Nutzer') + ' bedient'; h.disabled = true; h.grund = null; h.onClick = null; }
    return m;
  }

  function bauen(view) {
    const L = lage(view), a = ansicht(L);
    let fehlPreis = null;   // Preis der Aktion unter dem Hauptknopf (für „fehlen n“ bei der Serverantwort zu_wenig_marken)
    const rang = window.Rang && Rang.modell ? Rang.modell() : null;   // SUND-02b UI: Rang von Rom (nur mit world.ruf, sonst null: keine Anzeige)
    const m = { status: { amGeraet: L.w && L.w.nutzer != null ? L.w.nutzer : null, zusehen: (L.w && L.w.zu) || [], rang } };
    const bedienbar = !s.zusehen;
    const wartet = !!s.wartet && now() - s.wartet.t < 3000;
    // Rückmeldung unter dem Hauptknopf
    const ant = s.antwort && now() - s.antwort.t < KOMMENTAR_MS ? s.antwort : null;
    if (L.test && L.ruest) m.start = { text: 'Szene starten', disabled: !bedienbar, grund: bedienbar ? null : 'Nur der Nutzer am Terminal startet die Szene', onClick: bedienbar ? () => szeneStart(view) : null };
    const hinweis = (std, fn) => {
      if (s.zusehen) return { text: 'Du siehst zu · Esc zurück', fn: 'dim' };
      if (!ant) return { text: kurz(std, 156), fn };
      let t = ant.kurz || ant.text;
      if (ant.code === 'zu_wenig_marken' && fehlPreis != null && L.marks < fehlPreis) t = 'Es fehlen ' + (fehlPreis - L.marks) + ' Marken';
      return { text: kurz(t, 156), fn: ant.ok ? 'modul' : 'warn' };
    };
    m.kopf = { ort: L.test ? 'Lerche' : L.ort, art: L.test ? 'test' : L.aktiv && L.w && L.w.hs ? 'stuetzpunkt' : L.aktiv ? 'werft' : 'hafen', marken: L.marks, gesperrt: !L.aktiv && a.bereich === 'werft' };   // SUND-02b UI: Stützpunkt der Crew (Werft ja, Handel nein: werft.hs) heißt so
    const BR0 = brett();   // SUND-04b D: Knopf „Brett“ nur mit world.abenteuer (Freie Fahrt Sund mit FAEDEN=1)
    const IN0 = info();   // SUND-03b I: Knopf „Info“ nur an einem Konkordat-Hafen
    const AB0 = absicht();   // SUND-02b D: Knopf „Kurs“ nur im Modus (vor Tribun gedimmt, Grund im Tooltip; eine laufende Absicht hält ihn offen)
    m.bereichUmschalter = { bereich: a.bereich, werftZu: !L.aktiv, werftGrund: (L.w && L.w.grund) || 'Werft nicht verfügbar', onBereich: bedienbar ? (b) => bereichWechseln(b) : null, info: IN0 ? { label: IT('bereich_kurz') || 'Info' } : null, lage: AB0 ? { gesperrt: !AB0.frei && !AB0.laufend, grund: AB0.frei || AB0.laufend ? null : AT('ab_rang', { ab: AB0.ab }), label: AT('bereich') } : null, brett: BR0 ? { label: BT().knopf } : null };
    const ausbauAktiv = a.auswahl === 'stufe';
    const ausbauKnopf = { active: ausbauAktiv, disabled: !L.aktiv || !bedienbar, grund: !L.aktiv ? (L.w && L.w.grund) || 'Werft nicht verfügbar' : null, onClick: () => ausbauTaste(view) };

    if (a.bereich === 'handel') {
      m.bereich = 'handel';
      const rows = handelZeilen(view), sel = rows.find((r) => r.id === a.handel) || rows[0] || null;
      m.handel = {
        artikel: rows.map((r) => ({ id: r.id, name: r.name, art: HANDEL_ART[r.kind] || r.kind, preis: r.price, besitz: String(r.owned || '').replace(/^(Lager|Besitz):\s*/, (x) => x.replace(':', '').trim() + ' '),
          grund: r.reason, guenstiger: r.cheaper, teurer: r.teurer, onClick: bedienbar ? () => { s.handel = r.id; } : null })),
        gewaehlt: sel ? sel.id : null,
        info: sel ? { hinweis: sel.preisHinweis ? { pfeil: sel.teurer ? '↑' : sel.cheaper ? '↓' : '', text: gross(sel.preisHinweis) } : null, text: (HANDEL_TEXT[sel.id] || (sel.kind === 'deko' ? 'Für dein Quartier (an der eigenen Koje platzieren).' : '')), grund: sel.reason === 'Nicht genug Marken' ? fehlt(sel.price, L.marks) : sel.reason } : { text: 'Kein Sortiment.' },
      };
      // im Handel stehen Kreuz und Module gedimmt (die Werft ist ein anderer Bereich); ein Klick wechselt in die Werft
      m.schnitt = null; m.kreuz = { plaetze: plaetzeModell(L), gesperrt: true, grund: 'Zur Werft: ' + T.kappe('terminal.werft', 'W'), onPlatz: bedienbar ? (p) => waehlePlatz(view, p) : null }; m.module = { module: moduleModell(L), gesperrt: true, energie: energieText(L), onModul: bedienbar ? (r) => waehleRaum(view, r) : null };
      fehlPreis = sel ? sel.price : null;
      const lager = sel && sel.limit ? ' · Lager ' + n((L.st.inventory || {})[sel.id]) + '/' + sel.limit : '';
      m.aktionen = {
        haupt: { art: 'kaufen', text: sel ? kaufText(sel) : 'Kaufen', disabled: !sel || !!sel.reason || !bedienbar || !!(s.kauf && now() - s.kauf.t < 1500), grund: sel && sel.reason, onClick: () => { if (sel) kaufen(view, sel); } },
        hinweis: (() => { const g = sel && sel.reason ? (sel.reason === 'Nicht genug Marken' ? fehlt(sel.price, L.marks) || sel.reason : sel.reason) : null; return g ? hinweis(g, 'warn') : hinweis(sel ? (lager ? lager.slice(3) : '') : '', 'dim'); })(),   // SUND-02b UI: gesperrt -> Grund unter dem Knopf (wie in der Werft) ausbau: Object.assign({}, ausbauKnopf, { active: false }), teil: { disabled: !bedienbar, onClick: () => teilWeiter(view, 1) },
      };
      return m;
    }

    if (a.bereich === 'brett' && brett()) return brettBauen(view, m, L, a, bedienbar, wartet, ant);
    if (a.bereich === 'info' && info()) return infoBauen(view, m, L, a, bedienbar, hinweis, wartet, ant);
    if (a.bereich === 'lage' && absicht()) return lageBauen(view, m, L, a, bedienbar, hinweis, wartet, ant);

    m.bereich = 'werft';
    const gesperrt = !L.aktiv;
    const ziel = stufenZiel(L);
    m.schnitt = { stufe: L.stufe, plaetze: plaetzeModell(L, a.auswahl === 'stufe' ? ziel : null), module: moduleModell(L, a.auswahl === 'stufe' ? ziel : null), hier: 'meeting', gesperrt,
      onPlatz: bedienbar && !gesperrt ? (p) => waehlePlatz(view, p) : null, onModul: bedienbar && !gesperrt ? (r) => waehleRaum(view, r) : null };   // Klick im Schiffsschnitt wie im Kreuz
    m.kreuz = { plaetze: plaetzeModell(L, a.auswahl === 'stufe' ? ziel : null), gewaehlt: a.auswahl === 'platz' ? a.platz : null, gesperrt, grund: L.w && L.w.grund, onPlatz: bedienbar && !gesperrt ? (p) => waehlePlatz(view, p) : null };
    m.module = { module: moduleModell(L, a.auswahl === 'stufe' ? ziel : null), gewaehlt: a.auswahl === 'modul' ? 'F' + a.raum : null, gesperrt, energie: energieText(L), onModul: bedienbar && !gesperrt ? (r) => waehleRaum(view, r) : null };
    if (gesperrt) {
      m.ansicht = 'gesperrt'; delete m.schnitt.gewaehlt;
      const grund = L.geladen ? (L.w.grund || 'Gesperrt') : 'Verbindung zum Terminal …';
      const best = [8, 4, 6, 7, 9, 5, 2, 1, 3].filter((p) => L.best[p]).map((p) => ({ kappe: ziffern(p), name: KAT.BY_ID[L.best[p]].name })).concat(Object.keys(L.mod).map((r) => ({ kappe: 'F' + r, name: (KAT.MODUL_NAMEN || {})[L.mod[r]] || L.mod[r], fn: 'modul' })));
      m.gesperrt = { grund: grund + '.', text: 'Hier kannst du handeln. Umbau und Freischalten gehen nur in der Werft einer Flottenbasis, zum Beispiel in Castra Martis.', bestueckung: best };
      m.aktionen = { haupt: { art: 'handel', text: 'Zum Handel', onClick: bedienbar ? () => bereichWechseln('handel') : null, disabled: !bedienbar }, hinweis: { text: 'Werft: ' + grund, fn: 'warn' }, ausbau: ausbauKnopf, teil: { disabled: true, grund } };
      return m;
    }
    if (a.auswahl === 'stufe') {
      m.ansicht = 'stufe';
      const sb = stufenBlock(L, ziel), preis = sb.preis, voll = sb.voll;
      m.stufen = sb.stufen; fehlPreis = preis; if (rang && sb.stufen.sperre) m.stufen.rangJetzt = rang.jetzt;
      let grund = null;
      if (voll) grund = 'Voll ausgebaut'; else if (preis == null) grund = 'Nicht im Angebot'; else if (L.sperre[ziel]) grund = L.sperre[ziel]; else if (fehlt(preis, L.marks)) grund = fehlt(preis, L.marks); else if (!bedienbar) grund = 'Zuschauer bedienen nicht'; else if (wartet) grund = 'Warte auf den Server …';
      m.aktionen = { haupt: { art: 'freischalten', text: voll ? 'Voll ausgebaut' : 'Stufe ' + ziel + ' öffnen · ' + preis + ' M', disabled: !!grund, grund, onClick: () => stufenKauf(view, L) }, hinweis: L.sperre[ziel] && !voll ? hinweis(L.sperre[ziel], 'warn') : hinweis(preis != null && !voll ? preis + ' Marken, einmalig' : '', 'preis'), ausbau: ausbauKnopf, teil: { disabled: true } };
      return m;
    }
    // Platz oder Modulraum
    const modulAnsicht = a.auswahl === 'modul';
    const teile = teileAktuell(L, a), teil = gewaehltesTeil(L, a);
    const offen = modulAnsicht ? raumOffen(L, a.raum) : platzOffen(L, a.platz);
    m.ansicht = modulAnsicht ? 'modul' : 'platz';
    if (modulAnsicht) {
      const rr = M.SHIP_ROOMS.find((q) => q.id === 'modul' + a.raum);
      m.schnitt.gewaehlt = 'F' + a.raum; m.schnitt.deck = rr ? M.deckOf(rr.y0) : 2;
      m.platzKopf = { kappe: 'F' + a.raum, titel: 'MODULRAUM ' + a.raum, lage: (rr ? deckName(rr.y0) + ' · ' : '') + 'jedes Modul passt', fn: 'modul' };
    } else {
      const pl = M.waffenplatz(a.platz);
      m.schnitt.gewaehlt = a.platz; m.schnitt.deck = M.deckOf(pl.y);
      m.platzKopf = { kappe: ziffern(a.platz), titel: 'PLATZ ' + a.platz + ' · ' + SEITE[KAT.PLATZ[a.platz].seite], lage: deckName(pl.y) + ' · ' + raumAn(pl.x, pl.y) + ' · ' + ART[pl.art], fn: 'waffe' };
    }
    if (!offen) {
      // gesperrter Platz oder Raum: rechts der Block „STUFE n ÖFFNET“, der Hauptknopf kauft den nächsten Schritt (nur der Reihe nach)
      const pl = modulAnsicht ? M.MODUL_RAEUME.find((q) => q.raum === a.raum) : M.waffenplatz(a.platz), kappe = modulAnsicht ? 'F' + a.raum : ziffern(a.platz);
      const sb = stufenBlock(L, ziel), preis = sb.preis, voll = sb.voll;
      m.ansicht = 'stufe'; m.stufen = sb.stufen; fehlPreis = preis; if (rang && sb.stufen.sperre) m.stufen.rangJetzt = rang.jetzt;
      m.schnitt.plaetze = plaetzeModell(L, ziel); m.schnitt.module = moduleModell(L, ziel); m.kreuz.plaetze = m.schnitt.plaetze; m.module.module = m.schnitt.module;
      let grund = null;
      if (voll) grund = 'Voll ausgebaut'; else if (preis == null) grund = 'Nicht im Angebot'; else if (L.sperre[ziel]) grund = L.sperre[ziel]; else if (fehlt(preis, L.marks)) grund = fehlt(preis, L.marks); else if (!bedienbar) grund = 'Zuschauer bedienen nicht'; else if (wartet) grund = 'Warte auf den Server …';
      const danach = preisVon(L, 'stufe', pl.stufe);
      const spaeter = pl.stufe > ziel ? kappe + ' ab Stufe ' + pl.stufe + (danach != null ? ' · dann ' + danach + ' M' : '') : kappe + ' öffnet mit Stufe ' + pl.stufe;   // schmale Zeile (156 px): „F4 ab Stufe 2 · dann 180 M“
      m.aktionen = { haupt: { art: 'freischalten', text: voll ? 'Voll ausgebaut' : 'Stufe ' + ziel + ' öffnen · ' + preis + ' M', disabled: !!grund, grund, onClick: () => stufenKauf(view, L) }, hinweis: hinweis(spaeter, 'dim'), ausbau: ausbauKnopf, teil: { disabled: true } };
      return m;
    }
    m.liste = { fn: modulAnsicht ? 'modul' : 'waffe', gewaehlt: teil ? teil.id : null, teile: teile.map((t) => Object.assign({}, t, { onClick: bedienbar ? () => { s.teil = t.id; s.antwort = null; } : null })) };
    m.vorschau = vorschauModell(L, a, teil);
    const vd = teil ? s.vorschau.cache[schluessel(vorschauAnfrage(a, L, teil))] : null;
    let haupt;
    if (!teil) haupt = { art: modulAnsicht ? 'modul' : 'umbau', text: 'Umbau bestätigen', disabled: true };
    else if (teil.zustand === 'kostet') {
      const pr = teil.preis; fehlPreis = pr; const grund = pr == null ? 'Nicht im Angebot' : fehlt(pr, L.marks) ? fehlt(pr, L.marks) : !bedienbar ? 'Zuschauer bedienen nicht' : wartet ? 'Warte auf den Server …' : null;
      haupt = { art: 'freischalten', text: 'Freischalten · ' + pr + ' M', disabled: !!grund, grund, onClick: () => freischalten(view, L, teil.art, teil.id) };
    } else {
      const eingebaut = teil.zustand === 'eingebaut';
      const grund = eingebaut ? 'Das sitzt schon dort' : !bedienbar ? 'Zuschauer bedienen nicht' : wartet ? 'Warte auf den Server …' : (vd && !vd.moeglich ? vd.text : null);
      haupt = { art: modulAnsicht ? 'modul' : 'umbau', text: eingebaut ? 'Schon eingebaut' : teil.id === 'leer' ? (modulAnsicht ? 'Raum leeren' : 'Platz leeren') : modulAnsicht ? 'Modul einbauen' : 'Umbau bestätigen', disabled: !!grund, grund, onClick: () => umbauen(view, L, a, teil) };
    }
    const std = !teil ? '' : teil.zustand === 'kostet' ? (teil.preis != null ? teil.preis + ' Marken, einmalig' : '') : 'Umbauen ist frei';
    m.aktionen = { haupt, hinweis: hinweis(std, teil && teil.zustand === 'kostet' ? 'preis' : 'modul'), ausbau: ausbauKnopf, teil: { disabled: !bedienbar, onClick: () => teilWeiter(view, 1) } };
    return m;
  }

  // ---------------------------------------------------------------- Zeichnen und Eingabe
  function draw(ctx, view) {
    const L = lage(view);
    if (!s.geoeffnet && !s.zusehen && L.geladen) {
      s.geoeffnet = true;
      s.bereich = L.aktiv ? 'werft' : 'handel';
    }
    // Befehl unterwegs: Antwort kommt als Ereignis; bleibt sie aus, nach 3 s wieder freigeben
    if (s.wartet && now() - s.wartet.t > 3000) s.wartet = null;
    if (s.kauf) {
      const marks = n((view.state.inventory || {}).marks);
      if (marks < s.kauf.marks) { meldung(true, s.kauf.name + ' gekauft.'); s.kauf = null; } else if (now() - s.kauf.t > 2500) s.kauf = null;
    }
    const a = ansicht(L);
    if (a.bereich === 'werft' && L.aktiv && a.auswahl !== 'stufe') vorschauPflegen(view, L, a, gewaehltesTeil(L, a));
    ansichtSenden(view, L);
    if (s.zusehen && !L.geladen) { zusehen(view, false); }
    let m;
    try { m = modell(view); } catch (e) { Net.reportError('TerminalUI.modell', e); R.text(ctx, 'Anzeigefehler (siehe Konsole)', 70, 60, { color: T.TOKENS.FARBE.warn }); return ''; }
    T.zeichneTerminal(ctx, view, m);
    R.drawTooltip(ctx);
    return '';
  }

  // Taste (nach Tastenbelegung auf Standardcodes umgesetzt, siehe Consoles.tastenKanon). true = verbraucht
  function keyDown(e, view) {
    const code = e.code, L = lage(view), a = ansicht(L);
    if (/^F[1-4]$/.test(code) && e.preventDefault) e.preventDefault();   // Browser-Hilfe (F1) und Suche (F3) nicht öffnen
    const digit = /^Digit([1-9])$/.exec(code) || /^Numpad([1-9])$/.exec(code);
    if (code === 'KeyH') { bereichWechseln('handel'); return true; }
    if (code === 'KeyW') { bereichWechseln('werft'); return true; }
    if (code === 'KeyK') { bereichWechseln('lage'); return true; }
    if (code === 'KeyI') { bereichWechseln('info'); return true; }
    if (code === 'KeyO') { bereichWechseln('brett'); return true; }   // SUND-04b D: B ist „Beleg kaufen“ (Information), A „Ausbau“ (Werft): das Brett liegt auf O
    if (a.bereich === 'brett') {   // SUND-04b D: Bereich Brett: Pfeile und 1–3 wählen, Enter nimmt an, X lehnt ab (nichts anderes tut hier etwas)
      const BR = brett(), k = brettKarte(BR, a.brett), nr = /^(?:Digit|Numpad)([1-3])$/.exec(code);
      if (code === 'ArrowUp' || code === 'ArrowLeft') brettWeiter(view, -1);
      else if (code === 'ArrowDown' || code === 'ArrowRight') brettWeiter(view, 1);
      else if (nr) brettNummer(BR, +nr[1]);
      else if ((code === 'Enter' || code === 'NumpadEnter') && k) brettAnnehmen(view, BR, k.id);
      else if (code === 'KeyX' && k) brettAblehnen(view, BR, k.id);
      return true;
    }
    if (a.bereich === 'info') {   // SUND-03b I: Bereich Information: Pfeile wählen, Enter kauft das Gerücht, B den Beleg (nichts anderes tut hier etwas)
      const IN = info(), k = infoThema(IN, a.info);
      if (code === 'ArrowUp' || code === 'ArrowLeft') infoWeiter(view, -1);
      else if (code === 'ArrowDown' || code === 'ArrowRight') infoWeiter(view, 1);
      else if ((code === 'Enter' || code === 'NumpadEnter') && k) infoKaufen(view, IN, k.id, 'gerucht');
      else if (code === 'KeyB' && k) infoKaufen(view, IN, k.id, 'beleg');
      return true;
    }
    if (a.bereich === 'lage') {   // SUND-02b D: Bereich Kurs: Pfeile wählen, Enter nimmt an, X lehnt ab (nichts anderes tut hier etwas)
      const AB = absicht();
      if (code === 'ArrowUp' || code === 'ArrowLeft') lageWeiter(view, -1);
      else if (code === 'ArrowDown' || code === 'ArrowRight') lageWeiter(view, 1);
      else if ((code === 'Enter' || code === 'NumpadEnter') && AB && AB.frei && !AB.laufend) { const k = lageKarte(AB, a.lage); annehmen(view, AB, k && k.id); }
      else if (code === 'KeyX' && AB && AB.frei && !AB.laufend) ablehnen(view, AB);
      else if (code === 'KeyE') finaleTaste(view);   // SUND-04a-3: anfragen, dann bestätigen
      else if (code === 'KeyN') finaleAblehnen(view);
      return true;
    }
    if (code === 'ArrowUp' || code === 'ArrowLeft') { teilWeiter(view, -1); return true; }
    if (code === 'ArrowDown' || code === 'ArrowRight') { teilWeiter(view, 1); return true; }
    if (digit) { if (a.bereich === 'handel' && !L.aktiv) return true; waehlePlatz(view, +digit[1]); return true; }
    const f = /^F([1-4])$/.exec(code);
    if (f) { if (a.bereich === 'handel' && !L.aktiv) return true; waehleRaum(view, +f[1]); return true; }
    if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') { hauptTaste(view, L, a); return true; }
    if (code === 'KeyF') { freischaltenTaste(view, L, a); return true; }
    if (code === 'KeyA') { ausbauTaste(view); return true; }
    if (code === 'KeyG') { if (L.test && L.ruest) szeneStart(view); return true; }
    return true;
  }

  function onEvent(ev) {
    if (ev.kind === 'werftAntwort') {
      if (ev.pid && window.Client && ev.pid !== Client.pid) return;
      s.wartet = null;
      // nach einem Stufenkauf zurück zur Platzansicht (sonst kauft ein zweites F gleich die nächste Stufe)
      if (ev.ok && s.letzterKauf && s.letzterKauf.art === 'stufe' && s.auswahl === 'stufe') s.auswahl = s.platzVorher || 'platz';
      s.letzterKauf = null;
      meldung(!!ev.ok, ev.ok ? (ev.op === 'freischalten' ? 'Freigeschaltet.' : 'Umgebaut.') : (ev.text || 'Abgelehnt.'), ev.ok ? null : ev.code);
      vorschauNeu();
    } else if (ev.kind === 'absichtAntwort') {   // SUND-02b D: Antwort des Servers an den Absender (ok oder Grund, z. B. „Schon gewählt“)
      if (ev.pid && window.Client && ev.pid !== Client.pid) return;
      s.wartet = null;
      meldung(!!ev.ok, ev.ok ? AT(ev.op === 'waehlen' ? 'gewaehlt' : 'abgelehnt') : (ev.text || AT('nicht_moeglich')), ev.ok ? null : ev.code);
    } else if (ev.kind === 'abenteuerAntwort') {   // SUND-04b D: Antwort des Servers nur an den Absender; ok = leise (das Ergebnis steht im Snapshot), sonst der Grund in der Infozeile
      if (ev.pid && window.Client && ev.pid !== Client.pid) return;
      s.wartet = null;
      if (ev.ok) s.antwort = null; else meldung(false, window.Brett ? Brett.antwortText(ev.code, ev.text) : (ev.text || ''), ev.code);
    } else if (ev.kind === 'finaleAntwort') {   // SUND-04a-3: Antwort des Servers an den Absender (ok, oder der Grund, z. B. „Die Entscheidungsschlacht läuft schon“)
      if (ev.pid && window.Client && ev.pid !== Client.pid) return;
      s.wartet = null;
      meldung(!!ev.ok, ev.ok ? (window.Finale && Finale.antwortText ? Finale.antwortText(ev.op) : '') : (ev.text || FT('nicht_moeglich')), ev.ok ? null : ev.code);
      if (s.antwort) s.antwort.finale = 1;   // markiert: beim Neubeginn des Finales wird sie geleert
    } else if (ev.kind === 'infoAntwort') {   // SUND-03b I: Antwort des Servers an den Absender (Ergebnis steht im Funk und in world.info.l, hier nur Bestätigung oder Grund der Absage)
      if (ev.pid && window.Client && ev.pid !== Client.pid) return;
      s.wartet = null;
      meldung(!!ev.ok, ev.ok ? (ev.stufe === 'beleg' ? IT('beleg_name') : IT('gerucht_name')) + ' gekauft.' : (ev.text || IT('fehler')), ev.ok ? null : ev.code);
    } else if (ev.kind === 'werftVorschau') {
      if (ev.pid && window.Client && ev.pid !== Client.pid) return;
      if (typeof ev.rid === 'string' && ev.rid) s.vorschau.cache[ev.rid] = ev.vorschau;
    } else if (ev.kind === 'werft') {
      vorschauNeu();   // jemand hat gekauft oder umgebaut: Vorschauen sind veraltet
    }
  }

  // Zusehen (Mitspieler am besetzten Terminal): lokaler Modus, der Server führt nur die Farbe
  function zusehen(view, an) {
    an = !!an;
    if (s.zusehen === an) return;
    s.zusehen = an; s.vorschau = { cache: {}, sent: null, wechsel: 0, key: null };
    if (view && view.send) cmd(view, 'werft.zusehen', { on: an });
  }
  // Zuschauer-Ansicht zeichnen (ohne eigene Konsole); schließt sich, wenn der Nutzer aufsteht
  function drawZusehen(ctx, view) {
    const L = lage(view);
    if (!L.geladen) { zusehen(view, false); return false; }
    draw(ctx, view);
    return true;
  }
  const bereit = () => !!(window.PultTerminal && window.Pult);

  window.TerminalUI = {
    draw, keyDown, onEvent, zusehen, drawZusehen, zuruecksetzen, modell, lage, bereit,
    get zusehend() { return s.zusehen; },
    get bereichJetzt() { return s.bereich === 'brett' && !brett() ? 'werft' : s.bereich === 'info' && !info() ? 'werft' : s.bereich === 'lage' && !absicht() ? 'werft' : s.bereich; },   // wirksamer Bereich (nach Modus-Ende nie 'lage'), für die Tastenbelegung
    get zustand() { return s; },
  };
})();
