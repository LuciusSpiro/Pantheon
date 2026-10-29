'use strict';
// SUND-04b B1: die Bausteine geruecht, spur und wiedersehen der Geschichtsfaeden (Freie Fahrt Sund, Schalter FAEDEN=1): drei Beats OHNE Kampfszene, alle speicherbar (der Faden SELBST ist der Zustand, nie ein
// eigener Laufzeitzustand; Vorbild faden-p3.js notruf). Action-Layer wie faden-p3.js. Zahlen und Texte stehen in content/faeden/b1-texte.json (kein Satz im Code), die Beats im Katalog (beats.json).
//
//   geruecht     (Beat „geruecht“) Das Hafenfunk nennt einen Sektor, in dem der NSC gesehen wurde (Hinweis-Kanal geruecht, Sprecher aus werte.json hinweis_sprecher). Der Sektor kommt vom Code: ein Sektor
//                ziel.min bis ziel.max Spruenge vom Sektor der Crew (kuerzester Weg ueber offene Sprungpunkte, nie ueber verborgene oder verschlossene Kanten), aus dem eigenen Strom der Faeden; er wird als
//                parameter.ort des Fadens gespeichert (der Ort der Geschichte wandert dorthin). Nennt die Vorlage den Sektor selbst (parameter hex), gilt er nur, wenn er erreichbar ist.
//                Gelungen, wenn das Schiff dort ankommt (update, Takt aus reise-ereignis), gescheitert, wenn die Frist des Beats ablaeuft (Faden-Takt) oder es keinen erreichbaren Sektor gibt (Beat endet sauber, Logbuch).
//   spur         (Beat „spur“) Eine Ionenspur ueber mehrere Sektoren (spur.js, SL5; Daten content/spuren/<id>.json, Parameter spur): Navigation fliegt die Spurkerne an, die Ops liest sie, die Spur enthuellt am Ende
//                eine verborgene Sprungboje. Gelungen, wenn die Spur zu Ende gelesen ist (spur.fertig), gescheitert, wenn die Frist ablaeuft oder die Spur ersetzt wurde. Ein falscher Ast (spur.falsch) ist KEIN
//                Ausgang: die Spur-Logik sagt „zurueck“, die Zeit laeuft; wer die Frist darauf verbringt, scheitert (anderer Text). Beim Scheitern wird die offene Spur samt Marke abgeraeumt. Nie Game Over, nie eine Szene.
//                Es laeuft hoechstens EINE Spur zugleich (game.spur): laeuft schon eine, ist der Beat gescheitert (Logbuch). Eine Spur, deren Kante schon offen ist, bringt keine zweite Belohnung (Beat gescheitert, Logbuch). Eine verwaiste Spur
//                unserer Daten (kein laufender Spur-Beat mehr, z. B. Faden beim Laden verworfen) raeumt der Takt samt Marke ab; fremde Spuren (Kampagne) nie.
//   wiedersehen  (Beat „wiedersehen“, braucht.nsc_alt) Ein NSC aus einem frueheren, abgeschlossenen Faden (Abenteuer geoeffnet mit parameter nsc_von, faden-pruefer.js) meldet sich und erinnert an eine konkrete Tat der Crew
//                (Daten werte.wiedersehen_erinnert: Gedaechtnis-Ereignis -> Text, der letzte passende Eintrag gewinnt) und nennt einen Treffpunkt (wie geruecht). Gelungen bei Ankunft, gescheitert bei Fristablauf.
//
//   update(game)  Takt (Aufrufer: reise-ereignis.update): Ankunft am Ort JEDES laufenden geruecht- und wiedersehen-Beats, Fortgang und Abraeumen der Spur-Beats.
//   katalogFehler() -> [Text]   die Daten dieser Bausteine sind in sich stimmig (Aufrufer: faden-bauplan.js katalogFehler, Test)
const Sektoren = require('../../shared/sektoren.js');
const D = require('./faden-daten.js');
const X = D.B1;
const T = X.texte, S = X.spuren, W = X.werte;
const HEX = /^\d{4}$/;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const Hinweis = () => require('./faden-hinweis.js');
const Faden = () => require('./faden.js');
const Bitte = () => require('./faden-bitte.js');
const Regie = () => require('./regie-befehle.js');
const Bausteine = () => require('./faden-bausteine.js');
const SpurMod = () => require('./spur.js');
const fmt = (t, v) => String(t == null ? '' : t).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m));
const hexName = (hex) => { try { return Sektoren.hexName(hex) || hex; } catch (e) { return hex; } };
const fehlerZaehlen = (game, wo, e) => { if (game && game.countError) game.countError(wo, e); };
const logbuch = (game, art, e) => { try { Regie().schreibe(game, Object.assign({ art }, e)); } catch (err) { fehlerZaehlen(game, 'faden-b1-logbuch', err); } };
const nscVon = (game, id) => Faden().nscVon(game, id);
const hierHex = (game) => (game && game.ship ? Sektoren.hexVonOrt(game.ship.scene) : null);
const sagen = (game, nsc, text) => (text && nsc ? Bitte().funkVon(game, nsc, text) : null);
const baustLog = (game, faden, beat, ausgang, begruendung, plan) => logbuch(game, 'faden_baustein', { ausgang, key: beat.baustein || (D.BEATS[beat.typ] || {}).baustein, begruendung, plan: Object.assign({ faden: faden.id, beat: beat.id }, plan || {}) });

