'use strict';
// TRA-01 C2 (Client): Trainingsliste an der Konsole (public/js/training-hud.js): Checkliste und letzter Hinweis (ODA) auch dort, wo das HUD sie nicht zeichnet.
//   Entscheidung  zeigt(view): Training (Fliegen, Captain) an einer Konsole: ja; Kampagne, Tutorial, Labor, Forschungsstation (echte Partien, echter Snapshot): nein; zu Fuß: nein; ohne Buch/Ansicht: nein
//   Modell        Titel, höchstens 7 Ziele (+n weitere), Haken, optional, aktuelles Ziel (erstes offene Pflichtziel; sonst erstes offene); gleiche Quelle wie das HUD (Hud.zieleVon)
//   Hinweis       letzte ODA-Zeile bleibt 25 s stehen; Voxel-Sitz vorn (die ODA steht selbst da): keine Hinweiszeile; Hinweis fehlt ohne ODA
//   Platz         Voxel vorn oben links; Steuer, Ops, Captain (Reiter) im gemessenen freien Bereich über der Statusleiste; unbekannte Konsole: keine Liste; ohne Pult im Bild: keine Liste
//   Zeichnen      gegen ein Fake-Canvas: Höhe und Zeilen begrenzt, Haken = erledigte Ziele, „(opt.)“ bleibt bei gekürztem Text, Hinweis höchstens drei Zeilen, kompakter Streifen, nichts außerhalb des Bilds/des freien Bereichs
//   Nacharbeit 2  S2 Ziele umbrechen statt kürzen; S3 nach dem Abschluss bleibt die abgehakte Liste mit „Neustart in N s“ bis zum Neustart; S5 Captain-Reiter Funk: kein Streifen; S6 Streifen der Sternkarte oben links auf der Karte;
//                 S7 fremde Konsole: Streifen „am Steuer: …“ ohne Taste; S8 Hauptschirm: Hinweis unter dem Strich, sobald die ODA weg ist
//   Abschluss     Ereignis missionDone eines gewonnenen Trainings: „Auftrag erledigt“ entfällt (das Abzeichen meldet); verloren/Kampagne: bleibt
//   Verdrahtung   client.js zeichnet nach der Konsole, index.html lädt die Datei, drawObjectives liest Hud.zieleVon, das HUD zeichnet zu Fuß weiter (nicht doppelt)
//   Snapshot      die Anzeige braucht kein neues Feld: Snapshot-Missionsfelder unverändert (Liste der bekannten Schlüssel), Snapshot mit/ohne Client-Modul byte-gleich
//   Mutationen    Regeln im Quelltext zerstören, die Kernprüfung muss rot werden
//   node tools/test-training-hud.js
const fs = require('fs');
const path = require('path');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');

const ROOT = path.join(__dirname, '..');
const lies = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const Q = lies('public', 'js', 'training-hud.js').replace(/\r?\n/g, '\n'), Q_CLIENT = lies('public', 'js', 'client.js'), Q_CONSOLES = lies('public', 'js', 'consoles.js'), Q_HUD = lies('public', 'js', 'hud.js'), Q_INDEX = lies('public', 'index.html');
const DT = 1 / CONFIG.tickHz;
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); };
function section(name, fn) { console.log('\n[' + name + ']'); try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); } }
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function laden(src) { const m = { exports: {} }; new Function('module', 'exports', 'self', src)(m, m.exports, undefined); return m.exports; }

// Zieleliste wie im Browser: Hud.zieleVon aus hud.js (Quelltext des Objekts herausgeschnitten, damit der Test die echte Quelle prüft)
const zieleVon = (() => {
  const m = /zieleVon\(st\) \{([\s\S]*?)\n    \},\r?\n    drawObjectives/.exec(Q_HUD);
  if (!m) throw new Error('Hud.zieleVon nicht gefunden');
  return new Function('st', m[1]);
})();

