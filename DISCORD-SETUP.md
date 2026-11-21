# Discord einrichten und betreiben

Diese Anleitung beschreibt die Discord-Anbindung des Bot Control Centers: Bot anlegen, Rollen und Kanäle zuordnen, Freischaltung neuer Mitglieder, Moderation, Meldesystem, Zeitsteuerung, Notfallmodus, Logs, Sicherung und Betrieb. Die Neuinstallation selbst steht in [`tools/compose/INSTALLATION.md`](tools/compose/INSTALLATION.md).

Alle Bezeichnungen sind Beispiele. Rollen und Kanäle heißen bei dir so, wie du sie auf deinem Server angelegt hast; im Control Center wählst du sie aus Listen aus. **Echte Tokens, Client-Secrets und IDs gehören nie in diese Anleitung, in Chats oder in ein öffentliches Repository.**

## 1. Überblick

Der Discord-Dienst (`bcc-discord`) ist ein eigener Container. Das Control Center (`bcc-web`) spricht intern mit ihm und schützt diese Verbindung mit dem gemeinsamen `INTERNAL_SERVICE_SECRET`. Der Discord-Dienst nimmt außer `/health` keine internen Verwaltungsaufrufe ohne dieses Secret an. Es muss in beiden Diensten derselbe starke Wert stehen (Datei `secrets/internal_service_secret.txt`).

Die Oberfläche gliedert Discord in diese Bereiche:

- **Übersicht** (Lagebild)
- **Server:** Kanäle, Rollen, Mitglieder, Kanalzeiten, Freischaltung, Einladungslink
- **Sicherheit:** Moderation, Sanktionsübersicht, Userhistorie, Meldungen, Notfallmodus, Zugriffsrechte
- **Administration:** Logs und Benachrichtigungen, Backup

## 2. Bot und Anwendung anlegen

1. Auf discord.com/developers eine Anwendung anlegen und unter **Bot** einen Bot erzeugen.
2. **Privileged Gateway Intents:** *Server Members Intent* und *Message Content Intent* einschalten. Ohne den Message Content Intent kann die Moderation keine Nachrichten prüfen.
3. Bot-Token und Client-Secret als Dateien ablegen (`secrets/discord_bot_token.txt`, `secrets/discord_client_secret.txt`). Das Client-Secret braucht nur der Discord-Container.
4. Unter **OAuth2 → Redirects** die Adresse `https://deine-adresse/auth/discord/callback` eintragen (die genaue Adresse zeigt dir der Einrichtungsassistent). Der Anmeldevorgang nutzt die Scopes `identify` und `guilds.members.read`.
5. Den Bot mit dem Berechtigungsumfang aus Abschnitt 3 auf deinen Server einladen.
6. Im Control Center die **Discord-Server-ID** eintragen (Einrichtungsassistent oder Administration → Profil & Branding). Die ID bekommst du so: Discord → Einstellungen → Erweitert → Entwicklermodus einschalten, dann Rechtsklick auf den Server → „Server-ID kopieren“.
7. Unter **Discord → Rollen** die Rollen zuordnen (Abschnitt 4).

### Neustart-Verhalten

Beide Container starten über einen Supervisor (`node supervisor.js …`) als Hauptprozess. Ein Neustart aus dem Control Center beendet nur den eigentlichen Node-Dienst mit Exit-Code `75`; der Supervisor startet ihn neu, der Container bleibt aktiv. Nach einer Änderung des `command:` in der `compose.yaml` muss das Compose-Projekt einmal neu erstellt werden.

## 3. Berechtigungen des Bots

Serverweit:

- Rollen verwalten (Freischaltung)
- Kanäle verwalten (Kanalzeiten, Notfallmodus)
- Nachrichten verwalten (Moderation)
- Mitglieder moderieren (Timeouts)
- Mitglieder bannen (automatische oder manuelle Bans)

In den genutzten Kanälen zusätzlich: Kanal ansehen, Nachrichten senden, Nachrichtenverlauf lesen, und im Regelkanal **Reaktionen hinzufügen**.

