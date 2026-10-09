#!/usr/bin/env node
'use strict';
// Bühnen-Werkzeug (CONTRACT-B1 §4, Team BUEHNE).
//   node tools/buehne.js modul <id|pfad.json>                       alle Lagen, abgeleitete Kanten, Fehler
//   node tools/buehne.js bauen <schablone> <seed> [--bauweise b --besitz b --zustand z --anker --json --decks 1|2]
//   node tools/buehne.js sweep <schablone> [--seeds 200] [--von 1] [--json] [--bauweise b --zustand z]
//   node tools/buehne.js alle [--seeds n] [--json]                  alle Schablonen × sweepSeeds
//   node tools/buehne.js typen <art>                                Platztypen der Schablonen gegen vorhandene Module
//   node tools/buehne.js pruefe [art]                               alle Module (einer Kartenart) prüfen
// Allgemein: --daten <ordner> (z. B. tools/fixtures/buehne) statt content/buehnen; Vokabular fehlt dort -> content/buehnen.
// Exit-Code 1 bei Fehlern (modul/bauen/pruefe) bzw. Bestehensquote unter CONFIG.buehne.bestehensquote (sweep/alle).
// Module mit Prüffehlern verbaut der Zusammenbau nie; bauen/sweep/alle nennen sie und melden FEHLER (Abnahme F9).
const fs = require('fs');
const path = require('path');
const Buehne = require('../shared/buehne.js');
const CONFIG = require('../shared/config.js');

const argv = process.argv.slice(2);
const flags = {}; const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    if (i + 1 < argv.length && !argv[i + 1].startsWith('--') && !['json', 'anker', 'ohne-farbe', 'kurz'].includes(k)) flags[k] = argv[++i];
    else flags[k] = true;
  } else pos.push(a);
}
const FARBE = !flags['ohne-farbe'] && !flags.json && process.stdout.isTTY;
const c = (code, t) => (FARBE ? `\u001b[${code}m${t}\u001b[0m` : t);
const rot = (t) => c('1;31', t), gelb = (t) => c('33', t), gruen = (t) => c('32', t), fett = (t) => c('1', t);

if (flags.daten) Buehne.setDaten(Buehne.ladeVerzeichnis(path.resolve(flags.daten)));
const D = Buehne.daten();
const cfg = CONFIG.buehne || Buehne.STANDARD_CFG;

function zeigeFehler(liste, art) {
  for (const f of liste) console.log('  ' + (art === 'f' ? rot('FEHLER') : gelb('Warnung')) + ` ${f.code} ${f.msg}${f.x != null ? ` @${f.x},${f.y}` : ''}`);
}
function findeSchablone(name) {
  if (D.schablonen[name]) return D.schablonen[name];
  const s = Object.values(D.schablonen).filter((q) => q.id.endsWith('.' + name) || q.id === name);
  if (s.length === 1) return s[0];
  console.error(`Schablone ${name} unbekannt. Vorhanden: ${Object.keys(D.schablonen).sort().join(', ') || '(keine)'}`);
  process.exit(2);
}

