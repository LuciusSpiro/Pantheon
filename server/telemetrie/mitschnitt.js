'use strict';
// MIT-01 A: der Recorder (game.mitschnitt). Ein REINER BEOBACHTER: er nimmt den Verlauf eines simulierten Laufs auf (Funk, ODA, Faeden, Abenteuer, Bitten, Entscheidungen, Haltung, Chronik, Wirkungen)
// und legt ihn als Datenmodell `mitschnitt/1` ab (CONTRACT-MIT01.md). Das Rendern zu mission.md/index.md macht server/telemetrie/mitschnitt-render.js (Paket B), geladen erst beim Schreiben.
//
// Grundsaetze (Vertrag): kein Haken veraendert das Spiel, verbraucht game.rng, haelt Zustand im Spiel oder beruehrt den Snapshot; jeder Eingang faengt jeden Fehler selbst (_sicher);
// ohne MITSCHNITT=1 ist game.mitschnitt null (Mitschnitt.an), es wird nichts angelegt, nichts geschrieben, kein Ordner erzeugt.
//
// Eingaenge (alle in-process, ein Eingangszaehler `nr` ueber alle, lueckenlos, Reihenfolge der Wahrheit):
//   vonEmit(kind, data)          Game.emit (radio, oda, chapter, jump, missionStart, missionDone)           game.js, am Ende von emit
//   vonRegielog(rec)             Regie-Logbuch (beide Schreiber), Haken H1 in regielog.js (Option beobachter)
//   vonTelemetrie(zeile)         Telemetrie-Senke H0 (ruf, buchung, szene_*, kill, gegner_*, spielleiter_warten), protokoll.js senkeAnmelden
//   taetigkeit(art)              H2 game.lageGrenze           bitteGestellt(bitte) / bitteGewaehlt(bitte, option)   H3 faden-bitte.js
//   buchEntscheidung(choice) / buchWahl(choice, option)   H4 sim/mission.js      haltung(wirkung, nsc)   H5 sim/faden.js
//   chronik(eintrag)             H6 sim/chronik.js            anzeige(spieler, text)   H7 game.notice
// Werkzeug: lauf({ werkzeug, regel, seed, crew, modus, kuenstlich, quelle }), kuenstlich(...arten), ende() -> Ordner | null (idempotent, wirft nie), verlauf() -> Objekt.
//
// Abweichungen vom Vertragstext (Feldnamen-Kollisionen mit dem Eingangszaehler `nr` und der Eintragsart `art`):
//   bitte/wahl: Nummer der Bitte heisst `bitte_nr` (nicht `nr`); chronik: Art des Chronik-Eintrags `chronik_art`; taetigkeit: `taetigkeit_art`; wirkung (buchung): `buchung_art`.
// Zusatzfelder an Eintraegen: `gruppe` (Id der Gruppe) und `zuordnung: 'heuristik'` (laufender Faden/Mission, nicht aus den Daten belegt).

const fs = require('fs');
const path = require('path');
const MD = require('../mission/md-ablage.js');

