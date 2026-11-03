'use strict';
// CHA-01 C: Mutationsprobe zu tools/test-charaktere.js. Kopiert shared/, content/katalog, charaktere.js und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt),
// ändert dort je Lauf EINE Regel und verlangt, dass der Test rot wird (Exit != 0). Überlebt eine Mutation, deckt der Test die Regel nicht ab.
//   node tools/mutation-charaktere.js [begriff …]      (npm run test:charaktere-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-cha-'));
for (const rel of ['shared/charakter.js', 'content/katalog/charakter.json', 'public/js/charaktere.js', 'public/js/kammer-ui.js', 'public/js/menue-ui.js', 'public/js/art.js', 'public/js/voxel/kammer.js', 'tools/test-charaktere.js']) {
  fs.mkdirSync(path.dirname(path.join(TMP, rel)), { recursive: true });
  fs.copyFileSync(path.join(ROOT, rel), path.join(TMP, rel));
}
const C = 'public/js/charaktere.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  [C, "return t ? t.name : String(name || '');", "return String(name || '');", 'teilName liefert den Rohnamen statt des Katalognamens'],
  [C, "if (store.liste.length >= MAX) return { ok: false, grund: 'voll' };\n      const w = ", "if (store.liste.length >= MAX + 1) return { ok: false, grund: 'voll' };\n      const w = ", 'fünfter Charakter wird angenommen'],
  [C, "karte: Ch.pruefeKarte(e.karte, katalog) });", "karte: e.karte });", 'gelesene Karte wird nicht geprüft'],
  [C, "if (liste.length >= MAX) break;", "", 'Speicher mit zehn Einträgen wird ganz übernommen'],
  [C, "if (store.gewaehlt === id) store.gewaehlt = store.liste.length ?", "if (false) store.gewaehlt = store.liste.length ?", 'gewählten löschen lässt die Auswahl auf einer toten id'],
  [C, "if (s.loeschFrage !== c.id) {", "if (false) {", 'Löschen ohne Rückfrage'],
  [C, "const n = Ch.pruefeName(name);\n      if (!n) return { ok: false, grund: 'name' };\n      c.karte.name = n;", "const n = String(name);\n      c.karte.name = n;", 'Umbenennen nimmt ungültige Namen'],
  [C, "if (!e || e.modus !== 'neu' || !PLAETZE.includes(platz)) return { ok: false, grund: 'platz' };", "if (!e || !PLAETZE.includes(platz)) return { ok: false, grund: 'platz' };", 'Umbenennen darf das Aussehen ändern (Platzwahl)'],
  [C, "Ch.pruefeName(altName) || Ch.STANDARD_NAME", "String(altName)", 'ungültiger Altname wird nicht ersetzt'],
  [C, "if (store.liste.length) return { ok: true, quelle: 'vorhanden' };", "", 'Erststart legt trotz vorhandener Charaktere an'],
  [C, "if (!store.bereit) return { ok: false, grund: 'katalog' };\n      if (store.liste.length >= MAX) return { ok: false, grund: 'voll' };\n      const s = store.sitzung;", "if (!store.bereit) return { ok: false, grund: 'katalog' };\n      const s = store.sitzung;", 'Erstellung öffnet bei vier Charakteren'],
  [C, "c.karte.name = n;", "c.karte.name = n; c.karte.outfit = Ch.standardKarte(n, katalog).outfit;", 'benenneUm setzt das Outfit auf Standard'],
  [C, "if (indexVon(id) < 0) return { ok: false, grund: 'unbekannt' };\n      store.gewaehlt = id;", "if (indexVon(id) < 0) return { ok: false, grund: 'unbekannt' };\n      store.liste[indexVon(id)].karte.outfit = Ch.standardKarte('x', katalog).outfit;\n      store.gewaehlt = id;", 'waehle setzt das Outfit auf Standard'],
  [C, "if (!e || e.modus !== 'neu' || !PLAETZE.includes(platz) || !n)", "if (!e || !PLAETZE.includes(platz) || !n)", 'Schutz modus neu in setzeWahl entfernt (Umbenennen ändert das Aussehen)'],
  [C, "return e.modus === 'umbenennen' ? speichereEntwurf() : nameFertig();", "return nameFertig();", 'Enter im Schreibmodus beim Umbenennen speichert nicht'],
  [C, "return e.modus === 'umbenennen' ? speichereEntwurf() : nameFertig();", "return speichereEntwurf();", 'Enter im Schreibmodus beim Neuanlegen speichert sofort'],
  [C, "if (e.modus === 'neu' && e.name) return nameBearbeiten(false);", "if (e.modus === 'neu') return nameBearbeiten(false);", 'Esc im Schreibmodus verwirft den leeren Neu-Entwurf nicht'],
  [C, "if (e.modus === 'neu' && e.name) return nameBearbeiten(false);", "if (e.name) return nameBearbeiten(false);", 'Esc im Schreibmodus beim Umbenennen verwirft nicht'],
  [C, "const r = neuAnlegen();\n      return r.ok ? { ok: true, aktion: 'neu' } : r;", "return { ok: false, grund: 'frei' };", 'freier Platz legt nicht neu an'],
  [C, "if (!r.ok && r.grund === 'voll') { store.sitzung.meldung", "if (false) { store.sitzung.meldung", 'Meldung voll fehlt'],
  [C, "if (!store.liste.length) { const r = legeStandardAn(zufallsName());", "if (false) { const r = legeStandardAn(zufallsName());", 'letzten löschen legt keinen Ersatz-Charakter an'],
  [C, "'Crew-' + (100 + Math.floor(zufall() * 900))", "'Crew-' + (10 + Math.floor(zufall() * 90))", 'Ersatzname hat ein anderes Format'],
  [C, "store.speicherOk = !!speicher.schreiben(JSON.stringify(daten));", "speicher.schreiben(JSON.stringify(daten));", 'Speicherfehler wird nicht gemerkt'],
  // CHA-01 D: Spind
  [C, "const outfit = Ch.pruefeOutfit(e.karte.outfit, katalog);", "const outfit = e.karte.outfit;", 'speichereOutfit ohne Prüfung des Outfits'],
  [C, "const c = store.liste.find((x) => x.id === store.gewaehlt);\n      if (!c) return { ok: false, grund: 'unbekannt' };\n      const outfit", "const c = store.liste[0];\n      if (!c) return { ok: false, grund: 'unbekannt' };\n      const outfit", 'speichereOutfit schreibt in den ersten statt den gewählten Charakter'],
  [C, "speichereListe();   // schlägt der Browser-Speicher fehl", "// schlägt der Browser-Speicher fehl", 'speichereOutfit speichert nicht'],
  [C, "sende(klon(outfit));", "", 'speichereOutfit sendet nichts an den Server'],
  [C, "c.karte.outfit = outfit;\n      speichereListe();   // schlägt", "c.karte = Object.assign({}, e.karte, { outfit });\n      speichereListe();   // schlägt", 'speichereOutfit übernimmt auch den Charakterteil des Entwurfs'],
  [C, "if (!e || !OUTFIT_PLAETZE.includes(platz)) return { ok: false, grund: 'platz' };\n      if (platz !== e.platz) {", "if (!e) return { ok: false, grund: 'platz' };\n      if (platz !== e.platz) {", 'Spind lässt Charakterplätze zu'],
  [C, "e.karte.outfit[platz] = teile[i].id.slice(platz.length + 1);", "e.karte.outfit[platz] = teile[i].id.slice(platz.length + 1); store.liste.find((x) => x.id === store.gewaehlt).karte.outfit[platz] = e.karte.outfit[platz];", 'Anprobe schreibt sofort in den Charakter'],
  [C, "e.karte = k; e.hinweis = null; aenderung();", "e.hinweis = null; aenderung();", 'R setzt die Anprobe nicht zurück'],
  [C, "(Math.max(0, spindWahlIndex(e.platz)) + (d < 0 ? -1 : 1) + n) % n)", "Math.min(n - 1, Math.max(0, spindWahlIndex(e.platz) + (d < 0 ? -1 : 1))))", 'Spind-Blättern ist nicht ringförmig'],
  [C, "return i >= 0 && i < n ? spindSetzeWahl", "return true ? spindSetzeWahl", 'Zeile weiter springt über den Rand'],
  [C, "t.herkunft && t.herkunft !== 'frei'))) { e.hinweis = 'gesperrt';", "false))) { e.hinweis = 'gesperrt';", 'speichereOutfit zieht gesperrte Teile an'],
  [C, "meldeOutfitWechsel();\n      sende(klon(outfit));", "meldeWechsel();\n      sende(klon(outfit));", 'speichereOutfit meldet wieder einen Charakterwechsel (volles hello)'],
  [C, "letzteAktive = JSON.stringify(k);   // der gemerkte", "// der gemerkte", 'Outfit-Kanal lässt den gemerkten Stand veralten'],
  [C, "for (const f of outfitLauscher.slice())", "for (const f of [])", 'Outfit-Lauscher werden nicht gerufen'],
  [C, "if (OUTFIT_PLAETZE.every((pl) => outfit[pl] === c.karte.outfit[pl]))", "if (false)", 'unverändertes Outfit wird trotzdem gespeichert und gesendet'],
  [C, "if (store.sitzung.spindWartet) oeffneSpind();   // der Spind wurde geöffnet", "// der Spind wurde geöffnet", 'Spind vor dem Katalog wird nicht nachgezogen'],
  [C, "function schliesseSpind() { store.sitzung.spindWartet = false;", "function schliesseSpind() {", 'geschlossener Spind öffnet nach dem Katalog doch'],
  // CHA-01 F: Legende im Spind
  [C, "if (t.herkunft && t.herkunft !== 'frei' && !h.includes(t.herkunft)) h.push(t.herkunft);", "if (t.herkunft && !h.includes(t.herkunft)) h.push(t.herkunft);", 'Spind-Legende zählt „frei“ als gesperrte Herkunft'],
  [C, "if (t.herkunft && t.herkunft !== 'frei' && !h.includes(t.herkunft)) h.push(t.herkunft);", "if (t.herkunft && t.herkunft !== 'frei') h.push(t.herkunft);", 'Spind-Legende nennt eine Herkunft mehrfach'],
  [C, "for (const t of outfitTeileFuer(platz)) if (t.herkunft", "for (const t of (katalog && katalog.teile || []).filter((q) => q.gruppe === 'outfit')) if (t.herkunft", 'Spind-Legende schaut über alle Plätze statt den aktuellen'],
  [C, "const KACHEL_LIVE = { neu: ['frisur'], spind: ['kopf'] };", "const KACHEL_LIVE = { neu: ['frisur', 'kopf'], spind: ['kopf'] };", 'Livekachel auch für die Kopfbedeckung in der Erstellung'],
  [C, "const KACHEL_LIVE = { neu: ['frisur'], spind: ['kopf'] };", "const KACHEL_LIVE = { neu: ['frisur'], spind: ['kopf', 'oberteil'] };", 'Livekachel im Spind auch für das Oberteil'],
  [C, "return k ? Object.assign(k, { frisur: (std && std.standard) || k.frisur, haar: kachelHaar(), outfit: Object.assign(k.outfit, { [platz]: wert }) }) : null;", "return k ? Object.assign(k, { haar: kachelHaar(), outfit: k.outfit }) : null;", 'Spind-Kachel setzt das Teil nicht ins Outfit'],
  [C, "frisur: (std && std.standard) || k.frisur, haar: kachelHaar(), outfit:", "haar: kachelHaar(), outfit:", 'Kopf-Kacheln im Spind tragen die Frisur des Charakters statt der Standardfrisur'],
  [C, "frisur: (std && std.standard) || k.frisur, haar: kachelHaar(), outfit:", "frisur: (std && std.standard) || k.frisur, outfit:", 'Kopf-Kacheln im Spind tragen das Haar des Charakters statt des hellen'],
  [C, "const k = entwurfKarte(); return k ? Object.assign(k, { [platz]: wert, haar: kachelHaar() }) : null;", "const k = aktiveKarte(); return k ? Object.assign(k, { [platz]: wert, haar: kachelHaar() }) : null;", 'Erstellungs-Kachel nimmt die getragene Karte statt des Entwurfs'],
  [C, "const k = entwurfKarte(); return k ? Object.assign(k, { [platz]: wert, haar: kachelHaar() }) : null;", "const k = entwurfKarte(); return k ? Object.assign(k, { [platz]: wert }) : null;", 'Frisur-Kacheln nehmen die Haarfarbe des Entwurfs (dunkel auf dunklem Grund)'],
  [C, "const KACHEL_HAAR = 7;", "const KACHEL_HAAR = 0;", 'Frisur-Kacheln tragen die dunkelste statt der hellen Haarfarbe'],
  [C, "const TEIL_PLAETZE = ['frisur'];", "const TEIL_PLAETZE = ['frisur', 'gesicht'];", 'Erstellung kennt wieder den Platz gesicht'],
  [C, "const PLAETZE = TEIL_PLAETZE.concat(FARB_PLAETZE);", "const PLAETZE = TEIL_PLAETZE.concat(FARB_PLAETZE, ['kopf']);", 'Erstellung bietet einen Outfit-Platz an'],
  // CHA-02 E1b: Livebilder und Oberfläche
  ['public/js/voxel/kammer.js', "portraet: { px: 260, fenster: { x: [-6, 5], y: [22, 36],", "portraet: { px: 260, fenster: { x: [-5, 4], y: [22, 34],", 'Porträtfenster schneidet den neuen Kopf ab (alte Referenz y 22–34)'],
  ['public/js/voxel/kammer.js', "kachel: { px: { w: 140, h: 124 }, fenster: { x: [-6, 5], y: [22, 35],", "kachel: { px: { w: 140, h: 124 }, fenster: { x: [-6, 5], y: [22, 33],", 'Kachelfenster schneidet Crista und Hörner ab'],
  ['public/js/voxel/kammer.js', "nah: { px: { w: 300, h: 352 }, fenster: { x: [-8, 7], y: [19, 36], yaw: 28,", "nah: { px: { w: 300, h: 352 }, fenster: { x: [-8, 7], y: [19, 36], yaw: 90,", 'Nahansicht blickt von der Seite statt ¾ von vorn'],
  ['public/js/voxel/kammer.js', "ganz: { px: { w: 240, h: 368 }, fenster: { x: [-8, 7], y: [-1, 37],", "ganz: { px: { w: 240, h: 368 }, fenster: { x: [-8, 7], y: [-1, 34],", 'Spind-Figur schneidet den Kopf ab'],
  ['public/js/kammer-ui.js', "KB.bild(t.live.karte, 'kachel', t.live.yaw)", "KB.bild(t.live.karte, 'portraet', t.live.yaw)", 'Livekacheln als Porträtausschnitt statt Kachelausschnitt'],
  ['public/js/kammer-ui.js', "txt(cc, passend(karte.outfit.kopf && karte.outfit.kopf !== 'keine' ? teilName('kopf', karte.outfit.kopf) : TEXT.liste.ohneKopf, bw), k.x + 6, ty + 33, F.dim);", "", 'Kartenzeile der Kopfbedeckung fehlt in der Liste'],
  ['public/js/kammer-ui.js', "function kachelTexte(name, sub, w) {", "function kachelTexteX(name, sub, w) {", 'Kachel bricht lange Namen nicht um'],
  ['public/js/kammer-ui.js', "if (platz) namensfeld(cc, a.x + T.x, 0, KM.figur.x - T.x - 12, e, a,", "if (platz) namensfeld(cc, a.x + T.x, unten + 14, KM.figur.x - T.x - 12, e, null,", 'Namensfeld unter den Kacheln statt kompakt (überdeckt die Hinweiszeile)'],
  // CHA-01 F: R (Zurücksetzen) im Umbenennen
  [C, "return !!c && e.name !== c.karte.name;", "return !!c;", 'R im Umbenennen gilt immer als wirksam'],
  [C, "if (e.modus === 'neu') return true;\n      const c = store.liste.find((x) => x.id === e.id);\n      return", "if (false) return true;\n      const c = store.liste.find((x) => x.id === e.id);\n      return", 'R in der Erstellung gilt als wirkungslos'],
  [C, "if (!kannZuruecksetzen()) return { ok: false, grund: 'unveraendert' };", "", 'zuruecksetzen läuft auch, wenn es wirkungslos ist'],
  // CHA-02 E1b: Umhang-Anprobe dreht auf Rücken-¾ und zurück
  [C, "if (platz === 'umhang') { e.yawVorUmhang = e.yaw; e.yaw = UMHANG_YAW; }", "if (platz === 'umhang') { e.yawVorUmhang = e.yaw; }", 'Umhang dreht die Anprobe nicht auf den Rücken'],
  [C, "e.yaw = e.yawVorUmhang; e.yawVorUmhang = null; }", "e.yawVorUmhang = null; }", 'Platzwechsel vom Umhang dreht nicht zurück'],
  [C, "if (platz !== e.platz) {   // CHA-02", "if (true) {   // CHA-02", 'derselbe Umhang-Platz dreht erneut (überschreibt die Ausgangsdrehung)'],
  // CHA-02 E1b: Frisur-Kachel mit Etikett statt Unterzeile, Hilfe auf den Kachelbereich
  ['public/js/kammer-ui.js', "sub: '', etikett: TEXT.volkKurz[t.volk] || null,", "sub: TEXT.volk[t.volk] || '–',", 'Frisur-Kachel zeigt die Herkunft wieder als Unterzeile (verdrängt vom Namen)'],
  ['public/js/kammer-ui.js', "if (t.etikett) kappeDunkel(c, k.x + 3,", "if (false) kappeDunkel(c, k.x + 3,", 'Herkunfts-Etikett der Frisur-Kachel wird nicht gezeichnet'],
  ['public/js/kammer-ui.js', "w: KM.figur.x - KM.kachel.x - 12, zeilen: KX.hilfe[art] })", "zeilen: KX.hilfe[art] })", 'Hilfe-Overlay wieder 420 breit (ragt über den Anprobe-Rahmen)'],
];
const filter = process.argv.slice(2);
let ueberlebt = 0, laeufe = 0;
const basis = spawnSync(process.execPath, [path.join(TMP, 'tools/test-charaktere.js')], { env: Object.assign({}, process.env, { CHARAKTERE_ROOT: TMP }), encoding: 'utf8' });
if (basis.status !== 0) { console.log('Ausgangslage ist schon rot:\n' + basis.stdout); process.exit(1); }
for (const [datei, alt, neu, was] of MUTATIONEN) {
  if (filter.length && !filter.some((f) => was.includes(f))) continue;
  const pfad = path.join(TMP, datei), orig = fs.readFileSync(path.join(ROOT, datei), 'utf8').replace(/\r\n/g, '\n');   // Windows-Checkout mit CRLF: Muster mit \n sollen trotzdem treffen
  const teile = orig.split(alt);
  if (teile.length !== 2) { console.log('KEIN EINZIGER TREFFER: ' + was + ' (' + (teile.length - 1) + ')'); ueberlebt++; continue; }
  fs.writeFileSync(pfad, teile.join(neu));
  const r = spawnSync(process.execPath, [path.join(TMP, 'tools/test-charaktere.js')], { env: Object.assign({}, process.env, { CHARAKTERE_ROOT: TMP }), encoding: 'utf8' });
  fs.writeFileSync(pfad, orig);
  laeufe++;
  if (r.status === 0) { ueberlebt++; console.log('ÜBERLEBT: ' + was); } else console.log('getötet:  ' + was);
}
console.log(`${laeufe} Mutationen, ${ueberlebt} überlebt`);
process.exit(ueberlebt ? 1 : 0);
