'use strict';
// TEL-01 B2: Haken fuer Deckung, Menschen, Wirtschaft, Technik und die Zeitreihe. Alle Funktionen hier LESEN nur Spielzustand und schreiben
// ueber game.telemetrie.ereignis (flache Felder, Positivliste); sie verbrauchen keinen Zufall, aendern nichts im Spiel und werfen nie.
// Merkzustand (war in Deckung, Konsole, Fenster der Zeitreihe) haelt DIESES Modul je Game und Session (WeakMap), nie das Spielobjekt.
// Ohne offene Session kostet jeder Haken einen Zugriff auf game.telemetrie.offen und baut nichts.
//
//   Deckung        deckungSpielerAlle(game) (aus combat.updateVisibility), deckungGegner(game, e) (aus squad.updateEnemyCrouch), deckungsZustand(game, k)
//   Konsole        konsole(game, p, rein, grund)                     Ereignis 'konsole' (Rolle = Konsole bzw. aktive Station)
//   Reparatur      reparaturGelungen(game, p, h), zoneWieder(game, sys, wie), loeschen(game, p, art, tx, ty); Beobachter in tickEnde
//   Wirtschaft     buchung(game, konto, art, grund, betrag, stand), ruf(game, fraktion, betrag, stand), energie(game, grund, sys, delta)
//   Technik        tickEnde(game, t0, lief) (aus Game.step), fehler(game, where), eingabe(game, p, art), spielleiterWarten(game, art, dauer, ausgang),
//                  snapshotZeit(game, ms), tickKappung(game, ms), nachgeholt(game, n) (aus der Tickschleife in server/index.js)
//   Zeitreihe      alle FENSTER Sekunden Spielzeit (tickgenau) eine Zeile 'zeitreihe' (Felder siehe schema.js)
const FENSTER = 2;   // s Spielzeit
const EPS = 1e-6;
const { TILE, r1, r2, r3, num, kachel, sektorName } = require('./hilfen.js');
const MAX_PROBEN = 512;   // Obergrenze je Fenster (Solo-Pause: Snapshots laufen weiter, die Zeit nicht)
const CODE = { ok: '0', damaged: '1', broken: '2', offline: '3' };
const REP = { flick: true, swap: true, minigame: true };   // Halteprozesse des Reparaturspiels (interior.REPAIR_KINDS)
const MAX_FEHLER_WO = 8;
const WO_OK = /^[A-Za-z0-9_:-]{1,40}$/;

const Zustaende = new WeakMap();
function neu(sitzung, game) {
  return { sitzung, naechst: game.time + FENSTER, dauern: [], u5: 0, u16: 0, u33: 0, snaps: [], kappN: 0, kappMs: 0, nachhol: 0, ein: new Map(), fehlerN: 0, fehlerWo: new Map(),
    deck: new Map(), away: game.away, rep: new Map(), eMerk: false, eE: 0, eS: 0, eW: 0 };
}
// Zustand der laufenden Session oder null (keine Session / kein Dienst). Eine neue Session beginnt mit leerem Zustand;
// beim Sessionende schliesst der Dienst die offenen Deckungszustaende (Abschluss-Haken vor session_ende).
function zust(game) {
  const t = game.telemetrie;
  if (!t || !t.offen) return null;
  let s = Zustaende.get(game);
  if (!s || s.sitzung !== t.sitzung) {
    s = neu(t.sitzung, game); Zustaende.set(game, s);
    t.beiAbschluss(() => { for (const rec of [...s.deck.values()]) deckungSchliessen(game, s, rec, 'session'); });
  }
  return s;
}
const nie = (game, f) => { try { f(); } catch (e) { try { game.countError('telemetrie-haken', e); } catch (x) { /* nie werfen */ } } };

