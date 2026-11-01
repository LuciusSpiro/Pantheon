'use strict';
// CHA-01 C: Test der Charakter-Actions (public/js/charaktere.js) mit einem localStorage-Ersatz in Node.
// Anlegen bis 4, fünfter abgelehnt, wählen, löschen (gewählter, letzter → Erststart-Charakter), umbenennen, Altname-Migration, Erststart, kaputter Speicher, Persistenz über „Neuladen“, Erstellung (Entwurf).
// Aufruf: node tools/test-charaktere.js   (Exit 1 bei Fehlern; npm run test:charaktere)   Mutationsprobe: tools/mutation-charaktere.js
const path = require('path');
const fs = require('fs');
const ROOT = process.env.CHARAKTERE_ROOT || path.join(__dirname, '..');
const Ch = require(path.join(ROOT, 'shared', 'charakter.js'));
const Modul = require(path.join(ROOT, 'public', 'js', 'charaktere.js'));
const KAT = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'katalog', 'charakter.json'), 'utf8'));

let fehler = 0, n = 0;
const ok = (b, t) => { n++; if (!b) { fehler++; console.log('FEHLER: ' + t); } };
const gleich = (a, b, t) => ok(JSON.stringify(a) === JSON.stringify(b), t + ' (' + JSON.stringify(a) + ' ≠ ' + JSON.stringify(b) + ')');

// localStorage-Ersatz: Text im Speicher; modus 'ok' | 'kein-lesen' | 'kein-schreiben' (wirft wie ein gesperrter Browser-Speicher)
function speicherErsatz(start) {
  const s = { text: start === undefined ? null : start, modus: 'ok', schreibzaehler: 0 };
  s.lesen = () => { if (s.modus === 'kein-lesen') return null; return s.text; };
  s.schreiben = (t) => { if (s.modus === 'kein-schreiben') return false; s.text = t; s.schreibzaehler++; return true; };
  return s;
}
const neu = (sp, zufall) => { const m = Modul.erzeuge({ speicher: sp, Charakter: Ch, zufall }); m.setzeKatalog(KAT); return m; };
const NAMEN = ['Aurelia', 'Brennus', 'Kaeso', 'Hrolf', 'Cato'];

// ---- Erststart ohne Alles / mit Altname
{
  const sp = speicherErsatz(), m = neu(sp);
  ok(m.lies().bereit && m.lies().liste.length === 0 && m.aktiveKarte() === null, 'leerer Speicher: bereit, keine Liste, keine aktive Karte');
  const r = m.erststart({ altName: null, zufallsName: 'Crew-417' });
  ok(r.ok && r.quelle === 'zufall' && m.aktiverName() === 'Crew-417', 'Erststart ohne alles: Standard-Charakter mit dem Zufallsnamen (Crew-417)');
  gleich(m.aktiveKarte(), Ch.standardKarte('Crew-417', KAT), 'Erststart: Standardaussehen und Standard-Outfit');
  ok(JSON.parse(sp.text).liste.length === 1 && JSON.parse(sp.text).gewaehlt === m.lies().gewaehlt, 'Erststart wird gespeichert und ist gewählt');
  ok(m.erststart({ zufallsName: 'Anders' }).quelle === 'vorhanden' && m.lies().liste.length === 1, 'zweiter Erststart legt nichts an');
}
{
  const m = neu(speicherErsatz());
  const r = m.erststart({ altName: '  Ragnar  ', zufallsName: 'Crew-123' });
  ok(r.ok && r.quelle === 'alt' && m.aktiverName() === 'Ragnar', 'Altname gültig: Charakter mit diesem Namen (getrimmt)');
}
{
  const m = neu(speicherErsatz());
  m.erststart({ altName: 'A<b>', zufallsName: 'Crew-123' });   // „Ab“ nach dem Bereinigen = 2 Zeichen → gültig
  ok(m.aktiverName() === 'Ab', 'Altname mit Sonderzeichen wird bereinigt (<> fliegt raus)');
  const m2 = neu(speicherErsatz());
  m2.erststart({ altName: 'ZuLangerNameHier!', zufallsName: 'Crew-123' });
  ok(m2.aktiverName() === Ch.STANDARD_NAME, 'Altname ungültig (zu lang): STANDARD_NAME, nicht gekürzt');
  const m3 = neu(speicherErsatz());
  m3.erststart({ altName: 'X', zufallsName: 'Crew-123' });
  ok(m3.aktiverName() === Ch.STANDARD_NAME, 'Altname ungültig (1 Zeichen): STANDARD_NAME');
  const m4 = neu(speicherErsatz());
  m4.erststart({ altName: '   ', zufallsName: 'Crew-999' });
  ok(m4.aktiverName() === 'Crew-999', 'Altname leer: wie „gar nichts“ (Zufallsname)');
  const m5 = neu(speicherErsatz());
  m5.erststart({ altName: null, zufallsName: '###' });
  ok(m5.aktiverName() === Ch.STANDARD_NAME, 'Zufallsname verletzt die Regel: STANDARD_NAME');
  const m6 = neu(speicherErsatz());
  ok(m6.uebernimmAltenNamen('Ragnar').ok && !m6.uebernimmAltenNamen('Zweiter').ok && m6.lies().liste.length === 1, 'Altnamen übernehmen nur, solange die Liste leer ist');
}

// ---- Name vor dem Katalog (erstes hello)
{
  const leer = Modul.erzeuge({ speicher: speicherErsatz(), Charakter: Ch });
  ok(leer.vorabName({ altName: null, zufallsName: 'Crew-417' }) === 'Crew-417', 'vorabName ohne alles: Zufallsname');
  ok(leer.vorabName({ altName: 'Ragnar', zufallsName: 'Crew-417' }) === 'Ragnar', 'vorabName mit Altname: der Altname');
  ok(leer.vorabName({ altName: 'ZuLangerNameHier!', zufallsName: 'Crew-417' }) === Ch.STANDARD_NAME, 'vorabName mit ungültigem Altnamen: STANDARD_NAME');
  const sp = speicherErsatz(), m = neu(sp);
  m.legeAn({ name: 'Aurelia' }); const b = m.legeAn({ name: 'Brennus' }).id; m.legeAn({ name: 'Kaeso' }); m.waehle(b);
  const vor = Modul.erzeuge({ speicher: sp, Charakter: Ch });   // Katalog noch nicht geladen
  ok(vor.vorabName({ altName: 'Ragnar', zufallsName: 'Crew-1' }) === 'Brennus', 'vorabName: der gewählte Charakter aus dem Speicher geht vor dem Altnamen');
  vor.setzeKatalog(KAT);
  ok(vor.aktiverName() === 'Brennus', 'derselbe Name nach dem Laden (kein Namenswechsel beim zweiten hello)');
  ok(Modul.erzeuge({ speicher: speicherErsatz('{{müll'), Charakter: Ch }).vorabName({ altName: 'Ragnar' }) === 'Ragnar', 'vorabName bei kaputtem Speicher: wie ohne');
}

