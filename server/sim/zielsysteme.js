'use strict';
// SUND-04a-1 A: Gezielter Systemtreffer (Ops, Taktik) mit gleichen Regeln für beide Seiten. Alle Zahlen und Zielsysteme stehen in
// content/kampf/zielsysteme-werte.json (V1: nur der Antrieb); dieses Modul kennt keinen Systemnamen im Code, nur die Wirkungsarten.
//
// Regel (gleich für beide Seiten): Ein Treffer, der den Schild des getroffenen Segments durchschlägt (Hüllenschaden > 0) UND die Hülle in der
// Seite des Systems trifft (Antrieb: Heck), schädigt das System um eine Stufe. Wahrscheinlichkeit: gezielt 1, ungezielt 0,35 (Daten); zwischen zwei
// Stufen eines Systems liegt eine Sperre (Salve).
//   - Lerche -> Gegner (space.damageEnemy, Angriffe tragen opts.angriff): e.zs[system] = { s: Stufe, bis: Erholung, sp: Sperre, gehalten }.
//     Fehlt e.zs, gilt der Normalzustand (voll): alle Haken sind dann ohne Wirkung und rechnen nicht (Golden Trace, Kampagnen unverändert).
//     Gezielt = die Ops haben das System am Ziel gewählt (ship.zielsystem, Befehl weapons.systemziel).
//   - Gegner -> Lerche (space.shipHit): schädigt das bestehende System der Lerche (ship.systems, interior.damageSystem), nichts Paralleles.
//     Gezielt = der Schütze hat das System als Ziel (e.zielsystem).
// Aktiv: auf der Seite der Lerche gegen Gegner sobald die Ops ein Systemziel gewählt haben ODER die Szene den Schalter hat (space.zielsysteme);
// gegen die Lerche nur mit Schalter. Wirkungsarten: 'tempo' (Faktor auf die Fahrt: tempoFaktor, Haken in space.moveLegacy, pilot.fly, konvoi.steuern).
// Erholung nach Zeit (Daten), ein gestelltes Schiff bleibt aus (halte).
const Schilde = require('../../shared/schilde.js');
const Physics = require('../../shared/physics.js');
const W = require('../../content/kampf/zielsysteme-werte.json').werte;

const SYSTEME = W.systeme.wert;
const TREFFER = W.treffer.wert;
const SCHALTER = W.szene.wert.schalter;
const SEITEN = Schilde.SEITEN;

let interiorMod = null;   // lazy (Zirkelbezug space -> zielsysteme -> interior)
const interior = () => interiorMod || (interiorMod = require('./interior.js'));

const ids = () => Object.keys(SYSTEME);
const system = (id) => SYSTEME[id] || null;
const seiteIndex = (sys) => SEITEN.indexOf(sys.seite);
const enemyOf = (game) => (game.ship.target == null ? null : game.space.enemies.find((e) => e.id === game.ship.target) || null);

// ---------- Szenenschalter ----------
function szeneAn(game, an) {
  if (an === false) delete game.space[SCHALTER]; else game.space[SCHALTER] = true;
}
function szeneAktiv(game) { return !!(game.space && game.space[SCHALTER] === true); }

// ---------- Zustand am Gegner ----------
function stufe(e, id) { return e && e.zs && e.zs[id] ? e.zs[id].s : 0; }
function stufeDaten(id, s) { const sys = SYSTEME[id]; return sys ? sys.stufen[Math.min(s, sys.stufen.length - 1)] : null; }
function maxStufe(id) { const sys = SYSTEME[id]; return sys ? sys.stufen.length - 1 : 0; }
function ausgefallen(e, id) { return stufe(e, id) >= maxStufe(id) && stufe(e, id) > 0; }
// Fahrtfaktor (0..1) aus allen Systemen mit Wirkung 'tempo'. Ohne e.zs genau 1.
function tempoFaktor(e) {
  if (!e || !e.zs) return 1;
  let f = 1;
  for (const id of Object.keys(e.zs)) {
    const sys = SYSTEME[id];
    if (!sys || sys.wirkung !== 'tempo') continue;
    const d = stufeDaten(id, e.zs[id].s);
    if (d && d.faktor != null) f *= d.faktor;
  }
  return f;
}
// Ein gestelltes Schiff bleibt aus: keine Erholung mehr
function halte(e, id) { if (e && e.zs && e.zs[id]) { e.zs[id].gehalten = true; e.zs[id].bis = null; } }
function zuruecksetzen(e) { if (e && e.zs) delete e.zs; }

// Zähler für Bots und Messung (game.stats.zielsysteme): gegner = Stufen, die Gegner verloren haben; lerche = Stufen der Lerche
function stats(game) { return game.stats.zielsysteme || (game.stats.zielsysteme = { gegner: 0, lerche: 0 }); }

