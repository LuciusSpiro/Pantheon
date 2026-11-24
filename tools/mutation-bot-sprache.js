'use strict';
// BOT-04 C2: Mutationsprobe zu tools/test-bot-sprache.js (Sprechspalte im HUD: hud.js, Kern und HUD-Adapter: bot-sprache.js).
// Kopiert public/js und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel und verlangt, dass der Test rot wird (Exit 1 mit FEHLER-Zeile).
// Bleibt er grün, deckt kein Test die Regel ab; Abstürze (Exit ungleich 0 und 1) zählen NICHT als erkannt. Der Selbstcheck verlangt, dass jeder Anker genau einmal im Quelltext steht (Exit 2, wenn nicht).
//   node tools/mutation-bot-sprache.js [--trocken] [begriff …]
// Bewusst nicht abgedeckt: die Pixel (echter Browser, Screenshots) und der Audio-Adapter (audioBrowser, braucht ein echtes Audio-Element).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-botsprache-'));
const ende = (code) => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } process.exit(code); };   // das Temp-Verzeichnis geht bei jedem Ausgang weg, auch bei Exit 1 und 2
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'shared'), path.join(TMP, 'shared'), { recursive: true });
fs.cpSync(path.join(ROOT, 'server'), path.join(TMP, 'server'), { recursive: true });   // D1: test-bot-sprache-server.js fährt den echten Server (Game, Bots)
if (fs.existsSync(path.join(ROOT, 'package.json'))) fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));   // D1: test-bot-sprache-net.js braucht Matcher und Protokoll, den Kanon und die Muster
fs.cpSync(path.join(ROOT, 'content'), path.join(TMP, 'content'), { recursive: true });   // D1: auch der Servertest liest Spieldaten (Waren, Bots)
for (const f of ['hud.js', 'bot-sprache.js', 'bot-menue.js', 'consoles.js']) { const p = path.join(TMP, 'public', 'js', f); fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')); }   // Anker ohne CRLF-Sorgen
for (const f of ['test-bot-sprache.js', 'test-bot-sprache-net.js', 'test-bot-sprache-server.js', 'test-bot-sprache-pegel.js', 'test-bot-katalog.js']) fs.copyFileSync(path.join(ROOT, 'tools', f), path.join(TMP, 'tools', f));
fs.cpSync(path.join(ROOT, 'tools', 'fixtures', 'bot-messung'), path.join(TMP, 'tools', 'fixtures', 'bot-messung'), { recursive: true });   // D2: der Katalogtest liest die Phrasenlisten

const CL = 'public/js/client.js', HU = 'public/js/hud.js', BS = 'public/js/bot-sprache.js', CO = 'public/js/consoles.js', BMN = 'public/js/bot-menue.js';
const NET = 'test-bot-sprache-net.js';   // D1: Mutationen am Net-Transport und an sprachBefehl prüft dieser Test (fünftes Element), alle anderen test-bot-sprache.js
const PEG = 'test-bot-sprache-pegel.js', KAT = 'test-bot-katalog.js';   // D2: Stille-Schranke und Messkatalog gegen den Matcher
const SRV = 'test-bot-sprache-server.js';   // D1: Mutationen an der Reihenfolge Eintrag/Senden prüft der Servertest (synchrone Brücke: die Antwort kommt noch im send)
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, Testdatei?]
const MUTATIONEN = [
  [HU, "const oda = view.voxel && window.Sitz && Sitz.station ? this.odaHoeheOben() : 0;", "const oda = 0;", 'Voxel-Sitz: Spalte ignoriert die ODA oben'],
  [HU, "const oda = view.voxel && window.Sitz && Sitz.station ? this.odaHoeheOben() : 0;", "const oda = this.odaHoeheOben();", 'Konsole 2D: auch eine verdeckte ODA zählt'],
  [HU, "this.lagefunkTafelUnten(view), window.Consoles", "0, window.Consoles", 'Konsole: Lagetafel wird ignoriert'],
  [HU, "Consoles.helmAlertUnten ? Consoles.helmAlertUnten(view) : 0);", "0);", 'Steuer: Ausweich-Anzeige wird ignoriert'],
  [HU, "Math.max(20 + oda, unter + 4) : 20 + oda", "Math.max(20 + oda, unter) : 20 + oda", 'Konsole: kein Abstand von 4 px unter Tafel/Anzeige'],
  [HU, "if (!f || this.lagefunkEinzeilig(view)) return 0;", "if (!f) return 0;", 'Konsole: einzeilige Lagezeile zählt als Tafel'],
  [CO, "return s && view && s.zeit === view.time ? s.unten : 0;", "return s ? s.unten : 0;", 'Steuer-Anzeige: Unterkante gilt auch in späteren Bildern'],
  [CO, "this.helmAlertStand = { zeit: view.time, unten };", "this.helmAlertStand = { zeit: view.time, unten: 0 };", 'Steuer-Anzeige: Unterkante wird nicht gemerkt'],
  // S1 / H2
  [BS, "if (c && c.tastenFreigeben) c.tastenFreigeben();", "", 'Textzeile öffnen: Spieltasten bleiben gehalten'],
  [BS, "if (win.Client && win.Client.tastenFreigeben) win.Client.tastenFreigeben();", "", 'Textzeile schließen: Tasten bleiben hängen'],
  [BS, "if (c && c.eingabeFrei && !c.eingabeFrei()) return false;", "", 'Textzeile öffnet hinter Overlays (Menü, Minispiel, Zusehen)'],
  [HU, "&& !Client.eingabeFrei()) sp.zeile.schliessen();", "&& false) sp.zeile.schliessen();", 'Overlay geht auf: Textzeile bleibt offen'],
  // H3
  [BS, "marke.offen = false; s.verarbN--; verarbStand();", "marke.offen = false; s.verarbN = 0; verarbStand();", '„…“ endet mit dem ersten von mehreren Abläufen'],
  [BS, "const verarbBeginn = () => { s.verarbN++;", "const verarbBeginn = () => { s.verarbN = 1;", '„…“ als Flag statt Zähler'],
  // H4
  [HU, "text = String(text).slice(0, SPRECH_MAXZEICHEN);", "text = String(text);", 'Untertitel: Text nicht gekappt'],
  [HU, "this.fitWort(lines.slice(1).join(' '), maxT, 1)", "this.fit(lines.slice(1).join(' '), maxT, 1)", 'Untertitel: zweite Zeile mitten im Wort gekürzt'],
  // S3
  [HU, "for (let i = E.length - 1; i >= 0; i--) if (E[i].text === text && E[i].who === who) E.splice(i, 1);", "", 'Untertitel: kein Dedupe'],
  [HU, "for (let i = E.length - 1; i >= 0; i--) if (E[i].text === text && E[i].who === who) E.splice(i, 1);", "for (let i = E.length - 1; i >= 0; i--) if (E[i].text === text) E.splice(i, 1);", 'Untertitel: Dedupe ohne Sprecher'],
  [HU, "if (e.id !== id) continue;", "", 'Clip-Halt trifft alle Einträge'],
  [BS, "        schliesse(); entferne(letzteMeldung); entferne(stickyText);", "        entferne(letzteMeldung); entferne(stickyText);", 'aus(): offene Textzeile bleibt'],
  [HU, "performance.now() - sp.tFrame > 1500 && sp.zeile.schliessen) sp.zeile.schliessen();", "performance.now() - sp.tFrame > 4900 && sp.zeile.schliessen) sp.zeile.schliessen();", 'Textzeile: Schließgrenze 4,9 s statt 1,5 s'],
  [HU, "if (oda > 0) oben = VH - 6 - oda;", "", 'zu Fuß: Spalte ignoriert die ODA unten'],
  [HU, "oben = Math.min(oben, this.oda.cur ? r.y - 14 : r.y);", "oben = Math.min(oben, r.y);", 'Scanner mit ODA: Marke ODA +n wird überdeckt'],
  [HU, "const r = Scanner.rechteck();", "const r = { y: 400 };", 'Scanner-Overlay wird ignoriert'],
  [HU, "Funkwahl.rechteck(null, null, undefined, view).y);", "400);", 'Funkwahl-Antwortleiste wird ignoriert'],
  [HU, "if (gr) oben = Math.min(oben, gr.y);", "", 'Gesprächsfenster wird ignoriert'],
  [HU, "oben = Math.min(oben, this.kontingentLeiste(view).y);", "", 'Kontingent-Frage wird ignoriert'],
  [HU, "y: oben < VH - 6 ? oben - 4 : oben, richtung: 'hoch'", "y: oben, richtung: 'hoch'", 'kein Abstand von 4 px über den Elementen'],
  [HU, "const x = Math.round(VW / 2 - SPRECH_W / 2);", "const x = 20;", 'Spalte nicht deckungsgleich mit der ODA-Spalte'],
  [HU, "Math.max(3, Math.min(8, 2.5 + String(text == null ? '' : text).length / 15))", "Math.max(3, Math.min(12, 2.5 + String(text == null ? '' : text).length / 15))", 'Dauer: Obergrenze 8 s'],
  [HU, "Math.max(3, Math.min(8, 2.5", "Math.max(2, Math.min(8, 2.5", 'Dauer: Untergrenze 3 s'],
  [HU, "length / 15))", "length / 10))", 'Dauer: Zeichen je Sekunde'],
  [HU, "while (E.length > 2) E.shift();", "while (E.length > 3) E.shift();", 'Stapel: mehr als 2 Einträge'],
  [HU, "let n = rec ? 1 : 2;", "let n = 2;", 'Aufnahme ersetzt den untersten Platz nicht'],
  [HU, "if ((this.sprech.aktiv || this.sprech.bots) && !inConsole) Net.guard('Hud.sprechspalte'", "if (this.sprech.aktiv || this.sprech.bots) Net.guard('Hud.sprechspalte'", 'Sprechspalte auch vor der Konsole (die Konsole deckt sie zu)'],
  [CL, "if (H.sprech.aktiv || H.sprech.bots) Net.guard('Hud.sprechspalteKonsole', () => H.zeichneSprechspalte(ctx, v));", "", 'Sprechspalte an der Konsole fehlt'],
  [HU, "return e.halt ? e.t + 30 : (e.bis || e.t + e.d);", "return e.halt ? Infinity : (e.bis || e.t + e.d);", 'Halt ohne Obergrenze'],
  [HU, "performance.now() / 1000 + 0.5); }", "performance.now() / 1000); }", 'nach Clip-Ende keine 0,5 s'],
  [HU, "e.bis = Math.max(e.t + e.d, performance", "e.bis = Math.max(0, performance", 'nach Clip-Ende nicht mindestens die Grunddauer'],
  [HU, "(this.crewFunkEnde(e) - now) / 0.4", "(this.crewFunkEnde(e) - now) / 4", 'Ausblenden dauert nicht 0,4 s'],
  [HU, "R.backdrop(ctx, x, ey, e.w, e.h, 0.85);", "R.backdrop(ctx, x, ey, e.w, e.h, 0.5);", 'Untergrund der Untertitel nicht 0,85'],
  [HU, "while (von < cur && R.measure(wert.slice(von, cur), 1) > innen - 6) von++;", "", 'lange Eingabe scrollt nicht'],
  [HU, "if (z) this.zeichneTextzeile(ctx, view, z, slot.x, stelle(14), slot.w, FN);", "if (z) this.zeichneTextzeile(ctx, view, z, slot.x, stelle(14) + 3, slot.w, FN);", 'Textzeile nicht ganz unten in der Spalte'],
  [HU, "if (sp.aktiv && sp.zeile && sp.zeile.offen && performance.now() - sp.tFrame > 1500", "if (sp.aktiv && sp.zeile && sp.zeile.offen && false", 'Textzeile bleibt ohne Spielbild offen'],
  [HU, "ctx.fillStyle = e.farbe; ctx.fillRect(x, ey, 2, e.h);", "", 'kein Farbbalken'],
  [HU, "{ color: FN.cmd, shadow: false });\n        ctx.globalAlpha = 1;", "{ color: e.farbe, shadow: false });\n        ctx.globalAlpha = 1;", 'Untertiteltext nicht Creme'],
  [BS, "const ENDUNGEN = ['wav', 'ogg'];", "const ENDUNGEN = ['ogg', 'wav'];", 'Clipwahl: ogg vor wav'],
  [BS, "      const marke = verarbBeginn();   // Zwischenzustand", "      const marke = { offen: false };   // Zwischenzustand", 'Zwischenzustand wird nie gemeldet'],
  [BS, "        } finally { verarbEnde(marke); }", "        } finally { /* nichts */ }", 'Zwischenzustand bleibt bei Fehlern hängen'],
  [BS, "      verarbEnde(marke);   // das Ergebnis ist da", "      // das Ergebnis ist da", 'Zwischenzustand endet nicht mit dem Ergebnis'],
  [BS, "const UNKLAR_DAUER_S = 2.5;", "const UNKLAR_DAUER_S = 4;", '„Bitte wiederholen“ nicht 2,5 s'],
  [BS, "const ROLLEN = { b0: 'NAVIGATION', b1: 'OPS', b2: 'TECHNIK' };", "const ROLLEN = { b0: 'OPS', b1: 'NAVIGATION', b2: 'TECHNIK' };", 'Rollennamen vertauscht'],
  [BS, "{ botId: msg.botId });", "{ botId: null });", 'Antwort ohne botId an die Anzeige'],
  [BS, "ende: () => clipHalt(id, false) }", "ende: () => {} }", 'Clip-Ende erreicht die Anzeige nicht'],
  [BS, "start: () => clipHalt(id, true),", "start: () => {},", 'Clip-Start erreicht die Anzeige nicht'],
  [BS, "if (n === 'keydown' && e.key === 'Escape') { if (e.preventDefault) e.preventDefault(); schliesse(); }", "if (n === 'keydown' && e.key === 'Escape') { if (e.preventDefault) e.preventDefault(); }", 'Esc schließt die Textzeile nicht'],
  [BS, "if (zeile.offen && !feld.value) schliesse();", "if (zeile.offen) schliesse();", 'Fokusverlust schließt auch mit Text'],
  [BS, "if (zeile.offen && !feld.value) schliesse();", "if (false) schliesse();", 'Fokusverlust schließt nie'],
  [BS, "const t = feld.value; schliesse(); onText(t);", "const t = feld.value; onText(t);", 'Enter sendet, schließt aber nicht'],
  [BS, "const t = feld.value; schliesse(); onText(t);", "const t = feld.value; schliesse();", 'Enter sendet nicht'],
  [BS, "e.stopPropagation(); if (n === 'keydown'", "if (n === 'keydown'", 'Tasten der Textzeile erreichen das Spiel'],
  [BS, "Math.floor(b.left + r.x * sc), Math.floor(b.top + r.y * sc)", "Math.floor(b.left + r.x), Math.floor(b.top + r.y)", 'Eingabefeld ohne Skalierung'],
  [BS, "Math.floor(r.w * sc), Math.floor(r.h * sc)]", "Math.floor(r.w), Math.floor(r.h)]", 'Eingabefeld ohne Größenskalierung'],
  [BS, "if (!h || !h.sprechBereit || !h.sprechBereit()) return false;", "if (!h) return false;", 'Textzeile öffnet auch ohne Spielbild'],
  [BS, "feld.setAttribute('maxlength', '120');", "feld.setAttribute('maxlength', '999');", 'Eingabe nicht auf 120 begrenzt'],
  [BS, "pointerEvents: 'none', margin: '0', padding: '0' });", "pointerEvents: 'auto', margin: '0', padding: '0' });", 'geschlossenes Eingabefeld fängt Mausklicks'],
  [BS, "t === TEXT.maxDauer ? 3600 : 6", "6", 'Meldung „Aufnahme nach 60 s beendet“ verschwindet'],
  [BS, "if (an) { h.sprech.verarbeitet = false; entferne(stickyText); stickyText = null; }", "if (an) { h.sprech.verarbeitet = false; }", 'Dauer-Meldung bleibt nach der nächsten Aufnahme'],
  [BS, "h.pushNotice(t, FN().warn,", "h.pushNotice(t, FN().sensor,", 'Meldung nicht in Warnfarbe'],
  [BS, "e && e.fehler === 'stt-aus' ? TEXT.sttNichtEingerichtet : TEXT.sttAus", "TEXT.sttAus", 'STT nicht eingerichtet nicht unterschieden'],
  [BS, "if (j && j.fehler === 'stt-aus') e.fehler = 'stt-aus';", "", 'Client liest 503 stt-aus nicht'],
  [BS, "' halten = sprechen, '", "' = sprechen, '", 'Startnotiz ohne „halten“'],
  // BOT-04 D1: Net-Transport, Anschluss an das Menü, Sprach-Einträge
  [BS, "try { vermerk = env.vorSenden(msg); } catch (e) { vermerk = null; }", "vermerk = null;", 'D1: die Sprache ruft sprachBefehl nicht auf (kein Eintrag, keine Quittung, kein „gilt“)', NET],
  [BS, "if (!ok) { if (env.verworfen && vermerk)", "if (!ok) { if (false)", 'D1: Sendefehler nimmt den Eintrag nicht zurück', NET],
  [BS, "send(obj) { if (!offen()) return false;", "send(obj) {", 'D1: Net-Transport meldet bei getrennter Verbindung Erfolg', NET],
  [BS, "const weg = Net.on((m) => { if (m && m.t === 'bot.antwort') fn(m); });", "const weg = Net.on((m) => { fn(m); });", 'D1: Net-Transport reicht jede Nachricht durch', NET],
  [BS, "netz: true,", "netz: false,", 'D1: Net-Transport meldet netz: false (zwei Verarbeiter je Antwort)', NET],
  [BS, "win.Net ? transportNet(win.Net) : transportNetStub();", "transportNetStub();", 'D1: starte nimmt nie den Net-Transport', NET],
  [BS, "(mockOk ? transportWebSocket(mockUrl, win.WebSocket) : transportNetStub())", "(mockOk ? transportWebSocket(mockUrl, win.WebSocket) : transportNet(win.Net))", 'D1: verbotener Mock fällt auf die echte Verbindung', NET],
  [BS, "...(transport.netz === true ? menueAnschluss(", "...(false ? menueAnschluss(", 'D1: starte hängt die Sprache nicht an das Menü', NET],
  [BMN, "if (p.gilt && offene === 1) s.gilt[rolle] = p.gilt; else delete s.gilt[rolle];", "s.gilt[rolle] = p.gilt;", 'D1: nicht abbildbarer Wert setzt ein falsches „gilt“', NET],
  [BMN, "if (Object.keys(a0).some((k) => k !== 'meter' && namen.indexOf(k) < 0)) continue;", "", 'D1: fremde Argumente passen auf einen Eintrag', NET],
  [BMN, "msg.an === 'alle' ? Math.max(1, s.botsN) : 1, gilt);", "1, gilt);", 'D1: an alle erwartet nur eine Antwort', NET],
  [BMN, "? msg.an : botRolle || e.an;   // botId", "? e.an : botRolle || e.an;   // botId", 'D1: Rolle des Adressaten wird ignoriert', NET],
  [BMN, "s.ausstehend.splice(i, 1);", "", 'D1: verworfener Eintrag bleibt stehen', NET],
  [BS, "if (env.vorSenden) { try { vermerk = env.vorSenden(msg); } catch (e) { vermerk = null; } }\n      let ok = false;\n      try { ok = env.transport.send(msg) !== false; } catch (e) { ok = false; }", "let ok = false;\n      try { ok = env.transport.send(msg) !== false; } catch (e) { ok = false; }\n      if (env.vorSenden) { try { vermerk = env.vorSenden(msg); } catch (e) { vermerk = null; } }", 'D1: vorSenden (Eintrag) erst nach dem Senden', SRV],
  [BMN, "{ if (!p) p = q; offene++; }", "{ p = q; offene++; }", 'D1: Antwort wird dem JÜNGSTEN offenen Eintrag zugeordnet (LIFO statt FIFO)', NET],
  [BMN, "if (p.gilt && offene === 1) s.gilt[rolle]", "if (p.gilt) s.gilt[rolle]", 'D1: „gilt“ auch bei mehreren offenen Einträgen', NET],
  [BMN, "? s.botRolle[msg.an] : null;", "? null : null;", 'D1: bot.status an botId: Quittung ignoriert die bekannte Rolle des Bots', NET],
  [BMN, "msg.an === 'alle' ? Math.max(1, s.botsN) : 1, gilt);", "an === 'alle' ? Math.max(1, s.botsN) : 1, gilt);", 'D1: erwartet folgt dem aufgelösten Adressaten statt dem genannten (botId erwartet 4)', NET],
  [BMN, "s.quittung = p.vorher || null;", "s.quittung = null;", 'D1: Verwerfen stellt die vorige Quittung nicht wieder her', NET],
  // BOT-04 D2: Stille-Schranke und Messkatalog (der Pegel-Teil im Browser, pegelMesser, ist nur im echten Browser prüfbar: dort mit --use-fake-device-for-media-stream von Hand gemessen)
  [BS, "if (typeof aufn.pegel === 'number' && aufn.pegel < PEGEL_MIN) {", "if (false) {", 'D2: Stille-Schranke entfernt (Stille geht an STT)', PEG],
  [BS, "aufn.pegel < PEGEL_MIN) {", "aufn.pegel > PEGEL_MIN) {", 'D2: Vergleich der Stille-Schranke invertiert', PEG],
  [BS, "aufn.pegel < PEGEL_MIN) {", "aufn.pegel <= PEGEL_MIN) {", 'D2: Grenze exakt zählt schon als Stille', PEG],
  [BS, "const PEGEL_MIN = 0.005;", "const PEGEL_MIN = 0.2;", 'D2: Grenze auf hohen Wert (leises Sprechen wird verworfen)', PEG],
  [BS, "if (typeof aufn.pegel === 'number' && aufn.pegel < PEGEL_MIN) {", "if (aufn.pegel < PEGEL_MIN) {", 'D2: pegel null (kein Web Audio) blockiert STT', PEG],
  [BS, "if (s.messmodus) await messeStille(aufn);", "", 'D2: Stille im Messmodus ohne eigenen Eintrag', PEG],
  [BS, "meldung(TEXT.stille); return false;", "return false;", 'D2: Stille ohne Meldung', PEG],
  [BS, "stille: true, pegel: aufn.pegel,", "stille: false, pegel: aufn.pegel,", 'D2: Stille-Eintrag nicht als stille markiert', PEG],
  [BS, "pegel: x.pegel == null ? null : x.pegel,", "", 'D2: Messeintrag ohne Pegel', PEG],
  [BS, "pegel: typeof aufn.pegel === 'number' ? aufn.pegel : null });", "});", 'D2: Pegel erreicht den Messeintrag nicht', PEG],
  [BS, "const v = Math.abs(samples[i]); if (v > m && isFinite(v)) m = v;", "const v = samples[i]; if (v > m && isFinite(v)) m = v;", 'D2: Spitze ohne Betrag (negative Ausschläge zählen nicht)', PEG],
  [BS, "if (v > m && isFinite(v)) m = v;", "if (v > m) m = v;", 'D2: Spitze lässt Unendlich zu', PEG],
  [BS, "    if (erwartet === null) return !res;\n", "", 'D2: erwartet null (bewusst nicht erkennbar) wird nicht als richtig gewertet', KAT],
];

