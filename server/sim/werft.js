'use strict';
// PAN-01 Paket D: Werft einer Flottenbasis (Freischalten, Umbauen, Vorschau, Snapshot-Block). Serverseitig, jeder Spieler am Terminal darf (kein Rollen- oder Captain-Vorbehalt).
//
//   Freischalten  kostet einmalig Marken (CONFIG.werft.preise) und gehört dann dem Schiff dauerhaft: Ausbaustufe (der Reihe nach, gilt sofort), Waffentyp, Modul.
//   Umbauen       kostet nichts: Waffe auf einen offenen Platz (Bug, Seite, Heck laut Katalog), Modul in einen offenen Modulraum (auch mehrfach), nur Freigeschaltetes.
//   Beides nur angedockt an einer Flottenbasis (Ortsfeld `flottenbasis`, oder Flag am Weltstand: mission.flags['flottenbasis_<ort>'], das ein späteres Modul setzt).
//   Kein Rückgabe- oder Verkaufsweg. Der Handel (shop.js) läuft überall wie bisher.
//
//   game.ship.freigeschaltet = { stufe, waffen: [Katalog-ids], module: [ids] }   (Weltstand schiff.freigeschaltet; fehlt es, wird es aus dem Schiff abgeleitet)
//
// Antworten: null bei Erfolg, sonst { code, text } (Codes: werftCodes unten). Jeder Befehl läuft im Tick nacheinander (Einzel-Thread): prüfen, dann buchen und ändern,
// ohne dass dazwischen ein zweiter Befehl liegen kann; ein zweiter gleichzeitiger Kauf desselben Teils scheitert an `schon_freigeschaltet`.
const W = require('../world.js');
const Locations = require('../../shared/locations.js');
const Sektoren = require('../../shared/sektoren.js');
const Besitz = require('./besitz.js');   // SUND-02b A1: Stützpunkt der Crew
const Katalog = require('../../shared/schiffskatalog.js');
const Geld = require('./geld.js');
const Modul = require('./module.js');
const Ausbau = require('./ausbau.js');
const Waffen = require('./schiffswaffen.js');

const Maps = W.Maps;
const cfg = (game) => game.C.werft;
const FLAGGE = 'flottenbasis_';   // mission.flags[FLAGGE + ort] = true: Flottenstützpunkt, den das Spiel erst baut (Hinweis Paket 2, Kai 2026-10-18)

const fehler = (code, text) => ({ code, text });
const ART_NAME = { stufe: 'Ausbaustufe', waffe: 'Waffe', modul: 'Modul' };
const MODUL_NAMEN = Katalog.MODUL_NAMEN;
function teilName(art, id) { return art === 'waffe' ? ((Katalog.waffe(id) || {}).name || id) : art === 'modul' ? (MODUL_NAMEN[id] || id) : `Ausbaustufe ${id}`; }

