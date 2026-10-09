'use strict';
// Offene Welt (CONTRACT-M1 §9.1/9.2): bekannte/besuchte Orte, Verbindungen, versteckte Objekte (Weitscan),
// Erstbesuch-Belohnungen, Logbuch der Entdeckungen, Kartenscans für den Planungstisch.
const Locations = require('../../shared/locations.js');
const { dist } = require('../util.js');

const ITEM_NAMES = { ersatzteil: 'Ersatzteil', loeschgel: 'Löschgel', flickblech: 'Flickblech', bolzen: 'Bolzen', medipack: 'Medipack', tafel: 'Vertragstafel' };
const DEKO_NAMES = { pflanze: 'Topfpflanze', poster: 'Sternkarten-Poster', lampe: 'Messinglampe', teppich: 'Flickenteppich', buecherregal: 'Bücherregal',
  aquarium: 'Aquarium', sessel: 'Ohrensessel', sternkarte: 'Gerahmte Sternkarte', trophaee_boje: 'Bojen-Trophäe', kristalllampe: 'Kristalllampe',
  lamassu_figur: 'Lamassu-Figur' };

// §21.2: Missionsbuch-Eintrag eines versteckten Objekts. Leitbaken gehören zur laufenden Mission (Echo im Nebel),
// der Hohlraum zum Nebenauftrag „Zaunkönig“.
const bookIdOf = (h) => (h.kind === 'beacon' ? undefined : h.kind === 'hollow' ? 'zaunkoenig' : 'h:' + h.id);
// Orte, deren Log-Einträge (neu auf der Karte, Erstbesuch) zu einem Nebenauftrag gehören
const LOC_BOOK = { wrack: 'zaunkoenig' };

class Explore {
  constructor(game) {
    this.game = game;
    this.location = Locations.START;
    this.known = new Set(Locations.KNOWN_AT_START);
    this.visited = new Set();
    this.linksOpen = new Set();
    this.hidden = {};            // id -> { revealed, found }
    this.log = [];
    this.logSeq = 0;
    this.mapsKnown = { platform: false, wreck: false, kesh: false };
    this.version = 1;            // ändert sich bei jeder Änderung an Orten (Snapshot sendet dann world.locations)
    this.logVersion = 1;         // ändert sich bei neuen Logbuch-Einträgen (Snapshot sendet dann mission.log)
    this.locTime = {};
  }

  // ---------- Orte ----------
  isKnown(id) { return this.known.has(id); }
  isLinkOpen(a, b) { const k = Locations.lockedKey(a, b); return !k || this.linksOpen.has(k); }
  linksOf(id) { const l = Locations.get(id); return l ? l.links.filter((b) => this.isLinkOpen(id, b)) : []; }
  isLinked(a, b) { return this.linksOf(a).includes(b); }
  shown(id) { return this.known.has(id) || [...this.known].some((k) => this.isLinked(k, id)); }

  reveal(id, text) {
    if (!Locations.get(id) || this.known.has(id)) return false;
    this.known.add(id); this.version++;
    const loc = Locations.get(id);
    this.addLog('Neuer Ort auf der Sternkarte: ' + loc.name + '.', id, LOC_BOOK[id]);
    if (text !== false) this.game.oda(text || `Neuer Ort auf der Sternkarte: ${loc.name}.`, null);
    this.game.missionEvent('locationKnown', { loc: id });
    return true;
  }
  openLink(key) { if (!this.linksOpen.has(key)) { this.linksOpen.add(key); this.version++; } }
  // S2 (QA-INTEGRATION): Ort still bekannt machen (ohne ODA/Logbuch, nicht besucht)
  knowSilently(id) { if (!Locations.get(id) || this.known.has(id)) return false; this.known.add(id); this.version++; return true; }
  // S2: Route vom Hafen zu `target` herstellen – Orte auf dem kürzesten Weg (über alle, auch gesperrte Verbindungen)
  // still aufdecken und gesperrte Verbindungen darauf öffnen. -> true, wenn sich etwas geändert hat
  ensureRoute(target, from) {
    const start = from || Locations.START;
    if (!Locations.get(target) || !Locations.get(start)) return false;
    const prev = { [start]: null }; const queue = [start];
    while (queue.length) {
      const id = queue.shift(); if (id === target) break;
      for (const b of Locations.get(id).links) if (!(b in prev)) { prev[b] = id; queue.push(b); }
    }
    if (!(target in prev)) return false;
    let changed = false;
    for (let id = target; prev[id] != null; id = prev[id]) {
      const k = Locations.lockedKey(prev[id], id);
      if (k && !this.linksOpen.has(k)) { this.openLink(k); changed = true; }
      if (this.knowSilently(id)) changed = true;
    }
    return changed;
  }

