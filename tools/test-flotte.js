'use strict';
// EK4 Flotte (EK4a + EK4b): Verbündete (scripted bzw. mit KI), Befehle des Legaten (alle fünf Arten), Hilferuf und theatralischer Funkspruch,
// Verlust mit Rettungskapsel und Weltstand (Legat-Gedächtnis, verlorenes Schiff bleibt verloren), Welle um Welle mit Überdruck, Neustart,
// Funkporträt (legat) und Symbol (mars), Bausteine und Katalog (Labor-Umsetzungen), Snapshot, Szenenwechsel.
//   node tools/test-flotte.js [begriff …]   -> nur Abschnitte, deren Name einen der Begriffe enthält
const fs = require('fs');
const os = require('os');
const path = require('path');
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Escort = require('../server/sim/escort.js');
const Flotte = require('../server/sim/flotte.js');
const Pilot = require('../server/sim/pilot.js');
const Registry = require('../server/mission/registry.js');
const Katalog = require('../server/mission/katalog.js');
const Labor = require('../server/mission/labor.js');
const Weltstand = require('../server/weltstand.js');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
function ok(c, msg) { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); }
function section(name, fn) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n[' + name + ']');
  try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
}
const DT = 1 / CONFIG.tickHz;
const F = CONFIG.flotte;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-flotte-'));
let dirSeq = 0;

// Partie im Raum (Splittergürtel), Lerche unverwundbar-ruhig, ohne Gegner; mit np Spielern. opts.kampagne: Weltstand persistent (Kampagne ohne Tutorial)
function raum(np, opts) {
  const o = opts || {};
  const dir = path.join(TMP, 'w' + (++dirSeq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game(Object.assign({ noStore: true, seed: o.seed || 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} },
    o.kampagne ? { worlds: true, worldSaveSync: true, worldDir: dir } : {}));
  const cs = [];
  for (let i = 0; i < (np || 1); i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 800) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'F' + i, name: 'F' + i, color: i }); cs.push(c);
  }
  if (o.kampagne) { g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: 'free' }); for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true }); g.step(); }
  else g.reset();
  g.phase = 'play';
  space.enterScene(g, o.loc || 'splitter', {});
  g.space.enemies = []; g.space.projectiles = [];
  const events = [];
  const emit0 = g.emit.bind(g);
  g.emit = (kind, data) => { events.push(Object.assign({ kind, t: g.time }, data)); return emit0(kind, data); };
  const sh = g.ship; sh.x = 1500; sh.y = 800; sh.vx = 0; sh.vy = 0; sh.angle = 0; sh.speed = 0;
  if (!o.sterblich) g.god = true;
  return { g, cs, events, dir, ev: (k) => events.filter((e) => e.kind === k), radios: () => events.filter((e) => e.kind === 'radio') };
}
const ticks = (g, sek, each) => { const k = Math.round(sek * CONFIG.tickHz); for (let i = 0; i < k; i++) { if (each) each(i * DT); g.step(); } };
function platz(g, x, y) { const s = g.ship; s.x = x; s.y = y; s.vx = 0; s.vy = 0; s.speed = 0; }
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// Verbündeten so lange treffen, bis die Hülle unter den Anteil fällt (nach Hits à dmg)
function treffen(g, es, bisFrac) { let i = 0; while (es.hp / es.hpMax >= bisFrac && es.state !== 'zerstoert' && i++ < 400) Escort.hit(g, es, 4, {}); }
function toeten(g, e) { e.hp = 1; space.damageEnemy(g, e, 50, e.x - 100, e.y, {}); }
const npcMem = (g, id) => (g.weltstand && g.weltstand.data && g.weltstand.data.npc[id] && g.weltstand.data.npc[id].gedaechtnis) || [];

section('Protokoll, Konfiguration und Daten', () => {
  ok(['flotteBefehl', 'flotteWegpunkt', 'flotteWelle', 'flotteDruck', 'flotteNeustart', 'allyLost', 'allyDistress'].every((k) => Protocol.EK4_EVENTS.includes(k)), 'Protokoll: Ereignisse der Flotte');
  ok(JSON.stringify(Protocol.FLOTTE_ARTEN) === JSON.stringify(Flotte.ARTEN) && Protocol.DEBUG_CMDS.includes('flotte') && Protocol.FUNK_PORTRAETS.includes('legat') && Protocol.FUNK_PORTRAETS.includes('mars'), 'Befehlsarten, Debug-Befehl, Porträts');
  ok(F.max === 12 && F.hull.korvette > 0 && F.hilferuf.schwer === 0.4 && F.hilferuf.kritisch === 0.15, 'CONFIG.flotte: Grenze 12 Schiffe, Hüllen, Hilferuf bei 40 % und 15 %');
  const T = Flotte.texte();
  ok(T.schiffe.fulminata.hilferuf.length === 2 && T.schiffe.audax.zerstoert && T.erinnerung.befolgt && T.erinnerung.eigenmaechtig && T.erinnerung.im_stich, 'Funktexte als Daten (Fulminata, Audax, Erinnerung des Legaten)');
  ok(T.schiffe.fulminata.hilferuf[0].text.startsWith('Schwere Treffer') && T.schiffe.audax.zerstoert.startsWith('Wir gehen unter'), 'Texte wie im Vault (Funktexte Feldzug Eisenwald)');
  const npc = require('../server/mission/loader.js').npcData().npc;
  ok(npc.legat && npc.legat.name === 'Marcus Severus' && npc.legat.titel === 'Legat' && npc.legat.fraktion === 'rom', 'Legat Marcus Severus als NSC (content/npc.json)');
});

