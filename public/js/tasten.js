// Tastenbelegung der Konsolen als Daten (Kai: „im Menü die Belegung anpassen“).
// Eine Aktion hat eine id, eine Gruppe (Konsole oder 'allgemein'), einen Namen und Standardtasten.
// Taste = KeyboardEvent.code, optional mit 'Shift+' davor ('KeyA', 'Shift+KeyA', 'Numpad8', 'Space').
// Shift muss exakt passen: 'KeyA' passt nicht bei gedrückter Shift-Taste, 'Shift+KeyA' nur mit Shift.
// Abweichungen von std liegen in localStorage unter 'pantheon.tasten' (nur die Abweichungen).
//
// Bereiche: Viele Tasten gelten nur in einer Lage (Captain-Reiter, Frachtanzeige, Entschlüsseln). Doppelte
// Belegungen zählen nur innerhalb eines Bereichs als Konflikt. Aktionen ohne Bereich ('') gelten in der ganzen
// Gruppe und werden mit jedem Bereich zusammen geprüft – außer der Bereich hat Vorrang (die Konsole prüft ihn
// zuerst, er schluckt dann gleiche Tasten bewusst, z. B. Entschlüsseln A/D vor der Ladepunkt-Zuteilung).
(function () {
  'use strict';

  const SPEICHER = 'pantheon.tasten';

  const GRUPPEN = [
    { id: 'steuer', name: 'Steuer' },
    { id: 'ops', name: 'Ops' },
    { id: 'technik', name: 'Technik' },
    { id: 'captain', name: 'Captain' },
    { id: 'allgemein', name: 'Allgemein' },
  ];

  // Bereichsnamen fürs Menü; vorrang = wird in Consoles.keyDown vor den übrigen Tasten der Gruppe geprüft
  const BEREICHE = {
    'ops.fracht': { name: 'Frachtanzeige offen', vorrang: true },
    'ops.entschl': { name: 'Signal entschlüsseln', vorrang: true },
    'ops.glyphen': { name: 'Glyphenfeld', vorrang: true },
    'captain.karte': { name: 'Karte sichtbar (Sternkarte, Sektorplan)', vorrang: true },
    'captain.funk': { name: 'Reiter Funk' },
    'captain.stern': { name: 'Reiter Sternkarte' },
    'captain.lage': { name: 'Reiter Lage' },
    'captain.aussen': { name: 'Reiter Außenteam' },
    'captain.plan': { name: 'Reiter Sektorplan' },
    'captain.notruf': { name: 'Reiter Notrufe' },
    'technik.energie': { name: 'Reiter Energie & Schilde' },
    'technik.schaden': { name: 'Reiter Schadensplan' },
  };

  const NUM = (n) => ['Numpad' + n, 'Digit' + n];
  const A = (id, gruppe, name, std, bereich) => ({ id, gruppe, name, std, bereich: bereich || '' });

  const AKTIONEN = [
    // ------------------------------------------------------------ Allgemein (an jeder Konsole)
    A('allgemein.station', 'allgemein', 'Nächste Station', ['Tab']),
    A('allgemein.stationZurueck', 'allgemein', 'Vorige Station', ['Shift+Tab']),
    A('allgemein.verlassen', 'allgemein', 'Konsole verlassen', ['Escape']),
    // '?' liegt auf deutscher Tastatur auf Shift+ß (code Minus), auf US auf Shift+/ (code Slash)
    A('allgemein.hilfe', 'allgemein', 'Hilfe', ['Shift+Minus', 'Shift+Slash']),

    // ------------------------------------------------------------ Steuer (helm)
    A('steuer.ruderBb', 'steuer', 'Ruder Backbord (halten)', ['KeyA', 'ArrowLeft']),
    A('steuer.ruderStb', 'steuer', 'Ruder Steuerbord (halten)', ['KeyD', 'ArrowRight']),
    A('steuer.schneller', 'steuer', 'Temporegler eine Stufe hoch', ['KeyW', 'ArrowUp']),
    A('steuer.langsamer', 'steuer', 'Temporegler eine Stufe runter', ['KeyS', 'ArrowDown']),
    A('steuer.ausweichenBb', 'steuer', 'Ausweichrolle Backbord', ['Shift+KeyA', 'Shift+ArrowLeft']),
    A('steuer.ausweichenStb', 'steuer', 'Ausweichrolle Steuerbord', ['Shift+KeyD', 'Shift+ArrowRight']),
    A('steuer.allstopp', 'steuer', 'Allstopp', ['KeyX']),
    A('steuer.faltsprung', 'steuer', 'Faltsprung', ['KeyF']),
    A('steuer.schnellsprung', 'steuer', 'Schnellsprung', ['KeyG']),
    A('steuer.notsprung', 'steuer', 'Notsprung (fragt nach)', ['KeyN']),
    A('steuer.notsprungJa', 'steuer', 'Notsprung bestätigen', ['KeyJ', 'Enter', 'NumpadEnter']),

    // ------------------------------------------------------------ Ops (weapons)
    A('ops.ziel', 'ops', 'Nächstes Ziel', ['KeyT']),
    A('ops.waffeZurueck', 'ops', 'Vorige Energiewaffe wählen', ['KeyQ']),
    A('ops.waffeVor', 'ops', 'Nächste Energiewaffe wählen', ['KeyE']),
    A('ops.ladenWeniger', 'ops', 'Ladepunkte − (gewählte Waffe)', ['KeyA']),
    A('ops.ladenMehr', 'ops', 'Ladepunkte + (gewählte Waffe)', ['KeyD']),
    A('ops.waffe.vorn1', 'ops', 'Frontwaffe 1 (Platz 8; Lanze: halten lädt)', NUM(8)),
    A('ops.waffe.vorn2', 'ops', 'Frontwaffe 2 (Platz 5)', NUM(5)),
    A('ops.waffe.heck', 'ops', 'Heckwaffe (Platz 2: Torpedowerfer)', NUM(2)),
    A('ops.waffe.bb1', 'ops', 'Backbord 1 (Platz 4)', NUM(4)),
    A('ops.waffe.stb1', 'ops', 'Steuerbord 1 (Platz 6)', NUM(6)),
    A('ops.waffe.bb2', 'ops', 'Backbord 2 (Platz 7)', NUM(7)),
    A('ops.waffe.stb2', 'ops', 'Steuerbord 2 (Platz 9)', NUM(9)),
    A('ops.waffe.bb3', 'ops', 'Backbord 3 (Platz 1)', NUM(1)),
    A('ops.waffe.stb3', 'ops', 'Steuerbord 3 (Platz 3)', NUM(3)),
    A('ops.waffe.beideSeiten', 'ops', 'Alle Batterien (Salvenwaffen)', ['Space']),
    A('ops.nachladen', 'ops', 'Nachladen (Torpedowerfer lädt selbst)', ['KeyR']),
    A('ops.scan', 'ops', 'Zielscan (halten)', ['KeyS']),
    A('ops.weitscan', 'ops', 'Weitscan', ['KeyW']),
    A('ops.schilde', 'ops', 'Schilde hoch/runter', ['KeyH']),
    A('ops.marker', 'ops', 'Marker aufs Ziel', ['KeyM']),
    A('ops.markerLoeschen', 'ops', 'Marker löschen', ['KeyX']),
    A('ops.orbitalschlag', 'ops', 'Orbitalschlag auf Markierung', ['KeyO']),
    A('ops.zoom', 'ops', 'Zoom wechseln', ['KeyZ']),
    A('ops.zoomRein', 'ops', 'Hineinzoomen', ['Equal', 'NumpadAdd']),
    A('ops.zoomRaus', 'ops', 'Herauszoomen', ['Minus', 'NumpadSubtract']),
    A('ops.sondeMarke', 'ops', 'Sonde zur Marke', ['KeyP']),
    A('ops.sondeSprung', 'ops', 'Sonde durch Sprungpunkt', ['KeyJ']),
    A('ops.spur', 'ops', 'Spur lesen', ['KeyK']),
    A('ops.personBeamen', 'ops', 'Person beamen / abbrechen', ['KeyU']),
    A('ops.personAbgeben', 'ops', 'Person abgeben', ['KeyB']),
    A('ops.notruf', 'ops', 'Notruf entschlüsseln', ['KeyI']),
    A('ops.zonen', 'ops', 'Zonen', ['KeyY']),
    A('ops.landepunkt', 'ops', 'Landepunkt scannen / abbrechen', ['KeyL']),
    A('ops.fracht.beamen', 'ops', 'Fracht beamen / abbrechen', ['KeyF'], 'ops.fracht'),
    A('ops.fracht.schoepfen', 'ops', 'Gas schöpfen / beenden', ['KeyC'], 'ops.fracht'),
    A('ops.fracht.abliefern', 'ops', 'Fracht abliefern', ['KeyG'], 'ops.fracht'),
    A('ops.fracht.verkaufen', 'ops', 'Fracht verkaufen', ['KeyV'], 'ops.fracht'),
    A('ops.fracht.abwerfen', 'ops', 'Ladung abwerfen', ['KeyX'], 'ops.fracht'),
    A('ops.entschl.start', 'ops', 'Entschlüsseln starten', ['KeyN'], 'ops.entschl'),
    A('ops.entschl.links', 'ops', 'Frequenz runter (halten)', ['KeyA', 'ArrowLeft'], 'ops.entschl'),
    A('ops.entschl.rechts', 'ops', 'Frequenz hoch (halten)', ['KeyD', 'ArrowRight'], 'ops.entschl'),
    A('ops.entschl.stopp', 'ops', 'Entschlüsseln abbrechen', ['Backspace'], 'ops.entschl'),
    A('ops.glyphen.hoch', 'ops', 'Glyphe: Auswahl hoch', ['ArrowUp'], 'ops.glyphen'),
    A('ops.glyphen.runter', 'ops', 'Glyphe: Auswahl runter', ['ArrowDown'], 'ops.glyphen'),
    A('ops.glyphen.links', 'ops', 'Glyphe: Auswahl links', ['ArrowLeft'], 'ops.glyphen'),
    A('ops.glyphen.rechts', 'ops', 'Glyphe: Auswahl rechts', ['ArrowRight'], 'ops.glyphen'),
    A('ops.glyphen.waehlen', 'ops', 'Glyphe wählen', ['Space'], 'ops.glyphen'),
    A('ops.glyphen.senden', 'ops', 'Glyphen senden', ['Enter', 'NumpadEnter'], 'ops.glyphen'),

    // ------------------------------------------------------------ Technik
    A('technik.reiter1', 'technik', 'Reiter Energie & Schilde', NUM(1).reverse()),
    A('technik.reiter2', 'technik', 'Reiter Schadensplan', NUM(2).reverse()),
    A('technik.energie.hoch', 'technik', 'Zeile hoch', ['ArrowUp', 'KeyW'], 'technik.energie'),
    A('technik.energie.runter', 'technik', 'Zeile runter', ['ArrowDown', 'KeyS'], 'technik.energie'),
    A('technik.energie.weniger', 'technik', 'Energie / Schild −', ['ArrowLeft', 'KeyA', 'Minus', 'NumpadSubtract'], 'technik.energie'),
    A('technik.energie.mehr', 'technik', 'Energie / Schild +', ['ArrowRight', 'KeyD', 'Equal', 'NumpadAdd', 'BracketRight'], 'technik.energie'),
    A('technik.ueberladen', 'technik', 'Reaktor überladen (fragt nach)', ['KeyU'], 'technik.energie'),
    A('technik.ueberladenJa', 'technik', 'Überladen bestätigen', ['KeyJ', 'Enter'], 'technik.energie'),
    A('technik.ueberladenNein', 'technik', 'Überladen abbrechen', ['KeyN'], 'technik.energie'),
    A('technik.schaden.hoch', 'technik', 'Zeile hoch', ['ArrowUp', 'KeyW'], 'technik.schaden'),
    A('technik.schaden.runter', 'technik', 'Zeile runter', ['ArrowDown', 'KeyS'], 'technik.schaden'),
    A('technik.flicken', 'technik', 'Bots: flicken', ['Enter', 'KeyF'], 'technik.schaden'),
    A('technik.teil', 'technik', 'Bots: Ersatzteil einbauen', ['KeyT'], 'technik.schaden'),
    A('technik.auftragWeg', 'technik', 'Reparaturauftrag entfernen', ['Delete', 'Backspace', 'Digit0'], 'technik.schaden'),
    A('technik.prioritaet', 'technik', 'Priorität setzen', ['KeyP'], 'technik.schaden'),
    A('technik.botsAuto', 'technik', 'Bots automatisch', ['KeyA'], 'technik.schaden'),

    // ------------------------------------------------------------ Captain
    A('captain.reiter1', 'captain', 'Reiter Funk', NUM(1).reverse()),
    A('captain.reiter2', 'captain', 'Reiter Sternkarte', NUM(2).reverse()),
    A('captain.reiter3', 'captain', 'Reiter Lage', NUM(3).reverse()),
    A('captain.reiter4', 'captain', 'Reiter Außenteam', NUM(4).reverse()),
    A('captain.reiter5', 'captain', 'Reiter Sektorplan', NUM(5).reverse()),
    A('captain.reiter6', 'captain', 'Reiter Notrufe', NUM(6).reverse()),
    A('captain.karte.zurueck', 'captain', 'Karte zurücksetzen', ['Digit0', 'Numpad0', 'Home'], 'captain.karte'),
    A('captain.karte.rein', 'captain', 'Karte hineinzoomen', ['Equal', 'NumpadAdd'], 'captain.karte'),
    A('captain.karte.raus', 'captain', 'Karte herauszoomen', ['Minus', 'NumpadSubtract'], 'captain.karte'),
    A('captain.funk.annehmen', 'captain', 'Funkspruch annehmen', ['Enter'], 'captain.funk'),
    A('captain.funk.wahl1', 'captain', 'Antwort 1', ['KeyQ'], 'captain.funk'),
    A('captain.funk.wahl2', 'captain', 'Antwort 2', ['KeyW'], 'captain.funk'),
    A('captain.funk.wahl3', 'captain', 'Antwort 3', ['KeyE'], 'captain.funk'),
    A('captain.funk.abhoeren', 'captain', 'Neuen Funkspruch abhören', ['KeyL'], 'captain.funk'),
    A('captain.stern.vorher', 'captain', 'Voriger Ort', ['ArrowLeft', 'ArrowUp', 'KeyA', 'KeyW'], 'captain.stern'),
    A('captain.stern.naechster', 'captain', 'Nächster Ort', ['ArrowRight', 'ArrowDown', 'KeyD', 'KeyS'], 'captain.stern'),
    A('captain.stern.sprungziel', 'captain', 'Als Sprungziel wählen', ['Enter'], 'captain.stern'),
    A('captain.stern.ansicht', 'captain', 'Saumraum / ganze Karte', ['KeyM'], 'captain.stern'),
    A('captain.lage.scan', 'captain', 'Scan (halten)', ['Space'], 'captain.lage'),
    A('captain.lage.markerLoeschen', 'captain', 'Marker löschen', ['KeyX'], 'captain.lage'),
    A('captain.lage.zoom', 'captain', 'Zoom wechseln', ['KeyZ'], 'captain.lage'),
    A('captain.lage.zoomRein', 'captain', 'Hineinzoomen', ['Equal', 'NumpadAdd'], 'captain.lage'),
    A('captain.lage.zoomRaus', 'captain', 'Herauszoomen', ['Minus', 'NumpadSubtract'], 'captain.lage'),
    A('captain.lage.halten', 'captain', 'Schützling: halten', ['KeyH'], 'captain.lage'),
    A('captain.lage.folgen', 'captain', 'Schützling: folgen', ['KeyF'], 'captain.lage'),
    A('captain.lage.volleKraft', 'captain', 'Schützling: volle Kraft', ['KeyV'], 'captain.lage'),
    A('captain.lage.andocken', 'captain', 'Schützling: andocken', ['KeyD'], 'captain.lage'),
    A('captain.lage.wechseln', 'captain', 'Schützling wechseln', ['KeyN'], 'captain.lage'),
    A('captain.aussen.sensor', 'captain', 'Sensor', ['KeyS'], 'captain.aussen'),
    A('captain.aussen.kuppel', 'captain', 'Schildkuppel', ['KeyK'], 'captain.aussen'),
    A('captain.aussen.sammeln', 'captain', 'Befehl: sammeln', ['KeyQ'], 'captain.aussen'),
    A('captain.aussen.halten', 'captain', 'Befehl: halten', ['KeyW'], 'captain.aussen'),
    A('captain.aussen.flanke', 'captain', 'Befehl: Flanke', ['KeyE'], 'captain.aussen'),
    A('captain.aussen.rueckzug', 'captain', 'Befehl: Rückzug', ['KeyR'], 'captain.aussen'),
    A('captain.aussen.fokus', 'captain', 'Befehl: Fokus', ['KeyF'], 'captain.aussen'),
    A('captain.aussen.gefahr', 'captain', 'Befehl: Gefahr', ['KeyG'], 'captain.aussen'),
    A('captain.aussen.loeschen', 'captain', 'Befehl löschen', ['KeyX'], 'captain.aussen'),
    A('captain.plan.vorher', 'captain', 'Voriger Sektor', ['ArrowLeft', 'KeyA'], 'captain.plan'),
    A('captain.plan.naechster', 'captain', 'Nächster Sektor', ['ArrowRight', 'KeyD'], 'captain.plan'),
    A('captain.plan.hier', 'captain', 'Auswahl: eigener Sektor', ['KeyH'], 'captain.plan'),
    A('captain.notruf.hoch', 'captain', 'Notruf: voriger', ['ArrowUp', 'KeyW'], 'captain.notruf'),
    A('captain.notruf.runter', 'captain', 'Notruf: nächster', ['ArrowDown', 'KeyS'], 'captain.notruf'),
    A('captain.notruf.hinfliegen', 'captain', 'Notruf: hinfliegen', ['Enter', 'NumpadEnter'], 'captain.notruf'),
    A('captain.notruf.ignorieren', 'captain', 'Notruf: ignorieren', ['KeyX'], 'captain.notruf'),
    A('captain.notruf.frage1', 'captain', 'Notruf: Frage 1', ['KeyQ'], 'captain.notruf'),
    A('captain.notruf.frage2', 'captain', 'Notruf: Frage 2', ['KeyE'], 'captain.notruf'),
    A('captain.notruf.frage3', 'captain', 'Notruf: Frage 3', ['KeyR'], 'captain.notruf'),
    A('captain.notruf.frage4', 'captain', 'Notruf: Frage 4', ['KeyF'], 'captain.notruf'),
  ];
  const NACH_ID = {};
  for (const a of AKTIONEN) NACH_ID[a.id] = a;

  // ---------------------------------------------------------------- Speicher (nur Abweichungen von std)
  function lsGet() { try { return window.localStorage ? window.localStorage.getItem(SPEICHER) : null; } catch (e) { return null; } }
  function lsSet(v) {
    try {
      if (!window.localStorage) return false;
      if (v == null) window.localStorage.removeItem(SPEICHER); else window.localStorage.setItem(SPEICHER, v);
      return true;
    } catch (e) { return false; }
  }
  let eigene = {};
  function laden() {
    eigene = {};
    try {
      const o = JSON.parse(lsGet() || '{}');
      if (o && typeof o === 'object') for (const id of Object.keys(o)) if (NACH_ID[id] && Array.isArray(o[id])) eigene[id] = o[id].filter(gueltig);
    } catch (e) { eigene = {}; }
  }
  let gespeichert = true;
  function speichern() { gespeichert = lsSet(Object.keys(eigene).length ? JSON.stringify(eigene) : null); }

  function gueltig(t) { return typeof t === 'string' && /^(Shift\+)?[A-Za-z0-9]+$/.test(t); }
  const gleich = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  // ---------------------------------------------------------------- Abfragen
  function belegung(id) {
    const a = NACH_ID[id];
    if (!a) return [];
    return (eigene[id] || a.std).slice();
  }
  const MODIFIKATOREN = { ShiftLeft: 1, ShiftRight: 1, ControlLeft: 1, ControlRight: 1, AltLeft: 1, AltRight: 1, MetaLeft: 1, MetaRight: 1, OSLeft: 1, OSRight: 1, CapsLock: 1, NumLock: 1, Fn: 1 };
  // Tastenbezeichnung eines KeyboardEvents ('Shift+KeyA'); null für reine Umschalttasten
  function ausEvent(e) {
    if (!e || !e.code || MODIFIKATOREN[e.code]) return null;
    return (e.shiftKey ? 'Shift+' : '') + e.code;
  }
  function passt(e, id) {
    const t = ausEvent(e);
    return !!t && belegung(id).indexOf(t) >= 0;
  }
  // Loslassen: nur der code zählt (Shift kann inzwischen anders sein), z. B. Lanze loslassen
  function loslassen(e, id) {
    if (!e || !e.code) return false;
    return belegung(id).some((t) => t.replace(/^Shift\+/, '') === e.code);
  }
  // Gehalten: keys = { code: true } wie Consoles.keys; Shift exakt wie bei passt()
  function gehalten(keys, id) {
    if (!keys) return false;
    const shift = !!(keys.ShiftLeft || keys.ShiftRight);
    return belegung(id).some((t) => { const s = t.indexOf('Shift+') === 0; return s === shift && !!keys[s ? t.slice(6) : t]; });
  }
  // erste passende Aktion der Gruppe (oder 'allgemein'); mit bereich zuerst die Aktionen dieses Bereichs, dann die ohne Bereich
  function welche(e, gruppe, bereich) {
    const t = ausEvent(e);
    if (!t) return null;
    const kandidaten = AKTIONEN.filter((a) => a.gruppe === gruppe || a.gruppe === 'allgemein');
    const liste = bereich == null ? kandidaten
      : kandidaten.filter((a) => a.bereich === bereich).concat(kandidaten.filter((a) => !a.bereich));
    for (const a of liste) if (belegung(a.id).indexOf(t) >= 0) return a.id;
    return null;
  }

  // ---------------------------------------------------------------- Beschriftung
  // Die Pixelschrift (Art GLYPHS) kennt Pfeile, aber kein ⇧ ␣ ↵ – daher 'Sh+A', 'Leer', 'Ent'.
  const KAPPEN = {
    Space: 'Leer', Enter: 'Ent', NumpadEnter: 'Ent', Tab: 'Tab', Escape: 'Esc', Backspace: 'Rück', Delete: 'Entf', Insert: 'Einfg',
    Home: 'Pos1', End: 'Ende', PageUp: 'BildA', PageDown: 'BildB',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Equal: '=', Minus: '−', NumpadAdd: '+', NumpadSubtract: '−', NumpadMultiply: '*', NumpadDivide: '/', NumpadDecimal: ',',
    BracketRight: '+', BracketLeft: 'Ü', Semicolon: 'Ö', Quote: 'Ä', Backquote: '^', Backslash: '#', IntlBackslash: '<',
    Comma: ',', Period: '.', Slash: '/',
  };
  // Tastaturlayout des Browsers (Chrome: navigator.keyboard.getLayoutMap) – dann zeigt eine deutsche Tastatur 'Z' für KeyY
  let layout = null;
  // Zeichen, die die Pixelschrift sicher kann (sonst bleibt die Ersatzbeschriftung aus KAPPEN)
  const LAYOUT_SICHER = /^[A-Z0-9ÄÖÜß+\-#<>,./^*_=;()[\]]$/;
  const LAYOUT_CODES = { Minus: 1, Equal: 1, BracketLeft: 1, BracketRight: 1, Semicolon: 1, Quote: 1, Backquote: 1, Backslash: 1, IntlBackslash: 1, Comma: 1, Period: 1, Slash: 1 };
  try {
    const kb = typeof navigator !== 'undefined' && navigator.keyboard;
    if (kb && typeof kb.getLayoutMap === 'function') kb.getLayoutMap().then((m) => { layout = m; }, () => {});
  } catch (e) { /* ohne Layout: US-Namen */ }
  function kappeVon(t) {
    if (!t) return '–';
    const shift = t.indexOf('Shift+') === 0;
    const code = shift ? t.slice(6) : t;
    let k;
    let m = /^Key([A-Z])$/.exec(code);
    const ausLayout = () => { try { const l = layout && layout.get(code); const g = l && l.length === 1 ? (l === 'ß' ? l : l.toUpperCase()) : ''; if (g && LAYOUT_SICHER.test(g)) return g; } catch (e) { /* egal */ } return null; };
    if (m) k = ausLayout() || m[1];
    else if (LAYOUT_CODES[code] && ausLayout()) k = ausLayout();
    else if ((m = /^(?:Digit|Numpad)([0-9])$/.exec(code))) k = m[1];
    else if ((m = /^F([0-9]{1,2})$/.exec(code))) k = 'F' + m[1];
    else if (KAPPEN[code]) k = KAPPEN[code];
    else k = code.slice(0, 5);
    return shift ? 'Sh+' + k : k;
  }
  function kappe(id) { return kappeVon(belegung(id)[0]); }
  // Ausführlicher Name fürs Menü ('Num 8' statt '8', damit Ziffernblock und obere Reihe unterscheidbar sind)
  function name(t) {
    if (!t) return '–';
    const shift = t.indexOf('Shift+') === 0;
    const code = shift ? t.slice(6) : t;
    let k;
    let m = /^Numpad([0-9])$/.exec(code);
    if (m) k = 'Num ' + m[1];
    else if (code === 'NumpadAdd') k = 'Num +';
    else if (code === 'NumpadSubtract') k = 'Num −';
    else if (code === 'NumpadEnter') k = 'Num Ent';
    else if (code === 'Space') k = 'Leertaste';
    else if (code === 'Enter') k = 'Enter';
    else k = kappeVon(code);
    return shift ? 'Shift+' + k : k;
  }

  // ---------------------------------------------------------------- Ändern
  function setze(id, index, code) {
    const a = NACH_ID[id];
    if (!a) return false;
    if (code != null && code !== '' && !gueltig(code)) return false;
    const b = belegung(id);
    const i = Math.max(0, index | 0);
    if (code == null || code === '') { if (i < b.length) b.splice(i, 1); }
    else {
      const schon = b.indexOf(code);
      if (schon >= 0 && schon !== i) b.splice(schon, 1);   // dieselbe Taste nicht zweimal in einer Aktion
      if (i < b.length) b[schon >= 0 && schon < i ? i - 1 : i] = code; else b.push(code);
    }
    if (gleich(b, a.std)) delete eigene[id]; else eigene[id] = b;
    speichern();
    return true;
  }
  // ohne id: alles; mit Gruppen-id ('ops'): die ganze Gruppe; sonst die eine Aktion
  function zuruecksetzen(id) {
    if (id == null) eigene = {};
    else if (NACH_ID[id]) delete eigene[id];
    else for (const a of AKTIONEN) if (a.gruppe === id) delete eigene[a.id];
    speichern();
  }
  function geaendert(id) { return !!eigene[id]; }

  // ---------------------------------------------------------------- Konflikte
  // Liste { taste, ids, bereich } doppelt belegter Tasten innerhalb einer Gruppe (Gruppe + 'allgemein')
  function konflikte(gruppe) {
    const inGruppe = AKTIONEN.filter((a) => a.gruppe === gruppe);
    const allg = gruppe === 'allgemein' ? [] : AKTIONEN.filter((a) => a.gruppe === 'allgemein');
    const bereiche = [''];
    for (const a of inGruppe) if (a.bereich && bereiche.indexOf(a.bereich) < 0) bereiche.push(a.bereich);
    const aus = [], gesehen = {};
    for (const b of bereiche) {
      const vorrang = b && BEREICHE[b] && BEREICHE[b].vorrang;
      const menge = inGruppe.filter((a) => a.bereich === b || (!vorrang && !a.bereich)).concat(allg);
      const proTaste = {};
      for (const a of menge) for (const t of belegung(a.id)) (proTaste[t] = proTaste[t] || []).push(a.id);
      for (const t of Object.keys(proTaste)) {
        const ids = proTaste[t];
        if (ids.length < 2) continue;
        const k = t + '|' + ids.slice().sort().join(',');
        if (gesehen[k]) continue;
        gesehen[k] = 1;
        aus.push({ taste: t, ids: ids.slice(), bereich: b });
      }
    }
    return aus;
  }

  laden();

  window.Tasten = {
    AKTIONEN, GRUPPEN, BEREICHE,
    aktion: (id) => NACH_ID[id] || null,
    passt, welche, loslassen, gehalten, ausEvent,
    kappe, kappeVon, name,
    belegung, setze, zuruecksetzen, geaendert, konflikte,
    laden, gespeichert: () => gespeichert,
  };
})();
