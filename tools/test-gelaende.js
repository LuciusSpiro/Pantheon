#!/usr/bin/env node
'use strict';
// GEL-01 E: Kartenart wildnis, Abnahme-Nachweise in eingecheckter Form (Erzeuger shared/gen-gelaende.js, Prüfer shared/buehne.js).
//   a) Determinismus (Kriterium 1)      b) Prüfer-Sweep + unabhängige Erreichbarkeit (2, 10)   c) Prop-Regeln als Karteneigenschaften (7)
//   d) Größe und Bauzeit (5)            e) Anker-Verteilung (Regressionsschutz)
// Das Verhalten von Strauch, Wasser und Lava in der Spiellogik (Bewegung, Sicht, Schuss, Gegnerweg) prüft tools/test-kachelklassen.js und
// wird hier nicht wiederholt; hier nur, was dort fehlt (Steine o/O) und was an den GEBAUTEN Karten gelten muss.
//   node tools/test-gelaende.js            (Umgebung: SEEDS=<n> je Größe und Biom, Standard 50; VERBOSE=1)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Buehne = require('../shared/buehne.js');
const Gelaende = require('../shared/gen-gelaende.js');
const Physics = require('../shared/physics.js');
const Los = require('../shared/los.js');
const Protocol = require('../shared/protocol.js');
const CONFIG = require('../shared/config.js');
const W = require('../server/world.js');
const away = require('../server/sim/away.js');
const combat = require('../server/sim/combat.js');
const { Game } = require('../server/game.js');

let n = 0, bad = 0;
const ok = (c, t) => { n++; if (!c) { bad++; console.log('  FEHLER ' + t); } else if (process.env.VERBOSE) console.log('  ok   ' + t); };
const abschnitt = (t) => console.log('[' + t + ']');
const SEEDS = Math.max(1, +process.env.SEEDS || 50);
const GR = Object.keys(Gelaende.GROESSEN), BI = Gelaende.BIOME;
const seedVon = (i) => 101 + i * 7919;   // gestreut (nicht 1..50), damit kein Seed-Rand-Effekt die Stichprobe prägt
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
const p95 = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]; };
const Z = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'buehnen', 'kacheln.json'), 'utf8')).zeichen;
const hashVon = (k) => crypto.createHash('sha1').update(JSON.stringify(k)).digest('hex');

// Bau wie landepunkte.wildnisBauen: Erzeuger -> Buehne.ausRaster(roh, { spiel: true }) mit der Produktionskonfiguration (CONFIG.buehne inkl. jeArt.wildnis)
function bau(seed, biom, groesse, extra) {
  const o = Object.assign({ biom, groesse, bauweise: 'germanen', besitz: null, zustand: 'intakt', id: 'kesh.wildnis-1' }, extra || {});
  const roh = Gelaende.erzeuger().karteRoh(seed, o);
  const r = Buehne.ausRaster(roh, { spiel: true });
  return { roh, r, karte: r.karte, fehler: r.fehler };
}
const zeit = (fn) => { const t0 = process.hrtime.bigint(); const v = fn(); return [v, Number(process.hrtime.bigint() - t0) / 1e6]; };

// ---------------------------------------------------------------- Konfiguration ist die echte
abschnitt('Prüfer-Konfiguration (Produktionsweg)');
{
  const b = bau(seedVon(0), 'wueste', 'klein');
  ok(CONFIG.buehne.jeArt && CONFIG.buehne.jeArt.wildnis && CONFIG.buehne.jeArt.wildnis.eingaengeMin === 0, 'CONFIG.buehne.jeArt.wildnis.eingaengeMin === 0 (Produktionskonfiguration)');
  ok(b.fehler.length === 0, 'ausRaster(roh, { spiel: true }) ohne Fehler (' + b.fehler.map((f) => f.code).join(',') + ')');
  // Gegenprobe: dieselbe Karte ohne den jeArt-Eintrag meldet K-EINGAENGE -> der Sweep läuft wirklich mit der Produktionskonfiguration
  const ohne = Buehne.ausRaster(b.roh, { spiel: true, cfg: Object.assign({}, CONFIG.buehne, { jeArt: {} }) });
  ok(ohne.fehler.some((f) => f.code === 'K-EINGAENGE'), 'Gegenprobe: ohne jeArt.wildnis meldet der Prüfer K-EINGAENGE (der Sweep nutzt also den echten jeArt-Eintrag)');
}

