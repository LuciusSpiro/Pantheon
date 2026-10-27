'use strict';
// EK4/EK8 Kapitel 6 „Orbitschlacht Eisenwald“ (VERK-ORBIT): die echte Flottenszene in der Kette (content/regiebuecher/k6_orbit.regiebuch.json)
// und die Reaktion des Kapitels 8 darauf. Direkt gegen die Game-Klasse, ohne Netz.   node tools/test-orbit.js [begriff …]   (npm run test:orbit)
// Geprüft: Verbündete tauchen bei Eisenwald auf, drei Befehle (Fortschritt nur durch erreichte Ziele), Leiter bei Scheitern (zweimal von vorn, dann
// „Rom übernimmt“, nie ein Freibrief), Verlust und Ersatzbefehl, Flags der Schnittstelle (genau eine legat_*), Weltstand (Fakt, Gedächtnis),
// Rückzug, flightV2 im Kapitelbuch, Kapitel 8 (Funk und Abspann nach Gedächtnis und Verlusten).
const fs = require('fs');
const os = require('os');
const path = require('path');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Escort = require('../server/sim/escort.js');
const Flotte = require('../server/sim/flotte.js');
const Pilot = require('../server/sim/pilot.js');
const Sprung = require('../server/sim/sprung.js');
const Loader = require('../server/mission/loader.js');
const Checker = require('../server/mission/checker.js');
const Kampagne = require('../server/mission/kampagne.js');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
function ok(c, msg) { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); }
function section(name, fn) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n[' + name + ']');
  try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-orbit-'));
let seq = 0;
const t0 = Date.now();

// Partie mit der Kette (ohne Tutorial), Einstieg Kapitel k6 (Castra Martis), dann Flug nach Eisenwald bis zum Schritt 'ankunft'
function start(np, opts) {
  const o = opts || {};
  const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: o.seed || 7, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const cs = [];
  for (let i = 0; i < (np || 1); i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 600) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'O' + i, name: 'O' + i, color: i }); cs.push(c);
  }
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: 'eisenwald_ohne' });
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  run(g, 0.5);
  g.mission.kette.einstieg(o.kapitel || 'k6_orbit'); run(g, 0.3);
  const events = []; const emit0 = g.emit.bind(g); g.emit = (kind, data) => { events.push(Object.assign({ kind }, data)); return emit0(kind, data); };
  const t = { g, cs, dir, events, ev: (k) => events.filter((e) => e.kind === k), radios: () => cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'radio') };
  if (!o.kapitel) { space.enterScene(g, 'eisenwald', {}); g.god = true; run(g, 12); }
  return t;
}
const run = (g, sek, each) => { const k = Math.round(sek * CONFIG.tickHz); for (let i = 0; i < k; i++) { if (each) each(i); g.step(); } };
const stage = (g) => g.mission.state.stage;
const aktiv = (g) => g.mission.activeId;
const flags = (g) => g.mission.flags;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const ally = (g, tag) => (g.space.escorts || []).find((q) => q.ally && q.tag === tag);
const enemies = (g, kind) => g.space.enemies.filter((e) => !kind || e.kind === kind);
function platz(g, x, y) { const s = g.ship; s.x = x; s.y = y; s.vx = 0; s.vy = 0; s.speed = 0; }
function verwunden(g, tag, dmg) { const es = ally(g, tag); es.einBis = 0; Escort.hit(g, es, dmg || 500, {}); }
function toeten(g, e) { e.hp = 1; space.damageEnemy(g, e, 50, e.x - 100, e.y, {}); }
function bis(g, f, maxSek, ticksPro) { for (let i = 0; i < maxSek * CONFIG.tickHz; i++) { if (f()) return true; g.step(); } return !!f(); }
// direkt in den Schritt (Befehl 1 / 2 / 3), die Vorgeschichte entfällt
function vor(t, ziel) { t.g.mission.setStep(ziel); run(t.g, 0.5); return stage(t.g) === ziel; }
// den Befehl scheitern lassen (Frist abgelaufen), bis zum Neustart warten (7 s Ansage)
function scheitern(g) { const b = g.flotte.befehl; if (b && b.st === 0) b.t0 -= 5000; run(g, 0.3); }