// Seite (0 Bug, 1 Steuerbord, 2 Heck, 3 Backbord), in der ein Treffer aus (sx, sy) das Schiff e trifft: über das Segment der Klasse, sonst über den Sektor
function seiteGetroffen(game, e, sx, sy) {
  const lay = Schilde.layout(game.C, e.kind);
  if (lay) {
    const sec = Schilde.segmentOf(lay, e.x, e.y, e.angle, sx, sy);
    if (sec >= 0 && sec < lay.segs.length) return lay.segs[sec].seite;
  }
  return Physics.sectorOf(e.x, e.y, e.angle, sx, sy);
}
function wuerfeln(game, p) { return p >= 1 ? true : p > 0 && game.rng.chance(p); }

// ---------- Lerche -> Gegner (Aufruf: space.damageEnemy nach einem Hüllentreffer, nur für Angriffe) ----------
function trifftGegner(game, e, sx, sy, opts) {
  if (!e || sx == null || !(opts && opts.angriff)) return false;
  const gewaehlt = !opts.ally && game.ship.target === e.id ? game.ship.zielsystem || null : null;
  const szene = szeneAktiv(game);
  let getroffen = false;
  for (const id of ids()) {
    const sys = SYSTEME[id];
    if (!sys.klassen.includes(e.kind)) continue;
    const gezielt = gewaehlt === id;
    if (!szene && !gezielt) continue;
    if (seiteGetroffen(game, e, sx, sy) !== seiteIndex(sys)) continue;
    if (!wuerfeln(game, gezielt ? TREFFER.wahrscheinlichkeit.gezielt : TREFFER.wahrscheinlichkeit.ungezielt)) continue;
    if (schaedige(game, e, id)) getroffen = true;
  }
  return getroffen;
}
// Eine Stufe weiter (mit Sperre). Auf der letzten Stufe verlängert ein weiterer Treffer die Erholungsfrist nur, wenn die Daten es verlangen
// (treffer.letzteStufeVerlaengert, Standard aus): Dauerfeuer hält den Ausfall höchstens bis zum Ablauf der Frist.
function schaedige(game, e, id) {
  const sys = SYSTEME[id];
  const z = e.zs || (e.zs = {});
  const cur = z[id] || (z[id] = { s: 0, bis: null, sp: 0 });
  if (cur.gehalten || game.time < cur.sp) return false;
  // Immunitaet nach der Erholung von der letzten Stufe (Daten treffer.immunitaet_s): in dieser Frist steigert ein weiterer Treffer die Stufe nicht.
  // Dauerfeuer legt einen Gegner so hoechstens die Erholungszeit des Ausfalls lahm und laesst ihn danach die Immunitaet fahrfaehig.
  if (cur.imm != null && game.time < cur.imm) return false;
  const letzte = maxStufe(id);
  if (cur.s >= letzte) {
    if (TREFFER.letzteStufeVerlaengert) { const d = stufeDaten(id, cur.s); cur.bis = d.erholung_s != null ? game.time + d.erholung_s : null; }
    cur.sp = game.time + TREFFER.sperre_s;
    return false;
  }
  cur.s++;
  cur.sp = game.time + TREFFER.sperre_s;
  const d = stufeDaten(id, cur.s);
  cur.bis = d.erholung_s != null ? game.time + d.erholung_s : null;
  game.emit('sfx', { name: cur.s >= letzte ? 'system_break' : 'hull_hit' });
  if (e.scanned) game.oda(`${sys.name} des Ziels ${d.name}.`, null);
  stats(game).gegner++;
  game.missionEvent('zielsystemGetroffen', { enemy: e, system: id, stufe: cur.s, seite: 'gegner' });
  return true;
}

// ---------- Gegner -> Lerche (Aufruf: space.shipHit nach der Trefferauflösung, nur für Angriffe) ----------
// sector: getroffener Sektor der Lerche (0 Bug … 3 Backbord), r: Ergebnis von damage.resolveHit (rest = Schaden am Schild vorbei, systems), opts.zielt = Zielsystem des Schützen
function trifftLerche(game, sector, r, opts) {
  if (!(opts && opts.angriff) || !szeneAktiv(game) || !r || !(Number(r.rest) > 0)) return false;
  const ship = game.ship;
  let getroffen = false;
  for (const id of ids()) {
    const sys = SYSTEME[id];
    if (!sys.lerche || ship.systems[sys.lerche] == null || sector !== seiteIndex(sys)) continue;
    if ((r.systems || []).some((x) => x.system === sys.lerche && x.wechsel)) continue;   // derselbe Treffer hat das System schon geschädigt (Zustandswechsel)
    const sp = ship.zsAt || (ship.zsAt = {});
    if (game.time < (sp[id] != null ? sp[id] : -1e9) + TREFFER.sperre_s) continue;
    const gezielt = opts.zielt === id;
    if (!wuerfeln(game, gezielt ? TREFFER.wahrscheinlichkeit.gezielt : TREFFER.wahrscheinlichkeit.ungezielt)) continue;
    sp[id] = game.time;
    interior().damageSystem(game, sys.lerche);
    stats(game).lerche++;
    game.missionEvent('zielsystemGetroffen', { system: id, stufe: ship.systems[sys.lerche], seite: 'lerche' });
    getroffen = true;
  }
  return getroffen;
}

