Secrets für das Bot Control Center (ab 8.8.0 alle als Dateien)

Jede Datei enthält NUR den Wert: kein Name, keine Anführungszeichen. Ein Zeilenumbruch am
Ende wird vom Programm entfernt. Dateien dieses Ordners nie in Pakete, Chats, Screenshots
oder öffentliche Repositories legen.

Datei                       Dienst                     Zweck
postgres_password.txt       postgres, twitchbot,       Datenbankpasswort
                            discordbot
twitch_client_secret.txt    twitchbot                  Twitch-Client-Secret
local_admin_password.txt    twitchbot                  Passwort des lokalen Admin-Logins
internal_service_secret.txt twitchbot UND discordbot   gemeinsames Service-Secret, mindestens
                                                       32 Zeichen, in beiden Diensten derselbe Wert
discord_client_secret.txt   discordbot                 Discord-Client-Secret
discord_bot_token.txt       discordbot                 Discord-Bot-Token

Optional (nur wenn genutzt; in der compose.yaml wie die anderen als Secret deklarieren und
INSTAGRAM_ACCESS_TOKEN_FILE bzw. TIKTOK_CLIENT_SECRET_FILE setzen):
instagram_access_token.txt, tiktok_client_secret.txt
Weitere unterstützte Namen: TIKTOK_ACCESS_TOKEN_FILE, TIKTOK_REFRESH_TOKEN_FILE.

Rechte
- Eigene Secret-Dateien: Besitzer 1000:1000, Modus 400 (die Bots laufen als Benutzer 1000).
- Datei anlegen, ohne dass der Wert auf dem Bildschirm oder im Shell-Verlauf landet:
    mk() { sudo sh -c 'umask 077; printf "%s: " "$1"; stty -echo; read V; stty echo; echo; printf "%s" "$V" > "secrets/$1.txt"' _ "$1"; sudo chown 1000:1000 "secrets/$1.txt"; sudo chmod 400 "secrets/$1.txt"; }
    mk twitch_client_secret
  Danach die betroffenen Dienste neu erstellen (docker compose up -d twitchbot discordbot);
  im Log steht "Secret-Quellen: …=datei".

postgres_password.txt
- Nach der ersten Initialisierung von PostgreSQL UNVERÄNDERT lassen: PostgreSQL nutzt das im
  Datenverzeichnis gespeicherte Passwort. Wer die Datei später ersetzt, ohne das Rollenpasswort
  in der Datenbank zu ändern, trennt die Bots von der Datenbank.
- Muss für Postgres und für Benutzer 1000 lesbar sein (bisher 1026:100, Modus 755).

Rotation (z. B. Discord-Bot-Token)
- Neuen Wert beim Anbieter erzeugen, Datei mit mk überschreiben (die Datei ist schreibgeschützt;
  mk legt sie neu an), betroffenen Dienst neu erstellen, im Log "=datei" prüfen.
- INTERNAL_SERVICE_SECRET immer in BEIDEN Diensten gemeinsam ändern.

Sicherung
- Diesen Ordner zusammen mit der produktiven compose.yaml in die geschützte NAS-Sicherung
  aufnehmen, getrennt von öffentlich weitergegebenen Anwendungspaketen. Ohne diese Dateien startet
  die Anlage nach einem Neuaufbau nicht.
- Sicherungskopien der compose.yaml enthalten seit der Umstellung keine Secrets mehr; ältere
  Kopien (vor 8.7.3) enthalten sie im Klartext und gehören an einen geschützten Ort.