const ROOT = path.join(__dirname, '..', '..');
const FORMAT = 'mitschnitt/1';
const MAX_EINTRAEGE = 200000;   // harte Grenze je Lauf (danach zaehlen statt aufnehmen)
const MAX_AUFRUFE = 10;
// Technische Ids: hier ersetzt der Namensfilter nie (alle anderen String-Werte, auch tief in plan/nsc/modell, laufen durch den Ganzwort-Filter)
const ID_FELDER = new Set(['id', 'key', 'kennung', 'ref', 'faden', 'pid', 'ausgang', 'art', 'typ', 'beat', 'option', 'entscheidung', 'logart', 'ereignis', 'konto', 'modus', 'quelle', 'vorlage']);
const istIdFeld = (k) => ID_FELDER.has(k) || /_art$/.test(k);
// Leere Gruppen (Befund N1/1): Rahmenarten, die allein keinen Inhalt ergeben; 'oda' zaehlt nur im Kurzstart (Ankuendigungszeilen beim Start einer Mission)
const RAHMEN_ARTEN = new Set(['mission', 'szene', 'sprung', 'taetigkeit']);
const KURZSTART_S = 5;
// envWert: Kopie des Musters aus protokoll.js (dort nicht exportiert; protokoll.js bleibt unangetastet). slug: eigene Form (Bindestrich, leer statt Ersatzwert); md-ablage.slugify setzt '_' und liefert 'mission' als Ersatz.
const envWert = (game, k) => { const e = game && game.env; return e && e[k] != null ? String(e[k]) : (process.env[k] != null ? String(process.env[k]) : ''); };
const r1 = (x) => Math.round(x * 10) / 10;
const istObjekt = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const slug = (s) => String(s == null ? '' : s).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40);
// Eine Mission/Szene-Gruppe ohne eigenen Inhalt: nur Rahmenarten (+ ODA-Ankuendigungen), kein inhaltlicher Ausgang (nur abgebrochen/offen/session_ende) und eine Dauer unter KURZSTART_S.
// Funk, Anzeige, Entscheidung, Wahl, Wirkung, Faden, Bitte usw. machen eine Gruppe nie leer.
// Exportiert nur für den Test (tools/test-mitschnitt-aufnahme.js); im Spielcode ruft sie allein _leereMarkieren.
function gruppeIstLeer(g, es) {
  if (g && (g.art === 'faden' || g.art === 'abenteuer')) return offenerFadenIstLeer(g, es);
  if (!g || (g.art !== 'mission' && g.art !== 'szene')) return false;
  if (g.ausgang && !['offen', 'abgebrochen', 'session_ende'].includes(g.ausgang)) return false;
  const mine = (es || []).filter((e) => e.nr >= g.von_nr && e.nr <= g.bis_nr);
  if (mine.some((e) => !RAHMEN_ARTEN.has(e.art) && e.art !== 'oda')) return false;
  if (mine.some((e) => e.art === 'szene' && e.ereignis === 'ende' && e.ausgang != null && !['abgebrochen', 'session_ende'].includes(e.ausgang))) return false;
  const dauer = mine.length ? mine[mine.length - 1].spielzeit - mine[0].spielzeit : 0;
  return dauer < KURZSTART_S;
}
// Befund N2/2: ein vom Spielleiter geoeffneter, nie gespielter Faden/Abenteuer (Ausgang offen, kurz, keine eigenen Inhaltseintraege) ist ein leerer Versuch. Es zaehlen nur Eintraege, die der Gruppe
// EXPLIZIT gehoeren (gruppe = Id, nicht heuristisch zugeordnet): ein heuristisch zugeordneter Funk kann zum Nachbarn gehoeren. Ein Faden mit Ausgang ausser offen ist nie leer.
const INHALT_ARTEN = new Set(['funk', 'anzeige', 'oda', 'entscheidung', 'wahl', 'bitte', 'wirkung']);
function offenerFadenIstLeer(g, es) {
  if (g.ausgang !== 'offen') return false;
  const mine = (es || []).filter((e) => e.nr >= g.von_nr && e.nr <= g.bis_nr);
  if (mine.some((e) => e.gruppe === g.id && e.zuordnung !== 'heuristik' && INHALT_ARTEN.has(e.art))) return false;
  const dauer = mine.length ? mine[mine.length - 1].spielzeit - mine[0].spielzeit : 0;
  return dauer < KURZSTART_S;
}
const Aus = () => require('../sim/lage-ausschnitt.js');   // lazy: erst mit eingeschaltetem Mitschnitt (kein Ladezyklus mit game.js)

const offene = new Set();   // Mitschnitte ohne ende(): der Exit-Haken schreibt sie (das Werkzeug muss ende() nicht rufen)
let exitHaken = false;
function exitAnmelden() {
  if (exitHaken) return;
  exitHaken = true;
  process.on('exit', () => { for (const m of [...offene]) m.ende(); });
}

class Mitschnitt {
  // Schalter MITSCHNITT=1|an|on|true (game.env, sonst process.env, Muster envWert in protokoll.js)
  static an(game) { return /^(1|an|on|true)$/i.test(envWert(game, 'MITSCHNITT').trim()); }
  // Wurzel der Ablage: MITSCHNITT_DIR (relativ zum Repo), sonst data/mitschnitt. Darunter liegt je Lauf <JJJJ-MM-TT>_<lauf>/.
  static wurzel(game) {
    const v = envWert(game, 'MITSCHNITT_DIR').trim();
    return path.resolve(ROOT, v || path.join('data', 'mitschnitt'));
  }

  constructor(game) {
    this._spiel = new WeakRef(game);   // schwach: der Exit-Haken haelt nur den Mitschnitt, nie das Spiel
    this._wurzel = Mitschnitt.wurzel(game);
    this._beginn = new Date();
    this.v = { format: FORMAT, lauf: { id: '', werkzeug: '', quelle: 'bot', regel: '', seed: null, crew: null, modus: '', gestartet: this._beginn.toISOString(), beendet: null, kuenstlich: [] }, eintraege: [], gruppen: [], angebote: [] };
    this.nr = 0;
    this.verworfen = 0;
    this.fehler = 0;
    this.beendet = false;
    this.ordner = null;
    this._zeit0 = 0;
    this._namen = new Set();   // alle Spielernamen, die je im Lauf auftraten (der Filter wirkt beim Eintreffen)
    this._namenListe = [];
    this._idx = new Map();     // Gruppen-Id -> Gruppe
    this._meta = new Map();    // Gruppen-Id -> { nscId, beatAktiv, beatNr, offen, schluessel }
    this._offeneSzenen = new Map();   // modus|szene -> Gruppen-Id
    this._angebotModell = new Map();  // Angebotsnummer -> modell
    this._aufrufe = [];        // Bauplan-Aufrufe seit dem letzten gueltigen
    this._angebotIdx = new Map();
    this._szNr = 0;
    offene.add(this);
    exitAnmelden();
    // H0: die Telemetrie liefert Zahlen (Ruf, Buchung, Szene, Kill); ist sie sonst aus, schaltet das Anmelden den Senkenbetrieb ein (ohne Datei)
    try { if (game.telemetrie && typeof game.telemetrie.senkeAnmelden === 'function') game.telemetrie.senkeAnmelden((z) => this.vonTelemetrie(z)); } catch (e) { this.fehler++; }
  }

