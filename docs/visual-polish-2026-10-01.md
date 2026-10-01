# Harmonisation visuelle — 1 octobre 2026

Référence : maquette JJD admin concept (vert profond, fond clair, doré, DM Sans / Manrope).

## Livré

- Bureau : hiérarchie des titres, rythme des cartes, tableaux, champs et formulaires, navigation terrain et bureau sur téléphone, identité du profil sur grand écran.
- Portail : navigation adaptée syndic / promoteur / particulier / résident, menu mobile avec fermeture explicite, accès direct aux interventions et messages, portfolio réservé aux profils concernés. Les restrictions API sont inchangées.
- Expo : palette commune, cartes et listes plus lisibles, navigation de cinq entrées pour administration / bureau / chef / ouvrier, autres pages regroupées dans Plus, accueil terrain et pointage arrivée-départ, messages, planning, connexion et largeur tablette. Les écrans de détail utilisent le même conteneur adaptatif. Magasinier : messages et compte, sans faux accueil de pointage ; les fonctions complètes du dépôt restent disponibles sur le web.

## Validation

- TypeScript web et native : succès.
- Compilation de l’aperçu web avec les vraies pages : succès.
- Export Expo web du code natif : succès ; contrôle dans Chromium avec API intégralement interceptée et données fictives, aucune requête vers la production.
- Écrans natifs accueil, chantiers, planning, messages, Plus : profils admin, office, foreman, worker, largeurs 390 et 820, aucune erreur JavaScript ni débordement horizontal observé.
- Web : dashboard, chantier, immeuble, planning, messagerie, stock, flotte, portail aux largeurs 390 / 820 / 1440 / 1920. Débordement de fiche véhicule détecté puis corrigé.
- Menus portail : résident sans devis / documents financiers / portfolio ; particulier sans portfolio ; promoteur avec Mes projets ; syndic avec portefeuille.

## Livraison

Branche de test uniquement. Aucun changement de schéma, aucune donnée modifiée, aucun secret, aucune activation IA, aucune dépendance ajoutée au manifeste.

La modification du code Expo ne met pas à jour un APK déjà installé : une nouvelle compilation Android / iOS reste nécessaire. Les captures Expo web vérifient la mise en page commune, pas les gestes / clavier / permissions sur appareil réel.
