# Update 9.27.5 – Chat-Overlay: Korrektur der Overlay-Seite

## Behoben
- In 9.27.4 brach das Skript der Overlay-Seite beim Laden ab. Folge: Das Chat-Overlay blieb leer (Vorschau, Testnachrichten und echter Chat). Jetzt läuft die Seite wieder, und die Emotes von 7TV, BetterTTV und FrankerFaceZ werden als Bild gezeigt.
- Neuer Test führt das Skript der Overlay-Seite mit einer DOM-Attrappe aus und hätte den Fehler bemerkt.

## Nach dem Update
- In OBS bzw. Moblin die Browserquelle einmal neu laden (OBS: Eigenschaften → „Cache der aktuellen Seite aktualisieren“), damit die korrigierte Seite geladen wird.

## Weiter aus 9.27.4 (unverändert)
- Emotes von 7TV, BetterTTV und FrankerFaceZ mit je eigenem Schalter (standardmäßig aus), übersichtlichere Einstellungen in Spalten.
- Keine Änderung an der Datenbank oder an der `compose.yaml`.
