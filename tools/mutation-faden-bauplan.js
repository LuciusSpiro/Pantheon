'use strict';
// SUND-04b A1: Mutationsprobe zu tools/test-faden-bauplan.js (Bauplan-Format, Expander, Pruefer-Regel namenlos, Abenteuer-Register, Anbieten und Oeffnen, Persistenz, Daten). Kopiert Server, Shared, Content und
// den Test in ein Temp-Verzeichnis (das Repo bleibt unberuehrt), aendert dort je Lauf EINE Regel und verlangt, dass der Test rot wird (Exit != 0 mit mindestens einer FEHLER-Zeile). Ueberlebt eine Mutation, deckt
// der Test die Regel nicht ab. Selbstcheck: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst bricht die Probe mit Exit 2 ab.
//   node tools/mutation-faden-bauplan.js [begriff ...] [--trocken]      (npm run test:faden-bauplan-mutation)
// Bewusst nicht in der Liste (aequivalente Mutanten): „Hinweise auch an der Enthuellung selbst (i <= erste)“ (die Enthuellung ist kein Hinweis-Traeger, die Schleife aendert mit den heutigen Daten nichts), „registriereAbenteuer: derselbe Inhalt ist schon eingetragen“ (reine Zeitersparnis: die erneute Pruefung gaebe dasselbe Ergebnis), „Wahrheit mit
// ungueltigem Hinweistext in bauplan.json: HINWEIS_TEXT des Pruefers“ (zweites Netz, katalogFehler meldet es vorher).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-bauplan-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TESTS = [['tools/test-faden-bauplan.js']];
for (const [t] of TESTS) fs.copyFileSync(path.join(ROOT, t), path.join(TMP, t));
for (const h of ['regie-fixture.js', 'faden-fixture.js']) fs.copyFileSync(path.join(ROOT, 'tools', h), path.join(TMP, 'tools', h));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul noetig */ } }

