'use strict';
// SUND-04a-2 P1: Faden-Szenen der Freien Fahrt Sund (Action-Layer). Ein Beat mit Szene (Katalog: beats.json, Feld szene) startet eine Szene: der Spielleiter hat den Beat
// gewaehlt (faden_weiter), die Szene macht die Mechanik, die Daten (content/faeden/szenen-werte.json) die Zahlen und Texte. Eigener Pfad, NICHT der Labor-Pfad: der Szenen-Katalog
// laeuft in der Freien Fahrt nicht (Labor-Start speichert m1–m3, Prüfer lehnt 21 von 27 Orten ab), und eine Faden-Szene ist nicht speicherbar.
//
//   starten(game, { art, fadenId, beatId, nsc?, parameter? }) -> { ok, grund? }
//       art verfolgung | raumschlacht | befreiung | konvoi | geleit (Vorlauf, dann Kampf in der Warteschlange: nie zwei Szenen übereinander, nie bei laufender Sim-Szene)
//       SUND-04b B2: konvoi (Konvoi.an, ohne Mission) und geleit (Escort.spawn: Geleit, Havarist, Panne) in faden-szene-b2.js; die Wahl des Beats (Parameter sieg, modus) steht in parameter.beat
//       art spontanhilfe: der Beat wartet auf das nächste Gefecht (Sim-Szene oder Raumschlacht); einmal je Gefecht gewürfelt
//   update(game, dt)   Takt (aus game.step, nur wenn eine Faden-Szene, eine Warteschlange oder ein Beat „spontanhilfe“ da ist)
//   andocken(game)     Andocken = Szenenwechsel (Hook: game.js, missionEvent docked): die Szene endet gescheitert, die Warteschlange steht wieder aus
//   Ausgaenge: gelungen | gescheitert über faden.beatAusgang; Unterbrechung durch eine Sim-Szene und Warteschlange-Abbau über faden.beatZurueck (ohne Ausgang)
//   Vorwarnung: Funk vor dem Eintreffen, mindestens vorlauf_min_s (8 s). Keine Optionen bei Gefahr (Katalog gefahr, Prüfer).
//   Zufall: eigener Strom (reise-ereignis.strom mit Salz aus den Daten), nie game.rng, nie der Strom der Sim.
//   Verbündeter (spontanhilfe): Flotte.aufstellen (EK4, Verbündete); Crew-Geschosse treffen nur space.enemies, Verbündete sind unverwundbar (SUND-02b E). Er verschwindet am Ende.
//
// Zustand (nur Laufzeit, nicht gespeichert): game.fadenSzene { id, fadenId, beatId, art, nsc, phase: vorlauf | kampf, ab, start, szene, tag, sek, n, textKey, plan },
//   game.fadenWarte [ { fadenId, beatId, art, nsc, parameter, szene } ], game.fadenHilfe { fadenId, beatId, nsc, schiff, name, versucht, n, ally: { tag, kampf } | null }.
// Abweichung (Auftrag, Entscheidung): geiseln_befreien am Boden entfaellt; befreiung ist eine Raumszene mit Wachschiffen (Boden-Szenen laufen in der Freien Fahrt nicht).
const Faden = require('./faden.js');
const D = require('./faden-daten.js');
const Bausteine = require('./faden-bausteine.js');
const Fracht = require('./faden-fracht.js');
const Hinweis = require('./faden-hinweis.js');
const SZB2 = require('./faden-szene-b2.js');   // SUND-04b B2: Szenenarten konvoi und geleit
const Sektoren = require('../../shared/sektoren.js');
const Verfolgung = require('./verfolgung.js');
const Zielsysteme = require('./zielsysteme.js');
const Reise = require('./reise-ereignis.js');
const DATEN = require('../../content/faeden/szenen-werte.json');

const W = Object.fromEntries(Object.entries(DATEN.werte).map(([k, v]) => [k, v.wert]));
const T = DATEN.texte;
const ARTEN = W.arten;
const SPRECHER = T.sprecher;

let spaceMod = null, flotteMod = null;   // lazy (Zirkelbezug space -> faden-szene über game.js)
const space = () => spaceMod || (spaceMod = require('./space.js'));
const flotte = () => flotteMod || (flotteMod = require('./flotte.js'));

