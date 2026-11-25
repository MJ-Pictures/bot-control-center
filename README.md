# Bot Control Center

Ein Verwaltungsprogramm mit Bots für **Twitch** und **Discord**: Moderation, Spiele, Overlays für den Stream, Gewinnspiele, Auswertungen und vieles mehr, bedient über eine Weboberfläche. Du betreibst es selbst, auf einer NAS, einem eigenen Server oder mit Docker Desktop. Die Daten bleiben bei dir (PostgreSQL), es gibt keine Fernmeldung an den Entwickler.

Die Oberfläche und die Anleitungen sind auf Deutsch. Eine **Lizenz mit offenem Quelltext** (keine Open-Source-Lizenz) regelt die Nutzung, siehe [Lizenz](#lizenz).

## Was das Bot Control Center kann

Jede Funktion lässt sich als Modul unter Administration → Integrationen einzeln ein- und ausschalten. Ausgeschaltete Module verschwinden aus Menü, Suche und Rechteverwaltung.

### Twitch (Chat und Stream)

- **Moderation im Chat:** automatische Filter für Links, Emotes, Satzzeichen und Großbuchstaben, dazu ein zentraler **Wortfilter** (eigene Begriffe, Import aus Listen, Testmodus; je Plattform schaltbar).
- **Follower-Alert:** Einblendung bei neuen Followern für OBS oder Moblin, mit eigenem Banner und Emblem.
- **Chat-Overlay:** Eigene Chat-Einblendung für OBS oder Moblin mit drei Looks (dunkel, hell, kantig), Emotes (auch von 7TV, BetterTTV und FrankerFaceZ, einzeln zuschaltbar), Abzeichen, Karten für Follower, Raids, Abos, Bits und Kanalpunkte, eigene Farben, Position, Schrift, Symbole und Textur, einstellbarer Verzögerung, Ausblenden von Befehlen und Bot-Nachrichten und Schutz vor gelöschten Nachrichten.
- **Followathon:** Countdown, der durch neue Follower verlängert wird, mit Overlay für den Stream.
- **Subathon:** Countdown, der durch Abos, geschenkte Abos, Bits und (optional) Follows verlängert wird, mit Overlay, eigenem Logo und Einstellungen vor dem Start.
- **Punktespiel:** Chat-Spiel mit eigener Punktewährung, Konten, Einsätzen und Runden sowie einem Overlay mit Figur. Name, Währung und Befehle sind anpassbar; eine Standardfigur ist eingebaut, ein eigenes Bild lässt sich hochladen. Lage, Größe und Detailstufe des Overlays sind einstellbar (neun Ankerfelder, Prozentgröße, ausführlich oder kompakt), die Punkte-Übersicht gibt es als Karten oder als sortierte Chips, der Kasten hinter dem Panel ist abschaltbar.
- **Gewinnspiele:** Teilnahme per Chatnachricht, Ziehung und Verlauf.
- **Clips:** neue Clips erkennen, im Chat teilen und an Discord melden; nach einem Netzausfall werden verpasste Clips nachgeholt. Dazu ein Chat-Befehl (z. B. `!clip`), mit dem Zuschauer auf Zuruf einen Clip erstellen: Berechtigung, Pausen, Länge und antwortender Bot sind einstellbar.
- **Lurk-Rückkehr:** der Bot meldet, wie lange jemand nach einem Lurk-Befehl weg war.
- **Event-Profile:** Vorlagen, die viele Funktionen für einen besonderen Stream auf einmal umschalten.
- **Chat-Befehle** mit anpassbaren Texten (Textpaket), Platzhaltern und Link-Freigaben.

### Discord

- **Freischaltung neuer Mitglieder:** Regelannahme, Vergabe der Freischaltrolle und optional eine Schreibsperre für die ersten Minuten.
- **Moderation:** Spam-Schutz, Link-Filter mit Freigabeliste, Eskalationsstufen, Sanktionen und Userhistorie.
- **Meldesystem:** „Nachricht melden“, „User melden“, `/melden` und Melde-Knopf, Bearbeitung durch das Team.
- **Notfallmodus:** stufenweise Einschränkung des Servers auf Knopfdruck.
- **Kanalzeiten:** Kanäle nach Zeitplan öffnen und schließen, auch mit Wartungsmodus.
- **Levelsystem:** XP für Nachrichten, Ränge als Rollen, tägliche Meldungen, Missionen und Topliste.
- **Ankündigungen:** Live- und Clip-Meldungen von Twitch automatisch in Discord posten, Clips mit Vorschaubild.
- **Einladungslink:** verwalteter Einladungslink, auch für Twitch-Befehle.
- **Social Media:** neue Instagram- und TikTok-Beiträge automatisch in Discord veröffentlichen. TikTok-Meldungen werden nur gesendet, wenn der Link erreichbar ist; zu alte Beiträge werden nicht mehr angekündigt.
- **Lagebild, Logs und Benachrichtigungen** für das Team.

### Das Control Center selbst

- **Anmeldung über Twitch und Discord** mit abgestuften Zugriffsrechten (Owner, Administratoren, Moderatoren) und eigener Rechteverwaltung.
- **Profil & Branding:** eigener Name der Oberfläche, Bilder (Banner, Emblem, Figur, Logo, Browser-Symbol), Standardtexte, Fußzeile und Impressumslink des Betreibers.
- **Systemstatus** mit Dienste-Übersicht und Neustart einzelner Dienste, **Sicherung und Wiederherstellung** von Datenbank, Einstellungen und Bildern.
- **Updates** mit Freigabe durch den Betreiber: Neue Versionen werden gemeldet, installiert wird nur nach ausdrücklicher Freigabe (Version und Prüfsumme).
- **Hilfe** in der Oberfläche, mit Lizenz und Rechtlichem.
- **Lesender MCP-Zugang** (optional) für Auswertungen über das Model Context Protocol, ohne Schreibrechte.

## Voraussetzungen

- **Docker** mit Docker Compose (Version 2). Eine Installation ohne Docker gibt es nicht.
- Eine **Twitch-Anwendung** (Client-ID und Secret) sowie ein Twitch-Konto für den Bot und dein Kanal-Konto.
- Für Discord optional eine **Discord-Anwendung** mit Bot, der auf deinem Server ist.
- Eine **Adresse** für das Control Center: eine eigene Domain mit https (nötig für die Anmeldung über Twitch und Discord und für Overlays von außen) oder rein lokal `http://localhost:3000`.

## Installation

Die Schritte stehen in [`tools/compose/INSTALLATION.md`](tools/compose/INSTALLATION.md): Dateien holen, Zugangsdaten anlegen, `compose.yaml` anpassen, starten, Ersteinrichtung im Browser. Dort stehen auch die Hinweise für Synology (DSM), Linux/VPS und Docker Desktop.

**Updates:** Auf Linux und NAS holt sich das Control Center neue Versionen auf Wunsch selbst (Update-Werkzeug, ohne GitHub-Konto). Neue Versionen erscheinen unter Administration → Updates und werden erst nach deiner Freigabe installiert, mit Sicherung und automatischem Zurücksetzen bei Fehlern. Einrichtung: [`tools/deploy/UPDATER-EINRICHTEN.md`](tools/deploy/UPDATER-EINRICHTEN.md); das Startpaket dafür hängt an jedem Release (Datei `…-updater-start-…zip`).

## Aufbau

Fünf Dienste in einer `compose.yaml`:

| Dienst | Container | Aufgabe |
|---|---|---|
| `db` | `bcc-db` | PostgreSQL |
| `web` | `bcc-web` | Weboberfläche, API, Overlays, Seite „Updates“ |
| `twitch` | `bcc-twitch` | Twitch-Bot |
| `discord` | `bcc-discord` | Discord-Bot (optional) |
| `mcp` | `bcc-mcp` | rein lesender MCP-Zugang (optional) |

Zugangsdaten liegen als Dateien im Ordner `secrets/` (siehe [`secrets/README.txt`](secrets/README.txt)), nie im Quelltext. Die Tests laufen mit `node --test tests/*.test.js`.

## Anleitungen

- [`tools/compose/INSTALLATION.md`](tools/compose/INSTALLATION.md): neue Installation auf NAS, Server oder Docker Desktop
- [`tools/deploy/UPDATER-EINRICHTEN.md`](tools/deploy/UPDATER-EINRICHTEN.md): automatische Updates einrichten
- [`DISCORD-SETUP.md`](DISCORD-SETUP.md): Discord einrichten und betreiben
- [`STUBENKONTROLLE-SETUP.md`](STUBENKONTROLLE-SETUP.md): Punktespiel und Overlay
- [`SOCIAL-MEDIA-SETUP.md`](SOCIAL-MEDIA-SETUP.md): Social-Media-Weitergabe
- [`MITGLIEDER-KONSOLIDIERUNG.md`](MITGLIEDER-KONSOLIDIERUNG.md): Mitglieder zusammenführen
- [`tools/deploy/PULL-DEPLOYMENT.md`](tools/deploy/PULL-DEPLOYMENT.md): Update-Werkzeug mit Freigabe
- [`SECURITY.md`](SECURITY.md) (Meldeweg für Sicherheitslücken), [`SECURITY-HARDENING.md`](SECURITY-HARDENING.md) (Härtung im Betrieb)
- [`PRIVACY.md`](PRIVACY.md): Datenverarbeitung und externe Verbindungen
- [`CHANGELOG.md`](CHANGELOG.md): Änderungsprotokoll
- [`CONTRIBUTING.md`](CONTRIBUTING.md): Fehler melden und Mitwirken

## Lizenz

Das Bot Control Center steht unter der **Bot Control Center Community License (BCC-CL 1.0)**. Das ist **keine Open-Source-Lizenz**, sondern eine Lizenz mit offenem Quelltext:

- **Erlaubt:** kostenlose Nutzung für den eigenen Betrieb, auch für monetarisierte Kanäle, Vereine und dienstliche Zwecke; eigene Anpassungen für den eigenen Betrieb; Hilfe durch Dienstleister, die für dich arbeiten.
- **Nicht erlaubt ohne Genehmigung:** Weiterverkauf, kostenpflichtiges Hosting für Dritte, öffentliche Weitergabe oder Veröffentlichung von Kopien und Forks als eigenes Angebot, Entfernen von Urheber- und Herkunftshinweisen.

Maßgeblich ist allein der vollständige Text in [`LICENSE.md`](LICENSE.md); eine verständliche Zusammenfassung steht in [`LICENSE-SUMMARY.md`](LICENSE-SUMMARY.md). Bei der Ersteinrichtung musst du der Lizenz zustimmen. Drittkomponenten und ihre Lizenzen stehen in [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md), der Urheberhinweis in [`NOTICE`](NOTICE).

## Unterstützen

Das Bot Control Center ist ein Freizeitprojekt. Wenn es dir gefällt und du die Weiterentwicklung unterstützen möchtest, kannst du das freiwillig per PayPal tun: [Unterstützen](https://www.paypal.me/JanssenMario). Das ist keine Voraussetzung für die Nutzung und ändert nichts an der Lizenz; eine Gegenleistung oder Spendenquittung gibt es nicht.
