'use strict';
// SYS-01 B1: Cooldown statt Salven. Ein Projektil je Zyklus für Standardbatterie, Sturmbatterie, Standardkanone und Abwehrturm; die Streubatterie behält die Salve.
// Zyklus = ladekosten / Ladepunkte am Pool + nachlauf (Standardbatterie: 0,2 s). Dauerleistung am Pool je Waffe darf den Ist-Wert der Erkundung (Auftrag SYS-01 – Erkundung, Frage 1d) um höchstens 3 % überschreiten.
// Nacharbeit: die Start-Lerche (Lanze + 2 Standardbatterien, Pool 4) liegt innerhalb ±2 % der Ist-Werte vor B1 (Anfangsstoß 28, Dauerfeuer 2,24 / 2,43).
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
const Testhilfe = require('./gegner-testhilfe.js');   // SYS-01 C1a-1: Gegner ohne Hülle (Budget, Schilde samt Obergrenze)
const Waffen = require('../server/sim/schiffswaffen.js');
const Ausbau = require('../server/sim/ausbau.js');
const { execFileSync } = require('child_process');

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
  Testhilfe.setzeSchilde(e, e.shields.map(() => (schild == null ? 0 : schild))); Testhilfe.setzeBudget(e, 1e9); e.pin = { x: e.x, y: e.y, angle: e.angle };
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
// Ist-Werte Erkundung 1d (gemessen, 100 % Treffer, ruhende Ziele): Schaden/s bei 1 / 2 / 4 Punkten.
// Standardbatterie bei 1 Punkt: 0,63 statt 0,60. Die Erkundung zählte 9 Salven à 8 im Fenster 30–150 s (0,60); die Salve von vor B1 (alle 12,77 s) liefert über ein langes Fenster (600 s,
// Stand 3f4f2f4) 0,63 (2 Punkte 1,20, 4 Punkte 2,24); die Start-Lerche (Messung unten) liegt nur mit diesem Wert bei den Ist-Zahlen.
const IST = {
  standardbatterie: [0.63, 1.20, 2.20], sturmbatterie: [0.56, 1.03, 1.87], standardkanone: [0.60, 1.25, 2.27], abwehrturm: [0.32, 0.64, 1.26],
};
// Messung am Pool: Ops feuert bei Bereitschaft, Schüsse nach t = 10 s zählen. Liefert Schaden je Sekunde (Fenster 10 … sek), Zeitpunkte der Schüsse.
function messe(id, punkte, sek, schild) {   // SYS-02a: schild = Schildstand je Segment des Ziels (Standard 0)
  const T = arena(); const g = T.g; const z = SCHUSS_ZIELE[id];
  bestueck(g, z.platz, id); poolVier(g);
  const zl = ziel(g, z.ziel[0], z.ziel[1], z.ziel[2], schild || 0); if (schild) Testhilfe.setzeSchilde(zl, [schild, schild, schild, schild]);
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
  ok(Katalog.volley('standardbatterie') === 6 && Katalog.volley('sturmbatterie') === 4.8 && Katalog.volley('standardkanone') === 4.5 && Katalog.volley('abwehrturm') === 2.4 && Katalog.volley('lanze') === 12 && Katalog.volley('torpedowerfer') === 0,
    'Magazinlast (Feld magazin, Werte wie vor B1): Batterie 6, Sturm 4,8, Kanone 4,5, Turm 2,4, Lanze 12, Torpedo 0');
  ok(Katalog.MAGAZINDECKEL.stossStart === 24 && Katalog.MAGAZINDECKEL.stossMax === 36, `Magazindeckel wie vor B1: Start-Lerche ${Katalog.MAGAZINDECKEL.stossStart} (Lanze 12 + 2 × 6), Obergrenze ${Katalog.MAGAZINDECKEL.stossMax}`);
  const P = CONFIG.spaceM3.mounts.port;
  ok(P.tubes === 1 && P.secPerPoint === 3.9 && P.damage === 2.66 && P.damage === Katalog.waffe('standardbatterie').schaden && P.secPerPoint === Katalog.waffe('standardbatterie').ladekosten && Katalog.waffe('standardbatterie').nachlauf === 0.2 && P.salvoGap === undefined,
    'Config spaceM3.mounts.port = Katalog (Rohre 1, 3,9 s + 0,2 s Nachlauf, Schaden 2,66)');
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

section('Zyklus = ladekosten / Ladepunkte + nachlauf (1, 2, 4)', () => {
  for (const id of ['standardbatterie', 'standardkanone', 'sturmbatterie']) {
    const cyc = [];
    for (const p of [1, 2, 4]) {
      const r = messe(id, p, 40);
      const w = Katalog.waffe(id);
      const soll = w.ladekosten / p + (w.nachlauf || 0);
      const diffs = []; for (let i = 1; i < r.zeiten.length; i++) diffs.push(r.zeiten[i] - r.zeiten[i - 1]);
      const mittel = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null;
      cyc.push(`${p} Pkt: ${mittel != null ? mittel.toFixed(2) : '–'} s (Soll ${soll.toFixed(2)})`);
      ok(mittel != null && near(mittel, soll, 0.1), `${id} ${p} Punkt(e): Zyklus ${mittel != null ? mittel.toFixed(2) : '–'} s = ${w.ladekosten} / ${p} + ${w.nachlauf || 0} = ${soll.toFixed(2)} s`);
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
      // SYS-02a (Kai): der Sturm wirkt bei Schild 0 mit Faktor systemFaktor gegen das System (Dauerleistung gegen Systeme steigt mit ihm); gegen Schild gilt der alte Grenzwert
      const fak = id === 'sturmbatterie' ? require('../server/sim/sturm.js').systemFaktor({ C: CONFIG }) : 1;
      ok(r.rate <= ist * fak * 1.03 + 1e-9, `${id} ${p} Punkt(e): gemessen ${r.rate.toFixed(2)} Schaden/s ≤ Ist ${ist.toFixed(2)}${fak !== 1 ? ' × systemFaktor ' + fak : ''} + 3 % (${(ist * fak * 1.03).toFixed(2)})`);
      // Nacharbeit SYS-02a: Untergrenze gegen den festen Beschlusswert 1,5 (nicht gegen die Config: mit systemFaktor 1 bliebe sonst die Obergrenze allein grün). Toleranz nach unten 8 %: bei 1 Punkt liegt die Messung 5 % unter Ist × Faktor (Gesamtschaden zählt gekappten Systemschaden nicht ganz)
      if (id === 'sturmbatterie') { const soll = 1.5; ok(r.rate >= ist * soll * 0.92 - 1e-9, `${id} ${p} Punkt(e): gemessen ${r.rate.toFixed(2)} Schaden/s ≥ Ist ${ist.toFixed(2)} × Beschlusswert systemFaktor ${soll} − 8 % (${(ist * soll * 0.92).toFixed(2)}), Schild 0`); }
    });
    info(id + ': ' + zeile.join(' · '));
  }
});

