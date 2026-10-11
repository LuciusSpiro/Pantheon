'use strict';
// EK5 Methalle (CONTRACT-EK5-6.md): Militärsiedlung mit Mauer, Rohr (Schleichweg) und Landefeld außerhalb (shared/gen-siedlung.js,
// Variante methalle), Prüfer K-MAUER-DICHT/K-ROHR, Sprengstoff platzieren ohne Explosion (anker.js ladungPlatzieren), Zweiergruppen und
// Nachschub mit Obergrenze 8 (combat.besetzenPatrouillen/nachschubBaracken), Kauf auf Stationen, Labor-Umsetzung
// sabotieren/sprengstoff_platzieren mit Weltstand-Fakt sperrriegel.
//   node tools/test-methalle.js [begriff …]   -> nur Abschnitte, deren Name einen der Begriffe enthält
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
const shop = require('../server/sim/shop.js');
const Labor = require('../server/mission/labor.js');
const W = require('../server/world.js');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const LP = 'splitter.methalle';
const LAB = 'sabotieren/sprengstoff_platzieren';
let n = 0, fails = 0;
function ok(c, msg) { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); }
function section(name, fn) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n[' + name + ']');
  try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
}
const ticks = (g, sek) => { const k = Math.round(sek * CONFIG.tickHz); for (let i = 0; i < k; i++) g.step(); };
const roh = (seed, N) => GenSiedlung.erzeuger(130, 90).karteRoh(seed, N || 10, { bauweise: 'germanen', typ: 'militaer', variante: 'methalle', besitz: 'raubzug', zustand: 'intakt', id: LP });
const bauen = (seed, N) => Buehne.ausRaster(roh(seed, N), { spiel: true });
const zaehl = (k) => { const z = {}; for (const a of k.anker) z[a.rolle] = (z[a.rolle] || 0) + 1; return z; };
const zeichen = (k, c) => { const out = []; k.rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === c) out.push({ x, y }); }); return out; };
// Erreichbarkeit (4er-Nachbarschaft) von der Ankunft; ohneRohr: Rohrkacheln sperren
function erreichbar(k, ohneRohr) {
  const r = Buehne.raster(k);
  const start = k.anker.find((a) => a.rolle === 'abholpunkt' && a.ankunft);
  const seen = new Set([start.y * k.w + start.x]); const q = [[start.x, start.y]];
  const objekt = new Set(k.anker.filter((a) => ['terminal', 'sprengpunkt', 'zelle', 'beute', 'ziel', 'fund', 'raetsel'].includes(a.rolle)).map((a) => a.y * k.w + a.x));
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, key = ny * k.w + nx;
      if (nx < 0 || ny < 0 || nx >= k.w || ny >= k.h || seen.has(key) || !r.durchgang(nx, ny)) continue;
      if (ohneRohr && r.info(nx, ny).kind === 'rohr') continue;
      if (objekt.has(key)) { seen.add(key); continue; }
      seen.add(key); q.push([nx, ny]);
    }
  }
  return seen;
}

// Labor-Spiel (Lobby wie die Spieler) mit np Spielern, Szene sabotieren/sprengstoff_platzieren, Crew unten auf der Methalle
function laborSpiel(np, seed, unten) {
  const g = new Game({ noStore: true, seed: seed || 7, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < np; i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 400) this.inbox.push(m); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'M' + i, name: 'M' + i, color: i }); cs.push(c);
  }
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: 'labor', labor: { id: LAB, seed: seed || 5 } });
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  ticks(g, 1);
  const aw = L.get(g, LP);
  if (unten !== false) {
    g.transferZiel = { lp: LP, scene: g.ship.scene }; g.setAwayMap(LP);
    away.executeBeam(g, g.players.map((p) => p.id), 'down');
    ticks(g, 0.5);
  }
  const ev = (kind) => cs[0].inbox.filter((m) => m.t === 'event' && m.kind === kind);
  return { g, cs, aw, ev };
}
const sprengAnker = (aw) => W.AWAY_MAPS[aw.map].karte.anker.filter((a) => a.rolle === 'sprengpunkt');
const halten = (g, p, a) => Anker.completeHold(g, p, { kind: 'anker:sprengpunkt', anker: a.id });

