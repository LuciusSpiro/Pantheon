'use strict';
// SUND-04b B2: der Baustein sabotage der Geschichtsfaeden (Freie Fahrt Sund, Schalter FAEDEN=1): ein Beat OHNE eigene Szene und ohne eigenen Angriff der Sim, speicherbar (der Faden SELBST ist der Zustand: das Ziel
// steht in faden.parameter.ort, der Beginn in laufend.seit, die Pause im Block welt.sim.faeden.sabotage). Action-Layer wie faden-b1.js. Zahlen und Texte stehen in content/faeden/b2-texte.json (kein Satz im Code),
// der Beat im Katalog (beats.json). Die Szenen konvoi und geleit stehen in faden-szene-b2.js.
//
//   sabotage  (Beat „sabotage“) Der Beat nennt ein Ziel: einen germanischen Posten auf einem Quell-Hex der Sim (Hex mit Quelle, Besitzer aus werte.sabotage.quell_besitzer, der die Versorgung liefert), erreichbar ueber offene Sprungpunkte,
//             nicht in der Ruf-Sperre der Sim (Posten.sprengungGesperrt), und die Crew darf angreifen (Rang posten-werte.json mindestrang.angreifen). Dann WARTET der Beat: die Sprengung macht die Crew in der Sim-Szene „Posten
//             angreifen“ (SUND-02b A2, kriegslage-szene.js, Wirkung posten_gesprengt); werte.json folge_typen bleibt unveraendert. Gelungen, wenn die Sim das Ereignis posten_verloren (durch rom) am Ziel meldet; gescheitert, wenn der
//             Posten ohne die Crew verschwindet (Ziel weg) oder die Frist des Beats ablaeuft (beats.json frist, Taetigkeiten; Faden-Takt). Fehlt das Ziel schon beim Beginn (oder liegt die Pause noch), scheitert der Beat SOFORT und
//             aendert den Faden (der Weg des Plans), nie ein Spiel-Ende. Der Beat baut keinen zusaetzlichen Angriff der Sim: die Weltfolge (der Hex wird haeufiger neu besetzt) kommt von der Sim selbst.
//   lage      Lagen-Bedingungen der Beats (beats.json braucht.lage): sabotage_ziel. Der Pruefer (faden-pruefer.js pruefeLage) fragt sie beim Anbieten und Oeffnen eines Abenteuers; der Kontext der Komposition nennt nur die Zahl.
//
//   update(game)       Takt (Aufrufer: reise-ereignis.update): Erfolg oder Verlust des Ziels jedes laufenden sabotage-Beats
//   lage(key)          -> { zahl(game), fehler(game) -> null | 'CODE: Text' }
//   katalogFehler() -> [Text]   die Daten dieses Bausteins sind in sich stimmig (Aufrufer: faden-bauplan.js katalogFehler, Test)
const Sektoren = require('../../shared/sektoren.js');
const D = require('./faden-daten.js');
const X = D.B2;
const T = X.texte, W = X.werte.sabotage;
const HEX = /^\d{4}$/;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const Faden = () => require('./faden.js');
const Bitte = () => require('./faden-bitte.js');
const Regie = () => require('./regie-befehle.js');
const Bausteine = () => require('./faden-bausteine.js');
const B1 = () => require('./faden-b1.js');
const Posten = () => require('./posten.js');
const Ruf = () => require('./ruf.js');
const WeltDaten = () => require('../weltsim/daten.js');
const fmt = (t, v) => String(t == null ? '' : t).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m));
const hexName = (hex) => { try { return Sektoren.hexName(hex) || hex; } catch (e) { return hex; } };
const logbuch = (game, art, e) => { try { Regie().schreibe(game, Object.assign({ art }, e)); } catch (err) { if (game && game.countError) game.countError('faden-b2-logbuch', err); } };
const baustLog = (game, faden, beat, ausgang, begruendung, plan) => logbuch(game, 'faden_baustein', { ausgang, key: beat.baustein || (D.BEATS[beat.typ] || {}).baustein, begruendung, plan: Object.assign({ faden: faden.id, beat: beat.id }, plan || {}) });
const nscVon = (game, id) => Faden().nscVon(game, id);
const sagen = (game, nsc, text) => (text && nsc ? Bitte().funkVon(game, nsc, text) : null);
const hierHex = (game) => (game && game.ship ? Sektoren.hexVonOrt(game.ship.scene) : null);
const sim = (game) => (game && game.weltsim && game.weltsim.zustand ? game.weltsim : null);

