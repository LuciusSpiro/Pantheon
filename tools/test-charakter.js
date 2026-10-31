'use strict';
// CHA-01 B1: Charakterkarte – Format, Prüfung (shared/charakter.js), Netz (hello/welcome/Ereignis karte/Befehl karte.outfit) und Namensschutz vor dem LLM.
//   1. Einheiten: Standard, Prüfung je Feld (unbekanntes Teil, fremder Platz, falsche Gruppe, Farbindex, Typ, fehlend, Zusatzfelder), pruefeOutfit, pruefeName, eindeutigerName, Fuzz (fester Seed, wirft nie)
//   2. Abnahme 12 (No-Go): der Charaktername ist p.name und fällt in ohneNamen/spielerNamen (server/sim/lage-ausschnitt.js)
//   3. Integration: echter Server im Prozess, WebSocket-Clients wie im Spiel
//   node tools/test-charakter.js   (npm run test:charakter)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
process.env.MISSION_SOURCE = 'fallback'; process.env.SPIELLEITER_LLM = 'off';
const WebSocket = require('ws');
const Ch = require('../shared/charakter.js');
const Protocol = require('../shared/protocol.js');
const Weltstand = require('../server/weltstand.js');
const Ausschnitt = require('../server/sim/lage-ausschnitt.js');
const { startServer } = require('../server/index.js');
const CODE = 'CHA1';
const KAT = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'katalog', 'charakter.json'), 'utf8'));

let fails = 0, n = 0;
const ok = (c, t) => { n++; console.log((c ? '  ok   ' : '  FEHLER ') + t); if (!c) fails++; };
const section = (t) => console.log('\n' + t);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const klon = (x) => JSON.parse(JSON.stringify(x));

const STD = Ch.standardKarte('Aurelia', KAT);
const OUTFIT_STD = { kopf: 'keine', oberteil: 'bordtunika', hose: 'bordhose', schuhe: 'bordstiefel', haende: 'keine', umhang: 'keiner' };
const ALT = { v: 1, name: 'Narbo', koerper: 'standard', gesicht: 'narbe', frisur: 'zoepfe', bart: 'vollbart', haut: 3, haar: 2,
  outfit: { kopf: 'bordhelm', oberteil: 'plankenweste', hose: 'germanenhose', schuhe: 'germanenstiefel', haende: 'armschiene', umhang: 'fellumhang' } };

