'use strict';
// ITM-01 E: Mutationsprobe zu tools/test-fallen-client.js. Kopiert server, content, shared, public/js, die Manifeste und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt),
// ändert dort je Lauf EINE Regel und verlangt, dass der Test mit einer echten Prüfung rot wird (FEHLER-Zeile, Exit != 0). Ein Absturz (Ausnahme, keine Prüfzeile) zählt NICHT als erkannt.
//   node tools/mutation-fallen-client.js [begriff …] [--trocken]      (npm run test:fallen-client-mutation)
// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst Exit 2. --trocken prüft nur die Anker und endet.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-fallenclient-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
const kopiere = (rel) => { const z = path.join(TMP, rel); fs.mkdirSync(path.dirname(z), { recursive: true }); fs.cpSync(path.join(ROOT, rel), z, { recursive: true }); };
for (const rel of ['server', 'content', 'shared', 'public/js', 'assets/manifest', 'public/voxel/manifest.json', 'package.json']) kopiere(rel);
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
const TEST = 'tools/test-fallen-client.js';
fs.copyFileSync(path.join(ROOT, TEST), path.join(TMP, TEST));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const RN = 'public/js/render.js', CL = 'public/js/client.js', KT = 'public/js/voxel/kit.js', KR = 'public/js/voxel/kit-regeln.js', SA = 'public/js/scan-anzeige.js', SB = 'shared/buehne.js',
  HU = 'public/js/hud.js', CO = 'public/js/consoles.js', GE = 'content/buehnen/bauweisen/germanen.json', RO = 'content/buehnen/bauweisen/rom.json', DB = 'content/scanner/datenblaetter.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  // ---- Anker-Liste, Start, ao
  [RN, "    return x.rolle === 'falle' && x.sicht === 'passiv' ? 'erkannt' : (liste && liste[0]) || null;\n  }\n  // Laufzeitzustand", "    return (liste && liste[0]) || null;\n  }\n  // Laufzeitzustand", 'Rückfall-Start ignoriert sicht (passiv startet verborgen)'],
  [SB, "if (a && a.rolle === 'falle' && a.sicht === 'passiv') return 'erkannt';", "if (false) return 'erkannt';", 'Shared_Buehne.ankerStart: passive Falle startet nicht erkannt'],
  [RN, "if (i < m.anker.length) return 'doppelt';", "if (i < m.anker.length) { m.anker.push(ev.anker); return 'neu'; }", 'Wiederholung eines Enthüllens hängt doppelt an'],
  [RN, "if (i > m.anker.length) { report('Render.ankerEnthuellt', new Error('Lücke: i ' + i + ' > Länge ' + m.anker.length)); return 'luecke'; }", "if (i > m.anker.length) { m.anker.push(ev.anker); return 'neu'; }", 'Lücke im Index wird trotzdem angehängt (ao zeigt auf die falsche Falle)'],
  [RN, "if (ev.kv != null && m.kv != null && String(ev.kv) !== String(m.kv)) return 'andere_version';", "", 'andere Kartenversion wird nicht geprüft'],
  [RN, "    m.anker.push(ev.anker);\n    m.ankerIdx[ev.anker[0]] = i;\n    return 'neu';", "    m.anker.push(ev.anker);\n    return 'neu';", 'ankerIdx der Enthüllten fehlt'],
  [RN, "    for (const e of ao) if (e[0] === idx) return liste[e[1]] || ankerStartZustand(a, liste);", "    for (const e of ao) if (e[0] === idx) return liste[e[1]] || liste[0] || null;", 'unbekannter ao-Zustandsindex fällt auf Zustand 0 statt auf den Start'],
  [RN, "const a = map && map.anker && map.anker[idx];\n    if (!a) return null;\n    const liste = ANKER_ZUSTAENDE[a[1]] || [];", "const a = map && map.anker && (map.anker[idx] || map.anker[map.anker.length - 1]);\n    if (!a) return null;\n    const liste = ANKER_ZUSTAENDE[a[1]] || [];", 'ao-Index hinter der Liste trifft die letzte Falle'],
  // ---- Kollisions-Vorhersage
  [CL, "if (zone === 'away' && R.isBuehne(map)) return R.buehneBewegungSolid(map, st);", "if (zone === 'away' && R.isBuehne(map)) return R.solidFn(map, st);", 'Vorhersage ohne Kollisionsbox der Anlage (Client läuft hinein, Rücksetzer)'],
  [RN, "return blk ? (tx, ty) => fest(tx, ty) || blk.has(ty * map.w + tx) : fest;", "return fest;", 'buehneBewegungSolid ignoriert die Box'],
  [RN, "if (SB && typeof SB.ankerBlockiert === 'function') for (const a of alle) if (a[1] === 'falle' && SB.ankerBlockiert({ rolle: 'falle', typ: a[4] && a[4].typ }))", "if (SB && typeof SB.ankerBlockiert === 'function') for (const a of alle) if (a[1] === 'falle')", 'jede Falle blockiert (Druckfeld und Schott wären Wände)'],
  [RN, "    if (c && c.alle === alle && c.n === alle.length) return c.set;", "    if (c) return c.set;", 'Box-Cache merkt keine später enthüllte Anlage'],
  [RN, "      if (info.solid !== 'zustand') return !!info.solid;\n      return (info.begehbarIn || []).indexOf(kachelZustand(map, st, tx, ty)) < 0;", "      if (info.solid !== 'zustand') return !!info.solid || !!(blockierendeAnker(map) && blockierendeAnker(map).has(ty * map.w + tx));\n      return (info.begehbarIn || []).indexOf(kachelZustand(map, st, tx, ty)) < 0;", 'Sicht (buehneSolid) kennt die Box (Nebel und Deckung ändern sich)'],
  // ---- Overlay
  [RN, "ctx.fillStyle = 'rgba(' + rgb + ',' + (0.07 + 0.06 * pu).toFixed(3) + ')'; ctx.fill();", "ctx.fillStyle = 'rgba(' + rgb + ',' + (0.55 + 0.06 * pu).toFixed(3) + ')'; ctx.fill();", 'Feld-Füllung deckend (verdeckt die Sicht)'],
  [RN, "ctx.setLineDash([7, 5]); ctx.lineDashOffset = -(t * 14) % 12;", "ctx.setLineDash([]); ctx.lineDashOffset = -(t * 14) % 12;", 'Feldrand durchgezogen statt gestrichelt (nur Farbe)'],
  [RN, "else FALLEN.felder.delete(key);\n    } else if (ev.kind === 'falleSchott') {", "else { /* bleibt */ }\n    } else if (ev.kind === 'falleSchott') {", 'Feld aus (an 0) entfernt das Overlay nicht'],
  [RN, "if (f.map !== mid || now - f.t0 > f.dauer + FALLE_GNADE) continue;\n      let pts = null;", "if (now - f.t0 > f.dauer + FALLE_GNADE) continue;\n      let pts = null;", 'Feld einer anderen Karte wird gezeichnet'],
  [RN, "else if (f.r != null && f.r > 0) { pts = []; for (let i = 0; i < 28; i++)", "else if (false) { pts = []; for (let i = 0; i < 28; i++)", 'Kreisfeld (r) wird nicht gezeichnet'],
  [RN, "for (const f of FALLEN.schotts.values()) if (f.map === mid) out.push({ art: 'schott', name: 'SCHOTTS GESPERRT',", "for (const f of FALLEN.schotts.values()) if (f.map === mid) out.push({ art: 'schott', name: 'SCHOTT',", 'Schott-Zeile ohne den Namen „SCHOTTS GESPERRT“'],
  [RN, "if (+ev.an) FALLEN.schotts.set(key,", "if (true) FALLEN.schotts.set(key,", 'Schott-Zeile bleibt nach dem Öffnen stehen'],
  [RN, "const a = P(b.x, b.y, 18), c = P(b.tx, b.ty, 14);", "const a = P(b.x, b.y, 18), c = P(b.x, b.y, 14);", 'Schuss-Strahl geht nicht zum Getroffenen'],
  [RN, "    if (z === 'erkannt') {\n      const pu = 0.5 + 0.5 * Math.sin(t * 5), k = s", "    if (z === 'erkannt' || z === 'verborgen') {\n      const pu = 0.5 + 0.5 * Math.sin(t * 5), k = s", 'verborgene Falle bekommt eine Marke'],
  [RN, "ctx.beginPath(); ctx.moveTo(cx, cy - 10 * k); ctx.lineTo(cx + 10 * k, cy + 7 * k); ctx.lineTo(cx - 10 * k, cy + 7 * k); ctx.closePath();\n      ctx.fillStyle = 'rgba(11,14,26,0.82)';", "ctx.beginPath(); ctx.arc(cx, cy, 8 * k, 0, 7);\n      ctx.fillStyle = 'rgba(11,14,26,0.82)';", 'Marke erkannt ist ein Kreis statt des Warndreiecks'],
  [RN, "    if (typ === 'schott') { ctx.fillRect(cx - 3 * u, cy - 3 * u, u * 2, u * 6); ctx.fillRect(cx + u, cy - 3 * u, u * 2, u * 6); }", "    if (typ === 'schott') { ctx.fillRect(cx - u, cy - 4 * u, u * 2, u * 5); ctx.fillRect(cx - u, cy + 2 * u, u * 2, u * 2); }", 'Schott-Glyphe gleich dem Ausrufezeichen (Typ nicht erkennbar)'],
  [RN, "ctx.save(); ctx.globalAlpha = 0.5;\n      ctx.beginPath(); ctx.moveTo(cx, cy - 10 * k)", "ctx.save(); ctx.globalAlpha = 1;\n      ctx.beginPath(); ctx.moveTo(cx, cy - 10 * k)", 'entschärfte Marke nicht ruhig (volle Deckkraft)'],
  // ---- Client
  [CL, "if (z === 'erkannt') return { label: 'E halten: Entschärfen (' + sec('falle') + ')', ok: true };", "return { label: 'E halten: Entschärfen (' + sec('falle') + ')', ok: true };", 'E-Hinweis auch bei entschärft/ausgelöst'],
  [CL, "case 'ankerEnthuellt': R.ankerEnthuellt(ev); return true;", "case 'ankerEnthuellt': return true;", 'Ereignis ankerEnthuellt wird nicht verarbeitet'],
  [CL, "if (DEBUG) H.pushNotice('Falle ' + ev.anker", "if (true) H.pushNotice('Falle ' + ev.anker", 'falleWirkungslos meldet auch Spielern'],
  [CL, "'falle:erkannt': 'Falle erkannt', 'falle:entschaerft': 'Falle entschärft',", "'falle:erkannt': 'Falle erkannt', 'falle:entschaerft': 'Falle entschärft', 'falle:ausgeloest': 'Falle ausgelöst',", 'doppelter Auslösetext (der Server sagt ihn schon)'],
  [RN, "'anker:falle': 'ENTSCHÄRFEN', ", "", 'Hold-Beschriftung fehlt'],
  [HU, "for (const w of R.fallenLaufend(st)) lines.push(", "for (const w of []) lines.push(", 'HUD zeigt keine Restzeit-Zeile'],
  [CO, "for (const w of R.fallenLaufend(st)) { R.text(ctx, w.name", "for (const w of []) { R.text(ctx, w.name", 'Captain-Lage zeigt keine Restzeit-Zeile'],
  // ---- Voxel-Kit
  [KT, "if (cm && Array.isArray(cm.anker) && LZ.h.ankerNeu) for (let i = LZ.h.karte.anker.length;", "if (false && cm && Array.isArray(cm.anker) && LZ.h.ankerNeu) for (let i = LZ.h.karte.anker.length;", 'Voxel: Enthüllte bekommen nie ein Prop'],
  [KT, "return k.zustaende[a.id] || ankerStart(a, rs.zustaende);", "return k.zustaende[a.id] || rs.zustaende[0] || null;", 'Voxel: passive Falle startet verborgen (Zustand 0)'],
  [KT, "rolle === 'falle' ? typ : null);", "null);", 'Voxel: Typ-Zeile der Falle wird nicht gelesen'],
  [KR, "let v = typeof e === 'string' ? e : (typ && e[typ]) || e[art] || e['*'] || null;", "let v = typeof e === 'string' ? e : e[art] || (typ && e[typ]) || e['*'] || null;", 'Kartenart gewinnt vor dem Typ'],
  [SB, "if (rolle === 'falle' && ankerBlockiert({ rolle: 'falle', typ: art })) continue;", "", 'K-SILHOUETTE ohne Ausnahme für die blockende Anlage'],
  [GE, '"schuss": "prop/germanen/aussenposten/schuerfgeraet",', '"schuss": "prop/gibtsnicht/schuerfgeraet",', 'Rückfall-Kit zeigt auf ein Prop ohne Manifest-Eintrag'],
  [RO, '"druck": "ort/rom/gemein/verteiler",', '"druck": "prop/rom/ruine/saeule_gestuerzt",', 'Rückfall-Kit: begehbares Prop größer als 1x1 (Säule 3,5 x 1,5)'],
  // ---- Scan-Anzeige
  [SA, "position: z.pos ? 'Position: Feld ' + Math.floor(z.pos.x / T) + ' / ' + Math.floor(z.pos.y / T) : txtKeinePos(z.posAb || POS_AB_STANDARD),", "position: z.pos ? 'Position: Feld ' + Math.floor(z.pos.x / T) + ' / ' + Math.floor(z.pos.y / T) : TXT_KEINE_POS,", 'Positionstext der Falle bleibt „erst ab Stufe 3“'],
  [SA, "return v == null ? POS_AB_STANDARD : int(v, 1, 3, POS_AB_STANDARD);", "return v == null ? 1 : int(v, 1, 3, POS_AB_STANDARD);", 'Arten ohne positionAb zeigen „Stufe 1“ statt der Standardstufe'],
  [DB, '"titel": "Falle",\n      "positionAb": 2', '"titel": "Falle",\n      "positionAb": 3', 'Content positionAb weicht von der Server-Config ab'],
  // ---- ITM-01 F: gesperrtes Schott sichtbar, Kürzel weg, Glyphen, Strahl
  [RN, "if (idx < 0 || kantenZustand(map, st, idx) !== 'zu') continue;", "if (idx < 0) continue;", 'Schott-Sperranzeige läuft weiter, obwohl die Kante (Hacken) schon offen ist'],
  [RN, "e.a = ein ? Math.min(1, e.a + dt / SCHOTT_EIN) : Math.max(0, e.a - dt / SCHOTT_AUS);", "e.a = ein ? Math.min(1, e.a + dt / SCHOTT_EIN) : 0;", 'Schott blendet beim Öffnen nicht aus (0,3 s)'],
  [RN, "schottStreifen(ctx, bo, rot(0.3 * e.a), 3, 9, (t * 6) % 9);", "schottStreifen(ctx, bo, rot(0.03 * e.a), 3, 9, (t * 6) % 9);", '2D-Schraffur des Schotts praktisch unsichtbar (Alpha 0,03)'],
  [RN, "schottPfad(ctx, bo); ctx.lineJoin = 'miter'; ctx.strokeStyle = rot(e.a); ctx.lineWidth = 2; ctx.stroke();", "schottPfad(ctx, bo); ctx.lineJoin = 'miter'; ctx.strokeStyle = rot(e.a); ctx.lineWidth = 1; ctx.stroke();", 'Schott-Kontur nur 1 px statt 2 px'],
  [RN, "schottPfad(ctx, top); ctx.fillStyle = rot(e.a); ctx.fill();", "schottPfad(ctx, top);", 'Voxel: kein rotes Leuchtband an der Oberkante des gesperrten Schotts'],
  [RN, "falleGlyphe(ctx, 'schott', cx, Math.round(cy + 1 * k), k, '#F6E7E4');", "", 'gesperrtes Schott ohne schwebende II-Glyphe'],
  [RN, "ctx.save(); ctx.clip(); schottStreifen(ctx, face, rot(0.92 * e.a), Math.max(2, 3 * s), Math.max(7, 11 * s), 0); ctx.restore();", "", 'Voxel: Blattfläche ohne rote Schrägstreifen'],
  [RN, "    if (falle) return;   // keine Beschriftung: das Dreieck mit Glyphe sagt, was es ist (Name im Datenblatt)\n", "", 'Weltlabel der Falle trägt wieder Text (Kürzel)'],
  [RN, "ctx.moveTo(dx + 0.5, Math.round(foot.y - mitteHoch + 7 * s)); ctx.lineTo(dx + 0.5, Math.round(foot.y));", "ctx.moveTo(dx + 0.5, Math.round(foot.y - mitteHoch + 7 * s));", 'Lotlinie endet nicht am Bodenpunkt'],
  [RN, "if (!istFalle) shape(ctx, 'diamond', s.x, s.y, 7, PAL.ice, PAL.space);", "shape(ctx, 'diamond', s.x, s.y, 7, PAL.ice, PAL.space);", 'Kommandokarte zeichnet wieder die Eisblau-Raute an Fallen'],
  [RN, "for (const m of scanMarker(st)) { if (m.art === 'falle') continue; const mx", "for (const m of scanMarker(st)) { const mx", 'Minikarte zeigt Fallen nach dem Scan wieder als Eisblau-Raute'],
  [RN, "if (buehneMap) miniSchotts(ctx, st,", "if (false) miniSchotts(ctx, st,", 'Minikarte ohne rote Striche für gesperrte Schotts'],
  [RN, "if (isBuehne(map)) miniSchotts(ctx, st,", "if (false) miniSchotts(ctx, st,", 'Kommandokarte ohne rote Striche für gesperrte Schotts'],
  [RN, "drawFallenSchotts(ctx, st, P, t, ppm / 32, true);", "", 'Voxel-Overlay zeichnet gesperrte Schotts nicht'],
  [RN, "drawFallenSchotts(ctx, st, (x, y, h) => ({ x: Math.round(x - camX), y: Math.round(y - camY - (h || 0)) }), t, 1, false);", "", '2D-Ansicht zeichnet gesperrte Schotts nicht'],
  [RN, "ctx.fillRect(cx - 2 * u, cy - u, 4 * u, 2 * u); ctx.fillRect(cx + 2 * u, cy - 2 * u, u, 4 * u); ctx.fillRect(cx + 3 * u, cy - u, u, 2 * u);", "", 'Druck-Glyphe ohne Pfeil (nur Kasten)'],
  [RN, "ctx.lineWidth = 3 * (1 - p) + 3;", "ctx.lineWidth = 3 * (1 - p) + 1;", 'Selbstschuss-Strahl wieder zu dünn'],
  [RN, "ctx.arc(a.x, a.y, 3 + 6 * (1 - p), 0, Math.PI * 2); ctx.fill();", "ctx.arc(a.x, a.y, 2 + 3 * (1 - p), 0, Math.PI * 2); ctx.fill();", 'Mündungsblitz wieder klein'],
  [SA, "symbol: e.art === 'falle' ? '' : kurz(", "symbol: kurz(", 'Scan-Zeile/Marker der Falle trägt wieder ein Kürzel'],
  [SA, "out.push({ key: z.key, x: e.x, y: e.y, symbol: z.symbol, art: z.art, typ: z.typ,", "out.push({ key: z.key, x: e.x, y: e.y, symbol: z.symbol, typ: z.typ,", 'Marker kennt die Art nicht (Falle nicht von Erz unterscheidbar)'],
  [DB, '"hinweisAb": 1\n    },\n    "test": {', '"hinweisAb": 1,\n      "symbol": "SS"\n    },\n    "test": {', 'Content: Selbstschussanlage trägt wieder das Kürzel SS'],
  [RN, "ctx.strokeStyle = PAL.red; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(mx - 2, my - 2);", "ctx.strokeStyle = '#8A2A24'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(mx - 2, my - 2);", 'Minikarte: ausgelöste Falle nicht mehr PAL.red'],
  [RN, "ctx.fillStyle = PAL.red; ctx.beginPath(); ctx.moveTo(mx, my - h); ctx.lineTo(mx + h, my + h - 1);", "ctx.fillStyle = PAL.ice; ctx.beginPath(); ctx.moveTo(mx, my - h); ctx.lineTo(mx + h, my + h - 1);", 'Minikarte: erkannte Falle eisblau statt rot'],
  [CO, "if (z.glyphe != null) R.falleGlyphe(ctx, z.glyphe, x + 7, ry + 4, 1, PAL.red);", "if (false) R.falleGlyphe(ctx, z.glyphe, x + 7, ry + 4, 1, PAL.red);", 'Scan-Liste ohne Glyphe vor dem Namen'],
  ['server/sim/interior.js', "if (!e.verborgen || (zs[e.id] && zs[e.id] !== 'verborgen'))", "if (true)", 'G S1: verborgene Anlage blockiert schon auf dem Server (verrät die Falle, Prediction-Ruck)'],
  ['server/sim/interior.js', "zs[e.id] !== 'verborgen'))", "zs[e.id] === 'xx'))", 'G S1: enthüllte (erkannte/ausgelöste) Anlage blockiert nicht mehr'],
  ['server/sim/fallen.js', "if (wahl) { p.x = wahl.x; p.y = wahl.y; }", "void wahl;", 'G S1: beim Enthüllen wird eine Figur in der Box nicht herausgeschoben (eingeklemmt)'],
];

