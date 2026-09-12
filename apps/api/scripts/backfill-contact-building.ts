/**
 * Rattrapage ponctuel en 2 passes pour les contacts ACP sans immeuble lié :
 *
 * 1. L'import TrustUp d'origine créait déjà un Building pour chaque contact ACP avec
 *    syndic détecté (`Building.clientId` -> le contact), mais ne posait jamais le lien
 *    inverse (`Contact.buildingId`) — donc la fiche contact ne montrait aucun immeuble
 *    lié alors que le bâtiment existe bel et bien. On relie chaque contact à son
 *    immeuble déjà existant.
 * 2. Pour les contacts ACP qui n'ont toujours pas d'immeuble après la passe 1 (l'import
 *    d'origine ne créait un Building que si un syndic était détecté dans le nom via
 *    « c/o X » — sinon rien n'était créé du tout) : crée l'immeuble manquant, avec le
 *    même détecteur de syndic que l'import (dédoublonné par nom normalisé, pour ne
 *    jamais créer un doublon d'un immeuble déjà existant sous un nom voisin).
 *
 *   npm run backfill:contact-building
 */
import { PrismaClient } from '@prisma/client';
import { normalizeName } from '@jjd/shared';

const prisma = new PrismaClient();

/** « ACP Iris (c/o Baltimo) » -> base « ACP Iris », syndic « Baltimo ». */
function splitSyndic(name: string): { base: string; syndic: string | null } {
  const m = name.match(/^(.*?)[\s(–-]*c\/o\s+([^)]+?)\)?\s*$/i);
  if (m) return { base: m[1]!.replace(/[\s(–-]+$/, '').trim(), syndic: m[2]!.trim() };
  return { base: name.trim(), syndic: null };
}

const syndicCache = new Map<string, string>();
async function getSyndic(rawName: string): Promise<string> {
  const nn = normalizeName(rawName);
  if (syndicCache.has(nn)) return syndicCache.get(nn)!;
  let s = await prisma.syndic.findFirst({ where: { normalizedName: nn } });
  if (!s) s = await prisma.syndic.create({ data: { name: rawName.trim(), normalizedName: nn } });
  syndicCache.set(nn, s.id);
  return s.id;
}

async function linkExisting() {
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
    console.log(`  [lien existant] ${contact.name} -> ${b.name}`);
    fixed++;
  }
  console.log(`${fixed} contact(s) relié(s) à un immeuble déjà existant (${alreadyLinked} déjà en ordre, ${skippedOther} déjà liés ailleurs, non touchés).`);
}

async function createMissing() {
  const contacts = await prisma.contact.findMany({
    where: { kind: 'acp', buildingId: null },
    select: { id: true, name: true },
  });

  let created = 0;
  let linkedToExisting = 0;
  for (const c of contacts) {
    const { base, syndic } = splitSyndic(c.name);
    const bn = normalizeName(base || c.name);
    let building = await prisma.building.findFirst({ where: { normalizedName: bn } });
    if (building) {
      linkedToExisting++;
      console.log(`  [existant sous un nom voisin] ${c.name} -> ${building.name}`);
    } else {
      const syndicId = syndic ? await getSyndic(syndic) : null;
      building = await prisma.building.create({
        data: { name: base || c.name, normalizedName: bn, syndicId, clientId: c.id, source: 'backfill' },
      });
      created++;
      console.log(`  [créé] ${c.name} -> ${building.name}${syndic ? ` (syndic : ${syndic})` : ''}`);
    }
    await prisma.contact.update({ where: { id: c.id }, data: { buildingId: building.id } });
  }
  console.log(`${created} immeuble(s) créé(s), ${linkedToExisting} relié(s) à un immeuble déjà existant sous un nom voisin.`);
}

async function main() {
  console.log('Passe 1 — relier les immeubles déjà créés par l\'import :');
  await linkExisting();
  console.log('\nPasse 2 — créer les immeubles manquants pour les ACP restantes :');
  await createMissing();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
