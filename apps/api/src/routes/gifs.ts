import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { requireAuth, STAFF } from '../lib/auth.js';

/** Recherche de GIF (Giphy, offre gratuite). La clé reste côté serveur (GIPHY_API_KEY) ;
 *  sans clé, l'appli masque simplement le bouton GIF. */
export const gifsRouter = Router();

type GiphyItem = { id: string; images?: { fixed_height_small?: { url?: string }; fixed_height?: { url?: string } } };

gifsRouter.get('/search', requireAuth(...STAFF), asyncHandler(async (req, res) => {
  const key = process.env.GIPHY_API_KEY;
  if (!key) { res.json({ enabled: false, gifs: [] }); return; }
  const q = String(req.query.q ?? '').trim().slice(0, 60);
  const url = new URL(`https://api.giphy.com/v1/gifs/${q ? 'search' : 'trending'}`);
  url.searchParams.set('api_key', key);
  if (q) url.searchParams.set('q', q);
  url.searchParams.set('limit', '24');
  url.searchParams.set('rating', 'pg-13');
  url.searchParams.set('lang', 'fr');
  let items: GiphyItem[] = [];
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (r.ok) items = ((await r.json()) as { data?: GiphyItem[] }).data ?? [];
  } catch { /* réseau : liste vide */ }
  const gifs = items
    .map((g) => ({ id: g.id, preview: g.images?.fixed_height_small?.url, url: g.images?.fixed_height?.url }))
    .filter((g): g is { id: string; preview: string; url: string } => !!g.preview && !!g.url);
  res.json({ enabled: true, gifs });
}));
