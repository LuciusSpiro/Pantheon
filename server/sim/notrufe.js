'use strict';
// SL8 (CONCEPT-SL8): Notrufe – Angebote, kein Zwang. Action-Layer; Zustand game.notrufe, Weltstand welt.notrufe, Snapshot `nr` und space.nro.
//   freischalten(game, ids, dauer?)   Kette schaltet Rufe frei (Baustein notrufe_freischalten, Beginn Kapitel 7): Marke auf der Hexkarte, Ablauf läuft
//   fokus(game, id)                   Captain wählt einen Ruf (Details im Snapshot nur für den Fokus)
//   befragen(game, id, i)             Captain fragt den Absender (feste Zeilen; die Ops bekommt den Hinweis gegen die Indizien)
//   entschluesseln(game, p, id)       Ops öffnet das verschlüsselte Signal (SL5, Qualität 0–3 = Indizien)
//   hinfliegen(game, id) / ablehnen   Captain entscheidet; hinfliegen öffnet bei Leerraum-Rufen den temporären Sprungpunkt
//   sondeMeldet(game, hex)            SL4: die Sonde hat den Sektor des Rufs erreicht: echte Messwerte statt Behauptung
//   update(game, dt)                  Ablauf (Spielzeit, auch im Schnellsprung), Ankunft am Ort, Bergung bzw. Hinterhalt
//   toSave / restore / reset / snapshot
// Daten content/notrufe/<id>.json (Format notruf/1): { id, hex, tor?: { von, nach }, art: klar|verschluesselt, wahrheit: echt|falle, absender, behauptung,
//   indizien: [3 Texte], messwerte: Text (nach der Sonde), befragung: [{ frage, antwort, hinweis }], pos: { x, y }, dauer (s), lohn, hinterhalt?: { n } }
// Regeln: Ignorieren kostet nichts. Ein Ruf läuft `dauer` Spielsekunden ab Freischaltung (auch im Schnellsprung); vor Ort läuft nichts mehr ab.
// Echt/klar: Lerche nah und langsam am Ruf für `bergeZeit` s = geborgen, Lohn in Marken (geld.js). Falle: Ankunft löst den Hinterhalt aus (Gegner
// mit Tag 'hinterhalt'), erledigt, wenn sie alle ausgeschaltet sind. Die Kampagne scheitert nie; die Szene darf scheitern (Lerche zerstört: von vorn).
// Die Marke auf der Hexkarte gehört server/sim/marken.js (ein Mechanismus); Ablauf der Marke und des Rufs sind gekoppelt.
const fs = require('fs');
const path = require('path');
const Sektoren = require('../../shared/sektoren.js');
const Marken = require('./marken.js');
const Geld = require('./geld.js');
const Entschl = require('./entschluesseln.js');
const Station = require('./station.js');
let sprungMod = null, spaceMod = null;
const Sprung = () => sprungMod || (sprungMod = require('./sprung.js'));
const Space = () => spaceMod || (spaceMod = require('./space.js'));

const DIR = path.join(__dirname, '..', '..', 'content', 'notrufe');
const ID = /^[a-z][a-z0-9_]*$/;
const Z = { OFFEN: 0, ANGENOMMEN: 1, VOR_ORT: 2, ERLEDIGT: 3, ABGELAUFEN: 4, ABGELEHNT: 5 };
const AKTIV = (z) => z === Z.OFFEN || z === Z.ANGENOMMEN || z === Z.VOR_ORT;
const cache = {};
const cfg = (game) => game.C.notrufe;
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const tickSek = (game) => Number(game.C.marken && game.C.marken.tickSekunden) || 30;

function datei(id) {
  if (typeof id !== 'string' || !ID.test(id)) return null;
  if (cache[id] !== undefined) return cache[id];
  let d = null;
  try { d = JSON.parse(fs.readFileSync(path.join(DIR, id + '.json'), 'utf8')); } catch (e) { d = null; }
  if (d && (d.id !== id || !Sektoren.imRaster(d.hex) || !['klar', 'verschluesselt'].includes(d.art) || !['echt', 'falle'].includes(d.wahrheit))) d = null;
  cache[id] = d;
  return d;
}
function registriere(d) { if (d && ID.test(d.id)) cache[d.id] = d; }

