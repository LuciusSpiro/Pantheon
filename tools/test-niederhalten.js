'use strict';
// BOD-02 P3 – Niederhalten (Rolle des Sturmgewehrs).
//   - knapper Fehlschuss (Geschoss geht < niederhalten.knapp px am Ziel vorbei, kein Treffer) setzt das Schildladen des Beinahe-Getroffenen
//     zurück (ohne Schaden) und setzt k.nieder; gleiche Regel für Spieler und Gegner als Ziel
//   - weit daneben: nichts; Treffer: normaler Treffer, kein knapp; höchstens einmal je Geschoss und Ziel
//   - Ereignis knapp { id, x, y, von } nur für Spieler als Ziel, je Ziel rate-limitiert
//   - niedergehalten läuft ab und erneuert sich; Streuung ×streuFaktor (alle Schützen), Feuerintervall ×intervallFaktor (nur KI)
//   - KI: niedergehaltener Gegner verlässt seinen Platz nicht und plant keinen Vorstoß
//   - Lanze (Strahl) löst kein Niederhalten aus
//   - Wirkung: Treffer eines Gegner-Schützen ohne/mit Niederhalten (feste Seeds), Zahlen werden ausgegeben
const Physics = require('../shared/physics.js');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const combat = require('../server/sim/combat.js');
const squad = require('../server/sim/squad.js');
const away = require('../server/sim/away.js');
const Wf = require('../server/sim/waffen.js');
const W = require('../server/world.js');
const KACHELN = require('../content/buehnen/kacheln.json').zeichen;

Wf.aktiv = true;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const TILE = Physics.TILE;
const AC = CONFIG.awayCombat;
const NH = AC.niederhalten;
const NH0 = JSON.parse(JSON.stringify(NH));
const restore = () => { Object.assign(NH, JSON.parse(JSON.stringify(NH0))); };
const LP = 'test.niederhalten';
const ZEILE = 6;

