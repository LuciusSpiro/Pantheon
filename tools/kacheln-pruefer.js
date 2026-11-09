'use strict';
// KAC-01 D: Pruefer fuer Hexe mit Feld `typ` (Sektortypen-Katalog content/welt/sektortypen.json, Szenen aus shared/gen-sektor.js).
// Gemeinsame Bausteine von tools/check-sektoren.js (Katalog, Typen, Layout, Koerper, Beams) und tools/check-erreichbar.js (Anflug, Landepunkt-IDs).
// Reine Funktionen auf Kartendaten: jede liefert { pruefungen, fehler: [{ code, wo, msg }] }, sie werfen nie und ruehren keinen Spielzustand an
// (nur pruefeKarteErreichbar setzt die Karte kurz in shared/sektoren.js und stellt die vorherige zurueck).
// Hexe ohne `typ` werden nicht angefasst.
const Sektoren = require('../shared/sektoren.js');
const GEN = require('../shared/gen-sektor.js');
const ST = require('../shared/sektortypen.js');
const CONFIG = require('../shared/config.js');

const hatTyp = (daten) => !!daten && daten.typ !== undefined;
const typListe = (daten) => (Array.isArray(daten.typ) ? daten.typ : [daten.typ]);
const kombi = (daten) => JSON.stringify(daten.typ);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function neu() {
  const r = { pruefungen: 0, fehler: [] };
  r.pruefe = (ok, code, wo, msg) => { r.pruefungen++; if (!ok) r.fehler.push({ code, wo, msg }); return ok; };
  return r;
}
function zusammen(...teile) {
  const r = { pruefungen: 0, fehler: [] };
  for (const t of teile) { r.pruefungen += t.pruefungen; r.fehler.push(...t.fehler); }
  return r;
}
const leser = (katalogDaten) => (katalogDaten ? ST.leser(katalogDaten) : ST.lade());

// ---------- Katalog ----------
// Schema des Katalogs inkl. Guetercodes (T/M/U/E/N/R) in `quelle` der Typen und Planetenarten; Befunde aus shared/sektortypen.js
function pruefeKatalog(katalogDaten) {
  const r = neu();
  const k = katalogDaten || ST.katalog();
  const f = ST.fehlerListe(k);
  r.pruefe(f.length === 0, 'ERR-KATALOG', 'Katalog', 'Sektortypen-Katalog ungueltig: ' + f.join(' | '));
  return r;
}

// ---------- Typen eines Hex ----------
// Typ(en) existieren, Gasriese nur als erster Eintrag, instabil nur allein, hoechstens eine Station. Ohne gueltige Typen keine weitere Pruefung.
function pruefeTypen(hex, daten, katalogDaten) {
  const r = neu();
  if (!hatTyp(daten)) return r;
  const L = leser(katalogDaten);
  const wo = `Hex ${hex}`;
  const ids = typListe(daten);
  if (!r.pruefe(ids.length > 0 && ids.every((id) => typeof id === 'string'), 'ERR-TYP', wo, `typ ${kombi(daten)}: muss eine Typ-ID oder eine nichtleere Liste von Typ-IDs sein`)) return r;
  const unbekannt = ids.filter((id) => !L.istTyp(id));
  if (!r.pruefe(unbekannt.length === 0, 'ERR-TYP', wo, `typ ${kombi(daten)}: unbekannter Typ ${unbekannt.map((u) => `'${u}'`).join(', ')} (gueltig: ${L.typen().join(', ')})`)) return r;
  const hatGas = (id) => L.typ(id).koerper.some((v) => v.art === 'gasriese');
  r.pruefe(ids.every((id, i) => i === 0 || !hatGas(id)), 'ERR-TYP', wo, `typ ${kombi(daten)}: Gasriese nur als erster Eintrag (Haupttyp); als Zweittyp ist er in der Szene 3000x2200 nicht platzierbar`);
  r.pruefe(ids.length === 1 || !ids.some((id) => L.typ(id).platzhalter === true), 'ERR-TYP', wo, `typ ${kombi(daten)}: Platzhaltertyp (instabil) steht nur allein, nicht in einer Kombination`);
  let stationen = 0;
  try { stationen = GEN.koerperVon(hex, daten, L).filter((k) => k.art === 'station').length; } catch (e) { stationen = 0; }
  r.pruefe(stationen <= 1, 'ERR-TYP', wo, `typ ${kombi(daten)}: ${stationen} Stationen (die Szene kennt nur eine; station+station ist nicht erlaubt)`);
  return r;
}

