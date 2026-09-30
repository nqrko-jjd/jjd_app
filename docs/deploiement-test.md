# Déploiement de l'environnement de test (`/opt/jjd-test`)

Environnement isolé, sur le VPS, permettant de tester n'importe quelle
branche ou pull request avec une copie des vraies données (base + médias),
**sans jamais toucher à la production** (`/opt/jjd`, `new.jjd-consult.be`).

## Utilisation depuis GitHub (aucune commande SSH nécessaire)

Onglet **Actions** du dépôt :

- **Déploiement environnement de test** → *Run workflow* → renseigner `ref` :
  - un nom de branche (ex. `redesign/jjd-ui`)
  - ou `pr-<numéro>` pour une pull request (ex. `pr-2`)
- **Statut environnement de test** → *Run workflow* (sans paramètre) : affiche
  la branche/commit actuellement déployés et l'état des conteneurs.

Ou en ligne de commande (`gh` CLI), pour Codex comme pour moi :

```bash
gh workflow run deploy-test.yml -f ref=redesign/jjd-ui
gh workflow run deploy-test.yml -f ref=pr-2
gh workflow run test-status.yml
gh run watch <run-id>
```

Le résumé du run GitHub Actions (onglet du run, section *Summary*) affiche la
référence déployée, le commit exact, et confirme l'état sain des conteneurs —
sans avoir besoin de se connecter au VPS.

## Accès au résultat

Le web de test n'est **jamais exposé publiquement**. Accès uniquement via le
tunnel SSH existant, depuis une machine ayant la clé `bricoloc-vps` :

```bash
ssh -L 8180:localhost:8180 bricoloc-vps
```

puis `http://localhost:8180`.

## Ce que fait — et ne fait jamais — ce mécanisme

Fait à chaque déploiement :
1. Récupère la référence demandée (branche ou PR) depuis GitHub.
2. Met à jour le code de `/opt/jjd-test` (préserve `.env.test` et
   `docker-compose.test.yml`, jamais commités, restaurés automatiquement
   même si un commit testé introduisait un fichier au même chemin).
3. Reconstruit les images `api`/`web` de test.
4. **Vérifie le schéma Prisma cible contre la vraie base de test** — si un
   changement est nécessaire, **le déploiement s'arrête immédiatement**
   (les conteneurs ne sont pas remplacés) : une intervention manuelle est
   requise, comme pour la production (migration SQL explicite testée avant
   application — voir l'historique des bascules précédentes).
5. Si le schéma est déjà synchronisé, remplace uniquement les conteneurs
   `jjd-test-api` / `jjd-test-web`, vérifie qu'ils redeviennent sains.
6. Écrit `/opt/jjd-test/DEPLOYED.md` (branche, commit, date).

Ne fait jamais :
- Ne touche pas `/opt/jjd` (production) ni ses secrets.
- Ne recrée ni ne vide jamais les volumes `db` / `uploads` de test.
- N'active aucune intégration externe (e-mail, Peppol, Google Agenda, Ponto,
  Bricoloc, assistant IA) — `.env.test` les laisse toutes vides.
- N'expose rien publiquement — pas de port ouvert, pas de sous-domaine.
- Ne fusionne rien, ne touche à aucune pull request.

## Sécurité — pourquoi une fuite du secret ne met rien en danger

- Secrets dédiés, distincts de ceux de production : `JJD_TEST_HOST`,
  `JJD_TEST_USER`, `JJD_TEST_SSH_KEY`. La clé privée n'est jamais affichée
  ni committée.
- Côté VPS, cette clé est déclarée dans `~/.ssh/authorized_keys` avec une
  **commande forcée** :
  ```
  command="/opt/jjd-test-deploy.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 …
  ```
  Quoi que le client envoie comme « commande » SSH, **seul ce script peut
  s'exécuter** — jamais un shell arbitraire. Le contenu envoyé est lu comme
  simple donnée (`$SSH_ORIGINAL_COMMAND`), validé par une expression
  régulière stricte (`^[A-Za-z0-9._/-]+$`) avant tout usage. Testé et
  confirmé : une tentative d'injection (`whoami; rm -rf /opt/jjd`) est
  rejetée sans exécution.
- Le script (`/opt/jjd-test-deploy.sh`) vit **hors du dépôt git**
  (`/opt/jjd-test-deploy.sh`, pas dans `/opt/jjd-test/`), donc aucun commit
  testé ne peut le modifier ou le remplacer.
- Les entrées `ref` des workflows passent par des variables d'environnement
  (jamais interpolées directement dans un script shell) pour éviter toute
  injection côté runner GitHub.

## Mise à jour manuelle initiale (déjà faite le 2026-09-30)

L'environnement `/opt/jjd-test` lui-même (clone initial, `.env.test`,
`docker-compose.test.yml`, restauration base + médias) a été mis en place une
fois manuellement — voir l'historique de session. Ce document couvre
uniquement le mécanisme de redéploiement automatisé mis en place ensuite.