const BP = 'server/sim/faden-bauplan.js', PR = 'server/sim/faden-pruefer.js', FA = 'server/sim/faden.js', DD = 'server/sim/faden-daten.js',
  DB = 'content/faeden/beats.json', DW = 'content/faeden/werte.json', DP = 'content/faeden/bauplan.json', SC = 'content/schema/faden-bauplan.schema.json', SV = 'content/schema/faden-vorlage.schema.json', SW = 'content/schema/weltstand.schema.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  // ---- Expander: Kopf
  [BP, "if (plan.titel.trim().length < T.min || !textOk(plan.titel)) add(", "if (false) add(", 'Expander: Titel mit Platzhalter erlaubt'],
  [BP, "if (plan.anlass !== undefined && (plan.anlass.trim().length < A.min || plan.anlass.length > A.max || !textOk(plan.anlass))) add(", "if (false) add(", 'Expander: Anlass mit Platzhalter oder zu kurz erlaubt'],
  [BP, "for (const vk of volk) if (!W.voelker.includes(vk) || !N[vk]) add('VOLK'", "for (const vk of volk) if (false) add('VOLK'", 'Expander: unbekanntes Volk erlaubt'],
  [BP, "if (n < 2 || n > W.beats_max) add('BEATS_ANZAHL'", "if (false) add('BEATS_ANZAHL'", 'Expander: beliebig viele oder wenige Beats'],
  [BP, "if (n === 0) return ergebnis();", "", 'Expander: leerer Plan laeuft weiter (Absturz)'],
  [BP, "if (idx.has(id)) { add('ID_DOPPELT'", "if (false) { add('ID_DOPPELT'", 'Expander: doppelte Beat-Id erlaubt'],
  [BP, "add('TYP_UNBEKANNT'", "add('TYP_X'", 'Expander: unbekannter Typ ohne Code TYP_UNBEKANNT'],
  [BP, "add('BAUPLAN_TYP_NICHT_PLANBAR'", "add('TYP_X'", 'Expander: Typ ohne Standards ohne Code BAUPLAN_TYP_NICHT_PLANBAR'],
  // ---- Expander: Beats
  [BP, "&& i !== last) add('ABSCHLUSS_NICHT_LETZT'", "&& false) add('ABSCHLUSS_NICHT_LETZT'", 'Expander: Abschluss darf mitten im Plan stehen'],
  [BP, "if (namenlos && !((cat.braucht && cat.braucht.nsc_status) || []).includes('aktiv')) add(", "if (false) add(", 'Expander: namenlos mit Beat, der einen NSC im Zustand aktiv nicht zulaesst'],
  [BP, "add('PARAMETER', `Beat ${id} (${b.typ}): der Plan darf den Parameter", "add('PARAM_X', `Beat ${id} (${b.typ}): der Plan darf den Parameter", 'Expander: unbekannter Parameter ohne Code PARAMETER'],
  [BP, "if (!parameterErlaubt(s.erlaubt, v)) add(", "if (false) add(", 'Expander: Parameterwert ausserhalb der erlaubten'],
  [BP, "k === 'fluchtziel' ? 'FLUCHTZIEL_FEHLT' : 'PARAMETER'", "'PARAMETER'", 'Expander: Fluchtziel ohne Code FLUCHTZIEL_FEHLT'],
  [BP, "if (bp.optionen_pflicht && b.optionen === false) add(", "if (false) add(", 'Expander: Bitte ohne Optionen erlaubt'],
  [BP, "if (cat.gefahr) add('OPTION_BEI_GEFAHR'", "if (false) add('OPTION_BEI_GEFAHR'", 'Expander: Optionen bei Gefahr'],
  [BP, "add('OPTIONEN_NICHT_ERLAUBT'", "add('OPT_X'", 'Expander: Optionen bei Typ ohne Optionen ohne Code'],
  [BP, "const will = b.optionen === true || (bp.optionen_pflicht && b.optionen === undefined);", "const will = b.optionen === true;", 'Expander: Pflicht-Optionen der Bitte werden nicht gesetzt'],
  [BP, "if (cat.abschluss) { add('AUSGANG_UNGUELTIG'", "if (false) { add('AUSGANG_UNGUELTIG'", 'Expander: Verzweigung am Abschluss erlaubt'],
  [BP, "if (zi === undefined) { add('WEITER_UNGUELTIG'", "if (false) { add('WEITER_UNGUELTIG'", 'Expander: Sprung auf unbekannten Beat'],
  [BP, "else if (zi <= i) { add('WEITER_UNGUELTIG'", "else if (false) { add('WEITER_UNGUELTIG'", 'Expander: Rueckwaertssprung erlaubt'],
  [BP, "if (!cat.abschluss) add('ERFOLG_UNGUELTIG', `Beat ${id}: erfolg gibt es nur am Abschluss`)", "if (false) add('ERFOLG_UNGUELTIG', `Beat ${id}: erfolg gibt es nur am Abschluss`)", 'Expander: erfolg an einem Beat, der kein Abschluss ist'],
  [BP, "else if (b.erfolg.length > BW.erfolg_max) add(", "else if (false) add(", 'Expander: mehr erfolg-Typen als erfolg_max'],
  [BP, "if (!bs.some((x, j) => j !== i && x.typ === t && !cats[j].abschluss)) add('ERFOLG_UNGUELTIG'", "if (false) add('ERFOLG_UNGUELTIG'", 'Expander: erfolg nennt einen Typ, den der Plan nicht hat'],
  [BP, "(b.erfolg || typen.slice(-BW.erfolg_max))", "(b.erfolg || typen)", 'Expander: Standard-Erfolg nicht auf erfolg_max begrenzt'],
  [BP, "if (!cats[last].abschluss) add('ABSCHLUSS_FEHLT'", "if (false) add('ABSCHLUSS_FEHLT'", 'Expander: Plan ohne Abschluss'],
  // ---- Expander: Wahrheit und Hinweise
  [BP, "if (plan.wahrheit !== undefined && !has(BP.wahrheiten, plan.wahrheit)) add(", "if (false) add(", 'Expander: unbekannte Wahrheit'],
  [BP, "if (plan.wahrheit !== undefined && !bs.some((b, i) => braucht(i).wahrheit)) add(", "if (false) add(", 'Expander: Wahrheit ohne Enthuellung'],
  [BP, "if (!cats[i].bauplan.hinweis_traeger) continue;", "", 'Expander: Hinweise an jedem Beat statt nur an Traegern'],
  [BP, "const kand = wahrheit.hinweise.filter((h) => !namenlos || BP.hinweise[h].mit_name === false);", "const kand = wahrheit.hinweise.slice();", 'Expander: namenloses Abenteuer bekommt Hinweise mit {name}'],
  [BP, "if (braucht(i).hinweis_vorher && !h && !gemeldet.has(i)) {", "if (false) {", 'Expander: Hinweis auf jedem Weg nicht geprueft'],
  [BP, "const h2 = h || hinweisBeat[i].length > 0;", "const h2 = true;", 'Expander: Hinweis-Bit gilt immer als gesetzt'],
  [BP, "bs.forEach((b, i) => { if (!erreicht.has(i)) add('UNERREICHBAR'", "bs.forEach((b, i) => { if (false) add('UNERREICHBAR'", 'Expander: unerreichbarer Beat erlaubt'],
  // ---- Expander: Zustaende der Ausgaenge
  [BP, "if (!gl.length) add('STATUS_PASST_NICHT'", "if (false) add('STATUS_PASST_NICHT'", 'Expander: kein Zustand passt zum Folgebeat (gelungen)'],
  [BP, "else if (!gs.length) add('STATUS_PASST_NICHT'", "else if (false) add('STATUS_PASST_NICHT'", 'Expander: kein Zustand passt zum Folgebeat (gescheitert)'],
  [BP, "if (a !== c || zl.gelungen !== zl.gescheitert) { paar = [a, c]; break; }", "if (true) { paar = [a, c]; break; }", 'Expander: Gelingen und Scheitern duerfen gleich enden'],
  [BP, "if (zl.gelungen === zl.gescheitert && P.folgeProfil(o.gelungen.folge) === P.folgeProfil(o.gescheitert.folge)) add(", "if (false) add(", 'Expander: namenlos ohne Unterschied zwischen Gelingen und Scheitern'],
  [BP, "&& zl.gelungen === zl.gescheitert) {\n      add('OPTIONEN_GLEICHER_WEG'", "&& false) {\n      add('OPTIONEN_GLEICHER_WEG'", 'Expander: Annehmen und Ablehnen im selben Beat'],
  [BP, "const zulaessig = (ag) => bp.aus[ag].status.filter(", "const zulaessig = (ag) => bp.aus[ag].status.slice(0, 1).filter(", 'Expander: nur der erste Zustandskandidat der Daten'],
  [BP, "nsc: { status: namenlos ? 'aktiv' : cats[0].bauplan.start_status, haltung: BW.nsc_haltung_start },", "nsc: { status: 'aktiv', haltung: BW.nsc_haltung_start },", 'Expander: Start-Zustand des NSC immer aktiv'],
  [BP, "if (namenlos) v.nsc.rolle = 'namenlos';", "", 'Expander: namenlos ohne nsc.rolle'],
  // ---- Daten des Expanders: katalogFehler
  [BP, "if (!(typeof BW.id_praefix === 'string' && /^[a-z][a-z0-9_]*$/.test(BW.id_praefix) && BW.id_praefix.length + BW.id_hash_laenge <= 32)) f(", "if (false) f(", 'katalogFehler: Id-Praefix nicht geprueft'],
  [BP, "/^[a-z][a-z0-9_]*$/.test(BW.id_praefix) && BW.id_praefix.length", "BW.id_praefix.length", 'katalogFehler: Id-Praefix darf Grossbuchstaben haben'],
  [BP, " && BW.id_praefix.length + BW.id_hash_laenge <= 32)) f(", " && true)) f(", 'katalogFehler: Id darf laenger als 32 Zeichen sein'],
  [BP, "if (!(BW.ausloeser && W.ausloeser.includes(BW.ausloeser.art) && W.ausgaenge.includes(BW.ausloeser.ausgang))) f(", "if (false) f(", 'katalogFehler: ausloeser nicht geprueft'],
  [BP, "if (!BW.volk_erlaubt_standard.every((v) => W.voelker.includes(v) && N[v])) f(", "if (false) f(", 'katalogFehler: Standard-Volk nicht geprueft'],
  [BP, "if (!has(BP.wahrheiten, BW.wahrheit_standard)) f(", "if (false) f(", 'katalogFehler: wahrheit_standard nicht geprueft'],
  [BP, "if (!(Number.isInteger(BW.erfolg_max) && BW.erfolg_max >= 1)) f(", "if (false) f(", 'katalogFehler: erfolg_max nicht geprueft'],
  [BP, "else if (BW.erfolg_max > vs.erfolg.properties.ereignis.maxItems) f(", "else if (false) f(", 'katalogFehler: erfolg_max ueber dem Schema der Vorlage'],
  [BP, "if (!W.hinweis_kanaele.includes(h.kanal)) f(", "if (false) f(", 'katalogFehler: Hinweis-Kanal nicht geprueft'],
  [BP, "if (typeof h.mit_name !== 'boolean') f(", "if (false) f(", 'katalogFehler: mit_name nicht geprueft'],
  [BP, "if (typeof t !== 'string' || t.trim().length < 8 || t.length > W.hinweis_text_max) f(", "if (false) f(", 'katalogFehler: Hinweistext nicht geprueft'],
  [BP, "else if ((t.match(/\\{[^}]*\\}/g) || []).some((p) => p !== '{name}' && p !== '{ort}')) f(", "else if (false) f(", 'katalogFehler: fremde Platzhalter im Hinweis'],
  [BP, "else if (h.mit_name === false && t.includes('{name}')) f(", "else if (false) f(", 'katalogFehler: {name} in Hinweis ohne mit_name'],
  [BP, "else if (/^\\{name\\}\\s*:/.test(t)) f(", "else if (false) f(", 'katalogFehler: Hinweis beginnt mit {name}:'],
  [BP, "if (!/^[a-z][a-z0-9_]{1,31}$/.test(k)) f(`Wahrheit ${k}: Kennung", "if (false) f(`Wahrheit ${k}: Kennung", 'katalogFehler: Wahrheits-Kennung nicht geprueft'],
  [BP, "if (w.fraktion !== undefined && !W.voelker.includes(w.fraktion)) f(", "if (false) f(", 'katalogFehler: Fraktion der Wahrheit nicht geprueft'],
  [BP, "if (!hs.length || !hs.every((h) => has(BP.hinweise, h))) f(", "if (false) f(", 'katalogFehler: Hinweise der Wahrheit nicht geprueft'],
  [BP, "else if (!hs.some((h) => BP.hinweise[h].mit_name === false)) f(", "else if (false) f(", 'katalogFehler: kein Hinweis ohne {name} fuer namenlose Abenteuer'],
  [BP, "if (hs.length > 8) f(", "if (false) f(", 'katalogFehler: mehr als 8 Hinweise'],
  [BP, "if (!W.status.includes(bp.start_status) || !nsc.includes(bp.start_status)) g(", "if (false) g(", 'katalogFehler: start_status nicht geprueft'],
  [BP, "if (typeof bp.hinweis_traeger !== 'boolean') g(", "if (false) g(", 'katalogFehler: hinweis_traeger nicht geprueft'],
  [BP, "if (!erl.includes(k)) g(`Parameter ${k} steht", "if (false) g(`Parameter ${k} steht", 'katalogFehler: Parameter ausserhalb des Typ-Katalogs'],
  [BP, "if (!istObjekt(s) || s.standard === undefined || !parameterErlaubt(s.erlaubt, s.standard)) g(", "if (false) g(", 'katalogFehler: Standard ausserhalb von erlaubt'],
  [BP, "if (!P.TEXT_KEY.test(t)) g(", "if (false) g(", 'katalogFehler: text_key-Muster nicht geprueft'],
  [BP, "if (!has(D.BITTE.texte, t)) g(", "if (false) g(", 'katalogFehler: Bittentext fehlt in bitte-werte.json'],
  [BP, "for (const ton of D.HALTUNG.toene) if (has(D.BITTE.texte, t + '_' + ton.id)) g(", "for (const ton of D.HALTUNG.toene) if (false) g(", 'katalogFehler: Ton-Variante eines Bittentextes'],
  [BP, "} else if (cat.baustein === 'notruf' && !has(p3, t)) g(", "} else if (false) g(", 'katalogFehler: Notruf-Text fehlt in p3-texte.json'],
  [BP, "for (const k of spec.pflicht || []) if (!has(ps, k)) g(", "for (const k of spec.pflicht || []) if (false) g(", 'katalogFehler: Pflichtparameter ohne Standard'],
  [BP, "if (!istObjekt(o)) { g(`aus.${ag} fehlt`); continue; }", "if (false) { g(`aus.${ag} fehlt`); continue; }", 'katalogFehler: aus.<Ausgang> fehlt'],
  [BP, "if (!Array.isArray(o.folge)) g(", "if (false) g(", 'katalogFehler: aus.folge fehlt'],
  [BP, "{ const r = P.folgeWirkung(x, 'n1'); if (r.fehler) g(", "{ const r = P.folgeWirkung(x, 'n1'); if (false) g(", 'katalogFehler: ungueltige Folge in aus'],
  [BP, "if (!cat.abschluss && !(Array.isArray(o.status) && o.status.length", "if (false && !(Array.isArray(o.status) && o.status.length", 'katalogFehler: aus.status leer oder unbekannt'],
  [BP, "if (bp.optionen_pflicht && cat.optionen !== 'erlaubt') g(", "if (false) g(", 'katalogFehler: optionen_pflicht bei Typ ohne Optionen'],
  [BP, "if (cat.optionen !== 'erlaubt' || cat.gefahr) g('optionen nur bei", "if (false) g('optionen nur bei", 'katalogFehler: Optionen bei Gefahr'],
  [BP, "if (e.length) g('Standard-Optionen ungueltig: ' + e[0]);", "if (false) g('Standard-Optionen ungueltig: ' + e[0]);", 'katalogFehler: Standard-Optionen nicht gegen den Pruefer geprueft'],
  [BP, "} else if (bp.optionen_pflicht) g('optionen_pflicht ohne optionen');", "} else if (false) g('optionen_pflicht ohne optionen');", 'katalogFehler: optionen_pflicht ohne optionen'],
  [BP, "if (katalogCache.length) { fehler.push(katalogCache[0]); return ergebnis(); }", "", 'Expander: kaputte Daten werden nicht vor dem ersten Plan gemeldet'],
  // ---- Pruefer: namenlos und Abenteuer-Wege
  [PR, "if (namenlos && v.nsc.status !== undefined && v.nsc.status !== 'aktiv') fehler.push(", "if (false) fehler.push(", 'Pruefer: namenloser NSC darf in einem anderen Zustand starten'],
  [PR, "if (v.nsc && v.nsc.rolle !== undefined && !W.nsc_rollen.includes(v.nsc.rolle)) fehler.push(", "if (false) fehler.push(", 'Pruefer: unbekannte Rolle des NSC'],
  [PR, "if (b.variante && namenlos) fehler.push(", "if (false) fehler.push(", 'Pruefer: namenlos mit feindlicher Variante'],
  [PR, "if (namenlos && o.status !== undefined && o.status !== 'aktiv') fehler.push(", "if (false) fehler.push(", 'Pruefer: namenloser NSC wechselt den Zustand'],
  [PR, "if (o.status === undefined && !namenlos) fehler.push(", "if (o.status === undefined) fehler.push(", 'Pruefer: namenlos braucht trotzdem status'],
  [PR, "const gleicheFolge = !namenlos || folgeProfil(aus.gescheitert.folge) === folgeProfil(aus.gelungen.folge);", "const gleicheFolge = true;", 'Pruefer: namenlos zaehlt die Folge nicht als Unterschied'],
  [PR, "const gleicheFolge = !namenlos || folgeProfil(aus.gescheitert.folge) === folgeProfil(aus.gelungen.folge);", "const gleicheFolge = !namenlos;", 'Pruefer: namenlos darf folgenlos scheitern'],
  [PR, "const gleicheFolge = !namenlos || folgeProfil(aus.gescheitert.folge) === folgeProfil(aus.gelungen.folge);", "const gleicheFolge = false;", 'Pruefer: Scheitern ohne Zustandsunterschied nie folgenlos (04a-Regel geschwaecht)'],
  [PR, "if ((F.abenteuerAngebote || []).length >= W.abenteuer.angebote_max) return fehl(", "if (false) return fehl(", 'Pruefer: beliebig viele Abenteuer-Angebote'],
  [PR, "if (!(istObjekt(o) && typeof o.hex === 'string' && HEX.test(o.hex) && require('../../shared/sektoren.js').spielbar(o.hex))) return fehl(", "if (false) return fehl(", 'Pruefer: Abenteuer ohne spielbaren Ort'],
  [PR, "const abenteuerLaufend = (F) => aktive(F).filter((f) => f.plan).length;", "const abenteuerLaufend = (F) => aktive(F).filter((f) => !f.plan).length;", 'Pruefer: laufende Abenteuer falsch gezaehlt'],
  [PR, "if (!['volk', 'name'].includes(k)) return fehl('PARAMETER'", "if (false) return fehl('PARAMETER'", 'Pruefer: Abenteuer oeffnen mit unbekanntem Parameter'],
  [PR, "if (!a) return fehl('KEIN_ANGEBOT', `ein Abenteuer-Angebot", "if (false) return fehl('KEIN_ANGEBOT', `ein Abenteuer-Angebot", 'Pruefer: Abenteuer oeffnen ohne Angebot'],
  [PR, "if (aktive(F).length >= W.aktiv_max) return fehl('OBERGRENZE'", "if (false) return fehl('OBERGRENZE'", 'Pruefer: Abenteuer ueber der Obergrenze aktiver Faeden'],
  [PR, "if (abenteuerLaufend(F) >= W.abenteuer.laufend_max) return fehl(", "if (false) return fehl(", 'Pruefer: mehr als ein laufendes Abenteuer'],
  [PR, "if (p.volk !== undefined && !v.volk_erlaubt.includes(p.volk)) return fehl('PARAMETER', `volk \"${p.volk}\" ist fuer dieses Abenteuer", "if (false) return fehl('PARAMETER', `volk \"${p.volk}\" ist fuer dieses Abenteuer", 'Pruefer: Abenteuer mit unerlaubtem Volk'],
  [PR, "    if (F.liste.some((f) => f.nsc.name === p.name)) return fehl('NAME', `der Name ${p.name} ist schon vergeben`);\n  }\n  return null;\n}\n\nfunction befehlPruefen", "    if (false) return fehl('NAME', `der Name ${p.name} ist schon vergeben`);\n  }\n  return null;\n}\n\nfunction befehlPruefen", 'Pruefer: Abenteuer mit vergebenem Namen'],
  // ---- Abenteuer-Register
  [DD, "if (!istObjekt(v) || v.id !== abenteuerId(v)) return", "if (!istObjekt(v)) return", 'Register: Id muss nicht zum Inhalt passen'],
  [DD, "if (registry.has(v.id)) return { ok: false", "if (false) return { ok: false", 'Register: Abenteuer darf die Id einer Vorlage der Dateien tragen'],
  [DD, "  if (!r.ok) return { ok: false, fehler: r.fehler, id: null };\n  abenteuer.set(", "  abenteuer.set(", 'Register: ungeprueften Plan eintragen'],
  [DD, "return registry.get(id) || abenteuer.get(id) || null;", "return registry.get(id) || null;", 'Register: vorlage() findet kein Abenteuer'],
  [DD, "registry.clear(); abenteuer.clear();", "registry.clear();", 'Register: zuruecksetzen laesst Abenteuer stehen'],
  [DD, "kanonisch(x[k])).join(',') + '}';", "kanonisch(x[k])).join(',') + '}'.concat(Math.random());", 'Register: Id haengt vom Zufall ab'],
  [DD, "return BAUPLAN.werte.id_praefix + require('crypto').createHash('sha1').update(kanonisch(o)).digest('hex').slice(0, BAUPLAN.werte.id_hash_laenge);", "return BAUPLAN.werte.id_praefix + require('crypto').createHash('sha1').update(kanonisch({ titel: o.titel })).digest('hex').slice(0, BAUPLAN.werte.id_hash_laenge);", 'Register: Id haengt nur vom Titel ab'],
  // ---- Anbieten, Oeffnen, Laden, Takt
  [FA, "  for (const a of F.abenteuerAngebote) a.alter++;", "", 'Faden: Abenteuer-Angebote altern nicht'],
  [FA, "  F.abenteuerAngebote = F.abenteuerAngebote.filter((a) => a.alter <= W.abenteuer.angebot_gilt_taetigkeiten);", "", 'Faden: Abenteuer-Angebote verfallen nie'],
  [FA, "if (F.abenteuerAngebote.some((a) => a.ref === r.vorlage.id && a.hex === o.hex)) return abgelehnt(", "if (false) return abgelehnt(", 'Faden: dasselbe Abenteuer doppelt als Angebot'],
  [FA, "  if (!r.ok) return abgelehnt(r.fehler[0], r.fehler);", "", 'Faden: ungueltiger Plan wird angeboten'],
  [FA, "  const g = P.pruefeAbenteuerAnbieten(F, o);\n  if (g) return abgelehnt(g);", "", 'Faden: Angebots-Grenzen werden beim Anbieten nicht geprueft'],
  [FA, "  const g = P.pruefeAbenteuerOeffnen(F, nr, p);\n  if (g) return abgelehnt(g);", "", 'Faden: Oeffnen ohne Pruefung (Grenzen, Parameter)'],
  [FA, "const f = { id: 'f' + F.nr, vorlage: v.id, plan: klon(v), parameter: { volk, ort: a.hex,", "const f = { id: 'f' + F.nr, vorlage: v.id, parameter: { volk, ort: a.hex,", 'Faden: der Plan steht nicht im Faden (nicht im Weltstand)'],
  [FA, "  f.abstand = abstandZiehen(game, f);\n  F.liste.push(f);\n  while (F.liste.length > W.faeden_gesamt_max) {\n    const i = F.liste.findIndex((x) => x.phase === 'abgeschlossen');\n    if (i < 0) break;\n    F.liste.splice(i, 1);\n  }\n  melde(game, 'geoeffnet', f.id, `Abenteuer", "  f.abstand = 0;\n  F.liste.push(f);\n  while (F.liste.length > W.faeden_gesamt_max) {\n    const i = F.liste.findIndex((x) => x.phase === 'abgeschlossen');\n    if (i < 0) break;\n    F.liste.splice(i, 1);\n  }\n  melde(game, 'geoeffnet', f.id, `Abenteuer", 'Faden: Abenteuer ohne Abstand zum ersten Beat'],
  [FA, "F.abenteuerAngebote.splice(F.abenteuerAngebote.indexOf(a), 1);", "", 'Faden: das Angebot bleibt nach dem Oeffnen stehen'],
  [FA, "if (!aktiv(game)) return { ok: false, grund: 'INAKTIV: Faeden sind nicht eingeschaltet' };\n  const F = zustandVon(game);\n  o = istObjekt(o) ? o : {};", "const F = zustandVon(game);\n  o = istObjekt(o) ? o : {};", 'Faden: Abenteuer anbieten ohne Schalter FAEDEN=1'],
  [FA, "if (!aktiv(game)) return { ok: false, grund: 'INAKTIV: Faeden sind nicht eingeschaltet' };\n  const F = zustandVon(game), ws = game.weltsim;", "const F = zustandVon(game), ws = game.weltsim;", 'Faden: Abenteuer oeffnen ohne Schalter FAEDEN=1'],
  [FA, "const reg = istObjekt(x.plan) && x.plan.id === x.vorlage ? D.registriereAbenteuer(x.plan) : { ok: false, fehler: ['ABENTEUER_ID: der Plan gehoert nicht zu diesem Faden'] };", "const reg = D.registriereAbenteuer(x.plan);", 'Laden: der Plan muss nicht zur Vorlage des Fadens gehoeren'],
  [FA, "if (!reg.ok) return { fehler: `${x.id}: Plan ungültig", "if (false) return { fehler: `${x.id}: Plan ungültig", 'Laden: ungueltiger gespeicherter Plan wird nicht verworfen'],
  [FA, "} else if (D.istAbenteuer(x.vorlage)) return { fehler:", "} else if (false) return { fehler:", 'Laden: Abenteuer ohne Plan wird gespielt'],
  [FA, "if (r.faden.plan && r.faden.phase !== 'abgeschlossen' && P.abenteuerLaufend(F) >= W.abenteuer.laufend_max) {", "if (false) {", 'Laden: mehr als ein laufendes Abenteuer im Stand'],
  [FA, "plan = klon(D.vorlage(x.vorlage));", "plan = null;", 'Laden: der Plan geht beim Laden verloren'],
  // ---- Daten
  [DW, '"abenteuer": {"wert": {"laufend_max": 1,', '"abenteuer": {"wert": {"laufend_max": 2,', 'Daten: zwei laufende Abenteuer erlaubt'],
  [DW, '"angebote_max": 3,', '"angebote_max": 4,', 'Daten: vier Abenteuer-Angebote erlaubt'],
  [DW, '"angebot_gilt_taetigkeiten": 12}', '"angebot_gilt_taetigkeiten": 13}', 'Daten: Abenteuer-Angebot gilt 13 statt 12 Taetigkeiten'],
  [DW, '"nsc_rollen": {"wert": ["namenlos"]', '"nsc_rollen": {"wert": ["namenlos", "spion"]', 'Daten: zusaetzliche Rolle des NSC'],
  [DP, '"id_praefix": {"wert": "abenteuer_"', '"id_praefix": {"wert": "plan_"', 'Daten: anderer Id-Praefix'],
  [DP, '"id_hash_laenge": {"wert": 12', '"id_hash_laenge": {"wert": 10', 'Daten: kuerzerer Hash in der Id'],
  [DP, '"volk_erlaubt_standard": {"wert": ["rom", "kon"]', '"volk_erlaubt_standard": {"wert": ["rom"]', 'Daten: Standard-Volk nur rom'],
  [DP, '"nsc_haltung_start": {"wert": 0', '"nsc_haltung_start": {"wert": 1', 'Daten: Start-Haltung 1'],
  [DP, '"anlass": {"wert": {"min": 8,', '"anlass": {"wert": {"min": 3,', 'Daten: Anlass ab 3 Zeichen'],
  [DP, '"erfolg_max": {"wert": 4,', '"erfolg_max": {"wert": 2,', 'Daten: Erfolg zaehlt nur zwei Typen'],
  [DP, '"ausloeser": {"wert": {"art": "notruf", "ausgang": "gelungen"}', '"ausloeser": {"wert": {"art": "notruf", "ausgang": "gescheitert"}', 'Daten: Ausloeser notruf/gescheitert'],
  [DP, '"mit_name": false, "text": "Scan bei {ort}: Der Transponder', '"mit_name": true, "text": "Scan bei {ort}: Der Transponder', 'Daten: Hinweis h_scan faelschlich mit mit_name'],
  [DP, '"hinweise": ["h_gerucht", "h_papiere", "h_scan", "h_hafenfunk"]', '"hinweise": ["h_gerucht", "h_papiere"]', 'Daten: Wahrheit hat nur Hinweise mit {name}'],
  [DP, '"fraktion": "ger", "hinweise"', '"fraktion": "rom", "hinweise"', 'Daten: Wahrheit ist roemisch statt germanisch'],
  [DB, '"start_status":"gefangen"', '"start_status":"aktiv"', 'Daten: Befreiung startet aktiv'],
  [DB, '"gelungen":{"status":["tot","feindlich","aktiv"]', '"gelungen":{"status":["feindlich","tot","aktiv"]', 'Daten: Raumschlacht gelungen zuerst feindlich'],
  [DB, '"gelungen":{"status":["verbuendet","gefangen","aktiv"]', '"gelungen":{"status":["aktiv","verbuendet","gefangen"]', 'Daten: Notruf gelungen zuerst aktiv'],
  [DB, '"hinweis_traeger":true,"optionen_pflicht"', '"hinweis_traeger":false,"optionen_pflicht"', 'Daten: Bitte ist kein Hinweis-Traeger'],
  [DB, '"optionen_pflicht":true', '"optionen_pflicht":false', 'Daten: Bitte braucht keine Optionen'],
  [DB, '"hinweis_traeger":true,"parameter":{"text_key":{"standard":"notruf_standard"', '"hinweis_traeger":false,"parameter":{"text_key":{"standard":"notruf_standard"', 'Daten: Notruf ist kein Hinweis-Traeger'],
  [DB, '"standard":"hilfe_rom"', '"standard":"hilfe_kon"', 'Daten: Standardtext der Bitte hilfe_kon'],
  [DB, '"standard":"naechster_sprungpunkt"', '"standard":"heimat"', 'Daten: Standard-Fluchtziel heimat'],
  [DB, '{"id":"annehmen","text":"Wir helfen euch.","ausgang":"gelungen"', '{"id":"annehmen","text":"Wir helfen euch.","ausgang":"gescheitert"', 'Daten: Option annehmen fuehrt zu gescheitert'],
  [DB, '"gelungen":{"status":["verbuendet","aktiv"],"folge":[]},"gescheitert":{"status":["aktiv","geflohen"],"folge":[]}}}', '"gelungen":{"status":["verbuendet","aktiv"],"folge":[]},"gescheitert":{"status":["geflohen","aktiv"],"folge":[]}}}', 'Daten: Bitte gescheitert zuerst geflohen'],
  // ---- Schemas
  [SC, '"namenlos": {"type": "boolean"', '"namenlos": {"type": "string"', 'Schema Bauplan: namenlos darf ein Text sein'],
  [SC, '"required": ["format", "titel", "beats"]', '"required": ["format", "titel"]', 'Schema Bauplan: beats nicht Pflicht'],
  [SC, '"format": {"const": "faden-bauplan/1"}', '"format": {"type": "string"}', 'Schema Bauplan: beliebiges Format'],
  [SC, '"additionalProperties": false,\n  "required": ["format", "titel", "beats"]', '"required": ["format", "titel", "beats"]', 'Schema Bauplan: unbekannte Felder im Plan erlaubt'],
  [SW, '"plan":{"type":"object"', '"plan":{"type":"string"', 'Schema Weltstand: plan darf kein Objekt sein'],
  [SV, '"rolle": {\n          "type": "string",\n          "maxLength": 12,', '"rolle": {\n          "type": "number",\n          "maxLength": 12,', 'Schema Vorlage: nsc.rolle ist keine Zeichenkette'],
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
console.log(`Mutationsprobe test-faden-bauplan.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
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