// ---------- Lage: Ziele
// Ein germanischer Posten auf einem Quell-Hex, den die Crew jetzt angreifen darf und erreicht. -> [{ hex, spruenge }] (nach Spruengen, dann Hex)
function ziele(game) {
  const ws = sim(game);
  if (!ws || !game.ship || !game.explore) return [];
  const z = ws.zustand, d = WeltDaten().datenVon(z);
  const erreicht = B1().erreichbar(game, hierHex(game), W.erreichbar_max);
  const out = [];
  for (const [hex, spr] of erreicht) {
    const nd = z.hexe[hex], h = d.hex[hex];
    if (!nd || !h || !nd.posten || nd.crew === true || !W.quell_besitzer.includes(nd.besitzer)) continue;
    if (!(Array.isArray(h.quellen) && h.quellen.length) || h.hafen) continue;   // nur ein Versorgungsposten: Quelle da, kein Hafen
    if (Posten().sprengungGesperrt(game, hex)) continue;   // Ruf-Sperre je Hex der Sim (der Sperrtext der Region zaehlt hier nicht: er erklaert nur geschlossene Sprungpunkte, erreichbar() folgt nur offenen)
    out.push({ hex, spruenge: spr });
  }
  return out.sort((a, b) => a.spruenge - b.spruenge || (a.hex < b.hex ? -1 : 1));
}
// Die Crew darf angreifen (Rang): ohne ihn ist kein Ziel ein Ziel
const darfAngreifen = (game) => { try { return !!Ruf().rufErreicht(game, require('../../content/welt/posten-werte.json').werte.mindestrang.wert.angreifen); } catch (e) { return false; } };
// Pause ueber alle Sabotage-Auftraege (Sitzung/Abend): der Stand haelt den Sim-Tick des letzten Beginns
function pauseNoch(game) {
  const ws = sim(game), F = ws && ws.faeden, s = F && F.sabotage;
  return !!(s && Number.isFinite(s.t) && ws.tickZahl - s.t < W.pause_ticks);
}
const LAGEN = {
  sabotage_ziel: {
    zahl(game) { return pauseNoch(game) || !darfAngreifen(game) ? 0 : ziele(game).length; },
    fehler(game) {
      if (pauseNoch(game)) return 'SABOTAGE_PAUSE: ein Sabotage-Auftrag lief erst vor Kurzem (hoechstens einer je ' + W.pause_ticks + ' Ticks der Sim)';
      if (!darfAngreifen(game)) return 'LAGE_ZIEL_FEHLT: die Crew darf noch keinen Posten angreifen (Rang)';
      if (!ziele(game).length) return 'LAGE_ZIEL_FEHLT: im Moment steht kein germanischer Versorgungsposten in Reichweite, den die Crew sprengen koennte';
      return null;
    },
  },
};
const lage = (key) => (has(LAGEN, key) ? LAGEN[key] : null);

// ---------- sabotage
const sabotage = {
  id: 'sabotage',
  starten(game, faden, ctx) {
    const nsc = nscVon(game, faden.nsc.id) || faden.nsc;
    const ab = (grund, key) => { baustLog(game, faden, ctx.beat, 'abgelehnt', 'Sabotage: ' + grund + ': der Beat gilt als gescheitert', { hex: null }); sagen(game, nsc, T[key]); return { ausgang: 'gescheitert' }; };
    if (pauseNoch(game)) return ab('Pause nach dem letzten Sabotage-Auftrag', 'sabotage_pause');
    const z = darfAngreifen(game) ? ziele(game) : [];
    if (!z.length) return ab('kein Ziel', 'sabotage_kein_ziel');
    const r = Faden().strom(game, Faden().idNr(faden.id), 'sabotage:' + ctx.beat.id)();
    const hex = z[Math.floor(r * z.length) % z.length].hex;
    if (!sagen(game, nsc, fmt(T.sabotage_start, { name: nsc.name, ort: hexName(hex) }))) return { ausgang: 'gescheitert' };   // ohne Funk kein Beat
    faden.parameter.ort = hex;   // der Ort der Geschichte wandert zum Ziel (wie beim Geruecht)
    const F = Faden().zustandVon(game), ws = sim(game);
    F.sabotage = { t: ws.tickZahl, n: Math.min(1000000, ((F.sabotage && F.sabotage.n) || 0) + 1) };
    baustLog(game, faden, ctx.beat, 'sabotage', `Sabotage-Auftrag: Posten bei ${hexName(hex)}`, { hex });
    return { laeuft: true };
  },
};

