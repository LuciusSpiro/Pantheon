'use strict';
// SUND-02b E: Mutationsprobe zu tools/test-verrat.js (und test-verrat-ws.js für Mutationen mit Marke 'ws'). Kopiert Server, Shared, Content und die Tests in ein Temp-Verzeichnis (das Repo bleibt
// unberührt), ändert dort je Lauf EINE Regel und verlangt, dass der Test rot wird (Exit != 0). Überlebt eine Mutation, deckt der Test die Regel nicht ab.
//   node tools/mutation-verrat.js [--trocken]          (npm run test:verrat-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-mutv-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
for (const t of ['test-verrat.js', 'test-verrat-ws.js']) fs.copyFileSync(path.join(ROOT, 'tools', t), path.join(TMP, 'tools', t));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const V = 'server/sim/verrat.js', S = 'server/sim/kriegslage-szene.js', P = 'server/sim/posten.js', R = 'server/sim/ruf.js', K = 'server/sim/kriegslage.js', G = 'server/game.js';
// Bewusst nicht in der Liste (gleichwertiger Mutant): verratStarten `if (!e) throw new Error('Gegner nicht erzeugt')` – space.spawnEnemy liefert nie null (ohne Klassendaten wirft es vorher), der Zweig ist Absicherung;
// ohne ihn würfe Object.assign(null, …) und der Rollback griffe genauso (gleiches Ergebnis, derselbe Fehlerzähler).
// Bewusst nicht in der Liste (gleichwertiger Mutant): verratStarten `|| S.modus === 'verrat'` – nach der Umschaltung sind die Verbündeten der Szene aus der Liste, `!ex.length` fängt jede zweite Umschaltung ohnehin (Test: zweiter Aufruf liefert null);
// der Prüfer vorher (`schon`) ist der eigentliche Wächter und wird von der Mutation „Weigerung: Verrat läuft schon“ erfasst.
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, 'ws'?]
const MUTATIONEN = [
  // Bedingungen und Weigerungsgründe (verrat.js)
  [V, "  if (!game.weltsim) return fehl('modus');\n", "", 'Weigerung: Modus (Kampagne, Limes) wird nicht geprüft'],
  [V, "  if (S.modus === 'verrat') return fehl('schon');\n", "", 'Weigerung: Verrat läuft schon – nicht geprüft'],
  [V, "  if (!W.phasen.wert.includes(S.phase)) return fehl('phase');\n", "", 'Weigerung: Phase (Daten) wird nicht geprüft'],
  [V, "  if (!laufend && game.ship.docked) return fehl('docked');\n  if (!verbuendete(game, S).length) return fehl('keine_verbuendeten');", "  if (!verbuendete(game, S).length) return fehl('keine_verbuendeten');", 'Weigerung: angedockt wird nicht abgewiesen'],
  [V, "  if (!verbuendete(game, S).length) return fehl('keine_verbuendeten');\n  if (transferAus", "  if (transferAus", 'Weigerung: ohne Verbündete wird nicht abgewiesen'],
  [V, "  if (transferAus(game)) return fehl('transfer');\n", "", 'Weigerung: Transfer-Ausfall wird nicht geprüft'],
  [V, "  if (!laufend) { const s = Fracht.state(game); if (s.halt) return fehl('laeuft'); }\n", "", 'Weigerung: „ein Transfer läuft“ wird nicht geprüft'],
  [V, "q.ally && S && q.sim === S.id && E.active(q)", "q.ally && S && E.active(q)", 'Verbündete: auch die der Kampagne/von Eisenwald zählen (nicht nur es.sim)'],
  [V, "q.ally && S && q.sim === S.id && E.active(q)", "q.ally && S && q.sim === S.id", 'Verbündete: auch zerstörte zählen'],
  // Halteprozess
  [V, "  s.halt = { kind: 'posten', id: 'verrat', t: 0, dur: W.anlauf.wert.dauer, hex: game.simSzene.hex };", "  s.halt = { kind: 'posten', id: 'verrat', t: 0, dur: 0.05, hex: game.simSzene.hex };", 'Anlaufdauer ignoriert die Daten'],
  [V, "  sz().funk(game, text('anlauf', { sek: Math.round(s.halt.dur) }), { reiter: 1 });\n", "", 'keine Warnung im Funk beim Anlauf'],
  [V, "  const e = pruefen(game, true);\n  return e ? { code: e.code, text: abbruchText(e.code) } : null;", "  return null;", 'Halteprozess bricht nie ab (Szene vorbei, Transfer, keine Verbündeten)'],
  [V, "  if (!S || S.hex !== h.hex) return { code: 'szene', text: abbruchText('keine_szene') };\n", "", 'Halteprozess prüft den Ort der Szene nicht'],
  [V, "  const k = { szene: 'sprung', taktik: 'ops', abgebrochen: 'abgebrochen' }[grund];", "  const k = null;", 'Abbruchtexte (Sprung, Ops, Knopf) fehlen'],
  [V, "  game.emit('frachtBeamen', { phase: 'start', was: 'posten', dur: s.halt.dur });\n", "  game.emit('frachtBeamen', { phase: 'start', was: 'posten', dur: s.halt.dur });\n  kl().rufBuchen(game, Ruf.verratBeginn());\n", 'Ruf sinkt schon im Halteprozess (statt bei Auslösung)'],
  [V, "  if (beginn.some((wk) => !Kern.pruefeWirkung(z, wk).ok)) {", "  if (false) {", 'Ruf-Prüfung vor der Umschaltung fehlt'],
  // Auslösung
  [V, "  const r = kl().rufBuchen(game, beginn);\n", "  const r = { ok: true };\n", 'kein Ruf-Abzug bei der Auslösung'],
  [V, "  sz().funk(game, text('feinde', { n: S.verrat.n0 }));\n", "", 'kein Funk „ehemalige Verbündete gehen vor“'],
  [V, "  ws.verrat = { n: alt.n + 1, tick: ws.tickZahl, hex };", "  void alt;", 'Gedächtnis wird nicht gesetzt'],
  [V, "{ n: Math.floor(b.n),", "{ n: 1,", 'Leser des Gedächtnisses: n verloren'],
  [V, "  if (!h || h.kind !== 'posten' || h.id !== 'verrat') return null;", "  return null;", 'Szenenzeile: keine Warnung für alle Spieler (w)'],
  [V, "  const out = { k: 'v', ok: e ? 0 : 1 };", "  const out = { k: 'x', ok: e ? 0 : 1 };", 'space.po: falsche Art'],
  [V, "  if (!verbuendete(game, S).length) return null;\n  const e = pruefen(game, false);", "  const e = pruefen(game, false);", 'space.po auch ohne Verbündete (Knopf ohne Ziel)'],
  [V, "w.chronicle(text('chronik'", "w.chronicle(text('nix'", 'Chronik ohne Text'],
  // Kopplung
  [P, "  if (h.id === 'verrat') return require('./verrat.js').haltFertig(game, h);   // SUND-02b E\n", "", 'posten.haltFertig leitet den Verrat nicht weiter'],
  [P, "  if (h.id === 'verrat') return require('./verrat.js').haltWeiter(game, h);   // SUND-02b E: Beschuss auf römische Verbündete (eigene Bedingungen: Szene statt Ring und Tempo)\n", "", 'posten.haltWeiter leitet den Verrat nicht weiter'],
  [P, "  if (h.id === 'verrat') return require('./verrat.js').stummerAbbruchText(h, grund);   // SUND-02b E\n", "", 'posten.stummerAbbruchText leitet den Verrat nicht weiter'],
  [G, "      case 'weapons.verrat.beginnen': err = Verrat.verratStart(this, p); break;", "", 'Befehl weapons.verrat.beginnen fehlt', 'ws'],
  [G, "const po = Posten.snapshot(this) || Verrat.snapshot(this); if (po)", "const po = Posten.snapshot(this); if (po)", 'space.po zeigt den Verrat-Knopf nie'],
  [K, "  if (ws.verrat && ws.verrat.n >= 1) b.verrat = { n: ws.verrat.n, tick: ws.verrat.tick, hex: ws.verrat.hex };", "", 'Speichern vergisst das Gedächtnis'],
  [K, "  game.weltsim.verrat = Verrat.lesen(b.verrat);", "  game.weltsim.verrat = null;", 'Laden vergisst das Gedächtnis'],
  [K, "    ws.ruf = sicher;\n    if (game.countError) game.countError('kriegslage-ruf', e);\n    return { ok: false, angewandt: 0, vorher: null, nachher: null };", "    if (game.countError) game.countError('kriegslage-ruf', e);\n    return { ok: false, angewandt: 0, vorher: null, nachher: null };", 'rufBuchen: kein Rollback bei einem Wurf'],
  [K, "  const gueltig = (Array.isArray(wirkungen) ? wirkungen : []).filter((w) => w && w.typ === 'ruf_aenderung' && Kern.pruefeWirkung(ws.zustand, w).ok).map(klon);", "  const gueltig = [];", 'rufBuchen: bucht nichts'],
  ['content/schema/weltstand.schema.json', '            "verrat": {\n', '            "verrat_x": {\n', 'Schema kennt welt.sim.verrat nicht'],
  ['server/sim/space.js', "  if (!e.ohneBeute) game.inventory.marks += C.enemies[e.kind].salvage;", "  game.inventory.marks += C.enemies[e.kind].salvage;", 'Lohn: ehemalige Verbündete geben Marken'],
  // Ruf (ruf.js, Daten)
  [R, "const verratBeginn = () => quelle('verrat_beginn');", "const verratBeginn = () => [];", 'Ruf: verrat_beginn gibt nie einen Abzug'],
  [R, "const verratVernichtet = () => quelle('verrat_flotte_vernichtet');", "const verratVernichtet = () => [];", 'Ruf: verrat_flotte_vernichtet gibt nie einen Abzug'],
  ['content/welt/ruf-werte.json', '"verrat_beginn":          {"fraktion": "rom", "delta": -12,', '"verrat_beginn":          {"fraktion": "rom", "delta": 12,', 'Daten: Verrat gibt Ruf (positiv)'],
  ['content/welt/ruf-werte.json', '"verrat_flotte_vernichtet": {"fraktion": "rom", "delta": -6,', '"verrat_flotte_vernichtet": {"fraktion": "rom", "delta": 6,', 'Daten: Sieg im Verrat gibt Ruf (positiv)'],
  ['content/welt/ruf-werte.json', '"delta": -12, "folge": {"ger": 0}, "_hinweis": "SUND-02b E: Die Crew eroeffnet', '"delta": -12, "_hinweis": "SUND-02b E: Die Crew eroeffnet', 'Daten: folge-Feld für spätere Fraktionen fehlt'],
  ['content/welt/verrat-werte.json', '"phasen": {"wert": ["vorwarnung", "kampf"]', '"phasen": {"wert": ["kampf"]', 'Daten: Vorwarnung nicht mehr erlaubt'],
  ['content/welt/verrat-werte.json', '"anlauf": {"wert": {"dauer": 7}', '"anlauf": {"wert": {"dauer": 0}', 'Daten: Anlauf ohne Dauer'],
  ['content/flotte/verrat.json', '"abgebrochen": "Der Angriff auf die römischen Schiffe ist abgebrochen. Nichts ist geschehen."', '"abgebrochen": "Ok."', 'Text: Abbruch sagt nicht, dass nichts geschehen ist'],
  // Szene (kriegslage-szene.js)
  [S, "    f = v0 + (f - v0) * Verrat.faktor();", "    f = v0 + (f - v0);", 'Stellschraube verlust.faktor wirkt im Verrat nicht'],
  [V, "return Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : 1; }", "return Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : 0; }", 'verlust.faktor: Müllwert gilt als 0 statt 1'],
  [S, "  if (S.modus === 'verrat') return verratSieg(game, S);\n", "", 'Sieg im Verrat: normaler Szenen-Sieg'],
  [S, "  if (S.modus === 'verrat') return verratNiederlage(game, S, grund);\n", "", 'Niederlage im Verrat: normale Szenen-Niederlage'],
  [S, "    S.vor = S.modus || 'normal'; S.modus = 'verrat';", "    S.vor = S.modus || 'normal';", 'Szene wird nicht auf den Modus verrat umgeschaltet'],
  [S, "      e.hp = Math.max(1, Math.round(e.hpMax * Math.min(1, Math.max(hmin, q.hp / (q.hpMax || 1)))));", "      e.hp = e.hpMax;", 'Gegner starten mit voller Hülle statt der Quote'],
  [S, "      e.hp = Math.max(1, Math.round(e.hpMax * Math.min(1, Math.max(hmin, q.hp / (q.hpMax || 1)))));", "      e.hp = Math.max(1, Math.round(e.hpMax * Math.min(1, q.hp / (q.hpMax || 1)) * 0.5));", 'Hüllen-Quote halbiert'],
  [S, "tag: SZENEN_TAG + '_verrat', ziel: 'lerche', volk: 'rom' });", "tag: SZENEN_TAG + '_verrat', ziel: 'lerche', volk: 'ger' });", 'Kennung der Gegner nicht rom'],
  [S, "ohneBeute: true, verratS: S.id,", "ohneBeute: false, verratS: S.id,", 'Gegner geben Beute'],
  [S, "    Escort.retreat(game, { tag: SZENEN_TAG }); delete sp.retreatRule;\n", "    delete sp.retreatRule;\n", 'die alten Gegner der Szene bleiben im Kampf'],
  [S, "    for (const e of neue) e.tag = SZENEN_TAG;\n", "", 'neue Gegner tragen nicht den Szenen-Tag (Szenenende lässt sie nicht abziehen)'],
  [S, "    // 4. die Verbündeten verlassen die Liste (wie aufraeumen, nur für diese Szene)\n    sp.escorts = sp.escorts.filter((q) => q.sim !== S.id);", "    // 4. die Verbündeten verlassen die Liste (wie aufraeumen, nur für diese Szene)", 'die Verbündeten bleiben in der Liste'],
  [S, "    S.vert.lebend = 0; S.emBasis = game.stats.emergencies || 0;\n", "", 'Notfallprotokoll zählt im Verrat nicht (lebend bleibt)'],
  [S, "    st.nachschub.length = 0;\n    const w = Flotte.wellenStart(", "    const w = Flotte.wellenStart(", 'Nachschub der alten Welle bleibt'],
  [S, "      S.vert.verloren += e.simPts || 0; S.verrat.tot++;\n      return;", "      S.verrat.tot++;\n      return;", 'Abschüsse im Verrat zählen nicht als Verlust der Römer'],
  [S, "      S.vert.verloren += e.simPts || 0; S.verrat.tot++;\n      return;", "      S.vert.verloren += e.simPts || 0; S.verrat.tot++;", 'Abschüsse im Verrat zählen zusätzlich als Gegnerpunkte'],
  [S, "  if (S.ort && S.vert.n0 > 0 && S.vert.lebend <= 0 && S.modus !== 'verrat') {", "  if (S.ort && S.vert.n0 > 0 && S.vert.lebend <= 0) {", 'Verteidiger-erschöpft-Regel gilt im Verrat (Hafen „bricht“)'],
  [S, "  const w = verlustWirkungen(game, S).concat(S.verrat.tot > 0 ? Ruf.verratVernichtet() : []);", "  const w = verlustWirkungen(game, S);", 'Sieg im Verrat ohne Ruf-Abzug'],
  [S, "  const w = verlustWirkungen(game, S).concat(S.verrat.tot > 0 ? Ruf.verratVernichtet() : []);", "  const w = verlustWirkungen(game, S).concat(Ruf.szeneSieg(S, false));", 'Sieg im Verrat gibt Ruf wie ein normaler Sieg (Ruf-Farmen)'],
  [S, "  const w = verlustWirkungen(game, S);\n  if (S.ort) w.push({ typ: 'ort_gefallen', ort: S.hex, an: S.fraktion });   // Review E", "  const w = verlustWirkungen(game, S).concat(Ruf.verratVernichtet());\n  if (S.ort) w.push({ typ: 'ort_gefallen', ort: S.hex, an: S.fraktion });   // Review E", 'Niederlage im Verrat kostet zusätzlich Ruf'],
  [S, "const ruf = imKampf && S.modus !== 'angriff' && S.modus !== 'verrat' ?", "const ruf = imKampf && S.modus !== 'angriff' ?", 'Flucht im Verrat kostet zusätzlich Fahrerflucht-Ruf'],
  [S, "    if (S.modus === 'verrat') x.vt = 1;", "", 'Szenenzeile kennt den Verrat nicht (vt)'],
  [S, "    if (wa) x.w = wa;", "", 'Szenenzeile ohne Warnung (w)'],
  [S, "p: 's', o: null, vt: 1 };", "p: 's', o: null };", 'Ergebniszeile Sieg ohne vt'],
  [S, "p: 'n', o: null, vt: 1 };", "p: 'n', o: null };", 'Ergebniszeile Niederlage ohne vt'],
  [S, "    if (S.modus === 'verrat') return Object.assign({ p: 'k', g }, x);", "", 'Verrat zeigt das Finale statt Kampf'],
  [S, "    st.welle = sicher.welle; st.nachschub = sicher.nachschub;\n", "", 'Rollback der Umschaltung stellt die Welle nicht wieder her'],
  [S, "    sp.enemies = sicher.enemies;", "    sp.enemies = sp.enemies;", 'Rollback der Umschaltung lässt neue Gegner im Raum'],
  [S, "  if (!ex.length || ex.some((q) => !C.enemies[q.kind])) return null;", "  if (!ex.length) return null;", 'verratStarten: unbekannte Klasse wird nicht abgefangen (Wurf statt null)'],
  // ---- Review E (E-Fix) ----
  [V, "  if (!anfrageRest(game)) {\n", "  if (false) {\n", 'Bestätigung: der erste Druck beginnt gleich den Anlauf'],
  [V, "a.bis > game.time && a.bis - game.time <= f ?", "a.bis - game.time <= f ?", 'Bestätigung: die Anfrage verfällt nie'],
  [V, "a && game.simSzene && a.szene === game.simSzene.id &&", "a && game.simSzene &&", 'Bestätigung: Anfrage einer anderen Szene gilt'],
  [V, "  game.verratAnfrage = null;\n  const s = Fracht.state(game);", "  const s = Fracht.state(game);", 'Bestätigung: Anfrage wird nicht verbraucht'],
  [V, "  const b = anfrageRest(game); if (b > 0) out.b = Math.ceil(b);", "", 'space.po zeigt die offene Bestätigung nicht (b)'],
  [V, "  if (sp.hexe.includes(S.hex)) return fehl('hauptwelt');\n", "", 'Sperre: Hauptwelt wird nicht abgewiesen'],
  [V, "(S.ort === 'hafen' ? nd.abwehr : nd.garnison) < sp.abwehr_min) return fehl('abwehr');", "(S.ort === 'hafen' ? nd.abwehr : nd.garnison) < 0) return fehl('abwehr');", 'Sperre: Ort mit letzter Kraft wird nicht abgewiesen'],
  [V, "  const abzug = r.ok ? Math.round((ruf0 - Ruf.ruf(game, 'rom')) * 100) / 100 : 0;", "  const abzug = Math.abs(beginn[0].delta);", 'Funk nennt den Soll-Abzug statt des tatsächlichen'],
  [V, "  const k = { transfer: 'transfer', szene: 'sprung', taktik: 'ops', abgebrochen: 'abgebrochen' }[grund];\n  const x = (k && (texte().abbruch || {})[k]) || t;\n  if (x && game.simSzene) sz().funk(game, x);", "  void t; void grund;", 'Abbruch steht nicht im Lagefunk'],
  [V, "function faktorText() { const f = faktor(); return f < 1 ?", "function faktorText() { const f = faktor(); return f < 0 ?", 'kein Hinweis, dass nur ein Teil der Verluste gilt'],
  [V, "Math.min(1, Math.max(0, f))", "Math.max(0, f)", 'Faktor nicht auf 1 begrenzt'],
  [V, "tick: Number.isFinite(b.tick) && b.tick >= 0 ?", "tick: Number.isFinite(b.tick) ?", 'Leser akzeptiert negativen Tick'],
  [V, "Math.ceil(h.dur - h.t)", "Math.ceil(h.dur)", 'Warnzähler läuft nicht herunter'],
  ['server/sim/fracht.js', "  if (h.kind === 'posten' && h.id === 'verrat') require('./verrat.js').abbruchFunk(game, text, grund);", "", 'fracht.beamStop meldet den Verrat-Abbruch nicht in den Lagefunk'],
  ['server/game.js', "        if (e.verratS && e.name) o.nm = String(e.name).slice(0, 20);", "", 'Snapshot ohne Namen der ehemaligen Verbündeten (nm)'],
  [K, "  ws.wirkungenAngewandt += gueltig.length;\n  try { Ruf.meldeRang", "  try { Ruf.meldeRang", 'rufBuchen zählt die Wirkung nicht'],
  [S, "    const v0 = Math.min(1, (S.vert.verloren0 || 0) / S.vert.ges);\n    f = v0 + (f - v0) * Verrat.faktor();", "    f = f * Verrat.faktor();", 'Faktor gilt auch für Verluste vor der Umschaltung (Verrat schützt Rom)'],
  [S, "    S.vert.verloren0 = S.vert.verloren;", "", 'Stand bei der Umschaltung wird nicht gemerkt'],
  [S, "  if (S.ort) w.push({ typ: 'ort_gefallen', ort: S.hex, an: S.fraktion });   // Review E", "  if (false) w.push({ typ: 'ort_gefallen', ort: S.hex, an: S.fraktion });   // Review E", 'Niederlage im Verrat: kein ort_gefallen (Verrat rettet den Hafen)'],
  [S, "  funk(game, Verrat.faktorText());\n  merken(game, S, 'sieg', wirk, { verrat: true", "  merken(game, S, 'sieg', wirk, { verrat: true", 'Sieg sagt nichts zum Faktor'],
  [S, "    for (const e of sp.enemies) if (e.tag === SZENEN_TAG && !e.verratS) e.ohneBeute = true;", "", 'abziehende Gegner der Szene geben im Verrat Beute'],
  [S, "S.finale = true; S.flaggGefallen = false;", "S.finale = false; S.flaggGefallen = false;", 'Finale-Meldung des alten Kommandanten mitten im Verrat'],
  [S, "    if (sp.escortsGone) sp.escortsGone = sp.escortsGone.filter((g) => !String(g.tag || '').startsWith('sz' + S.id + '_'));\n    // 5.", "    // 5.", 'escortsGone der Szene wird nicht bereinigt'],
  [S, "  endeAufraeumen(game);\n  if (!r.ok) return gescheitert(game, S, 'sieg', wirk, r);\n  funk(game, Verrat.text('sieg')", "  if (!r.ok) return gescheitert(game, S, 'sieg', wirk, r);\n  funk(game, Verrat.text('sieg')", 'verratSieg räumt die Szenen-ODA nicht weg'],
  [S, "  funk(game, (T.niederlage || {})[grund]);\n  funk(game, Verrat.text('niederlage')", "  funk(game, Verrat.text('niederlage')", 'Niederlage im Verrat nennt den Grund nicht'],
  [S, "S.verrat.tot > 0 ? Ruf.verratVernichtet()", "S.verrat.tot > 1 ? Ruf.verratVernichtet()", 'Abzug „vernichtet“ erst ab zwei Abschüssen'],
  [S, "const hmin = Number(Verrat.W.huelle_min.wert);", "const hmin = 0.5;", 'Mindest-Hülle fest statt aus den Daten'],
  ['content/welt/verrat-werte.json', '"hexe": ["0204"]', '"hexe": []', 'Daten: Hauptwelt nicht gesperrt'],
];

