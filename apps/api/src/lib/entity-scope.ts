/**
 * Cloisonnement par entité (JJD / Tonton / M7) : un utilisateur dont `entityScope` est renseigné ne voit et ne modifie QUE les chantiers de cette entité
 * et tout ce qui s'y rattache (planning, documents, dépenses, pointages, fil, photos…), sur le site comme sur mobile.
 *
 * Deux verrous, volontairement redondants :
 *  1. au niveau des données : chaque lecture/écriture sur un modèle rattaché à un chantier est filtrée automatiquement (voir db.ts) ;
 *  2. au niveau des routes : liste blanche des zones accessibles ; tout le reste (banque, contacts, réglages, CRM, boîte mail…) est refusé.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, Response, NextFunction } from 'express';
import { HttpError } from './http.js';

export interface ScopeStore { entity: string; worksiteIds?: string[] }
export const scopeStore = new AsyncLocalStorage<ScopeStore>();

/** Zones de l'API accessibles à un utilisateur cloisonné (préfixes). Tout le reste répond 403. */
export const SCOPED_ALLOW = [
  '/api/auth', '/api/worksites', '/api/planning', '/api/meta', '/api/dashboard', '/api/documents',
  '/api/finance/expenses', '/api/finance/analytics', '/api/timesheet', '/api/tasks', '/api/phases', '/api/reports',
  '/api/messagerie', '/api/equipment', '/api/consumables', '/api/teams', '/api/absences', '/api/push', '/api/geocode',
];
/** Listes simples seulement (ni fiche détaillée, ni coûts) : annuaire du personnel et véhicules pour composer un planning. */
export const SCOPED_EXACT = ['/api/people', '/api/vehicles'];

export const isAllowedForScoped = (path: string) => SCOPED_EXACT.includes(path.endsWith('/') ? path.slice(0, -1) : path) || SCOPED_ALLOW.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`));

/** Les taux horaires et les montants versés ne sont pas pour un utilisateur cloisonné : retirés des réponses de l'annuaire du personnel. */
const PEOPLE_SECRET = new Set(['hourlyRate', 'payoutPerDay']);
function strip(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!PEOPLE_SECRET.has(k)) out[k] = strip(x);
    return out;
  }
  return v;
}

export function entityScopeMiddleware(req: Request, res: Response, next: NextFunction) {
  const scope = req.user?.entityScope;
  if (!scope) return next();
  const path = req.originalUrl.split('?')[0]!;
  if (path.startsWith('/api/') && !isAllowedForScoped(path)) return next(new HttpError(403, 'Accès réservé : ce compte est limité à ses chantiers.'));
  if (path.startsWith('/api/people')) {
    const json = res.json.bind(res);
    res.json = ((body: unknown) => json(strip(body))) as typeof res.json;
  }
  scopeStore.run({ entity: scope }, () => next());
}