// ---------- Takt
function laufend(f) {   // der laufende Beat eines Fadens, wenn er ein echter sabotage-Beat ist (ein Platzhalter der Tests tut nichts), sonst null
  if (!f || f.phase !== 'laeuft' || !f.laufend) return null;
  const v = D.vorlage(f.vorlage), beat = v && v.beats[f.beat];
  if (!beat || beat.id !== f.laufend.beat || !has(D.BEATS, beat.typ) || D.BEATS[beat.typ].baustein !== 'sabotage') return null;
  return Bausteine().vonId('sabotage') === sabotage ? beat : null;
}
// Hat die Sim den Posten am Ziel an Rom verloren, seit der Beat laeuft? Ereignis posten_verloren (durch rom) im Ring, nach dem Laden (der Ring ist nicht gespeichert) die Sprengung der Crew im Stand
function verloren(ws, hex, seit) {
  if ((ws.ereignisse || []).some((e) => e && e.typ === 'posten_verloren' && e.ort === hex && e.durch === 'rom' && e.n > seit)) return true;
  const sp = ws.sprengungen && ws.sprengungen[hex];
  return Number.isFinite(sp) && sp > seit;
}
function update(game) {
  if (!game || !game.ship || !Faden().aktiv(game)) return;
  const ws = sim(game);
  if (!ws) return;
  const F = Faden().zustandVon(game);
  for (const f of F.liste.slice()) {
    if (!laufend(f)) continue;
    const hex = f.parameter && f.parameter.ort;
    if (!hex || !HEX.test(hex)) { Faden().beatAusgang(game, f.id, 'gescheitert'); continue; }
    const nsc = nscVon(game, f.nsc.id) || f.nsc;
    if (verloren(ws, hex, f.laufend.seit)) { sagen(game, nsc, fmt(T.sabotage_gelungen, { name: nsc.name, ort: hexName(hex) })); Faden().beatAusgang(game, f.id, 'gelungen'); continue; }
    const nd = ws.zustand.hexe[hex];
    if (!(nd && nd.posten && W.quell_besitzer.includes(nd.besitzer))) { sagen(game, nsc, fmt(T.sabotage_ziel_weg, { name: nsc.name, ort: hexName(hex) })); Faden().beatAusgang(game, f.id, 'gescheitert'); }   // der Posten ist ohne die Crew verschwunden (Piraten, Konkordat)
  }
}

// ---------- Weltstand: der Block welt.sim.faeden.sabotage { t, n } (optional, additiv)
const toSave = (F) => (F && F.sabotage ? { t: F.sabotage.t, n: F.sabotage.n } : null);
function lesen(x) {   // muellfest: nur ganze Zahlen im Bereich, sonst keine Pause
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const t = x.t, n = x.n;
  return Number.isInteger(t) && t >= 0 && Number.isInteger(n) && n >= 1 && n <= 1000000 ? { t, n } : null;
}