function neu() { return { liste: [], fokus: null }; }
function reset(game) { game.notrufe = neu(); }
function st(game) { return game.notrufe || (game.notrufe = neu()); }
function finde(game, id) { return st(game).liste.find((r) => r.id === id) || null; }
function entschlId(id) { return 'notruf_' + id; }

function marke(game, r, d) {
  Marken.setze(game, { id: 'notruf:' + r.id, typ: 'notruf', hex: d.hex, sym: 'notruf', ticks: r.rest > 0 ? r.rest / tickSek(game) : undefined });
}
function tor(game, d, auf) {
  if (!d.tor) return;
  if (auf) { const err = Sprung().oeffnen(game, { von: d.tor.von, nach: d.tor.nach, temp: true, bis: 'immer' }); if (err) game.countError && game.countError('notruf-tor', new Error(err)); }
  else Sprung().schliessen(game, Sektoren.kanteId(d.tor.von, d.tor.nach));
}
function beende(game, r, z) {
  const d = datei(r.id);
  r.z = z;
  Marken.entferne(game, 'notruf:' + r.id);
  if (d) tor(game, d, false);
  if (st(game).fokus === r.id) st(game).fokus = null;
}

// -> Fehlertext | null. ids: Array oder 'a,b,c'
function freischalten(game, ids, dauer) {
  const l = Array.isArray(ids) ? ids : String(ids || '').split(',').map((x) => x.trim()).filter(Boolean);
  let fehler = null;
  for (const id of l) {
    const d = datei(id);
    if (!d) { fehler = `Notruf '${id}' gibt es nicht (content/notrufe).`; continue; }
    if (finde(game, id)) continue;
    const r = { id, z: Z.OFFEN, rest: Number(dauer) > 0 ? Number(dauer) : (d.dauer || cfg(game).dauer), befragt: [], sonde: false, bergen: 0 };
    st(game).liste.push(r);
    marke(game, r, d);
    tor(game, d, true);
    game.missionEvent('notrufOffen', { id, hex: d.hex });
  }
  if (l.length) game.oda(l.length === 1 ? 'Notruf empfangen. Er steht auf der Hexkarte.' : `${l.length} Notrufe empfangen. Sie stehen auf der Hexkarte; der Captain wählt aus, ignorieren kostet nichts.`, null);
  return fehler;
}

function fokus(game, id) { if (finde(game, id)) st(game).fokus = id; return null; }

function behauptungSichtbar(game, r, d) {
  if (d.art === 'klar') return true;
  return Entschl.ergebnis(game, entschlId(r.id)) != null;
}

// Ops: verschlüsseltes Signal öffnen. Schicht 0 = Behauptung, 1–3 = Indizien je Qualität
function entschluesseln(game, p, id) {
  const r = finde(game, id); const d = r && datei(id);
  if (!r || !d || !AKTIV(r.z)) return 'Dieser Notruf ist nicht mehr offen.';
  if (p && Station.stationOf(p) !== 'weapons') return 'Das macht die Ops.';
  if (d.art === 'klar') return 'Der Ruf ist klar, nichts zu entschlüsseln.';
  if (Entschl.ergebnis(game, entschlId(id)) != null) return 'Schon entschlüsselt.';
  return Entschl.startenNotruf(game, entschlId(id), d.absender || 'Notruf', [d.behauptung].concat((d.indizien || []).slice(0, 3)));
}

function befragen(game, id, i) {
  const r = finde(game, id); const d = r && datei(id);
  if (!r || !d || !AKTIV(r.z)) return 'Dieser Notruf ist nicht mehr offen.';
  if (!behauptungSichtbar(game, r, d)) return 'Der Absender ist noch nicht zu verstehen (Ops entschlüsselt).';
  const q = (d.befragung || [])[i]; if (!q) return 'Diese Frage gibt es nicht.';
  if (!r.befragt.includes(i)) r.befragt.push(i);
  const radio = game.mission && typeof game.mission.radio === 'function' ? (f, t) => game.mission.radio(f, t, false) : (f, t) => game.emit('radio', { from: f, text: t });
  radio(d.absender || 'Notruf', q.antwort);
  if (q.hinweis) game.oda(`Ops-Hinweis: ${q.hinweis}`, null);
  return null;
}

