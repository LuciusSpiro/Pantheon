'use strict';
// SUND-04b D: Mutationsprobe zu tools/test-brett-ui.js (Auftragsbrett in der Anzeige: brett.js, terminal-ui.js, pult-terminal-brett.js, Layout und Knopf in pult-terminal-tokens.js, Tasten, Anschluss in hud.js/consoles.js/client.js/werft.js).
// Kopiert Server, Shared, Content, public und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel und verlangt, dass der Test rot wird (Exit 1 mit FEHLER-Zeile). Überlebt eine
// Mutation, deckt kein Test die Regel ab. ABSTÜRZE (Exit ungleich 0 und 1 oder Exit 1 ohne FEHLER-Zeile) zählen NICHT als erkannt. Der Selbstcheck vorab verlangt, dass jeder Anker genau einmal im Quelltext steht
// (Exit 2, wenn nicht). --trocken prüft nur die Anker.
//   node tools/mutation-brett-ui.js [--trocken] [begriff …]      (npm run test:brett-ui-mutation)
// Bewusst nicht abgedeckt: die Pixel (Sicht: tools/sicht-brett.js) und das Zeichnen des HUD-Streifens im echten hud.js (nur die Quellen-Prüfung im Test).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-brett-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content', 'public'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TESTS = [['tools/test-brett-ui.js']];
for (const f of [...TESTS.map((t) => t[0]), 'tools/regie-fixture.js', 'tools/faden-fixture.js']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const BR = 'public/js/brett.js', TU = 'public/js/terminal-ui.js', PB = 'public/js/pult-terminal-brett.js', PT = 'public/js/pult-terminal-tokens.js', TA = 'public/js/tasten.js',
  CO = 'public/js/consoles.js', CL = 'public/js/client.js', HU = 'public/js/hud.js', WE = 'server/sim/werft.js', IX = 'public/index.html', PA = 'public/js/pult-auftrag-tokens.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  // ---- brett.js: Storage, Müll, Grenzen, Befehle, Texte
  [BR, "if (msg.t === 'welcome') { store.abenteuer = null; return; }", "if (msg.t === 'welcome') { return; }", 'welcome leert nicht'],
  [BR, "if (msg.phase === 'lobby') { store.abenteuer = null; return; }", "if (msg.phase === 'lobby') { return; }", 'Lobby leert nicht'],
  [BR, "msg.world.abenteuer && typeof msg.world.abenteuer === 'object' ? msg.world.abenteuer : null;", "msg.world.abenteuer && typeof msg.world.abenteuer === 'object' ? msg.world.abenteuer : store.abenteuer;", 'Löschsignal null leert nicht'],
  [BR, "const ID_FORM = /^a\\d{1,6}$/;", "const ID_FORM = /^.+$/;", 'Id-Form wird nicht geprüft (Prototype-Keys, Müll)'],
  [BR, "const GRENZE = { angebote: 3, geruechte: 3,", "const GRENZE = { angebote: 5, geruechte: 5,", 'mehr als 3 Angebote und Gerüchte'],
  [BR, ".replace(/[\\u0000-\\u001f]+/g, ' ')", ".replace(/[\\u0000-\\u0000]+/g, ' ')", 'Steuerzeichen bleiben im Text'],
  [BR, ".slice(0, max || GRENZE.text) : '');", ".slice(0, 99999) : '');", 'Texte werden nicht begrenzt'],
  [BR, "gefahrText: gef ? gef.text : '',", "gefahrText: '',", 'der gefährliche Schritt wird nicht genannt'],
  [BR, "const frisch = (l) => !!l && l.ph === 'wartet' && l.schritt === 1;", "const frisch = (l) => !!l && l.ph === 'wartet';", 'ANGENOMMEN steht bei jedem wartenden Schritt'],
  [BR, "schon_beantwortet: 'Schon beantwortet: die erste Antwort der Crew gilt.',", "schon_beantwortet: 'Schon beantwortet.',", 'Kurztext schon_beantwortet ohne „erste Antwort gilt“'],
  [BR, "kein_platz: 'Kein Platz für einen weiteren Handlungsstrang. Das Angebot bleibt.',", "kein_platz: 'Kein Platz für einen weiteren Handlungsstrang.',", 'Kurztext kein_platz verschweigt, dass das Angebot bleibt'],
  [BR, "return { ok: b.ok === 1 || b.ok === true,", "return { ok: true,", 'ok 0 (kein Spielleiter) wird ignoriert'],
  [BR, "schritt: Math.max(1, Math.min(gesamt, zahl(l.schritt) || 1)),", "schritt: zahl(l.schritt) || 1,", 'laufend: Schritt nicht auf die Gesamtzahl begrenzt'],
  [BR, "ph: l.ph === 'laeuft' ? 'laeuft' : 'wartet', rest:", "ph: 'laeuft', rest:", 'laufend: Phase wartet wird nie erkannt'],
  [BR, "send({ t: 'cmd', c, id }); return true;", "send({ t: 'cmd', c, id: 'a1' }); return true;", 'Befehl sendet eine feste Id'],
  [BR, "function annehmen(send, id) { return befehl(send, 'abenteuer.annehmen', id); }", "function annehmen(send, id) { return befehl(send, 'abenteuer.ablehnen', id); }", 'Annehmen sendet den Befehl ablehnen'],
  [BR, "ids.has(g.angebot) ? g.angebot : ''", "g.angebot", 'Gerücht verweist auf ein Angebot, das es nicht gibt'],
  [BR, "if (!angebote.length && !laufend) return null;", "if (false) return null;", 'leerer Block wird zum Modell (Bereich ohne Inhalt)'],
  // ---- terminal-ui.js: Bereich, Tasten, Befehle, Antworten, Zuschauer
  [TU, "if (code === 'KeyO') { bereichWechseln('brett'); return true; }", "if (code === 'KeyP') { bereichWechseln('brett'); return true; }", 'Taste O öffnet das Brett nicht'],
  [TU, "if (!brettKannAntworten(BR) || !BR.ok || BR.laufend || !id) return;", "if (!brettKannAntworten(BR) || !BR.ok || !id) return;", 'Annehmen trotz laufendem Abenteuer'],
  [TU, "if (!brettKannAntworten(BR) || !BR.ok || BR.laufend || !id) return;", "if (!brettKannAntworten(BR) || BR.laufend || !id) return;", 'Annehmen trotz ok 0 (ohne Spielleiter)'],
  [TU, "const brettKannAntworten = (BR) => !s.zusehen && !!BR && BR.angebote.length > 0 && !wartetJetzt();", "const brettKannAntworten = (BR) => !!BR && BR.angebote.length > 0 && !wartetJetzt();", 'Zuschauer können annehmen und ablehnen'],
  [TU, "const brettKannAntworten = (BR) => !s.zusehen && !!BR && BR.angebote.length > 0 && !wartetJetzt();", "const brettKannAntworten = (BR) => !s.zusehen && !!BR && BR.angebote.length > 0;", 'Doppeldruck: kein Entprellen während der Antwort'],
  [TU, "function brettWeiter(view, d) {\n    const BR = brett(); if (s.zusehen || !BR || BR.angebote.length < 2) return;", "function brettWeiter(view, d) {\n    const BR = brett(); if (!BR || BR.angebote.length < 2) return;", 'Zuschauer verstellen die Auswahl'],
  [TU, "(i + BR.angebote.length + d) % BR.angebote.length].id; s.antwort = null;\n  }\n  function brettNummer", "Math.min(BR.angebote.length - 1, Math.max(0, i + d))].id; s.antwort = null;\n  }\n  function brettNummer", 'Auswahl springt am Ende nicht im Kreis'],
  [TU, "/^(?:Digit|Numpad)([1-3])$/.exec(code);", "/^(?:Digit)([1-3])$/.exec(code);", 'Ziffernblock 1–3 wählt nicht'],
  [TU, "function brettNummer(BR, nr) { if (s.zusehen || !BR || !BR.angebote[nr - 1]) return; s.brettId = BR.angebote[nr - 1].id;", "function brettNummer(BR, nr) { if (s.zusehen || !BR || !BR.angebote[nr]) return; s.brettId = BR.angebote[nr].id;", 'Ziffer n wählt das Angebot n+1'],
  [TU, "else if (code === 'KeyX' && k) brettAblehnen(view, BR, k.id);", "else if (code === 'KeyY' && k) brettAblehnen(view, BR, k.id);", 'X lehnt nicht ab'],
  [TU, "else if ((code === 'Enter' || code === 'NumpadEnter') && k) brettAnnehmen(view, BR, k.id);", "else if (code === 'Enter' && k) brettAnnehmen(view, BR, k.id);", 'Ziffernblock-Enter nimmt nicht an'],
  [TU, "info: ant && !ant.ok ? { grund: ant.text } : Brett.frisch(lauf) ? { angenommen: lauf.titel } : null,", "info: Brett.frisch(lauf) ? { angenommen: lauf.titel } : ant && !ant.ok ? { grund: ant.text } : null,", 'ANGENOMMEN verdrängt die Absage (zweite Antwort unsichtbar)'],
  [TU, "info: ant && !ant.ok ? { grund: ant.text } : Brett.frisch(lauf) ? { angenommen: lauf.titel } : null,", "info: ant && !ant.ok ? { grund: ant.text } : null,", 'ANGENOMMEN fehlt für alle (kein Snapshot-Zustand)'],
  [TU, "lauf ? { text: TX.gesperrt, fn: 'warn' }", "lauf ? { text: TX.gesperrt, fn: 'dim' }", 'Hinweis „Ein Abenteuer läuft schon“ nicht in Gelb'],
  [TU, "fn: 'modul' } : { text: '', fn: 'dim' },", "fn: 'dim' } : { text: '', fn: 'dim' },", 'Hinweis „kostet nichts“ nicht in Mint'],
  [TU, "BR.ablehnen ? BR.ablehnen.replace(/\\.$/, '') : TX.kostetNichts", "TX.kostetNichts", 'Hinweis „kostet nichts“ nicht aus den Daten des Servers'],
  [TU, "lauf ? window.PultAuftrag.text('gesperrtGrund', { titel: lauf.titel }) :", "lauf ? '' :", 'gesperrter Annehmen-Knopf ohne Grund'],
  [TU, "lauf ? window.PultAuftrag.text('gesperrtGrund', { titel: lauf.titel }) :", "lauf ? TX.gesperrtGrund.replace('{titel}', lauf.titel) :", 'H1: Sperrgrund mit String.replace (Dollar-Muster im Titel)'],
  [TU, "window.PultAuftrag.text(lauf || !BR.ok ? 'hilfeGesperrt' : 'hilfe',", "window.PultAuftrag.text('hilfe',", 'H4: Tastenzeile nennt „Ent annehmen“ auch bei gesperrter Annahme'],
  [TU, "      scheitern: BR.scheitern,\n", "", 'H2: der Scheitern-Satz des Servers kommt nicht ins Modell'],
  [TU, "const kann = frei && !!gew && !lauf && BR.ok;", "const kann = frei && !!gew && BR.ok;", 'Annehmen-Knopf bleibt trotz laufendem Abenteuer aktiv'],
  [TU, "taste: 'X', kontur: true,", "taste: 'X', kontur: false,", 'Ablehnen ist kein Kontur-Knopf (laut)'],
  [TU, "disabled: !(frei && !!gew), grund: gew ? null", "disabled: false, grund: gew ? null", 'Ablehnen für Zuschauer aktiv'],
  [TU, "if (ev.ok) s.antwort = null; else meldung(false,", "meldung(!!ev.ok,", 'ok-Antwort bleibt als Meldung stehen'],
  [TU, "'abenteuerAntwort') {   // SUND-04b D: Antwort des Servers nur an den Absender; ok = leise (das Ergebnis steht im Snapshot), sonst der Grund in der Infozeile\n      if (ev.pid && window.Client && ev.pid !== Client.pid) return;", "'abenteuerAntwort') {   // SUND-04b D: Antwort des Servers nur an den Absender; ok = leise (das Ergebnis steht im Snapshot), sonst der Grund in der Infozeile", 'Antworten an andere Spieler werden gezeigt'],
  [TU, "      s.wartet = null;\n      if (ev.ok) s.antwort = null;", "      if (ev.ok) s.antwort = null;", 'die Antwort gibt das Terminal nicht wieder frei'],
  [TU, "if (u.b === 'b') return { bereich: 'brett'", "if (u.b === 'x') return { bereich: 'brett'", 'Zuschauer sehen das Brett nicht'],
  [TU, "a.bereich === 'brett' ? 'b' : a.bereich === 'lage' ? 'l' :", "a.bereich === 'brett' ? 'w' : a.bereich === 'lage' ? 'l' :", 'die Ansicht des Nutzers meldet das Brett nicht'],
  [TU, "s.lageId = null; s.infoId = null; s.brettId = null; s.finaleT = 0;", "s.lageId = null; s.infoId = null; s.finaleT = 0;", 'Zurücksetzen vergisst die Brett-Auswahl'],
  [TU, "if (s.bereich === 'brett' && !brett()) s.bereich = 'werft';", "", 'nach dem Löschsignal bleibt der Bereich Brett offen'],
  [TU, "if (b === 'brett' && !brett()) return; if (b === 'lage'", "if (b === 'lage'", 'der Bereich Brett öffnet auch ohne Block'],
  [TU, "s.bereich === 'brett' && !brett() ? 'werft' : s.bereich === 'info'", "s.bereich === 'info'", 'bereichJetzt nennt nach dem Löschsignal noch das Brett'],
  [TU, "brett: BR0 ? { label: BT().knopf } : null };", "brett: { label: BT().knopf } };", 'Knopf Brett auch ohne Block'],
  [TU, "if (a.bereich === 'brett' && brett()) return brettBauen(", "if (false) return brettBauen(", 'der Bereich Brett baut kein Modell'],
  // ---- pult-terminal-tokens.js: Layout, Knopf, Dispatch
  [PT, "w: KB ? KB.modulTitelW : 154 },", "w: 154 },", 'Titellinie MODULRAUM läuft unter den Knopf Brett'],
  [PT, "if (KB) L.aktionen.brett = { x: KB.brett.x, y: py - 4, w: KB.brett.w, h: KNOPF.h };", "if (KB) L.aktionen.brett = { x: 392, y: py - 4, w: KB.brett.w, h: KNOPF.h };", 'Knopf Brett überlappt Info und Kurs'],
  [PT, "if (KB) L.aktionen.brett = { x: KB.brett.x, y: py - 4, w: KB.brett.w, h: KNOPF.h };", "L.aktionen.brett = { x: 374, y: py - 4, w: 48, h: KNOPF.h };", 'H7: Knopf Brett doppelt in pult-terminal-tokens (statt aus PultAuftrag)'],
  [PT, "    if (b.info) P.knopf(c, A.info.x", "    P.knopf(c, A.handel.x, A.handel.y, A.handel.w, A.handel.h, 'Handel', { hotkey: kappe('terminal.handel', 'H'), fn: 'nav' });\n    if (b.info) P.knopf(c, A.info.x", 'H9: Handel steht in der Hilfe vor Info und Kurs'],
  [PT, "window.PultTerminal.zeichneBrett(cc, m.brett || {});", "window.PultTerminal.zeichneBrett(cc, L.handel, L.handelInfo, m.brett || {});", 'H8: zeichneBrett mit ungenutzten Parametern'],
  [PT, "if (b.brett) P.knopf(c, A.brett.x", "if (false) P.knopf(c, A.brett.x", 'Knopf Brett wird nicht gezeichnet'],
  [PT, "hotkey: kappe('terminal.brett', 'O'), fn: 'nav', active: b.bereich === 'brett'", "hotkey: kappe('terminal.brett', 'B'), fn: 'nav', active: b.bereich === 'brett'", 'Knopf Brett zeigt die falsche Taste'],
  [PT, "kontur: !!au.kontur, active: !!au.active", "active: !!au.active", 'Kontur-Variante geht am Terminal verloren'],
  [PT, "if (m.bereich === 'brett') { zeichneKopf(", "if (m.bereich === 'brettX') { zeichneKopf(", 'zeichneTerminal zeichnet den Bereich Brett nicht'],
  [PT, "brettAnnehmen: { aktion: 'terminal.brettAnnehmen', taste: 'Ent', fn: 'nav' },", "brettAnnehmen: { aktion: 'terminal.brettAnnehmen', taste: 'Ent', fn: 'weapon' },", 'Annehmen im Brett in der Waffenfarbe'],
  // ---- pult-terminal-brett.js: Zeichnen
  [PB, "rect(c, x, y, w, h, FA.gefahrHell);", "", 'Bake ohne helle Streifen'],
  [PB, "if (a.vorschau && a.vorschau.gefahr) { const gx", "if (false) { const gx", 'Karte nennt die Gefahr nicht'],
  [PB, "else txt(c, A.text('keineGefahr'), Ge.x, Ge.y + 1, FA.dim);", "", 'Angebot ohne Gefahr sagt nichts (Fehlen ist keine Aussage)'],
  [PB, "txt(c, kuerzen(a.ortname || '', ende - ox), ox,", "txt(c, kuerzen(a.ortname || '', 9999), ox,", 'langer Ortsname läuft in den Verfall'],
  [PB, "if (x + sep + (neu ? tw(wort) + luft : 0) + M.plakette + M.marke.pfeil + tw(A.pfeile(m.d)) > ende) break;", "", 'viele Marken laufen aus der Spalte'],
  [PB, "const fr = wartet ? A.beginnt(l.rest) :", "const fr = false ? A.beginnt(l.rest) :", 'D2: Streifen zeigt beim Warten eine Frist statt „beginnt in n Tätigkeiten“'],
  [PB, "const rechts = l.neu ? A.text('angenommen').toUpperCase() : wartet ? A.beginnt(l.rest, true) :", "const rechts = l.neu ? A.text('angenommen').toUpperCase() : false ? A.beginnt(l.rest, true) :", 'D2: HUD zeigt beim Warten eine Frist statt „in n“'],
  [PB, "const rcol = l.neu ? FA.laeuft : wartet ? FA.hudDim : v.bald ? FA.bald : FA.hudDim;", "const rcol = l.neu ? FA.laeuft : v.bald ? FA.bald : FA.hudDim;", 'D2: „in n“ im HUD in Gelb'],
  [PB, "else if (z === 'jetzt' && !wartet) { rect(c, x, y2, bw, LA.beatH, FA.laeuft);", "else if (z === 'jetzt') { rect(c, x, y2, bw, LA.beatH, FA.laeuft);", 'D2: Streifen: der wartende Beat „jetzt“ ist voll wie bei „läuft“'],
  [PB, "if (z === 'offen' || (z === 'jetzt' && wartet)) rand(c,", "if (z === 'offen') rand(c,", 'D2: HUD: der wartende Beat „jetzt“ ist voll wie bei „läuft“'],
  [PB, "const rechts = l.neu ? A.text('angenommen').toUpperCase() :", "const rechts = l.neu ? '' :", 'HUD zeigt ANGENOMMEN nicht'],
  [PB, "txt(c, kuerzen(i.grund, I.w), I.x, y, FA.bald);", "txt(c, kuerzen(i.grund, I.w), I.x, y, FA.text);", 'Absage nicht in Gelb'],
  [PB, "if (ref) {", "if (false) {", 'Gerücht ohne → [n]'],
  [PB, "if (!an.length) leer(c,", "if (false) leer(c,", 'kein leerer Zustand'],
  [PB, "if (aufFlaeche) rand(c, x - 1, y - 1, s + 2, s + 2, FA.ink);", "", 'Plakette auf Messing ohne Rahmen (1,1:1)'],
  [PB, "klick({ x: r.x, y: r.y, w: r.w, h: r.h, label: a.titel, onClick: a.onClick, disabled: false });", "", 'Karten sind nicht anklickbar'],
  [PB, "if (z === 'jetzt') rect(c, bx, y2 + H.beatH + 2 * UEBER, bw, 1, FA.hudText);", "", 'HUD: aktueller Beat nur über Farbe'],
  [PB, "bx += H.schrittLuft; if (l.gefahr) {", "bx += H.schrittLuft; if (false) {", 'HUD: Schritt mit Gefahr ohne Bake'],
  [PB, "else if (z === 'jetzt' && !wartet) { rect(c, x, y2, bw, LA.beatH, FA.laeuft); rand(c, x - 1, y2 - 1, bw + 2, LA.beatH + 2, FA.text); }", "else if (z === 'jetzt' && !wartet) { rect(c, x, y2, bw, LA.beatH, FA.laeuft); }", 'Streifen: aktueller Beat ohne Rahmen'],
  [PB, "else if (z === 'jetzt') { rand(c, x, y2, bw, LA.beatH, FA.beatOffen); rand(c, x - 1, y2 - 1, bw + 2, LA.beatH + 2, FA.text); }", "else if (z === 'jetzt') { rand(c, x, y2, bw, LA.beatH, FA.beatOffen); }", 'D2: Streifen: der wartende Beat „jetzt“ ohne Creme-Rahmen (sieht aus wie ein offener)'],
  [PB, "umbr(a.anlass || '', D.anlass.w,", "umbr('', D.anlass.w,", 'Anlass wird nicht gezeichnet'],
  // ---- R1 (lange Wörter), D1 (Titel), D3 (Marken mit Wort), D4 (Wahl), H2, H3, H6, H8
  [PB, "const umbr = (s, w, n) => T.umbruch(s, w, n).map((z) => kuerzen(z, w));", "const umbr = (s, w, n) => T.umbruch(s, w, n);", 'R1: Umbruch kappt die Zeilen nicht (ein langes Wort läuft über)'],
  [PB, "fs.filter((f) => f.text).forEach((f) => umbr(f.text, w, Z.folgeZeilen).forEach(", "fs.filter((f) => f.text).forEach((f) => T.umbruch(f.text, w, Z.folgeZeilen).forEach(", 'R1: Sätze bei Gelingt und Scheitert ohne Kappung'],
  [PB, "umbr(b.leerText || A.text('leerText'), B.w - 2 * E.x, E.zeilen)", "T.umbruch(b.leerText || A.text('leerText'), B.w - 2 * E.x, E.zeilen)", 'R1: leerText ohne Kappung'],
  [PB, "umbr(a.anlass || '', D.anlass.w,", "T.umbruch(a.anlass || '', D.anlass.w,", 'R1: Anlass ohne Kappung'],
  [PB, "txt(c, kuerzen(g.text, rx - x - IT.luft), x, y, FA.text);", "txt(c, g.text, x, y, FA.text);", 'R1: Gerücht wird nicht gekürzt'],
  [PB, "txt(c, kuerzen(a.titel, r.x + r.w - i - M.plakette - LI.titelLuft - (kx + LI.kappeLuft)), kx + LI.kappeLuft, y1, ink);", "txt(c, a.titel, kx + LI.kappeLuft, y1, ink);", 'R1: Kartentitel wird nicht gekürzt'],
  [PB, "txt(c, kuerzen(s.text, S.x + S.w - tx - tw(zusatz)), tx, y, FA.text);", "txt(c, s.text, tx, y, FA.text);", 'R1: Schritt wird nicht gekürzt'],
  [PB, "return tw(s.toUpperCase(), 1, titelO.sperr) <= w ? txt(c, s, x, y, col, titelO) : txt(c, kuerzen(s, w), x, y, col);", "return txt(c, kuerzen(s, w, titelO), x, y, col, titelO);", 'D1: Titel in Versalien, der nicht passt, wird gleich gekürzt (statt normal ohne Sperrung zu zeichnen)'],
  [PB, "return tw(s.toUpperCase(), 1, titelO.sperr) <= w ? txt(c, s, x, y, col, titelO) : txt(c, kuerzen(s, w), x, y, col);", "return tw(s.toUpperCase(), 1, titelO.sperr) <= w ? txt(c, s, x, y, col, titelO) : txt(c, s, x, y, col);", 'D1: Titel in normaler Schreibweise wird nicht gekürzt'],
  [PB, "const neu = m.art !== art, wort = A.text(m.art === 'haltung' ? 'haltung' : 'ruf');", "const neu = m.art !== art, wort = A.text('ruf');", 'D3: Haltung heißt in der Markenzeile Ruf'],
  [PB, "if (neu) x = txt(c, wort, x, y, FA.dim) + luft;", "if (neu) x += luft;", 'D3: kein Wort vor der ersten Marke der Art'],
  [PB, "tip({ x: mx, y: y - UEBER, w: x - mx, h: M.marke.h }, A.markeText(m));", "", 'D3: keine Fläche mit „Ruf Konkordat +2“ je Marke'],
  [PB, "if (inh.mk.length && rest > 0) { markenZeile(c, x, yy, w, inh.mk); yy += M.zeile; rest--; }", "", 'D3: keine Markenzeile in Gelingt und Scheitert'],
  [PB, "if (inh.mk.length && rest > 0) { markenZeile(c, x, yy, w, inh.mk); yy += M.zeile; rest--; }", "if (inh.mk.length && rest > 0) { markenZeile(c, x, yy, w, inh.mk); }", 'D3: die Markenzeile verdrängt keinen Satz (Zeile doppelt belegt)'],
  [PB, "const zusatz = s.wahl ? ' · ' + A.text('wahl') : '';", "const zusatz = '';", 'D4: Schritt mit Wahl ist nicht gekennzeichnet'],
  [PB, "tip({ x: S.x, y, w: S.w, h: M.zeile }, A.wahlText(s.wahl)); }", "}", 'D4: kein Tooltip mit den Optionen der Wahl'],
  [PB, "sn = eigen; gn = Math.min(Z.folgeMax, gesamt - eigen - (satz ? 1 : 0));", "sn = eigen; gn = G.zeilen;", 'H2: Gelingt bekommt nie mehr als 3 Zeilen'],
  [PB, "const gi = folgenInhalt(vs.gelingt, G.w), si = folgenInhalt(vs.scheitert, Sc.w), satz = !kompakt && scheitern ? scheitern : '';", "const gi = folgenInhalt(vs.gelingt, G.w), si = folgenInhalt(vs.scheitert, Sc.w), satz = '';", 'H2: der Scheitern-Satz des Servers wird nicht gezeigt'],
  [PB, "const gi = folgenInhalt(vs.gelingt, G.w), si = folgenInhalt(vs.scheitert, Sc.w), satz = !kompakt && scheitern ? scheitern : '';", "const gi = folgenInhalt(vs.gelingt, G.w), si = folgenInhalt(vs.scheitert, Sc.w), satz = scheitern || '';", 'H2: der Scheitern-Satz erscheint auch im kompakten Detail (läuft)'],
  [PB, "if (satz) { const sy = yy + Math.min(rest, inh.zeilen.length) * M.zeile; txt(c, kuerzen(satz, w), x, sy, FA.dim); tip({ x, y: sy, w, h: M.zeile }, satz); }", "if (satz) { const sy = yy + Math.min(rest, inh.zeilen.length) * M.zeile; txt(c, kuerzen(satz, w), x, sy, FA.text); tip({ x, y: sy, w, h: M.zeile }, satz); }", 'H2: der Scheitern-Satz nicht in dim'],
  [PB, "const ort = a.ortname || '', typen = Array.isArray(a.typen) ? a.typen : [];", "const ort = a.ortname || '', typen = [];", 'H3: die Karte zeigt die Typen des Servers nicht'],
  [PB, "if (x + w + Z.tagMin > ende) return;", "", 'H3: Typ-Marken im Detail laufen in den Verfall'],
  [PB, "rect(c, x, y, w, k.h, aufFlaeche ? FA.kappeGew : FA.kappe);", "rect(c, x, y, w, k.h, FA.kappe);", 'H6: Nummernkappe auf der gewählten Karte ohne eigene Farbe'],
  [PB, "bw = A.hudBeatW(b.length);", "bw = H.beatW;", 'H5: HUD-Beats ab 9 nicht schmaler'],
  [PB, "txt(c, kuerzen(l.titel, re - tw(rechts) - H.titelLuft - (x + H.innen)), x + H.innen, y1, FA.hudTitel);", "txt(c, kuerzen(l.titel, re - tw(rechts) - 6 - (x + H.innen)), x + H.innen, y1, FA.hudTitel);", 'H5: Abstand Titel zur rechten Angabe im HUD nur 6'],
  // ---- brett.js: Typprüfungen (H10), Wahl, Typen, Titel
  [BR, "if (!e || typeof e !== 'object' || !isNum(e.d) || typeof e.f !== 'string' || !e.f) return null;", "if (!e || typeof e !== 'object' || typeof e.f !== 'string' || !e.f) return null;", 'brett.js folgeAus: d muss eine Zahl sein'],
  [BR, "if (!e || typeof e !== 'object' || !isNum(e.d) || typeof e.f !== 'string' || !e.f) return null;", "if (!e || typeof e !== 'object' || !isNum(e.d) || !e.f) return null;", 'brett.js folgeAus: f muss eine Zeichenkette sein'],
  [BR, ".map(schrittAus).filter((s) => s && s.text);", ".map(schrittAus).filter((s) => s);", 'brett.js: Schritte ohne Text bleiben'],
  [BR, "if (typeof s === 'string') return { text: str(s, 60), gefahr: false, wahl: null };", "if (typeof s === 'string') return null;", 'brett.js schrittAus: Schritte als Zeichenkette fallen weg'],
  [BR, "if (!l || typeof l !== 'object' || !str(l.titel, GRENZE.titel)) return null;", "if (!l || typeof l !== 'object') return null;", 'brett.js laufendAus: ein laufendes Abenteuer ohne Titel gilt'],
  [BR, "const liste = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);", "const liste = (v, max) => (v ? v.slice(0, max) : []);", 'brett.js liste: Array.isArray wird nicht geprüft'],
  [BR, "id: a.id, titel: kurz(a.titel, GRENZE.titel),", "id: a.id, titel: str(a.titel, GRENZE.titel),", 'D1: brett.js kürzt den Titel still ohne „…“'],
  [BR, "id: str(l.id, GRENZE.id), titel: kurz(l.titel, GRENZE.titel),", "id: str(l.id, GRENZE.id), titel: str(l.titel, GRENZE.titel),", 'D1: brett.js kürzt den laufenden Titel still ohne „…“'],
  [BR, "wahl: wahlAus(s.wahl) };", "wahl: null };", 'D4: brett.js verwirft die Wahl'],
  [BR, ".slice(0, GRENZE.wahl).map(", ".map(", 'D4: brett.js begrenzt die Zahl der Optionen nicht'],
  [BR, "filter((o) => o && typeof o === 'object' && str(o.text, GRENZE.wahlText))", "filter((o) => o)", 'D4: brett.js prüft die Optionen der Wahl nicht'],
  [BR, "typen: liste(a.typen, GRENZE.typen * 4).filter((t) => typeof t === 'string' && t.trim()).slice(0, GRENZE.typen).map(", "typen: liste(a.typen, 99).map(", 'H3: brett.js prüft die Typen nicht (Typ, Anzahl)'],
  [BR, "const GRENZE = { angebote: 3, geruechte: 3, schritte: 12, folgen: 8, titel: 40,", "const GRENZE = { angebote: 3, geruechte: 3, schritte: 12, folgen: 8, titel: 26,", 'D1: Anzeige kürzt den Titel schon auf 26'],
  [PA, "kappeGew: '#443728',", "kappeGew: '#000000',", 'H6: Kappenfarbe auf Messing ist nicht die Mischung'],
  [PA, "function beginnt(rest, kurz) {", "function beginnt(rest, kurz) { rest = 0;", 'D2: „beginnt in n“ nennt nicht die Tätigkeiten bis zum Schritt'],
  [PA, "const hudBeatW = (n) => (n >= MASS.hud.schmalAb ? MASS.hud.beatWSchmal : MASS.hud.beatW);", "const hudBeatW = (n) => MASS.hud.beatW;", 'H5: hudBeatW kennt keine schmalen Beats'],
  [PA, "const wahl = Array.isArray(s.wahl) && s.wahl.length ?", "const wahl = false ?", 'D4: PultAuftrag.schritt reicht die Wahl nicht durch'],
  [PA, "function markeText(m) { return m && m.f ? text(m.art === 'haltung' ? 'haltung' : 'ruf')", "function markeText(m) { return m && m.f ? text('ruf')", 'D3: markeText nennt Haltung als Ruf'],
  [PA, "hilfeGesperrt: '{wahl} wählen · {ab} ablehnen kostet nichts',", "hilfeGesperrt: '{wahl} wählen · {an} annehmen · {ab} ablehnen',", 'H4: hilfeGesperrt nennt Annehmen'],
  // ---- Tasten und Anschluss
  [TA, "A('terminal.brett', 'terminal', 'Bereich Brett (Auftragsbrett, Freie Fahrt)', ['KeyO']),", "A('terminal.brett', 'terminal', 'Bereich Brett (Auftragsbrett, Freie Fahrt)', ['KeyB']),", 'Brett auf B (kollidiert mit Beleg)'],
  [TA, "A('terminal.brettAblehnen', 'terminal', 'Angebot ablehnen (kostet nichts)', ['KeyX'], 'terminal.brett'),", "A('terminal.brettAblehnen', 'terminal', 'Angebot ablehnen (kostet nichts)', ['KeyN'], 'terminal.brett'),", 'Ablehnen im Brett auf N'],
  [TA, "A('terminal.brettAnnehmen', 'terminal', 'Abenteuer annehmen (die Crew entscheidet)', ['Enter', 'NumpadEnter'], 'terminal.brett'),", "A('terminal.brettAnnehmen', 'terminal', 'Abenteuer annehmen (die Crew entscheidet)', ['Enter', 'NumpadEnter']),", 'Annehmen im Brett ohne Bereich (kollidiert mit Kaufen)'],
  [TA, "'terminal.brett': { name: 'Bereich Brett (Auftragsbrett)' },", "", 'Bereich Brett ohne Namen im Menü'],
  [CO, "tu.bereichJetzt === 'brett' ? 'terminal.brett' : tu &&", "tu &&", 'umbelegte Tasten gelten im Brett nicht'],
  [CL, "ev.kind === 'abenteuerAntwort' ||", "", 'client.js reicht abenteuerAntwort nicht an das Terminal'],
  [HU, "planY = this.drawAbenteuerStreifen(ctx, planY);", "this.drawAbenteuerStreifen(ctx, planY);", 'Planungszeile liegt unter dem Abenteuer-Streifen'],
  [HU, "Brett.frisch(BR.laufend)", "false", 'HUD zeigt ANGENOMMEN nie'],
  [WE, "msg.b === 'b' ? 'b' : 'w';", "'w';", 'der Server reicht b = b nicht an die Zuschauer durch'],
  [IX, "<script src=\"js/brett.js\"></script>", "", 'brett.js wird nicht geladen'],
];

// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie). Sonst bricht die Probe mit Exit 2 ab.
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
const lauf = ([test, ...arg]) => spawnSync(process.execPath, [test, ...arg], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
// rot = der Test hat eine Prüfung verfehlt (Exit 1 mit FEHLER-Zeile); alles andere (Absturz, Zeitlimit) ist KEIN Beleg
const einstufung = (r) => {
  if (r.status === 0) return 'gruen';
  const text = (r.stdout || '') + (r.stderr || '');
  if (r.status === 1 && text.split('\n').some((l) => /FEHLER/.test(l) && !/Ausnahme/.test(l))) return 'rot';
  return 'absturz';
};
let ueberlebt = 0, abstuerze = 0, gelaufen = 0;
console.log(`Mutationsprobe Auftragsbrett-Anzeige (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
for (const t of TESTS) {
  const basis = lauf(t);
  const e = einstufung(basis);
  console.log(`  Ausgangslage ${t.join(' ')}: ${e === 'gruen' ? 'grün' : 'ROT oder Absturz (Abbruch)'}`);
  if (e !== 'gruen') { console.log(((basis.stdout || '') + (basis.stderr || '')).split('\n').filter((l) => /FEHLER|Error/.test(l)).slice(0, 5).join('\n')); process.exit(1); }
}
for (const [datei, alt, neu, was] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  if (text.split(alt).length !== 2) { console.log(`  ?? ${was}: Textstelle nicht eindeutig (${datei})`); ueberlebt++; continue; }
  const neuerText = text.replace(alt, () => neu);
  fs.writeFileSync(f, nl ? neuerText.replace(/\n/g, '\r\n') : neuerText);
  let wer = null, stufe = 'gruen', r = null;
  for (const t of TESTS) {
    r = lauf(t);
    const e = einstufung(r);
    if (e === 'rot') { wer = path.basename(t[0], '.js').replace('test-', ''); stufe = 'rot'; break; }
    if (e === 'absturz') { stufe = 'absturz'; wer = path.basename(t[0], '.js').replace('test-', ''); break; }
  }
  fs.writeFileSync(f, orig);
  const fehler = ((r && r.stdout) || '').split('\n').filter((l) => /FEHLER/.test(l) && !/Ausnahme/.test(l));
  if (stufe === 'rot') console.log(`  rot   ${was} (${wer}: ${fehler.length} Fehler, z. B. ${(fehler[0] || '').replace(/^\s*FEHLER\s*/, '').slice(0, 64)})`);
  else if (stufe === 'absturz') { abstuerze++; ueberlebt++; console.log(`  ABSTURZ ${was} (${wer}: Exit ${r.status}, zählt NICHT als erkannt: ${((r.stderr || r.stdout || '').split('\n').find((l) => /Error|FEHLER/.test(l)) || '').slice(0, 80)})`); }
  else { ueberlebt++; console.log(`  GRÜN  ${was}  <-- ÜBERLEBT`); }
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
const erkannt = gelaufen - ueberlebt;
console.log(`${erkannt} von ${gelaufen} Mutationen erkannt` + (abstuerze ? ` (${abstuerze} Absturz, nicht gezählt)` : '') + (ueberlebt ? `, ${ueberlebt} überlebt oder abgestürzt` : ''));
process.exit(ueberlebt ? 1 : 0);
