'use strict';
// GEL-03 D: Regiebuch-Bausteine des Abbaus: Aktion `abbau_neu { map }` und Prüfung `abbau_fertig { min, map? }` (server/mission/bausteine/abbau.js), Katalog (bausteine.json), Prüfer,
// Weltstand-Fakt aus dem Ereignis abbauFertig über den vorhandenen Baustein welt_fakt. Echtes Game, echte Höhle (art hoehle) über den Landepunkt-Weg.
//   1 Katalog und Registry   2 Prüfer (min, Parameter, Ereignisse in on)   3 Prüfung zählt abgebaute Adern (laeuft und leer zählen nicht, map optional)   4 Mission verlangt min 2: Abbau, abbau_neu, Karte unverändert
//   5 Fehler ehrlich (unbekannte Karte, Karte ohne Adern, unerfüllbares min, einmal gemeldet, nie ein Wurf)   6 Weltstand-Fakt aus abbauFertig und Ereignisse als Trigger
//   node tools/test-abbau-regiebuch.js   (npm run test:abbau-regiebuch)
const fs = require('fs');
const path = require('path');
const { Game } = require('../server/game.js');
const interior = require('../server/sim/interior.js');
const combat = require('../server/sim/combat.js');
const Anker = require('../server/sim/anker.js');
const L = require('../server/sim/landepunkte.js');
const W = require('../server/world.js');
const GenHoehle = require('../shared/gen-hoehle.js');
const Physics = require('../shared/physics.js');
const Registry = require('../server/mission/registry.js');
const Checker = require('../server/mission/checker.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const kandidaten = (k) => k.anker.filter((a) => GenHoehle.istAderKandidat(a));

function szene(art, opts) {
  opts = opts || {};
  const g = new Game({ noStore: true, seed: 11, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(o) { this.inbox.push(o); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'A0', name: 'Ader', color: 0 }); g.handleMessage(c, { t: 'ready', ready: true });
  for (let i = 0; i < 6; i++) g.step();
  const id = L.neu(g, g.ship.scene, { art, seed: opts.seed, gen: opts.gen });
  const S = { g, id, ev: [], me: [], fehler: [], fakten: [] };
  g.countError = (w, e) => { S.fehler.push(w + ': ' + (e && e.message)); };
  g.weltstand = { fact: (k, v, q) => { S.fakten.push([k, v, q]); } };   // Test-Senke: nur Fakten merken
  const e0 = g.emit.bind(g); g.emit = function (t, d) { S.ev.push([t, d]); return e0(t, d); };
  const m0 = g.missionEvent.bind(g); g.missionEvent = (nm, a) => { S.me.push([nm, a]); return m0(nm, a); };
  S.betreten = () => {
    const aw = L.get(g, id);
    g.setAwayMap(id); aw.active = true;
    for (const [j, p] of g.players.entries()) { interior.placeOnAwayPad(g, p, j); combat.onArrive(g, p); }
    g.god = true; S.aw = aw; S.k = W.AWAY_MAPS[id].karte; S.p = g.players[0];
    return aw;
  };
  S.z = (aid) => Anker.zustand(g, id, aid);
  S.aktiv = () => kandidaten(S.k).map((a) => a.id).filter((aid) => S.z(aid) === 'da');
  S.menN = (name) => S.me.filter((m) => m[0] === name);
  S.pruef = (args) => !!Registry.get('abbau_fertig').test(g.mission, args);
  S.aktion = (o) => g.mission.act(Object.assign({ do: 'abbau_neu', map: id }, o));
  return S;
}
function abbauen(S, aid) {
  const a = S.k.anker.find((q) => q.id === aid);
  const c = Physics.tileCenter(a.x, a.y);
  S.p.x = c.x; S.p.y = c.y; S.p.hold = { kind: 'anker:abbau', anker: aid, dur: 5, t: 5 };
  Anker.abbauFertig(S.g, S.p, S.p.hold);
  S.p.hold = null;
}

section('1. Katalog und Registry');
{
  const d = Registry.describe();
  const neu = d.find((x) => x.id === 'abbau_neu'), fertig = d.find((x) => x.id === 'abbau_fertig');
  ok(!!neu && neu.art === 'aktion' && neu.params.map.typ === 'map' && neu.params.map.pflicht && Object.keys(neu.params).join() === 'map', 'abbau_neu: Aktion, nur Parameter map (Typ map, Pflicht); Anzahl und Art gibt es bewusst nicht');
  ok(!!neu && neu.ereignisse.includes('abbauNeu') && /Anzahl und Art/.test(neu.beschreibung) && /Generator/.test(neu.beschreibung), 'abbau_neu: deklariert das Ereignis abbauNeu, die Beschreibung begründet die Auslassung von Anzahl und Art');
  ok(!!fertig && fertig.art === 'pruefung' && fertig.params.min.typ === 'number' && fertig.params.min.pflicht && fertig.params.min.min === 1 && fertig.params.map.typ === 'map' && !fertig.params.map.pflicht, 'abbau_fertig: Prüfung, min Pflicht (Zahl, ab 1), map optional');
  ok(!JSON.stringify(d).includes('function') && typeof Registry.get('abbau_fertig').argsPruefen === 'function', 'describe() bleibt reines JSON, der Prüfer hängt als Funktion an der Registry');
  const bs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'regiebuch', 'bausteine.json'), 'utf8'));
  ok(bs.aktionen.abbau_neu && bs.aktionen.abbau_neu.status === 'registriert' && bs.aktionen.abbau_neu.params.map.typ === 'map' && Object.keys(bs.aktionen.abbau_neu.params).join() === 'map', 'bausteine.json: abbau_neu registriert (nur map)');
  ok(bs.pruefungen.abbau_fertig && bs.pruefungen.abbau_fertig.status === 'registriert' && bs.pruefungen.abbau_fertig.params.min.pflicht && !bs.pruefungen.abbau_fertig.params.map.pflicht, 'bausteine.json: abbau_fertig registriert (min Pflicht, map optional)');
  const gleich = ['abbau_neu', 'abbau_fertig'].every((id) => { const j = bs.aktionen[id] || bs.pruefungen[id]; const r = d.find((x) => x.id === id); return j && Object.keys(j.params).sort().join() === Object.keys(r.params).sort().join() && Object.entries(j.params).every(([k, v]) => v.typ === r.params[k].typ && !!v.pflicht === !!r.params[k].pflicht); });
  ok(gleich, 'Katalog und Registry stimmen in Parametern, Typ und Pflicht überein');
}

