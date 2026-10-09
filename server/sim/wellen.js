'use strict';
// Wellenmodi (Boden und All). Der Ablauf ist EINER für beide Bühnen (W2 AP3b): Countdown -> Welle -> Pause -> …,
// Ende -> Ergebnis (Welle, Zeit, Abschüsse je Spieler) -> Lobby; Snapshot-Block, Debug-Sprung, Abschuss-Zählung.
// Was je Bühne verschieden ist (Plan, Spawnen, „Crew unten“, Pause-Auffüllen), steht in BUEHNEN.boden bzw. BUEHNEN.all.
//
// Bodenkampf: Wellen (Lobby-Start 'arena_away' mit Kartenwahl). Endlos-Wellenmodus auf einer vorgebauten Karte bzw. dem
// Kesh-Hof. Alle Zahlen in CONFIG.wellen (per `tune wellen.<pfad>`).
//  - Welle n: Gesamtzahl wächst, Rollen und Karl-Waffen kommen nacheinander dazu (höchstens eine Neuheit je Welle), später
//    Häuptlinge (rank) und gemischte Trupps. Kein Sonderregel-Buff: Gegner kämpfen nach denselben Regeln wie die Crew.
//  - Höchstens maxLebend Gegner stehen gleichzeitig; der Rest rückt als Nachschub-Trupp nach, wenn welche fallen.
//  - Spawns über squad.spawnSquad (combat.spawnSquad), dann an einen Eingang/Kartenrand außer Sicht und ≥ spawnAbstand
//    Kacheln von jedem Spieler versetzt; Kesh über die Kesh-Spawnpunkte. Gebaut wird nie im Tick (Karte beim Start vorgebaut).
//  - Ablauf: Countdown -> Welle -> Pause (Aufrichten, Befreien, Auffüllen) -> … Ende, wenn die ganze Crew kampfunfähig ist
//    (Ergebnis: Welle, Zeit, Abschüsse je Spieler), dann zurück in die Lobby. Kein Weltstand.
// Wellen All (Lobby-Start 'arena_space' mit Szene, arena.js): Raumgegner (space.spawnEnemy), Eskalation nur über Zahl und
// Typ (planAll, CONFIG.wellen.all). Ende: Notfallprotokoll (Hülle 0). Pause: Gefallene stehen auf, Schilde voll.
const Physics = require('../../shared/physics.js');
const Los = require('../../shared/los.js');
const W = require('../world.js');
const { makeRng } = require('../util.js');

const TILE = Physics.TILE;
const TAG = 'welle';
let mods = null;
function M() {
  if (!mods) mods = { combat: require('./combat.js'), interior: require('./interior.js'), away: require('./away.js') };
  return mods;
}
const cfg = (game) => game.C.wellen;
const reihe = (tab, n) => Object.keys(tab || {}).filter((k) => Number(tab[k]) <= n).sort((a, b) => Number(tab[a]) - Number(tab[b]) || (a < b ? -1 : 1));
const neuIn = (tab, n) => Object.keys(tab || {}).sort().find((k) => Number(tab[k]) === n) || null;

// ---------------------------------------------------------------- Plan (rein, getestet in tools/test-wellen.js)
function anzahl(C, n, spieler) {
  const A = C.anzahl || {};
  const v = Number(A.basis || 0) + Number(A.jeWelle || 0) * n + Number(A.jeSpielerWelle || 0) * Math.max(0, spieler - 1) * n;
  return Math.max(1, Math.min(Number(A.max) || 40, Math.round(v)));
}
function haeuptlinge(C, n) {
  const R = C.rang || {};
  if (!(n >= Number(R.ab))) return 0;
  return Math.min(Number(R.max) || 1, 1 + Math.floor((n - Number(R.ab)) / Math.max(1, Number(R.alleWellen) || 1)));
}
// plan(C, n, spieler, rng) -> { gesamt, liste: [{ rolle, waffe|null, rang }], neu: { rolle?, waffe?, rang?, gemischt? }, gemischt }
function plan(C, n, spieler, rng) {
  const r = rng || Math.random;
  const N = anzahl(C, n, spieler);
  let rollen = reihe(C.rollenAb, n).filter((x) => !(x === 'haescher' && spieler <= 1));   // Besetzungsregel: solo kein Häscher
  if (!rollen.includes('grundtyp')) rollen.unshift('grundtyp');
  const neu = {};
  const nr = neuIn(C.rollenAb, n);
  if (nr && nr !== 'grundtyp' && rollen.includes(nr) && n > 1) neu.rolle = nr;
  const andere = rollen.filter((x) => x !== 'grundtyp');
  const karls = andere.length ? Math.min(N, Math.max(1, Math.ceil(N * (Number(C.karlAnteil) || 0)))) : N;
  const rollenListe = [];
  for (let i = 0; i < karls; i++) rollenListe.push('grundtyp');
  let rest = N - karls;
  if (neu.rolle && rest > 0) { rollenListe.push(neu.rolle); rest--; }   // Einführung: genau einer der neuen Rolle
  const alt = andere.filter((x) => x !== neu.rolle);
  const off = Math.floor(r() * Math.max(1, alt.length));
  for (let i = 0; i < rest; i++) rollenListe.push(alt.length ? alt[(off + i) % alt.length] : 'grundtyp');
  // Karl-Waffen: neue Waffe genau einmal (Einführung), sonst die zwei neuesten freigeschalteten im Wechsel
  const waffen = reihe(C.waffenAb, n);
  const nw = neuIn(C.waffenAb, n);
  if (nw && n > 1 && waffen.includes(nw)) neu.waffe = nw;
  const altW = waffen.filter((w) => w !== neu.waffe).slice(-2);
  let ki = 0;
  const liste = rollenListe.map((rolle) => {
    let waffe = null;
    if (rolle === 'grundtyp') {
      waffe = ki === 0 && neu.waffe ? neu.waffe : (altW.length ? altW[(ki + (neu.waffe ? 1 : 0)) % altW.length] : (waffen[0] || null));
      ki++;
    }
    return { rolle, waffe, rang: 0 };
  });
  // Reihenfolge: vor gemischtAb ein Trupp = eine Rolle (gruppiert), danach gemischt (reihum)
  const gemischt = n >= Number(C.gemischtAb);
  if (n === Number(C.gemischtAb)) neu.gemischt = true;
  for (let i = liste.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = liste[i]; liste[i] = liste[j]; liste[j] = t; }
  let geordnet;
  const gruppen = {};
  for (const e of liste) (gruppen[e.rolle] || (gruppen[e.rolle] = [])).push(e);
  const keys = Object.keys(gruppen).sort((a, b) => Number(C.rollenAb[a]) - Number(C.rollenAb[b]));
  if (!gemischt) geordnet = keys.flatMap((k) => gruppen[k]);
  else {
    geordnet = [];
    const qs = keys.map((k) => gruppen[k].slice());
    while (qs.some((q) => q.length)) for (const q of qs) if (q.length) geordnet.push(q.shift());
  }
  // Häuptlinge: je einer an der Spitze eines Trupps (Trupps bilden sich beim Spawnen aus aufeinanderfolgenden Einträgen)
  const h = haeuptlinge(C, n);
  const tg = Math.max(1, Number(C.truppGroesse) || 3);
  for (let i = 0; i < h; i++) { const e = geordnet[i * tg]; if (e) e.rang = 1; }
  if (h && n === Number(C.rang && C.rang.ab)) neu.rang = true;
  return { gesamt: N, liste: geordnet, neu, gemischt };
}

