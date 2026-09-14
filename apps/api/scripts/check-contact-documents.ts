/**
 * Rapport en LECTURE SEULE : liste les documents (devis/factures) liés à un contact —
 * sert à examiner un document trouvé par check-contact-refs.ts avant de décider quoi en
 * faire (réassigner, laisser tel quel, etc.).
 *
 *   npm run report:contact-documents -- <contactId>
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const id = process.argv[2];
if (!id) throw new Error('Usage : npm run report:contact-documents -- <contactId>');

async function main() {
  const docs = await prisma.document.findMany({
    where: { contactId: id },
    include: { worksite: { select: { ref: true, title: true } } },
  });
  console.log(JSON.stringify(docs, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
