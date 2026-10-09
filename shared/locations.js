// Orte der offenen Welt (CONTRACT-M1 §9.1). UMD: window.Shared_Locations / require. Seit B3 Team SEKTOR.
// Reine Daten: Sternkarte, Szenen (Welt-px der Raumszene), versteckte Objekte (nur per Weitscan).
// B3 (CONTRACT-B3 §0.1): Die Verbindungen (`links`, `LOCKED_LINKS`) werden aus content/welt/limes.json abgeleitet
// (shared/sektoren.js): open/locked-Kanten zwischen zwei Hexen mit Ort. API und Feldnamen bleiben.
// `get('leer-<hex>')` liefert die leere Leerraum-Szene (Sektoren.leerraumOrt).
// Der Server ist maßgeblich (bekannt/besucht/gefunden stehen im Snapshot unter world.locations).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./sektoren.js'));
  else root.Shared_Locations = factory(root.Shared_Sektoren || null);
})(typeof self !== 'undefined' ? self : this, function (Sektoren) {
  'use strict';

  // scene: w/h Szenengröße, arrive = Ankunft per Faltsprung, station = Hauptobjekt (Marker-kind = station.kind),
  //        dock = Liegeplatz (Dock-Ring, nur port/trader), beam = Außenkarte (Beamen ≤ range vom station-Punkt),
  //        asteroids = Anzahl Brocken (seeded), field = Bereich der Brocken.
  // hidden: kind 'cache' (drüberfliegen sammelt ein) | 'lore' (Ziel-Scan) | 'beacon' (Ziel-Scan, Mission) | 'hollow' (Wrack-Hohlraum).
  const LOCATIONS = [
    {
      id: 'hafen', name: 'Hafen Lichtkordon', kind: 'port', x: 100, y: 300, fog: false,
      desc: 'Heimathafen der Lerche: Liegeplatz, Hafenterminal und Tesks Funkturm. Riecht nach Öl und Kaffee.',
      first: 'Hafen Lichtkordon. Hier kennt man die Lerche – und ihre Schulden. Spaß beiseite: Liegeplatz rechts der Station.',
      scene: { w: 2000, h: 1400, start: { x: 700, y: 700, angle: 0 }, arrive: { x: 1650, y: 860, angle: 3.3 },
        station: { kind: 'station', x: 520, y: 700, r: 60 }, dock: { x: 700, y: 700 }, asteroids: 0 },
      hidden: [
        { id: 'hafen_cache', kind: 'cache', x: 1780, y: 220, name: 'Schmugglerkiste im Hafenschrott',
          reward: { marks: 30, items: { flickblech: 1 } }, text: 'Eine Schmugglerkiste, gut versteckt im Hafenschrott. Tesk muss das nicht wissen.' },
      ],
    },
    {
      id: 'splitter', name: 'Splittergürtel', kind: 'asteroids', x: 260, y: 220, fog: false,
      desc: 'Ein Gürtel aus Felsbrocken und Wrackteilen. Ehrliche Bergung – und unehrliche Rostmeute.',
      first: 'Der Splittergürtel. Brocken prallen ab, kosten aber Schild. Langsam ist auch eine Geschwindigkeit.',
      scene: { w: 3000, h: 1600, arrive: { x: 150, y: 800, angle: 0 }, asteroids: 38, field: { x0: 380, x1: 2880, y0: 80, y1: 1520 } },
      hidden: [
        { id: 'splitter_cache1', kind: 'cache', x: 1180, y: 160, name: 'Versiegelter Frachtcontainer',
          reward: { marks: 25, items: { ersatzteil: 1 } }, text: 'Ein versiegelter Frachtcontainer zwischen den Brocken. Inhalt: ein Ersatzteil, gut gepolstert.' },
        { id: 'splitter_cache2', kind: 'cache', x: 2560, y: 1460, name: 'Bergungsboje mit Notvorrat',
          reward: { marks: 40, items: { medipack: 1 } }, text: 'Eine alte Bergungsboje mit Notvorrat. Das Medipack ist abgelaufen – laut Etikett nur ein bisschen.' },
      ],
    },
    {
      id: 'b7', name: 'Boje B-7', kind: 'buoy', x: 420, y: 150, fog: false,
      desc: 'Navigationsboje mit Wartungsplattform. Seit Kurzem verstummt – und von Kustoden-Technik umgeben.',
      first: 'Boje B-7. Kein Leuchtfeuer, kein Funk. Die Plattform hat Transferpads – falls wir runter müssen.',
      scene: { w: 3000, h: 3000, arrive: { x: 500, y: 1500, angle: 0 }, station: { kind: 'buoy', x: 2000, y: 1500, r: 48 },
        beam: { map: 'platform', range: 320 }, asteroids: 0 },
      hidden: [
        { id: 'b7_cache', kind: 'cache', x: 2700, y: 450, name: 'Treibende Wartungskiste',
          reward: { marks: 30, items: { bolzen: 4 } }, text: 'Eine Wartungskiste von B-7, abgetrieben. Darin: Bolzen. Jemand hat hier mal ernsthaft geschraubt.' },
        // QA M1: mehr Entdeckungen je Ort
        { id: 'b7_fragment', kind: 'lore', x: 1500, y: 2300, name: 'Kustoden-Splitter',
          reward: { marks: 35 }, text: 'Ein Splitter aus Kustoden-Kristall, warm wie eine Hand. Er summt im selben Takt wie die Boje.' },
      ],
    },
    {
      id: 'vaelen', name: 'Vaelen-Karawane', kind: 'trader', x: 230, y: 430, fog: false,
      desc: 'Fahrende Händler mit Kristalllampen, Tee und guten Preisen für Bolzenwerfer. Andocken erlaubt.',
      first: 'Die Vaelen-Karawane! Andocken am Ring längsseits – das Hafenterminal zeigt dann ihr Sortiment.',
      scene: { w: 2200, h: 1600, arrive: { x: 300, y: 800, angle: 0 }, station: { kind: 'vaelen', x: 1300, y: 760, r: 90 },
        dock: { x: 1300, y: 930 }, asteroids: 0 },
      hidden: [
        { id: 'vaelen_cache', kind: 'cache', x: 2050, y: 160, name: 'Verlorenes Teepaket',
          reward: { marks: 20, deko: ['sternkarte'] }, text: 'Ein verlorenes Paket der Karawane: Tee und eine gerahmte Sternkarte. Sela lässt sie uns – als Finderlohn.' },
        // QA M1: Selas Messsonde (Mission 2, Schritt „sonde“) – scannbar, auch vorher schon auffindbar
        { id: 'vaelen_sonde', kind: 'lore', x: 150, y: 1500, name: 'Selas Messsonde',
          reward: { marks: 15 }, text: 'Selas Messsonde, stumm, aber heil. Ihr Speicher ist voll mit Nebelmessungen.' },
      ],
    },
    {
      id: 'wrack', name: 'Wrack „Zaunkönig“', kind: 'wreck', x: 400, y: 330, fog: false,
      desc: 'Ein zerbrochener Frachter. Plünderer waren schon da – aber nicht überall.',
      first: 'Das Wrack der „Zaunkönig“. Transferpads auf dem Vorderdeck sind noch intakt. Ein Weitscan zeigt vielleicht mehr.',
      scene: { w: 2600, h: 2000, arrive: { x: 300, y: 1000, angle: 0 }, station: { kind: 'wreck', x: 1600, y: 1000, r: 120 },
        beam: { map: 'wreck', range: 320 }, asteroids: 14, field: { x0: 700, x1: 2500, y0: 150, y1: 1850 } },
      hidden: [
        { id: 'wrack_hollow', kind: 'hollow', x: 1640, y: 1060, name: 'Hohlraum im Laderaum',
          reward: null, text: 'Hinter einer dünnen Wand im Laderaum liegt ein Hohlraum. Unten: E halten an der markierten Wand.' },
        // QA M1: Rettungskapsel der Zaunkönig (drüberfliegen)
        { id: 'wrack_kapsel', kind: 'cache', x: 2100, y: 1600, name: 'Rettungskapsel der Zaunkönig',
          reward: { marks: 35, items: { flickblech: 1 }, deko: ['buecherregal'] }, text: 'Eine leere Rettungskapsel der Zaunkönig. Die Crew kam davon – ihr Bücherregal nicht.' },
      ],
    },
    {
      id: 'nebel', name: 'Graue Weite', kind: 'nebula', x: 570, y: 280, fog: true,
      desc: 'Ein Nebel, der Sensoren schluckt. Wer hier etwas finden will, braucht Weitscan und Geduld.',
      first: 'Die Graue Weite. Sicht und Sensoren halbiert. Taktik: Weitscan (W) – hier versteckt sich gern etwas.',
      scene: { w: 3200, h: 2400, arrive: { x: 300, y: 1200, angle: 0 }, asteroids: 10, field: { x0: 700, x1: 3000, y0: 150, y1: 2250 } },
      hidden: [
        { id: 'nebel_beacon', kind: 'beacon', x: 2350, y: 650, name: 'Kustoden-Leitbake',
          reward: { marks: 40 }, text: 'Eine Kustoden-Leitbake. Ihr Signal zeigt auf ein Relais tief im Nebel.' },
        { id: 'nebel_lore', kind: 'lore', x: 1150, y: 1950, name: 'Stumme Lore-Bake',
          reward: { marks: 30 }, text: 'Eine alte Bake mit Logbuch: „Tag 41. Der Nebel singt. Wir singen zurück. Es hilft nicht.“' },
      ],
    },
    {
      id: 'relais', name: 'Kustoden-Relais', kind: 'relay', x: 730, y: 230, fog: true,
      desc: 'Ein Relais der Kustoden, bewacht von Pylonen. Hier endet das Echo – oder es beginnt.',
      first: 'Das Kustoden-Relais. Pylonen mit Frontschild – Taktik: scannen und den Piloten an die Seite lotsen.',
      scene: { w: 2600, h: 2000, arrive: { x: 300, y: 1000, angle: 0 }, station: { kind: 'relay', x: 1700, y: 1000, r: 70 }, asteroids: 0 },
      hidden: [
        { id: 'relais_lore', kind: 'lore', x: 2380, y: 260, name: 'Kustoden-Inschrift',
          reward: { marks: 40 }, text: 'Eine Inschrift im Relaisrumpf: „Wir hüten, bis jemand fragt.“ Wir haben gefragt. Oha.' },
      ],
    },
    {
      // M2 „Schildwall“ (CONTRACT-M2 §3.1): Planetenmission m3. Am Start unbekannt; Verbindungen gesperrt (Schlüssel 'kesh'),
      // bis die Mission den Ort aufdeckt – so bleibt die Sternkarte in M1/M2 unverändert (kein „Unbekanntes Signal“).
      id: 'kesh', name: 'Mond Kesh', kind: 'moon', x: 160, y: 120, fog: false,
      desc: 'Ein staubiger Mond mit einer Kustoden-Ruine. Plünderer graben dort seit Wochen.',
      first: 'Mond Kesh. Unten liegt ein Kustoden-Archiv – und ein Plünderercamp. Transferpads: Landezone im Südwesten.',
      scene: { w: 2400, h: 1800, arrive: { x: 300, y: 900, angle: 0 }, station: { kind: 'moon', x: 1500, y: 900, r: 180 },
        beam: { map: 'kesh', range: 360 }, asteroids: 0 },
      hidden: [],
    },
  ];

  // Verbindungen (aus limes.json abgeleitet). links: Nachbarorte über open/locked-Kanten, in der Reihenfolge von LOCATIONS.
  // LOCKED_LINKS: locked-Kanten zwischen zwei Orten (Kante -> Schlüssel). Server prüft game.world.linksOpen.
  const LOCKED_LINKS = [];
  const byId = {};
  for (const l of LOCATIONS) byId[l.id] = l;
  const ORDER = LOCATIONS.map((l) => l.id);
  let linkMap = {};
  function ableiten() {
    linkMap = {}; LOCKED_LINKS.length = 0;
    for (const l of LOCATIONS) linkMap[l.id] = [];
    const K = Sektoren && Sektoren.KARTE;
    if (!K) return;
    for (const e of K.kanten || []) {
      if (e.art !== 'open' && e.art !== 'locked') continue;
      const a = Sektoren.ortVonHex(e.a), b = Sektoren.ortVonHex(e.b);
      if (!byId[a] || !byId[b]) continue;
      if (!linkMap[a].includes(b)) linkMap[a].push(b);
      if (!linkMap[b].includes(a)) linkMap[b].push(a);
      if (e.art === 'locked' && e.key) LOCKED_LINKS.push({ a, b, key: e.key });
    }
    for (const id of ORDER) linkMap[id].sort((x, y) => ORDER.indexOf(x) - ORDER.indexOf(y));
  }
  for (const l of LOCATIONS) {
    Object.defineProperty(l, 'links', { enumerable: true, configurable: true, get() { return linkMap[l.id] || []; } });
    if (Sektoren && Sektoren.hexVonOrt) Object.defineProperty(l, 'hex', { enumerable: true, configurable: true, get() { return Sektoren.hexVonOrt(l.id); } });
  }
  ableiten();
  if (Sektoren && Sektoren.beiKarte) Sektoren.beiKarte(ableiten);

  function get(id) {
    if (byId[id]) return byId[id];
    if (Sektoren && Sektoren.istLeerId && Sektoren.istLeerId(id)) return Sektoren.leerraumOrt(Sektoren.hexVonOrt(id) || '') || null;
    return null;
  }
  function linkKey(a, b) { return [a, b].sort().join('-'); }
  function lockedKey(a, b) {
    const k = LOCKED_LINKS.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
    return k ? k.key : null;
  }
  function totalHidden() { return LOCATIONS.reduce((s, l) => s + l.hidden.length, 0); }

  return { LOCATIONS, LOCKED_LINKS, get, linkKey, lockedKey, totalHidden, START: 'hafen', KNOWN_AT_START: ['hafen', 'splitter'] };
});