// ---------- Deckung (2b) ----------
// ROHZUSTAND, keine Deutung ("in Deckung" macht die Auswertung): je Aenderung des Tupels eine Zeile 'deckung'.
//   Spieler: Tupel (cv, geduckt, verdeckt) – cv 0/1/2 = Deckung gegen den gefaehrlichsten sichtbaren Gegner (combat.updateVisibility), geduckt = p.crouch,
//            verdeckt = es gibt alarmierte Gegner, keiner hat Sicht, der Spieler steht an Deckung (combat.verdecktVor). Takt: updateVisibility (aiHz, 5 Hz).
//   Gegner:  Tupel (geduckt, stellung) – e.crouch (squad.updateEnemyCrouch, je Tick) und inStellung (im 5-Hz-Takt oder sofort, wenn sich geduckt aendert).
// Offen = Tupel ungleich dem Grundzustand (nichts). Der Dienst schliesst offene Zustaende mit einer letzten Zeile (Grundzustand, ende gesetzt): beim Sessionende
// ('session'), wenn die Figur den Ort wechselt bzw. die Aussenkarte endet ('ort') und wenn ein Gegner faellt oder verschwindet ('tod' / 'weg').
// deckungsZustand rechnet Spieler UND Gegner mit derselben Funktion; inDeckung ist die Kurzform daraus fuer B1 (von_deckung / ziel_deckung, siehe unten).
// Kosten: deckungGegner laeuft je Gegner und Tick, deshalb ohne Closure, ohne Objektbau und mit der teuren Stellungspruefung nur im 5-Hz-Takt (jeder 6. Tick).
const GRUND_S = '0|0|0', GRUND_G = '0|0';
const TAKT = 6;   // Ticks je Takt (30 Hz / 6 = 5 Hz, wie combat.updateVisibility mit aiHz)
let CombatMod = null, StellungMod = null;
const combat = () => CombatMod || (CombatMod = require('../sim/combat.js'));
function stellung(game, k) { try { return !!(StellungMod || (StellungMod = require('../sim/stellung.js'))).inStellung(game, k); } catch (e) { return false; } }
function deckungsZustand(game, k) {
  if (game.players.indexOf(k) >= 0) {
    const draussen = k.zone === 'away';
    return { cv: draussen ? k.cv | 0 : 0, geduckt: draussen && !!k.crouch, verdeckt: draussen && combat().verdecktVor(game, k), stellung: draussen && stellung(game, k) };
  }
  return { cv: null, geduckt: !!k.crouch, verdeckt: null, stellung: stellung(game, k) };
}
// "In Deckung" zum Zeitpunkt eines Schusses oder Treffers (B1: von_deckung / ziel_deckung) – der EINE Rechenweg fuer die Boolesche Kurzform, aus denselben Rohwerten wie
// deckungsZustand: Spieler cv > 0 (Deckung gegen den gefaehrlichsten sichtbaren Gegner), Gegner geduckt oder in einer Stellung. verdeckt (Sichtlinienpruefung je Gegner)
// gehoert nicht dazu: zu teuer fuer jeden Schuss. Ein Spieler im Offenen, der nur geduckt ist, zaehlt NICHT als in Deckung (anders als beim Gegner, dessen Ducken Teil seiner
// Stellung ist); die Roh-Felder stehen in der Zeile deckung.
function inDeckung(game, k) {
  if (game.players.indexOf(k) >= 0) return k.zone === 'away' && (k.cv | 0) > 0;
  return !!k.crouch || stellung(game, k);
}
function deckungSenden(game, k, spieler, z, ende) {
  game.telemetrie.ereignis('deckung', {
    slot: spieler ? k.id : null, gegner: spieler || k.id == null ? null : String(k.id), rolle: spieler ? null : (k.rolle || k.kind || null),
    cv: z.cv, geduckt: z.geduckt, verdeckt: z.verdeckt, flanke: spieler ? !!k.fl : null, stellung: z.stellung, x: kachel(k.x), y: kachel(k.y), ende: ende || null,
  });
}
function deckungSchliessen(game, s, rec, grund) {
  s.deck.delete(rec.schluessel);
  const z = rec.spieler ? { cv: 0, geduckt: false, verdeckt: false, stellung: false } : { cv: null, geduckt: false, verdeckt: null, stellung: false };
  deckungSenden(game, rec.k, rec.spieler, z, grund);
}
function deckungSpielerAlle(game) {
  const s = zust(game);
  if (!s) return;
  nie(game, () => {
    for (const p of game.players) {
      if (p.zone !== 'away') { const rec = s.deck.get(p.id); if (rec) deckungSchliessen(game, s, rec, 'ort'); continue; }
      const z = deckungsZustand(game, p);
      const t = z.cv + '|' + (z.geduckt ? 1 : 0) + '|' + (z.verdeckt ? 1 : 0);   // Tupel der Spieler: cv, geduckt, verdeckt (die Stellung steht nur in der Zeile)
      const alt = s.deck.get(p.id);
      if ((alt ? alt.t : GRUND_S) === t) continue;
      if (t === GRUND_S) s.deck.delete(p.id); else s.deck.set(p.id, { schluessel: p.id, k: p, spieler: true, t, g: z.geduckt });
      deckungSenden(game, p, true, z, null);
    }
  });
}
function deckungGegner(game, e) {
  const s = zust(game);
  if (!s || !e.alive) return;   // ein gefallener Gegner schliesst in tickEnde (deckungPruefen)
  const geduckt = !!e.crouch;
  const alt = s.deck.get(e);
  if (geduckt === (alt ? alt.g : false) && game.tick % TAKT !== 0) return;   // nichts geaendert und kein Takt: die Stellung wird erst im naechsten Takt geprueft
  try {
    const z = deckungsZustand(game, e);
    const t = (z.geduckt ? 1 : 0) + '|' + (z.stellung ? 1 : 0);   // Tupel der Gegner: geduckt, stellung
    if ((alt ? alt.t : GRUND_G) === t) return;
    if (t === GRUND_G) s.deck.delete(e); else s.deck.set(e, { schluessel: e, k: e, spieler: false, t, g: z.geduckt });
    deckungSenden(game, e, false, z, null);
  } catch (err) { try { game.countError('telemetrie-haken', err); } catch (x) { /* nie werfen */ } }
}
// Jeden Tick (nur wenn etwas offen ist): Gegner gefallen, Aussenkarte gewechselt, Spieler nicht mehr draussen -> Zustand schliessen; im 5-Hz-Takt auch: Gegner aus der Liste
// entfernt. Ein Eintrag darf waehrend der Map-Iteration geloescht werden (deckungSchliessen).
function deckungPruefen(game, s) {
  const aw = game.away;
  const ortWechsel = s.away !== aw;
  s.away = aw;
  if (!s.deck.size) return;
  const takt = game.tick % TAKT === 0;
  for (const rec of s.deck.values()) {
    if (rec.spieler) { if (ortWechsel || rec.k.zone !== 'away') deckungSchliessen(game, s, rec, 'ort'); continue; }
    if (!rec.k.alive) deckungSchliessen(game, s, rec, 'tod');
    else if (ortWechsel) deckungSchliessen(game, s, rec, 'ort');
    else if (takt && (!aw || !aw.drones || aw.drones.indexOf(rec.k) < 0)) deckungSchliessen(game, s, rec, 'weg');
  }
}

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
// Typ und Felder wie Paket B1 (system, zone, wie) plus durch; zone = Sektor der Lerche (bug, steuerbord, heck, backbord, mitte), wie bei zone_aus
function zoneWieder(game, sys, wie, durch) {
  const t = game.telemetrie;
  if (!t || !t.offen) return;
  nie(game, () => {
    let sektor = null;
    try { const z = require('../sim/interior.js').systemSector(sys); sektor = sektorName(z); } catch (e) { /* ohne Sektor */ }
    t.ereignis('zone_wieder', { system: String(sys).slice(0, 40), zone: sektor, wie: String(wie || '').slice(0, 20), durch: durch == null ? null : String(durch).slice(0, 10) });
  });
}
// Feuer geloescht / Leck geflickt (Halteprozess extinguish bzw. patch); raum = Raumkennung der Kachel
function loeschen(game, p, art, tx, ty) {
  const t = game.telemetrie;
  if (!t || !t.offen) return;
  nie(game, () => {
    let raum = null;
    try { const r = require('../world.js').Maps.roomAt(tx, ty); raum = r ? String(r.id) : null; } catch (e) { /* ohne Raum */ }
    t.ereignis('loeschen', { slot: p.id, art, raum });
  });
}

