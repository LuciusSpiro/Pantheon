'use strict';
// SUND-04a-3 Orbit: Orbit-Szene des Finales (kriegslage-szene.js finaleStarten, Modus 'finale', Daten content/welt/finale-werte.json werte.orbit_*). Direkt gegen die Game-Klasse, ohne Netz.
// Erwartungen aus dem Vertrag des Pakets, nicht aus dem Code:
//   Start nur mit Finale.bereit (keine zweite Szene) · Aufstellung nach Crewgröße (1, 2, 3) aus den Daten · Vorwarnung ≥ 8 s vor dem ersten Gegner · Sieg = Flaggschiff UND Wachschiffe weg,
//   Finale.orbitEnde('sieg') GENAU EINMAL, Phase boden, KEIN Sim-Tick · Niederlage (Notfallprotokoll) und Flucht (Sprung, Notsprung, Szenenwechsel) -> Neubeginn, kein Game Over ·
//   eigener Zufallsstrom (game.rng wird von der Szene nie direkt gezogen) · nicht speicherbar · Bot-Läufe mit echtem Kampf besiegen das Flaggschiff (solo, zu zweit, zu dritt).
//   node tools/test-finale-orbit.js [begriff …]   (npm run test:finale-orbit)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Finale = require('../server/sim/finale.js');
const Space = require('../server/sim/space.js');
const Szene = require('../server/sim/kriegslage-szene.js');
const Bot = require('./sim-finale-orbit.js');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
async function section(name, fn) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n' + name);
  try { await fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
}

const W = Finale.WERTE;
const TRIBUN = Bot.TRIBUN;
const HZ = CONFIG.tickHz;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-finale-orbit-'));
let seq = 0;
const run = (g, sek) => { for (let i = 0; i < Math.round(sek * HZ); i++) { g.ship.hull = Math.max(g.ship.hull, 100); g.step(); } };

function neu(o) {
  const opt = o || {};
  const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: opt.seed || 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const cs = [];
  for (let i = 0; i < (opt.crew || 1); i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 800) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'A' + i, name: 'A' + i, color: i }); cs.push(c);
  }
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: 'freie_fahrt' });
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  run(g, 1); g.space.enemies = [];
  return { g, cs };
}
const mitAngebot = (o) => { const t = neu(o); t.g.weltsim.ruf.rom = TRIBUN; Kriegslage.tick(t.g, 'test'); return t; };
const starte = (g) => { const a = Finale.waehlen(g); const b = Finale.bestaetigen(g); return a || b || null; };

// Zähler für Finale.orbitEnde (die Szene ruft über das Modulobjekt) und Boden-Stub
let enden = [];
const orig = Finale.orbitEnde;
Finale.orbitEnde = function (game, ausgang) { enden.push(ausgang); return orig.call(Finale, game, ausgang); };
let boden = 0;
Finale.ersetzen('boden', { bodenStarten: () => { boden++; return true; } });
Finale.ersetzen('abspann', { beenden: () => true });
const zurueck = () => { enden = []; boden = 0; };

const eigene = (g, S) => g.space.enemies.filter((e) => e.finaleS === S.id);
const verbuendete = (g, S) => (g.space.escorts || []).filter((q) => q.sim === S.id);
const toete = (g, e) => { e.hp = 1; Space.damageEnemy(g, e, 99999, e.x - 100, e.y, {}); };