section('Kettendatei und Buch: kein Platzhalter mehr', () => {
  const doc = Kampagne.lesen('eisenwald');
  const { books } = Loader.loadAll();
  const k6 = books.k6_orbit;
  ok(!k6.steps.some((s) => s.platzhalter), 'k6: kein Schritt trägt platzhalter');
  ok(!(doc.kapitel.find((c) => c.id === 'k6_orbit').platzhalter || []).length, 'Kettendatei: k6 ohne Platzhalterliste');
  ok(!Kampagne.platzhalter(doc, books).some((p) => p.kapitel === 'k6_orbit'), 'Kampagne.platzhalter() nennt k6 nicht');
  ok(Checker.check(k6).ok && Checker.check(books.k8_sieg).ok, 'Prüfer grün für k6 und k8');
  const ids = k6.steps.map((s) => s.id).join();
  ok(ids === 'auftrag,k6_anflug,ankunft,befehl1_durchbrechen,befehl2_entlastung,befehl3_ausschalten', 'Schritte unverändert benannt: ' + ids);
  ok(k6.besetzung.schiffe.fulminata.kind === 'korvette' && k6.besetzung.schiffe.audax.kind === 'korvette' && k6.besetzung.stimmen.mars && k6.besetzung.stimmen.legat, 'Besetzung: Fulminata und Audax als Korvetten, Stimmen Mars und Legat');
});

section('Verbündete tauchen bei Eisenwald auf, flightV2 im Kapitelbuch', () => {
  const t = start(1); const g = t.g;
  ok(g.mission.flightV2() === true && Pilot.active(g) === true, 'flightV2 und Pilot.active in einem Kapitelbuch (Breitseiten-KI der Fregatte)');
  g.mission.setStep('ankunft'); run(g, 0.2);
  const F = ally(g, 'fulminata'), A = ally(g, 'audax');
  ok(F && A && F.kind === 'korvette' && A.kind === 'korvette' && F.ally && A.ally, 'Fulminata und Audax als Korvetten (ally)');
  ok(F.einBis > g.time && A.einBis > g.time, 'tauchen auf: unverwundbar im Einblenden (auftauchen)');
  const funk = t.radios().map((r) => r.text).join(' | ');
  ok(/Da seid ihr! Rom fährt die Sperrflotte nieder/.test(funk), 'Funk beim Auftauchen (Legat, Text aus den Funktexten)');
  const sp = t.ev('allyEintritt');
  ok(['fulminata', 'audax'].every((tag) => sp.some((e) => e.tag === tag)), 'Ereignis allyEintritt (Sprungblitz) für beide Schiffe');
  // das Tutorial bleibt auf der alten KI (art mission)
  const alt = g.mission.def; g.mission.def = { kopf: { art: 'mission' } };
  ok(g.mission.flightV2() === false, 'Buch mit art mission (Tutorial): flightV2 aus');
  g.mission.def = alt;
  g.releaseWorldLock();
});

section('Befehl 1 Durchbrechen: Fortschritt nur durch erreichte Wegpunkte', () => {
  const t = start(1); const g = t.g;
  g.mission.setStep('ankunft'); run(g, 9);
  ok(stage(g) === 'befehl1_durchbrechen', 'nach der Ankunft: Befehl 1 (' + stage(g) + ')');
  const b = g.flotte.befehl;
  ok(b && b.art === 'durchbrechen' && b.wp.length === 2 && b.frist === 200, 'Befehl durchbrechen mit 2 Wegpunkten und Frist 200 s');
  ok(g.flotte.welle && g.flotte.welle.liste.length === 2 && g.flotte.welle.ueberdruck === true, 'Wellen mit Überdruck');
  ok(/brecht durch die Orbitalabwehr/.test(t.radios().map((r) => r.text).join('|')), 'Funkspruch des Legaten (Befehl)');
  // Zeit allein bringt nichts; alle Gegner tot bringt auch nichts
  run(g, 60); for (const e of enemies(g).slice()) toeten(g, e); run(g, 20);
  ok(stage(g) === 'befehl1_durchbrechen' && b.st === 0, 'Gegner tot und Zeit vergangen: Befehl bleibt offen (nur Wegpunkte zählen)');
  platz(g, b.wp[0].x, b.wp[0].y); run(g, 0.5);
  ok(b.idx === 1 && stage(g) === 'befehl1_durchbrechen', 'erster Wegpunkt erreicht, zweiter fehlt');
  platz(g, b.wp[1].x, b.wp[1].y); run(g, 1);
  ok(stage(g) === 'befehl2_entlastung', 'beide Wegpunkte: Befehl 2 (' + stage(g) + ')');
  g.releaseWorldLock();
});

