# Update 9.26.2 – Clip-Meldungen in Discord: Vorschaubild zuverlässig, Nachricht auffindbar

## Neu
- **Vorschaubild:** Der Bot lädt das Clip-Vorschaubild selbst und hängt es an die Discord-Nachricht. Bisher lud Discord das Bild direkt von Twitch, oft bevor es dort abrufbar war, und zeigte dann dauerhaft keines. Ist das Bild noch nicht da, versucht der Bot es bis zu etwa 3 Minuten lang (alle 15 Sekunden) und sendet danach mit dem Twitch-Link wie bisher.
- **Nachricht auffindbar:** Jede gesendete Ankündigung speichert Kanal und Nachrichten-ID. Unter Discord → Kommunikation → Ankündigungen steht ein Link zur letzten Clip- und Live-Nachricht, dazu ob sie mit Vorschaubild gesendet wurde. Ist die Nachricht im Kanal nicht mehr zu sehen, wurde sie nach dem Senden gelöscht (zum Beispiel durch eine Moderation); das Server-Protokoll von Discord (Servereinstellungen → Audit-Log, Aktion „Nachricht gelöscht“) zeigt, durch wen.
- **Warteschlange:** Eine Ankündigung, die Discord dauerhaft ablehnt, blockiert die folgenden nicht mehr. Nach 40 Versuchen (ca. 10 Minuten) wird sie aufgegeben. Der Fehler steht dann unter Administration → Systemfehler (erste Meldung ab dem 5. Versuch, zweite beim Aufgeben). Das Protokoll „Ankündigung geteilt“ enthält jetzt auch die Nachrichten-ID.

## Bestandsinstallation
- Keine Änderung an der Datenbank oder an der `compose.yaml`. Bereits gesendete Ankündigungen haben noch keine Nachrichten-ID; der Link erscheint ab der ersten Meldung nach dem Update.