// ---------- Daten
function katalogFehler() {
  const out = [];
  const g = (t) => out.push('B2: ' + t);
  const ok = (t) => typeof t === 'string' && t.trim().length >= 8 && !(t.match(/\{[^}]*\}/g) || []).some((p) => p !== '{name}' && p !== '{ort}');
  for (const [k, t] of Object.entries(T)) if (!ok(t)) g(`Text ${k}: fehlt, zu kurz oder mit einem anderen Platzhalter als {name} und {ort}`);
  for (const k of ['sabotage_start', 'sabotage_gelungen', 'sabotage_ziel_weg', 'sabotage_kein_ziel', 'sabotage_pause']) if (!has(T, k)) g(`Text ${k} fehlt`);
  if (!(W && Number.isInteger(W.erreichbar_max) && W.erreichbar_max >= 1 && Number.isInteger(W.pause_ticks) && W.pause_ticks >= 1)) g('werte.sabotage: erreichbar_max und pause_ticks brauchen ganze Zahlen ab 1');
  if (!(W && Array.isArray(W.quell_besitzer) && W.quell_besitzer.length && W.quell_besitzer.every((b) => typeof b === 'string' && b.length))) g('werte.sabotage.quell_besitzer braucht mindestens einen Besitzer');
  for (const [typ, cat] of Object.entries(D.BEATS)) {
    const br = cat.braucht || {};
    if (br.lage !== undefined && !(typeof br.lage === 'string' && has(LAGEN, br.lage))) g(`Beat ${typ}: braucht.lage "${String(br.lage).slice(0, 30)}" ist keine Lagen-Bedingung (${Object.keys(LAGEN).join(', ')})`);
    if (cat.frist !== undefined && !(Number.isInteger(cat.frist) && cat.frist >= 1 && cat.frist <= 60)) g(`Beat ${typ}: frist ist keine ganze Zahl von 1 bis 60`);
  }
  const sz = require('../../content/faeden/szenen-werte.json').werte;
  const K = sz.konvoi && sz.konvoi.wert, G = sz.geleit && sz.geleit.wert;
  const alleCrew = (m) => !!m && ['1', '2', '3'].every((k) => Number.isInteger(m[k]) && m[k] >= 1);
  if (!(K && alleCrew(K.anzahl) && Array.isArray(K.siegen) && K.siegen.includes(K.sieg_standard) && K.siegen.every((s) => require('./konvoi.js').SIEGE.includes(s)) && K.max_s > 0)) g('szenen-werte konvoi: anzahl je Crew, siegen, sieg_standard, max_s');
  if (K && K.eskorte && !['1', '2', '3'].every((k) => require('./konvoi.js').ESKORTEN.includes(K.eskorte[k]))) g('szenen-werte konvoi: eskorte je Crew nennt eine unbekannte Eskorte');
  if (K && !require('../../shared/config.js').fracht.arten.includes(K.ladung)) g('szenen-werte konvoi: ladung ist keine Ladungsart');
  if (!(G && G.modi && has(G.modi, G.modus_standard) && Array.isArray(G.ziele) && G.ziele.length && G.max_s > 0 && G.angreifer && G.angreifer.klasse)) g('szenen-werte geleit: modi, modus_standard, ziele, angreifer, max_s');
  else for (const [m, M] of Object.entries(G.modi)) {
    if (!['angekommen', 'angreifer_weg', 'repariert'].includes(M.erfolg)) g(`geleit.modi.${m}: erfolg unbekannt`);
    if (!require('./escort.js').KINDS.includes(M.kind) || !require('./escort.js').VERHALTEN.includes(M.verhalten)) g(`geleit.modi.${m}: kind oder verhalten unbekannt`);
    if (!alleCrew(M.angreifer)) g(`geleit.modi.${m}: angreifer je Crew (1 bis 3) mit mindestens 1`);
    if ((M.erfolg === 'angekommen') !== (M.verhalten === 'folgt_kurs')) g(`geleit.modi.${m}: nur ein fahrender Schuetzling kommt an, nur ein treibender wird verteidigt oder geflickt`);
    if ((M.erfolg === 'repariert') !== (M.reparatur_s > 0)) g(`geleit.modi.${m}: reparatur_s gehoert genau zum Modus mit Erfolg repariert`);
  }
  const szT = require('../../content/faeden/szenen-werte.json').texte;
  for (const a of require('./faden-szene-b2.js').ARTEN) for (const typ of Object.keys(D.BEATS)) if (D.BEATS[typ].baustein === a) {
    const bp = (D.BEATS[typ].bauplan || {}).parameter || {};
    const schluessel = a === 'konvoi' ? ['konvoi', 'konvoi_pluendern'] : G ? Object.keys(G.modi) : [];
    for (const k of schluessel) for (const bl of ['vorwarnung', 'gelungen', 'gescheitert']) if (!(szT[bl] && typeof szT[bl][k] === 'string' && szT[bl][k].length >= 8)) g(`szenen-werte texte.${bl}.${k} fehlt`);
    const erl = a === 'konvoi' ? bp.sieg : bp.modus;
    if (!erl || !Array.isArray(erl.erlaubt) || !erl.erlaubt.length) g(`Beat ${typ}: bauplan.parameter.${a === 'konvoi' ? 'sieg' : 'modus'}.erlaubt fehlt`);
    else for (const w of erl.erlaubt) if (a === 'konvoi' ? !(K && K.siegen.includes(w)) : !(G && has(G.modi, w))) g(`Beat ${typ}: erlaubter Wert ${w} steht nicht in szenen-werte.json`);
  }
  return out;
}

module.exports = { sabotage, update, lage, ziele, pauseNoch, toSave, lesen, katalogFehler, laufend, LAGEN };