section('Verbündete: aufstellen, Snapshot, scripted bewegt', () => {
  const { g } = raum();
  ok(!('flotte' in g.snapshot()), 'ohne Flotte: kein Snapshot-Feld flotte');
  const a = Flotte.aufstellen(g, { tag: 'fulminata', kind: 'korvette' });
  const b = Flotte.aufstellen(g, { tag: 'audax', kind: 'korvette' });
  const s1 = Escort.spawn(g, { tag: 'konvoi', kind: 'frachter', verhalten: 'folgt_kurs', von: 'west', nach: 'ost' });
  const s2 = Escort.spawn(g, { tag: 'k2', kind: 'frachter', verhalten: 'folgt_kurs', von: 'nord', nach: 'ost' });
  const s3 = Escort.spawn(g, { tag: 'k3', kind: 'frachter', verhalten: 'folgt_kurs', von: 'sued', nach: 'ost' });
  ok(!!a && !!b && a.ally && a.hpMax === F.hull.korvette && a.verhalten === 'scripted' && a.npc === 'legat', `Verbündete angelegt (Hülle ${a && a.hp}, Klasse Korvette, NSC legat)`);
  ok(!!s1 && !!s2 && !s3, 'Verbündete zählen nicht zu den höchstens 2 Schützlingen (zwei Schützlinge ja, der dritte nein)');
  const snap = g.snapshot().space.escorts;
  ok(snap.filter((e) => e.al).length === 2 && snap.filter((e) => !e.al).length === 2 && snap.find((e) => e.tag === 'fulminata').kind === 'korvette', 'Snapshot: 2 Schützlinge + 2 Verbündete (al: 1)');
  ok(Escort.find(g, null) && !Escort.find(g, null).ally, 'Befehl ohne Tag trifft nie einen Verbündeten');
  const r = Escort.order(g, 'fulminata', 'halten', g.players[0]);
  ok(typeof r === 'string' || r === null, 'captain.escort an einen Verbündeten wird nicht als Schützlingsbefehl gewertet (kein Absturz)');
  // scripted: ziel
  g.space.escorts = g.space.escorts.filter((e) => e.ally);
  Flotte.modus(g, 'audax', 'ziel', { x: 2300, y: 800 });
  ticks(g, 40);
  ok(dist(b, { x: 2300, y: 800 }) < 150, `Audax fliegt auf Befehl des Regiebuchs zum Punkt (Abstand ${Math.round(dist(b, { x: 2300, y: 800 }))})`);
  ok(Flotte.modus(g, 'audax', 'halten') && Math.hypot(b.vx, b.vy) < 5, 'halten: bremst');
  ok(Flotte.modus(g, null, 'folgen') && (ticks(g, 20), dist(a, g.ship) < 500), 'folgen: Formation hinter der Lerche');
  ok(g.errors === 1, 'keine Server-Fehler außer dem erwarteten (dritter Schützling)');
});

section('Hilferuf bei großem Schaden, theatralischer Funkspruch bei Zerstörung', () => {
  const t = raum();
  const { g } = t;
  const a = Flotte.aufstellen(g, { tag: 'fulminata' }); const b = Flotte.aufstellen(g, { tag: 'audax' });
  treffen(g, a, 0.4);
  let rs = t.radios();
  ok(rs.length === 1 && rs[0].text.startsWith('Schwere Treffer an der Backbordseite') && rs[0].pid === 'legat' && rs[0].from === 'Legat Marcus Severus', 'Fulminata unter 40 %: Hilferuf des Legaten mit Porträt-Kennung');
  ok(a.distress && t.ev('escortDistress').length === 1 && t.ev('allyDistress').length === 1, 'Notruf-Zustand, Ereignisse escortDistress und allyDistress');
  treffen(g, a, 0.4); Escort.hit(g, a, 0, {});
  ok(t.radios().length === 1, 'jeder Ruf je Schiff nur einmal');
  treffen(g, a, 0.15);
  rs = t.radios();
  ok(rs.length === 2 && rs[1].text.startsWith('Das Ende naht') && rs[1].pid === 'legat', 'unter 15 %: kritischer Ruf („Bei Mars, ich habe das Feldzeichen nie sinken lassen!“)');
  treffen(g, b, 0.4); treffen(g, b, 0.15);
  rs = t.radios().filter((r) => r.from === 'Optio Livia Rufa');
  ok(rs.length === 2 && rs[0].text.startsWith('Schilde gebrochen') && rs[1].text.startsWith('Hülle bricht') && !('pid' in rs[0]), 'Audax: Optio Livia Rufa ruft (ohne Porträt-Kennung), Texte aus den Daten');
  // Zerstörung
  const x0 = a.x, y0 = a.y;
  treffen(g, a, 0.001); Escort.hit(g, a, 50, {}); ticks(g, 0.1);
  const lost = t.ev('allyLost');
  ok(lost.length === 1 && lost[0].tag === 'fulminata' && lost[0].name === 'Fulminata' && lost[0].kapsel === F.kapsel.dauer && Math.abs(lost[0].x - x0) < 80, 'Ereignis allyLost mit Position und Kapsel-Dauer');
  const last = t.radios().pop();
  ok(last.text.startsWith('Rettungskapsel ausgestoßen. Ich lebe, Lerche') && last.pid === 'legat', 'theatralischer Funkspruch der Fulminata („… mein Schiff!“)');
  ok(t.ev('explosion').length >= 1 && g.space.escorts.every((e) => e.tag !== 'fulminata') && Escort.stateOf(g, 'fulminata') === 'zerstoert' && Escort.outcome(g, 'fulminata') === 'verloren', 'explodiert, aus dem Raum, Zustand zerstoert, Ausgang verloren');
  ok(g.mission.flags.fulminata_verloren === true && g.mission.flags.fulminata_heil === false, 'Flags: fulminata_verloren');
  // Audax: Funkspruch bei Zerstörung
  Escort.hit(g, b, 500, {});
  ok(t.radios().pop().text.startsWith('Wir gehen unter. Für Rom'), 'Audax: „Wir gehen unter. Für Rom ... Für alle!“');
  // Gegner lassen vom Toten ab
  const e = space.spawnEnemy(g, 'raider', { x: 2000, y: 800, ziel: 'verbuendet' });
  ok(e.targetId == null, 'ohne lebende Verbündete: Gegner nimmt die Lerche');
  ok(g.errors === 0, 'keine Server-Fehler');
});

