#!/usr/bin/env bash
# Sauvegarde JJD : dump PostgreSQL + archive des médias (photos, PDF).
#
# Lancé automatiquement chaque semaine par .github/workflows/backup.yml (SSH
# sur le VPS, mêmes secrets que le déploiement) — peut aussi être exécuté à la
# main sur le VPS : `cd /opt/jjd && bash deploy/backup.sh`.
#
# Écrit dans backups/ à la racine du dépôt — non versionné (.gitignore), donc
# jamais touché par le `git reset --hard` du déploiement, mais sur le même
# volume disque que le reste. Conserve 45 jours (~6 sauvegardes hebdomadaires)
# puis purge automatiquement les plus anciennes.
set -euo pipefail
cd "$(dirname "$0")/.."   # racine du dépôt (VPS_PATH)

BACKUP_DIR="$(pwd)/backups"
RETENTION_DAYS=45
DATE=$(date +%F)

# récupère POSTGRES_USER / POSTGRES_DB (valeurs par défaut si non définies)
if [ -f .env.production ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.production
  set +a
fi

mkdir -p "$BACKUP_DIR"

echo "→ dump base de données…"
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec -T db pg_dump -U "${POSTGRES_USER:-jjd}" "${POSTGRES_DB:-jjd}" \
  | gzip > "$BACKUP_DIR/jjd-db-$DATE.sql.gz"

echo "→ archive des médias (photos, PDF)…"
docker run --rm -v jjd_uploads:/u -v "$BACKUP_DIR":/b alpine \
  tar czf "/b/jjd-uploads-$DATE.tar.gz" -C /u .

echo "→ purge des sauvegardes de plus de ${RETENTION_DAYS} jours…"
find "$BACKUP_DIR" -name 'jjd-db-*.sql.gz' -mtime "+${RETENTION_DAYS}" -delete
find "$BACKUP_DIR" -name 'jjd-uploads-*.tar.gz' -mtime "+${RETENTION_DAYS}" -delete

echo "→ terminé. Contenu de $BACKUP_DIR :"
du -sh "$BACKUP_DIR"/* 2>/dev/null || true
echo "   total : $(du -sh "$BACKUP_DIR" | cut -f1)"