section('2. Prüfer: min, unbekannte Parameter, Ereignisnamen in on');
{
  const book = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'regiebuecher', 'm3.regiebuch.json'), 'utf8'));
  const karte = book.buehne.aussenkarten[0];
  const bau = (check, extra) => {
    const b = JSON.parse(JSON.stringify(book));
    b.steps[0].next = [{ if: { check: Object.assign({ name: 'abbau_fertig', map: karte }, check) }, goto: b.steps[1].id }].concat(b.steps[0].next || []);
    if (extra) extra(b);
    return Checker.check(b);
  };
  const mit = (r) => r.errors.filter((e) => /abbau_(fertig|neu)/.test(e.msg || ''));
  ok(Checker.check(book).ok, 'Ausgangsbuch m3 besteht den Prüfer');
  ok(mit(bau({ min: 2 })).length === 0 && bau({ min: 2 }).ok, 'abbau_fertig { min 2, map }: gültig (' + bau({ min: 2 }).errors.map((e) => e.code + ' ' + e.msg).join('|') + ')');
  ok(mit(bau({ min: 1 })).length === 0 && mit(bau({ min: GenHoehle.ADERN_ZIEL(1e9) })).length === 0, 'min 1 und min = größte Kandidatenzahl einer Höhle (' + GenHoehle.ADERN_ZIEL(1e9) + '): gültig');
  ok(bau({ min: undefined }).errors.some((e) => e.code === 'PARAM-FEHLT' && /abbau_fertig/.test(e.msg)) || bau({}).errors.some((e) => e.code === 'PARAM-FEHLT' && /abbau_fertig/.test(e.msg)), 'ohne min: PARAM-FEHLT');
  ok(bau({ min: 0 }).errors.some((e) => e.code === 'PARAM-WERT' && /abbau_fertig|min/.test(e.msg)), 'min 0: PARAM-WERT (Untergrenze 1)');
  const bruch = mit(bau({ min: 1.5 }));
  ok(bruch.length === 1 && /ganze Zahl/.test(bruch[0].msg), 'min 1.5: Prüferfehler "ganze Zahl"');
  const gross = mit(bau({ min: 7 }));
  ok(gross.length === 1 && /größte Zahl/.test(gross[0].msg), 'min 7: Prüferfehler (mehr Adern gibt keine Höhle)');
  ok(bau({ min: 2, anzahl: 3 }).errors.some((e) => e.code === 'PARAM-UNBEKANNT'), 'abbau_fertig kennt keinen Parameter anzahl');
  const aktion = (args, ereig) => bau({ min: 2 }, (b) => { b.on = Object.assign({}, b.on, { [ereig || 'abbauNeu']: [Object.assign({ do: 'abbau_neu', map: karte }, args)] }); });
  ok(aktion({}).ok, 'Aktion abbau_neu { map } in on.abbauNeu: gültig (' + aktion({}).errors.map((e) => e.code + ' ' + e.msg).join('|') + ')');
  ok(aktion({ anzahl: 3 }).errors.some((e) => e.code === 'PARAM-UNBEKANNT' && /abbau_neu/.test(e.msg)) && aktion({ art: 'erz' }).errors.some((e) => e.code === 'PARAM-UNBEKANNT'), 'abbau_neu mit anzahl oder art: PARAM-UNBEKANNT (bewusst nicht gebaut)');
  ok(aktion({ map: undefined }).errors.some((e) => e.code === 'PARAM-FEHLT' && /abbau_neu/.test(e.msg)) || !!bau({ min: 2 }, (b) => { b.on = { x: [{ do: 'abbau_neu' }] }; }).errors.some((e) => e.code === 'PARAM-FEHLT'), 'abbau_neu ohne map: PARAM-FEHLT');
  // Ereignisnamen in on sind frei (keine Liste): die drei Namen des Abbaus brauchen keinen Eintrag
  const alle = bau({ min: 2 }, (b) => { b.on = Object.assign({}, b.on, { abbauFertig: [{ do: 'welt_fakt', key: 'abbau_gemacht', value: true }], abbauLaerm: [{ do: 'welt_fakt', key: 'abbau_laut', value: true }], abbauNeu: [{ do: 'welt_fakt', key: 'abbau_neu_gesehen', value: true }], abbauStart: [{ do: 'welt_fakt', key: 'abbau_begonnen', value: true }] }); });
  ok(alle.ok, 'on.abbauFertig, abbauLaerm, abbauNeu, abbauStart mit welt_fakt: Prüfer akzeptiert (Ereignisnamen sind frei, keine Liste) (' + alle.errors.map((e) => e.code + ' ' + e.msg).join('|') + ')');
}

