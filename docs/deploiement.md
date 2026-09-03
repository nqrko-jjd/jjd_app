# Mise en ligne — VPS Combell (à côté de Bricoloc)

**Cible** : `https://jjd-consult.be` servi par le VPS Combell.
L'app Next sert le **site vitrine + `/app` (bureau) + `/portail` (client)** ;
l'API est derrière `/jjd-api`. Le HTTPS et le routage par domaine sont assurés
par le **nginx de Bricoloc** déjà en place (les ports 80/443 sont à lui).

Architecture :

```
Internet ──443──► nginx (pile Bricoloc)
                   ├── bricoloc.be     ──► conteneurs Bricoloc
                   └── jjd-consult.be  ──► jjd-web:3000  (+ /jjd-api ─► jjd-api:4100)
                                            réseau Docker partagé « edge »
jjd-api ──► jjd-db (PostgreSQL)   +   volume « uploads »  (photos, PDF)
```

---

## 1. Git — dépôt GitHub privé

Sur ce PC :

```bash
winget install --id GitHub.cli -e
gh auth login          # GitHub.com → HTTPS → connexion navigateur
gh repo create jjd-app --private --source=. --remote=origin --push
```

(ou : créer le dépôt privé `jjd-app` sur github.com sans README, puis
`git remote add origin https://github.com/<compte>/jjd-app.git` et
`git push -u origin master`.)

Ne sont **pas** dans Git : `.env*`, `apps/api/secrets/`, `data-import/`,
`apps/api/prisma/dev.db`, `apps/api/uploads/` → transférés à la main (§5).

---

## 2. Préparer le VPS (une seule fois)

En SSH sur le VPS. Docker + compose sont déjà là (Bricoloc tourne).

### 2.1 Réseau partagé

```bash
docker network create edge
```

### 2.2 Rattacher le nginx de Bricoloc au réseau « edge »

Dans le **`docker-compose.yml` de Bricoloc**, service `nginx` :

```yaml
  nginx:
    # …existant…
    networks: [default, edge]
    volumes:
      # …existant…
      - /opt/jjd/deploy/nginx/jjd-consult.be.conf:/etc/nginx/conf.d/jjd-consult.be.conf:ro
```

et en bas du fichier :

```yaml
networks:
  edge:
    external: true
  default:
```

Puis : `cd <bricoloc> && docker compose --env-file .env.production up -d nginx`
(recrée juste nginx, sans toucher au reste).

---

## 3. DNS chez Behostings

Faire pointer vers **l'IP du VPS Combell** :

| Type | Nom | Valeur |
|---|---|---|
| A | `jjd-consult.be` (`@`) | `<IP du VPS>` |
| A | `www` | `<IP du VPS>` |

⚠️ Le site actuel (hébergement mutualisé Behostings) cesse d'être servi dès que
le DNS propage. Prévoir de le faire quand la pile VPS est prête à démarrer.
Propagation : quelques minutes à 1–2 h. Vérifier : `dig +short jjd-consult.be`.

---

## 4. Déployer JJD

```bash
sudo mkdir -p /opt/jjd && sudo chown $USER /opt/jjd
git clone https://github.com/<compte>/jjd-app.git /opt/jjd
cd /opt/jjd

cp deploy/.env.production.example .env.production
nano .env.production          # POSTGRES_PASSWORD, JWT_SECRET (openssl rand -hex 32),
                              # BRICOLOC_API_KEY (= PARTNER_API_KEY de Bricoloc), …

mkdir -p apps/api/secrets     # y déposer google-sa.json / ponto-*.pem si utilisés

docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production ps
```

Au 1er démarrage l'API fait `db:deploy` (crée le schéma PostgreSQL) puis démarre.
`docker compose … logs -f api` pour suivre.

---

## 5. Certificat HTTPS pour jjd-consult.be

Le DNS (§3) doit déjà pointer sur le VPS. On utilise le **certbot de Bricoloc** :

```bash
cd <bricoloc>
docker compose --env-file .env.production run --rm --entrypoint certbot certbot \
  certonly --webroot -w /var/www/certbot --agree-tos --no-eff-email \
  --email david@jjd-consult.be \
  -d jjd-consult.be -d www.jjd-consult.be

docker compose --env-file .env.production exec nginx nginx -s reload
```

→ `https://jjd-consult.be` répond. Le renouvellement est automatique (service `certbot` de Bricoloc).

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

## 7. Mises à jour

```bash
cd /opt/jjd
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
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

- **Ponto** : `PONTO_REDIRECT_URI` devient `https://jjd-consult.be/api/ponto/callback`
  (déjà câblé par le compose) → l'enregistrer sur le dashboard Ponto + déposer
  `ponto-certificate.pem` / `ponto-private-key.pem` dans `apps/api/secrets/`.
- **SMTP réel** pour les liens magiques du portail (aujourd'hui : log console).
- **Migrations Prisma** (voir §7).
- **Compte de service Google** (`apps/api/secrets/google-sa.json`) + partage de l'agenda.
- **Apps mobiles** : build EAS + `API_URL` = `https://jjd-consult.be`.
