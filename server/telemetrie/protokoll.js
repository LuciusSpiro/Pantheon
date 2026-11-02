'use strict';
// TEL-01 A: der Telemetrie-Dienst (game.telemetrie). Je Session genau eine JSONL-Datei:
//   erste Zeile Sessionkopf (typ 'kopf'), dann Ereignisse, letzte Zeile typ 'session_ende'.
// Jede Zeile: { v, typ, sitzung, tick, t, ...felder }  (t = Spielzeit in s, tick = game.tick).
//
// Schreibstrategie: Im Tick wird nur eine Zeile (flaches Objekt) in einen Puffer gelegt. Geschrieben wird
//   - per setImmediate nach dem Tick (synchron, außerhalb des Ticks, über einen offen gehaltenen Dateikanal),
//   - bei Puffergrenze (Bot-Läufe haben keine Ereignisschleife zwischen den Ticks),
//   - beim Sessionende und beim Prozessende (synchron).
// Schreiben wirft nie: Fehler werden gezählt (game.countError('telemetrie-…') + eigener Zähler), der Puffer bleibt
// stehen, ein neuer Versuch folgt frühestens nach RETRY_MS. Größengrenze je Datei: danach nur zählen (verworfen).
//
// Ablage: data/telemetrie/<sitzung>.jsonl (TELEMETRIE_DIR überschreibt), Tuning einmalig in tuning/<hash>.json.
// Abschalten: TELEMETRIE=aus (game.env, sonst process.env). Quelle: TELEMETRIE_QUELLE=bot, sonst 'mensch'.
//
// Der Zustand einer Session liegt in einem eigenen Objekt `s` OHNE Verweis auf das Game. Nur so kann der Prozess beim
// Beenden auch Sessions abschließen, deren Game längst weggeräumt ist (Bot-Läufe), ohne alle Games im Speicher zu halten.
//
//   const t = game.telemetrie
//   t.sessionBeginnen() / t.kopfFuellen() / t.sessionBeenden(grund) / t.grundVormerken(grund)
//   t.ereignis(typ, felder)            // generisch, nur flache Felder (der Rest fällt weg und wird gezählt)
//   t.vonEmit(kind, data) / t.vonMissionEvent(name, data)   // Übersetzer, Tabellen in ereignisse.js
//   t.spielerBei(slot, art, nachzuegler) / t.spielerWeg(slot)
//   t.schreibeJetzt() / t.prozessEnde() / t.stand()   // stand(): zeilen, fehler, verworfen, verworfeneFelder, datei …

const fs = require('fs');
const path = require('path');
const Kopf = require('./kopf.js');
const Tabelle = require('./ereignisse.js');

const SCHEMA_VERSION = 1;
const ROOT = path.join(__dirname, '..', '..');
const MAX_BYTES = 50 * 1024 * 1024;     // je Datei; danach zählen statt schreiben
const MAX_DATEIEN = 300;                // beim Sessionbeginn nur die neuesten N Dateien behalten
const PUFFER_GRENZE = 1000;             // Zeilen; erreicht -> sofort schreiben (auch mitten im Tick)
const PUFFER_MAX = 20000;               // bei dauerhaftem Schreibfehler: ältere Zeilen verwerfen
const RETRY_MS = 1000;
const RESERVIERT = new Set(['v', 'typ', 'sitzung', 'tick', 't']);

function dirVon(env) {
  const v = (env && env.TELEMETRIE_DIR) || process.env.TELEMETRIE_DIR;
  return path.resolve(ROOT, typeof v === 'string' && v.trim() ? v.trim() : path.join('data', 'telemetrie'));
}
const envWert = (game, k) => { const e = game.env; return e && e[k] != null ? String(e[k]) : (process.env[k] != null ? String(process.env[k]) : ''); };
const flach = (v) => v === null || typeof v === 'boolean' || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
const r2 = (x) => Math.round(x * 100) / 100;

// ---------- Sessionzustand s (kein Game darin) und Schreibfunktionen darauf ----------
const offene = new Set();   // alle Sessionzustände, die noch kein session_ende haben
let exitHaken = false;
function neuerZustand(sitzung, dir, melde, start) {
  return { sitzung, dir, melde, datei: null, puffer: [], kopf: null, kopfFertig: false, fd: null, bytes: 0, geplant: false, naechsterVersuch: 0,
    grund: null, start, tick: 0, t: 0, spiel: null, tuning: null, tuningGeschrieben: false, zeilen: 0, verworfen: 0, fehler: 0, verworfeneFelder: 0 };
}
function fehler(s, where, e) { s.fehler++; try { s.melde(where, e); } catch (x) { /* nie werfen */ } }

