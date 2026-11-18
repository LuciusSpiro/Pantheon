'use strict';
// BOT-04 A1: Selbsttest des Bot-Matchers (shared/bot-matcher.js, content/bots/muster.json). In-process, ohne Server.
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
  ['Stufe drei', b('nav.schub', { stufe: 3 })],
  ['Schub 2', b('nav.schub', { stufe: 2 })],
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
pruefe('Schub nul', b('nav.schub', { stufe: 0 }));
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
  const roh = fs.readFileSync(path.join(__dirname, '..', 'content', 'bots', 'muster.json'), 'utf8');
  assert(!/"(hex|objekt):/.test(roh), 'muster.json enthaelt hex:/objekt: als Argument');
  n++;
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
  const klein = { befehle: { 'nav.stopp': { an: 'navigation', muster: ['halt die klappe'] } }, fuellwoerter: [] };
  M.setzeMuster(klein);
  assert(M.match('Halt die Klappe') && M.match('Halt die Klappe').befehl === 'nav.stopp');
  assert.strictEqual(M.match('Alle Maschinen stopp'), null);
  assert.throws(() => M.setzeMuster(null));
  M.setzeMuster(roh);
  assert(M.match('Alle Maschinen stopp').befehl === 'nav.stopp');
  n += 4;
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
    assert(info.befehle[k] > 0, 'kein Muster fuer ' + k);
    assert(imTest.has(k), 'kein Testfall fuer ' + k);
  }
  assert.deepStrictEqual(Object.keys(info.befehle).sort(), katalog.slice().sort(), 'Muster mit Befehlen ausserhalb des Katalogs (nav.sprung ist nicht sprechbar)');
  assert(!info.befehle['nav.sprung'], 'nav.sprung darf kein Sprachmuster haben');
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
    ['Schub null', 'stufe', 0], ['Schub eins', 'stufe', 1], ['Halbe Kraft voraus', 'stufe', 'halb'], ['Volle Kraft voraus', 'stufe', 'voll'],
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

// ---- Laufzeit: ein Abgleich dauert (kalt, 5000+ Muster) deutlich unter 200 ms ----
{
  const t0 = Date.now();
  for (let i = 0; i < 20; i++) M.match('Schilde Steuerbord');
  const ms = (Date.now() - t0) / 20;
  n++;
  if (ms > 200) { fehler++; console.log('FEHLER: match zu langsam: ' + ms + ' ms'); }
  console.log('match: ' + ms.toFixed(1) + ' ms je Aufruf, ' + M.info().muster + ' expandierte Muster');
}

if (fehler) { console.log(fehler + ' von ' + n + ' Pruefungen FEHLGESCHLAGEN'); process.exit(1); }
console.log('test-bot-matcher: ' + n + ' Pruefungen gruen (Schwelle ' + M.SCHWELLE + ')');
