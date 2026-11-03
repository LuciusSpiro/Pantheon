'use strict';
// TEL-01 D2: Test des Vergleichs (tools/vergleich.js, tools/auswertung/vergleich.js, bewertung.js: unterschiedGruppen, vergleichSeiten).
//   1. Kerbenregel nach McGill mit von Hand gerechneten Grenzfaellen: drinnen/draussen, sqrt(n), Mindestmenge, n < 4, IQR der groesseren Gruppe, Symmetrie, determ: false.
//   2. Bewertung der drei Faelle (Lauf/Lauf, Lauf/Gruppe, Gruppe/Gruppe): Lauf-Faelle liefern genau das, was die vorhandene Bewertung (abweichungen, abweichungGegenBasisGruppe) liefert;
//      summe: true = fehlender Wert 0 (auch bei Lauf/Lauf), Quoten fehlen einfach, Technik (determ: false) nie.
//   3. Gruppen aus Ordnern und --filter (Build, Quelle, Modus, Spielerzahl): ein echter kleiner Bot-Lauf als Vorlage, Kopien mit geaendertem Kopf; gemischte Gruppe mit Warnung, Fehlerlauf ausgeschlossen, Tuning-Diff (Pfade).
//   4. Ausgabe: Spalten, Zeilenlaenge <= 160, Zeilenzahl, Kopf (Commit, Plattform, Tuning, n), Delta und Delta % gerechnet; Rueckwaertsprobe mit Kennzahlen-Kopien (gleiche Konfiguration: nichts, manipuliert: erkannt).
//   5. Echte Probe (nicht mit AUSWERTUNG_SCHNELL=1): 4 + 4 Bot-Laeufe m3 (verschiedene Seeds), gleich = fast nichts, B mit manipulierten Kennzahlen = erkannt; basis:m3/3 gegen 4 frische Laeufe.
//   6. Aufruf: Exit-Codes von npm run vergleich.
//   node tools/test-vergleich.js   (npm run test:vergleich; Mutationsprobe: tools/mutation-auswertung.js; AUSWERTUNG_SCHNELL=1 laesst 5 aus)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const { kennzahlen, flach, infoZu } = require('./auswertung/kennzahlen.js');
const Lesen = require('./auswertung/lesen.js');
const Bewertung = require('./auswertung/bewertung.js');
const Basis = require('./auswertung/basis.js');
const Vergleich = require('./auswertung/vergleich.js');
const V = require('./vergleich.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const gleich = (a, b, t) => ok(JSON.stringify(a) === JSON.stringify(b), t + (JSON.stringify(a) === JSON.stringify(b) ? '' : ' (ist ' + JSON.stringify(a) + ', soll ' + JSON.stringify(b) + ')'));
const section = (t) => console.log('\n' + t);
const SCHNELL = !!process.env.AUSWERTUNG_SCHNELL;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-vergleich-test-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });

// Statistik [n, min, q1, median, q3, max] aus n, Median und IQR (q1 = med - iqr/2, q3 = med + iqr/2)
const st = (nn, med, iqr) => [nn, med - iqr / 2 - 1, med - iqr / 2, med, med + iqr / 2, med + iqr / 2 + 1];
const INFO_Q = infoZu('f2.quote.boden.blaster');   // % : min 10, rel 0,25
const urteil = (a, b, info) => Bewertung.unterschiedGruppen(a, b, info || INFO_Q).urteil;

