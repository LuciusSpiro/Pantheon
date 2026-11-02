'use strict';
// TEL-01 B2: Haken fuer Deckung, Menschen, Wirtschaft, Technik und die Zeitreihe. Alle Funktionen hier LESEN nur Spielzustand und schreiben
// ueber game.telemetrie.ereignis (flache Felder, Positivliste); sie verbrauchen keinen Zufall, aendern nichts im Spiel und werfen nie.
// Merkzustand (war in Deckung, Konsole, Fenster der Zeitreihe) haelt DIESES Modul je Game und Session (WeakMap), nie das Spielobjekt.
// Ohne offene Session kostet jeder Haken einen Zugriff auf game.telemetrie.offen und baut nichts.
//
//   Deckung        deckungSpielerAlle(game) (aus combat.updateVisibility), deckungGegner(game, e) (aus squad.updateEnemyCrouch)
//   Konsole        konsole(game, p, rein, grund)                     Ereignis 'konsole' (Rolle = Konsole bzw. aktive Station)
//   Reparatur      reparaturGelungen(game, p, h), zoneWieder(game, sys, wie), loeschen(game, p, art, tx, ty); Beobachter in tickEnde
//   Wirtschaft     buchung(game, konto, art, grund, betrag, stand), ruf(game, fraktion, betrag, stand), energie(game, grund, sys, delta)
//   Technik        tickEnde(game, t0, lief) (aus Game.step), fehler(game, where), eingabe(game, p, art), spielleiterWarten(game, art, dauer, ausgang)
//   Zeitreihe      alle FENSTER Sekunden Spielzeit (tickgenau) eine Zeile 'zeitreihe' (Felder siehe schema.js)
const FENSTER = 2;   // s Spielzeit
const EPS = 1e-6;
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const TILE = 32;
const kachel = (v) => Math.round(v / TILE);   // 1 Kachel = 1 m: Positionen auf ganze Kacheln
const CODE = { ok: '0', damaged: '1', broken: '2', offline: '3' };
const REP = { flick: true, swap: true, minigame: true };   // Halteprozesse des Reparaturspiels (interior.REPAIR_KINDS)
const MAX_FEHLER_WO = 8;
const WO_OK = /^[A-Za-z0-9_:-]{1,40}$/;

const Zustaende = new WeakMap();
function neu(sitzung, game) {
  return { sitzung, naechst: game.time + FENSTER, dauern: [], ein: new Map(), fehlerN: 0, fehlerWo: new Map(), spieler: new Map(), gegner: new WeakMap(), rep: new Map(), energie: null };
}
// Zustand der laufenden Session oder null (keine Session / kein Dienst). Eine neue Session beginnt mit leerem Zustand.
function zust(game) {
  const t = game.telemetrie;
  if (!t || !t.offen) return null;
  let s = Zustaende.get(game);
  if (!s || s.sitzung !== t.sitzung) { s = neu(t.sitzung, game); Zustaende.set(game, s); }
  return s;
}
const nie = (game, f) => { try { f(); } catch (e) { try { game.countError('telemetrie-haken', e); } catch (x) { /* nie werfen */ } } };

// ---------- Deckung (2b) ----------
// Spieler: in Deckung = auf der Aussenkarte und p.cv > 0 (Deckung gegen den gefaehrlichsten sichtbaren Gegner, geduckt hinter niedriger Deckung zaehlt voll;
// combat.updateVisibility rechnet es mit aiHz). Gegner: in Deckung = geduckt (squad.updateEnemyCrouch). Je Wechsel eine Zeile 'deckung'.
function deckungSpielerAlle(game) {
  const s = zust(game);
  if (!s) return;
  nie(game, () => {
    for (const p of game.players) {
      const rein = p.zone === 'away' && (p.cv | 0) > 0;
      if ((s.spieler.get(p.id) === true) === rein) continue;
      s.spieler.set(p.id, rein);
      game.telemetrie.ereignis('deckung', { slot: p.id, gegner: null, rolle: null, rein, cv: p.cv | 0, geduckt: !!p.crouch, flanke: !!p.fl, stellung: stellung(game, p), x: kachel(p.x), y: kachel(p.y) });
    }
  });
}
function deckungGegner(game, e) {
  const s = zust(game);
  if (!s) return;
  const rein = !!e.crouch;
  if (s.gegner.get(e) === rein || (!rein && !s.gegner.has(e))) return;
  s.gegner.set(e, rein);
  nie(game, () => game.telemetrie.ereignis('deckung', { slot: null, gegner: e.id == null ? null : String(e.id), rolle: e.rolle || e.kind || null, rein, cv: null, geduckt: rein, flanke: null, stellung: stellung(game, e), x: kachel(e.x), y: kachel(e.y) }));
}
function stellung(game, k) { try { return !!require('../sim/stellung.js').inStellung(game, k); } catch (e) { return false; } }

