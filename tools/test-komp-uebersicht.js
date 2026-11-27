'use strict';
// TEC-01 D: Übersicht der Schildkette-Komponenten (Technik-Konsole, Schadensplan): reine Funktionen in shared/komponenten-format.js (Texte, Bruchprozent, Aktionstexte, Zusammenfassung)
// und Protokollrunde technik.repair mit komp. Die Konsole (public/js/consoles.js) zeichnet nur; die Sichtprüfung ist tools/sicht-komp-uebersicht.js.
//   node tools/test-komp-uebersicht.js
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const KF = require('../shared/komponenten-format.js');
const { Game } = require('../server/game.js');
const I = require('../server/sim/interior.js');
const K = require('../server/sim/komponenten.js');
const BOTS = require('../server/sim/bots.js');
const fs = require('fs');
const path = require('path');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(title, fn) { console.log('\n[' + title + ']'); try { fn(); } catch (e) { fails++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); } }
const KD = CONFIG.systemModell.komponenten;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const S = (c) => KF.dekodiere(c, ['K', 'S', 'R']);
const E = (c) => KF.dekodiere(c, ['R', 'L']);
const st = (komp, systems) => ({ ship: { komp, systems } });

section('Bruchwahrscheinlichkeit: p = 0,3 + 0,1 · sp, höchstens 100 %', () => {
  ok(eq([0, 1, 2, 3, 4, 5, 6, 7].map((sp) => KF.bruchProzent(sp, KD)), [30, 40, 50, 60, 70, 80, 90, 100]), 'sp 0..7 = 30 40 50 60 70 80 90 100 % (Standard, Konfig ohne sprungBruch)');
  ok(KF.bruchProzent(7, KD) === 100 && KF.bruchProzent(9, KD) === 100 && KF.bruchChance(40, KD) === 1, 'sp 7 = 100 %, darüber bleibt es bei 100 %');
  ok(KF.bruchProzent(-3, KD) === 30 && KF.bruchProzent(NaN, KD) === 30 && KF.bruchProzent(undefined, KD) === 30 && KF.bruchProzent(2.9, KD) === 50, 'negativ/NaN/fehlend = sp 0; Bruchteile rundet ab');
  ok(KF.bruchProzent(0, null) === 30 && KF.bruchProzent(3, {}) === 60, 'ohne Konfig: Standard 0,3 / 0,1');
  const d = { sprungBruch: { grund: 0.5, proSprung: 0.05 } };
  ok(KF.bruchProzent(0, d) === 50 && KF.bruchProzent(4, d) === 70 && KF.bruchProzent(10, d) === 100, 'Konfig sprungBruch { grund 0,5, proSprung 0,05 } gilt: 50 / 70 / 100 %');
  ok(KF.bruchProzent(2, { sprungBruch: { grund: 'x', proSprung: -1 } }) === 50, 'ungültige Konfigwerte: Standard');
  ok(KF.bruchProzent(3, { sprungBruch: { grund: 0, proSprung: 0 } }) === 0, 'grund 0 und proSprung 0 sind gültig (kein Bruch)');
  // Gegenprobe mit dem Server (komponenten.sprungBruchChance) bei Standard und bei abgeänderter Konfig
  const g = new Game({ noStore: true, seed: 5, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const alt = JSON.stringify(g.C.systemModell.komponenten.sprungBruch || null);
  let gleich = true;
  for (const w of [null, { grund: 0.5, proSprung: 0.05 }]) {
    if (w) g.C.systemModell.komponenten.sprungBruch = w; else delete g.C.systemModell.komponenten.sprungBruch;
    for (let sp = 0; sp <= 9; sp++) if (Math.round(K.sprungBruchChance(g, sp) * 100) !== KF.bruchProzent(sp, g.C.systemModell.komponenten)) gleich = false;
  }
  if (alt !== 'null') g.C.systemModell.komponenten.sprungBruch = JSON.parse(alt); else delete g.C.systemModell.komponenten.sprungBruch;
  ok(gleich, 'bruchProzent == round(100 · server komponenten.sprungBruchChance) für sp 0..9, Standard und geänderte Konfig');
});

section('Zustands- und Ausfalltext', () => {
  ok(KF.zustandText('ok') === 'ok' && KF.zustandText('defekt') === 'DEFEKT' && KF.zustandText('geflickt') === 'geflickt' && KF.zustandText(null) === '?' && KF.zustandText('x') === '?', 'Zustand ok / DEFEKT / geflickt (Wort, nicht nur Farbe), unbekannt „?“');
  const R2 = KF.dekodiere('d;2;0', ['R']), R3 = KF.dekodiere('d;3;0', ['R']), R0 = KF.dekodiere('d', ['R']);
  ok(KF.ausfallText(R2[0], 3) === 'Ausfälle 2/3' && KF.ausfallText(R0[0], 3) === 'Ausfälle 0/3', 'Relais n 2: „Ausfälle 2/3“, n 0: „Ausfälle 0/3“');
  ok(KF.ausfallText(R3[0], 3) === 'verschlissen (3/3)' && KF.verschlissen(R3[0], 3) && !KF.verschlissen(R2[0], 3), 'Relais n 3: „verschlissen (3/3)“, verschlissen() erst ab der Schwelle');
  ok(KF.ausfallText(KF.dekodiere('d;9;0', ['R'])[0], 3) === 'verschlissen (3/3)', 'n über der Schwelle: ebenfalls verschlissen (3/3)');
  const k3 = KF.dekodiere('ddd;3,0,0;0,0,0', ['K', 'S', 'R']);
  ok(KF.ausfallText(k3[0], 3) === 'verschlissen (3/3)' && KF.ausfallText(k3[1], 3) === null && KF.ausfallText(k3[2], 3) === 'Ausfälle 0/3', 'Steuerkern führt den Zähler, Spannungsregler nicht, Relais ja');
  ok(KF.ausfallText(E('dd')[1], 3) === null && !KF.verschlissen(KF.dekodiere('dd;0,9;0,0', ['R', 'L'])[1], 3), 'Leitung hat keinen Ausfallzähler (auch nicht bei n im Text)');
  ok(KF.ausfallText(R2[0], 5) === 'Ausfälle 2/5' && KF.ausfallText(KF.dekodiere('d;5;0', ['R'])[0], 5) === 'verschlissen (5/5)', 'Schwelle aus den Daten (ausfallSperre 5)');
  ok(KF.ausfallText(R2[0]) === 'Ausfälle 2/3' && KF.ausfallText(null, 3) === null, 'ohne Schwelle: 3; ohne Komponente: null');
});

section('Bruchhinweis an geflickten Komponenten', () => {
  const l = S('ddg'); l[2].sp = 3;
  ok(KF.bruchText(l[2], KD) === 'bricht beim Sprung mit 60 %', 'geflickt, sp 3: „bricht beim Sprung mit 60 %“');
  ok(KF.bruchText(S('gdd')[0], KD) === 'bricht beim Sprung mit 30 %', 'frisch geflickt (sp 0): 30 %');
  const m = S('ggg'); m[0].sp = 7;
  ok(KF.bruchText(m[0], KD) === 'bricht beim Sprung mit 100 %', 'sp 7: 100 %');
  ok(KF.bruchText(S('odo')[1], KD) === null && KF.bruchText(S('odo')[0], KD) === null && KF.bruchText(null, KD) === null, 'defekt, ok und fehlend: kein Bruchhinweis');
  ok(KF.bruchText(l[2], { sprungBruch: { grund: 0.2, proSprung: 0.2 } }) === 'bricht beim Sprung mit 80 %', 'Konfigwerte aus den Daten, nicht fest');
});

section('Aktionstext je Komponente (dieselben Regeln wie zulaessigeZiele)', () => {
  const a = (l, t, sp) => KF.aktionText(l, t, sp || 3);
  ok(a(E('dd'), 'R') === 'Minispiel · Flicken · Tausch', 'Relais defekt, n < 3: „Minispiel · Flicken · Tausch“');
  ok(a(E('dd'), 'L') === 'Flicken · Tausch' && a(S('ddd'), 'K') === 'Flicken · Tausch' && a(S('ddd'), 'S') === 'Flicken · Tausch', 'K, S, L defekt: „Flicken · Tausch“ (kein Minispiel)');
  const v = E('dd'); v[0].n = 3;
  ok(a(v, 'R') === 'nur Flicken oder Tausch', 'Relais defekt und verschlissen: „nur Flicken oder Tausch“');
  const kv = S('ddd'); kv[0].n = 3;
  ok(a(kv, 'K') === 'Flicken · Tausch', 'Steuerkern defekt und verschlissen (n 3): „Flicken · Tausch“ (kein Minispiel in Stufe 1, „nur Flicken oder Tausch“ steht nur am Relais)');
  ok(a(E('gg'), 'R') === 'Minispiel · Tausch', 'Relais geflickt, n < 3: „Minispiel · Tausch“ (Flicken nur an defekten)');
  const gv = E('gg'); gv[0].n = 3;
  ok(a(gv, 'R') === 'nur Tausch' && a(E('gg'), 'L') === 'nur Tausch' && a(S('ggg'), 'K') === 'nur Tausch', 'geflickt und verschlissen / Leitung / Steuerkern geflickt: „nur Tausch“');
  ok(a(E('oo'), 'R') === null && a(S('ooo'), 'S') === null, 'heile Komponente: nichts zu tun (null)');
  ok(a(E('dd'), 'Q') === null && a(null, 'R') === null && a(E('dd'), undefined) === null, 'unbekannte Art / keine Liste: null');
  ok(KF.aktionText(E('dd'), 'R', 5) === 'Minispiel · Flicken · Tausch' && KF.aktionText(KF.dekodiere('dd;4,0;0,0', ['R', 'L']), 'R', 5) === 'Minispiel · Flicken · Tausch', 'Schwelle aus den Daten: n 4 bei Sperre 5 noch Minispiel');
  // Gegenprobe mit dem Server: für alle Zustandskombinationen und n 0/3 bietet der Text genau die Aktionen an, die reparaturZiel zulässt
  const g = new Game({ noStore: true, seed: 5, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  I.integritaetVoll(g); K.konsistentAlle(g);
  const Z = ['ok', 'defekt', 'geflickt'];
  let geprueft = 0, falsch = [];
  for (const [sys, rezept] of [['shields', ['K', 'S', 'R']], ['emitter_bow', ['R', 'L']]]) {
    const total = Math.pow(3, rezept.length);
    for (let c = 0; c < total; c++) for (const nn of [0, 3]) {
      K.erzeugeAusZustand(g, sys);
      rezept.forEach((t, i) => { const k = g.ship.komp[sys][i]; k.z = Z[Math.floor(c / Math.pow(3, i)) % 3]; k.n = (t === 'R' || t === 'K') ? nn : 0; });
      K.synchronisieren(g, sys);
      const l = KF.liste(g.snapshot(), KD, sys);
      for (const t of rezept) {
        const text = KF.aktionText(l, t, KF.sperreVon(KD));
        const srv = { minigame: K.reparaturZiel(g, sys, 'minigame', t).index != null, flick: K.reparaturZiel(g, sys, 'flick', t).index != null, swap: K.reparaturZiel(g, sys, 'swap', t).index != null };
        const hat = { minigame: /Minispiel/.test(text || ''), flick: /Flicken/.test(text || ''), swap: /Tausch/.test(text || '') };
        geprueft++;
        if (hat.minigame !== (srv.minigame && t === 'R') || hat.flick !== srv.flick || hat.swap !== srv.swap) falsch.push(sys + ' c' + c + ' n' + nn + ' ' + t + ': ' + text + ' / server ' + JSON.stringify(srv));
      }
    }
  }
  ok(!falsch.length && geprueft > 100, geprueft + ' Fälle (Schilde, Emitter, alle Zustände, n 0/3): Aktionstext == Server-Zulässigkeit ' + falsch.slice(0, 2).join(' || '));
});

section('Zeilenmodell, Ursache, Zusammenfassung, Kompakttext', () => {
  const l = S('ddg'); l[0].n = 1; l[2].n = 2; l[2].sp = 3;
  const z = KF.zeilen(l, KD);
  ok(z.length === 3 && z[0].name === 'Steuerkern' && z[0].zustand === 'DEFEKT' && z[0].ausfall === 'Ausfälle 1/3' && z[0].aktion === 'Flicken · Tausch' && z[0].bruch === null, 'Zeile Steuerkern: Name, Zustand, Ausfälle 1/3, Aktion');
  ok(z[1].name === 'Spannungsregler' && z[1].ausfall === null, 'Zeile Spannungsregler: kein Ausfallzähler');
  ok(z[2].name === 'Relais' && z[2].zustand === 'geflickt' && z[2].ausfall === 'Ausfälle 2/3' && z[2].bruch === 'bricht beim Sprung mit 60 %' && z[2].aktion === 'Minispiel · Tausch' && z[2].verschlissen === false, 'Zeile Relais geflickt: Ausfälle 2/3, 60 %, Minispiel · Tausch');
  ok(eq(KF.zeilen(null, KD), []) && eq(KF.zeilen([], KD), []), 'keine Liste: keine Zeilen');
  ok(KF.ursacheText(S('odo')) === 'Spannungsregler defekt' && KF.ursacheText(S('ooo')) === null && KF.ursacheText(null) === null, 'Ursache: eine defekte Komponente; heil und fehlend: null');
  ok(KF.ursacheText(S('ddg')) === 'Steuerkern, Spannungsregler defekt; Relais geflickt' && KF.ursacheText(S('dod')) === 'Steuerkern, Relais defekt' && KF.ursacheText(S('oog')) === 'Relais geflickt', 'Ursache gruppiert: defekte zuerst, dann geflickte');
  ok(KF.zusammenfassung('Schildgenerator', 'damaged', S('odo')) === 'Schildgenerator: beschädigt – Spannungsregler defekt', 'Zusammenfassung wie im Auftrag: „Schildgenerator: beschädigt – Spannungsregler defekt“');
  ok(KF.zusammenfassung('Schildgenerator', 'broken', S('ddg')) === 'Schildgenerator: zerstört – Steuerkern, Spannungsregler defekt; Relais geflickt', 'zerstört mit gemischter Ursache');
  ok(KF.zusammenfassung('Bug-Emitter', 'ok', E('og')) === 'Bug-Emitter: geflickt – Leitung geflickt' && KF.zusammenfassung('Bug-Emitter', 'ok', E('oo')) === 'Bug-Emitter: heil', 'heil mit Flicken heißt „geflickt“; alles ok: „heil“');
  ok(KF.zusammenfassung('X', 'offline', E('oo')) === 'X: offline (EMP)' && KF.zusammenfassung('X', undefined, null) === 'X: heil', 'offline (EMP); unbekannter Zustand und keine Liste: „heil“');
  ok(KF.kompaktText(S('ddg')) === 'K, S defekt; R geflickt' && KF.kompaktText(E('do')) === 'R defekt' && KF.kompaktText(E('oo')) === 'heil' && KF.kompaktText(null) === 'heil', 'Kompakttext: Art-Buchstaben mit Zustand, sonst „heil“');
  // Altformat und fehlende Felder: der Lesepunkt liefert trotzdem lesbare Zeilen
  const alt = KF.liste(st(undefined, { shields: 'damaged' }), KD, 'shields');
  ok(KF.zusammenfassung('Schildgenerator', 'damaged', alt) === 'Schildgenerator: beschädigt – Relais defekt', 'Altformat (kein ship.komp, damaged): letzte Komponente defekt, Zusammenfassung lesbar');
  ok(KF.zeilen(alt, KD).every((q) => typeof q.zustand === 'string' && q.bruch === null), 'Altformat: Zeilen vollständig, keine Bruchhinweise');
  const kaputt = KF.liste(st({ shields: 'kaputt' }, { shields: 'ok' }), KD, 'shields');
  ok(KF.zusammenfassung('Schildgenerator', 'ok', kaputt) === 'Schildgenerator: heil', 'unlesbarer Text: Rückfall auf den Systemzustand');
  const leer = KF.liste({}, KD, 'shields');
  ok(Array.isArray(leer) && leer.length === 3 && KF.ursacheText(leer) === null, 'Snapshot ohne ship: alles ok, kein Absturz');
  ok(KF.liste(st({}, { reactor: 'damaged' }), KD, 'reactor') === null && KF.liste(st({}, {}), KD, 'weapon_bow') === null, 'Reaktor und Waffe: kein Komponentenmodell (Konsole bleibt unverändert)');
  ok(KF.zeilen(KF.liste(st({ shields: 'o-d;0,0,0;0,0,0' }, { shields: 'damaged' }), KD, 'shields'), KD)[1].zustand === 'ok', "'-' im Text: Zustand aus dem Systemzustand (hier ok), kein Absturz");
});

section('Ziel der Reparaturliste: Modus -> Aktion, Ablehnungsgrund', () => {
  ok(KF.aktionFuerModus('flick') === 'flick' && KF.aktionFuerModus('part') === 'swap' && KF.aktionFuerModus(null) === null && KF.aktionFuerModus('x') === null, "Modus flick -> flick, part (Tausch) -> swap, sonst null");
  const l = S('dgo');
  ok(KF.ablehnGrund(l, 'flick', 'K', 3) === null && KF.ablehnGrund(l, 'part', 'K', 3) === null, 'defekte K: Flicken und Tausch zulässig');
  ok(KF.ablehnGrund(l, 'flick', 'S', 3) === 'Spannungsregler ist schon geflickt – für dauerhaft: Tausch' && KF.ablehnGrund(l, 'part', 'S', 3) === null, 'geflickte S: Flicken abgelehnt mit Grund, Tausch zulässig');
  ok(KF.ablehnGrund(l, 'flick', 'R', 3) === 'Relais ist heil' && KF.ablehnGrund(l, 'part', 'R', 3) === 'Relais ist heil', 'heiles Relais: weder Flicken noch Tausch');
  ok(KF.ablehnGrund(l, 'flick', 'Q', 3) === 'Keine Komponente gewählt' && KF.ablehnGrund(l, 'x', 'K', 3) === 'Keine Komponente gewählt' && KF.ablehnGrund(null, 'flick', 'K', 3) === 'Keine Komponente gewählt', 'unbekannte Art, unbekannter Modus, keine Liste: Hinweis statt Absturz');
});

section('Protokoll: technik.repair { system, mode, komp } bis queueRepairKomponente und in die Liste', () => {
  ok(Protocol.normKomp('S') === 'S' && Protocol.normKomp('z') === undefined, 'normKomp (gemeinsam mit act/repair.start)');
  const g = new Game({ noStore: true, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off' }, log: () => {} });
  const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'K0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'freie_fahrt' }); g.handleMessage(c, { t: 'ready', ready: true });
  for (let k = 0; k < Math.round(1 / (1 / CONFIG.tickHz)); k++) g.step();
  g.space.enemies = []; g.space.projectiles = [];
  for (const k of I.SYSTEM_ORDER) g.ship.systems[k] = 'ok';
  g.ship.fragile = {}; g.ship.offline = {}; g.ship.repairQueue = []; I.integritaetVoll(g); K.neuAufstellen(g);
  K.erzeugeAusZustand(g, 'shields'); g.ship.komp.shields[1].z = 'defekt'; K.synchronisieren(g, 'shields');
  const p = g.players[0]; p.console = 'technik';
  // Der Server-Befehl technik.repair ruft bots.queueRepairKomponente(game, system, mode, komp) (TEC-01 E). Hier wird DIESE Funktion abgehört (Argumente) und die Wirkung geprüft (Eintrag, Snapshot).
  const bekommen = []; const q0 = BOTS.queueRepairKomponente; BOTS.queueRepairKomponente = function (...a) { bekommen.push(a.slice(1)); return q0.apply(this, a); };
  const eintrag = () => g.ship.repairQueue.find((e) => e.system === 'shields');
  const snapEintrag = () => g.snapshot().ship.repairQueue.find((e) => e.system === 'shields');
  try {
    const send = (m) => g.handleMessage(c, Object.assign({ t: 'cmd', c: 'technik.repair' }, m));
    send({ system: 'shields', mode: 'flick', komp: 'S' });
    ok(eq(bekommen[0], ['shields', 'flick', 'S']), 'komp S kommt normalisiert bei queueRepairKomponente an: ' + JSON.stringify(bekommen[0]));
    ok(eintrag() && eintrag().komp === 'S' && eintrag().mode === 'flick', 'Wirkung: der Eintrag der Reparaturliste trägt komp S: ' + JSON.stringify(eintrag()));
    ok(eq(snapEintrag(), { system: 'shields', mode: 'flick', bot: null, komp: 'S' }), 'Wirkung: der Snapshot-Eintrag ist { system, mode, bot, komp }: ' + JSON.stringify(snapEintrag()));
    send({ system: 'shields', mode: 'flick' });
    ok(eq(bekommen[1], ['shields', 'flick', undefined]), 'ohne komp: undefined (wie bisher)');
    ok(eintrag() && !('komp' in eintrag()) && !('komp' in snapEintrag()), 'Wirkung: ohne komp trägt weder Eintrag noch Snapshot das Feld (Format unverändert)');
    send({ system: 'shields', mode: 'part', komp: 'Z' });
    ok(eq(bekommen[2], ['shields', 'part', undefined]) && eintrag() && eintrag().mode === 'part' && !('komp' in eintrag()), "unbekannte Art 'Z': kein Wunsch, Eintrag ohne komp");
    send({ system: 'shields', mode: 'part', komp: { x: 1 } });
    ok(eq(bekommen[3], ['shields', 'part', undefined]) && !('komp' in eintrag()), 'komp als Objekt: kein Wunsch, kein Absturz');
    send({ system: 'shields', mode: 'part', komp: 'K' });
    ok(eintrag() && eintrag().komp === 'K', 'Wunsch K nach einem Wunsch-losen Eintrag: der Eintrag wird aktualisiert (K)');
    send({ system: 'shields', mode: null, komp: 'K' });
    ok(eq(bekommen[5], ['shields', null, 'K']) && !eintrag(), 'Entfernen (mode null) trägt komp weiter; der Server entfernt den Eintrag');
    ok(g.ship.repairQueue.every((e) => e && typeof e.system === 'string' && typeof e.mode === 'string'), 'Reparaturliste bleibt wohlgeformt: ' + JSON.stringify(g.ship.repairQueue));
  } finally { BOTS.queueRepairKomponente = q0; }
  // TEC-01 Nacharbeit 1.3: normKomp sitzt an EINER Stelle (game.handleMessage); act und repair.start bekommen den Wunsch schon normalisiert
  const act0 = I.onAct, rep0 = I.repairCmd; const gesehen = [];
  I.onAct = function (game, pl, down, komp) { gesehen.push(['act', komp]); };
  I.repairCmd = function (game, pl, cmd, msg) { gesehen.push([cmd, msg.komp]); return null; };
  try {
    g.handleMessage(c, { t: 'act', down: true, komp: 'Z' }); g.handleMessage(c, { t: 'act', down: true, komp: 'S' }); g.handleMessage(c, { t: 'act', down: true });
    g.handleMessage(c, { t: 'cmd', c: 'repair.start', system: 'shields', komp: { x: 1 } }); g.handleMessage(c, { t: 'cmd', c: 'repair.start', system: 'shields', komp: 'R' });
    ok(eq(gesehen, [['act', undefined], ['act', 'S'], ['act', undefined], ['repair.start', undefined], ['repair.start', 'R']]), 'act und repair.start erhalten komp schon normalisiert (unbekannt = kein Wunsch): ' + JSON.stringify(gesehen));
  } finally { I.onAct = act0; I.repairCmd = rep0; }
  const treffer = []; (function lauf(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) lauf(p); else if (/\.js$/.test(e.name)) { const t = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter((z) => /normKomp\(/.test(z) && !/^\s*\/\//.test(z)).length; if (t) treffer.push(path.basename(p) + ' x' + t); } } })(path.join(__dirname, '..', 'server'));
  ok(eq(treffer, ['game.js x1']), 'Quellscan: normKomp( kommt in server/ genau einmal vor (game.js): ' + treffer.join(', '));
});

section('Layoutmodell der Komponentenübersicht (N1): jede Komponente eine Zeile, die gewählte immer sichtbar, nichts über die Grenze', () => {
  const P = 10, mess = (t) => t.length * 5, B = 182 - 11;   // Zeichen = 5 px (Näherung der Pixelschrift), Spaltenbreite wie im Schadensplan
  const folgenVon = (l, alleRechts) => KF.zeilen(l, KD).map((z) => KF.folgeZeilen([].concat(z.ausfall && !alleRechts ? [{ t: z.ausfall, k: 'ausfall' }] : [], z.bruch ? [{ t: z.bruch }] : [], z.aktion ? [{ t: z.aktion }] : []), B, mess).length);
  const hoehe = (lay, folgen) => lay.eintraege.reduce((h, e) => h + (1 + e.folgen) * P, 0) + (lay.mehr ? P : 0);
  const verletzt = (l, platz, wahl, alleRechts) => {
    const folgen = folgenVon(l, alleRechts), lay = KF.uebersichtLayout(folgen, wahl, platz, P), fehler = [];
    if (platz >= P && hoehe(lay, folgen) > platz) fehler.push('Höhe ' + hoehe(lay, folgen) + ' > ' + platz);
    const sichtbar = lay.eintraege.map((e) => e.i);
    if (folgen.length * P <= platz && (lay.mehr || sichtbar.length !== folgen.length)) fehler.push('Komponente ohne Kopfzeile bei passenden Kopfzeilen');
    if (wahl >= 0 && platz >= 2 * P && !sichtbar.includes(wahl)) fehler.push('gewählte unsichtbar');
    if (lay.stufe === 'voll' && lay.eintraege.some((e) => e.folgen !== folgen[e.i])) fehler.push('voll, aber gekürzt');
    if (lay.stufe === 'kompakt' && lay.eintraege.some((e) => e.i !== wahl && e.folgen !== 0)) fehler.push('kompakt: ungewählte nicht einzeilig');
    if (wahl >= 0 && lay.stufe === 'kompakt' && folgen.reduce((h, f, i) => h + (i === wahl ? 1 + f : 1) * P, 0) <= platz && lay.eintraege.find((e) => e.i === wahl).folgen !== folgen[wahl]) fehler.push('gewählte nicht voll, obwohl Platz');
    if (lay.mehr && lay.stufe !== 'mehr') fehler.push('mehrText vor der letzten Stufe');
    if (lay.mehr !== folgen.length - lay.eintraege.length) fehler.push('mehr zählt falsch');
    return fehler;
  };
  const worst = S('ggg'); worst[0].n = 3; worst[2].n = 3; worst.forEach((k) => { k.sp = 7; });
  const emitter = (c) => { const l = KF.dekodiere(c, ['R', 'L']); l[0].n = 3; l[1].sp = 7; return l; };
  const faelle = [['Generator ggg, Ausfälle 3/0/3, sp 7', worst], ['Generator ddd verschlissen', (() => { const l = S('ddd'); l[0].n = 3; l[2].n = 2; return l; })()], ['Generator ddg', S('ddg')], ['Generator ooo', S('ooo')], ['Emitter dg verschlissen, sp 7', emitter('dg')], ['Emitter gg', emitter('gg')]];
  let geprueft = 0; const falsch = [];
  for (const [nm, l] of faelle) for (const ar of [true, false]) for (let platz = 0; platz <= 260; platz += 1) for (let wahl = -1; wahl < l.length; wahl++) { geprueft++; const v = verletzt(l, platz, wahl, ar); if (v.length) falsch.push(nm + ' platz ' + platz + ' wahl ' + wahl + ' alleRechts ' + ar + ': ' + v.join('; ')); }
  ok(!falsch.length, geprueft + ' Kombinationen (Fall, Umbruch, Platz 0..260 px, Wahl): jede Komponente mit Kopfzeile, gewählte sichtbar, Höhe <= Platz, mehrText nur zuletzt ' + falsch.slice(0, 2).join(' || '));
  // der Befund: Generator ggg im Zustand „alles geflickt + verschlissen“ bei knappem Platz (der Plan zeigt 3 Komponenten, die dritte darf nicht fehlen)
  const fw = folgenVon(worst, true), voll = fw.reduce((h, f) => h + (1 + f) * P, 0);
  for (const wahl of [-1, 0, 1, 2]) {
    const lay = KF.uebersichtLayout(fw, wahl, voll - 3, P);
    ok(lay.stufe === 'kompakt' && lay.eintraege.length === 3 && lay.mehr === 0 && (wahl < 0 || lay.eintraege[wahl].folgen === fw[wahl]) && lay.eintraege.every((e) => wahl < 0 ? e.folgen === 0 : e.i === wahl || e.folgen === 0), 'ggg, 3 px zu wenig für alle voll, Wahl ' + wahl + ': alle drei Komponenten sichtbar, ' + (wahl < 0 ? 'alle als Kopfzeile' : 'die gewählte voll, die anderen als Kopfzeile'));
  }
  ok(KF.uebersichtLayout(fw, 2, voll, P).stufe === 'voll' && KF.uebersichtLayout(fw, -1, 3 * P - 1, P).stufe === 'mehr', 'Platz für alles: voll; nicht einmal drei Kopfzeilen: letzte Stufe (mehrText)');
  const m = KF.uebersichtLayout([2, 2, 2, 2, 2], 4, 3 * P, P);
  ok(m.stufe === 'mehr' && m.eintraege.some((e) => e.i === 4) && m.eintraege.length === 2 && m.mehr === 3, 'letzte Stufe mit fünf Komponenten und 3 Zeilen: die gewählte (5.) bleibt, eine Zeile für mehrText: ' + JSON.stringify(m));
  // 3 defekte + 4 beschädigte Emitter + Reaktor + Waffe: das gewählte System ist der Generator (Reaktor/Waffe haben kein Komponentenmodell), die Emitter stehen einzeilig darunter (Konsole), hier der Generator allein
  ok(!verletzt(S('ddd'), 80, 1, true).length && !verletzt(S('ddd'), 80, -1, true).length, 'Generator ddd bei 80 px: nichts ragt über die Grenze');
});

section('Legende zu Flicken (N2) nach Ansicht', () => {
  ok(KF.flickenLegende(true) === 'Flicken: bricht bei Sprung/Treffer', 'Schildkette-Ansicht: „bricht bei Sprung/Treffer“');
  ok(KF.flickenLegende(false) === 'Flicken: schnell, bricht bei Treffer', 'sonst (Reaktor, Waffe, Decksplan): „schnell, bricht bei Treffer“');
  ok(KF.flickenLegende(true).length <= 36 && KF.flickenLegende(false).length <= 36, 'höchstens 36 Zeichen');
});

console.log(`\n${n - fails}/${n} Prüfungen grün${fails ? ', ' + fails + ' FEHLER' : ''}`);
process.exit(fails ? 1 : 0);
