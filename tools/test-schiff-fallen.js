#!/usr/bin/env node
'use strict';
// SCH-01 P5: Fallen im Generatorschiff im laufenden Spiel (echter Server-Tick im selben Prozess, gescriptete Eingaben, Testgelände art schiff, solo und np3).
// Je Karte (Zustand verfallen, Layouts schiff und rechteck, mehrere Seeds; dazu intakt und umkaempft je Layout, Spieler unverwundbar):
//   a) verborgene Fallen stehen weder mit Id noch mit Koordinaten in den Nachrichten an die Clients (awayMap, Snapshots); passive stehen mit Id im Payload
//   b) Scan Stufe 2 erkennt eine verborgene Falle: Zustand erkannt, bei JEDEM Client genau ein ankerEnthuellt mit Id und Ort
//   c) E halten entschärft eine erkannte Falle (Nachbarkachel), danach löst Betreten nichts mehr aus
//   d) Auslösen genau einmal (mehrere Spieler gleichzeitig, Verlassen und Wiedereintreten), Wirkung je Typ: schott (Kante zu, nach Ablauf wieder offen), druck (falleFeld an), schuss (3 Schuss, Kollisionsbox)
//   f) Schaden ohne god (Zustände intakt, verfallen, umkaempft): Druckverlust CONFIG.anker.falle.feld.druck.segmente je takt s, Selbstschussanlage schuss.schuesse Treffer je schuss.segmente
//   e) die Selbstschussanlage blockiert erst ab Erkennen (Box), Pflicht-Anker bleiben auch dann erreichbar (Hindernis im Spiel, nicht nur im Generator)
//   node tools/test-schiff-fallen.js      (Umgebung: SEEDS=a,b,c Seeds, Standard 5,17,42)
process.chdir(require('path').join(__dirname, '..'));
const Physics = require('../shared/physics.js');
const CONFIG = require('../shared/config.js');
const Buehne = require('../shared/buehne.js');
const Anker = require('../server/sim/anker.js');
const Scanbar = require('../server/sim/scanbar.js');
const interior = require('../server/sim/interior.js');
const combat = require('../server/sim/combat.js');
const H = require('./gel02-hilfen.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const DT = 1 / CONFIG.tickHz, TILE = Physics.TILE;
const SEEDS = (process.env.SEEDS || '5,17,42').split(',').map(Number);

function szene(layout, seed, np, zustand, god) {
  const rom = layout === 'rechteck';
  const { g, map, k } = H.neuesSpiel(np, { art: 'schiff', seed, bauweise: rom ? 'rom' : 'germanen', besitz: rom ? 'rom' : 'rostmeute', zustand: zustand || 'verfallen', fraktion: rom ? 'rom' : 'rostmeute', staerke: 'mittel', haltung: 'wach' });
  g.god = god !== false;
  const S = { g, map, k, ps: g.players, ev: [], me: [] };
  const e0 = g.emit.bind(g); g.emit = function (t, d) { S.ev.push([t, d]); return e0(t, d); };
  const m0 = g.missionEvent.bind(g); g.missionEvent = (nm, a) => { S.me.push([nm, a]); return m0(nm, a); };
  S.lauf = (sek) => { for (let i = 0; i < Math.round(sek / DT); i++) { g.away.drones.length = 0; g.step(); } };   // Wachen stehen still: der Test prüft Fallen, nicht den Kampf
  S.z = (id) => Anker.zustand(g, map, id);
  S.mitte = (a) => Physics.tileCenter(a.x, a.y);
  S.hin = (p, x, y) => { p.x = x; p.y = y; p.input.mx = 0; p.input.my = 0; };
  S.client = (i) => g.cs[i].inbox;
  S.enth = (i) => S.client(i).filter((m) => m.t === 'event' && m.kind === 'ankerEnthuellt');
  S.zahl = (name) => S.ev.filter((e) => e[0] === name).length;
  S.aus = (id) => S.me.filter((m) => m[0] === 'falleAusgeloest' && m[1].anker === id).length;
  // freie begehbare Nachbarkachel (4er), Mittelpunktabstand 1,0 Kachel: außerhalb jeder Auslösezone (<= 0,9), E-Griff erreicht sie
  S.nachbar = (a) => { const r = Buehne.raster(S.k); const t = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: a.x + dx, y: a.y + dy })).find((q) => r.durchgang(q.x, q.y) && !S.k.anker.some((o) => o.x === q.x && o.y === q.y && o.rolle !== 'falle')); return t ? Physics.tileCenter(t.x, t.y) : null; };
  return S;
}