// ---------- Konsole / Rolle (4) ----------
function konsole(game, p, rein, grund) {
  const t = game.telemetrie;
  if (!t || !t.offen) return;
  nie(game, () => t.ereignis('konsole', { slot: p.id, konsole: p.console || null, station: p.console ? (p.station || p.console) : null, rein: !!rein, grund: String(grund || 'sonst').slice(0, 30) }));
}

// ---------- Reparatur und Loeschen (4) ----------
// Das Reparaturspiel ist ein Halteprozess (p.hold: flick | swap | minigame). Der Beobachter in tickEnde sieht, wann er beginnt und endet; der Erfolg wird an
// den Stellen vermerkt, die ihn kennen (interior.completeHold, interior.repairCmd). Ein Ende ohne Vermerk (Weglaufen, Abbruch, zu hastig) ist erfolg: false.
function reparaturGelungen(game, p, h) {
  const s = zust(game);
  if (!s || !h || !REP[h.kind]) return;
  let m = s.rep.get(p.id);
  if (!m || m.h !== h) { m = { h, kind: h.kind, system: h.system || null, t0: game.time - (Number.isFinite(h.t) ? h.t : 0), ok: false }; s.rep.set(p.id, m); }
  m.ok = true;
}
function reparaturBeobachten(game, s) {
  for (const p of game.players) {
    const h = p.hold;
    let m = s.rep.get(p.id);
    if (m && (!h || m.h !== h)) { reparaturEnde(game, p.id, m); s.rep.delete(p.id); m = null; }
    if (!m && h && REP[h.kind]) s.rep.set(p.id, { h, kind: h.kind, system: h.system || null, t0: game.time, ok: false });
  }
}
function reparaturEnde(game, slot, m) {
  game.telemetrie.ereignis('reparatur', { slot, system: m.system, wie: m.kind, dauer: r2(Math.max(0, game.time - m.t0)), erfolg: !!m.ok, notflicken: m.kind === 'flick' });
}
function zoneWieder(game, sys, wie, durch) {
  const t = game.telemetrie;
  if (!t || !t.offen) return;
  nie(game, () => t.ereignis('zone_wieder', { zone: String(sys).slice(0, 40), wie: String(wie || '').slice(0, 20), durch: durch == null ? null : String(durch).slice(0, 10) }));
}
// Feuer geloescht / Leck geflickt (Halteprozess extinguish bzw. patch); raum = Raumkennung der Kachel
function loeschen(game, p, art, tx, ty) {
  const t = game.telemetrie;
  if (!t || !t.offen) return;
  nie(game, () => {
    let raum = null;
    try { const r = require('../world.js').Maps.roomAt(tx, ty); raum = r ? String(r.id) : null; } catch (e) { /* ohne Raum */ }
    t.ereignis('loeschen', { slot: p.id, art, zone: raum });
  });
}

