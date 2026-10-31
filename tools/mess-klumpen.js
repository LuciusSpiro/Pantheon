'use strict';
// Messwerkzeug "Klumpen der Gegner am Boden" (BOD-01 P3, Ausgangswert fuer BOD-02 Trupp-Taktik).
// Ursprung: Erkundung Boden-KI (2026-10-30, klumpen.js), hier als wiederholbares Werkzeug im Repo. Nur lesend, aendert kein Spiel.
//
// Aufruf: node tools/mess-klumpen.js <modus> [--seeds N=6] [--spieler N=3] [--sek S=60] [--lauf [X=22]] [--alarm] [--staerke klein|mittel|gross] [--verlauf]
//         node tools/mess-klumpen.js --selbsttest
//   Modi:
//     endkampf   Eisenwald-Endkampf (splitter.eisenwald, Flagge gehisst, Labor stellung_nehmen/flagge_hissen), wie im Original-Skript.
//     besetzen   Eisenwald mit regulaeren Trupps (combat.besetzen, Fraktion raubzug, Staerke --staerke, Standard gross), wie im Original.
//     graben     Szenario Grabenangriff, echter Start ueber den Lobby-Modus arena_graben (server/sim/graben.js): Rom-Verteidiger 6/9/12 je Crew 1/2/3.
//   Spieler: standardmaessig stehend und unverwundbar (Schild voll, sofort wiederbelebt) am Landepunkt (graben: Abholpunkt x~4).
//     --alarm     graben: alle Verteidiger ab Tick 0 alarmiert und wach (Standard = echtes Verhalten: ruhig auf den Posten; --alarm nur zum
//                Vergleich mit den fruehen Fixtures).
//     --lauf [X]  Spieler laufen nach rechts bis Kachel X (Standard 22) und bleiben dort stehen (nur graben, endkampf/besetzen: dort
//                 ohne Wirkung, die Spieler stehen im Gelaende). Grund: Sicht ist 10 Kacheln, vom Abholpunkt (x~4) aus entsteht auf
//                 der Grabenkarte nie ein Gefecht; die Stellung beginnt bei x~30.
//   Kennzahlen (nur Samples im Gefecht = mindestens 3 Gegner sehen einen Spieler; Takt 0,5 s Spielzeit):
//     Hauptkennzahlen: Anteil Gegner mit Kamerad <= 2 Kacheln, mittlerer Abstand zum naechsten Kameraden.
//     weitere: mittlerer Paarabstand, Gegner je Deckungsinsel (Maximum), Inseln mit >= 2 Gegnern, Abstand stehender pin-Gegner,
//     Anteil Samples mit Flankierer.
//     BOD-02 P7 (Trupp-Gehirn, e.aufgabe): Anteil Gefechts-Samples, in denen jeder Trupp ab 4 Lebenden >= 1 niederhalten und >= 1 flanke hat
//     (nur Samples mit mindestens einem solchen Trupp), Verteilung der Aufgaben (Anteil je Aufgabe an allen Gegnern im Gefecht).
//     BOD-02 P8/P9 (graben, Verteidigungsprofil): HALTEN = Anteil der lebenden Welle 1 in Stellungen (Stellung.inStellung) in Samples ab Alarm (aw.alarm), solange kein
//     Rueckzug ausgeloest ist (Ziel >= 0,80); Rueckzug-Zaehler (aw.truppStats.rueckzug), Gegenstoesse (aw.truppStats.gegenstoss).
//     Echter Alarm durch Entdeckung: ruhige Gegner (kein --alarm), --lauf 22: node tools/mess-klumpen.js graben --lauf 22 --seeds 8 --sek 120 --spieler 3
//
const path = require('path');
const R = path.join(__dirname, '..') + path.sep;
const CONFIG = require(R + 'shared/config.js');
const Physics = require(R + 'shared/physics.js');
const { Game } = require(R + 'server/game.js');
const L = require(R + 'server/sim/landepunkte.js');
const Anker = require(R + 'server/sim/anker.js');
const Stellung = require(R + 'server/sim/stellung.js');
const combat = require(R + 'server/sim/combat.js');
const squad = require(R + 'server/sim/squad.js');
const away = require(R + 'server/sim/away.js');
const interior = require(R + 'server/sim/interior.js');
const W = require(R + 'server/world.js');
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
// Grabenangriff: echter Szenariostart (Lobby-Modus arena_graben, server/sim/graben.js, Vorbild tools/test-grabenangriff-szenario.js).
// Ohne Ruestphase beamt die Crew beim Start gleich an den Abholpunkt; die Gegner stehen ruhig (schleich, Posten) in den Gruppen.
function grabenSpiel(np, seed) {
  const { g, cs } = neuesSpiel(np, seed);
  g.lobbyOpts.startMission = 'arena_graben';
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  const S = g.arena && g.arena.wellen;
  if (!S) throw new Error('Grabenangriff nicht gestartet (seed ' + seed + ')');
  ticks(g, 0.5);
  return { g, cs, lp: S.lp };
}
// Variante --alarm: alle Truppen von Beginn an alarmiert und wach (Vergleich mit den fruehen Fixtures, wo die Gegner alarmiert starteten)
function alleAlarmieren(g, lp) {
  const aw = g.aways[lp];
  for (const s of Object.values(aw.squads)) { s.schleich = false; squad.alertSquad(g, aw, s); }
  for (const e of aw.drones) e.patrouilliert = false;
}

