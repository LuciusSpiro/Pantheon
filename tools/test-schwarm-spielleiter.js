'use strict';
// MON-03 D: Spielleiter-Anbindung des Schwarms. Umsetzung stellung_nehmen/kreaturen_in_hoehle mit dem Parameter `typ` (rudeltier | schwarm), rein aus Daten (Katalog, `abgeleitet`).
// Geprüft: (a) Katalog: Umsetzung verfügbar, `typ` Pflichtparameter mit genau den zwei Werten, beide Typen bestehen den Regiebuch-Prüfer, ein ungültiger `typ` wird abgelehnt, rudeltier-Fragment
//   bleibt unverändert (Gegenprobe: Handvergleich); (b) Spielleiter-Prüfer: Plan mit typ schwarm und mit rudeltier besteht (aufloesen, Szenenantwort, vollständiges Buch), Gegenproben
//   (ungültiger typ, Kartenart wildnis/station, fehlender typ); (c) Prompt-Text nennt beide Werte und beide Beschreibungen gleichwertig, Pflichtsatz der Höhle führt nest, kein Spielername;
//   (d) Headless: die Szene baut in einer echten Höhle am Nest die Königin (schwarm) bzw. ein Rudel (rudeltier), Bedingung „erledigt“ erst mit endgültig erledigter Königin;
//   (e) kein Typname im Servercode (server/, shared/), die Datentypen stehen in kreaturen.json.
//   node tools/test-schwarm-spielleiter.js   (npm run test:schwarm-spielleiter)
const fs = require('fs');
const path = require('path');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const combat = require('../server/sim/combat.js');
const Kreatur = require('../server/sim/kreatur.js');
const KREATUREN = require('../content/kampf/kreaturen.json');
const Registry = require('../server/mission/registry.js');
const Katalog = require('../server/mission/katalog.js');
const Checker = require('../server/mission/checker.js');
const Context = require('../server/mission/context.js');
const SB = require('../server/mission/szenenbau.js');
const Spielleiter = require('../server/mission/spielleiter.js');
const H = require('./gel02-hilfen.js');

const DT = 1 / CONFIG.tickHz;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (name, body) => {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
};
const kopie = (o) => JSON.parse(JSON.stringify(o));

const MOL = 'stellung_nehmen', UMS = 'kreaturen_in_hoehle';
const KAT = Katalog.load({});
const umsetzung = (kat) => kat.molekuele[MOL].umsetzungen.find((x) => x.id === UMS);
const U = umsetzung(KAT);
const frag = (typ, extra) => Katalog.instantiate(U, Object.assign({ loc: 'kesh', map: 'kesh.hoehle-1' }, typ ? { typ } : {}, extra || {}), 's1', 'test_ende');
const pruefer = (f) => Checker.check(Katalog.testRegiebuch(f, MOL, U));

