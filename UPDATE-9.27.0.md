# Update 9.27.0 – Neues Modul: Chat-Overlay für OBS und Moblin

## Neu
- **Chat-Overlay:** Der Twitch-Chat als eigene Browserquelle mit drei Looks (dunkel, hell, kantig), Emotes, Abzeichen, Ausrichtung links oder rechts, Akzentfarbe und Schriftgröße. Es wird eine Systemschrift verwendet, es ist keine Schriftdatei nötig.
- **Moderation:** Das Overlay zeigt nur Nachrichten, die alle Filter bestanden haben. Eine einstellbare Verzögerung (Standard 2 Sekunden) verhindert, dass kurz darauf gelöschte Nachrichten sichtbar werden. Spätere Löschungen, Sperren und „Chat leeren“ entfernen Nachrichten auch aus der Einblendung.
- **Filter:** Befehle und bekannte Fremd-Bots lassen sich ausblenden. Nachrichten des eigenen Bots: keine (Standard), nur Spielmeldungen des Punktespiels oder alle.
- **Standardmäßig aus:** Aktivierung unter Administration → Integrationen. Danach unter Live-Zentrale → Chat-Overlay die Adresse für die Browserquelle kopieren; dort gibt es auch Vorschau und Testnachrichten.

## Bestandsinstallation
- Keine Änderung an der Datenbank oder an der `compose.yaml`.
- Nach dem Einschalten des Moduls abonniert der Twitch-Bot drei zusätzliche Ereignisse (Nachricht gelöscht, Nutzernachrichten gelöscht, Chat geleert). Falls Twitch eines ablehnt, steht das im Protokoll; das Overlay blendet Nachrichten dann nur nach Ablauf der Anzeigedauer aus.
- Die Browserquelle in OBS oder Moblin nach dem Update einmal neu laden.
