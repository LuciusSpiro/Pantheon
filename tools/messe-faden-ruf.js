'use strict';
// SUND-04a-2 Nacharbeit Welle 3: Ruf-Tempo der Geschichtsfaeden mit einer SPIELENDEN Crew (statt der Obergrenze 2,9 % aus P2). Drei Schritte, alles mit echten Hooks:
//   A. Spielende Crew: Bot in der Freien Fahrt Sund (FAEDEN=1, Mock-Spielleiter) oeffnet fortlaufend Faeden ueber echte Notruf-Ausgaenge, antwortet auf Bitten (annehmen), fliegt zum Notruf-Ort, liefert
//      Fracht ab (andocken), vernichtet die Gegner der Faden-Szenen (echte Szenen mit Vorwarnung und Vorlauf; der Ausgang kommt aus kampfTakt/Verfolgung) und laesst die Spontanhilfe an der Frist enden.
//      Gemessen: Rom-Ruf aus Faeden je Taetigkeit (eine Taetigkeit je Runde, die schnellste Crew, die es gibt: nie weniger Zeit zwischen den Taetigkeiten), abgeschlossene Faeden, Deckel.
//   B. Taetigkeiten je Sprung: Zufallsgang mit echten Spruengen (wie sim-ruf --messen), FAEDEN=1: Zuwachs des Taetigkeitszaehlers je Sprung.
//   C. Wirkung auf die Rangleiter: Ruf je Sprung = A (je Taetigkeit) mal B, in den Monte-Carlo-Lauf von sim-ruf.js gegeben (--posten/--posten-delta), Tribun und Centurio gegen die Basis ohne Faeden.
//   node tools/messe-faden-ruf.js [--seeds 6] [--taetigkeiten 400] [--spruenge 60] [--mc-seeds 1000]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
process.chdir(path.join(__dirname, '..'));
const args = process.argv.slice(2);
const val = (k, d) => { const i = args.indexOf(k); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const SEEDS = Math.max(1, Number(val('--seeds', 6)) | 0), TAET = Math.max(50, Number(val('--taetigkeiten', 400)) | 0), SPR = Math.max(10, Number(val('--spruenge', 60)) | 0), MC = Math.max(100, Number(val('--mc-seeds', 1000)) | 0);
const V = require('./test-faden-vorlagen.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Sektoren = require('../shared/sektoren.js');
const Space = require('../server/sim/space.js');
const Bitte = require('../server/sim/faden-bitte.js');
const Fracht = require('../server/sim/faden-fracht.js');
const D = require('../server/sim/faden-daten.js');
const BWD = require('../content/faeden/bitte-werte.json').werte;
const AUSLOESER = [['notruf_pirat_frachter', '0403', 'dankbarer_captain'], ['notruf_pirat_haendler', '0403', 'entfuehrter_haendler'], ['notruf_havarie_konvoi', '0203', 'falscher_haendler']];
const ab = (g) => { const s = g.ship; s.docked = false; s.dockedAt = null; s.helm.stage = 1; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; };
const ankunft = (g, hex) => { Space.enterScene(g, Sektoren.ortVonHex(hex), {}); ab(g); };
const quantil = (l, q) => { const s = l.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };

async function spielendeCrew(seed) {
  const g = V.neu(seed);
  const w = g.weltsim.zustand;
  const romSeit = () => g.weltsim.ruf.rom;
  ankunft(g, '0305');
  { const d = require('../server/weltsim/daten.js').datenVon(w); const z = Object.keys(w.hexe).find((k) => w.hexe[k].besitzer === 'rom' && d.hex[k].hafen === ''); if (z) { w.hexe[z].posten = true; } }
  const ruf0 = romSeit();
  let abgeschlossen = 0, gelungen = 0, naechster = 0, szenen = 0;
  const gesehen = new Set();
  for (let r = 0; r < TAET; r++) {
    Kriegslage.tick(g, 'test');
    const aktive = V.liste(g).filter((f) => f.phase !== 'abgeschlossen');
    if (!aktive.length && !g.weltsim.faeden.angebote.length) {   // der naechste Faden: ein Notruf mit Person am Ausgang (echter Hook)
      const [ev, hex] = AUSLOESER[naechster++ % AUSLOESER.length];
      V.notrufOhneOrt(g, ev, hex, 'gelungen');
    } else g.lageGrenze('szene_ende');
    await V.pumpen(g, 3);
    for (const f of V.liste(g)) {
      if (f.phase === 'abgeschlossen') { if (!gesehen.has(f.id)) { gesehen.add(f.id); abgeschlossen++; if (f.ausgang.art === 'gelungen') gelungen++; } continue; }
      if (f.phase !== 'laeuft' || !f.laufend) continue;
      const typ = D.vorlage(f.vorlage).beats[f.beat].typ;
      if (typ === 'bitte') { const off = Bitte.offen(g); if (off && off.fadenId === f.id) Bitte.beantworten(g, 'annehmen', off.nr); }
      else if (typ === 'notruf') ankunft(g, f.parameter.ort);
      else if (typ === 'fracht') { if (f.fracht) { ankunft(g, f.fracht.nach); g.missionEvent('docked', {}); ab(g); } }
      else if (['raumschlacht', 'befreiung', 'verfolgung'].includes(typ)) {
        for (let i = 0; i < 900 && !(g.fadenSzene && g.fadenSzene.phase === 'kampf'); i++) await V.pumpen(g, 1);
        const fs2 = g.fadenSzene;
        if (fs2 && fs2.phase === 'kampf') {
          if (typ === 'verfolgung') { const z = g.space.verfolgung && g.space.verfolgung.ziel; const e = g.space.enemies.find((x) => x.id === z); if (e) Space.damageEnemy(g, e, 99999, e.x, e.y); }
          else for (const e of g.space.enemies.filter((x) => x.tag === fs2.tag)) Space.damageEnemy(g, e, 99999, e.x, e.y);
          szenen++;
          await V.pumpen(g, 6);
        }
      }
    }
  }
  return { ruf: romSeit() - ruf0, taetigkeiten: g.weltsim.faeden.t, abgeschlossen, gelungen, szenen, fehler: g.errors };
}

async function sprungGang(seed) {
  const { Game } = require('../server/game.js');
  const Sprung = require('../server/sim/sprung.js');
  const HZ = require('../shared/config.js').tickHz;
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-faruf-'));
  let zs = (seed * 2654435761) >>> 0;
  const zufall = () => { zs = (zs + 0x6D2B79F5) >>> 0; let t = zs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: TMP, seed, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie'), FAEDEN: '1' }, log: () => {} });
  const conn = { inbox: [], send() {}, sendRaw() {} };
  g.addConnection(conn); g.handleMessage(conn, { t: 'hello', clientId: 'M0', name: 'Bot', color: 0 });
  g.handleMessage(conn, { t: 'lobbyOpt', startMission: 'freie_fahrt' }); g.handleMessage(conn, { t: 'ready', ready: true });
  for (let i = 0; i < 30; i++) g.step();
  const hier = () => Sektoren.hexVonOrt(g.ship.scene);
  const place = (x, y) => { const s = g.ship; s.helm.stage = 1; s.docked = false; s.dockedAt = null; s.x = x; s.y = y; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; };
  let spruenge = 0;
  for (let n = 0; n < SPR; n++) {
    const von = hier(); const kand = [];
    for (const h of Sektoren.nachbarn(von)) { if (!Sektoren.spielbar(h) || !Sektoren.ortVonHex(h) || Sektoren.istLeerraum(h)) continue; g.explore.markBoje(Sektoren.kanteId(von, h)); if (Sprung.hexGrund(g, von, h)) continue; kand.push(h); }
    if (!kand.length) break;
    const ziel = kand[Math.floor(zufall() * kand.length)];
    if (Sprung.selectDest(g, Sektoren.ortVonHex(ziel))) continue;
    const p = Sprung.sprungpunkt(g, ziel); place(p.x - 80, p.y);
    for (let i = 0; i < 40 * HZ && !g.ship.jump.ready; i++) { g.space.enemies = []; g.step(); }
    g.space.enemies = []; g.ship.jump.ready = true;
    if (Sprung.doJump(g)) continue;
    spruenge++;
    g.space.enemies = [];
    g.lageGrenze('szene_ende');   // die Crew spielt die Szene zu Ende (eine Taetigkeitsgrenze je Sprung, grosszuegig gezaehlt)
  }
  const t = g.weltsim && g.weltsim.faeden ? g.weltsim.faeden.t : 0;
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
  return { spruenge, taetigkeiten: t };
}

function monteCarlo(postenJe80, delta) {
  const r = spawnSync(process.execPath, ['tools/sim-ruf.js', '--seeds', String(MC), '--posten', String(postenJe80), '--posten-delta', String(delta), '--json'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const j = JSON.parse(r.stdout);
  const z = j.ergebnis[0].raenge;
  return { optio: z.optio && z.optio.median, centurio: z.centurio && z.centurio.median, tribun: z.tribun && z.tribun.median };
}

(async () => {
  const A = [];
  for (let s = 0; s < SEEDS; s++) A.push(await spielendeCrew(400 + s));
  const sum = (k) => A.reduce((a, x) => a + x[k], 0);
  const rufJeTaet = sum('ruf') / sum('taetigkeiten');
  console.log(`A. Spielende Crew (${SEEDS} Partien x ${TAET} Runden): Rom-Ruf aus Faeden ${sum('ruf').toFixed(2)} in ${sum('taetigkeiten')} Taetigkeiten = ${(rufJeTaet * 100).toFixed(3)} je 100 Taetigkeiten; Faeden abgeschlossen ${sum('abgeschlossen')}, davon gelungen ${sum('gelungen')}, echte Kampf-Szenen ${sum('szenen')}, Serverfehler ${sum('fehler')}`);
  console.log(`   Deckel (bitte-werte ruf_deckel): ${BWD.ruf_deckel.wert} je ${BWD.fenster_taetigkeiten.wert} Taetigkeiten = ${(BWD.ruf_deckel.wert / BWD.fenster_taetigkeiten.wert * 100).toFixed(3)} je 100; Abschluss-Ruf zaehlt im selben Deckel`);
  const B = [];
  for (let s = 0; s < Math.max(2, Math.min(SEEDS, 4)); s++) B.push(await sprungGang(500 + s));
  const sp = B.reduce((a, x) => a + x.spruenge, 0), tj = B.reduce((a, x) => a + x.taetigkeiten, 0);
  const taetJeSprung = tj / sp;
  console.log(`B. Zufallsgang mit echten Spruengen (${B.length} Partien): ${sp} Spruenge, ${tj} Taetigkeiten = ${taetJeSprung.toFixed(2)} je Sprung (hoechstens eine Grenze je Sprung wird gezaehlt)`);
  const rufJeSprung = rufJeTaet * Math.max(taetJeSprung, 1);   // Obergrenze: mindestens eine Taetigkeit je Sprung angenommen
  console.log(`C. Faden-Ruf je Sprung (A mal max(B, 1)): ${rufJeSprung.toFixed(4)} Rom; je 80 Spruenge ${(rufJeSprung * 80).toFixed(3)}`);
  const delta = 0.25, posten = rufJeSprung * 80 / delta;
  const basis = monteCarlo(0, delta), mit = monteCarlo(posten, delta);
  const pct = (a, b) => (a && b ? (100 * (a - b) / a).toFixed(1) + ' % frueher' : 'k. A.');
  console.log(`   Rangleiter (Monte-Carlo, ${MC} Laeufe, Median in Spruengen): Optio ${basis.optio} -> ${mit.optio} (${pct(basis.optio, mit.optio)}), Centurio ${basis.centurio} -> ${mit.centurio} (${pct(basis.centurio, mit.centurio)}), Tribun ${basis.tribun} -> ${mit.tribun} (${pct(basis.tribun, mit.tribun)})`);
  console.log(`   Vorgabe aus P2: hoechstens 3 % frueher (Obergrenze 2,9 %).`);
})().catch((e) => { console.error(e); process.exit(1); });
