// SUND-03b A: Funk-Antworten mit Folgen in der Anzeige (nur Freie Fahrt Sund mit Reise-Ereignissen). Globales `Funkwahl`, in Node als Modul (Tests).
// Storage: store.funkwahl = letzter Block world.funkwahl { nr, von, optionen: [{ id, text }], ignorieren, rest } (kommt nur bei Änderung; world.funkwahl = null ist das Löschsignal: das Angebot ist weg,
//   beantwortet, verfallen oder die Lage nicht mehr ruhig; welcome und die Lobby leeren ebenfalls). Gleich für alle Spieler (nur der Server schreibt, die ERSTE Antwort gilt).
// Action: modell() -> null | { nr, von, optionen: [{ id, text }] (2 bis 3), ignorieren, rest }, müll-fest (ohne Block keine Anzeige, kein Platzhalter). antworten(send, id) sendet funk.antworten,
//   der Server entscheidet alles (Folgen, Reaktion des Sprechers, „schon beantwortet“).
// SUND-04a-2 P2: dieselbe Leiste zeigt auch die BITTE eines Fadens (world.bitte { nr, von, pid?, text, optionen, kopf, spaeter, rest }): Kopf „BITTE · <Name>“, Porträt in der Plakette (pid f:<Variante>:<Fraktion>),
//   Zeilen = die Optionen plus „Später“ (nur zuklappen, kein Befehl). Eine Bitte verdrängt die Funk-Antwort in der Anzeige (der Server hält höchstens eine davon offen). Sendet funk.antworten bzw. faden.bitte.
// Frontend: zeichne(ctx, view) zeichnet die Antwortleiste im Pult-/HUD-Stil (Messingrahmen wie die Funkplakette, Funk ist neutral: keine Signalfarbe) über allem, mit Knöpfen (Maus) und einer freien Taste
//   (Tasten.js: allgemein.funkWaehlen = Punkt markiert die nächste Option, allgemein.funkSenden = Umschalt+Punkt sendet die markierte). Kein Zeitdruck: nichts blinkt, nichts läuft ab außer dem Verfall in Sprüngen. „Später“ klappt die Leiste für diesen Spieler zu einem schmalen Streifen zusammen (sie deckt sonst Konsolenfläche), „Nicht antworten“ schließt das Angebot für alle.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Funkwahl = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const VW = 640, VH = 360;
  const BREITE = 240, ZEILE = 14, UNTEN = 8, RAND = 12, SCHIRM_ABSTAND = 8;   // Breite (längste Option 60 Zeichen passt gekürzt, Kopf und Hinweiszeile messen sich selbst), Knopfhöhe, Abstand zum unteren Rand (Bord) bzw. zum Schirmrand (Konsole)
  const BILD_X = 7, BILD_PLATZ = 29;   // Porträt der Bitte: Abstand zum Rand und Platz links vom Kopftext (Plakette 22 + Luft)
  const BEDIENFLAECHEN = ['technik', 'captain', 'shop'];   // Konsolen, deren Schirm Bedienflächen trägt (Knöpfe, Kacheln, Eingaben; gemessen mit tools/messe-funk-flaechen.js, bewiesen in tools/test-ui-03b.js): dort erscheint das Angebot zuerst nur als Streifen
  const store = { funkwahl: null, bitte: null, bKey: null, markiert: -1, nr: null, eingeklappt: false, geoeffnetBei: null, konsole: null, rechteck: null };   // rechteck = zuletzt gezeichnet (für Klicktests)   // eingeklappt = „Später“: nur dieser Spieler, nur für dieses Angebot

  function lesen(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'welcome') { zuruecksetzen(null); bitteSetzen(null); return; }   // neue Verbindung: der Server sendet den Block neu (sentFunkKey wird zurückgesetzt)
    if (msg.t !== 'snap') return;
    if (msg.phase === 'lobby') { zuruecksetzen(null); bitteSetzen(null); return; }
    if (msg.world && Object.prototype.hasOwnProperty.call(msg.world, 'funkwahl')) zuruecksetzen(msg.world.funkwahl && typeof msg.world.funkwahl === 'object' ? msg.world.funkwahl : null);
    if (msg.world && Object.prototype.hasOwnProperty.call(msg.world, 'bitte')) bitteSetzen(msg.world.bitte && typeof msg.world.bitte === 'object' ? msg.world.bitte : null);   // SUND-04a-2 P2: null = Löschsignal
  }
  function zuruecksetzen(block) {
    const neuNr = block && Number.isFinite(block.nr) ? block.nr : null;
    if (neuNr !== store.nr) { store.markiert = -1; store.eingeklappt = false; store.geoeffnetBei = null; }   // ein anderes Angebot: weder Markierung noch „Später“ übernehmen
    store.funkwahl = block; store.nr = neuNr;
  }
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max || 80) : '');
  function modellAus(b) {
    if (!b || typeof b !== 'object' || !Array.isArray(b.optionen)) return null;
    const optionen = b.optionen.filter((o) => o && typeof o === 'object' && str(o.id, 40) && str(o.text, 60)).slice(0, 3).map((o) => ({ id: str(o.id, 40), text: str(o.text, 60) }));
    if (optionen.length < 2 || !isNum(b.nr)) return null;   // weniger als zwei Optionen ist keine Wahl: nichts anzeigen
    return { nr: Math.floor(b.nr), art: 'funk', kopf: 'FUNK', pid: null, von: str(b.von, 40), optionen, ignorieren: str(b.ignorieren, 30), rest: isNum(b.rest) ? Math.max(0, Math.floor(b.rest)) : 0 };
  }
  // SUND-04a-2 P2: Bitte eines Fadens. Müllfest wie modellAus; Porträt nur in der Form f:<0..5>:<rom|ger|kon> (sonst kein Porträt, kein Fehler)
  const PID_F = /^f:[0-5]:(rom|ger|kon)$/;
  // Nacharbeit SUND-04a-2 (F1): der Bittentext wird übernommen (höchstens 90 Zeichen; ein führendes „<von>: “ fällt weg, der Absender steht im Kopf; ein Text mit offenem Platzhalter {…} wird nicht gezeigt)
  function bitteText(b, von) {
    let t = str(b.text, 90).replace(/\s+/g, ' ').trim();
    if (von && t.toLowerCase().indexOf((von + ':').toLowerCase()) === 0) t = t.slice(von.length + 1).trim();
    return /\{\w*\}/.test(t) ? '' : t;
  }
  function bitteAus(b) {
    if (!b || typeof b !== 'object' || !Array.isArray(b.optionen) || !isNum(b.nr)) return null;
    const optionen = b.optionen.filter((o) => o && typeof o === 'object' && str(o.id, 40) && str(o.text, 90)).slice(0, 3).map((o) => ({ id: str(o.id, 40), text: str(o.text, 90) }));
    if (optionen.length < 2) return null;
    const von = str(b.von, 40);
    return { nr: Math.floor(b.nr), art: 'bitte', kopf: str(b.kopf, 12) || 'BITTE', von, fk: str(b.fk, 4), text: bitteText(b, von), pid: typeof b.pid === 'string' && PID_F.test(b.pid) ? b.pid : null, optionen, ignorieren: str(b.spaeter, 20) || 'Einklappen', rest: isNum(b.rest) ? Math.max(0, Math.floor(b.rest)) : 0 };
  }
  // Kopf der Leiste: BITTE · <Name> · <Kürzel der Fraktion> (S5: die Fraktion steht nie nur als Farbe des Porträts)
  const kopfText = (m) => (m.art === 'bitte' ? m.kopf : 'FUNK') + ' · ' + m.von + (m.art === 'bitte' && m.fk ? ' · ' + m.fk : '');
  // Frist: die Bitte läuft in Tätigkeiten (nicht sichtbar): „läuft ab“ bei rest ≤ 1, sonst im Streifen „offen“ und in der vollen Leiste nichts (K2); die Funk-Antwort zählt Sprünge
  const frist = (m, voll) => (m.art === 'bitte' ? (m.rest <= 1 ? 'läuft ab' : voll ? '' : 'offen') : 'noch ' + m.rest + (m.rest === 1 ? ' Sprung' : ' Sprünge'));
  function bitteSetzen(block) {
    const m = bitteAus(block), k = m ? 'b' + m.nr : null;
    if (k !== store.bKey) { store.markiert = -1; store.eingeklappt = false; store.geoeffnetBei = null; }   // eine andere Bitte oder keine: Markierung und Zuklappen nicht übernehmen
    store.bKey = k; store.bitte = m;
  }
  const modell = () => store.bitte || modellAus(store.funkwahl);
  const offen = () => !!modell();

  // Zeilen der Leiste: die Optionen, danach „Nicht antworten“ (immer da, kostet nichts)
  function zeilen(m) { return m.optionen.map((o) => ({ id: o.id, text: o.text })).concat([{ id: m.art === 'bitte' ? '__zuklappen' : 'ignorieren', text: m.ignorieren }]); }

  // Befehl: die ERSTE Antwort gilt (der Server entscheidet, jede weitere bekommt „schon beantwortet“); nr = das Angebot, das gezeigt wurde
  function antworten(send, id) {
    const m = modell();
    if (!m || typeof send !== 'function' || !zeilen(m).some((z) => z.id === id)) return false;
    if (m.art === 'bitte') {   // „Später“ (__zuklappen) ist nur das Zuklappen für diesen Spieler; die Daten-Option „spaeter“ der Bitte ist dagegen eine echte Antwort
      if (id === '__zuklappen') { spaeter(true); return true; }
      send({ t: 'cmd', c: 'faden.bitte', id, nr: m.nr });
      return true;
    }
    send({ t: 'cmd', c: 'funk.antworten', id, nr: m.nr });
    return true;
  }
  // Taste: markieren (nächste Zeile, im Kreis) und senden (die markierte)
  // Streifen oder volle Leiste? An Konsolen mit Bedienflächen auf dem Schirm (BEDIENFLAECHEN) ist der Streifen der Standard; die volle Leiste liegt dort nur, solange der Spieler sie an DIESER Konsole selbst
  // aufgeklappt hat (Taste oder Klick), sonst gilt „Später“. Rein lokal je Client (der Server weiß davon nichts, die erste Antwort gilt weiter).
  const bedienflaechen = (k) => !!k && BEDIENFLAECHEN.indexOf(k.station) >= 0;
  function zu(k) { k = k === undefined ? store.konsole : k; return bedienflaechen(k) ? store.geoeffnetBei !== k.station : store.eingeklappt; }
  function aufklappen() { store.eingeklappt = false; store.geoeffnetBei = bedienflaechen(store.konsole) ? store.konsole.station : null; }
  function spaeter(an) {   // „Später“: die Leiste klappt zu einem schmalen Streifen zusammen, das Angebot bleibt bis zum Verfall
    if (!offen()) return store.eingeklappt;
    if (an === false) aufklappen(); else { store.eingeklappt = true; store.geoeffnetBei = null; }
    return zu();
  }
  // Esc: eine selbst aufgeklappte Leiste an einer Konsole mit Bedienflächen klappt wieder zu (verbraucht die Taste); sonst false (Esc verlässt die Konsole wie bisher)
  function zuklappen() {
    if (!offen() || !bedienflaechen(store.konsole) || store.geoeffnetBei !== store.konsole.station) return false;
    store.geoeffnetBei = null; return true;
  }
  function markieren() {
    const m = modell(); if (!m) return -1;
    if (zu()) { aufklappen(); return store.markiert; }   // zugeklappt (Streifen): der erste Druck klappt nur auf, markiert wird erst der nächste
    store.markiert = (store.markiert + 1) % zeilen(m).length;
    return store.markiert;
  }
  function senden(send) {
    const m = modell(); if (!m || zu() || store.markiert < 0) return false;
    const z = zeilen(m)[store.markiert];
    return !!z && antworten(send, z.id);
  }

  // ---------- Zeichnen (Pult-/HUD-Stil: Messingrahmen wie die Funkplakette; Farben aus dem Skin der Lerche, Funk ist neutral: Text in SK.text, keine Signalfarbe)
  // Welle 5 (K5): Werte, die es in KarteTokens.PULT gibt (hell, stahlhell, messing, tisch, aus), kommen von dort; markiert, zeile und kappe gibt es dort nicht (eigene Töne des Skins der Lerche). Ohne KarteTokens (Node-Tests) gelten dieselben Werte als Ersatz.
  const PU = (root && root.KarteTokens && root.KarteTokens.PULT) || {};
  const SK = { text: PU.hell || '#F4EEDC', dim: PU.stahlhell || '#8EA3B5', frame: PU.messing || '#C9974A', bg: PU.tisch || '#0B0E1A', offLine: PU.aus || '#3A4A66', markiert: '#2A3A52', zeile: '#141C2E', kappe: '#46556A', tisch: PU.tisch || '#0B0E1A', messing: PU.messing || '#C9974A' };
  function kuerzen(R, s, w) {
    let t = String(s || '');
    if (R.measure(t, 1) <= w) return t;
    while (t.length > 1 && R.measure(t + '…', 1) > w) t = t.slice(0, -1);
    return t + '…';
  }
  // Nacharbeit SUND-04a-2 (F4): der Streifen sitzt im RUF-SLOT ganz oben (y 0–11, über dem Schirmrahmen; die Köpfe der Konsolen und Terminals beginnen bei y 12 und tiefer), derselben Lage wie die einzeilige
  // Lagefunk-Zeile (Hud.zeichneFunkZeile: Höhe 11, 9 mit Szenenzeile, im Debug-Modus x 404 und 232 breit neben der FPS-Zeile). Der Lagefunk hat VORRANG: solange die Konsole die Lagefunk-Zeile zeigt
  // (Hud.lagefunkEinzeilig: Terminal, Ops, Steuer), wird der Streifen nicht gezeichnet. Rechts statt mittig (x 388 bis 628), weil in Technik (Reiter 1, Bots-Knopf y 8) und Captain (Reiter 4, y 10) Knöpfe
  // in der Mitte bis an y 8 heranreichen (gemessen: tools/fixtures/funk-bedienflaechen.json).
  const STREIFEN = 11;   // Höhe des zugeklappten Streifens
  const KOPF = 15;       // Höhe der Kopfzeile
  const kopfH = (m) => (m && m.art === 'bitte' && m.pid ? 26 : KOPF);   // Bitte mit Porträt: die Plakette (22) braucht etwas mehr Kopfhöhe
  // Bittentext unter dem Kopf: höchstens zwei Zeilen, ein Rest endet mit „…“ (F1)
  function textZeilen(m, R) {
    if (!m || m.art !== 'bitte' || !m.text) return [];
    const w = BREITE - 12;
    let l;
    if (R && typeof R.wrap === 'function') l = R.wrap(m.text, w, 1);
    else { l = []; let z = ''; for (const wort of m.text.split(' ')) { if ((z + ' ' + wort).trim().length > Math.floor(w / 6) && z) { l.push(z); z = wort; } else z = (z + ' ' + wort).trim(); } if (z) l.push(z); }
    if (l.length > 2) l = [l[0], R && R.measure ? kuerzen(R, l.slice(1).join(' '), w) : l.slice(1).join(' ').slice(0, Math.floor(w / 6) - 1) + '…'];
    return l;
  }
  const textH = (m, R) => { const n = textZeilen(m, R).length; return n ? n * 10 + 3 : 0; };
  function hoehe(m, streifen, R) { return streifen ? STREIFEN : kopfH(m) + textH(m, R || (root && root.Render)) + (zeilen(m).length) * (ZEILE + 1) + 16; }   // Kopf, Text, Optionen, Zeile Nicht antworten / Einklappen, Hinweis
  // S = Oberkante der Statusleiste der Konsole (Pult.statusOben), sonst null (Bordansicht): mit Konsole auf dem Schirm unten rechts über der Statusleiste (verdeckt keinen Knopf des Pults),
  // ohne Konsole unten mittig
  // k = { S, station } der gezeichneten Konsole (Pult.konsole) oder null; streifen (Standard: gilt für k) = zugeklappt. Der Streifen an einer Konsole mit Bedienflächen sitzt am oberen Rand der Schirmfläche
  // (dort liegt nirgends eine Bedienfläche, gemessen), die volle Leiste und der Streifen an den übrigen Konsolen über der Statusleiste.
  // Ruf-Slot (Streifen an einer Konsole): y 0, Höhe wie die Lagefunk-Zeile (9 mit Szenenzeile), im Debug-Modus x 404 und 232 breit (neben der FPS-Zeile)
  function slot(view) {
    const H = root && root.Hud;
    const dbg = !!(H && view && typeof H.radioOberkante === 'function' && H.radioOberkante(view) > 6);
    const sz = !!(H && view && typeof H.szeneVon === 'function' && H.szeneVon(view));
    return dbg ? { x: 404, y: 0, w: 232, h: sz ? 9 : STREIFEN } : { x: VW - BREITE - RAND, y: 0, w: BREITE, h: sz ? 9 : STREIFEN };
  }
  // ODA-Zeile unten in der Bordansicht (S3): die Leiste steht darüber, nicht davor
  const odaH = (view) => { const H = root && root.Hud; try { return H && view && typeof H.odaHoehe === 'function' ? H.odaHoehe(view) : 0; } catch (e) { return 0; } };
  function rechteck(m, k, streifen, view) {
    m = m || modell(); if (typeof k === 'number') k = { S: k, station: '' };
    if (streifen === undefined) streifen = k ? zu(k) : store.eingeklappt;
    const h = hoehe(m, streifen);
    if (!k) { const o = odaH(view); return { x: Math.round((VW - BREITE) / 2), y: VH - h - UNTEN - (o > 0 ? o + 4 : 0), w: BREITE, h }; }
    if (streifen) { const sl = slot(view); return { x: sl.x, y: sl.y, w: sl.w, h: sl.h }; }
    return { x: VW - BREITE - RAND, y: k.S - h - SCHIRM_ABSTAND, w: BREITE, h };
  }
  // Der Lagefunk hat Vorrang im Ruf-Slot: zeigt die Konsole gerade die einzeilige Lagefunk-Zeile, bleibt der Streifen weg (die Taste klappt trotzdem auf)
  function lagefunkVorrang(view, k, streifen) {
    const H = root && root.Hud;
    try { return !!(streifen && k && H && typeof H.lagefunkEinzeilig === 'function' && H.lagefunkEinzeilig(view)); } catch (e) { return false; }
  }
  // Unterkante des Streifens im Ruf-Slot, solange er an der Konsole steht (sonst 0): Ops nimmt die Zoom-Beschriftung der Karte dann weg (wie bei der Lagefunk-Zeile)
  function streifenUnten(view) {
    const m = modell(), k = store.konsole;
    if (!m || !k || !zu(k)) return 0;
    const sl = slot(view);
    return sl.y + sl.h;
  }
  function statusOben(view) { const P = root && root.Pult; return P && typeof P.statusOben === 'function' ? P.statusOben(view) : null; }
  function konsole(view) { const P = root && root.Pult; return P && typeof P.konsole === 'function' ? P.konsole(view) : null; }
  // Tastenkappe wie im Pult: echte Taste aus Tasten.js, ersatzweise die Standardbelegung
  function kappe(aktion, ersatz) {
    const P = root && root.Pult;
    let k = '';
    try { k = P && typeof P.kappe === 'function' ? P.kappe(null, aktion) : ''; } catch (e) { k = ''; }
    return k && k !== '–' ? k : ersatz;
  }
  // Welle 5 (S9): die Punkt-Taste („.“ und „Sh+.“) war als Glyph unlesbar (auch doppelt gezeichnet): der Punkt steht als 2×2-Block auf der Grundlinie, mittig in der Kappe; ein Präfix („Sh+“) davor
  const PUNKT = /(^|\+)\.$/;
  function kappeZeichnen(ctx, R, x, y, k) {   // dunkle Fläche wie SK.knopf, Taste in SK.text; liefert die rechte Kante
    const punkt = PUNKT.test(k), vor = punkt ? k.slice(0, -1) : k;
    const tw = vor ? R.measure(vor, 1) : 0, inhalt = tw + (punkt ? (vor ? 1 : 0) + 2 : 0);
    const w = Math.max(13, inhalt + 7);
    ctx.fillStyle = SK.kappe; ctx.fillRect(x, y - 1, w, 9);
    const sx = x + Math.round((w - inhalt) / 2);
    if (vor) R.text(ctx, vor, sx, y, { color: SK.text, shadow: false });
    if (punkt) { ctx.fillStyle = SK.text; ctx.fillRect(sx + tw + (vor ? 1 : 0), y + 5, 2, 2); }
    return x + w;
  }
  function zeichne(ctx, view) {
    const R = root && root.Render, m = modell();
    if (!R || !m || !ctx) return;
    const k = konsole(view);
    store.konsole = k;
    const streifen = k ? zu(k) : store.eingeklappt;
    const r = rechteck(m, k, streifen, view);
    store.rechteck = r;
    if (lagefunkVorrang(view, k, streifen)) return;   // F4: im Ruf-Slot steht gerade die Lagefunk-Zeile
    const gehen = () => (view && typeof view.send === 'function' ? view.send : null);
    const maus = (R.ui && R.ui.mouse) || {};
    const ueber = (x, y, w, h) => maus.x >= x && maus.y >= y && maus.x < x + w && maus.y < y + h;
    const kw = kappe('allgemein.funkWaehlen', '.');
    if (streifen) {   // „Später“ bzw. Standard an Konsolen mit Bedienflächen: ein schmaler Streifen mit Taste, ein Klick (oder die Taste) klappt auf
      // Stil wie Hud.zeichneFunkZeile (Fläche Tisch, 1 px Messing als Unterkante, 3 px Akzent in Messing: Funk der Fäden ist nie Gefahr-Rot)
      const ty0 = r.y + 1;   // wie die Lagefunk-Zeile: Schrift 9 Pixel hoch ab y 1, darunter die Messing-Unterkante
      ctx.fillStyle = ueber(r.x, r.y, r.w, r.h) ? '#1A2238' : SK.tisch; ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = SK.messing; ctx.fillRect(r.x, r.y + r.h - 1, r.w, 1); ctx.fillRect(r.x, r.y, 3, r.h);
      const ex = kappeZeichnen(ctx, R, r.x + 6, ty0, kw);
      R.text(ctx, kuerzen(R, kopfText(m) + ' · ' + frist(m, false), r.x + r.w - ex - 12), ex + 4, ty0, { color: SK.text, shadow: false });
      R.ui.buttons.push({ x: r.x, y: r.y, w: r.w, h: r.h, label: 'Funk antworten', disabled: false, onClick: () => spaeter(false), hotkey: null });
      return;
    }
    R.panel(ctx, r.x, r.y, r.w, r.h, { style: 'brass' });
    const rest = m.art === 'bitte' ? frist(m, true) : m.rest + (m.rest === 1 ? ' Sprung' : ' Sprünge');   // K2: in der vollen Leiste bei einer Bitte nur „läuft ab“, nie „offen“
    const bild = m.art === 'bitte' && m.pid && root.Hud && typeof root.Hud.drawFunkBild === 'function';   // Plakette mit Porträt (nur gültige Kennung), sonst nur Text
    const gl = r.y + (bild ? 9 : 4);   // eine Grundlinie für Kopf und Frist (S4)
    if (rest) R.text(ctx, rest, r.x + r.w - 6, gl, { color: SK.dim, align: 'right' });
    if (bild) root.Hud.drawFunkBild(ctx, m.pid, r.x + BILD_X, r.y + 3, 22);   // Welle 5 (K4): 2 px weiter innen (x 7 statt 5), der Kopftext rückt mit
    const tx = r.x + 6 + (bild ? BILD_PLATZ : 0);
    R.text(ctx, kuerzen(R, kopfText(m), r.w - 12 - (bild ? BILD_PLATZ : 0) - (rest ? R.measure(rest, 1) + 8 : 0)), tx, gl, { color: SK.text });
    let ty = r.y + kopfH(m);
    for (const l of textZeilen(m, R)) { R.text(ctx, l, r.x + 6, ty, { color: SK.text, shadow: false }); ty += 10; }   // F1: der Bittentext
    // eigene Zeilen statt R.button (dessen Mint = aktiv und Amber = Hover tragen hier andere Bedeutung): markiert = Fläche + Rahmen in SK.text, Hover nur Rahmen in SK.dim
    const zeile = (x, y, w, text, markiert, farbe, onClick, label) => {
      const hov = ueber(x, y, w, ZEILE);
      ctx.fillStyle = markiert ? SK.markiert : SK.zeile; ctx.fillRect(x, y, w, ZEILE);
      const rc = markiert ? SK.text : hov ? SK.dim : null;
      if (rc) { ctx.fillStyle = rc; ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + ZEILE - 1, w, 1); ctx.fillRect(x, y, 1, ZEILE); ctx.fillRect(x + w - 1, y, 1, ZEILE); }
      R.text(ctx, kuerzen(R, text, w - 10), x + 5, y + Math.floor((ZEILE - 7) / 2), { color: farbe, shadow: false });
      R.ui.buttons.push({ x, y, w, h: ZEILE, label: label || text, disabled: false, onClick, hotkey: null });
    };
    let y = r.y + kopfH(m) + textH(m, R);
    const z = zeilen(m), n = m.optionen.length;
    for (let i = 0; i < n; i++) {
      zeile(r.x + 6, y, r.w - 12, z[i].text, store.markiert === i, SK.text, () => { const s = gehen(); if (s) antworten(s, z[i].id); });
      y += ZEILE + 1;
    }
    if (m.art === 'bitte') {   // Bitte: nur „Später“ (zuklappen, kostet nichts); Annahme und Ablehnung sind die Optionen
      zeile(r.x + 6, y, r.w - 12, m.ignorieren, store.markiert === n, SK.dim, () => spaeter(true));
    } else {
      const bw = Math.round((r.w - 12) * 0.62);   // Nicht antworten (kostet nichts, schließt für alle; eine gültige Wahl: SK.text) und Später (nur für mich, klappt zu)
      zeile(r.x + 6, y, bw, m.ignorieren, store.markiert === n, SK.text, () => { const s = gehen(); if (s) antworten(s, 'ignorieren'); });
      zeile(r.x + 6 + bw + 2, y, r.w - 12 - bw - 2, 'Später', false, SK.dim, () => spaeter(true));
    }
    y += ZEILE + 1;
    let hx = kappeZeichnen(ctx, R, r.x + 6, y + 2, kw);   // Hinweiszeile mit Kappen: [.] markieren · [Sh+.] senden
    R.text(ctx, 'markieren', hx + 4, y + 2, { color: SK.dim, shadow: false }); hx += 4 + R.measure('markieren', 1) + 8;
    hx = kappeZeichnen(ctx, R, hx, y + 2, kappe('allgemein.funkSenden', 'Sh+.'));
    R.text(ctx, 'senden', hx + 4, y + 2, { color: SK.dim, shadow: false });
  }

  (function haken() {
    const N = root && root.Net;
    if (!N || typeof N.on !== 'function') return;
    N.on(lesen);
  })();

  return { store, lesen, modellAus, bitteAus, modell, offen, zeilen, antworten, spaeter, markieren, senden, zuklappen, zeichne, rechteck, slot, streifenUnten, textZeilen, kopfText, statusOben, konsole, zu, BEDIENFLAECHEN, BREITE };
});