function karte() {
  const grid = [];
  for (let y = 0; y < 14; y++) { const r = []; for (let x = 0; x < 50; x++) r.push((x === 0 || y === 0 || x === 49 || y === 13) ? '#' : '.'); grid.push(r); }
  const rows = grid.map((r) => r.join(''));
  const legende = {};
  for (const r of rows) for (const ch of r) legende[ch] = KACHELN[ch];
  const A = (id, rolle, x, y, extra) => Object.assign({ id, rolle, x, y, platz: id.split('.')[0], bereich: null }, extra || {});
  return { id: LP, erzeuger: 'modul/1', art: 'aussenposten', bauweise: 'germanen', besitz: 'rostmeute', zustand: 'intakt', seed: 2, bauversion: 'test',
    schablone: null, spiegel: null, w: 50, h: 14, rows, legende, anker: [A('lz.abholpunkt', 'abholpunkt', 2, 11, { ankunft: true, bereich: 'lz' })],
    bereiche: { lz: { name: 'Landezone', rects: [[1, 10, 6, 3]], rolle: 'hinein', gefecht: false } },
    plaetze: {}, eingaenge: [], abholpunkte: ['lz.abholpunkt'], ankunft: 'lz.abholpunkt',
    patrouillen: [], coverSpots: [], decks: null, kanten: {}, gelaende: null, meta: {} };
}
function szene(spieler, seed) {
  restore();
  const g = new Game({ noStore: true, seed: seed || 7, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const conns = [];
  for (let i = 0; i < spieler; i++) {
    const c = { inbox: [], send(m) { this.inbox.push(m); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'N' + i, name: 'N' + i, color: i });
    conns.push(c);
  }
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  W.AWAY_MAPS[LP] = { id: LP, karte: karte() };
  g.aways[LP] = away.makeLandepunkt(g, LP);
  g.setAwayMap(LP);
  away.executeBeam(g, g.players.map((p) => p.id), 'down');
  const aw = g.aways[LP];
  aw.drones.length = 0;
  const S = { g, conns, aw, stamps: [], gesehen: 0 };
  S.P = (i) => combat.kaempfer(g, g.players[i]);
  S.place = (i, tx, ty) => { const p = S.P(i); const c = Physics.tileCenter(tx, ty); p.x = c.x; p.y = c.y; p.input.mx = 0; p.input.my = 0; p.crouch = false; };
  S.run = (sek, each) => {
    for (let k = 0; k < Math.round(sek * 30); k++) {
      g.step();
      const inbox = conns[0].inbox;
      for (; S.gesehen < inbox.length; S.gesehen++) S.stamps.push({ t: g.time, m: inbox[S.gesehen] });
      if (each) each();
    }
  };
  S.ev = (kind) => S.stamps.filter((s) => s.m.kind === kind);
  S.gegner = (rolle, tx, ty, opts) => {
    const e = squad.makeEnemy(g, aw, squad.TYP_KIND[rolle] || 'scavenger', 'G' + g.nextId(''), Physics.tileCenter(tx, ty), (opts && opts.trupp) || 'test');
    e.rolle = rolle; e.asleep = false; e.frozen = !(opts && opts.frei);
    if (!aw.squads[e.squad]) aw.squads[e.squad] = squad.newSquad(e.squad, 1);
    aw.drones.push(e);
    combat.kaempfer(g, e);
    return e;
  };
  // Geschoss von (x, y) mit Winkel `ang` ohne Streuung, wie waffen.geschoss es anlegt (Sturmgewehr)
  S.geschoss = (x, y, ang, team) => {
    const d = AC.waffen.sturmgewehr;
    const t = Physics.toTile(x, y);
    const q = { id: 'tp' + g.nextId(''), stx: t.x, sty: t.y, sx: x, sy: y, checked: [], kind: 'sturmgewehr', waffe: 'sturmgewehr', x, y, angle: ang, speed: d.tempo,
      ttl: d.reichweite * TILE / d.tempo, dmg: d.schaden, owner: team === 'player' ? S.P(0).id : 'FEIND', team, seite: team === 'player' ? 'crew' : 'feind', crouch: false,
      wirkung: { waffe: 'sturmgewehr', schaden: d.schaden, schildReset: true } };
    aw.projectiles.push(q);
    return q;
  };
  return S;
}
const ende = () => { restore(); delete W.AWAY_MAPS[LP]; };
const C = (tx, ty) => Physics.tileCenter(tx, ty);
const seg = (k) => (k.seg != null ? k.seg : k.schild.seg);

console.log('\n[Konfig]');
{
  ok(NH && NH.knapp >= 1.5 * 12 && NH.knapp <= 28, 'niederhalten.knapp ' + NH.knapp + ' px (1,5 x Trefferradius bis 28)');
  ok(NH.dauer === 1.5 && NH.streuFaktor === 2 && NH.intervallFaktor === 1.5 && NH.eventPause === 0.25, 'Startwerte dauer 1,5 · streuFaktor 2 · intervallFaktor 1,5 · eventPause 0,25');
  ok(require('../shared/protocol.js').B2_EVENTS.includes('knapp'), 'knapp steht in B2_EVENTS');
}

console.log('\n[Spieler als Ziel: knapper Fehlschuss setzt Schildladen zurück, ohne Schaden]');
{
  const S = szene(1); const p = S.P(0); S.place(0, 10, ZEILE);
  const t0 = S.g.time;
  p.shield.seg = 2; p.shield.lastHitAt = t0; p.shield.regenT = 1.1;   // frisch getroffen: kein Nachladen vor Ankunft des Geschosses
  S.geschoss(C(15, ZEILE).x, p.y + 20, Math.PI, 'enemy');   // 20 px neben der Mitte: knapp (Trefferradius 12)
  S.run(1.2);
  ok(p.shield.seg === 2, 'kein Schaden (Schild bleibt 2)');
  ok(p.shield.lastHitAt > t0 + 0.1 && p.shield.regenT === 0, 'lastHitAt zurückgesetzt (' + p.shield.lastHitAt.toFixed(2) + ' > ' + t0.toFixed(2) + '), regenT 0');
  ok(p.nieder > t0, 'nieder gesetzt (bis ' + p.nieder.toFixed(2) + ')');
  const ev = S.ev('knapp');
  ok(ev.length === 1 && ev[0].m.id === p.id && Number.isFinite(ev[0].m.x) && Number.isFinite(ev[0].m.y) && ev[0].m.von === 'FEIND', 'genau ein Ereignis knapp { id, x, y, von } ' + JSON.stringify(ev[0] && ev[0].m));
  ok(Math.abs(ev[0].m.y - (p.y + 20)) < 3 && Math.abs(ev[0].m.x - p.x) < 25, 'Ereignisort liegt am Vorbeiflug (nahe dem Spieler)');
  ende();
}

console.log('\n[Schildladen läuft nach dem Fehlschuss erst nach regenDelay wieder an]');
{
  const S = szene(1); const p = S.P(0); S.place(0, 10, ZEILE);
  p.shield.seg = 1; p.shield.lastHitAt = -99; p.shield.regenT = 0;
  S.run(1.5);
  ok(p.shield.seg > 1, 'ohne Beschuss lädt der Schild (' + p.shield.seg + ')');
  p.shield.seg = 1; p.shield.regenT = 0;
  S.geschoss(C(15, ZEILE).x, p.y - 18, Math.PI, 'enemy');
  S.run(0.2);
  const t1 = S.g.time;
  S.run(1.5);
  ok(p.shield.seg === 1 && S.g.time - t1 < AC.shield.regenDelay, 'Schild lädt nach knappem Schuss nicht (regenDelay ' + AC.shield.regenDelay + ' s)');
  ende();
}

console.log('\n[Gegner als Ziel: gleiche Regel]');
{
  const S = szene(1); S.place(0, 30, ZEILE + 3);
  const e = S.gegner('grundtyp', 15, ZEILE);
  const t0 = S.g.time;
  e.seg = 2; e.lastHitAt = t0; e.regenT = 1.1;
  S.geschoss(C(9, ZEILE).x, e.y + 20, 0, 'player');
  S.run(1.2);
  ok(seg(e) === 2, 'kein Schaden (Schild bleibt 2)');
  ok(e.schild.lastHitAt > t0 + 0.1 && e.schild.regenT === 0, 'lastHitAt zurückgesetzt, regenT 0');
  ok(e.nieder > t0, 'nieder gesetzt');
  ok(S.ev('knapp').length === 0, 'kein Ereignis für Gegner als Ziel (nur Spieler brauchen die Rückmeldung)');
  ende();
}

console.log('\n[weit daneben, Treffer, höchstens einmal je Geschoss]');
{
  const S = szene(1); const p = S.P(0); S.place(0, 10, ZEILE);
  p.shield.seg = 2; p.shield.lastHitAt = S.g.time; const l0 = p.shield.lastHitAt;
  S.geschoss(C(15, ZEILE).x, p.y + 45, Math.PI, 'enemy');
  S.run(1.2);
  ok(p.shield.lastHitAt === l0 && !(p.nieder > 0) && S.ev('knapp').length === 0, 'weit daneben (45 px): kein Reset, kein Niederhalten, kein Ereignis');
  S.geschoss(C(15, ZEILE).x, p.y + 4, Math.PI, 'enemy');
  S.run(1.2);
  ok(p.shield.seg === 1.5 && p.shield.lastHitAt > l0 && S.ev('knapp').length === 0 && !(p.nieder > 0), 'Treffer: normaler Schaden (0,5), Reset durch Treffer, aber kein knapp');
  ende();
}
{
  // ein Geschoss, viele Teilschritte, mehrere Ziele nebeneinander: je Ziel höchstens einmal
  const S = szene(1); S.place(0, 30, ZEILE + 5);
  const e1 = S.gegner('grundtyp', 14, ZEILE), e2 = S.gegner('grundtyp', 18, ZEILE);
  let n1 = 0, n2 = 0;
  const w = Wf.knapp;
  const orig = Wf.knapp;
  Wf.knapp = (game, z, q, px, py) => { if (z === e1) n1++; if (z === e2) n2++; return orig(game, z, q, px, py); };
  S.geschoss(C(9, ZEILE).x, e1.y + 20, 0, 'player');
  S.run(1.5);
  Wf.knapp = orig;
  ok(n1 === 1 && n2 === 1, 'ein Geschoss: je Ziel genau ein Auslösen (Ziel 1: ' + n1 + ', Ziel 2: ' + n2 + ')');
  void w;
  ende();
}

console.log('\n[Ereignis-Rate: Salve ergibt höchstens ein Ereignis je 0,25 s und Ziel, Wirkung bleibt]');
{
  const S = szene(1); const p = S.P(0); S.place(0, 10, ZEILE);
  p.shield.seg = 3;
  for (let i = 0; i < 8; i++) S.geschoss(C(12 + Math.floor(i / 2), ZEILE).x, p.y + 16 + (i % 3) * 2, Math.PI, 'enemy');   // acht Geschosse gleichzeitig, verschiedene Entfernung
  S.run(1.0);
  const ev = S.ev('knapp');
  let minGap = 99; for (let i = 1; i < ev.length; i++) minGap = Math.min(minGap, ev[i].t - ev[i - 1].t);
  ok(ev.length >= 1 && ev.length <= 4 && minGap >= NH.eventPause - 1e-6, 'Salve: ' + ev.length + ' Ereignisse (kleinster Abstand ' + (ev.length > 1 ? minGap.toFixed(2) : '-') + ' s >= ' + NH.eventPause + ')');
  ok(p.shield.seg === 3, 'Salve ohne Treffer: kein Schaden');
  ende();
}

console.log('\n[Zustand niedergehalten: läuft ab, erneuert sich]');
{
  const S = szene(1); const p = S.P(0); S.place(0, 10, ZEILE);
  S.geschoss(C(15, ZEILE).x, p.y + 20, Math.PI, 'enemy');
  S.run(0.5);
  const bis1 = p.nieder;
  ok(Wf.niedergehalten(S.g, p) && Math.abs(bis1 - (S.g.time + NH.dauer)) < 0.6, 'niedergehalten direkt nach dem Beinahe-Treffer (bis ' + bis1.toFixed(2) + ')');
  S.run(0.8);
  ok(Wf.niedergehalten(S.g, p), 'nach 1,3 s noch niedergehalten');
  S.geschoss(C(15, ZEILE).x, p.y + 20, Math.PI, 'enemy');
  S.run(0.5);
  ok(p.nieder > bis1 + 0.5, 'zweiter knapper Schuss erneuert (bis ' + p.nieder.toFixed(2) + ')');
  S.run(NH.dauer + 0.2);
  ok(!Wf.niedergehalten(S.g, p), 'ohne weiteren Beschuss: nach ' + NH.dauer + ' s vorbei');
  ende();
}

console.log('\n[Streuung x Faktor für alle Schützen, Feuerintervall x Faktor nur für KI]');
{
  const S = szene(1); const p = S.P(0); S.place(0, 10, ZEILE);
  const e = S.gegner('niederhalter', 30, ZEILE);
  p.waffe = 'sturmgewehr'; p.hitze = 0; p.gesperrtBis = 0;
  const kad = AC.waffen.sturmgewehr.kadenz;
  const abw = (k, ziel, nieder) => {   // mittlere Abweichung des Geschosswinkels vom Zielwinkel über viele Schüsse
    let sum = 0; const N = 400;
    for (let i = 0; i < N; i++) {
      k.hitze = 0; k.gesperrtBis = 0; k.bereitAt = 0; k.nieder = nieder ? S.g.time + 99 : 0;
      const n0 = S.aw.projectiles.length;
      Wf.feuern(S.g, k, { x: ziel.x, y: ziel.y });
      const q = S.aw.projectiles[n0];
      sum += Math.abs(Physics.normAngle(q.angle - Math.atan2(ziel.y - k.y, ziel.x - k.x)));
      S.aw.projectiles.length = 0;
    }
    return sum / N;
  };
  const eo = abw(e, p, false), em = abw(e, p, true), po = abw(p, e, false), pm = abw(p, e, true);
  ok(em > eo * 1.7 && em < eo * 2.3, 'Gegner-Schütze: mittlere Abweichung ' + (eo * 180 / Math.PI).toFixed(2) + ' Grad -> ' + (em * 180 / Math.PI).toFixed(2) + ' Grad (x' + (em / eo).toFixed(2) + ')');
  ok(pm > po * 1.7 && pm < po * 2.3, 'Spieler als Schütze: ' + (po * 180 / Math.PI).toFixed(2) + ' Grad -> ' + (pm * 180 / Math.PI).toFixed(2) + ' Grad (gleiche Regel)');
  // Feuerintervall: bereitAt nach dem Schuss
  e.hitze = 0; e.gesperrtBis = 0; e.bereitAt = 0; e.nieder = 0; let t = S.g.time; Wf.feuern(S.g, e, { x: p.x, y: p.y });
  const iO = e.bereitAt - t;
  e.hitze = 0; e.bereitAt = 0; e.nieder = S.g.time + 9; Wf.feuern(S.g, e, { x: p.x, y: p.y });
  const iM = e.bereitAt - t;
  ok(Math.abs(iO - kad) < 1e-6 && Math.abs(iM - kad * NH.intervallFaktor) < 1e-6, 'KI-Feuerintervall ' + iO.toFixed(3) + ' s -> ' + iM.toFixed(3) + ' s (x' + NH.intervallFaktor + ')');
  p.hitze = 0; p.bereitAt = 0; p.nieder = S.g.time + 9; t = S.g.time; Wf.feuern(S.g, p, { x: e.x, y: e.y });
  ok(Math.abs((p.bereitAt - t) - kad) < 1e-6, 'Spieler: Feuerintervall bleibt ' + kad + ' s (keine KI-Einschränkung)');
  ende();
}

console.log('\n[Lanze (Strahl) löst kein Niederhalten aus]');
{
  const S = szene(1); const p = S.P(0); S.place(0, 6, ZEILE);
  const e1 = S.gegner('grundtyp', 20, ZEILE), e2 = S.gegner('grundtyp', 20, ZEILE + 1);
  p.waffe = 'lanze'; p.hitze = 0; p.gesperrtBis = 0; p.ladung = null;
  const t0 = S.g.time; away.shoot(S.g, p, 0);
  S.run(0.6, () => { if (Math.round((S.g.time - t0) * 30) % 8 === 0) away.shoot(S.g, p, 0); });
  away.shoot(S.g, p, 0, { los: true }); S.run(0.2);
  ok(S.ev('lanzeSchuss').length === 1, 'Lanze hat geschossen');
  ok(!(e2.nieder > 0), 'Nachbar neben dem Strahl: nicht niedergehalten');
  ende();
}

console.log('\n[KI: niedergehaltener Gegner bleibt, wo er ist, und plant keinen Vorstoß]');
{
  const lauf = (nieder) => {
    const S = szene(1); const p = S.P(0); S.place(0, 6, ZEILE);
    const e = S.gegner('grundtyp', 40, ZEILE, { trupp: 'k', frei: true });
    e.role = 'pin';   // steht auf seinem Platz (idle würde erst bis zum ersten decide umherwandern)
    if (nieder) e.nieder = S.g.time + 1.5;
    const s = S.aw.squads.k; s.alert = true; s.contactAt = S.g.time;
    s.lastKnown = s.lastKnown || {}; s.lastKnown[p.id] = { x: p.x + 8 * TILE, y: p.y, t: S.g.time, pid: p.id };   // Spur: Gegner würde vorrücken
    const x0 = e.x, y0 = e.y; let weg = 0;
    S.run(4, () => {
      e.role = 'pin';   // steht auf seinem Platz (idle würde erst bis zum ersten decide umherwandern)
    if (nieder) e.nieder = S.g.time + 1.5;
      p.shield.seg = 3; if (p.downed) combat.revive(S.g, p, 3, { quiet: true });
      weg = Math.max(weg, Math.hypot(e.x - x0, e.y - y0));
    });
    const r = { weg, role: e.role }; ende(); return r;
  };
  const frei = lauf(false), still = lauf(true);
  ok(frei.weg > 2 * TILE, 'Kontrolle (ohne Niederhalten): Gegner rückt vor (' + frei.weg.toFixed(0) + ' px, Rolle ' + frei.role + ')');
  ok(still.weg < 3, 'niedergehalten: bleibt stehen (' + still.weg.toFixed(1) + ' px in 4 s)');
}

console.log('\n[Wirkung: niedergehaltener Gegner-Schütze trifft messbar seltener]');
{
  const messung = (nieder, seed, N) => {
    const S = szene(1, seed); const p = S.P(0); S.place(0, 10, ZEILE);
    const e = S.gegner('niederhalter', 18, ZEILE);   // Sturmgewehr, 8 Kacheln Abstand
    let treffer = 0, schuesse = 0;
    for (let i = 0; i < N; i++) {
      e.hitze = 0; e.gesperrtBis = 0; e.bereitAt = 0; e.nieder = nieder ? S.g.time + 99 : 0; e.zustand = 'ok';
      const r = Wf.feuern(S.g, e, { x: p.x, y: p.y });
      if (r === null) schuesse++;
      p.shield.seg = 3; p.shield.lastHitAt = S.g.time; p.zustand = 'ok'; p.downed = false;
      S.run(0.04, () => { if (p.shield.seg < 3) { treffer++; p.shield.seg = 3; } p.zustand = 'ok'; p.downed = false; p.nieder = 0; });
      if (i % 20 === 19) S.run(0.7, () => { if (p.shield.seg < 3) { treffer++; p.shield.seg = 3; } p.nieder = 0; });
    }
    S.run(1.0, () => { if (p.shield.seg < 3) { treffer++; p.shield.seg = 3; } p.nieder = 0; });
    ende();
    return { treffer, schuesse };
  };
  const N = 400; const seeds = [11, 12, 13];
  let sumO = 0, sumM = 0, sch = 0;
  for (const sd of seeds) { const o = messung(false, sd, N), m = messung(true, sd, N); sumO += o.treffer; sumM += m.treffer; sch += o.schuesse; console.log('       Seed ' + sd + ': ohne ' + o.treffer + '/' + o.schuesse + ' · mit ' + m.treffer + '/' + m.schuesse); }
  const qo = sumO / sch, qm = sumM / sch;
  console.log('       WIRKUNG gesamt: ohne Niederhalten ' + sumO + ' Treffer / ' + sch + ' Schüsse (' + (qo * 100).toFixed(1) + ' %) · mit Niederhalten ' + sumM + ' Treffer / ' + sch + ' Schüsse (' + (qm * 100).toFixed(1) + ' %)');
  ok(sumO > 100, 'ohne Niederhalten trifft der Schütze regelmäßig (' + sumO + ')');
  ok(sumM < sumO * 0.8, 'mit Niederhalten messbar seltener: ' + sumM + ' < 0,8 x ' + sumO);
}

console.log('\n[Mehrspieler: nur der Beschossene bekommt das Ereignis, der Nachbar bleibt unberührt]');
{
  const S = szene(2); const p0 = S.P(0), p1 = S.P(1); S.place(0, 10, ZEILE); S.place(1, 10, ZEILE + 6);
  p1.shield.lastHitAt = -99;
  S.geschoss(C(15, ZEILE).x, p0.y + 20, Math.PI, 'enemy');
  S.run(1.0);
  const ev = S.ev('knapp');
  ok(ev.length === 1 && ev[0].m.id === p0.id, 'Ereignis trägt die ID des Beschossenen (Client filtert danach)');
  ok(p1.shield.lastHitAt === -99 && !(p1.nieder > 0), 'Mitspieler 6 Kacheln weiter: nicht betroffen');
  ende();
}

console.log(`\ntest-niederhalten: ${n - fails}/${n} Prüfungen bestanden${fails ? ', ' + fails + ' FEHLER' : ''}`);
process.exit(fails ? 1 : 0);
