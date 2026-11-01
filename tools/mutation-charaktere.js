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
for (const rel of ['shared/charakter.js', 'content/katalog/charakter.json', 'public/js/charaktere.js', 'public/js/kammer-ui.js', 'public/js/art.js', 'tools/test-charaktere.js']) {
  fs.mkdirSync(path.dirname(path.join(TMP, rel)), { recursive: true });
  fs.copyFileSync(path.join(ROOT, rel), path.join(TMP, rel));
}
const C = 'public/js/charaktere.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
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
  [C, "if (!e || !OUTFIT_PLAETZE.includes(platz)) return { ok: false, grund: 'platz' };\n      e.platz = platz; e.hinweis = null; aenderung();", "if (!e) return { ok: false, grund: 'platz' };\n      e.platz = platz; e.hinweis = null; aenderung();", 'Spind lässt Charakterplätze zu'],
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
