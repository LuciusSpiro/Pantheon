'use strict';
// EK4 (CONTRACT-EK4): Flotte – Verbündete, Befehle des Legaten, Wellen, Funk, Gedächtnis.
//
//   Verbündete sind Einträge in game.space.escorts mit ally: true (escort.js: Treffer, Ziel der Gegner, Sprung, Snapshot). In EK4a
//   bewegt sie das Regiebuch (skript: halten | folgen | ziel), in EK4b fliegen und feuern sie selbst (KI-Rolle, siehe unten).
//   Befehle (game.flotte.befehl) sind Szenenziele: Fortschritt NUR durch erreichte Ziele.
//     ausschalten   Ziel (Tag oder Klasse) n-mal zerstört
//     eskortieren   ein Schiff (schiff) erreicht nacheinander die Wegpunkte; es wartet, wenn die Lerche über die Leine zurückfällt
//     durchbrechen  die Lerche erreicht nacheinander die Wegpunkte
//     zurueckfallen die Lerche erreicht nacheinander die Wegpunkte (Rückzugslinie)
//     entlastung    n Abschüsse, während die Lerche höchstens radius px vom Schiff entfernt ist
//   Scheitern: Frist abgelaufen (zeit), Schiff verloren (schiff), Notfallprotokoll der Lerche (notfall). Welle um Welle (wellen):
//   nach abgelaufener Frist kommt Überdruck – die Szene darf scheitern, der Feldzug nie (das Regiebuch verzweigt: fliehen oder neustart).
//   Gedächtnis des Legaten (Weltstand, npc.legat): befolgt | eigenmaechtig | im_stich (+ Fakt flotte_<tag> = verloren).
//   Alle Funktexte kommen aus content/flotte/funktexte.json.
//   EK4b: Verbündete mit eigener KI (rolle begleiter | angreifer; skript = EK4a, nur Regiebuch): Flug über die Klassen-KI der Gegner (pilot.js, Ziel =
//   ein Gegner), Feuer aus den Waffenplätzen der Klasse (Geschoss kind 'ally', trifft nur Gegner – kein Eigenbeschuss), Gegner dürfen sie anvisieren,
//   höchstens CONFIG.flotte.max Schiffe je Szene (mehr kommt als Nachschub), Einblenden mit Sprungblitz, Sprung der Flotte (auch Notfallsprung), Minen.
const fs = require('fs');
const path = require('path');
const Physics = require('../../shared/physics.js');

let escortMod = null; const escort = () => escortMod || (escortMod = require('./escort.js'));
let spaceMod = null; const space = () => spaceMod || (spaceMod = require('./space.js'));
let pilotMod = null; const pilot = () => pilotMod || (pilotMod = require('./pilot.js'));
let alarmMod = null; const alarm = () => alarmMod || (alarmMod = require('./alarm.js'));
const ROLLEN = ['begleiter', 'angreifer', 'skript'];

const TEXTE_FILE = path.join(__dirname, '..', '..', 'content', 'flotte', 'funktexte.json');
const ARTEN = ['ausschalten', 'eskortieren', 'durchbrechen', 'zurueckfallen', 'entlastung'];
const WEGPUNKT_ARTEN = ['eskortieren', 'durchbrechen', 'zurueckfallen'];
const MODI = ['halten', 'folgen', 'ziel'];
const PORTRAITS = new Set(['legat', 'mars']);
const ART_NAMEN = { ausschalten: 'Ausschalten', eskortieren: 'Eskortieren', durchbrechen: 'Durchbrechen', zurueckfallen: 'Zurückfallen', entlastung: 'Entlastung' };
const GRUND_TEXT = { zeit: 'gescheitert_zeit', schiff: 'gescheitert_schiff', notfall: 'gescheitert_notfall' };

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const hyp = Math.hypot;
const r1 = (v) => Math.round(v * 10) / 10;
const cfg = (game) => game.C.flotte || {};
const bcfg = (game) => Object.assign({ radius: 170, leine: 450, abweichDist: 950, abweichSek: 25, abweichRueck: 600, imStichDist: 700,
  entlastung: { radius: 420, abschuesse: 4 }, frist: {} }, cfg(game).befehl || {});

// ---------- Daten (Funktexte) ----------
let texteCache = null;
function texte() {
  if (texteCache) return texteCache;
  try { texteCache = JSON.parse(fs.readFileSync(TEXTE_FILE, 'utf8')); } catch (e) { texteCache = { schiffe: {}, allgemein: {}, erinnerung: {}, befehle: {}, meldungen: {} }; }
  return texteCache;
}
function fmt(t, vars) { return String(t == null ? '' : t).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? vars[k] : m)); }

// ---------- Zustand ----------
function neu() { return { befehl: null, hist: [], welle: null, nachschub: [], stats: { befehle: 0, erfuellt: 0, gescheitert: 0, verloren: 0, hilferufe: 0, wellen: 0, nachschub: 0, schuesse: 0, treffer: 0, hoechst: 0 } }; }
function state(game) { return game.flotte || (game.flotte = neu()); }
function lerche(game) { return game.ship; }
const allies = (game) => ((game.space && game.space.escorts) || []).filter((q) => q.ally);
const alliesActive = (game) => allies(game).filter((q) => escort().active(q));
const crewN = (game) => Math.max(1, Math.min(3, game.players.filter((p) => p.connected).length));

// ---------- Funk (ohne Missionszustand: ein offener Funkspruch der Mission bleibt stehen) ----------
// sprecher: { id?, name }. Mit id legat | mars zeigt der Client das Porträt bzw. das Symbol.
function funk(game, sprecher, text) {
  if (!text) return;
  const sp = sprecher || {};
  const ev = { from: String(sp.name || 'Funk'), text: String(text) };
  if (sp.id && PORTRAITS.has(sp.id)) ev.pid = sp.id;
  game.emit('radio', ev);
  game.emit('sfx', { name: 'radio' });
}
function npcName(id) {
  try { return require('../mission/loader.js').npcName(id); } catch (e) { return id; }
}
function sprecherVon(game, es) {
  const d = texte().schiffe && texte().schiffe[es.tag];
  if (d && d.sprecher) return d.sprecher;
  if (es.npc) return { id: es.npc, name: npcName(es.npc) };
  return { name: es.name };
}
const legatSprecher = (id) => ({ id: id || 'legat', name: npcName(id || 'legat') });

