# JJD App

Plateforme de gestion de **JJD Consult** — chantiers, équipes, planning, rentabilité, portail client.
Remplace à terme TrustUp Pro. Voir le plan de cadrage :
https://claude.ai/code/artifact/438f87b3-5f0b-4237-8637-1ec78ec5bcda

## Démarrer (dev, local)

```bash
npm run setup     # install + build shared + crée la base SQLite + seed
npm run import     # importe l'historique depuis data-import/calculs-rentabilite.xlsx
npm run dev        # API (4100) + web bureau (3100)
```

Ou double-clic sur `LANCER-JJD.cmd`.

Connexion : `david@jjd-consult.be` / `jjd` (comptes de démarrage : david@ julien@ melvina@ chef@ ouvrier@).

## Structure

| Dossier | Rôle |
|---|---|
| `packages/shared` | Types, enums métier, TVA belge, **calcul de marge réelle**, i18n |
| `apps/api` | Express + Prisma (SQLite en dev → PostgreSQL en prod) |
| `apps/web` | Next.js 15 — bureau (admin), plus tard portail client + site |
| `data-import/` | Fichiers source (Excel, exports TrustUp) — **non versionné** |

## Où on en est

- **Lot 0** ✅ Fondations, schéma de données, auth par rôles, import Excel (843 chantiers, 9363 pointages, 7600 écritures)
- **Lot 1** ✅ Web bureau : dashboard, chantiers + rentabilité temps réel, contacts, immeubles/ACP, équipe, CRM, file de contrôle
- **Lot 2** ✅ (à valider) Planning web, pointage + décomptes mensuels, appli mobile Expo (compteur hors-ligne), push Google Agenda
- Lots 3-7 : fil de chantier, portail client, compta, facturation/Peppol, stores

### À faire côté David
- Export **devis + factures** TrustUp → `data-import/` → `npm run import:trustup -- <fichiers>`
- **Compte de service Google** (`apps/api/secrets/google-sa.json`) + partager l'agenda avec (ID déjà configuré)
- Tester l'appli mobile ensemble (`LANCER-APPLI-MOBILE.cmd` + téléphone sur le même WiFi)

## Scripts utiles

```bash
npm run typecheck              # les 3 workspaces
npm run test                   # shared + api
npm run db:reset -w @jjd/api   # remet la base à zéro + seed
npm run import -w @jjd/api -- chemin/vers/fichier.xlsx
```