// Fake-Render: feste Zeichenbreite 5 px, wrap wie render.js, Aufzeichnung aller Zeichenaufrufe
function fakeR() {
  const measure = (t) => String(t).length * 5;
  const wrap = (str, maxW) => { const lines = []; let line = ''; for (const w of String(str || '').split(/\s+/)) { const t = line ? line + ' ' + w : w; if (measure(t) > maxW && line) { lines.push(line); line = w; } else line = t; } if (line) lines.push(line); return lines; };
  const calls = { texte: [], rects: [], fills: [], strokes: [] };
  const R = { PAL: { brass: '#B', amber: '#A', star: '#S', moss: '#M', mint: '#MI', panelLight: '#PL' }, measure, wrap,
    text(ctx, s, x, y, o) { calls.texte.push({ s, x, y, color: o && o.color, align: o && o.align }); },
    backdrop(ctx, x, y, w, h) { calls.rects.push({ x, y, w, h }); } };
  const ctx = { fillRect(x, y, w, h) { calls.fills.push({ x, y, w, h, c: this.fillStyle }); }, strokeRect(x, y, w, h) { calls.strokes.push({ x, y, w, h, c: this.strokeStyle }); }, fillStyle: '', strokeStyle: '', lineWidth: 1 };
  return { R, ctx, calls };
}

const ZIELE7 = [
  { text: 'Ablegen, Schub hoch (W)', done: true }, { text: 'Temporegler runter (S)', done: false }, { text: 'Ruder legen (A / D)', done: false },
  { text: 'Allstopp (X)', done: true }, { text: 'Ausweichrolle (Shift+A / D)', done: false, optional: true }, { text: 'Hafenstation anfliegen', done: false }, { text: 'Zurück in den Hafen', done: false },
];
const mission = (id, objs, titel) => ({ active: id ? { id, title: titel || 'Training Fliegen', objectives: objs } : null, focusTitle: titel || 'Training Fliegen', focusObjectives: objs });
// zeit: Sekunden (steuerbar), oda: { text } | null, sitz: { station, blick } | null
function bau(Mod, o) {
  o = o || {};
  const f = fakeR();
  const H = { oda: { cur: o.oda || null }, zieleVon };
  const sitz = o.sitz || null;
  const zeit = { t: 100 };
  const pult = o.pult === false ? { konsole: () => null } : o.pult === 'ohneS' ? { konsole: () => ({ station: 'helm' }) } : { konsole: () => ({ S: o.S || 200, station: o.konsole || 'helm' }) };
  const C = { tab: o.tab || 0 };
  const api = Mod.erzeuge({ R: f.R, H, Pult: pult, Consoles: C, Sitz: sitz, jetzt: () => zeit.t });
  const view = (extra) => Object.assign({ me: { console: o.konsole === undefined ? 'helm' : o.konsole }, voxel: !!o.voxel, state: { mission: mission(o.buch === undefined ? 'tra_fliegen' : o.buch, o.objs || ZIELE7, o.titel) } }, extra || {});
  return { api, f, H, C, zeit, view };
}

