'use strict';
// BOT-04 A1/A3: Selbsttest des Bot-Matchers (shared/bot-matcher.js, content/bots/kanon.json + muster.json). In-process, ohne Server.
// A3: Kanon-Datei vollstaendig gegen den Katalog v1 (jede Sprechform und Kurzform trifft exakt ihren Befehl, auch mit Adressierung), Sicherheitsregeln
// (Verneinung, Frage, zwei Argumente, Fremdsprache, zu lang, Rolle), freie Formulierungen (Stufe 2) mit niedrigerer Konfidenz, Eval-Saetze.
// Belegt: 22 der 23 Befehle des Katalogs v1 sind sprechbar (mindestens ein Fall je Befehl), nav.sprung ausdruecklich nicht (Sprung veraendert die Welt, Fehlerkennung zu teuer); die 7 bekannten STT-Fehler der Erkundung
// (Frage 6a) laufen auf den richtigen Befehl oder (wo der Katalog nichts hat) auf null; Negativfaelle und Beinahe-Treffer liefern null
// (Falsch-Positiv 0); fehlendes oder mehrdeutiges Pflichtargument liefert null; hex:/objekt: sind nicht waehlbar; Adressierung; Schwelle
// (Standard und opts.schwelle); setzeMuster. Die Standardschwelle stuetzt sich auf die Konfidenz-Verteilung dieser Faelle (siehe Ausgabe).
//   node tools/test-bot-matcher.js        (npm run test:bot-matcher)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const M = require('../shared/bot-matcher.js');

let fehler = 0, n = 0;
function pruefe(text, erw, opts) {
  n++;
  const r = M.match(text, opts);
  let ok;
  if (erw === null) ok = r === null;
  else ok = r !== null && r.befehl === erw.befehl && JSON.stringify(sortiert(r.args)) === JSON.stringify(sortiert(erw.args || {})) && (!erw.an || r.an === erw.an);
  if (!ok) { fehler++; console.log('FEHLER: "' + text + '" erwartet ' + JSON.stringify(erw) + ' bekommen ' + JSON.stringify(r)); }
  return r;
}
function sortiert(o) { const r = {}; for (const k of Object.keys(o || {}).sort()) r[k] = o[k]; return r; }
function b(befehl, args, an) { return { befehl, args: args || {}, an }; }

// ---- positive Faelle je Befehl (Katalog v1) ----
const pos = [
  ['Kurs auf die Markierung', b('nav.kurs', { ziel: 'marke' })],
  ['Kurs auf das Ziel', b('nav.kurs', { ziel: 'ziel' })],
  ['Kurs Basis', b('nav.kurs', { ziel: 'basis' })],
  ['Navigation, fliege zur Basis', b('nav.kurs', { ziel: 'basis' }, 'navigation')],
  ['Alle Maschinen stopp', b('nav.stopp')],
  ['Stopp', b('nav.stopp')],
  ['Halbe Kraft voraus', b('nav.schub', { stufe: 'halb' })],
  ['Volle Kraft voraus', b('nav.schub', { stufe: 'voll' })],
  ['Dreiviertel Kraft voraus', b('nav.schub', { stufe: 'dreiviertel' })],
  ['Rückwärts langsam', b('nav.schub', { stufe: 'rueckwaerts' })], ['Viertel Kraft voraus', b('nav.schub', { stufe: 'viertel' })],
  ['Ausweichen', b('nav.ausweichen')],
  ['Bitte sofort ausweichen', b('nav.ausweichen')],
  ['Abstand halten', b('nav.abstand', {})],
  ['Abstand zum Ziel halten', b('nav.abstand', { ziel: 'ziel' })],
  ['Abstand zur Basis halten', b('nav.abstand', { ziel: 'basis' })],
  ['Abstand halten 500 Meter', b('nav.abstand', { meter: 500 })], ['Abstand zum Ziel fünfzig Meter', b('nav.abstand', { ziel: 'ziel', meter: 50 })], ['Statusbericht, Ops', b('bot.status', {}, 'ops')], ['Weichen Sie aus', b('nav.ausweichen')],
  ['Andocken', b('nav.andocken')],
  ['Ziel markieren', b('ops.ziel', { ziel: 'markiert' })],
  ['Nächstes Ziel', b('ops.ziel', { ziel: 'naechstes' })],
  ['Markiertes Ziel anvisieren', b('ops.ziel', { ziel: 'markiert' })],
  ['Feuer frei', b('ops.feuer_frei', {}, 'ops')],
  ['Feuer frei Torpedo', b('ops.feuer_frei', { waffen: 'torpedo' })],
  ['Torpedo abfeuern', b('ops.feuer_frei', { waffen: 'torpedo' })],
  ['Alle Waffen Feuer', b('ops.feuer_frei', { waffen: 'alle' })],
  ['Feuer einstellen', b('ops.feuer_halt')],
  ['Feuer halt', b('ops.feuer_halt')],
  ['Scannen', b('ops.scan')],
  ['Landepunkt scannen', b('ops.landescan')],
  ['Fracht an Bord', b('ops.beamen', { was: 'fracht' })],
  ['Person beamen', b('ops.beamen', { was: 'person' })],
  ['Feuer zuerst', b('tech.prio', { ziel: 'feuer' })],
  ['Leck zuerst', b('tech.prio', { ziel: 'leck' })],
  ['Antrieb zuerst', b('tech.prio', { ziel: 'engines' })],
  ['Antrieb reparieren', b('tech.reparieren', { system: 'engines' })],
  ['Reaktor reparieren', b('tech.reparieren', { system: 'reactor' })],
  ['Modul zwei reparieren', b('tech.reparieren', { system: 'modul_2' })],
  ['Backbord Batterie reparieren', b('tech.reparieren', { system: 'battery_port' })],
  ['Schilde Steuerbord', b('tech.schild', { sektor: 'stb' })],
  ['Schilde Backbord', b('tech.schild', { sektor: 'bb' })],
  ['Schilde Bug', b('tech.schild', { sektor: 'bug' })],
  ['Schilde Heck', b('tech.schild', { sektor: 'heck' })],
  ['Technik, Schilde nach Steuerbord verlagern', b('tech.schild', { sektor: 'stb' }, 'technik')],
  ['Mehr Energie auf Waffen', b('tech.energie', { system: 'weapons', delta: 1 })],
  ['Weniger Energie auf die Schilde', b('tech.energie', { system: 'shields', delta: -1 })],
  ['Reaktor überladen', b('tech.ueberladen')],
  ['Außenteam zurückholen', b('bord.rueckholen')],
  ['Bord, Sensor', b('bord.sensor', {}, 'bord')],
  ['Kuppel', b('bord.kuppel')],
  ['Statusbericht', b('bot.status', {}, 'alle')],
  ['Technik, Statusbericht', b('bot.status', {}, 'technik')],
  ['Automatik', b('bot.automatik', {}, 'alle')],
  ['Automatisch', b('bot.automatik', {}, 'alle')], ['Ops, automatisch', b('bot.automatik', {}, 'ops')],
];
for (const [t, e] of pos) pruefe(t, e);