function lauf(layout, seed, np, zustand) {
  zustand = zustand || 'verfallen';
  const S = szene(layout, seed, np, zustand), { g, k } = S, p = S.ps[0];
  const tag = `${layout} ${zustand} Seed ${seed} np${np}`;
  const fa = k.anker.filter((a) => a.rolle === 'falle');
  const verb = fa.filter((a) => a.sicht === 'verborgen'), pass = fa.filter((a) => a.sicht === 'passiv');
  console.log(`[${tag}] ${k.id || S.map}: ${fa.length} Fallen (${fa.map((a) => a.typ + '/' + a.sicht).join(', ')})`);
  ok((zustand === 'umkaempft' ? fa.length === 2 : fa.length >= 3 && fa.length <= 4) && verb.length >= 1 && pass.length >= 1, `${tag}: Karte trägt Fallen (${zustand === 'umkaempft' ? 2 : '3-4'}), passiv und verborgen`);
  S.lauf(0.5);
  // a) Verschwiegenheit: alles, was die Clients bisher bekamen
  for (let i = 0; i < np; i++) {
    const roh = JSON.stringify(S.client(i));
    const leck = verb.filter((a) => roh.includes(a.id) || roh.includes('"falle",' + a.x + ',' + a.y + ','));
    ok(leck.length === 0, `${tag}: Client ${i} bekam keine verborgene Falle (weder Id noch Ort) in ${S.client(i).length} Nachrichten`);
    ok(pass.every((a) => roh.includes(a.id)), `${tag}: Client ${i} kennt die passiven Fallen mit Id`);
  }
  const snap = JSON.stringify(g.snapshot());
  ok(verb.every((a) => !snap.includes(a.id)), `${tag}: Snapshot nennt keine verborgene Falle`);
  // Wahl: eine verborgene zum Scannen und Entschärfen (bevorzugt ohne Box: Typ ohne schuss), eine andere zum Auslösen
  const hv = verb.find((a) => a.typ !== 'schuss') || verb[0];
  const ent = hv;
  // b) Scan Stufe 2 von der Nachbarkachel
  const nb = S.nachbar(ent);
  ok(!!nb, `${tag}: freie Nachbarkachel an ${ent.typ}-Falle`);
  S.hin(p, nb.x, nb.y); S.lauf(0.2);
  ok(S.z(ent.id) === 'verborgen', `${tag}: verborgene Falle steht vor dem Scan auf verborgen`);
  Scanbar.debugScanfertig(g, p, 1); S.lauf(DT * 2);
  ok(S.z(ent.id) === 'verborgen' && S.enth(0).length === 0, `${tag}: Scan Stufe 1 enthüllt nichts`);
  Scanbar.debugScanfertig(g, p, 2); S.lauf(DT * 3);
  ok(S.z(ent.id) === 'erkannt', `${tag}: Scan Stufe 2 -> erkannt`);
  for (let i = 0; i < np; i++) { const ev = S.enth(i).filter((m) => m.anker[0] === ent.id); ok(ev.length === 1 && ev[0].anker[2] === ent.x && ev[0].anker[3] === ent.y, `${tag}: Client ${i} bekommt genau ein ankerEnthuellt mit Id und Ort`); }
  // c) Entschärfen (E halten)
  const hb = Anker.zustand(g, S.map, ent.id);
  g.handleMessage(g.cs[0], { t: 'act', down: true }); S.lauf(CONFIG.anker.halten.falle + 0.5); g.handleMessage(g.cs[0], { t: 'act', down: false }); S.lauf(0.2);
  ok(hb === 'erkannt' && S.z(ent.id) === 'entschaerft', `${tag}: E halten entschärft die erkannte ${ent.typ}-Falle`);
  // Betreten der entschärften Falle löst nichts aus
  const vorher = S.aus(ent.id) + S.zahl('selbstschuss') + S.zahl('falleFeld') + S.zahl('falleSchott');
  if (ent.typ !== 'schuss') { const c = S.mitte(ent); S.hin(p, c.x, c.y); S.lauf(1.5); }
  ok(S.aus(ent.id) + S.zahl('selbstschuss') + S.zahl('falleFeld') + S.zahl('falleSchott') === vorher && S.z(ent.id) === 'entschaerft', `${tag}: entschärfte Falle löst nicht mehr aus`);
  S.hin(p, nb.x, nb.y); S.lauf(0.1);
  // d) alle anderen nacheinander auslösen (so kommt jeder Typ der Karte dran): alle Spieler gleichzeitig, genau einmal, Wirkung je Typ
  const rest = fa.filter((a) => a !== ent);
  for (const f of rest.sort((a, b) => (a.sicht === 'passiv' ? 0 : 1) - (b.sicht === 'passiv' ? 0 : 1))) {
    if (S.z(f.id) === 'entschaerft') continue;
    const c = S.mitte(f), e0 = S.ev.length;
    for (const q of S.ps) S.hin(q, c.x, c.y);
    S.lauf(f.typ === 'schott' ? 1.0 : f.typ === 'schuss' ? 2.5 : 2.5);
    const ev = S.ev.slice(e0);
    ok(S.z(f.id) === 'ausgeloest' && S.aus(f.id) === 1, `${tag}: ${f.id} (${f.typ}, ${f.sicht}) löst bei ${np} Spieler(n) auf der Kachel genau einmal aus (Ereignisse ${S.aus(f.id)})`);
    if (f.typ === 'schott') {
      const an = ev.find((x) => x[0] === 'falleSchott' && x[1].an === 1 && x[1].anker === f.id);
      ok(an && an[1].kanten.length >= 1, `${tag}: Schott schließt sich (falleSchott an, ${an ? an[1].kanten.length : 0} Kante(n))`);
      ok(an && an[1].kanten.some((kid) => S.z(kid) === 'zu'), `${tag}: mindestens eine Kante im Zustand zu`);
      S.hin(p, S.nachbar(f).x, S.nachbar(f).y);
      S.lauf(CONFIG.anker.falle.schott.dauer + 1);
      ok(an && an[1].kanten.every((kid) => S.z(kid) !== 'zu') && S.ev.some((x) => x[0] === 'falleSchott' && x[1].an === 0 && x[1].anker === f.id), `${tag}: Schott öffnet nach ${CONFIG.anker.falle.schott.dauer} s wieder von selbst`);
    } else if (f.typ === 'druck') {
      ok(ev.some((x) => x[0] === 'falleFeld' && x[1].an === 1 && x[1].anker === f.id), `${tag}: Druckverlust meldet falleFeld an`);
    } else {
      ok(ev.filter((x) => x[0] === 'selbstschuss' && x[1].anker === f.id).length === 3, `${tag}: Selbstschussanlage gibt 3 Schuss ab (${ev.filter((x) => x[0] === 'selbstschuss' && x[1].anker === f.id).length})`);
    }
    // Verlassen und Wiedereintreten: kein zweites Auslösen
    const nbf = S.nachbar(f); if (nbf) { for (const q of S.ps) S.hin(q, nbf.x, nbf.y); S.lauf(0.3); for (const q of S.ps) S.hin(q, c.x, c.y); S.lauf(0.5); }
    ok(S.aus(f.id) === 1, `${tag}: Wiedereintreten löst nicht erneut aus`);
  }
  // e) Box im Spiel: jede Selbstschussanlage blockiert ab Erkennen, Pflicht-Anker bleiben in der echten Kollision erreichbar
  const schuss = fa.filter((a) => a.typ === 'schuss');
  for (const f of schuss) if (S.z(f.id) === 'verborgen') Anker.setzen(g, S.map, f.id, 'erkannt', null);
  const solid = interior.awaySolid(g), R = Buehne.raster(k);
  ok(schuss.every((f) => solid(f.x, f.y)), `${tag}: erkannte Selbstschussanlage ist in der Server-Kollision fest`);
  const ank = k.anker.find((a) => a.rolle === 'abholpunkt' && a.ankunft);
  const dist = new Set([ank.x + ',' + ank.y]), q = [[ank.x, ank.y]];
  const lk = new Map(); for (const l of k.decks.links) { lk.set(l.a.join(','), l.b); lk.set(l.b.join(','), l.a); }
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i]; const nbs = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]; const l = lk.get(x + ',' + y); if (l) nbs.push(l);
    for (const [nx, ny] of nbs) if (!dist.has(nx + ',' + ny) && R.durchgang(nx, ny) && !solid(nx, ny)) { dist.add(nx + ',' + ny); q.push([nx, ny]); }
  }
  const pf = k.anker.filter((a) => ['lift', 'leiter', 'eingang', 'terminal', 'ziel', 'sprengpunkt', 'abholpunkt', 'zelle', 'beute'].includes(a.rolle));
  const weg = pf.filter((a) => !dist.has(a.x + ',' + a.y) && ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => dist.has((a.x + dx) + ',' + (a.y + dy))));
  ok(weg.length === 0, `${tag}: alle ${pf.length} Pflicht-Anker bei fester Kollision erreichbar (${weg.map((a) => a.id).join(', ')})`);
  ok(H.fehlerZahl(g) === 0, `${tag}: keine Serverfehler`);
}

