'use strict';
// MIT-01 Paket B: Renderer und Ablage des Mission-Mitschnitts (Vertrag: CONTRACT-MIT01.md, Format `mitschnitt/1`).
// Aus einem `verlauf`-Objekt entstehen lesbare Dokumente: je Gruppe `<nr>_<kennung>/mission.md` + `verlauf.json`, je Lauf
// `index.md` + `verlauf.json`.
//
//   renderMission(verlauf, gruppe, opts?)  -> Text   REIN, deterministisch (opts: { bewertung, notizen, jetzt })
//   renderIndex(verlauf, opts?)            -> Text   REIN (opts: { bewertungen: {gruppenId: wert}, ordner: {gruppenId: name}, notizen, jetzt })
//   schreibeLauf(verlauf, dir, { jetzt })  -> { dir, dateien[] }   einzige Stelle mit I/O; idempotent; `bewertung` und
//                                             `## Notizen` bestehender Dokumente bleiben erhalten (Datei per Kennung gefunden)
//
// Der Renderer kennt keine Beat-Typen: unbekannte `art` und unbekannte Felder erscheinen als Zeile `art` + Felder. Er erfindet
// und filtert keine Namen (Namensschutz liegt beim Recorder). Das Frontmatter trägt nie `status` (Verwechslung mit der
// Freigabe in content/spielleiter/erzeugt/).

const fs = require('fs');
const path = require('path');
const MD = require('../mission/md-ablage.js');

const FORMAT = 'mitschnitt/1';
const BEWERTUNG_OFFEN = 'offen';
const NOTES_STANDARD = '_Platz für Anmerkungen zum Review – dieser Abschnitt bleibt beim Neuschreiben erhalten._';
const KURZ_MAX = 240;
// Rauschen der Zeitleiste (Befund N2/1): Arten, die im Referenzlauf 57 % der Einträge stellten (taetigkeit 24 %, regie 33 %) und für die Bewertung einer Mission nichts beitragen. Aufeinanderfolgende
// Rauscheinträge werden zu EINER Zeile zusammengefasst. Nicht dabei, nach Sichtung: wirkung (Ruf/Marken, 3 %: Folgen der Mission), chronik, gegner/kill (Kampfgeschehen), sprung, brett und jeder Bauplan-Eintrag mit Aufruf (Modellweg).
// Ausnahme: ein Regie-Eintrag mit Ausgang abgelehnt oder fehler ist nie Rauschen.
const RAUSCH_ARTEN = ['taetigkeit', 'regie'];
const RAUSCH_NAMEN = { taetigkeit: ['Tätigkeitsgrenze', 'Tätigkeitsgrenzen'], regie: ['Regie-Eintrag', 'Regie-Einträge'], bauplan: ['übersprungener Bauplan-Aufruf', 'übersprungene Bauplan-Aufrufe'] };
const RAUSCH_AUSNAHME_AUSGAENGE = ['abgelehnt', 'fehler'];
const INTERNE_FELDER = new Set(['gruppe', 'zuordnung', 'nr', 'spielzeit', 'art']);   // Recorder-Interna: nur in verlauf.json, nie in der Zeilenausgabe

