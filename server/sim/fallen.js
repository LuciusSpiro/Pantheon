'use strict';
// ITM-01 C: Fallen-Kern (Anker-Rolle `falle`, content/buehnen/anker.json). Action-Layer für Auslösen, Wirkungs-Register, Enthüllen und Scanner-Anbindung.
// Konkrete Wirkungen (Schott, Druckverlust, Selbstschussanlage) hängt Paket D über fallenWirkung ein; hier gibt es nur den Kern und den Test-Typ (nur mit --debug).
//
// Zustände (Reihenfolge = Zustandsindex für ao und Voxel-Modelle, nie ändern): verborgen, erkannt, entschaerft, ausgeloest.
//   Start: sicht passiv -> erkannt, sonst (sicht verborgen, Standard) -> verborgen (anker.js startFuer). Übergänge: verborgen -> erkannt | ausgeloest, erkannt -> entschaerft | ausgeloest.
//   entschaerft und ausgeloest sind endgültig (anker.setzen lehnt jeden Übergang heraus ab).
//
//   fallenWirkung(typ, handler)    handler(game, aw, falle, ausloeser) bei JEDEM Auslösen (genau einmal je Falle); doppelte Id wirft; -> Abmelder.
//                                  falle = { id, x, y (Kachel), px, py (Pixel, Kachelmitte), typ, sicht }; ausloeser = der Spieler (Spielerobjekt). Schaden über combat.hitPlayer(game, p, segs, source, wirkung).
//   zeitwirkung(game, aw, falle, fn)  Zeitwirkung (Dauer, Takt) über den Tick: fn(game, aw, dt, eintrag) jeden Tick; eintrag.t = Sekunden seit dem Start; false beendet. Fällt mit aw weg,
//                                  kein Snapshot-Feld (was die Clients sehen müssen, sendet der Handler als Ereignis).
//   update(game, dt)               Tick (game.safe): Zeitwirkungen, Auslöser. Liest nur die fertige Liste am aw (stand), nie die Karte.
//   ausloesen(game, aw, falle, p)  genau einmal: Zustand zuerst atomar auf ausgeloest, dann Halter abbrechen, dann Wirkung. -> true | false (schon ausgelöst/entschärft)
//   enthuellteIds(game, aw)        Ids der später enthüllten verborgenen Fallen in Enthüllungsreihenfolge (anker.ankerListe hängt sie an den Payload an)
//   nachreichen(game, aw, key, k)  Ereignis ankerEnthuellt an jeden Spieler, der die Karte hat und noch nicht alle enthüllten Anker kennt (aus Game.syncAwayMaps)
//   debugFalletest(game, p, args)  Debug `falletest [typ] [sicht]`
//
// Enthüllen: eine verborgene Falle steht NICHT im awayMap-Payload. Wird sie erkannt (Scanner ab CONFIG.anker.falle.position) oder löst sie aus, kommt sie als Ereignis
//   ankerEnthuellt { map, kv, i, anker: [id, 'falle', x, y, { typ, sicht }] } an die Clients der Karte; i = ankerIdx (Position in der Client-Ankerliste: Payload-Anker, dann Enthüllte in
//   Reihenfolge des Eintreffens), der Client hängt an. Details in CONTRACT-B2.md (ITM-01 C).
const W = require('../world.js');
const Physics = require('../../shared/physics.js');
const CONFIG = require('../../shared/config.js');
const Anker = require('./anker.js');
const Scanbar = require('./scanbar.js');

const TILE = Physics.TILE;
const EVT_ENTHUELLT = 'ankerEnthuellt';
const AKTIV = (z) => z === 'verborgen' || z === 'erkannt';
// erlaubte Übergänge (Zustandsmaschine); alles andere lehnt anker.setzen ab
const UEBERGAENGE = { verborgen: ['erkannt', 'ausgeloest'], erkannt: ['entschaerft', 'ausgeloest'], entschaerft: [], ausgeloest: [] };
function uebergangErlaubt(von, nach) { return !!UEBERGAENGE[von] && UEBERGAENGE[von].includes(nach); }

