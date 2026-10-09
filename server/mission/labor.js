'use strict';
// Szenario-Labor (CONTRACT-W2 §1, AP3a): jede verfügbare Umsetzung aus dem Katalog gezielt starten – von Menschen (Lobby,
// Modus „Labor“) und von Bots (tools/sim-headless.js labor). Die Liste kommt aus dem Katalog: Was dort neu und verfügbar ist
// (mit test.params), erscheint hier ohne Codeänderung.
//
//   laborListe(katalog)            -> [Eintrag] (alle 'verfuegbar'-Umsetzungen mit test.params, Boden und Raum)
//   laborStart(game, id, params)   -> { ok, fehler?, eintrag?, buch? } – startet die Umsetzung in einer laufenden Partie
//   testBuch(katalog, szenen, id)  -> Regiebuch (Hafen + Szene(n)) aus test.params/rueckfall.params (früher sim-headless)
//   vorbauen(buecher)              -> Landepunkte der Bücher in den Karten-Cache bauen (nie im Tick)
//
// Eintrag: { id: 'molekuel/umsetzung', molekuel, umsetzung, name, molekuelName, schauplatz, kartenarten: [..], landepunkt,
//   ort, staerke: bool (Parameter Stärke wirkt), fraktion: bool, startzustand: null|'gefangen' }
// Startet eine Umsetzung mit einem Startzustand (z. B. team_gefangen im enter, AP4), steht das im Eintrag (startzustand) und
// im Namen; sie bekommt keinen eigenen Parameter dafür.
//
// params (alle optional): { seed, staerke: klein|mittel|gross, god: bool, map|landepunkt, fraktion|besitz, loc, direkt }
//   seed      Partie-Seed (Zufall der Partie, deterministische Läufe)
//   staerke   nur wenn die Umsetzung einen Parameter 'staerke' hat und der Wert erlaubt ist
//   map       Landepunkt (überschreibt test.params.map; nur wenn die Umsetzung 'map' kennt)
//   fraktion  Besitz/Gegner (überschreibt test.params.fraktion; nur wenn erlaubt)
//   direkt    Standard true: das Schiff springt sofort an den Ort der Szene (kein Anflug ab Hafen)
// Schalter CONFIG.lobby.labor (Standard an): aus -> laborStart lehnt ab, die Lobby zeigt den Modus nicht.
const Szenenbau = require('./szenenbau.js');

const STAERKEN = ['klein', 'mittel', 'gross'];
const ANZEIGE_STARTZUSTAND = { gefangen: 'Start: gefangen' };

function standardKatalog() { return require('./spielleiter.js').katalog(); }
function an(C) { return !(C && C.lobby && C.lobby.labor === false); }
const clone = (o) => JSON.parse(JSON.stringify(o));

// Startzustand einer Umsetzung: ausdrücklich (u.startzustand) oder aus der Vorlage (Aktion team_gefangen im enter, AP4)
function startzustand(u) {
  if (u.startzustand) return String(u.startzustand);
  const steps = (u.vorlage && u.vorlage.steps) || [];
  for (const s of steps) for (const a of s.enter || []) if (a && (a.do === 'team_gefangen' || a.team_gefangen)) return 'gefangen';
  return null;
}
function kartenarten(u) {
  const b = u.buehne_braucht;
  if (b && Array.isArray(b.kartenarten)) return b.kartenarten.slice();
  return [];
}

function laborListe(katalog) {
  const k = katalog || standardKatalog();
  const out = [];
  for (const mol of Object.values(k.molekuele || {})) {
    for (const u of mol.umsetzungen || []) {
      if (u.status !== 'verfuegbar' || !u.test || !u.test.params) continue;
      const tp = u.test.params;
      const sz = startzustand(u);
      const p = u.params || {};
      out.push({
        id: `${mol.id}/${u.id}`, molekuel: mol.id, umsetzung: u.id,
        name: u.name + (sz ? ` (${ANZEIGE_STARTZUSTAND[sz] || 'Start: ' + sz})` : ''), molekuelName: mol.name,
        schauplatz: u.schauplatz, kartenarten: kartenarten(u), landepunkt: tp.map || null, ort: tp.loc || null,
        staerke: !!p.staerke, fraktion: !!p.fraktion, startzustand: sz,
      });
    }
  }
  // Boden vor Raum, dann nach Name (stabile Reihenfolge für die Lobby)
  const rang = (e) => (e.schauplatz === 'aussen' ? 0 : 1);
  return out.sort((a, b) => rang(a) - rang(b) || a.name.localeCompare(b.name, 'de') || a.id.localeCompare(b.id));
}
function eintragVon(katalog, id) { return laborListe(katalog).find((e) => e.id === id) || null; }
function umsetzungVon(katalog, id) {
  const [mid, uid] = String(id).split('/');
  const mol = (katalog.molekuele || {})[mid];
  return mol ? (mol.umsetzungen || []).find((u) => u.id === uid) || null : null;
}

