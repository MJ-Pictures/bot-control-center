# Update 9.28.3 – Chat-Overlay: Deckkraft, Textschatten, Spielmeldungen

## Neu
- Chat-Overlay → Anpassung:
  - **Deckkraft der Nachrichten:** 10–100 % (Standard 100). Nur die Blase wird durchsichtig; Text, Namensleiste und Akzentstreifen bleiben deckend. Gilt auch für eigene Nachrichtenfarben.
  - **Textschatten:** Aus (Standard), Leicht, Stark – für Lesbarkeit vor hellen Spielszenen.
- Chat-Overlay → Ausgeblendet:
  - **Meldungen des Chat-Spiels:** „Im Chat zeigen“ (wie bisher, Standard) oder „Nicht im Chat zeigen, nur im Spiel-Overlay“. So erscheinen die Spielmeldungen nicht doppelt.
- Die Breite war schon einstellbar (Anpassung → Breite in Prozent).

## Nach dem Update
1. Dateien ersetzen bzw. Update einspielen, Container `bcc-web` neu starten.
2. Browserquelle des Chat-Overlays in OBS/Moblin **neu laden**.
3. Einstellungen speichern und mit „Testnachrichten“ bzw. der Vorschau prüfen.

## Hinweise
- Ohne Änderung der Einstellungen sieht das Overlay aus wie in 9.28.2.
- Keine Änderung an der Datenbank oder an der `compose.yaml`.

## Weiter aus 9.28.2 bis 9.28.0 (unverändert)
- Punktespiel-Overlay (Lage, Größe, Detailstufe, Punkte-Übersicht, Kasten) und Chat-Befehl `!clip`.