const wirkungen = new Map();   // typ -> handler
function fallenWirkung(typ, handler) {
  if (typeof typ !== 'string' || !typ) throw new Error('fallenWirkung: Typ fehlt');
  if (typeof handler !== 'function') throw new Error('fallenWirkung: Handler fehlt (' + typ + ')');
  if (wirkungen.has(typ)) throw new Error('fallenWirkung: Typ bereits angemeldet (' + typ + ')');
  wirkungen.set(typ, handler);
  return () => { if (wirkungen.get(typ) === handler) wirkungen.delete(typ); };
}

// ---------- Stand je Außenkarte (fertige Liste, kein Neuaufbau aus der Karte im Tick) ----------
let EPOCHE = 0;
const staende = new WeakMap();   // Außenkarte (aw) -> { ep, liste, byId, enth, laufend }: fällt mit aw weg (Kartenwechsel/Entladen)
function karteVon(map) { const e = W.AWAY_MAPS[map]; return e && e.karte && Array.isArray(e.karte.rows) ? e.karte : null; }
const zustandVon = (aw, f) => (aw.zustaende && aw.zustaende[f.id]) || f.start;
function eintragAus(a) {
  return { id: a.id, x: a.x, y: a.y, px: a.x * TILE + TILE / 2, py: a.y * TILE + TILE / 2, typ: a.typ || null, sicht: a.sicht === 'passiv' ? 'passiv' : 'verborgen', start: Anker.startFuer(a) };
}
function bauen(aw) {
  const k = karteVon(aw.map);
  const liste = k ? k.anker.filter((a) => a.rolle === 'falle').map(eintragAus) : [];
  const s = { ep: ++EPOCHE, liste, byId: new Map(liste.map((f) => [f.id, f])), enth: [], laufend: [] };
  // aus dem Weltstand geladene Karte: verborgen gestellte Fallen, die nicht mehr verborgen sind, waren enthüllt (Reihenfolge der Karte)
  for (const f of liste) if (f.sicht === 'verborgen' && zustandVon(aw, f) !== 'verborgen') s.enth.push(f.id);
  return s;
}
function stand(game, aw) { let s = staende.get(aw); if (!s) { s = bauen(aw); staende.set(aw, s); } return s; }
function enthuellteIds(game, aw) { return stand(game, aw).enth; }

// Hook aus anker.setzen: eine verborgen gestellte Falle ist nicht mehr verborgen -> Enthüllen merken (Versand in nachreichen)
function beiZustand(game, aw, a, z) {
  if (z === 'verborgen') return;
  const s = stand(game, aw);
  const f = s.byId.get(a.id);
  if (f && f.sicht === 'verborgen' && !s.enth.includes(f.id)) s.enth.push(f.id);
}

function nachreichen(game, aw, key, k) {
  const s = stand(game, aw);
  if (!s.liste.length) return;
  const basis = Anker.payloadAnker(k).length;
  for (const p of game.players) {
    if (!p.connected || !p.conn || p.awayKv !== key) continue;
    let rec = p.awayEnth && p.awayEnth[aw.map];
    if (!rec) rec = ((p.awayEnth || (p.awayEnth = {}))[aw.map] = { ep: -1, n: 0 });
    // Außenkarte wurde neu aufgebaut (Entladen/Neubau), der Client hat schon Enthüllte in anderer Reihenfolge: Payload neu senden, dann von vorn
    if (rec.ep !== s.ep) {
      if (rec.ep !== -1 && rec.n > 0) { game.sendAwayMap(p, aw.map); rec = p.awayEnth[aw.map]; }
      rec.ep = s.ep;
    }
    while (rec.n < s.enth.length) {
      const f = s.byId.get(s.enth[rec.n]);
      const a = f && k.anker.find((q) => q.id === f.id);
      if (a) game.sendTo(p.conn, { t: 'event', kind: EVT_ENTHUELLT, map: aw.map, kv: key.slice(aw.map.length + 1), i: basis + rec.n, anker: game.ankerZeile(a) });
      rec.n++;
    }
  }
}