  get game() { return this._spiel.deref() || null; }

  // ---------- Werkzeug ----------
  lauf(o) {
    this._sicher(() => {
      const x = o || {}; const l = this.v.lauf;
      if (x.werkzeug != null) l.werkzeug = String(x.werkzeug).slice(0, 60);
      if (x.regel != null) l.regel = String(x.regel).slice(0, 300);
      if (x.seed != null) l.seed = x.seed;
      if (x.crew != null) l.crew = x.crew;
      if (x.modus != null) l.modus = String(x.modus).slice(0, 60);
      if (x.quelle != null) l.quelle = String(x.quelle).slice(0, 20);
      if (Array.isArray(x.kuenstlich)) for (const k of x.kuenstlich) this._kuenstlich(k);
    });
    return this;
  }
  kuenstlich(...arten) { this._sicher(() => { for (const k of arten) this._kuenstlich(k); }); return this; }
  _kuenstlich(k) { const s = String(k).slice(0, 40); if (!this.v.lauf.kuenstlich.includes(s)) this.v.lauf.kuenstlich.push(s); }
  verlauf() { return this.v; }

  // ---------- Eingaenge ----------
  vonEmit(kind, d) {
    this._sicher(() => {
      if (this.beendet) return;
      d = d || {};
      switch (kind) {
        case 'radio': { this._lesen(); const f = { von: d.from, text: d.text }; if (d.pid) f.pid = d.pid; this._neu('funk', f); break; }
        case 'oda': this._lesen(); this._neu('oda', { text: d.text }); break;
        case 'chapter': { this._lesen(); const f = { quelle: 'chapter', text: d.text }; if (d.title != null) f.titel = d.title; this._neu('anzeige', f); break; }
        case 'jump': this._lesen(); this._neu('sprung', { szene: d.scene, ort: d.location, von: d.from }); break;
        case 'missionStart': this._lesen(); this._missionStart(d); break;
        case 'missionDone': this._lesen(); this._missionEnde(d); break;
        default: break;
      }
    });
  }
  anzeige(p, text) {
    this._sicher(() => { if (this.beendet) return; this._lesen(); this._neu('anzeige', { quelle: 'notice', text, slot: p && p.id != null ? String(p.id) : null }); });
  }
  taetigkeit(art) {
    this._sicher(() => {
      if (this.beendet) return;
      const g = this.game; const F = g && g.weltsim && g.weltsim.faeden;
      const f = { taetigkeit_art: art }; if (F && Number.isFinite(F.t)) f.zaehler = F.t;
      this._neu('taetigkeit', f, { keine: true });
    });
  }
  bitteGestellt(b) {
    this._sicher(() => {
      if (this.beendet || !b) return;
      this._lesen();
      this._neu('bitte', { faden: b.fadenId, beat: b.beatId, bitte_nr: b.nr, von: b.von, text: b.text, optionen: (b.optionen || []).map((o) => ({ id: o.id, text: o.text })) }, { gruppe: b.fadenId });
    });
  }
  bitteGewaehlt(b, opt) {
    this._sicher(() => {
      if (this.beendet || !b || !opt) return;
      this._lesen();
      const f = { quelle: 'bitte', id: opt.id, option: opt.id, text: opt.text, ausgang: opt.ausgang === undefined ? 'zurueckgestellt' : opt.ausgang, optionen: (b.optionen || []).map((o) => ({ id: o.id, text: o.text })), faden: b.fadenId, beat: b.beatId, bitte_nr: b.nr };
      if (Array.isArray(opt.folge) && opt.folge.length) f.folge = JSON.parse(JSON.stringify(opt.folge));
      this._neu('wahl', f, { gruppe: b.fadenId });
    });
  }
  buchEntscheidung(c) {
    this._sicher(() => {
      if (this.beendet || !c) return;
      this._lesen();
      this._neu('entscheidung', { id: c.id, prompt: c.prompt, optionen: (c.options || []).map((o) => ({ id: o.id, label: o.label })) });
    });
  }
  buchWahl(c, opt) {
    this._sicher(() => {
      if (this.beendet || !c || !opt) return;
      this._lesen();
      this._neu('wahl', { quelle: 'buch', id: opt.id, option: opt.id, text: opt.label, entscheidung: c.id, optionen: (c.options || []).map((o) => ({ id: o.id, label: o.label })) });
    });
  }
  // Funk-Antwort (server/sim/funk-antwort.js): das Angebot (Optionen inkl. Ignorieren) und die Wahl, im Format der Bitte
  funkAntwortGestellt(off, ignorieren) {
    this._sicher(() => {
      if (this.beendet || !off) return;
      this._lesen();
      this._neu('entscheidung', { quelle: 'funk', id: off.id, von: off.von, funk_nr: off.lfd, optionen: this._funkOptionen(off, ignorieren) });
    });
  }
  funkAntwortGewaehlt(off, id, ignorieren) {
    this._sicher(() => {
      if (this.beendet || !off) return;
      this._lesen();
      const optionen = this._funkOptionen(off, ignorieren);
      const o = optionen.find((x) => x.id === id);
      this._neu('wahl', { quelle: 'funk', id, option: id, text: o ? o.text : null, entscheidung: off.id, funk_nr: off.lfd, optionen });
    });
  }
  _funkOptionen(off, ign) {
    const l = (off.optionen || []).map((o) => ({ id: o.id, text: o.text }));
    if (ign && ign.id) l.push({ id: ign.id, text: ign.text });
    return l;
  }
  haltung(w, nsc) {
    this._sicher(() => {
      if (this.beendet || !w || !nsc) return;
      const f = { npc: w.npc, delta: w.delta, stand: nsc.haltung }; if (w.grund != null) f.grund = w.grund;
      let gid = null;
      for (const [id, m] of this._meta) if (m.nscId === nsc.id) gid = id;   // der jüngste Faden dieses NSC
      const e = this._neu('haltung', f, gid ? { gruppe: gid } : undefined);
      if (e && gid) { const g = this._idx.get(gid); const n = g && g.nsc.find((x) => x.id === nsc.id); if (n) n.haltung = nsc.haltung; }
    });
  }
  chronik(x) {
    this._sicher(() => {
      if (this.beendet || !x) return;
      this._lesen();
      const f = { chronik_art: x.art, ref: x.ref, kurz: x.kurz, tick: x.t }; if (x.param) f.param = x.param;
      this._neu('chronik', f);
    });
  }
  vonTelemetrie(z) {
    this._sicher(() => {
      if (this.beendet || !z) return;
      switch (z.typ) {
        case 'ruf': this._neu('wirkung', { konto: 'ruf', ziel: z.fraktion, grund: z.grund, betrag: z.betrag, stand: z.stand }); break;
        case 'buchung': this._neu('wirkung', { konto: z.konto, ziel: 'crew', grund: z.grund, betrag: z.betrag, stand: z.stand, buchung_art: z.art }); break;
        case 'szene_start': this._szeneStart(z); break;
        case 'szene_ende': this._szeneEnde(z); break;
        case 'szene_neustart': this._neu('szene', { ereignis: 'neustart', modus: z.modus, szene: z.szene, versuch: z.versuch }); break;
        case 'kill': this._neu('kill', { ort: z.ort, gegner: z.gegner, rolle: z.rolle, von: z.von, waffe: z.waffe, lebte: z.lebte }); break;
        case 'gegner_neu': this._neu('gegner', { ereignis: 'neu', ort: z.ort, gegner: z.gegner, rolle: z.rolle, tag: z.tag, quelle: z.quelle }); break;
        case 'gegner_weg': this._neu('gegner', { ereignis: 'weg', ort: z.ort, gegner: z.gegner, rolle: z.rolle, grund: z.grund, lebte: z.lebte }); break;
        case 'spielleiter_warten': this._neu('regie', { logart: 'spielleiter_warten', warten_art: z.art, dauer: z.dauer, ausgang: z.ausgang }); break;
        default: break;
      }
    });
  }
  vonRegielog(rec) {
    this._sicher(() => {
      if (this.beendet || !rec) return;
      const art = String(rec.art || '');
      if (art === 'faden_ereignis') this._fadenEreignis(rec);
      else if (art === 'faden_pruefung') {
        const pl = istObjekt(rec.plan) ? rec.plan : {};
        const e = this._neu('faden_pruefung', { ausgang: rec.ausgang, fehler: Array.isArray(rec.fehler) ? rec.fehler : [], key: rec.key }, pl.faden && this._idx.has(pl.faden) ? { gruppe: pl.faden } : { keine: true });
        const g = e && e.gruppe && this._idx.get(e.gruppe);
        if (g) g.pruefer.push({ nr: e.nr, ausgang: e.ausgang, key: e.key, fehler: e.fehler });
      } else if (art === 'abenteuer_bauplan') this._bauplan(rec);
      else if (art.startsWith('abenteuer_')) this._brett(rec);
      else {
        const f = { logart: art };
        for (const k of ['quelle', 'begruendung', 'ausgang', 'key', 'plan', 'grund', 'anbieter', 'modell', 'mission', 'szene']) if (rec[k] != null) f[k] = rec[k];
        if (Array.isArray(rec.fehler) && rec.fehler.length) f.fehler = rec.fehler;
        if (rec.tokens) f.tokens = rec.tokens;
        if (rec.dauer_s != null) f.dauer_s = rec.dauer_s;
        this._neu('regie', f, { keine: true });
      }
    });
  }

