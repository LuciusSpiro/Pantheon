'use strict';
// SUND-02a A2: Bot-Läufe der Sim-Szene (Freie Fahrt Sund). Der Kampf-Bot ist der vorhandene (tools/sim-headless.js: Agent/GenericAgent, wie im Testgelände).
//   node tools/sim-szene-sund.js [--fall staerke|hafen|posten|frei|ankunft|alle] [--staerke 8,17,40] [--crew 1|3] [--seeds N] [--seed S] [--max 900] [--verbose]
// Läufe (Standard „alle“):
//   staerke  Flotte der Sim (ger) im freien Sektor, Stärke 8, 17, 40: Wellenplan, Verlustpunkte, Ausgang
//   hafen    Belagerung von Ostia Nova (Hafen B, Hafenflotte + Abwehr als Verbündete): Erfolg (Bot kämpft) und Misserfolg (Crew passiv)
//   posten   Posten 0505 (Garnison) gegen Piraten (Erfolg) und Germanen (Misserfolg, Crew passiv)
//   frei     freie Flottenschlacht: Flotte der Sim gegen Crew und eine römische Flotte im Hex, ohne Ort
//   ankunft  Zufallsgang mit echten Sprüngen: wie oft kommt die Crew wo an, wie oft löst das eine Szene aus (Beobachtung)
// Prüft je Lauf die Schnittstelle (nicht den Ausgang): ein Tick am Szenenende, Wirkungen angewandt und nicht verworfen, keine Fehler, kein Softlock.
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const Sim = require('./sim-headless.js');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const Sektoren = require('../shared/sektoren.js');
const Space = require('../server/sim/space.js');
const Szene = require('../server/sim/kriegslage-szene.js');
const Sprung = require('../server/sim/sprung.js');
const Plan = require('../server/weltsim/wellenplan.js');
const Kern = require('../server/weltsim/kern.js');

const args = process.argv.slice(2);
const val = (k, d) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
const FALL = val('--fall', 'alle');
const STAERKEN = val('--staerke', '8,17,40').split(',').map(Number).filter((x) => x > 0);
const CREW = Number(val('--crew', 1)) === 3 ? 3 : 1;
const SEEDS = Math.max(1, Number(val('--seeds', 2)) | 0);
const SEED0 = Number(val('--seed', 11)) | 0;
const MAXSEK = Number(val('--max', 900));
const VERBOSE = args.includes('--verbose');
const HUELLE = Number(val('--huelle', 0));   // Eichung: Hülle der Szenen-Verteidiger in % der Klassenhülle (überschreibt CONFIG.simSzene.verteidiger.huelle)
if (HUELLE > 0) CONFIG.simSzene.verteidiger.huelle = HUELLE;
const HZ = CONFIG.tickHz;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-szenebot-'));
const OSTIA = '0305';
const NAMEN = { raider: 'Jäger', korvette: 'Korvette', fregatte: 'Fregatte', kreuzer: 'Kreuzer' };

// Kampf-Bot wie im Testgelände (ArenaAgent), nur ohne Arena: kämpft, solange Gegner da sind, sonst Pause (Reparatur, Captain an der Konsole)
class SzeneAgent extends Sim.GenericAgent {
  update(S) {
    const p = this.me(S);
    if (!p || S.phase !== 'play') return;
    if (this.opts && this.opts.passiv) return;   // Misserfolgs-Läufe: die Crew tut nichts
    if (this.waitT > 0) { this.waitT -= 1 / HZ; return; }
    if (p.downed) { this.input(0, 0); this.act(false); this.ix = null; return; }
    if (this.reactorDuty(S, p)) return;
    if (S.space.enemies.some((e) => e.kind !== 'relay')) { this.combat(S, p); return; }
    if (this.role === 'captain') { this.captainFight(S, p); return; }
    if (this.role === 'weapons' || this.role === 'solo') { if (this.repairDuty(S, p, { damaged: true, cooldown: 1 })) return; }
    if (this.role === 'weapons') { this.enter(S, 'weapons'); return; }
    if (!this.enter(S, 'helm')) return;
    this.brake(S);
  }
}

const planText = (plan) => plan.wellen.map((w, i) => {
  const t = w.map((g) => g.n + ' ' + NAMEN[g.kind]).join('+');
  return i === plan.wellen.length - 1 ? 'Flaggschiff ' + NAMEN[w[0].kind] + (w.length > 1 ? ' + ' + w.slice(1).map((g) => g.n + ' ' + NAMEN[g.kind]).join('+') : '') : t;
}).join(' | ');

