#!/usr/bin/env node
'use strict';
// GEL-01 E (Abnahme 9): Gruppenlauf auf einer Wildnis-Karte mit 2, 3 und 4 Spielern (+ alle 3 Biome mit 2 und 4 Spielern).
// Alle starten an der Ankunft (Abholpunkt, Testgelände-Weg Arena.start(g,'arena_away',{art:'wildnis',seed,biom}) wie in test-wildnis-verdrahtung.js),
// laufen nach BFS-Wegfindung zu einem Fundort, EIN Spieler hält E (Fundort-Interaktion über die echte Spiellogik: onAct -> anker.js holdStart ->
// completeHold, Zustand genommen + missionEvent fundGeborgen), danach laufen alle zurück zur Ankunft und beamen hoch.
// BELEGT ist damit: Bewegung (Kollision, Wege), Fund bergen, Rückkehr und Hochbeamen mit gescripteten Eingaben; Serverstabilität.
// NICHT belegt ist Gruppenspiel unter Druck (Deckung nutzen, Feuerkampf, Wiederbeleben, Absprache): die Spieler sind GESCRIPTETE Eingaben
// (input.mx/my und act-Nachricht), keine Menschen; der Server (Game.step, Physik, Kollision, Gegner-KI, Anker-Logik) ist der echte.
// Fälle je Lauf: A ohne Gegner; B mit Gegnern nur in Lagern abseits des Wegs (>= 14 Kacheln von jedem Wegpunkt), klein besetzt, Treffer an
// Spielern machen B rot; C (Druck) Lager an/nahe der Route, klein besetzt, Spieler kämpfen NICHT (nur Bewegung/Bergung): der Fund muss dort
// NICHT gelingen; C belegt nur "Server fehlerfrei, kein Absturz, Gegner reagieren" und gibt das Ergebnis als "Verhalten beobachtet" aus (kein Gewinn).
//   node tools/test-wildnis-gruppenlauf.js
const Physics = require('../shared/physics.js');
const CONFIG = require('../shared/config.js');
const W = require('../server/world.js');
const Arena = require('../server/sim/arena.js');
const Anker = require('../server/sim/anker.js');
const away = require('../server/sim/away.js');
const combat = require('../server/sim/combat.js');
const { bfs } = require('../server/util.js');
const { Game } = require('../server/game.js');

let n = 0, bad = 0;
const ok = (c, t) => { n++; if (!c) { bad++; console.log('  FEHLER ' + t); } else console.log('  ok   ' + t); };
const TICK = CONFIG.tickHz;
const tileVon = (o) => Physics.toTile(o.x, o.y);
const fehlerZahl = (g) => (Array.isArray(g.errors) ? g.errors.length : g.errors | 0);

function neuesSpiel(np, seed, biom) {
  const g = new Game({ noStore: true, seed: 9, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  for (let i = 0; i < np; i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 500) this.inbox.push(m); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'W' + i, name: 'W' + i, color: i }); g.handleMessage(c, { t: 'ready', ready: true });
    g.cs = (g.cs || []).concat([c]);
  }
  Arena.start(g, 'arena_away', Object.assign({ art: 'wildnis', seed }, biom ? { biom } : {}));
  return g;
}

// Alle Spieler laufen (gleichzeitig) die Kachelfolge ab; Eingabe = Richtung zur Mitte der nächsten Kachel. -> Ticks bis alle da sind (oder -1)
function laufen(g, pfad, maxSek, nachTick) {
  let t = 0;
  const idx = g.players.map(() => 0);
  while (t < maxSek * TICK) {
    let fertig = true;
    g.players.forEach((p, i) => {
      if (idx[i] >= pfad.length) { p.input.mx = 0; p.input.my = 0; return; }
      fertig = false;
      const z = Physics.tileCenter(pfad[idx[i]].x, pfad[idx[i]].y);
      const dx = z.x - p.x, dy = z.y - p.y, d = Math.hypot(dx, dy);
      if (d < 6) { idx[i]++; if (idx[i] >= pfad.length) { p.input.mx = 0; p.input.my = 0; return; } }
      const zz = Physics.tileCenter(pfad[Math.min(idx[i], pfad.length - 1)].x, pfad[Math.min(idx[i], pfad.length - 1)].y);
      const ex = zz.x - p.x, ey = zz.y - p.y, e = Math.hypot(ex, ey) || 1;
      p.input.mx = ex / e; p.input.my = ey / e;
    });
    if (fertig) return t;
    g.step(); t++;
    if (nachTick) nachTick();
  }
  return -1;
}