const fmt = (t, v) => String(t == null ? '' : t).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m));
const funk = (game, text) => { if (text) game.emit('radio', { from: SPRECHER, text: String(text), lage: 1 }); };
// Gate: FAEDEN=1 und Freie Fahrt. Gestartet werden Szenen nur durch einen Beat, und einen Beat startet nur der Spielleiter (faden_weiter); fällt er aus,
// laufen die Fristen nicht ab (faden.js B-S3), eine begonnene Szene endet wie jede Szene, wenn der Beat schon weg ist.
const aktiv = (game) => Faden.aktiv(game);
const crewN = (game) => Math.max(W.crew_min, Math.min(W.crew_max, game.players.filter((p) => p.connected).length));
const nachCrew = (map, n) => Number(map[String(Math.min(W.crew_max, Math.max(W.crew_min, n)))]) || Number(map[String(W.crew_min)]) || 0;
const pick = (n) => (n ? { id: n.id, name: n.name, schiff: n.schiff, schiffsklasse: n.schiffsklasse, fraktion: n.fraktion } : null);
// Zufall: eigener Strom, Zähler im Aufrufer (nie game.rng). Nacharbeit L4: der Strom gehört zu GENAU dieser Hilfe: Weltseed, Faden, NSC, Beat und der Tätigkeitszähler der Fäden (gespeichert)
// stehen im Salz, n zählt die Gefechte dieser Hilfe. Gleiche Eingaben = gleiche Folge; eine andere Hilfe, ein anderer Faden oder ein späterer Anlauf nach beatZurueck/Laden würfelt anders.
function wuerfel(game, h) {
  const seed = ((Number(game.weltsim.zustand.seed) | 0) ^ 0x48494c46) >>> 0;   // „HILF“
  const F = Faden.zustandVon(game);
  const salz = [W.spontanhilfe_salz, h.fadenId, h.nsc, h.beatId, F ? F.t : 0].join(':');
  return Reise.strom(seed, h.n, salz)();
}
// Der Beat läuft noch (Frist und Andocken haben ihn nicht schon beendet)
function laeuft(game, fadenId, beatId) {
  const F = Faden.zustandVon(game); const f = F && F.liste.find((x) => x.id === fadenId);
  return !!(f && f.phase === 'laeuft' && f.laufend && f.laufend.beat === beatId);
}
const verfolgungLaeuft = (game) => Verfolgung.aktiv(game) && !Verfolgung.ausgang(game);
// Nacharbeit L1: auch eine laufende Reise-Gefahr (angekündigt oder im Kampf, reise-ereignis.js) ist ein Kampf: nie zwei Kämpfe übereinander (die Gegenrichtung steht in reise-ereignis.update)
const frei = (game) => !game.simSzene && !game.fadenSzene && !verfolgungLaeuft(game) && !Reise.gefahrLaeuft(game) && !game.ship.docked;

// ---------- Einplanen ----------
function starten(game, o) {
  const q = o || {};
  if (!aktiv(game)) return { ok: false, grund: 'INAKTIV' };
  if (!ARTEN.includes(q.art)) return { ok: false, grund: 'ART_UNBEKANNT' };
  if (typeof q.fadenId !== 'string' || !q.fadenId) return { ok: false, grund: 'FADEN_FEHLT' };
  if (typeof q.beatId !== 'string' || !q.beatId) return { ok: false, grund: 'BEAT_FEHLT' };
  if (!game.ship) return { ok: false, grund: 'SCHIFF_FEHLT' };   // angedockt wird eingereiht, nicht abgewiesen: die Szene beginnt erst nach dem Ablegen (frei)
  if (q.art === 'spontanhilfe') return hilfeEinplanen(game, q);
  const warte = game.fadenWarte || (game.fadenWarte = []);
  if (warte.length >= W.warteschlange_max) return { ok: false, grund: 'WARTESCHLANGE_VOLL' };
  warte.push({ fadenId: q.fadenId, beatId: q.beatId, art: q.art, nsc: pick(q.nsc), parameter: Object.assign({}, q.parameter || {}), szene: game.ship.scene });
  naechsteStarten(game);
  return { ok: true, grund: null };
}

