'use strict';
// Messwerkzeug "Klumpen der Gegner am Boden" (BOD-01 P3, Ausgangswert fuer BOD-02 Trupp-Taktik).
// Ursprung: Erkundung Boden-KI (2026-10-30, klumpen.js), hier als wiederholbares Werkzeug im Repo. Nur lesend, aendert kein Spiel.
//
// Aufruf: node tools/mess-klumpen.js <modus> [--seeds N=6] [--spieler N=3] [--sek S=60] [--lauf [X=22]] [--staerke klein|mittel|gross] [--verlauf]
//         node tools/mess-klumpen.js --selbsttest
//   Modi:
//     endkampf   Eisenwald-Endkampf (splitter.eisenwald, Flagge gehisst, Labor stellung_nehmen/flagge_hissen), wie im Original-Skript.
//     besetzen   Eisenwald mit regulaeren Trupps (combat.besetzen, Fraktion raubzug, Staerke --staerke, Standard gross), wie im Original.
//     graben     Szenario Grabenangriff: feste Karte (gen.fest = grabenangriff), Rom-Verteidiger je Crewgroesse 6/9/12.
//   Spieler: standardmaessig stehend und unverwundbar (Schild voll, sofort wiederbelebt) am Landepunkt (graben: Abholpunkt x~4).
//     --ruhig     graben: Verteidiger starten nicht alarmiert (Standard: alarmiert, wie haltung wach bei besetzen). Ohne Alarm bleiben sie auf den Posten.
//     --lauf [X]  Spieler laufen nach rechts bis Kachel X (Standard 22) und bleiben dort stehen (nur graben, endkampf/besetzen: dort
//                 ohne Wirkung, die Spieler stehen im Gelaende). Grund: Sicht ist 10 Kacheln, vom Abholpunkt (x~4) aus entsteht auf
//                 der Grabenkarte nie ein Gefecht; die Stellung beginnt bei x~30.
//   Kennzahlen (nur Samples im Gefecht = mindestens 3 Gegner sehen einen Spieler; Takt 0,5 s Spielzeit):
//     Hauptkennzahlen: Anteil Gegner mit Kamerad <= 2 Kacheln, mittlerer Abstand zum naechsten Kameraden.
//     weitere: mittlerer Paarabstand, Gegner je Deckungsinsel (Maximum), Inseln mit >= 2 Gegnern, Abstand stehender pin-Gegner,
//     Anteil Samples mit Flankierer.
//
// HINWEIS zum Modus graben: Das echte Szenario (BOD-01 P4: Lobby, Ablauf, Wellen) liegt in diesem Stand noch nicht vor. Die Postierung
// laeuft deshalb ueber die kleine Funktion grabenPostieren() unten (Rom, Gruppen w1.graben/w1.posten/w2.wald/w2.eingang aus
// karte.meta.wellen, Rezept "graben" aus content/katalog/fraktionen/rom.json, 6/9/12 Gegner je Crewgroesse 1/2/3). Nach dem Merge von
// P4 wird sie auf den echten Szenariostart umgestellt (spiel() baut dann ueber die Lobby statt ueber testgelaende).
const path = require('path');
const R = path.join(__dirname, '..') + path.sep;
const CONFIG = require(R + 'shared/config.js');
const Physics = require(R + 'shared/physics.js');
const { Game } = require(R + 'server/game.js');
const L = require(R + 'server/sim/landepunkte.js');
const Anker = require(R + 'server/sim/anker.js');
const combat = require(R + 'server/sim/combat.js');
const squad = require(R + 'server/sim/squad.js');
const away = require(R + 'server/sim/away.js');
const interior = require(R + 'server/sim/interior.js');
const W = require(R + 'server/world.js');
const Katalog = require(R + 'server/mission/katalog.js');
const TILE = Physics.TILE;

const ENV = { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' };
const EISENWALD = 'splitter.eisenwald', EISENWALD_LABOR = 'stellung_nehmen/flagge_hissen';
const TITEL = { endkampf: 'Eisenwald Endkampf', besetzen: 'Eisenwald besetzen (regulaere Trupps)', graben: 'Grabenangriff (feste Karte, Rom)' };
const f2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : NaN);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const ticks = (g, s) => { const k = Math.round(s * CONFIG.tickHz); for (let i = 0; i < k; i++) g.step(); };
const t2 = (e) => Physics.toTile(e.x, e.y);