function lauf(np, mitGegnern, biom, seed) {
  const tag = `${np} Spieler ${mitGegnern ? 'mit Gegnern' : 'ohne Gegner'}${biom ? ' ' + biom + ' Seed ' + seed : ''}`;
  console.log(`\n[${tag}]`);
  const t0 = Date.now();
  const g = neuesSpiel(np, seed || 5, biom);
  const map = g.away && g.away.map;
  const k = W.AWAY_MAPS[map].karte;
  const E = combat.env(g);
  const ab = k.anker.find((a) => a.id === k.ankunft);
  ok(g.players.length === np && g.players.every((p) => p.zone === 'away'), `${np} Spieler unten auf ${map} (${k.meta.biom} ${k.w}x${k.h})`);
  ok(g.players.every((p) => { const t = tileVon(p); return Math.abs(t.x - ab.x) <= 3 && Math.abs(t.y - ab.y) <= 3; }), `alle starten an der Ankunft (${ab.x},${ab.y})`);
  const begehbar = (x, y) => !E.solid(x, y);
  const wegZu = (a) => bfs(begehbar, { x: ab.x, y: ab.y }, (x, y) => x === a.x && y === a.y, k.w, k.h);
  // Fundort: der nächste (kürzester BFS-Weg). Mit Gegnern: der Fundort, zu dem die meisten Lager abseits des Wegs liegen.
  const funde = k.anker.filter((a) => a.rolle === 'fund').map((a) => ({ a, weg: wegZu(a) }));
  ok(funde.length >= 2 && funde.every((f) => f.weg && f.weg.length > 0), `BFS findet zu allen ${funde.length} Fundorten einen Weg (${funde.map((f) => f.weg.length).join(', ')} Schritte)`);
  const lager = Object.keys(k.bereiche).filter((b) => k.bereiche[b].gefecht);
  const lagerMitte = (b) => { const r = k.bereiche[b].rects[0]; return { x: r[0] + r[2] / 2, y: r[1] + r[3] / 2 }; };
  const fern = (weg) => lager.filter((b) => { const m = lagerMitte(b); return weg.every((s) => Math.hypot(s.x - m.x, s.y - m.y) >= 14) && Math.hypot(ab.x - m.x, ab.y - m.y) >= 14; });
  let wahl = funde.slice().sort((x, y) => x.weg.length - y.weg.length)[0];
  let lagerWahl = [];
  if (mitGegnern) {
    funde.sort((x, y) => fern(y.weg).length - fern(x.weg).length || x.weg.length - y.weg.length);
    wahl = funde[0]; lagerWahl = fern(wahl.weg);
    console.log(`  Fundwahl ${wahl.a.id}, Lager abseits des Wegs (>= 14 Kacheln): ${lagerWahl.join(', ') || 'keine'} von ${lager.length}`);
    ok(lagerWahl.length >= 1, 'mindestens ein Lager liegt abseits des Wegs (sonst gäbe es keinen Fall mit Gegnern)');
    let gesamt = 0;
    for (const b of lagerWahl) gesamt += combat.besetzen(g, { map, bereich: b, fraktion: 'raubzug', staerke: 'klein', tag: 'gl_' + b });
    ok(gesamt > 0 && g.away.drones.length === gesamt, `${gesamt} Gegner (klein) in ${lagerWahl.length} Lager(n) abseits des Wegs`);
  } else {
    ok(g.away.drones.length === 0, 'keine Gegner');
  }
  const fund = wahl.a, weg = wahl.weg;
  ok(Anker.zustand(g, map, fund.id) === 'da', `Fund ${fund.id} liegt bereit (Zustand da)`);
  const hp0 = g.players.map((p) => p.hp !== undefined ? p.hp : p.hits);

  // Hinweg
  let ticksGesamt = 0;
  const tHin = laufen(g, weg, 240);
  ok(tHin >= 0, `alle ${np} Spieler erreichen den Fundort nach ${tHin} Ticks (${(tHin / TICK).toFixed(1)} s Spielzeit, ${weg.length} Kacheln)`);
  ticksGesamt += Math.max(tHin, 0);
  ok(g.players.every((p) => { const t = tileVon(p); return t.x === fund.x && t.y === fund.y; }), 'alle stehen auf der Fundort-Kachel');

  // EIN Spieler hält E (3 s); die Fundort-Interaktion gibt der Server vor (anker.holdDuration)
  const halter = g.players[0];
  g.handleMessage(g.cs[0], { t: 'act', down: true });
  ok(!!halter.hold && halter.hold.kind === 'anker:fund', 'E am Fundort startet das Halten (hold.kind ' + (halter.hold && halter.hold.kind) + ')');
  const dauer = halter.hold ? halter.hold.dur : 0;
  console.log(`  Haltedauer laut Server ${dauer} s`);
  ok(dauer >= 1, `Halten dauert ${dauer} s (Briefing: ca. 3 s)`);
  let gehalten = 0;
  while (gehalten < (dauer + 2) * TICK && Anker.zustand(g, map, fund.id) === 'da') { g.step(); gehalten++; }
  g.handleMessage(g.cs[0], { t: 'act', down: false });
  ticksGesamt += gehalten;
  ok(Anker.zustand(g, map, fund.id) === 'genommen', `Fund-Zustand geändert: genommen nach ${(gehalten / TICK).toFixed(1)} s (Zustand ${Anker.zustand(g, map, fund.id)})`);
  ok(Math.abs(gehalten / TICK - dauer) < 0.5, 'Fund wird erst nach der Haltedauer geborgen (nicht sofort)');
  // zweites E auf den geborgenen Fund bringt nichts mehr
  g.handleMessage(g.cs[1 % np], { t: 'act', down: true }); g.step(); g.handleMessage(g.cs[1 % np], { t: 'act', down: false });
  ok(Anker.zustand(g, map, fund.id) === 'genommen', 'geborgener Fund bleibt genommen (kein zweites Bergen)');

  // Rückweg zur Ankunft
  const rueck = weg.slice(0, -1).reverse().concat([{ x: ab.x, y: ab.y }]);
  const tRueck = laufen(g, rueck, 240);
  ticksGesamt += Math.max(tRueck, 0);
  ok(tRueck >= 0, `alle ${np} Spieler zurück an der Ankunft nach ${tRueck} Ticks (${(tRueck / TICK).toFixed(1)} s)`);
  ok(g.players.every((p) => { const t = tileVon(p); return t.x === ab.x && t.y === ab.y; }), 'alle stehen wieder auf dem Abholpunkt');
  // Hochbeamen vom Abholpunkt (Transfer): alle landen auf dem Schiff
  away.executeBeam(g, g.players.map((p) => p.id), 'up'); for (let i = 0; i < 2 * TICK; i++) g.step();
  ok(g.players.every((p) => p.zone === 'ship'), 'alle hochgebeamt (Transfer vom Abholpunkt)');
  ok(Anker.zustand(g, map, fund.id) === 'genommen', 'Fund bleibt nach dem Hochbeamen geborgen');
  // Spieler unverletzt, keine Serverfehler
  const hp1 = g.players.map((p) => p.hp !== undefined ? p.hp : p.hits);
  ok(JSON.stringify(hp0) === JSON.stringify(hp1) && g.players.every((p) => !p.downed), `kein Spieler getroffen oder am Boden (${JSON.stringify(hp0)} -> ${JSON.stringify(hp1)})`);
  ok(fehlerZahl(g) === 0, `0 Serverfehler (g.errors ${fehlerZahl(g)})`);
  console.log(`  ${tag}: ${ticksGesamt} Ticks Spielzeit gelaufen (${(ticksGesamt / TICK).toFixed(1)} s), Realzeit ${Date.now() - t0} ms`);
}

