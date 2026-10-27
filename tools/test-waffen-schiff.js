'use strict';
// PAN-01 Paket C: Waffenkatalog, neun Plätze, geteilter Ladepool, Torpedowerfer, Magazindeckel, Gegner aus demselben Katalog, Ziel-Scan, Weltstand.
//   node tools/test-waffen-schiff.js            -> alle Abschnitte
//   node tools/test-waffen-schiff.js torpedo    -> nur Abschnitte, deren Name einen der Begriffe enthält
const fs = require('fs');
const os = require('os');
const path = require('path');
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const Physics = require('../shared/physics.js');
const Katalog = require('../shared/schiffskatalog.js');
const Maps = require('../shared/maps.js');
const Weltstand = require('../server/weltstand.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Testhilfe = require('./gegner-testhilfe.js');   // SYS-01 C1a-1: Gegner ohne Hülle (Budget, Gesamtintegrität)
const interior = require('../server/sim/interior.js');
const Waffen = require('../server/sim/schiffswaffen.js');
const Ausbau = require('../server/sim/ausbau.js');
const shop = require('../server/sim/shop.js');
const W = require('../server/world.js');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const DT = 1 / CONFIG.tickHz;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const info = (t) => console.log('  info ' + t);
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const near2 = (a, b) => Math.abs(a - b) < 0.01;
const f2 = (v) => String(Math.round(v * 100) / 100);
// SYS-01 A1a: Integrität (Summe über die aktiven Systeme) statt Hülle
const isum = (g) => { const IN = require('../server/sim/interior.js'); return IN.SYSTEM_ORDER.reduce((a, k) => a + (g.ship.systems[k] !== undefined && IN.systemAktiv(g, k) ? IN.integOf(g, k) : 0), 0); };
function section(name, body) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 6).join(' | ')); }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-waffen-schiff-'));
let dirSeq = 0;
const freshDir = () => { const d = path.join(TMP, 'w' + (++dirSeq)); fs.mkdirSync(d, { recursive: true }); return d; };

// Testgelände Raumkampf (arena_space) mit `players` Spielern; Lerche mitten im Feld, Bug nach +x, unverwundbar (Treffer zählen trotzdem)
function setup(start, opts) {
  const o = opts || {};
  const players = o.players || 1;
  const worlds = start !== 'arena_space';
  const g = new Game(Object.assign({ noStore: true, worlds, worldSaveSync: true, worldDir: o.dir, seed: o.seed || 21, debug: true,
    env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} }, o.game || {}));
  const conns = [];
  for (let i = 0; i < players; i++) {
    const c = { inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'W' + i, name: 'Waffe' + i, color: i });
    conns.push(c);
  }
  g.handleMessage(conns[0], { t: 'lobbyOpt', startMission: start, ...(o.world ? { world: o.world } : {}) });
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.space.enemies = []; g.space.projectiles = [];
  const events = [];
  const emit0 = g.emit.bind(g);
  g.emit = (kind, data) => { events.push(Object.assign({ kind, t: g.time }, data)); return emit0(kind, data); };
  const run = (sec, each) => { for (let k = 0; k < Math.round(sec / DT); k++) { if (each) each(); g.step(); } };
  const T = { g, conns, p: g.players[0], run, events, ev: (k) => events.filter((e) => e.kind === k) };
  T.cmd = (i, cmd, f) => { conns[i].inbox.length = 0; g.handleMessage(conns[i], Object.assign({ t: 'cmd', c: cmd }, f || {})); return conns[i].inbox.filter((m) => m.kind === 'notice').map((m) => m.text); };
  T.debug = (cmd, args, extra) => { conns[0].inbox.length = 0; g.handleMessage(conns[0], Object.assign({ t: 'debug', cmd, args }, extra || {})); return conns[0].inbox.filter((m) => m.kind === 'notice').map((m) => m.text); };
  T.send = (m) => g.handleMessage(conns[0], m);
  return T;
}
function arena(opts) {
  const T = setup('arena_space', opts);
  const sh = T.g.ship; sh.x = T.g.space.w / 2; sh.y = T.g.space.h / 2; sh.angle = 0; sh.vx = 0; sh.vy = 0; sh.turnVel = 0;
  T.g.god = true;
  T.g.players[0].console = 'weapons';   // Ops besetzt: keine Automatik
  T.run(0.1);
  return T;
}
const snapShip = (T) => T.g.snapshot().ship;
const snapMount = (T, id) => (snapShip(T).mounts || []).find((m) => m.id === id);
// Gegner an fester Stelle relativ zur Lerche (dx vor/hinter, dy Seite; +dy = Steuerbord), still, ohne Schilde/Feuer
function gegner(T, kind, dx, dy, o) {
  const g = T.g; const sh = g.ship; const opt = o || {};
  const e = space.spawnEnemy(g, kind, Object.assign({ x: sh.x + dx, y: sh.y + dy, facing: Math.PI }, opt.spawn || {}));
  if (!opt.schild) e.shields = e.shields.map(() => 0);
  e.pin = { x: e.x, y: e.y, angle: e.angle }; if (opt.hp != null) Testhilfe.setzeBudget(e, opt.hp);   // SYS-01 C1a-1: Klassenbudget statt Hülle
  return e;
}
function pin(g) {
  const sh = g.ship; sh.vx = 0; sh.vy = 0;
  for (const e of g.space.enemies) if (e.pin) { e.x = e.pin.x; e.y = e.pin.y; e.angle = e.pin.angle; e.vx = 0; e.vy = 0; e.fireT = -999; e.boltT = -999; if (e.sf) e.sf.t = -999; if (e.sfS) e.sfS.t = -999; e.tele = null; e.streuG = -999; e.torpG = -999; }
}
const lauf = (T, sec, each) => T.run(sec, () => { pin(T.g); if (each) each(); });
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const f1x = (v) => (Math.round(v * 10) / 10).toString();

section('Katalog: vollständig und konsistent', () => {
  const ids = Katalog.WAFFEN.map((w) => w.id);
  ok(ids.length === 8 && new Set(ids).size === 8, 'acht Waffen, Ids eindeutig: ' + ids.join(', '));
  ok(JSON.stringify(ids.slice().sort()) === JSON.stringify(['abwehrturm', 'lanze', 'lanzenbatterie', 'standardbatterie', 'standardkanone', 'streubatterie', 'sturmbatterie', 'torpedowerfer']), 'genau die Waffen des Auftrags');
  const pflicht = ['id', 'name', 'kurz', 'platzart', 'wirkung', 'energie', 'art', 'schaden', 'rohre', 'bogen', 'reichweite', 'modell', 'projektil', 'effekt', 'ton', 'symbol', 'munition', 'gegner'];   // SYS-01 B1: das Feld stoss entfällt (Ladung = schaden × rohre)
  for (const w of Katalog.WAFFEN) {
    const fehlt = pflicht.filter((k) => w[k] === undefined);
    ok(fehlt.length === 0, `${w.id}: alle Felder (${fehlt.join(',') || 'vollständig'})`);
    ok(['seite', 'bug', 'heck'].includes(w.platzart) && typeof w.energie === 'boolean' && w.name.length > 2 && w.kurz.length <= 8, `${w.id}: Platzart ${w.platzart}, Name, Kurzname ≤ 8 Zeichen`);
    ok(/^lerche\/station\/lafette_[a-z_]+$/.test(w.modell) && w.projektil.form && /^#[0-9A-Fa-f]{6}$/.test(w.projektil.farbe) && w.ton && w.effekt, `${w.id}: Lafettenmodell-Id ${w.modell}, Projektil ${w.projektil.form}/${w.projektil.farbe}, Ton ${w.ton}, Effekt ${w.effekt}`);
    const mask = Katalog.SYMBOLE[w.symbol];
    ok(Array.isArray(mask) && mask.length === 10 && mask.every((r) => r.length === 10 && /^[.#+ow]+$/.test(r)), `${w.id}: Taktik-Symbol ${w.symbol} (10×10-Maske)`);
    ok(w.energie ? w.ladekosten > 0 : (w.munition === 'torpedo' && w.cooldown > 0), `${w.id}: ${w.energie ? 'Ladekosten ' + w.ladekosten : 'Munition ' + w.munition + ', Cooldown ' + w.cooldown}`);
  }
  ok(new Set(Katalog.WAFFEN.map((w) => w.symbol)).size === 8 && new Set(Katalog.WAFFEN.map((w) => w.modell)).size === 8 && new Set(Katalog.WAFFEN.map((w) => w.ton)).size >= 7, 'Symbol und Lafettenmodell je Art verschieden, Töne unterscheidbar');
  ok(new Set(Katalog.WAFFEN.map((w) => w.projektil.form + w.projektil.farbe)).size >= 7, 'Projektilform und -farbe unterscheiden die Arten');
  // Tabelle des Auftrags
  const art = (id) => Katalog.waffe(id);
  ok(['standardbatterie', 'sturmbatterie', 'streubatterie', 'lanzenbatterie'].every((id) => art(id).platzart === 'seite') && ['lanze', 'standardkanone'].every((id) => art(id).platzart === 'bug') && ['torpedowerfer', 'abwehrturm'].every((id) => art(id).platzart === 'heck'), 'Platzarten: Seite 4, Bug 2, Heck 2');
  ok(Katalog.WAFFEN.filter((w) => !w.energie).map((w) => w.id).join() === 'torpedowerfer', 'nur der Torpedowerfer ohne Energie');
  ok(Katalog.PRIORITAET.length === 9 && Object.keys(Katalog.MOUNT_ID).length === 9 && Katalog.PRIORITAET.every((id) => Katalog.mountId(Katalog.platzVonMount(id)) === id), 'neun Plätze, Mount-Ids und Plätze eindeutig (bow 8, port 4, stbd 6, p<N>)');
  ok(Object.entries(Katalog.START_BESTUECKUNG).every(([p, id]) => Katalog.passtAuf(id, Number(p))) && Katalog.passtAuf('torpedowerfer', 2) && !Katalog.passtAuf('torpedowerfer', 5) && !Katalog.passtAuf('lanze', 4), 'Startbestückung und Platzarten passen');
  // Startwerte gleich der Config (Golden-Stabilität: Standardbatterie = Batterie, Lanze = Lanze)
  const P = CONFIG.spaceM3.mounts.port, L = CONFIG.spaceM3.lance, B = CONFIG.spaceM3.mounts.bow;
  const sb = art('standardbatterie'), la = art('lanze');
  ok(sb.schaden === P.damage && sb.rohre === P.tubes && sb.ladekosten === P.secPerPoint && sb.bogen === P.arc && sb.reichweite === P.range, 'Standardbatterie = spaceM3.mounts.port (SYS-01 B1: ein Projektil je Zyklus)');
  ok(la.lanze.aufladen === L.chargeTime && la.lanze.min === L.minDamage && la.lanze.max === L.maxDamage && la.lanze.breite === L.width && la.bogen === B.arc && la.reichweite === B.range && la.ladekosten === B.secPerPoint && la.lanze.pierce === B.pierce, 'Lanze = spaceM3.lance + mounts.bow');
  ok(CONFIG.economy.startInventory.bolzen === Katalog.TORPEDO.lagerStart && CONFIG.shelfCapacity.bolzen === Katalog.TORPEDO.lagerMax && CONFIG.shop.find((s) => s.id === 'bolzen').limit === Katalog.TORPEDO.lagerMax, 'Torpedo: Start 6, Lager 12 (Config = Katalog)');
  // Magazindeckel: 1,5 × Start-Lerche
  const start = sum(Object.values(Katalog.START_BESTUECKUNG).map((id) => Katalog.volley(id)));
  ok(start === Katalog.MAGAZINDECKEL.stossStart && Katalog.MAGAZINDECKEL.stossMax === 1.5 * start, `Magazindeckel: Start-Lerche ${start} (Lanze 12 + 2 × 6), Obergrenze ${Katalog.MAGAZINDECKEL.stossMax}`);
  // Module je Klasse
  ok(Protocol.ENEMY_KINDS.concat(['frachter']).every((k) => Array.isArray(Katalog.moduleFuerKlasse(k))) && Katalog.moduleFuerKlasse('frachter').includes('frachtraum') && Katalog.moduleFuerKlasse('raider').length === 0, 'Module je Klasse: jede Klasse definiert, Frachter mit Frachtraum, Jäger ohne');
  ok(Object.values(Katalog.MODULE_JE_KLASSE).every((l) => l.every((m) => Protocol.MODUL_IDS.includes(m))), 'Klassen-Module sind bekannte Bordmodule');
  // Töne: jeder Katalogton ist im Client definiert (audio.js)
  const audio = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'audio.js'), 'utf8');
  const fehlenTon = Katalog.WAFFEN.map((w) => w.ton).concat(['streu_boom']).filter((t) => !new RegExp('(^|[^A-Za-z0-9_])' + t + '[\'"]?\\s*:').test(audio));
  ok(fehlenTon.length === 0, 'audio.js kennt alle Katalogtöne' + (fehlenTon.length ? ' – fehlt: ' + fehlenTon.join(',') : ''));
  // Lafettenmodelle: die Voxelwerk-Familie (lerche/station/lafette_*) steht im synchronisierten Manifest und trägt state und side (Abwehrturm zusätzlich winkel)
  const vm = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'voxel', 'manifest.json'), 'utf8'));
  const eintraege = Array.isArray(vm.assets) ? vm.assets : Object.values(vm.assets || {});
  const fehlenModell = Katalog.WAFFEN.filter((w) => !eintraege.some((a) => a.id === w.modell && a.params && a.params.state && a.params.side && (w.id !== 'abwehrturm' || a.params.winkel)));
  ok(fehlenModell.length === 0, 'Voxel-Manifest kennt alle Lafettenmodelle des Katalogs' + (fehlenModell.length ? ' – fehlt: ' + fehlenModell.map((w) => w.modell).join(',') : ''));
});