function neuesSpiel(np, seed) {
  const g = new Game({ noStore: true, seed, env: ENV, log: () => {} });
  const cs = [];
  for (let i = 0; i < np; i++) { const c = { inbox: [], send(m) { if (this.inbox.length < 50) this.inbox.push(m); } }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'K' + i, name: 'K' + i, color: i }); cs.push(c); }
  return { g, cs };
}
function runterbeamen(g, lp) {
  g.weltstand.data.rollen_gesehen = ['niederhalter', 'grenadier', 'schuetze', 'enterer', 'haescher'];
  L.get(g, lp); g.transferZiel = { lp, scene: g.ship.scene }; g.setAwayMap(lp);
  away.executeBeam(g, g.players.map((p) => p.id), 'down'); ticks(g, 0.5);
}
// Eisenwald wie im Original: Labor-Lobby, dann runterbeamen.
function eisenwaldSpiel(np, seed) {
  const { g, cs } = neuesSpiel(np, seed);
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: 'labor', labor: { id: EISENWALD_LABOR, seed } });
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  ticks(g, 1);
  runterbeamen(g, EISENWALD);
  return { g, cs, lp: EISENWALD };
}
// Grabenangriff: feste Karte ueber testgelaende (Vorbild tools/test-grabenangriff-karte.js).
function grabenSpiel(np, seed) {
  const { g, cs } = neuesSpiel(np, seed);
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  const lp = L.testgelaende(g, { ort: g.ship.scene || 'kesh', id: 'test.mess.graben' + seed, art: 'aussenposten', seed, besitz: 'rom', gen: { fest: 'grabenangriff', abschnitte: { wiese: 'graben', wald: 'weg' } } });
  runterbeamen(g, lp);
  return { g, cs, lp };
}

// Postierung der Verteidiger des Grabenangriffs. Wird nach dem Merge von P4 durch den echten Szenariostart ersetzt.
// Gegner je Crewgroesse 1/2/3: 6/9/12, je zur Haelfte Welle 1 (Graben + Posten) und Welle 2 (Wald + Eingang); Rollen reihum aus dem
// Rezept "graben" (Rom). Platz: die Anker der Gruppe, reichen sie nicht, die freien Nachbarkacheln. welle: 1, 2 oder 'alle'.
const GEGNER_JE_CREW = { 1: 6, 2: 9, 3: 12 };
function grabenPostieren(g, lp, welle, ruhig) {
  const k = W.AWAY_MAPS[lp].karte, aw = g.aways[lp];
  const rezept = Katalog.load().fraktionen.rom.rezepte.graben;
  const rollen = []; for (const t of rezept) for (let i = 0; i < (t.n || 1); i++) rollen.push(t.rolle);
  const crew = Math.max(1, Math.min(3, g.players.length));
  const gesamt = GEGNER_JE_CREW[crew], jeWelle = { 1: Math.ceil(gesamt / 2), 2: Math.floor(gesamt / 2) };
  const ankerVon = (id) => k.anker.find((a) => a.id === id);
  const frei = (x, y) => { const c = (k.rows[y] || '')[x]; return c != null && !(k.legende[c] && k.legende[c].solid); };
  let gesetzt = 0, rolleIdx = 0;
  for (const w of [1, 2]) {
    if (welle !== 'alle' && +welle !== w) continue;
    const gruppen = k.meta.wellen[String(w)];
    let plaetze = [].concat(...gruppen.map((gr) => k.meta.gruppen[gr].map(ankerVon)));   // Reihenfolge der Gruppen: graben vor posten, wald vor eingang
    plaetze = plaetze.map((a) => ({ x: a.x, y: a.y }));
    for (let i = 0; plaetze.length < jeWelle[w] && i < plaetze.length; i++) {   // zu wenige Anker: freie Nachbarkachel dazu
      const a = plaetze[i];
      const n = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([dx, dy]) => ({ x: a.x + dx, y: a.y + dy })).find((q) => frei(q.x, q.y) && !plaetze.some((p) => p.x === q.x && p.y === q.y));
      if (n) plaetze.push(n);
    }
    plaetze = plaetze.slice(0, jeWelle[w]);
    const besetzung = {}; for (let i = 0; i < plaetze.length; i++) { const r = rollen[rolleIdx++ % rollen.length]; besetzung[r] = (besetzung[r] || 0) + 1; }
    const name = 'w' + w;
    // Plaetze und Besetzung stimmen in der Zahl ueberein (festeZahl); die Plaetze nimmt spawnAnKarte der Reihe nach
    const n = squad.spawnSquad(g, name, { map: lp, besetzung: Object.keys(besetzung).sort().map((typ) => ({ typ, anzahl: besetzung[typ] })), plaetze, festeZahl: true, force: true, alert: !ruhig });
    for (const e of aw.drones) if (e.squad === name) { e.tag = name; e.fraktion = 'rom'; e.palette = 'rom'; combat.kaempfer(g, e); }
    if (aw.squads[name]) { aw.squads[name].tag = name; aw.squads[name].fraktion = 'rom'; }
    gesetzt += n;
  }
  return gesetzt;
}