// ---------------------------------------------------------------- a) Determinismus
abschnitt('a) Determinismus (Kriterium 1)');
{
  let gleich = 0, anders = 0, gesamt = 0, rohGleich = 0;
  for (const bi of BI) for (const gr of GR) {
    const a = bau(seedVon(3), bi, gr), b = bau(seedVon(3), bi, gr), c = bau(seedVon(4), bi, gr);
    gesamt++;
    if (hashVon(a.karte) === hashVon(b.karte) && Buehne.hash(a.karte) === Buehne.hash(b.karte)) gleich++;
    if (hashVon(a.karte) !== hashVon(c.karte)) anders++;
    if (JSON.stringify(a.roh) === JSON.stringify(b.roh)) rohGleich++;
  }
  ok(gleich === gesamt && rohGleich === gesamt, `gleicher Seed zweimal: byte-gleiche fertige Karte und Roh-Objekt (${gleich}/${gesamt} Biom×Größe)`);
  ok(anders === gesamt, `anderer Seed: andere Karte (${anders}/${gesamt} Biom×Größe)`);
  // opts-Varianten: dichte, fundorte, gegner deterministisch und wirksam
  const varianten = [{ dichte: 0 }, { dichte: 1 }, { dichte: 0.2 }, { fundorte: 2 }, { fundorte: 4 }, { gegner: 'keine' }, { gegner: 0 }, { gegner: 8 }, { dichte: 0.8, fundorte: 3, gegner: 5 }];
  let det = 0, sauber = 0;
  for (const v of varianten) for (const bi of BI) {
    const a = bau(seedVon(5), bi, 'mittel', v), b = bau(seedVon(5), bi, 'mittel', v);
    if (hashVon(a.karte) === hashVon(b.karte)) det++;
    if (a.fehler.length === 0) sauber++;
  }
  ok(det === varianten.length * BI.length, `opts.dichte/fundorte/gegner: je Variante byte-gleich bei gleichem Seed (${det}/${varianten.length * BI.length})`);
  ok(sauber === varianten.length * BI.length, `opts-Varianten bauen ohne Prüferfehler (${sauber}/${varianten.length * BI.length})`);
  const zaehle = (k, rolle) => k.anker.filter((x) => x.rolle === rolle).length;
  const f2 = bau(seedVon(5), 'wiesenwald', 'gross', { fundorte: 2 }), f4 = bau(seedVon(5), 'wiesenwald', 'gross', { fundorte: 4 });
  ok(zaehle(f2.karte, 'fund') === 2 && zaehle(f4.karte, 'fund') === 4, `opts.fundorte wirkt (2 -> ${zaehle(f2.karte, 'fund')}, 4 -> ${zaehle(f4.karte, 'fund')} Funde)`);
  const g0 = bau(seedVon(5), 'wueste', 'mittel', { gegner: 'keine' });
  ok(zaehle(g0.karte, 'wache') === 0 && Object.values(g0.karte.bereiche).every((b) => !b.gefecht), 'opts.gegner "keine": keine wache-Anker, keine Gefechtsbereiche');
  const d0 = bau(seedVon(5), 'wiesenwald', 'mittel', { dichte: 0 }), d1 = bau(seedVon(5), 'wiesenwald', 'mittel', { dichte: 1 });
  const hindernisse = (k) => k.rows.join('').replace(/:/g, '').length;
  ok(hindernisse(d1.karte) > hindernisse(d0.karte), `opts.dichte wirkt (Nicht-Boden-Kacheln: dichte 0 -> ${hindernisse(d0.karte)}, dichte 1 -> ${hindernisse(d1.karte)})`);
  // normiere: leere Dichte = Standard (nicht 0), Biom ohne Rücksicht auf Groß-/Kleinschreibung und Leerraum
  const std = bau(seedVon(6), 'wiesenwald', 'klein'), leer = bau(seedVon(6), 'wiesenwald', 'klein', { dichte: '' }), gross = bau(seedVon(6), 'WiesenWald ', 'klein');
  ok(hashVon(std.karte) === hashVon(leer.karte), "opts.dichte '' = nicht angegeben (Standard 0.5), nicht 0");
  ok(hashVon(std.karte) === hashVon(gross.karte) && gross.karte.meta.biom === 'wiesenwald', "opts.biom 'WiesenWald ' wie 'wiesenwald' (Schreibung/Leerraum normiert)");
}

