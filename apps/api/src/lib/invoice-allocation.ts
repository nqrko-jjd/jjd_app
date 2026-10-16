/**
 * Facture consolidée : répartition automatique du coût entre chantiers d'après les bordereaux reliés (chacun a son chantier et son HT).
 * Chaque bordereau d'un AUTRE chantier que celui de la facture déplace son HT vers son chantier ; le reste, que les bordereaux ne couvrent pas
 * (transport, reliquat…), demeure sur le chantier de la facture. Les bordereaux du même chantier que la facture ou sans chantier n'y changent rien.
 * Si les bordereaux dépassent la facture, leurs parts sont réduites proportionnellement (jamais plus que la facture).
 */
export interface AllocationPart { worksiteId: string | null; ht: number }

const cents = (n: number) => Math.round(n * 100) / 100;

export function invoiceWorksiteAllocation(inv: { ht: number; worksiteId: string | null }, slips: { ht: number; worksiteId: string | null }[]): AllocationPart[] {
  const moving = new Map<string, number>();
  for (const s of slips) if (s.worksiteId && s.worksiteId !== inv.worksiteId && s.ht) moving.set(s.worksiteId, (moving.get(s.worksiteId) ?? 0) + s.ht);
  const total = [...moving.values()].reduce((a, n) => a + n, 0);
  if (!total) return [];
  const scale = total > inv.ht && inv.ht > 0 ? inv.ht / total : 1;
  const parts: AllocationPart[] = [...moving].map(([worksiteId, ht]) => ({ worksiteId, ht: cents(ht * scale) }));
  const rest = cents(inv.ht - parts.reduce((a, p) => a + p.ht, 0));
  if (rest > 0.005 || !parts.length) parts.unshift({ worksiteId: inv.worksiteId, ht: rest });
  return parts;
}
