'use strict';
// TEC-01 C: Sprungbruch der Notflicken (server/sim/komponenten.js sprungBruch).
// Regel (Kai): beim Systemsprung bricht jeder Flicken (Komponente 'geflickt') der Schildkette mit p = 0,3 + 0,1 * sp (sp = bisher überstandene Sprünge dieses Flickens, p höchstens 1).
// Überstanden: sp + 1. Gebrochen: Komponente wieder defekt, Ausfallzähler n unverändert, sp 0. Ein neuer Flicken beginnt bei sp 0. Zufall nur aus ship.kompRng.
//   node tools/test-sprungbruch.js   (npm run test:sprungbruch)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const { Game } = require('../server/game.js');
const I = require('../server/sim/interior.js');
const K = require('../server/sim/komponenten.js');
const Sprung = require('../server/sim/sprung.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Finale = require('../server/sim/finale.js');
const CONFIG = require('../shared/config.js');

const MESS = process.argv.includes('--messung');
const LAEUFE = 2000;   // je Stufe
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(title, fn) { console.log('\n[' + title + ']'); try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); } }

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sprungbruch-'));
let seq = 0;
function newGame(seed) {
  const g = new Game({ noStore: true, seed: seed || 5, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  g.space.enemies = []; g.space.projectiles = [];
  I.integritaetVoll(g);
  K.konsistentAlle(g);
  return g;
}
function newWelt(seed) {   // mit Weltsim (Freie Fahrt): Notsprung und Orbit
  const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: seed || 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const c = { inbox: [], send(o) { if (this.inbox.length < 800) this.inbox.push(o); }, sendRaw(s) { this.send(JSON.parse(s)); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'Crew', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'freie_fahrt' }); g.handleMessage(c, { t: 'ready', ready: true });
  for (let k = 0; k < 30; k++) g.step();
  g.space.enemies = [];
  K.konsistentAlle(g);
  return g;
}
const CODES = { o: 'ok', d: 'defekt', g: 'geflickt' };
const setz = (g, sys, codes) => { K.erzeugeAusZustand(g, sys); codes.split('').forEach((c, i) => { g.ship.komp[sys][i].z = CODES[c]; }); K.synchronisieren(g, sys); };
const z = (g, sys) => g.ship.komp[sys].map((k) => k.z[0]).join('');
// Zufallsstrom ersetzen: immer derselbe Wert (0 = jeder Flicken bricht, 0.9999999 = nur p = 1 bricht)
function fest(g, wert) { const r = () => wert; r.pick = (a) => a[0]; g.ship.kompRng = r; }
// Ereignisse und ODA mitschreiben
function lausche(g) {
  const log = { ev: [], oda: [] };
  const e0 = g.emit.bind(g); g.emit = (name, p) => { log.ev.push({ name, p }); return e0(name, p); };
  const o0 = g.oda.bind(g); g.oda = (t, k) => { log.oda.push(t); return o0(t, k); };
  return log;
}
const kette = ['shields', 'emitter_bow', 'emitter_stbd', 'emitter_aft', 'emitter_port'];

section('Messung: Bruchwahrscheinlichkeit je überstandenem Sprung (sp 0 bis 7)', () => {
  const g = newGame(11);
  const soll = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  console.log('  sp | soll  | ist     | n     | Grenze 3 sigma');
  for (let sp = 0; sp < 8; sp++) {
    let bruch = 0;
    for (let i = 0; i < LAEUFE; i++) {
      setz(g, 'emitter_bow', 'og');   // Relais ok, Leitung geflickt
      g.ship.komp.emitter_bow[1].sp = sp;
      K.sprungBruch(g);
      if (g.ship.komp.emitter_bow[1].z === 'defekt') bruch++;
    }
    const p = bruch / LAEUFE; const sigma = Math.sqrt(soll[sp] * (1 - soll[sp]) / LAEUFE);
    const grenze = sp === 7 ? 0 : 3 * sigma;
    console.log(`  ${sp}  | ${soll[sp].toFixed(2)}  | ${(100 * p).toFixed(1)} %  | ${LAEUFE} | +-${(100 * grenze).toFixed(1)} Pp`);
    ok(Math.abs(p - soll[sp]) <= grenze + 1e-12, `sp ${sp}: Bruchquote ${(100 * p).toFixed(1)} % (soll ${(100 * soll[sp]).toFixed(0)} %, Toleranz 3 sigma +-${(100 * grenze).toFixed(1)} Pp${sp === 7 ? ', exakt' : ''})`);
  }
  ok([0, 1, 2, 4, 5, 6, 7].every((sp) => Math.abs(K.sprungBruchChance(g, sp) - (0.3 + 0.1 * sp)) < 1e-12), 'Formel p = 0,3 + 0,1 * sp');
  ok(Math.abs(K.sprungBruchChance(g, 3) - 0.6) < 1e-12 && K.sprungBruchChance(g, 8) === 1 && K.sprungBruchChance(g, 99) === 1, 'sp 3 = 0,6; ab sp 7 sicher');
});

section('Zähler: sp zählt beim Überstehen, bricht sicher beim 8. Sprung, neuer Flicken beginnt bei 0', () => {
  const g = newGame(12);
  setz(g, 'emitter_aft', 'od');
  fest(g, 0.9999999);   // überlebt jeden Wurf mit p < 1
  ok(K.flickenKomponente(g, 'emitter_aft') && z(g, 'emitter_aft') === 'og' && g.ship.komp.emitter_aft[1].sp === 0, 'frischer Flicken: geflickt, sp 0');
  for (let i = 1; i <= 7; i++) { K.sprungBruch(g); ok(z(g, 'emitter_aft') === 'og' && g.ship.komp.emitter_aft[1].sp === i, `Sprung ${i}: überstanden, sp ${i}`); }
  K.sprungBruch(g);
  ok(z(g, 'emitter_aft') === 'od' && g.ship.komp.emitter_aft[1].sp === 0, '8. Sprung (sp 7, p 1): bricht sicher, sp 0');
  ok(K.flickenKomponente(g, 'emitter_aft') && g.ship.komp.emitter_aft[1].sp === 0, 'neuer Flicken nach dem Bruch beginnt bei sp 0');
  setz(g, 'emitter_aft', 'od'); g.ship.komp.emitter_aft[1].sp = 5;   // Altlast im Zähler: der Flicken setzt ihn zurück
  K.flickenKomponente(g, 'emitter_aft');
  ok(z(g, 'emitter_aft') === 'og' && g.ship.komp.emitter_aft[1].sp === 0, 'Flicken setzt sp auf 0 (auch bei Rest-Zähler)');
  setz(g, 'emitter_aft', 'od');
  fest(g, 0.29);
  K.sprungBruch(g);
  ok(z(g, 'emitter_aft') === 'od', 'bei sp 0 gilt wieder p 0,3 (Wurf 0,29 bricht)');
  setz(g, 'emitter_aft', 'og'); g.ship.komp.emitter_aft[1].sp = 0; fest(g, 0.31);
  K.sprungBruch(g);
  ok(z(g, 'emitter_aft') === 'og' && g.ship.komp.emitter_aft[1].sp === 1, 'sp 0: Wurf 0,31 übersteht (Grenze 0,3)');
  // Tausch setzt sp ebenfalls zurück
  g.ship.komp.emitter_aft[1].sp = 4;
  K.tauschenKomponente(g, 'emitter_aft', 'L');
  ok(g.ship.komp.emitter_aft[1].sp === 0 && z(g, 'emitter_aft') === 'oo', 'Tausch: sp 0');
});

section('Bruch: Komponente wieder defekt, n unverändert, Zustand abgeleitet, Ereignis, ODA', () => {
  const g = newGame(13);
  const log = lausche(g);
  setz(g, 'emitter_bow', 'go');
  g.ship.komp.emitter_bow[0].n = 2; g.ship.komp.emitter_bow[0].sp = 3;
  const sys0 = g.ship.systems.emitter_bow;
  fest(g, 0);
  const res = K.sprungBruch(g);
  const k = g.ship.komp.emitter_bow[0];
  ok(k.z === 'defekt' && k.n === 2 && k.sp === 0, 'Relais: defekt, Ausfallzähler n bleibt 2 (kein zusätzlicher Ausfall), sp 0');
  ok(sys0 === 'ok' && g.ship.systems.emitter_bow === 'damaged' && K.abgeleitet(g, 'emitter_bow') === 'damaged', 'Systemzustand abgeleitet: ok -> damaged');
  ok(I.integOf(g, 'emitter_bow') === I.integAusZustand(g, 'emitter_bow', 'damaged'), 'Integrität folgt');
  ok(res.length === 1 && res[0].system === 'emitter_bow' && res[0].komp === 'R', 'Rückgabe: ein gebrochener Flicken');
  const fg = log.ev.filter((e) => e.name === 'flickGebrochen');
  ok(fg.length === 1 && fg[0].p.system === 'emitter_bow' && fg[0].p.komp === 'R', 'Ereignis flickGebrochen { system, komp }');
  ok(log.ev.some((e) => e.name === 'systemHit' && e.p.system === 'emitter_bow' && e.p.state === 'damaged'), 'Ereignis systemHit wie bei einem Treffer');
  ok(log.ev.some((e) => e.name === 'sfx' && e.p.name === 'hull_hit'), 'Sfx wie bei einem Treffer');
  ok(log.oda.some((t) => t === 'Notflicken gebrochen: Relais am Bug-Emitter.'), 'ODA-Zeile: ' + JSON.stringify(log.oda.filter((t) => /Notflicken/.test(t))));
  ok(g.ship.sysAnnounce && g.ship.sysAnnounce.list.some((e) => e.system === 'emitter_bow' && e.state === 'damaged'), 'Schadensansage über queueSystemAnnounce vorgemerkt');
  ok(K.konsistentAlle(g) === undefined && !g.ship.kompKorrekturen, 'Wächter musste nicht nachziehen (sauberer Pfad)');
  // damaged -> broken, mehrere Flicken in verschiedenen Systemen: eine gebündelte ODA-Zeile
  const g2 = newGame(14); const log2 = lausche(g2);
  setz(g2, 'shields', 'ggd'); setz(g2, 'emitter_stbd', 'og');
  fest(g2, 0);
  const res2 = K.sprungBruch(g2);
  ok(z(g2, 'shields') === 'ddd' && g2.ship.systems.shields === 'broken', 'Schildgenerator: damaged -> broken (K, S defekt zusätzlich zu R)');
  ok(res2.length === 3 && res2.map((r) => r.system + r.komp).join() === 'shieldsK,shieldsS,emitter_stbdL', 'feste Reihenfolge: System laut Konfig, dann Rezept: ' + res2.map((r) => r.system + r.komp).join());
  const zeilen = log2.oda.filter((t) => /Notflicken/.test(t));
  ok(zeilen.length === 1 && zeilen[0] === 'Notflicken gebrochen: Steuerkern am Schildgenerator, Spannungsregler am Schildgenerator, Leitung am Steuerbord-Emitter.', 'mehrere Brüche = eine gebündelte ODA-Zeile: ' + JSON.stringify(zeilen));
  ok(log2.ev.some((e) => e.name === 'sfx' && e.p.name === 'system_break'), 'Sfx system_break bei broken');
  // kein Flicken: nichts passiert, kein Zufall verbraucht
  const g3 = newGame(15); let zug = 0; const r3 = () => { zug++; return 0; }; r3.pick = (a) => a[0]; g3.ship.kompRng = r3;
  setz(g3, 'shields', 'odo');
  ok(K.sprungBruch(g3).length === 0 && zug === 0 && z(g3, 'shields') === 'odo', 'ohne Flicken: nichts bricht, kein Wurf');
  // genau ein Wurf je Flicken
  setz(g3, 'shields', 'ggg'); zug = 0; fest(g3, 0.9999999); const w = g3.ship.kompRng; let c3 = 0; g3.ship.kompRng = Object.assign(() => { c3++; return w(); }, { pick: w.pick });
  K.sprungBruch(g3);
  ok(c3 === 3, 'genau ein Wurf je Flicken (3 Flicken, ' + c3 + ' Würfe)');
});

section('Zufall nur über kompRng: game.rng bleibt unberührt', () => {
  const g = newGame(16);
  setz(g, 'shields', 'ggg'); setz(g, 'emitter_port', 'gg');
  const vor = g.rng(); const g2 = newGame(16); setz(g2, 'shields', 'ggg'); setz(g2, 'emitter_port', 'gg');
  for (let i = 0; i < 9; i++) K.sprungBruch(g2);
  ok(g2.rng() === vor, 'game.rng nach 9 Sprungbrüchen unverändert (gleicher nächster Wert)');
  const a = newGame(17), b = newGame(17);
  for (const g of [a, b]) { setz(g, 'shields', 'ggg'); for (let i = 0; i < 4; i++) K.sprungBruch(g); }
  ok(z(a, 'shields') === z(b, 'shields') && a.ship.komp.shields.map((k) => k.sp).join() === b.ship.komp.shields.map((k) => k.sp).join(), 'deterministisch bei gleichem Seed');
});

section('Pfad springeNach (auch Schnellsprung: jeder Hop zählt)', () => {
  const g = newWelt(21);
  setz(g, 'emitter_bow', 'og'); fest(g, 0.9999999);
  const von = g.ship.scene;
  const ziele = ['hafen', 'sund'].filter((o) => o !== von);
  Sprung.springeNach(g, ziele[0]);
  ok(g.ship.scene === ziele[0] && g.ship.komp.emitter_bow[1].sp === 1, 'springeNach direkt: ein Sprung gezählt (sp 1)');
  Sprung.springeNach(g, von); Sprung.springeNach(g, ziele[0]);
  ok(g.ship.komp.emitter_bow[1].sp === 3, 'drei Hops hintereinander: sp 3 (jeder Hop ein Sprung)');
  fest(g, 0);
  Sprung.springeNach(g, von);
  ok(z(g, 'emitter_bow') === 'od' && g.ship.systems.emitter_bow === 'damaged', 'Wurf 0: Flicken bricht beim Sprung, Zustand damaged');
  const reise = fs.readFileSync(path.join(__dirname, '..', 'server/sim/reise.js'), 'utf8');
  ok(/sprung\(\)\.springeNach\(game, ort\)/.test(reise), 'Quellscan: der Schnellsprung (reise.js) ruft je Hop springeNach');
});

section('Pfad Notsprung: Sprungbruch zuerst, dann Notsprung-Schaden', () => {
  const g = newWelt(22);
  const s = g.ship; s.helm.stage = 1; s.docked = false; s.dockedAt = null; s.x = 1000; s.y = 1000; s.vx = 0; s.vy = 0; s.speed = 0; s.reactorCtl.state = 'online';
  setz(g, 'emitter_aft', 'og');
  const log = lausche(g); fest(g, 0);
  ok(Sprung.notsprung(g) === null, 'Notsprung ausgeführt');
  ok(z(g, 'emitter_aft') === 'od', 'Notsprung bricht den Flicken');
  const iBruch = log.ev.findIndex((e) => e.name === 'flickGebrochen');
  const iKosten = log.ev.findIndex((e) => e.name === 'systemHit' && e.p.system !== 'emitter_aft');
  ok(iBruch >= 0 && iKosten > iBruch, `Reihenfolge: Sprungbruch (Ereignis ${iBruch}) vor Notsprung-Systemschaden (Ereignis ${iKosten})`);
  const defekt = s.komp.emitter_aft.filter((k) => k.z === 'defekt').length;
  ok(defekt === 1 && s.komp.emitter_aft[1].sp === 0, 'der Notsprung-Schaden behandelt das Flicken-System nicht ein zweites Mal (genau 1 defekt)');
});

section('Pfad Finale-Orbit-Ankunft zählt als Sprung', () => {
  const g = newWelt(23);
  const TRIBUN = require('./sim-finale-orbit.js').TRIBUN;
  Finale.ersetzen('boden', { bodenStarten: () => true });
  Finale.ersetzen('abspann', { beenden: () => true });
  g.weltsim.ruf.rom = TRIBUN; Kriegslage.tick(g, 'test');
  setz(g, 'emitter_stbd', 'og'); fest(g, 0);
  const a = Finale.waehlen(g); const b = Finale.bestaetigen(g);
  ok(!(a || b) && g.simSzene && g.simSzene.modus === 'finale', 'Finale-Orbit gestartet (' + (a || b || 'ok') + ')');
  ok(z(g, 'emitter_stbd') === 'od', 'Orbit-Ankunft bricht den Flicken (zählt als Sprung)');
  const g2 = newWelt(24);
  g2.weltsim.ruf.rom = TRIBUN; Kriegslage.tick(g2, 'test');
  setz(g2, 'emitter_stbd', 'og'); fest(g2, 0.9999999);
  Finale.waehlen(g2); Finale.bestaetigen(g2);
  ok(z(g2, 'emitter_stbd') === 'og' && g2.ship.komp.emitter_stbd[1].sp === 1, 'Orbit-Ankunft: Flicken überstanden, sp 1');
});

section('Nur die Schildkette: ship.fragile anderer Systeme bricht nicht beim Sprung', () => {
  const g = newWelt(25);
  for (const sys of ['weapon_bow', 'engines', 'transfer']) { g.ship.systems[sys] = 'ok'; g.ship.fragile = g.ship.fragile || {}; g.ship.fragile[sys] = true; }
  fest(g, 0);
  Sprung.springeNach(g, g.ship.scene === 'hafen' ? 'sund' : 'hafen');
  ok(['weapon_bow', 'engines', 'transfer'].every((sys) => g.ship.systems[sys] === 'ok' && g.ship.fragile[sys] === true), 'fragile-Systeme (weapon_bow, engines, transfer) unverändert ok und fragil');
  ok(!K.hatKomponenten(g, 'weapon_bow') && K.sprungBruch(g).length === 0, 'keine Komponenten: kein Sprungbruch');
});

section('Quellscan-Wächter: jeder Sprungpfad ruft sprungBruch', () => {
  const wurzel = path.join(__dirname, '..', 'server');
  const dateien = [];
  (function lauf(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) lauf(p); else if (/\.js$/.test(e.name)) dateien.push(p); } })(wurzel);
  const funde = []; const fehlen = [];
  for (const f of dateien) {
    const zeilen = fs.readFileSync(f, 'utf8').split(/\r?\n/);
    zeilen.forEach((t, i) => {
      if (!/emit\('(jump|notsprung)'/.test(t)) return;
      let start = i; while (start > 0 && !/^(async )?function\b/.test(zeilen[start])) start--;
      const block = zeilen.slice(start, i + 1).join('\n');   // vom Funktionskopf bis zum Ereignis
      const rel = path.relative(path.join(__dirname, '..'), f).replace(/\\/g, '/') + ':' + (i + 1);
      funde.push(rel);
      if (!/sprungBruch\(/.test(block)) fehlen.push(rel);
    });
  }
  console.log('  Fundstellen: ' + funde.join(', '));
  ok(funde.length >= 3, 'mindestens drei Sprungpfade gefunden (springeNach, Notsprung, Finale-Orbit): ' + funde.length);
  ok(fehlen.length === 0, 'jede Stelle mit emit(\'jump\'/\'notsprung\') hat sprungBruch im selben Block' + (fehlen.length ? ' – OHNE: ' + fehlen.join(', ') : ''));
});

console.log(`\n${n - fails}/${n} ok` + (fails ? `, ${fails} FEHLER` : ''));
process.exit(fails ? 1 : 0);
