'use strict';
// BEA-02 B: Beat rettung (server/sim/faden-rettung.js, Daten content/faeden/rettung-werte.json und rettung-texte.json, Katalog beats.json). Die Erwartungen stehen hier selbst (Daten gelesen, nie aus dem Produktivcode abgeleitet).
//   (a) Katalog, Daten, Baustein, Pflicht landeplatz (Plan, Vorlage), Katalogzeile hoechstens 400 Zeichen
//   (b) Ohne landung an einem Wrack (Art schiff): 1, 2, 3 Ueberlebende, Namen aus der Namensliste ohne Doppelte, Funk, Ids deterministisch
//   (c) Ops-Beamen (Waffen-Konsole besetzt) legt sie als person in die Betten 0 bis 2; ende an_bord gelungen erst bei der letzten; Doppelereignis, fremde Personen
//   (d) ende abgegeben an einer Station: gelungen erst bei der letzten Abgabe, Nebenfiguren weg, Faden-NSC mit Gedaechtnis rettung_gelungen, ein Wiedersehen greift ihn auf
//   (e) Belegter Frachtraum (Erz im einzigen Modul): Hinweis, nichts geraeumt, Beat wartet, scheitert an der Frist
//   (f) Scheitern: Frist, Notsprung, Notrueckholung (alle downed, recall), Faden-Ende, keine Ueberlebende mehr; der Ort ist restlos abgeraeumt
//   (g) Speichern und Laden (Weltstand): Personen im Lager erhalten Namen und Betten, der Beat laeuft weiter; Karte verdraengt und neu gebaut: die Ueberlebenden sind wieder da
//   (h) Besetzung folgt besetzung (wie bei landung)
//   (i) Gegenprobe: ohne FAEDEN=1 und ohne laufenden rettung-Beat nichts anders
//   (j) Daten: datenFehler leer; Grep-Test: keine Zahl und kein Name aus den Datendateien im Servercode
// Aufruf: node tools/test-faden-rettung.js [begriff ...]        (npm run test:faden-rettung)
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const F = require('./regie-fixture.js');
const CONFIG = require('../shared/config.js');
const Sektoren = require('../shared/sektoren.js');
const space = require('../server/sim/space.js');
const away = require('../server/sim/away.js');
const interior = require('../server/sim/interior.js');
const Lpscan = require('../server/sim/lpscan.js');
const LP = require('../server/sim/landepunkte.js');
const Faden = require('../server/sim/faden.js');
const FD = require('../server/sim/faden-daten.js');
const AO = require('../server/sim/abenteuer-orte.js');
const Bauplan = require('../server/sim/faden-bauplan.js');
const Pruefer = require('../server/sim/faden-pruefer.js');
const Bausteine = require('../server/sim/faden-bausteine.js');
const Rettung = require('../server/sim/faden-rettung.js');
const Boden = require('../server/sim/faden-boden.js');
const Kanon = require('../server/sim/abenteuer-kanon.js');
const Prompt = require('../server/sim/abenteuer-prompt.js');
const AM = require('../server/sim/abenteuer-mock.js');
const Fracht = require('../server/sim/fracht.js');
const PB = require('../server/sim/personen-bord.js');
const Weltstand = require('../server/weltstand.js');
const W = require('../server/world.js');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
async function section(name, fn) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n' + name);
  try { await fn(); } catch (e) { fails++; n++; console.log('  ABSTURZ Ausnahme: ' + (e && e.stack)); }
}
const lies = (...p) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));
const klon = (x) => JSON.parse(JSON.stringify(x));
const BEATS = lies('content', 'faeden', 'beats.json').beats;
const WERTE = lies('content', 'faeden', 'rettung-werte.json').werte;
const TEXTE = lies('content', 'faeden', 'rettung-texte.json').texte;
const BODEN = lies('content', 'faeden', 'boden-werte.json').werte;
const NAMEN = lies('content', 'faeden', 'namen.json').voelker;
const B1 = lies('content', 'faeden', 'b1-texte.json');
const KAT = require('../server/mission/katalog.js').load().fraktionen;
const trupps = (aw) => Object.keys((aw && aw.squads) || {}).length;

// ---------------------------------------------------------------- Hilfen
const ENV = { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', REISE_EREIGNISSE: '1' };
const tick = (k) => new Promise((r) => { let i = 0; const s = () => (++i >= (k || 3) ? r() : setImmediate(s)); setImmediate(s); });
function spiel(o) {
  o = o || {};
  const T = F.neuesSpiel({ crew: o.crew || 1, seed: o.seed || 7, env: o.env || ENV });
  const g = T.g;
  T.run = (sek) => { for (let k = 0; k < Math.round(sek * CONFIG.tickHz); k++) g.step(); };
  T.fehler = [];
  const ce = g.countError.bind(g);
  g.countError = (wo, e) => { T.fehler.push(wo + ': ' + (e && e.message)); return ce(wo, e); };
  T.radio = [];
  const em = g.emit.bind(g);
  g.emit = (e, d) => { if (e === 'radio' && d && d.text) T.radio.push({ von: d.from, text: d.text }); return em(e, d); };
  T.oda = [];
  const od = g.oda.bind(g);
  g.oda = (t, x) => { T.oda.push(String(t)); return od(t, x); };
  T.ev = [];
  const me = g.missionEvent.bind(g);
  g.missionEvent = (name, data) => { T.ev.push(name); return me(name, data); };
  T.p = g.players[0];
  return T;
}
const plan = (art, parameter, extra) => Object.assign({
  format: 'faden-bauplan/1', titel: 'Schiffbruch im Sektor', anlass: 'Ein Schiff ist gestrandet und Menschen warten auf Hilfe.',
  landeplaetze: [{ id: 'absturz', art, besitz: 'herrenlos', name: 'Absturzstelle' }],
  beats: [{ typ: 'rettung', parameter: Object.assign({ landeplatz: 'absturz' }, parameter || {}), verzweigung: { gescheitert: 'ende' } }, { id: 'ende', typ: 'abschluss' }],
}, extra || {});
const planLandung = (art, besetzung) => ({
  format: 'faden-bauplan/1', titel: 'Absturz im Sektor', anlass: 'Ein Schiff ist abgestuerzt und niemand weiss warum.',
  landeplaetze: [{ id: 'absturz', art, besitz: 'herrenlos', name: 'Absturzstelle' }],
  beats: [{ typ: 'landung', parameter: { landeplatz: 'absturz', besetzung }, verzweigung: { gescheitert: 'ende' } }, { id: 'ende', typ: 'abschluss' }],
});
const grenzen = (g, k) => { for (let i = 0; i < k; i++) g.lageGrenze('andocken'); };
function oeffnen(g, hex, p) {
  Faden.zustandVon(g).abenteuerAngebote = [];
  const a = Faden.abenteuerAnbieten(g, p, { hex });
  if (!a.ok) throw new Error('Angebot: ' + (a.fehler || []).join('; '));
  const r = Faden.abenteuerOeffnen(g, a.angebot.nr, {});
  if (!r.ok) throw new Error('Oeffnen: ' + r.grund);
  return r.faden;
}
function beatStarten(g, f) {
  for (let i = 0; i < 8; i++) {
    const beat = FD.vorlage(f.vorlage).beats[f.beat].id;
    if (Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat }).ok) return true;
    grenzen(g, 1);
  }
  return false;
}
const hierHin = (T, ort) => { space.enterScene(T.g, ort || 'skjaldborg', { docked: false }); T.run(0.3); };
const stehen = (T, x, y) => { const s = T.g.ship; s.docked = false; s.dockedAt = null; s.x = x; s.y = y; s.vx = 0; s.vy = 0; s.speed = 0; if (s.helm) { s.helm.thrust = 0; s.helm.turn = 0; } T.run(0.2); };
function runter(T, id) {
  const g = T.g, b = LP.info(g, id).beam;
  stehen(T, b.x + 20, b.y);
  const e = g.chooseLandepunkt(g.players[0], id);
  if (e) throw new Error('chooseLandepunkt: ' + e);
  const c = away.canBeam(g, 'down');
  if (!c.ok) throw new Error('canBeam: ' + JSON.stringify(c));
  away.executeBeam(g, g.players.map((p) => p.id), 'down');
  T.run(0.5);
}
const hoch = (T, pids) => { away.executeBeam(T.g, pids || T.g.players.map((p) => p.id), 'up'); T.run(0.5); };
const untenAnzahl = (g) => g.players.filter((p) => p.zone === 'away').length;
// Aufbau: Spiel, Faden mit laufendem rettung-Beat, Ort registriert und gescannt
async function aufbau(o) {
  o = o || {};
  const T = spiel({ crew: o.crew, env: o.env });
  hierHin(T);
  if (o.vorher) o.vorher(T);
  const f = oeffnen(T.g, '0904', o.plan || plan(o.art || 'schiff', o.parameter));
  T.f = f;
  T.gestartet = beatStarten(T.g, f);
  T.id = AO.idVon('skjaldborg', f.id, 'absturz');
  await tick(8);
  Lpscan.markieren(T.g, T.id);
  return T;
}
const beatId = (f) => FD.vorlage(f.vorlage).beats[f.beat].id;
const ereignisse = (f) => f.nsc.gedaechtnis.map((e) => e.ereignis);
const gegner = (g, id) => { const aw = g.aways[id]; return aw ? aw.drones : []; };
const offene = (g, id) => away.offenePersonen(g.aways[id]);
function orteReste(g) {
  return {
    dyn: Object.keys((g.landepunkte && g.landepunkte.dyn) || {}).filter((i) => AO.parse(i)),
    scan: Array.from((g.explore && g.explore.lpScan) || []).filter((i) => AO.parse(i)),
    aways: Object.keys(g.aways || {}).filter((i) => AO.parse(i)),
  };
}
const restlos = (g) => { const r = orteReste(g); return r.dyn.length === 0 && r.scan.length === 0 && r.aways.length === 0 && !(g.away && AO.parse(g.away.map)); };
const FRIST = BEATS.rettung.frist;
// Ops beamt k Personen hoch (Waffen-Konsole besetzt, Schiff in Reichweite, Landepunkt gescannt), eine nach der anderen; -> Liste der Fehlertexte der Starts
function aufnehmen(T, id, k) {
  const g = T.g, b = LP.info(g, id).beam, fehler = [];
  T.p.console = 'weapons';
  stehen(T, b.x + 20, b.y);
  Lpscan.markieren(g, id);
  for (let i = 0; i < k; i++) {
    const err = PB.aufnehmenStart(g, T.p, null);
    if (err) { fehler.push(err); break; }
    T.run(g.C.ship.beamTime + 1.5);
  }
  return fehler;
}
// Station: Ostia Nova (Erkundung: x 1358, y 976); die Ops gibt eine Person nach der anderen ab
const STATION = 'ostia_nova';
function zurStation(T) {
  const st = require('../shared/locations.js').get(STATION).scene.station;
  hierHin(T, STATION); stehen(T, st.x + 40, st.y);
}
function abgeben(T, id) {
  const err = PB.abgebenStart(T.g, T.p, id);
  if (err) return err;
  T.run(T.g.C.ship.beamTime + 1.5);
  return null;
}
// wie game.reset() und continueWorld (dasselbe Game-Objekt): Landepunkte zuruecksetzen, Faeden aus dem Weltstand neu lesen (neue Objekte), Orte abgleichen
function neuLaden(T) {
  const g = T.g, block = klon(Faden.toSave(g.weltsim));
  LP.zuruecksetzen(g);
  g.weltsim.faeden = Faden.lesen(block);
  AO.abgleichen(g);
  T.f = g.weltsim.faeden.liste.find((x) => x.id === T.f.id) || T.f;
}
const volkNamen = (volk) => { const L = NAMEN[volk]; const s = new Set(); for (const v of L.vornamen) for (const nn of L.nachnamen) s.add(v + ' ' + nn); return s; };
const enden = Object.keys(WERTE.enden.wert);
const A_BORD = enden.find((e) => !WERTE.enden.wert[e].abgeben), ABGEGEBEN = enden.find((e) => WERTE.enden.wert[e].abgeben);