// ---------- Ort ----------
function istFlottenbasis(game, ortId) {
  if (!ortId) return false;
  const loc = Locations.get(ortId);
  if (loc && loc.flottenbasis) return true;
  // SUND-02b A1: dritte, abgeleitete (nie gespeicherte) Prüfung: der Ort liegt in einem Hex mit Stützpunkt der Crew (Overlay posten, Besitzer Rom, crew). Fällt der Posten, ist die Werft sofort weg;
  // Freigeschaltetes bleibt (ship.freigeschaltet), nur der Umbau braucht die Werft. Kein setzeFlottenbasis: das Flag würde gespeichert und bliebe nach dem Verlust.
  const hex = loc && (loc.hex || Sektoren.hexVonOrt(ortId));
  if (hex && Besitz.crewPosten(game, hex)) return true;
  const fl = game.mission && game.mission.flags;
  return !!(fl && fl[FLAGGE + ortId]);
}
// Flag für einen Ort setzen (Weltsimulation, Paket 2: Flottenstützpunkte, die erst im Spiel entstehen). Wird mit den Missions-Flags gespeichert.
function setzeFlottenbasis(game, ortId, an) { if (game.mission && game.mission.flags) game.mission.flags[FLAGGE + ortId] = an !== false; }
// Testumgebung (Kai 2026-10-22): Testgelände, Wellen All, Wellen Boden und Szenario-Labor (game.arena bzw. game.labor; reset() leert beide, Kampagne und freies Spiel haben sie nie).
// Dort ist die Werft immer aktiv, auch abgedockt, und die Crew bekommt CONFIG.werft.testmarken.
function testumgebung(game) { return !!(game.arena || game.labor); }
// { aktiv, grund?, code? }: aktiv nur angedockt an einer Flottenbasis (Kampagne, freies Spiel) – oder in der Testumgebung überall (test: true, grund „Testumgebung“)
function status(game) {
  if (testumgebung(game)) return { aktiv: true, test: true, grund: 'Testumgebung' };
  if (!game.ship.docked || !game.ship.dockedAt) return { aktiv: false, code: 'nicht_angedockt', grund: 'Nicht angedockt' };
  if (!istFlottenbasis(game, game.ship.dockedAt)) return { aktiv: false, code: 'keine_flottenbasis', grund: 'Nur an Flottenbasen' };
  return { aktiv: true };
}
function ortPruefen(game) { const s = status(game); return s.aktiv ? null : fehler(s.code, s.grund + (s.code === 'nicht_angedockt' ? ': Die Werft arbeitet nur angedockt an einer Flottenbasis.' : ': Dieser Hafen baut nicht um.')); }

// ---------- Freigeschaltet ----------
function startFrei(game) {
  return { stufe: 0, waffen: Object.values(Katalog.START_BESTUECKUNG).filter((v, i, a) => a.indexOf(v) === i), module: (game.C.module.start || []).map((m) => m.id).filter((v, i, a) => a.indexOf(v) === i) };
}
function liste(game) { return game.ship.freigeschaltet || (game.ship.freigeschaltet = startFrei(game)); }
function istFrei(game, art, id) {
  const f = liste(game);
  if (art === 'stufe') return f.stufe >= Number(id);
  return art === 'waffe' ? f.waffen.includes(id) : f.module.includes(id);
}
const hat = (o, k) => !!o && typeof k !== 'object' && Object.prototype.hasOwnProperty.call(o, k);
function preis(game, art, id) { const P = cfg(game).preise; const t = hat(P, art) ? P[art] : null; return hat(t, id) ? t[id] : null; }
// Alles, was die Werft verkauft: [{ art, id }] (Stufen 1..STUFE_MAX, Waffen und Module des Katalogs mit Preis)
function sortiment(game) {
  const out = [];
  for (let n = 1; n <= Maps.STUFE_MAX; n++) out.push({ art: 'stufe', id: n });
  for (const w of Katalog.WAFFEN) out.push({ art: 'waffe', id: w.id });
  for (const id of game.C.module.ids) out.push({ art: 'modul', id });
  return out;
}

// Altstand und Debug: was am Schiff steckt, gilt als freigeschaltet (nichts geht verloren, keine Erstattung); idempotent
function ableiten(game) {
  const f = liste(game);
  f.stufe = Math.max(f.stufe | 0, game.ship.stufe | 0);
  for (const id of Object.values(Waffen.waffenMap(game))) if (Katalog.waffe(id) && !f.waffen.includes(id)) f.waffen.push(id);
  for (const m of Modul.liste(game)) if (!f.module.includes(m.id)) f.module.push(m.id);
  return f;
}