section('SYS-02a: Sturm gegen stehenden Schild: Dauerleistung in Schaden gegen den Schild nicht über Ist (nur schildFaktor, kein Systemfaktor)', () => {
  const sf = Katalog.waffe('sturmbatterie').sturm.schildFaktor;
  [1, 2, 4].forEach((p, i) => {
    const r = messe('sturmbatterie', p, 60, 40);
    const grenze = IST.sturmbatterie[i] * sf * 1.03;
    ok(r.rate <= grenze + 1e-9, `sturmbatterie ${p} Punkt(e) gegen Schild 40: ${r.rate.toFixed(3)} Schildschaden/s ≤ Ist ${IST.sturmbatterie[i].toFixed(2)} × schildFaktor ${sf} + 3 % (${grenze.toFixed(3)})`);
  });
});

section('Start-Lerche (Lanze + 2 Standardbatterien, Pool 4) wie vor B1, innerhalb ±2 %', () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, 'pan01-feuerkraft-messung.js'), '--pool', '4', '--sek', '180'], { encoding: 'utf8' });
  const zeile = out.split('\n').find((l) => /^\| 3 \|/.test(l));
  const c = zeile.split('|').map((x) => x.trim());
  const anfang = Number(c[4]), d1 = Number(c[5]), d2 = Number(c[6]);
  const innen = (v, soll) => Math.abs(v - soll) <= soll * 0.02 + 1e-9;
  ok(innen(anfang, 28), `Anfangsstoß 0–10 s ${anfang} (Ist vor B1 28, ±2 %)`);
  ok(innen(d1, 2.24), `Dauerfeuer 10–60 s ${d1} (Ist 2,24, ±2 %)`);
  ok(innen(d2, 2.43), `Dauerfeuer 60–180 s ${d2} (Ist 2,43, ±2 %)`);
});

