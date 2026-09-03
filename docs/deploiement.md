# Mise en ligne — VPS Combell (à côté de Bricoloc)

**Cible (phase de test)** : `https://new.jjd-consult.be` servi par le VPS Combell
(`136.144.209.157`). Le site principal `jjd-consult.be` reste sur son hébergement
actuel — on ne le touche pas. Bascule finale plus tard (§9).

L'app Next sert le **site vitrine + `/app` (bureau) + `/portail` (client)** ;
l'API est derrière `/jjd-api`. Le HTTPS et le routage par domaine sont assurés
par le **nginx de Bricoloc** déjà en place (les ports 80/443 sont à lui).

Dépôt : `github.com/nqrko-jjd/jjd_app`, branche `main`.

Architecture :

```
Internet ──443──► nginx (pile Bricoloc)
                   ├── new.bricoloc.be     ──► conteneurs Bricoloc
                   └── new.jjd-consult.be  ──► jjd-web:3000  (+ /jjd-api ─► jjd-api:4100)
                                                réseau Docker partagé « edge »
jjd-api ──► jjd-db (PostgreSQL)   +   volume « uploads »  (photos, PDF)
```

## Ordre des opérations (important)

1. DNS `new.jjd-consult.be` → `136.144.209.157` (§3)
2. `git push` des deux dépôts (JJD **et** le commit Bricoloc « co-hébergement »)
   — mais **ne pas s'inquiéter** si le CI Bricoloc échoue : le réseau `edge`
   n'existe pas encore, l'ancien nginx continue de tourner.
3. `ssh bricoloc-vps` puis, dans l'ordre : §2.1 (réseau) → §4 (cloner + démarrer
   JJD) → §5 (certificat) → §2.2 (`git pull` Bricoloc + `up -d`).
4. Ajouter les secrets GitHub du dépôt JJD (§7) — ensuite tout est automatique.
5. Importer les données (§6).

---

## 1. Git — dépôt GitHub

Déjà fait : remote `origin` = `https://github.com/nqrko-jjd/jjd_app.git`, branche `main`.

```bash
git push -u origin main
```

Ne sont **pas** dans Git : `.env*`, `apps/api/secrets/`, `data-import/`,
`apps/api/prisma/dev.db`, `apps/api/uploads/` → transférés à la main (§5).

---

## 2. Préparer le VPS (une seule fois)

En SSH sur le VPS. Docker + compose sont déjà là (Bricoloc tourne).

### 2.1 Réseau partagé

```bash
docker network create edge
```

### 2.2 nginx de Bricoloc — déjà prêt

Le `docker-compose.yml` de Bricoloc **contient déjà** (commit à pousser) le
rattachement au réseau `edge` + le montage de
`/opt/jjd/deploy/nginx/new.jjd-consult.be.conf`. Il suffit, une fois JJD cloné
dans `/opt/jjd` (§4) :

```bash
cd /opt/bricoloc && git pull origin main
docker compose --env-file .env.production up -d
```

⚠️ Ordre important : **cloner JJD (§4) AVANT** ce `git pull` de Bricoloc, sinon le
montage du fichier nginx pointe dans le vide et nginx ne démarre pas.

---

## 3. DNS

Un **seul** enregistrement à ajouter, chez l'hébergeur DNS de `jjd-consult.be` :

| Type | Nom | Valeur |
|---|---|---|
| A | `new` | `136.144.209.157` |

Le site principal `jjd-consult.be` n'est pas touché. Propagation : quelques
minutes à 1 h. Vérifier : `dig +short new.jjd-consult.be`.

---

## 4. Déployer JJD

```bash
sudo mkdir -p /opt/jjd && sudo chown "$USER" /opt/jjd
git clone https://github.com/nqrko-jjd/jjd_app.git /opt/jjd
cd /opt/jjd

cp deploy/.env.production.example .env.production
nano .env.production          # SITE_URL=https://new.jjd-consult.be
                              # POSTGRES_PASSWORD, JWT_SECRET (openssl rand -hex 32),
                              # BRICOLOC_API_KEY (= PARTNER_API_KEY de Bricoloc), …

mkdir -p apps/api/secrets     # y déposer google-sa.json / ponto-*.pem si utilisés

docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production ps
```

Au 1er démarrage l'API fait `db:deploy` (crée le schéma PostgreSQL) puis démarre.
`docker compose … logs -f api` pour suivre.

---

## 5. Certificat HTTPS pour new.jjd-consult.be

Le DNS (§3) doit déjà pointer sur le VPS, JJD doit tourner (§4), mais le nginx de
Bricoloc n'a **pas encore** la route JJD — c'est normal : sa config par défaut
sert `/.well-known/acme-challenge/` pour tout domaine non reconnu. On émet donc
le certificat AVANT le `git pull` de Bricoloc (§2.2).