section('Plätze, Stufen, Systeme (lafette_N)', () => {
  const T = arena(); const g = T.g;
  ok(JSON.stringify(Waffen.mountIds(g)) === '["bow","port","stbd"]' && JSON.stringify(snapShip(T).mounts.map((m) => m.id)) === '["bow","port","stbd"]', 'Stufe 0: drei Mounts (8 Lanze, 4 und 6 Standardbatterie)');
  ok(!snapShip(T).mounts.some((m) => m.typ), 'Snapshot: typ fehlt bei der Startbestückung (Budget)');
  ok(!Object.keys(snapShip(T).systems).some((k) => /^lafette_/.test(k)), 'Stufe 0: keine Lafetten-Systeme im Snapshot');
  const r = T.debug('bestueck', '7 standardbatterie');
  ok(r.length === 1 && /gesperrt/.test(r[0]) && /stufe 1/i.test(r[0]), 'gesperrter Platz bleibt gesperrt: ' + r[0]);
  T.debug('ausbau', '1');
  ok(T.debug('bestueck', '7 standardbatterie').length === 0 && g.ship.waffen[7] === 'standardbatterie' && Waffen.mountIds(g).includes('p7'), 'Stufe 1: Platz 7 bestückbar, Mount p7');
  ok(T.debug('bestueck', '9 torpedowerfer').length === 1 && T.debug('bestueck', '9 quatsch').length === 1, 'falsche Platzart und unbekannte Waffe werden abgelehnt');
  ok(T.debug('bestueck', '2 abwehrturm').length === 1, 'Heck 2 ist erst mit Stufe 2 offen');
  T.debug('bestueck', 'alle 3');
  const ms = snapShip(T).mounts;
  ok(ms.length === 9 && ms.map((m) => m.id).join() === 'bow,port,stbd,p5,p7,p9,p1,p3,p2', 'Stufe 3: neun Mounts in der Reihenfolge Bug, Seiten, Bug 2, Heck: ' + ms.map((m) => m.id).join());
  ok(ms.find((m) => m.id === 'p5').typ === 'standardkanone' && ms.find((m) => m.id === 'p2').typ === 'torpedowerfer' && ms.find((m) => m.id === 'p7').typ === 'standardbatterie' && !ms.find((m) => m.id === 'bow').typ, 'typ nur bei Abweichung von der Startbestückung');
  const geo = (id) => ms.find((m) => m.id === id);
  ok(geo('p7').facing === -90 && geo('p9').facing === 90 && geo('p1').facing === -90 && geo('p3').facing === 90 && geo('p5').facing === 0 && geo('p2').facing === 180 && geo('p2').arc === Katalog.waffe('torpedowerfer').bogen, 'Bögen: Seiten ±90, Bug 0, Heck 180');
  const sys = snapShip(T).systems;
  ok(['lafette_5', 'lafette_7', 'lafette_9', 'lafette_1', 'lafette_3', 'lafette_2'].every((k) => sys[k] === 'ok'), 'alle sechs Lafetten-Systeme aktiv im Snapshot');
  // trefferbar nur offen UND bestückt
  const wird = new Set();
  for (let i = 0; i < 1500; i++) { interior.integritaetVoll(g); for (const k of Object.keys(g.ship.systems)) g.ship.systems[k] = 'ok'; const r = interior.trefferweg(g, i % 4, 1); if (r) wird.add(r.system); }
  ok(['lafette_5', 'lafette_7', 'lafette_9', 'lafette_1', 'lafette_3', 'lafette_2'].every((k) => wird.has(k)), 'bestückte Lafetten sind Trefferziele (' + [...wird].filter((k) => /^lafette/.test(k)).join(',') + ')');
  T.debug('bestueck', '7 leer'); T.debug('bestueck', '3 leer');
  const wird2 = new Set();
  for (let i = 0; i < 1500; i++) { interior.integritaetVoll(g); for (const k of Object.keys(g.ship.systems)) g.ship.systems[k] = 'ok'; const r = interior.trefferweg(g, i % 4, 1); if (r) wird2.add(r.system); }
  ok(!wird2.has('lafette_7') && !wird2.has('lafette_3') && wird2.has('lafette_9') && !interior.systemAktiv(g, 'lafette_7') && !Object.keys(snapShip(T).systems).includes('lafette_7'), 'unbestückt: kein Trefferziel, nicht im Snapshot');
  T.debug('ausbau', '0');
  const wird3 = new Set();
  for (let i = 0; i < 800; i++) { interior.integritaetVoll(g); for (const k of Object.keys(g.ship.systems)) g.ship.systems[k] = 'ok'; const r = interior.trefferweg(g, i % 4, 1); if (r) wird3.add(r.system); }
  ok(![...wird3].some((k) => /^lafette_/.test(k)) && JSON.stringify(Waffen.mountIds(g)) === '["bow","port","stbd"]', 'verschlossener Platz (Stufe 0): kein Trefferziel, kein Mount, auch wenn die Bestückung gespeichert bleibt');
  ok(g.ship.waffen[9] === 'standardbatterie', 'Bestückung bleibt beim Zurückstufen erhalten (Platz wieder offen: sofort aktiv)');
  // Station und Reparatur
  for (const p of Maps.WAFFENPLAETZE) ok(W.STATIONS.some((s) => s.system === p.system), `Station für ${p.system} auf der Lafetten-Kachel`);
  T.debug('ausbau', '3'); T.debug('bestueck', 'alle 3');
  T.debug('damage', '', { system: 'lafette_7', state: 'damaged' });
  ok(g.ship.systems.lafette_7 === 'damaged' && interior.repairable(g, 'lafette_7') && require('../server/sim/bots.js').queueRepair(g, 'lafette_7', 'flick') === null, 'Lafette beschädigt: reparierbar, Reparaturliste nimmt sie an');
  T.debug('bestueck', '7 sturmbatterie');
  ok(g.ship.systems.lafette_7 === 'ok', 'neue Hardware auf dem Platz: Zustand zurückgesetzt');
  const sm = (id) => snapMount(T, id);
  g.ship.systems.lafette_9 = 'broken';
  ok(sm('p9').state === 'broken', 'Mount-Zustand folgt dem System lafette_9');
});

section('Ladepool geteilt (Energiewaffen), Torpedowerfer außerhalb', () => {
  const T = arena(); const g = T.g;
  T.debug('bestueck', 'alle 3');
  const sh = snapShip(T);
  ok(sh.chargePoints === 4, 'Ladepunkte = Energie + 2 = 4 (Formel unverändert)');
  const energie = sh.mounts.filter((m) => m.alloc !== undefined);
  ok(energie.length === 8 && !snapMount(T, 'p2').alloc && snapMount(T, 'p2').ammo !== undefined, 'acht Energiewaffen mit Ladepunkten, der Torpedowerfer ohne alloc');
  ok(sum(energie.map((m) => m.alloc)) === 4 && JSON.stringify(energie.map((m) => m.alloc)) === '[1,1,1,1,0,0,0,0]', 'Standardverteilung: ein Pool von 4 Punkten für alle acht, reihum nach Priorität (Bug 8, Bb 4, Stb 6, Bug 5 je 1, der Rest ist Reserve): ' + energie.map((m) => m.alloc).join(','));
  ok(T.cmd(0, 'weapons.alloc', { mount: 'p2', delta: 1 }).some((t) => /Torpedo|Ladepunkte/.test(t)), 'Ladepunkte für den Torpedowerfer werden abgelehnt');
  ok(T.cmd(0, 'weapons.alloc', { mount: 'p7', delta: 1 }).some((t) => /Keine Ladepunkte frei/.test(t)), 'Pool voll: keine Punkte mehr zu vergeben');
  T.cmd(0, 'weapons.alloc', { mount: 'bow', delta: -1 }); T.cmd(0, 'weapons.alloc', { mount: 'p7', delta: 1 });
  ok(snapMount(T, 'bow').alloc === 0 && snapMount(T, 'p7').alloc === 1 && sum(snapShip(T).mounts.filter((m) => m.alloc !== undefined).map((m) => m.alloc)) === 4, 'umverteilen: Bug −1, Platz 7 +1 (Summe bleibt 4)');
  for (let i = 0; i < 3; i++) T.cmd(0, 'weapons.alloc', { mount: 'port', delta: 1 });
  ok(snapMount(T, 'port').alloc <= CONFIG.spaceM3.allocMax, 'je Waffe höchstens allocMax ' + CONFIG.spaceM3.allocMax);
  // Ladeverhalten: alle Energiewaffen leeren und laden lassen: die Summe der geladenen Ladekosten wächst mit höchstens den Pool-Punkten
  T.debug('bestueck', 'alle 3');
  g.ship.wAllocIntent = Waffen.standardVerteilung(g);
  for (const a of Waffen.energieMounts(g)) g.ship.mount[a.id].charge = 0;
  const kosten = () => sum(Waffen.energieMounts(g).map((a) => g.ship.mount[a.id].charge * Waffen.wcfg(g, a.w).ladekosten));
  T.run(10);
  const gewonnen = kosten();
  // SYS-01 B1: die Batterien sind mit einem Projektil je Zyklus nach 5 s voll (Ladung = 1), der Pool wird dann nicht mehr gebraucht
  ok(gewonnen <= 4 * 10 + 0.5 && gewonnen > 4 * 10 * 0.5, `Energiewaffen laden aus demselben Pool: ${gewonnen.toFixed(1)} Punktsekunden in 10 s (Pool 4 → höchstens 40, volle Waffen halten nicht weiter)`);
  const reserve = Waffen.energieMounts(g).filter((a) => g.ship.mount[a.id].alloc === 0).map((a) => g.ship.mount[a.id].charge);
  ok(reserve.length === 4 && reserve.every((c) => c === 0), 'Waffen ohne Ladepunkt laden nicht (Reserve: ' + reserve.length + ' von 8)');
  // Torpedo: Cooldown unabhängig von Energie und Triebwerk
  g.ship.power.weapons = 0; g.ship.powerIntent = Object.assign({}, g.ship.power); g.ship.systems.engines = 'broken';
  const e = gegner(T, 'korvette', -300, 0, { hp: 9999 }); g.ship.target = e.id; g.inventory.bolzen = 6;
  const lad0 = Waffen.energieMounts(g).map((a) => g.ship.mount[a.id].charge);
  ok(T.cmd(0, 'weapons.fire', { mount: 'p2' }).length === 0 && g.inventory.bolzen === 5 && g.ship.mount.p2.cd > 0, 'Torpedo feuert ohne Waffenenergie und mit zerstörtem Triebwerk');
  lauf(T, Katalog.TORPEDO.cooldown + 0.3);
  ok(g.ship.mount.p2.cd === 0 && T.cmd(0, 'weapons.fire', { mount: 'p2' }).length === 0 && g.inventory.bolzen === 4, 'Cooldown läuft ohne Energie und ohne Triebwerk ab, zweiter Schuss');
  ok(JSON.stringify(Waffen.energieMounts(g).map((a) => g.ship.mount[a.id].charge)) === JSON.stringify(lad0) && Waffen.chargePoints(g) === 0, 'Energiewaffen laden ohne Waffenenergie nicht (0 Ladepunkte, Ladung unverändert)');
});

