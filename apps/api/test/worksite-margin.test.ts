import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/db.js';
import { worksiteMargin } from '../src/lib/worksite-margin.js';

let worksiteId = '';
let personId = '';

before(async () => {
  const ws = await prisma.worksite.create({
    data: { ref: 'R-WM-TEST', title: 'Marge chantier — double compte', source: 'test' },
  });
  worksiteId = ws.id;
  const p = await prisma.person.create({
    data: { firstName: 'Test', lastName: 'Ouvrier', normalizedName: 'test ouvrier', hourlyRate: 30, source: 'test' },
  });
  personId = p.id;
  await prisma.timeEntry.create({
    data: {
      personId, worksiteId, date: new Date('2026-03-02'), hours: 8, amount: 240, rateUsed: 30,
      status: 'approved', source: 'test',
    },
  });
});

after(async () => {
  await prisma.timeEntry.deleteMany({ where: { worksiteId } });
  await prisma.ledgerEntry.deleteMany({ where: { worksiteId } });
  await prisma.worksite.deleteMany({ where: { id: worksiteId } });
  await prisma.person.deleteMany({ where: { id: personId } });
});

test('worksiteMargin : sans facture "Rémunération", la main-d\'œuvre = estimation par pointage', async () => {
  const m = await worksiteMargin(worksiteId);
  assert.ok(m);
  assert.equal(m!.labourCost, 240);
  assert.equal(m!.materialCost, 0);
});

test('worksiteMargin : une facture d\'achat "Rémunération - Ouvrier" remplace le pointage, ne s\'additionne pas', async () => {
  await prisma.ledgerEntry.create({
    data: {
      direction: 'purchase', worksiteId, ht: 260, categoryRaw: 'Rémunération - Ouvrier',
      date: new Date('2026-03-05'), source: 'test',
    },
  });
  const m = await worksiteMargin(worksiteId);
  assert.ok(m);
  // 260 (la facture), pas 260 + 240 (double compte de la même main-d'œuvre)
  assert.equal(m!.labourCost, 260);
  assert.equal(m!.materialCost, 0, 'la facture "Rémunération" ne doit pas compter comme du matériel');
});

test('worksiteMargin : un achat de matériel classique reste bien dans materialCost', async () => {
  await prisma.ledgerEntry.create({
    data: {
      direction: 'purchase', worksiteId, ht: 150, categoryRaw: 'Matériel',
      date: new Date('2026-03-06'), source: 'test',
    },
  });
  const m = await worksiteMargin(worksiteId);
  assert.ok(m);
  assert.equal(m!.materialCost, 150);
  assert.equal(m!.labourCost, 260);
});

test('worksiteMargin : "Rémunération - Julien/Tonton/M7" paye une personne distincte des ouvriers pointés, s\'additionne (ne remplace pas)', async () => {
  // Ex. réel du fichier d'origine : SCA Consulting (holding de Julien) facturée sur un chantier
  // en plus des ouvriers JJD pointés sur ce même chantier — les deux coexistent normalement.
  await prisma.ledgerEntry.create({
    data: {
      direction: 'purchase', worksiteId, ht: 8000, categoryRaw: 'Rémunération - Julien',
      supplierName: 'SCA Consulting', date: new Date('2026-03-07'), source: 'test',
    },
  });
  const m = await worksiteMargin(worksiteId);
  assert.ok(m);
  assert.equal(m!.labourCost, 260, 'la main-d\'œuvre pointée des ouvriers ne doit pas être remplacée par la facture de Julien');
  assert.equal(m!.materialCost, 150 + 8000, 'la facture Rémunération - Julien s\'ajoute aux autres achats');
});

test('worksiteMargin : note de crédit vente réduit le CA, note de crédit achat réduit les coûts (pas l\'inverse)', async () => {
  await prisma.ledgerEntry.create({
    data: {
      direction: 'sale', worksiteId, ht: 1000, paymentStatus: 'Payé',
      date: new Date('2026-03-08'), source: 'test',
    },
  });
  await prisma.ledgerEntry.create({
    data: {
      direction: 'credit_note', worksiteId, ht: -100, categoryRaw: 'Note de crédit vente', paymentStatus: 'Payé',
      date: new Date('2026-03-09'), source: 'test',
    },
  });
  await prisma.ledgerEntry.create({
    data: {
      direction: 'credit_note', worksiteId, ht: -30, categoryRaw: 'Note de crédit',
      date: new Date('2026-03-09'), source: 'test',
    },
  });
  const m = await worksiteMargin(worksiteId);
  assert.ok(m);
  assert.equal(m!.paidHt, 1000 - 100, 'la note de crédit vente réduit le CA encaissé');
  assert.equal(m!.materialCost, 150 + 8000 - 30, 'la note de crédit achat réduit le coût matériaux, pas le CA');
});
