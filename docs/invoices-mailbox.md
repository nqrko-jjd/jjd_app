# Boîte mail factures — import automatique des achats

Alternative à [Ponto](ponto.md) pour automatiser les achats sans passer par une
API bancaire (PSD2) : une boîte mail dédiée (ex. `invoices@jjd-consult.be`) où
les fournisseurs envoient déjà leurs factures est lue en **IMAP classique**
(login + mot de passe, aucun compte développeur externe requis).

Sans configuration, la fonctionnalité est simplement désactivée : la page
*Achats / Dépenses* n'affiche pas le bouton « Synchroniser la boîte mail » et
continue de fonctionner normalement (saisie manuelle, envoi depuis le fil de
chantier).

## Ce que fait l'app une fois connectée

- Toutes les 20 minutes (+ une passe au démarrage du serveur), et à la demande
  via le bouton *Achats → « ✉️ Synchroniser la boîte mail »* : se connecte à
  `INBOX`, traite les messages **non lus**.
- Pour chaque pièce jointe **PDF** : même extracteur texte que l'upload manuel
  (`document-extract.ts`) — type de document, date, montants, TVA, fournisseur
  et référence de chantier si trouvés — puis crée une dépense `source: 'email'`
  avec le PDF en pièce jointe.
- **Jamais de confirmation automatique** : l'extraction est du texte brut
  best-effort (pas fiable à 100 %), donc la dépense apparaît « à vérifier »
  (badge ✉️ *Boîte mail*) dans Achats — même logique que les factures envoyées
  depuis le fil de chantier (`source: 'chat'`). Elle reste éditable normalement.
- Le message traité (au moins une facture importée) est déplacé dans un
  sous-dossier `Traité par JJD App` — jamais retraité, et toujours consultable
  depuis n'importe quel client mail. Un message sans PDF est juste marqué lu,
  laissé dans `INBOX` (visible si besoin, mais plus jamais scanné).
- Les dossiers existants de la boîte (classement manuel par fournisseur) ne
  sont **pas** touchés — seul `INBOX` est surveillé.

## Mise en service

Dans `apps/api/.env` (ou `.env.production` sur le serveur) :

```
INVOICES_IMAP_HOST=mail.jjd-consult.be
INVOICES_IMAP_PORT=993
INVOICES_IMAP_USER=invoices@jjd-consult.be
INVOICES_IMAP_PASSWORD=...
```

Les réglages exacts (hôte, port, nom d'utilisateur) se trouvent dans le
cPanel de l'hébergeur : *Comptes e-mail → (la boîte) → « Configurer le client
de messagerie »*. Un mot de passe dédié à cet usage (plutôt que le mot de
passe principal de la boîte) est recommandé — révocable sans tout casser.

## Notes techniques

- `apps/api/src/lib/invoice-mailbox.ts` : `imapflow` (client IMAP) +
  `mailparser` (extraction des pièces jointes d'un message).
- `invoiceMailboxConfigured()` (dégradation silencieuse, même schéma que
  `pontoConfigured()`) : vrai seulement si host/user/password sont renseignés.
- Le modèle `LedgerEntry` ne distingue pas de statut « brouillon » séparé —
  `source: 'email'` (comme `source: 'chat'`) sert de marqueur « à vérifier »,
  lu par le badge de la page Achats.
