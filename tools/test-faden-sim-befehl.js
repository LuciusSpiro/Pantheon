'use strict';
// FAD-01 A: der Folgetyp sim_befehl der Fadenvorlagen (Daten content/faeden/werte.json sim_befehl) und der Baustein enthuellung (server/sim/faden-p3.js): der Spielleiter entscheidet mit
// faden_weiter.art, ob nach der Enthuellung Sprengung, Invasion oder beides kommt; eine solche Folge steht nur nach einer Tat der Crew (Prüfer faden-pruefer.js SIM_BEFEHL_*).
//   Daten · Prüfer (Aufbau, Gegenproben je Regel a bis e) · faden_weiter.art (gültig, ungültig, ohne Folge) · Standardart · die drei Arten über den Baustein mit Funk-Reihenfolge ·
//   invasionsZiel · Fallback bei Ablehnung · Vorlagen ohne die Folge unverändert · Weltstand (kein neues Feld) · Ausschnitt, Prompt, Mock.
//   node tools/test-faden-sim-befehl.js [begriff …]
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const X = require('./faden-fixture.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Sektoren = require('../shared/sektoren.js');
const P3 = require('../server/sim/faden-p3.js');
const Pruefer = require('../server/sim/faden-pruefer.js');
const Faden = require('../server/sim/faden.js');
const Regie = require('../server/sim/regie-befehle.js');
const Dat = require('../server/weltsim/daten.js');
const LageMock = require('../server/sim/lage-mock.js');
const { F, D, klon } = X;

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, fn) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n' + name);
  try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
}
const lies = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));
const WERTE = lies('content/faeden/werte.json').werte;
const SB = WERTE.sim_befehl.wert;
const TX = lies('content/faeden/p3-texte.json');
const LB = lies('content/flotte/lage-befehle.json');
const FH_ECHT = lies('content/faeden/vorlagen/falscher_haendler.json');   // BEA-01 C1: die echte Vorlage hat jetzt zehn Beats (Referenzabenteuer Beispiel 1)
const FH = lies('tools/fixtures/faeden/falscher_haendler-fad01.json');   // BEA-01 C1: die Grundlage der Varianten ist die Vorlage wie in FAD-01 (sechs Beats, Fixture aus acf7795c), damit die Pfade dieses Tests unveraendert gelten
const ORT = '0403';   // Speculum, römisch (wie test-sim-befehl-invasion.js)
const VID = 'sim_test';
// FAD-01 C: die echte Vorlage fuehrt die Folge sim_befehl jetzt selbst; fuer die Gegenproben „Beat ohne die Folge“ dient dieselbe Vorlage ohne sie (eigene Id, gueltig: die Enthuellung bleibt ueber gelungen erreichbar)
const FH_OHNE = klon(FH); FH_OHNE.id = 'sim_test_ohne'; delete FH_OHNE.beats.find((x) => x.id === 'b_enthuell').aus.gelungen.folge;

// ---------- Testvorlage: der Falsche Händler, so umgebaut, dass die Enthüllung nur nach der gelungenen Fracht kommt (Paket C baut die echte Vorlage um)
const b = (v, id) => v.beats.find((x) => x.id === id);
function gut() {
  const v = klon(FH); v.id = VID;
  b(v, 'b_bitte').aus.gescheitert.weiter = 'b_jagd';
  b(v, 'b_fracht').aus.gescheitert.weiter = 'b_jagd';
  b(v, 'b_enthuell').aus.gelungen.folge = [{ typ: 'sim_befehl' }];
  return v;
}
const codes = (v) => { const r = Pruefer.pruefeVorlage(v); return r.fehler.map((f) => f.split(':')[0]); };
const hat = (v, code) => codes(v).includes(code);

section('Daten', () => {
  ok(Object.keys(SB.arten).join() === 'sprengung,invasion,beides', 'arten: sprengung, invasion, beides');
  ok(Object.values(SB.arten).every((l) => Array.isArray(l) && l.length && l.every((x) => ['sabotage', 'invasion'].includes(x))), 'jede Art ist eine Liste benannter Sim-Befehle (sabotage, invasion)');
  ok(SB.arten.beides.join() === SB.arten.sprengung.concat(SB.arten.invasion).join(), 'beides = beide Befehle, Sprengung zuerst');
  ok(SB.standard_art === 'invasion' && Object.keys(SB.arten).includes(SB.standard_art), 'Standardart invasion');
  ok(SB.tat_beats.join() === 'fracht' && SB.beats_erlaubt.join() === 'enthuellung', 'tat_beats fracht, beats_erlaubt enthuellung');
  ok(WERTE.folge_typen.wert.join() === 'ruf_aenderung,haltung_aenderung', 'folge_typen (Optionen) unverändert');
  ok(Number.isInteger(TX.werte.invasion_reichweite.wert) && TX.werte.invasion_reichweite.wert > 0, 'invasion_reichweite in p3-texte.json');
  const lang = Sektoren.hexName ? Object.keys(Sektoren.KARTE && Sektoren.KARTE.hexe || {}).map((h) => Sektoren.hexName(h) || '').sort((x, y) => y.length - x.length)[0] || 'Langername' : 'Langername';
  const MAX = WERTE.funk_text_max.wert;
  const keys = new Set(Object.values(TX.werte.sim_texte.wert).flat().concat(Object.values(TX.werte.sim_texte_keines.wert)));
  ok(keys.size >= 6, 'sim_texte und sim_texte_keines nennen ' + keys.size + ' Schlüssel');
  for (const k of keys) {
    const t = TX.texte[k];
    const voll = typeof t === 'string' ? t.replace(/\{name\}/g, 'Ouzo Brandt').replace(/\{ort\}|\{ziel\}|\{invasion\}/g, lang) : null;
    ok(typeof t === 'string' && !/\{(?!name\}|ort\}|ziel\}|invasion\})/.test(t) && voll.length <= MAX, `Text ${k}: vorhanden, nur bekannte Platzhalter, höchstens ${MAX} Zeichen mit langem Namen (${voll && voll.length})`);
  }
  ok(Object.keys(SB.arten).every((a) => TX.werte.sim_texte_keines.wert[a]), 'zu jeder Art gibt es einen Text für „keines gelang“');
  ok(TX.werte.sim_texte.wert[SB.arten.sprengung.join('+')] && TX.werte.sim_texte.wert[SB.arten.invasion.join('+')] && TX.werte.sim_texte.wert[SB.arten.beides.join('+')], 'zu jeder Art ein Text für die angekündigten Befehle');
});

