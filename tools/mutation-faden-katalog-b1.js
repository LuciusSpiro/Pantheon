'use strict';
// SUND-04b B1: Mutationsprobe zu tools/test-faden-katalog-b1.js (Bausteine geruecht, spur, wiedersehen; Pruefer-Regeln nsc_alt, hex, nsc_von; Wiedersehen in faden.js; Expander; Mock und Kontext; Daten). Kopiert Server, Shared,
// Content und den Test in ein Temp-Verzeichnis (das Repo bleibt unberuehrt), aendert dort je Lauf EINE Regel und verlangt, dass der Test rot wird (Exit != 0 mit mindestens einer FEHLER-Zeile). Ueberlebt eine Mutation, deckt der
// Test die Regel nicht ab. Selbstcheck: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst bricht die Probe mit Exit 2 ab.
//   node tools/mutation-faden-katalog-b1.js [begriff ...] [--trocken]      (npm run test:faden-katalog-b1-mutation)
// Bewusst nicht in der Liste (aequivalente Mutanten): die Form der NSC-Kennung in pruefeNscVon (n und Ziffern: jede andere Zeichenfolge findet in wiedersehenNsc ohnehin keinen NSC, die Regel ist ein zweites Netz), „Number.isFinite(haltung)“
// in wiedersehenNsc (jeder NSC aus dem Leser hat eine endliche Haltung), „spielbar(n)“ im Wegsucher erreichbar() (jeder Nachbar ueber eine offene Kante der Karte ist spielbar), die Pruefung der Spur-Id in spur.starten (ein
// Parameter, der nicht in spuren steht, scheitert schon an der Datei: spur.js datei() verlangt eine Id a-z0-9_), die Mindestlaenge der Texte (8 Zeichen) in katalogFehler.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-b1-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TESTS = [['tools/test-faden-katalog-b1.js']];
for (const [t] of TESTS) fs.copyFileSync(path.join(ROOT, t), path.join(TMP, t));
for (const h of ['regie-fixture.js', 'faden-fixture.js']) fs.copyFileSync(path.join(ROOT, 'tools', h), path.join(TMP, 'tools', h));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul noetig */ } }

