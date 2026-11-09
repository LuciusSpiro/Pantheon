// Sichtprüfung LIV-01 A2: Kontingent-Meldung im ECHTEN Spiel. Echter Server im selben Prozess (Freie Fahrt, Live-Schalter SPIELLEITER_LLM=live und LLM_LIVE=1, CLAUDE_TOKEN_BUDGET=60000),
// zwei echte Browser-Clients (Playwright, Chromium): Captain an der Captain-Konsole und ein zweiter Spieler am Helm. KEIN Aufruf an Claude: der Zähler wird im selben Prozess per
// LLM.addUsage auf 54 000 gesetzt (Schwelle 90 %), mit Zähler über der Schwelle fragt kein Spielleiter (kein CLI-Prozess).
// Ablauf und Prüfungen (Exit 1 bei einer verfehlten):
//   0. Server nicht live, Zähler 54 000: Client unverändert (kein Element #kontingent, Kontingent.store.block leer)
//   1. Live-Schalter an: Meldung beim Captain (Verbrauch 54 000 / 60 000, Knopf aktiv, Tastenkappe Sh+K)  -> Bild 1-captain-meldung.png
//   2. Zweiter Spieler am Helm: gleiche Meldung, Knopf inaktiv, Hinweis „Nur an der Captain-Konsole“, Taste sendet nichts -> Bild 2-nicht-captain-meldung.png
//   3. Doppelklick auf den Knopf beim Captain: Limit 560 000 (nicht 1 060 000), Meldung weg bei beiden, Spiel bedienbar -> Bild 3-captain-nach-freigabe.png
// Aufruf: node tools/sicht-kontingent.js [--port 3400] [--shots <Ordner>]   (Standard-Ordner: Temp-Ordner „pantheon-kontingent-shots“, nie im Repo)
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
process.env.CLAUDE_TOKEN_BUDGET = '60000';
process.env.SPIELLEITER_LLM = 'off'; delete process.env.LLM_LIVE;   // Phase 0: nicht live; der Schalter wird erst später im Lauf gesetzt (game.env ist process.env, der Server liest ihn je Snapshot)
const { startServer } = require('../server/index.js');
const LLM = require('../server/mission/llm.js');
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.error('playwright-core nicht gefunden'); process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const fehler = [];
  const pruefe = (c, t) => { console.log((c ? '  ok   ' : '  FEHLER ') + t); if (!c) fehler.push(t); };
  LLM.resetBudget(); LLM.setBudgetLimit(60000);
  const srv = await startServer({ port: PORT, debug: true, roomCode: 'off', quiet: true, worlds: true, worldDir: path.join(TMP, 'worlds') });
    const b = await chromium.launch();
  try {
    const neu = async (name) => {
      const page = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
      page.on('pageerror', (e) => fehler.push(name + ' pageerror: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error') fehler.push(name + ' console: ' + m.text().slice(0, 200)); });
      await page.goto(`http://127.0.0.1:${PORT}/?render=2d`);
      await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000 });
      return page;
    };
    const captain = await neu('captain');
    await captain.evaluate(() => { __game.send({ t: 'lobbyOpt', startMission: 'freie_fahrt' }); });
    const zweiter = await neu('zweiter');   // beide in der Lobby, dann gemeinsam los
    await sleep(300);
    for (const p of [captain, zweiter]) await p.evaluate(() => { __game.send({ t: 'ready', ready: true }); });
    for (const p of [captain, zweiter]) await p.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    await sleep(500);
    const sitz = (p, c) => p.evaluate((cc) => __game.send({ t: 'debug', cmd: 'sitz', console: cc }), c);
    await sitz(captain, 'captain'); await sitz(zweiter, 'helm');
    await sleep(900);
    const el = (p) => p.evaluate(() => { const e = document.getElementById('kontingent'); if (!e) return null; const k = e.querySelector('button'); const r = e.getBoundingClientRect(); return { sichtbar: getComputedStyle(e).display !== 'none' && r.width > 0, text: e.innerText.replace(/\s+/g, ' '), knopfAus: k.disabled, kappe: e.querySelector('.k-kappe').textContent, titel: k.title, y: r.y, h: r.height }; });
    const sichtbar = (p) => p.waitForFunction(() => { const e = document.getElementById('kontingent'); return e && getComputedStyle(e).display !== 'none'; }, null, { timeout: 8000 }).then(() => true, () => false);
    const weg = (p) => p.waitForFunction(() => { const e = document.getElementById('kontingent'); return !e || getComputedStyle(e).display === 'none'; }, null, { timeout: 8000 }).then(() => true, () => false);
    const block = (p) => p.evaluate(() => (window.Kontingent ? Kontingent.store.block : 'fehlt'));

    // 0. nicht live, Zähler über der Schwelle: der Client bleibt unverändert
    console.log('Phase 0: Zähler 54 000, kein Live-Schalter');
    LLM.addUsage(54000);
    await sleep(1500);
    for (const [n, p] of [['Captain', captain], ['Helm', zweiter]]) {
      pruefe((await el(p)) === null, n + ': kein DOM-Element #kontingent ohne Live-Schalter');
      pruefe((await block(p)) === null, n + ': Kontingent.store.block leer (der Server sendet world.kontingent nicht)');
    }

    // 1. Live an: die Meldung erscheint beim Captain
    console.log('Phase 1: Live-Schalter an');
    process.env.SPIELLEITER_LLM = 'live'; process.env.LLM_LIVE = '1';
    pruefe(await sichtbar(captain), 'Captain: Meldung erscheint bei 54 000 von 60 000');
    pruefe(await sichtbar(zweiter), 'Helm: Meldung erscheint');
    await sleep(400);
    let e = await el(captain);
    pruefe(e && /Kontingent aufgebraucht/i.test(e.text) && /54.000 \/ 60.000/.test(e.text), 'Captain: Titel und Verbrauch 54 000 / 60 000 im Text (' + (e && e.text) + ')');
    pruefe(e && /Spiel läuft weiter/.test(e.text) && /500.000 Tokens freigeben/.test(e.text), 'Captain: Hinweis „Spiel läuft weiter“ und Knopf „500 000 Tokens freigeben“');
    pruefe(e && !e.knopfAus && e.kappe === 'Sh+K', 'Captain: Knopf aktiv, Tastenkappe „' + (e && e.kappe) + '“');
    pruefe(e && e.y >= 0 && e.y + e.h <= 200, 'Captain: Streifen oben im Bild (y ' + (e && Math.round(e.y)) + ', Höhe ' + (e && Math.round(e.h)) + ')');
    pruefe((await captain.evaluate(() => window.innerWidth >= 0 && document.getElementById('kontingent').style.pointerEvents !== 'auto')), 'Streifen fängt keine Mausklicks außerhalb des Knopfes (pointer-events none)');
    await captain.screenshot({ path: path.join(SHOTS, '1-captain-meldung.png') }); console.log('Bild 1-captain-meldung.png');

    // 2. zweiter Spieler: sieht die Meldung, bedient nichts
    const limitVor = LLM.budget().limit;
    e = await el(zweiter);
    pruefe(e && /Kontingent aufgebraucht/i.test(e.text) && /54.000 \/ 60.000/.test(e.text), 'Helm: gleiche Meldung mit Verbrauch');
    pruefe(e && e.knopfAus && /Nur an der Captain-Konsole/.test(e.text), 'Helm: Knopf inaktiv, Hinweis „Nur an der Captain-Konsole“');
    await zweiter.keyboard.press('Shift+KeyK'); await sleep(600);
    pruefe(LLM.budget().limit === limitVor, 'Helm: die Taste Sh+K gibt nichts frei (Limit ' + LLM.budget().limit + ')');
    await zweiter.screenshot({ path: path.join(SHOTS, '2-nicht-captain-meldung.png') }); console.log('Bild 2-nicht-captain-meldung.png');

    // 3. Doppelklick beim Captain
    console.log('Phase 3: Doppelklick auf den Knopf');
    const knopf = captain.locator('#kontingent button');
    const box = await knopf.boundingBox();
    await captain.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(300);
    pruefe(await weg(captain), 'Captain: Meldung verschwindet nach der Freigabe');
    pruefe(await weg(zweiter), 'Helm: Meldung verschwindet ebenfalls');
    pruefe(LLM.budget().limit === 560000, 'Limit genau 560 000 nach Doppelklick (' + LLM.budget().limit + ')');
    const bl = await block(captain);
    pruefe(bl && bl.limit === 560000 && bl.erreicht === false, 'Client-Stand: Limit 560 000, nicht erreicht');
    // Spiel bleibt bedienbar: eine Konsolentaste wirkt (Reiter Sternkarte der Captain-Konsole)
    await captain.keyboard.press('Digit2'); await sleep(400);
    pruefe(await captain.evaluate(() => !!__game.state && __game.state.phase !== 'lobby'), 'Spiel läuft weiter, die Konsolentaste 2 wirkt ohne Fehler (Seitenfehler würden unten gemeldet)');
    await captain.screenshot({ path: path.join(SHOTS, '3-captain-nach-freigabe.png') }); console.log('Bild 3-captain-nach-freigabe.png');
  } finally {
    await b.close();
    await new Promise((r) => { try { srv.close ? srv.close(r) : r(); } catch (er) { r(); } });
    LLM.resetBudget();
  }
  console.log(fehler.length ? '\nFEHLER (' + fehler.length + '):\n  ' + fehler.join('\n  ') : '\nalles ok, Bilder in ' + SHOTS);
  process.exit(fehler.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