// ---- Anlegen bis 4, Auswahl, Löschen
{
  const sp = speicherErsatz(), m = neu(sp);
  const ids = [];
  for (let i = 0; i < 4; i++) {
    const r = m.legeAn({ name: NAMEN[i], frisur: i % 2 ? 'zoepfe' : 'dutt', gesicht: i > 1 ? 'narbe' : 'lerche', bart: i === 3 ? 'vollbart' : 'keiner', haut: i, haar: 3 - i });
    ok(r.ok && typeof r.id === 'string', 'anlegen ' + (i + 1));
    ids.push(r.id);
    ok(m.lies().gewaehlt === r.id, 'neuer Charakter ist gewählt (' + (i + 1) + ')');
  }
  const f = m.legeAn({ name: 'Fuenfter' });
  ok(!f.ok && f.grund === 'voll' && m.lies().liste.length === 4, 'fünfter wird abgelehnt (Rückgabe, kein Wurf), Liste bleibt bei 4');
  ok(!m.beginneNeu().ok && m.beginneNeu().grund === 'voll', 'auch die Erstellung öffnet bei 4 nicht');
  const k = m.lies().liste[3].karte;
  ok(k.bart === 'vollbart' && k.haut === 3 && k.haar === 0 && k.gesicht === 'narbe' && k.frisur === 'zoepfe', 'Aussehen aus den sechs Feldern übernommen');
  gleich(k.outfit, Ch.standardKarte('x', KAT).outfit, 'Standard-Outfit bei jedem neuen Charakter');
  ok(m.waehle(ids[1]).ok && m.lies().gewaehlt === ids[1] && m.aktiverName() === NAMEN[1], 'wählen');
  ok(!m.waehle('gibtsnicht').ok && m.lies().gewaehlt === ids[1], 'unbekannte id wählen: abgelehnt, Auswahl bleibt');
  // Neuladen: neues Modul, gleicher Speicher
  const m2 = neu(sp, () => 0.5);
  gleich(m2.lies().liste.map((c) => c.karte.name), NAMEN.slice(0, 4), 'Neuladen: alle vier da, gleiche Reihenfolge');
  ok(m2.lies().gewaehlt === ids[1], 'Neuladen: Auswahl bleibt');
  gleich(m2.lies().liste.map((c) => c.karte), m.lies().liste.map((c) => c.karte), 'Neuladen: Karten unverändert');
  // Löschen des gewählten wählt einen anderen
  ok(m2.loesche(ids[1]).ok && m2.lies().liste.length === 3 && m2.lies().gewaehlt && m2.lies().gewaehlt !== ids[1] && m2.aktiverName(), 'gewählten löschen: ein anderer wird gewählt');
  const noch = m2.lies().liste.map((c) => c.id);
  ok(!noch.includes(ids[1]) && noch.includes(m2.lies().gewaehlt), 'der gewählte nach dem Löschen steht in der Liste');
  ok(m2.loesche(ids[3]).ok && m2.lies().gewaehlt !== ids[3], 'nicht gewählten löschen lässt die Auswahl');
  ok(!m2.loesche('gibtsnicht').ok && m2.lies().liste.length === 2, 'unbekannte id löschen: abgelehnt');
  // nach dem Löschen ist wieder Platz
  ok(m2.legeAn({ name: 'Neuer' }).ok && m2.lies().liste.length === 3, 'nach dem Löschen wieder anlegen');
  // letzten löschen: es gilt der Erststart – ein Standard-Charakter mit Zufallsname ist gewählt und gespeichert
  const rest = m2.lies().liste.map((c) => c.id);
  let letzte;
  for (const id of rest) letzte = m2.loesche(id);
  ok(letzte.ok && typeof letzte.ersatz === 'string', 'letzten löschen: Rückgabe nennt den Ersatz-Charakter');
  ok(m2.lies().liste.length === 1 && m2.lies().gewaehlt === letzte.ersatz && !rest.includes(letzte.ersatz), 'letzten löschen: genau ein neuer Charakter, gewählt');
  gleich(m2.aktiveKarte(), Ch.standardKarte('Crew-550', KAT), 'Ersatz: Standardaussehen, Zufallsname nach der Namensregel (Crew-550 bei zufall 0.5)');
  ok(Ch.pruefeName(m2.aktiverName()) === m2.aktiverName() && m2.lies().sitzung.cursor === 0, 'Ersatzname erfüllt die Namensregel, Cursor auf Platz 1');
  ok(JSON.parse(sp.text).liste.length === 1 && JSON.parse(sp.text).gewaehlt === letzte.ersatz, 'Ersatz wird gespeichert');
  // einen von mehreren löschen legt nichts an
  m2.legeAn({ name: 'Zwei' }); const vorher = m2.lies().liste.length; m2.loesche(m2.lies().liste[0].id);
  ok(m2.lies().liste.length === vorher - 1 && !m2.loesche('gibtsnicht').ersatz, 'nicht der letzte: kein Ersatz');
  // ohne Zufallsquelle im Test: echter Zufall liefert trotzdem einen gültigen Namen
  const mz = neu(speicherErsatz()); mz.legeAn({ name: 'Eins' }); mz.loesche(mz.lies().gewaehlt);
  ok(/^Crew-\d{3}$/.test(mz.aktiverName()), 'Zufallsname hat die Form Crew-NNN: ' + mz.aktiverName());
}

// ---- Umbenennen
{
  const sp = speicherErsatz(), m = neu(sp);
  const id = m.legeAn({ name: 'Aurelia', haut: 2 }).id;
  ok(m.benenneUm(id, 'Livia').ok && m.aktiverName() === 'Livia', 'umbenennen gültig');
  ok(m.lies().liste[0].karte.haut === 2, 'Umbenennen ändert das Aussehen nicht');
  for (const schlecht of ['', 'A', 'DreizehnZeichen', '<>', null, 42, {}]) {
    const r = m.benenneUm(id, schlecht);
    ok(!r.ok && r.grund === 'name' && m.aktiverName() === 'Livia', 'umbenennen ungültig (' + JSON.stringify(schlecht) + ') abgelehnt, Name bleibt');
  }
  ok(m.benenneUm(id, 'Zwölf Zeichen').ok === false && m.benenneUm(id, 'Zwoelf Zeich').ok, '12 Zeichen gehen, 13 nicht');
  ok(!m.benenneUm('gibtsnicht', 'Livia').ok, 'unbekannte id umbenennen: abgelehnt');
  ok(neu(sp).aktiverName() === 'Zwoelf Zeich', 'Umbenennen bleibt über Neuladen');
  ok(!m.legeAn({ name: 'X' }).ok && m.legeAn({ name: 'X' }).grund === 'name' && m.lies().liste.length === 1, 'anlegen mit ungültigem Namen abgelehnt');
}

