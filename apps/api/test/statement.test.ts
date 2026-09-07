import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/db.js';
import { monthlyStatement } from '../src/lib/statement.js';

let personId = '';
let worksiteId = '';

before(async () => {
  const p = await prisma.person.create({
    data: { firstName: 'Test', lastName: 'JourGaranti', normalizedName: 'test jourgaranti', hourlyRate: 20, dailyHours: 10, source: 'test' },
  });
  personId = p.id;
  const ws = await prisma.worksite.create({ data: { ref: 'R-JG-TEST', title: 'Jour garanti — test', source: 'test' } });
  worksiteId = ws.id;
});

after(async () => {
  await prisma.timeEntry.deleteMany({ where: { personId } });
  await prisma.worksite.deleteMany({ where: { id: worksiteId } });
  await prisma.person.deleteMany({ where: { id: personId } });
});

test('monthlyStatement : un pointage app de 3h est payé pour une journée complète (10h)', async () => {
  await prisma.timeEntry.create({
    data: {
      personId, worksiteId, date: new Date('2026-04-06'), hours: 3, amount: 60, rateUsed: 20,
      status: 'approved', source: 'timer',
    },
  });
  const s = await monthlyStatement(personId, 2026, 4);
  assert.equal(s.totalHours, 10);
  assert.equal(s.totalAmount, 200);
  assert.equal(s.guaranteeApplied, true);
});

test("monthlyStatement : au-delà de la garantie, le montant réel prime (pas de plafond)", async () => {
  await prisma.timeEntry.deleteMany({ where: { personId } });
  await prisma.timeEntry.create({
    data: {
      personId, worksiteId, date: new Date('2026-04-07'), hours: 12, amount: 240, rateUsed: 20,
      status: 'approved', source: 'timer',
    },
  });
  const s = await monthlyStatement(personId, 2026, 4);
  assert.equal(s.totalHours, 12);
  assert.equal(s.totalAmount, 240);
  assert.equal(s.guaranteeApplied, false);
});

test("monthlyStatement : les pointages importés de l'Excel ne sont pas replanchés", async () => {
  await prisma.timeEntry.deleteMany({ where: { personId } });
  await prisma.timeEntry.create({
    data: {
      personId, worksiteId, date: new Date('2026-04-08'), hours: 3, amount: 60, rateUsed: 20,
      status: 'approved', source: 'xlsx',
    },
  });
  const s = await monthlyStatement(personId, 2026, 4);
  assert.equal(s.totalHours, 3);
  assert.equal(s.totalAmount, 60);
  assert.equal(s.guaranteeApplied, false);
});
