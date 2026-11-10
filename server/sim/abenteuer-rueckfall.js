'use strict';
// SPL-02 F: Rueckfall der Anschluss-Garantie ueber denselben Inszenierer (nur im Modus ABENTEUER_ABSICHTEN an, abenteuer-absicht.js aktiv). Action-Layer: reine Regeln auf Katalog, Weltstand und einem deterministischen
// Strom, kein Modellaufruf, kein Math.random, kein eigener Zustand (das Brett merkt sich, was es zuletzt angeboten hat, und uebergibt es). Dieses Modul kennt KEINEN Absichts- und KEINEN Beat-Namen: was ein Kandidat ist,
// sagt der Katalog (content/faeden/absichten.json: jede Absicht mit Feld `standard` ist mit jeder ihrer Wendungen ein Kandidat), die Gewichte und Grenzen stehen unter `werte` (rueckfall_*).
// Die Anschluss-Garantie bleibt unbedingt: liefert die Wahl nichts, gilt der alte Rueckfall aus anschluss.json (abenteuer-brett.js anschluss, letzte Stufe).
//
//   aktiv(game) -> bool                                      Modus Absichten an (derselbe Schalter wie der Spielleiter)
//   kandidaten(katalog?) -> [{ absicht, wendung, gewicht }]  alle Kandidaten in der Reihenfolge des Katalogs (Gewicht 0 faellt weg)
//   absichtVon(katalog, absicht, wendung, bezugNsc?) -> absicht/1   die Standard-Parametrierung (titel, bogen mit der Wendung, ton) als Absicht; Bezug nur mit bezugNsc (Vollname)
//   reihenfolge(katalog, rng, ohne?) -> [{ absicht, wendung, gewicht }]   gewichtet ohne Zuruecklegen aus dem Strom gezogen; Kandidaten der Absicht `ohne` stehen hinten (sie werden uebersprungen, solange etwas anderes passt)
//   anbieten(game, { hex, n, letzte? }) -> { angebot, absicht, wendung, inszenierung } | null   zieht aus dem Strom (Salz aus den Daten), probiert die Kandidaten der Reihe nach: Inszenierer (Nein der Welt: naechster),
//        Sperren des Bretts (zuletzt gespielter Plan, abgelehnte, Wiederholungsregeln), Anbieten ueber anbietenAusAbsicht. Der Bezug einer Fortsetzungs-Absicht kommt aus den Kandidaten der Fadenmaschine
//        (abenteuer-brett.js fortsetzungsNamen, juengster zuerst; der Strom waehlt den Anfang). null = kein gueltiges Ergebnis: der Aufrufer nimmt anschluss.json.
//        Mit rueckfall_neue_folge_zuerst (Daten) kommen zuerst die Kandidaten, deren Typenfolge im bisherigen Verlauf (Kanon) noch nie vorkam (Vielfalt, Abnahme 7).
//   werteFehler(katalog?) -> [Text]                          die Werte rueckfall_* sind stimmig
const AP = () => require('./absicht-pruefer.js');
const INS = () => require('./inszenierer.js');
const Brett = () => require('./abenteuer-brett.js');
const Faden = () => require('./faden.js');
const Absicht = () => require('./abenteuer-absicht.js');
const Texte = () => require('./abenteuer-texte.js');
const Wdh = () => require('./abenteuer-wiederholung.js');
const Kanon = () => require('./abenteuer-kanon.js');
const Bauplan = () => require('./faden-bauplan.js');

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const istObjekt = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const klon = (x) => JSON.parse(JSON.stringify(x));
const KEINE_WENDUNG = 'keine';   // Symbol des Formats (inszenierer.js): baut nichts ein, steht in jeder Absicht
const SALZ = 'anschluss_absicht';
const wert = (katalog, k) => katalog.werte[k].wert;

const aktiv = (game) => Absicht().aktiv(game);

function kandidaten(katalog) {
  katalog = katalog || AP().katalogStandard();
  const out = [];
  for (const [absicht, e] of Object.entries(katalog.absichten)) {
    if (!istObjekt(e) || !istObjekt(e.standard)) continue;
    for (const wendung of Array.isArray(e.wendungen) && e.wendungen.length ? e.wendungen : [KEINE_WENDUNG]) {
      const gewicht = wendung === KEINE_WENDUNG ? wert(katalog, 'rueckfall_gewicht_ohne_wendung') : wert(katalog, 'rueckfall_gewicht_mit_wendung');
      if (gewicht > 0) out.push({ absicht, wendung, gewicht });
    }
  }
  return out;
}

function absichtVon(katalog, absicht, wendung, bezugNsc) {
  const e = katalog.absichten[absicht], s = e.standard;
  const a = { format: 'absicht/1', absicht, titel: s.titel, parameter: {}, bezug: {}, bogen: Object.assign(klon(s.bogen), { wendung: wendung || KEINE_WENDUNG }), ton: s.ton || e.ton_standard };
  if (typeof bezugNsc === 'string' && bezugNsc.length) a.bezug = { nsc: bezugNsc };
  return a;
}

