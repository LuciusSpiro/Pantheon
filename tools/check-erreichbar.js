'use strict';
// U1: Erreichbarkeit der Kampagne „Die Schuld der Lerche“ (Teil von npm run check).   node tools/check-erreichbar.js [--statisch] [--selftest] [--json]
// Kai (Spieltest 2026-10-14): Missionen und Notrufe lagen in Sektoren ohne Sprungpunkt; die Forschungsstation Helix war nicht zu finden.
// Prüft für jeden Ort, den ein Buch, ein Kapitel, ein Ziel-Marker, ein Notruf oder eine Spur verlangt:
//   A  Zeitlinie (statisch): Der Hex ist von Kantenstein aus über Kanten erreichbar, die zu dem Zeitpunkt offen sind (open-Kanten, enthüllte
//      verborgene Kanten, temporäre Sprungpunkte, die ein Buchschritt tatsächlich öffnet, Boje-Kante nach dem Wecken). Kapitel für Kapitel, Schritt
//      für Schritt; „bis: mission“-Sprungpunkte gelten nach dem Ende ihres Buchs als geschlossen.
//   B  Sprungpunkte (dynamisch, echter Server): jede dafür genutzte Kante lässt sich in BEIDE Richtungen wirklich fliegen – Sprungpunkt liegt in der
//      Szene, nicht zu nah an Station/Planet, der Antrieb lädt, die Ankunft liegt am Gegen-Sprungpunkt, der Rückweg steht im Snapshot (space.jp).
//   C  Inhalt (dynamisch): Notrufe stellen am Ort ein sichtbares Schiff in die Szene (Escort-Objekt im Raum und im Snapshot), Landepunkt-Beam und
//      Stationen liegen in der Szene, die Zonen der Hexe (Gasriese, Gravimetrie, Boje) sind gebaut.
// Beispielfehler: ERR-ZEIT (Hex zu dem Zeitpunkt nicht erreichbar), ERR-KANTE (Kante nicht befahrbar), ERR-SZENE (Inhalt fehlt oder liegt außerhalb).
const path = require('path');
const fs = require('fs');
process.chdir(path.join(__dirname, '..'));
const Sektoren = require('../shared/sektoren.js');
const Locations = require('../shared/locations.js');
const Welt = require('../server/sim/welt.js');
const Kampagne = require('../server/mission/kampagne.js');
const Loader = require('../server/mission/loader.js');
const Notrufe = require('../server/sim/notrufe.js');

const KAMPAGNE = 'schuld-der-lerche';
const KARTE = 'sund';

// ---------- Hilfen ----------
const kid = (a, b) => Sektoren.kanteId(a, b);
function hexVon(ref) {
  if (typeof ref !== 'string' || !ref) return null;
  if (/^\d{4}$/.test(ref)) return Sektoren.imRaster(ref) ? ref : null;
  return Sektoren.hexVonOrt(ref);
}
function mapKanten() { return ((Sektoren.KARTE && Sektoren.KARTE.kanten) || []).slice(); }
function kanteVonSchluessel(ref) {
  return mapKanten().filter((e) => e.key === ref || kid(e.a, e.b) === ref);
}

// ---------- Schritte lesen: Öffnungen, Forderungen, Kindbücher ----------
// Alles außer `skip` (nur Debug) und Texten. Zusätzlich: eine Prüfung boje_geweckt in `next` öffnet danach die locked-Kante des Fundorts.
function leseSchritt(step) {
  const o = { ops: [], orte: [], kinder: [], oeffnerDanach: [] };
  const rein = (n, key, imNext) => {
    if (Array.isArray(n)) { n.forEach((x) => rein(x, key, imNext)); return; }
    if (!n || typeof n !== 'object') return;
    if (typeof n.do === 'string') {
      if (n.do === 'sprungpunkt_oeffnen' && n.temp !== false) o.ops.push({ art: 'temp', von: hexVon(n.von), nach: hexVon(n.nach), bis: n.bis || 'mission', roh: n });
      else if (n.do === 'sprungpunkt_oeffnen') o.ops.push({ art: 'dauer', von: hexVon(n.von), nach: hexVon(n.nach), roh: n });
      else if (n.do === 'kante_enthuellen') o.ops.push({ art: 'enthuellen', kante: String(n.kante) });
      else if (n.do === 'notrufe_freischalten') o.ops.push({ art: 'notrufe', ids: String(n.ids || '').split(',').map((x) => x.trim()).filter(Boolean) });
      else if (n.do === 'spur_starten') o.ops.push({ art: 'spur', id: String(n.id || 'bote') });
      else if (n.do === 'buch_starten') o.kinder.push(String(n.buch));
    }
    if (n.check && n.check.name === 'boje_geweckt' && imNext) o.oeffnerDanach.push('boje');
    if (typeof n.atLocation === 'string') o.orte.push({ ref: n.atLocation, was: 'atLocation' });
    if (typeof n.docked === 'string') o.orte.push({ ref: n.docked, was: 'docked' });
    if (typeof n.hex === 'string') o.orte.push({ ref: n.hex, was: 'Ziel-Marker (hex)' });
    for (const [k, v] of Object.entries(n)) { if (k === 'skip' || k === 'texte' || k === 'oda' || k === 'liefert_flags') continue; rein(v, k, imNext); }
  };
  if (typeof step.loc === 'string') o.orte.push({ ref: step.loc, was: 'loc' });
  for (const [k, v] of Object.entries(step)) { if (k === 'skip' || k === 'loc') continue; rein(v, k, k === 'next'); }
  return o;
}

