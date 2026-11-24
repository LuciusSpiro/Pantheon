'use strict';
// SPT-02 6: Mutationsprobe zu tools/test-scan-icons.js (Scan-Anzeige mit Symbolen: Gruppierung, Zähler, Balkenstück je Einheit, Zerstört als Kreuz und Strich, Rahmen des Systemziels,
// Überlauf „+n“, Symbolmaske je Art, Namen, Tooltip, Anschluss in pult-stationen.js und zonenkreuz.js). Schreibt je Lauf EINE geänderte Fassung einer Client-Datei ins Temp-Verzeichnis
// (das Repo bleibt unberührt), lässt den Test dagegen laufen (ZIELSTAPEL_DATEI bzw. SCAN_ICONS_FUER + SCAN_ICONS_QUELLE) und verlangt, dass er rot wird.
// --trocken: nur prüfen, dass jeder Text genau einmal vorkommt.
//   node tools/mutation-scan-icons.js [--trocken]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const lies = (f) => fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8').replace(/\r\n/g, '\n');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-si-'));
const trocken = process.argv.includes('--trocken');
const ZS = 'zielstapel.js', ST = 'pult-stationen.js', ZK = 'zonenkreuz.js', RN = 'render.js';
const NL = String.fromCharCode(92) + 'n';   // der Text \n (Backslash, n) im Quelltext
// [Datei, alter Text, neuer Text, Beschreibung]
const MUTATIONEN = [
  [ZS, 'let g = gruppen.find((q) => q.maske === I.maske);', 'let g = null;', 'Gruppierung: gleiche Arten werden nicht mehr zusammengefasst'],
  [ZS, 'let g = gruppen.find((q) => q.maske === I.maske);', 'let g = gruppen.find((q) => q.maske === I.maske && q.es.length < 1);', 'Gruppierung: nur die erste Einheit je Art'],
  [ZS, 'if (f.zaehler && g.es.length > 1) {', 'if (f.zaehler && g.es.length > 99) {', 'Zähler fehlt bei mehreren Einheiten'],
  [ZS, 'const sx = bx + i * (sw + 1);', 'const sx = bx;', 'Balkenstücke einer Zeile liegen übereinander statt nebeneinander'],
  [ZS, "if (e.zust === 'zer') { rc(x, y + h - 1, w, 1, F.zer); return; }", "if (e.zust === 'zer') { rc(x, y, w, h, F.zer); return; }", 'zerstört: volles rotes Stück statt 1-px-Strich'],
  [ZS, 'if (alleZer) kreuzUeber(c, x + 1, y - 1, F.zerText);', 'if (false) kreuzUeber(c, x + 1, y - 1, F.zerText);', 'zerstört: kein Kreuz über dem Symbol (nur Farbe)'],
  [ZS, "const alleZer = g.es.every((e) => e.zust === 'zer')", "const alleZer = g.es.some((e) => e.zust === 'zer')", 'Kreuz schon, wenn eine Einheit der Zeile zerstört ist'],
  [ZS, 'alleZer ? F.stapelZer : g.info.farbe', 'g.info.farbe', 'zerstört: Symbol bleibt in der Funktionsfarbe'],
  [ZS, 'if (e.id === o.selId) rand(sx - 1, y + 1, sw + 2, MASS.balkenH + 2, F.systemziel);', 'if (e.id === o.selId && false) rand(sx - 1, y + 1, sw + 2, MASS.balkenH + 2, F.systemziel);', 'kein Rahmen um das gewählte Balkenstück'],
  [ZS, 'if (e.id === o.selId) rand(sx - 1, y + 1, sw + 2, MASS.balkenH + 2, F.systemziel);', 'if (selE) rand(sx - 1, y + 1, sw + 2, MASS.balkenH + 2, F.systemziel);', 'Rahmen um alle Stücke der Zeile statt um das gewählte'],
  [ZS, 'rc(x - 1, y - 2, MASS.rand, lh - 1, F.systemziel);', 'rc(x - 1, y - 2, 1, 1, F.systemziel);', 'Zeilenmarke des Systemziels fehlt'],
  [ZS, "if (gruppen.length > f.cap) api.txt('+'", "if (gruppen.length > 999) api.txt('+'", 'Überlauf: kein „+n“'],
  [ZS, "api.txt('+' + (gruppen.length - f.cap),", "api.txt('+' + (gruppen.length),", 'Überlauf: „+n“ nennt die falsche Zahl'],
  [ZS, 'const cols = Math.min(maxCols, Math.max(1, Math.ceil(n / rows)));', 'const cols = Math.max(1, Math.ceil(n / rows));', 'Fluss: Spalten wachsen unbegrenzt (der Überlauf wird nie erreicht)'],
  [ZS, "const ART_MASKE = { emitter: 'emitter',", "const ART_MASKE = { emitter: 'antrieb',", 'Emitter bekommt das Antriebssymbol'],
  [ZS, "antrieb: 'antrieb', reaktor: 'reaktor', schildgenerator: 'schildgenerator' };", "antrieb: 'antrieb', reaktor: 'reaktor', schildgenerator: 'reaktor' };", 'Schildgenerator bekommt das Reaktorsymbol'],
  [ZS, "const wp = echt != null ? ((target && target.weapons) || []).find((w) => w && w.platz === echt) : null;", "const wp = ((target && target.weapons) || [])[0];", 'Waffensymbol: immer die erste Waffe statt der am Platz'],
  [ZS, "String(w.name).replace(WAFFEN_VORSATZ, '').replace(/^./, (ch) => ch.toUpperCase())", 'String(w.name)', 'Name: „Standardbatterie“ statt „Batterie“'],
  [ZS, "const seite = art !== 'antrieb' && zone !== 'mitte';", "const seite = zone !== 'mitte';", 'Name: auch der Antrieb nennt eine Seite'],
  [ZS, "langName: name + (seite ? ' · ' + zl[zone]", "langName: name + (seite ? ' ' + zl[zone]", 'Tooltip-Name ohne Mittelpunkt'],
  [ZS, "const sehrBesch = (e) => e.zust === 'besch' || e.pct <= 50;", "const sehrBesch = (e) => e.zust === 'besch';", 'bis 50 % ist heil: Farbe des Balkens und Wort im Tooltip weichen ab'],
  [ZS, 'return fmt(sehrBesch(e) ? Z.besch : Z.ok, { p: e.pct });', 'return fmt(sehrBesch(e) ? Z.besch : Z.ok, { p: 100 });', 'Tooltip nennt immer 100 %'],
  [ZS, "const tooltipText = (inf, e) => inf.langName + '" + NL + "' + zustandText(e);", 'const tooltipText = (inf, e) => inf.langName;', 'Tooltip ohne Zustand'],
  [ZS, 'R.ui.tooltip = { text: tooltipText(z.info, z.e),', "R.ui.tooltip = { text: '',", 'Tooltip wird nie gesetzt'],
  [ZS, 'const z = zellen.find((q) => m.x >= q.x && m.y >= q.y && m.x < q.x + q.w && m.y < q.y + q.h);', 'const z = zellen[0];', 'Tooltip: immer die erste Fläche statt der unter der Maus'],
  [ST, 'inhalt: ZST ? ZST.inhalt(target, { zellen }) : undefined });', '});', 'Zielkasten: wieder Kürzel statt Stapel (Hook nicht übergeben)'],
  [ST, 'if (ZST) ZST.tooltipSetzen(R, zellen, F);', '', 'Zielkasten: Tooltip fehlt'],
  [ST, 'text: zname, vor: zvor, active: zan,', 'text: zname, active: zan,', 'Systemziel-Knopf ohne Symbol'],
  [ST, 'const zname = zan && ZS ? (zinf ? zinf.kurzName :', 'const zname = zan && ZS ? (false ? zinf.kurzName :', 'Systemziel-Knopf: wieder Kürzel statt Name der Art'],
  [ZK, 'const INH = o.inhalt ? (l, b, zn, zu, lw) => o.inhalt(l, b, zn, zu, lw, { c, F, rc, rand, txt, tw, mass, o, R }) : inhalt;', 'const INH = inhalt;', 'Zonenkreuz: Parameter inhalt wird ignoriert'],
  [ZK, "platzName: d.platz || null, modul: d.modul || null,", 'platzName: null, modul: d.modul || null,', 'modellZiel gibt den Waffenplatz nicht weiter'],
  // Nacharbeit M1/S1/S2/K1/K2/K3
  [ZK, ", nameLang: String(d.name || d.id) };", ' };', 'M1: Modell-Eintrag ohne vollen Namen (Tooltip zeigt Kürzel)'],
  [ZS, 'String(d.nameLang || d.name || art)', 'String(d.name || art)', 'M1: Tooltip liest den Namen nicht aus nameLang'],
  [ZK, "    if (state === 'damaged') return 'besch';   // SPT-02 6: der Serverzustand geht vor (beschädigt mit 0 % ist nicht zerstört)\n", '', 'S2: damaged mit 0 % wird zerstört gezeichnet'],
  [ZK, "if (state === 'broken') return 'zer';", "if (state === 'broken' || !(pct > 0)) return 'zer';", 'S2: Prozent 0 macht jeden Zustand zerstört'],
  [ZS, 'n * MASS.balkenMin', 'n * 1', 'S1: Bedarf rechnet nur 1 px je Balkenstück'],
  [ZS, 'if (zaehler) { zaehler = false; b = bauen(); if (summe(b) <= breit) break; }', '', 'S1: der Zähler fällt nie weg (Balkenstücke werden gequetscht oder die Arten fallen in „+n“)'],
  [ZS, 'const extra = Math.max(0, Math.floor((breit - summe(b)) / b.length));', 'const extra = 0;', 'S1: freie Breite wird nicht verteilt'],
  [ZS, 'let bx = x + MASS.versatz;', 'let bx = x + 12;', 'S1: Balkenstücke beginnen im Symbol'],
  [ZS, 'const leerNeben = leerWort && Math.floor((body.h - 10 - 4 + 1) / lh) < 1;', 'const leerNeben = false;', 'K2: LEER überlappt die Symbolzeile der niedrigen Kachel'],
  [ZS, 'farben: F ? [F.text, zustandFarbe(z.e, F)] : undefined', 'farben: undefined', 'K1: Tooltip ohne Zeilenfarben'],
  [ZS, "const zustandFarbe = (e, F) => (e.zust === 'zer' ? F.zerText :", "const zustandFarbe = (e, F) => (e.zust === 'zer' ? F.text :", 'K1: zerstört im Tooltip in Textfarbe'],
  [RN, '(t.farben && t.farben[i]) || PAL.warn', 'PAL.warn', 'K1: drawTooltip ignoriert die Zeilenfarben'],
  [ZS, 'const k = MASS.kreuz; c.fillStyle', 'const k = 10; c.fillStyle', 'K3: Kreuzgröße als freie Zahl'],
];
let ueberlebt = 0, laeufe = 0;
for (const [datei, alt, neu, was] of MUTATIONEN) {
  const q = lies(datei), anz = q.split(alt).length - 1;
  if (anz !== 1) { console.log(`  FEHLER Text kommt ${anz}× vor: ${was}`); ueberlebt++; continue; }
  if (trocken) { console.log('  ok (trocken) ' + was); continue; }
  const tmp = path.join(TMP, 'm' + (++laeufe) + '-' + datei);
  fs.writeFileSync(tmp, q.replace(alt, () => neu));
  const env = Object.assign({}, process.env); delete env.ZIELSTAPEL_DATEI; delete env.SCAN_ICONS_FUER; delete env.SCAN_ICONS_QUELLE;
  if (datei === ZS) env.ZIELSTAPEL_DATEI = tmp; else { env.SCAN_ICONS_FUER = datei; env.SCAN_ICONS_QUELLE = tmp; }
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'test-scan-icons.js')], { env, encoding: 'utf8' });
  if (r.status === 0 || !/FEHLER/.test(r.stdout)) { ueberlebt++; console.log((r.status === 0 ? '  ÜBERLEBT ' : '  ABSTURZ (zählt nicht) ') + was); } else console.log('  erkannt  ' + was);
}
console.log(ueberlebt ? `${ueberlebt} Mutation(en) nicht erkannt.` : `Alle ${trocken ? 'Texte gefunden' : laeufe + ' Mutationen erkannt'}.`);
process.exit(ueberlebt ? 1 : 0);