// ---------- Warteschlange und Beginn ----------
function naechsteStarten(game) {
  if (game.fadenWarte && game.fadenWarte.length) game.fadenWarte = game.fadenWarte.filter((it) => laeuft(game, it.fadenId, it.beatId));   // ein Eintrag, dessen Beat schon beendet ist (Frist), wird verworfen
  if (!game.fadenWarte || !game.fadenWarte.length || !frei(game)) return;
  beginnen(game, game.fadenWarte.shift());
}
function beginnen(game, it) {
  game.fadenSzeneN = (game.fadenSzeneN || 0) + 1;
  const sek = Math.max(W.vorlauf_min_s, W.vorlauf_s);   // nie unter der Untergrenze der Vorwarnung
  const b2 = SZB2.istArt(it.art) ? SZB2.plan(it, crewN(game), nachCrew, game) : null;   // SUND-04b B2: die Wahl des Beats und die angekündigte Zahl
  const n = b2 ? b2.n : (it.art === 'raumschlacht' || it.art === 'befreiung') ? nachCrew(W[it.art].anzahl, crewN(game)) : 1;
  const fs = { id: game.fadenSzeneN, fadenId: it.fadenId, beatId: it.beatId, art: it.art, nsc: it.nsc, phase: 'vorlauf', ab: game.time + sek, start: null, szene: game.ship.scene, tag: 'fs' + game.fadenSzeneN, sek, n, textKey: b2 ? b2.textKey : it.art, plan: b2 };   // n: die angekündigte Zahl (K2)
  game.fadenSzene = fs;
  const klasse = (it.art === 'raumschlacht' || it.art === 'befreiung') ? W[it.art].klasse : '';
  const vars = { name: it.nsc ? it.nsc.name : '', schiff: it.nsc ? it.nsc.schiff : '', klasse, n, sek: Math.round(sek) };
  funk(game, fmt(T.vorwarnung[fs.textKey], vars));   // Fairness: die Gefahr wird vorher angekündigt, nie abgefragt
  return fs;
}

// Kampf beginnt (nach dem Vorlauf): Gegner oder das Zielschiff der Verfolgung
function kampfBeginn(game, fs) {
  fs.phase = 'kampf'; fs.start = game.time;
  const L = game.ship;
  if (fs.art === 'verfolgung') {
    const nsc = fs.nsc || {};
    const klasse = W.verfolgung.klassen[nsc.schiffsklasse] || W.verfolgung.standard;
    const z = Verfolgung.starten(game, { klasse, volk: nsc.fraktion || undefined, name: nsc.schiff || undefined, wiederholung: false });
    if (!z) return enden(game, fs, 'gescheitert', null);
    return null;
  }
  if (SZB2.istArt(fs.art)) {   // SUND-04b B2: kein Platz fuer den Schuetzling ist keine Niederlage der Crew: unterbrechen (der Beat steht wieder aus), sonst scheitert die Szene
    const r = SZB2.beginn(game, fs);
    return r === true ? null : r === 'kein_platz' ? unterbrechen(game, fs) : enden(game, fs, 'gescheitert', null);
  }
  const C = W[fs.art]; const n = fs.n;   // K2: genau die Zahl, die im Funk stand (die Crewgröße beim Ankündigen), nie mehr
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + W.ring_winkel_start;
    if (!space().spawnEnemy(game, C.klasse, { x: L.x + Math.cos(a) * C.ring, y: L.y + Math.sin(a) * C.ring, tag: fs.tag, volk: C.volk })) break;
  }
  return null;
}