// ---------- Wirtschaft (5) ----------
// konto: 'marks' oder das Gut; art: 'buchung' (Wirtschaft) | 'stand' (Stand gesetzt: Anfang, Laden, Test, Debug); betrag = Aenderung, stand = danach
function buchung(game, konto, art, grund, betrag, stand) {
  const t = game.telemetrie;
  if (!t || !t.offen) return;
  nie(game, () => t.ereignis('buchung', { konto: String(konto).slice(0, 30), art, grund: grund == null ? null : String(grund).slice(0, 30), betrag: num(betrag), stand: num(stand) }));   // kaputter Wert (NaN, undefined) -> null, nie verdeckt
}
function ruf(game, fraktion, betrag, stand, grund) {
  const t = game.telemetrie;
  if (!t || !t.offen) return;
  nie(game, () => t.ereignis('ruf', { fraktion: String(fraktion).slice(0, 20), grund: grund == null ? null : String(grund).slice(0, 30), betrag: num(betrag), stand: num(stand) }));
}
// Energieverteilung: aus der Technik-Konsole (grund 'technik', mit system/delta) oder weil enforcePower gekuerzt hat (grund 'automatik', nur bei Aenderung).
// Der Verlauf steht in der Zeitreihe (r_energie).
function energie(game, grund, sys, delta) {
  const s = zust(game);
  if (!s) return;
  nie(game, () => {
    const pw = game.ship.power;   // keine Liste bauen: enforcePower laeuft jeden Tick, geschrieben wird nur bei Aenderung
    const erst = !s.eMerk;
    const gleich = !erst && s.eE === pw.engines && s.eS === pw.shields && s.eW === pw.weapons;
    s.eMerk = true; s.eE = pw.engines; s.eS = pw.shields; s.eW = pw.weapons;
    if (grund === 'automatik' && (erst || gleich)) return;   // erster Abgleich = Ausgangsstand, kein Ereignis
    let leistung = null, verbrauch = null;
    try { const sp = require('../sim/space.js'); leistung = sp.reactorOutput(game); verbrauch = sp.powerUsed(game); } catch (e) { /* ohne */ }
    game.telemetrie.ereignis('energie', { grund, system: sys || null, delta: delta == null ? null : delta, engines: pw.engines, shields: pw.shields, weapons: pw.weapons, leistung, verbrauch });
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
// Ausgang einer Spielleiter-Antwort: ok | timeout (Fehler mit Code ETIMEDOUT) | fehler (alles andere); nie die Meldung
const warteAusgang = (e) => (!e ? 'ok' : e.code === 'ETIMEDOUT' ? 'timeout' : 'fehler');
// Am Ende von Game.step: Dauer des Steps merken (t0 = performance.now() vor dem Step), Beobachter, Zeitreihe wenn das Fenster voll ist.
// lief = false: der Step hat die Spielzeit nicht weitergedreht (Solo-Pause) und zaehlt nicht als Tick.
function tickEnde(game, t0, lief) {
  const s = zust(game);
  if (!s) return;
  nie(game, () => {
    if (lief) {
      const ms = performance.now() - t0;
      if (s.dauern.length < MAX_PROBEN) s.dauern.push(ms);
      if (ms > 5) { s.u5++; if (ms > 16) { s.u16++; if (ms > 33) s.u33++; } }
    }
    reparaturBeobachten(game, s);
    deckungPruefen(game, s);
    if (lief && game.time + EPS >= s.naechst) {
      s.naechst += FENSTER; if (s.naechst <= game.time) s.naechst = game.time + FENSTER;   // zuerst weiterschieben: ein Fehler in zeile() soll sich nicht jeden Tick wiederholen
      zeile(game, s);
    }
  });
}
// Aus der Tickschleife in server/index.js (nur dort gibt es Snapshots, Broadcast und die Kappung): Dauer von Snapshot-Bau + Broadcast (ms),
// durch die 250-ms-Kappung verworfene Zeit (ms) und Ticks, die ein Intervallaufruf zusaetzlich zum ersten nachholte. Je Fenster ausgegeben.
function snapshotZeit(game, ms) {
  const s = zust(game);
  if (s && s.snaps.length < MAX_PROBEN) s.snaps.push(ms);
}
function tickKappung(game, ms) {
  const s = zust(game);
  if (s) { s.kappN++; s.kappMs += ms; }
}
function nachgeholt(game, n) {
  const s = zust(game);
  if (s) s.nachhol += n;
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
  f.tick_ueber5 = s.u5; f.tick_ueber16 = s.u16; f.tick_ueber33 = s.u33;   // Ticks ueber 5, 16, 33 ms (Tickbudget bei 30 Hz = 33 ms)
  const sn = s.snaps.sort((a, b) => a - b);
  f.snap_n = sn.length;   // Snapshot-Bau + Broadcast (nur im Server, index.js)
  f.snap_med = sn.length ? r3(sn[sn.length >> 1]) : null;
  f.snap_max = sn.length ? r3(sn[sn.length - 1]) : null;
  f.kappung_n = s.kappN;   // Aufrufe, in denen die 250-ms-Kappung Zeit verwarf
  f.kappung_ticks = r2(s.kappMs / (1000 / game.C.tickHz));   // dabei verworfene Zeit in Ticks
  f.nachhol_ticks = s.nachhol;   // Ticks, die ein Intervallaufruf zusaetzlich zum ersten nachholte
  f.fehler_n = s.fehlerN;
  f.fehler_wo = [...s.fehlerWo.keys()].slice(0, MAX_FEHLER_WO);
  s.dauern = []; s.u5 = 0; s.u16 = 0; s.u33 = 0; s.snaps = []; s.kappN = 0; s.kappMs = 0; s.nachhol = 0; s.fehlerN = 0; s.fehlerWo = new Map();
  // Raum
  f.szene = sh.scene == null ? null : String(sh.scene).slice(0, 40);
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
  f.ort = P.map((p) => (p.zone === 'ship' ? 'raum' : p.zone === 'away' ? 'boden' : null));   // wie ort in den Gefechtsereignissen (B1)
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

module.exports = { FENSTER, deckungSpielerAlle, deckungGegner, deckungsZustand, inDeckung, konsole, reparaturGelungen, zoneWieder, loeschen, buchung, ruf, energie, eingabe, fehler, spielleiterWarten, tickEnde, warteAusgang, snapshotZeit, tickKappung, nachgeholt };