section('Prüfer: korrekter Aufbau', () => {
  const v = gut();
  const r = Pruefer.pruefeVorlage(v);
  ok(r.ok, 'sim_befehl nach gelungener Fracht in der Enthüllung: gültig (' + r.fehler.join('; ') + ')');
  { const w = gut(); b(w, 'b_enthuell').aus.gelungen.folge = [{ typ: 'sim_befehl', arten: ['invasion', 'beides'] }]; ok(Pruefer.pruefeVorlage(w).ok, 'arten als Teilmenge (invasion, beides): gültig'); }
  { const w = gut(); b(w, 'b_enthuell').aus.gelungen.folge = [{ typ: 'sim_befehl', arten: ['invasion'] }]; ok(Pruefer.pruefeVorlage(w).ok, 'arten nur invasion: gültig'); }
  { const w = gut(); b(w, 'b_enthuell').aus.gelungen.folge = [{ typ: 'sim_befehl' }, { typ: 'haltung_aenderung', grund: 'gedankt' }]; ok(Pruefer.pruefeVorlage(w).ok, 'neben einer Haltungs-Folge: gültig'); }
  ok(Pruefer.simBefehlFolge(b(v, 'b_enthuell')).typ === 'sim_befehl' && Pruefer.simBefehlFolge(b(v, 'b_fracht')) === null, 'simBefehlFolge liest die Folge des Beats');
  ok(Pruefer.simBefehlArten({ typ: 'sim_befehl' }).join() === Object.keys(SB.arten).join(), 'ohne arten gelten alle Arten');
  ok(Pruefer.pruefeVorlage(klon(FH)).ok && Pruefer.pruefeVorlage(klon(FH_ECHT)).ok, 'die echte Vorlage falscher_haendler (mit der Folge, Paket C) ist gültig, ebenso die Vorlage wie in FAD-01 (Fixture)');
  ok(JSON.stringify(b(FH_ECHT, 'b_enthuell').aus.gelungen.folge) === '[{"typ":"sim_befehl"}]' && (JSON.stringify(FH_ECHT).match(/sim_befehl/g) || []).length === 1, 'die echte Vorlage falscher_haendler hat genau eine Folge sim_befehl (Standard-Arten) im Ausgang gelungen der Enthüllung');
  ok(Pruefer.pruefeVorlage(klon(FH_OHNE)).ok, 'dieselbe Vorlage ohne die Folge bleibt gültig (Gegenprobe)');
});

section('Prüfer: Regel (a) nur in aus.gelungen.folge', () => {
  { const w = gut(); b(w, 'b_bitte').optionen[0].folge.push({ typ: 'sim_befehl' }); ok(hat(w, 'SIM_BEFEHL_ORT'), 'in einer Option: abgelehnt (SIM_BEFEHL_ORT)'); }
  { const w = gut(); b(w, 'b_enthuell').aus.gescheitert.folge = [{ typ: 'sim_befehl' }]; ok(hat(w, 'SIM_BEFEHL_ORT'), 'in aus.gescheitert: abgelehnt (SIM_BEFEHL_ORT)'); }
  { const w = gut(); b(w, 'b_enthuell').aus.gelungen.folge = []; b(w, 'b_enthuell').aus.gescheitert.folge = [{ typ: 'sim_befehl' }]; ok(hat(w, 'SIM_BEFEHL_ORT') && !hat(w, 'SIM_BEFEHL_OHNE_TAT'), 'nur in gescheitert: der Fehler ist der Ort, nicht die Tat'); }
  { const w = gut(); b(w, 'b_bitte').variante = { wenn: 'feindlich', typ: 'raumschlacht', aus: { gelungen: { status: 'feindlich', weiter: 'b_jagd', folge: [{ typ: 'sim_befehl' }] }, gescheitert: { status: 'geflohen', weiter: 'b_jagd' } } }; ok(hat(w, 'SIM_BEFEHL_ORT'), 'in den Ausgängen einer Variante: abgelehnt (SIM_BEFEHL_ORT)'); }
  { const w = gut(); w.beats[1].aus.gelungen.folge = [{ typ: 'sim_befehl' }]; ok(hat(w, 'SIM_BEFEHL_BEAT'), 'im Ausgang gelungen eines anderen Beat-Typs (fracht): abgelehnt (SIM_BEFEHL_BEAT)'); }
  { const w = gut(); w.beats[0].aus.gelungen.folge = [{ typ: 'sim_befehl' }]; ok(hat(w, 'SIM_BEFEHL_BEAT'), 'im Beat bitte: abgelehnt (SIM_BEFEHL_BEAT)'); }
  { const w = gut(); b(w, 'b_bitte').aus.gelungen.folge = [{ typ: 'sim_befehl' }]; const c = codes(w); ok(c.includes('SIM_BEFEHL_BEAT') && c.includes('SIM_BEFEHL_OHNE_TAT'), 'im Beat bitte nach dem Anfang: Beat-Typ und Tat bemängelt'); }
  { const w = gut(); b(w, 'b_enthuell').aus.gelungen.folge = [{ typ: 'sim_befehl' }, { typ: 'sim_befehl' }]; ok(hat(w, 'SIM_BEFEHL_FORM'), 'zwei sim_befehl in einem Ausgang: abgelehnt (SIM_BEFEHL_FORM)'); }
  { const w = gut(); b(w, 'b_enthuell').aus.gelungen.folge = [{ typ: 'sim_befehl', grund: 'geholfen' }]; ok(hat(w, 'SIM_BEFEHL_FORM'), 'sim_befehl mit grund: abgelehnt (SIM_BEFEHL_FORM)'); }
});