function neuesSpiel(seed, crew, opts) {
  const dir = path.join(TMP, 'w' + Math.random().toString(36).slice(2));
  fs.mkdirSync(dir, { recursive: true });
  const game = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  game.simStats = { reactorRestarts: 0, widescans: 0, wreckDone: false, orders: 0, coverShots: 0, keyTries: 0 };
  const roles = crew === 1 ? ['solo'] : ['helm', 'weapons', 'captain'];
  const agents = roles.map((r, i) => new SzeneAgent(game, i, r, opts || {}));
  game.simAgents = agents;
  game.lobbyOpts.startMission = 'freie_fahrt';
  for (const a of agents) { game.addConnection(a.conn); a.hello(); }
  for (let i = 0; i < 2 * HZ; i++) game.step();
  return { game, agents };
}
const flotteSetzen = (g, hex, fraktion, staerke, belagerung) => {
  const z = g.weltsim.zustand;
  const fl = { id: z.naechsteId++, fraktion, heimat: ({ ger: '1004', pirat: '0602', kon: '0604' })[fraktion] || hex, ort: hex, staerke, kap: Math.max(staerke, 5), befehl: 'rueckzug', ziel: null, warte: 0, versorgung: 1, angriff: null }; fl.ziel = fl.heimat;   // durchziehende Flotte im Feld (die Sim kennt 'heim' nur im eigenen Hafen, dort löst sie keine Szene aus)
  z.flotten.push(fl);
  if (belagerung) {
    const id = z.naechsteAngriffId++;
    z.angriffe.push({ id, t0: z.tick, ziel: hex, von: fraktion, art: fraktion === 'pirat' ? 'pirat' : 'reich', relevant: true, zielArt: z.hexe[hex].posten ? 'posten' : 'hafen', t_an: z.tick, t_ende: null, ausgang: null, phase: 'marsch', t_marsch: z.tick, stuetz: null, flotten: [fl.id] });
    fl.befehl = 'angriff'; fl.ziel = hex; fl.angriff = id;
  }
  return fl;
};

