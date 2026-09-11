/** Géocodage / recherche d'adresse via OpenStreetMap / Nominatim (usage modéré, 1 req/s max —
 *  toutes les requêtes de ce fichier passent par une file d'attente commune pour respecter ça
 *  même si plusieurs utilisateurs tapent en même temps). */

let queue: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

async function throttledFetch(url: string): Promise<Response> {
  const run = queue.then(async () => {
    const wait = Math.max(0, lastCallAt + 1100 - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
    return fetch(url, { headers: { 'User-Agent': 'JJD-App/1.0 (info@jjd-consult.be)' } });
  });
  queue = run.catch(() => {});
  return run;
}

export async function geocode(query: string): Promise<{ lat: number; lng: number; label: string } | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
  const r = await throttledFetch(url);
  if (!r.ok) return null;
  const hits = (await r.json()) as { lat: string; lon: string; display_name: string }[];
  const hit = hits[0];
  return hit ? { lat: Number(hit.lat), lng: Number(hit.lon), label: hit.display_name } : null;
}

export interface AddressHit {
  label: string;
  street: string;
  postalCode: string;
  city: string;
  lat: number;
  lng: number;
}

interface NominatimSearchHit {
  lat: string;
  lon: string;
  display_name: string;
  address?: {
    road?: string;
    house_number?: string;
    postcode?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
  };
}

/** Transforme un résultat brut Nominatim en suggestion utilisable dans un formulaire —
 *  extrait pure (sans fetch) pour rester testable sans réseau. */
export function mapNominatimHit(h: NominatimSearchHit): AddressHit {
  const a = h.address ?? {};
  const street = [a.road, a.house_number].filter(Boolean).join(' ') || (h.display_name.split(',')[0] ?? '').trim();
  const city = a.city || a.town || a.village || a.municipality || '';
  return { label: h.display_name, street, postalCode: a.postcode ?? '', city, lat: Number(h.lat), lng: Number(h.lon) };
}

/** Suggestions d'adresse au fil de la frappe (type-ahead), biaisées Belgique. */
export async function searchAddresses(query: string, limit = 6): Promise<AddressHit[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=be&limit=${limit}&q=${encodeURIComponent(q)}`;
  const r = await throttledFetch(url);
  if (!r.ok) return [];
  const hits = (await r.json()) as NominatimSearchHit[];
  return hits.map(mapNominatimHit);
}
