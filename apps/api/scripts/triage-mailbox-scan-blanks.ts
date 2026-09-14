/**
 * Rapport en LECTURE SEULE : parmi les dépenses "extraction incomplète" du scan rétroactif
 * (ht=0, ttc=null), combien ont au moins un fournisseur reconnu (triable/utile tel quel) vs.
 * complètement vides (juste un PDF + une date).
 *
 *   npm run report:mailbox-scan-triage
 */
import { prisma } from '../src/db.js';

async function main() {
  const base = { source: 'email', notes: { startsWith: 'Retrouvée dans le dossier mail' }, ht: 0, ttc: null } as const;
  const totallyBlank = await prisma.ledgerEntry.count({ where: { ...base, docNumber: null, supplierName: null } });
  const hasSupplierOnly = await prisma.ledgerEntry.count({ where: { ...base, docNumber: null, supplierName: { not: null } } });
  const hasDocOnly = await prisma.ledgerEntry.count({ where: { ...base, docNumber: { not: null }, supplierName: null } });
  const hasBoth = await prisma.ledgerEntry.count({ where: { ...base, docNumber: { not: null }, supplierName: { not: null } } });
  console.log({ totallyBlank, hasSupplierOnly, hasDocOnly, hasBoth });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
