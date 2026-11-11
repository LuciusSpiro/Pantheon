'use strict';
// SPL-02 G: Kennzahlen der Abenteuer-Komposition fuer tools/messe-abenteuer.js (rein, ohne Server und Netz, einzeln getestet in tools/test-messe-absichten.js).
// Eine Zeile je Aufruf (Eintrag des Logbuchs abenteuer_bauplan, dazu der Plan des Angebots). Keine Absichts- und Beat-Namen im Code: was es gibt, kommt aus den Zeilen, dem Katalog und den Beat-Daten.
//   kennzahlen(zeilen, ctx) -> Objekt (JSON)      ctx: { modusAbsicht, live, systemZeichen, lesbarePlaene }
//   kennzahlenZeilen(k) -> [Markdown-Zeilen]       lesbare Tabelle
//   vorgeschichteAufbauen(g, Faden, D, daten) -> Anzahl   Welt mit abgeschlossenen Faeden samt NSC (Daten: tools/fixtures/messe/vorgeschichte.json)
//   zeile: { ausgang, grund, verhandlung (0|1), absicht (Name|null), bezug_art ('keiner'|'nsc'|'ort'|'nsc+ort'|null), typen: [Beat-Typen] (nur gueltig), fortsetzungBeat: bool, tokens, geld,
//            prompt_zeichen, kontext_zeichen, katalog_zeichen, folge_zeichen (Folgeprompt der Verhandlung) }
// Nenner: Gueltigkeit und Verhandlung je Aufruf; Vielfalt, Bezug und Fortsetzung je GUELTIGEM Plan. Fortsetzung = ein Beat des Plans nimmt einen NSC aus einem frueheren Faden auf (Beat-Daten braucht.nsc_alt)
// oder der Plan nennt einen NSC als Bezug. Tokens aus Zeichen: TOKEN_FAKTOR (grobe Naeherung, wie die Erkundung von SPL-02), der Zaehler des Anbieters ist davon unabhaengig (im Mock 0).
const TOKEN_FAKTOR = 3.5;
const fmtDe = (x, d) => (Number.isFinite(x) ? (Math.round(x * (d || 1)) / (d || 1)).toLocaleString('de-DE') : '–');
const mittel = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const zaehle = (xs) => { const c = {}; for (const x of xs) c[x] = (c[x] || 0) + 1; return c; };
const anteil = (a, b) => (b ? a / b : null);
const wiederholt = (xs) => { let n = 0; for (let i = 1; i < xs.length; i++) if (xs[i] === xs[i - 1]) n++; return n; };
const hatNsc = (z) => !!(z.bezug_art && /nsc/.test(z.bezug_art));

