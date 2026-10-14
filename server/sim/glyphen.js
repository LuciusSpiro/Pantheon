'use strict';
// SL10 (CONCEPT-SL10): Glyphen/Sternkarte – kooperatives Minispiel für die Vorläufer-Boje (Frequenz und Adresse). Der Captain sieht die Konstellation
// (Muster aus 5 von 9 Sternen), die Ops setzt sie nach seiner Ansage auf ihrem Glyphenfeld nach und sendet. Die Ops bekommt nach jedem Senden nur die Zahl
// der richtig und der falsch gesetzten Sterne zurück (wie ein Schloss): Kommunikation Captain ↔ Ops, nicht Geschicklichkeit.
//
//   starten(game, { id })       Aufgabe legt ein neues Muster an (z 1 = läuft), id z. B. 'boje'
//   waehle(game, p, i)          Ops: Stern i (0..8) setzen/lösen (weapons.glyphen.waehle)
//   senden(game, p)             Ops: Auswahl senden (weapons.glyphen.senden); richtig = gelöst, sonst Rückmeldung treffer/falsch
//   abbrechen(game)             Aufgabe verwerfen (Regiebuch, Wiederholung)
//   ergebnis(game, id)          Qualität 0..3 | null (Fakt glyphen_<id> nach dem Laden); Qualität = Versuche (1 → 3, ≤ 3 → 2, ≤ 6 → 1, sonst 0)
//   snapshot(game)              Feld `gl` { i, z, w (Auswahl 9 Zeichen), v, t, f, m (Muster, wird nur dem Captain gezeichnet), q } | null
// Das Muster steht im Snapshot für alle (die Anzeige zeigt es nur dem Captain); Zwischenstand wird nicht gespeichert, das Ergebnis steht als Fakt.
const Station = require('./station.js');

const N = 9, K = 5;
const r2 = (v) => Math.round(v * 100) / 100;

function reset(game) { game.glyphen = null; game.glyphenErgebnis = {}; }
const ops = (p) => Station.stationOf(p) === 'weapons';

function muster(game) {
  const idx = Array.from({ length: N }, (_, i) => i);
  game.rng.shuffle(idx);
  return idx.slice(0, K).sort((a, b) => a - b);
}

function starten(game, a) {
  const id = String((a && a.id) || 'boje');
  if (game.glyphen && game.glyphen.z === 1 && game.glyphen.id === id) return null;   // läuft schon
  game.glyphen = { id, z: 1, muster: muster(game), wahl: Array(N).fill(false), v: 0, t: null, f: null, q: null };
  if (game.mission && typeof game.mission.radio === 'function') game.mission.radio('ODA', 'Vorläufer-Adresse: Der Captain sieht die Konstellation, die Ops setzt sie nach seiner Ansage (Glyphenfeld).', false);
  game.missionEvent('glyphenStart', { id });
  return null;
}
function abbrechen(game) { game.glyphen = null; return null; }

function waehle(game, p, i) {
  const g = game.glyphen;
  if (!g || g.z !== 1) return 'Keine Adresse einzugeben.';
  if (!ops(p)) return 'Das Glyphenfeld bedient die Ops.';
  const k = Math.round(Number(i));
  if (!(k >= 0 && k < N)) return 'Stern gibt es nicht.';
  g.wahl[k] = !g.wahl[k]; g.t = null; g.f = null;
  game.emit('sfx', { name: 'ui_click' });
  return null;
}

function senden(game, p) {
  const g = game.glyphen;
  if (!g || g.z !== 1) return 'Keine Adresse einzugeben.';
  if (!ops(p)) return 'Das Glyphenfeld bedient die Ops.';
  g.v++;
  const soll = new Set(g.muster);
  let t = 0, f = 0;
  g.wahl.forEach((on, i) => { if (on) { if (soll.has(i)) t++; else f++; } });
  g.t = t; g.f = f;
  if (t === K && f === 0) {
    g.z = 2; g.q = g.v === 1 ? 3 : g.v <= 3 ? 2 : g.v <= 6 ? 1 : 0;
    game.glyphenErgebnis[g.id] = g.q;
    const ws = game.weltstand;
    if (ws && typeof ws.fact === 'function') ws.fact('glyphen_' + g.id, g.q, 'Glyphen');
    game.emit('sfx', { name: 'scan_done' });
    game.oda('Adresse bestätigt: die Vorläufer-Boje antwortet.', null);
    game.missionEvent('glyphenGeloest', { id: g.id, versuche: g.v, qualitaet: g.q });
  } else {
    game.emit('sfx', { name: 'ui_error' });
    game.missionEvent('glyphenFalsch', { id: g.id, treffer: t, falsch: f });
  }
  return null;
}

function ergebnis(game, id) {
  const q = game.glyphenErgebnis && game.glyphenErgebnis[id];
  if (q != null) return q;
  const f = game.weltstand && game.weltstand.data && game.weltstand.data.fakten ? game.weltstand.data.fakten['glyphen_' + id] : null;
  return typeof f === 'number' ? f : null;
}

function snapshot(game) {
  const g = game.glyphen; if (!g) return null;
  const o = { i: g.id, z: g.z, w: g.wahl.map((b) => (b ? '1' : '0')).join(''), v: g.v };
  if (g.t != null) { o.t = g.t; o.f = g.f; }
  if (g.z === 1) { const m = Array(N).fill('0'); for (const i of g.muster) m[i] = '1'; o.m = m.join(''); }
  else if (g.z === 2) o.q = g.q;
  return o;
}
void r2;

module.exports = { N, K, reset, starten, abbrechen, waehle, senden, ergebnis, snapshot };
