'use strict';
// SUND-04b E1/E2/E3: Mutationsprobe zu tools/test-abenteuer-kanon.js (Kanon: server/sim/abenteuer-kanon.js, Wiederholungsregeln: server/sim/abenteuer-wiederholung.js, die Haken in faden.js, faden-pruefer.js, abenteuer-brett.js,
// abenteuer-spielleiter.js und abenteuer-prompt.js, Daten b1-texte.json, abenteuer-brett.json und das Weltstand-Schema). Kopiert Server, Shared, Content und den Test in ein Temp-Verzeichnis (das Repo bleibt unberuehrt), aendert dort je Lauf
// EINE Regel und verlangt, dass der Test rot wird (Exit != 0 mit mindestens einer FEHLER-Zeile). Ueberlebt eine Mutation, deckt der Test die Regel nicht ab. Selbstcheck: VOR jedem Lauf muss jede Mutation anwendbar sein
// (Anker genau einmal im Quelltext der Kopie), sonst bricht die Probe mit Exit 2 ab.
//   node tools/mutation-abenteuer-e.js [begriff ...] [--trocken]      (npm run test:abenteuer-kanon-mutation)
// Bewusst nicht in der Liste (aequivalente Mutanten): die Zahlen der Daten (kanon_max, wiederholung): der Test liest sie aus derselben Datei (nur das Verhaeltnis kanon_max zur Liste hat eine zweite Erwartung); NICHT_MODELL in
// abenteuer-spielleiter.js (braucht einen Router mit Eskalation: die Eskalation hat test-abenteuer.js); das Weglassen des Titelschnitts (titelMax) im Kanon (der Plan ist schon auf 60 Zeichen geprueft); die Namen der Faeden der Liste in namenVergeben
// (der Kanon enthaelt jeden Faden der Liste ohnehin); der Schutz "ohne Ort" in sperreBeginn (ohne Ort gibt es auch ohne ihn keinen Treffer); die Bedingung "nur der Kanon" in Faden.toSave (die Liste ist nie leer, solange der Kanon nicht leer ist); die Kandidatenpruefung in passt (abenteuer-brett.js) ersetzt durch die rohe Liste (pruefeGelockert prueft dieselbe Hauptfigur schon auf den Stufen 0 bis 2, ab Stufe 3 sind beide Listen gleich); ihr Entfernen ist dagegen eine Mutation (Stufe 3 ohne Kandidat).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-e-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TESTS = [['tools/test-abenteuer-kanon.js']];
for (const [t] of TESTS) fs.copyFileSync(path.join(ROOT, t), path.join(TMP, t));
for (const h of ['regie-fixture.js', 'faden-fixture.js', 'gegner-testhilfe.js', 'katalog.js', 'messe-abenteuer-plaene.js']) fs.copyFileSync(path.join(ROOT, 'tools', h), path.join(TMP, 'tools', h));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul noetig */ } }

