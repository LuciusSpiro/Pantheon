'use strict';
// SUND-03b I: Mutationsprobe zu tools/test-handel-info.js (und für die Netz-Regeln tools/test-handel-info-ws.js). Kopiert Server, Shared, Content, public/js und die Tests in ein Temp-Verzeichnis
// (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel und verlangt, dass der Test rot wird (Exit != 0). Überlebt eine Mutation, deckt kein Test die Regel ab.
// Vor den Läufen prüft ein Selbstcheck, dass jeder Anker genau einmal im Quelltext steht (sonst Exit 2: keine still übersprungene Mutation). --trocken: nur der Selbstcheck.
// Eine Mutation mit Kennzeichen 'ws' läuft zusätzlich gegen den Netz-Test (dauert länger).
// Wichtig: „Beleg ≠ Sim“ (B1–B6) und „Gerücht ohne Kennzeichnung“ (G1–G2) sind die Kernregeln dieses Pakets.
//   node tools/mutation-handel-info.js [begriff …] [--trocken]      (npm run test:handel-info-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-handel-info-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
for (const f of ['test-handel-info.js', 'test-handel-info-ws.js']) fs.copyFileSync(path.join(ROOT, 'tools', f), path.join(TMP, 'tools', f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const HI = 'server/sim/handel-info.js', WI = 'server/sim/kriegslage-wissen.js', GA = 'server/game.js', DW = 'content/welt/handel-info-werte.json', DA = 'content/welt/handel-info-anzeige.json', IX = 'server/index.js', TU = 'public/js/terminal-ui.js', HC = 'public/js/handel-info.js', WF = 'server/sim/werft.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, 'ws'?]
const MUTATIONEN = [
  // ---- Beleg ≠ Sim (Kernregel)
  [HI, "const fakten = { ort: rec.ziel, fraktion: rec.von, klasse: Kern.staerkeKlasse(summe(fl), z.werte) };", "const fakten = { ort: rec.ziel, fraktion: rec.von, klasse: Math.min(3, Kern.staerkeKlasse(summe(fl), z.werte) + 1) };", 'B1 Beleg ≠ Sim: Stärkeklasse eine Stufe zu hoch'],
  [HI, "const fakten = { ort: rec.ziel, fraktion: rec.von, klasse: Kern.staerkeKlasse(summe(fl), z.werte) };", "const fakten = { ort: rec.stuetz || rec.ziel, fraktion: rec.von, klasse: Kern.staerkeKlasse(summe(fl), z.werte) };", 'B2 Beleg ≠ Sim: Sammelort statt Ziel'],
  [HI, "fakten.zeit = Math.max(1, z.tick - rec.t_an + 1);", "fakten.zeit = Math.max(1, z.tick - rec.t_an);", 'B3 Beleg ≠ Sim: Zeit der Belagerung um eins zu klein'],
  [HI, "  if (stufe === 'gerucht') {\n    const s = strom(", "  if (true) {\n    const s = strom(", 'B4 Beleg ≠ Sim: auch der Beleg wird verfälscht'],
  [HI, "const fraktion = hafen ? ev.neu : ev.durch;", "const fraktion = hafen ? ev.alt : ev.durch;", 'B5 Beleg ≠ Sim: gefallener Hafen nennt den alten Besitzer'],
  [HI, "const fakten = { ort: rec.ziel, fraktion: rec.von,", "const fakten = { ort: rec.ziel, fraktion: z.hexe[rec.ziel].besitzer || rec.von,", 'B6 Beleg ≠ Sim: Fraktion = Besitzer des Ziels statt Angreifer'],
  [HI, "let fakten = klon(thema.fakten), wahr = true, feld = null;", "let fakten = klon(thema.fakten), wahr = true, feld = null; fakten.ort = ctx.d.nbr[fakten.ort][0];", 'B7 Beleg ≠ Sim: Ort stets der erste Nachbar'],
  [HI, "if (rec.t_ende !== null || rec.phase === 'abgebrochen' ||", "if (rec.phase === 'abgebrochen' ||", 'B8 beendete Feldzüge sind noch Themen'],
  [HI, "(zeit >= 1 && zeit <= W.gefallen_fenster)", "(zeit >= 1)", 'B9 gefallene Orte ohne Zeitfenster'],
  // ---- Gerücht: Kennzeichnung, Quote, erlaubte Felder
  [HI, "const text = W.kennzeichnung[stufe] + ': ' + einsetzen(", "const text = (stufe === 'beleg' ? W.kennzeichnung[stufe] + ': ' : '') + einsetzen(", 'G1 Gerücht ohne Kennzeichnung im Text'],
  [HI, "return { stufe, zuverlaessigkeit: W.zuverlaessigkeit[stufe],", "return { stufe, zuverlaessigkeit: 'beleg',", 'G2 Gerücht mit Zuverlässigkeit „beleg“'],
  [HI, "if (s() < W.falschquote) {", "if (s() < 0.9) {", 'G3 Falschquote 90 %'],
  [HI, "if (s() < W.falschquote) {", "if (s() < 0) {", 'G4 nie falsch'],
  [DW, '"falschquote": {"wert": 0.3333,', '"falschquote": {"wert": 0.5,', 'G5 Daten: Falschquote 0,5'],
  [HI, "case 'ort': { const nb = pl && pl.ort ? pl.ort : nachbarn(d, f.ort);", "case 'ort': { const nb = d.codes.filter((c) => c !== f.ort);", 'G6 falscher Ort: beliebiges Hex statt Nachbar'],
  [HI, "const c = [f.klasse - 1, f.klasse + 1].filter((k) => k >= 1 && k <= 3);", "const c = [f.klasse - 2, f.klasse + 2, f.klasse + 1].filter((k) => k >= 1 && k <= 4);", 'G7 falsche Klasse: Sprung um zwei oder über die Grenze'],
  [HI, "return { fakten: Object.assign({}, f, { [feld]: neu }), feld };", "return { fakten: Object.assign({}, f, { [feld]: neu, fraktion: 'pirat' }), feld };", 'G8 falsches Gerücht ändert mehr als ein Faktum'],
  [DW, "\"belagert\": [\"ort\", \"fraktion\", \"klasse\", \"zeit\"],", "\"belagert\": [\"ort\", \"fraktion\", \"klasse\", \"zeit\", \"typ\"],", 'G9 Daten: unbekanntes Falschfeld (Test prüft die Textfelder)'],
  [HI, "const reihe = mischen((W.falsch_felder[art] || []).filter((k) => f[k] !== undefined), s);", "const reihe = mischen(['ort'], s);", 'G10 nur das Feld Ort wird je vertauscht'],
  [HI, "const s = strom(seedVon(ctx.z), n | 0, 'gerucht:' + thema.key);", "const s = Math.random;", 'G11 Gerücht aus Math.random statt eigenem Strom (nicht wiederholbar)'],
  [HI, "ws.wissen = Object.assign({}, vorher, { gz: gz + 1 });", "ws.wissen = Object.assign({}, vorher, { gz: gz });", 'G12 Gerüchte-Zähler wandert nicht'],
  [GA, "{ stufe: r.stufe, text: r.text, zuv: r.zuverlaessigkeit } :", "{ stufe: r.stufe, text: r.text, zuv: r.zuverlaessigkeit, wahr: r.intern.wahr } :", 'G14 Antwort an den Client verrät wahr/falsch', 'ws'],
  // ---- Angebot
  [HI, "const anz = Math.min(alle.length, W.angebot.min + Math.floor(s() * (W.angebot.max - W.angebot.min + 1)));", "const anz = Math.min(alle.length, W.angebot.max + 1);", 'A1 Angebot hat mehr als drei Themen'],
  [HI, "const s = strom(seedVon(ctx.z), ctx.tickZahl, 'angebot:' + hex);", "const s = Math.random;", 'A2 Angebot aus Math.random (nicht deterministisch)'],
  [HI, "const anz = Math.min(alle.length,", "const anz = Math.min(1,", 'A3 Angebot nie mehr als ein Thema'],
  [HI, "if (!alle.length) return [];", "if (!alle.length) return [{ id: 't0', key: 'erfunden:0', art: 'marsch', fakten: { ort: '0603', fraktion: 'ger', klasse: 1 }, sicht: { h: ['0603'], an: null } }];", 'A4 ohne Thema wird eines erfunden'],
  // ---- Kauf, Marken, Rollback
  [HI, "if (!(game.inventory.marks >= preis)) return fehl('zu_wenig_marken');", "", 'M1 kein Markenvorrat geprüft'],
  [HI, "  const vorher = ws.wissen, gz =", "  game.inventory.marks -= preis;\n  const vorher = ws.wissen, gz =", 'M2 Marken vor dem Ergebnis abgebucht (kein Rollback der Marken)'],
  [HI, "    ws.wissen = vorher;\n    if (game.countError) game.countError('handel-info', e);", "    if (game.countError) game.countError('handel-info', e);", 'M3 Wirkung scheitert: Wissen nicht zurückgesetzt'],
  [HI, "  game.inventory.marks -= preis;\n  gekauft[gkey] = 1;", "  gekauft[gkey] = 1;", 'M4 Kauf bucht keine Marken ab'],
  [HI, "if (gekauft[gkey]) return fehl('gekauft');", "", 'M5 Doppelkauf desselben Themas nicht verhindert'],
  [HI, "!W.haefen_besitzer.includes(h.besitzer)) return { code: 'kein_konkordat' };", "false) return { code: 'kein_konkordat' };", 'M6 Kauf an jedem Hafen, nicht nur Konkordat'],
  [HI, "if (!h || !d.hex[hex] || d.hex[hex].hafen === '' ||", "if (!h || !d.hex[hex] ||", 'M7 Kauf auch an Orten ohne Hafen'],
  [HI, "if (!game.ship || !game.ship.docked || !game.ship.dockedAt) return { code: 'nicht_angedockt' };", "", 'M8 Kauf ohne angedockt zu sein'],
  [HI, "const thema = angebot.find((t) => t.id === themaId);", "const thema = angebot.find((t) => t.id === themaId) || angebot[0];", 'M9 unbekanntes Thema kauft das erste'],
  [HI, "const preis = W.preise[stufe];", "const preis = W.preise.gerucht;", 'M10 Beleg zum Preis des Gerüchts'],
  [DA, "\"preise\": {\"wert\": {\"gerucht\": 30, \"beleg\": 120}", "\"preise\": {\"wert\": {\"gerucht\": 31, \"beleg\": 120}", 'M11 Daten: Preis des Gerüchts 31'],
  [HI, "  gekauft[gkey] = 1; ws.infoZahl = (ws.infoZahl || 0) + 1;", "  gekauft[gkey] = 1; ws.infoZahl = (ws.infoZahl || 0) + 1; game.rng();", 'M12 der Kauf verbraucht game.rng'],
  [HI, "  gekauft[gkey] = 1; ws.infoZahl = (ws.infoZahl || 0) + 1;", "  gekauft[gkey] = 1; ws.infoZahl = (ws.infoZahl || 0) + 1; ws.zustand.zufall = (ws.zustand.zufall + 1) >>> 0;", 'M13 der Kauf verändert den Sim-Zustand'],
  [HI, "      Wissen.sondeGesichtet(game, null);", "      Wissen.sondeGesichtet(game, null); ws.zustand.hexe[thema.fakten.ort].abwehr = 0;", 'M14 der Beleg schreibt in die Sim'],
  [HI, "    game.emit('radio', { from: W.von, text: erg.text, lage: 1, r: 1, tick: ws.tickZahl });", "", 'M15 kein Funk an alle', 'ws'],
  // ---- Karte: Beleg-Sicht
  [WI, "  for (const hex of belegHexe(game)) out.add(hex);   // SUND-03b I", "  // (kein Beleg in zusatzSicht)   // SUND-03b I", 'K1 zusatzSicht liefert keine Beleg-Hexe'],
  [WI, "if (!b || !(ws.tickZahl <= b.bis) || !belegLebt(ws.zustand, b)) continue;", "if (!b || !(ws.tickZahl < b.bis) || !belegLebt(ws.zustand, b)) continue;", 'K2 Beleg gilt einen Tick zu kurz'],
  [WI, "if (!b || !(ws.tickZahl <= b.bis) || !belegLebt(ws.zustand, b)) continue;", "if (!b || !belegLebt(ws.zustand, b)) continue;", 'K3 Beleg läuft nie ab'],
  [WI, "    if (b.an != null) for (const fl of Kern.feldzugFlotten(", "    if (false) for (const fl of Kern.feldzugFlotten(", 'K4 die Flotte des Feldzugs wird nicht gezeigt'],
  [WI, "direkt: belege.size ? [...((opt && opt.direkt) || []), ...belege] : opt && opt.direkt,", "direkt: opt && opt.direkt,", 'K5 Beleg wirkt nur im Kaufmoment, nicht in den Ticks danach'],
  [WI, "r.W.belege = r.W.belege.filter((b) => T <= b.bis && belegLebt(z, b)); if (!r.W.belege.length) delete r.W.belege;", "", 'K6 abgelaufene Belege werden nicht geräumt'],
  [HI, "bis: ws.tickZahl + W.beleg_dauer }", "bis: ws.tickZahl + 5 }", 'K7 Beleg-Dauer fest 5 statt Daten'],
  [DW, '"beleg_dauer": {"wert": 40,', '"beleg_dauer": {"wert": 41,', 'K8 Daten: Beleg-Dauer 41'],
  [HI, "      ws.wissen = Object.assign({}, vorher, { belege });\n      Wissen.sondeGesichtet(game, null);", "      ws.wissen = Object.assign({}, vorher, { belege });", 'K9 der Beleg wirkt nicht sofort'],
  [WI, "for (const h of b.h || []) out.add(h);", "for (const h of b.h || []) for (const x of Object.keys(ws.zustand.hexe)) out.add(x);", 'K10 der Beleg zeigt die ganze Welt statt des Themas'],
  [HI, "      ws.wissen = Object.assign({}, vorher, { gz: gz + 1 });", "      ws.wissen = Object.assign({}, vorher, { gz: gz + 1, belege: [{ h: thema.sicht.h.slice(), an: thema.sicht.an, bis: ws.tickZahl + W.beleg_dauer }] }); Wissen.sondeGesichtet(game, null);", 'K11 ein Gerücht wirkt auf die Karte'],
  // ---- Weltstand
  [WI, "if (W.gz !== undefined && !(Number.isInteger(W.gz) && W.gz > 0)) delete W.gz;", "", 'S1 gz wird beim Laden nicht geprüft'],
  [WI, "&& (b.an === null || Number.isInteger(b.an)) && Number.isInteger(b.bis) && b.bis >= T;", "&& true;", 'S2 Belege beim Laden ungeprüft (Müll, Abgelaufenes)'],
  [WI, "    belegeLesen(W, T);\n", "", 'S3 Belege werden beim Laden nicht gelesen (nur gelöscht?)'],
  [WI, "if (W.belege !== undefined) {\n    const ok", "if (W.belege !== undefined && false) {\n    const ok", 'S4 Belege beim Laden ohne Prüfung durchgereicht'],
  // ---- Rahmen (Stelle für Paket T)
  [HI, "return soll.length === ist.length && soll.every((x, i) => x === ist[i]);", "return soll.every((x) => ist.includes(x));", 'R1 Rahmen mit unbekanntem Platzhalter wird angenommen'],
  [HI, "return soll.length === ist.length && soll.every((x, i) => x === ist[i]);", "return ist.every((x) => soll.includes(x));", 'R2 unvollständiger Rahmen wird angenommen'],
  [HI, "if (rahmenGueltig(r, thema.art)) return r;", "if (typeof r === 'string') return r;", 'R3 Rahmen aus dem Pool ungeprüft'],
  [HI, "catch (e) { /* Rückfall: Datentext */ }", "catch (e) { throw e; }", 'R4 ein Pool, der wirft, bricht den Kauf'],
  [HI, "const text = W.kennzeichnung[stufe] + ': ' + einsetzen(rahmenFuer(thema, stufe), fakten, ctx.d);", "const rahmen = rahmenFuer(thema, stufe); const text = (rahmen === W.themen[thema.art][stufe] ? W.kennzeichnung[stufe] + ': ' : '') + einsetzen(rahmen, fakten, ctx.d);", 'R5 Rahmen aus dem Pool ohne Kennzeichnung'],
  // ---- Server: Befehl, Block
  [GA, "absicht: 'shop', info: 'shop',", "absicht: 'shop', info: 'helm',", 'N1 Befehl info.kaufen gehört zur Konsole helm statt shop'],
  [GA, "case 'info.kaufen': {", "case 'info.kaufen_x': {", 'N2 Befehl info.kaufen wird nicht verarbeitet'],
  [HI, "function sichtbar(game) { const ws = zustandVon(game); return !!ws && nutzerAmTerminal(game) && !!konkordatHex(game).hex; }", "function sichtbar(game) { const ws = zustandVon(game); return !!ws && !!konkordatHex(game).hex; }", 'N3 Block auch ohne Terminal-Nutzer', 'ws'],
  [HI, "function sichtbar(game) { const ws = zustandVon(game); return !!ws && nutzerAmTerminal(game) && !!konkordatHex(game).hex; }", "function sichtbar(game) { const ws = zustandVon(game); return !!ws && nutzerAmTerminal(game); }", 'N4 Block an jedem Hafen'],
  [HI, "const o = { i: t.id, a: t.art, k: kennung(t.key) };", "const o = { i: t.id, a: t.art, k: kennung(t.key), ort: t.fakten.ort };", 'N5 Block verrät den Ort vor dem Kauf'],
  [HI, "  return [ws.tickZahl, k.hex, Object.keys(gek).length, ws.infoZahl || 0].join('|');", "  return [ws.tickZahl, k.hex].join('|');", 'N6 Schlüssel merkt Käufe nicht (Block bleibt alt)', 'ws'],
  [GA, "else if (!ik && this.sentInfoKey) { world.info = null; this.sentInfoKey = null; }", "", 'N7 kein Löschsignal world.info = null', 'ws'],
  [GA, "if (ik && ik !== this.sentInfoKey && !includeAsteroids", "if (ik && !includeAsteroids", 'N8 Block in jedem Snapshot', 'ws'],
  [WF, "msg.b === 'i' ? 'i' : 'w';", "'w';", 'N9 Zuschauer-Ansicht kennt den Bereich Information nicht'],
  // ---- Client
  [TU, "info: IN0 ? { label: IT('bereich_kurz') || 'Info' } : null,", "info: { label: IT('bereich_kurz') || 'Info' },", 'C1 Knopf Info auch ohne Konkordat-Hafen'],
  [TU, "cmd(view, 'info.kaufen', { thema: id, stufe, art: t.art, k: t.k });", "cmd(view, 'info.kaufen', { thema: id, stufe: stufe === 'gerucht' ? 'beleg' : 'gerucht', art: t.art, k: t.k });", 'C2 Client vertauscht Gerücht und Beleg'],
  [TU, "else if ((code === 'Enter' || code === 'NumpadEnter') && k) infoKaufen(view, IN, k.id, 'gerucht');", "else if ((code === 'Enter' || code === 'NumpadEnter') && k) infoKaufen(view, IN, k.id, 'beleg');", 'C3 Enter kauft den Beleg statt des Gerüchts'],
  [TU, "if (code === 'KeyI') { bereichWechseln('info'); return true; }", "if (code === 'KeyI') { s.bereich = 'info'; return true; }", 'C4 Taste I öffnet den Bereich auch ohne Block'],
  [TU, "if (s.bereich === 'info' && !info()) s.bereich = 'werft';", "", 'C5 Bereich bleibt ohne Block stehen'],
  [HC, "if (msg.world && Object.prototype.hasOwnProperty.call(msg.world, 'info')) store.info =", "if (msg.world && msg.world.info) store.info =", 'C6 Client ignoriert das Löschsignal'],
  [WI, "  return !!rec && rec.t_ende === null && rec.phase !== 'abgebrochen';", "  return !!rec;", "S1 Beleg gilt auch nach dem Ende des Feldzugs"],
  [WI, "Kern.feldzugFlotten(ws.zustand, ws.zustand.angriffe.find((r) => r.id === b.an))", "ws.zustand.flotten.filter((fl) => fl.angriff === b.an)", "S1 Beleg zeigt alle Flotten mit Feldzug-Id (Rückzieher, Heimathafen)"],
  [WI, "rec.t_ende === null && rec.phase !== 'abgebrochen';", "rec.phase !== 'abgebrochen';", "S1 Beleg zeigt abgebrochene Feldzüge weiter"],
  [HI, "const fl = Kern.feldzugFlotten(z, rec);", "const fl = z.flotten.filter((f) => f.angriff === rec.id);", "S3 Klasse zählt alle Flotten mit Feldzug-Id (auch im Rückzug)"],
  [HI, "art = hafen ? 'gefallen' : 'verloren';", "art = 'gefallen';", "M1 Postenverlust ist dieselbe Themenart wie der Hafenverlust (Neuer Herr)"],
  [DW, "zerstört. Der Ort ist jetzt frei.\"", "zerstört. Neuer Herr: {fraktion}.\"", "M1 Daten: der Rahmen des Postenverlusts nennt einen neuen Herrn"],
  [DW, "\"belagert\": [\"rom\", \"ger\", \"pirat\"],", "\"belagert\": [\"rom\", \"ger\", \"kon\", \"pirat\"],", "S2 Daten: das Konkordat als falscher Angreifer"],
  [DW, "\"marsch\": [\"rom\", \"ger\"],", "\"marsch\": [\"rom\", \"ger\", \"pirat\"],", "S2 Daten: Piraten auch als falscher Marsch-Angreifer"],
  [DW, "\"gefallen\": [\"ort\", \"zeit\"]", "\"gefallen\": [\"ort\", \"fraktion\", \"zeit\"]", "S2 Daten: beim gefallenen Hafen wird der neue Herr vertauscht"],
  [HI, ".filter((x) => x !== rec.von && x !== besitzer && gegner(x, besitzer))", ".filter((x) => x !== rec.von)", "S2 der Besitzer des Ziels als falscher Angreifer"],
  [HI, ".filter((x) => x !== fraktion && x !== ev.besitzer)", ".filter((x) => x !== fraktion)", "S2 der Verlierer selbst als falscher Zerstörer"],
  [HI, "ort: nachbarn(d, rec.ziel).filter((c) => { const bz = z.hexe[c] && z.hexe[c].besitzer; return typeof bz === 'string' && Kern.feindlich(rec.von, bz); }),", "ort: nachbarn(d, rec.ziel),", "S2 falscher Ort: jeder Nachbar, auch ein Ziel ohne Feind"],
  [HI, "ort: nachbarn(d, ev.ort).filter((c) => (d.hex[c].hafen !== '') === hafen),", "ort: nachbarn(d, ev.ort),", "S2 falscher Ort beim Hafen-/Posten-Gerücht: Hafen und Nicht-Hafen gemischt"],
  [IX, "nur: ['ruf-werte.json', 'handel-info-anzeige.json'] }", "nur: ['ruf-werte.json', 'handel-info-anzeige.json', 'handel-info-werte.json'] }", "K1 der Server liefert die Regeln des Handels aus"],
  [DA, "    \"preise\": {\"wert\"", "    \"falschquote\": {\"wert\": 0.3333, \"einheit\": \"x\", \"_hinweis\": \"x\"},\n    \"preise\": {\"wert\"", "K1 die Anzeige-Datei enthält die Falschquote"],
  [HI, "if (gezeigt !== undefined && (!gezeigt ||", "if (false && (!gezeigt ||", "K4 kaufen prüft Art und Kennung nicht"],
  [HI, "gezeigt.art !== thema.art || ", "", "K4 kaufen prüft die Art nicht (nur die Kennung)"],
  [HI, " || gezeigt.k !== kennung(thema.key))", ")", "K4 kaufen prüft die Kennung nicht (nur die Art)"],
  [GA, "{ art: msg.art, k: msg.k }", "undefined", "K4 der Server reicht Art und Kennung nicht durch", "ws"],
  [TU, "stufe, art: t.art, k: t.k })", "stufe })", "K4 der Client sendet Art und Kennung nicht"],
  [WI, "bis: Math.min(b.bis, T + INFO_W.beleg_dauer.wert)", "bis: b.bis", "K5 Beleg-Ende beim Laden nicht geklemmt"],
];

{
  const normal = (t) => t.replace(/\r\n/g, '\n');
  const schlecht = [];
  for (const [datei, alt, , was] of MUTATIONEN) {
    let text;
    try { text = normal(fs.readFileSync(path.join(TMP, datei), 'utf8')); } catch (e) { schlecht.push(`${was}: Datei ${datei} nicht lesbar`); continue; }
    const k = text.split(alt).length - 1;
    if (k !== 1) schlecht.push(`${was}: Anker ${k === 0 ? 'nicht gefunden' : k + 'x gefunden'} (${datei})`);
  }
  if (schlecht.length) { console.log(`Anker-Check: ${schlecht.length} von ${MUTATIONEN.length} Mutationen nicht anwendbar:\n  ` + schlecht.join('\n  ')); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } process.exit(2); }
  console.log(`Anker-Check: alle ${MUTATIONEN.length} Anker genau einmal gefunden.`);
  if (process.argv.includes('--trocken')) { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } process.exit(0); }
}

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const lauf = (test) => spawnSync(process.execPath, ['tools/' + test], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
let ueberlebt = 0, gelaufen = 0;
console.log(`Mutationsprobe test-handel-info.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
const basis = lauf('test-handel-info.js'), basisWs = lauf('test-handel-info-ws.js');
console.log(`  Ausgangslage: ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}, Netz-Test ${basisWs.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
if (basis.status !== 0 || basisWs.status !== 0) { console.log(((basis.stdout || '') + (basisWs.stdout || '')).split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
for (const [datei, alt, neu, was, ws] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
  let r = lauf('test-handel-info.js');
  if (r.status === 0 && ws) r = lauf('test-handel-info-ws.js');
  fs.writeFileSync(f, orig);
  const rot = r.status !== 0;
  const fehler = (r.stdout || '').split('\n').filter((l) => /FEHLER/.test(l));
  if (!rot) ueberlebt++;
  console.log(`  ${rot ? 'rot  ' : 'GRÜN '} ${was}${rot ? ` (${fehler.length} Fehler, z. B. ${(fehler[0] || 'Absturz').replace(/^\s*FEHLER\s*/, '').slice(0, 64)})` : '  <-- ÜBERLEBT'}`);
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) überlebt` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
