'use strict';
// PAN-01 C: Waffen der Lerche – neun Plätze, Waffenkatalog (shared/schiffskatalog.js), geteilter Ladepool, Torpedowerfer, Magazindeckel.
//
//   game.ship.waffen   { platz (1–9): Katalog-Id }  Bestückung; Start 8 Lanze · 4 und 6 Standardbatterie. Aktiv ist ein Platz, wenn die Ausbaustufe ihn öffnet
//                      (Maps.WAFFENPLAETZE) UND er bestückt ist. Debug `bestueck`, später die Werft (Paket D).
//   game.ship.mount    { mountId: Laufzeitzustand }  mountId: bow = 8, port = 4, stbd = 6, p5 p7 p9 p1 p3 p2 (Katalog MOUNT_ID). Je nach Waffe:
//                      Energiewaffen { charge 0..1, alloc }, Lanzen + { power, charging }, Salven (Batterien, Kanone, Abwehrturm) + { salvo, salvoT, salvoTarget },
//                      Torpedowerfer { cd, cdMax } (kein charge, keine Energie).
//   Ladepool           chargePoints = Waffen-Energie + 2 (unverändert), per weapons.alloc auf die Energiewaffen verteilt (je höchstens allocMax).
//                      Wer keinen Punkt hat, lädt nicht (Reserve). Standardverteilung: reihum in Katalog.PRIORITAET (Bug, Seiten, Bug 2, Heck).
//   Magazindeckel      Σ (Bereitschaft × Anfangsstoß) aller Energiewaffen ≤ MAGAZINDECKEL.stossMax: mehr Plätze heißen mehr Auswahl, nicht mehr Feuerstoß.
//
// space.js ruft update/weaponsFire/… von hier; der Gegner-Teil (Sperrfeuer, Tele, Bolzen, Streu, Torpedo) bleibt in space.js.
const Physics = require('../../shared/physics.js');
const Katalog = require('../../shared/schiffskatalog.js');
const W = require('../world.js');
const Station = require('./station.js');
const Alarm = require('./alarm.js');
const Escort = require('./escort.js');
const Gsys = require('./gegnersystem.js');   // SYS-01 C1a-1: Gesamtintegrität der Gegner (Waffenstatistik)
const { clamp, dist, turnToward } = require('../util.js');

let spaceMod = null;   // lazy wegen Zirkelbezug space -> schiffswaffen -> space
const S = () => spaceMod || (spaceMod = require('./space.js'));
const Maps = W.Maps;
const isDown = (st) => st === 'broken' || st === 'offline';
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const EPS = 1e-6;
const M3 = (game) => game.C.spaceM3;

// Mount-Id -> Systemname (weapon_bow, battery_port, battery_stbd, lafette_N): aus der Karte
const MOUNT_SYSTEM = {};
for (const p of Maps.WAFFENPLAETZE) MOUNT_SYSTEM[Katalog.mountId(p.platz)] = p.system;
const SYSTEM_MOUNT = {}; for (const k of Object.keys(MOUNT_SYSTEM)) SYSTEM_MOUNT[MOUNT_SYSTEM[k]] = k;
const ALLE = Katalog.PRIORITAET;
// Alte Namen eingehender Befehle: phase_l/phase_r/both aus M1, lanze -> bow
const MOUNT_ALIAS = { phase_l: 'port', phase_r: 'stbd', both: 'all', lanze: 'bow' };
// Längsversatz der Mündung je Platz (Anteil der Schiffslänge ~ px); 4 und 6 mittschiffs wie bisher
const VERSATZ = { 7: 10, 9: 10, 1: -10, 3: -10, 5: 30, 2: -30 };

// ---------- Bestückung ----------
function waffenMap(game) {
  const s = game.ship;
  if (!s.waffen) s.waffen = Object.assign({}, Katalog.START_BESTUECKUNG);
  return s.waffen;
}
function platzOffen(game, platz) { const pl = Maps.waffenplatz(platz); return !!pl && (game.ship.stufe | 0) >= pl.stufe; }
// Offene, bestückte Plätze in Katalog.PRIORITAET: [{ id, platz, w }]
function ausstattung(game) {
  const wm = waffenMap(game); const out = [];
  for (const id of ALLE) {
    const platz = Katalog.platzVonMount(id);
    const w = Katalog.waffe(wm[platz]);
    if (w && platzOffen(game, platz)) out.push({ id, platz, w });
  }
  return out;
}
function mountIds(game) { return ausstattung(game).map((a) => a.id); }
function waffeAn(game, id) {
  const platz = Katalog.platzVonMount(id);
  if (platz == null || !platzOffen(game, platz)) return null;
  return Katalog.waffe(waffenMap(game)[platz]);
}
function energieMounts(game) { return ausstattung(game).filter((a) => a.w.energie); }
// Mount-Id aus einem Befehlsnamen; Altname 'bolzen' (Bolzenwerfer) = der Platz mit dem Torpedowerfer (sonst Heck 2)
function normMount(mount, game) {
  const m = String(mount);
  if (m === 'bolzen' || m === 'torpedo') {
    const t = game ? ausstattung(game).find((a) => a.w.art === 'torpedo') : null;
    return t ? t.id : 'p2';
  }
  return MOUNT_ALIAS[m] || m;
}
function mountState(game, id) { const sys = MOUNT_SYSTEM[id]; const s = sys ? game.ship.systems[sys] : null; return s == null ? 'ok' : s; }
// Beschriftung wie bisher für die Startbestückung, sonst Waffenname mit Seite
function label(game, id) {
  const w = waffeAn(game, id); if (!w) return id;
  const platz = Katalog.platzVonMount(id);
  if (Katalog.START_BESTUECKUNG[platz] === w.id) return { bow: 'Lanze', port: 'Batterie Backbord', stbd: 'Batterie Steuerbord' }[id] || w.name;
  return `${w.name} ${Katalog.PLATZ[platz].seite} (${platz})`;
}

// Werte einer Waffe (Katalog; Standardbatterie und Lanze lesen die Config, damit `tune spaceM3.…` wirkt und die Altwerte maßgeblich bleiben)
function wcfg(game, w) {
  const M = M3(game); const P = M.mounts.port;
  const c = { schaden: w.schaden, rohre: w.rohre, gap: w.salvoGap || 0.15, ladekosten: w.ladekosten, nachlauf: w.nachlauf || 0, bogen: w.bogen, reichweite: w.reichweite,
    rohreKaputt: Math.max(1, Math.ceil(w.rohre / 2)), kaputtFaktor: P.damagedFactor || 1 };   // Batterie/Kanone: wie vor PAN-01 C kein Zeitfaktor (nur weniger Rohre), die Config kennt keinen damagedFactor für port/stbd
  if (w.id === 'standardbatterie') Object.assign(c, { schaden: P.damage, rohre: P.tubes, ladekosten: P.secPerPoint, bogen: P.arc, reichweite: P.range, rohreKaputt: P.tubesDamaged });   // SYS-01 B1: kein Salvenabstand mehr (ein Projektil)
  if (w.art === 'lanze') {
    const L = M.lance || {}; const B = M.mounts.bow; const K = w.lanze;
    Object.assign(c, { aufladen: L.chargeTime != null ? L.chargeTime : K.aufladen, min: L.minDamage != null ? L.minDamage : K.min, max: L.maxDamage != null ? L.maxDamage : K.max,
      breite: L.width != null ? L.width : K.breite, autoPower: L.autoPower != null ? L.autoPower : 0.5, kaputtZeit: L.damagedTimeFactor || 1, kaputtMax: L.damagedMaxFactor || 1,
      strahlen: K.strahlen, abstand: K.abstand, pierce: w.id === 'lanze' && B.pierce != null ? B.pierce : K.pierce });
    c.kaputtFaktor = B.damagedFactor || 1.5;   // jede Lanze: beschädigt lädt 1,5× so langsam (wie die Bug-Lanze)
    if (w.id === 'lanze') Object.assign(c, { bogen: B.arc, reichweite: B.range, ladekosten: B.secPerPoint });
  }
  return c;
}
function mountCfg(game, id) {
  const w = waffeAn(game, id); if (!w) return null;
  const platz = Katalog.platzVonMount(id); const c = wcfg(game, w);
  return { facing: Katalog.PLATZ[platz].facing, arc: c.bogen, range: c.reichweite, w, c };
}

