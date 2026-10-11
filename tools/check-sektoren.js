'use strict';
// Sektor- und Ortsprüfung (CONTRACT-B3 §2; Team SEKTOR): Orte-Block aus tools/check-maps.js („M1: Orte“) und die
// Prüfungen der Karte Limes (content/welt/limes.json, übernommen aus karte_limes.py im Vault).
//   node tools/check-sektoren.js [--svg datei.svg]
const Maps = require('../shared/maps.js');

let failures = 0, checks = 0;
function check(cond, text) {
  checks++;
  if (cond) console.log('  ok   ' + text);
  else { failures++; console.log('  FEHLER ' + text); }
}

// ---------- M1: Orte (shared/locations.js) ----------
{
  const L = require('../shared/locations.js');
  console.log('\n[locations]');
  check(L.LOCATIONS.length === 8, '8 Orte (M2: + Mond Kesh)');
  check(['hafen', 'splitter', 'b7', 'vaelen', 'wrack', 'nebel', 'relais', 'kesh'].every((id) => !!L.get(id)), 'Orts-IDs laut Vertrag');
  for (const l of L.LOCATIONS) {
    for (const b of l.links) check(L.get(b) && L.get(b).links.includes(l.id), `Verbindung ${l.id}–${b} symmetrisch`);
    if (l.id === 'kesh') check(l.hidden.length === 0, 'kesh: keine versteckten Objekte (CONTRACT-M2 §3.1)');
    else check(l.hidden.length >= 1 && l.hidden.length <= 3, `${l.id}: ${l.hidden.length} versteckte Objekte (1–3)`);
    const sc = l.scene;
    for (const h of l.hidden) check(h.x > 0 && h.y > 0 && h.x < sc.w && h.y < sc.h, `${h.id} liegt in der Szene`);
    check(sc.arrive.x > 0 && sc.arrive.x < sc.w && sc.arrive.y > 0 && sc.arrive.y < sc.h, `${l.id}: Ankunft in der Szene`);
    if (sc.beam) check(!!Maps[sc.beam.map], `${l.id}: Außenkarte ${sc.beam.map} vorhanden`);
  }
  check(L.get('leer-0105') && L.get('leer-0105').kind === 'void' && L.get('leer-0105').hidden.length === 0 && !L.get('leer-0206'), "get('leer-<hex>') liefert die Leerraum-Szene (nur Leerraum)");
  check(L.totalHidden() === 12, `Entdeckungen gesamt: ${L.totalHidden()} (M1 nach QA: x/12)`);
  check(L.get('nebel').fog && L.get('relais').links.join() === 'nebel', 'Nebel mit fog, Relais nur über den Nebel');
  check(!!L.lockedKey('nebel', 'relais'), 'Verbindung nebel–relais zunächst gesperrt (Leitbake)');
  const seen = new Set(['hafen']); const q = ['hafen'];
  while (q.length) { const c = q.shift(); for (const nb of L.get(c).links) if (!seen.has(nb)) { seen.add(nb); q.push(nb); } }
  check(seen.size === 8, 'alle Orte vom Hafen aus erreichbar');
  check(!!L.lockedKey('hafen', 'kesh') && !!L.lockedKey('splitter', 'kesh'), 'Verbindungen zu Kesh zunächst gesperrt (Mission m3 öffnet)');
  check(L.get('kesh').scene.beam.map === 'kesh' && L.get('kesh').scene.station.kind === 'moon', 'kesh: Station moon, Außenkarte kesh');
}

