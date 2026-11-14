'use strict';
// BEA-03 B: Tiefe des Beats hinterhalt (server/sim/faden-hinterhalt.js, Art hinterhalt in faden-szene.js, Halt in reise.js hop). In-process, ohne Server. Ergaenzt tools/test-hinterhalt-kern.js (Kern: Schnellsprung, Einzelsprung,
// anderer Sektor, gelungen/gescheitert, Zufallsstrom) und doppelt ihn nicht:
//   1  Crewgroesse 1 bis 3: Zahl der Gegner und Funk aus den Daten (szenen-werte.json hinterhalt.anzahl), nie als Literal; Ausgang gelungen (Crew 1), gescheitert (Crew 3)
//   2  Speichern und Laden: der Sektor steht nicht im Speicherstand, der Szenen-Beat steht nach dem Laden wieder aus, waehlt den Sektor neu und loest wieder aus
//   3  Datei-Beat mit parameter.hex: unspielbarer Sektor wird schon von der Vorlagenpruefung abgelehnt; spielbar ohne Szene und ausser Reichweite (erreichbar_max): der Beat scheitert sauber; der eigene Sektor beginnt sofort
//   4  Beat ohne waehlbaren Sektor: scheitert sauber (Logbuch, Gedaechtnis, nichts bleibt stehen)
//   5  zwei Hinterhalte hintereinander (erst gelungen, dann gescheitert): beide Eintraege im Gedaechtnis, nichts bleibt stehen
//   6  nie zwei Kaempfe uebereinander: Sim-Szene und Reise-Gefahr vor dem Hinterhalt (er wartet), Sim-Szene im Hinterhalt (unterbrochen, der Beat steht wieder aus und loest erneut aus)
//   7  Andocken im Kampf beendet den Beat gescheitert; die Frist (16 Taetigkeiten) beendet ihn gescheitert und raeumt die Szene weg
//   8  Funktext nennt den Ort (Halt, Vorwarnung) fuer zwei verschiedene Sektoren; die Texte der Daten tragen die Platzhalter
//   9  Daten-Grep: nichts aus werte.hinterhalt (Salz, Texte) steht im Servercode ausserhalb der Daten
//   10 Zufallsstrom ohne laufenden Hinterhalt bitgleich: ein Faden, der wartet oder an einem anderen Sektor lauert, aendert keinen einzigen Zug von game.rng
//   node tools/test-faden-hinterhalt.js        (npm run test:faden-hinterhalt)     Mutationsprobe: tools/mutation-faden-hinterhalt.js
const fs = require('fs');
const path = require('path');
const V = require('./test-faden-vorlagen.js');
const X = require('./faden-fixture.js');
const Sektoren = require('../shared/sektoren.js');
const Space = require('../server/sim/space.js');
const Sprung = require('../server/sim/sprung.js');
const Reise = require('../server/sim/reise.js');
const RE = require('../server/sim/reise-ereignis.js');
const Faden = require('../server/sim/faden.js');
const SZ = require('../server/sim/faden-szene.js');
const HH = require('../server/sim/faden-hinterhalt.js');
const B1 = require('../server/sim/faden-b1.js');
const P = require('../server/sim/faden-pruefer.js');
const Testhilfe = require('./gegner-testhilfe.js');
const CONFIG = require('../shared/config.js');
const { D } = X;
const DT = 1 / CONFIG.tickHz;

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const lies = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));
const SZD = lies('content/faeden/szenen-werte.json');
const HW = SZD.werte.hinterhalt.wert;
const T = SZD.texte;
const NAMEN = ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'];
const anzahl = (crew) => Number(HW.anzahl[String(crew)]);   // Soll aus den Daten
const ab = (g) => { const s = g.ship; s.docked = false; s.dockedAt = null; s.helm.stage = 1; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; };
const betritt = (g, hex) => { Space.enterScene(g, Sektoren.ortVonHex(hex), {}); ab(g); };
const hexNun = (g) => Sektoren.hexVonOrt(g.ship.scene);
const schritte = (g, sek) => { for (let i = 0; i < Math.round(sek * CONFIG.tickHz); i++) g.step(); };
const faellig = (f, i) => { f.beat = i; f.phase = 'wartet'; f.laufend = null; f.zaehler = f.abstand; };
const weiter = (g, f) => Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: D.vorlage(f.vorlage).beats[f.beat].id });
const funkMit = (g) => { const out = []; const o = g.emit.bind(g); g.emit = (...a) => { if (a[0] === 'radio' && a[1]) out.push(String(a[1].text)); return o(...a); }; return out; };
const odaMit = (g) => { const out = []; const o = g.oda.bind(g); g.oda = (t, k) => { out.push(String(t)); return o(t, k); }; return out; };
const tags = (g) => g.space.enemies.map((e) => e.tag);
const stub = () => ({ disposed: false, mode: 'mock', beiGrenze() {} });   // aktiver Lage-Spielleiter (Fristen laufen nur mit ihm, faden.js B-S3)
const alleHexe = Object.keys(lies('content/welt/sund_frei.json').hexe);
const ged = (f) => f.nsc.gedaechtnis.map((x) => x.ereignis);
const toteSzene = (g) => { for (const e of g.space.enemies.filter((x) => /^fs\d+$/.test(x.tag || ''))) Testhilfe.toeten(g, e); };
const nichtsStehen = (g) => !g.fadenSzene && !(g.fadenWarte || []).length && g.space.enemies.length === 0;
const chance = (g, p) => { g.C.reise.neutralChance = p; g.C.reise.neutralPlus = 0; g.C.reise.neutralMax = p; g.C.reise.feindChance = p; };