Wichtig:

- Die Bot-Rolle muss in der Rollenliste **oberhalb** der Freischaltrolle stehen. Sie kann nur Mitglieder moderieren oder bannen, deren höchste Rolle unter der Bot-Rolle liegt.
- Fehlt eine Berechtigung, kannst du den Bot mit erweitertem Umfang für denselben Server erneut autorisieren. Ein zweiter Bot ist nicht nötig.
- Discord AutoMod bleibt als erste Schutzschicht empfehlenswert. Das Control Center ergänzt sie.

## 4. Rollen

Das Control Center kennt vier Rollen-Zuordnungen:

| Zuordnung | Aufgabe |
|---|---|
| **Administrator** | Vertrauensrolle mit Teamzugriff; ausgenommen von Link-Whitelist und Spam-Schutz |
| **Moderator** | Vertrauensrolle für das Moderationsteam; ebenfalls ausgenommen |
| **Mitglied** | Freischaltrolle: wird nach Bestätigung der Regeln vergeben |
| **Bot** | die Rolle des Bots selbst |

Die Zuordnung zu den echten Rollen deines Servers legst du im Control Center fest (Discord → Rollen bzw. Profil & Branding). Alternativ lassen sich die Rollen-IDs in der `compose.yaml` setzen (`DISCORD_ROLE_ADMINISTRATOR_ID`, `DISCORD_ROLE_MODERATOR_ID`, `DISCORD_ROLE_MEMBER_ID`, `DISCORD_ROLE_BOT_ID`).

Unter **Discord → Mitglieder** können Owner Mitglieder suchen und die Rollen Administrator und Mitglied kontrolliert vergeben oder entfernen. Andere Rollen bleiben serverseitig gesperrt.

## 5. Anmeldung und Zugriffsrechte

Das Backend wird über die Discord-Anmeldung geschützt. Standardmäßig gilt:

- **Twitch-Moderator:** Anmeldung und Twitch-Dashboard.
- **Discord-Administrator:** Identität wird verifiziert und gespeichert, aber ohne Freigabe kein Backend-Zugang.
- **Discord-Moderator:** Anmeldung und Discord-Dashboard.
- **Normales Mitglied:** kein Backend.
- **Owner und Admins:** Vollzugriff.

Einzelrechte vergibst du unter **Administration → Benutzer & Zugriffe**. Die Oberfläche blendet nur Bereiche ein, für die ein Recht besteht; die API prüft dieselben Rechte serverseitig. Ein ausdrücklich verknüpftes Konto kann Zugriff auf Twitch und Discord haben. Nur Owner dürfen Backend-Zugang vergeben oder entziehen, Rollen administrieren und die Kanal-Zugriffsvorlage anwenden.

Das Ticket Center (Abschnitt 9) nutzt die Rechte `discord.reports.view` und `discord.reports.edit`; Administrator- und Moderatorrolle erhalten bei der Anmeldung Basiszugriff darauf. Das Vergeben und Entziehen der Freischaltrolle steuern `discord.member.assign` und `discord.member.remove`.

## 6. Freischaltung neuer Mitglieder

### Ablauf

1. Ein neues Mitglied betritt den Server. Der Bot vergibt **keine** Freischaltrolle.
2. Dank der Kanalrechte sieht das Mitglied zunächst nur den Begrüßungskanal und den Regelkanal.
3. Der Bot begrüßt das Mitglied und verweist auf den Regelkanal.
4. Im Regelkanal steht genau eine vom Bot verwaltete Regelnachricht mit 👍. Nur eine 👍-Reaktion auf **diese** Nachricht vergibt die gewählte Freischaltrolle.
5. Das Entfernen der Reaktion nimmt die Rolle nicht zurück.
6. Wer den Server verlässt und wieder beitritt, muss erneut bestätigen.

### Einstellungen im Control Center (Discord → Freischaltung)

