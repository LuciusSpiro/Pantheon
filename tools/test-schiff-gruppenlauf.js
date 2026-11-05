#!/usr/bin/env node
'use strict';
// SCH-01 P5: Gruppenlauf auf der generierten Prise (Generatorschiff mit Fallen): echter Server-Tick im selben Prozess, gescriptete Eingaben (input.mx/my, act-Nachrichten),
// keine Menschen, kein Kampf (Spieler unverwundbar, god an), Wachen stehen. Zustand umkaempft (Barrikaden, Wachen, 2 Fallen). Je Lauf: alle Spieler gehen Deck 1 ab, wechseln per Leiter oder Lift
// aufs Deck 2, holen Terminal/Beute/Zelle/Ziel/Sprengpunkt (E halten), gehen zurück zum Abholpunkt und beamen hoch. Blockiert eine Tür den Weg (zu, Schott), stoppt der Bot, hält E und drückt es
// alle 20 Ticks neu (die Haltezeit bricht bei Bewegungs-Input ab). Fallen lösen dabei aus (die Bot-Spieler kennen sie nicht), die Schotts öffnen sich per Hacken oder nach Ablauf wieder.
// BELEGT (feste Schwellen): jedes Ziel erreicht und benutzt, Rückweg zum Abholpunkt, alle hochgebeamt, keine Fehlermeldung des Bots, Server fehlerfrei.
// NICHT belegt: Gruppenspiel unter Druck; kein Kampf, keine Deckung, kein Entschärfen. Laufzeit je Lauf ca. 170-200 s (Stufe slow).
//   node tools/test-schiff-gruppenlauf.js [--seeds 5,17,42] [--layouts schiff,rechteck] [--np 1,3]
process.chdir(require('path').join(__dirname, '..'));
const Physics = require('../shared/physics.js');
const CONFIG = require('../shared/config.js');
const Anker = require('../server/sim/anker.js');
const away = require('../server/sim/away.js');
const combat = require('../server/sim/combat.js');
const { bfs } = require('../server/util.js');
const H = require('./gel02-hilfen.js');

let n = 0, bad = 0;
const ok = (c, t) => { n++; if (!c) { bad++; console.log('  FEHLER ' + t); } else console.log('  ok   ' + t); };
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1].split(',') : def; };
const SEEDS = arg('seeds', ['5', '17', '42']).map(Number), LAYOUTS = arg('layouts', ['schiff', 'rechteck']), NPS = arg('np', ['1', '3']).map(Number);
const TICK = CONFIG.tickHz;
const tv = (o) => Physics.toTile(o.x, o.y);