// ---------- Ende ----------
// Aufräumen: Gegner der Szene und das Zielschiff der Verfolgung gehen, der Verbündete des Gefechts bleibt bis zum Ende seines Gefechts (hilfeTakt)
function aufraeumen(game, fs) {
  const sp = game.space;
  const vf = fs.art === 'verfolgung' ? sp.verfolgung : null;   // nur die Verfolgung dieser Szene, nie eine fremde
  if (SZB2.istArt(fs.art)) SZB2.aufraeumen(game, fs);   // SUND-04b B2: Konvoi bzw. Schützling (die Angreifer tragen den Tag der Szene und gehen unten)
  const weg = sp.enemies.filter((e) => e.tag === fs.tag || (vf && e.id === vf.ziel));
  if (weg.length) sp.enemies = sp.enemies.filter((e) => !weg.includes(e));
  if (weg.some((e) => e.id === game.ship.target)) Zielsysteme.zielLoeschen(game);
  if (vf) { sp.verfolgung = null; if (!game.simSzene) Zielsysteme.szeneAn(game, false); }
  game.fadenSzene = null;
}
// Ende der Szene mit Ausgang (gelungen, gescheitert) oder ohne (Unterbrechung, siehe unterbrechen). textKey: Funk-Text (null = keiner)
function enden(game, fs, ausgang, textKey) {
  const name = fs.nsc ? fs.nsc.name : '';
  const txt = textKey ? T[textKey] : (ausgang === 'gelungen' ? T.gelungen[fs.textKey || fs.art] : T.gescheitert[fs.textKey || fs.art]);
  aufraeumen(game, fs);
  funk(game, fmt(txt, { name }));
  if (laeuft(game, fs.fadenId, fs.beatId)) Faden.beatAusgang(game, fs.fadenId, ausgang);
  naechsteStarten(game);
}
// Eine Sim-Szene hat Vorrang: die Faden-Szene endet OHNE Ausgang, der Beat steht wieder aus (wird neu angeboten)
function unterbrechen(game, fs) {
  aufraeumen(game, fs);
  Faden.beatZurueck(game, fs.fadenId);
  funk(game, T.unterbrochen);
}
// Andocken: eine laufende Szene endet als Szenenwechsel (gescheitert). Die Warteschlange bleibt: sie wartet, bis das Schiff wieder frei ist (frei) oder der Sektor wechselt (update)
function andockenEnde(game) {
  const fs = game.fadenSzene;
  if (fs) enden(game, fs, 'gescheitert', 'szenenwechsel');
}

// Takt eines laufenden Kampfes: Ausgang nach Art (Gegner gehen oder fallen, Zielschiff gestellt/zerstört/entkommen)
function kampfTakt(game, fs) {
  if (!laeuft(game, fs.fadenId, fs.beatId)) { aufraeumen(game, fs); naechsteStarten(game); return; }   // Frist oder ein anderer Weg hat den Beat schon beendet
  if (fs.art === 'verfolgung') {
    const a = Verfolgung.ausgang(game);
    if (a === 'gestellt' || a === 'zerstoert') return enden(game, fs, 'gelungen', null);
    if (a === 'entkommen' || !Verfolgung.aktiv(game)) return enden(game, fs, 'gescheitert', null);
    return null;
  }
  if (SZB2.istArt(fs.art)) { const a = SZB2.ausgang(game, fs); return a ? enden(game, fs, a, null) : null; }   // SUND-04b B2: Ausgang aus Konvoi-Ausgang bzw. Zustand des Schützlings
  if (!game.space.enemies.some((e) => e.tag === fs.tag)) return enden(game, fs, 'gelungen', null);   // alle zerstört oder abgezogen
  return null;
}

