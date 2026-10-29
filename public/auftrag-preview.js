// SUND-04b D (Designer): Beispieldaten und Aufbau der Vorschau public/auftrag-preview.html (auch im Vault-Mockup benutzt). Kein Spielcode.
// Die Inhalte sind Beispiele im Ton der Freien Fahrt (Orte und Namen aus content/welt/sund.json und content/faeden/namen.json), keine Serverdaten.
(function () {
  'use strict';
  const T = window.PultTerminal, P = window.Pult, A = window.PultAuftrag, REF = window.AuftragReferenz, R = window.Render;

  // ---------------------------------------------------------------- Beispiel-Angebote
  const KONVOI = {
    id: 'a1', titel: 'Der Bernsteinkonvoi', von: 'kon', ort: 'Kantenstein', typen: ['geruecht', 'konvoi'], aus_geruecht: true, rest: 9,
    anlass: 'Ein Händler des Konkordats will wissen, warum germanische Frachter neuerdings Kantenstein anlaufen. Er zahlt für Gewissheit und mehr für die Ladung.',
    vorschau: {
      schritte: ['In Concordia das Gerücht prüfen', 'Nach Kantenstein springen', { text: 'Konvoi stellen und aufhalten', gefahr: true }, 'Ladung nach Concordia bringen'],
      gelingt: [{ f: 'kon', art: 'haltung', d: 1 }, { f: 'ger', art: 'haltung', d: -1 }, 'Das Konkordat zahlt, Kantenstein verliert Nachschub.'],
      scheitert: [{ f: 'kon', art: 'haltung', d: -1 }, 'Der Konvoi kommt durch, Kantenstein bleibt versorgt.'],
      gefahr: 'Konvoi mit zwei Begleitkorvetten',
    },
  };
  const HEIMWEG = {
    id: 'a2', titel: 'Sigrids Heimweg', von: 'ger', ort: 'Gullfjord', typen: ['wiedersehen', 'geleit'], aus_geruecht: true, rest: 2,
    anlass: 'Sigrid Wolfsang, die Ihr vor Ymirs Zahn aus dem Wrack gezogen habt, bittet um Geleit nach Hause. Rom sieht so etwas nicht gern.',
    vorschau: {
      schritte: ['In Ostia Nova an Bord nehmen', { text: 'Durch die Front bei Gullfjord', gefahr: true }, 'In Gullfjord absetzen'],
      gelingt: ['Haltung Germanen +2', 'Ruf Rom −1', 'Sigrid erinnert sich an Euch.'],
      scheitert: ['Haltung Germanen −1', 'Sigrid wird gefangen, ihr Faden geht weiter.'],
      gefahr: 'Patrouillen beider Seiten an der Front',
    },
  };
  const SABOTAGE = {
    id: 'a3', titel: 'Feuer über Skjaldborg', von: 'rom', ort: 'Skjaldborg', typen: ['sabotage'], rest: 6,
    anlass: 'Der Legat in Castra Gradivi will den germanischen Posten bei Skjaldborg ausgeschaltet sehen, bevor die Legion vorrückt.',
    vorschau: {
      schritte: ['Nach Skjaldborg springen', { text: 'Posten sprengen', gefahr: true }, 'In Castra Gradivi melden'],
      gelingt: [{ f: 'rom', art: 'ruf', d: 1 }, { f: 'ger', art: 'haltung', d: -1 }, 'Rom besetzt den Sektor danach eher.'],
      scheitert: ['Der Posten bleibt. Rom versucht es selbst.'],
      gefahr: 'Verteidigter Posten, Geschütze',
    },
  };
  const BOJE = {
    id: 'a4', titel: 'Die stumme Boje', von: 'rom', ort: 'Bojenfeld', typen: ['spur'], rest: 11,
    anlass: 'Eine Boje im Bojenfeld sendet seit drei Tagen nichts mehr. Die Flottenbasis will wissen, wer sie zum Schweigen gebracht hat.',
    vorschau: {
      schritte: ['Im Bojenfeld scannen', 'Der Spur folgen', 'Fundort melden'],
      gelingt: [{ f: 'rom', art: 'ruf', d: 1 }, 'Ein neuer Weg auf der Karte.'],
      scheitert: ['Die Spur verläuft. Es geht nichts verloren.'],
      gefahr: null,
    },
  };
  const GERUECHTE = [
    { von: 'kon', text: 'Germanische Frachter meiden die Bojen und laufen Kantenstein an.', angebot: 'a1' },
    { von: 'kon', text: 'Eine Germanin aus Ymirs Zahn fragt in den Häfen nach der Lerche.', angebot: 'a2' },
  ];
  const LAUFEND = { id: 'a1', titel: 'Der Bernsteinkonvoi', schritt: 3, schritte_gesamt: 4, schritt_text: 'Konvoi stellen und aufhalten', gefahr: true, rest: 5 };

  const ZUSTAENDE = {
    drei: { angebote: [KONVOI, HEIMWEG, SABOTAGE], gewaehlt: 'a1', geruechte: GERUECHTE, amGeraet: 0, zusehen: [1, 2] },
    ger: { angebote: [KONVOI, HEIMWEG, SABOTAGE], gewaehlt: 'a2', geruechte: GERUECHTE, amGeraet: 1, zusehen: [0] },
    rom: { angebote: [KONVOI, HEIMWEG, SABOTAGE], gewaehlt: 'a3', geruechte: GERUECHTE.slice(0, 1), amGeraet: 2, zusehen: [] },
    eins: { angebote: [BOJE], gewaehlt: 'a4', geruechte: [], amGeraet: 0, zusehen: [] },
    leer: { angebote: [], geruechte: [], amGeraet: 0, zusehen: [1] },
    laeuft: { angebote: [HEIMWEG, SABOTAGE], gewaehlt: 'a2', laufend: LAUFEND, info: { angenommen: LAUFEND.titel }, geruechte: GERUECHTE.slice(1), amGeraet: 0, zusehen: [1, 2] },
    gesperrt: { angebote: [SABOTAGE], gewaehlt: 'a3', laufend: Object.assign({}, LAUFEND, { schritt: 4, schritt_text: 'Ladung nach Concordia bringen', gefahr: false, rest: 1 }), info: { grund: 'Schon angenommen: die erste Antwort der Crew gilt.' }, geruechte: [], amGeraet: 1, zusehen: [0], maus: 'haupt' },
  };

  // ---------------------------------------------------------------- Terminal-Rahmen mit Brett
  window.Consoles = window.Consoles || { helmInfo: () => ({ names: ['DOCK'], stage: 0 }) };
  const view = { state: { ship: { speed: 0, shields: { current: [1, 1, 1, 0] }, integPct: 100, alert: 'normal', docked: true } }, actions: { leave() {} }, send() {} };
  const PLAETZE = { 1: null, 2: null, 3: null, 4: 'standardbatterie', 5: null, 6: 'standardbatterie', 7: 'sturmbatterie', 8: 'lanze', 9: 'standardbatterie' };
  const plaetze = () => { const o = {}; for (let p = 1; p <= 9; p++) o[p] = PLAETZE[p] ? { zustand: 'bestueckt', waffe: PLAETZE[p] } : p === 5 || p === 2 ? { zustand: 'zu', stufe: 2 } : { zustand: 'offen' }; return o; };
  const module = () => ({ 1: { zustand: 'bestueckt', modul: 'frachtraum' }, 2: { zustand: 'bestueckt', modul: 'krankenstation' }, 3: { zustand: 'zu', stufe: 2 }, 4: { zustand: 'zu', stufe: 2 } });

  function terminal(c, m) {
    R.ui = R.ui || { buttons: [], mouse: { x: -1, y: -1 } }; R.ui.buttons = []; R.ui.tooltip = null;
    const L = T.layout();
    R.ui.mouse = m.maus === 'haupt' ? { x: L.aktionen.haupt.x + 40, y: L.aktionen.haupt.y + 10 } : { x: -1, y: -1 };
    P.rahmen(c, view, { titel: 'TERMINAL', S: L.S, station: 'shop', anzeige: (cc) => {
      T.zeichneKopf(cc, { x: 70, y: 10, w: 558, h: 14 }, { ort: 'Ostia Nova', art: 'hafen', marken: 840 });
      REF.brett(cc, m);
    } });
    T.zeichneKreuz(c, L, { plaetze: plaetze() });
    T.zeichneModulraeume(c, L, { module: module(), energie: 'ENERGIE  Module 2 · frei 6' });
    T.zeichneBereich(c, L.aktionen, { bereich: 'brett', werftZu: true, werftGrund: 'Werft nur an Flottenbasen', lage: { label: 'Kurs' } });
    REF.aktionen(c, m);
    T.zeichneStatus(c, L.status, { amGeraet: m.amGeraet, zusehen: m.zusehen });
    if (R.drawTooltip) R.drawTooltip(c);
  }

  // ---------------------------------------------------------------- Flug-HUD (Kontext nur angedeutet)
  function flug(c) {
    const FA = A.TOKENS.FARBE, H = A.TOKENS.MASS.hud;
    c.fillStyle = FA.ink; c.fillRect(0, 0, 640, 360);
    c.fillStyle = FA.dim; for (let i = 0; i < 90; i++) { const x = (i * 197) % 640, y = (i * 113 + (i * i) % 47) % 360; c.fillRect(x, y, 1, 1); }
    const fall = [
      { titel: 'Der Bernsteinkonvoi', schritt: 2, schritte_gesamt: 4, schritt_text: 'Nach Kantenstein springen', rest: 7 },
      { titel: 'Der Bernsteinkonvoi', schritt: 3, schritte_gesamt: 4, schritt_text: 'Konvoi stellen und aufhalten', gefahr: true, rest: 5 },
      { titel: 'Der Bernsteinkonvoi', schritt: 4, schritte_gesamt: 4, schritt_text: 'Ladung nach Concordia bringen', rest: 1 },
      { titel: 'Sigrids Heimweg', schritt: 1, schritte_gesamt: 3, schritt_text: 'In Ostia Nova an Bord nehmen', rest: 8, neu: true },
    ];
    // Ziele-Kasten wie Hud.drawObjectives (Lampe, NORMALBETRIEB, Ort), nur angedeutet; darunter der Streifen
    let y = 4;
    fall.forEach((l, i) => {
      const h = 26;
      R.backdrop(c, H.x, y, H.w, h, H.alpha);
      c.fillStyle = A.TOKENS.FN.shield; c.beginPath(); c.arc(12, y + 7, 4, 0, Math.PI * 2); c.fill();
      R.text(c, 'NORMALBETRIEB', 20, y + 3, { color: A.TOKENS.FN.shield });
      R.text(c, i === 2 ? 'Concordia' : 'Kantenstein', 8, y + 16, { color: A.TOKENS.FN.shield });
      y = REF.hud(c, y + h + 2, l) + 14;
    });
    // Rechts: dasselbe in Originalgröße beschriftet
    const T2 = window.PultTerminal;
    T2.txt(c, 'normal', 206, 34, FA.dim); T2.txt(c, 'Schritt mit Gefahr', 206, 99, FA.dim); T2.txt(c, 'Frist läuft ab', 206, 164, FA.dim); T2.txt(c, 'eben angenommen', 206, 229, FA.dim);
  }

  // ---------------------------------------------------------------- Kontrast
  function kontrastTabelle() {
    const FA = A.TOKENS.FARBE, f = (k) => A.fraktion(k);
    const paare = [
      ['Text auf Kachel', FA.text, FA.kachel, 4.5], ['Dim auf Kachel (Typ, Ort)', FA.dim, FA.kachel, 4.5], ['Dim auf Schirm (Anlass)', FA.dim, FA.grund, 4.5],
      ['Ink auf Messing (gewählte Karte)', FA.ink, FA.angebot, 4.5], ['Messing auf Schirm (Bereichstitel, GERÜCHT)', FA.angebot, FA.grund, 4.5],
      ['Mint auf Kachel (LÄUFT)', FA.laeuft, FA.kachel, 4.5], ['Mint auf Schirm (kostet nichts, ANGENOMMEN)', FA.laeuft, FA.grund, 4.5],
      ['Gelb auf Kachel (verfällt bald)', FA.bald, FA.kachel, 4.5], ['Gelb auf Schirm (gesperrt, Absage)', FA.bald, FA.grund, 4.5],
      ['GEFAHR auf Kachel', FA.gefahrText, FA.kachel, 4.5], ['GEFAHR auf Schirm', FA.gefahrText, FA.grund, 4.5],
      ['Buchstabe auf Plakette R', FA.plaketteText, f('rom').feld, 4.5], ['Buchstabe auf Plakette G', FA.plaketteText, f('ger').feld, 4.5], ['Buchstabe auf Plakette K', FA.plaketteText, f('kon').feld, 4.5],
      ['Plakette G auf Kachel (Grafik)', f('ger').feld, FA.kachel, 3], ['Bake rot auf hell (Grafik)', FA.gefahrRot, FA.gefahrHell, 3], ['Beat offen auf Kachel (Grafik)', FA.beatOffen, FA.kachel, 2.5],
      ['HUD Titel auf Tisch', FA.hudTitel, FA.ink, 4.5], ['HUD Frist auf Tisch', FA.hudDim, FA.ink, 4.5],
    ];
    const rows = paare.map(([n, a, b, min]) => { const k = A.kontrast(a, b); return '<tr><td><span class="sw" style="background:' + a + '"></span><span class="sw" style="background:' + b + '"></span>' + n + '</td><td>' + a + ' / ' + b + '</td><td class="' + (k >= min ? 'ok' : 'bad') + '">' + k.toFixed(1) + ':1</td><td>Ziel ' + min + '</td></tr>'; });
    const el = document.getElementById('kTab'); if (el) el.innerHTML = '<table><tr><th>Paar</th><th>Werte</th><th>gemessen</th><th></th></tr>' + rows.join('') + '</table>';
  }

  let fehler = 0;
  Object.keys(ZUSTAENDE).forEach((k) => {
    const cv = document.getElementById('c-' + k); if (!cv) return;
    try { const c = cv.getContext('2d'); c.imageSmoothingEnabled = false; terminal(c, ZUSTAENDE[k]); } catch (e) { fehler++; console.error(k, e); }
  });
  try { const cv = document.getElementById('c-hud'); if (cv) flug(cv.getContext('2d')); } catch (e) { fehler++; console.error('hud', e); }
  kontrastTabelle();
  const st = document.getElementById('status'); if (st) st.textContent = fehler ? fehler + ' Fehler (Konsole)' : 'bereit';
  window.__fertig = !fehler;
})();