// ---------- Textbausteine ----------
const istObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const leer = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
function wert(v) {
  if (v === null || v === undefined || v === '') return '–';
  if (Array.isArray(v)) return v.length ? v.map((x) => (istObj(x) ? `{${wert(x)}}` : wert(x))).join(', ') : '–';
  if (istObj(v)) { const e = Object.entries(v); return e.length ? e.map(([k, x]) => `${k}: ${wert(x)}`).join('; ') : '–'; }
  return String(v);
}
// einzeilig: fuer jeden einzeiligen Kontext (Ueberschrift, Fettzeile, Listenpunkt, Frontmatter-Wert, Tabellenzelle): Zeilenumbrueche und Kontrollzeichen werden zu Leerzeichen (Befund N3/8: ein Text mit '\n## Notizen' verwirrte notizenAus).
// Das '|' escapen nur die Tabellenzellen (zelle).
const einzeilig = (t) => String(t === undefined || t === null ? '' : t).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ');
const zelle = (v) => einzeilig(wert(v)).replace(/\|/g, '\\|').trim();
const kuerze = (s, n) => { const t = String(s); const m = n || KURZ_MAX; return t.length > m ? t.slice(0, m - 1) + '…' : t; };
const zitat = (text) => String(text === undefined || text === null ? '' : text).split(/\r?\n/).map((z) => `> ${z}`).join('\n');
const yamlText = (s) => JSON.stringify(einzeilig(s));
const yamlZahl = (v) => (v === undefined || v === null || v === '' ? '""' : (Number.isFinite(v) ? String(v) : yamlText(v)));
const zeit = (s) => MD.mmss(s);
function tabelle(kopf, zeilen) {
  if (!zeilen.length) return [];
  return [`| ${kopf.join(' | ')} |`, `|${kopf.map(() => '---').join('|')}|`, ...zeilen.map((z) => `| ${z.map(zelle).join(' | ')} |`), ''];
}
// Tabelle aus Objekten: Spalten = Vereinigung der Schlüssel (bevorzugte zuerst)
function objektTabelle(liste, bevorzugt) {
  const rows = liste.map((x) => (istObj(x) ? x : { wert: x }));
  const keys = [];
  for (const k of bevorzugt || []) if (rows.some((r) => r[k] !== undefined)) keys.push(k);
  for (const r of rows) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  return tabelle(keys, rows.map((r) => keys.map((k) => r[k])));
}

// ---------- Auswahl aus dem Verlauf ----------
const eintraege = (verlauf) => (Array.isArray(verlauf && verlauf.eintraege) ? verlauf.eintraege.slice().sort((a, b) => a.nr - b.nr) : []);
const alleGruppen = (verlauf) => (Array.isArray(verlauf && verlauf.gruppen) ? verlauf.gruppen.slice().sort((a, b) => (a.von_nr - b.von_nr) || (a.bis_nr - b.bis_nr)) : []);
const gruppen = (verlauf) => alleGruppen(verlauf).filter((g) => !g.leer);   // Gruppen mit Inhalt: nur sie bekommen Ordner und mission.md
const leereGruppen = (verlauf) => alleGruppen(verlauf).filter((g) => g.leer);
const imBereich = (e, g) => e.nr >= g.von_nr && e.nr <= g.bis_nr;
const eintraegeVon = (verlauf, g) => eintraege(verlauf).filter((e) => imBereich(e, g));
// Befund N3/1: im Nr-Bereich einer Gruppe liegen auch Eintraege paralleler Faeden. Als EIGENE zaehlen: gleiche Gruppe, heuristisch zugeordnete (laufender Faden, nicht aus den Daten belegt) und solche ohne Gruppe.
const istEigen = (e, g) => e.gruppe === undefined || e.gruppe === null || e.gruppe === g.id || e.zuordnung === 'heuristik';
const eigene = (es, g) => es.filter((e) => istEigen(e, g));
const fremdMarker = (e, g) => (istEigen(e, g) ? '' : ` (${/^f\d+$/.test(String(e.gruppe)) ? 'Faden' : 'Gruppe'} ${einzeilig(e.gruppe)})`);
function eintraegeOhneGruppe(verlauf) {
  const gs = alleGruppen(verlauf);   // auch leere Gruppen: ihre Einträge stehen unter 'Leere Versuche', nicht zwischen den Aufträgen
  return eintraege(verlauf).filter((e) => !gs.some((g) => imBereich(e, g)));
}
const lauf = (verlauf) => (istObj(verlauf && verlauf.lauf) ? verlauf.lauf : {});
const kuenstlichText = (l) => (Array.isArray(l.kuenstlich) ? l.kuenstlich : []).join(', ');
const feldText = (e) => Object.entries(e).filter(([k]) => !INTERNE_FELDER.has(k)).map(([k, v]) => `${k}: ${wert(v)}`).join('; ');

// Kurztext einer Zeile der Zeitleiste. Nur Arten des Vertrags mit Sondertext, alles andere generisch (Leitprinzip).
function kurztext(e) {
  switch (e.art) {
    case 'funk': return `**${einzeilig(wert(e.von))}:** ${wert(e.text)}`;
    case 'oda': return `**ODA:** ${wert(e.text)}`;
    case 'anzeige': return `${e.titel ? `**${einzeilig(e.titel)}** ` : ''}${wert(e.text)}`;
    case 'bitte': return `${einzeilig(wert(e.von))} bittet: ${kuerze(wert(e.text))} (${(e.optionen || []).length} Optionen)`;
    default: return kuerze(feldText(e)) || '–';
  }
}

