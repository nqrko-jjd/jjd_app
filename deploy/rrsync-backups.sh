#!/usr/bin/env bash
# Commande forcée pour les clés SSH « pull de sauvegarde » (NAS distants).
# Référencée dans ~/.ssh/authorized_keys via `command="…/rrsync-backups.sh"` :
# quelle que soit la commande demandée par le client SSH, c'est CE script qui
# s'exécute — sshd place la demande d'origine dans $SSH_ORIGINAL_COMMAND.
#
# On n'autorise qu'un rsync EN LECTURE (--sender = le serveur envoie, jamais
# ne reçoit) et on ignore le chemin demandé par le client pour forcer
# backups/ : une clé compromise ne peut donc ni écrire, ni lire autre chose
# sur le VPS, ni obtenir un shell.
set -euo pipefail
cd "$(dirname "$0")/.."   # racine du dépôt
BACKUP_DIR="$(pwd)/backups"

case "${SSH_ORIGINAL_COMMAND:-}" in
  "rsync --server --sender "*)
    # tout sauf le dernier mot (le chemin demandé par le client) + notre dossier à nous
    cmd="${SSH_ORIGINAL_COMMAND% *}"
    exec $cmd "$BACKUP_DIR/"
    ;;
  *)
    echo "Accès refusé : cette clé ne permet qu'une lecture (rsync) du dossier backups/." >&2
    exit 1
    ;;
esac
