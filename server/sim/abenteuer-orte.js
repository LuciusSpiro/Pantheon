'use strict';
// DYN-01 A: Orte (Landepunkte) fuer die Dauer eines Abenteuers (Fadens) in der Freien Fahrt (game.weltsim). Action-Layer wie finale-boden.js (Vorbild: bodenStarten/aufraeumen).
// Kern: ein Faden darf an einem beliebigen Hex (Ort der Szene) einen Landepunkt BESTELLEN, auch wo es keinen festen gibt; der Ort lebt, solange der Faden lebt, und wird danach restlos abgeraeumt
// (Karte, Crew-Verweise, Scan-Markierung, Schritt-Aktionen, Cache, Sendezustand), auch nach Speichern/Laden. Zahlen und Namen: content/welt/abenteuer-orte.json (kein Wert im Code).
// Keine Verbraucher in A: Plan-Feld, Beat und Besetzung kommen mit DYN-01 B und BEA-02; abgenommen wird ueber diese Server-Schnittstelle (tools/test-abenteuer-orte.js).
//
//   bestellenAmKoerper(game, fadenId, { ort | hex, koerper, art, besitz?, name?, platz? }) -> lpId | null   Ort an einem Planeten (koerper = Index in scene.planeten; Transferpunkt am Planeten).
//                                                                     Hat der Hex eine Kachel (typ), ist koerper die Kachel-Id (k0) und der Landepunkt der Kachel wird verwendet (kein neuer Ort)
//                                                                     Die Kartenart muss zur Planetenart passen (content/welt/planeten-eignung.json, server/sim/planeten-eignung.js), sonst null; grundAmKoerper(o) -> Klartext | null nennt den Grund
//   bestellenAmPunkt(game, fadenId, { ort | hex, x, y, art, besitz?, name?, platz? }) -> lpId | null   Ort an einem Raumpunkt (z. B. Wrack); Schiff = verfallen (Daten)
//   landeplatzVon(game, fadenId, platz?) -> lpId | null     der Landepunkt dieses Platzes (auch Kachel-Landepunkt), solange er da ist
//   DYN-01 B (Plan-Feld landeplaetze, Beat-Parameter landeplatz): grundAmHex(hex, art) -> Klartext | null (Plan-Pruefer: geht die Art an diesem Hex?); moeglicheArten(hex) -> [art]; platzBestellen(game, fadenId, { id, art, besitz?, name? }) -> lpId | null
//     (Koerper oder Raumpunkt waehlt der Code, idempotent); beatStarten(game, faden, beat) -> null | Grund (Haken in faden.weiterSetzen, wirft nie). Kein Seed, kein Biom, keine Besetzung im Plan (BEA-02/BEA-03).
//   abraeumen(game, fadenId) -> bool                        alle Orte dieses Fadens weg (true) bzw. noch belegt (false, der Takt versucht es wieder); idempotent
//   abgleichen(game) -> { weg, bleibt, neu }                Takt und nach dem Laden: Orte ohne lebende Bestellung weg (Faden beendet, nicht mehr da), fehlende Orte lebender Bestellungen neu
//   lese(roh) -> [Bestellung]                               muellfester Leser fuer welt.sim.faeden.liste[].orte
// ID des Ortes: <ort>.<fadenId>-ort (platz leer) bzw. <ort>.<fadenId>-ort-<platz>; parse(id) -> { ort, faden, platz } | null.
// Zustand: Faden.orte = [{ platz, ort, art, besitz, name?, zustand?, beam }] (die Bestellung, steht im Weltstand) | [{ platz, ort, kachel }] (Kachel-Landepunkt, nichts zu raeumen).
// Der Ort selbst ist fluechtig (landepunkte.neu fluechtig: nie in welt.landepunkte). Seed aus Sim-Seed, ID und Salz: gleiche Karte nach dem Laden.
const D = require('../../content/welt/abenteuer-orte.json');
const Locations = require('../../shared/locations.js');
const Sektoren = require('../../shared/sektoren.js');
const Buehne = require('../../shared/buehne.js');
const Eignung = require('./planeten-eignung.js');