// ---------- Verbündeter der Spontanhilfe ----------
// SUND-04a-2 P3: eine zweite Spontanhilfe, während eine läuft, WARTET in einer Schlange (höchstens warteschlange_max wie die Szenen), statt zu scheitern (die Lücke aus P1).
// Rückt sie nach, wenn die erste Hilfe endet (hilfeNaechste); ein Eintrag, dessen Beat schon beendet ist, fällt weg.
function hilfeEinplanen(game, q) {
  // Ein Beat, der schon beendet ist, blockiert nichts. Nacharbeit K5: die nächste WARTENDE rückt nach (Reihenfolge), die neue stellt sich hinten an und überspringt die Schlange nie
  if (game.fadenHilfe && !laeuft(game, game.fadenHilfe.fadenId, game.fadenHilfe.beatId)) { hilfeWeg(game); game.fadenHilfe = null; hilfeNaechste(game); }
  const h = { fadenId: q.fadenId, beatId: q.beatId, nsc: q.nsc ? q.nsc.id : null, schiff: q.nsc ? q.nsc.schiff : '', name: q.nsc ? q.nsc.name : '', versucht: null, n: 0, ally: null };
  if (!game.fadenHilfe) { game.fadenHilfe = h; return { ok: true, grund: null }; }
  const warte = game.fadenHilfeWarte || (game.fadenHilfeWarte = []);
  if (warte.length >= W.warteschlange_max) return { ok: false, grund: 'HILFE_LAEUFT' };
  warte.push(h);
  return { ok: true, grund: 'WARTET' };
}
// Rückt die nächste wartende Hilfe nach (ihr Beat läuft noch); fällt sonst weg
function hilfeNaechste(game) {
  const warte = game.fadenHilfeWarte || [];
  while (warte.length) { const h = warte.shift(); if (laeuft(game, h.fadenId, h.beatId)) { game.fadenHilfe = h; return; } }
}
// Ein Gefecht (Sim-Szene oder Faden-Kampf) ist da: einmal würfeln; der Verbündete erscheint, wenn der Wurf unter der Chance der Haltung liegt
function wuerfeln(game, h) {
  h.n++;
  const npc = Faden.nscVon(game, h.nsc);
  const p = npc ? Faden.chanceSpontanhilfe(npc) : 0;
  if (!(wuerfel(game, h) < p)) return false;
  const L = game.ship; const a = h.n * W.spontanhilfe.winkel_schritt;   // Platz am Ring der Lerche (deterministisch aus dem Zähler)
  // Nacharbeit L6: der Tag ist je Hilfe eindeutig (Tätigkeitszähler der Fäden, gespeichert): ein im Gefecht zerstörter Verbündeter schreibt den Fakt flotte_<tag> = verloren in den Weltstand,
  // und flotte.aufstellen gibt für ein „verlorenes“ Tag nie wieder ein Schiff her: derselbe NSC könnte nie mehr helfen
  const Fz = Faden.zustandVon(game);
  const tag = 'nsc_' + h.nsc + '_' + (Fz ? Fz.t : 0);
  const es = flotte().aufstellen(game, { tag, kind: W.spontanhilfe.klasse, name: h.schiff, rolle: 'angreifer', von: { x: L.x + Math.cos(a) * W.spontanhilfe.ring, y: L.y + Math.sin(a) * W.spontanhilfe.ring } });
  if (!es) return false;
  h.ally = { tag, kampf: h.versucht };
  funk(game, fmt(T.hilfe_erscheint, { name: h.name }));
  funk(game, fmt(T.hilfe_eingesetzt, { name: h.name, schiff: h.schiff }));
  return true;
}
function hilfeWeg(game) {
  const h = game.fadenHilfe;
  if (!h || !h.ally) return;
  if (game.space.escorts) game.space.escorts = game.space.escorts.filter((q) => q.tag !== h.ally.tag);
  h.ally = null;
  if (!game.simSzene && game.flotte) { try { flotte().beenden(game); } catch (e) { if (game.countError) game.countError('faden-hilfe', e); } game.flotte = null; }
}
function hilfeTakt(game) {
  const h = game.fadenHilfe; if (!h) return;
  if (!laeuft(game, h.fadenId, h.beatId)) { hilfeWeg(game); game.fadenHilfe = null; hilfeNaechste(game); return; }   // Frist oder Andocken: der Beat ist nicht mehr da
  const rg = Reise.gefahrKampf(game);   // Nacharbeit L1: der Kampf einer Reise-Gefahr ist ein Gefecht wie jedes andere
  const key = game.simSzene ? 'sim' + game.simSzene.id : (game.fadenSzene && game.fadenSzene.phase === 'kampf' ? 'fs' + game.fadenSzene.id : (rg ? 'rg' + rg.nr : null));
  if (h.ally && h.ally.kampf !== key) { hilfeWeg(game); game.fadenHilfe = null; Faden.beatAusgang(game, h.fadenId, 'gelungen'); hilfeNaechste(game); return; }   // das Gefecht ist vorbei: er hat mitgekämpft
  if (!h.ally && key && h.versucht !== key) { h.versucht = key; wuerfeln(game, h); }
}

// ---------- Zurücksetzen ----------
// Nacharbeit L3: der Laufzeitzustand gehört zur Partie (nicht zum Weltstand): neues Spiel, Lobby, Laden und Moduswechsel laufen alle über game.reset(), das hier aufruft. Es rührt weder Flotte
// noch Raum an (beides setzt reset() selbst zurück): ein Verbündeter der alten Partie ruft im neuen Spiel nie flotte().beenden und gibt keinen Funk.
function zuruecksetzen(game) {
  game.fadenSzene = null; game.fadenWarte = null; game.fadenHilfe = null; game.fadenHilfeWarte = null; game.fadenSzeneN = 0;
}