// ---------- Freischalten ----------
function freischaltenPruefen(game, art, id) {
  if (art === 'stufe') {
    const n = Number(id);
    if (!Number.isInteger(n) || n < 1 || n > Maps.STUFE_MAX) return fehler('unbekannt', `Unbekannte Ausbaustufe (1–${Maps.STUFE_MAX}).`);
    id = n;
  } else if (art === 'waffe') { if (!Katalog.waffe(String(id))) return fehler('unbekannt', 'Unbekannte Waffe.'); }
  else if (art === 'modul') { if (!game.C.module.ids.includes(String(id))) return fehler('unbekannt', 'Unbekanntes Modul.'); }
  else return fehler('unbekannt', 'Unbekannte Art (stufe, waffe, modul).');
  const name = teilName(art, id);
  if (istFrei(game, art, id) && !(art === 'stufe' && id > (game.ship.stufe | 0))) return fehler('schon_freigeschaltet', `${name} ist schon freigeschaltet.`);
  if (art === 'stufe' && !istFrei(game, art, id) && id !== liste(game).stufe + 1) return fehler('stufe_reihenfolge', `Ausbaustufen nur der Reihe nach: erst Stufe ${liste(game).stufe + 1}.`);
  const p = art === 'stufe' && istFrei(game, art, id) ? 0 : preis(game, art, id);
  if (p == null) return fehler('unbekannt', `${name} steht nicht zum Verkauf.`);
  const bed = rufBedingung(game, art, id);
  if (bed) return bed;
  if (!Geld.mindestens(game, p)) return fehler('zu_wenig_marken', `Nicht genug Marken (${name} kostet ${p}).`);
  return null;
}
// Ruf-Feld an Ausbaustufen (Hinweis Paket 2): CONFIG.werft.ruf.stufe[n] = Rang-Id, Standard keine Bedingung. Das Ruf-System liefert game.rufErreicht(rang); ohne
// das System (PAN-01) gilt jede Bedingung als erfüllt und nichts wird angezeigt.
function rufBedingung(game, art, id) {
  const r = art === 'stufe' && cfg(game).ruf && cfg(game).ruf.stufe ? cfg(game).ruf.stufe[id] : null;
  if (!r || typeof game.rufErreicht !== 'function' || game.rufErreicht(r)) return null;
  return fehler('ruf', `Dafür fehlt der Rang (${r}).`);
}
function freischalten(game, p, art, id) {
  const e = ortPruefen(game) || freischaltenPruefen(game, art, id);
  if (e) return e;
  if (art === 'stufe') id = Number(id); else id = String(id);
  // gekaufte Stufe, die das Schiff noch nicht trägt (Debug, Altstand): anwenden kostet nichts
  const kosten = art === 'stufe' && istFrei(game, art, id) ? 0 : preis(game, art, id);
  if (!Geld.abbuchen(game, kosten, 'werft')) return fehler('zu_wenig_marken', 'Nicht genug Marken.');
  const f = liste(game);
  if (art === 'stufe') { f.stufe = Math.max(f.stufe, id); Ausbau.setStufe(game, Math.max(game.ship.stufe | 0, id)); }   // das Schiff fällt nie auf eine niedrigere Stufe zurück (Debug ausbau)
  else if (art === 'waffe') f.waffen.push(id);
  else f.module.push(id);
  game.emit('sfx', { name: 'buy' });
  if (game.markSaveDue) game.markSaveDue('docked');   // Kauf und Umbau nicht verlieren: Weltstand am Tick-Ende speichern (sonst erst im 10-s-Takt)
  game.emit('werft', { op: 'freigeschaltet', art, id, marks: kosten, pid: p ? p.id : null });
  return null;
}