const lazy = (f) => { let m = null; return () => m || (m = require(f)); };
const LP = lazy('./landepunkte.js');
const Lpscan = lazy('./lpscan.js');
const Away = lazy('./away.js');

const fehler = (game, wo, e) => { if (game && game.countError) game.countError(wo, e); };
const istObjekt = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const zahl = (v, max) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
const MUSTER = {
  platz: new RegExp('^' + D.platz_muster + '$'), besitz: new RegExp('^' + D.besitz_muster + '$'), zustand: new RegExp('^' + D.zustand_muster + '$'), ort: new RegExp('^' + D.ort_muster + '$'),
};
const ID = new RegExp('^(.+)\\.(f\\d{1,6})-ort(?:-(' + D.platz_muster + '))?$');

// ---------- ID
const idVon = (ort, fadenId, platz) => `${ort}.${fadenId}-ort${platz ? '-' + platz : ''}`;
function parse(id) {
  const m = typeof id === 'string' ? ID.exec(id) : null;
  return m ? { ort: m[1], faden: m[2], platz: m[3] || '' } : null;
}

// ---------- Faden und Bestellung
const fadenZustand = (game) => (game && game.weltsim && game.weltsim.faeden) || null;   // nie anlegen (ohne Faeden bleibt der Weltstand byte-gleich)
const fadenVon = (game, fadenId) => { const F = fadenZustand(game); return (F && F.liste.find((x) => x.id === fadenId)) || null; };
const lebt = (f) => !!f && f.phase !== 'abgeschlossen';
const bestellungVon = (f, id) => (lebt(f) && f.orte ? f.orte.find((o) => idVon(o.ort, f.id, o.platz) === id) : null) || null;
const seedVon = (game, id) => (Buehne.fnv(D.seed.salz + ':' + id + ':' + (((game.weltsim && game.weltsim.zustand && game.weltsim.zustand.seed) | 0) >>> 0)) % D.seed.modul) + 1;

// Bestellung aus Weltstand pruefen (Muell faellt weg). Kachel-Bestellung: nur platz, ort, kachel.
function pruefeBestellung(e) {
  if (!istObjekt(e) || typeof e.platz !== 'string' || (e.platz !== '' && !MUSTER.platz.test(e.platz)) || typeof e.ort !== 'string' || !MUSTER.ort.test(e.ort)) return null;
  if (e.kachel !== undefined) return typeof e.kachel === 'string' && e.kachel.length <= 60 && e.kachel.startsWith(e.ort + '.') ? { platz: e.platz, ort: e.ort, kachel: e.kachel } : null;
  const b = e.beam;
  if (!D.arten.includes(e.art) || typeof e.besitz !== 'string' || !MUSTER.besitz.test(e.besitz) || !istObjekt(b) || !zahl(b.x, D.beam.x_max) || !zahl(b.y, D.beam.y_max) || !zahl(b.range, D.beam.range_max) || b.range < 1) return null;
  if (e.name !== undefined && !(typeof e.name === 'string' && e.name.length >= 1 && e.name.length <= D.name_max)) return null;
  if (e.zustand !== undefined && !(typeof e.zustand === 'string' && MUSTER.zustand.test(e.zustand))) return null;
  const o = { platz: e.platz, ort: e.ort, art: e.art, besitz: e.besitz };
  if (e.name !== undefined) o.name = e.name;
  if (e.zustand !== undefined) o.zustand = e.zustand;
  o.beam = { x: b.x, y: b.y, range: b.range };
  return o;
}
function lese(roh) {
  const out = [];
  for (const e of Array.isArray(roh) ? roh.slice(0, D.orte_max) : []) {
    const o = pruefeBestellung(e);
    if (o && !out.some((x) => x.platz === o.platz)) out.push(o);
  }
  return out;
}