// ---------- Layout-Probe ----------
// Baut die Szene wirklich; wirft erzeuge(), ist die Kombination nicht platzierbar. Liefert zusaetzlich die Szene (null bei Fehler).
function layoutProbe(hex, daten, katalogDaten) {
  const r = neu();
  const cfg = Object.assign({}, CONFIG.sektoren && CONFIG.sektoren.datenSzene, { katalog: leser(katalogDaten) });
  let loc = null;
  try { loc = GEN.erzeuge(hex, daten, cfg); } catch (e) { r.pruefe(false, 'ERR-LAYOUT', `Hex ${hex}`, `typ ${kombi(daten)}: Szene nicht erzeugbar: ${e.message}`); return { r, szene: null }; }
  r.pruefe(true, 'ERR-LAYOUT', `Hex ${hex}`, '');
  return { r, szene: loc.scene };
}

// ---------- Szene: Koerper und Beams ----------
// Koerper-IDs eindeutig, Koerper in der Szene, landbare mit beam.range > 0, Beam-Bereiche landbarer Koerper ueberlappen nicht
function pruefeSzene(hex, szene) {
  const r = neu();
  const wo = `Hex ${hex}`;
  if (!r.pruefe(szene && Array.isArray(szene.koerper), 'ERR-KOERPER', wo, 'Szene hat keine Koerperliste (scene.koerper)')) return r;
  const ids = new Set();
  for (const k of szene.koerper) {
    r.pruefe(typeof k.id === 'string' && !ids.has(k.id), 'ERR-KOERPER', wo, `Koerper-ID '${k.id}' doppelt oder fehlt`);
    ids.add(k.id);
    const inSzene = [k.x, k.y, k.r].every(Number.isFinite) && k.x - k.r >= 0 && k.y - k.r >= 0 && k.x + k.r <= szene.w && k.y + k.r <= szene.h;
    r.pruefe(inSzene, 'ERR-KOERPER', wo, `Koerper ${k.id} (${k.art}) liegt ausserhalb der Szene ${szene.w}x${szene.h} (${k.x},${k.y} r ${k.r})`);
    if (k.landbar) r.pruefe(!!k.beam && k.beam.range > 0, 'ERR-BEAM', wo, `landbarer Koerper ${k.id} (${k.art}) ohne Beam-Bereich (beam.range ${k.beam && k.beam.range})`);
  }
  const landbar = szene.koerper.filter((k) => k.landbar && k.beam && k.beam.range > 0);
  for (let i = 0; i < landbar.length; i++) for (let j = i + 1; j < landbar.length; j++) {
    const a = landbar[i], b = landbar[j], d = dist(a, b);
    r.pruefe(d >= a.beam.range + b.beam.range, 'ERR-BEAM', wo, `Beam-Bereiche von ${a.id} und ${b.id} ueberlappen (Abstand ${Math.round(d)} < ${a.beam.range + b.beam.range})`);
  }
  return r;
}

// Alle Pruefungen des Sektor-Checkers fuer EINEN Hex mit typ
function pruefeHex(hex, daten, katalogDaten) {
  if (!hatTyp(daten)) return neu();
  const t = pruefeTypen(hex, daten, katalogDaten);
  if (t.fehler.length) return t;
  const p = layoutProbe(hex, daten, katalogDaten);
  return zusammen(t, p.r, p.szene ? pruefeSzene(hex, p.szene) : neu());
}

// Landepunkt-ID je Koerper (Schema k_<hex>.k<index>, bzw. `ort` des Hexes): nur gerechnet, die Ableitung im Spiel baut Paket C
const landepunktId = (hex, daten, index) => `${(daten && daten.ort) || 'k_' + hex}.k${index}`;