// ---------- Wege der Karte: Spruenge ueber OFFENE Sprungpunkte (Explore: kanteOffen), nur spielbare Sektoren. -> Map Sektor -> Sprungzahl (hoechstens tiefe)
// Abgleich mit den echten Sprungregeln (sprung.js hexGrund): eine geschlossene Kante (verborgen, verschlossen, Sperrtext) zaehlt hier nie als Weg, genau wie dort. Eine OFFENE Kante, deren Boje die Crew noch nicht kennt
// (hexGrund: „Boje suchen (Weitscan)“), zaehlt als Weg: der Sektor darf genannt werden, die Boje findet die Crew beim Anflug (Weitscan, Sprungpunkt-Automatik markiert sie); die Zielwahl der Sprungregeln verlangt
// die Boje erst beim Springen, nicht beim Planen. Bewusst nicht an bojeBekannt gebunden: sonst waere ein Gerücht in unerkundeten Sektoren nie moeglich.
function erreichbar(game, von, tiefe) {
  const out = new Map();
  const ex = game && game.explore;
  if (!ex || typeof von !== 'string' || !HEX.test(von)) return out;
  out.set(von, 0);
  let rand = [von];
  for (let s = 1; s <= tiefe && rand.length; s++) {
    const next = [];
    for (const h of rand) {
      for (const e of Sektoren.kantenVon(h)) {
        const n = Sektoren.anderes(e, h);
        if (out.has(n) || !Sektoren.spielbar(n) || !ex.kanteOffen(Sektoren.kanteId(e.a, e.b))) continue;
        out.set(n, s); next.push(n);
      }
    }
    rand = next;
  }
  return out;
}
// Ein Sektor ziel.min bis ziel.max Spruenge entfernt (nie einer mit Sperrtext der Region), gewaehlt aus dem eigenen Strom der Faeden; null, wenn es keinen gibt
function zielWaehlen(game, faden, salz) {
  const r = erreichbar(game, hierHex(game), W.ziel.max);
  const k = Array.from(r).filter(([h, s]) => s >= W.ziel.min && s <= W.ziel.max && !Sektoren.sperrtext(h)).map(([h]) => h).sort();
  if (!k.length) return null;
  const z = Faden().strom(game, Faden().idNr(faden.id), salz)();
  return k[Math.floor(z * k.length) % k.length];
}
// Ort des Beats: parameter hex der Vorlage (muss erreichbar sein, mindestens einen Sprung weit: der Sektor der Crew selbst ist kein Ziel, sonst gelaenge der Beat ohne Flug), sonst ein vom Code gewaehlter Sektor
// (wird parameter.ort des Fadens). -> Hex | null
function ortFuer(game, faden, beat, salz) {
  const p = beat.parameter || {};
  if (has(p, 'hex')) {
    return typeof p.hex === 'string' && HEX.test(p.hex) && erreichbar(game, hierHex(game), W.ziel.erreichbar_max).get(p.hex) >= 1 ? p.hex : null;
  }
  const z = zielWaehlen(game, faden, salz);
  if (z) faden.parameter.ort = z;
  return z;
}

// ---------- geruecht
const geruecht = {
  id: 'geruecht',
  starten(game, faden, ctx) {
    const nsc = nscVon(game, faden.nsc.id) || faden.nsc;
    const hex = ortFuer(game, faden, ctx.beat, 'geruecht:' + ctx.beat.id);
    if (!hex) { baustLog(game, faden, ctx.beat, 'abgelehnt', 'Gerücht ohne erreichbaren Sektor: der Beat gilt als gescheitert', { hex: null }); return { ausgang: 'gescheitert' }; }
    const tk = ctx.beat.parameter && ctx.beat.parameter.text_key;
    const key = typeof tk === 'string' && has(T, tk) ? tk : 'geruecht_standard';
    const sprecher = has(D.WERTE.hinweis_sprecher, 'geruecht') ? D.WERTE.hinweis_sprecher.geruecht : null;
    const text = fmt(T[key], { name: nsc.name, ort: hexName(hex) });
    const f = sprecher ? Bitte().funkSprecher(game, sprecher, text) : Bitte().funkVon(game, nsc, text);
    if (!f) return { ausgang: 'gescheitert' };
    for (const h of ctx.beat.hinweise || []) Hinweis().senden(game, faden.id, h);
    baustLog(game, faden, ctx.beat, 'geruecht', `Gerücht über ${nsc.name} bei ${hexName(hex)}`, { hex, text: key });
    return { laeuft: true };
  },
};