// ---------- Umbauen ----------
// strikt = false prüft nur die Geometrie (Vorschau): Platz, Stufe, Platzart, Modulraum, Fracht – ohne Ort und Besitz
function umbauPruefen(game, platz, waffe, strikt) {
  platz = Number(platz);
  if (!Katalog.PLATZ[platz]) return fehler('platz_unbekannt', 'Unbekannter Platz (1–9).');
  const leer = waffe == null || waffe === 'leer';
  const w = leer ? null : Katalog.waffe(String(waffe));
  if (!leer && !w) return fehler('unbekannt', 'Unbekannte Waffe.');
  const pl = Maps.waffenplatz(platz);
  if (!Ausbau.platzOffen(game, platz)) return fehler('platz_gesperrt', `Platz ${platz} ist noch gesperrt (Ausbaustufe ${pl.stufe} nötig).`);
  const art = Katalog.PLATZ[platz].art;
  if (w && !Katalog.passtAuf(w.id, platz)) return fehler('platzart', `${w.name} ist eine ${w.platzart}-Waffe, Platz ${platz} ist ein ${art}-Platz.`);
  if ((Waffen.waffenMap(game)[platz] || null) === (leer ? null : w.id)) return fehler('unveraendert', leer ? `Platz ${platz} ist schon leer.` : `Dort sitzt schon: ${w.name}.`);
  if (strikt && w && !istFrei(game, 'waffe', w.id)) return fehler('nicht_freigeschaltet', `${w.name} ist noch nicht freigeschaltet.`);
  return null;
}
function umbau(game, p, platz, waffe) {
  const e = ortPruefen(game) || umbauPruefen(game, platz, waffe, true);
  if (e) return e;
  platz = Number(platz);
  const leer = waffe == null || waffe === 'leer';
  const r = Waffen.umruesten(game, platz, leer ? null : String(waffe));   // prüft Platzart und Stufe noch einmal, setzt die Ladepunktverteilung zurück, behält den Systemzustand des Platzes (kein Gratis-Reparieren)
  if (r) return fehler('umbau', r);
  game.emit('sfx', { name: 'drop' });
  if (game.markSaveDue) game.markSaveDue('docked');
  game.emit('werft', { op: 'umbau', art: 'waffe', platz, id: leer ? null : String(waffe), pid: p ? p.id : null });
  return null;
}

function modulPruefen(game, raum, id, strikt) {
  raum = Number(raum);
  const C = game.C.module;
  if (!Number.isInteger(raum) || raum < 1 || raum > C.max) return fehler('raum_unbekannt', `Unbekannter Modulraum (1–${C.max}).`);
  const leer = id == null || id === 'leer';
  if (!leer && !C.ids.includes(String(id))) return fehler('unbekannt', 'Unbekanntes Modul.');
  const r = Maps.MODUL_RAEUME.find((q) => q.raum === raum);
  if (!Maps.modulRaeumeOffen(game.ship.stufe | 0).includes(raum)) return fehler('raum_gesperrt', `Modulraum ${raum} ist noch gesperrt (Ausbaustufe ${r ? r.stufe : '?'} nötig).`);
  const cur = Modul.liste(game).find((m) => m.raum === raum) || null;
  if ((cur ? cur.id : null) === (leer ? null : String(id))) return fehler('unveraendert', leer ? `Modulraum ${raum} ist schon leer.` : `In Modulraum ${raum} steht schon: ${MODUL_NAMEN[id] || id}.`);
  if (strikt && !leer && !istFrei(game, 'modul', String(id))) return fehler('nicht_freigeschaltet', `${MODUL_NAMEN[id] || id} ist noch nicht freigeschaltet.`);
  // ein Frachtraum geht nur, wenn die Ladung danach noch Platz hat (sonst hinge Fracht in einem leeren Raum)
  if (cur && cur.id === 'frachtraum' && (leer || String(id) !== 'frachtraum')) {
    const Fracht = require('./fracht.js');
    // Personen liegen in Betten ihres Frachtraums (Bettschlüssel (Raum − 1) × 2 + 0/1, personen-bord.js): ein Raum mit liegender Person bleibt
    const imRaum = Fracht.state(game).lager.some((l) => l.art === 'person' && Number.isInteger(l.bett) && l.bett >= (raum - 1) * 2 && l.bett <= (raum - 1) * 2 + 1);
    if (imRaum) return fehler('person_im_raum', `Im Frachtraum (Modulraum ${raum}) liegt eine Person: erst abgeben.`);
    const rest = Modul.frachtRaeume(game).filter((q) => q !== raum);
    if (Fracht.anBord(game) > Maps.cargoCapacity(rest)) return fehler('fracht_belegt', `Im Frachtraum liegt noch Ladung (${Fracht.anBord(game)} Plätze belegt, danach nur ${Maps.cargoCapacity(rest)}): erst abliefern oder abwerfen.`);
  }
  return null;
}
function modul(game, p, raum, id) {
  const e = ortPruefen(game) || modulPruefen(game, raum, id, true);
  if (e) return e;
  raum = Number(raum);
  const leer = id == null || id === 'leer';
  const cur = Modul.liste(game).find((m) => m.raum === raum) || null;
  if (cur) Modul.entfernen(game, cur.id, raum);
  if (!leer) { const r = Modul.bestuecken(game, String(id), raum); if (r) { if (cur) Modul.bestuecken(game, cur.id, raum); return fehler('umbau', r); } }
  Modul.verteilungSetzen(game);   // Energieverteilung der Hauptsysteme auf die neue Modulzahl (wie Debug modul bau/weg)
  game.emit('sfx', { name: 'drop' });
  if (game.markSaveDue) game.markSaveDue('docked');
  game.emit('werft', { op: 'umbau', art: 'modul', raum, id: leer ? null : String(id), pid: p ? p.id : null });
  return null;
}