section('3. Prüfung: zählt abgebaute Adern der Runde (laeuft und leer zählen nicht, map optional)');
{
  const S = szene('hoehle', { seed: 5 }); S.betreten(); const g = S.g;
  const akt = S.aktiv();
  ok(akt.length >= 2 && akt.length <= 3, 'Höhle trägt ' + akt.length + ' aktive Adern (Runde 0)');
  ok(!S.pruef({ min: 1, map: S.id }) && !S.pruef({ min: 2, map: S.id }), 'nichts abgebaut: min 1 und min 2 falsch');
  Anker.setzen(g, S.id, akt[0], 'laeuft', S.p.id);
  ok(S.z(akt[0]) === 'laeuft' && !S.pruef({ min: 1, map: S.id }), 'Ader im Zustand laeuft zählt nicht');
  Anker.abbauAbbrechen(g, S.id, akt[0], S.p.id);
  abbauen(S, akt[0]);
  ok(S.z(akt[0]) === 'abgebaut' && S.pruef({ min: 1, map: S.id }) && !S.pruef({ min: 2, map: S.id }), 'eine Ader abgebaut: min 1 wahr, min 2 falsch');
  ok(S.pruef({ min: 1 }) && !S.pruef({ min: 2 }) && g.away.map === S.id, 'ohne map gilt die aktuelle Außenkarte (gleiche Antworten)');
  abbauen(S, akt[1]);
  ok(S.pruef({ min: 2, map: S.id }) && S.pruef({ min: 2 }) && S.pruef({ min: 1 }), 'zwei Adern abgebaut: min 2 wahr');
  const leer = kandidaten(S.k).map((a) => a.id).filter((id) => S.z(id) === 'leer');
  ok(leer.length >= 1 && leer.every((id) => S.z(id) === 'leer'), 'es gibt leere Adern (' + leer.length + ')');
  const vorkommen = akt.length;
  ok(S.pruef({ min: vorkommen, map: S.id }) === (vorkommen === 2) && !S.pruef({ min: vorkommen + 1, map: S.id }), 'leere Adern zählen nie: min = Zahl der Vorkommen ' + vorkommen + (vorkommen === 2 ? ' wahr' : ' noch falsch') + ', min ' + (vorkommen + 1) + ' falsch');
  ok(S.fehler.length === 1 && /min \d+ ist größer als die Adern mit Vorkommen/.test(S.fehler[0]), 'ein min über den Vorkommen ist unerfüllbar: genau eine Meldung (' + S.fehler.join('|') + ')');
  S.pruef({ min: vorkommen + 1, map: S.id }); S.pruef({ min: vorkommen + 1, map: S.id });
  ok(S.fehler.length === 1, 'wiederholte Prüfung (Tick) meldet nicht erneut');
}