  arrive(id) {
    const g = this.game; const loc = Locations.get(id);
    this.location = id;
    const wasKnown = this.known.has(id);
    if (!wasKnown) { this.known.add(id); this.version++; }
    if (!this.visited.has(id)) {
      this.visited.add(id); this.version++;
      const marks = g.C.discovery.firstVisitMarks;
      g.inventory.marks += marks;
      // §21.2: Erstbesuche gehören zu keinem Auftrag (außer dem Wrack -> Zaunkönig)
      this.addLog(`Erstbesuch: ${loc.name}. ${loc.desc} (+${marks} Marken)`, id, LOC_BOOK[id] || null);
      g.oda(loc.first + (wasKnown ? '' : ' Neuer Ort im Logbuch!'), null);
      g.emit('sfx', { name: 'discovery' });
      g.missionEvent('firstVisit', { loc: id });
    }
  }

  // ---------- Versteckte Objekte ----------
  hiddenHere() { const l = Locations.get(this.location); return l ? l.hidden : []; }
  isRevealed(id) { return !!(this.hidden[id] && this.hidden[id].revealed); }
  isFound(id) { return !!(this.hidden[id] && this.hidden[id].found); }

  widescanAt(x, y, r) {
    let n = 0;
    for (const h of this.hiddenHere()) {
      if (this.isRevealed(h.id)) continue;
      if (dist(x, y, h.x, h.y) <= r) { this.revealHidden(h); n++; }
    }
    return n;
  }
  revealHidden(h, quiet) {
    const g = this.game;
    this.hidden[h.id] = { revealed: true, found: false };
    this.version++;
    this.addLog('Entdeckt: ' + h.name + '.', this.locationOf(h.id), bookIdOf(h));
    g.emit('sfx', { name: 'discovery' });
    if (h.kind === 'hollow') {
      g.aways.wreck.hollow.marked = true;
      this.hidden[h.id].found = true;
      if (!quiet) g.oda('Weitscan: Hohlraum im Laderaum des Wracks! Unten markiert – dort E halten (4 s).', null);
    } else if (!quiet) {
      const t = { cache: `Weitscan: ${h.name}! Steuer: einfach drüberfliegen, dann ist es unseres.`,
        lore: `Weitscan: ${h.name}. Taktik: anvisieren (T) und scannen (S halten).`,
        beacon: `Weitscan: ${h.name}! Taktik: anvisieren (T) und scannen (S halten).` }[h.kind];
      g.oda(t || 'Weitscan: etwas Verstecktes!', null);
    }
    g.missionEvent('hiddenRevealed', { id: h.id, kind: h.kind });
  }
  // Versteck einsammeln (drüberfliegen oder Garantie complete_find): gilt danach als gefunden
  collectCache(h) {
    const g = this.game;
    if (h.kind !== 'cache' || this.isFound(h.id)) return;
    if (!this.isRevealed(h.id)) this.hidden[h.id] = { revealed: true, found: false };
    this.hidden[h.id].found = true; this.version++;
    const txt = this.reward(h.reward);
    this.addLog(h.text + ` (${txt})`, this.locationOf(h.id), bookIdOf(h));
    g.emit('sfx', { name: 'salvage' });
    g.oda(`Eingesammelt: ${h.name} – ${txt}.`, null);
    g.missionEvent('hiddenFound', { id: h.id, kind: h.kind });
  }
  locationOf(hid) { const l = Locations.LOCATIONS.find((o) => o.hidden.some((h) => h.id === hid)); return l ? l.id : null; }
  findHidden(hid) { for (const l of Locations.LOCATIONS) { const h = l.hidden.find((o) => o.id === hid); if (h) return h; } return null; }