// ---------------------------------------------------------------- b) Prüfer-Sweep und unabhängige Erreichbarkeit
// Unabhängige Prüfung: eigene Flutfüllung direkt auf rows + kacheln.json (begehbar = nicht solid; Strauch ist nicht solid, also begehbar).
// Kein Code aus buehne.js oder buehne-kennzahlen.js.
const solidAn = (rows, x, y) => { const z = Z[rows[y] && rows[y][x]]; return !z || z.solid; };
function flut(rows, w, h, sx, sy) {
  const gesehen = new Uint8Array(w * h); const q = [[sx, sy]]; gesehen[sy * w + sx] = 1;
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i];
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) { const a = x + dx, b = y + dy; if (a < 0 || b < 0 || a >= w || b >= h || gesehen[b * w + a] || solidAn(rows, a, b)) continue; gesehen[b * w + a] = 1; q.push([a, b]); }
  }
  return gesehen;
}
const ankerVon = (k, rolle) => k.anker.filter((a) => a.rolle === rolle);
const sw = { karten: 0, fehlerKarten: 0, fehlerCodes: {}, fallback: 0, fallbackFaelle: [], unerreichbar: [], aufHindernis: [], ankunftFalsch: 0, pflichtMeta: 0, pflichtZahl: 0, ankerAufSAV: 0, art: 0 };
const bytes = {}, bauzeit = {}, abstaende = {}, wildnisKarten = [];
abschnitt(`b) Prüfer-Sweep: ${SEEDS} Seeds × ${GR.length} Größen × ${BI.length} Biome`);
for (const gr of GR) for (const bi of BI) {
  const key = gr + '/' + bi; bytes[key] = []; bauzeit[gr] = bauzeit[gr] || [];
  for (let i = 0; i < SEEDS; i++) {
    const seed = seedVon(i);
    // wie wildnisBauen: Seed, Seed+1, ... falls der Prüfer ablehnt (der Fallback wird gezählt und soll 0 sein)
    let b = null, versuche = 0, dt = 0;
    for (; versuche < 6; versuche++) {
      const [x, d] = zeit(() => bau(seed + versuche, bi, gr)); b = x; dt += d;
      if (b.fehler.length === 0) break;
      for (const f of b.fehler) sw.fehlerCodes[f.code] = (sw.fehlerCodes[f.code] || 0) + 1;
    }
    sw.karten++;
    if (b.fehler.length) { sw.fehlerKarten++; continue; }
    if (versuche > 0) { sw.fallback++; sw.fallbackFaelle.push(`${key} seed ${seed}: ${versuche} Versuch(e)`); }
    const k = b.karte;
    if (versuche === 0) bauzeit[gr].push(dt);   // Bauzeit nur aus Erstversuchen (sonst Fehlversuche mitgemessen); bei Fallback steht der Befund oben
    wildnisKarten.push({ k, seed: seed + versuche });
    if (k.art === 'wildnis' && k.w === Gelaende.GROESSEN[gr].w && k.h === Gelaende.GROESSEN[gr].h && k.meta.biom === bi) sw.art++;
    if (k.meta.pflicht && Object.keys(Gelaende.PFLICHT).every((r) => k.meta.pflicht[r] === Gelaende.PFLICHT[r])) sw.pflichtMeta++;
    const zahl = (r) => ankerVon(k, r).length;
    if (Object.keys(Gelaende.PFLICHT).every((r) => zahl(r) >= Gelaende.PFLICHT[r])) sw.pflichtZahl++;
    else console.log(`  FEHLER ${key} seed ${seed}: Pflichtanker-Zahlen ${JSON.stringify(Object.keys(Gelaende.PFLICHT).map((r) => [r, zahl(r)]))}`);
    // Unabhängige Erreichbarkeit
    const ank = k.anker.find((a) => a.id === k.ankunft);
    const fl = flut(k.rows, k.w, k.h, ank.x, ank.y);
    if (!ank || ank.rolle !== 'abholpunkt' || solidAn(k.rows, ank.x, ank.y) || k.rows[ank.y][ank.x] === 's') sw.ankunftFalsch++;
    for (const rolle of ['fund', 'deckung', 'wache', 'patrouille']) for (const a of ankerVon(k, rolle)) {
      const c = k.rows[a.y][a.x];
      if (solidAn(k.rows, a.x, a.y)) sw.aufHindernis.push(`${key} seed ${seed}: ${rolle} ${a.id} auf '${c}'`);
      if (!fl[a.y * k.w + a.x]) sw.unerreichbar.push(`${key} seed ${seed}: ${rolle} ${a.id} (${a.x},${a.y}) von der Ankunft aus nicht erreichbar`);
    }
    for (const a of k.anker) if ('sav'.includes(k.rows[a.y][a.x])) sw.ankerAufSAV++;
    // Anker-Abstände
    const ab = abstaende[gr] = abstaende[gr] || { fundAnkunft: [], fundFund: [] };
    const funde = ankerVon(k, 'fund');
    for (const f of funde) ab.fundAnkunft.push(Math.hypot(f.x - ank.x, f.y - ank.y));
    for (let x = 0; x < funde.length; x++) for (let y = x + 1; y < funde.length; y++) ab.fundFund.push(Math.hypot(funde[x].x - funde[y].x, funde[x].y - funde[y].y));
    // awayMap-Payload (wie Game.sendAwayMap)
    const kk = JSON.parse(JSON.stringify(k)); kk.id = 'kesh.wildnis-1';
    bytes[key].push(Buffer.byteLength(JSON.stringify(Game.prototype.awayMapPayload.call({}, kk))));
  }
}
{
  ok(sw.karten === GR.length * BI.length * SEEDS, `${sw.karten} Karten gebaut (${GR.length} Größen × ${BI.length} Biome × ${SEEDS} Seeds)`);
  ok(sw.fehlerKarten === 0 && Object.keys(sw.fehlerCodes).length === 0, `Prüfer: 0 Fehler in allen Karten (K-RASTER, K-PFLICHT, K-ERREICHBAR, ...) ${JSON.stringify(sw.fehlerCodes)}`);
  console.log(`  Seed+1-Fallback: ${sw.fallback}/${sw.karten} (Quote ${(sw.fallback / sw.karten * 100).toFixed(2)} %)` + (sw.fallback ? ' ' + sw.fallbackFaelle.join('; ') : ''));
  ok(sw.fallback === 0, 'kein Fehlbau: Quote des Seed+1-Fallbacks 0 (sonst Befund am Erzeuger)');
  ok(sw.art === sw.karten - sw.fehlerKarten, `art wildnis, Maße und Biom wie gefordert (${sw.art}/${sw.karten})`);
  ok(sw.pflichtMeta === sw.karten, `meta.pflicht gleich Gelaende.PFLICHT (${sw.pflichtMeta}/${sw.karten})`);
  ok(sw.pflichtZahl === sw.karten, `Pflichtanker-Zahlen >= PFLICHT ${JSON.stringify(Gelaende.PFLICHT)} (${sw.pflichtZahl}/${sw.karten})`);
  ok(sw.ankunftFalsch === 0, `Ankunft ist ein abholpunkt auf begehbarer Kachel, nie in Wasser, Lava oder Strauch (${sw.ankunftFalsch} Verstöße)`);
  ok(sw.unerreichbar.length === 0, `unabhängige Flutfüllung: Ankunft erreicht jeden fund, deckung, wache, patrouille (${sw.unerreichbar.length} Verstöße${sw.unerreichbar.length ? ': ' + sw.unerreichbar.slice(0, 3).join('; ') : ''})`);
  ok(sw.aufHindernis.length === 0, `kein fund/deckung/wache/patrouille auf einer unbegehbaren Kachel (${sw.aufHindernis.length}${sw.aufHindernis.length ? ': ' + sw.aufHindernis.slice(0, 3).join('; ') : ''})`);
  ok(sw.ankerAufSAV === 0, `kein Anker liegt auf s, a oder v (${sw.ankerAufSAV})`);
}