function inseln(map) {   // Deckungsinseln: 8er-zusammenhaengende solide Kacheln mit cover>0
  const id = new Map(); let n = 0; const frei = new Set();   // frei = freistehende Insel (keine Mauer: kein '#'/'=' und hoechstens 12 Kacheln, wie squad.js trupp.inselKachelnMax)
  const isC = (x, y) => { if (x < 0 || y < 0 || x >= map.w || y >= map.h) return false; const i = map.info(x, y); return i.cover && map.solid(x, y) && i.solid !== 'zustand'; };
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    if (!isC(x, y) || id.has(x + ',' + y)) continue;
    n++; const st = [[x, y]]; id.set(x + ',' + y, n); let kn = 0, wand = false;
    while (st.length) { const [a, b] = st.pop(); kn++; const ch = map.at(a, b); if (ch === '#' || ch === '=') wand = true; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const k = (a + dx) + ',' + (b + dy); if (id.has(k) || !isC(a + dx, b + dy)) continue; id.set(k, n); st.push([a + dx, b + dy]); } }
    if (!wand && kn <= 12) frei.add(n);
  }
  return { id, frei };
}

function messLauf(modus, o, seed) {
  const sp = modus === 'graben' ? grabenSpiel(o.spieler, seed) : eisenwaldSpiel(o.spieler, seed);
  const { g, cs, lp } = sp;
  if (modus === 'endkampf') {
    const fl = W.AWAY_MAPS[lp].karte.anker.find((q) => q.rolle === 'flagge');
    Anker.setzen(g, lp, fl.id, 'gehisst', g.players[0].id);
  } else if (modus === 'besetzen') {
    combat.besetzen(g, { map: lp, fraktion: 'raubzug', staerke: o.staerke || 'gross', haltung: 'wach', tag: 'erk', neue_rolle: null });
  } else if (o.alarm) alleAlarmieren(g, lp);
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
    const freiW = Object.entries(proInsel).filter(([i]) => ins.frei.has(+i)).map(([, v]) => v);   // nur freistehende Inseln (ohne Mauern)
    const maxFrei = Math.max(0, ...freiW), geteiltFrei = freiW.filter((v) => v >= 2).length;
    const minSp = al.map((e) => Math.min(...g.players.map((p) => Math.hypot(p.x - e.x, p.y - e.y) / TILE)));
    const pins = al.filter((e) => e.role === 'pin' && !(e.path && e.path.length)).map(t2);
    const pnn = pins.length >= 2 ? mean(pins.map((a, i) => Math.min(...pins.filter((_, j) => j !== i).map((b) => Math.hypot(a.x - b.x, a.y - b.y))))) : NaN;
    const roll = {}; for (const e of al) roll[e.role] = (roll[e.role] || 0) + 1;
    const aufg = {}; for (const e of al) { const a = e.aufgabe || 'keine'; aufg[a] = (aufg[a] || 0) + 1; }
    const proTrupp = {}; for (const e of al) (proTrupp[e.squad] = proTrupp[e.squad] || []).push(e);
    const gross = Object.values(proTrupp).filter((l) => l.length >= 4);
    const gueltig = gross.length ? (gross.every((l) => l.some((e) => e.aufgabe === 'niederhalten') && l.some((e) => e.aufgabe === 'flanke')) ? 1 : 0) : null;
    // BOD-02 P8/P9: Welle 1 in Stellungen (ab Alarm, solange kein Rueckzug ausgeloest ist)
    let halten = null, rz = false;
    const Vs = Object.values(aw.squads).map((q) => q && q.verteidigung).filter(Boolean);
    if (modus === 'graben' && Vs.some((V) => V.squads.some((n) => aw.squads[n] && aw.squads[n].alert))) {   // Alarm = ein Trupp der Linie ist alarmiert (aw.alarm gilt bei --alarm nicht)
      rz = Vs.some((V) => V.modus !== 'halten');
      const w1 = al.filter((e) => Vs.some((V) => V.squads.includes(e.squad)));
      if (!rz && w1.length) halten = { n: w1.length, drin: w1.filter((e) => Stellung.inStellung(g, e)).length };
    }
    samples.push({ halten, rz, gst: (aw.truppStats && aw.truppStats.gegenstoss) || 0, rzz: (aw.truppStats && aw.truppStats.rueckzug) || 0, t: (s + 1) * 0.5, n: al.length, mpd: sum / cnt, nn: nn / T.length, klumpFrac: klumpen / T.length, sieht, maxInsel, geteilt, maxFrei, geteiltFrei, pnn, npin: pins.length, flanker: al.some((e) => e.role === 'flank') ? 1 : 0, aufg, gueltig, medSp: minSp.sort((x, y) => x - y)[Math.floor(minSp.length / 2)], roll });
  }
  const sx = g.players.map((p) => Physics.toTile(p.x, p.y).x);
  const fehler = Array.isArray(g.errors) ? g.errors.length : g.errors | 0;
  return { seed, samples, spielerX: sx, fehler };
}