function lauf(layout, seed, np) {
  const bauweise = layout === 'rechteck' ? 'rom' : 'germanen', besitz = layout === 'rechteck' ? 'rom' : 'rostmeute', fraktion = layout === 'rechteck' ? 'rom' : 'rostmeute';
  const { g, map, k } = H.neuesSpiel(np, { art: 'schiff', seed, bauweise, besitz, zustand: 'umkaempft', fraktion, staerke: 'mittel', haltung: 'wach' });
  g.god = true; g.inventory.ladung = 5;
  const E = combat.env(g);
  const out = { layout, seed, np, map, w: k.w, h: k.h, schablone: k.schablone, bauweise: k.bauweise, log: [], fehler: [] };
  const S = k.decks.stride;
  const deckY = (y) => Math.floor(y / S);
  const isDoor = (x, y) => { const info = k.legende[(k.rows[y] || '')[x]]; return !!(info && info.kante === 'tuer'); };
  const passable = (x, y) => !E.solid(x, y) || isDoor(x, y);
  let tick = 0;
  const step = () => { g.step(); tick++; };
  const hold = (i, down) => g.handleMessage(g.cs[i], { t: 'act', down });
  const stop = () => g.players.forEach((p) => { p.input.mx = 0; p.input.my = 0; });
  out.wachen = g.away.drones.filter((d) => d.alive).map((d) => ({ id: d.id, x: Math.floor(d.x / 32), y: Math.floor(d.y / 32), deck: deckY(Math.floor(d.y / 32)) }));
  let tuerOffen = 0, maxMs = 0;
  function gehe(ziel, nah, maxSek) {
    const linkTile = (x, y) => (k.decks.links || []).some((l) => (l.a[0] === x && l.a[1] === y) || (l.b[0] === x && l.b[1] === y));
    const goal = nah ? (x, y) => Math.abs(x - ziel.x) + Math.abs(y - ziel.y) <= 1 && passable(x, y) && !linkTile(x, y) : (x, y) => x === ziel.x && y === ziel.y;
    const pfade = g.players.map((p) => bfs(passable, tv(p), goal, k.w, k.h));
    if (pfade.some((x) => !x)) { out.log.push('kein Pfad von ' + JSON.stringify(tv(g.players[0])) + ' nach ' + JSON.stringify(ziel)); return false; }
    const ix = g.players.map(() => 0);
    let t = 0, blockT = 0;
    while (t < maxSek * TICK) {
      let fertig = true, blockiert = false;
      g.players.forEach((p, i) => {
        const pfi = pfade[i];
        if (ix[i] >= pfi.length) { p.input.mx = 0; p.input.my = 0; return; }
        let z = Physics.tileCenter(pfi[ix[i]].x, pfi[ix[i]].y);
        if (Math.hypot(z.x - p.x, z.y - p.y) < 6) { ix[i]++; if (ix[i] >= pfi.length) { p.input.mx = 0; p.input.my = 0; return; } z = Physics.tileCenter(pfi[ix[i]].x, pfi[ix[i]].y); }
        fertig = false;
        const nt = pfi[ix[i]];
        if (E.solid(nt.x, nt.y) && isDoor(nt.x, nt.y)) blockiert = true;
        const ex = z.x - p.x, ey = z.y - p.y, e = Math.hypot(ex, ey) || 1;
        p.input.mx = ex / e; p.input.my = ey / e;
      });
      if (fertig) { stop(); return true; }
      if (blockiert) { stop(); blockT++; if (blockT === 1) { tuerOffen++; g.players.forEach((p, i) => hold(i, true)); } else if (blockT % 20 === 0) g.players.forEach((p, i) => { if (!p.hold) { hold(i, false); hold(i, true); } }); }   // P5: wie ein Spieler erneut E drücken, wenn die Haltezeit beim Anlaufen abbrach (Schott schließt sich mitten im Lauf)
      else if (blockT) { blockT = 0; g.players.forEach((p, i) => hold(i, false)); }
      if (blockT > 15 * TICK) { stop(); g.players.forEach((p, i) => hold(i, false)); out.fehler.push('Tuer blockiert dauerhaft'); return false; }
      const t0 = process.hrtime.bigint(); step(); maxMs = Math.max(maxMs, Number(process.hrtime.bigint() - t0) / 1e6); t++;
    }
    stop(); return false;
  }
  const warte = (s) => { for (let i = 0; i < s * TICK; i++) step(); };
  const ank = k.anker;
  function benutze(a, maxSek) {
    const v0 = Anker.zustand(g, map, a.id);
    const p = g.players[0];
    const t = tv(p); const dx = Math.sign(a.x - t.x), dy = Math.sign(a.y - t.y);
    p.dir = dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up'; step(); stop();
    hold(0, true);
    let n = 0;
    while (n < maxSek * TICK) { step(); n++; const z = Anker.zustand(g, map, a.id); if (z !== v0 && !p.hold) break; }
    hold(0, false); warte(0.3);
    return { id: a.id, rolle: a.rolle, vorher: v0, nachher: Anker.zustand(g, map, a.id), sek: +(n / TICK).toFixed(1) };
  }
  function deckWechsel(zielDeck) {
    const cur = deckY(tv(g.players[0]).y);
    const links = (k.decks.links || []).map((l) => ({ via: l.via, from: cur === 0 ? l.a : l.b }));
    for (const l of links) {
      const ok = gehe({ x: l.from[0], y: l.from[1] }, false, 120);
      if (!ok) { out.log.push(`deck: Weg zu ${l.via} (${l.from}) fehlgeschlagen`); continue; }
      if (l.via === 'leiter') { g.players.forEach((p, i) => hold(i, true)); let n = 0; while (n < 6 * TICK && !g.players.every((p) => deckY(tv(p).y) === zielDeck)) { step(); n++; } g.players.forEach((p, i) => hold(i, false)); }
      else { g.players.forEach((p, i) => hold(i, true)); step(); g.players.forEach((p, i) => hold(i, false)); warte(3.2); }
      const alle = g.players.every((p) => deckY(tv(p).y) === zielDeck);
      out.log.push(`deck ${cur}->${zielDeck} via ${l.via}: ${alle ? 'ok' : 'FEHL'}`);
      if (alle) return l.via;
      stop();
    }
    return null;
  }
  const rollen = ['terminal', 'beute', 'zelle', 'ziel', 'sprengpunkt'];
  const nachDeck = (d) => ank.filter((a) => rollen.includes(a.rolle) && deckY(a.y) === d);
  const res = [];
  const d0 = deckY(tv(g.players[0]).y); out.startDeck = d0;
  for (const deck of [d0, 1 - d0]) {
    if (deckY(tv(g.players[0]).y) !== deck) { const via = deckWechsel(deck); if (!via) { out.fehler.push('Deckwechsel nach ' + deck + ' gescheitert'); break; } }
    let rest = nachDeck(deck);
    while (rest.length) {
      const t = tv(g.players[0]);
      const sorted = rest.map((a) => ({ a, d: Math.abs(a.x - t.x) + Math.abs(a.y - t.y) })).sort((x, y) => x.d - y.d);
      const a = sorted[0].a; rest = rest.filter((x) => x !== a);
      const ok = gehe({ x: a.x, y: a.y }, true, 120);
      if (!ok) { res.push({ id: a.id, rolle: a.rolle, erreicht: false }); continue; }
      res.push(Object.assign({ erreicht: true }, benutze(a, a.rolle === 'terminal' ? 20 : 12)));
    }
  }
  const ab = ank.find((a) => a.id === k.ankunft);
  if (deckY(tv(g.players[0]).y) !== deckY(ab.y)) deckWechsel(deckY(ab.y));
  const heim = gehe({ x: ab.x, y: ab.y }, false, 120);
  away.executeBeam(g, g.players.map((p) => p.id), 'up'); warte(2.5);
  out.res = res; out.heimAbholpunkt = heim; out.hoch = g.players.every((p) => p.zone === 'ship');
  out.sek = +(tick / TICK).toFixed(0); out.tuerOffen = tuerOffen; out.maxTickMs = +maxMs.toFixed(1);
  out.serverFehler = H.fehlerZahl(g);
  return out;
}

