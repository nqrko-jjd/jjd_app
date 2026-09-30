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

## Aperçu hybride — parcours existants, habillage de référence
L’aperçu importe désormais directement les pages métier React : chantiers, immeubles (liste/fiche), documents (liste/éditeur), achats, stock (liste/fiche/scan/racks/tarifs), préparations (liste/fiche), commandes fournisseurs (liste/fiche), matériel (liste/fiche) et les dix pages du portail client. Les doublons simplifiés correspondants ne sont plus routés. Le planning existant est conservé.

Les changements destinés à la vraie application sont limités au cadre visuel du dépôt, à l’en-tête compact du chantier (photo repliable comme dans `visuals.js` de la référence), au titre Finances & rentabilité et à l’en-tête compact de l’éditeur. Aucun backend, migration ou droit serveur modifié. Le calcul partagé des factures et marges est réutilisé.

`preview/business-fixtures.ts` et `preview/portal.tsx` remplacent uniquement les API dans la compilation de test, jamais dans Next.js. Données locales fictives et réinitialisables, communications clients séparées, portefeuille syndic/promoteur filtré. Aucune connexion réelle, aucun envoi et aucune émission officielle. Les imports/exports, accès clients réels et intégrations externes sont volontairement indisponibles. Le catalogue fournisseurs apparaît vide jusqu’à connexion réelle ; cette maquette ne simule pas l’import de fichiers tarifaires.

Contrôles : typecheck web, typecheck des fixtures, compilation statique et rendu serveur de 27 routes (certaines pages à chargement par effet affichent leur état initial seulement). `node preview/verify-business.mjs` vérifie les relations immeuble/chantier, l’isolation du portefeuille et des messages clients, les totaux main-d’œuvre, les réceptions partielles, la préparation et son verrouillage, les sorties/retours du matériel, les totaux d’un brouillon et les demandes client. Chromium/control-browser indisponibles : aucune validation visuelle dans un navigateur n’est revendiquée. Tests utilisateurs requis avant toute publication sur l’application utilisée par les équipes.

Autres pages administratives de l’aperçu (équipe, contacts, analyse, contrôle, messagerie générale) restent les présentations de la session précédente : elles ne constituent pas encore un portage complet de tous leurs traitements. Ne pas confondre la version proposée pour tester les parcours ci-dessus avec un feu vert de mise en production globale.

## Fiche immeuble — hub testable
La fiche réelle existante est réorganisée en vue d’ensemble, interventions/chantiers, contacts, lots/occupants, fiche/accès et accès clients. En-tête photographique compact, indicateurs cliquables, dossiers en observation mis en avant, recherche et filtres de statut. Les formulaires et permissions existants sont conservés. Le formulaire de chantier existant reçoit un contexte immeuble/adresse optionnel ; le client et la facturation restent à choisir explicitement.

Dans l’aperçu uniquement : création d’un dossier sans heures historiques fictives, liens bâtiment/dossier cohérents, contacts d’occupants résolus, simulation explicite des accès sans e-mail, remplacement local d’une photo (2 Mio maximum). Vérifications de ces parcours ajoutées à `preview/verify-business.mjs` et réussies ; typecheck web, compilation et contrôle des différences réussis. Rendu serveur des routes vérifié ; contrôle visuel interactif non disponible dans cet environnement. Aucun changement backend ni migration.

## Préparation de mise en production, documents et mobile
Navigation mobile Administration/Bureau : Accueil, Chantiers, Planning, Messages et Plus. Dans le rapprochement bancaire, chaque pièce liée affiche son identité, le montant et des accès à la facture/l’achat et au justificatif authentifié. Les droits API restent inchangés.

Transmission des documents : choix visible PDF/externe ou Peppol, aucun téléchargement assimilé à un envoi. Le faux envoi Peppol est bloqué avant toute écriture ; conservation des statuts financiers lors d’un envoi déclaré manuellement. Tests unitaires dédiés du garde-fou réussis. Le transport réel reste à intégrer après obtention d’un accès API prestataire (voir `docs/peppol-envoi.md`).

Déploiement : sauvegarde avant mise à jour, fichiers de sauvegarde datés à la seconde et publiés après vérification d’archive, empreintes SHA-256, volume médias réellement monté sur l’API. Démarrage API sans `--accept-data-loss` ni seed automatique. Une installation vierge doit initialiser ses comptes séparément. L’ancien import Excel destructif est bloqué en production et exige un opt-in explicite en local. Aucune sauvegarde/restauration réelle exécutée, aucun NAS configuré, aucun push GitHub ni déploiement VPS.