// ---------- Zustand der offenen Kanten ----------
class Offen {
  constructor() { this.kanten = new Map(); }   // kanteId -> { art: temp|enthuellt|dauer|boje, bis }
  kopie() { const n = new Offen(); for (const [k, v] of this.kanten) n.kanten.set(k, Object.assign({}, v)); return n; }
  hat(id) { return this.kanten.has(id); }
  setze(id, info) { if (!this.kanten.has(id)) this.kanten.set(id, info); }
  vergiss(pred) { for (const [k, v] of [...this.kanten]) if (pred(v)) this.kanten.delete(k); }
}
function erreichbar(offen, start) {
  const seen = new Set([start]); const q = [start]; const vor = { [start]: null };
  const geht = (a, b) => {
    if (!Sektoren.spielbar(b)) return false;
    const id = kid(a, b); const e = Sektoren.kante(id);
    if (offen.hat(id)) return true;
    return !!e && e.art === 'open';
  };
  while (q.length) {
    const h = q.shift();
    const nb = new Set(Sektoren.nachbarn(h));
    for (const id of offen.kanten.keys()) { const k = Sektoren.kanteAusId(id); if (k && (k.a === h || k.b === h)) nb.add(k.a === h ? k.b : k.a); }
    for (const n of nb) if (!seen.has(n) && geht(h, n)) { seen.add(n); vor[n] = h; q.push(n); }
  }
  return { seen, vor };
}