const FA = 'server/sim/faden.js', BRT = 'server/sim/abenteuer-brett.js', GM = 'server/game.js', AS = 'server/sim/abenteuer-spielleiter.js', AJ = 'content/faeden/anschluss.json', BJ = 'content/faeden/abenteuer-brett.json';   // (die Mutationen nennen die Pfade selbst)
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  ["server/sim/abenteuer-kanon.js","if (e.ausgang !== undefined) {   // KANON_AUSGANG","if (false) {   // KANON_AUSGANG","Kanon Ende: ein zweiter Ausgang ueberschreibt den ersten"],
  ["server/sim/abenteuer-kanon.js","if (!F || !f || !W.ausgaenge.includes(ausgang)) return false;","if (!F || !f) return false;","Kanon Ende: ein unbekannter Ausgang wird eingetragen"],
  ["server/sim/abenteuer-kanon.js","  e.ort_ende = f.parameter && HEX.test(f.parameter.ort || '') ? f.parameter.ort : '';\n  e.status = f.nsc.status;","  e.ort_ende = '';\n  e.status = f.nsc.status;","Kanon Ende: der Ort am Ende fehlt"],
  ["server/sim/abenteuer-kanon.js","  e.status = f.nsc.status;\n  return true;","  return true;","Kanon Ende: der Zustand des NSC fehlt"],
  ["server/sim/abenteuer-kanon.js","  e.ausgang = ausgang;\n  e.ort_ende","  e.ort_ende","Kanon Ende: der Ausgang wird nicht eingetragen"],
  ["server/sim/abenteuer-kanon.js","  for (const e of liste(F)) s.add(e.name);\n","","Namen: die Namen des Kanons gelten nicht als vergeben"],
  ["server/sim/abenteuer-kanon.js","function beginnen(F, f) {\n  if (eintragVon(F, f.id)) return false;","function beginnen(F, f) {","Kanon Beginn: ein zweiter Beginn desselben Fadens legt einen zweiten Eintrag an"],
  ["server/sim/abenteuer-kanon.js","function wiedersehenBeginnen(F, f) {\n  if (eintragVon(F, f.id)) return false;","function wiedersehenBeginnen(F, f) {","Kanon Beginn (Wiedersehen): ein zweiter Beginn legt einen zweiten Eintrag an"],
  ["server/sim/abenteuer-kanon.js","  e.wieder = true;\n  liste(F).push(e);","  liste(F).push(e);","Kanon Beginn: ein Wiedersehen traegt kein wieder"],
  ["server/sim/abenteuer-kanon.js","if (f.plan && typeof f.plan.titel === 'string') e.titel","if (typeof f.plan !== 'object' && typeof f.plan.titel === 'string') e.titel","Kanon Beginn: der Titel eines Abenteuers fehlt"],
  ["server/sim/abenteuer-kanon.js","if (frueher.volk !== e.volk) out.push(fehl('KANON_NAME_VOLK'","if (false) out.push(fehl('KANON_NAME_VOLK'","Pruefer: derselbe Name mit zwei Voelkern (KANON_NAME_VOLK)"],
  ["server/sim/abenteuer-kanon.js","if (!e.wieder) out.push(fehl('KANON_NAME_DOPPELT'","if (false) out.push(fehl('KANON_NAME_DOPPELT'","Pruefer: zwei NSC mit demselben Namen (KANON_NAME_DOPPELT)"],
  ["server/sim/abenteuer-kanon.js","if (e.wieder) out.push(fehl('KANON_WIEDER'","if (false) out.push(fehl('KANON_WIEDER'","Pruefer: ein Wiedersehen ohne Vorgaenger (KANON_WIEDER)"],
  ["server/sim/abenteuer-kanon.js","if (ids.has(e.f)) out.push(fehl('KANON_ID_DOPPELT'","if (false) out.push(fehl('KANON_ID_DOPPELT'","Pruefer: derselbe Faden zweimal (KANON_ID_DOPPELT)"],
  ["server/sim/abenteuer-kanon.js","if ((e.ausgang === undefined) !== (e.ort_ende === undefined)) out.push(","if (false) out.push(","Pruefer: Ausgang und Ort am Ende gehoeren zusammen (KANON_AUSGANG)"],
  ["server/sim/abenteuer-kanon.js","if (!e) { out.push(fehl('KANON_LISTE', `${f.id} fehlt im Kanon`)); continue; }","if (!e) continue;","Pruefer: ein Faden der Liste fehlt im Kanon (KANON_LISTE)"],
  ["server/sim/abenteuer-kanon.js","if (e.name !== f.nsc.name || e.volk !== f.nsc.fraktion) out.push(","if (false) out.push(","Pruefer: Name oder Volk weichen vom Faden ab (KANON_LISTE)"],
  ["server/sim/abenteuer-kanon.js","if (e.name !== f.nsc.name || e.volk !== f.nsc.fraktion) out.push(","if (e.name !== f.nsc.name) out.push(","Pruefer: das Volk wird nicht mit dem Faden verglichen"],
  ["server/sim/abenteuer-kanon.js","if (e.ausgang !== soll) out.push(","if (false) out.push(","Pruefer: der Ausgang weicht vom Faden ab (KANON_LISTE)"],
  ["server/sim/abenteuer-kanon.js","if (!W.voelker.includes(e.volk)) return 'Volk';","","Form: ein unbekanntes Volk"],
  ["server/sim/abenteuer-kanon.js","if (!hexOk(e.ort)) return 'Ort';","","Form: ein Ort, der kein Hex ist"],
  ["server/sim/abenteuer-kanon.js","if (typeof e.f !== 'string' || !ID.test(e.f)) return 'Kennung';","","Form: eine Kennung, die kein Faden ist"],
  ["server/sim/abenteuer-kanon.js","if (typeof e.name !== 'string' || !e.name.length || e.name.length > 40) return 'Name';","","Form: ein leerer Name"],
  ["server/sim/abenteuer-kanon.js"," && has(B, t) && !B[t].abschluss)) return 'Typenfolge';"," && has(B, t))) return 'Typenfolge';","Form: der Abschluss steht in der Typenfolge"],
  ["server/sim/abenteuer-kanon.js","if (e.titel !== undefined && !(typeof e.titel === 'string' && e.titel.length >= 1 && e.titel.length <= titelMax())) return 'Titel';","","Form: ein zu langer Titel"],
  ["server/sim/abenteuer-kanon.js","if (e.ausgang !== undefined && !W.ausgaenge.includes(e.ausgang)) return 'Ausgang';","","Form: ein unbekannter Ausgang"],
  ["server/sim/abenteuer-kanon.js","while (L.length > BW.kanon_max) {","while (L.length > BW.kanon_max + 3) {","Kuerzen: die Obergrenze gilt nicht"],
  ["server/sim/abenteuer-kanon.js","const i = L.findIndex((e) => e.ausgang !== undefined && !(F.liste || []).some((f) => f.id === e.f));","const i = L.findIndex((e) => true);","Kuerzen: auch ein laufendes Abenteuer faellt heraus"],
  ["server/sim/abenteuer-kanon.js","return JSON.stringify(soll) === JSON.stringify(speicherForm(tmp.kanon)) ? null : soll;","return soll;","Weltstand: der Block steht immer im Stand"],
  ["server/sim/abenteuer-kanon.js","return JSON.stringify(soll) === JSON.stringify(speicherForm(tmp.kanon)) ? null : soll;","return null;","Weltstand: der Block steht nie im Stand"],
  ["server/sim/abenteuer-kanon.js","    if (x.titel !== undefined) e.titel = x.titel;\n    if (x.wieder) e.wieder = true;\n    if (x.ausgang !== undefined) { e.ausgang = x.ausgang; e.ort_ende = x.ort_ende; if (x.status !== undefined) e.status = x.status; }\n    F.kanon.push(e);","    if (x.wieder) e.wieder = true;\n    if (x.ausgang !== undefined) { e.ausgang = x.ausgang; e.ort_ende = x.ort_ende; if (x.status !== undefined) e.status = x.status; }\n    F.kanon.push(e);","Laden: der Titel geht verloren"],
  ["server/sim/abenteuer-kanon.js","    if (x.ausgang !== undefined) { e.ausgang = x.ausgang; e.ort_ende = x.ort_ende; if (x.status !== undefined) e.status = x.status; }\n    F.kanon.push(e);","    if (x.ausgang !== undefined) { e.ausgang = x.ausgang; e.ort_ende = x.ort_ende; }\n    F.kanon.push(e);","Laden: der Zustand des NSC am Ende geht verloren"],
  ["server/sim/abenteuer-kanon.js","if (ids.has(x.f)) { F.ladeFehler.push('kanon: Eintrag doppelt verworfen'); continue; }","","Laden: derselbe Faden zweimal bleibt"],
  ["server/sim/abenteuer-kanon.js","if (frueher && (!x.wieder || frueher.volk !== x.volk)) {","if (false) {","Laden: ein zweiter NSC mit demselben Namen bleibt"],
  ["server/sim/abenteuer-kanon.js","if (frueher && (!x.wieder || frueher.volk !== x.volk)) {","if (frueher && !x.wieder) {","Laden: derselbe Name mit anderem Volk bleibt"],
  ["server/sim/abenteuer-kanon.js","if (!frueher && x.wieder) {","if (false) {","Laden: ein Wiedersehen ohne Vorgaenger bleibt"],
  ["server/sim/abenteuer-kanon.js","if ((x.ausgang === undefined) !== (x.ort_ende === undefined)) {","if (false) {","Laden: ein Ausgang ohne Ort am Ende bleibt"],
  ["server/sim/abenteuer-kanon.js","if (b !== undefined && !Array.isArray(b)) F.ladeFehler.push('kanon: verworfen');","","Laden: ein Kanon, der kein Feld ist, wird still uebergangen"],
  ["server/sim/abenteuer-kanon.js","    e.name = f.nsc.name; e.volk = f.nsc.fraktion;\n","","Abgleich: die Liste korrigiert Name und Volk nicht"],
  ["server/sim/abenteuer-kanon.js","if (L[i].ausgang === undefined && !(F.liste || []).some((f) => f.id === L[i].f)) {","if (false) {","Abgleich: ein laufendes Abenteuer ohne Faden bleibt im Kanon"],
  ["server/sim/abenteuer-kanon.js","    } else { delete e.ausgang; delete e.ort_ende; delete e.status; }","    }","Abgleich: ein Ausgang ohne abgeschlossenen Faden bleibt stehen"],
  ["server/sim/abenteuer-kanon.js","      e.ausgang = f.ausgang.art;\n      if (e.ort_ende","      if (e.ort_ende","Abgleich: der Ausgang des Fadens wird nicht uebernommen (Altstand)"],
  ["server/sim/abenteuer-kanon.js","if (!e) { e = neuerEintrag(f); if (fruehere(f)) e.wieder = true; L.push(e); }","if (!e) { e = neuerEintrag(f); L.push(e); }","Abgleich: ein abgeleiteter Eintrag kennt das Wiedersehen nicht"],
  ["server/sim/abenteuer-kanon.js","L.sort((a, b) => nr(a.f) - nr(b.f));","","Abgleich: die Eintraege stehen nicht in der Reihenfolge der Faeden"],
  ["server/sim/faden.js","    require('./abenteuer-kanon.js').beendet(game, f, ausgang);   // SUND-04b E1: der Ausgang steht im Kanon (genau einmal)\n","","Haken: der Abschluss traegt den Ausgang nicht in den Kanon ein"],
  ["server/sim/faden.js","  if (alt) require('./abenteuer-kanon.js').wiedersehenBeginnen(F, f); else require('./abenteuer-kanon.js').beginnen(F, f);   // SUND-04b E1: Name, Volk, Titel, Ort stehen ab jetzt im Kanon\n","","Haken: ein Abenteuer traegt sich beim Oeffnen nicht in den Kanon ein"],
  ["server/sim/faden.js","  if (alt) require('./abenteuer-kanon.js').wiedersehenBeginnen(F, f); else require('./abenteuer-kanon.js').beginnen(F, f);   // SUND-04b E1: Name, Volk, Titel, Ort stehen ab jetzt im Kanon\n","  require('./abenteuer-kanon.js').beginnen(F, f);\n","Haken: ein Wiedersehen wird beim Oeffnen nicht als solches eingetragen"],
  ["server/sim/faden.js","  if (alt) require('./abenteuer-kanon.js').wiedersehenBeginnen(F, f); else require('./abenteuer-kanon.js').beginnen(F, f);   // SUND-04b E1\n","","Haken: ein Faden aus der Vorlagendatei traegt sich nicht in den Kanon ein"],
  ["server/sim/faden.js","const vergeben = require('./abenteuer-kanon.js').namenVergeben(F);","const vergeben = new Set(F.liste.map((f) => f.nsc.name));","Haken: ein neuer NSC darf den Namen eines verdraengten Fadens tragen"],
  ["server/sim/faden.js","  const kn = require('./abenteuer-kanon.js').toSave(F);   // SUND-04b E1: Kanon (optional, additiv, Altstand = abgeleitet aus der Liste)\n  if (kn) b.kanon = kn;\n","","Haken: der Kanon steht nicht im Weltstand"],
  ["server/sim/faden.js","  require('./abenteuer-kanon.js').lesen(b.kanon, F);","  F.kanon = [];","Haken: der Kanon wird beim Laden nicht gelesen"],
  ["server/sim/faden.js","const abenteuerNeuAnbieten = (game, bauplan, o) => anbietenMit(game, bauplan, o, true);","const abenteuerNeuAnbieten = (game, bauplan, o) => anbietenMit(game, bauplan, o, false);","Haken: das Brett prueft keine Wiederholung"],
  ["server/sim/faden.js","const abenteuerAnbieten = (game, bauplan, o) => anbietenMit(game, bauplan, o, false);","const abenteuerAnbieten = (game, bauplan, o) => anbietenMit(game, bauplan, o, true);","Haken: die niedrige Anbieten-Pruefung kennt auch die Wiederholung"],
  ["server/sim/faden-pruefer.js","    if (!require('./abenteuer-kanon.js').nameFrei(F, p.name)) return fehl('NAME', `der Name ${p.name} ist schon vergeben`);   // SUND-04b E1: auch ein Name aus dem Kanon (der Faden kann schon aus der Liste gefallen sein)\n  }\n  ctx.benutzt.add(a.nr);","    if (F.liste.some((f) => f.nsc.name === p.name)) return fehl('NAME', `der Name ${p.name} ist schon vergeben`);\n  }\n  ctx.benutzt.add(a.nr);","Pruefer: faden_oeffnen nimmt einen Namen aus dem Kanon"],
  ["server/sim/faden-pruefer.js","    if (!require('./abenteuer-kanon.js').nameFrei(F, p.name)) return fehl('NAME', `der Name ${p.name} ist schon vergeben`);   // SUND-04b E1: auch ein Name aus dem Kanon (der Faden kann schon aus der Liste gefallen sein)\n  }\n  return null;\n}","    if (F.liste.some((f) => f.nsc.name === p.name)) return fehl('NAME', `der Name ${p.name} ist schon vergeben`);\n  }\n  return null;\n}","Pruefer: abenteuerOeffnen nimmt einen Namen aus dem Kanon"],
  ["server/sim/abenteuer-wiederholung.js",".slice(0, R.folge_zuletzt).find((x) => folgeText(x.folge) === f)",".slice(0, 1).find((x) => folgeText(x.folge) === f)","Folge: nur das letzte Abenteuer zaehlt"],
  ["server/sim/abenteuer-wiederholung.js","|| ((F && F.abenteuerAngebote) || []).find(","|| ([]).find(","Folge: ein offenes Angebot gleicher Folge zaehlt nicht"],
  ["server/sim/abenteuer-wiederholung.js","folgeText(x.folge) === f) ||","folgeText(x.folge) !== f) ||","Folge: die Folgen werden falsch verglichen"],
  ["server/sim/abenteuer-wiederholung.js",".slice(0, R.ort_typ_zuletzt).find((x) => x.ort === hex && x.folge[0] === erster)",".slice(0, 1).find((x) => x.ort === hex && x.folge[0] === erster)","Ort: nur das letzte Abenteuer zaehlt"],
  ["server/sim/abenteuer-wiederholung.js","find((x) => x.ort === hex && x.folge[0] === erster)","find((x) => x.folge[0] === erster)","Ort: der Ort wird nicht verglichen"],
  ["server/sim/abenteuer-wiederholung.js","find((x) => x.ort === hex && x.folge[0] === erster)","find((x) => x.ort === hex)","Ort: der erste Beat wird nicht verglichen"],
  ["server/sim/abenteuer-wiederholung.js","verlauf(game).slice(0, R.nsc_zuletzt).map((e) => e.name)","verlauf(game).slice(0, 0).map((e) => e.name)","NSC: die Hauptfigur des letzten Abenteuers ist nie gesperrt"],
  ["server/sim/abenteuer-wiederholung.js","filter((n) => !jung.has(n.name))","filter((n) => true)","NSC: kein Kandidat ist je zu frisch gesperrt"],
  ["server/sim/abenteuer-wiederholung.js","(stufe >= STUFEN_MAX ? kandidaten(game, v) : kandidatenFrisch(game, v))","kandidatenFrisch(game, v)","NSC: auch die letzte Stufe sperrt die Hauptfigur des letzten Abenteuers"],
  ["server/sim/abenteuer-wiederholung.js","(stufe >= 1 ? null : ortFehler(game, v, hex))","ortFehler(game, v, hex)","Stufen: der Ort wird nie gelockert"],
  ["server/sim/abenteuer-wiederholung.js","(stufe >= 2 ? null : folgeFehler(game, v))","folgeFehler(game, v)","Stufen: die Folge wird nie gelockert"],
  ["server/sim/abenteuer-wiederholung.js","(stufe >= STUFEN_MAX ? null : nscFehler(game, v))","nscFehler(game, v)","Stufen: der NSC wird nie gelockert"],
  ["server/sim/abenteuer-wiederholung.js","(stufe >= 1 ? null : ortFehler(game, v, hex)) || (stufe >= 2 ? null : folgeFehler(game, v))","(stufe >= 2 ? null : ortFehler(game, v, hex)) || (stufe >= 1 ? null : folgeFehler(game, v))","Stufen: die Folge wird vor dem Ort gelockert"],
  ["server/sim/abenteuer-wiederholung.js","filter((e) => typeof e.titel === 'string').reverse()","reverse()","Verlauf: auch ein Faden aus einer Vorlagendatei zaehlt als Abenteuer"],
  ["server/sim/abenteuer-wiederholung.js","kandidatenFrisch(game, { beats: [{ typ }], volk_erlaubt: [volk] }).length","kandidaten(game, { beats: [{ typ }], volk_erlaubt: [volk] }).length","Kontext: die Zahl der Wiedersehen-NSC zaehlt auch die gesperrten"],
  ["server/sim/abenteuer-wiederholung.js","verlauf(game).slice(0, R.folge_zuletzt).reverse().map((e) => e.folge.slice())","verlauf(game).slice(0, 1).reverse().map((e) => e.folge.slice())","Kontext: nur die letzte Typenfolge"],
  ["server/sim/abenteuer-wiederholung.js","const STUFEN_MAX = 3;","const STUFEN_MAX = 1;","Stufen: die Lockerung endet zu frueh (der NSC wird schon auf der ersten Stufe freigegeben)"],
  ["server/sim/abenteuer-brett.js","const kand = frisch.length ? frisch : a.locker ? alle : [];","const kand = alle;","annehmen: ein Wiedersehen nimmt auch die Hauptfigur des letzten Abenteuers"],
  ["server/sim/abenteuer-brett.js","const kand = frisch.length ? frisch : a.locker ? alle : [];","const kand = frisch.length ? frisch : alle;","annehmen: ohne frischen Kandidaten wird trotzdem begonnen"],
  ["server/sim/abenteuer-brett.js","alle.length ? 'WIEDERHOLUNG_NSC' : 'WIEDERSEHEN_KEIN_NSC'","'WIEDERSEHEN_KEIN_NSC'","annehmen: der Grund veraltet nennt die Wiederholung nicht"],
  ["server/sim/abenteuer-brett.js","  if (P.nscAlt(v) && !Wdh().kandidatenGelockert(game, v, stufe).length) return null;","","Anschluss: ein Wiedersehen ohne Kandidat wird auch auf der letzten Stufe angeboten"],
  ["server/sim/abenteuer-brett.js","  if (Wdh().pruefeGelockert(game, v, hex, stufe)) return null;","","Anschluss: die Wiederholungsregeln gelten nicht"],
  ["server/sim/abenteuer-brett.js","stufe <= Math.max(brett(F).abgelehnt.length + 1, Wdh().STUFEN_MAX)","stufe <= brett(F).abgelehnt.length + 1","Anschluss: die Wiederholungsregeln werden nie ganz gelockert (das Brett kann leer bleiben)"],
  ["server/sim/abenteuer-brett.js","plaene = D.ANSCHLUSS.plaene.filter((bp) => passt(game, F, bp, stufe, hex));","plaene = D.ANSCHLUSS.plaene.filter((bp) => passt(game, F, bp, 0, hex));","Anschluss: die Stufe der Lockerung kommt nicht an"],
  ["server/sim/abenteuer-brett.js","      res.angebot.locker = stufe - 1 >= Wdh().STUFEN_MAX;","      res.angebot.locker = true;","Anschluss: jedes Angebot gilt als gelockert"],
  ["server/sim/abenteuer-spielleiter.js","const res = faden().abenteuerNeuAnbieten(this.game, gelesen.plan, { hex: job.hex });","const res = faden().abenteuerAnbieten(this.game, gelesen.plan, { hex: job.hex });","Komposition: der Plan des Spielleiters wird ohne Wiederholungsregeln angeboten"],
  ["server/sim/abenteuer-prompt.js","const alle = require('./abenteuer-wiederholung.js').letzteFolgen(game).concat(","const alle = [].concat(","Prompt: die begonnenen Abenteuer fehlen in letzte_abenteuer"],
  ["server/sim/abenteuer-prompt.js",".slice(0, RW.ort_typ_zuletzt).filter((e) => e.ort === hex)",".slice(0, RW.ort_typ_zuletzt)","Prompt: sperre_beginn nennt auch erste Beats anderer Orte"],
  ["server/sim/abenteuer-prompt.js","const wiedersehen = require('./abenteuer-wiederholung.js').zahlenFrisch(game);","const wiedersehen = require('./faden-pruefer.js').wiedersehenZahlen(F);","Prompt: der Kontext zaehlt auch die gesperrten NSC"],
  ["server/sim/abenteuer-prompt.js","Wiederholung (Daten abenteuer-brett.json werte.wiederholung): nie dieselbe","Wiederholung (Daten): nie dieselbe","Prompt: der Katalog nennt die Quelle der Zahlen nicht"],
  ["server/sim/faden-b1.js","if (!has(W.wiedersehen_erinnert, gegen)) g(","if (false) g(","Katalogpruefung: ein fehlender Gegenpart wird nicht gemeldet (WIEDERSEHEN_PAAR)"],
  ["server/sim/faden-b1.js","else if (W.wiedersehen_erinnert[gegen] === k || (has(T, k) && T[k] === T[W.wiedersehen_erinnert[gegen]])) g(","else if (false) g(","Katalogpruefung: derselbe Text fuer beide Ausgaenge wird nicht gemeldet (WIEDERSEHEN_PAAR)"],
  ["server/sim/faden-b1.js","if (!m) { g(`WIEDERSEHEN_PAAR: Ereignis ${ev} endet nicht auf _gelungen oder _gescheitert`); continue; }","if (!m) continue;","Katalogpruefung: ein Ereignis ohne Ausgang wird nicht gemeldet"],
  ["content/faeden/b1-texte.json","\"konvoi_gescheitert\": \"wiedersehen_konvoi_gescheitert\",\n","","Daten: kein Satz fuer das gescheiterte Konvoi-Abenteuer"],
  ["content/faeden/b1-texte.json","\"wiedersehen_konvoi_gescheitert\": \"Der Konvoi ist euch entkommen. Bei {ort} habe ich einen neuen Auftrag.\",","\"wiedersehen_konvoi_gescheitert\": \"Ihr habt den Konvoi aufgehalten. Bei {ort} habe ich einen neuen Auftrag.\",","Daten: der Satz nach einem gescheiterten Konvoi nennt einen Erfolg"],
  ["content/faeden/b1-texte.json","\"wiedersehen_geleit_gescheitert\": \"Ihr habt mich nicht durchgebracht. Bei {ort} können wir reden.\",","\"wiedersehen_geleit_gescheitert\": \"Ihr habt mich durchgebracht. Bei {ort} können wir reden.\",","Daten: der Satz nach einem gescheiterten Geleit nennt einen Erfolg"],
  ["content/schema/weltstand.schema.json","\"kanon\":{\"type\":\"array\",\"maxItems\":40,","\"kanonx\":{\"type\":\"array\",\"maxItems\":40,","Schema: der Block kanon steht nicht im Schema"],
  ["content/schema/weltstand.schema.json","\"kanon\":{\"type\":\"array\",\"maxItems\":40,","\"kanon\":{\"type\":\"array\",\"maxItems\":30,","Schema: die Obergrenze des Kanons weicht von den Daten ab"],
  ["content/schema/weltstand.schema.json","\"items\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"f\",\"name\",\"volk\",\"ort\",\"folge\"]","\"items\":{\"type\":\"object\",\"additionalProperties\":true,\"required\":[\"f\",\"name\",\"volk\",\"ort\",\"folge\"]","Schema: ein Eintrag darf fremde Felder tragen"],
  ["content/faeden/abenteuer-brett.json","\"kanon_max\": {\n      \"wert\": 40,","\"kanon_max\": {\n      \"wert\": 12,","Daten: der Kanon fasst nicht mehr als die Liste der Faeden"],
];