// ---------------------------------------------------------------------------------------------------------------------
section('Generator: Mauer, Rohr, Landefeld außerhalb, ein Teleportpunkt', () => {
  let gut = 0, fehler = [], bytes = 0, sprengOk = true, einOk = true, rohrOk = true, mauerOk = true, torOk = true, pflichtOk = true, patOk = true;
  const SEEDS = 30;
  for (let seed = 1; seed <= SEEDS; seed++) {
    let r;
    try { r = bauen(seed); } catch (e) { fehler.push(`${seed}: ${e.message}`); continue; }
    if (!r.pruefung.ok) { fehler.push(`${seed}: ${r.fehler.slice(0, 2).map((f) => f.code).join(',')}`); continue; }
    gut++;
    const k = r.karte, z = zaehl(k);
    if ((z.abholpunkt || 0) !== 1 || !k.ankunft) einOk = false;
    if (zeichen(k, 'r').length !== 3) rohrOk = false;
    if (zeichen(k, 'G').length) torOk = false;   // kein Tor
    if (!(z.baracke >= 4 && z.sprengpunkt >= 1)) pflichtOk = false;
    if (!k.anker.filter((a) => a.rolle === 'sprengpunkt').every((a) => a.modus === 'platzieren')) sprengOk = false;
    if (k.patrouillen.length < 3 || k.patrouillen.length > 4) patOk = false;
    // Mauer dicht: von der Ankunft ohne Rohr erreicht man kein Ziel, mit Rohr alle
    const ohne = erreichbar(k, true), mit = erreichbar(k, false);
    const ziele = k.anker.filter((a) => ['terminal', 'sprengpunkt', 'ziel', 'zelle', 'beute'].includes(a.rolle));
    const nah = (set, a) => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => set.has((a.y + dy) * k.w + a.x + dx));
    if (ziele.some((a) => nah(ohne, a))) mauerOk = false;
    if (!ziele.every((a) => nah(mit, a))) mauerOk = false;
    bytes = Math.max(bytes, Buffer.byteLength(JSON.stringify(Game.prototype.awayMapPayload.call({}, k))));
  }
  ok(gut >= SEEDS * 0.8, `Prüfer ok und Pflichtsatz (${gut}/${SEEDS} Seeds, der Rest geht über Seed + 1 wie im Spiel)${fehler.length ? ': ' + fehler.slice(0, 3).join(' | ') : ''}`);
  ok(einOk, 'genau ein Abholpunkt (einziger Teleportpunkt), er ist die Ankunft');
  ok(rohrOk && torOk, 'Rohr aus genau drei Kacheln (Mund, Mauer, Mund), kein Tor in der Mauer');
  ok(mauerOk, 'Mauer dicht: ohne Rohr ist von der Ankunft kein Ziel erreichbar, mit Rohr jedes');
  ok(pflichtOk && sprengOk, 'mindestens 4 Baracken-Anker, Sprengziele im Modus platzieren');
  ok(patOk, 'drei bis vier Patrouillenwege (Zweiergruppen)');
  ok(bytes <= Protocol.AWAY_MAP_MAX_BYTES, `awayMap höchstens ${bytes} B ≤ ${Protocol.AWAY_MAP_MAX_BYTES} B`);
  ok(JSON.stringify(roh(3)) === JSON.stringify(roh(3)), 'gleicher Seed, gleiche Karte');
  const k = bauen(3).karte, lf = k.plaetze.landefeld.rect, rohrT = zeichen(k, 'r');
  const mauer = zeichen(k, '#').length;
  ok(k.meta.schleichweg === true && k.meta.variante === 'methalle' && mauer > 100 && rohrT.length === 3 && !!lf, 'meta: schleichweg, variante methalle');
  // Ausgabe ohne Variante bleibt wie bisher (Tor, Landefeld innen, zwei Abholpunkte)
  const alt = Buehne.ausRaster(GenSiedlung.erzeuger(130, 90).karteRoh(3, 10, { bauweise: 'germanen', typ: 'militaer', besitz: 'raubzug', zustand: 'umkaempft', id: 'x' }), { spiel: true }).karte;
  ok(zeichen(alt, 'G').length > 0 && zeichen(alt, 'r').length === 0 && zaehl(alt).abholpunkt === 2 && !alt.anker.some((a) => a.rolle === 'baracke' || a.modus), 'ohne Variante: Militärlager unverändert (Tor, zwei Abholpunkte, keine Baracken)');
});

