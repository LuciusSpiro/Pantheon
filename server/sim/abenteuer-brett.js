'use strict';
// SUND-04b C: Auftragsbrett der Freien Fahrt Sund, Server-Seite (nur mit FAEDEN=1, game.weltsim.faeden). Action-Layer wie faden-bitte.js: die Crew sieht offene Abenteuer-Angebote (Komposition A2 oder der Rueckfall
// unten), nimmt eines an oder lehnt es ab, das Abenteuer laeuft als Faden (faden.js, Beats mit Bausteinen), das Ende wirkt (Chronik, Logbuch) und es ist wieder ein Angebot da. Ohne Oberflaeche (Paket D rendert und sendet Befehle).
// Die Crew entscheidet, nicht der Spieler: jeder Spieler darf antworten, die ERSTE Antwort gilt (spaetere: schon_beantwortet). Folgen und Optionen kommen NIE aus dem Modell: die Vorschau eines Angebots wird aus den DATEN der
// expandierten Vorlage abgeleitet (Beat-Typ, Zustand, Folgen, Optionen; Klartext aus content/faeden/abenteuer-brett.json). Titel und Anlass sind der einzige freie Text des Spielleiters: unveraendert angezeigt, nur ein
// Spielername wird ersetzt (Crew-neutral), nie in Prompt, Logbuch oder Chronik.
//
//   snapshot(game) / schluessel(game)   Anzeigeblock world.abenteuer (Felder: README SUND-04b C) | null (Loeschsignal)
//   annehmen(game, id) / ablehnen(game, id) -> null | { code, text }   Befehle abenteuer.annehmen / abenteuer.ablehnen { id: 'a<Nummer>' } (game.js); Codes: weigerung(code)
//   vorschau(vorlage) -> [Schritt]      die Vorschau aus den Daten der Vorlage (Test, Snapshot)
//   beiEnde(game, faden, ausgang)       (Aufrufer: faden.beatAusgang) Ende eines Abenteuers: Chronik-Zeile aus Daten, Logbuch ohne Titel, Anschluss-Garantie
//   beiTaetigkeit(game) / beiUpdate(game) / anschluss(game) -> Angebot | null   Anschluss-Garantie: kein Angebot und kein laufendes Abenteuer -> ein deterministischer Rueckfall aus anschluss.json (ohne Modell)
//   hinweisAnbieten(game, angebot)      SUND-04b F: Funkzeile "Neuer Auftrag am Brett" (Text aus den Daten, Titel gekuerzt ohne Spielernamen), einmal je Angebot-Id, hoechstens eine je Taetigkeitszaehler F.t; nie beim Laden (lesen) und ohne Spielleiter nicht
//   FRE-02 B1: neuAnbieten nimmt zusaetzlich herkunft (Hafen-Hex) und absicht (absicht/1); das Angebot traegt herkunft { hex } und absicht (nur Weltstand, nie Snapshot); Snapshot: hafen (Name), ort_offen (Beat mit verlegt_ort: ort/ortname leer)
//   toSave(F) / lesen(block, F)         Weltstand welt.sim.faeden.abenteuer { zuletzt?, angebote?: [{ hex, alter, plan, volk?, bezug?, locker?, herkunft?: { hex }, absicht? }], vorrat?: [Eintrag] } (additiv, muellfest; die Plaene laufen erneut durch den Pruefer)
//   SPL-02 F: im Modus Absichten (ABENTEUER_ABSICHTEN) waehlt anschluss() zuerst eine Absicht nach Lage (abenteuer-rueckfall.js, derselbe Inszenierer, kein Modell) und faellt auf anschluss.json zurueck, wenn nichts gueltig ist; passtZuLage(game, plan, hex) -> bool
//   sind die Sperren des Rueckfalls (zuletzt gespielt, abgelehnt, Wiederholung) fuer einen Plan des Inszenierers; der Vorrat (abenteuer-vorrat.js) haengt am selben Weltstand-Block.
//   FRE-02 C: der Vorrat ist verdrahtet (nur Absichten, Opt-in ABENTEUER_ABSICHTEN): beiTaetigkeit legt Angebote mit Absicht ein, die vom Brett verschwanden und nicht beantwortet wurden (Verfall; Merker brett(F).gesehen, Laufzeit),
//   ablehnen legt das abgelehnte Angebot ein (die Sperre abgelehnt haelt es vom sofortigen Wiederanbieten ab: abenteuer-vorrat.js ausVorratOhneSperre), ausVorratEinsAnbieten/ausVorratFuellen nehmen aus dem Vorrat (beiAndocken VOR der Grenze,
//   AbenteuerSpielleiter.beiGrenze vor dem Komponisten). Das Angebot traegt additiv erstellt (Tick des ersten Erzeugens, nur Weltstand): das Alter bleibt beim Einlegen erhalten.
//   SPL-02 A: neuAnbieten(game, plan, { hex, bezug?: { nsc: Vollname }, locker?: bool }) -> wie faden.abenteuerNeuAnbieten; das Angebot traegt `bezug` (der Wiedersehen-NSC, den das Annehmen nimmt, nicht den juengsten frischen) und `locker` (die Fortsetzung darf die Hauptfigur
//   des letzten Abenteuers aufnehmen: Wiederholungsregel nsc_zuletzt). Ist der NSC beim Annehmen kein Kandidat mehr, ist das Angebot veraltet (Grund BEZUG_VERALTET im Logbuch). Absichten (absicht-pruefer.js) setzen locker aus dem Katalogfeld fortsetzung (istFortsetzung).
// SUND-04b E1/E3: der Kanon (abenteuer-kanon.js) haelt fest, was ein Abenteuer erfindet; die Wiederholungsregeln (abenteuer-wiederholung.js) gelten fuer jeden Plan des Spielleiters (faden.js abenteuerNeuAnbieten) und fuer den Rueckfall (passt: stufenweise gelockert, Ort, Folge, NSC).
// Ohne Schalter FAEDEN=1 oder ohne aktiven Lage-Spielleiter tut der Rueckfall nichts (die Angebote bleiben bis zum Verfall, begonnene Abenteuer stehen).
const D = require('./faden-daten.js');
const P = require('./faden-pruefer.js');
const Sektoren = require('../../shared/sektoren.js');