async function main() {
  // ===================== 1. Kerbenregel =====================
  section('1. Kerben nach McGill (unterschiedGruppen), von Hand gerechnete Grenzfaelle');
  ok(INFO_Q.min === 10 && Bewertung.KERBE_K === 1.58 && Bewertung.MIN_BASIS_N === 4, 'Vorbedingung: Mindestmenge Quote 10, Kerbenfaktor 1,58, n >= 4');
  // n = 8 und 8, IQR 12: Kerbe = 1,58 x 12 x (1/sqrt(8) + 1/sqrt(8)) = 13,4067
  const k8 = Bewertung.unterschiedGruppen(st(8, 50, 12), st(8, 63, 12), INFO_Q);
  ok(Math.abs(k8.kerbe - 13.4067) < 0.001, 'Kerbenbreite 1,58 x 12 x 2/sqrt(8) = 13,4067 (ist ' + k8.kerbe + ')');
  gleich(k8.urteil, 'gleich', 'Abstand 13 < Kerbe 13,4067: gleich (die Kerben ueberlappen)');
  gleich(urteil(st(8, 50, 12), st(8, 64, 12)), 'wesentlich', 'Abstand 14 > Kerbe: wesentlich');
  gleich(urteil(st(8, 50, 12), st(8, 63.4, 12)), 'gleich', 'Abstand 13,4 knapp unter der Kerbe: gleich');
  gleich(urteil(st(8, 50, 12), st(8, 63.5, 12)), 'wesentlich', 'Abstand 13,5 knapp ueber der Kerbe: wesentlich');
  // sqrt(n): n = 16 und 4, IQR 10 beide: Kerbe = 1,58 x 10 x (1/4 + 1/2) = 11,85. Ohne Wurzel (1/n) waere sie 4,94.
  gleich(urteil(st(16, 50, 10), st(4, 61.8, 10)), 'gleich', 'n 16 und 4: Abstand 11,8 < Kerbe 11,85: gleich (die Kerbe waechst mit 1/sqrt(n), nicht mit 1/n)');
  gleich(urteil(st(16, 50, 10), st(4, 61.9, 10)), 'wesentlich', 'n 16 und 4: Abstand 11,9 > Kerbe 11,85: wesentlich');
  ok(Bewertung.unterschiedGruppen(st(16, 50, 10), st(4, 61.8, 10), INFO_Q).kerbe > 11.8, 'Kerbe n 16 und 4 = 11,85');
  // mehr Laeufe, schmalere Kerbe: gleicher Abstand 9 bei IQR 20: n = 4 gleich, n = 64 wesentlich (Mindestmenge 10 ist hier schon der Deckel: Abstand >= 10 noetig)
  const schmal = Bewertung.unterschiedGruppen(st(64, 50, 20), st(64, 61, 20), INFO_Q).kerbe < Bewertung.unterschiedGruppen(st(4, 50, 20), st(4, 61, 20), INFO_Q).kerbe;
  ok(schmal, 'die Kerbe wird mit der Zahl der Laeufe schmaler (n 64 gegen n 4)');
  // Mindestmenge: IQR 0 = Kerbe 0, jeder Abstand waere "wesentlich"; erst ab info.min (10 %) zaehlt er
  gleich(urteil(st(8, 50, 0), st(8, 55, 0)), 'gleich', 'Kerbe 0, Abstand 5 < Mindestmenge 10: gleich');
  gleich(urteil(st(8, 50, 0), st(8, 60, 0)), 'wesentlich', 'Kerbe 0, Abstand 10 = Mindestmenge: wesentlich (>=)');
  gleich(urteil(st(8, 50, 0), st(8, 59.9, 0)), 'gleich', 'Kerbe 0, Abstand 9,9 < Mindestmenge: gleich');
  // n-Grenze: je Seite mindestens 4
  gleich(urteil(st(3, 50, 0), st(8, 90, 0)), 'zuwenig', 'A mit n 3: zu wenig Laeufe (kein Urteil, trotz grossem Abstand)');
  gleich(urteil(st(8, 50, 0), st(3, 90, 0)), 'zuwenig', 'B mit n 3: zu wenig Laeufe');
  gleich(urteil(st(4, 50, 0), st(4, 90, 0)), 'wesentlich', 'n 4 je Seite genuegt');
  // IQR der Gruppe mit mehr Laeufen: A n = 12, IQR 4; B n = 5, IQR 40. Mit IQR A: Kerbe 4,65 -> Abstand 10 wesentlich; mit der groesseren IQR (40) waere es gleich
  gleich(urteil(st(12, 50, 4), st(5, 60, 40)), 'wesentlich', 'IQR der Gruppe mit mehr Laeufen (A, 4): Abstand 10 > Kerbe 4,65');
  gleich(urteil(st(5, 60, 40), st(12, 50, 4)), 'wesentlich', 'dasselbe mit vertauschten Seiten (symmetrisch)');
  gleich(urteil(st(8, 50, 4), st(8, 60, 40)), 'gleich', 'gleiches n: die groessere IQR (40) gilt, Kerbe 44,7: gleich');
  const sym = [Bewertung.unterschiedGruppen(st(9, 50, 6), st(5, 70, 3), INFO_Q), Bewertung.unterschiedGruppen(st(5, 70, 3), st(9, 50, 6), INFO_Q)];
  ok(sym[0].urteil === sym[1].urteil && sym[0].kerbe === sym[1].kerbe && sym[0].diff === sym[1].diff, 'Symmetrie: A,B = B,A');
  gleich(Bewertung.unterschiedGruppen(st(8, 1, 0), st(8, 500, 0), infoZu('f6.tick.med')).urteil, 'keins', 'Technik (determ: false) wird nie verglichen');
  gleich(Bewertung.unterschiedGruppen(null, st(8, 5, 0), INFO_Q).urteil, 'keins', 'fehlende Statistik: kein Urteil');

  // ===================== 2. drei Faelle =====================
  section('2. Bewertung: Lauf/Lauf, Lauf/Gruppe, Gruppe/Gruppe');
  const kz = (o) => ({ version: 1, kopf: { modus: 'x', spielerzahl: 3 }, f1: o.f1 || {}, f2: o.f2 || {}, f2b: {}, f3: o.f3 || {}, f4: {}, f5: {}, f6: o.f6 || {} });
  const gr = (kzs, laeufe) => ({ id: 't', laeufe: laeufe || 8, kz: kzs });
  // Gruppe/Gruppe
  const GA = gr({ 'f2.quote.boden.blaster': st(8, 50, 8), 'f2.quote.boden.pistol': st(8, 40, 8), 'f3.gefallen.n': st(8, 6, 2), 'f2.kills.boden.gesamt': st(8, 20, 4), 'f6.tick.med': st(8, 0.1, 0), 'f1.dauer.session': st(8, 200, 20) });
  const GB = gr({ 'f2.quote.boden.blaster': st(8, 20, 8), 'f2.kills.boden.gesamt': st(8, 21, 4), 'f6.tick.med': st(8, 90, 0), 'f1.dauer.session': st(3, 400, 20) });
  const gg = Bewertung.vergleichSeiten({ gruppe: GA }, { gruppe: GB });
  gleich(gg.regel, 'gruppe-gruppe', 'Regel gruppe-gruppe');
  gleich([...gg.wesentlich].sort(), ['f2.quote.boden.blaster', 'f3.gefallen.n'], 'wesentlich: Quote 50 -> 20 und gefallen 6 -> 0 (fehlt in B, summe: true = 0); Kills 20/21 nicht; Technik nie');
  ok(gg.zuwenig.has('f1.dauer.session') && gg.zuwenig.size === 1, 'Dauer mit n 3 in B: zu wenig Laeufe, nicht verglichen');
  ok(gg.fehlt === 1, 'Quote Pistole fehlt in B (keine summe: kein Wert, nicht 0): zaehlt in fehlt (1)');
  ok(!gg.wesentlich.has('f6.tick.med') && !gg.wesentlich.has('f2.quote.boden.pistol'), 'Technik und fehlender Quotenwert sind nie wesentlich');
  const ggVert = Bewertung.vergleichSeiten({ gruppe: GB }, { gruppe: GA });
  gleich([...ggVert.wesentlich].sort(), [...gg.wesentlich].sort(), 'vertauschte Seiten: dieselben Kennzahlen');
  // Summe fehlt auf BEIDEN Seiten in einem Teil der Laeufe: n der aufgefuellten Statistik = Zahl der Laeufe der Gruppe (hier 3: zu wenig)
  const kurz = Bewertung.vergleichSeiten({ gruppe: gr({ 'f3.gefallen.n': st(3, 6, 0) }, 3) }, { gruppe: gr({}, 3) });
  ok(kurz.zuwenig.has('f3.gefallen.n'), 'aufgefuellte Summe bei n 3 ist zu wenig');

  // Lauf/Lauf: genau die vorhandene Einzelregel
  const kzA = kz({ f2: { quote: { boden: { blaster: 50, pistol: 40 } }, kills: { boden: { gesamt: 10 } }, schaden: { boden: { aus: { roh: 100 } } } }, f6: { tick: { max: 1 } } });
  const kzB = kz({ f2: { quote: { boden: { blaster: 20, pistol: 41 } }, schaden: { boden: { aus: { roh: 104 } } } }, f6: { tick: { max: 500 } } });
  const ll = Bewertung.vergleichSeiten({ kz: kzA }, { kz: kzB });
  gleich(ll.regel, 'lauf-lauf', 'Regel lauf-lauf');
  gleich([...ll.wesentlich].sort(), ['f2.kills.boden.gesamt', 'f2.quote.boden.blaster'], 'Lauf/Lauf: Quote 50 -> 20 und Kills 10 -> fehlt (summe: 0); Pistole +1 und Schaden +4 % nicht; Technik nie');
  const kzC = kz({ f2: { quote: { boden: { blaster: 20, pistol: 41 } }, kills: { boden: { gesamt: 3 } }, schaden: { boden: { aus: { roh: 104 } } } }, f6: { tick: { max: 500 } } });
  gleich([...Bewertung.vergleichSeiten({ kz: kzA }, { kz: kzC }).wesentlich].sort(), Bewertung.abweichungen(kzC, kzA).liste.map((x) => x.k).sort(), 'Lauf/Lauf mit allen Schluesseln auf beiden Seiten = bewertung.abweichungen (B gegen die Basis A), keine Kopie');
  // Lauf/Gruppe: genau abweichungGegenBasisGruppe, in beiden Reihenfolgen
  const grp = gr({ 'f2.quote.boden.blaster': st(12, 50, 6), 'f2.kills.boden.gesamt': st(12, 10, 2) });
  const soll = Bewertung.abweichungGegenBasisGruppe(kzC, grp).liste.map((x) => x.k).sort();
  ok(soll.length >= 1, 'Vorbedingung: der Lauf weicht von der Gruppe ab');
  gleich([...Bewertung.vergleichSeiten({ kz: kzC }, { gruppe: grp }).wesentlich].sort(), soll, 'Lauf/Gruppe = abweichungGegenBasisGruppe');
  gleich([...Bewertung.vergleichSeiten({ gruppe: grp }, { kz: kzC }).wesentlich].sort(), soll, 'Gruppe/Lauf: dieselben, in beiden Reihenfolgen');

  // ===================== 3. Ordner, Filter, Tuning =====================
  section('3. Gruppen aus Ordnern, --filter, gemischte Gruppen, Fehlerlauf, Tuning-Diff');
  const vorlageDir = path.join(TMP, 'vorlage');
  await bot(['wellen', '--karte', 'aussenposten', '--players', '1', '--seeds', '1', '--seed', '1'], vorlageDir);
  const vorlage = Lesen.ordnerSessions(vorlageDir);
  ok(vorlage.length === 1, 'Vorlage: ein Bot-Lauf (wellen aussenposten solo)');
  const vlName = vorlage[0].kennung;
  const vlText = fs.readFileSync(path.join(vorlageDir, vlName + '.jsonl'), 'utf8');
  const vlKopf = JSON.parse(vlText.split('\n')[0]);
  const vlTuning = vlKopf.tuning_hash;
  ok(typeof vlTuning === 'string' && fs.existsSync(path.join(vorlageDir, 'tuning', vlTuning + '.json')), 'Vorlage: Kopf mit Tuning-Hash, tuning/<hash>.json vorhanden');
  // Kopie der Vorlage mit neuer Kennung und geaendertem Kopf; ohneEnde schneidet die letzte Zeile ab
  function kopie(dir, kennung, kopfAend, opt) {
    fs.mkdirSync(dir, { recursive: true });
    let text = vlText.split(vlName).join(kennung);
    const zeilen = text.split('\n');
    const kopf = JSON.parse(zeilen[0]);
    Object.assign(kopf, kopfAend || {});
    zeilen[0] = JSON.stringify(kopf);
    text = zeilen.join('\n');
    if (opt && opt.ohneEnde) text = text.replace(/\n[^\n]*"typ":"session_ende"[^\n]*\n?$/, '\n');
    fs.writeFileSync(path.join(dir, kennung + '.jsonl'), text);
  }
  const COMMIT_A = 'aaaa111111111111111111111111111111111111', COMMIT_B = 'bbbb222222222222222222222222222222222222';
  const F = path.join(TMP, 'f');
  for (let i = 1; i <= 4; i++) kopie(F, 'run-t-a' + i, { commit: COMMIT_A, seed: i });
  for (let i = 1; i <= 3; i++) kopie(F, 'run-t-b' + i, { commit: COMMIT_B, seed: 10 + i });
  kopie(F, 'run-t-m1', { commit: COMMIT_A, modus: 'm1', seed: 20 });                    // anderer Modus: gemischte Gruppe
  kopie(F, 'run-t-ab', { commit: COMMIT_A, seed: 21 }, { ohneEnde: true });             // Bot ohne session_ende: Fehlerlauf
  fs.cpSync(path.join(vorlageDir, 'tuning'), path.join(F, 'tuning'), { recursive: true });
  ok(!!vlText.includes('"typ":"session_ende"') && !fs.readFileSync(path.join(F, 'run-t-ab.jsonl'), 'utf8').includes('"typ":"session_ende"'), 'Vorbereitung: Kopie ohne session_ende');

  // Filter
  gleich(Vergleich.filterParsen('modus=m1,spielerzahl=3,quelle=bot,commit=ab12'), { modus: 'm1', spielerzahl: '3', quelle: 'bot', commit: 'ab12' }, 'filterParsen: modus, spielerzahl, quelle, commit');
  gleich(Vergleich.filterParsen(''), {}, 'filterParsen: leer');
  for (const schlecht of ['modus', 'modus=', 'farbe=rot', '=m1']) { let w = null; try { Vergleich.filterParsen(schlecht); } catch (e) { w = e.message; } ok(w != null, 'filterParsen lehnt "' + schlecht + '" ab' + (w ? ' (' + w.slice(0, 50) + ')' : '')); }
  const kopfM = { modus: 'm1', spielerzahl: 3, quelle: 'bot', commit: 'ab12cd34', tuning_hash: 'ffee0011', plattform: 'win32-x64', seed: 5, szenario: null };
  ok(Vergleich.filterPasst(kopfM, { modus: 'm1', spielerzahl: '3', quelle: 'bot', commit: 'ab12' }), 'filterPasst: alles passt (Commit als Praefix)');
  ok(!Vergleich.filterPasst(kopfM, { modus: 'm3' }) && !Vergleich.filterPasst(kopfM, { spielerzahl: '1' }) && !Vergleich.filterPasst(kopfM, { quelle: 'mensch' }) && !Vergleich.filterPasst(kopfM, { commit: 'cd34' }), 'filterPasst: je ein falscher Wert lehnt ab (Commit nur als Praefix)');
  ok(Vergleich.filterPasst(kopfM, { tuning: 'ffee' }) && !Vergleich.filterPasst(kopfM, { szenario: 'x' }), 'filterPasst: tuning als Praefix, fehlendes Feld passt nie');

  const ohneFilter = V.vergleichen(F, F, {});
  ok(ohneFilter.a.warnungen.some((w) => /gemischte Gruppe/.test(w) && /arena_away\/aussenposten\/1 x/.test(w) && /m1\/aussenposten\/1 x1/.test(w) && /--filter/.test(w)), 'gemischte Gruppe (zwei Gruppen-IDs): Warnung mit den IDs und dem Hinweis auf --filter');
  ok(ohneFilter.a.warnungen.some((w) => /gemischte Commits/.test(w)), 'gemischte Commits: Warnung');
  ok(/gemischte Gruppe/.test(ohneFilter.text), 'die Warnung steht im Bericht');
  gleich(ohneFilter.a.n, 8, 'ohne Filter: 8 Laeufe (4 + 3 + 1 Modus m1; der Lauf ohne session_ende ist ein Fehlerlauf)');
  gleich(ohneFilter.a.fehlerlaeufe.length, 1, 'ein Fehlerlauf (Bot ohne session_ende) ausgeschlossen');
  ok(/Fehlerlauf ausgeschlossen: run-t-ab \(kein session_ende\)/.test(ohneFilter.text), 'der Fehlerlauf steht mit Kennung und Grund im Bericht');
  const fm = V.vergleichen(F, F, { filter: 'modus=arena_away' });
  gleich(fm.a.n, 7, 'mit --filter modus=arena_away: 7 Laeufe (der m1-Lauf faellt weg)');
  ok(!fm.a.warnungen.some((w) => /gemischte Gruppe/.test(w)), 'nach dem Filter keine Warnung "gemischte Gruppe" mehr');
  const fa = V.vergleichen(F, F, { filter: 'modus=arena_away', filterA: 'commit=aaaa', filterB: 'commit=bbbb' });
  gleich([fa.a.n, fa.b.n], [4, 3], '--filter-a commit=aaaa / --filter-b commit=bbbb: 4 gegen 3 Laeufe (Build gegen Build aus einem Ordner)');
  ok(fa.a.warnungen.length === 0 && fa.b.warnungen.length === 0, 'nach beiden Filtern keine Warnungen');
  gleich(fa.a.gruppe.id, Basis.gruppenId({ modus: 'arena_away', szenario: 'aussenposten', spielerzahl: 1 }), 'Gruppen-ID aus dem Ordner = Gruppen-ID der Basis (Modus/Szenario/Spielerzahl)');
  ok(/Commit aaaa1111/.test(fa.text) && /Commit bbbb2222/.test(fa.text) && /win32-x64|linux|darwin/.test(fa.text), 'Kopf nennt Commit und Plattform beider Seiten');
  ok(/4 Läufe \(Seeds 1, 2, 3, 4\)/.test(fa.text) && /3 Läufe \(Seeds 11, 12, 13\)/.test(fa.text), 'Kopf nennt n und die Seeds');
  ok(/zu wenig Läufe \(A 4, B 3/.test(fa.text) && /\| zu wenig Läufe \|/.test(fa.text), 'B mit 3 Laeufen: Hinweis im Kopf und Markierung "zu wenig Laeufe" in der Tabelle');
  gleich(fa.wesentlich, 0, 'zu wenig Laeufe: keine wesentliche Abweichung gemeldet');
  const fb = V.vergleichen(F, F, { filter: 'modus=arena_away,quelle=bot', filterA: 'commit=aaaa', filterB: 'commit=aaaa' });
  gleich([fb.a.n, fb.b.n], [4, 4], 'gleiche Auswahl zweimal: 4 und 4 Laeufe');
  gleich(fb.wesentlich, 0, 'dieselben Laeufe gegeneinander: nichts wesentlich');
  ok(/Tuning: gleich/.test(fb.text), 'gleicher Tuning-Hash: "Tuning: gleich"');
  const nichts = V.vergleichen(F, F, { filter: 'modus=gibtesnicht' });
  ok(nichts.leer === true && /enthält keine Läufe/.test(nichts.text), 'Filter ohne Treffer: Bericht sagt "keine Laeufe" statt abzustuerzen');
  let fehlerMsg = null; try { V.seiteLaden(F, { filter: 'unsinn=1' }); } catch (e) { fehlerMsg = e.message; }
  ok(fehlerMsg && /unbekannter Filter/.test(fehlerMsg), 'unbekannter Filterschluessel wird gemeldet');

  // Tuning-Diff: Ordner G mit anderem Hash und einem geaenderten Wert in tuning/<hash>.json
  const tj = JSON.parse(fs.readFileSync(path.join(vorlageDir, 'tuning', vlTuning + '.json'), 'utf8'));
  let geaendert = null;
  const suche = (o, pfad) => { if (geaendert) return; for (const k of Object.keys(o)) { const v = o[k]; if (typeof v === 'number' && !Array.isArray(o) && Number.isFinite(v) && v !== 0) { geaendert = { pfad: pfad.concat(k), alt: v }; o[k] = v + 7; return; } if (v && typeof v === 'object' && !Array.isArray(v)) { suche(v, pfad.concat(k)); if (geaendert) return; } } };
  const dateiMitWert = Object.keys(tj.werte).sort().find((d) => { suche(tj.werte[d], []); return geaendert; });
  ok(!!dateiMitWert, 'Vorbereitung: ein Zahlenwert in ' + dateiMitWert + ' geaendert (' + (geaendert && geaendert.pfad.join('.')) + ')');
  const NEU_HASH = 'ffff000011112222';
  tj.hash = NEU_HASH;
  const G = path.join(TMP, 'g');
  for (let i = 1; i <= 4; i++) kopie(G, 'run-t-g' + i, { commit: COMMIT_B, tuning_hash: NEU_HASH, seed: i });
  fs.mkdirSync(path.join(G, 'tuning'), { recursive: true });
  fs.writeFileSync(path.join(G, 'tuning', NEU_HASH + '.json'), JSON.stringify(tj));
  const td = V.vergleichen(F, G, { filter: 'modus=arena_away', filterA: 'commit=aaaa' });
  ok(/\*\*Tuning unterschiedlich:\*\* A `[0-9a-f]+`, B `ffff000011112222`/.test(td.text), 'unterschiedlicher Tuning-Hash: "Tuning unterschiedlich" mit beiden Hashes');
  const erwartet = dateiMitWert + ': ' + geaendert.pfad.join('.') + ': ' + JSON.stringify(geaendert.alt) + ' -> ' + JSON.stringify(geaendert.alt + 7);
  ok(td.text.includes(erwartet), 'der abweichende Tuning-Pfad steht da: "' + erwartet + '"');
  ok(td.text.split('\n').filter((l) => /^ {2}- .*->/.test(l)).length === 1, 'genau ein abweichender Pfad (sonst nichts)');
  const pf = Vergleich.tuningPfade({ config: { a: { b: 1, c: [1, 2] } }, werte: { 'x.json': { y: 1 } } }, { config: { a: { b: 2, c: [1, 3] } }, werte: { 'x.json': { y: 1, z: 2 } } });
  gleich(pf.map((e) => e.pfad + '|' + e.a + '|' + e.b), ['config: a.b|1|2', 'config: a.c[1]|2|3', 'x.json: z|(fehlt)|2'], 'tuningPfade: Zahl, Listenelement, neuer Schluessel');
  const tz = Vergleich.vergleichen(Object.assign({}, fa.a, { tuning: [['1111111111111111', 4]] }), Object.assign({}, fa.b, { tuning: [['2222222222222222', 3]] }), { tuningLaden: () => null });
  ok(/Tuning-Datei nicht gefunden/.test(tz.text), 'Tuning-Datei nicht auffindbar: Hinweis statt Absturz');

  // einzelne Dateien und Kennzahlen-JSON
  const ll1 = V.vergleichen(path.join(F, 'run-t-a1.jsonl'), path.join(F, 'run-t-a2.jsonl'), {});
  gleich(ll1.ergebnis.regel, 'lauf-lauf', 'zwei Dateien: Lauf gegen Lauf');
  const lg = V.vergleichen(path.join(F, 'run-t-a1.jsonl'), F, { filterB: 'modus=arena_away,commit=aaaa' });
  gleich(lg.ergebnis.regel, 'lauf-gruppe', 'Datei gegen Ordner: Lauf gegen Gruppe');
  const jsonDatei = path.join(TMP, 'kz.json');
  fs.writeFileSync(jsonDatei, JSON.stringify(kennzahlen(Lesen.lesen(path.join(F, 'run-t-a1.jsonl')))));
  const lj = V.vergleichen(jsonDatei, path.join(F, 'run-t-a1.jsonl'), {});
  gleich([lj.ergebnis.regel, lj.wesentlich], ['lauf-lauf', 0], 'Kennzahlen-JSON gegen dasselbe Protokoll: Lauf gegen Lauf, nichts wesentlich');
  const bs = V.seiteLaden('basis:m1/3', {});
  ok(bs.basis === true && bs.n >= 4 && bs.ids[0] === 'm1/3' && bs.amLimit == null, 'basis:m1/3 liefert die Gruppe der eingecheckten Basis (n ' + bs.n + ')');
  const bg = V.seiteLaden('basis:arena_graben/3', {});
  ok(!!bg.amLimit, 'basis:arena_graben/3 traegt den Hinweis "am Zeitlimit"');
  const bgv = V.vergleichen('basis:arena_graben/3', 'basis:m1/3', {});
  ok(/alle Läufe am Zeitlimit/.test(bgv.text), 'der Hinweis "am Zeitlimit" steht im Kopf des Vergleichs');
  let bm = null; try { V.seiteLaden('basis:gibt-es-nicht', {}); } catch (e) { bm = e.message; }
  ok(bm && /gibt es nicht; vorhanden: .*m1\/3/.test(bm), 'unbekannte Basis-Gruppe: Meldung mit den vorhandenen');
  const fremdKz = JSON.parse(fs.readFileSync(jsonDatei, 'utf8')); fremdKz.kopf.plattform = 'linux-arm64';
  const fremdDatei = path.join(TMP, 'kz-arm.json'); fs.writeFileSync(fremdDatei, JSON.stringify(fremdKz));
  const pl = V.vergleichen(jsonDatei, fremdDatei, {});
  ok(/Basis von anderer Plattform, Raumkampf nicht bit-gleich/.test(pl.text) && /linux-arm64/.test(pl.text), 'Plattformzeile bei verschiedenen Plattformen');
  const menschKz = JSON.parse(fs.readFileSync(jsonDatei, 'utf8')); menschKz.kopf.quelle = 'mensch';
  const menschDatei = path.join(TMP, 'kz-mensch.json'); fs.writeFileSync(menschDatei, JSON.stringify(menschKz));
  ok(/Bot-Läufe \(Bots spielen anders als Menschen\)/.test(V.vergleichen('basis:m1/3', menschDatei, {}).text), 'Mensch gegen Bot-Basis: Datenzeile "Basis = Bot-Laeufe"');

  // ===================== 4. Ausgabe, Rueckwaertsprobe mit Kennzahlen-Kopien =====================
  section('4. Ausgabe und Rueckwaertsprobe (Kennzahlen-Kopien einer echten Session)');
  const kzBasis = kennzahlen(Lesen.lesen(path.join(vorlageDir, vlName + '.jsonl')));
  const fk = flach(kzBasis);
  const WACKEL = ['f2.quote.boden.blaster', 'f1.dauer.session', 'f2.schaden.boden.aus.roh', 'f2.kills.boden.gesamt', 'f2.schuesse.boden.blaster'];
  ok(WACKEL.every((k) => typeof fk[k] === 'number' && fk[k] > 0), 'Vorbedingung: die Vorlage hat die Kennzahlen ' + WACKEL.join(', '));
  const setze = (o, k, v) => { const t = k.split('.'); let c = o; for (let i = 0; i < t.length - 1; i++) c = c[t[i]]; c[t[t.length - 1]] = v; };
  // 6 Kopien mit deterministischer Streuung +-5 % um den Wert; "manip" setzt eine Kennzahl auf Faktor
  const kopien = (faktoren) => [0, 1, 2, 3, 4, 5].map((i) => {
    const o = JSON.parse(JSON.stringify(kzBasis));
    for (const k of WACKEL) setze(o, k, fk[k] * (1 + 0.02 * (i - 2.5)) * ((faktoren && faktoren[k]) || 1));
    o.kopf.seed = 100 + i;
    return { kz: o, kennung: 'kopie' + i };
  });
  const sA = Vergleich.seiteAusLaeufen('A-kopien', kopien());
  const sGleich = Vergleich.seiteAusLaeufen('B-gleich', kopien());
  const rGleich = Vergleich.vergleichen(sA, sGleich, {});
  gleich(rGleich.wesentlich, 0, 'gleiche Konfiguration (identische Verteilung): keine wesentliche Abweichung');
  const sManip = Vergleich.seiteAusLaeufen('B-manip', kopien({ 'f2.quote.boden.blaster': 0.5, 'f2.schaden.boden.aus.roh': 2, 'f1.dauer.session': 1.3 }));
  const rManip = Vergleich.vergleichen(sA, sManip, {});
  const marki = (r, k) => r.text.split('\n').some((l) => l.startsWith('| ' + k + ' |') && /\*\*wesentlich\*\*/.test(l));
  ok(marki(rManip, 'f2.quote.boden.blaster'), 'Quote halbiert: markiert');
  ok(marki(rManip, 'f2.schaden.boden.aus.roh'), 'Schaden x2: markiert');
  ok(marki(rManip, 'f1.dauer.session'), 'Dauer +30 %: markiert (der Einzellauf gegen die Basis erkennt das meist nicht)');
  ok(!marki(rManip, 'f2.kills.boden.gesamt') && !marki(rManip, 'f2.schuesse.boden.blaster'), 'nicht manipulierte Kennzahlen bleiben unmarkiert');
  const rowOf = (r, k) => (r.text.split('\n').find((l) => l.startsWith('| ' + k + ' |')) || '').split('|').slice(1, -1).map((s) => s.trim());
  const zeile = rowOf(rManip, 'f1.dauer.session');
  const medA = Basis.statistik(kopien().map((l) => flach(l.kz)['f1.dauer.session']))[3], medB = Basis.statistik(kopien({ 'f1.dauer.session': 1.3 }).map((l) => flach(l.kz)['f1.dauer.session']))[3];
  const num = (s) => Number(String(s).replace('+', '').replace(',', '.'));
  ok(Math.abs(num(zeile[3]) - (medB - medA)) < 0.011, 'Delta = Median B - Median A (' + zeile[3] + ' fuer ' + (medB - medA).toFixed(2) + ')');
  ok(Math.abs(num(zeile[4]) - (100 * (medB - medA) / medA)) < 0.011, 'Delta % = Delta / Median A (' + zeile[4] + ')');
  ok(zeile[5] === '**wesentlich**' && zeile[6] === 's', 'Markierung und Einheit in den letzten Spalten');
  ok(/^\| f1\.dauer\.session \| [\d,]+ \[[\d,]+–[\d,]+\] \|/.test('| ' + zeile.join(' | ')), 'Gruppen stehen als Median [q1–q3]');
  const rLauf = Vergleich.vergleichen(Vergleich.seiteAusLaeufen('lauf-a', [kopien()[2]], { art: 'lauf' }), Vergleich.seiteAusLaeufen('lauf-b', [kopien({ 'f2.quote.boden.blaster': 0.5 })[2]], { art: 'lauf' }), {});
  ok(/\| f2\.quote\.boden\.blaster \| [\d,]+ \| [\d,]+ \|/.test(rLauf.text), 'Lauf gegen Lauf: einzelne Werte ohne Klammern');
  // Format
  const zeilenLang = (t) => t.split('\n').reduce((m, l) => Math.max(m, l.length), 0);
  const alle = Vergleich.vergleichen(sA, sManip, { alle: true });
  ok(zeilenLang(alle.text) <= 160 && zeilenLang(rManip.text) <= 160 && zeilenLang(td.text) <= 160 && zeilenLang(fa.text) <= 160, 'keine Zeile ueber 160 Zeichen (Standard und --alle, mit Tuning-Diff und Warnungen)');
  ok(rManip.text.split('\n').length <= 65, 'ohne --alle hoechstens etwa 60 Zeilen (' + rManip.text.split('\n').length + ')');
  ok(alle.text.split('\n').length > rManip.text.split('\n').length && alle.sichtbar === alle.zeilen.length, '--alle zeigt alle Zeilen (' + alle.sichtbar + ' statt ' + rManip.sichtbar + ')');
  ok(/\| Kennzahl \| A \| B \| Δ \| Δ % \| Markierung \| Einheit \|/.test(rManip.text), 'Tabellenkopf: Kennzahl, A, B, Δ, Δ %, Markierung, Einheit');
  ok(alle.zeilen.length > 50 && alle.text.split('\n').filter((l) => /^\| f\d/.test(l)).every((l) => { const i = infoZu(l.split('|')[1].trim()); return i && i.determ !== false; }), 'Technik (determ: false) steht nie in der Tabelle, auch nicht mit --alle');
  // Kernkennzahlen: je Frage 3 bis 5 (Muster), Standardausgabe enthaelt sie
  for (const f of Object.keys(Vergleich.KERN)) ok(Vergleich.KERN[f].reduce((s, e) => s + e[1], 0) >= 3 && Vergleich.KERN[f].reduce((s, e) => s + e[1], 0) <= 5, 'Kernkennzahlen Frage ' + f + ': 3 bis 5 (' + Vergleich.KERN[f].reduce((s, e) => s + e[1], 0) + ')');
  ok(/\| f2\.kills\.boden\.gesamt \|/.test(rManip.text) && /\| f3\.gefallen\.n \|/.test(rManip.text) && /\| f1\.ausgang\./.test(rManip.text), 'Standardausgabe enthaelt Kernkennzahlen auch ohne Abweichung (Kills, gefallen, Ausgang)');
  ok(/\*\*Ergebnis:\*\* 3 wesentliche Abweichungen von \d+ verglichenen Kennzahlen/.test(rManip.text), 'Kopf nennt die Zahl der wesentlichen Abweichungen');
  // Viele wesentliche Abweichungen sprengen die 60 Zeilen nicht
  const viele = JSON.parse(JSON.stringify(kzBasis));
  const vflach = flach(viele);
  for (const k of Object.keys(vflach)) { const i = infoZu(k); if (i && i.determ !== false && !/^f6\.daten/.test(k) && typeof vflach[k] === 'number') setze(viele, k, vflach[k] * 5 + 50); }
  const sViele = Vergleich.seiteAusLaeufen('viele', [0, 1, 2, 3].map((i) => ({ kz: Object.assign(JSON.parse(JSON.stringify(viele)), { kopf: Object.assign({}, viele.kopf, { seed: i }) }) })));
  const sWenig = Vergleich.seiteAusLaeufen('wenig', [0, 1, 2, 3].map((i) => ({ kz: Object.assign(JSON.parse(JSON.stringify(kzBasis)), { kopf: Object.assign({}, kzBasis.kopf, { seed: i }) }) })));
  const rViele = Vergleich.vergleichen(sWenig, sViele, {});
  ok(rViele.wesentlich > 40 && rViele.text.split('\n').length <= 65 && /weitere wesentliche Abweichungen/.test(rViele.text), 'sehr viele wesentliche Abweichungen (' + rViele.wesentlich + '): Standardausgabe bleibt bei etwa 60 Zeilen und nennt den Rest');

  // ===================== 5. Echte Probe =====================
  if (SCHNELL) console.log('\n5. Echte Probe: uebersprungen (AUSWERTUNG_SCHNELL)');
  else {
    section('5. Echte Probe: 4 + 4 Bot-Laeufe m3 (Seeds 1-4 gegen 5-8)');
    const MA = path.join(TMP, 'm3-a'), MB = path.join(TMP, 'm3-b');
    await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map((s) => bot(['m3', '--seed', String(s)], path.join(s <= 4 ? MA : MB, 's' + s))));   // je Seed ein Ordner: gleichzeitig gestartete Laeufe koennen dieselbe Laufkennung (Zeit + Zaehler) und damit denselben Dateinamen bekommen
    const echt = V.vergleichen(MA, MB, {});
    gleich([echt.a.n, echt.b.n], [4, 4], 'je 4 Laeufe (m3/3)');
    ok(echt.a.gruppe.id === 'm3/3' && echt.ergebnis.verglichen > 80, 'Gruppe m3/3, ' + echt.ergebnis.verglichen + ' Kennzahlen verglichen');
    console.log('       gleiche Konfiguration, andere Seeds: ' + echt.wesentlich + ' von ' + echt.ergebnis.verglichen + ' wesentlich');
    ok(echt.wesentlich <= Math.max(3, Math.round(0.05 * echt.ergebnis.verglichen)), 'gleiche Konfiguration: hoechstens 5 % wesentlich (Fehlalarme)');
    const laeufeB = Lesen.ordnerSessions(MB).map((e) => V.laufLesen(e.kennung, [e.dir]));
    const MANIP = { 'f2.schaden.boden.aus.roh': 2, 'f1.dauer.session': 1.5, 'f2.kills.boden.gesamt': 0.5 };
    for (const l of laeufeB) for (const k of Object.keys(MANIP)) { const v = flach(l.kz)[k]; if (typeof v === 'number') setze(l.kz, k, v * MANIP[k]); }
    const sB = Vergleich.seiteAusLaeufen('m3-b-manip', laeufeB);
    const rM = Vergleich.vergleichen(V.seiteLaden(MA, {}), sB, {});
    for (const k of Object.keys(MANIP)) ok(marki(rM, k), 'manipuliert und erkannt: ' + k + ' x' + MANIP[k]);
    const gegenBasis = V.vergleichen('basis:m3/3', MA, {});
    console.log('       basis:m3/3 gegen 4 frische Laeufe (Seeds 1-4, Teil der Basis): ' + gegenBasis.wesentlich + ' wesentlich von ' + gegenBasis.ergebnis.verglichen);
    ok(gegenBasis.ergebnis.regel === 'gruppe-gruppe' && gegenBasis.wesentlich <= Math.max(3, Math.round(0.05 * gegenBasis.ergebnis.verglichen)) && /basis:m3\/3/.test(gegenBasis.text), 'Basis-Gruppe gegen Ordner: Gruppe gegen Gruppe, Seeds der Basis enthalten: fast nichts');
  }

  // ===================== 6. Aufruf =====================
  section('6. Aufruf (Exit-Codes)');
  const cli = (...a) => spawnSync(process.execPath, [path.join(__dirname, 'vergleich.js'), ...a], { cwd: ROOT, encoding: 'utf8' });
  const aus = path.join(TMP, 'aus', 'v.md');
  const c0 = cli(F, F, '--filter', 'modus=arena_away', '--filter-a', 'commit=aaaa', '--filter-b', 'commit=aaaa', '--aus', aus);
  ok(c0.status === 0 && fs.existsSync(aus) && /# Vergleich/.test(fs.readFileSync(aus, 'utf8')) && /Zeilen/.test(c0.stdout), 'Ordner gegen Ordner mit --filter und --aus: Exit 0, Datei geschrieben');
  const c1 = cli(F, F, '--filter', 'modus=arena_away', '--alle');
  ok(c1.status === 0 && /# Vergleich/.test(c1.stdout) && c1.stdout.split('\n').length > 60, '--alle auf der Standardausgabe: Exit 0');
  const c2 = cli(F, path.join(TMP, 'gibt-es-nicht'));
  ok(c2.status === 2 && /weder Ordner, Datei, Sessionkennung noch basis/.test(c2.stderr), 'Eingabe nicht gefunden: Exit 2 mit Meldung');
  ok(cli(F).status === 2 && cli(F, F, 'drei').status === 2, 'falsche Zahl der Eingaben: Exit 2');
  ok(cli(F, F, '--filter', 'farbe=rot').status === 2 && cli(F, F, '--unsinn').status === 2 && cli(F, F, '--filter').status === 2, 'kaputter Filter, unbekannte Option, fehlender Wert: Exit 2');
  ok(cli('basis:gibt-es-nicht', F).status === 2, 'unbekannte Basis-Gruppe: Exit 2');
  const ordnerLeer = path.join(TMP, 'leer-ordner'); fs.mkdirSync(ordnerLeer);
  ok(cli(ordnerLeer, F).status === 2, 'Ordner ohne Protokolle: Exit 2');

  console.log('\n' + (n - fails) + ' von ' + n + ' Pruefungen ok' + (SCHNELL ? ' (schnell)' : ''));
  process.exit(fails ? 1 : 0);
}

// Bot-Lauf (sim-headless) mit Protokoll in dir
function bot(argumente, dir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(dir, { recursive: true });
    const ch = spawn(process.execPath, [path.join(ROOT, 'tools', 'sim-headless.js')].concat(argumente), { cwd: ROOT, env: Object.assign({}, process.env, { TELEMETRIE: 'an', TELEMETRIE_DIR: dir }), stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ch.stderr.on('data', (d) => { if (err.length < 1000) err += d; });
    ch.on('exit', (code) => (code === 0 || code === 1 ? resolve(code) : reject(new Error('sim-headless ' + argumente.join(' ') + ' Exit ' + code + ' ' + err))));
    ch.on('error', reject);
  });
}

main().catch((e) => { console.log('  FEHLER Absturz: ' + (e && e.stack || e)); process.exit(1); });