// ---------- Vorschau (rein berechnet, nichts am Schiff ändert sich) ----------
// aenderung: { art: 'waffe', platz, id | 'leer' } | { art: 'modul', raum, id | 'leer' } | { art: 'stufe', id }
// -> { moeglich, code?, text?, kosten, frei, vorher, nachher }; vorher/nachher je:
//    energie { reaktor, module (Zahl der Module an), frei, engines, shields, weapons }, ladepunkte, alloc { Platz: Punkte } (Standardverteilung der Ladepunkte),
//    seiten { Bb: [{ platz, id }], Stb, vorn, Heck } (Bestückung), module [{ raum, id }]
// „vorher“ ist der Ist-Zustand des Schiffs, „nachher“ der Zustand, der mit Standardverteilung entsteht (wie nach dem echten Umbau: Waffen.verteilungZuruecksetzen, Modul.verteilungSetzen).
function modell(game, stufe, waffenMap, moduleListe, power) {
  const C = game.C;
  const an = moduleListe.filter((m) => m.an !== false).length;
  const frei = Math.max(0, C.power.reactor - an * C.module.energie);
  const pw = power || Modul.standardVerteilung(game, frei);
  const cp = pw.weapons > 0 ? pw.weapons + 2 : 0;   // wie Waffen.chargePoints
  const fake = { C, ship: { stufe, waffen: waffenMap } };
  const std = Waffen.standardVerteilung(fake, cp);
  const alloc = {};
  for (const id of Object.keys(std)) alloc[Katalog.platzVonMount(id)] = std[id];
  const seiten = { Bb: [], Stb: [], vorn: [], Heck: [] };
  for (const a of Waffen.ausstattung(fake)) seiten[Katalog.PLATZ[a.platz].seite].push({ platz: a.platz, id: a.w.id });
  for (const k of Object.keys(seiten)) seiten[k].sort((x, y) => x.platz - y.platz);
  return {
    energie: { reaktor: C.power.reactor, module: an, frei, engines: pw.engines, shields: pw.shields, weapons: pw.weapons },
    ladepunkte: cp, alloc, seiten, module: moduleListe.map((m) => ({ raum: m.raum, id: m.id })),
  };
}
function istZustand(game) {
  const s = game.ship;
  const wm = Object.assign({}, Waffen.waffenMap(game));
  const pw = { engines: s.power.engines, shields: s.power.shields, weapons: s.power.weapons };
  const m = modell(game, s.stufe | 0, wm, Modul.liste(game).map((q) => ({ raum: q.raum, id: q.id, an: q.an })), pw);
  const wa = Waffen.computeAlloc(game);   // tatsächliche Verteilung (Besetzung, Wunsch) statt Standard
  m.alloc = {}; for (const id of Object.keys(wa)) m.alloc[Katalog.platzVonMount(id)] = wa[id];
  return m;
}
function vorschau(game, aenderung) {
  const a = aenderung || {};
  const art = a.art;
  let fehlerHier = null; let kosten = 0; let frei = true;
  const s = game.ship;
  let stufe = s.stufe | 0; const wm = Object.assign({}, Waffen.waffenMap(game));
  let mods = Modul.liste(game).map((q) => ({ raum: q.raum, id: q.id, an: q.an }));
  const vorher = istZustand(game);
  if (art === 'waffe') {
    fehlerHier = umbauPruefen(game, a.platz, a.id, false);
    if (!fehlerHier) { const leer = a.id == null || a.id === 'leer'; if (leer) delete wm[Number(a.platz)]; else wm[Number(a.platz)] = String(a.id); frei = leer || istFrei(game, 'waffe', String(a.id)); kosten = frei ? 0 : (preis(game, 'waffe', String(a.id)) || 0); }
  } else if (art === 'modul') {
    fehlerHier = modulPruefen(game, a.raum, a.id, false);
    if (!fehlerHier) {
      const leer = a.id == null || a.id === 'leer'; const raum = Number(a.raum);
      mods = mods.filter((q) => q.raum !== raum);
      if (!leer) { mods.push({ raum, id: String(a.id), an: true }); mods.sort((x, y) => x.raum - y.raum); }
      frei = leer || istFrei(game, 'modul', String(a.id)); kosten = frei ? 0 : (preis(game, 'modul', String(a.id)) || 0);
    }
  } else if (art === 'stufe') {
    const n = Number(a.id);
    if (!Number.isInteger(n) || n < 1 || n > Maps.STUFE_MAX) fehlerHier = fehler('unbekannt', `Unbekannte Ausbaustufe (1–${Maps.STUFE_MAX}).`);
    else if (n <= stufe) fehlerHier = fehler('unveraendert', `Das Schiff ist schon auf Stufe ${stufe}.`);
    else { stufe = n; frei = istFrei(game, 'stufe', n); kosten = frei ? 0 : (preis(game, 'stufe', n) || 0); }
  } else fehlerHier = fehler('unbekannt', 'Unbekannte Art (stufe, waffe, modul).');
  if (fehlerHier) return { moeglich: false, code: fehlerHier.code, text: fehlerHier.text, kosten: 0, frei: true, vorher, nachher: vorher };
  // Waffenwechsel lässt die Energieverteilung der Hauptsysteme stehen; Modulwechsel und Stufe setzen die Standardverteilung (Modul.verteilungSetzen)
  const nachher = modell(game, stufe, wm, mods, art === 'waffe' ? { engines: s.power.engines, shields: s.power.shields, weapons: s.power.weapons } : null);
  // Ausführbar jetzt (Ort, Besitz, Marken)? Für die Taste „Bestätigen“ / „Freischalten“ im Terminal.
  let jetzt = ortPruefen(game);
  if (!jetzt) {
    if (art === 'waffe') jetzt = umbauPruefen(game, a.platz, a.id, true);
    else if (art === 'modul') jetzt = modulPruefen(game, a.raum, a.id, true);
    else jetzt = freischaltenPruefen(game, 'stufe', a.id);
  }
  // Waffe oder Modul, das noch gekauft werden muss: „jetzt“ meldet nicht_freigeschaltet; die Terminal-Taste ist dann Freischalten (kosten > 0)
  const out = { moeglich: true, kosten, frei, vorher, nachher };
  if (jetzt) { out.jetzt = false; out.code = jetzt.code; out.text = jetzt.text; } else out.jetzt = true;
  return out;
}

