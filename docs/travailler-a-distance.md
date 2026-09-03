# Travailler sur le projet depuis n'importe quel poste

Le code tient dans Git (dépôt de ~1 Mo). Les **données** (Excel, exports TrustUp, PDF,
base SQLite) et les **secrets** (`.env`, clés Google) ne sont **pas** dans Git — il faut
les transférer à part une seule fois.

---

## 1. Mettre le code sur un dépôt distant

### Option A — GitHub privé *(recommandé)*

Le plus simple, gratuit pour un dépôt privé, marche depuis n'importe où.

1. Créer un compte sur github.com si besoin.
2. Créer un dépôt **privé** nommé `jjd-app` — **ne pas** cocher « Add a README ».
3. Installer GitHub CLI sur ce PC puis se connecter :
   ```bash
   winget install GitHub.cli
   gh auth login          # choisir GitHub.com > HTTPS > se connecter dans le navigateur
   ```
4. Depuis le dossier du projet (`C:\Users\david\Documents\JJD`) :
   ```bash
   git remote add origin https://github.com/<ton-compte>/jjd-app.git
   git push -u origin master
   ```

Ensuite, sur un autre poste : `gh auth login` puis `git clone`.

### Option B — dépôt sur le VPS Combell *(aucun tiers)*

Le VPS te sert de « GitHub ». Pas d'interface web, mais 100 % chez toi.

1. En SSH sur le VPS :
   ```bash
   mkdir -p ~/git && git init --bare ~/git/jjd.git
   ```
2. En local :
   ```bash
   git remote add origin ssh://<user>@<ip-ou-domaine-du-vps>/~/git/jjd.git
   git push -u origin master
   ```
3. Sur un autre poste : `git clone ssh://<user>@<vps>/~/git/jjd.git JJD`

> Tu peux avoir **les deux** remotes (GitHub + VPS). Plus tard, le VPS pourra se
> déployer tout seul avec un hook `post-receive`.

---

## 2. Démarrer sur un nouveau poste

Prérequis : **Node 20+** (idéalement 24) et **Git**.

```bash
git clone <url-du-dépôt> JJD
cd JJD
npm run setup     # installe tout, crée .env depuis .env.example, base SQLite + comptes de démo
npm run dev       # API sur :4100, web sur :3100
```

Connexion bureau : `david@jjd-consult.be` / `jjd`.
À ce stade la base ne contient que les **comptes de démo**, pas les vraies données.

### Récupérer les vraies données — 2 méthodes

| Méthode | Quoi copier | Puis |
|---|---|---|
| **Fichiers source** | le dossier `data-import/` (~233 Mo : Excel, CSV TrustUp, 1478 PDF) | `npm run import:all` |
| **Base déjà remplie** | le seul fichier `apps/api/prisma/dev.db` | rien, elle est prête |

La 2ᵉ méthode est plus rapide pour juste « voir » l'app ailleurs. La 1ʳᵉ est
nécessaire si tu veux ré-importer / tester les scripts d'import.

---

## 3. Les fichiers à transférer à la main (jamais dans Git)

| Fichier / dossier | Contenu | Comment le transférer |
|---|---|---|
| `apps/api/.env` | secrets dev (JWT, URL base, clés Google/DeepL) | recréé auto depuis `.env.example` ; ne diffère que par `GOOGLE_CALENDAR_ID` |
| `data-import/` | Excel + exports TrustUp + PDF (~233 Mo) | clé USB, disque, **dossier cloud perso** (jamais dans Git) |
| `apps/api/prisma/dev.db*` | base SQLite de dev remplie | idem, un seul fichier |
| `apps/api/uploads/` | photos de chantier + PDF importés | régénéré par `npm run import:all` (les PDF) ; les photos sont locales |
| `apps/api/secrets/google-sa.json` | clé du compte de service Google (pas encore créée) | idem, jamais dans Git |

Pour l'appli mobile : `cd apps/mobile && npm install` (elle est hors du monorepo).

---

## 4. Cycle de travail à plusieurs postes

```bash
git pull            # récupérer les derniers changements
# … travailler …
npm run typecheck && npm test     # avant de pousser
git add -A && git commit -m "…"
git push
```

Un seul dépôt, deux personnes (toi + Julien) : `git pull` avant de commencer,
`git push` en fin de session, on évite de travailler au même endroit en même temps.

---

## 5. Plus tard : déploiement sur le VPS Combell (lot 7)

Vue d'ensemble, pas à faire maintenant :

- **VPS Combell** fait tourner, via Docker Compose : PostgreSQL + l'API + le web + un
  reverse-proxy (Caddy) qui gère le HTTPS automatiquement (Let's Encrypt).
- **Nom de domaine chez Behostings** : faire pointer un enregistrement **A**
  `jjd-consult.be` (et `www`, `app`, `portail` si besoin) vers l'**IP du VPS Combell**.
  Le site reste servi par le VPS, plus par l'hébergement mutualisé Behostings.
- **Migration base** : `DATABASE_URL` passe de SQLite à PostgreSQL ; `prisma migrate deploy`.
  Import des vraies données une fois en prod.
- **SMTP réel** (Behostings ou autre) pour les liens magiques du portail + notifications.
- **Déploiement** : soit le VPS `git pull` + rebuild, soit une GitHub Action qui pousse
  sur le VPS à chaque commit sur `master`.
- **Sauvegardes** : dump PostgreSQL quotidien + `apps/api/uploads/` (photos) vers un
  stockage externe.

Le détail se fera au lot 7, une fois les lots facturation/Peppol validés.