section('Magazindeckel: Anfangsstoß bei neun Waffen höchstens 1,5 × Start', () => {
  const T = arena(); const g = T.g;
  ok(near(Waffen.vorrat(g), Katalog.MAGAZINDECKEL.stossStart, 1e-9), 'Start-Lerche: Anfangsstoß ' + Waffen.vorrat(g).toFixed(2) + ' (Lanze 12 + 2 × 2,9 je Projektil)');
  T.debug('bestueck', 'alle 3');
  // neun Energiewaffen: Heck 2 als Abwehrturm statt Torpedowerfer
  T.debug('bestueck', '2 abwehrturm');
  ok(Waffen.energieMounts(g).length === 9, 'neun Energiewaffen');
  ok(Waffen.vorrat(g) <= Katalog.MAGAZINDECKEL.stossMax + 1e-9, `neue Waffen starten mit höchstens der Ladung, die der Deckel zulässt (${Waffen.vorrat(g).toFixed(1)} ≤ ${Katalog.MAGAZINDECKEL.stossMax})`);
  // alle leeren, Pool rotieren lassen (jede Waffe kommt irgendwann dran), lange warten
  g.ship.power.weapons = 4; g.ship.powerIntent = Object.assign({}, g.ship.power);
  for (const a of Waffen.energieMounts(g)) g.ship.mount[a.id].charge = 0;
  const ids = Waffen.energieMounts(g).map((a) => a.id);
  let max = 0, t = 0, rot = 0;
  while (t < 900) {
    g.ship.wAllocIntent = {}; for (let k = 0; k < 6; k++) g.ship.wAllocIntent[ids[(rot + k) % ids.length]] = 1;
    rot = (rot + 3) % ids.length;
    T.run(15); t += 15; max = Math.max(max, Waffen.vorrat(g));
  }
  const ohne = sum(ids.map((id) => Katalog.volley(g.ship.waffen[Katalog.platzVonMount(id)])));
  ok(max <= Katalog.MAGAZINDECKEL.stossMax + 1e-9 && max > 1.3 * Katalog.MAGAZINDECKEL.stossStart, `Anfangsstoß nach 15 Minuten Ruhe: ${max.toFixed(1)} ≤ ${Katalog.MAGAZINDECKEL.stossMax} (= 1,5 × ${Katalog.MAGAZINDECKEL.stossStart}); ohne Deckel wären es ${ohne.toFixed(1)}`);
  ok(max / Katalog.MAGAZINDECKEL.stossStart <= 1.5 + 1e-9 && ohne > Katalog.MAGAZINDECKEL.stossMax, 'Deckel greift: Verhältnis ' + (max / Katalog.MAGAZINDECKEL.stossStart).toFixed(2) + ' ≤ 1,5, ungedeckt wäre es ' + (ohne / Katalog.MAGAZINDECKEL.stossStart).toFixed(2));
  // Dauerfeuer-Obergrenze je Ladepunkt hängt nicht an der Zahl der Waffen: Pool × bester Wert je Punkt
  const rate = (id) => { const w = Katalog.waffe(id); return w.energie && w.stoss > 0 ? w.stoss / w.ladekosten : 0; };
  const best = (loadout, pool) => { const r = loadout.map(rate).sort((a, b) => b - a); let left = pool, s = 0; for (const x of r) { const k = Math.min(CONFIG.spaceM3.allocMax, left); s += k * x; left -= k; } return s; };
  const l3 = Object.values(Katalog.START_BESTUECKUNG), l9 = ['lanze', 'standardkanone', 'standardbatterie', 'standardbatterie', 'standardbatterie', 'standardbatterie', 'standardbatterie', 'standardbatterie', 'abwehrturm'];
  ok(near(best(l9, 4), best(l3, 4), 0.05), `Dauerfeuer-Obergrenze bei Pool 4: 3 Waffen ${best(l3, 4).toFixed(2)} Schaden/s, 9 Waffen ${best(l9, 4).toFixed(2)} (gleich, nicht neunfach)`);
  info('Pool 6: 3 Waffen ' + best(l3, 6).toFixed(2) + ', 9 Waffen ' + best(l9, 6).toFixed(2) + ' (Waffen mit mehr Schaden je Punkt gewinnen nur durch die Auswahl)');
});

section('Torpedowerfer: Regeln', () => {
  const T = arena(); const g = T.g;
  const lager = Katalog.TORPEDO;
  ok(CONFIG.economy.startInventory.bolzen === 6, 'Startlager 6 Torpedos');
  ok(T.debug('bestueck', '2 torpedowerfer').some((t) => /gesperrt/.test(t)) && T.cmd(0, 'weapons.fire', { mount: 'bolzen' }).some((t) => /Kein Torpedowerfer/.test(t)), 'Stufe 0: Torpedowerfer gesperrt, Feuern meldet „kein Torpedowerfer“');
  T.debug('ausbau', '1'); ok(T.debug('bestueck', '2 torpedowerfer').some((t) => /gesperrt/.test(t)), 'Stufe 1: Heck 2 noch gesperrt (an die Stufe gebunden)');
  T.debug('ausbau', '2');
  ok(T.debug('bestueck', '2 torpedowerfer').length === 0 && Waffen.mountIds(g).includes('p2'), 'Stufe 2: Torpedowerfer auf Heck 2');
  ok(T.debug('bestueck', '5 torpedowerfer').some((t) => /bug|Bug/.test(t)), 'Bug-Platz 5 nimmt keinen Torpedowerfer: er gehört ans Heck (der alte Bolzenwerfer-Platz 5 entfällt)');
  const tm = snapMount(T, 'p2');
  ok(tm.typ === 'torpedowerfer' && tm.facing === 180 && tm.arc === Katalog.waffe('torpedowerfer').bogen && tm.alloc === undefined && tm.charge === 1 && tm.ammo === 6, 'Snapshot: Heck, Bogen ' + tm.arc + ', Lager 6, ohne Ladepunkte');
  // Wirkung: kein Schildschaden, trifft die Hülle; Jäger sofort tot, Korvette nur angeschlagen
  // Kai 2026-10-18: Lesart B – der Torpedo wirkt nur auf freie Hülle (Schildsegment ausgefallen); bei stehendem Schild prallt er ab (Schaden 0, kein Schildabzug)
  ok(Katalog.TORPEDO.schildUmgehung === 'nur-ohne-schild', 'Katalog: schildUmgehung nur-ohne-schild (Lesart B, alle Ziele)');
  const j = gegner(T, 'raider', -300, 0, { schild: true }); j.shields = [4, 4, 4, 4]; j.shieldsMax = [4, 4, 4, 4];   // Obergrenze mit anheben: sonst kappt schildPflege auf die Klassenwerte
  g.ship.target = j.id;
  const sh0 = j.shields.slice(); const jh = j.hp;
  ok(T.cmd(0, 'weapons.fire', { mount: 'bolzen' }).length === 0, 'Torpedo auf den Jäger abgefeuert');
  const alive = () => g.space.enemies.includes(j);
  let t = 0; while ((g.stats.torpedoAbgeprallt || 0) < 1 && alive() && t < 4) { pin(g); T.run(DT); t += DT; }
  ok(alive() && j.hp === jh && JSON.stringify(j.shields) === JSON.stringify(sh0) && g.stats.torpedoAbgeprallt === 1 && g.inventory.bolzen === 5, `Jäger mit stehendem Schild: der Torpedo prallt ab (Schaden 0, Schild unberührt, Torpedo verbraucht, Lager ${g.inventory.bolzen})`);
  lauf(T, Katalog.TORPEDO.cooldown + 0.5);
  j.shields = [0, 0, 0, 0];   // Schild ausgefallen (z. B. von Sturm, Streu und Batterie aufgebrochen)
  T.cmd(0, 'weapons.fire', { mount: 'bolzen' });
  t = 0; while (alive() && t < 4) { pin(g); T.run(DT); t += DT; }
  // SYS-01 C1a-1: „Torpedo zerstört einen Jäger sofort“ ist Paket C1a-2 (Daten und Regel dort). Bis dahin trifft der Torpedo ein System der Zone (Schild unten, keine Hülle mehr):
  // der Treffer kommt an und kostet Integrität, der Jäger lebt noch. Die alte Prüfung (direkt zerstört) kommt mit C1a-2 zurück.
  ok(g.stats.torpedoTreffer === 1 && Testhilfe.gesamtIntegritaet(j) < jh || !alive(), `Jäger ohne Schild: der Torpedo trifft (Integrität ${jh.toFixed(1)} -> ${alive() ? Testhilfe.gesamtIntegritaet(j).toFixed(1) : 'tot'}) – info: „sofort zerstört“ bis C1a-2`);
  console.log('  info   Jäger sofort zerstört (Torpedo): bis C1a-2 zurückgestellt (Modell: nur Reaktor tötet)');
  lauf(T, Katalog.TORPEDO.cooldown + 0.5);
  const k = gegner(T, 'korvette', -300, 0, { schild: true, hp: 220 }); k.shields = [2, 2, 2, 2]; k.shieldsMax = [2, 2, 2, 2];   // Budget 220: jedes System fasst mehr als einen Treffer (Überschuss über ein System verfällt)
  g.ship.target = k.id; const s0 = k.shields.slice();
  T.cmd(0, 'weapons.fire', { mount: 'bolzen' });
  t = 0; while ((g.stats.torpedoAbgeprallt || 0) < 2 && t < 4) { pin(g); T.run(DT); t += DT; }
  ok(k.hp === 220 && JSON.stringify(k.shields) === JSON.stringify(s0), `Korvette mit stehendem Schild ${JSON.stringify(k.shields)}: abgeprallt, Integrität ${k.hp}`);
  lauf(T, Katalog.TORPEDO.cooldown + 0.5);
  k.shields = [0, 0, 0, 0]; T.cmd(0, 'weapons.fire', { mount: 'bolzen' });
  t = 0; while (g.stats.torpedoTreffer < 2 && t < 4) { pin(g); T.run(DT); t += DT; }
  ok(g.space.enemies.includes(k) && Math.abs(k.hp - (220 - Katalog.torpedoSchaden('korvette'))) < 1e-6, `Korvette ohne Schild (Integrität 220): ein Treffer −${Katalog.torpedoSchaden('korvette')}, angeschlagen (${k.hp})`);
  ok(Katalog.torpedoSchaden('fregatte') < 22 && Katalog.torpedoSchaden('kreuzer') < 22, 'Fregatte und Kreuzer: derselbe Schaden, also mehrere Treffer');
  ok(Katalog.torpedoSchaden('raider') >= Math.round(CONFIG.enemies.raider.hp * 1 * CONFIG.spaceM3.enemyHpFactor) && Katalog.torpedoSchaden('raider') >= 25, 'Jäger-Schaden über jeder Jäger-Hülle (auch bei voller Crew-Skalierung)');
  // Cooldown
  ok(g.ship.mount.p2.cd > 0 && T.cmd(0, 'weapons.fire', { mount: 'p2' }).some((x) => /lädt nach/.test(x)), 'Cooldown: zu früh gefeuert -> „lädt nach“');
  T.run(g.ship.mount.p2.cd + 0.1);
  ok(near(g.ship.mount.p2.cd, 0, 1e-9) && snapMount(T, 'p2').charge === 1, 'nach dem Cooldown wieder bereit (kein Befehl R)');
  ok(T.cmd(0, 'weapons.reload').some((x) => /selbst/.test(x)), 'R (Nachladen) gibt es nicht mehr: der Werfer lädt selbst');
  // Lager hart 12
  T.debug('inv', '', { item: 'bolzen', n: 50 });
  ok(g.inventory.bolzen === lager.lagerMax, 'Lager hart bei ' + lager.lagerMax + ' (Debug inv 50 -> ' + g.inventory.bolzen + ')');
  const marks = g.inventory.marks; g.ship.docked = true; g.ship.dockedAt = 'hafen';
  ok(shop.buy(g, g.players[0], 'bolzen') !== null && g.inventory.bolzen === 12 && g.inventory.marks === marks, 'Kauf nur bis zum Limit: bei 12 abgelehnt, nichts abgebucht');
  g.inventory.bolzen = 11; ok(shop.buy(g, g.players[0], 'bolzen') === null && g.inventory.bolzen === 12, 'bei 11: ein Torpedo kaufbar');
  g.ship.docked = false; g.ship.dockedAt = null;
  g.inventory.bolzen = 0; g.ship.mount.p2.cd = 0;
  const lz = gegner(T, 'korvette', -300, 0, { hp: 9999 }); g.ship.target = lz.id;
  ok(T.cmd(0, 'weapons.fire', { mount: 'p2' }).some((x) => /Keine Torpedos/.test(x)), 'Lager leer: Hinweis, kein Schuss');
  g.inventory.bolzen = 6;
  // Heckbogen
  const e = gegner(T, 'korvette', 300, 0, { hp: 9999 }); g.ship.target = e.id;
  ok(T.cmd(0, 'weapons.fire', { mount: 'p2' }).some((x) => /außerhalb/.test(x)), 'Ziel vor dem Bug: außerhalb des Heckbogens');
  const half = Katalog.waffe('torpedowerfer').bogen / 2;
  const ang = (deg) => { const a = Math.PI + deg * Math.PI / 180; e.pin = { x: g.ship.x + Math.cos(a) * 300, y: g.ship.y + Math.sin(a) * 300, angle: 0 }; pin(g); };
  ang(half - 2); ok(T.cmd(0, 'weapons.fire', { mount: 'p2' }).length === 0, `Ziel ${half - 2}° neben dem Heck: im Bogen (${Katalog.waffe('torpedowerfer').bogen}°)`);
  T.run(Katalog.TORPEDO.cooldown + 0.1); g.space.projectiles = [];
  ang(half + 3); ok(T.cmd(0, 'weapons.fire', { mount: 'p2' }).some((x) => /außerhalb/.test(x)), `Ziel ${half + 3}° neben dem Heck: außerhalb`);
  // Gegner-Torpedo gegen die Lerche
  // Lesart B (Kai 2026-10-18): derselbe Maßstab für die Lerche – ein stehender Schild prallt den Torpedo ab, bei Schild 0 trifft er (−30 Hülle)
  g.god = false; for (let i = 0; i < 4; i++) g.ship.shields.current[i] = 4;
  const i0 = isum(g);
  const ab0 = g.stats.torpedoAbgeprallt || 0;
  space.etorpedoTreffer(g, { x: g.ship.x + 30, y: g.ship.y, dmg: CONFIG.systemModell.torpedoLerche });
  ok(isum(g) === i0 && g.ship.shields.current.every((v) => v === 4) && g.stats.torpedoAbgeprallt === ab0 + 1, 'Gegner-Torpedo am stehenden Schild: abgeprallt (Integrität unberührt, Schilde unberührt)');
  for (let i = 0; i < 4; i++) g.ship.shields.current[i] = 0;
  const i1 = isum(g);
  space.etorpedoTreffer(g, { x: g.ship.x + 30, y: g.ship.y, dmg: CONFIG.systemModell.torpedoLerche });
  ok(near2(i1 - isum(g), CONFIG.systemModell.torpedoLerche), `Gegner-Torpedo bei Schild 0: ein Treffer −${f2(i1 - isum(g))} Integrität (Torpedo ${CONFIG.systemModell.torpedoLerche})`);
  const i2 = isum(g); g.ship.lastDodgeT = g.time;
  space.etorpedoTreffer(g, { x: g.ship.x + 30, y: g.ship.y, dmg: CONFIG.systemModell.torpedoLerche });
  ok(isum(g) === i2, 'Gegner-Torpedo direkt nach der Ausweichrolle: verfehlt');
});