section('Weltstand: Verlust bleibt, Legat überlebt, Gedächtnis speichern und laden', () => {
  const t = raum(1, { kampagne: true });
  const { g } = t;
  ok(g.weltstand && g.weltstand.persistent && g.weltstand.data.npc.legat && g.weltstand.data.npc.legat.status === 'lebt', 'Kampagne: Legat im Weltstand (lebt)');
  const a = Flotte.aufstellen(g, { tag: 'fulminata' });
  platz(g, 300, 800); a.x = 1800; a.y = 800;   // die Lerche ist weit weg (im Stich gelassen)
  Escort.hit(g, a, 500, {});
  const ws = g.weltstand.data;
  ok(ws.fakten.flotte_fulminata === 'verloren', 'Fakt flotte_fulminata = verloren');
  const mem = npcMem(g, 'legat');
  ok(mem.some((m) => m.ereignis === 'schiff_verloren') && mem.some((m) => m.ereignis === 'im_stich') && ws.npc.legat.status === 'lebt', 'Gedächtnis: schiff_verloren und im_stich (Lerche war zu weit weg), der Legat lebt');
  ok(ws.npc.legat.haltung < 0 && g.mission.flags.legat_im_stich === true, 'Haltung des Legaten sinkt, Flag legat_im_stich');
  ok(ws.chronik.some((c) => /Fulminata wurde zerstört/.test(c.text)), 'Chronik: Fulminata wurde zerstört');
  // verlorenes Schiff kommt nicht von selbst zurück
  const again = Flotte.aufstellen(g, { tag: 'fulminata' });
  ok(again === null && t.ev('flotteFehlt').length === 1 && g.mission.flags.fulminata_verloren === true, 'flotte_aufstellen: verlorenes Schiff kommt nicht zurück (flotteFehlt)');
  const ers = Flotte.aufstellen(g, { tag: 'fulminata', ersatz: true });
  ok(!!ers && ers.state === 'ok', 'Ersatz nur ausdrücklich (ersatz: true, „über eine Aufgabe“)');
  // speichern und laden
  g.saveWorld('test');
  const id = g.weltstand.id;
  g.handleMessage(t.cs[0], { t: 'menu', op: 'end' });
  const saved = Weltstand.load(t.dir, id).data;
  ok(saved.npc.legat.gedaechtnis.some((m) => m.ereignis === 'schiff_verloren') && ['verloren', 'ersatz'].includes(saved.welt.fakten.flotte_fulminata), 'gespeichert: Gedächtnis und Fakt im Weltstand');
  const g2 = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: t.dir, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const c2 = { inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g2.addConnection(c2); g2.handleMessage(c2, { t: 'hello', clientId: 'F9', name: 'F9', color: 0 });
  g2.handleMessage(c2, { t: 'lobbyOpt', world: id }); g2.handleMessage(c2, { t: 'ready', ready: true }); g2.step();
  const m2 = npcMem(g2, 'legat');
  ok(g2.weltstand.id === id && m2.some((m) => m.ereignis === 'schiff_verloren') && m2.some((m) => m.ereignis === 'im_stich') && g2.weltstand.data.npc.legat.status === 'lebt', 'geladen: Legat-Gedächtnis (Schiff verloren, im Stich gelassen) und Status stehen');
  ok(Flotte.verloren(g2, 'fulminata') || g2.weltstand.data.fakten.flotte_fulminata === 'ersatz', 'geladen: das Schiff ist weiter verloren (bzw. durch Ersatz belegt)');
  ok(g.errors === 0 && g2.errors === 0, 'keine Server-Fehler');
});

section('Befehle: Fortschritt nur durch erreichte Ziele (alle fünf Arten)', () => {
  // Durchbrechen
  const t = raum(); const { g } = t;
  platz(g, 400, 800);
  const b = Flotte.befehl(g, { art: 'durchbrechen', punkte: '1200,800;2200,800', radius: 150 });
  ticks(g, 60);
  ok(b.st === 0 && b.idx === 0, 'Zeit allein bringt nichts: nach 60 s ohne Ziel läuft der Befehl, kein Punkt');
  platz(g, 1200, 800); ticks(g, 0.2);
  ok(b.idx === 1 && b.st === 0 && t.ev('flotteWegpunkt').length === 1, 'Punkt 1 erreicht (Ereignis), Befehl läuft');
  platz(g, 2200, 800); ticks(g, 0.2);
  ok(b.st === 1 && t.ev('flotteBefehl').pop().st === 1 && Flotte.erfuellt(g, 'durchbrechen'), 'Punkt 2 erreicht: erfüllt');
  ok(g.mission.flags.legat_befolgt === true, 'Flag legat_befolgt');
  // Zurückfallen
  const t2 = raum(); const g2 = t2.g; platz(g2, 1500, 800);
  const z = Flotte.befehl(g2, { art: 'zurueckfallen', punkte: 'west' });
  platz(g2, 200, 800); ticks(g2, 0.2);
  ok(z.st === 1, 'Zurückfallen: Punkt hinter der Linie erreicht');
  // Eskortieren: das Schiff erreicht die Punkte (nicht die Lerche), es wartet an der Leine
  const t3 = raum(); const g3 = t3.g; platz(g3, 400, 800);
  const ally = Flotte.aufstellen(g3, { tag: 'fulminata', von: { x: 500, y: 800 } });
  const e = Flotte.befehl(g3, { art: 'eskortieren', schiff: 'fulminata', punkte: '1500,800;2300,800', radius: 150 });
  ticks(g3, 60);
  ok(e.idx === 0 && ally.x < 400 + CONFIG.flotte.befehl.leine + 80, `Lerche bleibt zurück: das Schiff wartet an der Leine (x ${Math.round(ally.x)}), der Befehl rückt nicht vor`);
  ticks(g3, 150, () => { g3.ship.x = Math.min(2400, ally.x + 150); g3.ship.y = 800; g3.ship.vx = 0; g3.ship.vy = 0; });
  ok(e.st === 1 && dist(ally, { x: 2300, y: 800 }) < 170, `mit der Lerche in der Nähe fliegt das Schiff die Punkte ab: erfüllt (Abstand ${Math.round(dist(ally, { x: 2300, y: 800 }))})`);
  // Ausschalten: Ziel zerstört
  const t4 = raum(); const g4 = t4.g;
  const ziel = space.spawnEnemy(g4, 'korvette', { x: 2400, y: 800, tag: 'z1' });
  const rest = space.spawnEnemy(g4, 'raider', { x: 2400, y: 1100, tag: 'x1' });
  const a4 = Flotte.befehl(g4, { art: 'ausschalten', ziel: 'z1' });
  toeten(g4, rest); ticks(g4, 0.2);
  ok(a4.st === 0 && a4.k === 0, 'ein anderer Gegner zählt nicht');
  toeten(g4, ziel); ticks(g4, 0.2);
  ok(a4.st === 1, 'Ziel zerstört: erfüllt');
  // Entlastung: Abschüsse nur in der Nähe des Schiffs
  const t5 = raum(); const g5 = t5.g; platz(g5, 600, 800);
  const sh5 = Flotte.aufstellen(g5, { tag: 'fulminata', von: { x: 1800, y: 800 }, modus: 'halten' });
  const en = Flotte.befehl(g5, { art: 'entlastung', schiff: 'fulminata', n: 2, radius: 400 });
  const r1 = space.spawnEnemy(g5, 'raider', { x: 700, y: 900 }), r2 = space.spawnEnemy(g5, 'raider', { x: 800, y: 700 });
  toeten(g5, r1); toeten(g5, r2); ticks(g5, 0.2);
  ok(en.k === 0 && en.st === 0, 'Abschüsse fern vom Schiff zählen nicht (Entfernung ist Teil des Ziels)');
  platz(g5, 1700, 800);
  const r3 = space.spawnEnemy(g5, 'raider', { x: 1900, y: 900 }), r4 = space.spawnEnemy(g5, 'raider', { x: 1900, y: 700 });
  toeten(g5, r3); ticks(g5, 0.2);
  ok(en.k === 1 && en.st === 0, 'ein Abschuss nahe dem Schiff: 1/2');
  toeten(g5, r4); ticks(g5, 0.2);
  ok(en.st === 1, 'zweiter Abschuss nahe dem Schiff: Entlastung erfüllt');
  ok(g.errors === 0 && g2.errors === 0 && g3.errors === 0 && g4.errors === 0 && g5.errors === 0, 'keine Server-Fehler');
});

section('Scheitern: Frist, Schiff verloren, Notfallprotokoll; eigenmächtig und im Stich gelassen', () => {
  // Frist -> gescheitert, Überdruck bei Wellen
  const t = raum(); const { g } = t;
  platz(g, 400, 800);
  Flotte.wellenStart(g, { wellen: 'raider:1', takt: 0, ueberdruck: true, ziel: 'lerche' });
  const b = Flotte.befehl(g, { art: 'durchbrechen', punkte: '2400,800', frist: 20 });
  ticks(g, 19);
  ok(b.st === 0, 'vor Fristablauf läuft der Befehl');
  ticks(g, 2);
  ok(b.st === 2 && b.grund === 'zeit' && Flotte.gescheitert(g, 'zeit') && t.radios().some((r) => /Zu langsam/.test(r.text)), 'Frist abgelaufen: gescheitert (zeit), Funk des Legaten');
  const n0 = g.space.enemies.length;
  ticks(g, F.wellen.druckTakt * 2 + 1);
  ok(g.space.enemies.length > n0 && t.ev('flotteDruck').length >= 2, `Welle um Welle: nach der Frist Überdruck, Verstärkung kommt (${n0} -> ${g.space.enemies.length} Gegner)`);
  // Neustart: Gegner weg, Befehl von vorn, Wellen von vorn; lebende Verbündete repariert, tote bleiben tot
  const al = Flotte.aufstellen(g, { tag: 'audax' });
  Escort.hit(g, al, 4 * 8, {}); const hp0 = al.hp;
  Flotte.neustart(g);
  ok(g.space.enemies.filter((e) => e.kind !== 'relay').length === 0 || g.space.enemies.every((e) => e.wv), 'Neustart: alte Gegner entfernt');
  ok(Flotte.befehlStatus(g).st === 0 && Flotte.befehlStatus(g).idx === 0 && al.hp === al.hpMax && hp0 < al.hpMax, 'Neustart: Befehl läuft von vorn, lebender Verbündeter repariert');
  // Schiff verloren -> gescheitert (schiff)
  const t2 = raum(); const g2 = t2.g;
  const s2 = Flotte.aufstellen(g2, { tag: 'fulminata' });
  const e2 = Flotte.befehl(g2, { art: 'eskortieren', schiff: 'fulminata', punkte: 'ost' });
  Escort.hit(g2, s2, 5000, {}); ticks(g2, 0.2);
  ok(e2.st === 2 && e2.grund === 'schiff', 'Schiff zerstört: Befehl gescheitert (schiff)');
  // Notfallprotokoll -> gescheitert (notfall)
  const t3 = raum(1, { sterblich: true }); const g3 = t3.g;
  space.spawnEnemy(g3, 'raider', { x: 2900, y: 1500 });   // mit Gegnern im Raum regeneriert die Hülle nicht
  const e3 = Flotte.befehl(g3, { art: 'durchbrechen', punkte: 'ost' });
  g3.ship.hull = 0; ticks(g3, 0.2);
  ok(g3.stats.emergencies >= 1 && e3.st === 2 && e3.grund === 'notfall', 'Notfallprotokoll der Lerche (zerstört, muss fliehen/von vorn): Befehl gescheitert (notfall)');
  // eigenmächtig: die Lerche entfernt sich vom Ziel
  const t4 = raum(); const g4 = t4.g; platz(g4, 1400, 800);
  const e4 = Flotte.befehl(g4, { art: 'durchbrechen', punkte: '2500,800' });
  ticks(g4, 1);
  platz(g4, 200, 800); ticks(g4, bcfg().abweichSek + 2);
  ok(e4.abgewichen && g4.mission.flags.legat_eigenmaechtig === true && t4.radios().some((r) => /weicht vom Befehl ab|weicht/.test(r.text) || /ihr weicht/.test(r.text)), 'Lerche entfernt sich vom Ziel: eigenmächtig (Funk, Flag legat_eigenmaechtig)');
  const t5 = raum(1, { kampagne: true }); const g5 = t5.g; platz(g5, 1400, 800);
  const e5 = Flotte.befehl(g5, { art: 'durchbrechen', punkte: '2500,800' });
  ticks(g5, 1); platz(g5, 200, 800); ticks(g5, bcfg().abweichSek + 2);
  platz(g5, 2500, 800); ticks(g5, 0.3);
  const m5 = npcMem(g5, 'legat');
  ok(e5.st === 1 && m5.some((m) => m.ereignis === 'eigenmaechtig') && m5.some((m) => m.ereignis === 'befehl_befolgt'), 'Weltstand-Gedächtnis des Legaten: eigenmächtig und befolgt');
  ok(Flotte.erinnerung(g5) === 'eigenmaechtig' && /Befehl gegeben, Lerche/.test(Flotte.erinnerungText(g5)), 'Erinnerung des Legaten: eigenmächtig vor befolgt, Text aus den Daten');
  // im Stich gelassen: Erinnerungstext
  const t6 = raum(); const g6 = t6.g; platz(g6, 200, 800);
  const a6 = Flotte.aufstellen(g6, { tag: 'audax', von: { x: 1700, y: 800 } });
  Escort.hit(g6, a6, 5000, {});
  ok(Flotte.erinnerung(g6) === 'im_stich' && Flotte.erinnerungText(g6) === 'Die Audax ist tot. Ihr habt es gesehen. Ich auch.', 'im Stich gelassen: „Die Audax ist tot. Ihr habt es gesehen. Ich auch.“');
  // dicht dabei: nicht im Stich gelassen
  const t7 = raum(); const g7 = t7.g; platz(g7, 1500, 800);
  const a7 = Flotte.aufstellen(g7, { tag: 'audax', von: { x: 1650, y: 800 } });
  Escort.hit(g7, a7, 5000, {});
  ok(Flotte.erinnerung(g7) === null, 'war die Lerche nah, ist es kein Im-Stich-Lassen');
  ok([g, g2, g3, g4, g5, g6, g7].every((x) => x.errors === 0), 'keine Server-Fehler');
});
function bcfg() { return CONFIG.flotte.befehl; }

section('Welle um Welle', () => {
  const t = raum(); const { g } = t; platz(g, 800, 800);
  const w = Flotte.wellenStart(g, { wellen: 'raider:2|raider:1,korvette:1|raider:2', takt: 0, rest: 0, ziel: 'lerche', richtung: 'vorn' });
  ticks(g, 0.2);
  ok(!!w && g.space.enemies.length > 0 && t.ev('flotteWelle')[0].n === 1 && t.ev('flotteWelle')[0].von === 3, 'erste Gruppe kommt sofort, Ankündigung „Welle 1 von 3“');
  ticks(g, 5);
  ok(t.ev('flotteWelle').length === 1, 'die nächste kommt erst, wenn die vorige erledigt ist');
  for (const e of g.space.enemies.slice()) toeten(g, e);
  ticks(g, 0.2);
  ok(t.ev('flotteWelle').length === 2 && g.space.enemies.some((e) => e.kind === 'korvette'), 'Gruppe erledigt -> nächste Gruppe (mit Korvette)');
  for (const e of g.space.enemies.slice()) toeten(g, e); ticks(g, 0.2);
  for (const e of g.space.enemies.slice()) toeten(g, e); ticks(g, 0.2);
  ok(Flotte.wellenFertig(g) && Registry.get('wellen_fertig').test(g.mission, {}), 'alle Gruppen erledigt: wellen_fertig');
  // Takt
  const t2 = raum(); const g2 = t2.g; platz(g2, 800, 800);
  Flotte.wellenStart(g2, { wellen: 'raider:1|raider:1', takt: 10, rest: 0, ziel: 'lerche' });
  ticks(g2, 11);
  ok(t2.ev('flotteWelle').length === 2, 'Takt: die nächste Gruppe kommt nach takt s auch ohne Abschuss');
  // Ziel verbuendet: Gegner visieren Verbündete an
  const t3 = raum(); const g3 = t3.g; platz(g3, 300, 800);
  const ally = Flotte.aufstellen(g3, { tag: 'fulminata', von: { x: 1500, y: 800 }, modus: 'halten' });
  Flotte.wellenStart(g3, { wellen: 'raider:2', ziel: 'verbuendet', richtung: 'vorn' });
  ticks(g3, 1);
  ok(g3.space.enemies.length > 0 && g3.space.enemies.every((e) => e.targetId === ally.id) && Pilot.targetOf(g3, g3.space.enemies[0]) === ally, 'Gegner wählen Verbündete als Ziel (targetId-Pfad)');
  ticks(g3, 40);
  ok(t3.ev('tele').some((e) => e.tgt === ally.id) || ally.hp < ally.hpMax, 'Gegner greifen den Verbündeten an (angekündigt, Treffer)');
  ok([g, g2, g3].every((x) => x.errors === 0), 'keine Server-Fehler');
});

section('Szenenwechsel: Verbündete springen mit', () => {
  const t = raum(); const { g } = t;
  const a = Flotte.aufstellen(g, { tag: 'fulminata' }); const b = Flotte.aufstellen(g, { tag: 'audax' });
  Flotte.modus(g, 'audax', 'halten');
  space.enterScene(g, 'nebel', {});
  ok(g.space.escorts.length === 2 && g.space.escorts.every((e) => e.ally && dist(e, g.ship) < 400), 'beide Verbündete in der neuen Szene, hinter der Lerche (auch mit Skript halten)');
  Escort.hit(g, b, 5000, {});
  space.enterScene(g, 'splitter', {});
  ok(g.space.escorts.length === 1 && g.space.escorts[0].tag === 'fulminata' && Escort.stateOf(g, 'audax') === 'zerstoert', 'zerstörte Schiffe springen nicht mit');
  ok(g.errors === 0, 'keine Server-Fehler');
});

section('Funkporträt und Symbol', () => {
  const t = raum(); const { g } = t;
  g.mission.radio('Legat Marcus Severus', 'Rom belohnt Taten.', false, 'legat');
  ok(g.snapshot().mission.radio.pid === 'legat' && t.radios().pop().pid === 'legat', 'mission.radio mit Kennung legat: Snapshot und Ereignis tragen pid');
  g.mission.radio('⚔ MARS', 'Mars hat gesprochen.', false, 'mars');
  ok(g.snapshot().mission.radio.pid === 'mars', 'Mars erscheint als Symbol (pid mars, kein Porträt)');
  g.mission.radio('Tesk', 'Hallo.', false, 'tesk');
  ok(!('pid' in g.snapshot().mission.radio) && !('pid' in t.radios().pop()), 'andere Sprecher ohne pid (Snapshot unverändert)');
  g.mission.act({ radio: { from: 'legat', text: 'Befehl!' } });
  ok(g.snapshot().mission.radio.pid === 'legat', 'Regiebuch-Aktion radio { from: legat }: Porträt');
});

section('Bausteine, Katalog und Labor', () => {
  const ids = ['flotte_aufstellen', 'flotte_modus', 'flotte_befehl', 'flotte_wellen', 'flotte_neustart', 'flotte_erinnerung', 'befehl_erfuellt', 'befehl_gescheitert', 'befehl_laeuft', 'wellen_fertig', 'schiff_verloren', 'legat_erinnert', 'flotte_ziel_erreicht'];
  ok(ids.every((id) => Registry.get(id)), 'Bausteine registriert: ' + ids.join(', '));
  const d = Registry.describe().find((e) => e.id === 'flotte_befehl');
  ok(d && d.art === 'aktion' && d.params.art.pflicht && d.params.art.werte.length === 5 && d.params.frist && d.params.punkte, 'describe(): flotte_befehl { art*, schiff, ziel, n, punkte, radius, frist, sprecher, text }');
  const contract = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'regiebuch', 'bausteine.json'), 'utf8'));
  ok(ids.every((id) => (contract.aktionen && contract.aktionen[id]) || (contract.pruefungen && contract.pruefungen[id])), 'Vertrag content/regiebuch/bausteine.json kennt alle Bausteine');
  const k = Katalog.load({});
  const m = k.molekuele.flottenbefehl;
  ok(m && m.status === 'verfuegbar' && m.umsetzungen.length === 5 && m.umsetzungen.every((u) => u.status === 'verfuegbar'), 'Katalog: Molekül flottenbefehl mit 5 Umsetzungen, alle verfügbar (Prüfer bestanden)');
  ok(!k.fehler.some((f) => /flotten/i.test(JSON.stringify(f))), 'keine Katalogfehler zu flottenbefehl');
  const lab = Labor.laborListe().map((e) => e.id);
  ok(['ausschalten', 'eskortieren', 'durchbrechen', 'zurueckfallen', 'entlastung'].every((u) => lab.includes('flottenbefehl/' + u)), 'Labor: alle fünf Befehlsarten wählbar');
  // Labor-Start: Befehl, Verbündeter und Wellen laufen
  for (const art of ['ausschalten', 'eskortieren', 'durchbrechen', 'zurueckfallen', 'entlastung']) {
    const g = new Game({ noStore: true, seed: 5, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
    const c = { inbox: [], send(x) { if (this.inbox.length < 400) this.inbox.push(x); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'L0', name: 'L0', color: 0 });
    g.handleMessage(c, { t: 'lobbyOpt', startMission: 'labor', labor: { id: 'flottenbefehl/' + art, seed: 5, god: true } });
    g.handleMessage(c, { t: 'ready', ready: true });
    ticks(g, 20);
    const b = Flotte.befehlStatus(g);
    const snap = g.snapshot();
    ok(g.errors === 0 && b && b.art === art && g.space.escorts.some((e) => e.ally) && snap.flotte && snap.flotte.b && snap.flotte.b.a === art, `Labor ${art}: Befehl läuft, Verbündeter da, Snapshot flotte.b, keine Fehler`);
  }
});

