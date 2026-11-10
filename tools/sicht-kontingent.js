// Sichtprüfung LIV-02 P3: Frage „Limit erhöhen?“ (Kontingent-Popup) im ECHTEN Spiel, und die Nicht-Anzeige an allen anderen Stellen.
// Echter Server im selben Prozess (Freie Fahrt mit der Lobby-Option Live-Spielleiter, das Modell ist der Fake tools/fixtures/messe/fake-claude.js; Live-Schalter SPIELLEITER_LLM=live und LLM_LIVE=1, kleines Limit CLAUDE_TOKEN_BUDGET=60000, Schwelle 54 000), drei echte Browser-Clients (Playwright, Chromium):
// Spieler 1 (color 0, blaue Markierung) an der Captain-Konsole, Spieler 2 (color 1) am Helm, Spieler 3 (color 2) an der Waffen-Konsole. KEIN Aufruf an Claude: der Zähler wird im selben Prozess per
// LLM.addUsage auf 54 000 gesetzt; mit Zähler über der Schwelle fragt kein Spielleiter (kein CLI-Prozess), das Spiel läuft im Rückfall weiter.
// Zwei Läufe mit je eigenem Server (Port und Port+1): Lauf NEIN, Lauf JA. Prüfungen je Lauf (Exit 1 bei einer verfehlten):
//   a  Vor dem Erreichen, an allen drei Konsolen: nichts Kontingent-Bezogenes im DOM (kein #kontingentFrage, kein #kontingent, kein Streifen/Knopf, kein Wort Kontingent/Limit/Token im sichtbaren Text, keine Funkzeile)
//   a2 Nach dem Erreichen, Spieler ohne color 0 (Helm, Waffen): weiter nichts im DOM und im Bild; kein Funk „Kontingent“, kein world.kontingent im Snapshot
//   b  Spieler mit color 0: das Popup erscheint genau einmal (ein Ereignis kontingentFrage), ohne Zahl, Knöpfe Ja/Nein
//   c  Lauf NEIN: Klick auf Nein: Popup weg, erscheint nicht erneut (auch nach weiteren Ticks), Limit unverändert, Rückfall läuft weiter (Spielzeit läuft, keine Serverfehler)
//   d  Lauf JA: Klick auf Ja: Popup weg, Limit +500 000 (Server-Zustand), Spiel läuft weiter
//   e  Popup offen: es verdeckt keine Bedienfläche an Captain-, Helm- und Waffen-Konsole (kein sichtbares interaktives DOM-Element schneidet das Popup), Bilder für den Designer-Review
// Bilder (Standard-Ordner: Temp-Ordner „pantheon-kontingent-shots“, nie im Repo): nein-1-vorher-captain.png, nein-2-popup-captain.png, nein-3-popup-helm.png, nein-4-popup-waffen.png,
//   nein-5-ohne-farbe0-helm.png, nein-6-ohne-farbe0-waffen.png, nein-7-nach-nein-captain.png, ja-1-popup-captain.png, ja-2-nach-ja-captain.png
// Aufruf: node tools/sicht-kontingent.js [--port 3400] [--shots <Ordner>]
// Exit 0 = alles stimmte, 1 = Prüfung verfehlt oder Seitenfehler, 2 = ohne Playwright.
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3400');
const SHOTS = path.resolve(arg('shots', path.join(os.tmpdir(), 'pantheon-kontingent-shots')));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sicht-kontingent-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
process.env.CLAUDE_TOKEN_BUDGET = '60000'; process.env.TELEMETRIE = 'aus';   // nichts nach data/ im Repo (Telemetrie aus, noStore beim Server)
process.env.SPIELLEITER_LLM = 'live'; process.env.LLM_LIVE = '1'; process.env.CLAUDE_CLI = path.join(__dirname, 'fixtures', 'messe', 'fake-claude.js'); process.env.FAKE_ZAEHLER_DIR = fs.mkdtempSync(path.join(TMP, 'zaehler-'));   // CLAUDE_CLI ist der Fake (kein echter Claude, kein Abo); die Freie Fahrt mit Live-Option ruft ihn evtl. vor der Schwelle   // Live-Schalter an (nur dann gibt es die Frage); das Modell wird nie gefragt: der Zähler steht vor jedem Spielleiter-Aufruf über der Schwelle
const { startServer } = require('../server/index.js');
const LLM = require('../server/mission/llm.js');
const Kontingent = require('../server/sim/kontingent.js');
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.error('playwright-core nicht gefunden'); process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fehler = [];
const pruefe = (c, t) => { console.log((c ? '  ok   ' : '  FEHLER ') + t); if (!c) fehler.push(t); };