section('Sturmbatterie unter anhaltendem Feuer: der Schild fällt auf 0, bis dahin kein Systemschaden, Regeneration gesperrt', () => {
  const T = arena(); const g = T.g; bestueck(g, 4, 'sturmbatterie'); poolVier(g);
  const e = ziel(g, 'korvette', 0, -250, 6); Testhilfe.setzeSchilde(e, [6, 6, 6, 6]); pin(g);
  g.ship.wAllocIntent = { port: 4 };
  const regenSperre = Katalog.waffe('sturmbatterie').sturm.regenSperre;
  const hp0 = e.hp; let schildNull = null, hpBisNull = 0, zsBisNull = false, regenOk = true, fruehstens = Infinity;
  for (let t = 0; t < 200 && schildNull == null; t += DT) {
    pin(g);
    const m = g.ship.mount.port;
    if (m.charge >= 1 && !(m.salvo > 0)) Waffen.weaponsFire(g, 'port');
    g.step();
    const sum = e.shields.reduce((a, b) => a + b, 0);
    if (sum < 24 - 1e-6 && !(e.regenHold != null && e.regenHold > g.time - regenSperre - 1e-6)) regenOk = false;   // Schild unter Voll ohne laufende Sperre = regeneriert
    if (e.shields.some((v) => v <= 1e-9)) { schildNull = t; fruehstens = Math.min(fruehstens, t); }
    else { hpBisNull += hp0 - e.hp; if (e.zs) zsBisNull = true; }
  }
  ok(schildNull != null, `anhaltendes Sturmfeuer: ein Schildsegment fällt auf 0 (nach ${schildNull != null ? schildNull.toFixed(0) : '–'} s), es sinkt nicht nur`);
  ok(hpBisNull === 0 && !zsBisNull, 'bis dahin kein Hüllen- und kein Systemschaden (Hülle unberührt, keine Zielsystem-Stufe)');
  ok(regenOk, `die Regeneration bleibt während des Dauerfeuers gesperrt (${regenSperre} s nach jedem Treffer)`);
});

section('Gegnerfeuer (Standardbatterie-Verhalten) auf die Lerche: Zonensysteme zuerst, Mitte erst nach geleerter Zone (Trefferweg aus A1)', () => {
  const I = require('../server/sim/interior.js');
  const lauf = (vorLeeren) => {
    const T = arena(); const g = T.g; g.god = false;
    g.ship.shields.current = [0, 0, 0, 0]; g.ship.shields.regenHold = 1e9;
    for (const k of I.SYSTEM_ORDER) g.ship.systems[k] = 'ok';
    I.integritaetVoll(g);
    const zone = (k) => I.systemSector(k) === 3;   // Backbord: der Gegner steht bei (0, -300)
    const zoneSys = I.SYSTEM_ORDER.filter((k) => zone(k) && I.systemAktiv(g, k));
    if (vorLeeren) for (const k of zoneSys) { g.ship.systems[k] = 'broken'; I.setInteg(g, k, 0); }
    const sh = g.ship;
    const e = space.spawnEnemy(g, 'korvette', { x: sh.x, y: sh.y - 300, facing: Math.PI });
    e.waffen = { bug: 'batterie', stbd: 'batterie', bb: 'batterie' };   // alle Rohre mit dem Verhalten der Standardbatterie
    const ex = e.x, ey = e.y, ea = e.angle;
    const integ = () => { const o = {}; for (const k of I.SYSTEM_ORDER) o[k] = I.integOf(g, k); return o; };
    let prev = integ(); let treffer = 0, inZone = 0, mitteOffen = 0, mitteGeleert = 0, fremd = 0;
    for (let i = 0; i < 90 * CONFIG.tickHz; i++) {
      sh.vx = 0; sh.vy = 0; sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.angle = 0; e.x = ex; e.y = ey; e.angle = ea; e.vx = 0; e.vy = 0;
      const zoneOffen = zoneSys.some((k) => g.ship.systems[k] !== 'broken');
      g.step();
      const cur = integ();
      for (const k of I.SYSTEM_ORDER) {
        if (!(cur[k] < prev[k] - 1e-9)) continue;
        treffer++;
        if (zone(k)) inZone++;
        else if (I.systemSector(k) === -1) { if (zoneOffen) mitteOffen++; else mitteGeleert++; }
        else fremd++;
      }
      prev = cur;
    }
    return { treffer, inZone, mitteOffen, mitteGeleert, fremd };
  };
  const a = lauf(false);
  ok(a.treffer >= 10 && a.fremd === 0 && a.mitteOffen === 0 && a.inZone > 0, `Gegnerfeuer aus Backbord: ${a.treffer} Treffer, ${a.inZone} in der Zone 3, andere Seiten ${a.fremd}, Mitte bei offener Zone ${a.mitteOffen} (Soll 0)`);
  const b = lauf(true);
  ok(b.treffer >= 10 && b.fremd === 0 && b.mitteOffen === 0 && b.mitteGeleert > 0, `Zone 3 vorab geleert: ${b.treffer} Treffer, ${b.mitteGeleert} in der Mitte bei leerer Zone, Mitte bei wieder offener Zone ${b.mitteOffen} (Soll 0; ${b.inZone} Zonentreffer erst nach einer Reparatur), andere Seiten ${b.fremd}`);
});