section('Snapshot', () => {
  const t = raum(); const { g } = t;
  Flotte.aufstellen(g, { tag: 'fulminata' }); Flotte.aufstellen(g, { tag: 'audax' });
  Flotte.befehl(g, { art: 'durchbrechen', punkte: 'mitte;ost', frist: 120 });
  Flotte.wellenStart(g, { wellen: 'raider:1|raider:1', ziel: 'auto' });
  ticks(g, 1);
  const s = g.snapshot().flotte;
  ok(s && s.b.a === 'durchbrechen' && s.b.w.length === 2 && s.b.r > 100 && s.wl[0] === 1 && s.wl[1] === 2, 'flotte: Befehl (Art, Punkte, Rest-Frist) und Welle');
  ok(Buffer.byteLength(JSON.stringify(g.snapshot().flotte)) < 200, `flotte klein (${Buffer.byteLength(JSON.stringify(s))} B)`);
});

// ================================================================ EK4b
function gegnerNah(g, kind, x, y, extra) { const e = space.spawnEnemy(g, kind, Object.assign({ x, y }, extra || {})); return e; }

section('EK4b: eigene KI – Flug und Feuer, kein Eigenbeschuss', () => {
  const t = raum(); const { g } = t; platz(g, 800, 800);
  const a = Flotte.aufstellen(g, { tag: 'fulminata', von: { x: 900, y: 900 } });
  ok(a.rolle === 'begleiter', 'Standardrolle begleiter');
  const e = gegnerNah(g, 'raider', 1500, 800, { ziel: 'lerche' });
  const hp0 = e.hp;
  ticks(g, 30);
  const st = Flotte.state(g).stats;
  ok(st.schuesse > 0 && (e.hp < hp0 || !g.space.enemies.includes(e)), `die Korvette feuert auf den Gegner (${st.schuesse} Schüsse, Gegner-Hülle ${Math.round(hp0)} -> ${g.space.enemies.includes(e) ? Math.round(e.hp) : 'zerstört'})`);
  // Geschosse der Verbündeten treffen weder Lerche noch Verbündete
  const t2 = raum(); const g2 = t2.g; platz(g2, 1500, 800);
  const a2 = Flotte.aufstellen(g2, { tag: 'fulminata', von: { x: 1700, y: 800 }, rolle: 'skript' }); const b2 = Flotte.aufstellen(g2, { tag: 'audax', von: { x: 1500, y: 1000 }, rolle: 'skript' });
  Flotte.modus(g2, null, 'halten');
  g2.ship.hull = 100; const hpA = b2.hp;
  for (const [tx, ty] of [[g2.ship.x, g2.ship.y], [b2.x, b2.y]]) g2.space.projectiles.push({ id: g2.nextId('pr'), kind: 'ally', x: tx - 30, y: ty, angle: 0, speed: 100, ttl: 3, dmg: 50, owner: a2.id });
  ticks(g2, 1);
  ok(g2.ship.hull === 100 && b2.hp === hpA && g2.space.projectiles.length >= 1, 'kein Eigenbeschuss: Geschoss der Verbündeten trifft weder die Lerche noch einen Verbündeten');
  // Lanze der Lerche durch ein Schiff: Rüffel, kein Schaden
  const hpB = a2.hp; g2.ship.angle = 0; g2.ship.mount.bow.charge = 1; space.weaponsFire(g2, 'bow'); ticks(g2, 0.3);
  ok(a2.hp === hpB, 'Lanze der Lerche verletzt Verbündete nicht');
  // Treffer der Verbündeten ziehen den Gegner nicht auf die Lerche (Aggro)
  const t3 = raum(); const g3 = t3.g; platz(g3, 300, 800);
  const a3 = Flotte.aufstellen(g3, { tag: 'fulminata', von: { x: 1500, y: 800 }, modus: 'halten' });
  const r3 = space.spawnEnemy(g3, 'raider', { x: 1800, y: 800, ziel: 'verbuendet' });
  space.damageEnemy(g3, r3, 1, 1700, 800, { ally: true });
  ok(r3.aggroUntil == null && r3.targetId === a3.id, 'Treffer eines Verbündeten ändert das Ziel des Gegners nicht');
  space.damageEnemy(g3, r3, 1, 1700, 800);
  ok(r3.aggroUntil > g3.time, 'Treffer der Lerche zieht ihn weiter auf sie (S2 unverändert)');
  ok([g, g2, g3].every((x) => x.errors === 0), 'keine Server-Fehler');
});

