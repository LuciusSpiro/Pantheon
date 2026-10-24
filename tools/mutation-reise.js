'use strict';
// SUND-03 D: Mutationsprobe zu tools/test-reise-ereignis.js, test-chronik.js, test-lage-wiederholung.js und test-lage-ausschnitt.js. Kopiert Server, Shared, Content und die Tests in ein Temp-Verzeichnis
// (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel und verlangt, dass mindestens einer der Tests rot wird (Exit != 0). Überlebt eine Mutation, deckt kein Test die Regel ab.
//   node tools/mutation-reise.js [begriff …]      (npm run test:reise-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-reise-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TESTS = [['tools/test-reise-ereignis.js'], ['tools/test-chronik.js'], ['tools/test-lage-wiederholung.js'], ['tools/test-lage-ausschnitt.js']];
for (const [t] of TESTS) fs.copyFileSync(path.join(ROOT, t), path.join(TMP, t));
fs.copyFileSync(path.join(ROOT, 'tools', 'regie-fixture.js'), path.join(TMP, 'tools', 'regie-fixture.js'));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const RE = 'server/sim/reise-ereignis.js', CH = 'server/sim/chronik.js', WH = 'server/sim/lage-wiederholung.js', RS = 'server/sim/reise.js', SP = 'server/sim/sprung.js', KL = 'server/sim/kriegslage.js',
  L = 'server/sim/lage-ausschnitt.js', LS = 'server/sim/lage-spielleiter.js', SZ = 'server/sim/kriegslage-szene.js', AB = 'server/sim/absicht.js',
  DW = 'content/reise/werte.json', DK = 'content/reise/ereignisse.json', DR = 'content/welt/ruf-werte.json', DC = 'content/welt/chronik-werte.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