// ---------- Snapshot ----------
// Block `werft` nur, wenn jemand am Terminal (Konsole shop) sitzt: aktiv/grund, Nutzer (Spielerfarbe), Stufe, Bestückung je Platz, Freigeschaltetes,
// Preise der noch nicht freigeschalteten Teile. Namen, Wirkungstexte und Energiebedarf kommen aus dem Katalog (shared/schiffskatalog.js).
// Wer beim Ablegen am Terminal sitzen bleibt, steht auf: das Terminal gibt es nur angedockt (Block werft nie im Flug oder Kampf)
function aufstehen(game) {
  if (game.ship.docked || testumgebung(game)) return;
  for (const p of game.players) if (p.console === 'shop') require('./interior.js').leaveConsole(game, p);
}
function nutzer(game) { return game.players.find((o) => o.connected && o.console === 'shop') || null; }
// Ansicht des Nutzers am Terminal (Bereich, Platz/Raum/Stufe, gewähltes Teil), damit Zuschauer dasselbe Bild sehen: { b: 'h'|'w', a: 'p'|'m'|'s', n, i (Teil-Id), von }
function ansichtSetzen(game, p, msg) {
  const b = msg.b === 'h' ? 'h' : 'w';
  const a = msg.a === 'm' ? 'm' : msg.a === 's' ? 's' : 'p';
  const n = Math.max(0, Math.min(a === 'p' ? 9 : a === 'm' ? 4 : 3, Math.round(Number(msg.n)) || 0));
  const i = typeof msg.i === 'string' && /^[a-z_0-9]{1,24}$/.test(msg.i) ? msg.i : null;
  game.werftUi = { b, a, n, i, von: p.id };
}
function zusehenSetzen(game, p, an) {
  const u = nutzer(game);
  p.zusehen = !!an && !!u && u !== p;
}
function snapshot(game) {
  const u = nutzer(game);
  if (!u) { for (const o of game.players) o.zusehen = false; game.werftUi = null; return undefined; }
  const s = status(game);
  const f = liste(game);
  const out = { aktiv: s.aktiv, nutzer: u.color != null ? u.color : null, stufe: game.ship.stufe | 0 };
  if (s.test) { out.test = 1; out.grund = s.grund; }   // Testumgebung: aktiv, mit Grund-Text
  const zu = game.players.filter((o) => o.connected && o.zusehen && o !== u && o.color != null).map((o) => o.color);
  if (zu.length) out.zu = zu;   // Spielerfarben der Zuschauer
  if (game.werftUi && game.werftUi.von === u.id) out.ui = { b: game.werftUi.b, a: game.werftUi.a, n: game.werftUi.n, i: game.werftUi.i };
  { const hs = game.ship.docked && game.ship.dockedAt ? Besitz.handelSperre(game, Sektoren.hexVonOrt(game.ship.dockedAt)) : null; if (hs) out.hs = hs; }   // SUND-02b A1: Stützpunkt der Crew: Handel gesperrt, Grund als Text
  if (!s.aktiv) { out.grund = s.grund; return out; }
  const wm = Waffen.waffenMap(game); const w = {};
  for (const pl of Maps.WAFFENPLAETZE) if (wm[pl.platz]) w[pl.platz] = wm[pl.platz];
  out.waffen = w;
  const mr = {};   // Modulräume: offene Räume mit Modul-Id oder null (leer; ein Raum darf leer bleiben)
  for (const r of Maps.modulRaeumeOffen(game.ship.stufe | 0)) { const q = Modul.liste(game).find((m) => m.raum === r); mr[r] = q ? q.id : null; }
  out.module = mr;
  out.frei = { stufe: f.stufe, waffen: f.waffen, module: f.module };
  const p = { stufe: {}, waffe: {}, modul: {} };
  for (const t of sortiment(game)) if (!istFrei(game, t.art, t.id)) { const pr = preis(game, t.art, t.id); if (pr != null) p[t.art][t.id] = pr; }
  out.preise = p;
  return out;
}