function kennzahlen(zeilen, ctx) {
  const c = ctx || {};
  const A = !!c.modusAbsicht;
  const gesamt = zeilen.length;
  const gueltig = zeilen.filter((z) => z.ausgang === 'gueltig');
  const abgelehnt = zeilen.filter((z) => z.ausgang === 'abgelehnt');
  const ausfall = zeilen.filter((z) => z.ausgang !== 'gueltig' && z.ausgang !== 'abgelehnt');
  const ersterVersuch = gueltig.filter((z) => !z.verhandlung).length;
  const nachVerhandlung = gueltig.filter((z) => z.verhandlung).length;
  const verhandelt = zeilen.filter((z) => z.verhandlung).length;
  const folgen = gueltig.map((z) => (z.typen || []).join('>'));
  const absichten = gueltig.map((z) => z.absicht).filter(Boolean);
  const mitBezug = gueltig.filter((z) => z.bezug_art && z.bezug_art !== 'keiner').length;
  const mitNsc = gueltig.filter(hatNsc).length;
  const fortsetzung = gueltig.filter((z) => z.fortsetzungBeat || hatNsc(z)).length;
  const mitPrompt = zeilen.filter((z) => Number.isFinite(z.prompt_zeichen));
  const prompt = mittel(mitPrompt.map((z) => z.prompt_zeichen)), kontext = mittel(mitPrompt.map((z) => z.kontext_zeichen)), katalog = mittel(mitPrompt.map((z) => z.katalog_zeichen));
  const kopf = prompt != null ? prompt - kontext - katalog : null;
  const folge = mittel(zeilen.filter((z) => Number.isFinite(z.folge_zeichen)).map((z) => z.folge_zeichen));
  const t = (x) => (x == null ? null : x / TOKEN_FAKTOR);
  const tokens = zeilen.reduce((s, z) => s + (z.tokens || 0), 0);
  const geldBekannt = zeilen.filter((z) => Number.isFinite(z.geld));
  const geld = geldBekannt.reduce((s, z) => s + z.geld, 0);
  const sys = c.systemZeichen == null ? null : c.systemZeichen;
  return {
    modus: A ? 'absicht' : 'beat-plan',
    aufrufe: gesamt,
    gueltigkeit: {
      gueltig: gueltig.length, gueltig_quote: anteil(gueltig.length, gesamt), erster_versuch: ersterVersuch, erster_versuch_quote: anteil(ersterVersuch, gesamt), nach_verhandlung: nachVerhandlung, nach_verhandlung_quote: anteil(nachVerhandlung, gesamt),
      abgelehnt: abgelehnt.length, abgelehnt_quote: anteil(abgelehnt.length, gesamt), abgelehnt_je_code: zaehle(abgelehnt.map((z) => z.grund || '?')), ausfall: ausfall.length, ausfall_quote: anteil(ausfall.length, gesamt), ausfall_je_code: zaehle(ausfall.map((z) => z.grund || '?')),
    },
    verhandlung: A ? { aufrufe_mit_verhandlung: verhandelt, quote: anteil(verhandelt, gesamt), gerettet: nachVerhandlung, gerettet_quote: anteil(nachVerhandlung, verhandelt) } : null,
    vielfalt: {
      gueltige_plaene: gueltig.length, verschiedene_beat_folgen: new Set(folgen).size, verschiedene_beat_folgen_quote: anteil(new Set(folgen).size, gueltig.length),
      verschiedene_absichten: A ? new Set(absichten).size : null, absichten_je_name: A ? zaehle(absichten) : null,
    },
    bezug: A ? { plaene_mit_bezug: mitBezug, quote: anteil(mitBezug, gueltig.length), mit_nsc: mitNsc, mit_nsc_quote: anteil(mitNsc, gueltig.length), je_art: zaehle(gueltig.map((z) => z.bezug_art || 'keiner')) } : null,
    fortsetzung: { plaene: fortsetzung, quote: anteil(fortsetzung, gueltig.length), regel: 'ein Beat des Plans nimmt einen NSC aus einem frueheren Faden auf (Beat-Daten braucht.nsc_alt) oder der Plan nennt einen NSC als Bezug' },
    prompt: { zeichen: prompt, tokens: t(prompt), kopf_zeichen: kopf, kopf_tokens: t(kopf), katalog_zeichen: katalog, katalog_tokens: t(katalog), kontext_zeichen: kontext, kontext_tokens: t(kontext), system_zeichen: sys, system_tokens: t(sys),
      folgeprompt_zeichen: folge, folgeprompt_tokens: t(folge), token_faktor: TOKEN_FAKTOR, aufrufe_gemessen: mitPrompt.length },
    tokens: { gesamt: tokens, je_aufruf: anteil(tokens, gesamt), hinweis: 'Zaehler des Anbieters (CLAUDE_TOKEN_BUDGET), im Mock 0' },
    kosten_usd: c.live ? (geldBekannt.length ? geld : null) : 0,
    kosten_je_aufruf_usd: c.live ? (geldBekannt.length ? geld / gesamt : null) : 0,
    gelesen: { lesbare_absichten: A ? zeilen.filter((z) => z.absicht).length : null, lesbare_antworten: A ? null : (c.lesbarePlaene == null ? null : c.lesbarePlaene) },
    wiederholung: A
      ? { art: 'gleiche Absicht wie die vorige gueltige', wiederholt: wiederholt(absichten), von: Math.max(0, absichten.length - 1), quote: anteil(wiederholt(absichten), Math.max(0, absichten.length - 1)), beat_folgen_wiederholt: wiederholt(folgen), beat_folgen_von: Math.max(0, folgen.length - 1) }
      : { art: 'gleiche Beat-Folge wie die vorige gueltige', wiederholt: wiederholt(folgen), von: Math.max(0, folgen.length - 1), quote: anteil(wiederholt(folgen), Math.max(0, folgen.length - 1)) },
  };
}

