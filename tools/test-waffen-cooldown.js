'use strict';
// SYS-01 B1: Cooldown statt Salven. Ein Projektil je Zyklus für Standardbatterie, Sturmbatterie, Standardkanone und Abwehrturm; die Streubatterie behält die Salve.
// Zyklus = ladekosten / Ladepunkte am Pool. Dauerleistung am Pool je Waffe darf den Ist-Wert der Erkundung (Auftrag SYS-01 – Erkundung, Frage 1d) um höchstens 3 % überschreiten.
// Waffenrollen: Lanze (Schildpierce 2, Vollladung durchschlägt den Schild), Sturm (Schild fällt, Regeneration gesperrt, kein Systemschaden), Torpedo (Lesart B),
// Katalog ohne Feld stoss. Lücke: Zonen der Gegner gibt es noch nicht (Paket C), deshalb prüft die Standardbatterie-Regel hier den Schild 0 statt der geleerten Zone.
//   node tools/test-waffen-cooldown.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const CONFIG = require('../shared/config.js');
const Katalog = require('../shared/schiffskatalog.js');
const Maps = require('../shared/maps.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Waffen = require('../server/sim/schiffswaffen.js');
const Ausbau = require('../server/sim/ausbau.js');

const DT = 1 / CONFIG.tickHz;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const info = (t) => console.log('  info ' + t);
const near = (a, b, tol) => Math.abs(a - b) <= tol;
function section(name, body) {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 6).join(' | ')); }
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-waffen-cooldown-'));

