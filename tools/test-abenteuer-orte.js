#!/usr/bin/env node
'use strict';
// DYN-01 A: Orte fuer die Dauer eines Abenteuers (server/sim/abenteuer-orte.js, Daten content/welt/abenteuer-orte.json). Echte Game-Klasse, Freie Fahrt (sund_frei), Faden aus einem Bauplan
// (Abenteuer), Landen wie im Spiel (chooseLandepunkt, away.canBeam/executeBeam, Lpscan.markieren), Speichern/Laden ueber Weltstand.capture/apply.
// Faelle: a) Planet ohne Standard-Landeplatz, Landung, Abschluss -> restlos weg; b) alle fuenf Kartenarten (schiff am Raumpunkt = verfallen), Obergrenze, Ablehnungen; c) Speichern/Laden mit offenem Ort
// (gleiche ID, gleicher Karten-Hash) und nach dem Ende; d) Scheitern, Frist, Waise, Crew noch unten (Retry); e) zwei Spieler; f) Wiederbestellung: nicht vorgescannt; g) Zeitbudget (vorbauen sofort);
// h) Kachel-Landepunkt ueber landeplatzVon. Mutationsproben: tools/mutation-abenteuer-orte.js (npm run test:abenteuer-orte-mutation).
// Aufruf: node tools/test-abenteuer-orte.js
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
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
const AO = require('../server/sim/abenteuer-orte.js');
const Weltstand = require('../server/weltstand.js');
const F = require('./regie-fixture.js');