section('Prüfer: Regel (c) jeder Weg führt über eine Tat', () => {
  { const w = gut(); b(w, 'b_fracht').aus.gescheitert.weiter = 'b_enthuell'; ok(hat(w, 'SIM_BEFEHL_OHNE_TAT'), 'Weg über fracht gescheitert (auch die Frist: Zeitablauf = gescheitert): abgelehnt'); }
  { const w = gut(); b(w, 'b_bitte').aus.gescheitert.weiter = 'b_enthuell'; ok(hat(w, 'SIM_BEFEHL_OHNE_TAT'), 'Weg direkt von bitte gescheitert (ohne Fracht): abgelehnt'); }
  { const w = gut(); b(w, 'b_bitte').aus.gelungen.weiter = 'b_enthuell'; ok(hat(w, 'SIM_BEFEHL_OHNE_TAT'), 'Weg über bitte gelungen, ohne Fracht: abgelehnt (bitte ist keine Tat im Sinn der Daten)'); }
  { const w = gut(); w.beats.splice(0, 2); w.nsc.status = 'aktiv'; ok(hat(w, 'SIM_BEFEHL_OHNE_TAT'), 'der Beat steht am Anfang (kein Weg über eine Tat): abgelehnt'); }
  { const w = gut(); b(w, 'b_bitte').aus.gelungen.weiter = 'b_enthuell'; b(w, 'b_bitte').aus.gescheitert = { status: 'verbuendet', weiter: 'b_fracht' };
    ok(hat(w, 'SIM_BEFEHL_OHNE_TAT'), 'zwei Wege zum selben Zustand, einer mit Fracht, einer ohne: der ohne Tat wird trotzdem gefunden'); }
  { const w = gut(); const e = codes(w); ok(!e.includes('SIM_BEFEHL_OHNE_TAT'), 'Gegenprobe: jeder Weg über fracht gelungen: kein Fehler'); }
  { const w = gut(); w.beats.splice(3, 0, klon(b(w, 'b_fracht'))); w.beats[3].id = 'b_fracht2'; b(w, 'b_fracht').aus.gelungen.weiter = 'b_fracht2'; b(w, 'b_fracht2').aus.gelungen.weiter = 'b_enthuell'; b(w, 'b_fracht2').aus.gescheitert.weiter = 'b_jagd'; w.beats.splice(2, 2, w.beats[3], w.beats[2]);
    ok(Pruefer.pruefeVorlage(w).ok || !hat(w, 'SIM_BEFEHL_OHNE_TAT'), 'zwei Fracht-Beats hintereinander: die Tat gilt weiter (kein falscher Alarm)'); }
});

section('Prüfer: Regel (d) Profil und Scheinwahl, Regel (e) Form von art', () => {
  ok(Pruefer.folgeProfil([{ typ: 'sim_befehl' }]) === '', 'folgeProfil: sim_befehl ist weder Ruf noch Haltung (leer)');
  ok(Pruefer.folgeProfil([{ typ: 'haltung_aenderung', grund: 'geholfen' }, { typ: 'sim_befehl' }]) === Pruefer.folgeProfil([{ typ: 'haltung_aenderung', grund: 'geholfen' }]), 'folgeProfil: mit sim_befehl dasselbe Profil wie ohne');
  ok(!Pruefer.folgeProfil([{ typ: 'sim_befehl' }]).includes('?'), 'kein Fehlerprofil „?“');
  { const w = gut(); ok(!codes(w).some((c) => /SCHEINWAHL|SCHEITERN_FOLGENLOS/.test(c)), 'die gültige Vorlage kippt nicht in SCHEINWAHL oder SCHEITERN_FOLGENLOS'); }
  { const w = gut(); b(w, 'b_bitte').optionen[0].folge = [{ typ: 'sim_befehl' }]; const c = codes(w); ok(c.includes('SIM_BEFEHL_ORT') && !c.includes('SCHEINWAHL'), 'sim_befehl in einer Option: SIM_BEFEHL_ORT, nicht zusätzlich eine falsche Scheinwahl'); }
  for (const [text, arten] of [['unbekannte Art', ['gibt_es_nicht']], ['leere Liste', []], ['doppelt', ['invasion', 'invasion']], ['ohne die Standardart', ['sprengung']], ['keine Liste', 'invasion'], ['Zahl in der Liste', [1]]]) {
    const w = gut(); b(w, 'b_enthuell').aus.gelungen.folge = [{ typ: 'sim_befehl', arten }];
    ok(hat(w, 'SIM_BEFEHL_ART') || hat(w, 'FORM'), 'arten ' + text + ': abgelehnt');
  }
  { const w = gut(); b(w, 'b_enthuell').aus.gelungen.folge = [{ typ: 'sim_befehl', art: 'invasion' }]; ok(hat(w, 'FORM'), 'unbekanntes Feld art in der Folge: abgelehnt (Schema)'); }
  { const w = gut(); b(w, 'b_enthuell').aus.gelungen.folge = [{ typ: 'haltung_aenderung' }]; ok(Pruefer.pruefeVorlage(w).fehler.some((f) => /FOLGE_UNGUELTIG/.test(f)), 'Haltungs-Folge ohne grund bleibt ungültig (FOLGE_UNGUELTIG)'); }
});

