'use strict';
// EK4 (CONTRACT-EK4): Bausteine der Flotte als Registry-Plugin. Laufzeit: server/sim/flotte.js.
//   flotte_aufstellen { tag*, kind?, name?, npc?, von?, huelle?, modus?, ersatz? }   Verbündeten erscheinen lassen (scripted); ein verlorenes Schiff nur mit ersatz
//   flotte_modus      { tag?, modus*, punkt?, leine?, tempo? }                       Regiebuch bewegt Verbündete: halten | folgen | ziel (Reaktion „die Fulminata stößt nach“)
//   flotte_befehl     { art*, schiff?, ziel?, n?, punkte?, radius?, frist?, sprecher?, text? }   Befehl des Legaten als Szenenziel (fünf Arten) + Funkspruch
//   flotte_wellen     { wellen*, takt?, rest?, ziel?, richtung?, ueberdruck?, tag? }   Welle um Welle (Gruppen „kind:n,kind:n|…“); nach abgelaufener Frist Überdruck
//   flotte_neustart   {}                                                              Szene von vorn: Gegner weg, Wellen und Befehl neu, lebende Verbündete repariert
//   flotte_erinnerung { sprecher? }                                                   Der Legat erinnert sich (befolgt | eigenmächtig | im Stich gelassen) per Funk
//   befehl_erfuellt { art? } · befehl_gescheitert { grund? } · befehl_laeuft { art? }   Prüfungen zum Befehl
//   wellen_fertig · schiff_verloren { tag } · legat_erinnert { art } · flotte_ziel_erreicht { tag }
// Punkte (punkte, punkt): west|ost|nord|sued|mitte|station|dock|lerche|vorn|achtern oder „x,y“, mehrere mit „;“. Nur am Ort des Schritts wirksam.
function flotte() { return require('../../sim/flotte.js'); }
const atLoc = (m) => !(m.step && m.step.loc && m.game.ship.scene !== m.step.loc);
const ARTEN = ['ausschalten', 'eskortieren', 'durchbrechen', 'zurueckfallen', 'entlastung'];
const ALLY_KINDS = ['korvette', 'fregatte', 'kreuzer', 'raider'];

