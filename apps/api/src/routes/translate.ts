import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http.js';
import { requireAuth } from '../lib/auth.js';
import { LOCALES, translateUiStrings } from '../lib/translate.js';

/** Traduction à la volée des textes d'interface français qui ne sont pas dans les dictionnaires (voir web/src/lib/dom-translate.ts). */
export const translateRouter = Router();
translateRouter.post(
  '/ui',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const i = z.object({ locale: z.enum(LOCALES), strings: z.array(z.string().max(300)).max(80) }).parse(req.body);
    res.json({ translations: await translateUiStrings(i.strings, i.locale) });
  }),
);
