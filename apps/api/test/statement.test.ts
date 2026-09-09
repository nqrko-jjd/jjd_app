import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/db.js';
import { monthlyStatement, personEarningsBreakdown } from '../src/lib/statement.js';

let personId = '';
let worksiteId = '';
let worksiteBId = '';

before(async () => {
  const p = await prisma.person.create({
    data: { firstName: 'Test', lastName: 'JourGaranti', normalizedName: 'test jourgaranti', hourlyRate: 20, dailyHours: 10, source: 'test' },
  });
  personId = p.id;
  const ws = await prisma.worksite.create({ data: { ref: 'R-JG-TEST', title: 'Jour garanti — test', source: 'test' } });
  worksiteId = ws.id;
  const wsB = await prisma.worksite.create({ data: { ref: 'R-JG-TEST-B', title: 'Jour garanti — test B', source: 'test' } });
  worksiteBId = wsB.id;
});

after(async () => {
  await prisma.timeEntry.deleteMany({ where: { personId } });
  await prisma.worksite.deleteMany({ where: { id: { in: [worksiteId, worksiteBId] } } });
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

test('personEarningsBreakdown : total, par année et par chantier, garantie répartie quand un seul chantier ce jour-là', async () => {
  await prisma.timeEntry.deleteMany({ where: { personId } });
  await prisma.timeEntry.createMany({
    data: [
      // journée courte, un seul chantier -> la garantie (10h) est attribuable à ce chantier
      { personId, worksiteId, date: new Date('2025-06-01'), hours: 3, amount: 60, rateUsed: 20, status: 'approved', source: 'test' },
      { personId, worksiteId, date: new Date('2025-06-10'), hours: 10, amount: 200, rateUsed: 20, status: 'approved', source: 'test' },
      // journée courte partagée entre 2 chantiers -> la garantie n'est attribuable à aucun des deux
      { personId, worksiteId, date: new Date('2026-02-01'), hours: 2, amount: 40, rateUsed: 20, status: 'approved', source: 'test' },
      { personId, worksiteId: worksiteBId, date: new Date('2026-02-01'), hours: 1, amount: 20, rateUsed: 20, status: 'approved', source: 'test' },
    ],
  });

  const b = await personEarningsBreakdown(personId);

  assert.equal(b.total.hours, 30); // 16 pointées + 14 de garantie (7 le 01/06/25 + 7 le 01/02/26)
  assert.equal(b.total.amount, 600);
  assert.equal(b.total.years, 2);
  assert.equal(b.total.worksites, 2);

  assert.deepEqual(b.byYear.map((y) => y.year), [2026, 2025]); // le plus récent en premier
  const y2025 = b.byYear.find((y) => y.year === 2025)!;
  const y2026 = b.byYear.find((y) => y.year === 2026)!;
  assert.equal(y2025.amount, 400); // 260 pointés + 140 de garantie
  assert.equal(y2026.amount, 200); // 60 pointés + 140 de garantie
  assert.equal(y2025.amount + y2026.amount, b.total.amount, 'les années couvrent tout le total');

  const wsA = b.byWorksite.find((w) => w.id === worksiteId)!;
  const wsB = b.byWorksite.find((w) => w.id === worksiteBId)!;
  assert.equal(wsA.amount, 440); // 300 pointés + 140 de garantie (journée à un seul chantier)
  assert.equal(wsB.amount, 20); // rien : la garantie du 01/02/26 n'est attribuable à aucun chantier seul
  assert.ok(
    wsA.amount + wsB.amount < b.total.amount,
    'la garantie d’une journée partagée entre 2 chantiers reste dans le total sans être imputée à un chantier',
  );
  assert.equal('marginPct' in wsA, true);
  assert.equal('margin' in wsA, true);
});
