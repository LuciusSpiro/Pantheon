'use strict';
// FRE-03 B: Notruf-Takt der Reise-Ereignisse (server/sim/reise-ereignis.js taktNotruf/taktUpdate, Zahlen content/reise/werte.json takt_*). Prüft, in-process mit g.step() (30 Minuten Spielzeit kosten rund 4 s):
//   (a) 30 Minuten + 1 s ruhige Lage ohne Annehmen: genau 6 Takt-Notrufe, zu keinem Zeitpunkt mehr als 3 offen, Verfall vor Entstehen · (b) Außenteam: der Zähler steht · (c) Gegner im Sektor: er steht ·
//   (d) Solo-Pause: Zeit und Zähler stehen · (e) Gruppe: keine Pause, der Takt läuft · (f) Speichern und Laden bewahren takt und taktNr (schemagültig, Altstand) · (h) Ort im Hex-Umkreis 1 bis 3 und anfliegbar (100 Würfe je Hafen) ·
//   Sektor ohne Kandidaten: der Takt tut still nichts, der Zähler bleibt auf der Schwelle und versucht es erneut · Marken-Grenze (Funde bleiben) · ohne REISE_EREIGNISSE passiert nichts.        node tools/test-reise-takt.js
const fs = require('fs');
const path = require('path');
const F = require('./regie-fixture.js');
const Sektoren = require('../shared/sektoren.js');
const Weltstand = require('../server/weltstand.js');
const RE = require('../server/sim/reise-ereignis.js');
const B1 = require('../server/sim/faden-b1.js');
const Marken = require('../server/sim/marken.js');
const Space = require('../server/sim/space.js');
const CONFIG = require('../shared/config.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = async (t, f) => { console.log('\n' + t); await f(); };
const HZ = CONFIG.tickHz;
const W = RE.WERTE;
const SCHWELLE = Math.round(W.takt_s * HZ);
const LEBEN = Math.round(W.takt_leben_s * HZ);
const ENV = { REISE_EREIGNISSE: '1' };
const spiel = (o) => F.neuesSpiel(Object.assign({ crew: 1, seed: 7, env: ENV }, o || {}));
const lauf = (g, sek) => { for (let i = 0; i < Math.round(sek * HZ); i++) g.step(); };
const R = (g) => g.weltsim.reise;
const setzeHex = (g, h) => { g.ship.scene = Sektoren.ortVonHex(h); };
const HAEFEN = ['0305', '0603', '0105', '0504', '0704'];   // Ostia Nova, Kantenstein, Carrara, Hammerwerke, Raffinerie Lumen (Erkundung FRE-03)
const GER = '1003';

(async () => {
  await section('Werte: der Takt steht in den Daten', () => {
    ok(W.takt_s === 300 && W.takt_leben_s === 900 && W.takt_offen_max === 3 && W.takt_neuversuch_s === 5, 'takt_s 300 (5 min), takt_leben_s 900 (15 min), takt_offen_max 3, takt_neuversuch_s 5');
    ok(W.takt_ort.min === 1 && W.takt_ort.max === 3 && Number.isInteger(W.takt_tiefe) && W.takt_tiefe >= W.takt_ort.max, 'takt_ort 1 bis 3, takt_tiefe als Datenwert');
    ok(W.takt_leben_s <= W.takt_s * W.takt_offen_max, 'Lebensdauer höchstens takt_offen_max Takte: so sind es rechnerisch nie mehr als takt_offen_max offen');
  });

  await section('(a) 30 Minuten + 1 s ruhige Lage, nichts angenommen: genau 6 Takt-Notrufe, nie mehr als 3 offen', () => {
    const g = spiel().g;
    const z0 = g.time;
    ok(R(g).takt >= 0 && R(g).taktNr === 0, 'Ausgangslage: Zähler läuft, noch kein Takt-Notruf (Start-Sekunde schon gespielt)');
    let max = 0, gesehen = new Set(), ersterTick = null, tick = 0, ohneMarke = 0;
    const gesamt = (30 * 60 + 1) * HZ;
    for (let i = 0; i < gesamt; i++) {
      g.step(); tick++;
      const o = R(g).offen;
      if (o.length > max) max = o.length;
      for (const e of o) { if (!gesehen.has(e.marke)) { gesehen.add(e.marke); if (ersterTick == null) ersterTick = tick; } }
    }
    ok(R(g).taktNr === 6 && gesehen.size === 6, `genau 6 Takt-Notrufe (taktNr ${R(g).taktNr}, gesehen ${gesehen.size})`);
    ok(max <= W.takt_offen_max && max === 3, `zu jedem Zeitpunkt höchstens ${W.takt_offen_max} offen (Höchstwert ${max})`);
    ok(ersterTick != null && ersterTick <= SCHWELLE && ersterTick >= SCHWELLE - 2 * HZ, `der erste Takt-Notruf kommt nach 5 Minuten (Tick ${ersterTick} von ${SCHWELLE})`);
    ok(R(g).offen.every((e) => e.takt === true && e.hex && Marken.da(g, e.marke)), 'jeder offene Eintrag hat seine Marke (Eintrag und Marke gleich)');
    ok(g.errors === 0 && Math.abs(g.time - z0 - gesamt / HZ) < 0.5, 'keine Fehler, 30 Minuten Spielzeit gelaufen');
    const chr = (g.weltsim.chronik || []).filter((c) => c.art === 'reise' && /unbeantwortet/.test(c.kurz)).length;
    ok(chr === 3, `Verfall über die Chronik belegt: 3 unbeantwortet (${chr}), 3 noch offen`);
  });

  await section('Verfall vor Entstehen im selben Tick (Grenzfall: der 4. Notruf entsteht, wenn der 1. verfällt)', () => {
    const g = spiel().g;
    let max = 0;
    for (let i = 0; i < 4 * SCHWELLE + 5; i++) { g.step(); max = Math.max(max, R(g).offen.length); }
    ok(R(g).taktNr === 4 && R(g).offen.length === 3 && max === 3, `4 Takt-Notrufe nach 20 Minuten, nie mehr als 3 gleichzeitig (Höchstwert ${max})`);
  });

  await section('(b) Außenteam: der Zähler steht, nach der Rückkehr läuft er weiter', () => {
    const g = spiel().g;
    lauf(g, 60);
    const t0 = R(g).takt, nr0 = R(g).taktNr;
    g.players[0].zone = 'away';
    lauf(g, 600);
    ok(R(g).takt === t0 && R(g).taktNr === nr0, `Zähler steht im Außenteam (${t0} → ${R(g).takt}), kein Notruf in 10 Minuten`);
    g.players[0].zone = 'ship';
    lauf(g, 10);
    ok(R(g).takt === t0 + 10 * HZ, `nach der Rückkehr läuft er weiter (${t0} → ${R(g).takt})`);
  });

  await section('(c) Gegner im Sektor: der Zähler steht', () => {
    const g = spiel().g;
    lauf(g, 60);
    const t0 = R(g).takt;
    const e = Space.spawnEnemy(g, 'raider', { x: g.ship.x + 650, y: g.ship.y, facing: 0, tag: 'testgegner' });
    ok(!!e && g.space.enemies.length > 0, 'Gegner gesetzt');
    const dt = 0;   // der Gegner bleibt bestehen (er wird nicht entfernt), das Schiff kann beschossen werden; kurz genug für die Prüfung
    lauf(g, 20);
    ok(R(g).takt === t0 + dt, `Zähler steht bei Gegnern (${t0} → ${R(g).takt})`);
    g.space.enemies = [];
    lauf(g, 5);
    ok(R(g).takt === t0 + 5 * HZ, `ohne Gegner läuft er weiter (${R(g).takt})`);
  });

  await section('(d) Solo-Pause: game.time steht, kein Notruf', () => {
    const g = spiel().g;
    lauf(g, W.takt_s - 100);
    const t0 = R(g).takt, z0 = g.time, nr0 = R(g).taktNr;
    g.paused = true;
    lauf(g, 400);
    ok(g.paused && g.time === z0 && R(g).takt === t0 && R(g).taktNr === nr0 && R(g).offen.length === 0, 'Pause: Zeit, Zähler und Notrufe stehen (400 s über der Schwelle)');
    g.paused = false;
    lauf(g, 90);
    ok(R(g).taktNr === 0, 'nach der Pause (und 90 s) fehlt noch Zeit bis zur Schwelle: noch kein Notruf');
    lauf(g, 10);
    ok(R(g).taktNr === 1 && R(g).offen.length === 1, 'danach kommt der erste Notruf');
  });

  await section('(e) Gruppe mit 2 Spielern: keine Pause, der Takt läuft', () => {
    const g = spiel({ crew: 2 }).g;
    g.paused = true;
    const z0 = g.time;
    lauf(g, 1);
    ok(g.paused === false && g.time > z0, 'in der Gruppe gibt es keine Pause (die Zeit läuft)');
    lauf(g, W.takt_s + 2);
    ok(R(g).taktNr === 1 && R(g).offen.length === 1, 'der Takt läuft: nach 5 Minuten der erste Notruf');
    g.players[1].connected = false;
    const t0 = R(g).takt;
    lauf(g, 10);
    ok(R(g).takt === t0 + 10 * HZ, 'ein verbundener Spieler genügt');
    g.players[0].connected = false;
    const t1 = R(g).takt;
    lauf(g, 10);
    ok(R(g).takt === t1, 'ohne verbundenen Spieler steht der Zähler');
  });

  await section('(f) Speichern und Laden bewahren takt und taktNr', () => {
    const t = spiel(); const g = t.g;
    lauf(g, 650);
    const nr = R(g).taktNr, takt = R(g).takt;
    ok(nr === 2 && takt > 0, `Ausgangslage: taktNr ${nr}, takt ${takt}`);
    const d1 = JSON.parse(JSON.stringify(Weltstand.capture(g)));
    const b = d1.welt.sim.reise;
    ok(d1.version === 3 && b.taktNr === nr && b.takt === takt && !('offen' in b) && !('taktUhr' in b), 'Weltstand Version 3 trägt takt und taktNr (Notrufe, Uhr und Ids stehen nicht darin)');
    const v = Weltstand.validate(d1);
    ok(v.length === 0, 'schemagültig' + v.slice(0, 2).map((x) => ' – ' + x).join(''));
    const dir = F.freshDir(); d1.id = 'w-takt'; fs.writeFileSync(path.join(dir, 'w-takt.json'), JSON.stringify(d1));
    const g2 = spiel({ dir, world: 'w-takt' }).g;
    ok(g2.phase === 'play' && g2.errors === 0 && R(g2).taktNr === nr && R(g2).takt >= takt && R(g2).takt <= takt + 2 * HZ, `Laden: taktNr ${R(g2).taktNr}, takt ${R(g2).takt} (gespeichert ${takt}, dazu die Start-Sekunde)`);
    const rt = RE.lesen(JSON.parse(JSON.stringify(RE.toSave(g.weltsim))));
    ok(rt.takt === takt && rt.taktNr === nr, 'lesen(toSave(...)) gibt beide Zähler zurück');
    const alt = JSON.parse(JSON.stringify(d1)); delete alt.welt.sim.reise.takt; delete alt.welt.sim.reise.taktNr; alt.id = 'w-takt-alt';
    ok(Weltstand.validate(alt).length === 0 && RE.lesen(alt.welt.sim.reise).takt === 0 && RE.lesen(alt.welt.sim.reise).taktNr === 0, 'Altstand ohne takt und taktNr: schemagültig, beide 0');
    const m = RE.lesen({ n: 1, takt: -5, taktNr: 'x' });
    ok(m.takt === 0 && m.taktNr === 0 && RE.lesen({ takt: 1e15, taktNr: 1e15 }).takt === 1e9, 'Leser: Müll = 0, zu große Werte werden geklemmt');
    ok(RE.toSave({ reise: Object.assign(RE.neu(), { takt: 5 }) }).takt === 5 && RE.toSave({ reise: RE.neu() }) === null, 'toSave: nur mit Zählern (leer = null wie zuvor)');
    // Weiterspielen nach dem Laden: der nächste Takt-Notruf kommt mit derselben Nummer und dem Zufall der Nummer
    const nrNeu = (x) => { const o = x.weltsim.reise.taktNr; lauf(x, 400); return [o, x.weltsim.reise.taktNr, (x.weltsim.reise.offen.slice(-1)[0] || {}).id]; };
    const a = nrNeu(g2);
    ok(a[1] === 3 && !!a[2], `nach dem Laden entsteht der 3. Takt-Notruf (${a.join(' ')})`);
  });

  await section('(h) Ort im Hex-Umkreis 1 bis 3 und anfliegbar: 100 Würfe je Hafen, kein toter Haken', () => {
    const g = spiel().g;
    for (const h of HAEFEN) {
      setzeHex(g, h);
      const weg = B1.erreichbar(g, h, W.takt_tiefe);
      let nichts = 0, aussen = 0, tot = 0, ids = new Set(), orte = new Set();
      for (let i = 0; i < 100; i++) {
        R(g).taktNr = i; R(g).offen = []; R(g).taktIds = [];
        const ev = RE.taktNotruf(g);
        if (!ev) { nichts++; continue; }
        const d = Sektoren.hexAbstand(h, ev.hex);
        if (d < W.takt_ort.min || d > W.takt_ort.max) aussen++;
        if (!(weg.get(ev.hex) >= 1)) tot++;
        ids.add(ev.id); orte.add(ev.hex);
      }
      ok(nichts === 0 && aussen === 0 && tot === 0, `${Sektoren.hexName(h)} ${h}: 100 Würfe, ${orte.size} Orte, ${ids.size} Einträge, ${nichts} ohne, ${aussen} außerhalb 1 bis 3, ${tot} nicht anfliegbar`);
    }
    // belegt: nie zwei Notrufe am selben Ort
    setzeHex(g, '0305'); R(g).offen = []; R(g).taktNr = 0;
    const belegt = new Set();
    for (let i = 0; i < 6; i++) { R(g).taktNr = i; const ev = RE.taktNotruf(g); if (!ev) break; ok(!belegt.has(ev.hex), `Ort ${ev.hex} noch nicht belegt`); belegt.add(ev.hex); R(g).offen.push({ hex: ev.hex, nr: ev.nr, takt: true }); }
    ok(belegt.size === 6 || belegt.size >= 3, 'mehrere Orte nacheinander, nie ein belegter');
    R(g).offen = Array.from({ length: W.takt_offen_max }, (_, i) => ({ hex: '9999', nr: -i, takt: true }));
    ok(RE.taktNotruf(g) === null, 'bei takt_offen_max offenen Notrufen entsteht keiner');
    // Zufall: gleiche Nummer = gleicher Wurf (Salz taktNr), andere Nummer = anderer Wurf
    R(g).offen = [];
    R(g).taktNr = 7; const e1 = RE.taktNotruf(g); const e2 = RE.taktNotruf(g);
    ok(e1 && e2 && e1.id === e2.id && e1.hex === e2.hex && e1.textIdx === e2.textIdx, 'gleiche Nummer, gleicher Wurf (eigener, zählerbasierter Strom)');
  });

  await section('Sektor ohne Kandidaten: der Takt tut still nichts, versucht es erneut, kein Reset', () => {
    // FRE-03 C: seit dem erweiterten Katalog hat jeder Sektor Kandidaten (test-reise-katalog.js). Den Fall ohne Kandidaten stellt der Test her: für diesen Lauf stehen keine Einträge für Germanengebiet im Katalog.
    const kopie = RE.KATALOG.slice();
    RE.KATALOG.splice(0, RE.KATALOG.length, ...kopie.filter((e) => !(e.bedingungen.besitzer || []).includes('ger')));
    try {
      const g = spiel().g;
      setzeHex(g, GER);
      ok(RE.taktNotruf(g) === null, `im Germanengebiet ${GER} gibt es ohne Katalogeinträge für ger keinen Notruf: taktNotruf gibt null`);
      lauf(g, W.takt_s + 60);
      ok(g.errors === 0 && R(g).taktNr === 0 && R(g).offen.length === 0 && R(g).takt === SCHWELLE, `kein Absturz, kein Notruf, der Zähler bleibt auf der Schwelle (${R(g).takt} von ${SCHWELLE})`);
      setzeHex(g, '0305');
      lauf(g, W.takt_neuversuch_s + 1);
      ok(R(g).taktNr === 1 && R(g).takt < (W.takt_neuversuch_s + 1) * HZ && R(g).offen.length === 1, 'zurück in einem Sektor mit Kandidaten: höchstens nach takt_neuversuch_s kommt der Notruf');
    } finally { RE.KATALOG.splice(0, RE.KATALOG.length, ...kopie); }
  });

  await section('Marken-Grenze: Notruf-Marken verdrängen keine Fund-Marken (Marken.MAX)', () => {
    const g = spiel().g;
    const funde = [];
    for (let i = 0; i < Marken.MAX; i++) { const id = 'fund:t' + i; funde.push(id); Marken.setze(g, { id, typ: 'fund', hex: HAEFEN[i % 5], ticks: 100 }); }
    const vor = Marken.snapshot(g).filter((m) => m.t === 'fund').length;
    lauf(g, W.takt_s + 2);
    const snap = Marken.snapshot(g);
    ok(R(g).taktNr === 1 && Marken.da(g, R(g).offen[0].marke), 'Ausgangslage: der Notruf entstand, seine Marke liegt in der Liste (unsichtbar, solange die Karte voll ist)');
    ok(vor === Marken.MAX && snap.filter((m) => m.t === 'fund').length === Marken.MAX && snap.length === Marken.MAX && !snap.some((m) => m.t === 'notruf'), `bei voller Markenliste (${Marken.MAX}) bleiben alle Fund-Marken, die Notruf-Marke wartet`);
    // sobald Platz ist, wird sie sichtbar
    Marken.entferne(g, funde[0]);
    ok(Marken.snapshot(g).some((m) => m.t === 'notruf'), 'wird ein Fund frei, erscheint die Notruf-Marke');
  });

  await section('Ohne REISE_EREIGNISSE passiert nichts', () => {
    const g = spiel({ env: { REISE_EREIGNISSE: '0' } }).g;
    lauf(g, W.takt_s * 2 + 10);
    const r = g.weltsim && g.weltsim.reise;
    ok(!r || (r.takt === 0 && r.taktNr === 0 && r.taktUhr === 0 && r.offen.length === 0), 'kein Zähler, kein Notruf');
    ok(RE.toSave(g.weltsim) === null && (g.marken || []).length === 0 && g.errors === 0, 'nichts im Weltstand, keine Marke, keine Fehler');
  });

  console.log(`\n${n - fails}/${n} Prüfungen bestanden.`);
  process.exit(fails ? 1 : 0);
})();