section('Prüfer: K-MAUER-DICHT und K-ROHR', () => {
  const rh = roh(3);
  const rs = zeichen({ rows: rh.rows }, 'r');
  const mid = rs.slice().sort((a, b) => a.x - b.x || a.y - b.y)[1];
  const waagrecht = rs.every((q) => q.y === rs[0].y);
  const setz = (x, y, c) => { const k = JSON.parse(JSON.stringify(rh)); k.rows[y] = k.rows[y].slice(0, x) + c + k.rows[y].slice(x + 1); return k; };
  const codes = (k) => { const r = Buehne.ausRaster(k, { spiel: true }); return r.fehler.map((f) => f.code); };
  ok(codes(rh).length === 0, 'unveränderte Karte besteht den Prüfer');
  // Loch in der Mauer neben dem Rohr
  const loch = waagrecht ? setz(mid.x, mid.y - 1, ',') : setz(mid.x - 1, mid.y, ',');
  ok(codes(loch).includes('K-MAUER-DICHT'), `Loch in der Mauer neben dem Rohr -> K-MAUER-DICHT (${[...new Set(codes(loch))].join(',')})`);
  // Rohr zugemauert
  const zu = setz(mid.x, mid.y, '#');
  const cz = codes(zu);
  ok(cz.includes('K-ROHR') && cz.includes('K-ERREICHBAR'), `Rohr zugemauert -> K-ROHR und K-ERREICHBAR (${[...new Set(cz)].join(',')})`);
  // Karten ohne Rohr und ohne schleichweg werden nicht geprüft (Bestand)
  const alt = Buehne.ausRaster(GenSiedlung.erzeuger(130, 90).karteRoh(3, 10, { bauweise: 'germanen', typ: 'militaer', besitz: 'raubzug', zustand: 'umkaempft', id: 'x' }), { spiel: true });
  ok(alt.pruefung.ok, 'Karte ohne Rohr: kein K-MAUER-DICHT (Bestand unverändert)');
  // Rohr sperrt Sicht, ist begehbar
  const k = bauen(3).karte, r = Buehne.raster(k);
  ok(r.begehbar(mid.x, mid.y) && r.sperrtSicht(mid.x, mid.y) && r.info(mid.x, mid.y).kind === 'rohr', 'Rohrkachel: begehbar, sperrt die Sicht');
});

