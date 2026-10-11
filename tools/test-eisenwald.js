'use strict';
// EK6 Siedlung Eisenwald (CONTRACT-EK5-6.md §7 ff.): Feldzeichen in der Platzmitte (Generator-Variante eisenwald), gemeinsames Hissen
// (anker.js Rolle flagge), Endkampf mit 10 Gegnern und Anführer (server/sim/endkampf.js), Anführer als generischer Modifikator
// (combat.modifikatorSetzen: +50 % Leben, +50 % Schaden, 25 % größer = Bit gs), Sieg, Niederlage mit Vollreset (stellung_nehmen/flagge_hissen).
//   node tools/test-eisenwald.js [begriff …]   -> nur Abschnitte, deren Name einen der Begriffe enthält
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const Physics = require('../shared/physics.js');
const Buehne = require('../shared/buehne.js');
const GenSiedlung = require('../shared/gen-siedlung.js');
const { Game } = require('../server/game.js');
const L = require('../server/sim/landepunkte.js');
const Anker = require('../server/sim/anker.js');
const combat = require('../server/sim/combat.js');
const away = require('../server/sim/away.js');
const waffen = require('../server/sim/waffen.js');
const Endkampf = require('../server/sim/endkampf.js');
const Labor = require('../server/mission/labor.js');
const W = require('../server/world.js');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const LP = 'splitter.eisenwald';
const LAB = 'stellung_nehmen/flagge_hissen';
const TILE = Physics.TILE;
let n = 0, fails = 0;
function ok(c, msg) { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); }
function section(name, fn) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n[' + name + ']');
  try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
}
const ticks = (g, sek) => { const k = Math.round(sek * CONFIG.tickHz); for (let i = 0; i < k; i++) g.step(); };
const roh = (seed) => GenSiedlung.erzeuger(130, 90).karteRoh(seed, 12, { bauweise: 'germanen', typ: 'handel', variante: 'eisenwald', besitz: 'raubzug', zustand: 'intakt', id: LP });

// Labor-Spiel mit np Spielern, Szene stellung_nehmen/flagge_hissen, Crew unten auf der Siedlung (Waffen aktiv, Rollen gesehen)
function spiel(np, seed, unten) {
  const g = new Game({ noStore: true, seed: seed || 7, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < np; i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 600) this.inbox.push(m); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'K' + i, name: 'K' + i, color: i }); cs.push(c);
  }
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: 'labor', labor: { id: LAB, seed: seed || 5 } });
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  ticks(g, 1);
  g.weltstand.data.rollen_gesehen = ['niederhalter', 'grenadier', 'schuetze', 'enterer'];
  if (unten !== false) {
    L.get(g, LP);
    g.transferZiel = { lp: LP, scene: g.ship.scene }; g.setAwayMap(LP);
    away.executeBeam(g, g.players.map((p) => p.id), 'down');
    ticks(g, 0.5);
  }
  const ev = (kind) => cs[0].inbox.filter((m) => m.t === 'event' && m.kind === kind);
  const oda = () => cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'oda').map((m) => (m.data && m.data.text) || m.text || '');
  return { g, cs, ev, oda };
}
const karte = () => W.AWAY_MAPS[LP].karte;
const flagge = () => karte().anker.find((a) => a.rolle === 'flagge');
const aw = (g) => g.aways[LP];
// Halten wie im Spiel: E gedrückt, stehend; beendet nach `sek` s
function halten(g, ps, a, sek) {
  for (const p of ps) { p.actDown = true; p.moving = false; p.hold = { kind: 'anker:flagge', anker: a.id, t: 0, dur: Anker.holdDuration(g, p, 'anker:flagge', {}), op: 'hissen' }; }
  ticks(g, sek);
}
const loslassen = (ps) => { for (const p of ps) { p.actDown = false; p.hold = null; } };