const BR = D.BRETT, BW = BR.werte, W = D.WERTE, B = D.BEATS;
const Faden = () => require('./faden.js');
const regie = () => require('./regie-befehle.js');
const Bauplan = () => require('./faden-bauplan.js');
const Wdh = () => require('./abenteuer-wiederholung.js');
const Absicht = () => require('./absicht-pruefer.js');
const Rueckfall = () => require('./abenteuer-rueckfall.js');
const Vorrat = () => require('./abenteuer-vorrat.js');
const Ziel = () => require('./abenteuer-ziel.js');
const Absicht2 = () => require('./abenteuer-absicht.js');
const Chronik = () => require('./chronik.js');
const Ausschnitt = () => require('./lage-ausschnitt.js');
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const istObjekt = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const klon = (v) => JSON.parse(JSON.stringify(v));
const HEX = /^\d{4}$/;
const ID_RE = /^a\d{1,6}$/;
const VORLAGE_ID = /^abenteuer_[0-9a-f]{12}$/;
const fehl = (code) => ({ code, text: has(BR.weigerungen, code) ? BR.weigerungen[code] : code });
const weigerung = fehl;
const logbuch = (game, art, e) => { try { regie().schreibe(game, Object.assign({ art }, e)); } catch (err) { if (game && game.countError) game.countError('abenteuer-brett-logbuch', err); } };
const fehlerZaehlen = (game, wo, e) => { if (game && game.countError) game.countError(wo, e); };
const fmt = (t, werte) => String(t).replace(/\{(\w+)\}/g, (m, k) => (has(werte, k) ? String(werte[k]) : m));
const zahl = (d) => (d > 0 ? '+' : '') + String(Math.round(d * 100) / 100);
const hexName = (hex) => { try { return Sektoren.hexName(hex) || String(hex); } catch (e) { return String(hex); } };

// ---------- Laufzeit-Zustand (nicht im Weltstand, ausser zuletzt): zuletzt beantwortete Nummern, zuletzt abgelehnte Plaene, Takt der Pruefung
function brett(F) {
  if (!F.brett) F.brett = { antworten: [], abgelehnt: [], pruefung: -1e9 };
  return F.brett;
}
const gemerkt = (liste, x, max) => { liste.push(x); while (liste.length > max) liste.shift(); };
const crewHex = (game) => {
  try {
    const hex = game.ship && game.ship.scene ? require('./marken.js').hexVon(game.ship.scene) : null;
    return hex && HEX.test(hex) && Sektoren.spielbar(hex) ? hex : null;
  } catch (e) { return null; }
};
const ohneNamen = (game, t) => Ausschnitt().ohneNamenImTitel(t, Ausschnitt().spielerNamen(game || {}));
function anschlussAus(game) {   // Test- und Betriebsknopf: ABENTEUER_ANSCHLUSS=0|off|aus schaltet den Rueckfall ab (Standard: an, wirkt nur mit FAEDEN=1 und Spielleiter)
  const env = (game && game.env) || process.env;
  return ['0', 'off', 'aus', 'false'].includes(String((env && env.ABENTEUER_ANSCHLUSS) || '').toLowerCase());
}

// ---------- Vorschau aus den Daten der Vorlage (nie aus dem Modell)
// Marke { f, art, d }: f = Fraktion (Ruf: die des Rufs, Haltung: die des Auftraggebers), art ruf | haltung, d = Delta
function marken(folge, von) {
  const out = [];
  for (const x of Array.isArray(folge) ? folge : []) {
    const r = P.folgeWirkung(x, 'n1');
    if (!r.wirkung) continue;
    const w = r.wirkung;
    out.push(w.typ === 'ruf_aenderung' ? { f: w.fraktion, art: 'ruf', d: w.delta } : { f: von, art: 'haltung', d: w.delta });
  }
  return out;
}
function schrittText(b) {
  const e = has(BR.schritte, b.typ) ? BR.schritte[b.typ] : null;
  if (!e) return b.typ;
  const p = istObjekt(b.parameter) ? b.parameter : {};
  for (const k of Object.keys(p)) {
    const key = b.typ + ':' + k + ':' + p[k];
    if (istObjekt(e.varianten) && has(e.varianten, key)) return e.varianten[key];
  }
  return e.text;
}
const kuerzen = (t, max) => { t = String(t); return t.length <= max ? t : t.slice(0, Math.max(0, max - 1)).trimEnd() + '…'; };
// Summe der Marken je (art, f); bei summe = false der staerkste Einzelwert (groesster Betrag, Vorzeichen bleibt): Scheitern ist ein einzelner Schritt, nie die Summe aller
function sammeln(listen, summe) {
  const m = new Map();
  for (const l of listen) for (const x of l) {
    const k = x.art + ':' + x.f, alt = m.get(k);
    if (!alt) m.set(k, Object.assign({}, x)); else m.set(k, Object.assign({}, alt, { d: summe ? Math.round((alt.d + x.d) * 100) / 100 : Math.abs(x.d) > Math.abs(alt.d) ? x.d : alt.d }));
  }
  return Array.from(m.values()).filter((x) => x.d !== 0);
}
// vorschau(v, von) -> { gefahr: bool, schritte: [{ text, gefahr, wahl? }], gelingt: [Satz | Marke], scheitert: [Satz | Marke] }
function vorschau(v, von) {
  if (!istObjekt(v) || !Array.isArray(v.beats)) return { gefahr: false, schritte: [], gelingt: [], scheitert: [] };
  const saetze = { gelungen: [], gescheitert: [] }, mk = { gelungen: [], gescheitert: [] };
  const schritte = v.beats.map((b, i) => {
    const cat = has(B, b.typ) ? B[b.typ] : null;
    const s = { text: schrittText(b), gefahr: !!(cat && cat.gefahr) };
    for (const ag of W.ausgaenge) {
      const o = istObjekt(b.aus) && istObjekt(b.aus[ag]) ? b.aus[ag] : {};
      const tab = ag === 'gelungen' ? BR.status_gelingen : BR.status_scheitern;
      const add = (t) => { if (t && !saetze[ag].includes(t)) saetze[ag].push(t); };
      if (typeof o.status === 'string' && has(tab, o.status)) add(tab[o.status]);
      if (o.weiter !== undefined && v.beats.findIndex((x) => x.id === o.weiter) !== i + 1) add(BW.weg_text);
      mk[ag].push(marken(o.folge, von));
    }
    if (Array.isArray(b.optionen) && b.optionen.length) s.wahl = b.optionen.map((o) => ({ text: String(o.text).slice(0, 44), folgen: marken(o.folge, von) }));
    return s;
  });
  return { gefahr: schritte.some((s) => s.gefahr), schritte, gelingt: saetze.gelungen.concat(sammeln(mk.gelungen, true)), scheitert: saetze.gescheitert.concat(sammeln(mk.gescheitert, false)) };
}

