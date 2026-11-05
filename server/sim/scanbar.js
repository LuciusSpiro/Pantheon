'use strict';
// SCA-01 P2: scanbare Objekte und die Wirkung eines vollendeten Scans. Action-Layer; Zustand `aw.sc` lebt in der Außenkarte (game.away), mit ihr zurückgesetzt, nie im Weltstand.
// Erz, Monster und Fallen melden sich in ihren eigenen Aufträgen an (GEL-03, MON-01, ITM-01); hier gibt es nur die Debug-Testziele (Art `test`, nur mit Server --debug).
//
//   scanbarAnmelden(art, def)    def = { ziele(game, aw) -> [{ id, x, y, typ }], tiefen?: { hinweis, position } } (Mindest-scanStufe, Standard 1 und 3); doppelte Art = Ausnahme. -> Abmelder
//   update(game)                 Ziele, die nicht mehr geliefert werden, fallen aus aw.sc (nur wenn aw.sc nicht leer)
//   snapshot(aw)                 { sc: [[id, art, typ, sk, x?, y?], …] } | {} (nur bei nicht leerem aw.sc)
//   debugScantest(game, p)       Debug `scantest`: Testziele um den Spieler (3 in Reichweite, 1 außerhalb)
//
// Wirkung (Hook scanner.beiErgebnis, beim Laden angemeldet): alle Ziele aller Arten im Umkreis `reichweite` (Luftlinie) um den Scanort. aw.sc[art:id] = { id, art, typ, sk, x?, y? };
// sk steigt nur (ein schlechterer Scan ändert nichts); x,y stehen erst ab sk >= tiefen.position. Stufe 0 (Rauschen) ändert nichts. Der Regelhinweis (tiefen.hinweis) wird vom Client
// aus sk gelesen, die Texte liegen im Client-Content, nicht im Snapshot.
const Scanner = require('./scanner.js');

const STANDARD = { hinweis: 1, position: 3 };
const arten = new Map();         // art -> { ziele, tiefen }
const testZiele = new WeakMap(); // Außenkarte -> [{ id, x, y, typ }] (nur Debug; fällt mit der Karte weg)

function scanbarAnmelden(art, def) {
  if (typeof art !== 'string' || !art) throw new Error('scanbarAnmelden: Art fehlt');
  if (!def || typeof def.ziele !== 'function') throw new Error('scanbarAnmelden: ziele() fehlt (' + art + ')');
  if (arten.has(art)) throw new Error('scanbarAnmelden: Art bereits angemeldet (' + art + ')');
  const t = Object.assign({}, STANDARD, def.tiefen || {});
  for (const k of ['hinweis', 'position']) if (!Number.isInteger(t[k]) || t[k] < 1 || t[k] > 3) throw new Error('scanbarAnmelden: tiefen.' + k + ' muss 1..3 sein (' + art + ')');
  const eintrag = { ziele: def.ziele, tiefen: t };
  arten.set(art, eintrag);
  return () => { if (arten.get(art) === eintrag) arten.delete(art); };
}

const schluessel = (art, id) => art + ':' + id;

// Alle aktuell gelieferten Ziele aller Arten: [{ art, id, x, y, typ, tiefen }]
function alleZiele(game, aw) {
  const out = [];
  for (const [art, a] of arten) {
    let liste;
    try { liste = a.ziele(game, aw); } catch (e) { if (game.countError) game.countError('scanbar-' + art, e); continue; }
    for (const z of liste || []) out.push({ art, id: z.id, x: z.x, y: z.y, typ: z.typ, tiefen: a.tiefen });
  }
  return out;
}

// Ziel z mit Stufe erfassen oder anheben. -> true, wenn neu oder verbessert
function erfassen(aw, z, stufe) {
  const k = schluessel(z.art, z.id);
  const alt = aw.sc && aw.sc[k];
  if (alt && alt.sk >= stufe) return false;
  const e = alt || { id: z.id, art: z.art, typ: z.typ, sk: 0 };
  e.sk = stufe;
  if (stufe >= z.tiefen.position) { e.x = Math.round(z.x); e.y = Math.round(z.y); }
  if (!aw.sc) aw.sc = {};
  aw.sc[k] = e;
  return true;
}

function meldung(game, p, text) { if (game.notice) game.notice(p, text); }

function scanWirkung(game, p, stufe, ort) {
  if (stufe <= 0) { meldung(game, p, 'Nur Rauschen. Der Scan war zu unsauber.'); return; }
  const aw = game.away;
  if (!aw) return;
  const R = game.C.scanner.reichweite;
  let inReichweite = 0, neu = 0;
  for (const z of alleZiele(game, aw)) {
    if (Math.hypot(z.x - ort.x, z.y - ort.y) > R) continue;
    inReichweite++;
    if (erfassen(aw, z, stufe)) neu++;
  }
  if (!inReichweite) meldung(game, p, 'Nichts in Reichweite.');
  else if (!neu) meldung(game, p, 'Scan: nichts Neues.');
  else meldung(game, p, 'Scan: ' + neu + (neu === 1 ? ' Ziel erfasst' : ' Ziele erfasst'));
}

function update(game) {
  const aw = game.away;
  if (!aw || !aw.sc) return;
  const da = new Set();
  for (const z of alleZiele(game, aw)) da.add(schluessel(z.art, z.id));
  let rest = 0;
  for (const k of Object.keys(aw.sc)) { if (da.has(k)) rest++; else delete aw.sc[k]; }
  if (!rest) delete aw.sc;
}

function snapshot(aw) {
  if (!aw || !aw.sc) return {};
  const sc = [];
  for (const e of Object.values(aw.sc)) sc.push(e.x != null ? [e.id, e.art, e.typ, e.sk, e.x, e.y] : [e.id, e.art, e.typ, e.sk]);
  return sc.length ? { sc } : {};
}

// ---- Debug-Testziele: eigene Art `test` (typ testerz / testmonster), damit spätere echte Anmeldungen von `erz` und `monster` nicht kollidieren
scanbarAnmelden('test', { ziele: (game, aw) => (game.debug ? testZiele.get(aw) || [] : []) });

function debugScantest(game, p) {
  if (!game.debug) return 'scantest: nur mit Server --debug.';
  if (p.zone !== 'away' || !game.away) return 'scantest: nur am Boden.';
  const R = game.C.scanner.reichweite;
  testZiele.set(game.away, [
    { id: 'tz1', typ: 'testerz', x: p.x + R * 0.3, y: p.y },
    { id: 'tz2', typ: 'testerz', x: p.x - R * 0.4, y: p.y + R * 0.2 },
    { id: 'tz3', typ: 'testmonster', x: p.x, y: p.y - R * 0.6 },
    { id: 'tz4', typ: 'testerz', x: p.x + R * 1.6, y: p.y },   // außerhalb der Reichweite
  ]);
  meldung(game, p, 'scantest: 3 Testziele in Reichweite, 1 außerhalb.');
  return null;
}

Scanner.beiErgebnis(scanWirkung);

module.exports = { scanbarAnmelden, update, snapshot, debugScantest };
