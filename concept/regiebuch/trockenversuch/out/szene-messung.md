# Messung Szene ausarbeiten (Stufe 2)

MAX_THINKING_TOKENS=0. Dauer = gesamter claude-Aufruf inkl. Start der CLI.

| Zeit | Szene | Modell | Versuch | Dauer | erstes Token | Tokens aus | Tokens ein | Kosten | Fehler | Warnungen |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-07T19:02 | grauzahn-rache/s3_funkduell | claude-sonnet-4-6 | v1 | 14.5 s | 3.1 s | 663 | 5652 | $0.0311 | 2 | 6 |
| 2026-10-07T19:02 | grauzahn-rache/s3_funkduell | claude-sonnet-4-6 | v2 | 9.3 s | 3.3 s | 648 | 6416 | $0.0300 | 1 | 6 |
| 2026-10-07T19:03 | grauzahn-rache/s3_funkduell | claude-sonnet-4-6 | v1 | 14.5 s | 4.2 s | 630 | 5687 | $0.0308 | 0 | 0 |
| 2026-10-07T19:04 | grauzahn-rache/s3_funkduell | claude-sonnet-4-6 | v1 | 31.9 s | 21.4 s | 648 | 5687 | $0.0114 | 0 | 0 |
| 2026-10-07T19:04 | grauzahn-rache/s3_funkduell | claude-sonnet-4-6 | v1 | 12.7 s | 2.3 s | 642 | 5687 | $0.0113 | 0 | 0 |
| 2026-10-07T19:04 | grauzahn-rache/s2_splitter_annaeherung | claude-sonnet-4-6 | v1 | 4.6 s | 2.5 s | 139 | 5698 | $0.0195 | 0 | 0 |
| 2026-10-07T19:04 | grauzahn-rache/s3_funkduell | claude-haiku-4-5-20251001 | v1 | 7.7 s | 1.7 s | 634 | 5686 | $0.0103 | 0 | 0 |
| 2026-10-07T19:04 | grauzahn-rache/s3_funkduell | claude-haiku-4-5-20251001 | v1 | 7.8 s | 1.8 s | 643 | 5686 | $0.0038 | 0 | 0 |
| 2026-10-07T19:05 | grauzahn-rache/s3_funkduell | claude-haiku-4-5-20251001 | v1 | 7.8 s | 1.7 s | 629 | 5686 | $0.0037 | 0 | 0 |
| 2026-10-07T19:05 | grauzahn-rache/s2_splitter_annaeherung | claude-haiku-4-5-20251001 | v1 | 3.5 s | 1.7 s | 145 | 5697 | $0.0078 | 0 | 0 |
| 2026-10-07T19:06 | grauzahn-rache/s2_splitter_annaeherung | claude-sonnet-4-6 | v1 | 7.3 s | 2.4 s | 270 | 5966 | $0.0264 | 1 | 1 |
| 2026-10-07T19:06 | grauzahn-rache/s2_splitter_annaeherung | claude-sonnet-4-6 | v2 | 5.1 s | 2.2 s | 262 | 6313 | $0.0228 | 1 | 1 |
| 2026-10-07T19:06 | grauzahn-rache/s3_funkduell | claude-sonnet-4-6 | v1 | 14.4 s | 3.0 s | 645 | 5955 | $0.0272 | 0 | 0 |
| 2026-10-07T19:06 | grauzahn-rache/s2_splitter_annaeherung | claude-haiku-4-5-20251001 | v1 | 5.2 s | 1.7 s | 313 | 5965 | $0.0090 | 0 | 1 |
| 2026-10-07T19:06 | grauzahn-rache/s3_funkduell | claude-haiku-4-5-20251001 | v1 | 7.9 s | 1.7 s | 651 | 5954 | $0.0107 | 0 | 0 |
| 2026-10-07T19:07 | grauzahn-rache/s2_splitter_annaeherung | claude-sonnet-4-6 | v1 | 7.8 s | 2.4 s | 291 | 5966 | $0.0062 | 0 | 0 |

**Anmerkungen (2026-10-07):** Zeilen 1–2 ungültig wegen eines Fehlers im Prompt (Beispiel `{"setFlag": {"name": true}}`
wörtlich genommen), Zeilen 11–12 wegen eines Fehlers im Zusammensetzen (Wendungs-Kennung > 40 Zeichen); beides behoben,
kein Modellfehler. Zeile 4: Ausreißer der API-Latenz (erstes Token nach 21 s). Ab Zeile 11 mit Wendung.
Antworten zum Vergleich in `stufe2/`. Haiku für den Grobplan: `haiku-grobplan/` (0/3 gültig).
