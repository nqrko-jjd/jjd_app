# Audit de Costructor (compte d'essai) — fonctions, fonctionnement, écarts avec JJD

Réalisé le 10/10/2026 sur le compte d'essai de David (plan « Business+ », période d'essai jusqu'au 24/10/2026, version v1.24.44).
Méthode : utilisation réelle de l'application (création de données de test, clic sur les menus et boutons, parcours de bout en bout), pas une simple lecture.
Rien n'a été envoyé à un tiers, aucun abonnement ni paiement, aucune banque connectée. Données de test créées dans leur compte : client « Dupont Test », chantier « Rénovation salle de bain Dupont », 2 devis (dont un généré par l'IA), 1 facture d'acompte (finalisée et réglée), 1 intervention (BI00001), 1 bon de commande fournisseur (brouillon), 1 facture d'achat importée par PDF, 1 événement d'agenda, 1 lot et 1 tâche.

## 1. Vue d'ensemble

Costructor est un logiciel français de gestion pour artisans du bâtiment : devis, factures, chantiers, planning, achats, comptabilité légère. Il est organisé autour du **devis**, qui pilote ensuite l'acompte, la facture de situation (état d'avancement), la facture finale et la rentabilité.

Menu : Tableau de bord · Planning · Chantiers · Interventions | **Ventes** : Devis, Bons de commande (client), Bons de livraison, Factures (+ Avoirs, Règlements, Retenues de garantie, Facturation électronique), Clients, Bibliothèque | **Achats** : Bons de commande fournisseur, Demandes de prix, Factures d'achats (+ Avoirs), Fournisseurs | **Comptabilité** : Transactions (banque) | Site internet | Réglages | Aide | Parrainage. Recherche globale, annonces, notifications, chat de support, bascule « Nouveau menu » (beta).

## 2. Fonctions testées, module par module

### 2.1 Tableau de bord
Bascule HT/TTC, période, graphique chiffre d'affaires / achats, TVA collectée / déductible / due et prochaine échéance de déclaration, factures non réglées (en attente / en retard), devis par statut (à facturer, acceptés, en attente, refusés, annulés), chantiers en cours, tâches (ajout rapide), journal des événements récents. Les chiffres se mettent à jour en direct (après mon import de facture d'achat : achats 100 €, TVA déductible 21 €, TVA due −21 €).
En mobile : barre d'actions rapides « Devis / Facture / Contact / Chantier ».

