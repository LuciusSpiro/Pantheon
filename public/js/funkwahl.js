// SUND-03b A: Funk-Antworten mit Folgen in der Anzeige (nur Freie Fahrt Sund mit Reise-Ereignissen). Globales `Funkwahl`, in Node als Modul (Tests).
// Storage: store.funkwahl = letzter Block world.funkwahl { nr, von, optionen: [{ id, text }], ignorieren, rest } (kommt nur bei Änderung; world.funkwahl = null ist das Löschsignal: das Angebot ist weg,
//   beantwortet, verfallen oder die Lage nicht mehr ruhig; welcome und die Lobby leeren ebenfalls). Gleich für alle Spieler (nur der Server schreibt, die ERSTE Antwort gilt).
// Action: modell() -> null | { nr, von, optionen: [{ id, text }] (2 bis 3), ignorieren, rest }, müll-fest (ohne Block keine Anzeige, kein Platzhalter). antworten(send, id) sendet funk.antworten,
//   der Server entscheidet alles (Folgen, Reaktion des Sprechers, „schon beantwortet“).
// Frontend: zeichne(ctx, view) zeichnet die Antwortleiste im Pult-/HUD-Stil (Messingrahmen wie die Funkplakette, Funk ist neutral: keine Signalfarbe) über allem, mit Knöpfen (Maus) und einer freien Taste
//   (Tasten.js: allgemein.funkWaehlen = Punkt markiert die nächste Option, allgemein.funkSenden = Umschalt+Punkt sendet die markierte). Kein Zeitdruck: nichts blinkt, nichts läuft ab außer dem Verfall in Sprüngen. „Später“ klappt die Leiste für diesen Spieler zu einem schmalen Streifen zusammen (sie deckt sonst Konsolenfläche), „Nicht antworten“ schließt das Angebot für alle.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Funkwahl = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const VW = 640, VH = 360;
  const BREITE = 228, X = 204, ZEILE = 14, UNTEN = 8;   // Breite und x der Funkplakette (hud.js FUNK_W), Knopfhöhe, Abstand zum unteren Rand
  const store = { funkwahl: null, markiert: -1, nr: null, eingeklappt: false };   // eingeklappt = „Später“: nur dieser Spieler, nur für dieses Angebot

  function lesen(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'welcome') { zuruecksetzen(null); return; }   // neue Verbindung: der Server sendet den Block neu (sentFunkKey wird zurückgesetzt)
    if (msg.t !== 'snap') return;
    if (msg.phase === 'lobby') { zuruecksetzen(null); return; }
    if (msg.world && Object.prototype.hasOwnProperty.call(msg.world, 'funkwahl')) zuruecksetzen(msg.world.funkwahl && typeof msg.world.funkwahl === 'object' ? msg.world.funkwahl : null);
  }
  function zuruecksetzen(block) {
    const neuNr = block && Number.isFinite(block.nr) ? block.nr : null;
    if (neuNr !== store.nr) { store.markiert = -1; store.eingeklappt = false; }   // ein anderes Angebot: weder Markierung noch „Später“ übernehmen
    store.funkwahl = block; store.nr = neuNr;
  }
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max || 80) : '');
  function modellAus(b) {
    if (!b || typeof b !== 'object' || !Array.isArray(b.optionen)) return null;
    const optionen = b.optionen.filter((o) => o && typeof o === 'object' && str(o.id, 40) && str(o.text, 60)).slice(0, 3).map((o) => ({ id: str(o.id, 40), text: str(o.text, 60) }));
    if (optionen.length < 2 || !isNum(b.nr)) return null;   // weniger als zwei Optionen ist keine Wahl: nichts anzeigen
    return { nr: Math.floor(b.nr), von: str(b.von, 40), optionen, ignorieren: str(b.ignorieren, 30), rest: isNum(b.rest) ? Math.max(0, Math.floor(b.rest)) : 0 };
  }
  const modell = () => modellAus(store.funkwahl);
  const offen = () => !!modell();

  // Zeilen der Leiste: die Optionen, danach „Nicht antworten“ (immer da, kostet nichts)
  function zeilen(m) { return m.optionen.map((o) => ({ id: o.id, text: o.text })).concat([{ id: 'ignorieren', text: m.ignorieren }]); }

  // Befehl: die ERSTE Antwort gilt (der Server entscheidet, jede weitere bekommt „schon beantwortet“); nr = das Angebot, das gezeigt wurde
  function antworten(send, id) {
    const m = modell();
    if (!m || typeof send !== 'function' || !zeilen(m).some((z) => z.id === id)) return false;
    send({ t: 'cmd', c: 'funk.antworten', id, nr: m.nr });
    return true;
  }
  // Taste: markieren (nächste Zeile, im Kreis) und senden (die markierte)
  function spaeter(an) { if (offen()) store.eingeklappt = an !== false; return store.eingeklappt; }   // „Später“: die Leiste klappt zu einem schmalen Streifen zusammen, das Angebot bleibt bis zum Verfall
  function markieren() {
    const m = modell(); if (!m) return -1;
    if (store.eingeklappt) { store.eingeklappt = false; return store.markiert; }   // zugeklappt: die Taste klappt erst auf
    store.markiert = (store.markiert + 1) % zeilen(m).length;
    return store.markiert;
  }
  function senden(send) {
    const m = modell(); if (!m || store.eingeklappt || store.markiert < 0) return false;
    const z = zeilen(m)[store.markiert];
    return !!z && antworten(send, z.id);
  }

  // ---------- Zeichnen (Pult-/HUD-Stil: Messingrahmen wie die Funkplakette)
  function kuerzen(R, s, w) {
    let t = String(s || '');
    if (R.measure(t, 1) <= w) return t;
    while (t.length > 1 && R.measure(t + '…', 1) > w) t = t.slice(0, -1);
    return t + '…';
  }
  const STREIFEN = 13;   // Höhe des zugeklappten Streifens
  function hoehe(m) { return store.eingeklappt ? STREIFEN : 15 + (zeilen(m).length) * (ZEILE + 1) + 14; }   // Kopf, Optionen, Zeile Nicht antworten / Später, Hinweis
  function rechteck(m) { m = m || modell(); const h = hoehe(m); return { x: X, y: VH - h - UNTEN, w: BREITE, h }; }
  function zeichne(ctx, view) {
    const R = root && root.Render, m = modell();
    if (!R || !m || !ctx) return;
    const P = R.PAL, r = rechteck(m);
    const gehen = () => (view && typeof view.send === 'function' ? view.send : null);
    if (store.eingeklappt) {   // „Später“: ein schmaler Streifen, ein Klick klappt auf
      R.button(ctx, r.x, r.y, r.w, r.h, kuerzen(R, 'FUNK · ' + m.von + ' · antworten', r.w - 12), { color: P.amber, onClick: () => spaeter(false) });
      return;
    }
    R.panel(ctx, r.x, r.y, r.w, r.h, { style: 'brass' });
    R.text(ctx, kuerzen(R, 'FUNK · ' + m.von, r.w - 12 - 54), r.x + 6, r.y + 4, { color: P.amber });
    const rest = m.rest + (m.rest === 1 ? ' Sprung' : ' Sprünge');
    R.text(ctx, rest, r.x + r.w - 6, r.y + 4, { color: P.panelLight, align: 'right' });
    let y = r.y + 15;
    const z = zeilen(m), n = m.optionen.length;
    for (let i = 0; i < n; i++) {
      R.button(ctx, r.x + 6, y, r.w - 12, ZEILE, kuerzen(R, z[i].text, r.w - 12 - 10), { active: store.markiert === i, onClick: () => { const s = gehen(); if (s) antworten(s, z[i].id); } });
      y += ZEILE + 1;
    }
    const bw = Math.round((r.w - 12) * 0.62);   // Nicht antworten (kostet nichts, schließt für alle) und Später (nur für mich, klappt zu)
    R.button(ctx, r.x + 6, y, bw, ZEILE, kuerzen(R, m.ignorieren, bw - 10), { active: store.markiert === n, color: P.panelLight, onClick: () => { const s = gehen(); if (s) antworten(s, 'ignorieren'); } });
    R.button(ctx, r.x + 6 + bw + 2, y, r.w - 12 - bw - 2, ZEILE, 'Später', { color: P.panelLight, onClick: () => spaeter(true) });
    y += ZEILE + 1;
    R.text(ctx, '. markieren   Umsch + . senden', r.x + 6, y + 1, { color: P.panelLight });
  }

  (function haken() {
    const N = root && root.Net;
    if (!N || typeof N.on !== 'function') return;
    N.on(lesen);
  })();

  return { store, lesen, modellAus, modell, offen, zeilen, antworten, spaeter, markieren, senden, zeichne, rechteck };
});
