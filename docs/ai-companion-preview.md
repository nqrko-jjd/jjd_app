# Compagnon JJD — aperçu visuel

Bulle présente dans le Shell des profils internes, panneau agrandissable, plein écran mobile. La route /app-compagnon ouvre le même composant en page dédiée. Les conversations restent en mémoire durant le montage du composant ; fermeture/réouverture de la bulle conserve la conversation, rechargement la réinitialise.

Cette livraison est une démonstration interactive : réponses prédéfinies, propositions fictives, pièces jointes locales non envoyées et aucune écriture métier/API. Le sélecteur « Profil simulé » ne change jamais le compte connecté et ne constitue pas un contrôle de sécurité.

Règles illustrées : Julien et David peuvent préparer un devis ; Melvina ne peut effectuer aucune création par IA (la création manuelle existante reste inchangée). Les profils terrain n'ont pas la génération de devis ; leurs autres droits restent à définir avant connexion réelle. Le demandeur d'une proposition est conservé lors d'un changement de profil simulé.

L'ancien AssistantChat et ses contrôles existants sont conservés, accessibles par « Assistant connecté » uniquement si l'API l'annonce activé au bureau. Les nouvelles restrictions ne s'appliquent pas encore à cet ancien assistant : ne pas considérer cette livraison comme une sécurisation du système connecté.

Avant connexion à l'IA : autorisation serveur par utilisateur et action pour tous les outils, contrôle des données par périmètre, journalisation, validation explicite et idempotence, stockage sécurisé des pièces jointes, limites/scan médias, véritable analyse vidéo et suivi de traitement. Ne pas utiliser le profil de démonstration comme source d'autorisation.

Vérifications : typecheck web ; navigateur à 1440, 820 et 390 px ; ouverture/fermeture bulle ; création fictive Julien ; refus création Melvina ; aucun débordement horizontal et saisie visible tablette/mobile ; aucune écriture API dans les parcours de démonstration. Aucune modification de schéma ni de configuration de production.