// ---------- Abschnitte von mission.md ----------
function abschnittAnlass(g) {
  const L = ['## Anlass', ''];
  const p = g.plan;
  if (leer(p)) return L.concat('_Kein Plan erfasst._', '');
  if (!istObj(p)) return L.concat(wert(p), '');
  if (!leer(p.titel)) L.push(`**${einzeilig(wert(p.titel))}**`, '');
  if (!leer(p.anlass)) L.push(zitat(p.anlass), '');
  const rest = Object.entries(p).filter(([k]) => !['titel', 'anlass'].includes(k));
  if (rest.length) L.push(...tabelle(['Feld', 'Inhalt'], rest.map(([k, v]) => [k, v])));
  return L;
}
// Dazu: ein übersprungener Bauplan-Aufruf (kein Modellaufruf, nur Grund des Auslassens); der Modellweg weist ihn als Zähler aus
const istRauschen = (e) => (RAUSCH_ARTEN.includes(e.art) && !(e.art === 'regie' && RAUSCH_AUSNAHME_AUSGAENGE.includes(e.ausgang))) || (e.art === 'bauplan' && e.ausgang === 'uebersprungen');
const rauschName = (art, n) => { const x = RAUSCH_NAMEN[art]; return x ? x[n === 1 ? 0 : 1] : art; };
function rauschZeile(lauf) {
  const zaehl = new Map();
  for (const e of lauf) zaehl.set(e.art, (zaehl.get(e.art) || 0) + 1);
  const teile = [...zaehl].map(([art, n]) => `${n} ${rauschName(art, n)}`);
  const von = lauf[0].nr, bis = lauf[lauf.length - 1].nr;
  return [zeit(lauf[0].spielzeit), von === bis ? von : `${von}–${bis}`, 'zusammengefasst', `… ${teile.join(', ')} (${von === bis ? `Nr ${von}` : `Nr ${von}–${bis}`}, Details in verlauf.json)`];
}
// Zeilen der Zeitleiste: Rauschläufe zu einer Zeile, alles andere einzeln, Reihenfolge nach nr
function zeitleistenZeilen(es, g) {
  const zeilen = []; let lauf = [];
  const leeren = () => { if (lauf.length) zeilen.push(rauschZeile(lauf)); lauf = []; };
  for (const e of es) { if (istRauschen(e)) lauf.push(e); else { leeren(); zeilen.push([zeit(e.spielzeit), e.nr, e.art, kurztext(e) + (g ? fremdMarker(e, g) : '')]); } }
  leeren();
  return zeilen;
}
function abschnittZeitleiste(es, g) {
  const L = ['## Zeitleiste', ''];
  if (!es.length) return L.concat('_Keine Einträge._', '');
  return L.concat(tabelle(['Spielzeit', 'Nr', 'Art', 'Eintrag'], zeitleistenZeilen(es, g)));
}
// Lesbarer Titel (Befund N2/4a): eine Szene heißt im Verlauf 'modus szene' (Rohbezeichner); mit Modus und Szene aus dem Startereignis wird daraus 'Szene: <szene> (modus <modus>)'
function anzeigeTitel(verlauf, g) {
  const roh = g.titel || g.kennung || g.id;
  if (g.art !== 'szene') return roh;
  const s = eintraegeVon(verlauf, g).find((e) => e.art === 'szene' && e.ereignis === 'start' && !leer(e.szene));
  if (!s || String(g.titel) !== `${wert(s.modus)} ${wert(s.szene)}`.trim()) return roh;   // ein echter Titel bleibt
  return `Szene: ${wert(s.szene)}${leer(s.modus) ? '' : ` (modus ${wert(s.modus)})`}`;
}
function abschnittTexte(es) {
  const L = ['## Funk- und Anzeigetexte', ''];
  const ts = es.filter((e) => ['funk', 'oda', 'anzeige'].includes(e.art));
  if (!ts.length) L.push('_Keine Texte._', '');
  for (const e of ts) {
    const wer = einzeilig(e.art === 'funk' ? wert(e.von) : e.art === 'oda' ? 'ODA' : `Anzeige${e.titel ? ` „${e.titel}“` : ''}${e.slot !== undefined ? ` (Slot ${e.slot})` : ''}`);
    L.push(`**${zeit(e.spielzeit)} – ${wer}**`, '', zitat(e.text), '');
  }
  L.push('> Hinweis: Die Zuordnung der Funk- und Anzeigetexte zu dieser Mission ist heuristisch (laufender Faden zum Zeitpunkt des Eintreffens). Bei parallel laufenden Fäden kann ein Text zur Nachbarmission gehören.', '');
  return L;
}
function optionsListe(optionen, gewaehlt) {
  return (optionen || []).map((o) => {
    const id = istObj(o) ? o.id : o;
    const text = istObj(o) ? (o.text !== undefined ? o.text : o.label) : o;
    const treffer = gewaehlt !== undefined && String(id) === String(gewaehlt);
    const zeile = einzeilig(`${wert(id)}: ${wert(text)}`);
    return treffer ? `- **${zeile}** ← gewählt` : `- ${zeile}`;
  });
}
const gewaehltId = (w) => (w.option !== undefined ? w.option : w.id);
const wahlZeile = (w) => einzeilig(`Gewählt: **${wert(gewaehltId(w))}**${w.text ? ` – ${wert(w.text)}` : ''}${w.ausgang ? ` (Ausgang: ${wert(w.ausgang)})` : ''}`);
function regelHinweis(l) {
  const regel = leer(l.regel) ? 'keine Regel angegeben' : einzeilig(l.regel);
  if (l.quelle === 'spieler') return [`> **Wahl durch Spieler.** Aufgezeichnete Regel des Laufs: ${regel}.`, ''];
  const wer = l.quelle === 'messung' ? 'des Messlaufs' : 'des Bots';
  return [`> **Wahlregel ${wer}:** ${regel}. Die gewählten Optionen oben folgen dieser Regel und sind kein Spielerverhalten.`, ''];
}
function abschnittWahl(alle, l, g) {
  const L = ['## Optionen und Wahl', ''];
  const es = eigene(alle, g);   // Befund N3/1: Bitten und Wahlen paralleler Faeden gehoeren nicht hierher
  const fragen = es.filter((e) => e.art === 'bitte' || e.art === 'entscheidung');
  const waehlen = es.filter((e) => e.art === 'wahl');
  const verbraucht = new Set();
  const zuFrage = new Map();
  for (const w of waehlen) {
    const wid = gewaehltId(w);
    const f = fragen.filter((q) => q.nr < w.nr && !zuFrage.has(q) && (q.optionen || []).some((o) => String(istObj(o) ? o.id : o) === String(wid))).pop();
    if (f) { zuFrage.set(f, w); verbraucht.add(w); }
  }
  for (const f of fragen) {
    const w = zuFrage.get(f);
    const titel = einzeilig(f.art === 'bitte' ? `Bitte von ${wert(f.von)}` : f.quelle === 'funk' ? `Funk-Antwort an ${wert(f.von)} (${wert(f.id)})` : `Entscheidung ${wert(f.id)}`);
    L.push(`### ${titel} (${zeit(f.spielzeit)}, Nr ${f.nr})`, '');
    if (f.art === 'bitte' || !leer(f.prompt)) L.push(zitat(f.art === 'bitte' ? f.text : f.prompt), '');
    L.push(...optionsListe(f.optionen, w ? gewaehltId(w) : undefined), '');
    L.push(w ? wahlZeile(w) : '_Keine Wahl erfasst._', '');
  }
  for (const w of waehlen.filter((x) => !verbraucht.has(x))) {
    L.push(`### Wahl (${zeit(w.spielzeit)}, Nr ${w.nr}, Quelle ${einzeilig(wert(w.quelle))})`, '');
    if (w.optionen) L.push(...optionsListe(w.optionen, gewaehltId(w)), '');
    L.push(wahlZeile(w), '');
  }
  if (!fragen.length && !waehlen.length) L.push('_Keine Entscheidungen in dieser Mission._', '');
  L.push(...regelHinweis(l));
  return L;
}
function abschnittFolgen(alle, g) {
  const L = ['## Folgen', ''];
  const es = eigene(alle, g);   // Befund N3/1: Wirkung, Haltung und Chronik paralleler Faeden nicht als eigene zeigen
  const w = es.filter((e) => e.art === 'wirkung'), h = es.filter((e) => e.art === 'haltung'), c = es.filter((e) => e.art === 'chronik');
  if (istObj(g.plan) && !leer(g.plan.folgen)) L.push(`**Geplante Folgen:** ${einzeilig(wert(g.plan.folgen))}`, '');
  L.push('### Wirkung (Ruf, Marken, Ladung, …)', '');
  L.push(...(w.length ? tabelle(['Spielzeit', 'Konto', 'Ziel', 'Betrag', 'Stand', 'Grund'], w.map((e) => [zeit(e.spielzeit), e.konto, e.ziel, e.betrag, e.stand, e.grund])) : ['_Keine erfasst._', '']));
  L.push('### Haltung der NSC', '');
  L.push(...(h.length ? tabelle(['Spielzeit', 'NSC', 'Änderung', 'Stand', 'Grund'], h.map((e) => [zeit(e.spielzeit), e.npc, e.delta, e.stand, e.grund])) : ['_Keine erfasst._', '']));
  L.push('### Chronik', '');
  L.push(...(c.length ? tabelle(['Spielzeit', 'Bezug', 'Kurz', 'Parameter'], c.map((e) => [zeit(e.spielzeit), e.ref, e.kurz, e.param])) : ['_Keine erfasst._', '']));
  return L;
}
function abschnittNsc(g) {
  const L = ['## Beteiligte NSC (Kanon)', ''];
  const n = Array.isArray(g.nsc) ? g.nsc : [];
  return L.concat(n.length ? objektTabelle(n, ['id', 'name', 'volk', 'titel', 'ort', 'haltung', 'ausgang']) : ['_Keine erfasst._', '']);
}
const jaNein = (b) => (b ? 'ja' : 'nein');
const sek = (x) => (x === null || x === undefined || !Number.isFinite(Number(x)) ? '–' : `${Number(x)} s`);
// Zusammenfassungszeile des Modellwegs (Befund N2/3): steht IMMER zuerst, entweder aus gruppe.modell oder als ausdrückliche Feststellung
function modellZeile(m) {
  if (!istObj(m)) return 'Kein Modellaufruf zu diesem Auftrag aufgezeichnet (Plan vom Werkzeug gesetzt oder Vorlage ohne Plan).';
  const rueck = m.rueckfall === true ? (m.vorlage ? `ja (kein Modell, Anschluss-Vorlage ${wert(m.vorlage)})` : 'ja (kein Modell)') : (typeof m.rueckfall === 'string' && m.rueckfall ? `ja (${m.rueckfall})` : 'nein');
  return einzeilig(`**Stufe ${wert(m.stufe)} · Anbieter ${wert(m.anbieter)} · Modell ${wert(m.modell)} · Quelle ${wert(m.quelle)} · Rückfall: ${rueck} · eskaliert ${jaNein(m.eskaliert !== undefined && m.eskaliert !== null ? m.eskaliert : (Array.isArray(m.aufrufe) && m.aufrufe.some((x) => x && x.eskaliert)))} · Tokens ${m.tokens === undefined || m.tokens === null ? '–' : m.tokens} · Dauer ${sek(m.dauer_s)}**`);
}
function abschnittModell(es, g) {
  const L = ['## Modellweg', ''];
  const m = g.modell;
  L.push(modellZeile(m), '');
  if (istObj(m) && Array.isArray(m.aufrufe) && m.aufrufe.length) L.push('Aufrufe bis zum gültigen Plan:', '', ...objektTabelle(m.aufrufe));
  const bau = es.filter((e) => e.art === 'bauplan');
  const echt = bau.filter((e) => e.ausgang !== 'uebersprungen');
  const skip = bau.length - echt.length;
  if (echt.length) {
    L.push('Bauplan-Einträge im Verlauf (Rückfall und Eskalation sichtbar):', '');
    L.push(...tabelle(['Spielzeit', 'Ausgang', 'Anbieter', 'Modell', 'Tokens', 'Dauer s', 'eskaliert'], echt.map((e) => [zeit(e.spielzeit), e.ausgang, e.anbieter, e.modell, e.tokens, e.dauer_s, e.eskaliert])));
  }
  if (skip) L.push(`_${skip} übersprungene Bauplan-Aufrufe im Zeitraum (kein Modellaufruf, Details in verlauf.json)._`, '');
  return L;
}
function abschnittPruefer(es, g) {
  const L = ['## Prüfer-Warnungen', ''];
  const p = Array.isArray(g.pruefer) ? g.pruefer : [];
  const pe = es.filter((e) => e.art === 'faden_pruefung');
  if (!p.length && !pe.length) return L.concat('_Keine._', '');
  for (const x of p) L.push(`- ${einzeilig(wert(x))}`);
  for (const e of pe) L.push(`- ${einzeilig(`${zeit(e.spielzeit)} ${wert(e.ausgang)}${e.key ? ` (${e.key})` : ''}: ${(Array.isArray(e.fehler) ? e.fehler : [e.fehler]).map(wert).join('; ')}`)}`);
  return L.concat('');
}
const notizBlock = (notizen) => [MD.NOTES_HEAD, '', (notizen && String(notizen).trim()) || NOTES_STANDARD, ''];
const schliessen = (L) => L.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '\n');