// Sektoren der Karte, die nicht spielbar sind (die Vorlagenpruefung lehnt sie als parameter.hex ab)
const KARTE = Object.keys(Sektoren.KARTE.hexe);
const UNSPIELBAR = KARTE.filter((h) => !P.sundSpielbar(h));

// Testvorlage: Hinterhalt-Beats nacheinander (je Eintrag hex oder null), danach der Abschluss
const vorlage = (id, hexe) => ({
  format: 'faden-vorlage/1', id, titel: 'Hinterhalt (Tiefentest)',
  ausloeser: [{ art: 'notruf', ausgang: 'gelungen' }], volk_erlaubt: ['rom', 'kon'],
  nsc: { status: 'aktiv', haltung: 2, klassen: ['frachter', 'kurier'] }, hinweise: {},
  beats: hexe.map((hex, i) => ({
    id: 'h_' + i, typ: 'hinterhalt', parameter: hex ? { hex } : {},
    aus: { gelungen: { status: 'aktiv', weiter: i + 1 < hexe.length ? 'h_' + (i + 1) : 'h_abschluss', folge: [] }, gescheitert: { status: 'geflohen', weiter: i + 1 < hexe.length ? 'h_' + (i + 1) : 'h_abschluss', folge: [] } },
  })).concat([{ id: 'h_abschluss', typ: 'abschluss', erfolg: { ereignis: ['hinterhalt_gelungen'] }, aus: { gelungen: { folge: [] }, gescheitert: { folge: [] } } }]),
});
const registriere = (v) => D.registriere(v);
const registriereOk = (v) => { const r = registriere(v); if (!r.ok) throw new Error('Vorlage ' + v.id + ' ungueltig: ' + r.fehler.join('; ')); };

function spiel(seed, env, crew) {
  const g = X.F.neuesSpiel({ crew: crew || 3, seed, names: NAMEN.slice(0, crew || 3), env: Object.assign({ FAEDEN: '1', REISE_EREIGNISSE: 'off' }, env || {}) }).g; ab(g);
  for (const h of alleHexe) g.explore.erkunde(h);
  chance(g, 0);
  return g;
}
function startFaden(g, vorlageId, notrufHex, beat) {
  const a = V.notrufOhneOrt(g, 'notruf_pirat_haendler', notrufHex || '0403', 'gelungen');
  const r = Faden.befehlAnwenden(g, { typ: 'faden_oeffnen', vorlage: vorlageId, parameter: { angebot: a.nr } });
  if (!r.ok) throw new Error('Faden ' + vorlageId + ' nicht geoeffnet: ' + r.grund);
  const f = r.faden; faellig(f, beat || 0);
  return f;
}
function reiseVorbereiten(g, ziel) {
  Sprung.selectDest(g, Sektoren.ortVonHex(ziel));
  const p = Sprung.sprungpunkt(g, g.reisePlan.hops[0]); g.ship.x = p.x - 80; g.ship.y = p.y;
  for (let i = 0; i < 40 * CONFIG.tickHz && !g.ship.jump.ready; i++) g.step();
  return g.reisePlan.hops.slice();
}
function rngLog(g) {
  const log = [];
  for (const m of Object.keys(g.rng)) if (typeof g.rng[m] === 'function') { const o = g.rng[m].bind(g.rng); g.rng[m] = (...a) => { const v = o(...a); log.push(m + ':' + (typeof v === 'number' ? v.toFixed(4) : v)); return v; }; }
  return log;
}
function reiseGefahr(g) {   // eine echte Reise-Gefahr des Katalogs (Vorlauf, dann Raeuber), wie nach einem Sprung
  const nr = RE.zaehleSprung(g);
  const hex = hexNun(g);
  RE.ausloesen(g, { nr, id: 'piraten_hinterhalt', art: 'piraten', variante: 'hinterhalt', ort_typ: null, hex, ankunft: hex, sim: null, schluessel: 'pt|' + hex, textIdx: 0 });
  const R = g.weltsim.reise;
  return R.laufend[R.laufend.length - 1];
}