// Laufzeitzustand anlegen (Start, Bestückung, Stufenwechsel). Neue Energiewaffen starten mit der Ladung, die der Magazindeckel noch zulässt.
function neuerMount(game, id, w, charge) {
  const o = {};
  if (w.art === 'torpedo') { o.cd = 0; o.cdMax = Katalog.TORPEDO.cooldown; return o; }
  o.charge = charge; o.alloc = 0;
  if (w.art === 'lanze') { o.power = 0; o.charging = false; }
  else { o.salvo = 0; o.salvoT = 0; o.salvoTarget = null; }
  return o;
}
function vorrat(game) {   // gespeicherter Anfangsstoß aller Energiewaffen
  let sum = 0;
  for (const a of energieMounts(game)) { const m = game.ship.mount[a.id]; if (m && m.charge != null) sum += m.charge * Katalog.volley(a.w.id); }
  return sum;
}
// Magazin: jede Energiewaffe mit Ladung (auch angefangener) belegt ihren vollen Anfangsstoß; zusammen höchstens MAGAZINDECKEL.stossMax. Eine Waffe ohne Ladung fängt erst an zu laden,
// wenn ihr Stoß noch hineinpasst (sonst blockierten sich viele halb geladene Waffen gegenseitig und keine würde je fertig).
// Ausgefallene Waffen belegen nichts. Waffen MIT Ladepunkten haben Vorrang: braucht eine solche Platz, geben volle Waffen OHNE Ladepunkte (Reserve) ihre Ladung ab (update).
function reserviert(game) {
  let sum = 0;
  for (const a of energieMounts(game)) { const m = game.ship.mount[a.id]; if (m && (m.charge > 0 || m.charging) && !isDown(mountState(game, a.id))) sum += Katalog.volley(a.w.id); }
  return sum;
}
function ensureMounts(game) {
  const ship = game.ship; const m = ship.mount || (ship.mount = {});
  let neu = false;
  for (const a of ausstattung(game)) {
    const cur = m[a.id];
    const passt = cur && ((a.w.art === 'torpedo') === (cur.cd !== undefined)) && ((a.w.art === 'lanze') === (cur.power !== undefined));
    if (passt) continue;
    const passt1 = Katalog.volley(a.w.id) <= 0 || reserviert(game) + Katalog.volley(a.w.id) <= Katalog.MAGAZINDECKEL.stossMax + 1e-9;   // neue Waffe startet geladen, wenn ihr Stoß noch ins Magazin passt
    m[a.id] = neuerMount(game, a.id, a.w, passt1 ? 1 : 0);
    neu = true;
  }
  if (neu) { const al = computeAlloc(game); for (const a of energieMounts(game)) m[a.id].alloc = al[a.id] || 0; }   // Snapshot vor dem ersten Tick zeigt schon die Verteilung
}
function bestuecken(game, platz, id, behalteZustand) {
  platz = Number(platz);
  if (!Katalog.PLATZ[platz]) return 'Unbekannter Platz (1–9).';
  const leer = id == null || id === 'leer' || id === '-';
  const w = leer ? null : Katalog.waffe(String(id));
  if (!leer && !w) return `Unbekannte Waffe „${id}“. Katalog: ${Katalog.WAFFEN.map((x) => x.id).join(', ')}.`;
  if (!platzOffen(game, platz)) { const pl = Maps.waffenplatz(platz); return `Platz ${platz} ist gesperrt (Ausbaustufe ${pl.stufe} nötig).`; }
  if (w && !Katalog.passtAuf(w.id, platz)) return `${w.name} ist eine ${w.platzart}-Waffe, Platz ${platz} ist ein ${Katalog.PLATZ[platz].art}-Platz.`;
  setzeRoh(game, platz, leer ? null : w.id, behalteZustand);
  return null;
}
// Umbau in der Werft (PAN-01 D): wie bestuecken, aber der Systemzustand des Platzes bleibt (kaputt bleibt kaputt, Flickstelle und EMP-Pause bleiben): die Werft ist keine Abkürzung
// an der Reparaturmechanik. bestuecken (Debug, Start, Weltstand) setzt das System wie bisher auf ok.
function umruesten(game, platz, id) { return bestuecken(game, platz, id, true); }
// ohne Prüfung (Weltstand, Stufenwechsel)
function setzeRoh(game, platz, id, behalteZustand) {
  const wm = waffenMap(game); const mid = Katalog.mountId(platz);
  if (id) wm[platz] = id; else delete wm[platz];
  delete game.ship.mount[mid];
  const sys = MOUNT_SYSTEM[mid];   // neue Hardware: Schaden, Flickstelle und EMP-Pause des Platzes gelten nicht mehr
  if (sys && !behalteZustand) require('./interior.js').setzeZustand(game, sys, 'ok');
  ensureMounts(game);
  verteilungZuruecksetzen(game);
}
// alle offenen Plätze mit Standardbestückung füllen: Seiten Standardbatterie, Bug Lanze (8) bzw. Standardkanone (5), Heck Torpedowerfer
function bestueckeAlle(game, stufe) {
  const Ausbau = require('./ausbau.js');
  if (stufe != null) Ausbau.setStufe(game, stufe);
  const wm = waffenMap(game);
  for (const p of Maps.WAFFENPLAETZE) {
    if (!platzOffen(game, p.platz)) continue;
    const id = p.art === 'seite' ? 'standardbatterie' : p.art === 'bug' ? (p.platz === 8 ? 'lanze' : 'standardkanone') : 'torpedowerfer';
    if (wm[p.platz] !== id) { wm[p.platz] = id; delete game.ship.mount[Katalog.mountId(p.platz)]; }
  }
  ensureMounts(game);
  verteilungZuruecksetzen(game);
}
// Szenenwechsel: laufende Salven und Aufladungen enden
function szeneReset(game) {
  for (const k of Object.keys(game.ship.mount)) {
    const m = game.ship.mount[k]; if (!m) continue;
    if (m.power !== undefined) { m.power = 0; m.charging = false; }
    if (m.salvo !== undefined) { m.salvo = 0; m.salvoTarget = null; }
  }
}
function stufeGeaendert(game) { ensureMounts(game); require('./interior.js').inaktiveHeilen(game); verteilungZuruecksetzen(game); }

