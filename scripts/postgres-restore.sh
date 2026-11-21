#!/bin/sh
set -eu
if [ "${2:-}" != "--yes" ]; then
  echo "Aufruf: $0 backups/postgres/DATEI.dump --yes" >&2
  echo "Achtung: Die aktuelle PostgreSQL-Datenbank wird ersetzt." >&2
  exit 2
fi
DUMP="$1"
case "$DUMP" in
  /*) ;;
  *) DUMP="$(pwd)/$DUMP" ;;
esac
cd "$(dirname "$0")/.."
[ -f "$DUMP" ] || { echo "Dump nicht gefunden: $DUMP" >&2; exit 1; }
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  echo "Docker Compose CLI nicht gefunden." >&2
  exit 1
fi
# Dienstnamen seit 9.0.0: db, web, twitch, discord (mcp liest nur und wird mit angehalten, falls vorhanden).
SERVICES="$($DC config --services | grep -E '^(web|twitch|discord|mcp)$' | tr '\n' ' ')"
[ -n "$SERVICES" ] || { echo "Keine Dienste web/twitch/discord in der compose.yaml gefunden." >&2; exit 1; }
$DC stop $SERVICES
cat "$DUMP" | $DC exec -T db pg_restore -U bwk -d bwk --clean --if-exists --no-owner --no-privileges
$DC start $SERVICES
echo "PostgreSQL-Restore abgeschlossen. Systemstatus und Datenbankseite jetzt prüfen."