function cmdModul(arg) {
  let modul = D.module[arg];
  if (!modul && fs.existsSync(arg)) modul = JSON.parse(fs.readFileSync(arg, 'utf8'));
  if (!modul) { console.error(`Modul ${arg} unbekannt (id oder Pfad zu einer .json).`); process.exit(2); }
  const r = Buehne.pruefeModul(modul);
  if (flags.json) { console.log(JSON.stringify({ id: modul.id, ok: r.ok, fehler: r.fehler, warnungen: r.warnungen, lagen: r.lagen.map((l) => ({ rot: l.rot, spiegel: l.spiegel, aussen: l.aussen, kanten: l.kanten })) }, null, 1)); process.exit(r.ok ? 0 : 1); }
  console.log(fett(`${modul.id}`) + `  (${modul.typ}, groesse ${JSON.stringify(modul.groesse)}, drehen ${modul.drehen !== false}, spiegeln ${!!modul.spiegeln}, ` +
    `bauweise ${JSON.stringify(modul.bauweise || null)}, ${(modul.belegungen || []).length} Belegungen)`);
  const anz = {}; for (const a of r.anker || []) anz[a.rolle] = (anz[a.rolle] || 0) + 1;
  console.log('Anker: ' + (Object.keys(anz).sort().map((k) => `${k} ${anz[k]}`).join(' · ') || '–'));
  // Lagen nebeneinander (max. 4 je Block)
  const L = r.lagen;
  for (let i = 0; i < L.length; i += 4) {
    const blk = L.slice(i, i + 4);
    const kopf = blk.map((l) => {
      const t = `r${l.rot}${l.spiegel ? (l.spiegel === 'y' ? ' sy' : ' s') : ''}${l.aussen ? ' außen ' + l.aussen : ''}`;
      return t.padEnd(Math.max(l.w, 14) + 2);
    }).join('');
    console.log('\n' + kopf);
    const hmax = Math.max.apply(null, blk.map((l) => l.h));
    for (let y = 0; y < hmax; y++) {
      console.log(blk.map((l) => {
        if (y >= l.h) return ' '.repeat(Math.max(l.w, 14) + 2);
        let s = '';
        for (let x = 0; x < l.w; x++) { const a = l.anker[y][x]; s += a !== '.' ? c('1;33', a) : l.rows[y][x]; }
        return s + ' '.repeat(Math.max(l.w, 14) + 2 - l.w);
      }).join(''));
    }
    console.log(blk.map((l) => {
      const t = Object.keys(l.kanten).map((k) => k + ':' + l.kanten[k].map((x) => x[0]).join('')).join(' ');
      return t.padEnd(Math.max(l.w, 14) + 2);
    }).join(''));
  }
  console.log('\nKanten: f=frei o=offen t=tuer w=wand (je Zelle bzw. beim Schiff Zeile 2/6/10)');
  zeigeFehler(r.fehler, 'f'); zeigeFehler(r.warnungen, 'w');
  console.log(r.ok ? gruen(`OK (${L.length} Lagen)`) : rot(`${r.fehler.length} Fehler`));
  process.exit(r.ok ? 0 : 1);
}

function optsVon(sch, seed) {
  const o = { schablone: sch.id, art: sch.art, seed };
  if (flags.bauweise) o.bauweise = flags.bauweise;
  if (flags.besitz) o.besitz = flags.besitz;
  if (flags.zustand) o.zustand = flags.zustand;
  if (flags.decks) o.schiffDecks = Number(flags.decks);
  return o;
}

