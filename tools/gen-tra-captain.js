'use strict';
// TRA-01 E: erzeugt die beiden Regiebücher des Captain-Trainings aus EINER Beschreibung (kein doppelt gepflegter Text, kein Drift zwischen den Varianten):
//   content/regiebuecher/tra_captain.regiebuch.json          Tafel-Variante  (Befehle über Befehlstafel B und Direkttasten: Quelle menu | taste)
//   content/regiebuecher/tra_captain_sprache.regiebuch.json  Sprachvariante  (Befehle über Textzeile # und Sprache ^: Quelle text | sprache)
// Unterschiede der Varianten: die Quellen der Befehlsziele (bot_befehl:<befehl>:<quelle>, Oder-Verknüpfung) und die Hinweistexte. nav.sprung ist per Vertrag nicht sprechbar (nur Menü/Taste) und
// zählt in beiden Varianten über menu | taste. Ablauf: stand -> kurs -> ziele -> kampf -> reparatur -> sprung. Ziel-Ids und Bedeutung: server/sim/training-erkennung.js.
//   node tools/gen-tra-captain.js           schreibt die Bücher
//   node tools/gen-tra-captain.js --check   prüft, dass die Dateien auf der Platte der Erzeugung entsprechen (tools/test-training-captain.js)
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'content', 'regiebuecher');
const VARIANTEN = {
  tafel: { id: 'tra_captain', datei: 'tra_captain.regiebuch.json', quellen: ['menu', 'taste'], titel: 'Training Captain' },
  sprache: { id: 'tra_captain_sprache', datei: 'tra_captain_sprache.regiebuch.json', quellen: ['text', 'sprache'], titel: 'Training Captain mit Sprache' },
};

const z = (id) => ({ check: { name: 'training_ziel', id } });
const alle = (...l) => ({ all: l });
const eines = (...l) => ({ any: l });
const nicht = (c) => ({ not: c });
const MENU_TASTE = ['menu', 'taste'];
// Befehl über die Quellen der Variante (nav.sprung immer Menü/Taste), optional mit einer Zusatzkennung je Quelle (ziel_angewaehlt:a, repariert)
const quellenVon = (v, befehl) => (befehl === 'nav.sprung' ? MENU_TASTE : v.quellen);
const bef = (v, befehl) => eines(...quellenVon(v, befehl).map((q) => z(`bot_befehl:${befehl}:${q}`)));
const mitQuelle = (v, praefix) => eines(...v.quellen.map((q) => z(`${praefix}:${q}`)));

