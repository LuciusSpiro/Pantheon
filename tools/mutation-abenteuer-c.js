'use strict';
// SUND-04b C: Mutationsprobe zu tools/test-abenteuer-brett.js (Auftragsbrett: server/sim/abenteuer-brett.js, die Haken in faden.js, game.js und abenteuer-spielleiter.js, Daten abenteuer-brett.json und anschluss.json). Kopiert Server, Shared,
// Content und den Test in ein Temp-Verzeichnis (das Repo bleibt unberuehrt), aendert dort je Lauf EINE Regel und verlangt, dass der Test rot wird (Exit != 0 mit mindestens einer FEHLER-Zeile). Ueberlebt eine Mutation, deckt der Test die Regel
// nicht ab. Selbstcheck: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst bricht die Probe mit Exit 2 ab.
//   node tools/mutation-abenteuer-c.js [begriff ...] [--trocken]      (npm run test:abenteuer-brett-mutation)
// Bewusst nicht in der Liste (aequivalente Mutanten): die Pruefung des Typs von id in game.js (typeof msg.id === 'string': das Modul prueft denselben Typ noch einmal), der Takt pruefung_s in beiUpdate (er spart nur Rechenzeit),
// geruechte_max (gleich angebote_max), der Zaehler antworten_gemerkt (nur die Laenge), die Weiterleitung OBERGRENZE und ABENTEUER_LAUFEND aus abenteuerOeffnen (derselbe Code wie die Vorpruefung, nur mit Logbuch-Eintrag: dort gepruefte
// Mutation), reine Zahlen und Texte der Daten ohne zweite Erwartung (der Test liest sie aus derselben Datei).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-c-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TESTS = [['tools/test-abenteuer-brett.js']];
for (const [t] of TESTS) fs.copyFileSync(path.join(ROOT, t), path.join(TMP, t));
for (const h of ['regie-fixture.js', 'faden-fixture.js', 'gegner-testhilfe.js', 'katalog.js']) fs.copyFileSync(path.join(ROOT, 'tools', h), path.join(TMP, 'tools', h));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul noetig */ } }