if (!wildnisKarten.length) { console.log('  FEHLER keine einzige Karte ohne Prüferfehler gebaut: die Abschnitte c) bis e) entfallen'); console.log(`
${n - bad}/${n} ok`); process.exit(1); }
// ---------------------------------------------------------------- c) Prop-Regeln als Eigenschaften der gebauten Karten
abschnitt('c) Prop-Regeln (Kriterium 7)');
{
  const ERLAUBT = new Set([':', 'F', 'Y', 'o', 'O', 's', 'a', 'v']);
  const vorkommen = {}; let fremd = 0;
  for (const { k } of wildnisKarten) for (const row of k.rows) for (const c of row) { vorkommen[c] = (vorkommen[c] || 0) + 1; if (!ERLAUBT.has(c)) fremd++; }
  ok(fremd === 0, `rows enthalten nur ${[...ERLAUBT].join(' ')} (Boden : und Rand F): Blumen und Bodenbewuchs sind nicht in rows (clientseitige Deko ohne Kollision); fremde Zeichen: ${fremd}`);
  console.log('  Zeichenverteilung über alle Karten: ' + Object.entries(vorkommen).sort().map(([c, v]) => `${c}=${v}`).join(' '));
  ok(['F', 'Y', 'o', 'O', 's', 'a', 'v'].every((c) => vorkommen[c] > 0), 'jedes Zeichen der Menge kommt in den Karten wirklich vor (sonst prüfen die Regeln unten ins Leere)');
  const z = (c) => Z[c];
  ok(z('o').solid && z('o').cover === 1 && z('o').low === true && z('O').solid && z('O').cover === 2, 'Steine: o halb (solid, cover 1, low), O voll (solid, cover 2)');
  ok(z('o').cover >= 1 && z('O').cover >= 1 && z('o').sperrtSicht === false && z('O').sperrtSicht === true, 'Steine: halb lässt die Sicht durch, voll sperrt sie');
  ok(!z('s').solid && z('s').cover === 0 && z('s').sperrtSicht === true, 'Strauch s: begehbar, keine Deckung, sperrt die Sicht');
  ok(z('a').solid && z('a').cover === 0 && z('a').sperrtSicht === false && z('v').solid && z('v').cover === 0 && z('v').sperrtSicht === false, 'Wasser a und Lava v: solid, keine Deckung, Sicht frei');
  // dieselben Werte in der Legende der GEBAUTEN Karte (das, was Prüfer und Server benutzen)
  const k0 = wildnisKarten[0].k;
  ok(['o', 'O', 's', 'a', 'v'].every((c) => k0.legende[c] && k0.legende[c].solid === z(c).solid && k0.legende[c].cover === z(c).cover && k0.legende[c].sperrtSicht === z(c).sperrtSicht), 'Legende der gebauten Karte trägt dieselben Werte');
  // jeder deckung-Anker grenzt an einen Stein (o/O), nicht an Strauch oder Fels allein
  let ohneStein = 0, deckungGes = 0;
  for (const { k } of wildnisKarten) for (const a of ankerVon(k, 'deckung')) {
    deckungGes++;
    const nb = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dy]) => /[oO]/.test((k.rows[a.y + dy] || '')[a.x + dx] || ''));
    if (!nb) ohneStein++;
  }
  ok(ohneStein === 0, `jeder deckung-Anker liegt an einem Stein o/O (${deckungGes} Anker, ohne Stein: ${ohneStein})`);
}

