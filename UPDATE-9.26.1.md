# Update 9.26.1 – Clip-Monitor übersteht Netzausfälle

## Neu
- **Verpasste Clips nachholen:** Nach einem Ausfall der Verbindung zu Twitch sucht der Clip-Monitor ab dem letzten erfolgreichen Abruf (höchstens 60 Minuten zurück). Normal sucht er in den letzten 15 Minuten (bisher 10), weil Twitch neue Clips nach bisheriger Beobachtung erst nach einigen Minuten in der Liste führt. Bereits gemeldete Clips werden nicht doppelt gemeldet. Nach einem Neustart des Twitch-Dienstes gilt wieder das normale Fenster.
- **Verständliche Fehlermeldung:** Statt „fetch failed“ steht die Ursache da, zum Beispiel „Keine Verbindung zu Twitch (api.twitch.tv): Name konnte nicht aufgelöst werden (DNS) (EAI_AGAIN)“.
- **Prüfintervall:** Standard 10 Sekunden (vorher 20), einstellbar von 5 bis 120 Sekunden unter Twitch → Clips. Bereits gespeicherte Werte bleiben unverändert.
- **Status:** Unter Zuletzt geteilt steht, wie lange Twitch nach dem Erstellen gebraucht hat, bis der Clip abrufbar war. Daran sieht man, ob eine Verzögerung bei Twitch oder im eigenen System liegt.

## Hinweis zur Dauer bis zur Meldung
Eigene Wartezeiten im Programm betragen höchstens etwa 20 Sekunden (Prüfintervall plus Weitergabe an Discord). Beobachtet wurden rund 5 Minuten bis zur Meldung; sie entstehen demnach bei Twitch, das neue Clips erst verzögert in der Abfrage-Schnittstelle führt. Der Monitor kann einen Clip nicht früher melden, als Twitch ihn liefert. Die Zeile im Status unter Zuletzt geteilt belegt das. Ein kürzeres Prüfintervall spart nur einige Sekunden.

## Bestandsinstallation
- Keine Änderung an der Datenbank oder an der `compose.yaml`; Docker-Dateien unverändert.