{
  const normal = (t) => t.replace(/\r\n/g, '\n');
  const schlecht = [];
  for (const [datei, alt, , was] of MUTATIONEN) {
    let text;
    try { text = normal(fs.readFileSync(path.join(TMP, datei), 'utf8')); } catch (e) { schlecht.push(`${was}: Datei ${datei} nicht lesbar`); continue; }
    const k = text.split(alt).length - 1;
    if (k !== 1) schlecht.push(`${was}: Anker ${k === 0 ? 'nicht gefunden' : k + 'x gefunden'} (${datei})`);
  }
  if (schlecht.length) { console.log(`Anker-Check: ${schlecht.length} von ${MUTATIONEN.length} Mutationen nicht anwendbar:\n  ` + schlecht.join('\n  ')); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } process.exit(2); }
  console.log(`Anker-Check: alle ${MUTATIONEN.length} Anker genau einmal gefunden.`);
  if (process.argv.includes('--trocken')) { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } process.exit(0); }
}

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const lauf = ([test, ...arg]) => spawnSync(process.execPath, [test, ...arg], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
let ueberlebt = 0, gelaufen = 0, erkannt = 0, abstuerze = 0;
console.log(`Mutationsprobe test-abenteuer-kanon.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
for (const t of TESTS) {
  const basis = lauf(t);
  console.log(`  Ausgangslage ${t.join(' ')}: ${basis.status === 0 ? 'gruen' : 'ROT (Abbruch)'}`);
  if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l) && !/Ausnahme/.test(l)).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
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
  let wer = null, fehler = [], absturz = null;
  for (const t of TESTS) {
    const r = lauf(t);
    if (r.status === 0) continue;
    const fz = ((r.stdout || '').split('\n')).filter((l) => /FEHLER/.test(l) && !/Ausnahme/.test(l));
    if (fz.length) { wer = path.basename(t[0], '.js').replace('test-', ''); fehler = fz; break; }
    if (!absturz) absturz = { test: path.basename(t[0], '.js'), text: ((r.stderr || '') + (r.stdout || '')).split('\n').filter((l) => /Error|    at /.test(l)).slice(0, 1).join(' ').trim().slice(0, 120) || `Exit ${r.status}` };
  }
  fs.writeFileSync(f, orig);
  if (wer) { erkannt++; console.log(`  rot    ${was} (${wer}: ${fehler.length} Fehler, z. B. ${fehler[0].replace(/^\s*FEHLER\s*/, '').slice(0, 64)})`); }
  else if (absturz) { abstuerze++; console.log(`  ABSTURZ ${was} (${absturz.test}: ${absturz.text}) – nicht als erkannt gezaehlt`); }
  else { ueberlebt++; console.log(`  GRUEN  ${was}  <-- UEBERLEBT`); }
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(`Ergebnis: ${erkannt} erkannt, ${ueberlebt} ueberlebt, ${abstuerze} Absturz/Syntaxfehler (von ${gelaufen})`);
process.exit(ueberlebt || abstuerze ? 1 : 0);