// ---------- Öffentliche reine Funktionen ----------
function renderMission(verlauf, gruppe, opts) {
  const o = opts || {};
  const l = lauf(verlauf);
  const es = eintraegeVon(verlauf, gruppe);
  const kst = kuenstlichText(l);
  const von = es.length ? es[0].spielzeit : null, bis = es.length ? es[es.length - 1].spielzeit : null;
  const L = ['---',
    `titel: ${yamlText(gruppe.titel)}`,
    `kennung: ${yamlText(gruppe.kennung)}`,
    `lauf: ${yamlText(l.id)}`,
    `seed: ${yamlZahl(l.seed)}`,
    `crew: ${yamlZahl(l.crew)}`,
    `quelle: ${yamlText(l.quelle)}`,
    `werkzeug: ${yamlText(l.werkzeug)}`,
    `bot_regel: ${yamlText(l.regel)}`,
    `ausgang: ${yamlText(gruppe.ausgang)}`,
    `verlauf_kuenstlich: ${JSON.stringify(Array.isArray(l.kuenstlich) ? l.kuenstlich : [])}`,
    `bewertung: ${o.bewertung || BEWERTUNG_OFFEN}`];
  if (o.jetzt) L.push(`erzeugt: ${MD.localDate(o.jetzt)}`);
  L.push('---', '', `# ${einzeilig(anzeigeTitel(verlauf, gruppe))}`, '',
    '> Review: Setze im Frontmatter `bewertung` auf `gut`, `schwach` oder `verwerfen` und schreibe Anmerkungen unter „Notizen“. Beides bleibt beim Neuschreiben erhalten. Dies ist ein Mitschnitt eines simulierten Laufs, keine Freigabe.', '');
  L.push(...tabelle(['Feld', 'Wert'], [
    ['Gruppe', `${gruppe.art || '–'} (${gruppe.id})`], ['Ausgang', gruppe.ausgang], ['Lauf', l.id], ['Werkzeug', l.werkzeug],
    ['Quelle', l.quelle], ['Seed', l.seed], ['Crew', l.crew], ['Modus', l.modus],
    ['Spielzeit', es.length ? `${zeit(von)} – ${zeit(bis)} (${zeit(bis - von)})` : '–'],
    ['Einträge', es.length ? `Nr ${gruppe.von_nr}–${gruppe.bis_nr} (${es.length})` : '0'],
    ['Angebot', gruppe.angebot]]));
  if (kst) L.push(`> **Verlauf teilweise gesetzt:** ${einzeilig(kst)}. Diese Schritte hat das Werkzeug künstlich herbeigeführt, sie sind nicht aus freiem Spiel entstanden.`, '');
  L.push(...abschnittAnlass(gruppe), ...abschnittZeitleiste(es, gruppe), ...abschnittTexte(es), ...abschnittWahl(es, l, gruppe),
    ...abschnittFolgen(es, gruppe), ...abschnittNsc(gruppe), ...abschnittModell(es, gruppe), ...abschnittPruefer(es, gruppe), ...notizBlock(o.notizen));
  return schliessen(L);
}

