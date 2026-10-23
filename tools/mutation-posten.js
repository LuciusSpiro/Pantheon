'use strict';
// SUND-02b A1: Mutationsprobe zu tools/test-posten.js. Kopiert Server, Shared, Content und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE
// Regel und verlangt, dass test-ruf.js rot wird (Exit != 0). Überlebt eine Mutation, deckt der Test die Regel nicht ab.
//   node tools/mutation-posten.js          (npm run test:posten-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-mutp-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'tools', 'test-posten.js'), path.join(TMP, 'tools', 'test-posten.js'));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
// Bewusst nicht in der Liste (äquivalente Mutanten, nicht rot zu bekommen): „Prüfer posten_gehisst: Hafen egal“ (die Anspruchsliste enthält nur hafenfreie Hexe, die Prüfung auf den Anspruch fängt alles, was
// der Hafen-Check fangen würde; Daten-Test belegt die Hafenfreiheit) und „Dock auch an Hexen mit Station“ (jedes Hex mit Station hat in den Daten ein festes sc.dock, dockLage nimmt dieses zuerst).
const MUTATIONEN = [
  ['server/sim/posten.js', "  if (!W.anspruch.wert.rom.includes(o.hex)) return fehl(art, 'anspruch');\n", "", 'Gründen: Roms Anspruch wird nicht geprüft'],
  ['server/sim/posten.js', "  if (o.nd.besitzer !== null || o.nd.posten) return fehl(art, 'belegt');\n  if (!laufend && !Ruf.rufErreicht(", "  if (!laufend && !Ruf.rufErreicht(", 'Gründen: belegter Sektor wird nicht geprüft'],
  ['server/sim/posten.js', "  if (o.nd.besitzer !== null || o.nd.posten) return fehl(art, 'belegt');\n  if (!laufend && !Ruf.rufErreicht(game, ART[art].rang))", "  if (o.nd.besitzer !== null || o.nd.posten) return fehl(art, 'belegt');\n  if (false)", 'Gründen: Rang wird nicht geprüft'],
  ['server/sim/posten.js', "  if (o.nd.crew === true) return fehl(art, 'schon');\n  if (!laufend && !Ruf.rufErreicht(game, ART[art].rang))", "  if (o.nd.crew === true) return fehl(art, 'schon');\n  if (false)", 'Ausbau: Rang wird nicht geprüft'],
  ['server/sim/posten.js', "  if (o.sc.station) return fehl(art, 'station');\n  if (!o.nd) return fehl(art, 'anspruch');", "  if (!o.nd) return fehl(art, 'anspruch');", 'Gründen: Station im Hex wird nicht geprüft'],
  ['server/sim/posten.js', "  if (feindImHex(game, o)) return fehl(art, 'gegner');\n", "", 'Gegner im Hex verhindern nichts'],
  ['server/sim/posten.js', "  if (d > A.cfg.radius) return", "  if (false) return", 'Ring um den Postenplatz wird nicht geprüft'],
  ['server/sim/posten.js', "  if (ship.speed > A.cfg.tempo) return", "  if (false) return", 'Tempo wird nicht geprüft'],
  ['server/sim/posten.js', "  if (game.simSzene && game.simSzene.hex === o.hex && game.simSzene.phase !== 'ende') return fehl(art, 'szene');\n", "", 'Sim-Szene verhindert nichts'],
  ['server/sim/posten.js', "  if (transferAus(game)) return fehl(art, 'transfer');\n", "", 'Transfer-Ausfall verhindert nichts'],
  ['server/sim/posten.js', "  if (!e || e.code === 'teile') return null;   // die Kosten zählen erst beim Abschluss\n  return { code: e.code, text: abbruchText(h.id, e.code) };", "  return null;", 'Halteprozess bricht nie ab'],
  ['server/sim/posten.js', "  if (k.ersatzteil) game.inventory.ersatzteil", "  if (false) game.inventory.ersatzteil", 'Kosten werden nie gebucht'],
  ['server/sim/posten.js', "  const wirkungen = [wk, { typ: 'ruf_aenderung'", "  const wirkungen = [wk, false && { typ: 'ruf_aenderung'", 'kein Ruf fürs Gründen'],
  ['server/sim/posten.js', "      reg[hex].g = 1;\n", "", 'Halten-Ruf mehrfach'],
  ['server/sim/posten.js', "    if (!istCrew(z, hex)) { delete reg[hex]; continue; }", "    if (!istCrew(z, hex)) { continue; }", 'gefallener Posten bleibt in der Liste'],
  ['server/sim/posten.js', "dur: ART[art].cfg.dauer, hex: o.hex };", "dur: 0.05, hex: o.hex };", 'Haltedauer ignoriert die Daten'],
  ['server/weltsim/wirkungen.js', "      if (k.nd.besitzer !== null) return 'Ort hat schon einen Besitzer';\n", "", 'Prüfer posten_gehisst: Besitzer egal'],
  ['server/weltsim/wirkungen.js', "      if (!POSTEN.anspruch.wert.rom.includes(wk.ort)) return 'Sektor liegt nicht in Roms Anspruch';\n", "", 'Prüfer posten_gehisst: Anspruch egal'],
  ['server/weltsim/wirkungen.js', "      if (k.nd.posten) return 'Ort hat schon einen Posten';\n", "", 'Prüfer posten_gehisst: Posten egal'],
  ['server/weltsim/wirkungen.js', "      if (!POSTEN.anspruch.wert.rom.includes(wk.ort)) return 'Sektor liegt nicht in Roms Anspruch';\n      if (z.flotten.some((fl) => fl.ort === wk.ort && fl.staerke > 0 && feind('rom', fl.fraktion))) return 'feindliche Flotte im Sektor';", "      if (!POSTEN.anspruch.wert.rom.includes(wk.ort)) return 'Sektor liegt nicht in Roms Anspruch';", 'Prüfer posten_gehisst: Feindflotte egal'],
  ['server/weltsim/wirkungen.js', "nd.anspruch = {}; nd.crew = true;", "nd.anspruch = {};", 'posten_gehisst setzt crew nicht'],
  ['server/weltsim/wirkungen.js', "nd.posten = true; nd.besitzer = 'rom'; nd.garnison = c.w.garrison;", "nd.posten = true; nd.besitzer = 'rom'; nd.garnison = 0;", 'posten_gehisst: keine Garnison'],
  ['server/weltsim/wirkungen.js', "      if (k.nd.crew === true) return 'Posten ist schon ein Stützpunkt';\n", "", 'Prüfer posten_ausgebaut: schon Stützpunkt egal'],
  ['server/weltsim/wirkungen.js', "      if (!k.nd.posten || k.nd.besitzer !== 'rom') return 'kein römischer Posten';\n", "", 'Prüfer posten_ausgebaut: Besitzer egal'],
  ['server/weltsim/wirkungen.js', "nd.crew = true; nd.garnison = Math.max(nd.garnison, c.w.garrison);", "nd.garnison = Math.max(nd.garnison, c.w.garrison);", 'posten_ausgebaut setzt crew nicht'],
  ['server/weltsim/kern.js', "  delete nd.crew;   // SUND-02b A1", "  // SUND-02b A1", 'gefallener Posten behält crew'],
  ['server/sim/besitz.js', "return crewPosten(game, hex);\n  return !GESPERRT", "return false;\n  return !GESPERRT", 'Stützpunkt darf nicht angedockt werden'],
  ['server/sim/besitz.js', "&& e.besitzer === 'rom' && e.crew === true);", "&& e.crew === true);", 'crewPosten: Besitzer egal'],
  ['server/sim/besitz.js', "return { x: pl.x, y: pl.y + pl.r + POSTEN.dock.wert.abstand };", "return { x: pl.x, y: pl.y };", 'Dock liegt im Posten'],
  ['server/sim/besitz.js', "return crewPosten(game, hex) ? ((texte().dock || {}).handel", "return false ? ((texte().dock || {}).handel", 'Handel am Stützpunkt nicht gesperrt'],
  ['server/sim/werft.js', "  if (hex && Besitz.crewPosten(game, hex)) return true;\n", "", 'Werft am Stützpunkt fehlt'],
  ['server/sim/shop.js', "  if (sperre) return sperre;", "", 'Shop verkauft am Stützpunkt'],
  ['server/sim/space.js', "const dockL = Besitz.dockLage(game, sc, loc.hex || Sektoren.hexVonOrt(loc.id));", "const dockL = sc.dock;", 'Dockerkennung liest nur sc.dock'],
  ['server/sim/space.js', "const dockB = Besitz.dockLage(game, sc, hexB);", "const dockB = sc.dock;", 'enterScene: Dock nur sc.dock (Laden landet im All)'],
  ['server/sim/kriegslage.js', "&& nd.besitzer === 'rom' && nd.garnison > 0) hexe[code].crew = true;", "&& nd.besitzer === 'rom') hexe[code].crew = true;", 'Overlay: Stützpunkt ohne Garnison'],
  ['server/sim/kriegslage.js', "    ws.posten = postenSicher;\n", "", 'kein Rollback der Postenliste'],
  ['server/sim/kriegslage.js', "const pb = Posten.toSave(ws); if (pb) b.posten = pb;", "", 'Speichern vergisst die Postenliste'],
  ['server/sim/kriegslage.js', "game.weltsim.posten = Posten.lesen(b.posten);", "game.weltsim.posten = {};", 'Laden vergisst die Postenliste'],
  ['server/sim/kriegslage.js', "  else if (i >= 0 && (!dock || !sp.dockOk)) m.splice(i, 1);", "  else if (i >= 0 && !sp.dockOk) m.splice(i, 1);", 'Dock-Marker bleibt nach dem Verlust des Postens'],
  ['server/weltstand.js', "if (game.weltsim && !Besitz.dockbar(game, loc)) {", "if (false) {", 'Laden ohne Rückfall'],
  ['server/sim/fracht.js', "  else if (h.kind === 'posten') { const r = require('./posten.js').haltWeiter(game, h); if (r) return void beamStop(game, r.code, r.text); }   // SUND-02b A1\n", "  else if (h.kind === 'posten') { /* nichts */ }\n", 'fracht.update prüft den Posten-Halt nicht'],
  ['server/sim/fracht.js', "    require('./posten.js').haltFertig(game, h);", "    /* nichts */", 'Abschluss ruft den Posten nicht'],
  ['content/welt/posten-werte.json', '"rom": ["0503", "0505"]', '"rom": ["0503", "0505", "0703"]', 'Daten: Anspruch ohne Symmetrie'],
  ['content/welt/posten-werte.json', '"gruenden": "optio", "ausbau": "centurio"', '"gruenden": "centurio", "ausbau": "optio"', 'Daten: Ausbau verlangt weniger als Gründen'],
  ['content/flotte/posten.json', '"anspruch": "Dieser Sektor liegt nicht in Roms Anspruch."', '"anspruch": "Nein."', 'Text: Anspruch-Weigerung'],
];