const nur = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const trocken = process.argv.includes('--trocken');
let schlecht = 0;
for (const [datei, alt, , text] of MUTATIONEN) {
  if (nur.length && !nur.some((b) => text.includes(b))) continue;   // mit Begriff: nur die gewählten Anker prüfen
  const n = fs.readFileSync(path.join(TMP, datei), 'utf8').split(alt).length - 1;
  if (n !== 1) { console.log('ANKER ' + (n ? 'mehrfach (' + n + 'x)' : 'fehlt') + ': ' + datei + ' :: ' + alt.slice(0, 70)); schlecht++; }
}
if (schlecht) { console.log(schlecht + ' Anker ungültig'); ende(2); }
if (trocken) { console.log('alle ' + MUTATIONEN.length + ' Anker eindeutig'); ende(0); }

let erkannt = 0, offen = 0, abstuerze = 0;
const lauf = (test) => spawnSync(process.execPath, ['tools/' + (test || 'test-bot-sprache.js')], { cwd: TMP, encoding: 'utf8', timeout: 120000 });
for (const t of [null, NET, SRV, PEG, KAT]) { const basis = lauf(t); if (basis.status !== 0) { console.log('Basis ist nicht grün (' + (t || 'test-bot-sprache.js') + ', Exit ' + basis.status + ')'); console.log(String(basis.stderr || basis.stdout || '').slice(-500)); ende(2); } }
for (const [datei, alt, neu, text, test] of MUTATIONEN) {
  if (nur.length && !nur.some((b) => text.includes(b))) continue;
  const pfad = path.join(TMP, datei), orig = fs.readFileSync(pfad, 'utf8');
  fs.writeFileSync(pfad, orig.replace(alt, () => neu));
  const r = lauf(test);
  fs.writeFileSync(pfad, orig);
  const rot = r.status === 1 && /FEHLER/.test(r.stdout || '');
  if (rot) erkannt++; else if (r.status === 0) { offen++; console.log('NICHT ERKANNT: ' + text); } else { abstuerze++; console.log('ABSTURZ (zählt nicht): ' + text + ' (Exit ' + r.status + ')'); }
}
console.log('Mutationen: ' + erkannt + ' erkannt, ' + offen + ' nicht erkannt, ' + abstuerze + ' Abstürze');
ende(offen || abstuerze ? 1 : 0);
