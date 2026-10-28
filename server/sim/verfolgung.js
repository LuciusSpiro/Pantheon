'use strict';
// SUND-04a-1 A: Szenentyp A6 Verfolgung. Ein Zielschiff (Klasse, Volk, Name als Parameter) flieht Richtung Fluchtpunkt und lädt dort den Sprung auf; die Crew
// muss es STELLEN, bevor die Ladung fertig ist: den Antrieb ausschalten (Systemtreffer am Heck, zielsysteme.js) oder die Sprungladung stören (jeder Systemtreffer
// verzögert sie). Der zerstörte Reaktor bricht die Ladung ab; der Ausgang zerstoert kommt erst mit dem Ablauf des Reaktor-Countdowns (C1b-1). Ausgänge: 'gestellt' (Antrieb ausgefallen und die Lerche seit stellen.zeit s im stellen.radius) | 'zerstoert' | 'entkommen' (Sprung fertig;
// bei wiederholung kommt nach neuNach s ein neues Zielschiff). Alle Zahlen in content/kampf/verfolgung-werte.json.
//
// Das Zielschiff ist ein gewöhnlicher Gegner in space.enemies mit e.fluchtZiel = { x, y } (neues KI-Verhalten in BEIDEN Flugmodellen: Pilot in pilot.js und
// kinematisch in space.moveLegacy; beide fragen fluchtZiel/pilotTempo/legacyTempo hier ab). Hülle, Schilde, Waffen, Schaden, Zerstörung, Marken: wie bei jedem
// Gegner. e.sprung = Fortschritt der Sprungladung (s), e.sprungDauer = Gesamtdauer; der Snapshot trägt sj (Ring wie beim Konvoi) und nm (Name).
//
// Zustand (nur im Raum, je Szene neu): game.space.verfolgung = null | { ziel, klasse, volk, name, tempo, wiederholung, fluchtpunkt { x, y, virtuell },
//   ausgang, szene, versuch, verz, trLast, stellT, neuAt, ansagt }.
//
// FADEN-SCHNITTSTELLE (Paket B / SUND-04a-2): die Szene ist unabhängig vom Labor-Pfad aufrufbar. starten(game, { klasse, volk, name, tempo, wiederholung,
// fluchtpunkt? }) legt Zielschiff und Zustand im aktuellen Ort an (der Ort ist der Ort der Lerche: vorher space.enterScene bzw. Reise), ausgang(game) liefert
// null | 'gestellt' | 'zerstoert' | 'entkommen', das Ereignis missionEvent('verfolgungAusgang', { was, klasse, name, versuch, volk }) meldet das Ende.
// Der Regiebuch-Baustein verfolgung_an ruft nur starten() auf; ein Faden braucht keinen Baustein.
// Haken in space.js: moveLegacy (fluchtZiel, legacyTempo), update (update), enemySnapExtra (snapExtra); pilot.js: update/fly (flucht).
const Sektoren = require('../../shared/sektoren.js');
const Zielsysteme = require('./zielsysteme.js');
const Gsys = require('./gegnersystem.js');
const Gegnersprung = require('./gegnersprung.js');   // SYS-01 C Nacharbeit: Notfallsprung (Baustein) = entkommen
const W = require('../../content/kampf/verfolgung-werte.json').werte;

const ZIEL = W.ziel.wert, FLUCHT = W.flucht.wert, SPRUNG = W.sprung.wert, STELLEN = W.stellen.wert, FP = W.fluchtpunkt.wert, GEGNER = W.gegner.wert,
  WDH = W.wiederholung.wert, ANSAGEN = W.ansagen.wert, FUNK = W.funk.wert;
// Funk-Text je Ausgang (Daten): {name} = Name des Zielschiffs, ohne Namen die Klasse (Review D-M2)
const AUSGAENGE = ['gestellt', 'zerstoert', 'entkommen'];
const KLASSEN = ZIEL.klassen;   // erlaubte Zielklassen (Daten): ohne Jäger, deren Mindestfahrt über der Lerche liegt
const SYSTEM_ZIEL = 'antrieb';   // Zielsystem der Szene (Daten: content/kampf/zielsysteme-werte.json)

