'use strict';
// FRE-03 D: der Einstieg eines Takt-Notrufs als Brett-Angebot (server/sim/abenteuer-brett.js notrufAnbieten, zurueckziehenFuerNotruf; Haken in reise-ereignis.js ausloesenTaktNotruf, notrufVerfaellt, notrufBeantworten; Daten
// content/faeden/notruf-brett.json). Geprueft, in-process mit g.step():
//   (Nr. 5) JEDER der 15 Katalog-Notrufe, einzeln erzwungen (Sektor des passenden Besitzers): beim Entstehen liegt ein Angebot am Brett mit Ort = Notruf-Hex, Absicht notruf oder rettung (aus den Daten), variante, herkunft und
//   bezug.sprecher, es steht im Snapshot, Annehmen startet den Faden (Beat notruf), die Ankunft beendet den Beat wie bisher; im Rueckfall-Betrieb ohne Modell 0 Komponisten-Aufrufe; Germanengebiet bekommt ein Angebot (ger-NSC) ·
//   Standard-Env des echten Servers (szenarioSchalter, ohne ABENTEUER_ABSICHTEN) · (Nr. 6) Schnittstelle BEA-02: hex, herkunft, bezug.sprecher, variante, notruf (Eintrag), und der Beat notruf ist unveraendert (Pruefsumme gegen main accd1e54) ·
//   Lebensdauer: Verfall, Ablehnen des Eintrags und Beantworten (ohne Annehmen) ziehen das Angebot zurueck, Ablehnen des Angebots laesst den Eintrag offen, kein Doppelangebot, Laden = beides weg, Andock-Angebote bleiben unberuehrt,
//   notruf_angebote_max wird eingehalten, 3 Notruf- und 3 Andock-Angebote zugleich · Annehmen bei laufendem Abenteuer: laeuft_schon · alter Hook: fuer Takt-Notrufe kein zweites Angebot, fuer Notrufe je Sprung unveraendert · Snapshot-Groesse.
//   node tools/test-reise-notruf-brett.js        (npm run test:reise-notruf-brett)
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
process.chdir(path.join(__dirname, '..'));
const F = require('./regie-fixture.js');
const CONFIG = require('../shared/config.js');
const Sektoren = require('../shared/sektoren.js');
const Besitz = require('../server/sim/besitz.js');
const Ruf = require('../server/sim/ruf.js');
const RE = require('../server/sim/reise-ereignis.js');
const Sprung = require('../server/sim/sprung.js');
const B1 = require('../server/sim/faden-b1.js');
const Marken = require('../server/sim/marken.js');
const Faden = require('../server/sim/faden.js');
const D = require('../server/sim/faden-daten.js');
const P = require('../server/sim/faden-pruefer.js');
const Brett = require('../server/sim/abenteuer-brett.js');
const Bauplan = require('../server/sim/faden-bauplan.js');
const Absicht = require('../server/sim/absicht-pruefer.js');
const Absicht2 = require('../server/sim/abenteuer-absicht.js');
const Weltstand = require('../server/weltstand.js');
const Sz = require('../server/sim/szenario-schalter.js');
const { Game } = require('../server/game.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = async (t, f) => { console.log('\n' + t); await f(); };
const HZ = CONFIG.tickHz;
const W = RE.WERTE;
const SCHWELLE = Math.round(W.takt_s * HZ);
const lies = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));
const NBD = lies('content/faeden/notruf-brett.json');
const NB = Object.fromEntries(Object.entries(NBD.werte).map(([k, v]) => [k, v.wert]));
const NOTRUFE = RE.KATALOG.filter((e) => e.art === 'notruf');
const ENV = { FAEDEN: '1', REISE_EREIGNISSE: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_RUECKFALL: '1' };   // wie der echte Server im Rueckfall (ohne ABENTEUER_ABSICHTEN)
const spiel = (o) => F.neuesSpiel(Object.assign({ crew: 1, seed: 7, env: ENV }, o || {}));
const R = (g) => g.weltsim.reise;
const Fz = (g) => Faden.zustandVon(g);
const lauf = (g, sek) => { for (let i = 0; i < Math.round(sek * HZ); i++) g.step(); };
const setzeHex = (g, h) => { g.ship.scene = Sektoren.ortVonHex(h); };
const ohneFlotten = (g) => { g.weltsim.zustand.flotten = []; };
const notrufAng = (g) => P.notrufAngebote(Fz(g));
const regAng = (g) => P.regulaereAngebote(Fz(g));
const klon = (x) => JSON.parse(JSON.stringify(x));
// R2 B6: Dank belastbar zaehlen, nicht per Wort: die Zeilen des Katalog-Eintrags (Sprecher, Text aus den Daten texte.dank) und des NSC (Text notruf_dank aus p3-texte.json), je fuer sich
const P3TXT = fs.readFileSync(path.join(__dirname, '..', 'content/faeden/p3-texte.json'), 'utf8');
const txt = (k) => (P3TXT.match(new RegExp('"' + k + '":\\s*"([^"]+)"')) || [])[1];
const NSC_DANK = txt('notruf_dank');
const zeilen = (funk, text) => funk.filter((x) => x.text === text);
const katDank = (e, o, funk) => funk.filter((x) => x.von === e.sprecher && e.texte.dank.some((d) => x.text === d.replace(/\{ort\}/g, Sektoren.hexName(o.hex)).replace(/\{n\}/g, e.parameter.vorlauf_s)));
const nscDank = (funk) => zeilen(funk, NSC_DANK);
const OHNE = NOTRUFE.find((e) => !e.gefahr), MIT = NOTRUFE.find((e) => e.gefahr);
const KAT = RE.KATALOG;
function nur(ids, fn) { const kopie = KAT.slice(); KAT.length = 0; for (const e of kopie) if (ids.includes(e.id)) KAT.push(e); try { return fn(); } finally { KAT.length = 0; KAT.push(...kopie); } }
function sicher(fn, p) { const alt = W.wahrscheinlichkeit; W.wahrscheinlichkeit = p == null ? 1 : p; try { return fn(); } finally { W.wahrscheinlichkeit = alt; } }
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');
const sektorenVon = (g, besitzer) => Object.keys(Sektoren.KARTE.hexe).filter((h) => Sektoren.spielbar(h) && !Sektoren.istLeerraum(h) && Sektoren.hatSzene(h) && (Besitz.besitzer(g, h) || 'frei') === besitzer).sort();
const sl = (g) => g.lageSpielleiter;
// Einen Takt-Notruf dieses Eintrags erzwingen (nur dieser Eintrag im Katalog, Zaehler auf der Schwelle, ein Tick) in einem Sektor des passenden Besitzers -> { t, g, hex, o } | null
function erzwingen(e, spielOpt) {
  const t = spiel(spielOpt), g = t.g;
  ohneFlotten(g);
  Ruf.debug(g, ['rom', '30']);   // Centurio: Eintraege mit rang_min stehen offen
  const b = (e.bedingungen.besitzer || ['rom'])[0];
  for (const h of sektorenVon(g, b)) {
    setzeHex(g, h);
    R(g).offen = []; R(g).taktIds = []; R(g).takt = SCHWELLE - 1;
    kantenOeffnen(g, h);
    nur([e.id], () => g.step());
    if (R(g).offen.length === 1 && R(g).offen[0].id === e.id) return { t, g, hex: h, o: R(g).offen[0] };
  }
  return null;
}
// Die Sektoren 0602, 0606 (Piraten) und 0706, 0806 (Vorlaeufer) haben in der Spielkarte nur verborgene (hidden) und verschlossene (locked) Kanten (gemessen in tools/test-reise-notruf-brett.js, Abschnitt S5): ohne geoeffnete Kante
// kann die Crew dort gar nicht sein, und B1.erreichbar kennt nur den Sektor selbst. Der Test oeffnet die Kanten des Sektors wirklich (explore.linksOpen fuer verborgene, explore.offenExtra fuer verschlossene Kanten) und nutzt das
// ECHTE erreichbar. Kein Stub: der Zustand, den der Test herstellt, gibt es im Spiel (Schluessel gefunden, Weg offen).
function kantenOeffnen(g, hex) {
  for (const e of Sektoren.kantenVon(hex)) {
    if (e.art === 'locked') g.explore.offenExtra.add(Sektoren.kanteId(e.a, e.b));
    else if (e.art === 'hidden' && e.key) g.explore.linksOpen.add(e.key);
  }
}
// Funkzeilen mitschreiben (von, text, fd): ab dem Aufruf
function funkAb(g) { const z = []; const e0 = g.emit.bind(g); g.emit = (ev, d) => { if (ev === 'radio') z.push({ von: d.from, text: d.text, fd: d.fd }); return e0(ev, d); }; return z; }
const angebotZu = (g, o) => notrufAng(g).find((a) => a.notruf.marke === o.marke) || null;
const faden = (g, a) => Fz(g).liste.find((f) => f.vorlage === a.ref) || null;
// BEA-02 C: der Plan des Bretts hat nach dem Notruf den Beat rettung. Ohne Crew am Ort endet er an seiner Frist (Taetigkeiten), die Verzweigung fuehrt zum Abschluss (gescheitert); der Rueckfall fuehrt ohne Modell bis dorthin.
const rettungAus = (g, f) => { for (let i = 0; i < D.BEATS.rettung.frist + 8 && f.phase !== 'abgeschlossen'; i++) { Faden.taetigkeit(g, 'andocken'); lauf(g, 1); } };
const springe = (g, hex) => Sprung.springeNach(g, Sektoren.ortVonHex(hex));

