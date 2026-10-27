'use strict';
// SYS-01 A2b „Banderole, Einblendung, Zonenkreuz-Befunde“ (Kai 2026-10-27):
//   Tokens: Banderole-Modell (Zahl, Ausfallzeile, Satz je Station, Ablaufanteil), Statusfeld Gelb unter VOLL, Kontrast der Banderole, fragil-Token.
//   Zonenkreuz: geflickte Systeme füllen den Balken in fragil und tragen eine Tape-Schraffur (Form, nicht nur Farbe).
//   Server: dauer/next im Snapshot; Tod bleibt gelatcht; OK (menu zerstoertOk) beendet erst, wenn alle verbundenen Spieler bestätigt haben;
//           endeZerstoert speichert NICHT (Weltstand bleibt unverändert); Befehle nach dem Tod werden nicht ausgeführt; Szenen-Reset lässt den Tod stehen.
//   Client (Quelltext): Banderole in Pult.rahmen, Einblendung in hud.js, OK-Taste in client.js, Steuer-LAGE zeigt zerstört.
//   node tools/test-banderole.js   (npm run test:banderole)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const PS = require('../public/js/pult-systeme-tokens.js');
const ZK = require('../public/js/zonenkreuz.js');
const Protocol = require('../shared/protocol.js');
const { Game } = require('../server/game.js');
const I = require('../server/sim/interior.js');
const Space = require('../server/sim/space.js');
const Weltstand = require('../server/weltstand.js');
const BOTS = require('../server/sim/bots.js');
const SR = require('../server/sim/szenenreset.js');
const Reaktortod = require('../server/sim/reaktortod.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-banderole-'));
let seq = 0;
const SCHRITT = 1 / 30;

function setup(spieler) {
  const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const conns = [];
  for (let i = 0; i < (spieler || 1); i++) {
    const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'K' + i, name: 'K' + i, color: i });
    conns.push(c);
  }
  g.handleMessage(conns[0], { t: 'lobbyOpt', startMission: 'freie_fahrt' });
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  const run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) g.step(); };
  run(1); g.space.enemies = [];
  BOTS.setBotAuto(g, false);
  return { g, run, c: conns[0], conns };
}
const brechen = (g) => I.damageSystem(g, 'reactor', 'broken');
const reparieren = (g) => I.repairSystem(g, 'reactor', 'player', 'flick');
const neustart = (g) => Space.reactorOnline(g, 'Test');
function ausfall(g, nr) { for (let i = 1; i < nr; i++) { brechen(g); reparieren(g); neustart(g); } brechen(g); }
function zeitBisTod(g, max) { let k = 0; while (!g.ship.schiffZerstoert && k < Math.round(max * 30)) { g.step(); k++; } return k * SCHRITT; }
const fakeCtx = (rec) => new Proxy({}, { get: (t, p) => (p === 'fillRect' ? (x, y, w, h) => rec.push({ f: t.fillStyle, x, y, w, h }) : p === 'fillStyle' ? t.fillStyle : () => {}), set: (t, p, v) => { t[p] = v; return true; } });

section('Tokens: Banderole-Modell');
{
  ok(PS.banderole(null, 'technik') === null && PS.banderole({ rest: -1, n: 0 }, 'technik') === null, 'ohne Countdown (rest -1) keine Banderole');
  const b = PS.banderole({ rest: 64, n: 2, dauer: 10, next: 5 }, 'technik');
  ok(b && b.zahl === '6,4' && b.ausfall === '2. Ausfall · nächster 5 s', `Zahl 6,4 und Ausfallzeile (${b && b.zahl} / ${b && b.ausfall})`);
  ok(b && b.satz === 'Reaktor reparieren – zu zweit schneller' && b.anteil > 0.639 && b.anteil < 0.641, `Satz Technik, Ablaufanteil 0,64 (${b && b.anteil})`);
  ok(PS.banderole({ rest: 25, n: 1, dauer: 2.5, next: 1.25 }, 'helm').satz === 'Notsprung oder Kurs halten', 'Satz Steuer');
  ok(PS.banderole({ rest: 25, n: 1, dauer: 2.5, next: 1.25 }, 'weapons').satz === 'Schild halten', 'Satz Ops');
  ok(PS.banderole({ rest: 25, n: 1, dauer: 2.5, next: 1.25 }, 'captain').satz === 'Notsprung befehlen oder Reaktor reparieren lassen', 'Satz Captain');
  ok(PS.banderole({ rest: 25, n: 1, dauer: 2.5, next: 2.5 }, 'helm').ausfall === '1. Ausfall · nächster 2,5 s', 'halbe Sekunden mit Komma');
  ok(PS.banderole({ rest: 999, n: 1, dauer: 2, next: 1 }, 'helm').anteil === 1, 'Anteil wird auf 1 begrenzt');
  for (const sk of ['rom', 'germanen']) {
    const F = PS.farben(sk);
    ok(PS.kontrast(F.banderoleText, F.banderole) >= 4.5, `Banderole: Text ink auf Rot ${PS.kontrast(F.banderoleText, F.banderole).toFixed(2)}:1 (${sk})`);
  }
  ok(PS.TOKENS.TEXT.schiffZerstoert === 'SCHIFF ZERSTÖRT – Ihr habt verloren' && PS.TOKENS.TEXT.schiffOk === 'OK', 'Einblendung: Text und OK-Schrift aus den Tokens');
}

