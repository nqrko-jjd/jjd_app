/** Géocodage d'adresse via OpenStreetMap / Nominatim (usage modéré, 1 req/s). */
export async function geocode(query: string): Promise<{ lat: number; lng: number; label: string } | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'JJD-App/1.0 (info@jjd-consult.be)' } });
  if (!r.ok) return null;
  const hits = (await r.json()) as { lat: string; lon: string; display_name: string }[];
  const hit = hits[0];
  return hit ? { lat: Number(hit.lat), lng: Number(hit.lon), label: hit.display_name } : null;
}
