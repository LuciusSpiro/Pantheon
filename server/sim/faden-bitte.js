'use strict';
// SUND-04a-2 P2: Bitten der Geschichtsfaeden (Freie Fahrt Sund, game.weltsim.faeden). Action-Layer wie faden.js und funk-antwort.js. Ein NSC bittet die Crew um Hilfe: der Beat der Art `bitte`
// (content/faeden/beats.json) hat seine Optionen MIT Folge in der Vorlage (Datei); das Modell waehlt nur, ob und wann der Beat laeuft (faden_weiter), nie Text, Optionen oder Folgen.
// Die Anzeige ist die Antwortleiste der Funk-Antworten (public/js/funkwahl.js, gemeinsame Anzeige), eigener Block world.bitte. Zahlen und Texte: content/faeden/bitte-werte.json.
//
// Regeln: keine Scheinwahl (der Pruefer des Fadenkerns, optionenFehler: unterschiedliche Folgen, hoechstens eine folgenlose Option), nie bei Gefahr (Beat ohne gefahr, und nie in unruhiger Lage),
// Ablehnen kostet nur die dokumentierte Haltung (Daten), „Später“ ist nur das Zuklappen der Leiste fuer diesen Spieler (kein Befehl, kein Folgen), Verfall nach frist_taetigkeiten (faden.t, nie Sprünge)
// als Ausgang „gescheitert“ des Beats (der Faden verändert sich, endet nicht), höchstens EIN Angebot gleichzeitig (die Crew, nicht der Spieler), die ERSTE Antwort gilt.
// Der Bitten-Deckel (bitte-werte.json ruf_deckel je fenster_taetigkeiten) ist eigener Deckel: getrennt vom Rom-Ruf-Deckel der Funk-Antworten und vom Reise-Ruf-Deckel. Passt eine Ruf-Folge nicht,
// entfaellt die Option; bleiben weniger als zwei, gibt es kein Angebot (keine Scheinwahl). Folgen laufen über faden.optionWaehlen (Kriegslage.rufBuchen, haltungBuchen).
//
// Zustand: game.weltsim.faeden.bitte = { nr, fadenId, beatId, von, volk, pid, text, optionen: [{ id, text, folge }], bis (Stand von faden.t) } | null; .bitteZuletzt = { nr } (Antwort gilt, Laufzeit);
//   .bitteLog = [[t, betrag]] (Bitten-Deckel, Laufzeit); .bitteNr (laufende Nummer). Gespeichert wird nur das offene Angebot (welt.sim.faeden.bitte), Folgen stehen in der Vorlage.
// Schalter: wie faden.js (FAEDEN=1). Ohne Schalter tut kein Hook etwas.
//
//   baustein                                       der Baustein `bitte` (faden-bausteine.js registriert ihn): starten() bietet die Bitte an, Text aus beat.parameter.text_key
//   anbieten(game, { fadenId, beatId, absender: { name, fraktion, portrait }, text, optionen: [{ id, text, folge }] }) -> { ok, code, bitte?, fehler? }
//       code (bei ok false): aus | kein_faden | kein_beat | schon_offen | funk_offen | gefahr | unruhig | text | absender | optionen | deckel
//   angebotAusVorlage(game, fadenId) -> { ok, code, bitte? }    Text und Optionen aus der Vorlage des laufenden Beats (Baustein und Wiederholung)
//   beantworten(game, id, nr?) -> null | { code, text }         Befehl faden.bitte { id, nr }: die ERSTE Antwort gilt; id = Option-Id (Später ist nur lokal)
//   nachTaetigkeit(game)                                        (Aufrufer: faden.taetigkeit, am Ende) Verfall, verwaiste Angebote, Wiederholung
//   update(game)                                                (Aufrufer: reise-ereignis.update) Angebot in unruhiger Lage zurueckziehen (ohne Folge)
//   funkVon(game, nsc, text) -> { von, pid, text } | null       Funkzeile eines NSC mit Porträt (pid), Aufrufer: Bitten, Szenen, Bausteine (P1/P3)
//   portraetPid(npc) -> 'f:<variante>:<fraktion>' | null ; pidGueltig(pid) -> bool     Porträt-Kennung (Client prüft dieselbe Form)
//   offen(game) -> Angebot | null ; snapshot(game) / schluessel(game)   Anzeigeblock world.bitte { nr, von, pid, text, optionen: [{ id, text }], kopf, spaeter, rest } | null (Löschsignal)
//   toSaveBitte(F) -> Block | null ; lesenBitte(block, F) -> Angebot | null   Weltstand (müllfest, Folgen aus der Vorlage)
//   weigerung(code) -> { code, text }
const D = require('./faden-daten.js');
const P = require('./faden-pruefer.js');