// ---------- B3: Karte Limes (content/welt/limes.json, CONTRACT-B3 §2) – Prüfungen aus karte_limes.py ----------
{
  const S = require('../shared/sektoren.js');
  const L = require('../shared/locations.js');
  const K = S.KARTE;
  console.log('\n[limes]');
  check(!!K && K.format === 'sektorkarte/1' && K.id === 'limes' && K.spalten === 10 && K.zeilen === 8, 'limes.json: Format sektorkarte/1, 10×8');
  const hexe = Object.keys(K.hexe);
  check(hexe.length === 38, `38 Systeme laut karte_limes.py (Note sagt 37) (${hexe.length}), Leerraum ${K.spalten * K.zeilen - hexe.length} Felder`);
  check(hexe.every((h) => S.imRaster(h)), 'alle Systeme im Raster');
  check(hexe.every((h) => K.regionen[K.hexe[h].region]), 'jedes System hat eine bekannte Region');
  check(hexe.every((h) => typeof K.hexe[h].spielbar === 'boolean'), 'jedes System hat spielbar (bool)');
  // spielbar laut Vertrag §2
  // EK7: Saumraum (8) + Kette der 15 Hexe (Statio Limitis bis Eisenwald)
  const SAUM = ['0205', '0206', '0207', '0306', '0307', '0308', '0405', '0406'];
  const KETTE = ['0202', '0203', '0303', '0304', '0305', '0402', '0403', '0502', '0503', '0504', '0505', '0604', '0605', '0704', '0705'];
  check(hexe.filter((h) => K.hexe[h].spielbar).sort().join() === SAUM.concat(KETTE).sort().join(), 'spielbar genau Saumraum (8) + Kette (15, EK7)');
  check(KETTE.every((h) => K.hexe[h].gen === true && K.hexe[h].ort) && SAUM.every((h) => !K.hexe[h].gen), 'Kette: Szene aus Daten (gen + ort), Saumraum: fest codiert');
  check(K.hexe['0107'] && K.hexe['0107'].spielbar === false && K.hexe['0107'].verborgen === true, 'Rostnest 0107: nicht spielbar, verborgen (E33)');
  check(S.spielbar('0105') && S.istLeerraum('0105') && S.spielbar('0305') && !S.spielbar('0302') && !S.spielbar('0602'), 'Leerraum und Statio Limitis spielbar, Vigilia und Krähenwacht nicht');
  // Orte <-> Hexe
  const ORT = { hafen: '0206', splitter: '0306', b7: '0406', vaelen: '0207', wrack: '0405', nebel: '0307', relais: '0308', kesh: '0205' };
  for (const [ort, hex] of Object.entries(ORT)) check(S.hexVonOrt(ort) === hex && S.ortVonHex(hex) === ort && L.get(ort).hex === hex, `Ort ${ort} = Hex ${hex}`);
  check(hexe.filter((h) => K.hexe[h].ort).length === 8 + KETTE.length, 'genau 8 + 15 Hexe mit Ort');
  check(hexe.filter((h) => K.hexe[h].ort && !K.hexe[h].gen).length === 8 && new Set(hexe.map((h) => K.hexe[h].ort).filter(Boolean)).size === 23, 'Orts-IDs eindeutig, 8 fest codiert');
  // Kanten (check() aus karte_limes.py)
  const ids = K.kanten.map((e) => S.kanteId(e.a, e.b));
  check(new Set(ids).size === ids.length, `Kanten eindeutig (${ids.length})`);
  check(K.kanten.every((e) => ['open', 'locked', 'hidden', 'far'].includes(e.art)), 'Kantenarten open|locked|hidden|far');
  check(K.kanten.every((e) => (e.art === 'locked' || e.art === 'far') === !!e.key), 'locked/far mit Schlüssel, sonst ohne');
  for (const e of K.kanten) {
    check(!!K.hexe[e.a] && !!K.hexe[e.b], `Kante ${e.a}-${e.b}: beide Hexe sind Systeme`);
    if (e.art !== 'far') check(S.sindNachbarn(e.a, e.b), `Kante ${e.a}-${e.b} (${e.art}${e.key ? ':' + e.key : ''}) verbindet Nachbarn`);
    else check(!S.sindNachbarn(e.a, e.b), `Fernsprung ${e.a}-${e.b} überspringt Hexe`);
  }
  check(K.kanten.every((e) => !S.istLeerraum(e.a) && !S.istLeerraum(e.b)), 'keine Kante in den Leerraum (Barriere, nur temporär)');
  const reach = (start, erlaubt, ohne) => {
    const seen = new Set([start]); const todo = [start];
    while (todo.length) {
      const x = todo.pop();
      for (const e of K.kanten) {
        if (!erlaubt(e) || (ohne && (ohne.includes(e.a) || ohne.includes(e.b)))) continue;
        for (const [u, v] of [[e.a, e.b], [e.b, e.a]]) if (u === x && !seen.has(v)) { seen.add(v); todo.push(v); }
      }
    }
    return seen;
  };
  const tut = reach('0206', (e) => e.art === 'open' || (e.art === 'locked' && ['kesh', 'nebel-relais'].includes(e.key)));
  check(Object.values(ORT).every((h) => tut.has(h)), 'alle Saumraum-Orte erreichbar mit open + locked:kesh + locked:nebel-relais');
  check(!tut.has('0107') && !tut.has('0305'), 'Rostnest und Statio Limitis im Tutorial unerreichbar');
  const vorMeilenstein = (e) => e.art === 'open' || (e.art === 'locked' && ['tutorial-ende', 'kesh'].includes(e.key));
  check(!reach('0206', vorMeilenstein, ['0803', '0804']).has('0704'), 'Eisenwald vor dem Meilenstein unerreichbar (ohne germanisches Kernland)');
  check(!reach('0206', (e) => vorMeilenstein(e) && e.key !== 'tutorial-ende').has('0305'), 'Saumraum -> Rom nur über tutorial-ende');
  console.log('  info Methalle (0705) vor dem Meilenstein erreichbar (Schleichweg Nebelheim): ' + reach('0206', vorMeilenstein).has('0705'));
  check(K.kanten.some((e) => e.art === 'hidden' && S.kanteId(e.a, e.b) === '0107-0207'), 'Vaelen–Rostnest verborgen');
  check(K.kanten.filter((e) => e.art === 'far').every((e) => S.kanteId(e.a, e.b) === '0308-0508'), 'einziger Fernsprung Relais–Eridu');
  // Saumraum-Kanten wie bisher, außer nebel–wrack -> b7–wrack (E32)
  const ALT = ['hafen-splitter', 'hafen-vaelen', 'hafen-kesh', 'b7-splitter', 'splitter-wrack', 'kesh-splitter', 'b7-nebel', 'nebel-vaelen', 'nebel-wrack', 'nebel-relais'];
  const neu = new Set(); for (const l of L.LOCATIONS) for (const b of l.links) neu.add(L.linkKey(l.id, b));
  check([...neu].filter((k) => !ALT.includes(k)).join() === 'b7-wrack' && ALT.filter((k) => !neu.has(k)).join() === 'nebel-wrack', 'Ort-Links wie bisher, nur nebel–wrack -> b7–wrack (E32)');
  check(L.LOCKED_LINKS.map((l) => l.key).join() === 'nebel-relais,kesh,kesh', 'LOCKED_LINKS aus limes.json (nebel-relais, kesh, kesh)');
  // Präsenz (Prüfer BESITZ-REGION), Geometrie
  check(Object.values(K.praesenz || {}).every((l) => l.every((h) => K.hexe[h])), 'praesenz nennt nur Systeme');
  check(S.richtung('0306', '0305') === 0 && S.richtung('0306', '0406') === 2 && S.richtung('0306', '0206') === 4 && S.richtung('0206', '0306') === 1, 'richtung: 0 = Nord, im Uhrzeigersinn');
  check(hexe.every((h) => S.nachbarn(h).every((n) => S.nachbarn(n).includes(h))), 'Nachbarschaft symmetrisch');
  check(hexe.every((h) => S.nachbarn(h).every((n) => (S.richtung(h, n) + 3) % 6 === S.richtung(n, h))), 'Gegenrichtung = Richtung + 3');
  check(hexe.every((h) => { const p = S.hexZuPixel(h, 40); return S.pixelZuHex(p.x, p.y, 40) === h; }), 'pixelZuHex(hexZuPixel(h)) = h');
  const fc = JSON.stringify(S.fuerClient());
  check(!fc.includes('praesenz') && fc.length < 10000, `welcome.sektorkarte ohne praesenz, ${fc.length} B`);
  // ---------- EK7: Kette, Szenen aus Daten, Sperrriegel, Häfen ----------
  console.log('\n[kette]');
  const GEN = require('../shared/gen-sektor.js');
  {
    const open = (e) => e.art === 'open';
    const ohneKern = ['0801', '0802', '0803', '0804', '0805', '0903', '1003', '0702', '0602', '0601'];
    // Liste nachgerechnet: Hexe auf einem einfachen Weg Statio Limitis -> Eisenwald (ohne germanisches Kernland und Krähenwacht)
    const adj = {};
    for (const e of K.kanten) if (e.art === 'open' || e.art === 'locked') { (adj[e.a] = adj[e.a] || []).push(e.b); (adj[e.b] = adj[e.b] || []).push(e.a); }
    const auf = new Set();
    (function dfs(n, pfad, seen) {
      if (n === '0704') { pfad.forEach((x) => auf.add(x)); return; }
      for (const m of adj[n] || []) { if (seen.has(m) || ohneKern.includes(m)) continue; seen.add(m); pfad.push(m); dfs(m, pfad, seen); pfad.pop(); seen.delete(m); }
    })('0305', ['0305'], new Set(['0305']));
    const extra = [...auf].filter((h) => !KETTE.includes(h)), fehlt = KETTE.filter((h) => !auf.has(h));
    check(!fehlt.length && extra.join() === '0302', 'Kette aus den Sprungkanten nachgerechnet: alle 15 liegen auf Wegen, einzige Abweichung Vigilia (0302) ' + JSON.stringify({ fehlt, extra }));
    // Erreichbarkeit der Kette von Statio Limitis
    const ohneKey = reach('0305', open, ohneKern);
    const mitKey = reach('0305', (e) => open(e) || (e.art === 'locked' && e.key === 'sperrriegel'), ohneKern);
    check(['0304', '0303', '0202', '0203', '0403', '0402', '0502', '0503', '0504', '0505', '0605', '0705'].every((h) => ohneKey.has(h)), 'ohne Sperrriegel erreichbar: Imperium, Grenzmark, Nebelheim, Methalle');
    check(!ohneKey.has('0604') && !ohneKey.has('0704'), 'ohne Sperrriegel: Wolfstor und Eisenwald unerreichbar (auch nicht über Methalle)');
    check(KETTE.every((h) => mitKey.has(h)), 'mit Sperrriegel: alle 15 Hexe von Statio Limitis erreichbar');
    const sk = K.kanten.filter((e) => e.key === 'sperrriegel').map((e) => S.kanteId(e.a, e.b)).sort();
    check(sk.join() === '0504-0604,0604-0605,0604-0705', 'Sperrriegel: genau die Kanten 0504–0604, 0604–0605, 0604–0705');
    check(reach('0206', (e) => e.art === 'open' || e.key === 'tutorial-ende' || e.key === 'kesh').has('0305'), 'tutorial-ende: Splittergürtel -> Statio Limitis (mit Schlüssel)');
    // Szenen aus Daten
    const orte = S.datenOrte();
    check(orte.length === 15 && orte.every((id) => L.get(id) && L.get(id).gen && !L.LOCATIONS.some((l) => l.id === id)), '15 Szenen aus Daten, nicht in LOCATIONS');
    const jpR = 250;
    for (const id of orte) {
      const o = L.get(id); const sc = o.scene; const hx = S.hexVonOrt(id);
      const inS = (p, r) => p.x - (r || 0) > 0 && p.y - (r || 0) > 0 && p.x + (r || 0) < sc.w && p.y + (r || 0) < sc.h;
      check(o.hex === hx && S.ortVonHex(hx) === id && o.name === K.hexe[hx].name, id + ': Ort <-> Hex ' + hx);
      check(inS(sc.arrive) && (!sc.station || inS(sc.station, sc.station.r)) && (!sc.dock || inS(sc.dock)), id + ': Ankunft, Station, Liegeplatz in der Szene');
      check(sc.stern.length >= 1 && sc.planeten.every((p) => inS(p, p.r)) && sc.bojen.every((b) => inS(b)), id + ': Stern ' + sc.stern.length + ', Planeten ' + sc.planeten.length + ', Bojen ' + sc.bojen.length);
      // Sprungpunkte aller sechs Richtungen bleiben frei von Brockenfeld, Station, Liegeplatz, Bojen
      const jps = S.nachbarn(hx).map((n) => S.sprungpunktLage(sc.w, sc.h, S.richtung(hx, n), 180));
      const f = sc.field;
      const feldAbstand = (p) => { const dx = Math.max(f.x0 - p.x, 0, p.x - f.x1), dy = Math.max(f.y0 - p.y, 0, p.y - f.y1); return Math.hypot(dx, dy); };
      check(!sc.asteroids || jps.every((p) => feldAbstand(p) > jpR + 44), id + ': Brockenfeld hält Abstand zu allen Sprungpunkten');
      check(jps.every((p) => [sc.station, sc.dock, ...sc.bojen].filter(Boolean).every((q) => Math.hypot(p.x - q.x, p.y - q.y) > jpR + (q.r || 0))), id + ': Station, Liegeplatz, Bojen frei von Sprungpunkten');
      check(JSON.stringify(GEN.erzeuge(hx, K.hexe[hx]).scene) === JSON.stringify(sc), id + ': deterministisch (Seed nur aus der Hex-Kennung)');
    }
    check(!L.get('rabenpass').scene.station && !L.get('rabenpass').scene.planeten.length && !L.get('rabenpass').scene.asteroids && !K.hexe['0502'].einfluss, 'Rabenpass: leerer Raumsektor (nur Doppelstern, kein Einfluss Gezeiten)');
    check(L.get('rabenpass').scene.stern.length === 2 && L.get('nebelheim').fog === true && L.get('ferraria').scene.asteroids > 0 && L.get('tiberis').scene.planeten[0].art === 'gasriese', 'Doppelstern, Nebel, Asteroiden, Gasriese nach Hex-Daten');
    // Häfen: Castra Martis und Statio Limitis mit Liegeplatz, ohne Ruf, Hafensortiment
    const dockHexe = hexe.filter((h) => K.hexe[h].andocken).sort();
    check(dockHexe.join() === '0202,0305', 'Häfen zum Andocken: Castra Martis und Statio Limitis');
    check(dockHexe.every((h) => { const o = L.get(K.hexe[h].ort); return o.kind === 'port' && o.scene.dock && o.shop === 'hafen' && o.scene.hafen.ruf === false && !o.besitz; }), 'beide Häfen: Liegeplatz, Hafensortiment (shop hafen), ohne Ruf');
    check(orte.filter((id) => L.get(id).scene.dock).length === 2, 'sonst kein Ort mit Liegeplatz');
  }

  // SVG-Ausgabe
  const i = process.argv.indexOf('--svg');
  if (i > 0 && process.argv[i + 1]) { require('fs').writeFileSync(process.argv[i + 1], svg(S, K), 'utf8'); console.log('  SVG: ' + process.argv[i + 1]); }
}

