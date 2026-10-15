'use strict';
// SL8 (CONCEPT-SL8): Notrufe – Angebote, kein Zwang. Action-Layer; Zustand game.notrufe, Weltstand welt.notrufe, Snapshot `nr` und space.nro.
//   freischalten(game, ids, dauer?)   Kette schaltet Rufe frei (Baustein notrufe_freischalten, Beginn Kapitel 7): Marke auf der Hexkarte, Ablauf läuft
//   fokus(game, id)                   Captain wählt einen Ruf (Details im Snapshot nur für den Fokus)
//   befragen(game, id, i)             Captain fragt den Absender (feste Zeilen; die Ops bekommt den Hinweis gegen die Indizien)
//   entschluesseln(game, p, id)       Ops öffnet das verschlüsselte Signal (SL5, Qualität 0–3 = Indizien)
//   hinfliegen(game, id) / ablehnen   Captain entscheidet; hinfliegen öffnet bei Leerraum-Rufen den temporären Sprungpunkt
//   sondeMeldet(game, hex)            SL4: die Sonde hat den Sektor des Rufs erreicht: echte Messwerte statt Behauptung
//   update(game, dt)                  Ablauf (Spielzeit, auch im Schnellsprung), Ankunft am Ort, Bergung bzw. Hinterhalt, Wiederkehr
//   toSave / restore / reset / snapshot
// Daten content/notrufe/<id>.json (Format notruf/1): { id, hex, tor?: { von, nach }, art: klar|verschluesselt, wahrheit: echt|falle, absender, behauptung,
//   indizien: [3 Texte], messwerte: Text (nach der Sonde), befragung: [{ frage, antwort, hinweis }], pos: { x, y }, dauer (s), lohn, hinterhalt?: { n },
//   schiff?: { art: frachter|bergungsboot, huelle: Prozent }, varianten?: [{ absender, behauptung, indizien?, messwerte?, befragung? }] }
// Regeln: Ignorieren kostet nichts. Ein Ruf läuft `dauer` Spielsekunden ab Freischaltung (auch im Schnellsprung); vor Ort läuft nichts mehr ab.
// Vor Ort steht ein sichtbares Schiff des Absenders in der Szene (Escort-Objekt mit Tag nr_<id>: Name, Taktikkarte, Captain-Lage, anfliegbar).
// Echt/klar: Lerche nah und langsam am Schiff für `bergeZeit` s = geborgen, Lohn in Marken (geld.js). Falle: das Schiff ist eine Attrappe; kommt die Lerche
// auf `hinterhaltAbstand` heran, löst das den Hinterhalt aus (Gegner mit Tag 'hinterhalt'); erledigt, wenn sie alle ausgeschaltet sind. Die Kampagne
// scheitert nie; die Szene darf scheitern (Lerche zerstört: von vorn).
// Wiederkehr (CONFIG.notrufe.wiederkehr): abgelaufene oder ignorierte Rufe erscheinen nach `pause` Spielsekunden erneut (abwechselnd Original und
// Variante mit anderem Absender), höchstens `max`-mal je Ruf, nur solange Kapitel `kapitelNr` der Kette läuft; erledigte Rufe kommen nie wieder.
// Das Tor (temporärer Sprungpunkt) eines Leerraum-Rufs schließt nie unter der Lerche: ist sie noch im Leerraum-Hex, bleibt es offen, bis sie geflogen ist.
// Die Marke auf der Hexkarte gehört server/sim/marken.js (ein Mechanismus); Ablauf der Marke und des Rufs sind gekoppelt.
const fs = require('fs');
const path = require('path');
const Sektoren = require('../../shared/sektoren.js');
const Marken = require('./marken.js');
const Geld = require('./geld.js');
const Entschl = require('./entschluesseln.js');
const Station = require('./station.js');
let sprungMod = null, spaceMod = null, escortMod = null;
const Sprung = () => sprungMod || (sprungMod = require('./sprung.js'));
const Space = () => spaceMod || (spaceMod = require('./space.js'));
const Escort = () => escortMod || (escortMod = require('./escort.js'));

