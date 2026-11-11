'use strict';
// SCA-01 P2: scanbare Objekte und die Wirkung eines vollendeten Scans. Action-Layer; Zustand `aw.sc` lebt in der Außenkarte (game.away), mit ihr zurückgesetzt, nie im Weltstand.
// Erz, Monster und Fallen melden sich in ihren eigenen Aufträgen an (GEL-03, MON-01, ITM-01); hier gibt es nur die Debug-Testziele (Art `test`, nur mit Server --debug).
//
//   scanbarAnmelden(art, def)    def = { ziele(game, aw) -> [{ id, x, y, typ }], tiefen?: { position } } (Mindest-scanStufe für x,y, Standard 3); doppelte Art = Ausnahme. -> Abmelder
//                                Hinweisstufe steht im Client-Content (`hinweisAb`), nicht hier; tiefen.hinweis wird abgelehnt.
//                                def.beiPosition(game, aw, ziel, p) (optional, ITM-01 C): nach jedem Scan, der das Ziel mit Stufe >= tiefen.position erfasst (Ort enthüllt); darf Zustand ändern (Falle: verborgen -> erkannt), muss wiederholbar sein.
//                                Ein Ziel darf `nachrang: true` tragen (MON-03 C: Gefolge wie Schwarmlinge): es wird nach allen anderen erfasst und darf aw.sc nur bis max - NACHRANG_RESERVE füllen,
//                                damit ein Schwarm den Anführer (Königin) nicht aus den Plätzen verdrängt. Die Art entscheidet aus ihren Daten, hier steht kein Typname.
//                                ziele() MUSS billig sein (Liste vorhandener Objekte, kein Neuaufbau aus der Karte): update ruft es bei nicht leerem aw.sc höchstens alle 0,5 s je Art,
//                                jeder Scan ruft es einmal. Die Liste darf bewegte Ziele mit aktueller Position liefern (der nächste Scan zieht x,y nach).
//   update(game)                 Ziele, die nicht mehr geliefert werden, fallen aus aw.sc (nur wenn aw.sc nicht leer, höchstens alle 0,5 s: Zeit über game.time)
//   snapshot(aw)                 { sc: [[id, art, typ, sk, x?, y?], …] } | {} (nur bei nicht leerem aw.sc)
//   debugScantest(game, p)       Debug `scantest`: Testziele um den Spieler (3 in Reichweite, 1 außerhalb)
//   debugScanfertig(game, p, st) Debug `scanfertig` [stufe 0..3, Standard 3]: Scan-Wirkung wie ein vollendeter Scan an der Position des Spielers
//
// Wirkung (Hook scanner.beiErgebnis, beim Laden angemeldet): alle Ziele aller Arten im Umkreis `reichweite` (Luftlinie) um den Scanort. aw.sc[art:id] = { id, art, typ, sk, x?, y? };
// sk steigt nur (ein schlechterer Scan ändert sk nicht); x,y stehen erst ab Scanstufe >= tiefen.position und werden dann bei JEDEM Scan neu gesetzt (bewegtes Ziel, z. B. Monster), auch wenn sk gleich bleibt.
// Stufe 0 (Rauschen) ändert nichts. Der Regelhinweis wird vom Client aus sk und `hinweisAb` im Client-Content gelesen, die Texte liegen im Client-Content, nicht im Snapshot.
// Obergrenze: höchstens config.scanner.maxEintraege Einträge in aw.sc; neue Ziele nehmen nur Platz ein, wenn frei (nächste zum Scanpunkt zuerst), bereits erfasste bleiben und werden weiter aktualisiert.
const Scanner = require('./scanner.js');

const STANDARD = { position: 3 };
const NACHRANG_RESERVE = 4;      // Plätze in aw.sc, die nachrangigen Zielen (Gefolge) verschlossen bleiben (MON-03 C)
const AUFRAEUMEN = 0.5;          // s: so selten prüft update, ob erfasste Ziele noch geliefert werden
const pruefBis = new WeakMap();  // Außenkarte -> game.time der nächsten Aufräumprüfung (fällt mit der Karte weg)
const arten = new Map();         // art -> { ziele, tiefen }
const testZiele = new WeakMap(); // Außenkarte -> [{ id, x, y, typ }] (nur Debug; fällt mit der Karte weg)

function scanbarAnmelden(art, def) {
  if (typeof art !== 'string' || !art) throw new Error('scanbarAnmelden: Art fehlt');
  if (!def || typeof def.ziele !== 'function') throw new Error('scanbarAnmelden: ziele() fehlt (' + art + ')');
  if (arten.has(art)) throw new Error('scanbarAnmelden: Art bereits angemeldet (' + art + ')');
  const t = Object.assign({}, STANDARD, def.tiefen || {});
  for (const k of Object.keys(t)) if (k !== 'position') throw new Error('scanbarAnmelden: tiefen.' + k + ' gibt es nicht; die Hinweisstufe steht im Client-Content (hinweisAb) (' + art + ')');
  if (!Number.isInteger(t.position) || t.position < 1 || t.position > 3) throw new Error('scanbarAnmelden: tiefen.position muss 1..3 sein (' + art + ')');
  const eintrag = { ziele: def.ziele, tiefen: t, beiPosition: typeof def.beiPosition === 'function' ? def.beiPosition : null };
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
    for (const z of liste || []) out.push({ art, id: z.id, x: z.x, y: z.y, typ: z.typ, nachrang: z.nachrang === true, tiefen: a.tiefen, bei: a.beiPosition });
  }
  return out;
}

