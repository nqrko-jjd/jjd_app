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

/**
 * Prochain numéro de chantier : « R-857 ». Le compteur est recalé au-dessus du
 * plus grand numéro R- déjà présent (import inclus), puis on saute tout numéro
 * déjà pris par sécurité.
 */
export async function nextWorksiteRef(): Promise<string> {
  const existing = await prisma.counter.findUnique({ where: { name: 'worksite' } });
  const rows = await prisma.worksite.findMany({
    where: { ref: { startsWith: 'R-' } },
    select: { ref: true },
  });
  let max = existing?.value ?? 0;
  for (const r of rows) {
    const m = r.ref.match(/^R-0*(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  if (!existing || existing.value < max) {
    await prisma.counter.upsert({
      where: { name: 'worksite' },
      create: { name: 'worksite', value: max },
      update: { value: max },
    });
  }
  const taken = new Set(rows.map((r) => r.ref));
  for (let i = 0; i < 100; i++) {
    const n = await nextCounter('worksite');
    if (!taken.has(`R-${n}`)) return `R-${n}`;
  }
  throw new Error('Impossible d’attribuer un numéro de chantier');
}
