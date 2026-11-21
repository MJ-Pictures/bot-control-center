# V7.0.1 – Security Regression Tests

Prüfart: statische Quellcodeprüfung und isolierte Source-Assertions im Build-Artefakt. Es wurde **kein automatisches Deployment** und kein produktiver Last-/OAuth-/Discord-Test ausgeführt.

## Ergebnis

| Bereich | Prüfung | Ergebnis |
| --- | --- | --- |
| F01 Autorisierung | Backup ist explizit Owner-only; User/System Admin/Owner; API Default-Deny vorhanden | BESTANDEN |
| F01 Route-Matrix | 104 im Backend erkannte literale `/api/`-Routen gegen Capability/privilegierte/öffentliche/explizite Matrix geprüft | BESTANDEN |
| F02 Anhänge | Magic-Byte-Rasterprüfung; unbekannte/aktive Inhalte als Download; nosniff/Sandbox | BESTANDEN |
| F03 Rechteentzug | Sessionrevision, managed-disable, Sessioninvalidierung und begrenzter Rollen-Snapshot vorhanden | BESTANDEN |
| F04 Logout | POST-Logout entfernt Session im Store; Logout-All vorhanden | BESTANDEN |
| F05 OAuth | TTL, Browser-/Sessionbindung und PKCE S256 in Login-/Verbindungsflows vorhanden | BESTANDEN |
| F06 lokaler Admin | kein Hostpräfix als LAN-Nachweis; CIDR- und Trusted-Proxy-Prüfung vorhanden | BESTANDEN |
| F07 Dienstauth | gemeinsames internes Secret und serverseitige Timing-Safe-Prüfung vorhanden | BESTANDEN |
| F08 Limits | begrenzte JSON-Bodies, Backup-Sonderlimit und Streaming-Downloadlimits vorhanden | BESTANDEN |
| F09 Browserheader | CSP, Frame-Schutz, nosniff, Referrer-Policy, Permissions-Policy und HSTS-Logik vorhanden | BESTANDEN |
| F10 Cookies/WS | fehlerhafte Cookie-Decodierung abgefangen; WebSocket-Origin/Clientlimit/Upgradepfad/Keyrotation geprüft | BESTANDEN |
| Container | read-only Code, no-new-privileges, cap_drop ALL, PID/RAM-Limits | BESTANDEN |
| Syntax | Hauptbackend, Discordbackend, Frontend, Stubenkontrolle und beide Supervisoren mit `node --check` | BESTANDEN |

## Autorisierung – erwartete Matrix

| Benutzer | Backup Export/Restore | System-Neustart | Benutzerverwaltung |
| --- | --- | --- | --- |
| nur `twitch.dashboard.view` | 403 | 403 | 403 |
| gewöhnlicher Twitch-Moderator ohne Adminrecht | 403 | 403 | 403 |
| Discord-only Benutzer | 403 | 403 | 403 |
| globaler Admin | 403 | erlaubt | erlaubt |
| globaler Owner | erlaubt | erlaubt | erlaubt |

Der Backup-Bereich bleibt absichtlich strenger als die übrige Administration, da ein Benutzer-Restore globale Owner-Rechte schreiben kann.

## Sessionmigration

`SECURITY_SESSION_REVISION` wurde erhöht. Sitzungen aus dem Stand vor V7.0.1 werden abgelehnt und aus dem Sessionstore entfernt, sobald sie verwendet werden. Benutzer müssen sich erneut anmelden.

## API Default Deny

Beim Build wurden alle im Backend statisch erkennbaren literalen `/api/`-Routen erfasst. Jede davon ist mindestens einer der folgenden Gruppen zugeordnet:

- konkrete Capability
- explizite globale Admin-/Owner-Route
- explizit guardete Spezialroute
- bewusst öffentliche API

Nicht zugeordnete zukünftige `/api/`-Routen werden mit 403 abgewiesen.

## Grenzen der Buildtests

Nicht automatisiert gegen Produktionsanbieter getestet:

- echte Twitch-/Discord-OAuth-Callbacks
- tatsächliche externe Rollenentzüge nach zehn Minuten
- echtes Synology-Reverse-Proxy-Headerverhalten
- reale Discord-Anhanguploads
- Last-/Speichererschöpfung
- echte Docker-Rechte unter `user: node`

Diese Punkte müssen nach Deployment schonend als Smoke-Test beziehungsweise Infrastrukturprüfung erfolgen.
