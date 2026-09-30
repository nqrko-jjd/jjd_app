# Compagnon JJD — aperçu visuel

Bulle présente dans le Shell des profils internes, panneau agrandissable, plein écran mobile. La route /app-compagnon ouvre le même composant en page dédiée. Les conversations restent en mémoire durant le montage du composant ; fermeture/réouverture de la bulle conserve la conversation, rechargement la réinitialise.

Cette livraison est une démonstration interactive : réponses prédéfinies, propositions fictives, pièces jointes locales non envoyées et aucune écriture métier/API. Le sélecteur « Profil simulé » ne change jamais le compte connecté et ne constitue pas un contrôle de sécurité.

Règles illustrées : Julien et David peuvent préparer un devis ; Melvina ne peut effectuer aucune création par IA (la création manuelle existante reste inchangée). Les profils terrain n'ont pas la génération de devis ; leurs autres droits restent à définir avant connexion réelle. Le demandeur d'une proposition est conservé lors d'un changement de profil simulé.

L'ancien AssistantChat et ses contrôles existants sont conservés, accessibles par « Assistant connecté » uniquement si l'API l'annonce activé au bureau. Les nouvelles restrictions ne s'appliquent pas encore à cet ancien assistant : ne pas considérer cette livraison comme une sécurisation du système connecté.

Avant connexion à l'IA : autorisation serveur par utilisateur et action pour tous les outils, contrôle des données par périmètre, journalisation, validation explicite et idempotence, stockage sécurisé des pièces jointes, limites/scan médias, véritable analyse vidéo et suivi de traitement. Ne pas utiliser le profil de démonstration comme source d'autorisation.

Vérifications : typecheck web ; navigateur à 1440, 820 et 390 px ; ouverture/fermeture bulle ; création fictive Julien ; refus création Melvina ; aucun débordement horizontal et saisie visible tablette/mobile ; aucune écriture API dans les parcours de démonstration. Aucune modification de schéma ni de configuration de production.

## V2 — une seule bulle Discussions

- Onglets Équipe et Compagnon IA, agrandissement commun, avatar SVG JJD avec casque.
- Réutilisation de MessagingWorkspace : aucune copie de la logique d'envoi, droits API inchangés, séparation interne/client et partage sélectif des médias conservés.
- La messagerie réelle ne se charge qu'après ouverture de l'onglet Équipe. Lectures périodiques et marquage comme lu suspendus quand cet onglet ou la bulle est fermé. Les deux composants restent montés pour conserver leurs brouillons pendant les bascules.
- Les suggestions IA dépendent du profil simulé et de la page (chantier, planning, stock). Les questions de consultation donnent une aide de démonstration, sans inventer de données lues. Melvina n'obtient aucune création via IA. Les permissions sont toujours illustratives et ne remplacent pas le futur contrôle serveur.
- Le magasinier ne reçoit pas automatiquement de nouveaux droits messagerie ; un état explicite explique cette limite.
- Tests navigateur avec API simulée : passage IA/Équipe et conservation des deux brouillons, refus de création pour Melvina, fermeture, affichage à 1440/820/390 px. Aucun message réellement envoyé ; seuls les accusés de lecture simulés ont été sollicités.

### Préalable au prochain déploiement

Le déploiement précédent a abouti sur une base de test vide (0 comptes/0 chantiers). Le compte rendu utilisateur confirme ensuite le rétablissement de l'accès, mais le statut automatisé disponible ne publie que l'état des conteneurs. Vérifier la correction du choix des volumes/projet Compose et les comptages réels avant/après le prochain déploiement. Ne supprimer aucun volume et ne pas restaurer par-dessus une base sans diagnostic. Cette livraison ne modifie ni Compose, ni le script serveur, ni le schéma.
