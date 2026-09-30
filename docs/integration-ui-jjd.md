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

## 2026-09-30 — Rentabilité et présence par jour
- Ajout des composants partagés `WorksiteProfitability` et `WorksiteLabourDetail` dans la fiche réelle et dans la maquette isolée.
- Rentabilité : vendu moins coûts engagés, puis comparaison sur facturé et encaissé. Mention explicite des coûts restants non déduits ; aucune promesse de marge finale.
- Pointages : jours repliables, ouvriers présents, heures et montants, filtres ouvrier/statut et accès direct depuis la synthèse.
- Une ligne API peut agréger du validé et du soumis : le badge indique une journée à contrôler, pas que toutes ses heures sont non validées. Les rémunérations facturées peuvent remplacer l'estimation par pointage dans la synthèse ; logique API conservée.
- Données de démonstration indépendantes du planning, totaux de main-d’œuvre validée cohérents avec la synthèse fictive.
- Vérifications : typecheck web et compilation de la maquette réussis. Test navigateur indisponible (Chromium absent).
- Publication non effectuée : ouverture du dépôt Sites échouée, proxy réseau inaccessible ; tentative sans proxy échouée également (DNS). Sortie locale dans `/workspace/scratch/ea9713136f17/jjd-labour-build`. Ne pas considérer la version en ligne comme mise à jour.

## Direction confirmée — portage de la maquette, pas nouveau prototype
La référence visuelle est `jjd-admin-concept` (sources version 14 du kit conservées localement). Le site existant `jjd_app` demeure la source des parcours et règles métier. Les écrans simplifiés immeubles/dépôt tentés ce matin ont été retirés avant commit/publication à la demande de David.

Premier portage dépôt : `DepotFrame` et layouts Stock/Matériel, styles locaux extraits/adaptés des proportions de `depot.css` et `ui.css` de la référence. Les listes, formulaires, scanner caméra/clavier, préparations, commandes et réceptions existants sont conservés. Aucun endpoint, calcul de stock, permission serveur ni donnée modifié. Typecheck web réussi. Validation visuelle et essais fonctionnels avec backend restent nécessaires avant production.

La maquette privée isolée ne charge pas encore ces pages métier : ne pas présenter le portage dépôt comme visible sur ce lien. Les ajouts financiers de la session précédente sont prêts à être publiés séparément dans l’aperçu existant.
