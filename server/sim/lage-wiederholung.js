'use strict';
// SUND-03 D: Wiederholungsregeln der Pläne des Lage-Spielleiters (Plan-Schicht, nicht der Sim-Kern). Regel: Dieselbe Umsetzung kommt nie zweimal in Folge und nie mit demselben Parametersatz.
// „Dieselbe Umsetzung“ = derselbe Befehlstyp mit demselben IDENTITÄTSSCHLÜSSEL: die Felder, die sagen WAS getan wird (Ziel, Ort, Flotte, Fraktion, Waren, Gut), nicht die Stärke des Befehls (Dauer, Menge,
// Radius, Regler-Werte): eine andere Dauer oder Menge ist keine neue Umsetzung. Mengen von Dingen (Flotten, Waren) zählen als sortierte Menge. Zwei Stufen:
//   (1) nie zweimal in Folge: derselbe Typ mit demselben Schlüssel wie im unmittelbar letzten Plan ist immer abgelehnt (unabhängig vom Fenster);
//   (2) nie mit demselben Parametersatz: derselbe Schlüssel wie in einem der letzten `fenster_plaene` Pläne ist abgelehnt.
// Abgelehnt wird mit dem Grund „Wiederholung“ (Regie-Logbuch, lage_befehl/abgelehnt). Ausnahmen (Daten, lage-spielleiter-werte.json wiederholung.ausnahmen): Typen, die ihrer Natur nach nachgestellt werden
// (Fokus, Regler: sie laufen aus und werden erneuert). Der Verlauf (Schlüssel je angewandtem Plan) steht im Weltstand (welt.sim.regie.verlauf), damit Laden die Regel nicht aushebelt; der Prompt-Teil
// <letzte_plaene> bleibt wie er ist. Reine Funktionen, kein Spielzustand.
//
//   satzVon(befehl) -> Schlüssel | null          „typ:{Identitätsfelder}“ (kein Objekt: null, die Plan-Prüfung lehnt es ohnehin ab)
//   fokusSatz(fokus) -> Schlüssel                 der Plan-Fokus als Satz (Typ fokus)
//   pruefen(plan, verlauf, werte) -> { plan, abgelehnt: [{ befehl, grund }] }   Plan ohne die Wiederholungen; ohne Treffer kommt derselbe Plan (dasselbe Objekt) zurück
//   verlaufEintrag(plan, res) -> [Schlüssel]      was von diesem (gefilterten) Plan angenommen wurde (res = Ergebnis von Regie.planAnwenden)
const istObjekt = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const KEY_MAX = 160;

// Identitätsfelder je Befehlstyp (Felder aus Kern.BEFEHLE.FELDER, ohne Dauer, Menge, Radius, Regler-Werte). Unbekannter Typ: alle Felder außer den bekannten Stärkefeldern.
const IDENTITAET = {
  angreifen: ['fraktion', 'ziel', 'flotten', 'flotte', 'von'],
  beanspruchen: ['fraktion', 'sektor'],
  verstaerken: ['fraktion', 'flotte', 'hafen'],
  rueckzug: ['fraktion', 'flotte'],
  nachschub: ['an', 'gut', 'hafen'],
  embargo: ['von', 'gegen', 'waren'],
  soeldner: ['von', 'an', 'flotten'],
  piratenueberfall: ['ort'],
  fokus: ['fraktion', 'hex'],
  regler: ['fraktion'],
};
const STAERKE = ['typ', 'dauer', 'menge', 'betrag', 'radius', 'p_act', 'aggr', 'max_active'];

function kanon(v) {
  if (Array.isArray(v)) return v.map(kanon).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0));   // Mengen: Reihenfolge egal
  if (istObjekt(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, kanon(v[k])]));
  return v;
}
function satzVon(b) {
  if (!istObjekt(b) || typeof b.typ !== 'string') return null;
  const felder = IDENTITAET[b.typ] || Object.keys(b).filter((k) => !STAERKE.includes(k));
  const id = {};
  for (const k of felder) if (b[k] !== undefined) id[k] = b[k];
  return (b.typ + ':' + JSON.stringify(kanon(id))).slice(0, KEY_MAX);
}
function fokusSatz(f) {
  const x = istObjekt(f) ? f : {};   // der Plan-Fokus: Ort und Fraktionen (Radius und Dauer sind Stärke)
  return ('fokus:' + JSON.stringify(kanon({ hex: x.hex, fraktionen: Array.isArray(x.fraktionen) ? x.fraktionen : null }))).slice(0, KEY_MAX);
}

function pruefen(plan, verlauf, werte) {
  const w = (werte && werte.wiederholung) || {};
  const fenster = Math.max(0, Math.floor(w.fenster_plaene) || 0);
  const ausnahmen = Array.isArray(w.ausnahmen) ? w.ausnahmen : [];
  const v = Array.isArray(verlauf) ? verlauf : [];
  const letzter = new Set(v.length ? v[v.length - 1] : []);   // Stufe 1: der unmittelbar letzte Plan gilt immer
  const bekannt = new Set(v.slice(fenster ? -fenster : v.length).flat());   // Stufe 2: das Fenster
  const abgelehnt = [];
  const grund = (typ, folge) => `Wiederholung: ${typ} mit demselben Ziel wie ${folge ? 'im letzten Plan (nie zweimal in Folge)' : `in einem der letzten ${fenster} Pläne`}`;
  if (!istObjekt(plan) || (!letzter.size && !bekannt.size)) return { plan, abgelehnt };
  const trifft = (s) => (letzter.has(s) ? 1 : bekannt.has(s) ? 2 : 0);
  const behalten = [];
  for (const b of Array.isArray(plan.befehle) ? plan.befehle : []) {
    const s = satzVon(b); const t = s && !ausnahmen.includes(b.typ) ? trifft(s) : 0;
    if (t) abgelehnt.push({ befehl: b, grund: grund(b.typ, t === 1) });
    else behalten.push(b);
  }
  let fokus = plan.fokus;
  if (istObjekt(fokus) && !ausnahmen.includes('fokus') && trifft(fokusSatz(fokus))) { abgelehnt.push({ befehl: Object.assign({ typ: 'fokus' }, fokus), grund: grund('fokus', trifft(fokusSatz(fokus)) === 1) }); fokus = undefined; }
  if (!abgelehnt.length) return { plan, abgelehnt };
  const neu = Object.assign({}, plan, { befehle: behalten });
  if (fokus === undefined) delete neu.fokus;
  return { plan: neu, abgelehnt };
}

function verlaufEintrag(plan, res) {
  const weg = new Set(((res && res.abgelehnt) || []).map((a) => a.befehl));
  const out = (Array.isArray(plan && plan.befehle) ? plan.befehle : []).filter((b) => !weg.has(b)).map(satzVon).filter(Boolean);
  if (istObjekt(plan && plan.fokus) && ((res && res.angenommen) || []).some((a) => a.befehl && a.befehl.typ === 'fokus')) out.push(fokusSatz(plan.fokus));
  return out.slice(0, 16);
}

module.exports = { satzVon, fokusSatz, pruefen, verlaufEintrag, IDENTITAET };