function cmdBauen(name, seed) {
  const sch = findeSchablone(name);
  const t0 = process.hrtime.bigint();
  const roh = flags.roh;
  let karte = null, pr = null, err = null;
  if (roh) { const r = Buehne.bauRoh(optsVon(sch, seed)); karte = r.karte; pr = r.pruefung; }
  else {
    try { karte = Buehne.bauen(optsVon(sch, seed)); pr = { ok: true, fehler: [], warnungen: karte.meta.warnungen || [] }; }
    catch (e) { err = e; const r = Buehne.bauRoh(optsVon(sch, seed)); karte = r.karte; pr = r.pruefung; }
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (flags.json) { console.log(JSON.stringify({ karte, pruefung: pr, ms, hash: karte ? Buehne.hash(karte) : null }, null, 1)); process.exit(pr.ok ? 0 : 1); }
  if (err) console.log(rot(err.message) + '\n(gezeigt: erster Versuch mit Seed ' + seed + ')');
  if (karte) {
    console.log(fett(`${sch.id} Seed ${karte.seed}`) + ` (Start ${seed}, ${karte.meta.versuche} Versuch(e)) · ${karte.w}×${karte.h} · ${karte.bauweise}/${karte.besitz || '–'}/${karte.zustand}` +
      ` · Spiegel ${karte.spiegel || '–'} · bauversion ${karte.bauversion} · Hash ${Buehne.hash(karte)} · ${ms.toFixed(1)} ms`);
    const txt = Buehne.alsText(karte, true);
    txt.forEach((r, y) => console.log(String(y).padStart(2) + ' ' + (FARBE ? r : r.replace(/\u001b\[[0-9;]*m/g, ''))));
    console.log('Anker: ' + Object.entries(Buehne.ANKER_GLYPHE).map(([k, v]) => v + '=' + k).join(' '));
    const anz = {}; for (const a of karte.anker) anz[a.rolle] = (anz[a.rolle] || 0) + 1;
    console.log('Ankerzahl: ' + Object.keys(anz).sort().map((k) => `${k} ${anz[k]}`).join(' · '));
    console.log('Plätze: ' + Object.keys(karte.plaetze).sort().map((k) => `${k}=${karte.plaetze[k].modul.split('.').slice(1).join('.')}` +
      `/r${karte.plaetze[k].lage.rot}${karte.plaetze[k].lage.spiegel ? 's' : ''}`).join(' '));
    if (Object.keys(karte.kanten).length) console.log('Türanschlüsse: ' + Object.keys(karte.kanten).map((k) => `${k}(${karte.kanten[k].typ}:${karte.kanten[k].zustand})`).join(' '));
    if (karte.patrouillen.length) console.log('Patrouillen: ' + karte.patrouillen.map((p) => p.length).join(', ') + ' Wegpunkte');
    if (karte.decks) console.log('Deck-Links: ' + karte.decks.links.map((l) => `${l.via} ${l.a}→${l.b}`).join(' · '));
    const k = karte.meta.kennzahlen;
    if (k) {
      console.log('Kennzahlen: Deckungsanteil Gefecht ' + k.deckungAnteilGefecht + ' / außen ' + k.deckungAnteilAussen + ' · Einzelblöcke ' + k.einzelblockAnteil +
        ' · Schleifen ' + k.schleifen + ' · Deckung min ' + k.deckungMin + ' ' + JSON.stringify(k.deckung) + ' · Sichtgasse ' + k.sichtgasse +
        ' · Wege ' + JSON.stringify(k.wege) + ' · getrennte Wege ' + k.wegeGetrennt + ' · Engstellen ' + (k.engstellen || []).length +
        ' · Rückzug frei ' + k.rueckzugFrei + ' · Schatten ' + JSON.stringify(k.schatten));
    }
  }
  if (pr) { zeigeFehler(pr.fehler, 'f'); zeigeFehler(pr.warnungen, 'w'); }
  const mf = modulFehlerVon(sch.art);
  if (mf.length) console.log(rot(`${mf.length} Modul(e) mit Prüffehlern, nicht verbaut: `) + mf.map((m) => `${m.id} (${m.fehler[0].code})`).join(', '));
  const gut = pr && pr.ok && !mf.length;
  console.log(gut ? gruen('OK') : rot('FEHLER'));
  process.exit(gut ? 0 : 1);
}

function sweep(sch, n, von) {
  const res = { schablone: sch.id, seeds: n, ok: 0, fehlerCodes: {}, warnCodes: {}, ms: [], kennzahlen: { deckungMin: [], deckungAnteilGefecht: [], deckungAnteilAussen: [], einzelblockAnteil: [], schleifen: [], sichtgasse: [], wegeGetrennt: [], engstellen: [] }, schlecht: [], hashes: new Set() };
  for (let s = von; s < von + n; s++) {
    const t0 = process.hrtime.bigint();
    let r;
    try { r = Buehne.bauRoh(optsVon(sch, s)); } catch (e) { r = { karte: null, pruefung: { ok: false, fehler: [{ code: 'AUSNAHME', msg: e.message }], warnungen: [] } }; }
    res.ms.push(Number(process.hrtime.bigint() - t0) / 1e6);
    const pr = r.pruefung;
    if (pr.ok) res.ok++;
    for (const f of pr.fehler) res.fehlerCodes[f.code] = (res.fehlerCodes[f.code] || 0) + 1;
    for (const f of pr.warnungen) res.warnCodes[f.code] = (res.warnCodes[f.code] || 0) + 1;
    if (r.karte) {
      res.hashes.add(Buehne.hash(r.karte));
      const k = r.karte.meta.kennzahlen;
      if (k) {
        for (const f of ['deckungMin', 'deckungAnteilGefecht', 'deckungAnteilAussen', 'einzelblockAnteil', 'schleifen']) if (k[f] != null) res.kennzahlen[f].push(k[f]);
        res.kennzahlen.sichtgasse.push(k.sichtgasse);
        if (k.wegeGetrennt != null) res.kennzahlen.wegeGetrennt.push(k.wegeGetrennt);
        if (k.engstellen) res.kennzahlen.engstellen.push(k.engstellen.length);
      }
    }
    const score = pr.fehler.length * 10 + pr.warnungen.length;
    res.schlecht.push({ seed: s, score, fehler: pr.fehler.slice(0, 2).map((f) => f.code + ' ' + f.msg), warnungen: pr.warnungen.length });
  }
  res.schlecht = res.schlecht.sort((a, b) => b.score - a.score || a.seed - b.seed).slice(0, 5).filter((x) => x.score > 0);
  res.quote = res.ok / n;
  res.verschieden = res.hashes.size; delete res.hashes;
  const st = (a) => (a.length ? { min: Math.min(...a), median: a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)], max: Math.max(...a) } : null);
  for (const k of Object.keys(res.kennzahlen)) res.kennzahlen[k] = st(res.kennzahlen[k]);
  res.bauzeit = st(res.ms.map((m) => Math.round(m * 10) / 10)); delete res.ms;
  res.modulFehler = modulFehlerVon(sch.art).map((m) => ({ id: m.id, fehler: m.fehler.slice(0, 3).map((f) => f.code + ' ' + f.msg) }));
  return res;
}
function zeigeSweep(r) {
  const q = (r.quote * 100).toFixed(0) + ' %';
  console.log(fett(r.schablone) + `: Bestehensquote ${r.quote >= cfg.bestehensquote ? gruen(q) : rot(q)} (${r.ok}/${r.seeds}), ${r.verschieden} verschiedene Karten, Bauzeit ms ${JSON.stringify(r.bauzeit)}`);
  if (Object.keys(r.fehlerCodes).length) console.log('  Fehlercodes: ' + JSON.stringify(r.fehlerCodes));
  if (Object.keys(r.warnCodes).length) console.log('  Warnungen:   ' + JSON.stringify(r.warnCodes));
  console.log('  Kennzahlen:  ' + JSON.stringify(r.kennzahlen));
  for (const s of r.schlecht) console.log(`  Seed ${s.seed}: ${s.fehler.join(' | ') || ''} (${s.warnungen} Warnungen)`);
  for (const m of r.modulFehler || []) console.log(rot('  Modul mit Prüffehlern, nicht verbaut: ') + m.id + ' – ' + m.fehler.join(' | '));
}
const modulFehlerVon = (art) => Buehne.fehlerhafteModule(art || null, D);
const sweepGut = (r) => r.quote >= cfg.bestehensquote && !(r.modulFehler && r.modulFehler.length);
function cmdSweep(name) {
  const sch = findeSchablone(name);
  const n = Number(flags.seeds || 200), von = Number(flags.von || 1);
  const r = sweep(sch, n, von);
  if (flags.json) console.log(JSON.stringify(r, null, 1)); else zeigeSweep(r);
  process.exit(sweepGut(r) ? 0 : 1);
}
function cmdAlle() {
  const n = Number(flags.seeds || cfg.sweepSeeds || 50);
  const list = Buehne.schablonen(flags.art || null);
  const out = []; let schlecht = 0;
  for (const sch of list) { const r = sweep(sch, n, 1); out.push(r); if (!sweepGut(r)) schlecht++; if (!flags.json) zeigeSweep(r); }
  if (flags.json) console.log(JSON.stringify(out, null, 1));
  else console.log(`\n${list.length} Schablonen × ${n} Seeds, ${schlecht} unter ${cfg.bestehensquote * 100} % bzw. mit fehlerhaften Modulen.`);
  process.exit(schlecht ? 1 : 0);
}
function cmdTypen(art) {
  const list = Buehne.schablonen(art);
  if (!list.length) { console.log(`Keine Schablonen für ${art}.`); }
  const mods = Buehne.module().filter((m) => m.art === art);
  const bw = flags.bauweise || ((D.achsen && D.achsen.kartenarten[art]) || {}).bauweise;
  const bedarf = {};
  for (const sch of list) {
    const pl = sch.decks ? sch.decks.flatMap((d, i) => d.plaetze.map((p) => Object.assign({ deck: i + 1 }, p))) : sch.plaetze;
    for (const p of pl) {
      const k = sch.decks ? `${p.typ} (breite ${p.breite}, deck ${p.deck})` : `${p.typ} (${p.w || 1}×${p.h || 1})`;
      (bedarf[k] = bedarf[k] || { typ: p.typ, n: 0, schablonen: new Set(), p }).n++;
      bedarf[k].schablonen.add(sch.id.split('.').pop());
    }
  }
  console.log(fett(`Platztypen ${art}`) + ` (Bauweise ${bw}; ${mods.length} Module, ${list.length} Schablonen)`);
  let fehlt = 0;
  for (const k of Object.keys(bedarf).sort()) {
    const b = bedarf[k]; const p = b.p;
    const passend = mods.filter((m) => m.typ === b.typ && (!m.bauweise || m.bauweise.includes(bw)) &&
      (p.breite ? m.groesse[0] === p.breite && (m.deck == null || m.deck === p.deck) : ((m.groesse[0] === (p.w || 1) && m.groesse[1] === (p.h || 1)) || (m.groesse[0] === (p.h || 1) && m.groesse[1] === (p.w || 1)))));
    if (!passend.length) fehlt++;
    console.log(`  ${k.padEnd(36)} ${String(b.n).padStart(2)} Plätze in ${Array.from(b.schablonen).join(',').padEnd(28)} ` +
      (passend.length ? gruen(`${passend.length} Varianten`) : rot('0 Varianten')) + (passend.length ? ' ' + passend.map((m) => m.id.split('.').slice(2).join('.')).join(',') : ''));
  }
  const unbenutzt = mods.filter((m) => !Object.values(bedarf).some((b) => b.typ === m.typ));
  if (unbenutzt.length) console.log(gelb('  Module ohne Platz: ' + unbenutzt.map((m) => m.id).join(', ')));
  process.exit(fehlt && !flags.kurz ? 1 : 0);
}
function cmdPruefe(art) {
  const mods = Buehne.module().filter((m) => !art || m.art === art);
  let schlecht = 0;
  for (const m of mods) {
    const r = Buehne.pruefeModul(m);
    if (!r.ok) schlecht++;
    if (!r.ok || r.warnungen.length) { console.log((r.ok ? gelb('~ ') : rot('✗ ')) + m.id); zeigeFehler(r.fehler, 'f'); zeigeFehler(r.warnungen, 'w'); }
  }
  console.log(`${mods.length} Module, ${schlecht} mit Fehlern.`);
  process.exit(schlecht ? 1 : 0);
}

const cmd = pos[0];
if (cmd === 'modul' && pos[1]) cmdModul(pos[1]);
else if (cmd === 'bauen' && pos[1]) cmdBauen(pos[1], Number(pos[2] || 1));
else if (cmd === 'sweep' && pos[1]) cmdSweep(pos[1]);
else if (cmd === 'alle') cmdAlle();
else if (cmd === 'typen' && pos[1]) cmdTypen(pos[1]);
else if (cmd === 'pruefe') cmdPruefe(pos[1]);
else {
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 11).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(cmd ? 2 : 0);
}