- Freischaltung aktivieren oder deaktivieren
- Begrüßungskanal, Regelkanal, Freischaltrolle und internen Logkanal wählen
- Willkommensnachricht und Regeltext bearbeiten (Regeltext bis 2000 Zeichen, mit Zeichenzähler)
- Regeln erstmals veröffentlichen, bestehende Regelnachricht aktualisieren
- Testnachricht in den Begrüßungskanal senden
- technische Prüfung (Berechtigungen, Rollenposition, Verknüpfung der Regelnachricht) einsehen

Beim Bearbeiten des Regeltextes kannst du nur speichern (die veröffentlichte Nachricht bleibt unverändert) oder **Speichern & Regelnachricht aktualisieren**.

### Kanalrechte setzen

Die Software ändert bestehende Kanalrechte nicht von selbst. Empfohlene Struktur:

- `@everyone`: nur Begrüßungs- und Regelkanal sichtbar
- Freischaltrolle: Community- und Social-Kanäle sichtbar
- Freischaltrolle: interne Bereiche und Logkanal nicht sichtbar
- Administrator- und Moderatorrolle: interne Bereiche sichtbar
- Warteraum (Sprache) ohne Sprechen und Streaming

Unter **Discord → Sicherheit → Zugriffsrechte** wird die Vorlage zuerst nur **geprüft** und danach ausdrücklich angewendet. Sie verändert gezielt nur `@everyone` und die gewählte Freischaltrolle; andere Rollen und Mitglieds-Overwrites bleiben erhalten. Zum Anwenden musst du `BERECHTIGUNGEN` eintippen.

Prüfe außerdem andere Rollen, die automatisch an neue Mitglieder vergeben werden. Erlaubt eine solche Rolle in öffentlichen Kategorien „Kanal ansehen“, umgeht sie die Sperre. Das Dashboard warnt vor erkannten Umgehungen. Vergibt ein anderer Bot die Freischaltrolle vorzeitig, entfernt das Control Center sie bei noch nicht bestätigten Mitgliedern wieder.

### Discords eigenes Rules Screening

Für die reine 👍-Freischaltung muss Discords natives **Rules Screening deaktiviert** sein. Solange eine native Regelannahme aussteht, blockiert Discord Reaktionen. Das Control Center erkennt den Zustand `MEMBER_VERIFICATION_GATE_ENABLED` und verhindert dann das Aktivieren.

### Sichere Inbetriebnahme

1. Unter Discord → Freischaltung die Ziele (Kanäle, Rolle) wählen und die Texte prüfen.
2. Eventuelle Warnung zur fehlenden Berechtigung „Reaktionen hinzufügen“ beheben.
3. Rules Screening deaktivieren.
4. Kanalrechte wie oben setzen.
5. **Regeln erstmals veröffentlichen**; prüfen, dass genau eine Regelnachricht existiert und der Bot 👍 gesetzt hat.
6. Testnachricht senden und in der technischen Prüfung kontrollieren, dass die Regelnachricht verknüpft ist.
7. Automatisierungen anderer Bots, die Rollen oder Willkommensnachrichten vergeben, abschalten.
8. Freischaltung aktivieren. Der Dienst prüft dabei, ob die gespeicherte Regelnachricht noch existiert, und stellt die 👍-Reaktion bei Bedarf wieder her; bestehende Kanalrechte werden nicht verändert.
9. Mit einem Testkonto neu beitreten und den ganzen Ablauf durchspielen.

Persistente Dateien, die du nicht löschen solltest: `discord-data/onboarding-config.json` und `discord-data/onboarding-state.json`. Sie enthalten Konfiguration, die Nachrichten-ID und den deduplizierten Mitgliederzustand, aber keine Tokens.

## 7. Moderation

Unter **Discord → Sicherheit → Moderation** (Übersicht, Regeln, Link-Whitelist, Sanktionen, Protokoll & Test):

- Wort- und Phrasenregeln mit Teiltreffer oder Ganzwort, erlaubten Wörtern, Rollen- und Kanal-Ausnahmen
- Löschen der Nachricht, optionale Warnung, optionaler Wiederholungs-Timeout
- Dry-Run zum Testen ohne Wirkung
- Protokoll der letzten Verstöße; vollständige Nachrichten werden nicht gespeichert, das Protokoll ist auf 2.000 Metadateneinträge begrenzt

