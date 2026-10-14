'use strict';
// SL2 Belebter Außenposten Kantenstein: Karte (Taverne), Kulisse (Passanten ohne Snapshot), Gespräch mit Evert und dem Wirt, Kapitel 1
// (Evert finden und anheuern), Snapshot-Budget, Client-Bausteine (vm).   node tools/test-gespraech.js   (npm run test:gespraech)
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { Game } = require('../server/game.js');
const Protocol = require('../shared/protocol.js');
const Kulisse = require('../shared/kulisse.js');
const Welt = require('../server/sim/welt.js');
const Gespraech = require('../server/sim/gespraech.js');
const Away = require('../server/sim/away.js');
const Interior = require('../server/sim/interior.js');
const W = require('../server/world.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-gespraech-'));
const LP = 'kantenstein.siedlung';

function neuesSpiel(players) {
  Welt.waehle(null, 'limes');
  const d = path.join(TMP, 'w' + Math.random().toString(36).slice(2)); fs.mkdirSync(d, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: d, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const conns = [];
  for (let i = 0; i < (players || 2); i++) {
    const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'G' + i, name: 'Crew' + i, color: i }); conns.push(c);
  }
  g.handleMessage(conns[0], { t: 'lobbyOpt', startMission: 'schuld_der_lerche' });
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  const run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) g.step(); };
  run(1);
  return { g, conns, run };
}
const cmd = (t, i, c, extra) => t.g.handleMessage(t.conns[i], Object.assign({ t: 'cmd', c }, extra || {}));
const stehtBei = (g, p, npc) => { p.x = npc.x - 32; p.y = npc.y; p.dir = 'right'; };

section('Karte Kantenstein: Taverne, Kulisse');
{
  const t = neuesSpiel(1); const g = t.g;
  const k = g.karteOf(LP);
  ok(k && k.id === LP && k.meta.titel.kantine_1 === 'Kantine', 'Außenposten mit Kantine (die Taverne), Seed ' + (k && k.seed));
  ok(k.anker.some((a) => a.id === 'kantine_1.zelle.1') && k.anker.some((a) => a.id === 'kantine_1.zelle.2'), 'zwei Personen-Anker in der Taverne (Evert, Wirt)');
  const ku = require('../content/welt/kulisse.json').karten[LP];
  ok(Kulisse.pruefen(ku, k.plaetze).length === 0, 'Kulisse-Daten prüfen: Plätze da, Wege im Platz, Sprüche ≤ 60 Zeichen ' + JSON.stringify(Kulisse.pruefen(ku, k.plaetze)));
  ok(ku.figuren.length >= 10, `${ku.figuren.length} Figuren (Passanten, Händler, Gäste, Wache)`);
  const mp = Interior.awayInfoOf(LP).map;
  const solid = (x, y) => mp.info(x, y).solid;
  let blockiert = 0, gesehen = {}, maxBlase = 0, bewegt = 0;
  for (let s = 0; s < 400; s += 1.5) {
    for (const f of Kulisse.figuren(ku, k, s)) {
      const tx = Math.floor(f.x / 32), ty = Math.floor(f.y / 32);
      if (solid(tx, ty)) blockiert++;
      if (f.blase) { gesehen[f.id] = 1; maxBlase = Math.max(maxBlase, f.blase.length); }
      if (f.moving) bewegt++;
    }
  }
  ok(blockiert === 0, 'in 400 s steht keine Figur auf einer festen Kachel (Wege liegen auf Straßen und Plätzen) – ' + blockiert + ' Treffer');
  ok(Object.keys(gesehen).length === ku.figuren.length, 'jede Figur spricht innerhalb von 400 s mindestens einmal (' + Object.keys(gesehen).length + '/' + ku.figuren.length + ')');
  ok(maxBlase <= 60 && bewegt > 100, 'Sprechblasen kurz, es wird gelaufen');
  const a = Kulisse.figuren(ku, k, 123.4), b = Kulisse.figuren(ku, k, 123.4);
  ok(JSON.stringify(a) === JSON.stringify(b), 'deterministisch: gleiche Zeit, gleiche Positionen (Client und Server rechnen dasselbe)');
  const c2 = Kulisse.figuren(ku, Object.assign({}, k, { seed: k.seed + 1 }), 123.4);
  ok(JSON.stringify(a) !== JSON.stringify(c2), 'anderer Seed, andere Phase');
  const kurz = Kulisse.figuren(ku, k, 10), spaeter = Kulisse.figuren(ku, k, 10.5);
  ok(kurz.every((f, i) => Math.hypot(f.x - spaeter[i].x, f.y - spaeter[i].y) < 30), 'Bewegung stetig (kein Springen innerhalb einer halben Sekunde)');
  const pl = g.awayMapPayload(k);
  ok(pl.ku && pl.ku.figuren.length === ku.figuren.length && pl.seed === k.seed, 'awayMap-Nachricht trägt Kulisse und Seed');
  ok(Buffer.byteLength(JSON.stringify(pl)) <= Protocol.AWAY_MAP_MAX_BYTES, 'awayMap-Nachricht unter ' + Protocol.AWAY_MAP_MAX_BYTES + ' Byte (' + Buffer.byteLength(JSON.stringify(pl)) + ')');
  const snap = JSON.stringify(g.snapshot());
  ok(!/ku_/.test(snap), 'Passanten stehen nicht im Snapshot');
  g.releaseWorldLock();
}