// ---------- Auslösen ----------
const meldung = (game, p, text) => { if (game.notice && p) game.notice(p, text); };
function radius(game, typ) {
  const R = (game.C && game.C.anker && game.C.anker.falle && game.C.anker.falle.radius) || { standard: 0.6 };
  return (R[typ] != null ? R[typ] : R.standard) * TILE;
}

function ausloesen(game, aw, f, p) {
  if (!f || !AKTIV(zustandVon(aw, f))) return false;   // zweite Prüfung im selben Tick/Zweiter Spieler: schon ausgelöst oder entschärft
  const err = Anker.setzen(game, aw.map, f.id, 'ausgeloest', p ? p.id : null);   // atomar: erst der Zustand, dann alles andere
  if (err) { if (game.countError) game.countError('falle-ausloesen', new Error(err)); return false; }
  for (const q of game.players) {   // wer gerade entschärfte, kommt zu spät (holdValid bräche auch ab, die Meldung erklärt es)
    if (q.hold && q.hold.kind === 'anker:falle' && q.hold.anker === f.id) { q.hold = null; meldung(game, q, 'Zu spät – die Falle ist ausgelöst.'); }
  }
  game.missionEvent('falleAusgeloest', { map: aw.map, anker: f.id, typ: f.typ, pid: p ? p.id : null });
  const h = wirkungen.get(f.typ);
  if (h) { try { h(game, aw, f, p || null); } catch (e) { if (game.countError) game.countError('falle-wirkung-' + f.typ, e); } }
  return true;
}

function zeitwirkung(game, aw, f, fn) {
  if (typeof fn !== 'function') throw new Error('zeitwirkung: Funktion fehlt');
  const e = { id: f.id, t: 0, fn };
  stand(game, aw).laufend.push(e);
  return e;
}

// Tick: Zeitwirkungen, dann Auslöser. Gegner lösen nichts aus (gleiche Regeln für alle: Fallen treffen nur Spieler, Kai).
function update(game, dt) {
  const aw = game.away; if (!aw) return;
  const s = stand(game, aw);
  if (s.laufend.length) {
    for (const e of s.laufend.slice()) {
      e.t += dt;
      let weiter = false;
      try { weiter = e.fn(game, aw, dt, e) !== false; } catch (x) { if (game.countError) game.countError('falle-zeitwirkung', x); }
      if (!weiter) { const i = s.laufend.indexOf(e); if (i >= 0) s.laufend.splice(i, 1); }
    }
  }
  if (!s.liste.length) return;
  for (const f of s.liste) {
    if (!AKTIV(zustandVon(aw, f))) continue;
    const r = radius(game, f.typ);
    for (const p of game.players) {
      if (p.zone !== 'away' || p.connected === false || p.downed || p.beamLock) continue;
      if (Math.hypot(p.x - f.px, p.y - f.py) > r) continue;
      ausloesen(game, aw, f, p);
      break;
    }
  }
}

// ---------- Scanner-Anbindung (SCA-01): nur verborgene und erkannte Fallen, aus der fertigen Liste ----------
function zieleFuer(game, aw) {
  const s = stand(game, aw);
  const out = [];
  for (const f of s.liste) if (AKTIV(zustandVon(aw, f))) out.push({ id: f.id, x: f.px, y: f.py, typ: f.typ || 'unbekannt' });
  return out;
}
// Scanstufe >= position: die Falle wird erkannt (verborgen -> erkannt, setzen merkt das Enthüllen). Passive Fallen sind schon erkannt.
function beiPosition(game, aw, z, p) {
  const f = stand(game, aw).byId.get(z.id);
  if (f && zustandVon(aw, f) === 'verborgen') Anker.setzen(game, aw.map, f.id, 'erkannt', p ? p.id : null);
}
Scanbar.scanbarAnmelden('falle', { ziele: zieleFuer, tiefen: { position: CONFIG.anker.falle.position }, beiPosition });

