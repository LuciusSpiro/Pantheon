'use strict';
// SUND-02b A2: Mutationsprobe zu tools/test-sprengen.js. Kopiert Server, Shared, Content und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel
// und verlangt, dass test-sprengen.js rot wird (Exit != 0). Überlebt eine Mutation, deckt der Test die Regel nicht ab.
//   node tools/mutation-sprengen.js          (npm run test:sprengen-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muts-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'tools', 'test-sprengen.js'), path.join(TMP, 'tools', 'test-sprengen.js'));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  // Auslösung und Weigerungsgründe (posten.js)
  ['server/sim/posten.js', "  if (o.nd.besitzer === 'rom') return fehl(art, 'eigener');\n", "", 'Angreifen: römischer/eigener Crew-Posten ist kein Ziel – nicht geprüft'],
  ['server/sim/posten.js', "  if (!Kern.feindlich('rom', o.nd.besitzer)) return fehl(art, 'neutral');\n", "", 'Angreifen: Konkordat-Posten (neutral) wird nicht abgewiesen'],
  ['server/sim/posten.js', "  if (!o.nd || !o.nd.posten) return fehl(art, 'kein_posten');\n", "  if (!o.nd) return fehl(art, 'kein_posten');\n", 'Angreifen: Hex ohne Posten wird nicht abgewiesen'],
  ['server/sim/posten.js', "  if (o.sc.station) return fehl(art, 'station');\n  if (!o.nd || !o.nd.posten)", "  if (!o.nd || !o.nd.posten)", 'Angreifen: Hex mit Station wird nicht abgewiesen'],
  ['server/sim/posten.js', "  if (!Kern.feindlich('rom', o.nd.besitzer)) return fehl(art, 'neutral');\n  if (!laufend && !Ruf.rufErreicht(", "  if (!Kern.feindlich('rom', o.nd.besitzer)) return fehl(art, 'neutral');\n  if (false && !Ruf.rufErreicht(", 'Angreifen: Rang wird nicht geprüft'],
  ['server/sim/posten.js', "  if (!laufend && game.ship.docked) return fehl(art, 'docked');\n  if (o.sc.station) return fehl(art, 'station');\n  if (!o.nd || !o.nd.posten)", "  if (o.sc.station) return fehl(art, 'station');\n  if (!o.nd || !o.nd.posten)", 'Angreifen: angedockt wird nicht abgewiesen'],
  ['server/sim/posten.js', "  if (feindImHex(game, o)) return fehl(art, 'gegner');\n", "", 'Gegner im Hex verhindern nichts'],
  ['server/sim/posten.js', "  if (d > A.cfg.radius) return", "  if (false) return", 'Ring um den Posten wird nicht geprüft'],
  ['server/sim/posten.js', "  if (ship.speed > A.cfg.tempo) return", "  if (false) return", 'Tempo wird nicht geprüft'],
  ['server/sim/posten.js', "  if (game.simSzene && game.simSzene.hex === o.hex && game.simSzene.phase !== 'ende') return fehl(art, 'szene');\n", "", 'Sim-Szene verhindert nichts'],
  ['server/sim/posten.js', "  if (transferAus(game)) return fehl(art, 'transfer');\n", "", 'Transfer-Ausfall verhindert nichts'],
  ['server/sim/posten.js', "const PRUEFER = { gruenden: gruendenPruefen, ausbau: ausbauPruefen, angreifen: angreifenPruefen };", "const PRUEFER = { gruenden: gruendenPruefen, ausbau: ausbauPruefen, angreifen: () => null };", 'Anlauf prüft nie (kein Abbruch, keine Weigerung)'],
  ['server/sim/posten.js', "  if (!e || e.code === 'teile') return null;   // die Kosten zählen erst beim Abschluss\n  return { code: e.code, text: abbruchText(h.id, e.code) };", "  return null;", 'Halteprozess bricht nie ab'],
  ['server/sim/posten.js', "  if (h.id === 'angreifen') return angriffFertig(game, h);\n", "", 'Abschluss des Anlaufs startet keine Szene'],
  ['server/sim/posten.js', "dur: ART[art].cfg.dauer, hex: o.hex };", "dur: 0.05, hex: o.hex };", 'Anlaufdauer ignoriert die Daten'],
  ['server/sim/posten.js', "  else if (o.nd.posten && o.nd.besitzer !== 'rom' && Kern.feindlich('rom', o.nd.besitzer)) art = 'angreifen';", "", 'space.po zeigt „Posten angreifen“ nie'],
  ['server/sim/posten.js', "  if (!game.weltsim || sprengungGesperrt(game, hex)) return [];", "  if (!game.weltsim) return [];", 'Ruf-Sperre je Hex gilt nie'],
  ['server/sim/posten.js', "ws.zustand.tick - letzte < W.sprengen.wert.ruf_sperre_ticks;", "ws.zustand.tick - letzte < 1;", 'Ruf-Sperre ignoriert die Daten'],
  ['server/sim/posten.js', "  for (const wk of gueltig || []) if (wk.typ === 'posten_gesprengt') sp[wk.ort] = z.tick;", "", 'Sprengung wird nicht für die Sperre gemerkt'],
  ['server/sim/posten.js', "  const q = require('../../content/welt/ruf-werte.json').werte.quellen.wert['posten_gesprengt_' + besitzer];\n  if (!q) return [];", "  const q = require('../../content/welt/ruf-werte.json').werte.quellen.wert['posten_gesprengt_ger'];\n  if (!q) return [];", 'Ruf-Quelle immer die der Germanen'],
  ['server/sim/posten.js', "out[hex] = Math.floor(t);\n  return out;\n}\nfunction lesen", "out[hex] = 0;\n  return out;\n}\nfunction lesen", 'Leser der Sprengungen verliert den Tick'],
  // Szene (kriegslage-szene.js)
  ['server/sim/kriegslage-szene.js', "  if (S.modus === 'angriff') return angriffSieg(game, S);\n", "", 'Sieg im Angriff: normaler Szenen-Sieg (keine Sprengung)'],
  ['server/sim/kriegslage-szene.js', "  if (S.modus === 'angriff') return angriffNiederlage(game, S, grund);\n", "", 'Niederlage im Angriff: normale Szenen-Niederlage'],
  ['server/sim/kriegslage-szene.js', "const staerke = Math.max(1, nd.garnison * (Number(ANGRIFF.staerke_faktor) || 1));", "const staerke = Math.max(1, 3);", 'Wellen nicht aus der Garnison'],
  ['server/sim/kriegslage-szene.js', "const vorlauf = Math.max(0, Number(ANGRIFF.vorlauf) || 0);", "const vorlauf = 20;", 'Vorlauf ignoriert die Daten'],
  ['server/sim/kriegslage-szene.js', "  verteidigerAufstellen(game, S, L);\n  Flotte.wellenStartAusPlan(game, { plan, volk: fraktion,", "  Flotte.wellenStartAusPlan(game, { plan, volk: fraktion,", 'Angriff stellt keine Verbündeten auf'],
  ['server/sim/kriegslage-szene.js', "tag: SZENEN_TAG, vorlauf: S.vorlauf, restAnteil: C.restAnteil });\n  try { Kriegslage.szeneNachziehen(game); } catch (e) { if (game.countError) game.countError('sim-szene-nachziehen', e); }\n  const fr =", "tag: SZENEN_TAG, vorlauf: 0, restAnteil: C.restAnteil });\n  try { Kriegslage.szeneNachziehen(game); } catch (e) { if (game.countError) game.countError('sim-szene-nachziehen', e); }\n  const fr =", 'erste Welle ohne Vorlauf'],
  ['server/sim/kriegslage-szene.js', "const folge = (nd && nd.garnison > 0 ? [{ typ: 'abwehr_verlust', ort: S.hex, punkte: nd.garnison }] : []).concat([sprengung]);", "const folge = [sprengung].concat(nd && nd.garnison > 0 ? [{ typ: 'abwehr_verlust', ort: S.hex, punkte: nd.garnison }] : []);", 'Sieg: Sprengung vor dem Verlust der Garnison (Prüfer lehnt ab)'],
  ['server/sim/kriegslage-szene.js', "punkte: nd.garnison }] : []).concat([sprengung]);", "punkte: nd.garnison / 2 }] : []).concat([sprengung]);", 'Sieg: nur die halbe Garnison fällt'],
  ['server/sim/kriegslage-szene.js', ".concat(pr.gueltig, ruf);", ".concat(pr.gueltig);", 'Sieg: kein Ruf'],
  ['server/sim/kriegslage-szene.js', "const ruf = gilt ? Posten.sprengungRuf(game, S.hex, S.fraktion) : [];", "const ruf = gilt ? Posten.sprengungRuf(game, S.hex, 'pirat') : [];", 'Sieg: Ruf-Quelle der Piraten für Germanen'],
  ['server/sim/kriegslage-szene.js', "const p = r2ab(Math.min(nd.garnison, S.garn0 * Math.min(1, S.killPunkte / S.planPunkte)));", "const p = r2ab(Math.min(nd.garnison, S.garn0));", 'Flucht/Niederlage: die ganze Garnison fällt statt anteilig'],
  ['server/sim/kriegslage-szene.js', "  if (S.modus === 'angriff') {   // SUND-02b A2: die Garnison verliert anteilig", "  if (false) {   // SUND-02b A2: die Garnison verliert anteilig", 'Flucht/Niederlage: die Garnison verliert nichts'],
  ['server/sim/kriegslage-szene.js', "const ruf = imKampf && S.modus !== 'angriff' ? Ruf.szeneFlucht(", "const ruf = imKampf ? Ruf.szeneFlucht(", 'Flucht im Angriff kostet Ruf (Fahrerflucht)'],
  ['server/sim/kriegslage-szene.js', "    const x = S.modus === 'angriff' ? { x: 1 } : {};", "    const x = {};", 'Szenenzeile kennt den Angriff nicht (x)'],
  ['server/sim/kriegslage-szene.js', "p: 's', o: null, x: 1 };", "p: 's', o: null };", 'Ergebniszeile Sieg ohne x'],
  ['server/sim/kriegslage-szene.js', "p: 'n', o: null, x: 1 };", "p: 'n', o: null };", 'Ergebniszeile Niederlage ohne x'],
  ['server/sim/kriegslage-szene.js', "  const sperre = gilt && Posten.sprengungGesperrt(game, S.hex);", "  const sperre = false;", 'Sieg: Sperre wird nicht gemeldet'],
  // Wirkung (wirkungen.js)
  ['server/weltsim/wirkungen.js', "      if (k.nd.garnison > POSTEN.sprengen.wert.garnison_max + 1e-9) return 'Garnison ist noch zu stark';\n", "", 'Prüfer posten_gesprengt: Garnison egal (Sprengen ohne Kampf)'],
  ['server/weltsim/wirkungen.js', "      if (k.nd.besitzer === null || !feind('rom', k.nd.besitzer)) return 'Posten gehört keinem Feind von Rom';\n", "", 'Prüfer posten_gesprengt: Besitzer egal (Rom, Konkordat, eigener Crew-Posten)'],
  ['server/weltsim/wirkungen.js', "      if (!k.nd.posten) return 'Ort hat keinen Posten';\n      if (k.nd.besitzer === null ||", "      if (k.nd.besitzer === null ||", 'Prüfer posten_gesprengt: Posten egal'],
  ['server/weltsim/wirkungen.js', "      if (k.hafen) return 'Ort hat einen Hafen';\n      if (!k.nd.posten) return 'Ort hat keinen Posten';", "      if (!k.nd.posten) return 'Ort hat keinen Posten';", 'Prüfer posten_gesprengt: Hafen egal'],
  ['server/weltsim/wirkungen.js', "H.postenVerlieren(c, wk.ort, c.z.hexe[wk.ort].besitzer, 'rom');", "H.postenVerlieren(c, wk.ort, c.z.hexe[wk.ort].besitzer, 'ger');", 'Anwender: Posten fällt an ger statt an rom'],
  // Kopplung (kriegslage.js, game.js)
  ['server/sim/kriegslage.js', "    ws.sprengungen = sprengSicher;\n", "", 'kein Rollback der Sprengungen'],
  ['server/sim/kriegslage.js', "const sb = Posten.sprengungenSave(ws); if (sb) b.sprengungen = sb;", "", 'Speichern vergisst die Sprengungen'],
  ['server/sim/kriegslage.js', "game.weltsim.sprengungen = Posten.sprengungenLesen(b.sprengungen);", "game.weltsim.sprengungen = {};", 'Laden vergisst die Sprengungen'],
  ['server/game.js', "      case 'weapons.posten.angreifen': err = Posten.angreifenStart(this, p); break;", "", 'Befehl weapons.posten.angreifen fehlt'],
  // Daten und Texte
  ['content/welt/posten-werte.json', '"ruf_sperre_ticks": 40', '"ruf_sperre_ticks": 1', 'Daten: Ruf-Sperre praktisch aus'],
  ['content/welt/posten-werte.json', '"angreifen": "miles"', '"angreifen": "legat"', 'Daten: Angreifen verlangt Legat (nicht Kann, nie Muss)'],
  ['content/welt/ruf-werte.json', '"folge": {"ger": -4}, "_hinweis": "Die Crew sprengt', '"_hinweis": "Die Crew sprengt', 'Daten: Sprengen senkt die Germanen nicht'],
  ['content/flotte/sim-szene.json', '"text": "Posten {ort} gesprengt. Der Sektor ist frei."', '"text": "Ok."', 'Text: Funk „Posten gesprengt“'],
  // Bewusst nicht in der Liste (gleichwertige Mutanten, aus der Datenlage nicht rot zu bekommen):
  //  - angreifenPruefen: Hafen nicht geprüft / angriffStarten: Hafen egal: ein Hex mit Hafen trägt in der Sim nie einen Posten, 'kein_posten' fängt es vorher ab (der Weigerungsgrund 'hafen' ist Absicherung).
  //  - angriffSieg: Ruf auch wenn die Sprengung ungültig wäre (gilt = true): Vorabprüfung und Tick sehen denselben Zustand (kein Tick dazwischen), der Zweig ist nicht erreichbar.
  ["server/sim/kriegslage-szene.js","  const wirk = gueltige(game, verlustWirkungen(game, S));\n  aufraeumen(game, S);\n  game.simSzeneEnde = { bis: game.time + endeAnzeige(game), szene: game.ship.scene, p: 'n'","  const wirk = gueltige(game, verlustWirkungen(game, S).concat(Ruf.szeneFlucht(S, true)));\n  aufraeumen(game, S);\n  game.simSzeneEnde = { bis: game.time + endeAnzeige(game), szene: game.ship.scene, p: 'n'","A2-Fix: Niederlage im Angriff kostet Ruf (Fahrerflucht)"],
  ["server/sim/kriegslage-szene.js","const r2ab = (v) => Math.floor(v * 100 + 1e-9) / 100;","const r2ab = (v) => Math.ceil(v * 100) / 100;","A2-Fix: Verlust der Garnison rundet auf (Prüfer lehnt ab)"],
  ["server/sim/kriegslage-szene.js","    else if (S.modus === 'angriff') funk(game, fmt((T.angriff || {}).finale, { kommandant: (T.angriff || {}).kommandant || '' }));\n","","A2-Fix: Finale-Funk im Angriff fehlt"],
  ["server/sim/kriegslage-szene.js","const kdName = S.kommandant ? S.kommandant.name : (S.modus === 'angriff' ? (texte().angriff || {}).kommandant : null);","const kdName = S.kommandant ? S.kommandant.name : null;","A2-Fix: Finale der Szenenzeile ohne Postenkommandant"],
  ["server/sim/kriegslage-szene.js","    if (sperre) funk(game, fmt((A.sieg || {}).ohneRuf","    if (!sperre) funk(game, fmt((A.sieg || {}).ohneRuf","A2-Fix: Sperr-Meldung invertiert"],
  ["server/sim/kriegslage-szene.js","    if (game.markSaveDue) game.markSaveDue('docked');\n  }\n  merken(game, S, gesprengt","  }\n  merken(game, S, gesprengt","A2-Fix: Sieg löst kein markSaveDue aus"],
  ["server/sim/posten.js","  if (game.simSzene && game.simSzene.phase !== 'ende') return null;\n  const E = game.simSzeneEnde;","  const E = game.simSzeneEnde;","A2-Fix: space.po auch während der Szene"],
  ["server/sim/posten.js","  if (E && E.bis > game.time && E.szene === game.ship.scene) return null;","","A2-Fix: space.po auch während der Ergebniszeile"],
  ["server/sim/posten.js","  const e = angreifenPruefen(game, true);\n  if (e) { game.emit('frachtBeamen', { phase: 'abbruch', was: 'posten', grund: e.code }); game.oda(abbruchText(art, e.code), null); return false; }\n  const o = ort(game);","  const e = null;\n  if (e) { game.emit('frachtBeamen', { phase: 'abbruch', was: 'posten', grund: e.code }); game.oda(abbruchText(art, e.code), null); return false; }\n  const o = ort(game);","A2-Fix: Anlauf-Abschluss ohne Schlussprüfung"],
  ["server/sim/kriegslage.js","if (t > game.weltsim.zustand.tick) delete game.weltsim.sprengungen[hex];","if (false) delete game.weltsim.sprengungen[hex];","A2-Fix: Sprengung aus der Zukunft bleibt nach neuer Welt"],
];