// Bewusst nicht in der Liste (äquivalente Mutanten): „min_abstand_spruenge in den Daten kleiner“ (der Code nimmt nie weniger als 3; geprüft wird das mit anderen Mitteln: ABSTAND_HART und der Test mit Abstand 1),
// „Notruf-Antwort ohne return“ (der Abstand verhindert im selben Sprung ohnehin ein zweites Ereignis).
const MUTATIONEN = [
  // ---- Rate
  [RE, "  if (R.letzter != null && R.n - R.letzter < abstandSpruenge()) return null;   // Rate: hart", "", 'Rate: kein Mindestabstand'],
  [RE, "const abstandSpruenge = () => Math.max(ABSTAND_HART, Math.floor(Number(WERTE.min_abstand_spruenge)) || 0);", "const abstandSpruenge = () => Math.floor(Number(WERTE.min_abstand_spruenge)) || 0;", 'Rate: der Abstand ist nicht mehr hart im Code'],
  [RE, "const ABSTAND_HART = 3;", "const ABSTAND_HART = 2;", 'Rate: harter Abstand 2 statt 3'],
  [RE, "  if (!(rng() < WERTE.wahrscheinlichkeit)) return null;", "  if (!(rng() > WERTE.wahrscheinlichkeit)) return null;", 'Rate: Wahrscheinlichkeit verkehrt'],
  [DW, '"wahrscheinlichkeit": {"wert": 0.2', '"wahrscheinlichkeit": {"wert": 0.9', 'Daten: Wahrscheinlichkeit 0,9 (viel zu oft)'],
  [DW, '"wahrscheinlichkeit": {"wert": 0.2', '"wahrscheinlichkeit": {"wert": 0.02', 'Daten: Wahrscheinlichkeit 0,02 (viel zu selten)'],
  [RE, "  R.n++;\n  return R.n;", "  return R.n;", 'Rate: der Sprungzähler zählt nicht'],
  [RE, "  if (R) R.letzter = R.n;\n}", "}", 'Abfangen: zählt nicht für den Abstand'],
  [RS, "  ReiseEreignis.abfangenVermerken(game);", "  void 0;", 'Abfangen: reise.js meldet es nicht'],
  [RE, "  R.letzter = R.n;\n  R.letzte.push(", "  R.letzte.push(", 'Rate: ein Ereignis merkt seinen Sprung nicht'],
  // ---- Zufall
  [RE, "  return () => Zufall.zahl(z);", "  return () => Math.random();", 'Zufall: nicht deterministisch (Math.random)'],
  [RE, "const z = { zufall: Zufall.startzustand(mix(mix(seed, n), salzVon(salz))) };", "const z = { zufall: Zufall.startzustand(mix(mix(seed, 0), salzVon(salz))) };", 'Zufall: der Strom hängt nicht vom Sprung ab'],
  [RE, "const seedVon = (game) => ((Number(game.weltsim.zustand.seed) | 0) ^ 0x52454953) >>> 0;", "const seedVon = (game) => 0x52454953;", 'Zufall: der Seed der Partie zählt nicht'],
  // ---- Wiederholung
  [RE, "if (e.id === letzterId || !passt(e, ctx) || !abstandOk(R, e)) continue;", "if (!passt(e, ctx) || !abstandOk(R, e)) continue;", 'Wiederholung: dieselbe Id zweimal in Folge'],
  [RE, "if (!p || verboten.has(p.schluessel)) continue;", "if (!p) continue;", 'Wiederholung: derselbe Parametersatz'],
  [RE, "R.letzte.slice(-WERTE.wiederholung.fenster).map((x) => x.k)", "R.letzte.slice(-1).map((x) => x.k)", 'Wiederholung: Fenster nur das letzte Ereignis'],
  [RE, "  return R.letzte.every((x) => x.id !== e.id || R.n - x.n >= b.min_abstand);", "  return true;", 'Wiederholung: Mindestabstand je Id'],
  [RE, "  out.schluessel = [e.art, out.variante, out.ort_typ, out.hex].join('|');", "  out.schluessel = [e.art, out.variante, out.ort_typ].join('|');", 'Wiederholung: der Ziel-Hex gehört nicht zum Parametersatz'],
  [RE, "  while (R.letzte.length > WERTE.wiederholung.ring) R.letzte.shift();", "", 'Wiederholung: der Ring wächst ohne Grenze'],
  [DW, '"wiederholung": {"wert": {"fenster": 3,', '"wiederholung": {"wert": {"fenster": 1,', 'Daten: Fenster 1'],
  // ---- Bedingungen
  [RE, "  if (b.besitzer && !b.besitzer.includes(ctx.besitzer)) return false;\n", "", 'Bedingung: Besitzer des Ankunftssektors'],
  [RE, "  if (b.rang_min && ctx.rang < rangIndex(b.rang_min)) return false;\n", "", 'Bedingung: Rang-Mindestwert'],
  [RE, "  if (b.rang_max && ctx.rang > rangIndex(b.rang_max)) return false;\n", "", 'Bedingung: Rang-Höchstwert'],
  [RE, "  if (b.lage && !b.lage.includes(ctx.lage())) return false;\n", "", 'Bedingung: Lagefenster'],
  [RE, "  if (!R || !aktiv(game) || game.simSzene || !hex) return null;", "  if (!R || !aktiv(game) || !hex) return null;", 'Entscheidung: auch während einer Sim-Szene'],
  [RE, "  return require('./lage-spielleiter.js').schalterAn(env) || WERTE.standard_an === true;", "  return true;", 'Schalter: Standard immer an'],
  [RE, "  return require('./lage-spielleiter.js').schalterAn(env) || WERTE.standard_an === true;", "  return WERTE.standard_an === true;", 'Schalter: folgt nicht dem Lage-Spielleiter'],
  // ---- Sim-Notruf, Orte
  [RE, "    const sim = simNotruf(game, hex, p.sim_art);\n    if (sim) {", "    const sim = null;\n    if (sim) {", 'Sim-Notruf: wird nicht aufgenommen'],
  [RE, "    if (ev && ev.art === simArt) return { hex: nr.h, marke: nr.m };", "    if (ev) return { hex: nr.h, marke: nr.m };", 'Sim-Notruf: Art muss nicht passen'],

  [RE, "      if (d >= von && Sektoren.spielbar(nb)", "      if (Sektoren.spielbar(nb)", 'Notruf-Ort: Mindestabstand ignoriert'],
  // ---- Auslösen, Ankündigung, Ausweichen
  [RE, "  funk(game, textFuer(ev, 'ankuendigung'));\n  chronik(game, ev);\n  if (e.gefahr) gefahrPlanen(game, R, ev, false);", "  chronik(game, ev);\n  if (e.gefahr) gefahrPlanen(game, R, ev, false);", 'Ankündigung: Gefahr ohne Funk vorab'],
  [RE, "    if (L.phase === 'erwartet') { if (game.time >= L.ab) eintreffen(game, L); continue; }", "    if (L.phase === 'erwartet') { eintreffen(game, L); continue; }", 'Ankündigung: kein Vorlauf, die Gegner sind sofort da'],
  [RE, "ab: game.time + e.parameter.vorlauf_s, tag:", "ab: game.time + 1, tag:", 'Ankündigung: Vorlauf auf 1 s verkürzt'],
  [RE, "    if (game.ship.scene !== L.szene) { weg(); continue; }", "", 'Ausweichen: die Gefahr kommt auch, wenn die Crew weg ist'],
  [RE, "  funk(game, textFuer(L.ev, 'eintreffen'));\n}", "}", 'Eintreffen: kein Funk'],
  [RE, "  try { game.emit('radio', { from: t.von, text: t.text, lage: 1, r: 1 }); }", "  try { game.emit('radio', { from: t.von, text: t.text, lage: 1, r: 1 }); game.emit('radio', { from: t.von, text: t.text, lage: 1, r: 1 }); }", 'Mehrspieler: Funk doppelt'],
  [RE, "  chronik(game, ev);\n}\nfunction gefahrPlanen", "}\nfunction gefahrPlanen", 'Chronik: Funkmeldung ohne Eintrag'],
  [RE, "{ ort: hexName(ev.hex), n: (e.parameter || {}).vorlauf_s }) };", "{ ort: hexName(ev.hex) }) };", 'Text: Platzhalter {n} bleibt stehen'],
  // ---- Notruf und Folgen
  [RE, "  notrufVerfaellt(game, R, o, 'abgelehnt');   // Ablehnen kostet nichts: keine Wirkung, kein Ruf", "  notrufVerfaellt(game, R, o, 'abgelehnt'); kl().rufBuchen(game, [{ typ: 'ruf_aenderung', fraktion: 'rom', delta: -3, grund: 'reise_hilfe_rom' }]);", 'Ablehnen kostet Ruf'],
  [RE, "  if (e.gefahr) gefahrPlanen(game, R, o.ev, true);\n  else {", "  if (e.gefahr) { gefahrPlanen(game, R, o.ev, true); folgeBuchen(game, e); }\n  else {", 'Folge: der Ruf kommt schon beim Eintreffen, vor dem Kampf'],
  [RE, "      if (L.notruf) { folgeBuchen(game, eintrag(L.id)); funk(game, textFuer(L.ev, 'dank')); }", "      if (L.notruf) { funk(game, textFuer(L.ev, 'dank')); }", 'Folge: nach dem Kampf kein Ruf'],
  [RE, "      if (L.notruf) { folgeBuchen(game, eintrag(L.id)); funk(game, textFuer(L.ev, 'dank')); }", "      if (L.notruf) { folgeBuchen(game, eintrag(L.id)); }", 'Folge: nach dem Kampf kein Dank-Funk'],
  [RE, "    if (!((game.space && game.space.enemies) || []).some((g) => g.tag === L.tag)) {   // bewältigt", "    if (!false) {   // bewältigt", 'Folge: gilt sofort als bewältigt'],
  [RE, "  for (const o of R.offen.slice()) if (o.bis < R.n) notrufVerfaellt(game, R, o, 'unbeantwortet');", "", 'Notruf: verfällt nie'],
  [RE, "  Marken.entferne(game, o.marke);\n  R.offen.splice(R.offen.indexOf(o), 1);\n  Chronik.eintragen(game, { art: 'reise', ref: o.id, kurz: `Notruf bei ${hexName(o.hex)} ${text}`", "  R.offen.splice(R.offen.indexOf(o), 1);\n  Chronik.eintragen(game, { art: 'reise', ref: o.id, kurz: `Notruf bei ${hexName(o.hex)} ${text}`", 'Notruf: die Marke bleibt nach dem Verfall'],
  [RE, "  if (offen) { notrufBeantworten(game, R, offen); return null; }", "  if (offen) { return null; }", 'Notruf: Hinfliegen beantwortet nichts'],
  [DR, '"reise_hilfe_rom":        {"fraktion": "rom", "delta": 2,', '"reise_hilfe_rom":        {"fraktion": "rom", "delta": 30,', 'Daten: Ruf-Folge über dem Prüfer-Maximum'],
  [DK, '"chronik": "Notruf Kutter Fortuna bei {ort}: Havarie",\n      "folge": { "angenommen": ["reise_havarie_rom"], "ablehnen": [] }', '"chronik": "Notruf Kutter Fortuna bei {ort}: Havarie",\n      "folge": { "angenommen": ["reise_hilfe_rom"], "ablehnen": ["reise_havarie_rom"] }', 'Daten: Folge fürs Ablehnen'],
  [DK, '"gefahr": true, "ankuendigung": "funk", "sprecher": "Aufklärung",\n      "texte": {\n        "ankuendigung": [\n          "Aufklärung an Lerche: Rostmeute', '"gefahr": true, "ankuendigung": "keine", "sprecher": "Aufklärung",\n      "texte": {\n        "ankuendigung": [\n          "Aufklärung an Lerche: Rostmeute', 'Daten: Gefahr ohne Ankündigung'],
  [DK, '"parameter": { "variante": "hinterhalt", "schiffe": { "art": "raider", "min": 2, "max": 3 }, "vorlauf_s": 10 }', '"parameter": { "variante": "hinterhalt", "schiffe": { "art": "raider", "min": 2, "max": 3 }, "vorlauf_s": 2 }', 'Daten: Vorlauf unter dem Mindestwert'],
  // ---- Schnellsprung
  [RS, "  if (ereignis) return stop(game, `Schnellsprung unterbrochen: ${ereignis.kurz}`);", "  if (false) return stop(game, `Schnellsprung unterbrochen: ${ereignis.kurz}`);", 'Schnellsprung: kein Abbruch bei einem Ereignis'],
  [SP, "  return ReiseEreignis.nachSprung(game, dest);", "  ReiseEreignis.nachSprung(game, dest);", 'Sprung: das Ereignis wird nicht zurückgegeben'],
  [RS, "  ReiseEreignis.update(game, dt);   // SUND-03 D", "  void dt;   // SUND-03 D", 'Reise: der Vorlauf läuft nie ab'],
  [RS, "  if (ereignis) return stop(", "  if (ereignis) { game.reisePlan = null; } if (ereignis) return stop(", 'Schnellsprung: der Rest der Strecke geht verloren'],
  // ---- Chronik
  [CH, "  while (ws.chronik.length > MAX) ws.chronik.shift();", "", 'Chronik: der Ring wächst ohne Grenze'],
  [CH, "  const kurz = bereinigt(e.kurz, game).replace(/\\s+/g, ' ').trim().slice(0, KURZ_MAX);", "  const kurz = bereinigt(e.kurz, game).replace(/\\s+/g, ' ').trim();", 'Chronik: Texte werden nicht gekürzt'],
  [CH, "const bereinigt = (text, game) => Ausschnitt.ohneNamen(text, Ausschnitt.spielerNamen(game || {}));", "const bereinigt = (text, game) => String(text);", 'Chronik: Spielernamen im Text'],
  [CH, "ref: String(e.ref == null ? '' : e.ref).slice(0, REF_MAX)", "ref: bereinigt(e.ref == null ? '' : e.ref, game).slice(0, REF_MAX)", 'Chronik: der Namensfilter zerstört die Referenz (Spieler „Rom“)'],
  [CH, "if (typeof v === 'string') out[k] = v.slice(0, 24);", "if (typeof v === 'string') out[k] = bereinigt(v, game).slice(0, 24);", 'Chronik: der Namensfilter zerstört param'],
  [CH, "  if (!ws || !istObjekt(e) || !ARTEN.includes(e.art)) return null;", "  if (!ws || !istObjekt(e)) return null;", 'Chronik: unbekannte Arten werden angenommen'],
  [CH, "    if (Object.keys(out).length >= PARAM_MAX) break;", "", 'Chronik: param ohne Obergrenze'],
  [CH, "  return out.slice(-MAX);", "  return out;", 'Chronik: der Leser kürzt nicht'],
  [CH, "    if (!istObjekt(c) || !ARTEN.includes(c.art) || typeof c.kurz !== 'string' || !c.kurz) continue;", "    if (!istObjekt(c)) continue;", 'Chronik: der Leser nimmt Müll'],
  [CH, "  return ws.chronik.map((c) => JSON.parse(JSON.stringify(c)));", "  return null;", 'Chronik: Speichern vergisst alles'],
  [CH, "      case 'posten_gehisst': eintragen(", "      case 'posten_gehisst': void (", 'Chronik: Posten gegründet fehlt'],
  [CH, "        if (crew.has(e.ort)) eintragen(", "        if (!crew.has(e.ort)) eintragen(", 'Chronik: Posten gefallen für fremde Posten'],
  [CH, "  for (const w of gueltig || []) if (w && w.typ === 'posten_gesprengt') eintragen(", "  for (const w of []) if (w && w.typ === 'posten_gesprengt') eintragen(", 'Chronik: Posten gesprengt fehlt'],
  [DC, '"max": {"wert": 40,', '"max": {"wert": 400,', 'Daten: Chronik-Ring 400'],
  [KL, "  try { Chronik.ausTick(game, ev, gueltig, crewPostenVorher); }", "  try { void 0; }", 'Chronik: der Tick meldet nichts an die Chronik'],
  [KL, "  const crewPostenVorher = Object.keys(ws.posten || {});", "  const crewPostenVorher = [];", 'Chronik: gefallene Posten der Crew werden nicht erkannt'],
  [KL, "  const ch = Chronik.toSave(ws); if (ch) b.chronik = ch;", "", 'Weltstand: Speichern vergisst die Chronik'],
  [KL, "  game.weltsim.chronik = Chronik.lesen(b.chronik);", "  game.weltsim.chronik = Chronik.neu();", 'Weltstand: Laden vergisst die Chronik'],
  [KL, "  const re = ReiseEreignis.toSave(ws); if (re) b.reise = re;", "", 'Weltstand: Speichern vergisst den Reise-Zähler'],
  [KL, "  game.weltsim.reise = ReiseEreignis.lesen(b.reise);", "  game.weltsim.reise = ReiseEreignis.neu();", 'Weltstand: Laden vergisst den Reise-Zähler'],
  [RE, "  if (R.letzte.length) b.letzte = R.letzte.map((x) => ({ id: x.id, k: x.k, n: x.n }));", "", 'Weltstand: Speichern vergisst die Wiederholungsdaten'],
  [RE, "  if (Number.isFinite(b.n) && b.n >= 0) R.n = Math.floor(b.n);", "", 'Weltstand: Laden vergisst den Sprungzähler'],
  [RE, "      R.letzte.push({ id: x.id, k: x.k, n: Math.min(Math.floor(x.n), R.n) });", "      R.letzte.push({ id: x.id, k: x.k, n: Math.floor(x.n) });", 'Weltstand: der Leser klemmt die Sprünge nicht'],
  [RE, "typeof x.id !== 'string' || !eintrag(x.id) || ", "typeof x.id !== 'string' || ", 'Weltstand: der Leser nimmt unbekannte Ids'],
  [RE, "  if (Number.isFinite(b.letzter) && b.letzter >= 0) R.letzter = Math.min(Math.floor(b.letzter), R.n);", "", 'Weltstand: Laden vergisst den letzten Sprung'],
  [RE, "  if (!R || !R.n) return null;", "  if (!R) return null;", 'Weltstand: der Ruhezustand schreibt einen Block'],
  // ---- Quellen der Chronik
  [SZ, "  chronikEintrag(game, S, ausgang);\n}", "}", 'Chronik: Szenen-Ausgänge fehlen'],
  [AB, "  Chronik.eintragen(game, { art: 'absicht', ref: a.id,", "  void ({ art: 'absicht', ref: a.id,", 'Chronik: gewählte Absicht fehlt'],
  [AB, "  Chronik.eintragen(game, { art: 'absicht', ref: ids,", "  void ({ art: 'absicht', ref: ids,", 'Chronik: abgelehntes Angebot fehlt'],
  [LS, "    Chronik.eintragen(this.game, { art: 'plan',", "    void ({ art: 'plan',", 'Chronik: angewandte Pläne fehlen'],
  // ---- Ausschnitt
  [L, ".slice(-st.chronik).map((c) => `${c.t}: ${ohneNamen(c.kurz, namen)}`", ".slice(-99).map((c) => `${c.t}: ${ohneNamen(c.kurz, namen)}`", 'Ausschnitt: die ganze Chronik statt der letzten Einträge'],
  [L, "`${c.t}: ${ohneNamen(c.kurz, namen)}`", "`${c.t}: ${c.kurz}`", 'Ausschnitt: Namen aus der Chronik bleiben stehen'],
  [L, "`${c.t}: ${ohneNamen(c.kurz, namen)}`", "ohneNamen(`${c.t}: ${c.kurz}`, namen)", 'Ausschnitt: der Namensfilter trifft auch den Tick (Spieler „12“)'],
  [L, "  const chronik = (ws.chronik || []).slice(", "  const chronik = [].slice(", 'Ausschnitt: liest die Chronik nicht'],
  // ---- Wiederholungsregeln der Pläne
  [WH, "    if (s && !ausnahmen.includes(b.typ) && bekannt.has(s)) abgelehnt.push", "    if (false) abgelehnt.push", 'Pläne: Wiederholungen gehen durch'],
  [WH, "    if (s && !ausnahmen.includes(b.typ) && bekannt.has(s))", "    if (s && bekannt.has(s))", 'Pläne: Ausnahmen gelten nicht'],
  [WH, "    if (s && !ausnahmen.includes(b.typ) && bekannt.has(s))", "    if (s && !ausnahmen.includes(b.typ) && [...bekannt].some((x) => x.startsWith(b.typ + ':')))", 'Pläne: der Typ allein genügt (Parametersatz ignoriert)'],
  [WH, "  const fenster = Math.max(0, Math.floor(w.fenster_plaene) || 0);", "  const fenster = Math.min(1, Math.max(0, Math.floor(w.fenster_plaene) || 0));", 'Pläne: Fenster nur der letzte Plan'],
  [WH, "  if (istObjekt(fokus) && !ausnahmen.includes('fokus') && bekannt.has(fokusSatz(fokus)))", "  if (false)", 'Pläne: Plan-Fokus wird nie als Wiederholung erkannt'],
  [WH, "  const out = (Array.isArray(plan && plan.befehle) ? plan.befehle : []).filter((b) => !weg.has(b))", "  const out = (Array.isArray(plan && plan.befehle) ? plan.befehle : []).filter(() => true)", 'Pläne: der Verlauf nimmt auch abgelehnte Befehle'],
  [WH, "  return b.typ + ':' + JSON.stringify(kanon(Object.fromEntries(Object.entries(b).filter(([k]) => k !== 'typ'))));", "  return b.typ;", 'Pläne: der Satz kennt keine Parameter'],
  [LS, "    const wh = Wiederholung.pruefen(gelesen.plan, this.verlauf, this.W);", "    const wh = { plan: gelesen.plan, abgelehnt: [] };", 'Pläne: der Spielleiter prüft keine Wiederholungen'],
  [LS, "    this.wiederholungenMelden(wh.abgelehnt);", "", 'Pläne: Wiederholungen stehen nicht im Regie-Logbuch'],
  [LS, "    this.verlauf.push(Wiederholung.verlaufEintrag(wh.plan, res));", "", 'Pläne: der Verlauf wird nicht geführt'],
  [LS, "abgelehnt: res.abgelehnt.length + wh.abgelehnt.length,", "abgelehnt: res.abgelehnt.length,", 'Pläne: abgelehnte Wiederholungen zählen nicht in letzte_plaene'],
  [LS, "    while (this.verlauf.length > Math.max(1, this.W.wiederholung.fenster_plaene)) this.verlauf.shift();", "", 'Pläne: der Verlauf wächst ohne Grenze'],
];

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const lauf = ([test, ...arg]) => spawnSync(process.execPath, [test, ...arg], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
const rot = (r) => r.status !== 0;
let ueberlebt = 0, gelaufen = 0;
console.log(`Mutationsprobe test-reise-ereignis.js, test-chronik.js, test-lage-wiederholung.js, test-lage-ausschnitt.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
for (const t of TESTS) {
  const basis = lauf(t);
  console.log(`  Ausgangslage ${t.join(' ')}: ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
  if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
}
for (const [datei, alt, neu, was] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  if (text.split(alt).length !== 2) { console.log(`  ?? ${was}: Textstelle nicht eindeutig gefunden (${datei})`); ueberlebt++; continue; }
  fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
  let wer = null, r = null;
  for (const t of TESTS) { r = lauf(t); if (rot(r)) { wer = path.basename(t[0], '.js').replace('test-', ''); break; } }
  fs.writeFileSync(f, orig);
  const fehler = ((r && r.stdout) || '').split('\n').filter((l) => /FEHLER/.test(l));
  if (!wer) ueberlebt++;
  console.log(`  ${wer ? 'rot  ' : 'GRÜN '} ${was}${wer ? ` (${wer}: ${fehler.length} Fehler, z. B. ${(fehler[0] || 'Absturz').replace(/^\s*FEHLER\s*/, '').slice(0, 64)})` : '  <-- ÜBERLEBT'}`);
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) überlebt` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