(async () => {
  await section('Daten: notruf-brett.json, Absichten, Plan', () => {
    ok(NB.notruf_angebote_max === 3 && NB.notruf_angebote_max === W.takt_offen_max, 'notruf_angebote_max 3 (= takt_offen_max), getrennt von angebote_max ' + D.WERTE.abenteuer.angebote_max);
    const katalog = Absicht.katalogStandard();
    const varianten = Array.from(new Set(NOTRUFE.map((e) => (e.parameter || {}).variante)));
    ok(varianten.length === 3 && varianten.every((v) => Object.prototype.hasOwnProperty.call(NB.absicht_je_variante, v) && Object.prototype.hasOwnProperty.call(NB.anlass_je_variante, v)), 'jede Variante des Katalogs (' + varianten.join(', ') + ') hat Absicht und Anlass in den Daten');
    ok(Object.values(NB.absicht_je_variante).concat([NB.absicht_standard]).every((a) => ['notruf', 'rettung', 'bergung'].includes(a) && Object.prototype.hasOwnProperty.call(katalog.absichten, a)), 'die Absichten in den Daten sind notruf, rettung oder bergung und stehen im Katalog der Absichten');
    const plan = klon(NBD.plan); plan.titel = NB.titel.replace('{sprecher}', 'Kutter Fortuna'); plan.anlass = NB.anlass_standard;
    plan.landeplaetze = [{ id: NB.landeplatz_id, art: NB.landeplatz_arten[NB.landeplatz_arten.length - 1] }]; plan.beats.find((b) => b.typ === 'rettung').parameter.landeplatz = NB.landeplatz_id;   // BEA-02 C: die Schablone hat keinen Landeplatz, das Brett setzt ihn je Angebot (Pflicht landeplatz an rettung)
    const r = Bauplan.pruefe(plan);
    ok(r.ok && r.vorlage.beats[0].typ === 'notruf' && r.vorlage.volk_erlaubt.includes('ger'), 'der Plan aus den Daten ist ein gueltiger Bauplan: Beat notruf, Volk ger erlaubt' + (r.ok ? '' : ' – ' + r.fehler[0]));
    ok(NOTRUFE.length === 15, '15 Katalog-Notrufe (' + NOTRUFE.length + ')');
    ok(typeof Brett.notrufAnbieten === 'function' && typeof Brett.zurueckziehenFuerNotruf === 'function', 'benannte Funktionen: notrufAnbieten, zurueckziehenFuerNotruf');
  });

  await section('Nr. 6: das VERHALTEN des Beats notruf ist unveraendert (Kai 2026-11-12: nur Texte je Variante, Akzent, Sprecher und Dank aendern sich)', () => {
    // Pruefsumme des Katalog-Eintrags notruf (beats.json) gegen main accd1e54, mit einer einzigen erlaubten Abweichung: die Liste erlaubter text_key (Texte je Variante, S1)
    const eintrag = klon(D.BEATS.notruf);
    const erl = eintrag.bauplan.parameter.text_key.erlaubt;
    ok(['notruf_standard', 'notruf_entfuehrt'].every((k) => erl.includes(k)) && ['notruf_havarie', 'notruf_ueberfall', 'notruf_belagerung'].every((k) => erl.includes(k)), 'beats.json: text_key erlaubt die alten und die drei neuen Texte je Variante');
    eintrag.bauplan.parameter.text_key.erlaubt = ['notruf_standard', 'notruf_entfuehrt'];
    ok(sha(JSON.stringify(eintrag)) === '1fd2edeb84ad4278c4d21b93aec4e10d9dab98df', 'beats.json: der Eintrag notruf ist ausser der text_key-Liste wie auf main accd1e54 (gefahr false, Parameter text_key/hex/landeplatz, Ausgaenge und Folgen, Status)');
    // Verhalten: Ankunft = gelungen (keine Landung, keine Rettung), Frist = gescheitert, kein Ort = gescheitert; der Beat laeuft ohne Landeplatz
    const m = erzwingen(NOTRUFE[4]);
    const { g, o } = m;
    const a = angebotZu(g, o);
    ok(Brett.annehmen(g, 'a' + a.nr) === null, 'Annehmen');
    const f = faden(g, a);
    const v = D.vorlage(f.vorlage);
    ok(v.beats[0].parameter.landeplatz === undefined && f.parameter.ort === o.hex && Object.keys(v.beats[0].parameter).join() === 'text_key', 'Parameter des Beats: nur text_key, kein landeplatz, Ort = Notruf-Hex (Ort am Faden)');
    ok(Faden.fristVon(f) === D.WERTE.beat_frist, 'keine eigene Frist des Beats: beat_frist ' + D.WERTE.beat_frist + ' gilt');
    lauf(g, 5);
    ok(f.phase === 'laeuft' && f.laufend && f.laufend.beat === v.beats[0].id, 'ohne Ankunft laeuft der Beat weiter (Ort zaehlt)');
    springe(g, o.hex); lauf(g, 1);
    const ged = f.nsc.gedaechtnis.map((x) => x.ereignis);
    ok(ged.includes('notruf_gelungen') && !ged.includes('notruf_gescheitert') && !g.fadenSzene, 'Ankunft am Hex = Ausgang gelungen (Gedaechtnis notruf_gelungen), keine Szene, keine Landung, keine Rettung');
    // Frist: ein zweiter Notruf, nie angekommen: nach beat_frist Taetigkeiten gescheitert
    const m2 = erzwingen(NOTRUFE[4]);
    const a2 = angebotZu(m2.g, m2.o);
    Brett.annehmen(m2.g, 'a' + a2.nr);
    const f2 = faden(m2.g, a2);
    for (let i = 0; i < D.WERTE.beat_frist + 1; i++) Faden.taetigkeit(m2.g, 'andocken');
    ok(f2.nsc.gedaechtnis.some((x) => x.ereignis === 'notruf_gescheitert'), 'Frist (beat_frist ' + D.WERTE.beat_frist + ' Taetigkeiten) ohne Ankunft: Ausgang gescheitert');
  });

  await section('Nr. 5 und 6: jeder der 15 Katalog-Notrufe einzeln (Rueckfall-Betrieb, ohne Modell, ohne ABENTEUER_ABSICHTEN)', () => {
    let gerAng = 0, gerNsc = 0;
    for (const e of NOTRUFE) {
      const m = erzwingen(e);
      if (!m) { ok(false, e.id + ': nicht erzwingbar (kein Sektor)'); continue; }
      const { g, hex, o } = m;
      const a = angebotZu(g, o);
      const tag = `${e.id} (${(e.bedingungen.besitzer || []).join('/')}, ${hex} -> ${o.hex})`;
      ok(!!a && notrufAng(g).length === 1, tag + ': beim Entstehen liegt ein Angebot am Brett');
      if (!a) continue;
      const absichtSoll = NB.absicht_je_variante[e.parameter.variante];
      ok(a.hex === o.hex && ['notruf', 'rettung', 'bergung'].includes(a.absicht.absicht) && a.absicht.absicht === absichtSoll, `${tag}: Ort = Notruf-Hex, Absicht ${a.absicht && a.absicht.absicht}`);
      ok(a.variante === e.parameter.variante && a.herkunft && a.herkunft.hex === hex && a.bezug && a.bezug.sprecher === e.sprecher && !a.bezug.nsc, `${tag}: variante ${a.variante}, herkunft ${a.herkunft && a.herkunft.hex}, bezug.sprecher "${a.bezug && a.bezug.sprecher}" (Text, kein NSC)`);
      ok(a.notruf.marke === o.marke && a.notruf.nr === o.nr && a.notruf.id === e.id, tag + ': Verknuepfung zum Eintrag (notruf nr, id, Marke)');
      const s = Brett.snapshot(g), se = s && s.angebote.find((x) => x.id === 'a' + a.nr);
      ok(!!se && se.ort === o.hex && se.notruf === 1 && se.titel.includes(e.sprecher) && se.hafen === Sektoren.hexName(hex).slice(0, 40), tag + ': im Snapshot (Ort, Titel mit Sprecher, Hafen, notruf 1)');
      ok(sl(g).aufrufe === 0 && sl(g).abenteuer.aufrufe === 0 && (sl(g).llm == null || sl(g).llm.mode === 'off'), tag + ': 0 Komponisten-Aufrufe, kein Modell (aufrufe ' + sl(g).abenteuer.aufrufe + ')');
      ok(Fz(g).angebote.length === 0, tag + ': der alte Hook legt kein zweites Angebot an');
      // Annehmen startet den Faden: Beat notruf laeuft
      const zeitAng = a.alter;
      lauf(g, 1);
      ok(a.alter === zeitAng, tag + ': das Angebot altert nicht');
      const funk = funkAb(g);
      const r = Brett.annehmen(g, 'a' + a.nr);
      const f = faden(g, a);
      const beat0 = f && D.vorlage(f.vorlage).beats[0];
      ok(r === null && !!f && f.phase === 'laeuft' && beat0.typ === 'notruf' && f.laufend && f.laufend.beat === beat0.id, tag + ': Annehmen startet den Faden, der Beat notruf laeuft');
      ok(notrufAng(g).length === 0 && R(g).offen.length === 1 && Marken.da(g, o.marke), tag + ': das Angebot ist weg, der Eintrag bleibt offen (Herr der Lebensdauer), seine Marke steht');
      if (a.volk === 'ger') { gerAng++; if (f && f.parameter.volk === 'ger') gerNsc++; }
      // Ankunft am Hex beendet den Beat wie bisher
      springe(g, o.hex); lauf(g, 3);
      ok(f && f.beat === 1 && f.nsc.gedaechtnis.some((x) => x.ereignis === 'notruf_gelungen') && g.errors === 0, tag + ': die Ankunft beendet den Beat (Beat ' + (f && f.beat) + ', Phase ' + (f && f.phase) + '), keine Fehler');   // BEA-02 C: danach beginnt der Beat rettung (Phase laeuft oder wartet), vorher stand hier phase != laeuft
      ok(R(g).offen.every((x) => x.marke !== o.marke) && notrufAng(g).length === 0, tag + ': der Eintrag ist beantwortet, kein Angebot uebrig');
      ok(sl(g).abenteuer.aufrufe === 0, tag + ': auch nach Annehmen und Ankunft 0 Komponisten-Aufrufe');
      // S1: Texte, Akzent, Dank
      const erste = funk[0];
      ok(!!erste && erste.von === f.nsc.name && erste.fd === (e.gefahr ? 2 : 1) && !/Wachschiffe/.test(erste.text), `${tag}: Funktext des Beats vom NSC (${erste && erste.von}), Akzent ${erste && erste.fd} (${e.gefahr ? 'Gefahr: rot' : 'ohne Gefahr: Messing'}), kein "Wachschiffe"`);
      ok(!!erste && erste.text.includes(Sektoren.hexName(o.hex)) && !/Standard|\{/.test(erste.text), tag + ': der Text nennt den Ort, kein Platzhalter bleibt');
      // B1: Rueckfall-Betrieb: der Faden endet von selbst
      if (e.gefahr) {
        ok(f.phase === 'wartet' && P.abenteuerLaufend(Fz(g)) === 1, tag + ': Gefahr: der Abschluss wartet, bis der Kampf vorbei ist (Phase ' + f.phase + ')');
        ok(katDank(e, o, funk).length === 0 && nscDank(funk).length === 0, tag + ': Gefahr: vor dem Ende des Kampfes kein Dank (Katalog 0, NSC 0)');
        for (let i = 0; i < e.parameter.vorlauf_s + 10 && !R(g).laufend.some((x) => x.phase === 'kampf'); i++) lauf(g, 1);
        g.space.enemies = []; lauf(g, 3);
      }
      rettungAus(g, f);
      ok(f.phase === 'abgeschlossen' && P.abenteuerLaufend(Fz(g)) === 0, tag + ': Rueckfall-Betrieb: der Faden ist abgeschlossen (Phase ' + f.phase + '), abenteuerLaufend ' + P.abenteuerLaufend(Fz(g)));
      const kd = katDank(e, o, funk), nd = nscDank(funk);
      ok(kd.length === 1 && nd.length === 0 && funk.length >= 2, `${tag}: genau EIN Dank, vom Katalog-Eintrag (${kd.length}), keiner vom NSC (${nd.length}), in ${funk.length} Funkzeilen`);
      ok(zeilen(funk, txt('abschluss_gescheitert').replace('{name}', f.nsc.name)).length === 1 && zeilen(funk, txt('notruf_abschluss')).length === 0 && zeilen(funk, txt('abschluss_gelungen')).length === 0, tag + ': Abschlusstext des Notruf-Fadens ohne gelungene Rettung ist abschluss_gescheitert (einmal), weder der Dank-Text abschluss_gelungen noch notruf_abschluss (der gilt nur nach gelungener Rettung)');
      ok(funk.every((x) => (g.players || []).every((p) => !p.name || p.name.length < 3 || !x.text.includes(p.name))), tag + ': kein Spielername im Funk');
      const nach = Brett.notrufAnbieten(g, { nr: -777, id: e.id, hex: '0603' === o.hex ? '0504' : '0603', variante: e.parameter.variante, sprecher: 'Probeschiff', marke: 'reise:n-777', ankunft: hex });
      ok(!!nach && Brett.annehmen(g, 'a' + nach.nr) === null && P.abenteuerLaufend(Fz(g)) === 1, tag + ': danach ist ein weiteres Annehmen moeglich');
    }
    ok(gerAng >= 3 && gerNsc === gerAng, `Germanengebiet: ${gerAng} Angebote im ger-Gebiet, alle mit ger-NSC beim Annehmen (${gerNsc})`);
  });

  await section('Standard-Env des echten Servers (szenarioSchalter, ohne ABENTEUER_ABSICHTEN): 5 Minuten Fahrt, ein Angebot, 0 Aufrufe', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-notruf-brett-'));
    const g = new Game({ szenarioSchalter: true, noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(dir, 'regie') }, log: () => {} });
    const conn = { inbox: [], send(m) { if (this.inbox.length < 800) this.inbox.push(m); }, sendRaw() {} };
    g.addConnection(conn);
    g.handleMessage(conn, { t: 'hello', clientId: 'FF0', name: 'Bot', color: 0 });
    g.handleMessage(conn, { t: 'lobbyOpt', startMission: 'freie_fahrt' });
    g.handleMessage(conn, { t: 'ready', ready: true });
    for (let i = 0; i < HZ; i++) g.step();
    ok(g.env.ABENTEUER_ABSICHTEN === undefined && Absicht2.aktiv(g) === false && sl(g).rueckfallBetrieb === true && Faden.spielleiterAktiv(g), 'Standard: ABENTEUER_ABSICHTEN nicht gesetzt, Modus Absichten aus, Rueckfall-Betrieb');
    g.space.enemies = [];
    lauf(g, W.takt_s + 2);
    const a = notrufAng(g)[0];
    ok(R(g).taktNr === 1 && !!a && a.hex === R(g).offen[0].hex, 'nach 5 Minuten ruhiger Lage: ein Takt-Notruf und sein Brett-Angebot (' + (a && a.vorlage.titel) + ')');
    ok(sl(g).abenteuer.aufrufe === 0 && sl(g).aufrufe === 0 && g.errors === 0, 'Zaehler aufrufe 0, keine Fehler');
    const s = Brett.snapshot(g);
    ok(!!s && s.angebote.some((x) => x.notruf === 1 && x.id === 'a' + a.nr), 'das Angebot steht im Snapshot');
    ok(Brett.annehmen(g, 'a' + a.nr) === null && !!faden(g, a) && faden(g, a).phase === 'laeuft', 'Annehmen startet den Faden auch im Standard');
  });

  await section('Lebensdauer: der Eintrag ist Herr, Verfall / Ablehnen / Beantworten ziehen das Angebot zurueck', () => {
    // Verfall
    const m = erzwingen(NOTRUFE[4]);
    const { g, o } = m;
    const a = angebotZu(g, o);
    const regVor = regAng(g).map((x) => x.nr).join(',');
    lauf(g, W.takt_leben_s + 1);
    ok(R(g).offen.every((x) => x.marke !== o.marke) && !notrufAng(g).some((x) => x.notruf.marke === o.marke) && !Fz(g).abenteuerAngebote.includes(a), 'Verfall: der Eintrag und sein Angebot sind weg (nach takt_leben_s)');
    ok((g.marken || []).some((x) => x.id === 'fund:' + o.marke), 'Verfall: die Fund-Marke liegt (Folge beim Ignorieren, wie in C)');
    ok(Brett.annehmen(g, 'a' + a.nr).code === 'kein_angebot', 'ein spaeterer Druck auf das Angebot meldet kein_angebot');
    ok(regAng(g).map((x) => x.nr).join(',') === regVor, 'Andock-/Rueckfall-Angebote unberuehrt');
    ok(Fz(g).vorrat === undefined || Fz(g).vorrat.length === 0, 'nichts im Vorrat');
    // Ablehnen des Eintrags
    const m2 = erzwingen(NOTRUFE[5]);
    const a2 = angebotZu(m2.g, m2.o);
    ok(RE.ablehnen(m2.g, m2.o.nr) === true && !notrufAng(m2.g).includes(a2) && (m2.g.marken || []).some((x) => x.id === 'fund:' + m2.o.marke), 'Ablehnen des Eintrags: Angebot zurueckgezogen, Fund-Marke gebucht');
    // Beantworten ohne Annehmen
    const m3 = erzwingen(NOTRUFE[4]);
    const a3 = angebotZu(m3.g, m3.o);
    springe(m3.g, m3.o.hex); lauf(m3.g, 2);
    ok(R(m3.g).offen.every((x) => x.marke !== m3.o.marke) && !Fz(m3.g).abenteuerAngebote.includes(a3), 'Beantworten (Ankunft ohne Annehmen): das Angebot ist weg');
    // Angebot ablehnen: der Eintrag bleibt offen, nichts im Vorrat, keine Sperre des Rueckfalls
    const m4 = erzwingen(NOTRUFE[4]);
    const a4 = angebotZu(m4.g, m4.o);
    const abg = Fz(m4.g).brett && Fz(m4.g).brett.abgelehnt.length;
    ok(Brett.ablehnen(m4.g, 'a' + a4.nr) === null && !notrufAng(m4.g).length && R(m4.g).offen.length === 1 && Marken.da(m4.g, m4.o.marke), 'Angebot ablehnen: es geht vom Brett, der Notruf-Eintrag und seine Marke bleiben');
    ok((Fz(m4.g).brett ? Fz(m4.g).brett.abgelehnt.length : 0) === (abg || 0) && (Fz(m4.g).vorrat || []).length === 0, 'Angebot ablehnen: keine Rueckfall-Sperre, nichts im Vorrat');
    ok(Fz(m4.g).abenteuerAngebote.every((x) => x.notruf ? false : true) && P.notrufAngebote(Fz(m4.g)).length === 0, 'kein neues Angebot zum selben Eintrag');
  });

  await section('Kein Doppelangebot, Obergrenze notruf_angebote_max, Notruf und Andock-Angebote nebeneinander', () => {
    const t = spiel(), g = t.g;
    ohneFlotten(g);
    setzeHex(g, '0305');
    g.missionEvent('docked', {});   // das Brett fuellt sich beim Andocken (FRE-02): angebote_max regulaere Angebote
    const reg0 = regAng(g).map((x) => x.nr);
    ok(reg0.length === D.WERTE.abenteuer.angebote_max, 'Ausgangslage: ' + reg0.length + ' regulaere Angebote am Brett');
    // direkt: dieselbe Marke zweimal -> ein Angebot
    const ev = { nr: -91, id: 'notruf_havarie_reaktor', hex: '0603', variante: 'havarie', sprecher: 'Kutter Fortuna', marke: 'reise:n-91', ankunft: '0305' };
    const a1 = Brett.notrufAnbieten(g, ev);
    ok(!!a1 && Brett.notrufAnbieten(g, ev) === null && notrufAng(g).length === 1, 'dieselbe Marke zweimal: genau ein Angebot');
    ok(Brett.notrufAnbieten(g, Object.assign({}, ev, { sprecher: 'Anderes Schiff' })) === null && notrufAng(g).length === 1, 'dieselbe Marke mit anderem Sprecher (anderer Plan): auch kein zweites Angebot');
    ok(Brett.notrufAnbieten(g, { nr: -92, id: 'x', hex: 'xxxx', variante: 'havarie', sprecher: 'S', marke: 'reise:n-92', ankunft: '0305' }) === null, 'ein ungueltiger Ort gibt kein Angebot');
    ok(Brett.notrufAnbieten(g, null) === null && Brett.notrufAnbieten(null, ev) === null, 'ungueltige Eingaben tun nichts');
    // Obergrenze
    const orte = ['0603', '0504', '0503', '0405', '0304'];
    let angelegt = 1;
    orte.slice(1).forEach((h, i) => { if (Brett.notrufAnbieten(g, { nr: -100 - i, id: 'notruf_havarie_reaktor', hex: h, variante: 'havarie', sprecher: 'S' + i, marke: 'reise:n-' + (100 + i), ankunft: '0305' })) angelegt++; });
    ok(angelegt === NB.notruf_angebote_max && notrufAng(g).length === NB.notruf_angebote_max, `Obergrenze: ${orte.length} Versuche, ${notrufAng(g).length} Angebote (notruf_angebote_max ${NB.notruf_angebote_max})`);
    ok(regAng(g).map((x) => x.nr).join(',') === reg0.join(','), 'Andock-Angebote unberuehrt: keines verdraengt (nr ' + reg0.join(',') + ')');
    const s = Brett.snapshot(g);
    ok(s.angebote.length === D.WERTE.abenteuer.angebote_max + NB.notruf_angebote_max && s.angebote.filter((x) => x.notruf === 1).length === NB.notruf_angebote_max, 'Snapshot: 3 Andock- und 3 Notruf-Angebote zugleich (' + s.angebote.length + ')');
    // Andock-Angebot wird beantwortet: der Rueckfall fuellt nach, die Notruf-Angebote bleiben
    Brett.ablehnen(g, 'a' + reg0[0]);
    g.missionEvent('docked', {});
    ok(notrufAng(g).length === NB.notruf_angebote_max && regAng(g).length === D.WERTE.abenteuer.angebote_max, 'nach Ablehnen und Andocken: wieder 3 Andock-Angebote, die 3 Notruf-Angebote bleiben');
    // Altern: Taetigkeiten lassen Andock-Angebote altern, Notruf-Angebote nie
    for (let i = 0; i < D.WERTE.abenteuer.angebot_gilt_taetigkeiten + 2; i++) g.lageGrenze('andocken');
    ok(notrufAng(g).length === NB.notruf_angebote_max && notrufAng(g).every((x) => x.alter === 0), 'nach ' + (D.WERTE.abenteuer.angebot_gilt_taetigkeiten + 2) + ' Taetigkeiten: Notruf-Angebote alter 0, alle noch da');
    notrufAng(g).forEach((x) => { x.alter = 999; });
    g.lageGrenze('andocken');
    ok(notrufAng(g).length === NB.notruf_angebote_max, 'selbst mit alter 999 verfaellt ein Notruf-Angebot nicht in Taetigkeiten (nur sein Eintrag bestimmt die Lebensdauer)');
    notrufAng(g).forEach((x) => { x.alter = 0; });
    // Anschluss-Garantie: ein Notruf-Angebot ersetzt sie nicht (ohne regulaeres Angebot legt der Rueckfall weiter eines)
    for (const x of regAng(g).slice()) Brett.ablehnen(g, 'a' + x.nr);
    ok(regAng(g).length === 0 && notrufAng(g).length === NB.notruf_angebote_max, 'alle Andock-Angebote abgelehnt: nur noch die Notruf-Angebote am Brett');
    const neuA = Brett.anschluss(g);
    ok(!!neuA && !neuA.notruf && regAng(g).length === 1 && notrufAng(g).length === NB.notruf_angebote_max, 'Anschluss-Garantie legt trotz der Notruf-Angebote ein regulaeres Angebot');
    ok(g.errors === 0, 'keine Fehler');
  });

  await section('Absichten-Modus (Opt-in ABENTEUER_ABSICHTEN=1): ein Notruf-Angebot kommt nie in den Vorrat', () => {
    const env2 = Object.assign({}, ENV, { ABENTEUER_ABSICHTEN: '1' });
    const m = erzwingen(NOTRUFE[4], { env: env2 });
    const g = m.g;
    ok(Absicht2.aktiv(g) === true, 'Modus Absichten an');
    const a = angebotZu(g, m.o);
    ok(!!a && a.absicht.absicht === NB.absicht_je_variante[NOTRUFE[4].parameter.variante], 'das Notruf-Angebot traegt seine Absicht aus den Daten (auch hier)');   // BEA-02 C: vorher fest notruf, jetzt bergung (Daten)
    g.lageGrenze('andocken');   // das Brett merkt sich die Angebote, die es sieht (Verfall legt sonst ein)
    const v0 = (Fz(g).vorrat || []).length;
    ok(Brett.ablehnen(g, 'a' + a.nr) === null && (Fz(g).vorrat || []).length === v0, 'Angebot ablehnen: nichts im Vorrat');
    const m2 = erzwingen(NOTRUFE[4], { env: env2 });
    const a2 = angebotZu(m2.g, m2.o);
    m2.g.lageGrenze('andocken');
    const v1 = (Fz(m2.g).vorrat || []).length;
    lauf(m2.g, W.takt_leben_s + 1);
    ok(!Fz(m2.g).abenteuerAngebote.includes(a2), 'Verfall: das Angebot ist weg');
    m2.g.lageGrenze('andocken');
    ok((Fz(m2.g).vorrat || []).length === v1 && m2.g.errors === 0, 'Verfall, danach eine Taetigkeit: nichts im Vorrat (der Notruf-Vorrat ist Paket E)');
  });

  await section('Takt-Lauf: 3 Notruf-Angebote zeitgleich, nie mehr, Andock-Angebote bleiben', () => {
    const t = spiel(), g = t.g;
    ohneFlotten(g);
    setzeHex(g, '0305');
    g.missionEvent('docked', {});
    const reg0 = regAng(g).map((x) => x.nr).join(',');
    let max = 0, gesehen = new Set(), regGleich = true;
    for (let i = 0; i < (30 * 60 + 1) * HZ; i++) {
      g.step();
      const k = notrufAng(g).length;
      if (k > max) max = k;
      for (const a of notrufAng(g)) gesehen.add(a.notruf.marke);
      if (i % HZ === 0) { if (regAng(g).map((x) => x.nr).join(',') !== reg0) regGleich = false; }
      // Angebot und Eintrag gehoeren zusammen: nie ein Angebot ohne offenen Eintrag
      for (const a of notrufAng(g)) if (!R(g).offen.some((o) => o.marke === a.notruf.marke)) { ok(false, 'Angebot ohne Eintrag: ' + a.notruf.marke); i = Infinity; }
    }
    ok(R(g).taktNr === 6 && gesehen.size === 6, `6 Takt-Notrufe in 30 Minuten, 6 Angebote entstanden (${gesehen.size})`);
    ok(max === 3, `nie mehr als ${NB.notruf_angebote_max} zugleich, Hoechstwert ${max}`);
    ok(regGleich, 'die Andock-Angebote blieben die ganze Zeit dieselben (keine Verdraengung, kein Alter durch den Takt)');
    ok(notrufAng(g).length === R(g).offen.length && notrufAng(g).length === 3, 'am Ende: 3 offene Eintraege, 3 Angebote');
    // Snapshot-Groesse: 3 Notruf- plus 3 Andock-Angebote
    const s6 = Buffer.byteLength(JSON.stringify(Brett.snapshot(g)));
    const alle = Fz(g).abenteuerAngebote.slice();
    Fz(g).abenteuerAngebote = alle.filter((a) => !a.notruf);
    const s3 = Buffer.byteLength(JSON.stringify(Brett.snapshot(g)));
    Fz(g).abenteuerAngebote = alle;
    const gesamt = Buffer.byteLength(JSON.stringify(g.snapshot()));
    console.log(`  Messung: Brett-Block mit 3 Andock-Angeboten ${s3} B, mit 3 Notruf- plus 3 Andock-Angeboten ${s6} B (Zuwachs ${s6 - s3} B, ${Math.round((s6 - s3) / 3)} B je Notruf-Angebot); g.snapshot() gesamt ${gesamt} B (Grenze ${CONFIG.net.snapMax - CONFIG.net.snapLuft} B)`);
    ok(s6 - s3 < 2400 && gesamt <= CONFIG.net.snapMax - CONFIG.net.snapLuft, 'der Zuwachs ist klein (< 2400 B, BEA-02 C: vorher 2000, der Plan hat drei Beats) und der Snapshot bleibt unter der Grenze');
    // Laden: Eintrag und Angebot sind gemeinsam weg
    const d1 = JSON.parse(JSON.stringify(Weltstand.capture(g)));
    ok(Weltstand.validate(d1).length === 0 && !JSON.stringify(d1).includes('"notruf":{"nr"'), 'Weltstand schemagueltig, kein Notruf-Angebot darin');
    const dir = F.freshDir(); d1.id = 'w-notruf-brett'; fs.writeFileSync(path.join(dir, 'w-notruf-brett.json'), JSON.stringify(d1));
    const g2 = spiel({ dir, world: 'w-notruf-brett' }).g;
    ok(g2.phase === 'play' && g2.errors === 0 && R(g2).offen.length === 0 && notrufAng(g2).length === 0, `Laden: Eintraege ${R(g2).offen.length} und Notruf-Angebote ${notrufAng(g2).length} gemeinsam weg (konsistent)`);
    ok(R(g2).taktNr === R(g).taktNr, 'der Takt-Zaehler bleibt (taktNr ' + R(g2).taktNr + ')');
    g2.space.enemies = [];
    lauf(g2, 3 * W.takt_s + 5);
    ok(notrufAng(g2).every((a) => R(g2).offen.some((o) => o.marke === a.notruf.marke)) && notrufAng(g2).length === R(g2).offen.length, 'nach dem Laden entstehen neue Notrufe wieder mit Angebot (' + notrufAng(g2).length + ')');
  });

  await section('Annehmen bei laufendem Abenteuer meldet klar (laeuft_schon), Angebot und Eintrag bleiben', () => {
    const t = spiel(), g = t.g;
    ohneFlotten(g);
    setzeHex(g, '0305');
    g.missionEvent('docked', {});
    const r0 = Brett.annehmen(g, 'a' + regAng(g)[0].nr);
    ok(r0 === null && P.abenteuerLaufend(Fz(g)) === 1, 'ein Andock-Angebot ist angenommen: ein Abenteuer laeuft');
    nur([NOTRUFE[4].id], () => { R(g).takt = SCHWELLE - 1; g.step(); });
    const a = notrufAng(g)[0];
    const r = a && Brett.annehmen(g, 'a' + a.nr);
    ok(!!a && r && r.code === 'laeuft_schon' && typeof r.text === 'string' && r.text.length > 3, 'Notruf-Angebot annehmen: ' + (r && r.code) + ' ("' + (r && r.text) + '")');
    ok(notrufAng(g).includes(a) && R(g).offen.length === 1 && P.abenteuerLaufend(Fz(g)) === 1, 'das Angebot und der Eintrag bleiben, es laeuft weiter genau ein Abenteuer');
  });

  await section('Alter Hook (faden.ausgangMitPerson): fuer Takt-Notrufe entfallen, fuer Notrufe je Sprung unveraendert (Lage-Spielleiter)', () => {
    // Takt-Notruf ohne Gefahr: Ankunft, kein F.angebote
    const m = erzwingen(NOTRUFE[4]);
    springe(m.g, m.o.hex); lauf(m.g, 2);
    ok(Fz(m.g).angebote.length === 0, 'Takt-Notruf ohne Gefahr, beantwortet: kein Eintrag in F.angebote (kein zweiter Einstieg)');
    // Takt-Notruf mit Gefahr, bewaeltigt: auch keiner
    const m2 = erzwingen(NOTRUFE[0]);
    springe(m2.g, m2.o.hex); lauf(m2.g, 30);
    m2.g.space.enemies = []; lauf(m2.g, 3);
    ok(Fz(m2.g).angebote.length === 0 && R(m2.g).laufend.length === 0, 'Takt-Notruf mit Gefahr, bewaeltigt: kein Eintrag in F.angebote');
    // Notruf je Sprung (kein Takt): der Hook legt sein Angebot weiter an
    const t = spiel(), g = t.g; ohneFlotten(g); Ruf.debug(g, ['rom', '30']);
    sicher(() => nur(['notruf_havarie_reaktor'], () => springe(g, '0305')));
    const o = R(g).offen.find((x) => x.id === 'notruf_havarie_reaktor');
    ok(!!o && !o.takt && notrufAng(g).length === 0, 'Notruf je Sprung: Eintrag ohne takt, kein Brett-Angebot (Paket D gilt dem Takt)');
    sicher(() => springe(g, o.hex), 0); lauf(g, 2);
    ok(Fz(g).angebote.length === 1, 'Notruf je Sprung, beantwortet: der Hook legt sein Angebot in F.angebote an (Lage-Spielleiter bleibt bedient)');
    // ohne Faeden und ohne Spielleiter: kein Angebot, kein Fehler, der Notruf bleibt ein Katalog-Notruf
    const h = F.neuesSpiel({ crew: 1, seed: 7, env: { REISE_EREIGNISSE: '1' } }).g;
    ohneFlotten(h);
    nur([NOTRUFE[4].id], () => { setzeHex(h, '0305'); R(h).takt = SCHWELLE - 1; h.step(); });
    ok(R(h).offen.length === 1 && h.errors === 0 && Brett.notrufAnbieten(h, { nr: -1, id: 'x', hex: '0603', variante: 'havarie', sprecher: 'S', marke: 'reise:n-1', ankunft: '0305' }) === null, 'ohne FAEDEN: der Notruf entsteht, kein Angebot, keine Fehler');
  });

  await section('B1: nur Notruf-Faeden, nur im Rueckfall-Betrieb', () => {
    // ein regulaerer Faden (Geruecht, Abschluss) bleibt von notrufRueckfallWeiter unberuehrt (FRE-05: ihn fuehrt abenteuerRueckfallWeiter, bewiesen in test-reise-rueckfall-regulaer.js)
    const t = spiel(), g = t.g; ohneFlotten(g);
    Fz(g).abenteuerAngebote.length = 0;
    const plan = { format: 'faden-bauplan/1', titel: 'Testauftrag Eins', anlass: 'Ein Test ohne Namen fuer das Brett.', beats: [{ typ: 'geruecht' }, { typ: 'abschluss' }], volk_erlaubt: ['rom'] };
    const r = Faden.abenteuerAnbieten(g, plan, { hex: Sektoren.hexVonOrt(g.ship.scene) });
    ok(r.ok && Brett.annehmen(g, 'a' + r.angebot.nr) === null, 'ein regulaerer Faden ist angenommen');
    const f = Fz(g).liste.find((x) => x.vorlage === r.angebot.ref);
    f.beat = 1; f.zaehler = f.abstand;   // wartet auf den Abschluss
    ok(P.notrufBrettFaden(f) === false && Brett.notrufRueckfallWeiter(g) === 0 && f.phase === 'wartet' && f.beat === 1, 'notrufRueckfallWeiter fuehrt einen regulaeren Faden nicht weiter (Phase ' + f.phase + ')');
    // ein Notruf-Faden, aber kein Rueckfall-Betrieb (Modell vorhanden): nichts
    const m = erzwingen(NOTRUFE[4]);
    const a = angebotZu(m.g, m.o);
    Brett.annehmen(m.g, 'a' + a.nr);
    const fn = faden(m.g, a);
    const rb = sl(m.g).rueckfallBetrieb, modus = sl(m.g).mode;
    sl(m.g).rueckfallBetrieb = false; sl(m.g).mode = 'mock';   // ein Modell (hier: Mock) steuert die Faeden selbst: Spielleiter aktiv, aber kein Rueckfall-Betrieb
    try {
      springe(m.g, m.o.hex); lauf(m.g, 3);
      ok(P.notrufBrettFaden(fn) === true && fn.phase === 'wartet' && Brett.notrufRueckfallWeiter(m.g) === 0, 'mit Spielleiter (Modus mock) ohne Rueckfall-Betrieb fuehrt die Funktion einen Notruf-Faden nicht weiter, das ist Sache des Spielleiters (Phase ' + fn.phase + ')');
    } finally { sl(m.g).rueckfallBetrieb = rb; sl(m.g).mode = modus; }
    lauf(m.g, 1);
    ok(fn.phase !== 'wartet' || fn.beat === 2, 'mit Rueckfall-Betrieb geht er im naechsten Takt weiter (Beat rettung, Phase ' + fn.phase + ')');   // BEA-02 C: vorher: abgeschlossen im naechsten Takt
    rettungAus(m.g, fn);
    ok(fn.phase === 'abgeschlossen', 'mit Rueckfall-Betrieb endet er (nach der Frist der Rettung) von selbst (Phase ' + fn.phase + ')');
    ok(m.g.errors === 0 && g.errors === 0, 'keine Fehler');
  });

  await section('S3: ein angenommener Notruf verfaellt nicht als ignoriert', () => {
    const m = erzwingen(NOTRUFE[4]);
    const { g, o } = m;
    const a = angebotZu(g, o);
    const funk = funkAb(g);
    lauf(g, W.takt_leben_s - 30);   // fast am Ende der ersten Frist
    ok(Brett.annehmen(g, 'a' + a.nr) === null && R(g).offen.find((x) => x.marke === o.marke).angenommen === true, 'Annehmen kurz vor Fristende: der Eintrag ist angenommen');
    lauf(g, 60);   // die erste Frist waere jetzt um
    ok(R(g).offen.some((x) => x.marke === o.marke) && Marken.da(g, o.marke), 'die erste Frist ist um, der Eintrag und seine Marke leben weiter (Frist ab Annehmen neu)');
    ok(!(g.marken || []).some((x) => x.id === 'fund:' + o.marke), 'kein Wrack (Fund-Marke) mitten auf dem Weg');
    springe(g, o.hex); lauf(g, 3);
    rettungAus(g, faden(g, a));
    ok(katDank(NOTRUFE[4], o, funk).length === 1 && nscDank(funk).length === 0 && faden(g, a).phase === 'abgeschlossen','Ankunft nach der ersten Frist: der Katalog-Eintrag dankt (genau einmal, der NSC nicht), der Faden ist abgeschlossen');
    ok(!(g.marken || []).some((x) => x.id === 'fund:' + o.marke), 'kein Wrack nach der Ankunft');
    // nie angekommen: nach der neuen Frist weg, aber nicht als ignoriert gebucht
    const m2 = erzwingen(NOTRUFE[4]);
    const a2 = angebotZu(m2.g, m2.o);
    Brett.annehmen(m2.g, 'a' + a2.nr);
    lauf(m2.g, W.takt_leben_s + 5);
    ok(!R(m2.g).offen.some((x) => x.marke === m2.o.marke) && !Marken.da(m2.g, m2.o.marke) && !(m2.g.marken || []).some((x) => x.id === 'fund:' + m2.o.marke), 'nie angekommen: nach der neuen Frist ist der Eintrag weg, KEIN Fund (nicht ignoriert)');
    const ch = require('../server/sim/chronik.js').letzte(m2.g, 80).map((x) => x.kurz).filter((k) => k.includes(Sektoren.hexName(m2.o.hex)));
    ok(!ch.some((k) => /unbeantwortet|verlassene|Wrack/.test(k)) && ch.some((k) => /nicht rechtzeitig erreicht/.test(k)), 'Chronik: "nicht rechtzeitig erreicht", keine Zeile "unbeantwortet" und kein verlassenes Wrack (' + ch.length + ' Zeilen)');
    ok(faden(m2.g, a2).phase === 'abgeschlossen' && faden(m2.g, a2).ausgang.art === 'gescheitert', 'R2 B2: nach dem Verfall ist der Faden gescheitert abgeschlossen (Phase ' + faden(m2.g, a2).phase + ')');
    ok(m2.g.errors === 0, 'keine Fehler');
  });

  await section('S4: das Brett meldet fuer ein Notruf-Angebot keine Restzeit', () => {
    const m = erzwingen(NOTRUFE[4]);
    const g = m.g;
    g.missionEvent('docked', {});
    const s = Brett.snapshot(g);
    const nr = s.angebote.filter((x) => x.notruf === 1), reg = s.angebote.filter((x) => x.notruf !== 1);
    ok(nr.length === 1 && !Object.prototype.hasOwnProperty.call(nr[0], 'rest'), 'Notruf-Angebot im Snapshot: kein Feld rest (' + JSON.stringify(Object.keys(nr[0] || {})) + ')');
    ok(reg.length >= 1 && reg.every((x) => Number.isInteger(x.rest) && x.rest >= 0), 'regulaere Angebote tragen weiter rest (' + reg.map((x) => x.rest).join(',') + ')');
    lauf(g, 60);
    ok(!Object.prototype.hasOwnProperty.call(Brett.snapshot(g).angebote.find((x) => x.notruf === 1) || {}, 'rest'), 'auch spaeter kein rest');
  });

  await section('S5: Piraten- und Vorlaeufer-Sektoren (0602, 0606, 0706, 0806): echte Kanten, echtes erreichbar, Takt wie Sprung pruefen den Besitzer', () => {
    for (const h of ['0602', '0606', '0706', '0806']) {
      const g = spiel().g; ohneFlotten(g); Ruf.debug(g, ['rom', '30']);
      setzeHex(g, h);
      const bes = Besitz.besitzer(g, h);
      const zu = B1.erreichbar(g, h, W.takt_tiefe).size;
      ok(['pirat', 'vorl'].includes(bes) && zu === 1 && Sektoren.kantenVon(h).every((e) => e.art !== 'open' || !Sektoren.spielbar(Sektoren.anderes(e, h))), `${h} (${bes}): ohne geoeffnete Kante kennt erreichbar nur den Sektor selbst (${zu}) und der Takt findet keinen Ort (${R(g).offen.length} offen)`);
      kantenOeffnen(g, h);
      const offen = B1.erreichbar(g, h, W.takt_tiefe);
      ok(offen.size > 1, `${h}: mit geoeffneten Kanten findet das ECHTE erreichbar ${offen.size} Orte`);
      const ids = new Set();
      for (let nr = 0; nr < 40; nr++) { R(g).taktNr = nr; R(g).offen = []; const ev = RE.taktNotruf(g); if (ev) ids.add(ev.id); }
      const erlaubt = new Set(NOTRUFE.filter((e) => (e.bedingungen.besitzer || ['rom']).includes(bes)).map((e) => e.id));
      ok(ids.size >= 1 && [...ids].every((id) => erlaubt.has(id)), `${h}: der Takt waehlt aus den ${erlaubt.size} Eintraegen fuer ${bes} (${ids.size} gezogen)`);
      R(g).taktNr = 0; R(g).offen = [];
      const k = RE.kandidaten(g, R(g), h).filter((x) => x.e.art === 'notruf').map((x) => x.e.id);
      ok(k.every((id) => erlaubt.has(id)), `${h}: der Sprung (kandidaten) prueft denselben Besitzer: ${k.length} Notruf-Kandidaten, alle fuer ${bes}`);
    }
  });

  await section('N1: ein Takt-Notruf waehlt keinen Eintrag, der schon offen ist', () => {
    const g = spiel().g; ohneFlotten(g); setzeHex(g, '0305');
    const passend = NOTRUFE.filter((e) => nur([e.id], () => { R(g).offen = []; R(g).taktIds = []; return RE.taktNotruf(g) !== null; })).map((e) => e.id);
    ok(passend.length >= 2, 'mindestens zwei Eintraege passen am Hex 0305 (' + passend.length + ')');
    const [x, y] = passend;
    const ziehen = (ids, offenIds) => { const z = new Set(); for (let nr = 0; nr < 30; nr++) { R(g).taktNr = nr; R(g).taktIds = []; R(g).offen = offenIds.map((id, i) => ({ nr: -(i + 1), id, hex: ['0603', '0504'][i], bis: Number.MAX_SAFE_INTEGER, marke: 'reise:n-' + (i + 1) })); const ev = nur(ids, () => RE.taktNotruf(g)); if (ev) z.add(ev.id); } return z; };
    ok(ziehen([x, y], []).has(x), 'Gegenprobe: ohne offenen Eintrag wird auch ' + x + ' gezogen');
    const z = ziehen([x, y], [x]);
    ok(z.size >= 1 && !z.has(x) && z.has(y), 'ist ' + x + ' offen, kommt er nie noch einmal (gezogen: ' + [...z].join(',') + ')');
    const z2 = ziehen([x], [x]);
    ok(z2.has(x), 'bleibt keine Auswahl, kommt er trotzdem (der Takt tut nicht still nichts)');
  });

  await section('N3: Brett-Snapshot-Budget mit 3 regulaeren und 3 Notruf-Angeboten (lange Texte)', () => {
    const g = spiel().g; ohneFlotten(g);
    Fz(g).abenteuerAngebote.length = 0;
    const hex = Sektoren.hexVonOrt(g.ship.scene);
    const orte = RE.umkreis(hex, 1, 3);
    const titel = ['Lange Reise durch das Grenzland Eins', 'Zweiter langer Auftrag mit Titel', 'Dritter Auftrag am schwarzen Brett'];
    const typen = [['geruecht', 'konvoi'], ['geruecht', 'spur'], ['konvoi', 'geleit']];
    for (let i = 0; i < 3; i++) {
      const r = Faden.abenteuerAnbieten(g, { format: 'faden-bauplan/1', titel: titel[i], anlass: 'Ein recht langer Anlass mit vielen Worten, damit die Karte am Brett so gross wird wie sie im Spiel werden kann.', beats: typen[i].map((t) => ({ typ: t })).concat([{ typ: 'abschluss' }]) }, { hex: orte[i] });
      if (!r.ok) console.log('  (regulaer ' + i + ': ' + r.grund + ')');
    }
    const s3 = JSON.stringify(Brett.snapshot(g)).length;
    const sp = ['Vermessungsschiff Cartographa', 'Schrotthaendler Rostnagel', 'Haendler Kupferkranich'];
    for (let i = 0; i < 3; i++) Brett.notrufAnbieten(g, { nr: -(i + 1), id: 'x', hex: orte[3 + i], variante: 'piratenueberfall', sprecher: sp[i], marke: 'reise:n-' + (i + 1), ankunft: hex });
    const snap = Brett.snapshot(g), s6 = JSON.stringify(snap).length;
    console.log(`  Messung: 3 regulaere Karten ${s3} Zeichen, 3 regulaere plus 3 Notruf-Karten ${s6} Zeichen (Reviewer: 3615)`);
    ok(snap.angebote.length === 6 && snap.angebote.filter((x) => x.notruf === 1).length === 3, 'sechs Karten (3 regulaer, 3 Notruf)');
    ok(s6 < 4200 && s3 < 2500, `Budget: 6 Karten < 4200 Zeichen (${s6}), 3 regulaere < 2500 (${s3}); der Spielstand-Snapshot gesamt bleibt unter ${CONFIG.net.snapMax - CONFIG.net.snapLuft}`);
    ok(Buffer.byteLength(JSON.stringify(g.snapshot())) <= CONFIG.net.snapMax - CONFIG.net.snapLuft, 'g.snapshot() mit 6 Karten unter der Grenze');
  });

  await section('R2 B1: die Erkennung haengt an der Herkunft: ein regulaeres Angebot mit Notruf-foermigem Plan ist kein Brett-Notruf-Faden', () => {
    const t = spiel(), g = t.g; ohneFlotten(g);
    Fz(g).abenteuerAngebote.length = 0;
    const here = Sektoren.hexVonOrt(g.ship.scene);
    const ziel = Sektoren.kantenVon(here).map((e) => (e.a === here ? e.b : e.a)).find((h) => Sektoren.spielbar(h) && Sektoren.hatSzene(h));
    const plan = { format: 'faden-bauplan/1', titel: 'Hilferuf Probe', anlass: 'Ein Schiff ruft um Hilfe und wartet.', beats: [{ typ: 'notruf', parameter: { text_key: 'notruf_standard' } }, { typ: 'abschluss' }], volk_erlaubt: ['rom', 'kon', 'ger'] };
    const r = Faden.abenteuerAnbieten(g, plan, { hex: ziel });
    ok(r.ok && !r.angebot.notruf, 'ein regulaeres Angebot mit Plan notruf, abschluss (so sieht ein Plan der Absicht notruf/rettung des Komponisten aus) traegt kein Feld notruf');
    if (!r.ok) return;
    ok(Brett.annehmen(g, 'a' + r.angebot.nr) === null, 'angenommen');
    const f = Fz(g).liste.find((x) => x.vorlage === r.angebot.ref);
    ok(!!f && f.plan.beats[0].typ === 'notruf' && f.notruf === undefined && P.notrufBrettFaden(f) === false, 'der Faden hat die FORM eines Notruf-Plans, aber keine Herkunft: notrufBrettFaden false, kein Feld notruf');
    f.zaehler = Math.max(f.zaehler, f.abstand);
    ok(Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: D.vorlage(f.vorlage).beats[0].id }).ok === true, 'Beat notruf gestartet (wie der Spielleiter)');
    const funk = funkAb(g);
    springe(g, ziel); lauf(g, 3);
    ok(f.phase === 'wartet' && f.beat === 1 && Brett.notrufRueckfallWeiter(g) === 0, 'Ankunft: der Rueckfall fuehrt den regulaeren Faden NICHT weiter (Phase ' + f.phase + ', Beat ' + f.beat + ')');
    ok(nscDank(funk).length === 1, 'der Beat dankt selbst: genau eine NSC-Zeile notruf_dank (' + nscDank(funk).length + ')');
    f.zaehler = Math.max(f.zaehler, f.abstand);
    Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: D.vorlage(f.vorlage).beats[f.beat].id });
    ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gelungen', 'Abschluss gelungen');
    ok(zeilen(funk, txt('abschluss_gelungen')).length === 1 && zeilen(funk, txt('notruf_abschluss')).length === 0, 'Abschlusstext abschluss_gelungen (nicht der Brett-Text notruf_abschluss, wie in fre03e)');
    ok((f.nsc.gedaechtnis || []).some((x) => x.ereignis === 'abschluss_gelungen') && g.errors === 0, 'Gedaechtnis abschluss_gelungen, keine Fehler');
  });

  await section('R2 B1: die Herkunft steht im Weltstand (Speichern und Laden), Altstand ohne Feld bleibt gueltig', () => {
    const m = erzwingen(MIT), { g, o } = m;
    const a = angebotZu(g, o);
    Brett.annehmen(g, 'a' + a.nr);
    const f = faden(g, a);
    ok(P.notrufBrettFaden(f) && f.notruf.marke === o.marke, 'Brett-Notruf-Faden traegt notruf { marke } = Marke des Eintrags (' + (f.notruf && f.notruf.marke) + ')');
    const d1 = JSON.parse(JSON.stringify(Weltstand.capture(g)));
    ok(Weltstand.validate(d1).length === 0 && d1.welt.sim.faeden.liste[0].notruf.marke === o.marke, 'der Weltstand ist gueltig (Schema) und enthaelt das Feld');
    const dir = F.freshDir(); d1.id = 'w-r2-b1'; fs.writeFileSync(path.join(dir, 'w-r2-b1.json'), JSON.stringify(d1));
    const g2 = spiel({ dir, world: 'w-r2-b1' }).g;
    const f2 = Fz(g2).liste.find((x) => x.vorlage === a.ref);
    ok(!!f2 && P.notrufBrettFaden(f2) && f2.notruf.marke === o.marke && JSON.stringify(f2.notruf) === JSON.stringify(f.notruf), 'nach dem Laden erkennt notrufBrettFaden den Faden weiter, Feld unveraendert');
    const d2 = JSON.parse(JSON.stringify(Weltstand.capture(g2)));
    ok(JSON.stringify(d2.welt.sim.faeden.liste) === JSON.stringify(d1.welt.sim.faeden.liste), 'Speichern, Laden, Speichern ergibt denselben Faeden-Block');
    const d3 = JSON.parse(JSON.stringify(d1)); delete d3.welt.sim.faeden.liste[0].notruf; d3.id = 'w-r2-b1a';
    const d4 = JSON.parse(JSON.stringify(d1)); d4.welt.sim.faeden.liste[0].notruf = { marke: 'x' }; d4.id = 'w-r2-b1b';
    fs.writeFileSync(path.join(dir, 'w-r2-b1a.json'), JSON.stringify(d3));
    const g3 = spiel({ dir, world: 'w-r2-b1a' }).g;
    const f3 = Fz(g3).liste.find((x) => x.vorlage === a.ref);
    ok(!!f3 && f3.notruf === undefined && g3.errors === 0 && Weltstand.validate(d3).length === 0, 'Altstand ohne Feld: Weltstand gueltig, der Faden wird geladen, ohne Herkunft');
    ok(Weltstand.validate(d4).some((x) => /notruf/.test(x)), 'Schema: eine unbrauchbare Marke wird abgewiesen');
    const f4 = Faden.lesen(d4.welt.sim.faeden).liste.find((x) => x.vorlage === a.ref);
    ok(!!f4 && f4.notruf === undefined, 'der muellfeste Leser laesst nur das Feld fallen, der Faden bleibt (ohne Herkunft)');
  });

  await section('R2 B4 (dokumentiert, nicht behoben): nach Speichern und Laden mit angenommenem Notruf-Faden fehlen Dank und Kampf', () => {
    const m = erzwingen(MIT), { g, o } = m;
    const a = angebotZu(g, o);
    Brett.annehmen(g, 'a' + a.nr);
    const d1 = JSON.parse(JSON.stringify(Weltstand.capture(g)));
    const dir = F.freshDir(); d1.id = 'w-r2-b4'; fs.writeFileSync(path.join(dir, 'w-r2-b4.json'), JSON.stringify(d1));
    const g2 = spiel({ dir, world: 'w-r2-b4' }).g;
    ohneFlotten(g2); g2.space.enemies = [];
    const f2 = Fz(g2).liste.find((x) => x.vorlage === a.ref);
    ok(R(g2).offen.length === 0 && R(g2).laufend.length === 0 && P.notrufBrettFaden(f2) && f2.phase === 'laeuft', 'nach dem Laden: R.offen und R.laufend sind leer (stehen nicht im Weltstand), der Faden laeuft weiter');
    kantenOeffnen(g2, o.hex);
    const funk = funkAb(g2);
    springe(g2, o.hex); lauf(g2, 3);
    ok(f2.nsc.gedaechtnis.some((x) => x.ereignis === 'notruf_gelungen') && f2.beat === 1 && katDank(MIT, o, funk).length === 0 && nscDank(funk).length === 0 && R(g2).laufend.length === 0 && (g2.space.enemies || []).length === 0, 'BEKANNTE LUECKE: Ankunft nach dem Laden beendet den Beat notruf gelungen (BEA-02 C: dann folgt die Rettung, vorher der Abschluss), ohne Katalog-Dank und ohne Kampf (der Eintrag fehlt)');
  });

  await section('R2 B2: Annehmen, die Frist laeuft ab (nicht rechtzeitig erreicht): der Faden endet gescheitert, auch bei spaeter Ankunft', () => {
    for (const e of [OHNE, MIT]) {
      const m = erzwingen(e), { g, o } = m;
      const a = angebotZu(g, o);
      Brett.annehmen(g, 'a' + a.nr);
      const f = faden(g, a);
      const funk = funkAb(g);
      lauf(g, W.takt_leben_s + 2);
      const ged = (f.nsc.gedaechtnis || []).map((x) => x.ereignis);
      ok(!R(g).offen.some((x) => x.marke === o.marke) && f.phase === 'abgeschlossen' && f.ausgang.art === 'gescheitert', e.id + ': nach dem Verfall ist der Faden abgeschlossen, Ausgang gescheitert (Phase ' + f.phase + ')');
      ok(ged.includes('notruf_gescheitert') && ged.includes('abschluss_gescheitert') && !ged.includes('notruf_gelungen') && !ged.includes('abschluss_gelungen'), e.id + ': Gedaechtnis ' + ged.join(','));
      ok(f.nsc.haltung <= 0 && f.nsc.status !== 'verbuendet', e.id + ': keine Haltung gedankt oder geholfen (Haltung ' + f.nsc.haltung + ', Status ' + f.nsc.status + ')');
      ok(P.abenteuerLaufend(Fz(g)) === 0, e.id + ': das Abenteuer zaehlt nicht mehr als laufend');
      g.space.enemies = [];
      springe(g, o.hex); lauf(g, 3);
      ok(f.ausgang.art === 'gescheitert' && !(f.nsc.gedaechtnis || []).some((x) => /gelungen/.test(x.ereignis)) && katDank(e, o, funk).length === 0 && nscDank(funk).length === 0 && R(g).laufend.length === 0 && (g.space.enemies || []).length === 0, e.id + ': spaete Ankunft: kein Dank, kein Kampf, der Faden bleibt gescheitert');
      ok(g.errors === 0, e.id + ': keine Fehler');
    }
  });

  await section('R2 B3: Gefahr-Notruf angenommen, die Crew springt vor oder waehrend des Kampfs weg: im Stich gelassen, Faden gescheitert', () => {
    for (const wann of ['vor dem Kampf (Vorlauf)', 'waehrend des Kampfs']) {
      const m = erzwingen(MIT), { g, o, hex } = m;
      const a = angebotZu(g, o);
      Brett.annehmen(g, 'a' + a.nr);
      const f = faden(g, a);
      const funk = funkAb(g);
      springe(g, o.hex); lauf(g, 1);
      ok(R(g).laufend.length === 1 && f.phase === 'wartet', wann + ': die Crew ist da, die Gefahr laeuft (' + R(g).laufend.map((x) => x.phase).join(',') + '), der Abschluss wartet');
      if (wann.startsWith('waehrend')) { for (let i = 0; i < MIT.parameter.vorlauf_s + 10 && !R(g).laufend.some((x) => x.phase === 'kampf'); i++) lauf(g, 1); ok(R(g).laufend.some((x) => x.phase === 'kampf') && (g.space.enemies || []).length > 0, 'der Kampf laeuft'); }
      springe(g, hex); lauf(g, 2);
      const ged = (f.nsc.gedaechtnis || []).map((x) => x.ereignis);
      ok(R(g).laufend.length === 0 && f.phase === 'abgeschlossen' && f.ausgang.art === 'gescheitert', wann + ': weggesprungen: der Faden ist abgeschlossen, Ausgang ' + (f.ausgang && f.ausgang.art));
      ok(ged.includes('abschluss_gescheitert') && !ged.includes('abschluss_gelungen') && !ged.includes('notruf_gelungen'), wann + ': Gedaechtnis ' + ged.join(','));
      ok(katDank(MIT, o, funk).length === 0 && nscDank(funk).length === 0 && zeilen(funk, txt('notruf_abschluss')).length === 0 && P.abenteuerLaufend(Fz(g)) === 0, wann + ': kein Dank, kein gelungener Abschlusstext, nicht mehr laufend');
      ok(g.errors === 0, wann + ': keine Fehler');
    }
    const m = erzwingen(MIT), { g, o } = m, a = angebotZu(g, o);
    Brett.annehmen(g, 'a' + a.nr); const f = faden(g, a);
    springe(g, o.hex); for (let i = 0; i < MIT.parameter.vorlauf_s + 10 && !R(g).laufend.some((x) => x.phase === 'kampf'); i++) lauf(g, 1);
    g.space.enemies = []; lauf(g, 3);
    ok(f.nsc.gedaechtnis.some((x) => x.ereignis === 'notruf_gelungen') && f.beat === 1 && f.phase !== 'abgeschlossen', 'Gegenprobe: Kampf bestanden = Beat notruf gelungen, der Faden geht zur Rettung weiter');   // BEA-02 C: vorher: Faden gelungen (der Plan hatte keine Rettung)
  });

  console.log(`\n${n - fails}/${n} Prüfungen bestanden.`);
  process.exit(fails ? 1 : 0);
})();