section('Tokens: Statusfeld Gelb unter VOLL (Review A1c, Muss)');
{
  const sh = (zonen) => ({ zonen, systems: {} });
  let f = PS.statusFeld(sh([100, 63, 100, 100]));
  ok(f.rang === 'seite' && f.zust === 'besch' && f.farbe === 'statusBesch', `Stb 63 % -> Gelb (${f.text})`);
  f = PS.statusFeld(sh([100, 100, 100, 99]));
  ok(f.zust === 'besch' && f.farbe === 'statusBesch', 'Bb 99 % -> Gelb (unter VOLL)');
  f = PS.statusFeld(sh([100, 100, 100, 100]));
  ok(f.rang === 'voll' && f.farbe === 'statusVoll', 'alle 100 % -> VOLL (Eisblau)');
  f = PS.statusFeld(sh([100, 100, 100, 0]));
  ok(f.text === 'BB OFFEN' && f.v === 'BB OFFEN' && f.farbe === 'statusOffen', `HUD-Text mit Seite: ${f.text}`);
  ok(PS.TOKENS.FARBE.fragil === '#F08A3C', 'fragil-Token = Wert von FRAGILE_COL');
  ok(/FRAGILE_COL = '#F08A3C'/.test(src('public/js/render.js')), 'render.js: FRAGILE_COL unverändert (Quelle des Tokens)');
}

section('Zonenkreuz: geflickt füllt den Balken in fragil und trägt Tape');
{
  const ids = Protocol.SYSTEMS_INTEG;
  const integ = ids.map(() => 100);
  integ[ids.indexOf('emitter_port')] = 60;
  const state = { ship: { integ, systems: {}, zonen: [100, 100, 100, 100], fragile: ['emitter_port'] } };
  const m = ZK.modell(state, { name: (id) => id, reihenfolge: ids });
  const e = ZK.eintrag(m, 'emitter_port');
  ok(e && e.fragil === true, 'Modell: emitter_port ist fragil');
  const rec = [];
  const env = { R: { text: () => {}, measure: (s) => String(s).length * 6, ui: { buttons: [] } }, P: { mix: (a) => a, skin: { id: 'rom' } } };
  ZK.zeichne(fakeCtx(rec), m, { x: 10, y: 10, w: 372, h: 188 }, { env, skin: 'rom' });
  const F = PS.farben('rom');
  ok(rec.some((r) => r.f === F.fragil && r.h === 4), 'Balken in fragil (4 px hoch)');
  ok(rec.some((r) => r.f === F.text && r.h === 1 && r.w === 1), 'Tape: 1-px-Striche über dem Balken in Creme');
}

