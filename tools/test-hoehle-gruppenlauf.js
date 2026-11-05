#!/usr/bin/env node
'use strict';
// GEL-02 F (Abnahme 8): Gruppenlauf mit 2 und 4 Spielern in der Höhle: hinunter (Leiter, E halten 2 s), Fund holen (E halten, Bergen 3 s, in der
// Wildnis mit Höhle je ein Fund oben UND unten), zurück (Leiter), Beam hoch. Karten: Wildnis mit Höhle (mittel; Wüste, Wiesenwald, Vulkan)
// und eigene Höhle (mittel, drei Seeds). Fall A: Gegner nur in Lagern abseits der Route (ruhig), Fall B: Lager an der Route (Alarm).
// BELEGT (feste Schwellen): Server fehlerfrei, Gegner wechseln NIE das Deck, in Fall A kommen alle Spieler unverletzt mit geborgenen Funden zurück
// aufs Schiff, Deck-Verlauf der Spieler stimmt (0 -> 1 -> 0), in Fall B reagieren die Gegner. Fall B belegt NICHT, dass der Fund gelingt.
// NICHT belegt: Gruppenspiel unter Druck. Die Spieler sind GESCRIPTETE Eingaben (input.mx/my, act-Nachrichten), keine Menschen, sie kämpfen nicht,
// nutzen keine Deckung, helfen sich nicht; der Server (Game.step, Physik, Kollision, Gegner-KI, Anker-Logik, Leiter) ist der echte, aber im selben
// Prozess ohne Netz/Browser. "Server neu starten" = frisches Game je Lauf.
// Messzahlen (Dauer je Phase, Verlauf, Ausfälle) werden ausgegeben, nur feste Schwellen sind Prüfungen.
//   node tools/test-hoehle-gruppenlauf.js
const Physics = require('../shared/physics.js');
const CONFIG = require('../shared/config.js');
const W = require('../server/world.js');
const Anker = require('../server/sim/anker.js');
const away = require('../server/sim/away.js');
const combat = require('../server/sim/combat.js');
const { bfs } = require('../server/util.js');
const H = require('./gel02-hilfen.js');

let n = 0, bad = 0;
const ok = (c, t) => { n++; if (!c) { bad++; console.log('  FEHLER ' + t); } else console.log('  ok   ' + t); };
const TICK = CONFIG.tickHz;
const sek = (t) => (t / TICK).toFixed(1) + ' s';
const LEITER_S = (CONFIG.lift && CONFIG.lift.ladderTime) || 2;