let ueberlebt = 0;
console.log(`Mutationsprobe test-posten.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
const basis = spawnSync(process.execPath, ['tools/test-posten.js'], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
console.log(`  Ausgangslage (unverändert): ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 5).join('\n')); process.exit(1); }
for (const [datei, alt, neu, was, zusatz] of MUTATIONEN) {
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  if (text.split(alt).length !== 2) { console.log(`  ?? ${was}: Textstelle nicht eindeutig gefunden (${datei})`); ueberlebt++; continue; }
  const mut = text.replace(alt, () => neu);
  const mut2 = zusatz ? mut.replace(zusatz[0], () => zusatz[1]) : mut;
  fs.writeFileSync(f, nl ? mut2.replace(/\n/g, '\r\n') : mut2);
  const r = spawnSync(process.execPath, ['tools/test-posten.js'], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
  fs.writeFileSync(f, orig);
  const rot = r.status !== 0;
  const fehler = (r.stdout || '').split('\n').filter((l) => /FEHLER/.test(l));
  if (!rot) ueberlebt++;
  console.log(`  ${rot ? 'rot  ' : 'GRÜN '} ${was}${rot ? ` (${fehler.length} Fehler, z. B. ${(fehler[0] || 'Absturz').replace(/^\s*FEHLER\s*/, '').slice(0, 70)})` : '  <-- ÜBERLEBT'}`);
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(ueberlebt ? `${ueberlebt} Mutation(en) überlebt` : 'alle Mutationen erkannt');
process.exit(ueberlebt ? 1 : 0);