function auswerten(modus, o, rows) {
  const out = [];
  const spielerTxt = modus === 'graben' ? ((o.alarm ? 'Gegner von Beginn an alarmiert, ' : 'Gegner ruhig, ') + (o.lauf ? `laufen auf x~${o.laufX} vor, dann stehend` : 'stehend am Abholpunkt (x~4)')) : 'stehend';
  out.push(`${TITEL[modus]}, ${o.spieler} Spieler (${spielerTxt}, unverwundbar), ${o.sek} s, Seeds 1..${o.seeds}`);
  const all = rows.flatMap((r) => r.samples), gef = all.filter((s) => s.sieht >= 3);
  out.push(`Gefecht entstanden in ${rows.filter((r) => r.samples.some((s) => s.sieht >= 3)).length} von ${rows.length} Seeds, ${gef.length} von ${all.length} Samples im Gefecht` + (modus === 'graben' ? `; Spieler-x am Ende (Seed 1): ${rows[0].spielerX.join(',')}` : ''));
  if (gef.length) {
    out.push(`HAUPTKENNZAHLEN (Gefecht): Anteil Gegner mit Kamerad <= 2 Kacheln ${f2(mean(gef.map((s) => s.klumpFrac)))}   mittlerer Abstand zum naechsten Kameraden ${f2(mean(gef.map((s) => s.nn)))} Kacheln`);
  } else out.push('HAUPTKENNZAHLEN (Gefecht): keine Gefechtssamples, keine Werte');
  for (const [name, S] of [['gesamt', all], ['Gefecht (>=3 Gegner sehen Spieler)', gef]]) {
    out.push(`[${name}] Samples ${S.length}: Gegner ${f2(mean(S.map((s) => s.n)))}  mittl. Paarabstand ${f2(mean(S.map((s) => s.mpd)))}  mittl. Abstand zum naechsten Kameraden ${f2(mean(S.map((s) => s.nn)))}  Anteil <=2 Kacheln ${f2(mean(S.map((s) => s.klumpFrac)))}  max Gegner je Deckungsinsel (Mittel ${f2(mean(S.map((s) => s.maxInsel)))}, Maximum ${S.length ? Math.max(...S.map((s) => s.maxInsel)) : NaN})  Inseln mit >=2 Gegnern ${f2(mean(S.map((s) => s.geteilt)))}  Median Abstand zum naechsten Spieler ${f2(mean(S.map((s) => s.medSp)))}`);
  }
  out.push(`freistehende Inseln (ohne Mauern) im Gefecht: Gegner je Insel Maximum ${gef.length ? Math.max(...gef.map((s) => s.maxFrei)) : NaN} (Mittel ${f2(mean(gef.map((s) => s.maxFrei)))}), Inseln mit >=2 Gegnern ${f2(mean(gef.map((s) => s.geteiltFrei)))}, Anteil Samples mit >2 Gegnern an einer freistehenden Insel ${f2(mean(gef.map((s) => (s.maxFrei > 2 ? 1 : 0))))}`);
  const P = gef.filter((s) => s.npin >= 2);
  out.push(`stehende pin-Gegner (>=2) im Gefecht: Samples ${P.length}, mittl. Abstand zum naechsten pin-Kameraden ${f2(mean(P.map((s) => s.pnn)))}, mittl. Anzahl pin ${f2(mean(P.map((s) => s.npin)))}`);
  out.push(`Samples mit Flankierer (Anteil, alle Samples): ${f2(mean(all.map((s) => s.flanker)))}`);
  const mitGross = gef.filter((s) => s.gueltig != null);
  out.push(`TRUPP-GEHIRN: Anteil Gefechts-Samples mit gueltiger Verteilung (jeder Trupp ab 4 Lebenden >=1 niederhalten und >=1 flanke) ${mitGross.length ? f2(mean(mitGross.map((s) => s.gueltig))) : 'n/a'} (Gefechts-Samples mit Trupp ab 4: ${mitGross.length} von ${gef.length})`);
  const verteil = {}; let summe = 0;
  for (const s of gef) for (const [a, k] of Object.entries(s.aufg)) { verteil[a] = (verteil[a] || 0) + k; summe += k; }
  out.push('Verteilung der Aufgaben (Gefecht, Anteil an Gegner-Samples): ' + (summe ? Object.entries(verteil).sort((a, b) => b[1] - a[1]).map(([a, k]) => a + ' ' + f2(k / summe)).join(', ') : 'keine Gefechtssamples'));
  if (modus === 'graben') {
    const H = all.filter((s) => s.halten), Hg = H.filter((s) => s.sieht >= 3);
    const rate = (S) => (S.length ? f2(S.reduce((a, s) => a + s.halten.drin, 0) / S.reduce((a, s) => a + s.halten.n, 0)) : 'n/a');
    const minF = (S) => (S.length ? f2(Math.min(...S.map((s) => s.halten.drin / s.halten.n))) : 'n/a');
    out.push(`HALTEN (Ziel >= 0,80): Anteil der lebenden Welle 1 in Stellungen ab Alarm, solange kein Rueckzug: ${rate(H)} (Samples ${H.length}, schlechtestes Sample ${minF(H)}); nur Gefechts-Samples: ${rate(Hg)} (${Hg.length})`);
    out.push(`RUECKZUG/GEGENSTOSS: Seeds mit Rueckzug ${rows.filter((r) => r.samples.some((s) => s.rzz > 0)).length} von ${rows.length} (Summe Ausloesungen ${rows.reduce((a, r) => a + Math.max(0, ...r.samples.map((s) => s.rzz)), 0)}), Gegenstoesse gesamt ${rows.reduce((a, r) => a + Math.max(0, ...r.samples.map((s) => s.gst)), 0)}, Seeds mit Alarm ${rows.filter((r) => r.samples.some((s) => s.halten || s.rz)).length}`);
  }
  for (const r of rows) { const g2 = r.samples.filter((s) => s.sieht >= 3); out.push(`seed ${r.seed}: Gefechtssamples ${g2.length}, Paarabstand ${f2(mean(g2.map((s) => s.mpd)))}, nn ${f2(mean(g2.map((s) => s.nn)))}, <=2 ${f2(mean(g2.map((s) => s.klumpFrac)))}, maxInsel ${g2.length ? Math.max(...g2.map((s) => s.maxInsel)) : 0}, Tickfehler ${r.fehler}`); }
  if (o.verlauf && rows[0]) out.push('Verlauf seed 1:\n' + rows[0].samples.filter((s, i) => i % 10 === 0).map((s) => `t${s.t}: n${s.n} mpd${f2(s.mpd)} nn${f2(s.nn)} sieht${s.sieht} maxInsel${s.maxInsel} spD${f2(s.medSp)} ${JSON.stringify(s.roll)}`).join('\n'));
  return out.join('\n');
}

