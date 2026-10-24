'use strict';
// Regie-Bericht (CONTRACT-S2 §2.3): lesbare Markdown-Zusammenfassung des Regie-Logbuchs eines Weltstands.
// Aufruf: node tools/regie-bericht.js <weltId> [--dir <REGIE_DIR>]   (npm run regie -- <weltId>)
//         ohne weltId: Liste der vorhandenen Logbücher
const fs = require('fs');
const path = require('path');
const Regielog = require('../server/mission/regielog.js');

const fmt = (n, d) => (Number.isFinite(n) ? (Math.round(n * (d || 1)) / (d || 1)).toLocaleString('de-DE') : '–');
const cell = (s) => String(s == null ? '–' : s).replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 160);

function report(dir, weltId) {
  const { entries, bad } = Regielog.read(dir, weltId);
  const L = [`# Regie-Bericht ${weltId}`, ''];
  if (!entries.length) { L.push(`Keine Einträge in ${path.join(dir, Regielog.safeId(weltId) + '.jsonl')}.`); return L.join('\n') + '\n'; }
  // QA-Abnahme S2: nur echte LLM-Aufrufe zählen – 'angebot' und 'abschluss' wiederholen die Summe der Mission
  const CALLS = new Set(['grobplan', 'szene', 'verspaetet', 'lage_grobplan']);   // SUND-03 A2: auch die Anfragen des Lage-Spielleiters
  const callTokens = (list) => list.filter((e) => CALLS.has(e.art)).reduce((a, e) => a + (Number(e.tokens) || 0), 0);
  const tokens = callTokens(entries);
  const by = (art) => entries.filter((e) => e.art === art);
  const angebote = by('angebot'); const rueck = by('rueckfall'); const waits = by('sceneWait');
  L.push(`Zeitraum ${entries[0].t} – ${entries[entries.length - 1].t}, ${entries.length} Einträge${bad ? `, ${bad} unlesbare Zeilen` : ''}.`, '');
  L.push('## Überblick', '',
    `- Tokens gesamt: **${fmt(tokens)}**`,
    `- Grobpläne: ${by('grobplan').length} (ungültig: ${by('grobplan').filter((e) => (e.fehler || []).length).length}), Szenen: ${by('szene').length}`,
    `- Angebote: ${angebote.length} (Quelle: ${['llm', 'archiv', 'mock', 'rohfassung'].map((q) => `${q} ${angebote.filter((e) => e.quelle === q).length}`).join(', ')})`,
    `- Angenommen: ${by('annahme').filter((e) => !(e.fehler || []).length).length}, abgelehnt: ${by('ablehnung').length}, abgeschlossen: ${by('abschluss').length}`,
    `- Rückfälle: ${rueck.length}`,
    `- Wartezeit am Anflug (sceneWait): ${waits.length ? `${waits.length}×, längste ${fmt(Math.max(...waits.map((e) => e.dauer_s || 0)), 10)} s` : 'keine'}`, '');
  // SUND-03 A2: Lage-Spielleiter (Freie Fahrt Sund): Aufrufe je Sitzung (Abend), Dauer Median/p90, Fehler, Rückfälle
  const lage = by('lage_grobplan');
  if (lage.length) {
    const zahl = (a, p) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };
    const aufrufe = lage.filter((e) => ['angewandt', 'plan_wirkungslos', 'fehler', 'veraltet'].includes(e.ausgang) && !(e.fehler || []).includes('BUDGET'));
    const sitzungen = {};
    for (const e of aufrufe) { const s = (e.plan && e.plan.sitzung) || '–'; sitzungen[s] = (sitzungen[s] || 0) + 1; }
    const dauern = aufrufe.map((e) => e.dauer_s);
    const uebersprungen = {};
    for (const e of lage.filter((x) => x.ausgang === 'uebersprungen')) { const g = e.grund || (e.plan && e.plan.grund) || '?'; uebersprungen[g] = (uebersprungen[g] || 0) + 1; }
    const lageRueck = by('lage_befehl').filter((e) => e.ausgang === 'rueckfall');
    L.push('## Lage-Spielleiter', '',
      `- Aufrufe: **${aufrufe.length}** in ${Object.keys(sitzungen).length} Sitzung(en); Aufrufe je Sitzung: ${Object.entries(sitzungen).map(([s, c]) => `${s}: ${c}`).join(', ') || '–'} (Ziel 4–6 je Abend)`,
      `- Angewandt: ${lage.filter((e) => e.ausgang === 'angewandt').length}, wirkungslos (alle Befehle abgelehnt): ${lage.filter((e) => e.ausgang === 'plan_wirkungslos').length}, veraltet verworfen: ${lage.filter((e) => e.ausgang === 'veraltet').length}, späte Antworten: ${lage.filter((e) => e.ausgang === 'verspaetet').length}`,
      `- Dauer je Aufruf: Median ${fmt(zahl(dauern, 0.5), 10)} s, p90 ${fmt(zahl(dauern, 0.9), 10)} s`,
      `- Tokens: ${fmt(callTokens(lage))}, je Aufruf im Mittel ${aufrufe.length ? fmt(callTokens(lage) / aufrufe.length) : '–'}`,
      `- Fehler: ${lage.filter((e) => e.ausgang === 'fehler').length}, Rückfälle: ${lageRueck.length} (ein Rückfall räumt Fokus und Regler früherer Pläne mit ab: die Sim läuft danach wie ohne Spielleiter)`,
      `- Übersprungene Grenzen: ${Object.keys(uebersprungen).length ? Object.entries(uebersprungen).map(([g, c]) => `${g} ${c}`).join(', ') : 'keine'}`, '');
  }
  // je Mission
  const missions = [...new Set(entries.map((e) => e.mission).filter(Boolean))];
  if (missions.length) {
    L.push('## Missionen', '', '| Mission | Titel | Auftraggeber | Quelle | Tokens | Szenen (Quelle) | Ausgang |', '|---|---|---|---|---|---|---|');
    for (const m of missions) {
      const es = entries.filter((e) => e.mission === m);
      const an = es.find((e) => e.art === 'angebot') || {};
      const ab = es.find((e) => e.art === 'abschluss') || {};
      // ersetzt, aber danach doch Rohfassung (z. B. „updateBook abgelehnt: BETRETEN“) zählt nicht
      const sz = es.filter((e) => e.art === 'szene' && /ersetzt/.test(e.begruendung || '')
        && !es.some((r) => r.art === 'rueckfall' && r.szene === e.szene && r.t >= e.t)).map((e) => e.szene);
      const tk = callTokens(es);
      L.push(`| ${cell(m)} | ${cell(an.titel)} | ${cell(an.auftraggeber)} | ${cell(an.quelle)} | ${fmt(Number(ab.tokens) || tk)} | ${cell(sz.join(', ') || (an.quelle === 'archiv' ? 'Archiv (fest)' : 'Rohfassung'))} | ${cell(ab.ausgang)} |`);
    }
    L.push('');
  }
  if (rueck.length) {
    L.push('## Rückfälle', '');
    for (const e of rueck) L.push(`- ${e.t} · ${e.mission || e.plan || '–'}${e.szene ? ' / ' + e.szene : ''}: ${e.begruendung || ''}`);
    L.push('');
  }
  const errs = entries.filter((e) => (e.fehler || []).length);
  if (errs.length) {
    L.push('## Prüferfehler (häufigste)', '');
    const count = {};
    for (const e of errs) for (const f of e.fehler) { const k = String(f).replace(/'[^']*'/g, '…').slice(0, 100); count[k] = (count[k] || 0) + 1; }
    for (const [k, n] of Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 15)) L.push(`- ${n}× ${k}`);
    L.push('');
  }
  const wishes = Regielog.readWishes(dir);
  if (Object.keys(wishes).length) {
    L.push('## Wunschliste (fehlende Bausteine)', '');
    for (const [k, w] of Object.entries(wishes).sort((a, b) => b[1].n - a[1].n)) L.push(`- ${w.n}× ${k}${w.missionen && w.missionen.length ? ` (${w.missionen.join(', ')})` : ''}`);
    L.push('');
  }
  L.push('## Verlauf', '', '| Zeit | Spielzeit | Art | Mission | Szene | Quelle | Dauer s | Tokens | Begründung |', '|---|---|---|---|---|---|---|---|---|');
  for (const e of entries.slice(-80)) L.push(`| ${cell(String(e.t).slice(11, 19))} | ${fmt(e.spielzeit)} | ${cell(e.art)} | ${cell(e.mission)} | ${cell(e.szene)} | ${cell(e.quelle)} | ${fmt(e.dauer_s, 10)} | ${fmt(e.tokens)} | ${cell(e.begruendung)}${(e.fehler || []).length ? ' – ' + cell(e.fehler[0]) : ''} |`);
  return L.join('\n') + '\n';
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const di = args.indexOf('--dir');
  const dir = di >= 0 ? path.resolve(args[di + 1]) : Regielog.dir(process.env);
  const id = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--dir');
  if (!id) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => /\.jsonl$/.test(f) && !/\.1\.jsonl$/.test(f)); } catch (e) { /* leer */ }
    console.log(files.length ? `Logbücher in ${dir}:\n${files.map((f) => '  ' + f.replace(/\.jsonl$/, '')).join('\n')}\n\nAufruf: node tools/regie-bericht.js <weltId>` : `Keine Logbücher in ${dir}.`);
    process.exit(0);
  }
  process.stdout.write(report(dir, id));
}

module.exports = { report };