const DIR = path.join(__dirname, '..', '..', 'content', 'notrufe');
const ID = /^[a-z][a-z0-9_]*$/;
const Z = { OFFEN: 0, ANGENOMMEN: 1, VOR_ORT: 2, ERLEDIGT: 3, ABGELAUFEN: 4, ABGELEHNT: 5 };
const AKTIV = (z) => z === Z.OFFEN || z === Z.ANGENOMMEN || z === Z.VOR_ORT;
const cache = {};
const cfg = (game) => game.C.notrufe;
const wiederCfg = (game) => cfg(game).wiederkehr || {};
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
// Alle Rufe der Kampagne (für Prüfer und Tests)
function alleIds() {
  try { return fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter((id) => datei(id)); } catch (e) { return []; }
}
// Der Ruf in seiner aktuellen Fassung: Wiederkehr-Variante (r.v > 0) überschreibt Absender, Behauptung, Indizien, Messwerte, Befragung
function ansicht(r, d) {
  const v = r && r.v > 0 && Array.isArray(d.varianten) && d.varianten.length ? d.varianten[(r.v - 1) % d.varianten.length] : null;
  return v ? Object.assign({}, d, v) : d;
}

function neu() { return { liste: [], fokus: null, torZu: [] }; }
function reset(game) { game.notrufe = neu(); }
function st(game) { return game.notrufe || (game.notrufe = neu()); }
function finde(game, id) { return st(game).liste.find((r) => r.id === id) || null; }
function entschlId(r) { return 'notruf_' + r.id + (r.v ? '_v' + r.v : ''); }

function marke(game, r, d) {
  Marken.setze(game, { id: 'notruf:' + r.id, typ: 'notruf', hex: d.hex, sym: 'notruf', ticks: r.rest > 0 ? r.rest / tickSek(game) : undefined });
}
function torId(d) { return d.tor ? Sektoren.kanteId(d.tor.von, d.tor.nach) : null; }
function tor(game, d, auf) {
  if (!d.tor) return;
  const id = torId(d); const s = st(game);
  if (auf) {
    s.torZu = s.torZu.filter((x) => x !== id);
    const err = Sprung().oeffnen(game, { von: d.tor.von, nach: d.tor.nach, temp: true, bis: 'immer' });
    if (err) game.countError && game.countError('notruf-tor', new Error(err));
  } else if (Sektoren.hexVonOrt(game.ship.scene) === d.tor.nach) { if (!s.torZu.includes(id)) s.torZu.push(id); }   // Lerche noch im Leerraum: Weg zurück bleibt offen
  else Sprung().schliessen(game, id);
}
function torAufraeumen(game) {
  const s = st(game); if (!s.torZu.length) return;
  const hex = Sektoren.hexVonOrt(game.ship.scene);
  s.torZu = s.torZu.filter((id) => {
    if (s.liste.some((r) => AKTIV(r.z) && torId(datei(r.id) || {}) === id)) return false;   // ein Ruf braucht das Tor wieder
    const k = Sektoren.kanteAusId(id);
    const d = s.liste.map((r) => datei(r.id)).find((x) => x && torId(x) === id);
    if (k && d && hex === d.tor.nach) return true;   // Lerche noch im Leerraum: offen lassen
    Sprung().schliessen(game, id); return false;
  });
}

// ---------- das sichtbare Schiff am Ruf-Ort (Escort-Objekt) ----------
function schiff(game, r) { return ((game.space && game.space.escorts) || []).find((q) => q.notruf === r.id) || null; }
function schiffStellen(game, r, d) {
  if (schiff(game, r)) return;
  const a = ansicht(r, d); const sc = d.schiff || {};
  const es = Escort().spawn(game, { tag: 'nr_' + r.id, kind: sc.art || 'frachter', name: a.absender || 'Notruf', verhalten: 'treibt', von: { x: d.pos.x, y: d.pos.y }, huelle: sc.huelle || 45 });
  if (es) { es.notruf = r.id; es.angle = Number.isFinite(sc.winkel) ? sc.winkel : 0.6; }
  else if (game.countError) game.countError('notruf-schiff', new Error(`Schiff für Notruf '${r.id}' nicht angelegt`));
}
function schiffWeg(game, r) {
  const sp = game.space; const es = sp && schiff(game, r);
  if (es) sp.escorts = sp.escorts.filter((q) => q !== es);
}
function ortPos(game, r, d) { const es = schiff(game, r); return es ? { x: es.x, y: es.y } : d.pos; }
function funk(game, von, text) {
  if (game.mission && typeof game.mission.radio === 'function') game.mission.radio(von, text, false); else game.emit('radio', { from: von, text });
}