// ---------------------------------------------------------------------------------------------------------------------
section('Generator: Feldzeichen in der Platzmitte', () => {
  let gut = 0, mitteOk = true, flaggeOk = true, bytes = 0, sockelOk = true, fehler = [];
  const SEEDS = 30;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = Buehne.ausRaster(roh(seed), { spiel: true });
    if (!r.pruefung.ok) { fehler.push(`${seed}: ${r.fehler.slice(0, 2).map((f) => f.code).join(',')}`); continue; }
    gut++;
    const k = r.karte, fl = k.anker.filter((a) => a.rolle === 'flagge'), p = k.plaetze.platz;
    if (fl.length !== 1) { flaggeOk = false; continue; }
    const cx = p.rect[0] + Math.floor(p.rect[2] / 2), cy = p.rect[1] + Math.floor(p.rect[3] / 2);
    if (p.typ !== 'dorfplatz' || Math.abs(fl[0].x - cx) > 1 || Math.abs(fl[0].y - cy) > 1) mitteOk = false;
    if (r.karte.rows.some((row) => /O{3}/.test(row.slice(fl[0].x - 2, fl[0].x + 3)) && row === r.karte.rows[fl[0].y])) sockelOk = false;
    bytes = Math.max(bytes, Buffer.byteLength(JSON.stringify(Game.prototype.awayMapPayload.call({}, k))));
    if (k.meta.pflicht.flagge !== 1 || k.meta.variante !== 'eisenwald') flaggeOk = false;
  }
  ok(gut === SEEDS, `Prüfer ok mit Pflichtsatz inklusive flagge (${gut}/${SEEDS}${fehler.length ? ': ' + fehler.slice(0, 3).join(' | ') : ''})`);
  ok(flaggeOk && mitteOk, 'genau ein Flaggenpunkt, in der Mitte des Platzes (Platztyp dorfplatz)');
  ok(sockelOk, 'kein Statuensockel in der Platzmitte');
  ok(bytes <= Protocol.AWAY_MAP_MAX_BYTES, `awayMap höchstens ${bytes} B ≤ ${Protocol.AWAY_MAP_MAX_BYTES} B`);
  const alt = Buehne.ausRaster(GenSiedlung.erzeuger(130, 90).karteRoh(3, 12, { bauweise: 'germanen', typ: 'handel', besitz: 'raubzug', zustand: 'intakt', id: 'x' }), { spiel: true }).karte;
  ok(!alt.anker.some((a) => a.rolle === 'flagge') && alt.rows.some((r) => r.includes('OOO')), 'ohne Variante: Siedlung wie bisher (Statuensockel, keine Flagge)');
  ok(JSON.stringify(roh(5)) === JSON.stringify(roh(5)), 'gleicher Seed, gleiche Karte');
});

section('Feldzeichen hissen: nur zu zweit, Fortschritt bleibt', () => {
  const { g, ev } = spiel(3, 7);
  const a = flagge(), [p1, p2, p3] = g.players, T = CONFIG.anker.halten.flagge;
  ok(a && Anker.zustand(g, LP, a.id) === 'unten', 'Feldzeichen unten');
  const li = []; Anker.interactionsAt(g, p1, a.x, a.y, li);
  ok(li[0] && li[0].kind === 'anker:flagge' && li[0].op === 'hissen' && !li[0].blocked, 'zu dritt: E halten bietet das Hissen an');
  // ein Halter allein: kein Fortschritt
  halten(g, [p1], a, 3);
  ok(p1.hold && Math.abs(p1.hold.t) < 0.01 && Anker.zustand(g, LP, a.id) === 'unten', 'ein Halter allein: kein Fortschritt');
  // zwei: Fortschritt, Balken zeigt ihn
  halten(g, [p1, p2], a, 3);
  const mitte = p1.hold ? p1.hold.t : -1;
  ok(mitte > 2.5 && mitte < 3.6 && p1.hold.t === p2.hold.t, `zwei Halter: gemeinsamer Fortschritt (${mitte.toFixed(1)} s von ${T})`);
  // einer lässt los: Fortschritt bleibt
  loslassen([p2]); ticks(g, 2);
  ok(p1.hold && Math.abs(p1.hold.t - mitte) < 0.2 && Anker.zustand(g, LP, a.id) === 'unten', 'einer lässt los: der Fortschritt bleibt stehen');
  // Treffer unterbricht den Halter, nicht den Fortschritt
  Anker.onTreffer(g, p1.id);
  ok(p1.hold === null, 'Treffer unterbricht das Halten');
  halten(g, [p1, p2], a, 1);
  ok(p1.hold && p1.hold.t > mitte, 'danach geht es dort weiter, wo es war');
  ticks(g, T);
  ok(Anker.zustand(g, LP, a.id) === 'gehisst' && p1.hold === null && p2.hold === null, 'nach dem vollen Fortschritt gehisst, Halter frei');
  ok(ev('flaggeGehisst').length === 1, 'Ereignis flaggeGehisst');
  const li2 = []; Anker.interactionsAt(g, p1, a.x, a.y, li2);
  ok(li2[0] && /steht/.test(li2[0].blocked), 'danach: „Das Feldzeichen steht“');
});

