'use strict';
// SUND-03 A2: Mock-Regisseur für kind 'lage' (llm.js: Modi mock und script ohne eigenen Eintrag). Deterministisch, ohne Claude: liest den Ausschnitt und die Grenze aus dem Prompt
// (die Tags <ausschnitt> und <grenze>, wie lage-prompt.js sie baut) und liefert einen gültigen Plan mit wechselnden Befehlen (Plan Nr. n: fokus, regler, nachschub, embargo, söldner …).
// Damit laufen Bot-Läufe und Tests des Lage-Spielleiters ohne Netz. Was der Mock vorschlägt, prüft trotzdem Regie.planAnwenden (Einzelne Ablehnungen sind erlaubt, der Plan bleibt gültig).
//   planVon(input) -> Plan-Objekt         planText(input) -> JSON-Text
const tag = (prompt, name) => {
  const m = String(prompt || '').match(new RegExp('<' + name + '>\\n([\\s\\S]*?)\\n</' + name + '>'));
  return m ? m[1] : null;
};
const lesen = (t, d) => { try { return t ? JSON.parse(t) : d; } catch (e) { return d; } };

const VARIANTEN = ['fokus', 'regler', 'nachschub', 'embargo', 'soeldner'];

// SUND-04a-1 B: einfaches Faden-Verhalten für Tests: öffnet aus jedem Angebot einen Faden (erste passende Vorlage) und bringt jeden fälligen Faden weiter. Nur wenn der Ausschnitt einen Faden-Block hat
// (also nur mit Schalter FAEDEN=1); die Prüfung macht das Modul der Fäden, hier steht keine Regel.
function fadenBefehle(a, plan) {
  const fb = a && a.faeden;
  if (!fb || typeof fb !== 'object') return;
  for (const x of Array.isArray(fb.aktiv) ? fb.aktiv : []) if (x && x.ph === 'wartet' && x.faellig === 1) plan.befehle.push({ typ: 'faden_weiter', faden: x.id, beat: x.beat });
  for (const g of Array.isArray(fb.angebote) ? fb.angebote : []) if (g && Array.isArray(g.v) && g.v.length) plan.befehle.push({ typ: 'faden_oeffnen', vorlage: g.v[0], parameter: { angebot: g.nr } });
}

function planVon(input) {
  const prompt = input && input.prompt;
  const a = lesen(tag(prompt, 'ausschnitt'), {});
  const g = lesen(tag(prompt, 'grenze'), {});
  const nr = Number.isInteger(g.nr) && g.nr > 0 ? g.nr : 1;
  const v = VARIANTEN[(nr - 1) % VARIANTEN.length];
  const orte = Array.isArray(a.orte) ? a.orte : [];
  const hex = (a.crew && a.crew.hex) || (orte[0] && orte[0].h) || null;
  const fl = a.flotten || {};
  const alle = [].concat(fl.aktiv || [], Array.isArray(fl.ruhig) ? fl.ruhig : []);
  const sieger = a.lage && a.lage.sieger;
  const fokus = (fraktionen, radius) => (hex ? { hex, radius, fraktionen } : undefined);
  const plan = { befehle: [], begruendung: `Mock-Regisseur, Plan ${nr} (${v}) an der Grenze ${g.art || '?'}.` };
  const sw = sieger === 'rom' ? 'ger' : 'rom';   // die schwächere Seite
  switch (v) {
    case 'regler':
      plan.befehle.push({ typ: 'regler', fraktion: sw, aggr: 0.5, dauer: 8 });
      break;
    case 'nachschub':
      plan.befehle.push({ typ: 'nachschub', an: sw, gut: 'T', menge: 2 });
      break;
    case 'embargo':
      if (sieger === 'rom' || sieger === 'ger') plan.befehle.push({ typ: 'embargo', von: 'kon', gegen: sieger, waren: ['M'], dauer: 6 });
      else plan.fokus = fokus(['ger'], 1);
      break;
    case 'soeldner': {
      const kon = alle.filter((f) => f.f === 'kon' && !f.miete).map((f) => f.id).slice(0, 1);
      if (kon.length) plan.befehle.push({ typ: 'soeldner', von: 'kon', an: sw, flotten: kon, dauer: 6 });
      else plan.befehle.push({ typ: 'regler', fraktion: 'kon', p_act: 0.3, dauer: 6 });
      break;
    }
    default:
      plan.fokus = fokus(['ger', 'rom'], 2);
  }
  if (!plan.fokus) delete plan.fokus;
  fadenBefehle(a, plan);
  return plan;
}
const planText = (input) => JSON.stringify(planVon(input), null, 1);

module.exports = { planVon, planText, VARIANTEN };
