import { env } from '../env.js';

/**
 * Un seul schéma Prisma sert les deux moteurs : SQLite en dev (zéro service),
 * PostgreSQL en prod — voir `scripts/set-db-provider.mjs`. `mode: 'insensitive'`
 * (repose sur ILIKE) n'existe QUE pour Postgres ; Prisma lève une erreur de
 * validation si on le passe sur SQLite. Sur SQLite, `contains` est déjà
 * insensible à la casse pour l'ASCII nativement (pas besoin du mode).
 *
 * `...insensitive` s'étale dans un `contains` : `{ contains: q, ...insensitive }`.
 */
export const insensitive = env.databaseUrl.startsWith('postgres') ? ({ mode: 'insensitive' } as const) : {};