function einheiten() {
  section('Katalog-Stub');
  ok(KAT.plaetze.length === 9 && eq(KAT.plaetze.map((p) => p.id), ['gesicht', 'frisur', 'bart', 'kopf', 'oberteil', 'hose', 'schuhe', 'haende', 'umhang']), '9 Plätze in fester Reihenfolge');
  ok(KAT.farben.haut.length === 4 && KAT.farben.haar.length === 4, 'je 4 Haut- und Haarfarben');
  ok(KAT.plaetze.every((p) => KAT.teile.some((t) => t.id === p.id + '/' + p.standard)), 'jeder Standard ist ein Teil des Katalogs');
  ok(KAT.plaetze.every((p) => KAT.teile.filter((t) => t.platz === p.id).length === 2), 'je Platz Standard und Prüfsatz-Alternative');

  section('Standardkarte');
  ok(eq(STD, { v: 1, name: 'Aurelia', koerper: 'standard', gesicht: 'lerche', frisur: 'dutt', bart: 'keiner', haut: 0, haar: 0, outfit: OUTFIT_STD }), 'standardKarte(name, katalog) wie die Schnittstelle');
  ok(Ch.standardKarte('x', KAT).name === 'Crew' && Ch.standardKarte(null, KAT).name === 'Crew', 'ungültiger Name → Crew');
  ok(eq(Ch.pruefeKarte(STD, KAT), STD), 'Standardkarte ist gültig und bleibt unverändert');
  ok(eq(Ch.pruefeKarte(ALT, KAT), ALT), 'Karte mit allen Prüfsatz-Alternativen und Farbe 3/2 ist gültig');

  section('pruefeKarte: je Feld Standard');
  const mit = (f) => { const k = klon(ALT); f(k); return Ch.pruefeKarte(k, KAT); };
  let k = mit((x) => { x.gesicht = 'gibtsnicht'; });
  ok(k.gesicht === 'lerche' && k.frisur === 'zoepfe', 'unbekannte Teil-ID → Standard nur dieses Feldes');
  k = mit((x) => { x.frisur = 'vollbart'; });
  ok(k.frisur === 'dutt' && k.bart === 'vollbart', 'Teil eines anderen Platzes → Standard');
  k = mit((x) => { x.gesicht = 'bordhelm'; x.frisur = 'kopf/bordhelm'; x.bart = 'bordtunika'; });
  ok(k.gesicht === 'lerche' && k.frisur === 'dutt' && k.bart === 'keiner', 'Outfit-Teil in einem Charakterfeld → Standard');
  k = mit((x) => { x.outfit.kopf = 'narbe'; x.outfit.oberteil = 'zoepfe'; x.outfit.hose = 'oberteil/plankenweste'; });
  ok(k.outfit.kopf === 'keine' && k.outfit.oberteil === 'bordtunika' && k.outfit.hose === 'bordhose' && k.outfit.schuhe === 'germanenstiefel', 'Charakterteil im Outfit / Teil eines anderen Platzes → Standard, übrige bleiben');
  let farbenOk = true;
  for (const bad of [-1, 4, 99, 1.5, NaN, Infinity, '1', null, true, [], {}]) {
    k = mit((x) => { x.haut = bad; x.haar = bad; });
    if (!(k.haut === 0 && k.haar === 0)) farbenOk = false;
  }
  ok(farbenOk, 'Farbindex außerhalb, Nicht-Integer, falscher Typ → 0');
  k = mit((x) => { x.gesicht = 7; x.frisur = null; x.bart = ['vollbart']; x.outfit.kopf = { a: 1 }; x.koerper = 'riese'; });
  ok(k.gesicht === 'lerche' && k.frisur === 'dutt' && k.bart === 'keiner' && k.outfit.kopf === 'keine' && k.koerper === 'standard', 'falscher Typ / unbekannter Körper → Standard');
  k = mit((x) => { delete x.frisur; delete x.haut; delete x.outfit.umhang; delete x.koerper; });
  ok(k.frisur === 'dutt' && k.haut === 0 && k.outfit.umhang === 'keiner' && k.gesicht === 'narbe' && k.koerper === 'standard', 'fehlendes Feld → Standard dieses Feldes');
  k = mit((x) => { x.outfit = 'nackt'; });
  ok(eq(k.outfit, OUTFIT_STD), 'Outfit kein Objekt → ganzes Outfit Standard');
  k = mit((x) => { x.extra = 1; x.admin = true; x.outfit.schwert = 'x'; });
  ok(!('extra' in k) && !('admin' in k) && !('schwert' in k.outfit) && eq(Object.keys(k), Object.keys(STD)), 'zusätzliche Felder fallen weg');
  k = mit((x) => { x.name = 'Dieser Name ist viel zu lang'; });
  ok(k.name === 'Crew' && k.gesicht === 'narbe', 'zu langer Name → Standardname, Rest bleibt');
  k = Ch.pruefeKarte(JSON.parse('{"__proto__":{"gesicht":"narbe"},"constructor":"x","gesicht":"gibtsnicht"}'), KAT);
  ok(k.gesicht === 'lerche', 'Prototyp-Tricks ändern nichts');
  let wirft = false, gueltig = true;
  for (const roh of [null, undefined, 0, 7, 'text', [], [1, 2], true, 'x'.repeat(1e6), () => 1]) {
    try { const r = Ch.pruefeKarte(roh, KAT); if (!eq(Object.keys(r), Object.keys(STD)) || r.gesicht !== 'lerche') gueltig = false; } catch (e) { wirft = true; }
  }
  ok(!wirft && gueltig, 'null, Zahl, String, Array, riesiger String, Funktion → Standardkarte, kein Wurf');
  const gross = { name: 'A'.repeat(1e6), gesicht: 'g'.repeat(1e6), outfit: { kopf: 'k'.repeat(1e6) } };
  ok(Ch.pruefeKarte(gross, KAT).gesicht === 'lerche', 'riesige Strings in Feldern → Standard');
  let katOk = true;
  try { for (const kk of [null, undefined, {}, [], 'x', { plaetze: 5, teile: 'x', farben: null }]) { Ch.pruefeKarte(ALT, kk); Ch.pruefeOutfit(ALT.outfit, kk); Ch.standardKarte('Ada', kk); } } catch (e) { katOk = false; }
  ok(katOk, 'kaputter Katalog wirft nicht');
  const vorher = JSON.stringify(ALT); Ch.pruefeKarte(ALT, KAT); Ch.pruefeOutfit(ALT.outfit, KAT);
  ok(JSON.stringify(ALT) === vorher, 'Eingabe bleibt unverändert (reine Funktion)');

  section('pruefeOutfit');
  ok(eq(Ch.pruefeOutfit(ALT.outfit, KAT), ALT.outfit), 'gültiges Outfit unverändert');
  ok(eq(Ch.pruefeOutfit({ kopf: 'bordhelm', oberteil: 'narbe', hose: 'x', extra: 1 }, KAT), Object.assign({}, OUTFIT_STD, { kopf: 'bordhelm' })), 'Fehler → Standard je Platz, Zusatzfelder weg');
  ok(eq(Ch.pruefeOutfit(null, KAT), OUTFIT_STD) && eq(Ch.pruefeOutfit([1], KAT), OUTFIT_STD) && eq(Ch.pruefeOutfit('x', KAT), OUTFIT_STD), 'null/Array/String → Standardoutfit');
  ok(eq(Ch.pruefeOutfit({ gesicht: 'narbe', haut: 3 }, KAT), OUTFIT_STD), 'Charakterfelder im Outfit zählen nicht');

  section('pruefeName');
  ok(Ch.pruefeName('Aurelia') === 'Aurelia' && Ch.pruefeName('Jörg-Ägidius') === 'Jörg-Ägidius', 'Buchstaben inkl. Umlaute und Bindestrich');
  ok(Ch.pruefeName('Straße 7') === 'Straße 7' && Ch.pruefeName('Zoë') === 'Zoë' && Ch.pruefeName('Łukasz') === 'Łukasz', 'ß, Ziffern, Leerzeichen, Unicode-Buchstaben');
  ok(Ch.pruefeName('  Ada   Lo  ') === 'Ada Lo', 'trimmen, Mehrfach-Leerzeichen zu einem');
  ok(Ch.pruefeName('<b>Ada</b>') === 'bAdab', '<> raus');
  ok(Ch.pruefeName('A\u0000d\u001fa\n') === 'Ada', 'Steuerzeichen raus');
  ok(Ch.pruefeName('A') === null && Ch.pruefeName('') === null && Ch.pruefeName('   ') === null && Ch.pruefeName('<>') === null, 'zu kurz (nach Bereinigung) → null');
  ok(Ch.pruefeName('Ab') === 'Ab' && Ch.pruefeName('123456789012') === '123456789012', 'Grenzen 2 und 12 gelten');
  ok(Ch.pruefeName('1234567890123') === null && Ch.pruefeName('x'.repeat(1e6)) === null, 'länger als 12 → null');
  ok(Ch.pruefeName(null) === null && Ch.pruefeName(5) === null && Ch.pruefeName({}) === null && Ch.pruefeName(['Ada']) === null, 'falscher Typ → null');
  ok(Ch.pruefeName('Ada\u{1F600}') === 'Ada' && Ch.pruefeName('A_d.a!') === 'Ada', 'Sonderzeichen und Emoji fallen heraus');

  section('eindeutigerName');
  ok(Ch.eindeutigerName('Ada', ['Bo', 'Cem']) === 'Ada', 'keine Kollision → unverändert');
  ok(Ch.eindeutigerName('Ada', ['ada']) === 'Ada 2' && Ch.eindeutigerName('Ada', ['ADA', 'Ada 2']) === 'Ada 3', 'Kollision ohne Groß/klein → 2, 3, …');
  const lang = Ch.eindeutigerName('Aurelianus-Max', ['Aurelianus-Max']);
  ok(lang.length <= 12 && lang.endsWith(' 2') && lang !== 'Aurelianus-Max', 'kürzt vorher, damit 12 Zeichen gelten (' + lang + ')');
  const l2 = Ch.eindeutigerName('123456789012', ['123456789012', '1234567890 2']);
  ok(l2 === '1234567890 3', 'gekürzt und weitergezählt (' + l2 + ')');
  ok(Ch.eindeutigerName('Ada', null) === 'Ada' && Ch.eindeutigerName('Ada', [1, null, 'Ada']) === 'Ada 2', 'kaputte Namensliste wirft nicht');
  const viele = []; for (let i = 0; i < 12; i++) viele.push(Ch.eindeutigerName('Ada', viele));
  ok(new Set(viele.map((s) => s.toLowerCase())).size === 12 && viele.every((s) => s.length <= 12), 'zwölf Gleichnamige bleiben unterscheidbar');

  section('Fuzz (Seed 20261031)');
  let seed = 20261031; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const teileIds = KAT.teile.map((t) => t.id.split('/')[1]);
  const wert = (tiefe) => pick([
    () => null, () => undefined, () => rnd() * 20 - 5, () => Math.floor(rnd() * 8) - 2, () => NaN, () => pick(teileIds), () => pick(teileIds) + pick(['', 'x', ' ']),
    () => 'q'.repeat(Math.floor(rnd() * 400)), () => String.fromCharCode(...Array.from({ length: 8 }, () => Math.floor(rnd() * 65536))), () => rnd() < 0.5, () => ({}), () => [],
    () => (tiefe > 2 ? 0 : [wert(tiefe + 1), wert(tiefe + 1)]),
    () => { if (tiefe > 2) return 1; const o = {}; for (const f of ['gesicht', 'frisur', 'bart', 'kopf', 'oberteil', 'hose', 'haut', 'outfit', 'name', 'zz']) if (rnd() < 0.5) o[f] = wert(tiefe + 1); return o; },
  ])();
  let gut = 0, wurf = 0;
  for (let i = 0; i < 600; i++) {
    const roh = i % 3 === 0 ? wert(0) : { v: wert(1), name: wert(1), koerper: wert(1), gesicht: wert(1), frisur: wert(1), bart: wert(1), haut: wert(1), haar: wert(1), outfit: wert(1) };
    try {
      const r = Ch.pruefeKarte(roh, KAT);
      const o = Ch.pruefeOutfit(roh && roh.outfit, KAT);
      const g = eq(Object.keys(r), Object.keys(STD)) && eq(Object.keys(r.outfit), Object.keys(OUTFIT_STD)) && eq(Object.keys(o), Object.keys(OUTFIT_STD))
        && KAT.teile.some((t) => t.id === 'gesicht/' + r.gesicht) && KAT.teile.some((t) => t.id === 'kopf/' + r.outfit.kopf)
        && Number.isInteger(r.haut) && r.haut >= 0 && r.haut < 4 && r.haar >= 0 && r.haar < 4 && r.name.length >= 2 && r.name.length <= 12
        && eq(Ch.pruefeKarte(r, KAT), r);   // idempotent
      if (g) gut++;
      Ch.pruefeName(roh); Ch.eindeutigerName(roh, [roh]);
    } catch (e) { wurf++; }
  }
  ok(wurf === 0 && gut === 600, `600 Zufallswerte: kein Wurf (${wurf}), jedes Ergebnis vollständig, im Katalog und idempotent (${gut}/600)`);
}

