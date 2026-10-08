# JJD App — document de remise (8 octobre 2026)

Ce document résume ce que fait l'application, comment elle se déploie, comment la sauvegarder et la réparer, et ce qui reste à surveiller.
Il complète les guides plus détaillés du dossier `docs/` (déploiement, Ponto, Peppol, boîte mail des factures, quotas de l'assistant…).

## 1. Ce que fait l'application

| Domaine | Où le trouver | À retenir |
|---|---|---|
| Chantiers (R-xxx) | Chantiers | Fiche avec onglets : Vue d'ensemble (chiffres + « à suivre »), Planning (Gantt), Tâches, Finances & rentabilité, Photos & rapports, Documents (cahier des charges + fichiers), **Suivi mails** (bureau seulement), Discussion (équipes) |
| Pipeline | Pipeline | Pistes commerciales ; une demande de devis a toujours son R- (statut « Devis à rédiger ») |
| Boîte IA | Boîte IA | Lit la boîte info@ ; propose : piste + R-, rendez-vous, note, intervention « à confirmer ». Rien n'est créé sans validation. Les notes et mails vont dans le **Suivi mails** du chantier, jamais dans le fil des équipes |
| Devis & factures | Devis & factures | PDF, e-mail, **Peppol** (envoi seul), signature électronique par lien, duplication, import de PDF (choix du type à l'import), notes de crédit |
| Achats / dépenses | Achats | Factures d'achat, listes d'achats, bons de commande |
| Banque | Finances → Banque | Synchro **Ponto** (2 comptes) + rapprochement automatique avec les factures |
| Planning & pointage | Planning, Pointage | Interventions, rendez-vous (rattachables à une « charge » E-xx si pas de chantier), pointage des heures, décomptes |
| Équipe, flotte, matériel, stock | Répertoires | Fiches personnes (sous-traitants, employés), véhicules, matériel, stock avec scan et étiquettes |
| Portail client | /portail | Suivi des interventions et des devis pour les syndics / clients |
| Application mobile | apps/mobile | Pointage et rapports des équipes |

Profils : `admin`, `office` (bureau), `foreman` (chef de chantier), `worker`, `storekeeper`, `client`.
Le **Suivi mails** et les opérations d'administration sont réservés à admin et bureau. L'IA payante (cahier des charges, liste d'achats, assistant) est réservée à la direction (David et Julien) et plafonnée par un budget mensuel.

## 2. Intégrations externes

- **Ponto Connect** (mode personnalisé) : paiements bancaires. La synchro repart toujours des opérations les plus récentes et s'arrête à la première page déjà connue. Si un paiement manque : vérifier d'abord côté Ponto (la banque transmet parfois avec un jour de retard).
- **Recommand** (Peppol) : envoi des factures aux clients professionnels belges. Réception : toujours via le comptable. Une ligne à 0 % part en « autoliquidation » avec son motif.
- **SMTP** : envoi des devis et factures par e-mail.
- **Boîte IMAP info@** : alimente la Boîte IA et la lecture des factures d'achat (lecture seule, la boîte n'est jamais modifiée).
- **Google Agenda** : les interventions du planning sont poussées vers l'agenda ; les fiches importées de Google (faites à la main) ne sont jamais réécrites.
- **Anthropic** : analyse des mails, cahier des charges, liste d'achats, assistant (budget mensuel).

Les clés et mots de passe sont dans `/opt/jjd/.env.production` sur le serveur (jamais dans le dépôt). Modèle : `deploy/.env.production.example`.

## 3. Mise en ligne

1. Pousser sur la branche `main` du dépôt `nqrko-jjd/jjd_app`.
2. GitHub Actions lance `deploy/backup.sh` (sauvegarde), met le serveur à jour et reconstruit les conteneurs (`docker compose up -d --build`) : environ 5 minutes.
3. Les changements de base de données sont **additifs** (colonnes ou tables en plus, jamais de suppression ni de champ obligatoire).

Serveur : `ssh bricoloc-vps`. Conteneurs : `jjd-web`, `jjd-api` (production), `jjd-db-1` (PostgreSQL), plus un environnement de test `jjd-test-*`.

## 4. Sauvegardes et reprise

- Une sauvegarde est faite **à chaque mise en ligne** : base (`jjd-db-*.sql.gz`), fichiers (`jjd-uploads-*.tar.gz`) et somme de contrôle, dans `/opt/jjd/backups`.
- ⚠️ Il n'y a **pas de sauvegarde automatique quotidienne** : sans mise en ligne pendant plusieurs jours, il n'y a pas de sauvegarde récente. À ajouter (tâche planifiée sur le serveur qui lance `deploy/backup.sh`).
- ⚠️ Le disque du serveur est rempli à environ 80 % (backups : environ 22 Go). Surveiller, ou réduire la durée de conservation dans `deploy/backup.sh`.
- Avant toute opération sur les données, les scripts de maintenance écrivent une sauvegarde JSON sous `uploads/_private/backups/`.

## 5. Opérations de maintenance sur les données

Les corrections de données (déplacer des pointages, scinder un chantier, rattacher des documents…) se font par de petits scripts dans `apps/api/scripts/` :

1. copier le script sur le serveur et dans le conteneur `jjd-api` ;
2. `docker exec jjd-api node --import tsx scripts/<script>.ts` : **simulation**, rien n'est écrit ;
3. relire le résultat, puis relancer avec `--apply`.

Règles : sauvegarde avant écriture, pas de suppression sans accord, chaque commande lancée une seule fois.

## 6. Contrôles effectués le 8 octobre 2026

- 34 pages parcourues sur ordinateur et sur mobile : aucune erreur de script, aucune page vide, aucun défilement horizontal.
- Tests de l'API : 417 réussis sur 433. Les 16 échecs viennent de tests qui supposent des données déjà présentes (fiches de personnes, comptes du portail, opérations bancaires) ; ils n'affectent pas la production.
- Mises en ligne du jour : toutes réussies.

## 7. Reste à faire / à surveiller

- Ajouter la sauvegarde quotidienne automatique et surveiller le disque (voir §4).
- Rendre les 16 tests indépendants des données de démonstration.
- Suivi mails : seuls les mails validés depuis le 8 octobre y figurent ; les plus anciens peuvent être rattachés au cas par cas.
- Peppol : la réception passe par le comptable ; l'étendre à la réception est un chantier à part.
- Désactiver ou supprimer définitivement les fiches en doublon (ex. un « Eddy +2 » vide, mis de côté) depuis la page Équipe.