// ---- kaputter Speicher
{
  const kaputt = [
    ['JSON-Müll', '{{{ nicht json'], ['null', 'null'], ['Zahl', '42'], ['Array', '[1,2,3]'], ['String', '"hallo"'], ['liste kein Array', JSON.stringify({ v: 1, liste: 'x' })],
    ['liste Objekt', JSON.stringify({ v: 1, liste: { a: 1 } })], ['Einträge falsche Typen', JSON.stringify({ v: 1, gewaehlt: 5, liste: [1, null, 'x', [], { id: 7, karte: {} }, { id: '', karte: {} }, { id: 'a b', karte: {} }, { karte: {} }] })],
  ];
  for (const [t, text] of kaputt) {
    const m = neu(speicherErsatz(text));
    ok(m.lies().bereit && m.lies().liste.length === 0 && m.lies().gewaehlt === null, 'kaputter Speicher (' + t + '): leere Liste, bereit');
    ok(m.erststart({ altName: 'Ragnar' }).ok && m.aktiverName() === 'Ragnar', 'kaputter Speicher (' + t + '): Erststart läuft');
  }
  // zehn Einträge: höchstens vier
  const zehn = { v: 1, gewaehlt: 'e9', liste: Array.from({ length: 10 }, (_, i) => ({ id: 'e' + i, karte: Ch.standardKarte('Spieler' + i, KAT) })) };
  const m10 = neu(speicherErsatz(JSON.stringify(zehn)));
  ok(m10.lies().liste.length === 4 && m10.lies().liste.map((c) => c.id).join() === 'e0,e1,e2,e3', '10 Einträge: nur die ersten vier');
  ok(m10.lies().gewaehlt === 'e0', 'gewählt außerhalb der ersten vier: erste Karte wird gewählt');
  // doppelte ids
  const dop = neu(speicherErsatz(JSON.stringify({ v: 1, gewaehlt: 'a', liste: [{ id: 'a', karte: Ch.standardKarte('Eins', KAT) }, { id: 'a', karte: Ch.standardKarte('Zwei', KAT) }] })));
  ok(dop.lies().liste.length === 1 && dop.aktiverName() === 'Eins', 'doppelte id: nur die erste zählt');
  // gewaehlt unbekannt
  const unb = neu(speicherErsatz(JSON.stringify({ v: 1, gewaehlt: 'zzz', liste: [{ id: 'a', karte: Ch.standardKarte('Eins', KAT) }, { id: 'b', karte: Ch.standardKarte('Zwei', KAT) }] })));
  ok(unb.lies().gewaehlt === 'a', 'gewählt unbekannt: erste Karte');
  // manipulierte Karte wird geprüft
  const boese = { v: 1, gewaehlt: 'a', liste: [{ id: 'a', karte: { name: '<script>alert(1)</script>', gesicht: '../../x', frisur: 5, bart: { x: 1 }, haut: 99, haar: -1, koerper: 'riese', outfit: { kopf: 'gibtsnicht', umhang: 7 }, __proto__: { x: 1 }, extra: 'x' } }] };
  const mb = neu(speicherErsatz(JSON.stringify(boese)));
  const kb = mb.lies().liste[0].karte;
  gleich(kb, Ch.pruefeKarte(boese.liste[0].karte, KAT), 'manipulierte Karte: durch pruefeKarte geprüft');
  ok(kb.gesicht === 'lerche' && kb.frisur === 'dutt' && kb.bart === 'keiner' && kb.haut === 0 && kb.haar === 0 && kb.koerper === 'standard' && kb.extra === undefined, 'manipulierte Karte: Felder zum Standard, Fremdfelder weg');
  ok(/^[\p{L}\p{N} -]{2,12}$/u.test(kb.name), 'manipulierter Name bereinigt: ' + kb.name);
  // Speicher nicht lesbar / nicht schreibbar
  const sl = speicherErsatz(JSON.stringify({ v: 1, gewaehlt: 'a', liste: [{ id: 'a', karte: Ch.standardKarte('Eins', KAT) }] })); sl.modus = 'kein-lesen';
  ok(neu(sl).lies().liste.length === 0, 'Speicher nicht lesbar: leere Liste');
  const ss = speicherErsatz(); ss.modus = 'kein-schreiben';
  const ms = neu(ss);
  const r = ms.legeAn({ name: 'Ragnar' });
  ok(r.ok && ms.aktiverName() === 'Ragnar' && ms.lies().speicherOk === false, 'Speicher nicht schreibbar: Charakter gilt für diese Sitzung, speicherOk false, kein Wurf');
  const fake = { localStorage: { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } } };
  const bs = Modul.browserSpeicher(fake);
  ok(bs.lesen() === null && bs.schreiben('x') === false, 'browserSpeicher fängt Zugriffsfehler ab');
  // ohne Katalog
  const mk = Modul.erzeuge({ speicher: speicherErsatz(), Charakter: Ch });
  ok(!mk.lies().bereit && !mk.legeAn({ name: 'Ragnar' }).ok && mk.aktiveKarte() === null && !mk.setzeKatalog(null).ok, 'ohne Katalog: nicht bereit, nichts wird angelegt');
  const sp0 = speicherErsatz('ALT'), mk2 = Modul.erzeuge({ speicher: sp0, Charakter: Ch }); mk2.legeAn({ name: 'Ragnar' });
  ok(sp0.text === 'ALT', 'ohne Katalog wird der Speicher nie überschrieben');
}

// ---- Abonnenten: Wechsel der aktiven Karte (Client setzt Client.karte und sendet hello)
{
  const m = Modul.erzeuge({ speicher: speicherErsatz(), Charakter: Ch });
  const gesehen = [];
  m.abonniere((k) => gesehen.push(k && k.name));
  m.setzeKatalog(KAT);
  ok(gesehen.length === 0, 'leerer Speicher: kein Wechsel gemeldet');
  const a = m.legeAn({ name: 'Aurelia' }).id, b = m.legeAn({ name: 'Brennus' }).id;
  m.waehle(a); m.waehle(a); m.benenneUm(a, 'Livia'); m.loesche(b);
  gleich(gesehen, ['Aurelia', 'Brennus', 'Aurelia', 'Livia'], 'Wechsel und Umbenennen melden, Wiederholung und Löschen eines anderen nicht');
  m.loesche(a);
  ok(gesehen.length === 5 && /^Crew-\d{3}$/.test(gesehen[4]), 'letzter gelöscht: Wechsel auf den Ersatz-Charakter gemeldet, nie auf „keiner“ (der Server behielte sonst die alte Karte)');
  ok(!gesehen.includes(null), 'Lauscher bekam nie null');
}

// ---- Liste: Cursor, Übernehmen, Löschen mit Rückfrage
{
  const m = neu(speicherErsatz());
  const ids = ['Aurelia', 'Brennus'].map((nm) => m.legeAn({ name: nm }).id);
  ok(m.oeffneListe().ok && m.lies().sitzung.seite === 'liste' && m.lies().sitzung.cursor === 1, 'Liste öffnet mit dem Cursor auf dem gewählten');
  m.setzeCursor(0);
  ok(m.uebernimm().ok && m.lies().gewaehlt === ids[0], 'Enter übernimmt den Charakter unter dem Cursor');
  m.setzeCursor(3);
  ok(!m.uebernimm().ok && m.uebernimm().grund === 'frei' && m.lies().gewaehlt === ids[0], 'Enter auf freiem Platz wählt nichts');
  gleich([m.bewegeCursor(1), m.bewegeCursor(1)].map((r) => r.cursor), [0, 1], 'Cursor läuft ringförmig über vier Plätze');
  m.setzeCursor(0);
  const r1 = m.loeschenAnfrage();
  ok(!r1.ok && r1.grund === 'gefragt' && m.lies().liste.length === 2 && m.lies().sitzung.loeschFrage === ids[0], 'Löschen: erster Druck fragt nur');
  m.setzeCursor(1);
  ok(m.lies().sitzung.loeschFrage === null, 'Cursor weg: Rückfrage verfällt');
  m.setzeCursor(0); m.loeschenAnfrage();
  ok(m.loeschenAnfrage().ok && m.lies().liste.length === 1 && m.lies().gewaehlt === ids[1], 'Löschen: zweiter Druck löscht, Auswahl wechselt');
  m.setzeCursor(0); m.loeschenAnfrage(); m.loeschenAbbrechen();
  ok(m.loeschenAnfrage().grund === 'gefragt' && m.lies().liste.length === 1, 'Rückfrage abgebrochen: wieder erst fragen');
  m.setzeCursor(2); ok(!m.loeschenAnfrage().ok && m.lies().liste.length === 1, 'Löschen auf freiem Platz: nichts');
}