  // ---------- Logbuch: Faeden, Abenteuer, Brett ----------
  _faedenZustand() { const g = this.game; return g && g.weltsim && g.weltsim.faeden ? g.weltsim.faeden : null; }
  _fadenVon(id) { const F = this._faedenZustand(); return F && Array.isArray(F.liste) ? F.liste.find((f) => f.id === id) || null : null; }
  _fadenEreignis(rec) {
    const pl = istObjekt(rec.plan) ? rec.plan : {};
    const id = pl.faden || (/^f\d+$/.test(String(rec.key)) ? rec.key : null);
    const aus = rec.ausgang;
    const f = { ausgang: aus };
    if (id) f.faden = id;
    if (pl.beat) f.beat = pl.beat;
    if (pl.typ) f.typ = pl.typ;
    if (rec.begruendung) f.begruendung = rec.begruendung;
    if (rec.key != null) f.key = rec.key;
    if (rec.plan != null) f.plan = rec.plan;
    if (aus === 'abenteuer_angeboten') {
      const e = this._neu('faden', f, { keine: true });
      if (e && Number.isInteger(pl.angebot)) this._angebot(pl.angebot, pl.vorlage);
      return;
    }
    if (aus === 'abenteuer_abgelehnt' || aus === 'abenteuer_veraltet') {
      this._neu('faden', f, { keine: true });
      const a = this._angebotIdx.get(pl.angebot); if (a) a.ausgang = aus === 'abenteuer_abgelehnt' ? 'abgelehnt' : 'verfallen';
      return;
    }
    if (!id) { this._neu('faden', f, { keine: true }); return; }
    if (aus === 'geoeffnet') {
      const e = this._neu('faden', f, { gruppe: null });
      if (e) this._fadenOeffnen(id, e, pl);
      return;
    }
    const e = this._neu('faden', f, { gruppe: this._idx.has(id) ? id : null });
    const g = this._idx.get(id); const m = this._meta.get(id);
    if (!e || !g) return;
    if (aus === 'beat_start') { m.beatAktiv = true; m.beatNr = e.nr; }
    else if (aus === 'beat_ende') m.beatAktiv = false;
    else if (aus === 'abenteuer_angenommen') {
      g.art = 'abenteuer';
      if (Number.isInteger(pl.angebot)) { g.angebot = pl.angebot; const a = this._angebotIdx.get(pl.angebot); if (a) a.ausgang = 'gespielt'; }
      this._fadenLesen(g, id);
    } else if (aus === 'abgeschlossen' || aus === 'abenteuer_ende') {
      if (pl.ausgang && (aus === 'abenteuer_ende' || !g.ausgang || g.ausgang === 'offen')) g.ausgang = String(pl.ausgang);
      this._fadenLesen(g, id);
      if (aus === 'abgeschlossen') { m.beatAktiv = false; this._schliessen(g, e.nr); }
    }
  }
  _fadenOeffnen(id, e, pl) {
    const fd = this._fadenVon(id);
    const art = fd && fd.plan ? 'abenteuer' : 'faden';
    const g = { id, art, titel: id, kennung: id, von_nr: e.nr, bis_nr: e.nr, ausgang: 'offen', angebot: Number.isInteger(pl.angebot) ? pl.angebot : null, plan: null, nsc: [], modell: null, pruefer: [] };
    this._idx.set(id, g);
    this._meta.set(id, { nscId: fd && fd.nsc ? fd.nsc.id : null, beatAktiv: false, beatNr: 0, offen: true });
    this.v.gruppen.push(g);
    e.gruppe = id;
    this._fadenLesen(g, id, true, pl.vorlage);
    if (g.angebot != null && this._angebotModell.has(g.angebot)) g.modell = this._filter(JSON.parse(JSON.stringify(this._angebotModell.get(g.angebot))));
  }
  // Plan und NSC LESEND aus dem Spielzustand kopieren (nichts davon schreibt ins Spiel)
  _fadenLesen(g, id, plan, vorlageId) {
    const fd = this._fadenVon(id);
    if (!fd) return;
    const F = this._faedenZustand();
    const kanon = F && Array.isArray(F.kanon) ? F.kanon.find((k) => k.f === id) : null;
    if (plan || !g.plan) {
      let p = fd.plan || null;
      if (!p) { try { p = require('../sim/faden-daten.js').vorlage(vorlageId || fd.vorlage) || null; } catch (e) { p = null; } }
      if (p) g.plan = this._filter(JSON.parse(JSON.stringify(p)));   // alle Strings, ausser technischen Ids
      const titel = (g.plan && g.plan.titel) || (kanon && kanon.titel) || null;
      if (titel) { g.titel = this._text(titel); g.kennung = slug(g.titel) || id; } else if (fd.vorlage) { g.titel = this._text(fd.vorlage); g.kennung = slug(g.titel) || id; }   // Kennung aus dem GEFILTERTEN Titel (Ordnername, Frontmatter)
    }
    const n = fd.nsc;
    if (n) {
      const eintrag = this._filter({ id: n.id, name: n.name, volk: n.fraktion, titel: (kanon && kanon.titel) || null, ort: (kanon && (kanon.ort_ende || kanon.ort)) || null, haltung: n.haltung, ausgang: (kanon && kanon.ausgang) || null, status: n.status || null });
      const i = g.nsc.findIndex((x) => x.id === n.id);
      if (i >= 0) g.nsc[i] = eintrag; else g.nsc.push(eintrag);
    }
  }
  _angebot(nr, vorlage) {
    if (this._angebotIdx.has(nr)) return;
    const F = this._faedenZustand();
    const a = F && Array.isArray(F.abenteuerAngebote) ? F.abenteuerAngebote.find((x) => x.nr === nr) : null;
    const titel = (a && a.vorlage && a.vorlage.titel) || vorlage || '';
    const x = { angebot: nr, titel: this._text(titel), ausgang: 'offen' };
    this._angebotIdx.set(nr, x);
    this.v.angebote.push(x);
  }
  _bauplan(rec) {
    const pl = istObjekt(rec.plan) ? rec.plan : {};
    const f = { ausgang: rec.ausgang, anbieter: rec.anbieter != null ? rec.anbieter : null, modell: rec.modell != null ? rec.modell : null, tokens: rec.tokens || 0, dauer_s: rec.dauer_s != null ? rec.dauer_s : null };
    if (rec.eskaliert != null) f.eskaliert = rec.eskaliert;
    if (pl.angebot != null) f.angebot = pl.angebot;
    if (rec.grund) f.grund = rec.grund;
    if (rec.quelle) f.quelle = rec.quelle;
    if (pl.vorlage) f.vorlage = pl.vorlage;
    const grp = Number.isInteger(pl.angebot) ? [...this._idx.values()].find((g) => g.angebot === pl.angebot) : null;
    this._neu('bauplan', f, grp ? { gruppe: grp.id } : { keine: true });
    if (['gueltig', 'abgelehnt', 'ausfall', 'verspaetet', 'eskaliert'].includes(rec.ausgang)) {
      this._aufrufe.push({ ausgang: rec.ausgang, anbieter: f.anbieter, modell: f.modell, tokens: f.tokens, dauer_s: f.dauer_s, eskaliert: !!rec.eskaliert, grund: rec.grund || null });
      if (this._aufrufe.length > MAX_AUFRUFE) this._aufrufe.shift();
    }
    if (rec.ausgang === 'gueltig' && Number.isInteger(pl.angebot)) {
      const au = this._aufrufe; this._aufrufe = [];
      this._angebotModell.set(pl.angebot, { stufe: 'bauplan', anbieter: f.anbieter, modell: f.modell, quelle: rec.quelle || null, vorlage: f.vorlage || null, rueckfall: false, eskaliert: au.some((x) => x.eskaliert), tokens: au.reduce((s, x) => s + (x.tokens || 0), 0), dauer_s: au.reduce((s, x) => s + (x.dauer_s || 0), 0), aufrufe: au });
      if (grp) grp.modell = this._filter(JSON.parse(JSON.stringify(this._angebotModell.get(pl.angebot))));
    }
  }
  _brett(rec) {
    const pl = istObjekt(rec.plan) ? rec.plan : {};
    const f = { logart: rec.art, ausgang: rec.ausgang };
    if (rec.key != null) f.key = rec.key;
    if (pl.angebot != null) f.angebot = pl.angebot;
    if (rec.begruendung) f.begruendung = rec.begruendung;
    this._neu('brett', f, { keine: true });
    if (rec.art === 'abenteuer_anschluss' && Number.isInteger(pl.angebot) && !this._angebotModell.has(pl.angebot)) {   // Rueckfall ohne Modell: Standardplan der Anschluss-Garantie
      this._angebotModell.set(pl.angebot, { stufe: 'bauplan', anbieter: null, modell: null, quelle: 'rueckfall', vorlage: rec.key != null ? String(rec.key) : null, rueckfall: true, eskaliert: this._aufrufe.some((x) => x.eskaliert), tokens: 0, dauer_s: 0, aufrufe: this._aufrufe.slice() });
      this._aufrufe = [];
    }
  }