// ---------- Weltstand: Gedächtnis des Legaten, Fakten ----------
function ensureNpc(game, id) {
  const w = game.weltstand;
  if (!w || !w.data || !w.data.npc) return null;
  if (!w.data.npc[id]) {   // Stand aus der Zeit vor EK4: NSC aus npc.json nachtragen
    try {
      const n = require('../mission/loader.js').npcData().npc[id];
      if (n) w.data.npc[id] = Object.assign({ name: String(n.name || id), fraktion: String(n.fraktion || 'unbekannt'), status: n.status || 'lebt', haltung: Math.round(Number(n.haltung) || 0), gedaechtnis: [] },
        n.titel != null ? { titel: String(n.titel) } : {}, n.rolle != null ? { rolle: String(n.rolle) } : {});
    } catch (e) { /* ohne Datensatz kein Gedächtnis */ }
  }
  return w.data.npc[id] || null;
}
function erinnern(game, npc, ereignis, text, opts) {
  const w = game.weltstand; const o = opts || {};
  if (!w || typeof w.npcMemory !== 'function' || !ensureNpc(game, npc)) return false;
  try { return w.npcMemory(npc, { ereignis, text: String(text).slice(0, 200), haltung: o.haltung, gewicht: o.gewicht }); } catch (e) { if (game.countError) game.countError('flotte-gedaechtnis', e); return false; }
}
function fakt(game, key, value, quelle) {
  const w = game.weltstand;
  if (w && typeof w.fact === 'function') { try { w.fact(key, value, quelle || 'flotte'); } catch (e) { if (game.countError) game.countError('flotte-fakt', e); } }
}
function chronik(game, text) {
  const w = game.weltstand;
  if (w && typeof w.chronicle === 'function') { try { w.chronicle(text); } catch (e) { if (game.countError) game.countError('flotte-chronik', e); } }
}
function flag(game, key, v) { const f = game.mission && game.mission.flags; if (f) f[key] = v; }
// Hat das Schiff diesen Feldzug schon verloren? (Weltstand-Fakt flotte_<tag>)
function verloren(game, tag) {
  const w = game.weltstand;
  return !!(w && w.data && w.data.fakten && w.data.fakten['flotte_' + tag] === 'verloren');
}
// Erinnerung des Legaten: 'im_stich' vor 'eigenmaechtig' vor 'befolgt' (Flags im Regiebuch bzw. Prüfung legat_erinnert)
function erinnerung(game) {
  const f = (game.mission && game.mission.flags) || {};
  if (f.legat_im_stich) return 'im_stich';
  if (f.legat_eigenmaechtig) return 'eigenmaechtig';
  if (f.legat_befolgt) return 'befolgt';
  return null;
}
function erinnerungText(game, art) {
  const k = art || erinnerung(game);
  const t = (texte().erinnerung || {})[k];
  if (!t) return null;
  return fmt(t, { schiff: (state(game).letzterVerlust) || 'Flotte' });
}

// ---------- Verbündete ----------
// opts: { tag, kind?, name?, npc?, von?, huelle?, modus?, ersatz?, rolle?, auftauchen?, volk? (Kennung, Standard CONFIG.kennung.verbuendet) } -> Schiff | null (verloren und kein Ersatz)
// rolle: begleiter (Standard) | angreifer | skript (EK4a: keine KI, kein Feuer). auftauchen: Sprungblitz, Einblenden (unverwundbar CONFIG.flotte.einblenden.dauer s)
function aufstellen(game, opts) {
  const o = opts || {};
  state(game);
  const tag = String(o.tag || 'verbuendeter');
  const d = (texte().schiffe || {})[tag] || {};
  if (verloren(game, tag) && !o.ersatz) {
    flag(game, tag + '_verloren', true); flag(game, tag + '_heil', false); flag(game, tag + '_beschaedigt', false);
    game.emit('flotteFehlt', { tag });
    return null;
  }
  const es = escort().spawn(game, { tag, kind: o.kind || 'korvette', name: o.name || d.name, npc: o.npc || d.npc || null, von: o.von != null ? o.von : 'lerche', huelle: o.huelle, ally: true, volk: o.volk || d.volk });
  if (!es) return null;
  es.slot = allies(game).length - 1;
  es.rolle = ROLLEN.includes(o.rolle) ? o.rolle : (kcfg(game).rolle || 'begleiter');
  if (o.auftauchen) {
    es.einBis = game.time + (Number((cfg(game).einblenden || {}).dauer) || 2.5);
    game.emit('allyEintritt', { id: es.id, tag: es.tag, name: es.name, x: Math.round(es.x), y: Math.round(es.y), dauer: Number((cfg(game).einblenden || {}).dauer) || 2.5 });
    game.emit('sfx', { name: 'jump' });
    funk(game, sprecherVon(game, es), fmt(((texte().schiffe || {})[es.tag] || {}).auftauchen || (texte().allgemein || {}).auftauchen, { name: es.name }));
  }
  const T = cfg(game).hilferuf || {};
  for (const lim of [Number(T.schwer) || 0.4, Number(T.kritisch) || 0.15]) if (es.hp / es.hpMax < lim && !es.warned.includes(lim)) es.warned.push(lim);
  if (o.ersatz) fakt(game, 'flotte_' + tag, 'ersatz');
  if (o.modus && MODI.includes(o.modus)) es.skript = { modus: o.modus };
  game.missionEvent('allySpawn', { escort: es });
  return es;
}
// Winkel der Formationsplätze hinter der Lerche (abwechselnd Backbord/Steuerbord)
function slotWinkel(i) { return (i % 2 ? 1 : -1) * (0.5 + 0.4 * Math.floor(i / 2)); }
// Skript eines Verbündeten (tag null = alle): halten | folgen | ziel (punkt, leine?, r?, tempo?)
function modus(game, tag, m, punkt, o) {
  if (!MODI.includes(m)) return false;
  const list = tag == null || tag === '' ? alliesActive(game) : [escort().find(game, tag)].filter((q) => q && q.ally);
  if (!list.length) return false;
  let p = null;
  if (m === 'ziel') { p = escort().point(game, punkt); if (!p || p.x == null) return false; }
  for (const es of list) es.skript = m === 'ziel' ? Object.assign({ modus: m, x: p.x, y: p.y, erreicht: false }, o || {}) : { modus: m };
  return true;
}
// Wunschpunkt für escort.stepEscort (aus escort.goalFor): null = anhalten
function goalFor(game, es, c) {
  const L = lerche(game); const max = c.maxSpeed;
  const k = es.skript || (es.skript = { modus: 'folgen' });
  if (k.modus === 'halten') return null;
  if (k.modus === 'ziel') {
    const dz = hyp(k.x - es.x, k.y - es.y);
    const r = k.r || bcfg(game).radius * 0.6;
    if (dz < r) { k.erreicht = true; return null; }
    k.erreicht = false;
    if (k.leine && hyp(L.x - es.x, L.y - es.y) > k.leine) { k.wartet = true; return null; }   // Lerche zurückgefallen: wartet
    k.wartet = false;
    return { x: k.x, y: k.y, speed: max * (k.tempo || 0.6), stopDist: 20 };
  }
  // folgen: Formationsplatz hinter der Lerche
  const slot = es.slot || 0;
  const back = L.angle + Math.PI + slotWinkel(slot);
  const dist = 200 + 60 * Math.floor(slot / 2);
  const gx = L.x + Math.cos(back) * dist, gy = L.y + Math.sin(back) * dist;
  const d = hyp(gx - es.x, gy - es.y);
  const Lv = hyp(L.vx || 0, L.vy || 0);
  return { x: gx, y: gy, speed: clamp(Lv + d * 0.4, 0, max), stopDist: 30 };
}

