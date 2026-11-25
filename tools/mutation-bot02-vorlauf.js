'use strict';
// BOT-02 B3: Mutationsproben zu tools/test-bot02-vorlauf.js. Jede Mutation (Umgebungsvariable BOT_VOR_MUT, die der Test selbst einhaengt) muss den Test rot machen:
//   vorlauf_aus               der Vorlauf beginnt nie (Bot geht erst mit dem Beam zum Transfer, Ops scannt nicht, Navigation stoppt nicht)
//   frist_raus                die Frist (60 s) beendet den Vorlauf nicht (der Bot bliebe ewig am Transfer)
//   ziel_mehrfach             dasselbe Ziel beginnt nach dem Ende einen neuen Vorlauf (nach Frist, Aufstieg)
//   scan_auto_aus             der Ops-Bot scannt nicht automatisch
//   scan_doppelt              ein bereits gescannter Landepunkt wird erneut gescannt (kein „nur ein Scan“)
//   scan_vor_transfer_raus    der Bord-Bot als Ops-Bot scannt nicht vor dem Gang zum Transfer
//   stopp_aus                 der Navigations-Bot stoppt das Schiff nicht
//   stopp_immer               der Navigations-Bot stoppt auch ohne Landepunkt und ohne Beam
//   mensch_gewinnt_raus       der Bord-Bot geht zum Transfer, obwohl ein Mensch ihn haelt
//   vorlauf_nav_offen         Navigationsbefehle im Vorlauf sind nicht gesperrt (nicht_jetzt)
// Nacharbeit (Review V-1 bis V-6):
//   nav_bord               (tools/test-bot02-notsprung.js, BOT_NS_MUT) der Navigations-Bot haelt wieder den Bord-Dienst (Nacharbeit 2): Notsprung vom Transfer aus zu spaet, die Lerche stirbt
//   bereich_ignorieren        V-2: Vorlauf, Stopp und Sperre auch ausserhalb der Beamreichweite
//   frist_ausserhalb          V-2: die Frist zaehlt auch ausserhalb der Reichweite
//   pad_signal_aus            V-3: ein Mensch auf dem Pad bei zu schnellem Schiff loest keinen Stopp aus
//   pad_ohne_mensch           V-3: Stopp bei zu schnellem Schiff auch ohne Mensch auf dem Pad
//   pad_ohne_absicht          S1: schon das blosse Stehen auf dem Pad gilt als Beamabsicht (Stopp ohne E und ohne Versuch)
//   pad_verwirft              S1: das Pad-Signal verwirft den laufenden Befehl des Menschen
//   gegner_ignorieren         V-4: Gegner im Raum beenden den Vorlauf nicht
//   countdown_ignorieren      V-4: Reaktor-Countdown beendet den Vorlauf nicht
//   abbruch_beendet           V-5: ein abgebrochener (haltender) Beam beendet den Vorlauf
//   downed_zaehlt             V-6: ein bewusstloser Mensch haelt den Vorlauf am Leben
// Ohne Mutation laeuft der Test gruen (Gegenprobe). Der Vergleich mit dem Basisstand (git archive) entfaellt dabei (VORLAUF_OHNE_BASIS). Dauer: je Lauf rund 30 bis 90 s.   node tools/mutation-bot02-vorlauf.js [name ...]
const { spawnSync } = require('child_process');
const path = require('path');
const test = path.join(__dirname, 'test-bot02-vorlauf.js');
const testNs = path.join(__dirname, 'test-bot02-notsprung.js');
const alle = ['vorlauf_aus', 'frist_raus', 'ziel_mehrfach', 'scan_auto_aus', 'scan_doppelt', 'scan_vor_transfer_raus', 'stopp_aus', 'stopp_immer', 'mensch_gewinnt_raus', 'vorlauf_nav_offen', 'bereich_ignorieren', 'frist_ausserhalb', 'pad_signal_aus', 'pad_ohne_mensch', 'pad_ohne_absicht', 'pad_verwirft', 'gegner_ignorieren', 'countdown_ignorieren', 'abbruch_beendet', 'downed_zaehlt', 'nav_bord'];
const NS = ['nav_bord'];   // laeuft gegen den Notsprung-Test (BOT_NS_MUT)
const gewaehlt = process.argv.slice(2).length ? process.argv.slice(2) : alle;
let fails = 0;
// Laeufe: Gegenprobe des Vorlauf-Tests, die Mutationen, Gegenprobe des Notsprung-Tests (nur wenn eine seiner Mutationen laeuft)
const laeufe = [{ m: '', ns: false }, ...gewaehlt.map((m) => ({ m, ns: NS.includes(m) }))];
if (gewaehlt.some((m) => NS.includes(m))) laeufe.splice(1, 0, { m: '', ns: true });
for (const { m, ns } of laeufe) {
  const env = Object.assign({}, process.env, { BOT_VOR_MUT: ns ? '' : m, BOT_NS_MUT: ns ? m : '', VORLAUF_OHNE_BASIS: '1' });
  const r = spawnSync(process.execPath, [ns ? testNs : test], { env, encoding: 'utf8', maxBuffer: 1 << 26 });
  const zeilen = (r.stdout || '').split('\n').filter((l) => l.includes('FEHLER'));
  // erkannt zaehlt nur ein Test, der mit Exit 1 UND einer FEHLER-Zeile anschlaegt; ein Absturz (Exit != 0 ohne FEHLER-Zeile) ist nicht erkannt
  const rot = r.status === 1 && zeilen.length > 0;
  const gut = m ? rot : r.status === 0;
  // N1: ist die Gegenprobe (ohne Mutation) nicht gruen, sagt keine Mutation etwas aus: hart abbrechen
  if (!m && r.status !== 0) { console.log('FEHLER ohne Mutation: Test ist NICHT gruen (Exit ' + r.status + '), Abbruch: ' + (zeilen[0] || (r.stderr || '').split('\n')[0] || '').trim().slice(0, 160)); process.exit(2); }
  if (!gut) fails++;
  console.log(`${gut ? 'ok  ' : 'FEHLER'} ${m ? 'Mutation ' + m + ': Test ist ' + (rot ? 'rot (' + zeilen.length + ' Fehler, z. B. ' + (zeilen[0] || '').trim().slice(0, 100) + ')' : 'GRUEN (nicht erkannt)') : 'ohne Mutation (' + (ns ? 'Notsprung-Test' : 'Vorlauf-Test') + '): Test ist ' + (rot ? 'ROT' : 'gruen')}`);
}
console.log(fails ? `\nmutation-bot02-vorlauf: ${fails} Fehler` : '\nmutation-bot02-vorlauf: alle ok');
if (fails) process.exit(1);