// Abnahme 12 (No-Go): Spielernamen nie an ein LLM
function namensschutz() {
  section('Abnahme 12: Charaktername wird vor dem LLM ersetzt');
  const name = Ch.pruefeName('Aurelia-Kas');
  const k = Ch.pruefeKarte(Object.assign(klon(ALT), { name }), KAT);
  const game = { players: [{ id: 'p1', name: k.name, karte: k }, { id: 'p2', name: 'Crew 2' }] };   // so setzt der Server p.name = p.karte.name
  const namen = Ausschnitt.spielerNamen(game);
  ok(namen.includes('Aurelia-Kas'), 'spielerNamen erfasst den Charakternamen');
  const r = Ausschnitt.ohneNamen('Aurelia-Kas hat den Hafen verteidigt, sagt man; auch aurelia-kasimir kam.', namen);
  ok(!/aurelia/i.test(r) && r.includes('Crew'), `Text ohne Charakternamen: "${r}"`);
  ok(Ausschnitt.ohneNamen('Ohne Namen bleibt der Text.', namen) === 'Ohne Namen bleibt der Text.', 'unbeteiligter Text bleibt');
  const umlaut = { players: [{ name: Ch.pruefeName('Jörg Ägir') }] };
  ok(!/Jörg/.test(Ausschnitt.ohneNamen('Jörg Ägir ruft.', Ausschnitt.spielerNamen(umlaut))), 'Name mit Umlaut und Leerzeichen wird ersetzt');
}