// ---------- Anzeige
// Beat-Typen der Vorlage ohne den Abschluss (jeder Typ einmal, in der Reihenfolge der Beats, hoechstens typen_max): die Typ-Zeile der Karte
function typenVon(v) {
  const out = [];
  for (const b of v && Array.isArray(v.beats) ? v.beats : []) {
    const cat = has(B, b.typ) ? B[b.typ] : null;
    if (cat && cat.abschluss) continue;
    if (!out.includes(b.typ)) out.push(b.typ);
  }
  return out.slice(0, BW.typen_max);
}
// FRE-02 B1: hat ein Beat der Vorlage (oder seine Variante) das Datenflag verlegt_ort (beats.json), steht das Ziel nicht fest (Beat-Typen nie im Code)
const ortOffen = (v) => !!v && Array.isArray(v.beats) && v.beats.some((b) => [b.typ].concat(istObjekt(b.variante) ? [b.variante.typ] : []).some((t) => has(B, t) && B[t].verlegt_ort === true));
const laufendVon = (F) => F.liste.find((f) => f.plan && f.phase !== 'abgeschlossen') || null;
const restAngebot = (a) => Math.max(0, W.abenteuer.angebot_gilt_taetigkeiten - a.alter);
function restLaufend(f) {
  if (f.phase === 'laeuft' && f.laufend) return Math.max(0, Faden().fristVon(f) - f.laufend.n);
  return Math.max(0, f.abstand - f.zaehler);
}
function schluessel(game) {
  const F = game && game.weltsim && game.weltsim.faeden;
  if (!F || !Faden().aktiv(game)) return null;
  const l = laufendVon(F);
  if (!F.abenteuerAngebote.length && !l) return null;
  return [Faden().spielleiterAktiv(game) ? 1 : 0, F.abenteuerAngebote.map((a) => a.nr + ':' + restAngebot(a) + ':' + vonAngebot(game, a)).join(','), l ? [l.id, l.beat, l.phase, restLaufend(l)].join(':') : ''].join('|');
}
// Fraktion des Auftraggebers: das Volk des Angebots, sonst das erste erlaubte Volk der Vorlage; ein Wiedersehen: das Volk des juengsten Kandidaten
function vonAngebot(game, a) {
  const v = a.vorlage;
  if (P.nscAlt(v)) { const k = Faden().wiedersehenKandidaten(game, v)[0]; const n = k ? Faden().nscVon(game, k) : null; if (n) return n.fraktion; }
  return v.volk_erlaubt.includes(a.volk) ? a.volk : v.volk_erlaubt[0];
}
// Geruechte: Hinweistexte der Vorlagen ohne {name} (Daten der Vorlage), Sprecher aus werte.json hinweis_sprecher; hoechstens geruechte_max
function geruechte(angebote) {
  const out = [];
  for (const a of angebote) {
    const hs = a.vorlage.hinweise || {};
    const offen = ortOffen(a.vorlage);   // FRE-02 B2: bei ort_offen steht das Ziel nicht fest (der Beat ueberschreibt es beim Start): nur ein Hinweis ohne {ort}, sonst keine Geruechtzeile
    const k = Object.keys(hs).find((x) => typeof hs[x].text === 'string' && !hs[x].text.includes('{name}') && !(offen && hs[x].text.includes('{ort}')));
    if (!k || out.length >= BW.geruechte_max) continue;
    const sp = has(W.hinweis_sprecher, hs[k].kanal) ? W.hinweis_sprecher[hs[k].kanal] : null;
    out.push({ von: sp || BW.geruecht_sprecher, text: kuerzen(hs[k].text.split('{ort}').join(hexName(a.hex)), BW.geruecht_text_max), angebot: 'a' + a.nr });
  }
  return out;
}
function snapshot(game) {
  const F = game && game.weltsim && game.weltsim.faeden;
  if (!F || !Faden().aktiv(game)) return null;
  const l = laufendVon(F);
  if (!F.abenteuerAngebote.length && !l) return null;
  const text = (t, max) => kuerzen(ohneNamen(game, String(t)), max);
  const s = { ok: Faden().spielleiterAktiv(game) ? 1 : 0, kopf: BW.kopf, ablehnen: BW.ablehnen_text, scheitern: BW.scheitern_text, angebote: [] };
  const alle = F.abenteuerAngebote.slice(0, W.abenteuer.angebote_max);
  for (const a of alle) {
    const von = vonAngebot(game, a);
    const offen = ortOffen(a.vorlage);   // FRE-02 B1: ein Beat, der seinen Ort selbst waehlt, ueberschreibt das Ziel beim Start: kein Ziel anzeigen (ort/ortname leer, ort_offen), der Client nennt dann nur den Hafen
    const e = { id: 'a' + a.nr, titel: text(a.vorlage.titel, BW.titel_max), ort: offen ? '' : a.hex, ortname: offen ? '' : hexName(a.hex).slice(0, BW.ort_max), rest: restAngebot(a), von, aus_geruecht: a.vorlage.beats.some((b) => b.typ === 'geruecht'), vorschau: vorschau(a.vorlage, von), typen: typenVon(a.vorlage) };
    if (offen) e.ort_offen = true;
    if (a.herkunft) e.hafen = hexName(a.herkunft.hex).slice(0, BW.ort_max);   // der Auftraggeber ist `von` (Fraktion); NSC-Namen und Spielernamen stehen nie im Block
    if (typeof a.vorlage.anlass === 'string') e.anlass = text(a.vorlage.anlass, BW.anlass_max);
    s.angebote.push(e);
  }
  const g = geruechte(alle);
  if (g.length) s.geruechte = g;
  if (l) {
    const v = D.vorlage(l.vorlage), b = v && v.beats[l.beat], cat = b && has(B, b.typ) ? B[b.typ] : null;
    const e = { id: l.id, titel: text(v ? v.titel : '', BW.titel_max), ort: l.parameter.ort || '', schritt: l.beat + 1, schritte_gesamt: v ? v.beats.length : 0, schritt_text: b ? schrittText(b) : '', gefahr: !!(cat && cat.gefahr), ph: l.phase === 'laeuft' ? 'laeuft' : 'wartet', rest: restLaufend(l) };
    if (v && typeof v.anlass === 'string') e.anlass = text(v.anlass, BW.anlass_max);
    s.laufend = e;
  }
  return s;
}