section('Befehl 2 Entlastung: Abschüsse nur nahe am bedrängten Schiff, Schiff hält Stellung', () => {
  const t = start(1); const g = t.g;
  g.mission.setStep('ankunft'); run(g, 0.2); vor(t, 'befehl2_entlastung');
  const b = g.flotte.befehl; const F = ally(g, 'fulminata');
  ok(stage(g) === 'befehl2_entlastung' && b.art === 'entlastung' && b.schiff === 'fulminata' && b.n === 3 && b.radius === 420, 'Befehl entlastung für die Fulminata (n 3, Radius 420)');
  ok(F.skript && F.skript.modus === 'halten', 'die Fulminata hält Stellung (die Lerche muss zu ihr)');
  run(g, 3);
  ok(enemies(g).length > 0 && g.flotte.welle.ziel === 'verbuendet', 'Wellen greifen die Verbündeten an');
  // fern vom Schiff erlegt zählt nicht
  platz(g, Math.min(2800, F.x + 1500), F.y); for (const e of enemies(g).slice(0, 3)) toeten(g, e); run(g, 0.3);
  ok(b.k === 0 && b.st === 0, 'Abschüsse fern vom Schiff zählen nicht');
  for (let i = 0; i < 6 && b.st === 0; i++) { platz(g, F.x + 150, F.y); for (const e of enemies(g).slice(0, 2)) toeten(g, e); run(g, 4); }
  ok(b.st === 1 || stage(g) === 'befehl3_ausschalten', 'nahe am Schiff: Befehl erfüllt (' + stage(g) + ')');
  run(g, 1);
  ok(stage(g) === 'befehl3_ausschalten', 'Befehl 3 (' + stage(g) + ')');
  ok(g.flotte.befehl.art === 'ausschalten' && ally(g, 'fulminata').skript.modus === 'folgen', 'Fulminata folgt wieder der Lerche');
  g.releaseWorldLock();
});

section('Leiter bei Scheitern: zweimal von vorn, danach Rom übernimmt (nie ein Freibrief)', () => {
  const t = start(1); const g = t.g;
  g.mission.setStep('ankunft'); run(g, 9);
  const r1 = () => flags(g);
  scheitern(g); run(g, 8);
  ok(r1().k6_b1_r1 === true && !r1().k6_b1_r2 && stage(g) === 'befehl1_durchbrechen' && g.flotte.befehl.st === 0 && g.flotte.befehl.frist === 200, 'Scheitern 1: von vorn (Befehl neu, Frist wie vorher)');
  scheitern(g); run(g, 8);
  ok(r1().k6_b1_r2 === true && !r1().k6_b1_r3 && g.flotte.befehl.st === 0 && g.flotte.befehl.frist === 200, 'Scheitern 2: noch einmal von vorn');
  scheitern(g);
  ok(t.radios().some((r) => /Rom übernimmt den Flankenschutz/.test(r.text) && r.from === 'Mars'), 'Scheitern 3: Funkspruch „Rom übernimmt“ (Mars)');
  run(g, 8);
  const b = g.flotte.befehl;
  ok(r1().k6_b1_r3 === true && b.st === 0 && b.frist === 0 && g.flotte.welle.ueberdruck === false && g.flotte.welle.liste.length === 1, 'Rom-Stufe: ohne Frist, ohne Überdruck, kleinere Welle');
  ok(stage(g) === 'befehl1_durchbrechen', 'Fortschritt bleibt das Ziel: Szene läuft weiter (' + stage(g) + ')');
  run(g, 400);
  ok(stage(g) === 'befehl1_durchbrechen' && b.st === 0, 'Zeit allein bringt auch in der Rom-Stufe nichts');
  scheitern(g); g.flotte.befehl.st = 2; g.flotte.befehl.grund = 'notfall'; run(g, 8);
  ok(g.flotte.befehl.st === 0 && stage(g) === 'befehl1_durchbrechen', 'Scheitern in der Rom-Stufe (Notfallprotokoll): wieder von vorn, kein Softlock');
  platz(g, g.flotte.befehl.wp[0].x, g.flotte.befehl.wp[0].y); run(g, 0.5); platz(g, g.flotte.befehl.wp[1].x, g.flotte.befehl.wp[1].y); run(g, 1);
  ok(stage(g) === 'befehl2_entlastung', 'erst das erreichte Ziel führt weiter');
  g.releaseWorldLock();
});