// ---- die 7 bekannten STT-Fehler (Erkundung Frage 6a) ----
// Ruder hart Backbord: im Katalog v1 gibt es keinen Befehl dafuer (nur nav.kurs/schub/stopp/ausweichen) -> null.
// Torpedo klar machen: "klar machen" ist Vorbereiten, nicht Feuer frei (ops.feuer_frei) -> null, ein ungewolltes Feuern waere der schlimmere Fehler.
// Navigation Cours Concordia: "Concordia" ist ein Objekt/Hex, per Sprache nicht waehlbar (Vertrag) -> null.
// Back zum Zieldrehen: "back" ist Bug oder Backbord (nie_aehnlich, nur exakt), ausserdem steht es im Entwicklungsset mit erwartet null -> null.
pruefe('Schilde Backboard', b('tech.schild', { sektor: 'bb' }));
pruefe('Wolle Kraft voraus', b('nav.schub', { stufe: 'voll' }));
pruefe('Alle Maschinen stoppen', b('nav.stopp'));
pruefe('Ruderhard Backboard', null);
pruefe('Torpedo klar machen', null);
pruefe('Back zum Zieldrehen', null);
pruefe('Schilde Back', null);
// Kurze Woerter (genau 3 Zeichen): gleicher Anfangsbuchstabe plus gleicher Klang oder eine Auslassung; anderer Anfang nie
pruefe('Schilde Buk', b('tech.schild', { sektor: 'bug' }));
pruefe('Schilde Hek', b('tech.schild', { sektor: 'heck' }));
pruefe('Viertl Kraft voraus', b('nav.schub', { stufe: 'viertel' }));
pruefe('Schilde Unten', null);
pruefe('Schilde Oben', null);
// Mehrteilige Aeusserungen: gleiche Befehle in den Teilen ok, verschiedene oder Plaudern null, falsche Rolle null
pruefe('Maschinen aus, Stopp', b('nav.stopp'));
pruefe('Anlegen und andocken', b('nav.andocken'));
pruefe('Nach Hause, Kurs auf die Basis', b('nav.kurs', { ziel: 'basis' }));
pruefe('Stopp, Kurs auf die Basis', null);
pruefe('Technik, Kurs auf die Markierung', null);
pruefe('Kurs Marke, Ops', null);
pruefe('Ich glaube ja, dass wir jetzt wohl besser, Stopp', null);
pruefe('Feuer frei Ops', b('ops.feuer_frei', {}, 'ops'));
pruefe('Feuer frei Technik', null);
pruefe('Navigation Cours Concordia', null);
// Runde 2: Regressionsfaelle (BOT-04 A1): englische Funktionswoerter, mehrdeutige Verben, 'zurueck', Seefahrts-Plaudern -> null; Saetze eines Seemanns -> Befehl
pruefe('All stop', null);
pruefe('Please stop the engines', null);
pruefe('Schilde hochfahren', null);
pruefe('Antrieb runterfahren', null);
pruefe('Zurück zur Basis', b('nav.kurs', { ziel: 'basis' }));
pruefe('Zurück zum Schiff', null);
pruefe('Halber Schub', b('nav.schub', { stufe: 'halb' }));
pruefe('Halbe Kraft voran', b('nav.schub', { stufe: 'halb' }));
pruefe('Vollgas', b('nav.schub', { stufe: 'voll' }));
pruefe('Navigation, Abstand tausend Meter', b('nav.abstand', { meter: 1000 }, 'navigation'));
pruefe('Abstand', null);
pruefe('Kurs aufs Zeil', b('nav.kurs', { ziel: 'ziel' }));
pruefe('Kümmert euch zuerst um das Leck', b('tech.prio', { ziel: 'leck' }));
pruefe('Stellt das Feuer ein', b('ops.feuer_halt'));
pruefe('Feuererlaubnis erteilt', b('ops.feuer_frei'));
for (const t of ["Der Kapitän trinkt Kaffee auf der Brücke","Das Schiff hat einen neuen Anstrich","Die Maschinen sind ziemlich alt","Wir fahren morgen zum Hafen","Der Anker liegt im Schlamm","Ich mag das Meer bei Sturm","Schilde sind teuer geworden","Das Ruder klemmt manchmal","Die Crew hat Hunger","Backbord ist links, oder?","Steuerbord ist rechts","Der Bug sieht kaputt aus","Das Heck ist noch nass","Die Fracht kommt morgen an","Das Außenteam ist müde","Ein Torpedo hat keinen Kaffee","Die Kuppel ist wirklich schön","Der Sensor piept komisch","Die Basis hat Hunger","Das Leck in meinem Eimer","Reaktor ausschalten wäre doof","Schilde runterfahren","Waffen hochfahren","Antrieb hochfahren","Antrieb runterfahren","Maschinen anwerfen","Anker lichten","Leinen los","Segel setzen","Kurs egal","Volle Fahrt zurück","Alle Mann an Deck","Mann über Bord","Boot klar zum Entern","Hart Steuerbord","Ruder hart backbord","Torpedo im Wasser","Feuer im Maschinenraum","Wir haben Land in Sicht","Rettungsboot zu Wasser lassen","Positionslichter an","Zurück","Zurück zum Schiff","Halt die Klappe","Schiff versenken","Beiboot setzen","Kurs auf den Hafen","Sprung ins Wasser","Alle Mann in die Messe","Volle Breitseite von Hans","Fähre kommt"]) pruefe(t, null);