// Kernprüfung: die Regeln, die die Mutationen brechen müssen; liefert die Zahl der Fehlschläge (kein Zählen in n/fails)
function kern(Mod) {
  let schlecht = 0, nr = 0; const p = (c) => { nr++; if (!c) { schlecht++; if (process.env.KERN_DEBUG) console.log('    Kern: Prüfung ' + nr + ' schlug fehl'); } };
  try {
    { const a = bau(Mod, {}); const v = a.view();
      p(a.api.zeigt(v) === true);
      p(a.api.zeigt(a.view({ me: { console: null } })) === false);
      p(a.api.zeigt(Object.assign(a.view(), { state: { mission: mission('m1', ZIELE7) } })) === false);
      p(a.api.zeigt(Object.assign(a.view(), { state: { mission: mission(null, ZIELE7) } })) === false);
      p(a.api.zeigt(Object.assign(a.view(), { state: { mission: mission('tra_captain', ZIELE7) } })) === true); }
    { const a = bau(Mod, { objs: ZIELE7.concat([{ text: 'Achtes', done: false }]) }); const m = a.api.modell(a.view(), a.zeit.t);
      p(m.zeilen.length === 7 && m.mehr === 1);
      p(m.zeilen[0].done === true && m.zeilen[4].optional === true);
      p(m.zeilen.filter((z) => z.aktuell).length === 1 && m.zeilen[1].aktuell === true);   // erstes offene Pflichtziel (nicht das optionale)
      p(m.erledigt === 2 && m.gesamt === 7); }
    { const a = bau(Mod, { objs: [{ text: 'A', done: true }, { text: 'Opt', done: false, optional: true }, { text: 'B', done: false }] }); const m = a.api.modell(a.view(), a.zeit.t);
      p(m.zeilen[2].aktuell === true && m.zeilen[1].aktuell === false); }   // das optionale Ziel davor ist nie „aktuell“, solange ein Pflichtziel offen ist
    { const a = bau(Mod, { sitz: { station: 'helm', blick: 'pult' }, oda: { text: 'Hinweis eins' } });
      let h = a.api.modell(a.view(), a.zeit.t).hinweis; p(h === 'Hinweis eins');
      a.H.oda.cur = null; a.zeit.t += 24; h = a.api.modell(a.view(), a.zeit.t).hinweis; p(h === 'Hinweis eins');   // 24 s später noch da
      a.zeit.t += 2; h = a.api.modell(a.view(), a.zeit.t).hinweis; p(h === ''); }   // nach 25 s weg
    { const a = bau(Mod, { voxel: true, sitz: { station: 'helm', blick: 'vorn' }, oda: { text: 'laeuft' } });
      p(a.api.modell(a.view(), a.zeit.t).hinweis === '');   // Voxel vorn: die ODA steht selbst da, nicht doppelt
      a.H.oda.cur = null; p(a.api.modell(a.view(), a.zeit.t).hinweis === 'laeuft'); }   // S8: ist die ODA weg, bleibt der Hinweis unter dem Strich stehen
    { const a = bau(Mod, { voxel: true, sitz: { station: 'helm', blick: 'vorn' } }); const pl = a.api.platz(a.view(), 80);
      p(pl && pl.x === 4 && pl.y === 4); }
    { const a = bau(Mod, { konsole: 'technik' }); p(a.api.platz(a.view(), 80) === null); }
    { const a = bau(Mod, { pult: false }); p(a.api.platz(a.view(), 80) === null); }
    { const a = bau(Mod, { pult: 'ohneS' }); p(a.api.platz(a.view(), 80) === null); }   // Pult meldet sich ohne Statusleiste: nichts raten
    { const a = bau(Mod, { konsole: 'captain', buch: 'tra_captain', S: 258, tab: 2 }); const pl = a.api.platz(a.view(), 90); p(pl && pl.x >= 506 && pl.kompakt === false);
      const b = bau(Mod, { konsole: 'captain', buch: 'tra_captain', S: 258, tab: 1 }); const pk = b.api.platz(b.view(), 90); p(pk && pk.kompakt === true && pk.x === 69 && pk.y === 14);   // S6: Streifen der Sternkarte oben links auf der Karte, nicht über der Kanten-Legende
      const c = bau(Mod, { konsole: 'captain', buch: 'tra_fliegen', S: 258, tab: 0 }); p(c.api.platz(c.view(), 90) === null);   // auch an der fremden Konsole (Captain im Fliegen-Training): der Funk-Reiter zeigt die Liste selbst
      c.api.zeichne(c.f.ctx, c.view()); p(c.f.calls.texte.length === 0);
      const c2 = bau(Mod, { konsole: 'captain', buch: 'tra_captain', S: 258, tab: 0 }); p(c2.api.platz(c2.view(), 90) === null); c.api.zeichne(c.f.ctx, c.view()); p(c.f.calls.texte.length === 0); }   // S5: Funk-Reiter zeigt die volle Liste selbst: kein Streifen
    { const a = bau(Mod, { konsole: 'captain', buch: 'tra_captain', S: 258, tab: 2, objs: [{ text: 'Marker setzen (Reiter 3, Lagekarte anklicken)', done: false }] }); a.api.zeichne(a.f.ctx, a.view());   // S2: umbrechen statt kürzen
      const z = a.f.calls.texte.map((t) => t.s).join(' '); p(/anklicken\)/.test(z) && !/…/.test(z) && a.f.calls.texte.filter((t) => /Marker|Reiter|Lagekarte|anklicken/.test(t.s)).length >= 2); }
    { const a = bau(Mod, { konsole: 'weapons', S: 197, buch: 'tra_fliegen' }); a.api.zeichne(a.f.ctx, a.view()); const r = a.f.calls.rects[0];   // S7: an der Ops-Konsole kein Steuer-Tastenhinweis, nur der Streifen
      const tx = a.f.calls.texte.map((t) => t.s); p(r && r.h === 22 && tx.some((s) => s === 'am Steuer: Temporegler runter') && !tx.some((s) => /\(S\)/.test(s))); }
    { const a = bau(Mod, { konsole: 'helm', S: 197, buch: 'tra_fliegen' }); a.api.zeichne(a.f.ctx, a.view()); p(a.f.calls.texte.some((t) => /\(S\)/.test(t.s)) && a.f.calls.rects[0].h > 22); }   // an der Heimatkonsole bleiben die Tasten
    { const a = bau(Mod, {}); const st1 = { mission: mission('tra_fliegen', ZIELE7) }; const q1 = { title: 'Training Fliegen', objs: ZIELE7 };   // S3: Abschluss
      a.api.ziele(st1, q1); a.api.abschluss({ id: 'tra_fliegen', ausgang: 'erfolg' });
      const nach = { mission: mission(null, []) }; const f1 = a.api.ziele(nach, { title: 'Frei erkunden', objs: [{ text: 'Entdeckungen', done: false }] });
      p(f1.title === 'Training Fliegen' && f1.objs.length === 7 && f1.objs.filter((o) => !o.optional).every((o) => o.done) && f1.objs[4].done === false && /Neustart in 8 s/.test(f1.rest) && a.api.laeuft(nach) === true);
      a.zeit.t += 3; p(/Neustart in 5 s/.test(a.api.ziele(nach, { title: 'x', objs: [] }).rest));
      a.zeit.t += 10; const f2 = a.api.ziele(nach, { title: 'Frei erkunden', objs: [] }); p(f2.title === 'Frei erkunden' && !f2.rest && a.api.laeuft(nach) === false); }
    { const a = bau(Mod, {}); a.api.ziele({ mission: mission('tra_fliegen', ZIELE7) }, { title: 'T', objs: ZIELE7 }); a.api.abschluss({ id: 'tra_fliegen', ausgang: 'verloren' });
      p(a.api.ziele({ mission: mission(null, []) }, { title: 'Frei', objs: [] }).title === 'Frei'); }   // verloren: keine Abschlussliste
    { const a = bau(Mod, {}); a.api.ziele({ mission: mission('tra_fliegen', ZIELE7) }, { title: 'T', objs: ZIELE7 }); a.api.abschluss({ id: 'tra_fliegen', ausgang: 'erfolg' });
      a.api.ziele({ mission: mission('tra_fliegen', ZIELE7) }, { title: 'T', objs: ZIELE7 }); p(a.api.eingefroren({ mission: mission(null, []) }) !== null);   // Snapshot des Abschlusses (Ziele noch offen) beendet ihn nicht sofort
      a.zeit.t += 3; a.api.ziele({ mission: mission('tra_fliegen', ZIELE7) }, { title: 'T', objs: ZIELE7 }); p(a.api.eingefroren({ mission: mission(null, []) }) === null); }   // neuer Versuch (Pflichtziele wieder offen) beendet den Abschluss
    { const a = bau(Mod, { oda: { text: 'S nimmt eine Stufe zurück. Die Stufe steht am Temporegler.' } }); a.api.zeichne(a.f.ctx, a.view());
      p(a.f.calls.fills.filter((r) => r.c === '#M' && r.w === 3 && r.h === 3).length === 2);   // zwei Haken
      p(a.f.calls.texte.some((t) => /\(opt\.\)$/.test(t.s)));
      p(a.f.calls.texte.some((t) => t.color === '#MI')); }   // Hinweis in Mint
    { const a = bau(Mod, { buch: 'm1' }); a.api.zeichne(a.f.ctx, a.view()); p(a.f.calls.texte.length === 0 && a.f.calls.rects.length === 0); }
    { const a = bau(Mod, { konsole: null }); a.api.zeichne(a.f.ctx, a.view({ me: { console: null } })); p(a.f.calls.texte.length === 0); }
    p(Mod.erzeuge({ R: fakeR().R, H: {}, Pult: {}, Consoles: {}, Sitz: null, jetzt: () => 0 }).abschlussSchonGemeldet({ id: 'tra_fliegen', ausgang: 'erfolg' }) === true);
    p(Mod.erzeuge({ R: fakeR().R, H: {}, Pult: {}, Consoles: {}, Sitz: null, jetzt: () => 0 }).abschlussSchonGemeldet({ id: 'tra_fliegen', ausgang: 'verloren' }) === false);
    p(Mod.erzeuge({ R: fakeR().R, H: {}, Pult: {}, Consoles: {}, Sitz: null, jetzt: () => 0 }).abschlussSchonGemeldet({ id: 'm1', ausgang: 'erfolg' }) === false);
  } catch (e) { schlecht++; }
  return schlecht;
}