section('Lanze: Schildpierce 2, bei Vollladung Durchschlag bis in die Mitte', () => {
  const T = arena(); const g = T.g; bestueck(g, 8, 'lanze'); poolVier(g);
  const e = ziel(g, 'korvette', 250, 0, 4); Testhilfe.setzeSchilde(e, [4, 4, 4, 4]); pin(g);
  const sh0 = e.shields.slice(); const hp0 = e.hp;
  Waffen.fireLance(g, 'bow', 1, false);
  ok(near(hp0 - e.hp, 12, 0.01) && e.shields.every((v, i) => v === sh0[i]), `Vollladung: Hülle −${(hp0 - e.hp).toFixed(2)} = 12, Schild unberührt (durchschlägt die Zone)`);
  Testhilfe.setzeSchilde(e, [4, 4, 4, 4]); const hp1 = e.hp; Waffen.fireLance(g, 'bow', 0.5, false);
  const teil = 3 + 9 * 0.5;
  const sekt = e.shields.findIndex((v) => v < 4);
  // alte Regel: Schild 4 zählt 2, der Rest (7,5 − 2) trifft die Hülle. Neue Regel (SYS-01 C1a-1, wie die Lerche in damage.resolveHit): bleibt der Schild nach dem Durchschlag über 0,
  // fängt er den Treffer ohne Überlauf ab (Schild um 2 gesenkt, kein Systemschaden); erst bei wirksamem Schild 0 trifft der volle Schaden ein System.
  ok(sekt >= 0 && near(e.shields[sekt], 2, 0.01) && near(hp1 - e.hp, 0, 1e-6), `Teilladung 0,5: Schild um 2 (pierce) gesenkt (${e.shields[sekt]}), kein Überlauf: Integrität −${(hp1 - e.hp).toFixed(2)} (Soll 0)`);
  const hp1b = e.hp; Testhilfe.setzeSchilde(e, [2, 2, 2, 2]); Waffen.fireLance(g, 'bow', 0.5, false);
  ok(near(hp1b - e.hp, teil, 0.01) && e.shields.every((v) => near(v, 2, 1e-9)), `Teilladung 0,5 gegen Schild 2: wirksamer Schild 0, der volle Schaden trifft ein System (Integrität −${(hp1b - e.hp).toFixed(2)} = ${teil}), Schild unberührt`);
  g.space.enemies = g.space.enemies.filter((q) => q !== e);   // der erste Gegner auf der Linie hätte den Schuss sonst abgefangen
  const e2 = ziel(g, 'korvette', 250, 0, 4); e2.shields = [0, 0, 0, 0]; const hp2 = e2.hp;
  Waffen.fireLance(g, 'bow', 1, false);
  ok(near(hp2 - e2.hp, 12, 0.01), 'Vollladung ohne Schild: Hülle −12 (Mitte getroffen)');
});

section('Sturmbatterie gegen vollen Schild: Schild fällt, Regeneration gesperrt, kein Systemschaden', () => {
  const T = arena(); const g = T.g; bestueck(g, 4, 'sturmbatterie'); poolVier(g);
  const e = ziel(g, 'korvette', 0, -250, 40); Testhilfe.setzeSchilde(e, [40, 40, 40, 40]); pin(g);
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
  ok(schaden > 0 && near(schaden / 2.66, Math.round(schaden / 2.66), 1e-6), `ohne Schild trifft jeder Schuss die Hülle: −${schaden.toFixed(2)} (ganzzahlig × 2,66)`);
});

section('Torpedo umgeht den stehenden Schild nicht (Lesart B)', () => {
  const T = arena(); const g = T.g;
  const e = ziel(g, 'korvette', 0, -250, 40); Testhilfe.setzeSchilde(e, [40, 40, 40, 40]); const hp0 = e.hp;
  space.damageEnemy(g, e, 9, e.x, e.y - 80, { huelle: true, nurOhneSchild: true });
  ok(e.hp === hp0 && e.shields.every((v) => v === 40), 'stehender Schild: Torpedo prallt ab (Hülle und Schild unberührt)');
});

console.log(`\ntest-waffen-cooldown: ${n - fails}/${n} Prüfungen bestanden` + (fails ? `, ${fails} FEHLER` : ''));
if (fails) process.exit(1);