// ---------- Hauptprüfung ----------
// opts: { books, doc, notrufe (Liste Rufdaten), spuren (id -> Daten) }
function statisch(opts) {
  const res = { errors: [], warnings: [], info: [], gebraucht: new Set(), kanten: new Map(), notrufe: [] };
  const fehler = (code, p, msg) => { if (!res.errors.some((e) => e.code === code && e.p === p && e.msg === msg)) res.errors.push({ code, p, msg }); };
  const doc = opts.doc; const books = opts.books;
  const start = hexVon(Sektoren.startOrt());
  const rufe = new Map((opts.notrufe || []).map((d) => [d.id, d]));
  const spuren = opts.spuren || {};
  const hexName = (h) => `${Sektoren.hexName(h)} ${h}`;

  const pruefe = (ref, was, wo, offen) => {
    const h = hexVon(ref);
    if (!h) { fehler('ERR-ORT', wo, `${was} '${ref}': kein Ort/Hex der Karte ${Sektoren.kartenId()}`); return; }
    res.gebraucht.add(h);
    if (!Sektoren.spielbar(h) && !Sektoren.istLeerraum(h)) { fehler('ERR-ORT', wo, `${was} ${hexName(h)} ist nicht spielbar`); return; }
    const r = erreichbar(offen, start);
    if (!r.seen.has(h)) {
      const nb = Sektoren.nachbarn(h).filter((x) => Sektoren.spielbar(x)).map((x) => x + (r.seen.has(x) ? '*' : '')).join(' ');
      fehler('ERR-ZEIT', wo, `${was} ${hexName(h)}: von ${hexName(start)} aus zu diesem Zeitpunkt nicht erreichbar (kein offener Weg; spielbare Nachbarn ${nb || 'keine'}, * = erreichbar)`);
    }
  };
  const merkeKante = (id, art) => { if (!res.kanten.has(id)) res.kanten.set(id, art); };
  const oeffne = (offen, op, wo) => {
    if (op.art === 'temp' || op.art === 'dauer') {
      if (!op.von || !op.nach || !Sektoren.sindNachbarn(op.von, op.nach)) { fehler('ERR-KANTE', wo, `Sprungpunkt ${op.von || '?'} - ${op.nach || '?'}: keine Nachbarhexe`); return; }
      if (!Sektoren.spielbar(op.von) || !Sektoren.spielbar(op.nach)) { fehler('ERR-KANTE', wo, `Sprungpunkt ${op.von} - ${op.nach}: Hex nicht spielbar`); return; }
      const id = kid(op.von, op.nach); offen.setze(id, { art: op.art, bis: op.bis || 'immer', von: op.von }); merkeKante(id, 'temp');
    } else if (op.art === 'enthuellen') {
      const es = kanteVonSchluessel(op.kante).filter((e) => e.art === 'hidden');
      if (!es.length) { fehler('ERR-KANTE', wo, `kante_enthuellen '${op.kante}': keine verborgene Kante dazu`); return; }
      for (const e of es) { offen.setze(kid(e.a, e.b), { art: 'enthuellt', bis: 'immer' }); merkeKante(kid(e.a, e.b), 'enthuellt'); }
    } else if (op.art === 'boje') {
      for (const e of mapKanten().filter((x) => x.art === 'locked')) { offen.setze(kid(e.a, e.b), { art: 'boje', bis: 'immer' }); merkeKante(kid(e.a, e.b), 'boje'); }
    } else if (op.art === 'spur') {
      const s = spuren[op.id];
      if (!s) { fehler('ERR-SPUR', wo, `Spur '${op.id}' gibt es nicht (content/spuren)`); return; }
      for (const h of s.weg || []) pruefe(h, `Spur ${op.id}`, wo, offen);
      if (s.ende && s.ende.kante) oeffne(offen, { art: 'enthuellen', kante: s.ende.kante }, wo);
    } else if (op.art === 'notrufe') {
      for (const id of op.ids) {
        const d = rufe.get(id);
        if (!d) { fehler('ERR-NOTRUF', wo, `Notruf '${id}' gibt es nicht (content/notrufe)`); continue; }
        if (d.tor) oeffne(offen, { art: 'temp', von: d.tor.von, nach: d.tor.nach, bis: 'immer' }, wo + ` (Tor ${id})`);
        pruefe(d.hex, `Notruf ${id}`, wo, offen);
        res.notrufe.push(d);
      }
    }
  };

  // Buch ablaufen: Schritte der Reihe nach (Wiederholungen ändern nichts am Bild), Kindbücher an ihrer Stelle
  const ablauf = (buchId, offen, ctx, tiefe) => {
    const bk = books[buchId];
    if (!bk) { fehler('ERR-BUCH', ctx, `Regiebuch '${buchId}' fehlt oder ist ungültig`); return offen; }
    if (tiefe > 4) return offen;
    let o = offen.kopie();
    for (const s of bk.steps) {
      const wo = `${ctx}/${buchId}/${s.id}`;
      const L = leseSchritt(s);
      for (const op of L.ops) oeffne(o, op, wo);
      for (const t of L.orte) pruefe(t.ref, t.was, wo, o);   // Öffnungen dieses Schritts gelten (enter läuft vor der Anzeige)
      for (const kind of L.kinder) o = ablauf(kind, o, wo, tiefe + 1);
      if (L.oeffnerDanach.includes('boje')) oeffne(o, { art: 'boje' }, wo);
    }
    // book-weite Orte (buehne.orte): gegen den Stand am Ende des Buchs
    for (const ort of (bk.buehne && bk.buehne.orte) || []) pruefe(ort, 'buehne.orte', `${ctx}/${buchId}`, o);
    // bis: mission = nach dem Ende des Buchs zu
    o.vergiss((v) => v.art === 'temp' && v.bis !== 'immer');
    return o;
  };

  let offen = new Offen();
  const ketteVor = new Map();
  doc.kapitel.forEach((c) => {
    const wo = `kapitel ${c.nr} ${c.id}`;
    const zweig = c.id === 'k9b_soeldner' ? ketteVor.get('k8_entscheidung') : offen;   // 9A und 9B gehen beide von Kapitel 8 aus
    let o = (zweig || offen).kopie();
    if (c.ort) pruefe(c.ort, 'Kapitel-Ort', wo, o);
    if (c.einstieg && c.einstieg.ort) pruefe(c.einstieg.ort, 'Einstiegs-Ort', wo, o);
    for (const b of Kampagne.buecherVon(c)) o = ablauf(b, o, wo, 0);
    for (const b of c.szenen || []) o = ablauf(b, o, wo + ' (Szene)', 0);
    ketteVor.set(c.id, o);
    offen = c.id === 'k9a_uebergabe' ? o.kopie() : (c.id === 'k9b_soeldner' ? mische(offen, o) : o);
  });
  function mische(a, b) { const n = a.kopie(); for (const [k, v] of b.kanten) n.setze(k, v); return n; }

  // Nicht erreichbare Orte der Karte, die spielbar sein sollen, aber von nichts verlangt werden: nur Hinweis
  for (const [hex, h] of Object.entries((Sektoren.KARTE && Sektoren.KARTE.hexe) || {})) {
    if (h.spielbar && h.ort && !res.gebraucht.has(hex)) res.warnings.push({ code: 'WARN-UNGEBRAUCHT', p: hex, msg: `${hexName(hex)} ist spielbar, wird aber von keinem Buch verlangt` });
  }
  res.offenEnde = offen;
  return res;
}