// Steine über die im Spiel verwendeten Funktionen. Auf gebauten Karten gilt NICHT shared/los.js allein (los.js rechnet mit einem übergebenen
// Prädikat), sondern combat.env(): blocked = interior.awaySight (nach sperrtSicht der Kartenlegende; Zustand-Kacheln nach solid && !low),
// shotBlocked = awayShotBlock (Sicht oder Fenster), Deckung = Los.coverAgainst(E.map, E.solid, ...). Das Auftragskriterium nennt shared/los.js
// als Beleg; die Datenquelle der Sicht auf gebauten Karten ist aber awaySight, deshalb wird hier über combat.env geprüft (wie test-kachelklassen.js).
abschnitt('c) Steine über combat.env (awaySight, awayShotBlock, Los.coverAgainst)');
{
  const LP = 'test.gelaende-steine';
  const T = Physics.tileCenter;
  // Testbett: kleine Wildnis-Karte (Rahmen F); (14,6) trägt das Prüfzeichen, die Zeile y=5 bleibt frei. Aufbau über den echten Prüfer-Weg.
  const Wt = 30, Ht = 13;
  const roh = (ch) => {
    const g = []; for (let y = 0; y < Ht; y++) g.push(new Array(Wt).fill(':'));
    for (let x = 0; x < Wt; x++) { g[0][x] = 'F'; g[Ht - 1][x] = 'F'; } for (let y = 0; y < Ht; y++) { g[y][0] = 'F'; g[y][Wt - 1] = 'F'; }
    if (ch) g[6][14] = ch;
    const A = (id, rolle, x, y, e) => Object.assign({ id, rolle, x, y, platz: 'gelaende', bereich: 'gelaende' }, e || {});
    return { id: LP, erzeuger: 'gen-gelaende/1', art: 'wildnis', bauweise: 'germanen', besitz: null, zustand: 'intakt', seed: 1, bauversion: 'probe', schablone: 'gen-gelaende', spiegel: null, w: Wt, h: Ht,
      rows: g.map((r) => r.join('')), legende: null,
      anker: [A('g.abholpunkt', 'abholpunkt', 3, 6, { ankunft: true }), A('g.fund.1', 'fund', 26, 3), A('g.fund.2', 'fund', 26, 9)],
      bereiche: { gelaende: { name: 'Gelände', rects: [[1, 1, Wt - 2, Ht - 2]] } }, plaetze: { gelaende: { typ: 'gelaende', modul: 'gen-gelaende', lage: { rot: 0, spiegel: false, aussen: null }, rect: [1, 1, Wt - 2, Ht - 2], bereich: 'gelaende' } },
      eingaenge: [], abholpunkte: ['g.abholpunkt'], ankunft: 'g.abholpunkt', patrouillen: [], coverSpots: [], decks: null, kanten: {}, zustaende: {}, gelaende: null,
      meta: { versuche: 1, kennzahlen: null, linear: false, pflicht: { abholpunkt: 1, fund: 2 }, zellen: null, schiffDecks: null, torStart: 'offen', huelle: true, typ: 'wildnis', titel: {}, biom: 'wueste', boden: 'sand' } };
  };
  const spiel = (karte) => {
    const g = new Game({ noStore: true, seed: 5, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
    const c = { inbox: [], send(m) { this.inbox.push(m); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'S0', name: 'S0', color: 0 }); g.handleMessage(c, { t: 'ready', ready: true });
    W.AWAY_MAPS[LP] = { id: LP, karte };
    g.aways[LP] = away.makeLandepunkt(g, LP); g.setAwayMap(LP);
    away.executeBeam(g, g.players.map((p) => p.id), 'down');
    return combat.env(g);
  };
  const env = (ch) => { const r = Buehne.ausRaster(roh(ch), { spiel: true }); ok(r.fehler.length === 0, `Testbett ${ch || 'leer'}: Prüfer ohne Fehler (${r.fehler.map((f) => f.code).join(',')})`); return spiel(r.karte); };
  try {
    const sicht = (E, a, b) => Los.lineOfSight(E.blocked, T(a[0], a[1]).x, T(a[0], a[1]).y, T(b[0], b[1]).x, T(b[0], b[1]).y);
    const schussFrei = (E, a, b) => !Los.walk(T(a[0], a[1]).x, T(a[0], a[1]).y, T(b[0], b[1]).x, T(b[0], b[1]).y, (tx, ty) => E.shotBlocked(tx, ty) && !(tx === b[0] && ty === b[1]));
    const deck = (E, a, b, ger) => Los.coverAgainst(E.map, E.solid, T(a[0], a[1]).x, T(a[0], a[1]).y, T(b[0], b[1]).x, T(b[0], b[1]).y, ger);
    const quelle = [8, 6], ziel = [20, 6];   // Stein auf (14,6) zwischen Schütze und Ziel
    const hinter = [15, 6];                  // Ziel unmittelbar hinter dem Stein (coverAgainst zählt nur Deckung direkt neben dem Ziel)
    const E0 = env(null), Eo = env('o'), EO = env('O');
    ok(sicht(E0, quelle, ziel) && schussFrei(E0, quelle, ziel) && deck(E0, quelle, hinter, false) === 0, 'Kontrolle ohne Stein: Sicht frei, Schuss frei, keine Deckung');
    // halber Stein o: solid, Sicht frei (awaySight liefert sperrtSicht=false), Schuss frei, Deckung halb
    ok(Eo.solid(14, 6) === true && Eo.blocked(14, 6) === false && Eo.shotBlocked(14, 6) === false, 'o (halb): solid true, awaySight/blocked false, shotBlocked false');
    ok(sicht(Eo, quelle, ziel) && sicht(Eo, ziel, quelle) && schussFrei(Eo, quelle, ziel), 'o (halb): Sicht und Schuss über den Stein hinweg frei (beidseitig)');
    const dO = deck(Eo, quelle, hinter, false), dOg = deck(Eo, quelle, hinter, true);
    const flanke = deck(Eo, [15, 1], hinter, false);
    ok(dO >= 1 && dOg >= dO, `o (halb): gibt Deckung gegen Beschuss über den Stein (aufrecht ${dO}, geduckt ${dOg}; Regel cover >= 1, geduckt volle Deckung)`);
    ok(dO === 1 && dOg === 2 && flanke === 0, `o (halb): Deckung genau halb (1), geduckt voll (2), Flanke (Schuss von der Seite am Stein vorbei) 0 (${dO}/${dOg}/${flanke})`);
    // voller Stein O: solid, sperrt Sicht und Schuss, Deckung voll
    ok(EO.solid(14, 6) === true && EO.blocked(14, 6) === true && EO.shotBlocked(14, 6) === true, 'O (voll): solid true, blocked true, shotBlocked true');
    ok(!sicht(EO, quelle, ziel) && !sicht(EO, ziel, quelle) && !schussFrei(EO, quelle, ziel), 'O (voll): Sicht und Schuss durch den Stein gesperrt (beidseitig)');
    const dV = deck(EO, quelle, hinter, false);
    ok(dV >= 1 && dV >= dO, `O (voll): Deckung ${dV} (aufrecht), mindestens so stark wie halb`);
    ok(sicht(EO, [8, 5], [20, 5]) && schussFrei(EO, [8, 5], [20, 5]), 'Nachbarzeile neben dem Stein bleibt frei');
  } finally { delete W.AWAY_MAPS[LP]; }

  // Dieselben Regeln auf einer echten, vom Erzeuger gebauten Karte: jede Kachel hat in combat.env die Werte aus kacheln.json
  const real = wildnisKarten.find((x) => ['O', 'o', 'v', 's', 'a', 'Y'].every((c) => x.k.rows.join('').includes(c))) || wildnisKarten[0];
  const K = JSON.parse(JSON.stringify(real.k)); K.id = LP;
  try {
    const E = spiel(K);
    let fehl = 0, geprueft = 0;
    for (let y = 0; y < K.h; y++) for (let x = 0; x < K.w; x++) {
      const ch = K.rows[y][x]; const zz = Z[ch]; if (!zz) { fehl++; continue; }
      geprueft++;
      if (E.solid(x, y) !== zz.solid || E.blocked(x, y) !== zz.sperrtSicht) fehl++;
      if (ch === 's' && (E.solid(x, y) || !E.blocked(x, y))) fehl++;
      if ((ch === 'a' || ch === 'v') && (!E.solid(x, y) || E.blocked(x, y) || E.shotBlocked(x, y))) fehl++;
      if (ch === 'o' && (!E.solid(x, y) || E.blocked(x, y))) fehl++;
      if ((ch === 'O' || ch === 'Y' || ch === 'F') && (!E.solid(x, y) || !E.blocked(x, y))) fehl++;
    }
    ok(fehl === 0, `echte Karte (${real.k.meta.biom} ${real.k.w}x${real.k.h}, Seed ${real.seed}): alle ${geprueft} Kacheln haben in combat.env solid/Sicht gemäß kacheln.json (${fehl} Abweichungen)`);
  } finally { delete W.AWAY_MAPS[LP]; }
}

// ---------------------------------------------------------------- d) Größe und Bauzeit
abschnitt('d) Größe und Bauzeit (Kriterium 5)');
{
  const MAX = Protocol.AWAY_MAP_MAX_BYTES || 16384;
  console.log(`  awayMap-Payload (Bytes) je Größe/Biom:  max / Median (Grenze ${MAX})`);
  let ueber = 0;
  for (const key of Object.keys(bytes)) { const a = bytes[key]; const mx = Math.max(...a); if (mx > MAX) ueber++; console.log('    ' + key.padEnd(18) + String(mx).padStart(8) + String(median(a)).padStart(10)); }
  ok(ueber === 0 && MAX === 16384, `awayMapPayload <= ${MAX} B in allen ${sw.karten} Karten (${ueber} darüber)`);
  console.log('  Bauzeit Erzeuger + ausRaster (ms), je Größe:  Median / p95 / max');
  const med = {};
  for (const gr of GR) { const a = bauzeit[gr]; med[gr] = median(a); console.log('    ' + gr.padEnd(10) + med[gr].toFixed(1).padStart(10) + p95(a).toFixed(1).padStart(10) + Math.max(...a).toFixed(1).padStart(10)); }
  let m = med;
  if (GR.some((gr) => med[gr] >= 100)) {   // der Rechner schwankt: einmal wiederholen, bevor rot gemeldet wird
    console.log('  Median >= 100 ms: Messung wird einmal wiederholt');
    m = {}; for (const gr of GR) { const a = []; for (let i = 0; i < 30; i++) a.push(zeit(() => bau(seedVon(i), BI[i % 3], gr))[1]); m[gr] = median(a); }
  }
  ok(GR.every((gr) => m[gr] < 100), `Bauzeit Median < 100 ms je Größe (${GR.map((gr) => gr + ' ' + m[gr].toFixed(1)).join(', ')} ms)`);
}

// ---------------------------------------------------------------- e) Anker-Verteilung (Regressionsschutz)
abschnitt('e) Anker-Verteilung');
{
  const SOLL = { klein: [14, 10], mittel: [20, 14], gross: [26, 18] };   // [Fundort-Ankunft, Fundort-Fundort] aus dem Erzeugerbericht
  for (const gr of GR) {
    const a = abstaende[gr];
    const minFA = Math.min(...a.fundAnkunft), minFF = a.fundFund.length ? Math.min(...a.fundFund) : Infinity;
    console.log(`  ${gr.padEnd(7)} min Fundort-Ankunft ${minFA.toFixed(1)} (Soll >= ${SOLL[gr][0]}), min Fundort-Fundort ${minFF.toFixed(1)} (Soll >= ${SOLL[gr][1]})`);
    ok(minFA >= SOLL[gr][0], `${gr}: Fundort-Ankunft >= ${SOLL[gr][0]} Kacheln in allen Karten (gemessen min ${minFA.toFixed(1)})`);
    ok(minFF >= SOLL[gr][1], `${gr}: Fundort-Fundort >= ${SOLL[gr][1]} Kacheln in allen Karten (gemessen min ${minFF.toFixed(1)})`);
  }
}

// ---------------------------------------------------------------- f) Ankunft nicht am Südrand, keine Bäume in der Wüste (Nacharbeit 7 und 15)
abschnitt('f) Ankunftsseite und Wüsten-Bäume');
{
  // Die Spielkamera steht südlich der Figur und blickt nach Norden: der Randfels am Südrand läge davor und verdeckte die Figur.
  let sued = 0, seiten = { W: 0, O: 0, N: 0 }, gesamt = 0, baumWueste = 0, baumVulkan = 0, wueste = 0, oase = 0, baumWiese = 0;
  for (const bi of BI) for (const gr of GR) for (let i = 0; i < Math.min(SEEDS, 30); i++) {
    const b = bau(seedVon(i), bi, gr); const k = b.karte; const a = k.anker.find((q) => q.id === k.ankunft);
    gesamt++;
    if (a.y >= k.h - 3) sued++;
    else if (a.x <= 2) seiten.W++; else if (a.x >= k.w - 3) seiten.O++; else if (a.y <= 2) seiten.N++;
    const y = k.rows.join('').split('Y').length - 1;
    if (bi === 'wueste') { baumWueste += y; wueste++; if (k.rows.join('').includes('a')) oase++; } else if (bi === 'vulkan') baumVulkan += y; else baumWiese += y;
  }
  ok(sued === 0 && seiten.W + seiten.O + seiten.N === gesamt, `Ankunft nie am Südrand (${gesamt} Karten: West ${seiten.W}, Ost ${seiten.O}, Nord ${seiten.N}, Süd ${sued})`);
  ok(seiten.W > 0 && seiten.O > 0 && seiten.N > 0, 'alle drei erlaubten Seiten kommen vor');
  ok(baumWueste === 0 && wueste > 0, `Wüste: keine Bäume (Y) in ${wueste} Karten (WUESTE_BAEUME aus, bis VOX-02 Palmen/Akazien liefert)`);
  ok(baumVulkan === 0, 'Vulkan: keine Bäume (Y) – bestätigt (Erzeuger setzt im Vulkan nie Y)');
  ok(baumWiese > 0, `Gegenprobe: der Wiesenwald hat weiter Bäume (${baumWiese} Y)`);
  ok(Gelaende.VERSION >= 3, 'VERSION >= 3 (Ankunftsseite und Wüsten-Bäume ändern die Karten)');
}

console.log(`\n${n - bad}/${n} ok`);
if (bad) { console.log(`${bad} FEHLER`); process.exit(1); }
console.log('TEST-GELAENDE OK');
