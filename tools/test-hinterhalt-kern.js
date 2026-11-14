'use strict';
// BEA-03 A: Kern des Beats hinterhalt (server/sim/faden-hinterhalt.js, Art hinterhalt in faden-szene.js, Halt in reise.js hop). In-process, ohne Server.
// Belegt: Schnellsprung haelt im Sektor; Einzelsprung loest aus; ein anderer Sektor nicht; im Hop mit Hinterhalt kein Zufalls-Abfangen (kein Zug von game.rng.chance, keine Jaeger mit Tag abfang);
// gelungen und gescheitert je einmal (Faden, Gedaechtnis, nichts bleibt stehen); Funk und Gegner sofort (kein Vorlauf); andere Arten behalten ihren Vorlauf; die Befreiung hat keinen Doppelkampf mehr;
// ohne Faden bleibt der Zufallsstrom von game.rng gleich (mit und ohne FAEDEN=1); der Sektor steht im laufenden Beat, nie im Ort der Geschichte und nie im Speicherstand; keine Daten-Literale im Servercode.
//   node tools/test-hinterhalt-kern.js        (npm run test:hinterhalt-kern)
const fs = require('fs');
const path = require('path');
const V = require('./test-faden-vorlagen.js');
const X = require('./faden-fixture.js');
const Sektoren = require('../shared/sektoren.js');
const Space = require('../server/sim/space.js');
const Sprung = require('../server/sim/sprung.js');
const Reise = require('../server/sim/reise.js');
const Faden = require('../server/sim/faden.js');
const SZ = require('../server/sim/faden-szene.js');
const HH = require('../server/sim/faden-hinterhalt.js');
const Testhilfe = require('./gegner-testhilfe.js');
const { D } = X;

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const lies = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));
const SZD = lies('content/faeden/szenen-werte.json');
const HW = SZD.werte.hinterhalt.wert;
const NAMEN = ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'];
const ab = (g) => { const s = g.ship; s.docked = false; s.dockedAt = null; s.helm.stage = 1; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; };
const betritt = (g, hex) => { Space.enterScene(g, Sektoren.ortVonHex(hex), {}); ab(g); };
const hexNun = (g) => Sektoren.hexVonOrt(g.ship.scene);
const schritte = (g, sek) => { for (let i = 0; i < Math.round(sek * 30); i++) g.step(); };
const faellig = (f, i) => { f.beat = i; f.phase = 'wartet'; f.laufend = null; f.zaehler = f.abstand; };
const weiter = (g, f) => Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: D.vorlage(f.vorlage).beats[f.beat].id });
const funkMit = (g) => { const out = []; const o = g.emit.bind(g); g.emit = (...a) => { if (a[0] === 'radio' && a[1]) out.push(String(a[1].text)); return o(...a); }; return out; };
const odaMit = (g) => { const out = []; const o = g.oda.bind(g); g.oda = (t, k) => { out.push(String(t)); return o(t, k); }; return out; };
const tags = (g) => g.space.enemies.map((e) => e.tag);
const alleHexe = Object.keys(lies('content/welt/sund_frei.json').hexe);

// Testvorlage: ein Hinterhalt, danach der Abschluss (Datei-Beat mit oder ohne parameter.hex)
const vorlage = (id, hex) => ({
  format: 'faden-vorlage/1', id, titel: 'Hinterhalt (Test)',
  ausloeser: [{ art: 'notruf', ausgang: 'gelungen' }], volk_erlaubt: ['rom', 'kon'],
  nsc: { status: 'aktiv', haltung: 2, klassen: ['frachter', 'kurier'] }, hinweise: {},
  beats: [
    Object.assign({ id: 'h_hinterhalt', typ: 'hinterhalt' }, hex ? { parameter: { hex } } : {}, {
      aus: { gelungen: { status: 'aktiv', weiter: 'h_abschluss', folge: [] }, gescheitert: { status: 'geflohen', weiter: 'h_abschluss', folge: [] } },
    }),
    { id: 'h_abschluss', typ: 'abschluss', erfolg: { ereignis: ['hinterhalt_gelungen'] }, aus: { gelungen: { folge: [] }, gescheitert: { folge: [] } } },
  ],
});
const registriere = (v) => { const r = D.registriere(v); if (!r.ok) throw new Error('Vorlage ' + v.id + ' ungueltig: ' + r.fehler.join('; ')); };