function inseln(map) {   // Deckungsinseln: 8er-zusammenhaengende solide Kacheln mit cover>0
  const id = new Map(); let n = 0;
  const isC = (x, y) => { if (x < 0 || y < 0 || x >= map.w || y >= map.h) return false; const i = map.info(x, y); return i.cover && map.solid(x, y) && i.solid !== 'zustand'; };
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    if (!isC(x, y) || id.has(x + ',' + y)) continue;
    n++; const st = [[x, y]]; id.set(x + ',' + y, n);
    while (st.length) { const [a, b] = st.pop(); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const k = (a + dx) + ',' + (b + dy); if (id.has(k) || !isC(a + dx, b + dy)) continue; id.set(k, n); st.push([a + dx, b + dy]); } }
  }
  return { id };
}

function messLauf(modus, o, seed) {
  const sp = modus === 'graben' ? grabenSpiel(o.spieler, seed) : eisenwaldSpiel(o.spieler, seed);
  const { g, cs, lp } = sp;
  if (modus === 'endkampf') {
    const fl = W.AWAY_MAPS[lp].karte.anker.find((q) => q.rolle === 'flagge');
    Anker.setzen(g, lp, fl.id, 'gehisst', g.players[0].id);
  } else if (modus === 'besetzen') {
    combat.besetzen(g, { map: lp, fraktion: 'raubzug', staerke: o.staerke || 'gross', haltung: 'wach', tag: 'erk', neue_rolle: null });
  } else {
    o.gesetzt = grabenPostieren(g, lp, o.welle || 'alle', o.ruhig);
  }
  ticks(g, 0.2);
  const aw = g.aways[lp], ins = inseln(interior.awayInfoOf(lp).map);
  const laufX = modus === 'graben' && o.lauf ? o.laufX : null;
  let seq = 0;
  const samples = [];
  for (let s = 0; s < o.sek * 2; s++) {
    for (let q = 0; q < Math.round(0.5 * CONFIG.tickHz); q++) {
      if (laufX != null && q === 0) g.players.forEach((p, i) => { const mx = Physics.toTile(p.x, p.y).x < laufX ? 1 : 0; g.handleMessage(cs[i], { t: 'input', seq: ++seq, mx, my: 0 }); });
      g.step();
      for (const p of g.players) { if (p.shield) p.shield.seg = 3; if (p.downed) combat.revive(g, p, 3, { quiet: true }); }
    }
    const al = aw.drones.filter((e) => e.alive);
    if (al.length < 2) continue;
    const T = al.map(t2);
    let sum = 0, cnt = 0, nn = 0, klumpen = 0;
    for (let i = 0; i < T.length; i++) { let m = 1e9; for (let j = 0; j < T.length; j++) if (i !== j) { const d = Math.hypot(T[i].x - T[j].x, T[i].y - T[j].y); m = Math.min(m, d); if (j > i) { sum += d; cnt++; } } nn += m; if (m <= 2) klumpen++; }
    const sieht = al.filter((e) => e.sees && e.sees.length).length;
    const proInsel = {};   // stehende Gegner (kein Pfad) neben einer Deckungskachel -> Insel
    for (const e of al) { if (e.path && e.path.length) continue; const t = t2(e); const ids = new Set(); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const i = ins.id.get((t.x + dx) + ',' + (t.y + dy)); if (i) ids.add(i); } for (const i of ids) proInsel[i] = (proInsel[i] || 0) + 1; }
    const maxInsel = Math.max(0, ...Object.values(proInsel));
    const geteilt = Object.values(proInsel).filter((v) => v >= 2).length;
    const minSp = al.map((e) => Math.min(...g.players.map((p) => Math.hypot(p.x - e.x, p.y - e.y) / TILE)));
    const pins = al.filter((e) => e.role === 'pin' && !(e.path && e.path.length)).map(t2);
    const pnn = pins.length >= 2 ? mean(pins.map((a, i) => Math.min(...pins.filter((_, j) => j !== i).map((b) => Math.hypot(a.x - b.x, a.y - b.y))))) : NaN;
    const roll = {}; for (const e of al) roll[e.role] = (roll[e.role] || 0) + 1;
    samples.push({ t: (s + 1) * 0.5, n: al.length, mpd: sum / cnt, nn: nn / T.length, klumpFrac: klumpen / T.length, sieht, maxInsel, geteilt, pnn, npin: pins.length, flanker: al.some((e) => e.role === 'flank') ? 1 : 0, medSp: minSp.sort((x, y) => x - y)[Math.floor(minSp.length / 2)], roll });
  }
  const sx = g.players.map((p) => Physics.toTile(p.x, p.y).x);
  const fehler = Array.isArray(g.errors) ? g.errors.length : g.errors | 0;
  return { seed, samples, spielerX: sx, fehler };
}