// Testgelände wie test-waffen-schiff: Lerche mitten im Feld, Bug nach +x, Ops besetzt, unverwundbar
function arena() {
  const g = new Game({ noStore: true, worlds: false, seed: 21, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'C0', name: 'Cooldown', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' }); g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.space.enemies = []; g.space.projectiles = [];
  const sh = g.ship; sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.angle = 0; sh.vx = 0; sh.vy = 0; sh.turnVel = 0;
  g.god = true; g.players[0].console = 'weapons';
  const run = (sec, each) => { for (let k = 0; k < Math.round(sec / DT); k++) { if (each) each(); g.step(); } };
  return { g, c, run };
}
// Pool 4 = Energie 2 + 2 Ladepunkte (wie die Erkundung)
function poolVier(g) { g.ship.powerIntent = { engines: 2, shields: 2, weapons: 2 }; Object.assign(g.ship.power, g.ship.powerIntent); }
// Waffe auf ihren Platz (Ausbaustufe passend), übrige Plätze leer
function bestueck(g, platz, id) {
  const stufe = Maps.waffenplatz(platz).stufe;
  Ausbau.setStufe(g, stufe);
  for (const p of Maps.WAFFENPLAETZE) if (stufe >= p.stufe) Waffen.bestuecken(g, p.platz, p.platz === platz ? id : 'leer');
}
// Gegner still, ohne Schild (oder mit Schild s), mit fast unendlicher Hülle; pin hält die Position fest
function ziel(g, kind, dx, dy, schild) {
  const sh = g.ship; const e = space.spawnEnemy(g, kind, { x: sh.x + dx, y: sh.y + dy, facing: Math.PI });
  e.shields = e.shields.map(() => (schild == null ? 0 : schild)); e.hp = e.hpMax = 1e9; e.pin = { x: e.x, y: e.y, angle: e.angle };
  return e;
}
function pin(g) {
  g.ship.vx = 0; g.ship.vy = 0;
  for (const e of g.space.enemies) if (e.pin) { e.x = e.pin.x; e.y = e.pin.y; e.angle = e.pin.angle; e.vx = 0; e.vy = 0; e.fireT = -999; e.boltT = -999; if (e.sf) e.sf.t = -999; e.tele = null; e.streuG = -999; e.torpG = -999; }
}
// Ziel je Waffe: Platz, Gegnerklasse und Position (Bogen und Reichweite passen)
const SCHUSS_ZIELE = {
  standardbatterie: { platz: 4, ziel: ['korvette', 0, -300] }, sturmbatterie: { platz: 4, ziel: ['korvette', 0, -300] },
  standardkanone: { platz: 5, ziel: ['korvette', 300, 0] }, abwehrturm: { platz: 2, ziel: ['raider', -120, 90] },
};
// Ist-Werte Erkundung 1d (gemessen, 100 % Treffer, ruhende Ziele): Schaden/s bei 1 / 2 / 4 Punkten
const IST = {
  standardbatterie: [0.60, 1.20, 2.20], sturmbatterie: [0.56, 1.03, 1.87], standardkanone: [0.60, 1.25, 2.27], abwehrturm: [0.32, 0.64, 1.26],
};
// Messung am Pool: Ops feuert bei Bereitschaft, Schüsse nach t = 10 s zählen. Liefert Schaden je Sekunde (Fenster 10 … sek), Zeitpunkte der Schüsse.
function messe(id, punkte, sek) {
  const T = arena(); const g = T.g; const z = SCHUSS_ZIELE[id];
  bestueck(g, z.platz, id); poolVier(g);
  ziel(g, z.ziel[0], z.ziel[1], z.ziel[2], 0);
  const mid = Katalog.mountId(z.platz);
  g.ship.wAllocIntent = { [mid]: punkte };
  const zeiten = []; let dmg0 = null;
  for (let t = 0; t < sek; t += DT) {
    pin(g);
    const m = g.ship.mount[mid];
    if (m && m.charge >= 1 && !(m.salvo > 0)) { Waffen.weaponsFire(g, mid); if (t >= 10) zeiten.push(t); }
    g.step();
    if (dmg0 == null && t >= 10) dmg0 = (g.stats.waffenSchaden || {}).gesamt || 0;
  }
  const dmg = ((g.stats.waffenSchaden || {}).gesamt || 0) - (dmg0 || 0);
  return { rate: dmg / (sek - 10), zeiten };
}

section('Katalog: ein Projektil je Zyklus, kein Feld stoss', () => {
  for (const id of ['standardbatterie', 'sturmbatterie', 'standardkanone', 'abwehrturm']) {
    const w = Katalog.waffe(id);
    ok(w.rohre === 1 && w.energie && w.ladekosten > 0, `${id}: rohre 1 (ein Projektil je Zyklus), Ladekosten ${w.ladekosten} s je Punkt`);
  }
  ok(Katalog.waffe('streubatterie').rohre === 3 && Katalog.waffe('streubatterie').salvoGap > 0, 'Streubatterie: Salve bleibt (drei Granaten)');
  ok(Katalog.WAFFEN.every((w) => !('stoss' in w)), 'kein Katalogeintrag hat mehr das Feld stoss');
  ok(near(Katalog.volley('standardbatterie'), 2.9, 1e-9) && Katalog.volley('lanze') === 12 && Katalog.volley('torpedowerfer') === 0, 'Ladung = schaden × rohre: Standardbatterie 2,9, Lanze 12, Torpedo 0');
  ok(near(Katalog.MAGAZINDECKEL.stossStart, 12 + 2 * 2.9, 1e-9) && near(Katalog.MAGAZINDECKEL.stossMax, 1.5 * Katalog.MAGAZINDECKEL.stossStart, 1e-9),
    `Magazindeckel: Start-Lerche ${Katalog.MAGAZINDECKEL.stossStart.toFixed(2)} (Lanze 12 + 2 × 2,9), Obergrenze ${Katalog.MAGAZINDECKEL.stossMax.toFixed(2)}`);
  const P = CONFIG.spaceM3.mounts.port;
  ok(P.tubes === 1 && P.secPerPoint === 5 && P.damage === Katalog.waffe('standardbatterie').schaden && P.salvoGap === undefined, 'Config spaceM3.mounts.port = Katalog (Rohre 1, 5 s, Schaden 2,9)');
  ok(Katalog.waffe('sturmbatterie').gegner.burst === 8 && Katalog.waffe('sturmbatterie').gegner.burstGap === 0.07, 'Gegner-Sperrfeuer (Sturm): acht Nadeln, Takt 0,07 s – vom Katalogwert der Lerche entkoppelt');
  ok(Katalog.TORPEDO.schildUmgehung === 'nur-ohne-schild' && Katalog.TORPEDO.cooldown === 10, 'Torpedo unverändert (Lesart B, Cooldown 10 s)');
});

section('Ein Projektil je Schuss (Standardbatterie, Sturm, Kanone, Abwehrturm); Streu bleibt Salve', () => {
  for (const id of ['standardbatterie', 'sturmbatterie', 'standardkanone', 'abwehrturm']) {
    const T = arena(); const g = T.g; const z = SCHUSS_ZIELE[id];
    bestueck(g, z.platz, id); poolVier(g);
    ziel(g, z.ziel[0], z.ziel[1], 40);   // Schild 40: der Schuss bleibt im Feld
    const mid = Katalog.mountId(z.platz);
    g.ship.wAllocIntent = { [mid]: 1 };
    g.ship.mount[mid].charge = 1; const s0 = g.stats.schuesse || 0;
    pin(g); Waffen.weaponsFire(g, mid); g.step();
    const neue = g.space.projectiles.filter((q) => q.waffe === id).length;
    ok(neue === 1 && (g.stats.schuesse || 0) - s0 === 1, `${id}: ein Schuss = ein Projektil (${neue})`);
  }
  const T = arena(); const g = T.g; bestueck(g, 4, 'streubatterie'); poolVier(g);
  ziel(g, 'korvette', 0, -300, 40);
  g.ship.wAllocIntent = { port: 1 };
  g.ship.mount.port.charge = 1; pin(g); Waffen.weaponsFire(g, 'port');
  T.run(1.0, () => pin(g));
  const gren = g.space.projectiles.filter((q) => q.kind === 'streu').length;
  ok(gren === 3, `streubatterie: Salve = ${gren} Granaten (drei Rohre, Abstand 0,4 s)`);
});

section('Zyklus = ladekosten / Ladepunkte (1, 2, 4)', () => {
  for (const id of ['standardbatterie', 'standardkanone', 'sturmbatterie']) {
    const cyc = [];
    for (const p of [1, 2, 4]) {
      const r = messe(id, p, 40);
      const w = Katalog.waffe(id);
      const soll = w.ladekosten / p;
      const diffs = []; for (let i = 1; i < r.zeiten.length; i++) diffs.push(r.zeiten[i] - r.zeiten[i - 1]);
      const mittel = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null;
      cyc.push(`${p} Pkt: ${mittel != null ? mittel.toFixed(2) : '–'} s (Soll ${soll.toFixed(2)})`);
      ok(mittel != null && near(mittel, soll, 0.1), `${id} ${p} Punkt(e): Zyklus ${mittel != null ? mittel.toFixed(2) : '–'} s = ${w.ladekosten} / ${p} = ${soll.toFixed(2)} s`);
    }
    info(id + ' Zyklen: ' + cyc.join(' · '));
  }
});

section('Dauerleistung am Pool <= Ist + 3 % (Erkundung 1d)', () => {
  for (const id of Object.keys(IST)) {
    const zeile = [];
    [1, 2, 4].forEach((p, i) => {
      const r = messe(id, p, 150);
      const ist = IST[id][i];
      zeile.push(`${p} Pkt ${r.rate.toFixed(2)} (Ist ${ist.toFixed(2)})`);
      ok(r.rate <= ist * 1.03 + 1e-9, `${id} ${p} Punkt(e): gemessen ${r.rate.toFixed(2)} Schaden/s ≤ Ist ${ist.toFixed(2)} + 3 % (${(ist * 1.03).toFixed(2)})`);
    });
    info(id + ': ' + zeile.join(' · '));
  }
});

section('Lanze: Schildpierce 2, bei Vollladung Durchschlag bis in die Mitte', () => {
  const T = arena(); const g = T.g; bestueck(g, 8, 'lanze'); poolVier(g);
  const e = ziel(g, 'korvette', 250, 0, 4); e.shields = [4, 4, 4, 4]; pin(g);
  const sh0 = e.shields.slice(); const hp0 = e.hp;
  Waffen.fireLance(g, 'bow', 1, false);
  ok(near(hp0 - e.hp, 12, 0.01) && e.shields.every((v, i) => v === sh0[i]), `Vollladung: Hülle −${(hp0 - e.hp).toFixed(2)} = 12, Schild unberührt (durchschlägt die Zone)`);
  e.shields = [4, 4, 4, 4]; const hp1 = e.hp; Waffen.fireLance(g, 'bow', 0.5, false);
  const teil = 3 + 9 * 0.5;
  const sekt = e.shields.findIndex((v) => v < 4);
  ok(sekt >= 0 && near(e.shields[sekt], 2, 0.01) && near(hp1 - e.hp, teil - 2, 0.01), `Teilladung 0,5: Schild um 2 (pierce) gesenkt (${e.shields[sekt]}), Hülle −${(hp1 - e.hp).toFixed(2)} = ${teil} − 2`);
  g.space.enemies = g.space.enemies.filter((q) => q !== e);   // der erste Gegner auf der Linie hätte den Schuss sonst abgefangen
  const e2 = ziel(g, 'korvette', 250, 0, 4); e2.shields = [0, 0, 0, 0]; const hp2 = e2.hp;
  Waffen.fireLance(g, 'bow', 1, false);
  ok(near(hp2 - e2.hp, 12, 0.01), 'Vollladung ohne Schild: Hülle −12 (Mitte getroffen)');
});

section('Sturmbatterie gegen vollen Schild: Schild fällt, Regeneration gesperrt, kein Systemschaden', () => {
  const T = arena(); const g = T.g; bestueck(g, 4, 'sturmbatterie'); poolVier(g);
  const e = ziel(g, 'korvette', 0, -250, 40); e.shields = [40, 40, 40, 40]; pin(g);
  const sum0 = e.shields.reduce((a, b) => a + b, 0); const hp0 = e.hp;
  g.ship.wAllocIntent = { port: 1 };
  g.ship.mount.port.charge = 1; Waffen.weaponsFire(g, 'port');
  T.run(1.0, () => pin(g));
  const sum1 = e.shields.reduce((a, b) => a + b, 0);
  ok(sum1 < sum0 - 1e-6, `Sturm gegen vollen Schild: Schild fällt (${sum0} → ${sum1.toFixed(2)})`);
  ok(e.hp === hp0 && !e.zs, 'kein Systemschaden: Hülle unberührt, keine Zielsystem-Stufe');
  ok(e.regenHold != null && e.regenHold > g.time, `Regeneration gesperrt (regenHold ${e.regenHold != null ? e.regenHold.toFixed(2) : '–'} s, Zeit ${g.time.toFixed(2)} s)`);
});

section('Standardbatterie gegen Schild 0: Hülle getroffen (Lücke: geleerte Gegnerzone folgt mit Paket C)', () => {
  const T = arena(); const g = T.g; bestueck(g, 4, 'standardbatterie'); poolVier(g);
  const e = ziel(g, 'korvette', 0, -250, 0); pin(g); const hp0 = e.hp;
  g.ship.wAllocIntent = { port: 1 };
  g.ship.mount.port.charge = 1; Waffen.weaponsFire(g, 'port');
  T.run(8, () => pin(g));
  const schaden = hp0 - e.hp;
  ok(schaden > 0 && near(schaden / 2.9, Math.round(schaden / 2.9), 1e-6), `ohne Schild trifft jeder Schuss die Hülle: −${schaden.toFixed(2)} (ganzzahlig × 2,9)`);
});

section('Torpedo umgeht den stehenden Schild nicht (Lesart B)', () => {
  const T = arena(); const g = T.g;
  const e = ziel(g, 'korvette', 0, -250, 40); e.shields = [40, 40, 40, 40]; const hp0 = e.hp;
  space.damageEnemy(g, e, 9, e.x, e.y - 80, { huelle: true, nurOhneSchild: true });
  ok(e.hp === hp0 && e.shields.every((v) => v === 40), 'stehender Schild: Torpedo prallt ab (Hülle und Schild unberührt)');
});

console.log(`\ntest-waffen-cooldown: ${n - fails}/${n} Prüfungen bestanden` + (fails ? `, ${fails} FEHLER` : ''));
if (fails) process.exit(1);