// ---------- Spiel mit offener Enthüllung
const NAMEN = ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'];
function stille(g) {   // ruhige Ausgangslage wie test-sim-befehl-invasion.js: alle Flotten voll im Heimathafen, keine Feldzüge, die Standard-KI plant nichts
  const zz = g.weltsim.zustand;
  zz.angriffe = [];
  for (const fl of zz.flotten) { fl.ort = fl.heimat; fl.befehl = 'heim'; fl.ziel = null; fl.angriff = null; fl.warte = 0; fl.staerke = fl.kap; fl.versorgung = 1; }
  for (const h of Object.values(zz.hexe)) h.anspruch = {};
  for (const f of ['rom', 'ger']) { zz.vorrat[f].T = 40; zz.vorrat[f].U = 40; zz.marken[f] = 500; }
  zz.vorrat.kon.T = 31; zz.vorrat.kon.U = 10;
  zz.regie = { rom: { p_act: 0, regler_bis: 1e9 }, ger: { p_act: 0, regler_bis: 1e9 } };
}
function funkMit(g) {
  const out = []; const orig = g.emit.bind(g);
  g.emit = (...a) => { if (a[0] === 'radio' && a[1]) out.push(a[1]); return orig(...a); };
  return out;
}
const hexe = (g) => g.weltsim.zustand.hexe;
// ein römischer Posten (ohne Hafen) im Hex-Abstand 1 bis 3 vom Ort: Ziel der Sprengung
function postenNah(g) {
  const d = Dat.datenVon(g.weltsim.zustand);
  const c = Object.keys(hexe(g)).sort().find((k) => d.hex[k].hafen === '' && !hexe(g)[k].posten && (Sektoren.hexAbstand(ORT, k) || 99) <= 3 && Sektoren.hexAbstand(ORT, k) >= 1);
  hexe(g)[c].besitzer = 'rom'; hexe(g)[c].posten = true; delete hexe(g)[c].crew;
  return c;
}
let SEED = 300;
function bereit(o) {
  o = o || {};
  const r0 = D.registriere(o.vorlage || gut());
  if (!r0.ok) throw new Error('Testvorlage ungültig: ' + r0.fehler.join('; '));
  const g = F.neuesSpiel({ crew: 1, seed: ++SEED, names: NAMEN, env: { FAEDEN: '1' } }).g;
  stille(g);
  const funk = funkMit(g);
  const a = X.angebot(g, { id: 'notruf_havarie_konvoi', hex: ORT, sprecher: 'Sprecher' });
  const r = Faden.befehlAnwenden(g, { typ: 'faden_oeffnen', vorlage: o.vorlageId || VID, parameter: { angebot: a.nr } });
  if (!r.ok) throw new Error('Faden nicht geöffnet: ' + r.grund);
  const f = r.faden;
  const v = D.vorlage(f.vorlage);
  f.hinweise = ['h_gerucht', 'h_papiere']; f.beat = v.beats.findIndex((x) => x.id === 'b_enthuell'); f.phase = 'wartet'; f.zaehler = f.abstand; f.nsc.status = 'verbuendet';
  if (o.fracht !== false) f.nsc.gedaechtnis.push({ tick: 0, ereignis: 'fracht_gelungen', text_key: 'b_fracht' });
  return { g, f, funk };
}
const weiter = (g, f, art) => Faden.befehlAnwenden(g, Object.assign({ typ: 'faden_weiter', faden: f.id, beat: 'b_enthuell' }, art === undefined ? {} : { art }));
const vorg = (g) => g.weltsim.regie.vorgemerkt;
const typen = (g) => vorg(g).map((e) => e.b.typ);
const logbuch = (g) => (g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries) || [];
const nscTexte = (funk, f) => funk.filter((x) => x && x.from === f.nsc.name).map((x) => x.text);
const txt = (key, v) => String(TX.texte[key]).replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? v[k] : m));
const nameVon = (x) => Sektoren.hexName(x) || x;

section('faden_weiter mit art: gültig, ungültig, ohne Folge', () => {
  const { g, f } = bereit();
  const pr = (art, extra) => Faden.befehlPruefen(g, Object.assign({ typ: 'faden_weiter', faden: f.id, beat: 'b_enthuell' }, art === undefined ? {} : { art }, extra || {}));
  ok(pr() === null, 'ohne art: gültig');
  for (const a of Object.keys(SB.arten)) ok(pr(a) === null, 'art ' + a + ': gültig');
  ok(/^ART_UNGUELTIG/.test(pr('gibt_es_nicht') || ''), 'unbekannte Art: ART_UNGUELTIG');
  ok(/^ART_UNGUELTIG/.test(pr(5) || '') && /^ART_UNGUELTIG/.test(pr(['invasion']) || '') && /^ART_UNGUELTIG/.test(pr(null) || ''), 'art keine Zeichenkette: ART_UNGUELTIG');
  ok(/^BEFEHL_FELD/.test(pr('invasion', { wunsch: 1 }) || ''), 'ein weiteres Fremdfeld bleibt abgelehnt (BEFEHL_FELD)');
  ok(Pruefer.BEFEHL_FELDER.faden_weiter.join() === 'typ,faden,beat,art', 'BEFEHL_FELDER faden_weiter: typ, faden, beat, art');
  // eingeschränkte Arten der Folge
  const w = gut(); b(w, 'b_enthuell').aus.gelungen.folge = [{ typ: 'sim_befehl', arten: ['invasion', 'beides'] }]; w.id = 'sim_test_eng';
  const e = bereit({ vorlage: w, vorlageId: 'sim_test_eng' });
  const pe = (art) => Faden.befehlPruefen(e.g, { typ: 'faden_weiter', faden: e.f.id, beat: 'b_enthuell', art });
  ok(pe('invasion') === null && pe('beides') === null && /^ART_NICHT_ERLAUBT/.test(pe('sprengung') || ''), 'arten invasion|beides: sprengung wird abgelehnt (ART_NICHT_ERLAUBT)');
  // ein Beat ohne die Folge (die echte Vorlage): art gibt es dort nicht
  const h = bereit({ vorlage: klon(FH_OHNE), vorlageId: 'sim_test_ohne' });
  ok(/^ART_OHNE_FOLGE/.test(Faden.befehlPruefen(h.g, { typ: 'faden_weiter', faden: h.f.id, beat: 'b_enthuell', art: 'invasion' }) || ''), 'Beat ohne sim_befehl (die Vorlage ohne die Folge): art abgelehnt (ART_OHNE_FOLGE)');
  ok(Faden.befehlPruefen(h.g, { typ: 'faden_weiter', faden: h.f.id, beat: 'b_enthuell' }) === null, 'derselbe Beat ohne art: gültig');
  const r = Faden.befehlAnwenden(h.g, { typ: 'faden_weiter', faden: h.f.id, beat: 'b_enthuell', art: 'invasion' });
  ok(!r.ok && /ART_OHNE_FOLGE/.test(r.grund) && h.f.phase === 'wartet' && vorg(h.g).length === 0, 'abgelehnt: der Faden wartet weiter, nichts vorgemerkt');
  ok(logbuch(h.g).some((x) => x.art === 'faden_pruefung' && x.ausgang === 'abgelehnt' && /ART_OHNE_FOLGE/.test(JSON.stringify(x.fehler))), 'die Ablehnung steht im Logbuch mit Grund');
  // ein anderer Beat (nicht der nächste): art lehnt der Beat-Check ab, bevor es um die Folge geht
  ok(/^REIHENFOLGE/.test(pr('invasion', { beat: 'b_jagd' }) || ''), 'falscher Beat: REIHENFOLGE zuerst');
});