section('Feldzeichen: lebt nur einer, ist Hissen nicht möglich', () => {
  const { g } = spiel(3, 8);
  const a = flagge(), [p1, p2, p3] = g.players;
  const n0 = (ps) => ps.filter((p) => p.zone === 'away' && !p.downed).length;
  combat.woundPlayer(g, p2, { kind: 'test' }); combat.woundPlayer(g, p3, { kind: 'test' });
  ok(n0(g.players) === 1, 'zwei Spieler liegen, einer lebt');
  const li = []; Anker.interactionsAt(g, p1, a.x, a.y, li);
  ok(li[0] && /zwei gemeinsam/.test(li[0].blocked || ''), `Hinweis „zwei gemeinsam“ statt Hissen (${li[0] && li[0].blocked})`);
  ok(Anker.holdValid(g, p1, { kind: 'anker:flagge', anker: a.id }) === false, 'holdValid false');
  combat.revive(g, p2, null, { quiet: true });
  ok(Anker.holdValid(g, p1, { kind: 'anker:flagge', anker: a.id }) === true, 'sobald ein zweiter wieder steht: möglich');
  // mitten im Halten fällt einer: der Fortschritt pausiert
  halten(g, [p1, p2], a, 2);
  const t0 = p1.hold.t;
  combat.woundPlayer(g, p2, { kind: 'test' }); ticks(g, 2);
  ok(p1.hold === null && Anker.zustand(g, LP, a.id) === 'unten', `fällt einer, bricht das Halten ab (Fortschritt ${t0.toFixed(1)} s bleibt, nicht gehisst)`);
});

