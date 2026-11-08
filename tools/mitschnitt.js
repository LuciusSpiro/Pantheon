'use strict';
// Review-Werkzeug für Mission-Mitschnitte (MIT-01 Paket D, CONTRACT-MIT01.md) – npm run mitschnitt -- <befehl>
// Ablage: <wurzel>/<JJJJ-MM-TT>_<lauf>/<nr>_<kennung>/mission.md, <lauf>/index.md, verlauf.json

const fs = require('fs');
const path = require('path');
const MD = require('../server/mission/md-ablage.js');

const BEWERTUNGEN = ['offen', 'gut', 'schwach', 'verwerfen'];
const STANDARD_WURZEL = path.join(__dirname, '..', 'data', 'mitschnitt');

const HILFE = `Review-Werkzeug für Mission-Mitschnitte – npm run mitschnitt -- <befehl>
  liste                              je Lauf und Mission eine Zeile (neueste Läufe zuerst; Standard ohne Befehl)
  zeigen <lauf|mission>              Lauf-Ordner: index.md; Mission-Ordner (<lauf>/<nr>_<kennung>): mission.md
  bewerten <mission> <wert>          setzt 'bewertung' in der mission.md: ${BEWERTUNGEN.join(' | ')} (nie 'status')
Optionen:
  --dir <ordner>        Wurzel (sonst MITSCHNITT_DIR, sonst data/mitschnitt)
  --bewertung <wert>    nur bei liste: ${BEWERTUNGEN.join(' | ')}
  --lauf <teilstring>   nur bei liste: Läufe, deren Ordnername den Text enthält
  --help                diese Hilfe
Namen dürfen abgekürzt werden, solange sie eindeutig sind (z. B. nur die Kennung ohne Datum);
bei Mehrdeutigkeit zeigt das Werkzeug die Kandidaten. Bewertung und Notizen bleiben beim
Neuschreiben des Laufs erhalten.`;

function out(s) { process.stdout.write(s.endsWith('\n') ? s : s + '\n'); }
function stirb(msg) { process.stderr.write(msg.endsWith('\n') ? msg : msg + '\n'); process.exit(1); }
const pad = (s, n) => { const t = String(s == null ? '–' : s); return t.length >= n ? t.slice(0, n - 1) + '…' : t + ' '.repeat(n - t.length); };

function liesOptionen(argv) {
  const args = argv.slice();
  const opt = (n) => { const i = args.indexOf(n); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v === undefined ? '' : v; };
  const hilfe = args.includes('--help') || args.includes('-h');
  return {
    hilfe,
    dir: opt('--dir'), bewertung: opt('--bewertung'), lauf: opt('--lauf'),
    befehl: args[0] || 'liste', arg: args[1], wert: args[2],
  };
}

const unterordner = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (e) { return []; } };
const nrVon = (n) => parseInt(n, 10) || 0;

// Läufe (neueste zuerst) mit ihren Missionen (nach Nr aufsteigend)
function leseWurzel(wurzel) {
  return unterordner(wurzel).sort().reverse().map((lauf) => {
    const ld = path.join(wurzel, lauf);
    const missionen = unterordner(ld).filter((n) => /^\d+_/.test(n) && fs.existsSync(path.join(ld, n, 'mission.md')))
      .sort((a, b) => nrVon(a) - nrVon(b) || a.localeCompare(b))
      .map((ordner) => ({ lauf, ordner, pfad: `${lauf}/${ordner}`, datei: path.join(ld, ordner, 'mission.md') }));
    return { lauf, dir: ld, hatIndex: fs.existsSync(path.join(ld, 'index.md')), missionen };
  }).filter((l) => l.hatIndex || l.missionen.length);
}

function missionsZeile(m) {
  const { felder } = MD.readMdFelder(m.datei, ['titel', 'ausgang', 'bewertung']);
  let art = null, eintraege = null;
  try {
    const vj = MD.readJson(path.join(path.dirname(m.datei), 'verlauf.json'));
    art = vj.gruppe && vj.gruppe.art; eintraege = Array.isArray(vj.eintraege) ? vj.eintraege.length : null;
  } catch (e) { /* verlauf.json fehlt oder kaputt: Spalten bleiben leer */ }
  return { lauf: m.lauf, nr: nrVon(m.ordner), titel: felder.titel, art, ausgang: felder.ausgang, bewertung: felder.bewertung || 'offen', eintraege };
}

// genau ein Treffer -> Treffer; mehrere -> Fehler mit Kandidaten; keiner -> null
function eindeutig(treffer, name, bezeichner) {
  if (treffer.length === 1) return treffer[0];
  if (treffer.length > 1) stirb(`'${name}' ist nicht eindeutig (${bezeichner}): ${treffer.join(', ')}`);
  return null;
}