const pz = (x) => (x == null ? '–' : fmtDe(100 * x, 10) + ' %');
const zt = (z, tk) => (z == null ? '–' : `${fmtDe(z)} Z. (${fmtDe(tk)} Tok.)`);
const codes = (o) => (Object.keys(o).length ? ': ' + Object.entries(o).map(([c, n]) => `${c} ${n}`).join(', ') : '');
function kennzahlenZeilen(k) {
  const g = k.gueltigkeit, p = k.prompt, A = k.modus === 'absicht';
  const L = [`Kennzahlen (SPL-02 G, Modus ${A ? 'Absichten' : 'Beat-Plan'}, ${k.aufrufe} Aufrufe)`, '| Kennzahl | Wert |', '|---|---|'];
  L.push(`| gültig, erster Versuch | ${g.erster_versuch} (${pz(g.erster_versuch_quote)}) |`);
  L.push(`| gültig nach Verhandlung | ${k.verhandlung ? `${g.nach_verhandlung} (${pz(g.nach_verhandlung_quote)})` : 'nicht anwendbar (keine Verhandlung im Beat-Plan)'} |`);
  L.push(`| gültig gesamt | ${g.gueltig} (${pz(g.gueltig_quote)}) |`);
  L.push(`| abgelehnt | ${g.abgelehnt} (${pz(g.abgelehnt_quote)})${codes(g.abgelehnt_je_code)} |`);
  L.push(`| Ausfall | ${g.ausfall} (${pz(g.ausfall_quote)})${codes(g.ausfall_je_code)} |`);
  L.push(`| Verhandlungsquote | ${k.verhandlung ? `${k.verhandlung.aufrufe_mit_verhandlung} von ${k.aufrufe} (${pz(k.verhandlung.quote)}), davon gerettet ${k.verhandlung.gerettet} (${pz(k.verhandlung.gerettet_quote)})` : 'nicht anwendbar'} |`);
  L.push(`| Vielfalt Beat-Folgen | ${k.vielfalt.verschiedene_beat_folgen} verschiedene in ${k.vielfalt.gueltige_plaene} gültigen Plänen |`);
  L.push(`| Vielfalt Absichten | ${k.vielfalt.verschiedene_absichten == null ? 'nicht anwendbar (der Beat-Plan kennt keine Absichten)' : `${k.vielfalt.verschiedene_absichten} verschiedene in ${k.vielfalt.gueltige_plaene} gültigen Plänen`} |`);
  L.push(`| Bezugsquote | ${k.bezug ? `${k.bezug.plaene_mit_bezug} von ${k.vielfalt.gueltige_plaene} (${pz(k.bezug.quote)}), davon mit NSC ${k.bezug.mit_nsc}` : 'nicht anwendbar (der Beat-Plan hat kein Bezugsfeld)'} |`);
  L.push(`| Fortsetzungsquote | ${k.fortsetzung.plaene} von ${k.vielfalt.gueltige_plaene} (${pz(k.fortsetzung.quote)}) |`);
  L.push(`| gelesen | ${A ? `${k.gelesen.lesbare_absichten} lesbare Absichten in ${k.aufrufe} Aufrufen` : `${k.gelesen.lesbare_antworten == null ? '–' : k.gelesen.lesbare_antworten} lesbare Antworten in ${k.aufrufe} Aufrufen`} |`);
  L.push(`| Wiederholungsrate (${k.wiederholung.art}) | ${k.wiederholung.wiederholt} von ${k.wiederholung.von} (${pz(k.wiederholung.quote)})${k.wiederholung.beat_folgen_von != null ? `; gleiche Beat-Folge wie die vorige: ${k.wiederholung.beat_folgen_wiederholt} von ${k.wiederholung.beat_folgen_von}` : ''} |`);
  L.push(`| Prompt je Aufruf (Mittel) | ${zt(p.zeichen, p.tokens)}: Kopf ${zt(p.kopf_zeichen, p.kopf_tokens)}, Katalog ${zt(p.katalog_zeichen, p.katalog_tokens)}, Kontext ${zt(p.kontext_zeichen, p.kontext_tokens)} |`);
  L.push(`| Systemprompt / Folgeprompt | ${zt(p.system_zeichen, p.system_tokens)} / Verhandlung ${p.folgeprompt_zeichen == null ? '–' : zt(p.folgeprompt_zeichen, p.folgeprompt_tokens)} |`);
  L.push(`| Tokens (Zähler) | ${fmtDe(k.tokens.gesamt)} gesamt, je Aufruf ${k.tokens.je_aufruf == null ? '–' : fmtDe(k.tokens.je_aufruf)} |`);
  L.push(`| Kosten | ${k.kosten_usd == null ? 'nicht gemeldet' : fmtDe(k.kosten_usd, 10000) + ' USD' + (k.kosten_usd ? ', je Aufruf ' + fmtDe(k.kosten_je_aufruf_usd, 10000) + ' USD' : ' (Mock)')} |`);
  return L;
}