// Fall C (Druck): Lager an/nahe der Route, Spieler laufen nur und bergen, kämpfen nicht. Ergebnis wird beobachtet, nicht verlangt.
function druckLauf(np, biom, seed) {
  const tag = `${np} Spieler Druck (Lager an der Route, kein Kampf) ${biom} Seed ${seed}`;
  console.log(`\n[${tag}]`);
  const t0 = Date.now();
  const g = neuesSpiel(np, seed, biom);
  const map = g.away && g.away.map;
  const k = W.AWAY_MAPS[map].karte;
  const E = combat.env(g);
  const ab = k.anker.find((a) => a.id === k.ankunft);
  const begehbar = (x, y) => !E.solid(x, y);
  const funde = k.anker.filter((a) => a.rolle === 'fund').map((a) => ({ a, weg: bfs(begehbar, { x: ab.x, y: ab.y }, (x, y) => x === a.x && y === a.y, k.w, k.h) })).filter((f) => f.weg && f.weg.length);
  const lager = Object.keys(k.bereiche).filter((b) => k.bereiche[b].gefecht);
  const lagerMitte = (b) => { const r = k.bereiche[b].rects[0]; return { x: r[0] + r[2] / 2, y: r[1] + r[3] / 2 }; };
  // Fund und Lager mit dem kleinsten Abstand Lager <-> Weg (Lager mindestens 8 Kacheln von der Ankunft, damit der Start nicht im Lager liegt)
  let best = null;
  for (const f of funde) for (const b of lager) {
    const m = lagerMitte(b); if (Math.hypot(ab.x - m.x, ab.y - m.y) < 8) continue;
    const d = Math.min(...f.weg.map((s) => Math.hypot(s.x - m.x, s.y - m.y)));
    if (!best || d < best.d) best = { f, b, d };
  }
  ok(!!best, 'Lager an/nahe einer Fundroute vorhanden');
  if (!best) return;
  console.log(`  Fund ${best.f.a.id} (Weg ${best.f.weg.length} Kacheln), Lager ${best.b}, kleinster Abstand Lager-Weg ${best.d.toFixed(1)} Kacheln`);
  const gesamt = combat.besetzen(g, { map, bereich: best.b, fraktion: 'raubzug', staerke: 'klein', tag: 'dr_' + best.b });
  ok(gesamt > 0 && g.away.drones.length === gesamt, `${gesamt} Gegner (klein) im Lager an der Route`);
  const start = g.away.drones.map((d) => ({ x: d.x, y: d.y }));
  const stand = () => JSON.stringify(g.players.map((p) => [p.hp, p.seg, p.wound ? 1 : 0, p.downed ? 1 : 0, p.zustand || null]));
  const hp0 = stand();
  let alarm = false, projMax = 0, nah = Infinity, getroffen = false, aufSchiff = false;
  const beobachten = () => {
    const aw = g.away;
    if (g.players.some((p) => p.wound || p.downed || p.zustand === 'verwundet' || p.zustand === 'bewusstlos')) getroffen = true;
    if (g.players.some((p) => p.zone !== 'away')) aufSchiff = true;   // alle Spieler gefallen: der Server holt den Trupp aufs Schiff
    if (Object.values(aw.squads || {}).some((s) => s && s.alert) || aw.alarm) alarm = true;
    projMax = Math.max(projMax, (aw.projectiles || []).length);
    for (const d of aw.drones) if (d.alive) for (const p of g.players.filter((q) => q.zone === 'away')) nah = Math.min(nah, Math.hypot(d.x - p.x, d.y - p.y) / 32);
  };
  const tHin = laufen(g, best.f.weg, 90, beobachten);
  let geborgen = false, gehalten = 0;
  if (tHin >= 0) {
    g.handleMessage(g.cs[0], { t: 'act', down: true });
    const dauer = g.players[0].hold ? g.players[0].hold.dur : 3;
    while (gehalten < (dauer + 2) * TICK && Anker.zustand(g, map, best.f.a.id) === 'da') { g.step(); gehalten++; beobachten(); }
    g.handleMessage(g.cs[0], { t: 'act', down: false });
    geborgen = Anker.zustand(g, map, best.f.a.id) === 'genommen';
  }
  const rueck = best.f.weg.slice(0, -1).reverse().concat([{ x: ab.x, y: ab.y }]);
  const tRueck = laufen(g, rueck, 90, beobachten);
  for (let i = 0; i < 5 * TICK; i++) { g.step(); beobachten(); }
  const bewegt = g.away.drones.filter((d, i) => start[i] && Math.hypot(d.x - start[i].x, d.y - start[i].y) > 32).length;
  if (hp0 !== stand()) getroffen = true;
  const reagiert = alarm || bewegt > 0 || projMax > 0 || getroffen;
  console.log(`  Verhalten beobachtet: Hinweg ${tHin >= 0 ? 'erreicht' : 'nicht erreicht'}, Fund ${geborgen ? 'geborgen' : 'NICHT geborgen'}, Rückweg ${tRueck >= 0 ? 'erreicht' : 'nicht erreicht'}; ` +
    `Alarm ${alarm}, ${bewegt}/${start.length} Gegner >1 Kachel bewegt, Geschosse max ${projMax}, nächster Abstand ${nah === Infinity ? '-' : nah.toFixed(1)} Kacheln, Spieler getroffen/am Boden ${getroffen}, Trupp aufs Schiff geholt ${aufSchiff}`);
  ok(fehlerZahl(g) === 0, `0 Serverfehler (g.errors ${fehlerZahl(g)}); kein Absturz`);
  ok(reagiert, 'Gegner reagieren (Alarm, Bewegung, Geschosse oder Treffer beobachtet) – der Fund muss hier NICHT gelingen');
  console.log(`  ${tag}: Realzeit ${Date.now() - t0} ms`);
}

for (const np of [2, 3, 4]) {
  for (const mit of [false, true]) {
    try { lauf(np, mit); } catch (e) { bad++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
  }
}
// Alle Biome (je 1 Seed), mit 2 und 4 Spielern: Fälle A, B und C
const BIOM_SEEDS = { wueste: 11, wiesenwald: 12, vulkan: 13 };
for (const [biom, seed] of Object.entries(BIOM_SEEDS)) {
  for (const np of [2, 4]) {
    for (const mit of [false, true]) {
      try { lauf(np, mit, biom, seed); } catch (e) { bad++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
    }
    try { druckLauf(np, biom, seed); } catch (e) { bad++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
  }
}
console.log(`\n${n - bad}/${n} ok`);
if (bad) { console.log(`${bad} FEHLER`); process.exit(1); }
console.log('TEST-WILDNIS-GRUPPENLAUF OK');