let spaceMod = null;   // lazy (Zirkelbezug space -> verfolgung)
const space = () => spaceMod || (spaceMod = require('./space.js'));
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const r2 = (v) => Math.round(v * 100) / 100;

// Zähler für Bots und Messung (game.stats.verfolgung)
function stats(game) { return game.stats.verfolgung || (game.stats.verfolgung = { starts: 0, gestellt: 0, zerstoert: 0, entkommen: 0 }); }
function st(game) { return (game.space && game.space.verfolgung) || null; }
const lebt = (game, id) => game.space.enemies.find((e) => e.id === id) || null;
const labelVon = (k, e) => (k && k.name) || (e && e.name) || 'Das Zielschiff';
// Funk-Text je Ausgang (Daten: funk): {name} = Name des Zielschiffs, ohne Namen die Klasse (Review D-M2)
const funkText = (was, k, e) => String(FUNK[was] || '').replace('{name}', labelVon(k, e));
// Funkzeile an alle Stationen (Review D-M2): Sprecher und Text aus den Daten; lage = Lagefunk (eine Zeile, nicht blockierend)
const funkZeile = (game, text) => game.emit('radio', { from: FUNK.von, text, lage: 1 });

// ---------- Abfragen (Bausteine, Tests, Bots, Fäden) ----------
function aktiv(game) { return !!st(game); }
function ausgang(game) { const k = st(game); return k ? k.ausgang : null; }
function erfolg(game) { const k = st(game); return !!(k && (k.ausgang === 'gestellt' || k.ausgang === 'zerstoert')); }
function ausgangIst(game, was) { return ausgang(game) === was; }
function ziel(game) { const k = st(game); return k ? lebt(game, k.ziel) : null; }
function fluchtpunkt(game) { const k = st(game); return k ? k.fluchtpunkt : null; }

// ---------- Flug (Haken in space.moveLegacy und pilot.js) ----------
// Ziel der Fahrt: der Fluchtpunkt; während der Sprungladung bleibt das Schiff stehen
function fluchtZiel(e) { return e.sprung != null ? { x: e.x, y: e.y } : e.fluchtZiel; }
// Tempo im Flugmodell der Piloten (px/s): Anteil der Höchstfahrt der Klasse c
function pilotTempo(c, e) { return (e && e.fluchtTempo != null ? e.fluchtTempo : FLUCHT.tempo) * c.maxSpeed; }
// Tempo im kinematischen Modell (px/s): Vielfaches von CONFIG.enemies[kind].speed, mit dem Tempo-Parameter skaliert
function legacyTempo(speed, e) { return speed * FLUCHT.legacyFaktor * (e && e.fluchtTempo != null ? e.fluchtTempo / FLUCHT.tempo : 1); }

// ---------- Fluchtpunkt ----------
// Kandidaten: Sprungpunkte des Orts (Kanten des Hexes zu spielbaren Nachbarn), sonst die virtuellen Randpunkte (FP.virtuell). Gewählt wird der Punkt mit dem
// größten Abstand zur Lerche: die Flucht führt von ihr weg.
function kandidaten(game) {
  const sp = game.space; const R = FP.randAbstand; const out = [];
  const here = Sektoren.hexVonOrt(game.ship.scene);
  if (here) {
    for (const n of Sektoren.nachbarn(here)) {
      if (!Sektoren.spielbar(n)) continue;
      const p = Sektoren.sprungpunktLage(sp.w, sp.h, Sektoren.richtung(here, n), R);
      out.push({ x: p.x, y: p.y, virtuell: false });
    }
  }
  if (out.length) return out;
  const rand = { west: { x: R, y: sp.h / 2 }, ost: { x: sp.w - R, y: sp.h / 2 }, nord: { x: sp.w / 2, y: R }, sued: { x: sp.w / 2, y: sp.h - R } };
  for (const n of FP.virtuell) if (rand[n]) out.push({ x: Math.round(rand[n].x), y: Math.round(rand[n].y), virtuell: true });
  return out;
}
function fluchtpunktWaehlen(game) {
  const L = game.ship; let best = null; let bd = -1;
  for (const c of kandidaten(game)) { const d = dist(L.x, L.y, c.x, c.y); if (d > bd) { bd = d; best = c; } }
  return best || { x: game.space.w / 2, y: game.space.h / 2, virtuell: true };
}