// ---------- Hilferuf und Verlust ----------
function hilferufTexte(game, es) {
  const d = (texte().schiffe || {})[es.tag];
  return (d && d.hilferuf) || (texte().allgemein || {}).hilferuf || [];
}
// aus escort.hit: Hüllenanteil f0 -> f1; jeder Ruf kommt je Schiff einmal
function allyHit(game, es, f0, f1) {
  const T = cfg(game).hilferuf || {};
  const lims = [Number(T.schwer) || 0.4, Number(T.kritisch) || 0.15];
  const tx = hilferufTexte(game, es);
  for (let i = 0; i < lims.length; i++) {
    const lim = lims[i];
    if (!(f0 >= lim && f1 < lim) || es.warned.includes(lim)) continue;
    es.warned.push(lim);
    const e = tx.find((x) => Math.abs((Number(x.unter) || 0) - lim) < 1e-6) || tx[i];
    state(game).stats.hilferufe++;
    game.emit('escortDistress', { id: es.id, hpFrac: Math.round(f1 * 100) / 100 });
    game.emit('allyDistress', { id: es.id, tag: es.tag, kritisch: i === 1 || undefined });
    game.emit('sfx', { name: 'distress' });
    game.missionEvent('escortDistress', { escort: es, pct: Math.round(lim * 100) });
    funk(game, sprecherVon(game, es), fmt(e && e.text, { name: es.name }) || `${es.name}: Hülle bei ${Math.round(f1 * 100)} %!`);
  }
}
// aus escort.disable: ein Verbündeter ist zerstört. Das Schiff kommt nicht von selbst zurück, der Legat überlebt (Rettungskapsel).
function allyLost(game, es) {
  const st = state(game); const T = texte(); const E = escort();
  es.state = 'zerstoert'; es.ausgang = 'verloren'; es.distress = false; es.befehl = null; es.pending = null; es.weg = true; es.hp = 0;
  E.syncFlags(game, es);
  st.stats.verloren++; st.letzterVerlust = es.name;
  for (const e of game.space.enemies) if (e.targetId === es.id && e.tele && e.tele.tgt === es.id) { e.tele = null; e.fireT = 0; game.emit('teleMiss', { id: e.id }); }
  const Lr = lerche(game); const dLerche = hyp(Lr.x - es.x, Lr.y - es.y);
  game.emit('explosion', { x: Math.round(es.x), y: Math.round(es.y), zone: 'space' });
  game.emit('sfx', { name: 'explosion_big' });
  game.emit('sfx', { name: 'escort_lost' });
  game.emit('allyLost', { id: es.id, tag: es.tag, name: es.name, x: Math.round(es.x), y: Math.round(es.y), kapsel: (cfg(game).kapsel || {}).dauer || 14 });
  game.oda(`${es.name} ist zerstört. Rettungskapsel ausgestoßen.`, null);
  const d = (T.schiffe || {})[es.tag] || {};
  funk(game, sprecherVon(game, es), fmt(d.zerstoert || (T.allgemein || {}).zerstoert, { name: es.name }));
  // Weltstand: Fakt (kein Schiff ohne Aufgabe zurück), Gedächtnis des Eigners (sonst Legat), Chronik
  // (nicht für Schiffe einer Sim-Szene, es.sim: dort gelten die Wirkungen auf die Weltsimulation, kein Gedächtnis des Legaten)
  if (!es.sim) {
    fakt(game, 'flotte_' + es.tag, 'verloren');
    const eigner = es.npc || 'legat';
    erinnern(game, eigner, 'schiff_verloren', `${es.name} zerstört, ich bin in der Rettungskapsel entkommen.`, { gewicht: 3 });
    chronik(game, `${es.name} wurde zerstört. Die Besatzung rettete sich in Kapseln.`);
    // im Stich gelassen: die Lerche war weit weg, als das Schiff fiel
    if (dLerche > bcfg(game).imStichDist) imStich(game, es);
  }
  game.missionEvent('escortDisabled', { escort: es });
  game.missionEvent('allyLost', { escort: es });
}
function imStich(game, es) {
  flag(game, 'legat_im_stich', true);
  const t = fmt((texte().erinnerung || {}).im_stich, { schiff: es.name });
  erinnern(game, 'legat', 'im_stich', `${es.name} fiel, die Lerche war zu weit weg: ${t}`, { haltung: -2, gewicht: 3 });
  game.emit('flotteGedaechtnis', { art: 'im_stich', schiff: es.tag });
}

