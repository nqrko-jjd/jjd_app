/**
 * Corrige l'asymétrie qui rendait certains membres du bureau (ex. Melvina) invisibles dans
 * les sélecteurs d'assignation de tâches : ces sélecteurs listent les `Person` actives
 * (l'équipe, comme pour le planning), mais un compte `User` bureau créé sans passer par
 * une fiche Équipe n'a pas de `Person` liée (`User.personId` null). Idempotent — ne touche
 * pas les comptes qui ont déjà une `Person` (ouvriers/chefs importés, David/Julien…), ni les
 * comptes portail client.
 *
 *   npm run backfill:office-person
 */
import { PrismaClient } from '@prisma/client';
import { normalizeName } from '@jjd/shared';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    where: { personId: null, role: { in: ['admin', 'office', 'foreman', 'worker'] } },
  });

  let created = 0;
  for (const u of users) {
    const name = u.email.split('@')[0]!.replace(/[._-]+/g, ' ').trim();
    const displayName = name.charAt(0).toUpperCase() + name.slice(1);
    const person = await prisma.person.create({
      data: {
        firstName: displayName,
        displayName,
        normalizedName: normalizeName(displayName),
        role: u.role === 'admin' ? 'foreman' : u.role === 'office' ? 'office' : (u.role as 'foreman' | 'worker'),
        active: true,
        source: 'manual',
      },
    });
    await prisma.user.update({ where: { id: u.id }, data: { personId: person.id } });
    console.log(`  Person créée pour ${u.email} -> ${displayName} (${person.id})`);
    created++;
  }
  console.log(`\n${created} compte(s) bureau relié(s) à une nouvelle fiche Équipe.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