// check-sektoren fuer eine ganze Karte: Katalog einmal, dann jeder Hex mit typ; Orts-/Landepunkt-IDs eindeutig
function pruefeKarte(karte, katalogDaten) {
  const kat = pruefeKatalog(katalogDaten);
  if (kat.fehler.length) return kat;   // ohne gueltigen Katalog laesst sich keine Szene bauen: erst den Katalog beheben
  const teile = [kat];
  const lp = new Map();
  for (const [hex, daten] of Object.entries((karte && karte.hexe) || {})) {
    if (!hatTyp(daten)) continue;
    const r = neu();
    r.pruefe(!daten.ort || daten.gen === true, 'ERR-TYP', `Hex ${hex}`, `typ ${kombi(daten)}: Hex hat ort '${daten.ort}', aber nicht gen:true (feste Szene, typ wird nie gelesen)`);
    teile.push(r, pruefeHex(hex, daten, katalogDaten));
    const p = layoutProbe(hex, daten, katalogDaten);
    if (p.szene) for (const k of p.szene.koerper) {
      if (!k.landbar) continue;
      const id = landepunktId(hex, daten, k.index);
      const q = neu();
      q.pruefe(!lp.has(id), 'ERR-KOERPER', `Hex ${hex}`, `Landepunkt-ID '${id}' kommt doppelt vor (auch in Hex ${lp.get(id)}); Orts-IDs der Hexe muessen eindeutig sein`);
      lp.set(id, hex);
      teile.push(q);
    }
  }
  return zusammen(...teile);
}

// ---------- Erreichbarkeit (check-erreichbar) ----------
const RASTER = 40, SCHIFF = 30;
// Zellenraster der Szene; frei = nicht in einem Hindernis (Koerperscheibe + Schiffsradius). Gibt die vom Start erreichbaren Zellen zurueck.
function erreichbareZellen(szene, hindernisse, start) {
  const nx = Math.ceil(szene.w / RASTER), ny = Math.ceil(szene.h / RASTER);
  const mitte = (i, j) => ({ x: i * RASTER + RASTER / 2, y: j * RASTER + RASTER / 2 });
  const frei = (i, j) => { const m = mitte(i, j); return !hindernisse.some((h) => dist(m, h) < h.r + SCHIFF); };
  const si = Math.min(nx - 1, Math.max(0, Math.floor(start.x / RASTER))), sj = Math.min(ny - 1, Math.max(0, Math.floor(start.y / RASTER)));
  const gesehen = new Set([sj * nx + si]);
  if (!frei(si, sj)) return { gesehen, mitte, nx, ny, startFrei: false };
  const q = [[si, sj]];
  while (q.length) {
    const [i, j] = q.pop();
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj, key = b * nx + a;
      if (a < 0 || b < 0 || a >= nx || b >= ny || gesehen.has(key) || !frei(a, b)) continue;
      gesehen.add(key); q.push([a, b]);
    }
  }
  return { gesehen, mitte, nx, ny, startFrei: true };
}

// Anflug in EINER Szene: je landbarem Koerper liegt der Beam-Bereich in der Szene und ist von der Ankunft aus ohne Hindernis (andere Koerper) erreichbar;
// optional: Sprungpunkte (Liste {x,y}) liegen ausserhalb aller Koerper (+80) und sind ebenso erreichbar.
function pruefeAnflug(hex, szene, sprungpunkte) {
  const r = neu();
  const wo = `Hex ${hex}`;
  if (!r.pruefe(szene && Array.isArray(szene.koerper) && szene.arrive, 'ERR-ANFLUG', wo, 'Szene ohne Koerperliste oder Ankunft')) return r;
  const alle = szene.koerper;
  for (const k of alle) {
    if (!k.landbar) continue;
    const range = k.beam && k.beam.range;
    r.pruefe(range > 0 && k.x - range >= 0 && k.y - range >= 0 && k.x + range <= szene.w && k.y + range <= szene.h, 'ERR-ANFLUG', wo,
      `Beam-Bereich von ${k.id} (${k.art}, range ${range}) liegt nicht in der Szene ${szene.w}x${szene.h} (${k.x},${k.y})`);
  }
  const ziele = alle.filter((k) => k.landbar && k.beam && k.beam.range > 0);
  const sp = sprungpunkte || [];
  if (!ziele.length && !sp.length) return r;
  for (const s of sp) {
    const nah = alle.find((k) => dist(s, k) < k.r + 80);
    r.pruefe(!nah, 'ERR-ANFLUG', wo, `Sprungpunkt (${s.x},${s.y}) liegt in Koerper ${nah && nah.id} (${nah && nah.art})`);
  }
  const lauf = erreichbareZellen(szene, alle, szene.arrive);
  if (!r.pruefe(lauf.startFrei, 'ERR-ANFLUG', wo, `Ankunft (${szene.arrive.x},${szene.arrive.y}) liegt in einem Koerper`)) return r;
  for (const k of ziele) {
    // Hindernisse sind die ANDEREN Koerper: der Beam-Bereich selbst darf ueberflogen werden, die eigene Scheibe liegt im Bereich
    const ohneSelbst = erreichbareZellen(szene, alle.filter((x) => x !== k), szene.arrive);
    const erreicht = [...ohneSelbst.gesehen].some((key) => dist(ohneSelbst.mitte(key % ohneSelbst.nx, Math.floor(key / ohneSelbst.nx)), k) <= k.beam.range);
    r.pruefe(erreicht, 'ERR-ANFLUG', wo, `Beam-Bereich von ${k.id} (${k.art}) ist von der Ankunft (${szene.arrive.x},${szene.arrive.y}) aus nicht anfliegbar (andere Koerper versperren den Weg)`);
  }
  for (const s of sp) {
    const key = Math.floor(s.y / RASTER) * lauf.nx + Math.floor(s.x / RASTER);
    let ok = lauf.gesehen.has(key);
    if (!ok) for (const kk of lauf.gesehen) { const m = lauf.mitte(kk % lauf.nx, Math.floor(kk / lauf.nx)); if (dist(m, s) <= RASTER) { ok = true; break; } }
    r.pruefe(ok, 'ERR-ANFLUG', wo, `Sprungpunkt (${s.x},${s.y}) ist von der Ankunft aus nicht anfliegbar`);
  }
  return r;
}

