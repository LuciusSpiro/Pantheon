'use strict';
// SUND-03b A: Funk-Antworten mit Folgen (server/sim/funk-antwort.js, Daten content/reise/ereignisse.json `antworten`, content/reise/werte.json, content/welt/ruf-werte.json quellen). Prüft:
//   Daten (Prüfer: 2–3 Optionen, unterschiedliche Folgen, Gründe da, nie bei Gefahr) · Angebot je Eintrag (Sprecher, Optionen, Fenster) · Antwort (Folge nur über ruf_aenderung, Funk, Reaktion mit Verzögerung, Chronik) ·
//   erste Antwort gilt · Ignorieren kostet nichts · Verfall und Ersetzen · nie bei Gefahr · nie in Sim-Szene und unruhiger Lage · Deckel · Textstelle (Pool von Paket T) · Schalter aus = nichts ·
//   Sim-Zustand und Ereignisring byte-gleich mit und ohne Angebot · Weltstand (nichts gespeichert, Version 3) · Snapshot nur bei Änderung, Löschsignal · Mehrspieler zu dritt · Leser/Befehl müllfest.
//   node tools/test-funk-antwort.js     (npm run test:funk-antwort)
const fs = require('fs');
const path = require('path');
const F = require('./regie-fixture.js');
const Sektoren = require('../shared/sektoren.js');
const Weltstand = require('../server/weltstand.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Sprung = require('../server/sim/sprung.js');
const RE = require('../server/sim/reise-ereignis.js');
const FA = require('../server/sim/funk-antwort.js');
const Protocol = require('../shared/protocol.js');
const CONFIG = require('../shared/config.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t, f) => { console.log('\n' + t); f(); };
const klon = F.klon;
const ws = (g) => g.weltsim;
const ENV = { REISE_EREIGNISSE: '1' };
const spiel = (o) => F.neuesSpiel(Object.assign({ crew: 1, seed: 7, env: ENV }, o || {}));
const ohneFlotten = (g) => { ws(g).zustand.flotten = []; g.space.enemies = []; };
const abbild = (g) => JSON.stringify(Kriegslage.abbild(ws(g).zustand));
const HEX = { rom: '0305', rom2: '0304', saum: '0504', frei: '0503' };
const KAT = RE.KATALOG;
const QUELLEN = require('../content/welt/ruf-werte.json').werte.quellen.wert;
const W = RE.WERTE;
function nur(ids, fn) { const kopie = KAT.slice(); KAT.length = 0; for (const e of kopie) if (ids.includes(e.id)) KAT.push(e); try { return fn(); } finally { KAT.length = 0; KAT.push(...kopie); } }
function sicher(fn, p) { const alt = W.wahrscheinlichkeit; W.wahrscheinlichkeit = p == null ? 1 : p; try { return fn(); } finally { W.wahrscheinlichkeit = alt; } }
const springe = (g, hex) => Sprung.springeNach(g, Sektoren.ortVonHex(hex));
const frei = (g) => { const R = ws(g).reise; R.letzter = null; R.letzte = []; };   // der Abstand und die Wiederholungsregeln stehen dem Szenario nicht im Weg
// Ein Ereignis erzwingen (Katalog auf diese Id beschränkt, Wahrscheinlichkeit 1) und ein Angebot erwarten
const ereignis = (g, id, hex) => { ohneFlotten(g); frei(g); return nur([id], () => sicher(() => springe(g, hex || HEX.rom))); };
const offen = (g) => (ws(g).funkwahl && ws(g).funkwahl.offen) || null;
const funkTexte = (t, i) => t.cs[i || 0].inbox.filter((m) => m.t === 'event' && m.kind === 'radio').map((m) => m.text);
const lauf = (g, sek) => { for (let i = 0; i < Math.round(sek * CONFIG.tickHz); i++) g.step(); };
const rom = (g) => ws(g).ruf.rom, kon = (g) => ws(g).ruf.kon;
// Alle ruf_aenderung, die über Kriegslage.rufBuchen laufen, mitschreiben
function spaehe(fn) {
  const orig = Kriegslage.rufBuchen, log = [];
  Kriegslage.rufBuchen = function (game, w) { log.push(...klon(w)); return orig.apply(this, arguments); };
  try { fn(); } finally { Kriegslage.rufBuchen = orig; }
  return log;
}
const MIT = KAT.filter((e) => Array.isArray(e.antworten));

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------
section('Daten: Prüfer der Katalogeinträge mit antworten', () => {
  const D = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'reise', 'ereignisse.json'), 'utf8')).eintraege;
  const mit = D.filter((e) => e.antworten !== undefined);
  ok(mit.length >= 7, `${mit.length} Katalogeinträge mit antworten (etwa 8 verlangt, mindestens 7 ohne Gefahr vorhanden)`);
  ok(mit.every((e) => !e.gefahr), 'nie bei gefahr:true (Ausweichen ist dort nicht möglich = Scheinwahl)');
  ok(mit.every((e) => ['funkmeldung', 'patrouille', 'notruf'].includes(e.art)), 'Arten: Funkmeldung, Streife, Havarie-Notruf');
  ok(mit.filter((e) => e.art === 'notruf').every((e) => e.parameter.variante === 'havarie'), 'Notrufe mit Antworten sind Havarien (nach Beantwortung und Dank)');
  ok(mit.every((e) => Array.isArray(e.antworten) && e.antworten.length >= 2 && e.antworten.length <= 3), 'je Eintrag 2 bis 3 Optionen');
  const alle = mit.flatMap((e) => e.antworten);
  ok(alle.every((o) => /^[a-z][a-z0-9_]*$/.test(o.id) && o.id !== FA.IGNORIEREN), 'Optionen-Ids klein geschrieben, nie die reservierte Id ignorieren');
  ok(mit.every((e) => new Set(e.antworten.map((o) => o.id)).size === e.antworten.length), 'Optionen-Ids je Eintrag eindeutig');
  ok(alle.every((o) => typeof o.text === 'string' && o.text.length >= 4 && o.text.length <= W.antwort_text_max), `Antworttext höchstens ${W.antwort_text_max} Zeichen`);
  ok(alle.every((o) => typeof o.reaktion === 'string' && o.reaktion.length >= 4 && o.reaktion.length <= 120), 'Reaktion des Sprechers kurz (4 bis 120 Zeichen)');
  ok(alle.every((o) => !/\{|\}/.test(o.text + o.reaktion)), 'keine Platzhalter in den Optionstexten (nie ein Spielername)');
  ok(alle.every((o) => Array.isArray(o.folge) && o.folge.every((g) => typeof g === 'string' && QUELLEN[g])), 'Folgen: nur Gründe, die ruf-werte.json quellen kennt');
  ok(alle.every((o) => o.folge.every((g) => !/haltung/i.test(g)) && Object.keys(o).sort().join() === 'folge,id,reaktion,text'), 'keine Wirkung Haltung, nur die Felder id, text, reaktion, folge');
  const profil = (o) => JSON.stringify(o.folge.slice().sort());
  ok(mit.every((e) => new Set(e.antworten.map(profil)).size === e.antworten.length), 'je Eintrag UNTERSCHIEDLICHE Folgeprofile (keine zwei Optionen mit gleicher Folge)');
  ok(mit.every((e) => e.antworten.filter((o) => o.folge.length === 0).length <= 1), 'höchstens eine ausdrücklich folgenlose Option je Eintrag');
  ok(mit.every((e) => new Set(e.antworten.map((o) => o.folge.map((g) => QUELLEN[g].fraktion + Math.sign(QUELLEN[g].delta)).sort().join('+'))).size >= 2), 'je Eintrag mindestens 2 verschiedene Ausgänge');
  const gruende = [...new Set(alle.flatMap((o) => o.folge))];
  ok(gruende.every((g) => Math.abs(QUELLEN[g].delta) <= 1 && Math.abs(QUELLEN[g].delta) * 2 <= W.ruf_max_je_100), `Folgen klein: |delta| höchstens 1 (Deckel ${W.ruf_max_je_100} je 100 Sprünge)`);
  ok(gruende.some((g) => QUELLEN[g].fraktion === 'kon'), 'das Konkordat (kon) bekommt erste Quellen (bisher unbeweglich)');
  ok(gruende.every((g) => !QUELLEN[g].folge || Object.keys(QUELLEN[g].folge).every((f) => ['rom', 'ger', 'kon'].includes(f))), 'Nebenwirkungen der Gründe nennen nur Fraktionen');
  ok(W.antwort_gilt_spruenge >= 1 && W.antwort_gilt_spruenge <= 5 && W.antwort_reaktion_s >= 1 && W.antwort_reaktion_s <= 6 && W.antwort_text_max === 40, 'Zahlen in den Daten: Gültigkeit in Sprüngen, Verzögerung der Reaktion, Textlänge');
  ok(['modus', 'kein_angebot', 'schon_beantwortet', 'unbekannt', 'unruhig'].every((c) => typeof W.weigerung[c] === 'string' && W.weigerung[c].length > 5), 'Weigerungstexte aller Codes in den Daten');
  ok(Protocol.CMD_FUNK_ANTWORT === 'funk.antworten' && FA.OPT_MAX === 3, 'Protokoll: Befehl funk.antworten');
  const alleTexte = alle.flatMap((o) => [o.text, o.reaktion]);
  ok(alleTexte.every((t) => !/legat|mars/i.test(t)), 'keine neuen Funkporträts im Text');
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------
section('Angebot je Eintrag: Sprecher, Optionen, Fenster', () => {
  const FALL = { funk_lage_rom: [HEX.rom, 'rom'], funk_lage_ger: [HEX.rom, 'ger'], funk_lage_offen: [HEX.rom, 'offen'], funk_handel_stimmen: [HEX.rom], patrouille_rom_gruss: [HEX.rom] };
  const Regie = require('../server/sim/regie-befehle.js'); const lageEcht = Regie.lage;
  for (const e of MIT.filter((x) => x.art !== 'notruf')) {
    const t = spiel(); const g = t.g;
    if (FALL[e.id][1]) Regie.lage = () => ({ sieger: FALL[e.id][1] });
    let r; try { r = ereignis(g, e.id, FALL[e.id][0]); } finally { Regie.lage = lageEcht; }
    const o = offen(g);
    ok(r && r.id === e.id && o && o.id === e.id && o.von === e.sprecher && o.optionen.length === e.antworten.length && o.optionen.every((x, i) => x.id === e.antworten[i].id && x.text === e.antworten[i].text), `${e.id}: Ereignis, dann Angebot vom Sprecher „${e.sprecher}“ mit ${e.antworten.length} Optionen`);
    ok(o && o.bis === ws(g).reise.n + W.antwort_gilt_spruenge, `${e.id}: gilt ${W.antwort_gilt_spruenge} weitere Sprünge`);
  }
  // Havarie: das Angebot kommt erst nach dem Hinflug und dem Dank (nicht schon beim Notruf)
  for (const e of MIT.filter((x) => x.art === 'notruf')) {
    const t = spiel(); const g = t.g;
    const r = ereignis(g, e.id, e.id === 'notruf_havarie_konvoi' ? HEX.saum : HEX.rom);
    const R = ws(g).reise; const o = R.offen[0];
    ok(r && o && !offen(g), `${e.id}: beim Notruf noch kein Angebot`);
    ohneFlotten(g); R.letzter = R.n;   // der Notruf liegt in der Nähe: dorthin fliegen
    springe(g, o.hex);
    const a = offen(g);
    ok(a && a.id === e.id && a.von === e.sprecher && a.optionen.length === 2, `${e.id}: nach dem Hinflug und dem Dank: Angebot mit den Antworten`);
    const funk = funkTexte(t);
    ok(funk.length >= 2 && !funk.some((x) => /^Schon|kein/.test(x)), `${e.id}: der Dank-Funk kommt vor dem Angebot`);
  }
  // Ereignisse ohne antworten: nie ein Angebot (Funkmeldung Händlerfunk hat welche; die Gefahr-Einträge und der Rest nicht)
  const ohne = KAT.filter((e) => !Array.isArray(e.antworten));
  ok(ohne.length >= 7 && ohne.every((e) => !FA.anbieten(spiel().g, { id: e.id, nr: 1, hex: HEX.rom, textIdx: 0 })), `${ohne.length} Einträge ohne antworten: kein Angebot (Gefahr-Einträge eingeschlossen)`);
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------
section('Antwort: Folge nur über ruf_aenderung, Funk, Reaktion mit Verzögerung, Chronik', () => {
  const t = spiel({ names: ['Quirin'] }); const g = t.g;
  ereignis(g, 'patrouille_rom_gruss', HEX.rom);
  const o = offen(g); const lfd = o.lfd;
  const r0 = rom(g), k0 = kon(g), z0 = abbild(g), ring0 = JSON.stringify(ws(g).ereignisse), chr0 = ws(g).chronik.length;
  let res; const log = spaehe(() => { res = FA.beantworten(g, 'kennung', lfd); });
  ok(res === null, 'die Antwort wird angenommen');
  ok(log.length === 1 && log[0].typ === 'ruf_aenderung' && log[0].grund === 'funk_rom_gruss' && log[0].fraktion === 'rom' && log[0].delta === QUELLEN.funk_rom_gruss.delta, 'Folge: genau eine Wirkung ruf_aenderung (Grund funk_rom_gruss), gebucht über Kriegslage.rufBuchen');
  ok(rom(g) === r0 + QUELLEN.funk_rom_gruss.delta && kon(g) === k0, 'Ruf: Rom +' + QUELLEN.funk_rom_gruss.delta + ', sonst nichts');
  ok(abbild(g) === z0 && JSON.stringify(ws(g).ereignisse) === ring0, 'Sim-Zustand und Ereignisring unverändert (die Folge ändert nur den Ruf)');
  ok(!offen(g) && ws(g).funkwahl.zuletzt.id === 'kennung' && ws(g).funkwahl.zuletzt.gebucht === 1, 'das Angebot ist geschlossen');
  const f1 = funkTexte(t);
  ok(f1[f1.length - 1] === 'Kennung bestätigt, danke.' && !f1.includes('Verstanden, Lerche. Gute Fahrt.'), 'alle hören die Antwort der Crew sofort, die Reaktion noch nicht');
  lauf(g, W.antwort_reaktion_s - 1);
  ok(!funkTexte(t).includes('Verstanden, Lerche. Gute Fahrt.'), `vor ${W.antwort_reaktion_s} s keine Reaktion`);
  lauf(g, 2);
  const f2 = funkTexte(t);
  ok(f2[f2.length - 1] === 'Verstanden, Lerche. Gute Fahrt.', `nach ${W.antwort_reaktion_s} s antwortet der Sprecher`);
  const ev = t.cs[0].inbox.filter((m) => m.kind === 'radio').slice(-2);
  ok(ev[0].from === 'Lerche' && ev[1].from === 'Römische Streife', 'Plakette: das Schiff, dann der Sprecher (kein Spielername)');
  const c = ws(g).chronik.slice(chr0);
  ok(c.length === 1 && c[0].art === 'reise' && /Funkantwort an Römische Streife: Kennung bestätigt/.test(c[0].kurz) && c[0].param.wahl === 'kennung', 'Chronik: ein Eintrag mit der Wahl');
  ok(![...funkTexte(t), JSON.stringify(ws(g).chronik)].join(' ').includes('Quirin'), 'kein Spielername in Funk oder Chronik');
  // Option mit Nebenwirkung und kon
  const t2 = spiel(); const g2 = t2.g;
  ereignis(g2, 'patrouille_rom_gruss', HEX.rom); const a2 = rom(g2);
  FA.beantworten(g2, 'saum', offen(g2).lfd);
  ok(kon(g2) === 0.5 && rom(g2) === a2 - 0.5, 'Saum-Antwort: Konkordat +0,5, Rom −0,5 (Nebenwirkung des Grundes)');
  // folgenlose Option
  const t3 = spiel(); const g3 = t3.g;
  ereignis(g3, 'funk_handel_stimmen', HEX.rom); const b3 = [rom(g3), kon(g3)];
  const l3 = spaehe(() => FA.beantworten(g3, 'verstanden', offen(g3).lfd));
  ok(l3.length === 0 && rom(g3) === b3[0] && kon(g3) === b3[1] && ws(g3).funkwahl.zuletzt.gebucht === 0, 'ausdrücklich folgenlose Option: keine Wirkung, kein Ruf');
  lauf(g3, W.antwort_reaktion_s + 1);
  ok(funkTexte(t3).includes('Gute Fahrt.'), 'auch ohne Folge antwortet der Sprecher');
  // alle Optionen des Katalogs: Folge entspricht den Daten (nur ruf_aenderung)
  for (const e of MIT) for (const op of e.antworten) {
    const tt = spiel(); const gg = tt.g; const R = ws(gg).reise; R.n = 50;
    FA.anbieten(gg, { id: e.id, nr: 50, hex: HEX.rom, textIdx: 0 });
    const lg = spaehe(() => FA.beantworten(gg, op.id));
    ok(offen(gg) === null && lg.every((w) => w.typ === 'ruf_aenderung') && lg.map((w) => w.grund).sort().join() === op.folge.slice().sort().join(), `${e.id}/${op.id}: Wirkungen = ${JSON.stringify(op.folge)}, nur ruf_aenderung`);
  }
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------
section('Erste Antwort gilt, Ignorieren, Verfall, Ersetzen, höchstens ein Angebot', () => {
  const t = spiel({ crew: 3 }); const g = t.g;
  ereignis(g, 'funk_handel_stimmen', HEX.rom);
  const lfd = offen(g).lfd; const r0 = rom(g), k0 = kon(g);
  g.handleMessage(t.cs[1], { t: 'cmd', c: 'funk.antworten', id: 'rom', nr: lfd });
  g.handleMessage(t.cs[2], { t: 'cmd', c: 'funk.antworten', id: 'tipp', nr: lfd });
  g.handleMessage(t.cs[0], { t: 'cmd', c: 'funk.antworten', id: 'rom', nr: lfd });
  const antw = (i) => t.cs[i].inbox.filter((m) => m.t === 'event' && m.kind === 'funkAntwort');
  ok(antw(1).length === 1 && antw(1)[0].ok === true && antw(2).length === 1 && antw(2)[0].ok === false && antw(2)[0].code === 'schon_beantwortet' && antw(0)[0].code === 'schon_beantwortet', 'die ERSTE Antwort gilt, die anderen bekommen „schon beantwortet“ (Ereignis funkAntwort)');
  ok(rom(g) === r0 + QUELLEN.funk_rom_werbung.delta && kon(g) === k0 - 0.5 && ws(g).funkwahl.zuletzt.id === 'rom', 'nur die erste Folge ist gebucht (Rom +' + QUELLEN.funk_rom_werbung.delta + ', Konkordat −0,5)');
  ok([0, 1, 2].every((i) => funkTexte(t, i).includes('Rom sucht Schiffe, meldet euch.')), 'alle drei hören die gewählte Antwort');
  lauf(g, W.antwort_reaktion_s + 1);
  ok([0, 1, 2].every((i) => funkTexte(t, i).includes('Rom? Wir überlegen es uns.')), 'alle drei hören die Reaktion');
  // spätere Nachzügler (anderes Angebot): „kein Angebot“
  ok(FA.beantworten(g, 'rom', lfd).code === 'schon_beantwortet', 'im selben Sprung: schon beantwortet');
  springe(g, HEX.rom2);   // ein Sprung weiter (kein Ereignis: Abstand), jetzt ist es kein Nachzügler mehr
  ok(FA.beantworten(g, 'rom', lfd).code === 'kein_angebot', 'später: es gibt nichts zu beantworten');
  // Ignorieren
  const t2 = spiel(); const g2 = t2.g;
  ereignis(g2, 'funk_lage_ger', HEX.rom); // (die Lage kann abweichen: dann das Havarie-Angebot nehmen)
  if (!offen(g2)) ereignis(g2, 'funk_handel_stimmen', HEX.rom);
  const b = [rom(g2), kon(g2)], c0 = ws(g2).chronik.length, f0 = funkTexte(t2).length;
  const l = spaehe(() => { ok(FA.beantworten(g2, FA.IGNORIEREN, offen(g2).lfd) === null, 'Nicht antworten wird angenommen'); });
  lauf(g2, W.antwort_reaktion_s + 1);
  ok(!offen(g2) && l.length === 0 && rom(g2) === b[0] && kon(g2) === b[1] && ws(g2).chronik.length === c0 && funkTexte(t2).length === f0, 'Ignorieren: schließt das Angebot, kostet nichts (kein Ruf, kein Funk, keine Chronik)');
  // Verfall nach N Sprüngen
  const t3 = spiel(); const g3 = t3.g;
  ereignis(g3, 'funk_handel_stimmen', HEX.rom);
  const stoer = (g_, h) => sicher(() => springe(g_, h), 0);   // Sprünge ohne neues Ereignis
  for (let i = 0; i < W.antwort_gilt_spruenge; i++) { ohneFlotten(g3); stoer(g3, i % 2 ? HEX.rom : HEX.rom2); }
  ok(!!offen(g3), `nach ${W.antwort_gilt_spruenge} weiteren Sprüngen gilt das Angebot noch`);
  const lf = offen(g3).lfd;
  ohneFlotten(g3); stoer(g3, HEX.rom);
  ok(!offen(g3) && FA.beantworten(g3, 'tipp', lf).code === 'kein_angebot' && FA.snapshot(g3) === null, 'im nächsten Sprung ist es verfallen, ohne Folge');
  // Ersetzen: höchstens ein Angebot
  const t4 = spiel(); const g4 = t4.g;
  ereignis(g4, 'funk_handel_stimmen', HEX.rom); const erstes = offen(g4).lfd;
  ereignis(g4, 'patrouille_rom_gruss', HEX.rom2);
  ok(offen(g4) && offen(g4).id === 'patrouille_rom_gruss' && offen(g4).lfd === erstes + 1, 'ein neues Angebot ersetzt das alte (höchstens eines gleichzeitig)');
  ok(FA.beantworten(g4, 'rom', erstes).code === 'kein_angebot' && !!offen(g4), 'ein Klick auf das ältere Angebot (nr) gilt nicht für das neue');
  ok(FA.beantworten(g4, 'gibt_es_nicht', offen(g4).lfd).code === 'unbekannt' && !!offen(g4), 'unbekannte Option: abgelehnt, das Angebot bleibt');
  ok(FA.beantworten(g4, 'rom', NaN).code === 'kein_angebot' && FA.beantworten(g4, 'rom', 'x').code === 'kein_angebot' && !!offen(g4), 'unsinnige Nummer (NaN, Text): abgelehnt, nie die Antwort auf das offene Angebot');
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------
section('Nie bei Gefahr, nie in Sim-Szene, nur in ruhiger Lage', () => {
  // alle Gefahr-Einträge: auch mit künstlich eingetragenen antworten kein Angebot
  const gef = KAT.filter((e) => e.gefahr);
  ok(gef.length >= 6, `${gef.length} Gefahr-Einträge`);
  for (const e of gef) {
    const kopie = e.antworten; e.antworten = [{ id: 'a', text: 'A', reaktion: 'B', folge: ['funk_rom_gruss'] }, { id: 'b', text: 'B', reaktion: 'C', folge: [] }];
    try { const g = spiel().g; ok(FA.anbieten(g, { id: e.id, nr: 1, hex: HEX.rom, textIdx: 0 }) === null && !offen(g), `${e.id}: nie ein Angebot (Code, nicht nur Daten)`); } finally { if (kopie === undefined) delete e.antworten; else e.antworten = kopie; }
  }
  {   // Gefahr im Spiel: Ereignis, Notruf mit Gefahr beantwortet -> kein Angebot, auch nicht nach dem Dank
    const t = spiel(); const g = t.g; ereignis(g, 'notruf_pirat_frachter', HEX.rom);
    ok(!offen(g), 'Notruf mit Gefahr: beim Notruf kein Angebot');
  }
  // Sim-Szene
  const t = spiel(); const g = t.g; ohneFlotten(g); frei(g);
  g.simSzene = { fraktion: 'ger' };
  ok(FA.anbieten(g, { id: 'funk_handel_stimmen', nr: 1, hex: HEX.rom, textIdx: 0 }) === null && !FA.ruhig(g), 'in einer Sim-Szene: kein Angebot');
  g.simSzene = null;
  const o = FA.anbieten(g, { id: 'funk_handel_stimmen', nr: ws(g).reise.n, hex: HEX.rom, textIdx: 0 });
  ok(!!o && FA.ruhig(g), 'ruhige Lage: Angebot');
  g.simSzene = { fraktion: 'ger' };
  ok(FA.beantworten(g, 'rom', o.lfd).code === 'unruhig' && !offen(g) && rom(g) === 0, 'beginnt eine Sim-Szene, ist die Antwort nicht mehr möglich: abgelehnt, kein Ruf, das Angebot ist zurückgezogen');
  g.simSzene = null;
  // laufende Gefahr und Gegner im Sektor
  const o2 = FA.anbieten(g, { id: 'funk_handel_stimmen', nr: ws(g).reise.n, hex: HEX.rom, textIdx: 0 });
  ws(g).reise.laufend.push({ nr: 99, id: 'piraten_hinterhalt', phase: 'erwartet', szene: g.ship.scene, sprung: ws(g).reise.n, ab: g.time + 50, tag: 'x' });
  FA.update(g);
  ok(o2 && !offen(g), 'laufende (angekündigte) Gefahr: das Angebot wird zurückgezogen');
  ok(FA.anbieten(g, { id: 'funk_handel_stimmen', nr: 1, hex: HEX.rom, textIdx: 0 }) === null, 'bei laufender Gefahr kein neues Angebot');
  ws(g).reise.laufend.length = 0;
  g.space.enemies = [{ id: 'e1', tag: 'x' }];
  ok(FA.anbieten(g, { id: 'funk_handel_stimmen', nr: 1, hex: HEX.rom, textIdx: 0 }) === null, 'Gegner im Sektor: kein Angebot');
  g.space.enemies = [];
  FA.anbieten(g, { id: 'funk_handel_stimmen', nr: 1, hex: HEX.rom, textIdx: 0 });
  g.space.enemies = [{ id: 'e1' }]; FA.update(g);
  ok(!offen(g), 'Gegner erscheinen: das Angebot wird zurückgezogen');
  g.space.enemies = [];
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------
section('Deckel: Rom-Deckel der Antworten und Reise-Ruf-Deckel', () => {
  const GEW = QUELLEN.funk_rom_gruss.delta, CAP = W.antwort_rom_max_je_100;
  const ev = (id) => ({ id, nr: 0, hex: HEX.rom, textIdx: 0 });
  // 1. Rom-Deckel: höchstens CAP Rom-Gewinn je 100 Sprünge aus Antworten
  const t = spiel(); const g = t.g; const R = ws(g).reise; R.n = 50;
  const r0 = rom(g); let k = 0;
  while (k < 20) {
    R.n = 50 + k;
    if (!FA.anbieten(g, ev('patrouille_rom_gruss'))) break;
    FA.beantworten(g, 'kennung'); k++;
  }
  ok(k === Math.floor(CAP / GEW) && Math.abs(rom(g) - r0 - k * GEW) < 1e-9 && rom(g) - r0 <= CAP + 1e-9, `Rom-Deckel: höchstens ${CAP} Rom-Gewinn je 100 Sprünge aus Antworten (${k} Antworten à ${GEW})`);
  ok(FA.anbieten(g, ev('patrouille_rom_gruss')) === null, 'danach kein Angebot der Streife mehr: nach dem Weglassen der Rom-Option bleibt keine Wahl (keine Scheinwahl)');
  const o2 = FA.anbieten(g, ev('funk_handel_stimmen'));
  ok(o2 && o2.optionen.map((o) => o.id).join() === 'tipp,verstanden', 'Handelsfunk: die Option mit Rom-Gewinn ist ausgeblendet, 2 echte Optionen bleiben (Konkordat und folgenlos)');
  ok(FA.beantworten(g, 'rom').code === 'unbekannt' && !!offen(g), 'die ausgeblendete Option ist auch per Befehl nicht wählbar');
  const kn = kon(g); FA.beantworten(g, 'tipp');
  ok(kon(g) === kn + 0.5, 'Konkordat-Antworten gehen weiter (der Rom-Deckel betrifft nur den Rom-Gewinn)');
  R.n += 100;
  const o3 = FA.anbieten(g, ev('patrouille_rom_gruss'));
  ok(o3 && o3.optionen.length === 2, 'nach 100 Sprüngen ist der Raum wieder da: beide Optionen');
  // Abzüge zählen nicht (Saum-Antwort: Rom −0,5)
  const t1 = spiel(); const g1 = t1.g; ws(g1).reise.n = 50;
  for (let i = 0; i < 6; i++) { ws(g1).reise.n = 50 + i; FA.anbieten(g1, ev('patrouille_rom_gruss')); FA.beantworten(g1, 'saum'); }
  ok(ws(g1).funkwahl.romLog.length === 0 && ws(g1).ruf.kon === 3 && ws(g1).ruf.rom === 0, 'Abzüge und Konkordat-Gewinn zählen nicht gegen den Rom-Deckel (Rom bleibt bei 0 geklemmt, Konkordat +3)');
  // 2. Reise-Ruf-Deckel: nur Rom zählt dort für Antworten
  const t2 = spiel(); const g2 = t2.g; const R2 = ws(g2).reise; R2.n = 50;
  let m = 0; while (m < 100 && RE.gruendeBuchen(g2, ['funk_rom_gruss'], 'rom')) m++;
  ok(m === Math.floor(W.ruf_max_je_100 / GEW) && rom(g2) === m * GEW, `Reise-Ruf-Deckel (${W.ruf_max_je_100} je 100 Sprünge) gilt für Rom-Folgen der Antworten (${m} Folgen à ${GEW})`);
  ok(FA.anbieten(g2, ev('patrouille_rom_gruss')) === null && !!FA.anbieten(g2, ev('funk_handel_stimmen')), 'bei vollem Reise-Ruf-Deckel: Optionen mit Rom-Folge entfallen (Streife: kein Angebot), Konkordat-Optionen bleiben');
  const kv = kon(g2); FA.beantworten(g2, 'tipp');
  ok(kon(g2) === kv + 0.5 && ws(g2).funkwahl.zuletzt.gebucht === 1, 'Konkordat-Antworten gehen auch bei vollem Deckel durch (sie verdrängen keine Rom-Folgen der Ereignisse)');
  const t4 = spiel(); const g4 = t4.g; ws(g4).reise.n = 50;
  for (let i = 0; i < 40; i++) { ws(g4).reise.n = 50 + i; FA.anbieten(g4, ev('funk_handel_stimmen')); FA.beantworten(g4, 'tipp'); }
  ok(ws(g4).reise.rufLog.length === 0 && ws(g4).ruf.kon === 20, 'Konkordat-Antworten füllen den Reise-Ruf-Deckel nie (40 Antworten, Deckel leer)');
  // Zusammenspiel mit den Folgen der Ereignisse (gleicher Deckel): Streife +1 sofort, dann Antwort
  const t3 = spiel(); const g3 = t3.g; const R3 = ws(g3).reise;
  ereignis(g3, 'patrouille_rom_gruss', HEX.rom);
  ok(R3.rufLog.length === 1 && R3.rufLog[0][1] === 1, 'die Folge der Streife (1) steht im Deckel');
  FA.beantworten(g3, 'kennung', offen(g3).lfd);
  ok(R3.rufLog.length === 2 && R3.rufLog.reduce((s, x) => s + x[1], 0) === 1 + GEW, `die Folge der Antwort kommt dazu (${1 + GEW}): ein Deckel für beides`);
  // S1: ist der Deckel zwischen Angebot und Antwort durch ein Ereignis gefüllt worden, ist die Folge nicht mehr buchbar: Angebot zurückgezogen (Code deckel), kein Funk, keine Chronik, keine Reaktion, kein ok
  const t5 = spiel(); const g5 = t5.g; ws(g5).reise.n = 50;
  FA.anbieten(g5, ev('patrouille_rom_gruss'));
  while (RE.gruendeBuchen(g5, ['funk_rom_gruss'], 'rom')) { /* Deckel füllen (in kleinen Schritten bis genau zum Rand) */ }
  const rv = rom(g5), funkVor = funkTexte(t5).length, chrVor = JSON.stringify(ws(g5).chronik || null);
  const rd = FA.beantworten(g5, 'kennung');
  ok(!!rd && rd.code === 'deckel' && rd.text === W.weigerung.deckel, 'füllt ein Ereignis den Deckel zwischen Angebot und Antwort, wird die Antwort abgelehnt (Code deckel, Text aus den Daten)');
  ok(!offen(g5) && rom(g5) === rv && ws(g5).funkwahl.romLog.length === 0 && !ws(g5).funkwahl.zuletzt, 'das Angebot ist zurückgezogen, keine Folge, der Rom-Deckel behält seinen Raum');
  lauf(g5, W.antwort_reaktion_s + 1);
  ok(funkTexte(t5).length === funkVor && !funkTexte(t5).includes('Verstanden, Lerche. Gute Fahrt.') && !funkTexte(t5).includes('Kennung bestätigt, danke.'), 'kein Funk der Crew, keine Reaktion des Sprechers');
  ok(JSON.stringify(ws(g5).chronik || null) === chrVor, 'keine Chronik-Zeile');
  ok(FA.beantworten(g5, 'kennung').code === 'kein_angebot', 'eine weitere Antwort: kein Angebot mehr');
  // eine Konkordat-Antwort bleibt beim vollen Rom-Deckel buchbar (kein Rom-Betrag)
  const t6 = spiel(); const g6 = t6.g; ws(g6).reise.n = 50;
  FA.anbieten(g6, ev('funk_handel_stimmen'));
  while (RE.gruendeBuchen(g6, ['funk_rom_gruss'], 'rom')) { /* Deckel füllen */ }
  ok(FA.beantworten(g6, 'tipp') === null && ws(g6).funkwahl.zuletzt.gebucht === 1, 'Konkordat-Folge bleibt beim vollen Rom-Deckel buchbar (keine Ablehnung)');
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------
section('Ruf-Tempo: die Rangleiter von 02b werden durch die Antworten nicht verkürzt (tools/sim-ruf.js --reise-funk 1)', () => {
  const { spawnSync } = require('child_process');
  const mess = (funk) => {
    const r = spawnSync(process.execPath, [path.join(__dirname, 'sim-ruf.js'), '--reise', '--reise-funk', String(funk), '--posten', '0,4', '--seeds', '3000', '--json'], { encoding: 'utf8', maxBuffer: 1 << 26 });
    return r.status === 0 ? JSON.parse(r.stdout).ergebnis : null;
  };
  const ohne = mess(0), mit = mess(1);   // mit: die Crew antwortet auf JEDES Angebot mit der Option, die Rom am meisten gibt (ungünstigster Fall)
  ok(!!ohne && !!mit, 'Messung läuft (3000 Läufe je Zeile)');
  if (ohne && mit) for (let i = 0; i < ohne.length; i++) for (const rang of ['centurio', 'tribun', 'legat']) {
    const a = ohne[i].raenge[rang].median, b = mit[i].raenge[rang].median;
    ok(b >= a * 0.97, `Posten ${ohne[i].postenJe80}/80, ${rang}: Median ${a} Sprünge ohne, ${b} mit Antworten (${((b / a - 1) * 100).toFixed(1)} %, höchstens 3 % früher)`);
  }
  if (ohne && mit) ok(mit[0].reiseRufJe100 <= ohne[0].reiseRufJe100 * 1.05 + 0.1, `Ruf aus Reise-Ereignissen je 100 Sprünge: ${ohne[0].reiseRufJe100.toFixed(2)} ohne, ${mit[0].reiseRufJe100.toFixed(2)} mit Antworten (Angebote ${mit[0].angeboteJe100.toFixed(1)}, beantwortet ${mit[0].antwortenJe100.toFixed(1)} je 100 Sprünge)`);
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------
section('Textstelle: Beschriftung nur Katalog (Daten), Reaktion aus dem Pool mit Rückfall auf den Katalogtext', () => {
  const ev = { id: 'patrouille_rom_gruss', nr: 1, hex: HEX.rom, textIdx: 0 };
  const REAK = 'Wie ihr wollt. Wir behalten euch im Auge.';
  ok(FA.textFuer(ev, 'antwort', 'kennung').text === 'Kennung bestätigt, danke.' && FA.textFuer(ev, 'antwort', 'kennung').von === 'Lerche', 'antwort: Katalogtext, Sprecher ist das Schiff');
  ok(FA.textFuer(ev, 'reaktion', 'kennung').text === 'Verstanden, Lerche. Gute Fahrt.' && FA.textFuer(ev, 'reaktion', 'kennung').von === 'Römische Streife', 'reaktion: Katalogtext, Sprecher des Eintrags');
  ok(FA.textFuer(ev, 'dank', 'kennung') === null && FA.textFuer(ev, 'antwort', 'gibt_es_nicht') === null && FA.textFuer({ id: 'x' }, 'antwort', 'a') === null && FA.textFuer(null, 'antwort', 'a') === null, 'unbekannter Slot, Option oder Eintrag: null');
  const aufrufe = [];
  FA.setzePool((art, id, slot, optionId) => { aufrufe.push([art, id, slot, optionId]); return slot === 'antwort' ? 'Pool-Antwort ' + optionId : 'Pool-Reaktion ' + optionId; });
  try {
    ok(FA.textFuer(ev, 'antwort', 'saum').text === 'Wir fliegen für den Saum.', 'mit Pool: die Beschriftung bleibt der Katalogtext (Text und Folge gehören zusammen)');
    ok(FA.textFuer(ev, 'reaktion', 'saum').text === 'Pool-Reaktion saum', 'mit Pool: die Reaktion kommt aus dem Pool');
    ok(aufrufe.length === 1 && JSON.stringify(aufrufe[0]) === JSON.stringify(['patrouille', 'patrouille_rom_gruss', 'reaktion', 'saum']), 'der Pool wird nur für den Slot reaktion gefragt, nie für antwort');
    const RMAX = require('../server/sim/texte-pruefer.js').WERTE.slots.reaktion.max;
    FA.setzePool(() => 'x'.repeat(RMAX));
    ok(FA.textFuer(ev, 'reaktion', 'saum').text === 'x'.repeat(RMAX), `S2: ein Pooltext mit genau der Prüfer-Obergrenze (${RMAX} Zeichen, texte-werte.json) wird übernommen, nicht still verworfen`);
    FA.setzePool(() => 'x'.repeat(RMAX + 1));
    ok(FA.textFuer(ev, 'reaktion', 'saum').text === REAK, 'ein Pooltext über der Obergrenze: Katalogtext');
    FA.setzePool(() => { throw new Error('Pool kaputt'); });
    ok(FA.textFuer(ev, 'reaktion', 'saum').text === REAK, 'Pool wirft: Katalogtext');
    FA.setzePool(() => null);
    ok(FA.textFuer(ev, 'reaktion', 'saum').text === REAK, 'Pool liefert nichts: Katalogtext');
    FA.setzePool(() => '   ');
    ok(FA.textFuer(ev, 'reaktion', 'saum').text === REAK, 'leerer Text: Katalogtext');
    const t = spiel({ names: ['Quirin'] }); const g = t.g;
    FA.setzePool(() => 'Quirin sagt Danke');
    ok(FA.textFuer(ev, 'reaktion', 'saum', g).text === REAK, 'enthält der Pooltext einen Spielernamen: Katalogtext');
    FA.setzePool((art, id, slot) => (slot === 'antwort' ? 'Alles klar, Streife.' : 'Weiterfliegen, Lerche.'));
    ereignis(g, 'patrouille_rom_gruss', HEX.rom);
    ok(offen(g).optionen.map((o) => o.text).join('|') === 'Kennung bestätigt, danke.|Wir fliegen für den Saum.', 'das Angebot zeigt die Katalogtexte (nie Pooltexte)');
    FA.beantworten(g, 'saum', offen(g).lfd); lauf(g, W.antwort_reaktion_s + 1);
    const f = funkTexte(t);
    ok(f.includes('Wir fliegen für den Saum.') && f.includes('Weiterfliegen, Lerche.') && !f.includes('Alles klar, Streife.'), 'Antwort = Katalogtext der Option, Reaktion aus dem Pool');
  } finally { FA.setzePool(null); }
  ok(FA.textFuer(ev, 'reaktion', 'saum').text === REAK, 'ohne Pool wieder der Katalogtext');
  // M1: gesendet wird, was im Angebot stand (nie ein neu gezogener Text)
  const tm = spiel(); const gm = tm.g;
  ereignis(gm, 'patrouille_rom_gruss', HEX.rom);
  const angebot = offen(gm); angebot.optionen.find((o) => o.id === 'kennung').text = 'Angezeigte Zeile';
  FA.beantworten(gm, 'kennung', angebot.lfd);
  ok(funkTexte(tm).includes('Angezeigte Zeile') && JSON.stringify(ws(gm).chronik || []).includes('Funkantwort an Römische Streife: Angezeigte Zeile'), 'Funk und Chronik tragen genau den Text des Angebots');
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------
section('Schalter aus = nichts; ohne Modus = nichts', () => {
  const t = spiel({ env: { REISE_EREIGNISSE: '0' } }); const g = t.g; ohneFlotten(g);
  const evt = { id: 'funk_handel_stimmen', nr: 1, hex: HEX.rom, textIdx: 0 };
  ok(FA.anbieten(g, evt) === null && !offen(g), 'Schalter aus: kein Angebot');
  const t2 = spiel(); const g2 = t2.g; ohneFlotten(g2);
  FA.anbieten(g2, evt); ok(!!offen(g2), 'Schalter an: Angebot');
  g2.env = { REISE_EREIGNISSE: '0' };   // Schalter fällt: nichts mehr (Befehl und Anzeige)
  ok(FA.beantworten(g2, 'rom').code === 'kein_angebot' && FA.snapshot(g2) === null && FA.schluessel(g2) === null, 'Schalter aus: kein Befehl, kein Snapshot-Block');
  g2.env = ENV;
  const t3 = spiel({ env: {} }); const g3 = t3.g;
  ok(RE.aktiv(g3) === false && FA.anbieten(g3, evt) === null, 'ohne Env (Standard aus): kein Angebot');
  const lang = spiel({ env: { REISE_EREIGNISSE: '0' } }); sicher(() => { for (let i = 0; i < 60; i++) springe(lang.g, [HEX.rom, HEX.rom2][i % 2]); }, 1);
  ok(!ws(lang.g).funkwahl || (!ws(lang.g).funkwahl.offen && ws(lang.g).funkwahl.lfd === 0), 'Schalter aus über 60 Sprünge: nie ein Angebot, nie ein Zähler');
  // ohne Modus (Kampagne)
  const kein = { weltsim: null, env: ENV, emit() {} };
  ok(FA.anbieten(kein, evt) === null && FA.beantworten(kein, 'rom').code === 'modus' && FA.snapshot(kein) === null && FA.schluessel(kein) === null && FA.nachSprung(kein) === undefined && FA.update(kein) === undefined, 'ohne Modus Freie Fahrt Sund: nichts, Befehl wird mit „modus“ abgelehnt');
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------
section('Sim-Zustand und Ereignisring byte-gleich mit und ohne Funk-Antworten', () => {
  const reihe = (g, wie) => {
    const hexe = ['0305', '0304', '0204', '0305', '0105', '0203', '0305', '0405', '0305', '0304'];
    for (let r = 0; r < 10; r++) for (const h of hexe) {
      sicher(() => springe(g, h), 0.3);
      if (wie === 'antworten') { const o = offen(g); if (o) FA.beantworten(g, o.optionen[0].id, o.lfd); }
      if (wie === 'ignorieren') { const o = offen(g); if (o) FA.beantworten(g, FA.IGNORIEREN, o.lfd); }
    }
  };
  // Sim-Zustand, Ereignisring und Tick; mitReise: dazu die Entscheidungsdaten der Reise-Ereignisse (ohne den Deckel-Log rufLog, der gehört zur Ruf-Buchung). Hinweis: ein beantworteter Ruf kann den RANG ändern, und der Rang
  // steuert (wie in SUND-03 D) die Kandidaten der Reise-Ereignisse (rang_min); deshalb gilt die Gleichheit der Entscheidungsdaten nur für unbeantwortet und ignoriert.
  const stand = (g, mitReise) => JSON.stringify({ z: abbild(g), e: ws(g).ereignisse, t: ws(g).tickZahl, k: ws(g).wirkungenVerworfen, r: mitReise ? { n: ws(g).reise.n, l: ws(g).reise.letzter, h: ws(g).reise.letzte } : 0 });
  const zaehle = (g) => ws(g).chronik.filter((c) => c.art === 'reise').length;
  const lauf1 = (wie, ohneDaten) => {
    const kopien = [];
    if (ohneDaten) for (const e of KAT) if (e.antworten) { kopien.push([e, e.antworten]); delete e.antworten; }
    const deckel = W.ruf_max_je_100, romDeckel = W.antwort_rom_max_je_100; W.ruf_max_je_100 = 1000; W.antwort_rom_max_je_100 = 1000;   // der Deckel verdeckt sonst, ob die Antwort etwas ändert (eigener Test: Deckel)
    try { const t = spiel({ seed: 33 }); reihe(t.g, wie); return { g: t.g, s: stand(t.g), sr: stand(t.g, true), angebote: ws(t.g).funkwahl ? ws(t.g).funkwahl.lfd : 0 }; } finally { W.ruf_max_je_100 = deckel; W.antwort_rom_max_je_100 = romDeckel; for (const [e, a] of kopien) e.antworten = a; }
  };
  const ohne = lauf1('nichts', true), mitNichts = lauf1('nichts', false), mitAntw = lauf1('antworten', false), mitIgn = lauf1('ignorieren', false);
  ok(ohne.angebote === 0 && mitNichts.angebote >= 3, `Ausgangslage: ohne die Daten kein Angebot, mit den Daten ${mitNichts.angebote} Angebote in 100 Sprüngen (${zaehle(mitNichts.g)} Ereignisse)`);
  ok(ohne.sr === mitNichts.sr && ohne.s === mitNichts.s, 'Sim-Zustand, Ereignisring, Zähler und Wiederholungsdaten byte-gleich mit Angeboten (unbeantwortet) und ohne');
  ok(ohne.sr === mitIgn.sr, 'auch wenn die Crew alles ignoriert: byte-gleich (einschließlich der Entscheidungsdaten der Reise-Ereignisse)');
  ok(ohne.s === mitAntw.s, 'auch wenn die Crew jedes Angebot beantwortet: Sim-Zustand, Ereignisring und Tick byte-gleich');
  ok(JSON.stringify(ws(ohne.g).ruf) === JSON.stringify(ws(mitNichts.g).ruf) && JSON.stringify(ws(ohne.g).ruf) === JSON.stringify(ws(mitIgn.g).ruf), 'unbeantwortet und ignoriert: auch der Ruf ist gleich');
  ok(JSON.stringify(ws(ohne.g).ruf) !== JSON.stringify(ws(mitAntw.g).ruf) && ws(mitAntw.g).ruf.kon + ws(mitAntw.g).ruf.rom > ws(ohne.g).ruf.kon + ws(ohne.g).ruf.rom - 3, 'beantwortet: nur der Ruf ändert sich (' + JSON.stringify(ws(mitAntw.g).ruf) + ' statt ' + JSON.stringify(ws(ohne.g).ruf) + ')');
  ok(ws(mitAntw.g).chronik.length >= ws(ohne.g).chronik.length, 'die Antworten stehen in der Chronik (nur dort zusätzlich)');
  // eine Antwort verändert den Zufallsstrom der Ereignisse nie: dieselbe Entscheidung danach
  const weiter = (g) => { const out = []; for (let i = 0; i < 300; i++) { RE.zaehleSprung(g); const e = RE.entscheiden(g, [HEX.rom, HEX.rom2, '0204', '0105'][i % 4]); if (e) out.push(e.id + '@' + e.nr); } return out.join(); };
  const x1 = spiel({ seed: 5 }).g, x2 = spiel({ seed: 5 }).g;
  ereignis(x1, 'funk_handel_stimmen', HEX.rom); ereignis(x2, 'funk_handel_stimmen', HEX.rom);
  FA.beantworten(x1, 'rom', offen(x1).lfd);
  ok(weiter(x1) === weiter(x2) && weiter(x1).length > 0, 'dieselbe Ereignisreihe mit und ohne Antwort (der Strom hängt nur von Seed und Sprungzähler ab)');
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------
section('Weltstand: nichts gespeichert (Version 3, byte-gleich lesbar für main)', () => {
  const t = spiel(); const g = t.g; ohneFlotten(g);
  ereignis(g, 'patrouille_rom_gruss', HEX.rom);
  ok(!!offen(g), 'Ausgangslage: ein Angebot ist offen');
  const d1 = klon(Weltstand.capture(g));
  ok(d1.version === 3 && !JSON.stringify(d1).includes('funkwahl') && !JSON.stringify(d1).includes('antwort'), 'Weltstand Version 3 enthält weder das Angebot noch einen Schalter');
  ok(Weltstand.validate(d1).length === 0, 'schemagültig');
  FA.beantworten(g, 'kennung', offen(g).lfd);
  const d2 = klon(Weltstand.capture(g));
  const ohne = (d) => { const c = klon(d); delete c.welt.sim.ruf; delete c.welt.sim.chronik; if (c.welt.sim.reise) delete c.welt.sim.reise.r; return JSON.stringify(c.welt.sim); };
  ok(ohne(d1) === ohne(d2), 'nach der Antwort ändern sich nur Ruf, Chronik und der Deckel im Weltstand (Blöcke, die es in 03a schon gibt)');
  ok(!!d2.welt.sim.ruf && d2.welt.sim.ruf.rom === 1 + QUELLEN.funk_rom_gruss.delta, 'der Ruf aus der Antwort steht im bestehenden Block welt.sim.ruf');
  const dir = F.freshDir(); d1.id = 'w-funk'; fs.writeFileSync(path.join(dir, 'w-funk.json'), JSON.stringify(d1));
  const g2 = spiel({ dir, world: 'w-funk' }).g;
  ok(g2.phase === 'play' && g2.errors === 0 && !offen(g2) && FA.snapshot(g2) === null, 'Laden: das Spiel läuft, ein offenes Angebot geht verloren (ausdrücklich in Ordnung)');
  ok(RE.lesen({ n: 5, funkwahl: { offen: { id: 'x' } }, antworten: 5 }).n === 5 && !('funkwahl' in RE.lesen({ n: 5, funkwahl: 1 })), 'der Leser der Reise-Ereignisse kennt keinen Funk-Block (Müll bleibt draußen)');
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------
section('Snapshot world.funkwahl: nur bei Änderung, Löschsignal, Größe', () => {
  const t = spiel({ crew: 3 }); const g = t.g; ohneFlotten(g);
  // die ersten Snapshots tragen die großen seltenen Teile (world): der Block kommt mit dem ersten kleinen Snapshot danach
  const block = () => { for (let i = 0; i < 6; i++) { const w = g.snapshot().world || {}; if ('funkwahl' in w) return { da: true, b: w.funkwahl }; } return { da: false }; };
  for (let i = 0; i < 6; i++) g.snapshot();
  ok(!block().da, 'ohne Angebot: kein Block (kein Mehrverbrauch im Snapshot)');
  ereignis(g, 'funk_handel_stimmen', HEX.rom);
  const s1 = block();
  const b = s1.b;
  ok(b && b.nr === offen(g).lfd && b.optionen.length >= 2 && b.optionen.length <= 3 && b.ignorieren === W.ignorieren_text && b.rest === W.antwort_gilt_spruenge && typeof b.von === 'string', 'Block { nr, von, optionen, ignorieren, rest } beim Entstehen');
  ok(b.optionen.every((o) => Object.keys(o).sort().join() === 'id,text'), 'Optionen nur mit id und text (keine Folgen im Netz: der Server entscheidet)');
  ok(!block().da, 'unverändert: nicht noch einmal gesendet');
  ws(g).reise.n += 1;   // ein Sprung ohne Ereignis: das Angebot gilt noch, aber die Restzeit hat sich geändert
  const rest1 = block();
  ok(rest1.da && rest1.b && rest1.b.nr === b.nr && rest1.b.rest === W.antwort_gilt_spruenge - 1, 'der Verfall zählt mit: nach einem Sprung kommt der Block mit der neuen Restzeit');
  g.sentFunkKey = null;
  const neuerClient = block();
  ok(neuerClient.da && neuerClient.b && neuerClient.b.nr === b.nr, 'nach dem Zurücksetzen des Schlüssels (neuer Client, welcome): wieder gesendet');
  FA.beantworten(g, offen(g).optionen[0].id, offen(g).lfd);
  const s3 = block();
  ok(s3.da && s3.b === null, 'nach der Antwort: Löschsignal null');
  ok(!block().da, 'danach wieder nichts (das Löschsignal kommt genau einmal)');
  const kb = Buffer.byteLength(JSON.stringify(b));
  ok(kb < 400, `der Block ist klein (${kb} B)`);
  // Verfallen ohne Antwort: ebenfalls Löschsignal
  ereignis(g, 'funk_handel_stimmen', HEX.rom); block();
  ws(g).reise.n += 10; FA.nachSprung(g);
  const vf = block();
  ok(vf.da && vf.b === null, 'Verfall: Löschsignal');
  // Mehrspieler: alle sehen dasselbe (ein Block für alle, nicht je Spieler)
  ok(JSON.stringify(b) === JSON.stringify(klon(b)), 'ein Block für alle Spieler (nur der Server schreibt)');
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------
section('Befehl und Leser müllfest', () => {
  const t = spiel({ crew: 2 }); const g = t.g; ohneFlotten(g);
  const sendeMuell = (m) => { try { g.handleMessage(t.cs[0], Object.assign({ t: 'cmd', c: 'funk.antworten' }, m)); return true; } catch (e) { return false; } };
  ok([{}, { id: null }, { id: 5 }, { id: { a: 1 } }, { id: [] }, { id: 'a', nr: 'x' }, { id: 'a', nr: {} }, { id: 'x'.repeat(5000) }, { id: '__proto__' }, { id: 'constructor' }].every(sendeMuell), 'Müll als Befehl ohne Angebot: nie eine Ausnahme');
  ereignis(g, 'patrouille_rom_gruss', HEX.rom); const lfd = offen(g).lfd;
  ok([{}, { id: null }, { id: 5 }, { id: { a: 1 } }, { id: [] }, { id: 'a', nr: 'x' }, { id: '__proto__' }, { id: 'constructor' }, { id: 'toString' }].every(sendeMuell) && !!offen(g) && rom(g) === 1, 'Müll als Befehl mit Angebot: keine Ausnahme, keine Folge, das Angebot bleibt');
  const fehlerN = g.errors;
  const antw = t.cs[0].inbox.filter((m) => m.kind === 'funkAntwort');
  ok(antw.length >= 9 && antw.every((m) => m.ok === false && typeof m.text === 'string' && m.text.length > 3) && g.errors === fehlerN, 'jede Weigerung antwortet dem Absender mit Code und Text');
  // ausgeschaltete Spieler antworten nicht
  const aus = t.cs[1]; const pAus = g.players.find((p) => p.conn === aus || (p.conn && p.conn.inbox === aus.inbox));
  if (pAus) { pAus.downed = true; const ante = aus.inbox.filter((m) => m.kind === 'funkAntwort').length; g.handleMessage(aus, { t: 'cmd', c: 'funk.antworten', id: 'kennung', nr: lfd }); const nach = aus.inbox.filter((m) => m.kind === 'funkAntwort'); ok(!!offen(g) && rom(g) === 1 && nach.length === ante + 1 && nach[nach.length - 1].ok === false && nach[nach.length - 1].code === 'am_boden' && nach[nach.length - 1].text === W.weigerung.am_boden, 'K4: ein ausgeschalteter Spieler (downed) bekommt eine Weigerung mit Code statt Schweigen: keine Folge, kein Funk'); pAus.downed = false; } else ok(false, 'Fixture: Spieler zum Client nicht gefunden');
  // gefälschte Nachrichten: kein Spielerzustand nötig, nur Server schreibt
  ok(Protocol.CMD_FUNK_ANTWORT === 'funk.antworten' && FA.beantworten(g, undefined).code === 'unbekannt', 'beantworten(undefined): unbekannt');
  // Client-Leser (public/js/funkwahl.js)
  const FW = require('../public/js/funkwahl.js');
  ok(FW.modellAus(null) === null && FW.modellAus('x') === null && FW.modellAus([]) === null && FW.modellAus({}) === null && FW.modellAus({ nr: 1, optionen: 5 }) === null, 'Client: Müll = keine Anzeige');
  ok(FW.modellAus({ nr: 1, optionen: [{ id: 'a', text: 'A' }] }) === null && FW.modellAus({ nr: 1, optionen: [{ id: 'a', text: 'A' }, { id: 'b' }] }) === null, 'Client: weniger als zwei Optionen ist keine Wahl, nichts anzeigen');
  const m = FW.modellAus({ nr: 3.7, von: 'X'.repeat(200), optionen: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }, { id: 'd', text: 'D' }, null], ignorieren: 5, rest: -4 });
  ok(m && m.nr === 3 && m.optionen.length === 3 && m.von.length === 40 && m.ignorieren === '' && m.rest === 0, 'Client: höchstens 3 Optionen, Längen und Zahlen geklemmt, kein Platzhalter');
  FW.lesen({ t: 'snap', world: { funkwahl: { nr: 1, von: 'S', optionen: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], ignorieren: 'Nicht antworten', rest: 2 } } });
  ok(FW.offen() && FW.zeilen(FW.modell()).length === 3, 'Client: Block lesen, Zeilen = Optionen + Nicht antworten');
  const gesendet = [];
  ok(FW.antworten((x) => gesendet.push(x), 'b') && gesendet[0].c === 'funk.antworten' && gesendet[0].id === 'b' && gesendet[0].nr === 1 && !FW.antworten((x) => gesendet.push(x), 'zzz') && !FW.antworten(null, 'a'), 'Client: sendet funk.antworten { id, nr }, unbekannte Id nie');
  ok(FW.markieren() === 0 && FW.markieren() === 1 && FW.markieren() === 2 && FW.markieren() === 0, 'Client: Taste markiert die nächste Zeile im Kreis');
  FW.markieren(); FW.senden((x) => gesendet.push(x));
  ok(gesendet[1] && gesendet[1].id === 'b', 'Client: Umschalt+Punkt sendet die markierte Zeile');
  FW.spaeter(true); ok(FW.store.eingeklappt && !FW.senden((x) => gesendet.push(x)) && FW.markieren() === 1 && !FW.store.eingeklappt, 'Client: Später klappt zu, die Taste klappt erst auf');
  FW.spaeter(true); FW.markieren();
  FW.spaeter(true);
  ok(FW.store.eingeklappt, 'Client: Später gilt für das gezeigte Angebot');
  FW.lesen({ t: 'snap', world: { funkwahl: { nr: 2, von: 'S', optionen: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], ignorieren: 'x', rest: 1 } } });
  ok(FW.store.markiert === -1 && !FW.store.eingeklappt, 'Client: ein anderes Angebot übernimmt weder Markierung noch Später');
  FW.lesen({ t: 'snap', world: { funkwahl: null } }); ok(!FW.offen(), 'Client: null = Löschsignal');
  FW.lesen({ t: 'snap', world: { funkwahl: { nr: 4, optionen: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] } } }); FW.lesen({ t: 'welcome' }); ok(!FW.offen(), 'Client: welcome leert');
  FW.lesen({ t: 'snap', world: { funkwahl: { nr: 4, optionen: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] } } }); FW.lesen({ t: 'snap', phase: 'lobby' }); ok(!FW.offen(), 'Client: Lobby leert');
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------
section('Tasten: freie Taste, keine Belegung überschrieben', () => {
  const vm = require('vm');
  const win = { localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'tasten.js'), 'utf8'), { window: win, console }, { filename: 'tasten.js' });
  const T = win.Tasten;
  const w = T.AKTIONEN.find((a) => a.id === 'allgemein.funkWaehlen'), s = T.AKTIONEN.find((a) => a.id === 'allgemein.funkSenden');
  ok(w && s && w.std.join() === 'Period' && s.std.join() === 'Shift+Period', 'Aktionen allgemein.funkWaehlen (Punkt) und allgemein.funkSenden (Umschalt+Punkt)');
  const andere = T.AKTIONEN.filter((a) => a !== w && a !== s);
  ok(andere.every((a) => !a.std.includes('Period') && !a.std.includes('Shift+Period')), 'Punkt war nirgends belegt (keine bestehende Taste überschrieben)');
  ok(T.konflikte && ['steuer', 'ops', 'technik', 'captain', 'terminal', 'allgemein'].every((gr) => T.konflikte(gr).length === 0), 'keine Doppelbelegung in keiner Gruppe');
});

console.log(`\n${n - fails} von ${n} Prüfungen bestanden.`);
process.exit(fails ? 1 : 0);
