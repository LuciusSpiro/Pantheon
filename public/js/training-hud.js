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
//   ziele(state, q)        Ziele der Anzeige (Hud.zieleVon ruft es auf): im Training die des Buchs (und merkt sie), nach dem Abschluss bis zum Neustart die Liste mit allen Haken und „Abzeichen erreicht · Neustart in N s“ (rest)
//   abschluss(ev)          Ereignis missionDone eines gewonnenen Trainings: ab jetzt steht die Liste bis zum Neustart (ziele)
//   laeuft(state)          Läuft das Training (auch zwischen Abschluss und Neustart)? Das HUD blendet dann Marken und Entdeckungen aus
//   abschlussSchonGemeldet(ev)  Ereignis missionDone eines gewonnenen Trainings: das Abzeichen meldet den Abschluss schon („Abzeichen erreicht: …“), der Hinweis „Auftrag erledigt: …“
//                          entfällt (beide zugleich standen übereinander); ein verlorenes Training behält seine Meldung
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TrainingHud = api.erzeuge({ Protokoll: () => root.Shared_Protocol, R: () => root.Render, H: () => root.Hud, Pult: () => root.Pult, Consoles: () => root.Consoles, Sitz: () => root.Sitz, jetzt: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000 });
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BUCH_PRAEFIX = 'tra_';   // Bücher der Trainingsmodi (server/sim/training.js)
  const MAX_ZIELE = 7;           // so viele Ziele stehen höchstens in der Liste (die Übungen haben 6 bis 7)
  const HINWEIS_ZEILEN = 3;      // Hinweis: höchstens drei Zeilen (die letzte endet mit „…“, wenn der Text länger ist)
  const HINWEIS_DAUER = 25;      // s: so lange bleibt die letzte ODA-Zeile in der Liste stehen, nachdem die ODA selbst verschwand
  const ZEILE = 10, RAND = 5, KOPF = 13;
  const ABSCHLUSS_RUHE = 2;      // s nach dem Abschluss, in denen ein Snapshot mit dem alten Buch den Abschluss nicht beendet (Ereignis und Snapshot kommen nicht im selben Takt)
  const NEUSTART_STD = 8;        // s nach dem Abschluss bis zum Neustart (Server: Protocol.TRAINING_NEUSTART_S)
  // Heimatkonsole je Buch: dort steht die volle Liste; an jeder anderen Konsole nur ein Streifen „am Steuer: …“ ohne Tasten (die Tasten gehören der Heimatkonsole)
  const HEIMAT = [['tra_fliegen', 'helm', 'Steuer'], ['tra_captain', 'captain', 'Captain']];
  const VW = 640, VH = 360;

  // Freie Bereiche der Pulte (Bild 640×360), im 2D-Bild und im Blick PULT des Voxel-Sitzes gleich. Gemessen an den Bildern der Sichtprüfung (tools/sicht-training-konsole.js):
  //   helm      rechte Spalte unter „DOCK-RING … hinein“ (Ort, Sprungziel, Dock-Ring enden bei y 86), nach unten bis zur Statusleiste; die Mitte hat die Frontsicht, links stehen Tempo, Kurs, Drehen
  //   weapons   rechte Spalte unter „ZIEL“, über dem Frachtraum-Feld (Oberkante y 174)
  //   captain   Spalte rechts, über dem Frachtraum-Feld (y 239): frei im Reiter Lage, Sektorplan, Aufträge. Die Sternkarte füllt die Spalte bis y 218 (Ort, Sprung, Kanten-Legende): dort steht nur der kompakte
  //             Streifen (zwei Zeilen: Titel mit Stand, darunter Hinweis oder aktuelles Ziel) oben links auf der Karte (kompaktOrt). Der Funk-Reiter zeigt die Zielliste selbst (MISSION): dort gar nichts (still)
  // unten: Abstand der Unterkante der Liste zur Oberkante der Statusleiste (Pult.konsole(view).S); kompakt: Reiter der Captain-Konsole (Consoles.tab), die nur den Streifen bekommen
  const SLOTS = {
    helm: { x: 446, w: 186, unten: 6, hoeheMax: 130 },
    weapons: { x: 472, w: 160, unten: 28, hoeheMax: 106 },
    captain: { x: 510, w: 122, unten: 20, hoeheMax: 128, kompakt: [1], still: [0], kx: 486, kw: 146, kompaktOrt: { 1: { x: 69, y: 14, w: 146 } } },   // kx/kw: Streifen (breiter, die Spalte der Sternkarte beginnt bei x 485); die Liste beginnt rechts der Karte des Reiters Lage (Kante x 506)
  };
  const KOMPAKT_H = 22;
  const SITZ_VORN = { x: 4, y: 4, w: 170 };   // Voxel-Sitz, Blick Hauptschirm/Crew: oben links frei (die ODA steht mittig ab x 178)

  function erzeuge(deps) {
    const dep = (k) => (typeof deps[k] === 'function' ? deps[k]() : deps[k]);
    let letzteOda = null;   // { text, t } – die zuletzt gesehene ODA-Zeile (die ODA selbst verschwindet nach ein paar Sekunden)

    const istTraining = (mission) => !!(mission && mission.active && typeof mission.active.id === 'string' && mission.active.id.startsWith(BUCH_PRAEFIX));
    const abschlussSchonGemeldet = (ev) => !!(ev && typeof ev.id === 'string' && ev.id.startsWith(BUCH_PRAEFIX) && ev.ausgang === 'erfolg');
    const zeigt = (view) => !!(view && view.me && view.me.console && view.state && (istTraining(view.state.mission) || eingefroren(view.state) !== null));

    // ---------- Abschluss: die Liste bleibt bis zum Neustart stehen ----------
    // Nach dem Erfolg schließt der Server das Buch (mission.active ist weg, das HUD fiele auf „Frei erkunden“ zurück). Der Client merkt sich die letzte Trainingsliste (ziele) und hakt sie bei missionDone ab.
    let letzte = null;       // { titel, objs, id } – die zuletzt gesehene Trainingsliste
    let abschlussT = null;   // Zeitpunkt des Abschlusses (Ereignis missionDone), null = läuft
    const neustartS = () => { const P = dep('Protokoll'); return (P && P.TRAINING_NEUSTART_S) || NEUSTART_STD; };
    function abschluss(ev) { if (abschlussSchonGemeldet(ev) && letzte) abschlussT = dep('jetzt'); }
    function eingefroren(state) {
      if (abschlussT == null || !letzte || istTraining(state && state.mission)) return null;
      const rest = neustartS() - (dep('jetzt') - abschlussT);
      if (rest < -2) { abschlussT = null; return null; }   // der Server hat neu gestartet, ohne dass die Liste wieder kam (Sicherung)
      const n = Math.max(0, Math.ceil(rest));
      return { title: letzte.titel, objs: letzte.objs.map((o) => (o.optional ? o : Object.assign({}, o, { done: true }))), rest: 'Abzeichen erreicht · Neustart in ' + n + ' s', id: letzte.id };
    }
    // Ziele der Anzeige: q = { title, objs } aus dem Snapshot (Hud.zieleVon). Im Training merken, nach dem Abschluss die abgehakte Liste mit „rest“ liefern.
    function ziele(state, q) {
      const mission = state && state.mission;
      if (istTraining(mission)) {
        if (abschlussT != null && dep('jetzt') - abschlussT > ABSCHLUSS_RUHE && ((q && q.objs) || []).some((o) => o && !o.done && !o.optional)) abschlussT = null;   // neuer Versuch (Pflichtziele wieder offen); das Ereignis kann dem Snapshot vorauseilen, dann zählt der Schnappschuss des Abschlusses noch nicht
        letzte = { titel: q && q.title, objs: ((q && q.objs) || []).map((o) => ({ text: o && o.text, done: !!(o && o.done), optional: !!(o && o.optional) })), id: mission.active.id };
        return q;
      }
      return eingefroren(state) || q;
    }
    const laeuft = (state) => !!state && (istTraining(state.mission) || eingefroren(state) !== null);
    // Heimatkonsole des Buchs (letzte Liste, auch nach dem Abschluss): { kind, name } | null
    function heimat(view) {
      const m = view && view.state && view.state.mission;
      const id = istTraining(m) ? m.active.id : letzte && letzte.id;
      const h = typeof id === 'string' ? HEIMAT.find((x) => id.startsWith(x[0])) : null;
      return h ? { kind: h[1], name: h[2] } : null;
    }
    const fremd = (view) => { const h = heimat(view); return !!h && !!view.me && view.me.console !== h.kind; };
    // Taste in Klammern am Ende wegnehmen („Temporegler runter (S)“ -> „Temporegler runter“): die Tasten gelten nur an der Heimatkonsole
    const ohneTaste = (text) => String(text || '').replace(/\s*\([^)]*\)\s*$/, '');

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
      if (sitzVorn(view) && cur) return '';   // die ODA steht gerade selbst da (Hauptschirm): nicht doppelt; danach bleibt der Hinweis unter dem Trennstrich stehen (S8)
      return letzteOda && jetzt - letzteOda.t < HINWEIS_DAUER ? letzteOda.text : '';
    }

    function modell(view, jetzt) {
      const H = dep('H');
      const hin = hinweis(view, jetzt);   // immer: merkt die letzte ODA-Zeile
      const q = H && typeof H.zieleVon === 'function' ? H.zieleVon(view.state) : { title: '', objs: [] };   // im Training die Liste des Buchs, nach dem Abschluss die abgehakte (ziele)
      const objs = Array.isArray(q.objs) ? q.objs : [];
      const aktuell = objs.findIndex((o) => o && !o.done && !o.optional);
      const idx = aktuell >= 0 ? aktuell : objs.findIndex((o) => o && !o.done);
      const zeilen = objs.slice(0, MAX_ZIELE).map((o, i) => ({ text: String((o && o.text) || ''), done: !!(o && o.done), optional: !!(o && o.optional), aktuell: i === idx }));
      return { titel: String(q.title || ''), zeilen, mehr: Math.max(0, objs.length - MAX_ZIELE), erledigt: objs.filter((o) => o && o.done && !o.optional).length, gesamt: objs.filter((o) => o && !o.optional).length, hinweis: q.rest || hin, abschluss: !!q.rest, fremd: fremd(view), heimat: (heimat(view) || {}).name || '' };
    }

    // Der freie Bereich dieser Konsole (SLOTS) mit dem Streifen-Merkmal des gerade offenen Reiters; null = nicht gemessen, keine Liste
    function slot(view) {
      const s = SLOTS[view.me.console];
      if (!s) return null;
      const C = dep('Consoles');
      const tab = C && typeof C.tab === 'number' ? C.tab : 0;
      const kompakt = fremd(view) || !!(s.kompakt && s.kompakt.includes(tab));   // fremde Konsole: nur der Streifen
      const ort = kompakt && s.kompaktOrt ? s.kompaktOrt[tab] : null;
      return Object.assign({}, s, kompakt && s.kx != null ? { x: s.kx, w: s.kw } : {}, ort || {}, { kompakt, still: !!(s.still && s.still.includes(tab)), tab });
    }
    // Text auf Pixelbreite kürzen („…“)
    const kuerze = (text, w) => {
      const R = dep('R');
      if (R.measure(text, 1) <= w) return text;
      let t = text;
      while (t.length > 1 && R.measure(t + '…', 1) > w) t = t.slice(0, -1);
      return t + '…';
    };

    // Umbruch der Ziele: Text samt „(opt.)“ auf Zeilenbreite; passt die ganze Liste nicht in hMax, bekommen nur die Ziele, die nicht das aktuelle sind, eine gekürzte Zeile (S2: umbrechen statt kürzen)
    function zielZeilen(m, w, hMax) {
      const R = dep('R'); const tw = w - 2 * RAND - 10;
      const voll = (z) => R.wrap(z.text + (z.optional ? ' (opt.)' : ''), tw, 1);
      const kurz = (z) => { const suffix = z.optional ? ' (opt.)' : ''; return [kuerze(z.text, tw - R.measure(suffix, 1)) + suffix]; };   // „optional“ bleibt auch bei gekürztem Text sichtbar
      const hoehe = (l) => KOPF + l.reduce((s, x) => s + x.length, 0) * ZEILE + (m.mehr ? ZEILE : 0) + RAND - 1;
      let l = m.zeilen.map(voll);
      if (hMax != null && hoehe(l) > hMax) l = m.zeilen.map((z) => (z.aktuell ? voll(z) : kurz(z)));
      return l;
    }
    // Höhe der Liste bei Breite w: Titel, die Ziele (umbrochen), „+n weitere“, der Hinweis (umbrochen, höchstens HINWEIS_ZEILEN Zeilen); kompakt: nur der Streifen.
    // hMax: höchste erlaubte Höhe (der freie Bereich); passt der Hinweis nicht ganz hinein, verliert er Zeilen, nie die Ziele
    function aufbau(m, w, kompakt, hMax) {
      if (kompakt) return { w, h: KOMPAKT_H, hint: [], zeilen: [] };
      const R = dep('R');
      const zeilen = zielZeilen(m, w, hMax);
      const grund = KOPF + zeilen.reduce((s, x) => s + x.length, 0) * ZEILE + (m.mehr ? ZEILE : 0) + RAND - 1;
      const platzZeilen = Math.max(0, Math.floor(((hMax == null ? Infinity : hMax) - grund - 5) / ZEILE));
      const alle = !m.hinweis ? [] : m.abschluss ? m.hinweis.split(' · ') : R.wrap(m.hinweis, w - 2 * RAND, 1);   // Abschluss: „Abzeichen erreicht“ und „Neustart in N s“ je eine Zeile (kein einsames „s“)
      const n = Math.min(HINWEIS_ZEILEN, platzZeilen);
      const hint = alle.slice(0, n);
      if (alle.length > hint.length && hint.length) hint[hint.length - 1] = kuerze(hint[hint.length - 1] + '…', w - 2 * RAND);   // abgeschnitten: sichtbar machen
      return { w, h: grund + (hint.length ? 5 + hint.length * ZEILE : 0), hint, zeilen };
    }
    // Ort der Liste, h = ihre Höhe; im Pult-Bild an der Oberkante der Statusleiste verankert (wächst nach oben, höchstens hoeheMax). Im Reiter Funk der Captain-Konsole (still) keine Liste: dort steht die volle MISSION-Liste
    function platz(view, h) {
      if (sitzVorn(view)) return { x: SITZ_VORN.x, y: SITZ_VORN.y, w: SITZ_VORN.w, kompakt: false };
      const s = slot(view);
      if (!s || s.still) return null;
      const P = dep('Pult');
      const k = P && typeof P.konsole === 'function' ? P.konsole(view) : null;
      if (!k || typeof k.S !== 'number') return null;   // das Pult steht (noch) nicht im Bild: keine Liste ins Leere
      const hoehe = s.kompakt ? KOMPAKT_H : Math.min(h, s.hoeheMax);
      return { x: s.x, y: s.kompaktOrt && s.kompakt && s.y != null && s.kompaktOrt[s.tab] ? s.y : Math.max(4, k.S - s.unten - hoehe), w: s.w, kompakt: s.kompakt };
    }

    function zeichne(ctx, view) {
      if (!zeigt(view)) return;
      const R = dep('R'), PAL = R.PAL;
      const m = modell(view, dep('jetzt'));   // auch wo nichts erscheint: merkt die Liste für die Zeit nach dem Abschluss
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
      if (p.kompakt) {   // Streifen: Titel mit Stand, darunter der Hinweis (sonst das aktuelle Ziel); an fremden Konsolen „am Steuer: Ziel“ ohne Taste und ohne Hinweis (dessen Tasten gelten dort nicht)
        const stand = m.erledigt + '/' + m.gesamt;
        R.text(ctx, kuerze(m.titel || 'Training', w - 2 * RAND - R.measure(stand, 1) - 6), x + RAND, y + 2, { color: PAL.amber, shadow: false });
        R.text(ctx, stand, x + w - RAND, y + 2, { color: PAL.star, align: 'right', shadow: false });
        const akt = m.zeilen.find((z) => z.aktuell);
        const fremdZeile = m.fremd && m.heimat ? 'am ' + m.heimat + ': ' + (akt ? ohneTaste(akt.text) : '') : '';
        const zeile = m.fremd ? fremdZeile : (m.hinweis || (akt ? akt.text : ''));
        const farbe = m.hinweis && !m.fremd ? PAL.mint : PAL.star;
        R.text(ctx, kuerze(zeile, w - 2 * RAND), x + RAND, y + 12, { color: farbe, shadow: false });
        return;
      }
      let ly = y + 4;
      R.text(ctx, kuerze(m.titel || 'Training', w - 2 * RAND), x + RAND, ly, { color: PAL.amber, shadow: false });
      ly += KOPF - 4;
      m.zeilen.forEach((z, i) => {
        const bx = x + RAND; const ls = a.zeilen[i] || [''];
        if (z.aktuell) { ctx.fillStyle = 'rgba(201,151,74,0.22)'; ctx.fillRect(x + 2, ly - 1, w - 4, ls.length * ZEILE); }   // aktuelles Ziel: Messing-Streifen hinterlegt
        ctx.strokeStyle = z.done ? PAL.moss : z.aktuell ? PAL.amber : PAL.panelLight; ctx.lineWidth = 1;
        ctx.strokeRect(bx + 0.5, ly + 0.5, 6, 6);
        if (z.done) { ctx.fillStyle = PAL.moss; ctx.fillRect(bx + 2, ly + 2, 3, 3); }
        const farbe = z.done ? '#6E8A6A' : z.aktuell ? PAL.amber : z.optional ? PAL.panelLight : PAL.star;
        for (const l of ls) { R.text(ctx, l, bx + 10, ly, { color: farbe, shadow: false }); ly += ZEILE; }
      });
      if (m.mehr) { R.text(ctx, '+' + m.mehr + ' weitere', x + RAND + 10, ly, { color: PAL.panelLight, shadow: false }); ly += ZEILE; }
      if (a.hint.length) {
        ctx.fillStyle = PAL.mint; ctx.fillRect(x + RAND, ly + 1, w - 2 * RAND, 1);   // Hinweis in ODA-Farbe (Mint), durch eine Linie abgesetzt
        ly += 5;
        for (const l of a.hint) { R.text(ctx, l, x + RAND, ly, { color: PAL.mint, shadow: false }); ly += ZEILE; }
      }
    }

    return { abschlussSchonGemeldet, abschluss, ziele, laeuft, eingefroren, ohneTaste, zeigt, modell, platz, zeichne, aufbau, istTraining, sitzVorn, hinweis, MAX_ZIELE, HINWEIS_DAUER, SLOTS, SITZ_VORN, BUCH_PRAEFIX };
  }

  return { erzeuge, BUCH_PRAEFIX, MAX_ZIELE, HINWEIS_DAUER, SLOTS, SITZ_VORN };
});