// ---------- Befehle: annehmen / ablehnen (die ERSTE Antwort der Crew gilt)
function finden(game, id) {
  if (!Faden().aktiv(game)) return { fehler: fehl('modus') };
  const F = Faden().zustandVon(game);
  if (typeof id !== 'string' || !ID_RE.test(id)) return { fehler: fehl('unbekannt') };   // Typ, Laenge und Prototype-Keys (constructor, __proto__): nur a<Ziffern>
  const nr = Number(id.slice(1));
  const a = F.abenteuerAngebote.find((x) => x.nr === nr);
  if (!a) return { fehler: fehl(brett(F).antworten.includes(nr) ? 'schon_beantwortet' : 'kein_angebot') };
  return { F, a, nr };
}
function entfernen(F, a) { const i = F.abenteuerAngebote.indexOf(a); if (i >= 0) F.abenteuerAngebote.splice(i, 1); }
function veraltet(game, F, a, grund) {   // das Angebot ist nicht mehr spielbar (Ziel weg, Pause, kein NSC): es wird mit klarer Meldung vom Brett genommen, nichts blockiert
  entfernen(F, a);
  gemerkt(brett(F).antworten, a.nr, BW.antworten_gemerkt);
  logbuch(game, 'faden_ereignis', { ausgang: 'abenteuer_veraltet', key: a.ref, begruendung: `Angebot ${a.nr} vom Brett genommen: ${String(grund).slice(0, 120)}`, plan: { angebot: a.nr, vorlage: a.ref } });
  return fehl('veraltet');
}
function annehmen(game, id) {
  const g = finden(game, id);
  if (g.fehler) return g.fehler;
  const { F, a } = g;
  if (!Faden().spielleiterAktiv(game)) return fehl('kein_spielleiter');   // ohne Spielleiter steht ein begonnenes Abenteuer nur: es wird gar nicht erst begonnen, das Angebot bleibt bis zum Verfall
  if (P.abenteuerLaufend(F) >= W.abenteuer.laufend_max) return fehl('laeuft_schon');
  if (P.aktive(F).length >= W.aktiv_max) return fehl('kein_platz');
  const lg = P.pruefeLage(game, a.vorlage);
  if (lg) return veraltet(game, F, a, lg);
  let r;
  if (P.nscAlt(a.vorlage)) {   // Wiedersehen: der juengste Kandidat (wiedersehenKandidaten liefert ihn zuerst; nur NSC, die der Pruefer als nsc_von annimmt); kein Kandidat mehr (verdraengt, Zustand): das Angebot ist veraltet
    const alle = Faden().wiedersehenKandidaten(game, a.vorlage), frisch = Wdh().kandidatenFrisch(game, a.vorlage);   // SUND-04b E3: bevorzugt ein NSC, der nicht die Hauptfigur der letzten Abenteuer war
    let kand;
    if (a.bezug && a.bezug.nsc) {   // SPL-02 A: der gewaehlte NSC (Vollname), nie der juengste: ist er kein Kandidat mehr (verdraengt, tot, Zustand), ist das Angebot veraltet; die Hauptfigur des letzten Abenteuers nur mit locker
      const id = alle.find((x) => { const n = Faden().nscVon(game, x); return n && n.name === a.bezug.nsc; });
      if (!id) return veraltet(game, F, a, `${Absicht().CODES.BEZUG_VERALTET}: der NSC des Bezugs steht nicht mehr zur Verfuegung`);
      kand = frisch.includes(id) || a.locker ? [id] : [];
      if (!kand.length) return veraltet(game, F, a, 'WIEDERHOLUNG_NSC');
    } else kand = frisch.length ? frisch : a.locker ? alle : [];
    if (!kand.length) return veraltet(game, F, a, alle.length ? 'WIEDERHOLUNG_NSC' : 'WIEDERSEHEN_KEIN_NSC');
    r = Faden().abenteuerOeffnen(game, a.nr, { nsc_von: kand[0] });
  } else r = Faden().abenteuerOeffnen(game, a.nr, {});
  if (!r.ok) {
    if (/^(OBERGRENZE|ABENTEUER_LAUFEND)/.test(r.grund)) return fehl(/^OBERGRENZE/.test(r.grund) ? 'kein_platz' : 'laeuft_schon');   // der Zustand hat sich zwischen Pruefung und Oeffnen geaendert: das Angebot bleibt
    return veraltet(game, F, a, r.grund);   // NSC_VON, NAME, NSC_ZAHL, Lage: das Angebot ist so nicht mehr zu spielen
  }
  gemerkt(brett(F).antworten, a.nr, BW.antworten_gemerkt);
  F.abenteuerZuletzt = r.faden.vorlage;
  logbuch(game, 'faden_ereignis', { ausgang: 'abenteuer_angenommen', key: r.faden.id, begruendung: `Abenteuer ${r.faden.vorlage} angenommen (Angebot ${a.nr})`, plan: { faden: r.faden.id, vorlage: r.faden.vorlage, angebot: a.nr } });
  return null;
}
function ablehnen(game, id) {   // kostet nichts: keine Ruf- oder Haltungsfolge, kein Cooldown; das Angebot entfaellt, der Platz wird frei
  const g = finden(game, id);
  if (g.fehler) return g.fehler;
  const { F, a } = g;
  entfernen(F, a);
  const b = brett(F);
  gemerkt(b.antworten, a.nr, BW.antworten_gemerkt);
  gemerkt(b.abgelehnt, a.ref, 3);   // der Rueckfall bietet nicht sofort denselben Plan wieder an
  logbuch(game, 'faden_ereignis', { ausgang: 'abenteuer_abgelehnt', key: a.ref, begruendung: `Angebot ${a.nr} abgelehnt (keine Folge)`, plan: { angebot: a.nr, vorlage: a.ref } });
  if (a.absicht) { try { Vorrat().einlegenAus(game, a, BW.vorrat_art); } catch (e) { fehlerZaehlen(game, 'abenteuer-brett-vorrat', e); } }   // FRE-02 C: nicht gespielt, aber noch gut: in den Vorrat (die Sperre oben haelt es vom sofortigen Wiederanbieten ab)
  return null;
}

// ---------- Ende eines Abenteuers: Chronik (Zeile aus Daten, nie aus dem Freitext des Modells), Logbuch ohne Titel und Anlass, Anschluss
function beiEnde(game, f, ausgang) {
  const F = Faden().zustandVon(game);
  if (!f || !f.plan || !F) return;
  const key = ausgang === 'gelungen' ? 'gelungen' : 'gescheitert';   // nie der Name des NSC und nie Titel oder Anlass: die Chronik geht in den Prompt des Spielleiters (Test: der Name des NSC steht nie im Prompt)
  const ort = f.parameter && f.parameter.ort ? hexName(f.parameter.ort) : 'dem Sektor';
  try { Chronik().eintragen(game, { art: 'reise', ref: f.id, kurz: fmt(BR.chronik[key], { ort }), param: { art: 'abenteuer', ausgang: ausgang === 'gelungen' ? 'gelungen' : 'gescheitert' } }); } catch (e) { fehlerZaehlen(game, 'abenteuer-chronik', e); }
  logbuch(game, 'faden_ereignis', { ausgang: 'abenteuer_ende', key: f.id, begruendung: `Abenteuer ${f.vorlage} ${ausgang}, NSC ${f.nsc.status}`, plan: { faden: f.id, vorlage: f.vorlage, ausgang, status: f.nsc.status } });
  anschluss(game);
}

