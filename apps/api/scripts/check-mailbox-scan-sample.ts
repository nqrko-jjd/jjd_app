/**
 * Rapport en LECTURE SEULE : échantillon des dépenses créées par le scan rétroactif de la
 * boîte mail (source 'email', notes commençant par "Retrouvée dans le dossier mail") dont
 * l'extraction n'a rien trouvé (ht=0 et ttc=null) — sert à diagnostiquer pourquoi avant de
 * décider quoi en faire.
 *
 *   npm run report:mailbox-scan-sample
 */
import { prisma } from '../src/db.js';

async function main() {
  const total = await prisma.ledgerEntry.count({ where: { source: 'email', notes: { startsWith: 'Retrouvée dans le dossier mail' } } });
  const incomplete = await prisma.ledgerEntry.count({
    where: { source: 'email', notes: { startsWith: 'Retrouvée dans le dossier mail' }, ht: 0, ttc: null },
  });
  console.log(`Total scan rétroactif : ${total}, extraction incomplète (ht=0, ttc=null) : ${incomplete}`);

  const byFolder = await prisma.ledgerEntry.groupBy({
    by: ['notes'],
    where: { source: 'email', notes: { startsWith: 'Retrouvée dans le dossier mail' }, ht: 0, ttc: null },
    _count: true,
    orderBy: { _count: { notes: 'desc' } },
  });
  console.log('\nPar dossier (incomplètes) :');
  for (const b of byFolder) console.log(' ', b._count, b.notes);

  const sample = await prisma.ledgerEntry.findMany({
    where: { source: 'email', notes: { startsWith: 'Retrouvée dans le dossier mail' }, ht: 0, ttc: null },
    select: { pdfPath: true, docNumber: true, supplierName: true, notes: true, date: true },
    take: 15,
  });
  console.log('\nÉchantillon :');
  for (const s of sample) console.log(' ', JSON.stringify(s));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