// ---------- Befehle ----------
function parsePunkte(game, punkte) {
  let L = punkte;
  if (typeof L === 'string') L = L.split(/[;|]/).map((s) => s.trim()).filter(Boolean);
  if (!Array.isArray(L)) return [];
  const out = [];
  for (const sp of L) {
    let spec = sp;
    if (typeof sp === 'string' && /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(sp)) { const [x, y] = sp.split(',').map(Number); spec = { x, y }; }
    const p = escort().point(game, spec);
    if (p && p.x != null) out.push({ x: Math.round(p.x), y: Math.round(p.y) });
  }
  return out;
}
// spec: { art, schiff?, ziel?, n?, punkte?, radius?, frist?, sprecher? (NSC-Kennung), text? } -> Befehl | null
function befehl(game, spec) {
  const s = spec || {};
  if (!ARTEN.includes(s.art)) return null;
  const st = state(game); const B = bcfg(game);
  const prev = st.befehl;
  if (prev && prev.st === 0) { prev.st = 3; prev.ende = game.time; prev.grund = 'abgeloest'; }
  const b = { id: game.nextId('bf'), art: s.art, scene: game.ship.scene, t0: game.time, st: 0, schiff: s.schiff || null, ziel: s.ziel || null,
    n: 1, k: 0, radius: Number(s.radius) > 0 ? Number(s.radius) : (s.art === 'entlastung' ? B.entlastung.radius : B.radius), frist: 0, wp: [], idx: 0,
    sprecher: s.sprecher || 'legat', abweichT: 0, abgewichen: false, best: Infinity, em0: game.stats.emergencies || 0, warnT: -99, spec: { art: s.art, schiff: s.schiff, ziel: s.ziel, n: s.n, punkte: s.punkte, radius: s.radius, frist: s.frist, sprecher: s.sprecher } };
  if (s.art === 'ausschalten') b.n = Math.max(1, Math.round(Number(s.n) || 1));
  else if (s.art === 'entlastung') b.n = Math.max(1, Math.round(Number(s.n) || B.entlastung.abschuesse));
  else b.n = 1;
  if (WEGPUNKT_ARTEN.includes(s.art)) b.wp = parsePunkte(game, s.punkte).map((p) => Object.assign(p, { ok: false }));
  if (WEGPUNKT_ARTEN.includes(s.art) && !b.wp.length) return null;
  const fr = s.frist != null ? Number(s.frist) : Number((B.frist || {})[s.art]) || 0;
  b.frist = fr > 0 ? fr : 0;
  st.befehl = b; st.stats.befehle++;
  if (s.art === 'eskortieren') eskortFuehren(game, b);
  game.emit('flotteBefehl', { id: b.id, art: b.art, st: 0, frist: b.frist || undefined });
  game.missionEvent('befehlErteilt', { befehl: b.art, id: b.id });
  return b;
}
function schiffVon(game, b) { return b.schiff ? escort().find(game, b.schiff) : null; }
// Eskort: das Schiff fliegt den nächsten Wegpunkt an, wartet an der Leine
function eskortFuehren(game, b) {
  const es = schiffVon(game, b); const p = b.wp[b.idx];
  if (!es || !es.ally || !p) return;
  es.skript = { modus: 'ziel', x: p.x, y: p.y, leine: bcfg(game).leine, r: b.radius * 0.7, tempo: 0.55 };
}
function ende(game, b, ausgang, grund) {
  const st = state(game);
  if (b.st !== 0) return;
  b.st = ausgang === 'erfuellt' ? 1 : 2; b.ende = game.time; b.grund = grund || null;
  const M = texte().meldungen || {};
  const sp = legatSprecher(b.sprecher);
  if (b.st === 1) {
    st.stats.erfuellt++;
    flag(game, 'legat_befolgt', true);
    erinnern(game, b.sprecher, 'befehl_befolgt', `Befehl ${ART_NAMEN[b.art]} ausgeführt.`, { haltung: 1, gewicht: 1 });
    game.emit('sfx', { name: 'escort_saved' });
    game.oda(M.erfuellt || 'Befehl ausgeführt.', null);
  } else {
    st.stats.gescheitert++;
    const gt = M[GRUND_TEXT[grund]];
    if (gt) funk(game, sp, gt);
    // Überdruck: wer zu lange braucht, wird überrannt (Welle um Welle)
    if (grund === 'zeit' && st.welle && st.welle.ueberdruck) { st.welle.druck = true; st.welle.druckT = game.time; funk(game, sp, M.ueberdruck); }
  }
  st.hist.push({ art: b.art, st: b.st, grund: b.grund, t: r1(game.time) }); while (st.hist.length > 8) st.hist.shift();
  game.emit('flotteBefehl', { id: b.id, art: b.art, st: b.st, grund: b.grund || undefined });
  game.missionEvent(b.st === 1 ? 'befehlErfuellt' : 'befehlGescheitert', { befehl: b.art, id: b.id, grund: b.grund });
}
function onEnemyKilled(game, e) {
  const st = game.flotte; const b = st && st.befehl;
  if (!b || b.st !== 0 || !e) return;
  if (b.art === 'ausschalten') { if (e.tag === b.ziel || e.kind === b.ziel) b.k++; }
  else if (b.art === 'entlastung') {
    const es = schiffVon(game, b); const Lr = lerche(game);
    if (es && hyp(Lr.x - es.x, Lr.y - es.y) <= b.radius) b.k++;
  }
}
// Bezugspunkt für „weicht ab“: wo die Aufgabe liegt
function bezug(game, b) {
  if (WEGPUNKT_ARTEN.includes(b.art)) { const p = b.wp[b.idx]; return p ? { x: p.x, y: p.y, rel: true } : null; }
  if (b.art === 'entlastung') { const es = schiffVon(game, b); return es ? { x: es.x, y: es.y } : null; }
  if (b.art === 'ausschalten') {
    const Lr = lerche(game); let best = null, bd = Infinity;
    for (const e of game.space.enemies) { if (!(e.tag === b.ziel || e.kind === b.ziel)) continue; const d = hyp(e.x - Lr.x, e.y - Lr.y); if (d < bd) { bd = d; best = e; } }
    return best ? { x: best.x, y: best.y } : null;
  }
  return null;
}
function tickBefehl(game, b, dt) {
  const B = bcfg(game); const Lr = lerche(game);
  if (b.scene !== game.ship.scene) { b.st = 3; b.ende = game.time; b.grund = 'ort'; return; }
  if ((game.stats.emergencies || 0) > b.em0) { ende(game, b, 'gescheitert', 'notfall'); return; }
  if (b.schiff) { const es = schiffVon(game, b); if (!es || !escort().active(es)) { ende(game, b, 'gescheitert', 'schiff'); return; } }
  // Fortschritt – nur durch erreichte Ziele
  if (WEGPUNKT_ARTEN.includes(b.art)) {
    const p = b.wp[b.idx];
    const es = b.art === 'eskortieren' ? schiffVon(game, b) : null;
    const pos = es || Lr;
    if (p && hyp(pos.x - p.x, pos.y - p.y) <= b.radius) {
      p.ok = true; b.idx++; b.best = Infinity; b.abweichT = 0;
      game.emit('flotteWegpunkt', { id: b.id, i: b.idx, n: b.wp.length });
      game.emit('sfx', { name: 'escort_saved' });
      if (b.idx >= b.wp.length) { ende(game, b, 'erfuellt'); return; }
      if (b.art === 'eskortieren') eskortFuehren(game, b);
    }
    // Eskort: Lerche über der Leine -> das Schiff wartet, Hinweis (selten)
    if (es && es.skript && es.skript.wartet && game.time - b.warnT > 25) { b.warnT = game.time; game.oda(`${es.name} wartet auf die Lerche – dichter heranfliegen.`, null); }
  } else if (b.k >= b.n) { ende(game, b, 'erfuellt'); return; }
  if (b.frist > 0 && game.time - b.t0 >= b.frist) { ende(game, b, 'gescheitert', 'zeit'); return; }
  // eigenmächtig: die Lerche entfernt sich von der Aufgabe
  const ref = bezug(game, b);
  if (ref && !b.abgewichen) {
    const d = hyp(Lr.x - ref.x, Lr.y - ref.y);
    if (d < b.best) b.best = d;
    const weg = ref.rel ? d > b.best + B.abweichRueck : d > B.abweichDist;
    b.abweichT = weg ? b.abweichT + dt : Math.max(0, b.abweichT - dt * 2);
    if (b.abweichT >= B.abweichSek) {
      b.abgewichen = true;
      flag(game, 'legat_eigenmaechtig', true);
      funk(game, legatSprecher(b.sprecher), (texte().meldungen || {}).abgewichen);
      erinnern(game, b.sprecher, 'eigenmaechtig', `Die Lerche wich vom Befehl ${ART_NAMEN[b.art]} ab.`, { haltung: -1, gewicht: 2 });
      game.emit('flotteGedaechtnis', { art: 'eigenmaechtig' });
    }
  }
}