section('EK4b: Rollen und Klassen-KI (Fregatte: Breitseite und Abstand)', () => {
  const t = raum(); const { g } = t; platz(g, 600, 800);
  const f = Flotte.aufstellen(g, { tag: 'frg', kind: 'fregatte', von: { x: 700, y: 900 } });
  const z = gegnerNah(g, 'korvette', 1700, 800, { ziel: 'verbuendet' });
  z.retreatUntil = 0;
  ticks(g, 45);
  ok(f.kind === 'fregatte' && (f.pstate === 'station' || f.pstate === 'cross'), `Fregatte fliegt die Breitseiten-KI (pstate ${f.pstate})`);
  const ds = []; const z2 = gegnerNah(g, 'korvette', 1700, 800, { ziel: 'verbuendet' }); z2.hp = z2.hpMax = 4000;
  ticks(g, 30, (tt) => { if (Math.round(tt * 10) % 10 === 0 && g.space.enemies.includes(z2) && f.kiZielObj === z2) ds.push(dist(f, z2)); });
  ds.sort((a, b) => a - b); const d = ds.length ? ds[Math.floor(ds.length / 2)] : null;
  ok(d != null && d > 150 && d < 700, `Fregatte hält Abstand zum Ziel (Breitseite, Median ${d == null ? '–' : Math.round(d)} px)`);
  // Begleiter bleibt in der Leine, Angreifer jagt
  const t2 = raum(); const g2 = t2.g; platz(g2, 400, 800);
  const bg = Flotte.aufstellen(g2, { tag: 'a', von: { x: 500, y: 900 } }); const an = Flotte.aufstellen(g2, { tag: 'b', von: { x: 500, y: 700 }, rolle: 'angreifer' });
  const r = space.spawnEnemy(g2, 'raider', { x: 1900, y: 800, ziel: 'lerche' }); r.hp = r.hpMax = 5000;
  ticks(g2, 40, () => { r.x = 1900; r.y = 800; r.vx = 0; r.vy = 0; });
  ok(dist(bg, g2.ship) < CONFIG.flotte.ki.leine + 200 && dist(an, { x: 1900, y: 800 }) < dist(bg, { x: 1900, y: 800 }), `Begleiter bleibt in der Leine (${Math.round(dist(bg, g2.ship))} px von der Lerche), Angreifer jagt (${Math.round(dist(an, { x: 1900, y: 800 }))} px vom Ziel)`);
  const t3 = raum(); const g3 = t3.g;
  const sk = Flotte.aufstellen(g3, { tag: 'sk', von: { x: 1700, y: 800 }, rolle: 'skript' });
  const e3 = gegnerNah(g3, 'raider', 1900, 800); ticks(g3, 20);
  ok(Flotte.state(g3).stats.schuesse === 0 && sk.kiZielObj == null, 'Rolle skript (EK4a): keine KI, kein Feuer');
  ok([g, g2, g3].every((x) => x.errors === 0), 'keine Server-Fehler');
});