function argumente(argv) {
  const o = { modus: null, seeds: 6, spieler: 3, sek: 60, lauf: false, laufX: 22, staerke: 'gross', verlauf: false, selbsttest: false, alarm: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], nxt = () => argv[++i];
    if (a === '--seeds') o.seeds = +nxt(); else if (a === '--spieler') o.spieler = +nxt(); else if (a === '--sek') o.sek = +nxt();
    else if (a === '--lauf') { o.lauf = true; if (argv[i + 1] && /^\d+$/.test(argv[i + 1])) o.laufX = +nxt(); }
    else if (a === '--staerke') o.staerke = nxt(); else if (a === '--alarm') o.alarm = true; else if (a === '--verlauf') o.verlauf = true; else if (a === '--selbsttest') o.selbsttest = true;
    else if (!a.startsWith('--') && !o.modus) o.modus = a;
    else { console.error('unbekanntes Argument: ' + a); process.exit(2); }
  }
  return o;
}

function selbsttest() {
  let fails = 0;
  const ok = (c, m) => { if (!c) { fails++; console.log('  FEHLER ' + m); } else console.log('  ok ' + m); };
  const lauf = (modus, extra) => { const o = Object.assign({ modus, seeds: 2, spieler: 3, sek: 20, lauf: false, laufX: 22, staerke: 'gross' }, extra || {}); const rows = []; for (let s = 1; s <= o.seeds; s++) rows.push(messLauf(modus, o, s)); return { o, rows, txt: auswerten(modus, o, rows) }; };
  for (const [modus, extra, name] of [['endkampf', null, 'endkampf'], ['besetzen', { sek: 10, seeds: 1 }, 'besetzen'], ['graben', { lauf: true }, 'graben --lauf'], ['graben', { lauf: true, alarm: true }, 'graben --lauf --alarm']]) {
    const { rows, txt } = lauf(modus, extra);
    const gef = rows.flatMap((r) => r.samples).filter((s) => s.sieht >= 3);
    ok(rows.every((r) => r.samples.length > 0 && r.fehler === 0), `${name}: Samples vorhanden, keine Tickfehler`);
    ok(gef.length > 0 && Number.isFinite(mean(gef.map((s) => s.klumpFrac))) && Number.isFinite(mean(gef.map((s) => s.nn))), `${name}: Hauptkennzahlen endlich (${gef.length} Gefechtssamples)`);
    ok(/Eisenwald|Grabenangriff/.test(txt.split('\n')[0]) && (modus !== 'besetzen' || /besetzen/.test(txt.split('\n')[0])) && (modus !== 'endkampf' || /Endkampf/.test(txt.split('\n')[0])), `${name}: Ueberschrift passt zum Modus`);
  }
  { const { o, rows } = lauf('graben', { seeds: 1, sek: 4 }); ok(rows[0].samples[0].n === 12, `graben: 12 Gegner bei Crew 3 (${rows[0].samples[0].n})`); ok(o.spieler === 3 && rows[0].spielerX.every((x) => x <= 8), 'graben ohne --lauf: Spieler stehen am Abholpunkt'); }
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