const FA = 'server/sim/faden.js', BRT = 'server/sim/abenteuer-brett.js', GM = 'server/game.js', AS = 'server/sim/abenteuer-spielleiter.js', AJ = 'content/faeden/anschluss.json', BJ = 'content/faeden/abenteuer-brett.json';   // (die Mutationen nennen die Pfade selbst)
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  ["server/sim/abenteuer-brett.js", "const ID_RE = /^a\\d{1,6}$/;", "const ID_RE = /^a\\d+$/;", "Eingabe: die id darf beliebig viele Ziffern haben"],
  ["server/sim/abenteuer-brett.js", "const ID_RE = /^a\\d{1,6}$/;", "const ID_RE = /^a\\d{1,6}/;", "Eingabe: die id ist nicht am Ende verankert"],
  ["server/sim/abenteuer-brett.js", "const ID_RE = /^a\\d{1,6}$/;", "const ID_RE = /a\\d{1,6}$/;", "Eingabe: die id ist nicht am Anfang verankert"],
  ["server/sim/abenteuer-brett.js", "if (typeof id !== 'string' || !ID_RE.test(id)) return", "if (!ID_RE.test(id)) return", "Eingabe: der Typ der id wird nicht geprueft"],
  ["server/sim/abenteuer-brett.js", "if (!Faden().aktiv(game)) return { fehler: fehl('modus') };", "", "Befehle: ohne Schalter FAEDEN kein modus"],
  ["server/sim/abenteuer-brett.js", "return { fehler: fehl(brett(F).antworten.includes(nr) ? 'schon_beantwortet' : 'kein_angebot') };", "return { fehler: fehl('kein_angebot') };", "Befehle: eine zweite Antwort heisst kein_angebot statt schon_beantwortet"],
  ["server/sim/abenteuer-brett.js", "if (!Faden().spielleiterAktiv(game)) return fehl('kein_spielleiter');", "", "annehmen: ohne Spielleiter wird ein Abenteuer begonnen"],
  ["server/sim/abenteuer-brett.js", "if (P.abenteuerLaufend(F) >= W.abenteuer.laufend_max) return fehl('laeuft_schon');", "", "annehmen: kein eigener Zustandscheck fuer das laufende Abenteuer (das Oeffnen lehnt mit Logbuch ab)"],
  ["server/sim/abenteuer-brett.js", "if (P.aktive(F).length >= W.aktiv_max) return fehl('kein_platz');", "", "annehmen: kein eigener Zustandscheck fuer die drei aktiven Faeden"],
  ["server/sim/abenteuer-brett.js", "if (lg) return veraltet(game, F, a, lg);", "", "annehmen: kein eigener Lagencheck (das Oeffnen lehnt mit Logbuch ab)"],
  ["server/sim/abenteuer-brett.js", "  entfernen(F, a);\n  gemerkt(brett(F).antworten, a.nr, BW.antworten_gemerkt);\n  logbuch(game, 'faden_ereignis', { ausgang: 'abenteuer_veraltet'", "  gemerkt(brett(F).antworten, a.nr, BW.antworten_gemerkt);\n  logbuch(game, 'faden_ereignis', { ausgang: 'abenteuer_veraltet'", "veraltet: das Angebot bleibt auf dem Brett"],
  ["server/sim/abenteuer-brett.js", "  gemerkt(brett(F).antworten, a.nr, BW.antworten_gemerkt);\n  logbuch(game, 'faden_ereignis', { ausgang: 'abenteuer_veraltet'", "  logbuch(game, 'faden_ereignis', { ausgang: 'abenteuer_veraltet'", "veraltet: die Nummer wird nicht gemerkt (spaetere Antwort: kein_angebot)"],
  ["server/sim/abenteuer-brett.js", "const kand = Faden().wiedersehenKandidaten(game, a.vorlage);", "const kand = Faden().wiedersehenKandidaten(game, a.vorlage).reverse();", "Wiedersehen: der aelteste Kandidat zuerst"],
  ["server/sim/abenteuer-brett.js", "if (!kand.length) return veraltet(game, F, a, 'WIEDERSEHEN_KEIN_NSC');", "", "Wiedersehen: ohne Kandidat kein sauberes veraltet"],
  ["server/sim/abenteuer-brett.js", "  F.abenteuerZuletzt = r.faden.vorlage;", "", "annehmen: der gespielte Plan wird nicht als zuletzt gemerkt"],
  ["server/sim/abenteuer-brett.js", "  gemerkt(brett(F).antworten, a.nr, BW.antworten_gemerkt);\n  F.abenteuerZuletzt", "  F.abenteuerZuletzt", "annehmen: die Nummer wird nicht gemerkt (zweite Antwort: kein_angebot)"],
  ["server/sim/abenteuer-brett.js", "  entfernen(F, a);\n  const b = brett(F);", "  const b = brett(F);", "ablehnen: das Angebot bleibt auf dem Brett"],
  ["server/sim/abenteuer-brett.js", "  gemerkt(b.abgelehnt, a.ref, 3);", "", "ablehnen: der Rueckfall bietet denselben Plan sofort wieder an"],
  ["server/sim/abenteuer-brett.js", "  gemerkt(b.antworten, a.nr, BW.antworten_gemerkt);\n  gemerkt(b.abgelehnt", "  gemerkt(b.abgelehnt", "ablehnen: die Nummer wird nicht gemerkt"],
  ["server/sim/abenteuer-brett.js", "try { Chronik().eintragen(game, { art: 'reise', ref: f.id,", "if (false) try { Chronik().eintragen(game, { art: 'reise', ref: f.id,", "Ende: keine Chronik-Zeile"],
  ["server/sim/abenteuer-brett.js", "const key = ausgang === 'gelungen' ? 'gelungen' : 'gescheitert';", "const key = 'gelungen';", "Ende: ein gescheitertes Abenteuer steht als gelungen in der Chronik"],
  ["server/sim/abenteuer-brett.js", "kurz: fmt(BR.chronik[key], { ort })", "kurz: f.nsc.name + ' ' + fmt(BR.chronik[key], { ort })", "Ende: der Name des NSC steht in der Chronik"],
  ["server/sim/abenteuer-brett.js", "begruendung: `Abenteuer ${f.vorlage} ${ausgang}, NSC ${f.nsc.status}`", "begruendung: `Abenteuer ${f.vorlage} ${f.plan.titel} ${ausgang}, NSC ${f.nsc.status}`", "Ende: der Titel steht im Logbuch"],
  ["server/sim/abenteuer-brett.js", "status: f.nsc.status } });\n  anschluss(game);", "status: f.nsc.status } });", "Ende: kein Anschluss-Angebot direkt nach dem Ende"],
  ["server/sim/abenteuer-brett.js", "if (v.id === F.abenteuerZuletzt && stufe <= abg.length) return null;", "", "Anschluss: der zuletzt gespielte Plan wird wiederholt"],
  ["server/sim/abenteuer-brett.js", "if (abg.indexOf(v.id) >= stufe) return null;", "", "Anschluss: ein abgelehnter Plan wird sofort wieder angeboten"],
  ["server/sim/abenteuer-brett.js", "if (P.pruefeLage(game, v)) return null;", "", "Anschluss: die Lage (Sabotage ohne Ziel) wird nicht vorab geprueft"],
  ["server/sim/abenteuer-brett.js", "if (P.nscAlt(v) && !Faden().wiedersehenKandidaten(game, v).length) return null;", "", "Anschluss: ein Wiedersehen ohne Kandidat wird gewaehlt"],
  ["server/sim/abenteuer-brett.js", "if (F.abenteuerAngebote.length || P.abenteuerLaufend(F)) return null;", "if (P.abenteuerLaufend(F)) return null;", "Anschluss: auch mit einem Angebot kommt ein weiteres"],
  ["server/sim/abenteuer-brett.js", "if (F.abenteuerAngebote.length || P.abenteuerLaufend(F)) return null;", "if (F.abenteuerAngebote.length) return null;", "Anschluss: auch waehrend ein Abenteuer laeuft"],
  ["server/sim/abenteuer-brett.js", "|| anschlussAus(game) || !Faden().spielleiterAktiv(game)) return null;", "|| anschlussAus(game)) return null;", "Anschluss: auch ohne Spielleiter"],
  ["server/sim/abenteuer-brett.js", "|| anschlussAus(game) || !Faden().spielleiterAktiv(game)) return null;", "|| !Faden().spielleiterAktiv(game)) return null;", "Anschluss: der Knopf ABENTEUER_ANSCHLUSS=0 wirkt nicht"],
  ["server/sim/abenteuer-brett.js", "const n = F.angNr + 1;", "const n = 1;", "Anschluss: die Wahl haengt nicht vom Zaehler der Angebote ab"],
  ["server/sim/abenteuer-brett.js", "const start = Math.floor(Faden().strom(game, n, 'anschluss')() * plaene.length) % plaene.length;", "const start = 0;", "Anschluss: immer der erste passende Plan"],
  ["server/sim/abenteuer-brett.js", "if (!F || !Faden().aktiv(game) || !Number.isFinite(game.time)) return null;", "if (true) return null;", "Anschluss: im Takt entsteht nie ein Angebot (Spielstart, Laden)"],
  ["server/sim/abenteuer-spielleiter.js", "if (this.bereit()) { try { require('./abenteuer-brett.js').beiUpdate(this.game); }", "if (false) { try { require('./abenteuer-brett.js').beiUpdate(this.game); }", "Haken: der Takt der Komposition ruft den Rueckfall nicht"],
  ["server/sim/faden.js", "try { require('./abenteuer-brett.js').beiTaetigkeit(game); }", "try { void 0; }", "Haken: die Taetigkeit ruft den Rueckfall nicht"],
  ["server/sim/faden.js", "try { require('./abenteuer-brett.js').beiEnde(game, f, ausgang); }", "try { void 0; }", "Haken: das Ende eines Abenteuers ruft das Brett nicht"],
  ["server/sim/faden.js", "if (ab) b.abenteuer = ab;", "", "Weltstand: der Block abenteuer wird nicht gespeichert"],
  ["server/sim/faden.js", "if (b.abenteuer !== undefined) { if (istObjekt(b.abenteuer)) require('./abenteuer-brett.js').lesen(b.abenteuer, F); else", "if (b.abenteuer !== undefined) { if (false) require('./abenteuer-brett.js').lesen(b.abenteuer, F); else", "Weltstand: der Block abenteuer wird nicht gelesen"],
  ["server/sim/abenteuer-brett.js", "if (F.abenteuerAngebote && F.abenteuerAngebote.length) b.angebote", "if (false) b.angebote", "Weltstand: die Angebote werden nicht gespeichert"],
  ["server/sim/abenteuer-brett.js", "|| !Sektoren.spielbar(x.hex)", "", "Laden: ein Angebot an einem unspielbaren Ort bleibt"],
  ["server/sim/abenteuer-brett.js", "Math.min(x.alter, W.abenteuer.angebot_gilt_taetigkeiten)", "x.alter", "Laden: das Alter wird nicht auf die Geltungsdauer geklemmt"],
  ["server/sim/abenteuer-brett.js", "b.angebote.slice(0, W.abenteuer.angebote_max)", "b.angebote", "Laden: mehr als drei Angebote"],
  ["server/sim/abenteuer-brett.js", "if (F.abenteuerAngebote.some((a) => a.ref === v.id && a.hex === x.hex)) continue;", "", "Laden: dasselbe Angebot doppelt"],
  ["server/sim/abenteuer-brett.js", "if (!reg.ok) { F.ladeFehler.push('abenteuer.angebote: Plan ungültig (' + String(reg.fehler[0]).slice(0, 80) + ')'); continue; }", "", "Laden: ein ungueltiger Plan wird nicht abgewiesen"],
  ["server/sim/abenteuer-brett.js", "if (typeof b.zuletzt === 'string' && VORLAGE_ID.test(b.zuletzt)) F.abenteuerZuletzt = b.zuletzt;", "if (typeof b.zuletzt === 'string') F.abenteuerZuletzt = b.zuletzt;", "Laden: zuletzt wird nicht auf die Form einer Vorlagen-Id geprueft"],
  ["server/sim/abenteuer-brett.js", "const text = (t, max) => kuerzen(ohneNamen(game, String(t)), max);", "const text = (t, max) => kuerzen(String(t), max);", "Snapshot: Spielernamen im Freitext bleiben"],
  ["server/sim/abenteuer-brett.js", "t.slice(0, Math.max(0, max - 1)).trimEnd() + '…'", "t.slice(0, max)", "Snapshot: die Kuerzung hat kein … und kuerzt falsch"],
  ["server/sim/abenteuer-brett.js", "F.abenteuerAngebote.map((a) => a.nr + ':' + restAngebot(a) + ':' + vonAngebot(game, a)).join(',')", "F.abenteuerAngebote.map((a) => a.nr + ':' + vonAngebot(game, a)).join(',')", "Schluessel: der Verfall aendert den Schluessel nicht"],
  ["server/sim/abenteuer-brett.js", "return [Faden().spielleiterAktiv(game) ? 1 : 0, F.abenteuerAngebote", "return [1, F.abenteuerAngebote", "Schluessel: der Wechsel des Spielleiters aendert den Schluessel nicht"],
  ["server/sim/abenteuer-brett.js", "l ? [l.id, l.beat, l.phase, restLaufend(l)].join(':') : ''", "''", "Schluessel: das laufende Abenteuer aendert den Schluessel nicht"],
  ["server/sim/abenteuer-brett.js", "W.abenteuer.angebot_gilt_taetigkeiten - a.alter", "a.alter", "Anzeige: der Verfall zaehlt aufwaerts"],
  ["server/sim/abenteuer-brett.js", "Math.max(0, Faden().fristVon(f) - f.laufend.n)", "0", "Anzeige: die Frist des laufenden Beats fehlt"],
  ["server/sim/abenteuer-brett.js", "const s = { text: schrittText(b), gefahr: !!(cat && cat.gefahr) };", "const s = { text: schrittText(b), gefahr: false };", "Vorschau: die Gefahr eines Schritts fehlt"],
  ["server/sim/abenteuer-brett.js", "gefahr: schritte.some((s) => s.gefahr),", "gefahr: false,", "Vorschau: die Gefahr des Abenteuers fehlt"],
  ["server/sim/abenteuer-brett.js", "if (Array.isArray(b.optionen) && b.optionen.length) s.wahl", "if (false) s.wahl", "Vorschau: die Wahl einer Bitte fehlt"],
  ["server/sim/abenteuer-brett.js", "if (istObjekt(e.varianten) && has(e.varianten, key)) return e.varianten[key];", "", "Vorschau: die Variante eines Parameters fehlt"],
  ["server/sim/abenteuer-brett.js", "if (o.weiter !== undefined && v.beats.findIndex((x) => x.id === o.weiter) !== i + 1) add(BW.weg_text);", "", "Vorschau: ein anderer Weg beim Scheitern wird verschwiegen"],
  ["server/sim/abenteuer-brett.js", "if (typeof o.status === 'string' && has(tab, o.status)) add(tab[o.status]);", "", "Vorschau: der Zustand des Auftraggebers nach dem Ausgang fehlt"],
  ["server/sim/abenteuer-brett.js", "{ f: von, art: 'haltung', d: w.delta }", "{ f: 'rom', art: 'haltung', d: w.delta }", "Vorschau: die Haltungs-Marke traegt eine feste Fraktion"],
  ["server/sim/abenteuer-brett.js", "summe ? Math.round((alt.d + x.d) * 100) / 100 : Math.abs(x.d) > Math.abs(alt.d) ? x.d : alt.d", "alt.d", "Vorschau: die Folgen mehrerer Schritte werden nicht summiert"],
  ["server/sim/abenteuer-brett.js", "summe ? Math.round((alt.d + x.d) * 100) / 100 : Math.abs(x.d) > Math.abs(alt.d) ? x.d : alt.d", "Math.round((alt.d + x.d) * 100) / 100", "Vorschau: Scheitern zeigt die Summe aller Schritte statt der staerksten Einzelfolge"],
  ["server/sim/abenteuer-brett.js", "summe ? Math.round((alt.d + x.d) * 100) / 100 : Math.abs(x.d) > Math.abs(alt.d) ? x.d : alt.d", "summe ? Math.round((alt.d + x.d) * 100) / 100 : Math.min(alt.d, x.d)", "Vorschau: Scheitern nimmt das kleinste d statt des groessten Betrags"],
  ["server/sim/abenteuer-brett.js", "summe ? Math.round((alt.d + x.d) * 100) / 100 : Math.abs(x.d) > Math.abs(alt.d) ? x.d : alt.d", "summe ? Math.round((alt.d + x.d) * 100) / 100 : Math.abs(x.d) > Math.abs(alt.d) ? Math.abs(x.d) : Math.abs(alt.d)", "Vorschau: Scheitern verliert das Vorzeichen der staerksten Folge"],
  ["server/sim/abenteuer-brett.js", "summe ? Math.round((alt.d + x.d) * 100) / 100 : Math.abs(x.d) > Math.abs(alt.d) ? x.d : alt.d", "summe ? Math.round((alt.d + x.d) * 100) / 100 : x.d", "Vorschau: Scheitern nimmt die letzte statt der staerksten Folge"],
  ["server/sim/abenteuer-brett.js", "return v.volk_erlaubt.includes(a.volk) ? a.volk : v.volk_erlaubt[0];", "return v.volk_erlaubt[0];", "von: das Volk des Ortes wird ignoriert"],
  ["server/sim/abenteuer-brett.js", "aus_geruecht: a.vorlage.beats.some((b) => b.typ === 'geruecht')", "aus_geruecht: false", "Snapshot: aus_geruecht fehlt"],
  ["server/sim/abenteuer-brett.js", "typeof hs[x].text === 'string' && !hs[x].text.includes('{name}'));", "typeof hs[x].text === 'string');", "Geruechte: ein Hinweis mit {name} wird gezeigt"],
  ["server/sim/abenteuer-brett.js", "gefahr: !!(cat && cat.gefahr), ph:", "gefahr: false, ph:", "laufend: die Gefahr des Beats fehlt"],
  ["server/game.js", "const op = c === 'abenteuer.annehmen' ? 'annehmen' : 'ablehnen';", "const op = 'annehmen';", "Befehl: ablehnen wirkt wie annehmen"],
  ["server/sim/abenteuer-brett.js", "for (let stufe = 0; !plaene.length && stufe <= brett(F).abgelehnt.length + 1; stufe++)", "for (let stufe = 0; !plaene.length && stufe < 1; stufe++)", "Anschluss: die Sperren werden nie gelockert (das Brett kann fuer immer leer bleiben)"],
  ["server/sim/abenteuer-brett.js", "stufe <= brett(F).abgelehnt.length + 1; stufe++)", "stufe <= brett(F).abgelehnt.length; stufe++)", "Anschluss: zuletzt wird nie freigegeben"],
  ["server/sim/abenteuer-brett.js", "if (abg.indexOf(v.id) >= stufe) return null;", "if (abg.indexOf(v.id) >= 0) return null;", "Anschluss: Ablehnungen werden nie freigegeben"],
  ["server/sim/abenteuer-brett.js", "if (abg.indexOf(v.id) >= stufe) return null;", "if (abg.indexOf(v.id) >= 0 && abg.length - 1 - abg.indexOf(v.id) >= stufe) return null;", "Anschluss: zuerst die neueste statt der aeltesten Ablehnung freigeben"],
  ["server/sim/abenteuer-brett.js", "if (v.id === F.abenteuerZuletzt && stufe <= abg.length) return null;", "if (v.id === F.abenteuerZuletzt) return null;", "Anschluss: zuletzt wird auch auf der letzten Stufe nicht freigegeben"],
  ["server/sim/abenteuer-brett.js", "plan: klon(a.vorlage) }, a.volk ? { volk: a.volk } : {}));", "plan: klon(a.vorlage) }, {}));", "Weltstand: das Volk des Angebots wird nicht gespeichert"],
  ["server/sim/abenteuer-brett.js", "volk: typeof x.volk === 'string' && v.volk_erlaubt.includes(x.volk) ? x.volk : '',", "volk: '',", "Laden: das gespeicherte Volk wird nicht gelesen"],
  ["server/sim/abenteuer-brett.js", "volk: typeof x.volk === 'string' && v.volk_erlaubt.includes(x.volk) ? x.volk : '',", "volk: typeof x.volk === 'string' ? x.volk : '',", "Laden: ein Volk ausserhalb der Vorlage wird nicht verworfen"],
  ["server/sim/abenteuer-brett.js", "a.nr + ':' + restAngebot(a) + ':' + vonAngebot(game, a)", "a.nr + ':' + restAngebot(a)", "Schluessel: der Auftraggeber (von) aendert den Schluessel nicht"],
  ["server/game.js", "r = AbenteuerBrett.weigerung('fehler'); } }", "r = AbenteuerBrett.weigerung('veraltet'); } }", "Befehl: eine Ausnahme meldet veraltet statt fehler"],
  ["content/faeden/abenteuer-brett.json", "\"fehler\": \"Das Brett konnte die Antwort nicht verarbeiten. Das Angebot bleibt.\",", "", "Daten: die Weigerung fehler hat keinen Text"],
  ["content/schema/weltstand.schema.json", "\"alter\":{\"type\":\"integer\",\"minimum\":0},\"plan\":{\"type\":\"object\"},\"volk\":{\"type\":\"string\",\"maxLength\":8}", "\"alter\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":12},\"plan\":{\"type\":\"object\"},\"volk\":{\"type\":\"string\",\"maxLength\":8}", "Schema: ein festes Maximum 12 fuer das Alter"],
  ["server/game.js", "if (p.downed) r = AbenteuerBrett.weigerung('am_boden');", "if (false) r = AbenteuerBrett.weigerung('am_boden');", "Befehl: wer am Boden liegt, entscheidet trotzdem"],
  ["server/game.js", "world.abenteuer = AbenteuerBrett.snapshot(this); this.sentAbenteuerKey = ak; }", "world.abenteuer = AbenteuerBrett.snapshot(this); }", "Snapshot: der Block wird bei jedem Snapshot gesendet"],
  ["server/game.js", "else if (!ak && this.sentAbenteuerKey) { world.abenteuer = null; this.sentAbenteuerKey = null; }", "", "Snapshot: kein Loeschsignal"],
  ["server/game.js", "kind: 'abenteuerAntwort', pid: p.id, op, ok: !r }", "kind: 'abenteuerAntwort', pid: 'p1', op, ok: !r }", "Befehl: die Antwort traegt eine feste pid"],
  ["server/game.js", "if (Protocol.CMD_ABENTEUER.includes(c)) {", "if (false) {", "Befehl: der Befehlsweg ist nicht verbunden"],
  ["content/faeden/anschluss.json", "\"beats\": [{\"typ\": \"sabotage\"}, {\"typ\": \"abschluss\"}]", "\"beats\": [{\"typ\": \"geruecht\"}, {\"typ\": \"abschluss\"}]", "Daten: kein Anschluss-Plan fuer Sabotage"],
  ["content/faeden/abenteuer-brett.json", "\"gelungen\": \"Auftrag bei {ort} erfüllt\",", "\"gelungen\": \"Auftrag bei {ort} erfüllt ({name})\",", "Daten: die Chronik-Zeile nennt den NSC"],
  ["content/faeden/abenteuer-brett.json", "\"kein_spielleiter\": \"Der Spielleiter ist gerade nicht erreichbar. Das Angebot bleibt.\",", "", "Daten: die Weigerung kein_spielleiter hat keinen Text"],
  // SUND-04b D Nacharbeit: Titel bis 40 (titel_max) und die Typ-Zeile der Karte (typen)
  ["content/faeden/abenteuer-brett.json", "\"titel_max\": {\n      \"wert\": 40,", "\"titel_max\": {\n      \"wert\": 26,", "Daten: der Titel im Block wird schon auf 26 gekuerzt"],
  ["content/faeden/abenteuer-brett.json", "\"typen_max\": {\n      \"wert\": 4,", "\"typen_max\": {\n      \"wert\": 1,", "Daten: nur ein Typ je Angebot"],
  ["server/sim/abenteuer-brett.js", "vorschau: vorschau(a.vorlage, von), typen: typenVon(a.vorlage) };", "vorschau: vorschau(a.vorlage, von) };", "Snapshot: das Angebot nennt keine Typen"],
  ["server/sim/abenteuer-brett.js", "    if (cat && cat.abschluss) continue;\n", "", "typen: der Abschluss steht in der Typ-Liste"],
  ["server/sim/abenteuer-brett.js", "if (!out.includes(b.typ)) out.push(b.typ);", "out.push(b.typ);", "typen: derselbe Typ steht mehrfach in der Liste"],
  ["server/sim/abenteuer-brett.js", "return out.slice(0, BW.typen_max);", "return out;", "typen: die Liste ist nicht begrenzt"],
  ["server/sim/abenteuer-brett.js", "const e = { id: 'a' + a.nr, titel: text(a.vorlage.titel, BW.titel_max),", "const e = { id: 'a' + a.nr, titel: String(a.vorlage.titel),", "Snapshot: der Titel des Angebots wird nicht gekuerzt"],
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
console.log(`Mutationsprobe test-abenteuer-brett.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
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