// Spiel: Crew 3 am Start (0305), alle Sektoren erkundet, keine Reise-Ereignisse, Zufalls-Abfangen aus (chance(g, p) schaltet es ein)
function spiel(seed, env, crew) {
  const g = X.F.neuesSpiel({ crew: crew || 3, seed, names: NAMEN.slice(0, crew || 3), env: Object.assign({ FAEDEN: '1', REISE_EREIGNISSE: 'off' }, env || {}) }).g; ab(g);
  for (const h of alleHexe) g.explore.erkunde(h);
  chance(g, 0);
  return g;
}
const chance = (g, p) => { g.C.reise.neutralChance = p; g.C.reise.neutralPlus = 0; g.C.reise.neutralMax = p; g.C.reise.feindChance = p; };
// Faden mit dem Beat an Stelle 0 oeffnen und starten (vorlageId, ggf. Ort der Geschichte)
function startFaden(g, vorlageId, notrufHex) {
  const a = V.notrufOhneOrt(g, 'notruf_pirat_haendler', notrufHex || '0403', 'gelungen');
  const r = Faden.befehlAnwenden(g, { typ: 'faden_oeffnen', vorlage: vorlageId, parameter: { angebot: a.nr } });
  if (!r.ok) throw new Error('Faden ' + vorlageId + ' nicht geoeffnet: ' + r.grund);
  const f = r.faden; faellig(f, 0);
  return f;
}
// Schnellsprung vorbereiten: Ziel waehlen, vor den Sprungpunkt fliegen, Sprungantrieb laden
function reiseVorbereiten(g, ziel) {
  Sprung.selectDest(g, Sektoren.ortVonHex(ziel));
  const p = Sprung.sprungpunkt(g, g.reisePlan.hops[0]); g.ship.x = p.x - 80; g.ship.y = p.y;
  for (let i = 0; i < 40 * 30 && !g.ship.jump.ready; i++) g.step();
  return g.reisePlan.hops.slice();
}
// Zuege von game.rng mitschreiben
function rngLog(g) {
  const log = [];
  for (const m of Object.keys(g.rng)) if (typeof g.rng[m] === 'function') { const o = g.rng[m].bind(g.rng); g.rng[m] = (...a) => { const v = o(...a); log.push(m + ':' + (typeof v === 'number' ? v.toFixed(4) : v)); return v; }; }
  return log;
}

registriere(vorlage('hh_test_0505', '0505'));
registriere(vorlage('hh_test_0705', '0705'));
registriere(vorlage('hh_test_frei', null));