// Wellen All: planAll(A = CONFIG.wellen.all, n, spieler, rng) -> { gesamt, liste: [{ typ }], neu: { typ? } }
// Eskalation nur über Zahl (anzahl wie am Boden) und Typ (typenAb, je Welle höchstens ein neuer, der genau einmal kommt).
// Mindestens jaegerAnteil Jäger; der Rest reihum aus den älteren Typen. Höchstens ein Pylon je Welle (Turm, steht fest).
function planAll(A, n, spieler, rng) {
  const r = rng || Math.random;
  const N = anzahl(A, n, spieler);
  const typen = reihe(A.typenAb, n);
  if (!typen.includes('raider')) typen.unshift('raider');
  const neu = {};
  const nt = neuIn(A.typenAb, n);
  if (nt && nt !== 'raider' && n > 1) neu.typ = nt;
  const liste = [];
  if (neu.typ) liste.push({ typ: neu.typ });
  const jaeger = Math.min(N - liste.length, Math.max(1, Math.ceil(N * (Number(A.jaegerAnteil) || 0))));
  for (let i = 0; i < jaeger; i++) liste.push({ typ: 'raider' });
  const alt = typen.filter((t) => t !== 'raider' && t !== neu.typ);
  const off = Math.floor(r() * Math.max(1, alt.length));
  let pylone = liste.filter((e) => e.typ === 'pylon').length;
  for (let i = 0; liste.length < N; i++) {
    let t = alt.length ? alt[(off + i) % alt.length] : 'raider';
    if (t === 'pylon' && pylone >= 1) t = 'raider';
    if (t === 'pylon') pylone++;
    liste.push({ typ: t });
  }
  for (let i = liste.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = liste[i]; liste[i] = liste[j]; liste[j] = t; }
  return { gesamt: N, liste, neu };
}

// ---------------------------------------------------------------- Laufzeit
function st(game) { return game.arena && game.arena.wellen ? game.arena.wellen : null; }
function welleGegner(aw) { return ((aw && aw.drones) || []).filter((e) => e.tag === TAG); }
function stehend(aw) { return welleGegner(aw).filter((e) => e.alive); }
function team(game) { return game.players.filter((p) => p.connected); }

// start(game, { karte, seed, lp, fraktion }) – Karte steht, Team ist unten (arena.js)
function start(game, o) {
  const C = cfg(game);
  const aw = game.aways[o.lp];
  M().combat.ensureV2(game, aw, o.lp);
  aw.drones = [];   // Kesh: schlafender Wächter u. a. raus – im Wellenmodus zählen nur Wellen-Gegner
  aw.squads = {}; aw.projectiles = [];
  aw.ausbruchErlaubt = false;   // kein Ausbruch: gefangen = kampfunfähig
  const S = {
    buehne: 'boden', karte: o.karte, seed: o.seed, lp: o.lp, fraktion: o.fraktion || 'raubzug', n: 0, ph: 'countdown', bis: game.time + Number(C.countdown || 0),
    queue: [], gesamt: 0, start: game.time, kills: {}, abschuesse: 0, lebt: new Set(), proj: [], nachschubAt: 0, suchAt: 0,
    untenSeit: null, squadNr: 0, kandidaten: null, rng: makeRng(((o.seed | 0) * 2654435761 + 7) >>> 0), ergebnis: null, maxLebend: 0,
  };
  game.arena.wellen = S;
  tuerenAuf(game, o.lp);
  S.kandidaten = kandidaten(game, o.lp);
  game.oda(`Bodenkampf: Wellen auf ${o.name || o.karte} (Seed ${o.seed}). Welle 1 in ${Math.round(C.countdown)} s – sucht euch Deckung.`, null);
  game.log(`Wellen gestartet: ${o.karte} Seed ${o.seed} (${o.lp}).`);
  return S;
}