function beende(game, r, z) {
  const d = datei(r.id);
  r.z = z;
  Marken.entferne(game, 'notruf:' + r.id);
  schiffWeg(game, r);
  if (d) tor(game, d, false);
  if (st(game).fokus === r.id) st(game).fokus = null;
  const W = wiederCfg(game);
  r.w = (z === Z.ABGELAUFEN || z === Z.ABGELEHNT) && W.pause > 0 && (r.n || 0) < (Number(W.max) || 0) ? W.pause : null;
}
// Kapitel 7 der Kette läuft (ohne Kette, z. B. Labor und Tests: immer)
function wiederErlaubt(game) {
  const k = game.mission && game.mission.kette;
  if (!k || typeof k.aktuell !== 'function') return true;
  const c = k.aktuell();
  return !!c && c.nr === (Number(wiederCfg(game).kapitelNr) || 7);
}
function wiederkehr(game, r, d) {
  const L = Array.isArray(d.varianten) ? d.varianten.length : 0;
  r.n = (r.n || 0) + 1; r.v = r.n % (L + 1); r.w = null;
  r.z = Z.OFFEN; r.rest = d.dauer || cfg(game).dauer; r.befragt = []; r.sonde = false; r.bergen = 0; r.hinterhalt = false;
  marke(game, r, d); tor(game, d, true);
  game.oda('Notruf empfangen. Er steht auf der Hexkarte.', null);
  game.missionEvent('notrufOffen', { id: r.id, hex: d.hex, wieder: true });
}

// -> Fehlertext | null. ids: Array oder 'a,b,c'
function freischalten(game, ids, dauer) {
  const l = Array.isArray(ids) ? ids : String(ids || '').split(',').map((x) => x.trim()).filter(Boolean);
  let fehler = null;
  for (const id of l) {
    const d = datei(id);
    if (!d) { fehler = `Notruf '${id}' gibt es nicht (content/notrufe).`; continue; }
    if (finde(game, id)) continue;
    const r = { id, z: Z.OFFEN, rest: Number(dauer) > 0 ? Number(dauer) : (d.dauer || cfg(game).dauer), befragt: [], sonde: false, bergen: 0, v: 0, n: 0, w: null, hinterhalt: false };
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
  return Entschl.ergebnis(game, entschlId(r)) != null;
}

// Ops: verschlüsseltes Signal öffnen. Schicht 0 = Behauptung, 1–3 = Indizien je Qualität
function entschluesseln(game, p, id) {
  const r = finde(game, id); const d = r && datei(id);
  if (!r || !d || !AKTIV(r.z)) return 'Dieser Notruf ist nicht mehr offen.';
  if (p && Station.stationOf(p) !== 'weapons') return 'Das macht die Ops.';
  if (d.art === 'klar') return 'Der Ruf ist klar, nichts zu entschlüsseln.';
  if (Entschl.ergebnis(game, entschlId(r)) != null) return 'Schon entschlüsselt.';
  const a = ansicht(r, d);
  return Entschl.startenNotruf(game, entschlId(r), a.absender || 'Notruf', [a.behauptung].concat((a.indizien || []).slice(0, 3)));
}

function befragen(game, id, i) {
  const r = finde(game, id); const d = r && datei(id);
  if (!r || !d || !AKTIV(r.z)) return 'Dieser Notruf ist nicht mehr offen.';
  if (!behauptungSichtbar(game, r, d)) return 'Der Absender ist noch nicht zu verstehen (Ops entschlüsselt).';
  const a = ansicht(r, d);
  const q = (a.befragung || [])[i]; if (!q) return 'Diese Frage gibt es nicht.';
  if (!r.befragt.includes(i)) r.befragt.push(i);
  funk(game, a.absender || 'Notruf', q.antwort);
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
    game.oda(`Sonde misst den Notruf in ${Sektoren.hexName(hex)}: ${ansicht(r, d).messwerte || 'keine auffälligen Werte.'}`, null);
    game.missionEvent('notrufGemessen', { id: r.id, wahrheit: d.wahrheit });
  }
}