// ---------- Texte je Variante: T(Tafel, Sprache). ODA-Zeilen (start*, h.*, nochmal, ende) höchstens 120 Zeichen (Checker ODA_MAX); längere Hinweise stehen in zwei Zeilen (h.x, h.x2) ----------
const T = (tafel, sprache) => ({ tafel, sprache });
const DAS = (a) => T(a, a);   // gleicher Text in beiden Varianten
const TEXTE = {
  'buch.briefing': T('Captain-Training: Du führst Livia (Navigation), Cassius (Ops) und Titus (Technik) mit Befehlstafel und Direkttasten.',
    'Captain-Training: Du führst Livia (Navigation), Cassius (Ops) und Titus (Technik) per Textzeile oder Sprache.'),
  'buch.belohnung': DAS('Abzeichen Captain'),
  'stand.start': DAS('Captain-Training: Du führst Livia (Navigation), Cassius (Ops) und Titus (Technik).'),
  'stand.start2': T('Befehle über die Befehlstafel (B) und Direkttasten. Erst die Grundlagen im Stand.',
    'Befehle per Textzeile (#) oder Sprechtaste (^), Option „Sprache“ an. Erst die Grundlagen im Stand.'),
  'kurs.start': T('Navigation: Livia fliegt, wohin du sie schickst (Befehlstafel B, Navigation).',
    'Navigation: Livia fliegt, wohin du sie schickst, zum Beispiel „Livia, Kurs auf die Markierung“.'),
  'ziele.start': DAS('Zwei Störrelais stehen still bei der Station und schießen nie. Cassius feuert erst auf dein Kommando.'),
  'kampf.start': DAS('Kampf: Livia bringt das Schiff in Reichweite, Cassius schießt auf dein Kommando.'),
  'reparatur.start': DAS('Mehrere Systeme sind beschädigt. Titus repariert von selbst, du bestimmst die Reihenfolge.'),
  'reparatur.nochmal': DAS('Titus war schneller. Noch einmal: mehrere Systeme beschädigt, wähle eines für Titus.'),
  'sprung.start': DAS('Zum Schluss Sprünge: ein Schnellsprung über mehrere Sektoren, ein normaler in einen Nachbarsektor.'),
  'sprung.start2': DAS('Der Sprungbefehl geht nur über Befehlstafel oder Taste, nicht per Sprache.'),
  'ende': DAS('Alle Aufgaben erledigt.'),
  // Checkliste (HUD)
  'ziel.sprungziel': DAS('Sprungziel wählen (Reiter 2, Sternkarte)'),
  'ziel.marker': DAS('Marker setzen (Reiter 3, Lagekarte anklicken)'),
  'ziel.tab': DAS('Tab zum Steuer und zurück (vorher Allstopp)'),
  'ziel.kurs': T('Livia: Kurs auf die Markierung (Tafel oder Taste)', 'Livia: Kurs auf die Markierung (Text oder Sprache)'),
  'ziel.name': DAS('Einen Bot mit Namen ansprechen („Livia, …“)'),
  'ziel.anflug': DAS('Das Schiff erreicht die Markierung'),
  'ziel.stopp': T('Livia: Alle Maschinen stopp (Shift+X oder Tafel)', 'Livia: Alle Maschinen stopp (Text oder Sprache)'),
  'ziel.ziel1': DAS('Cassius: ein Störrelais anvisieren („Ziel markieren“)'),
  'ziel.scan': DAS('Cassius: das Ziel scannen (in Reichweite)'),
  'ziel.ziel2': DAS('Cassius: auch das andere Störrelais anvisieren'),
  'ziel.abstand': DAS('Livia: Abstand zum Ziel halten (Schussbogen)'),
  'ziel.frei': T('Cassius: Feuer frei (Shift+F oder Tafel)', 'Cassius: Feuer frei (Text oder Sprache)'),
  'ziel.abschuss': DAS('Ein Störrelais abschießen'),
  'ziel.halt': T('Cassius: Feuer einstellen (Shift+G oder Tafel)', 'Cassius: Feuer einstellen (Text oder Sprache)'),
  'ziel.reparieren': DAS('Titus: ein beschädigtes System reparieren (bis es heil ist)'),
  'ziel.status': T('Statusbericht abfragen (Shift+S), freiwillig', 'Statusbericht abfragen (Text oder Sprache), freiwillig'),
  'ziel.automatik': DAS('Automatik: Bots zurück auf Standard, freiwillig'),
  'ziel.gespraech': DAS('Mit einem Bot reden (Ö tippen, Ä sprechen), freiwillig'),
  'ziel.schnell': DAS('Schnellsprung: Route über mehrere Sektoren, Livia: Sprung (Tafel/Taste)'),
  'ziel.normal': DAS('Normaler Sprung in einen Nachbarsektor, Livia: Sprung (Tafel/Taste)'),
  // Hänger-Hinweise
  'h.sprungziel': DAS('Sprungziel: Reiter 2 (Sternkarte) der Captain-Konsole, Sektor wählen, Enter.'),
  'h.marker': DAS('Marker: Reiter 3 (Lagekarte), leere Stelle anklicken, ein Stück vom Schiff entfernt.'),
  'h.tab': DAS('Tab wechselt die Station: erst zum Steuer, dann weiter zurück zum Captain. Vorher Allstopp.'),
  'h.tab2': DAS('Wer am Steuer steht, verdrängt Livia: ihr Kurs ist weg und das Schiff läuft weiter.'),
  'h.kurs': T('Kurs: Tafel B, Navigation, Kurs, „die Markierung“. Ohne Marker hat Livia kein Ziel.',
    'Kurs: # drücken, „Livia, Kurs auf die Markierung“ tippen, Enter. Oder ^ halten und sprechen.'),
  'h.anflug': DAS('Livia ist unterwegs. Etwas Geduld; liegt der Marker sehr weit weg, setze ihn näher.'),
  'h.stopp': T('Stopp: Shift+X oder Tafel B, Navigation, Alle Maschinen stopp.', 'Stopp: „Livia, Stopp“ per Textzeile (#) oder Sprechtaste (^).'),
  'h.name': DAS('Mit Namen ansprechen: „Livia, Kurs auf die Markierung“ statt nur „Navigation, …“.'),
  'h.ziel1': T('Ziel: in der Lagekarte (Reiter 3) ein Störrelais anklicken, dann Tafel B, Ops, Ziel markieren.',
    'Ziel: Störrelais in der Lagekarte (Reiter 3) anklicken, dann „Cassius, markiertes Ziel“.'),
  'h.scan': T('Scan: braucht Reichweite. Erst Livia näher ran, dann Tafel B, Ops, Scannen.', 'Scan: braucht Reichweite. Erst Livia näher ran, dann „Cassius, Scan“.'),
  'h.ziel2': T('Anderes Relais: in der Lagekarte anklicken, dann wieder Tafel B, Ops, Ziel markieren.',
    'Anderes Relais: in der Lagekarte anklicken, dann wieder „Cassius, markiertes Ziel“.'),
  'h.abstand': T('Livia muss Cassius in den Schussbogen bringen: Tafel B, Navigation, Abstand, das Ziel.',
    'Livia muss Cassius in den Schussbogen bringen: „Livia, Abstand zum Ziel halten“.'),
  'h.frei': T('Feuer frei: Shift+F oder Tafel B, Ops, Feuer frei. Bis dahin schießt Cassius nicht.', 'Feuer frei: „Cassius, Feuer frei“. Bis dahin schießt Cassius nicht.'),
  'h.abschuss': DAS('Kein Treffer? Cassius schießt nur im Bogen: Livia näher ran lassen (Abstand, kleinerer Wert).'),
  'h.halt': T('Feuer einstellen: Shift+G oder Tafel B, Ops, Feuer einstellen.', 'Feuer einstellen: „Cassius, Feuer halt“.'),
  'h.reparieren': T('Titus: Tafel B, Technik, Reparieren, ein System, das noch beschädigt ist.', 'Titus: „Titus, Antrieb reparieren“ oder ein anderes beschädigtes System.'),
  'h.reparieren2': DAS('Ein System, das Titus schon repariert hat, zählt nicht.'),
  'h.schnell': DAS('Schnellsprung: Reiter 2 (Sternkarte), einen Sektor über mindestens zwei Sprünge wählen, z. B. Boje B-7.'),
  'h.schnell2': DAS('Dann Enter, danach Tafel B oder Taste, Navigation, Sprung (nicht sprechbar).'),
  'h.normal': DAS('Normaler Sprung: einen Nachbarsektor wählen (Reiter 2, Enter), dann Tafel B, Navigation, Sprung.'),
};
const NUR_VARIANTE = { 'ziel.name': 'sprache', 'h.name': 'sprache' };   // Namensadresse: nur in der Sprachvariante
function texte(v) {
  const t = {};
  for (const [k, o] of Object.entries(TEXTE)) if (!NUR_VARIANTE[k] || NUR_VARIANTE[k] === v) t[k] = o[v];
  return t;
}

