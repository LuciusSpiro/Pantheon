// TRA-01 C: Abzeichen der Trainingsübungen – Speichern, Lesen und Melden im Browser. Ein Abzeichen ist ein Achievement OHNE Wirkung:
// nichts im Spiel liest es, nichts sperrt sich daran; gezeigt wird es nur im Trainingsmenü (MenueFluss.abzeichenStand liest von hier).
// Storage-Teil (diese Datei, Globales `Abzeichen`, in Node als Modul für tools/test-training-abzeichen.js):
//   lesen()             -> { v, liste: [{ id, variante?, zeit }] }  defensiv: kein Speicher, Wurf, kaputtes JSON, falsche Version → leerer Stand; unbekannte Ids fallen heraus
//   setzen(id, variante) -> true, wenn gespeichert; unbekannte Id → false; jeder Speicherzugriff in try/catch (ohne localStorage läuft alles normal)
//   erreicht(id), varianten(id), stand(id), ueberblick()   Abfragen für die Anzeige; Captain: beide Varianten (tafel, sprache) zählen als „Captain“ erreicht
//   beiEreignis(ev)     Server-Ereignis EVT_ABZEICHEN { id, variante? }: speichern + genau eine Meldung im HUD (Hinweis); anmelden(net, kind) hängt es an Net.onEvent
//   istOdaZeile(text)   die ODA-Zeile des Servers „Abzeichen erreicht: …“ – client.js blendet sie aus, damit die Meldung nicht doppelt erscheint
// Schlüssel `pantheon.abzeichen`, JSON { v: 1, liste: [...] }; die Darstellung steht in menue-ui.js (abzeichenFeld), die Regeln des Menüs in menue.js.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.Abzeichen = api.erzeuge({
      speicher: () => root.localStorage,
      melde: (text) => { const H = root.Hud, R = root.Render; if (H && typeof H.pushNotice === 'function') H.pushNotice(text, R && R.PAL ? R.PAL.amber : undefined, 6); },
    });
    if (root.Net && typeof root.Net.onEvent === 'function') root.Abzeichen.anmelden(root.Net, (root.Shared_Protocol && root.Shared_Protocol.EVT_ABZEICHEN) || 'abzeichen');
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KEY = 'pantheon.abzeichen';
  const VERSION = 1;
  const NAMEN = { fliegen: 'Fliegen', captain: 'Captain' };
  const VARIANTEN = { captain: ['tafel', 'sprache'] };   // Reihenfolge der Anzeige; Fliegen hat keine
  const MELDUNG = { praefix: 'Abzeichen erreicht: ', variante: { tafel: 'Befehlstafel', sprache: 'mit Sprache' } };   // wie die ODA-Zeile des Servers (training.js ABZEICHEN)

  const bekannt = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(NAMEN, id);
  const varianteOk = (id, v) => !!(VARIANTEN[id] && VARIANTEN[id].includes(v));
  const leer = () => ({ v: VERSION, liste: [] });
  const istOdaZeile = (text) => typeof text === 'string' && text.startsWith(MELDUNG.praefix);

  function erzeuge(opt) {
    opt = opt || {};
    const speicher = () => (typeof opt.speicher === 'function' ? opt.speicher() : opt.speicher) || null;
    const jetzt = () => (typeof opt.jetzt === 'function' ? opt.jetzt() : Date.now());

    // roher Text → bereinigter Stand (rein)
    function bereinige(roh) {
      let o = null;
      try { o = JSON.parse(roh); } catch (e) { return leer(); }
      if (!o || typeof o !== 'object' || o.v !== VERSION || !Array.isArray(o.liste)) return leer();
      const s = leer();
      for (const e of o.liste) {
        if (!e || typeof e !== 'object' || !bekannt(e.id)) continue;
        const eintrag = { id: e.id, zeit: Number.isFinite(e.zeit) ? e.zeit : 0 };
        if (varianteOk(e.id, e.variante)) eintrag.variante = e.variante;
        if (!s.liste.some((x) => x.id === eintrag.id && x.variante === eintrag.variante)) s.liste.push(eintrag);
      }
      return s;
    }
    function lesen() {
      let roh = null;
      try { const sp = speicher(); roh = sp ? sp.getItem(KEY) : null; } catch (e) { roh = null; }
      return bereinige(roh);
    }
    function setzen(id, variante) {
      if (!bekannt(id)) return false;
      const s = lesen();
      const v = varianteOk(id, variante) ? variante : undefined;
      if (s.liste.some((x) => x.id === id && x.variante === v)) return true;   // schon erreicht: die erste Zeit bleibt
      const eintrag = { id, zeit: jetzt() }; if (v) eintrag.variante = v;
      s.liste.push(eintrag);
      try { const sp = speicher(); if (!sp) return false; sp.setItem(KEY, JSON.stringify(s)); return true; } catch (e) { return false; /* privater Modus, Speicher voll */ }
    }
    const ausStand = (s, id) => {
      const mine = s.liste.filter((x) => x.id === id);
      return mine.length ? { varianten: (VARIANTEN[id] || []).filter((v) => mine.some((x) => x.variante === v)) } : false;
    };
    const erreicht = (id) => !!ausStand(lesen(), id);
    const varianten = (id) => { const r = ausStand(lesen(), id); return r ? r.varianten : []; };
    const stand = (id) => (bekannt(id) ? ausStand(lesen(), id) : false);
    // alle Abzeichen mit EINEM Lesen: { fliegen: false | { varianten: [] }, captain: … }
    function ueberblick() { const s = lesen(), r = {}; for (const id of Object.keys(NAMEN)) r[id] = ausStand(s, id); return r; }

    function meldung(id, variante) { return MELDUNG.praefix + NAMEN[id] + (varianteOk(id, variante) ? ' (' + MELDUNG.variante[variante] + ')' : ''); }
    // Server-Ereignis: speichern (schlägt der Speicher fehl, bleibt die Meldung) und genau eine Meldung zeigen
    function beiEreignis(ev) {
      if (!ev || typeof ev !== 'object' || !bekannt(ev.id)) return false;
      setzen(ev.id, ev.variante);
      try { if (typeof opt.melde === 'function') opt.melde(meldung(ev.id, ev.variante)); } catch (e) { /* die Meldung darf nie etwas brechen */ }
      return true;
    }
    function anmelden(net, kind) { return net.onEvent(kind || 'abzeichen', (ev) => beiEreignis(ev)); }

    return { KEY, VERSION, NAMEN, VARIANTEN, lesen, setzen, erreicht, varianten, stand, ueberblick, meldung, beiEreignis, anmelden, istOdaZeile };
  }

  return { KEY, VERSION, NAMEN, VARIANTEN, erzeuge, istOdaZeile };
});
