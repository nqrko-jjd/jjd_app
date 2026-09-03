# Connexion bancaire — Ponto Connect (Ibanity)

L'app agrège les transactions bancaires via **Ponto Connect** (API Ibanity /
Isabel Group), puis les **rapproche automatiquement** des écritures du grand
livre (ventes + achats).

Sans configuration, la fonctionnalité est simplement désactivée : la page
*Finances → Rapprochement bancaire* affiche « Non configurée » et continue de
fonctionner avec les transactions déjà importées du fichier Excel.

## Ce que fait l'app une fois connectée

- **Synchroniser** : tire les nouvelles transactions de chaque compte (via une
  *synchronization* Ponto puis pagination), les enregistre (idempotent, clé =
  id de transaction Ponto), puis lance le rapprochement automatique.
- **Rapprochement automatique** :
  - *sûr* (`strong`) — communication structurée identique à celle d'une facture
  - *probable* (`good`) — même montant (± 2 c) + date proche (± 10 j) + sens
    cohérent (encaissement ↔ vente, décaissement ↔ achat), une seule écriture
    candidate (départagée au besoin par le nom de la contrepartie)
- Le reste se rapproche à la main, avec des suggestions triées.

## Mise en service (à faire par David)

### 1. Créer l'intégration Ponto

1. Compte sur <https://myponto.com> (ou le dashboard Ibanity).
2. Créer une **application / intégration** « Ponto Connect ».
3. Renseigner l'**URL de redirection** (redirect URI). En local ce n'est pas
   possible (il faut une URL publique) → à faire **après le déploiement sur
   Combell** : `https://<domaine-api>/api/ponto/callback`.
4. Récupérer :
   - `client_id` (et `client_secret` s'il y en a un)
   - le **certificat client** + sa **clé privée** (mTLS, obligatoire chez
     Ibanity) — souvent générés/téléchargés depuis le dashboard
   - (production) une **clé de signature** de requêtes

### 2. Déposer les fichiers

Dans `apps/api/secrets/` (gitignoré) :

```
ponto-certificate.pem
ponto-private-key.pem
ponto-signature-key.pem      (prod)
```

### 3. Renseigner `apps/api/.env`

```
PONTO_CLIENT_ID=...
PONTO_CLIENT_SECRET=...
PONTO_REDIRECT_URI=https://<domaine-api>/api/ponto/callback
PONTO_KEY_PASSPHRASE=...            # si la clé privée est protégée
PONTO_SIGNATURE_KEY_ID=...          # prod
PONTO_SANDBOX=1                      # pour tester avec l'environnement bac à sable
```

### 4. Connecter une banque

Dans l'app : *Finances → Rapprochement bancaire → « Connecter une banque »*
(réservé admin). Redirige vers Ponto, choix de la banque + consentement, retour
sur la page. Ensuite : « Synchroniser ».

## Notes techniques

- Auth : OAuth2 *authorization code* + PKCE ; jetons (access + refresh) stockés
  dans `Setting` (`ponto:tokens`), rafraîchis automatiquement.
- Tous les appels API passent par un agent HTTPS avec le certificat client
  (`https.request`, car `fetch` global ne gère pas le certificat client).
- ⚠️ Les chemins d'endpoints (`/oauth2/auth`, `/oauth2/token`, `/accounts`,
  `/synchronizations`) et le schéma de **signature des requêtes** sont marqués
  `TODO(ibanity)` dans `apps/api/src/lib/ponto.ts` : à revalider avec la doc
  Ibanity en vigueur au moment de l'activation.
- Modèles : `BankAccount` (un par compte connecté) et `BankTransaction`
  (`externalId` unique, `structuredComm`, `side`, `matchConfidence`).