function main() {
  // =====================================================================================================================================================================
  console.log('\n1. Daten: Art, Katalog, Vorlauf nur fuer hinterhalt');
  {
    ok(SZ.ARTEN.includes('hinterhalt') && D.BEATS.hinterhalt && D.BEATS.hinterhalt.baustein === 'hinterhalt' && D.BEATS.hinterhalt.szene === true && D.BEATS.hinterhalt.gefahr === true, 'Art in ARTEN, Beat im Katalog (baustein hinterhalt, szene, gefahr)');
    ok(D.BEATS.hinterhalt.frist === 16 && !D.BEATS.hinterhalt.verlegt_ort, 'frist 16 (Taetigkeiten), kein verlegt_ort (der Ort der Geschichte bleibt)');
    ok(require('../server/sim/faden-bausteine.js').vonId('hinterhalt') === HH.baustein, 'der echte Baustein ist registriert (nicht der Platzhalter)');
    const mitVorlauf = Object.entries(SZD.werte).filter(([, v]) => v && v.wert && typeof v.wert === 'object' && !Array.isArray(v.wert) && v.wert.vorlauf_s !== undefined).map(([k]) => k);
    ok(mitVorlauf.join() === 'hinterhalt' && HW.vorlauf_s === 0, 'nur die Art hinterhalt nennt einen eigenen vorlauf_s (' + mitVorlauf.join() + ': ' + HW.vorlauf_s + ')');
    ok(SZD.werte.vorlauf_min_s.wert > 0 && SZD.werte.vorlauf_s.wert >= SZD.werte.vorlauf_min_s.wert, 'die Untergrenze vorlauf_min_s und der Standard vorlauf_s bleiben fuer alle anderen Arten');
    ok(typeof SZD.texte.vorwarnung.hinterhalt === 'string' && typeof SZD.texte.gelungen.hinterhalt === 'string' && typeof SZD.texte.gescheitert.hinterhalt === 'string' && typeof SZD.texte.schnellsprung_hinterhalt === 'string', 'Texte (Vorwarnung, gelungen, gescheitert, Halt) stehen in den Daten');
  }

  // =====================================================================================================================================================================
  console.log('\n2. Schnellsprung haelt im Sektor, kein Zufalls-Abfangen im Hop, Gegner und Funk sofort');
  {
    const g = spiel(451);
    const f = startFaden(g, 'hh_test_0505', '0403');
    const ortVorher = f.parameter.ort;
    const oda = odaMit(g), funk = funkMit(g);
    ok(weiter(g, f).ok && f.phase === 'laeuft' && f.laufend.hex === '0505', 'der Beat laeuft und merkt den Sektor 0505 im laufenden Beat');
    ok(f.parameter.ort === ortVorher && f.parameter.ort !== '0505', 'der Ort der Geschichte bleibt (' + f.parameter.ort + ')');
    ok(!g.fadenSzene && !(g.fadenWarte || []).length && hexNun(g) !== '0505', 'die Crew ist nicht im Sektor: keine Szene, nichts eingeplant');
    const hops = reiseVorbereiten(g, '0503');
    ok(hops.join() === '0405,0505,0504,0503', 'Testlage: die Route fuehrt ueber 0505 (' + hops.join() + ')');
    ok(Reise.befehl(g) === null && !!g.reise, 'der Schnellsprung startet');
    // der Zufalls-Ueberfall ist ab dem naechsten Hop ZUVERLAESSIG (p = 1): kaeme der Hinterhalt-Hop in abfangen(), waeren Jaeger mit Tag abfang da
    for (let i = 0; i < 4.3 * 4 * 30 && g.reise; i++) {
      if (hexNun(g) === '0405') chance(g, 1);
      g.step();
    }
    ok(hexNun(g) === '0505' && !g.reise, `der Schnellsprung haelt im Hinterhalt-Sektor (Sektor ${hexNun(g)}, Reise ${!!g.reise})`);
    ok(oda.some((m) => /Schnellsprung angehalten/.test(m) && /Hinterhalt/.test(m) && m.includes(Sektoren.hexName('0505'))), 'die Meldung nennt den Hinterhalt und den Sektor');
    ok(g.reisePlan && g.reisePlan.hops.join() === '0504,0503', 'die Rest-Route bleibt gewaehlt');
    ok(!tags(g).includes('abfang') && !oda.some((m) => /Abgefangen/.test(m)), 'im Hop mit Hinterhalt kein Zufalls-Abfangen (keine Jaeger mit Tag abfang, keine Meldung Abgefangen)');
    // Szene sofort: im Takt der Ankunft stehen Meldung und Gegner (kein Vorlauf)
    schritte(g, 0.2);
    const fs = g.fadenSzene;
    ok(!!fs && fs.art === 'hinterhalt' && fs.phase === 'kampf' && fs.sek === 0, `die Szene steht sofort im Kampf (phase ${fs && fs.phase}, Vorlauf ${fs && fs.sek} s)`);
    const erwartet = Number(HW.anzahl['3']);
    ok(tags(g).filter((t) => t === fs.tag).length === erwartet && tags(g).every((t) => t === fs.tag), `Gegner sofort: ${erwartet} (Crew 3, aus den Daten), alle mit dem Tag der Szene (${tags(g).join(',')})`);
    ok(funk.some((t) => /Hinterhalt im Sektor/.test(t) && t.includes(Sektoren.hexName('0505')) && t.includes(String(erwartet))), `die Funkmeldung kommt bei der Ankunft („${funk.find((t) => /Hinterhalt/.test(t))}“)`);
    // gelungen: alle Gegner mit dem Tag weg
    for (const e of g.space.enemies.filter((x) => x.tag === fs.tag)) Testhilfe.toeten(g, e);
    schritte(g, 2);
    ok(f.nsc.gedaechtnis.some((x) => x.ereignis === 'hinterhalt_gelungen') && !f.nsc.gedaechtnis.some((x) => x.ereignis === 'hinterhalt_gescheitert'), 'gelungen: genau einmal, das Gedaechtnis schreibt hinterhalt_gelungen');
    ok(f.laufend === null || f.laufend.hex === undefined, 'der Sektor ist mit dem Beat weg (laufend.hex)');
    ok(!g.fadenSzene && !(g.fadenWarte || []).length && g.space.enemies.length === 0, 'nichts bleibt stehen: keine Szene, keine Warteschlange, keine Gegner');
    ok(f.nsc.gedaechtnis.filter((x) => x.ereignis === 'hinterhalt_gelungen').length === 1, 'das Gedaechtnis hat den Eintrag nur einmal');
  }

  // =====================================================================================================================================================================
  console.log('\n3. Einzelsprung loest aus, ein anderer Sektor nicht, Flucht scheitert');
  {
    const g = spiel(452);
    const f = startFaden(g, 'hh_test_0705', '0403');
    const funk = funkMit(g);
    ok(weiter(g, f).ok && f.laufend.hex === '0705', 'der Beat wartet an 0705');
    betritt(g, '0204');   // ein anderer Sektor (wie ein Einzelsprung dorthin)
    schritte(g, 3);
    ok(!g.fadenSzene && !(g.fadenWarte || []).length && tags(g).length === 0 && f.phase === 'laeuft' && f.laufend.hex === '0705', 'ein anderer Sektor loest nicht aus (Beat laeuft, keine Szene)');
    betritt(g, '0705');   // Einzelsprung in den Hinterhalt-Sektor
    schritte(g, 0.1);
    ok(g.fadenSzene && g.fadenSzene.art === 'hinterhalt' && g.fadenSzene.phase === 'kampf' && tags(g).length === Number(HW.anzahl['3']), `der Einzelsprung loest aus: Szene und ${tags(g).length} Gegner im selben Takt`);
    ok(funk.some((t) => /Hinterhalt im Sektor/.test(t)), 'Funk bei der Ankunft');
    betritt(g, '0305');   // Flucht (Szenenwechsel, wie ein Sprung oder Notsprung)
    schritte(g, 2);
    ok(f.nsc.gedaechtnis.some((x) => x.ereignis === 'hinterhalt_gescheitert') && !f.nsc.gedaechtnis.some((x) => x.ereignis === 'hinterhalt_gelungen'), 'gescheitert (Flucht): genau einmal, das Gedaechtnis schreibt hinterhalt_gescheitert');
    ok(!g.fadenSzene && !(g.fadenWarte || []).length && tags(g).length === 0, 'nichts bleibt stehen: keine Szene, keine Gegner');
    ok(f.nsc.status === 'geflohen' || f.nsc.status === 'aktiv', 'der NSC ist nur das Gesicht: kein Anfuehrerschiff, Status ' + f.nsc.status);
  }

  // =====================================================================================================================================================================
  console.log('\n4. Die Crew ist beim Start schon im Sektor: die Szene beginnt sofort');
  {
    const g = spiel(453, { REISE_EREIGNISSE: '1' });
    const R = require('../server/sim/reise-ereignis.js');
    ok(R.aktiv(g) && R.abstandFrei(g) === true, 'Testlage: Reise-Ereignisse an, der Abstand ist frei');
    const f = startFaden(g, 'hh_test_0705', '0403');
    betritt(g, '0705');
    funkMit(g);
    ok(weiter(g, f).ok, 'der Beat beginnt');
    ok(g.fadenSzene && g.fadenSzene.art === 'hinterhalt' && g.fadenSzene.phase === 'kampf' && tags(g).length > 0, 'die Crew war schon dort: Szene und Gegner stehen sofort');
    ok(R.abstandFrei(g) === false, 'der Hinterhalt zaehlt fuer den Abstand der Reise-Ereignisse (abstandFrei falsch)');
  }

  // =====================================================================================================================================================================
  console.log('\n5. Der Code waehlt den Sektor (Plan und Brett): 1 bis 3 Sprunge, nie der eigene, nie Hafen oder Station');
  {
    const g = spiel(454);
    const f = startFaden(g, 'hh_test_frei', '0403');
    const a = HH.hexWaehlen(g, f, 'x'), b = HH.hexWaehlen(g, f, 'x'), c = HH.hexWaehlen(g, f, 'y');
    const B1 = require('../server/sim/faden-b1.js');
    const dist = B1.erreichbar(g, hexNun(g), HW.ziel.max);
    ok(!!a && a === b, 'deterministisch fuer gleiches Salz (' + a + ')');
    ok(/^\d{4}$/.test(c), 'anderes Salz gibt ebenfalls einen Sektor (' + c + ')');
    let alle = true, hafen = false;
    for (const s of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const h = HH.hexWaehlen(g, f, s);
      if (!h || h === hexNun(g) || dist.get(h) < HW.ziel.min || dist.get(h) > HW.ziel.max) alle = false;
      const d = Sektoren.hexDaten(h); if (d && d.hafen) hafen = true;
    }
    ok(alle && !hafen, 'jede Wahl liegt min bis max Spruenge entfernt, nie der eigene Sektor, nie ein Hafen');
    const ort = f.parameter.ort;
    ok(weiter(g, f).ok && /^\d{4}$/.test(f.laufend.hex) && f.laufend.hex !== hexNun(g) && f.parameter.ort === ort, `der Beat ohne parameter.hex bekommt vom Code ${f.laufend.hex}; der Ort der Geschichte bleibt`);
    const sav = Faden.toSave(g.weltsim);
    ok(sav && sav.liste.every((x) => !x.laufend || x.laufend.hex === undefined), 'der Sektor steht nicht im Speicherstand (Laufzeit)');
    const rt = Faden.lesen(JSON.parse(JSON.stringify(sav)));
    const f2 = rt && rt.liste.find((x) => x.id === f.id);
    ok(!!f2 && f2.phase === 'wartet' && !f2.laufend, 'nach dem Laden steht der Szenen-Beat wieder aus (der Sektor wird neu gewaehlt)');
  }

  // =====================================================================================================================================================================
  console.log('\n6. Andere Arten behalten den Vorlauf; die Befreiung hat keinen Doppelkampf mehr');
  {
    const g = spiel(455);
    chance(g, 0);
    const a = V.notrufOhneOrt(g, 'notruf_pirat_haendler', '0505', 'gelungen');
    const r = Faden.befehlAnwenden(g, { typ: 'faden_oeffnen', vorlage: 'entfuehrter_haendler', parameter: { angebot: a.nr } });
    const f = r.faden; faellig(f, 1); f.nsc.status = 'gefangen';
    const oda = odaMit(g);
    ok(weiter(g, f).ok && f.laufend.beat === 'b_befreiung', 'der Beat Befreiung wartet am Ort 0505');
    const hops = reiseVorbereiten(g, '0503');
    ok(hops.join() === '0405,0505,0504,0503', 'Testlage: die Route fuehrt ueber 0505');
    ok(Reise.befehl(g) === null && !!g.reise, 'der Schnellsprung startet');
    for (let i = 0; i < 4.3 * 4 * 30 && g.reise; i++) { if (hexNun(g) === '0405') chance(g, 1); g.step(); }   // ab dem naechsten Hop ist das Zufalls-Abfangen sicher
    ok(hexNun(g) === '0505' && !g.reise && oda.some((m) => /Schnellsprung angehalten/.test(m)), 'der Schnellsprung haelt am Ort der Befreiung');
    ok(!tags(g).includes('abfang') && !oda.some((m) => /Abgefangen/.test(m)), 'kein Zufalls-Abfangen im Hop mit Befreiung');
    schritte(g, 0.2);
    const fs = g.fadenSzene;
    ok(!!fs && fs.art === 'befreiung' && fs.phase === 'vorlauf' && fs.sek === Math.max(SZD.werte.vorlauf_min_s.wert, SZD.werte.vorlauf_s.wert), `die Befreiung behaelt ihren Vorlauf (${fs && fs.sek} s)`);
    schritte(g, SZD.werte.vorlauf_s.wert + 1);
    ok(g.fadenSzene && g.fadenSzene.phase === 'kampf' && tags(g).length > 0 && tags(g).every((t) => t === g.fadenSzene.tag), `kein Doppelkampf: nur die Wachschiffe der Szene (${tags(g).join(',')}), keine Zufalls-Jaeger`);
  }

  // =====================================================================================================================================================================
  console.log('\n7. Ohne Faden bleibt der Zufallsstrom von game.rng gleich (mit und ohne FAEDEN=1)');
  {
    const lauf = (faeden, p) => {
      const g = X.F.neuesSpiel({ crew: 3, seed: 451, names: NAMEN, env: faeden ? { FAEDEN: '1', REISE_EREIGNISSE: 'off' } : { REISE_EREIGNISSE: 'off' } }).g; ab(g);
      for (const h of alleHexe) g.explore.erkunde(h);
      chance(g, p);
      const log = rngLog(g);
      reiseVorbereiten(g, '0503');
      const vor = log.length;
      Reise.befehl(g);
      for (let i = 0; i < 4.3 * 4 * 30 + 30; i++) g.step();
      return { zuege: log.slice(vor), hex: hexNun(g), jaeger: tags(g).filter((t) => t === 'abfang').length };
    };
    for (const p of [0, 1]) {
      const a = lauf(false, p), b = lauf(true, p);
      ok(a.zuege.length > 0 && a.zuege.join() === b.zuege.join() && a.hex === b.hex && a.jaeger === b.jaeger, `chance ${p}: ${a.zuege.length} gegen ${b.zuege.length} Zuege, Wert fuer Wert gleich, Sektor ${a.hex} gegen ${b.hex}, Jaeger ${a.jaeger} gegen ${b.jaeger}`);
    }
  }

  // =====================================================================================================================================================================
  console.log('\n8. Keine Daten-Literale im Servercode');
  {
    const quelle = fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'faden-hinterhalt.js'), 'utf8');
    const code = quelle.replace(/\/\/.*$/gm, '').replace(/\/\^\\d\{4\}\$\//g, '');   // ohne Kommentare und ohne das Hex-Muster (die 4 darin ist keine Zahl der Daten)
    const lit = [HW.klasse, HW.volk, HW.salz].filter((x) => typeof x === 'string');
    const zahlen = [HW.ring, HW.ziel.min, HW.ziel.max, HW.ziel.erreichbar_max, ...Object.values(HW.anzahl)].filter((v) => v !== 0 && v !== 1);
    ok(lit.every((s) => !new RegExp("['\"]" + s + "['\"]").test(code)), 'faden-hinterhalt.js: Klasse, Volk und Salz stehen nur in den Daten');
    ok(zahlen.every((z) => !new RegExp('(^|[^\\w.])' + z + '([^\\w.]|$)').test(code)), 'faden-hinterhalt.js: keine Zahl der Daten (' + zahlen.join(',') + ')');
    const sz = fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'faden-szene.js'), 'utf8');
    ok(!/it\.art === 'raumschlacht' \|\| it\.art === 'befreiung'/.test(sz), 'faden-szene.js: die Zahl und Klasse haengen an den Daten (anzahl), nicht an zwei festen Artnamen');
  }

  console.log(`\n${n - fails}/${n} Pruefungen ok`);
  if (fails) { console.log(`${fails} FEHLER`); process.exit(1); }
  console.log('HINTERHALT-KERN OK');
}
try { main(); process.exit(0); } catch (e) { console.log('ABSTURZ ' + (e && e.stack)); process.exit(1); }
