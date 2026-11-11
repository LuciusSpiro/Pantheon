'use strict';
// EK3 Teil A (CONTRACT-EK3): Fracht (Ladung) im Raum, Beamen an Bord und Abliefern von der Ops, Frachtraum der Lerche.
//
//   fracht_abwerfen(game, x, y, art)   Schnittstelle für die Konvoi-Szene (Teil B): ein zerstörter Transporter lässt Fracht fallen.
//   weapons.fracht { id? } / { off }   Ops: Halteprozess starten (nächste Fracht in Reichweite) bzw. abbrechen
//   weapons.abliefern                  Ops: Fracht beim Abnehmer abgeben (derselbe Halteprozess, Beamen nach draußen)
//
// Regeln (Briefing EK3, Planung E6):
//  - Jedes Modul Frachtraum (PAN-01 B: in jedem der vier Modulräume möglich, auch mehrfach) hat Maps.CARGO_PER_RAUM (4) Plätze: Kapazität = 4 × Frachträume.
//    Ohne Frachtraum nimmt das Schiff nichts an. LAD-01 A2 Typ-Regel: Ein Frachtraum fasst nur EINE Art Ladung (Personen sind eine Art wie jede andere). Die Belegung rechnet
//    Maps.frachtBelegung (Server und Client dieselbe Funktion), platzFuer(game, art) prüft sie, lagerAufnehmen(game, { art, quelle }) ist der EINZIGE Weg ins Lager (Beamen,
//    Debug/Skript, Beute, Zuteilung, Personen, Laden): nichts schreibt an ihm vorbei in s.lager. Ein Platz mehr oder eine fremde Art ohne freies Modul wird abgelehnt (mit Hinweistext).
//  - Beamen: Haltezeit ship.beamTime (3 s; bei beschädigtem Transfer ship.beamTimeDamaged), Reichweite fracht.beamRange (320, wie scene.beam.range
//    der Außenkarten). Ein Systemtreffer (interior.damageSystem) bricht ab, ein Schildtreffer nicht. Auch Transfer ausgefallen, Fracht
//    außer Reichweite oder niemand mehr an der Ops bricht ab. Der Halteprozess belegt nicht ship.beaming (Schilde bleiben oben).
//  - Eine Ladung im Raum bleibt, wo sie ist, bis die Lerche die Szene (das System) verlässt. Dann ist sie weg.
//  - Abliefern: beim Abnehmer (game.fracht.abnehmer.ort, vom Regiebuch gesetzt), sonst bei jeder Station (scene.station.kind in
//    fracht.stationKinds) im Umkreis fracht.stationRange.
//  - LAD-01 B: Eigenschaften je Ladung (Baustein, kein Spezialfall je Geschichte): illegal (Schmuggel), getarnt (angezeigte Art ≠ echte Art), auftrag (gehört einem Auftraggeber/Faden, nicht verkaufbar,
//    nicht an beliebiger Station abgebbar). Sie reisen als Objekt in lagerAufnehmen(game, { art, quelle, eigenschaften }) und stehen im Server-Lagereintrag als l.eig ({ illegal, getarnt, auftrag, aufgedeckt }).
//    Erlaubt ist, was waren.json je Ware unter eigenschaften führt. Server rechnet Typ-Regel, Preis, Gewicht mit der ECHTEN Art (l.art); der Snapshot zeigt dem Spieler die angezeigte Art (anzeigeArt).
//    frachtDurchsuchen(game, { wer, tiefe }) deckt getarnte/illegale Ladung auf (Hook für BEA-01, Ereignis frachtDurchsucht).
//    BEA-01 B: lagerBeschlagnahmen(game, { wer }) nimmt die aufgedeckten illegalen Plätze ohne Auftrag aus dem Frachtraum (Ware weg, Ereignis frachtBeschlagnahmt); der Beat forderung (Art durchsuchung) ruft beide.
//  - Mitgeführte Ladung steht im Weltstand (schiff.fracht = ['sprengstoff', …]); Ladungen im Raum nicht.
//  - Schnittstelle gesichert/ungesichert („Lager ohne Strom“, PAN-01 A): gesichert(game) / setGesichert(game, bool). Das Lager ist kein
//    Schiffssystem, aber das Modul Frachtraum (module.js): läuft es nicht (abgeschaltet oder ohne Strom), setzt module.update die Flagge auf false.
//    Wirkung: huellenTreffer(game) – bei jedem Hüllentreffer löst sich CONFIG.module.fracht.verlustJeTreffer Ladung (Ware; Personen: AP14 hängt sich
//    an gefaehrdet()), sie treibt hinter dem Schiff und kann neu gebeamt werden. Anzeige: Snapshot fracht.g = false (Taktik: UNGESICHERT).
const W = require('../world.js');
const Station = require('./station.js');   // R1 §4.4
const Locations = require('../../shared/locations.js');
const Waren = require('../../shared/waren.js');   // LAD-01 A1: Warenarten, Namen, Preise, Gewicht aus content/waren.json
const { dist } = require('../util.js');

const cfg = (game) => game.C.fracht;
// Kapazität (Waren und Personen) = 2 je Modul Frachtraum (module.js, lazy wegen Zirkelbezug)
const frachtRaeume = (game) => require('./module.js').frachtRaeume(game);
const capacity = (game) => W.Maps.cargoCapacity(frachtRaeume(game));
const r1 = (v) => Math.round(v * 10) / 10;

function neu() {
  return { lager: [], draussen: [], halt: null, gesichert: true, abnehmer: null, abgeliefert: {}, szene: null, seq: 0, zugang: {} };
}
function state(game) { return game.fracht || (game.fracht = neu()); }

const artOk = (game, art) => Waren.artOk(art);   // LAD-01 A1: jede Ware der Kategorie 'ware' in content/waren.json, keine feste Liste
const artName = (art) => Waren.name(art);

// ---------- Abfragen ----------
function anBord(game, art) { const s = state(game); return art ? s.lager.filter((l) => l.art === art).length : s.lager.length; }
// BEA-01 Nacharbeit: Ladung im Frachtraum ohne Personen (Betten sind keine Ladung); anBord zaehlt alles und bleibt wie es ist
function ladungAnBord(game) { return state(game).lager.filter((l) => l.art !== 'person').length; }
function frei(game) { return capacity(game) - state(game).lager.length; }