// ---------- Testbuch (Hafen + Szene(n)) – gleiche Bauweise wie früher in tools/sim-headless.js ----------
// szenen: [{ key: 'mol/ums', u?, override: {params}, loc? }]; id = Buch-Präfix (Buch-ID 'bot_<id>')
function testBuch(katalog, szenen, id) {
  const k = katalog || standardKatalog();
  const env = Szenenbau.buildEnv(k);
  const sz = [{ id: 'th', szenentyp: 'hafen', ort: 'hafen', molekuele: [], weiter: [{ nach: id + 's1' }] }];
  const answers = {};
  szenen.forEach((sc, i) => {
    const [mid, uid] = sc.key.split('/');
    const u = sc.u || umsetzungVon(k, sc.key);
    if (!u) throw new Error(`Labor: Umsetzung ${sc.key} unbekannt`);
    const params = Object.assign({}, clone((u.test && u.test.params) || {}), clone((u.rueckfall && u.rueckfall.params) || {}), sc.override || {});
    const loc = sc.loc || params.loc || 'b7';
    if (u.params.loc) params.loc = loc;
    for (const [pn, d] of Object.entries(u.params)) if (d.typ === 'npc' && params[pn] === undefined) params[pn] = 'tesk';
    const sid = id + 's' + (i + 1);
    const szene = { id: sid, szenentyp: 'test', ort: loc, karte: params.map, molekuele: [{ id: mid, umsetzung: uid }], weiter: [{ nach: i < szenen.length - 1 ? id + 's' + (i + 2) : 'ausgang:erfolg' }] };
    // Besetzung setzt der Szenenbau aus dem Grobplan (Fraktion sonst = Besitz des Landepunkts, Stärke mittel): Überschreibungen
    // für fraktion/staerke/haltung gehen daher als Szenen-Besetzung mit (wie beim Spielleiter)
    const ov = sc.override || {};
    const bes = {};
    for (const k of ['fraktion', 'staerke', 'haltung']) if (ov[k] !== undefined && u.params[k]) bes[k] = ov[k];
    if (Object.keys(bes).length) szene.besetzung = [bes];
    sz.push(szene);
    answers[sid] = { answer: { molekuele: [{ id: mid, umsetzung: uid, params }], verzweigung: [], wendung: null }, quelle: 'archiv' };
  });
  const namen = szenen.map((s) => { const u = s.u || umsetzungVon(k, s.key); return (u && u.name) || s.key; });
  const g = { format: 'grobplan/1', id, titel: ('Labor: ' + namen.join(' + ')).slice(0, 60), auftraggeber: 'tesk', zielspieldauer_min: 15,
    aufhaenger: 'Testbuch für das Szenario-Labor (Lobby und Bots).', szenen: sz, entscheidungen: [],
    ausgaenge: { erfolg: { wann: 'Test durch', folgen: ['chronik: Labor-Test durch', 'npc_gedaechtnis tesk: Labor-Test'] } } };
  const built = Szenenbau.buildBook(g, answers, env, { id: 'bot_' + id, art: 'archiv', marks: 0 });
  if (built.errors.length) throw new Error(`Testbuch ${id} (${szenen.map((s) => s.key).join(', ')}): ` + built.errors.slice(0, 4).map((e) => (e.code ? `${e.code} ${e.p}: ${e.msg}` : e)).join(' | '));
  for (const [sid, x] of Object.entries(built.szenen)) if (x.fehler.length) throw new Error(`Testbuch ${id} Szene ${sid}: ${x.fehler.slice(0, 3).join(' | ')}`);
  return built.book;
}

// F15: Landepunkte wie im Spiel vorbauen (dort bei der Ankunft am Ort, außerhalb des Ticks). Der Karten-Cache von
// landepunkte.js gilt prozessweit und hängt nur von Landepunkt, Seed und Achsen ab; die Registrierung (game.aways) macht im
// Lauf der Schritt-Baustein (besetzen, anker_zustand …) über landepunkte.sobaldGeladen aus diesem Cache.
// -> [Fehlertext]
function vorbauen(buecher) {
  const L = require('../sim/landepunkte.js');
  const W = require('../world.js');
  const maps = new Set();
  for (const b of buecher || []) {
    for (const id of (b.buehne && b.buehne.aussenkarten) || []) maps.add(id);
    for (const s of b.steps || []) for (const id of s.allowBeam || []) maps.add(id);
  }
  const vorbau = {};   // eigener Laufzeitzustand nur für den Vorbau (keine Partie)
  const fehler = [];
  for (const id of maps) {
    if (W.istHand(id) || !L.defs().byId[id]) continue;
    try { L.karte(vorbau, id); } catch (e) { fehler.push(`Vorbau ${id}: ${e.message}`); }
  }
  return fehler;
}

