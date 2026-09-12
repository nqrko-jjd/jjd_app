/**
 * Étape 2/3 de la migration vers l'assignation multi-personnes des tâches (voir le plan
 * "Tâches" — `WorksiteTask.assigneeId` -> table `TaskAssignment`). Pour chaque tâche ayant
 * encore un `assigneeId` (Person), retrouve le compte `User` lié à ce `Person`
 * (`User.personId`) et crée la ligne `TaskAssignment` correspondante. Une tâche dont le
 * `Person` assigné n'a pas de compte `User` est signalée mais pas bloquante.
 *
 *   npm run backfill:task-assignees
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tasks = await prisma.worksiteTask.findMany({
    where: { assigneeId: { not: null } },
    select: { id: true, title: true, assigneeId: true },
  });

  let linked = 0;
  let noAccount = 0;
  for (const t of tasks) {
    const person = await prisma.person.findUnique({ where: { id: t.assigneeId! }, select: { user: true, firstName: true } });
    const userId = person?.user?.id;
    if (!userId) {
      console.log(`  (pas de compte) ${t.title} — assigné à ${person?.firstName ?? t.assigneeId}`);
      noAccount++;
      continue;
    }
    await prisma.taskAssignment.upsert({
      where: { taskId_userId: { taskId: t.id, userId } },
      create: { taskId: t.id, userId },
      update: {},
    });
    linked++;
  }
  console.log(`\n${linked} tâche(s) reliée(s) à leur assigné (compte utilisateur), ${noAccount} sans compte associé.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