// ---------- Einrichten ----------
// o: { klasse (frachter|korvette|fregatte|kreuzer; Standard korvette), volk? ('ger'|'rom'|'pirat'), name?, tempo? (Anteil der Höchstfahrt, Daten: flucht.tempoMin–tempoMax),
//      wiederholung? (Standard AUS: die Faden-Schnittstelle bleibt bei Scheitern stehen; der Labor-Baustein setzt sie ausdrücklich), fluchtpunkt? { x, y } (sonst gewählt) }
// Rückgabe: der Zustand, oder null wenn abgelehnt (unbekannte Klasse, eine Verfolgung läuft schon). Eine laufende Verfolgung wird nie überschrieben.
function starten(game, o) {
  const q = o || {};
  const klasse = q.klasse == null ? ZIEL.klasse : q.klasse;
  if (!KLASSEN.includes(klasse)) return null;
  if (aktiv(game) && !ausgang(game)) return null;
  const fpV = q.fluchtpunkt && Number.isFinite(q.fluchtpunkt.x) && Number.isFinite(q.fluchtpunkt.y)
    ? { x: Math.round(q.fluchtpunkt.x), y: Math.round(q.fluchtpunkt.y), virtuell: !!q.fluchtpunkt.virtuell } : fluchtpunktWaehlen(game);
  const tempo = q.tempo != null ? clamp(Number(q.tempo) || FLUCHT.tempo, FLUCHT.tempoMin, FLUCHT.tempoMax) : null;
  game.space.verfolgung = { ziel: null, klasse, volk: q.volk || null, name: q.name ? String(q.name).slice(0, 20) : null, tempo, wiederholung: q.wiederholung === true,
    fluchtpunkt: fpV, ausgang: null, szene: game.ship.scene, versuch: 1, verz: 0, trLast: 0, stellT: 0, neuAt: null, ansagt: [] };
  stats(game).starts++;
  Zielsysteme.szeneAn(game, true);   // beide Seiten gleiche Regeln: gezielte und ungezielte Systemtreffer in dieser Szene
  spawnen(game);
  return game.space.verfolgung;
}
function spawnen(game) {
  const k = st(game); const S = space(); const L = game.ship; const sp = game.space;
  const fp = k.fluchtpunkt;
  const head = Math.atan2(fp.y - L.y, fp.x - L.x);
  const m = ZIEL.randAbstand;
  const x = clamp(L.x + Math.cos(head) * ZIEL.startAbstand, m, sp.w - m), y = clamp(L.y + Math.sin(head) * ZIEL.startAbstand, m, sp.h - m);
  const e = S.spawnEnemy(game, k.klasse, { x, y, facing: Math.atan2(fp.y - y, fp.x - x), tag: 'verfolgung', volk: k.volk || undefined });
  e.fluchtZiel = { x: fp.x, y: fp.y };
  if (k.tempo != null) e.fluchtTempo = k.tempo;
  if (k.name) e.name = k.name;
  if (GEGNER.zielenAufAntrieb) e.zielsystem = SYSTEM_ZIEL;   // Zielsystem des Gegners (Daten: lerche = engines): der Schütze trifft das Heck der Lerche gezielt
  e.sprung = null;
  k.ziel = e.id; k.ausgang = null; k.verz = 0; k.trLast = e.sysTreffer || 0; k.stellT = 0; k.neuAt = null; k.ansagt = []; k.t0 = game.time;
  game.oda(`${labelVon(k, e)} dreht ab und flieht${fp.virtuell ? '' : ' zum Sprungpunkt'}! Antrieb treffen, bevor die Sprungladung fertig ist.`, null);
  game.missionEvent('verfolgungStart', { enemy: e, klasse: k.klasse, name: k.name, versuch: k.versuch });
  return e;
}
// Das Ziel ist weg (Sprung, neues Ziel): Ziel der Ops und ihr Systemziel gehen mit ihm
function abgeben(game, e) {
  if (game.ship.target === e.id) { Zielsysteme.zielLoeschen(game); }
}
// Wiederholung: Rest des Zielschiffs weg, ein neues am Start
function neu(game) {
  const k = st(game); if (!k) return;
  const alt = lebt(game, k.ziel);
  game.space.enemies = game.space.enemies.filter((e) => e.id !== k.ziel);
  if (alt) abgeben(game, alt);
  k.versuch++;
  k.fluchtpunkt = fluchtpunktWaehlen(game);
  game.oda('Ein neues Zielschiff dreht ab – diesmal nicht entkommen lassen.', null);
  spawnen(game);
}