const Modul = laden(Q);

// Trainingspartie über den Lobby-Weg (wie test-training-abzeichen.js)
function partie(modus) {
  const g = new Game({ noStore: true, worlds: false, seed: 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(m) { if (this.inbox.length < 5000) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'T0', name: 'Tr0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: modus });
  g.handleMessage(c, { t: 'ready', ready: true });
  const P = { g, c };
  P.run = (sek) => { for (let k = 0; k < Math.round(sek / DT); k++) g.step(); };
  return P;
}

section('Entscheidung: echte Partien (echter Snapshot)', () => {
  const ids = {};
  for (const modus of ['training_fliegen', 'training_captain', 'm1', 'eisenwald', 'arena_forschung', 'labor', 'freie_fahrt']) {
    let P = null, snap = null, fehler = null;
    try { P = partie(modus); P.run(2); snap = P.g.snapshot(); } catch (e) { fehler = e; }
    if (!snap) { ok(false, modus + ': Partie ließ sich nicht starten: ' + (fehler && fehler.message)); continue; }
    const view = { me: { console: 'helm' }, state: snap };
    const id = snap.mission && snap.mission.active ? snap.mission.active.id : null;
    ids[modus] = id;
    const training = modus.startsWith('training_');
    ok(Modul.erzeuge({ R: fakeR().R, H: {}, jetzt: () => 0 }).zeigt(view) === training, modus + ' (Buch ' + id + ') an der Konsole: ' + (training ? 'Trainingsliste' : 'keine Trainingsliste'));
    ok(Modul.erzeuge({ R: fakeR().R, H: {}, jetzt: () => 0 }).zeigt({ me: { console: null }, state: snap }) === false, modus + ': zu Fuß keine Trainingsliste (das HUD zeichnet die Zielliste)');
    if (training) {
      const q = zieleVon(snap);
      ok(Array.isArray(q.objs) && q.objs.length >= 1 && q.objs.length <= Modul.MAX_ZIELE && !!q.title, modus + ': Titel "' + q.title + '" und ' + q.objs.length + ' Ziele aus dem Snapshot (höchstens ' + Modul.MAX_ZIELE + ')');
    }
  }
  ok(ids.training_fliegen === 'tra_fliegen' && ids.training_captain === 'tra_captain', 'Buch-IDs der Trainingsmodi: tra_fliegen, tra_captain');
});

section('Modell, Hinweis, Platz, Zeichnen, Abschluss (Kernprüfung gegen das echte Modul)', () => {
  ok(kern(Modul) === 0, 'Kernprüfung: alle Regeln erfüllt');
  // Einzelheiten mit Meldung
  { const a = bau(Modul, { objs: ZIELE7.concat([{ text: 'Achtes', done: false }]) }); const m = a.api.modell(a.view(), a.zeit.t);
    ok(m.zeilen.length === 7 && m.mehr === 1, 'acht Ziele: sieben in der Liste, „+1 weitere“'); }
  { const a = bau(Modul, { objs: [{ text: 'A', done: true }, { text: 'B', done: true }] }); const m = a.api.modell(a.view(), a.zeit.t);
    ok(m.zeilen.every((z) => !z.aktuell), 'alles erledigt: kein aktuelles Ziel'); }
  { const a = bau(Modul, { objs: [{ text: 'A', done: true }, { text: 'Opt', done: false, optional: true }] }); const m = a.api.modell(a.view(), a.zeit.t);
    ok(m.zeilen[1].aktuell === true, 'nur noch ein optionales Ziel offen: es ist das aktuelle'); }
  { const a = bau(Modul, {}); a.api.zeichne(a.f.ctx, a.view()); const r = a.f.calls.rects[0];
    ok(r && r.x >= 0 && r.x + r.w <= 640 && r.y >= 0 && r.y + r.h <= 200, 'Steuer: Kasten liegt im Bild und über der Statusleiste (y ' + (r && r.y) + '..' + (r && r.y + r.h) + ', S 200)');
    ok(r && r.h <= Modul.SLOTS.helm.hoeheMax, 'Steuer: Höhe ' + (r && r.h) + ' höchstens ' + Modul.SLOTS.helm.hoeheMax);
    ok(r && r.x === Modul.SLOTS.helm.x && r.w === Modul.SLOTS.helm.w, 'Steuer: Spalte rechts (x ' + (r && r.x) + ', Breite ' + (r && r.w) + ')');
    const ziele = a.f.calls.texte.filter((t) => ZIELE7.some((z) => t.s.startsWith(z.text.slice(0, 8))));
    ok(ziele.length === 7, 'sieben Zielzeilen gezeichnet (' + ziele.length + ')'); }
  { const a = bau(Modul, { oda: { text: 'Ein sehr langer Hinweis, der über mehr als drei Zeilen der schmalen Liste geht und deshalb abgeschnitten werden muss, damit nichts über den Rand läuft und nichts verdeckt.' }, objs: ZIELE7 });
    a.api.zeichne(a.f.ctx, a.view()); const r = a.f.calls.rects[0]; const mint = a.f.calls.texte.filter((t) => t.color === '#MI');
    ok(mint.length >= 1 && mint.length <= 3 && /…$/.test(mint[mint.length - 1].s), 'langer Hinweis: höchstens drei Zeilen, die letzte endet mit „…“ (' + mint.length + ')');
    ok(r.y + r.h <= 200 - Modul.SLOTS.helm.unten + 0.5 && r.h <= Modul.SLOTS.helm.hoeheMax, 'langer Hinweis: Kasten bleibt im freien Bereich (Unterkante ' + (r.y + r.h) + ', Höhe ' + r.h + ')'); }
  { const a = bau(Modul, { konsole: 'captain', buch: 'tra_captain', S: 258, tab: 1, oda: { text: 'S nimmt eine Stufe zurück. Die Stufe steht am Temporegler.' } }); a.api.zeichne(a.f.ctx, a.view()); const r = a.f.calls.rects[0];
    ok(r && r.h === 22 && r.x === 69 && r.y === 14, 'Captain Sternkarte: Streifen 22 px hoch, oben links auf der Karte (x ' + (r && r.x) + ', y ' + (r && r.y) + '), nicht über der Kanten-Legende');
    ok(a.f.calls.texte.length === 3, 'Streifen: Titel, Stand, eine Zeile (' + a.f.calls.texte.length + ' Texte)');
    ok(a.f.calls.texte.some((t) => t.s === '2/6'), 'Streifen: Stand „2/6“ (zwei von sechs Pflichtzielen)');
    ok(a.f.calls.texte.some((t) => t.color === '#MI'), 'Streifen: Hinweis (Mint) hat Vorrang vor dem aktuellen Ziel'); }
  { const a = bau(Modul, { konsole: 'captain', buch: 'tra_captain', S: 258, tab: 3 }); a.api.zeichne(a.f.ctx, a.view()); const r = a.f.calls.rects[0];
    ok(r && r.x >= 506 && r.x + r.w <= 640 && r.y + r.h <= 238 + 0.5 && r.h <= Modul.SLOTS.captain.hoeheMax, 'Captain Lage: Liste rechts der Karte (x ' + (r && r.x) + '), über dem Frachtraum-Feld'); }
  { const a = bau(Modul, { konsole: 'weapons', S: 197 }); a.api.zeichne(a.f.ctx, a.view()); const r = a.f.calls.rects[0];
    ok(r && r.y >= 62 && r.y + r.h <= 174, 'Ops: Liste zwischen „ZIEL“ (bis y 62) und Frachtraum-Feld (ab y 174): y ' + (r && r.y) + '..' + (r && r.y + r.h)); }
  { const a = bau(Modul, { konsole: 'technik' }); a.api.zeichne(a.f.ctx, a.view());
    ok(a.f.calls.texte.length === 0, 'Konsole ohne gemessenen freien Bereich (Technik): keine Liste, nichts verdeckt'); }
  { const a = bau(Modul, { voxel: true, sitz: { station: 'helm', blick: 'vorn' } }); a.api.zeichne(a.f.ctx, a.view()); const r = a.f.calls.rects[0];
    ok(r && r.x === 4 && r.y === 4 && r.w + r.x <= 178, 'Voxel-Sitz vorn: oben links, endet vor der ODA (x 178)'); }
  { const a = bau(Modul, { voxel: true, sitz: { station: 'helm', blick: 'pult' } }); a.api.zeichne(a.f.ctx, a.view()); const r = a.f.calls.rects[0];
    ok(r && r.x === Modul.SLOTS.helm.x, 'Voxel-Sitz Blick Pult: wie das 2D-Pult (rechte Spalte)'); }
  { const a = bau(Modul, { objs: [] }); a.api.zeichne(a.f.ctx, a.view()); ok(a.f.calls.texte.length === 0, 'ohne Ziele und ohne Hinweis: nichts gezeichnet'); }
  { const a = bau(Modul, {}); let e = null; try { a.api.zeichne(a.f.ctx, { me: { console: 'helm' } }); a.api.zeichne(a.f.ctx, null); a.api.zeichne(a.f.ctx, { me: { console: 'helm' }, state: {} }); } catch (x) { e = x; }
    ok(e === null, 'unvollständige Ansicht (ohne Zustand, ohne Mission) wirft nicht'); }
  ok(Modul.erzeuge({ R: fakeR().R, H: {}, jetzt: () => 0 }).abschlussSchonGemeldet({ id: 'tra_captain', ausgang: 'erfolg' }) === true, 'gewonnenes Captain-Training: „Auftrag erledigt“ entfällt');
  ok(Modul.erzeuge({ R: fakeR().R, H: {}, jetzt: () => 0 }).abschlussSchonGemeldet(null) === false, 'ohne Ereignis: false, keine Ausnahme');
});

section('Verdrahtung (Quelltext)', () => {
  ok(/TrainingHud\.zeichne\(ctx, v\)/.test(Q_CLIENT), 'client.js ruft TrainingHud.zeichne auf');
  const iKonsole = Q_CLIENT.indexOf('K.draw(ctx, v)'), iZeichne = Q_CLIENT.indexOf('TrainingHud.zeichne(ctx, v)');
  ok(iKonsole > 0 && iZeichne > iKonsole, 'TrainingHud.zeichne kommt NACH dem Zeichnen der Konsole (sonst läge die Konsole darüber)');
  const block = /if \(v\.me\.console\) \{[\s\S]*?\} else if \(window\.TerminalUI/.exec(Q_CLIENT);
  ok(block && block[0].includes('TrainingHud.zeichne'), 'der Aufruf steht im Zweig „Spieler an einer Konsole“ (zu Fuß zeichnet nur das HUD)');
  ok(/js\/training-hud\.js/.test(Q_INDEX), 'index.html lädt training-hud.js');
  ok(/const \{ title, objs, rest \} = this\.zieleVon\(st\)/.test(Q_HUD), 'drawObjectives liest die Ziele aus Hud.zieleVon (eine Quelle für HUD und Konsole)');
  ok(/window\.TrainingHud\.ziele\(st, q\)/.test(Q_HUD) && /TrainingHud\.abschluss\(ev\)/.test(Q_CLIENT) && /TH\.eingefroren\(st\)/.test(Q_CONSOLES) && [Q_CONSOLES, Q_HUD, Q_CLIENT].every((q) => { try { new Function(q); return true; } catch (e) { return false; } }) &&/TrainingHud\.laeuft\(st\)/.test(Q_HUD), 'S3: Hud.zieleVon ruft TrainingHud.ziele, client.js meldet den Abschluss, Funk-Reiter und HUD fragen laeuft/eingefroren');
  ok(/if \(!inConsole\) \{[\s\S]{0,200}drawObjectives/.test(Q_HUD), 'das HUD zeichnet seine Zielliste weiter nur zu Fuß (nicht doppelt)');
  ok(/abschlussSchonGemeldet\(ev\)/.test(Q_CLIENT) && /case 'missionDone'/.test(Q_CLIENT), 'client.js: missionDone fragt abschlussSchonGemeldet');
});

section('Snapshot ohne Vergrößerung', () => {
  const P = partie('training_fliegen'); P.run(20);
  const snap = P.g.snapshot();
  const BEKANNT = ['stage', 'objectives', 'radio', 'choice', 'teaser', 'flags', 'active', 'list', 'discoveries', 'bookVersion', 'focusId', 'focusTitle', 'focusObjectives', 'focusLoc', 'planning', 'log', 'chronik', 'book', 'm1Done', 'bot', 'sz', 'wellen', 'ph', 'radioQueue', 'logbuch'];
  const fremd = Object.keys(snap.mission).filter((k) => !BEKANNT.includes(k));
  ok(fremd.length === 0, 'Missions-Snapshot im Training: keine unbekannten Felder' + (fremd.length ? ' (' + fremd.join(', ') + ')' : ''));
  // die Anzeige liest nur vorhandene Felder
  const quelle = Q.replace(/\/\/.*$/gm, '');
  ok(!/state\.mission\.(?!active)/.test(quelle) && /mission\.active\.id/.test(quelle), 'training-hud.js liest vom Snapshot nur mission.active.id (Ziele und Titel über Hud.zieleVon)');
  const lauf = (mitModul) => { if (mitModul) { const self = {}; new Function('self', Q)(self); if (!self.TrainingHud) throw new Error('Modul registriert sich nicht'); } const x = partie('training_fliegen'); x.run(20); return { snap: JSON.stringify(x.g.snapshot()), fehler: x.g.errors }; };
  const a = lauf(false), b = lauf(true);
  ok(a.snap.length > 1000 && a.snap === b.snap && a.fehler === 0 && b.fehler === 0, 'Snapshot mit/ohne Client-Modul byte-gleich (' + a.snap.length + ' B), Server ohne Fehler');
  ok(a.snap.length <= 18944, 'Snapshot im Training ' + a.snap.length + ' B, unter dem Ziel 18 944 B (npm run snap:mess)');
});

section('Mutationen: Regeln im Quelltext zerstören, die Kernprüfung muss rot werden', () => {
  const mut = (name, von, nach) => {
    if (!Q.includes(von)) { ok(false, 'Mutation „' + name + '“: Anker nicht gefunden: ' + von.slice(0, 50)); return; }
    let rot = false; try { rot = kern(laden(Q.replace(von, () => nach))) > 0; } catch (e) { rot = true; }
    ok(rot, 'Mutation „' + name + '“ macht die Prüfung rot');
  };
  mut('Kampagne zählt als Training', `mission.active.id.startsWith(BUCH_PRAEFIX)`, `mission.active.id.length > 0`);
  mut('zu Fuß zeigt auch', `!!(view && view.me && view.me.console && view.state`, `!!(view && view.me && view.state`);
  mut('Ziele unbegrenzt', `objs.slice(0, MAX_ZIELE)`, `objs.slice(0)`);
  mut('aktuelles Ziel falsch (optionales zuerst)', `objs.findIndex((o) => o && !o.done && !o.optional)`, `objs.findIndex((o) => o && !o.done)`);
  mut('Hinweis ewig', `jetzt - letzteOda.t < HINWEIS_DAUER`, `jetzt - letzteOda.t < 1e9`);
  mut('Hinweis doppelt im Voxel-Sitz vorn', `if (sitzVorn(view) && cur) return '';`, ``);
  mut('S8: im Hauptschirm nie ein Hinweis', `if (sitzVorn(view) && cur) return '';`, `if (sitzVorn(view)) return '';`);
  mut('S2: Ziele werden gekürzt statt umbrochen', `let l = m.zeilen.map(voll);`, `let l = m.zeilen.map(kurz);`);
  mut('S5: Funk-Reiter bekommt den Streifen', `if (!s || s.still) return null;`, `if (!s) return null;`);
  mut('S7: fremde Konsole zeigt die volle Liste mit Tasten', `const kompakt = fremd(view) || !!(`, `const kompakt = !!(`);
  mut('S3: Abschluss wird nicht gemerkt', `if (abschlussSchonGemeldet(ev) && letzte) abschlussT`, `if (false) abschlussT`);
  mut('S3: Neustart zählt nicht (Liste bleibt ewig)', `if (rest < -2) { abschlussT = null; return null; }`, ``);
  mut('keine Liste für unbekannte Konsole', `if (!s) return null;
      const C`, `if (!s) return SLOTS.helm;
      const C`);
  mut('Pult nicht im Bild: trotzdem zeichnen', `if (!k || typeof k.S !== 'number') return null;`, `if (!k) return null;`);
  mut('Abzeichen und Auftrag erledigt zugleich', `ev.ausgang === 'erfolg'`, `ev.ausgang === 'x'`);
  mut('Streifen wird nie kompakt', `const kompakt = fremd(view) || !!(s.kompakt && s.kompakt.includes(tab));`, `const kompakt = false;`);
  mut('S6: Streifen der Sternkarte bleibt unten rechts', `const ort = kompakt && s.kompaktOrt ? s.kompaktOrt[tab] : null;`, `const ort = null;`);
  mut('Sitz vorn nicht erkannt', `S.blick !== 'pult');`, `S.blick === 'pult');`);
});

console.log('\n' + (n - fails) + '/' + n + ' Prüfungen grün' + (fails ? ', ' + fails + ' FEHLER' : ''));
process.exit(fails ? 1 : 0);