section('Standardart ohne Angabe: invasion', () => {
  const { g, f, funk } = bereit();
  const r = weiter(g, f);
  ok(r.ok, 'faden_weiter ohne art angewandt');
  ok(typen(g).join() === 'invasion', 'vorgemerkt: EIN Befehl invasion (Hochstufen und Angriff in einem), keine Sprengung (' + typen(g).join() + ')');
  ok(f.nsc.status === 'feindlich' && f.beat === 3, 'Ausgang gelungen: der NSC ist feindlich, der Faden geht weiter (b_jagd)');
  const t = nscTexte(funk, f);
  ok(t.length === 1 && t[0] === txt('enthuellung_invasion', { invasion: nameVon(ORT) }), 'Funk des NSC: Text enthuellung_invasion mit Ziel ' + nameVon(ORT) + ' (' + t[0] + ')');
  ok(!('art' in (f.laufend || {})) && !('art' in f), 'keine Art am Faden');
  const e = bereit(); weiter(e.g, e.f, 'invasion');
  ok(JSON.stringify(vorg(e.g)) === JSON.stringify(vorg(g)) && e.f.nsc.status === f.nsc.status, 'art invasion ausdrücklich = ohne Angabe');
});

section('Art sprengung: wie bisher', () => {
  const { g, f, funk } = bereit();
  const p = postenNah(g);
  const z = P3.ziel(g, ORT);
  ok(z === p || z !== null, 'Testwelt: ein römischer Posten in der Nähe (' + z + ')');
  ok(weiter(g, f, 'sprengung').ok, 'angewandt');
  ok(typen(g).join() === 'sabotage' && vorg(g)[0].b.ort === z, 'vorgemerkt: nur die Sprengung am nächsten Posten ' + z);
  const t = nscTexte(funk, f);
  ok(t.length === 1 && t[0] === txt('enthuellung_sabotage', { ziel: nameVon(z) }), 'Funk: Text enthuellung_sabotage mit Ziel (' + t[0] + ')');
  ok(f.nsc.status === 'feindlich', 'Ausgang gelungen');
  const lb = logbuch(g).filter((x) => x.art === 'faden_baustein').pop();
  ok(lb && lb.ausgang === 'sim_befehl' && lb.plan.art === 'sprengung' && lb.plan.ziele.sabotage === z, 'Logbuch: sim_befehl, Art sprengung, Ziel');
});

section('Art invasion: Invasion mit Funk-Reihenfolge Ankündigung vor Wirkung', () => {
  const { g, f, funk } = bereit();
  ok(weiter(g, f, 'invasion').ok, 'angewandt');
  const z = P3.invasionsZiel(g, ORT);
  ok(z === ORT, 'Ziel der Invasion: ' + z);
  const inv = vorg(g).find((e) => e.b.typ === 'invasion');
  ok(vorg(g).length === 1 && !!inv && inv.b.ziel === z && inv.b.fraktion === 'ger' && inv.w === 1, 'vorgemerkt: genau ein Eintrag invasion auf ' + z + ', mit Ankündigungsmarke');
  ok(g.weltsim.zustand.angriffe.length === 0, 'noch keine Wirkung auf die Sim (kein Feldzug)');
  const iVor = funk.findIndex((x) => x.from === LB.vorwarnung.invasion.sprecher && x.text.startsWith(LB.vorwarnung.invasion.text.split('{')[0]));
  const iNsc = funk.findIndex((x) => x.from === f.nsc.name);
  ok(iVor >= 0 && iNsc > iVor, 'Funk: erst die Ankündigung des Oberkommandos (' + iVor + '), dann der NSC (' + iNsc + ')');
  const nFunk = funk.length;
  let wirkung = -1;
  for (let i = 0; i < 8 && wirkung < 0; i++) { Kriegslage.tick(g, 'test'); if (g.weltsim.zustand.angriffe.some((a) => a.ziel === z)) wirkung = i; }
  ok(wirkung >= 0, 'nach dem Vorlauf aus den Daten beginnt der Feldzug gegen ' + z + ' (nach ' + (wirkung + 1) + ' Takten)');
  ok(iVor < nFunk, 'die Ankündigung kam vor der Wirkung');
});

