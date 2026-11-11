'use strict';
// SPL-01 a3: Pruefer-Matrix. Jede Boden-Umsetzung (schauplatz 'aussen') des Katalogs auf jeder Kartenart, die der Spielleiter
// ueber buehne: { kartenart, neu: true } anlegen koennte, durch szenenbau.aufloesen (der Pruefer des Spielleiters). Liest nur, im Speicher.
// Zweck: zeigt, welche Umsetzung auf welcher Kartenart durchgeht (ok) und woran sie sonst scheitert (Fehlercode, z. B. BUEHNE-ART,
//        BUEHNE-BRAUCHT, ANKER). Erkundungsstand SPL-01 (2026-11): keine Umsetzung nennt wildnis/hoehle -> BUEHNE-ART.
// Aufruf:  node tools/messe-spl-matrix.js [--seeds n] [--kartenart art] [--json]      (npm run messe:spl-matrix)
//   --seeds n        n Seeds (Weltstand meta.seed 1..n, bestimmt den neuen Landepunkt); Standard 1
//   --kartenart art  nur diese Kartenart (aussenposten, station, ruine, schiff, wildnis, hoehle); Standard alle
//   --biom b         (SPL-01 c) Wildnis mit festem Biom (wueste, wiesenwald, vulkan) statt Zufall aus dem Seed; setzt gen.biom am neuen Landepunkt
//   --hoehle         (SPL-01 c) Wildnis mit Hoehlen-Deck (gen.hoehle); wirkt nur auf die Kartenart wildnis
//   --json           nur JSON: { seeds, arten, zeilen: [{ umsetzung, szenentyp, ergebnis: { art: { ok, fehler: { code: n } } } }] }
// Ausgabe: eine Tabellenzeile je Umsetzung; je Kartenart "ok" oder die Fehlercodes ("ok 3/5 ANKER" bei gemischten Seeds).
// Exit: 0 gemessen, 1 Fehler beim Messen, 2 falscher Aufruf. Keine Erwartung, kein Test (Selbsttest: tools/test-messe-spl.js).
const path = require('path');
const M = require('./lib/messe-spl.js');
const Katalog = require('./katalog.js');
const SB = require('../server/mission/szenenbau.js');
const Context = require('../server/mission/context.js');

const ALLE_ARTEN = ['aussenposten', 'station', 'ruine', 'schiff', 'wildnis', 'hoehle'];
const HILFE = 'Aufruf: node tools/messe-spl-matrix.js [--seeds n] [--kartenart art] [--biom b] [--hoehle] [--json]';
const flags = M.args(process.argv.slice(2), { seeds: 'zahl', kartenart: 'text', biom: 'text', hoehle: 'flag', json: 'flag' }, HILFE);
if (flags.kartenart && !ALLE_ARTEN.includes(flags.kartenart)) { console.error(`Unbekannte Kartenart "${flags.kartenart}" (${ALLE_ARTEN.join(', ')})`); process.exit(2); }

if (flags.biom && !['wueste', 'wiesenwald', 'vulkan'].includes(flags.biom)) { console.error('Unbekanntes Biom "' + flags.biom + '" (wueste, wiesenwald, vulkan)'); process.exit(2); }
// SPL-01 c: Vorgaben des Erzeugers (gen) an jeden neuen Wildnis-Landepunkt, damit Biom und Hoehlen-Deck messbar sind (der Spielleiter selbst setzt sie nie)
const GEN = Object.assign({}, flags.biom ? { biom: flags.biom } : {}, flags.hoehle ? { hoehle: true } : {});
const mitGen = (lp) => (!lp || !Object.keys(GEN).length ? lp : Object.assign(Object.create(lp), { vorschau: (ort, o) => lp.vorschau(ort, o && o.art === 'wildnis' ? Object.assign({}, o, { gen: GEN }) : o) }));