// Ziel z mit Stufe erfassen, anheben oder (ab der Positionsstufe) nachführen. -> 'neu' (neu oder sk gestiegen) | 'bewegt' (nur x,y geändert) | 'gleich'
function erfassen(aw, z, stufe) {
  const k = schluessel(z.art, z.id);
  const alt = aw.sc && aw.sc[k];
  const mitPosition = stufe >= z.tiefen.position;
  const x = Math.round(z.x), y = Math.round(z.y);
  if (alt && alt.sk >= stufe) {
    if (!mitPosition || (alt.x === x && alt.y === y)) return 'gleich';
    alt.x = x; alt.y = y;
    return 'bewegt';
  }
  const e = alt || { id: z.id, art: z.art, typ: z.typ, sk: 0 };
  e.sk = stufe;
  if (mitPosition) { e.x = x; e.y = y; }
  if (!aw.sc) aw.sc = {};
  aw.sc[k] = e;
  return 'neu';
}

function meldung(game, p, text) { if (game.notice) game.notice(p, text); }

function scanWirkung(game, p, stufe, ort) {
  if (stufe <= 0) { meldung(game, p, 'Nur Rauschen. Der Scan war zu unsauber.'); return; }
  const aw = game.away;
  if (!aw) return;
  const R = game.C.scanner.reichweite, max = game.C.scanner.maxEintraege;
  const imKreis = [], nachrangig = new Set();
  for (const z of alleZiele(game, aw)) {
    if (z.nachrang) nachrangig.add(schluessel(z.art, z.id));
    const d = Math.hypot(z.x - ort.x, z.y - ort.y); if (d <= R) imKreis.push({ z, d });
  }
  imKreis.sort((a, b) => (a.z.nachrang - b.z.nachrang) || (a.d - b.d));   // Vorrangige zuerst, dann nächste zuerst: bei voller aw.sc rücken nur freie Plätze nach
  let belegt = aw.sc ? Object.keys(aw.sc).length : 0;
  let belegtNach = aw.sc ? Object.keys(aw.sc).filter((k) => nachrangig.has(k)).length : 0;
  const nachMax = Math.max(0, max - NACHRANG_RESERVE);
  let neu = 0, bewegt = 0, voll = 0;
  for (const { z } of imKreis) {
    const bekannt = !!(aw.sc && aw.sc[schluessel(z.art, z.id)]);
    if (!bekannt && (belegt >= max || (z.nachrang && belegtNach >= nachMax))) { voll++; continue; }
    const r = erfassen(aw, z, stufe);
    if (z.bei && stufe >= z.tiefen.position) { try { z.bei(game, aw, z, p); } catch (e) { if (game.countError) game.countError('scanbar-position-' + z.art, e); } }   // Ort enthüllt (ITM-01 C: Falle wird erkannt)
    if (r === 'neu') { neu++; if (!bekannt) { belegt++; if (z.nachrang) belegtNach++; } } else if (r === 'bewegt') bewegt++;
  }
  meldung(game, p, scanText(imKreis.length, neu, bewegt, voll));
}

function scanText(inReichweite, neu, bewegt, voll) {
  if (!inReichweite) return 'Nichts in Reichweite.';
  let t;
  if (neu) t = 'Scan: ' + neu + (neu === 1 ? ' Ziel erfasst' : ' Ziele erfasst');
  else if (bewegt) t = 'Scan: ' + bewegt + (bewegt === 1 ? ' Ziel aktualisiert' : ' Ziele aktualisiert');
  else t = voll ? 'Scan: Speicher voll' : 'Scan: nichts Neues.';
  if (voll && (neu || bewegt)) t += ' – Speicher voll (' + voll + (voll === 1 ? ' Ziel' : ' Ziele') + ' nicht erfasst)';
  return t;
}

function update(game) {
  const aw = game.away;
  if (!aw || !aw.sc) return;
  if (game.time < (pruefBis.get(aw) || 0)) return;   // gedrosselt: ziele() nur alle AUFRAEUMEN s
  pruefBis.set(aw, game.time + AUFRAEUMEN);
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

// Debug `scanfertig [stufe 0..3]`: dieselbe Wirkung (scanWirkung, derselbe Hook wie der echte Scan) am Ort des Aufrufers, ohne Minispiel und Abklingzeit
function debugScanfertig(game, p, stufe) {
  if (!game.debug) return 'scanfertig: nur mit Server --debug.';
  if (p.zone !== 'away' || !game.away) return 'scanfertig: nur am Boden.';
  const st = stufe == null || stufe === '' ? 3 : Number(stufe);
  if (!Number.isInteger(st) || st < 0 || st > 3) return 'scanfertig: Stufe 0..3.';
  scanWirkung(game, p, st, { x: p.x, y: p.y });
  return null;
}

Scanner.beiErgebnis(scanWirkung);

module.exports = { scanbarAnmelden, update, snapshot, debugScantest, debugScanfertig };