// Gebaute Karte als Kampfplatz: alle Türen/Tore/Schotts/Luken offen (anker.setzen, still), damit Gegner von den Eingängen
// zur Crew finden und niemand hinter einer Tür festsitzt (die KI öffnet keine Türen).
function tuerenAuf(game, lp) {
  const info = M().interior.awayInfoOf(lp);
  const k = info && info.karte;
  if (!k || !k.kanten) return 0;
  let A = null;
  try { A = require('./anker.js'); } catch (e) { return 0; }
  let n = 0;
  for (const id of Object.keys(k.kanten).sort()) {
    const kk = k.kanten[id];
    const li = Object.values(k.legende || {}).find((i) => i.kind === kk.typ);
    if (!li || !(li.zustaende || []).includes('offen')) continue;
    if (A.zustand(game, lp, id) === 'offen') continue;
    if (!A.setzen(game, lp, id, 'offen', null, { still: true })) n++;
  }
  return n;
}

// Spawn-Kandidaten: Eingänge und Kartenrand (gebaut), Kesh-Spawnpunkte (Handkarte)
function kandidaten(game, lp) {
  const info = M().interior.awayInfoOf(lp);
  const map = info.map;
  const pads = new Set((info.pads || []).map((q) => q.x + ',' + q.y));
  const out = []; const seen = new Set();
  const add = (x, y) => { const k = x + ',' + y; if (seen.has(k) || pads.has(k) || map.solid(x, y)) return; seen.add(k); out.push({ x, y }); };
  if (info.karte) {
    for (const a of info.karte.anker || []) if (a.rolle === 'eingang') { add(a.x, a.y); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) add(a.x + dx, a.y + dy); }
    for (let y = 1; y < map.h - 1; y++) for (let x = 1; x < map.w - 1; x++) if (x < 4 || y < 4 || x >= map.w - 4 || y >= map.h - 4) add(x, y);
  } else {
    const sp = info.spawns || {};
    for (const k of Object.keys(sp).sort()) for (const t of sp[k] || []) if (k !== 'warden') add(t.x, t.y);
  }
  return out;
}