section('Art invasion: das Ziel ist das römische Ziel nahe dem Ort des Fadens', () => {
  const { g, f } = bereit(); weiter(g, f, 'invasion');
  const standard = P3.invasionsZiel(g, ORT);
  ok(vorg(g).find((e) => e.b.typ === 'invasion').b.ziel === standard, 'der Ort des Fadens bestimmt das Ziel (' + standard + '); das Lieferziel wird nicht aufbewahrt (faden.fracht wird am Ende jedes Beats gelöscht)');
});

section('Art beides: beide, Ankündigungen vor dem NSC', () => {
  const { g, f, funk } = bereit();
  const p = postenNah(g), z = P3.ziel(g, ORT), zi = P3.invasionsZiel(g, ORT);
  ok(weiter(g, f, 'beides').ok, 'angewandt');
  ok(typen(g).join() === 'sabotage,invasion', 'vorgemerkt: Sprengung, dann Invasion (' + typen(g).join() + ')');
  const iS = funk.findIndex((x) => x.from === LB.vorwarnung.sabotage.sprecher && /Sprengladung/.test(x.text));
  const iI = funk.findIndex((x) => x.from === LB.vorwarnung.invasion.sprecher && /rückt gegen/.test(x.text));
  const iN = funk.findIndex((x) => x.from === f.nsc.name);
  ok(iS >= 0 && iI > iS && iN > iI, 'Funk-Reihenfolge: Ankündigung Sprengung (' + iS + '), Ankündigung Invasion (' + iI + '), dann der NSC (' + iN + ')');
  ok(funk[iN].text === txt('enthuellung_beides', { ziel: nameVon(z), invasion: nameVon(zi) }), 'Text enthuellung_beides mit beiden Zielen (' + funk[iN].text + ')');
  ok(f.nsc.status === 'feindlich', 'Ausgang gelungen');
  const lb = logbuch(g).filter((x) => x.art === 'faden_baustein').pop();
  ok(lb && lb.ausgang === 'sim_befehl' && lb.plan.art === 'beides' && lb.plan.ziele.sabotage === z && lb.plan.ziele.invasion === zi, 'Logbuch: Art beides, beide Ziele');
  for (let i = 0; i < 8; i++) Kriegslage.tick(g, 'test');
  ok(hexe(g)[z].besitzer !== 'rom' || hexe(g)[z].posten === false, 'die Sprengung wirkt (Posten ' + z + ' ist nicht mehr römisch)');
  ok(g.weltsim.zustand.angriffe.some((a) => a.ziel === zi), 'der Feldzug gegen ' + zi + ' läuft');
});

section('Ohne Fracht: Textvariante', () => {
  const { g, f, funk } = bereit({ fracht: false });
  weiter(g, f, 'invasion');
  const t = nscTexte(funk, f);
  ok(t.length === 1 && t[0] === txt('enthuellung_invasion_ohne_fracht', { invasion: nameVon(ORT) }), 'Invasion ohne Fracht im Gedächtnis: enthuellung_invasion_ohne_fracht');
  const s = bereit({ fracht: false }); const p = postenNah(s.g); weiter(s.g, s.f, 'sprengung');
  const ts = nscTexte(s.funk, s.f);
  ok(ts.length === 1 && ts[0] === txt('enthuellung_sabotage_ohne_fracht', { ziel: nameVon(P3.ziel(s.g, ORT)) }), 'Sprengung ohne Fracht: enthuellung_sabotage_ohne_fracht');
});