// ---------- Takt ----------
function update(game) {
  if (!aktiv(game)) { if (game.fadenSzene || game.fadenWarte || game.fadenHilfe || game.fadenHilfeWarte) zuruecksetzen(game); return; }   // Nacharbeit L3: ohne Schalter und Welt tut der Takt nichts und lässt nichts liegen
  if (!game.fadenSzene && !(game.fadenWarte && game.fadenWarte.length) && !game.fadenHilfe && !(game.fadenHilfeWarte && game.fadenHilfeWarte.length)) return;
  if (game.ship.docked && game.fadenSzene) andockenEnde(game);
  else if (game.simSzene && game.fadenSzene) unterbrechen(game, game.fadenSzene);
  else if (game.fadenSzene && game.fadenSzene.szene !== game.ship.scene) enden(game, game.fadenSzene, 'gescheitert', 'szenenwechsel');
  else if (game.fadenSzene && game.fadenSzene.phase === 'vorlauf' && game.time >= game.fadenSzene.ab && !game.simSzene) {
    // K1: der Beat läuft noch? (Frist oder ein anderer Weg hat ihn im Vorlauf beendet: kein Kampf für einen Beat, der nicht mehr da ist)
    if (laeuft(game, game.fadenSzene.fadenId, game.fadenSzene.beatId)) kampfBeginn(game, game.fadenSzene); else aufraeumen(game, game.fadenSzene);
  }
  else if (game.fadenSzene && game.fadenSzene.phase === 'kampf') kampfTakt(game, game.fadenSzene);
  // Warteschlange: was in einem anderen Sektor geplant war, steht wieder aus
  if (game.fadenWarte && game.fadenWarte.length) {
    const alt = game.fadenWarte.filter((it) => it.szene !== game.ship.scene);
    if (alt.length) { game.fadenWarte = game.fadenWarte.filter((it) => it.szene === game.ship.scene); for (const it of alt) Faden.beatZurueck(game, it.fadenId); }
  }
  naechsteStarten(game);
  hilfeTakt(game);
}

// ---------- Bausteine (faden-bausteine.registriere): jeder Beat mit Szene ruft starten() mit seiner Art ----------
function beatStarten(game, art, faden, ctx) {
  const r = starten(game, { art, fadenId: faden.id, beatId: ctx.beat.id, nsc: ctx.nsc, parameter: ctx.parameter });
  return r.ok ? { laeuft: true } : { ausgang: 'gescheitert' };
}
for (const art of ARTEN) Bausteine.registriere(art, { starten(game, faden, ctx) { return beatStarten(game, art, faden, ctx); } });
// SUND-04b B2: konvoi und geleit lesen die Wahl des Beats (Parameter sieg, modus) aus beat.parameter; sie liegt als parameter.beat in der Warteschlange
for (const art of SZB2.ARTEN) {
  Bausteine.registriere(art, { starten(game, faden, ctx) { return beatStarten(game, art, faden, Object.assign({}, ctx, { parameter: Object.assign({}, ctx.parameter, { beat: Object.assign({}, ctx.beat.parameter) }) })); } });
}