// ---------- Ladepool ----------
function chargePoints(game) { const pw = game.ship.power.weapons; return pw > 0 ? pw + 2 : 0; }
function weaponsManned(game) { return Station.stationBesetzt(game, 'weapons'); }
function waffenAutomatikAktiv(game) { return Station.waffenAutomatikAktiv(game); }
// Reihum in der Reihenfolge der Mounts, je höchstens allocMax
function reihum(ids, cp, max) {
  const out = {}; for (const id of ids) out[id] = 0;
  let left = cp, guard = 0;
  while (left > 0 && guard++ < 100) {
    let placed = false;
    for (const id of ids) { if (left > 0 && out[id] < max) { out[id]++; left--; placed = true; } }
    if (!placed) break;
  }
  return out;
}
// Ein Punkt ist dem Abwehrturm reserviert, solange er bestückt ist und der Pool mindestens einen hat (sonst lädt er nie und die „schwache Automatik“ fiele aus); er kostet die
// Waffen hinten in der Reihenfolge einen Punkt. Start-Lerche ohne Abwehrturm: unverändert.
function mitTurm(game, ids, cp, max) {
  const t = ids.find((id) => waffeAn(game, id).art === 'turm');
  if (!t || cp < 1) return reihum(ids, cp, max);
  const out = reihum(ids.filter((id) => id !== t), cp - 1, max); out[t] = 1;
  return out;
}
function standardVerteilung(game, cp) { return mitTurm(game, energieMounts(game).map((a) => a.id), cp == null ? chargePoints(game) : cp, M3(game).allocMax); }
function verteilungZuruecksetzen(game) {
  game.ship.wAllocIntent = standardVerteilung(game);
  const al = computeAlloc(game);   // auch die angezeigten Punkte sofort (Snapshot vor dem nächsten Tick)
  for (const a of energieMounts(game)) { const m = game.ship.mount[a.id]; if (m) m.alloc = al[a.id] || 0; }
}
// Effektive Verteilung: besetzt = Wunsch der Ops, gekürzt bei der Halterung mit den meisten Punkten (Gleichstand: zuerst die Batterien, die Lanzen zuletzt);
// unbesetzt mit Automatik (≤ 2 Spieler) = reihum; unbesetzt ohne Automatik (3–4 Spieler) = die zuletzt gesetzte Verteilung bleibt stehen.
function computeAlloc(game) {
  const Sx = M3(game); const ship = game.ship;
  const list = energieMounts(game); const ids = list.map((a) => a.id);
  const cp = chargePoints(game);
  if (waffenAutomatikAktiv(game)) return mitTurm(game, ids, cp, Sx.allocMax);
  const want = ship.wAllocIntent || Sx.allocDefault;
  const out = {};
  for (const id of ids) out[id] = clamp(Math.round(Number(want[id]) || 0), 0, Sx.allocMax);
  const cutOrder = ids.filter((id) => !(waffeAn(game, id).art === 'lanze')).reverse().concat(ids.filter((id) => waffeAn(game, id).art === 'lanze').reverse());
  // Altreihenfolge der Startbestückung: port, stbd, bow – Batterien zuerst, Lanze zuletzt; bei mehr Plätzen die hinteren zuerst
  const order = cutOrder.length === 3 && ids.join() === 'bow,port,stbd' ? ['port', 'stbd', 'bow'] : cutOrder;
  const sum = () => ids.reduce((a, id) => a + out[id], 0);
  while (sum() > cp) {
    let top = null;
    for (const id of order) if (top === null || out[id] > out[top]) top = id;
    if (top === null || out[top] <= 0) break;
    out[top]--;
  }
  // unbesetzt: der Abwehrturm behält einen Punkt (Nahabwehr), auch wenn die Ops ihn früher auf 0 gestellt hat; besetzt ist er frei verteilbar
  const tid = ids.find((id) => waffeAn(game, id).art === 'turm');
  if (tid && !weaponsManned(game) && cp > 0 && out[tid] === 0) {
    let top = null; for (const id of ids) if (id !== tid && out[id] > 0 && (top === null || out[id] > out[top])) top = id;
    if (top) out[top]--;
    out[tid] = 1;
  }
  return out;
}
// Ladezeit einer Halterung für 0 -> 1 (null = lädt nicht)
function chargeTime(game, id) {
  const w = waffeAn(game, id); const m = game.ship.mount[id];
  if (!w || !m || !w.energie) return null;
  const st = mountState(game, id);
  if (isDown(st) || !(m.alloc > 0)) return null;
  const c = wcfg(game, w);
  let t = c.ladekosten / m.alloc + c.nachlauf;   // SYS-01 B1 Nacharbeit: Nachlauf = fester Anteil je Schuss (wie die Salvendauer vor B1), unabhängig von den Ladepunkten
  if (st === 'damaged') t *= c.kaputtFaktor;
  // §5.5 unbesetzte Ops: autoFactor wirkt auf die Ladezeit (halbe Feuerrate, voller Schaden je Treffer). Der Abwehrturm hat seinen eigenen Faktor (ohne Taktik).
  if (w.art === 'turm') { if (!weaponsManned(game)) t *= (w.turm.autoFaktor || 1); }
  else if (waffenAutomatikAktiv(game)) t /= (M3(game).autoFactor || 1);
  return t;
}

// Treffer der Lerche auf einen Gegner (Schild + Hülle) mit Zähler game.stats.waffenSchaden { gesamt, <waffe-id>: Summe } für die Bot-Messung (Feuerkraft je Waffenzahl)
function schade(game, e, dmg, x, y, opts, typ) {
  const sp = S();
  // SYS-01 C1a-1: Gegner mit Modell: Σ der Systemintegrität (e.hp wird beim Tod auf 0 gesetzt, das zählte sonst die Restintegrität als Schaden); ohne Modell die Hülle
  const sum = () => (Gsys.hat(e) ? Gsys.summe(e) : (e.hp > 0 ? e.hp : 0)) + (e.shields ? e.shields.reduce((a, v) => a + v, 0) : 0);
  const vor = sum();
  sp.damageEnemy(game, e, dmg, x, y, opts ? Object.assign({ angriff: true }, opts) : { angriff: true });   // SUND-04a-1 A: Waffen der Lerche sind Angriffe (gezielter Systemtreffer)
  const d = Math.max(0, vor - sum());
  const st = game.stats.waffenSchaden || (game.stats.waffenSchaden = { gesamt: 0 });
  st.gesamt += d; st[typ] = (st[typ] || 0) + d;
  return d;
}

