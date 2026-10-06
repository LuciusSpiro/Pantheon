# CONTRACT-M0 – Sofort-Fix (Ausbaustufe 2, Meilenstein 0)

Ergänzt `CONTRACT.md` (bleibt gültig). Ein Team setzt M0 komplett um und darf dafür alle Dateien
ändern; Stil und Vertragsregeln von `CONTRACT.md` gelten weiter (Namenskonvention, Robustheit,
Fehlerzähler, Fallback ohne Art/Audio, kein Build, keine CDNs). Freigabe durch Kai am 2026-10-04.

Hintergrund: Erster Online-Spieleabend zu dritt über Cloudflare-Quick-Tunnel war ein Erfolg. M1
(Brücke neu, offene Welt, 4 Quartiere, Planungstisch, Phasenkanonen) folgt danach und baut das
Schiffslayout ohnehin um – M0 also schlank halten, aber sauber, damit es in M1 weiterlebt.

## 1. Regale zeigen ihren Füllstand
- `CONFIG.shelfCapacity` = `{ ersatzteil: 6, loeschgel: 4, flickblech: 4, bolzen: 12, medipack: 4 }`.
  Bestand darf über der Kapazität liegen (Shop), Anzeige klemmt auf voll.
- Füllgrad = Bestand / Kapazität (Löschgel: ganze Dosen; angebrochene Ladungen zählen als 1 Dose).
- `Art.drawObject(ctx, 'shelf', px, py, { item, fill, time })` mit 4 Stufen:
  **voll** (≥ 0,67) · **halb** (≥ 0,34; Lücken, ein Teil umgekippt) · **fast leer** (> 0; nur ein Rest,
  Statuslämpchen blinkt Bernstein) · **leer** (0; nackte Böden, Staub, Lämpchen Alarmrot, kleines
  „LEER“-Schild). Ohne `fill` = voll (rückwärtskompatibel).
- Client übergibt `fill` aus `snap.inventory`. E-Hinweis am Regal zeigt die Zahl („Ersatzteile: 3“).
- Mini-Schiffsplan: leeres Regal = roter Punkt. Captain-Tab „Schäden“: Zeile „Lager leer: …“.
- Schrauber, die ein Teil brauchen und keins finden, schicken einmalig eine ODA-/notice-Meldung
  („Kein Ersatzteil mehr im Lager“) statt die Aufgabe stumm zu überspringen.

## 2. Maschinenraum voller
Heute: x1–6, y1–11 fast nur Gitterboden mit Reaktor `R` (3,4) und Antrieb `E` (1,8).
- Neue Kartenzeichen in `shared/maps.js` (Legende + Art): z. B. `u` Rohrbündel/Ventilblock (solid),
  `k` Werkbank mit Schraubstock (solid), `n` Kontrollpult (solid), `f` Ölfass/Kabeltrommel (solid).
  Max. 6–8 neue solide Kacheln im Maschinenraum. **Pflicht:** Gang y6 und Tür (7,6) frei, `R` und `E`
  von mind. einer Seite erreichbar, Bot-Wege funktionieren, `npm run check` und `npm run sim` grün.
- Zusätzlich **nicht-blockierende** Details im Art-Code: Rohre/Flansche/Manometer (zitternde Zeiger)
  an der Oberwand des Maschinenraums, Kabeltrassen im Boden zu R/E, Bodenlicht in Bernstein unter dem
  Gitter, Dampfwölkchen aus Ventilen, Reaktor mit pulsierendem Mint-Kern (im roten Alarm rötlich).
- Ziel aus der Art Direction: pro 4×4 Kacheln mind. ein großes und zwei kleine Objekte; warm, Messing.

## 3. Hafen-Übung überspringen
- Lobby: Schalter „Hafen-Übung überspringen“ (jeder darf umschalten, alle sehen den Zustand).
  Nachricht `{ t: 'lobbyOpt', skipDrill: bool }`; Snapshot-Feld `lobby: { skipDrill }`.
- Beim Start mit `skipDrill`: Stage `dock` ohne Übung (kein Kabelbrand/Leck/Transferschaden), der
  Funkspruch von Tesk kommt nach kurzer ODA-Begrüßung (≤ 10 s). Debug-Skip bleibt.

## 4. Raumcode (Schutz für den öffentlichen Tunnel)
- Server erzeugt beim Start einen 4-stelligen Code aus `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, außer
  `ROOM_CODE` ist gesetzt (`ROOM_CODE=off` schaltet ab). Konsole zeigt deutlich:
  `Raumcode: K7QM   Link: http://localhost:3300/?code=K7QM` (und den Hinweis, dass man beim Tunnel
  einfach `?code=K7QM` an die trycloudflare-Adresse hängt).
- `hello` bekommt `code`. Falscher/fehlender Code → `{ t: 'error', code: 'badcode', text }`, kein Spieler
  wird angelegt, Verbindung bleibt für einen neuen Versuch offen. Reconnect braucht ebenfalls den Code.
- **Keine** Ausnahme für localhost (der Tunnel kommt auch von localhost an).
- Client: liest `?code=` aus der URL, merkt ihn in localStorage, schickt ihn mit. Bei `badcode`: Lobby
  zeigt ein Eingabefeld „Raumcode“ (DOM wie das Namensfeld). In der Lobby sehen Verbundene den Code und
  einen Knopf „Einladungslink kopieren“ (aktuelle Origin + `?code=`).
- Snapshots/Events gehen erst nach erfolgreichem `hello` an eine Verbindung (heute bekommen auch
  Verbindungen ohne hello Snapshots – das abstellen).

## 5. Kleinkram
- Pixelfont: „Ü“ (und Ä/Ö) als echte Großbuchstaben, nicht wie Kleinbuchstaben mit Punkten.
- README: Abschnitt „Übers Internet spielen“ (cloudflared installieren per `winget install
  Cloudflare.cloudflared`, Server starten, `cloudflared tunnel --url http://localhost:3300`, Link mit
  `?code=` teilen, Hinweise: PC wach halten, max. 3 Spieler, ein Gerät pro Spieler) und Raumcode.

## 6. Abnahme
- `node --check` aller JS, `npm run check`, `npm run sim` (solo + 3), `node tools/test-features.js`,
  `node tools/ws-smoke.js` grün (Tests an Raumcode anpassen: Testserver mit `ROOM_CODE=off` oder Code mitsenden;
  plus neue Tests für badcode und skipDrill).
- Playwright-Screenshots nach `shots/m0/`: Lager voll/halb/fast leer/leer (z. B. per Debug-Befehl Bestand
  setzen – ergänze `debug inv {item, n}`), Maschinenraum normal und roter Alarm, Lobby mit Code und
  Übungs-Schalter, Code-Eingabe nach badcode, Sicht ohne art.js. Ansehen (Read-Tool) und nachbessern.
- Kurzer echter Durchlauf solo im Browser mit übersprungener Übung bis zum Ende des Kampfs (keine Fehler).
- Alle gestarteten Prozesse beenden.
