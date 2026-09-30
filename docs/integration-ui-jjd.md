# Intégration de l’interface JJD

Branche de travail : `redesign/jjd-ui`. Le Site privé reste une démonstration avec données fictives, distincte de l’application connectée à l’API.

## Premier lot intégré

- La fiche chantier utilise `WorksiteFinanceSummary` alimenté par la réponse existante `/api/worksites/:id`. Les calculs de marge restent dans le code métier partagé.
- Les montants marché, facturé, encaissé et solde ne sont plus répétés dans plusieurs groupes de cartes.
- Les heures en attente sont indiquées séparément. Le reste à facturer est présenté comme solde du marché, sans prétendre que les travaux correspondants sont déjà réalisés.
- Les liens documents et achats conservent le filtre du chantier. La création de document depuis la liste contextualisée conserve ce chantier et le contact de facturation lorsqu’il est fourni.
- La liste des documents distingue un filtre chantier des indicateurs globaux de la société.
- L’éditeur conserve ses lignes, unités, calculs, enrichissement du texte et actions. Les colonnes numériques sont élargies ; les petites fenêtres utilisent le défilement horizontal existant.

## Vérification manuelle sur une instance de test

1. Ouvrir un chantier avec achats, heures et documents ; comparer les montants à la version antérieure.
2. Vérifier une fiche avec des heures en attente, puis une autre avec zéro heure.
3. Ouvrir les factures depuis la fiche : seuls les documents du chantier doivent apparaître. Basculer entre les onglets doit conserver ce filtre.
4. Créer un brouillon depuis cette liste : vérifier chantier et destinataire, notamment lorsqu’un contact de facturation diffère du donneur d’ordre.
5. Ouvrir les achats depuis la fiche : vérifier le filtre prérempli puis son retrait.
6. Modifier quantité, unité, prix et TVA d’un brouillon ; vérifier la lisibilité et les totaux à 390 px et sur ordinateur.
7. Vérifier que les actions de duplication, import PDF, validation et encaissement existantes restent accessibles.

## Limites avant déploiement réel

La récupération des dernières modifications GitHub doit réussir avant toute fusion avec le travail de Claude. Le test complet connecté à l’API exige le client Prisma généré et une base isolée. Ne pas exécuter `setup`, `db:reset` ni `db:push` sur une base existante.

Les pages `preview/secondary.tsx` et `preview/messages.tsx` contiennent des données et actions de démonstration. Elles ne sont pas des remplacements fonctionnels des pages de l’application. Leur intégration se fait dans les pages réelles en conservant chaque API, droit et action existants. Les tarifs simulés de la préparation de facture ne constituent pas des règles de facturation applicables en production.

Ce lot n’apporte aucune migration, modification de sauvegarde ni connexion bancaire ou messagerie supplémentaire.