section('Verlust: Hilferuf, Ersatzbefehl, Flags, Weltstand (Gedächtnis des Legaten)', () => {
  const t = start(1); const g = t.g;
  g.mission.setStep('ankunft'); run(g, 0.2); vor(t, 'befehl2_entlastung');
  const F = ally(g, 'fulminata'); const A = ally(g, 'audax');
  platz(g, F.x + 1400, F.y);   // die Lerche ist weit weg: im Stich gelassen
  verwunden(g, 'fulminata'); run(g, 0.5);
  const funk = t.radios().map((r) => r.text).join(' | ');
  ok(/Rettungskapsel ausgestoßen. Ich lebe, Lerche/.test(funk), 'Verlust der Fulminata: theatralischer Funkspruch des Legaten');
  ok(flags(g).fulminata_verloren === true && flags(g).legat_im_stich === true, 'Flags fulminata_verloren und (intern) legat_im_stich');
  ok(g.weltstand.data.fakten.flotte_fulminata === 'verloren' && g.weltstand.data.npc.legat.status === 'lebt', 'Fakt flotte_fulminata, Legat lebt');
  ok(g.flotte.befehl.st === 2 && g.flotte.befehl.grund === 'schiff', 'Befehl Entlastung gescheitert (Schiff verloren)');
  run(g, 9);
  ok(stage(g) === 'befehl2_entlastung' && g.flotte.befehl.art === 'entlastung' && g.flotte.befehl.schiff === 'audax' && g.flotte.befehl.st === 0, 'Neustart: Entlastung der Audax statt der Fulminata');
  ok(!ally(g, 'fulminata') || !Escort.active(ally(g, 'fulminata')), 'die Fulminata kommt nicht zurück');
  verwunden(g, 'audax'); run(g, 9);
  ok(flags(g).audax_verloren === true && g.flotte.befehl.art === 'ausschalten' && g.flotte.befehl.ziel === 'raider' && g.flotte.befehl.st === 0, 'beide verloren: Befehl wird „Jäger ausschalten“');
  // Ziele erfüllen: drei Jäger
  for (let i = 0; i < 8 && g.flotte.befehl && g.flotte.befehl.st === 0; i++) { for (const e of enemies(g, 'raider').slice(0, 3)) toeten(g, e); run(g, 3); }
  run(g, 1);
  ok(stage(g) === 'befehl3_ausschalten', 'Befehl 3 trotz Verlust beider Schiffe (' + stage(g) + ')');
  const fr = enemies(g, 'fregatte');
  ok(fr.length === 1 && fr[0].tag === 'fregatte', 'Boss: eine Fregatte (Tag fregatte)');
  g.god = true; for (const e of fr) toeten(g, e); run(g, 0.5);
  const f = flags(g);
  ok(f.fregatte_zerstoert === true && f.legat_gerettet === true, 'Flags fregatte_zerstoert und legat_gerettet');
  ok(f.legat_im_stich_gelassen === true && !f.legat_eigenmaechtig && !f.legat_befolgt && !f.legat_im_stich, 'genau eine Legat-Flag: legat_im_stich_gelassen');
  ok(f.fulminata_verloren === true && f.audax_verloren === true, 'fulminata_verloren und audax_verloren');
  ok(g.weltstand.data.fakten.schiffe_verloren === 'audax,fulminata', 'Fakt schiffe_verloren = ' + g.weltstand.data.fakten.schiffe_verloren);
  const gm = g.weltstand.data.npc.legat.gedaechtnis.map((e) => e.ereignis);
  ok(['im_stich_gelassen', 'fulminata_verloren', 'audax_verloren'].every((x) => gm.includes(x)), 'Gedächtnis des Legaten: im_stich_gelassen, fulminata_verloren, audax_verloren (' + gm.join(',') + ')');
  ok(g.weltstand.data.npc.legat.status === 'lebt', 'Status des Legaten bleibt lebt');
  ok(g.flotte.welle === null && g.flotte.befehl === null, 'Schlacht abgeräumt (kein Wellen-Nachlauf ins nächste Kapitel)');
  run(g, 8);
  ok(aktiv(g) === 'k7_siedlung', 'Kapitel 6 endet mit erfolg, Kapitel 7 läuft (' + aktiv(g) + ')');
  ok(g.weltstand.data.fakten.orbit_eisenwald === 'befreit', 'Fakt orbit_eisenwald');
  ok(!g.space.retreatRule, 'die Abdreh-Regel der Schlacht gilt nicht für spätere Gegner am Ort (Kapitel 7)');
  g.releaseWorldLock();
});

