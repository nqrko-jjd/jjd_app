# Compagnon : pilote direction et budgets persistants

Cette branche intègre la PR #5 et les changements de main jusqu’à 30d46e0. Elle ne modifie aucun schéma Prisma, volume, secret ou configuration de déploiement.

## Accès et activation

Le pilote est réservé aux comptes actifs David et Julien (`david@jjd-consult.be`, `julien@jjd-consult.be`), de rôle admin/office. La décision `/api/assistant/status` vient du serveur ; la bulle et la page directe refusent les autres comptes. Les endpoints payants et les recherches relisent les permissions. Le sélecteur de profils du mode démonstration n’est jamais une source d’autorisation.

La présence de `ANTHROPIC_API_KEY` ne suffit plus à activer les appels : `assistant:v1:config` doit aussi être validée par David. Par défaut `enabled=false`, budgets à 0, tarifs absents. La production affiche donc seulement l’aperçu privé si aucune configuration n’existe. Aucun appel Anthropic n’a été effectué durant le développement.

Le mode connecté réutilise la présentation compacte, mais reste en **lecture seule** : recherche de chantiers, contacts et ouvriers, aide textuelle JJD. Aucun outil ne crée de devis, planning ou tâche, y compris l’ancien helper `runTool`. L’ancien AssistantChat n’a plus d’entrée dans le Shell. Les médias ne sont pas encore envoyés/analy­sés ; il faut un flux de propositions persistantes et confirmation idempotente avant d’activer les créations.

## Coûts et persistance

- Entiers en micro-euros (1 € = 1 000 000). Enveloppe API hors taxes, change configuré explicitement.
- 1 €/mois et 10 demandes/jour prévus pour l’équipe ; accès équipe **encore fermé**. Julien/David : plafond mensuel par personne séparé, aucune limite quotidienne de dix. Plafond global commun obligatoire.
- Réservation avant chaque appel payant, réconciliation avec `usage`. Comptage gratuit Anthropic avant réservation, marge d’entrée 20 % + 256 tokens ; sortie plafonnée. Pas de cache demandé, pas d’outils fournisseur payants, retries SDK désactivés.
- Classement JJD/hors sujet lui aussi facturé et comptabilisé. Ce filtre sémantique n’est pas une garantie parfaite ; les droits et outils serveur restent la frontière de sécurité.
- Budget tarifaire/version de modèle/change figés par demande. Configuration des tarifs à vérifier sur la documentation officielle au moment de l’activation. Le plafond interne est une estimation en euros, pas une garantie de montant TTC de la facture fournisseur.
- Si le fournisseur échoue avec un résultat incertain, la provision entière reste comptabilisée. Si le serveur s’arrête avant rapprochement, la réservation reste retenue. Pas de restitution automatique ni de retry payant implicite. Revoir les provisions manuellement avec la facture fournisseur.
- Si une consommation observée dépasse la réserve, désactivation automatique ; investigation tarifaire avant reprise.
- Toutes les mises à jour du registre sont sérialisées dans une transaction DB par un Counter dédié. Aucun verrou mémoire seulement. Les réservations individuelles et globales sont atomiques.
- Identifiant UUID + hash du corps : réponse déjà terminée rejouée gratuitement ; conflit si payload différent ; demande en cours/échouée non rejouée au fournisseur. Une demande active par utilisateur, délai technique de dix minutes ; les provisions survivent à ce délai.
- Buckets datés Europe/Brussels : renouvellement sans cron, DST compris. Le coût d’un appel est affecté au mois où il est réservé ; une réponse tardive règle ce même bucket. Les messages quotidiens comptent une demande logique, pas chaque appel de sa boucle.
- Setting `assistant:v1:*` stocke les buckets, demandes et configuration ; AuditLog les règlements et changements de budget. Les réponses stockées pour idempotence nécessiteront une politique de rétention avant un déploiement large. Aucun transcript dans les journaux applicatifs.

## Administration (API réservée à David)

`GET/PUT /api/assistant/budget-config` :

```json
{"enabled":false,"globalMonthlyMicro":0,"directionMonthlyMicro":0,"pricing":null}
```

Pour activer, renseigner les deux budgets >0 et `pricing` : `model` (identifiant Claude exact), `inputUsdPerMillion`, `outputUsdPerMillion`, `eurPerUsd` positifs. Ne pas activer avec les valeurs arbitraires des tests. David doit confirmer ces choix, les données transmises au fournisseur et les budgets avant utilisation payante.

`POST /api/assistant/budget-grant` : `userId`, `requestId` UUID, `extraMicro`, `extraRequests`. Rallonge mensuelle valide uniquement le mois belge courant ; demandes supplémentaires uniquement le jour courant. Idempotence et audit. Ne change pas le plafond global ni l’accès au pilote.

`GET /api/assistant/quota` retourne le solde de l’utilisateur authentifié, sommes réservées/comptabilisées, plafonds et échéances ISO. Pas de choix d’un autre utilisateur par le client.

## Vérifications et limites

`bash scripts/test-assistant-quota.sh` : base SQLite éphémère, comptes fictifs, SDK intégralement simulé. Tests des permissions, classification, usage, doubles clics, concurrence globale, erreurs, idempotence, grants et dates DST. Tests TypeScript API/web.

Les transactions sont écrites pour PostgreSQL et SQLite ; les tests locaux automatiques sont SQLite. Avant activation payante : confirmer modèle/tarifs/change/budgets, recette PostgreSQL concurrente sur copie, vérification de la clé côté serveur sans l’afficher, politiques de rétention et vérification des profils de production. Ne pas ouvrir aux ouvriers avant une implémentation des périmètres de données propres au terrain et la recette des plafonds individuels.

Sources techniques : https://platform.claude.com/docs/en/build-with-claude/token-counting et https://platform.claude.com/docs/en/about-claude/pricing .
