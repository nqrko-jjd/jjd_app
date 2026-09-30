#!/usr/bin/env bash
# Database + media checkpoint. Published filenames appear only after verification.
#
# Au plus une sauvegarde complète par jour (UTC) : le déploiement l'appelle à
# chaque push sur main, et plusieurs pushes le même jour ne doivent pas
# multiplier les ~4 Go de médias à chaque fois (vécu le 2026-09-30 : 16
# sauvegardes en une journée, disque VPS à 99%). BACKUP_FORCE=1 force quand
# même une sauvegarde fraîche (ex. juste avant une migration risquée).
set -euo pipefail
cd "$(dirname "$0")/.."
BACKUP_DIR="$(pwd)/backups"
RETENTION_DAYS=45
TODAY=$(date -u +%Y-%m-%d)
BACKUP_STAMP="${TODAY}T$(date -u +%H-%M-%SZ)-$$"
if [ -f .env.production ]; then
  set -a
  source .env.production
  set +a
fi
mkdir -p "$BACKUP_DIR"
if [ "${BACKUP_FORCE:-0}" != "1" ] && ls "$BACKUP_DIR"/jjd-db-"${TODAY}"T*.sql.gz >/dev/null 2>&1; then
  echo "→ Sauvegarde déjà faite aujourd'hui ($TODAY) — rien à faire (BACKUP_FORCE=1 pour forcer)."
  exit 0
fi
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
