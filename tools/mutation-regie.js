'use strict';
// SUND-03 A: Mutationsprobe zu tools/test-befehle.js, test-regie.js, test-lage-ausschnitt.js. Kopiert Server, Shared, Content und die Tests in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je
// Lauf EINE Regel und verlangt, dass mindestens einer der Tests rot wird (Exit != 0): zuerst der Kern-Test, dann der Regie-Test, dann der Ausschnitt-Test. Überlebt eine Mutation, deckt kein Test die Regel ab.
//   node tools/mutation-regie.js [begriff …]      (npm run test:regie-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-regie-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools', 'fixtures'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'tools', 'fixtures', 'weltsim-golden-ohne-befehle.json'), path.join(TMP, 'tools', 'fixtures', 'weltsim-golden-ohne-befehle.json'));
const TESTS = [['tools/test-befehle.js'], ['tools/test-regie.js'], ['tools/test-lage-ausschnitt.js'], ['tools/test-absichten.js']];   // test-absichten: die Strategischen Optionen müssen heil bleiben
for (const [t] of TESTS) fs.copyFileSync(path.join(ROOT, t), path.join(TMP, t));
fs.copyFileSync(path.join(ROOT, 'tools', 'regie-fixture.js'), path.join(TMP, 'tools', 'regie-fixture.js'));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const B = 'server/weltsim/befehle.js', K = 'server/weltsim/kern.js', R = 'server/sim/regie-befehle.js', KL = 'server/sim/kriegslage.js', L = 'server/sim/lage-ausschnitt.js',
  DB = 'content/welt/befehle-werte.json', DR = 'content/welt/regie-werte.json', E = 'server/weltsim/ereignisse.js', TX = 'content/flotte/lage-befehle.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