function hinfliegen(game, id) {
  const r = finde(game, id); const d = r && datei(id);
  if (!r || !d || !AKTIV(r.z)) return 'Dieser Notruf ist nicht mehr offen.';
  if (r.z === Z.OFFEN) r.z = Z.ANGENOMMEN;
  game.oda(`Kurs auf den Notruf in ${Sektoren.hexName(d.hex)}${d.tor ? ': Der temporäre Sprungpunkt steht in ' + Sektoren.hexName(d.tor.von) + '.' : '.'}`, null);
  game.missionEvent('notrufAngenommen', { id, hex: d.hex });
  return null;
}
function ablehnen(game, id) {
  const r = finde(game, id);
  if (!r || !AKTIV(r.z) || r.z === Z.VOR_ORT) return 'Dieser Notruf lässt sich nicht mehr ablehnen.';
  beende(game, r, Z.ABGELEHNT);
  game.oda('Notruf ignoriert. Das kostet nichts.', null);
  game.missionEvent('notrufAbgelehnt', { id });
  return null;
}

// SL4: die Sonde hat den Sektor erreicht: echte Messwerte (hebt die Behauptung auf)
function sondeMeldet(game, hex) {
  for (const r of st(game).liste) {
    const d = datei(r.id);
    if (!d || !AKTIV(r.z) || d.hex !== hex || r.sonde) continue;
    r.sonde = true;
    game.oda(`Sonde misst den Notruf in ${Sektoren.hexName(hex)}: ${d.messwerte || 'keine auffälligen Werte.'}`, null);
    game.missionEvent('notrufGemessen', { id: r.id, wahrheit: d.wahrheit });
  }
}

function hinterhalt(game, r, d) {
  const n = Math.max(2, Math.min(5, (d.hinterhalt && d.hinterhalt.n) || cfg(game).hinterhaltN));
  const sh = game.ship; const w0 = game.rng.range(-Math.PI, Math.PI);
  for (let i = 0; i < n; i++) {
    const a = w0 + (i / n) * Math.PI * 2;
    const e = Space().spawnEnemy(game, 'raider', { x: d.pos.x + Math.cos(a) * 520, y: d.pos.y + Math.sin(a) * 520, facing: a + Math.PI, tag: 'hinterhalt' });
    if (e) e.eingesprungen = true;
  }
  game.oda('Das war eine Falle! Jäger aus dem Asteroidenschatten.', null);
  game.emit('sfx', { name: 'alarm' });
  game.missionEvent('notrufHinterhalt', { id: r.id, n, ship: { x: sh.x, y: sh.y } });
}

function update(game, dt) {
  const s = st(game); if (!s.liste.length) return;
  const hexNow = Sektoren.hexVonOrt(game.ship.scene);
  const C = cfg(game);
  for (const r of s.liste.slice()) {
    if (!AKTIV(r.z)) continue;
    const d = datei(r.id); if (!d) continue;
    // Ablauf: nur solange niemand vor Ort ist
    if (r.z !== Z.VOR_ORT) {
      r.rest -= dt;
      if (r.rest <= 0) { beende(game, r, Z.ABGELAUFEN); game.oda(`Der Notruf in ${Sektoren.hexName(d.hex)} ist verstummt.`, null); game.missionEvent('notrufAbgelaufen', { id: r.id }); continue; }
    }
    if (hexNow === d.hex && r.z !== Z.VOR_ORT) {   // Ankunft
      r.z = Z.VOR_ORT; r.bergen = 0; r.fertigAm = null;
      if (d.wahrheit === 'falle') hinterhalt(game, r, d);
      else game.oda(`Notruf-Position erreicht: ${d.absender || 'Absender'} wartet. Nah heran und langsam, dann bergen.`, null);
      game.missionEvent('notrufVorOrt', { id: r.id, wahrheit: d.wahrheit });
    } else if (hexNow !== d.hex && r.z === Z.VOR_ORT) { r.z = Z.ANGENOMMEN; r.bergen = 0; }   // Szene verlassen: der Ruf bleibt offen
    if (r.z !== Z.VOR_ORT) continue;
    const sh = game.ship;
    if (d.wahrheit === 'falle') {
      if (!game.space.enemies.some((e) => e.tag === 'hinterhalt')) {
        beende(game, r, Z.ERLEDIGT);
        if (d.lohn) Geld.gutschreiben(game, d.lohn, 'notruf');
        game.oda('Hinterhalt abgewehrt.' + (d.lohn ? ` Beute: ${d.lohn} Marken.` : ''), null);
        game.missionEvent('notrufErledigt', { id: r.id, wahrheit: 'falle' });
      }
      continue;
    }
    // echt/klar: bergen
    if (dist(sh.x, sh.y, d.pos.x, d.pos.y) <= C.bergeRadius && sh.speed <= C.bergeTempo) {
      r.bergen += dt;
      if (r.bergen >= C.bergeZeit) {
        beende(game, r, Z.ERLEDIGT);
        Geld.gutschreiben(game, d.lohn || 0, 'notruf');
        game.oda(`${d.absender || 'Absender'} geborgen.${d.lohn ? ` Lohn: ${d.lohn} Marken.` : ''}`, null);
        game.emit('sfx', { name: 'repair_done' });
        game.missionEvent('notrufErledigt', { id: r.id, wahrheit: d.wahrheit });
      }
    } else r.bergen = Math.max(0, r.bergen - dt);
  }
  // Marken abgelaufen (Hexkarte) = Ruf abgelaufen: Marke und Ruf laufen gleich, hier nur Sicherheit nach dem Laden
}