registriereOk(vorlage('hht_0304', ['0304']));
registriereOk(vorlage('hht_0505', ['0505']));
registriereOk(vorlage('hht_zwei', ['0304', '0505']));
registriereOk(vorlage('hht_frei', [null]));

function main() {
  // =====================================================================================================================================================================
  console.log('\n1. Crewgroesse 1 bis 3: Gegner und Funk aus den Daten');
  {
    ok(Object.keys(HW.anzahl).join() === '1,2,3' && anzahl(1) < anzahl(2) && anzahl(2) < anzahl(3), `Daten: Gegner je Crew ${anzahl(1)}, ${anzahl(2)}, ${anzahl(3)} (steigend)`);
    for (const crew of [1, 2, 3]) {
      const g = spiel(460 + crew, {}, crew);
      const funk = funkMit(g);
      const f = startFaden(g, 'hht_0304');
      ok(weiter(g, f).ok && f.laufend.hex === '0304', `Crew ${crew}: der Beat wartet an 0304`);
      betritt(g, '0304'); schritte(g, 0.2);
      const fs = g.fadenSzene;
      ok(!!fs && fs.n === anzahl(crew) && tags(g).filter((t) => t === fs.tag).length === anzahl(crew) && tags(g).length === anzahl(crew), `Crew ${crew}: ${tags(g).length} Gegner (Soll ${anzahl(crew)}, aus den Daten)`);
      ok(funk.some((t) => /Hinterhalt im Sektor/.test(t) && t.includes(String(anzahl(crew)))), `Crew ${crew}: der Funk nennt ${anzahl(crew)} Schiffe`);
      if (crew === 1) {
        toteSzene(g); schritte(g, 2);
        ok(ged(f).filter((e) => e === 'hinterhalt_gelungen').length === 1 && nichtsStehen(g), 'Crew 1: gelungen, Gedaechtnis hinterhalt_gelungen einmal, nichts bleibt stehen');
      }
      if (crew === 3) {
        betritt(g, '0305'); schritte(g, 2);
        ok(ged(f).filter((e) => e === 'hinterhalt_gescheitert').length === 1 && !ged(f).includes('hinterhalt_gelungen') && nichtsStehen(g), 'Crew 3: Flucht, Gedaechtnis hinterhalt_gescheitert einmal, nichts bleibt stehen');
      }
    }
  }

  // =====================================================================================================================================================================
  console.log('\n2. Speichern und Laden');
  {
    const g = spiel(470, {}, 3);
    const f = startFaden(g, 'hht_frei', '0403');
    ok(weiter(g, f).ok && /^\d{4}$/.test(f.laufend.hex), `der Beat wartet an ${f.laufend && f.laufend.hex} (vom Code gewaehlt)`);
    const hexVorher = f.laufend.hex;
    const sav = JSON.parse(JSON.stringify(Faden.toSave(g.weltsim)));
    const sf = sav.liste.find((x) => x.id === f.id);
    ok(!!sf && sf.phase === 'laeuft' && (!sf.laufend || sf.laufend.hex === undefined) && !JSON.stringify(sav).includes('"hex":"' + hexVorher + '"'), 'der laufende Beat steht im Speicherstand, aber ohne Sektor');
    const rt = Faden.lesen(sav);
    const f2 = rt.liste.find((x) => x.id === f.id);
    ok(!!f2 && f2.phase === 'wartet' && !f2.laufend && f2.zaehler >= f2.abstand, 'nach dem Laden steht der Szenen-Beat wieder aus (faellig, ohne Sektor)');
    g.weltsim.faeden = rt;   // das geladene Spiel
    const funk = funkMit(g);
    ok(weiter(g, f2).ok && f2.phase === 'laeuft' && f2.laufend.hex === hexVorher, `der Beat waehlt den Sektor neu: ${f2.laufend && f2.laufend.hex} (wie vor dem Speichern, aus dem eigenen Strom)`);
    betritt(g, f2.laufend.hex); schritte(g, 0.2);
    ok(!!g.fadenSzene && g.fadenSzene.art === 'hinterhalt' && tags(g).length === anzahl(3), 'nach dem Laden loest die Ankunft wieder aus');
    ok(funk.some((t) => /Hinterhalt im Sektor/.test(t)), 'Funk bei der Ankunft nach dem Laden');
    // Speichern mitten im Kampf: kein Sektor, Beat steht nach dem Laden wieder aus
    const sav2 = JSON.parse(JSON.stringify(Faden.toSave(g.weltsim)));
    ok(!JSON.stringify(sav2).includes('"hex":"' + hexVorher + '"') && Faden.lesen(sav2).liste.find((x) => x.id === f.id).phase === 'wartet', 'mitten im Kampf gespeichert: kein Sektor im Stand, nach dem Laden steht der Beat aus');
  }

  // =====================================================================================================================================================================
  console.log('\n3. Datei-Beat mit parameter.hex');
  {
    ok(UNSPIELBAR.length > 0, `Testlage: ${UNSPIELBAR.length} unspielbare Sektoren (${UNSPIELBAR[0]})`);
    const r = registriere(vorlage('hht_unspielbar', [UNSPIELBAR[0]]));
    ok(!r.ok && r.fehler.some((e) => /hex/i.test(e)), `unspielbarer Sektor ${UNSPIELBAR[0]}: die Vorlagenpruefung lehnt ab (${(r.fehler || []).find((e) => /hex/i.test(e))})`);
    ok(!registriere(vorlage('hht_text', ['abcd'])).ok && !registriere(vorlage('hht_text2', ['305'])).ok, 'ein Hex-Text ohne vier Ziffern wird abgelehnt');
    // ausser Reichweite: erreichbar_max
    const g2 = spiel(481, {}, 3);
    const nah = B1.erreichbar(g2, hexNun(g2), HW.ziel.erreichbar_max);
    const fern = KARTE.filter((h) => P.sundSpielbar(h) && Sektoren.hatSzene(h) && !nah.has(h));
    ok(fern.length > 0, `Testlage: ${fern.length} spielbare Sektoren ausserhalb von erreichbar_max (${HW.ziel.erreichbar_max} Spruenge) ab ${hexNun(g2)}${fern.length ? ' (' + fern[0] + ')' : ''}`);
    if (fern.length) {
      registriereOk(vorlage('hht_fern', [fern[0]]));
      const f2 = startFaden(g2, 'hht_fern');
      ok(weiter(g2, f2).ok && f2.phase === 'wartet' && ged(f2).includes('hinterhalt_gescheitert') && nichtsStehen(g2) && HH.halt(g2, fern[0]) === null, `Sektor ${fern[0]} ausser Reichweite: der Beat scheitert sauber, kein Halt am Sektor`);
    }
    // am Rand der Reichweite: der Beat laeuft (erreichbar_max ist erlaubt)
    const g3 = spiel(482, {}, 3);
    const nah3 = Array.from(B1.erreichbar(g3, hexNun(g3), HW.ziel.erreichbar_max)).filter(([h, s]) => s === HW.ziel.erreichbar_max && P.sundSpielbar(h) && Sektoren.hatSzene(h)).map(([h]) => h).sort();
    if (nah3.length) {
      registriereOk(vorlage('hht_rand', [nah3[0]]));
      const f3 = startFaden(g3, 'hht_rand');
      ok(weiter(g3, f3).ok && f3.phase === 'laeuft' && f3.laufend.hex === nah3[0], `Sektor ${nah3[0]} genau ${HW.ziel.erreichbar_max} Spruenge entfernt: der Beat laeuft`);
    } else ok(true, `kein Sektor genau ${HW.ziel.erreichbar_max} Spruenge entfernt (uebersprungen)`);
    // der eigene Sektor: sofort
    const g4 = spiel(483, {}, 3);
    betritt(g4, '0304');
    const f4 = startFaden(g4, 'hht_0304');
    ok(weiter(g4, f4).ok && !!g4.fadenSzene && g4.fadenSzene.art === 'hinterhalt', 'der eigene Sektor: der Hinterhalt beginnt sofort');
  }

  // =====================================================================================================================================================================
  console.log('\n4. Beat ohne waehlbaren Sektor');
  {
    const g = spiel(490, {}, 3);
    let leer = null;
    for (const h of KARTE) { const o = Sektoren.ortVonHex(h); if (!o) continue; Space.enterScene(g, o, {}); ab(g); if (!HH.hexWaehlen(g, { id: 'f1' }, 's')) { leer = hexNun(g); break; } }
    ok(!!leer, `Testlage: ein Sektor ohne waehlbares Ziel (${leer})`);
    const f = startFaden(g, 'hht_frei');
    const eintraege0 = ((g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries) || []).length;
    const r = weiter(g, f);
    ok(r.ok && f.phase === 'wartet' && !f.laufend && ged(f).includes('hinterhalt_gescheitert') && !ged(f).includes('hinterhalt_gelungen'), `ohne waehlbaren Sektor scheitert der Beat sauber (Gedaechtnis hinterhalt_gescheitert, Phase ${f.phase})`);
    ok(nichtsStehen(g) && !(g.weltsim.faeden.liste.some((x) => x.laufend && x.laufend.hex)), 'nichts bleibt stehen: keine Szene, keine Gegner, kein Sektor');
    const log = (g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries) || [];
    ok(log.length > eintraege0 && log.some((e) => e.art === 'faden_baustein' && e.key === 'hinterhalt' && e.ausgang === 'abgelehnt'), 'das Logbuch der Regie nennt den Grund (faden_baustein hinterhalt abgelehnt)');
  }

  // =====================================================================================================================================================================
  console.log('\n5. Zwei Hinterhalte hintereinander');
  {
    const g = spiel(500, {}, 3);
    const f = startFaden(g, 'hht_zwei', '0403');
    ok(weiter(g, f).ok && f.laufend.hex === '0304', 'der erste Beat wartet an 0304');
    betritt(g, '0304'); schritte(g, 0.2);
    const fs1 = g.fadenSzene;
    ok(!!fs1 && tags(g).length === anzahl(3), `erster Hinterhalt: ${tags(g).length} Gegner`);
    toteSzene(g); schritte(g, 2);
    ok(ged(f).filter((e) => e === 'hinterhalt_gelungen').length === 1 && nichtsStehen(g) && f.beat === 1 && f.phase === 'wartet', 'erster gelungen, nichts bleibt stehen, der zweite Beat ist dran');
    faellig(f, 1);
    ok(weiter(g, f).ok && f.laufend.hex === '0505' && !g.fadenSzene, 'der zweite Beat wartet an 0505 (die Crew ist noch in 0304: keine neue Szene)');
    betritt(g, '0505'); schritte(g, 0.2);
    const fs2 = g.fadenSzene;
    ok(!!fs2 && fs2.id !== fs1.id && fs2.art === 'hinterhalt' && tags(g).length === anzahl(3) && tags(g).every((t) => t === fs2.tag), `zweiter Hinterhalt: eigene Szene (${fs2 && fs2.tag}), ${tags(g).length} Gegner, keine Reste des ersten`);
    betritt(g, '0405'); schritte(g, 2);
    ok(ged(f).includes('hinterhalt_gelungen') && ged(f).includes('hinterhalt_gescheitert') && nichtsStehen(g), 'zweiter gescheitert (Flucht): beide Ausgaenge stehen im Gedaechtnis, nichts bleibt stehen');
    ok(f.phase !== 'laeuft' || (f.laufend && f.laufend.hex === undefined), 'kein Sektor bleibt im Faden');
    // Schnellsprung durch 0505 haelt nur beim wartenden Beat: nach dem Ende haelt er dort nicht mehr
    betritt(g, '0305'); chance(g, 0);
    const hops = reiseVorbereiten(g, '0503');
    const oda = odaMit(g);
    Reise.befehl(g);
    for (let i = 0; i < 4.3 * hops.length * CONFIG.tickHz && g.reise; i++) g.step();
    ok(hops.includes('0505') && hexNun(g) === '0503' && !oda.some((m) => /Schnellsprung angehalten/.test(m)), `nach dem Ende haelt der Schnellsprung in 0505 nicht mehr an (Sektor ${hexNun(g)})`);
  }

  // =====================================================================================================================================================================
  console.log('\n6. Nie zwei Kaempfe uebereinander');
  {
    // a) Sim-Szene laeuft, wenn die Crew ankommt: der Hinterhalt wartet in der Schlange, dann beginnt er
    const g = spiel(510, {}, 3);
    const f = startFaden(g, 'hht_0304');
    weiter(g, f);
    betritt(g, '0304');
    g.simSzene = { id: 990, phase: 'kampf' };
    HH.update(g); SZ.update(g, DT);   // (ein Takt von Hand: die Sim-Szene ist ein Platzhalter, g.step wuerde sie als echte behandeln)
    ok(!g.fadenSzene && g.fadenWarte.length === 1 && tags(g).length === 0, 'Sim-Szene laeuft: der Hinterhalt wartet in der Schlange, keine Gegner');
    g.simSzene = null; SZ.update(g, DT); schritte(g, 0.3);
    ok(!!g.fadenSzene && g.fadenSzene.art === 'hinterhalt' && g.fadenWarte.length === 0 && tags(g).length === anzahl(3), 'Sim-Szene vorbei: der Hinterhalt beginnt, alle Gegner stehen');
    // b) Sim-Szene beginnt WAEHREND des Hinterhalts: unterbrochen, kein Ausgang, der Beat steht wieder aus
    g.simSzene = { id: 991, phase: 'kampf' };
    SZ.update(g, DT); g.simSzene = null;
    ok(g.errors === 0 && !g.fadenSzene && f.phase === 'wartet' && f.laufend === null && ged(f).length === 0 && g.space.enemies.every((e) => !/^fs\d+$/.test(e.tag || '')), 'unterbrochen: keine Szene, kein Ausgang, kein Gedaechtnis, die Gegner der Szene sind weg');
    // c) der Beat steht wieder aus: neu angeboten, die Crew ist im Sektor: sofort wieder da
    faellig(f, 0);
    ok(weiter(g, f).ok && !!g.fadenSzene && g.fadenSzene.art === 'hinterhalt' && tags(g).length === anzahl(3), 'neu angeboten: der Hinterhalt beginnt erneut (die Crew ist im Sektor)');
    toteSzene(g); schritte(g, 2);
    ok(ged(f).includes('hinterhalt_gelungen') && nichtsStehen(g), 'danach gelungen, nichts bleibt stehen');
  }
  {
    // d) Reise-Gefahr laeuft, wenn die Crew ankommt: erst die Raeuber der Reise-Gefahr, danach der Hinterhalt, nie beide zugleich
    const g = spiel(511, {}, 3);
    const f = startFaden(g, 'hht_0304');
    weiter(g, f);
    Space.enterScene(g, Sektoren.ortVonHex('0304'), {}); ab(g);
    const L = reiseGefahr(g);
    ok(!!L && RE.gefahrLaeuft(g), 'eine echte Reise-Gefahr laeuft (angekuendigt)');
    let beide = 0, reiseErst = -1, faErst = -1;
    for (let i = 0; i < 40 * CONFIG.tickHz; i++) {
      g.step();
      const r = g.space.enemies.filter((e) => e.tag === L.tag).length, s = g.space.enemies.filter((e) => /^fs\d+$/.test(e.tag || '')).length;
      if (r && s) beide++;
      if (r && reiseErst < 0) { reiseErst = i; for (const e of g.space.enemies.filter((x) => x.tag === L.tag)) Testhilfe.toeten(g, e); }
      if (s && faErst < 0) { faErst = i; toteSzene(g); }
    }
    ok(reiseErst >= 0 && faErst > reiseErst, `erst kaempfen die Raeuber der Reise-Gefahr, danach der Hinterhalt (Tick ${reiseErst}, dann ${faErst})`);
    ok(beide === 0, `nie Gegner beider Kaempfe zugleich im Raum (${beide} Ticks)`);
    ok(ged(f).includes('hinterhalt_gelungen'), 'der Hinterhalt endet danach gelungen');
  }
  {
    // e) der Hinterhalt kaempft schon, dann kommt eine Reise-Gefahr: sie wartet
    const g = spiel(512, {}, 3);
    const f = startFaden(g, 'hht_0304');
    weiter(g, f); betritt(g, '0304'); schritte(g, 0.3);
    const L = reiseGefahr(g);
    let reiseWaehrend = 0;
    for (let i = 0; i < 20 * CONFIG.tickHz; i++) { g.step(); if (g.space.enemies.some((e) => e.tag === L.tag)) reiseWaehrend++; }
    ok(reiseWaehrend === 0 && L.phase === 'erwartet' && !!g.fadenSzene, `der Hinterhalt kaempft: die Reise-Gefahr trifft nicht ein (${reiseWaehrend} Ticks mit Raeubern, Phase ${L.phase})`);
    toteSzene(g); schritte(g, 3);
    ok(g.space.enemies.some((e) => e.tag === L.tag) && !g.fadenSzene, 'nach dem Hinterhalt kommen die Raeuber der Reise-Gefahr');
  }

  // =====================================================================================================================================================================
  console.log('\n7. Andocken und Frist beenden den Beat gescheitert');
  {
    const g = spiel(520, {}, 3);
    const f = startFaden(g, 'hht_0304');
    weiter(g, f); betritt(g, '0304'); schritte(g, 0.3);
    ok(!!g.fadenSzene && tags(g).length === anzahl(3), 'der Hinterhalt kaempft');
    g.ship.docked = true; g.ship.dockedAt = 'test_station';
    schritte(g, 0.5);
    ok(ged(f).filter((e) => e === 'hinterhalt_gescheitert').length === 1 && !ged(f).includes('hinterhalt_gelungen') && !g.fadenSzene && g.space.enemies.length === 0, 'Andocken im Kampf: gescheitert, die Szene und ihre Gegner sind weg');
  }
  {
    const g = spiel(521, {}, 3);
    g.lageSpielleiter = stub();
    const f = startFaden(g, 'hht_0304');
    weiter(g, f);
    ok(f.phase === 'laeuft' && D.BEATS.hinterhalt.frist === 16, `der Beat wartet an ${f.laufend && f.laufend.hex}, Frist ${D.BEATS.hinterhalt.frist} Taetigkeiten`);
    X.grenzen(g, D.BEATS.hinterhalt.frist - 1, 'szene_ende');
    ok(f.phase === 'laeuft', 'eine Taetigkeit vor der Frist laeuft der Beat noch');
    X.grenzen(g, 2, 'szene_ende');
    ok(f.phase !== 'laeuft' && ged(f).filter((e) => e === 'hinterhalt_gescheitert').length === 1 && !(f.laufend && f.laufend.hex), 'Frist: gescheitert, der Sektor ist weg (nie angeflogen)');
    betritt(g, '0304'); schritte(g, 1);
    ok(!g.fadenSzene && g.space.enemies.length === 0 && HH.halt(g, '0304') === null, 'nach der Frist loest der Sektor nicht mehr aus, kein Halt');
  }
  {
    // Frist laeuft, waehrend die Szene kaempft: die Szene wird weggeraeumt
    const g = spiel(522, {}, 3);
    g.lageSpielleiter = stub();
    const f = startFaden(g, 'hht_0304');
    weiter(g, f); betritt(g, '0304'); schritte(g, 0.3);
    ok(!!g.fadenSzene && tags(g).length === anzahl(3), 'der Hinterhalt kaempft');
    X.grenzen(g, D.BEATS.hinterhalt.frist + 2, 'szene_ende'); schritte(g, 1);
    ok(ged(f).includes('hinterhalt_gescheitert') && nichtsStehen(g), 'Frist im Kampf: gescheitert, Szene und Gegner weggeraeumt');
  }

  // =====================================================================================================================================================================
  console.log('\n8. Funktext nennt den Ort');
  {
    ok(/\{ort\}/.test(T.vorwarnung.hinterhalt) && /\{n\}/.test(T.vorwarnung.hinterhalt) && /\{ort\}/.test(T.schnellsprung_hinterhalt), 'die Texte der Daten tragen die Platzhalter {ort} und {n}');
    for (const hex of ['0304', '0505']) {
      const g = spiel(530, {}, 3);
      const funk = funkMit(g), oda = odaMit(g);
      const f = startFaden(g, 'hht_' + hex);
      weiter(g, f);
      const name = Sektoren.hexName(hex);
      if (hex === '0505') {
        const hops = reiseVorbereiten(g, '0503');
        Reise.befehl(g);
        for (let i = 0; i < 4.3 * hops.length * CONFIG.tickHz && g.reise; i++) g.step();
        ok(oda.some((m) => /Schnellsprung angehalten/.test(m) && m.includes(name)), `Halt-Meldung nennt den Ort (${name})`);
      } else betritt(g, hex);
      schritte(g, 0.3);
      ok(funk.some((t) => /Hinterhalt im Sektor/.test(t) && t.includes(name) && !/\{\w+\}/.test(t)), `Funk nennt den Ort ${name}, kein Platzhalter bleibt stehen`);
    }
  }

  // =====================================================================================================================================================================
  console.log('\n9. Daten-Grep: nichts aus werte.hinterhalt im Servercode');
  {
    const dateien = [];
    const gehe = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) gehe(p); else if (/\.js$/.test(e.name)) dateien.push(p); } };
    gehe(path.join(__dirname, '..', 'server'));
    const quellen = dateien.map((p) => [path.relative(path.join(__dirname, '..'), p), fs.readFileSync(p, 'utf8')]);
    const literale = [HW.salz, T.vorwarnung.hinterhalt, T.gelungen.hinterhalt, T.gescheitert.hinterhalt, T.schnellsprung_hinterhalt];
    ok(literale.every((l) => typeof l === 'string' && l.length > 8), `Pruefstuecke: Salz und vier Texte (${literale.length})`);
    for (const l of literale) {
      const treffer = quellen.filter(([, q]) => q.includes(l)).map(([p]) => p);
      ok(treffer.length === 0, `kein Literal im Servercode: "${l.slice(0, 40)}"${treffer.length ? ' steht in ' + treffer.join(', ') : ''}`);
    }
    // die Zahl der Gegner je Crewgroesse kommt aus der Tabelle der Daten: keine Kopie der Tabelle im Servercode (weder als Objekt noch als Liste)
    const tabelle = quellen.filter(([, q]) => /hinterhalt/.test(q) && (/\{\s*['"]?1['"]?\s*:\s*\d+\s*,\s*['"]?2['"]?\s*:\s*\d+\s*,\s*['"]?3['"]?\s*:\s*\d+\s*\}/.test(q.replace(/\/\/.*$/gm, '')))).map(([p]) => p);
    ok(tabelle.length === 0, `keine Kopie der Tabelle anzahl in einer Datei, die den Hinterhalt kennt${tabelle.length ? ' (' + tabelle.join(', ') + ')' : ''}`);
  }

  // =====================================================================================================================================================================
  console.log('\n10. Zufallsstrom ohne laufenden Hinterhalt bitgleich');
  {
    const lauf = (modus, p) => {
      const g = X.F.neuesSpiel({ crew: 3, seed: 451, names: NAMEN, env: modus === 'aus' ? { REISE_EREIGNISSE: 'off' } : { FAEDEN: '1', REISE_EREIGNISSE: 'off' } }).g; ab(g);
      for (const h of alleHexe) g.explore.erkunde(h);
      chance(g, p);
      if (modus === 'wartet' || modus === 'anderswo') {
        const f = startFaden(g, modus === 'wartet' ? 'hht_0505' : 'hht_0304');
        if (modus === 'anderswo') { weiter(g, f); }   // laeuft, wartet aber an 0304: nicht auf der Route 0405 > 0505 > 0504 > 0503
        else f.zaehler = 0;   // waehlt nie: bleibt wartend
      }
      const log = rngLog(g);
      reiseVorbereiten(g, '0503');
      const vor = log.length;
      Reise.befehl(g);
      for (let i = 0; i < 4.3 * 4 * CONFIG.tickHz + CONFIG.tickHz; i++) g.step();
      return { zuege: log.slice(vor), hex: hexNun(g), jaeger: tags(g).filter((t) => t === 'abfang').length };
    };
    for (const p of [0, 1]) {
      const a = lauf('aus', p);
      for (const m of ['wartet', 'anderswo']) {
        const b = lauf(m, p);
        ok(a.zuege.length > 0 && a.zuege.join() === b.zuege.join() && a.hex === b.hex && a.jaeger === b.jaeger, `chance ${p}, Faden ${m === 'wartet' ? 'wartet (Beat nicht gestartet)' : 'lauert an einem anderen Sektor'}: ${b.zuege.length} Zuege wie ohne Faden (${a.zuege.length}), Sektor ${b.hex}, Jaeger ${b.jaeger}`);
      }
    }
  }

  console.log(`\n${n - fails}/${n} Pruefungen ok`);
  if (fails) { console.log(`${fails} FEHLER`); process.exit(1); }
  console.log('FADEN-HINTERHALT OK');
}
try { main(); process.exit(0); } catch (e) { console.log('ABSTURZ ' + (e && e.stack)); process.exit(1); }