// --trocken: nur der Anker-Check (jeder Anker genau einmal im Quelltext der Kopie, sonst Exit 2); die Tests laufen nicht
if (process.argv.includes('--trocken')) {
  const schlecht = [];
  for (const [datei, alt, neu, was, zusatz] of MUTATIONEN) {
    let text;
    try { text = fs.readFileSync(path.join(TMP, datei), 'utf8').replace(/\r\n/g, '\n'); } catch (e) { schlecht.push(was + ': Datei fehlt (' + datei + ')'); continue; }
    const n = text.split(alt).length - 1;
    if (n !== 1) { schlecht.push(was + (n === 0 ? ': Anker nicht gefunden' : ': Anker ' + n + 'x gefunden') + ' (' + datei + ')'); continue; }
    if (Array.isArray(zusatz) && !text.replace(alt, () => neu).includes(zusatz[0])) schlecht.push(was + ': zweiter Anker nicht gefunden (' + datei + ')');
  }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
  if (schlecht.length) { console.log(`Anker-Check: ${schlecht.length} von ${MUTATIONEN.length} Mutationen nicht anwendbar:\n  ` + schlecht.join('\n  ')); process.exit(2); }
  console.log(`Anker-Check: alle ${MUTATIONEN.length} Anker genau einmal gefunden.`);
  process.exit(0);
}

