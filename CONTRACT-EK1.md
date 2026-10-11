# CONTRACT-EK1 – Schiffsklassen (EK1a: Korvette)

Grundlage: `Briefing Eisenwald-Kampagne (EK1-EK9)` und `Planung Eisenwald-Kampagne (EK1-EK9)` im Vault
(`C:\Users\Luciu\projects\brain\vault\Coop-Spiel\`). Kai am 2026-10-11: `gunboat` vollständig umbenennen und durch die
Korvetten-Regeln ersetzen. Branch `ek1`.

## 1. Stand
| Schritt | Inhalt | Stand |
|---|---|---|
| EK1a-1 | `gunboat` → `korvette` (Kennung, Config-Schlüssel, Tests, Regiebücher, Katalog, Archiv, Fixtures), Anzeige „Kanonenboot“ → „Korvette“ | fertig |
| EK1a-2 | Korvetten-Regeln: Schilde, Waffenplätze, zufällige Bestückung | fertig |
| EK1b | Fregatte, Kreuzer, variable Schildsegmente, Drehsprites | offen |

## 2. Korvetten-Regeln (Aufbau `X=>`)
- **Schilde** `[vorn, Steuerbord, hinten, Backbord] = [1, 2, 0, 2]` (`CONFIG.enemyShields.korvette`). Vorher `[2, 4, 1, 4]`.
- **Waffenplätze** `CONFIG.enemyWeapons.korvette`: `bug` (0°, Bogen 40°, 400 px), `stbd` (90°, 90°, 500 px), `bb` (−90°, 90°, 500 px).
- **Bestückung** je Platz aus `CONFIG.korvetteWaffen` = `lanze | batterie | bolzen`, beim Spawn gewürfelt (`game.rng`), oder per
  `spawnEnemy(game, 'korvette', { waffen: { bug, stbd, bb } })` vorgegeben. Der Zustand steht in `e.waffen`.
  - **lanze** = angekündigter schwerer Treffer (bisher „Ladung“/`tele`), nur wenn die Lerche im Bogen eines Lanze-Platzes liegt.
  - **batterie** = Sperrfeuer-Salve (S2b), Mündung am Batterie-Platz, der zur Lerche zeigt.
  - **bolzen** = einzelner gezielter Schuss (Projektil `enemy`, eigener Takt `e.boltT`, Grundwerte der Korvette).
  - Eine Korvette ohne Lanze lädt nie, ohne Batterie gibt es kein Sperrfeuer, ohne Bolzen keine Einzelschüsse.
- **Snapshot:** `weapons` (nach dem Scan) trägt je Platz `platz` und `typ`. Kein neues Feld je Gegner.
- **Pilot:** Seitenwechsel auch dann, wenn ein Bolzen zur Lerche zeigt und die andere Seite Lanze oder Batterie hat.
- **Scan-Text** nennt Seiten stark, Bug schwach, Heck ungeschützt.

## 3. Entscheidungen der Studioleitung
| # | Entscheidung | Grund |
|---|---|---|
| D1 | Vollständige Umbenennung, kein Alias. Grammatik angepasst („die Korvette“, „der Korvette“, „Korvetten-Wellen“) | Kai 2026-10-11 |
| D2 | Voxelwerk-Datei `rostmeute_kanonenboot.json` bleibt unangetastet (anderes Repository) | EK1b bindet die Modelle neu an |
| D3 | LLM-Aufzeichnungen (`tools/fixtures/llm/**`) umbenannt und neu verschlüsselt (Schlüssel = SHA-1 des Inputs). Buch-Hashes neu geschrieben, Fehlercodes und Szenenquellen unverändert | Prüfung `Schlüssel passt nicht zum input` |
| D4 | Ältere Golden-Basen (`base`, `base-s1`, `base-s2b`, `base-b1fix`, `base-w1`, `s1`) und gespeicherte Welten unter `data/` nicht umgeschrieben (Altstand) | historisch |
| D5 | Lanze, Batterie und Bolzen werden auf die vorhandenen Angriffsarten der Gegner abgebildet (tele, Sperrfeuer, Einzelschuss), nicht auf die Waffen der Lerche | die große Waffenliste (AP12/13) ist nicht Voraussetzung |
| D6 | Angriffe auf **Schützlinge** (`escort.js`) laden weiter ohne Prüfung der Bestückung | Schützling-Pfad bleibt für EK4 offen |
| D7 | Tests, die Ladung und Sperrfeuer gleichzeitig brauchen, geben die Bestückung vor (`VOLL_BESTUECKT` bzw. eigene Vorgabe) | sonst vom Zufall abhängig |

## 4. Abnahme EK1a
- `npm test` und `npm run check` grün.
- `npm run snap:mess`: Worst Case 11 444 B, Wellen 10 558 B (Ziel ≤ 18 944 B).
- Bot-Arena (`sim arena --pilot both`): Korvetten werden geschlagen.
- Golden m1–m3 gegen `base-w2`: Abweichungen siehe `allow-ek1.json`.