section('Torpedo: Gegner tragen ihn nur gezielt', () => {
  const T = arena(); const g = T.g;
  ok(T.debug('spawn', 'korvette bug=torpedowerfer').some((x) => /Seitenpl/.test(x)) && g.space.enemies.length === 0, 'Gegner-Torpedo am Bug wird abgelehnt (nur Seitenplätze: der Bug zeigt nie auf die Lerche)');
  const r = T.debug('spawn', 'korvette bug=standardkanone stbd=torpedowerfer bb=sturmbatterie');
  const e = g.space.enemies[0];
  ok(r.length === 0 && e && e.waffen.bug === 'standardkanone' && e.waffen.stbd === 'torpedowerfer' && e.waffen.bb === 'sturmbatterie', 'Debug spawn mit Katalogwaffen je Platz');
  const vq = space.spawnEnemy(g, 'korvette', { x: 100, y: 100, waffen: { bug: 'torpedowerfer', stbd: 'lanze', bb: 'lanze' } });
  ok(vq.waffen.bug !== 'torpedowerfer', 'Regiebuch/Spawn mit Torpedo am Bug: Vorgabe wird verworfen (Seitenplatz-Regel), kein Torpedo am Bug');
  ok(T.debug('spawn', 'korvette bug=quatsch').length === 1, 'unbekannte Waffe wird abgelehnt');
  // nie Zufall
  const arten = new Set();
  for (let i = 0; i < 80; i++) { const q = space.spawnEnemy(g, i % 2 ? 'fregatte' : 'korvette', { x: 100 + i, y: 100 }); for (const v of Object.values(q.waffen)) arten.add(v); }
  ok([...arten].sort().join() === 'batterie,bolzen,lanze', 'Zufallsbestückung bleibt bei lanze | batterie | bolzen (Torpedo nie Zufall): ' + [...arten].sort().join());
  // feuert
  g.space.enemies = [];
  const k = space.spawnEnemy(g, 'korvette', { x: g.ship.x + 250, y: g.ship.y, facing: Math.PI / 2, waffen: { bug: 'standardbatterie', stbd: 'torpedowerfer', bb: 'standardbatterie' } });   // Breitseite zur Lerche: Steuerbord zeigt nach Westen
  k.torpG = 99; g.god = false;
  const nullSchild = () => { for (let i = 0; i < 4; i++) g.ship.shields.current[i] = 0; };
  let sah = false, h0 = 0;
  for (let i = 0; i < 30 * 12; i++) {
    k.x = g.ship.x + 250; k.y = g.ship.y; k.angle = Math.PI / 2; k.fireT = -999; k.boltT = -999; if (k.sf) k.sf.t = -999; nullSchild();
    if (g.space.projectiles.some((q) => q.kind === 'etorpedo')) { sah = true; if (!h0) h0 = isum(g); }
    g.step();
    if (sah && isum(g) < h0) break;
  }
  ok(sah && g.stats.torpedoLerche === 1 && near2(h0 - isum(g), CONFIG.systemModell.torpedoLerche), 'Gegner-Torpedo fliegt auf die Lerche und trifft: Integrität −' + f2(h0 - isum(g)) + ' (Torpedo ' + CONFIG.systemModell.torpedoLerche + ', ein System der Zone)');
  // Abwehrturm schießt ihn ab
  const T2 = arena(); const g2 = T2.g; T2.debug('ausbau', '2'); T2.debug('bestueck', '2 abwehrturm'); g2.ship.mount.p2.charge = 1;
  g2.space.projectiles.push({ id: 'prx1', kind: 'etorpedo', x: g2.ship.x - 140, y: g2.ship.y, angle: 0, speed: 100, ttl: 5, dmg: 6, owner: 'e0' });
  g2.players[0].console = null;   // Taktik unbesetzt: Abwehrturm schießt allein
  const h = isum(g2);
  T2.run(3);
  ok(!g2.space.projectiles.some((q) => q.kind === 'etorpedo') && isum(g2) === h && g2.stats.torpedosAbgeschossen === 1, 'Abwehrturm schießt den anfliegenden Torpedo ab (Integrität unberührt)');
});

section('Sturmbatterie: Schild regeneriert nicht, Systemschaden bei niedrigem Schild', () => {
  const T = arena(); const g = T.g; const w = Katalog.waffe('sturmbatterie');
  T.debug('bestueck', '4 sturmbatterie');
  const e = gegner(T, 'korvette', 0, -250, { schild: true, hp: 9999 }); e.shields = [2, 2, 2, 2]; e.angle = Math.PI / 2;   // Backbord der Lerche, Bug zur Lerche gedreht
  e.pin.angle = e.angle;
  g.ship.target = e.id;
  const sec = Physics.sectorOf(e.x, e.y, e.angle, g.ship.x, g.ship.y);
  e.shields = [0, 0, 0, 0]; e.shields[sec] = 4; e.shieldsMax = [4, 4, 4, 4];
  const s0 = e.shields[sec], hp0 = e.hp;
  g.ship.mount.port.charge = 1;
  T.cmd(0, 'weapons.fire', { mount: 'port' });
  lauf(T, 1.5);
  const nSchild = Math.round((s0 - e.shields[sec]) / (w.schaden * w.sturm.schildFaktor));   // Projektile: nicht jede Nadel trifft, jede Trefferzahl ist ein Vielfaches
  ok(e.hp === hp0 && nSchild >= Math.ceil(w.rohre * 0.6) && nSchild <= w.rohre && near(s0 - e.shields[sec], nSchild * w.schaden * w.sturm.schildFaktor, 1e-6), `hoher Schild (${s0}): ${nSchild} von ${w.rohre} Nadeln treffen, nehmen nur ${(s0 - e.shields[sec]).toFixed(2)} Schild und nichts von der Hülle`);
  const nach = e.shields[sec];
  ok(e.regenHold > g.time - 2 && e.regenHold > 0, 'Sturm setzt die Regenerationssperre (' + w.sturm.regenSperre + ' s)');
  lauf(T, 5.2);
  ok(e.shields[sec] <= nach + 1e-9, 'Schild regeneriert nicht, solange gehalten wird (' + nach.toFixed(2) + ' -> ' + e.shields[sec].toFixed(2) + ')');
  lauf(T, w.sturm.regenSperre + 5.5);
  ok(e.shields[sec] > nach, 'danach regeneriert er wieder');
  // niedriger Schild: Treffer gehen in die Hülle, das Ziel wird gestört
  e.shields[sec] = 0; e.fireT = 5; const hp1 = e.hp;
  g.ship.mount.port.charge = 1; T.cmd(0, 'weapons.fire', { mount: 'port' });
  lauf(T, 1.5, () => { e.fireT = Math.max(e.fireT, 5); });
  const nHuelle = Math.round((hp1 - e.hp) / w.schaden);
  ok(e.hp < hp1 && nHuelle >= Math.ceil(w.rohre * 0.6) && nHuelle <= w.rohre && near(hp1 - e.hp, nHuelle * w.schaden, 1e-6), `niedriger Schild: Hülle −${(hp1 - e.hp).toFixed(1)} (${nHuelle} von ${w.rohre} Nadeln treffen, je ${w.schaden})`);
  // Lerche als Ziel (Gegner-Sturm)
  g.god = false; g.ship.shields.current = [4, 4, 4, 4];
  space.shipHit(g, 0, 0.15, { sperrfeuer: true, sturm: true });
  ok(g.ship.shields.regenHold > g.time && g.ship.shields.current[0] > 3.8, 'Gegner-Sturm gegen die Lerche: hoher Schild fast unberührt, Regeneration gesperrt');
  // SYS-01 A1a: niedriger Schild = 1 Punkt (ST.niedrig); ohne Schild trifft jeder Treffer ein System, das ist eine andere Regel
  let sys = 0;
  for (let i = 0; i < 400; i++) { require('../server/sim/interior.js').integritaetVoll(g); for (const k of Object.keys(g.ship.systems)) g.ship.systems[k] = 'ok'; g.ship.shields.current[1] = 1; const i0 = isum(g); space.shipHit(g, 1, 0.15, { sperrfeuer: true, sturm: true }); if (isum(g) < i0) sys++; }
  ok(Math.abs(sys / 400 - w.sturm.systemChance) < 0.04, `niedriger Schild: Sturm trifft Systeme (${sys} von 400 Nadeln, ${(100 * sys / 400).toFixed(1)} %, Soll ${(100 * w.sturm.systemChance).toFixed(0)} % ± 4)`);
});

