# Installation (neue, eigene Installation)

Diese Anleitung gilt für eine frische Installation des Bot Control Centers auf Docker – auf einer NAS, einem eigenen Server (VPS) oder einem Windows-/Mac-Rechner mit Docker Desktop. Das Programm ist Docker-only; eine Installation ohne Docker gibt es nicht.

Automatische Updates (Update-Werkzeug, auf Linux/NAS) richtest du nach der Installation mit [`tools/deploy/UPDATER-EINRICHTEN.md`](../deploy/UPDATER-EINRICHTEN.md) ein; technische Einzelheiten stehen in [`tools/deploy/PULL-DEPLOYMENT.md`](../deploy/PULL-DEPLOYMENT.md).

## Das brauchst du
- **Docker** mit Docker Compose (Version 2: `docker compose`).
- Eine **Twitch-Anwendung** (dev.twitch.tv → Console → „Register Your Application“): liefert Client-ID und Client-Secret. Die Weiterleitungsadressen trägst du erst nach der Ersteinrichtung ein (Schritt 6).
- Mindestens **ein Twitch-Konto für den Haupt-Bot** (mit Moderationsrechten in deinem Kanal) und **dein Kanal-Konto**.
- Optional für Discord: eine **Discord-Anwendung** (discord.com/developers) mit Bot-Token und Client-Secret, der Bot auf deinem Server.
- Eine **Adresse**, unter der das Control Center erreichbar ist: eine eigene Domain mit https (nötig für die Anmeldung über Twitch und Discord und für OBS-Overlays von außen) oder rein lokal `http://localhost:3000`.

## 1. Dateien holen
Das neueste Release auf GitHub öffnen und die Datei `bwk-control-center-vX.Y.Z.zip` in einen leeren Projektordner entpacken, z. B. `/opt/bcc` (Linux), `/volume1/docker/bcc` (Synology) oder `C:\bcc` (Windows). Das ZIP enthält den Programmcode, `docker/` und `scripts/`, aber **nicht** die Compose-Vorlage: Sie liegt im Repository unter [`tools/compose/compose.yaml`](compose.yaml) (auf GitHub öffnen und „Raw“ speichern). In den Projektordner kopieren und als `compose.yaml` speichern (eine vorhandene alte `compose.yaml` aus dem ZIP dabei ersetzen). Das Docker-Image für die Bots wird beim ersten Start aus `docker/node-pg.Dockerfile` gebaut.

## 2. Zugangsdaten als Dateien anlegen
Im Projektordner den Ordner `secrets/` anlegen und die Dateien erstellen, die in [`secrets/README.txt`](../../secrets/README.txt) stehen (jede Datei enthält nur den Wert, ohne Namen und Anführungszeichen):

| Datei | Inhalt |
|---|---|
| `postgres_password.txt` | frei gewähltes Datenbankpasswort (später nicht mehr ändern) |
| `twitch_client_secret.txt` | Client-Secret deiner Twitch-Anwendung |
| `local_admin_password.txt` | Passwort für den lokalen Admin-Login (nur aus dem lokalen Netz nutzbar) |
| `internal_service_secret.txt` | zufälliger Wert, mindestens 32 Zeichen |
| `discord_client_secret.txt`, `discord_bot_token.txt` | nur bei Discord |
| `mcp_token.txt`, `mcp_db_password.txt` | nur, wenn der optionale MCP-Dienst genutzt wird |

Unter Linux/Synology gehören sie dem Benutzer 1000 mit Modus 400 (`sudo chown 1000:1000 secrets/*.txt && sudo chmod 400 secrets/*.txt`). Unter Docker Desktop (Windows/Mac) genügt das Anlegen der Dateien.

## 3. `compose.yaml` anpassen
In der kopierten Datei die Platzhalter ersetzen:
- `TWITCH_CLIENT_ID`: Client-ID deiner Twitch-Anwendung.
- `bot.example.org` (mehrfach: `PUBLIC_BASE_URL`, `TWITCH_REDIRECT_URI`, `TWITCH_CONNECTION_REDIRECT_URI`, `ALLOWED_HOSTS`, `STUBENKONTROLLE_ALLOWED_ORIGINS`, `DISCORD_REDIRECT_URI`, `TWITCH_HEALTH_HOST`): deine Adresse. Rein lokal: `PUBLIC_BASE_URL: "http://localhost:3000"` und die Weiterleitungsadressen entsprechend.
- `LOCAL_NETWORK_PREFIX` / `LOCAL_NETWORK_CIDRS`: dein Heimnetz (z. B. `192.168.1.`), damit der lokale Admin-Login funktioniert.
- `TWITCH_CHANNEL_LOGIN` leer lassen: Der Kanal wird in der Ersteinrichtung gesetzt.
- Ohne Discord den Dienst `discord` und ohne MCP den Dienst `mcp` entfernen.