{
  const normal = (t) => t.replace(/\r\n/g, '\n');
  const schlecht = [];
  for (const [datei, alt, , was] of MUTATIONEN) {
    let text;
    try { text = normal(fs.readFileSync(path.join(TMP, datei), 'utf8')); } catch (e) { schlecht.push(`${was}: Datei ${datei} nicht lesbar`); continue; }
    const k = text.split(alt).length - 1;
    if (k !== 1) schlecht.push(`${was}: Anker ${k === 0 ? 'nicht gefunden' : k + 'x gefunden'} (${datei})`);
  }
  if (schlecht.length) { console.log(`Anker-Check: ${schlecht.length} von ${MUTATIONEN.length} Mutationen nicht anwendbar:\n  ` + schlecht.join('\n  ')); process.exit(2); }
  console.log(`Anker-Check: alle ${MUTATIONEN.length} Anker genau einmal gefunden.`);
  if (process.argv.includes('--trocken')) process.exit(0);
}

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const lauf = () => spawnSync(process.execPath, [TEST], { cwd: TMP, encoding: 'utf8', timeout: 180000 });
// erkannt = rot MIT einer echten FEHLER-Prüfzeile; ein Absturz ist kein Beleg
const pruefFehler = (r) => ((r && r.stdout) || '').split('\n').filter((l) => /^\s*FEHLER\b/.test(l));
let ueberlebt = 0, gelaufen = 0, abstuerze = 0;
console.log(`Mutationsprobe test-fallen-client.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
const basis = lauf();
console.log(`  Ausgangslage: ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
if (basis.status !== 0) { console.log(pruefFehler(basis).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
for (const [datei, alt, neu, was] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
  const r = lauf();
  fs.writeFileSync(f, orig);
  const fe = r.status === 0 ? [] : pruefFehler(r);
  const absturz = r.status !== 0 && !fe.length;
  if (!fe.length) { ueberlebt++; if (absturz) abstuerze++; }
  console.log(`  ${fe.length ? 'rot  ' : 'GRÜN '} ${was}${fe.length ? ` (${fe.length} Fehler, z. B. ${fe[0].replace(/^\s*FEHLER\s*/, '').slice(0, 70)})` : (absturz ? '  <-- NUR ABSTURZ, nicht erkannt' : '  <-- ÜBERLEBT')}`);
}
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) nicht erkannt (davon ${abstuerze} nur Absturz)` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