section('Streubatterie: eine = Schildschaden, zwei = sicherer Systemschaden', () => {
  const T = arena(); const g = T.g; const w = Katalog.waffe('streubatterie'); const S = w.streu;
  const e = gegner(T, 'korvette', 0, 0, { schild: true, hp: 9999 }); e.shields = [3, 3, 3, 3];
  const boom = () => Waffen.streuExplosion(g, { x: e.x, y: e.y, dmg: w.schaden, kind: 'streu', mount: 'p7' });
  const hp0 = e.hp;
  boom();
  ok(e.hp === hp0 && e.shields.every((v) => v === 3 - w.schaden * S.schildFaktor || v === 3) && e.shields.some((v) => v < 3), `eine Granate: Schildschaden (${e.shields.map((v) => v.toFixed(1))}), Hülle unberührt`);
  T.run(0.5);
  e.fireT = 3; const h1 = e.hp;
  boom();
  ok(e.hp === h1 - S.durchschlag && e.fireT < 3, `zweite Granate im Fenster (${S.fenster} s): sicherer Systemschaden – Hülle −${S.durchschlag} am Schild vorbei, Ziel gestört`);
  T.run(S.fenster + 0.5);
  const h2 = e.hp; boom();
  ok(e.hp === h2, 'nach dem Fenster zählt eine Granate wieder als erste (nur Schild)');
  // Salve der Streubatterie: Granaten, verzögert, gefächert
  T.debug('bestueck', '4 streubatterie');
  const z = gegner(T, 'korvette', 0, -250, { hp: 9999 }); g.ship.target = z.id; g.ship.mount.port.charge = 1;
  T.cmd(0, 'weapons.fire', { mount: 'port' });
  T.run(0.1);
  lauf(T, 1.2);
  const gren = g.space.projectiles.filter((q) => q.kind === 'streu');
  ok(gren.length === w.rohre && g.space.projectiles.every((q) => q.kind !== 'bolzen'), `Salve = ${w.rohre} Granaten als Projektile (kind streu), keine Sofortstrahlen`);
  const mkind = snapMount(T, 'port');
  ok(mkind.typ === 'streubatterie' && mkind.salvoMax === w.rohre, 'Snapshot: typ streubatterie, salvoMax ' + w.rohre);
  const booms = g.ev ? 0 : events(T, 'explosion').length;
  lauf(T, S.zuend + 0.3);
  ok(T.ev('explosion').some((x) => x.small), 'Granaten explodieren verzögert (explosion, small)' + (booms ? '' : ''));
  // Lerche als Ziel
  g.god = false; g.ship.shields.current = [4, 4, 4, 4]; g.ship.systems.reactor = 'ok';
  const i5 = isum(g);
  const gp = (dx) => ({ x: g.ship.x + dx, y: g.ship.y, dmg: w.schaden, kind: 'estreu' });
  space.estreuExplosion(g, gp(10));
  ok(isum(g) === i5 && g.ship.shields.current.some((v) => v < 4), 'Gegner-Granate: eine = Schildschaden');
  const sys0 = Object.values(g.ship.systems).filter((v) => v !== 'ok').length;
  T.run(0.3); space.estreuExplosion(g, gp(10));
  const sys1 = Object.values(g.ship.systems).filter((v) => v !== 'ok').length;
  ok(isum(g) < i5 && sys1 >= sys0, `Gegner-Granate: zwei im Fenster = Integrität −${f2(i5 - isum(g))} (Systeme mit Schaden ${sys0} -> ${sys1})`);
});
function events(T, kind) { return T.events.filter((e) => e.kind === kind); }

section('Lanzenbatterie: wie die Lanze, zwei Strahlen, Schaden einmal', () => {
  const T = arena(); const g = T.g; T.debug('ausbau', '1'); T.debug('bestueck', '7 lanzenbatterie');
  const m7 = snapMount(T, 'p7');
  ok(m7.typ === 'lanzenbatterie' && m7.facing === -90 && m7.arc === Katalog.waffe('lanzenbatterie').bogen && m7.charging === false && m7.alloc >= 0, 'Snapshot: Lanzenbatterie auf Platz 7, Backbord, Bogen ' + m7.arc);
  const e = gegner(T, 'korvette', 20, -300, { hp: 9999 });   // Backbord (−y), vor der Mitte (Versatz Platz 7: vorn)
  const tr = Waffen.lanceTrace(g, 'p7');
  e.pin = { x: tr.o.x + tr.dx * 300, y: tr.o.y + tr.dy * 300, angle: 0 }; pin(g);
  g.ship.mount.p7.alloc = 4; g.ship.wAllocIntent = { bow: 0, port: 0, stbd: 0, p7: 4 };
  g.ship.mount.p7.charge = 1;   // Magazindeckel (27) lässt die Lanzenbatterie neben Lanze und zwei Batterien nicht gefüllt starten; geprüft wird das Aufladen
  T.cmd(0, 'weapons.charge', { mount: 'p7', on: true });
  ok(g.ship.mount.p7.charging === true, 'weapons.charge p7: Aufladen beginnt (Kurs halten)');
  lauf(T, 2.5);
  ok(snapMount(T, 'p7').power >= 0.99, 'Aufladung voll (' + snapMount(T, 'p7').power + ')');
  const hp0 = e.hp; let beams = [];
  T.cmd(0, 'weapons.charge', { mount: 'p7', on: false });
  beams = g.space.beams.filter((b) => b.kind === 'lance' && b.mount === 'p7');
  pin(g); T.run(DT);
  ok(beams.length === 2 && near(Math.hypot(beams[0].x1 - beams[1].x1, beams[0].y1 - beams[1].y1), 2 * Katalog.waffe('lanzenbatterie').lanze.abstand, 0.5), 'optisch zwei parallele Lanzenstrahlen (Beams mit mount p7)');
  ok(near(hp0 - e.hp, CONFIG.spaceM3.lance.maxDamage, 0.01), `Schaden einmal: ${f1x(hp0 - e.hp)} (Lanze bei voller Ladung ${CONFIG.spaceM3.lance.maxDamage}, nicht doppelt)`);
  ok(T.ev('lance').some((x) => x.state === 'fire' && x.mount === 'p7'), 'Ereignis lance trägt die Halterung');
});

section('Abwehrturm: Jäger im Überflug, dreht sich selbst, unbesetzt schwach automatisch', () => {
  const T = arena(); const g = T.g; T.debug('ausbau', '2'); T.debug('bestueck', '2 abwehrturm');
  const tm = snapMount(T, 'p2');
  ok(tm.typ === 'abwehrturm' && tm.arc === 360 && tm.alloc >= 0 && tm.salvoMax === Katalog.waffe('abwehrturm').rohre, 'Snapshot: Abwehrturm auf Heck 2, 360 Grad, Energiewaffe');
  const j = gegner(T, 'raider', 120, 100, { hp: 9999 });   // vorn, nicht im Heckbogen: er dreht sich selbst
  const k = gegner(T, 'korvette', 110, -100, { hp: 9999 });
  g.ship.mount.p2.charge = 1; g.ship.mount.p2.alloc = 1; g.ship.wAllocIntent = { bow: 1, port: 1, stbd: 1, p2: 1 };
  T.cmd(0, 'weapons.fire', { mount: 'p2' });
  lauf(T, 1);
  ok(j.hp < 9999 && k.hp === 9999, `besetzt auf Befehl: der Turm trifft den Jäger rundum (${f1x(9999 - j.hp)} Schaden), die Korvette nicht`);
  // unbesetzt: automatisch, aber langsam
  g.players[0].console = null; g.ship.mount.p2.charge = 1; const h0 = j.hp;
  lauf(T, 1);
  ok(j.hp < h0, 'unbesetzte Taktik: der Turm schießt allein auf den Jäger (' + f1x(h0 - j.hp) + ')');
  const c0 = g.ship.mount.p2.charge;
  const tAuto = Waffen.chargeTime(g, 'p2');
  g.players[0].console = 'weapons';
  const tBesetzt = Waffen.chargeTime(g, 'p2');
  ok(tAuto > tBesetzt * 1.9, `ohne Taktik lädt er langsamer (${tAuto.toFixed(1)} s statt ${tBesetzt.toFixed(1)} s): „schwach automatisch“`);
  void c0;
  // kein Jäger in Reichweite: nichts
  g.space.enemies = []; g.ship.mount.p2.charge = 1; g.ship.mount.p2.salvo = 0;
  ok(T.cmd(0, 'weapons.fire', { mount: 'p2' }).some((x) => /kein Jäger/.test(x)), 'ohne Jäger in Reichweite: Hinweis, kein Schuss');
});

section('Seiten verschieden bestückt, Navigation sieht es', () => {
  const T = arena(); const g = T.g;
  T.debug('bestueck', '4 sturmbatterie'); T.debug('bestueck', '6 streubatterie');
  const sh = snapShip(T);
  const bb = sh.mounts.find((m) => m.id === 'port'), stb = sh.mounts.find((m) => m.id === 'stbd');
  ok(bb.typ === 'sturmbatterie' && stb.typ === 'streubatterie' && bb.facing === -90 && stb.facing === 90, 'Snapshot: Bb Sturm, Stb Streu – je Seite die eigene Waffe');
  ok(bb.salvoMax === 1 && stb.salvoMax === 3 && bb.range !== stb.range, 'unterschiedliche Werte je Seite (Rohre ' + bb.salvoMax + '/' + stb.salvoMax + ', Reichweite ' + bb.range + '/' + stb.range + '; SYS-01 B1: Sturm ein Projektil je Zyklus)');
  const e1 = gegner(T, 'korvette', 0, -250, { hp: 9999, schild: true }); const e2 = gegner(T, 'korvette', 0, 250, { hp: 9999 });
  e1.shields = [0, 0, 0, 0];
  T.cmd(0, 'weapons.fire', { mount: 'all' });
  const kinds = new Set(), syms = new Set();
  lauf(T, 1, () => { for (const q of g.space.projectiles) kinds.add(q.kind); });
  ok(kinds.has('streu') && kinds.has('psturm') && g.space.beams.length === 0, 'Steuerbord wirft Granaten (Projektil streu), Backbord feuert Nadeln (Projektil psturm), kein Strahl');
  ok(e1.hp < 9999 && e2.hp === 9999, 'Sturm trifft auf Backbord, die Granaten brauchen noch (Zündzeit)');
  // Kenntnis in der Kennung: Katalog liefert Namen und Symbol
  ok(Katalog.waffe(bb.typ).name === 'Sturmbatterie' && Katalog.waffe(stb.typ).name === 'Streubatterie' && Katalog.waffe(bb.typ).symbol !== Katalog.waffe(stb.typ).symbol, 'Namen und Symbole je Seite verschieden (Taktik beschriftet je Seite)');
});