// ---- Erstellung (Entwurf) und Umbenennen über die Oberfläche
{
  const sp = speicherErsatz(), m = neu(sp);
  ok(m.beginneNeu().ok && m.lies().sitzung.seite === 'erstellung', 'Erstellung öffnet');
  let e = m.lies().sitzung.entwurf;
  ok(e.modus === 'neu' && e.nameEdit && e.platz === 'frisur' && e.name === '', 'Entwurf: Namensfeld aktiv, Platz Frisur, leerer Name');
  ok(!m.speichereEntwurf().ok && m.lies().sitzung.entwurf.hinweis === 'name' && m.lies().sitzung.entwurf.nameEdit && m.lies().liste.length === 0, 'Speichern ohne Namen: Hinweis, Namensfeld offen, nichts angelegt');
  for (const z of 'Ha<n>s 7!') m.nameZeichen(z);
  ok(e.name === 'Hans 7', 'Namenszeichen gefiltert (<>! fliegen raus): ' + e.name);
  for (const z of 'abcdefghijklmnop') m.nameZeichen(z);
  ok(Array.from(e.name).length === Ch.NAME_MAX, 'Name höchstens ' + Ch.NAME_MAX + ' Zeichen');
  while (e.name.length) m.nameLoeschen();
  for (const z of 'Hrolf') m.nameZeichen(z);
  ok(m.nameFertig().ok && !e.nameEdit, 'Enter im Namensfeld beendet das Schreiben');
  m.nameBearbeiten(true); m.nameLoeschen(); ok(e.name === 'Hrol', 'F2 schaltet das Schreiben wieder an'); m.nameZeichen('f'); m.nameFertig();
  ok(m.waehlePlatz('bart').ok && e.platz === 'bart' && !m.waehlePlatz('kopf').ok && e.platz === 'bart', 'Plätze: nur die fünf der Erstellung');
  m.blaettere(1); ok(e.karte.bart === 'vollbart', 'Bart blättern');
  m.blaettere(1); ok(e.karte.bart === 'keiner', 'blättern ist ringförmig');
  m.blaettere(-1); ok(e.karte.bart === 'vollbart', 'zurückblättern');
  m.naechsterPlatz(1); ok(e.platz === 'haar', 'nächster Platz nach Bart: Haarfarbe');
  m.setzeWahl('haar', 2); m.waehlePlatz('haut'); m.blaettere(-1); m.blaettere(-1);
  ok(e.karte.haar === 2 && e.karte.haut === 2, 'Farben: Haar 2, Haut 0 → zweimal zurück = 2');
  m.waehlePlatz('frisur'); m.blaettere(1); m.waehlePlatz('gesicht'); m.blaettere(1);
  ok(e.karte.frisur === 'zoepfe' && e.karte.gesicht === 'narbe', 'Frisur und Gesicht blättern');
  m.dreheFigur(1); m.dreheFigur(1); ok(e.yaw === 90, 'Figur drehen');
  const vorSpeichern = m.entwurfKarte();
  ok(vorSpeichern.name === 'Hrolf' && vorSpeichern.outfit.oberteil === 'bordtunika', 'Karte der Figur im Fenster: Entwurf mit Standard-Outfit');
  m.zuruecksetzen();
  e = m.lies().sitzung.entwurf;
  ok(e.name === '' && e.karte.haar === 0 && e.karte.frisur === 'dutt' && e.platz === 'frisur' && e.nameEdit, 'R setzt den Entwurf auf Standard zurück');
  for (const z of 'Hrolf') m.nameZeichen(z);
  m.nameFertig(); m.waehlePlatz('bart'); m.blaettere(1); m.waehlePlatz('haut'); m.setzeWahl('haut', 3);
  ok(m.speichereEntwurf().ok && m.lies().liste.length === 1 && m.lies().sitzung.seite === 'liste', 'Enter speichert und geht zurück in die Liste');
  const k = m.lies().liste[0].karte;
  ok(k.name === 'Hrolf' && k.bart === 'vollbart' && k.haut === 3 && m.lies().gewaehlt === m.lies().liste[0].id, 'neuer Charakter gespeichert und gewählt');
  // Umbenennen
  m.setzeCursor(0);
  ok(m.beginneUmbenennen().ok && m.lies().sitzung.entwurf.modus === 'umbenennen' && m.lies().sitzung.entwurf.name === 'Hrolf', 'F2 öffnet das Umbenennen mit dem Namen');
  ok(!m.waehlePlatz('bart').ok && !m.blaettere(1).ok, 'Umbenennen: Aussehen nicht änderbar (kein Platz, kein Blättern)');
  m.nameLoeschen(); m.nameLoeschen(); m.nameLoeschen(); m.nameLoeschen(); m.nameLoeschen();
  ok(!m.speichereEntwurf().ok && m.lies().sitzung.entwurf.hinweis === 'name' && m.lies().liste[0].karte.name === 'Hrolf', 'Umbenennen mit leerem Namen: Hinweis, Name bleibt');
  for (const z of 'Ragnar') m.nameZeichen(z);
  ok(m.speichereEntwurf().ok && m.aktiverName() === 'Ragnar' && m.lies().liste[0].karte.bart === 'vollbart', 'Umbenennen speichert nur den Namen');
  m.beginneUmbenennen(); m.nameZeichen('x'); m.verwirfEntwurf();
  ok(m.aktiverName() === 'Ragnar' && m.lies().sitzung.seite === 'liste', 'Esc verwirft');
  m.setzeCursor(2); ok(!m.beginneUmbenennen().ok, 'Umbenennen auf freiem Platz: nichts');
  ok(neu(sp).aktiverName() === 'Ragnar', 'alles bleibt über Neuladen');
}

