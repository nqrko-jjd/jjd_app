/**
 * Fusionne un contact en doublon dans un contact canonique : réassigne toutes ses
 * références (chantiers, immeuble, opportunités, devis/factures, achats, contacts clés)
 * puis supprime le doublon vidé. Généralise le geste déjà fait à la main pour
 * Poincoin/Poincon — réutilisable pour n'importe quelle paire de doublons repérée par
 * `report-acp-duplicates.ts`.
 *
 *   npm run merge:duplicate-contact -- <canonicalId> <duplicateId>
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const [canonicalId, duplicateId] = process.argv.slice(2);
  if (!canonicalId || !duplicateId) {
    console.error('Usage: tsx scripts/merge-duplicate-contact.ts <canonicalId> <duplicateId>');
    process.exit(1);
  }

  const [canonical, duplicate] = await Promise.all([
    prisma.contact.findUnique({ where: { id: canonicalId } }),
    prisma.contact.findUnique({ where: { id: duplicateId } }),
  ]);
  if (!canonical) throw new Error(`Contact canonique introuvable : ${canonicalId}`);
  if (!duplicate) throw new Error(`Contact doublon introuvable : ${duplicateId}`);
  console.log(`Fusion de « ${duplicate.name} » (${duplicateId}) -> « ${canonical.name} » (${canonicalId})`);

  // Le doublon pointe peut-être sur un immeuble différent (rare) — si le canonique n'a pas
  // encore d'immeuble lié, on récupère celui du doublon plutôt que de le perdre.
  if (duplicate.buildingId && !canonical.buildingId) {
    await prisma.contact.update({ where: { id: canonicalId }, data: { buildingId: duplicate.buildingId } });
    console.log('  immeuble lié du doublon repris (le canonique n\'en avait pas)');
  }

  const [ws, opp, doc, ledger, bc, bu] = await Promise.all([
    prisma.worksite.updateMany({ where: { clientId: duplicateId }, data: { clientId: canonicalId } }),
    prisma.crmOpportunity.updateMany({ where: { contactId: duplicateId }, data: { contactId: canonicalId } }),
    prisma.document.updateMany({ where: { contactId: duplicateId }, data: { contactId: canonicalId } }),
    prisma.ledgerEntry.updateMany({ where: { contactId: duplicateId }, data: { contactId: canonicalId } }),
    prisma.buildingContact.updateMany({ where: { contactId: duplicateId }, data: { contactId: canonicalId } }),
    prisma.buildingUnit.updateMany({ where: { contactId: duplicateId }, data: { contactId: canonicalId } }),
  ]);
  console.log('  réassignés :', { worksites: ws.count, opportunities: opp.count, documents: doc.count, ledgerEntries: ledger.count, buildingContacts: bc.count, buildingUnits: bu.count });

  // Building.clientId pointant sur le doublon (le doublon était "le client" d'un immeuble)
  const buildingsClientOfDup = await prisma.building.updateMany({ where: { clientId: duplicateId }, data: { clientId: canonicalId } });
  if (buildingsClientOfDup.count) console.log(`  ${buildingsClientOfDup.count} immeuble(s) dont clientId pointait sur le doublon, repointé(s)`);

  await prisma.contact.delete({ where: { id: duplicateId } });
  console.log('  doublon supprimé.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