function renderIndex(verlauf, opts) {
  const o = opts || {};
  const l = lauf(verlauf);
  const gs = gruppen(verlauf), leere = leereGruppen(verlauf), es = eintraege(verlauf);
  const kst = kuenstlichText(l);
  const L = ['---', `titel: ${yamlText(`Mitschnitt ${l.id || ''}`.trim())}`, `lauf: ${yamlText(l.id)}`, `werkzeug: ${yamlText(l.werkzeug)}`,
    `quelle: ${yamlText(l.quelle)}`, `seed: ${yamlZahl(l.seed)}`, `crew: ${yamlZahl(l.crew)}`,
    `verlauf_kuenstlich: ${JSON.stringify(Array.isArray(l.kuenstlich) ? l.kuenstlich : [])}`];
  if (o.jetzt) L.push(`erzeugt: ${MD.localDate(o.jetzt)}`);
  L.push('---', '', `# Mitschnitt ${einzeilig(l.id || '')}`.trim(), '');
  L.push(...tabelle(['Feld', 'Wert'], [['Werkzeug', l.werkzeug], ['Quelle', l.quelle], ['Seed', l.seed], ['Crew', l.crew], ['Modus', l.modus],
    ['Gestartet', l.gestartet], ['Beendet', l.beendet], ['Wahlregel', l.regel], ['Künstlich gesetzt', kst || 'nichts'], ['Einträge', es.length], ['Gruppen', gs.length], ...(leere.length ? [['Leere Versuche', leere.length]] : []), ...(l.verworfen > 0 ? [['Verworfene Einträge', l.verworfen]] : [])]));
  if (l.verworfen > 0) L.push(`> **Achtung: ${l.verworfen} Einträge wurden verworfen** (Obergrenze je Lauf erreicht). Der Verlauf ist ab dort unvollständig.`, '');
  if (kst) L.push(`> **Verlauf teilweise gesetzt:** ${einzeilig(kst)}.`, '');
  L.push('## Aufträge', '');
  const ordner = o.ordner || {}, bew = o.bewertungen || {};
  L.push(...(gs.length ? tabelle(['Nr', 'Titel', 'Art', 'Ausgang', 'Dauer', 'Bewertung', 'Ordner'], gs.map((g, i) => {
    const mine = es.filter((e) => imBereich(e, g));
    const d = mine.length ? zeit(mine[mine.length - 1].spielzeit - mine[0].spielzeit) : '–';
    const ord = ordner[g.id];
    return [i + 1, anzeigeTitel(verlauf, g), g.art, g.ausgang, d, bew[g.id] || BEWERTUNG_OFFEN, ord ? `[${ord}](${ord}/mission.md)` : '–'];
  })) : ['_Keine Gruppen._', '']));
  if (leere.length) {
    L.push('## Leere Versuche', '');
    L.push(...tabelle(['Titel', 'Ausgang', 'Hinweis'], leere.map((g) => {
      const mine = es.filter((e) => imBereich(e, g));
      const d = mine.length ? zeit(mine[mine.length - 1].spielzeit - mine[0].spielzeit) : '–';
      const ers = g.ersetzt_durch ? `Vorversuch (${d}), ersetzt durch ${wert(g.ersetzt_durch)}` : `ohne eigenen Inhalt (${d}), kein eigenes Dokument`;
      return [anzeigeTitel(verlauf, g), g.ausgang, `${ers}; ${mine.length} Einträge nur in verlauf.json`];
    })));
  }
  L.push('## Angebote', '');
  const an = Array.isArray(verlauf && verlauf.angebote) ? verlauf.angebote : [];
  if (an.length) {
    const zaehl = {};
    for (const a of an) zaehl[a.ausgang || 'offen'] = (zaehl[a.ausgang || 'offen'] || 0) + 1;
    L.push(`Gesamt ${an.length}: ${Object.entries(zaehl).map(([k, n]) => `${k} ${n}`).join(', ')}`, '');
    L.push(...tabelle(['Angebot', 'Titel', 'Ausgang'], an.map((a) => [a.angebot, a.titel, a.ausgang])));
  } else L.push('_Keine Angebote._', '');
  L.push('## Zwischen den Aufträgen', '');
  const frei = eintraegeOhneGruppe(verlauf);
  L.push(...(frei.length ? tabelle(['Spielzeit', 'Nr', 'Art', 'Eintrag'], zeitleistenZeilen(frei)) : ['_Keine Einträge außerhalb von Aufträgen._', '']));
  L.push('> Hinweis: Die Zuordnung von Funk und Anzeigen zu Aufträgen ist heuristisch (laufender Faden).', '');
  L.push(...notizBlock(o.notizen));
  return schliessen(L);
}