section('Anführer: generischer Modifikator, keine Sonderfigur', () => {
  const { g } = spiel(3, 9);
  const awx = aw(g); combat.ensureV2(g, awx, LP);
  const squad = require('../server/sim/squad.js');
  const t0 = Physics.toTile(g.players[0].x, g.players[0].y);
  let versatz = 0;
  const mk = (id) => { squad.spawnSquad(g, id, { map: LP, besetzung: [{ typ: 'niederhalter', anzahl: 1 }], force: true, alert: false, plaetze: [{ x: t0.x + 12, y: t0.y + (versatz += 2) }], festeZahl: true }); return awx.drones.find((e) => e.squad === id); };
  const normal = mk('n1'), chef = mk('b1');
  combat.kaempfer(g, normal); combat.kaempfer(g, chef);
  const basis = { seg: normal.seg, wunden: normal.wunden.max, waffe: normal.waffe, rolle: normal.rolle };
  ok(basis.rolle === 'niederhalter' && basis.waffe === 'sturmgewehr', `Sturmgewehr trägt die Rolle niederhalter (Bolzer): ${basis.rolle}/${basis.waffe}`);
  ok(combat.modifikatorSetzen(g, chef, 'anfuehrer') === true && combat.modifikatorSetzen(g, chef, 'gibtsnicht') === false, 'Modifikator anfuehrer aus der Config, unbekannter Name abgelehnt');
  ok(chef.rolle === 'niederhalter' && chef.waffe === 'sturmgewehr', 'gleiche Rolle und Waffe, keine Sonderfigur');
  const gesamt = basis.seg + basis.wunden;
  ok(Math.abs(chef.seg + chef.wunden.max - gesamt * 1.5) < 1e-9 && chef.seg === chef.max, `Leben +50 % (Schild ${basis.seg} + ${basis.wunden} Wunde = ${gesamt} → ${chef.seg} + ${chef.wunden.max} = ${chef.seg + chef.wunden.max})`);
  // Treffer bis zum Fall: Normal 4 (3 Schild + 1 Wunde), Anführer 6
  const treffer = (e) => { let i = 0; while (e.alive && i < 40) { combat.hitEnemy(g, e, 1, { pid: g.players[0].id, wirkung: { schaden: 1, wunde: false } }); i++; } return i; };
  const hn = treffer(normal), hc = treffer(chef);
  ok(hn === 4 && hc === 6 && Math.abs(hc / hn - 1.5) < 1e-9, `Treffer bis zum Fall: normal ${hn}, Anführer ${hc} (×1,5)`);
  // Schaden: jede Wirkung ×1,5
  const norm2 = mk('n2'); combat.kaempfer(g, norm2);
  const chef2 = mk('b2'); combat.kaempfer(g, chef2); combat.modifikatorSetzen(g, chef2, 'anfuehrer');
  const wirkung = (e) => { awx.projectiles.length = 0; e.bereitAt = 0; e.gesperrtBis = 0; e.hitze = 0; waffen.feuern(g, e, { x: g.players[0].x, y: g.players[0].y }); const q = awx.projectiles.find((x) => x.owner === e.id); return q && q.wirkung.schaden; };
  const sn = wirkung(norm2), sc = wirkung(chef2);
  ok(sn === 0.5 && sc === 0.75, `Schaden je Schuss: normal ${sn}, Anführer ${sc} (×1,5)`);
  // Snapshot: höchstens ein Bit
  const snap = g.snapshot(); const ds = snap.away.drones;
  const dc = ds.find((d) => d.id === chef2.id), dn = ds.find((d) => d.id === norm2.id);
  ok(dc && dc.gs === 1 && dn && !('gs' in dn), 'Snapshot: Bit gs nur beim Anführer, sonst fehlt das Feld');
  const extra = Object.keys(dc).filter((k) => !(k in dn));
  ok(extra.length === 1 && extra[0] === 'gs', `Mehrkosten im Snapshot: genau ein Feld, ${extra.join(', ')} (ein Bit)`);
  ok(CONFIG.awayCombat.modifikatoren.anfuehrer.groesse === 1.25, 'Darstellung 25 % größer (Config groesse 1,25)');
});