const BW = D.BITTE, W = D.WERTE, B = D.BEATS;
const Faden = () => require('./faden.js');
const FA = () => require('./funk-antwort.js');
const RE = () => require('./reise-ereignis.js');
const regie = () => require('./regie-befehle.js');
const klon = (v) => JSON.parse(JSON.stringify(v));
const istObjekt = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const r2 = (x) => Math.round(x * 100) / 100;
const fehl = (code) => ({ code, text: (BW.weigerung && BW.weigerung[code]) || code });
const weigerung = fehl;
const PID_RE = new RegExp('^f:[0-' + (W.portrait.varianten - 1) + ']:(' + W.voelker.join('|') + ')$');
const logbuch = (game, art, e) => { try { regie().schreibe(game, Object.assign({ art }, e)); } catch (err) { if (game && game.countError) game.countError('faden-bitte-logbuch', err); } };
const fehlerZaehlen = (game, wo, e) => { if (game && game.countError) game.countError(wo, e); };

// ---------- Porträt (einfach: Variante und Fraktion, Rückfall = kein Porträt)
function portraetPid(npc) {
  if (!npc || !W.voelker.includes(npc.fraktion)) return null;
  return 'f:' + Faden().portraetVon(npc) + ':' + npc.fraktion;
}
const pidGueltig = (pid) => typeof pid === 'string' && PID_RE.test(pid);

// ---------- Ruf-Betrag und Deckel
// Betrag der Ruf-Folgen einer Option (Summe der Beträge der Ruf-Gründe; Haltungs-Folgen zählen nicht)
function rufBetrag(folge) {
  let s = 0;
  for (const f of Array.isArray(folge) ? folge : []) {
    const r = P.folgeWirkung(f, 'n1');
    if (r.wirkung && r.wirkung.typ === 'ruf_aenderung') s += Math.abs(r.wirkung.delta);
  }
  return r2(s);
}
function deckelRaum(F) {
  F.bitteLog = F.bitteLog.filter((x) => F.t - x[0] < BW.fenster_taetigkeiten);
  return BW.ruf_deckel - F.bitteLog.reduce((s, x) => s + x[1], 0);
}

// ---------- Text (Platzhalter {name} {ort}; Schlüssel = text_key des Beats)
function textVon(beat, f) {
  const key = beat.parameter && beat.parameter.text_key;
  const t = typeof key === 'string' && Object.prototype.hasOwnProperty.call(BW.texte, key) ? BW.texte[key] : null;
  if (typeof t !== 'string') return null;
  let ort = 'hier';
  if (f.parameter && f.parameter.ort) { try { ort = RE().hexName(f.parameter.ort) || ort; } catch (e) { ort = f.parameter.ort; } }
  return t.split('{name}').join(f.nsc.name).split('{ort}').join(ort);
}

// ---------- Funk (Crew-Antwort, NSC-Zeile mit Porträt)
function funkSenden(game, von, text, pid) {
  if (!text) return;
  const ev = { from: von, text, lage: 1, r: 1 };
  if (pid) ev.pid = pid;
  try { game.emit('radio', ev); } catch (e) { fehlerZaehlen(game, 'faden-bitte-funk', e); }
}
function funkVon(game, nsc, text) {
  if (!istObjekt(nsc) || typeof nsc.name !== 'string' || typeof text !== 'string' || !text.trim()) return null;
  const pid = portraetPid(nsc);
  const zeile = text.replace(/\s+/g, ' ').trim().slice(0, 160);
  const ev = { from: nsc.name, text: zeile, r: 1 };
  if (pid) ev.pid = pid;
  try { game.emit('radio', ev); } catch (e) { fehlerZaehlen(game, 'faden-bitte-funk', e); }
  return { von: nsc.name, text: zeile, pid };
}

