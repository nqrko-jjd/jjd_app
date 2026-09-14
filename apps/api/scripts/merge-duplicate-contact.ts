/**
 * Fusionne un contact en doublon dans un contact canonique : réassigne toutes ses
 * références (chantiers, immeuble/ACP lié, résidents, opportunités, devis/factures,
 * achats, contacts clés, lots) puis supprime le doublon vidé. Généralise le geste déjà
 * fait à la main pour Poincoin/Poincon, Oregon et Algarve.
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

  // Le doublon pointe peut-être sur une ACP différente (rare) — si le canonique n'a pas
  // encore d'ACP liée, on récupère celle du doublon plutôt que de la perdre.
  if (duplicate.linkedAcpId && !canonical.linkedAcpId) {
    await prisma.contact.update({ where: { id: canonicalId }, data: { linkedAcpId: duplicate.linkedAcpId } });
    console.log('  ACP liée du doublon reprise (le canonique n\'en avait pas)');
  }

  const [ws, acpWs, opp, acpOpp, doc, ledger, bc, bu, residents, users] = await Promise.all([
    prisma.worksite.updateMany({ where: { clientId: duplicateId }, data: { clientId: canonicalId } }),
    prisma.worksite.updateMany({ where: { acpId: duplicateId }, data: { acpId: canonicalId } }),
    prisma.crmOpportunity.updateMany({ where: { contactId: duplicateId }, data: { contactId: canonicalId } }),
    prisma.crmOpportunity.updateMany({ where: { acpId: duplicateId }, data: { acpId: canonicalId } }),
    prisma.document.updateMany({ where: { contactId: duplicateId }, data: { contactId: canonicalId } }),
    prisma.ledgerEntry.updateMany({ where: { contactId: duplicateId }, data: { contactId: canonicalId } }),
    prisma.buildingContact.updateMany({ where: { acpId: duplicateId }, data: { acpId: canonicalId } }),
    prisma.buildingUnit.updateMany({ where: { acpId: duplicateId }, data: { acpId: canonicalId } }),
    prisma.contact.updateMany({ where: { linkedAcpId: duplicateId }, data: { linkedAcpId: canonicalId } }),
    prisma.user.updateMany({ where: { residentOfId: duplicateId }, data: { residentOfId: canonicalId } }),
  ]);
  console.log('  réassignés :', {
    worksites: ws.count, worksitesAcp: acpWs.count, opportunities: opp.count, opportunitiesAcp: acpOpp.count,
    documents: doc.count, ledgerEntries: ledger.count, buildingContacts: bc.count, buildingUnits: bu.count,
    residents: residents.count, portalUsers: users.count,
  });

  await prisma.contact.delete({ where: { id: duplicateId } });
  console.log('  doublon supprimé.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
