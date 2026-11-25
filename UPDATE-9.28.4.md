# Update 9.28.4 – Chat-Overlay weicht dem Punktespiel aus

## Neu
- Chat-Overlay → Ausgeblendet → **Chat bei laufender Spielrunde:** Nichts tun (Standard, wie bisher), Abdunkeln, Ausblenden oder Nach oben schieben.
  - Wirkt in **jeder Phase** der Runde (Anmeldung, Kontrolle, Ergebnis) und nur, solange das Punktespiel eine Runde zeigt; danach kehrt der Chat sanft zurück.
  - Abdunkeln: verbleibende Deckkraft 0–90 % (Standard 30). Schieben: 0–900 Pixel (Standard 360); bei Chat-Position „Oben“ wird nach unten geschoben.
- Die Spielphase kommt über die bestehende Verbindung des Chat-Overlays vom Control Center; beide Overlays müssen nicht in derselben Szene liegen.

## Nach dem Update
1. Dateien ersetzen bzw. Update einspielen, Container `bcc-web` neu starten.
2. Browserquelle des Chat-Overlays in OBS/Moblin **neu laden**.
3. Einstellung wählen, speichern und mit „Test“ im Punktespiel eine Runde ansehen.

## Hinweise
- Standard ist „Nichts tun“; ohne Änderung verhält sich alles wie in 9.28.3.
- Keine Änderung an Datenbank oder `compose.yaml`.

## Weiter aus 9.28.3 bis 9.28.0 (unverändert)
- Chat-Overlay: Deckkraft, Textschatten, Spielmeldungen; Punktespiel-Overlay: Lage, Größe, Detailstufe, Punkte-Übersicht; Chat-Befehl `!clip`.