// Bewusst nicht in der Liste (äquivalente Mutanten): „Rollback der Warteschlange (ws.regie = regieSicher, Reviewer N8)“ (seit Runde 2 verwirft tickGescheitert die fälligen Befehle ohnehin, die übrigen hat der Tick nie angefasst), „handel() prüft das Ende des Embargos zusätzlich selbst (z.tick < bis)“ (ablauf() löscht es im selben Tick, die zweite Prüfung ist Gürtel und Hosenträger),
// „pruefeIn fängt einen werfenden Prüfer ab“ (der Katalog wirft nie mit gültigen Typen; der Fänger ist Schutz vor Müll, den die Felder-Prüfung schon abweist), „zustandVon legt den Regie-Zustand an“ (jede Partie legt ihn selbst an).
const MUTATIONEN = [
  // ---- Kern: angreifen
  [B, "      if (!A.hauptwelt_erlaubt && Object.values(d.hauptwelten).includes(b.ziel)) return 'Hauptwelten sind kein Ziel eines Befehls';\n", "", 'angreifen: Hauptwelt als Ziel erlaubt'],
  [B, "return st.U < A.min_munition || st.T < A.min_treibstoff ?", "return st.U < A.min_munition ?", 'angreifen: Treibstoff wird nicht geprüft'],
  [B, "return st.U < A.min_munition || st.T < A.min_treibstoff ?", "return st.T < A.min_treibstoff ?", 'angreifen: Munition wird nicht geprüft'],
  [B, "      if (a.tot < a.need) return `zu schwach", "      if (false) return `zu schwach", 'angreifen: zu schwache Flotte geht durch'],
  [B, "      if (a.slots <= 0) return 'keine freie Flotte (max_active erreicht)';\n", "", 'angreifen: max_active wird ignoriert'],
  [B, "if (ids !== null && ids.length > a.slots)", "if (false)", 'angreifen: mehr feste Flotten als freie Plätze'],
  [B, "      if (z.angriffe.some((r) => r.t_ende === null && r.ziel === b.ziel && r.von === b.fraktion)) return 'Feldzug auf dieses Ziel läuft schon';\n", "", 'angreifen: derselbe Feldzug doppelt'],
  [B, "if (!fl || fl.fraktion !== b.fraktion) return `Flotte ${id} gehört nicht zu ${b.fraktion}`;", "if (!fl) return `Flotte ${id} gehört nicht zu ${b.fraktion}`;", 'angreifen: fremde Flotte als feste Flotte'],
  [B, "          if (!istBereit(fl)) return `Flotte ${id} ist nicht bereit (unterwegs oder zu schwach)`;\n", "", 'angreifen: unterwegs befindliche feste Flotte'],
  [B, ".filter((fl) => !fl.miete && (b.von === undefined", ".filter((fl) => (b.von === undefined", 'angreifen: Auswahl nimmt Mietflotten'],
  [B, "flotten: a.chosen.map((fl) => fl.id), befohlen: true });", "flotten: a.chosen.map((fl) => fl.id) });", 'angreifen: Feldzug trägt nicht befohlen'],
  [B, "      if (!REICH.includes(b.fraktion)) return 'fraktion muss rom oder ger sein';\n      if (!w.war)", "      if (!w.war)", 'angreifen: Konkordat als Angreifer'],
  [B, "      if (b.flotten !== undefined && b.flotte !== undefined) return 'flotte und flotten schließen sich aus';\n", "", 'angreifen: flotte und flotten zugleich'],
  [B, "H.dd(c, fl.ort, b.ziel) > A.reichweite) return `Flotte ${id} ist zu weit", "false) return `Flotte ${id} ist zu weit", 'angreifen: feste Flotte zu weit vom Ziel'],
  [B, "  for (const k of Object.keys(b)) if (!FELDER[b.typ].includes(k)) return `unbekanntes Feld \"${k}\"`;", "  void FELDER;", 'Prüfer: Fremdfelder werden nicht abgelehnt'],
  [B, "      if (!(H.FRAKTIONEN.includes(nd.besitzer) && H.feindlich(b.fraktion, nd.besitzer) && H.istStuetzknoten(c, b.ziel))) return", "      if (!(H.FRAKTIONEN.includes(nd.besitzer) && H.istStuetzknoten(c, b.ziel))) return", 'angreifen: Angriff auf den eigenen Hafen'],
  // ---- Kern: beanspruchen, verstaerken, rueckzug
  [B, "      if (z.vorrat[b.fraktion].E < w.posten_e) return 'zu wenig Ersatzteile';\n", "", 'beanspruchen: ohne Ersatzteile'],
  [B, "      if (z.hexe[b.sektor].besitzer !== null || H.istHafen(c, b.sektor)) return 'Sektor ist nicht frei';", "      if (H.istHafen(c, b.sektor)) return 'Sektor ist nicht frei';", 'beanspruchen: besetzter Sektor'],
  [B, "x.staerke >= c.w.garrison + 1 && H.dd(c, x.ort, b.sektor)", "H.dd(c, x.ort, b.sektor)", 'beanspruchen: Flotte ohne Garnisonsstärke'],
  [B, "      if (z.flotten.some((o) => o.fraktion === b.fraktion && o.befehl === 'anspruch' && o.ziel === b.sektor)) return 'ein Anspruch auf diesen Sektor läuft schon';\n", "", 'beanspruchen: derselbe Sektor doppelt'],
  [B, "      if (b.hafen === fl.heimat) return 'Flotte liegt dort schon';\n", "", 'verstaerken: Flotte liegt schon dort'],
  [B, "z.hexe[b.hafen].besitzer !== fl.fraktion || !H.istHafen(c, b.hafen)) return 'Ziel ist kein eigener Hafen';", "!H.istHafen(c, b.hafen)) return 'Ziel ist kein eigener Hafen';", 'verstaerken: fremder Hafen als Ziel'],
  [B, "      fl.heimat = b.hafen; fl.befehl = 'rueckzug'; fl.ziel = b.hafen;", "      fl.befehl = 'rueckzug'; fl.ziel = b.hafen;", 'verstaerken: setzt die Heimat nicht um'],
  [B, "      if (fl.befehl !== 'heim' || fl.ort !== fl.heimat) return 'Flotte ist unterwegs';\n      if (!istHex(z, b.hafen))", "      if (!istHex(z, b.hafen))", 'verstaerken: unterwegs befindliche Flotte'],
  [B, "      if (!['angriff', 'anspruch', 'sammeln'].includes(fl.befehl)) return 'Flotte steht nicht im Einsatz';\n", "", 'rueckzug: ruhige Flotte'],
  [B, "      if (rec && rec.phase === 'sammeln') fl.angriff = null;   // wie sammeln() beim Abbruch", "", 'rueckzug: sammelnde Flotte bleibt am Feldzug'],
  [B, "      if (!fl || fl.fraktion !== b.fraktion || !H.FRAKTIONEN.includes(fl.fraktion)) return 'unbekannte Flotte';\n      if (!['angriff'", "      if (!fl) return 'unbekannte Flotte';\n      if (!['angriff'", 'rueckzug: Flotte einer anderen Fraktion'],
  // ---- Kern: nachschub
  [B, "if (z.vorrat.kon[gut] - N.kon_reserve < menge)", "if (z.vorrat.kon[gut] < menge)", 'nachschub: das Konkordat gibt seine Reserve her'],
  [B, "  if (z.marken[an] < menge * w.price_sell * N.preis_faktor) return 'Marken reichen nicht';\n", "", 'nachschub: ohne Marken'],
  [B, "      z.vorrat[b.an][b.gut] += b.menge; z.vorrat.kon[b.gut] -= b.menge;\n      z.marken[b.an] -= preis; z.marken.kon += preis;", "      z.vorrat[b.an][b.gut] += b.menge; z.vorrat.kon[b.gut] -= b.menge;", 'nachschub: keine Marken-Senke'],
  [B, "      z.vorrat[b.an][b.gut] += b.menge; z.vorrat.kon[b.gut] -= b.menge;\n", "      z.vorrat[b.an][b.gut] += b.menge;\n", 'nachschub: Vorrat des Konkordats bleibt'],
  [B, "      if (embargoAktiv(z, b.an)) return `Embargo gegen ${b.an}: das Konkordat liefert nicht`;\n", "", 'nachschub: Lieferung unter Embargo'],
  [B, "kauf: {} } }, menge: b.menge });", "kauf: {} } }, menge: 1 });", 'nachschub: Ereignis konvoi mit falscher Menge'],
  [B, "if (!REICH.includes(b.an)) return 'an muss rom oder ger sein';\n      if (typeof b.gut", "if (typeof b.gut", 'nachschub: Nachschub an das Konkordat'],
  // ---- Kern: embargo
  [B, "      if (embargoAktiv(z, b.gegen)) return `gegen ${b.gegen} läuft schon ein Embargo (eines je Ziel)`;\n", "", 'embargo: zweites Embargo gegen dasselbe Ziel'],
  [B, "      if (!E.von.includes(b.von)) return 'nur das Konkordat verhängt ein Embargo (von: kon)';\n", "", 'embargo: andere Fraktion als Absender'],
  [B, "new Set(b.waren).size !== b.waren.length || ", "", 'embargo: doppelte Waren'],
  [B, "from: z.tick, bis: z.tick + b.dauer + 1 };", "from: z.tick, bis: z.tick + b.dauer + 51 };", 'embargo: Dauer ignoriert die Befehlsdauer'],
  [B, "return Number.isInteger(dauer) && dauer >= r.min && dauer <= r.max ? null", "return Number.isInteger(dauer) && dauer >= r.min ? null", 'Dauer: keine Obergrenze'],
  [B, "return Number.isInteger(dauer) && dauer >= r.min && dauer <= r.max ? null", "return Number.isInteger(dauer) && dauer <= r.max ? null", 'Dauer: keine Untergrenze'],
  [B, "      if (z.tick < z.embargo[f].bis) continue;\n", "      continue;\n", 'ablauf: Embargo endet nie'],
  [B, "    if (!Object.keys(z.embargo).length) delete z.embargo;", "", 'ablauf: leeres Embargo bleibt im Zustand'],
  [B, "      H.melde(c, 'embargo_beendet', 'kon', { gegen: f });", "", 'ablauf: kein Ereignis beim Ende des Embargos'],
  [B, "      if (rg.fokus && z.tick >= rg.fokus.bis) delete rg.fokus;\n", "", 'ablauf: Fokus endet nie'],
  [B, "z.tick >= rg.regler_bis) {", "z.tick >= rg.regler_bis + 999) {", 'ablauf: Regler enden nie'],
  [B, "      if (rg.ruhe_bis !== undefined && z.tick >= rg.ruhe_bis) delete rg.ruhe_bis;\n", "", 'ablauf: Ruhe endet nie'],
  [B, "    if (!Object.keys(z.regie).length) delete z.regie;", "", 'ablauf: leere Regie bleibt im Zustand'],
  [B, "if (!fl.miete || z.tick < fl.miete.bis) continue;", "if (!fl.miete || z.tick < fl.miete.bis + 999) continue;", 'ablauf: Miete endet nie'],
  [B, "    fl.fraktion = m.von; delete fl.miete;", "    fl.fraktion = m.von;", 'ablauf: Miete bleibt als Feld stehen'],
  [B, "    fl.fraktion = m.von; delete fl.miete;", "    delete fl.miete;", 'ablauf: Flotte kehrt nicht zum Konkordat zurück'],
  [B, "    H.melde(c, 'soeldner_zurueck', 'kon', { an: m.an, staerke: H.rund(fl.staerke) });", "", 'ablauf: kein Ereignis bei der Rückkehr'],
  // ---- Kern: soeldner
  [B, "b.flotten.length > S.flotten_max || !b.flotten.every(istId)", "!b.flotten.every(istId)", 'soeldner: beliebig viele Flotten'],
  [B, "+ b.flotten.length > S.aktiv_max_je_an) return", "+ b.flotten.length > 99) return", 'soeldner: Obergrenze Mietflotten je Mieter'],
  [B, "if (!fl || fl.fraktion !== 'kon' || fl.miete) return", "if (!fl || fl.miete) return", 'soeldner: Flotte eines Reichs als Mietflotte'],
  [B, "      if (z.marken[b.an] < preis) return `Marken reichen nicht (${preis} nötig)`;\n", "", 'soeldner: Miete ohne Marken'],
  [B, "fl.miete = { von: 'kon', an: b.an, bis: z.tick + b.dauer, preis }; fl.fraktion = b.an;", "fl.miete = { von: 'kon', an: b.an, bis: z.tick + b.dauer, preis };", 'soeldner: Flotte wechselt die Fraktion nicht'],
  [B, "        z.marken[b.an] -= preis; z.marken.kon += preis;\n        fl.miete", "        fl.miete", 'soeldner: Marken fließen nicht zum Konkordat'],
  [B, "      if (embargoAktiv(z, b.an)) return `Embargo gegen ${b.an}: das Konkordat vermietet nicht`;\n", "", 'soeldner: Miete unter Embargo'],
  [B, "      if (b.von !== 'kon') return 'nur das Konkordat vermietet (von: kon)';\n", "", 'soeldner: andere Fraktion als Vermieter'],
  [K, "fl.staerke >= 0.7 * fl.kap && !fl.miete);   // Mietflotten", "fl.staerke >= 0.7 * fl.kap);   // Mietflotten", 'Standard-KI setzt Mietflotten ein'],
  [K, "fl.fraktion === f && !fl.miete && fl.befehl === 'heim'", "fl.fraktion === f && fl.befehl === 'heim'", 'Mieter zahlt Neubau der Mietflotte'],
  // ---- Kern: piratenueberfall
  [B, "      if (z.hexe[b.ort].besitzer === null) return 'Ort hat keinen Besitzer';\n", "", 'piratenueberfall: Ort ohne Besitzer'],
  [B, "d.distP[fl.heimat][ziel] <= P.netz_sprunge)", "d.distP[fl.heimat][ziel] <= 99)", 'piratenueberfall: beliebig weit vom Piratennetz'],
  [B, "fl.staerke >= P.bereit_anteil * fl.kap && d.distP", "d.distP", 'piratenueberfall: schwache Piratenflotte'],
  [B, "      if (z.angriffe.some((r) => r.t_ende === null && r.ziel === b.ort && r.art === 'pirat')) return 'ein Überfall auf diesen Ort läuft schon';\n", "", 'piratenueberfall: derselbe Ort doppelt'],
  [B, "      if (z.hexe[b.ort].besitzer === 'pirat') return 'Ort gehört den Piraten';\n", "", 'piratenueberfall: Ort der Piraten'],
  // ---- Kern: fokus, regler, wirksam, Ruhe
  [K, "const { p_act: pAct, aggr, max_active: maxActive, fokus } = Befehle.wirksam(z, f);", "const { p_act: pAct, aggr, max_active: maxActive } = Befehle.wirksam(z, f); const fokus = null;", 'Standard-KI liest den Fokus nicht'],
  [K, "if (fokus && dd(c, code, fokus.hex) > fokus.radius) continue;", "", 'Fokus beschränkt die Angriffsziele nicht'],
  [B, "    p_act: ab.p_act !== undefined ? ab.p_act : (rg.p_act !== undefined ? rg.p_act : w.p_act),", "    p_act: rg.p_act !== undefined ? rg.p_act : (ab.p_act !== undefined ? ab.p_act : w.p_act),", 'Schichtung: Regie überstimmt die Wahl der Crew'],
  [B, "    fokus: rg.fokus || null,", "    fokus: null,", 'wirksam liefert den Fokus nicht'],
  [B, "      rg.regler_bis = c.z.tick + b.dauer;", "", 'regler: ohne Ende'],
  [B, "      rg.fokus = { hex: b.hex, radius: b.radius, bis: c.z.tick + b.dauer };", "      rg.fokus = { hex: b.hex, radius: b.radius, bis: c.z.tick + b.dauer + 99 };", 'fokus: Dauer ignoriert die Befehlsdauer'],
  [B, "if (!istZahl(b[k]) || b[k] < R[k].min || b[k] > R[k].max)", "if (!istZahl(b[k]) || b[k] < R[k].min)", 'regler: keine Obergrenze'],
  [B, "      return n ? null : 'mindestens einer der Regler p_act, aggr, max_active';", "      return null;", 'regler: leerer Regler-Befehl'],
  [B, "(rg.ruhe_bis !== undefined && z.tick < rg.ruhe_bis ? 0 :", "(false ? 0 :", 'Ruhe wirkt nicht'],
  [B, "    ruheSetzen(c, b);\n", "", 'Angriff setzt keine Ruhe'],
  [B, "  if (!(t > 0) || !REICH.includes(f)) return;\n", "  if (!(t > 0)) return;\n", 'Ruhe auch für das Konkordat'],
  [B, "    aggr: ab.aggr !== undefined ? ab.aggr : (rg.ruhe_bis", "    aggr: (rg.ruhe_bis", 'Ruhe überstimmt die Wahl der Crew'],
  // ---- Kern: Rahmen
  [K, "  Befehle.ablauf(c);", "", 'Kern: ablauf wird nicht gerufen'],
  [K, "  if (c.befehle) Befehle.anwenden(c);", "", 'Kern: Befehle werden nie angewandt'],
  [K, "  wirtschaft(c);\n  if (c.befehle) Befehle.anwenden(c);", "  if (c.befehle) Befehle.anwenden(c);\n  wirtschaft(c);", 'Kern: Befehle vor der Wirtschaft'],
  [K, "  ki(c);\n  bewegung(c);", "  bewegung(c);\n  ki(c);", 'Kern: Standard-KI nach der Bewegung (Reihenfolge der Sim)'],
  [K, "befehle: { angewandt: c.angewandt, abgelehnt: c.abgelehnt } }", "befehle: { angewandt: c.angewandt, abgelehnt: [] } }", 'Kern: Ablehnungen gehen nicht zurück'],
  [K, "      if (sanktion && sanktion[r] && z.tick >= sanktion[r].from && z.tick < sanktion[r].bis && sanktion[r].waren.includes(g)) continue;\n", "", 'handel: Embargo wirkt nicht'],
  [K, "sanktion[r].waren.includes(g)) continue;", "sanktion[r].waren.includes('X')) continue;", 'handel: Embargo sperrt andere Waren'],
  [K, "  if (befehle !== undefined && !Array.isArray(befehle)) throw new Error('Weltsim: befehle muss eine Liste sein');\n", "", 'Kern: befehle, die keine Liste sind, werden still hingenommen'],
  [B, "    if (gueltig.length >= W.je_tick_max.wert) { verworfen.push", "    if (gueltig.length >= 999) { verworfen.push", 'filtere: keine Obergrenze je Tick'],
  [B, "    if (n >= W.je_tick_max.wert) { c.abgelehnt.push", "    if (n >= 999) { c.abgelehnt.push", 'anwenden: keine Obergrenze je Tick'],
  [B, "const probe = Object.assign(JSON.parse(JSON.stringify(rest)), { werte: zustand.werte, karte: zustand.karte });", "const probe = zustand; void rest;", 'filtere: ändert den Zustand'],
  [B, "    c.angewandt.push(b); n++;", "    c.angewandt.push(b);", 'anwenden: zählt die angewandten Befehle nicht'],
  [B, "if (!W.embargo.wert.gegen.includes(f) || !objekt(e) ||", "if (!objekt(e) ||", 'bereinige: Embargo gegen jede Fraktion'],
  [B, "const waren = e.waren.filter((g, i, l) => W.embargo.wert.waren.includes(g) && l.indexOf(g) === i);", "const waren = e.waren.slice();", 'bereinige: unbekannte Waren bleiben'],
  [B, "if (!objekt(m) || m.von !== 'kon' || !REICH.includes(m.an) || fl.fraktion !== m.an || !ganzZahl(m.bis) || !istZahl(m.preis) || m.preis < 0) delete fl.miete;", "if (false) delete fl.miete;", 'bereinige: kaputte Miete bleibt'],
  [KL, "Kern.BEFEHLE.bereinige(z);", "", 'Laden: Bereinigung fehlt'],
  // ---- Spielaufsatz: Plan, Regeln, Vorwarnung
  [R, "    const ab = n0 + 1 + (w ? vorlaufVon(w.art) : 0);", "    const ab = n0 + 1;", 'Vorwarnung: kein Vorlauf'],
  [R, "const vorlaufVon = (art) => Math.max(R.vorwarnung.wert.mindest_vorlauf, ganz(R.vorwarnung.wert.vorlauf[art], 0), 1);", "const vorlaufVon = (art) => ganz(R.vorwarnung.wert.vorlauf[art], 0);", 'Vorwarnung: Mindestvorlauf nicht erzwungen'],
  [R, "return b.gegen === 'rom' ? { art: 'embargo' } : null;", "return null;", 'Vorwarnung: Embargo gegen Rom unangekündigt'],
  [R, "z.hexe[ort].besitzer !== 'rom') return null;", "false) return null;", 'Vorwarnung: auch Angriffe auf andere Orte warnen'],
  [R, "  for (const f of funk) funkSenden(game, f);\n", "", 'Vorwarnung: kein Funk'],
  [R, "    if (a._w) { const f = vorwarnText(a._w, a.ab, n0, a.befehl); if (f) funk.push(f); }", "", 'Vorwarnung: kein Text'],
  [R, "    s.letzte[a._key] = n0;\n", "", 'Abkühlzeit wird nicht gemerkt'],
  [R, "ws.tickZahl - s.letzte[key] < abk)", "ws.tickZahl - s.letzte[key] < 0)", 'Abkühlzeit gilt nie'],
  [R, "    if (kennzahl.sieger === 'offen') return", "    if (false) return", 'Embargo bei offenem Sieger'],
  [R, "    if (b.gegen !== kennzahl.sieger) return", "    if (false) return", 'Embargo gegen die Verliererseite'],
  [R, "if (i >= 0 && ganz(R.abkuehlung.wert[kopie.typ], 0) > 0 && kand.some((k) => k.key === key))", "if (false)", 'derselbe Typ doppelt im selben Plan'],
  [R, "if (planN > R.plan.wert.befehle_max)", "if (planN > 99)", 'Plan: beliebig viele Befehle'],
  [R, "if (s.vorgemerkt.length + kand.length >= R.plan.wert.vorgemerkt_max)", "if (false)", 'Warteschlange ohne Obergrenze'],
  [R, "  if (!istObjekt(p)) return { fehler: 'Plan ist kein Objekt' };", "", 'Plan: Nicht-Objekt wird angenommen'],
  [R, "  for (const k of Object.keys(p)) if (!PLAN_FELDER.includes(k)) return", "  for (const k of []) if (!PLAN_FELDER.includes(k)) return", 'Plan: Fremdfelder'],
  [R, "  const { gueltig, verworfen } = Kern.filtereBefehle(z, liste);", "  const gueltig = liste, verworfen = [];", 'Plan: Kern-Prüfer wird übergangen'],
  [R, "  const wartend = s.vorgemerkt.map((e) => e.b);", "  const wartend = [];", 'Plan: wartende Befehle zählen nicht für die Prüfung'],
  [R, "  const sw = schwung(ws);\n", "  const sw = { rom: 0, ger: 0, saldo: 0 };\n", 'Sieger: kein Schwung'],
  [R, "    if (!(e.n > ab)) continue;", "", 'Sieger: Schwung ohne Fenster'],
  [R, "    else if (e.typ === 'posten_verloren') { if (e.durch in s) s[e.durch]++; if (e.besitzer in s) s[e.besitzer]--; }", "", 'Sieger: Posten zählen nicht'],
  [R, "  else if (anteil >= FENSTER.macht_schwelle) sieger = 'rom';", "  else if (anteil >= 0.5) sieger = 'rom';", 'Sieger: Macht ohne Schwelle'],
  [R, "  return p + FENSTER.staerke_gewicht * z.flotten", "  return p + 0 * z.flotten", 'Sieger: Stärke zählt nicht'],
  [R, "  Kern.BEFEHLE.regieRaeumen(ws.zustand);   // nur", "  void 0;   // nur", 'Rückfall: Überlagerung der Regie bleibt'],
  [R, "  s.vorgemerkt = [];\n  Kern.BEFEHLE.regieRaeumen", "  Kern.BEFEHLE.regieRaeumen", 'Rückfall: wartende Befehle bleiben'],
  [R, "  const faellig = s.vorgemerkt.filter((e) => e.ab <= n).slice(0, BW.je_tick_max.wert);", "  const faellig = s.vorgemerkt.filter((e) => e.ab <= n + 99).slice(0, BW.je_tick_max.wert);", 'Warteschlange: Befehle werden zu früh gespielt'],
  [R, "  const faellig = s.vorgemerkt.filter((e) => e.ab <= n).slice(0, BW.je_tick_max.wert);", "  const faellig = s.vorgemerkt.filter((e) => e.ab <= n);", 'Warteschlange: mehr Befehle als je Tick'],
  [R, "  s.vorgemerkt = s.vorgemerkt.filter((e) => !faellig.includes(e));", "", 'Warteschlange: gespielte Befehle bleiben'],
  [R, "    const abg = r.abgelehnt.find(", "    const abg = null; void r.abgelehnt.find(", 'Logbuch: Ablehnung im Tick wird nicht erkannt'],
  [R, "    if (e.w && e.b.typ === 'embargo') {", "    if (false) {", 'Funk: kein Hinweis beim Wirksamwerden des Embargos'],
  [R, "  if (Object.keys(s.letzte).length) b.letzte = Object.assign({}, s.letzte);", "", 'Weltstand: Abkühlzeiten gehen verloren'],
  [R, "  if (s.vorgemerkt.length) b.vorgemerkt = s.vorgemerkt.map(", "  if (false) b.vorgemerkt = s.vorgemerkt.map(", 'Weltstand: wartende Befehle gehen verloren'],
  [R, "      if (e.w === 1) eintrag.w = 1;", "", 'Weltstand: Leser verliert die Ankündigung'],
  [R, "ab: Math.min(ab, t + 1 + Math.max(...Object.values(R.vorwarnung.wert.vorlauf), 1)) };", "ab };", 'Weltstand: Leser klemmt die Zeit nicht'],
  [R, "typeof e.b.typ !== 'string' || !Object.prototype.hasOwnProperty.call(KATALOG, e.b.typ)) continue;", "typeof e.b.typ !== 'string') continue;", 'Weltstand: Leser nimmt unbekannte Typen'],
  [R, "out.letzte[k] = Math.min(Math.floor(v), t);", "out.letzte[k] = Math.floor(v);", 'Weltstand: Leser klemmt Abkühlzeiten nicht'],
  [R, "      if (out.vorgemerkt.length >= R.plan.wert.vorgemerkt_max) break;", "", 'Weltstand: Leser kürzt die Warteschlange nicht'],
  [KL, "  if (regieAus) { try { Regie.melde(game, regieAus); }", "  if (false) { try { Regie.melde(game, regieAus); }", 'Logbuch und Funk nach dem Tick fehlen'],
  [KL, "  const rg = neueBloecke ? Regie.toSave(ws) : null; if (rg) b.regie = rg;", "", 'Speichern vergisst die Regie'],
  [KL, "  game.weltsim.regie = Regie.lesen(b.regie, game.weltsim.tickZahl);", "  game.weltsim.regie = Regie.neu();", 'Laden vergisst die Regie'],
  [KL, "faellig.length ? { wirkungen: gueltig, befehle: faellig.map((e) => e.b) } : { wirkungen: gueltig }", "{ wirkungen: gueltig }", 'Tick gibt die Befehle nicht an die Sim'],
  // ---- Runde 2 (Review): Entwarnung, Tick-Wurf, Besitzwechsel, Crew-Absicht, Klemmen, Ruhe
  [B, "        if (!FRAKTIONEN.includes(f) || !objekt(e)) continue;", "        if (!FRAKTIONEN.includes(f)) continue;", 'N3 Bereinigung: regie { rom: null } wird nicht verworfen'],
  [B, "    if (fl.befehl !== 'heim') {\n      const rec", "    if (false) {\n      const rec", 'N4 Miete endet unterwegs: Flotte kämpft für das Konkordat weiter'],
  [B, "      if (fl.miete) return 'Mietflotten werden nicht verlegt';\n", "", 'N12 Mietflotte darf verlegt werden'],
  [B, "  if (f !== 'rom') return false;\n  const ab = z.absichten", "  const ab = z.absichten", 'Crew-Absicht: bremst auch die Germanen'],
  [B, "  return ab[feld] < ohne;", "  return ab[feld] > ohne;", 'Crew-Absicht: bremst die falsche Seite'],
  [B, "      if (crewBremst(z, b.fraktion, 'aggr')) return 'Crew-Absicht aktiv: Rom hält sich auf Wunsch der Crew zurück';\n", "", 'Crew-Absicht: Angriffsbefehl für Rom geht trotz Absicht durch'],
  [B, "      if (crewBremst(z, b.fraktion, 'p_act')) return 'Crew-Absicht aktiv: Rom hält sich auf Wunsch der Crew zurück';\n", "", 'Crew-Absicht: Anspruchsbefehl für Rom geht trotz Absicht durch'],
  [B, "bis: z.tick + b.dauer + 1 };", "bis: z.tick + b.dauer };", 'K1 Embargo wirkt dauer − 1 Handels-Ticks'],
  [B, "  const t = Math.min(W.ruhe && W.ruhe.wert[b.typ], W.ruhe_max.wert), f", "  const t = (W.ruhe && W.ruhe.wert[b.typ]) + 500, f", 'Ruhe: ohne Obergrenze ruhe_max'],
  [B, "bis: Math.min(e.bis, t + D.embargo.max + 1) };", "bis: e.bis };", 'Bereinigung: Embargo-Ende wird nicht geklemmt'],
  [B, "x[k] = klemme(e[k], W.regler.wert[k].min, W.regler.wert[k].max);", "x[k] = e[k];", 'Bereinigung: Regler werden nicht geklemmt'],
  [B, "x.regler_bis = Math.min(e.regler_bis, t + D.regler.max);", "x.regler_bis = e.regler_bis;", 'Bereinigung: regler_bis wird nicht geklemmt'],
  [B, "x.ruhe_bis = Math.min(e.ruhe_bis, t + RUHE_MAX);", "x.ruhe_bis = e.ruhe_bis;", 'Bereinigung: ruhe_bis wird nicht geklemmt'],
  [B, "radius: klemme(Math.round(fk.radius), W.fokus.wert.radius.min, W.fokus.wert.radius.max), bis: Math.min(fk.bis, t + D.fokus.max) };", "radius: fk.radius, bis: fk.bis };", 'Bereinigung: Fokus wird nicht geklemmt'],
  [B, "|| fl.fraktion !== m.an || !ganzZahl(m.bis)", "|| !ganzZahl(m.bis)", 'Bereinigung: Miete ohne passende Fraktion bleibt'],
  [B, "else fl.miete = { von: 'kon', an: m.an, bis: Math.min(m.bis, t + D.soeldner.max), preis: m.preis };", "", 'Bereinigung: Mietende wird nicht geklemmt'],
  [B, "if (!FRAKTIONEN.includes(f) || !objekt(e)) continue;\n        const x = {};", "if (!objekt(e)) continue;\n        const x = {};", 'Bereinigung: unbekannte Fraktion in regie bleibt'],
  [R, "  for (const e of warn) funkSenden(game, entwarnText(e.b));   // angekündigt und nie gekommen: Entwarnung\n", "", 'Entwarnung: verwerfe/rueckfall melden nicht'],
  [R, "    if (e.w) funkSenden(game, entwarnText(e.b));\n  }\n  return faellig.length;", "  }\n  return faellig.length;", 'Entwarnung: gescheiterter Tick meldet nicht'],
  [R, "if (e.w) out.funk.push(entwarnText(e.b)); continue; }", "continue; }", 'Entwarnung: im Tick abgelehnter Befehl meldet nicht'],
  [R, "  const warn = s.vorgemerkt.filter((e) => e.w);", "  const warn = s.vorgemerkt;", 'Entwarnung: auch für nie angekündigte Befehle'],
  [R, "  s.vorgemerkt = s.vorgemerkt.filter((e) => !faellig.some((f) => gleich(e, f)));", "", 'Tick-Wurf: der giftige Befehl bleibt in der Warteschlange'],
  [KL, "    try { Regie.tickGescheitert(game, faellig, ws.tickZahl + 1); } catch (e2)", "    try { void 0; } catch (e2)", 'Tick-Wurf: Kriegslage verwirft den Befehl nicht'],
  [R, "  const gut = faellig.filter((e) => e.w || !trifftRom(z, e.b));", "  const gut = faellig;", 'Besitzwechsel: Befehl wirkt unangekündigt auf einen römischen Ort'],
  [R, "  const gut = faellig.filter((e) => e.w || !trifftRom(z, e.b));", "  const gut = faellig.filter((e) => !trifftRom(z, e.b));", 'Besitzwechsel: angekündigte Befehle werden mit abgelehnt'],
  [R, "    const w = trifftRom(ws.zustand, e.b);\n    const f = w && vorwarnText", "    const w = null;\n    const f = w && vorwarnText", 'Laden: wartende Vorwarnungen werden nicht erneut gefunkt'],
  [KL, "  try { Regie.vorwarnungenErneut(game); }", "  try { void 0; }", 'Laden: Kriegslage ruft die erneute Ankündigung nicht'],
  [R, "      if (Object.keys(out.letzte).length >= R.plan.wert.letzte_max) break;", "", 'Leser: Abkühlzeit-Schlüssel unbegrenzt'],
  [R, " && Object.prototype.hasOwnProperty.call(KATALOG, k.split(':')[0]) && Number.isFinite(v)", " && Number.isFinite(v)", 'Leser: Abkühlzeit-Schlüssel unbekannter Typen'],
  [DB, '"ruhe_max": {"wert": 100,', '"ruhe_max": {"wert": 1000,', 'Daten: ruhe_max riesig'],
  [DB, '"ruhe": {"wert": {"angreifen": 80,', '"ruhe": {"wert": {"angreifen": 90,', 'Daten: Ruhe länger als die Abkühlzeit'],
  // ---- Runde 2: Schichtung und Reihenfolge (Review N1 N2 N5 N6 N7 N8 N9 N10 N11)
  [B, "    max_active: ab.max_active !== undefined ? ab.max_active : (rg.max_active !== undefined ? rg.max_active : w.max_active[f]),", "    max_active: rg.max_active !== undefined ? rg.max_active : (ab.max_active !== undefined ? ab.max_active : w.max_active[f]),", 'N1 Schichtung: Regie-max_active überstimmt die Crew'],
  [B, "    aggr: ab.aggr !== undefined ? ab.aggr : (rg.ruhe_bis !== undefined && z.tick < rg.ruhe_bis ? 0 : (rg.aggr !== undefined ? rg.aggr : w.aggr)),", "    aggr: rg.aggr !== undefined ? rg.aggr : (ab.aggr !== undefined ? ab.aggr : (rg.ruhe_bis !== undefined && z.tick < rg.ruhe_bis ? 0 : w.aggr)),", 'N2 Schichtung: Regie-aggr überstimmt die Crew'],
  [B, "f = b.fraktion || b.an || b.gegen;", "f = b.fraktion || b.an;", 'N5 Ruhe: Embargo setzt keine Ruhe'],
  [B, "Object.values(d.hauptwelten).includes(b.ziel)", "d.hauptwelten.rom === b.ziel", 'N6 Hauptwelt-Schutz nur für Rom'],
  [R, "  const faellig = s.vorgemerkt.filter((e) => e.ab <= n).slice(0, BW.je_tick_max.wert);", "  const faellig = s.vorgemerkt.filter((e) => e.ab <= n + 1).slice(0, BW.je_tick_max.wert);", 'N7 Vorwarnung einen Tick kürzer'],
  [R, "ab: Math.min(ab, t + 1 + Math.max(...Object.values(R.vorwarnung.wert.vorlauf), 1)) };", "ab: Math.min(ab, t + 1) };", 'N9 Laden verkürzt den Vorlauf auf einen Tick'],
  [R, "    const w = trifftRom(z, k.b);", "    const w = kand.indexOf(k) === 0 ? trifftRom(z, k.b) : null;", 'N10 nur der erste Befehl im Plan wird angekündigt'],
  [R, "  for (const f of funk) funkSenden(game, f);", "  for (const f of funk.concat(funk)) funkSenden(game, f);", 'N11 Vorwarnung doppelt gefunkt'],
  // ---- A3: globale Befehlsrate
  [R, "    if (!gratis && belegt >= RATE.max) {", "    if (false) {", 'Rate: kein Deckel'],
  [R, "const rateBelegt = (s, jetzt) => s.rate.filter((t) => jetzt - t < RATE.fenster).length;", "const rateBelegt = (s, jetzt) => s.rate.length;", 'Rate: Fenster ignoriert (alte Befehle zählen ewig)'],
  [R, "    if (a._rate !== false) s.rate.push(n0);", "", 'Rate: angenommene Befehle werden nicht gezählt'],
  [R, "const belegt = rateBelegt(s, n0) + ratePlaetze;", "const belegt = rateBelegt(s, n0);", 'Rate: Deckel gilt nicht mitten im Plan'],
  [R, "  if (s.rate.length) b.rate = s.rate.slice();", "", 'Rate: wird nicht gespeichert'],
  [R, ".slice(-RATE.max);   // nur das Fenster", ";   // nur das Fenster", 'Rate: Leser kürzt nicht auf max'],
  [R, " && t - x < RATE.fenster).slice", ").slice", 'Rate: Leser nimmt abgelaufene Einträge'],
  [DR, '"rate": {"wert": {"max": 8,', '"rate": {"wert": {"max": 800,', 'Daten: Rate-Deckel riesig'],
  // ---- Ausschnitt
  [L, ".filter((e) => e.typ !== 'konvoi' && !WICHTIG.includes(e.typ))", ".filter((e) => !WICHTIG.includes(e.typ))", 'Ausschnitt: konvoi-Ereignisse'],
  [L, ".slice(-st.ereignisse).map((e) => ereignisKurz(e, d));", ".slice(-99).map((e) => ereignisKurz(e, d));", 'Ausschnitt: Ereignisse werden nicht gekürzt'],
  [L, ".slice(-st.chronik).map(", ".slice(-99).map(", 'Ausschnitt: Chronik wird nicht gekürzt'],
  [L, ".slice(-st.gefallen).map(", ".slice(0, 0).map(", 'Ausschnitt: Gefallene fehlen'],
  [L, ".slice(0, A.chronik_zeichen));", ");", 'Ausschnitt: lange Chronikeinträge'],
  [L, "  for (const n of namen) if (n.length >= 2) t = t.replace(", "  for (const n of []) if (n.length >= 2) t = t.replace(", 'Ausschnitt: Spielernamen im Text'],
  [L, "if (st.ruhige_zaehlen) flotten.ruhig = ruhig.length; else", "if (false) flotten.ruhig = ruhig.length; else", 'Ausschnitt: ruhige Flotten werden nie nur gezählt'],
  [L, "const belagert = aktiv.filter((a) => a.t_an !== null)", "const belagert = aktiv.filter((a) => a.t_an === null)", 'Ausschnitt: belagert und unterwegs vertauscht'],
  [L, "Daten.abstand(d, c, anker) <= st.radius;", "Daten.abstand(d, c, anker) <= st.radius + 9;", 'Ausschnitt: Umkreis ignoriert den Radius'],
  [L, "JSON.stringify(Context.sortKeys(b))", "JSON.stringify(b)", 'Ausschnitt: Schlüssel unsortiert'],
  [L, "    if (letzter.zeichen <= maxZeichen) return", "    if (letzter.zeichen <= 0) return", 'Ausschnitt: ausschnittPassend kürzt immer am meisten'],
  [L, "  for (let s = 0; s < A.stufen.length; s++) {\n    letzter = ausschnitt(game, { stufe: s });", "  for (let s = A.stufen.length - 1; s >= 0; s--) {\n    letzter = ausschnitt(game, { stufe: s });", 'Ausschnitt: ausschnittPassend beginnt bei der stärksten Kürzung'],
  [L, "  if (!game.weltsim) return { stufe: 0, zeichen: 0, text: '' };\n  const s =", "  const s =", 'Ausschnitt: ohne Modus'],
  [L, "ruf: { rom: Ruf.ruf(game, 'rom'), ger: Ruf.ruf(game, 'ger'), kon: Ruf.ruf(game, 'kon') },", "ruf: { rom: Ruf.ruf(game, 'rom') },", 'Ausschnitt: Ruf nur von Rom'],
  [L, "    lage: { sieger: lage.sieger, anteil: lage.anteil },", "", 'Ausschnitt: ohne Sieger-Kennzahl'],
  [L, "mieten = z.flotten.filter((fl) => fl.miete)", "mieten = z.flotten.filter((fl) => false)", 'Ausschnitt: Mieten fehlen'],
  [R, "    const gratis = k.fokusPlan && fokusPlatz;", "    const gratis = false;", 'SUND-03 F: der Plan-Fokus kostet je Fraktion einen Rate-Platz'],
  [R, "    if (a._rate !== false) s.rate.push(n0);", "    s.rate.push(n0);", 'SUND-03 F: der zweite Fokus-Befehl des Plans bucht einen Rate-Platz'],
  [R, "    if (!gratis) ratePlaetze++;\n", "", 'SUND-03 F: Rate-Plätze innerhalb eines Plans werden nicht gezählt'],
  [R, "    if (k.fokusPlan) fokusPlatz = true;\n", "", 'SUND-03 F: der Fokus-Platz wird nie als belegt gemerkt'],
  // ---- Daten und Texte
  [DB, '"hauptwelt_erlaubt": false', '"hauptwelt_erlaubt": true', 'Daten: Hauptwelt als Befehlsziel'],
  [DB, '"je_tick_max": {"wert": 8', '"je_tick_max": {"wert": 2', 'Daten: je Tick nur zwei Befehle'],
  [DB, '"embargo": {"min": 4, "max": 30}', '"embargo": {"min": 4, "max": 3000}', 'Daten: Embargo ohne Obergrenze'],
  [DB, '"ruhe": {"wert": {"angreifen": 80,', '"ruhe": {"wert": {"angreifen": 0,', 'Daten: keine Ruhe nach einem Angriff'],
  [DB, '"nachschub": 0, "rueckzug": 25', '"nachschub": 60, "rueckzug": 25', 'Daten: Nachschub lähmt die Fraktion'],
  [DB, '"preis_je_staerke_tick": 0.5', '"preis_je_staerke_tick": 0', 'Daten: Söldner gratis'],
  [DR, '"mindest_vorlauf": 1', '"mindest_vorlauf": 0', 'Daten: Mindestvorlauf 0'],
  [DR, '"vorlauf": {"embargo": 2, "angreifen": 2, "piratenueberfall": 2}', '"vorlauf": {"embargo": 2, "angreifen": 0, "piratenueberfall": 2}', 'Daten: Angriffe ohne Vorlauf'],
  [DR, '"nur_gegen_sieger": true', '"nur_gegen_sieger": false', 'Daten: Embargo gegen jede Seite'],
  [DR, '"macht_schwelle": 0.52', '"macht_schwelle": 0.4', 'Daten: Sieger schon bei kleinem Vorsprung'],
  [DR, '"max_zeichen": 4800', '"max_zeichen": 9000', 'Daten: Obergrenze des Ausschnitts'],
  [DR, '{"ereignisse": 6, "chronik": 5, "radius": 1, "gefallen": 3, "ruhige_zaehlen": false}', '{"ereignisse": 6, "chronik": 5, "radius": 2, "gefallen": 3, "ruhige_zaehlen": false}', 'Daten: Stufe 2 ohne kleineren Radius'],
  [DR, '"abkuehlung": {"wert": {"angreifen": 80,', '"abkuehlung": {"wert": {"angreifen": 6000,', 'Daten: Abkühlzeit unsinnig'],
  [TX, '"sprecher": "Aufklärung", "text": "Germanische', '"sprecher": "Legat Rufus", "text": "Germanische', 'Text: Sprecher ohne Porträt'],
  [E, "  embargo_beendet: ['gegen'],", "", 'Ereignis embargo_beendet nicht vereinbart'],
];

// Selbstcheck der Anker (SUND-03 F2): VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie). Sonst bricht die Probe mit Exit 2 ab, statt die Mutation still zu überspringen.
// --trocken prüft nur die Anker (ohne Tests) und endet.
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
const rot = (r) => r.status !== 0;
let ueberlebt = 0, gelaufen = 0;
console.log(`Mutationsprobe test-befehle.js, test-regie.js, test-lage-ausschnitt.js, test-absichten.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
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
