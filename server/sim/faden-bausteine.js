'use strict';
// SUND-04a-1 B: Bausteine der Beats. Jeder Beat des Katalogs (content/faeden/beats.json, Feld baustein) nennt einen BENANNTEN Baustein, der spaeter Szene, Funk und Wirkung bedient. In 04a-1 gibt es nur
// die Schnittstelle und je Katalog-Baustein einen PLATZHALTER (er tut nichts ausser ins Regie-Logbuch zu schreiben); die echten Bausteine kommen in 04a-2 und tragen sich mit registriere() ein.
//
// Schnittstelle eines Bausteins:
//   starten(game, faden, ctx) -> { laeuft: true } | { ausgang: 'gelungen' | 'gescheitert' }
//       Der Beat beginnt (Aufrufer: faden.weiterSetzen, nach dem Befehl faden_weiter des Spielleiters). ctx = { vorlage, beat (Beat der Vorlage), katalog (Eintrag aus beats.json), parameter (faden.parameter),
//       nsc (faden.nsc, Kopie zum Lesen) }. `laeuft` heisst: der Baustein meldet den Ausgang spaeter mit faden.beatAusgang(game, faden.id, 'gelungen' | 'gescheitert') (Szene zu Ende, Funk beantwortet,
//       Optionen gewaehlt: faden.optionWaehlen). Meldet er nie, gilt der Beat nach werte.beat_frist Taetigkeiten als gescheitert: nichts blockiert. `ausgang` beendet den Beat sofort.
//       Ein werfender Baustein zaehlt als gescheitert (Fehlerzaehler, Regie-Logbuch), der Faden lebt weiter.
//   Hinweise des Beats (beat.hinweise) und die Enthuellung (nsc.wahrheit.offenbart) setzt faden.js VOR dem Aufruf; der Baustein erzaehlt sie (Scan, Geruecht, Papiere, Funk), er entscheidet sie nicht.
//   Bausteine duerfen den Sim-Zustand nur ueber den Wirkungen-Katalog aendern (nie direkt) und keine Optionen bei Gefahr anbieten (Pruefer).
//
//   registriere(id, baustein)   fuer 04a-2: ersetzt den Platzhalter (Id muss zu einem Katalog-Beat gehoeren)
//   vonId(id) -> Baustein | null       idVon(typ) -> Baustein-Id des Beats `typ`        platzhalter(id) -> Platzhalter (Tests)
const D = require('./faden-daten.js');

const PLATZHALTER = '__platzhalter';
const logbuch = (game, e) => { try { require('./regie-befehle.js').schreibe(game, Object.assign({ art: 'faden_baustein', quelle: 'regie' }, e)); } catch (err) { if (game && game.countError) game.countError('faden-baustein-log', err); } };

function platzhalter(id) {
  return {
    [PLATZHALTER]: true,
    id,
    starten(game, faden, ctx) {
      // B-S1: der Platzhalter zeigt seine Hinweise ausdruecklich (sonst zaehlen sie nicht; die Testvorlage laeuft damit durch)
      const F = require('./faden.js');
      for (const h of ctx.beat.hinweise || []) F.hinweisGezeigt(game, faden.id, h);
      logbuch(game, { ausgang: 'platzhalter', key: id, begruendung: `Baustein ${id} ist in 04a-1 ein Platzhalter (Faden ${faden.id}, Beat ${ctx.beat.id})`, plan: { faden: faden.id, beat: ctx.beat.id } });
      return { laeuft: true };
    },
  };
}

const bausteine = {};
for (const e of Object.values(D.BEATS)) bausteine[e.baustein] = platzhalter(e.baustein);

function registriere(id, baustein) {
  if (!Object.values(D.BEATS).some((e) => e.baustein === id)) throw new Error('Baustein ' + id + ' gehoert zu keinem Beat des Katalogs');
  if (!baustein || typeof baustein.starten !== 'function') throw new Error('Baustein ' + id + ' braucht starten(game, faden, ctx)');
  bausteine[id] = baustein;
}
const vonId = (id) => (Object.prototype.hasOwnProperty.call(bausteine, id) ? bausteine[id] : null);
const idVon = (typ) => (Object.prototype.hasOwnProperty.call(D.BEATS, typ) ? D.BEATS[typ].baustein : null);
const istPlatzhalter = (id) => !!(vonId(id) && vonId(id)[PLATZHALTER]);

registriere('bitte', require('./faden-bitte.js').baustein);   // SUND-04a-2 P2: der erste echte Baustein (Bitten)
const P3 = require('./faden-p3.js');   // SUND-04a-2 P3: Notruf, Enthüllung (Sprengung), Abschluss
registriere('notruf', P3.notruf);
registriere('enthuellung', P3.enthuellung);
registriere('abschluss', P3.abschluss);
const B1 = require('./faden-b1.js');   // SUND-04b B1: Gerücht, Rätsel-Spur, Wiedersehen (Beats ohne Kampfszene)
registriere('geruecht', B1.geruecht);
registriere('spur', B1.spur);
registriere('wiedersehen', B1.wiedersehen);
module.exports = { registriere, vonId, idVon, platzhalter, istPlatzhalter };