// ---- weitere STT-artige Fehler (ohne Praefix, Gross/Klein, Satzzeichen) ----
pruefe('schilde steuerboard.', b('tech.schild', { sektor: 'stb' }));
pruefe('Schilde Steuer Bord!', b('tech.schild', { sektor: 'stb' }));
pruefe('Halbe Kraft voraus.', b('nav.schub', { stufe: 'halb' }));
pruefe('Andocken!', b('nav.andocken'));
pruefe('Antrieb reparieren.', b('tech.reparieren', { system: 'engines' }));
pruefe('Ausweichmanöver', b('nav.ausweichen'));
pruefe('Reaktor überlasten', b('tech.ueberladen'));
pruefe('Schilde Bagbord', b('tech.schild', { sektor: 'bb' }));

// ---- weitere Formulierungen (Probelauf) ----
for (const [t, e] of [
  ['Setz Kurs auf die Basis', b('nav.kurs', { ziel: 'basis' })], ['Fahr zur Markierung', b('nav.kurs', { ziel: 'marke' })],
  ['Alle Maschinen anhalten', b('nav.stopp')], ['Schiff stoppen', b('nav.stopp')], ['Volle Kraft voraus bitte', b('nav.schub', { stufe: 'voll' })],
  ['Halte Abstand zum Ziel', b('nav.abstand', { ziel: 'ziel' })], ['Kurs Marke, Navigation', b('nav.kurs', { ziel: 'marke' }, 'navigation')], ['Dock an', b('nav.andocken')], ['Volle Kraft', b('nav.schub', { stufe: 'voll' })],
  ['Nächsten Gegner anvisieren', b('ops.ziel', { ziel: 'naechstes' })], ['Steuerbord Feuer frei', b('ops.feuer_frei', { waffen: 'stb' })], ['Torpedo los', b('ops.feuer_frei', { waffen: 'torpedo' })],
  ['Waffen sichern', b('ops.feuer_halt')], ['Scanne die Umgebung', b('ops.scan')], ['Person an Bord holen', b('ops.beamen', { was: 'person' })],
  ['Feuer löschen', b('tech.prio', { ziel: 'feuer' })], ['Leck abdichten', b('tech.prio', { ziel: 'leck' })], ['Kümmere dich zuerst um das Feuer', b('tech.prio', { ziel: 'feuer' })],
  ['Repariere den Antrieb', b('tech.reparieren', { system: 'engines' })], ['Schilde nach Backbord', b('tech.schild', { sektor: 'bb' })],
  ['Mehr Leistung für die Waffen', b('tech.energie', { system: 'weapons', delta: 1 })], ['Energie abziehen Schilde', b('tech.energie', { system: 'shields', delta: -1 })],
  ['Überlaste den Reaktor', b('tech.ueberladen')], ['Zurück zur Automatik', b('bot.automatik')],
]) pruefe(t, e);
// Energie ohne Richtung ist kein Befehl (kein Raten bei mehr/weniger)
for (const t of ['Energie auf Waffen', 'Energie von den Waffen', 'Die Schilde Steuerbord sind kaputt', 'Schilde sind unten', 'Kurs auf die Markierung wäre gut', 'Torpedo laden', 'Waffen klar machen',
  'Feuer im Maschinenraum', 'Mehr Fracht', 'Kuppel Sensor', 'Feuerwehr', 'Schilde hecken', 'Schilde Mitte', 'Kurs null', 'Stufe sieben', 'Wir docken morgen an', 'Andocken verboten', 'Scan abgeschlossen', 'Sag mal Status']) pruefe(t, null);

// ---- Pflichtargument fehlt oder ist mehrdeutig -> null ----
for (const t of ['Schilde', 'Schilde hoch', 'Kurs', 'Kurs setzen', 'Sprung', 'Reparieren', 'Energie', 'Mehr Energie', 'Feuer', 'Beamen', 'Priorität', 'Schilde Backbord Steuerbord', 'Schilde Bug Heck', 'Kurs auf Basis Markierung'])
  pruefe(t, null);