// Überschreibungen aus params, nur für Parameter, die die Umsetzung kennt (und mit erlaubten Werten)
function ueberschreibungen(u, params) {
  const o = {}; const P = u.params || {}; const q = params || {};
  const erlaubt = (n, v) => P[n] && (!P[n].werte || P[n].werte.includes(v));
  const map = q.map || q.landepunkt;
  if (map && P.map) o.map = String(map);
  const fr = q.fraktion || q.besitz;
  if (fr && erlaubt('fraktion', fr)) o.fraktion = String(fr);
  if (q.staerke && STAERKEN.includes(q.staerke) && erlaubt('staerke', q.staerke)) o.staerke = q.staerke;
  if (q.loc && P.loc) o.loc = String(q.loc);
  return o;
}

// Startet die Umsetzung in einer laufenden Partie (game.phase 'play', Spieler an Bord; Aufruf aus game.startGame bzw. Tests).
function laborStart(game, id, params) {
  const q = params || {};
  if (!an(game.C)) return laborFail(game, 'Das Szenario-Labor ist ausgeschaltet (CONFIG.lobby.labor).');
  const kat = q.katalog || standardKatalog();
  const e = eintragVon(kat, id);
  if (!e) return laborFail(game, `Umsetzung „${id}“ ist im Labor nicht verfügbar.`);
  const u = umsetzungVon(kat, id);
  const ov = ueberschreibungen(u, q);
  return starte(game, kat, [{ key: id, u, override: ov, loc: ov.loc }], { id, name: e.name, eintrag: e, ov }, q);
}
function laborFail(game, fehler) { if (game.log) game.log('Labor: ' + fehler); return { ok: false, fehler }; }

// ---------- Ketten (Nachauftrag AP3a): mehrere Umsetzungen nacheinander auf demselben Landepunkt ----------
// Prüft, ob der Zustand einer Außenkarte über mehrere Szenen richtig weiterläuft (Anker-Zustände, Besetzung, Personen) – so
// plant der Spielleiter. Ketten stehen nicht in laborListe und damit nicht in der Lobby (nur Bots, Tests, API).
// Der gemeinsame Landepunkt (map, loc) gilt für alle Szenen, deren Umsetzung 'map' kennt (sonst deren Testwerte).
const KETTEN = {
  b7: { name: 'B-7 Plattform', map: 'platform', loc: 'b7',
    ids: ['personen_bergen/techniker_retten', 'raetsel_loesen/sonden_code', 'datenkern_bergen/plattform_kern'] },
  wrack: { name: 'Wrack (Handelsschiff Vaelen)', map: 'vaelen.handelsschiff', loc: 'vaelen',
    ids: ['rekonstruieren/wrack_logbuch', 'ausschlachten/wrack_container'] },
  kesh: { name: 'Kesh (Kastell)', map: 'kesh.kastell', loc: 'kesh',
    ids: ['stellung_nehmen/trupp_raeumen', 'raetsel_loesen/zwei_schluessel', 'artefakt_freilegen/fund_aus_gewoelbe', 'entkommen/zu_den_pads'] },
};
// laborKette(game, ids[], params) – params wie laborStart, dazu map/loc (Standard: Landepunkt der ersten Umsetzung)
function laborKette(game, ids, params) {
  const q = params || {};
  if (!an(game.C)) return laborFail(game, 'Das Szenario-Labor ist ausgeschaltet (CONFIG.lobby.labor).');
  const kat = q.katalog || standardKatalog();
  const liste = laborListe(kat);
  if (!Array.isArray(ids) || !ids.length) return laborFail(game, 'Kette ohne Umsetzungen.');
  const fehlt = ids.filter((id) => !liste.some((e) => e.id === id));
  if (fehlt.length) return laborFail(game, `Kette: ${fehlt.join(', ')} im Labor nicht verfügbar.`);
  const erste = umsetzungVon(kat, ids[0]);
  const map = q.map || q.landepunkt || (erste.test && erste.test.params.map) || null;
  const loc = q.loc || (erste.test && erste.test.params.loc) || null;
  const szenen = ids.map((id) => {
    const u = umsetzungVon(kat, id);
    const ov = ueberschreibungen(u, Object.assign({}, q, { map, loc }));
    if (!u.params.map) delete ov.loc;   // ohne Landepunkt-Parameter (Raum) eigener Ort
    return { key: id, u, override: ov, loc: ov.loc };
  });
  const name = 'Kette: ' + ids.map((id) => (liste.find((e) => e.id === id) || {}).name || id).join(' → ');
  return starte(game, kat, szenen, { id: ids.join('+'), name, kette: ids.slice(), ov: { map, loc } }, q);
}
function kette(name) { return KETTEN[name] ? Object.assign({ id: name }, KETTEN[name], { ids: KETTEN[name].ids.slice() }) : null; }