// ---------- Wirtschaft (5) ----------
// konto: 'marks' oder das Gut; art: 'buchung' (Wirtschaft) | 'stand' (Stand gesetzt: Anfang, Laden, Test, Debug); betrag = Aenderung, stand = danach
function buchung(game, konto, art, grund, betrag, stand) {
  const t = game.telemetrie;
  if (!t || !t.offen) return;
  nie(game, () => t.ereignis('buchung', { konto: String(konto).slice(0, 30), art, grund: grund == null ? null : String(grund).slice(0, 30), betrag: r2(Number(betrag) || 0), stand: r2(Number(stand) || 0) }));
}
function ruf(game, fraktion, betrag, stand) {
  const t = game.telemetrie;
  if (!t || !t.offen) return;
  nie(game, () => t.ereignis('ruf', { fraktion: String(fraktion).slice(0, 20), betrag: r2(betrag), stand: r2(stand) }));
}
// Energieverteilung: aus der Technik-Konsole (grund 'technik', mit system/delta) oder weil enforcePower gekuerzt hat (grund 'automatik', nur bei Aenderung).
// Der Verlauf steht in der Zeitreihe (r_energie).
function energie(game, grund, sys, delta) {
  const s = zust(game);
  if (!s) return;
  nie(game, () => {
    const pw = game.ship.power;
    const jetzt = [pw.engines, pw.shields, pw.weapons];
    const alt = s.energie;
    s.energie = jetzt;
    if (grund === 'automatik' && (!alt || (alt[0] === jetzt[0] && alt[1] === jetzt[1] && alt[2] === jetzt[2]))) return;   // erster Abgleich = Ausgangsstand, kein Ereignis
    let leistung = null, verbrauch = null;
    try { const sp = require('../sim/space.js'); leistung = sp.reactorOutput(game); verbrauch = sp.powerUsed(game); } catch (e) { /* ohne */ }
    game.telemetrie.ereignis('energie', { grund, system: sys || null, delta: delta == null ? null : delta, engines: jetzt[0], shields: jetzt[1], weapons: jetzt[2], leistung, verbrauch });
  });
}

// ---------- Technik (6) ----------
function eingabe(game, p, art) {
  const s = zust(game);
  if (!s) return;
  let e = s.ein.get(p.id);
  if (!e) { e = { bew: 0, akt: 0 }; s.ein.set(p.id, e); }
  if (art === 'bew') e.bew++; else e.akt++;
}
function fehler(game, where) {
  const s = zust(game);
  if (!s) return;
  s.fehlerN++;
  const w = typeof where === 'string' && WO_OK.test(where) ? where : 'sonst';
  s.fehlerWo.set(w, (s.fehlerWo.get(w) || 0) + 1);
}
function spielleiterWarten(game, art, dauer, ausgang) {
  const t = game.telemetrie;
  if (!t || !t.offen) return;
  nie(game, () => t.ereignis('spielleiter_warten', { art: String(art).slice(0, 30), dauer: r2(Math.max(0, Number(dauer) || 0)), ausgang: ausgang == null ? null : String(ausgang).slice(0, 30) }));
}
// Am Ende von Game.step: Dauer des Steps merken (t0 = performance.now() vor dem Step), Beobachter, Zeitreihe wenn das Fenster voll ist.
// lief = false: der Step hat die Spielzeit nicht weitergedreht (Solo-Pause) und zaehlt nicht als Tick.
function tickEnde(game, t0, lief) {
  const s = zust(game);
  if (!s) return;
  nie(game, () => {
    if (lief) s.dauern.push(performance.now() - t0);
    reparaturBeobachten(game, s);
    if (game.time + EPS >= s.naechst && lief) { zeile(game, s); s.naechst += FENSTER; if (s.naechst <= game.time) s.naechst = game.time + FENSTER; }
  });
}