// ---------- Wellen (Welle um Welle) ----------
// spec: { wellen: 'raider:3,korvette:1|raider:4' | [[{kind,n,volk?}…]…], takt?, rest?, ziel?, richtung?, ueberdruck?, tag?, volk? }
// Kennung: je Gruppe 'kind:n:volk' (z. B. 'raider:2:pirat'), sonst spec.volk, sonst space.volkFuer (Fraktion des Sektors)
function parseWellen(w) {
  const raw = typeof w === 'string' ? w.split('|').map((g) => g.split(',').map((x) => { const [kind, n, volk] = x.trim().split(':'); const it = { kind: kind.trim(), n: Math.max(1, Math.round(Number(n) || 1)) }; if (volk) it.volk = volk.trim(); return it; }).filter((x) => x.kind)) : w;
  return Array.isArray(raw) ? raw.filter((g) => Array.isArray(g) && g.length) : [];
}
function wellenStart(game, spec) {
  const s = spec || {}; const W = cfg(game).wellen || {};
  const liste = parseWellen(s.wellen);
  if (!liste.length) return null;
  const st = state(game);
  st.welle = { id: game.nextId('wl'), liste, i: -1, takt: s.takt != null ? Number(s.takt) : Number(W.takt) || 0, rest: s.rest != null ? Number(s.rest) : Number(W.rest) || 0,
    ziel: s.ziel || 'auto', richtung: s.richtung || 'alle', ueberdruck: s.ueberdruck !== false, tag: s.tag || 'welle', volk: s.volk || null, t: game.time, druck: false, druckT: 0, fertig: false, n: 0, scene: game.ship.scene, spec: s };
  return st.welle;
}
// SUND-02a A2: Wellen einer Sim-Szene aus einem Wellenplan (server/weltsim/wellenplan.js: plane()). Eigene Funktion statt eines Flags an wellenStart:
// die Schiffsanzahl gilt UNSKALIERT (der Stärkewert der Sim ist die Vorgabe, nur die Hülle skaliert mit der Crew, space.spawnEnemy), die nächste Welle
// kommt, wenn höchstens restAnteil der vorigen lebt (Nachschub über der Grenze zählt mit), nie Überdruck. Das Finale (letzte Welle) beginnt mit dem
// Flaggschiff; trägt der Plan einen Kommandanten, trägt das Flaggschiff seinen Namen (Gegner.name) und die Marke flagg.
// spec: { plan: { wellen, flaggschiff }, volk?, ziel?, richtung?, tag?, vorlauf? (s bis Welle 1), restAnteil? } -> Welle | null
function wellenStartAusPlan(game, spec) {
  const s = spec || {}; const plan = s.plan;
  if (!plan || !Array.isArray(plan.wellen) || !plan.wellen.length) return null;
  const w = wellenStart(game, { wellen: plan.wellen, takt: 0, rest: 0, ziel: s.ziel, richtung: s.richtung, ueberdruck: false, tag: s.tag || 'szene', volk: s.volk });
  if (!w) return null;
  const anteil = Math.max(0, Number(s.restAnteil) || 0);
  w.ohneSkala = true;
  w.restJe = w.liste.map((g) => Math.floor(g.reduce((n, it) => n + it.n, 0) * anteil));
  if (Number(s.vorlauf) > 0) w.beginn = game.time + Number(s.vorlauf);
  if (plan.flaggschiff && plan.flaggschiff.kind) w.flagg = { kind: plan.flaggschiff.kind, name: (plan.flaggschiff.kommandant && plan.flaggschiff.kommandant.name) || null };
  return w;
}
function spawnGruppe(game, w, group, label) {
  const Lr = lerche(game);
  // Sim-Szene (wellenStartAusPlan): der Stärkewert gilt unskaliert, nur die Hülle skaliert mit der Crew (spawnEnemy)
  const scale = w.ohneSkala ? 1 : (((cfg(game).wellen || {}).crew || { 1: 0.67, 2: 0.85, 3: 1 })[crewN(game)] || 1);
  const items = [];
  for (const it of group) {
    const n = Math.max(1, Math.round(it.n * scale));
    for (let j = 0; j < n; j++) items.push({ kind: it.kind, volk: it.volk || w.volk || undefined, flagg: !!(w.flagg && it === group[0] && j === 0 && label === w.liste.length) });
  }
  const base = w.richtung === 'achtern' ? Lr.angle + Math.PI : Lr.angle;
  items.forEach(({ kind, volk, flagg }, j) => {
    let a;
    if (w.richtung === 'alle') a = (j / items.length) * Math.PI * 2 + game.rng.range(-0.3, 0.3) + w.n;
    else a = base + (j - (items.length - 1) / 2) * 0.55;
    if (!game.C.enemies[kind]) return;
    const meta = flagg ? Object.assign({ wv: w.id, wvN: label, flagg: true }, w.flagg.name ? { name: w.flagg.name } : {}) : { wv: w.id, wvN: label };
    spawnOderNachschub(game, kind, { angle: a, tag: w.tag, ziel: w.ziel, volk }, meta);
  });
}
// Wartende Gegner einer Welle (Nachschub über der Grenze) gelten als lebend, sonst käme die nächste Welle zu früh (nur Plan-Wellen)
function lebendeWelle(game, w, nr) {
  const n = game.space.enemies.filter((e) => e.wv === w.id && (nr == null || e.wvN === nr)).length;
  if (!w.ohneSkala) return n;
  return n + state(game).nachschub.filter((q) => q.meta && q.meta.wv === w.id && (nr == null || q.meta.wvN === nr)).length;
}
function tickWelle(game, w, dt) {   // eslint-disable-line no-unused-vars
  if (w.scene !== game.ship.scene) { game.flotte.welle = null; return; }
  if (w.beginn != null && game.time < w.beginn) return;   // Vorwarnung der Sim-Szene: Welle 1 erst nach dem Vorlauf
  const M = texte().meldungen || {}; const W = cfg(game).wellen || {};
  const von = w.liste.length;
  const rest = w.restJe && w.i >= 0 ? w.restJe[w.i] : w.rest;   // Plan-Wellen: Rest je Welle als Anteil (restJe), sonst fester Wert
  if (w.i < 0 || (!w.fertig && w.i + 1 < von && (lebendeWelle(game, w, w.i + 1) <= rest || (w.takt > 0 && game.time - w.t >= w.takt)))) {
    w.i++; w.t = game.time; w.n++;
    spawnGruppe(game, w, w.liste[w.i], w.i + 1);
    state(game).stats.wellen++;
    game.emit('flotteWelle', { n: w.i + 1, von });
    game.oda(fmt(M.welle || 'Welle {n} von {von}.', { n: w.i + 1, von }), null);
    game.missionEvent('welleKommt', { n: w.i + 1, von });
  }
  if (w.druck && game.time - w.druckT >= (Number(W.druckTakt) || 9)) {   // Überdruck: die letzte Gruppe kommt wieder, etwas größer
    w.druckT = game.time;
    const maxN = Number(W.druckMax) || 4;
    const last = w.liste[w.liste.length - 1].map((it) => ({ kind: it.kind, n: Math.min(maxN, it.n + 1), volk: it.volk }));
    w.n++;
    spawnGruppe(game, w, last, w.liste.length + w.n);
    game.emit('flotteDruck', { n: w.n });
  }
  if (!w.fertig && w.i + 1 >= von && lebendeWelle(game, w, null) === 0 && !w.druck) { w.fertig = true; game.missionEvent('wellenFertig', { n: von }); }
}
function wellenFertig(game) { const w = game.flotte && game.flotte.welle; return !!(w && w.fertig); }