// ---------- Szene starten (Rüstphase der Wellenmodi) ----------
// Wellen All und Wellen Boden beginnen in der Testumgebung mit der Rüstphase (wellen.ph 'vorbereitung', Crew an Bord): wer will, baut am Terminal aus, dann startet jemand am Terminal die Szene
// (Boden: die Crew beamt hinunter, dann läuft der Countdown). Kein Debug nötig.
function szeneStarten(game, p) {
  const S = game.arena && game.arena.wellen;
  if (!S || S.ph !== 'vorbereitung') return fehler('kein_start', 'Es gibt gerade nichts zu starten (die Rüstphase läuft nur zu Beginn der Wellenmodi).');
  require('./wellen.js').vorbereitungEnde(game);
  game.emit('werft', { op: 'szene', pid: p ? p.id : null });
  return null;
}

// ---------- Weltstand ----------
function toSave(game) { const f = ableiten(game); return { stufe: f.stufe, waffen: f.waffen.slice(), module: f.module.slice() }; }
// Reihenfolge in weltstand.apply: nach Ausbau.restore, Modul.restore und der Bestückung. Fehlt der Block (Altstand A/B/C, main): Start plus alles, was am Schiff steckt.
function restore(game, saved) {
  const f = startFrei(game);
  if (saved && typeof saved === 'object') {
    if (Number.isInteger(saved.stufe)) f.stufe = Math.max(0, Math.min(Maps.STUFE_MAX, saved.stufe));
    for (const id of Array.isArray(saved.waffen) ? saved.waffen : []) if (Katalog.waffe(id) && !f.waffen.includes(id)) f.waffen.push(id);
    for (const id of Array.isArray(saved.module) ? saved.module : []) if (game.C.module.ids.includes(id) && !f.module.includes(id)) f.module.push(id);
  }
  game.ship.freigeschaltet = f;
  ableiten(game);
}