// Welle 3: die Befreiung findet am ORT DES NSC statt (faden.parameter.ort), nirgends sonst. Ist das Schiff schon dort, beginnt sie wie jede Szene (Vorwarnung, Vorlauf, Wachschiffe).
// Sonst sagt der Funk, wo er festsitzt, der Beat laeuft und wartet auf die Ankunft (befreiungAnkunft, Takt aus faden-p3.update, wie der Notruf): der Faden SELBST ist der Zustand, nichts davon wird
// gespeichert; die Frist des Beats scheitert die Befreiung, wenn die Crew nicht kommt. Ein Faden ohne Ort kann nichts befreien: gescheitert.
const HEX = /^\d{4}$/;
const hexName = (hex) => { try { return Sektoren.hexName(hex) || hex; } catch (e) { return hex; } };
const echteBefreiung = () => Bausteine.vonId('befreiung') === befreiungBaustein;
const befreiungBaustein = {
  starten(game, faden, ctx) {
    const ort = faden.parameter && faden.parameter.ort;
    if (!ort || !HEX.test(ort)) return { ausgang: 'gescheitert' };
    if (Sektoren.hexVonOrt(game.ship.scene) === ort) return beatStarten(game, 'befreiung', faden, ctx);
    funk(game, fmt(T.befreiung_ort, { name: faden.nsc.name, ort: hexName(ort) }));
    return { laeuft: true };
  },
};
Bausteine.registriere('befreiung', befreiungBaustein);
// Takt: jeder laufende Befreiungs-Beat, dessen Szene noch nicht eingeplant ist, beginnt, sobald das Schiff am Ort des NSC ist
// Der laufende Befreiungs-Beat eines Fadens (sonst null)
function befreiungBeat(f) {
  if (f.phase !== 'laeuft' || !f.laufend) return null;
  const beat = D.vorlage(f.vorlage).beats[f.beat];
  return beat && beat.id === f.laufend.beat && D.BEATS[beat.typ].baustein === 'befreiung' ? beat : null;
}
// Welle 4 (S4): ein Schnellsprung (reise.js) darf nicht durch den Ort eines wartenden NSC fuehren und von dort weiterspringen: das Verlassen des Sektors beendet die Befreiung gescheitert (der NSC
// stirbt), ohne dass die Crew es wollte. Text fuer den Halt am Ort (der Rest der Route bleibt gewaehlt, wie nach einem Reise-Ereignis), sonst null.
function befreiungHalt(game, hex) {
  if (!aktiv(game) || !echteBefreiung() || !game.ship) return null;
  const F = Faden.zustandVon(game);
  const f = F.liste.find((x) => befreiungBeat(x) && x.parameter.ort === hex);
  return f ? fmt(T.schnellsprung_befreiung, { name: f.nsc.name, ort: hexName(hex) }) : null;
}
function befreiungAnkunft(game, hier) {
  if (!aktiv(game) || !echteBefreiung() || !game.ship) return;
  const F = Faden.zustandVon(game);
  for (const f of F.liste.slice()) {
    const beat = befreiungBeat(f);
    if (!beat) continue;
    if (f.parameter.ort !== hier) continue;
    if ((game.fadenSzene && game.fadenSzene.fadenId === f.id) || (game.fadenWarte || []).some((it) => it.fadenId === f.id)) continue;   // schon eingeplant oder laeuft
    starten(game, { art: 'befreiung', fadenId: f.id, beatId: beat.id, nsc: f.nsc, parameter: f.parameter });
  }
}
Bausteine.registriere('fracht', {
  starten(game, faden, ctx) {
    const p = ctx.beat.parameter || {};
    // P3: „$ort“ ist der Ort des Fadens (der Zielhafen ist der Ort, an dem die Crew den NSC traf); die Hinweise des Beats gelten mit der Beladung (B-S1)
    // Nacharbeit F6: „$ort“ = der naechste ANDOCKBARE roemische/Konkordat-Hafen in Reichweite des Ortes (Fracht.zielFuer); gibt es keinen, wird nie eine Scheinfracht geladen
    const ort = faden.parameter && faden.parameter.ort;
    const nach = p.nach === '$ort' ? Fracht.zielFuer(game, ort) : p.nach;
    const r = nach ? Fracht.laden(game, { fadenId: faden.id, ware: p.ware, nachHafen: nach }) : { ok: false };
    if (!r.ok) { Fracht.funk(game, 'kein_ziel', { ort: ort ? Sektoren.hexName(ort) : 'hier' }); return { ausgang: 'gescheitert' }; }
    for (const h of ctx.beat.hinweise || []) Hinweis.senden(game, faden.id, h);   // Nacharbeit F2: der Hinweis (Papiere) wird gesendet, erst dann gilt er
    return { laeuft: true };
  },
});

// Andocken am Zielhafen: Fracht abliefern (faden-fracht.js), dann ist jeder Szenenwechsel durch Andocken erledigt
function andockenHook(game) {
  if (!aktiv(game)) return;
  andockenEnde(game);
  Fracht.andocken(game);
}

// Zustand für Tests und Anzeige
const zustand = (game) => ({ szene: game.fadenSzene || null, warte: (game.fadenWarte || []).slice(), hilfe: game.fadenHilfe || null });

module.exports = { befreiungAnkunft, befreiungHalt, starten, update, andockenHook, zuruecksetzen, zustand, ARTEN, aufraeumen, wuerfeln, verfolgungLaeuft, frei, unterbrechen, kampfTakt };