// ---------- Funk-Hinweis (SUND-04b F): ein neues Angebot kommt auf das Brett -> eine Funkzeile an alle Clients (kein Annehmen per Funk). Aufrufer: faden.js anbietenMit (Komposition und Rueckfall), nie lesen (Laden)
function hinweisAnbieten(game, angebot) {
  const F = game && game.weltsim && game.weltsim.faeden;
  if (!F || !angebot || !Faden().aktiv(game) || !Faden().spielleiterAktiv(game)) return false;
  const b = brett(F);
  if (b.hinweisStumm) return false;   // FRE-02 B2: beiAndocken fuellt das Brett, danach meldet genau ein Sammelfunk (kein Einzelhinweis, auch nicht der des Rueckfalls an der Grenze)
  if (!Array.isArray(b.hinweise)) { b.hinweise = []; b.hinweisT = -1; b.hinweisNr = -1; }
  if (b.hinweise.includes(angebot.nr)) return false;   // einmal je Id
  if (b.hinweisT === F.t && F.abenteuerAngebote.some((x) => x.nr === b.hinweisNr)) return false;   // hoechstens einer je Taetigkeitszaehler (Grenze), solange das gemeldete Angebot noch am Brett steht; ist es beantwortet oder verfallen, darf das naechste melden
  gemerkt(b.hinweise, angebot.nr, BW.antworten_gemerkt);
  b.hinweisT = F.t; b.hinweisNr = angebot.nr;
  const titel = kuerzen(ohneNamen(game, String(angebot.vorlage.titel)), BW.hinweis_titel_max);
  try { game.emit('radio', { from: BW.hinweis_funk_sprecher, text: fmt(BW.hinweis_text, { titel }), lage: 1, fd: 1, r: 1 }); } catch (e) { fehlerZaehlen(game, 'abenteuer-brett-funk', e); return false; }
  return true;
}