// ---------- dynamisch: echter Server ----------
function dynamisch(res, opts) {
  const Game = require('../server/game.js').Game;
  const Space = require('../server/sim/space.js');
  const Sprung = require('../server/sim/sprung.js');
  const fehler = (code, p, msg) => res.errors.push({ code, p, msg });
  const g = new Game({ noStore: true, seed: 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const conn = { inbox: [], send(m) { this.inbox.push(m); } };
  g.addConnection(conn); g.handleMessage(conn, { t: 'hello', clientId: 'U1', name: 'Pruefer', color: 0 });
  g.handleMessage(conn, { t: 'lobbyOpt', startMission: 'arena_space' }); g.handleMessage(conn, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  Welt.waehle(g, KARTE);
  g.weltstand = { persistent: true, data: { tutorial: 'uebersprungen', fakten: {}, chronik: [] } };   // keine Tutorial-Regeln: Sprungpunkt-Automatik wie in der Kampagne
  const run = (sek, keep) => { for (let k = 0; k < Math.round(sek * 30); k++) { if (!keep) g.space.enemies = []; g.step(); } };
  const bounds = (loc) => ({ w: loc.scene.w, h: loc.scene.h });

  // Alle Kanten, die die Kampagne irgendwann benutzt, öffnen (temporär bis immer)
  for (const [id, art] of res.kanten) {
    const k = Sektoren.kanteAusId(id);
    if (art === 'temp') Sprung.oeffnen(g, { von: k.a, nach: k.b, temp: true, bis: 'immer' });
    else if (art === 'enthuellt') Sprung.kanteEnthuellen(g, id);
    else if (art === 'boje') Sprung.oeffnen(g, { von: k.a, nach: k.b, temp: false });
  }
  // zu prüfende Kanten: alle open-Kanten zwischen spielbaren Hexen mit Szene, plus die benutzten
  const kanten = new Set();
  for (const e of mapKanten()) if (e.art === 'open' && Sektoren.spielbar(e.a) && Sektoren.spielbar(e.b) && Sektoren.ortVonHex(e.a) && Sektoren.ortVonHex(e.b)) kanten.add(kid(e.a, e.b));
  for (const id of res.kanten.keys()) kanten.add(id);

  const planetOderStation = (loc) => { const s = loc.scene.station; return s ? { x: s.x, y: s.y, r: (s.r || 60) } : null; };
  const hop = (von, nach, keep) => {
    const wo = `Sprung ${Sektoren.hexName(von)} ${von} -> ${Sektoren.hexName(nach)} ${nach}`;
    const ortV = Sektoren.ortVonHex(von), ortN = Sektoren.ortVonHex(nach);
    const locV = Locations.get(ortV), locN = Locations.get(ortN);
    if (!locV || !locN) { fehler('ERR-KANTE', wo, 'Szene fehlt (Locations.get)'); return false; }
    Space.enterScene(g, ortV, {}); g.explore.location = ortV; g.explore.knowSilently && g.explore.knowSilently(ortV);
    g.ship.docked = false; g.ship.dockedAt = null; g._jumpSperre = null;
    const p = Sprung.sprungpunkt(g, nach);
    const B = bounds(locV);
    if (!p || p.x < 0 || p.y < 0 || p.x > B.w || p.y > B.h) { fehler('ERR-KANTE', wo, `Sprungpunkt liegt nicht in der Szene ${B.w}x${B.h} (${p && p.x},${p && p.y})`); return false; }
    const st = planetOderStation(locV);
    if (st && Math.hypot(p.x - st.x, p.y - st.y) < st.r + 80) { fehler('ERR-KANTE', wo, `Sprungpunkt liegt in ${locV.name || ortV}-Station/Planet (${Math.round(Math.hypot(p.x - st.x, p.y - st.y))} px, r ${st.r})`); return false; }
    const gesamt = (locV.scene.asteroids || 0);
    void gesamt;
    g.ship.x = p.x; g.ship.y = p.y; g.ship.vx = 0; g.ship.vy = 0; g.ship.speed = 0;
    g.ship.jump.dest = null; g.ship.jump.charge = 0; g.ship.jump.ready = false;
    let ok = false;
    for (let k = 0; k < 30 * (g.C.ship.jumpCharge + 6); k++) { g.space.enemies = []; g.step(); g.ship.x = p.x; g.ship.y = p.y; g.ship.vx = 0; g.ship.vy = 0; g.ship.speed = 0; if (g.ship.jump.ready) { ok = true; break; } }
    if (!ok) { fehler('ERR-KANTE', wo, `Antrieb lädt am Sprungpunkt nicht: ${g.ship.jump.blockedReason || 'kein Ziel (Sprungpunkt-Automatik wählt keines)'}`); return false; }
    if (g.ship.jump.dest !== ortN) { fehler('ERR-KANTE', wo, `Sprungziel ist ${g.ship.jump.dest}, erwartet ${ortN}`); return false; }
    const err = Sprung.doJump(g);
    if (err) { fehler('ERR-KANTE', wo, 'doJump: ' + err); return false; }
    if (g.ship.scene !== ortN) { fehler('ERR-KANTE', wo, `Ankunft in ${g.ship.scene}, erwartet ${ortN}`); return false; }
    const zurueck = Sprung.sprungpunkt(g, von);
    const d = Math.hypot(g.ship.x - zurueck.x, g.ship.y - zurueck.y);
    if (d > 150) { fehler('ERR-KANTE', wo, `Ankunft ${Math.round(d)} px vom Gegen-Sprungpunkt`); return false; }
    run(0.2, keep);
    const jp = (g.snapshot().space.jp || []).find((j) => j.k === kid(von, nach));
    if (!jp || !['aktiv', 'temporaer'].includes(jp.z)) { fehler('ERR-KANTE', wo, `Rückweg steht nicht im Snapshot (space.jp: ${JSON.stringify(jp || null)})`); return false; }
    if (jp.x < 0 || jp.y < 0 || jp.x > locN.scene.w || jp.y > locN.scene.h) { fehler('ERR-KANTE', wo, 'Rück-Sprungpunkt liegt außerhalb der Szene'); return false; }
    const stN = planetOderStation(locN);
    if (stN && Math.hypot(jp.x - stN.x, jp.y - stN.y) < stN.r + 80) { fehler('ERR-KANTE', wo, 'Rück-Sprungpunkt liegt in der Station/im Planeten'); return false; }
    return true;
  };
  let hops = 0;
  for (const id of [...kanten].sort()) {
    const k = Sektoren.kanteAusId(id);
    if (hop(k.a, k.b)) hops++;
    if (hop(k.b, k.a)) hops++;
  }
  res.info.push(`${hops} Sprünge (${kanten.size} Kanten, beide Richtungen) im echten Server geflogen`);

  // C: Inhalt. Notrufe: Schiff in der Szene, sichtbar im Snapshot, innerhalb der Szene
  for (const d of res.notrufe) {
    const wo = `Notruf ${d.id} (${d.hex})`;
    Notrufe.registriere(d);
    Notrufe.reset(g);
    Notrufe.freischalten(g, d.id);
    Notrufe.hinfliegen(g, d.id);
    const ort = Sektoren.ortVonHex(d.hex);
    if (d.tor) { if (!hop(d.tor.von, d.tor.nach, true)) continue; } else { Space.enterScene(g, ort, {}); g.explore.location = ort; }
    g.ship.docked = false; g.ship.dockedAt = null;
    run(0.5, true);
    const r = Notrufe.finde(g, d.id);
    if (!r || r.z !== Notrufe.Z.VOR_ORT) { fehler('ERR-SZENE', wo, `Ankunft löst den Ruf nicht aus (Zustand ${r && r.z}, Szene ${g.ship.scene})`); continue; }
    const es = Notrufe.schiff(g, r);
    if (!es) { if (d.wahrheit === 'falle' && r.hinterhalt) { res.info.push(`${wo}: Hinterhalt schon beim Eintritt (Lerche nah an der Attrappe)`); continue; } fehler('ERR-SZENE', wo, 'Kein Schiff des Absenders in der Szene'); continue; }
    const loc = Locations.get(ort); const B = bounds(loc);
    if (!d.pos || d.pos.x < 60 || d.pos.y < 60 || d.pos.x > B.w - 60 || d.pos.y > B.h - 60) fehler('ERR-SZENE', wo, `pos ${JSON.stringify(d.pos)} liegt außerhalb der Szene ${B.w}x${B.h}`);
    if (es.x < 40 || es.y < 40 || es.x > B.w - 40 || es.y > B.h - 40) fehler('ERR-SZENE', wo, `Schiff liegt außerhalb der Szene (${Math.round(es.x)},${Math.round(es.y)} in ${B.w}x${B.h})`);
    const st = planetOderStation(loc);
    if (st && Math.hypot(es.x - st.x, es.y - st.y) < st.r + 120) fehler('ERR-SZENE', wo, `Schiff steht in Station/Planet (${Math.round(Math.hypot(es.x - st.x, es.y - st.y))} px von ihr)`);
    const sp = g.snapshot().space;
    if (!(sp.escorts || []).some((e) => e.name === es.name)) fehler('ERR-SZENE', wo, `Schiff '${es.name}' fehlt im Snapshot (space.escorts)`);
    if (!sp.nro) fehler('ERR-SZENE', wo, 'Ruf-Ort fehlt im Snapshot (space.nro)');
    // Sichtbarkeit des Orts gegenüber der Lerche: Anflug möglich = Weg ohne Hindernis ist Sache der Szene; hier nur Abstand zur Ankunft
    res.info.push(`${wo}: Schiff '${es.name}' bei ${Math.round(es.x)},${Math.round(es.y)} (Szene ${B.w}x${B.h}), ${Math.round(Math.hypot(g.ship.x - es.x, g.ship.y - es.y))} px von der Ankunft`);
  }
  // Szenen der Hexe: Beam-Punkt und Zonen
  const Landepunkte = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'welt', 'landepunkte.json'), 'utf8')); } catch (e) { return null; } })();
  const lpIds = new Set(); for (const l of Object.values((Landepunkte && Landepunkte.orte) || {})) for (const e of l) lpIds.add(e.id);
  for (const hex of res.gebraucht) {
    const h = Sektoren.hexDaten(hex); const ort = Sektoren.ortVonHex(hex); const loc = ort && Locations.get(ort);
    if (!loc) { fehler('ERR-SZENE', hex, 'keine Szene'); continue; }
    const B = bounds(loc); const wo = `${Sektoren.hexName(hex)} ${hex}`;
    const sz = (h && h.szene) || {};
    if (sz.beam) {
      if (!lpIds.has(sz.beam.map)) fehler('ERR-SZENE', wo, `Landepunkt '${sz.beam.map}' fehlt in content/welt/landepunkte.json`);
      const b = loc.scene.beam;
      if (!b || b.x < 0 || b.y < 0 || b.x > B.w || b.y > B.h) fehler('ERR-SZENE', wo, `Beam-Punkt fehlt oder liegt außerhalb der Szene (${b && b.x},${b && b.y})`);
    }
    if (sz.zonen && !(loc.scene.zonen && loc.scene.zonen.length)) fehler('ERR-SZENE', wo, `Zonen '${sz.zonen}' sind nicht gebaut`);
    const s = loc.scene.station;
    if (s && (s.x < 0 || s.y < 0 || s.x > B.w || s.y > B.h)) fehler('ERR-SZENE', wo, `Station liegt außerhalb der Szene (${s.x},${s.y})`);
    for (const sch of (h && h.schiffe) || []) if (sch.x < 0 || sch.y < 0 || sch.x > B.w || sch.y > B.h) fehler('ERR-SZENE', wo, `Schiff ${sch.art} liegt außerhalb der Szene (${sch.x},${sch.y})`);
  }
}

