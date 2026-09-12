/**
 * Rattrapage ponctuel : l'import TrustUp d'origine créait déjà un Building pour chaque
 * contact ACP avec syndic détecté (`Building.clientId` -> le contact), mais ne posait
 * jamais le lien inverse (`Contact.buildingId`) — donc les fiches contact ne montraient
 * aucun immeuble lié, alors que le bâtiment existe bel et bien. Ce script relie chaque
 * contact à son immeuble déjà existant, sans en créer aucun nouveau.
 *
 *   npm run backfill:contact-building
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const buildings = await prisma.building.findMany({
    where: { clientId: { not: null } },
    select: { id: true, name: true, clientId: true },
  });

  let fixed = 0;
  let alreadyLinked = 0;
  let skippedOther = 0;
  for (const b of buildings) {
    const contact = await prisma.contact.findUnique({ where: { id: b.clientId! }, select: { id: true, name: true, buildingId: true } });
    if (!contact) continue;
    if (contact.buildingId === b.id) { alreadyLinked++; continue; }
    if (contact.buildingId) { skippedOther++; continue; } // déjà lié à un autre immeuble, ne pas écraser
    await prisma.contact.update({ where: { id: contact.id }, data: { buildingId: b.id } });
    console.log(`  ${contact.name} -> ${b.name}`);
    fixed++;
  }

  console.log(`\n${fixed} contact(s) relié(s) à leur immeuble existant (${alreadyLinked} déjà en ordre, ${skippedOther} déjà liés ailleurs, non touchés).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