// ---------- Anschluss-Garantie: nach dem Ende ist mindestens ein neues Angebot da. Der Komponist (A2) kann ausfallen, im Cooldown sein oder zu spaet antworten: dann bietet ein deterministischer Rueckfall
// einen Standard-Bauplan an (anschluss.json), durch denselben Expander und denselben Pruefer, ohne Modell.
// stufe k: die k aeltesten Ablehnungen sind freigegeben; stufe > Zahl der Ablehnungen: auch zuletzt (siehe anschluss: es bleibt immer ein passender Plan, solange einer passt)
function passt(game, F, bp, stufe, hex) {
  const r = Bauplan().pruefe(bp);
  if (!r.ok) return null;
  const v = r.vorlage, abg = brett(F).abgelehnt;
  if (v.id === F.abenteuerZuletzt && stufe <= abg.length) return null;
  if (abg.indexOf(v.id) >= stufe) return null;
  if (P.pruefeLage(game, v)) return null;   // Sabotage nur bei einem Ziel
  if (P.nscAlt(v) && !Wdh().kandidatenGelockert(game, v, stufe).length) return null;   // Wiedersehen nur mit Kandidat (SUND-04b E3: erst die letzte Stufe nimmt auch die Hauptfigur des letzten Abenteuers)
  if (Wdh().pruefeGelockert(game, v, hex, stufe)) return null;   // SUND-04b E3: Wiederholungsregeln, stufenweise gelockert (Ort, Folge, NSC)
  return v;
}
function anschluss(game) {
  if (!Faden().aktiv(game) || anschlussAus(game) || !Faden().spielleiterAktiv(game)) return null;
  const F = Faden().zustandVon(game);
  if (F.abenteuerAngebote.length || P.abenteuerLaufend(F)) return null;
  const hex = crewHex(game);
  if (!hex) return null;
  return rueckfallWahl(game, F, hex, true);
}
// Ein Angebot des Rueckfalls fuer den Hafen hex (Absichten-Modus zuerst, sonst anschluss.json), ohne die Bedingungen der Garantie (die prueft der Aufrufer). garantie = true: Sperren stufenweise lockern und im
// Notfall der Hafen als Ort (anschluss, leeres Brett); false: nur Stufe 0 und nur Ziele (anschlussFuellen: ehrlich weniger Angebote statt Wiederholung oder Hafen-Ort). Zielwahl, Planwahl und Strom sind dieselben.
function rueckfallWahl(game, F, hex, garantie) {
  if (Rueckfall().aktiv(game)) {   // SPL-02 F: im Modus Absichten waehlt der Rueckfall zuerst eine Absicht nach Lage (derselbe Inszenierer, kein Modell); gelingt nichts, gilt anschluss.json (die Garantie bleibt unbedingt)
    const r = Rueckfall().anbieten(game, { hex, n: F.angNr + 1, letzte: brett(F).rueckfallAbsicht });
    if (r) {
      brett(F).rueckfallAbsicht = r.absicht;
      const lf = require('./abenteuer-absicht.js').logFelder({ absicht: r.absicht }, r.angebot.bezug ? { nsc: r.angebot.bezug.nsc } : {});
      logbuch(game, 'abenteuer_anschluss', { ausgang: 'angeboten', key: r.angebot.ref, modus: 'rueckfall', absicht: lf.absicht, bezug_art: lf.bezug_art, begruendung: `Anschluss-Garantie: Absicht nach Lage, Plan ${r.angebot.ref} als Angebot ${r.angebot.nr} bei ${hex}`, plan: { angebot: r.angebot.nr, vorlage: r.angebot.ref, hex } });
      return r.angebot;
    }
  }
  // FRE-02 A1: der Ort des Standardplans ist ein ZIEL in der Umgebung des Hafens (abenteuer-ziel.js, Strom der Faeden), nicht der Hafen. Gibt es keines (Karte veraendert, Radius 0, alles belegt) oder geht dort kein Plan,
  // gilt wie vorher der Hafen: die Anschluss-Garantie bleibt unbedingt (Logbuch: Feld ziel = false). Die Sperren werden zuerst ueber alle Ziele gelockert, erst danach faellt die Wahl auf den Hafen zurueck.
  const planeAn = (o, st) => D.ANSCHLUSS.plaene.filter((bp) => passt(game, F, bp, st, o));
  const stufeFuer = (orte) => { for (let st = 0; st <= Math.max(brett(F).abgelehnt.length + 1, Wdh().STUFEN_MAX); st++) if (orte.some((o) => planeAn(o, st).length)) return st; return -1; };   // Sperren stufenweise lockern: zuerst die aelteste Ablehnung, zuletzt der zuletzt gespielte Plan
  const ziele = Ziel().zielFolge(game, hex, { belegt: Ziel().belegt(game) });
  let orte = ziele, stufe = garantie ? stufeFuer(orte) : (orte.some((o) => planeAn(o, 0).length) ? 0 : -1);
  if (stufe < 0 && garantie) { orte = [hex]; stufe = stufeFuer(orte); }
  if (stufe < 0) return null;
  const n = F.angNr + 1;
  const z = Faden().strom(game, n, 'anschluss')();
  for (const o of orte) {
    const plaene = planeAn(o, stufe);
    if (!plaene.length) continue;
    const s0 = Math.floor(z * plaene.length) % plaene.length;
    for (let k = 0; k < plaene.length; k++) {
      const res = Faden().abenteuerAnbieten(game, klon(plaene[(s0 + k) % plaene.length]), { hex: o });
      if (res.ok) {
        angebotAusstatten(res.angebot, { herkunft: hex });   // FRE-02 B1: die Herkunft ist der Hafen, das Ziel steht in hex
        res.angebot.locker = stufe >= Wdh().STUFEN_MAX;   // der NSC-Sperre entkommen: das Wiedersehen darf auch die Hauptfigur des letzten Abenteuers nehmen
        logbuch(game, 'abenteuer_anschluss', { ausgang: 'angeboten', key: res.angebot.ref, begruendung: `Anschluss-Garantie: Standardplan ${res.angebot.ref} als Angebot ${res.angebot.nr} bei ${o}`, plan: { angebot: res.angebot.nr, vorlage: res.angebot.ref, hex: o, wahl: (s0 + k) % plaene.length, ziel: o !== hex } });
        return res.angebot;
      }
    }
  }
  return null;
}
// ---------- FRE-02 B2: das Brett beim Andocken fuellen. Aufrufer: game.js missionEvent('docked') hinter if (this.weltsim) (der Spielstart angedockt ist kein docked-Ereignis: dort fuellt weiter der Takt ein leeres Brett).
// Ablauf: (a) der Einzelhinweis ist stumm (Laufzeit im Brett, nicht im Weltstand), (b) die bestehende Grenze game.lageGrenze('andocken') genau einmal und unveraendert (Zaehler, Verfall, Garantie, Komponist, Telemetrie),
// (c) das Brett bis angebote_max fuellen: zuerst aus dem Vorrat (Paket C, VOR der Grenze: ist das Brett danach voll, startet der Komponist nicht, kein Aufruf), dann der Rueckfall, ein Angebot je Schritt mit verschiedenen Zielen, (d) Stumm aufheben und genau ein Sammelfunk, wenn jetzt mindestens
// ein Angebot am Brett steht (nicht bei 0). Je Andocken ein Funk, auch wenn das Brett schon voll war (die Zahl nennt, was dort liegt). Wirft nie in den Aufrufer.
function beiAndocken(game) {
  const F = game && game.weltsim && game.weltsim.faeden;
  if (!F || !Faden().aktiv(game)) { game.lageGrenze('andocken'); return null; }
  const b = brett(F);
  b.hinweisStumm = true;
  let gefuellt = [];
  try { gefuellt = ausVorratFuellen(game); } catch (e) { fehlerZaehlen(game, 'abenteuer-brett-vorrat', e); }   // FRE-02 C: vor der Grenze, eigener Schutz: die Grenze laeuft in jedem Fall genau einmal
  try {
    b.andockenLaeuft = true;   // FRE-02 C: die Grenze dieses Andockens nimmt nicht noch einmal aus dem Vorrat (das tat beiAndocken schon, davor): ein volles Brett haelt den Komponisten ab, ein nicht volles laesst ihn starten
    game.lageGrenze('andocken');
    gefuellt = gefuellt.concat(anschlussFuellen(game));
  } catch (e) { fehlerZaehlen(game, 'abenteuer-brett-andocken', e); } finally { b.hinweisStumm = false; b.andockenLaeuft = false; }
  try { sammelHinweis(game); } catch (e) { fehlerZaehlen(game, 'abenteuer-brett-funk', e); }
  return gefuellt;
}
// FRE-02 C: EIN Angebot aus dem Vorrat auf das Brett (nur Absichten, Opt-in; Vorbedingungen wie anschlussFuellen: Spielleiter, Hafen, kein laufendes Abenteuer, Platz am Brett; nicht der Schalter ABENTEUER_ANSCHLUSS, der
// gehoert dem Rueckfall). Ziel = Ziel-Belegung wie A2 (der Inszenierer waehlt ein freies Ziel), Herkunft = Hafen (anbietenAusAbsicht). Ohne Modus Absichten oder ohne gueltigen, nicht gesperrten Eintrag: null, nichts aendert sich. -> Angebot | null
function ausVorratEinsAnbieten(game) {
  if (!Faden().aktiv(game) || !Absicht2().aktiv(game) || !Faden().spielleiterAktiv(game)) return null;
  const F = Faden().zustandVon(game);
  if (!F || !Array.isArray(F.vorrat) || !F.vorrat.length) return null;
  if (F.abenteuerAngebote.length >= W.abenteuer.angebote_max || P.abenteuerLaufend(F)) return null;
  const hex = crewHex(game);
  if (!hex) return null;
  const r = Vorrat().ausVorratOhneSperre(game, BW.vorrat_art);
  if (!r.ok) return null;
  const lf = Absicht2().logFelder({ absicht: r.angebot.absicht }, r.angebot.bezug ? { nsc: r.angebot.bezug.nsc } : {});
  logbuch(game, 'abenteuer_anschluss', { ausgang: 'angeboten', key: r.angebot.ref, modus: 'vorrat', absicht: lf.absicht, bezug_art: lf.bezug_art, begruendung: `Aus dem Vorrat: Plan ${r.angebot.ref} als Angebot ${r.angebot.nr} bei ${r.angebot.hex}`, plan: { angebot: r.angebot.nr, vorlage: r.angebot.ref, hex: r.angebot.hex } });
  return r.angebot;
}
// FRE-02 C: die Entnahme an einer Grenze des Spielleiters (AbenteuerSpielleiter.beiGrenze): ein Angebot je Grenze; nicht waehrend beiAndocken (dort fuellt ausVorratFuellen VOR der Grenze). -> Angebot | null
function ausVorratAnGrenze(game) {
  const F = game && game.weltsim && game.weltsim.faeden;
  if (!F || (F.brett && F.brett.andockenLaeuft)) return null;
  return ausVorratEinsAnbieten(game);
}
// das Brett bis angebote_max aus dem Vorrat fuellen (ein Angebot je Schritt, verschiedene Ziele); der Aufrufer ist beiAndocken, VOR der Grenze. -> [neue Angebote]
function ausVorratFuellen(game) {
  const out = [];
  while (out.length < W.abenteuer.angebote_max) {
    const a = ausVorratEinsAnbieten(game);
    if (!a) break;
    out.push(a);
  }
  return out;
}
// Rueckfall fuellen: ein Angebot je Schritt, jedes Ziel ein anderes (die belegten Ziele der offenen Angebote sind gesperrt), bis angebote_max; keine Garantie-Lockerung (siehe rueckfallWahl). Gleiche Vorbedingungen wie
// anschluss (Schalter, Spielleiter, Hafen); laeuft ein Abenteuer, fuellt der Rueckfall nicht (wie anschluss). -> [neue Angebote]
function anschlussFuellen(game) {
  const out = [];
  if (!Faden().aktiv(game) || anschlussAus(game) || !Faden().spielleiterAktiv(game)) return out;
  const F = Faden().zustandVon(game);
  if (P.abenteuerLaufend(F)) return out;
  const hex = crewHex(game);
  if (!hex) return out;
  while (F.abenteuerAngebote.length < W.abenteuer.angebote_max) {
    const a = rueckfallWahl(game, F, hex, F.abenteuerAngebote.length === 0);
    if (!a) break;
    out.push(a);
  }
  return out;
}
// Sammelfunk: eine Funkzeile "N Auftraege am Brett" (Text aus den Daten), nicht bei 0. Setzt den Zaehler des Einzelhinweises: eine spaetere Komposition im selben Taetigkeitszaehler bleibt stumm.
function sammelHinweis(game) {
  const F = game && game.weltsim && game.weltsim.faeden;
  if (!F || !Faden().aktiv(game) || !Faden().spielleiterAktiv(game)) return false;
  const n = Math.min(F.abenteuerAngebote.length, W.abenteuer.angebote_max);
  if (n < 1) return false;
  const b = brett(F);
  if (!Array.isArray(b.hinweise)) { b.hinweise = []; b.hinweisT = -1; b.hinweisNr = -1; }
  b.hinweisT = F.t; b.hinweisNr = F.abenteuerAngebote[F.abenteuerAngebote.length - 1].nr;
  const text = n === 1 ? BW.sammel_text_eins : fmt(BW.sammel_text, { n });
  try { game.emit('radio', { from: BW.hinweis_funk_sprecher, text, lage: 1, fd: 1, r: 1 }); } catch (e) { fehlerZaehlen(game, 'abenteuer-brett-funk', e); return false; }
  return true;
}