section('Gegner aus demselben Katalog, Ziel-Scan zeigt Waffen und Module', () => {
  const T = arena(); const g = T.g;
  const alle = new Set(); let ungueltig = 0;
  for (let i = 0; i < 90; i++) {
    const kind = ['korvette', 'fregatte', 'kreuzer'][i % 3];
    const e = space.spawnEnemy(g, kind, { x: 200 + i, y: 200 });
    for (const [platz, v] of Object.entries(e.waffen)) { const ein = Katalog.eintragVon(v, platz); if (!ein) ungueltig++; else alle.add(ein.id); }
  }
  ok(ungueltig === 0, 'jede Gegner-Bestückung lässt sich auf einen Katalogeintrag abbilden');
  ok([...alle].every((id) => ['lanze', 'lanzenbatterie', 'standardbatterie', 'standardkanone'].includes(id)), 'Zufallsbestückung -> Lanze/Lanzenbatterie/Standardbatterie/Standardkanone (' + [...alle].sort().join(', ') + ')');
  ok(Katalog.eintragVon('lanze', 'bug').id === 'lanze' && Katalog.eintragVon('lanze', 'stbd').id === 'lanzenbatterie' && Katalog.eintragVon('batterie', 'bb').id === 'standardbatterie' && Katalog.eintragVon('batterie', 'bug').id === 'standardkanone' && Katalog.eintragVon('bolzen', 'bug').id === 'standardkanone', 'Abbildung: lanze -> Lanze (Bug) / Lanzenbatterie (Seite), batterie und bolzen -> Standardbatterie (Seite) / Standardkanone (Bug)');
  ok(Katalog.verhaltenVon('lanze') === 'lanze' && Katalog.verhaltenVon('batterie') === 'batterie' && Katalog.verhaltenVon('bolzen') === 'bolzen' && Katalog.verhaltenVon('sturmbatterie') === 'sturm' && Katalog.verhaltenVon('streubatterie') === 'streu' && Katalog.verhaltenVon('torpedowerfer') === 'torpedo', 'Verhalten je Waffe (Golden: die drei Altarten bleiben unverändert)');
  // Labor-/Regiebuch-Pfad: spawn mit waffen
  g.space.enemies = [];
  g.mission.spawn({ kind: 'korvette', waffen: { bug: 'abwehrturm', stbd: 'streubatterie', bb: 'sturmbatterie' }, n: 1 });
  const e = g.space.enemies[0];
  ok(e && e.waffen.stbd === 'streubatterie' && e.waffen.bb === 'sturmbatterie', 'Regiebuch/Labor: spawn mit waffen { Platz: Katalog-Id }');
  // Ziel-Scan
  const sh = g.ship; e.x = sh.x + 300; e.y = sh.y; e.scanned = false;
  let s = g.snapshot().space.enemies.find((q) => q.id === e.id);
  ok(s.weapons === null, 'ungescannt: keine Waffen im Snapshot');
  e.scanned = true;
  s = g.snapshot().space.enemies.find((q) => q.id === e.id);
  ok(Array.isArray(s.weapons) && s.weapons.length === 3 && s.weapons.some((w) => w.typ === 'streubatterie') && s.weapons.every((w) => Katalog.eintragVon(w.typ, w.platz)), 'gescannt: Waffen je Platz mit Typ im Snapshot (' + s.weapons.map((w) => w.platz + ':' + w.typ).join(' ') + ')');
  ok(Katalog.moduleFuerKlasse(e.kind).join() === 'werkstatt', 'Module der Klasse für den Zielkasten: ' + Katalog.moduleFuerKlasse(e.kind).join());
  // Snapshot-Größe der Gegner mit Waffen (Budget)
  const pro = Buffer.byteLength(JSON.stringify(s.weapons));
  info('Ziel-Scan Waffen eines Gegners: ' + pro + ' B im Snapshot (nur gescannte Ziele)');
});

section('Weltstand: Bestückung, Altstände', () => {
  const dir = freshDir();
  const T = setup('free', { dir });
  T.run(0.3);
  const id = T.g.weltstand.id;
  T.debug('ausbau', '3'); T.debug('bestueck', 'alle 3');
  T.debug('bestueck', '4 sturmbatterie'); T.debug('bestueck', '6 streubatterie'); T.debug('bestueck', '2 abwehrturm'); T.debug('bestueck', '5 lanze'.replace('5 lanze', '5 standardkanone'));
  const data = Weltstand.capture(T.g);
  ok(Weltstand.validate(data).length === 0, 'Weltstand mit Bestückung ist schemagültig');
  ok(data.schiff.waffen['4'] === 'sturmbatterie' && data.schiff.waffen['6'] === 'streubatterie' && data.schiff.waffen['2'] === 'abwehrturm' && data.schiff.waffen['8'] === 'lanze' && Object.keys(data.schiff.waffen).length === 9, 'schiff.waffen: ' + JSON.stringify(data.schiff.waffen));
  ok(JSON.stringify(data.schiff.waffen).length < 300, 'schiff.waffen klein (' + JSON.stringify(data.schiff.waffen).length + ' B)');
  const file = path.join(dir, id + '.json');
  T.send({ t: 'menu', op: 'end' });
  const basis = JSON.parse(fs.readFileSync(file, 'utf8'));
  const lade = (d) => { fs.writeFileSync(file, JSON.stringify(d)); const L = setup('free', { dir, world: id }); L.run(0.3); return L; };
  const L = lade(basis);
  ok(JSON.stringify(Waffen.toSave(L.g)) === JSON.stringify(basis.schiff.waffen) && L.g.ship.stufe === 3, 'Roundtrip: Laden ergibt dieselbe Bestückung und Stufe');
  ok(Waffen.mountIds(L.g).length === 9 && snapMount(L, 'port').typ === 'sturmbatterie' && snapMount(L, 'stbd').typ === 'streubatterie', 'geladen: neun Mounts, Seiten verschieden bestückt');
  L.send({ t: 'menu', op: 'end' });
  // Altstand ohne schiff.waffen: Startbestückung
  const alt = JSON.parse(JSON.stringify(basis)); delete alt.schiff.waffen; alt.schiff.stufe = 0; alt.schiff.ausbauten = [];
  const A = lade(alt);
  ok(JSON.stringify(Waffen.toSave(A.g)) === JSON.stringify({ 4: 'standardbatterie', 6: 'standardbatterie', 8: 'lanze' }) && JSON.stringify(Waffen.mountIds(A.g)) === '["bow","port","stbd"]', 'Altstand ohne schiff.waffen: Startbestückung 8 Lanze · 4 und 6 Standardbatterie ' + JSON.stringify(Waffen.toSave(A.g)));
  A.send({ t: 'menu', op: 'end' });
  // Altstand mit Bolzenwerfer, Zusatzrohren und zu vielen Torpedos: nichts geht verloren
  const alt2 = JSON.parse(JSON.stringify(basis)); delete alt2.schiff.waffen; alt2.schiff.stufe = 0; alt2.schiff.ausbauten = ['bolzenwerfer', 'seitenturm']; alt2.schiff.marken = 100; alt2.schiff.lager.bolzen = 20;
  const B = lade(alt2); const b = B.g;
  ok(b.ship.stufe === 2 && b.ship.waffen[2] === 'torpedowerfer' && Waffen.mountIds(b).includes('p2'), 'Altstand mit Bolzenwerfer: Stufe auf 2 angehoben, Torpedowerfer auf Heck 2 (kein Verlust)');
  ok(b.inventory.marks === 100 + 300 + 8 * 10 && b.inventory.bolzen === 12, 'Zusatzrohre (300) und Torpedos über dem Limit (8 × 10) erstattet: Marken ' + b.inventory.marks + ', Lager ' + b.inventory.bolzen);
  B.send({ t: 'menu', op: 'end' });
  // Migration idempotent: derselbe Altstand zweimal geladen (ohne Spielende dazwischen) zahlt die Erstattung nur einmal
  fs.writeFileSync(file, JSON.stringify(alt2));
  const M1 = setup('free', { dir, world: id }); M1.run(0.3); const marken1 = M1.g.inventory.marks;
  const M2 = setup('free', { dir, world: id }); M2.run(0.3);
  ok(marken1 === 480 && M2.g.inventory.marks === 480 && M2.g.inventory.bolzen === 12, `Altstand zweimal geladen: Marken ${marken1} und ${M2.g.inventory.marks} (Erstattung einmalig)`);
  const bad = JSON.parse(JSON.stringify(basis)); bad.schiff.waffen['4'] = 'quatsch';
  ok(Weltstand.validate(bad).length > 0, 'Schema lehnt unbekannte Waffe ab');
  const bad2 = JSON.parse(JSON.stringify(basis)); bad2.schiff.waffen['0'] = 'lanze';
  ok(Weltstand.validate(bad2).length > 0, 'Schema lehnt Platz 0 ab');
  // Speichern mit Torpedos, Altstand ohne Bestückung auf pan01-b-Stufe 1 (Plätze 7 und 9 offen, unbestückt)
  const alt3 = JSON.parse(JSON.stringify(basis)); delete alt3.schiff.waffen; alt3.schiff.stufe = 1; alt3.schiff.ausbauten = [];
  const C3 = lade(alt3);
  ok(C3.g.ship.stufe === 1 && Waffen.mountIds(C3.g).length === 3 && !C3.g.ship.waffen[7], 'pan01-b-Stand (Stufe 1 ohne Bestückung): offene Plätze 7 und 9 bleiben frei, Start 8/4/6 aktiv');
  C3.send({ t: 'menu', op: 'end' });
});

section('Snapshot-Budget mit neun Waffen', () => {
  const T = arena(); const g = T.g;
  // der Gesamt-Snapshot schwankt mit seinen Slots (Welt, Logbuch, Asteroiden): verglichen wird der Block ship (Waffen, Systeme, Verteilung)
  const sz = (o) => Buffer.byteLength(JSON.stringify(o));
  const s0 = snapShip(T); const b0 = sz(s0);
  T.debug('bestueck', 'alle 3');
  T.debug('bestueck', '4 sturmbatterie'); T.debug('bestueck', '7 streubatterie'); T.debug('bestueck', '9 lanzenbatterie'); T.debug('bestueck', '2 abwehrturm');
  const s9 = snapShip(T); const b9 = sz(s9);
  const gesamt = sz(g.snapshot());
  ok(b9 - b0 < 1100 && b9 > b0, `neun Waffen (gemischt) kosten ${b9 - b0} B mehr im Block ship (Start ${b0} B, voll ${b9} B; Mounts ${sz(s0.mounts)} -> ${sz(s9.mounts)} B, Systeme ${sz(s0.systems)} -> ${sz(s9.systems)} B)`);
  ok(gesamt <= 18944 - 1100 && gesamt <= 18944, `Gesamt-Snapshot mit neun Waffen ${gesamt} B ≤ Ziel 18 944 B (Worst Case der Messung: snap:mess)`);
});