// Spieler gehen je nach eigener Position per BFS zum Ziel (Kachel). -> { ticks, ok }
function gehe(ctx, ziel, maxSek) {
  const { g, E, k } = ctx;
  const begehbar = (x, y) => !E.solid(x, y);
  const pfade = g.players.map((p) => { const t = H.tileVon(p); return bfs(begehbar, { x: t.x, y: t.y }, (x, y) => x === ziel.x && y === ziel.y, k.w, k.h) || null; });
  if (pfade.some((p) => p === null)) return { ticks: 0, ok: false };
  const idx = g.players.map(() => 0);
  let t = 0;
  while (t < maxSek * TICK) {
    let fertig = true;
    g.players.forEach((p, i) => {
      const pf = pfade[i];
      if (idx[i] >= pf.length) { p.input.mx = 0; p.input.my = 0; return; }
      const z = Physics.tileCenter(pf[idx[i]].x, pf[idx[i]].y);
      if (Math.hypot(z.x - p.x, z.y - p.y) < 6) { idx[i]++; if (idx[i] >= pf.length) { p.input.mx = 0; p.input.my = 0; return; } }
      fertig = false;
      const zz = Physics.tileCenter(pf[idx[i]].x, pf[idx[i]].y);
      const ex = zz.x - p.x, ey = zz.y - p.y, e = Math.hypot(ex, ey) || 1;
      p.input.mx = ex / e; p.input.my = ey / e;
    });
    if (fertig) return { ticks: t, ok: true };
    schritt(ctx); t++;
  }
  g.players.forEach((p) => { p.input.mx = 0; p.input.my = 0; });
  return { ticks: t, ok: false };
}
// ein Tick mit Beobachtung (Deck-Verlauf, Deckwechsel der Gegner, Treffer, Alarm)
function schritt(ctx) {
  const { g, k, obs } = ctx;
  g.step(); ctx.tick++;
  const aw = g.away;
  if (ctx.tick % 5 === 0) {
    const sn = g.snapshot().players;
    g.players.forEach((p, i) => { const q = sn.find((x) => x.id === p.id); const d = q ? (q.deck | 0) : -1; const v = obs.verlauf[i]; if (v[v.length - 1] !== d) v.push(d); });
  }
  for (const d of aw.drones) if (d.alive && obs.deck0.has(d.id) && H.deckVon(k, d) !== obs.deck0.get(d.id)) obs.wechsel.add(d.id);
  if (g.players.some((p) => p.downed || p.wound || p.zustand === 'verwundet' || p.zustand === 'bewusstlos')) obs.getroffen = true;
  for (const p of g.players) { if (p.downed) { obs.boden = true; obs.bodenIds.add(p.id); } if (!ctx.beamen && p.zone !== 'away') obs.geholt.add(p.id); }
  if (Object.values(aw.squads || {}).some((s) => s && s.alert) || aw.alarm) obs.alarm = true;
  obs.projMax = Math.max(obs.projMax, (aw.projectiles || []).length);
}
const warte = (ctx, s) => { for (let i = 0; i < s * TICK; i++) schritt(ctx); };

// Leiter: alle Spieler halten E (2 s) auf der Leiter-Kachel bis alle das Zieldeck erreicht haben. -> Ticks, ok
function leiter(ctx, zielDeck, maxSek) {
  const { g } = ctx;
  g.players.forEach((p, i) => g.handleMessage(g.cs[i], { t: 'act', down: true }));
  let t = 0;
  const alle = () => g.snapshot().players.every((q) => q.deck === zielDeck);
  while (!alle() && t < maxSek * TICK) { schritt(ctx); t++; }
  g.players.forEach((p, i) => g.handleMessage(g.cs[i], { t: 'act', down: false }));
  g.players.forEach((p) => { p.input.mx = 0; p.input.my = 0; });
  warte(ctx, 0.3);
  return { ticks: t, ok: alle() };
}
// Bergen: Spieler 0 hält E auf der Fundort-Kachel (Serverdauer anker.holdDuration)
function bergen(ctx, fund) {
  const { g, map } = ctx;
  const halter = g.players[0];
  g.handleMessage(g.cs[0], { t: 'act', down: true });
  const dauer = halter.hold && halter.hold.kind === 'anker:fund' ? halter.hold.dur : 0;
  let t = 0;
  while (t < (dauer + 3) * TICK && Anker.zustand(g, map, fund.id) === 'da') { schritt(ctx); t++; }
  g.handleMessage(g.cs[0], { t: 'act', down: false });
  warte(ctx, 0.2);
  return { ticks: t, ok: dauer >= 1 && Anker.zustand(g, map, fund.id) === 'genommen', dauer };
}