section('Kapitel 1: Evert in der Taverne finden und anheuern');
{
  const t = neuesSpiel(2); const g = t.g;
  g.mission.startMission('k1_kantenstein'); t.run(1);
  ok(g.mission.activeId === 'k1_kantenstein', 'Kapitelbuch läuft');
  const aw = g.away;
  const ev = Away.personMit(aw, 'evert'), wi = Away.personMit(aw, 'wirt');
  ok(ev && ev.present && ev.gespraech === 'evert_anheuern' && wi && wi.gespraech === 'wirt_plausch', 'Evert und der Wirt stehen am Boden, ansprechbar');
  const kt = Interior.awayInfoOf(LP).karte.plaetze.kantine_1.rect;
  const intat = (q) => Math.floor(q.x / 32) >= kt[0] && Math.floor(q.x / 32) < kt[0] + kt[2] && Math.floor(q.y / 32) >= kt[1] && Math.floor(q.y / 32) < kt[1] + kt[3];
  ok(intat(ev) && intat(wi), 'beide stehen in der Taverne (kantine_1)');
  const snap0 = g.snapshot();
  ok(snap0.away.npcs.length === 2 && snap0.away.npcs.every((q) => q.g === 1), 'Snapshot: zwei Personen mit g (ansprechbar), nichts sonst');
  ok(g.snapshot().mission.objectives.length === 2, 'zwei Ziele: finden, anheuern');
  const p0 = g.players[0], p1 = g.players[1];
  ok(p0.zone === 'away', 'Gruppe ist am Boden');

  // Wirt (Atmosphäre, kein Ergebnis für Evert)
  stehtBei(g, p0, wi); Interior.onAct(g, p0, true); Interior.onAct(g, p0, false);
  ok(g.gespraech && g.gespraech.id === 'wirt_plausch' && g.gespraech.pid === p0.id, 'E am Wirt startet sein Gespräch');
  const gp0 = g.snapshot().gp;
  ok(gp0 && gp0.nid === 'wirt' && gp0.t.startsWith('Willkommen') && gp0.z === 1 && gp0.zn === 3 && !gp0.w, 'Snapshot gp: Sprecher, Zeile 1/3');
  for (let i = 0; i < 3; i++) cmd(t, 0, 'gespraech.next');
  ok(!g.gespraech && g.mission.flags.gespraech_wirt_plausch === 'gefuehrt', 'nach der letzten Zeile endet es, Flag gespraech_wirt_plausch');
  ok(g.mission.activeId === 'k1_kantenstein' && !g.mission.flags.gespraech_evert_anheuern, 'Evert ist damit nicht angeheuert');

  // Evert: Mitspieler darf zunächst nicht weiterklicken, Weggehen bricht ab
  stehtBei(g, p0, ev); Interior.onAct(g, p0, true); Interior.onAct(g, p0, false);
  ok(g.gespraech && g.gespraech.id === 'evert_anheuern', 'E bei Evert startet das Gespräch');
  p1.x = ev.x + 32; p1.y = ev.y;
  const z0 = g.gespraech.z; cmd(t, 1, 'gespraech.next');
  ok(g.gespraech.z === z0, 'Mitspieler darf nicht weiterklicken (der Ansprechende ist dran)');
  t.run(16); cmd(t, 1, 'gespraech.next');
  ok(g.gespraech.z === z0 + 1, 'nach ' + Gespraech.IDLE_FREI + ' s ohne Eingabe darf jeder am Ort weiter');
  p0.x += 400; t.run(0.5);
  ok(!g.gespraech && !g.mission.flags.gespraech_evert_anheuern, 'Weggehen bricht das Gespräch ab, ohne Ergebnis');
  p0.x = ev.x - 32; p0.y = ev.y; p1.x = ev.x + 32;
  // neu: bis zur Wahl
  Interior.onAct(g, p0, true); Interior.onAct(g, p0, false);
  for (let i = 0; i < 3; i++) cmd(t, 0, 'gespraech.next');
  let gp = g.snapshot().gp;
  ok(gp && gp.z === 4 && !gp.w, 'Zeile 4/4');
  cmd(t, 0, 'gespraech.next'); gp = g.snapshot().gp;
  ok(gp && Array.isArray(gp.w) && gp.w.length === 2 && gp.w[0][0] === 'annehmen' && /Auftrag/.test(gp.t), 'dann die Wahl: annehmen / später');
  cmd(t, 0, 'gespraech.next');
  ok(g.snapshot().gp && g.snapshot().gp.w, 'in der Wahl bringt „weiter“ nichts');
  cmd(t, 0, 'gespraech.pick', { opt: 'gibtsnicht' });
  ok(g.snapshot().gp && g.snapshot().gp.w, 'unbekannte Option wird abgelehnt');
  // später: Gespräch endet, wiederholbar
  cmd(t, 0, 'gespraech.pick', { opt: 'spaeter' });
  gp = g.snapshot().gp; ok(gp && gp.a === 1 && /Lange nicht mehr/.test(gp.t), 'Antwort auf „später“');
  cmd(t, 0, 'gespraech.next');
  ok(!g.gespraech && g.mission.flags.gespraech_evert_anheuern === 'spaeter' && g.mission.activeId === 'k1_kantenstein', '„Später“ beendet das Gespräch, das Kapitel läuft weiter');
  Interior.onAct(g, p0, true); Interior.onAct(g, p0, false);
  ok(g.gespraech && g.gespraech.id === 'evert_anheuern', 'Evert lässt sich erneut ansprechen');
  for (let i = 0; i < 4; i++) cmd(t, 0, 'gespraech.next');
  const snapG = g.snapshot();
  ok(snapG.gp && snapG.gp.w, 'wieder in der Wahl');
  const bytesMit = JSON.stringify(snapG).length;
  const evG = []; const orig = g.emit.bind(g); g.emit = (k, d) => { evG.push([k, d]); return orig(k, d); };
  cmd(t, 0, 'gespraech.pick', { opt: 'annehmen' });
  cmd(t, 0, 'gespraech.next');
  ok(!g.gespraech && g.mission.flags.gespraech_evert_anheuern === 'annehmen', 'Option annehmen: Flag gespraech_evert_anheuern = annehmen');
  ok(evG.some(([k, d]) => k === 'gespraech' && d.wahl === 'annehmen'), 'Ereignis gespraech { wahl: annehmen } an die Clients');
  t.run(1);
  ok(g.mission.flags.gespraech_evert_anheuern === 'annehmen', 'Flag bleibt');
  t.run(5);
  const done = g.mission.missions.k1_kantenstein;
  ok(done && done.state === 'done' && done.ausgang === 'erfolg', 'Kapitel 1 endet mit erfolg (' + (done && done.state + '/' + done.ausgang) + ')');
  ok(!Away.personMit(g.away, 'evert').present, 'Evert hat die Taverne verlassen');
  ok(g.weltstand.data.fakten.evert === 'angeheuert', 'Weltstand-Fakt evert = angeheuert');
  const w1 = JSON.stringify(g.snapshot()).length;
  ok(w1 < g.C.net.snapMax - g.C.net.snapLuft, `Snapshot ${w1} B (mit Gespräch ${bytesMit} B) unter ${g.C.net.snapMax - g.C.net.snapLuft} B`);
  ok(Object.keys(g.errorLog || {}).filter((q) => q !== 'kette-laden').length === 0, 'keine Fehler ' + JSON.stringify(Object.keys(g.errorLog || {})));
  g.releaseWorldLock();
}

