'use strict';
// SL11: die Sund-Kette "Die Schuld der Lerche" per Bot (GenericAgent aus sim-headless.js).
//   node tools/sim-sund.js [--weg loesegeld|soeldner|beide] [--crew 1|3] [--seed S] [--kapitel alle|k4_gestrandet] [--von k4_gestrandet] [--verbose]
// Läufe: ganze Kette ab Kapitel 1 (Lobby-Modus schuld_der_lerche) bzw. Labor-Einstieg je Kapitel (--kapitel alle, stoppt nach dem Kapitel).
const Sim = require('./sim-headless.js');
const Kampagne = require('../server/mission/kampagne.js');
const args = process.argv.slice(2);
const argVal = (k, d) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
const log = (...a) => console.log(...a);
const TRACE = args.includes('--trace');

const stepHook = (a, S, p, info) => {
  const fn = HOOKS[info.m.activeId + '/' + info.step.id];
  return fn ? fn(a, S, p, info) : fallback(a, S, p, info);
};
const BEKANNT = /^notruf-tor: Verborgene Kante/;
const Away = require('../server/sim/away.js');
const Lpscan = require('../server/sim/lpscan.js');
const Locations = require('../shared/locations.js');
const Fracht = require('../server/sim/fracht.js');
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const tileOf = (v) => Math.floor(v / 32);