// Ein Lauf: Flotte setzen, Lerche ankommen lassen, Bots kämpfen bis die Szene endet. -> Ergebnisobjekt
async function lauf(name, seed, o) {
  const { game: g, agents } = neuesSpiel(seed, o.crew || CREW, { passiv: !!o.passiv });
  const z = () => g.weltsim.zustand;
  const hex = o.hex || '0505';
  for (const f of z().flotten.filter((f) => f.ort === hex)) z().flotten.splice(z().flotten.indexOf(f), 1);
  if (o.posten) { const h = z().hexe[hex]; h.besitzer = 'rom'; h.posten = true; h.garnison = 4; h.anspruch = {}; g.weltBesitz.hexe[hex] = { besitzer: 'rom', posten: true }; }
  if (o.rom) flotteSetzen(g, hex, 'rom', o.rom);
  const fl = flotteSetzen(g, hex, o.fraktion || 'ger', o.staerke, !!o.belagerung);
  const staerke0 = fl.staerke;
  const rom0 = z().flotten.filter((f) => f.ort === hex && f.fraktion === 'rom').reduce((s, f) => s + f.staerke, 0);
  const abwehr0 = z().hexe[hex].posten && !Kern.datenVon(z()).hex[hex].hafen ? z().hexe[hex].garnison : z().hexe[hex].abwehr;
  const tick0 = g.weltsim.tickZahl; const kern0 = g.stats.kills;
  g.ship.docked = false; g.ship.dockedAt = null;
  Space.enterScene(g, Sektoren.ortVonHex(hex), {});
  g.ship.helm.stage = Math.max(g.ship.helm.stage, 1);
  const S = g.simSzene;
  const res = { name, seed, staerke: o.staerke, hex, ok: false };
  if (!S) { res.fehler = 'keine Szene ausgelöst'; return res; }
  res.plan = planText(S.plan); res.punkte = S.plan.punkte; res.kommandant = S.kommandant && S.kommandant.name; res.verteidiger = S.vert.n0; res.verteidigerPunkte = Math.round(S.vert.gruppen.reduce((s, x) => s + x.eff, 0) * 10) / 10;
  const wellenGroesse = S.plan.wellen.map((w) => w.reduce((s, x) => s + x.n, 0));
  const t0 = g.time; let snap = g.snapshot(); let maxSchiffe = 0; let snapMax = 0; let kills = {}; let wellen = 0; let letzteWelle = 0;
  let ticks = 0;
  while (g.simSzene && g.time - t0 < MAXSEK) {
    g.step(); ticks++;
    if (g.wantsSnapshot()) { snap = g.snapshot(); const b = Buffer.byteLength(JSON.stringify(snap)); if (b > snapMax) snapMax = b; }
    for (const a of agents) a.update(snap);
    maxSchiffe = Math.max(maxSchiffe, g.space.enemies.length + (g.space.escorts || []).filter((q) => q.state !== 'entkommen').length);
    const w = g.flotte && g.flotte.welle; if (w && w.n !== letzteWelle) { letzteWelle = w.n; wellen = w.n; }
    if (VERBOSE && ticks % (30 * HZ) === 0) console.log(`  [t ${(g.time - t0).toFixed(0)}] Welle ${wellen}/${wellenGroesse.length} Gegner ${g.space.enemies.length} Verbündete ${(g.space.escorts || []).filter((q) => q.sim && q.state === 'ok').length} Hülle ${Math.round(require('../server/sim/interior.js').integritaetSnapshot(g).gesamt)} Verluste ${S.killPunkte}`);
    if (ticks % 3000 === 0) await new Promise((r) => setImmediate(r));
  }
  kills = Object.assign({}, S.kills);
  const L = Szene.letzte(g);
  res.dauer = Math.round(g.time - t0); res.wellen = wellen; res.maxSchiffe = maxSchiffe; res.snapMax = snapMax; res.kills = kills; res.killPunkte = S.killPunkte;
  res.verlorenVert = Math.round((S.vert.ges ? S.vert.verloren / S.vert.ges : 0) * 100);
  res.huelle = Math.round(require('../server/sim/interior.js').integritaetSnapshot(g).gesamt); res.notfall = g.stats.emergencies;
  if (g.simSzene) { res.fehler = 'Zeitlimit ' + MAXSEK + ' s (Szene läuft noch, Welle ' + wellen + '/' + wellenGroesse.length + ')'; return res; }
  res.ausgang = L && L.ausgang; res.grund = L && (L.grund || L.schicksal);
  res.wirkungen = L ? L.wirkungen.map((w) => w.typ + (w.punkte != null ? ' ' + w.punkte : '')).join(', ') : '';
  const f1 = z().flotten.find((f) => f.id === fl.id);
  res.restStaerke = f1 ? Math.round(f1.staerke * 10) / 10 : null; res.staerke0 = staerke0;
  res.tickDelta = g.weltsim.tickZahl - tick0;
  res.besitzer = z().hexe[hex].besitzer;
  res.romRest = Math.round(z().flotten.filter((f) => f.ort === hex && f.fraktion === 'rom').reduce((s, f) => s + f.staerke, 0) * 10) / 10; res.rom0 = Math.round(rom0 * 10) / 10; res.abwehr0 = abwehr0;
  const verworfen = L && L.ergebnis ? L.ergebnis.verworfen : -1;
  const probleme = [];
  if (res.tickDelta !== 1) probleme.push('Tickzähler +' + res.tickDelta);
  if (verworfen !== 0) probleme.push('verworfene Wirkungen: ' + verworfen);
  if (g.errors) probleme.push('Fehler ' + g.errors);
  if (res.maxSchiffe > CONFIG.flotte.max) probleme.push('mehr als 12 Schiffe: ' + res.maxSchiffe);
  if (L && L.ausgang === 'sieg' && !L.wirkungen.some((w) => w.typ === 'flaggschiff_gefallen')) probleme.push('Sieg ohne flaggschiff_gefallen');
  if (o.erwarte && L && L.ausgang !== o.erwarte) res.abweichung = 'erwartet ' + o.erwarte;
  res.ok = probleme.length === 0; res.probleme = probleme;
  return res;
}

function zeile(r) {
  if (r.fehler) return `  FEHLER ${r.name} (Seed ${r.seed}): ${r.fehler}`;
  const k = Object.entries(r.kills).map(([c, n]) => n + ' ' + NAMEN[c]).join(', ') || '–';
  return `  ${r.ok ? 'ok    ' : 'FEHLER '}${r.name} Seed ${r.seed}: ${r.ausgang}${r.grund ? ' (' + r.grund + ')' : ''}, ${r.dauer} s, Welle ${r.wellen}/${r.plan.split(' | ').length}, Abschüsse ${k} = ${r.killPunkte} Punkte, Verteidiger ${r.verteidiger} Schiffe${r.verteidiger ? ` (${r.verlorenVert} % verloren)` : ''}, Hülle ${r.huelle}, Notfall ${r.notfall}, Tick +${r.tickDelta}, ${r.besitzer ? 'Besitzer ' + r.besitzer + ', ' : ''}Rest der Flotte ${r.restStaerke}/${r.staerke0}, größte Last ${r.maxSchiffe} Schiffe, Snapshot max ${r.snapMax} B${r.abweichung ? ' [' + r.abweichung + ']' : ''}${r.probleme && r.probleme.length ? ' !! ' + r.probleme.join('; ') : ''}`;
}