section('Genau eine Legat-Flag je Lauf: befolgt, eigenmächtig, im Stich gelassen', () => {
  const lauf = (vorbereiten) => {
    const t = start(1); const g = t.g;
    g.mission.setStep('ankunft'); run(g, 0.2); vor(t, 'befehl3_ausschalten');
    vorbereiten(g);
    for (const e of enemies(g, 'fregatte').slice()) toeten(g, e); run(g, 0.5);
    const f = flags(g);
    const gm = g.weltstand.data.npc.legat.gedaechtnis.map((e) => e.ereignis);
    const r = { n: ['legat_befolgt', 'legat_eigenmaechtig', 'legat_im_stich_gelassen'].filter((k) => f[k] === true), f, gm, g, t };
    return r;
  };
  let r = lauf(() => {});
  ok(r.n.join() === 'legat_befolgt' && r.gm.includes('befehle_befolgt') && r.f.fregatte_zerstoert && r.f.legat_gerettet && r.f.fulminata_verloren === false && r.f.audax_verloren === false, 'Normalfall: legat_befolgt, keine Verluste');
  ok(r.g.weltstand.data.fakten.schiffe_verloren === undefined, 'ohne Verluste kein Eintrag schiffe_verloren');
  r.g.releaseWorldLock();
  r = lauf((g) => { g.mission.flags.legat_eigenmaechtig = true; });
  ok(r.n.join() === 'legat_eigenmaechtig' && r.gm.includes('eigenmaechtig') && r.f.legat_befolgt === false, 'Lerche wich ab: genau legat_eigenmaechtig (befolgt zurückgenommen)');
  r.g.releaseWorldLock();
  r = lauf((g) => { g.mission.flags.legat_eigenmaechtig = true; verwunden(g, 'audax'); g.mission.flags.legat_im_stich = true; });
  ok(r.n.join() === 'legat_im_stich_gelassen' && r.gm.includes('im_stich_gelassen') && r.f.audax_verloren === true && r.g.weltstand.data.fakten.schiffe_verloren === 'audax', 'im Stich gelassen hat Vorrang vor eigenmächtig; Fakt schiffe_verloren = audax');
  r.g.releaseWorldLock();
  r = lauf((g) => { verwunden(g, 'fulminata'); });
  ok(r.f.fulminata_verloren === true && r.g.weltstand.data.fakten.schiffe_verloren === 'fulminata' && r.g.weltstand.data.npc.legat.status === 'lebt', 'nur die Fulminata verloren: schiffe_verloren = fulminata, Legat lebt');
  r.g.releaseWorldLock();
});