// Schritt-Handler der Kette (opts.stepHook): true = der Schritt ist behandelt. Je Kapitel/Schritt eine kleine Funktion; alles, was hier fehlt,
// läuft über die allgemeinen Bot-Pfade (Anflug, Kampf, Ops-Pfade entschlBot/spurBot/personenBot ...).
const HOOKS = {
  // Kap. 1: am Boden mit Evert sprechen, "annehmen"
  'k1_kantenstein/aussenposten'(a, S, p) {
    if (p.zone !== 'away') return false;
    if (!a.is('captain')) { a.input(0, 0); return true; }
    return a.sundGespraech(S, p, 'evert', 'annehmen');
  },
  'k1_kantenstein/aufbruch'(a, S, p) { a.input(0, 0); return true; },
  // Kap. 2: alle hoch, Ops scannt den Landepunkt, personenBot beamt Evert (Fracht), Reise ohne Besonderheiten
  'k2_ueberfahrt/einladen'(a, S, p) {
    if (p.zone === 'away') { a.padsUp(S, p); return true; }
    const g = a.game;
    if (a.is('helm') && S.ship.scene === 'kantenstein') { /* Bahn: Orbit halten, ggf. näher an den Landepunkt */ }
    if (a.is('weapons') && !Lpscan.gescannt(g, 'kantenstein.siedlung') && !g.lpscan) {
      if (a.enter(S, 'weapons')) a.cmd('weapons.landescan');
      return true;
    }
    a.idleStations(S, p); return true;
  },
  // Kap. 2 Ende: am Handelsposten von Pulverhorn an die Station, Ops gibt Evert ab
  'k2_ueberfahrt/abgabe'(a, S, p) {
    if (p.zone === 'away') { a.padsUp(S, p); return true; }
    if (S.ship.scene !== 'pulverhorn') { a.approach(S, p, 'pulverhorn'); return true; }
    const st = a.station(S); const sh = S.ship;
    if (a.is('helm') && st) { if (a.enter(S, 'helm')) { if (dist(sh.x, sh.y, st.x, st.y) > 150) a.steer(S, st.x, st.y, 60); else a.brake(S); } if (!a.is('weapons')) return true; }
    if (a.is('weapons') && sh.speed < 15 && dist(sh.x, sh.y, st.x, st.y) < 200 && (S.fracht && (S.fracht.pers || []).length) && !S.fracht.halt) { if (a.enter(S, 'weapons')) a.cmd('weapons.person_ab'); return true; }
    if (!a.is('helm')) a.idleStations(S, p);
    return true;
  },
  // Kap. 3: Notfallsprung (Helm) – Gegenwehr hat die Lerche gegen Kreuzer + Korvetten + Jäger nicht
  'k3_falle/falle'(a, S, p) {
    if (p.zone === 'away') { a.padsUp(S, p); return true; }
    if (a.is('helm')) { if (a.enter(S, 'helm') && S.time - (a.memo.falleT0 || (a.memo.falleT0 = S.time)) > 8) a.cmd('helm.notsprung'); return true; }
    a.idleStations(S, p); return true;
  },
  // Kap. 7a Gasfeld: Helm fliegt in die Schöpfschicht (0,8 Planetenradius) und hält dort, bis Deuterium an Bord ist, dann hinaus. Ops hält Systeme (Reaktor-Pflicht allgemein).
  'sl_gasriese/schoepfen'(a, S, p) {
    if (p.zone === 'away') { a.padsUp(S, p); return true; }
    const g = a.game; const sh = S.ship;
    const pl = (Locations.get('gasfeld').scene.planeten || []).find((q) => q.art === 'gasriese');
    const voll = Fracht.anBord(g, 'deuterium') >= 1;
    if (TRACE && a.is('helm') && S.time - (a.memo.trT || 0) > 10) { a.memo.trT = S.time; log(`  [trace ${S.time.toFixed(0)}] schoepfen pos ${Math.round(sh.x)},${Math.round(sh.y)} planet ${pl && pl.x},${pl && pl.y},${pl && pl.r} d ${pl && Math.round(dist(sh.x, sh.y, pl.x, pl.y))} v ${Math.round(sh.speed)} hülle ${Math.round(sh.hull)} deut ${Fracht.anBord(g, 'deuterium')} zonen ${JSON.stringify((S.zonen && S.zonen.i) || null)}`); }
    if (voll) { a.travel(S, p, 'concordia'); return true; }   // auftauchen = den Ort verlassen (Sprung nach Concordia; Captain wählt, Helm fliegt)
    if (!a.is('helm') || !pl) { a.idleStations(S, p); return true; }
    if (!a.enter(S, 'helm')) return true;
    const d = dist(sh.x, sh.y, pl.x, pl.y);
    if (voll) { a.travel(S, p, 'concordia'); return true; }   // auftauchen = den Ort verlassen (Sprung nach Concordia)
    const ang = Math.atan2(sh.y - pl.y, sh.x - pl.x);
    a.steer(S, pl.x + Math.cos(ang) * pl.r * 0.8, pl.y + Math.sin(ang) * pl.r * 0.8, 20, 90);
    return true;
  },
  // Kap. 7a Verkauf in Concordia: an die Station, Ops verkauft
  'sl_gasriese/verkauf'(a, S, p) {
    if (p.zone === 'away') { a.padsUp(S, p); return true; }
    const g = a.game; const sh = S.ship; const st = a.station(S);
    if (!st) { a.idleStations(S, p); return true; }
    const nah = dist(sh.x, sh.y, st.x, st.y) < 200 && sh.speed < 15;
    if (a.is('helm') && !nah) { if (a.enter(S, 'helm')) { if (dist(sh.x, sh.y, st.x, st.y) > 150) a.steer(S, st.x, st.y, 60); else a.brake(S); } if (!a.is('weapons')) return true; }
    if (a.is('weapons') && nah && Fracht.anBord(g, 'deuterium') > 0) { if (a.enter(S, 'weapons')) a.cmd('weapons.verkaufen'); return true; }
    if (!a.is('helm') || nah) a.idleStations(S, p);
    return true;
  },
  // Kap. 8: nach Concordia und andocken (die Wahl kommt im Schritt "entscheidung")
  'k8_entscheidung/anflug'(a, S, p) { return anDocken(a, S, p, 'concordia'); },
  // Kap. 8: Wahl nach opts.weg; ist die Option gesperrt (zu wenig Marken), "nachverdienen" – ehrlich, kein Ersatzweg
  'k8_entscheidung/entscheidung'(a, S, p) {
    const ch = S.mission.choice;
    if (!ch) return false;
    if (!a.is('captain') || p.zone !== 'ship') { a.idleStations(S, p); return true; }
    if (a.role === 'solo' && p.console === 'helm' && !a.brake(S)) return true;
    if (!a.enter(S, 'captain') || (a.memo.choiceAt || 0) > S.time) return true;
    a.memo.choiceAt = S.time + 1;
    const frei = ch.options.filter((o) => !o.disabled).map((o) => o.id);
    const opt = frei.includes(a.opts.weg) ? a.opts.weg : 'nachverdienen';
    a.cmd('captain.choice', { option: opt });
    (a.game.simStats.choices || (a.game.simStats.choices = [])).push({ mission: 'k8_entscheidung', id: ch.id, option: opt });
    return true;
  },
  // Kap. 9B: Söldner-Kontakt in Concordia andocken; Schlacht über die allgemeinen Kampfpfade
  'k9b_soeldner/kontakt'(a, S, p) { return S.mission.choice ? false : anDocken(a, S, p, 'concordia'); },
  // Kap. 9B Lager: Ops scannt das Lager, Team beamt hinunter, holt Evert (folgt), zurück zu den Pads. Gebaute Karte wie die Labor-Szenen (buehneScene).
  'k9b_soeldner/lager'(a, S, p, info) { return lagerEinsatz(a, S, p, info, 'schrottkante.lager'); },
  // Kap. 7: Hub. Erst Gasfeld, dann Forschungsstation, sonst "frei" (Geld per Notruf/Warten)
  'k7_geld/wahl'(a, S, p) {
    const ch = S.mission.choice;
    if (!ch) { a.idleStations(S, p); return true; }
    if (!a.is('captain') || p.zone !== 'ship') { a.idleStations(S, p); return true; }
    if (a.role === 'solo' && p.console === 'helm' && !a.brake(S)) return true;
    if (!a.enter(S, 'captain') || (a.memo.choiceAt || 0) > S.time) return true;
    a.memo.choiceAt = S.time + 1;
    const fl = a.game.mission.flags || {};
    const ok = ch.options.filter((o) => !o.disabled).map((o) => o.id);
    const opt = !fl.gasVerkauft && ok.includes('gas') ? 'gas' : !fl.forschungFertig && ok.includes('forschung') ? 'forschung' : 'frei';
    a.cmd('captain.choice', { option: opt });
    (a.game.simStats.choices || (a.game.simStats.choices = [])).push({ mission: 'k7_geld', id: ch.id, option: opt });
    return true;
  },
};
// Hinfliegen und andocken (Helm); die übrigen halten Station. false, wenn schon angedockt (der allgemeine Pfad nimmt Funk/Wahl an)
function anDocken(a, S, p, loc) {
  if (S.mission.choice || (S.mission.radio && S.mission.radio.needsAccept)) return false;
  if (S.space.enemies.length) { a.combatGeneric(S, p); return true; }
  if (S.ship.docked && S.ship.dockedAt === loc) return false;
  if (p.zone === 'away') { a.padsUp(S, p); return true; }
  if (S.ship.scene !== loc) { a.approach(S, p, loc); return true; }
  if (a.is('helm')) { a.dock(S, p, loc); return true; }
  a.idleStations(S, p); return true;
}
// Landepunkt-Einsatz mit Person (Evert am Boden): Scan (Ops), hinunter, Person holen, hoch. Nutzt buehneScene mit einem synthetischen Schritt.
function lagerEinsatz(a, S, p, info, lp) {
  const g = a.game;
  if (TRACE && a.idx === 0 && S.time - (a.memo.trT || 0) > 10) { a.memo.trT = S.time; log(`  [trace ${S.time.toFixed(0)}] lager scan ${Lpscan.gescannt(g, lp)} lpscan ${!!g.lpscan} zonen ${S.players.map((q) => q.zone + ':' + (q.console || '-')).join(' ')} schiff ${Math.round(S.ship.x)},${Math.round(S.ship.y)} v${Math.round(S.ship.speed)} ziel ${JSON.stringify(g.transferZiel)} feinde ${S.space.enemies.length} beam ${JSON.stringify(a.lpBeam(lp))} ziele ${JSON.stringify(Lpscan.ziele(g))} notices ${JSON.stringify(S.players.length ? (g.simAgents || []).map((x) => x.notices.slice(-2)) : 0)}`); }
  if (p.zone === 'ship' && a.is('weapons') && !Lpscan.gescannt(g, lp) && !S.space.enemies.length) {   // Scan: Ops bleibt an der Konsole, bis er fertig ist (Weggehen bricht ab)
    if (a.enter(S, 'weapons') && !g.lpscan && Lpscan.ziele(g).length) a.cmd('weapons.landescan');
    return true;
  }
  const step = Object.assign({}, info.step, { allowBeam: [lp], objectives: [{ id: 'evert', done: { check: { name: 'person_rescued', map: lp, person: 'evert' } } }] });
  a.buehneScene(S, p, step);
  return true;
}
// Fallback für Schritte ohne Umsetzung: Ziel "atLocation" anfliegen (Reise), sonst nichts Besonderes (Zeit-/Ereignis-Schritte laufen allein)
function fallback(a, S, p, info) {
  const st = info.step;
  if (st.umsetzung) return false;
  if (S.mission.choice || (S.mission.radio && S.mission.radio.needsAccept)) return false;   // Funk annehmen / Wahl: allgemeiner Pfad
  if (p.zone === 'away') { a.padsUp(S, p); return true; }   // Schritte ohne Umsetzung spielen am Schiff (Rückbeamen)
  const loc = a.anflugLoc(st);
  if (loc && S.ship.scene !== loc) { a.approach(S, p, loc); return true; }
  const dk = (st.objectives || []).find((o) => o.done && typeof o.done.docked === 'string');
  if (dk) {   // Hafen-Schritt: andocken (Helm), die übrigen stehen auf Station
    if (S.space.enemies.length) { a.combatGeneric(S, p); return true; }
    if (S.ship.docked && S.ship.dockedAt === dk.done.docked) return false;
    if (p.zone === 'away') { a.padsUp(S, p); return true; }
    if (S.ship.scene !== dk.done.docked) { a.approach(S, p, dk.done.docked); return true; }
    if (a.is('helm')) { a.dock(S, p, dk.done.docked); return true; }
    a.idleStations(S, p); return true;
  }
  return false;
}