// Zufallsgang (wie tools/sim-freie-fahrt.js): echte Sprünge, in den Sektoren mit Szene springt der Bot sofort weiter (Flucht in der Vorwarnung)
async function ankunft(seed, spruenge) {
  let zs = (seed * 2654435761) >>> 0;
  const zufall = () => { zs = (zs + 0x6D2B79F5) >>> 0; let t = zs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const { game: g } = neuesSpiel(seed, 1, { passiv: true });
  g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0; g.C.reise.feindChance = 0;
  const hexe = {}; const szenen = {}; let n = 0; let sperren = 0;
  const hier = () => Sektoren.hexVonOrt(g.ship.scene);
  hexe[hier()] = 1;
  const place = (x, y) => { const s = g.ship; s.helm.stage = 1; s.docked = false; s.dockedAt = null; s.x = x; s.y = y; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; };
  for (; n < spruenge; n++) {
    const von = hier(); const kand = [];
    for (const h of Sektoren.nachbarn(von)) {
      if (!Sektoren.spielbar(h) || !Sektoren.ortVonHex(h) || Sektoren.istLeerraum(h)) continue;
      g.explore.markBoje(Sektoren.kanteId(von, h));
      if (Sprung.hexGrund(g, von, h)) continue;
      kand.push(h);
    }
    if (!kand.length) break;
    const ziel = kand[Math.floor(zufall() * kand.length)];
    if (Sprung.selectDest(g, Sektoren.ortVonHex(ziel))) { sperren++; continue; }
    const p = Sprung.sprungpunkt(g, ziel); place(p.x - 80, p.y);
    for (let k = 0; k < 40 * HZ && !g.ship.jump.ready; k++) { g.space.enemies = []; g.step(); }
    g.space.enemies = []; g.ship.jump.ready = true;
    if (Sprung.doJump(g)) { sperren++; continue; }
    const h = hier(); hexe[h] = (hexe[h] || 0) + 1;
    if (g.simSzene) szenen[h] = (szenen[h] || 0) + 1;
  }
  return { sprunge: n, hexe, szenen, errors: g.errors, tick: g.weltsim.tickZahl, sperren };
}

(async () => {
  let fehler = 0;
  const tabelle = [];
  const alle = FALL === 'alle';
  const zeigen = (r) => { console.log(zeile(r)); if (r.fehler || !r.ok) fehler++; tabelle.push(r); };
  if (alle || FALL === 'staerke') {
    console.log(`\nStärke (freier Sektor 0505, Germanen, Crew ${CREW}, Bot kämpft)`);
    for (const s of STAERKEN) {
      for (let k = 0; k < SEEDS; k++) {
        const r = await lauf(`Stärke ${s}`, SEED0 + k, { staerke: s, hex: '0505' });
        if (k === 0 && r.plan) console.log(`  Plan Stärke ${s}: ${r.plan}  (${r.punkte} Punkte, Kommandant ${r.kommandant})`);
        zeigen(r);
      }
    }
    const rein = STAERKEN.map((s) => `${s}: ${planText(Plan.plane({ staerke: s, seed: 1 }))}`);
    console.log('  Referenz Wellenplan ohne Bauweise (plane ohne volk): ' + rein.join('  ||  '));
  }
  if (FALL === 'eichung') {   // Eichung der Verteidiger-Hülle: Crew passiv, nur die Hafenflotte gegen Stärke S (Ausgang je Hülle in %)
    const hs = val('--huellen', '100,50,30').split(',').map(Number);
    const ss = val('--staerke', '8,17,27,40').split(',').map(Number);
    console.log(`
Eichung (Hafen Ostia Nova, Crew passiv, ${SEEDS} Seeds je Zelle): Zelle = Siege/Läufe, mittlerer Verlust der Verteidiger in %`);
    console.log('  Hülle % | ' + ss.map((s) => 'Stärke ' + s).join(' | '));
    for (const h of hs) {
      CONFIG.simSzene.verteidiger.huelle = h;
      const zellen = [];
      for (const s of ss) {
        let sieg = 0, verl = 0, patt = 0;
        for (let k = 0; k < SEEDS; k++) { const r = await lauf('eichung', SEED0 + k, { staerke: s, hex: OSTIA, belagerung: true, passiv: true }); if (r.ausgang === 'sieg') sieg++; if (!r.ausgang) patt++; verl += r.verlorenVert || 0; }
        zellen.push(`${sieg}/${SEEDS}, ${Math.round(verl / SEEDS)} %${patt ? ', Patt ' + patt : ''}`);
      }
      console.log(`  ${String(h).padStart(7)} | ${zellen.join(' | ')}`);
    }
  }
  if (alle || FALL === 'hafen') {
    console.log(`\nHafen Ostia Nova unter Belagerung (Germanen 17, Crew ${CREW})`);
    for (let k = 0; k < SEEDS; k++) zeigen(await lauf('Hafen Erfolg', SEED0 + k, { staerke: 17, hex: OSTIA, belagerung: true, erwarte: 'sieg' }));
    for (let k = 0; k < SEEDS; k++) zeigen(await lauf('Hafen Misserfolg (Crew passiv, Germanen 40)', SEED0 + k, { staerke: 40, hex: OSTIA, belagerung: true, passiv: true, erwarte: 'niederlage' }));
  }
  if (alle || FALL === 'posten') {
    console.log(`\nPosten 0505 (Garnison 4 + Verbündete, Crew ${CREW})`);
    for (let k = 0; k < SEEDS; k++) zeigen(await lauf('Posten Erfolg (Piraten 6)', SEED0 + k, { staerke: 6, fraktion: 'pirat', hex: '0505', posten: true, belagerung: true, erwarte: 'sieg' }));
    for (let k = 0; k < SEEDS; k++) zeigen(await lauf('Posten Misserfolg (Crew passiv, Germanen 20)', SEED0 + k, { staerke: 20, hex: '0505', posten: true, belagerung: true, passiv: true, erwarte: 'niederlage' }));
  }
  if (alle || FALL === 'frei') {
    console.log(`\nFreie Flottenschlacht (Germanen 17 gegen Crew und eine römische Flotte 8 im Sektor, Crew ${CREW})`);
    for (let k = 0; k < SEEDS; k++) zeigen(await lauf('Freie Schlacht', SEED0 + k, { staerke: 17, hex: '0505', rom: 8 }));
  }
  if (alle || FALL === 'ankunft') {
    console.log('\nAnkunft (Zufallsgang, echte Sprünge, 120 Sprünge je Seed; der Bot springt in einer Szene sofort weiter)');
    const gesamt = {}; const szenenGes = {}; let spr = 0;
    for (let k = 0; k < Math.max(SEEDS, 3); k++) {
      const r = await ankunft(SEED0 + k, 120);
      spr += r.sprunge;
      for (const [h, n] of Object.entries(r.hexe)) gesamt[h] = (gesamt[h] || 0) + n;
      for (const [h, n] of Object.entries(r.szenen)) szenenGes[h] = (szenenGes[h] || 0) + n;
      const nSz = Object.values(r.szenen).reduce((a, b) => a + b, 0);
      console.log(`  Seed ${SEED0 + k}: ${r.sprunge} Sprünge, Ostia Nova ${r.hexe[OSTIA] || 0}× angekommen (${r.szenen[OSTIA] || 0} mit Szene), alle Szenen ${nSz}, Tick ${r.tick}, Fehler ${r.errors}`);
      if (r.errors) fehler++;
    }
    const top = Object.entries(gesamt).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([h, n]) => `${Sektoren.hexName(h) || h} ${n}`).join(', ');
    const nSz = Object.values(szenenGes).reduce((a, b) => a + b, 0);
    const szTop = Object.entries(szenenGes).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([h, n]) => `${Sektoren.hexName(h) || h} ${n}`).join(', ');
    console.log(`  Szenen am häufigsten in: ${szTop || '–'}`);
    console.log(`  Summe: ${spr} Sprünge, Ostia Nova ${gesamt[OSTIA] || 0}× (${((gesamt[OSTIA] || 0) / Math.max(1, spr) * 100).toFixed(1)} % der Ankünfte, Szene dort ${szenenGes[OSTIA] || 0}×); Szenen insgesamt ${nSz} (${(nSz / Math.max(1, spr) * 100).toFixed(1)} % der Ankünfte); häufigste Ankunftsorte: ${top}`);
  }
  console.log(`\n${fehler ? 'FEHLER: ' + fehler + ' Lauf/Läufe mit Befund' : 'SIM-SZENE OK'}`);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
  process.exit(fehler ? 1 : 0);
})();