### Link-Whitelist

Links sind grundsätzlich nicht erlaubt, außer sie stehen auf der Whitelist:

- **Erlaubte Domains**, z. B. `example.org`: gilt für alle Pfade und Unterdomains.
- **Erlaubte spezifische Links**, z. B. `twitch.tv/deinkanal`: nur dieser Host mit diesem Pfad; Query-Parameter und Anker werden ignoriert.

Administrator- und Moderatorrolle sind automatisch ausgenommen. Die normalen Regeln gelten nur für Wörter und Phrasen.

### Eskalation

Einzelne Verstöße werden gelöscht und mit einem kurzen, freundlichen, aber bestimmten Hinweis beantwortet; link- und wortbezogene Verstöße zählen gemeinsam. Die Timeout-Stufe wird erst genannt, wenn tatsächlich ein Timeout ausgesprochen wird.

Beispiel mit der Standardeinstellung (3 Verstöße, 60 Minuten Fenster, 10 Minuten Timeout):

- 3 Verstöße → 1. Timeout
- weitere 3 Verstöße → 2. Timeout
- weitere 3 Verstöße → 3. Timeout mit Hinweis auf einen Ban
- weitere 3 Verstöße → Ban

Nach einem Timeout beginnt der aktuelle Zähler bei 0. Die Stufe bleibt gespeichert, bis du sie zurücksetzt. Die Warntexte sind editierbar.

### Spam-Schutz

Unter **Moderation → Spam-Schutz** erkennt das Control Center Nachrichtenfluten, identische Wiederholungen und viele Erwähnungen in einer Nachricht. Empfohlene Startwerte:

- Nachrichtenflut: ab 6 Nachrichten in 8 Sekunden
- Wiederholungen: ab 3 identischen Nachrichten in 15 Sekunden
- Mention-Spam: ab 5 Erwähnungen

Drei Timeout-Stufen gelten nur für Spam und greifen innerhalb des Wiederholungsfensters; danach beginnt die Eskalation wieder bei Stufe 1. Ein automatischer Ban ist bewusst nicht Teil des Spam-Schutzes. Weitere Rollen und Kanäle lassen sich ausnehmen. Die kurzen Zählfenster liegen nur im Arbeitsspeicher und werden beim Neustart verworfen; ausgelöste Verstöße bleiben in der Datenbank.

### Sanktionen und Userhistorie

- **Sanktionsübersicht:** zeigt aktive Timeouts, Bans, allgemeine und Spam-Eskalationen. Berechtigte Moderatoren können einen Timeout aufheben, Timeout und Eskalation zurücksetzen, nur die Eskalation zurücksetzen oder einen Ban aufheben (Verwarnstufe danach 0). Gebannte Nutzer werden live aus der Discord-Banliste geladen.
- **Userhistorie:** zeigt pro Nutzer Verstöße, Timeouts, Bans, aufgehobene Bans, aktuelle Stufe und Zähler, letzte Regel und Ban-Grund. Die Suche findet Discord-ID, Benutzername und Ereignisinhalte. Das Zurücksetzen einer Eskalation löscht die Chronik nicht.

### Zentraler Wortfilter

Der Wortbestand wird gemeinsam mit Twitch unter **Moderation → Wortfilter** verwaltet. Frühere Discord-Regeln mit Ausnahmen bleiben als Migrationsquelle erhalten. Von Discord AutoMod bereits behandelte Nachrichten werden nicht zusätzlich gelöscht oder sanktioniert. Der Bestand wird nicht automatisch nach AutoMod gespiegelt; PostgreSQL bleibt die maßgebliche Quelle. Externe Wortlisten werden nie automatisch aktiviert; der mitgelieferte Beispielbestand startet deaktiviert im Testmodus und wird nur auf Owner-Aktion importiert.

## 8. Kanalzeiten (Nachtruhe)