// ---------- Aufbau ----------
function buch(v) {
  const V = VARIANTEN[v];
  const hinweis = (at, ifc, text) => ({ at, if: ifc, oda: '@' + text, garantie: 'hinweis' });
  const ZWEITE = { 'h.tab': 'h.tab2', 'h.reparieren': 'h.reparieren2', 'h.schnell': 'h.schnell2' };   // lange Hinweise: zweite Zeile 6 s später
  const hint = (at, ifc, text) => (ZWEITE[text] ? [hinweis(at, ifc, text), hinweis(at + 6, ifc, ZWEITE[text])] : [hinweis(at, ifc, text)]);
  const start = (k, zwei) => [{ at: 0.5, oda: '@' + k + '.start' }].concat(zwei ? [{ at: 6.5, oda: '@' + k + '.start2' }] : []);
  const obj = (id, textKey, done, extra) => Object.assign({ id, text: '@ziel.' + textKey, done }, extra || {});

  const stand = {
    id: 'stand',
    timers: [start('stand', true),
      hint(40, nicht(z('sprungziel_gewaehlt')), 'h.sprungziel'),
      hint(70, nicht(z('marker')), 'h.marker'),
      hint(100, nicht(alle(z('tab:helm'), z('tab:captain'))), 'h.tab')],
    objectives: [obj('sprungziel', 'sprungziel', z('sprungziel_gewaehlt')), obj('marker', 'marker', z('marker')), obj('tab', 'tab', alle(z('tab:helm'), z('tab:captain')))],
  };
  stand.next = [{ if: alle(...stand.objectives.map((o) => o.done)), goto: 'kurs' }];

  const kursDone = alle(bef(V, 'nav.kurs'), z('marke_erreicht'));
  const kurs = {
    id: 'kurs',
    timers: [start('kurs'),
      hint(40, nicht(bef(V, 'nav.kurs')), 'h.kurs'),
      hint(90, alle(bef(V, 'nav.kurs'), nicht(z('marke_erreicht'))), 'h.anflug'),
      hint(60, alle(z('marke_erreicht'), nicht(bef(V, 'nav.stopp'))), 'h.stopp')],
    objectives: [obj('kurs', 'kurs', bef(V, 'nav.kurs')), obj('anflug', 'anflug', kursDone), obj('stopp', 'stopp', alle(z('marke_erreicht'), bef(V, 'nav.stopp')))],
  };
  if (v === 'sprache') {   // Namensadresse ("Livia, Kurs auf die Markierung"): Pflichtziel der Sprachvariante
    const name = eines(z('bot_name:text'), z('bot_name:sprache'));
    kurs.objectives.splice(1, 0, obj('name', 'name', name));
    kurs.timers.push(hint(75, nicht(name), 'h.name'));
  }
  kurs.next = [{ if: alle(...kurs.objectives.map((o) => o.done)), goto: 'ziele' }];

  const zielAn = (kennung) => mitQuelle(V, 'ziel_angewaehlt:' + kennung);
  const ziel1 = eines(zielAn('a'), zielAn('b'));
  const ziel2 = alle(zielAn('a'), zielAn('b'));
  const ziele = {
    id: 'ziele',
    enter: [{ do: 'training_aktion', name: 'uebungsziele' }],
    timers: [start('ziele'),
      hint(45, nicht(ziel1), 'h.ziel1'),
      hint(100, alle(ziel1, nicht(ziel2)), 'h.ziel2')],
    objectives: [obj('ziel1', 'ziel1', ziel1), obj('ziel2', 'ziel2', ziel2)],
  };
  ziele.next = [{ if: alle(...ziele.objectives.map((o) => o.done)), goto: 'kampf' }];

  const scan = bef(V, 'ops.scan'); const frei = bef(V, 'ops.feuer_frei'); const halt = bef(V, 'ops.feuer_halt'); const abstand = bef(V, 'nav.abstand');
  const kampf = {
    id: 'kampf',
    enter: ['bot_befehl:ops.feuer_frei', 'bot_befehl:ops.feuer_halt', 'bot_befehl:nav.abstand', 'bot_befehl:ops.scan', 'abschuss'].map((p) => ({ do: 'training_vergessen', praefix: p })),
    timers: [start('kampf'),
      hint(40, nicht(abstand), 'h.abstand'),
      hint(70, alle(abstand, nicht(scan)), 'h.scan'),
      hint(100, alle(abstand, nicht(frei)), 'h.frei'),
      hint(110, alle(frei, nicht(z('abschuss'))), 'h.abschuss'),
      hint(60, alle(z('abschuss'), nicht(halt)), 'h.halt')],
    rules: [{ if: z('abschuss'), do: [{ do: 'training_vergessen', praefix: 'bot_befehl:ops.feuer_halt' }] }],   // Feuer einstellen zählt erst NACH dem Abschuss
    objectives: [obj('abstand', 'abstand', abstand), obj('scan', 'scan', scan), obj('frei', 'frei', frei), obj('abschuss', 'abschuss', alle(frei, z('abschuss'))), obj('halt', 'halt', alle(z('abschuss'), halt))],
  };
  kampf.next = [{ if: alle(...kampf.objectives.map((o) => o.done)), goto: 'reparatur' }];

  const rep = alle(bef(V, 'tech.reparieren'), mitQuelle(V, 'repariert'));
  const alleHeil = alle(...['engines', 'transfer', 'weapon_bow', 'shields'].map((s) => ({ check: { name: 'system_ok', system: s } })));
  const nochmal = (at) => ({ at, if: alle(nicht(rep), alleHeil), do: [{ do: 'training_aktion', name: 'schaeden' }, { oda: '@reparatur.nochmal' }] });
  const reparatur = {
    id: 'reparatur',
    enter: [{ do: 'training_aktion', name: 'uebungsziele_weg' }, { do: 'training_aktion', name: 'schaeden' }],
    timers: [start('reparatur'),
      hint(50, nicht(rep), 'h.reparieren'),
      nochmal(75), nochmal(150), nochmal(225)],
    objectives: [obj('reparieren', 'reparieren', rep),
      obj('status', 'status', z('bot_befehl:bot.status'), { optional: true }),
      obj('automatik', 'automatik', z('bot_befehl:bot.automatik'), { optional: true }),
      obj('gespraech', 'gespraech', z('bot_gespraech'), { optional: true })],
  };
  const pflichtRep = reparatur.objectives.filter((o) => !o.optional);
  reparatur.next = [{ if: alle(...pflichtRep.map((o) => o.done)), goto: 'sprung' }];

  const schnell = alle(bef(V, 'nav.sprung'), z('schnellsprung'));
  const normal = alle(bef(V, 'nav.sprung'), z('sprung'));
  const sprung = {
    id: 'sprung',
    timers: [start('sprung', true),
      hint(120, alle(nicht(schnell), nicht(normal)), 'h.schnell'),   // erst wenn noch kein Sprung gelang (ein Sprung braucht Anflug und Aufladen, bis 70 s)
      hint(240, alle(normal, nicht(schnell)), 'h.schnell'),
      hint(240, alle(schnell, nicht(normal)), 'h.normal')],
    rules: [{ if: alle(schnell, normal), do: [{ oda: '@ende' }, { setFlag: { trainingFertig: true } }] }],
    objectives: [obj('schnell', 'schnell', schnell), obj('normal', 'normal', normal)],
  };

  const steps = [stand, kurs, ziele, kampf, reparatur, sprung];
  for (const s of steps) s.timers = s.timers.flat();   // hint() und start() liefern Listen

  return {
    $schema: '../regiebuch/regiebuch.schema.json',
    _kommentar: 'TRA-01 E: ERZEUGT von tools/gen-tra-captain.js (nicht von Hand ändern; node tools/gen-tra-captain.js). ' + (v === 'tafel' ? 'Tafel-Variante des Captain-Trainings' : 'Sprachvariante des Captain-Trainings') + ' (Lobby-Option trainingSprache, Tabelle TRAININGSMODI in server/sim/training.js: buch / buchSprache). Ablauf stand, kurs, ziele, kampf, reparatur, sprung; Ziel-Ids in server/sim/training-erkennung.js.',
    format: 'regiebuch/1',
    id: V.id,
    kopf: { titel: V.titel, art: 'intern', auftraggeber: 'tesk', zielspieldauer_min: 10, feldzug: null },
    erwartet: { trainingFertig: false },
    buch: { von: [{ npc: 'tesk' }], briefing: '@buch.briefing', belohnung: '@buch.belohnung' },
    buehne: { orte: ['hafen', 'splitter', 'b7', 'vaelen'] },
    steps,
    ausgaenge: {
      erfolg: { beschreibung: 'Training geschafft (Abzeichen Captain).', folgen: [] },
      verloren: { beschreibung: 'Training abgebrochen.', folgen: [] },
    },
    texte: texte(v),
  };
}

function erzeugen() { return Object.keys(VARIANTEN).map((v) => ({ datei: path.join(DIR, VARIANTEN[v].datei), inhalt: JSON.stringify(buch(v), null, 2) + '\n' })); }

if (require.main === module) {
  const pruefen = process.argv.includes('--check');
  let abweichend = 0;
  for (const { datei, inhalt } of erzeugen()) {
    if (pruefen) {
      const ist = fs.existsSync(datei) ? fs.readFileSync(datei, 'utf8').replace(/\r\n/g, '\n') : null;
      if (ist !== inhalt) { abweichend++; console.log('ABWEICHEND: ' + path.relative(process.cwd(), datei)); }
    } else { fs.writeFileSync(datei, inhalt); console.log('geschrieben: ' + path.relative(process.cwd(), datei)); }
  }
  if (pruefen) { console.log(abweichend ? abweichend + ' Datei(en) weichen von der Erzeugung ab' : 'Bücher entsprechen der Erzeugung'); process.exit(abweichend ? 1 : 0); }
}
module.exports = { VARIANTEN, buch, erzeugen };