// SPL-02 F: dieselben Sperren wie der Rueckfall aus anschluss.json auf Stufe 0 (zuletzt gespielter Plan, abgelehnte Plaene, Lage, Wiedersehen-Kandidat, Wiederholungsregeln) fuer einen Plan, den der Inszenierer gebaut hat
function passtZuLage(game, plan, hex) {
  const F = Faden().zustandVon(game);
  return !!F && passt(game, F, plan, 0, hex) !== null;
}
// FRE-02 C: Verfall legt ein. faden.js taetigkeit filtert verfallene Angebote still VOR beiTaetigkeit; das Brett merkt sich darum die Angebote, die es beim letzten Mal sah (Laufzeit brett(F).gesehen, nach dem Laden aus
// lesen), und legt jedes ein, das jetzt fehlt, eine Absicht traegt und nicht beantwortet wurde (angenommen, abgelehnt, veraltet stehen in brett(F).antworten). Beat-Plaene und Standardplaene (ohne Absicht) nie.
function verfallenEinlegen(game, F) {
  const b = brett(F);
  if (!Array.isArray(b.gesehen)) return;
  for (const a of b.gesehen) {
    if (!a.absicht || F.abenteuerAngebote.includes(a) || b.antworten.includes(a.nr)) continue;
    try { Vorrat().einlegenAus(game, a, BW.vorrat_art); } catch (e) { fehlerZaehlen(game, 'abenteuer-brett-vorrat', e); }
  }
}
function beiTaetigkeit(game) {
  const F = game && game.weltsim && game.weltsim.faeden;
  const modus = !!F && Faden().aktiv(game) && Absicht2().aktiv(game);   // ohne Modus Absichten: genau wie vorher (anschluss), kein Merker
  if (modus) verfallenEinlegen(game, F);
  const r = anschluss(game);
  if (modus) brett(F).gesehen = F.abenteuerAngebote.slice();
  return r;
}
function beiUpdate(game) {   // Takt (zwischen den Ticks): auch ohne Taetigkeit gibt es beim Spielstart und nach dem Laden ein Angebot
  const F = game && game.weltsim && game.weltsim.faeden;
  if (!F || !Faden().aktiv(game) || !Number.isFinite(game.time)) return null;
  const b = brett(F);
  if (game.time - b.pruefung < BW.pruefung_s && game.time >= b.pruefung) return null;
  b.pruefung = game.time;
  return anschluss(game);
}

// ---------- SPL-02 A: Angebot mit Bezug und Lockerung. faden.abenteuerNeuAnbieten kennt weder bezug noch locker (die Fadenmaschine bleibt unveraendert): dieser Weg prueft die Wiederholungsregeln selbst (ohne die NSC-Sperre, die hier
// dem Bezug und der Lockerung gehoert), bietet ueber abenteuerAnbieten an und setzt die Felder am Angebot. Ohne bezug und locker ist es genau abenteuerNeuAnbieten.
function bezugVon(b) {
  if (!istObjekt(b)) return null;
  const k = Object.keys(b);
  return k.length === 1 && k[0] === 'nsc' && typeof b.nsc === 'string' && b.nsc.trim().length >= 3 && b.nsc.length <= 40 ? { nsc: b.nsc } : null;
}
function neuAnbieten(game, plan, o) {   // FRE-02 B1: ein Weg fuer alle Felder des Angebots (bezug, locker, herkunft, absicht): angebotAusstatten setzt sie nach jedem erfolgreichen Anbieten
  o = istObjekt(o) ? o : {};
  const bz = bezugVon(o.bezug), locker = o.locker === true;
  if (o.bezug !== undefined && !bz) return { ok: false, grund: 'PARAMETER: bezug ist { nsc: Vollname }', fehler: ['PARAMETER: bezug ist { nsc: Vollname }'] };
  const res = !bz && !locker ? Faden().abenteuerNeuAnbieten(game, plan, { hex: o.hex }) : anbietenMitBezug(game, plan, o, bz, locker);
  if (res.ok) angebotAusstatten(res.angebot, { bezug: bz, locker, herkunft: o.herkunft, absicht: o.absicht, erstellt: o.erstellt });
  return res;
}
function anbietenMitBezug(game, plan, o, bz, locker) {
  if (!Faden().aktiv(game)) return { ok: false, grund: 'INAKTIV: Faeden sind nicht eingeschaltet', fehler: ['INAKTIV: Faeden sind nicht eingeschaltet'] };
  const r = Bauplan().pruefe(plan);
  if (!r.ok) return Faden().abenteuerAnbieten(game, plan, { hex: o.hex });   // dieselbe Ablehnung samt Logbuch wie sonst
  const v = r.vorlage, wd = Wdh().pruefe(game, v, o.hex);
  const abgelehnt = (grund) => { logbuch(game, 'faden_pruefung', { ausgang: 'abgelehnt', key: 'abenteuer_anbieten', plan: { titel_zeichen: typeof plan.titel === 'string' ? plan.titel.length : null }, fehler: [grund] }); return { ok: false, grund, fehler: [grund] }; };
  if (wd && !/^WIEDERHOLUNG_NSC/.test(wd)) return abgelehnt(wd);   // Ort und Folge gelten weiter
  if (bz && P.nscAlt(v)) {
    const alle = Faden().wiedersehenKandidaten(game, v);
    const id = alle.find((x) => { const n = Faden().nscVon(game, x); return n && n.name === bz.nsc; });
    if (!id) return abgelehnt(`${Absicht().CODES.BEZUG_UNBEKANNT}: der NSC des Bezugs ist kein Kandidat fuer ein Wiedersehen`);
    if (!locker && !Wdh().kandidatenFrisch(game, v).includes(id)) return abgelehnt('WIEDERHOLUNG_NSC: der NSC des Bezugs war die Hauptfigur eines der letzten Abenteuer');
  }
  return Faden().abenteuerAnbieten(game, plan, { hex: o.hex });
}
// FRE-02 B1: Herkunft (der Hafen, an dem die Crew das Angebot bekam; nur der Hex, der Name entsteht im Snapshot) und die Absicht (absicht/1, nur im Weltstand, nie im Snapshot: Voraussetzung fuer den Vorrat, Paket C)
// bleiben am Angebot (FRE-02 C: dazu erstellt, der Tick des ersten Erzeugens, nur mit Absicht). Beides ist freiwillig: ein Angebot ohne bekannte Herkunft oder ohne Absicht (Altstand, Beat-Plan ohne Absicht) bleibt gueltig.
const herkunftVon = (h) => { const hex = istObjekt(h) ? h.hex : h; return typeof hex === 'string' && HEX.test(hex) && Sektoren.spielbar(hex) ? { hex } : null; };
function absichtVon(a) {   // die Absicht in der Form des Pruefers (absicht/1, Obergrenze absicht_max_zeichen aus den Daten, keine Prototyp-Schluessel); sonst null
  if (!istObjekt(a)) return null;
  try { return Absicht().absichtFormFehler(a).length ? null : klon(a); } catch (e) { return null; }
}
function angebotAusstatten(angebot, f) {
  if (f.bezug) angebot.bezug = f.bezug;
  if (f.locker) angebot.locker = true;
  const h = herkunftVon(f.herkunft), ab = absichtVon(f.absicht);
  if (h) angebot.herkunft = h;
  if (ab) angebot.absicht = ab;
  if (ab && Number.isInteger(f.erstellt) && f.erstellt >= 0) angebot.erstellt = f.erstellt;   // FRE-02 C: das erste Alter, das der Vorrat beim Einlegen behaelt
  return angebot;
}