// ---- Outfit bleibt erhalten (Spind in Paket D schreibt es; Liste, Umbenennen und Wählen dürfen es nie zurücksetzen)
{
  const OUTFIT = { kopf: 'bordhelm', umhang: 'fellumhang' };
  const karte = Ch.pruefeKarte(Object.assign(Ch.standardKarte('Aurelia', KAT), { haut: 2, outfit: Object.assign({}, Ch.standardKarte('x', KAT).outfit, OUTFIT) }), KAT);
  ok(karte.outfit.kopf === 'bordhelm' && karte.outfit.umhang === 'fellumhang', 'Vorbedingung: Nicht-Standard-Outfit übersteht pruefeKarte');
  const standardOutfit = Ch.standardKarte('x', KAT).outfit;
  ok(JSON.stringify(karte.outfit) !== JSON.stringify(standardOutfit), 'Vorbedingung: Outfit weicht vom Standard ab');
  const stand = () => JSON.stringify({ v: 1, gewaehlt: 'a', liste: [{ id: 'a', karte }, { id: 'b', karte: Ch.standardKarte('Zweiter', KAT) }] });
  const sp = speicherErsatz(stand()), m = neu(sp);
  gleich(m.lies().liste[0].karte.outfit, karte.outfit, 'Laden: Outfit unverändert');
  const ohneName = (k) => JSON.stringify(Object.assign({}, k, { name: '' }));
  ok(m.benenneUm('a', 'Livia').ok, 'benenneUm');
  gleich(m.lies().liste[0].karte.outfit, karte.outfit, 'benenneUm: Outfit bleibt');
  ok(m.waehle('b').ok && m.waehle('a').ok, 'waehle (hin und zurück)');
  gleich(m.lies().liste[0].karte.outfit, karte.outfit, 'waehle: Outfit bleibt');
  gleich(m.aktiveKarte().outfit, karte.outfit, 'aktive Karte (geht ins hello) trägt das Outfit');
  // Umbenennen über den Entwurf
  m.oeffneListe(); m.setzeCursor(0);
  ok(m.beginneUmbenennen().ok, 'F2'); m.nameLoeschen(); m.nameZeichen('a');
  const vorEntwurf = JSON.stringify(m.lies().liste[0].karte);
  ok(!m.setzeWahl('haut', 0).ok && !m.setzeWahl('frisur', 1).ok && !m.waehlePlatz('bart').ok && !m.naechsterPlatz(1).ok && !m.blaettere(1).ok, 'Umbenennen: setzeWahl/waehlePlatz/naechsterPlatz/blaettere lehnen ab');
  ok(m.lies().sitzung.entwurf.karte.haut === 2 && m.lies().sitzung.entwurf.karte.frisur === karte.frisur, 'Umbenennen: Aussehen im Entwurf unverändert');
  gleich(m.lies().sitzung.entwurf.karte.outfit, karte.outfit, 'Umbenennen: Outfit im Entwurf unverändert');
  ok(m.speichereEntwurf().ok, 'Umbenennen speichert');
  gleich(m.lies().liste[0].karte.outfit, karte.outfit, 'speichereEntwurf (umbenennen): Outfit bleibt');
  ok(ohneName(m.lies().liste[0].karte) === ohneName(JSON.parse(vorEntwurf)), 'speichereEntwurf (umbenennen): nur der Name hat sich geändert');
  // Neuladen
  const m2 = neu(sp);
  gleich(m2.lies().liste[0].karte.outfit, karte.outfit, 'Neuladen: Outfit bleibt');
  gleich(m2.lies().liste[0].karte, m.lies().liste[0].karte, 'Neuladen: ganze Karte gleich');
  // Neu-Erstellung bleibt Standard-Outfit (der Spind kommt später), ändert das Outfit anderer nicht
  m2.beginneNeu(); for (const z of 'Neu') m2.nameZeichen(z); m2.nameFertig(); m2.setzeWahl('haut', 1);
  ok(m2.speichereEntwurf().ok, 'neue Erstellung');
  gleich(m2.lies().liste[2].karte.outfit, standardOutfit, 'Erstellung: neuer Charakter trägt das Standard-Outfit');
  gleich(m2.lies().liste[0].karte.outfit, karte.outfit, 'Erstellung: Outfit des anderen bleibt');
}

// ---- Eingaben im Schreibmodus und Liste als Actions (die Oberfläche bildet nur Tasten darauf ab)
{
  const m = neu(speicherErsatz());
  // Enter im Schreibmodus: Neu -> nur Schreiben beenden (Name gültig) / Hinweis (Name ungültig); Umbenennen -> speichern
  m.beginneNeu();
  ok(!m.nameBestaetigen().ok && m.lies().sitzung.entwurf.hinweis === 'name' && m.lies().sitzung.entwurf.nameEdit && m.lies().liste.length === 0, 'nameBestaetigen (neu, leer): Hinweis, Schreiben bleibt an, nichts gespeichert');
  for (const z of 'Ragnar') m.nameZeichen(z);
  ok(m.nameBestaetigen().ok && !m.lies().sitzung.entwurf.nameEdit && m.lies().liste.length === 0 && m.lies().sitzung.seite === 'erstellung', 'nameBestaetigen (neu, gültig): Schreiben aus, noch nicht gespeichert');
  // Esc im Schreibmodus: Neu mit Name -> nur Schreiben beenden, Neu ohne Name -> verwerfen
  m.nameBearbeiten(true);
  ok(m.nameAbbrechen().ok && !m.lies().sitzung.entwurf.nameEdit && m.lies().sitzung.seite === 'erstellung' && m.lies().sitzung.entwurf.name === 'Ragnar', 'nameAbbrechen (neu, mit Namen): Schreiben aus, Entwurf bleibt');
  m.nameBearbeiten(true); while (m.lies().sitzung.entwurf.name.length) m.nameLoeschen();
  ok(m.nameAbbrechen().ok && m.lies().sitzung.seite === 'liste' && m.lies().sitzung.entwurf === null, 'nameAbbrechen (neu, ohne Namen): Entwurf verworfen, zurück in die Liste');
  ok(m.nameAbbrechen().grund === 'kein-entwurf' && m.nameBestaetigen().grund === 'kein-entwurf', 'ohne Entwurf: abgelehnt, kein Wurf');
  // Umbenennen
  const id = m.legeAn({ name: 'Hrolf' }).id; m.oeffneListe(); m.setzeCursor(0);
  m.beginneUmbenennen(); m.nameLoeschen(); m.nameLoeschen(); m.nameLoeschen(); m.nameLoeschen(); m.nameLoeschen();
  ok(!m.nameBestaetigen().ok && m.lies().sitzung.entwurf.hinweis === 'name' && m.aktiverName() === 'Hrolf' && m.lies().sitzung.seite === 'erstellung', 'nameBestaetigen (umbenennen, leer): Hinweis, Name bleibt');
  for (const z of 'Sven') m.nameZeichen(z);
  ok(m.nameBestaetigen().ok && m.aktiverName() === 'Sven' && m.lies().sitzung.seite === 'liste', 'nameBestaetigen (umbenennen, gültig): speichert und zurück in die Liste');
  m.beginneUmbenennen(); m.nameZeichen('x');
  ok(m.nameAbbrechen().ok && m.aktiverName() === 'Sven' && m.lies().sitzung.seite === 'liste' && m.lies().sitzung.entwurf === null, 'nameAbbrechen (umbenennen): verwirft, Name bleibt');
  // Enter in der Liste: übernehmen oder (freier Platz) neu anlegen
  m.legeAn({ name: 'Zwei' });
  m.oeffneListe(); m.setzeCursor(0);
  const r1 = m.uebernimmOderNeu();
  ok(r1.ok && r1.aktion === 'uebernommen' && r1.id === id && m.lies().gewaehlt === id && m.lies().sitzung.seite === 'liste', 'uebernimmOderNeu (belegt): übernimmt');
  m.setzeCursor(3);
  const r2 = m.uebernimmOderNeu();
  ok(r2.ok && r2.aktion === 'neu' && m.lies().sitzung.seite === 'erstellung' && m.lies().sitzung.entwurf.modus === 'neu' && m.lies().gewaehlt === id, 'uebernimmOderNeu (frei): öffnet die Erstellung, wählt nichts');
  m.verwirfEntwurf();
  // alle Plätze belegt: Meldung 'voll' im Store, keine Erstellung
  m.legeAn({ name: 'Drei' }); m.legeAn({ name: 'Vier' });
  m.oeffneListe(); m.setzeCursor(2);
  ok(m.lies().sitzung.meldung === null, 'keine Meldung vorab');
  const r3 = m.neuAnlegen();
  ok(!r3.ok && r3.grund === 'voll' && m.lies().sitzung.seite === 'liste' && m.lies().sitzung.meldung && m.lies().sitzung.meldung.grund === 'voll' && typeof m.lies().sitzung.meldung.zeit === 'number', 'neuAnlegen bei vier Charakteren: Meldung voll im Store, Liste bleibt');
  ok(m.neuAnlegen().grund === 'voll', 'wiederholt dasselbe');
  m.loesche(m.lies().liste[3].id); m.oeffneListe();
  ok(m.neuAnlegen().ok && m.lies().sitzung.seite === 'erstellung', 'mit freiem Platz öffnet die Erstellung');
}