Unter **Discord → Server → Kanalzeiten** gibt es eine globale Zeitsteuerung und beliebig viele Kanalprofile (Beispiel: zwei Plauderkanäle von 22:00 bis 06:00). Nach einem Update ist die Zeitsteuerung zunächst **deaktiviert**; erst nach Aktivieren und Speichern verändert der Bot Rechte.

Während der Sperrzeit verweigert der Bot der Freischaltrolle: Nachrichten senden, öffentliche und private Threads erstellen, Nachrichten in Threads senden. Die Administratorrolle lässt sich pro Kanal optional mitsperren. Unverändert bleiben Kanal ansehen, Verlauf lesen, Reaktionen, Beitreten und die Regelbestätigung, damit neue Mitglieder auch nachts freigeschaltet werden können.

Der Bot speichert beim Schließen den vorhandenen Kanal-Overwrite jeder betroffenen Rolle und stellt exakt diesen Zustand beim Öffnen wieder her; existierte keiner, wird der temporäre Overwrite entfernt. Beim Start wird der Zustand anhand der lokalen Zeit (`Europe/Berlin`) geprüft; verspätete Nachrichten werden nicht nachgeholt.

Pro Profil: **Jetzt schließen**, **Jetzt öffnen**, **Automatik fortsetzen**. Eine manuelle Übersteuerung gilt bis zum nächsten planmäßigen Wechsel. Nachrichten-Variablen: `{channel}`, `{closeTime}`, `{openTime}`.

Dateien: `discord-data/channel-times-config.json` und `discord-data/channel-times-state.json`.

## 9. Meldesystem (Ticket Center)

Der Bot registriert beim Start automatisch **Apps → Nachricht melden**, **Apps → User melden** und `/melden`. Zusätzlich kannst du unter **Discord → Meldungen → Meldesystem einrichten** einen dauerhaften Melden-Button in einem Textkanal veröffentlichen.

- **Status:** Eingang/Offen, Erledigt, Abgewiesen (Abweisen verlangt eine Begründung); Tickets lassen sich wieder öffnen.
- **Gespeichert:** Ticketnummer, Melder, gemeldeter Nutzer, Grund, Beschreibung, Kanal, Nachricht und Anhang-Metadaten sowie die vollständige Bearbeitungshistorie. Mit aktiver Anhang-Archivierung werden bis zu 6 Anhänge (höchstens 15 MB je Datei, 30 MB je Ticket) unter `discord-data/report-attachments/` abgelegt.
- **Maßnahmen:** gemeldete Nachricht löschen, Verwarnung per Direktnachricht, frei wählbarer Timeout, Ban. Jede Aktion speichert Bearbeiter und Zeitpunkt.
- **Logkanal:** neue Tickets erscheinen standardmäßig mit Nummer und Grund; Statuswechsel, Sanktionen und Löschungen sind einzeln abschaltbar.

## 10. Notfallmodus

Der Menüpunkt **Discord → Notfallmodus** ist nur für Owner und Admins sichtbar; die Endpunkte sind zusätzlich serverseitig geschützt.

**Schutzprinzip:** Betroffen ist ausschließlich die Freischaltrolle. Administrator-, Moderator- und Bot-Rolle werden nicht verändert. Regel-, Begrüßungs- und Logkanal sowie der interne Team-Kanal sind serverseitig geschützt und können nicht in eine Stufe aufgenommen werden, damit Regelbestätigung und Freischaltung auch im Notfall möglich bleiben.

**Stufen** (frei anpassbar, Text- und Sprachkanäle pro Stufe wählbar):

- **Stufe 1 · Eingeschränkt:** ausgewählte Chatkanäle für die Freischaltrolle nur lesbar.
- **Stufe 2 · Lockdown:** zusätzlich die vorgesehenen Sprachkanäle gesperrt.
- **Stufe 3 · Vollschutz:** öffentliche Community- und Social-Kanäle nur lesbar, Sprache gesperrt, Reaktionen können unterbunden werden.

**Dauer:** 15, 30, 60 oder 120 Minuten oder bis zum manuellen Beenden. Bei Ablauf beendet der Dienst den Modus selbst.

