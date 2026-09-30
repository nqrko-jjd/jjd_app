#!/usr/bin/env bash
# Database + media checkpoint. Published filenames appear only after verification.
set -euo pipefail
cd "$(dirname "$0")/.."
BACKUP_DIR="$(pwd)/backups"
RETENTION_DAYS=45
BACKUP_STAMP=$(date -u +%Y-%m-%dT%H-%M-%SZ)-$$
if [ -f .env.production ]; then
  set -a
  source .env.production
  set +a
fi
mkdir -p "$BACKUP_DIR"
umask 077
BACKUP_TMP=$(mktemp -d "$BACKUP_DIR/.pending-XXXXXX")
trap 'rm -rf "$BACKUP_TMP"' EXIT
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env.production)
"${COMPOSE[@]}" exec -T db pg_dump -U "${POSTGRES_USER:-jjd}" "${POSTGRES_DB:-jjd}" | gzip > "$BACKUP_TMP/db.sql.gz"
gzip -t "$BACKUP_TMP/db.sql.gz"
# Read the exact volume mounted by the API, not a guessed Docker volume name.
"${COMPOSE[@]}" exec -T api tar czf - -C /repo/apps/api/uploads . > "$BACKUP_TMP/uploads.tar.gz"
tar tzf "$BACKUP_TMP/uploads.tar.gz" >/dev/null
mv "$BACKUP_TMP/db.sql.gz" "$BACKUP_DIR/jjd-db-$BACKUP_STAMP.sql.gz"
mv "$BACKUP_TMP/uploads.tar.gz" "$BACKUP_DIR/jjd-uploads-$BACKUP_STAMP.tar.gz"
(cd "$BACKUP_DIR" && sha256sum "jjd-db-$BACKUP_STAMP.sql.gz" "jjd-uploads-$BACKUP_STAMP.tar.gz" > "jjd-$BACKUP_STAMP.sha256")
find "$BACKUP_DIR" -type f \( -name 'jjd-db-*.sql.gz' -o -name 'jjd-uploads-*.tar.gz' -o -name 'jjd-*.sha256' \) -mtime "+$RETENTION_DAYS" -delete
printf 'Sauvegarde vérifiée : %s\n' "$BACKUP_STAMP"
