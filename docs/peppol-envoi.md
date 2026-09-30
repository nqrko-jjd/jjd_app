# Envoi Peppol JJD : état et activation

## État au 30 septembre 2026
La réception doit rester chez le comptable (Horus). TrustUp réalise actuellement les envois. Aucun accès API d’envoi TrustUp n’a été fourni. Sa page publique de tarifs mentionne une connexion API « bientôt » : cela ne permet pas de conclure qu’une API d’émission utilisable par JJD est disponible pour ce compte.

Le précédent endpoint JJD `/api/documents/:id/send` marquait une facture envoyée et la mettait en file sans transport. Ce comportement est supprimé : une demande Peppol retourne 503 AVANT numérotation, verrouillage ou changement de statut. Aucun connecteur factice n’est activable via une variable d’environnement. L’envoi externe se déclare explicitement après émission et ne remet pas une facture payée/partielle/créditée dans le statut envoyé.

L’interface distingue PDF/envoi externe et Peppol, sans imposer Peppol à tous les clients. Le téléchargement n’enregistre aucun envoi. Une entreprise, ACP ou syndic n’est pas automatiquement qualifié d’assujetti par la présence d’un nom professionnel : le destinataire de facturation et son régime doivent être contrôlés.

## Accès nécessaire
Soit TrustUp fournit sa documentation d’envoi, des identifiants API et un environnement de test, soit un point d’accès à API documentée est choisi. Recommand documente un mode sortant `isSmpRecipient:false` : l’opérateur actuel reste responsable de la réception. Ne pas migrer la réception ni activer l’inscription destinataire.

L’activation nécessite un compte prestataire, la vérification de JJD par son représentant et des secrets côté serveur. Aucune inscription, souscription ni transmission réelle effectuée dans cette session.

## Conditions techniques avant activation
- Facture/avoir émis, identité facturée distincte du syndic/contact de rendez-vous, adresse complète, identifiants destinataire vérifiés.
- Mapping contrôlé des quantités/unités, remises, régimes TVA/exemptions, références facture d’origine pour avoir, acomptes et états d’avancement. Ne pas déduire l’autoliquidation du seul taux 0 %.
- Validation UBL/Peppol via le prestataire et conservation du document XML/PDF exact.
- Tentative persistée et verrou concurrent avant transport. Référence fournisseur, suivi livré/échec/en attente, traitement d’un délai réseau ambigu sans renvoi automatique, dédoublonnage et rapprochement de l’historique TrustUp.
- Réception des confirmations authentifiée, rejouable et idempotente ; une acceptation de requête HTTP n’est pas à elle seule une preuve de livraison.
- Essais en environnement prestataire de test, puis première facture réelle autorisée. Ne pas envoyer deux fois le même document depuis TrustUp et JJD.

## Sources consultées
- https://pro.trustup.be/fr/tarifs/
- https://docs.recommand.eu/getting-started/belgium/business/sending
- https://docs.recommand.eu/reference/sending/send-document