section('Rückzug (Notfallsprung) wiederholt die Szene, Verbündete erscheinen neu', () => {
  const t = start(1); const g = t.g;
  g.mission.setStep('ankunft'); run(g, 9);
  ok(stage(g) === 'befehl1_durchbrechen' && !!ally(g, 'audax'), 'Szene läuft, Audax da');
  g.god = false; 
  g.ship.reactorCtl && (g.ship.reactorCtl.state = 'online');
  const why = Sprung.notsprung(g);
  run(g, 0.5);
  ok(why === null, 'Notfallsprung ausgelöst' + (why ? ' (' + why + ')' : ''));
  ok(aktiv(g) === 'k6_orbit' && (stage(g) === 'auftrag' || stage(g) === 'k6_anflug'), 'Ausgang rueckzug: Kapitel 6 beginnt von vorn (' + stage(g) + ')');
  ok(!(g.space.escorts || []).some((q) => q.ally), 'Verbündete der alten Runde sind weg (Reset der Kapitelbücher)');
  space.enterScene(g, 'eisenwald', {}); g.god = true; run(g, 18);
  ok(stage(g) === 'befehl1_durchbrechen' && !!ally(g, 'fulminata') && !!ally(g, 'audax'), 'zurück in Eisenwald: Verbündete tauchen neu auf, Befehl 1 beginnt');
  g.releaseWorldLock();
});

section('Kapitel 8: Funk und Abspann reagieren auf Gedächtnis und Verluste', () => {
  const fall = (fl) => {
    const t = start(1, { kapitel: 'k8_sieg' }); const g = t.g;
    Object.assign(g.mission.flags, { legat_befolgt: false, legat_eigenmaechtig: false, legat_im_stich_gelassen: false, audax_verloren: false, fulminata_verloren: false }, fl);
    g.mission.setStep('sieg');
    run(g, 30);
    return { t, g, funk: t.radios().map((r) => r.text) };
  };
  let r = fall({ legat_befolgt: true });
  ok(r.funk.some((x) => /Ihr habt getan, was ich verlangte/.test(x)) && !r.funk.some((x) => /Trümmern|gesunken/.test(x)), 'befolgt: Dank, keine Verlustzeilen');
  r.g.releaseWorldLock();
  r = fall({ legat_eigenmaechtig: true, fulminata_verloren: true });
  ok(r.funk.some((x) => /Wir sprechen später darüber/.test(x)) && r.funk.some((x) => /Fulminata liegt in Trümmern/.test(x)), 'eigenmächtig und Fulminata verloren: Rüffel und Klage');
  r.g.releaseWorldLock();
  r = fall({ legat_im_stich_gelassen: true, audax_verloren: true });
  ok(r.funk.some((x) => /Die Audax ist tot. Ihr habt es gesehen/.test(x)) && r.funk.some((x) => /Die Audax ist gesunken/.test(x)), 'im Stich gelassen (Audax): Text der Funktexte und Nennung der Audax');
  r.g.releaseWorldLock();
  r = fall({ legat_im_stich_gelassen: true, fulminata_verloren: true });
  ok(r.funk.some((x) => /Die Fulminata ist gefallen, und ihr wart nicht da/.test(x)), 'im Stich gelassen (nur Fulminata): eigener Text');
  r.g.releaseWorldLock();
  // Abspann: Zeilen nach Flags
  const doc = Kampagne.laden('eisenwald');
  const t = start(1, { kapitel: 'k8_sieg' }); const g = t.g;
  Object.assign(g.mission.flags, { fulminata_verloren: true, audax_verloren: false, legat_im_stich_gelassen: true });
  const bl = g.mission.kette.abspannBloecke(doc.ende.abspann);
  const rom = bl.find((b) => b.kopf === 'ROM').zeilen;
  ok(rom.some((z) => /Fulminata: verloren/.test(z)) && rom.some((z) => /Audax: heimgekehrt/.test(z)) && rom.some((z) => /im Stich ließ/.test(z)) && !rom.some((z) => /Fulminata: heimgekehrt/.test(z)), 'Abspann: Zeilen nach Verlust und Haltung (Daten, wenn-Bedingungen)');
  ok(rom.every((z) => typeof z === 'string') && rom.length <= 12, 'Abspannzeilen als Texte');
  g.releaseWorldLock();
});

console.log(`\n${n - fails}/${n} Prüfungen bestanden (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fails ? 1 : 0);