// ---------- Höchstens CONFIG.flotte.max Schiffe je Szene, mehr kommt als Nachschub ----------
// Gezählt werden alle Gegner und alle Verbündeten/Schützlinge der Szene (nicht die Lerche, nicht entkommene). Plätze frei = Nachschub rückt nach.
function schiffe(game) { return game.space.enemies.length + ((game.space.escorts) || []).filter((q) => q.state !== 'entkommen').length; }
function platz(game) { return Math.max(0, (Number(cfg(game).max) || 12) - schiffe(game)); }
// meta: { wv, wvN } wird dem Gegner angehängt (Wellen-Zugehörigkeit). -> Gegner | null (wartet als Nachschub)
function spawnOderNachschub(game, kind, opts, meta) {
  const st = state(game);
  st.stats.hoechst = Math.max(st.stats.hoechst, schiffe(game) + 1);
  if (platz(game) > 0 && !st.nachschub.length) {
    const e = space().spawnEnemy(game, kind, opts || {});
    if (e && meta) Object.assign(e, meta);
    return e;
  }
  if (st.nachschub.length < 60) st.nachschub.push({ kind, opts: Object.assign({}, opts || {}), meta: meta || null, scene: game.ship.scene });
  return null;
}
function nachschubTick(game) {
  const st = game.flotte; if (!st || !st.nachschub.length) return;
  if (st.nachschub[0].scene !== game.ship.scene) { st.nachschub.length = 0; return; }
  if (platz(game) <= 0 || game.time - (st.nachschubT || -99) < (Number((cfg(game).nachschub || {}).takt) || 1.2)) return;
  const q = st.nachschub.shift(); st.nachschubT = game.time;
  const e = space().spawnEnemy(game, q.kind, q.opts);
  if (e && q.meta) Object.assign(e, q.meta);
  st.stats.nachschub++;
  game.emit('flotteNachschub', { art: q.kind, rest: st.nachschub.length });
  game.oda('Nachschub trifft ein: weitere Gegner im Anflug.', 'nachschub_' + game.ship.scene);
  game.missionEvent('nachschub', { art: q.kind });
}