  onHiddenScanned(h) {
    const g = this.game;
    if (h.kind === 'cache') { g.oda('Scan: ' + h.text.split('.')[0] + '. Drüberfliegen sammelt es ein.', null); return; }
    if (this.isFound(h.id)) return;
    this.hidden[h.id].found = true; this.version++;
    const txt = this.reward(h.reward);
    this.addLog(h.text + (txt ? ` (${txt})` : ''), this.locationOf(h.id), bookIdOf(h));
    g.emit('sfx', { name: 'lore' });
    g.oda(h.text.length <= 118 ? h.text : h.text.slice(0, 115) + '…', null);
    if (h.kind === 'beacon') {
      this.openLink(Locations.lockedKey('nebel', 'relais'));
      this.reveal('relais', 'Die Leitbake zeigt eine Route: Kustoden-Relais! Neu auf der Sternkarte.');
    }
    g.missionEvent('hiddenFound', { id: h.id, kind: h.kind });
  }
  onStationScanned(locId) {
    const g = this.game;
    if (locId === 'b7') { this.mapsKnown.platform = true; this.version++; g.oda('Plattform B-7 kartiert – der Plan liegt jetzt auf dem Planungstisch auf der Brücke.', null); }
    else if (locId === 'wrack') { this.mapsKnown.wreck = true; this.version++; g.oda('Wrack kartiert – Deckplan am Planungstisch. Ein Weitscan zeigt vielleicht Hohlräume.', null); }
    else if (locId === 'kesh') { this.mapsKnown.kesh = true; this.version++; g.oda('Kesh kartiert – der Plan des Archivs liegt am Planungstisch. Zwei Wege führen nach Osten.', null); }
    else if (locId === 'relais') g.oda('Relaisscan: Der Kern liegt mittig. Captain-Scan aus nächster Nähe nötig.', null);
    else g.oda('Scan abgeschlossen. Alles im Logbuch.', null);
  }

  // ---------- Belohnungen / Logbuch ----------
  reward(r) {
    if (!r) return '';
    const g = this.game; const parts = [];
    if (r.marks) { g.inventory.marks += r.marks; parts.push(r.marks + ' Marken'); }
    for (const [k, n] of Object.entries(r.items || {})) { g.inventory[k] = (g.inventory[k] || 0) + n; parts.push(n + '× ' + (ITEM_NAMES[k] || k)); }
    for (const d of r.deko || []) { g.inventory.deko.push(d); parts.push('Deko: ' + (DEKO_NAMES[d] || d)); }
    return parts.join(', ');
  }
  // §21.2: missionId ordnet den Eintrag einem Eintrag im Missionsbuch zu (m1–m3, 'sela', 'zaunkoenig', 'h:<id>').
  // Ohne Angabe gilt die zum Zeitpunkt laufende Mission. t = Spielzeit in s seit Partiestart.
  addLog(text, loc, missionId) {
    const m = this.game.mission;
    const mission = missionId !== undefined ? missionId : (m && m.activeId && m.missions[m.activeId] ? m.activeId : null);
    const t = m ? Math.round(m.playTime()) : 0;
    this.log.push({ id: 'l' + (++this.logSeq), text, loc: loc || this.location, t, mission });
    this.logVersion++;
  }
  discoveries() {
    const total = Locations.totalHidden();
    const found = Object.values(this.hidden).filter((h) => h.revealed).length;
    return { found, total };
  }

  // ---------- Tick ----------
  update(dt) {
    const g = this.game; const ship = g.ship;
    this.locTime[this.location] = (this.locTime[this.location] || 0) + dt;
    // Verstecke einsammeln: drüberfliegen
    for (const h of this.hiddenHere()) {
      if (h.kind !== 'cache' || !this.isRevealed(h.id) || this.isFound(h.id)) continue;
      if (dist(ship.x, ship.y, h.x, h.y) > g.C.discovery.cachePickupDist) continue;
      this.collectCache(h);
    }
    // Selas Notruf (Mission 1, optional): bei der Karawane andocken -> Dank + Messinglampe
    const f = g.mission.flags;
    if (f.selaCalled && !f.vaelenHelped && ship.docked && ship.dockedAt === 'vaelen') {
      f.vaelenHelped = true;
      const cfg = g.C.mission.vaelen;
      const txt = this.reward({ marks: cfg.marks, deko: [cfg.deko] });
      g.emit('sfx', { name: 'repair_done' });
      g.emit('radio', { from: 'Sela (Vaelen-Händlerin)', text: 'Ihr seid gekommen! Eure Schrauber haben meinen Reaktor gerettet. Hier: ' + txt + '. Und Tee, so viel ihr wollt.' });
      this.addLog('Sela geholfen: ' + txt + '.', 'vaelen', 'sela');
      g.missionEvent('selaHelped', {});
    }
  }