// ---- Speicherfehler ist im Store sichtbar (Oberfläche zeigt die Meldung in der Charakterliste)
{
  const sp = speicherErsatz(), m = neu(sp);
  ok(m.lies().speicherOk === true, 'Speicher ok: speicherOk true');
  m.legeAn({ name: 'Eins' });
  ok(m.lies().speicherOk === true && sp.schreibzaehler === 1, 'Schreiben gelingt: speicherOk bleibt true');
  sp.modus = 'kein-schreiben';
  const r = m.legeAn({ name: 'Zwei' });
  ok(r.ok && m.lies().speicherOk === false && m.lies().liste.length === 2, 'Schreiben scheitert: speicherOk false, Charakter gilt für die Sitzung');
  const rev = m.lies().rev;
  m.benenneUm(m.lies().gewaehlt, 'Zwei B');
  ok(m.lies().speicherOk === false && m.lies().rev > rev, 'bleibt false, solange es scheitert');
  m.loesche(m.lies().liste[0].id);
  ok(m.lies().speicherOk === false, 'auch nach Löschen noch false');
  sp.modus = 'ok';
  m.waehle(m.lies().gewaehlt);
  ok(m.lies().speicherOk === true, 'Schreiben gelingt wieder: speicherOk true');
  // Ersatz-Charakter im kaputten Speicher
  const sp2 = speicherErsatz(); sp2.modus = 'kein-schreiben';
  const m2 = neu(sp2); m2.legeAn({ name: 'Solo' }); m2.loesche(m2.lies().gewaehlt);
  ok(m2.lies().liste.length === 1 && m2.lies().speicherOk === false, 'letzten löschen bei Speicherfehler: Ersatz da, speicherOk false');
}

