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
//   toSave(F) / lesen(block, F)         Weltstand welt.sim.faeden.abenteuer { zuletzt?, angebote?: [{ hex, alter, plan, volk? }] } (additiv, muellfest; die Plaene laufen erneut durch den Pruefer)
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
const ohneNamen = (game, t) => Ausschnitt().ohneNamen(t, Ausschnitt().spielerNamen(game || {}));
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
    const k = Object.keys(hs).find((x) => typeof hs[x].text === 'string' && !hs[x].text.includes('{name}'));
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
    const e = { id: 'a' + a.nr, titel: text(a.vorlage.titel, BW.titel_max), ort: a.hex, ortname: hexName(a.hex).slice(0, BW.ort_max), rest: restAngebot(a), von, aus_geruecht: a.vorlage.beats.some((b) => b.typ === 'geruecht'), vorschau: vorschau(a.vorlage, von), typen: typenVon(a.vorlage) };
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
    const kand = frisch.length ? frisch : a.locker ? alle : [];
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
  let plaene = [], stufe = 0;
  for (; !plaene.length && stufe <= Math.max(brett(F).abgelehnt.length + 1, Wdh().STUFEN_MAX); stufe++) plaene = D.ANSCHLUSS.plaene.filter((bp) => passt(game, F, bp, stufe, hex));   // Sperren stufenweise lockern: zuerst die aelteste Ablehnung, zuletzt der zuletzt gespielte Plan
  if (!plaene.length) return null;
  const n = F.angNr + 1;
  const start = Math.floor(Faden().strom(game, n, 'anschluss')() * plaene.length) % plaene.length;
  for (let k = 0; k < plaene.length; k++) {
    const res = Faden().abenteuerAnbieten(game, klon(plaene[(start + k) % plaene.length]), { hex });
    if (res.ok) {
      res.angebot.locker = stufe - 1 >= Wdh().STUFEN_MAX;   // der NSC-Sperre entkommen: das Wiedersehen darf auch die Hauptfigur des letzten Abenteuers nehmen
      logbuch(game, 'abenteuer_anschluss', { ausgang: 'angeboten', key: res.angebot.ref, begruendung: `Anschluss-Garantie: Standardplan ${res.angebot.ref} als Angebot ${res.angebot.nr} bei ${hex}`, plan: { angebot: res.angebot.nr, vorlage: res.angebot.ref, hex, wahl: (start + k) % plaene.length } });
      return res.angebot;
    }
  }
  return null;
}
const beiTaetigkeit = (game) => anschluss(game);
function beiUpdate(game) {   // Takt (zwischen den Ticks): auch ohne Taetigkeit gibt es beim Spielstart und nach dem Laden ein Angebot
  const F = game && game.weltsim && game.weltsim.faeden;
  if (!F || !Faden().aktiv(game) || !Number.isFinite(game.time)) return null;
  const b = brett(F);
  if (game.time - b.pruefung < BW.pruefung_s && game.time >= b.pruefung) return null;
  b.pruefung = game.time;
  return anschluss(game);
}

// ---------- Weltstand welt.sim.faeden.abenteuer: der zuletzt gespielte Plan (Rueckfall wiederholt ihn nicht) und die offenen Angebote (Plan, Ort, Alter); die Plaene laufen beim Laden erneut durch den Pruefer
function toSave(F) {
  if (!F) return null;
  const b = {};
  if (typeof F.abenteuerZuletzt === 'string' && VORLAGE_ID.test(F.abenteuerZuletzt)) b.zuletzt = F.abenteuerZuletzt;
  if (F.abenteuerAngebote && F.abenteuerAngebote.length) b.angebote = F.abenteuerAngebote.slice(0, W.abenteuer.angebote_max).map((a) => Object.assign({ hex: a.hex, alter: a.alter, plan: klon(a.vorlage) }, a.volk ? { volk: a.volk } : {}));
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
    F.abenteuerAngebote.push({ nr: ++F.angNr, art: 'abenteuer', ref: v.id, hex: x.hex, volk: typeof x.volk === 'string' && v.volk_erlaubt.includes(x.volk) ? x.volk : '', vorlage: v, alter });
  }
  return F;
}

module.exports = { snapshot, schluessel, annehmen, ablehnen, vorschau, marken, kuerzen, beiEnde, beiTaetigkeit, beiUpdate, anschluss, toSave, lesen, weigerung, schrittText };
