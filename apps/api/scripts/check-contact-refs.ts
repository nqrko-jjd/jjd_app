/**
 * Rapport en LECTURE SEULE : compte toutes les références d'un contact (mêmes tables que
 * la garde-fou DELETE /api/contacts/:id) — utile pour vérifier avant suppression manuelle
 * qu'un contact repéré comme douteux (ex. check-acp-namesim.ts) est bien orphelin.
 *
 *   npm run report:contact-refs -- <contactId>
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const id = process.argv[2];
if (!id) throw new Error('Usage : npm run report:contact-refs -- <contactId>');

async function main() {
  const contact = await prisma.contact.findUnique({ where: { id } });
  if (!contact) throw new Error(`Contact ${id} introuvable`);
  console.log(JSON.stringify(contact, null, 2));

  const [worksitesClient, worksitesAcp, oppsContact, oppsAcp, documents, ledger, buildingContacts, buildingUnits, linkedContacts, residentUsers] = await Promise.all([
    prisma.worksite.count({ where: { clientId: id } }),
    prisma.worksite.count({ where: { acpId: id } }),
    prisma.crmOpportunity.count({ where: { contactId: id } }),
    prisma.crmOpportunity.count({ where: { acpId: id } }),
    prisma.document.count({ where: { contactId: id } }),
    prisma.ledgerEntry.count({ where: { contactId: id } }),
    prisma.buildingContact.count({ where: { acpId: id } }),
    prisma.buildingUnit.count({ where: { acpId: id } }),
    prisma.contact.count({ where: { linkedAcpId: id } }),
    prisma.user.count({ where: { residentOfId: id } }),
  ]);
  console.log('\nRéférences :', {
    worksitesClient, worksitesAcp, oppsContact, oppsAcp, documents, ledger,
    buildingContacts, buildingUnits, linkedContacts, residentUsers,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
