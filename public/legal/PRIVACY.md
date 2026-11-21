# Datenschutz und externe Verbindungen

Diese Datei beschreibt, welche Daten das Bot Control Center verarbeitet und mit welchen Diensten es sich verbindet. Sie ist eine technische Dokumentation für Betreiber und ersetzt weder eine Datenschutzerklärung für deine Zuschauer und Mitglieder noch eine Rechtsberatung.

## Wer verantwortlich ist

**Du als Betreiber.** Du betreibst die Software auf deiner eigenen Infrastruktur und entscheidest, welche Funktionen laufen und welche Daten dabei entstehen. Du bist für die Einhaltung der Datenschutzvorschriften verantwortlich, insbesondere für Informationspflichten gegenüber Zuschauern und Mitgliedern, für eine Rechtsgrundlage der Verarbeitung und für die Erfüllung von Auskunfts- und Löschwünschen (Ziffer 12 der Lizenz).

## Der Lizenzgeber erhält keine Daten

Die Software enthält **keine Telemetrie, keine Nutzungsstatistik, keine Online-Aktivierung und keinen Lizenzserver**. Es werden keine Daten über deine Installation, deine Kanäle oder deine Nutzer an den Lizenzgeber übermittelt. Der Link „Quellcode & Lizenz“ in der Fußzeile ist ein gewöhnlicher Verweis; beim Aufruf der Seite verlässt der Besucher das Control Center.

## Externe Verbindungen

| Verbindung | Wofür | Wann |
|---|---|---|
| Twitch (`id.twitch.tv`, `api.twitch.tv`, Chat und Ereignisdienste) | Anmeldung, Chat, Moderation, Ereignisse, Kanal- und Followerdaten | wenn Twitch angebunden ist |
| Discord (`discord.com`, Gateway) | Anmeldung, Bot, Moderation, Rollen, Meldesystem | wenn Discord angebunden ist |
| Instagram, TikTok | Veröffentlichung und Abruf für die Social-Media-Weitergabe | nur wenn du diese Verbindung selbst einrichtest |
| GitHub (`api.github.com`, `github.com`) | Update-Werkzeug fragt nach neuen Releases und lädt freigegebene Updates | nur wenn du das Update-Werkzeug einsetzt; Installation erst nach deiner Freigabe |
| MCP-Dienst | rein lesender Zugriff auf ausgewählte Ansichten der Datenbank | nur wenn du ihn aktivierst; geschützt durch ein eigenes Token |

Bei jeder dieser Verbindungen sieht der Gegenüber die IP-Adresse deines Servers bzw. NAS. Es werden keine Schriften, Skripte oder Bilder von Drittanbietern in die Oberfläche oder die Overlays geladen.

## Welche Daten verarbeitet werden

Je nach genutzten Funktionen speichert die Software in der Datenbank und im Datenverzeichnis:

- **Twitch- und Discord-Kennungen und Anzeigenamen** von Zuschauern und Mitgliedern (zum Beispiel für Level, Punkte, Giveaways, Moderation, Rollen).
- **Chat- und Aktivitätsdaten**, soweit sie für Funktionen nötig sind (zum Beispiel Level und Erfahrung, Spielkonten und Buchungen, Befehlsnutzung).
- **Moderationsdaten:** Verstöße als Metadaten (ohne vollständige Nachrichten), Verwarnstufen, Timeouts, Bans, Meldungen (Tickets) samt Bearbeitungsverlauf und, wenn aktiviert, archivierte Anhänge.
- **Zugangsdaten der Betreiber und Teammitglieder:** Anmeldungen über Twitch oder Discord, zugewiesene Rechte, ein technisch notwendiges Sitzungs-Cookie und ein Audit-Protokoll von Verwaltungsaktionen.
- **Verbindungsdaten zu Diensten:** OAuth-Tokens deiner Bots und optionaler Social-Verbindungen. Diese liegen als Dateien im Datenverzeichnis, nicht in Sicherungen.
- **Hochgeladene Bilder** für Branding, Overlays und Alerts.

Die Software legt Daten nur lokal auf deinem System ab. Eine Weitergabe an Dritte erfolgt nur über die oben genannten Verbindungen und nur, soweit die jeweilige Funktion es erfordert.

## Aufbewahrung, Sicherung, Löschung

- Daten bleiben, bis du sie löschst oder die jeweilige Funktion zurücksetzt. Einzelne Bereiche haben eigene Begrenzungen (zum Beispiel ist das Moderationsprotokoll auf eine feste Zahl von Einträgen begrenzt).
- Sicherungen (Administration → Backup / Restore und die Skripte in `scripts/`) enthalten personenbezogene Daten. Bewahre sie geschützt auf und lösche alte Sicherungen, wenn sie nicht mehr gebraucht werden. Tokens und Sitzungen sind nicht Teil der zentralen Sicherung.
- Für Auskunfts- und Löschwünsche nutzt du die Verwaltungsseiten der jeweiligen Module oder greifst direkt auf die Datenbank zu.

## Hinweise für deine eigene Datenschutzerklärung

Nenne dort mindestens: welche Bots auf deinem Kanal und Server laufen, welche Daten sie verarbeiten (Kennung, Name, Aktivität, Moderationsdaten), den Zweck (Spielfunktionen, Moderation, Sicherheit), die Rechtsgrundlage, die Speicherdauer, die Empfänger (Twitch, Discord, ggf. Social-Dienste) und wie Betroffene ihre Rechte ausüben können. Das Control Center kann dafür im Profil einen Verweis auf deine Datenschutz- und Impressumsseite anzeigen.
