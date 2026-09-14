/**
 * Supprime UN contact, mais seulement s'il est vraiment orphelin (aucune référence dans
 * les mêmes tables que le garde-fou de DELETE /api/contacts/:id) — refuse sinon, comme la
 * route. Sert au nettoyage ponctuel de fiches fantômes repérées par check-acp-namesim.ts.
 *
 *   npm run delete:orphan-contact -- <contactId>
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const id = process.argv[2];
if (!id) throw new Error('Usage : npm run delete:orphan-contact -- <contactId>');

async function main() {
  const contact = await prisma.contact.findUnique({ where: { id } });
  if (!contact) throw new Error(`Contact ${id} introuvable`);

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
  const refs = worksitesClient + worksitesAcp + oppsContact + oppsAcp + documents + ledger + buildingContacts + buildingUnits + linkedContacts + residentUsers;
  if (refs > 0) {
    throw new Error(`Refusé : « ${contact.name} » (${id}) a encore ${refs} référence(s) — pas orphelin.`);
  }

  await prisma.user.deleteMany({ where: { contactId: id } });
  await prisma.contact.delete({ where: { id } });
  console.log(`Supprimé : « ${contact.name} » (${id}) — était bien orphelin (0 référence).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
