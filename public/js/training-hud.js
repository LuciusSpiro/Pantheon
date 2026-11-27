// TRA-01 C2: Trainingsliste an der Konsole – Checkliste der Übung und der letzte Hinweis (ODA) auch dort, wo das HUD sie nicht zeichnet.
// Warum: Hud.draw zeichnet die Zielliste (drawObjectives) nur zu Fuß; das Fliegen-Training läuft am Steuerpult, das Captain-Training an der Captain-Konsole,
// und die ODA-Zeile (y 16) deckt die Konsole im 2D-Bild zu. Nur der Voxel-Sitz mit Blick VORN/CREW zeigt die ODA selbst.
// Reine Darstellung (Frontend-Layer): keine Spielregel, kein Snapshot-Feld. Training erkennt der Client am laufenden Buch (mission.active.id beginnt mit „tra_“,
// Server: server/sim/training.js TRAININGSMODI.buch); Tutorial, Kampagne, Labor und Forschungsstation haben andere Bücher. Zu Fuß bleibt es bei der Zielliste des HUD.
//   zeigt(view)            Steht die Trainingsliste in diesem Bild? (Training UND an einer Konsole)
//   modell(view, jetzt)    { titel, zeilen: [{ text, done, optional, aktuell }] (höchstens MAX_ZIELE), mehr, hinweis } – rein, aus dem Snapshot und der ODA
//   platz(view, h)         Ort der Liste { x, y, w, kompakt }: im Voxel-Sitz mit Blick VORN/CREW oben links (dort ist nichts), sonst je Konsole im freien Bereich des Pults (SLOTS);
//                          eine Konsole ohne gemessenen freien Bereich bekommt keine Liste (platz liefert null): lieber nichts als eine verdeckte Pult-Anzeige
//   zeichne(ctx, view)     zeichnet die Liste (client.js ruft sie nach der Konsole auf)
//   abschlussSchonGemeldet(ev)  Ereignis missionDone eines gewonnenen Trainings: das Abzeichen meldet den Abschluss schon („Abzeichen erreicht: …“), der Hinweis „Auftrag erledigt: …“
//                          entfällt (beide zugleich standen übereinander); ein verlorenes Training behält seine Meldung
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TrainingHud = api.erzeuge({ R: () => root.Render, H: () => root.Hud, Pult: () => root.Pult, Consoles: () => root.Consoles, Sitz: () => root.Sitz, jetzt: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000 });
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BUCH_PRAEFIX = 'tra_';   // Bücher der Trainingsmodi (server/sim/training.js)
  const MAX_ZIELE = 7;           // so viele Ziele stehen höchstens in der Liste (die Übungen haben 6 bis 7)
  const HINWEIS_ZEILEN = 3;      // Hinweis: höchstens drei Zeilen (die letzte endet mit „…“, wenn der Text länger ist)
  const HINWEIS_DAUER = 25;      // s: so lange bleibt die letzte ODA-Zeile in der Liste stehen, nachdem die ODA selbst verschwand
  const ZEILE = 10, RAND = 5, KOPF = 13;
  const VW = 640, VH = 360;

  // Freie Bereiche der Pulte (Bild 640×360), im 2D-Bild und im Blick PULT des Voxel-Sitzes gleich. Gemessen an den Bildern der Sichtprüfung (tools/sicht-training-konsole.js):
  //   helm      rechte Spalte unter „DOCK-RING … hinein“ (Ort, Sprungziel, Dock-Ring enden bei y 86), nach unten bis zur Statusleiste; die Mitte hat die Frontsicht, links stehen Tempo, Kurs, Drehen
  //   weapons   rechte Spalte unter „ZIEL“, über dem Frachtraum-Feld (Oberkante y 174)
  //   captain   Spalte rechts, über dem Frachtraum-Feld (y 239): frei im Reiter Lage, Sektorplan, Aufträge. Die Sternkarte füllt die Spalte bis y 218 (Ort, Sprung) und der Funk-Reiter
  //             zeigt die Zielliste selbst (ohne Hinweis, höchstens fünf Ziele): dort steht nur der kompakte Streifen (zwei Zeilen: Titel mit Stand, darunter Hinweis oder aktuelles Ziel)
  // unten: Abstand der Unterkante der Liste zur Oberkante der Statusleiste (Pult.konsole(view).S); kompakt: Reiter der Captain-Konsole (Consoles.tab), die nur den Streifen bekommen
  const SLOTS = {
    helm: { x: 446, w: 186, unten: 6, hoeheMax: 112 },
    weapons: { x: 472, w: 160, unten: 28, hoeheMax: 106 },
    captain: { x: 510, w: 122, unten: 20, hoeheMax: 120, kompakt: [0, 1], kx: 486, kw: 146 },   // kx/kw: Streifen (breiter, die Spalte der Sternkarte beginnt bei x 485); die Liste beginnt rechts der Karte des Reiters Lage (Kante x 506)
  };
  const KOMPAKT_H = 22;
  const SITZ_VORN = { x: 4, y: 4, w: 170 };   // Voxel-Sitz, Blick Hauptschirm/Crew: oben links frei (die ODA steht mittig ab x 178)

  function erzeuge(deps) {
    const dep = (k) => (typeof deps[k] === 'function' ? deps[k]() : deps[k]);
    let letzteOda = null;   // { text, t } – die zuletzt gesehene ODA-Zeile (die ODA selbst verschwindet nach ein paar Sekunden)

    const istTraining = (mission) => !!(mission && mission.active && typeof mission.active.id === 'string' && mission.active.id.startsWith(BUCH_PRAEFIX));
    const abschlussSchonGemeldet = (ev) => !!(ev && typeof ev.id === 'string' && ev.id.startsWith(BUCH_PRAEFIX) && ev.ausgang === 'erfolg');
    const zeigt = (view) => !!(view && view.me && view.me.console && view.state && istTraining(view.state.mission));

    // Voxel-Sitz mit Blick VORN/CREW: dort steht die ODA selbst (y 16) und die Pultfläche ist nicht sichtbar
    function sitzVorn(view) {
      const S = dep('Sitz');
      return !!(view && view.voxel && S && S.station && S.blick !== 'pult');
    }

    // Die zuletzt gesehene ODA-Zeile merken; liefert den Hinweistext oder ''. Im Voxel-Sitz mit Blick VORN/CREW steht die ODA selbst: dort ohne Hinweiszeile.
    function hinweis(view, jetzt) {
      const H = dep('H');
      const cur = H && H.oda && H.oda.cur;
      if (cur && typeof cur.text === 'string' && cur.text) letzteOda = { text: cur.text, t: jetzt };
      if (sitzVorn(view)) return '';   // dort zeigt die ODA selbst den Hinweis, und die Liste soll die Ecke der Frontsicht nicht verdecken: ohne Hinweiszeile
      return letzteOda && jetzt - letzteOda.t < HINWEIS_DAUER ? letzteOda.text : '';
    }

    function modell(view, jetzt) {
      const H = dep('H');
      const q = H && typeof H.zieleVon === 'function' ? H.zieleVon(view.state) : { title: '', objs: [] };
      const objs = Array.isArray(q.objs) ? q.objs : [];
      const aktuell = objs.findIndex((o) => o && !o.done && !o.optional);
      const idx = aktuell >= 0 ? aktuell : objs.findIndex((o) => o && !o.done);
      const zeilen = objs.slice(0, MAX_ZIELE).map((o, i) => ({ text: String((o && o.text) || ''), done: !!(o && o.done), optional: !!(o && o.optional), aktuell: i === idx }));
      return { titel: String(q.title || ''), zeilen, mehr: Math.max(0, objs.length - MAX_ZIELE), erledigt: objs.filter((o) => o && o.done && !o.optional).length, gesamt: objs.filter((o) => o && !o.optional).length, hinweis: hinweis(view, jetzt) };
    }

    // Der freie Bereich dieser Konsole (SLOTS) mit dem Streifen-Merkmal des gerade offenen Reiters; null = nicht gemessen, keine Liste
    function slot(view) {
      const s = SLOTS[view.me.console];
      if (!s) return null;
      const C = dep('Consoles');
      const tab = C && typeof C.tab === 'number' ? C.tab : 0;
      const kompakt = !!(s.kompakt && s.kompakt.includes(tab));
      return Object.assign({}, s, kompakt && s.kx != null ? { x: s.kx, w: s.kw } : {}, { kompakt });
    }
    // Text auf Pixelbreite kürzen („…“)
    const kuerze = (text, w) => {
      const R = dep('R');
      if (R.measure(text, 1) <= w) return text;
      let t = text;
      while (t.length > 1 && R.measure(t + '…', 1) > w) t = t.slice(0, -1);
      return t + '…';
    };

    // Höhe der Liste bei Breite w: Titel, die Ziele (einzeilig gekürzt), „+n weitere“, der Hinweis (umbrochen, höchstens HINWEIS_ZEILEN Zeilen); kompakt: nur der Streifen.
    // hMax: höchste erlaubte Höhe (der freie Bereich); passt der Hinweis nicht ganz hinein, verliert er Zeilen, nie die Ziele
    function aufbau(m, w, kompakt, hMax) {
      if (kompakt) return { w, h: KOMPAKT_H, hint: [] };
      const R = dep('R');
      const grund = KOPF + m.zeilen.length * ZEILE + (m.mehr ? ZEILE : 0) + RAND - 1;
      const platzZeilen = Math.max(0, Math.floor(((hMax == null ? Infinity : hMax) - grund - 5) / ZEILE));
      const alle = m.hinweis ? R.wrap(m.hinweis, w - 2 * RAND, 1) : [];
      const n = Math.min(HINWEIS_ZEILEN, platzZeilen);
      const hint = alle.slice(0, n);
      if (alle.length > hint.length && hint.length) hint[hint.length - 1] = kuerze(hint[hint.length - 1] + '…', w - 2 * RAND);   // abgeschnitten: sichtbar machen
      return { w, h: grund + (hint.length ? 5 + hint.length * ZEILE : 0), hint };
    }
    // Ort der Liste, h = ihre Höhe; im Pult-Bild an der Oberkante der Statusleiste verankert (wächst nach oben, höchstens hoeheMax)
    function platz(view, h) {
      if (sitzVorn(view)) return { x: SITZ_VORN.x, y: SITZ_VORN.y, w: SITZ_VORN.w, kompakt: false };
      const s = slot(view);
      if (!s) return null;
      const P = dep('Pult');
      const k = P && typeof P.konsole === 'function' ? P.konsole(view) : null;
      if (!k || typeof k.S !== 'number') return null;   // das Pult steht (noch) nicht im Bild: keine Liste ins Leere
      const hoehe = s.kompakt ? KOMPAKT_H : Math.min(h, s.hoeheMax);
      return { x: s.x, y: Math.max(4, k.S - s.unten - hoehe), w: s.w, kompakt: s.kompakt };
    }

    function zeichne(ctx, view) {
      if (!zeigt(view)) return;
      const R = dep('R'), PAL = R.PAL;
      const m = modell(view, dep('jetzt'));
      if (!m.zeilen.length && !m.hinweis) return;
      const p0 = platz(view, 0);
      if (!p0) return;
      const s = slot(view);
      const a = aufbau(m, p0.w, p0.kompakt, s && !sitzVorn(view) ? s.hoeheMax : null);
      const p = platz(view, a.h);
      if (!p) return;
      const x = p.x, y = p.y, w = p.w, h = a.h;
      R.backdrop(ctx, x, y, w, h, 0.9);   // dunkel wie die HUD-Zielliste, dazu der Messingrand der Pulte
      ctx.strokeStyle = PAL.brass; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      if (p.kompakt) {   // Streifen: Titel mit Stand, darunter der Hinweis (sonst das aktuelle Ziel)
        const stand = m.erledigt + '/' + m.gesamt;
        R.text(ctx, kuerze(m.titel || 'Training', w - 2 * RAND - R.measure(stand, 1) - 6), x + RAND, y + 2, { color: PAL.amber, shadow: false });
        R.text(ctx, stand, x + w - RAND, y + 2, { color: PAL.star, align: 'right', shadow: false });
        const akt = m.zeilen.find((z) => z.aktuell);
        const zeile = m.hinweis || (akt ? akt.text : '');
        R.text(ctx, kuerze(zeile, w - 2 * RAND), x + RAND, y + 12, { color: m.hinweis ? PAL.mint : PAL.star, shadow: false });
        return;
      }
      let ly = y + 4;
      R.text(ctx, kuerze(m.titel || 'Training', w - 2 * RAND), x + RAND, ly, { color: PAL.amber, shadow: false });
      ly += KOPF - 4;
      for (const z of m.zeilen) {
        const bx = x + RAND;
        if (z.aktuell) { ctx.fillStyle = 'rgba(201,151,74,0.22)'; ctx.fillRect(x + 2, ly - 1, w - 4, ZEILE); }   // aktuelles Ziel: Messing-Streifen hinterlegt
        ctx.strokeStyle = z.done ? PAL.moss : z.aktuell ? PAL.amber : PAL.panelLight; ctx.lineWidth = 1;
        ctx.strokeRect(bx + 0.5, ly + 0.5, 6, 6);
        if (z.done) { ctx.fillStyle = PAL.moss; ctx.fillRect(bx + 2, ly + 2, 3, 3); }
        const farbe = z.done ? '#6E8A6A' : z.aktuell ? PAL.amber : z.optional ? PAL.panelLight : PAL.star;
        const suffix = z.optional ? ' (opt.)' : '';   // „optional“ bleibt auch sichtbar, wenn der Zieltext gekürzt wird
        R.text(ctx, kuerze(z.text, w - 2 * RAND - 10 - R.measure(suffix, 1)) + suffix, bx + 10, ly, { color: farbe, shadow: false });
        ly += ZEILE;
      }
      if (m.mehr) { R.text(ctx, '+' + m.mehr + ' weitere', x + RAND + 10, ly, { color: PAL.panelLight, shadow: false }); ly += ZEILE; }
      if (a.hint.length) {
        ctx.fillStyle = PAL.mint; ctx.fillRect(x + RAND, ly + 1, w - 2 * RAND, 1);   // Hinweis in ODA-Farbe (Mint), durch eine Linie abgesetzt
        ly += 5;
        for (const l of a.hint) { R.text(ctx, l, x + RAND, ly, { color: PAL.mint, shadow: false }); ly += ZEILE; }
      }
    }

    return { abschlussSchonGemeldet, zeigt, modell, platz, zeichne, aufbau, istTraining, sitzVorn, hinweis, MAX_ZIELE, HINWEIS_DAUER, SLOTS, SITZ_VORN, BUCH_PRAEFIX };
  }

  return { erzeuge, BUCH_PRAEFIX, MAX_ZIELE, HINWEIS_DAUER, SLOTS, SITZ_VORN };
});
