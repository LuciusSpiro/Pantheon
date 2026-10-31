'use strict';
// BOD-02 P8/P9: Verteidigungsprofil im Grabenangriff (server/sim/verteidigung.js, CONFIG.awayCombat.verteidigung, Einhängestellen in squad.js/trupp.js).
//   P8  Halten: nach dem Alarm stehen >= 80 % der lebenden Welle 1 in Stellungen am Graben (Stellung.istIn), solange kein Rückzug ausgelöst ist
//       Rückzug: Hälfte der Linie gefallen ODER Linie umgangen; Funkspruch 'half' löst echtes Verhalten aus; Überlebende landen auf Plätzen der Linie 2
//       (Wald, Welle 2), kämpfen dort mit, endgültig (keine Rückkehr), höchstens rueckzugMax s; Trupps OHNE Profil unverändert (nur Text wie bisher)
//   node tools/test-verteidigen.js
const CONFIG = require('../shared/config.js');
const Physics = require('../shared/physics.js');
const { Game } = require('../server/game.js');
const combat = require('../server/sim/combat.js');
const squad = require('../server/sim/squad.js');
const Wellen = require('../server/sim/wellen.js');
const Stellung = require('../server/sim/stellung.js');
const Vert = require('../server/sim/verteidigung.js');
const W = require('../server/world.js');

let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); };
const section = (t, fn) => { console.log('\n[' + t + ']'); try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); } };
const TILE = Physics.TILE;
const AC = CONFIG.awayCombat;
const tile = (o) => Physics.toTile(o.x, o.y);

function spiel(np, seed) {
  const g = new Game({ noStore: true, seed: seed || 11, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < np; i++) { const c = { inbox: [], send(m) { if (this.inbox.length < 50) this.inbox.push(m); } }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'V' + i, name: 'V' + i, color: i }); cs.push(c); }
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: 'arena_graben' });
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  const S = g.arena.wellen; const aw = g.aways[S.lp];
  const r = { g, cs, S, aw, K: W.AWAY_MAPS[S.lp].karte, barks: [], ereignisse: [] };
  const emit = g.emit;
  g.emit = function (t, d) { if (t === 'bark') r.barks.push(Object.assign({ t: g.time }, d)); if (t === 'verteidigungRueckzug') r.ereignisse.push(d); return emit.apply(this, arguments); };
  for (const p of g.players) if (p.shield) p.shield.seg = 3;
  return r;
}
const lauf = (r, sek, fn) => {
  const k = Math.round(sek * CONFIG.tickHz);
  for (let i = 0; i < k; i++) { for (const p of r.g.players) { if (p.shield) p.shield.seg = 3; if (p.downed && !r.lassLiegen) combat.revive(r.g, p, 3, { quiet: true }); } r.g.step(); if (fn && i % 5 === 0) fn(r); }
};
const stell = (r, x, y) => { const c = Physics.tileCenter(x, y); const p = r.g.players[0]; p.x = c.x; p.y = c.y; };
const platz = (p, x, y) => { const c = Physics.tileCenter(x, y); p.x = c.x; p.y = c.y; };
const alarm = (r) => { for (const s of Object.values(r.aw.squads)) { s.schleich = false; squad.alertSquad(r.g, r.aw, s); } for (const e of r.aw.drones) e.patrouilliert = false; };
const w1 = (r) => r.aw.drones.filter((e) => e.alive && e.tag === Wellen.TAG && (r.S.ids[1] || []).includes(e.id));
const V = (r) => { const s = Object.values(r.aw.squads).find((q) => q && q.verteidigung); return s && s.verteidigung; };
const inSt = (r, e) => Stellung.inStellung(r.g, e);
const toeten = (r, es) => { for (const e of es) { for (let i = 0; i < 12 && e.alive; i++) combat.hitEnemy(r.g, e, 99, { x: e.x - 40, y: e.y }); e.liegt = false; e.zustand = 'tot'; } };   // tot: keiner richtet ihn wieder auf (P10 ist nicht Thema)
const barks = (r, key) => r.barks.filter((b) => b.cause === key);
const raus = (r) => { for (const p of r.g.players) platz(p, 22, 17 + r.g.players.indexOf(p)); };   // alle Spieler auf der Wiese vor dem Graben

