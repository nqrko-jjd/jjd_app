# Revue visuelle des profils — 1 octobre 2026

Cette livraison corrige les écarts relevés après la première harmonisation visuelle. Référence : `https://jjd-admin-concept.nqrko.chatgpt.site`, en particulier les fiches, l’accueil ouvrier et la file de contrôle. Elle conserve les couleurs vert profond, clair et doré et les fonctions/API existantes.

## Changements concrets

- Accueil terrain : titre aligné, compteur avec marges internes, actions arrivée/départ lisibles, mission et photos hiérarchisées. Chargement, absence de planning, compte non lié et compteur actif distingués. Boutons de pointage protégés pendant leur requête, erreurs affichées.
- Fiches : suppression des en-têtes sans marge et des doubles marges sur les chantiers ; identité et portrait réunis pour les contacts et collaborateurs ; outils avec photographie non rognée et cartes des exemplaires.
- File de contrôle : départs provisoires à confirmer, articles sous le seuil et rapports à examiner alimentés par les endpoints existants. Les contrôles administratifs, leurs filtres et leurs actions restent disponibles en dessous. Les liens de priorités sont en lecture seule.
- Portail : distinction syndic/promoteur, particulier et résident. L’accueil particulier privilégie son projet ; l’accès résident ne montre pas les blocs financiers. Contraste des boutons corrigé. Les restrictions de données restent appliquées par l’API existante.
- Petits écrans : indicateurs en deux colonnes, navigation dépôt compacte, filtres défilants, étapes de création plus courtes, champs texte à 16 px. Réception fournisseur/préparation sans débordement et actions au-dessus des onglets mobiles.
- Connexion : présentation de marque, formulaire plus clair, suppression des identifiants de démonstration visibles et de l’adresse préremplie ; aucune modification des comptes.
- Expo : espacement des dossiers, titres/contextes des fiches, contacts chantier ouvrables, libellés des statuts, coordonnées et matériel terrain plus lisibles, informations vides de véhicule réduites, descriptions des lignes de document visibles.

## Couverture de revue

| Profils | Écrans contrôlés |
| --- | --- |
| Administration / bureau | Accueil et priorités, chantiers et finances, immeubles/projets, planning, tâches, CRM, devis/factures, achats, analyse, contrôle, finances/banque/grand livre, contacts, équipe, flotte, outils, stock, préparations, commandes, scan, racks, tarifs, pointage/décomptes, messagerie, paramètres, boîte IA |
| Chef / ouvrier | Navigation propre au rôle, accueil, chantiers du jour, liste personnelle, heures, mission, rapport ; compteur actif, journée vide et compte non lié |
| Magasinier | Accueil et navigation autorisée ; dépôt, articles, préparations et commandes sur le web adaptatif |
| Syndic / promoteur | Accueil portefeuille, immeubles/projets, fiche et interventions, demande, planning, devis/documents, messages |
| Particulier / résident | Accueil adapté, projet/intervention autorisée, demande, planning et échanges ; blocs financiers masqués pour l’accès limité |
| Application Expo | Administration, bureau, chef, ouvrier et magasinier : onglets/Plus disponibles ; dossiers contact, collaborateur, immeuble, véhicule, document, chantier et fiche terrain selon les parcours existants |

## Vérifications

- TypeScript web et mobile : réussis.
- Export Metro web, iOS et Android : réussis.
- Rendu des **composants réels** du web avec API fictive isolée : 259 combinaisons écran/profil/largeur (390, 820 et 1440 px). Aucun crash JavaScript. Un débordement fournisseur à 390 px trouvé et corrigé, puis retest ciblé.
- 48 cas de formulaires à trois largeurs : 45 modales ouvertes, aucun débordement ni crash. Les trois cas « Modifier » d’un document ne sont pas des modales : le document utilise son éditeur inline, ce qui est attendu.
- Expo rendu via React Native Web, API interceptée fictive : 82 combinaisons de routes/profils/largeurs (390 et 820 px), sans crash ni débordement. Les dossiers ont été vérifiés avec des contenus, pas uniquement avec leur chargement.
- Inspection des captures : compteur et mission ouvrier, indicateurs admin, contrôles opérationnels, contacts, outils, accueils clients et formulaires ; contrôles ciblés supplémentaires après les corrections finales.

## Limites et préservation

Ces tests de rendu ne sont pas une validation matérielle Safari/iPhone ou Android. Les exports ne constituent pas une nouvelle APK ni une publication App Store. Le magasinier natif conserve ses parcours existants Messages/Plus/Compte ; les fonctions complètes du dépôt restent sur le web adaptatif. Les pages publiques de marketing n’ont pas été reconstruites dans ce lot.

Les maquettes de test utilisent exclusivement des données fictives. Aucune requête de cette recette n’est envoyée à un service métier réel. L’aperçu web isolé peut utiliser une police de repli quand les polices externes sont bloquées ; la configuration des polices du site déployé est conservée.

Aucune modification du schéma Prisma, des routes API, des droits, des données, des sauvegardes ni des intégrations externes dans ce diff. Les modifications récentes de la boîte mail IA sur `main` ont été intégrées à la base de la branche, sans les remplacer.