  // ---------- Weltstand (CONTRACT-S1 §5.1): nur Lesen/Schreiben, keine Ereignisse ----------
  // -> { orte: { bekannt, besucht, aufgedeckt, gefunden }, verbindungen_offen, karten, log (letzte logKeep) }
  toSave(logKeep) {
    const ids = Object.keys(this.hidden);
    return {
      orte: {
        bekannt: [...this.known], besucht: [...this.visited],
        aufgedeckt: ids.filter((id) => this.hidden[id].revealed), gefunden: ids.filter((id) => this.hidden[id].found),
      },
      verbindungen_offen: [...this.linksOpen],
      karten: Object.keys(this.mapsKnown).filter((k) => this.mapsKnown[k]),
      log: this.log.slice(-(logKeep || 60)).map((e) => {
        const o = { id: e.id, text: e.text, loc: e.loc || null, t: e.t || 0 };
        if (e.mission !== undefined) o.mission = e.mission;
        return o;
      }),
    };
  }
  // Gegenstück zu toSave (nach reset()); unbekannte Orte/Funde werden übergangen.
  restore(w) {
    const o = (w && w.orte) || {};
    const valid = (id) => !!Locations.get(id);
    this.known = new Set((o.bekannt || Locations.KNOWN_AT_START).filter(valid));
    this.visited = new Set((o.besucht || []).filter(valid));
    for (const id of this.visited) this.known.add(id);
    this.linksOpen = new Set((w && w.verbindungen_offen) || []);
    this.hidden = {};
    for (const id of o.aufgedeckt || []) if (this.findHidden(id)) this.hidden[id] = { revealed: true, found: false };
    for (const id of o.gefunden || []) if (this.findHidden(id)) this.hidden[id] = { revealed: true, found: true };
    for (const k of Object.keys(this.mapsKnown)) this.mapsKnown[k] = !!(w && Array.isArray(w.karten) && w.karten.includes(k));
    this.log = Array.isArray(w && w.log) ? w.log.map((e) => Object.assign({}, e)) : [];
    this.logSeq = this.log.reduce((mx, e) => Math.max(mx, Number(String(e.id || '').replace(/\D/g, '')) || 0), 0);
    this.version++; this.logVersion++;
  }

  // ---------- Snapshot ----------
  locationsSnapshot() {
    const out = [];
    for (const l of Locations.LOCATIONS) {
      if (!this.shown(l.id)) continue;
      const known = this.known.has(l.id);
      const disc = { found: l.hidden.filter((h) => this.isRevealed(h.id)).length, total: l.hidden.length };
      const links = this.linksOf(l.id).filter((b) => known ? this.shown(b) : this.known.has(b));
      const e = { id: l.id, name: known ? l.name : 'Unbekanntes Signal', kind: known ? l.kind : 'unknown', x: l.x, y: l.y, known,
        visited: this.visited.has(l.id), links, unknown: !known, fog: known ? !!l.fog : false,
        desc: known ? l.desc : 'Ein schwaches Signal. Hinfliegen und nachsehen?', discoveries: disc };
      if (known && l.scene.beam) e.map = this.mapsKnown[l.scene.beam.map] ? l.scene.beam.map : null;
      if (known) e.found = l.hidden.filter((h) => this.isRevealed(h.id)).map((h) => ({ id: h.id, kind: h.kind, name: h.name, done: this.isFound(h.id) }));
      out.push(e);
    }
    return out;
  }
  hiddenSnapshot() {
    return this.hiddenHere().filter((h) => this.isRevealed(h.id) && h.kind !== 'hollow').map((h) => ({ id: h.id, kind: h.kind, x: h.x, y: h.y, found: this.isFound(h.id) }))
      .concat(this.hiddenHere().filter((h) => h.kind === 'hollow' && this.isRevealed(h.id)).map((h) => ({ id: h.id, kind: h.kind, x: h.x, y: h.y, found: true })));
  }
}

module.exports = { Explore, DEKO_NAMES, ITEM_NAMES, bookIdOf };