const B1 = 'server/sim/faden-b1.js', PR = 'server/sim/faden-pruefer.js', FA = 'server/sim/faden.js', BPF = 'server/sim/faden-bauplan.js', RE = 'server/sim/reise-ereignis.js', BS = 'server/sim/faden-bausteine.js',
  AP = 'server/sim/abenteuer-prompt.js', AM = 'server/sim/abenteuer-mock.js', DB = 'content/faeden/beats.json', DT = 'content/faeden/b1-texte.json', SK = 'content/spuren/kantenpfad.json', SF = 'content/spuren/fundort.json', SYS = 'content/spielleiter/prompts/abenteuer.system.md';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  // ---- Baustein: Wege und Ziel
  [B1, "|| !ex.kanteOffen(Sektoren.kanteId(e.a, e.b))) continue;", ") continue;", 'Wegsuche: auch verborgene und verschlossene Kanten zaehlen als Weg'],
  [B1, " && !Sektoren.sperrtext(h)).map(([h]) => h).sort();", ").map(([h]) => h).sort();", 'Ziel: auch ein Sektor mit Sperrtext der Region'],
  [B1, "s >= W.ziel.min && s <= W.ziel.max", "s >= 0 && s <= W.ziel.max", 'Ziel: auch der Sektor der Crew selbst'],
  [B1, "const r = erreichbar(game, hierHex(game), W.ziel.max);\n  const k = Array.from(r).filter(([h, s]) => s >= W.ziel.min && s <= W.ziel.max &&", "const r = erreichbar(game, hierHex(game), W.ziel.erreichbar_max);\n  const k = Array.from(r).filter(([h, s]) => s >= W.ziel.min &&", 'Ziel: beliebig weit weg'],
  [B1, "if (z) faden.parameter.ort = z;", "", 'Ort der Geschichte wandert nicht zum genannten Sektor'],
  // ---- Baustein: geruecht
  [B1, "if (!hex) { baustLog(game, faden, ctx.beat, 'abgelehnt', 'Ger", "if (false) { baustLog(game, faden, ctx.beat, 'abgelehnt', 'Ger", 'Geruecht: ohne Sektor laeuft der Beat trotzdem'],
  [B1, "const f = sprecher ? Bitte().funkSprecher(game, sprecher, text) :", "const f = false ? Bitte().funkSprecher(game, sprecher, text) :", 'Geruecht: der Hafenfunk spricht nicht (NSC statt Kanal geruecht)'],
  [B1, "const key = typeof tk === 'string' && has(T, tk) ? tk : 'geruecht_standard';", "const key = 'geruecht_standard';", 'Geruecht: der text_key des Plans wird ignoriert'],
  [B1, "    for (const h of ctx.beat.hinweise || []) Hinweis().senden(game, faden.id, h);\n    baustLog(game, faden, ctx.beat, 'geruecht',", "    baustLog(game, faden, ctx.beat, 'geruecht',", 'Geruecht: die Hinweise des Beats werden nicht gesendet'],
  // ---- Baustein: wiedersehen
  [B1, "&& has(T, W.wiedersehen_erinnert[g.ereignis])) key = W.wiedersehen_erinnert[g.ereignis]; }", "&& has(T, W.wiedersehen_erinnert[g.ereignis]) && key === 'wiedersehen_standard') key = W.wiedersehen_erinnert[g.ereignis]; }", 'Wiedersehen: die aelteste Tat gewinnt statt der letzten'],
  [B1, "if (!hex) { baustLog(game, faden, ctx.beat, 'abgelehnt', 'Wiedersehen ohne", "if (false) { baustLog(game, faden, ctx.beat, 'abgelehnt', 'Wiedersehen ohne", 'Wiedersehen: ohne Treffpunkt laeuft der Beat trotzdem'],
  // ---- Baustein: Takt
  [B1, "if (!a || a.hex !== hier) continue;", "if (!a || a.hex === hier) continue;", 'Takt: Ankunft an jedem Ort ausser dem genannten'],
  [B1, "T[a.baustein === 'geruecht' ? 'geruecht_gefunden' : 'wiedersehen_dank']", "T['geruecht_gefunden']", 'Takt: derselbe Dank fuer Geruecht und Wiedersehen'],
  [B1, "const hex = typeof p.hex === 'string' && HEX.test(p.hex) ? p.hex : (f.parameter && f.parameter.ort);\n  return hex && HEX.test(hex) ? { hex, baustein: l.id }", "const hex = f.parameter && f.parameter.ort;\n  return hex && HEX.test(hex) ? { hex, baustein: l.id }", 'Takt: der Beat-Parameter hex gilt nicht vor dem Ort des Fadens'],
  [B1, "|| Bausteine().vonId(id) !== BAUSTEINE[id]) return null;", ") return null;", 'Takt: auch ein Platzhalter-Baustein wartet auf die Ankunft'],
  // ---- Baustein: spur
  [B1, "if (game.spur && !game.spur.fertig) return ab(", "if (false) return ab(", 'Spur: eine laufende andere Spur wird ersetzt'],
  [B1, "if (!erreichbar(game, hierHex(game), W.ziel.erreichbar_max).has(d.weg[0])) return ab(", "if (false) return ab(", 'Spur: auch mit unerreichbarem Anfang'],
  [B1, "    for (const h of ctx.beat.hinweise || []) Hinweis().senden(game, faden.id, h);\n    baustLog(game, faden, ctx.beat, 'spur',", "    baustLog(game, faden, ctx.beat, 'spur',", 'Spur: die Hinweise des Beats werden nicht gesendet'],
  [B1, "if (s && s.id === id && s.fertig) {", "if (false) {", 'Spur: eine fertig gelesene Spur beendet den Beat nicht'],
  [B1, "else if (!s || s.id !== id) { sagen(", "else if (false) { sagen(", 'Spur: eine ersetzte Spur laesst den Beat weiterlaufen'],
  [B1, "    reg.set(f.id, id);", "", 'Spur: nach der Frist bleibt die Spur liegen (kein Abraeumen)'],
  [B1, "if (!s || s.id !== id || s.fertig) continue;", "if (!s || s.id !== id) continue;", 'Spur: auch eine fertig gelesene Spur wird abgeraeumt'],
  [B1, "fmt(s.falsch ? S[id].verloren_falsch : S[id].verloren,", "fmt(S[id].verloren,", 'Spur: der falsche Ast hat keinen eigenen Text'],
  // ---- Baustein: katalogFehler
  [B1, "for (const [k, t] of Object.entries(T)) if (!ok(t)) g(", "for (const [k, t] of Object.entries(T)) if (false) g(", 'katalogFehler: Text mit fremdem Platzhalter'],
  [B1, "'wiedersehen_dank']) if (!has(T, k)) g(", "'wiedersehen_dank']) if (false) g(", 'katalogFehler: Pflichttext fehlt'],
  [B1, "if (!(z && Number.isInteger(z.min)", "if (false && !(z && Number.isInteger(z.min)", 'katalogFehler: unmoegliche Zahlen fuer ziel'],
  [B1, "if (!/^[a-z_]{1,40}$/.test(ev)) g(", "if (false) g(", 'katalogFehler: Ereignis passt nicht zum Gedaechtnis'],
  [B1, "if (!has(T, k)) g(`wiedersehen_erinnert: Text", "if (false) g(`wiedersehen_erinnert: Text", 'katalogFehler: erinnerte Tat ohne Text'],
  [B1, "for (const k of erl.text_key.erlaubt) if (!has(T, k)) g(", "for (const k of erl.text_key.erlaubt) if (false) g(", 'katalogFehler: erlaubter text_key ohne Text'],
  [B1, "if (!has(S, id)) { g(`Beat ${typ}: Spur", "if (false) { g(`Beat ${typ}: Spur", 'katalogFehler: erlaubte Spur ohne Texte'],
  [B1, "if (!d) g(`Spur ${id}: content/spuren/", "if (false) g(`Spur ${id}: content/spuren/", 'katalogFehler: erlaubte Spur ohne Datei'],
  [B1, "for (const k of ['start', 'gelungen', 'verloren', 'verloren_falsch']) if (!ok(s && s[k])) g(", "for (const k of ['start', 'gelungen', 'verloren', 'verloren_falsch']) if (false) g(", 'katalogFehler: Spur-Text fehlt'],
  // ---- Pruefer
  [PR, "      if (i !== 0) fehler.push(fehl('NSC_ALT_NICHT_ERSTER'", "      if (false) fehler.push(fehl('NSC_ALT_NICHT_ERSTER'", 'Pruefer: Wiedersehen mitten im Faden'],
  [PR, "      if (namenlos) fehler.push(fehl('NAMENLOS', `Beat ${b.id}: ein namenloses Abenteuer hat keinen NSC", "      if (false) fehler.push(fehl('NAMENLOS', `Beat ${b.id}: ein namenloses Abenteuer hat keinen NSC", 'Pruefer: Wiedersehen in einem namenlosen Abenteuer'],
  [PR, "if (erlaubt.includes('hex') && has(p, 'hex') && !(", "if (false && !(", 'Pruefer: hex-Parameter nicht geprueft'],
  [PR, "'angebot', 'nsc_von'];", "'angebot'];", 'Pruefer: nsc_von ist kein erlaubter Parameter von faden_oeffnen'],
  [PR, "const nscAlt = (v) => !!(v &&", "const nscAlt = (v) => false && !!(v &&", 'Pruefer: kein Beat gilt als Wiedersehen'],
  [PR, "&& has(D.B1.werte.wiedersehen_erinnert, g.ereignis));", "&& true);", 'Pruefer: jedes Ereignis gilt als erinnerte Tat'],
  [PR, "v.volk_erlaubt.includes(f.nsc.fraktion) && Number.isFinite", "Number.isFinite", 'Pruefer: das Volk des NSC ist egal'],
  [PR, "if (!has(p, 'nsc_von')) return nscAlt(v) ? fehl('NSC_VON_FEHLT'", "if (!has(p, 'nsc_von')) return false ? fehl('NSC_VON_FEHLT'", 'Pruefer: ein Wiedersehen ohne nsc_von'],
  [PR, "if (!nscAlt(v)) return fehl('NSC_VON', 'nsc_von gibt es nur", "if (false) return fehl('NSC_VON', 'nsc_von gibt es nur", 'Pruefer: nsc_von bei einem Abenteuer ohne Wiedersehen'],
  [PR, "if (has(p, 'name')) return fehl('NSC_VON'", "if (false) return fehl('NSC_VON'", 'Pruefer: name und nsc_von zugleich'],
  [PR, "const n = wiedersehenNsc(F, v).find((x) => x.id === id);", "const n = wiedersehenNsc(F, v).find((x) => x.id === id) || wiedersehenNsc(F, v)[0];", 'Pruefer: ein unbekannter NSC wird durch einen anderen ersetzt'],
  [PR, "if (p.volk !== undefined && p.volk !== n.fraktion) return fehl('PARAMETER'", "if (false) return fehl('PARAMETER'", 'Pruefer: volk passt nicht zum NSC'],
  // ---- Faden: Wiedersehen
  [FA, "  n.id = 'n' + nscNr;", "", 'Faden: der NSC behaelt seine alte Kennung'],
  [FA, "  n.status = (v.nsc && v.nsc.status) || 'aktiv';\n  n.wahrheit = null;", "  n.wahrheit = null;", 'Faden: der NSC behaelt seinen alten Zustand'],
  [FA, "  n.wahrheit = null;\n  if (v.wahrheit) { n.wahrheit = {", "  if (v.wahrheit) { n.wahrheit = {", 'Faden: die Wahrheit des alten Fadens kommt mit'],
  [FA, "const n = klon(alt);", "const n = alt;", 'Faden: der alte NSC wird veraendert statt kopiert'],
  [FA, "if (P.nscAlt(r.vorlage) && !wiedersehenKandidaten(game, r.vorlage).length) return abgelehnt(", "if (false) return abgelehnt(", 'Faden: ein Plan mit Wiedersehen ohne NSC wird angeboten'],
  [FA, "const nsc = alt ? nscUebernehmen(alt, v, nscNr) : nscErzeugen(game, v, volk, p.name, nscNr);\n  if (!nsc) return abgelehnt(", "const nsc = nscErzeugen(game, v, volk, p.name, nscNr);\n  if (!nsc) return abgelehnt(", 'Faden: abenteuerOeffnen nimmt den alten NSC nicht'],
  [FA, "const nsc = alt ? nscUebernehmen(alt, v, nscNr) : nscErzeugen(game, v, volk, p.name, nscNr);\n  if (!nsc) { logbuch(", "const nsc = nscErzeugen(game, v, volk, p.name, nscNr);\n  if (!nsc) { logbuch(", 'Faden: faden_oeffnen nimmt den alten NSC nicht'],
  // ---- Expander
  [BPF, "if (i !== 0) add('NSC_ALT_NICHT_ERSTER'", "if (false) add('NSC_ALT_NICHT_ERSTER'", 'Expander: Wiedersehen mitten im Plan'],
  [BPF, "if (namenlos) add('BAUPLAN_NAMENLOS_TYP', `Beat ${id} (${b.typ}): ein namenloses Abenteuer hat keinen NSC", "if (false) add('BAUPLAN_NAMENLOS_TYP', `Beat ${id} (${b.typ}): ein namenloses Abenteuer hat keinen NSC", 'Expander: Wiedersehen in einem namenlosen Plan'],
  [BPF, "...require('./faden-b1.js').katalogFehler().map(", "...[].map(", 'Expander: katalogFehler sieht die Daten der Bausteine nicht'],
  [BPF, "if (cat.braucht && cat.braucht.nsc_alt !== undefined && cat.braucht.nsc_alt !== true) g(", "if (false) g(", 'Expander: braucht.nsc_alt kein Wahrheitswert'],
  // ---- Hooks und Registrierung
  [RE, "try { require('./faden-b1.js').update(game); }", "try { (function () {})(); }", 'Hook: der Takt der Bausteine laeuft nicht (reise-ereignis)'],
  [BS, "registriere('geruecht', B1.geruecht);", "", 'Bausteine: geruecht bleibt Platzhalter'],
  [BS, "registriere('spur', B1.spur);", "", 'Bausteine: spur bleibt Platzhalter'],
  [BS, "registriere('wiedersehen', B1.wiedersehen);", "", 'Bausteine: wiedersehen bleibt Platzhalter'],
  // ---- Komposition: Kontext und Mock
  [AP, "wiedersehen_nsc: wiedersehen, lage };", "wiedersehen_nsc: 0, lage };", 'Kontext: wiedersehen_nsc ist immer 0'],
  [AM, "!nscAlt(t) || opt.wiedersehen === true || opt.mit === t", "true", 'Mock: auch ohne NSC kommt ein Wiedersehen vor'],
  [AM, "!nscAlt(t) || opt.wiedersehen === true || opt.mit === t", "!nscAlt(t) || opt.mit === t", 'Mock: auch mit NSC kommt nie ein Wiedersehen vor'],
  [AM, "    if (opt.mit) beats[0] = { typ: opt.mit };", "", 'Mock: opt.mit setzt den Typ nicht'],
  // ---- Daten
  [DB, "\"braucht\": {\"nsc_status\": [\"aktiv\", \"verbuendet\"], \"nsc_alt\": true}", "\"braucht\": {\"nsc_status\": [\"aktiv\", \"verbuendet\"]}", 'Daten: das Wiedersehen braucht keinen NSC aus einem frueheren Faden'],
  [DB, "\"baustein\": \"geruecht\",\n      \"gefahr\": false,", "\"baustein\": \"geruecht\",\n      \"gefahr\": true,", 'Daten: das Geruecht bringt Gefahr'],
  [DB, "\"baustein\": \"spur\",\n      \"gefahr\": false,", "\"baustein\": \"spur\",\n      \"gefahr\": true,", 'Daten: die Spur bringt Gefahr'],
  [DB, "\"baustein\": \"wiedersehen\",\n      \"gefahr\": false,", "\"baustein\": \"wiedersehen\",\n      \"gefahr\": true,", 'Daten: das Wiedersehen bringt Gefahr'],
  [DB, "\"gescheitert\":{\"status\":[\"aktiv\",\"geflohen\"],\"folge\":[]}}}\n    },\n    \"spur\": {", "\"gescheitert\":{\"status\":[\"aktiv\",\"geflohen\"],\"folge\":[{\"typ\":\"haltung_aenderung\",\"grund\":\"im_stich_gelassen\"}]}}}\n    },\n    \"spur\": {", 'Daten: Scheitern des Geruechts kostet Haltung'],
  [DB, "\"gescheitert\":{\"status\":[\"aktiv\",\"geflohen\"],\"folge\":[{\"typ\":\"haltung_aenderung\",\"grund\":\"bitte_abgelehnt\"}]}}}", "\"gescheitert\":{\"status\":[\"aktiv\",\"geflohen\"],\"folge\":[{\"typ\":\"haltung_aenderung\",\"grund\":\"im_stich_gelassen\"}]}}}", 'Daten: Scheitern des Wiedersehens kostet zu viel Haltung'],
  [DB, "\"bauplan\": {\"start_status\":\"aktiv\",\"hinweis_traeger\":true,\"parameter\":{\"spur\"", "\"bauplan\": {\"start_status\":\"aktiv\",\"hinweis_traeger\":false,\"parameter\":{\"spur\"", 'Daten: die Spur ist kein Hinweis-Traeger'],
  [DT, "\"wert\": {\"min\": 1, \"max\": 3, \"erreichbar_max\": 8}", "\"wert\": {\"min\": 1, \"max\": 5, \"erreichbar_max\": 8}", 'Daten: der genannte Sektor liegt bis zu fuenf Spruenge weit'],
  [DT, "\"wert\": {\"min\": 1, \"max\": 3, \"erreichbar_max\": 8}", "\"wert\": {\"min\": 1, \"max\": 3, \"erreichbar_max\": 2}", 'Daten: der Anfang der Spur ist nur zwei Spruenge weit erreichbar'],
  [DT, "\"wiedersehen_notruf_gelungen\": \"Ihr habt mich aus der Not geholt. Bei {ort} will ich mich bedanken.\"", "\"wiedersehen_notruf_gelungen\": \"Schoen, euch zu sehen. Bei {ort} will ich mich bedanken.\"", 'Daten: der Text erinnert nicht an die konkrete Tat'],
  [DT, "\"fundort\": {\n      \"start\": \"Ein Antrieb hat bei {ort} eine Spur hinterlassen.", "\"fundort\": {\n      \"start\": \"Eine Spur beginnt irgendwo.", 'Daten: der Starttext der Spur nennt den Anfang nicht'],
  [SF, "\"ende\": { \"kante\": \"boje-fundort\" }", "\"ende\": { \"kante\": \"altrost-weg\" }", 'Spur fundort: das Ende enthuellt eine Kante, die nicht am letzten Hex liegt'],
  // ---- Nacharbeit B1 (Zustand des alten NSC, Reihenfolge, Spuren ohne Sperrtext, verwaiste Spur, Ort, Karte, Prompt)
  [B1, "&& erreichbar(game, hierHex(game), W.ziel.erreichbar_max).get(p.hex) >= 1 ? p.hex : null;", "? p.hex : null;", "Sektor der Vorlage: auch ein unerreichbarer gilt"],
  [B1, "erreichbar_max).get(p.hex) >= 1 ?", "erreichbar_max).get(p.hex) >= 0 ?", "Sektor der Vorlage: auch der Sektor der Crew selbst gilt (0 Spruenge)"],
  [B1, "|| !ex.kanteOffen(Sektoren.kanteId(e.a, e.b))) continue;", "|| !ex.kanteOffen(Sektoren.kanteId(e.a, e.b)) || !ex.bojeBekannt(Sektoren.kanteId(e.a, e.b))) continue;", "Wegsuche: nur Kanten mit bekannter Boje (Weitscan zaehlt nicht)"],
  [B1, "function spurAbraeumen(game, id) { SpurMod().reset(game);", "function spurAbraeumen(game, id) {", "Spur: die liegen gebliebene Spur bleibt im Spiel"],
  [B1, " require('./marken.js').entferne(game, 'spur:' + id); }", " }", "Spur: die Marke der liegen gebliebenen Spur bleibt"],
  [B1, "  if (spurVerwaist(game, F, null)) spurAbraeumen(game, game.spur.id);", "", "Spur: eine verwaiste Spur bleibt nach dem Laden liegen (kein Abraeumen im Takt)"],
  [B1, "    if (spurVerwaist(game, Faden().zustandVon(game), faden)) spurAbraeumen(game, game.spur.id);", "", "Spur: eine verwaiste Spur blockiert den neuen Beat"],
  [B1, "&& has(S, s.id) && !F.liste", "&& !F.liste", "Spur: auch eine fremde Spur (Kampagne) gilt als verwaist"],
  [B1, "&& !F.liste.some((x) => x !== ausser && spurLaeuft(x) === s.id));", "&& true);", "Spur: auch die Spur eines laufenden Beats gilt als verwaist"],
  [B1, "{ spurAbraeumen(game, id); return { ausgang: 'gescheitert' }; }", "{ return { ausgang: 'gescheitert' }; }", "Spur: ohne Funk des Beginns bleibt die gestartete Spur liegen"],
  [B1, "    if (spurAbgeschlossen(game, d)) return ab(", "    if (false) return ab(", "Spur: eine abgeschlossene Spur bringt erneut Belohnung"],
  [PR, " && sundSpielbar(p.hex)", "", "Pruefer: hex muss kein spielbarer Sektor sein"],
  [PR, "const K = require('./welt.js').karte(FADEN_KARTE);", "const K = require('../../shared/sektoren.js').KARTE;", "Pruefer: hex, ort und Angebots-Hex gelten fuer den global geladenen Kartenstand (Limes) statt sund_frei"],
  [PR, "f.phase === 'abgeschlossen' && wiedersehenStatusOk(", "wiedersehenStatusOk(", "Pruefer: auch ein NSC in einem aktiven Faden taugt fuer ein Wiedersehen"],
  [PR, "return Array.isArray(st) ? st.includes(status) : status !== 'tot'; };", "return true; };", "Pruefer: der Zustand des alten NSC ist egal (gefangen, geflohen, feindlich, schuldet_nichts, tot)"],
  [PR, "Array.isArray(st) ? st.includes(status) : status !== 'tot'", "status === 'aktiv' || status === 'verbuendet'", "Pruefer: der Zustand kommt aus dem Code statt aus braucht.nsc_status des ersten Beats"],
  [PR, "const st = c && c.braucht && c.braucht.nsc_status;", "const st = ['aktiv', 'verbuendet', 'gefangen'];", "Pruefer: ein gefangener NSC kehrt zurueck (Zustandsliste im Code)"],
  [PR, "&& erinnertTat(f.nsc))\n    .sort(", ")\n    .sort(", "Pruefer: ein NSC ohne Tat der Crew taugt"],
  [PR, "if (!alt || fadenNr(f) >= fadenNr(alt)) juengster.set(f.nsc.name, f);", "juengster.set(f.id, f);", "Pruefer: alle Faeden desselben NSC sind Kandidaten (nicht der juengste)"],
  [PR, "fadenNr(f) >= fadenNr(alt)", "fadenNr(f) < fadenNr(alt)", "Pruefer: von mehreren Faeden desselben NSC gilt der aelteste"],
  [PR, "    .sort((a, b) => fadenNr(b) - fadenNr(a)).map(", "    .map(", "Pruefer: die Kandidaten kommen nicht juengster zuerst (Reihenfolge der Liste)"],
  [PR, ".sort((a, b) => fadenNr(b) - fadenNr(a))", ".sort((a, b) => fadenNr(a) - fadenNr(b))", "Pruefer: die Kandidaten kommen aeltester zuerst"],
  [PR, "volk_erlaubt: [volk] }).length : 0;", "volk_erlaubt: W.voelker }).length : 0;", "Kontext: wiedersehen_nsc zaehlt jeden NSC fuer jedes Volk"],
  [PR, "sundSpielbar(o.hex))) return", "require('../../shared/sektoren.js').spielbar(o.hex))) return", "Pruefer: der Ort des Abenteuers gilt fuer den global geladenen Kartenstand"],
  [PR, "sundSpielbar(p.ort))) return", "require('../../shared/sektoren.js').spielbar(p.ort))) return", "Pruefer: ort von faden_oeffnen gilt fuer den global geladenen Kartenstand"],
  [AM, "wiedersehen: wiedersehenDa(k.faeden && k.faeden.wiedersehen_nsc), lage:", "wiedersehen: true, lage:", "Mock: der Kontext (wiedersehen_nsc) wird nicht gelesen"],
  [AM, "D.BAUPLAN.werte.volk_erlaubt_standard.some((v) => Number(z[v]) > 0)", "Object.values(z).some((v) => Number(v) > 0)", "Mock: jedes Volk zaehlt fuer ein Wiedersehen, auch eines ausserhalb des Standard-Sets"],
  [AP, "  if (Object.values(B).some((c) => c.braucht && c.braucht.nsc_alt === true)) L.push(`Kontext", "  if (false) L.push(`Kontext", "Katalog: die Zahl wiedersehen_nsc je Volk wird nicht erklaert"],
  [SYS, "unter `faeden.wiedersehen_nsc` für", "unter `faeden` für", "Systemprompt: die Zahl wiedersehen_nsc wird nicht erklaert"],
  [DB, "\"erlaubt\":[\"kantenpfad\",\"fundort\"]", "\"erlaubt\":[\"kantenpfad\",\"fundort\",\"bote\"]", "Daten: die Kampagnen-Spur bote ist ein Parameter des Plans"],
  [SK, "\"ende\": { \"kante\": \"boje-fundort\" }", "\"ende\": { \"kante\": \"altrost-weg\" }", "Spur kantenpfad: das Ende enthuellt eine Kante, die nicht am letzten Hex liegt"],
  [SK, "\"ende\": { \"kante\": \"boje-fundort\" }", "\"ende\": { \"kante\": \"lager-schrottkante\" }", "Spur kantenpfad: die Enthuellung oeffnet eine Kante in einen Sektor mit Sperrtext (Schrottkante)"],
  [SK, "\"weg\": [\"0603\", \"0604\", \"0605\"],", "\"weg\": [\"0603\", \"0604\", \"0605\", \"0705\"],", "Spur kantenpfad: der Weg endet nicht am Hex der verborgenen Kante"],
  [SK, "\"nach\": \"0503\"", "\"nach\": \"0703\"", "Spur kantenpfad: der falsche Ast liegt in einem Sektor mit Sperrtext (Eisfeld)"],
  [SK, "{ \"nach\": \"0604\", \"echt\": true,", "{ \"nach\": \"0604\", \"echt\": false,", "Spur kantenpfad: kein echter Ast"],
  [SF, "\"ende\": { \"kante\": \"boje-fundort\" }", "\"ende\": { \"kante\": \"altrost-weg\" }", "Spur fundort: das Ende enthuellt eine Kante, die nicht am letzten Hex liegt"],
  [SF, "\"weg\": [\"0705\", \"0605\"],", "\"weg\": [\"0704\", \"0705\", \"0605\"],", "Spur fundort: der Weg beginnt in einem Sektor mit Sperrtext (Raffinerie Lumen)"],
  [SF, "\"teilungen\": [],", "\"teilungen\": [{ \"ab\": \"0705\", \"aeste\": [{ \"nach\": \"0605\", \"echt\": true, \"indiz\": \"Masse 30 t, der Kurs fuehrt nach Norden.\" }, { \"nach\": \"0704\", \"echt\": false, \"indiz\": \"Masse 1 t, die Signatur flackert gleichmaessig.\" }] }],", "Spur fundort: ein falscher Ast in einem Sektor mit Sperrtext (0704)"],
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
const lauf = ([test, ...arg]) => spawnSync(process.execPath, [test, ...arg], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
let ueberlebt = 0, gelaufen = 0, erkannt = 0, abstuerze = 0;
console.log(`Mutationsprobe test-faden-katalog-b1.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
for (const t of TESTS) {
  const basis = lauf(t);
  console.log(`  Ausgangslage ${t.join(' ')}: ${basis.status === 0 ? 'gruen' : 'ROT (Abbruch)'}`);
  if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l) && !/Ausnahme/.test(l)).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
}
for (const [datei, alt, neu, was] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  if (text.split(alt).length !== 2) { console.log(`  ?? ${was}: Textstelle nicht eindeutig gefunden (${datei})`); ueberlebt++; continue; }
  fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
  let wer = null, fehler = [], absturz = null;
  for (const t of TESTS) {
    const r = lauf(t);
    if (r.status === 0) continue;
    const fz = ((r.stdout || '').split('\n')).filter((l) => /FEHLER/.test(l) && !/Ausnahme/.test(l));
    if (fz.length) { wer = path.basename(t[0], '.js').replace('test-', ''); fehler = fz; break; }
    if (!absturz) absturz = { test: path.basename(t[0], '.js'), text: ((r.stderr || '') + (r.stdout || '')).split('\n').filter((l) => /Error|    at /.test(l)).slice(0, 1).join(' ').trim().slice(0, 120) || `Exit ${r.status}` };
  }
  fs.writeFileSync(f, orig);
  if (wer) { erkannt++; console.log(`  rot    ${was} (${wer}: ${fehler.length} Fehler, z. B. ${fehler[0].replace(/^\s*FEHLER\s*/, '').slice(0, 64)})`); }
  else if (absturz) { abstuerze++; console.log(`  ABSTURZ ${was} (${absturz.test}: ${absturz.text}) – nicht als erkannt gezaehlt`); }
  else { ueberlebt++; console.log(`  GRUEN  ${was}  <-- UEBERLEBT`); }
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(`Ergebnis: ${erkannt} erkannt, ${ueberlebt} ueberlebt, ${abstuerze} Absturz/Syntaxfehler (von ${gelaufen})`);
process.exit(ueberlebt || abstuerze ? 1 : 0);