function oeffnen(s, erzwingen) {
  if (s.fd != null) return true;
  const jetzt = Date.now();
  if (!erzwingen && jetzt < s.naechsterVersuch) return false;
  try {
    fs.mkdirSync(s.dir, { recursive: true });
    let name = s.sitzung;
    for (let i = 0; ; i++) {   // genau eine Datei je Session; Namensgleichheit (zwei Prozesse, gleiche Millisekunde) -> Zusatz
      try { s.fd = fs.openSync(path.join(s.dir, name + '.jsonl'), 'wx'); break; } catch (e) { if (e.code !== 'EEXIST' || i >= 5) throw e; name = s.sitzung + '-' + process.pid + (i ? '-' + i : ''); }
    }
    s.datei = path.join(s.dir, name + '.jsonl');
    if (name !== s.sitzung) { s.sitzung = name; for (const z of s.puffer) z.sitzung = name; }   // Dateiname = Sitzung
    aufraeumen(s);
    return true;
  } catch (e) {
    s.naechsterVersuch = jetzt + RETRY_MS; fehler(s, 'oeffnen', e);
    return false;
  }
}
function aufraeumen(s) {   // nur die neuesten MAX_DATEIEN behalten (Rotation über Sessions hinweg)
  try {
    const fl = fs.readdirSync(s.dir).filter((n) => n.endsWith('.jsonl'));
    if (fl.length <= MAX_DATEIEN) return;
    const mit = fl.map((n) => { try { return { n, m: fs.statSync(path.join(s.dir, n)).mtimeMs }; } catch (e) { return null; } }).filter(Boolean).sort((a, b) => b.m - a.m);
    for (const x of mit.slice(MAX_DATEIEN)) { try { fs.unlinkSync(path.join(s.dir, x.n)); } catch (e) { /* offen/gesperrt: egal */ } }
  } catch (e) { fehler(s, 'rotation', e); }
}
function tuningSchreiben(s) {
  if (s.tuningGeschrieben || !s.tuning) return;
  s.tuningGeschrieben = true;
  try {
    const d = path.join(s.dir, 'tuning');
    const f = path.join(d, s.tuning.hash + '.json');
    if (fs.existsSync(f)) return;
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(f, s.tuning.json(), { encoding: 'utf8', flag: 'wx' });
  } catch (e) { if (!e || e.code !== 'EEXIST') fehler(s, 'tuning', e); }
}
function kappen(s) {   // Puffer wächst bei dauerhaftem Fehler nicht ohne Grenze
  const zu = s.puffer.length - PUFFER_MAX;
  if (zu <= 0) return;
  const kopf = s.puffer[0].typ === 'kopf' ? s.puffer.shift() : null;
  s.puffer.splice(0, zu); s.verworfen += zu;
  if (kopf) s.puffer.unshift(kopf);
}
function schreibe(s, erzwingen) {
  if (!s.kopfFertig || !s.puffer.length) return;
  try {
    if (!oeffnen(s, erzwingen)) { kappen(s); return; }
    tuningSchreiben(s);
    const zeilen = s.puffer; let text = '';
    for (const z of zeilen) text += JSON.stringify(z) + '\n';
    const buf = Buffer.from(text, 'utf8');
    const mitEnde = zeilen[zeilen.length - 1].typ === 'session_ende';
    if (s.bytes + buf.length > MAX_BYTES && !mitEnde) {   // Größengrenze: zählen statt schreiben (das Ende wird immer geschrieben)
      s.verworfen += zeilen.length; s.puffer = []; return;
    }
    let off = 0;
    while (off < buf.length) off += fs.writeSync(s.fd, buf, off, buf.length - off);
    s.bytes += buf.length;
    s.puffer = [];
  } catch (e) {
    s.naechsterVersuch = Date.now() + RETRY_MS; fehler(s, 'schreiben', e);
    kappen(s);
  }
}
// Ende: Zeile session_ende, synchron schreiben, Kanal schließen. tick/t = Stand des Spiels (oder letzter bekannter Stand).
function abschliessen(s, grund, tick, t) {
  offene.delete(s);
  try {
    if (!s.kopfFertig) s.kopfFertig = true;   // Kopf wie er ist (Notfall)
    s.zeilen++;
    s.puffer.push({ v: SCHEMA_VERSION, typ: 'session_ende', sitzung: s.sitzung, tick, t: r2(t), grund: String(s.grund || grund || 'ende').slice(0, 40), dauer: r2(t - s.start),
      zeilen: s.zeilen, fehler: s.fehler, verworfen: s.verworfen, bytes: s.bytes });
    schreibe(s, true);
  } catch (e) { fehler(s, 'ende', e); }
  try { if (s.fd != null) fs.closeSync(s.fd); } catch (e) { /* egal */ }
  s.fd = null;
}
function exitAnmelden() {
  if (exitHaken) return;
  exitHaken = true;
  process.on('exit', () => {
    for (const s of [...offene]) {
      let tick = s.tick, t = s.t;
      try { const g = s.spiel && s.spiel.deref(); if (g) { tick = g.tick; t = g.time; } } catch (e) { /* letzter bekannter Stand */ }
      abschliessen(s, 'prozessende', tick, t);
    }
  });
}