  // ---------- Emit/Telemetrie: Missionen und Szenen ----------
  _missionStart(d) {
    let id = 'mission-' + slug(d.id);
    while (this._idx.has(id)) id += '-2';
    const e = this._neu('mission', { ereignis: 'start', id: d.id, titel: d.title }, { gruppe: null });
    if (!e) return;
    for (const [gid, m] of this._meta) if (m.offen && m.mission === d.id) { const alt = this._idx.get(gid); alt.ausgang = 'abgebrochen'; this._schliessen(alt, e.nr - 1); }   // erneuter Start derselben Mission ohne missionDone: der Versuch davor gilt als abgebrochen
    const g = { id, art: 'mission', titel: this._text(d.title || d.id), kennung: slug(d.id) || id, von_nr: e.nr, bis_nr: e.nr, ausgang: 'offen', angebot: null, plan: null, nsc: [], modell: null, pruefer: [] };
    this._idx.set(id, g); this._meta.set(id, { offen: true, mission: d.id });
    this.v.gruppen.push(g);
    e.gruppe = id;
  }
  _missionEnde(d) {
    let g = null;
    for (const [id, m] of this._meta) if (m.offen && m.mission === d.id) g = this._idx.get(id);
    const e = this._neu('mission', { ereignis: 'ende', id: d.id, titel: d.title, ausgang: d.ausgang }, g ? { gruppe: g.id } : undefined);
    if (g && e) { if (d.ausgang != null) g.ausgang = String(d.ausgang); this._schliessen(g, e.nr); }
  }
  _offeneMission() { let g = null; for (const [id, m] of this._meta) if (m.offen && m.mission !== undefined) g = this._idx.get(id); return g; }
  _szeneStart(z) {
    const e = this._neu('szene', { ereignis: 'start', modus: z.modus, szene: z.szene });
    if (!e || z.modus === 'kampagne' || this._offeneMission()) return;   // Kampagne und alles, was eine Mission ist, hat schon die Gruppe der Mission
    const id = 's' + (++this._szNr);
    const g = { id, art: 'szene', titel: this._text(String(z.modus) + ' ' + String(z.szene)), kennung: slug(String(z.modus) + '-' + String(z.szene)) || id, von_nr: e.nr, bis_nr: e.nr, ausgang: 'offen', angebot: null, plan: null, nsc: [], modell: null, pruefer: [] };
    this._idx.set(id, g); this._meta.set(id, { offen: true });
    this._offeneSzenen.set(z.modus + '|' + z.szene, id);
    this.v.gruppen.push(g);
    e.gruppe = id;
  }
  _szeneEnde(z) {
    const key = z.modus + '|' + z.szene;
    const gid = this._offeneSzenen.get(key);
    const f = { ereignis: 'ende', modus: z.modus, szene: z.szene, ausgang: z.ausgang };
    if (z.dauer != null) f.dauer = z.dauer;
    const e = this._neu('szene', f, gid ? { gruppe: gid } : undefined);
    if (gid && e) { this._offeneSzenen.delete(key); const g = this._idx.get(gid); if (z.ausgang != null) g.ausgang = String(z.ausgang); this._schliessen(g, e.nr); return; }
    // Befund N3/2: ohne Szenen-Gruppe endet hier eine Mission (abbrechen() sendet kein missionDone, nur dieses Ereignis): die offene Mission-Gruppe schliessen, Ausgang aus dem Ereignis
    if (e) {
      let mg = null;
      for (const [id, m] of this._meta) if (m.offen && m.mission !== undefined && m.mission === z.szene) mg = this._idx.get(id);
      if (mg) { if (z.ausgang != null) mg.ausgang = String(z.ausgang); this._schliessen(mg, e.nr); }
    }
  }
  _schliessen(g, nr) {
    g.bis_nr = Math.max(g.bis_nr, nr);
    const m = this._meta.get(g.id); if (m) { m.offen = false; m.beatAktiv = false; }
  }

