/**
 * Rapport en LECTURE SEULE : historique de création des dépenses source 'email' (boîte
 * mail factures) — sert à diagnostiquer un afflux de nouvelles lignes signalé par
 * l'utilisateur : regroupe par heure de création pour voir QUAND elles sont apparues.
 *
 *   npm run report:email-ledger-timeline
 */
import { prisma } from '../src/db.js';

async function main() {
  const rows = await prisma.ledgerEntry.findMany({
    where: { source: 'email' },
    select: { id: true, createdAt: true, notes: true, docNumber: true, supplierName: true, ht: true, ttc: true },
    orderBy: { createdAt: 'desc' },
  });
  console.log(`Total dépenses source 'email' : ${rows.length}`);

  const byHour = new Map<string, number>();
  for (const r of rows) {
    const key = r.createdAt.toISOString().slice(0, 13); // yyyy-mm-ddThh
    byHour.set(key, (byHour.get(key) ?? 0) + 1);
  }
  console.log('\nPar heure de création :');
  for (const [h, n] of [...byHour.entries()].sort()) console.log(' ', h, ':', n);

  console.log('\n20 plus récentes :');
  for (const r of rows.slice(0, 20)) {
    console.log(' ', r.createdAt.toISOString(), '|', r.supplierName ?? '—', '|', r.docNumber ?? '—', '|', r.ht, '/', r.ttc, '|', r.notes ?? '(sync courant)');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