Les deux fichiers fournis le 30 septembre comportent 13 onglets. Les exports contiennent chacun 9 720 lignes de main-d’œuvre avec date, ouvrier et référence. Les formules d’export Google (`__xludf.DUMMYFUNCTION`) ne font pas foi pour recalculer les tableaux de bord. Aucun fichier source modifié, aucune donnée réelle ajoutée à la maquette. Une comparaison avec la base vivante reste nécessaire avant toute synchronisation incrémentale ; les mises à jour du logiciel ne doivent pas réimporter l’historique.

La branche n’est PAS une autorisation de mise en production : recette navigateur avec base de test/restauration, vérification des droits et des parcours réels encore nécessaires. Les pages secondaires de la maquette indiquées plus haut restent distinctes des écrans métier ; ne pas présenter cette préparation comme une refonte exhaustive validée.

Vérification finale de ce lot : build Next.js complet réussi (50 pages statiques générées et routes dynamiques compilées), typecheck partagé/API/web réussi, 17 tests partagés et 3 tests de transmission réussis. Rendu serveur de 30 parcours de l’aperçu et tests des relations/stock/bâtiments/rapprochements fictifs réussis. Le test de sauvegarde avec Docker simulé confirme les archives/empreintes et l’absence de publication d’une sauvegarde incomplète en cas d’échec du dump ; il ne remplace pas un essai de restauration de la vraie base.
Les écrans réels Finances, Banque et Grand livre sont également exposés dans l’aperçu avec fixtures locales. Les connexions, imports bancaires et justificatifs réels y restent indisponibles.

## Livraison complémentaire du 30 septembre

Lot pointage : les écrans réels Pointage et Décomptes, ainsi que l’impression du décompte, sont exposés dans l’aperçu. Un seul jeu de pointages fictifs alimente validation, décompte mensuel et détail de main-d’œuvre chantier. Les pointages soumis restent dans les coûts prévisionnels du chantier, mais seuls les approuvés sont totalisés dans le décompte. Validation en masse hors anomalies géographiques, refus, correction et suppression testables. Pas de simulation de géolocalisation réelle ni de paie connectée ; les retenues et règles contractuelles avancées ne sont pas simulées. Dans la vraie interface de saisie groupée, une erreur partielle conserve uniquement les ouvriers non encore enregistrés pour limiter les doublons au nouvel essai. Les échecs de validation et de chargement du décompte sont affichés.

Lot suivant : tâches et suivi commercial désormais routés sur les pages réelles dans la maquette. Adaptateur de tâches commun à la liste générale et aux fiches chantier : création, affectations, déplacement vers un autre chantier, checklist, achèvement et suppression locaux. Le CRM simule la création, l’édition et les changements d’étape ; « gagné » ne crée pas automatiquement de chantier (même comportement que le changement d’étape existant). Aucun agent IA, e-mail ou notification réelle lancé. Titres du pipeline utilisables au clavier et sélecteur d’étape explicite ; erreurs de modification visibles. Typecheck web et tests des fixtures réussis.

Cette section remplace les réserves précédentes concernant les écrans secondaires : Contacts (liste/fiche), Équipe (liste/fiche), Analyse, Contrôle et Messagerie utilisent maintenant les pages réelles dans l’aperçu, avec des adaptateurs strictement locaux. Les opérations externes restent explicitement désactivées ; la création d’une personne de démonstration ne constitue pas une création de compte ni une affectation au planning.

Analyse distingue facturé, encaissé et rentabilité par chantier. Contrôle filtre les anomalies par gravité et explique la différence entre correction et classement. La messagerie conserve le texte en cas d’erreur et affiche les échecs au lieu de les masquer.

Recette automatisée : `node scripts/test-release.mjs` crée une base SQLite temporaire indépendante, ignore les fichiers `.env` et exécute 112 tests API. Les droits ouvriers/clients, les stocks, les factures, le planning et le rapprochement sont couverts. Deux tests supplémentaires garantissent le refus Peppol sans mutation et la confirmation externe idempotente sans perte du statut payé. Typecheck complet et build Next réussis. Les tests des fixtures locales passent également.

Avant bascule réelle : sauvegarder PostgreSQL et les médias, restaurer cette sauvegarde sur une instance isolée, effectuer la recette navigateur avec les profils réels, puis déployer la branche validée. Ne pas réimporter les fichiers Excel. Ne pas lancer d’envoi réel depuis la recette. Conserver le SHA précédent pour le retour du code ; ne pas restaurer aveuglément une ancienne base si de nouvelles écritures ont eu lieu. L’accès à l’environnement de production et la validation de sa restauration restent requis. Aucun transport Peppol actif n’est livré.