// ---------- Angebot
function offen(game) {
  const F = game && game.weltsim && game.weltsim.faeden;
  return F && F.bitte ? F.bitte : null;
}
function anbieten(game, o) {
  if (!Faden().aktiv(game)) return { ok: false, code: 'aus' };
  o = istObjekt(o) ? o : {};
  const F = Faden().zustandVon(game);
  const f = F.liste.find((x) => x.id === o.fadenId);
  if (!f || f.phase !== 'laeuft' || !f.laufend || f.laufend.gewaehlt) return { ok: false, code: 'kein_faden' };
  const v = D.vorlage(f.vorlage);
  const beat = v && v.beats[f.beat];
  if (!beat || !B[beat.typ] || B[beat.typ].baustein !== 'bitte' || f.laufend.beat !== o.beatId) return { ok: false, code: 'kein_beat' };
  if (F.bitte) return { ok: false, code: 'schon_offen' };
  if (game.weltsim.funkwahl && game.weltsim.funkwahl.offen) return { ok: false, code: 'funk_offen' };
  if (B[beat.typ].gefahr || beat.gefahr === true) return { ok: false, code: 'gefahr' };
  if (!FA().ruhig(game)) return { ok: false, code: 'unruhig' };
  if (typeof o.text !== 'string' || !o.text.trim() || o.text.length > BW.text_max) return { ok: false, code: 'text' };
  const ab = istObjekt(o.absender) ? o.absender : {};
  if (typeof ab.name !== 'string' || !ab.name || ab.name.length > 40 || !W.voelker.includes(ab.fraktion)) return { ok: false, code: 'absender' };
  const opts = Array.isArray(o.optionen) ? o.optionen : [];
  const fehler = P.optionenFehler({ id: beat.id, typ: beat.typ, optionen: opts }, B[beat.typ]);   // Regeln des Fadenkerns: Anzahl, Gefahr, Scheinwahl, Folgen aus den Wirkungen
  if (fehler.length) {
    logbuch(game, 'faden_pruefung', { ausgang: 'abgelehnt', key: 'bitte', plan: { faden: f.id, beat: beat.id }, fehler });
    return { ok: false, code: 'optionen', fehler };
  }
  // Bitte-Regel: eine Option mit Folge (Annahme, Ablehnung) trägt einen Ausgang, sonst bliebe der Beat nach der Zusage offen und liefe ins Scheitern;
  // nur die Option ohne Ausgang und ohne Folge (Daten: „später“) stellt die Bitte zurück
  const ohneAusgang = opts.filter((x) => Array.isArray(x.folge) && x.folge.length && x.ausgang === undefined);
  if (ohneAusgang.length) {
    logbuch(game, 'faden_pruefung', { ausgang: 'abgelehnt', key: 'bitte', plan: { faden: f.id, beat: beat.id }, fehler: ['OPTION_OHNE_AUSGANG: ' + ohneAusgang.map((x) => x.id).join(', ')] });
    return { ok: false, code: 'optionen', fehler: ['OPTION_OHNE_AUSGANG'] };
  }
  const raum = deckelRaum(F);
  const erlaubt = opts.filter((x) => rufBetrag(x.folge) <= raum + 1e-9);   // Optionen, deren Ruf-Folge der Deckel nicht mehr zuließe, entfallen
  if (erlaubt.length < 2) return { ok: false, code: 'deckel' };
  F.bitteNr = (F.bitteNr || 0) + 1;
  const pid = portraetPid(ab);
  F.bitte = {
    nr: F.bitteNr, fadenId: f.id, beatId: beat.id, von: ab.name, volk: ab.fraktion, pid: pid || null, text: o.text.slice(0, BW.text_max),
    optionen: erlaubt.map((x) => ({ id: x.id, text: String(x.text).slice(0, BW.text_max), folge: klon(x.folge), ausgang: x.ausgang })),
    bis: F.t + BW.frist_taetigkeiten,
  };
  for (const h of beat.hinweise || []) Faden().hinweisGezeigt(game, f.id, h);   // die Crew hat die Bitte gesehen: die Hinweise des Beats gelten (B-S1)
  logbuch(game, 'faden_ereignis', { ausgang: 'angebot', key: f.id, begruendung: `Bitte ${beat.id} angeboten (${erlaubt.length} Optionen)`, plan: { faden: f.id, beat: beat.id, nr: F.bitte.nr } });
  return { ok: true, code: null, bitte: F.bitte };
}
function angebotAusVorlage(game, fadenId) {
  const F = Faden().zustandVon(game);
  const f = F && F.liste.find((x) => x.id === fadenId);
  if (!f || f.phase !== 'laeuft' || !f.laufend) return { ok: false, code: 'kein_faden' };
  const v = D.vorlage(f.vorlage);
  const beat = v && v.beats[f.beat];
  if (!beat) return { ok: false, code: 'kein_beat' };
  const text = textVon(beat, f);
  if (text === null) return { ok: false, code: 'text' };
  return anbieten(game, {
    fadenId: f.id, beatId: beat.id,
    absender: { name: f.nsc.name, fraktion: f.nsc.fraktion, portrait: f.nsc.portrait }, text,
    optionen: (beat.optionen || []).map((x) => ({ id: x.id, text: x.text, folge: x.folge, ausgang: x.ausgang })),
  });
}

