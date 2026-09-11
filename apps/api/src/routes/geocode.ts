import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { requireAuth, STAFF } from '../lib/auth.js';
import { searchAddresses } from '../lib/geocode.js';

export const geocodeRouter = Router();

/** Suggestions d'adresse au fil de la frappe, utilisées par le composant d'autocomplétion
 *  côté web (tous les formulaires avec un champ adresse). */
geocodeRouter.get(
  '/search',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? '');
    const items = await searchAddresses(q);
    res.json({ items });
  }),
);