function installHelpers(GA) {
  // Gespräch am Boden: zur Person gehen, E tippen, Zeilen weiterklicken, Option wählen. -> true (beschäftigt)
  GA.prototype.sundGespraech = function (S, p, person, opt) {
    const g = this.game;
    if (S.gp) {
      if ((this.memo.gpAt || 0) > S.time) return true;
      this.memo.gpAt = S.time + 0.4;
      if (S.gp.w) this.cmd('gespraech.pick', { opt }); else this.cmd('gespraech.next');
      return true;
    }
    const n = Away.personMit(g.away, person);
    if (!n || !n.present) { this.input(0, 0); return true; }
    this.interact(S, tileOf(n.x), tileOf(n.y), {});
    return true;
  };
}

async function main() {
  installHelpers(Sim.GenericAgent);
  const doc = Kampagne.laden('schuld-der-lerche');
  const wege = argVal('--weg', 'beide') === 'beide' ? ['loesegeld', 'soeldner'] : [argVal('--weg', 'loesegeld')];
  const crews = argVal('--crew', null) ? [Number(argVal('--crew'))] : [3];
  const seed = Number(argVal('--seed', 1));
  const kap = argVal('--kapitel', null), von = argVal('--von', null);
  const jobs = [];
  if (kap) for (const c of doc.kapitel) { if (kap === 'alle' || kap === c.id) jobs.push({ label: 'Einstieg ' + c.id, einstieg: c.id, stopNach: Kampagne.buecherVon(c).slice(-1)[0], weg: /^k9b/.test(c.id) ? 'soeldner' : 'loesegeld' }); }
  else for (const weg of wege) jobs.push({ label: 'Kette ' + (von ? 'ab ' + von : 'komplett') + ' Weg ' + weg, einstieg: von, stopNach: null, weg });
  const rows = []; let bad = 0;
  for (const crew of crews) for (const j of jobs) {
    const t0 = Date.now();
    const r = await Sim.runGeneric({ seed, crew, mode: 'kette', start: 'schuld_der_lerche', einstieg: j.einstieg, stopNach: j.stopNach, weg: j.weg, stepHook, stepLimit: () => 1500, pilot: 'maneuver', maxSec: j.stopNach ? 5000 : 30000, missionMax: 4000, funk: 'a', notrufeBot: null });
    // Bekannter Befund (nicht verstecken, aber nicht dieser Lauf): Notruf sl_echt öffnet die verborgene Kante boje-fundort (erst Kap. 10)
    r.befunde = r.errList.filter((e) => BEKANNT.test(e)); r.errors -= r.befunde.length;
    const gut = !r.aborted && !r.errors && (j.stopNach ? (r.stopNach === j.stopNach || r.ende) : r.ende);
    if (!gut) bad++;
    rows.push({ j, crew, r, gut, wall: Date.now() - t0 });
    Sim.printGenericRun(r, j.label + ' Crew ' + crew);
  }
  log('\n| Lauf | Crew | Ergebnis | Spielzeit (min) | Wand (s) | Kapitel |');
  log('|---|---|---|---|---|---|');
  for (const x of rows) log(`| ${x.j.label} | ${x.crew} | ${x.gut ? 'ok' : 'FEHL' + (x.r.aborted ? ' (' + x.r.aborted + ')' : '')} | ${Sim.fmtMin(x.r.gameTime)} | ${(x.wall / 1000).toFixed(0)} | ${x.r.missions.map((m) => m.id.split('_')[0] + (m.skips ? ' skip' + m.skips.length : '') + (m.success ? '' : ' offen')).join(', ')} |`);
  log(bad ? '\nSIM SUND FEHLGESCHLAGEN (' + bad + ')' : '\nSIM SUND OK');
  return bad;
}
main().then((bad) => process.exit(bad ? 1 : 0), (e) => { console.error(e); process.exit(2); });
