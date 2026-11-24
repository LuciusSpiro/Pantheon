// BOT-01 C3 (Vorgabe Designer, docs-bot01c-menue.md): Tokens des Befehlsmenüs der Bots am Captain-Pult: Maße, Zeiten, Farben, Texte, Plätze der Felder.
// Globales `PultBefehlTokens` (in Node als Modul, für tools/test-bot-menue.js). Nur Daten, keine Regeln, kein Zustand.
// Beschriftung kommt NIE von hier, sondern aus content/bots/kanon.json (Vertrag Bot-Befehle: Kanon als Quelle): Stufe 2 = anzeige mit {x} -> „…“, Stufe 3 = werte.<x>.<id>.wort.
// Hier stehen nur die Plätze (Feld -> Kanon-Eintrag bzw. Wert) und die wenigen Texte, die der Kanon nicht kennt (Rollennamen, Titel, Grundangaben).
//
// Schlüssel eines Kanon-Eintrags (kanon.schluessel in bot-menue.js): befehl, plus ':<arg>' bei einem Platzhalter ('nav.kurs:ziel') oder ':<arg>=<wert>' bei einem festen Wert
// ('ops.ziel:ziel=markiert', 'tech.energie:delta=1'); ein fester Wert hat Vorrang vor dem Platzhalter. Ohne Argumente nur der Befehl ('nav.abstand' vs. 'nav.abstand:ziel').
// Feldnamen = Rasterplatz Q W E / A S D / Y X C (Y ist KeyZ, die Kappe zeigt die Taste des Layouts).
// Regel: Farbwerte stehen nur zwischen „// <tokens>“ und „// </tokens>“ (tools/check-terminal-farben.js prüft diese Datei mit).
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PultBefehlTokens = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  // <tokens>
  const FARBE = {
    rolle: { navigation: 'nav', ops: 'weapon', technik: 'shield', bord: 'neutral', alle: 'cmd' },   // Schlüssel in Pult.FN
    titelRot: '#FF6B5E',        // roter TITEL-/Hinweistext (= PultSysteme zerText); FN.weapon nie als Schrift auf Dunkel (4,7:1)
    infoMisch: 0.15,            // Info rechts auf Farbfläche (rom): mix(ink, fn, 0.15), >= 5,9:1; auf weapon: ink (4,7:1)
    infoGermanen: 'fn',         // germanen: Info in der Funktionsfarbe auf der Platte (rot: titelRot, 5,6:1)
    quittung: { gesendet: 'neutral', aye: 'shield', nein: 'weapon', gesperrt: 'warn' },   // gesperrt: Direkttaste ohne Bot an der Rolle (Fläche warn, Schrift ink)
    sperrGrund: 'warn',
  };
  // </tokens>

  const MASS = {
    S: { ohneBots: 258, mitBots: 240 },
    tafel: { x: 62, y: 262, w: 572, h: 64, deckeRand: 2 },
    raster: { x: 62, y: 275, zw: 188, zh: 14, sx: 4, sy: 3, spalten: 3, reihen: 3, infoRechts: 5 },
    faenger: { x: 60, y: 261, w: 576, h: 65 },   // deckender Klickfänger über der ganzen Tafel (Titelzeile bis letzte Reihe): leere Felder und Lücken schlucken Klicks, der Reiter-Knopf darunter bleibt unberührt
    crew: { x: 62, y: 330, zw: 92, zh: 14, sx: 4, trenner: 327, trennerAlpha: 0.35 },
    einblendung: { deckung: 0.92 },   // Ego-Sitz, Blick VORN/CREW: Tafel und Crew-Zeile (y 261 bis 346) mit dieser Deckung über dem Bild
  };
  const ZEIT = { autoZu: 6000, frage: 3000, sperrGrund: 2000, warten: 3000, aye: 2000, nein: 4000, keineAntwort: 2000, ausstehend: 12000 };

  const FELDER = ['Q', 'W', 'E', 'A', 'S', 'D', 'Y', 'X', 'C'];   // Reihenfolge der 3x3-Zellen, Zeile für Zeile
  // Aktion in tasten.js je Feld (Gruppe captain, Bereich captain.befehl)
  const FELD_AKTION = { Q: 'captain.befehl.q', W: 'captain.befehl.w', E: 'captain.befehl.e', A: 'captain.befehl.a', S: 'captain.befehl.s', D: 'captain.befehl.d', Y: 'captain.befehl.y', X: 'captain.befehl.x', C: 'captain.befehl.c' };

  const TEXT = {
    titel: 'BEFEHL', trenner: ' · ', mehr: '…',
    rolle: { navigation: 'Navigation', ops: 'Ops', technik: 'Technik', bord: 'Bord', alle: 'Alle' },
    rolleName: { navigation: 'NAVIGATION', ops: 'OPS', technik: 'TECHNIK', bord: 'BORD', alle: 'ALLE' },   // Sprechername der Quittung und der Untertitel
    rolleKurz: { navigation: 'NAV', ops: 'OPS', technik: 'TECH', bord: 'BORD', alle: 'ALLE' },   // Quittung, wenn „NAVIGATION abgelehnt“ nicht in den Knopf (92 px) passt
    unbekannterSprecher: 'CREW',
    rechts: { stufe1: 'B / Esc schließt', sonst: 'B zurück · Esc zu', seite: 'R Seite {n}/{m} · {name}', seiteOhneName: 'R Seite {n}/{m}', frage: '{taste} nochmal = senden' },
    fussSprache: '{taste} halten und sagen, was hier steht: dieselben Befehle per Sprache',
    grund: { keinBot: 'kein Bot', mensch: 'Mensch an Station', aussen: 'nur Außenmission', keineBots: 'Keine Bots an Bord', laedt: 'Befehle werden geladen' },
    grundLang: { keinBot: 'Kein Bot an {rolle}', mensch: 'Ein Mensch sitzt an {rolle} – sag es ihm', aussen: 'Nur während der Außenmission', keineBots: 'Keine Bots an Bord' },   // {rolle}: rolleAn (Tooltip, Titelhinweis)
    rolleAn: { navigation: 'der Navigation', ops: 'Ops', technik: 'der Technik', bord: 'Bord', alle: 'Alle' },   // nach „an“ (Kein Bot an der Navigation)
    gilt: 'gilt',
    bots: { eins: '{n} Bot', mehr: '{n} Bots' },
    quittung: { gesendet: '{ROLLE} …', aye: '{ROLLE} aye', nein: '{ROLLE} abgelehnt', still: '{ROLLE} keine Antwort', gesperrt: '{ROLLE} gesperrt' },
    frage: { 'tech.ueberladen': 'Reaktor überladen?' }, frageInfo: 'nochmal {taste}',
    // Stufe-2-Name, wo der Kanon keinen hergibt (nav.schub hat als anzeige nur „{stufe}“)
    name2: { 'nav.schub:stufe': 'Schub …' },
    seiten: { 'tech.prio:ziel': ['', 'Waffen einzeln'], 'tech.reparieren:system': ['Hauptsysteme', 'Düsen und Emitter', 'Waffenplätze', 'Module'] },
    zustandBesch: 'besch.', zustandZer: 'zer.',
    befehleKnopf: 'Befehle',
    labelVorsatz: 'Bot: ',   // Suchname der Tafelfelder: kein Tafelfeld darf von consoles.js tryButton('Nächstes Ziel') / /^Scan/ getroffen werden
  };

  // Plätze: Feld -> Kanon-Eintrag. Reihenfolge nach Häufigkeit im Gefecht: Reihe 1 Reaktion, Reihe 2 Ausrichtung, Reihe 3 selten.
  const LAGE = {
    station: { navigation: 'helm', ops: 'weapons', technik: 'technik' },   // Rolle -> Konsole; sitzt dort ein Mensch, wartet der Bot
    stufe1: { Q: 'navigation', W: 'ops', E: 'technik', A: 'bord', S: 'alle' },
    stufe2: {
      navigation: { Q: 'nav.stopp', W: 'nav.ausweichen', E: 'nav.schub:stufe', A: 'nav.kurs:ziel', S: 'nav.abstand', D: 'nav.abstand:ziel', Y: 'nav.andocken' },
      ops: { Q: 'ops.feuer_frei', W: 'ops.feuer_halt', E: 'ops.feuer_frei:waffen', A: 'ops.ziel:ziel=naechstes', S: 'ops.ziel:ziel=markiert', D: 'ops.scan', Y: 'ops.landescan', X: 'ops.beamen:was' },
      technik: { Q: 'tech.schild:sektor', W: 'tech.energie:delta=1', E: 'tech.energie:delta=-1', A: 'tech.reparieren:system', S: 'tech.prio:ziel', D: 'tech.ueberladen' },
      bord: { Q: 'bord.sensor', W: 'bord.kuppel', E: 'bord.rueckholen' },
      alle: { Q: 'bot.status', W: 'bot.automatik' },
    },
    // Stufe 3: Feld -> Wert-Id (Kanon werte.<arg>); ein Array sind Seiten (R blättert)
    stufe3: {
      'nav.kurs:ziel': { Q: 'marke', W: 'ziel', E: 'basis' },
      'nav.abstand:ziel': { Q: 'marke', W: 'ziel', E: 'basis' },
      'nav.schub:stufe': { Q: 'voll', W: 'halb', E: '0', A: '1', S: '2', D: '3', Y: '4', X: '5', C: '6' },
      'ops.feuer_frei:waffen': { W: 'bug', A: 'bb', D: 'stb', X: 'torpedo', S: 'alle' },   // Kompass-Regel: W Bug, A Backbord, D Steuerbord, X Heck/Torpedo, S Mitte
      'ops.beamen:was': { Q: 'person', W: 'fracht' },
      'tech.schild:sektor': { W: 'bug', A: 'bb', D: 'stb', X: 'heck' },
      'tech.energie:delta=1': { Q: 'engines', W: 'shields', E: 'weapons' },
      'tech.energie:delta=-1': { Q: 'engines', W: 'shields', E: 'weapons' },
      'tech.prio:ziel': [
        { Q: 'feuer', W: 'leck', A: 'reactor', S: 'engines', D: 'shields', Y: 'transfer', X: 'weapons' },
        { W: 'weapon_bow', A: 'battery_port', D: 'battery_stbd' },
      ],
      'tech.reparieren:system': [
        { Q: 'reactor', W: 'engines', E: 'shields', A: 'transfer', S: 'weapons' },
        { W: 'emitter_bow', A: 'emitter_port', D: 'emitter_stbd', X: 'emitter_aft', Y: 'thruster_port', C: 'thruster_stbd' },
        { Q: 'lafette_7', W: 'weapon_bow', E: 'lafette_9', A: 'battery_port', S: 'lafette_5', D: 'battery_stbd', Y: 'lafette_1', X: 'lafette_2', C: 'lafette_3' },
        { Q: 'modul_1', W: 'modul_2', E: 'modul_3', A: 'modul_4' },
      ],
    },
    // Direkttasten (Aktion in tasten.js) -> Kanon-Eintrag; Reihenfolge = Crew-Zeile nach dem Knopf „Befehle“. Text = kürzeste Form aus dem Kanon (anzeige oder kurz).
    direkt: [
      { aktion: 'captain.bot.stopp', key: 'nav.stopp', fn: 'weapon' },
      { aktion: 'captain.bot.ausweichen', key: 'nav.ausweichen', fn: 'drive' },
      { aktion: 'captain.bot.feuerFrei', key: 'ops.feuer_frei', fn: 'weapon' },
      { aktion: 'captain.bot.feuerHalt', key: 'ops.feuer_halt', fn: 'weapon' },
      { aktion: 'captain.bot.status', key: 'bot.status', fn: 'sensor' },
    ],
  };

  // Funktionsfarbe je Befehl (Schlüssel in Pult.FN): derselbe Befehl sieht an jedem Pult gleich aus
  const FN_BEFEHL = {
    'nav.kurs': 'nav', 'nav.stopp': 'weapon', 'nav.schub': 'drive', 'nav.ausweichen': 'drive', 'nav.abstand': 'nav', 'nav.andocken': 'nav',
    'ops.ziel': 'sensor', 'ops.feuer_frei': 'weapon', 'ops.feuer_halt': 'weapon', 'ops.scan': 'sensor', 'ops.landescan': 'sensor', 'ops.beamen': 'neutral',
    'tech.prio': 'neutral', 'tech.reparieren': 'neutral', 'tech.schild': 'shield', 'tech.energie': 'shield', 'tech.ueberladen': 'weapon',
    'bord.rueckholen': 'neutral', 'bord.sensor': 'sensor', 'bord.kuppel': 'shield',
    'bot.status': 'sensor', 'bot.automatik': 'cmd',
  };

  return { FARBE, MASS, ZEIT, FELDER, FELD_AKTION, TEXT, LAGE, FN_BEFEHL };
});