section('Client: Sprechblase, Fenster, Tasten, Passanten (vm)');
{
  const calls = [];
  const rec = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, a]); }), set: (t, k, v) => { t[k] = v; return true; } });
  const win = {};
  win.Net = { reportError: (l, e) => calls.push(['FEHLER', [l, e && e.message]]) };
  win.Render = { text: (ctx, s) => calls.push(['text', [s]]), measure: (s) => String(s).length * 5, wrap: (s, w) => { const o = []; let l = ''; for (const x of String(s).split(' ')) { if ((l + ' ' + x).length * 5 > w && l) { o.push(l); l = x; } else l = l ? l + ' ' + x : x; } if (l) o.push(l); return o; } };
  const k = (() => { Welt.waehle(null, 'sund'); const g = new Game({ noStore: true, seed: 7, env: { MISSION_SOURCE: 'fallback' }, log: () => {} }); require('../server/sim/landepunkte.js').get(g, LP); const kk = g.karteOf(LP); return { pl: g.awayMapPayload(kk), seed: kk.seed }; })();
  Welt.waehle(null, 'limes');
  win.Shared_Maps = { [LP]: { id: LP, seed: k.pl.seed, plaetze: k.pl.plaetze, ku: k.pl.ku } };
  win.Shared_Kulisse = Kulisse;
  const ctxVm = { window: win, self: win, console }; vm.createContext(ctxVm);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'gespraech.js'), 'utf8'), ctxVm, { filename: 'gespraech.js' });
  const G = win.Gespraech; const cx = rec();
  const st = { away: { map: LP }, gp: null };
  const fig = G.kulisse(st, 50);
  ok(fig.length === k.pl.ku.figuren.length && fig.every((f) => f.k === 1 && /^ku_/.test(f.id) && Number.isFinite(f.x)), 'Passanten der Karte als NSC-Liste (' + fig.length + ')');
  ok(G.kulisse({ away: { map: 'platform' } }, 50).length === 0, 'andere Karten: keine Passanten');
  const sch = G.schilder(st);
  ok(sch.length === 1 && sch[0].name === 'TAVERNE' && sch[0].x > 0, 'Gebäudeschild TAVERNE');
  G.blase(cx, 'Frische Erbsen! Fast frisch!', 200, 100); ok(calls.some((c) => c[0] === 'text' && /Erbsen/.test(c[1][0])) && !calls.some((c) => c[0] === 'FEHLER'), 'Sprechblase zeichnet');
  calls.length = 0;
  st.gp = { id: 'evert_anheuern', nid: 'evert', n: 'Evert Kroeger', x: 100, y: 100, t: 'Ihr seid die Crew der Lerche? Gut.', z: 1, zn: 4 };
  G.fenster(cx, st); ok(calls.some((c) => c[0] === 'text' && c[1][0] === 'EVERT KROEGER') && calls.some((c) => c[0] === 'text' && /weiter/.test(c[1][0])), 'Fenster: Name, Text, Hinweis „E: weiter“');
  calls.length = 0;
  st.gp = Object.assign({}, st.gp, { t: 'Nehmt ihr den Auftrag an?', w: [['annehmen', 'Wir bringen dich hin.'], ['spaeter', 'Erst umsehen.']] });
  G.fenster(cx, st); ok(calls.some((c) => c[0] === 'text' && /^1 /.test(c[1][0])) && calls.some((c) => c[0] === 'text' && /^2 /.test(c[1][0])), 'Fenster in der Wahl: 1 und 2');
  const sent = []; const send = (m) => sent.push(m);
  ok(G.taste('Digit2', send, st) && sent[0].c === 'gespraech.pick' && sent[0].opt === 'spaeter', 'Taste 2 wählt die zweite Option');
  ok(G.taste('KeyE', send, st) && sent.length === 1, 'E in der Wahl wird verbraucht, sendet nichts');
  ok(G.taste('Escape', send, st) && sent[1].c === 'gespraech.end', 'Esc verlässt das Gespräch');
  st.gp = { id: 'x', nid: 'evert', n: 'E', t: 'Hallo', z: 1, zn: 2 };
  ok(G.taste('Enter', send, st) && sent[2].c === 'gespraech.next' && G.taste('KeyE', send, st) && sent[3].c === 'gespraech.next' && G.taste('Space', send, st) && sent[4].c === 'gespraech.next', 'E, Enter und Leertaste = weiter');
  ok(!G.taste('KeyW', send, st) && sent.length === 5, 'andere Tasten (Laufen) bleiben frei');
  st.gp = null; ok(!G.taste('KeyE', send, st) && !G.aktiv(st), 'ohne Gespräch gehen alle Tasten ins Spiel');
}

console.log(`\n${n - fails}/${n} bestanden${fails ? ', ' + fails + ' FEHLER' : ''}`);
process.exit(fails ? 1 : 0);
