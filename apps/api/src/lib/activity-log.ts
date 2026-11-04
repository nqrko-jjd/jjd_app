/**
 * Journal d'activité global : chaque écriture réussie (POST / PUT / PATCH / DELETE) faite par un utilisateur connecté
 * est consignée dans AuditLog (action « http »). Seuls les NOMS des champs envoyés sont gardés — jamais les valeurs
 * (mots de passe, montants, textes…) — et ni les lectures, ni la connexion, ni les pings GPS / push ne sont tracés.
 * Aucun changement de schéma : on réutilise la table AuditLog existante.
 */
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../db.js';

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SKIP = [/^\/api\/auth(\/|$)/, /^\/api\/gps/, /^\/api\/push/, /^\/api\/public/, /^\/api\/assistant/, /^\/api\/translate/, /^\/api\/geocode/, /^\/api\/journal/, /^\/api\/messagerie\/[^/]*\/?(read|typing)/];
const SECRET = /pass|token|secret|pin|code/i;
const ID = /^c[a-z0-9]{20,}$/;

export function activityLog(req: Request, res: Response, next: NextFunction) {
  if (!WRITE.has(req.method) || process.env.NODE_ENV === 'test') return next();
  res.on('finish', () => {
    try {
      const user = req.user;
      if (!user || res.statusCode >= 400) return;
      const path = req.originalUrl.split('?')[0] ?? '';
      if (SKIP.some((r) => r.test(path))) return;
      const segs = path.split('/').filter(Boolean); // api, entité, …
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? Object.keys(req.body as object).filter((k) => !SECRET.test(k)).slice(0, 30) : [];
      void prisma.auditLog.create({
        data: {
          actorId: user.id, action: 'http', entity: segs[1] ?? 'api', entityId: segs.slice(2).find((s) => ID.test(s)) ?? null,
          meta: { method: req.method, path, status: res.statusCode, ...(body.length && req.method !== 'DELETE' ? { fields: body } : {}) },
        },
      }).catch(() => undefined);
    } catch { /* le journal ne doit jamais gêner une requête */ }
  });
  next();
}