section('4. Mission verlangt abbau_fertig { min 2 }: zwei Adern abbauen, wahr; abbau_neu, wieder falsch; Karte unverändert');
{
  const S = szene('hoehle', { seed: 5 }); S.betreten(); const g = S.g; const e = L.eintrag(g, S.id);
  const roh = JSON.stringify(L.karte(g, S.id));
  const kartenVor = JSON.stringify(S.k);
  const verlangt = () => g.mission.cond({ check: { name: 'abbau_fertig', map: S.id, min: 2 } });
  const akt = S.aktiv();
  ok(!verlangt(), 'Bedingung der Mission (check abbau_fertig min 2) zu Beginn falsch');
  abbauen(S, akt[0]);
  ok(!verlangt(), 'eine Ader abgebaut: noch falsch');
  abbauen(S, akt[1]);
  ok(verlangt(), 'zwei Adern abgebaut: wahr (über die Missions-Bedingung, nicht nur den Baustein)');
  ok(S.menN('abbauFertig').length === 2, 'zwei Missionsereignisse abbauFertig');
  S.me.length = 0; S.ev.length = 0;
  S.aktion();
  ok(S.fehler.length === 0 && e.abbau_runde === 1, 'Aktion abbau_neu über die Mission: Runde 1, kein Fehler (' + S.fehler.join('|') + ')');
  ok(!verlangt(), 'nach abbau_neu ist die Bedingung wieder falsch');
  const neu = S.menN('abbauNeu');
  ok(neu.length === 1 && neu[0][1].map === S.id && neu[0][1].runde === 1 && S.ev.filter((x) => x[0] === 'abbauNeu').length === 1, 'Ereignis abbauNeu { map, runde 1, adern } als Missions- und Spielereignis');
  ok(neu[0][1].adern.join() === S.aktiv().join() && S.aktiv().length >= 2, 'die gemeldeten Adern sind die jetzt aktiven (' + S.aktiv().length + ')');
  ok(JSON.stringify(S.k) === kartenVor && JSON.stringify(L.karte(g, S.id)) === roh, 'Karte byteweise gleich (Karte in der Welt und Rohkarte des Landepunkts)');
  const akt2 = S.aktiv();
  ok(akt2.some((id) => !akt.includes(id)), 'mindestens eine frische Ader gegenüber Runde 0');
  abbauen(S, akt2[0]); abbauen(S, akt2[1]);
  ok(verlangt(), 'Runde 1: zwei Adern abgebaut, wieder wahr');
  S.aktion();
  ok(!verlangt() && e.abbau_runde === 2, 'abbau_neu erneut: Runde 2, wieder falsch');
}