// ---------- LAD-01 A2: Belegung, Typ-Regel, die eine Einlagerung ----------
const istPerson = (l) => l.art === 'person';
// Arten der Waren in Lagerreihenfolge und Zahl der Personen (die Eingabe von Maps.frachtBelegung); extra = eine Art, die probeweise dazukommt
function belegungsEingabe(game, extra) {
  const lager = state(game).lager;
  const waren = lager.filter((l) => !istPerson(l)).map((l) => l.art);
  let pers = lager.filter(istPerson).length;
  if (extra === 'person') pers++; else if (extra) waren.push(extra);
  return { waren, pers };
}
function belegung(game, extra) { const e = belegungsEingabe(game, extra); return W.Maps.frachtBelegung(frachtRaeume(game), e.waren, e.pers); }
// Die Plätze der Personen (Betten) in Lagerreihenfolge: [{ x, y, nr, raum, id }]; Person i liegt auf dem i-ten Platz der Personen-Module (personen-bord.js)
function personPlaetze(game) {
  const out = [];
  for (const m of belegung(game).module) if (m.art === 'person') for (let i = 0; i < m.anzahl; i++) out.push(m.plaetze[i]);
  return out;
}
// LAD-01 B: die Art, die der Spieler sieht (getarnte, noch nicht aufgedeckte Ware zeigt die Tarnbezeichnung)
const anzeigeArt = (l) => (l.eig && l.eig.getarnt && !l.eig.aufgedeckt ? l.eig.getarnt : l.art);
const anzeigeName = (l) => (l.art === 'person' ? 'Person' : artName(anzeigeArt(l)));
// LAD-01 Nacharbeit 2: die EINE Stelle fuer alles, was der Spieler (Text, Ereignis, Snapshot) ueber eine Ladung erfaehrt: anzeigeArt(l) / anzeigeName(l) (l = Lagereintrag oder Pod, beide tragen art und eig).
// Die echte Art (l.art) bleibt dem Server (Typ-Regel, Preis, Gewicht, missionEvent fuers Regiebuch). Ist die Tarnung aufgedeckt (Durchsuchung), ist die Anzeigeart die echte.
// LAD-01 Nacharbeit 1: Auftragsware (eig.auftrag) ist nie verkaeuflich. Der Kampagnen-Tag KAMPAGNE (Zuteilung der Kette, Konvoi-Beute der Kette) kennzeichnet Ware der Geschichte selbst:
// sie ist wie jede Auftragsware unverkaeuflich (keine Beute-Spirale, kein Softlock der Abgabe), wird aber von der Kampagnen-Abgabe (Ops, fracht_abliefern, fracht_abliefern_bis) angenommen.
// Ware mit dem Tag eines Fadens oder einer Faden-Szene (fremder Auftrag) gibt weiter nur der Faden beim Abnehmer ab.
const KAMPAGNE = 'kampagne';
const hatAuftrag = (l) => !!(l.eig && l.eig.auftrag);
// Die Eigenschaften der Kampagnen-Ware dieser Art ({ auftrag: KAMPAGNE}); null, wenn die Ware laut waren.json keinen auftrag tragen darf (dann bleibt sie gewoehnliche Ware)
const kampagnenEig = (art) => { const w = Waren.get(art); return w && w.kategorie === 'ware' && w.eigenschaften.includes('auftrag') ? { auftrag: KAMPAGNE } : null; };
const fremderAuftrag = (l) => hatAuftrag(l) && l.eig.auftrag !== KAMPAGNE;
const artLabel = (art) => (art === 'person' ? 'Personen' : artName(art));
// Die Belegung je Modul, wie der Spieler sie sieht: [{ raum, art (Anzeigeart | 'person' | null), anzahl, getarnt (ein Eintrag im Modul ist noch nicht aufgedeckt getarnt) }].
// Gerechnet wird mit der ECHTEN Art (Typ-Regel, Maps.frachtBelegung), gezeigt wird die Anzeigeart des ersten Eintrags im Modul. Der Snapshot (fracht.mb) liefert genau das an den Client.
function modulAnzeige(game) {
  const s = state(game); const b = belegung(game); const proArt = {}; const benutzt = {};
  for (const l of s.lager) if (!istPerson(l)) (proArt[l.art] = proArt[l.art] || []).push(l);
  return b.module.map((m) => {
    if (!m.art) return { raum: m.raum, art: null, anzahl: 0, getarnt: false };
    if (m.art === 'person') return { raum: m.raum, art: 'person', anzahl: m.anzahl, getarnt: false };
    const j = benutzt[m.art] || 0; benutzt[m.art] = j + 1;
    const sl = (proArt[m.art] || []).slice(j * W.Maps.CARGO_PER_RAUM, j * W.Maps.CARGO_PER_RAUM + m.anzahl);
    return { raum: m.raum, art: sl.length ? anzeigeArt(sl[0]) : m.art, anzahl: m.anzahl, getarnt: sl.some((l) => l.eig && l.eig.getarnt && !l.eig.aufgedeckt) };
  });
}
function moduleText(mods) { return mods.filter((m) => m.art).map((m) => `${artLabel(m.art)} ${m.anzahl}/${W.Maps.CARGO_PER_RAUM}`).join(', '); }
// Prüfung, ob eine Ladung dieser Art ins Lager passt. -> { ok: true, raum, platz (Platz im Raum 0–3), nr } | { ok: false, grund, text }
// grund: 'unbekannt' (keine Ware) · 'kein_frachtraum' · 'voll' (alle Plätze belegt) · 'art_belegt' (Plätze frei, aber nur in Modulen mit anderer Art, oder das Modul dieser Art ist voll)
function platzFuer(game, art) { return platzPruefen(game, art, null); }
// Wie platzFuer, aber fuer eine Ladung mit Eigenschaften (Pod, Beamen, Einlagern): der Ablehnungstext nennt nur die Anzeigeart der ankommenden Ladung, nie die echte.
function platzFuerLadung(game, l) { return platzPruefen(game, l && l.art, l); }
function platzPruefen(game, art, l) {
  const a = art == null ? cfg(game).artDefault : String(art);
  if (a !== 'person' && !artOk(game, a)) return { ok: false, grund: 'unbekannt', text: 'Diese Ware lässt sich nicht laden.' };
  if (capacity(game) <= 0) return { ok: false, grund: 'kein_frachtraum', text: 'Kein Frachtraum eingebaut.' };
  const n = state(game).lager.length;
  if (n >= capacity(game)) return { ok: false, grund: 'voll', text: `Frachtraum voll (${n}/${capacity(game)})` };
  const b = belegung(game, a);
  if (b.ueber > 0) {
    // LAD-01 Nacharbeit 2: nie die echte Art nennen: die ankommende Ladung heisst, wie sie angezeigt wird; ist im Frachtraum oder bei der Ladung eine Tarnung im Spiel, steht keine Aufstellung der Module im Text
    const zeige = l ? anzeigeArt({ art: a, eig: l.eig && l.eig.getarnt && typeof l.eig.getarnt === 'string' ? l.eig : null }) : a;
    const mods = modulAnzeige(game);
    const heimlich = zeige !== a || mods.some((m) => m.getarnt);
    return { ok: false, grund: 'art_belegt', text: `Kein Frachtraum frei für ${artLabel(zeige)}: ${heimlich ? 'ein Modul ist mit anderer Ladung belegt' : `jedes Modul fasst nur eine Art Ladung (belegt: ${moduleText(mods)})`}. Erst ein Modul leeren (abliefern, abgeben, abwerfen) oder einen weiteren Frachtraum einbauen.` };
  }
  const mods = b.module.filter((m) => m.art === a);
  const m = mods[mods.length - 1];
  return { ok: true, raum: m.raum, platz: m.anzahl - 1, nr: m.plaetze[m.anzahl - 1].nr };
}
// Wie viele Ladungen dieser Art noch hineinpassen (Konvoi-Planung: reicht der Platz für die Beute?)
function freiFuer(game, art) {
  const e = belegungsEingabe(game, null); const R = frachtRaeume(game);
  let k = 0;
  while (k < capacity(game)) {
    const b = art === 'person' ? W.Maps.frachtBelegung(R, e.waren, e.pers + k + 1) : W.Maps.frachtBelegung(R, e.waren.concat(Array(k + 1).fill(art)), e.pers);
    if (b.ueber > 0) break;
    k++;
  }
  return k;
}
// Werft: Hat die Ladung nach dem Ausbau dieses Frachtraums noch Platz (Typ-Regel)? / liegt eine Person in diesem Raum?
function passtOhneRaum(game, raum) { const e = belegungsEingabe(game, null); return W.Maps.frachtBelegung(frachtRaeume(game).filter((q) => q !== raum), e.waren, e.pers).ueber === 0; }
function personImRaum(game, raum) { return belegung(game).module.some((m) => m.raum === raum && m.art === 'person'); }
// Wie viele Ladungen dieser Art das Schiff in seinem jetzigen Zustand insgesamt tragen kann (schon an Bord plus noch frei)
function kapazitaetFuer(game, art) { return anBord(game, art) + freiFuer(game, art); }
const EIGENSCHAFTEN = ['illegal', 'getarnt', 'auftrag'];
// LAD-01 B: die Eigenschaften einer Ladung prüfen. -> { ok: true, eig: { illegal?, getarnt?, auftrag? } | null } | { ok: false, grund: 'eigenschaft', text }
// Unbekannte Schlüssel und Eigenschaften, die die Ware laut waren.json nicht tragen darf, werden abgelehnt.
function eigenschaftenPruefen(art, e) {
  const nein = (text) => ({ ok: false, grund: 'eigenschaft', text });
  if (e == null) return { ok: true, eig: null };
  if (typeof e !== 'object' || Array.isArray(e)) return nein('Eigenschaften müssen ein Objekt sein.');
  const w = Waren.get(art);
  const eig = {};
  for (const [k, v] of Object.entries(e)) {
    if (v == null || v === false) continue;
    if (!EIGENSCHAFTEN.includes(k)) return nein(`Unbekannte Eigenschaft „${k}“ (erlaubt: ${EIGENSCHAFTEN.join(', ')}).`);
    if (!w || w.kategorie !== 'ware' || !w.eigenschaften.includes(k)) return nein(`${artName(art)} kann die Eigenschaft „${k}“ nicht tragen.`);
    if (k === 'illegal') eig.illegal = true;
    else if (k === 'getarnt') { if (typeof v !== 'string' || v === art || !Waren.artOk(v)) return nein('Getarnt braucht die Art, als die die Ware erscheint (eine andere Ware aus waren.json).'); eig.getarnt = v; }
    else if (k === 'auftrag') { if (typeof v !== 'string' || !v) return nein('Auftrag braucht die Kennung des Auftraggebers.'); eig.auftrag = v; }
  }
  return { ok: true, eig: Object.keys(eig).length ? eig : null };
}
const QUELLEN = ['beamen', 'schoepfen', 'debug', 'skript', 'kampagne', 'zuteilung', 'beute', 'person', 'abbau', 'laden', 'faden'];
// Die EINE Einlagerung. o: { art, quelle, person?, name?, eigenschaften?: { illegal, getarnt: '<anzeigeArt>', auftrag: '<id>' } } (Personen tragen person und name, keine Eigenschaften). -> { ok: true, eintrag, raum, platz, nr } | { ok: false, grund, text }
// Kein Ereignis und keine ODA-Meldung hier: das tut der Aufrufer (der Weg kennt seinen Text). quelle wird gezählt (state.zugang, nur Laufzeit, nicht im Stand).
function lagerAufnehmen(game, o) {
  const s = state(game);
  const a = o && o.art != null ? String(o.art) : cfg(game).artDefault;
  if (!o || !QUELLEN.includes(o.quelle)) return { ok: false, grund: 'quelle', text: 'Unbekannte Quelle der Ladung.' };
  const pf = platzFuerLadung(game, { art: a, eig: o.eigenschaften });
  if (!pf.ok) return pf;
  // LAD-01 Nacharbeit 2: Ware mit dem Tag eines erloschenen Fadens (Pod, der nach dem Beat noch treibt) kommt nicht mehr an Bord (sie waere unverkaeuflich, nicht abgebbar und blockierte ein Modul). Zuteilung durch den Faden selbst und Laden aus dem Stand sind ausgenommen.
  if (o.quelle !== 'faden' && o.quelle !== 'laden' && o.eigenschaften && typeof o.eigenschaften.auftrag === 'string' && require('./faden-fracht.js').tagErloschen(game, o.eigenschaften.auftrag)) return { ok: false, grund: 'erloschen', text: 'Diese Ladung gehört zu einem erloschenen Auftrag und wird nicht mehr angenommen.' };
  const ep = a === 'person' ? (o.eigenschaften != null ? { ok: false, grund: 'eigenschaft', text: 'Personen tragen keine Eigenschaften.' } : { ok: true, eig: null }) : eigenschaftenPruefen(a, o.eigenschaften);
  if (!ep.ok) return ep;
  const eintrag = a === 'person' ? { art: 'person', person: String(o.person), name: String(o.name != null ? o.name : o.person), bett: pf.nr } : { art: a };
  if (ep.eig) eintrag.eig = ep.eig;
  s.lager.push(eintrag);
  s.zugang[o.quelle] = (s.zugang[o.quelle] || 0) + 1;
  return { ok: true, eintrag, raum: pf.raum, platz: pf.platz, nr: pf.nr };
}
// LAD-01 B: die Ladung eines Auftrags (Tag = Faden-ID oder Beute-Tag der Szene) aus dem Lager nehmen, ohne Abgabe-Zählung (die Faden-Ware: abgeliefert, verloren, Beat zu Ende; die Konvoi-Beute am Szenenende).
// Gezielt nach Tag, nie "irgendeine Ladung dieser Art". -> Zahl der entnommenen Ladungen
function auftragEntnehmen(game, tag) {
  const s = state(game); let n = 0;
  for (let i = s.lager.length - 1; i >= 0; i--) if (s.lager[i].eig && s.lager[i].eig.auftrag === tag) { s.lager.splice(i, 1); n++; }
  return n;
}
// Pods im All mit diesem Auftrags-Tag (alle Szenen) entfernen. -> Zahl
function podsEntnehmen(game, tag) {
  const s = state(game); const vorher = s.draussen.length;
  s.draussen = s.draussen.filter((d) => !(d.eig && d.eig.auftrag === tag));
  return vorher - s.draussen.length;
}
// Ladung und Pods, deren Auftrags-Tag zu 'muster' passt und den 'erloschen(tag)' als erloschen meldet, entfernen (je Tick). -> Zahl der entfernten Eintraege
function erloschenesAufraeumen(game, muster, erloschen) {
  const s = state(game); let n = 0; const tags = new Set();
  for (const l of s.lager) if (l.eig && muster.test(String(l.eig.auftrag))) tags.add(l.eig.auftrag);
  for (const d of s.draussen) if (d.eig && muster.test(String(d.eig.auftrag))) tags.add(d.eig.auftrag);
  for (const t of tags) if (erloschen(t)) n += auftragEntnehmen(game, t) + podsEntnehmen(game, t);
  return n;
}
const auftragAnBord = (game, tag) => state(game).lager.filter((l) => l.eig && l.eig.auftrag === tag).length;
// Konvoi-Beute: Ladungen dieser Art, die dem Beute-Tag gehören oder keinem fremden Auftrag (Faden-Ware zählt nicht als Beute)
const anBordFuerBeute = (game, art, tag) => state(game).lager.filter((l) => l.art === art && (!l.eig || !l.eig.auftrag || l.eig.auftrag === tag)).length;
// LAD-01 C: Schnittstelle für Abbau (AST-01) und Wrack-Bergung (WRK-01): n Stapel einer Ware (1 Platz = 1 Stapel) so weit einlagern, wie die Typ-Regel es zulässt.
// -> { ok (alles passte), eingelagert, rest (passt nicht, bleibt beim Aufrufer), text (Hinweis des ersten Ablehnungsgrundes) }. Kein Ereignis, keine ODA-Meldung: das tut der Aufrufer.
// Das bestehende GEL-03-Abbauerz (inventory.erz, vorrat.einlagern(…, 'abbau')) bleibt davon unberührt: Erz belegt erst mit WRK-01/AST-01 Plätze.
function stapelEinlagern(game, art, n, quelle) {
  const lim = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  let k = 0, text = null;
  while (k < lim) {
    const r = lagerAufnehmen(game, { art, quelle });
    if (!r.ok) { text = r.text; break; }
    k++;
  }
  return { ok: k === lim && lim > 0, eingelagert: k, rest: lim - k, text };
}
const erzEinlagern = (game, n) => stapelEinlagern(game, 'erz', n == null ? 1 : n, 'abbau');
const beuteEinlagern = (game, art, n) => stapelEinlagern(game, art == null ? 'bergungsgut' : art, n == null ? 1 : n, 'beute');
// Skript-Zuteilung ohne Softlock (Eisenwald k3/k4: Ersatz-Sprengstoff): passt die Art nur wegen einer fremden Art nicht hinein, räumt der Quartiermeister das kleinste Modul mit
// fremder Ware (nie Personen) aus. Gibt true zurück, wenn ausgeladen wurde.
// LAD-01 Nacharbeit 2: es geht NUR das eine kleinste Modul mit gewöhnlicher Fremdware (nie Personen, nie Ware mit auftrag: Faden, Beute, Kampagne). Die Ladung geht nicht verloren: im All legt der
// Quartiermeister sie als Pod hinter das Schiff (wieder an Bord beamen, wie nach einem Hüllentreffer), angedockt bleibt sie im Hafen zurück. Es gibt ein Ereignis (frachtVerloren je Ladung, Anzeigeart)
// und eine Meldung, beide mit der Anzeigeart. l = die ankommende Ladung ({ art, eig }).
function fremdesModulRaeumen(game, l) {
  const s = state(game); const sh = game.ship;
  const art = l.art;
  const b = belegung(game);
  if (b.module.some((m) => !m.art)) return false;
  const proArt = {}; const benutzt = {};
  for (const x of s.lager) if (!istPerson(x)) (proArt[x.art] = proArt[x.art] || []).push(x);
  const mods = b.module.map((m) => {
    if (!m.art || m.art === 'person') return { m, eintraege: [] };
    const j = benutzt[m.art] || 0; benutzt[m.art] = j + 1;
    return { m, eintraege: (proArt[m.art] || []).slice(j * W.Maps.CARGO_PER_RAUM, j * W.Maps.CARGO_PER_RAUM + m.anzahl) };
  });
  const kand = mods.filter((k) => k.m.art && k.m.art !== 'person' && k.m.art !== art && k.eintraege.length && !k.eintraege.some(hatAuftrag)).sort((x, y) => x.m.anzahl - y.m.anzahl)[0];
  if (!kand) return false;
  const weg = kand.eintraege;
  s.lager = s.lager.filter((x) => !weg.includes(x));
  const imAll = !sh.docked;
  const zaehl = {};
  weg.forEach((x, i) => {
    zaehl[anzeigeName(x)] = (zaehl[anzeigeName(x)] || 0) + 1;
    game.emit('frachtVerloren', { art: anzeigeArt(x) });
    if (imAll) { const d = cfg(game).abwurfAbstand; const pod = podAblegen(game, sh.x - Math.cos(sh.angle) * d - Math.sin(sh.angle) * 18 * i, sh.y - Math.sin(sh.angle) * d + Math.cos(sh.angle) * 18 * i, x.art, x.eig); if (pod) pod.eigene = true; }
  });
  const was = Object.entries(zaehl).map(([nm, n]) => `${n}× ${nm}`).join(', ');
  const zeige = anzeigeName({ art, eig: l.eig && typeof l.eig.getarnt === 'string' ? l.eig : null });
  game.oda(`Der Quartiermeister hat ${was} ausgeladen, damit der Frachtraum ${zeige} fassen kann. ${imAll ? 'Die Ladung treibt hinter dem Schiff, dort wieder an Bord beamen.' : 'Die Ladung bleibt im Hafen zurück.'}`, null);
  game.missionEvent('frachtAusgeraeumt', { art: weg[0].art, n: weg.length, pod: imAll });
  return true;
}
function gesichert(game) { return state(game).gesichert !== false; }
function setGesichert(game, on) { state(game).gesichert = !!on; }
// Was bei einem ungesicherten Lager gefährdet ist (Waren und Personen); AP14 (Personen als Fracht) wertet das später aus
function gefaehrdet(game) { return gesichert(game) ? [] : state(game).lager.slice(); }
function lagerArten(game) { return state(game).lager.map((l) => l.art); }
function draussen(game) { const s = state(game); return s.draussen.filter((d) => d.szene === game.ship.scene); }
function abgeliefert(game, art) { const a = state(game).abgeliefert; return art ? (a[art] || 0) : Object.values(a).reduce((x, y) => x + y, 0); }