Die Ports (3000 für die Weboberfläche) nur nach außen öffnen, wenn du keinen Reverse-Proxy davor setzt.

## 4. Starten
```bash
cd /pfad/zum/projektordner
docker compose up -d --build
docker compose ps
```
Alle Dienste sollten nach kurzer Zeit `healthy` bzw. `running` zeigen.

## 5. Ersteinrichtung
1. Weboberfläche öffnen (`https://bot.example.org` bzw. `http://localhost:3000`). Es erscheint der Einrichtungsassistent.
2. Den **Einrichtungscode** aus dem Protokoll des Containers `bcc-web` holen (Zeile „ERSTEINRICHTUNG – Einrichtungscode“):
   - **Synology:** Container Manager → Container → `bcc-web` → Protokoll
   - **Linux/VPS:** `docker logs bcc-web`
   - **Windows/Mac:** Docker Desktop → Containers → `bcc-web` → Logs
3. Die Schritte ausfüllen: Name der Oberfläche, öffentliche Adresse, **Kanal-Login und Haupt-Bot**, optional **Discord-Server-ID**, Punktespiel. Dann „Einrichtung abschließen“.

## 6. Weiterleitungsadressen eintragen und anmelden
Nach dem Abschluss zeigt der Assistent die Weiterleitungsadressen (später jederzeit unter Administration → Adresse):
- **Twitch:** dev.twitch.tv → deine Anwendung → „OAuth Redirect URLs“ (beide Twitch-Adressen).
- **Discord:** discord.com/developers → deine Anwendung → OAuth2 → „Redirects“.

Danach mit dem **Twitch-Konto des Kanals** anmelden: Es erhält automatisch Owner-Rechte. Anschließend unter Administration → Twitch-Verbindungen den Haupt-Bot (und weitere Bots) mit Twitch verbinden und bei Bedarf unter Discord → Rollen die Rollen zuordnen.

## Plattformhinweise

**Synology (DSM, Container Manager):** Projektordner unter `/volume1/docker/…` anlegen, Compose per SSH starten (`sudo docker compose up -d --build`) oder als Projekt im Container Manager importieren. Reverse-Proxy: DSM → Anmeldeportal → Erweitert → Reverse-Proxy (HTTPS 443 → HTTP `localhost:3000`) mit gültigem Zertifikat; WebSocket-Header für die Overlays aktivieren.

**Linux/VPS:** Docker und das Compose-Plugin installieren, Projektordner anlegen, dann wie oben. Für https einen Reverse-Proxy (z. B. Caddy oder nginx mit Let's-Encrypt-Zertifikat) auf `localhost:3000` setzen; `TRUSTED_PROXY_CIDRS` in der `compose.yaml` auf die Proxy-Adresse setzen. Nur die Proxy-Ports (80/443) öffnen.

**Windows/Mac (Docker Desktop):** Reiner Heimbetrieb mit `http://localhost:3000`. Für Zugriff aus dem Internet oder für OBS auf einem anderen Rechner brauchst du eine echte Adresse mit https. Der Rechner muss laufen, damit die Bots online sind.

## Sicherung und Updates
- Datenbank sichern: Skripte in `scripts/` (Sicherung und Wiederherstellung); die Seite Administration → Backup / Restore deckt die Einstellungen und Bilder ab.
- Updates **automatisch** (Linux/NAS): Update-Werkzeug nach [`UPDATER-EINRICHTEN.md`](../deploy/UPDATER-EINRICHTEN.md) einrichten. Neue Versionen erscheinen dann unter Administration → Updates und werden erst nach deiner Freigabe installiert.
- Updates **von Hand** (z. B. Docker Desktop): das neue Release-ZIP wie in Schritt 1 über den Projektordner entpacken (die eigene `compose.yaml` und `secrets/` dabei nicht überschreiben) und `docker compose up -d --build` ausführen. Die Hinweise des Releases (`UPDATE-<Version>.md`) vorher lesen.