section('invasionsZiel: nächstes römisches Ziel, nie Crew, nie Hauptwelt', () => {
  const g = F.neuesSpiel({ crew: 1, seed: 401, env: { FAEDEN: '1' } }).g;
  const z = g.weltsim.zustand, d = Dat.datenVon(z), haupt = Object.values(d.hauptwelten);
  const REICH = TX.werte.invasion_reichweite.wert;
  const leer = () => { for (const c of Object.keys(z.hexe)) { z.hexe[c].besitzer = 'ger'; z.hexe[c].posten = false; delete z.hexe[c].crew; } };
  const rom = (c, posten, crew) => { z.hexe[c].besitzer = 'rom'; if (posten) z.hexe[c].posten = true; if (crew) z.hexe[c].crew = true; };
  const bfs = (a) => { const dd = { [a]: 0 }; const q = [a]; while (q.length) { const h = q.shift(); for (const m of Sektoren.nachbarn(h)) if (dd[m] === undefined) { dd[m] = dd[h] + 1; q.push(m); } } return dd; };
  const alle = Object.keys(z.hexe).sort();
  const hafenRom = alle.filter((c) => d.hex[c].hafen !== '' && !haupt.includes(c));
  const frei = alle.filter((c) => d.hex[c].hafen === '');
  const passt = (c) => { const x = bfs(c); const an = (k) => alle.filter((q) => !haupt.includes(q) && x[q] === k).length; return an(1) >= 2 && an(REICH) >= 1 && an(REICH + 1) >= 1; };
  const ort = alle.find(passt) || alle[0];
  const dd = bfs(ort);
  leer();
  ok(P3.invasionsZiel(g, ort) === null, 'kein römisches Ziel: null');
  ok(P3.invasionsZiel(g, 'xxxx') === null && P3.invasionsZiel(g, undefined) === null, 'Ort ungültig: null');
  const nah = alle.filter((k) => !haupt.includes(k) && dd[k] === 1).sort(), fern = alle.filter((k) => !haupt.includes(k) && dd[k] === REICH + 1).sort(), grenz = alle.filter((k) => !haupt.includes(k) && dd[k] === REICH).sort();
  ok(nah.length >= 2 && fern.length && grenz.length, 'Testwelt: Posten-Orte im Abstand 1, ' + REICH + ' und ' + (REICH + 1));
  rom(fern[0], true);
  ok(P3.invasionsZiel(g, ort) === null, 'Posten außerhalb der Reichweite (' + (REICH + 1) + '): kein Ziel');
  rom(grenz[0], true);
  ok(P3.invasionsZiel(g, ort) === grenz[0], 'Posten genau in der Reichweite (' + REICH + '): Ziel');
  rom(nah[1], true); rom(nah[0], true);
  ok(P3.invasionsZiel(g, ort) === nah[0], 'bei gleichem Abstand gewinnt der kleinere Code (' + nah[0] + ' vor ' + nah[1] + ')');
  z.hexe[nah[0]].crew = true;
  ok(P3.invasionsZiel(g, ort) === nah[1], 'ein Posten der Crew ist nie das Ziel (nächster: ' + nah[1] + ')');
  z.hexe[nah[1]].crew = true;
  ok(P3.invasionsZiel(g, ort) === grenz[0], 'nur Posten der Crew nah: der Posten in Reichweite');
  // Hafen ist ein Ziel (anders als bei der Sprengung)
  leer();
  const h = hafenRom.map((c) => ({ c, a: bfs(ort)[c] })).filter((x) => x.a <= REICH).sort((p, q) => p.a - q.a || (p.c < q.c ? -1 : 1))[0] || null;
  if (h) { rom(h.c, false); ok(P3.invasionsZiel(g, ort) === h.c && P3.ziel(g, ort) === null, 'ein römischer Hafen ist Ziel der Invasion (' + h.c + '), nie der Sprengung'); }
  else ok(true, 'kein Hafen in Reichweite des Testorts (übersprungen)');
  leer(); z.hexe[nah[0]].besitzer = 'kon'; z.hexe[nah[0]].posten = true; z.hexe[nah[1]].besitzer = 'kon'; z.hexe[nah[1]].posten = true;
  ok(P3.invasionsZiel(g, ort) === null, 'ein Stützknoten des Konkordats ist kein Ziel (nur Rom)');
  // Hauptwelt nie
  leer();
  const hw = d.hauptwelten.rom;
  rom(hw, false);
  ok(P3.invasionsZiel(g, hw) === null, 'die Hauptwelt Roms (' + hw + ') ist nie ein Ziel, auch am eigenen Ort nicht');
  // ein Hafen, der Ort selbst: Abstand 0 zählt
  if (hafenRom[0]) { leer(); rom(hafenRom[0], false); ok(P3.invasionsZiel(g, hafenRom[0]) === hafenRom[0], 'Abstand 0: der Ort selbst, wenn er ein römischer Hafen ist'); }
  // ein Hafen in der Welt ohne Besitzer Rom: kein Ziel
  leer(); ok(hafenRom.every((c) => P3.invasionsZiel(g, c) === null), 'Häfen, die Rom nicht gehören: nie ein Ziel');
});

section('Fallback bei Ablehnung: der Beat scheitert, Funk und Logbuch', () => {
  // (1) Invasion: der Kern lehnt ab (Krieg aus)
  { const { g, f, funk } = bereit();
    g.weltsim.zustand.werte.war = false;
    const r = weiter(g, f, 'invasion');
    ok(r.ok, 'der Befehl wird angewandt, der Beat läuft');
    ok(f.nsc.status === 'geflohen' && f.beat === 3 && vorg(g).length === 0, 'Ausgang gescheitert: der NSC flieht, nichts vorgemerkt');
    const t = nscTexte(funk, f);
    ok(t.length === 1 && t[0] === txt('enthuellung_invasion_ohne', { ort: nameVon(ORT) }), 'Funk: enthuellung_invasion_ohne (' + t[0] + ')');
    const lb = logbuch(g).filter((x) => x.art === 'faden_baustein').pop();
    ok(lb && lb.ausgang === 'sim_befehl_abgelehnt' && /invasion: /.test(lb.begruendung), 'Logbuch: sim_befehl_abgelehnt mit Grund (' + (lb && lb.begruendung) + ')');
    ok(f.nsc.gedaechtnis.some((x) => x.ereignis === 'enthuellung_gescheitert'), 'Gedächtnis: enthuellung_gescheitert'); }
  // (2) Invasion: kein Ziel in Reichweite
  { const { g, f, funk } = bereit();
    for (const h of Object.values(hexe(g))) { h.besitzer = 'ger'; h.posten = false; delete h.crew; }
    weiter(g, f, 'invasion');
    ok(f.nsc.status === 'geflohen' && vorg(g).length === 0 && nscTexte(funk, f)[0] === txt('enthuellung_invasion_ohne', { ort: nameVon(ORT) }), 'kein Ziel in Reichweite: gescheitert, Funk enthuellung_invasion_ohne');
    ok(/kein römisches Ziel/.test((logbuch(g).filter((x) => x.art === 'faden_baustein').pop() || {}).begruendung), 'Logbuch nennt den Grund'); }
  // (3) Sprengung ohne Posten: der bisherige Text enthuellung_ohne
  { const { g, f, funk } = bereit();
    for (const h of Object.values(hexe(g))) { if (h.posten) h.posten = false; }
    weiter(g, f, 'sprengung');
    ok(f.nsc.status === 'geflohen' && nscTexte(funk, f)[0] === txt('enthuellung_ohne', { ort: nameVon(ORT) }), 'Sprengung ohne Posten: gescheitert, Funk enthuellung_ohne wie bisher'); }
  // (4) beides: die Invasion scheitert, die Sprengung gelingt -> gelungen mit dem Sprengungstext
  { const { g, f, funk } = bereit();
    const p = postenNah(g); const zs = P3.ziel(g, ORT);
    g.weltsim.zustand.werte.war = false;
    weiter(g, f, 'beides');
    ok(f.nsc.status === 'feindlich' && typen(g).join() === 'sabotage', 'beides, nur die Sprengung angekündigt: gelungen, nur die Sprengung vorgemerkt');
    ok(nscTexte(funk, f)[0] === txt('enthuellung_sabotage', { ziel: nameVon(zs) }), 'Funk: der Sprengungstext');
    ok(/abgelehnt: invasion/.test((logbuch(g).filter((x) => x.art === 'faden_baustein').pop() || {}).begruendung), 'Logbuch nennt die abgelehnte Invasion'); }
  // (5) beides: nichts gelingt
  { const { g, f, funk } = bereit();
    for (const h of Object.values(hexe(g))) { h.besitzer = 'ger'; h.posten = false; delete h.crew; }
    weiter(g, f, 'beides');
    ok(f.nsc.status === 'geflohen' && nscTexte(funk, f)[0] === txt('enthuellung_beides_ohne', { ort: nameVon(ORT) }), 'beides ohne jedes Ziel: gescheitert, Funk enthuellung_beides_ohne'); }
});