let ueberlebt = 0;
console.log(`Mutationsprobe test-verrat.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
const lauf = (ws) => spawnSync(process.execPath, [ws ? 'tools/test-verrat-ws.js' : 'tools/test-verrat.js'], { cwd: TMP, encoding: 'utf8', timeout: 600000, env: Object.assign({}, process.env, ws ? { PORT: '0' } : {}) });
const basis = lauf(false);
console.log(`  Ausgangslage (unverändert): ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 5).join('\n')); process.exit(1); }
const basisWs = lauf(true);
console.log(`  Ausgangslage Mehrspieler: ${basisWs.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
if (basisWs.status !== 0) { console.log((basisWs.stdout || '').split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 5).join('\n')); process.exit(1); }
const NUR = process.argv.indexOf('--nur') > 0 ? process.argv[process.argv.indexOf('--nur') + 1] : null;   // nur Mutationen, deren Beschreibung den Text enthaelt
for (const [datei, alt, neu, was, ws] of MUTATIONEN) {
  if (NUR && !was.includes(NUR)) continue;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  if (text.split(alt).length !== 2) { console.log(`  ?? ${was}: Textstelle nicht eindeutig gefunden (${datei})`); ueberlebt++; continue; }
  const mut = text.replace(alt, () => neu);
  fs.writeFileSync(f, nl ? mut.replace(/\n/g, '\r\n') : mut);
  let r = lauf(false);
  if (r.status === 0 && ws) r = lauf(true);
  fs.writeFileSync(f, orig);
  const rot = r.status !== 0;
  const fehler = (r.stdout || '').split('\n').filter((l) => /FEHLER/.test(l));
  if (!rot) ueberlebt++;
  console.log(`  ${rot ? 'rot  ' : 'GRÜN '} ${was}${rot ? ` (${fehler.length} Fehler, z. B. ${(fehler[0] || 'Absturz').replace(/^\s*FEHLER\s*/, '').slice(0, 70)})` : '  <-- ÜBERLEBT'}`);
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(ueberlebt ? `${ueberlebt} Mutation(en) überlebt` : 'alle Mutationen erkannt');
process.exit(ueberlebt ? 1 : 0);