```bash
cd /opt/bricoloc
docker compose --env-file .env.production run --rm --entrypoint certbot certbot \
  certonly --webroot -w /var/www/certbot --agree-tos --no-eff-email \
  --email david@jjd-consult.be -d new.jjd-consult.be

# puis SEULEMENT maintenant : charger la route JJD (§2.2)
git pull origin main
docker compose --env-file .env.production up -d
```

→ `https://new.jjd-consult.be` répond. Renouvellement automatique (service `certbot` de Bricoloc).

---

## 6. Charger les données réelles

La base est vide (schéma seulement). Deux options :

### Option A — ré-importer depuis les fichiers source *(recommandé)*

```bash
# copier le dossier data-import/ sur le VPS (233 Mo : Excel, CSV/PDF TrustUp)
scp -r "C:/Users/david/Documents/JJD/data-import"  <user>@<vps>:/opt/jjd/

cd /opt/jjd
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm \
  -v /opt/jjd/data-import:/repo/data-import:ro \
  api sh -c "cd /repo/apps/api && tsx scripts/import-xlsx.ts && tsx scripts/import-vehicles.ts && tsx scripts/import-trustup.ts && tsx scripts/import-agenda.ts"
```

(WhatsApp : ajouter `&& tsx scripts/import-whatsapp.ts` si les exports sont dans `data-import/whatsapp/`.)

### Option B — recopier la base SQLite de dev

Non applicable : la prod est PostgreSQL. Rester sur l'option A.

Ensuite, se connecter à `https://jjd-consult.be/login` (`david@jjd-consult.be` /
`jjd` — **à changer**), puis renseigner *Paramètres → Société* (TVA, IBAN, adresse).

---

## 7. Mises à jour — automatiques (GitHub Actions)

`.github/workflows/deploy.yml` : push sur `main` → SSH VPS →
`git reset --hard` + `docker compose -f docker-compose.prod.yml up -d --build`.

**Secrets à ajouter au dépôt `jjd_app`** (Settings → Secrets and variables →
Actions) — mêmes valeurs que Bricoloc sauf `VPS_PATH` :

| Secret | Valeur |
|---|---|
| `VPS_HOST` | `136.144.209.157` |
| `VPS_USER` | `bricoloc` |
| `VPS_SSH_KEY` | la clé privée de déploiement (identique à Bricoloc — coller depuis un fichier, pas depuis un bloc de chat, pour garder les retours ligne) |
| `VPS_PATH` | `/opt/jjd` |

Manuellement si besoin :

```bash
cd /opt/jjd && git pull && docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

L'API relance `db:deploy` à chaque fois (idempotent).

> ⚠️ `db:deploy` = `prisma db push --accept-data-loss`. Tant qu'on n'a pas de
> migrations Prisma, une suppression de colonne dans le schéma **perd la donnée**.
> À faire avant d'avoir des données critiques : passer à `prisma migrate`.

---

## 8. Sauvegardes

Cron quotidien sur le VPS :

```bash
# dump base
docker compose -f /opt/jjd/docker-compose.prod.yml --env-file /opt/jjd/.env.production \
  exec -T db pg_dump -U jjd jjd | gzip > /opt/backups/jjd-$(date +\%F).sql.gz
# médias
docker run --rm -v jjd_uploads:/u -v /opt/backups:/b alpine \
  tar czf /b/jjd-uploads-$(date +\%F).tar.gz -C /u .
```

Copier `/opt/backups/` vers un stockage externe.

---

## 9. À finaliser après la mise en ligne

- **Ponto** : `PONTO_REDIRECT_URI` = `https://new.jjd-consult.be/api/ponto/callback`
  (dérivé de `SITE_URL` par le compose) → l'enregistrer sur le dashboard Ponto +
  déposer `ponto-certificate.pem` / `ponto-private-key.pem` dans `apps/api/secrets/`.
- **SMTP réel** pour les liens magiques du portail (aujourd'hui : log console).
- **Migrations Prisma** (voir §7).
- **Compte de service Google** (`apps/api/secrets/google-sa.json`) + partage de l'agenda.
- **Apps mobiles** : build EAS + `API_URL` = `https://new.jjd-consult.be`.
- **Swap 8 Go** sur le VPS (deux stacks Next à builder) :
  ```bash
  sudo swapoff -a
  sudo fallocate -l 8G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  docker builder prune -af      # nettoie le cache de build accumulé
  ```

## 10. Bascule finale vers jjd-consult.be

Quand tout est validé : DNS `jjd-consult.be` (+ `www`) → VPS, dupliquer le vhost
en `jjd-consult.be`, émettre le certif, `SITE_URL=https://jjd-consult.be`,
résilier l'ancien hébergement.