// ---------- Ablage (einziges I/O) ----------
function ordnerNamen(gs) {
  const benutzt = new Set(); const out = {};
  gs.forEach((g, i) => {
    const basis = MD.slugify(g.kennung || g.id, 48);
    let slug = basis, n = 1;
    while (benutzt.has(slug)) slug = `${basis}-${++n}`;
    benutzt.add(slug);
    out[g.id] = { slug, name: `${String(i + 1).padStart(2, '0')}_${slug}` };
  });
  return out;
}
// vorhandener Ordner zur Kennung (die Nummer vorn darf sich ändern)
function findeOrdner(dir, slug) {
  let namen = [];
  try { namen = fs.readdirSync(dir); } catch (e) { return null; }
  return namen.find((n) => n.replace(/^\d+_/, '') === slug && fs.existsSync(path.join(dir, n, 'mission.md'))) || null;
}
const json = (x) => JSON.stringify(x, null, 2) + '\n';
const angebotsId = (a) => (istObj(a) ? a.angebot : a);

function schreibeLauf(verlauf, dir, opts) {
  if (!istObj(verlauf) || verlauf.format !== FORMAT) throw new Error(`schreibeLauf: Format '${verlauf && verlauf.format}' unbekannt (erwartet ${FORMAT})`);
  if (!dir) throw new Error('schreibeLauf: dir fehlt');
  const jetzt = opts && opts.jetzt;
  const gs = gruppen(verlauf);
  const namen = ordnerNamen(gs);
  const dateien = [];
  const ablegen = (rel, text) => { MD.writeAtomic(path.join(dir, rel), text); dateien.push(rel); };
  const bewertungen = {}, ordner = {};
  for (const g of gs) {
    const { slug, name } = namen[g.id];
    const alt = findeOrdner(dir, slug);
    const st = alt ? MD.readMdFelder(path.join(dir, alt, 'mission.md'), ['bewertung']) : { felder: { bewertung: null }, notizen: null };
    const bewertung = st.felder.bewertung || BEWERTUNG_OFFEN;
    const gid = angebotsId(g.angebot);
    ablegen(`${name}/mission.md`, renderMission(verlauf, g, { bewertung, notizen: st.notizen, jetzt }));
    ablegen(`${name}/verlauf.json`, json({
      format: FORMAT, lauf: verlauf.lauf, gruppe: g, eintraege: eintraegeVon(verlauf, g),
      angebote: gid === null || gid === undefined ? [] : (verlauf.angebote || []).filter((a) => String(a.angebot) === String(gid)),
    }));
    if (alt && alt !== name) {
      for (const f of ['mission.md', 'verlauf.json']) { try { fs.unlinkSync(path.join(dir, alt, f)); } catch (e) { /* egal */ } }
      try { fs.rmdirSync(path.join(dir, alt)); } catch (e) { /* nicht leer: bleibt */ }
    }
    bewertungen[g.id] = bewertung; ordner[g.id] = name;
  }
  const idx = MD.readMdFelder(path.join(dir, 'index.md'), []);
  ablegen('index.md', renderIndex(verlauf, { bewertungen, ordner, notizen: idx.notizen, jetzt }));
  ablegen('verlauf.json', json(verlauf));
  return { dir, dateien };
}

module.exports = { renderMission, renderIndex, schreibeLauf, einzeilig, FORMAT };
