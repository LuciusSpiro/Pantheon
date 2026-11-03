'use strict';
// TEL-01 E: Vorlade-Modul der Tickmessung (node -r tools/mess-telemetrie-vorlade.js tools/sim-headless.js ...), gestartet von tools/mess-telemetrie.js. Aendert keine Datei und kein Spielverhalten:
// es umhuellt Funktionen im Speicher des Kindprozesses und schreibt beim Prozessende EINE JSON-Zeile an MESS_AUS.
//   MESS_ART=tick     nur die Dauer jedes Game.step (fuer A-B-A-B, mit und ohne Protokoll gleich gebaut): ticks, med_us, p99_us, max_us, mittel_us
//   MESS_ART=kosten   zaehlt nur ticks und misst die Aufrufe des Protokolls: alle Funktionen von server/telemetrie/gefecht.js (B1) und haken.js (B2) und alle Methoden des Dienstes (protokoll.js),
//                     je aeusserster Aufruf (verschachtelte zaehlen nicht doppelt), abzueglich der Zeit des Schreibens (die laeuft im Server ausserhalb des Ticks; in Bot-Laeufen haben
//                     die Ticks keine Ereignisschleife dazwischen, dort schreibt der Puffer bei 1000 Zeilen mitten im Aufruf). Dazu jeder Schreibvorgang (protokoll.js schreibe, Quelltext im
//                     Speicher umhuellt): Dauer und Bytes, inkl. Serialisieren, Oeffnen, Tuning-Datei beim ersten.
// Die Zeitmessung selbst kostet etwas: je Aufruf wird der Leerlauf zweier hrtime-Aufrufe abgezogen (wie in B-Integration).

const path = require('path');
const fs = require('fs');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const ART = process.env.MESS_ART || 'tick';
const AUS = process.env.MESS_AUS;
const hr = () => process.hrtime.bigint();

let patchOk = true;
const schreibVorgaenge = [];   // { ns, bytes, imTick }
let schreibNs = 0;             // Summe aller Schreibvorgaenge (zum Abziehen aus den Aufrufen)
let stepTiefe = 0;
if (ART === 'kosten') {
  global.__telSchreibe = (ns, bytes) => { schreibNs += ns; if (bytes > 0) schreibVorgaenge.push({ ns, bytes, imTick: stepTiefe > 0 }); };
  const orig = Module.prototype._compile;
  const ZIEL = 'function schreibe(s, erzwingen) {';
  Module.prototype._compile = function (content, filename) {
    if (/server[\\/]telemetrie[\\/]protokoll\.js$/.test(filename)) {
      if (!content.includes(ZIEL)) patchOk = false;
      else content = content.replace(ZIEL, ZIEL + '\n  const __b0 = s.bytes, __t0 = process.hrtime.bigint();\n  try { return schreibe__orig(s, erzwingen); } finally { if (global.__telSchreibe) global.__telSchreibe(Number(process.hrtime.bigint() - __t0), s.bytes - __b0); }\n}\nfunction schreibe__orig(s, erzwingen) {');
    }
    return orig.call(this, content, filename);
  };
}

const { Game } = require(path.join(ROOT, 'server/game.js'));
let ticks = 0;
const dauern = [];   // ART tick: Dauer je Game.step in ns
const origStep = Game.prototype.step;
if (ART === 'tick') {
  Game.prototype.step = function () { const t0 = hr(); try { return origStep.apply(this, arguments); } finally { dauern.push(Number(hr() - t0)); ticks++; } };
} else {
  Game.prototype.step = function () { ticks++; stepTiefe++; try { return origStep.apply(this, arguments); } finally { stepTiefe--; } };
}

const stat = {};
let tiefe = 0;
if (ART === 'kosten') {
  const Gefecht = require(path.join(ROOT, 'server/telemetrie/gefecht.js'));
  const Haken = require(path.join(ROOT, 'server/telemetrie/haken.js'));
  const { Telemetrie } = require(path.join(ROOT, 'server/telemetrie/protokoll.js'));
  const wrap = (obj, k, name) => {
    const f = obj[k]; stat[name] = { n: 0, ns: 0 };
    obj[k] = function () {
      if (tiefe > 0) return f.apply(this, arguments);
      tiefe++; const s0 = schreibNs; const t0 = hr();
      try { return f.apply(this, arguments); } finally { const s = stat[name]; s.ns += Number(hr() - t0) - (schreibNs - s0); s.n++; tiefe--; }
    };
  };
  for (const k of Object.keys(Gefecht)) if (typeof Gefecht[k] === 'function' && !k.startsWith('_')) wrap(Gefecht, k, 'B1.' + k);
  for (const k of Object.keys(Haken)) if (typeof Haken[k] === 'function') wrap(Haken, k, 'B2.' + k);
  for (const k of Object.getOwnPropertyNames(Telemetrie.prototype)) {
    const d = Object.getOwnPropertyDescriptor(Telemetrie.prototype, k);
    if (k !== 'constructor' && d && typeof d.value === 'function') wrap(Telemetrie.prototype, k, 'Dienst.' + k);
  }
}
let leer = 0; { const N = 200000; let a = 0n; for (let i = 0; i < N; i++) { const x = hr(); const y = hr(); a += y - x; } leer = Number(a) / N; }

const perz = (sortiert, p) => (sortiert.length ? sortiert[Math.min(sortiert.length - 1, Math.floor(sortiert.length * p))] : null);
process.on('exit', () => {
  let o;
  if (ART === 'tick') {
    const s = Float64Array.from(dauern).sort();
    let summe = 0; for (const v of s) summe += v;
    o = { art: 'tick', ticks, med_us: perz(s, 0.5) / 1000, p99_us: perz(s, 0.99) / 1000, max_us: s.length ? s[s.length - 1] / 1000 : null, mittel_us: s.length ? summe / s.length / 1000 : null };
  } else {
    const g = { B1: 0, B2: 0, Dienst: 0 }; const je = []; let aufrufe = 0;
    for (const [k, s] of Object.entries(stat)) {
      if (!s.n) continue;
      const us = (s.ns - leer * s.n) / 1000; g[k.split('.')[0]] += us; aufrufe += s.n; je.push([k, s.n, +(us / ticks).toFixed(3)]);
    }
    je.sort((a, b) => b[2] - a[2]);
    const ns = schreibVorgaenge.map((v) => v.ns).sort((a, b) => a - b);
    const imTick = schreibVorgaenge.filter((v) => v.imTick);
    o = { art: 'kosten', patch_ok: patchOk, ticks, aufrufe, us_je_tick: +((g.B1 + g.B2 + g.Dienst) / ticks).toFixed(3), B1: +(g.B1 / ticks).toFixed(3), B2: +(g.B2 / ticks).toFixed(3), Dienst: +(g.Dienst / ticks).toFixed(3),
      leer_ns: +leer.toFixed(1), top: je.slice(0, 6),
      schreiben: { n: ns.length, im_tick: imTick.length, ns: schreibVorgaenge.map((v) => v.ns), bytes: schreibVorgaenge.map((v) => v.bytes), gesamt_ms: +(schreibNs / 1e6).toFixed(2) } };
  }
  if (AUS) fs.appendFileSync(AUS, JSON.stringify(o) + '\n');
});