section('Sprengstoff platzieren: keine Explosion, kein Alarm', () => {
  const { g, aw, ev } = laborSpiel(2, 7);
  const k = W.AWAY_MAPS[LP].karte, a = sprengAnker(aw)[0], p = g.players[0];
  ok(a && a.modus === 'platzieren' && Anker.zustand(g, LP, a.id) === 'intakt', 'Sprengziel im Modus platzieren, intakt');
  ok(g.inventory.ladung === 1, 'die Szene hat Sprengstoff ins Inventar gelegt (Labor: die Crew hat keinen)');
  p.zone = 'away'; const t = { x: a.x, y: a.y };
  const li = [];
  require('../server/sim/anker.js').interactionsAt(g, p, t.x, t.y, li);
  ok(li[0] && li[0].kind === 'anker:sprengpunkt' && li[0].modus === 'platzieren' && !li[0].blocked, 'Interaktion: E halten zum Platzieren');
  ok(Anker.holdDuration(g, p, 'anker:sprengpunkt', li[0]) === 4, 'Haltezeit 4 s');
  // Treffer unterbricht: nichts verbraucht
  p.hold = { kind: 'anker:sprengpunkt', anker: a.id };
  Anker.onTreffer(g, p.id);
  ok(p.hold === null && g.inventory.ladung === 1 && Anker.zustand(g, LP, a.id) === 'intakt', 'Treffer unterbricht das Platzieren, nichts verbraucht');
  const ohne = g.inventory.ladung; g.inventory.ladung = 0;
  const li0 = []; Anker.interactionsAt(g, p, t.x, t.y, li0);
  ok(li0[0] && /Kein Sprengstoff/.test(li0[0].blocked), 'ohne Sprengstoff: Hinweis, nicht platzierbar'); g.inventory.ladung = ohne;
  const hp0 = g.players.map((q) => q.shield && q.shield.seg);
  halten(g, p, a);
  ok(Anker.zustand(g, LP, a.id) === 'platziert' && g.inventory.ladung === 0, 'platziert, Sprengstoff verbraucht');
  ok(ev('ladungPlatziert').length === 1 && !ev('ladungExplodiert').length && !ev('ladungScharf').length, 'Ereignis ladungPlatziert; weder scharf noch Explosion');
  ticks(g, 75);
  ok(Anker.zustand(g, LP, a.id) === 'platziert' && !ev('ladungExplodiert').length && !(aw.ankerLauf.ladung && Object.keys(aw.ankerLauf.ladung).length), '75 s später: kein Countdown, keine Explosion');
  ok(!aw.alarm, 'kein Alarm durch das Platzieren');
  ok(g.players.every((q, i) => (q.shield && q.shield.seg) === hp0[i]), 'niemand getroffen');
  const snap = Anker.awaySnap(g, aw);
  const i = k.anker.findIndex((x) => x.id === a.id);
  ok(snap.ao.some((q) => q[0] === i && q[1] === 3) && !snap.cd, 'Snapshot: Zustandsindex 3 (platziert), kein Countdown');
  const liP = []; Anker.interactionsAt(g, p, t.x, t.y, liP);
  ok(liP[0] && /Sprengstoff liegt/.test(liP[0].blocked), 'danach: Hinweis „Sprengstoff liegt“, kein zweites Platzieren');
  const inv = g.snapshot().inventory;
  ok(!('ladung' in inv), 'Snapshot-Inventar: ladung fehlt bei 0 (Budget)');
  g.inventory.ladung = 2; ok(g.snapshot().inventory.ladung === 2, 'Snapshot-Inventar: ladung zählt, wenn vorhanden');
});