function hinterhalt(game, r, d) {
  const n = Math.max(2, Math.min(5, (d.hinterhalt && d.hinterhalt.n) || cfg(game).hinterhaltN));
  const sh = game.ship; const w0 = game.rng.range(-Math.PI, Math.PI);
  const p = ortPos(game, r, d);
  schiffWeg(game, r);   // die Attrappe verschwindet, die Jäger kommen aus dem Asteroidenschatten
  for (let i = 0; i < n; i++) {
    const a = w0 + (i / n) * Math.PI * 2;
    const e = Space().spawnEnemy(game, 'raider', { x: p.x + Math.cos(a) * 520, y: p.y + Math.sin(a) * 520, facing: a + Math.PI, tag: 'hinterhalt' });
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
    const d = datei(r.id); if (!d) continue;
    if (!AKTIV(r.z)) {   // Wiederkehr: abgelaufen oder ignoriert, nicht erledigt
      if ((r.z === Z.ABGELAUFEN || r.z === Z.ABGELEHNT) && r.w != null && wiederErlaubt(game)) { r.w -= dt; if (r.w <= 0) wiederkehr(game, r, d); }
      continue;
    }
    // Ablauf: nur solange niemand vor Ort ist
    if (r.z !== Z.VOR_ORT) {
      r.rest -= dt;
      if (r.rest <= 0) { beende(game, r, Z.ABGELAUFEN); game.oda(`Der Notruf in ${Sektoren.hexName(d.hex)} ist verstummt.`, null); game.missionEvent('notrufAbgelaufen', { id: r.id }); continue; }
    }
    if (hexNow === d.hex && r.z !== Z.VOR_ORT) {   // Ankunft: das Schiff des Absenders steht im Raum
      r.z = Z.VOR_ORT; r.bergen = 0; r.fertigAm = null; r.hinterhalt = false;
      schiffStellen(game, r, d);
      game.oda(`Notruf-Position erreicht: ${ansicht(r, d).absender || 'Absender'} wartet. Nah heran und langsam, dann bergen.`, null);
      game.missionEvent('notrufVorOrt', { id: r.id, wahrheit: d.wahrheit });
    } else if (hexNow !== d.hex && r.z === Z.VOR_ORT) { r.z = Z.ANGENOMMEN; r.bergen = 0; r.hinterhalt = false; schiffWeg(game, r); }   // Szene verlassen: der Ruf bleibt offen
    if (r.z !== Z.VOR_ORT) continue;
    const sh = game.ship;
    if (!schiff(game, r) && !r.hinterhalt) schiffStellen(game, r, d);   // z. B. nach Laden oder Szenenreset
    const p = ortPos(game, r, d);
    if (d.wahrheit === 'falle') {
      if (!r.hinterhalt) {   // erst wenn die Lerche nah genug an der Attrappe ist
        if (dist(sh.x, sh.y, p.x, p.y) <= (C.hinterhaltAbstand || 700)) { r.hinterhalt = true; hinterhalt(game, r, d); }
        continue;
      }
      if (!game.space.enemies.some((e) => e.tag === 'hinterhalt')) {
        beende(game, r, Z.ERLEDIGT);
        if (d.lohn) Geld.gutschreiben(game, d.lohn, 'notruf');
        game.oda('Hinterhalt abgewehrt.' + (d.lohn ? ` Beute: ${d.lohn} Marken.` : ''), null);
        game.missionEvent('notrufErledigt', { id: r.id, wahrheit: 'falle' });
      }
      continue;
    }
    // echt/klar: bergen
    if (dist(sh.x, sh.y, p.x, p.y) <= C.bergeRadius && sh.speed <= C.bergeTempo) {
      r.bergen += dt;
      if (r.bergen >= C.bergeZeit) {
        const a = ansicht(r, d);
        beende(game, r, Z.ERLEDIGT);
        Geld.gutschreiben(game, d.lohn || 0, 'notruf');
        game.oda(`${a.absender || 'Absender'} geborgen.${d.lohn ? ` Lohn: ${d.lohn} Marken.` : ''}`, null);
        game.emit('sfx', { name: 'repair_done' });
        game.missionEvent('notrufErledigt', { id: r.id, wahrheit: d.wahrheit });
      }
    } else r.bergen = Math.max(0, r.bergen - dt);
  }
  torAufraeumen(game);
}

