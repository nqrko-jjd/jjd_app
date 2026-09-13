/**
 * Corrige les chantiers facturés à un contact ACP/immeuble mais jamais liés à l'immeuble
 * lui-même (`Worksite.buildingId` resté null bien que `Worksite.clientId` pointe vers un
 * contact qui, lui, a un `buildingId`) — même défaut de fond que Building.clientId/
 * Contact.buildingId (déjà corrigé), côté chantier cette fois. Symptôme observé : le
 * chantier apparaît dans l'onglet "Chantiers" de la fiche Contact mais pas dans l'onglet
 * "Interventions" de la fiche Immeuble. Idempotent, additif — ne touche jamais un
 * `buildingId` déjà posé.
 *
 *   npm run backfill:worksite-building
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const candidates = await prisma.worksite.findMany({
    where: { buildingId: null, clientId: { not: null } },
    select: { id: true, ref: true, clientId: true },
  });

  let fixed = 0;
  for (const w of candidates) {
    const contact = await prisma.contact.findUnique({ where: { id: w.clientId! }, select: { buildingId: true } });
    if (!contact?.buildingId) continue;
    await prisma.worksite.update({ where: { id: w.id }, data: { buildingId: contact.buildingId } });
    console.log(`  ${w.ref} -> immeuble ${contact.buildingId}`);
    fixed++;
  }
  console.log(`\n${fixed} chantier(s) relié(s) à l'immeuble de leur client facturé.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
