'use strict';
// BOT-05 B3: Auswertung des Messwerkzeugs mess-bot-gespraech (tools/lib/bot-gespraech-auswertung.js) an festen Beispielsaetzen, plus ein kurzer Trockenlauf des Werkzeugs mit Fake-Ollama.
//   node tools/test-mess-bot-gespraech.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
process.chdir(path.join(__dirname, '..'));
const A = require('./lib/bot-gespraech-auswertung.js');

let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const werte = (t) => A.zahlen(t).map((z) => z.wert + (z.einheit ? ':' + z.einheit : ''));

section('1 Zahlextraktion');
ok(JSON.stringify(werte('Kurs 270 Grad, Captain.')) === '["270:grad"]', 'Ziffern mit Einheit Grad');
ok(JSON.stringify(werte('Kurs 270°')) === '["270:grad"]', 'Gradzeichen');
ok(JSON.stringify(werte('Bug 50 Prozent, Heck dreizehn')) === '["50:prozent","13"]', 'Ziffern mit Prozent und Zahlwort ohne Einheit');
ok(JSON.stringify(werte('Schild bei 75 %')) === '["75:prozent"]', 'Prozentzeichen');
ok(JSON.stringify(A.zahlen('einundzwanzig siebenundneunzig hundert null dreißig zwölf fünfzig').map((z) => z.wert)) === '[21,97,100,0,30,12,50]', 'Zahlwoerter bis hundert (einundzwanzig, siebenundneunzig, hundert, null, dreißig, zwölf, fünfzig)');
ok(JSON.stringify(A.zahlen('zweihundertsiebzig und einhundertachtzig').map((z) => z.wert)) === '[270,180]', 'Zahlwoerter ueber hundert (Kurs): zweihundertsiebzig, einhundertachtzig');
ok(A.zahlen('Wir haben ein Schild und eine Waffe').length === 0, '"ein" und "eine" allein sind keine Zahl');
ok(JSON.stringify(werte('rund 120 Meter und 3,5 Prozent')) === '["120:meter","3.5:prozent"]', 'Meter und Dezimalkomma');
ok(A.zahlen('Achtung, Captain').length === 0, '"Achtung" ist kein Zahlwort');

section('2 Urteil Kurs');
const k = (t, s) => A.kursUrteil(t, s).urteil;
ok(k('Kurs 270 Grad, Captain.', 270) === 'richtig', '270 Grad bei Soll 270: richtig');
ok(k('Wir liegen auf zweihundertsiebzig Grad.', 270) === 'richtig', 'Zahlwort: richtig');
ok(k('Kurs 271 Grad.', 270) === 'falsch', 'Abweichung 1 Grad: falsch (Toleranz 0)');
ok(k('Kurs 90 Grad, Captain.', 270) === 'falsch', 'falscher Wert: falsch');
ok(k('Wir halten ungefähr Süden.', 180) === 'ausweichend', '"ungefähr Süden" ohne Zahl: ausweichend');
ok(k('Kurs 360 Grad.', 0) === 'richtig', '360 gleich 0');
ok(k('Kurs 180 Grad, das Ziel ist rund 120 Meter weg, Schilde 100 Prozent.', 180) === 'richtig', 'Meter und Prozent zaehlen nicht als Kurs');
ok(k('Kurs 180 Grad und 90 Grad.', 180) === 'falsch', 'ein genannter Wert falsch genuegt');
const kf = A.kursUrteil('Kurs 90 Grad.', 270);
ok(kf.abweichungen.length === 1 && kf.abweichungen[0].genannt === 90 && kf.abweichungen[0].soll === 270, 'Abweichung nennt genannten Wert und Soll');