// ---- nicht sprechbare Argumente: hex/objekt ----
for (const t of ['Sprung nach Hex fünf', 'Sprung Hex 12', 'Kurs auf Objekt drei', 'Kurs Concordia', 'Sprung nach Concordia', 'Objekt sieben anvisieren']) pruefe(t, null);
{
  for (const datei of ['muster.json', 'kanon.json']) {
    const roh = fs.readFileSync(path.join(__dirname, '..', 'content', 'bots', datei), 'utf8');
    assert(!/"(hex|objekt):/.test(roh), datei + ' enthaelt hex:/objekt: als Argument');
    assert(!/"nav.sprung"/.test(roh), datei + ' enthaelt nav.sprung (nicht sprechbar)');
  }
  n += 2;
}

// ---- Negativfaelle: Plaudern, Beinahe-Treffer, Negation, Fragen ----
for (const t of [
  '', '   ', 'Hallo zusammen', 'Das Wetter ist heute schön', 'Wie geht es euch', 'Wer hat das Schiff gebaut', 'Erzähl mir etwas über die Concordia',
  'Ich glaube wir sollten bald Pause machen', 'Gute Arbeit Leute', 'Was kostet ein Torpedo', 'Wo ist die Basis',
  'Nicht ausweichen', 'Kein Feuer frei', 'Schilde nicht auf Steuerbord', 'Bitte nicht stoppen', 'Nein Andocken', 'Lass das Feuer frei',
  'Schilde Steuerbord wäre jetzt vielleicht gut oder auch nicht aber ich weiß es nicht genau',
  'Das Feuer im Kamin', 'Kurs halten wir später', 'Der Antrieb ist laut', 'Die Fracht ist schwer', 'Ruder hart Backbord', 'Schildkröte',
  'Schnitzel mit Pommes', 'Feuerwehr', 'Statistik', 'Sensorik ist spannend', 'Ziel erreicht', 'Basislager',
]) pruefe(t, null);
// Adressierung an die falsche Rolle: Technik kann nicht steuern, Navigation kann keine Schilde legen
pruefe('Technik, Kurs auf die Markierung', null);
pruefe('Navigation, Schilde Steuerbord', null);
pruefe('Ops, Antrieb reparieren', null);
pruefe('Kurs Marke, Ops', null);
// Meter-Angabe bei anderem Befehl -> null
pruefe('Schilde Steuerbord 500 Meter', null);

// ---- Schwelle ----
{
  const r = M.match('Schilde Backboard');
  assert(r && r.konfidenz < 1 && r.konfidenz >= M.SCHWELLE, 'Backboard: Konfidenz ' + (r && r.konfidenz));
  assert.strictEqual(M.match('Schilde Backboard', { schwelle: 0.99 }), null, 'opts.schwelle 0.99 muss die STT-Variante abweisen');
  const e = M.match('Schilde Steuerbord', { schwelle: 0.99 });
  assert(e && e.konfidenz === 1, 'exakter Treffer bleibt ueber jeder Schwelle');
  assert(M.SCHWELLE > 0.5 && M.SCHWELLE < 1);
  n += 3;
}

// ---- setzeMuster (Browser-Weg): fremde Musterdaten ersetzen die Datei ----
{
  const roh = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'bots', 'muster.json'), 'utf8'));
  const kanon = kanonDatei();
  const klein = { befehle: { 'nav.stopp': { an: 'navigation', familie: ['klappe'] } }, fuellwoerter: [], kanon: { befehle: [{ befehl: 'nav.stopp', an: 'navigation', anzeige: 'Halt die Klappe', args: {} }] } };
  M.setzeMuster(klein);
  assert(M.match('Halt die Klappe') && M.match('Halt die Klappe').befehl === 'nav.stopp');
  assert.strictEqual(M.match('Alle Maschinen stopp'), null);
  assert.throws(() => M.setzeMuster(null));
  assert.throws(() => M.setzeKanon({}));
  M.setzeMuster(Object.assign({}, roh, { kanon }));
  assert(M.match('Alle Maschinen stopp').befehl === 'nav.stopp');
  n += 5;
}

// ---- alle Katalogbefehle haben Muster und mindestens einen positiven Fall ----
{
  const katalog = ['nav.kurs', 'nav.stopp', 'nav.schub', 'nav.ausweichen', 'nav.abstand', 'nav.andocken',
    'ops.ziel', 'ops.feuer_frei', 'ops.feuer_halt', 'ops.scan', 'ops.landescan', 'ops.beamen',
    'tech.prio', 'tech.reparieren', 'tech.schild', 'tech.energie', 'tech.ueberladen',
    'bord.rueckholen', 'bord.sensor', 'bord.kuppel', 'bot.status', 'bot.automatik'];
  const info = M.info();
  const imTest = new Set(pos.map(([, e]) => e.befehl));
  for (const k of katalog) {
    assert(info.befehle[k] > 0, 'keine Sprechform fuer ' + k);
    assert(imTest.has(k), 'kein Testfall fuer ' + k);
  }
  assert.deepStrictEqual(Object.keys(info.befehle).sort(), katalog.slice().sort(), 'Sprechformen mit Befehlen ausserhalb des Katalogs (nav.sprung ist nicht sprechbar)');
  assert.deepStrictEqual(info.familien.slice().sort(), katalog.slice().sort(), 'Wortfamilien ausserhalb des Katalogs');
  assert(!info.befehle['nav.sprung'] && !info.familien.includes('nav.sprung'), 'nav.sprung darf keine Sprechform haben');
  for (const t of ['Sprung zur Markierung', 'Springe zur Basis', 'Spring zur Markierung', 'Sprung', 'Navigation, Sprung zur Basis', 'Schnellsprung Markierung']) assert(M.match(t) === null, 'Sprung per Sprache: ' + t);
  n += 3;
}