// ---------- Weltstand welt.sim.faeden.abenteuer: der zuletzt gespielte Plan (Rueckfall wiederholt ihn nicht) und die offenen Angebote (Plan, Ort, Alter); die Plaene laufen beim Laden erneut durch den Pruefer
function toSave(F) {
  if (!F) return null;
  const b = {};
  if (typeof F.abenteuerZuletzt === 'string' && VORLAGE_ID.test(F.abenteuerZuletzt)) b.zuletzt = F.abenteuerZuletzt;
  if (F.abenteuerAngebote && F.abenteuerAngebote.length) b.angebote = F.abenteuerAngebote.slice(0, W.abenteuer.angebote_max).map((a) => Object.assign({ hex: a.hex, alter: a.alter, plan: klon(a.vorlage) }, a.volk ? { volk: a.volk } : {}, bezugVon(a.bezug) ? { bezug: { nsc: a.bezug.nsc } } : {}, a.locker === true ? { locker: true } : {}, herkunftVon(a.herkunft) ? { herkunft: herkunftVon(a.herkunft) } : {}, absichtVon(a.absicht) ? { absicht: absichtVon(a.absicht) } : {}, absichtVon(a.absicht) && Number.isInteger(a.erstellt) && a.erstellt >= 0 ? { erstellt: a.erstellt } : {}));
  const vo = Vorrat().toSave(F);   // SPL-02 F: der Vorrat (abenteuer-vorrat.js) steht im selben Block, additiv
  if (vo) b.vorrat = vo;
  return Object.keys(b).length ? b : null;
}
function lesen(b, F) {   // muellfest: Unbrauchbares faellt weg (Meldung in F.ladeFehler), Prototyp-Schluessel und ungueltige Plaene weist registriereAbenteuer ab
  if (!istObjekt(b)) return null;
  if (typeof b.zuletzt === 'string' && VORLAGE_ID.test(b.zuletzt)) F.abenteuerZuletzt = b.zuletzt;
  if (b.angebote !== undefined && !Array.isArray(b.angebote)) F.ladeFehler.push('abenteuer.angebote: verworfen');
  for (const x of Array.isArray(b.angebote) ? b.angebote.slice(0, W.abenteuer.angebote_max) : []) {
    if (!istObjekt(x) || typeof x.hex !== 'string' || !HEX.test(x.hex) || !Sektoren.spielbar(x.hex) || !istObjekt(x.plan)) { F.ladeFehler.push('abenteuer.angebote: Angebot verworfen'); continue; }
    const reg = D.registriereAbenteuer(x.plan, F);
    if (!reg.ok) { F.ladeFehler.push('abenteuer.angebote: Plan ungültig (' + String(reg.fehler[0]).slice(0, 80) + ')'); continue; }
    const v = klon(D.vorlage(reg.id));
    if (F.abenteuerAngebote.some((a) => a.ref === v.id && a.hex === x.hex)) continue;
    const alter = Number.isInteger(x.alter) && x.alter >= 0 ? Math.min(x.alter, W.abenteuer.angebot_gilt_taetigkeiten) : 0;
    const ang = { nr: ++F.angNr, art: 'abenteuer', ref: v.id, hex: x.hex, volk: typeof x.volk === 'string' && v.volk_erlaubt.includes(x.volk) ? x.volk : '', vorlage: v, alter };
    if (bezugVon(x.bezug)) ang.bezug = { nsc: x.bezug.nsc };   // SPL-02 A: additiv, Altstand ohne
    if (x.locker === true) ang.locker = true;
    if (x.herkunft !== undefined) { const h = herkunftVon(x.herkunft); if (h) ang.herkunft = h; else F.ladeFehler.push('abenteuer.angebote: herkunft verworfen'); }   // FRE-02 B1: additiv, Altstand ohne; Muell faellt weg, das Angebot bleibt
    if (x.absicht !== undefined) { const ab = absichtVon(x.absicht); if (ab) ang.absicht = ab; else F.ladeFehler.push('abenteuer.angebote: absicht verworfen'); }
    if (ang.absicht && Number.isInteger(x.erstellt) && x.erstellt >= 0) ang.erstellt = x.erstellt;   // FRE-02 C: additiv, Altstand ohne
    F.abenteuerAngebote.push(ang);
  }
  if (F.abenteuerAngebote.some((a) => a.absicht)) brett(F).gesehen = F.abenteuerAngebote.slice();   // FRE-02 C: die geladenen Angebote gelten als gesehen: verfallen sie beim ersten Zaehlen, kommen sie in den Vorrat
  if (b.vorrat !== undefined) Vorrat().lesen(b.vorrat, F);   // SPL-02 F: muellfest, ungueltige Eintraege fallen weg (Altstand ohne Block: leer)
  return F;
}

// SPL-02 D: die NSC, die eine Fortsetzung tragen (Katalog der Absichten, absicht-pruefer.js): die Verbindung fuer abenteuer-geschichte.js, das den Pruefer nicht selbst laedt
const fortsetzungsNamen = (game, katalog) => Absicht().fortsetzungsNamen(game, katalog);

module.exports = { snapshot, schluessel, annehmen, ablehnen, vorschau, marken, kuerzen, beiEnde, hinweisAnbieten, beiTaetigkeit, beiUpdate, anschluss, beiAndocken, anschlussFuellen, ausVorratFuellen, ausVorratEinsAnbieten, ausVorratAnGrenze, sammelHinweis, passtZuLage, neuAnbieten, toSave, lesen, weigerung, schrittText, fortsetzungsNamen };