// ---------- Bestellen
function szene(o) {
  const ort = typeof o.ort === 'string' ? o.ort : typeof o.hex === 'string' ? Sektoren.ortVonHex(o.hex) : null;
  if (!ort || !MUSTER.ort.test(ort) || !Sektoren.hexVonOrt(ort)) return null;   // landepunkte.neu prueft den Ort nie: hier gehoert die Pruefung hin
  const l = Locations.get(ort);
  return l && l.scene ? { ort, sc: l.scene } : null;
}
function koerperVon(sc, k) {
  if (Array.isArray(sc.koerper)) { const kz = sc.koerper.find((x) => x.id === k); return kz ? { kachel: kz.id } : null; }
  const p = Number.isInteger(k) && Array.isArray(sc.planeten) ? sc.planeten[k] : null;
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.r) ? { planetenart: p.art, beam: { x: Math.round(p.x), y: Math.round(p.y), range: Math.round(p.r + D.koerper.beam_zuschlag) } } : null;
}
// Warum bestellenAmKoerper diese Angaben ablehnt (Klartext), null = nichts dagegen. Fuer den Plan-Pruefer (DYN-01 B) und BEA-02; prueft nur Ort, Koerper und Eignung (Muster der uebrigen Felder: bestellung()).
function grundAmKoerper(o) {
  o = istObjekt(o) ? o : {};
  const s = szene(o);
  if (!s) return 'Ort oder Hex unbekannt (kein Hex der Karte mit Szene)';
  const k = koerperVon(s.sc, o.koerper);
  if (!k) return `Koerper '${o.koerper}' gibt es in ${s.ort} nicht`;
  if (k.kachel) return null;   // typ-Hex: der Landepunkt der Kachel gilt (kachelDef), keine Eignungsliste
  return Eignung.grundGegen(k.planetenart, o.art);
}
function bestellung(o, ort, beam) {   // gemeinsame Pruefung der Angaben -> Bestellung | null
  const platz = o.platz === undefined ? '' : o.platz;
  const besitz = o.besitz === undefined ? 'herrenlos' : o.besitz;
  if (typeof platz !== 'string' || (platz !== '' && !MUSTER.platz.test(platz)) || !D.arten.includes(o.art) || typeof besitz !== 'string' || !MUSTER.besitz.test(besitz)) return null;
  const name = o.name === undefined ? D.standardname[o.art] : o.name;
  if (typeof name !== 'string' || !name.trim().length) return null;
  return { platz, ort, art: o.art, besitz, name: name.trim().slice(0, D.name_max), beam };
}
function anlegen(game, f, b) {   // legt den Ort an (fluechtig) und baut ihn vor; die Bestellung steht schon (oder wird vom Aufrufer eingetragen)
  const id = idVon(b.ort, f.id, b.platz);
  LP().neu(game, b.ort, { id, art: b.art, besitz: b.besitz, name: b.name, beam: Object.assign({}, b.beam), seed: seedVon(game, id), zustand: b.zustand, frei: 'immer', fluechtig: true });
  LP().vorbauen(game, [id]);   // sofort, nicht erst bei der ersten Wahl: sonst baut get() im Tick (Median 5 bis 24 ms, Maximum 75 ms bei 33 ms Budget)
  return id;
}
function eintragen(game, fadenId, b, bauen) {
  const f = fadenVon(game, fadenId);
  if (!lebt(f)) return null;
  const alt = (f.orte || []).find((x) => x.platz === b.platz);
  if (alt) return alt.kachel || idVon(alt.ort, f.id, alt.platz);   // schon bestellt (idempotent)
  if ((f.orte || []).length >= D.orte_max) return null;
  let id = null;
  try { id = bauen(f); } catch (e) { fehler(game, 'abenteuer-orte-bestellen', e); return null; }
  (f.orte || (f.orte = [])).push(b.kachel ? { platz: b.platz, ort: b.ort, kachel: b.kachel } : b);
  return id;
}
function bestellenAmKoerper(game, fadenId, o) {
  o = istObjekt(o) ? o : {};
  const s = szene(o);
  const k = s && koerperVon(s.sc, o.koerper);
  if (!k) return null;
  if (k.kachel) {   // typ-Hex: der Landepunkt der Kachel ist ein staendiger Ort (kachelDef), hier entsteht nichts
    const kid = s.ort + '.' + k.kachel;
    const d = LP().kachelDef(kid);
    const platz = o.platz === undefined ? '' : o.platz;
    if (!d || typeof platz !== 'string' || (platz !== '' && !MUSTER.platz.test(platz))) return null;
    return eintragen(game, fadenId, { platz, ort: s.ort, kachel: kid }, () => kid);
  }
  if (!Eignung.artPasstAmKoerper(k.planetenart, o.art)) return null;   // Kartenart passt nicht zur Planetenart (planeten-eignung.json); Klartext: grundAmKoerper
  const b = bestellung(o, s.ort, k.beam);
  return b && eintragen(game, fadenId, b, (f) => anlegen(game, f, b));
}
function bestellenAmPunkt(game, fadenId, o) {
  o = istObjekt(o) ? o : {};
  const s = szene(o);
  if (!s || !Number.isFinite(o.x) || !Number.isFinite(o.y)) return null;
  const b = bestellung(o, s.ort, { x: Math.round(o.x), y: Math.round(o.y), range: D.punkt.beam_reichweite });
  if (!b) return null;
  const z = D.punkt.zustand_nach_art[b.art];
  if (z) b.zustand = z;   // das Wrack im Raum treibt (verfallen); steht in der Bestellung, damit der Ort nach dem Laden gleich wiederkommt
  return eintragen(game, fadenId, b, (f) => anlegen(game, f, b));
}
function landeplatzVon(game, fadenId, platz) {
  const f = fadenVon(game, fadenId);
  const e = lebt(f) && f.orte ? f.orte.find((x) => x.platz === (platz || '')) : null;
  if (!e) return null;
  if (e.kachel) return LP().kachelDef(e.kachel) ? e.kachel : null;
  const id = idVon(e.ort, f.id, e.platz);
  return game.landepunkte && game.landepunkte.dyn[id] ? id : null;
}

