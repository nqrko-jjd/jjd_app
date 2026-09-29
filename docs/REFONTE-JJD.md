# Refonte JJD — suivi de développement

## Cadre validé avec David

Développement local sur branche dédiée. Aucun push main, aucun déploiement ou
migration de production sans accord explicite. Le workflow deploy.yml déploie
chaque push main et peut également être lancé manuellement. Préserver les
changements parallèles de Claude ; base initiale : 39f051e (traductions vitrine).
Ne pas lancer npm run setup : il inclut db:reset.

## Contrôle des sauvegardes (lecture du code, pas vérification serveur)

- backup.yml : dimanche 03:00 UTC ; sauvegarde base PostgreSQL et médias.
- backup.sh : archives dans backups/ du dépôt, conservation 45 jours.
- Le commentaire du workflow annonce /opt/jjd-backups : incohérence à résoudre.
- setup-backup-keys.yml et rrsync-backups.sh prévoient un accès NAS en lecture.
- docs/deploiement.md annonce la copie hors-site « fait » ; David indique les
  trois Synology NON configurés. Ne pas considérer cette protection active.
- Aucun historique d'exécution ni restauration vérifiés dans cette session.
- Avant migration : sauvegarde complète, restauration isolée, contrôle des
  documents et relations, retour arrière testé. Étudier sauvegarde quotidienne.

## Lots de réalisation

1. Navigation et composants visuels : vert profond, clair, doré ; champs et
   quantités lisibles, mobile sans débordements, menus regroupés.
2. Chantiers / interventions, contacts uniques avec rôles par immeuble/lot,
   organisations syndics/ACP/promoteurs/particuliers, facturation distincte.
3. Planning jour/semaine proche agenda, afficher les affectations utiles ;
   environ 30 ouvriers, équipes variables, conducteurs, places véhicules,
   matériel et tâches. Préparation Melvina, validation Julien ; urgence David
   ou Melvina avec trace. Familles travaux / rendez-vous / logistique.
4. Terrain : pointage individuel arrivée/départ chantier, photos dans fil de
   chantier et rappel au départ, rapport et signature ou motif de refus/absence.
5. Devis détaillé, bibliothèque avec inclusions/exclusions, références et fiches
   fabricant, cahier des charges ; prix validé par Julien, envoi bureau.
   Dossier versionné et signature liée aux annexes. Acompte puis états
   d'avancement par poste, cumul/précédent/période, déduction acompte et solde.
   SAV Matexi : temps/matériel, signature passage, décompte validé puis facture.
   Créneaux régie 7–12 et 12–17 ; temps réel distinct de facturation.
6. Finances : disponible/encaissements, impayés, réalisé non facturé, devis et
   acceptation, commandes signées, rentabilité heures/achats/sous-traitance.
   Paiement déclaré par carte/date/montant, à rapprocher ; confirmation sans
   double dépense. Rechargement carte = transfert. ING et Belfius, 2 Visa Business
   Gold et 3 Prepaid. Ponto/FoxPartners-Horus : connexions à vérifier séparément,
   ne bloquent pas les parcours manuels. Maintenir réception Peppol actuelle.
7. IA : emails en propositions à vérifier sans perdre les échecs d'analyse ;
   compléments rattachés au dossier ; vidéo/voix vers brouillons, validation
   humaine et droits serveur. Pas d'envoi autonome non autorisé.
8. Portail : projet/immeuble/lot, progression, décisions, documents, photos
   publiées, états/factures. Séparer échanges clients et internes.
9. Langues : vitrine/portail FR EN NL ; bureau/mobile FR EN pt-BR.
   Préférence individuelle et traduction à la demande avec original conservé.

## État du premier lot

- Navigation : recherche tolérant accents, groupes repliables, groupe actif
  ouvert à la navigation, maintien des restrictions et des badges non lus.
- Mobile : bouton fermeture et touche Échap pour le tiroir existant.
- Aucun changement base/API/production. Pas encore de prévisualisation validée.
- L'environnement de test avec base et médias séparés reste à provisionner ;
  ne pas utiliser les identifiants de production ni activer les envois réels.