section('Profil: Welle 1 hat es, Welle 2 und fremde Trupps nicht', () => {
  const r = spiel(3);
  const v = V(r);
  ok(!!v && v.modus === 'halten' && v.linie === 1, 'Welle 1: s.verteidigung { linie 1, modus halten }');
  ok(v.squads.length === 2 && v.squads.every((nm) => /^graben\.w1\./.test(nm)), 'Profil gehört den beiden Trupps der Welle 1 (' + v.squads.join(',') + ')');
  ok(Object.values(r.aw.squads).filter((s) => s && /^graben\.w2\./.test(s.name)).every((s) => !s.verteidigung), 'Welle 2: kein Profil');
  ok(v.initial === 6 && w1(r).length === 6, 'Linie 6 Mann bei Crew 3 (' + v.initial + ')');
  ok(v.halten.length > 30 && v.halten.every((t) => Stellung.istIn(r.K, t.x, t.y)), 'Haltelinie = Stellungsplätze (' + v.halten.length + ')');
  ok(v.linie2Anker.length === AC.verteidigung.rueckzugAnker && v.linie2Anker.every((a) => r.K.meta.gruppen['w2.wald'].some((id) => { const k = r.K.anker.find((q) => q.id === id); return k.x === a.x && k.y === a.y; })), 'Linie 2 = nächste Anker der Welle 2 (Wald)');
  ok(Vert.cfgVon(r.g).rueckzugAnteil === 0.5 && Vert.cfgVon(r.g).rueckzugMax === 15, 'Config awayCombat.verteidigung (Rückzug bei Hälfte, max. 15 s)');
});

section('P8 Halten: >= 80 % der lebenden Welle 1 stehen nach dem Alarm in Stellungen', () => {
  for (const np of [1, 2, 3]) {
    const r = spiel(np, 5 + np);
    raus(r); alarm(r);
    let drin = 0, alle = 0, min = 1, rz = false;
    lauf(r, 40, (q) => { const l = w1(q); if (!l.length) return; if (V(q).modus !== 'halten') { rz = true; return; } const d = l.filter((e) => inSt(q, e)).length; drin += d; alle += l.length; min = Math.min(min, d / l.length); });
    ok(!rz && alle > 0 && drin / alle >= 0.8, `Crew ${np}: ${(100 * drin / alle).toFixed(0)} % in Stellungen (schlechtestes Sample ${(100 * min).toFixed(0)} %), kein Rückzug`);
    ok(w1(r).every((e) => tile(e).x <= 31), `Crew ${np}: keiner steht östlich/auf der Wiese außerhalb der Linie (kein Verfolgen)`);
  }
  // Ohne Profil (Trupps ohne Verteidigungsprofil, wie heute): die Verteidiger verlassen den Graben
  const r = spiel(3, 9);
  for (const s of Object.values(r.aw.squads)) delete s.verteidigung;
  raus(r); alarm(r);
  lauf(r, 40);
  const l = w1(r), d = l.filter((e) => inSt(r, e)).length;
  ok(d / l.length < 0.8, `ohne Profil unverändert: Verteidiger rücken aus (${d}/${l.length} in Stellung)`);
});

section('P8 Rückzug: Hälfte der Linie gefallen -> echter Rückzug auf Linie 2, Funkspruch gekoppelt', () => {
  const r = spiel(3, 12);
  raus(r); alarm(r); lauf(r, 6);
  const l = w1(r);
  toeten(r, l.slice(0, 2));
  ok(V(r).modus === 'halten', 'zwei von sechs gefallen: Linie hält');
  ok(barks(r, 'half').length === 0, 'noch kein Rückzugs-Funkspruch');
  toeten(r, l.slice(2, 3));
  ok(V(r).modus === 'rueckzug' && V(r).grund === 'verluste', 'Hälfte gefallen: Rückzug ausgelöst (Grund verluste)');
  ok(barks(r, 'half').length === 1 && /Rückzug|Hälfte|zurück/i.test(barks(r, 'half')[0].text), 'Funkspruch „Rückzug zur zweiten Linie“ genau einmal, zusammen mit dem Rückzug');
  ok(r.aw.truppStats.rueckzug === 1 && r.ereignisse.length === 1, 'Zähler aw.truppStats.rueckzug = 1, Ereignis verteidigungRueckzug');
  const ueb = w1(r).map((e) => e.id);
  const ziele = V(r).rueckzug;
  ok(ziele.length >= 3 && ziele.every((t) => t.x >= 40), 'Plätze der Linie 2: Wald (' + ziele.length + ' Plätze, Anker + Deckung)');
  let max = 0;
  lauf(r, 40, (q) => { max = Math.max(max, V(q).modus === 'rueckzug' ? q.g.time : 0); });
  ok(V(r).modus === 'linie2', 'Rückzug endet (Ankunft oder ' + AC.verteidigung.rueckzugMax + ' s) -> Linie 2 gilt endgültig');
  const live = w1(r);
  ok(live.length === ueb.length && live.length === 3, 'alle Überlebenden leben noch (3)');
  // Zielplatz = Platz der Linie 2 (e.home, vom Rückzug gesetzt); wer ruhig steht, wandert höchstens ±2 Kacheln um ihn
  const nahe = (e, d) => V(r).rueckzug.some((t) => Math.max(Math.abs(t.x - tile(e).x), Math.abs(t.y - tile(e).y)) <= d);
  ok(live.every((e) => nahe(e, 3) && V(r).rueckzug.some((t) => Physics.tileCenter(t.x, t.y).x === e.home.x && Physics.tileCenter(t.x, t.y).y === e.home.y)), 'Überlebende stehen bei ihrem Platz der Linie 2 (' + live.map((e) => tile(e).x + ',' + tile(e).y).join(' ') + ')');
  ok(live.every((e) => !inSt(r, e)), 'keiner mehr in Linie 1 (Graben)');
  lauf(r, 20);
  ok(V(r).modus === 'linie2' && w1(r).every((e) => !inSt(r, e) && tile(e).x >= 38), 'keine Rückkehr zu Linie 1 (nach weiteren 20 s)');
  ok(barks(r, 'half').length === 1, 'kein zweiter Rückzugs-Funkspruch');
});