function plan(s) {
  const o = Object.assign({ karte: null, sachverhalt: 't', wendung: null, dauer_min: 4 }, s);
  o.molekuele = (s.mols || []).map((x) => ({ id: x.split('/')[0], umsetzung: x.split('/')[1] })); delete o.mols;
  o.weiter = [{ wenn: 'gut', nach: 'ausgang:erfolg' }, { wenn: 'sonst', nach: 'ausgang:teil' }];
  return {
    format: 'grobplan/2', id: 'x', titel: 'x', auftraggeber: 'melk', zielspieldauer_min: 12, aufhaenger: 't', erinnerung: { npc: 'melk', ereignis: 'm3_erinnerung' }, erinnerung_text: 't', belohnung_marken: 100,
    szenen: [{ id: 's1_hafen', szenentyp: 'hafen', ort: 'hafen', karte: null, molekuele: [], sachverhalt: 'a', wendung: null, dauer_min: 2, weiter: [{ wenn: 'immer', nach: 's2' }] }, Object.assign(o, { id: 's2' })],
    entscheidungen: [], ausgaenge: { erfolg: { wann: 'g', folgen: ['chronik: x.'] }, teil: { wann: 'h', folgen: ['chronik: y.'] } },
  };
}

M.laufen('messe-spl-matrix', flags, () => {
  const katalog = Katalog.load({});
  const env = SB.buildEnv(katalog);
  const w0 = M.weltstand('nach-tutorial');
  const ctx = Context.build(w0, M.anlass(), katalog);
  ctx.bodenbilanz = { letzte: [], pflicht_jetzt: false, lang_ab_min: 25 };
  const arten = flags.kartenart ? [flags.kartenart] : ALLE_ARTEN;
  const seeds = flags.seeds || 1;
  const lps = [];
  for (let s = 1; s <= seeds; s++) { const w = M.clone(w0); w.meta = Object.assign({}, w.meta, { seed: s }); lps.push(mitGen(Context.lpAdapterAusWelt(w))); }
  const zeilen = [];
  for (const m of Object.values(katalog.molekuele)) for (const u of m.umsetzungen) {
    if (u.schauplatz !== 'aussen') continue;
    const id = `${m.id}/${u.id}`;
    const st = Object.values(katalog.szenentypen).find((t) => t.bereich === 'aussen' && t.status === 'verfuegbar' && (t.verfuegbare_molekuele || []).includes(m.id));
    if (!st) { zeilen.push({ umsetzung: id, szenentyp: null, ergebnis: null }); continue; }
    const ergebnis = {};
    for (const art of arten) {
      let ok = 0; const fehler = {};
      for (const lp of lps) {
        const g = plan({ szenentyp: st.id, ort: 'kesh', buehne: { kartenart: art, neu: true }, mols: [id] });
        const r = SB.aufloesen(g, env, M.clone(ctx), { lp });
        if (!r.errors.length) ok++;
        else for (const c of new Set(r.errors.map((e) => String(e).split(':')[0]))) fehler[c] = (fehler[c] || 0) + 1;
      }
      ergebnis[art] = { ok, von: seeds, fehler };
    }
    zeilen.push({ umsetzung: id, szenentyp: st.id, ergebnis });
  }
  const zelle = (e) => {
    const codes = Object.keys(e.fehler).join('+');
    if (e.ok === e.von) return 'ok';
    return e.ok === 0 ? codes : `ok ${e.ok}/${e.von} ${codes}`;
  };
  const text = M.tabelle(zeilen.map((z) => (z.ergebnis ? [z.umsetzung, z.szenentyp, arten.map((a) => `${a}=${zelle(z.ergebnis[a])}`).join(' ')] : [z.umsetzung, '(kein Boden-Szenentyp)'])));
  const mitWh = zeilen.filter((z) => z.ergebnis && ['wildnis', 'hoehle'].some((a) => z.ergebnis[a] && z.ergebnis[a].ok > 0));
  text.push('', `${zeilen.length} Umsetzungen, ${seeds} Seed(s); davon mit mindestens einem ok auf wildnis/hoehle: ${mitWh.length}`);
  return { text, daten: { seeds, arten, zeilen } };
});
