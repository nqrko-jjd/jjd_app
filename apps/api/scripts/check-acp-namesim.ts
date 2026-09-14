/**
 * Rapport en LECTURE SEULE : cherche des doublons potentiels parmi les Contact de kind
 * acp/developer par similarité de nom — utile maintenant que la fusion Contact/Immeuble
 * a supprimé le regroupement par Building (qui ne détectait que les doublons déjà liés
 * au même immeuble). Signale aussi tout contact acp/developer au nom qui ressemble à un
 * nom de personne plutôt qu'à une ACP (kind potentiellement mal posé).
 *
 *   npm run report:acp-namesim
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function normalize(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\bc\/o\b.*$/, '')
    .replace(/[()\-–.,'"]/g, ' ')
    .replace(/\b(acp|vme|residence|res|parking|syndic)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s: string): Set<string> {
  return new Set(normalize(s).split(' ').filter((t) => t.length > 2));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

async function main() {
  const contacts = await prisma.contact.findMany({
    where: { kind: { in: ['acp', 'developer'] } },
    select: { id: true, name: true, syndic: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });
  console.log(`${contacts.length} contacts acp/developer en base.\n`);

  console.log('== Paires au nom proche (candidats doublons non détectés par la fusion) ==');
  let pairs = 0;
  for (let i = 0; i < contacts.length; i++) {
    for (let j = i + 1; j < contacts.length; j++) {
      const a = contacts[i]!;
      const b = contacts[j]!;
      const sim = jaccard(tokens(a.name), tokens(b.name));
      if (sim >= 0.5) {
        pairs++;
        console.log(`  [${sim.toFixed(2)}] "${a.name}" (${a.id}) <-> "${b.name}" (${b.id})`);
      }
    }
  }
  console.log(`${pairs} paire(s) trouvée(s).\n`);

  console.log('== Contacts acp/developer au nom qui ressemble à un nom de personne ==');
  const personLike = contacts.filter((c) => /^[A-ZÀ-Ý][a-zà-ÿ]+\s+[A-ZÀ-Ý][a-zà-ÿ]+/.test(c.name) && !/\bacp\b|\bvme\b/i.test(c.name.split(/\s+/).slice(0, 2).join(' ')));
  for (const c of personLike) console.log(`  ${c.name} (${c.id})`);
  console.log(`${personLike.length} trouvé(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