// ---------- Test-Typ (nur mit game.debug) ----------
fallenWirkung('test', (game, aw, f, p) => { if (game.debug) meldung(game, p, 'Falle ausgelöst (Test): ' + f.id + '.'); });

// Liste der Außenkarte neu aufbauen lassen (nach Änderung der Fallen-Anker der Karte: Debug, Messwerkzeuge); der nächste Zugriff baut sie aus der Karte
function standVerwerfen(aw) { staende.delete(aw); }

// Debug `falletest [typ] [sicht]`: ohne sicht je eine verborgene und eine passive Test-Falle neben dem Spieler, mit sicht nur diese. Setzt echte Anker in die gebaute Karte
// (nur Debug, die Karte fällt mit dem Entladen weg); ein zweiter Aufruf ersetzt die ersten Test-Fallen.
function debugFalletest(game, p, args) {
  if (!game.debug) return 'falletest: nur mit Server --debug.';
  const aw = game.away;
  if (p.zone !== 'away' || !aw) return 'falletest: nur am Boden.';
  const k = karteVon(aw.map);
  if (!k) return 'falletest: nur auf gebauten Karten (lp neu / arena_away).';
  const typ = args && args[0] ? String(args[0]) : 'test';
  const sichten = args && args[1] ? [String(args[1])] : ['verborgen', 'passiv'];
  if (!/^[a-z_]{1,20}$/.test(typ)) return 'falletest: Typ klein geschrieben (schott, druck, schuss, test).';
  if (sichten.some((x) => x !== 'verborgen' && x !== 'passiv')) return 'falletest: sicht verborgen | passiv.';
  const R = require('../../shared/buehne.js').raster(k);
  const mitte = Physics.toTile(p.x, p.y);
  const belegt = new Set(k.anker.map((a) => a.x + ',' + a.y));
  const ring = [[3, 0], [-3, 0], [0, 3], [0, -3], [4, 1], [-4, -1], [1, 4], [-1, -4], [3, 3], [-3, -3], [3, -3], [-3, 3], [5, 0], [-5, 0], [0, 5], [0, -5]];
  const frei = ring.map(([dx, dy]) => ({ x: mitte.x + dx, y: mitte.y + dy })).filter((t) => {
    const i = R.info(t.x, t.y);
    return i && i.kante === 'begehbar' && R.durchgang(t.x, t.y) && !belegt.has(t.x + ',' + t.y);
  });
  if (frei.length < sichten.length) return 'falletest: keine freien Kacheln in der Nähe.';
  // alte Test-Fallen entfernen (Anker, Zustand), dann neue anlegen; Stand und Payload werden neu aufgebaut
  k.anker = k.anker.filter((a) => !/^falle\.test\d+$/.test(a.id));
  for (const id of Object.keys(aw.zustaende || {})) if (/^falle\.test\d+$/.test(id)) delete aw.zustaende[id];
  sichten.forEach((sicht, i) => { const t = frei[i]; k.anker.push({ id: 'falle.test' + (i + 1), rolle: 'falle', x: t.x, y: t.y, typ, sicht }); });
  standVerwerfen(aw);
  for (const q of game.players) { q.awayKv = null; if (q.awayEnth) delete q.awayEnth[aw.map]; }   // Karte neu senden (Payload ändert sich)
  meldung(game, p, 'falletest: ' + sichten.map((sicht, i) => 'falle.test' + (i + 1) + ' (' + typ + ', ' + sicht + ') bei ' + frei[i].x + '/' + frei[i].y).join('; ') + '.');
  return null;
}

module.exports = { fallenWirkung, zeitwirkung, update, ausloesen, standVerwerfen, uebergangErlaubt, beiZustand, enthuellteIds, nachreichen, debugFalletest, UEBERGAENGE, EVT_ENTHUELLT };