// ---------- (a) Katalog ----------
section('Katalog: Umsetzung, Parameter typ, Prüfer', () => {
  ok(!!U && U.status === 'verfuegbar', 'Umsetzung ' + MOL + '/' + UMS + ' ist verfügbar (' + (U && U.status) + ')');
  const P = U.params.typ;
  ok(P && P.typ === 'text' && P.pflicht === true && JSON.stringify(P.werte) === JSON.stringify(['rudeltier', 'schwarm']), 'Parameter typ: Pflicht, Werte genau rudeltier und schwarm');
  ok(!('default' in P), 'kein Standardwert: keiner der beiden Typen ist bevorzugt');
  ok(U.buehne_braucht.kartenarten.join() === 'hoehle' && U.buehne_braucht.anker.includes('nest'), 'Bühne: nur Höhle, Anker nest (die Höhle legt ihn immer an)');
  for (const typ of ['rudeltier', 'schwarm']) {
    const { frag: f, errs } = frag(typ);
    const r = pruefer(f);
    ok(!errs.length && r.errors.length === 0, typ + ': Fragment besteht den Regiebuch-Prüfer (' + errs.concat(r.errors.map((e) => e.code + ' ' + e.msg)).join(' | ') + ')');
    ok(!/\{\{(?!lex\.)/.test(JSON.stringify(f)), typ + ': alle Platzhalter außer dem Lexikon aufgelöst');
  }
  const bad = frag('wolfsrudel');
  ok(bad.errs.length === 1 && /typ/.test(bad.errs[0]) && /rudeltier/.test(bad.errs[0]), 'ungültiger typ wird abgelehnt (' + bad.errs.join('|') + ')');
  ok(frag(null).errs.some((e) => /typ.*fehlt/.test(e)), 'fehlender typ wird abgelehnt (Pflicht)');
  // Gegenprobe rudeltier: dieselbe Aktion wie von Hand geschrieben
  const rd = frag('rudeltier').frag.steps[0].enter[0];
  ok(JSON.stringify(rd) === JSON.stringify({ if: { not: { v: 's1_besetzt' } }, do: 'kreatur_besetzen', map: 'kesh.hoehle-1', typ: 'rudeltier', anzahl: 3, gruppe: 's1_k' }), 'rudeltier: kreatur_besetzen, 3 Tiere, Gruppe der Szene');
  const sw = frag('schwarm').frag.steps[0];
  ok(JSON.stringify(sw.enter[0]) === JSON.stringify({ if: { not: { v: 's1_besetzt' } }, do: 'nest_besetzen', map: 'kesh.hoehle-1', typ: 'koenigin', gruppe: 's1_k' }), 'schwarm: nest_besetzen mit der Königin');
  const chk = sw.rules[0].if.all[0].check;
  ok(chk.name === 'kreaturen_erledigt' && chk.typ === 'koenigin' && !('gruppe' in chk), 'schwarm: erledigt = kreaturen_erledigt { typ: Königin }, nicht die Gruppe');
  const chkR = frag('rudeltier').frag.steps[0].rules[0].if.all[0].check;
  ok(chkR.name === 'kreaturen_erledigt' && chkR.gruppe === 's1_k' && !('typ' in chkR), 'rudeltier: erledigt = Gruppe der Szene');
  // Datentypen stehen in kreaturen.json
  ok(KREATUREN.typen[rd.typ] && KREATUREN.typen[sw.enter[0].typ] && Kreatur.pruefen(KREATUREN).length === 0, 'beide Typen der Aktionen stehen in kreaturen.json');
  ok(KREATUREN.typen.schwarmling.bausteine.bindung.quelle.typ === sw.enter[0].typ, 'der Schwarm hängt an der Königin, die die Szene anlegt');
  // abgeleitet ist Daten: ein fremder Wert gibt eine eigene Wirkung (kein Name im Code)
  const k2 = kopie(U); k2.params.typ.werte.push('kolonie');
  k2.abgeleitet.typ.kolonie = kopie(k2.abgeleitet.typ.schwarm); k2.abgeleitet.typ.kolonie.besetzen.typ = 'kolonie_koenigin';
  const f2 = Katalog.instantiate(k2, { loc: 'kesh', map: 'm', typ: 'kolonie' }, 's1', 'w');
  ok(!f2.errs.length && f2.frag.steps[0].enter[0].typ === 'kolonie_koenigin', 'neuer Wert nur in den Daten ergänzt: wirkt ohne Codeänderung');
});

// ---------- (b) Spielleiter-Prüfer ----------
const ctx = Context.build({}, {}, KAT);
const plan = (szene) => ({
  format: 'grobplan/2', id: 'sw_test', titel: 'Schwarm-Test', auftraggeber: 'melk', zielspieldauer_min: 12, aufhaenger: 'Ein Testauftrag.',
  szenen: [{ id: 's1_hafen', szenentyp: 'hafen', ort: 'hafen', karte: null, molekuele: [], sachverhalt: 'Auftrag.', wendung: null, dauer_min: 2, weiter: [{ wenn: 'immer', nach: 's2_hoehle' }] },
    Object.assign({ id: 's2_hoehle', szenentyp: 'gefecht', ort: 'kesh', karte: null, sachverhalt: 'Kreaturen in der Höhle.', wendung: null, dauer_min: 6,
      molekuele: [{ id: MOL, umsetzung: UMS }], buehne: { kartenart: 'hoehle', neu: true },
      weiter: [{ wenn: 'gut', nach: 'ausgang:erfolg' }, { wenn: 'schlecht', nach: 'ausgang:abbruch' }] }, szene || {})],
  entscheidungen: [],
  ausgaenge: { erfolg: { wann: 'Die Kreaturen sind erledigt.' }, abbruch: { wann: 'Die Crew bricht ab.' } },
});
const antwort = (typ, extra) => JSON.stringify({ molekuele: [{ id: MOL, umsetzung: UMS, params: Object.assign({ loc: 'kesh', map: 'kesh.hoehle-1' }, typ !== undefined ? { typ } : {}, extra || {}) }], verzweigung: [{ nach: 'ausgang:erfolg', if: { flag: 's2_hoehle_geraeumt' } }, { nach: 'ausgang:abbruch' }], wendung: null });

section('Spielleiter-Prüfer: Plan mit typ schwarm und rudeltier', () => {
  const env = SB.buildEnv(KAT);
  for (const typ of ['schwarm', 'rudeltier']) {
    const g = plan();
    const r = SB.aufloesen(g, env, ctx);
    ok(!r.errors.length, typ + ': Plan mit Szene auf neuer Höhle besteht aufloesen (BUEHNE-ART/-ANKER, LANDEPUNKT) (' + r.errors.join(' | ').slice(0, 200) + ')');
    ok(/^kesh\.hoehle-\d+$/.test(g.szenen[1].landepunkt || ''), typ + ': neuer Höhlen-Landepunkt gesetzt (' + g.szenen[1].landepunkt + ')');
    const e = SB.evaluateScene(g, 's2_hoehle', antwort(typ), env);
    ok(e.gueltig, typ + ': Szenenantwort mit typ ' + typ + ' besteht den Prüfer (' + e.details.join(' | ').slice(0, 200) + ')');
    const b = SB.buildBook(g, { s2_hoehle: { answer: JSON.parse(antwort(typ, { map: undefined })), quelle: 'llm' } }, env, { id: 'sw_buch', kontext: ctx });
    ok(!b.errors.length && b.szenen.s2_hoehle.quelle === 'llm' && !b.szenen.s2_hoehle.fehler.length, typ + ': vollständiges Buch ohne Prüferfehler, Szene aus der Antwort (' + b.errors.map((x) => x.code + ' ' + x.msg).join(' | ').slice(0, 200) + ')');
    const st = (b.book && b.book.steps || []).find((s) => s.id === 's2_hoehle');
    const akt = st && st.enter.find((x) => x && x.do && /besetzen$/.test(x.do));
    ok(akt && akt.map === g.szenen[1].landepunkt && akt.do === (typ === 'schwarm' ? 'nest_besetzen' : 'kreatur_besetzen'), typ + ': das Buch setzt die Karte der Szene ein (' + (akt && akt.do) + ' auf ' + (akt && akt.map) + ')');
  }
  // Gegenproben
  const g0 = plan();
  ok(!SB.evaluateScene(g0, 's2_hoehle', antwort('wolfsrudel'), env).gueltig, 'Gegenprobe: ungültiger typ wird abgelehnt');
  ok(!SB.evaluateScene(g0, 's2_hoehle', antwort(undefined), env).gueltig, 'Gegenprobe: fehlender typ wird abgelehnt');
  ok(!SB.evaluateScene(g0, 's2_hoehle', antwort('schwarm', { anzahl: 5 }), env).gueltig, 'Gegenprobe: unbekannter Parameter wird abgelehnt');
  for (const art of ['wildnis', 'station']) {
    const g = plan({ buehne: { kartenart: art, neu: true } });
    const r = SB.aufloesen(g, env, ctx);
    ok(r.errors.some((x) => /^BUEHNE-ART/.test(x) || /^LANDEPUNKT/.test(x)), 'Gegenprobe: Umsetzung auf Kartenart ' + art + ' wird abgelehnt (' + r.errors.join(' | ').slice(0, 120) + ')');
  }
  // Prüfer der Aktionen: ein Typ, den es nicht gibt, fällt im Regiebuch auf (kreaturen_erledigt prüft typ gegen kreaturen.json)
  const k3 = kopie(KAT); const u3 = umsetzung(k3); u3.abgeleitet.typ.schwarm.erledigt.typ = 'koenigsmutter';
  const f3 = Katalog.instantiate(u3, { loc: 'kesh', map: 'kesh.hoehle-1', typ: 'schwarm' }, 's1', 'w');
  ok(Checker.check(Katalog.testRegiebuch(f3.frag, MOL, u3)).errors.some((e) => /koenigsmutter/.test(e.msg)), 'Gegenprobe: unbekannter Königin-Typ in der Bedingung fällt im Prüfer auf');
});

// ---------- (c) Prompt-Text, Pflichtsatz, Lexikon ----------
section('Prompt: beide Typen gleichwertig, Pflichtsatz, Lexikon', () => {
  const voll = Katalog.fuerSpielleiter(KAT, 'voll');
  const kurz = Katalog.fuerSpielleiter(KAT, 'kurz');
  ok(/typ\*:text\(rudeltier\|schwarm\)/.test(voll), 'Katalog-Text (voll) nennt typ als Pflicht mit beiden Werten');
  ok(/rudeltier:/.test(U.beschreibung) && /schwarm:/.test(U.beschreibung) && U.beschreibung.length <= 500, 'Beschreibung nennt beide Typen (Länge ' + U.beschreibung.length + ')');
  ok(/Königin/.test(U.beschreibung) && /Nest/.test(U.beschreibung) && /Abbaulärm/.test(U.beschreibung) && /Schwarm/.test(U.beschreibung), 'Schwarm sachlich beschrieben: viele kleine Wesen, Königin am Nest, Abbaulärm lockt, Königin beseitigen löst auf');
  const teile = U.beschreibung.split('schwarm:');
  ok(Math.abs(teile[0].length - teile[1].length) < 200, 'beide Typen etwa gleich ausführlich');
  ok(/gleichwertig/.test(U.beschreibung), 'Beschreibung verlangt gleichwertiges Anbieten');
  ok(kurz.includes(UMS), 'Umsetzung steht im Kurzkatalog des Grobplans');
  ok(!/Spieler|Kai\b/.test(JSON.stringify(U)), 'keine Spielernamen in der Umsetzung');
  ok(ctx.kartenarten.find((x) => x.id === 'hoehle').pflichtsatz.nest === 1, 'Pflichtsatz der Höhle im Kontext führt nest: 1');
  const Lex = require('../server/mission/lexikon.js');
  for (const bw of ['germanen', 'rom', 'vorlaeufer']) {
    const t = Lex.aufloesen ? Lex.aufloesen('{{lex.nest:am}}', bw) : null;
    ok(t === null || (t && /^am nest$/i.test(t.text || t)), 'Lexikon ' + bw + ': nest -> am Nest (' + JSON.stringify(t) + ')');
  }
  const f = frag('schwarm').frag;
  ok(/Königin/.test(JSON.stringify(f.texte)) && /\{\{lex\.nest:am\}\}/.test(JSON.stringify(U.abgeleitet)), 'Szenentext des Schwarms nutzt das Lexikon (nest)');
  void Spielleiter;
});

// ---------- (d) Headless: die Szene in einer echten Höhle ----------
function hoehle(seed) {
  const s = H.neuesSpiel(1, { art: 'hoehle', seed, groesse: 'mittel' });
  const g = s.g, p = g.players[0];
  g.away.drones = []; combat.ensureV2(g, g.away, s.map); g.away.kreaturen = [];
  g.god = true;
  const S = { g, k: s.k, map: s.map, p, aw: g.away, fehler: [], me: [] };
  g.countError = (w, e) => { S.fehler.push(w + ': ' + (e && e.message)); };
  const m0 = g.missionEvent.bind(g); g.missionEvent = (nm, d) => { S.me.push({ nm, d }); return m0(nm, d); };
  return S;
}
const schritte = (S, sek) => { for (let i = 0, N = Math.round(sek / DT); i < N; i++) S.g.step(); };
const hinten = (S, K) => {
  K.facing = 0;
  const x = K.x - 100, y = K.y;
  const wirk = { waffe: 'blaster', schaden: 1, art: 'direkt', x, y, quelle: { id: S.p.id, pid: S.p.id, team: 'crew', x, y } };
  for (let i = 0; i < 60 && K.alive; i++) combat.hitEnemy(S.g, K, 1, { x, y, pid: S.p.id, wirkung: wirk });
};
// Aktion und Bedingung wie die Szene sie im Regiebuch trägt (aus dem instanziierten Fragment), ausgeführt auf der echten Karte
function szeneAufKarte(S, typ) {
  const f = Katalog.instantiate(U, { loc: 'kesh', map: S.map, typ }, 'sz', 'weiter').frag;
  const st = f.steps[0];
  const { if: _w, ...aktion } = st.enter[0];
  const check = st.rules[0].if.all[0].check;
  const { name, ...args } = check;
  return { aktion, erledigt: () => !!Registry.get(name).test(S.g.mission, args), ziel: st.objectives[1].text, texte: f.texte };
}
section('Headless: Szene typ schwarm in einer echten Höhle', () => {
  const S = hoehle(31);
  const sz = szeneAufKarte(S, 'schwarm');
  const nest = S.k.anker.find((a) => a.rolle === 'nest');
  ok(!!nest, 'die Höhle hat den Anker nest');
  ok(!sz.erledigt(), 'vor dem Besetzen nicht erledigt (nie erschienen)');
  S.g.mission.act(sz.aktion);
  const Q = S.aw.kreaturen.filter((K) => K.typ === 'koenigin');
  ok(Q.length === 1 && S.fehler.length === 0, 'genau eine Königin angelegt, kein Fehler (' + S.fehler.join('|') + ')');
  ok(Q[0] && Math.hypot(Q[0].x / 32 - nest.x, Q[0].y / 32 - nest.y) <= 4, 'die Königin sitzt am Nest');
  ok(Q[0] && Q[0].gruppe === 'sz_k' && S.aw.kreaturGruppen.sz_k.typ === 'koenigin', 'Buchführung der Gruppe über nestSetzen');
  schritte(S, 1);
  const lebende = () => S.aw.kreaturen.filter((K) => K.typ === 'schwarmling' && Kreatur.nichtEndgueltigErledigt(K));
  ok(lebende().length === KREATUREN.typen.koenigin.bausteine.brut.anfang, 'der Startbesatz der Brut entsteht (' + lebende().length + ')');
  ok(!sz.erledigt(), 'Königin lebt: nicht erledigt');
  for (const K of lebende()) hinten(S, K);
  ok(lebende().length === 0 && !sz.erledigt(), 'alle Schwarmlinge gefallen, Königin lebt: NICHT erledigt');
  hinten(S, Q[0]);
  ok(!Q[0].alive && sz.erledigt(), 'Königin endgültig erledigt: erledigt');
  schritte(S, 2);
  ok(sz.erledigt() && lebende().length === 0, 'danach bleibt es erledigt, kein Schwarm kehrt wieder');
  ok(/Königin/.test(sz.texte['sz.ziel']) && /lex\.nest/.test(sz.texte['sz.ziel']), 'Zieltext nennt Königin und Nest über das Lexikon (' + sz.texte['sz.ziel'] + ')');
});
section('Headless: Szene typ rudeltier in einer echten Höhle (unverändert)', () => {
  const S = hoehle(32);
  const sz = szeneAufKarte(S, 'rudeltier');
  S.g.mission.act(sz.aktion);
  const R = S.aw.kreaturen.filter((K) => K.typ === 'rudeltier');
  ok(R.length === 3 && R.every((K) => K.gruppe === 'sz_k') && S.fehler.length === 0, 'drei Tiere der Gruppe, kein Fehler (' + R.length + ' ' + S.fehler.join('|') + ')');
  ok(!S.aw.kreaturen.some((K) => K.typ === 'koenigin'), 'keine Königin beim Rudeltier');
  ok(!sz.erledigt(), 'Tiere leben: nicht erledigt');
  for (const K of R.slice(0, 2)) hinten(S, K);
  ok(!sz.erledigt(), 'zwei von drei erledigt: nicht erledigt');
  hinten(S, R[2]);
  ok(sz.erledigt(), 'alle drei erledigt: erledigt');
});
section('Headless: beide Typen mehrere Seeds, kein Fehler', () => {
  for (const seed of [41, 42, 43]) for (const typ of ['schwarm', 'rudeltier']) {
    const S = hoehle(seed);
    const sz = szeneAufKarte(S, typ);
    S.g.mission.act(sz.aktion); schritte(S, 3);
    ok(S.fehler.length === 0 && S.aw.kreaturen.length > 0, typ + ' Seed ' + seed + ': Szene baut ihre Kreaturen (' + S.aw.kreaturen.length + ', Fehler ' + S.fehler.join('|') + ')');
  }
});

// ---------- (e) kein Typname im Servercode ----------
section('Kein Typname im Servercode', () => {
  const namen = ['rudeltier', 'schwarm', 'schwarmling', 'koenigin'];
  const dateien = [];
  const geh = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) geh(p); else if (e.name.endsWith('.js')) dateien.push(p); } };
  geh(path.join(__dirname, '..', 'server')); geh(path.join(__dirname, '..', 'shared'));
  const treffer = [];
  for (const f of dateien) {
    const text = fs.readFileSync(f, 'utf8');
    for (const nm of namen) if (new RegExp('[\'"`]' + nm + '[\'"`]|[\'"`]kreatur\\.' + nm + '[\'"`]|\\.' + nm + '\\b').test(text)) treffer.push(path.relative(path.join(__dirname, '..'), f) + ':' + nm);
  }
  ok(dateien.length > 50 && treffer.length === 0, 'kein Typname (' + namen.join(', ') + ') in server/ und shared/ (' + dateien.length + ' Dateien)' + (treffer.length ? ': ' + treffer.join('; ') : ''));
  const kat = fs.readFileSync(path.join(__dirname, '..', 'server', 'mission', 'katalog.js'), 'utf8');
  ok(/abgeleitet/.test(kat) && !/koenigin|schwarm|rudel/i.test(kat), 'Katalog-Lader kennt nur das allgemeine Feld abgeleitet');
});

console.log('\n' + (n - fails) + '/' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
process.exit(fails ? 1 : 0);