// ---------- Debug: werft [status | freischalten alle | reset] ----------
//   freischalten alle  = Stufe 3 und alles freischalten (ohne Marken, ohne Ort), auch die Schiffsstufe wird auf 3 gesetzt
//   reset              = zurück auf die Start-Freischaltung (Stufe, Waffen, Module des Schiffs bleiben wie sie sind und gelten beim nächsten Laden wieder als frei)
function debug(game, args) {
  const sub = args[0] || 'status';
  if (sub === 'freischalten' && (args[1] === 'alle' || args[1] == null)) {
    const f = liste(game);
    f.stufe = Maps.STUFE_MAX; Ausbau.setStufe(game, Maps.STUFE_MAX);   // das Schiff trägt die gekaufte Stufe
    for (const w of Katalog.WAFFEN) if (!f.waffen.includes(w.id)) f.waffen.push(w.id);
    for (const id of game.C.module.ids) if (!f.module.includes(id)) f.module.push(id);
    return null;
  }
  if (sub === 'reset') { game.ship.freigeschaltet = startFrei(game); return null; }
  const f = liste(game); const st = status(game);
  game.log(`Werft: ${st.aktiv ? 'aktiv' : 'gesperrt (' + st.grund + ')'} · frei: Stufe ${f.stufe}, Waffen ${f.waffen.join(' ')}, Module ${f.module.join(' ')}`);
  return null;
}

module.exports = {
  istFlottenbasis, setzeFlottenbasis, status, testumgebung, szeneStarten, startFrei, liste, istFrei, preis, sortiment, ableiten,
  freischalten, freischaltenPruefen, umbau, umbauPruefen, modul, modulPruefen, vorschau, snapshot, nutzer, aufstehen, ansichtSetzen, zusehenSetzen, toSave, restore, debug,
};