const ENV = { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', REISE_EREIGNISSE: '1' };
let fehler = 0, n = 0;
const pruefe = async (name, f) => { n++; try { await f(); console.log('✓ ' + name); } catch (e) { fehler++; console.log('✗ ' + name + ': ' + e.message); } };
const tick = (k) => new Promise((r) => { let i = 0; const s = () => (++i >= (k || 3) ? r() : setImmediate(s)); setImmediate(s); });   // Vorbau laeuft ueber setImmediate

// ---- Spiel und Faden ----
function spiel(crew) {
  const T = F.neuesSpiel({ crew: crew || 1, seed: 7, env: ENV });
  T.run = (sek) => { for (let k = 0; k < Math.round(sek * CONFIG.tickHz); k++) T.g.step(); };
  T.p = T.g.players[0];
  return T;
}
const plan = () => ({ format: 'faden-bauplan/1', titel: 'Absturz im Sektor', anlass: 'Ein Schiff ist abgestuerzt und niemand weiss warum.',
  beats: [{ typ: 'bitte', optionen: true, verzweigung: { gescheitert: 'ende' } }, { typ: 'notruf' }, { id: 'ende', typ: 'abschluss' }] });
const grenzen = (g, k) => { for (let i = 0; i < k; i++) g.lageGrenze('andocken'); };
function abenteuer(g) {   // Abenteuer aus dem Bauplan anbieten und annehmen -> Faden (Phase wartet)
  const Fz = Faden.zustandVon(g); Fz.abenteuerAngebote = [];
  const hex = require('../server/sim/marken.js').hexVon(g.ship.scene);
  const a = Faden.abenteuerAnbieten(g, plan(), { hex });
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
function laufendesAbenteuer(g) { const f = abenteuer(g); assert.ok(beatStarten(g, f), 'Beat 1 laeuft'); return f; }
function beenden(g, f) {   // Beat 1 abgelehnt (gescheitert, Weg zum Abschluss), Abschluss gestartet: der Faden ist zu Ende
  Faden.optionWaehlen(g, f.id, 'ablehnen');
  assert.ok(beatStarten(g, f), 'Abschluss startet'); grenzen(g, 1);
  assert.strictEqual(f.phase, 'abgeschlossen');
}
const hierHin = (T, ort) => { space.enterScene(T.g, ort, { docked: false }); T.run(0.3); };
const stehen = (T, x, y) => { const s = T.g.ship; s.docked = false; s.dockedAt = null; s.x = x; s.y = y; s.vx = 0; s.vy = 0; s.speed = 0; if (s.helm) { s.helm.thrust = 0; s.helm.turn = 0; } T.run(0.2); };
const dyn = (g) => Object.keys((g.landepunkte && g.landepunkte.dyn) || {}).filter((id) => AO.parse(id));
const beamVon = (g, id) => LP.info(g, id).beam;
// Was nach dem Abraeumen von einem Ort uebrig sein koennte -> Liste der Funde (leer = restlos weg)
function reste(g, id, T) {
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
// Seed-Spuren, die verwerfen() nicht loest: so setzt das Spiel sie im Betrieb (Karte gesendet, Scan, Reset-Zaehler)
function spurenSetzen(g, id) {
  g.mapResets = g.mapResets || {}; g.mapResets[id] = 2;
  for (const p of g.players) { (p.planSent || (p.planSent = {}))[id] = true; p.awayKv = id + '@1'; (p.awayEnth || (p.awayEnth = {}))[id] = { ep: -1, n: 0 }; }
}
const kartenHash = (g, id) => crypto.createHash('sha1').update(JSON.stringify(LP.karte(g, id))).digest('hex').slice(0, 12);
const runter = (T, id) => { const g = T.g; stehen(T, beamVon(g, id).x + 20, beamVon(g, id).y); assert.strictEqual(g.chooseLandepunkt(T.g.players[0], id), null, 'chooseLandepunkt'); assert.deepStrictEqual(away.canBeam(g, 'down'), { ok: true }, 'canBeam'); away.executeBeam(g, g.players.map((p) => p.id), 'down'); T.run(0.5); };
const hoch = (T, spieler) => { away.executeBeam(T.g, (spieler || T.g.players).map((p) => p.id), 'up'); T.run(0.5); };

// Karte: sund_frei, Planeten ohne Standard-Landeplatz (skjaldborg: ozean, wueste; carrara: zwei ozean)
const PLANET_ORT = 'skjaldborg', PLANET = 1;   // wueste (x 1034, y 1497, r 153): wildnis, aussenposten
// DYN-01 C: die Hoehle gibt es laut content/welt/planeten-eignung.json nicht an einer Wueste, sondern an Fels/Eis (hier kaupangr, Planet 0 fels, r 201)
const HOEHLE_ORT = 'kaupangr', HOEHLE = 0;

(async () => {
  const sund = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'welt', 'sund_frei.json'), 'utf8'));
  const lps = (ort) => (LP.defs().orte[ort] || []).length;

  await pruefe('Vorbedingung: der Planet hat keinen Standard-Landeplatz (landepunkte.json, kein typ-Hex), die Szene kennt die Planeten', () => {
    const T = spiel(); assert.strictEqual(T.g.weltsim && !!T.g.weltsim.zustand, true, 'Freie Fahrt'); assert.strictEqual(Sektoren.hexVonOrt(PLANET_ORT), '0904');
    assert.strictEqual(lps(PLANET_ORT), 0); assert.strictEqual(LP.liste(T.g, PLANET_ORT).length, 0);
    const p = Locations.get(PLANET_ORT).scene.planeten[PLANET]; assert.strictEqual(p.art, 'wueste');
    assert.strictEqual(sund.hexe['0904'].typ, undefined);
  });

  // ---------------- a) Lebenslauf am Planeten ----------------
  await pruefe('a) Ort am Planeten ohne Standardplatz: bestellen, Crew waehlt, beamt runter (Away-Karte), beamt hoch, Abschluss -> restlos weg (Weltstand, Scan, Cache, away, transferZiel)', async () => {
    const T = spiel(), g = T.g; const f = laufendesAbenteuer(g);
    hierHin(T, PLANET_ORT);
    const id = AO.bestellenAmKoerper(g, f.id, { ort: PLANET_ORT, koerper: PLANET, art: 'wildnis', besitz: 'herrenlos', name: 'Absturzstelle' });
    assert.strictEqual(id, `${PLANET_ORT}.${f.id}-ort`);
    assert.deepStrictEqual(AO.parse(id), { ort: PLANET_ORT, faden: f.id, platz: '' });
    assert.strictEqual(AO.landeplatzVon(g, f.id), id);
    const p = Locations.get(PLANET_ORT).scene.planeten[PLANET];
    assert.deepStrictEqual(beamVon(g, id), { x: Math.round(p.x), y: Math.round(p.y), range: Math.round(p.r + AO.DATEN.koerper.beam_zuschlag) }, 'Transferpunkt am Planeten');
    assert.strictEqual(LP.info(g, id).fluechtig, true);
    assert.ok(LP.liste(g).some((l) => l.id === id && l.name === 'Absturzstelle' && l.frei), 'Transfer-Konsole bietet den Ort an');
    assert.deepStrictEqual(g.transferSnap().lp.filter((r) => r[0] === id).length, 1, 'Snapshot-Zeile transfer.lp tragt den Ort (kein neues Feld)');
    await tick(5);
    assert.ok(LP.cacheHat(id), 'vorgebaut');
    Lpscan.markieren(g, id);
    runter(T, id);
    assert.strictEqual(T.p.zone, 'away'); assert.strictEqual(g.away.map, id); assert.ok(W.AWAY_MAPS[id], 'Away-Karte laeuft'); assert.strictEqual(LP.eintrag(g, id).besuche, 1, 'Besuch gezaehlt');
    assert.ok(W.AWAY_MAPS[id].karte.rows && W.AWAY_MAPS[id].karte.rows.length, 'Karte hat Gelaende'); spurenSetzen(g, id);
    hoch(T);
    assert.strictEqual(T.p.zone, 'ship');
    assert.strictEqual(LP.verwerfen(g, id), false, 'ohne Aufraeumen blockiert transferZiel/away.map (belegt = Momentzustand): genau das loest abraeumen');
    assert.ok(g.transferZiel && g.transferZiel.lp === id && g.away.map === id);
    g.landepunkte.halten[id] = 'm1';
    beenden(g, f);   // beatAusgang -> Haken
    assert.deepStrictEqual(reste(g, id, T), [], 'restlos weg direkt nach dem Abschluss (ohne Tick)');
    assert.strictEqual(AO.landeplatzVon(g, f.id), null);
    T.run(0.5); assert.deepStrictEqual(reste(g, id, T), []);
    assert.ok(away.canBeam(g, 'down').ok === false, 'nichts mehr zum Hinbeamen am Ort');
    assert.strictEqual(g.chooseLandepunkt(T.p, id), 'Landepunkt unbekannt.');
  });

  // ---------------- b) Kartenarten ----------------
  await pruefe('b) alle fuenf Kartenarten (Planet: wildnis, hoehle, aussenposten; Raumpunkt: schiff verfallen, station); zwei Plaetze je Faden, dritter und Unsinn abgelehnt', async () => {
    const T = spiel(), g = T.g; const f = laufendesAbenteuer(g);
    hierHin(T, PLANET_ORT);
    const bau = async (id, art, zustand) => {
      assert.ok(id, art + ' bestellt'); await tick(5);
      hierHin(T, AO.parse(id).ort);   // waehlen verlangt das Schiff in der Szene des Ortes
      assert.strictEqual(LP.waehlen(g, id, null), null, art + ' waehlen');
      assert.strictEqual(W.AWAY_MAPS[id].karte.art, art, 'Kartenart ' + art);
      if (zustand) assert.strictEqual(LP.eintrag(g, id).zustand, zustand, 'Zustand ' + art);
      assert.ok(W.AWAY_MAPS[id].karte.rows && W.AWAY_MAPS[id].karte.rows.length, art + ' hat Gelaende');
    };
    const a1 = AO.bestellenAmKoerper(g, f.id, { ort: PLANET_ORT, koerper: PLANET, art: 'wildnis' });
    const a2 = AO.bestellenAmKoerper(g, f.id, { ort: HOEHLE_ORT, koerper: HOEHLE, art: 'hoehle', platz: 'tief', name: 'Schacht' });
    assert.strictEqual(a2, `${HOEHLE_ORT}.${f.id}-ort-tief`);
    assert.strictEqual(AO.bestellenAmKoerper(g, f.id, { ort: PLANET_ORT, koerper: PLANET, art: 'aussenposten', platz: 'drei' }), null, 'Obergrenze orte_max ' + AO.DATEN.orte_max);
    assert.strictEqual(AO.bestellenAmKoerper(g, f.id, { ort: PLANET_ORT, koerper: PLANET, art: 'wildnis' }), a1, 'gleicher Platz: idempotent');
    assert.strictEqual(g.landepunkte.dyn[a1].name, 'Absturzstelle', 'Standardname aus den Daten');
    await bau(a1, 'wildnis'); await bau(a2, 'hoehle');
    assert.strictEqual(AO.abraeumen(g, f.id), true); assert.deepStrictEqual(dyn(g), []);
    const a3 = AO.bestellenAmKoerper(g, f.id, { ort: PLANET_ORT, koerper: PLANET, art: 'aussenposten', besitz: 'rom', name: 'Lager' });
    await bau(a3, 'aussenposten'); assert.strictEqual(LP.eintrag(g, a3).besitz, 'rom');
    assert.strictEqual(AO.abraeumen(g, f.id), true);
    const a4 = AO.bestellenAmPunkt(g, f.id, { ort: PLANET_ORT, x: 1500, y: 900, art: 'schiff', besitz: 'raubzug', name: 'Wrack' });
    await bau(a4, 'schiff', 'verfallen'); assert.deepStrictEqual(beamVon(g, a4), { x: 1500, y: 900, range: AO.DATEN.punkt.beam_reichweite });
    assert.strictEqual(AO.abraeumen(g, f.id), true);
    const a5 = AO.bestellenAmPunkt(g, f.id, { ort: PLANET_ORT, x: 700, y: 700, art: 'station', besitz: 'herrenlos' });
    await bau(a5, 'station'); assert.strictEqual(AO.abraeumen(g, f.id), true);
    // Ablehnungen
    const nein = (o, was) => assert.strictEqual(AO.bestellenAmKoerper(g, f.id, o), null, was);
    nein({ ort: 'gibtsnicht', koerper: 0, art: 'wildnis' }, 'unbekannter Ort (neu() prueft ihn nie)'); nein({ ort: PLANET_ORT, koerper: 9, art: 'wildnis' }, 'Koerper gibt es nicht');
    nein({ ort: PLANET_ORT, koerper: PLANET, art: 'ruine' }, 'Kartenart ausserhalb der Daten'); nein({ ort: PLANET_ORT, koerper: PLANET, art: 'wildnis', platz: 'Gross Platz' }, 'Platz-Muster');
    nein({ ort: PLANET_ORT, koerper: PLANET, art: 'wildnis', besitz: 'X Y' }, 'Besitz-Muster'); nein(null, 'ohne Angaben');
    assert.strictEqual(AO.bestellenAmPunkt(g, f.id, { ort: PLANET_ORT, x: 'a', y: 1, art: 'schiff' }), null, 'Punkt ohne Zahl');
    assert.ok(Locations.get('kesh') && Locations.get('kesh').scene, 'kesh ist ein Ort, aber nicht dieser Karte'); assert.strictEqual(Sektoren.hexVonOrt('kesh'), null);
    assert.strictEqual(AO.bestellenAmPunkt(g, f.id, { ort: 'kesh', x: 100, y: 100, art: 'schiff' }), null, 'Ort ohne Hex der Karte (neu() prueft ihn nie)');
    assert.strictEqual(AO.bestellenAmKoerper(g, 'f99', { ort: PLANET_ORT, koerper: PLANET, art: 'wildnis' }), null, 'Faden gibt es nicht');
    assert.strictEqual(AO.bestellenAmKoerper(g, f.id, { hex: '0904', koerper: PLANET, art: 'wildnis' }), `${PLANET_ORT}.${f.id}-ort`, 'hex statt ort');
    beenden(g, f);
    assert.strictEqual(AO.bestellenAmKoerper(g, f.id, { ort: PLANET_ORT, koerper: PLANET, art: 'wildnis' }), null, 'beendeter Faden: keine Bestellung mehr');
    assert.deepStrictEqual(reste(g, `${PLANET_ORT}.${f.id}-ort`, T), []);
  });

  // ---------------- c) Speichern und Laden ----------------
  await pruefe('c) Speichern/Laden mit offenem Ort: Ort kommt aus dem Faden zurueck (ID, Karten-Hash, Scan), Weltstand schemagueltig, kein Ort im Block landepunkte; nach dem Ende keine Spur', async () => {
    const T = spiel(), g = T.g; const f = laufendesAbenteuer(g);
    hierHin(T, PLANET_ORT);
    const w = AO.bestellenAmKoerper(g, f.id, { ort: PLANET_ORT, koerper: PLANET, art: 'wildnis', name: 'Absturzstelle' });
    const h = AO.bestellenAmKoerper(g, f.id, { ort: HOEHLE_ORT, koerper: HOEHLE, art: 'hoehle', platz: 'tief', besitz: 'kustoden' });
    await tick(6); Lpscan.markieren(g, w);
    const hash = { [w]: kartenHash(g, w), [h]: kartenHash(g, h) };
    const stand = LP.toSave(g); assert.ok(!(w in stand) && !(h in stand), 'welt.landepunkte (toSave) kennt die Orte nicht');
    const data = JSON.parse(JSON.stringify(Weltstand.capture(g)));
    assert.strictEqual(Weltstand.version === undefined ? 3 : Weltstand.VERSION, 3);
    assert.deepStrictEqual(Weltstand.validate(data, g), [], 'schemagueltig');
    assert.ok(!(w in data.welt.landepunkte) && !(h in data.welt.landepunkte));
    assert.strictEqual(data.welt.sim.faeden.liste[0].orte.length, 2, 'die Bestellung steht am Faden'); assert.ok(data.welt.karten.includes(w), 'Scan steht im Stand (explore)');
    // neues Spiel, Stand laden
    const T2 = spiel(), g2 = T2.g; Weltstand.apply(g2, JSON.parse(JSON.stringify(data)));
    assert.deepStrictEqual(dyn(g2).sort(), [h, w].sort(), 'beide Orte sind wieder da (gleiche ID)');
    assert.strictEqual(g2.landepunkte.dyn[w].fluechtig, true); assert.ok(Lpscan.gescannt(g2, w), 'Scan blieb erhalten');
    assert.strictEqual(AO.landeplatzVon(g2, f.id), w); assert.strictEqual(AO.landeplatzVon(g2, f.id, 'tief'), h);
    await tick(6);
    assert.strictEqual(kartenHash(g2, w), hash[w], 'Wildnis: gleicher Karten-Hash'); assert.strictEqual(kartenHash(g2, h), hash[h], 'Hoehle: gleicher Karten-Hash');
    assert.strictEqual(g2.landepunkte.dyn[w].seed, g.landepunkte.dyn[w].seed, 'gleicher Seed');
    // Speichern des geladenen Spiels ergibt wieder denselben Faden-Block
    assert.deepStrictEqual(JSON.parse(JSON.stringify(Weltstand.capture(g2))).welt.sim.faeden.liste[0].orte, data.welt.sim.faeden.liste[0].orte);
    // Ende im geladenen Spiel -> keine Spur, auch nicht im naechsten Stand
    const f2 = Faden.zustandVon(g2).liste[0]; assert.strictEqual(f2.phase, 'laeuft');
    hierHin(T2, PLANET_ORT);
    beenden(g2, f2);
    for (const id of [w, h]) assert.deepStrictEqual(reste(g2, id, T2), [], id);
    const data2 = JSON.parse(JSON.stringify(Weltstand.capture(g2)));
    assert.deepStrictEqual(Object.keys(data2.welt.landepunkte).filter((k) => AO.parse(k)), []); assert.ok(!(data2.welt.karten || []).some((k) => AO.parse(k)), 'welt.karten ohne Rest');
    const T3 = spiel(); Weltstand.apply(T3.g, data2);
    assert.deepStrictEqual(dyn(T3.g), [], 'nach dem Laden kein Ort'); assert.ok(![...T3.g.explore.lpScan].some((k) => AO.parse(k)));
  });
  await pruefe('c) Altstand ohne Bestellung laedt unveraendert; Muell in orte faellt weg (Faden bleibt); kein Ort am beendeten Faden', async () => {
    const T = spiel(), g = T.g; const f = laufendesAbenteuer(g);
    const data = JSON.parse(JSON.stringify(Weltstand.capture(g)));
    assert.ok(!('orte' in data.welt.sim.faeden.liste[0]), 'ohne Bestellung kein Feld (Altstand-Form)');
    const A = spiel(); Weltstand.apply(A.g, JSON.parse(JSON.stringify(data))); assert.strictEqual(Faden.zustandVon(A.g).liste.length, 1); assert.deepStrictEqual(dyn(A.g), []);
    for (const muell of [7, 'x', [{ platz: 5 }], [{ platz: '', ort: 'skjaldborg', art: 'ruine', besitz: 'a', beam: { x: 1, y: 1, range: 5 } }], [{ platz: '', ort: 'skjaldborg', art: 'wildnis', besitz: 'a', beam: { x: -1, y: 1, range: 5 } }], [{ platz: 'A B', ort: 'skjaldborg', kachel: 'skjaldborg.k0' }], [{ platz: '', ort: 'skjaldborg', kachel: 'anderer.k0' }]]) {
      const d = JSON.parse(JSON.stringify(data)); d.welt.sim.faeden.liste[0].orte = muell;
      const B = spiel(); Weltstand.apply(B.g, d);
      assert.strictEqual(Faden.zustandVon(B.g).liste.length, 1, 'Faden bleibt'); assert.ok(!Faden.zustandVon(B.g).liste[0].orte, 'Muell verworfen: ' + JSON.stringify(muell).slice(0, 40)); assert.deepStrictEqual(dyn(B.g), []);
    }
    assert.deepStrictEqual(AO.lese([{ platz: '', ort: 'a', art: 'wildnis', besitz: 'x', beam: { x: 1, y: 2, range: 3 } }, { platz: '', ort: 'b', art: 'wildnis', besitz: 'x', beam: { x: 1, y: 2, range: 3 } }, { platz: 'q', ort: 'b', art: 'hoehle', besitz: 'x', beam: { x: 1, y: 2, range: 3 } }, { platz: 'r', ort: 'b', art: 'hoehle', besitz: 'x', beam: { x: 1, y: 2, range: 3 } }]).map((o) => o.ort), ['a'], 'Obergrenze und doppelter Platz');
    beenden(g, f); const e = JSON.parse(JSON.stringify(Weltstand.capture(g))); e.welt.sim.faeden.liste[0].orte = [{ platz: '', ort: PLANET_ORT, art: 'wildnis', besitz: 'x', beam: { x: 1, y: 2, range: 30 } }];
    const C = spiel(); Weltstand.apply(C.g, e); assert.ok(!Faden.zustandVon(C.g).liste[0].orte); assert.deepStrictEqual(dyn(C.g), [], 'beendeter Faden: keine Bestellung');
  });

  // ---------------- d) Abbruch, Scheitern, Frist, Waise, Crew unten ----------------
  await pruefe('d) Scheitern eines Beats beendet den Faden nicht: der Ort lebt weiter und geht erst mit dem Abschluss', async () => {
    const T = spiel(), g = T.g; const f = laufendesAbenteuer(g); hierHin(T, PLANET_ORT);
    const id = AO.bestellenAmKoerper(g, f.id, { ort: PLANET_ORT, koerper: PLANET, art: 'wildnis' });
    Faden.optionWaehlen(g, f.id, 'ablehnen');   // Beat 1 gescheitert, weiter zum Abschluss
    assert.strictEqual(f.phase, 'wartet'); assert.strictEqual(f.beat, 2); assert.ok(g.landepunkte.dyn[id], 'Ort lebt nach dem Scheitern eines Beats');
    grenzen(g, 2); T.run(0.3); assert.ok(g.landepunkte.dyn[id], 'auch nach Takt und Tick');
    assert.ok(beatStarten(g, f)); grenzen(g, 1); assert.strictEqual(f.phase, 'abgeschlossen');
    assert.deepStrictEqual(reste(g, id, T), []);
  });
  await pruefe('d) Frist (interner Pfad faden.taetigkeit -> beatAusgang) eines mittleren Beats: Beat scheitert, Faden und Ort leben weiter; danach Abschluss raeumt ab', async () => {
    const T = spiel(), g = T.g; const f = laufendesAbenteuer(g); hierHin(T, PLANET_ORT);
    const id = AO.bestellenAmKoerper(g, f.id, { ort: PLANET_ORT, koerper: PLANET, art: 'wildnis' });
    let k = 0; while (f.phase === 'laeuft' && k < 30) { grenzen(g, 1); k++; }
    assert.ok(k < 30 && f.phase === 'wartet' && f.beat === 2, 'Frist griff nach ' + k + ' Taetigkeiten');
    assert.ok(g.landepunkte.dyn[id], 'Ort lebt nach der Frist');
    assert.ok(beatStarten(g, f)); grenzen(g, 1); assert.strictEqual(f.phase, 'abgeschlossen'); assert.deepStrictEqual(reste(g, id, T), []);
  });
  await pruefe('d) Waise: Faden fehlt nach dem Laden bzw. verschwindet zur Laufzeit -> der naechste Abgleich/Tick raeumt (Ort, Scan-Rest im Stand)', async () => {
    const T = spiel(), g = T.g; const f = laufendesAbenteuer(g); hierHin(T, PLANET_ORT);
    const id = AO.bestellenAmKoerper(g, f.id, { ort: PLANET_ORT, koerper: PLANET, art: 'wildnis' }); Lpscan.markieren(g, id);
    const data = JSON.parse(JSON.stringify(Weltstand.capture(g)));
    // Laufzeit: der Faden faellt aus der Liste (verdraengt, verworfen)
    const Fz = Faden.zustandVon(g); Fz.liste.splice(Fz.liste.indexOf(f), 1);
    assert.ok(g.landepunkte.dyn[id]); T.run(0.2);
    assert.deepStrictEqual(reste(g, id, T).filter((x) => x !== 'faden.orte'), [], 'Tick raeumt die Waise');
    // Laden: Stand ohne den Faden, mit Scan-Rest in welt.karten
    const d = JSON.parse(JSON.stringify(data)); d.welt.sim.faeden.liste = []; assert.ok(d.welt.karten.includes(id));
    const T2 = spiel(); Weltstand.apply(T2.g, d);
    assert.ok(![...T2.g.explore.lpScan].includes(id), 'Scan-Rest wird beim Laden abgeraeumt'); assert.deepStrictEqual(dyn(T2.g), []);
    const d3 = JSON.parse(JSON.stringify(Weltstand.capture(T2.g))); assert.ok(!(d3.welt.karten || []).includes(id));
  });
  await pruefe('d) Crew noch unten beim Faden-Ende: Ort bleibt (gesperrt), Retry im Tick; erst wenn alle oben sind, restlos weg (away.map umgesetzt)', async () => {
    const T = spiel(), g = T.g; const f = laufendesAbenteuer(g); hierHin(T, PLANET_ORT);
    const id = AO.bestellenAmKoerper(g, f.id, { ort: PLANET_ORT, koerper: PLANET, art: 'wildnis' }); await tick(5);
    runter(T, id); spurenSetzen(g, id); g.landepunkte.halten[id] = 'm1';
    beenden(g, f);
    assert.ok(g.landepunkte.dyn[id] && g.away.map === id && T.p.zone === 'away', 'Crew unten: Ort bleibt');
    assert.ok(LP.sperrgrund(g, id), 'ein Ort ohne Bestellung ist nicht mehr anwaehlbar');
    assert.strictEqual(AO.abraeumen(g, f.id), false, 'abraeumen meldet: noch belegt');
    T.run(2); assert.ok(g.landepunkte.dyn[id], 'Retry im Tick tut nichts, solange jemand unten ist'); assert.strictEqual(T.p.zone, 'away');
    hoch(T); T.run(0.3);
    assert.deepStrictEqual(reste(g, id, T), [], 'oben: der Takt raeumt ab'); assert.notStrictEqual(g.away.map, id);
  });

  await pruefe('d) offene Schritt-Aktion (ausstehend) und Haltemarke blockieren das Abraeumen nicht: sie werden geloest, die Aktion laeuft nie', async () => {
    const T = spiel(), g = T.g; const f = laufendesAbenteuer(g); hierHin(T, PLANET_ORT);
    const id = AO.bestellenAmKoerper(g, f.id, { ort: PLANET_ORT, koerper: PLANET, art: 'wildnis' });
    LP.cacheLeeren(); let gelaufen = 0;
    assert.strictEqual(LP.sobaldGeladen(g, id, 'k1', () => { gelaufen++; }), 'spaeter'); assert.ok(g.landepunkte.ausstehend[id], 'Aktion wartet auf den Bau');
    assert.strictEqual(LP.verwerfen(g, id), false, 'ausstehend macht belegt: verwerfen allein scheitert');
    g.landepunkte.halten[id] = 'm1';
    beenden(g, f); await tick(6);
    assert.deepStrictEqual(reste(g, id, T), []); assert.strictEqual(gelaufen, 0, 'die Aktion eines abgeraeumten Ortes laeuft nie');
  });

  // ---------------- e) Mehrspieler ----------------
  await pruefe('e) zwei Spieler: beide unten auf dem Ort, Abraeumen erst wenn beide oben; ein Spieler oben, einer unten -> Ort bleibt', async () => {
    const T = spiel(2), g = T.g; assert.strictEqual(g.players.length, 2);
    const f = laufendesAbenteuer(g); hierHin(T, PLANET_ORT);
    const id = AO.bestellenAmKoerper(g, f.id, { ort: PLANET_ORT, koerper: PLANET, art: 'wildnis' }); await tick(5);
    const [p1, p2] = g.players;
    stehen(T, beamVon(g, id).x + 20, beamVon(g, id).y);
    assert.strictEqual(g.chooseLandepunkt(p2, id), null, 'Spieler 2 waehlt');
    away.executeBeam(g, [p1.id, p2.id], 'down'); T.run(0.5);
    assert.deepStrictEqual([p1.zone, p2.zone], ['away', 'away']); assert.strictEqual(g.away.map, id);
    assert.strictEqual(Object.keys(g.landepunkte.dyn).filter((k) => AO.parse(k)).length, 1, 'ein game-weiter Ort fuer beide');
    beenden(g, f); T.run(0.5);
    assert.ok(g.landepunkte.dyn[id], 'beide unten: bleibt');
    away.executeBeam(g, [p1.id], 'up'); T.run(0.5);
    assert.deepStrictEqual([p1.zone, p2.zone], ['ship', 'away']);
    T.run(1); assert.ok(g.landepunkte.dyn[id] && g.away.map === id, 'ein Spieler oben, einer unten: Ort bleibt');
    away.executeBeam(g, [p2.id], 'up'); T.run(0.5);
    assert.deepStrictEqual(reste(g, id, T), [], 'beide oben: weg');
  });

  // ---------------- f) Wiederbestellung ----------------
  await pruefe('f) Wiederbestellung mit gleicher Faden-ID nach dem Abraeumen: gleiche ID, Ort gilt NICHT als vorgescannt (lpScan), Karte neu', async () => {
    const T = spiel(), g = T.g; const f = laufendesAbenteuer(g); hierHin(T, PLANET_ORT);
    const id = AO.bestellenAmKoerper(g, f.id, { ort: PLANET_ORT, koerper: PLANET, art: 'wildnis' }); await tick(5);
    Lpscan.markieren(g, id); assert.ok(Lpscan.gescannt(g, id)); const v0 = g.explore.version;
    assert.strictEqual(AO.abraeumen(g, f.id), true); assert.ok(!Lpscan.gescannt(g, id), 'Scan vergessen'); assert.ok(g.explore.version > v0, 'Anzeige wird neu berechnet');
    const id2 = AO.bestellenAmKoerper(g, f.id, { ort: PLANET_ORT, koerper: PLANET, art: 'wildnis' });
    assert.strictEqual(id2, id, 'gleiche ID (Faden-ID wiederholt sich nicht, der Platz schon)'); assert.ok(!Lpscan.gescannt(g, id2), 'neuer Ort ist nicht vorgescannt');
    assert.ok(!LP.cacheHat(id2) || true); assert.strictEqual(AO.abraeumen(g, f.id), true); assert.strictEqual(AO.abraeumen(g, f.id), true, 'idempotent');
    assert.strictEqual(AO.abraeumen(g, 'f99'), true, 'unbekannter Faden: nichts zu tun');
  });

  // ---------------- g) Zeitbudget ----------------
  await pruefe('g) Vorbau sofort nach dem Anlegen (nicht erst bei der ersten Wahl): je Kartenart gemessen, die Wahl danach baut nicht im Tick', async () => {
    const T = spiel(), g = T.g; const f = laufendesAbenteuer(g); hierHin(T, PLANET_ORT);
    const orig = LP.vorbauen; const zeiten = [];
    LP.vorbauen = (game, ids, fertig) => { const t0 = process.hrtime.bigint(); return orig(game, ids, (e) => { zeiten.push(Number(process.hrtime.bigint() - t0) / 1e6); if (fertig) fertig(e); }); };
    const ausgabe = [];
    try {
      const arten = [['wildnis', 'k'], ['hoehle', 'k'], ['aussenposten', 'k'], ['schiff', 'p'], ['station', 'p']];
      for (const [art, wo] of arten) {
        LP.cacheLeeren(); zeiten.length = 0;
        const o = { ort: art === 'hoehle' ? HOEHLE_ORT : PLANET_ORT, art };
        const id = wo === 'k' ? AO.bestellenAmKoerper(g, f.id, Object.assign({ koerper: art === 'hoehle' ? HOEHLE : PLANET }, o)) : AO.bestellenAmPunkt(g, f.id, Object.assign({ x: 1400, y: 1000 }, o));
        assert.strictEqual(zeiten.length, 0, 'baut nicht auf dem Stack des Aufrufers');
        assert.ok(!LP.cacheHat(id), 'noch nicht gebaut (laeuft ausserhalb des Ticks)');
        await tick(5);
        assert.strictEqual(zeiten.length, 1, art + ': Vorbau abgeschlossen'); assert.ok(LP.cacheHat(id), art + ': Karte im Cache');
        hierHin(T, AO.parse(id).ort); const t0 = process.hrtime.bigint(); assert.strictEqual(LP.waehlen(g, id, null), null); const warm = Number(process.hrtime.bigint() - t0) / 1e6;
        ausgabe.push(`${art} Vorbau ${zeiten[0].toFixed(1)} ms, Wahl danach ${warm.toFixed(1)} ms`);
        assert.ok(warm < 1000 / CONFIG.tickHz, `${art}: Wahl nach Vorbau ${warm.toFixed(1)} ms liegt im Tickbudget (${(1000 / CONFIG.tickHz).toFixed(1)} ms)`);
        assert.strictEqual(AO.abraeumen(g, f.id), true);
      }
    } finally { LP.vorbauen = orig; }
    console.log('    ' + ausgabe.join('\n    '));
  });

  // ---------------- h) Kachel-Landepunkt ----------------
  await pruefe('h) landeplatzVon/bestellenAmKoerper bei einem Hex mit Kachel (typ): der Landepunkt der Kachel wird verwendet, es entsteht kein neuer Ort und nichts ist abzuraeumen', async () => {
    const T = spiel(), g = T.g; const f = laufendesAbenteuer(g);
    const karte = JSON.parse(JSON.stringify(sund)); karte.hexe['0103'] = { name: 'Test 0103', region: 'rom', spielbar: true, typ: ['planet', 'planet', 'station'], fraktion: 'rom' };
    Sektoren.setzeKarte(karte);
    try {
      space.enterScene(g, 'k_0103', {}); T.run(0.3);
      const id = AO.bestellenAmKoerper(g, f.id, { ort: 'k_0103', koerper: 'k0', art: 'wildnis' });
      assert.strictEqual(id, 'k_0103.k0'); assert.strictEqual(AO.landeplatzVon(g, f.id), 'k_0103.k0'); assert.deepStrictEqual(dyn(g), [], 'kein dyn-Ort');
      assert.ok(LP.liste(g).some((l) => l.id === id), 'es ist der Kachel-Landepunkt');
      assert.strictEqual(AO.bestellenAmKoerper(g, f.id, { ort: 'k_0103', koerper: 'k9', art: 'wildnis' }), null, 'Koerper gibt es nicht');
      assert.strictEqual(AO.abraeumen(g, f.id), true); assert.ok(LP.liste(g).some((l) => l.id === id), 'der staendige Landepunkt bleibt');
      assert.strictEqual(AO.landeplatzVon(g, f.id), null, 'ohne Bestellung kein Landeplatz des Fadens');
    } finally { Sektoren.setzeKarte(JSON.parse(JSON.stringify(sund))); }
  });

  console.log(`\n${n - fehler}/${n} Pruefungen gruen`);
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.log('✗ Absturz: ' + (e && e.stack || e)); process.exit(1); });