  // ---------- Kern ----------
  // Der Mitschnitt wirft nie in den Spielverlauf: jeder Eingang laeuft durch _sicher; ein Fehler wird gezaehlt.
  _sicher(fn) { try { fn(); } catch (e) { this.fehler++; } }
  _lesen() {   // Spielernamen beim Eintreffen merken (nie wieder vergessen)
    const g = this.game;
    if (!g || !Array.isArray(g.players)) return;
    let neu = false;
    for (const p of g.players) {
      const n = p && typeof p.name === 'string' ? p.name.trim() : '';
      if (n.length >= 2 && !this._namen.has(n)) { this._namen.add(n); neu = true; }
    }
    if (neu) this._namenListe = [...this._namen].sort((a, b) => b.length - a.length);
  }
  _text(t) { if (t == null) return t; const s = String(t); return this._namenListe.length ? Aus().ohneNamenGanzwort(s, this._namenListe) : s; }
  // Kopie mit Ganzwort-Namensfilter auf ALLEN String-Werten (rekursiv); Ausnahme: Werte technischer Id-Felder (ID_FELDER); Zahlen/Struktur bleiben
  _filter(v, idFeld) {
    if (typeof v === 'string') return idFeld ? v : this._text(v);
    if (Array.isArray(v)) return v.map((x) => this._filter(x, idFeld));
    if (istObjekt(v)) { const o = {}; for (const k of Object.keys(v)) o[k] = this._filter(v[k], istIdFeld(k)); return o; }
    return v;
  }
  _zeit() { const g = this.game; if (g && Number.isFinite(g.time)) this._zeit0 = g.time; return r1(this._zeit0); }
  // opt: { gruppe: id | null (exakt oder keine) } | { keine: true } | undefined (heuristisch: laufender Faden / Mission / Szene)
  _neu(art, felder, opt) {
    if (this.beendet) return null;
    if (this.v.eintraege.length >= MAX_EINTRAEGE) { this.verworfen++; return null; }
    const e = Object.assign({ nr: 0, spielzeit: this._zeit(), art }, this._filter(felder));
    let g = null; let heuristik = false;
    if (opt && opt.gruppe !== undefined) g = opt.gruppe ? this._idx.get(opt.gruppe) || null : null;
    else if (!opt && !(art === 'funk' && e.von === 'Auftragsbrett')) { g = this._laufende(); heuristik = !!g; }
    e.nr = ++this.nr;
    this.v.eintraege.push(e);
    if (g) { e.gruppe = g.id; if (heuristik) e.zuordnung = 'heuristik'; g.bis_nr = Math.max(g.bis_nr, e.nr); }
    return e;
  }
  _laufende() {
    let best = null; let nr = -1;
    for (const [id, m] of this._meta) if (m.offen && m.beatAktiv && m.beatNr >= nr) { best = id; nr = m.beatNr; }
    if (best) return this._idx.get(best);
    const ms = this._offeneMission();
    if (ms) return ms;
    let sz = null; for (const [id, m] of this._meta) if (m.offen && !m.mission && m.beatNr === undefined) sz = this._idx.get(id);
    return sz;
  }