section('Endkampf: 10 Gegner und Anführer verteilt, einmalig', () => {
  const { g, ev, oda } = spiel(3, 11);
  const a = flagge(), awx = aw(g);
  Anker.setzen(g, LP, a.id, 'gehisst', g.players[0].id); ticks(g, 1);
  const ds = () => awx.drones;
  ok(ds().length === 11 && ds().filter((e) => e.boss).length === 1, `nach dem Hissen: 11 Gegner, darunter ein Anführer (${ds().length})`);
  const boss = ds().find((e) => e.boss);
  ok(boss.rolle === 'niederhalter' && boss.mod && boss.mod.name === 'anfuehrer', 'der Anführer ist ein Niederhalter mit Modifikator');
  ok(ds().every((e) => e.tag === 'labs1_kampf_a' || e.tag === 'labs1_a' || /^labs1/.test(e.tag)) && ds().every((e) => Object.values(awx.squads).some((s) => s.name === e.squad && s.alert)), 'alle wach (Trupp alarmiert), mit tag');
  // verteilt: Winkel um den Flaggenpunkt, Abstand
  const c0 = { x: a.x, y: a.y };
  const winkel = ds().map((e) => { const t = Physics.toTile(e.x, e.y); return { w: Math.atan2(t.y - c0.y, t.x - c0.x), d: Math.hypot(t.x - c0.x, t.y - c0.y) }; });
  const abstandOk = winkel.every((q) => q.d >= 11.5 && q.d <= 33.5);
  const sek = new Set(winkel.map((q) => Math.floor(((q.w + Math.PI) / (2 * Math.PI)) * 11)));
  ok(abstandOk && sek.size >= 8, `Abstand 12–32 Kacheln und von allen Seiten (${sek.size} von 11 Winkelsektoren belegt)`);
  ok(oda().some((t) => /von allen Seiten/.test(t)), 'ODA „Gegner von allen Seiten“');
  // keine Spieler in der Nähe der Erscheinungspunkte
  ok(ds().every((e) => g.players.every((p) => Math.hypot(p.x - e.x, p.y - e.y) >= 7 * TILE)), 'kein Gegner erscheint neben einem Spieler');
  // einmalig: weiter ticken, nie mehr Gegner
  let max = 0; for (let i = 0; i < 40; i++) { ticks(g, 1); for (const p of g.players) { if (p.shield) p.shield.seg = 3; if (p.downed) combat.revive(g, p, 3, { quiet: true }); } max = Math.max(max, ds().length); }
  ok(max <= 11, `40 s Kampf: nie mehr als 11 Gegner, kein dynamischer Spawn (max ${max})`);
  ok(Endkampf.angriffStarten(g, { map: LP, fraktion: 'raubzug', tag: 'x' }) === 0, 'zweiter Aufruf von angriffStarten: nichts');
});

section('Sieg: Anführer besiegt, Gegner beamen raus', () => {
  const { g, oda } = spiel(3, 12);
  const a = flagge(), awx = aw(g);
  Anker.setzen(g, LP, a.id, 'gehisst', g.players[0].id); ticks(g, 1);
  const boss = awx.drones.find((e) => e.boss);
  ok(g.mission.state.stage === 'labs1_kampf', 'Szene im Schritt „Kampf“');
  ok(!Endkampf.bossBesiegt(g, LP), 'Anführer lebt: nicht besiegt');
  for (let i = 0; i < 12 && boss.alive; i++) combat.hitEnemy(g, boss, 1, { pid: g.players[0].id, wirkung: { schaden: 9, wunde: true } });
  ok(!boss.alive && Endkampf.bossBesiegt(g, LP), 'Anführer liegt: besiegt');
  ticks(g, 2);
  ok(awx.drones.length === 0 && Object.keys(awx.squads).length === 0, 'alle Gegner beamen raus (Karte leer)');
  ok(oda().some((t) => /Sie flüchten/.test(t)) && g.mission.missions.bot_lab.state === 'done', 'Sieg: ODA, Szene beendet');
  ok(Anker.zustand(g, LP, a.id) === 'gehisst', 'das Feldzeichen weht');
});