let ueberlebt = 0;
console.log(`Mutationsprobe test-sprengen.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
const basis = spawnSync(process.execPath, ['tools/test-sprengen.js'], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
console.log(`  Ausgangslage (unverändert): ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 5).join('\n')); process.exit(1); }
for (const [datei, alt, neu, was] of MUTATIONEN) {
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  if (text.split(alt).length !== 2) { console.log(`  ?? ${was}: Textstelle nicht eindeutig gefunden (${datei})`); ueberlebt++; continue; }
  const mut = text.replace(alt, () => neu);
  fs.writeFileSync(f, nl ? mut.replace(/\n/g, '\r\n') : mut);
  const r = spawnSync(process.execPath, ['tools/test-sprengen.js'], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
  fs.writeFileSync(f, orig);
  const rot = r.status !== 0;
  const fehler = (r.stdout || '').split('\n').filter((l) => /FEHLER/.test(l));
  if (!rot) ueberlebt++;
  console.log(`  ${rot ? 'rot  ' : 'GRÜN '} ${was}${rot ? ` (${fehler.length} Fehler, z. B. ${(fehler[0] || 'Absturz').replace(/^\s*FEHLER\s*/, '').slice(0, 70)})` : '  <-- ÜBERLEBT'}`);
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(ueberlebt ? `${ueberlebt} Mutation(en) überlebt` : 'alle Mutationen erkannt');
process.exit(ueberlebt ? 1 : 0);