function lauf(art, np, fall, biom, seed) {
  const tag = `${art === 'hoehle' ? 'eigene Höhle' : 'Wildnis mit Höhle ' + biom} Seed ${seed}, ${np} Spieler, Fall ${fall === 'A' ? 'A ruhig' : 'B Lager an der Route'}`;
  console.log(`\n[${tag}]`);
  const t0 = Date.now();
  const { g, map, k } = H.neuesSpiel(np, art === 'hoehle' ? { art: 'hoehle', seed, groesse: 'mittel' } : { art: 'wildnis', seed, groesse: 'mittel', biom, hoehle: true });
  const E = combat.env(g);
  const S = k.decks ? k.decks.stride : Infinity;
  const ab = k.anker.find((a) => a.id === k.ankunft);
  const dk = (a) => (k.decks ? Math.floor(a.y / S) : 0);
  const begehbar = (x, y) => !E.solid(x, y);
  const weg = (von, nach) => bfs(begehbar, { x: von.x, y: von.y }, (x, y) => x === nach.x && y === nach.y, k.w, k.h);
  const nah = (von, liste) => liste.map((a) => ({ a, w: weg(von, a) })).filter((f) => f.w).sort((x, y) => x.w.length - y.w.length)[0];
  ok(g.players.length === np && g.players.every((p) => p.zone === 'away'), `${np} Spieler unten auf ${map} (${k.w}x${k.h}${k.decks ? ', 2 Decks' : ''})`);

  // Etappen der Route
  const funde = k.anker.filter((a) => a.rolle === 'fund');
  const lo = k.anker.find((a) => a.id === 'gelaende.leiter'), lu = k.anker.find((a) => a.id === 'hoehle.leiter');
  const etappen = [];   // { typ, ziel, fund?, deck }
  const routen = [];    // Kacheln der Route je Deck für die Lagerwahl
  const sammle = (von, nach) => { const w = weg(von, nach); if (w) routen.push(...w); return w; };
  let fundO = null, fundU = null, fundH = null;
  if (art === 'hoehle') {
    // nahe und fernere Funde: fall A nimmt den Fund mit den meisten Lagern abseits, B den nächsten
    fundH = nah(ab, funde);
    etappen.push({ typ: 'gehe', ziel: fundH.a, name: 'Hinweg zum Fund' }, { typ: 'bergen', fund: fundH.a, name: 'Fund bergen' }, { typ: 'gehe', ziel: ab, name: 'Rückweg zur Ankunft' });
  } else {
    fundO = nah(ab, funde.filter((a) => dk(a) === 0)); fundU = nah(lu, funde.filter((a) => dk(a) === 1));
    etappen.push({ typ: 'gehe', ziel: fundO.a, name: 'Hinweg Fund oben' }, { typ: 'bergen', fund: fundO.a, name: 'Fund oben bergen' },
      { typ: 'gehe', ziel: lo, name: 'Weg zur Leiter oben' }, { typ: 'leiter', deck: 1, name: 'Abstieg (E halten)' },
      { typ: 'gehe', ziel: fundU.a, name: 'Weg zum Fund unten' }, { typ: 'bergen', fund: fundU.a, name: 'Fund unten bergen' },
      { typ: 'gehe', ziel: lu, name: 'Weg zur Leiter unten' }, { typ: 'leiter', deck: 0, name: 'Aufstieg (E halten)' },
      { typ: 'gehe', ziel: ab, name: 'Rückweg zur Ankunft' });
  }
  // Route (für Lagerwahl) vorab aus der Planung
  { let pos = ab; for (const e of etappen) if (e.typ === 'gehe') { sammle(pos, e.ziel); pos = e.ziel; if (e.ziel === lo) pos = lu; if (e.ziel === lu) pos = lo; } }
  const lager = Object.keys(k.bereiche).filter((b) => k.bereiche[b].gefecht);
  const mitte = (b) => { const r = k.bereiche[b].rects[0]; return { x: r[0] + r[2] / 2, y: r[1] + r[3] / 2 }; };
  const abstand = (b) => Math.min(...routen.map((s) => Math.hypot(s.x - mitte(b).x, s.y - mitte(b).y)));
  let besetzt = 0, lagerGew = [];
  if (fall === 'A') {
    lagerGew = lager.filter((b) => abstand(b) >= 12 && Math.hypot(ab.x - mitte(b).x, ab.y - mitte(b).y) >= 12);
    for (const b of lagerGew) besetzt += combat.besetzen(g, { map, bereich: b, fraktion: 'raubzug', staerke: 'klein', tag: 'ga_' + b });
    console.log(`  Lager abseits der Route (>= 12 Kacheln): ${lagerGew.join(', ') || 'keine'} von ${lager.length}, ${besetzt} Gegner (klein)`);
  } else {
    // je Deck das Lager mit dem kleinsten Abstand zur Route (Mindestabstand zum Start 8)
    for (const deck of (k.decks ? [0, 1] : [0])) {
      const kand = lager.filter((b) => (k.decks ? Math.floor(mitte(b).y / S) : 0) === deck && Math.hypot(ab.x - mitte(b).x, ab.y - mitte(b).y) >= 8);
      kand.sort((x, y) => abstand(x) - abstand(y));
      if (kand[0]) { lagerGew.push(kand[0]); besetzt += combat.besetzen(g, { map, bereich: kand[0], fraktion: 'raubzug', staerke: 'klein', haltung: 'wach', tag: 'gb_' + kand[0] }); }
    }
    console.log(`  Lager an der Route: ${lagerGew.map((b) => b + ' (Abstand ' + abstand(b).toFixed(1) + ')').join(', ')}, ${besetzt} Gegner (klein)`);
  }
  ok(fall === 'B' ? besetzt > 0 : g.away.drones.length === besetzt, `${besetzt} Gegner aufgestellt${fall === 'A' && !besetzt ? ' (kein Lager abseits der Route: Lauf ohne Gegner)' : ''}`);

  const ctx = { g, map, k, E, tick: 0, obs: { verlauf: g.players.map(() => [0]), deck0: new Map(), wechsel: new Set(), getroffen: false, boden: false, bodenIds: new Set(), geholt: new Set(), alarm: false, projMax: 0 } };
  for (const d of g.away.drones) ctx.obs.deck0.set(d.id, H.deckVon(k, d));
  const start = g.away.drones.map((d) => ({ x: d.x, y: d.y }));
  // Etappen abfahren
  const phasen = []; let abbruch = null; const geborgen = [];
  for (const e of etappen) {
    let r;
    if (e.typ === 'gehe') r = gehe(ctx, e.ziel, 240);
    else if (e.typ === 'leiter') r = leiter(ctx, e.deck, 6);
    else { r = bergen(ctx, e.fund); if (r.ok) geborgen.push(e.fund.id); }
    phasen.push({ name: e.name, ticks: r.ticks, ok: r.ok });
    if (!r.ok) { abbruch = e.name; break; }
    if (ctx.obs.boden && fall === 'B') { /* beobachtet, Lauf geht weiter */ }
  }
  let beam = false;
  if (!abbruch) {
    const t1 = ctx.tick;
    ctx.beamen = true; away.executeBeam(g, g.players.map((p) => p.id), 'up'); warte(ctx, 2);
    beam = g.players.every((p) => p.zone === 'ship');
    phasen.push({ name: 'Beam hoch', ticks: ctx.tick - t1, ok: beam });
  }
  if (fall === 'B') warte(ctx, 3);
  const daheim = g.players.filter((p) => p.zone === 'ship').length;
  const unten = np - daheim;
  const bewegt = g.away ? g.away.drones.filter((d, i) => start[i] && Math.hypot(d.x - start[i].x, d.y - start[i].y) > 32).length : 0;
  console.log('  Phasen: ' + phasen.map((p) => `${p.name} ${sek(p.ticks)}${p.ok ? '' : ' (FEHLGESCHLAGEN)'}`).join(' | '));
  const gesamt = phasen.reduce((s, p) => s + p.ticks, 0);
  console.log(`  Gesamt ${sek(gesamt)} Spielzeit, Funde geborgen: ${geborgen.length}/${fundO ? 2 : 1} (${geborgen.join(', ') || '-'}), Abbruch: ${abbruch || 'nein'}`);
  console.log(`  Ausfälle: Spieler am Boden/verwundet beobachtet ${ctx.obs.getroffen}, Spieler am Boden ${ctx.obs.bodenIds.size}/${np}, vom Server aufs Schiff geholt (Ausfall) ${ctx.obs.geholt.size}/${np}, nicht aufs Schiff ${unten}/${np}; Alarm ${ctx.obs.alarm}, ${bewegt}/${start.length} Gegner >1 Kachel bewegt, Geschosse max ${ctx.obs.projMax}`);
  console.log(`  Deckwechsel von Gegnern: ${ctx.obs.wechsel.size}; players[].deck-Verlauf: ` + ctx.obs.verlauf.map((v, i) => `S${i}[${v.join('>')}]`).join(' '));
  const fehler = H.fehlerZahl(g);

  // ---- Prüfungen mit festen Schwellen ----
  ok(fehler === 0, `0 Serverfehler (g.errors ${fehler})`);
  ok(ctx.obs.wechsel.size === 0, `kein Gegner wechselt das Deck (${ctx.obs.wechsel.size} von ${start.length}, Ziel 0)`);
  ok(ctx.obs.verlauf.every((v) => v.every((d) => d === 0 || d === 1)) && (art !== 'wildnis' || fall === 'B' || ctx.obs.verlauf.every((v) => v.join('>') === '0>1>0')) && (art !== 'hoehle' || ctx.obs.verlauf.every((v) => v.join('>') === '0')), 'players[].deck-Verlauf ' + (art === 'hoehle' ? 'immer 0' : fall === 'A' ? 'je Spieler genau 0>1>0' : 'nur 0/1'));
  if (fall === 'A') {
    ok(!abbruch, `alle Phasen gelungen (${phasen.length}, Abbruch ${abbruch || 'keiner'})`);
    ok(geborgen.length === (fundO ? 2 : 1) && geborgen.every((id) => Anker.zustand(g, map, id) === 'genommen'), `Fund(e) geborgen: ${geborgen.join(', ')} (Zustand genommen)`);
    ok(beam && daheim === np, `alle ${np} Spieler nach dem Beam auf dem Schiff (${daheim}/${np})`);
    ok(!ctx.obs.getroffen && !ctx.obs.boden, 'kein Spieler getroffen oder am Boden');
    ok(gesamt / TICK < 300, `Gesamtdauer ${sek(gesamt)} unter 300 s Spielzeit`);
    if (fundU) ok(geborgen.includes(fundU.a.id), 'Fund auf Deck 1 geborgen');
  } else {
    const reagiert = ctx.obs.alarm || bewegt > 0 || ctx.obs.projMax > 0 || ctx.obs.getroffen;
    console.log(`  Verhalten beobachtet (keine Abnahme): Abbruch ${abbruch || 'nein'}, Funde ${geborgen.length}, ${unten} von ${np} nicht aufs Schiff`);
    ok(reagiert, 'Gegner reagieren (Alarm, Bewegung, Geschosse oder Treffer beobachtet); der Fund muss hier NICHT gelingen');
  }
  console.log(`  Realzeit ${Date.now() - t0} ms`);
  return { tag, gesamt, abbruch, unten, boden: ctx.obs.bodenIds.size, geholt: ctx.obs.geholt.size, geborgen: geborgen.length, wechsel: ctx.obs.wechsel.size, fehler };
}

const ERG = [];
const FAELLE = [];
for (const [biom, seed] of [['wueste', 11], ['wiesenwald', 12], ['vulkan', 13]]) for (const np of [2, 4]) for (const fall of ['A', 'B']) FAELLE.push(['wildnis', np, fall, biom, seed]);
for (const seed of [5, 6, 7]) for (const np of [2, 4]) for (const fall of ['A', 'B']) FAELLE.push(['hoehle', np, fall, null, seed]);
for (const f of FAELLE) {
  try { ERG.push(lauf(...f)); } catch (e) { bad++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
}
console.log('\nÜbersicht (Spielzeit, Ausfälle, Funde, Deckwechsel von Gegnern)');
for (const r of ERG) console.log(`  ${r.tag}: ${sek(r.gesamt)}, am Boden ${r.boden}, geholt ${r.geholt}, nicht zurück ${r.unten}, Funde ${r.geborgen}, Deckwechsel ${r.wechsel}, Fehler ${r.fehler}${r.abbruch ? ', Abbruch bei ' + r.abbruch : ''}`);
console.log(`\n${n - bad}/${n} ok`);
if (bad) { console.log(`${bad} FEHLER`); process.exit(1); }
console.log('TEST-HOEHLE-GRUPPENLAUF OK');