// Alles Kontingent-Bezogene im Client: Elemente, Text (auch unsichtbarer Text zählt nicht, aber sichtbarer), Store, Funkzeilen
const SPUR = () => {
  const ids = ['kontingentFrage', 'kontingent'].filter((i) => document.getElementById(i) && getComputedStyle(document.getElementById(i)).display !== 'none');
  const text = (document.body.innerText || '').replace(/\s+/g, ' ');
  const treffer = text.match(/kontingent|limit erhöhen|token-?limit|tokens?\b/i);
  const kf = window.KontingentFrage ? window.KontingentFrage.store.offen : false;
  const knoepfe = [...document.querySelectorAll('button')].filter((b) => /freigeben|\bja\b|\bnein\b/i.test(b.textContent) && b.getBoundingClientRect().width > 0 && !b.closest('#kontingentFrage')).map((b) => b.textContent.trim());
  const snap = window.__game && window.__game.state && window.__game.state.world ? ('kontingent' in window.__game.state.world) : false;
  return { ids, treffer: treffer ? treffer[0] : null, storeOffen: kf, knoepfe, snapFeld: snap };
};

async function lauf(name, port, ja) {
  console.log(`\n=== Lauf ${name} (Port ${port}) ===`);
  LLM.resetBudget(); LLM.setBudgetLimit(60000);
  const srv = await startServer({ port, debug: true, roomCode: 'off', quiet: true, worlds: true, noStore: true, worldDir: path.join(TMP, 'worlds-' + name) });
  const g = srv.game;
  const b = await chromium.launch();
  const bild = async (p, n) => { const f = path.join(SHOTS, `${name}-${n}.png`); await p.screenshot({ path: f }); console.log('Bild ' + f); return f; };
  try {
    const neu = async (n) => {
      const page = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
      page.on('pageerror', (e) => fehler.push(name + ' ' + n + ' pageerror: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error') fehler.push(name + ' ' + n + ' console: ' + m.text().slice(0, 200)); });
      await page.goto(`http://127.0.0.1:${port}/?render=2d`);
      await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000 });
      await page.evaluate(() => { window.__fragen = 0; window.__funk = []; Net.on((m) => { if (m.t === 'event' && m.kind === 'kontingentFrage') window.__fragen++; if (m.t === 'event' && m.kind === 'radio') window.__funk.push(m.text); }); });
      return page;
    };
    const eins = await neu('spieler1');   // zuerst: bekommt color 0
    await eins.evaluate(() => { __game.send({ t: 'lobbyOpt', startMission: 'freie_fahrt' }); });
    await sleep(300);
    await eins.evaluate(() => { __game.send({ t: 'lobbyOpt', liveSpielleiter: true }); });
    const zwei = await neu('spieler2'), drei = await neu('spieler3');
    await sleep(400);
    for (const p of [eins, zwei, drei]) await p.evaluate(() => { __game.send({ t: 'ready', ready: true }); });
    for (const p of [eins, zwei, drei]) await p.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    await sleep(500);
    const farben = g.players.map((p) => p.color);
    pruefe(farben[0] === 0 && farben[1] === 1 && farben[2] === 2, 'Farben der drei Spieler 0, 1, 2 (' + farben.join(',') + '): Spieler 1 trägt die blaue Markierung');
    const sitz = (p, c) => p.evaluate((cc) => __game.send({ t: 'debug', cmd: 'sitz', console: cc }), c);
    await sitz(eins, 'captain'); await sitz(zwei, 'helm'); await sitz(drei, 'weapons');
    await sleep(900);
    const alle = [['Captain', eins], ['Helm', zwei], ['Waffen', drei]];
    const frage = (p) => p.evaluate(() => { const e = document.getElementById('kontingentFrage'); if (!e || getComputedStyle(e).display === 'none') return null; const r = e.getBoundingClientRect(); return { text: e.innerText.replace(/\s+/g, ' '), x: r.x, y: r.y, w: r.width, h: r.height, knoepfe: [...e.querySelectorAll('button')].map((k) => k.textContent) }; });
    const weg = (p) => p.waitForFunction(() => { const e = document.getElementById('kontingentFrage'); return !e || getComputedStyle(e).display === 'none'; }, null, { timeout: 8000 }).then(() => true, () => false);
    const da = (p) => p.waitForFunction(() => { const e = document.getElementById('kontingentFrage'); return e && getComputedStyle(e).display !== 'none'; }, null, { timeout: 8000 }).then(() => true, () => false);

    // a: vor dem Erreichen
    pruefe(LLM.budget().used < 54000, 'Zähler ' + LLM.budget().used + ' von 60 000, unter der Schwelle 54 000; Live-Spielleiter an: ' + (g.env && g.env.SPIELLEITER_LLM));
    await sleep(1200);
    for (const [n, p] of alle) { const s = await p.evaluate(SPUR); pruefe(!s.ids.length && !s.treffer && !s.storeOffen && !s.knoepfe.length && !s.snapFeld, `a ${n}: vor dem Erreichen nichts Kontingent-Bezogenes im DOM (${JSON.stringify(s)})`); }
    await bild(eins, '1-vorher-captain');

    // Erreichen der Schwelle
    LLM.addUsage(54000);
    const t0 = g.time; pruefe(Kontingent.live(g), 'Live-Modus des Spiels (Voraussetzung der Frage)');
    pruefe(await da(eins), 'b Spieler 1 (color 0): das Popup erscheint bei 54 000 von 60 000');
    await sleep(1500);
    const f = await frage(eins);
    pruefe(!!f && /Limit erhöhen\?/.test(f.text) && f.knoepfe.join() === 'Ja,Nein', 'b Popup mit Titel „Limit erhöhen?“ und den Knöpfen Ja / Nein (' + (f && f.text) + ')');
    pruefe(!!f && !/\d/.test(f.text.replace(/Limit erhöhen\?/, '')), 'b Popup nennt keine Zahl');
    pruefe((await eins.evaluate(() => window.__fragen)) === 1, 'b Frage genau einmal zugestellt (Ereignis kontingentFrage)');
    pruefe(g.kontingent && g.kontingent.frage && g.kontingent.frage.offen === true, 'Server: Frage offen');
    // a2: die anderen sehen nichts
    for (const [n, p] of alle.slice(1)) { const s = await p.evaluate(SPUR); const fz = await p.evaluate(() => ({ fragen: window.__fragen, funk: window.__funk })); pruefe(!s.ids.length && !s.treffer && !s.storeOffen && !s.knoepfe.length && !s.snapFeld && fz.fragen === 0 && !fz.funk.some((x) => /kontingent/i.test(x)), `a2 ${n} (ohne color 0): nach dem Erreichen nichts im DOM, kein Ereignis, kein Funk (${JSON.stringify(s)})`); }
    if (name === 'nein') { await bild(zwei, '5-ohne-farbe0-helm'); await bild(drei, '6-ohne-farbe0-waffen'); }
    const fkap = await eins.evaluate(() => { const fz = window.__funk || []; return fz.some((x) => /kontingent/i.test(x)); });
    pruefe(!fkap, 'b kein Funk „Kontingent“ auch beim Spieler mit color 0');

    // e: Popup offen an Captain, Helm, Waffen: Überdeckung, Bilder (der Spieler mit color 0 setzt sich nacheinander an die drei Konsolen)
    const verdeckt = (p) => p.evaluate(() => {
      const e = document.getElementById('kontingentFrage'); const r = e.getBoundingClientRect(); const out = [];
      for (const el of document.querySelectorAll('button,a,input,select,textarea,[role=button],[onclick],[tabindex]')) {
        if (e.contains(el) || el.tagName === 'CANVAS') continue;   // das Spielfeld-Canvas liegt immer darunter (Bedienflächen im Canvas prüft das Auge am Bild)
        const q = el.getBoundingClientRect(); const cs = getComputedStyle(el);
        if (q.width < 2 || q.height < 2 || cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none' || +cs.opacity === 0) continue;
        if (q.right > r.left && q.left < r.right && q.bottom > r.top && q.top < r.bottom) out.push((el.id || el.className || el.tagName) + '');
      }
      return { out, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
    });
    if (name === 'nein') {
      for (const [konsole, bn] of [['captain', '2-popup-captain'], ['helm', '3-popup-helm'], ['weapons', '4-popup-waffen']]) {
        await sitz(eins, konsole); await sleep(900);
        pruefe(await da(eins), `e Popup bleibt offen an der Konsole ${konsole}`);
        const v = await verdeckt(eins);
        pruefe(v.out.length === 0, `e Konsole ${konsole}: das Popup (${JSON.stringify(v.rect)}) verdeckt kein interaktives DOM-Element (${v.out.join(', ') || 'keins'})`);
        await bild(eins, bn);
      }
      await sitz(eins, 'captain'); await sleep(600);
    } else await bild(eins, '1-popup-captain');

    if (!ja) {
      // c: Nein
      const limitVor = LLM.budget().limit;
      await eins.locator('#kontingentFrage .kf-nein').click();
      pruefe(await weg(eins), 'c Nein: Popup verschwindet');
      await sleep(3500);
      pruefe(await weg(eins) && (await eins.evaluate(() => window.__fragen)) === 1, 'c Nein: das Popup erscheint nicht erneut (3,5 s später, weiter ein Ereignis)');
      pruefe(LLM.budget().limit === limitVor && g.kontingent.frage.abgelehnt === true && g.kontingent.frage.offen === false, 'c Nein: Limit unverändert (' + LLM.budget().limit + '), Server: abgelehnt, nicht offen');
      pruefe(g.time > t0 + 2 && (g.errors || []).length === 0 && g.phase !== 'lobby', 'c Rückfall: Spiel läuft weiter (Spielzeit ' + Math.round(t0) + ' -> ' + Math.round(g.time) + ', Serverfehler ' + (g.errors || []).length + ')');
      const s = await eins.evaluate(SPUR);
      pruefe(!s.ids.length && !s.treffer && !s.storeOffen, 'c Nein: nichts Kontingent-Bezogenes mehr im DOM');
      await eins.keyboard.press('Digit2'); await sleep(300);
      await bild(eins, '7-nach-nein-captain');
    } else {
      // d: Ja
      const limitVor = LLM.budget().limit;
      await eins.locator('#kontingentFrage .kf-ja').click();
      pruefe(await weg(eins), 'd Ja: Popup verschwindet');
      await sleep(800);
      pruefe(LLM.budget().limit === limitVor + 500000 && LLM.budget().limit === 560000, 'd Ja: Limit +500 000 laut Server (' + limitVor + ' -> ' + LLM.budget().limit + ')');
      pruefe(!(g.kontingent.frage && g.kontingent.frage.offen), 'd Ja: Server: Frage geschlossen');
      await sleep(2500);
      pruefe(await weg(eins) && (await eins.evaluate(() => window.__fragen)) === 1, 'd Ja: kein zweites Popup');
      pruefe(g.time > t0 + 2 && (g.errors || []).length === 0, 'd Spiel läuft weiter, Serverfehler ' + (g.errors || []).length);
      await bild(eins, '2-nach-ja-captain');
    }
  } finally {
    await b.close();
    try { await srv.close(); } catch (er) { /* egal */ }
    LLM.resetBudget();
  }
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  await lauf('nein', PORT, false);
  await lauf('ja', PORT + 1, true);
  console.log(fehler.length ? '\nFEHLER (' + fehler.length + '):\n  ' + fehler.join('\n  ') : '\nalles ok, Bilder in ' + SHOTS);
  process.exit(fehler.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
