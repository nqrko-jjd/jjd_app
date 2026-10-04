/**
 * Détache les rapprochements posés à tort sur des mouvements internes (virements entre comptes JJD, chargements/déchargements
 * de cartes, relevés VISA — voir isInternalMovement). Sauvegarde JSON avant d'écrire. Sans --apply : simulation.
 */
import { writeFileSync } from 'node:fs';
import { prisma } from '../src/db.js';
import { isInternalMovement, recomputeDocumentPayment } from '../src/lib/bank-match.js';

const APPLY = process.argv.includes('--apply');
const BACKUP = '/tmp/rapprochements-internes-detaches.json';

async function run() {
  const ms = await prisma.bankTransactionMatch.findMany({
    include: {
      bankTransaction: { select: { id: true, bookingDate: true, amount: true, description: true, counterpartyAccount: true } },
      ledgerEntry: { select: { id: true, docNumber: true, supplierName: true, documentId: true, paymentStatus: true } },
      document: { select: { id: true, number: true } },
    },
  });
  const bad = ms.filter((m) => isInternalMovement(m.bankTransaction));
  console.log(APPLY ? 'MODE APPLY' : 'SIMULATION', '| rapprochements au total:', ms.length, '| à détacher (mouvements internes):', bad.length);
  for (const m of bad.slice(0, 40)) console.log(m.bankTransaction.bookingDate?.toISOString().slice(0, 10), m.bankTransaction.amount, '→', m.document?.number ?? m.ledgerEntry?.docNumber ?? '(sans n°)', m.ledgerEntry?.supplierName ?? '', '|', (m.bankTransaction.description ?? '').replace(/\s+/g, ' ').slice(0, 55));
  if (!APPLY || !bad.length) { await prisma.$disconnect(); return; }

  writeFileSync(BACKUP, JSON.stringify({ exportedAt: new Date(), matches: bad }, null, 1));
  const docIds = new Set<string>();
  for (const m of bad) { if (m.document?.id) docIds.add(m.document.id); if (m.ledgerEntry?.documentId) docIds.add(m.ledgerEntry.documentId); }
  const del = await prisma.bankTransactionMatch.deleteMany({ where: { id: { in: bad.map((m) => m.id) } } });
  for (const t of new Set(bad.map((m) => m.bankTransaction.id))) {
    if (!(await prisma.bankTransactionMatch.count({ where: { bankTransactionId: t } }))) await prisma.bankTransaction.update({ where: { id: t }, data: { matchConfidence: null, matchedAt: null } });
  }
  let recomputed = 0;
  for (const id of docIds) {
    const remaining = await prisma.bankTransactionMatch.count({ where: { OR: [{ documentId: id }, { ledgerEntry: { documentId: id } }] } });
    if (remaining > 0) { await recomputeDocumentPayment(id); recomputed++; }
  }
  console.log('Rapprochements détachés:', del.count, '| factures de vente recalculées:', recomputed);
  await prisma.$disconnect();
}
run().catch((e) => { console.error(e); process.exit(1); });