**Rechte-Snapshot:** Vor der ersten Änderung speichert der Bot für jeden Kanal den vollständigen vorhandenen Overwrite der Freischaltrolle und stellt ihn beim Beenden exakt wieder her.

**Neustarts:** Konfiguration und Zustand liegen in `discord-data/emergency-config.json` und `discord-data/emergency-state.json`; ein noch aktiver Notfallmodus wird nach einem Neustart erneut durchgesetzt. Solange er aktiv ist, ändert die Kanalzeit-Steuerung keine Rechte; danach wird der aktuelle Zeitplan ohne zusätzliche Nachricht wieder angewendet. Ein aktiver Notfallmodus blockiert aus Sicherheitsgründen auch das Wiederherstellen von Kanalzeiten- oder Notfallkonfiguration aus einer Sicherung.

## 11. Logs und Benachrichtigungen

Unter **Discord → Administration → Logs & Benachrichtigungen** (nur Admins und Owner) werden alle Discord-Lognachrichten zentral verwaltet, gegliedert in Moderation, Freischaltung & Server, Meldesystem, Kanalzeiten und System.

Pro Ereignis: aktiv oder deaktiviert, Standard-Logkanal (`#log`) oder eigener Zielkanal, editierbares Nachrichtentemplate mit sichtbaren Variablen, Test senden und Standard wiederherstellen. Zu den Ereignissen zählen u. a. Verstoß erkannt, Timeout, Ban, Ban aufgehoben, Discord AutoMod, Rolle geändert, Regeln veröffentlicht oder akzeptiert, Freischaltung fehlgeschlagen oder repariert, neues Ticket, Ticket geschlossen, Kanal geöffnet oder geschlossen, Notfallmodus aktiviert, geändert oder beendet sowie „Discord-Bot verbunden“ (standardmäßig aus).

Die Konfiguration liegt in `discord-data/discord-log-config.json`. Das interne Audit-Protokoll des Control Centers ist davon unabhängig und wird durch das Abschalten einer Discord-Meldung nicht deaktiviert.

## 12. Lagebild (Dashboard)

**Discord → Übersicht** fasst Dienst und Gateway, offene Meldungen, Moderation und aktive Eskalationen, Freischaltung, Kanalzeiten, Notfallmodus, aktuelle Fehler und Schnellzugriffe zusammen. Ein aktiver Notfallmodus steht oben. Den Social-Media-Status sehen nur Owner (auch in der Serverantwort). Das Dashboard verändert nichts.

## 13. Backup, Restore und Neustart

Unter **Administration → Systemstatus** lassen sich der Twitch-/Control-Center-Dienst, der Discord-Dienst oder beide neu starten (`restart: unless-stopped` in der Compose-Datei hält die Container aktiv).

Das zentrale Backup enthält Discord-Bereiche wie Community und Ankündigungen, Moderation und Userhistorie, Meldesystem, Kanalzeiten, Notfallmodus-Konfiguration, Logs und Social Media. **Nicht** enthalten sind Bot-Token, Client-Secret, Zugangsdaten der Social-Dienste, Anmelde-Sitzungen, aktive Rechte-Snapshots und archivierte Anhänge. Kanalzeiten werden beim Wiederherstellen über die reguläre Konfigurationslogik abgeglichen.

## 14. Sicherheitshinweise

- Interne Verwaltungsaufrufe sind durch `INTERNAL_SERVICE_SECRET` geschützt; nach einer Änderung des Secrets werden vorhandene Sitzungen ungültig.
- Anhänge aus Discord werden nur als geprüfte Rasterbilder inline angezeigt; andere Formate werden sicher heruntergeladen.
- Anfragegrößen und Downloads sind begrenzt; Code-Verzeichnisse sind schreibgeschützt eingebunden und Linux-Capabilities entfernt.
- Weitere Hinweise: [`SECURITY-HARDENING.md`](SECURITY-HARDENING.md) und [`SECURITY.md`](SECURITY.md).