// ---------- Eigene KI der Verbündeten (EK4b) ----------
function kcfg(game) {
  return Object.assign({ rolle: 'begleiter', leine: 1100, zielReichweite: 1500, zielTakt: 0.5, intervall: {}, dmg: {}, schussTempo: 260, minenAbstand: 110, minenSchaden: 20 }, cfg(game).ki || {});
}
const kiAn = (es) => !!es && es.ally && es.rolle !== 'skript' && escort().active(es);
function kiGueltig(game, es, e, K) {
  if (!e || !(e.hp > 0) || e.kind === 'relay' || e.kind === 'pylon' || e.pat || e.leaving) return false;
  if (es.rolle !== 'angreifer') { const Lr = lerche(game); if (hyp(e.x - Lr.x, e.y - Lr.y) > K.leine + 300) return false; }
  return true;
}
// Zielwahl: behält das Ziel, solange es gültig und in Reichweite ist; sonst der nächste Gegner (wer das Schiff anvisiert, zählt doppelt)
function kiZielWaehlen(game, es) {
  const K = kcfg(game); const en = game.space.enemies;
  const cur = es.kiZielObj && en.includes(es.kiZielObj) ? es.kiZielObj : null;
  if (cur && kiGueltig(game, es, cur, K) && hyp(cur.x - es.x, cur.y - es.y) < K.zielReichweite) return cur;
  let best = null, bs = Infinity;
  for (const e of en) {
    if (!kiGueltig(game, es, e, K)) continue;
    const d = hyp(e.x - es.x, e.y - es.y);
    if (d > K.zielReichweite) continue;
    let s = d;
    if (e.targetId === es.id) s *= 0.5; else if (e.targetId == null && es.rolle === 'begleiter') s *= 0.8;
    if (s < bs) { bs = s; best = e; }
  }
  return best;
}
// Flugbefehl aus der Klassen-KI (pilot.js) oder null (Regiebuch führt / kein Ziel / zu weit von der Lerche: Formation)
function kiFlug(game, es, dt) {
  if (!kiAn(es)) return null;
  const k = es.skript || {};
  if (k.modus && k.modus !== 'folgen') return null;
  const T = es.kiZielObj;
  if (!T || !game.space.enemies.includes(T)) return null;
  const K = kcfg(game);
  if (es.rolle !== 'angreifer' && hyp(es.x - lerche(game).x, es.y - lerche(game).y) > K.leine) { es.kiZielObj = null; return null; }
  return pilot().update(game, es, dt);
}
// Feuer: je Waffenplatz der Klasse ein Geschoss in Takt, wenn das Ziel im Bogen und in Reichweite liegt. Nur Gegner nehmen Schaden.
function kiFeuer(game, es, dt) {
  const K = kcfg(game); const st = state(game);
  es.kiT = (es.kiT || 0) - dt;
  if (es.kiT <= 0) { es.kiT = K.zielTakt; es.kiZielObj = kiZielWaehlen(game, es); }
  const T = es.kiZielObj;
  if (!T || !game.space.enemies.includes(T) || es.empT > 0 || (es.einBis > game.time)) return;
  const W = game.C.enemyWeapons[es.kind] || [];
  const iv = Number(K.intervall[es.kind]) || 3.4; const dmg = Number(K.dmg[es.kind]) || 1.5;
  const speed = game.C.combat.enemyShotSpeed * (K.schussTempo / 210);
  es.wT = es.wT || [];
  W.forEach((w, i) => {
    if (es.wT[i] == null) es.wT[i] = game.rng.range(0, iv);
    es.wT[i] -= dt;
    if (es.wT[i] > 0) return;
    if (!Physics.inArc(es.x, es.y, es.angle, w.facing, w.arc, w.range, T.x, T.y)) { es.wT[i] = 0; return; }
    es.wT[i] = iv * game.rng.range(0.85, 1.15);
    const ang = space().leadAngle(es.x, es.y, T, speed, 1);
    game.space.projectiles.push({ id: game.nextId('pr'), kind: 'ally', x: es.x, y: es.y, angle: ang, speed, ttl: game.C.combat.enemyShotTtl, dmg, owner: es.id });
    st.stats.schuesse++;
    game.emit('sfx', { name: 'blaster', volume: 0.35 });
  });
}
// Minen: Schiffe der Lerche-Seite zünden Minen der Gegner wie die Lerche (nicht Minen der Lerche); die Explosion trifft sie (alarm.explodiere ruft mineSchaden)
function minenPruefen(game) {
  const sp = game.space; if (!sp.minen || !sp.minen.length) return;
  const A = (game.C.alarm || {}).mine || {}; const zuend = A.zuend != null ? A.zuend : 70;
  for (const es of alliesActive(game)) for (const m of sp.minen.slice()) {
    if (m.besitzer === 'lerche' || m.ohneStrom) continue;
    if (hyp(m.x - es.x, m.y - es.y) <= zuend) alarm().explodiere(game, m, 'zuendung');
  }
}
function mineSchaden(game, m, R) {
  if (m.besitzer === 'lerche') return;
  const dmg = kcfg(game).minenSchaden;
  for (const es of alliesActive(game)) if (hyp(m.x - es.x, m.y - es.y) <= R) { escort().hit(game, es, dmg, { mine: true }); }
}
// Sprung innerhalb der Szene (Notfallsprung am selben Ort): die Flotte springt mit und steht wieder hinter der Lerche
function sprungFolgen(game) {
  if (!(game.notsprungT >= 0) || game.notsprungT === (game.flotte && game.flotte.notT)) return;
  game.flotte.notT = game.notsprungT;
  if (game.time - game.notsprungT > 1) return;
  const sp = game.space; const Lr = lerche(game); let i = 0;
  for (const es of alliesActive(game)) {
    const back = Lr.angle + Math.PI + slotWinkel(i++);
    es.x = clamp(Lr.x + Math.cos(back) * 220, 60, sp.w - 60); es.y = clamp(Lr.y + Math.sin(back) * 220, 60, sp.h - 60);
    es.vx = 0; es.vy = 0; es.turnVel = 0; es.angle = Lr.angle; es.kiZielObj = null;
    game.emit('allyEintritt', { id: es.id, tag: es.tag, name: es.name, x: Math.round(es.x), y: Math.round(es.y), dauer: 1.2 });
  }
}
// Abstand zu Gegnern und anderen Verbündeten (hinausschieben, wie keepApart der Gegner; die Lerche übernimmt escort.stepEscort)
function trennen(game, es) {
  const c = game.C.shipClasses[es.kind] || {}; const myR = c.radius || 30;
  const list = [];
  for (const q of game.space.enemies) list.push({ x: q.x, y: q.y, r: (game.C.shipClasses[q.kind] || {}).radius || 20 });
  for (const q of game.space.escorts || []) if (q !== es && q.state !== 'entkommen') list.push({ x: q.x, y: q.y, r: (game.C.shipClasses[q.kind] || {}).radius || 30 });
  for (const o of list) {
    const min = Math.max(60, myR + o.r);
    let dx = es.x - o.x, dy = es.y - o.y; let d = hyp(dx, dy);
    if (d >= min) continue;
    if (d < 0.01) { dx = Math.cos(es.angle); dy = Math.sin(es.angle); d = 1; }
    const nx = dx / d, ny = dy / d;
    es.x = o.x + nx * min; es.y = o.y + ny * min;
    const vn = es.vx * nx + es.vy * ny;
    if (vn < 0) { es.vx -= vn * nx; es.vy -= vn * ny; }
  }
}

// ---------- Neustart der Szene („von vorn anfangen“) ----------
// Gegner weg, Wellen und Befehl von vorn, lebende Verbündete repariert, Lerche auf mindestens 60 % Hülle. Zerstörte Schiffe bleiben verloren.
function neustart(game) {
  const st = state(game); const sp = game.space; const Lr = lerche(game);
  for (const e of sp.enemies) if (game.ship.target === e.id) game.ship.target = null;
  sp.enemies = []; sp.projectiles = sp.projectiles.filter((p) => !['enemy', 'emp', 'sperrfeuer', 'sturm', 'etorpedo', 'estreu', 'ally'].includes(p.kind));
  st.nachschub.length = 0;
  for (const es of allies(game)) {
    if (!escort().active(es)) continue;
    es.kiZielObj = null;
    es.hp = es.hpMax; es.state = 'ok'; es.distress = false; es.warned = []; es.skript = { modus: 'folgen' };
    escort().syncFlags(game, es);
  }
  require('./interior.js').integritaetAusZustand(game);   // SYS-01 A1: Hülle entfällt; die Integrität folgt dem Zustand (ok = Maximum, beschädigt = 50 %, zerstört = 0), der Zustand bleibt
  const b = st.befehl;
  if (st.welle) { const w = st.welle; w.i = -1; w.druck = false; w.fertig = false; w.t = game.time; w.n = 0; }
  if (b && b.spec) befehl(game, b.spec);
  game.emit('flotteNeustart', {});
  game.oda('Von vorn! Formation neu, Gegner neu – diesmal schneller.', null);
  game.missionEvent('flotteNeustart', {});
  return true;
}