// Welt mit Vorgeschichte: jede Zeile der Daten ein gespieltes, abgeschlossenes Abenteuer mit einem NSC (wie welt8 in tools/test-abenteuer-absichten.js); danach stehen Name, Volk, Status und Haltung wie in den Daten
function vorgeschichteAufbauen(g, Faden, D, daten) {
  const zust = Faden.zustandVon(g);
  const abschluss = Object.keys(D.BEATS).find((t) => D.BEATS[t].abschluss);
  daten.faeden.forEach((z, i) => {
    const plan = { format: 'faden-bauplan/1', titel: z.typ + ' ' + (i + 1), anlass: 'Vorgeschichte Nummer ' + (i + 1) + ' ohne Namen fuer die Messung', beats: [Object.assign({ typ: z.typ }, z.parameter ? { parameter: z.parameter } : {}), { typ: abschluss }] };
    const a = Faden.abenteuerAnbieten(g, plan, { hex: daten.hex });
    if (!a || !a.ok) throw new Error('Vorgeschichte Zeile ' + (i + 1) + ' nicht anbietbar: ' + (a && (a.grund || (a.fehler || []).join('; '))));
    const r = Faden.abenteuerOeffnen(g, a.angebot.nr, {});
    const f = r.faden, v = D.vorlage(f.vorlage);
    for (let b = f.beat; b < v.beats.length && f.phase !== 'abgeschlossen'; b++) { f.beat = b; f.phase = 'laeuft'; f.laufend = { beat: v.beats[b].id, n: 0, seit: 0 }; Faden.beatAusgang(g, f.id, daten.ausgang); }
    f.nsc.name = z.name; f.nsc.fraktion = daten.volk; f.nsc.status = z.status; f.nsc.haltung = z.haltung;
    const e = zust.kanon.find((x) => x.f === f.id);
    if (e) { e.name = z.name; e.volk = daten.volk; e.status = z.status; }
  });
  zust.abenteuerAngebote.length = 0;
  return daten.faeden.length;
}

module.exports = { kennzahlen, kennzahlenZeilen, vorgeschichteAufbauen, TOKEN_FAKTOR };