const isDown = (st) => st === 'broken' || st === 'offline';   // wie interior.isDown (kein require: interior ruft systemTreffer auf)
const transferDown = (game) => isDown(game.ship.systems.transfer);
const haltDauer = (game) => (game.ship.systems.transfer === 'damaged' ? game.C.ship.beamTimeDamaged : game.C.ship.beamTime);
const taktikBesetzt = (game) => game.players.some((p) => p.connected && Station.stationOf(p) === 'weapons' && !p.downed);   // R1: aktive Station

// ---------- Fracht im Raum ----------
// Schnittstelle (Konvoi-Szene, Teil B): Fracht an Weltposition (x, y) der aktuellen Szene ablegen. Gibt das Objekt oder null zurück.
function fracht_abwerfen(game, x, y, art) { return podAblegen(game, x, y, art, null); }
// Der Pod trägt die Eigenschaften der Ladung mit (eig); das Ereignis an alle Clients nennt nur die Anzeigeart (LAD-01 Nacharbeit 2), missionEvent (Regiebuch, serverintern) die echte.
function podAblegen(game, x, y, art, eig) {
  const s = state(game);
  const a = art == null ? cfg(game).artDefault : String(art);
  if (!artOk(game, a) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const pod = { id: 'fr' + (++s.seq), x: r1(x), y: r1(y), art: a, szene: game.ship.scene };
  if (eig) pod.eig = eig;
  s.draussen.push(pod);
  // Höchstens maxDraussen je Szene (Netzbudget): die älteste fällt weg
  const hier = s.draussen.filter((d) => d.szene === pod.szene);
  if (hier.length > cfg(game).maxDraussen) s.draussen.splice(s.draussen.indexOf(hier[0]), 1);
  game.emit('frachtAbgeworfen', { id: pod.id, x: pod.x, y: pod.y, art: anzeigeArt(pod) });
  game.missionEvent('frachtAbgeworfen', { id: pod.id, art: a, x: pod.x, y: pod.y });
  return pod;
}

// PAN-01 A: Ungesichert (Frachtraum-Modul aus) + Hüllentreffer: die älteste Ware löst sich und treibt hinter dem Schiff (neu beamen möglich). Rückgabe: Anzahl.
// SYS-01 A1b: Auslöser ist ein Treffer auf das Frachtraum-Modul (Trefferweg, damage.systemSchaden), nicht mehr jeder Hüllenrest.
function frachtraumTreffer(game, sys) {
  const mm = /^modul_([1-4])$/.exec(String(sys || ''));
  return !!mm && require('./module.js').liste(game).some((m) => m.id === 'frachtraum' && m.raum === Number(mm[1]));
}
function huellenTreffer(game) {
  // SYS-01 A1b: ungesichert = ein Frachtraum ist aus ODER zerstört (ein zerstörtes Modul läuft nicht, gilt also als ungesichert).
  // Nur wer den Frachtraum bewusst abgeschaltet hat (Technik), trägt das Risiko. Fällt er nur durch Reaktorschaden aus (Notstrom), zeigt die Anzeige
  // UNGESICHERT, aber die Ladung bleibt: sonst ginge Kampagnen-Fracht (Konvoi, Eisenwald) durch einen Treffer auf den Reaktor verloren (Kette k2).
  const M = require('./module.js');
  const fr = M.liste(game).filter((m) => m.id === 'frachtraum');
  if (!fr.length) return 0;
  const aus = fr.some((m) => !m.an);
  const zerstoert = fr.some((m) => game.ship.systems['modul_' + m.raum] === 'broken');
  if (!aus && !zerstoert) return 0;
  const s = state(game); const sh = game.ship;
  const lim = (game.C.module && game.C.module.fracht && game.C.module.fracht.verlustJeTreffer) || 1;
  let n = 0;
  while (n < lim) {
    const i = s.lager.findIndex((l) => l.art !== 'person');
    if (i < 0) break;
    const l = s.lager.splice(i, 1)[0];
    n++;
    game.emit('frachtVerloren', { art: anzeigeArt(l) });
    if (!sh.docked) { const pod = podAblegen(game, sh.x - Math.cos(sh.angle) * cfg(game).abwurfAbstand, sh.y - Math.sin(sh.angle) * cfg(game).abwurfAbstand, l.art, l.eig); if (pod) pod.eigene = true; }
    const ortName = (Locations.get(sh.scene) || {}).name;
    game.oda(`${anzeigeName(l)} hat sich gelöst – der Frachtraum ist ungesichert!${!sh.docked && ortName ? ` Sie treibt in ${ortName}, dort wieder an Bord beamen.` : ''}`, null);
    game.missionEvent('frachtVerloren', { art: l.art, n: s.lager.length });
  }
  return n;
}

// ---------- Beamen (Halteprozess) ----------
function beamGrund(game) {
  if (transferDown(game)) return game.ship.systems.transfer === 'offline' ? 'Transfer offline (EMP) – kurz warten.' : 'Transfer zerstört – erst reparieren.';
  return null;
}
function naechste(game) {
  const sh = game.ship; const R = cfg(game).beamRange;
  let best = null; let bd = Infinity;
  for (const d of draussen(game)) { const k = dist(sh.x, sh.y, d.x, d.y); if (k <= R && k < bd) { best = d; bd = k; } }
  return best;
}
// Ops: Halteprozess „an Bord beamen“ starten. id: bestimmte Fracht, sonst die nächste in Reichweite. Rückgabe: Fehlertext | null.
function beamStart(game, p, id) {
  const s = state(game);
  if (s.halt) return 'Transfer läuft bereits.';
  const g = beamGrund(game); if (g) return g;
  if (frei(game) <= 0) return capacity(game) <= 0 ? 'Kein Frachtraum eingebaut.' : `Frachtraum voll (${anBord(game)}/${capacity(game)}) – erst abliefern.`;
  const draus = draussen(game);
  if (!draus.length) return 'Keine Fracht in diesem Gebiet.';
  const pod = id != null ? draus.find((d) => d.id === String(id)) : naechste(game);
  if (!pod) return id != null ? 'Diese Fracht gibt es nicht mehr.' : `Keine Fracht in Reichweite (max. ${cfg(game).beamRange}).`;
  const far = dist(game.ship.x, game.ship.y, pod.x, pod.y);
  if (far > cfg(game).beamRange) return `Fracht zu weit (${Math.round(far)}, max. ${cfg(game).beamRange}).`;
  const pf = platzFuerLadung(game, pod); if (!pf.ok) return pf.text;   // LAD-01 A2: Typ-Regel (ein Modul, eine Art)
  s.halt = { kind: 'an', id: pod.id, t: 0, dur: haltDauer(game) };
  game.emit('frachtBeamen', { phase: 'start', was: 'an', id: pod.id, dur: s.halt.dur });
  return null;
}
// Abliefern: Ort prüfen. Rückgabe { ok, reason?, name? }
function ablieferOrt(game) {
  if (!state(game).lager.some((l) => l.art !== 'person' && !fremderAuftrag(l))) return { ok: false, reason: state(game).lager.some(fremderAuftrag) ? 'Auftragsware gibt es nur beim Auftraggeber ab.' : 'Keine Fracht an Bord.' };   // LAD-01 B: fremde Auftragsware nie an irgendeiner Station (Kampagnen-Ware ja, siehe KAMPAGNE)   // SL0: Personen sind keine Ware (abgeben: personen-bord.js)
  return stationOrt(game);
}
// SL0: Abnehmer/Station in Reichweite, ohne Rücksicht darauf, was an Bord ist (auch für Personen)
function stationOrt(game) {
  const s = state(game); const sh = game.ship;
  const loc = Locations.get(sh.scene);
  const st = loc && loc.scene && loc.scene.station;
  if (s.abnehmer && s.abnehmer.ort && s.abnehmer.ort !== sh.scene) return { ok: false, reason: `Abnehmer ist ${s.abnehmer.name || s.abnehmer.ort} – nicht hier.` };
  if (!st || !(s.abnehmer && s.abnehmer.ort ? true : cfg(game).stationKinds.includes(st.kind))) return { ok: false, reason: 'Hier ist keine Station, die Fracht annimmt.' };
  const far = dist(sh.x, sh.y, st.x, st.y);
  if (far > cfg(game).stationRange) return { ok: false, reason: `Zu weit von der Station (${Math.round(far)}, max. ${cfg(game).stationRange}).` };
  return { ok: true, name: (s.abnehmer && s.abnehmer.name) || (loc && loc.name) || sh.scene };
}
function abliefernStart(game, p) {
  const s = state(game);
  if (s.halt) return 'Transfer läuft bereits.';
  const g = beamGrund(game); if (g) return g;
  const o = ablieferOrt(game); if (!o.ok) return o.reason;
  s.halt = { kind: 'ab', id: null, t: 0, dur: haltDauer(game), name: o.name };
  game.emit('frachtBeamen', { phase: 'start', was: 'ab', dur: s.halt.dur });
  return null;
}
function beamStop(game, grund, text) {
  const s = state(game);
  if (!s.halt) return false;
  const h = s.halt; s.halt = null;
  game.emit('frachtBeamen', { phase: 'abbruch', was: h.kind, grund });
  if (!text && h.kind === 'posten') text = require('./posten.js').stummerAbbruchText(h, grund);   // SUND-02b A1-Fix: Sprung (Szenenwechsel) und Ops verlassen melden sich auch
  if (text) game.oda(text, null);
  if (h.kind === 'posten' && h.id === 'verrat') require('./verrat.js').abbruchFunk(game, text, grund);   // SUND-02b E-Fix: Abbruch auch in den Lagefunk
  return true;
}
// Systemtreffer: Aufruf aus interior.damageSystem (Schildtreffer erreichen diese Funktion nie)
function systemTreffer(game, sys) {
  const s = game.fracht;
  if (s && s.halt) beamStop(game, 'systemtreffer', 'Transfer unterbrochen – Systemtreffer! Fracht-Beamen muss neu starten.');
}
function beamFertig(game) {
  const s = state(game); const h = s.halt; s.halt = null;
  if (h.kind === 'an') {
    const i = s.draussen.findIndex((d) => d.id === h.id);
    if (i < 0) return;
    const pod = s.draussen[i];
    const r = lagerAufnehmen(game, { art: pod.art, quelle: 'beamen', eigenschaften: pod.eig });   // LAD-01 B: Eigenschaften reisen mit der Ladung
    if (!r.ok) { game.emit('frachtBeamen', { phase: 'abbruch', was: 'an', grund: 'voll' }); game.oda(`${r.text}${r.grund === 'voll' ? ' – erst abliefern.' : ''}`, null); return; }
    s.draussen.splice(i, 1);
    game.emit('frachtBeamen', { phase: 'fertig', was: 'an', art: anzeigeArt(pod) });
    game.oda(`${anzeigeName(r.eintrag)} an Bord (${s.lager.length}/${capacity(game)}).`, null);
    game.missionEvent('frachtAnBord', { art: pod.art, n: s.lager.length, id: pod.id });
  } else if (h.kind === 'person_an' || h.kind === 'person_ab') {   // SL0: Person beamen (server/sim/personen-bord.js)
    require('./personen-bord.js').haltFertig(game, h);
  } else if (h.kind === 'verk') {   // SL6: Verkaufen an einen Händler (server/sim/ladung.js)
    require('./ladung.js').verkaufFertig(game);
  } else if (h.kind === 'posten') {   // SUND-02b A1: Posten gründen / zum Stützpunkt ausbauen (server/sim/posten.js)
    require('./posten.js').haltFertig(game, h);
  } else {
    const o = ablieferOrt(game);
    if (!o.ok) { game.emit('frachtBeamen', { phase: 'abbruch', was: 'ab', grund: 'ort' }); return; }
    const weg = s.lager.filter((l) => l.art !== 'person' && !fremderAuftrag(l));   // SL0: Personen bleiben an Bord (eigener Halteprozess); LAD-01 B: fremde Auftragsware ebenso
    s.lager = s.lager.filter((l) => l.art === 'person' || fremderAuftrag(l));
    for (const l of weg) s.abgeliefert[l.art] = (s.abgeliefert[l.art] || 0) + 1;
    game.emit('frachtBeamen', { phase: 'fertig', was: 'ab', n: weg.length });
    game.oda(`Fracht übergeben: ${weg.map(anzeigeName).join(', ')} – ${o.name}.`, null);
    game.missionEvent('frachtAbgeliefert', { n: weg.length, arten: weg.map((l) => l.art), ort: game.ship.scene, name: o.name });
  }
}

// ---------- LAD-01 B: Durchsuchung (Hook für BEA-01) ----------
// Eine Durchsuchung/ein Scan der Ladung deckt getarnte und illegale Ware auf: die Tarnung fällt (der Snapshot zeigt die echte Art), das illegal-Flag wird sichtbar.
// tiefe: 'voll' (Standard, gründliche Durchsuchung: deckt Tarnung und illegal auf) | 'scan' (Schnellscan: sieht nur ungetarnte illegale Ware, Tarnung hält).
// wer: frei benannter Durchsucher (z. B. 'patrouille', 'zoll', 'debug'); nur im Ereignis. Die eigentliche Durchsuchung durch Gegner/Patrouillen gehört zu BEA-01, hier nur der Hook.
// -> { ok: true, wer, tiefe, geprueft, neu: [{ art, angezeigt, illegal, getarnt }], arten (echte Arten der neu aufgedeckten), illegal (liegt jetzt aufgedeckte illegale Ware an Bord), getarnt (eine Tarnung fiel) } | { ok: false, grund, text }
const TIEFEN = ['voll', 'scan'];
function frachtDurchsuchen(game, o) {
  const q = o || {};
  const tiefe = q.tiefe == null ? 'voll' : String(q.tiefe);
  if (!TIEFEN.includes(tiefe)) return { ok: false, grund: 'tiefe', text: `Unbekannte Tiefe „${tiefe}“ (${TIEFEN.join(' | ')}).` };
  const wer = q.wer != null ? String(q.wer) : 'unbekannt';
  const s = state(game);
  const neu = [];
  for (const l of s.lager) {
    const e = l.eig;
    if (!e || e.aufgedeckt || !(e.illegal || e.getarnt)) continue;
    if (tiefe === 'scan' && e.getarnt) continue;
    e.aufgedeckt = true;
    neu.push({ art: l.art, angezeigt: e.getarnt || l.art, illegal: !!e.illegal, getarnt: !!e.getarnt });
  }
  const befund = {
    ok: true, wer, tiefe, geprueft: s.lager.length, neu, arten: Array.from(new Set(neu.map((x) => x.art))),
    illegal: s.lager.some((l) => l.eig && l.eig.illegal && l.eig.aufgedeckt), getarnt: neu.some((x) => x.getarnt),
  };
  if (neu.length) game.oda(`Durchsuchung (${wer}): ${neu.map((x) => (x.getarnt ? `${artName(x.angezeigt)} war ${artName(x.art)}` : artName(x.art)) + (x.illegal ? ' (illegal)' : '')).join(', ')}.`, null);
  game.missionEvent('frachtDurchsucht', { wer, tiefe, arten: befund.arten, illegal: befund.illegal, getarnt: befund.getarnt, n: neu.length });
  return befund;
}

// ---------- BEA-01 B: Beschlagnahme (Folge einer Durchsuchung) ----------
// Nimmt die durch frachtDurchsuchen AUFGEDECKTEN illegalen Plaetze aus dem Frachtraum: die Ware ist weg (kein Rueckkauf, Entscheid Kai/Leitung), der Platz wird frei. Eine Ladung mit Auftrag (Faden-Ware, Kampagne)
// nimmt sie nie mit: sie gehoert einem Auftraggeber, nicht der Crew. Eine getarnte Ladung, die ein Scan nicht aufgedeckt hat (aufgedeckt fehlt), bleibt, ebenso jede nicht illegale Ladung. Die Entnahme ist splice(i, 1) wie bei
// auftragEntnehmen: kein anderer Weg aus dem Lager. Ereignis frachtBeschlagnahmt wie frachtDurchsucht (auch bei n 0); die ODA-Zeile nennt die echte Art, weil der Fund sie ohnehin aufgedeckt hat.
// wer: frei benannter Durchsucher (nur Meldung/Ereignis). -> { ok: true, wer, n, bleibt (aufgedeckte illegale Plaetze mit Auftrag, die bleiben), plaetze: [{ art, illegal, getarnt }], arten (echte Arten, ohne Doppelte) }
function lagerBeschlagnahmen(game, o) {
  const q = o || {};
  const wer = q.wer != null ? String(q.wer) : 'unbekannt';
  const s = state(game);
  const plaetze = [];
  let bleibt = 0;
  for (let i = s.lager.length - 1; i >= 0; i--) {
    const l = s.lager[i], e = l.eig;
    if (!e || !e.illegal || !e.aufgedeckt) continue;
    if (e.auftrag) { bleibt++; continue; }   // BEA-01 Nacharbeit: ein Fund ist ein Fund (zaehlt fuer Strafe und Meldung), die Auftragsware bleibt aber da
    s.lager.splice(i, 1);
    plaetze.unshift({ art: l.art, illegal: true, getarnt: !!e.getarnt });
  }
  const arten = Array.from(new Set(plaetze.map((x) => x.art)));
  if (plaetze.length) game.oda(`Beschlagnahmt (${wer}): ${plaetze.map((x) => artName(x.art)).join(', ')}.`, null);
  game.missionEvent('frachtBeschlagnahmt', { wer, arten, n: plaetze.length });
  return { ok: true, wer, n: plaetze.length, bleibt, plaetze, arten };
}

// ---------- Tick ----------
function update(game, dt) {
  const s = state(game);
  const sc = game.ship.scene;
  // Systemwechsel: Fracht im Raum ist weg (Szene verlassen). Ladung an Bord bleibt.
  if (s.szene !== sc) {
    s.szene = sc;
    if (s.halt) beamStop(game, 'szene');
    s.draussen = s.draussen.filter((d) => d.eigene);   // PAN-01 A: Ware, die sich im ungesicherten Frachtraum gelöst hat, bleibt für die Rückkehr im Sektor liegen
  }
  if (s.lager.length || s.draussen.length) require('./faden-fracht.js').aufraeumen(game);   // LAD-01 Nacharbeit 2: Ladung/Pods eines erloschenen Faden-Auftrags weg
  const h = s.halt;
  if (!h) return;
  if (transferDown(game)) return void beamStop(game, 'transfer', 'Transfer ausgefallen – Beamen abgebrochen.');
  if (h.kind === 'schoepf') {   // U2: Schöpfen läuft weiter, auch wenn die Ops verlassen wird (solo: Steuer halten); Ende nur per Ops-Aktion, Ring verlassen, voll, Transfer aus
    const r = require('./ladung.js').schoepfWeiter(game, dt);
    if (r) beamStop(game, r.stop, r.text);
    return;
  }
  if (!taktikBesetzt(game)) return void beamStop(game, 'taktik');
  if (h.kind === 'an') {
    const pod = s.draussen.find((d) => d.id === h.id);
    if (!pod) return void beamStop(game, 'weg');
    if (dist(game.ship.x, game.ship.y, pod.x, pod.y) > cfg(game).beamRange) return void beamStop(game, 'reichweite', 'Fracht außer Reichweite – Beamen abgebrochen.');
  } else if (h.kind === 'person_an' || h.kind === 'person_ab') { if (!require('./personen-bord.js').haltWeiter(game, h)) return void beamStop(game, 'ort', 'Person beamen abgebrochen.'); }   // SL0
  else if (h.kind === 'verk') { if (!require('./ladung.js').verkaufWeiter(game)) return void beamStop(game, 'ort'); }
  else if (h.kind === 'posten') { const r = require('./posten.js').haltWeiter(game, h); if (r) return void beamStop(game, r.code, r.text); }   // SUND-02b A1
  else if (!ablieferOrt(game).ok) return void beamStop(game, 'ort');
  h.t += dt;
  if (h.t >= h.dur) beamFertig(game);
}

// ---------- Snapshot / Weltstand ----------
// Kompakt (Budget): fehlt = Standard. lager ['art'], draussen [{ id, x, y, art }] (nur diese Szene), halt { kind, id?, p 0..1 },
// ab 1 = jetzt abgebbar, vk 1 = Händler in Reichweite, vg = Code, warum nicht verkaufbar (ladung.verkaufOrt, nur mit Ware an Bord), abn = Name des Abnehmers (nur wenn gesetzt), g false = ungesichert.
function snapshot(game) {
  const s = game.fracht;
  if (!s) return null;
  const draus = s.draussen.filter((d) => d.szene === game.ship.scene);
  const out = {};
  const ware = s.lager.filter((l) => l.art !== 'person');   // SL0: lager = nur Ware (Buchten), Personen stehen in pers
  if (ware.length) {
    out.lager = ware.map(anzeigeArt);   // LAD-01 B: der Spieler sieht die angezeigte Art (Tarnung), der Server rechnet mit l.art
    const le = ware.map((l) => (l.eig ? (l.eig.illegal && l.eig.aufgedeckt ? 1 : 0) | (l.eig.getarnt && l.eig.aufgedeckt ? 2 : 0) | (l.eig.auftrag ? 4 : 0) : 0));   // le[i]: Bit 1 illegal, 2 war getarnt, 4 Auftrag (nur aufgedeckte Flags)
    if (le.some(Boolean)) out.le = le;
    if (ablieferOrt(game).ok) out.ab = 1;
  }
  // LAD-01 Nacharbeit 2: die Belegung je Modul liefert der SERVER (er rechnet die Typ-Regel mit der echten Art, gezeigt wird die Anzeigeart): mb[i] = [Anzeigeart | 'person', Anzahl] oder 0 (leer), i = Frachtraum-Module aufsteigend nach Raum
  if (s.lager.length) out.mb = modulAnzeige(game).map((m) => (m.art ? [m.art, m.anzahl] : 0));
  Object.assign(out, require('./personen-bord.js').snapshotZusatz(game));   // SL0: pers, pq
  if (draus.length) out.draussen = draus.map((d) => { const o = { id: d.id, x: d.x, y: d.y, art: anzeigeArt(d) }; if (platzFuerLadung(game, d).grund === 'art_belegt') o.nz = 1; return o; });   // nz 1 = kein Modul nimmt diesen Pod (Typ-Regel, vom Server gerechnet: der Client kennt die echte Art nicht)
  if (s.halt) { out.halt = { kind: s.halt.kind, p: s.halt.kind === 'schoepf' ? require('./ladung.js').fuellStand(game) : Math.round(Math.min(1, s.halt.t / s.halt.dur) * 100) / 100 }; if (s.halt.id) out.halt.id = s.halt.id; }
  if (s.abnehmer && s.abnehmer.name) out.abn = s.abnehmer.name;
  if (s.gesichert === false) out.g = false;
  { const fu = require('./ladung.js').fuellStand(game); if (fu) out.fuell = fu; }   // SL6: Füllstand der nächsten Deuterium-Einheit
  { const vk = require('./ladung.js').verkaufOrt(game); if (vk.ok) out.vk = 1; else if (vk.code && ware.length) out.vg = vk.code; }   // SL6: Händler in Reichweite (Verkaufen möglich); LAD-01 E: vg = Verkaufsgrund (1-Byte-Code, Texte im Client)
  return Object.keys(out).length ? out : null;
}
// SUND-04b B2 (Nacharbeit M1): die Beute einer laufenden Faden-Szene Konvoi (state.szenenBeute { art, tag }, nur Laufzeit) gehoert nicht in den Stand: die Szene ist nicht speicherbar, nach dem Laden gaebe es sie nicht mehr abzuliefern.
// LAD-01 B: die Beute ist durch ihren Tag (eig.auftrag) gekennzeichnet, nicht mehr durch Zaehlen: Faden-Ware und fremde Fracht derselben Art bleiben im Stand.
function lagerOhneSzenenBeute(game) {
  const s = state(game), b = s.szenenBeute;
  return b ? s.lager.filter((l) => !(l.eig && l.eig.auftrag === b.tag)) : s.lager.slice();
}
function toSave(game) { const P = require('./personen-bord.js'); const plaetze = personPlaetze(game); let pi = 0; return lagerOhneSzenenBeute(game).map((l) => (l.art === 'person' ? P.toSaveEntry(l, plaetze[pi++]) : l.art)); }   // SL0: Personen als { p, n, b }; b = Bettnummer (Platz der Personen-Module, abgeleitet)
// LAD-01 B: Eigenschaften parallel zu toSave (gleicher Index; null = keine), nur wenn mindestens eine Ladung welche traegt (additiv im Weltstand: schiff.frachtEig, kein Versionssprung)
function toSaveEig(game) {
  const l = lagerOhneSzenenBeute(game).map((x) => (x.eig ? Object.assign({}, x.eig) : null));
  return l.some(Boolean) ? l : null;
}
function restore(game, arten, eigs) {
  const s = state(game);
  const P = require('./personen-bord.js');
  s.lager = [];
  // LAD-01 A2: auch das Laden geht durch lagerAufnehmen: was über Kapazität oder Typ-Regel hinausgeht (alte Stände, ausgebauter Frachtraum), wird gekappt und gemeldet
  let gekappt = 0;
  const liste = Array.isArray(arten) ? arten : [];
  for (let i = 0; i < liste.length; i++) {
    const a = liste[i];
    const ok = typeof a === 'string' ? artOk(game, a) : !!(a && typeof a === 'object' && a.p);
    if (!ok) { gekappt++; continue; }
    const e = Array.isArray(eigs) && eigs[i] && typeof eigs[i] === 'object' ? eigs[i] : null;   // LAD-01 B: Eigenschaften derselben Stelle
    const r = typeof a === 'string' ? lagerAufnehmen(game, { art: a, quelle: 'laden', eigenschaften: e ? Object.assign({}, e, { aufgedeckt: undefined }) : null }) : lagerAufnehmen(game, { art: P.ART, person: a.p, name: a.n, quelle: 'laden' });   // SL0: Personen { p, n, b }
    if (!r.ok) { gekappt++; continue; }
    if (e && e.aufgedeckt && r.eintrag.eig) r.eintrag.eig.aufgedeckt = true;
  }
  if (gekappt && game.log) game.log(`Fracht: ${gekappt} Ladung(en) beim Laden verworfen (unbekannte Art oder Eigenschaft, Kapazität oder Typ-Regel)`);
  s.halt = null;
}

// ---------- Regiebuch ----------
// fracht_abnehmer: ort = Orts-ID des Auftraggebers (null = jede Station), name = Anzeigename
function setAbnehmer(game, ort, name) { state(game).abnehmer = ort ? { ort: String(ort), name: name != null ? String(name) : null } : null; }
// fracht_abliefern aus dem Skript: Ladung (art, n) sofort übernehmen, ohne Ort/Halteprozess. Gibt die Anzahl zurück.
function skriptAbliefern(game, art, n) {
  const s = state(game); let k = 0; const lim = n == null ? Infinity : n;
  for (let i = s.lager.length - 1; i >= 0 && k < lim; i--) {
    if (art && s.lager[i].art !== art) continue;
    if (!art && s.lager[i].art === 'person') continue;   // SL0: Personen nie per Warenabgabe
    if (fremderAuftrag(s.lager[i])) continue;   // LAD-01 B: Ware eines Fadens gibt nur der Faden beim Abnehmer ab (faden-fracht.andocken); Kampagnen-Ware nimmt die Abgabe der Kette an
    const l = s.lager.splice(i, 1)[0]; s.abgeliefert[l.art] = (s.abgeliefert[l.art] || 0) + 1; k++;
  }
  if (k) game.missionEvent('frachtAbgeliefert', { n: k, arten: art ? [art] : [], ort: game.ship.scene, name: null, skript: true });
  return k;
}
// SYS-03 C-Nacharbeit: Softlock-Ausweg der Abgabe. Liefert alles ab, was an Bord ist, und schreibt die fehlende Ladung bis `min` gut
// (die Ladung ist unterwegs verloren gegangen, z. B. Frachtraum zerstört; sonst bliebe die Abgabe unlösbar). Gibt die Anzahl der gutgeschriebenen Ladungen zurück.
function skriptAbliefernBis(game, art, min) {
  const s = state(game);
  skriptAbliefern(game, art, null);
  const fehlt = Math.max(0, min - abgeliefert(game, art));
  if (fehlt) {
    s.abgeliefert[art] = (s.abgeliefert[art] || 0) + fehlt;
    game.missionEvent('frachtAbgeliefert', { n: fehlt, arten: [art], ort: game.ship.scene, name: null, skript: true });
  }
  return fehlt;
}
// Ladung direkt an Bord legen (Debug, Tests, Skript, Schöpfen); false = kein Platz (Typ-Regel, voll) bzw. unbekannte Art. quelle: eine aus QUELLEN (Standard 'skript')
function anBordLegen(game, art, quelle) {
  const a = art == null ? cfg(game).artDefault : String(art);
  const r = lagerAufnehmen(game, { art: a, quelle: quelle || 'skript' });
  if (!r.ok) return false;
  game.missionEvent('frachtAnBord', { art: a, n: state(game).lager.length });
  return true;
}
// fracht_zuteilen (Regiebuch): wie anBordLegen, aber ein Typkonflikt mit fremder Ware wird vom Quartiermeister aufgelöst (kein Softlock in der Kette)
// LAD-01 Nacharbeit 1: eine Zuteilung gehört der Geschichte (Belohnung, Ersatz): ohne eigenen auftrag trägt sie den Kampagnen-Tag (nicht verkaufbar, Kampagnen-Abgabe nimmt sie an).
// eigenschaften (optional): { illegal, getarnt: '<anzeigeArt>', auftrag: '<id>' } wie bei lagerAufnehmen (Regiebuch/Spielleiter).
function zuteilen(game, art, eigenschaften) {
  const a = art == null ? cfg(game).artDefault : String(art);
  const eig = Object.assign({}, kampagnenEig(a), eigenschaften || {});
  if (!eig.auftrag && kampagnenEig(a)) eig.auftrag = KAMPAGNE;
  let pf = platzFuerLadung(game, { art: a, eig });
  if (!pf.ok && pf.grund === 'art_belegt' && fremdesModulRaeumen(game, { art: a, eig })) pf = platzFuerLadung(game, { art: a, eig });
  if (!pf.ok) { game.oda(pf.text, null); return false; }
  const r = lagerAufnehmen(game, { art: a, quelle: 'zuteilung', eigenschaften: eig });
  if (!r.ok) { game.oda(r.text, null); return false; }
  game.missionEvent('frachtAnBord', { art: a, n: state(game).lager.length });
  return true;
}

// ---------- Debug: fracht <abwerfen [art] [dx dy] | an [art] [illegal] [getarnt=art] [auftrag=id] | durchsuchen [wer] [voll|scan] | leer | gesichert an|aus | abnehmer [ort] | status> ----------
function debug(game, args) {
  const s = state(game); const sh = game.ship;
  const sub = args[0] || 'status';
  if (sub === 'abwerfen') {
    const art = args[1] && Number.isNaN(Number(args[1])) ? args[1] : null;
    const nums = args.slice(1).filter((a) => !Number.isNaN(Number(a))).map(Number);
    const dx = nums.length >= 2 ? nums[0] : 160, dy = nums.length >= 2 ? nums[1] : 0;
    if (game.ship.docked) return 'Nicht angedockt (Fracht liegt im freien Raum).';
    return fracht_abwerfen(game, sh.x + dx, sh.y + dy, art) ? null : 'Unbekannte Art (sprengstoff | fracht).';
  }
  if (sub === 'person') return require('./personen-bord.js').personAnBordLegen(game, args[1] || 'evert', args[2] || null) ? null : 'Frachtraum voll.';   // SL0: fracht person [id] [name]
  if (sub === 'an') {   // LAD-01 B: fracht an <art> [illegal] [getarnt=<anzeigeArt>] [auftrag=<id>]
    const eig = {};
    for (const x of args.slice(2)) { const [k, v] = x.split('='); eig[k] = v === undefined ? true : v; }
    if (Object.keys(eig).length) {
      const a = args[1] || cfg(game).artDefault;
      const r = lagerAufnehmen(game, { art: a, quelle: 'debug', eigenschaften: eig });
      if (!r.ok) return r.text;
      game.missionEvent('frachtAnBord', { art: a, n: s.lager.length });
      return null;
    }
    return anBordLegen(game, args[1]) ? null : 'Frachtraum voll oder unbekannte Art.';
  }
  if (sub === 'durchsuchen') { const b = frachtDurchsuchen(game, { wer: args[1] || 'debug', tiefe: args[2] }); if (!b.ok) return b.text; game.log(`Durchsuchung: ${JSON.stringify(b)}`); return null; }   // LAD-01 B: fracht durchsuchen [wer] [voll|scan]
  if (sub === 'leer') { s.lager = []; s.draussen = []; s.halt = null; return null; }   // SL0: leert auch Personen
  if (sub === 'gesichert') { setGesichert(game, args[1] !== 'aus'); return null; }
  if (sub === 'abnehmer') { setAbnehmer(game, args[1] || null, args[2] || null); return null; }
  game.log(`Fracht: Lager ${JSON.stringify(lagerArten(game))}, draußen ${draussen(game).length}, Halt ${s.halt ? JSON.stringify(s.halt) : '-'}, gesichert ${gesichert(game)}, Abnehmer ${s.abnehmer ? s.abnehmer.ort : '-'}`);
  return null;
}

module.exports = {
  neu, state, update, snapshot, toSave, toSaveEig, restore, debug, frachtDurchsuchen, lagerBeschlagnahmen, anzeigeArt, eigenschaftenPruefen,
  fracht_abwerfen, abwerfen: fracht_abwerfen,
  anzeigeName, platzFuerLadung, fremdesModulRaeumen, podAblegen, modulAnzeige, beamStart, abliefernStart, beamStop, systemTreffer, ablieferOrt, stationOrt,
  anBord, ladungAnBord, frei, capacity, platzFuer, freiFuer, kapazitaetFuer, passtOhneRaum, personImRaum, lagerAufnehmen, auftragEntnehmen, podsEntnehmen, erloschenesAufraeumen, auftragAnBord, anBordFuerBeute, erzEinlagern, beuteEinlagern, zuteilen, belegung, personPlaetze, gesichert, setGesichert, gefaehrdet, huellenTreffer, frachtraumTreffer, lagerArten, draussen, abgeliefert,
  setAbnehmer, skriptAbliefern, skriptAbliefernBis, anBordLegen, artOk, artName, KAMPAGNE, kampagnenEig,
};