// gemeinsamer Start (Einzel-Umsetzung und Kette): Testbuch bauen, vorbauen, Partie vorbereiten, Mission starten
function starte(game, kat, szenen, meta, q) {
  const fail = (fehler) => laborFail(game, fehler);
  const ov = meta.ov || {};
  const id = meta.id;
  let buch;
  try { buch = testBuch(kat, szenen, 'lab'); } catch (err) { game.countError('labor-buch', err); return fail(err.message); }
  for (const f of vorbauen([buch])) game.countError('labor-vorbau', new Error(f));
  // Partie vorbereiten: Seed, Kartenstand wie nach dem Tutorial (ohne Weltstand, ohne Spielleiter)
  if (Number.isFinite(Number(q.seed)) && q.seed !== null && q.seed !== '') {
    const { makeRng } = require('../util.js');
    game.seed = (Number(q.seed) >>> 0) || 1; game.rng = makeRng(game.seed);
  }
  const m = game.mission;
  // Hafen still bekannt/besucht (wie das Testgelände: keine Erstbesuchsansage, keine Marken)
  const ex = game.explore; const START = require('../../shared/locations.js').START;
  if (ex && !ex.known.has(START)) { ex.known.add(START); ex.version++; }
  if (ex && !ex.visited.has(START)) { ex.visited.add(START); ex.version++; }
  const vorher = m.pending.length;
  m.startCampaign({ tutorial: false });
  m.pending.splice(vorher);   // Tesk-Gerücht der Kampagne gehört nicht ins Labor
  const r = m.registerBook(buch, { origin: 'sl' });
  if (!r || r.ok === false) return fail(`Testbuch abgelehnt: ${JSON.stringify((r && r.errors) || []).slice(0, 300)}`);
  m.startMission(buch.id);
  if (m.activeId !== buch.id) return fail('Testbuch startet nicht.');
  const szene = (buch.steps || []).find((s) => s.loc);
  const anflug = (buch.steps || []).find((s) => /_anflug$/.test(s.id));
  if (q.direkt !== false && szene && anflug) {
    // Hafen-Funk des Testbuchs gilt als angenommen (sonst bliebe „Captain-Konsole: annehmen“ stehen), dann direkt zum Ort
    if (m.state.radio && m.state.radio.needsAccept) m.doAccept();
    const err = game.debugGoto(szene.loc, false) || m.forceStep(buch.id, anflug.id);
    if (err) game.countError('labor-direkt', new Error(err));
  }
  game.god = !!q.god;
  // wirksame Stärke (Anzeige): aus der Besetzung, die der Szenenbau ins Buch geschrieben hat
  const bm = JSON.stringify(buch).match(/"do":"besetzen"[^}]*?"staerke":"(\w+)"/);
  const staerke = bm ? bm[1] : (ov.staerke || null);
  game.labor = { id, buch: buch.id, start: game.time, seed: game.seed, staerke, god: game.god, gemeldet: false, ...(meta.kette ? { kette: meta.kette } : {}) };
  game.oda(`Szenario-Labor: ${meta.name} (Seed ${game.seed}${staerke ? ', Stärke ' + staerke : ''}${game.god ? ', god' : ''}).`, null);
  game.log(`Labor gestartet: ${id} Seed ${game.seed}${staerke ? ' Stärke ' + staerke : ''}${game.god ? ' god' : ''} (${JSON.stringify(ov)}).`);
  return { ok: true, eintrag: meta.eintrag || null, buch: buch.id, ...(meta.kette ? { kette: meta.kette } : {}) };
}

// Tick: Ende der Labor-Mission einmal melden (zurück in die Lobby über das Spielmenü)
function update(game) {
  const L = game.labor;
  if (!L || L.gemeldet) return;
  const ms = game.mission.missions[L.buch];
  if (!ms || ms.state !== 'done') return;
  L.gemeldet = true;
  game.oda(`Labor: Szenario durch (Ausgang ${ms.ausgang || 'erfolg'}). Esc → „Partie beenden“ führt zurück in die Lobby.`, null);
}

module.exports = { laborListe, laborStart, laborKette, KETTEN, kette, testBuch, vorbauen, update, startzustand, an, STAERKEN };