function reihenfolge(katalog, rng, ohne) {
  const rest = kandidaten(katalog), vorn = [], hinten = [];
  while (rest.length) {
    const summe = rest.reduce((s, k) => s + k.gewicht, 0);
    let r = rng() * summe, i = 0;
    for (; i < rest.length - 1; i++) { r -= rest[i].gewicht; if (r < 0) break; }
    const k = rest.splice(i, 1)[0];
    (ohne !== undefined && k.absicht === ohne ? hinten : vorn).push(k);
  }
  return vorn.concat(hinten);
}

// Namen, die diese Absicht als Bezug nsc tragen kann (Kandidaten der Fadenmaschine nach dem Typ des Katalogeintrags, juengster zuerst); [] ohne Bezug nsc im Eintrag
function bezugNamen(game, katalog, absicht) {
  const e = katalog.absichten[absicht];
  if (!(Array.isArray(e.bezug) && e.bezug.some((b) => b.name === 'nsc' && b.kandidat))) return [];
  return Array.from(Brett().fortsetzungsNamen(game, { absichten: { [absicht]: e } }));
}
const bezugPflicht = (katalog, absicht) => katalog.absichten[absicht].bezug.some((b) => b.name === 'nsc' && b.pflicht === true);

// Die gezogene Reihenfolge, Kandidat fuer Kandidat durch den Inszenierer. Mit rueckfall_neue_folge_zuerst (Daten) kommen zuerst die Kandidaten, deren Typenfolge im bisherigen Verlauf (Kanon) noch nicht vorkam: so wiederholt
// sich der Rueckfall erst, wenn alle Folgen einmal dran waren (Vielfalt); die Folgen, die schon vorkamen, stehen in der gezogenen Reihenfolge dahinter. Die Wiederholungsregeln des Bretts gelten in beiden Faellen.
function versuchen(game, katalog, k, rng) {
  const namen = bezugNamen(game, katalog, k.absicht), start = namen.length ? Math.floor(rng() * namen.length) : 0;
  const versuche = namen.map((_, i) => namen[(start + i) % namen.length]);
  if (!bezugPflicht(katalog, k.absicht)) versuche.push(null);   // ohne Bezug waehlt das Brett den juengsten frischen Kandidaten (wie vorher)
  for (const nsc of versuche) {
    const a = absichtVon(katalog, k.absicht, k.wendung, nsc);
    const r = INS().inszeniere(game, a, katalog);
    if (!r.ok || !Brett().passtZuLage(game, r.plan, r.hex)) continue;
    const v = Bauplan().pruefe(r.plan);
    return { k, a, folge: v.ok ? Kanon().typenVon(v.vorlage).join('>') : '' };
  }
  return null;
}
function anbieten(game, o) {
  const katalog = AP().katalogStandard();
  const rng = Faden().strom(game, o.n, SALZ);
  const liste = reihenfolge(katalog, rng, o.letzte).slice(0, wert(katalog, 'rueckfall_versuche_max'));
  const bekannt = new Set(Wdh().verlauf(game).map((e) => e.folge.join('>')));
  const neuZuerst = wert(katalog, 'rueckfall_neue_folge_zuerst') === true;
  const spaeter = [];
  const nehmen = (c) => {
    const an = INS().anbietenAusAbsicht(game, c.a, katalog);
    if (!an.ok) return null;
    try { Texte().anmelden(game, c.a, an.inszenierung, an.angebot, katalog); } catch (e) { if (game && game.countError) game.countError('abenteuer-texte', e); }
    return { angebot: an.angebot, absicht: c.k.absicht, wendung: c.k.wendung, inszenierung: an.inszenierung };
  };
  for (const k of liste) {
    const c = versuchen(game, katalog, k, rng);
    if (!c) continue;
    if (neuZuerst && bekannt.has(c.folge)) { spaeter.push(c); continue; }
    const r = nehmen(c);
    if (r) return r;
  }
  for (const c of spaeter) { const r = nehmen(c); if (r) return r; }
  return null;
}

function werteFehler(katalog) {
  katalog = katalog || AP().katalogStandard();
  const out = [], f = (t) => out.push(`RUECKFALL_WERTE: ${t}`);
  if (!(has(katalog.werte, 'rueckfall_neue_folge_zuerst') && istObjekt(katalog.werte.rueckfall_neue_folge_zuerst) && typeof katalog.werte.rueckfall_neue_folge_zuerst.wert === 'boolean')) f('rueckfall_neue_folge_zuerst: Wahrheitswert');
  for (const k of ['rueckfall_gewicht_ohne_wendung', 'rueckfall_gewicht_mit_wendung', 'rueckfall_versuche_max']) {
    if (!(has(katalog.werte, k) && istObjekt(katalog.werte[k]) && Number.isInteger(katalog.werte[k].wert) && katalog.werte[k].wert >= (k === 'rueckfall_versuche_max' ? 1 : 0))) f(`${k}: ganze Zahl (Gewichte >= 0, Versuche >= 1)`);
  }
  if (out.length) return out;
  if (!kandidaten(katalog).length) f('kein Kandidat: keine Absicht mit standard, oder beide Gewichte 0');
  return out;
}

module.exports = { aktiv, kandidaten, absichtVon, reihenfolge, anbieten, werteFehler };