// ---------- Erholung (Aufruf: space.update, nach updateEnemies) ----------
function update(game) {
  for (const e of game.space.enemies) {
    if (!e.zs) continue;
    for (const id of Object.keys(e.zs)) {
      const cur = e.zs[id];
      if (cur.bis == null || game.time < cur.bis) continue;
      const war = cur.s;
      cur.s--;
      if (cur.s <= 0) { delete e.zs[id]; continue; }
      if (war >= maxStufe(id)) cur.imm = game.time + TREFFER.immunitaet_s;   // Erholung von der letzten Stufe: Immunitaetsfrist beginnt
      const d = stufeDaten(id, cur.s);
      cur.bis = d && d.erholung_s != null ? game.time + d.erholung_s : null;
    }
    if (!Object.keys(e.zs).length) delete e.zs;
  }
}

// ---------- Systemziel der Ops (Befehl weapons.systemziel { id | null }) ----------
function waehle(game, id) {
  const ship = game.ship;
  if (id == null || id === '') { delete ship.zielsystem; return null; }
  const sys = SYSTEME[id];
  if (!sys) return 'Unbekanntes Systemziel.';
  const e = enemyOf(game);
  if (!e) return 'Erst ein Ziel wählen (T oder anklicken).';
  if (!e.scanned) return 'Erst das Ziel scannen (S halten).';
  if (!sys.klassen.includes(e.kind)) return `Dieses Ziel hat keinen ${sys.name} zum Anvisieren.`;
  ship.zielsystem = id;
  return null;
}
function waehlbar(game, e) { return ids().filter((id) => e && e.scanned && SYSTEME[id].klassen.includes(e.kind)); }

// ---------- Snapshot (nur gescannte Ziele mit Schaden) ----------
// Feld je System (Daten, Antrieb: az) = Stufe (1 beschädigt, 2 ausgefallen); fehlt = voll; ag = 1: gestellt (nur mit az)
function snapExtra(e) {
  if (!e || !e.zs || !e.scanned) return null;
  let o = null;
  for (const id of Object.keys(e.zs)) {
    const sys = SYSTEME[id]; const z = e.zs[id];
    if (sys && sys.feld && z.s > 0) (o || (o = {}))[sys.feld] = z.s;
  }
  if (o && Object.keys(e.zs).some((id) => e.zs[id].gehalten)) o.ag = 1;   // gestellt (Verfolgung): der Ausfall bleibt, am Ziel steht GESTELLT (Review D-M2)
  return o;
}

// ---------- Debug: zielsysteme [an|aus|frei|treffer [n] [system]] ----------
function debug(game, args) {
  const a = Array.isArray(args) ? args.map(String) : [];
  if (a[0] === 'aus') { szeneAn(game, false); return null; }
  if (a[0] === 'frei') { for (const e of game.space.enemies) zuruecksetzen(e); return null; }
  if (a[0] === 'treffer') {   // n Stufen am gewählten Ziel (ohne Sperre, Sichtprüfung und Tests)
    const e = enemyOf(game); const id = SYSTEME[a[2]] ? a[2] : ids()[0];
    if (!e) return 'Erst ein Ziel wählen.';
    if (!SYSTEME[id].klassen.includes(e.kind)) return `Dieses Ziel hat keinen ${SYSTEME[id].name}.`;
    for (let i = 0; i < Math.max(1, Math.min(maxStufe(id), Number(a[1]) || 1)); i++) { if (e.zs && e.zs[id]) e.zs[id].sp = 0; schaedige(game, e, id); }
    return null;
  }
  szeneAn(game, true);
  return null;
}

module.exports = { SYSTEME, TREFFER, SCHALTER, ids, system, szeneAn, szeneAktiv, stufe, stufeDaten, maxStufe, ausgefallen, tempoFaktor, halte, zuruecksetzen,
  trifftGegner, trifftLerche, schaedige, update, waehle, waehlbar, snapExtra, debug, seiteGetroffen };