// ---- CHA-01 D: Spind (speichereOutfit ist der einzige Schreibweg für outfit)
{
  const gesendet = [];
  const sp = speicherErsatz(), m = Modul.erzeuge({ speicher: sp, Charakter: Ch, sende: (o) => gesendet.push(o) });
  m.setzeKatalog(KAT);
  ok(m.oeffneSpind().ok === false && m.speichereOutfit().grund === 'kein-entwurf' && !gesendet.length, 'Spind ohne Charakter: nichts öffnet, nichts wird gesendet');
  const a = m.legeAn({ name: 'Aurelia', frisur: 'zoepfe' }).id, b = m.legeAn({ name: 'Brennus' }).id;
  const vorherA = JSON.stringify(m.lies().liste.find((c) => c.id === a).karte);
  ok(m.oeffneSpind().ok && m.lies().sitzung.seite === 'spind' && m.lies().sitzung.entwurf.modus === 'spind', 'Spind öffnet einen Entwurf (modus spind)');
  gleich(m.lies().sitzung.entwurf.karte.outfit, Ch.standardKarte('x', KAT).outfit, 'Entwurf = getragenes Outfit des gewählten Charakters');
  gleich(m.OUTFIT_PLAETZE, ['kopf', 'oberteil', 'hose', 'schuhe', 'haende', 'umhang'], 'sechs Outfit-Plätze, keine Charakterplätze');
  ok(m.outfitTeileFuer('kopf').length === 2 && m.outfitTeileFuer('gesicht').length === 0 && m.outfitTeileFuer('haut').length === 0, 'Teile je Outfit-Platz aus dem Katalog; Charakterplätze liefern nichts');
  // Anprobe ändert nur den Entwurf
  ok(m.spindWaehlePlatz('kopf').ok && m.spindBlaettere(1).ok && m.lies().sitzung.entwurf.karte.outfit.kopf === 'bordhelm', 'Blättern wählt das nächste Teil des Platzes (Anprobe)');
  ok(m.aktiveKarte().outfit.kopf === 'keine' && !gesendet.length, 'Anprobe speichert nichts und sendet nichts');
  ok(m.spindBlaettere(1).ok && m.lies().sitzung.entwurf.karte.outfit.kopf === 'keine' && m.spindBlaettere(-1).ok && m.lies().sitzung.entwurf.karte.outfit.kopf === 'bordhelm', 'Blättern ist ringförmig');
  m.spindWaehlePlatz('umhang'); m.spindSetzeWahl('umhang', 1);
  ok(m.lies().sitzung.entwurf.karte.outfit.umhang === 'fellumhang' && m.spindWahlIndex('umhang') === 1, 'Umhang Fellumhang in der Anprobe');
  ok(m.spindZeile(1, 5).ok === false && m.spindZeile(-1, 5).ok === false && m.lies().sitzung.entwurf.karte.outfit.umhang === 'fellumhang', 'Zeile weiter ohne Teil dort: nichts ändert sich');
  ok(m.spindNaechsterPlatz(1).ok && m.lies().sitzung.entwurf.platz === 'kopf' && m.spindNaechsterPlatz(-1).ok && m.lies().sitzung.entwurf.platz === 'umhang', 'Platzwechsel ringförmig über die sechs Plätze');
  ok(!m.spindWaehlePlatz('gesicht').ok && !m.spindWaehlePlatz('haar').ok && !m.spindSetzeWahl('frisur', 0).ok && !m.spindSetzeWahl('haut', 0).ok, 'Charakterplätze sind im Spind nicht wählbar');
  // R: zurück auf getragen
  m.spindZuruecksetzen();
  gleich(m.lies().sitzung.entwurf.karte.outfit, m.aktiveKarte().outfit, 'R: zurück auf das getragene Outfit');
  m.spindWaehlePlatz('kopf'); m.spindSetzeWahl('kopf', 1); m.spindWaehlePlatz('umhang'); m.spindSetzeWahl('umhang', 1);
  // Anziehen
  const schreib = sp.schreibzaehler;
  const r = m.speichereOutfit();
  ok(r.ok && r.gespeichert === true, 'Anziehen gelingt');
  const kb = m.lies().liste.find((c) => c.id === b).karte, ka = m.lies().liste.find((c) => c.id === a);
  ok(kb.outfit.kopf === 'bordhelm' && kb.outfit.umhang === 'fellumhang' && kb.outfit.oberteil === 'bordtunika', 'Outfit landet im GEWÄHLTEN Charakter (Brennus)');
  ok(JSON.stringify(ka.karte) === vorherA, 'der andere Charakter bleibt byteweise gleich');
  gleich(Object.assign({}, kb, { outfit: null }), Object.assign({}, Ch.pruefeKarte({ name: 'Brennus' }, KAT), { outfit: null }), 'Charakterteil (Name, Gesicht, Frisur, Bart, Farben, Körper) bleibt unverändert');
  ok(sp.schreibzaehler === schreib + 1 && JSON.parse(sp.text).liste.find((c) => c.id === b).karte.outfit.kopf === 'bordhelm', 'Anziehen speichert genau einmal in den Speicher');
  ok(gesendet.length === 1 && gesendet[0].kopf === 'bordhelm' && gesendet[0].umhang === 'fellumhang' && Object.keys(gesendet[0]).length === 6, 'Anziehen sendet das geprüfte Outfit (6 Plätze) an den Server');
  ok(m.lies().sitzung.entwurf.hinweis === 'angezogen' && m.lies().sitzung.seite === 'spind', 'danach bleibt der Spind offen mit Hinweis „angezogen“');
  // nach Neuladen
  const m2 = Modul.erzeuge({ speicher: sp, Charakter: Ch, sende: () => {} }); m2.setzeKatalog(KAT);
  ok(m2.aktiveKarte().outfit.kopf === 'bordhelm' && m2.aktiveKarte().outfit.umhang === 'fellumhang' && m2.aktiverName() === 'Brennus', 'nach Neuladen sind Outfit und Name erhalten');
  // Charakterwechsel und Umbenennen erhalten das Outfit weiter
  m2.waehle(a); m2.waehle(b); m2.benenneUm(b, 'Brennus2');
  ok(m2.aktiveKarte().outfit.kopf === 'bordhelm', 'waehle/benenneUm erhalten das angezogene Outfit');
  // ungültige Teile → Standard (aus Entwurf manipuliert)
  m.oeffneSpind();
  const e = m.lies().sitzung.entwurf;
  e.karte.name = 'Hacker'; e.karte.gesicht = 'gibtsnicht'; e.karte.frisur = 'keine'; e.karte.haut = 2; e.karte.haar = 1; e.karte.koerper = 'riese';   // Charakterteil im Entwurf manipuliert: darf nie ankommen
  const charakterVor = JSON.stringify(Object.assign({}, m.aktiveKarte(), { outfit: null }));
  e.karte.outfit.kopf = 'gibtsnicht'; e.karte.outfit.oberteil = 'fellumhang'; e.karte.outfit.hose = 42; e.karte.outfit.schuhe = null; delete e.karte.outfit.haende;
  gesendet.length = 0;
  m.speichereOutfit();
  const o = m.aktiveKarte().outfit;
  ok(o.kopf === 'keine' && o.oberteil === 'bordtunika' && o.hose === 'bordhose' && o.schuhe === 'bordstiefel' && o.haende === 'keine' && o.umhang === 'fellumhang', 'ungültige/fremde/fehlende Teile werden zum Standard, gültige bleiben (' + JSON.stringify(o) + ')');
  ok(gesendet.length === 1 && gesendet[0].kopf === 'keine', 'gesendet wird das geprüfte, nicht das rohe Outfit');
  ok(JSON.stringify(Object.assign({}, m.aktiveKarte(), { outfit: null })) === charakterVor, 'Name, Gesicht, Frisur, Farben, Körper aus einem manipulierten Entwurf kommen nicht in den Charakter');
  // Schließen
  ok(m.schliesseSpind().ok && m.lies().sitzung.seite === null && m.lies().sitzung.entwurf === null && !m.speichereOutfit().ok, 'Schließen verwirft den Entwurf; ohne Entwurf schreibt nichts');
  // ohne Speicher: gilt trotzdem
  sp.modus = 'kein-schreiben'; m.oeffneSpind(); m.spindWaehlePlatz('kopf'); m.spindSetzeWahl('kopf', 1); gesendet.length = 0;
  const rf = m.speichereOutfit();
  ok(rf.ok && rf.gespeichert === false && m.lies().speicherOk === false && m.aktiveKarte().outfit.kopf === 'bordhelm' && gesendet.length === 1, 'Speicher kaputt: Outfit gilt für die Sitzung und geht an den Server, speicherOk false');
  // nicht freie Teile (Händler, Fund): anprobieren ja, anziehen nein
  {
    const kat2 = JSON.parse(JSON.stringify(KAT)); kat2.teile.find((t) => t.id === 'kopf/bordhelm').herkunft = 'haendler';
    const sp3 = speicherErsatz(), gs = [], m4 = Modul.erzeuge({ speicher: sp3, Charakter: Ch, sende: (o) => gs.push(o) }); m4.setzeKatalog(kat2); m4.legeAn({ name: 'Cato' }); m4.oeffneSpind();
    ok(JSON.stringify(m4.spindGesperrteHerkuenfte('kopf')) === '["haendler"]' && m4.spindGesperrteHerkuenfte('umhang').length === 0 && m4.spindGesperrteHerkuenfte('gibtsnicht').length === 0, 'Legende: Platz kopf hat eine Händlerzeile, Umhang keine gesperrte, unbekannter Platz leer');
    kat2.teile.find((t) => t.id === 'kopf/keine').herkunft = 'haendler';
    ok(JSON.stringify(m4.spindGesperrteHerkuenfte('kopf')) === '["haendler"]', 'Legende: zwei Händlerteile im Platz, die Zeile steht nur einmal');
    kat2.teile.find((t) => t.id === 'kopf/keine').herkunft = 'frei';
    kat2.teile.find((t) => t.id === 'kopf/bordhelm').herkunft = 'frei';
    ok(m4.spindGesperrteHerkuenfte('kopf').length === 0, 'Legende: alles frei, keine Zeile H oder F');
    kat2.teile.find((t) => t.id === 'kopf/bordhelm').herkunft = 'haendler'; kat2.teile.find((t) => t.platz === 'oberteil').herkunft = 'fund';
    ok(JSON.stringify(m4.spindGesperrteHerkuenfte('oberteil')) === '["fund"]', 'Legende: Platz oberteil hat nur eine Fundzeile');
    kat2.teile.find((t) => t.platz === 'oberteil').herkunft = 'frei';
    m4.spindWaehlePlatz('kopf'); m4.spindSetzeWahl('kopf', 1);
    const rg = m4.speichereOutfit();
    ok(!rg.ok && rg.grund === 'gesperrt' && m4.aktiveKarte().outfit.kopf === 'keine' && !gs.length && m4.lies().sitzung.entwurf.hinweis === 'gesperrt', 'Händlerteil: Anprobe ja, Anziehen abgelehnt, nichts gespeichert, nichts gesendet');
    m4.spindSetzeWahl('kopf', 0); m4.spindWaehlePlatz('umhang'); m4.spindSetzeWahl('umhang', 1);
    ok(m4.speichereOutfit().ok && m4.aktiveKarte().outfit.umhang === 'fellumhang', 'freie Teile lassen sich weiter anziehen');
    // CHA-01 F: Kacheln mit eigenem Kopf (Spind: Platz kopf, Erstellung: Platz frisur), sonst feste Vorschau
    {
      const vorher = JSON.stringify(m4.aktiveKarte()), kk = m4.kachelKarte('spind', 'kopf', 'kopf/bordhelm');
      ok(kk && kk.outfit.kopf === 'bordhelm' && kk.outfit.umhang === 'fellumhang' && kk.frisur === m4.aktiveKarte().frisur && kk.name === 'Cato', 'Spind-Kachel kopf: eigene Karte mit dem Teil auf dem Kopf');
      ok(JSON.stringify(m4.aktiveKarte()) === vorher, 'Spind-Kachel ändert die getragene Karte nicht');
      ok(m4.kachelKarte('spind', 'oberteil', 'oberteil/bordtunika') === null && m4.kachelKarte('spind', 'umhang', 'umhang/keiner') === null, 'Spind-Kacheln anderer Plätze bleiben feste Vorschau');
      ok(m4.kachelKarte('spind', 'kopf', 'oberteil/bordtunika') === null && m4.kachelKarte('neu', 'kopf', 'kopf/bordhelm') === null, 'Kachel: Teil gehört nicht zum Platz / Platz hat in der Erstellung keine Livekachel');
      const sp6 = speicherErsatz(), m6 = Modul.erzeuge({ speicher: sp6, Charakter: Ch, sende: () => {} }); m6.setzeKatalog(KAT); m6.legeAn({ name: 'Cato' }); m6.beginneNeu();
      const ev = JSON.stringify(m6.entwurfKarte()), fr = m6.teileFuer('frisur'), kf = m6.kachelKarte('neu', 'frisur', fr[fr.length - 1].id);
      ok(kf && kf.frisur === fr[fr.length - 1].id.slice('frisur/'.length) && kf.gesicht === m6.entwurfKarte().gesicht && kf.haar === m6.entwurfKarte().haar && kf.name === m6.entwurfKarte().name, 'Erstellungs-Kachel frisur: Entwurf mit dem Frisur-Teil');
      ok(JSON.stringify(m6.entwurfKarte()) === ev, 'Erstellungs-Kachel ändert den Entwurf nicht');
      ok(m6.kachelKarte('neu', 'bart', 'bart/vollbart') === null && m6.kachelKarte('neu', 'gesicht', 'gesicht/narbe') === null && m6.kachelKarte('spind', 'frisur', fr[0].id) === null, 'Erstellung: nur Frisur hat Livekacheln, im Spind nur Kopf');
    }
  }
  // Anziehen ist kein Charakterwechsel (kein hello im Client), zieht aber den Client-Stand über den Outfit-Kanal nach
  {
    const sp5 = speicherErsatz(), gs5 = [], m5 = Modul.erzeuge({ speicher: sp5, Charakter: Ch, sende: (o) => gs5.push(o) });
    const wechsel = [], outfits = [];
    m5.abonniere((k) => wechsel.push(k && k.name)); m5.abonniereOutfit((k) => outfits.push(k));
    m5.setzeKatalog(KAT); m5.legeAn({ name: 'Cato' });
    const nachAnlegen = wechsel.length;
    m5.oeffneSpind(); m5.spindWaehlePlatz('kopf'); m5.spindSetzeWahl('kopf', 1);
    ok(m5.speichereOutfit().ok, 'Anziehen (Lauscher-Test) gelingt');
    ok(wechsel.length === nachAnlegen, 'Anziehen meldet keinen Charakterwechsel (sonst ginge ein volles hello an den Server)');
    ok(outfits.length === 1 && outfits[0].outfit.kopf === 'bordhelm' && outfits[0].name === 'Cato' && gs5.length === 1, 'Outfit-Lauscher kommt genau einmal mit der neuen Karte, der Server bekommt genau eine Meldung');
    m5.waehle(m5.lies().gewaehlt);
    ok(wechsel.length === nachAnlegen, 'ein späteres waehle derselben Karte meldet nichts (gemerkter Stand ist aktuell)');
    m5.benenneUm(m5.lies().gewaehlt, 'Cato2');
    ok(wechsel.length === nachAnlegen + 1 && wechsel[wechsel.length - 1] === 'Cato2', 'Umbenennen meldet weiter einen Wechsel');
    // schon getragen: nichts speichern, nichts senden, nichts melden
    const schreib5 = sp5.schreibzaehler;
    const r5 = m5.speichereOutfit();
    ok(r5.ok && r5.geaendert === false && sp5.schreibzaehler === schreib5 && gs5.length === 1 && outfits.length === 1 && m5.lies().sitzung.entwurf.hinweis === 'angezogen', 'unverändertes Outfit anziehen: kein Speichern, kein Senden, kein Melden');
    m5.spindZuruecksetzen(); m5.spindWaehlePlatz('umhang'); m5.spindSetzeWahl('umhang', 1);
    ok(m5.speichereOutfit().geaendert === true && gs5.length === 2 && outfits.length === 2, 'geändertes Outfit geht danach wieder durch');
  }
  // Spind vor dem Katalog geöffnet: Wunsch wird gemerkt und beim Eintreffen des Katalogs eingelöst (Zeichnen öffnet nichts)
  {
    const m6 = Modul.erzeuge({ speicher: speicherErsatz(), Charakter: Ch, sende: () => {} });
    ok(m6.oeffneSpind().ok === false && m6.lies().sitzung.entwurf === null, 'vor dem Katalog: Spind öffnet nicht');
    m6.setzeKatalog(KAT);
    ok(m6.lies().sitzung.seite === null, 'ohne Wunsch passiert beim Katalog nichts');
    const m7 = Modul.erzeuge({ speicher: speicherErsatz(), Charakter: Ch, sende: () => {} });
    m7.oeffneSpind(); m7.setzeKatalog(KAT); ok(m7.lies().sitzung.seite === null, 'Katalog da, aber noch kein Charakter: Wunsch bleibt gemerkt'); m7.legeAn({ name: 'Cato' });
    ok(m7.lies().sitzung.seite === 'spind' && m7.lies().sitzung.entwurf && m7.lies().sitzung.entwurf.modus === 'spind' && !m7.lies().sitzung.spindWartet, 'Wunsch vor dem Katalog: Spind öffnet, sobald der Katalog da ist');
    const m8 = Modul.erzeuge({ speicher: speicherErsatz(), Charakter: Ch, sende: () => {} });
    m8.oeffneSpind(); m8.schliesseSpind(); m8.setzeKatalog(KAT); m8.legeAn({ name: 'Cato' });
    ok(m8.lies().sitzung.seite === null, 'Spind zwischendurch geschlossen: kein Nachziehen mehr');
  }
  // andere Wege schreiben das Outfit nicht: Entwurf der Erstellung ändert nichts am Outfit des Charakters
  const m3 = neu(speicherErsatz()); m3.legeAn({ name: 'Cato' }); m3.oeffneListe(); m3.beginneNeu(); m3.setzeWahl('frisur', 1);
  ok(!m3.spindSetzeWahl('kopf', 1).ok && !m3.spindBlaettere(1).ok && m3.aktiveKarte().outfit.kopf === 'keine', 'Spind-Actions greifen nicht in einen Erstellungs-Entwurf');
}