// ------------------------------------------------------------------ Integration
function client(port, hello) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const c = { ws, welcome: null, karten: [], snaps: [] };
    ws.on('message', (data) => {
      const m = JSON.parse(data.toString());
      if (m.t === 'welcome') c.welcome = m;
      else if (m.t === 'snap') { c.snaps.push(m); if (c.snaps.length > 3) c.snaps.shift(); }
      else if (m.t === 'event' && m.kind === 'karte') c.karten.push(m);
    });
    c.send = (o) => ws.send(JSON.stringify(o));
    c.close = () => { try { ws.close(); } catch (e) { /* egal */ } };
    ws.on('open', () => { c.send(Object.assign({ t: 'hello', code: CODE }, hello)); resolve(c); });
  });
}
const bis = async (f, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 2000)) { if (f()) return true; await sleep(30); } return !!f(); };

async function mitServer(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-charakter-'));
  const srv = await startServer({ port: 0, quiet: true, noStore: true, worlds: true, worldDir: dir, debug: true, roomCode: CODE });
  const clients = [];
  const neu = async (h) => { const c = await client(srv.port, h); clients.push(c); await bis(() => c.welcome); return c; };
  try { await fn(srv.game, neu); } finally {
    clients.forEach((c) => c.close());
    await sleep(100);
    try { await srv.close(); } catch (e) { /* egal */ }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* egal */ }
  }
}