section('Review-Fixes: Zustandsfaktor, Magazin im einseitigen Gefecht, Abwehrturm-Automatik, Torpedo-Schild, Lager', () => {
  // H1: beschädigte Standardbatterie lädt wie vor PAN-01 C (kein Zeitfaktor, nur weniger Rohre); Lanzen behalten 1,5
  const T = arena(); const g = T.g;
  const P = CONFIG.spaceM3.mounts.port;
  g.ship.systems.battery_port = 'damaged';
  const al = g.ship.mount.port.alloc;
  const nl = Katalog.waffe('standardbatterie').nachlauf || 0;   // SYS-01 B1 Nacharbeit: Zyklus = Ladekosten / Punkte + Nachlauf
  ok(near(Waffen.chargeTime(g, 'port'), P.secPerPoint / al + nl, 1e-9) && !P.damagedFactor, `beschädigte Standardbatterie lädt wie vor PAN-01 C (${Waffen.chargeTime(g, 'port').toFixed(2)} s = ${P.secPerPoint} / ${al} + ${nl}), ohne Faktor`);
  ok(Waffen.rohre(g, 'port') === P.tubesDamaged, 'beschädigt: ' + P.tubesDamaged + ' Rohre');
  g.ship.systems.weapon_bow = 'damaged';
  ok(near(Waffen.chargeTime(g, 'bow'), CONFIG.spaceM3.mounts.bow.secPerPoint / g.ship.mount.bow.alloc * 1.5, 1e-9), 'beschädigte Lanze lädt 1,5× so langsam (wie bisher)');
  // Torpedo: beschädigte Lafette verdoppelt nichts still – Katalogfaktor
  ok(Katalog.TORPEDO.kaputtFaktor === 1.5, 'Torpedo: beschädigter Werfer ×' + Katalog.TORPEDO.kaputtFaktor + ' Cooldown (Katalogwert; Triebwerk und Energie wirken nie)');

  // H2: Magazin blockiert keine Ladepunkte: volle Reserve-Waffen geben Platz frei, ausgefallene belegen nichts
  const U = arena(); const h = U.g;
  U.debug('bestueck', 'alle 3');
  const ids = Waffen.energieMounts(h).map((a) => a.id);
  h.ship.wAllocIntent = { bow: 1, port: 1, stbd: 1, p5: 1 };
  for (const id of ids) h.ship.mount[id].charge = 0;
  for (const id of ['p7', 'p9', 'p1', 'p3']) h.ship.mount[id].charge = 1;   // volle Reserve (keine Punkte): 4 × 6 = 24
  for (const id of ['bow', 'port']) h.ship.mount[id].charge = 0.5;          // belegen 12 + 6
  U.run(0.2);
  const b0 = h.ship.mount.stbd.charge;
  U.run(8);
  ok(h.ship.mount.stbd.charge > b0 && !h.ship.mount.stbd.blk && h.ship.mount.p5.charge > 0, 'Waffe mit Ladepunkten lädt, die volle Reserve ohne Punkte macht Platz (kein Stillstand): stbd ' + h.ship.mount.stbd.charge.toFixed(2));
  ok(Waffen.vorrat(h) <= Katalog.MAGAZINDECKEL.stossMax + 1e-6, 'Anfangsstoß-Deckel bleibt: ' + Waffen.vorrat(h).toFixed(1) + ' ≤ ' + Katalog.MAGAZINDECKEL.stossMax);
  // ausgefallene Waffe belegt nichts
  const V = arena(); const v = V.g; V.debug('bestueck', 'alle 3');
  for (const id of ['p7', 'p9', 'p1', 'p3', 'p5']) v.ship.mount[id].charge = 1;
  const r0 = Waffen.reserviert(v);
  v.ship.systems.lafette_7 = 'broken';
  ok(Waffen.reserviert(v) === r0 - Katalog.volley('standardbatterie'), 'ausgefallene Waffe belegt kein Magazin');
  // einseitiges Gefecht: Gegner nur Steuerbord, Waffen feuern bereit: Dauerfeuer sinkt mit mehr Plätzen nicht deutlich
  const dauer = (n) => {
    const X = arena(); const x = X.g;
    const PRIO = [8, 4, 6, 7, 9, 5, 1, 3, 2]; const st = Math.max(0, ...PRIO.slice(0, n).map((p) => Maps.waffenplatz(p).stufe));
    Ausbau.setStufe(x, st);
    for (const p of Maps.WAFFENPLAETZE) if (st >= p.stufe) Waffen.bestuecken(x, p.platz, PRIO.slice(0, n).includes(p.platz) ? (p.platz === 8 ? 'lanze' : p.platz === 5 ? 'standardkanone' : p.platz === 2 ? 'abwehrturm' : 'standardbatterie') : 'leer');
    const e = gegner(X, 'korvette', 0, 300, { hp: 1e9 }); x.ship.target = e.id;
    const ids2 = Waffen.energieMounts(x).map((a) => a.id);
    let t = 0, d0 = 0;
    while (t < 120) {
      pin(x); Testhilfe.setzeGesamt(e, 1e9);
      for (const id of ids2) { const m = x.ship.mount[id]; const w = Waffen.waffeAn(x, id); if (w.art === 'lanze') continue; if (m.charge >= 1 && !(m.salvo > 0) && Waffen.inMountArc(x, id, e.x, e.y)) Waffen.weaponsFire(x, id); }
      x.step(); t += DT; if (Math.abs(t - 20) < DT / 2) d0 = (x.stats.waffenSchaden || { gesamt: 0 }).gesamt;
    }
    return (((x.stats.waffenSchaden || { gesamt: 0 }).gesamt) - d0) / 100;
  };
  const d3 = dauer(3), d5 = dauer(5), d9 = dauer(9);
  ok(d5 >= d3 * 0.9 && d9 >= d3 * 0.9, `einseitiges Gefecht (nur Steuerbord): Dauerfeuer 3 Waffen ${d3.toFixed(2)}, 5: ${d5.toFixed(2)}, 9: ${d9.toFixed(2)} Schaden/s – sinkt mit mehr Plätzen nicht (Magazin legt keine Punkte still)`);
  // Anzeige: blockierte Waffe meldet „Magazin voll“ (blk im Snapshot), solange nichts Platz macht
  const Z = arena(); const z = Z.g; Z.debug('bestueck', 'alle 3'); Z.debug('bestueck', '9 streubatterie');   // SYS-01 B1: Streu (Ladung 6) sprengt den Deckel 27 (Lanze 12 + 2 × 2,9 + Kanone 2,4 + Batterie 2,9 = 23,1)
  z.ship.powerIntent = { engines: 1, shields: 1, weapons: 4 }; Object.assign(z.ship.power, z.ship.powerIntent);   // 6 Ladepunkte
  z.ship.wAllocIntent = { bow: 1, port: 1, stbd: 1, p5: 1, p7: 1, p9: 1 };
  for (const id of Waffen.energieMounts(z).map((a) => a.id)) z.ship.mount[id].charge = 0;
  for (const id of ['bow', 'port', 'stbd', 'p5', 'p7']) z.ship.mount[id].charge = 1;   // alles mit Punkten gefüllt: 12+6+6+4,5+6 = 34,5, p9 (6) passt nicht
  Z.run(0.3);
  ok(z.ship.mount.p9.blk === true && snapMount(Z, 'p9').blk === 1, 'Waffe mit Punkten, die nicht ins volle Magazin passt, meldet blk (Anzeige „Magazin voll“)');

  // H3: Abwehrturm mit Standardverteilung, ohne Handeingriff: unbesetzt schießt er auf Jäger im Überflug (solo und zu dritt)
  for (const spieler of [1, 3]) {
    const A = arena({ players: spieler }); const a = A.g;
    A.debug('ausbau', '2'); A.debug('bestueck', '2 abwehrturm');
    a.players.forEach((p) => { p.console = null; });
    ok(a.ship.mount.p2.alloc >= 1, `${spieler} Spieler: dem Abwehrturm ist ein Ladepunkt reserviert (alloc ${a.ship.mount.p2.alloc}), Verteilung ${JSON.stringify(Waffen.computeAlloc(a))}`);
    gegner(A, 'raider', 100, 80, { hp: 1e9 });
    let salven = 0; const n0 = A.ev('sfx').filter((e) => e.name === 'abwehr_feuer').length;
    lauf(A, 40);
    salven = A.ev('sfx').filter((e) => e.name === 'abwehr_feuer').length - n0;
    ok(salven > 0, `${spieler} Spieler: Abwehrturm schießt unbesetzt allein (${salven} Salven in 40 s, Standardverteilung, ohne Handeingriff)`);
  }
  { const A = arena(); A.debug('ausbau', '2'); A.debug('bestueck', '2 abwehrturm'); const dist0 = JSON.stringify(Waffen.standardVerteilung(A.g));
    ok(Waffen.standardVerteilung(A.g).p2 === 1 && Object.values(Waffen.standardVerteilung(A.g)).reduce((a, b) => a + b, 0) === 4, 'Standardverteilung Stufe 2: Turm 1, der Rest reihum (' + dist0 + ')');
    const B = arena(); ok(JSON.stringify(Waffen.standardVerteilung(B.g)) === '{"bow":2,"port":1,"stbd":1}', 'Start-Lerche ohne Abwehrturm unverändert 2/1/1'); }

  // M1: Torpedo und Schild-Rätsel (Pylon, Wächter): nur bei ausgefallenem Schild; Lesart B als Katalogwert
  const Q = arena(); const q = Q.g; Q.debug('ausbau', '2'); Q.debug('bestueck', '2 torpedowerfer'); q.inventory.bolzen = 12;
  const py = gegner(Q, 'pylon', -300, 0, { schild: true, hp: 500 }); py.angle = 0; py.pin.angle = 0;   // Bug (geschützt) zur Lerche
  const sec = Physics.sectorOf(py.x, py.y, py.angle, q.ship.x, q.ship.y);
  q.ship.target = py.id;
  const feuer = () => { q.ship.mount.p2.cd = 0; Q.cmd(0, 'weapons.fire', { mount: 'p2' }); let t = 0; const c0 = q.stats.torpedoTreffer || 0; while ((q.stats.torpedoTreffer || 0) === c0 && t < 4) { pin(q); Q.run(DT); t += DT; } };
  py.shields[sec] = 4; const hp0 = py.hp; feuer();
  ok(py.hp === hp0 && py.shields[sec] === 4, 'Pylon mit Schild: der Torpedo prallt ab (Schaden 0), Schild unberührt');
  py.shields[sec] = 0; feuer();
  ok(Math.abs(py.hp - (hp0 - Katalog.torpedoSchaden('pylon'))) < 1e-6, 'Pylon mit ausgefallenem Schildsegment: Torpedo trifft ein System (−' + Katalog.torpedoSchaden('pylon') + ')');
  q.space.enemies = q.space.enemies.filter((e) => e !== py);
  const kj = gegner(Q, 'korvette', -300, 0, { schild: true, hp: 220 }); kj.shieldsMax = [3, 3, 3, 3]; kj.angle = 0; kj.pin.angle = 0; q.ship.target = kj.id;
  const sk = Physics.sectorOf(kj.x, kj.y, kj.angle, q.ship.x, q.ship.y); kj.shields[sk] = 3; const kh = kj.hp; feuer();
  ok(kj.hp === kh, 'Lesart B gilt für alle Ziele (kein Sonderfall Pylon/Wächter): Korvette mit stehendem Schild -> Schaden 0');
  kj.shields[sk] = 0; const kh2 = kj.hp; feuer();
  ok(Math.abs(kj.hp - (kh2 - 9)) < 1e-6, 'Lesart B: ausgefallenes Schildsegment -> Treffer (−9)');
  Katalog.TORPEDO.schildUmgehung = 'immer';   // nur noch Testschalter (Lesart A)
  kj.shields[sk] = 3; q.ship.target = kj.id; const kh3 = kj.hp; feuer();
  ok(Math.abs(kj.hp - (kh3 - 9)) < 1e-6, 'Testschalter Lesart A (immer): Korvette mit Schild wird getroffen (−9)');
  Katalog.TORPEDO.schildUmgehung = 'nur-ohne-schild';

  // M3: Torpedo-Lager hart 12 auch bei Funden; Überhang wird zu Marken
  const L = arena(); const l = L.g; l.inventory.bolzen = 12; const mk = l.inventory.marks;
  const txt = l.explore.reward({ marks: 30, items: { bolzen: 4 } });
  ok(l.inventory.bolzen === 12 && l.inventory.marks === mk + 30 + 40 && /0× Torpedo/.test(txt), 'Fundbelohnung bei vollem Lager: 12 bleibt, 4 Torpedos als 40 Marken (' + txt + ')');
  ok(L.events.some((e) => e.kind === 'oda' && /Torpedolager voll/.test(e.text || '')), 'ODA sagt, dass das Lager voll ist');
  l.inventory.bolzen = 10; l.explore.reward({ items: { bolzen: 4 } });
  ok(l.inventory.bolzen === 12, 'Fund bei 10: 2 passen, 2 Überhang -> Lager 12');
  ok(!/Bolzen/.test(require('../shared/locations.js').get('b7') ? JSON.stringify(require('../shared/locations.js').get('b7').hidden || '') : ''), 'Kistentext sagt Torpedos statt Bolzen');

  // L3: inaktive Waffensysteme zählen im Altnamen weapons nicht
  const W3 = arena(); const w3 = W3.g; W3.debug('ausbau', '3'); W3.debug('bestueck', 'alle 3'); w3.ship.systems.lafette_7 = 'broken';
  ok(w3.ship.systems.weapons === 'broken', 'aktive Lafette zerstört: weapons = broken');
  W3.debug('ausbau', '0');
  ok(w3.ship.systems.weapons === 'ok' && w3.ship.systems.lafette_7 === 'ok', 'Platz zu (Stufe 0): inaktive Lafette steht heil da, weapons = ok');
});