section('3 Urteil Schilde');
const S = { bug: 50, steuerbord: 100, heck: 13, backbord: 0 };
const s = (t) => A.schildeUrteil(t, S).urteil;
ok(s('Bug 50 Prozent, Heck dreizehn') === 'richtig', '"Bug 50 Prozent, Heck dreizehn": richtig (Teilwerte reichen, alle genannten stimmen)');
ok(s('Bug 50 Prozent, Steuerbord 100 Prozent, Heck 13 Prozent, Backbord 0 Prozent.') === 'richtig', 'alle vier richtig');
ok(s('Bug 50 Prozent, Heck 14 Prozent.') === 'falsch', 'ein Sektor falsch: falsch');
ok(s('Steuerbord 100 Prozent und Backbord 0 Prozent.') === 'richtig', 'zwei Sektoren in einem Teil der Reihe nach');
ok(s('Bug und Backbord je 50 Prozent') === 'falsch', 'eine Zahl fuer zwei Sektoren, Backbord stimmt nicht: falsch');
ok(s('13 Prozent am Heck, Captain.') === 'richtig', 'Zahl vor dem Sektor');
ok(s('Die Schilde sind in gutem Zustand, nur am Heck schwach.') === 'ausweichend', 'kein Wert: ausweichend');
ok(s('Fast voll, Backbord leer.') === 'ausweichend', 'voll/leer ohne Zahl: ausweichend');
ok(s('Alle Schilde bei 100 Prozent.') === 'falsch', 'pauschaler Wert, der nicht fuer alle Sektoren stimmt: falsch');
ok(A.schildeUrteil('Alle Schilde bei 50 Prozent.', { bug: 50, steuerbord: 50, heck: 50, backbord: 50 }).urteil === 'richtig', 'pauschaler Wert, der fuer alle stimmt: richtig');
ok(s('Kurs 270 Grad, Bug 50 Prozent.') === 'richtig', 'Gradzahl in der Schilde-Antwort wird ignoriert');
const sf = A.schildeUrteil('Bug 50 Prozent, Heck 14 Prozent.', S);
ok(sf.abweichungen.length === 1 && sf.abweichungen[0].sektor === 'heck' && sf.abweichungen[0].genannt === 14 && sf.abweichungen[0].soll === 13, 'Abweichung nennt Sektor, genannten Wert und Soll');
ok(A.schildeUrteil('Bug 3,5 Prozent', { bug: 3.5, steuerbord: 0, heck: 0, backbord: 0 }).urteil === 'richtig', 'Dezimalkomma wird nicht als Satzgrenze zerschnitten');

section('4 Zusagen und Statistik');
ok(A.zusagen('Aye, mach ich sofort, Captain.').length >= 2, 'Aye und "mach ich": Zusage');
ok(A.zusagen('Verstanden, ich lege die Schilde aufs Heck.').length >= 2, '"Verstanden" und "ich lege": Zusage');
ok(A.zusagen('Wird erledigt.').length === 1 && A.zusagen('Bin schon dabei.').length >= 1 && A.zusagen('Ich überlege noch.').length === 0, '"wird erledigt", "bin schon dabei"');
ok(A.zusagen('Gib das bitte als Befehl, Captain, dann kümmert sich die Technik.').length === 0, 'Bitte um einen Befehl ohne Zusage: keine Fundstelle');
ok(A.median([3, 1, 2]) === 2 && A.median([1, 2, 3, 4]) === 2.5 && A.median([]) === null, 'Median');
ok(A.perzentil([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90) === 9 && A.perzentil([5], 90) === 5, 'p90');

section('5 Trockenlauf des Werkzeugs (Fake-Ollama und Fake-Voicebox, echte Partie, WebSocket)');
{
  const aus = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-messgespraech-'));
  let code = 0, text = '';
  try { text = childProcess.execFileSync(process.execPath, ['tools/mess-bot-gespraech.js', '--trocken', '--n', '4', '--nb', '3', '--aus', aus], { encoding: 'utf8', timeout: 90000 }); } catch (e) { code = e.status || 1; text = String(e.stdout || '') + String(e.stderr || ''); }
  ok(code === 0, 'Werkzeug endet mit Code 0 (alle Fake-Antworten richtig, kein Befehl ausgeloest)' + (code ? ': ' + text.slice(-400) : ''));
  ok(/\(a\) richtig 4, falsch 0, ausweichend 0/.test(text), 'Konsole: (a) richtig 4 von 4');
  ok(/\(b\) Befehlsaufrufe 0, Zustand ungleich 0, Zusagen 0 von 3/.test(text), 'Konsole: (b) keine Befehlsaufrufe, Zustand gleich');
  ok(/\(c\) Latenz/.test(text), 'Konsole: Latenz');
  const zeilen = fs.existsSync(path.join(aus, 'protokoll.jsonl')) ? fs.readFileSync(path.join(aus, 'protokoll.jsonl'), 'utf8').trim().split('\n').map((z) => JSON.parse(z)) : [];
  ok(zeilen.length === 7 && zeilen.filter((z) => z.teil === 'a').length === 4 && zeilen[0].kalt === true && zeilen.filter((z) => z.kalt).length === 1, 'JSONL: 7 Gespraeche, genau eines kalt');
  ok(zeilen.every((z) => typeof z.antwort === 'string' && z.antwort.length > 0 && z.zeiten && z.zeiten.satz1 != null && z.zeiten.ton1 != null && z.zeiten.ende != null), 'JSONL: Antwort woertlich und Zeiten (satz, ton, ende)');
  ok(zeilen.filter((z) => z.teil === 'a').every((z) => z.soll != null && z.urteil === 'richtig'), 'JSONL: Soll festgehalten, Urteil richtig');
  ok(fs.existsSync(path.join(aus, 'protokoll.md')) && /## \(c\) Latenz/.test(fs.readFileSync(path.join(aus, 'protokoll.md'), 'utf8')), 'Markdown-Protokoll mit Latenzteil');
  fs.rmSync(aus, { recursive: true, force: true });
}

console.log(`\n${n - fails}/${n} Pruefungen ok`);
process.exit(fails ? 1 : 0);