async function integration() {
  await mitServer(async (g, neu) => {
    section('Zwei Spieler mit Karte, dritter tritt später bei');
    const a = await neu({ clientId: 'A', name: 'Ignoriert', color: 0, karte: ALT });
    const kb = klon(STD); kb.name = 'Bea'; kb.haut = 2;
    const b = await neu({ clientId: 'B', name: 'Bobby', color: 1, karte: kb });
    await bis(() => a.karten.length >= 2);
    const pa = g.playerById('p1'), pb = g.playerById('p2');
    ok(pa.name === 'Narbo' && pb.name === 'Bea', `Charaktername wird Spielername (${pa.name}, ${pb.name})`);
    ok(eq(pa.karte, ALT) && pb.karte.haut === 2, 'Server hält die geprüfte Karte je Spieler');
    ok(eq(a.welcome.karten, { p1: ALT }), 'welcome des ersten enthält die eigene Karte');
    ok(eq(b.welcome.karten.p1, ALT) && b.welcome.karten.p2.name === 'Bea', 'welcome des zweiten enthält die Karten aller (erster + eigene)');
    ok(a.karten.some((e) => e.pid === 'p2' && e.k.name === 'Bea') && b.karten.some((e) => e.pid === 'p2'), 'Ereignis karte { pid, k } bei Beitritt an alle');
    const cc = await neu({ clientId: 'C', name: 'Cem', color: 2, karte: Object.assign(klon(ALT), { name: 'Cleo' }) });
    ok(cc.welcome.karten && Object.keys(cc.welcome.karten).sort().join() === 'p1,p2,p3' && cc.welcome.karten.p1.name === 'Narbo' && cc.welcome.karten.p2.name === 'Bea', 'Nachzügler bekommt im welcome die Karten beider anderen');
    await bis(() => a.karten.some((e) => e.pid === 'p3') && b.karten.some((e) => e.pid === 'p3'));
    ok(a.karten.some((e) => e.pid === 'p3' && e.k.name === 'Cleo') && b.karten.some((e) => e.pid === 'p3'), 'Ereignis karte des Nachzüglers erreicht die Bestandsspieler');

    section('Spieler ohne Karte: wie heute');
    const d = await neu({ clientId: 'D', name: 'Dora', color: 3 });
    const pd = g.playerById('p4');
    ok(pd.name === 'Dora' && pd.color === 3 && !pd.karte, 'hello ohne Karte: Name und Farbe wie bisher, keine Karte');
    ok(d.welcome.karten && Object.keys(d.welcome.karten).sort().join() === 'p1,p2,p3', 'welcome enthält die Karten der anderen, keine eigene');
    await sleep(150);
    ok(!a.karten.some((e) => e.pid === 'p4'), 'kein Ereignis karte für den Spieler ohne Karte');

    section('karte.outfit (läuft über das cmd-Muster, also nur außerhalb der Lobby)');
    for (const x of [a, b, cc, d]) x.send({ t: 'ready', ready: true });
    ok(await bis(() => g.phase === 'play', 5000), 'Runde läuft mit vier Spielern');
    for (const x of [a, b, cc, d]) x.karten.length = 0;
    const neuesOutfit = { kopf: 'bordhelm', oberteil: 'plankenweste', hose: 'bordhose', schuhe: 'germanenstiefel', haende: 'keine', umhang: 'fellumhang' };
    b.send({ t: 'cmd', c: 'karte.outfit', outfit: neuesOutfit });
    await bis(() => a.karten.length && cc.karten.length && b.karten.length && d.karten.length);
    const ev = a.karten[0];
    ok(ev && ev.pid === 'p2' && eq(ev.k.outfit, neuesOutfit) && ev.k.name === 'Bea' && ev.k.haut === 2, 'Ereignis karte erreicht alle, Rest der Karte unverändert');
    ok(a.karten.length === 1 && cc.karten.length === 1 && d.karten.length === 1, 'genau ein Ereignis je Client');
    ok(eq(pb.karte.outfit, neuesOutfit), 'Server hat das Outfit gesetzt');
    b.send({ t: 'cmd', c: 'karte.outfit', outfit: { kopf: 'narbe', oberteil: 'gibtsnicht', hose: 5, gesicht: 'narbe', haut: 3 } });
    await sleep(300);
    ok(eq(pb.karte.outfit, OUTFIT_STD) && pb.karte.gesicht === 'lerche' && pb.karte.haut === 2, 'manipuliertes Outfit → Standard je Platz, Charakterfelder unberührt');
    b.send({ t: 'cmd', c: 'karte.outfit' });
    b.send({ t: 'cmd', c: 'karte.outfit', outfit: null });
    b.send({ t: 'cmd', c: 'karte.outfit', outfit: { kopf: 'x'.repeat(5000), oberteil: ['y'.repeat(5000)] } });
    await sleep(200);
    ok(eq(pb.karte.outfit, OUTFIT_STD) && g.phase === 'play', 'fehlendes/kaputtes outfit → Standardoutfit, Server läuft weiter');
    for (const x of [a, b, cc, d]) x.karten.length = 0;
    d.send({ t: 'cmd', c: 'karte.outfit', outfit: neuesOutfit });
    await sleep(300);
    ok(!pd.karte && !a.karten.length && !d.karten.length, 'ohne Karte bewirkt karte.outfit nichts (kein Ereignis)');

    section('Snapshot und Weltstand ohne Karte');
    await bis(() => a.snaps.length);
    const snap = a.snaps[a.snaps.length - 1];
    ok(snap.players.length === 4 && snap.players.every((p) => !('karte' in p) && !('karten' in p) && !('k' in p) && !('outfit' in p)), 'Snapshot-Spielereinträge ohne Kartenfeld');
    ok(!JSON.stringify(snap).includes('bordtunika') && !JSON.stringify(snap).includes('plankenweste') && !('karten' in snap), 'nirgends im Snapshot');
    const cap = JSON.stringify(Weltstand.capture(g));
    ok(!cap.includes('bordtunika') && !cap.includes('plankenweste') && !cap.includes('koerper'), 'nichts im Weltstand (kein Kartenfeld; Spielernamen stehen wie immer in meta)');

    section('Wiederverbinden behält die Karte');
    a.close();
    await bis(() => !pa.connected);
    const a2 = await neu({ clientId: 'A', name: 'Narbo', color: 0 });   // gleiche clientId, diesmal ohne Karte im hello
    ok(a2.welcome.pid === 'p1' && eq(pa.karte, ALT) && pa.name === 'Narbo', 'gleiche clientId: Platz, Karte und Name bleiben');
    ok(eq(a2.welcome.karten.p1, ALT) && eq(a2.welcome.karten.p2.outfit, OUTFIT_STD), 'neues welcome schickt die Karten wieder');
    await bis(() => b.karten.some((e) => e.pid === 'p1' && eq(e.k, ALT)));
    ok(b.karten.some((e) => e.pid === 'p1' && eq(e.k, ALT)), 'Ereignis karte beim Wiederverbinden an die anderen');
    a2.close();

    section('Manipulierte Karte im hello (Server voll: Platz eines getrennten Spielers)');
    const roh = { v: 99, name: '<script>x</script>Maximilian Mustermann', gesicht: 'bordhelm', frisur: { a: 1 }, bart: 'kopf/bordhelm', haut: 77, haar: -1, outfit: { kopf: 'narbe', oberteil: 'x'.repeat(10000), hose: [1] }, admin: true, wf: 'lanze', hp: 9999 };
    const p3 = g.playerById('p3');
    b.close(); cc.close(); d.close();
    await bis(() => !pa.connected && !pb.connected && !p3.connected && !pd.connected);
    const fehlerVor = g.errors;
    const m = await neu({ clientId: 'M', name: 'Mallory', color: 1, karte: roh });
    const pm = g.players.find((p) => p.clientId === 'M');
    ok(pm && g.players.length === 4, 'Server läuft weiter, Platz übernommen');
    ok(pm.karte.v === 1 && pm.karte.gesicht === 'lerche' && pm.karte.frisur === 'dutt' && pm.karte.bart === 'keiner' && pm.karte.haut === 0 && pm.karte.haar === 0 && eq(pm.karte.outfit, OUTFIT_STD), 'manipulierte Karte → Standardwerte je Feld');
    ok(!('admin' in pm.karte) && !('wf' in pm.karte) && !('hp' in pm.karte) && pm.hp !== 9999 && pm.wf !== 'lanze', 'zusätzliche Felder wirken nicht');
    ok(pm.name === 'Mallory' && pm.karte.name === 'Mallory', `ungültiger Kartenname → bisherige Namenslogik (${pm.name})`);
    ok(m.welcome.karten && m.welcome.karten[pm.id] && m.welcome.karten[pm.id].gesicht === 'lerche', 'Standardkarte steht im welcome');
    const m2 = await neu({ clientId: 'M', karte: 'Zeichenkette' });   // Wiederverbinden mit Müll als Karte
    ok(m2.welcome.karten[pm.id].gesicht === 'lerche' && pm.connected && g.errors === fehlerVor, 'Karte als Zeichenkette → Standardkarte, kein Serverfehler');
    ok(Protocol.VERSION === 8, 'Protokollversion 8');

    section('Übernahme eines getrennten Platzes ohne Karte');
    const e2 = await neu({ clientId: 'N', name: 'Nobody', color: 2 });
    const pn = g.players.find((p) => p.clientId === 'N');
    ok(pn && !pn.karte && pn.name === 'Nobody', 'Spieler ohne Karte erbt die Karte des früheren Platzbesitzers nicht');
    ok(!(e2.welcome.karten && e2.welcome.karten[pn.id]), 'und sie steht nicht in seinem welcome');
    await sleep(100);
    ok(m2.karten.some((e) => e.pid === pn.id && e.k === null), 'Ereignis karte { k: null } räumt den Eintrag der anderen');
  });

  await mitServer(async (g, neu) => {
    section('Doppelte Namen am Server');
    const a = await neu({ clientId: 'A', name: 'Ada', color: 0, karte: Object.assign(klon(STD), { name: 'Aurelia' }) });
    const b = await neu({ clientId: 'B', name: 'Bo', color: 1, karte: Object.assign(klon(STD), { name: 'aurelia' }) });
    const c = await neu({ clientId: 'C', name: 'Cy', color: 2, karte: Object.assign(klon(STD), { name: 'AURELIA' }) });
    ok(eq(g.players.map((p) => p.name), ['Aurelia', 'aurelia 2', 'AURELIA 3']), `gleicher Charaktername → Ziffer angehängt (${g.players.map((p) => p.name).join(' | ')})`);
    ok(g.players[1].karte.name === 'aurelia 2' && b.welcome.karten.p2.name === 'aurelia 2' && c.welcome.karten.p3.name === 'AURELIA 3', 'Kartenname = Spielername, auch im welcome');
    ok(a.welcome.karten.p1.name === 'Aurelia', 'erster behält den Namen');
    const d = await neu({ clientId: 'D', name: 'x', color: 3, karte: Object.assign(klon(STD), { name: 'Aurelia' }) });
    ok(g.players[3].name === 'Aurelia 4' && d.welcome.karten.p4.name === 'Aurelia 4', 'vierter: Aurelia 4');
  });

  await mitServer(async (g, neu) => {
    section('Ohne Karte erzwingt der Server keine Eindeutigkeit (wie heute)');
    const c1 = await neu({ clientId: 'X', name: 'Gleich', color: 0 });
    const c2 = await neu({ clientId: 'Y', name: 'Gleich', color: 1 });
    ok(g.players.map((p) => p.name).join() === 'Gleich,Gleich' && !c1.welcome.karten && !c2.welcome.karten, 'gleiche Namen bleiben gleich, welcome ohne karten');
    ok(!('karten' in c2.welcome), 'Feld karten fehlt im welcome, solange niemand eine Karte hat');
  });
}

(async () => {
  einheiten();
  namensschutz();
  await integration();
  console.log(`\n${n - fails}/${n} ok`);
  if (fails) console.log(`${fails} FEHLER`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
