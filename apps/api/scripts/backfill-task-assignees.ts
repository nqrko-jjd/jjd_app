/**
 * Rattrapage pour l'ancien champ `WorksiteTask.assigneeId` (FK vers `Person`, un seul
 * assigné) — recrée la ligne `TaskAssignment` (multi-assignés, sur `Person`) équivalente
 * pour chaque tâche qui a encore ce champ posé. Idempotent.
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
  for (const t of tasks) {
    await prisma.taskAssignment.upsert({
      where: { taskId_personId: { taskId: t.id, personId: t.assigneeId! } },
      create: { taskId: t.id, personId: t.assigneeId! },
      update: {},
    });
    linked++;
  }
  console.log(`\n${linked} tâche(s) reliée(s) à leur ancien assigné.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
