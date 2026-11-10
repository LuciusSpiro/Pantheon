#!/usr/bin/env node
'use strict';
// DYN-01 B: Landeplaetze im Plan des Abenteuer-Komponisten (Plan-Feld landeplaetze, Beat-Parameter landeplatz). Echte Game-Klasse, Freie Fahrt (sund_frei), Abenteuer aus einem Bauplan, Landen wie im Spiel
// (chooseLandepunkt, away.canBeam/executeBeam, Lpscan.markieren), Speichern/Laden ueber Weltstand.capture/apply. Module: server/sim/abenteuer-orte.js (platzBestellen, beatStarten, grundAmHex), faden-pruefer.js
// (pruefeLandeplaetze), faden-bauplan.js (Expander), faden.js (Haken in weiterSetzen, anbietenMit, abenteuerOeffnen). Daten: content/welt/abenteuer-orte.json, planeten-eignung.json, content/faeden/beats.json.
// Faelle: 1 Plan -> Beat-Start -> Ort (Planet ohne Standardplatz), Landung, Faden-Ende -> restlos weg; 1a unpassende Kartenart abgelehnt (Klartext); 1b Speichern/Laden mitten im Faden;
// 2 alle fuenf Kartenarten; 3 Pruefer-Fehler je Regel; 4 zwei Beats teilen einen Platz; 5 Hex ohne passenden Koerper beim Beat-Start; 6 Prompt, Kontext, Mock ohne Landeplaetze.
// Mutationsproben: tools/mutation-abenteuer-landeplaetze.js (npm run test:abenteuer-landeplaetze-mutation).
// Aufruf: node tools/test-abenteuer-landeplaetze.js
const assert = require('assert');
const crypto = require('crypto');
const CONFIG = require('../shared/config.js');
const Sektoren = require('../shared/sektoren.js');
const Locations = require('../shared/locations.js');
const W = require('../server/world.js');
const space = require('../server/sim/space.js');
const away = require('../server/sim/away.js');
const LP = require('../server/sim/landepunkte.js');
const Lpscan = require('../server/sim/lpscan.js');
const Faden = require('../server/sim/faden.js');
const FD = require('../server/sim/faden-daten.js');
const P = require('../server/sim/faden-pruefer.js');
const AO = require('../server/sim/abenteuer-orte.js');
const AP = require('../server/sim/abenteuer-prompt.js');
const Weltstand = require('../server/weltstand.js');
const F = require('./regie-fixture.js');