// ---- sprechbare Argumente: jedes Argument eines Katalogbefehls ist per Sprache erreichbar ----
{
  const faelle = [
    ['Schilde Bug', 'sektor', 'bug'], ['Schilde Steuerbord', 'sektor', 'stb'], ['Schilde Heck', 'sektor', 'heck'], ['Schilde Backbord', 'sektor', 'bb'],
    ['Feuer frei alle Waffen', 'waffen', 'alle'], ['Feuer frei Bugwaffen', 'waffen', 'bug'], ['Feuer frei Backbordbatterie', 'waffen', 'bb'], ['Feuer frei Steuerbordbatterie', 'waffen', 'stb'], ['Feuer frei Torpedo', 'waffen', 'torpedo'],
    ['Kurs Markierung', 'ziel', 'marke'], ['Kurs Ziel', 'ziel', 'ziel'], ['Kurs Basis', 'ziel', 'basis'],
    ['Nächstes Ziel', 'ziel', 'naechstes'], ['Markiertes Ziel', 'ziel', 'markiert'],
    ['Feuer zuerst', 'ziel', 'feuer'], ['Leck zuerst', 'ziel', 'leck'], ['Schilde zuerst', 'ziel', 'shields'],
    ['Person an Bord', 'was', 'person'], ['Fracht an Bord', 'was', 'fracht'],
    ['Rückwärts langsam', 'stufe', 'rueckwaerts'], ['Viertel Kraft voraus', 'stufe', 'viertel'], ['Dreiviertel Kraft voraus', 'stufe', 'dreiviertel'], ['Halbe Kraft voraus', 'stufe', 'halb'], ['Volle Kraft voraus', 'stufe', 'voll'],
    ['Reaktor reparieren', 'system', 'reactor'], ['Triebwerk reparieren', 'system', 'engines'], ['Schildgenerator reparieren', 'system', 'shields'], ['Transfer reparieren', 'system', 'transfer'],
    ['Backbord Düse reparieren', 'system', 'thruster_port'], ['Steuerbord Düse reparieren', 'system', 'thruster_stbd'],
    ['Bug Emitter reparieren', 'system', 'emitter_bow'], ['Steuerbord Emitter reparieren', 'system', 'emitter_stbd'], ['Heck Emitter reparieren', 'system', 'emitter_aft'], ['Backbord Emitter reparieren', 'system', 'emitter_port'],
    ['Bugwaffe reparieren', 'system', 'weapon_bow'], ['Backbord Batterie reparieren', 'system', 'battery_port'], ['Steuerbord Batterie reparieren', 'system', 'battery_stbd'], ['Waffen reparieren', 'system', 'weapons'],
    ['Lafette fünf reparieren', 'system', 'lafette_5'], ['Lafette sieben reparieren', 'system', 'lafette_7'], ['Lafette neun reparieren', 'system', 'lafette_9'],
    ['Lafette eins reparieren', 'system', 'lafette_1'], ['Lafette drei reparieren', 'system', 'lafette_3'], ['Lafette zwei reparieren', 'system', 'lafette_2'],
    ['Modul eins reparieren', 'system', 'modul_1'], ['Modul zwei reparieren', 'system', 'modul_2'], ['Modul drei reparieren', 'system', 'modul_3'], ['Modul vier reparieren', 'system', 'modul_4'],
    ['Mehr Energie auf Antrieb', 'system', 'engines'], ['Mehr Energie auf Schilde', 'system', 'shields'], ['Mehr Energie auf Waffen', 'system', 'weapons'],
  ];
  for (const [t, k, v] of faelle) {
    n++;
    const r = M.match(t);
    if (!r || r.args[k] !== v) { fehler++; console.log('FEHLER Argument: "' + t + '" erwartet ' + k + '=' + v + ' bekommen ' + JSON.stringify(r)); }
  }
}