function anzahlErledigt(game) { return st(game).liste.filter((r) => r.z === Z.ERLEDIGT).length; }
function erledigt(game, id) { const r = finde(game, id); return !!r && r.z === Z.ERLEDIGT; }

// Snapshot nr: [{ i, h, k, z, r, f? }] nur offene Rufe; f (nur der Fokus): { b: Behauptung | null, q: [Fragen], a: [[i, Antwort]], s: Messwerte | null, ind: Qualität | null }
function snapshot(game) {
  const s = st(game); const l = s.liste.filter((r) => AKTIV(r.z));
  if (!l.length) return null;
  return l.map((r) => {
    const d = datei(r.id) || {};
    const o = { i: r.id, h: d.hex, k: d.art === 'klar' ? 'k' : 'v', z: r.z };
    if (r.z !== Z.VOR_ORT) o.r = Math.max(0, Math.ceil(r.rest / 5) * 5);
    if (s.fokus === r.id) {
      const f = {};
      f.b = behauptungSichtbar(game, r, d) ? d.behauptung : null;
      if (f.b) { f.n = d.absender || ''; f.q = (d.befragung || []).map((x) => x.frage); if (r.befragt.length) f.a = r.befragt.map((i) => [i, d.befragung[i].antwort]); }
      if (r.sonde) f.s = d.messwerte || '';
      const q = Entschl.ergebnis(game, entschlId(r.id)); if (q != null) f.e = q;
      o.f = f;
    }
    return o;
  });
}
// space.nro: der Ruf-Ort in der Szene { x, y, p } (neutral, ohne Wahrheit), nur vor Ort
function snapshotOrt(game) {
  const r = st(game).liste.find((x) => x.z === Z.VOR_ORT); if (!r) return null;
  const d = datei(r.id); if (!d) return null;
  return { x: d.pos.x, y: d.pos.y, p: Math.min(1, Math.round((r.bergen / cfg(game).bergeZeit) * 100) / 100), r: cfg(game).bergeRadius };
}

function toSave(game) {
  const s = st(game); if (!s.liste.length) return null;
  const out = {};
  for (const r of s.liste) out[r.id] = { z: r.z, rest: Math.max(0, Math.round(r.rest)), befragt: r.befragt.slice(), sonde: !!r.sonde };
  return out;
}
function restore(game, b) {
  reset(game);
  if (!b || typeof b !== 'object') return;
  for (const [id, v] of Object.entries(b)) {
    const d = datei(id); if (!d || !v) continue;
    const r = { id, z: Number.isInteger(v.z) && v.z >= 0 && v.z <= 5 ? v.z : Z.OFFEN, rest: Number(v.rest) || 0, befragt: Array.isArray(v.befragt) ? v.befragt.filter((i) => Number.isInteger(i)) : [], sonde: !!v.sonde, bergen: 0 };
    if (r.z === Z.VOR_ORT) r.z = Z.ANGENOMMEN;
    st(game).liste.push(r);
    if (AKTIV(r.z)) { marke(game, r, d); tor(game, d, true); }
  }
}

module.exports = { Z, datei, registriere, reset, freischalten, fokus, entschluesseln, befragen, hinfliegen, ablehnen, sondeMeldet, update, snapshot, snapshotOrt, toSave, restore, anzahlErledigt, erledigt, finde };