class Telemetrie {
  constructor(game) {
    this.game = game;
    // Standard an. Ausnahme: Spiele ohne Speicher (noStore: Tests, Smoke- und Messwerkzeuge) schreiben nur, wenn Ablage, Quelle oder
    // TELEMETRIE=an ausdrücklich gesetzt sind (Bots setzen TELEMETRIE_QUELLE=bot); sonst füllen Dutzende Werkzeugläufe data/telemetrie.
    const ausdruecklich = !!(envWert(game, 'TELEMETRIE_DIR') || envWert(game, 'TELEMETRIE_QUELLE') || envWert(game, 'TELEMETRIE').toLowerCase() === 'an');
    this.aktiv = envWert(game, 'TELEMETRIE').toLowerCase() !== 'aus' && (!game.storeDisabled || ausdruecklich);
    this.SCHEMA_VERSION = SCHEMA_VERSION;
    this.s = null;   // Zustand der laufenden Session
    this.summe = { zeilen: 0, fehler: 0, verworfen: 0, verworfeneFelder: 0 };   // abgeschlossene Sessions dieser Instanz
    this.letzteDatei = null;
  }
  get offen() { return this.s !== null; }
  get sitzung() { return this.s ? this.s.sitzung : null; }
  get zeilen() { return this.summe.zeilen + (this.s ? this.s.zeilen : 0); }
  get fehler() { return this.summe.fehler + (this.s ? this.s.fehler : 0); }
  get verworfen() { return this.summe.verworfen + (this.s ? this.s.verworfen : 0); }
  get verworfeneFelder() { return this.summe.verworfeneFelder + (this.s ? this.s.verworfeneFelder : 0); }
  stand() {
    const s = this.s;
    return { offen: this.offen, sitzung: this.sitzung, datei: (s && s.datei) || this.letzteDatei, zeilen: this.zeilen, fehler: this.fehler, verworfen: this.verworfen, verworfeneFelder: this.verworfeneFelder, puffer: s ? s.puffer.length : 0, bytes: s ? s.bytes : 0 };
  }

  // Fehler außerhalb einer Session (z. B. beim Beginn): nur zählen
  _fehlerOhneSession(where, e) { this.summe.fehler++; try { this.game.countError('telemetrie-' + where, e); } catch (x) { /* nie werfen */ } }

