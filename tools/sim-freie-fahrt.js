'use strict';
// SUND-01 Paket B: Bot-Lauf „Freie Fahrt Sund“ ohne Spielleiter und ohne Eingriff (Abnahme 11, headless).
// Startet den Modus über die Lobby, springt mit echten Sprüngen (Boje bekannt, Ziel wählen, am Sprungpunkt laden, Faltsprung) in einem
// Zufallsgang über alle offenen Kanten der Karte und prüft: ein Tick je Sprung, keine Fehler, die Welt ändert sich (Besitz, Flotten),
// kein Stillstand. Spielzeit läuft durch zügiges Stepping (30 Hz), nicht in Echtzeit.
//   node tools/sim-freie-fahrt.js [--spruenge 100] [--minuten 30] [--seed 7] [--verbose]
//   (--minuten ohne --spruenge: bis die Spielzeit erreicht ist; beide: wer zuerst; ohne beides 100 Sprünge)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const { Game } = require('../server/game.js');
const Sektoren = require('../shared/sektoren.js');
const Sprung = require('../server/sim/sprung.js');
const Kern = require('../server/weltsim/kern.js');

const args = process.argv.slice(2);
const has = (k) => args.includes(k);
const val = (k, d) => { const i = args.indexOf(k); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const SPR = val('--spruenge', null) !== null ? Math.max(1, Number(val('--spruenge')) | 0) : (val('--minuten', null) !== null ? Infinity : 100);
const MIN = val('--minuten', null) !== null ? Math.max(0.1, Number(val('--minuten'))) : Infinity;
const SEED = Number(val('--seed', 7)) | 0;
const VERBOSE = has('--verbose');

// Zufallsgang des Bots: eigener Strom, nie game.rng
let zs = (SEED * 2654435761) >>> 0;
const zufall = () => { zs = (zs + 0x6D2B79F5) >>> 0; let t = zs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

let kernTicks = 0;
const kernOrig = Kern.tick;
Kern.tick = function (...a) { kernTicks++; return kernOrig.apply(this, a); };

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-ff-'));
const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: TMP, seed: SEED, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
const conn = { inbox: [], send() {}, sendRaw() {} };   // Posteingang nicht aufheben (lange Läufe)
g.addConnection(conn);
g.handleMessage(conn, { t: 'hello', clientId: 'FF0', name: 'Bot', color: 0 });
g.handleMessage(conn, { t: 'lobbyOpt', startMission: 'freie_fahrt' });
g.handleMessage(conn, { t: 'ready', ready: true });
const schritt = (n) => { for (let k = 0; k < n; k++) g.step(); };
schritt(30);
const probleme = [];
if (!g.weltsim || g.phase !== 'play') { console.log('FEHLER: Modus nicht gestartet (Phase ' + g.phase + ')'); process.exit(1); }

const place = (x, y) => { const s = g.ship; s.helm.stage = 1; s.docked = false; s.dockedAt = null; s.x = x; s.y = y; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; };
const hexHier = () => Sektoren.hexVonOrt(g.ship.scene);
const besitzKarte = () => Object.fromEntries(Object.entries(g.weltsim.zustand.hexe).map(([c, h]) => [c, (h.besitzer || '-') + (h.posten ? 'P' : '')]));
const flottenBild = () => g.weltsim.zustand.flotten.map((f) => f.id + ':' + f.ort + ':' + f.befehl + ':' + f.ziel).join('|');

// Nachbarn, die der Bot anfliegen darf: spielbare Hexe mit Ort, nicht Leerraum, Kante offen (nach Boje-Fund)
function nachbarn() {
  const von = hexHier();
  const out = [];
  for (const h of Sektoren.nachbarn(von)) {
    if (!Sektoren.spielbar(h) || !Sektoren.ortVonHex(h) || Sektoren.istLeerraum(h)) continue;
    g.explore.markBoje(Sektoren.kanteId(von, h));
    if (Sprung.hexGrund(g, von, h)) continue;
    out.push(h);
  }
  return out;
}
function springe(hex) {
  const e = Sprung.selectDest(g, Sektoren.ortVonHex(hex)); if (e) return e;
  const p = Sprung.sprungpunkt(g, hex); if (!p) return 'kein Sprungpunkt';
  place(p.x - 80, p.y);
  for (let k = 0; k < 30 * 30 && !g.ship.jump.ready; k++) { g.space.enemies = []; g.step(); }   // bis der Antrieb geladen ist (8 s)
  g.space.enemies = [];
  return Sprung.doJump(g);
}

const start = Object.assign({}, besitzKarte());
const besucht = new Set([hexHier()]);
const wechsel = [];                 // Besitzwechsel in der Sim: { tick, hex, von, nach }
let letzterBesitz = Object.assign({}, start);
const startFlotten = flottenBild();
let letzteFlotten = startFlotten;
let leerlauf = 0, laengsteRuhe = 0, ruhe = 0, maxUnterwegs = 0;
const t0 = g.time;
let spruenge = 0, fehlSpruenge = 0;
const k0 = kernTicks;

while (spruenge < SPR && (g.time - t0) / 60 < MIN) {
  const kand = nachbarn();
  if (!kand.length) { probleme.push('Sackgasse bei ' + hexHier()); break; }
  // lieber unbesuchte Hexe (der Gang soll die Karte abdecken), sonst zufällig
  const neu = kand.filter((h) => !besucht.has(h));
  const pool = neu.length && zufall() < 0.7 ? neu : kand;
  const ziel = pool[Math.floor(zufall() * pool.length)];
  const tickVor = g.weltsim.tickZahl;
  const r = springe(ziel);
  if (r || hexHier() !== ziel) { fehlSpruenge++; probleme.push(`Sprung ${hexHier()} -> ${ziel} misslang: ${r || 'Szene unverändert'}`); if (fehlSpruenge > 5) break; continue; }
  spruenge++;
  besucht.add(ziel);
  if (g.weltsim.tickZahl !== tickVor + 1) probleme.push(`Sprung ${spruenge}: Tick-Zähler ${tickVor} -> ${g.weltsim.tickZahl}`);
  // Welt beobachten
  const jetzt = besitzKarte();
  for (const c of Object.keys(jetzt)) if (jetzt[c] !== letzterBesitz[c]) wechsel.push({ tick: g.weltsim.tickZahl, hex: c, von: letzterBesitz[c], nach: jetzt[c] });
  letzterBesitz = jetzt;
  const fb = flottenBild();
  const evN = g.weltsim.ereignisse.filter((e) => e.n === g.weltsim.tickZahl).length;
  if (fb === letzteFlotten && !evN) { leerlauf++; ruhe++; laengsteRuhe = Math.max(laengsteRuhe, ruhe); } else ruhe = 0;
  letzteFlotten = fb;
  maxUnterwegs = Math.max(maxUnterwegs, g.weltsim.zustand.flotten.filter((f) => f.befehl !== 'heim').length);
  if (VERBOSE && spruenge % 10 === 0) console.log(`  Sprung ${spruenge}: ${g.ship.scene}, Tick ${g.weltsim.tickZahl}, Wechsel ${wechsel.length}, Flotten unterwegs ${maxUnterwegs}`);
}

const z = g.weltsim.zustand;
const minuten = (g.time - t0) / 60;
const hexSim = Object.keys(z.hexe).length;
const ticksKern = kernTicks - k0;
const ruheAnteil = spruenge ? leerlauf / spruenge : 1;
const pruefung = [
  [ticksKern === spruenge && g.weltsim.tickZahl === spruenge && z.tick === spruenge, `Ticks == Sprünge (${spruenge} Sprünge, Zähler ${g.weltsim.tickZahl}, Sim ${z.tick}, Kern ${ticksKern})`],
  [g.errors === 0 && g.weltsim.fehler === 0, `keine Fehler (Server ${g.errors}, Sim ${g.weltsim.fehler})`],
  [fehlSpruenge === 0 && probleme.length === 0, 'alle Sprünge gelungen' + (probleme.length ? ' – ' + probleme.slice(0, 3).join('; ') : '')],
  [z.angriffe.length > 0 || maxUnterwegs > 0, `Flotten bewegen sich (höchstens ${maxUnterwegs} unterwegs, ${z.angriffe.length} Feldzüge)`],
  [wechsel.length > 0 || z.angriffe.length > 0 || flottenBild() !== startFlotten, `Welt ändert sich (Besitzwechsel ${wechsel.length}, Feldzüge ${z.angriffe.length})`],
  [laengsteRuhe <= 40 && ruheAnteil <= 0.5, `kein Stillstand (ruhige Ticks ${(ruheAnteil * 100).toFixed(0)} %, längste Ruhe ${laengsteRuhe} Ticks)`],
  [g.phase === 'play', 'Partie läuft'],
];
console.log(`freie fahrt sund: ${spruenge} Sprünge, ${minuten.toFixed(1)} min Spielzeit, ${besucht.size} von ${hexSim} Sim-Hexen besucht, Seed ${SEED}`);
console.log(`  Besitzwechsel ${wechsel.length}${wechsel.length ? ' (' + wechsel.slice(0, 6).map((w) => `${w.hex} ${w.von}>${w.nach}@${w.tick}`).join(', ') + ')' : ''}, Feldzüge ${z.angriffe.length}, Flotten ${z.flotten.length}, Meldungen im Ring ${g.weltsim.ereignisse.length}, Hauptwelt ${g.weltsim.hauptweltGefallen ? 'gefallen' : 'hält'}`);
let fehler = 0;
for (const [okk, t] of pruefung) { if (!okk) fehler++; console.log((okk ? '  ok     ' : '  FEHLER ') + t); }
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
process.exit(fehler ? 1 : 0);