// ---------- Zeitreihe (alle FENSTER s) ----------
function zeile(game, s) {
  const sh = game.ship; const f = {};
  const Interior = require('../sim/interior.js');
  f.fenster = FENSTER;
  // Technik: Tickzeit im Fenster (ms), Fehler (nur Zahl und Schluessel, nie die Meldung)
  const d = s.dauern.sort((a, b) => a - b);
  f.tick_n = d.length;
  f.tick_med = d.length ? r3(d[d.length >> 1]) : null;
  f.tick_max = d.length ? r3(d[d.length - 1]) : null;
  f.fehler_n = s.fehlerN;
  f.fehler_wo = [...s.fehlerWo.keys()].slice(0, MAX_FEHLER_WO);
  s.dauern = []; s.fehlerN = 0; s.fehlerWo = new Map();
  // Raum
  f.ort = sh.scene == null ? null : String(sh.scene).slice(0, 40);
  f.r_zustand = Interior.SYSTEM_ORDER.map((k) => CODE[sh.systems[k]] || '?').join('');   // 0 ok, 1 damaged, 2 broken, 3 offline, Reihenfolge interior.SYSTEM_ORDER
  f.r_integ = Interior.SYSTEM_ORDER.map((k) => r1(Interior.integOf(game, k)));
  f.r_reaktor = sh.reactorCtl ? String(sh.reactorCtl.state).slice(0, 20) : null;
  f.r_energie = [sh.power.engines, sh.power.shields, sh.power.weapons];   // engines, shields, weapons
  f.r_leistung = sh.reactor ? r1(sh.reactor.output) : null;
  f.r_verbrauch = sh.reactor ? r1(sh.reactor.used) : null;
  f.r_hitze = [r1(sh.heat.engines), r1(sh.heat.shields), r1(sh.heat.weapons)];
  f.r_schild = sh.shields.current.map(r1);   // Sektoren 0..3
  f.r_gegner = game.space.enemies.reduce((n, e) => n + (e.kind !== 'relay' ? 1 : 0), 0);
  // Slots: Ort, Konsole, Rolle (aktive Station), verbunden, Eingaben im Fenster (nur Anzahl: Bewegung / Aktion, nie Inhalt)
  const P = game.players;
  f.slots = P.map((p) => p.id);
  f.verbunden = P.map((p) => !!p.connected);
  f.zone = P.map((p) => (p.zone == null ? null : String(p.zone)));
  f.konsole = P.map((p) => p.console || null);
  f.station = P.map((p) => (p.console ? p.station || p.console : null));
  f.ein_bew = P.map((p) => { const e = s.ein.get(p.id); return e ? e.bew : 0; });
  f.ein_akt = P.map((p) => { const e = s.ein.get(p.id); return e ? e.akt : 0; });
  s.ein = new Map();
  // Boden: Schild, Wunden, Deckung, Positionen (ganze Kacheln); Gegner: Zahl, Positionen (nur bis 16, sonst nur die Abstaende), Abstaende zueinander
  f.b_schild = P.map((p) => (p.zone === 'away' && p.shield ? p.shield.seg : null));
  f.b_wunden = P.map((p) => (p.zone === 'away' && p.wunden ? p.wunden.n : null));
  f.b_liegt = P.map((p) => (p.zone === 'away' ? !!p.downed : null));
  f.b_cv = P.map((p) => (p.zone === 'away' ? p.cv | 0 : null));
  f.b_geduckt = P.map((p) => (p.zone === 'away' ? !!p.crouch : null));
  f.b_sp = []; for (const p of P) { if (p.zone === 'away') f.b_sp.push(kachel(p.x), kachel(p.y)); else f.b_sp.push(null, null); }
  const aw = game.away;
  const gg = aw && aw.drones ? aw.drones.filter((e) => e.alive !== false) : [];
  const hier = P.some((p) => p.zone === 'away');
  f.b_gg = hier ? gg.length : null;
  f.b_gg_duck = hier ? gg.reduce((n, e) => n + (e.crouch ? 1 : 0), 0) : null;
  let dmin = null, nnSum = 0;
  if (hier && gg.length > 1) {
    for (let i = 0; i < gg.length; i++) {
      let nn = Infinity;
      for (let j = 0; j < gg.length; j++) if (i !== j) { const dd = Math.hypot(gg[i].x - gg[j].x, gg[i].y - gg[j].y) / TILE; if (dd < nn) nn = dd; }
      nnSum += nn; if (dmin === null || nn < dmin) dmin = nn;
    }
  }
  f.b_gg_abst_min = dmin === null ? null : r1(dmin);   // kleinster Abstand eines Gegners zu seinem naechsten Nachbarn (Kacheln)
  f.b_gg_abst_nn = dmin === null ? null : r1(nnSum / gg.length);   // mittlerer Abstand zum naechsten Nachbarn
  if (hier && gg.length && gg.length <= 16) { f.b_gg_pos = []; for (const e of gg) f.b_gg_pos.push(kachel(e.x), kachel(e.y)); } else f.b_gg_pos = null;
  game.telemetrie.ereignis('zeitreihe', f);
}

module.exports = { FENSTER, deckungSpielerAlle, deckungGegner, konsole, reparaturGelungen, zoneWieder, loeschen, buchung, ruf, energie, eingabe, fehler, spielleiterWarten, tickEnde };