  // ---------- Lebenszyklus ----------
  // Beginnt die Session (game.runId muss gesetzt sein). Reserviert die Kopfzeile; kopfFuellen() ergänzt sie am Ende des Starts.
  sessionBeginnen() {
    if (!this.aktiv) return;
    try {
      if (this.offen) this.sessionBeenden('neu');
      const g = this.game;
      if (!g.runId) return;
      const ref = new WeakRef(g);   // die Meldung an countError darf das Game nicht festhalten
      const melde = (where, e) => { const gg = ref.deref(); if (gg) gg.countError('telemetrie-' + where, e); };
      const s = neuerZustand(String(g.runId).replace(/[^A-Za-z0-9_-]/g, '_'), dirVon(g.env), melde, g.time);
      s.spiel = ref;   // schwach: beim Prozessende (Bot-Läufe ohne eigenes Sessionende) den letzten Spielstand ablesen
      this.s = s;
      s.kopf = this._zeile('kopf', {});
      s.puffer.push(s.kopf); s.zeilen = 1;
      offene.add(s);
      exitAnmelden();
    } catch (e) { this._fehlerOhneSession('beginn', e); }
  }
  kopfFuellen() {
    const s = this.s;
    if (!s || s.kopfFertig) return;
    try {
      const tuning = Kopf.tuningStand(this.game);
      s.tuning = tuning;
      Object.assign(s.kopf, Kopf.baueKopf(this.game, { tuning, quelle: envWert(this.game, 'TELEMETRIE_QUELLE').toLowerCase() === 'bot' ? 'bot' : 'mensch' }));
    } catch (e) { fehler(s, 'kopf', e); }
    s.kopfFertig = true;
    this._plane();
  }
  grundVormerken(grund) { if (this.s && grund) this.s.grund = String(grund).slice(0, 40); }
  sessionBeenden(grund) {
    const s = this.s;
    if (!s) return;
    try { if (!s.kopfFertig) this.kopfFuellen(); } catch (e) { /* kopfFuellen wirft nicht */ }
    abschliessen(s, grund, this.game.tick, this.game.time);
    this.summe.zeilen += s.zeilen; this.summe.fehler += s.fehler; this.summe.verworfen += s.verworfen; this.summe.verworfeneFelder += s.verworfeneFelder;
    this.letzteDatei = s.datei;
    this.s = null;
  }
  prozessEnde() { this.sessionBeenden('prozessende'); }

  // ---------- Zeilen ----------
  _zeile(typ, felder) {
    const g = this.game; const s = this.s;
    const z = { v: SCHEMA_VERSION, typ, sitzung: s.sitzung, tick: g.tick, t: r2(g.time) };
    s.tick = z.tick; s.t = z.t;
    for (const k of Object.keys(felder)) if (!RESERVIERT.has(k)) z[k] = felder[k];
    return z;
  }
  // Flach und primitiv: Zahl, kurzer Text, Wahrheitswert, null, Liste davon. Alles andere fällt weg (nie ein Objekt durchlassen).
  ereignis(typ, felder) {
    const s = this.s;
    if (!s) return;
    try {
      const f = {};
      if (felder) for (const k of Object.keys(felder)) {
        let v = felder[k];
        if (typeof v === 'string' && v.length > 200) v = v.slice(0, 200);
        if (Array.isArray(v) ? v.length <= 64 && v.every(flach) : flach(v)) f[k] = v; else s.verworfeneFelder++;
      }
      s.puffer.push(this._zeile(String(typ), f));
      s.zeilen++;
      if (s.puffer.length >= PUFFER_GRENZE) schreibe(s, false); else this._plane();
    } catch (e) { fehler(s, 'ereignis', e); }
  }
  _tabelle(tab, name, daten) {
    if (!this.s) return;
    const eintrag = Object.prototype.hasOwnProperty.call(tab, name) ? tab[name] : null;
    if (!eintrag) return;
    try {
      const f = eintrag.felder(daten || {}, { game: this.game, dienst: this });
      if (f) this.ereignis(eintrag.typ, f);
    } catch (e) { fehler(this.s, 'uebersetzer', e); }
  }
  vonEmit(kind, daten) { this._tabelle(Tabelle.EMIT, kind, daten); }
  vonMissionEvent(name, daten) { this._tabelle(Tabelle.MISSION, name, daten); }

  // Lebenszyklus der Mannschaft: nur Slot und Zahlen, nie das Spielerobjekt
  spielerBei(slot, art, nachzuegler) {
    this.ereignis('spieler_bei', { slot: Tabelle.slot(slot), art, nachzuegler: !!nachzuegler, spielerzahl: this.game.connectedCount() });
  }
  spielerWeg(slot) { this.ereignis('spieler_weg', { slot: Tabelle.slot(slot), spielerzahl: this.game.connectedCount() }); }

  // ---------- Schreiben ----------
  _plane() {
    const s = this.s;
    if (!s || s.geplant || !s.kopfFertig) return;
    s.geplant = true;
    setImmediate(() => { s.geplant = false; if (offene.has(s)) schreibe(s, false); });
  }
  schreibeJetzt() { if (this.s) schreibe(this.s, true); }
}

module.exports = { Telemetrie, SCHEMA_VERSION, MAX_BYTES, MAX_DATEIEN, PUFFER_GRENZE, dirVon };