module.exports = (Registry) => {
  Registry.define({ id: 'flotte_aufstellen', art: 'aktion', effekt: 'gegner', ereignisse: ['escortSpawn', 'allySpawn'],
    beschreibung: 'Verbündeten (NSC-Schiff Roms) im Raum erscheinen lassen. In EK4a bewegt ihn das Regiebuch (flotte_modus), er feuert nicht; Gegner dürfen ihn anvisieren (ziel: verbuendet|auto), er fällt wie jedes Schiff (Hilferuf, Funkspruch, Kapsel, Verlust im Weltstand). Ein im Feldzug verlorenes Schiff kommt nicht zurück, außer mit ersatz: true (Ersatz nur über eine Aufgabe).',
    params: { tag: { typ: 'ship', pflicht: true }, kind: { typ: 'string', werte: ALLY_KINDS }, name: { typ: 'string' }, npc: { typ: 'npc' }, von: { typ: 'string' },
      huelle: { typ: 'number', min: 1, max: 100 }, modus: { typ: 'string', werte: ['halten', 'folgen'] }, ersatz: { typ: 'bool' } },
    run(m, a) {
      if (!atLoc(m)) return;
      const g = m.game; const d = (m.def && m.def.besetzung && m.def.besetzung.schiffe && m.def.besetzung.schiffe[a.tag]) || {};
      const es = flotte().aufstellen(g, { tag: a.tag, kind: a.kind || d.kind, name: a.name != null ? m.tpl(a.name) : (d.name != null ? m.tpl(d.name) : undefined),
        npc: a.npc || d.npc || null, von: a.von, huelle: a.huelle, modus: a.modus, ersatz: !!a.ersatz });
      if (!es && !flotte().verloren(g, a.tag)) g.countError('mission-hook', new Error(`flotte_aufstellen: ${a.tag} nicht angelegt`));
    } });
  Registry.define({ id: 'flotte_modus', art: 'aktion', ereignisse: [],
    beschreibung: 'Verbündete bewegen (Regiebuch, nicht KI): modus halten (bremst), folgen (Formation hinter der Lerche) oder ziel (fliegt zum Punkt und hält; leine = wartet, wenn die Lerche weiter zurückfällt). Ohne tag alle Verbündeten. Das ist der Weg für Wendungen wie „die Fulminata stößt nach“.',
    params: { tag: { typ: 'ship' }, modus: { typ: 'string', pflicht: true, werte: ['halten', 'folgen', 'ziel'] }, punkt: { typ: 'string' },
      leine: { typ: 'number', min: 100, max: 2000 }, tempo: { typ: 'number', min: 0.1, max: 1 } },
    run(m, a) {
      if (!atLoc(m)) return;
      const o = {}; if (a.leine != null) o.leine = a.leine; if (a.tempo != null) o.tempo = a.tempo;
      if (!flotte().modus(m.game, a.tag == null ? null : a.tag, a.modus, a.punkt, o)) m.game.countError('mission-hook', new Error(`flotte_modus: ${a.tag || 'alle'} ${a.modus} nicht gesetzt`));
    } });
  Registry.define({ id: 'flotte_befehl', art: 'aktion', ereignisse: ['befehlErteilt', 'befehlErfuellt', 'befehlGescheitert'],
    beschreibung: 'Befehl des Legaten als Szenenziel: ausschalten (ziel = Tag oder Klasse, n Abschüsse), eskortieren (schiff erreicht die punkte, wartet an der Leine), durchbrechen / zurueckfallen (die Lerche erreicht die punkte), entlastung (n Abschüsse, solange die Lerche höchstens radius px vom schiff entfernt ist). Fortschritt nur durch erreichte Ziele; frist s (0 = keine) -> gescheitert, ebenso Schiff verloren und Notfallprotokoll. Der Funkspruch kommt vom sprecher (Standard legat, mit Porträt); ohne text der Standardtext der Befehlsart.',
    params: { art: { typ: 'string', pflicht: true, werte: ARTEN }, schiff: { typ: 'ship' }, ziel: { typ: 'string' }, n: { typ: 'number', min: 1, max: 30 }, punkte: { typ: 'string' },
      radius: { typ: 'number', min: 40, max: 1500 }, frist: { typ: 'number', min: 0, max: 900 }, sprecher: { typ: 'npc' }, text: { typ: 'text' } },
    run(m, a) {
      if (!atLoc(m)) return;
      const F = flotte(); const g = m.game;
      const b = F.befehl(g, { art: a.art, schiff: a.schiff, ziel: a.ziel, n: a.n, punkte: a.punkte, radius: a.radius, frist: a.frist, sprecher: a.sprecher });
      if (!b) { g.countError('mission-hook', new Error(`flotte_befehl: ${a.art} nicht erteilt (Wegpunkte/Ziel fehlen?)`)); return; }
      const sp = a.sprecher || 'legat';
      const txt = a.text != null ? m.tpl(a.text) : F.texte().befehle && F.texte().befehle[a.art];
      if (txt) m.radio(m.npcName(sp), txt, false, sp);
    } });
  Registry.define({ id: 'flotte_wellen', art: 'aktion', effekt: 'gegner', ereignisse: ['enemySpawn', 'welleKommt', 'wellenFertig'],
    beschreibung: 'Welle um Welle: wellen = Gruppen „kind:n,kind:n“ mit | getrennt (z. B. „raider:3|raider:2,korvette:1“). Die nächste Gruppe kommt, wenn höchstens rest Gegner der vorigen leben oder takt s um sind. Ziel der Gegner: lerche | verbuendet | auto. Läuft die Frist eines Befehls ab, kommt Überdruck (ueberdruck, Standard an): alle paar Sekunden die letzte Gruppe noch einmal – die Szene darf scheitern, der Feldzug nicht.',
    params: { wellen: { typ: 'string', pflicht: true }, takt: { typ: 'number', min: 0, max: 300 }, rest: { typ: 'number', min: 0, max: 10 }, ziel: { typ: 'string', werte: ['lerche', 'verbuendet', 'auto', 'schuetzling'] },
      richtung: { typ: 'string', werte: ['vorn', 'achtern', 'alle'] }, ueberdruck: { typ: 'bool' }, tag: { typ: 'string' } },
    run(m, a) {
      if (!atLoc(m)) return;
      if (!flotte().wellenStart(m.game, { wellen: a.wellen, takt: a.takt, rest: a.rest, ziel: a.ziel, richtung: a.richtung, ueberdruck: a.ueberdruck, tag: a.tag })) m.game.countError('mission-hook', new Error('flotte_wellen: keine Gruppen'));
    } });
  Registry.define({ id: 'flotte_neustart', art: 'aktion', effekt: 'gegner', ereignisse: ['flotteNeustart'],
    beschreibung: 'Szene von vorn: alle Gegner weg, Wellen und Befehl beginnen neu, lebende Verbündete werden repariert, die Lerche hat mindestens 60 % Hülle. Zerstörte Schiffe bleiben verloren.',
    params: {},
    run(m) { if (atLoc(m)) flotte().neustart(m.game); } });
  Registry.define({ id: 'flotte_erinnerung', art: 'aktion', ereignisse: [],
    beschreibung: 'Der Legat erinnert sich per Funk an die Crew: Befehle befolgt, eigenmächtig gehandelt oder einen Verbündeten im Stich gelassen (Texte aus content/flotte/funktexte.json; ohne Eintrag im Gedächtnis kommt nichts).',
    params: { sprecher: { typ: 'npc' } },
    run(m, a) {
      const F = flotte(); const t = F.erinnerungText(m.game);
      const sp = a.sprecher || 'legat';
      if (t) m.radio(m.npcName(sp), t, false, sp);
    } });

  Registry.define({ id: 'befehl_erfuellt', art: 'pruefung', beschreibung: 'Der laufende Befehl des Legaten (optional dieser art) ist erfüllt',
    params: { art: { typ: 'string', werte: ARTEN } }, test: (m, a) => flotte().erfuellt(m.game, a.art) });
  Registry.define({ id: 'befehl_gescheitert', art: 'pruefung', beschreibung: 'Der Befehl ist gescheitert (optional Grund: zeit | schiff | notfall)',
    params: { grund: { typ: 'string', werte: ['zeit', 'schiff', 'notfall'] } }, test: (m, a) => flotte().gescheitert(m.game, a.grund) });
  Registry.define({ id: 'befehl_laeuft', art: 'pruefung', beschreibung: 'Ein Befehl (optional dieser art) läuft noch',
    params: { art: { typ: 'string', werte: ARTEN } }, test: (m, a) => flotte().laeuft(m.game, a.art) });
  Registry.define({ id: 'wellen_fertig', art: 'pruefung', beschreibung: 'Alle Gruppen von flotte_wellen sind gekommen und erledigt (ohne Überdruck)',
    params: {}, test: (m) => flotte().wellenFertig(m.game) });
  Registry.define({ id: 'schiff_verloren', art: 'pruefung', beschreibung: 'Der Verbündete ist in dieser Szene zerstört worden bzw. gilt im Feldzug als verloren (Weltstand-Fakt flotte_<tag>)',
    params: { tag: { typ: 'ship', pflicht: true } },
    test: (m, a) => { const E = require('../../sim/escort.js'); return E.stateOf(m.game, a.tag) === 'zerstoert' || flotte().verloren(m.game, a.tag); } });
  Registry.define({ id: 'legat_erinnert', art: 'pruefung', beschreibung: 'Das Gedächtnis des Legaten enthält diese Art (befolgt | eigenmaechtig | im_stich) – Flags legat_befolgt, legat_eigenmaechtig, legat_im_stich',
    params: { art: { typ: 'string', pflicht: true, werte: ['befolgt', 'eigenmaechtig', 'im_stich'] } },
    test: (m, a) => !!(m.flags && m.flags['legat_' + (a.art === 'im_stich' ? 'im_stich' : a.art)]) });
  Registry.define({ id: 'flotte_ziel_erreicht', art: 'pruefung', beschreibung: 'Der Verbündete hat den Punkt seines Skripts (flotte_modus ziel) erreicht',
    params: { tag: { typ: 'ship', pflicht: true } },
    test: (m, a) => { const es = require('../../sim/escort.js').find(m.game, a.tag); return !!(es && es.ally && es.skript && es.skript.modus === 'ziel' && es.skript.erreicht); } });
};
