# syntax=docker/dockerfile:1
# Contexte de build = racine du dépôt :  docker build -f apps/api/Dockerfile .

FROM node:22-bookworm-slim AS base
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl curl poppler-utils \
  && rm -rf /var/lib/apt/lists/*

# ---------- dépendances complètes + build ----------
FROM base AS build
ENV NODE_ENV=development
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY packages/shared packages/shared
COPY apps/api apps/api
# URL factice : oriente set-db-provider + prisma generate vers le client PostgreSQL
# (aucune connexion au build). Le vrai DATABASE_URL est injecté au runtime.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN npm run build --workspace @jjd/shared \
 && npm run build --workspace @jjd/api

# ---------- dépendances de production seules ----------
FROM base AS prod-deps
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev

# ---------- image finale ----------
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /repo/apps/api

COPY package.json package-lock.json /repo/
COPY --from=prod-deps /repo/node_modules /repo/node_modules
COPY --from=build /repo/packages/shared/dist /repo/packages/shared/dist
COPY --from=build /repo/packages/shared/package.json /repo/packages/shared/package.json
COPY --from=build /repo/apps/api/dist /repo/apps/api/dist
COPY --from=build /repo/node_modules/.prisma /repo/node_modules/.prisma
COPY apps/api/package.json ./package.json
COPY apps/api/prisma ./prisma
COPY apps/api/scripts ./scripts

RUN mkdir -p uploads && chown -R node:node /repo
USER node

EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s \
  CMD curl -fsS http://localhost:4100/health || exit 1

# Aligne le schéma sur Postgres (db push) puis démarre l'API.
CMD ["sh", "-c", "npm run db:deploy && node dist/src/index.js"]
