import { prisma } from '../db.js';
import { geocode } from './geocode.js';

/**
 * Point GPS d'un chantier déduit de son adresse (celle du formulaire, contrôlée par l'autocomplétion — à défaut celle de l'immeuble).
 * Sert de référence au contrôle de pointage. Silencieux : un échec n'empêche jamais d'enregistrer le chantier.
 * `force` = l'adresse vient de changer, on recalcule même si un point existe déjà.
 */
const failedAt = new Map<string, number>();
const RETRY_AFTER_MS = 6 * 3600_000;

export async function autoGeocodeWorksite(id: string, opts: { force?: boolean } = {}): Promise<boolean> {
  try {
    const last = failedAt.get(id);
    if (!opts.force && last && Date.now() - last < RETRY_AFTER_MS) return false;
    const ws = await prisma.worksite.findUnique({
      where: { id },
      select: { lat: true, address: true, postalCode: true, city: true, acp: { select: { address: true, postalCode: true, city: true } } },
    });
    if (!ws || (ws.lat != null && !opts.force)) return false;
    const street = ws.address || ws.acp?.address;
    const town = [ws.postalCode || ws.acp?.postalCode, ws.city || ws.acp?.city].filter(Boolean).join(' ');
    if (!street && !town) return false;
    const q = [street, town, 'Belgique'].filter(Boolean).join(', ');
    // pas de repli sur le centre de la commune : un point faux fausserait le contrôle de pointage (mieux vaut qu'il soit fixé au premier pointage sur place)
    const hit = await geocode(q);
    if (!hit) { failedAt.set(id, Date.now()); return false; }
    await prisma.worksite.update({ where: { id }, data: { lat: hit.lat, lng: hit.lng, geoSetAt: new Date() } });
    failedAt.delete(id);
    return true;
  } catch {
    failedAt.set(id, Date.now());
    return false;
  }
}

/** Au démarrage : géolocalise en arrière-plan les chantiers actifs qui ont une adresse mais pas encore de point GPS. */
export async function backfillWorksiteGeo(limit = 150): Promise<number> {
  const rows = await prisma.worksite.findMany({
    where: { lat: null, archived: false, kind: 'project', OR: [{ address: { not: null } }, { city: { not: null } }] },
    select: { id: true },
    orderBy: { updatedAt: 'desc' },
    take: limit,
  });
  let done = 0;
  for (const r of rows) if (await autoGeocodeWorksite(r.id)) done++;
  return done;
}