// ---------- Tick (aus space.update, nach updateEnemies) ----------
function update(game, dt) {
  const k = st(game);
  if (!k) return;
  if (k.szene !== game.ship.scene) { delete game.space.verfolgung; return; }   // Szene verlassen: die Verfolgung ist vorbei
  if (k.ausgang) { if (k.ausgang === 'entkommen' && k.wiederholung && k.neuAt != null && game.time >= k.neuAt) neu(game); return; }
  const e = lebt(game, k.ziel);
  if (!e) { setzeAusgang(game, k, Gegnersprung.istEntkommen(game, k.ziel) ? 'entkommen' : 'zerstoert'); return; }   // Notfallsprung (Baustein) ist Entkommen, kein Abschuss
  const L = game.ship; const fp = k.fluchtpunkt;
  const aus = Zielsysteme.ausgefallen(e, SYSTEM_ZIEL);
  // Reaktor zerstört (C1b-1): die Sprungladung bricht ab, der Countdown läuft weiter; ohne Reaktor kein neuer Ladeversuch
  const reaktorAus = Gsys.reaktorZerstoert(e);
  if (reaktorAus && e.sprung != null) { e.sprung = null; k.verz = 0; }
  // Ankunft am Fluchtpunkt: die Sprungladung beginnt (ohne Schub nicht)
  if (e.sprung == null && !aus && !reaktorAus && dist(e.x, e.y, fp.x, fp.y) <= FLUCHT.ankunftRadius) {
    e.sprung = 0; k.verz = 0; k.trLast = e.sysTreffer || 0;
    game.emit('sfx', { name: 'jump_charge' });
    game.oda(funkText('sprungStart', k, e), null);
    funkZeile(game, funkText('sprungStart', k, e));
    game.missionEvent('verfolgungSprungStart', { enemy: e, text: funkText('sprungStart', k, e) });
  }
  if (e.sprung != null) {
    // zweiter Weg zum Stellen: jeder Systemtreffer (Integrität eines Systems gesenkt) verzögert die Ladung, je Treffer
    const neu = (e.sysTreffer || 0) - k.trLast;
    if (neu > 0) k.verz = Math.min(SPRUNG.verzoegerungMax, k.verz + neu * SPRUNG.verzoegerungJeTreffer);
    k.trLast = e.sysTreffer || 0;
    const dauer = SPRUNG.dauer + k.verz;
    if (!(aus && SPRUNG.pausiertBeiAusfall)) e.sprung += dt;
    e.sprungDauer = dauer;
    for (const s of ANSAGEN) if (dauer - e.sprung <= s && !k.ansagt.includes(s)) { k.ansagt.push(s); game.oda(`${labelVon(k, e)} springt in etwa ${s} s!`, null); }
    if (e.sprung >= dauer) return springen(game, k, e);
  }
  // Stellen: Antrieb aus und die Lerche nah genug, seit stellen.zeit s
  k.stellT = aus && dist(e.x, e.y, L.x, L.y) <= STELLEN.radius ? k.stellT + dt : 0;
  if (k.stellT >= STELLEN.zeit) gestellt(game, k, e);
}
function springen(game, k, e) {
  game.space.enemies = game.space.enemies.filter((o) => o !== e);
  abgeben(game, e);
  game.emit('sfx', { name: 'jump' });
  setzeAusgang(game, k, 'entkommen');
}
function gestellt(game, k, e) {
  e.fluchtZiel = null; e.sprung = null; e.sprungDauer = null;
  Zielsysteme.halte(e);   // ein gestelltes Schiff bleibt ausgefallen (die Reparatur bleibt aus, C2)
  setzeAusgang(game, k, 'gestellt');
}
function setzeAusgang(game, k, was) {
  k.ausgang = was;
  stats(game)[was]++;
  const e = lebt(game, k.ziel);
  const text = funkText(was, k, e);
  game.oda(text, null);
  funkZeile(game, text);
  game.missionEvent('verfolgungAusgang', { was, klasse: k.klasse, name: k.name, volk: k.volk, versuch: k.versuch, text });
  if (was === 'entkommen' && k.wiederholung) k.neuAt = game.time + WDH.neuNach;
}
// Regiebuch-Überspringen (Baustein verfolgung_ende): die Szene gilt als geschafft, das Zielschiff ist weg
function erzwingen(game) {
  const k = st(game); if (!k) return false;
  if (!k.ausgang || k.ausgang === 'entkommen') {
    k.neuAt = null;
    const e = lebt(game, k.ziel);
    if (e) { e.fluchtZiel = null; e.sprung = null; }
    setzeAusgang(game, k, 'gestellt');
  }
  return true;
}