section('Zweiergruppen auf Patrouille und Nachschub (höchstens 8)', () => {
  const { g, aw } = laborSpiel(3, 7, false);
  // Karte als aktive Außenkarte (ohne Beamen), leer: Wellen von Hand setzen
  g.transferZiel = { lp: LP, scene: g.ship.scene }; g.setAwayMap(LP);
  aw.drones.length = 0; aw.squads = {};
  const k = W.AWAY_MAPS[LP].karte;
  const alive = () => aw.drones.filter((e) => e.alive);
  const n1 = combat.besetzenPatrouillen(g, { map: LP, fraktion: 'raubzug', tag: 'w1', gruppen: 3 });
  ok(n1 === 6 && alive().length === 6, `Welle 1: drei Zweiergruppen = 6 Gegner (${n1})`);
  const sq = Object.values(aw.squads).filter((s) => s.tag === 'w1');
  ok(sq.length === 3 && sq.every((s) => aw.drones.filter((e) => e.squad === s.name).length === 2 && s.schleich && !s.alert && s.weg && s.weg.length >= 2), 'je Gruppe zwei Gegner, ruhig (Schleich-Besetzung), mit Patrouillenweg');
  ok(new Set(sq.map((s) => JSON.stringify(s.weg))).size === 3, 'jede Gruppe auf einem eigenen Weg');
  ok(alive().every((e) => e.rolle === 'grundtyp' && e.fraktion === 'raubzug' && e.tag === 'w1'), 'Grundtypen der Fraktion, tag gesetzt');
  const n2 = combat.nachschubBaracken(g, { map: LP, fraktion: 'raubzug', tag: 'w2', gruppen: 2 });
  ok(n2 === 2 && alive().length === 8, `Welle 2 (Nachschub): wegen Obergrenze nur eine Gruppe, 8 Gegner (${n2})`);
  const baracken = Object.values(k.plaetze).filter((q) => q.typ === 'lagerhalle').map((q) => q.rect);
  const imGeb = (e) => { const t = Physics.toTile(e.x, e.y); return baracken.some((r) => t.x >= r[0] && t.x < r[0] + r[2] && t.y >= r[1] && t.y < r[1] + r[3]); };
  ok(aw.drones.filter((e) => e.tag === 'w2').every(imGeb), 'Nachschub erscheint in einem Gebäude (Baracke), nicht auf der Straße');
  ok(!aw.alarm && Object.values(aw.squads).every((s) => !s.alert), 'weder Alarm noch alarmierter Trupp');
  ok(combat.nachschubBaracken(g, { map: LP, fraktion: 'raubzug', tag: 'w3', gruppen: 4 }) === 0 && alive().length === 8, 'bei 8 Gegnern kommt nichts mehr');
  // vier ausschalten -> Nachschub füllt wieder bis 8, nie darüber
  for (const e of alive().slice(0, 4)) for (let i = 0; i < 12 && e.alive; i++) combat.hitEnemy(g, e, 1, { pid: g.players[0].id, wirkung: { schaden: 9, wunde: true } });
  const noch = combat.aktiveGegner(aw);
  const n3 = combat.nachschubBaracken(g, { map: LP, fraktion: 'raubzug', tag: 'w4', gruppen: 4 });
  ok(noch <= 8 && combat.aktiveGegner(aw) <= 8 && combat.aktiveGegner(aw) === Math.min(8, noch + n3), `nach vier Ausfällen (${noch} aktiv) füllt der Nachschub auf höchstens 8 (${combat.aktiveGegner(aw)})`);
  // Obergrenze auch über die Zeit
  let max = 0; g.players.forEach((p) => { p.zone = 'ship'; });
  for (let i = 0; i < 20; i++) { ticks(g, 1); max = Math.max(max, combat.aktiveGegner(aw)); }
  ok(max <= 8, `über 20 s nie mehr als 8 aktiv (max ${max})`);
});

section('Kauf: Sprengstoff an Stationen', () => {
  const g = new Game({ noStore: true, seed: 3, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
  const c = { inbox: [], send() {} }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'S0', name: 'S0', color: 0 });
  const p = g.players[0];
  const e = CONFIG.shop.find((s) => s.id === 'ladung');
  ok(e && e.kind === 'item' && e.price > 0 && JSON.stringify(e.where) === '["hafen"]', `Shop-Eintrag ladung: Gegenstand, ${e && e.price} Marken, nur Hafen/Station`);
  g.inventory.marks = 500; g.ship.docked = false;
  ok(/angedockt/.test(shop.buy(g, p, 'ladung') || ''), 'nicht angedockt: kein Kauf');
  g.debugGoto('hafen', true); ticks(g, 0.5);
  const m0 = g.inventory.marks;
  ok(shop.buy(g, p, 'ladung') === null && g.inventory.ladung === 1 && g.inventory.marks === m0 - e.price, 'im Hafen gekauft: Inventar ladung +1, Marken abgezogen');
  g.inventory.marks = 0;
  ok(/Nicht genug/.test(shop.buy(g, p, 'ladung') || ''), 'ohne Marken kein Kauf');
});