section('Vorlagen ohne die Folge: das bisherige Verhalten', () => {
  const { g, f, funk } = bereit({ vorlage: klon(FH_OHNE), vorlageId: 'sim_test_ohne' });
  const p = postenNah(g), z = P3.ziel(g, ORT);
  ok(weiter(g, f).ok, 'faden_weiter ohne art');
  ok(typen(g).join() === 'sabotage' && vorg(g)[0].b.ort === z, 'die feste Sprengung am nächsten Posten, keine Invasion');
  ok(nscTexte(funk, f)[0] === txt('enthuellung_sabotage', { ziel: nameVon(z) }), 'Funk wie bisher');
  const lb = logbuch(g).filter((x) => x.art === 'faden_baustein').pop();
  ok(lb && lb.ausgang === 'sabotage' && /^Sprengung bei /.test(lb.begruendung) && lb.plan.ziel === z && !('art' in lb.plan), 'Logbuch wie bisher (ausgang sabotage, plan mit ziel)');
  // eine Ausgangs-Folge der Katalog-Wirkungen bleibt unberührt
  const v = D.vorlage('sim_test_ohne');
  ok(Pruefer.simBefehlFolge(b(v, 'b_enthuell')) === null, 'die Vorlage hat keine sim_befehl-Folge');
  // nach einer Folge-Anwendung (beatAusgang) wird sim_befehl nie als Wirkung gebucht
  const e = bereit();
  weiter(e.g, e.f, 'invasion');
  ok(!logbuch(e.g).some((x) => x.art === 'faden_pruefung' && x.key === 'folge'), 'die Folge sim_befehl wird beim Ausgang übergangen (keine Ablehnung als Wirkung im Logbuch)');
});

section('Weltstand: kein neues Feld, Altstand lädt unverändert', () => {
  const { g, f } = bereit();
  weiter(g, f, 'invasion');
  const save = JSON.parse(JSON.stringify(Faden.toSave(g.weltsim)));
  ok(!JSON.stringify(save).includes('"art"'), 'der gespeicherte Faden enthält keine Art');
  const L = Faden.lesen(save);
  ok(L.liste.length === save.liste.length && L.liste[0].nsc.status === 'feindlich', 'Speichern und Laden ergeben denselben Faden');
  ok(JSON.stringify(Faden.toSave({ faeden: L })) === JSON.stringify(save), 'Speichern, Laden, Speichern ist stabil');
  const alt = lies('tools/fixtures/faeden/main-sim-altstand.json');
  ok(alt && typeof alt === 'object', 'Altstand-Fixture vorhanden (test-weltstand-kompat und test-faden-kompat laden es)');
  const schema = fs.readFileSync(path.join(__dirname, '..', 'content', 'schema', 'weltstand.schema.json'), 'utf8');
  ok(!/sim_befehl/.test(schema) , 'das Weltstand-Schema kennt keinen neuen Faden-Eintrag (nichts Neues gespeichert)');
});

section('Ausschnitt, Prompt und Mock des Lage-Spielleiters', () => {
  const { g, f } = bereit();
  const blk = Faden.ausschnittBlock(g);
  const e = blk.aktiv.find((x) => x.id === f.id);
  ok(e && e.ph === 'wartet' && e.beat === 'b_enthuell' && JSON.stringify(e.art) === JSON.stringify(Object.keys(SB.arten)), 'Ausschnitt: aktiv[].art nennt die erlaubten Arten (' + JSON.stringify(e && e.art) + ')');
  f.beat = 1;
  const e2 = Faden.ausschnittBlock(g).aktiv.find((x) => x.id === f.id);
  ok(e2 && !('art' in e2), 'ein anderer Beat: kein art im Ausschnitt');
  const p = Faden.promptText();
  ok(p.includes('art?: ' + Object.keys(SB.arten).join('|')) && p.includes('ohne art gilt ' + SB.standard_art) && Object.entries(SB.arten).every(([k, l]) => p.includes(k + ' = ' + l.join(' und '))), 'Prompt beschreibt das Feld art, die Arten und die Standardart aus den Daten');
  ok(p.includes('nach einer Tat der Crew') && p.includes(SB.tat_beats.join(', ')), 'Prompt: nie von selbst, nur nach einer Tat (Tat-Beats aus den Daten)');
  // Mock: ohne Angabe, der Standard gilt
  const prompt = '<ausschnitt>\n' + JSON.stringify({ faeden: { aktiv: [e], angebote: [] } }) + '\n</ausschnitt>\n<grenze>\n{"nr":1,"art":"szene_ende"}\n</grenze>';
  const plan = LageMock.planVon({ prompt });
  const fb = plan.befehle.find((x) => x.typ === 'faden_weiter');
  ok(fb && fb.beat === 'b_enthuell' && !('art' in fb), 'Mock: faden_weiter ohne art (der Standard gilt)');
});

console.log(`\n${n - fails} von ${n} Prüfungen bestanden`);
process.exit(fails ? 1 : 0);
