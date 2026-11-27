'use strict';
// TRA-01 D: Bot-Lauf der Trainingsmodi mit einem scripted Mensch-Ersatz (wie ein Mensch, der die Checkliste abarbeitet).
//   node tools/sim-training.js [modus] [--seeds N] [--seed S] [--max-s SEK] [--verbose]
//   modus: training_fliegen (Standard); weitere Modi tragen sich in SKRIPTE ein (Paket E: training_captain)
// Der Mensch-Ersatz tippt nur, was ein Mensch tippen würde: helm.throttle, helm.input (Ruder), helm.stop, helm.dodge, helm.jump,
// helm.schnellsprung (Nachrichten wie handleMessage sie aus dem Client bekommt) und setzt sich per interior.enterConsole an die Konsole (Taste E).
// Er liest dazu das Spiel wie ein Mensch den Bildschirm (Position, Stufe, Sprungbereitschaft) und folgt dem aktuellen Schritt des Buchs
// (game.mission.state.stage), nicht den Zielen der Erkennung: ein Fehler in Buch oder Erkennung lässt den Lauf hängen statt ihn durchzuwinken.
// Ein Lauf endet mit "Abzeichen erreicht" und wartet danach den Neustart ab (zweiter Versuch beginnt am Anfang des Buchs).
// Je Seed (game.seed und Entscheidungen des Mensch-Ersatzes wie Ruderrichtung, Reaktionszeit) ein Lauf; Ausgabe je Seed und die Zahl n.
// Als Bibliothek: { partie, lauf, laufe, SKRIPTE, hilfen }. Ein neuer Modus ist ein Eintrag in SKRIPTE: { bots, mensch, schritt(P, S) }.
//   bots     Rollen der Server-Bots (BotSpieler.botHinzufuegen vor dem Start), z. B. ['navigation', 'ops', 'technik']
//   mensch   Konsole, an die sich der Mensch-Ersatz setzt ('helm' | 'captain' | null = erst der Schritt)
//   schritt  (P, S) pro Tick: P = Partie (g, cmd, sitz …), S = Skriptzustand ({ rng, t, … } frei); Rückgabe true = fertig (nicht nötig, Ende steht im Spiel)
const fs = require('fs');
const path = require('path');
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const { Game } = require('../server/game.js');
const Interior = require('../server/sim/interior.js');
const Sprung = require('../server/sim/sprung.js');
const Training = require('../server/sim/training.js');
const Erk = require('../server/sim/training-erkennung.js');
const BotSpieler = require('../server/bots/spieler.js');
const { makeRng } = require('../server/util.js');