// ---------- Aufruf ----------
function lade() {
  Welt.waehle(null, KARTE);
  const { books } = Loader.loadAll();
  const doc = Kampagne.lesen(KAMPAGNE);
  const spuren = {};
  try { for (const f of fs.readdirSync(path.join(__dirname, '..', 'content', 'spuren'))) if (f.endsWith('.json')) { const s = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'spuren', f), 'utf8')); spuren[s.id || f.slice(0, -5)] = s; } } catch (e) { /* keine Spuren */ }
  return { books, doc, spuren, notrufe: Notrufe.alleIds().map((id) => Notrufe.datei(id)) };
}
function pruefe(opts) {
  const o = opts || {};
  const L = Object.assign(lade(), o.ueberschreibe || {});
  const res = statisch(L);
  if (o.dynamisch !== false && !res.errors.some((e) => e.code === 'ERR-KANTE' && /keine Nachbarhexe/.test(e.msg))) dynamisch(res, L);
  return res;
}

module.exports = { pruefe, statisch, lade, KAMPAGNE, KARTE };

if (require.main === module) {
  const args = process.argv.slice(2);
  const out = (s) => { if (!args.includes('--json')) console.log(s); };
  let rc = 0;
  try {
    const res = pruefe({ dynamisch: !args.includes('--statisch') });
    out(`Erreichbarkeit ${KAMPAGNE} (Karte ${KARTE}): ${res.gebraucht.size} Orte verlangt, ${res.kanten.size} Sonderkanten`);
    for (const i of res.info) out('  ' + i);
    for (const w of res.warnings) out(`  Warnung ${w.code} ${w.p}: ${w.msg}`);
    for (const e of res.errors) out(`  FEHLER ${e.code} ${e.p}: ${e.msg}`);
    out(res.errors.length ? `\nERREICHBARKEIT FEHLERHAFT (${res.errors.length})` : '\nERREICHBARKEIT OK');
    if (args.includes('--json')) console.log(JSON.stringify({ errors: res.errors, warnings: res.warnings, info: res.info }, null, 1));
    rc = res.errors.length ? 1 : 0;
    if (args.includes('--selftest')) {
      const base = lade();
      const klon = (x) => JSON.parse(JSON.stringify(x));
      const faelle = [
        ['Helix-Sprungpunkt fehlt im Kapitel-7-Buch', 'ERR-ZEIT', (L) => {
          for (const s of L.books.k7_geld.steps) for (const k of ['enter']) if (s[k]) s[k] = s[k].filter((x) => x.do !== 'sprungpunkt_oeffnen');
        }],
        ['Notruf-Tor fehlt (Leerraum ohne Sprungpunkt)', 'ERR-ZEIT', (L) => { for (const d of L.notrufe) if (d.id === 'sl_echt') delete d.tor; }],
        ['Sprungpunkt zwischen Nicht-Nachbarn', 'ERR-KANTE', (L) => { for (const d of L.notrufe) if (d.id === 'sl_falle') d.tor = { von: '0503', nach: '0302' }; }],
        ['Verborgene Kante wird nie enthüllt', 'ERR-ZEIT', (L) => { L.doc.kapitel.forEach((c) => { if (c.einstieg) delete c.einstieg.oeffnet; }); L.spuren.bote.ende = {}; }],
      ];
      let ok = 0;
      for (const [name, code, mut] of faelle) {
        const L = { books: klon(base.books), doc: klon(base.doc), spuren: klon(base.spuren), notrufe: klon(base.notrufe) }; mut(L);
        const r = statisch(L);
        const treffer = r.errors.some((e) => e.code === code);
        out(`${treffer ? '✓' : '✗'} Selbsttest ${name}: ${treffer ? code : 'erwartet ' + code + ', bekommen ' + (r.errors.map((e) => e.code).join(',') || 'nichts')}`);
        if (treffer) ok++; else rc = 1;
      }
      out(`${ok}/${faelle.length} Selbsttests bestanden`);
    }
  } catch (e) { console.error('check-erreichbar: ' + (e && e.stack || e)); rc = 1; }
  finally { try { Welt.waehle(null, 'limes'); } catch (e) { /* */ } }
  process.exit(rc);
}