// Erreichbare Kacheln ab den Spielern (offene Wege, Deck-Links)
function erreichbar(game, info, solid) {
  const map = info.map; const seen = new Set(); const q = [];
  for (const p of game.players) if (p.zone === 'away') { const t = Physics.toTile(p.x, p.y); const k = t.x + ',' + t.y; if (!seen.has(k)) { seen.add(k); q.push(t); } }
  let h = 0;
  while (h < q.length) {
    const c = q[h++];
    const nb = [[c.x + 1, c.y], [c.x - 1, c.y], [c.x, c.y + 1], [c.x, c.y - 1]];
    if (info.links) for (const l of info.links(c.x, c.y)) nb.push([l.x, l.y]);
    for (const [x, y] of nb) {
      if (x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
      const k = x + ',' + y;
      if (seen.has(k) || solid(x, y)) continue;
      seen.add(k); q.push({ x, y });
    }
  }
  return seen;
}

// Platz für einen Trupp aus k Gegnern -> [{x, y}] | null
function spawnPlatz(game, S, aw, k) {
  if (!game.away || game.away !== aw) return null;
  const C = cfg(game); const it = M().interior;
  const info = it.awayInfoOf(S.lp); const solid = it.awaySolid(game);
  const E = M().combat.env(game);
  const crew = game.players.filter((p) => p.zone === 'away');
  if (!crew.length) return null;
  const reach = erreichbar(game, info, solid);
  const pads = new Set((info.pads || []).map((q) => q.x + ',' + q.y));
  const besetzt = new Set(aw.drones.map((d) => { const t = Physics.toTile(d.x, d.y); return t.x + ',' + t.y; }));
  const frei = (x, y) => reach.has(x + ',' + y) && !besetzt.has(x + ',' + y) && !pads.has(x + ',' + y) && !solid(x, y);
  const minD = Number(C.spawnAbstand) || 10;
  const abstand = (t) => Math.min(...crew.map((p) => Math.hypot(p.x - (t.x + 0.5) * TILE, p.y - (t.y + 0.5) * TILE) / TILE));
  const versteckt = (t) => { const c = W.tileCenter(t.x, t.y); return !crew.some((p) => Los.lineOfSight(E.blocked, p.x, p.y, c.x, c.y)); };
  const gut = (t) => frei(t.x, t.y) && abstand(t) >= minD && versteckt(t);
  let cand = S.kandidaten.filter(gut);
  if (!cand.length) {   // keine Eingangs-/Randkachel passt: alle erreichbaren Kacheln
    const alle = [...reach].map((s) => { const [x, y] = s.split(',').map(Number); return { x, y }; });
    cand = alle.filter(gut);
    if (!cand.length) cand = alle.filter((t) => frei(t.x, t.y) && versteckt(t));
    if (!cand.length) cand = alle.filter((t) => frei(t.x, t.y)).sort((a, b) => abstand(b) - abstand(a)).slice(0, 5);
  }
  if (!cand.length) return null;
  // nicht zu weit weg (lange Anmärsche): bis spawnMax Kacheln, sonst die nächsten Kandidaten
  const nah = cand.filter((t) => abstand(t) <= (Number(C.spawnMax) || 24));
  cand = nah.length ? nah : cand.slice().sort((a, b) => abstand(a) - abstand(b)).slice(0, 6);
  // nicht zweimal hintereinander am selben Fleck: Kandidaten nahe dem letzten Spawn nach hinten
  const last = S.letzterSpawn;
  if (last && cand.length > 4) { const weg = cand.filter((t) => Math.hypot(t.x - last.x, t.y - last.y) > 6); if (weg.length) cand = weg; }
  const mitte = cand[Math.floor(S.rng() * cand.length)];
  S.letzterSpawn = mitte;
  // k freie Kacheln um die Mitte (BFS, höchstens 4 Kacheln weit); nur Kacheln, die selbst die Bedingungen erfüllen
  // (ist schon die Mitte ein Notbehelf, gilt für den Trupp nur „frei“)
  const passt = gut(mitte) ? gut : (t) => frei(t.x, t.y);
  const out = []; const seen = new Set([mitte.x + ',' + mitte.y]); const q = [mitte]; let h = 0;
  while (h < q.length && out.length < k) {
    const c = q[h++];
    if (Math.abs(c.x - mitte.x) + Math.abs(c.y - mitte.y) > 4) continue;
    if (passt(c)) out.push(c);
    for (const [x, y] of [[c.x + 1, c.y], [c.x - 1, c.y], [c.x, c.y + 1], [c.x, c.y - 1]]) {
      const kk = x + ',' + y;
      if (seen.has(kk) || !reach.has(kk) || solid(x, y)) continue;
      seen.add(kk); q.push({ x, y });
    }
  }
  return out.length ? out : null;
}

function fraktionDaten(game, id) {
  try { return (M().combat.katalogDaten(game).fraktionen || {})[id] || null; } catch (e) { return null; }
}

// Trupp aus den nächsten Einträgen der Warteschlange erscheinen lassen -> Zahl
function spawnTrupp(game, S, aw, k) {
  const C = cfg(game);
  if (!k) return 0;
  // Besetzungsregel: höchstens 1 Berserker je Spieler gleichzeitig – überzählige rücken in der Schlange nach hinten
  const spieler = Math.max(1, team(game).length);
  let enterer = stehend(aw).filter((e) => e.rolle === 'enterer').length;
  const group = []; const zurueck = [];
  while (S.queue.length && group.length < k) {
    const e = S.queue.shift();
    if (e.rolle === 'enterer' && enterer >= spieler && S.queue.some((q) => q.rolle !== 'enterer')) { zurueck.push(e); continue; }
    if (e.rolle === 'enterer') enterer++;
    group.push(e);
  }
  S.queue.push(...zurueck);
  if (!group.length) return 0;
  const plaetze = spawnPlatz(game, S, aw, group.length);
  if (!plaetze) { S.queue.unshift(...group); return 0; }
  const nGroup = Math.min(group.length, plaetze.length);
  S.queue.unshift(...group.slice(nGroup));
  const g8 = group.slice(0, nGroup);
  const name = 'welle' + S.n + '.' + (++S.squadNr);
  const besetzung = g8.map((g) => ({ typ: g.rolle, anzahl: 1 }));
  const n = M().combat.spawnSquad(game, name, { map: S.lp, besetzung, force: true, alert: true });
  const neue = aw.drones.filter((e) => e.squad === name);
  const F = fraktionDaten(game, S.fraktion);
  neue.forEach((e, i) => {
    const g = g8[i] || g8[g8.length - 1];
    e.tag = TAG; e.fraktion = S.fraktion; if (F && F.palette) e.palette = F.palette;
    M().combat.kaempfer(game, e);
    if (g.waffe) e.waffe = g.waffe;
    if (g.rang) { e.rank = 1; const w = Math.max(1, Number(C.rang && C.rang.wunden) || 1); e.wunden = { n: w, max: w }; }
    const t = plaetze[i] || plaetze[0];
    const c = W.tileCenter(t.x, t.y);
    e.x = c.x; e.y = c.y; e.home = { x: c.x, y: c.y }; e.stuckRef = { x: c.x, y: c.y }; e.stuckT = 0;
    e.path = null; e.goal = null; e.aim = null; e.patrouilliert = false;
    S.lebt.add(e.id);
  });
  const s = aw.squads[name];
  if (s) { s.fraktion = S.fraktion; s.tag = TAG; }
  if (n !== neue.length && game.log) game.log(`Wellen: Trupp ${name} ${neue.length}/${n}`);
  return neue.length;
}

// Liegende Gegner über maxKoerper: die ältesten verschwinden (Snapshot-Budget); gefesselt/aus zuerst
// Liegende, die wieder aufstehen können (aufgerichtet bzw. aufwachen), zählen zum Gegner-Budget: so stehen nie mehr als
// maxLebend gleichzeitig. Endgültig Liegende (aus, gefesselt) dürfen nur maxKoerper viele bleiben (Snapshot-Budget).
const KANN_AUFSTEHEN = { verwundet: 1, bewusstlos: 1 };
function kannAufstehen(e) { return !e.alive && !!KANN_AUFSTEHEN[e.zustand]; }
function imSpiel(aw) { return welleGegner(aw).filter((e) => e.alive || kannAufstehen(e)).length; }
function wegnehmen(aw, ids) { const weg = new Set(ids); aw.drones = aw.drones.filter((e) => !weg.has(e.id)); }
function koerperBudget(game, S, aw) {
  const C = cfg(game);
  const max = Math.max(0, Number(C.maxKoerper) || 0);
  const tot = welleGegner(aw).filter((e) => !e.alive && !kannAufstehen(e)).sort((a, b) => (a.welleGefallenAt || 0) - (b.welleGefallenAt || 0));
  if (tot.length > max) wegnehmen(aw, tot.slice(0, tot.length - max).map((e) => e.id));
  // Nachschub wartet nur wegen Liegender: wer länger als koerperZeit liegt und gerade nicht aufgerichtet wird, verschwindet
  if (!S.queue.length || imSpiel(aw) < C.maxLebend) return;
  const hilft = new Set(aw.drones.filter((h) => h.alive && h.role === 'aufrichten' && h.hilft).map((h) => h.hilft));
  const alt = welleGegner(aw).filter((e) => kannAufstehen(e) && !hilft.has(e.id) && game.time - (e.welleGefallenAt || 0) >= (Number(C.koerperZeit) || 10))
    .sort((a, b) => (a.welleGefallenAt || 0) - (b.welleGefallenAt || 0));
  const zuviel = imSpiel(aw) - C.maxLebend + 1;
  if (alt.length && zuviel > 0) wegnehmen(aw, alt.slice(0, Math.min(zuviel, Number(C.truppGroesse) || 3)).map((e) => e.id));
}

// Abschüsse: Übergang stehend -> liegend. Schütze = Spieler, dessen Projektil im selben Tick neben dem Gegner verschwand,
// sonst der nächste stehende Spieler mit Sichtlinie (Lanze, Schlag, Granate am Ziel).
function zaehleAbschuesse(game, S, aw) {
  const jetzt = new Set((aw.projectiles || []).map((q) => q.id));
  let E = null;
  for (const e of welleGegner(aw)) {
    if (e.alive) { S.lebt.add(e.id); continue; }
    if (!S.lebt.has(e.id)) continue;
    S.lebt.delete(e.id);
    e.welleGefallenAt = game.time;
    S.abschuesse++;
    let pid = null, bd = Infinity;
    for (const q of S.proj) {
      if (jetzt.has(q.id)) continue;
      const d = q.granate ? Math.hypot(q.tx - e.x, q.ty - e.y) : Math.hypot(q.x - e.x, q.y - e.y);
      if (d < (q.granate ? 3 * TILE : 56) && d < bd) { bd = d; pid = q.owner; }
    }
    if (!pid) {
      if (!E) E = M().combat.env(game);
      for (const p of game.players) {
        if (p.zone !== 'away' || p.downed) continue;
        const d = Math.hypot(p.x - e.x, p.y - e.y);
        if (d < bd && d < 16 * TILE && Los.lineOfSight(E.blocked, p.x, p.y, e.x, e.y)) { bd = d; pid = p.id; }
      }
    }
    if (pid) S.kills[pid] = (S.kills[pid] || 0) + 1;
  }
  S.proj = (aw.projectiles || []).filter((q) => q.owner && game.playerById(q.owner))
    .map((q) => ({ id: q.id, owner: q.owner, x: q.x, y: q.y, granate: q.kind === 'granate', tx: q.tx, ty: q.ty }));
}

// Trupps ohne Kontakt erfahren die Position des nächsten Spielers (Haltung wach, Ziel Spieler – kein Herumstehen)
function suchen(game, S, aw) {
  const C = cfg(game);
  if (game.time < S.suchAt) return;
  S.suchAt = game.time + (Number(C.suchTakt) || 6);
  const crew = game.players.filter((p) => p.zone === 'away' && p.connected && !p.downed);
  if (!crew.length) return;
  for (const s of Object.values(aw.squads || {})) {
    if (!s || s.tag !== TAG) continue;
    const m = aw.drones.find((e) => e.squad === s.name && e.alive);
    if (!m) continue;
    s.alert = true;
    if (Object.keys(s.lastKnown || {}).length) continue;
    const p = crew.slice().sort((a, b) => Math.hypot(a.x - m.x, a.y - m.y) - Math.hypot(b.x - m.x, b.y - m.y))[0];
    s.lastKnown[p.id] = { x: p.x, y: p.y, t: game.time };
    s.contactAt = game.time;
  }
}

const NEU_TEXT = {
  rolle: (r) => `Neu: ${ROLLE[r] || r}.`, waffe: (w) => `Karl trägt jetzt ${WAFFE[w] || w}.`,
};
const ROLLE = { grundtyp: 'Karl', niederhalter: 'Bolzer', grenadier: 'Donnerwerfer', schuetze: 'Jäger', enterer: 'Berserker', haescher: 'Wergeld-Fänger' };
const WAFFE = { schrottblaster: 'Schrottblaster', blaster: 'Blaster', sturmgewehr: 'Sturmgewehr', granatwerfer: 'Granatwerfer', lanze: 'Lanze' };

// ---------------------------------------------------------------- Bühne Boden
const BODEN = {
  bereit(game, S) { return !!game.aways[S.lp]; },
  zaehle(game, S) { zaehleAbschuesse(game, S, game.aways[S.lp]); },
  // „Crew unten“: alle verbundenen Spieler unten auf der Karte und kampfunfähig (verwundet/bewusstlos/gefesselt)
  unten(game) { const crew = team(game); return !!crew.length && crew.every((p) => p.zone === 'away' && p.downed); },
  stehend(game, S) { const aw = game.aways[S.lp]; return aw ? stehend(aw).length : 0; },
  plan(game, S, n) {
    const P = plan(cfg(game), n, Math.max(1, Math.min(3, team(game).length)), S.rng);
    if (P.neu.rolle) {
      // Ankündigung zu Wellenbeginn; als gesehen vermerken, damit combat.rolleGesehen sie beim ersten Anblick nicht noch einmal meldet
      try { const ws = game.weltstand; if (ws && typeof ws.rolleGesehen === 'function') ws.rolleGesehen(P.neu.rolle); } catch (e) { /* ohne Weltstand */ }
    }
    const extra = [];
    if (P.neu.rolle) extra.push(NEU_TEXT.rolle(P.neu.rolle));
    if (P.neu.waffe) extra.push(NEU_TEXT.waffe(P.neu.waffe));
    if (P.neu.rang) extra.push('Häuptlinge führen die Trupps.');
    if (P.neu.gemischt) extra.push('Ab jetzt gemischte Trupps.');
    return { gesamt: P.gesamt, liste: P.liste, neu: P.neu, extra };
  },
  angekuendigt(game, S, P) { if (P.neu.rolle) game.emit('rolleNeu', { rolle: P.neu.rolle }); },
  // Erstbesetzung: so viele Trupps wie Platz ist (verschiedene Eingänge)
  erstbesetzung(game, S) {
    const C = cfg(game); const aw = game.aways[S.lp];
    S.suchAt = game.time + 2;
    let guard = 0;
    while (S.queue.length && imSpiel(aw) < C.maxLebend && guard++ < 12) {
      const k = Math.min(Number(C.truppGroesse) || 3, C.maxLebend - imSpiel(aw), S.queue.length);
      if (!spawnTrupp(game, S, aw, k)) break;
    }
    S.nachschubAt = game.time + (Number(C.nachschubTakt) || 2);
  },
  // Kampf: Körper-Budget, Nachschub, Suche
  kampf(game, S) {
    const C = cfg(game); const aw = game.aways[S.lp];
    koerperBudget(game, S, aw);
    S.maxLebend = Math.max(S.maxLebend, stehend(aw).length);
    const belegt = imSpiel(aw);
    if (S.queue.length && belegt < C.maxLebend && game.time >= S.nachschubAt) {
      const k = Math.min(Number(C.truppGroesse) || 3, C.maxLebend - belegt, S.queue.length);
      spawnTrupp(game, S, aw, k);
      S.nachschubAt = game.time + (Number(C.nachschubTakt) || 2);
    }
    suchen(game, S, aw);
  },
  wegraeumen(game, S) { const aw = game.aways[S.lp]; if (aw) aw.drones = aw.drones.filter((e) => e.tag !== TAG); },
  // Aufrichten, Befreien, Auffüllen (wie Medipack: combat.revive bzw. voller Schild + Wunden)
  auffuellen(game, S) {
    const cb = M().combat; const aw = game.aways[S.lp];
    const oben = [];
    for (const p of team(game)) {
      if (p.zone === 'away') {
        if (p.downed) cb.revive(game, p, null);
        else { cb.fullShield(game, p); if (p.wunden) p.wunden.n = p.wunden.max; p.betaeubtBis = 0; }
      } else if (!p.console) oben.push(p.id);
    }
    if (oben.length && game.away === aw) M().away.executeBeam(game, oben, 'down');
  },
  geschafftText: (S, pause) => `Welle ${S.n} überstanden! Alle auf den Beinen – nächste Welle in ${pause} s.`,
  einfrieren(game, S) { for (const e of welleGegner(game.aways[S.lp])) { e.frozen = true; e.aim = null; e.path = null; } },
  endeTick(game, S) { const aw = game.aways[S.lp]; if (aw) aw.recallT = -1e6; },   // keine Notrückholung während der Ergebnisanzeige
  endeText: (S) => `Die Crew ist am Boden. Erreicht: Welle ${S.n}.`,
};

// ---------------------------------------------------------------- Bühne All (Raum)
const TYP_NAME = { raider: 'Jäger', gunboat: 'Kanonenboot', sentinel: 'Kustoden-Wächter', pylon: 'Pylon', relay: 'Störrelais' };
const cfgAll = (game) => (game.C.wellen && game.C.wellen.all) || {};
function spaceMod() { return require('./space.js'); }
function allGegner(game) { return game.space.enemies.filter((e) => e.tag === TAG); }
// Spawnpunkt: spawnAbstand px vom Schiff, Richtung Feldmitte ± 70°, frei von Brocken (still: aktuelle Lage; bewegt: Bahn)
function allPunkt(game, S, typ) {
  const A = cfgAll(game); const ship = game.ship; const sp = game.space;
  const pylon = typ === 'pylon';
  const R = pylon ? Number(A.pylonAbstand) || 480 : Number(A.spawnAbstand) || 900;
  const base = Math.atan2(sp.h / 2 - ship.y, sp.w / 2 - ship.x);
  const Drift = require('../../shared/drift.js');
  const bahnen = sp.asteroids.map((a) => ({ a, s: Drift.strecke(a) }));
  let best = null;
  for (let i = 0; i < 12; i++) {
    const ang = base + (S.rng() - 0.5) * 2.4;
    const x = Math.max(80, Math.min(sp.w - 80, ship.x + Math.cos(ang) * R));
    const y = Math.max(80, Math.min(sp.h - 80, ship.y + Math.sin(ang) * R));
    const frei = bahnen.every((q) => Drift.punktStrecke(x, y, q.s) > q.a.r + (pylon ? 90 : 50));
    if (frei) return { x, y };
    if (!best) best = { x, y };
  }
  return best;
}
function allSpawn(game, S, k) {
  let n = 0;
  for (let i = 0; i < k && S.queue.length; i++) {
    const g = S.queue.shift();
    const p = allPunkt(game, S, g.typ);
    const e = spaceMod().spawnEnemy(game, g.typ, { tag: TAG, x: p.x, y: p.y });
    S.lebt.add(e.id); n++;
  }
  return n;
}
// Abschüsse: Gegner der Welle, der aus space.enemies verschwand (zerstört oder treibt). Schütze = Spieler an der Taktik,
// sonst an der Steuer (Bolzen/Rammen); unbesetzt (Automatik) zählt für niemanden.
function allZaehle(game, S) {
  const da = new Set(allGegner(game).map((e) => e.id));
  for (const id of [...S.lebt]) {
    if (da.has(id)) continue;
    S.lebt.delete(id);
    S.abschuesse++;
    const p = game.players.find((q) => q.connected && q.console === 'weapons') || game.players.find((q) => q.connected && q.console === 'helm');
    if (p) S.kills[p.id] = (S.kills[p.id] || 0) + 1;
  }
}
const ALL = {
  bereit() { return true; },
  zaehle: allZaehle,
  // „Crew unten“ im Raum: das Notfallprotokoll hat gegriffen (Hülle 0) – kein Game Over, die Runde endet
  unten(game, S) { return (game.stats.emergencies || 0) > S.em0; },
  stehend(game) { return allGegner(game).length; },
  plan(game, S, n) {
    const P = planAll(cfgAll(game), n, Math.max(1, Math.min(3, team(game).length)), S.rng);
    const extra = P.neu.typ ? [`Neu: ${TYP_NAME[P.neu.typ] || P.neu.typ}.`] : [];
    const cnt = {};
    for (const e of P.liste) cnt[e.typ] = (cnt[e.typ] || 0) + 1;
    extra.unshift(Object.keys(cnt).map((k) => (cnt[k] > 1 ? cnt[k] + '× ' : '') + (TYP_NAME[k] || k)).join(', ') + '.');
    return { gesamt: P.gesamt, liste: P.liste, neu: P.neu, extra };
  },
  angekuendigt() {},
  erstbesetzung(game, S) {
    const A = cfgAll(game);
    allSpawn(game, S, Math.min(Number(A.maxLebend) || 6, S.queue.length));
    S.nachschubAt = game.time + (Number(A.nachschubTakt) || 4);
  },
  kampf(game, S) {
    const A = cfgAll(game);
    const l = allGegner(game).length;
    S.maxLebend = Math.max(S.maxLebend, l);
    if (S.queue.length && l < (Number(A.maxLebend) || 6) && game.time >= S.nachschubAt) {
      allSpawn(game, S, Math.min(Number(A.truppGroesse) || 2, (Number(A.maxLebend) || 6) - l, S.queue.length));
      S.nachschubAt = game.time + (Number(A.nachschubTakt) || 4);
    }
  },
  wegraeumen(game) { game.space.enemies = game.space.enemies.filter((e) => e.tag !== TAG); },
  // Pause: Gefallene an Bord stehen auf, Schilde voll (Hülle bleibt – reparieren ist Arbeit der Crew)
  auffuellen(game) {
    const it = M().interior;
    for (const p of team(game)) if (p.downed && typeof it.revivePlayer === 'function') it.revivePlayer(game, p);
    const sh = game.ship.shields;
    if (sh && Array.isArray(sh.alloc)) sh.current = sh.alloc.slice();
  },
  geschafftText: (S, pause) => `Welle ${S.n} geräumt! Schilde geladen – nächste Welle in ${pause} s. Kurz reparieren.`,
  // Ende: Gegner drehen ab und schießen nicht mehr (Ergebnisanzeige ohne weitere Treffer)
  einfrieren(game) {
    game.ship.holdFireUntil = game.time + 1e6;
    for (const e of allGegner(game)) { e.retreatUntil = game.time + 1e6; e.tele = null; }
  },
  endeTick() {},
  endeText: (S) => `Notfallprotokoll – die Runde ist vorbei. Erreicht: Welle ${S.n}.`,
};
const BUEHNEN = { boden: BODEN, all: ALL };
function buehne(S) { return BUEHNEN[S.buehne] || BODEN; }

// start All (arena.js): Szene steht, Schiff abgelegt, Crew an Bord. o = { szene, karte, seed, name }
function startAll(game, o) {
  const C = cfg(game);
  const S = {
    buehne: 'all', karte: o.karte, szene: o.szene, seed: o.seed, lp: null, n: 0, ph: 'countdown', bis: game.time + Number(C.countdown || 0),
    queue: [], gesamt: 0, start: game.time, kills: {}, abschuesse: 0, lebt: new Set(), nachschubAt: 0,
    untenSeit: null, rng: makeRng(((o.seed | 0) * 2654435761 + 11) >>> 0), ergebnis: null, maxLebend: 0,
    em0: game.stats.emergencies || 0,
  };
  game.arena.wellen = S;
  game.oda(`Wellen All: ${o.name || o.szene}. Welle 1 in ${Math.round(C.countdown)} s – Steuer, Taktik, Captain auf Station.`, null);
  game.log(`Wellen All gestartet: ${o.szene} Seed ${o.seed}.`);
  return S;
}

// ---------------------------------------------------------------- gemeinsamer Ablauf
function beginne(game, S, n) {
  const B = buehne(S);
  const P = B.plan(game, S, n);
  S.n = n; S.queue = P.liste.slice(); S.gesamt = P.gesamt; S.ph = 'kampf'; S.bis = null; S.nachschubAt = 0;
  S.welleStart = game.time;
  game.emit('welle', { n, gesamt: P.gesamt, neu: P.neu });
  B.angekuendigt(game, S, P);
  game.oda(`Welle ${n}: ${P.gesamt} Gegner.${P.extra.length ? ' ' + P.extra.join(' ') : ''}`, null);
  game.emit('sfx', { name: 'alarm_red' });
  B.erstbesetzung(game, S);
}

function geschafft(game, S) {
  const C = cfg(game); const B = buehne(S);
  S.ph = 'pause'; S.bis = game.time + Number(C.pause || 0);
  B.wegraeumen(game, S);
  S.lebt.clear();
  B.auffuellen(game, S);
  game.emit('welleGeschafft', { n: S.n, pause: Number(C.pause || 0) });
  game.oda(B.geschafftText(S, Math.round(C.pause)), null);
}

function ende(game, S) {
  const C = cfg(game); const B = buehne(S);
  S.ph = 'ende'; S.bis = game.time + Number(C.ergebnisZeit || 10);
  B.einfrieren(game, S);
  const zeit = Math.round(game.time - S.start);
  const kills = game.players.map((p) => [p.id, p.name, S.kills[p.id] || 0]);
  S.ergebnis = { karte: S.karte, seed: S.seed, welle: S.n, geschafft: Math.max(0, S.n - 1), zeit, kills, ...(S.debug ? { debug: true } : {}) };
  if (S.buehne === 'all') S.ergebnis.brocken = Object.assign({ lerche: 0, gegner: 0, schuesse: 0, strahlen: 0 }, game.stats.brocken || {});
  game.emit('wellenEnde', S.ergebnis);
  game.oda(B.endeText(S), null);
  game.log(`Wellen Ende: ${S.karte} Seed ${S.seed}, Welle ${S.n}, ${zeit} s, Abschüsse ${kills.map((k) => k[1] + ' ' + k[2]).join(', ')}.`);
}

function update(game, dt) {
  const S = st(game);
  if (!S || game.phase !== 'play') return;
  const C = cfg(game); const B = buehne(S);
  if (!B.bereit(game, S)) return;
  if (S.ph === 'ende') {
    B.endeTick(game, S);
    if (game.time >= S.bis) zurLobby(game);
    return;
  }
  B.zaehle(game, S);
  if (B.unten(game, S) && S.ph !== 'countdown') {
    if (S.untenSeit == null) S.untenSeit = game.time;
    if (game.time - S.untenSeit >= Number(C.endeNach || 0)) { ende(game, S); return; }
  } else S.untenSeit = null;
  if (S.ph === 'countdown' || S.ph === 'pause') {
    if (game.time >= S.bis) beginne(game, S, S.n + 1);
    return;
  }
  B.kampf(game, S);
  if (!S.queue.length && !B.stehend(game, S)) geschafft(game, S);
}

function zurLobby(game) {
  if (typeof game.endSession === 'function') game.endSession(null, { grund: 'wellen' });
}

// Snapshot-Block (nur im Wellenmodus): { k, s, n, ph, t, r, l }
function snap(game) {
  const S = st(game);
  if (!S) return null;
  const l = buehne(S).stehend(game, S);
  return { k: S.karte, s: S.seed, n: S.n, ph: S.ph, t: S.bis != null ? Math.max(0, Math.ceil(S.bis - game.time)) : 0, r: S.ph === 'kampf' ? S.queue.length + l : 0, l };
}

// Debug `welle <n>` (nur --debug): aktuelle Gegner weg, sofort Welle n
function debugWelle(game, n) {
  const S = st(game);
  if (!S) return 'welle: nur im Wellenmodus (Wellen Boden / Wellen All).';
  const k = Math.max(1, Math.min(999, Math.round(Number(n)) || 1));
  if (S.ph === 'ende') return 'welle: die Runde ist vorbei.';
  buehne(S).wegraeumen(game, S);
  S.lebt.clear(); S.untenSeit = null; S.debug = true;   // Runde mit Debug-Sprung zählt nicht als Rekord
  beginne(game, S, k);
  return null;
}

module.exports = { TAG, plan, planAll, anzahl, haeuptlinge, start, startAll, update, snap, debugWelle, kandidaten, spawnPlatz, BUEHNEN, _st: st };