// ---------- Snapshot ----------
// Je Gegner: sj = Fortschritt der Sprungladung 0..1, nm = Name (nur das Zielschiff). Je Szene: vf = Fluchtpunkt { x, y, r (Ankunftsradius) } (space.vf)
function snapExtra(e) {
  if (!e || !e.fluchtZiel) return null;
  const o = {};
  if (e.sprung != null) o.sj = r2(Math.min(1, e.sprung / (e.sprungDauer || SPRUNG.dauer)));
  if (e.name) o.nm = String(e.name).slice(0, 20);
  return Object.keys(o).length ? o : null;
}
function snapshot(game) {
  const k = st(game);
  return k && !k.ausgang ? { x: k.fluchtpunkt.x, y: k.fluchtpunkt.y, r: FLUCHT.ankunftRadius } : null;
}

// ---------- Debug: verfolgung [klasse] [ohne] ----------
function debug(game, args) {
  const a = Array.isArray(args) ? args.map(String) : [];
  if (game.ship.docked) return 'Nicht angedockt.';
  if (aktiv(game) && !ausgang(game)) return 'Läuft schon eine Verfolgung.';
  const klasse = a.find((x) => x !== 'ohne');
  return starten(game, { klasse, wiederholung: !a.includes('ohne') }) ? null : `Die Zielklasse ${klasse} gibt es hier nicht (${KLASSEN.join(', ')}).`;
}

// Fluchtverhalten des Pilot-Modells (pilot.js flucht): Halt am Ziel, wendige Kursänderung, Mindestfahrten (Daten: flucht)
const haltAbstand = () => FLUCHT.haltAbstand, wendeSchwelle = () => FLUCHT.wendeSchwelle, wendeTempoMin = () => FLUCHT.wendeTempoMin, stufeMinTempo = () => FLUCHT.stufeMinTempo;

module.exports = { starten, neu, update, erzwingen, debug, aktiv, ausgang, erfolg, ausgangIst, ziel, fluchtpunkt, fluchtZiel, pilotTempo, legacyTempo, haltAbstand, wendeSchwelle, wendeTempoMin, stufeMinTempo, snapExtra, snapshot,
  fluchtpunktWaehlen, kandidaten, AUSGAENGE, KLASSEN, SYSTEM_ZIEL };