function auswerten(modus, o, rows) {
  const out = [];
  const spielerTxt = modus === 'graben' ? ((o.ruhig ? 'Gegner ruhig, ' : '') + (o.lauf ? `laufen auf x~${o.laufX} vor, dann stehend` : 'stehend am Abholpunkt (x~4)')) : 'stehend';
  out.push(`${TITEL[modus]}, ${o.spieler} Spieler (${spielerTxt}, unverwundbar), ${o.sek} s, Seeds 1..${o.seeds}`);
  const all = rows.flatMap((r) => r.samples), gef = all.filter((s) => s.sieht >= 3);
  out.push(`Gefecht entstanden in ${rows.filter((r) => r.samples.some((s) => s.sieht >= 3)).length} von ${rows.length} Seeds, ${gef.length} von ${all.length} Samples im Gefecht` + (modus === 'graben' ? `; Spieler-x am Ende (Seed 1): ${rows[0].spielerX.join(',')}` : ''));
  if (gef.length) {
    out.push(`HAUPTKENNZAHLEN (Gefecht): Anteil Gegner mit Kamerad <= 2 Kacheln ${f2(mean(gef.map((s) => s.klumpFrac)))}   mittlerer Abstand zum naechsten Kameraden ${f2(mean(gef.map((s) => s.nn)))} Kacheln`);
  } else out.push('HAUPTKENNZAHLEN (Gefecht): keine Gefechtssamples, keine Werte');
  for (const [name, S] of [['gesamt', all], ['Gefecht (>=3 Gegner sehen Spieler)', gef]]) {
    out.push(`[${name}] Samples ${S.length}: Gegner ${f2(mean(S.map((s) => s.n)))}  mittl. Paarabstand ${f2(mean(S.map((s) => s.mpd)))}  mittl. Abstand zum naechsten Kameraden ${f2(mean(S.map((s) => s.nn)))}  Anteil <=2 Kacheln ${f2(mean(S.map((s) => s.klumpFrac)))}  max Gegner je Deckungsinsel (Mittel ${f2(mean(S.map((s) => s.maxInsel)))}, Maximum ${S.length ? Math.max(...S.map((s) => s.maxInsel)) : NaN})  Inseln mit >=2 Gegnern ${f2(mean(S.map((s) => s.geteilt)))}  Median Abstand zum naechsten Spieler ${f2(mean(S.map((s) => s.medSp)))}`);
  }
  const P = gef.filter((s) => s.npin >= 2);
  out.push(`stehende pin-Gegner (>=2) im Gefecht: Samples ${P.length}, mittl. Abstand zum naechsten pin-Kameraden ${f2(mean(P.map((s) => s.pnn)))}, mittl. Anzahl pin ${f2(mean(P.map((s) => s.npin)))}`);
  out.push(`Samples mit Flankierer (Anteil, alle Samples): ${f2(mean(all.map((s) => s.flanker)))}`);
  for (const r of rows) { const g2 = r.samples.filter((s) => s.sieht >= 3); out.push(`seed ${r.seed}: Gefechtssamples ${g2.length}, Paarabstand ${f2(mean(g2.map((s) => s.mpd)))}, nn ${f2(mean(g2.map((s) => s.nn)))}, <=2 ${f2(mean(g2.map((s) => s.klumpFrac)))}, maxInsel ${g2.length ? Math.max(...g2.map((s) => s.maxInsel)) : 0}, Tickfehler ${r.fehler}`); }
  if (o.verlauf && rows[0]) out.push('Verlauf seed 1:\n' + rows[0].samples.filter((s, i) => i % 10 === 0).map((s) => `t${s.t}: n${s.n} mpd${f2(s.mpd)} nn${f2(s.nn)} sieht${s.sieht} maxInsel${s.maxInsel} spD${f2(s.medSp)} ${JSON.stringify(s.roll)}`).join('\n'));
  return out.join('\n');
}