// f) Schaden ohne god: ein Spieler steht auf der Kachel; gezählt wird, was combat.hitPlayer von der Falle bekommt, dazu die Wirkung am Schild
const SPY = [];
const hp0 = combat.hitPlayer;
combat.hitPlayer = function (game, p, segs, source) { SPY.push({ pid: p.id, segs, kind: source && source.kind ? source.kind : source }); return hp0.apply(this, arguments); };
const gezaehlt = { druck: 0, schuss: 0 };
function schaden(layout, seed, zustand) {
  const tag0 = `Schaden ${layout} ${zustand} Seed ${seed}`;
  for (const typ of ['druck', 'schuss']) {
    const S = szene(layout, seed, 1, zustand, false), { g, k } = S, p = S.ps[0];
    const f = k.anker.find((a) => a.rolle === 'falle' && a.typ === typ);
    if (!f) continue;   // diese Karte hat keine Falle dieses Typs
    gezaehlt[typ]++;
    const tag = `${tag0} ${typ} (${f.sicht})`;
    const F = CONFIG.anker.falle, max0 = (CONFIG.shield || {}).segments;
    S.lauf(0.3);
    const c = S.mitte(f); S.hin(p, c.x, c.y);
    SPY.length = 0;
    const sh0 = p.shield ? p.shield.seg : null;
    let erwartet, seg, kind, dauer;
    if (typ === 'druck') { const C = F.feld.druck; seg = C.segmente; kind = C.quelle || 'druck'; erwartet = 2; dauer = C.takt * erwartet + 0.5; }
    else { const C = F.schuss; seg = C.segmente; kind = 'selbstschuss'; erwartet = C.schuesse; dauer = C.verzug + C.takt * (C.schuesse - 1) + 1.0; }
    S.lauf(dauer);
    const mine = SPY.filter((s) => s.pid === p.id && s.kind === kind);
    ok(mine.length === erwartet && mine.every((s) => s.segs === seg), `${tag}: ${mine.length} Treffer à ${mine[0] ? mine[0].segs : '-'} Segment(e) (erwartet ${erwartet} à ${seg}, aus CONFIG anker.falle)`);
    ok(p.downed || (p.shield && sh0 != null && p.shield.seg <= sh0 - 1) || (max0 != null && erwartet * seg >= max0), `${tag}: Schaden kommt beim Spieler an (Schild ${sh0} -> ${p.shield ? p.shield.seg : '-'}${p.downed ? ', verwundet' : ''})`);


    ok(H.fehlerZahl(g) === 0, `${tag}: keine Serverfehler`);
  }
}

for (const layout of ['schiff', 'rechteck']) for (const seed of SEEDS) for (const np of [1, 3]) lauf(layout, seed, np);
// alle drei Zustände: intakt und umkaempft zusätzlich zu verfallen (mindestens ein Seed je Layout)
for (const layout of ['schiff', 'rechteck']) for (const zustand of ['intakt', 'umkaempft']) lauf(layout, SEEDS[0], layout === 'schiff' ? 1 : 3, zustand);
for (const layout of ['schiff', 'rechteck']) for (const zustand of ['intakt', 'verfallen', 'umkaempft']) for (const seed of SEEDS) schaden(layout, seed, zustand);
ok(gezaehlt.druck >= 3 && gezaehlt.schuss >= 3, `Schadensprüfung deckt beide Typen ab (Druck ${gezaehlt.druck}, Schuss ${gezaehlt.schuss} Karten)`);
console.log(`\n${n - fails}/${n} Prüfungen bestanden`);
process.exit(fails ? 1 : 0);
