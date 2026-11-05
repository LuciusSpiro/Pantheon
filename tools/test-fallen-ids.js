'use strict';
// ITM-01 G (S2): Anker-Ids verborgener Fallen verraten weder Raum noch weitere Fallen. Geprüft: shared/buehne.js ankerIdsVergeben (rein), echte Kompilierung einer Ruine mit Fallen-Ankern
// (Testmodule im Speicher, nie auf Platte), Bestandskarten ohne Fallen (Ids wie vorher), Payload (awayMap) und Scan Stufe 1 (aw.sc im Snapshot) im echten Spiel.
//   node tools/test-fallen-ids.js   (npm run test:fallen-ids)
const Buehne = require('../shared/buehne.js');
const { Game } = require('../server/game.js');
const interior = require('../server/sim/interior.js');
const combat = require('../server/sim/combat.js');
const Scanbar = require('../server/sim/scanbar.js');
const Anker = require('../server/sim/anker.js');
const L = require('../server/sim/landepunkte.js');
const W = require('../server/world.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const NEUTRAL = /^falle\.[0-9a-z]{7}$/;

section('ankerIdsVergeben (rein)');
{
  const A = (platz, x, y, sicht, rolle) => ({ platz, rolle: rolle || 'falle', x, y, sicht });
  const ids = Buehne.ankerIdsVergeben;
  const roh = [A('halle', 1, 2, 'verborgen'), A('halle', 4, 2, 'passiv'), A('halle', 6, 2), A('turm', 3, 3, 'verborgen'), A('turm', 5, 3, 'verborgen'), A('turm', 1, 1, null, 'terminal')];
  const r = ids(roh);
  ok(r.length === roh.length && new Set(r).size === r.length, 'je Anker eine Id, alle verschieden');
  ok([0, 2, 3, 4].every((i) => NEUTRAL.test(r[i])), 'verborgene Fallen (sicht verborgen und ohne sicht): neutrale Id falle.<7 Zeichen>');
  ok(r[1] === 'halle.falle', 'die einzige sichtbare Falle des Platzes heißt halle.falle, ohne Nummer (ein verborgenes Geschwister zählt nicht mit)');
  ok(r[5] === 'turm.terminal', 'andere Rollen unverändert (<platz>.<rolle>)');
  ok(!r.some((id) => NEUTRAL.test(id) && (id.includes('halle') || id.includes('turm') || /\.\d$/.test(id))), 'neutrale Ids enthalten weder Platz noch Nummer');
  ok(JSON.stringify(ids(roh)) === JSON.stringify(r), 'bestimmt: gleiche Eingabe, gleiche Ids');
  const ohne = ids(roh.filter((a, i) => i !== 0 && i !== 4));
  ok(ohne[1] === r[2] && ohne[2] === r[3], 'die Id einer Falle hängt nicht von ihren Geschwistern ab (Fallen entfernt: Rest behält die Ids)');
  const zwei = ids([A('halle', 1, 2, 'passiv'), A('halle', 4, 2, 'passiv'), A('halle', 6, 2, 'verborgen')]);
  ok(zwei[0] === 'halle.falle.1' && zwei[1] === 'halle.falle.2' && NEUTRAL.test(zwei[2]), 'mehrere sichtbare Fallen zählen untereinander (.1, .2), die verborgene fehlt in der Zählung');
  const doppelt = ids([A('p', 1, 1, 'verborgen'), A('p', 1, 1, 'verborgen')]);
  ok(NEUTRAL.test(doppelt[0]) && NEUTRAL.test(doppelt[1]) && doppelt[0] !== doppelt[1], 'Kollision (gleicher Hash): Salz sorgt für verschiedene Ids');
  const alt = (list) => { const z = {}, l = {}; for (const a of list) z[a.platz + '.' + a.rolle] = (z[a.platz + '.' + a.rolle] || 0) + 1; return list.map((a) => { const k = a.platz + '.' + a.rolle; l[k] = (l[k] || 0) + 1; return z[k] > 1 ? k + '.' + l[k] : k; }); };
  const ohneFallen = [A('a', 1, 1, null, 'terminal'), A('a', 2, 1, null, 'wache'), A('a', 3, 1, null, 'wache'), A('b', 1, 1, null, 'eingang')];
  ok(JSON.stringify(ids(ohneFallen)) === JSON.stringify(alt(ohneFallen)), 'Listen ohne Fallen: dieselben Ids wie die bisherige Zählung (Karten und Hashes ändern sich nicht)');
}

section('Echte Kompilierung (Ruine mit Testmodulen, Fallen-Anker im Speicher)');
// Alle Ruinenmodule bekommen bis zu drei Fallen-Anker (zwei verborgen, eine sichtbar) auf freien Kacheln; so liegen mehrere Fallen je Platz
function datenMitFallen() {
  const D = JSON.parse(JSON.stringify(Buehne.daten()));
  for (const m of Object.values(D.module)) {
    if (m.art !== 'ruine') continue;
    const an = m.anker.map((r) => r.split(''));
    m.anker_legende = Object.assign({}, m.anker_legende, { F: { rolle: 'falle', typ: 'druck', sicht: 'verborgen' }, G: { rolle: 'falle', typ: 'schuss', sicht: 'verborgen' }, H: { rolle: 'falle', typ: 'druck', sicht: 'passiv' } });
    const zeichen = ['F', 'G', 'H']; let k = 0;
    for (let y = 1; y < m.rows.length - 1 && k < 3; y++) for (let x = 1; x < m.rows[y].length - 3 && k < 3; x++) {
      if (m.rows[y][x] === '.' && an[y][x] === '.' && an[y][x + 1] === '.') { an[y][x] = zeichen[k++]; x += 2; }
    }
    m.anker = an.map((r) => r.join(''));
  }
  return D;
}
const D2 = datenMitFallen();
{
  const k = Buehne.bauen({ daten: D2, art: 'ruine', seed: 5 });
  const fallen = k.anker.filter((a) => a.rolle === 'falle');
  const verb = fallen.filter((a) => a.sicht !== 'passiv'), sicht = fallen.filter((a) => a.sicht === 'passiv');
  ok(verb.length >= 8 && sicht.length >= 4, 'Kompilierung liefert verborgene (' + verb.length + ') und sichtbare (' + sicht.length + ') Fallen auf mehreren Plätzen');
  const plaetze = new Set(k.anker.map((a) => a.platz));
  ok(verb.every((a) => NEUTRAL.test(a.id)) && verb.every((a) => ![...plaetze].some((p) => a.id.includes(p))), 'verborgene Fallen: neutrale Id ohne Platzname (' + verb.slice(0, 2).map((a) => a.id).join(', ') + ' …)');
  ok(sicht.every((a) => a.id === a.platz + '.falle'), 'sichtbare Fallen: <platz>.falle ohne Nummer, obwohl derselbe Platz verborgene Geschwister hat');
  ok(new Set(k.anker.map((a) => a.id)).size === k.anker.length, 'alle Ankerids der Karte eindeutig');
  const k2 = Buehne.bauen({ daten: D2, art: 'ruine', seed: 5 });
  ok(JSON.stringify(k2.anker.map((a) => a.id)) === JSON.stringify(k.anker.map((a) => a.id)), 'bestimmt: zweiter Bau, dieselben Ids');
}
{
  let gleich = 0, gesamt = 0;
  for (const art of ['ruine', 'station', 'aussenposten']) for (const seed of [1, 2, 3]) {
    let k; try { k = Buehne.bauen({ art, seed }); } catch (e) { continue; }
    if (!k || !k.anker) continue;
    gesamt++;
    const z = {}, l = {}; for (const a of k.anker) z[a.platz + '.' + a.rolle] = (z[a.platz + '.' + a.rolle] || 0) + 1;
    const erwartet = k.anker.map((a) => { const key = a.platz + '.' + a.rolle; l[key] = (l[key] || 0) + 1; return z[key] > 1 ? key + '.' + l[key] : key; });
    if (JSON.stringify(erwartet) === JSON.stringify(k.anker.map((a) => a.id))) gleich++;
  }
  ok(gesamt >= 3 && gleich === gesamt, 'Bestandskarten ohne Fallen (' + gesamt + ' gebaut): Ids exakt wie die bisherige Zählung (' + gleich + ')');
}

section('Spiel: Payload und Scan Stufe 1 verraten nichts');
{
  const bauen0 = Buehne.bauen;
  Buehne.bauen = function (o) { return bauen0.call(this, Object.assign({}, o, { daten: D2 })); };
  try {
    const g = new Game({ noStore: true, seed: 11, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
    const c = { inbox: [], send(o) { this.inbox.push(o); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'F0', name: 'Id0', color: 0 }); g.handleMessage(c, { t: 'ready', ready: true });
    for (let i = 0; i < 6; i++) g.step();
    const id = L.neu(g, g.ship.scene, { art: 'ruine' });
    const aw = L.get(g, id); g.setAwayMap(id); aw.active = true;
    const p = g.players[0]; interior.placeOnAwayPad(g, p, 0); combat.onArrive(g, p);
    g.god = true;
    const k = W.AWAY_MAPS[id].karte;
    const lauf = () => { for (let i = 0; i < 4; i++) { g.away.drones.length = 0; g.step(); } };
    lauf();
    const verb = k.anker.filter((a) => a.rolle === 'falle' && a.sicht !== 'passiv');
    const plaetze = [...new Set(k.anker.map((a) => a.platz))];
    const mapEv = c.inbox.filter((e) => e.t === 'event' && e.kind === 'awayMap').pop();
    const payIds = mapEv ? mapEv.anker.map((a) => a[0]) : [];
    ok(mapEv && verb.length >= 3 && !payIds.some((x) => verb.some((v) => v.id === x)), 'awayMap-Payload enthält keine verborgene Falle (' + verb.length + ' verborgene auf der Karte)');
    ok(payIds.filter((x) => /\.falle(\.|$)/.test(x)).every((x) => !/\.falle\.\d+$/.test(x)), 'Payload: sichtbare Fallen ohne Nummer (kein Hinweis auf verborgene Geschwister)');
    // Scan Stufe 1 an der Position einer verborgenen Falle: sc-Eintrag mit der Id, ohne Ort
    const v0 = verb[0], platz0 = v0.platz;
    p.x = v0.x * 32 + 16; p.y = v0.y * 32 + 16 + 40; p.input.mx = 0; p.input.my = 0;
    const e = Scanbar.debugScanfertig(g, p, 1);
    const sc = (g.snapshot().away || {}).sc || [];
    const fs = sc.filter((s) => s[1] === 'falle');
    ok(e === null && fs.length >= 1, 'Scan Stufe 1: Fallen im sc-Snapshot (' + fs.length + ')');
    ok(fs.every((s) => NEUTRAL.test(s[0]) || /\.falle$/.test(s[0])), 'sc-Ids: neutral (verborgen) bzw. <platz>.falle (sichtbar)');
    const verbSc = fs.filter((s) => verb.some((v) => v.id === s[0]));
    ok(verbSc.length >= 1 && verbSc.every((s) => s.length === 4 && !plaetze.some((pl) => s[0].includes(pl)) && !/\.\d+$/.test(s[0])), 'sc-Einträge verborgener Fallen: kein Ort (Stufe 1), kein Platzname, keine Nachbarnummer in der Id');
    ok(JSON.stringify(verbSc).indexOf(platz0) < 0, 'der Platzname der gescannten Falle (' + platz0 + ') taucht im sc nicht auf');
    // Enthüllen: ankerEnthuellt trägt dieselbe neutrale Id
    Anker.setzen(g, id, v0.id, 'erkannt', p.id);
    lauf();
    const ev = c.inbox.filter((m) => m.t === 'event' && m.kind === 'ankerEnthuellt');
    ok(ev.length >= 1 && ev.every((m) => NEUTRAL.test(m.anker[0])) && JSON.stringify(ev).indexOf(platz0 + '.') < 0, 'ankerEnthuellt: neutrale Id, kein Platzname');
  } finally { Buehne.bauen = bauen0; }
}

console.log(fails ? '\n' + fails + ' FEHLER (' + n + ' Prüfungen)' : '\nalles ok (' + n + ' Prüfungen)');
process.exit(fails ? 1 : 0);