// ---------- Geometrie ----------
function inMountArc(game, id, x, y) {
  const s = game.ship; const c = mountCfg(game, id);
  if (!c) return false;
  return Physics.inArc(s.x, s.y, s.angle, c.facing, c.arc, S().waffenReichweite(game, c.range), x, y);   // W2: Nebel
}
function mountOrigin(game, id) {
  const s = game.ship; const a = s.angle; const platz = Katalog.platzVonMount(id);
  const art = Katalog.platzArt(platz); const v = VERSATZ[platz] || 0;
  const fx = Math.cos(a) * v, fy = Math.sin(a) * v;
  if (art === 'seite') {
    const side = platz === 4 || platz === 7 || platz === 1 ? -Math.PI / 2 : Math.PI / 2;
    return { x: s.x + Math.cos(a + side) * 16 + fx, y: s.y + Math.sin(a + side) * 16 + fy };
  }
  if (platz === 8) return { x: s.x + Math.cos(a) * 34, y: s.y + Math.sin(a) * 34 };
  return { x: s.x + fx, y: s.y + fy };
}
function selectedEnemy(game) { const id = game.ship.target; return id == null ? null : game.space.enemies.find((e) => e.id === id) || null; }
function nearestInArc(game, id) {
  const ship = game.ship; let best = null, bd = Infinity;
  for (const e of game.space.enemies) {
    if (!inMountArc(game, id, e.x, e.y)) continue;
    if (e.pat) continue;   // EK2: eine ruhige Patrouille ist kein Ziel der Automatik
    const d = dist(ship.x, ship.y, e.x, e.y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

// ---------- Hauptschleife ----------
function update(game, dt) {
  const ship = game.ship; const m = ship.mount;
  ensureMounts(game);
  const alloc = computeAlloc(game);
  const list = ausstattung(game);
  for (const a of list) if (a.w.energie) m[a.id].alloc = alloc[a.id] || 0;
  // Laden (Bereitschaft); der Magazindeckel begrenzt, wie viel Anfangsstoß sich in allen Energiewaffen zusammen speichert
  let belegt = reserviert(game);
  for (const a of list) {
    const mm = m[a.id];
    if (a.w.art === 'torpedo') { mm.cd = Math.max(0, mm.cd - dt); continue; }   // Cooldown: weder Energie noch Triebwerk, keine Ladepunkte
    if (a.w.art === 'lanze' && mm.charging) continue;
    if (a.w.art !== 'lanze' && mm.salvo > 0) continue;
    const t = chargeTime(game, a.id);
    if (t == null || mm.charge >= 1) continue;
    if (mm.charge <= 0 && Katalog.volley(a.w.id) > 0) {   // erst laden, wenn der Stoß ins Magazin passt
      const cap = Katalog.MAGAZINDECKEL.stossMax + 1e-9;
      if (belegt + Katalog.volley(a.w.id) > cap) {   // Platz schaffen: Waffen ohne Ladepunkte (Reserve) geben ihre Ladung ab, die hinterste zuerst
        for (const b of list.slice().reverse()) {
          if (belegt + Katalog.volley(a.w.id) <= cap) break;
          const bm = m[b.id];
          if (b.id === a.id || !b.w.energie || Katalog.volley(b.w.id) <= 0 || !bm || bm.charge <= 0 || bm.charging || bm.alloc > 0 || isDown(mountState(game, b.id))) continue;
          bm.charge = 0; belegt -= Katalog.volley(b.w.id);
        }
      }
      if (belegt + Katalog.volley(a.w.id) > cap) { mm.blk = true; continue; }   // Magazin voll: Anzeige „Magazin voll“
      belegt += Katalog.volley(a.w.id);
    }
    mm.blk = false;
    mm.charge = Math.min(1, mm.charge + dt / t);
  }
  if (ship.target && !S().resolveTarget(game, ship.target)) require('./zielsysteme.js').zielLoeschen(game);
  const manned = weaponsManned(game);
  S().meldeWaffenAutomatik(game, manned);
  for (const a of list) if (a.w.art === 'lanze') updateLanceCharge(game, a.id, dt, manned);
  updateSalvos(game, dt);
  // §20.4: Automatikfeuer nur bei unbesetzter Ops und höchstens 2 Spielern (R1 §4.5; halbe Ladegeschwindigkeit über chargeTime/autoFactor).
  // Besetzt feuert nichts von selbst – die Ops drückt weapons.fire bzw. lädt die Lanze mit weapons.charge.
  if (!ship.docked && waffenAutomatikAktiv(game)) {
    // erst die Salven, dann die Lanzen (Reihenfolge wie vor PAN-01 C: Batterien, dann Lanze)
    for (const a of list) {
      if (a.w.art !== 'salve') continue;
      const mm = m[a.id];
      if (mm.charge < 1 || mm.salvo > 0 || isDown(mountState(game, a.id))) continue;
      const tgt = nearestInArc(game, a.id);
      if (tgt) startSalvo(game, a.id, tgt, 1);
    }
    for (const a of list) {
      if (a.w.art !== 'lanze') continue;
      const mm = m[a.id];
      // EK2: die Automatik schießt nicht auf ruhige Patrouillen und nicht auf Minen (sonst verriete sie die Lerche)
      const autoHit = mm.charge >= 1 && !mm.charging && !isDown(mountState(game, a.id)) ? lanceTrace(game, a.id).hit : null;
      if (autoHit && !autoHit.pat) fireLance(game, a.id, wcfg(game, a.w).autoPower, true);
    }
  }
  // Abwehrturm: dreht sich selbst; ohne Taktik schießt er schwach automatisch (auch bei mehr als zwei Spielern – es ist Nahabwehr, kein Angriff)
  if (!ship.docked && !manned) {
    for (const a of list) {
      if (a.w.art !== 'turm') continue;
      const mm = m[a.id];
      if (mm.charge < 1 || mm.salvo > 0 || isDown(mountState(game, a.id))) continue;
      const z = turmZiel(game, a.id);
      if (z) startSalvo(game, a.id, z, 1);
    }
  }
  for (const bm of game.space.beams) bm.ttl -= dt;
  game.space.beams = game.space.beams.filter((bm) => bm.ttl > 0);
}

// ---------- Lanze (Bug-Lanze und Lanzenbatterie) ----------
function lanceChargeTime(game, id) {
  const w = waffeAn(game, id); const c = wcfg(game, w);
  return c.aufladen * (mountState(game, id) === 'damaged' ? c.kaputtZeit : 1);
}
function lanceDamage(game, power, id) {
  const w = waffeAn(game, id || 'bow'); if (!w || w.art !== 'lanze') return 0;
  const c = wcfg(game, w);
  const max = c.max * (mountState(game, id || 'bow') === 'damaged' ? c.kaputtMax : 1);
  const p = clamp(power || 0, 0, 1);
  return c.min + Math.max(0, max - c.min) * p;
}
// Strahl in Mount-Richtung: erster Gegner, dessen Abstand zur Strahllinie < hitRadius[kind] + width ist (innerhalb range).
function lanceTrace(game, id) {
  id = id || 'bow';
  const ship = game.ship; const C = game.C; const sp = S();
  const mc = mountCfg(game, id) || { facing: 0, range: 650, w: { art: 'lanze' }, c: { breite: 10 } };
  const o = mountOrigin(game, id);
  const ang = ship.angle + (mc.facing || 0) * Math.PI / 180;
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const range = sp.waffenReichweite(game, mc.range);   // W2: Nebel
  const width = (mc.c && mc.c.breite) || 0;
  // W2: ein Brocken im Strahl hält ihn auf (Gegner dahinter werden nicht getroffen)
  const rock = sp.brockenImWeg(game, o.x, o.y, o.x + dx * range, o.y + dy * range);
  const stop = rock ? rock.t * range : Infinity;
  let hit = null, ht = Infinity;
  for (const e of game.space.enemies) {
    const rx = e.x - o.x, ry = e.y - o.y;
    const t = rx * dx + ry * dy;              // Abstand entlang des Strahls
    const rad = (C.combat.hitRadius[e.kind] || 18) + width;
    if (t < -rad || t > range + rad) continue;
    const perp = Math.abs(-rx * dy + ry * dx); // Abstand zur Strahllinie
    if (perp >= rad) continue;
    if (t > stop) continue;
    if (t < ht) { ht = t; hit = e; }
  }
  // EK2: Minen im Strahl (nah vor dem ersten Gegner und vor einem Brocken) werden getroffen
  const mn = Alarm.mineImStrahl(game, o.x, o.y, dx, dy, Math.min(range, stop));
  if (mn && (!hit || mn.t < ht)) return { o, dx, dy, range, hit: null, mine: mn.m, t: mn.t, rock: null };
  return { o, dx, dy, range, hit, t: hit ? Math.max(0, ht) : Math.min(range, stop), rock: !hit && rock ? rock : null };
}
function lanceFizzle(game, id, why) {
  const b = game.ship.mount[id];
  if (!b || !b.charging) return;
  b.charging = false; b.power = 0;
  game.emit('lance', { state: 'fizzle', power: 0, hit: null, why: why || null, mount: id });
  game.missionEvent('lanceFizzle', { why: why || null });
}
function updateLanceCharge(game, id, dt, manned) {
  const ship = game.ship; const b = ship.mount[id];
  if (!b.charging) { b.power = 0; return; }
  // Konsole verlassen, System aus oder angedockt: Aufladen verpufft ohne Schuss
  if (!manned) return lanceFizzle(game, id, 'console');
  if (isDown(mountState(game, id))) return lanceFizzle(game, id, 'system');
  if (ship.docked) return lanceFizzle(game, id, 'docked');
  b.power = Math.min(1, (b.power || 0) + dt / lanceChargeTime(game, id));
}
// weapons.charge { mount, on }
function weaponsCharge(game, mount, on) {
  ensureMounts(game);
  const ship = game.ship;
  const id = normMount(mount == null ? 'bow' : mount, game);
  const w = waffeAn(game, id);
  if (!w || w.art !== 'lanze') return 'Aufladen gibt es nur für die Lanze.';
  const b = ship.mount[id];
  if (!on) {
    if (!b.charging) return null;   // Loslassen ohne Aufladen: nichts
    fireLance(game, id, b.power, false);
    return null;
  }
  if (b.charging) return null;
  if (ship.docked) return 'Angedockt wird nicht geschossen.';
  if (isDown(mountState(game, id))) return `${label(game, id)} ausgefallen – reparieren.`;
  if (b.charge < 1) return `${label(game, id)} lädt noch.`;
  b.charging = true; b.power = 0;
  const dur = lanceChargeTime(game, id);
  game.emit('lance', { state: 'charge', power: 0, hit: null, dur: r2(dur), mount: id });
  game.emit('sfx', { name: 'lance_charge', key: 'lance' + (id === 'bow' ? '' : id), dur: r2(dur) });
  game.missionEvent('lanceCharge', {});
  return null;
}
// Schuss in Mount-Richtung mit power (0..1). Treffer = erster Gegner nahe der Strahllinie; sonst ins Leere. Die Lanzenbatterie zeichnet zwei Strahlen, der Schaden fällt einmal.
function fireLance(game, id, power, auto) {
  const ship = game.ship; const b = ship.mount[id]; const w = waffeAn(game, id); const c = wcfg(game, w);
  const p = clamp(power || 0, 0, 1);
  const tr = lanceTrace(game, id);
  b.charging = false; b.power = 0; b.charge = 0;
  const x2 = tr.o.x + tr.dx * tr.t, y2 = tr.o.y + tr.dy * tr.t;
  const ttl = game.C.combat.beamTtl * 2;
  const n = c.strahlen || 1;
  for (let i = 0; i < n; i++) {
    const off = n > 1 ? (i - (n - 1) / 2) * 2 * (c.abstand || 0) : 0;
    const ox = -tr.dy * off, oy = tr.dx * off;
    const beam = { x1: tr.o.x + ox, y1: tr.o.y + oy, x2: x2 + ox, y2: y2 + oy, ttl, ttlMax: ttl, kind: 'lance', mount: id, power: r2(p) };
    if (!tr.hit && !tr.mine) beam.miss = true;
    game.space.beams.push(beam);
  }
  Alarm.laerm(game, 'waffen');   // EK2: Waffenfeuer ist laut
  if (tr.rock) S().brockenStats(game).strahlen++;   // W2: Brocken hat den Strahl geschluckt
  // S2 §5: kein Eigenbeschuss – die Lanze geht durch Schützlinge hindurch, nur ein Funk-Rüffel
  if (game.space.escorts && game.space.escorts.length) { try { Escort.lanceCrossed(game, tr); } catch (err) { if (game.countError) game.countError('escort-lance', err); } }
  game.stats.lanceShots = (game.stats.lanceShots || 0) + 1;
  // Achtung: emit() mischt data in { t, kind } – kein Feld 'kind' mitgeben
  game.emit('lance', { state: 'fire', power: r2(p), hit: tr.hit ? tr.hit.id : null, auto: !!auto, mount: id });
  game.emit('sfx', { name: 'lance_fire', power: r2(p), mount: id });
  if (tr.hit) {
    game.stats.lanceHits = (game.stats.lanceHits || 0) + 1;
    // SYS-01 B1 (Entwicklungsleiter-Entscheidung, Kai prüft): Vollladung durchschlägt den Schild ganz (Durchschlag 'zone' = bis in die Mitte, hier die Hülle); sonst schwächt der Treffer den Schild um pierce
    schade(game, tr.hit, lanceDamage(game, p, id), tr.o.x, tr.o.y, { pierce: c.pierce, durchschlag: p >= 1 - EPS ? 'zone' : undefined }, w.id);
  }
  if (tr.mine) Alarm.abschuss(game, tr.mine);   // EK2: Mine abgeschossen
  game.missionEvent('lanceFire', { power: p, hit: tr.hit ? tr.hit.id : null, auto: !!auto });
}

// ---------- Salven (Standardbatterie, Standardkanone, Sturm-, Streubatterie, Abwehrturm) ----------
function rohre(game, id) {
  const w = waffeAn(game, id); if (!w) return 0;
  const c = wcfg(game, w);
  return mountState(game, id) === 'damaged' ? c.rohreKaputt : c.rohre;
}
function startSalvo(game, id, target, factor) {
  const b = game.ship.mount[id];
  Alarm.laerm(game, 'waffen');   // EK2
  b.charge = 0;
  b.salvo = rohre(game, id);
  b.salvoMax = b.salvo;
  b.salvoT = 0;
  b.salvoTarget = target ? target.id : null;
  b.salvoFactor = factor;
  const w = waffeAn(game, id);
  game.emit('sfx', { name: w.ton, count: b.salvo, mount: id });
}
// Endpunkt eines Schusses ins Leere: senkrecht zur Flanke, leicht gefächert je Rohr, damit die Kette lesbar ist
function voidShotEnd(game, id, o, idx) {
  const ship = game.ship; const mc = mountCfg(game, id);
  const spread = ((idx % 4) - 1.5) * 0.06;   // ±5° gefächert
  const a = ship.angle + mc.facing * Math.PI / 180 + spread;
  const len = mc.range * 0.8;
  return { x: o.x + Math.cos(a) * len, y: o.y + Math.sin(a) * len };
}
function batteryBeamTtl(game) {
  const v = M3(game).batteryBeamTtl;
  return v > 0 ? v : game.C.combat.beamTtl * 0.6;
}
// Abwehrturm: nächstes Ziel im Umkreis – Jäger (Klassen des Katalogs) oder ein anfliegender Gegner-Torpedo
function turmZiel(game, id) {
  const w = waffeAn(game, id); const ship = game.ship; const o = mountOrigin(game, id);
  const reach = S().waffenReichweite(game, wcfg(game, w).reichweite);
  let best = null, bd = Infinity;
  if (w.turm.torpedos) for (const q of game.space.projectiles) {
    if (q.kind !== 'etorpedo') continue;
    const d = dist(o.x, o.y, q.x, q.y);
    if (d <= reach && d < bd - 40) { bd = d; best = q; }   // ein anfliegender Torpedo geht vor
  }
  if (best) return best;
  for (const e of game.space.enemies) {
    if (e.pat || !w.turm.ziele.includes(e.kind)) continue;
    const d = dist(ship.x, ship.y, e.x, e.y);
    if (d <= reach && d < bd) { bd = d; best = e; }
  }
  return best;
}
function zielAn(game, id) {
  return game.space.enemies.find((q) => q.id === id) || game.space.projectiles.find((q) => q.id === id) || null;
}
// ---------- Projektile der Salvenwaffen (Standardbatterie, Standardkanone, Sturmbatterie, Abwehrturm) ----------
// Ein Projektilmodell für Spieler und Gegner wie das Sperrfeuer der Gegner: ungelenkt, geradeaus, langsam genug zum Ausweichen, Treffer per Abstand zum Ziel (updateProjectiles),
// Schaden je Treffer = Katalogwert (Schild und Hülle wie bisher). Vorhalt: gezielt wird auf den Abfangpunkt des Ziels bei gehaltenem Kurs und Tempo (höchstens 3 s voraus); wer Kurs oder
// Tempo wechselt, entkommt. Rohrfolge: je Rohr ein Projektil im Takt der Salve, quer versetzt und leicht gefächert (deterministisch, kein Zufall).
function zielVel(e) {
  if (e.vx != null || e.vy != null) return { x: e.vx || 0, y: e.vy || 0 };
  if (e.speed != null && e.angle != null) return { x: Math.cos(e.angle) * e.speed, y: Math.sin(e.angle) * e.speed };   // Gegner-Torpedo
  return { x: 0, y: 0 };
}
function vorhaltWinkel(o, e, v, speed, maxT) {
  const rx = e.x - o.x, ry = e.y - o.y, vx = v.x, vy = v.y;
  const a = vx * vx + vy * vy - speed * speed, b = 2 * (rx * vx + ry * vy), c = rx * rx + ry * ry;
  let t = 0;
  if (Math.abs(a) < 1e-6) t = b < 0 ? -c / b : 0;
  else { const disc = b * b - 4 * a * c; if (disc >= 0) { const q = Math.sqrt(disc); const ts = [(-b - q) / (2 * a), (-b + q) / (2 * a)].filter((x) => x > 0); t = ts.length ? Math.min(...ts) : 0; } }
  t = Math.max(0, Math.min(maxT, t));
  return Math.atan2(ry + vy * t, rx + vx * t);
}
function schussAb(game, id, w, c, e, o, idx, b) {
  const ship = game.ship; const mc = mountCfg(game, id);
  const n = Math.max(1, b.salvoMax || c.rohre);
  let ang = e ? vorhaltWinkel(o, e, zielVel(e), w.geschw, 3) : ship.angle + mc.facing * Math.PI / 180;
  // SYS-01 B1: ein Projektil je Zyklus fliegt ohne Fächerung (sonst ein fester Versatz von 1,5 Streuungen je Schuss)
  if (n > 1) ang += ((idx % 4) - 1.5) * w.streuung;
  const q = (idx - (n - 1) / 2) * 2.2;   // Rohre nebeneinander (px quer zur Flugrichtung)
  const reach = S().waffenReichweite(game, c.reichweite);
  game.space.projectiles.push({ id: game.nextId('pr'), kind: w.projektil.kind, x: o.x - Math.sin(ang) * q, y: o.y + Math.cos(ang) * q, angle: ang, speed: w.geschw,
    ttl: reach / w.geschw + 0.1, dmg: c.schaden * (b.salvoFactor || 1), owner: 'lerche', waffe: w.id, mount: id });
  game.stats.schuesse = (game.stats.schuesse || 0) + 1;
}

function updateSalvos(game, dt) {
  const sp = S();
  for (const a of ausstattung(game)) {
    if (a.w.art !== 'salve' && a.w.art !== 'turm') continue;
    const k = a.id; const w = a.w; const b = game.ship.mount[k];
    if (!(b.salvo > 0)) continue;
    const c = wcfg(game, w);
    b.salvoT -= dt;
    while (b.salvo > 0 && b.salvoT <= 0) {
      b.salvoT += c.gap;
      const idx = (b.salvoMax || b.salvo) - b.salvo;
      b.salvo--;
      let e = b.salvoTarget != null ? zielAn(game, b.salvoTarget) : null;
      const turm = w.art === 'turm';
      // EK2: Ziel kann eine angewählte Mine sein (Projektile treffen Minen wie Gegner, Explosion auf Distanz)
      const mn = !e && b.salvoTarget != null && !turm ? Alarm.mineById(game, b.salvoTarget) : null;
      if (mn && inMountArc(game, k, mn.x, mn.y)) e = mn;
      const o = mountOrigin(game, k);
      if (turm) {   // dreht sich selbst: Ziel neu wählen, wenn es weg ist
        if (!e || (e.kind !== 'etorpedo' && dist(game.ship.x, game.ship.y, e.x, e.y) > sp.waffenReichweite(game, c.reichweite))) { e = turmZiel(game, k); b.salvoTarget = e ? e.id : null; }
      } else if (!e || !inMountArc(game, k, e.x, e.y)) { e = nearestInArc(game, k); b.salvoTarget = e ? e.id : null; }
      if (!e) {   // §20.4: Schuss ins Leere – das Projektil fliegt trotzdem (Rohrfolge lesbar)
        if (turm) { b.salvo = 0; continue; }
        if (w.id === 'streubatterie') { streuWurf(game, k, w, c, null, o, idx); continue; }
        schussAb(game, k, w, c, null, o, idx, b);
        continue;
      }
      if (w.id === 'streubatterie') { streuWurf(game, k, w, c, e, o, idx); continue; }
      schussAb(game, k, w, c, e, o, idx, b);
    }
    if (b.salvo <= 0) { b.salvo = 0; b.salvoTarget = null; }
  }
}

// ---------- Streubatterie: verzögert explodierende Granaten ----------
// Jede Granate fliegt zum vorhergesagten Ort des Ziels (Lage + Geschwindigkeit × Zündzeit), gefächert um ±spread px quer, und explodiert nach `zuend` s.
function streuWurf(game, id, w, c, e, o, idx) {
  const T = w.streu; const ship = game.ship;
  let tx, ty;
  if (e) { tx = e.x + (e.vx || 0) * T.zuend; ty = e.y + (e.vy || 0) * T.zuend; }
  else { const mc = mountCfg(game, id); const a = ship.angle + mc.facing * Math.PI / 180; tx = o.x + Math.cos(a) * mc.range * 0.6; ty = o.y + Math.sin(a) * mc.range * 0.6; }
  const ang0 = Math.atan2(ty - o.y, tx - o.x);
  const n = c.rohre;
  const off = (idx - (n - 1) / 2) * (T.radius * 1.3);   // quer zur Flugrichtung
  tx += -Math.sin(ang0) * off; ty += Math.cos(ang0) * off;
  const d = Math.max(30, Math.hypot(tx - o.x, ty - o.y));
  const reach = S().waffenReichweite(game, c.reichweite);
  const f = d > reach ? reach / d : 1;
  const ex = o.x + (tx - o.x) * f, ey = o.y + (ty - o.y) * f;
  const dd = Math.hypot(ex - o.x, ey - o.y);
  game.space.projectiles.push({ id: game.nextId('pr'), kind: 'streu', x: o.x, y: o.y, angle: Math.atan2(ey - o.y, ex - o.x), speed: dd / T.zuend, ttl: T.zuend, ttlMax: T.zuend,
    dmg: c.schaden, mount: id, ex, ey, owner: 'lerche' });
}
// Explosion einer Granate der Lerche: Gegner im Radius; eine Granate = Schildschaden, zwei (andere Granaten) im Fenster = sicherer Hüllen-/Systemschaden
function streuExplosion(game, p) {
  const w = Katalog.waffe('streubatterie'); const T = w.streu; const sp = S();
  game.emit('explosion', { x: Math.round(p.x), y: Math.round(p.y), zone: 'space', small: true });
  game.emit('sfx', { name: 'streu_boom', x: Math.round(p.x), y: Math.round(p.y) });
  for (const e of game.space.enemies.slice()) {
    const rad = T.radius + (game.C.combat.hitRadius[e.kind] || 18) * 0.5;
    if (dist(p.x, p.y, e.x, e.y) > rad) continue;
    const L = e.streuT || (e.streuT = []);
    while (L.length && game.time - L[0] > T.fenster) L.shift();
    const zwei = L.length >= 1;
    L.push(game.time);
    schade(game, e, p.dmg, p.x, p.y, { streu: { schildFaktor: T.schildFaktor } }, w.id);
    if (zwei && sp.hasEnemy(game, e)) {
      schade(game, e, T.durchschlag, p.x, p.y, { huelle: true }, w.id);
      if (sp.hasEnemy(game, e)) sp.stoereGegner(e, 1.5);
      game.stats.streuZwei = (game.stats.streuZwei || 0) + 1;
    }
  }
}

// ---------- Torpedowerfer ----------
function fireTorpedo(game, id) {
  const ship = game.ship; const m = ship.mount[id]; const T = Katalog.TORPEDO;
  const target = selectedEnemy(game);
  if (!target) return ship.target ? 'Das Ziel ist kein Gegner – nur scannen (S).' : 'Kein Ziel gewählt (T).';
  if (!inMountArc(game, id, target.x, target.y)) return 'Ziel außerhalb des Feuerbogens.';
  if (game.inventory.bolzen <= 0) return 'Keine Torpedos mehr im Lager (Hafen).';
  if (m.cd > 0) return `Torpedowerfer lädt nach (${Math.ceil(m.cd)} s).`;
  game.inventory.bolzen--;
  m.cdMax = T.cooldown * (mountState(game, id) === 'damaged' ? T.kaputtFaktor : 1);   // beschädigte Lafette: Cooldown ×1,5 (Katalogwert; Triebwerk und Energie wirken nie)
  m.cd = m.cdMax;
  Alarm.laerm(game, 'waffen');   // EK2
  const a = Math.atan2(target.y - ship.y, target.x - ship.x);
  game.space.projectiles.push({ id: game.nextId('pr'), kind: 'torpedo', x: ship.x - Math.cos(ship.angle) * 30, y: ship.y - Math.sin(ship.angle) * 30,
    angle: a, speed: T.geschw, ttl: T.ttl, dmg: 0, target: target.id, owner: 'lerche' });
  game.stats.torpedos = (game.stats.torpedos || 0) + 1;
  game.emit('sfx', { name: 'torpedo' });
  return null;
}

// Eine Stelle für jede Gutschrift ins Lager (Fundbelohnung, Regiebuch, Shop-Folgen): Torpedos höchstens `lagerMax`; der Überhang wird zu 10 Marken je Stück verkauft (ODA sagt es)
function lagerGutschrift(game, item, n) {
  n = Math.round(Number(n) || 0);
  if (item !== 'bolzen') { game.inventory[item] = (game.inventory[item] || 0) + n; return n; }
  const max = Katalog.TORPEDO.lagerMax; const have = game.inventory.bolzen || 0;
  const add = Math.max(0, Math.min(n, max - have)); game.inventory.bolzen = have + add;
  const rest = n - add;
  if (rest > 0) { game.inventory.marks += rest * 10; game.oda(`Torpedolager voll (höchstens ${max}) – ${rest} Torpedo${rest === 1 ? '' : 's'} für ${rest * 10} Marken verkauft.`, null); }
  return add;
}

// ---------- Befehle ----------
function fireOne(game, id) {
  const ship = game.ship;
  const w = waffeAn(game, id);
  if (!w) return Katalog.platzVonMount(id) == null ? 'Unbekannte Waffe.' : `Platz ${Katalog.platzVonMount(id)}: keine Waffe eingebaut.`;
  const m = ship.mount[id];
  const name = label(game, id);
  if (isDown(mountState(game, id))) return `${name} ausgefallen – reparieren.`;
  if (w.art === 'lanze') {
    // §20.4: weapons.fire bow feuert mit der aktuellen power (aus dem Stand 0 = Mindestschaden)
    if (m.charging) { fireLance(game, id, m.power, false); return null; }
    if (m.charge < 1) return `${name} lädt noch.`;
    fireLance(game, id, 0, false);
    return null;
  }
  if (w.art === 'torpedo') return fireTorpedo(game, id);
  if (m.salvo > 0) return `${name}: Salve läuft.`;
  if (m.charge < 1) return `${name} lädt noch.`;
  if (w.art === 'turm') {
    const z = turmZiel(game, id);
    if (!z) return `${name}: kein Jäger und kein Torpedo in Reichweite.`;
    startSalvo(game, id, z, 1);
    return null;
  }
  // Ziel nicht nötig: gewähltes Ziel im Bogen, sonst nächster Gegner im Bogen, sonst ins Leere
  const sel = selectedEnemy(game);
  const mineSel = !sel ? Alarm.mineById(game, game.ship.target) : null;   // EK2: angewählte Mine
  const tgt = sel && inMountArc(game, id, sel.x, sel.y) ? sel : (mineSel && inMountArc(game, id, mineSel.x, mineSel.y) ? mineSel : nearestInArc(game, id));
  startSalvo(game, id, tgt, 1);
  return null;
}
// weapons.fire { mount } – 'all' feuert alle Salven-Waffen (Batterien, Kanone), nicht die Lanzen, den Turm und den Torpedowerfer
function weaponsFire(game, mount) {
  ensureMounts(game);
  const ship = game.ship;
  if (ship.docked) return 'Angedockt wird nicht geschossen.';
  const k = normMount(mount, game);
  if (k === 'all') {
    const errs = []; let fired = 0;
    for (const a of ausstattung(game)) {
      if (a.w.art !== 'salve') continue;
      const err = fireOne(game, a.id);
      if (err) errs.push(err); else fired++;
    }
    if (fired) return null;
    return errs[0] || 'Batterien laden noch.';
  }
  if (Katalog.platzVonMount(k) == null) return 'Unbekannte Waffe.';
  if ((mount === 'bolzen' || mount === 'torpedo') && !waffeAn(game, k)) return 'Kein Torpedowerfer eingebaut (Heck 2, ab Ausbaustufe 2).';
  return fireOne(game, k);
}
// weapons.alloc { mount, delta: ±1 }
function weaponsAlloc(game, mount, delta) {
  ensureMounts(game);
  const Sx = M3(game); const ship = game.ship;
  const k = normMount(mount, game);
  const ids = energieMounts(game).map((a) => a.id);
  if (!ids.includes(k)) return Katalog.platzVonMount(k) != null && waffeAn(game, k) && !waffeAn(game, k).energie ? 'Der Torpedowerfer braucht keine Ladepunkte.' : 'Ladepunkte nur für Energiewaffen.';
  const d = delta > 0 ? 1 : delta < 0 ? -1 : 0;
  if (!d) return null;
  const cur = computeAlloc(game);
  if (!weaponsManned(game)) Object.assign(cur, ship.wAllocIntent);   // ohne Ops: Wunsch weiterpflegen
  const nv = (cur[k] || 0) + d;
  if (nv < 0 || nv > Sx.allocMax) return 'Grenze erreicht.';
  if (d > 0 && ids.reduce((a, id) => a + (cur[id] || 0), 0) + 1 > chargePoints(game)) return 'Keine Ladepunkte frei – erst woanders abziehen oder mehr Energie auf Waffen.';
  cur[k] = nv;
  const intent = {}; for (const id of ids) intent[id] = cur[id] || 0;
  ship.wAllocIntent = intent;
  const eff = computeAlloc(game);
  for (const id of ids) ship.mount[id].alloc = eff[id];
  game.emit('sfx', { name: 'ui_click' });
  return null;
}
function weaponsHold(game, mount, hold) { return 'Batterien feuern nur auf Befehl.'; }   // eslint-disable-line no-unused-vars
function weaponsReload(game) { void game; return 'Der Torpedowerfer lädt selbst nach (Cooldown) – nur das Lager muss gefüllt sein.'; }

// §5.6 Orbitalschlag: volle Ladung verbrauchen (die erste volle Energiewaffe in der Reihenfolge Bug, Seiten, …)
function consumeFullCharge(game) {
  ensureMounts(game);
  const m = game.ship.mount;
  for (const a of energieMounts(game)) {
    const mm = m[a.id];
    if (mm.charge < 1 || isDown(mountState(game, a.id))) continue;
    if (a.w.art !== 'lanze' && mm.salvo > 0) continue;
    if (a.w.art === 'lanze' && mm.charging) lanceFizzle(game, a.id, 'strike');   // Orbitalschlag nimmt die Ladung
    mm.charge = 0;
    return a.id;
  }
  return null;
}

// ---------- Projektile der Lerche und der Gegner (von space.updateProjectiles) ----------
// Lenkung vor der Bewegung (torpedo: auf das gewählte Gegnerziel, etorpedo: auf die Lerche)
function lenke(game, p, dt) {
  const T = Katalog.TORPEDO;
  if (p.kind === 'torpedo') {
    const t = game.space.enemies.find((e) => e.id === p.target);
    if (t) p.angle = turnToward(p.angle, Math.atan2(t.y - p.y, t.x - p.x), T.wenden * dt);
  } else if (p.kind === 'etorpedo') {
    const ship = game.ship;
    p.angle = turnToward(p.angle, Math.atan2(ship.y - p.y, ship.x - p.x), T.gegnerWenden * dt);
  }
}

// ---------- Snapshot (§9.3) ----------
function mountsSnapshot(game) {
  ensureMounts(game);
  const m = game.ship.mount; const out = [];
  for (const a of ausstattung(game)) {
    const mc = mountCfg(game, a.id); const mm = m[a.id];
    const o = { id: a.id, facing: mc.facing, arc: mc.arc, range: mc.range, state: mountState(game, a.id) };
    if (Katalog.START_BESTUECKUNG[a.platz] !== a.w.id) o.typ = a.w.id;   // fehlt = Startbestückung des Platzes
    if (a.w.art === 'torpedo') {
      o.charge = r2(clamp(mm.cdMax > 0 ? 1 - mm.cd / mm.cdMax : 1, 0, 1)); o.ammo = game.inventory.bolzen; o.cd = Math.ceil(mm.cd);
    } else {
      o.charge = r2(mm.charge); o.alloc = mm.alloc || 0;
      if (mm.blk && mm.alloc > 0 && mm.charge <= 0) o.blk = 1;   // Magazin voll: lädt nicht, weil der Anfangsstoß-Deckel erreicht ist
      if (a.w.art === 'lanze') { o.power = r2(mm.power || 0); o.charging = !!mm.charging; o.dmg = r1(lanceDamage(game, mm.power || 0, a.id)); }
      else { o.salvo = mm.salvo || 0; o.salvoMax = rohre(game, a.id); }
      // SYS-01 B2: Restzeit des Cooldowns (Ladezeit bis 1, am echten Ladepool) in Zehntelsekunden, Ganzzahl. Lanze (eigene Ladeanzeige), Salve und Magazin-voll ohne Feld.
      if (a.w.art !== 'lanze' && !(mm.salvo > 0) && !(mm.charge >= 1)) { const t = chargeTime(game, a.id); if (t != null) o.rest10 = Math.ceil((1 - clamp(mm.charge || 0, 0, 1)) * t * 10); }
    }
    out.push(o);
  }
  return out;
}

// ---------- Debug: bestueck <platz 1–9> <waffe-id|leer> | bestueck alle [stufe] | bestueck status ----------
function debug(game, args) {
  const a0 = args[0];
  if (a0 == null || a0 === 'status') {
    const list = Maps.WAFFENPLAETZE.map((p) => `${p.platz}${platzOffen(game, p.platz) ? '' : '(zu)'}=${waffenMap(game)[p.platz] || '–'}`);
    game.log(`Bestückung: ${list.join(' ')} · Waffen: ${Katalog.WAFFEN.map((w) => w.id).join(', ')}`);
    return null;
  }
  if (a0 === 'alle') {
    const st = args[1] != null ? Number(args[1]) : null;
    if (st != null && !(Number.isInteger(st) && st >= 0 && st <= Maps.STUFE_MAX)) return `bestueck alle [stufe 0–${Maps.STUFE_MAX}]: Stufe setzen und jeden offenen Platz bestücken.`;
    bestueckeAlle(game, st);
    return null;
  }
  if (a0 === 'start') { const Ausbau = require('./ausbau.js'); Ausbau.setStufe(game, 0); game.ship.waffen = Object.assign({}, Katalog.START_BESTUECKUNG); game.ship.mount = {}; ensureMounts(game); verteilungZuruecksetzen(game); return null; }
  if (args.length < 2) return 'bestueck <platz 1–9> <waffe-id|leer> | alle [stufe] | start | status. Waffen: ' + Katalog.WAFFEN.map((w) => w.id).join(', ');
  return bestuecken(game, a0, args[1]);
}

// ---------- Weltstand ----------
function toSave(game) { const o = {}; const wm = waffenMap(game); for (const p of Maps.WAFFENPLAETZE) if (wm[p.platz]) o[p.platz] = wm[p.platz]; return o; }
// fehlt das Feld (Altstand): Startbestückung; unbekannte Ids und Plätze mit falscher Platzart fallen auf die Startbestückung zurück bzw. bleiben leer
function restore(game, saved) {
  const wm = {};
  if (saved && typeof saved === 'object') {
    for (const p of Maps.WAFFENPLAETZE) { const id = saved[p.platz]; if (id && Katalog.waffe(id) && Katalog.passtAuf(id, p.platz)) wm[p.platz] = id; }
  } else Object.assign(wm, Katalog.START_BESTUECKUNG);
  game.ship.waffen = wm; game.ship.mount = {};
  ensureMounts(game);
  require('./interior.js').inaktiveHeilen(game);
  verteilungZuruecksetzen(game);
}

module.exports = {
  MOUNT_SYSTEM, SYSTEM_MOUNT, ALLE, waffenMap, platzOffen, ausstattung, mountIds, waffeAn, energieMounts, normMount, mountState, label, wcfg, mountCfg,
  ensureMounts, szeneReset, bestuecken, umruesten, setzeRoh, bestueckeAlle, stufeGeaendert, chargePoints, computeAlloc, standardVerteilung, verteilungZuruecksetzen, chargeTime,
  inMountArc, mountOrigin, nearestInArc, selectedEnemy, update, lanceChargeTime, lanceDamage, lanceTrace, fireLance, weaponsCharge, rohre, startSalvo,
  streuExplosion, fireTorpedo, weaponsFire, weaponsAlloc, weaponsHold, weaponsReload, consumeFullCharge, lenke, mountsSnapshot, debug, toSave, restore,
  vorrat, reserviert, lagerGutschrift, turmZiel, isDown, EPS, schade, vorhaltWinkel,
};