// ---------- Antwort (Befehl faden.bitte): die ERSTE Antwort gilt
function beantworten(game, id, nr) {
  if (!Faden().aktiv(game)) return fehl('modus');
  const F = Faden().zustandVon(game);
  const off = F.bitte;
  if (!off) return fehl(F.bitteZuletzt && nr === F.bitteZuletzt.nr ? 'schon_beantwortet' : 'kein_angebot');
  if (nr != null && nr !== off.nr) return fehl('kein_angebot');   // der Klick galt einem älteren Angebot
  if (!FA().ruhig(game)) { F.bitte = null; return fehl('unruhig'); }
  const f = F.liste.find((x) => x.id === off.fadenId);
  if (!f || f.phase !== 'laeuft' || !f.laufend || f.laufend.beat !== off.beatId || f.laufend.gewaehlt) { F.bitte = null; return fehl('kein_angebot'); }
  const opt = off.optionen.find((x) => x.id === id);
  if (!opt) return fehl('unbekannt');   // nur was im Angebot steht (Später ist nur lokal, kein Befehl)
  const betrag = rufBetrag(opt.folge);
  if (betrag > deckelRaum(F) + 1e-9) { F.bitte = null; return fehl('deckel'); }   // der Deckel hat sich seit dem Angebot gefüllt: zurückgezogen, ohne Folge
  F.bitte = null;
  if (opt.ausgang === undefined && !opt.folge.length) {   // Option ohne Ausgang und ohne Folge (Daten: „später“): die Bitte wird zurückgestellt, der Beat bleibt offen; nachTaetigkeit bietet erneut an
    funkSenden(game, BW.antwort_von, opt.text);
    return null;
  }
  F.bitteZuletzt = { nr: off.nr };
  if (betrag > 0) F.bitteLog.push([F.t, betrag]);
  funkSenden(game, BW.antwort_von, opt.text);   // die Crew antwortet mit dem angeklickten Text (nie neu gezogen)
  const r = Faden().optionWaehlen(game, off.fadenId, opt.id);   // Folgen (Ruf, Haltung) und Ausgang des Beats aus der Vorlage
  if (!r.ok) fehlerZaehlen(game, 'faden-bitte', new Error('optionWaehlen: ' + r.grund));
  return null;
}

// ---------- Takt: Verfall, verwaiste Angebote, Wiederholung
function nachTaetigkeit(game) {
  const F = game && game.weltsim && game.weltsim.faeden;
  if (!F || !Faden().aktiv(game)) return;
  if (F.bitte) {
    const off = F.bitte;
    const f = F.liste.find((x) => x.id === off.fadenId);
    if (!f || f.phase !== 'laeuft' || !f.laufend || f.laufend.beat !== off.beatId) F.bitte = null;   // der Beat ist nicht mehr da
    else if (F.t >= off.bis) {   // Verfall in Taetigkeiten: der Beat gilt als gescheitert (der Faden verändert sich, endet nicht)
      F.bitte = null;
      logbuch(game, 'faden_ereignis', { ausgang: 'verfall', key: off.fadenId, begruendung: `Bitte ${off.beatId} verfallen nach ${BW.frist_taetigkeiten} Tätigkeiten: gescheitert`, plan: { faden: off.fadenId, beat: off.beatId } });
      Faden().beatAusgang(game, off.fadenId, 'gescheitert');
      return;
    }
  }
  if (F.bitte) return;
  for (const f of F.liste.slice()) {   // ein laufender Bitten-Beat ohne Angebot (zu unruhig, Deckel voll) bietet erneut an, bis die Frist des Beats greift
    if (f.phase !== 'laeuft' || !f.laufend || f.laufend.gewaehlt) continue;
    const v = D.vorlage(f.vorlage), beat = v && v.beats[f.beat];
    if (!beat || !B[beat.typ] || B[beat.typ].baustein !== 'bitte') continue;
    if (angebotAusVorlage(game, f.id).ok) return;
  }
}