// ---- A3: Kanon-Datei vollstaendig gegen den Katalog v1 (Vertrag Bot-Befehle) ----
{
  const ROLLE = { navigation: 'Navigation', ops: 'Ops', technik: 'Technik', bord: 'Bord', alle: 'Crew' };
  const AN = { nav: 'navigation', ops: 'ops', tech: 'technik', bord: 'bord', bot: 'alle' };
  const erwartet = new Set();
  const add = (befehl, args) => erwartet.add(befehl + '|' + JSON.stringify(sortiert(args || {})));
  const je = (befehl, name, werte, fest) => { for (const w of werte) add(befehl, Object.assign({ [name]: w }, fest)); };
  const SYS = ['reactor', 'engines', 'shields', 'transfer', 'thruster_port', 'thruster_stbd', 'emitter_bow', 'emitter_stbd', 'emitter_aft', 'emitter_port',
    'weapon_bow', 'battery_port', 'battery_stbd', 'weapons', 'lafette_1', 'lafette_2', 'lafette_3', 'lafette_5', 'lafette_7', 'lafette_9', 'modul_1', 'modul_2', 'modul_3', 'modul_4'];
  je('nav.kurs', 'ziel', ['marke', 'ziel', 'basis']);
  add('nav.stopp');
  je('nav.schub', 'stufe', ['rueckwaerts', 'viertel', 'halb', 'dreiviertel', 'voll']);
  add('nav.ausweichen');
  add('nav.abstand'); je('nav.abstand', 'ziel', ['marke', 'ziel', 'basis']);
  add('nav.andocken');
  je('ops.ziel', 'ziel', ['naechstes', 'markiert']);
  add('ops.feuer_frei'); je('ops.feuer_frei', 'waffen', ['alle', 'bug', 'bb', 'stb', 'torpedo']);
  add('ops.feuer_halt'); add('ops.scan'); add('ops.landescan');
  je('ops.beamen', 'was', ['person', 'fracht']);
  je('tech.prio', 'ziel', ['feuer', 'leck', 'reactor', 'engines', 'shields', 'transfer', 'weapons', 'weapon_bow', 'battery_port', 'battery_stbd']);
  je('tech.reparieren', 'system', SYS);
  je('tech.schild', 'sektor', ['bug', 'stb', 'heck', 'bb']);
  for (const delta of [1, -1]) je('tech.energie', 'system', ['engines', 'shields', 'weapons'], { delta });
  for (const b of ['tech.ueberladen', 'bord.rueckholen', 'bord.sensor', 'bord.kuppel', 'bot.status', 'bot.automatik']) add(b);

  const formen = M.formen();
  const key = (f) => f.befehl + '|' + JSON.stringify(sortiert(f.args));
  const ist = formen.map(key);
  assert.strictEqual(new Set(ist).size, ist.length, 'Kanon: ein Befehl mit denselben Argumenten steht doppelt');
  assert.deepStrictEqual(Array.from(new Set(ist)).sort(), Array.from(erwartet).sort(), 'Kanon deckt den Katalog v1 nicht genau (Befehle/Argumentwerte)');
  n += 2;

  const texte = new Map();   // normalisierter Text -> Schluessel (jede Sprechform gehoert genau einem Befehl)
  for (const f of formen) {
    assert.strictEqual(f.an, AN[f.befehl.split('.')[0]], 'Kanon: falsche Rolle bei ' + f.befehl);
    const w = f.anzeige.split(' ').filter(Boolean).length;
    assert(w >= 1 && w <= 4, 'Kanon: Sprechform nicht 1 bis 4 Woerter: ' + f.anzeige);
    assert(f.kurz.length <= 3, 'Kanon: mehr als 3 Kurzformen bei ' + f.anzeige);
    for (const t of [f.anzeige].concat(f.kurz)) {
      const nt = M._intern.norm(t);
      assert(!texte.has(nt) || texte.get(nt) === key(f), 'Kanon: Text bei zwei Befehlen: ' + t);
      texte.set(nt, key(f));
    }
    const e = b(f.befehl, f.args, f.an);
    const r = pruefe(f.anzeige, e);
    if (r && r.konfidenz !== 1) { fehler++; console.log('FEHLER: Sprechform nicht mit Konfidenz 1: "' + f.anzeige + '" ' + r.konfidenz); }
    for (const k of f.kurz) pruefe(k, e);
    pruefe('Bitte ' + f.anzeige, e);
    pruefe(ROLLE[f.an] + ', ' + f.anzeige, b(f.befehl, f.args, f.an === 'alle' ? 'alle' : f.an));
    n += 2;
  }
  // Vertragsbeispiele ("Beispiel gesprochen") sind Sprechformen des Kanons
  const anzeigen = new Set(formen.map((f) => f.anzeige));
  for (const t of ['Kurs auf die Markierung', 'Alle Maschinen stopp', 'Halbe Kraft voraus', 'Ausweichen', 'Abstand halten', 'Andocken', 'Ziel markieren', 'Feuer frei', 'Feuer einstellen', 'Scannen',
    'Landepunkt scannen', 'Fracht an Bord', 'Feuer zuerst', 'Antrieb reparieren', 'Schilde Steuerbord', 'Mehr Energie auf Waffen', 'Reaktor überladen', 'Außenteam zurückholen', 'Sensor', 'Kuppel',
    'Statusbericht', 'Automatik']) assert(anzeigen.has(t), 'Vertragsbeispiel fehlt im Kanon: ' + t);
  n++;
  // Vertragsluecke ops.ziel: "Ziel markieren" = ziel markiert, im Kanon vermerkt
  assert(kanonDatei().befehle.some((e) => e.befehl === 'ops.ziel' && e.luecke), 'ops.ziel: Vertragsluecke nicht im Kanon vermerkt');
  n++;
}
function kanonDatei() { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'bots', 'kanon.json'), 'utf8')); }

// ---- A3: Sicherheitsregeln (beide Stufen) ----
for (const t of [
  'Nicht Schilde Steuerbord', 'Schilde Steuerbord nicht', 'Kein Feuer frei', 'Kannst du bitte Schilde Steuerbord machen?', 'Wer soll Schilde Steuerbord legen', 'Warum Schilde Steuerbord',
  'Schilde Steuerbord und Backbord', 'Schilde und Waffen', 'Schilde Bug Heck', 'Antrieb und Schilde reparieren', 'Feuer frei Torpedo und Bugwaffen',
  'Please Schilde Steuerbord', 'Stop the engines', 'All stop', 'Schilde Steuerbord und ich glaube wir sollten danach noch einen Kaffee holen',
  'Ops, Schilde Steuerbord', 'Technik, Kurs auf die Markierung', 'Navigation, Reaktor überladen', 'Bord, Statusbericht Technik',
  'Schilde', 'Kurs auf', 'Reparieren', 'Mehr Energie auf', 'Zuerst', 'Sprung nach Hex fünf', 'Springe zur Basis', 'Schilde Steuerbord wäre gut', 'Maschinen hochfahren',
  'Das Schiff hat Schilde', 'Steuerbord ist rechts', 'Kuppel Sensor',
]) pruefe(t, null);
// Stufe 2 (frei): gleiche Befehle, niedrigere Konfidenz; Kanon bleibt ueber jeder Schwelle
for (const [t, e] of [
  ['Repariert den Reaktor', b('tech.reparieren', { system: 'reactor' })], ['Technik, repariere den Antrieb', b('tech.reparieren', { system: 'engines' }, 'technik')],
  ['Führen Sie einen Scan durch', b('ops.scan')], ['Feuer hat Priorität', b('tech.prio', { ziel: 'feuer' })], ['Steuerbord Schilde', b('tech.schild', { sektor: 'stb' })],
  ['Mehr Saft auf Waffen', b('tech.energie', { system: 'weapons', delta: 1 })], ['Schubstufe voll', b('nav.schub', { stufe: 'voll' })], ['Weichen Sie aus', b('nav.ausweichen')],
  ['Abstand zum Ziel fünfzig Meter', b('nav.abstand', { ziel: 'ziel', meter: 50 })], ['Feuer frei auf Steuerbord', b('ops.feuer_frei', { waffen: 'stb' })],
]) {
  const r = pruefe(t, e);
  if (r && !(r.konfidenz < 1 && r.konfidenz <= 0.92)) { fehler++; console.log('FEHLER: freie Formulierung "' + t + '" Konfidenz ' + r.konfidenz); }
  n++;
  if (M.match(t, { schwelle: 0.95 }) !== null) { fehler++; console.log('FEHLER: freie Formulierung "' + t + '" ueber Schwelle 0,95'); }
  n++;
}
{
  const e = M.match('Schilde Steuerbord', { schwelle: 0.99 });
  assert(e && e.befehl === 'tech.schild' && e.konfidenz === 1, 'Kanon ueber jeder Schwelle');
  n++;
}

