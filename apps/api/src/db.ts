import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

/** Incrément atomique d'un compteur nommé (numéros R- / D- / F-). */
export async function nextCounter(name: string, start = 0): Promise<number> {
  const row = await prisma.counter.upsert({
    where: { name },
    create: { name, value: start + 1 },
    update: { value: { increment: 1 } },
  });
  return row.value;
}

/** Prochain numéro de chantier : « R-781 ». */
export async function nextWorksiteRef(): Promise<string> {
  const n = await nextCounter('worksite');
  return `R-${n}`;
}
