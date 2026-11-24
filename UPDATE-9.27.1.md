# Update 9.27.1 – Chat-Overlay: Karten für neue Follower und Raids

## Neu
- **Ereigniskarten im Chat:** „Neuer Follower“ (Herz) und „Raid“ (mit Zuschauerzahl) erscheinen als Karte zwischen den Nachrichten, im gewählten Look und in der eingestellten Akzentfarbe. Die Symbole werden aus dem mitgelieferten Satz in der Akzentfarbe eingefärbt.
- **Einstellungen:** Unter Live-Zentrale → Chat-Overlay lassen sich beide Karten einzeln abschalten (Standard: an). Vorschau und Testnachrichten zeigen Beispielkarten.
- **Ohne Verzögerung:** Karten stammen aus echten Twitch-Ereignissen, nicht aus dem Chat-Text, und erscheinen sofort.
- **Raids:** Der Twitch-Bot meldet Raids zusätzlich an die Weboberfläche. Fehler dabei verhindern die Raid-Nachricht im Chat nicht.

## Bestandsinstallation
- Keine Änderung an der Datenbank oder an der `compose.yaml`.
- Browserquelle in OBS oder Moblin nach dem Update einmal neu laden (neue Symbole). Das Modul muss wie bisher unter Administration → Integrationen eingeschaltet sein.
- Abo-, Bits- und Kanalpunkte-Karten folgen später; der Kanal kann sie derzeit nicht live prüfen.