  // ---------- Ende ----------
  // Schreibt den Lauf ueber den Renderer (lazy geladen; fehlt er oder wirft er, steht verlauf.json trotzdem da). Idempotent, wirft nie. Rueckgabe: Ordner des Laufs, null ohne Eintraege oder bei Fehler.
  // Ein Lauf ohne einen einzigen Eintrag schreibt nichts (Spiele ohne Inhalt legen keinen leeren Ordner an).
  ende() {
    if (this.beendet) return this.ordner;
    try {
      this._sicher(() => {
        const g = this.game;
        if (g) { for (const id of this._idx.keys()) { const m = this._meta.get(id); if (m && m.offen && this._idx.get(id).art !== 'mission') this._fadenLesen(this._idx.get(id), id); } }
        for (const gr of this.v.gruppen) { const m = this._meta.get(gr.id); if (m && m.offen) { gr.bis_nr = Math.max(gr.bis_nr, this.nr); m.offen = false; } }
      });
      this._sicher(() => this._leereMarkieren());
    } finally { this.beendet = true; offene.delete(this); }
    if (!this.nr) return null;
    try {
      const jetzt = new Date();
      this.v.lauf.beendet = jetzt.toISOString();
      this.v.lauf.verworfen = this.verworfen;   // Befund N3/4: ueber MAX_EINTRAEGE hinaus gekappte Eintraege (sonst stumm verloren)
      const dir = this._ordnerWaehlen();
      this.v.lauf.id = path.basename(dir);
      let ok = false;
      try {
        const R = Mitschnitt.renderLader();
        if (R && typeof R.schreibeLauf === 'function') { R.schreibeLauf(this.v, dir, { jetzt }); ok = true; }
      } catch (e) { this.fehler++; }
      if (!ok || !fs.existsSync(path.join(dir, 'verlauf.json'))) {   // ohne Renderer: wenigstens die Rohdaten
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'verlauf.json'), JSON.stringify(this.v, null, 1) + '\n', 'utf8');
      }
      this.ordner = dir;
    } catch (e) { this.fehler++; this.ordner = null; }
    return this.ordner;
  }
  // Leere Gruppen bekommen `leer: true` (+ `ersetzt_durch`: die naechste nicht leere Gruppe derselben Kennung, ein Vorversuch); die Eintraege bleiben im Verlauf
  _leereMarkieren() {
    const gs = this.v.gruppen;
    for (const g of gs) { if (gruppeIstLeer(g, this.v.eintraege)) g.leer = true; }
    for (const g of gs) {
      if (!g.leer) continue;
      const nachfolger = gs.find((x) => x !== g && !x.leer && x.kennung === g.kennung && x.von_nr > g.bis_nr);
      if (nachfolger) g.ersetzt_durch = nachfolger.id;
    }
  }
  // Befund N3/6: der Lauf-Ordner wird EXKLUSIV angelegt (mkdir ohne recursive scheitert mit EEXIST, wenn ein anderer Lauf ihn hat): -2, -3, ... Ein frueherer Lauf gleichen Namens bleibt samt Bewertung und Notizen unberuehrt.
  _ordnerWaehlen() {
    const l = this.v.lauf;
    const name = [slug(l.werkzeug) || 'lauf', l.seed != null ? 's' + slug(l.seed) : '', l.crew != null ? 'c' + slug(l.crew) : '', slug(l.modus)].filter(Boolean).join('-');
    const basis = MD.localDate(this._beginn) + '_' + name;
    fs.mkdirSync(this._wurzel, { recursive: true });
    for (let i = 1; i < 1000; i++) {
      const dir = path.join(this._wurzel, i === 1 ? basis : basis + '-' + i);
      try { fs.mkdirSync(dir); return dir; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
    const dir = path.join(this._wurzel, basis + '-' + Date.now());
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
}
// Der Renderer (Paket B) wird erst beim Schreiben geladen; Tests ersetzen den Lader durch einen Stub.
Mitschnitt.renderLader = () => require('./mitschnitt-render.js');

module.exports = { Mitschnitt, FORMAT, gruppeIstLeer };