// ---------- Plan: Landeplaetze (DYN-01 B). Der Plan (faden-bauplan/1 `landeplaetze`, expandiert in Faden.plan.landeplaetze) nennt je Platz id, art, besitz?, name?; ein Beat mit Parameter `landeplatz` (= id) nutzt ihn.
// Welcher Koerper oder Raumpunkt es wird, entscheidet nicht der Plan, sondern der Code beim Start des ersten Beats, der den Platz nutzt (der Hex der Geschichte wandert, siehe geruecht).
// Kartenarten, die ein Plan an diesem Hex bestellen darf (Koerper-Arten des Hex und Raumpunkt-Arten), in der Reihenfolge der Daten; Hex ohne Szene: []. Der Prompt des Komponisten nennt sie im Kontext.
function moeglicheArten(hex) {
  const am = Eignung.artenAmHex(hex);
  return D.arten.filter((a) => am.punkt.includes(a) || am.koerper.some((k) => k.arten.includes(a)));
}
// Warum die Kartenart an diesem Hex nicht geht (Klartext), null = geht (an einem Koerper des Hex oder am Raumpunkt). Fuer den Plan-Pruefer (faden-pruefer.pruefeLandeplaetze).
function grundAmHex(hex, art) {
  const am = Eignung.artenAmHex(hex);
  if (!am.koerper.length && !am.punkt.length) return `Hex '${String(hex).slice(0, 12)}' ist kein Sektor der Karte mit Szene (nichts bestellbar)`;
  if (moeglicheArten(hex).includes(art)) return null;
  const gruende = Array.from(new Set(am.koerper.map((k) => (k.planetenart ? Eignung.grundGegen(k.planetenart, art) : `Kachel ${k.id} erlaubt nur ${k.arten.join('/') || 'keine Landung'}`))));
  return `Kartenart '${art}' ist an Hex ${hex} nicht moeglich: ${gruende.length ? gruende.join('; ') : 'kein Planet im Sektor'}; am Raumpunkt gehen ${am.punkt.join('/')}`;
}
// Raumpunkt eines Landeplatzes in der Szene: der erste Kandidat der Daten mit genug Abstand zu Planeten, Sternen und Station, sonst der freieste
function punktInSzene(sc) {
  const L = D.punkt.lage;
  const massen = [].concat(sc.planeten || [], sc.stern || [], sc.station ? [sc.station] : []).filter((m) => m && Number.isFinite(m.x) && Number.isFinite(m.y));
  const abstand = (x, y) => massen.reduce((mn, m) => Math.min(mn, Math.hypot(m.x - x, m.y - y) - (Number.isFinite(m.r) ? m.r : 0)), Infinity);
  let best = null;
  for (const [ax, ay] of L.kandidaten) {
    const p = { x: Math.round(sc.w * ax), y: Math.round(sc.h * ay) };
    const a = abstand(p.x, p.y);
    if (a >= L.abstand_min) return p;
    if (!best || a > best.a) best = { p, a };
  }
  return best && best.p;
}
// Den Landeplatz `def` ({ id, art, besitz?, name? }) fuer den Faden bestellen, am Hex der Geschichte (faden.parameter.ort). Koerper-Art: der erste Koerper des Hex, an dem die Art geht (Reihenfolge der Szene, stabil);
// schiff/station: Raumpunkt (punktInSzene). Idempotent: ein Platz, der schon da ist, wird nur zurueckgegeben (mehrere Beats teilen ihn). -> lpId | null (null: kein Platz, Faden weg, Obergrenze, Angaben ungueltig)
function platzBestellen(game, fadenId, def) {
  const f = fadenVon(game, fadenId);
  if (!lebt(f) || !istObjekt(def) || typeof def.id !== 'string') return null;
  const da = landeplatzVon(game, fadenId, def.id);
  if (da) return da;
  const hex = f.parameter && f.parameter.ort;
  const am = Eignung.artenAmHex(hex);
  const o = { hex, art: def.art, besitz: def.besitz, name: def.name, platz: def.id };
  const k = am.koerper.find((x) => x.arten.includes(def.art));
  if (k) return bestellenAmKoerper(game, fadenId, Object.assign(o, { koerper: k.id }));
  if (!am.punkt.includes(def.art)) return null;
  const s = szene(o), p = s && punktInSzene(s.sc);
  return p ? bestellenAmPunkt(game, fadenId, Object.assign(o, p)) : null;
}
// Haken beim Start eines Beats (faden.weiterSetzen): nutzt der Beat einen Landeplatz, wird er bestellt. -> null (nichts zu tun oder bestellt) | Grund (Klartext), dann scheitert der Beat wie bei einem werfenden Baustein. Wirft nie.
function beatStarten(game, f, beat) {
  const id = beat && beat.parameter ? beat.parameter.landeplatz : undefined;
  if (id === undefined) return null;
  try {
    const def = ((f.plan && f.plan.landeplaetze) || []).find((x) => x && x.id === id);
    if (!def) return `Landeplatz '${String(id).slice(0, 16)}' steht nicht im Plan`;
    return platzBestellen(game, f.id, def) ? null : `Landeplatz '${def.id}' (${def.art}) laesst sich am Hex ${f.parameter.ort} nicht bestellen`;
  } catch (e) { fehler(game, 'abenteuer-orte-beat', e); return `Landeplatz '${String(id).slice(0, 16)}': Ausnahme beim Bestellen`; }
}