// ---------- wiedersehen
// Die konkrete Tat: der letzte Eintrag des Gedaechtnisses mit einem Text aus wiedersehen_erinnert gewinnt (Daten); ohne einen gibt es den Standardtext (der Pruefer laesst so einen NSC nicht zu)
function wiedersehenText(nsc) {
  let key = 'wiedersehen_standard';
  for (const g of (nsc && nsc.gedaechtnis) || []) { if (g && typeof g.ereignis === 'string' && has(W.wiedersehen_erinnert, g.ereignis) && has(T, W.wiedersehen_erinnert[g.ereignis])) key = W.wiedersehen_erinnert[g.ereignis]; }
  return key;
}
const wiedersehen = {
  id: 'wiedersehen',
  starten(game, faden, ctx) {
    const nsc = nscVon(game, faden.nsc.id) || faden.nsc;
    const hex = ortFuer(game, faden, ctx.beat, 'wiedersehen:' + ctx.beat.id);
    if (!hex) { baustLog(game, faden, ctx.beat, 'abgelehnt', 'Wiedersehen ohne erreichbaren Treffpunkt: der Beat gilt als gescheitert', { hex: null }); return { ausgang: 'gescheitert' }; }
    const key = wiedersehenText(nsc);
    const f = sagen(game, nsc, fmt(T[key], { name: nsc.name, ort: hexName(hex) }));
    if (!f) return { ausgang: 'gescheitert' };
    baustLog(game, faden, ctx.beat, 'wiedersehen', `${nsc.name} meldet sich wieder, Treffpunkt ${hexName(hex)}`, { hex, text: key });
    return { laeuft: true };
  },
};

// ---------- spur
// Die Kante(n), die die Spur am Ende enthuellt (Schluessel d.ende.kante der Karte), sind schon offen: die Spur ist abgeschlossen (eine zweite Spur zur selben Boje, oder dieselbe noch einmal)
function spurAbgeschlossen(game, d) {
  const ex = game && game.explore;
  const kanten = ((Sektoren.KARTE && Sektoren.KARTE.kanten) || []).filter((e) => e.key === d.ende.kante);
  return !!ex && kanten.length > 0 && kanten.every((e) => ex.kanteOffen(Sektoren.kanteId(e.a, e.b)));
}
// Eine Spur unserer Daten (b1-texte.json spuren), die kein laufender Spur-Beat mehr traegt (Faden beim Laden verworfen, Beat geendet): verwaist. Fremde Spuren (Kampagne: bote) nie. ausser = der Faden, der gerade startet.
function spurVerwaist(game, F, ausser) {
  const s = game && game.spur;
  return !!(s && !s.fertig && has(S, s.id) && !F.liste.some((x) => x !== ausser && spurLaeuft(x) === s.id));
}
function spurAbraeumen(game, id) { SpurMod().reset(game); require('./marken.js').entferne(game, 'spur:' + id); }
const spur = {
  id: 'spur',
  starten(game, faden, ctx) {
    const nsc = nscVon(game, faden.nsc.id) || faden.nsc;
    const p = ctx.beat.parameter || {};
    const id = has(p, 'spur') && typeof p.spur === 'string' ? p.spur : null;
    const ab = (grund) => { baustLog(game, faden, ctx.beat, 'abgelehnt', 'Spur: ' + grund + ': der Beat gilt als gescheitert', { spur: id && has(S, id) ? id : null }); return { ausgang: 'gescheitert' }; };
    if (!id || !has(S, id)) return ab('unbekannte Spur');
    const d = SpurMod().datei(id);
    if (!d) return ab('die Spur gibt es nicht (content/spuren)');
    if (spurAbgeschlossen(game, d)) return ab('die Spur ist schon abgeschlossen: ihre Kante ist offen, es gibt nichts mehr zu enthüllen');
    if (spurVerwaist(game, Faden().zustandVon(game), faden)) spurAbraeumen(game, game.spur.id);   // eine liegen gebliebene Spur von uns (Faden beim Laden verworfen) blockiert keinen neuen Beat
    if (game.spur && !game.spur.fertig) return ab('es läuft schon eine andere Spur');
    if (!erreichbar(game, hierHex(game), W.ziel.erreichbar_max).has(d.weg[0])) return ab('der Anfang der Spur ist nicht erreichbar');
    const err = SpurMod().starten(game, id);
    if (err) return ab(err.slice(0, 80));
    if (!sagen(game, nsc, fmt(S[id].start, { name: nsc.name, ort: hexName(d.weg[0]) }))) { spurAbraeumen(game, id); return { ausgang: 'gescheitert' }; }   // ohne Funk kein Beat: die gestartete Spur bleibt nicht ohne Beat liegen
    for (const h of ctx.beat.hinweise || []) Hinweis().senden(game, faden.id, h);
    baustLog(game, faden, ctx.beat, 'spur', `Spur ${id} beginnt in ${hexName(d.weg[0])}`, { spur: id });
    return { laeuft: true };
  },
};