function loeseMissionAuf(laeufe, name) {
  const alle = laeufe.flatMap((l) => l.missionen);
  const exakt = alle.find((m) => m.pfad === name);
  if (exakt) return exakt;
  // `<lauf-teil>/<ordner-teil>`: beide Teile einzeln als Teilstring (Nummer vorn darf fehlen)
  const i = name.indexOf('/');
  const passt = (m) => (i < 0 ? m.pfad.includes(name) : m.lauf.includes(name.slice(0, i)) && m.ordner.includes(name.slice(i + 1)));
  const t = eindeutig(alle.filter(passt).map((m) => m.pfad), name, 'Missionen');
  return t ? alle.find((m) => m.pfad === t) : null;
}
// Lauf zuerst (exakt, dann Teilstring ohne '/'), dann Mission
function loeseAuf(laeufe, name) {
  const exaktLauf = laeufe.find((l) => l.lauf === name);
  if (exaktLauf) return { art: 'lauf', lauf: exaktLauf };
  if (!name.includes('/')) {
    const l = eindeutig(laeufe.filter((x) => x.lauf.includes(name)).map((x) => x.lauf), name, 'Läufe');
    if (l) return { art: 'lauf', lauf: laeufe.find((x) => x.lauf === l) };
  }
  const m = loeseMissionAuf(laeufe, name);
  return m ? { art: 'mission', mission: m } : null;
}

function befehlListe(laeufe, wurzel, o) {
  if (o.bewertung && !BEWERTUNGEN.includes(o.bewertung)) stirb(`Ungültige Bewertung '${o.bewertung}'. Erlaubt: ${BEWERTUNGEN.join(', ')}`);
  const rel = path.relative(process.cwd(), wurzel) || wurzel;
  if (!fs.existsSync(wurzel)) { out(`Keine Mitschnitte: ${rel} existiert nicht (Läufe mit MITSCHNITT=1 aufnehmen oder --dir angeben).`); return; }
  const zeilen = [];
  for (const l of laeufe) {
    if (o.lauf && !l.lauf.includes(o.lauf)) continue;
    for (const m of l.missionen) zeilen.push(missionsZeile(m));
  }
  const sicht = o.bewertung ? zeilen.filter((z) => z.bewertung === o.bewertung) : zeilen;
  if (!sicht.length) { out(`Keine Mitschnitte in ${rel}${o.bewertung || o.lauf ? ' (mit diesem Filter)' : ''}.`); return; }
  out(`Mitschnitte in ${rel}: ${sicht.length}`);
  out(`${pad('Lauf', 34)} ${pad('Nr', 3)} ${pad('Titel', 32)} ${pad('Art', 10)} ${pad('Ausgang', 12)} ${pad('Bewertung', 10)} Einträge`);
  for (const z of sicht) out(`${pad(z.lauf, 34)} ${pad(z.nr, 3)} ${pad(z.titel, 32)} ${pad(z.art, 10)} ${pad(z.ausgang, 12)} ${pad(z.bewertung, 10)} ${z.eintraege == null ? '–' : z.eintraege}`);
  const n = (b) => sicht.filter((z) => z.bewertung === b).length;
  out(BEWERTUNGEN.map((b) => `${b} ${n(b)}`).join(' · '));
}

function befehlZeigen(laeufe, o) {
  if (!o.arg) stirb('Ordner fehlt: npm run mitschnitt -- zeigen <lauf|mission>');
  const r = loeseAuf(laeufe, o.arg);
  if (!r) stirb(`Kein Lauf und keine Mission '${o.arg}' gefunden (npm run mitschnitt -- liste).`);
  const datei = r.art === 'lauf' ? path.join(r.lauf.dir, 'index.md') : r.mission.datei;
  if (!fs.existsSync(datei)) stirb(`Dokument fehlt: ${datei}`);
  out(fs.readFileSync(datei, 'utf8'));
}

function befehlBewerten(laeufe, o) {
  if (!o.arg) stirb(`Mission fehlt: npm run mitschnitt -- bewerten <mission> ${BEWERTUNGEN.join('|')}`);
  if (!BEWERTUNGEN.includes(o.wert)) stirb(`Ungültige Bewertung '${o.wert || ''}'. Erlaubt: ${BEWERTUNGEN.join(', ')}`);
  const m = loeseMissionAuf(laeufe, o.arg);
  if (!m) stirb(`Keine Mission '${o.arg}' gefunden (npm run mitschnitt -- liste).`);
  const r = MD.setFrontmatter(m.datei, 'bewertung', o.wert);
  if (!r.ok) stirb('Fehler: ' + r.error);
  out(`${m.pfad}: bewertung ${o.wert}`);
}

function main(argv) {
  const o = liesOptionen(argv);
  if (o.hilfe) { out(HILFE); return; }
  const wurzel = path.resolve(o.dir || process.env.MITSCHNITT_DIR || STANDARD_WURZEL);
  const laeufe = leseWurzel(wurzel);
  const keine = () => stirb(`Keine Mitschnitte in ${path.relative(process.cwd(), wurzel) || wurzel}.`);
  switch (o.befehl) {
    case 'liste': return befehlListe(laeufe, wurzel, o);
    case 'zeigen': if (!laeufe.length) keine(); return befehlZeigen(laeufe, o);
    case 'bewerten': if (!laeufe.length) keine(); return befehlBewerten(laeufe, o);
    default: stirb(`Unbekannter Befehl '${o.befehl}'.\n${HILFE}`);
  }
}

main(process.argv.slice(2));