// ---------- Abraeumen
const unten = (game, id) => (game.players || []).some((p) => p.zone === 'away' && game.away && game.away.map === id);   // game-weit: ein away, ein Transferziel, alle Spieler teilen die Karte
function andereKarte(game, id) {   // die Karte nicht mehr als Aussenkarte halten, sonst gilt sie als belegt (Muster finale-boden.aufraeumen)
  try {
    const sp = Away().beamSpot(game);
    const ziel = sp && sp.map !== id ? sp.map : Object.keys(game.aways).sort().find((m) => m !== id);
    if (ziel) game.setAwayMap(ziel);
  } catch (e) { fehler(game, 'abenteuer-orte-aufraeumen', e); }
}
function spurenLoesen(game, id) {   // was verwerfen() stehen laesst: Scan-Markierung (steht sogar im Weltstand), Sendezustand je Spieler, Reset-Zaehler
  try { Lpscan().vergessen(game, id); } catch (e) { fehler(game, 'abenteuer-orte-scan', e); }
  if (game.mapResets) delete game.mapResets[id];
  for (const p of game.players || []) {
    if (typeof p.awayKv === 'string' && p.awayKv.startsWith(id + '@')) p.awayKv = null;
    if (p.awayEnth) delete p.awayEnth[id];
  }
}
// einen Ort abraeumen -> true (weg) | false (noch belegt: Crew unten oder verwerfen scheitert, naechster Takt)
function ortAbraeumen(game, id) {
  const S = game.landepunkte;
  const d = S && S.dyn[id];
  if (!d) { spurenLoesen(game, id); return true; }
  d.gesperrt = true;   // nicht mehr anwaehlbar, solange er auf das Abraeumen wartet
  if (unten(game, id)) return false;   // Mehrspieler: erst wenn ALLE oben sind
  LP().halteLoesen(game, id);
  if (game.transferZiel && game.transferZiel.lp === id) game.transferZiel = null;
  if (game.away && game.away.map === id) andereKarte(game, id);
  if (!LP().verwerfen(game, id)) return false;
  spurenLoesen(game, id);
  return true;
}
function abraeumen(game, fadenId) {
  const f = fadenVon(game, fadenId);
  if (f) delete f.orte;   // keine Bestellung mehr: der Ort kommt nach dem Laden nicht zurueck
  const S = game && game.landepunkte;
  let alle = true;
  for (const id of S ? Object.keys(S.dyn) : []) {
    const m = parse(id);
    if (m && m.faden === fadenId && !ortAbraeumen(game, id)) alle = false;
  }
  return alle;
}