// ---- Laufzeit: ein Abgleich dauert (kalt) deutlich unter 200 ms ----
{
  const t0 = Date.now();
  for (let i = 0; i < 20; i++) M.match('Schilde Steuerbord');
  const ms = (Date.now() - t0) / 20;
  n++;
  if (ms > 200) { fehler++; console.log('FEHLER: match zu langsam: ' + ms + ' ms'); }
  console.log('match: ' + ms.toFixed(1) + ' ms je Aufruf, ' + M.info().muster + ' Sprechformen');
}

// ---- A3 Nacharbeit: Einwort-Form + Phonetik allein ("Kapitaen an Deck" lief auf nav.andocken, Kurzform "Dock an" = nach Fuellwort "dock"):
// Ein Wort, das einem Kanonwort nur ueber Koelner Phonetik zugeordnet wuerde, loest bei Einwort-Formen keinen Befehl aus. Schiffs- und Bruecken-Beinahe-Treffer ----
for (const t of [
  'Kapitän an Deck', 'Mannschaft an Deck', 'Alle Mann an Deck', 'Deck eins', 'Brücke an Deck zwei', 'Techniker an Deck', 'Dek vier',
  'Kai an Deck', 'Lage an Deck', 'Licht an Deck', 'Kapitän auf Deck', 'Ops an Deck', 'Kurzschluss im Deck', 'Deck', 'Schilf am Ufer', 'Schilf',
  'Scanner defekt', 'Scan Ergebnis', 'Stoppschild', 'Schild', 'Schilder', 'Zielscheibe', 'Kursbuch', 'Schubkarre', 'Reparaturkosten',
]) pruefe(t, null);