section('Projektile statt Sofortstrahl (Kai 2026-10-18): treffen, verfehlen, ausweichen', () => {
  // Katalog: Strahlen nur Lanze und Lanzenbatterie
  const strahl = Katalog.WAFFEN.filter((w) => w.projektil && w.projektil.strahl).map((w) => w.id).sort().join();
  ok(strahl === 'lanze,lanzenbatterie', 'Katalog: Strahl nur bei Lanze und Lanzenbatterie (' + strahl + ')');
  for (const id of ['standardbatterie', 'standardkanone', 'sturmbatterie']) {
    const w = Katalog.waffe(id);
    ok(!w.projektil.strahl && /^p/.test(w.projektil.kind) && w.geschw > 0 && w.geschw <= 900, `${id}: Projektil ${w.projektil.kind}, Geschwindigkeit ${w.geschw} px/s (langsam genug zum Ausweichen)`);
  }
  const schiess = (T, e, mount) => { const g = T.g; g.ship.target = e.id; g.ship.mount[mount].charge = 1; return T.cmd(0, 'weapons.fire', { mount }); };
  const lade = () => { const T = arena(); T.debug('bestueck', '4 standardbatterie'); return { T, g: T.g, w: Katalog.waffe('standardbatterie') }; };
  // Treffer auf ein ruhendes Ziel: Schaden je Treffer = Katalogwert
  {
    const { T, g, w } = lade();
    const e = gegner(T, 'korvette', 0, -250, { hp: 9999 }); const hp0 = e.hp;
    pin(g); schiess(T, e, 'port'); T.run(0.1); pin(g);   // vor dem ersten Schuss fixieren: ein frisch gespawntes Ziel trägt noch seine Anfangsgeschwindigkeit (der Vorhalt rechnet damit; das gäbe 75 %)
    ok(g.space.projectiles.some((q) => q.kind === 'pbatterie') && g.space.beams.length === 0, 'Batterie: Projektile (pbatterie) in der Luft, kein Strahl');
    lauf(T, 1.5);
    const n = g.stats.schussTreffer || 0; const verl = hp0 - e.hp;
    ok(n >= 1 && n <= w.rohre && near(verl, n * w.schaden, 1e-6), `Treffer ${n}/${w.rohre}: Hülle −${verl} = ${n} × ${w.schaden} (Katalogwert je Treffer, ein Projektil je Zyklus)`);
    ok(n / (g.stats.schuesse || 1) > 0.5, 'ruhendes Ziel: Trefferquote ' + Math.round(100 * n / (g.stats.schuesse || 1)) + ' %');
  }
  // Trefferquote auf ein ruhendes Ziel (Korvette, 250 px): je Klasse gemessen, im Contract §9 genannt
  for (const [mid, wid, bm] of [['port', 'standardbatterie', '4 standardbatterie'], ['port', 'sturmbatterie', '4 sturmbatterie'], ['bow', 'standardkanone', '8 standardkanone']]) {
    const T = arena(); const g = T.g; T.debug('bestueck', bm);
    const e = gegner(T, 'korvette', mid === 'bow' ? 250 : 0, mid === 'bow' ? 0 : -250, { hp: 1e9 });
    pin(g); for (let v = 0; v < 8; v++) { schiess(T, e, mid); lauf(T, 1.6); }
    const q = (g.stats.schussTreffer || 0) / (g.stats.schuesse || 1);
    info(`${wid}: ruhendes Ziel, ${g.stats.schussTreffer}/${g.stats.schuesse} Projektile treffen (${Math.round(q * 100)} %)`);
    ok(q >= 0.95, `${wid}: Trefferquote auf ein wirklich ruhendes Ziel ${Math.round(q * 100)} % (Contract §9: 100 %)`);
  }
  // Vorhalt höchstens 3 s: Ziel weit weg und schnell (Abfang erst nach > 3 s) -> gezielt wird auf den Ort in 3 s, nicht auf den Abfangpunkt
  {
    const o = { x: 0, y: 0 }, e = { x: 1200, y: 0 }, v = { x: 300, y: 200 };   // entfernt sich mit 300 px/s, Geschoss 450: freier Abfang bei ≈ 8 s
    const frei = Waffen.vorhaltWinkel(o, e, v, 450, 30), kapp = Waffen.vorhaltWinkel(o, e, v, 450, 3);
    const bei3 = Math.atan2(e.y + v.y * 3, e.x + v.x * 3);
    ok(Math.abs(kapp - bei3) < 1e-9, `Vorhalt gedeckelt: Winkel ${kapp.toFixed(4)} rad = Zielpunkt bei 3 s (${bei3.toFixed(4)} rad)`);
    ok(Math.abs(frei - bei3) > 1e-4 && frei > kapp, `ohne Deckel (30 s) liefe der Vorhalt weiter voraus (${frei.toFixed(4)} rad): der Deckel wirkt`);
    const nah = Waffen.vorhaltWinkel(o, { x: 300, y: 0 }, { x: 0, y: 200 }, 450, 3);
    ok(nah > 0.3 && nah < Math.atan2(200 * 3, 300), 'nahes Ziel: Abfangpunkt unter 3 s, nicht gedeckelt');
  }
  // gleicher Schaden je Treffer gegen Schild
  {
    const { T, g, w } = lade();
    const e = gegner(T, 'korvette', 0, -250, { hp: 9999, schild: true }); e.shieldsMax = [40, 40, 40, 40]; e.shields = [40, 40, 40, 40]; const hp0 = e.hp;
    schiess(T, e, 'port'); lauf(T, 1.5);
    const n = g.stats.schussTreffer || 0; const nehm = 160 - e.shields.reduce((a, b) => a + b, 0);
    ok(n >= 1 && e.hp === hp0 && near(nehm, n * w.schaden, 1e-6), `Schild: ${n} Treffer nehmen ${nehm} Schild (je ${w.schaden} wie an der Hülle), Hülle unberührt`);
  }
  // Ausweichen: das Ziel bricht nach dem Schuss seitlich aus (Vorhalt rechnet mit gleichem Kurs und Tempo)
  {
    const { T, g } = lade();
    const e = gegner(T, 'korvette', 0, -250, { hp: 9999 }); const hp0 = e.hp;
    schiess(T, e, 'port');
    lauf(T, 1.8, () => { e.pin.x += 300 * DT; });
    ok(e.hp === hp0 && (g.stats.schussTreffer || 0) === 0 && g.stats.schuesse >= 1, `Ausweichen (300 px/s quer): ${g.stats.schuesse} Projektile, ${g.stats.schussTreffer || 0} Treffer, Hülle unberührt`);
  }
  // Verfehlen ins Leere
  {
    const { T, g } = lade();
    g.ship.mount.port.charge = 1; T.cmd(0, 'weapons.fire', { mount: 'port' }); T.run(0.5);
    ok(g.space.projectiles.length > 0, 'ohne Ziel: Projektile fliegen trotzdem (Rohrfolge lesbar)');
    T.run(2.5);
    ok(g.space.projectiles.filter((q) => q.waffe).length === 0 && !(g.stats.schussTreffer > 0), 'Projektile ins Leere enden an der Reichweite, kein Treffer');
  }
  // Kanone: dasselbe Modell
  {
    const T = arena(); const g = T.g; const w = Katalog.waffe('standardkanone');
    T.debug('bestueck', '8 standardkanone');
    const e = gegner(T, 'korvette', 250, 0, { hp: 9999 }); const hp0 = e.hp;
    schiess(T, e, 'bow'); T.run(0.1); pin(g);
    ok(g.space.projectiles.some((q) => q.kind === 'pkanone') && g.space.beams.length === 0, 'Kanone: Projektile (pkanone), kein Strahl');
    lauf(T, 1.5);
    const n = g.stats.schussTreffer || 0;
    ok(n >= 1 && near(hp0 - e.hp, n * w.schaden, 1e-6), `Kanone: ${n} Treffer × ${w.schaden} = −${hp0 - e.hp} Hülle`);
  }
  // Lanze bleibt Strahl
  {
    const T = arena(); const g = T.g; const e = gegner(T, 'korvette', 250, 0, { hp: 9999 });
    schiess(T, e, 'bow');
    let sah = false; lauf(T, 1.5, () => { if (g.space.beams.length) sah = true; });
    ok(sah && e.hp < 9999, 'Lanze bleibt Sofortstrahl (beam), trifft das Ziel');
  }
});

section('Snapshot-Budget mit neun feuernden Waffen (Projektile im Flug)', () => {
  const T = arena(); const g = T.g; T.debug('ausbau', '3'); T.debug('bestueck', 'alle 3');
  for (const d of [[0, -250], [250, 0], [-250, 0], [0, 250]]) gegner(T, 'korvette', d[0], d[1], { hp: 99999 });
  g.ship.target = g.space.enemies[0].id;
  let max = 0, maxPr = 0;
  for (let i = 0; i < 30 * 20; i++) {
    pin(g);
    for (const id of Object.keys(g.ship.mount)) { const m = g.ship.mount[id]; if (m.charge != null && !(m.salvo > 0)) m.charge = 1; }
    if (i % 4 === 0) T.cmd(0, 'weapons.fire', { mount: 'all' });   // SYS-01 B1: Schuss alle 4 Ticks (Cooldown umgangen), damit viele Projektile fliegen
    T.run(1 / 30);
    const n = JSON.stringify(g.snapshot()).length; if (n > max) max = n;
    const pr = g.space.projectiles.length; if (pr > maxPr) maxPr = pr;
  }
  ok(max <= 18944 && maxPr >= 7, `Snapshot max ${max} B bei bis zu ${maxPr} Projektilen gleichzeitig (Budget 18944 B)`);
});

console.log(`\ntest-waffen-schiff: ${n - fails}/${n} Prüfungen bestanden` + (fails ? `, ${fails} FEHLER` : ''));
process.exit(fails ? 1 : 0);