### 2.2 Devis (module central)
- **Création** : « Nouveau devis » ou « Devis par IA ». Numérotation automatique modifiable. Enregistrement automatique en continu.
- **Liste** : tuiles-statuts avec nombre et montant (Tous, Brouillons, En attente, Envoyés, À facturer, Facturés, Perdus) ; filtres statut, client, chantier, responsable, date ; archives ; menu par ligne.
- **Éditeur** : client (recherche + création à la volée), adresse des travaux, rattachement à un chantier, dates (émission, expiration, **visite préalable, début des travaux, durée estimée**), en-tête, **lignes typées** (Fourniture, Main-d'œuvre, Ouvrage détaillé, Matériel, Sous-traitance), sections avec sous-totaux, textes, sauts de ligne et de page. Menu de ligne : remise, ajuster les prix, **rendre optionnel**, forcer le numéro de ligne, insérer avant/après, dupliquer, supprimer. Chaque ligne propose des **suggestions de la bibliothèque** (éclair) et un bouton « ajouter à la bibliothèque ».
- **Ouvrage détaillé** : un prix de vente décomposé en éléments (fourniture, main-d'œuvre, benne…) avec prix d'achat, marge et quantités.
- **Récapitulatif** : total HT, remise globale, ajustements HT, TVA par taux, TTC, ajustements sur net à payer, mentions de TVA.
- **Acomptes sur le devis** : échéancier de plusieurs acomptes, en % ou en €, chacun avec un déclencheur (à la signature, à la commande, au début des travaux, à la moitié des travaux, libellé libre).
- **Retenue de garantie** (5 % par défaut) calculée sur le TTC.
- Moyens de paiement, conditions de paiement, notes de bas de page, nom interne, responsable, notes internes.
- **Rentabilité prévue** : activable, avec prix d'achat par ligne ; la marge nette s'affiche sur le devis.
- **Aperçu** : le PDF final (bloc acomptes, retenue, case « Bon pour accord », **QR code** vers le devis en ligne).
- **Envoi** : destinataires multiples, copie, modèle d'e-mail modifiable, bouton « Consulter mon document » (portail en ligne). **Finalisation** : récapitulatif et « recommandations » avant verrouillage (ex. « indiquez une date de début des travaux »). Après finalisation : envoyer par e-mail, partager le lien, télécharger le PDF, facturer.
- **Signature électronique** (eIDAS) : proposée mais payante, indisponible en essai.
- **Devis par IA** : on décrit le chantier (texte, fichier joint ou dictée vocale) ; l'IA génère un devis complet en une quinzaine de secondes. Mon test (salle de bain de 6 m²) a produit des sections (dépose, plomberie, étanchéité…), des **ouvrages décomposés** avec prix d'achat et **marge de 50 %** automatique, des sous-totaux et des quantités cohérentes.

### 2.3 Facturation depuis un devis (le point fort)
« Facturer » ouvre un **assistant en frise** : devis accepté → acompte 30 % (prévu à la signature) [Facturer] → acompte 40 % (prévu au début des travaux) [Facturer] → « créer une facture d'acompte » (libre) → « créer la facture de situation n°1 » → « créer la facture finale », avec en pied le **total TTC facturé sur le total du devis**. Si le devis n'est pas accepté, il l'est automatiquement à ce moment-là.
- Facture d'acompte générée : libellé « Acompte de 30 % sur le devis n°… », retenue de garantie **déduite sur chaque facture** (net à payer = TTC − retenue).
- Réglage « méthode de déduction des acomptes » : sur le total HT ou sur le total TTC.

### 2.4 Factures, règlements, avoirs, retenues
- Éditeur de facture identique au devis ; échéance en jours ; n° de bon de commande ; retenue modifiable.
- **Finalisation** : récapitulatif, option e-Virement (paiement en un clic, payant), **avertissement d'irréversibilité** (« pour modifier ou annuler, générer un avoir »), **contrôles légaux bloquants** (testé : « L'adresse du client est incomplète » tant que l'adresse n'est pas structurée : rue, code postal, ville, pays).
- Après finalisation : envoyer, partager le lien, télécharger, **envoyer plus tard** (programmation).
- **Enregistrer un règlement** : date, mode (virement, chèque, espèces, carte, prélèvement, LCR…), montant prérempli (net de retenue), note. La facture passe « Réglée » même avec la retenue en attente.
- **Retenues de garantie** : rubrique à part (en attente, libérées, payées, annulées) avec la date de libération et la possibilité d'un e-mail de réclamation automatique à cette date.
- **Avoirs** : total ou partiel. Page **Règlements** : liste des encaissements. Actions diverses : associer à un chantier, assigner un responsable, nom interne, archiver, exporter.
- **Facturation électronique 2026** (Belgique, Peppol) : activation gratuite via un partenaire point d'accès (SuperPDP), avec calendrier de la réforme.

### 2.5 Clients et fournisseurs
Création rapide : type (client / prospect / fournisseur), particulier ou professionnel, civilité, adresses / e-mails / téléphones multiples, onglets Comptabilité et Autres. **Compte auxiliaire** comptable généré automatiquement (ex. 411DUP1). Fiche en panneau : notes, pièces jointes, chantiers, devis (barre de statut), factures, interventions, avec création directe de chacun. Adresse par autocomplétion (la saisie manuelle structurée existe). Onglets Clients / Prospects, filtre particulier / professionnel, export.

### 2.6 Chantiers
- Kanban par colonnes (Nouveaux, Signés, En cours, Payés, Perdus) ou liste ; le mot « chantier » est renommable (Projets, Affaires…).
- Fiche : onglets Tableau de bord, Tâches, Planning, Devis, Factures, Achats, Interventions, Rentabilité.
  - **Tableau de bord** : Marché (budget, reste à dépenser, reste à facturer, bénéfice), Trésorerie (à payer / en attente), Temps passé (effectué / restant), **fil d'actualités** (texte, photo, pièce jointe, **dictée vocale**), planning.
  - **Tâches** : lots + tâches (dates, heure, assigné), vue liste et **Gantt** (jour / semaine, jalons).
  - **Rentabilité** : prévue vs réelle (main-d'œuvre, achats, frais généraux, bénéfice), temps prévu vs passé, dépenses par catégorie.
  - **Achats** : factures d'achat, avoirs fournisseurs, **dépenses sans justificatif**, bons de commande.
  - Colonne droite : équipe, **Réception du chantier** (PV de réception : maître d'ouvrage, ouvrage, réserves oui/non, personnes présentes, notes, fait à / le), documents, tâches, notes.

### 2.7 Interventions (bons d'intervention)
Document complet : client, adresse, chantier, date / heure / durée, intervenants, objet, **rapport d'intervention**, photos, lignes chiffrées, notes. Validation → statut « En attente » ; planifier, envoyer, **convertir en devis**. Listes : Toutes / Brouillons / À planifier / Planifiées / Terminées.

### 2.8 Planning
Onglets Agenda / Chantiers / **Équipiers** (ressources par membre). Vues jour / semaine / mois. Création d'un événement en un clic sur un jour : titre + couleur, description, dates, heure, **visible par tous (désactivé par défaut)**, chantier, contact, personne assignée.

### 2.9 Bibliothèque
6 types (fourniture, main-d'œuvre, ouvrage détaillé, matériel, sous-traitance, texte), dossiers, filtres fournisseur / stock. Fiche : prix d'achat, **taux de marge** (30 % par défaut), prix de vente automatique ou manuel, unité, TVA, éco-participation, fournisseur et référence. Extension Chrome / Firefox pour importer « plus de 10 millions de produits ». Une ligne de devis peut être ajoutée à la bibliothèque en un clic (testé).

### 2.10 Achats
- **Factures d'achat** : adresse e-mail dédiée pour transférer les factures (beta) et dépôt de fichier PDF / PNG / JPG (10 Mo).
  **Import testé** : j'ai déposé un PDF fabriqué ; l'application a extrait le numéro, les dates d'émission et d'échéance, la TVA (base et montant), le total HT / TTC, a **détecté le fournisseur** (avec son n° de TVA) et proposé de le créer. Champs extraits surlignés en vert, statut « À vérifier ». Ensuite : à payer / paiement programmé / payée.
- **Bons de commande fournisseur** (brouillon, finalisé, envoyé, expédié, partiellement livré, livré, annulé) et **Demandes de prix** (brouillon, finalisée, envoyée, reçue, annulée) : même éditeur que le devis.
- Avoirs fournisseurs, fournisseurs avec interlocuteurs.

### 2.11 Banque et comptabilité
Transactions : connexion bancaire par le partenaire Bridge et rapprochement (non testé : demande des identifiants bancaires). Plan comptable importable, comptes auxiliaires, comptes par catégorie d'élément, TVA par taux avec comptes de ventes et d'achats, fréquence de déclaration, régime de franchise. Intégrations : Pennylane, MyUnisoft, Horus, ACD, Cegid Loop, Inqom (comptabilité), Stripe (carte bancaire). Tags analytiques (offre Premium).

### 2.12 Réglages et automatisations
- **Automatisations d'e-mails** (4 interrupteurs) :
  1. relance automatique des **devis** : 7 jours avant la date d'expiration, ou chaque semaine jusqu'à l'expiration ;
  2. relance automatique des **factures impayées** : à la date d'échéance, ou chaque semaine pendant N semaines ;
  3. **demande d'avis client** N jours après règlement ;
  4. **réclamation automatique des retenues de garantie** à la date de libération.
- **Modèles d'e-mails** : nouveau devis, relance de devis, nouveau bon d'intervention / de livraison / de commande, nouvelle facture, relance de facture, facture acquittée, demande d'avis, avoir, bon de commande et demande de prix fournisseur, PV de réception, PV de levée des réserves, demande de libération de RG (modèles personnalisés : Premium).
- Réglages par type de document : numérotation, nom des PDF, apparence (thèmes), acomptes par défaut, durée de validité, texte de signature, filigrane sur brouillons, conditions de paiement, page de garde, pièces jointes partagées, CGV (imprimées à la suite ou au dos).
- Réglages avancés : événements d'agenda visibles par défaut, méthode de calcul du chiffre d'affaires (factures ou livre des recettes), nom des projets.
- Rentabilité : taux de marge par défaut et par type, coefficient de frais généraux (25 % suggéré). Assurance (décennale…) imprimée sur les documents. Équipe : membres, comptables invités, utilisateurs / non-utilisateurs.
- Abonnement : Business+, services complémentaires (signature électronique, e-Virement, accès API).

### 2.13 Divers
Site internet d'entreprise (mini-site personnalisable), parrainage, aide et chat de support, bannières de webinaires.

## 3. Ce qui n'a pas pu être testé et pourquoi
Signature électronique, e-Virement, Stripe, accès API, tags analytiques, thèmes d'apparence et modèles d'e-mails personnalisés (payants ou hors essai) ; connexion bancaire (identifiants requis) ; activation Peppol (mandat) ; publication du site internet ; envoi réel d'e-mails ; création d'un avoir (fenêtre ouverte, non validée) ; libération d'une retenue ; bons de commande / de livraison clients ; application mobile native ; imports CSV de clients.

## 4. Comparaison avec JJD App et recommandations

### Ce que nous avons déjà au même niveau ou mieux
Acomptes en % avec acomptes successifs sur le solde, états d'avancement par ligne avec déduction d'acompte au prorata, relances de factures **à plusieurs paliers de ton croissant** (Costructor : un seul message), suivi de devis, boîte mail IA, rapprochement bancaire, assistant IA, planning détaillé avec équipes et véhicules, appli mobile terrain et multilingue (FR / EN / pt-BR), stock et préparations, portail client, import de documents par PDF, adresse e-mail dédiée pour les factures fournisseurs, envoi Peppol.

### Écarts à combler (par ordre de valeur pour JJD)
| # | Fonction | Pourquoi | Effort |
|---|---|---|---|
| 1 | **Assistant « Facturer le devis » en frise** (acompte prévu, acompte libre, situation, facture finale, total facturé / total) | Rassemble en un seul écran ce que nous avons déjà construit en morceaux ; très lisible | moyen |
| 2 | **Échéancier d'acomptes défini sur le devis** (avec déclencheurs) et affiché sur le PDF | Correspond à vos conditions « 50 % / 40 % / 10 % » | moyen |
| 3 | **Retenue de garantie** (suivi à part, libération, réclamation) | Courante en chantiers publics et grands comptes | moyen |
| 4 | **Rentabilité du devis** : prix d'achat par ligne, ouvrages décomposés, marge | Vous savez avant de signer si le devis est rentable | élevé |
| 5 | **Lignes optionnelles** dans un devis | Fréquent en rénovation | faible |
| 6 | **Contrôles avant finalisation** (adresse, recommandations) | Évite les factures à corriger par avoir | faible |
| 7 | **PV de réception structuré** (réserves, PDF, signature) et **PV de levée des réserves** | Valide la prestation et déclenche la facture finale | moyen |
| 8 | **Bon d'intervention** (rapport + photos + produits) convertible en devis / facture | Adapté à vos interventions chez les syndics | moyen |
| 9 | **Demandes de prix** aux fournisseurs et suivi de livraison des commandes | Complète les achats | moyen |
| 10 | **Fil d'actualités du chantier** avec dictée vocale | Déjà proche de notre fil + photos de fin de journée ; ajouter la dictée | faible |
| 11 | **Gantt** des tâches par lots et vue **Équipiers** | Lecture rapide de la charge | moyen |
| 12 | **Demande d'avis client** automatique après règlement | Réputation, très peu d'effort | faible |
| 13 | **Envoyer plus tard** (programmation) et **lien de partage / QR code** sur les documents | Confort | faible |
| 14 | Relances de devis **ancrées sur la date d'expiration** (7 jours avant, hebdomadaire) en plus de nos paliers après envoi | Évite de relancer un devis déjà périmé | faible |

### À ne pas copier
Leur site internet intégré (vous avez déjà votre site) et leurs thèmes d'apparence payants. Je n'ai pas testé la bascule « Nouveau menu » (beta), je n'en tire donc aucune conclusion.