const ENV = { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', REISE_EREIGNISSE: '1' };
let fehler = 0, n = 0;
const pruefe = async (name, f) => { n++; try { await f(); console.log('✓ ' + name); } catch (e) { fehler++; console.log('✗ ' + name + ': ' + e.message); } };
const tick = (k) => new Promise((r) => { let i = 0; const s = () => (++i >= (k || 3) ? r() : setImmediate(s)); setImmediate(s); });   // Vorbau laeuft ueber setImmediate

// ---- Spiel, Plan, Faden ----
function spiel() {
  const T = F.neuesSpiel({ crew: 1, seed: 7, env: ENV });
  T.run = (sek) => { for (let k = 0; k < Math.round(sek * CONFIG.tickHz); k++) T.g.step(); };
  T.p = T.g.players[0];
  T.fehler = [];
  T.g.countError = (wo, e) => { T.fehler.push(wo + ': ' + (e && e.message)); };   // gezaehlt statt gedruckt: jeder Fall prueft T.fehler
  return T;
}
// Plan: beat 1 ist eine Bitte (Annehmen/Ablehnen, Ablehnen springt zum Abschluss), dann je ein Notruf je Eintrag in nutzer; nutzer[i] = Landeplatz-Id des Beats i (undefined = ohne Landeplatz)
const plan = (lp, nutzer, extra) => {
  nutzer = nutzer || (lp || []).map((p) => p.id).slice(0, 1);
  const beats = [{ typ: 'bitte', optionen: true, verzweigung: { gescheitert: 'ende' } }];
  if (nutzer[0] !== undefined) beats[0].parameter = { landeplatz: nutzer[0] };
  for (const id of nutzer.slice(1)) beats.push(id === undefined ? { typ: 'notruf' } : { typ: 'notruf', parameter: { landeplatz: id } });
  if (beats.length < 2) beats.push({ typ: 'notruf' });
  beats.push({ id: 'ende', typ: 'abschluss' });
  const p = { format: 'faden-bauplan/1', titel: 'Absturz im Sektor', anlass: 'Ein Schiff ist abgestuerzt und niemand weiss warum.', beats };
  if (lp) p.landeplaetze = lp;
  return Object.assign(p, extra || {});
};
const WILD = { id: 'absturz', art: 'wildnis', besitz: 'herrenlos', name: 'Absturzstelle' };
const grenzen = (g, k) => { for (let i = 0; i < k; i++) g.lageGrenze('andocken'); };
const anbieten = (g, hex, p) => { Faden.zustandVon(g).abenteuerAngebote = []; return Faden.abenteuerAnbieten(g, p, { hex }); };
function oeffnen(g, hex, p) {   // Abenteuer anbieten und annehmen -> Faden (Phase wartet), noch KEIN Ort
  const a = anbieten(g, hex, p);
  assert.ok(a.ok, 'Angebot: ' + (a.fehler || []).join('; '));
  const r = Faden.abenteuerOeffnen(g, a.angebot.nr, {});
  assert.ok(r.ok, 'Oeffnen: ' + r.grund);
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
function beenden(g, f) {   // Beat 1 abgelehnt (gescheitert, Weg zum Abschluss), Abschluss gestartet: der Faden ist zu Ende
  Faden.optionWaehlen(g, f.id, 'ablehnen');
  assert.ok(beatStarten(g, f), 'Abschluss startet'); grenzen(g, 1);
  assert.strictEqual(f.phase, 'abgeschlossen');
}
const hierHin = (T, ort) => { space.enterScene(T.g, ort, { docked: false }); T.run(0.3); };
const stehen = (T, x, y) => { const s = T.g.ship; s.docked = false; s.dockedAt = null; s.x = x; s.y = y; s.vx = 0; s.vy = 0; s.speed = 0; if (s.helm) { s.helm.thrust = 0; s.helm.turn = 0; } T.run(0.2); };
const dyn = (g) => Object.keys((g.landepunkte && g.landepunkte.dyn) || {}).filter((id) => AO.parse(id));
const beamVon = (g, id) => LP.info(g, id).beam;
const logbuch = (g) => (g.lageRegie ? g.lageRegie.log.entries : []);
// Was nach dem Abraeumen von einem Ort uebrig sein koennte -> Liste der Funde (leer = restlos weg)
function reste(g, id) {
  const S = g.landepunkte || { dyn: {}, eintraege: {}, lru: [], halten: {}, ausstehend: {} };
  const r = [];
  if (S.dyn[id]) r.push('dyn'); if (S.eintraege[id]) r.push('eintraege'); if (S.lru.includes(id)) r.push('lru');
  if (id in S.halten) r.push('halten'); if (id in S.ausstehend) r.push('ausstehend');
  if (g.aways[id]) r.push('aways'); if (W.AWAY_MAPS[id]) r.push('AWAY_MAPS'); if (g.away && g.away.map === id) r.push('away.map');
  if (g.transferZiel && g.transferZiel.lp === id) r.push('transferZiel');
  if (g.explore.lpScan.has(id)) r.push('lpScan'); if (LP.cacheHat(id)) r.push('KARTEN_CACHE');
  if (g.mapResets && id in g.mapResets) r.push('mapResets');
  for (const p of g.players) { if (p.planSent && id in p.planSent) r.push('planSent'); if (typeof p.awayKv === 'string' && p.awayKv.startsWith(id + '@')) r.push('awayKv'); if (p.awayEnth && id in p.awayEnth) r.push('awayEnth'); }
  if (LP.liste(g, id.split('.')[0]).some((x) => x.id === id)) r.push('liste');
  const data = Weltstand.capture(g);
  if (JSON.stringify(data).includes(id)) r.push('Weltstand');
  if (JSON.stringify(data.welt.sim.faeden || {}).includes('"orte"')) r.push('faden.orte');
  return r;
}
function spurenSetzen(g, id) {   // Seed-Spuren, die verwerfen() nicht loest: so setzt das Spiel sie im Betrieb
  g.mapResets = g.mapResets || {}; g.mapResets[id] = 2;
  for (const p of g.players) { (p.planSent || (p.planSent = {}))[id] = true; p.awayKv = id + '@1'; (p.awayEnth || (p.awayEnth = {}))[id] = { ep: -1, n: 0 }; }
}
const kartenHash = (g, id) => crypto.createHash('sha1').update(JSON.stringify(LP.karte(g, id))).digest('hex').slice(0, 12);
const runter = (T, id) => { const g = T.g; stehen(T, beamVon(g, id).x + 20, beamVon(g, id).y); assert.strictEqual(g.chooseLandepunkt(T.g.players[0], id), null, 'chooseLandepunkt'); assert.deepStrictEqual(away.canBeam(g, 'down'), { ok: true }, 'canBeam'); away.executeBeam(g, g.players.map((p) => p.id), 'down'); T.run(0.5); };
const hoch = (T) => { away.executeBeam(T.g, T.g.players.map((p) => p.id), 'up'); T.run(0.5); };
const FREI = 200;   // ein Raumpunkt-Ort liegt mindestens so weit vom Rand jedes Planeten, Sterns und der Station (Beam-Reichweite am Punkt 300): hier fest, damit eine Aenderung der Daten auffaellt
const idVon = (ort, f, platz) => AO.idVon(ort, f.id, platz);

// Karte: Skjaldborg (hex 0904): Planet 0 ozean, Planet 1 wueste (wildnis, aussenposten), kein Standard-Landeplatz; Kaupangr (0905): zwei Fels-Planeten (wildnis, hoehle); Ostia Nova (0305): nur ozean;
// Gasfeld (0503): nur ein Gasriese
const SK = 'skjaldborg', SK_HEX = '0904', KA = 'kaupangr', KA_HEX = '0905', OSTIA_HEX = '0305', GAS_HEX = '0503';

// Anbieten abgelehnt mit dem Code (der Grund beginnt mit 'CODE:') und einem Klartext, der `muster` enthaelt
function abgelehnt(g, hex, p, code, muster, was) {
  const r = anbieten(g, hex, p);
  assert.strictEqual(r.ok, false, was + ': wird abgelehnt');
  assert.ok(r.grund.startsWith(code + ':'), `${was}: Code ${code} erwartet, bekam "${r.grund}"`);
  if (muster) assert.ok(muster.test(r.grund), `${was}: Klartext "${r.grund}" nennt ${muster}`);
  assert.ok(logbuch(g).some((e) => e.art === 'faden_pruefung' && e.ausgang === 'abgelehnt' && (e.fehler || []).some((x) => x.startsWith(code))), was + ': steht im Regie-Logbuch');
  return r;
}

(async () => {
  await pruefe('Vorbedingung: Beats bitte und notruf deklarieren landeplatz (Daten), Skjaldborg hat keinen Standard-Landeplatz, die Eignung am Hex folgt den Daten', () => {
    const B = FD.BEATS;
    for (const t of ['bitte', 'notruf']) assert.ok(B[t].parameter.optional.includes('landeplatz') && B[t].bauplan.parameter.landeplatz.erlaubt === 'landeplatz', t + ' deklariert landeplatz');
    assert.deepStrictEqual(Object.keys(B).filter((t) => B[t].parameter && B[t].parameter.optional.includes('landeplatz')).sort(), ['bitte', 'notruf']);
    const T = spiel(); assert.strictEqual(Sektoren.hexVonOrt(SK), SK_HEX); assert.strictEqual((LP.defs().orte[SK] || []).length, 0); assert.strictEqual(LP.liste(T.g, SK).length, 0);
    assert.deepStrictEqual(AO.moeglicheArten(SK_HEX), ['wildnis', 'schiff', 'aussenposten', 'station']);
    assert.deepStrictEqual(AO.moeglicheArten(KA_HEX), ['wildnis', 'hoehle', 'schiff', 'station']);
    assert.deepStrictEqual(AO.moeglicheArten(OSTIA_HEX), ['schiff', 'station']);
    assert.deepStrictEqual(AO.moeglicheArten('9999'), []); assert.deepStrictEqual(AO.moeglicheArten(undefined), []);
    const v = FD.vorlage(oeffnen(T.g, SK_HEX, plan([WILD])).vorlage);
    assert.deepStrictEqual(v.landeplaetze, [WILD]); assert.strictEqual(v.beats[0].parameter.landeplatz, 'absturz'); assert.ok(!('landeplatz' in (v.beats[1].parameter || {})));
  });

  // ---------------- 1) Plan -> Beat-Start -> Ort -> Landung -> Ende ----------------
  await pruefe('1) Plan mit Landeplatz auf einem Planeten ohne Standardplatz: Pruefer ok, KEIN Ort bei Annahme, Ort entsteht beim Start des Beats (lazy), Crew waehlt, beamt runter und hoch, Faden-Ende -> restlos weg', async () => {
    const T = spiel(), g = T.g; hierHin(T, SK);
    const f = oeffnen(g, SK_HEX, plan([WILD]));
    assert.deepStrictEqual(dyn(g), [], 'bei Annahme entsteht noch kein Ort'); assert.ok(!f.orte, 'keine Bestellung bei Annahme');
    assert.ok(beatStarten(g, f), 'Beat 1 laeuft');
    const id = idVon(SK, f, 'absturz');
    assert.deepStrictEqual(dyn(g), [id], 'genau ein Ort, ID nach Vertrag <ort>.<faden>-ort-<platz>'); assert.strictEqual(AO.landeplatzVon(g, f.id, 'absturz'), id);
    assert.deepStrictEqual(LP.info(g, id).art, 'wildnis'); assert.strictEqual(LP.eintrag(g, id).besitz, 'herrenlos'); assert.strictEqual(g.landepunkte.dyn[id].name, 'Absturzstelle');
    const pl = Locations.get(SK).scene.planeten[1]; assert.strictEqual(pl.art, 'wueste');
    assert.deepStrictEqual(beamVon(g, id), { x: Math.round(pl.x), y: Math.round(pl.y), range: Math.round(pl.r + AO.DATEN.koerper.beam_zuschlag) }, 'der Ort liegt am Wuestenplaneten (der Ozean davor taugt nicht)');
    assert.ok(logbuch(g).some((e) => e.art === 'faden_ereignis' && e.ausgang === 'beat_start'), 'Beat lief');
    await tick(5); assert.ok(LP.cacheHat(id), 'vorgebaut'); Lpscan.markieren(g, id);
    runter(T, id);
    assert.strictEqual(T.p.zone, 'away'); assert.strictEqual(g.away.map, id); assert.ok(W.AWAY_MAPS[id].karte.rows.length, 'Karte hat Gelaende'); spurenSetzen(g, id); g.landepunkte.halten[id] = 'm1';
    hoch(T); assert.strictEqual(T.p.zone, 'ship');
    assert.ok(g.transferZiel && g.transferZiel.lp === id && g.away.map === id, 'ohne Aufraeumen blockiert das den Ort');
    beenden(g, f);
    assert.deepStrictEqual(reste(g, id), [], 'restlos weg direkt nach dem Abschluss'); assert.strictEqual(AO.landeplatzVon(g, f.id, 'absturz'), null);
    T.run(0.5); assert.deepStrictEqual(reste(g, id), []); assert.strictEqual(g.chooseLandepunkt(T.p, id), 'Landepunkt unbekannt.');
    assert.deepStrictEqual(T.fehler, [], 'keine gezaehlten Fehler');
  });

  // ---------------- 1a) unpassende Kartenart ----------------
  await pruefe('1a) unpassende Kartenart wird vom Pruefer abgelehnt (LANDEPLATZ_ART mit Klartext der Eignung): Hoehle an Wueste, Wildnis am Ozean/Gasriesen, Aussenposten an Fels; Station/Schiff gehen am Raumpunkt', async () => {
    const T = spiel(), g = T.g;
    abgelehnt(g, SK_HEX, plan([{ id: 'h', art: 'hoehle' }]), 'LANDEPLATZ_ART', /Planetenart 'wueste' .*erlaubt: wildnis\/aussenposten/, 'Hoehle an Wueste');
    abgelehnt(g, KA_HEX, plan([{ id: 'a', art: 'aussenposten' }]), 'LANDEPLATZ_ART', /Planetenart 'fels' .*erlaubt: wildnis\/hoehle/, 'Aussenposten an Fels');
    abgelehnt(g, OSTIA_HEX, plan([WILD]), 'LANDEPLATZ_ART', /Planetenart 'ozean' .*keine Landung am Koerper/, 'Wildnis am Ozean');
    abgelehnt(g, GAS_HEX, plan([WILD]), 'LANDEPLATZ_ART', /Planetenart 'gasriese'/, 'Wildnis am Gasriesen');
    abgelehnt(g, OSTIA_HEX, plan([{ id: 'h', art: 'hoehle' }]), 'LANDEPLATZ_ART', /am Raumpunkt gehen schiff\/station/, 'Hoehle am Ozean nennt die Raumpunkt-Arten');
    for (const art of ['schiff', 'station']) for (const hex of [OSTIA_HEX, GAS_HEX, SK_HEX]) { const r = anbieten(g, hex, plan([{ id: 'r', art }])); assert.ok(r.ok, `${art} am Raumpunkt von ${hex}: ` + (r.grund || '')); }
    // Station am Planeten: sie ist eine Raumpunkt-Art und geht ueberall, wo es eine Szene gibt; ohne Szene (kein Sektor) kommt der Klartext des Prueferst
    assert.ok(/kein Sektor der Karte mit Szene/.test(P.pruefeLandeplaetze(g, FD.vorlage(oeffnen(spiel().g, SK_HEX, plan([{ id: 's', art: 'station' }])).vorlage), '9999')), 'station an einem Hex ohne Szene');
    assert.ok(/ist kein Sektor/.test(AO.grundAmHex('9999', 'station')) && AO.grundAmHex(SK_HEX, 'station') === null && /Planetenart 'ozean'/.test(AO.grundAmHex(OSTIA_HEX, 'wildnis')));
    // das Angebot kann veralten: der Hex gilt beim Oeffnen noch einmal (Haken in abenteuerOeffnen)
    const a = anbieten(g, SK_HEX, plan([WILD])); assert.ok(a.ok); a.angebot.hex = OSTIA_HEX;
    const r = Faden.abenteuerOeffnen(g, a.angebot.nr, {}); assert.strictEqual(r.ok, false); assert.ok(r.grund.startsWith('LANDEPLATZ_ART:'), r.grund);
    assert.deepStrictEqual(dyn(g), []);
  });

  // ---------------- 1b) Speichern und Laden mitten im Faden ----------------
  await pruefe('1b) Speichern/Laden mit offenem Ort: Plan mit Landeplaetzen im Stand, gleicher Ort (ID, Karten-Hash, Seed), Weltstand schemagueltig; nach Faden-Ende, Speichern, Laden und Neustart keine Spur', async () => {
    const T = spiel(), g = T.g; hierHin(T, SK);
    const f = oeffnen(g, SK_HEX, plan([WILD])); assert.ok(beatStarten(g, f));
    const id = idVon(SK, f, 'absturz'); await tick(6); Lpscan.markieren(g, id);
    const hash = kartenHash(g, id), seed = g.landepunkte.dyn[id].seed;
    const data = JSON.parse(JSON.stringify(Weltstand.capture(g)));
    assert.deepStrictEqual(Weltstand.validate(data, g), [], 'schemagueltig'); assert.ok(!(id in data.welt.landepunkte), 'der Ort selbst steht nicht im Stand');
    const fd = data.welt.sim.faeden.liste[0]; assert.deepStrictEqual(fd.plan.landeplaetze, [WILD], 'der Plan traegt die Landeplaetze'); assert.strictEqual(fd.orte.length, 1, 'die Bestellung (Koerper!) steht am Faden: sie bleibt (siehe Bericht)');
    const T2 = spiel(), g2 = T2.g; Weltstand.apply(g2, JSON.parse(JSON.stringify(data)));
    assert.deepStrictEqual(dyn(g2), [id], 'derselbe Ort (ID)'); assert.strictEqual(g2.landepunkte.dyn[id].seed, seed); await tick(6);
    assert.strictEqual(kartenHash(g2, id), hash, 'gleicher Karten-Hash'); assert.ok(Lpscan.gescannt(g2, id), 'Scan blieb');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(Weltstand.capture(g2))).welt.sim.faeden.liste[0], fd, 'Speichern des geladenen Spiels ergibt denselben Faden-Block');
    const f2 = Faden.zustandVon(g2).liste[0]; assert.strictEqual(f2.phase, 'laeuft'); hierHin(T2, SK);
    // im geladenen Spiel kommt der Faden an einem anderen Hex weiter (geruecht): der Platz bleibt der alte (idempotent), es entsteht kein zweiter
    assert.strictEqual(AO.platzBestellen(g2, f2.id, FD.vorlage(f2.vorlage).landeplaetze[0]), id);
    beenden(g2, f2); assert.deepStrictEqual(reste(g2, id), []);
    const data2 = JSON.parse(JSON.stringify(Weltstand.capture(g2)));
    assert.deepStrictEqual(Weltstand.validate(data2, g2), []); assert.ok(!(data2.welt.karten || []).some((k) => AO.parse(k)), 'welt.karten ohne Rest'); assert.ok(!('orte' in data2.welt.sim.faeden.liste[0]));
    const T3 = spiel(); Weltstand.apply(T3.g, data2); assert.deepStrictEqual(dyn(T3.g), [], 'Neustart: kein Ort'); assert.ok(![...T3.g.explore.lpScan].some((k) => AO.parse(k)));
    // und ein Stand OHNE Landeplaetze (Altstand) laedt unveraendert
    const T4 = spiel(); const f4 = oeffnen(T4.g, KA_HEX, plan(undefined, [undefined])); const d4 = JSON.parse(JSON.stringify(Weltstand.capture(T4.g)));
    assert.ok(!('landeplaetze' in d4.welt.sim.faeden.liste[0].plan) && !('orte' in d4.welt.sim.faeden.liste[0]), 'ohne Landeplaetze kein Feld: Altstand-Form'); void f4;
    const T5 = spiel(); Weltstand.apply(T5.g, d4); assert.strictEqual(Faden.zustandVon(T5.g).liste.length, 1);
  });

  // ---------------- 2) alle Kartenarten ----------------
  const ARTEN = [['wildnis', SK, SK_HEX, 'k'], ['hoehle', KA, KA_HEX, 'k'], ['aussenposten', SK, SK_HEX, 'k'], ['schiff', SK, SK_HEX, 'p'], ['station', SK, SK_HEX, 'p']];
  for (const [art, ort, hex, wo] of ARTEN) {
    await pruefe(`2) Kartenart ${art} (${wo === 'k' ? 'Koerper' : 'Raumpunkt'}) bis zum Aufraeumen: Plan, Beat-Start, Karte baut, Waehlen, Faden-Ende -> weg`, async () => {
      const T = spiel(), g = T.g; hierHin(T, ort);
      const f = oeffnen(g, hex, plan([{ id: 'platz', art, besitz: 'rom', name: 'Probe ' + art }])); assert.ok(beatStarten(g, f));
      const id = idVon(ort, f, 'platz'); assert.deepStrictEqual(dyn(g), [id]); await tick(5);
      assert.strictEqual(LP.eintrag(g, id).besitz, 'rom'); assert.strictEqual(g.landepunkte.dyn[id].name, 'Probe ' + art);
      const b = beamVon(g, id), sc = Locations.get(ort).scene;
      if (wo === 'p') {
        assert.strictEqual(b.range, AO.DATEN.punkt.beam_reichweite); assert.deepStrictEqual({ x: b.x, y: b.y }, AO.punktInSzene(sc), 'Position aus der Szene (Daten)');
        assert.ok(b.x > 0 && b.x < sc.w && b.y > 0 && b.y < sc.h);
        const massen = [].concat(sc.planeten, sc.stern, sc.station ? [sc.station] : []);
        for (const m of massen) assert.ok(Math.hypot(m.x - b.x, m.y - b.y) - m.r >= FREI, 'frei von ' + JSON.stringify(m));
        if (art === 'schiff') assert.strictEqual(LP.eintrag(g, id).zustand, 'verfallen', 'treibendes Wrack');
      } else {
        const i = sc.planeten.findIndex((p) => require('../server/sim/planeten-eignung.js').artPasstAmKoerper(p.art, art));
        assert.deepStrictEqual({ x: b.x, y: b.y }, { x: Math.round(sc.planeten[i].x), y: Math.round(sc.planeten[i].y) }, 'am ersten geeigneten Koerper');
      }
      assert.strictEqual(LP.waehlen(g, id, null), null, 'waehlen'); assert.strictEqual(W.AWAY_MAPS[id].karte.art, art); assert.ok(W.AWAY_MAPS[id].karte.rows.length);
      beenden(g, f); assert.deepStrictEqual(reste(g, id), []); T.run(0.5); assert.deepStrictEqual(reste(g, id), []); assert.deepStrictEqual(T.fehler, []);
    });
  }
  await pruefe('2) der Raumpunkt liegt in jeder der Szenen der Karte frei von Planeten, Sternen und Station (Daten abenteuer-orte.json punkt.lage)', () => {
    const T = spiel(); void T;
    const hexe = Object.keys(JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'content', 'welt', 'sund_frei.json'), 'utf8')).hexe);
    let szenen = 0;
    for (const h of hexe) {
      const ort = Sektoren.ortVonHex(h), l = ort && Locations.get(ort); if (!l || !l.scene) continue; szenen++;
      const sc = l.scene, p = AO.punktInSzene(sc);
      for (const m of [].concat(sc.planeten || [], sc.stern || [], sc.station ? [sc.station] : [])) assert.ok(Math.hypot(m.x - p.x, m.y - p.y) - m.r >= FREI, `${h} ${ort}: Punkt ${p.x},${p.y} zu nah an ${JSON.stringify(m)}`);
    }
    assert.ok(szenen >= 30, szenen + ' Szenen geprueft');
  });

  // ---------------- 3) Pruefer-Fehler ----------------
  await pruefe('3) Pruefer-Fehler je Regel: doppelte id, unbekannte art, drei Plaetze, Beat verweist auf unbekannte id, ungenutzter Platz, Form (besitz, name, id), unbekannte Felder (ort, seed, biom)', async () => {
    const T = spiel(), g = T.g, ok1 = (p, was) => { const r = anbieten(g, SK_HEX, p); assert.ok(r.ok, was + ': ' + (r.grund || '')); };
    ok1(plan([WILD, { id: 'zweit', art: 'aussenposten' }], ['absturz', 'zweit']), 'zwei Plaetze, zwei Beats: gueltig (orte_max ' + AO.DATEN.orte_max + ')');
    ok1(plan([WILD], ['absturz', 'absturz']), 'zwei Beats teilen einen Platz: gueltig');
    ok1(plan(undefined, [undefined]), 'ohne Landeplaetze: gueltig (Feld optional)');
    abgelehnt(g, SK_HEX, plan([WILD, { id: 'absturz', art: 'wildnis' }], ['absturz']), 'LANDEPLATZ_ID_DOPPELT', /absturz/, 'doppelte id');
    abgelehnt(g, SK_HEX, plan([{ id: 'x', art: 'ruine' }]), 'LANDEPLATZ_ART_UNBEKANNT', /ruine.*wildnis, hoehle, schiff, aussenposten, station/, 'unbekannte art');
    abgelehnt(g, SK_HEX, plan([WILD, { id: 'b', art: 'wildnis' }, { id: 'c', art: 'wildnis' }], ['absturz', 'b', 'c']), 'LANDEPLATZ_ANZAHL', /3 Landepl.*hoechstens 2|höchstens 2/, 'drei Plaetze');
    abgelehnt(g, SK_HEX, plan([WILD], ['andere']), 'LANDEPLATZ_UNBEKANNT', /andere/, 'Beat verweist auf unbekannte id');
    abgelehnt(g, SK_HEX, plan(undefined, ['absturz']), 'LANDEPLATZ_UNBEKANNT', /absturz/, 'Beat verweist auf einen Platz, den der Plan nicht hat');
    abgelehnt(g, SK_HEX, plan([WILD, { id: 'brach', art: 'wildnis' }], ['absturz']), 'LANDEPLATZ_UNBENUTZT', /brach/, 'ungenutzter Platz');
    abgelehnt(g, SK_HEX, plan([WILD], [undefined]), 'LANDEPLATZ_UNBENUTZT', /absturz/, 'Platz ohne Beat');
    abgelehnt(g, SK_HEX, plan([{ id: 'a', art: 'wildnis', besitz: 'Rom Rom' }]), 'LANDEPLATZ_FORM', /besitz/, 'besitz-Muster');
    abgelehnt(g, SK_HEX, plan([{ id: 'a', art: 'wildnis', name: '{ort} Platz' }]), 'LANDEPLATZ_FORM', /name/, 'Platzhalter im Namen');
    abgelehnt(g, SK_HEX, plan([{ id: 'a', art: 'wildnis', name: 'X'.repeat(AO.DATEN.name_max + 1) }]), 'LANDEPLATZ_FORM', /name/, 'Name zu lang');
    abgelehnt(g, SK_HEX, plan([{ id: 'a', art: 'wildnis', name: '   ' }]), 'LANDEPLATZ_FORM', /name/, 'leerer Name');
    abgelehnt(g, SK_HEX, plan([{ id: 'Gross Platz', art: 'wildnis' }], ['Gross Platz']), 'PARAMETER', /landeplatz/, 'id mit Leerzeichen (Beat-Parameter)');
    abgelehnt(g, SK_HEX, plan([{ id: 'Gross Platz', art: 'wildnis' }], [undefined]), 'LANDEPLATZ_FORM', /Landeplatz-Id/, 'id mit Leerzeichen (Plan)');
    // unbekannte Felder bleiben abgelehnt (Schema additionalProperties false)
    for (const [wo, p] of [['Plan-Feld ort', plan([WILD], undefined, { ort: SK_HEX })], ['Plan-Feld landepunkt', plan([WILD], undefined, { landepunkt: 'x' })],
      ['Platz-Feld seed', plan([Object.assign({ seed: 5 }, WILD)])], ['Platz-Feld biom', plan([Object.assign({ biom: 'wueste' }, WILD)])], ['Platz-Feld ort', plan([Object.assign({ ort: SK }, WILD)])]]) {
      const r = anbieten(g, SK_HEX, p); assert.strictEqual(r.ok, false, wo); assert.ok(/^FORM:/.test(r.grund) && /unbekanntes Feld/.test(r.grund), `${wo}: ${r.grund}`);
    }
    const pb = plan([WILD]); pb.beats[1] = { typ: 'notruf', parameter: { ort: SK_HEX } };
    const r1 = anbieten(g, SK_HEX, pb); assert.ok(!r1.ok && /^PARAMETER:/.test(r1.grund) && /"ort"/.test(r1.grund), 'Beat-Parameter ort ist nicht erlaubt: ' + r1.grund);
    const ps = plan([WILD]); ps.beats.splice(1, 0, { typ: 'spontanhilfe', parameter: { landeplatz: 'absturz' } });
    const r2 = anbieten(g, SK_HEX, ps); assert.ok(!r2.ok && /^PARAMETER:/.test(r2.grund) && /landeplatz/.test(r2.grund), 'ein Beat, der landeplatz nicht deklariert, darf ihn nicht setzen: ' + r2.grund);
    assert.strictEqual(P.pruefeLandeplaetze(g, null, SK_HEX), null); assert.strictEqual(P.pruefeLandeplaetze(g, { beats: [] }, SK_HEX), null);
    assert.strictEqual(anbieten(g, SK_HEX, plan([WILD])).ok, true, 'nach den Ablehnungen geht ein gueltiger Plan weiter durch');
  });

  // ---------------- 4) Platz teilen ----------------
  await pruefe('4) zwei Beats teilen einen Platz: der Ort entsteht einmal (ein neu(), eine Bestellung), beide Beats laufen, er bleibt bis zum Ende; platzBestellen ist idempotent', async () => {
    const T = spiel(), g = T.g; hierHin(T, SK);
    const f = oeffnen(g, SK_HEX, plan([WILD], ['absturz', 'absturz']));
    const orig = LP.neu; let neu = 0; LP.neu = (game, ort, o) => { if (o && AO.parse(o.id)) neu++; return orig(game, ort, o); };
    try {
      assert.ok(beatStarten(g, f)); const id = idVon(SK, f, 'absturz'); assert.strictEqual(neu, 1);
      assert.strictEqual(Faden.optionWaehlen(g, f.id, 'annehmen').ok, true); assert.strictEqual(f.beat, 1, 'weiter zum zweiten Beat (Notruf), er nutzt denselben Platz');
      f.parameter.ort = OSTIA_HEX;   // die Geschichte ist weitergewandert (geruecht): der Platz steht schon, der zweite Beat braucht keinen neuen Koerper
      assert.ok(beatStarten(g, f), 'Beat 2 laeuft'); assert.ok(!logbuch(g).some((e) => e.ausgang === 'landeplatz_fehlt'), 'Beat 2 scheitert nicht am Hex: der Platz ist da (landeplatzVon zuerst)'); assert.strictEqual(neu, 1, 'kein zweites neu()'); assert.deepStrictEqual(dyn(g), [id]); assert.strictEqual(f.orte.length, 1);
      assert.ok(logbuch(g).filter((e) => e.art === 'faden_ereignis' && e.ausgang === 'beat_start').length >= 2, 'beide Beats begannen');
      assert.strictEqual(AO.platzBestellen(g, f.id, FD.vorlage(f.vorlage).landeplaetze[0]), id); assert.strictEqual(neu, 1, 'idempotent');
    } finally { LP.neu = orig; }
    const id = idVon(SK, f, 'absturz'); T.run(0.3); assert.ok(g.landepunkte.dyn[id], 'lebt weiter, solange der Faden lebt');
    for (let i = 0; i < 40 && f.phase !== 'abgeschlossen'; i++) { if (f.phase === 'laeuft') { const r = Faden.beatAusgang(g, f.id, 'gelungen'); void r; } else beatStarten(g, f); grenzen(g, 1); }
    assert.strictEqual(f.phase, 'abgeschlossen'); assert.deepStrictEqual(reste(g, id), []); assert.deepStrictEqual(T.fehler, []);
  });

  // ---------------- 5) Hex ohne passenden Koerper beim Beat-Start ----------------
  await pruefe('5) die Crew ist weitergeflogen (Hex der Geschichte ohne passenden Koerper): der Beat scheitert sauber, keine Ausnahme, kein Ort, der Faden lebt weiter und endet; Plan ohne den Platz; Obergrenze', async () => {
    const T = spiel(), g = T.g; hierHin(T, SK);
    const f = oeffnen(g, SK_HEX, plan([WILD]));
    f.parameter.ort = OSTIA_HEX;   // wie geruecht/Fluchtfahrt: Ostia Nova hat nur einen Ozean
    assert.ok(beatStarten(g, f), 'der Befehl wird angenommen');
    assert.deepStrictEqual(dyn(g), [], 'kein Ort'); assert.ok(!f.orte, 'keine Bestellung'); assert.deepStrictEqual(T.fehler, [], 'keine Ausnahme gezaehlt');
    assert.strictEqual(f.phase, 'wartet'); assert.strictEqual(FD.vorlage(f.vorlage).beats[f.beat].id, 'ende', 'der Beat gilt als gescheitert (Weg des Plans: Abschluss)');
    assert.ok(logbuch(g).some((e) => e.art === 'faden_ereignis' && e.ausgang === 'landeplatz_fehlt' && /Landeplatz 'absturz' \(wildnis\)/.test(e.begruendung)), 'steht im Regie-Logbuch');
    assert.ok(logbuch(g).some((e) => e.art === 'faden_ereignis' && e.ausgang === 'beat_ende' && /gescheitert/.test(e.begruendung)));
    assert.ok(beatStarten(g, f)); grenzen(g, 1); assert.strictEqual(f.phase, 'abgeschlossen'); assert.deepStrictEqual(reste(g, idVon(SK, f, 'absturz')), []);
    // ein geladener Plan, in dem der Platz fehlt (der Pruefer laeuft beim Laden nicht in dieser Form): der Beat scheitert, nichts wirft
    const T2 = spiel(), g2 = T2.g; hierHin(T2, SK); const f2 = oeffnen(g2, SK_HEX, plan([WILD]));
    f2.plan.landeplaetze = []; assert.ok(beatStarten(g2, f2)); assert.strictEqual(f2.phase, 'wartet'); assert.deepStrictEqual(dyn(g2), []); assert.deepStrictEqual(T2.fehler, []);
    assert.ok(logbuch(g2).some((e) => e.ausgang === 'landeplatz_fehlt' && /steht nicht im Plan/.test(e.begruendung)));
    // Direktaufrufe: nie eine Ausnahme
    assert.strictEqual(AO.platzBestellen(g2, 'f99', WILD), null, 'Faden gibt es nicht'); assert.strictEqual(AO.platzBestellen(g2, f2.id, null), null); assert.strictEqual(AO.platzBestellen(g2, f2.id, { id: 'a', art: 'ruine' }), null, 'Art ausserhalb der Daten');
    const n0 = T2.fehler.length, gr = AO.beatStarten(g2, { id: 'f98', plan: { landeplaetze: [WILD] } }, { parameter: { landeplatz: 'absturz' } });
    assert.ok(/Ausnahme/.test(gr) && T2.fehler.length === n0 + 1 && /abenteuer-orte-beat/.test(T2.fehler[n0]), 'eine Ausnahme im Haken wird gezaehlt und ergibt einen Grund, sie fliegt nicht weiter: ' + gr); T2.fehler.length = n0;
    assert.strictEqual(AO.beatStarten(g2, f2, null), null); assert.strictEqual(AO.beatStarten(g2, f2, { parameter: {} }), null, 'Beat ohne Landeplatz: nichts zu tun');
    assert.strictEqual(AO.beatStarten(g2, { id: 'f99', parameter: { ort: SK_HEX }, plan: { landeplaetze: [WILD] } }, { parameter: { landeplatz: 'absturz' } }) !== null, true, 'Faden nicht in der Welt: Grund statt Ausnahme');
    // Obergrenze: ein dritter Ort (orte_max) scheitert den Beat bzw. liefert null, statt zu werfen
    const T3 = spiel(), g3 = T3.g; hierHin(T3, SK); const f3 = oeffnen(g3, SK_HEX, plan([WILD, { id: 'zwei', art: 'aussenposten' }], ['absturz', 'zwei']));
    assert.ok(beatStarten(g3, f3)); assert.strictEqual(f3.orte.length, 1);
    assert.ok(AO.platzBestellen(g3, f3.id, { id: 'zwei', art: 'aussenposten' }), 'zweiter Platz'); assert.strictEqual(f3.orte.length, AO.DATEN.orte_max);
    assert.strictEqual(AO.platzBestellen(g3, f3.id, { id: 'dritt', art: 'wildnis' }), null, 'dritter Ort: Obergrenze orte_max'); assert.strictEqual(f3.orte.length, AO.DATEN.orte_max); assert.deepStrictEqual(T3.fehler, []);
  });

  // ---------------- 5a) Ortswechsel (Review W1) ----------------
  // Plan aus Beats in der gegebenen Reihenfolge; ls = Landeplaetze, ein Beat ist { typ, platz?, id?, verzweigung? }
  const planFolge = (ls, beats) => ({ format: 'faden-bauplan/1', titel: 'Geruecht vom Lager', anlass: 'Jemand hat ein altes Lager gesehen und redet darueber.', landeplaetze: ls,
    beats: beats.map((b) => Object.assign({ typ: b.typ }, b.id ? { id: b.id } : {}, b.platz ? { parameter: { landeplatz: b.platz } } : {}, b.verzweigung ? { verzweigung: b.verzweigung } : {})) });
  const LAGER = (art) => [{ id: 'lager', art }];
  await pruefe('5a) verlegt_ort (Daten): geruecht, wiedersehen, sabotage; Katalogcheck verlangt true oder fehlt; ein Platz NACH einem solchen Beat darf nur Raumpunkt-Art sein (LANDEPLATZ_VERLEGT), davor oder auf anderem Weg gilt es nicht', async () => {
    const B = FD.BEATS;
    assert.deepStrictEqual(Object.keys(B).filter((t) => B[t].verlegt_ort !== undefined).sort(), ['geruecht', 'sabotage', 'wiedersehen']);
    for (const t of ['geruecht', 'sabotage', 'wiedersehen']) assert.strictEqual(B[t].verlegt_ort, true, t);
    assert.deepStrictEqual(P.katalogFehler(), []);
    for (const falsch of ['ja', false, 1]) { B.geruecht.verlegt_ort = falsch; try { assert.ok(P.katalogFehler().some((e) => /^KATALOG_VERLEGT_ORT/.test(e) && /geruecht/.test(e)), 'verlegt_ort=' + JSON.stringify(falsch)); } finally { B.geruecht.verlegt_ort = true; } }
    const T = spiel(), g = T.g;
    const nach = [{ typ: 'geruecht' }, { typ: 'notruf', platz: 'lager' }, { typ: 'abschluss' }];
    for (const art of ['wildnis', 'aussenposten']) abgelehnt(g, SK_HEX, planFolge(LAGER(art), nach), 'LANDEPLATZ_VERLEGT', new RegExp('lager.*geruecht.*schiff/station.*nicht ' + art), `${art} nach geruecht`);
    for (const art of ['schiff', 'station']) assert.ok(anbieten(g, SK_HEX, planFolge(LAGER(art), nach)).ok, art + ' nach geruecht geht');
    abgelehnt(g, KA_HEX, planFolge(LAGER('hoehle'), nach), 'LANDEPLATZ_VERLEGT', /hoehle/, 'hoehle nach geruecht');
    // auch ein spaeterer Beat (nicht der naechste) und jedes verlegende Beat-Typ
    abgelehnt(g, SK_HEX, planFolge(LAGER('wildnis'), [{ typ: 'geruecht' }, { typ: 'spur' }, { typ: 'notruf', platz: 'lager' }, { typ: 'abschluss' }]), 'LANDEPLATZ_VERLEGT', /geruecht/, 'geruecht, spur, notruf');
    // davor: der Platz wird bestellt, bevor der Ort wandert -> zugelassen; auf dem Weg dahinter derselbe Platz bleibt am alten Ort
    assert.ok(anbieten(g, SK_HEX, planFolge(LAGER('wildnis'), [{ typ: 'notruf', platz: 'lager' }, { typ: 'geruecht' }, { typ: 'abschluss' }])).ok, 'Beat vor dem geruecht gilt als nicht verlegt');
    assert.ok(anbieten(g, SK_HEX, planFolge(LAGER('wildnis'), [{ typ: 'notruf', platz: 'lager' }, { typ: 'geruecht' }, { typ: 'notruf', platz: 'lager' }, { typ: 'abschluss' }])).ok, 'ein davor schon bestellter Platz bleibt am alten Ort');
    // zwei Plaetze: der eine davor, der andere danach -> nur der danach zaehlt
    const zwei = [{ id: 'lager', art: 'wildnis' }, { id: 'zweit', art: 'aussenposten' }];
    abgelehnt(g, SK_HEX, planFolge(zwei, [{ typ: 'notruf', platz: 'lager' }, { typ: 'geruecht' }, { typ: 'notruf', platz: 'zweit' }, { typ: 'abschluss' }]), 'LANDEPLATZ_VERLEGT', /zweit/, 'der Platz danach');
    // Verzweigung: ein Weg ueber das geruecht genuegt (jeder moegliche Pfad)
    const verz = [{ typ: 'bitte', optionen: true, verzweigung: { gelungen: 'spaet' } }, { typ: 'geruecht' }, { typ: 'notruf', id: 'spaet', platz: 'lager' }, { typ: 'abschluss' }];
    abgelehnt(g, SK_HEX, planFolge(LAGER('wildnis'), verz), 'LANDEPLATZ_VERLEGT', /geruecht/, 'ein Weg ueber geruecht');
  });
  await pruefe('5a) Lauf: [geruecht, notruf mit schiff-Platz] gelingt in 15 Laeufen ohne landeplatz_fehlt (der Raumpunkt geht an jedem Zielhex); der Plan mit wildnis wird vorher abgelehnt', async () => {
    let fehlt = 0, ok = 0;
    for (let s = 1; s <= 15; s++) {
      const T = F.neuesSpiel({ crew: 1, seed: s, env: ENV }), g = T.g; T.fehler = []; g.countError = (wo, e) => { T.fehler.push(wo + ': ' + (e && e.message)); };
      if (g.explore && g.explore.kanteOffen) g.explore.kanteOffen = () => true;
      space.enterScene(g, SK, { docked: false }); for (let i = 0; i < 10; i++) g.step();
      const f = oeffnen(g, SK_HEX, planFolge(LAGER('schiff'), [{ typ: 'geruecht' }, { typ: 'notruf', platz: 'lager' }, { typ: 'abschluss' }]));
      assert.ok(beatStarten(g, f), 'geruecht startet'); const ziel = f.parameter.ort;
      Faden.beatAusgang(g, f.id, 'gelungen'); assert.ok(beatStarten(g, f), 'notruf startet');
      if (logbuch(g).some((e) => e.ausgang === 'landeplatz_fehlt')) { fehlt++; continue; }
      assert.strictEqual(FD.vorlage(f.vorlage).beats[f.beat].typ, 'notruf'); assert.deepStrictEqual(dyn(g), [idVon(Sektoren.ortVonHex(ziel), f, 'lager')], `Ort am Zielhex ${ziel}`); assert.deepStrictEqual(T.fehler, []); ok++;
    }
    assert.deepStrictEqual({ ok, fehlt }, { ok: 15, fehlt: 0 });
  });

  // ---------------- 6) Prompt, Kontext, Mock ----------------
  await pruefe('6) Prompt: Katalog nennt Landeplaetze und den Beat-Parameter, Kontext nennt die Kartenarten des Hex; unter prompt_max_zeichen auch mit voller Chronik; der Mock liefert weiter gueltige Plaene ohne Landeplaetze', async () => {
    const T = spiel(), g = T.g; for (let i = 0; i < 6; i++) g.step();
    const AW = require('../server/sim/abenteuer-daten.js').WERTE;
    const kat = AP.katalogText();
    assert.ok(/"landeplaetze"\?: \[Landeplatz/.test(kat) && /Landeplatz \(Ort fuer die Dauer des Abenteuers, hoechstens 2\)/.test(kat) && /nie Seed, Biom oder Besetzung/.test(kat) && /jeder Platz braucht einen Beat/.test(kat), 'Passage im Katalog');
    assert.ok(/- bitte[^\n]*landeplatz \(id\)/.test(kat) && /- notruf[^\n]*landeplatz \(id\)/.test(kat) && !/- spontanhilfe[^\n]*landeplatz/.test(kat), 'nur die deklarierenden Beats nennen den Parameter');
    const satz = /Platz erst nach geruecht \| wiedersehen \| sabotage genutzt: nur schiff \| station\./.exec(kat); assert.ok(satz && satz[0].length <= 150, 'ein Satz zum Ortswechsel im Katalog (hoechstens 150 Zeichen): ' + (satz && satz[0].length));
    const kontextVon = (pr) => JSON.parse(pr.split('<kontext>\n')[1].split('\n</kontext>')[0]);
    assert.deepStrictEqual(kontextVon(AP.baue(g, { nr: 1, grenze: 'andocken', hex: SK_HEX, letzte: [], werte: AW }).prompt).landeplatz_arten, ['wildnis', 'schiff', 'aussenposten', 'station']);
    assert.deepStrictEqual(kontextVon(AP.baue(g, { nr: 1, grenze: 'andocken', hex: OSTIA_HEX, letzte: [], werte: AW }).prompt).landeplatz_arten, ['schiff', 'station']);
    g.weltsim.chronik = g.weltsim.chronik || []; for (let i = 0; i < 30; i++) g.weltsim.chronik.push({ t: 2 + i, art: 'szene', ref: 'x' + i, kurz: 'Ereignis Nummer ' + i + ' mit etwas mehr Text damit die Zeile lang wird' });
    const voll = AP.baue(g, { nr: 1, grenze: 'andocken', hex: SK_HEX, letzte: [], werte: AW });
    assert.ok(voll.prompt && voll.zeichen <= AW.prompt_max_zeichen - 1200, `Prompt mit voller Chronik ${voll.zeichen} Zeichen laesst Luft unter ${AW.prompt_max_zeichen} (BEA-02)`);
    console.log(`    Katalog ${kat.length} Zeichen, Prompt mit voller Chronik ${voll.zeichen} von ${AW.prompt_max_zeichen}`);
    // der Mock kennt keine Landeplaetze (Feld optional): seine gueltigen Plaene gehen weiter durch Expander, Pruefer und Anbieten, ohne landeplaetze
    const Mock = require('../server/sim/abenteuer-mock.js'), Bauplan = require('../server/sim/faden-bauplan.js');
    for (let i = 0; i < 60; i++) {
      const p = Mock.gueltigerPlan(Mock.rngVon('lp' + i)), r = Bauplan.pruefe(p);
      assert.ok(r.ok, 'Mock-Plan ' + i + ': ' + r.fehler[0]); assert.ok(!('landeplaetze' in p) && !('landeplaetze' in r.vorlage), 'ohne landeplaetze');
      const h = anbieten(g, SK_HEX, p); assert.ok(h.ok || !/^LANDEPLATZ/.test(h.grund), 'Mock-Plan ' + i + ' scheitert nie an Landeplaetzen: ' + h.grund);
    }
  });

  console.log(`\n${n - fehler}/${n} Pruefungen gruen`);
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.log('✗ Absturz: ' + (e && e.stack || e)); process.exit(1); });