section('EK4b: höchstens 12 Schiffe je Szene, mehr kommt als Nachschub', () => {
  const t = raum(); const { g } = t; platz(g, 600, 800);
  Flotte.aufstellen(g, { tag: 'fulminata', rolle: 'skript' }); Flotte.aufstellen(g, { tag: 'audax', rolle: 'skript' });
  Flotte.wellenStart(g, { wellen: 'raider:10,korvette:6|raider:6', ziel: 'lerche', richtung: 'alle', takt: 0 });
  let max = 0;
  ticks(g, 20, () => { max = Math.max(max, Flotte.schiffe(g)); });
  const nq = g.snapshot().flotte && g.snapshot().flotte.nq;
  ok(max <= 12 && Flotte.schiffe(g) === 12, `nie mehr als 12 Schiffe (Höchstwert ${max}: 2 Verbündete + ${g.space.enemies.length} Gegner)`);
  ok(nq > 0 && Registry.get('nachschub_wartet').test(g.mission, {}), `Rest wartet als Nachschub (Snapshot flotte.nq = ${nq})`);
  const n0 = g.space.enemies.length;
  const sterben = g.space.enemies.slice(0, 3);
  for (const e of sterben) toeten(g, e);
  ticks(g, 6);
  ok(t.ev('flotteNachschub').length >= 1 && g.space.enemies.length >= n0 - 3 + 1 && Flotte.schiffe(g) <= 12, `Nachschub rückt nach, wenn Schiffe zerstört wurden (${t.ev('flotteNachschub').length} Nachzügler, Gegner ${n0} -> ${g.space.enemies.length})`);
  // die Grenze gilt auch für das Spawn-Skript der Missionen
  const t2 = raum(); const g2 = t2.g; Flotte.state(g2);
  g2.mission.spawn({ kind: 'raider', n: 15 });
  ok(g2.space.enemies.length === 12 && Flotte.state(g2).nachschub.length === 3, 'Regiebuch-Spawn: 12 erscheinen, 3 warten');
  ok([g, g2].every((x) => x.errors === 0), 'keine Server-Fehler');
});