function anzahlErledigt(game) { return st(game).liste.filter((r) => r.z === Z.ERLEDIGT).length; }
function erledigt(game, id) { const r = finde(game, id); return !!r && r.z === Z.ERLEDIGT; }

// Snapshot nr: [{ i, h, k, z, r, f? }] nur offene Rufe; f (nur der Fokus): { b: Behauptung | null, q: [Fragen], a: [[i, Antwort]], s: Messwerte | null, ind: Qualität | null }
function snapshot(game) {
  const s = st(game); const l = s.liste.filter((r) => AKTIV(r.z));
  if (!l.length) return null;
  return l.map((r) => {
    const d = datei(r.id) || {}; const a = ansicht(r, d);
    const o = { i: r.id, h: d.hex, k: d.art === 'klar' ? 'k' : 'v', z: r.z };
    if (r.z !== Z.VOR_ORT) o.r = Math.max(0, Math.ceil(r.rest / 5) * 5);
    if (s.fokus === r.id) {
      const f = {};
      f.b = behauptungSichtbar(game, r, d) ? a.behauptung : null;
      if (f.b) { f.n = a.absender || ''; f.q = (a.befragung || []).map((x) => x.frage); if (r.befragt.length) f.a = r.befragt.map((i) => [i, a.befragung[i].antwort]); }
      if (r.sonde) f.s = a.messwerte || '';
      const q = Entschl.ergebnis(game, entschlId(r)); if (q != null) f.e = q;
      o.f = f;
    }
    return o;
  });
}
// space.nro: der Ruf-Ort in der Szene { x, y, p } (neutral, ohne Wahrheit), nur vor Ort; folgt dem Schiff (treibt)
function snapshotOrt(game) {
  const r = st(game).liste.find((x) => x.z === Z.VOR_ORT); if (!r) return null;
  const d = datei(r.id); if (!d) return null;
  const p = ortPos(game, r, d);
  return { x: Math.round(p.x), y: Math.round(p.y), p: Math.min(1, Math.round((r.bergen / cfg(game).bergeZeit) * 100) / 100), r: cfg(game).bergeRadius };
}

function toSave(game) {
  const s = st(game); if (!s.liste.length) return null;
  const out = {};
  for (const r of s.liste) {
    out[r.id] = { z: r.z, rest: Math.max(0, Math.round(r.rest)), befragt: r.befragt.slice(), sonde: !!r.sonde };
    if (r.v) out[r.id].v = r.v;
    if (r.n) out[r.id].n = r.n;
    if (r.w != null) out[r.id].w = Math.max(0, Math.round(r.w));
  }
  return out;
}
function restore(game, b) {
  reset(game);
  if (!b || typeof b !== 'object') return;
  for (const [id, v] of Object.entries(b)) {
    const d = datei(id); if (!d || !v) continue;
    const r = { id, z: Number.isInteger(v.z) && v.z >= 0 && v.z <= 5 ? v.z : Z.OFFEN, rest: Number(v.rest) || 0, befragt: Array.isArray(v.befragt) ? v.befragt.filter((i) => Number.isInteger(i)) : [], sonde: !!v.sonde, bergen: 0,
      v: Number.isInteger(v.v) && v.v > 0 ? v.v : 0, n: Number.isInteger(v.n) && v.n > 0 ? v.n : 0, w: Number.isFinite(Number(v.w)) && v.w != null ? Number(v.w) : null, hinterhalt: false };
    if (r.z === Z.VOR_ORT) r.z = Z.ANGENOMMEN;
    st(game).liste.push(r);
    if (AKTIV(r.z)) { marke(game, r, d); tor(game, d, true); }
  }
}

module.exports = { Z, datei, registriere, alleIds, ansicht, reset, freischalten, fokus, entschluesseln, befragen, hinfliegen, ablehnen, sondeMeldet, update, snapshot, snapshotOrt, toSave, restore, anzahlErledigt, erledigt, finde, schiff };