// ---- feste Texte der Oberfläche: jede Glyphe existiert in art.js (sonst zeichnet das Spiel ein Kästchen)
{
  const ui = fs.readFileSync(path.join(ROOT, 'public', 'js', 'kammer-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  const von = ui.indexOf('const TEXT = {'), bis = ui.indexOf('\n  };', von);
  const TEXT = Function('return ' + ui.slice(von + 'const TEXT = '.length, bis + 4))();
  const art = fs.readFileSync(path.join(ROOT, 'public', 'js', 'art.js'), 'utf8').replace(/\r\n/g, '\n');
  const gBlock = art.slice(art.indexOf('var GLYPHS = {') + 'var GLYPHS = '.length);
  const GLYPHEN = Function('return ' + gBlock.slice(0, gBlock.indexOf('\n  };') + 4))();
  const texte = [];
  const sammle = (o) => { if (typeof o === 'string') texte.push(o); else if (o && typeof o === 'object') Object.values(o).forEach(sammle); };
  sammle(TEXT);
  const fehlend = new Set();
  for (const t of texte) for (const ch of t.replace(/\{\w+\}/g, '')) if (ch !== ' ' && GLYPHEN[ch] === undefined && GLYPHEN[ch.toUpperCase()] === undefined) fehlend.add(ch);
  ok(texte.length > 20 && !fehlend.size, 'Zeichen ohne Glyphe in art.js (kammer-ui.js, ' + texte.length + ' Texte): ' + [...fehlend].join(' '));
}

console.log(fehler ? `${fehler} von ${n} Prüfungen fehlgeschlagen` : `Alle ${n} Prüfungen bestanden`);
process.exit(fehler ? 1 : 0);