// ---------- Ende der Flottenszene (Kapitel Orbit): Wellen, Nachschub und Befehl abräumen, die Verbündeten bleiben ----------
// Gegner im Raum bleiben (das Regiebuch lässt sie vorher mit enemies_retreat abdrehen, die Abdreh-Regel endet hier, sonst fliehen auch spätere Gegner am Ort);
// ohne diesen Aufruf liefe die letzte Welle im Folgekapitel weiter.
function beenden(game) {
  const st = game.flotte; if (!st) return false;
  st.welle = null; st.nachschub.length = 0; st.befehl = null;
  if (game.space) delete game.space.retreatRule;   // ein vorher gesetztes enemies_retreat gilt für die Gegner der Schlacht, nicht für spätere Szenen am selben Ort
  return true;
}

// ---------- Tick (aus game.step, nur mit Flottenzustand) ----------
function update(game, dt) {
  const st = game.flotte; if (!st) return;
  if (st.befehl && st.befehl.st === 0) tickBefehl(game, st.befehl, dt);
  if (st.welle) tickWelle(game, st.welle, dt);
  nachschubTick(game);
  const A = alliesActive(game);
  if (A.length) {
    for (const es of A) { if (kiAn(es)) { try { kiFeuer(game, es, dt); } catch (err) { if (game.countError) game.countError('flotte-feuer', err); } } trennen(game, es); }
    minenPruefen(game); sprungFolgen(game);
  }
}

// ---------- Abfragen ----------
function aktuell(game) { return (game.flotte && game.flotte.befehl) || null; }
function befehlStatus(game, art) {
  const b = aktuell(game);
  if (!b || (art && b.art !== art)) return null;
  return { art: b.art, st: b.st, grund: b.grund || null, k: b.k, n: b.n, idx: b.idx };
}
const erfuellt = (game, art) => { const s = befehlStatus(game, art); return !!(s && s.st === 1); };
const gescheitert = (game, grund) => { const b = aktuell(game); return !!(b && b.st === 2 && (!grund || b.grund === grund)); };
const laeuft = (game, art) => { const b = aktuell(game); return !!(b && b.st === 0 && (!art || b.art === art)); };

// ---------- Snapshot (fehlt, wenn nichts da ist) ----------
// flotte: { b: { a, st, r?, k?, n?, i?, w?: [[x, y, ok]], s?, rad? }, wl?: [n, von] }
function snapshot(game) {
  const st = game.flotte; if (!st) return null;
  const out = {};
  const b = st.befehl;
  if (b && (b.st === 0 || game.time - (b.ende || 0) < 12) && b.scene === game.ship.scene) {
    const o = { a: b.art, st: b.st };
    if (b.st === 0 && b.frist > 0) o.r = Math.max(0, Math.ceil(b.frist - (game.time - b.t0)));
    if (b.art === 'ausschalten' || b.art === 'entlastung') { o.k = b.k; o.n = b.n; }
    if (b.wp.length) { o.i = b.idx; o.w = b.wp.map((p) => [p.x, p.y, p.ok ? 1 : 0]); o.rad = b.radius; }
    if (b.schiff) { const es = schiffVon(game, b); if (es) o.s = es.id; }
    if (b.art === 'entlastung') o.rad = b.radius;
    if (b.st === 2 && b.grund) o.g = b.grund;
    out.b = o;
  }
  if (st.nachschub && st.nachschub.length) out.nq = st.nachschub.length;
  const w = st.welle;
  if (w && w.scene === game.ship.scene && !w.fertig) out.wl = w.druck ? [w.liste.length, w.liste.length, 1] : [Math.max(0, w.i + 1), w.liste.length];
  return Object.keys(out).length ? out : null;
}

// ---------- Debug: flotte aufstellen [kind] [name] | befehl <art> [..] | welle | neustart | status ----------
function debug(game, args) {
  const a = (Array.isArray(args) ? args : []).map(String);
  const cmd = a[0];
  if (cmd === 'aufstellen') {
    const n = allies(game).length;
    const es = aufstellen(game, { tag: 'debug_v' + (n + 1), kind: a[1] || 'korvette', name: a[2] || ('Verbündeter ' + (n + 1)), ersatz: true });
    return es ? null : 'Nicht aufgestellt.';
  }
  if (cmd === 'befehl') {
    const art = a[1];
    const sp = { art, ziel: a[2], schiff: (allies(game)[0] || {}).tag, punkte: 'vorn;mitte', n: 3 };
    if (art === 'ausschalten') sp.ziel = a[2] || 'raider';
    return befehl(game, sp) ? null : 'Unbekannter Befehl (ausschalten, eskortieren, durchbrechen, zurueckfallen, entlastung).';
  }
  if (cmd === 'welle') { wellenStart(game, { wellen: a[1] || 'raider:2|raider:3,korvette:1', takt: 30 }); return null; }
  if (cmd === 'neustart') { neustart(game); return null; }
  const b = aktuell(game);
  return `Flotte: ${allies(game).map((q) => `${q.name}:${q.state}:${Math.round(q.hp)}`).join(' ') || 'keine Verbündeten'} · Befehl ${b ? `${b.art} st ${b.st}${b.grund ? ' (' + b.grund + ')' : ''} ${b.k}/${b.n} wp ${b.idx}/${b.wp.length}` : '–'} · Welle ${game.flotte && game.flotte.welle ? game.flotte.welle.i + 1 + '/' + game.flotte.welle.liste.length : '–'}`;
}

module.exports = {
  ARTEN, WEGPUNKT_ARTEN, MODI, ART_NAMEN, texte, state, neu,
  aufstellen, modus, slotWinkel, goalFor, allyHit, allyLost, kiFlug, mineSchaden, schiffe, platz, spawnOderNachschub, ROLLEN,
  befehl, onEnemyKilled, wellenStart, wellenStartAusPlan, wellenFertig, neustart, beenden, update,
  befehlStatus, erfuellt, gescheitert, laeuft, snapshot, erinnerung, erinnerungText, verloren, allies, alliesActive,
  funk, legatSprecher, debug, fmt,
};
