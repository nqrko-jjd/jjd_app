// Creates only synthetic data, in a dedicated empty database. Never runs the normal seed.
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

if (process.env.JJD_STORE_REVIEW !== '1' ||
    !/\/jjd_review(?:\?|$)/.test(process.env.DATABASE_URL ?? '') ||
    (process.env.REVIEW_PASSWORD ?? '').length < 24) {
  throw new Error('Dedicated review database and strong review password required');
}
const p = new PrismaClient();
try {
  const initialized = await p.setting.findUnique({ where: { key: 'store_review_fixture' } });
  if (!initialized) {
    if (await p.user.count() || await p.worksite.count() || await p.contact.count()) {
      throw new Error('Refusing to seed an existing non-review database');
    }
    await p.$transaction(async tx => {
      const passwordHash = await bcrypt.hash(process.env.REVIEW_PASSWORD, 12);
      const person = await tx.person.create({ data: { firstName: 'Alex', lastName: 'Démo', displayName: 'Alex Démo', normalizedName: 'alex demo', role: 'worker', hourlyRate: 25, source: 'store-review' } });
      const worker = await tx.user.create({ data: { email: 'terrain@example.invalid', passwordHash, role: 'worker', personId: person.id } });
      await tx.user.create({ data: { email: 'gestion@example.invalid', passwordHash, role: 'admin' } });
      const site = await tx.worksite.create({ data: { ref: 'R-DEMO-001', title: 'Rénovation — chantier fictif', city: 'Bruxelles', status: 'in_progress', source: 'store-review' } });
      const general = await tx.thread.create({ data: { kind: 'general' } });
      await tx.message.create({ data: { threadId: general.id, authorId: worker.id, authorName: 'Alex Démo', body: 'Bienvenue dans l’espace de démonstration. Les personnes et chantiers sont fictifs. Vous pouvez essayer les messages et notes vocales.' } });
      const thread = await tx.thread.create({ data: { kind: 'worksite', worksiteId: site.id, participants: { create: { personId: person.id } } } });
      await tx.message.create({ data: { threadId: thread.id, authorId: worker.id, authorName: 'Alex Démo', body: 'Préparation du chantier : protection des sols et rangement du matériel.' } });
      await tx.setting.create({ data: { key: 'store_review_fixture', value: { version: 1, personId: person.id, worksiteId: site.id } } });
    });
  }
  // Keep the review planning useful without deleting reviewer-created data.
  const fixture = (await p.setting.findUnique({ where: { key: 'store_review_fixture' } })).value;
  const start = new Date(); start.setHours(0, 0, 0, 0);
  for (let day = 0; day < 90; day++) {
    const startAt = new Date(start.getTime() + day * 86400000);
    if (!await p.planningEvent.findFirst({ where: { worksiteId: fixture.worksiteId, startAt } })) {
      await p.planningEvent.create({ data: { worksiteId: fixture.worksiteId, startAt, endAt: new Date(startAt.getTime() + 86400000), allDay: true, assignments: { create: { personId: fixture.personId } } } });
    }
  }
  console.log('Synthetic review environment ready (no credentials printed).');
} finally { await p.$disconnect(); }