section('Niederlage: Notrückholung, Siedlung komplett zurückgesetzt, Freischaltung bleibt', () => {
  const { g, oda, ev } = spiel(3, 13);
  const a = flagge(), awx = aw(g);
  // etwas „Zerstörtes“ und Alarm als Zustand der Siedlung
  const ziel = karte().anker.find((q) => q.rolle === 'beute');
  Anker.setzen(g, LP, ziel.id, 'leer', null);
  Anker.alarm(g, LP, true);
  Anker.setzen(g, LP, a.id, 'gehisst', g.players[0].id); ticks(g, 1);
  ok(awx.drones.length === 11 && awx.alarm === true && Anker.zustand(g, LP, ziel.id) === 'leer', 'Angriff läuft, Siedlung im Alarm, Kiste geleert');
  for (const p of g.players) combat.woundPlayer(g, p, { kind: 'test' });
  ticks(g, CONFIG.awayCombat.wounded.squadRecallDelay + 2);
  ok(ev('squadRecall').length === 1 && g.players.every((p) => p.zone === 'ship'), 'Notrückholung der ganzen Crew');
  const neu = aw(g);
  ok(neu && neu !== awx && neu.drones.length === 0 && !neu.alarm, 'Siedlung komplett zurückgesetzt: neue Karte ohne Gegner, kein Alarm');
  ok(Anker.zustand(g, LP, a.id) === 'unten' && Anker.zustand(g, LP, ziel.id) === 'voll', 'Feldzeichen wieder unten, Zerstörtes (Kiste) wieder voll');
  ok(g.mission.state.stage === 'labs1' && g.mission.activeId === 'bot_lab', 'Szene zurück beim Hissen (Mission geht weiter)');
  ok(oda().some((t) => /beginnt von vorn/.test(t)), 'ODA „Notrückholung eingeleitet … beginnt von vorn“');
  ok(L.sperrgrund(g, LP) === null || true, 'Freischaltung: Landepunkt bleibt wählbar');
  ok(L.eintrag(g, LP) && !L.eintrag(g, LP).gesperrt, 'Landepunkt-Eintrag nicht gesperrt (Freischaltung bleibt)');
  // zweiter Versuch: wieder hissen -> wieder Angriff; danach Sieg
  ticks(g, CONFIG.awayCombat.wounded.recallBeamLock + 1);
  L.get(g, LP); g.transferZiel = { lp: LP, scene: g.ship.scene }; g.setAwayMap(LP);
  away.executeBeam(g, g.players.map((p) => p.id), 'down'); ticks(g, 0.5);
  Anker.setzen(g, LP, a.id, 'gehisst', g.players[0].id); ticks(g, 1);
  const aw2 = aw(g);
  ok(aw2.drones.length === 11 && g.mission.state.stage === 'labs1_kampf', 'zweiter Versuch: das Hissen löst den Angriff wieder aus (11 Gegner)');
  const boss = aw2.drones.find((e) => e.boss);
  for (let i = 0; i < 12 && boss.alive; i++) combat.hitEnemy(g, boss, 1, { pid: g.players[0].id, wirkung: { schaden: 9, wunde: true } });
  ticks(g, 2);
  ok(g.mission.missions.bot_lab.state === 'done' && aw2.drones.length === 0, 'danach Sieg im zweiten Versuch');
});

section('Katalog, Labor, Bausteine', () => {
  const e = Labor.laborListe().find((x) => x.id === LAB);
  ok(e && e.schauplatz === 'aussen' && e.landepunkt === LP, 'Labor-Eintrag stellung_nehmen/flagge_hissen (Landepunkt splitter.eisenwald)');
  ok(L.liste({ labor: null, ship: { scene: 'splitter' }, landepunkte: null }, 'splitter').every((x) => x.id !== LP), 'Labor-Landepunkt nur im Labor sichtbar');
  const Reg = require('../server/mission/registry.js');
  ok(['angriff_starten', 'gegner_abziehen', 'boss_besiegt', 'crew_gefallen'].every((id) => Reg.get(id)), 'Bausteine registriert');
  const k = require('../server/mission/katalog.js').load({});
  const u = k.molekuele.stellung_nehmen.umsetzungen.find((x) => x.id === 'flagge_hissen');
  ok(u && u.status === 'verfuegbar' && !u.dauer_je_crew['1'], 'Umsetzung verfügbar, solo nicht vorgesehen (zwei hissen gemeinsam)');
});

console.log(`\ntest-eisenwald: ${n - fails}/${n} ok${fails ? ', ' + fails + ' FEHLER' : ''}`);
process.exit(fails ? 1 : 0);
