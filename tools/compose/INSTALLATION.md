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

## Zweite Installation auf demselben Rechner (z. B. Testinstanz)
Du kannst auf demselben Rechner eine zweite, getrennte Installation betreiben, etwa zum Ausprobieren mit einem Testkanal. Die Vorlage ist dafür nicht ohne Änderung geeignet, weil mehrere Namen **fest** vergeben sind. Ohne Anpassung scheitert der Start („name already in use“) oder, schlimmer, beide Installationen hängen im selben Docker-Netz und könnten einander erreichen.

**Eigener Projektordner:** neuer, leerer Ordner (z. B. `/opt/bcc-test`) mit eigener Programmkopie (Schritt 1), eigener `compose.yaml`, eigenem `secrets/`, `data/`, `discord-data/` und `postgres-data/`. Nichts aus dem Ordner der ersten Installation mitbenutzen.

**In der `compose.yaml` der zweiten Installation ändern:**
- **Containernamen:** alle `container_name` (`bcc-db`, `bcc-web`, `bcc-twitch`, `bcc-discord`, `bcc-mcp`) umbenennen, z. B. mit Präfix `bcct-`. Keine Variablen wie `${PRAEFIX}` verwenden: Das Update-Werkzeug liest den Namen des Datenbank-Containers direkt aus der Datei.
- **Netz:** unter `networks` → `default` → `name` einen **eigenen Netznamen** eintragen (z. B. `bcct-net`). Das ist der wichtigste Punkt: Ein gleicher Netzname verbindet beide Installationen, und die Dienstnamen `db`, `web`, `twitch`, `discord` würden doppelt vergeben.
- **Port:** beim Dienst `web` den Host-Port ändern, z. B. `"3010:3000"`. Reverse-Proxy und Browser verwenden dann `localhost:3010`.
- **Image-Name:** `bwk-node-pg:7.2.0` (dreimal) umbenennen, z. B. `bcct-node-pg:7.2.0`, damit sich beide Installationen nie ein Image teilen.
- **Adresse:** eigene Adresse für die Platzhalter `bot.example.org` (siehe Schritt 3), z. B. eine eigene Subdomain mit eigenem Zertifikat und eigenem Reverse-Proxy-Eintrag auf den neuen Port (WebSocket-Header für die Overlays aktivieren).
- **`TRUSTED_PROXY_CIDRS`:** Das Gateway des neuen Netzes hat eine andere Adresse. Nach dem ersten Start mit `docker network inspect <netzname>` ansehen (Feld „Gateway“), in die `compose.yaml` eintragen und den Dienst `web` neu starten.
- **`DISCORD_SERVICE_LABEL`** (zweimal) auf den neuen Containernamen setzen; das ist nur die Anzeige im Systemstatus.
- Den Dienst `mcp` weglassen, wenn du ihn nicht brauchst.

Beispiel für die Umbenennungen (Präfix `bcct-`, Netz `bcct-net`, Port 3010), vorher eine Kopie der Datei anlegen und das Ergebnis lesen:
```bash
sed -i 's/bcc-/bcct-/g; s/bwk-node-pg/bcct-node-pg/g; s/name: bwk-control-center/name: bcct-net/; s/"3000:3000"/"3010:3000"/' compose.yaml
```

**Eigene Zugänge:** Jede Installation braucht ihre **eigene Twitch-Anwendung** (Client-ID und Secret, mit der Weiterleitungsadresse der zweiten Installation), eigene Bot- und Kanal-Konten und, wenn du Discord nutzt, eine **eigene Discord-Anwendung mit eigenem Bot-Token** und einen eigenen Server. Dieselben Tokens dürfen nie in zwei Installationen gleichzeitig laufen (doppelte Antworten, getrennte Verbindungen).

**Update-Werkzeug:** Die zweite Installation bekommt ihre eigene Einrichtung nach [`UPDATER-EINRICHTEN.md`](../deploy/UPDATER-EINRICHTEN.md) (eigener Zeitplan-Eintrag, `deploy/` im eigenen Projektordner). Prüfe in `deploy/work/pull/config.json`, dass `db_container` auf den neuen Namen zeigt.

**Last:** Jede Installation braucht eigenen Arbeitsspeicher (PostgreSQL und die Bots). Auf kleinen Geräten die Testinstanz nur bei Bedarf laufen lassen.

## Sicherung und Updates
- Datenbank sichern: Skripte in `scripts/` (Sicherung und Wiederherstellung); die Seite Administration → Backup / Restore deckt die Einstellungen und Bilder ab.
- Updates **automatisch** (Linux/NAS): Update-Werkzeug nach [`UPDATER-EINRICHTEN.md`](../deploy/UPDATER-EINRICHTEN.md) einrichten. Neue Versionen erscheinen dann unter Administration → Updates und werden erst nach deiner Freigabe installiert.
- Updates **von Hand** (z. B. Docker Desktop): das neue Release-ZIP wie in Schritt 1 über den Projektordner entpacken (die eigene `compose.yaml` und `secrets/` dabei nicht überschreiben) und `docker compose up -d --build` ausführen. Die Hinweise des Releases (`UPDATE-<Version>.md`) vorher lesen.