for (const layout of LAYOUTS) for (const seed of SEEDS) for (const np of NPS) {
  const tag = `${layout} Seed ${seed} np${np}`;
  let o;
  try { o = lauf(layout, seed, np); } catch (e) { ok(false, `${tag}: Ausnahme ${String(e.stack).split(String.fromCharCode(10)).slice(0, 3).join(' | ')}`); continue; }
  const ziele = o.res.filter((r) => r.rolle), erreicht = ziele.filter((r) => r.erreicht).length, geaendert = ziele.filter((r) => r.erreicht && r.vorher !== r.nachher).length;
  console.log(`[${tag}] ${o.map} ${o.w}x${o.h}: Ziele erreicht ${erreicht}/${ziele.length}, Zustand geändert ${geaendert}, Türen ${o.tuerOffen}, ${o.sek} s, Tick max ${o.maxTickMs} ms${o.log.length ? ' | ' + o.log.join('; ') : ''}`);
  ok(ziele.length > 0 && erreicht === ziele.length, `${tag}: alle Ziele erreicht (${erreicht}/${ziele.length}${ziele.filter((r) => !r.erreicht).map((r) => ' ' + r.id).join('')})`);
  ok(o.heimAbholpunkt === true && o.hoch === true, `${tag}: Rückweg zum Abholpunkt, alle hochgebeamt`);
  ok(o.fehler.length === 0, `${tag}: keine Fehlermeldung des Bots (${o.fehler.join(', ')})`);
  ok(o.serverFehler === 0, `${tag}: keine Serverfehler (${o.serverFehler})`);
}
console.log(`
${n - bad}/${n} Prüfungen bestanden`);
process.exit(bad ? 1 : 0);