section('P8 Rückzug: Überlebende kämpfen auf Linie 2 mit (schießen bei Sicht)', () => {
  const r = spiel(1, 13);
  alarm(r);
  const l = w1(r); toeten(r, l.slice(0, 2));   // Crew 1: 3 Mann, zwei gefallen -> 1 lebt (<= Hälfte)
  ok(V(r).modus === 'rueckzug', 'Crew 1: bei <= Hälfte Rückzug');
  lauf(r, 22);
  const e = w1(r)[0];
  ok(!!e && V(r).modus === 'linie2', 'Überlebender erreicht Linie 2');
  // Spieler tritt in die Sicht: er wird beschossen (Ziel gesetzt, Schüsse/Ankündigung)
  platz(r.g.players[0], tile(e).x - 6, tile(e).y);
  let gezielt = 0, beschossen = false;
  const hp0 = () => r.g.players[0].shield ? r.g.players[0].shield.seg : 0;
  const on = r.g.emit; r.g.emit = function (t, d) { if (t === 'enemyAim' && d.id === e.id) gezielt++; return on.apply(this, arguments); };
  lauf(r, 8, () => { if (e.shootTarget === r.g.players[0].id) beschossen = true; });
  ok(beschossen && gezielt > 0, 'Linie 2 kämpft mit: Ziel gewählt (' + gezielt + ' Ankündigungen)');
});

section('P8 Rückzug: Linie umgangen (Spieler östlich der Linie / Flankenschutz + Stellung)', () => {
  const r = spiel(3, 14);
  raus(r); alarm(r); lauf(r, 4);
  platz(r.g.players[1], 34, 17);   // hinter der Linie (östlich der Grabensohle)
  lauf(r, 1);
  ok(V(r).modus === 'halten', 'Umgehung kurz (< umgehungSek): noch kein Rückzug');
  lauf(r, 3);
  ok(V(r).modus === 'rueckzug' && V(r).grund === 'umgangen', 'Spieler steht hinter der Linie: Rückzug (Grund umgangen)');
  ok(barks(r, 'half').length === 1 && w1(r).length === 6, 'Funkspruch, alle 6 leben');
  lauf(r, 40);
  ok(V(r).modus === 'linie2' && w1(r).every((e) => !inSt(r, e)), 'alle 6 auf Linie 2, keiner im Graben');
  // Flankenschutz meldet Umgehung + Spieler in der Stellung -> Rückzug
  const q = spiel(3, 15);
  raus(q); alarm(q); lauf(q, 3);
  const s = q.aw.squads['graben.w1.graben'];
  s.bedrohung = { pid: q.g.players[0].id, x: 0, y: 0, t: q.g.time, bis: q.g.time + 30 };
  platz(q.g.players[0], 25, 17);   // Spieler im Graben
  lauf(q, 0.4);
  ok(V(q).modus === 'halten', 'Flankenmeldung + Spieler in der Stellung: erst nach umgehungSek');
  s.bedrohung.bis = q.g.time + 30; lauf(q, 2.5);
  ok(V(q).modus === 'rueckzug' && V(q).grund === 'umgangen', 'Flankenschutz meldet Umgehung und der Spieler steht in der Stellung: Rückzug');
  const u = spiel(3, 16);
  raus(u); alarm(u); lauf(u, 2);
  const su = u.aw.squads['graben.w1.graben'];
  su.bedrohung = { pid: u.g.players[0].id, x: 0, y: 0, t: u.g.time, bis: u.g.time + 30 };
  lauf(u, 5);
  ok(V(u).modus === 'halten', 'Flankenmeldung ohne Spieler in der Stellung: kein Rückzug');
});

section('P8 Funkspruch ohne Profil bleibt Text (Trupps ohne Verteidigungsprofil unverändert)', () => {
  const r = spiel(3, 17);
  for (const s of Object.values(r.aw.squads)) delete s.verteidigung;
  raus(r); alarm(r); lauf(r, 3);
  const l = w1(r);
  toeten(r, l.slice(0, 3));
  ok(barks(r, 'half').length >= 1 || r.aw.squads['graben.w1.graben'].halfBarked || r.aw.squads['graben.w1.posten'].halfBarked, 'Hälfte des Trupps gefallen: Funkspruch wie bisher');
  lauf(r, 3);
  ok(!r.ereignisse.length && !(r.aw.truppStats && r.aw.truppStats.rueckzug), 'ohne Profil kein Rückzug (nur Text)');
});

console.log('\n' + (fails ? 'VERFEHLT: ' + fails + ' von ' + n : 'alle ' + n + ' Prüfungen grün'));
process.exit(fails ? 1 : 0);