// ---------- Takt
const BAUSTEINE = { geruecht, wiedersehen, spur };
function laufenderBaustein(f) {   // Baustein-Id des laufenden Beats eines Fadens (nur der echte Baustein, ein Platzhalter der Tests tut nichts) und der Beat; sonst null
  if (!f || f.phase !== 'laeuft' || !f.laufend) return null;
  const v = D.vorlage(f.vorlage), beat = v && v.beats[f.beat];
  if (!beat || beat.id !== f.laufend.beat || !has(D.BEATS, beat.typ)) return null;
  const id = D.BEATS[beat.typ].baustein;
  if (!has(BAUSTEINE, id) || Bausteine().vonId(id) !== BAUSTEINE[id]) return null;
  return { id, beat };
}
function ankunftOrt(f) {   // Ort eines laufenden geruecht- oder wiedersehen-Beats (Beat-Parameter hex, sonst der Ort des Fadens)
  const l = laufenderBaustein(f);
  if (!l || l.id === 'spur') return null;
  const p = l.beat.parameter || {};
  const hex = typeof p.hex === 'string' && HEX.test(p.hex) ? p.hex : (f.parameter && f.parameter.ort);
  return hex && HEX.test(hex) ? { hex, baustein: l.id } : null;
}
function spurLaeuft(f) {   // Id der Spur eines laufenden spur-Beats
  const l = laufenderBaustein(f);
  if (!l || l.id !== 'spur') return null;
  const id = l.beat.parameter && l.beat.parameter.spur;
  return typeof id === 'string' && has(S, id) ? id : null;
}
const SPUREN = new WeakMap();   // Laufzeit je Spiel: Faden -> Spur-Id, damit eine nach Fristablauf liegen gebliebene Spur abgeraeumt wird (nach dem Laden entsteht der Eintrag aus dem Faden neu)
function spurTakt(game, F) {
  let reg = SPUREN.get(game);
  if (!reg) SPUREN.set(game, reg = new Map());
  for (const f of F.liste.slice()) {
    const id = spurLaeuft(f);
    if (!id) continue;
    reg.set(f.id, id);
    const s = game.spur, nsc = nscVon(game, f.nsc.id) || f.nsc;
    if (s && s.id === id && s.fertig) { sagen(game, nsc, fmt(S[id].gelungen, { name: nsc.name })); Faden().beatAusgang(game, f.id, 'gelungen'); }
    else if (!s || s.id !== id) { sagen(game, nsc, fmt(S[id].verloren, { name: nsc.name })); Faden().beatAusgang(game, f.id, 'gescheitert'); }   // die Spur wurde ersetzt oder ist weg
  }
  for (const [fid, id] of Array.from(reg)) {
    const f = F.liste.find((x) => x.id === fid);
    if (f && spurLaeuft(f) === id) continue;
    reg.delete(fid);   // der Beat ist zu Ende (Ausgang oder Frist): eine offene Spur dieses Fadens wird abgeraeumt
    const s = game.spur;
    if (!s || s.id !== id || s.fertig) continue;
    if (f) { const nsc = nscVon(game, f.nsc.id) || f.nsc; sagen(game, nsc, fmt(s.falsch ? S[id].verloren_falsch : S[id].verloren, { name: nsc.name })); }
    spurAbraeumen(game, id);
  }
  if (spurVerwaist(game, F, null)) spurAbraeumen(game, game.spur.id);   // nach dem Laden ohne zugehoerigen Faden (verworfen): nur eine Spur unserer Daten, nie eine fremde
}
function update(game) {
  if (!game || !game.ship || !Faden().aktiv(game)) return;
  const F = Faden().zustandVon(game);
  const hier = hierHex(game);
  if (hier) {
    for (const f of F.liste.slice()) {
      const a = ankunftOrt(f);
      if (!a || a.hex !== hier) continue;
      const nsc = nscVon(game, f.nsc.id) || f.nsc;
      sagen(game, nsc, T[a.baustein === 'geruecht' ? 'geruecht_gefunden' : 'wiedersehen_dank']);
      Faden().beatAusgang(game, f.id, 'gelungen');
    }
  }
  spurTakt(game, F);
}