// ---- A3 Review-Nacharbeit: Gegenteile, Zustandsmeldungen, Lautaehnliches, Fragezeichen (S1), Prototyp-Woerter (S2), mehrteilige Aeusserungen (H1), Wertgrenzen (H2) ----
for (const t of [
  "Feuer Ops",
  "Feuer Opps",
  "Feuer Hops",
  "Feuer oops",
  "Feuer Obs",
  "Abdocken",
  "Abdocken bitte",
  "Ablegen",
  "Abfliegen",
  "Spannen",
  "Scanner",
  "Scanners",
  "Ausreichen",
  "Ausreichend",
  "Ausweichend",
  "Ausweichung",
  "Waffen repariert",
  "Reaktor repariert",
  "Antrieb repariert",
  "Schilde repariert",
  "Lafette eins repariert",
  "Reparatur",
  "Reparaturen",
  "Reaktor überladen?",
  "Feuer frei?",
  "Kurs auf die Basis?",
  "Stopp?",
  "Andocken?",
  "Schilde Bug?",
  "Start",
  "Stopp Start",
  "Schilde rauf",
  "Schilde runter",
  "Schilde hoch",
  "Reaktor an",
  "Reaktor aus",
  "Reaktor hochfahren",
  "Reaktor runterfahren",
  "Kurs weg von der Basis",
  "Kurs weg vom Ziel",
  "Weg von der Basis",
  "Weg vom Ziel",
  "Feuer frei halt",
  "Feuer gelöscht",
  "Feuer ist aus",
  "Antrieb ausgefallen",
  "Schilde ausgefallen",
  "Waffen ausgefallen",
  "Reaktor ausgefallen",
  "Schub minus eins",
  "Schub -1",
  "Schub −2",
  "Schub 7",
  "Schub 10",
  "Schub 99",
  "Stufe sieben",
  "Abstand 0 Meter",
  "Abstand 200000 Meter",
  "Abstand 2,5 Meter",
  "Abstand halten -50 Meter",
  "Abstand halten 100001 Meter",
  "constructor",
  "__proto__",
  "toString",
  "hasOwnProperty",
  "valueOf",
  "isPrototypeOf",
  "Schub constructor",
  "Kurs auf constructor",
  "constructor constructor",
  "Schilde __proto__",
  "Abstand __proto__ Meter",
  "toString Meter",
  "Energie auf Antrieb und Kurs auf das Ziel",
  "Antrieb Energie und Kurs Ziel",
  "Mehr Energie auf Schilde und Kurs auf die Basis",
  "Reaktor reparieren und Schilde Bug",
  "Reaktor reparieren und Antrieb zuerst",
  "Kurs auf die Basis und Schilde Heck",
  "Torpedo klar und Schub drei",
]) { try { pruefe(t, null); } catch (e) { fehler++; console.log('FEHLER: "' + t + '" wirft ' + e.message); } }
// Positivkontrollen: die Verschaerfungen duerfen die richtigen Formen nicht treffen
pruefe('Repariert den Antrieb', b('tech.reparieren', { system: 'engines' }));        // Imperativ Plural vorn bleibt Befehl
pruefe('Antrieb reparieren', b('tech.reparieren', { system: 'engines' }));
pruefe('Andocke', b('nav.andocken'));                                                // Hoerfehler: Auslassen
pruefe('Andcoken', b('nav.andocken'));                                               // Dreher
pruefe('Scannen', b('ops.scan'));
pruefe('Abstand halten 1 Meter', b('nav.abstand', { meter: 1 }));
pruefe('Abstand halten 100000 Meter', b('nav.abstand', { meter: 100000 }));
pruefe('Abstand halten 1.000 Meter', b('nav.abstand', { meter: 1000 }));            // Tausenderpunkt ist keine Dezimalzahl
pruefe('Schub 6', null);                                                              // BOT-01 D: die alten Zahlstufen 0 bis 6 gibt es nicht mehr
pruefe('Schub 0', null);
pruefe('Stufe drei', null);
pruefe('Maschinen aus, Stopp', b('nav.stopp'));
pruefe('Torpedo klar und Feuer frei', null);                                          // Torpedo im unerkannten Teil: Argument des Befehls, nicht raten
// S2: Prototyp-Woerter duerfen nie werfen und nie etwas treffen (alle Lookup-Tabellen ohne Prototyp)
for (const w of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', '__defineGetter__', '__lookupGetter__']) {
  for (const t of [w, 'Schub ' + w, w + ' Meter', 'Abstand halten ' + w + ' Meter', 'Kurs auf ' + w, 'Technik, ' + w, w + ', Stopp', 'Stopp und ' + w, w + ' ' + w]) {
    n++;
    let r;
    try { r = M.match(t); } catch (e) { fehler++; console.log('FEHLER: "' + t + '" wirft ' + e.message); continue; }
    if (r !== null && !/Stopp/.test(t)) { fehler++; console.log('FEHLER: "' + t + '" erwartet null bekommen ' + JSON.stringify(r)); }
  }
}
// Mutationsproben: die Pruefung muss tatsaechlich greifen. Quelltext ohne die Pruefung laden, dann muss mindestens ein Fall kippen.
{
  const quelle = fs.readFileSync(path.join(__dirname, '..', 'shared', 'bot-matcher.js'), 'utf8');
  const lade = (s) => { const m = { exports: {} }; new Function('module', 'require', '__dirname', s)(m, require, path.join(__dirname, '..', 'shared')); return m.exports; };
  const mutiere = (name, teil, faelle, mindestens, nur) => {
    n++;
    let s;
    if (nur === undefined) { if (!quelle.includes(teil)) { fehler++; console.log('FEHLER: Mutation ' + name + ': Pruefung nicht im Quelltext'); return; } s = quelle.split(teil).join(''); }
    else { const stellen = []; for (let p = quelle.indexOf(teil); p >= 0; p = quelle.indexOf(teil, p + 1)) stellen.push(p); if (stellen.length < nur) { fehler++; console.log('FEHLER: Mutation ' + name + ': Stelle fehlt'); return; } const p = stellen[nur - 1]; s = quelle.slice(0, p) + quelle.slice(p + teil.length); }
    const mut = lade(s);
    const kipp = faelle.filter((t) => JSON.stringify(mut.match(t)) !== JSON.stringify(M.match(t)));
    if (kipp.length < mindestens) { fehler++; console.log('FEHLER: Mutation ' + name + ' ueberlebt (nur ' + kipp.length + ' Faelle kippen, erwartet ' + mindestens + ')'); }
  };
  const negFaelle = ['Ausweichen, nicht', 'Andocken, nein', 'Kurs auf die Basis, lass das', 'Kein Feuer frei', 'Nicht ausweichen', 'Lass das Feuer frei'];
  mutiere('Verneinung entfernt (alle Stellen)', 'g.neg.has(t) ||', negFaelle, 3);
  mutiere('Verneinung bei mehrteiligen Aeusserungen entfernt', 'g.neg.has(t) ||', negFaelle, 3, 1);
  mutiere('Fragezeichen-Regel entfernt', "roh.indexOf('?') >= 0 ||", ['Feuer frei?', 'Reaktor überladen?', 'Kurs auf die Basis?', 'Stopp?'], 4);
}

// ---- Eval-Saetze: Kanon-Set Quote 100 % und Falsch-Positiv 0, freie Sets Falsch-Positiv 0 (bot-eval.js --art), Kanon-Set aktuell gegen den Generator ----
{
  const { spawnSync } = require('child_process');
  const lauf = (argv) => spawnSync(process.execPath, argv, { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  const fx = (f) => path.join('tools', 'fixtures', 'bot-eval', f);
  for (const [datei, art] of [['eval-kanon.json', 'kanon'], ['eval.json', 'frei'], ['eval-dev2.json', 'frei']]) {
    n++;
    const r = lauf(['tools/bot-eval.js', fx(datei), '--art', art]);
    const zeile = (r.stdout.match(/^(Trefferquote|Falsch-Positiv).*$/gm) || []).join('; ');
    console.log('bot-eval ' + datei + ' (' + art + '): ' + zeile);
    if (r.status !== 0) { fehler++; console.log('FEHLER: bot-eval ' + datei + ' --art ' + art + ' Exit ' + r.status + ' ' + r.stdout.split(String.fromCharCode(10)).slice(0, 15).join(String.fromCharCode(10))); }
  }
  n++;
  const g = lauf(['tools/gen-eval-kanon.js', '--pruefen']);
  if (g.status !== 0) { fehler++; console.log('FEHLER: ' + (g.stderr || g.stdout).trim()); }
}

if (fehler) { console.log(fehler + ' von ' + n + ' Pruefungen FEHLGESCHLAGEN'); process.exit(1); }
console.log('test-bot-matcher: ' + n + ' Pruefungen gruen (Schwelle ' + M.SCHWELLE + ')');