section('Server: Snapshot dauer/next, Tod, OK, Weltstand bleibt');
{
  const { g } = setup(1);
  // Angedockt speichert der periodische Hafen-Save den Stand (Vorbestand, A2a); hier geht es um den Tod im Flug
  g.ship.docked = false; g.ship.dockedAt = null;
  brechen(g);
  let rt = Reaktortod.snapshot(g);
  ok(rt.dauer === 20 && rt.next === 10 && rt.n === 1, `1. Ausfall: dauer 20, next 10 (${rt.dauer} / ${rt.next})`);
  reparieren(g); neustart(g); brechen(g);
  rt = Reaktortod.snapshot(g);
  ok(rt.dauer === 10 && rt.next === 5 && rt.n === 2, `2. Ausfall: dauer 10, next 5 (${rt.dauer} / ${rt.next})`);
  // Speichern zählen (Weltstand.save ist der Pfad von game.saveWorld). Vor dem Tod darf der Hafen-Save laufen (hier unangedockt, also keiner);
  // ab dem Tod darf nichts mehr geschrieben werden.
  let saves = 0; const realSave = Weltstand.save;
  Weltstand.save = (...a) => { saves++; return realSave(...a); };
  const ev = []; const realEmit = g.emit.bind(g); g.emit = (k, d) => { ev.push({ k, d }); return realEmit(k, d); };
  const ende = zeitBisTod(g, 20);
  ok(g.ship.schiffZerstoert && !!g.zerstoertOffen, `Tod nach ${ende.toFixed(1)} s, Einblendung gelatcht`);
  ok(Reaktortod.snapshot(g).tot === 1, 'Snapshot tot 1');
  ok(ev.some((x) => x.k === 'schiffZerstoert'), 'Ereignis schiffZerstoert gesendet');
  const nachTod = saves;
  const sw = g.saveWorld('test', { sync: true });
  ok(sw.skipped === true && saves === nachTod, 'nach dem Tod: saveWorld schreibt nichts (Stand bleibt)');
  // Nach dem Tod: Befehle werden nicht ausgeführt
  let cmds = 0; const realCmd = g.onCmd.bind(g); g.onCmd = (p, m) => { cmds++; return realCmd(p, m); };
  g.handleMessage(g.players[0].conn, { t: 'cmd', c: 'helm.throttle', delta: 1 });
  ok(cmds === 0, 'nach dem Tod kein Befehl an onCmd (Eingabe gesperrt)');
  // Szene von vorn (Regiebuch) lässt den Tod stehen, Zähler und Countdown gehen zurück
  SR.zuruecksetzen(g);
  ok(g.ship.schiffZerstoert === true && Reaktortod.snapshot(g).tot === 1 && Reaktortod.snapshot(g).n === 0, 'Szenen-Reset: Tod bleibt, Zähler 0');
  // OK des einzigen Spielers beendet die Partie, ohne Speichern
  g.handleMessage(g.players[0].conn, { t: 'menu', op: 'zerstoertOk' });
  ok(g.phase === 'lobby' && !g.zerstoertOffen, `OK: Partie in der Lobby (phase ${g.phase})`);
  ok(saves === nachTod, `Weltstand beim OK nicht gespeichert (saves ${saves} = ${nachTod})`);
  ok(ev.some((x) => x.k === 'sessionEnded' && x.d && x.d.grund === 'zerstoert' && x.d.saved === false), 'Ereignis sessionEnded { grund: zerstoert, saved: false }');
  ok(!g.ship.schiffZerstoert, 'in der Lobby ist das Schiff nicht mehr zerstört');
  Weltstand.save = realSave;
}

section('Server: zwei Spieler, erst beide OK beendet die Partie');
{
  const { g, conns } = setup(2);
  ausfall(g, 1);
  zeitBisTod(g, 20);
  g.handleMessage(conns[0], { t: 'menu', op: 'zerstoertOk' });
  ok(g.phase !== 'lobby' && !!g.zerstoertOffen, 'ein OK von zwei: Partie läuft weiter (Einblendung bleibt)');
  g.handleMessage(conns[0], { t: 'menu', op: 'zerstoertOk' });
  ok(g.phase !== 'lobby', 'dasselbe Gerät zweimal OK zählt nicht doppelt');
  g.handleMessage(conns[1], { t: 'menu', op: 'zerstoertOk' });
  ok(g.phase === 'lobby', 'zweites OK: Lobby');
}

section('Protokoll und Client-Quelltext');
{
  ok(Protocol.MENU_OPS.includes('zerstoertOk'), 'shared/protocol.js: MENU_OPS enthält zerstoertOk');
  const pult = src('public/js/pult.js'), hud = src('public/js/hud.js'), cl = src('public/js/client.js'), ps = src('public/js/pult-stationen.js');
  ok(/PS\.banderole\(/.test(pult) && /banderole\.versatz/.test(pult) && /function banderoleZeichnen/.test(pult), 'pult.js: Banderole in rahmen, Inhalt um versatz verschoben');
  ok(/banderoleText/.test(pult), 'pult.js: Banderole-Text aus den Tokens');
  ok(/drawSchiffZerstoert\(ctx, view\)/.test(hud) && /TEXT\.schiffZerstoert/.test(hud), 'hud.js: Einblendung mit Tokens-Text');
  ok(/op: 'zerstoertOk'/.test(cl) && /KeyE/.test(cl) && /grund === 'zerstoert'/.test(cl), 'client.js: OK-Aktion, Taste E, Hinweis bei grund zerstoert');
  ok(/zerstört/.test(ps) && /zerText/.test(ps) && /reactor === 'broken'/.test(ps), 'pult-stationen.js: Steuer-LAGE zeigt zerstört in zerText');
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\n' + (fails ? fails + ' FEHLER' : '') + ` ${n - fails}/${n} ok (SYS-01 A2b Banderole)`);
process.exit(fails ? 1 : 0);