(async () => {
// ---------------------------------------------------------------- (a)
await section('(a) Katalog, Daten, Baustein, Pflicht landeplatz', async () => {
  const k = FD.BEATS.rettung;
  ok(k && k.baustein === 'rettung' && k.gefahr === false && k.optionen === 'keine' && !k.abschluss, 'Beat rettung: baustein rettung, gefahr false, keine Optionen');
  ok(Number.isInteger(k.frist) && k.frist >= 1, 'eigene frist in Taetigkeiten: ' + k.frist);
  ok(JSON.stringify(k.braucht.nsc_status) === JSON.stringify(FD.BEATS.landung.braucht.nsc_status), 'braucht.nsc_status wie landung');
  ok(k.braucht.landeplatz === true, 'braucht.landeplatz: true (Pflicht)');
  ok(['landeplatz', 'besetzung', 'ende', 'anzahl'].every((x) => k.parameter.optional.includes(x)) && !k.parameter.pflicht.length, 'parameter.optional: landeplatz, besetzung, ende, anzahl');
  const bp = k.bauplan.parameter;
  ok(JSON.stringify(bp.besetzung.erlaubt.slice().sort()) === JSON.stringify(Object.keys(BODEN.besetzung.wert).sort()) && bp.besetzung.standard === BODEN.besetzung_standard.wert, 'bauplan.parameter.besetzung: dieselbe Tabelle wie landung (boden-werte.json)');
  ok(JSON.stringify(bp.ende.erlaubt.slice().sort()) === JSON.stringify(enden.slice().sort()) && bp.ende.standard === WERTE.ende_standard.wert && WERTE.ende_standard.wert === 'an_bord', 'bauplan.parameter.ende: an_bord und abgegeben, Standard an_bord');
  ok(JSON.stringify(bp.anzahl.erlaubt) === '[1,2,3]' && bp.anzahl.standard === 3 && bp.anzahl.verborgen === true, 'bauplan.parameter.anzahl: Zahlen 1 bis 3, Standard 3 (Zahlen als erlaubt: [..], verborgen im Katalog)');
  ok(WERTE.anzahl_max.wert <= CONFIG.personen.maxGleichzeitig, 'anzahl_max ' + WERTE.anzahl_max.wert + ' nicht ueber CONFIG.personen.maxGleichzeitig ' + CONFIG.personen.maxGleichzeitig);
  ok(k.bauplan.aus.gelungen.status.includes('verbuendet') && k.bauplan.aus.gescheitert.status.includes('geflohen'), 'bauplan.aus wie landung');
  ok(Rettung.datenFehler().length === 0, 'Daten stimmig (datenFehler leer)' + (Rettung.datenFehler().length ? ': ' + Rettung.datenFehler().join(' | ') : ''));
  const kf = Bauplan.katalogFehler();
  ok(kf.length === 0, 'katalogFehler des Expanders (hier haengt datenFehler von rettung) leer' + (kf.length ? ': ' + kf.slice(0, 2).join(' | ') : ''));
  const zeile = Prompt.katalogText().split('\n').find((l) => l.startsWith('- rettung'));
  ok(!!zeile && zeile.length <= 400, 'Katalogzeile hoechstens 400 Zeichen (' + (zeile ? zeile.length : '?') + ')');
  ok(!!zeile && zeile.includes('Pflicht: landeplatz') && zeile.includes('ende (Standard an_bord'), 'Katalogzeile nennt landeplatz als Pflicht und den Parameter ende');
  console.log('  Messung: Katalog ' + Prompt.katalogText().length + ' Zeichen, Zeile rettung ' + (zeile && zeile.length));
  ok(Bausteine.vonId('rettung') === Rettung.baustein && !Bausteine.istPlatzhalter('rettung'), 'Baustein rettung ist registriert (kein Platzhalter)');
  const T = await aufbau({ art: 'schiff' });
  const z0 = Boden.zugestellt(T.g);
  T.g.missionEvent('personAnBord', { person: 'fremd', name: 'Fremd' });
  ok(Boden.zugestellt(T.g) === z0 + 1, 'der Verteiler stellt dem Handler der Art rettung zu');
  // Pruefer: Pflicht landeplatz (Plan, Vorlage, Expander)
  const gut = plan('schiff', { besetzung: 'ruhig', ende: 'an_bord', anzahl: 2 });
  const rg = Bauplan.pruefe(gut);
  ok(rg.ok, 'Plan mit landeplatz, besetzung, ende, anzahl besteht Expander und Pruefer' + (rg.ok ? '' : ': ' + rg.fehler.join(' | ')));
  const ohne = plan('schiff'); delete ohne.beats[0].parameter.landeplatz; delete ohne.landeplaetze;
  const ro = Bauplan.pruefe(ohne);
  ok(!ro.ok && ro.fehler.some((x) => x.startsWith('LANDEPLATZ_PFLICHT')), 'Plan ohne landeplatz abgelehnt (LANDEPLATZ_PFLICHT): ' + (ro.fehler || []).slice(0, 2).join(' | ').slice(0, 140));
  const v = klon(rg.vorlage); delete v.beats[0].parameter.landeplatz; delete v.landeplaetze;
  const pv = Pruefer.pruefeVorlage(v);
  ok(!pv.ok && pv.fehler.some((x) => x.startsWith('LANDEPLATZ_PFLICHT')), 'pruefeVorlage lehnt einen rettung-Beat ohne landeplatz ab');
  for (const [name, p] of [['besetzung', { besetzung: 'gewaltig' }], ['ende', { ende: 'verschenkt' }], ['anzahl 4', { anzahl: 4 }], ['anzahl 0', { anzahl: 0 }]]) ok(!Bauplan.pruefe(plan('schiff', p)).ok, 'Expander lehnt ' + name + ' ausserhalb von erlaubt ab');
  const nach = (x) => Rettung.anzahlVon({ parameter: x });
  ok(nach({}) === WERTE.anzahl_standard.wert && nach({ anzahl: 7 }) === WERTE.anzahl_max.wert && nach({ anzahl: 0 }) === WERTE.anzahl_min.wert && nach({ anzahl: 2 }) === 2 && nach({ anzahl: 'viele' }) === WERTE.anzahl_standard.wert, 'anzahl: Standard ' + WERTE.anzahl_standard.wert + ', geklemmt auf ' + WERTE.anzahl_min.wert + ' bis ' + WERTE.anzahl_max.wert + ' (Vorlage-Dateien pruefen nur den Typ)');
  ok(Rettung.endeVon({ parameter: { ende: 'zzz' } }) === WERTE.ende_standard.wert && Rettung.endeVon({}) === WERTE.ende_standard.wert && Rettung.endeVon({ parameter: { ende: ABGEGEBEN } }) === ABGEGEBEN, 'ende: unbekannter Wert und fehlender Wert gelten als Standard');
  // Mock: nie rettung in Zufallsplaenen
  let mit = 0;
  for (let i = 0; i < 300; i++) { const p = AM.gueltigerPlan(AM.rngVon('rettung-probe-' + i), { wiedersehen: true, lage: { sabotage_ziel: 1 } }); if (p.beats.some((b) => b.typ === 'rettung')) mit++; }
  ok(mit === 0, 'Mock: unter 300 Zufallsplaenen kein Beat rettung (braucht.landeplatz nimmt ihn aus planbar aus)');
});

// ---------------------------------------------------------------- (b)
await section('(b) Wrack ohne landung: 1, 2, 3 Ueberlebende, Namen, Funk', async () => {
  for (const k of [1, 2, 3]) {
    const T = await aufbau({ art: 'schiff', parameter: k === 3 ? undefined : { anzahl: k } });
    const g = T.g, f = T.f, aw = g.aways[T.id];
    const volk = f.nsc.fraktion, pers = offene(g, T.id);
    ok(T.gestartet && f.phase === 'laeuft' && !!aw, `${k}: Beat laeuft am Wrack (Art schiff), keine landung davor`);
    ok(pers.length === k, `${k}: ${pers.length} Ueberlebende stehen am Ort (Standard 3 ohne Parameter anzahl)`);
    const namen = pers.map((q) => q.name);
    ok(namen.includes(f.nsc.name) && pers.some((q) => q.person === `${f.id}.${f.laufend.beat}.u1` && q.name === f.nsc.name), `${k}: Person ${f.id}.${f.laufend.beat}.u1 ist der Faden-NSC (${f.nsc.name})`);
    ok(new Set(namen).size === k, `${k}: keine Doppelten (${namen.join(', ')})`);
    const frei = volkNamen(volk), vergeben = Kanon.namenVergeben(Faden.zustandVon(g));
    ok(namen.slice().filter((x) => x !== f.nsc.name).every((x) => frei.has(x) && !vergeben.has(x)), `${k}: die anderen Namen stehen in der Namensliste des Volkes ${volk} und nicht im Kanon oder bei einem Faden-NSC`);
    ok(pers.every((q) => q.injured === false && q.present === true && !q.rescued), `${k}: alle unverletzt (injured false)`);
    const anker = require('../server/mission/objects.js').resolveAnker(g, T.id, 'deckung');
    ok(anker.length === 0 || pers.every((q) => { const t = require('../shared/physics.js').toTile(q.x, q.y); return anker.some((a) => Math.abs(a.x - t.x) <= 3 && Math.abs(a.y - t.y) <= 3); }), `${k}: auf (oder neben) den deckung-Ankern der Karte (${anker.length} Anker)`);
    const start = T.radio.find((r) => r.text === TEXTE.rettung_start_an_bord.replace('{platz}', 'Absturzstelle').replace('{ort}', Sektoren.hexName('0904') || '0904').slice(0, 160));
    ok(!!start && start.von === f.nsc.name, `${k}: Funk beim Start (rettung_start_an_bord) nennt den Landeplatz, es spricht der NSC`);
    ok(T.radio.every((r) => !/A0/.test(r.text) && !/A0/.test(String(r.von))), `${k}: kein Spielername im Funk`);
    ok(!T.radio.some((r) => r.text === TEXTE.rettung_frachtraum_belegt) && !T.oda.some((t) => /Frachtraum/.test(t)), `${k}: Frachtraum frei: kein Hinweis`);
    ok(g.errors === 0, `${k}: g.errors 0` + (T.fehler.length ? ' (' + T.fehler[0] + ')' : ''));
  }
  // Wildnis hat deckung-Anker: dort stehen die Ueberlebenden darauf
  const Wd = await aufbau({ art: 'wildnis' });
  const ank = require('../server/mission/objects.js').resolveAnker(Wd.g, Wd.id, WERTE.anker_rollen.wert[0]);
  const pw = offene(Wd.g, Wd.id), phys = require('../shared/physics.js');
  ok(ank.length >= 3 && pw.length === 3 && pw.every((q) => { const tt = phys.toTile(q.x, q.y); return ank.some((a) => a.x === tt.x && a.y === tt.y); }), 'Wildnis: drei Ueberlebende auf Ankern der ersten Rolle (' + ank.length + ' Anker)');
  // Ids und Namen sind deterministisch: derselbe Plan im selben Seed gibt dieselben Namen
  const A = await aufbau({ art: 'schiff' }), B = await aufbau({ art: 'schiff' });
  ok(JSON.stringify(offene(A.g, A.id).map((q) => [q.person, q.name])) === JSON.stringify(offene(B.g, B.id).map((q) => [q.person, q.name])), 'gleicher Seed, gleicher Faden: gleiche Kennungen und Namen (eigener Strom)');
  const Tn = spiel(); hierHin(Tn);
  const fn = oeffnen(Tn.g, '0904', plan('schiff'));
  let dopplt = 0, leer = 0, imKanon = 0;
  const vergebenN = Kanon.namenVergeben(Faden.zustandVon(Tn.g));
  ok(vergebenN.has(fn.nsc.name), 'Aufbau: der Name des Faden-NSC steht bei den vergebenen Namen');
  for (let i = 1; i <= 1500; i++) {
    const nm = Faden.ueberlebendeNamen(Tn.g, { id: 'f' + i, beat: 0, nsc: { fraktion: fn.nsc.fraktion, name: 'Bjarne Skarn' } }, 2);
    if (nm.length !== 2) leer++;
    if (new Set(nm.concat(['Bjarne Skarn'])).size !== nm.length + 1 && nm.length) dopplt++;
    if (nm.some((x) => vergebenN.has(x))) imKanon++;
  }
  ok(dopplt === 0 && leer === 0 && imKanon === 0, 'ueberlebendeNamen: 1500 Faden-Nummern, nie ein Doppelter untereinander oder zu einem vorhandenen Namen, immer zwei (' + dopplt + ' Doppelte, ' + leer + ' zu wenige)');
  ok(Faden.ueberlebendeNamen(Tn.g, { id: 'f1', beat: 0, nsc: { fraktion: 'zzz' } }, 2).length === 0, 'ueberlebendeNamen: unbekanntes Volk liefert keinen Namen (kein Wurf)');
  // Namen sind vom Lagerstand unabhaengig: dieselben Namen vor und nach dem Laden (im Lager liegt dann eine der Personen mit ihrem Namen)
  const C = spiel(); hierHin(C);
  const f0 = oeffnen(C.g, '0904', plan('schiff', { anzahl: 3 }));
  const vorher = Faden.ueberlebendeNamen(C.g, f0, 2);
  Fracht.lagerAufnehmen(C.g, { art: 'person', person: 'x1', name: vorher[0], quelle: 'skript' });
  const nachher = Faden.ueberlebendeNamen(C.g, f0, 2);
  ok(vorher.length === 2 && JSON.stringify(vorher) === JSON.stringify(nachher) && !nachher.includes(f0.nsc.name), 'ueberlebendeNamen: dieselben Namen vor und nach dem Lagerstand (' + vorher.join(', ') + ' -> ' + nachher.join(', ') + ')');
  ok(Faden.ueberlebendeNamen(C.g, f0, 0).length === 0, 'ueberlebendeNamen: 0 Namen auf Wunsch');
});

// ---------------------------------------------------------------- (c)
await section('(c) Ops-Beamen: Betten 0 bis 2, ende an_bord gelungen', async () => {
  const T = await aufbau({ art: 'schiff' });
  const g = T.g, f = T.f;
  const fehler = aufnehmen(T, T.id, 2);
  ok(fehler.length === 0 && PB.personenAnBord(g).length === 2 && f.phase === 'laeuft', 'zwei aufgenommen, der Beat laeuft weiter (' + fehler.join(' | ') + ')');
  ok(JSON.stringify(PB.personenAnBord(g).map((q) => q.bett)) === '[0,1]', 'Betten 0 und 1');
  const doppelt = T.ev.filter((e) => e === 'npcRescued').length === 2 && T.ev.filter((e) => e === 'personAnBord').length === 2;
  ok(doppelt, 'jede Aufnahme erzeugt zwei Ereignisse (npcRescued, personAnBord): 2 und 2');
  g.missionEvent('personAnBord', { person: 'fremd', name: 'Fremd' });
  g.missionEvent('personAnBord', { person: PB.personenAnBord(g)[0].id, name: 'Doppel' });
  g.missionEvent('personAbgegeben', { person: 'fremd', name: 'Fremd' });
  ok(f.phase === 'laeuft', 'eine fremde Person und ein doppeltes Ereignis aendern nichts (nach person gefiltert, Zustand aus dem Lager)');
  g.missionEvent('npcRescued', { person: `${f.id}.${f.laufend.beat}.u3`, map: T.id });
  ok(f.phase === 'laeuft', 'npcRescued allein bewertet nicht (die Person liegt noch nicht im Lager)');
  const f3 = aufnehmen(T, T.id, 1);
  ok(f3.length === 0 && PB.personenAnBord(g).length === 3, 'die dritte aufgenommen');
  ok(JSON.stringify(PB.personenAnBord(g).map((q) => q.bett)) === '[0,1,2]', 'Betten 0 bis 2');
  ok(Fracht.state(g).lager.every((l) => l.art === 'person') && PB.personenAnBord(g).every((q) => /^f\d+\.[a-z0-9_]+\.u[123]$/.test(q.id)), 'im Lager: drei Personen mit den Kennungen des Beats');
  ok(f.phase === 'wartet' && beatId(f) === 'ende' && ereignisse(f).includes('rettung_gelungen') && !ereignisse(f).includes('rettung_gescheitert'), 'ende an_bord: gelungen, Gedaechtnis rettung_gelungen, weiter zum Abschluss');
  ok(T.radio.some((r) => r.text === TEXTE.rettung_gelungen.replace('{ort}', Sektoren.hexName('0904') || '0904')), 'Funk bei Erfolg (rettung_gelungen)');
  ok(offene(g, T.id).length === 0, 'am Ort steht niemand mehr');
  ok(beatStarten(g, f) && f.phase === 'abgeschlossen', 'Abschluss laeuft');
  ok(restlos(g) && PB.personenAnBord(g).length === 3, 'Ort restlos abgeraeumt (0 Orte, keine lpScan-Reste, away.map nicht der Ort); die Personen bleiben an Bord');
  ok(g.errors === 0, 'g.errors 0' + (T.fehler.length ? ' (' + T.fehler[0] + ')' : ''));
  // eine fremde Person liegt schon im Lager (nach person filtern: sie zaehlt nicht fuer den Beat)
  const Fm = await aufbau({ art: 'schiff', vorher: (X) => { if (!PB.personAnBordLegen(X.g, 'fremd.p1', 'Fremde Person')) throw new Error('Person'); } });
  ok(PB.personenAnBord(Fm.g).length === 1 && Fm.f.phase === 'laeuft', 'Aufbau: eine fremde Person liegt im Lager, der Beat laeuft');
  aufnehmen(Fm, Fm.id, 2);
  ok(Fm.f.phase === 'laeuft' && PB.personenAnBord(Fm.g).length === 3, 'zwei eigene aufgenommen, die fremde im Lager zaehlt nicht: der Beat laeuft');
  aufnehmen(Fm, Fm.id, 1);
  ok(Fm.f.phase === 'wartet' && ereignisse(Fm.f).includes('rettung_gelungen') && PB.personAnBord(Fm.g, 'fremd.p1') && PB.personenAnBord(Fm.g).length === 4, 'die dritte eigene aufgenommen: gelungen; die fremde Person bleibt unberuehrt im Lager');
  // eine Person, ende abgegeben: die Aufnahme (zwei Ereignisse) beendet den Beat nicht, erst die Abgabe
  const E1 = await aufbau({ art: 'schiff', parameter: { ende: ABGEGEBEN, anzahl: 1 } });
  aufnehmen(E1, E1.id, 1);
  ok(E1.f.phase === 'laeuft' && PB.personenAnBord(E1.g).length === 1 && offene(E1.g, E1.id).length === 0, 'anzahl 1, ende abgegeben: aufgenommen, der Beat laeuft noch (npcRescued zaehlt nicht als Abgabe)');
  zurStation(E1);
  ok(abgeben(E1, PB.personenAnBord(E1.g)[0].id) === null && E1.f.phase === 'wartet' && ereignisse(E1.f).includes('rettung_gelungen'), 'anzahl 1: nach der Abgabe gelungen');
  // ein Mensch geht zu Fuss mit hoch (Gerettet-Weg der Karte, kein Bett): zaehlt als erledigt
  const S = await aufbau({ art: 'schiff', parameter: { anzahl: 2 } });
  runter(S, S.id);
  const mit = away.offenePersonen(S.g.away).find((q) => q.person === `${S.f.id}.${S.f.laufend.beat}.u2`);
  mit.following = S.g.players[0].id; mit.x = S.g.players[0].x; mit.y = S.g.players[0].y;
  hoch(S);
  ok(S.f.phase === 'laeuft' && S.ev.includes('npcRescued') && !S.ev.includes('personAnBord'), 'Gerettet-Weg: npcRescued ohne personAnBord, der Beat laeuft (die andere Person wartet)');
  for (const id of ['hafen.kontor', 'helix.station', 'nebel.havarist']) LP.get(S.g, id);
  LP.get(S.g, S.id); S.run(1);
  ok(S.f.phase === 'laeuft' && offene(S.g, S.id).length === 1 && offene(S.g, S.id)[0].person === `${S.f.id}.${S.f.laufend.beat}.u1`, 'nach der Verdraengung der Karte wird die zu Fuss gerettete Person nicht noch einmal gesetzt (nur die andere wartet)');
  aufnehmen(S, S.id, 1);
  ok(S.f.phase === 'wartet' && ereignisse(S.f).includes('rettung_gelungen') && PB.personenAnBord(S.g).length === 1, 'die andere aufgenommen: gelungen (die zu Fuss gerettete zaehlt als erledigt)');
});

// ---------------------------------------------------------------- (d)
await section('(d) ende abgegeben: Station, Nebenfiguren weg, Gedaechtnis, Wiedersehen', async () => {
  const T = await aufbau({ art: 'schiff', parameter: { ende: ABGEGEBEN, anzahl: 3 } });
  const g = T.g, f = T.f;
  ok(T.radio.some((r) => r.text === TEXTE.rettung_start_abgegeben.replace('{platz}', 'Absturzstelle').replace('{ort}', Sektoren.hexName('0904') || '0904').slice(0, 160)), 'Funk beim Start je ende (rettung_start_abgegeben)');
  aufnehmen(T, T.id, 3);
  ok(PB.personenAnBord(g).length === 3 && f.phase === 'laeuft', 'drei an Bord, ende abgegeben: der Beat laeuft noch');
  const n0 = f.laufend.n;
  zurStation(T);
  g.lageGrenze('andocken');   // das Andocken an der Station zaehlt als Taetigkeit (Takt des Fluges, nicht der Abgabe)
  const n1 = f.laufend.n;
  ok(f.phase === 'laeuft', 'an der Station angekommen: noch nichts abgegeben, der Beat laeuft');
  const ids = PB.personenAnBord(g).map((q) => q.id);
  ok(abgeben(T, ids[1]) === null && PB.personenAnBord(g).length === 2 && f.phase === 'laeuft', 'eine Nebenfigur abgegeben: der Beat laeuft');
  g.missionEvent('personAbgegeben', { person: 'fremd', name: 'Fremd', map: null });
  ok(f.phase === 'laeuft', 'eine fremde personAbgegeben (kein Abgabeort im Ereignis, nach person gefiltert) aendert nichts');
  ok(abgeben(T, ids[2]) === null && f.phase === 'laeuft', 'die zweite Nebenfigur abgegeben: der Beat laeuft');
  ok(abgeben(T, ids[0]) === null, 'der Faden-NSC abgegeben');
  ok(PB.personenAnBord(g).length === 0 && Fracht.state(g).lager.every((l) => l.art !== 'person'), 'Nebenfiguren weg: kein Person-Eintrag mehr im Lager');
  ok(f.phase === 'wartet' && beatId(f) === 'ende' && ereignisse(f).includes('rettung_gelungen'), 'nach der letzten Abgabe: gelungen, Gedaechtnis rettung_gelungen');
  console.log('  Messung: Taetigkeiten im Beat: beim Aufnehmen ' + n0 + ', nach Flug und Andocken an der Station ' + n1 + ', Abgabe selbst 0 (Frist ' + FRIST + ')');
  ok(n0 === 0 && n1 === 1 && n1 < FRIST, 'am Boden zaehlt keine Taetigkeit (' + n0 + '), der Flug zur Station mit dem Andocken eine (' + n1 + '): weit unter der Frist ' + FRIST);
  ok(beatStarten(g, f) && f.phase === 'abgeschlossen' && restlos(g), 'Abschluss: Ort restlos weg');
  ok(f.nsc.gedaechtnis.some((e) => e.ereignis === 'rettung_gelungen') && f.ausgang.art === 'gelungen', 'der Faden-NSC steht mit Gedaechtnis rettung_gelungen im Weltstand');
  // Wiedersehen greift die Rettung auf
  const E = B1.werte.wiedersehen_erinnert.wert;
  ok(E.rettung_gelungen === 'wiedersehen_rettung_gelungen' && E.rettung_gescheitert === 'wiedersehen_rettung_gescheitert' && B1.texte.wiedersehen_rettung_gelungen !== B1.texte.wiedersehen_rettung_gescheitert, 'b1-texte.json: rettung_gelungen und rettung_gescheitert mit verschiedenen Texten');
  const pw = { format: 'faden-bauplan/1', titel: 'Wiedersehen mit Geretteten', anlass: 'Ein Geretteter meldet sich bei der Crew.', beats: [{ typ: 'wiedersehen' }, { typ: 'abschluss' }] };
  const puffer = () => { const pf = oeffnen(g, '0305', { format: 'faden-bauplan/1', titel: 'Puffer', anlass: 'Ein Puffer-Abenteuer fuer den Test', beats: [{ typ: 'notruf' }, { typ: 'abschluss' }] }); beatStarten(g, pf); g.step(); g.step(); beatStarten(g, pf); pf.nsc.status = 'tot'; return pf; };
  puffer();
  const kand = Faden.wiedersehenKandidaten(g, Bauplan.expandiere(pw).vorlage);
  ok(kand.includes(f.nsc.id), 'Wiedersehen: der gerettete NSC ist Kandidat (Tat rettung_gelungen im Gedaechtnis)');
  Faden.zustandVon(g).abenteuerAngebote = [];
  const a = Faden.abenteuerAnbieten(g, pw, { hex: '0305' });
  const r = a.ok ? Faden.abenteuerOeffnen(g, a.angebot.nr, { nsc_von: f.nsc.id }) : { ok: false, grund: (a.fehler || []).join(' | ') };
  ok(r.ok, 'Wiedersehen mit nsc_von eroeffnet' + (r.ok ? '' : ': ' + r.grund));
  if (r.ok) {
    T.radio.length = 0;
    beatStarten(g, r.faden);
    const soll = B1.texte.wiedersehen_rettung_gelungen.replace('{ort}', Sektoren.hexName(r.faden.parameter.ort));
    ok(T.radio.some((x) => x.text === soll), 'der Funk des Wiedersehens nennt die Rettung (wiedersehen_rettung_gelungen)');
  }
  ok(g.errors === 0, 'g.errors 0' + (T.fehler.length ? ' (' + T.fehler[0] + ')' : ''));
});

// ---------------------------------------------------------------- (e)
await section('(e) Belegter Frachtraum: Hinweis, nichts geraeumt, Beat wartet', async () => {
  const T = await aufbau({ art: 'schiff', vorher: (X) => { const r = Fracht.lagerAufnehmen(X.g, { art: 'erz', quelle: 'skript' }); if (!r.ok) throw new Error('Erz'); } });
  const g = T.g, f = T.f;
  const pf = Fracht.platzFuer(g, 'person');
  ok(!pf.ok && pf.grund === 'art_belegt', 'Aufbau: Erz im einzigen Modul, platzFuer(person) lehnt ab (art_belegt)');
  ok(T.radio.some((r) => r.text === TEXTE.rettung_frachtraum_belegt && r.von === f.nsc.name), 'Funk-Hinweis aus rettung-texte.json beim Start');
  ok(T.oda.some((t) => t === pf.text), 'die Bordanzeige nennt den Klartext des Frachtraums: ' + pf.text.slice(0, 60) + '...');
  ok(offene(g, T.id).length === 3, 'die Ueberlebenden stehen trotzdem am Ort');
  const lager0 = JSON.stringify(Fracht.state(g).lager);
  const fehler = aufnehmen(T, T.id, 1);
  ok(fehler.length === 1 && /Kein Bett frei/.test(fehler[0]), 'Beamen wird abgelehnt: ' + (fehler[0] || '').slice(0, 70));
  ok(JSON.stringify(Fracht.state(g).lager) === lager0 && Fracht.state(g).lager.length === 1 && Fracht.state(g).lager[0].art === 'erz', 'nichts geraeumt oder geworfen: das Erz liegt unveraendert im Lager');
  T.run(5);
  grenzen(g, FRIST - 1);
  ok(f.phase === 'laeuft', 'der Beat wartet (nach ' + (FRIST - 1) + ' Taetigkeiten noch offen)');
  grenzen(g, 1);
  ok(f.phase === 'wartet' && beatId(f) === 'ende' && ereignisse(f).includes('rettung_gescheitert'), 'Frist abgelaufen: gescheitert (Verzweigung -> ende)');
  ok(JSON.stringify(Fracht.state(g).lager) === lager0, 'nach dem Scheitern liegt das Erz weiter unveraendert');
  ok(g.errors === 0, 'g.errors 0' + (T.fehler.length ? ' (' + T.fehler[0] + ')' : ''));
});

// ---------------------------------------------------------------- (f)
await section('(f) Scheitern und Abraeumen', async () => {
  const sauber = (T, was) => {
    ok(beatStarten(T.g, T.f) && T.f.phase === 'abgeschlossen', `${was}: Abschluss laeuft`);
    T.run(2);
    const r = orteReste(T.g);
    ok(restlos(T.g), `${was}: 0 Orte (${r.dyn.length}), keine lpScan-Reste (${r.scan.length}), kein Ort in aways (${r.aways.length}), away.map nicht der Ort (${T.g.away.map})`);
    ok(T.g.weltsim.faeden.liste.every((x) => x.phase !== 'laeuft') && T.g.errors === 0, `${was}: kein Zombie-Faden, g.errors 0` + (T.fehler.length ? ' (' + T.fehler[0] + ')' : ''));
  };
  // Frist (am Boden zaehlt keine Taetigkeit)
  const T = await aufbau({ art: 'schiff' });
  ok(Faden.fristVon(T.f) === FRIST, 'Frist des Beats aus dem Katalog: ' + FRIST + ' Taetigkeiten');
  runter(T, T.id);
  T.run(60);
  ok(T.f.laufend.n === 0 && T.f.phase === 'laeuft', 'Messung: 60 s am Boden zaehlen 0 Taetigkeiten (laufend.n ' + T.f.laufend.n + ')');
  hoch(T);
  grenzen(T.g, FRIST - 1);
  ok(T.f.phase === 'laeuft', 'nach ' + (FRIST - 1) + ' Taetigkeiten laeuft der Beat noch');
  grenzen(T.g, 1);
  ok(T.f.phase === 'wartet' && beatId(T.f) === 'ende' && ereignisse(T.f).includes('rettung_gescheitert'), 'Frist: gescheitert, Verzweigung -> ende');
  sauber(T, 'Frist');
  // Notsprung
  const N = await aufbau({ art: 'schiff' });
  N.g.missionEvent('notsprung', {});
  ok(N.f.phase === 'wartet' && ereignisse(N.f).includes('rettung_gescheitert') && !ereignisse(N.f).includes('rettung_gelungen'), 'Notsprung: gescheitert');
  sauber(N, 'Notsprung');
  // Notrueckholung: alle unten downed (squadRecall)
  const R = await aufbau({ art: 'schiff', crew: 2 });
  runter(R, R.id);
  for (const p of R.g.players) { p.downed = true; p.hp = 0; }
  R.run(8);
  ok(R.ev.includes('squadRecall') && untenAnzahl(R.g) === 0, 'alle Spieler unten downed: squadRecall holt die Crew hoch');
  ok(R.f.phase === 'wartet' && ereignisse(R.f).includes('rettung_gescheitert') && !ereignisse(R.f).includes('rettung_gelungen'), 'Crew unten verloren und Ueberlebende am Boden: gescheitert');
  sauber(R, 'Crew verloren');
  // recall der ganzen Crew 1; bei Crew 3 scheitert ein einzelner recall nicht
  const R1 = await aufbau({ art: 'schiff' });
  runter(R1, R1.id);
  away.recall(R1.g, R1.g.players[0].id);
  ok(R1.f.phase === 'wartet' && ereignisse(R1.f).includes('rettung_gescheitert'), 'recall der ganzen Crew: gescheitert');
  const R3 = await aufbau({ art: 'schiff', crew: 3 });
  runter(R3, R3.id);
  away.recall(R3.g, R3.g.players[0].id);
  ok(R3.f.phase === 'laeuft' && untenAnzahl(R3.g) === 2, 'Crew 3: einer notzurueckgeholt, zwei noch unten: der Beat laeuft');
  // Notrueckholung ohne Ueberlebende am Boden (alle schon an Bord): kein Scheitern
  const Z = await aufbau({ art: 'schiff', parameter: { ende: ABGEGEBEN, anzahl: 2 } });
  aufnehmen(Z, Z.id, 2);
  Z.g.missionEvent('beamedUp', { players: [], map: Z.id, notrueckholung: true });
  ok(Z.f.phase === 'laeuft', 'ende abgegeben, beide an Bord, Notrueckholung-Ereignis: keine Ueberlebenden am Boden, der Beat laeuft');
  // keine Ueberlebende mehr erreichbar (alle von der Karte genommen, nicht an Bord)
  const L = await aufbau({ art: 'schiff', parameter: { anzahl: 2 } });
  for (const q of offene(L.g, L.id)) away.entfernePerson(L.g, L.id, q.person);
  L.run(1);
  ok(L.f.phase === 'wartet' && ereignisse(L.f).includes('rettung_gescheitert'), 'keine Ueberlebende mehr erreichbar (weg, nicht an Bord): gescheitert');
  sauber(L, 'Alle weg');
  // Faden-Ende: der Faden ist weg, der Handler tut nichts, der Takt raeumt den Ort
  const E = await aufbau({ art: 'schiff' });
  runter(E, E.id);
  E.g.weltsim.faeden.liste.splice(0, E.g.weltsim.faeden.liste.length);
  hoch(E);
  E.run(2);
  ok(E.g.errors === 0 && restlos(E.g), 'Faden-Ende (Faden weg): kein Fehler, der Ort wird abgeraeumt');
  ok(T.g.errors === 0 && N.g.errors === 0 && R.g.errors === 0 && R1.g.errors === 0 && R3.g.errors === 0 && Z.g.errors === 0 && L.g.errors === 0, 'g.errors 0 in allen Laeufen');
});

// ---------------------------------------------------------------- (g)
await section('(g) Speichern und Laden, Verdraengung', async () => {
  const T = await aufbau({ art: 'schiff' });
  const g = T.g;
  aufnehmen(T, T.id, 2);
  const vorher = PB.personenAnBord(g).map((q) => [q.id, q.name, q.bett]);
  const data = JSON.parse(JSON.stringify(Weltstand.capture(g)));
  const fr = data.schiff && data.schiff.fracht;
  ok(Array.isArray(fr) && fr.length === 2 && fr.every((x) => /^f\d+\.[a-z0-9_]+\.u[123]$/.test(x.p) && x.n && Number.isInteger(x.b)), 'Weltstand schiff.fracht traegt zwei Personen {p, n, b}: ' + JSON.stringify(fr));
  ok(Weltstand.validate(data, g).filter((x) => /fracht|faeden/.test(String(x))).length === 0, 'der Stand ist schemagueltig');
  ok(!JSON.stringify(data.welt.sim.faeden).includes('.u3"') && !JSON.stringify(data.welt.sim.faeden).includes('rettung-personen'), 'kein neuer Weltstand-Block: der Faden traegt nichts Eigenes des Beats im Stand');
  // Laden in ein frisches Spiel (der echte Weg: Weltstand.apply)
  const T2 = spiel();
  Weltstand.apply(T2.g, JSON.parse(JSON.stringify(data)));
  T2.p = T2.g.players[0];
  const g2 = T2.g, f2 = g2.weltsim.faeden.liste.find((x) => x.id === T.f.id);
  T2.f = f2; T2.id = T.id;
  ok(JSON.stringify(PB.personenAnBord(g2).map((q) => [q.id, q.name, q.bett])) === JSON.stringify(vorher), 'nach dem Laden: dieselben Personen, Namen und Betten im Lager');
  ok(!!f2 && f2 !== T.f && f2.phase === 'laeuft' && f2.laufend.beat === T.f.laufend.beat, 'der Beat laeuft nach dem Laden weiter (neues Faden-Objekt)');
  ok(!!(g2.landepunkte.dyn && g2.landepunkte.dyn[T.id]), 'der Ort ist nach dem Laden wieder bestellt (aus dem Faden)');
  hierHin(T2);
  LP.get(g2, T.id);   // wie die Ops beim Beamen: die Karte wird gebaut
  T2.run(1);
  await tick(4);
  const rest = offene(g2, T.id);
  ok(rest.length === 1 && rest[0].person === `${f2.id}.${f2.laufend.beat}.u3`, 'am Ort wartet nur noch die dritte Person (die zwei im Lager werden nicht noch einmal gesetzt): ' + rest.map((q) => q.person + ':' + q.name).join(','));
  const name3 = rest.length ? rest[0].name : '';
  ok(!!name3 && !vorher.some((v) => v[1] === name3) && name3 !== f2.nsc.name, 'ihr Name ist keiner der beiden im Lager und nicht der des Faden-NSC (' + name3 + ')');
  const fe = aufnehmen(T2, T.id, 1);
  ok(fe.length === 0 && PB.personenAnBord(g2).length === 3 && f2.phase === 'wartet' && ereignisse(f2).includes('rettung_gelungen'), 'nach dem Laden die dritte aufgenommen: der Beat ist gelungen (' + fe.join(' | ') + ')');
  ok(JSON.stringify(PB.personenAnBord(g2).map((q) => q.bett)) === '[0,1,2]', 'Betten 0 bis 2');
  ok(g.errors === 0 && g2.errors === 0, 'g.errors 0' + (T2.fehler.length ? ' (' + T2.fehler[0] + ')' : ''));
  // reset und continueWorld im selben Game-Objekt (Landepunkte zuruecksetzen, Faeden neu lesen)
  const R = await aufbau({ art: 'schiff' });
  aufnehmen(R, R.id, 1);
  const fAlt = R.f;
  neuLaden(R);
  ok(R.f !== fAlt && R.f.phase === 'laeuft' && PB.personenAnBord(R.g).length === 1, 'reset/Laden im selben Spiel: neues Faden-Objekt, der Beat laeuft, die Person bleibt im Lager');
  LP.get(R.g, R.id); R.run(1);
  ok(offene(R.g, R.id).length === 2, 'die zwei anderen stehen nach dem Neubau der Karte wieder am Ort');
  aufnehmen(R, R.id, 2);
  ok(R.f.phase === 'wartet' && ereignisse(R.f).includes('rettung_gelungen') && R.g.errors === 0, 'und der Beat endet gelungen');
  // Karte verdraengt (maxGebaut 2: zwei andere Landepunkte gebaut): die Ueberlebenden kommen mit der neuen Karte zurueck
  const V = await aufbau({ art: 'schiff' });
  const gv = V.g;
  for (const id of ['hafen.kontor', 'helix.station', 'nebel.havarist']) LP.get(gv, id);
  ok(!gv.aways[V.id], 'zwei andere Landepunkte gebaut: die Karte des Beats ist verdraengt');
  LP.get(gv, V.id);
  ok(offene(gv, V.id).length === 0, 'Wiederkehr: die neu gebaute Karte ist zunaechst leer');
  V.run(1);
  ok(offene(gv, V.id).length === 3, 'ein Tick spaeter stehen die drei Ueberlebenden wieder dort (' + offene(gv, V.id).length + ')');
  runter(V, V.id);
  ok(offene(gv, V.id).length === 3 && gv.errors === 0, 'Runterbeamen setzt sie nicht doppelt (' + offene(gv, V.id).length + '), g.errors 0');
  // mit einer aufgenommenen Person: nach Verdraengung nur die fehlenden
  const U = await aufbau({ art: 'schiff' });
  aufnehmen(U, U.id, 1);
  for (const id of ['hafen.kontor', 'helix.station', 'nebel.havarist']) LP.get(U.g, id);
  LP.get(U.g, U.id); U.run(1);
  ok(offene(U.g, U.id).length === 2 && PB.personenAnBord(U.g).length === 1, 'nach der Verdraengung stehen nur die zwei nicht aufgenommenen wieder da (die aufgenommene liegt im Lager)');
});

// ---------------------------------------------------------------- (h)
await section('(h) Besetzung folgt besetzung', async () => {
  const matrix = [];
  for (const bes of Object.keys(BODEN.besetzung.wert)) {
    const T = await aufbau({ art: 'schiff', parameter: { besetzung: bes } });
    const L = spiel(); hierHin(L);
    const fl = oeffnen(L.g, '0904', planLandung('schiff', bes)); beatStarten(L.g, fl);
    const idL = AO.idVon('skjaldborg', fl.id, 'absturz'); await tick(8);
    const d = gegner(T.g, T.id), dl = gegner(L.g, idL);
    matrix.push(`${bes}: ${d.length} Gegner in ${trupps(T.g.aways[T.id])} Trupps`);
    ok(d.length === dl.length && trupps(T.g.aways[T.id]) === trupps(L.g.aways[idL]), `${bes}: dieselbe Besetzung wie landung (${d.length} Gegner, ${trupps(T.g.aways[T.id])} Trupps)`);
    if (bes === 'ruhig') ok(d.length === 0, 'ruhig: 0 Gegner');
    else {
      const e = BODEN.besetzung.wert[bes];
      ok(d.length >= 1 && d.every((x) => x.fraktion === e.fraktion && x.rolle === 'grundtyp') && trupps(T.g.aways[T.id]) === Number(KAT[e.fraktion].staerke[e.staerke]), `${bes}: Gegner der Fraktion laut Tabelle, alle grundtyp, Trupps laut Katalog`);
    }
    ok(offene(T.g, T.id).length === 3 && T.g.errors === 0, `${bes}: dazu 3 Ueberlebende, g.errors 0`);
  }
  console.log('  Messung: ' + matrix.join(', '));
  // Standard ohne Parameter: ruhig; beamedDown besetzt nicht noch einmal
  const T0 = await aufbau({ art: 'schiff', parameter: { besetzung: 'raeuber' } });
  const n0 = gegner(T0.g, T0.id).length;
  runter(T0, T0.id); T0.g.missionEvent('beamedDown', { players: [], map: T0.id });
  ok(gegner(T0.g, T0.id).length === n0 && offene(T0.g, T0.id).length === 3, 'beamedDown besetzt und setzt nicht noch einmal');
  // landung und rettung am selben Platz: die Besetzung steht nur einmal
  const Z = spiel(); hierHin(Z);
  const pz = plan('schiff', { besetzung: 'raeuber' }); pz.beats.unshift({ typ: 'landung', parameter: { landeplatz: 'absturz', besetzung: 'raeuber' } }); pz.beats[1].id = 'rettung1'; pz.beats[0].verzweigung = { gescheitert: 'ende' };
  const fz = oeffnen(Z.g, '0904', pz);
  beatStarten(Z.g, fz);
  const idZ = AO.idVon('skjaldborg', fz.id, 'absturz'); await tick(8);
  const nl = gegner(Z.g, idZ).length;
  Lpscan.markieren(Z.g, idZ); runter(Z, idZ); hoch(Z);
  ok(fz.phase === 'wartet' && fz.beat === 1 && beatStarten(Z.g, fz) && fz.phase === 'laeuft', 'landung gelungen, danach startet rettung am selben Platz');
  await tick(4);
  ok(gegner(Z.g, idZ).length === nl && offene(Z.g, idZ).length === 3, 'Besetzung von landung bleibt (' + nl + ' Gegner, nicht doppelt), die Ueberlebenden kommen dazu');
});

// ---------------------------------------------------------------- (i)
await section('(i) Gegenprobe: ohne FAEDEN und ohne rettung-Beat nichts anders', async () => {
  const T = spiel({ env: {} });
  const g = T.g;
  const z0 = Boden.zugestellt(g), aw0 = Object.keys(g.aways || {}).length;
  g.missionEvent('personAnBord', { person: 'x1', name: 'X' });
  g.missionEvent('personAbgegeben', { person: 'x1', name: 'X' });
  g.missionEvent('npcRescued', { person: 'x1' });
  g.missionEvent('notsprung', {});
  T.run(5);
  ok(Boden.zugestellt(g) === z0 && g.errors === 0 && T.fehler.length === 0, 'ohne FAEDEN=1: kein Ereignis wird zugestellt, kein Fehler');
  ok(Rettung.update(g) === undefined && Rettung.nachTaetigkeit(g) === undefined && Object.keys(g.aways || {}).length === aw0, 'update und nachTaetigkeit ohne Faden: kein Effekt');
  // mit FAEDEN, aber ein anderer Beat laeuft: rettung rührt nichts an
  const L = spiel(); hierHin(L);
  const fl = oeffnen(L.g, '0904', planLandung('schiff', 'ruhig')); beatStarten(L.g, fl); await tick(8);
  const lager0 = JSON.stringify(Fracht.state(L.g).lager), aws = Object.keys(L.g.aways).length;
  const idL = AO.idVon('skjaldborg', fl.id, 'absturz');
  L.g.missionEvent('personAnBord', { person: 'x1', name: 'X' });
  grenzen(L.g, 2); L.run(3);
  ok(fl.phase === 'laeuft' && JSON.stringify(Fracht.state(L.g).lager) === lager0 && Object.keys(L.g.aways).length === aws && away.offenePersonen(L.g.aways[idL]).length === 0, 'laeuft nur landung: keine Ueberlebenden, Lager und Karten unveraendert');
  ok(L.g.errors === 0, 'g.errors 0');
});

// ---------------------------------------------------------------- (k) Nacharbeit Review
await section('(k) Nacharbeit: Abgabe am Boden, zwei rettung-Beats, Laden zwischen Abgaben, Fehlerzahl', async () => {
  // 1: nur eine Abgabe an einer Station bringt ende abgegeben (am Landepunkt abgesetzt: die Person steht wieder am Ort, der Beat laeuft weiter)
  const A = await aufbau({ art: 'schiff', parameter: { ende: ABGEGEBEN, anzahl: 1 } });
  aufnehmen(A, A.id, 1);
  const orig = Fracht.stationOrt;
  Fracht.stationOrt = () => ({ ok: false, reason: 'Hier ist keine Station (Test: Sektor ohne Station)' });
  const aeA = []; const meA = A.g.missionEvent.bind(A.g); A.g.missionEvent = (nm, d) => { if (nm === 'personAbgegeben') aeA.push(d); return meA(nm, d); };
  let errA; try { errA = abgeben(A, PB.personenAnBord(A.g)[0].id); } finally { Fracht.stationOrt = orig; }
  A.run(1);
  ok(errA === null && aeA.length === 1 && aeA[0].abgabe === 'boden', 'Abgabe ohne Station: das Ereignis traegt abgabe boden (' + JSON.stringify(aeA.map((d) => d.abgabe)) + ')');
  ok(A.f.phase === 'laeuft' && beatId(A.f) === A.f.laufend.beat && !ereignisse(A.f).includes('rettung_gelungen'), 'am Landepunkt abgesetzt: der Beat gilt NICHT als gelungen (laeuft weiter)');
  ok(offene(A.g, A.id).length === 1 && PB.personenAnBord(A.g).length === 0, 'die abgesetzte Person steht wieder am Ort und ist nicht im Lager');
  ok(aufnehmen(A, A.id, 1).length === 0 && PB.personenAnBord(A.g).length === 1 && A.f.phase === 'laeuft', 'sie laesst sich wieder aufnehmen (Beat laeuft, ende abgegeben)');
  zurStation(A);
  ok(abgeben(A, PB.personenAnBord(A.g)[0].id) === null && A.f.phase === 'wartet' && ereignisse(A.f).includes('rettung_gelungen') && aeA[aeA.length - 1].abgabe === 'station', 'Gegenprobe: Abgabe an der Station gelingt (abgabe station)');
  ok(A.g.errors === 0, 'g.errors 0 (1)');
  // 2: zwei rettung-Beats in einem Faden: eigene Kennungen je Beat
  const p2 = { format: 'faden-bauplan/1', titel: 'Schiffbruch im Sektor', anlass: 'Ein Schiff ist gestrandet und Menschen warten auf Hilfe.',
    landeplaetze: [{ id: 'absturz', art: 'schiff', besitz: 'herrenlos', name: 'Absturzstelle' }],
    beats: [{ id: 'r1', typ: 'rettung', parameter: { landeplatz: 'absturz', anzahl: 1 }, verzweigung: { gescheitert: 'ende' } }, { id: 'r2', typ: 'rettung', parameter: { landeplatz: 'absturz', anzahl: 1 }, verzweigung: { gescheitert: 'ende' } }, { id: 'ende', typ: 'abschluss' }] };
  const B2 = await aufbau({ plan: p2 });
  aufnehmen(B2, B2.id, 1);
  ok(B2.f.phase === 'wartet' && beatId(B2.f) === 'r2', 'zwei Beats: r1 gelungen, r2 ist der naechste');
  ok(beatStarten(B2.g, B2.f), 'r2 gestartet'); B2.run(0.2);
  ok(B2.f.phase === 'laeuft' && B2.f.laufend.beat === 'r2' && ereignisse(B2.f).filter((e) => e === 'rettung_gelungen').length === 1, 'r2 gelingt nicht sofort (nur ein rettung_gelungen im Gedaechtnis)');
  const o2 = offene(B2.g, B2.id);
  ok(o2.length === 1 && o2[0].person === `${B2.f.id}.r2.u1` && PB.personenAnBord(B2.g)[0].id === `${B2.f.id}.r1.u1`, 'r2 hat eine eigene Person ' + (o2[0] && o2[0].person) + ' (im Lager liegt ' + PB.personenAnBord(B2.g).map((q) => q.id).join(',') + ')');
  aufnehmen(B2, B2.id, 1);
  ok(B2.f.phase === 'wartet' && beatId(B2.f) === 'ende' && ereignisse(B2.f).filter((e) => e === 'rettung_gelungen').length === 2 && B2.g.errors === 0, 'r2 endet erst mit ihrer eigenen Aufnahme gelungen');
  // 3: Speichern und Laden zwischen zwei Abgaben (die Abgabe setzt markSaveDue): nichts geht verloren, nichts steht wieder am Wrack
  const C = await aufbau({ art: 'schiff', parameter: { ende: ABGEGEBEN, anzahl: 2 } });
  aufnehmen(C, C.id, 2);
  zurStation(C);
  const ids = PB.personenAnBord(C.g).map((q) => q.id);
  ok(abgeben(C, ids[0]) === null && C.f.phase === 'laeuft', 'eine von zwei abgegeben: der Beat laeuft');
  const data = JSON.parse(JSON.stringify(Weltstand.capture(C.g)));
  ok(Weltstand.validate(data, C.g).filter((x) => /fracht|faeden/.test(String(x))).length === 0, 'Stand zwischen den Abgaben ist schemagueltig');
  const sf = data.welt.sim.faeden.liste.find((x) => x.id === C.f.id);
  ok(sf && sf.laufend && JSON.stringify(sf.laufend.uebergeben) === JSON.stringify([ids[0]]) && sf.laufend.aufgenommen.length === 2, 'f.laufend traegt die abgegebene und die aufgenommenen Kennungen im Weltstand');
  const C2 = spiel(); Weltstand.apply(C2.g, JSON.parse(JSON.stringify(data)));
  C2.p = C2.g.players[0]; C2.f = C2.g.weltsim.faeden.liste.find((x) => x.id === C.f.id); C2.id = C.id;
  ok(C2.f && C2.f !== C.f && JSON.stringify(C2.f.laufend.uebergeben) === JSON.stringify([ids[0]]), 'nach dem Laden (Weltstand.apply) steht die Abgabe im neuen Faden-Objekt');
  hierHin(C2, STATION); LP.get(C2.g, C.id); C2.run(1); await tick(4);
  ok(C2.f.phase === 'laeuft' && offene(C2.g, C.id).length === 0, 'die abgegebene Person steht nicht wieder am Wrack, die im Lager auch nicht (' + offene(C2.g, C.id).length + ' am Ort)');
  C2.p.console = 'weapons'; zurStation(C2);   // die Ops (Waffen-Konsole) gibt ab
  ok(abgeben(C2, PB.personenAnBord(C2.g)[0].id) === null && C2.f.phase === 'wartet' && ereignisse(C2.f).includes('rettung_gelungen'), 'nach dem Laden die zweite abgegeben: der Beat ist gelungen');
  ok(C2.g.errors === 0, 'g.errors 0 (3)');
  // 5: ein volles Personenkontingent der Karte meldet einmal je Person, nicht je Tick; das Nachsetzen versucht es weiter
  const D5 = await aufbau({ art: 'schiff', parameter: { anzahl: 3 } });
  const aw5 = D5.g.aways[D5.id], vor5 = D5.fehler.length;
  aw5.npcs = aw5.npcs.filter((q) => !String(q.person).startsWith(D5.f.id));
  for (let i = 0; i < CONFIG.personen.maxGleichzeitig; i++) away.spawnPersonDazu(D5.g, D5.id, { x: 5, y: 5 }, { person: 'fremd' + i, name: 'F' + i });
  D5.run(2);
  const fehlerN = D5.fehler.length - vor5;
  ok(fehlerN >= 1 && fehlerN <= 3, 'Karte voll: hoechstens ein Fehler je Person in 2 s (' + fehlerN + ', nicht je Tick)');
  aw5.npcs = aw5.npcs.filter((q) => !String(q.person).startsWith('fremd'));
  D5.run(1);
  ok(offene(D5.g, D5.id).length === 3, 'Platz wieder frei: das Nachsetzen stellt alle drei (' + offene(D5.g, D5.id).length + ')');
});

// ---------------------------------------------------------------- (j)
await section('(j) Grep-Test: keine Zahl und kein Name aus den Daten im Servercode', async () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'faden-rettung.js'), 'utf8');
  const werte = [].concat(enden, WERTE.anker_rollen.wert, [WERTE.ende_standard.wert]);
  for (const v of Object.values(NAMEN)) werte.push(...v.vornamen, ...v.nachnamen);
  const worte = Array.from(new Set(werte.filter((w) => String(w).length >= 3)));
  const literale = (code.split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/.*$/, '')).join('\n').match(/'[^'\n]*'|`[^`\n]*`|"[^"\n]*"/g) || []).join('\n');   // Textliterale des Codes (ohne Kommentare): dort darf kein Wert der Daten stehen
  const treffer = worte.filter((w) => new RegExp('\\b' + w + '\\b', 'i').test(literale));
  ok(treffer.length === 0, 'faden-rettung.js nennt kein Ende, keine Ankerrolle und keinen Namen aus den Daten' + (treffer.length ? ': gefunden ' + treffer.join(', ') : ''));
  const zahlen = code.split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\/\/.*$/, '')).filter((l) => (l.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '').match(/(?<![\w.$])\d+(\.\d+)?\b/g) || []).some((z) => z !== '0' && z !== '1'));
  ok(zahlen.length === 0, 'faden-rettung.js enthaelt im Code (ohne Kommentare und Texte) keine Zahlenliterale ausser 0 und 1' + (zahlen.length ? ': ' + zahlen.slice(0, 2).join(' | ') : ''));
  const fd = fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'faden.js'), 'utf8').split('\n').filter((l) => /ueberlebendeNamen|ueberlebende:/.test(l)).join('\n');
  ok(!/\b(rom|ger|kon)\b\s*:/.test(fd) && !/'(Lucius|Bjarne|Kasimir)'/.test(fd), 'faden.js: ueberlebendeNamen nennt kein Volk und keinen Namen');
  ok(Rettung.datenFehler().length === 0, 'datenFehler leer');
  // Gegenproben der Daten: ein kaputter Wert wird gemeldet
  const rw = Rettung.WERTE, rt = Rettung.TEXTE;
  const alt = rw.anzahl_max.wert; rw.anzahl_max.wert = CONFIG.personen.maxGleichzeitig + 1;
  const f1 = Rettung.datenFehler(); rw.anzahl_max.wert = alt;
  ok(f1.some((x) => /maxGleichzeitig/.test(x)), 'anzahl_max ueber CONFIG.personen.maxGleichzeitig wird gemeldet');
  const t0 = rt.rettung_gelungen; rt.rettung_gelungen = 'Hallo {spieler}';
  const f2 = Rettung.datenFehler(); rt.rettung_gelungen = t0;
  ok(f2.some((x) => /Platzhalter \{spieler\}/.test(x)), 'ein unbekannter Platzhalter im Text wird gemeldet');
  const t1 = rt.rettung_gelungen; rt.rettung_gelungen = 'x'.repeat(rw.text_max.wert + 1);
  const f3 = Rettung.datenFehler(); rt.rettung_gelungen = t1;
  ok(f3.some((x) => /Zeichen/.test(x)), 'ein zu langer Text wird gemeldet');
  ok(Rettung.datenFehler().length === 0, 'danach wieder alles stimmig');
});

console.log(`\n${n - fails}/${n} ok`);
if (fails) { console.log('FEHLER: ' + fails); process.exit(1); }
console.log('test-faden-rettung: alles ok');
})().catch((e) => { console.error(e); process.exit(2); });
