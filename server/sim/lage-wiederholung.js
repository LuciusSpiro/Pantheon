'use strict';
// SUND-03 D: Wiederholungsregeln der Pläne des Lage-Spielleiters (Plan-Schicht, nicht der Sim-Kern). Regel: Dieselbe Umsetzung kommt nie zweimal in Folge und nie mit demselben Parametersatz:
// ein Befehl, dessen Typ UND Parametersatz (alle Felder) dem eines Befehls aus den letzten `fenster_plaene` angewandten Plänen gleicht, wird mit dem Grund „Wiederholung“ abgelehnt und steht so im
// Regie-Logbuch (lage_befehl, ausgang abgelehnt). Gleicher Typ mit anderem Parametersatz ist erlaubt. Ausnahmen (Daten, lage-spielleiter-werte.json wiederholung.ausnahmen): Typen, die ihrer Natur nach
// nachgestellt werden (Fokus, Regler: sie laufen aus und werden erneuert). Der Prompt-Teil <letzte_plaene> bleibt wie er ist; die Parametersätze stehen im eigenen Verlauf des Spielleiters
// (nicht im Prompt). Reine Funktionen, kein Spielzustand.
//
//   satzVon(befehl) -> Schlüssel | null          kanonischer Schlüssel „typ + sortierte Felder“ (kein Objekt: null, die Plan-Prüfung lehnt es ohnehin ab)
//   fokusSatz(fokus) -> Schlüssel                 der Plan-Fokus als Satz (Typ fokus; Fraktionen sortiert)
//   pruefen(plan, verlauf, werte) -> { plan, abgelehnt: [{ befehl, grund }] }   Plan ohne die Wiederholungen; ohne Treffer kommt derselbe Plan (dasselbe Objekt) zurück
//   verlaufEintrag(plan, res) -> [Schlüssel]      was von diesem (gefilterten) Plan angenommen wurde (res = Ergebnis von Regie.planAnwenden)
const istObjekt = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

function kanon(v) {
  if (Array.isArray(v)) return v.map(kanon);
  if (istObjekt(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, kanon(v[k])]));
  return v;
}
function satzVon(b) {
  if (!istObjekt(b) || typeof b.typ !== 'string') return null;
  return b.typ + ':' + JSON.stringify(kanon(Object.fromEntries(Object.entries(b).filter(([k]) => k !== 'typ'))));
}
function fokusSatz(f) {
  const x = Object.assign({}, f);
  if (Array.isArray(x.fraktionen)) x.fraktionen = x.fraktionen.slice().sort();
  return satzVon(Object.assign({ typ: 'fokus' }, x));
}

function pruefen(plan, verlauf, werte) {
  const w = (werte && werte.wiederholung) || {};
  const fenster = Math.max(0, Math.floor(w.fenster_plaene) || 0);
  const ausnahmen = Array.isArray(w.ausnahmen) ? w.ausnahmen : [];
  const bekannt = new Set((verlauf || []).slice(fenster ? -fenster : (verlauf || []).length).flat());
  const abgelehnt = [];
  const grund = (typ) => `Wiederholung: ${typ} mit demselben Parametersatz wie in einem der letzten ${fenster} Pläne`;
  if (!istObjekt(plan) || !fenster || !bekannt.size) return { plan, abgelehnt };
  const behalten = [];
  for (const b of Array.isArray(plan.befehle) ? plan.befehle : []) {
    const s = satzVon(b);
    if (s && !ausnahmen.includes(b.typ) && bekannt.has(s)) abgelehnt.push({ befehl: b, grund: grund(b.typ) });
    else behalten.push(b);
  }
  let fokus = plan.fokus;
  if (istObjekt(fokus) && !ausnahmen.includes('fokus') && bekannt.has(fokusSatz(fokus))) { abgelehnt.push({ befehl: Object.assign({ typ: 'fokus' }, fokus), grund: grund('fokus') }); fokus = undefined; }
  if (!abgelehnt.length) return { plan, abgelehnt };
  const neu = Object.assign({}, plan, { befehle: behalten });
  if (fokus === undefined) delete neu.fokus;
  return { plan: neu, abgelehnt };
}

function verlaufEintrag(plan, res) {
  const weg = new Set(((res && res.abgelehnt) || []).map((a) => a.befehl));
  const out = (Array.isArray(plan && plan.befehle) ? plan.befehle : []).filter((b) => !weg.has(b)).map(satzVon).filter(Boolean);
  if (istObjekt(plan && plan.fokus) && ((res && res.angenommen) || []).some((a) => a.befehl && a.befehl.typ === 'fokus')) out.push(fokusSatz(plan.fokus));
  return out;
}

module.exports = { satzVon, fokusSatz, pruefen, verlaufEintrag };