section('Umsetzung sabotieren/sprengstoff_platzieren: Ablauf, Meldung, sperrriegel', () => {
  const liste = Labor.laborListe();
  const eintrag = liste.find((x) => x.id === LAB);
  ok(eintrag && eintrag.schauplatz === 'aussen' && eintrag.landepunkt === LP, 'im Labor-Katalog (Boden, Landepunkt splitter.methalle)');
  ok(L.liste({ labor: null, ship: { scene: 'splitter' }, landepunkte: null }, 'splitter').every((x) => x.id !== LP), 'Labor-Landepunkt erscheint außerhalb des Labors nicht in der Transfer-Liste');
  const { g, aw, ev, cs } = laborSpiel(3, 11);
  const odas = () => cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'oda').map((m) => (m.data && m.data.text) || m.text || '');
  const fakt = () => g.weltstand && g.weltstand.data.fakten.sperrriegel;
  ok(g.mission.activeId === 'bot_lab' && g.inventory.ladung === 1, 'Szene läuft, Sprengstoff im Inventar');
  const alive = () => aw.drones.filter((e) => e.alive).length;
  ok(alive() === 6, `Welle 1 steht beim Betreten (3 Zweiergruppen = ${alive()} Gegner)`);
  ok(fakt() === undefined, 'noch kein Fakt sperrriegel');
  const a = sprengAnker(aw)[0], p = g.players[0];
  halten(g, p, a); ticks(g, 1);
  ok(alive() === 8 && Object.values(aw.squads).filter((s) => /_w2\./.test(s.name)).length === 1, `Platzieren löst Welle 2 aus (Nachschub bis zur Obergrenze: ${alive()} Gegner)`);
  ok(fakt() === undefined, 'solange jemand unten ist: kein Fakt, keine Meldung');
  ok(g.mission.activeId === 'bot_lab', 'Szene läuft weiter (Rückweg zum Teleportpunkt)');
  // alle hoch
  away.executeBeam(g, g.players.map((q) => q.id), 'up'); g.players.forEach((q) => { q.zone = 'ship'; });
  ticks(g, 2);
  ok(fakt() === true, 'nach dem Hochbeamen: Weltstand-Fakt sperrriegel = true');
  ok(g.mission.missions.bot_lab && g.mission.missions.bot_lab.state === 'done', 'Mission abgeschlossen');
  ok(odas().some((t) => /Außenposten zerstört/.test(t)), 'Meldung „Außenposten zerstört“ nach dem Hochbeamen');
  // Skip-Pfad (Debug) setzt dieselbe Folge
  const s2 = laborSpiel(2, 12);
  s2.g.mission.skip(); ticks(s2.g, 2);
  ok(s2.g.weltstand.data.fakten.sperrriegel === true && Anker.zustand(s2.g, LP, sprengAnker(s2.aw)[0].id) === 'platziert', 'skip: Sprengziel platziert, sperrriegel gesetzt');
  // Speichern/Laden des Weltstands behält den Fakt
  const save = JSON.parse(JSON.stringify(g.weltstand.toSave ? g.weltstand.toSave() : { welt: { fakten: g.weltstand.data.fakten } }));
  const fakten = (save.welt && save.welt.fakten) || save.fakten || {};
  ok((fakten.sperrriegel && typeof fakten.sperrriegel === 'object' ? fakten.sperrriegel.value : fakten.sperrriegel) === true, 'Weltstand-Speicherform enthält sperrriegel');
});

console.log(`\ntest-methalle: ${n - fails}/${n} ok${fails ? ', ' + fails + ' FEHLER' : ''}`);
process.exit(fails ? 1 : 0);
