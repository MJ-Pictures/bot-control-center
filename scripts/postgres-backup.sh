#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p backups/postgres
STAMP=$(date '+%Y%m%d-%H%M%S')
OUT="backups/postgres/bwk-${STAMP}.dump"
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  echo "Docker Compose CLI nicht gefunden." >&2
  exit 1
fi
$DC exec -T db pg_dump -U bwk -d bwk -Fc > "$OUT"
echo "Backup erstellt: $OUT"