// ---------- Daten
function katalogFehler() {
  const out = [];
  const g = (t) => out.push('B1: ' + t);
  const ok = (t) => typeof t === 'string' && t.trim().length >= 8 && !(t.match(/\{[^}]*\}/g) || []).some((p) => p !== '{name}' && p !== '{ort}');
  for (const [k, t] of Object.entries(T)) if (!ok(t)) g(`Text ${k}: fehlt, zu kurz oder mit einem anderen Platzhalter als {name} und {ort}`);
  for (const k of ['geruecht_standard', 'geruecht_gefunden', 'wiedersehen_standard', 'wiedersehen_dank']) if (!has(T, k)) g(`Text ${k} fehlt`);
  const z = W.ziel;
  if (!(z && Number.isInteger(z.min) && Number.isInteger(z.max) && Number.isInteger(z.erreichbar_max) && z.min >= 1 && z.min <= z.max && z.max <= z.erreichbar_max)) g('werte.ziel: min, max, erreichbar_max brauchen 1 <= min <= max <= erreichbar_max');
  for (const [ev, k] of Object.entries(W.wiedersehen_erinnert)) {
    if (!/^[a-z_]{1,40}$/.test(ev)) g(`wiedersehen_erinnert: Ereignis ${ev} passt nicht zum Gedächtnis`);
    if (!has(T, k)) g(`wiedersehen_erinnert: Text ${k} fehlt in texte`);
  }
  // SUND-04b E2: jede Tat gibt es mit BEIDEN Ausgaengen und verschiedenem Text (der NSC spricht nach einem Scheitern nie von einem Erfolg)
  for (const [ev, k] of Object.entries(W.wiedersehen_erinnert)) {
    const m = /^(.+)_(gelungen|gescheitert)$/.exec(ev);
    if (!m) { g(`WIEDERSEHEN_PAAR: Ereignis ${ev} endet nicht auf _gelungen oder _gescheitert`); continue; }
    const gegen = m[1] + '_' + (m[2] === 'gelungen' ? 'gescheitert' : 'gelungen');
    if (!has(W.wiedersehen_erinnert, gegen)) g(`WIEDERSEHEN_PAAR: ${ev} hat keinen Gegenpart ${gegen}`);
    else if (W.wiedersehen_erinnert[gegen] === k || (has(T, k) && T[k] === T[W.wiedersehen_erinnert[gegen]])) g(`WIEDERSEHEN_PAAR: ${ev} und ${gegen} brauchen verschiedene Texte`);
  }
  for (const [typ, cat] of Object.entries(D.BEATS)) {
    const erl = (cat.bauplan && cat.bauplan.parameter) || {};
    if (cat.baustein === 'geruecht' && erl.text_key && Array.isArray(erl.text_key.erlaubt)) for (const k of erl.text_key.erlaubt) if (!has(T, k)) g(`Beat ${typ}: text_key ${k} steht nicht in b1-texte.json texte`);
    if (cat.baustein === 'spur') {
      const l = erl.spur && erl.spur.erlaubt;
      if (!Array.isArray(l) || !l.length) g(`Beat ${typ}: bauplan.parameter.spur.erlaubt fehlt`);
      else for (const id of l) {
        if (!has(S, id)) { g(`Beat ${typ}: Spur ${id} steht nicht in b1-texte.json spuren`); continue; }
        let d = null;
        try { d = SpurMod().datei(id); } catch (e) { d = null; }
        if (!d) g(`Spur ${id}: content/spuren/${id}.json fehlt oder ist ungültig`);
      }
    }
  }
  for (const [id, s] of Object.entries(S)) for (const k of ['start', 'gelungen', 'verloren', 'verloren_falsch']) if (!ok(s && s[k])) g(`spuren.${id}.${k}: fehlt, zu kurz oder mit unerlaubtem Platzhalter`);
  return out;
}

module.exports = { geruecht, spur, wiedersehen, update, katalogFehler, erreichbar, zielWaehlen, wiedersehenText, ankunftOrt, spurLaeuft };