section('5. Fehler ehrlich: kein Wurf, eine Meldung, keine Änderung');
{
  const S = szene('hoehle', { seed: 5 }); S.betreten(); const g = S.g; const e = L.eintrag(g, S.id);
  let wurf = null;
  try {
    S.aktion({ map: 'nirgends' });
    ok(S.fehler.length === 1 && /mission-abbau: abbau_neu: Karte nirgends ist kein Landepunkt/.test(S.fehler[0]), 'abbau_neu auf unbekannter Karte: eine Meldung (' + S.fehler.join('|') + '), kein Wurf');
    ok(e.abbau_runde === 0, 'die bekannte Karte bleibt unberührt (Runde 0)');
    ok(!S.pruef({ min: 1, map: 'nirgends' }) && !S.pruef({ min: 1, map: 'constructor' }) && !S.pruef({ min: 1, map: '' }) && S.fehler.length === 1, 'abbau_fertig auf unbekannter Karte: falsch, keine neue Meldung');
  } catch (x) { wurf = x; }
  ok(!wurf, 'kein Wurf (' + (wurf && wurf.message) + ')');
}
{
  // Karte ohne Adern: Wildnis ohne Höhle
  const S = szene('wildnis', { seed: 7 }); S.betreten(); const g = S.g;
  S.aktion();
  ok(S.fehler.length === 1 && /Karte .* hat keine Erzadern/.test(S.fehler[0]), 'abbau_neu auf Karte ohne Adern: eine Meldung (' + S.fehler.join('|') + ')');
  ok(!S.pruef({ min: 1, map: S.id }) && !S.pruef({ min: 1 }) && S.fehler.length === 2 && /abbau_fertig: Karte .* hat keine Erzadern/.test(S.fehler[1]), 'abbau_fertig auf Karte ohne Adern: falsch, einmal gemeldet (' + S.fehler.slice(1).join('|') + ')');
  const w = L.eintrag(g, S.id).abbau_runde;
  ok(w === 0, 'Runde unverändert');
}
{
  // nicht betreten: Karte noch nicht geladen -> falsch, keine Meldung; ohne map und ohne Außenkarte falsch
  const S = szene('hoehle', { seed: 5 });
  ok(!S.pruef({ min: 1, map: S.id }) && !S.pruef({ min: 1 }) && S.fehler.length === 0, 'Karte noch nicht geladen (nie betreten) bzw. keine Außenkarte: falsch, keine Meldung');
  // nicht geladene Karte: der Weltstand-Eintrag zählt (gespeichert gewinnt vor der Auswahl der Runde)
  const e = L.eintrag(S.g, S.id), kk = W.AWAY_MAPS[S.id].karte;
  const wahl = Anker.abbauWahlZustaende(kk, 0), da = Object.keys(wahl).filter((id) => wahl[id] === 'da');
  e.zustaende = { [da[0]]: 'abgebaut', [da[1]]: 'abgebaut' };
  ok(S.pruef({ min: 2, map: S.id }) && !S.pruef({ min: 3, map: S.id }) && !S.g.aways[S.id], 'nicht geladene Karte: zwei gespeicherte abgebaut zählen (min 2 wahr), die Auswahl der Runde füllt den Rest');
}

section('6. Weltstand-Fakt aus dem Ereignis abbauFertig und Ereignisse als Trigger (vorhandener Baustein welt_fakt)');
{
  const S = szene('hoehle', { seed: 5 }); S.betreten(); const g = S.g; const m = g.mission;
  const alt = m.def;
  const aufgerufen = [];
  m.def = { id: 'test_abbau', on: {
    abbauFertig: [{ do: 'welt_fakt', key: 'erz_abgebaut', value: true }],
    abbauStart: [{ do: 'welt_fakt', key: 'abbau_begonnen', value: true }],
    abbauLaerm: [{ do: 'welt_fakt', key: 'abbau_laut', value: true }],
    abbauNeu: [{ do: 'welt_fakt', key: 'erz_neu', value: true }],
  } };
  try {
    const akt = S.aktiv();
    const a = S.k.anker.find((q) => q.id === akt[0]); const c = Physics.tileCenter(a.x, a.y);
    S.p.x = c.x; S.p.y = c.y;
    S.p.hold = { kind: 'anker:abbau', anker: akt[0], dur: 5, t: 0 }; Anker.abbauStarten(g, S.p, S.p.hold);
    ok(S.fakten.some((f) => f[0] === 'abbau_begonnen') && S.fakten.some((f) => f[0] === 'abbau_laut'), 'abbauStart und abbauLaerm lösen on-Handler aus (Fakten abbau_begonnen, abbau_laut)');
    ok(!S.fakten.some((f) => f[0] === 'erz_abgebaut'), 'vor dem Ende kein Fakt erz_abgebaut');
    Anker.abbauFertig(g, S.p, S.p.hold); S.p.hold = null;
    const f = S.fakten.filter((x) => x[0] === 'erz_abgebaut');
    ok(f.length === 1 && f[0][1] === true && f[0][2] === m.writeContext().mission, 'abbauFertig setzt über welt_fakt genau einen Fakt (Quelle = Mission)');
    S.aktion();
    ok(S.fakten.some((x) => x[0] === 'erz_neu') && S.fehler.length === 0, 'abbauNeu (aus der Aktion) löst on.abbauNeu aus');
  } finally { m.def = alt; }
}

console.log(`\n${n - fails}/${n} Prüfungen bestanden`);
process.exit(fails ? 1 : 0);