(async () => {
  await section('Daten', () => {
    ok(Number(W.orbit_vorwarnung.wert) >= 8, 'Vorwarnung mindestens 8 s (' + W.orbit_vorwarnung.wert + ')');
    const fl = W.orbit_flaggschiff.wert;
    ok(fl.klasse === 'kreuzer' && fl.name && fl.kommandant && !/\b(Ada|Bo|Cem|A0|A1|A2)\b/.test(fl.name + fl.kommandant), 'Flaggschiff: Kreuzer, Name und Kommandant aus den Daten (kein Spielername)');
    for (const c of ['1', '2', '3']) {
      const w = W.orbit_wachschiffe.wert[c], v = W.orbit_verbuendete.wert[c];
      ok(w.length >= 1 && !w.includes('raider') && v.length >= 2 && v.length <= 3, `Crew ${c}: ${w.length} Wachschiffe (nie Jäger), ${v.length} Verbündete (2 bis 3)`);
      ok(1 + w.length + v.length <= CONFIG.flotte.max, `Crew ${c}: Schiffe der Szene ≤ ${CONFIG.flotte.max}`);
    }
    ok(W.orbit_wachschiffe.wert['1'].length <= W.orbit_wachschiffe.wert['2'].length && W.orbit_wachschiffe.wert['2'].length <= W.orbit_wachschiffe.wert['3'].length, 'Wachschiffe wachsen mit der Crewgröße (nicht abnehmend)');
    ok(W.orbit_sieg.wert === 'flaggschiff_und_wachschiffe', 'Siegbedingung dokumentiert');
  });

  await section('Start nur mit Finale.bereit', () => {
    zurueck();
    const a = neu(); // ohne Rang
    a.g.weltsim.finale = Finale.neu();
    a.g.weltsim.finale.phase = 'orbit';
    ok(Szene.finaleStarten(a.g, { hex: '1004' }) !== null, 'Kontrolle: mit Phase orbit baut die Funktion die Szene (Aufruf nur aus Finale.starten gedacht)');
    const b = neu();
    ok(Szene.finaleStarten(b.g, { hex: '1004' }) === null && !b.g.simSzene, 'ohne Phase orbit (nicht über Finale.starten): keine Szene');
    const c = neu(); c.g.weltsim.ruf.rom = TRIBUN - 1; Kriegslage.tick(c.g, 'test');
    ok(Finale.starten(c.g) === false && !c.g.simSzene && Finale.phase(c.g) === null, 'unter Tribun: Finale.starten baut nichts');
    const d = mitAngebot(); d.g.simSzene = { id: 99, phase: 'kampf', hex: '0505' };
    ok(Finale.starten(d.g) === false && d.g.simSzene.id === 99, 'in einer Sim-Szene: keine zweite Szene');
    const e = mitAngebot(); e.g.fadenSzene = { id: 1, phase: 'kampf' };
    ok(Finale.starten(e.g) === false && !e.g.simSzene, 'in einer Faden-Szene: keine zweite Szene');
    const f = mitAngebot(); f.g.weltsim.finale.phase = 'orbit'; f.g.fadenSzene = { id: 1, phase: 'kampf' };
    ok(Szene.finaleStarten(f.g, { hex: '1004' }) === null, 'der Szenenstart prüft selbst: Faden-Szene sperrt');
    const h = mitAngebot(); h.g.weltsim.finale.phase = 'orbit'; h.g.space.verfolgung = { id: 1 };
    ok(Szene.finaleStarten(h.g, { hex: '1004' }) === null, 'der Szenenstart prüft selbst: laufende Verfolgung sperrt');
    const j = mitAngebot(); j.g.weltsim.finale.phase = 'orbit'; j.g.simSzene = { id: 98, phase: 'kampf', hex: '0505' };
    ok(Szene.finaleStarten(j.g, { hex: '1004' }) === null && j.g.simSzene.id === 98, 'der Szenenstart prüft selbst: eine laufende Sim-Szene sperrt');
    // eine germanische Feldflotte im Hex darf keine zweite Szene auslösen (die Ankunft des Finales ist keine Sim-Szene)
    const k = mitAngebot(); const z = k.g.weltsim.zustand;
    z.flotten.push({ id: z.naechsteId++, fraktion: 'ger', heimat: '1005', ort: '1004', staerke: 8, kap: 8, befehl: 'rueckzug', ziel: '1005', warte: 0, versorgung: 1, angriff: null });
    starte(k.g);
    ok(k.g.simSzene && k.g.simSzene.modus === 'finale' && k.g.space.enemies.length === 0 && !(k.g.flotte && k.g.flotte.welle), 'Feldflotte im Hex: trotzdem nur die Orbit-Szene, keine Welle der Sim');
    const i = mitAngebot();
    ok(starte(i.g) === null && Finale.phase(i.g) === 'orbit' && i.g.simSzene && i.g.simSzene.modus === 'finale', 'mit Angebot und zweistufiger Bestätigung: Szene im Modus finale');
    ok(i.g.ship.scene === 'hrafnheim' && !i.g.ship.docked, 'die Crew steht im Orbit von Hrafnheim, nicht angedockt');
  });

  for (const crew of [1, 2, 3]) {
    await section(`Aufstellung nach Crewgröße ${crew}`, () => {
      zurueck();
      const t = mitAngebot({ crew }); const g = t.g;
      ok(starte(g) === null, 'Finale startet');
      const S = g.simSzene;
      const vb = verbuendete(g, S);
      ok(vb.length === W.orbit_verbuendete.wert[String(crew)].length && vb.every((q, i) => q.kind === W.orbit_verbuendete.wert[String(crew)][i] && q.ally), `Verbündete: ${vb.length}, Klassen wie in den Daten`);
      ok(vb.length >= 2 && vb.length <= 3, 'zwei bis drei römische Verbündete');
      ok(eigene(g, S).length === 0, 'in der Vorwarnung steht noch kein Gegner');
      const funk = t.cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'radio').map((m) => m.text);
      ok(funk.some((x) => /Orbit von Hrafnheim/.test(x) && /Naglfar/.test(x) && /Jarl Sigtrygg/.test(x) && /hart/.test(x)), 'Funk-Ankündigung nennt Flaggschiff, Kommandant und die Gefahr');
      run(g, Number(W.orbit_vorwarnung.wert) + 1);
      const es = eigene(g, S);
      const fl = es.filter((e) => e.flagg);
      ok(fl.length === 1 && fl[0].kind === 'kreuzer' && fl[0].name === W.orbit_flaggschiff.wert.name, 'genau ein Flaggschiff, Kreuzer, Name aus den Daten');
      const wach = es.filter((e) => !e.flagg).map((e) => e.kind).sort();
      ok(JSON.stringify(wach) === JSON.stringify(W.orbit_wachschiffe.wert[String(crew)].slice().sort()), `Wachschiffe ${wach.join('+')} wie in den Daten`);
      ok(es.every((e) => e.volk === 'ger') && !es.some((e) => e.kind === 'raider'), 'alle germanisch, kein Jäger');
      ok(1 + wach.length + vb.length <= CONFIG.flotte.max, 'höchstens ' + CONFIG.flotte.max + ' Schiffe');
      ok(S.kommandant.name === W.orbit_flaggschiff.wert.kommandant, 'Kommandant aus den Daten (kein Spielername)');
      const sz = g.snapshot().flotte && g.snapshot().flotte.sz;
      ok(sz && sz.p === 'f' && sz.kd === 'Jarl Sigtrygg', 'Szenenzeile: Finale mit Kommandant');
    });
  }

  await section('Vorwarnung', () => {
    zurueck();
    const t = mitAngebot(); const g = t.g; starte(g);
    const S = g.simSzene; const t0 = g.time; let erster = null;
    const funk0 = t.cs[0].inbox.filter((m) => m.kind === 'radio').length;
    ok(funk0 >= 1, 'Funk beim Eintreffen');
    for (let i = 0; i < 20 * HZ && erster == null; i++) { g.ship.hull = 100; g.step(); if (eigene(g, S).length) erster = g.time - t0; }
    const tonVon = (text) => { const e = t.cs[0].inbox.find((m) => m.t === 'event' && m.kind === 'radio' && m.text === text); return e && e.ton; };
    const FT = require('../content/welt/finale-werte.json').texte.orbit.funk;
    const ankunft = t.cs[0].inbox.find((m) => m.t === 'event' && m.kind === 'radio' && /Orbit von Hrafnheim/.test(m.text));
    ok(ankunft && ankunft.ton === 'meldung', 'Welle 5 (M1): Funk „Ankunft“ ist eine Meldung (Messing)');
    const gegnerFunk = t.cs[0].inbox.find((m) => m.t === 'event' && m.kind === 'radio' && /greifen an/.test(m.text));
    ok(!!gegnerFunk && gegnerFunk.ton === 'gefahr' && FT.gegner.indexOf('greifen an') > 0, 'Welle 5 (M1): Funk „gegner“ (sie greifen an) ist Gefahr (Rot)');
    ok(erster != null && erster >= 8, 'erster Gegner erst nach ' + (erster && erster.toFixed(1)) + ' s (≥ 8 s)');
    ok(g.snapshot().flotte.sz.p === 'f', 'danach Phase f');
  });

  await section('Sieg', () => {
    zurueck();
    const t = mitAngebot({ crew: 3 }); const g = t.g; starte(g); const S = g.simSzene;
    run(g, Number(W.orbit_vorwarnung.wert) + 1);
    const tick0 = g.weltsim.tickZahl;
    for (const e of eigene(g, S).filter((x) => !x.flagg)) toete(g, e);
    run(g, 2);
    ok(g.simSzene === S && Finale.phase(g) === 'orbit' && enden.length === 0, 'nur die Wachschiffe zerstört: KEIN Sieg (das Flaggschiff lebt)');
    toete(g, eigene(g, S).find((e) => e.flagg));
    run(g, 1);
    ok(enden.length === 1 && enden[0] === 'sieg', 'Finale.orbitEnde("sieg") genau einmal');
    { const e = t.cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'radio'); const sg = e.find((m) => /ist gefallen, die Wachschiffe sind weg/.test(m.text)); ok(!!sg && sg.ton === 'meldung' && e.filter((m) => /Orbit über Hrafnheim ist frei/.test(m.text)).every((m) => m.ton === 'meldung'), 'Welle 5 (M1): Funk „Sieg“ und „Orbit frei“ sind Meldungen (Messing)'); }
    ok(Finale.phase(g) === 'boden' && boden === 1, 'Phase boden, Boden einmal gestartet');
    ok(g.weltsim.tickZahl === tick0, 'KEIN Sim-Tick im Orbit-Sieg');
    run(g, 3);
    ok(enden.length === 1, 'auch nach Sekunden kein zweiter Aufruf');
    ok(!g.simSzene && g.phase !== 'end', 'Szene aufgeräumt, kein Spielende');
    const ch = (g.weltsim.chronik.liste || g.weltsim.chronik.eintraege || []);
    ok(JSON.stringify(g.weltsim.chronik).includes('Entscheidungsschlacht'), 'Chronik-Eintrag der Szene (Sieg)');
    zurueck();
    // Flaggschiff zuerst: die Wachschiffe brechen ab, Sieg ohne sie zu töten
    const u = mitAngebot({ crew: 2 }); const h = u.g; starte(h); const S2 = h.simSzene;
    run(h, Number(W.orbit_vorwarnung.wert) + 1);
    toete(h, eigene(h, S2).find((e) => e.flagg));
    run(h, 2);
    ok(enden.length === 1 && enden[0] === 'sieg', 'Flaggschiff zuerst: die Wachschiffe brechen ab, Sieg');
    zurueck();
  });

  await section('Niederlage und Flucht', () => {
    zurueck();
    let t = mitAngebot(); let g = t.g; starte(g);
    run(g, Number(W.orbit_vorwarnung.wert) + 1);
    let tick0 = g.weltsim.tickZahl;
    g.ship.hull = 0; g.step(); g.step();
    ok(enden.length === 1 && enden[0] === 'niederlage', 'Notfallprotokoll: orbitEnde("niederlage") einmal');
    { const e = t.cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'radio'); const nl = e.find((m) => /Die Lerche ist angeschlagen, die Linie bricht/.test(m.text)); const nb = e.find((m) => /Die Flotte im Orbit hat uns geschlagen/.test(m.text)); ok(!!nl && nl.ton === 'gefahr', 'Welle 5 (M1): Funk der Szene „Niederlage“ (die Linie bricht) ist Gefahr (Rot)'); ok(!!nb && nb.ton === 'meldung', 'Welle 5 (M1): der Neubeginn danach („beginnt von vorn“) ist eine Meldung (Messing)'); }
    ok(Finale.phase(g) === null && g.phase !== 'end' && !g.simSzene, 'Neubeginn: phase null, kein Game Over');
    ok(g.weltsim.tickZahl === tick0, 'kein Sim-Tick');
    ok(g.weltsim.finale.angebot === 1 && Finale.bereit(g).ok, 'das Angebot steht wieder');
    ok(starte(g) === null && Finale.phase(g) === 'orbit' && g.weltsim.finale.versuche === 2, 'zweiter Versuch startet');
    zurueck();
    // Flucht per Sprung (der Sprung-Tick ist der des Sprungs)
    t = mitAngebot(); g = t.g; starte(g); run(g, 3);
    tick0 = g.weltsim.tickZahl;
    Kriegslage.tick(g, 'sprung');
    ok(enden.length === 1 && enden[0] === 'flucht' && Finale.phase(g) === null, 'Sprung: orbitEnde("flucht"), Neubeginn');
    ok(g.weltsim.tickZahl === tick0 + 1, 'genau der eine Tick des Sprungs');
    ok(!g.simSzene, 'Szene aufgeräumt');
    zurueck();
    t = mitAngebot(); g = t.g; starte(g); run(g, Number(W.orbit_vorwarnung.wert) + 2);
    Kriegslage.tick(g, 'notsprung');
    ok(enden.length === 1 && enden[0] === 'flucht', 'Notsprung im Kampf: flucht');
    zurueck();
    // Szenenwechsel ohne Sprung
    t = mitAngebot(); g = t.g; starte(g); run(g, 2); tick0 = g.weltsim.tickZahl;
    g.debugGoto('ostia_nova', false);
    run(g, 1);
    ok(enden.length === 1 && enden[0] === 'flucht' && g.weltsim.tickZahl === tick0, 'Szenenwechsel: flucht, kein Tick');
    zurueck();
    // Flucht nach dem ersten Gegner: nur einmal, auch bei folgenden Takten
    t = mitAngebot(); g = t.g; starte(g); run(g, 14);
    Kriegslage.tick(g, 'sprung'); run(g, 3);
    ok(enden.length === 1, 'nach der Flucht kein zweiter Aufruf');
    zurueck();
  });

  await section('Zufallsstrom', () => {
    zurueck();
    const t = mitAngebot(); const g = t.g;
    const aufrufe = { gesamt: 0, szene: 0 };
    for (const k of Object.keys(g.rng)) {
      if (typeof g.rng[k] !== 'function') continue;
      const f = g.rng[k].bind(g.rng);
      g.rng[k] = (...a) => { aufrufe.gesamt++; const fr = (new Error().stack || '').split('\n')[2] || ''; if (/kriegslage-szene\.js/.test(fr)) aufrufe.szene++; return f(...a); };
    }
    starte(g); run(g, Number(W.orbit_vorwarnung.wert) + 2);
    ok(aufrufe.gesamt > 0, 'Kontrolle: der Zähler sieht die Ziehungen des Spiels (Spawn, Waffen: ' + aufrufe.gesamt + ')');
    ok(aufrufe.szene === 0, 'die Orbit-Szene selbst zieht nie aus game.rng');
    const a = mitAngebot({ seed: 3 }), b = mitAngebot({ seed: 91 });
    starte(a.g); starte(b.g);
    ok(a.g.simSzene.seed === b.g.simSzene.seed && a.g.simSzene.rng.zufall === b.g.simSzene.rng.zufall, 'eigener Strom: unabhängig vom Spielseed (gleicher Versuch, gleicher Strom)');
    const zA = a.g.weltsim.zustand.zufall, zB = b.g.weltsim.zustand.zufall;
    run(a.g, 14);
    ok(a.g.weltsim.zustand.zufall === zA && zA !== undefined && zB !== undefined, 'der Sim-Strom (zustand.zufall) bleibt unberührt');
  });

  await section('Nicht speicherbar', () => {
    zurueck();
    const t = mitAngebot(); const g = t.g; starte(g); run(g, 2);
    const save = Kriegslage.toSave(g);
    ok(!JSON.stringify(save).includes('finale') && !JSON.stringify(save).includes('Naglfar'), 'Weltstand trägt nichts von der Orbit-Szene');
    const c = neu(); Kriegslage.restore(c.g, JSON.parse(JSON.stringify(save)));
    ok(Finale.phase(c.g) === null && !c.g.simSzene, 'Laden: phase null, keine Szene');
  });

  // K7: Klasse, Fraktion, Volk und die Crew-Stufen kommen aus den Daten (finale-werte.json), nicht fest aus dem Code
  await section('Daten statt fester Zahlen (K7)', () => {
    zurueck();
    const FW = Finale.WERTE;
    const sz0 = FW.orbit_szene.wert, wach0 = FW.orbit_wachschiffe.wert, verb0 = FW.orbit_verbuendete.wert, hf0 = FW.orbit_flaggschiff.wert;
    try {
      FW.orbit_szene.wert = { klasse: 1, fraktion: 'kon', volk: 'rom' };
      const a = mitAngebot(); starte(a.g);
      const S = a.g.simSzene;
      ok(S && S.klasse === 1 && S.fraktion === 'kon' && S.kommandant.volk === 'rom', 'Klasse, Fraktion und Volk der Szene folgen den Daten (' + (S && [S.klasse, S.fraktion, S.kommandant.volk].join('/')) + ')');
      FW.orbit_szene.wert = sz0; zurueck();
      FW.orbit_wachschiffe.wert = { '1': wach0['1'], '2': wach0['2'] };   // keine Stufe 3: drei Spieler bekommen die groesste bekannte Stufe (2)
      FW.orbit_verbuendete.wert = { '1': verb0['1'], '2': verb0['2'] };
      const b = mitAngebot({ crew: 3 }); starte(b.g);
      ok(b.g.simSzene && b.g.simSzene.nWach === wach0['2'].length && b.g.simSzene.crew === 2, 'groesste Stufe der Daten ist die Grenze der Crewgroesse (drei Spieler, Daten bis 2: Stufe ' + (b.g.simSzene && b.g.simSzene.crew) + ')');
    } finally { FW.orbit_szene.wert = sz0; FW.orbit_wachschiffe.wert = wach0; FW.orbit_verbuendete.wert = verb0; FW.orbit_flaggschiff.wert = hf0; zurueck(); }
  });

  // K6 des Finale-Reviews: wirft der Szenenaufbau nach game.simSzene = S, bleibt keine Szene ohne Finale zurueck
  await section('Fehler im Aufbau: nichts bleibt halb stehen', () => {
    zurueck();
    const FL = require('../server/sim/flotte.js');
    const echt = FL.aufstellen; let n = 0;
    const t = mitAngebot(); const g = t.g;
    const von = g.ship.scene; const fehler = []; g.countError = (wo) => { fehler.push(wo); };   // der erwartete Fehler soll nicht in der Ausgabe landen
    FL.aufstellen = function () { n++; if (n >= 2) throw new Error('Test: Aufstellung wirft'); return echt.apply(FL, arguments); };
    let e;
    try { e = starte(g); } finally { FL.aufstellen = echt; }
    ok(n >= 2, 'Kontrolle: der erste Verbuendete stand schon, der zweite warf (' + n + ')');
    ok(e && e.code === 'start', 'Finale.bestaetigen meldet „start“ (nicht aufbaubar)');
    ok(!g.simSzene, 'game.simSzene ist zurueckgesetzt');
    ok(Finale.phase(g) === null && g.weltsim.finale.angebot === 1, 'das Finale steht auf null, das Angebot bleibt');
    ok(g.ship.scene === von, 'das Schiff ist zurueck am Ausgangsort (' + von + ', nicht ' + g.ship.scene + ')');
    ok(!(g.space.escorts || []).some((q) => q.sim), 'kein Verbuendeter der halben Szene bleibt stehen');
    ok(!g.flotte, 'kein Flottenzustand der halben Szene');
    ok(fehler.includes('finale-orbit-aufbau') && fehler.length === 1, 'der Fehler ist gezaehlt (genau einer, kein Folgefehler im Abbau: ' + fehler.join(',') + ')');
    const w = starte(g);
    ok(w === null && Finale.phase(g) === 'orbit' && g.simSzene && g.simSzene.modus === 'finale', 'ein zweiter Versuch ohne Fehler startet sauber');
    zurueck();
  });

  await section('Verrat gesperrt', () => {
    zurueck();
    const t = mitAngebot(); const g = t.g; starte(g); run(g, 14);
    const Verrat = require('../server/sim/verrat.js');
    const r = Verrat.pruefen(g, false);
    const TX = require('../content/flotte/verrat.json').weigerung;
    ok(r && r.code === 'finale' && r.text === TX.finale && TX.finale !== TX.hauptwelt && !/Roms Hauptwelt/.test(r.text), 'kein Verrat in der Entscheidungsschlacht, eigener Text ohne „Roms Hauptwelt“ (' + (r && r.code) + ')');
    zurueck();
  });

  await section('Bot-Läufe (echter Kampf)', async () => {
    zurueck();
    for (const [crew, seed] of [[1, 21], [2, 22], [3, 23]]) {
      const r = await Bot.lauf(seed, crew, { max: 400, tmp: TMP });
      console.log('       ' + Bot.zeile(r).trim());
      ok(r.ok && r.ausgang === 'sieg', `Crew ${crew}: der Bot besiegt das Flaggschiff (${r.dauer} s, Hülle ${r.huelle}, Verbündete verloren ${r.verbuendeteVerloren}/${r.verbuendete0})`);
      ok(r.ersterGegner >= 8 && r.tickDelta === 0 && r.maxSchiffe <= CONFIG.flotte.max, `Crew ${crew}: Vorwarnung ${r.ersterGegner} s, kein Sim-Tick, größte Last ${r.maxSchiffe}`);
      ok(r.snapMax <= CONFIG.net.snapMax - CONFIG.net.snapLuft, `Crew ${crew}: Snapshot max ${r.snapMax} B im Budget`);
    }
  });

  console.log(`\n${fails ? 'FEHLER: ' + fails + ' von ' + n + ' Prüfungen' : 'TEST-FINALE-ORBIT OK (' + n + ' Prüfungen)'}`);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
  process.exit(fails ? 1 : 0);
})();