// ---------- Takt und Laden
function abgleichen(game) {
  const out = { weg: 0, bleibt: 0, neu: 0 };
  if (!game) return out;
  const F = fadenZustand(game);
  const S = game.landepunkte;
  const ex = game.explore;
  const faden = (m) => (F && F.liste.find((x) => x.id === m.faden)) || null;
  for (const id of S ? Object.keys(S.dyn) : []) {   // Orte ohne lebende Bestellung: Faden beendet, nicht mehr da (nach dem Laden verworfen), Bestellung zurueckgenommen
    const m = parse(id);
    if (!m || bestellungVon(faden(m), id)) continue;
    if (ortAbraeumen(game, id)) out.weg++; else out.bleibt++;
  }
  for (const id of ex && ex.lpScan ? Array.from(ex.lpScan) : []) {   // Scan-Reste ohne Ort (Weltstand von vorher): die ID wird nie wieder vergeben, aber der Block waechst sonst
    const m = parse(id);
    if (m && !(S && S.dyn[id]) && !bestellungVon(faden(m), id)) spurenLoesen(game, id);
  }
  for (const f of F ? F.liste : []) {   // lebende Bestellungen ohne Ort (nach dem Laden): der Ort kommt aus dem Faden zurueck
    if (!lebt(f) || !f.orte) continue;
    for (const b of f.orte) {
      if (b.kachel || (S && S.dyn[idVon(b.ort, f.id, b.platz)])) continue;
      try { anlegen(game, f, b); out.neu++; } catch (e) { fehler(game, 'abenteuer-orte-abgleich', e); }
    }
  }
  return out;
}
const update = (game) => { if (game.landepunkte || fadenZustand(game)) abgleichen(game); };   // jeder Tick (game.js): Retry, solange jemand unten ist

module.exports = { grundAmKoerper, grundAmHex, moeglicheArten, punktInSzene, bestellenAmKoerper, bestellenAmPunkt, platzBestellen, beatStarten, landeplatzVon, abraeumen, abgleichen, update, lese, parse, idVon, DATEN: D };