const DT = 1 / CONFIG.tickHz;
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- Partie über den Lobby-Weg (wie ein Mensch am Rechner) ----------
function partie(modus, o) {
  o = o || {};
  const g = new Game({ noStore: true, worlds: false, seed: o.seed != null ? o.seed : 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(m) { if (this.inbox.length < 5000) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'T0', name: 'Tr0', color: 0 });
  for (const r of o.bots || []) BotSpieler.botHinzufuegen(g, null, r);
  g.handleMessage(c, { t: 'lobbyOpt', startMission: modus });
  if (o.sprache) g.handleMessage(c, { t: 'lobbyOpt', trainingSprache: true });
  g.handleMessage(c, { t: 'ready', ready: true });
  const odas = []; const o0 = g.oda.bind(g); g.oda = (t, x) => { odas.push({ t: g.time, text: String(t) }); return o0(t, x); };
  const P = { g, c, h: c.player, odas };
  P.tick = () => g.step();
  P.cmd = (msg) => g.handleMessage(c, Object.assign({ t: 'cmd' }, msg));
  P.sitz = (kind) => { if (P.h.console !== kind) Interior.enterConsole(g, P.h, kind); };
  P.abzeichen = () => c.inbox.filter((m) => m.t === 'event' && m.kind === Protocol.EVT_ABZEICHEN);
  P.schritt = () => g.mission.state.stage;
  return P;
}

// ---------- Hilfen des Mensch-Ersatzes ----------
// Auf einen Punkt zuhalten: Ruder nach dem Winkelfehler, Stufe nach Abstand/Geschwindigkeit. opt.stufe = Reisestufe, opt.langsamAb = Abstand, ab dem gebremst wird
function ansteuern(P, x, y, opt) {
  opt = opt || {};
  const s = P.g.ship;
  const fehler = wrap(Math.atan2(y - s.y, x - s.x) - s.angle);
  // Flugmodell-Eigenheit (gemessen): wer im Stand mit Restdrift dreht, kommt trotz Stufe nicht vom Fleck (Vorwärtstempo bleibt <= 0): erst Fahrt aufnehmen, dann drehen
  const stand = s.speed < 6 && s.helm.stage > 1;
  P.cmd({ c: 'helm.input', turn: stand ? 0 : clamp(fehler * 2.5, -1, 1), thrust: 0 });
  const d = dist(s.x, s.y, x, y);
  let soll = opt.stufe != null ? opt.stufe : 4;
  if (opt.langsamAb != null && d < opt.langsamAb) soll = Math.abs(fehler) > 0.8 ? 1 : (s.speed > (opt.maxSpeed || 20) ? 1 : 2);
  if (Math.abs(fehler) > 1.2 && d > 150) soll = Math.min(soll, 2);   // erst eindrehen
  if (s.helm.stage !== soll) P.cmd({ c: 'helm.throttle', set: soll });
  return d;
}
function halt(P) { P.cmd({ c: 'helm.input', turn: 0, thrust: 0 }); }
function station(P) { const l = require('../shared/locations.js').get(P.g.ship.scene); return l.scene.station || { x: P.g.space.w / 2, y: P.g.space.h / 2 }; }
const bereit = (P) => !!P.g.ship.jump.ready;
// Aktion höchstens alle `sek` Spielsekunden (ein Mensch tippt nicht 30-mal pro Sekunde)
function gedrosselt(S, schluessel, g, sek, f) { if (g.time - (S[schluessel] || -99) >= sek) { S[schluessel] = g.time; f(); } }

// ---------- Skript Fliegen: folgt der Checkliste Schritt für Schritt ----------
const ZUGEHOERIG = {   // je Buchschritt: was der Mensch jetzt tippt
  a_hoch(P, S) {   // Platz nehmen, W (legt ab), dann vom Liegeplatz wegfliegen
    P.sitz('helm');
    if (P.g.ship.docked) gedrosselt(S, 'w', P.g, 1, () => P.cmd({ c: 'helm.throttle', delta: 1 }));
    else ansteuern(P, 1300, 760, { stufe: 3 });
  },
  a_runter(P, S) { gedrosselt(S, 's', P.g, 1, () => P.cmd({ c: 'helm.throttle', delta: -1 })); },
  a_ruder(P, S) { P.cmd({ c: 'helm.input', turn: S.richtung, thrust: 0 }); },
  a_stopp(P, S) { halt(P); gedrosselt(S, 'x', P.g, 1, () => P.cmd({ c: 'helm.stop' })); },
  a_rolle(P, S) { gedrosselt(S, 'r', P.g, 1, () => P.cmd({ c: 'helm.dodge', dir: S.richtung })); },
  a_station(P, S) {   // erst weit weg (Ostseite des Hafens), dann wieder an die Station heran
    const st = station(P); const s = P.g.ship;
    if (!S.weg && dist(s.x, s.y, st.x, st.y) > 650) S.weg = true;
    if (!S.weg) ansteuern(P, 1300, 760, { stufe: 4 });
    else { const d = dist(s.x, s.y, st.x, st.y); ansteuern(P, st.x + 150, st.y, { stufe: 4, langsamAb: 300, maxSpeed: 40 }); if (d < 240) P.cmd({ c: 'helm.stop' }); }
  },
  b_sprungpunkt(P, S) { const p = Sprung.sprungpunkt(P.g, '0306'); ansteuern(P, p.x, p.y, { stufe: 4, langsamAb: 400, maxSpeed: 40 }); },
  b_falt(P, S) { halt(P); if (bereit(P)) gedrosselt(S, 'f', P.g, 1, () => P.cmd({ c: 'helm.jump' })); },
  b_zurueck(P, S) { if (bereit(P)) gedrosselt(S, 'f', P.g, 1, () => P.cmd({ c: 'helm.jump' })); },
  b_schnell(P, S) { if (bereit(P) && !P.g.reise) gedrosselt(S, 'g', P.g, 1, () => P.cmd({ c: 'helm.schnellsprung' })); },
  b_rueckflug(P, S) { if (bereit(P) && !P.g.reise) gedrosselt(S, 'g', P.g, 1, () => P.cmd({ c: 'helm.schnellsprung' })); },
  b_andocken(P, S) {
    const d = P.g.mission.v; const l = require('../shared/locations.js').get('hafen').scene.dock; const s = P.g.ship;
    ansteuern(P, l.x, l.y, { stufe: 4, langsamAb: 330, maxSpeed: 18 });
    if (dist(s.x, s.y, l.x, l.y) < 120 && s.speed > 18) P.cmd({ c: 'helm.stop' });
  },
  b_ablegen(P, S) { halt(P); gedrosselt(S, 'w', P.g, 1, () => P.cmd({ c: 'helm.throttle', delta: 1 })); },
};
function skriptFliegen(P, S) {
  const id = P.schritt();
  if (id !== S.letzterSchritt) { S.letzterSchritt = id; S.schrittAb = P.g.time; if (id === 'a_hoch') S.richtung = S.rng.chance(0.5) ? 1 : -1; }
  if (P.g.time - S.schrittAb < S.reaktion) return;   // Lesezeit nach jedem neuen Schritt
  if (id === 'a_ruder' && S.richtung == null) S.richtung = 1;
  const f = ZUGEHOERIG[id]; if (f) f(P, S);
}

const SKRIPTE = {
  training_fliegen: { bots: [], mensch: null, schritt: skriptFliegen },
};

// ---------- Ein Lauf ----------
// Rückgabe: { modus, seed, ok, grund, abzeichen, zeit, schritte, ziele, hinweise, gegner, fehler, versuch2, neustartOk }
function lauf(modus, seed, o) {
  o = o || {};
  const K = SKRIPTE[modus]; if (!K) throw new Error('Kein Skript für ' + modus);
  const maxS = o.maxS || 1200;
  const P = partie(modus, { seed, bots: K.bots, sprache: o.sprache });
  const rng = makeRng((seed * 2654435761) >>> 0);
  const S = { rng, reaktion: 0.6 + rng.range(0, 1.4), schrittAb: 0 };
  const g = P.g;
  const R = { modus, seed, ok: false, grund: '', abzeichen: 0, zeit: 0, schritte: [], ziele: [], hinweise: [], gegner: 0, fehler: 0, neustartOk: false };
  const hinweisTexte = o.hinweisTexte || hinweisTexteDes(g);
  let letzter = null; let erfolgT = null; let odaN = 0;
  if (K.mensch) P.sitz(K.mensch);
  const t0 = g.time; let zielN = 0;
  while (g.time - t0 < maxS) {
    K.schritt(P, S);
    g.step();
    const stage = g.mission.state.stage;
    if (stage !== letzter && g.arena && g.arena.training.versuch === 1) { R.schritte.push({ id: stage, t: +(g.time - t0).toFixed(1) }); letzter = stage; }
    if (g.space.enemies.length) R.gegner = Math.max(R.gegner, g.space.enemies.length);
    for (; odaN < P.odas.length; odaN++) if (hinweisTexte.has(P.odas[odaN].text)) R.hinweise.push({ t: +(P.odas[odaN].t - t0).toFixed(1), text: P.odas[odaN].text });
    const T = g.arena && g.arena.training;
    if (T && T.versuch === 1 && Erk.ziele(g).length !== zielN) { zielN = Erk.ziele(g).length; R.ziele = Erk.ziele(g).slice(); }
    if (T && T.versuch === 1 && T.gemeldet && erfolgT == null) { erfolgT = g.time; R.zeit = +(g.time - t0).toFixed(1); R.ok = true; R.abzeichen = P.abzeichen().length; R.zieleAmEnde = Erk.ziele(g).slice(); }
    if (T && T.versuch === 2) { R.neustartOk = g.mission.activeId === (Training.TRAININGSMODI[modus].buch) && Erk.ziele(g).length === 0 && g.mission.flags.trainingFertig === false && !T.gemeldet; break; }
    if (g.phase !== 'play') { R.grund = 'Phase ' + g.phase; break; }
  }
  R.fehler = g.errors; R.versuch = g.arena && g.arena.training ? g.arena.training.versuch : null;
  if (!R.ok) R.grund = R.grund || ('kein Abzeichen nach ' + maxS + ' s, hängt in Schritt ' + g.mission.state.stage + ', Ziele ' + Erk.ziele(g).join(','));
  R.letzterSchritt = g.mission.state.stage;
  return R;
}
// Texte der Hinweise des Buchs (texte.hinweis.*): ein ODA mit diesem Text ist ein Hänger-Hinweis
function hinweisTexteDes(g) {
  const buch = g.mission.def && g.mission.def.texte ? g.mission.def : null;
  const out = new Set();
  const doc = buch ? buch.texte : (g.mission.textDef && g.mission.textDef.texte) || {};
  for (const [k, v] of Object.entries(doc || {})) if (k.startsWith('hinweis.')) out.add(v);
  return out;
}

function laufe(modus, seeds, o) {
  return seeds.map((s) => lauf(modus, s, o));
}

function zeile(R) {
  return `seed ${String(R.seed).padStart(3)}  ${R.ok ? 'OK ' : 'FEHL'}  ${R.ok ? R.zeit + ' s' : R.grund}  abzeichen ${R.abzeichen}  ziele ${R.ziele.length}  hinweise ${R.hinweise.length}  gegner max ${R.gegner}  fehler ${R.fehler}  neustart ${R.neustartOk ? 'ok' : 'nein'}`;
}

function main(argv) {
  const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
  const modus = argv.find((a) => /^training_/.test(a)) || 'training_fliegen';
  const n = Number(arg('--seeds', 10)); const s0 = Number(arg('--seed', 1));
  const seeds = argv.includes('--seed') && !argv.includes('--seeds') ? [s0] : Array.from({ length: n }, (_, i) => s0 + i);
  const maxS = Number(arg('--max-s', 1200));
  const t0 = Date.now();
  const alle = [];
  for (const s of seeds) { const R = lauf(modus, s, { maxS }); alle.push(R); console.log(zeile(R)); if (argv.includes('--verbose')) { console.log('   schritte ' + R.schritte.map((x) => x.id + '@' + x.t).join(' ')); for (const h of R.hinweise) console.log('   HINWEIS ' + h.t + ' s: ' + h.text); } }
  const ok = alle.filter((R) => R.ok && R.abzeichen === 1 && R.neustartOk && R.gegner === 0 && R.fehler === 0 && R.hinweise.length === 0).length;
  const zeiten = alle.filter((R) => R.ok).map((R) => R.zeit).sort((a, b) => a - b);
  console.log(`\n${modus}: n = ${alle.length} Seeds, sauber durchgespielt ${ok}/${alle.length}; Spielzeit bis Abzeichen min ${zeiten[0]} / Median ${zeiten[Math.floor(zeiten.length / 2)]} / max ${zeiten[zeiten.length - 1]} s; Rechenzeit ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  process.exit(ok === alle.length ? 0 : 1);
}

module.exports = { partie, lauf, laufe, zeile, SKRIPTE, hilfen: { ansteuern, halt, station, gedrosselt, dist, wrap, clamp, hinweisTexteDes } };
if (require.main === module) main(process.argv.slice(2));