// Unruhige Lage (Sim-Szene, Gefahr angekündigt, Gegner): das Angebot wird zurückgezogen, ohne Folge; die Wiederholung kommt mit der nächsten Tätigkeit
function update(game) {
  const F = game && game.weltsim && game.weltsim.faeden;
  if (F && F.bitte && !FA().ruhig(game)) F.bitte = null;
}

// ---------- Anzeige (nur Daten, world.bitte)
function snapshot(game) {
  const F = game && game.weltsim && game.weltsim.faeden;
  if (!F || !F.bitte || !Faden().aktiv(game)) return null;
  const o = F.bitte;
  const s = { nr: o.nr, von: o.von, text: o.text, optionen: o.optionen.map((x) => ({ id: x.id, text: x.text })), kopf: BW.kopf, spaeter: BW.spaeter_text, rest: Math.max(0, o.bis - F.t) };
  if (o.pid) s.pid = o.pid;
  return s;
}
function schluessel(game) {
  const s = snapshot(game);
  return s ? s.nr + ':' + s.rest : null;
}

// ---------- Weltstand welt.sim.faeden.bitte (optional, Altstand = keiner)
function toSaveBitte(F) {
  const o = F && F.bitte;
  if (!o) return null;
  return { nr: o.nr, faden: o.fadenId, beat: o.beatId, text: o.text, rest: Math.max(0, o.bis - F.t), optionen: o.optionen.map((x) => ({ id: x.id, text: x.text })) };
}
// müllfest: alles, was nicht zur Vorlage und zum laufenden Beat passt, fällt weg; Folgen kommen aus der Vorlage, nie aus dem Stand
function lesenBitte(b, F) {
  if (!istObjekt(b)) return null;
  const f = F.liste.find((x) => x.id === b.faden);
  if (!Number.isInteger(b.nr) || b.nr < 1 || b.nr > 999999 || !f || f.phase !== 'laeuft' || !f.laufend || f.laufend.gewaehlt || f.laufend.beat !== b.beat) return null;
  const v = D.vorlage(f.vorlage), beat = v && v.beats[f.beat];
  if (!beat || !B[beat.typ] || B[beat.typ].baustein !== 'bitte') return null;
  if (typeof b.text !== 'string' || !b.text.trim() || b.text.length > BW.text_max) return null;
  if (!Number.isInteger(b.rest) || b.rest < 0 || b.rest > BW.frist_taetigkeiten) return null;
  if (!Array.isArray(b.optionen) || b.optionen.length < BW.optionen.min || b.optionen.length > BW.optionen.max) return null;
  const optionen = [], ids = new Set();
  for (const x of b.optionen) {
    if (!istObjekt(x) || typeof x.id !== 'string' || typeof x.text !== 'string' || ids.has(x.id)) return null;
    const quelle = (beat.optionen || []).find((o) => o.id === x.id);
    if (!quelle || x.text.length > BW.text_max) return null;
    ids.add(x.id);
    optionen.push({ id: x.id, text: x.text, folge: klon(quelle.folge), ausgang: quelle.ausgang });
  }
  return { nr: b.nr, fadenId: f.id, beatId: beat.id, von: f.nsc.name, volk: f.nsc.fraktion, pid: portraetPid(f.nsc), text: b.text, optionen, bis: F.t + b.rest };
}

// ---------- Baustein `bitte` (faden-bausteine.js registriert ihn): starten bietet die Bitte an; „laeuft“ = der Ausgang kommt über die Antwort oder den Verfall
const baustein = {
  id: 'bitte',
  starten(game, faden) {
    angebotAusVorlage(game, faden.id);   // kann verweigert sein (Deckel, unruhig, Angebot schon offen): nichts blockiert, nachTaetigkeit wiederholt es
    return { laeuft: true };
  },
};

module.exports = { baustein, anbieten, angebotAusVorlage, beantworten, nachTaetigkeit, update, funkVon, portraetPid, pidGueltig, offen, snapshot, schluessel, toSaveBitte, lesenBitte, weigerung, rufBetrag, deckelRaum };