section('EK4b: Einblenden, Sprung der Flotte (auch Notfallsprung), Minen', () => {
  const t = raum(); const { g } = t;
  const a = Flotte.aufstellen(g, { tag: 'fulminata', auftauchen: true });
  ok(t.ev('allyEintritt').length === 1 && g.snapshot().space.escorts[0].ein === 1 && t.radios().some((r) => /Rom fährt die Sperrflotte nieder/.test(r.text)), 'Auftauchen: Sprungblitz (allyEintritt), Snapshot ein, Funk des Legaten');
  const hp0 = a.hp; Escort.hit(g, a, 500, {});
  ok(a.hp === hp0, 'beim Einblenden unverwundbar');
  ticks(g, CONFIG.flotte.einblenden.dauer + 0.5); Escort.hit(g, a, 5, {});
  ok(a.hp < hp0 && !('ein' in g.snapshot().space.escorts[0]), 'danach verwundbar, Anzeige endet');
  // Notfallsprung am selben Ort: die Flotte springt mit
  const t2 = raum(); const g2 = t2.g;
  const a2 = Flotte.aufstellen(g2, { tag: 'fulminata' }); const b2 = Flotte.aufstellen(g2, { tag: 'audax' });
  platz(g2, 400, 400); a2.x = 2600; a2.y = 1400; b2.x = 2700; b2.y = 1300;
  const Sprung = require('../server/sim/sprung.js');
  Sprung.notsprung(g2); ticks(g2, 0.2);
  ok(dist(a2, g2.ship) < 500 && dist(b2, g2.ship) < 500, `Notfallsprung: beide Verbündete stehen wieder bei der Lerche (${Math.round(dist(a2, g2.ship))}, ${Math.round(dist(b2, g2.ship))} px)`);
  // Minen der Gegner treffen Verbündete, Minen der Lerche nicht
  const Alarm = require('../server/sim/alarm.js');
  const t3 = raum(); const g3 = t3.g; platz(g3, 300, 300);
  const a3 = Flotte.aufstellen(g3, { tag: 'fulminata', von: { x: 1500, y: 800 }, modus: 'halten', rolle: 'skript' });
  Alarm.an(g3, {});
  Alarm.minenSetzen(g3, { n: 1, x: 1530, y: 800, radius: 1, besitzer: 'lerche' });
  ticks(g3, 1);
  ok(a3.hp === a3.hpMax && g3.space.minen.length === 1, 'Mine der Lerche: zündet nicht beim Verbündeten, trifft ihn nicht');
  const mine = g3.space.minen[0]; Alarm.explodiere(g3, mine, 'abschuss'); ticks(g3, 0.1);
  ok(a3.hp === a3.hpMax, 'Explosion einer Mine der Lerche verletzt Verbündete nicht');
  Alarm.minenSetzen(g3, { n: 1, x: 1520, y: 800, radius: 1, besitzer: 'gegner' });
  ticks(g3, 0.3);
  ok(a3.hp < a3.hpMax && g3.space.minen.length === 0, `Mine der Gegner zündet beim Verbündeten und trifft ihn (Hülle ${a3.hpMax} -> ${Math.round(a3.hp)}) – gleiche Regeln wie für die Lerche`);
  ok([g, g2, g3].every((x) => x.errors === 0), 'keine Server-Fehler');
});

section('EK4b: Snapshot kompakt (Worst Case Verbündete)', () => {
  const t = raum(); const { g } = t;
  for (let i = 0; i < 4; i++) Flotte.aufstellen(g, { tag: 'v' + i, kind: i % 2 ? 'fregatte' : 'korvette', name: 'Schiff ' + i });
  ticks(g, 1);
  const es = g.snapshot().space.escorts;
  const b = Buffer.byteLength(JSON.stringify(es[0]));
  ok(es.length === 4 && b < 130 && !('befehl' in es[0]) && !('state' in es[0]) && !('distress' in es[0]), `Verbündeter im Snapshot kompakt (${b} B, state/befehl/distress fehlen = Standard)`);
});

console.log(`\n${n - fails}/${n} ok`);
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
if (fails) { console.log('TEST-FLOTTE FEHLER'); process.exit(1); }
console.log('TEST-FLOTTE OK');