// Sprungpunkte eines Hex: je Kante der Karte an den Szenenrand (wie Sektoren.sprungpunktLage, 180 px vor dem Rand)
function sprungpunkteVon(hex, szene) {
  const out = [];
  for (const e of Sektoren.kantenVon(hex)) out.push(Sektoren.sprungpunktLage(szene.w, szene.h, Sektoren.richtung(hex, Sektoren.anderes(e, hex)), 180));
  return out;
}

// Alle typ-Hexe einer Karte vom Start (karte.start.ort bzw. ersten Hex mit typ) ueber offene Kanten erreichbar
function pruefeZusammenhang(karte) {
  const r = neu();
  const typHexe = Object.entries(karte.hexe || {}).filter(([, d]) => hatTyp(d)).map(([h]) => h);
  if (!typHexe.length) return r;
  const start = Object.keys(karte.hexe).find((h) => karte.hexe[h].ort && karte.hexe[h].ort === (karte.start && karte.start.ort)) || typHexe[0];
  const nb = {};
  for (const e of karte.kanten || []) if (e.art === 'open') { (nb[e.a] = nb[e.a] || []).push(e.b); (nb[e.b] = nb[e.b] || []).push(e.a); }
  const gesehen = new Set([start]); const q = [start];
  while (q.length) { const h = q.pop(); for (const n of nb[h] || []) if (!gesehen.has(n)) { gesehen.add(n); q.push(n); } }
  for (const h of typHexe) r.pruefe(gesehen.has(h), 'ERR-ANFLUG', `Hex ${h}`, `von Start-Hex ${start} ueber offene Kanten nicht erreichbar`);
  return r;
}

// check-erreichbar fuer eine ganze Karte (typ-Hexe): Zusammenhang, Anflug je Koerper, Sprungpunkte. Setzt die Karte kurz in Sektoren und stellt die vorherige zurueck.
function pruefeKarteErreichbar(karte, katalogDaten) {
  const teile = [pruefeZusammenhang(karte)];
  const vorher = Sektoren.KARTE;
  try {
    Sektoren.setzeKarte(karte);
    for (const [hex, daten] of Object.entries(karte.hexe || {})) {
      if (!hatTyp(daten)) continue;
      const p = layoutProbe(hex, daten, katalogDaten);
      if (!p.szene) { teile.push(p.r); continue; }
      teile.push(pruefeAnflug(hex, p.szene, sprungpunkteVon(hex, p.szene)));
    }
  } finally { Sektoren.setzeKarte(vorher); }
  return zusammen(...teile);
}

module.exports = {
  pruefeKatalog, pruefeTypen, layoutProbe, pruefeSzene, pruefeHex, pruefeKarte,
  pruefeAnflug, sprungpunkteVon, pruefeZusammenhang, pruefeKarteErreichbar, landepunktId, hatTyp,
};