function argumente(argv) {
  const o = { modus: null, seeds: 6, spieler: 3, sek: 60, lauf: false, laufX: 22, staerke: 'gross', verlauf: false, selbsttest: false, welle: 'alle', ruhig: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], nxt = () => argv[++i];
    if (a === '--seeds') o.seeds = +nxt(); else if (a === '--spieler') o.spieler = +nxt(); else if (a === '--sek') o.sek = +nxt();
    else if (a === '--lauf') { o.lauf = true; if (argv[i + 1] && /^\d+$/.test(argv[i + 1])) o.laufX = +nxt(); }
    else if (a === '--staerke') o.staerke = nxt(); else if (a === '--welle') o.welle = nxt(); else if (a === '--ruhig') o.ruhig = true; else if (a === '--verlauf') o.verlauf = true; else if (a === '--selbsttest') o.selbsttest = true;
    else if (!a.startsWith('--') && !o.modus) o.modus = a;
    else { console.error('unbekanntes Argument: ' + a); process.exit(2); }
  }
  return o;
}

function selbsttest() {
  let fails = 0;
  const ok = (c, m) => { if (!c) { fails++; console.log('  FEHLER ' + m); } else console.log('  ok ' + m); };
  const lauf = (modus, extra) => { const o = Object.assign({ modus, seeds: 2, spieler: 3, sek: 20, lauf: false, laufX: 22, staerke: 'gross', welle: 'alle' }, extra || {}); const rows = []; for (let s = 1; s <= o.seeds; s++) rows.push(messLauf(modus, o, s)); return { o, rows, txt: auswerten(modus, o, rows) }; };
  for (const [modus, extra, name] of [['endkampf', null, 'endkampf'], ['besetzen', { sek: 10, seeds: 1 }, 'besetzen'], ['graben', { lauf: true }, 'graben --lauf']]) {
    const { rows, txt } = lauf(modus, extra);
    const gef = rows.flatMap((r) => r.samples).filter((s) => s.sieht >= 3);
    ok(rows.every((r) => r.samples.length > 0 && r.fehler === 0), `${name}: Samples vorhanden, keine Tickfehler`);
    ok(gef.length > 0 && Number.isFinite(mean(gef.map((s) => s.klumpFrac))) && Number.isFinite(mean(gef.map((s) => s.nn))), `${name}: Hauptkennzahlen endlich (${gef.length} Gefechtssamples)`);
    ok(/Eisenwald|Grabenangriff/.test(txt.split('\n')[0]) && (modus !== 'besetzen' || /besetzen/.test(txt.split('\n')[0])) && (modus !== 'endkampf' || /Endkampf/.test(txt.split('\n')[0])), `${name}: Ueberschrift passt zum Modus`);
  }
  { const { o, rows } = lauf('graben', { seeds: 1, sek: 4 }); ok(rows[0].samples[0].n === GEGNER_JE_CREW[3], `graben: 12 Gegner bei Crew 3 (${rows[0].samples[0].n})`); ok(o.spieler === 3 && rows[0].spielerX.every((x) => x <= 8), 'graben ohne --lauf: Spieler stehen am Abholpunkt'); }
  { const { rows } = lauf('graben', { seeds: 1, sek: 4, spieler: 1 }); ok(rows[0].samples[0].n === 6, `graben: 6 Gegner bei Crew 1 (${rows[0].samples[0].n})`); }
  console.log(fails ? 'VERFEHLT: ' + fails : 'ok');
  process.exit(fails ? 1 : 0);
}

const o = argumente(process.argv.slice(2));
if (o.selbsttest) selbsttest();
if (!TITEL[o.modus]) { console.error('Modus fehlt oder unbekannt (endkampf | besetzen | graben). Siehe Kopfkommentar von tools/mess-klumpen.js'); process.exit(2); }
const rows = [];
for (let seed = 1; seed <= o.seeds; seed++) rows.push(messLauf(o.modus, o, seed));
console.log(auswerten(o.modus, o, rows));
process.exit(0);