// SVG wie karte_limes.py (Farben aus limes.json `fraktionen`)
function svg(S, K) {
  const s = 62, h3 = Math.sqrt(3) * s, mx = 40, my = 70;
  const W = Math.round(mx * 2 + s * 2 + 1.5 * s * (K.spalten - 1)), H = Math.round(my + h3 * K.zeilen + h3 / 2 + 60);
  const c = (hex) => { const p = S.hexZuPixel(hex, s); return { x: p.x + mx, y: p.y + my }; };
  const pts = (x, y) => Array.from({ length: 6 }, (_, i) => `${(x + s * Math.cos(i * Math.PI / 3)).toFixed(1)},${(y + s * Math.sin(i * Math.PI / 3)).toFixed(1)}`).join(' ');
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const o = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Segoe UI, Helvetica, Arial, sans-serif">`,
    `<rect width="${W}" height="${H}" fill="#0b1020"/>`, `<text x="${W / 2}" y="34" fill="#e8e8f0" font-size="22" text-anchor="middle" font-weight="600">${esc(K.name || 'Karte')}</text>`];
  for (let col = 1; col <= K.spalten; col++) for (let row = 1; row <= K.zeilen; row++) {
    const hex = String(col).padStart(2, '0') + String(row).padStart(2, '0'); const { x, y } = c(hex); const h = K.hexe[hex];
    if (h) o.push(`<polygon points="${pts(x, y)}" fill="${(K.fraktionen[h.fraktion] || {}).farbe || '#444'}" fill-opacity="${h.spielbar ? 0.95 : 0.6}" stroke="#c9cfdc" stroke-opacity="0.55" stroke-width="1.5"/>`);
    else o.push(`<polygon points="${pts(x, y)}" fill="#0b1020" stroke="#2c3550" stroke-width="1"/>`);
    o.push(`<text x="${x}" y="${(y - s * 0.62).toFixed(1)}" fill="#aab3c8" font-size="10" text-anchor="middle">${hex}</text>`);
    if (h) o.push(`<text x="${x}" y="${(y + s * 0.66).toFixed(1)}" fill="#fff" font-size="10.5" text-anchor="middle" font-weight="600">${esc(h.verborgen ? '?' : h.name)}</text>`);
    if (h && h.hafen) o.push(`<text x="${x}" y="${(y - s * 0.3).toFixed(1)}" fill="#fff" font-size="14" font-weight="700" text-anchor="middle">${h.hafen}</text>`);
  }
  for (const e of K.kanten) {
    const a = c(e.a), b = c(e.b);
    if (e.art === 'far') { o.push(`<path d="M${a.x},${a.y} Q${(a.x + b.x) / 2},${(a.y + b.y) / 2 - 90} ${b.x},${b.y}" fill="none" stroke="#5fe0d0" stroke-width="2.2" stroke-dasharray="2,5"/>`); continue; }
    const st = e.art === 'open' ? 'stroke="#ffd34d" stroke-width="5"' : e.art === 'hidden' ? 'stroke="#c9cfdc" stroke-width="3" stroke-dasharray="3,4"' : 'stroke="#ff5a4d" stroke-width="5" stroke-dasharray="6,4"';
    o.push(`<line x1="${(a.x + (b.x - a.x) * 0.3).toFixed(1)}" y1="${(a.y + (b.y - a.y) * 0.3).toFixed(1)}" x2="${(a.x + (b.x - a.x) * 0.7).toFixed(1)}" y2="${(a.y + (b.y - a.y) * 0.7).toFixed(1)}" ${st} stroke-linecap="round"/>`);
  }
  o.push('</svg>');
  return o.join('\n');
}

console.log(`
${checks - failures}/${checks} Prüfungen bestanden.`);
if (failures) { console.log(`${failures} FEHLER.`); process.exit(1); }
console.log('Sektoren OK.');
