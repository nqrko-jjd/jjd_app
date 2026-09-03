import type { Router } from 'express';
import multer from 'multer';
import { storeImage } from './media.js';
import { asyncHandler, HttpError } from './http.js';
import { requireAuth, OFFICE } from './auth.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

/**
 * Ajoute `POST /:id/photo` (multipart, champ « file ») et `DELETE /:id/photo`
 * à un routeur. `update` reçoit l'id et les URLs (null pour la suppression).
 */
export function attachPhotoRoutes(
  router: Router,
  update: (id: string, data: { photoUrl: string | null; photoThumbUrl: string | null }) => Promise<unknown>,
) {
  router.post(
    '/:id/photo',
    requireAuth(...OFFICE),
    upload.single('file'),
    asyncHandler(async (req, res) => {
      if (!req.file) throw new HttpError(422, 'Aucun fichier');
      const img = await storeImage(req.file.buffer);
      const row = await update(req.params.id as string, { photoUrl: img.url, photoThumbUrl: img.thumbUrl });
      res.status(201).json({ ok: true, photoUrl: img.url, photoThumbUrl: img.thumbUrl, row });
    }),
  );

  router.delete(
    '/:id/photo',
    requireAuth(...OFFICE),
    asyncHandler(async (req, res) => {
      await update(req.params.id as string, { photoUrl: null, photoThumbUrl: null });
      res.json({ ok: true });
    }),
  );
}
