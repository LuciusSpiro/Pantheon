// PAN-01 C: Schiffskatalog – Waffen, Bestückung, Gegner-Abbildung, Module je Klasse. Datengetrieben: Server (server/sim/schiffswaffen.js, space.js),
// Client (Konsolen, Pult, Taktik, Ziel-Scan), Gegner (space.js bestueckung) und später das Terminal (Paket D) lesen dieselben Einträge.
// UMD: window.Shared_Schiffskatalog bzw. require. Keine Abhängigkeiten.
//
// Leitgedanke (Auftrag PAN-01): Mehr Plätze heißen mehr Auswahl, nicht mehr Feuerkraft. Alle Energiewaffen teilen sich den Ladepool (Energie + 2 Punkte,
// verteilt per weapons.alloc); der Torpedowerfer liegt außerhalb. Schaden und Balance stehen nur hier (keine Zahlen-Upgrades).
//
// Felder je Waffe (WAFFEN[]):
//   id, name, kurz (Beschriftung Pult/Taktik, ≤ 8 Zeichen), platzart ('seite' | 'bug' | 'heck'), wirkung (Kurztext), energie (true = Ladepool),
//   art (Verhalten auf der Lerche: 'salve' = Rohre im Takt (Strahl/Granate), 'lanze' = aufladen und halten, 'torpedo', 'turm' = Nahabwehr),
//   schaden (je Rohr/Treffer; Torpedo: Tabelle je Zielklasse), rohre (Rohre/Granaten je Salve), salvoGap, ladekosten (Sekunden je Ladepunkt für 0 → 1),
//   cooldown (nur Torpedo), bogen (Grad), reichweite (px), modell (Lafettenmodell: Voxelwerk lerche/station/lafette), projektil { form, farbe },
//   effekt, ton (audio.js-Name), symbol (Pixel-Maske 10×10, SYMBOLE), munition (null | 'torpedo'), stoss (Anfangsstoß: gespeicherter Schaden bei voller Ladung,
//   Grundlage des Magazindeckels), gegner { verhalten }.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared_Schiffskatalog = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- Plätze (Ziffernblock: 7 8 9 / 4 5 6 / 1 2 3, wie das Schiff: 7/4/1 Backbord, 9/6/3 Steuerbord, 8/5 vorn, 2 Heck) ----------
  // Mount-Ids: die drei Startplätze behalten ihre Altnamen (bow = 8, port = 4, stbd = 6), die übrigen heißen p<Platz>.
  const MOUNT_ID = { 8: 'bow', 4: 'port', 6: 'stbd', 5: 'p5', 7: 'p7', 9: 'p9', 1: 'p1', 3: 'p3', 2: 'p2' };
  const PLATZ_VON_ID = { bow: 8, port: 4, stbd: 6, p5: 5, p7: 7, p9: 9, p1: 1, p3: 3, p2: 2 };
  // Reihenfolge für die Standardverteilung des Ladepools (reihum): Bug, die Startseiten, dann Bug 2, Seiten paarweise vorn nach hinten, zuletzt Heck
  const PRIORITAET = ['bow', 'port', 'stbd', 'p5', 'p7', 'p9', 'p1', 'p3', 'p2'];
  const PLATZ = {
    8: { art: 'bug', facing: 0, seite: 'vorn' }, 5: { art: 'bug', facing: 0, seite: 'vorn' },
    4: { art: 'seite', facing: -90, seite: 'Bb' }, 7: { art: 'seite', facing: -90, seite: 'Bb' }, 1: { art: 'seite', facing: -90, seite: 'Bb' },
    6: { art: 'seite', facing: 90, seite: 'Stb' }, 9: { art: 'seite', facing: 90, seite: 'Stb' }, 3: { art: 'seite', facing: 90, seite: 'Stb' },
    2: { art: 'heck', facing: 180, seite: 'Heck' },
  };
  // Start-Lerche: Lanze am Bug, je eine Standardbatterie an den Seiten (Altstände und Stufe 0 laden damit ohne Verlust)
  const START_BESTUECKUNG = { 8: 'lanze', 4: 'standardbatterie', 6: 'standardbatterie' };

  // ---------- Magazindeckel ----------
  // Dauerfeuer ist Pool × ~0,47 Schaden/s, unabhängig von der Zahl der Halterungen; nur der Anfangsstoß (gespeicherte volle Ladungen) wächst mit der Zahl.
  // stossMax = Summe der gespeicherten Ladungen (Bereitschaft × Waffe.stoss) aller Energiewaffen, höchstens so viel: 1,5 × Start-Lerche (Lanze 12 + 2 × 6 = 24).
  // Bis 3 Waffen (Start) greift er nie (24 < 36), danach füllt sich der Vorrat nicht über 36.
  const MAGAZINDECKEL = { stossStart: 24, faktor: 1.5, stossMax: 36 };

  // ---------- Torpedo ----------
  // Lager: hartes Limit (Kauf und Fund bis dahin), Start 6. Cooldown = Ladeintervall des Werfers (kein Befehl R, keine Energie, fällt nicht mit dem Triebwerk aus).
  // Schaden je Zielklasse (keine Schilde: der Torpedo trifft die Hülle). Jäger sofort zerstört (Hülle 25 zu dritt, 35 im Höchstfall), alles Größere angeschlagen.
  // Gegner-Torpedo gegen die Lerche: wirkt nur bei Schild 0 im getroffenen Sektor (Lesart B, wie beim Torpedo der Lerche), dann 30 von 100 Hülle (6 Schadenspunkte × 5), nie mehr als ein Drittel (kein Game Over durch einen Schuss).
  const TORPEDO = {
    lagerMax: 12, lagerStart: 6, cooldown: 10, kaputtFaktor: 1.5,
    // Schildverhalten (Kai 2026-10-18, Lesart B für alle Ziele): 'nur-ohne-schild' = der Torpedo wirkt nur auf ein ausgefallenes Schildsegment (Schild 0), an einem stehenden Schild prallt er ab
    // (Schaden 0, kein Schildabzug); 'immer' = er ginge an Schilden vorbei (Lesart A, nur noch Testschalter).
    schildUmgehung: 'nur-ohne-schild',
    geschw: 400, wenden: 1.6, ttl: 3,
    schaden: { raider: 45, korvette: 9, fregatte: 9, kreuzer: 9, sentinel: 9, pylon: 9, frachter: 9, relay: 9 },
    gegenLerche: 6, gegnerGeschw: 150, gegnerWenden: 0.9, gegnerTtl: 6, huelleJePunkt: 5,
  };

  // ---------- Waffen ----------
  const WAFFEN = [
    {
      id: 'standardbatterie', name: 'Standardbatterie', kurz: 'STANDARD', platzart: 'seite', energie: true, art: 'salve',
      wirkung: 'Salve aus vier Rohren, kontinuierliches Feuer, der Allrounder.',
      schaden: 2, rohre: 4, salvoGap: 0.15, ladekosten: 12.3, bogen: 70, reichweite: 520, stoss: 6,
      modell: 'lerche/station/lafette_batterie', projektil: { form: 'doppelbolzen', kind: 'pbatterie', farbe: '#F2C14E' }, geschw: 450, streuung: 0.012, effekt: 'doppelbolzen', ton: 'battery_salvo', symbol: 'schiff_batterie',
      munition: null, gegner: { verhalten: 'batterie' },
    },
    {
      id: 'sturmbatterie', name: 'Sturmbatterie', kurz: 'STURM', platzart: 'seite', energie: true, art: 'salve',
      wirkung: 'Unterdrückung: kaum Schildschaden, aber der Schild regeneriert nicht; bei niedrigem Schild Systemschaden.',
      schaden: 0.7, rohre: 8, salvoGap: 0.07, ladekosten: 10, bogen: 60, reichweite: 440, stoss: 4.8,
      // sturm: schildFaktor = Anteil des Schadens, der den Schild trifft (Rest verpufft); regenSperre = s ohne Schildregeneration nach einem Treffer;
      // niedrig = Schildstand (Punkte) des getroffenen Segments, ab dem Treffer in die Hülle gehen; stoerung = s, um die der nächste Schuss eines Gegner-Ziels zurückgeworfen wird; systemChance = Systemtreffer-Chance je Nadel gegen die Lerche bei niedrigem Schild
      sturm: { schildFaktor: 0.25, regenSperre: 6, niedrig: 1, stoerung: 0.35, systemChance: 0.08 },
      modell: 'lerche/station/lafette_sturm', projektil: { form: 'nadel', kind: 'psturm', farbe: '#7FD6C8' }, geschw: 800, streuung: 0.02, effekt: 'nadel', ton: 'sturm_salvo', symbol: 'schiff_sturm',
      munition: null, gegner: { verhalten: 'sturm' },
    },
    {
      id: 'streubatterie', name: 'Streubatterie', kurz: 'STREU', platzart: 'seite', energie: true, art: 'salve',
      wirkung: 'Granaten, die verzögert explodieren: eine = Schildschaden, zwei = sicherer Systemschaden.',
      schaden: 2, rohre: 3, salvoGap: 0.4, ladekosten: 12, bogen: 70, reichweite: 480, stoss: 6,
      // streu: zuend = s bis zur Explosion, radius = Wirkradius (px), geschw = Flug (px/s), schildFaktor = Schildpunkte je Schadenspunkt,
      // fenster = s, in denen zwei Explosionen auf dasselbe Ziel als „zwei“ zählen, durchschlag = Hüllenschaden der zweiten (ohne Schild, sicher)
      streu: { zuend: 1.4, radius: 70, geschw: 150, schildFaktor: 1.5, fenster: 2, durchschlag: 3 },
      modell: 'lerche/station/lafette_streu', projektil: { form: 'granate', kind: 'streu', farbe: '#E0873C' }, effekt: 'granate', ton: 'streu_wurf', symbol: 'schiff_streu',
      munition: null, gegner: { verhalten: 'streu' },
    },
    {
      id: 'lanzenbatterie', name: 'Lanzenbatterie', kurz: 'LANZ-BT', platzart: 'seite', energie: true, art: 'lanze',
      wirkung: 'Wie die Bug-Lanze: aufladen, Kurs halten. Optisch zwei Lanzen, Schaden einmal.',
      schaden: 12, rohre: 1, ladekosten: 18.5, bogen: 16, reichweite: 650, stoss: 12,
      lanze: { aufladen: 2.3, min: 3, max: 12, breite: 10, strahlen: 2, abstand: 7, pierce: 2 },
      modell: 'lerche/station/lafette_lanzen', projektil: { form: 'doppelstrahl', strahl: true, farbe: '#FFF1B8' }, effekt: 'doppelstrahl', ton: 'lance_fire', symbol: 'schiff_lanzenbatterie',
      munition: null, gegner: { verhalten: 'lanze' },
    },
    {
      id: 'lanze', name: 'Lanze', kurz: 'LANZE', platzart: 'bug', energie: true, art: 'lanze',
      wirkung: 'Aufladen, Kurs halten: der gehaltene Strahl trifft den ersten Gegner in der Linie.',
      schaden: 12, rohre: 1, ladekosten: 18.5, bogen: 16, reichweite: 650, stoss: 12,
      lanze: { aufladen: 2.3, min: 3, max: 12, breite: 10, strahlen: 1, abstand: 0, pierce: 2 },
      modell: 'lerche/station/lafette_lanze_bug', projektil: { form: 'strahl', strahl: true, farbe: '#FFF1B8' }, effekt: 'lanzenstrahl', ton: 'lance_fire', symbol: 'schiff_lanze',
      munition: null, gegner: { verhalten: 'lanze' },
    },
    {
      id: 'standardkanone', name: 'Standardkanone', kurz: 'KANONE', platzart: 'bug', energie: true, art: 'salve',
      wirkung: 'Wie die Standardbatterie, aber nach vorn: drei Rohre, enger Bogen.',
      schaden: 2, rohre: 3, salvoGap: 0.15, ladekosten: 9.2, bogen: 50, reichweite: 560, stoss: 4.5,
      modell: 'lerche/station/lafette_kanone', projektil: { form: 'bolzen', kind: 'pkanone', farbe: '#FF7A3C' }, geschw: 520, streuung: 0.008, effekt: 'bolzen', ton: 'kanone_salvo', symbol: 'schiff_kanone',
      munition: null, gegner: { verhalten: 'bolzen' },
    },
    {
      id: 'torpedowerfer', name: 'Torpedowerfer', kurz: 'TORPEDO', platzart: 'heck', energie: false, art: 'torpedo',
      wirkung: 'Torpedos nach achtern, kein Schildschaden: trifft die Hülle (Jäger sofort zerstört), Munition aus dem Lager, eigener Cooldown.',
      schaden: TORPEDO.schaden, rohre: 1, cooldown: TORPEDO.cooldown, bogen: 60, reichweite: 650, stoss: 0,   // Heckbogen 60 Grad: Messung PAN-01 C (Arena-Bot, Lager 12) zeigt keinen Nutzen von 90 Grad, der enge Bogen bleibt das Gegengewicht
      modell: 'lerche/station/lafette_torpedo', projektil: { form: 'torpedo', kind: 'torpedo', farbe: '#E9A23B' }, effekt: 'torpedo', ton: 'torpedo', symbol: 'schiff_torpedo',
      munition: 'torpedo', gegner: { verhalten: 'torpedo' },
    },
    {
      id: 'abwehrturm', name: 'Abwehrturm', kurz: 'ABWEHR', platzart: 'heck', energie: true, art: 'turm',
      wirkung: 'Nahabwehr: dreht sich selbst, schießt auf Jäger im Überflug und auf anfliegende Torpedos; unbesetzt schwach automatisch.',
      schaden: 1.2, rohre: 2, salvoGap: 0.12, ladekosten: 7, bogen: 360, reichweite: 260, stoss: 2.4,
      // turm: ziele = Klassen, die er bekämpft (nicht die großen Schiffe), autoFaktor = Ladezeit-Faktor ohne Besetzung (Taktik), torpedos = schießt Torpedos ab
      turm: { ziele: ['raider'], autoFaktor: 2, torpedos: true },
      modell: 'lerche/station/lafette_abwehr', projektil: { form: 'funke', kind: 'pfunke', farbe: '#A9D6E5' }, geschw: 700, streuung: 0.01, effekt: 'funke', ton: 'abwehr_feuer', symbol: 'schiff_abwehrturm',
      munition: null, gegner: { verhalten: 'abwehr' },
    },
  ];
  // Tabellen ohne Prototyp und Abfragen über eigene Schlüssel: Ids wie „constructor“, „__proto__“ oder „toString“ aus Befehlen und Weltständen sind keine Treffer (PAN-01 D Review H1)
  const own = (o, k) => typeof k !== 'object' && Object.prototype.hasOwnProperty.call(o, k);
  const BY_ID = Object.create(null); for (const w of WAFFEN) BY_ID[w.id] = w;

  // ---------- Taktik-Symbole (Pixel-Masken 10×10, Format wie IconsB: '#' Hauptfarbe · '+' hell · 'o' dunkel · 'w' Akzent) ----------
  const SYMBOLE = {
    schiff_batterie: ['..........', '.#.#.#.#..', '.#.#.#.#..', '.#+#+#+#w.', '.#+#+#+#ww', '.#+#+#+#w.', '.#.#.#.#..', '.######...', '..........', '..........'],
    schiff_sturm: ['..........', '#w.#w.#w..', '.#w.#w.#w.', '#w.#w.#w..', '.#w.#w.#w.', '#w.#w.#w..', '..........', '.########.', '.#++++++#.', '..........'],
    schiff_streu: ['..........', '..w...w...', '.www.www..', '..w...w...', '....w.....', '...www....', '....w.....', '.########.', '.#++++++#.', '..........'],
    schiff_lanzenbatterie: ['..........', '#########w', '#+++++++#.', '#########w', '..........', '#########w', '#+++++++#.', '#########w', '..........', '..........'],
    schiff_lanze: ['..........', '..........', '..........', '#########w', '##++++++#.', '#.#o#.....', '..........', '..........', '..........', '..........'],
    schiff_kanone: ['..........', '..........', '.#######..', '.#++++++##', '.#++++++#w', '.#++++++##', '.#######..', '..##......', '.####.....', '..........'],
    schiff_torpedo: ['..........', '..........', '...####...', '.##++++##.', '#+++++++#w', '.##++++##.', '...####...', '..........', '..........', '..........'],
    schiff_abwehrturm: ['....w.....', '..w.w.w...', '...###....', 'w.#+++#.w.', '..#+o+#...', 'w.#+++#.w.', '...###....', '..w.w.w...', '....w.....', '..........'],
  };

  // ---------- Gegner aus demselben Katalog ----------
  // Die Zufallsbestückung der Gegner (CONFIG.korvetteWaffen: lanze | batterie | bolzen) wird auf Katalogeinträge abgebildet; das Verhalten bleibt das heutige
  // (Golden-Stabilität): lanze = angekündigter schwerer Treffer, batterie = Sperrfeuer-Salve, bolzen = einzelner Schuss. e.waffen[platz] hält die Altart oder eine
  // Katalog-Id (nur gezielt: Labor, Spielleiter, Regiebuch: spawn waffen { bug: 'torpedowerfer' }); eintragVon liefert den Katalogeintrag für Anzeige und Ziel-Scan:
  //   lanze    -> Lanze (Bug) bzw. Lanzenbatterie (Seite)
  //   batterie -> Standardkanone (Bug) bzw. Standardbatterie (Seite), Sperrfeuer-Salve
  //   bolzen   -> Standardkanone (Bug) bzw. Standardbatterie (Seite), einzelner gezielter Schuss (der Gegner-Bolzen hat nie Schild- oder Energiebezug gehabt;
  //               Katalogwert der Kanone/Batterie für die Lerche gilt dort nicht, der Gegner-Schaden steht in CONFIG.enemies)
  // Der Torpedowerfer ist für Gegner nie Zufall: nur wer ihn ausdrücklich trägt, schießt Torpedos (Schaden gegen die Lerche: TORPEDO.gegenLerche).
  const LEGACY = { lanze: { bug: 'lanze', seite: 'lanzenbatterie', verhalten: 'lanze' }, batterie: { bug: 'standardkanone', seite: 'standardbatterie', verhalten: 'batterie' },
    bolzen: { bug: 'standardkanone', seite: 'standardbatterie', verhalten: 'bolzen' } };
  // Platzart eines Gegner-Platzes aus dem Namen (bug, bug2 = Bug; stbd, bb, stbd1… = Seite)
  function platzartGegner(platz) { return /^bug/.test(String(platz)) ? 'bug' : /^heck/.test(String(platz)) ? 'heck' : 'seite'; }
  // Altart (lanze | batterie | bolzen) oder Katalog-Id -> Katalogeintrag für diesen Gegner-Platz (null = unbekannt)
  function eintragVon(wert, platz) {
    const m = own(LEGACY, wert) ? LEGACY[wert] : null;
    if (m) return BY_ID[platzartGegner(platz) === 'bug' ? m.bug : m.seite] || null;
    return BY_ID[wert] || null;
  }
  // Verhalten eines Gegner-Eintrags: 'lanze' | 'batterie' | 'bolzen' | 'sturm' | 'streu' | 'torpedo' | 'abwehr' (null = unbekannt)
  function verhaltenVon(wert) {
    if (own(LEGACY, wert)) return LEGACY[wert].verhalten;
    const w = BY_ID[wert]; return w && w.gegner ? w.gegner.verhalten : null;
  }
  // gültiger Wert in e.waffen (Altart oder Katalog-Id)?
  const gegnerWert = (v) => !!(own(LEGACY, v) || BY_ID[v]);
  // Waffen, die ein Gegner im Zufallswurf tragen darf (CONFIG.korvetteWaffen): nur die drei Altarten, alles andere ist Absicht
  const GEGNER_ZUFALL = ['lanze', 'batterie', 'bolzen'];

  // ---------- Module je Klasse (Ziel-Scan zeigt sie) ----------
  // Klein und sinnvoll: wer Personal und Fracht trägt, hat Module. Jäger, Wächter, Pylon, Relais tragen keine. Ein Spielleiter-Gegner darf e.module überschreiben.
  const MODULE_JE_KLASSE = {
    raider: [], korvette: ['werkstatt'], fregatte: ['krankenstation', 'werkstatt'], kreuzer: ['krankenstation', 'werkstatt', 'frachtraum'],
    frachter: ['frachtraum', 'frachtraum'], sentinel: [], pylon: [], relay: [],
  };
  const MODUL_NAMEN = { frachtraum: 'Frachtraum', krankenstation: 'Krankenstation', werkstatt: 'Werkstatt' };
  // PAN-01 D: Wirkung je Modul in einem Satz (Terminal, Ziel-Scan); jedes laufende Modul zieht 1 Energie (CONFIG.module.energie). Preise: CONFIG.werft.preise (nicht im Katalog).
  const MODUL_WIRKUNG = {
    frachtraum: 'Zwei Frachtplätze für Waren und Personen; ohne Strom ist die Ladung ungesichert.',
    krankenstation: 'Notrückholung: holt Ausgeschaltete an Bord, danach ist der Transfer zu reparieren.',
    werkstatt: 'Ein zweiter Schrauber repariert mit.',
  };

  // ---------- Hilfen ----------
  const waffe = (id) => BY_ID[id] || null;
  const platzArt = (platz) => (own(PLATZ, platz) ? PLATZ[platz].art : null);
  const mountId = (platz) => (own(MOUNT_ID, platz) ? MOUNT_ID[platz] : null);
  const platzVonMount = (id) => (own(PLATZ_VON_ID, id) ? PLATZ_VON_ID[id] : null);
  // darf diese Waffe auf diesen Platz? (Platzart gleich)
  const passtAuf = (id, platz) => { const w = BY_ID[id]; return !!w && own(PLATZ, platz) && w.platzart === PLATZ[platz].art; };
  const fuerPlatzart = (art) => WAFFEN.filter((w) => w.platzart === art);
  // Torpedo-Schaden gegen eine Zielklasse (Schadenspunkte); die Lerche trägt gegenLerche
  const torpedoSchaden = (kind) => (kind === 'lerche' ? TORPEDO.gegenLerche : (TORPEDO.schaden[kind] != null ? TORPEDO.schaden[kind] : 9));
  // Volley einer Waffe (Schaden einer vollen Salve bzw. Lanze bei voller Aufladung)
  const volley = (id) => { const w = BY_ID[id]; return w ? w.stoss : 0; };
  const moduleFuerKlasse = (kind) => (own(MODULE_JE_KLASSE, kind) ? MODULE_JE_KLASSE[kind] : []).slice();

  return { WAFFEN, BY_ID, SYMBOLE, MOUNT_ID, PLATZ_VON_ID, PRIORITAET, PLATZ, START_BESTUECKUNG, MAGAZINDECKEL, TORPEDO, GEGNER_ZUFALL, MODULE_JE_KLASSE, MODUL_NAMEN, MODUL_WIRKUNG,
    waffe, platzArt, mountId, platzVonMount, passtAuf, fuerPlatzart, torpedoSchaden, volley, moduleFuerKlasse, eintragVon, gegnerWert, verhaltenVon, platzartGegner, LEGACY };
});
