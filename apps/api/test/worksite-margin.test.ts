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

test('worksiteMargin : sans facture "Rémunération", la main-d\'œuvre = estimation par pointage, garantie 10 h comprise', async () => {
  const m = await worksiteMargin(worksiteId);
  assert.ok(m);
  // 8 h pointées, seul chantier du jour : les 2 h de garantie (10 h × 30 €) sont imputées à ce chantier → 300 €
  assert.equal(m!.labourCost, 300);
  assert.equal(m!.labour[0]!.hours, 10);
  assert.equal(m!.materialCost, 0);
});

test('worksiteMargin : garantie sur une journée multi-chantiers, répartie au prorata des heures', async () => {
  const other = await prisma.worksite.create({ data: { ref: 'R-WM-TEST2', title: 'Autre chantier', source: 'test' } });
  try {
    // même jour : 8 h ici + 2 h ailleurs = 10 h → pas de complément
    await prisma.timeEntry.create({ data: { personId, worksiteId: other.id, date: new Date('2026-03-02'), hours: 2, amount: 60, rateUsed: 30, status: 'approved', source: 'test' } });
    let m = await worksiteMargin(worksiteId);
    assert.equal(m!.labourCost, 240, '10 h déjà pointées sur la journée : rien à ajouter');
    // 1 h ailleurs : 8 + 1 = 9 h → 1 h de complément, ici 8/9 de cette heure
    await prisma.timeEntry.updateMany({ where: { worksiteId: other.id }, data: { hours: 1, amount: 30 } });
    m = await worksiteMargin(worksiteId);
    assert.equal(m!.labour[0]!.hours, 8.89);
    assert.equal(m!.labourCost, 266.67);
  } finally {
    await prisma.timeEntry.deleteMany({ where: { worksiteId: other.id } });
    await prisma.worksite.deleteMany({ where: { id: other.id } });
  }
});

test('worksiteMargin : détail main-d\'œuvre — un jour/ouvrier, plusieurs pointages le même jour cumulés', async () => {
  // 2e pointage le même jour, même ouvrier -> une seule ligne, heures/montant cumulés
  await prisma.timeEntry.create({
    data: {
      personId, worksiteId, date: new Date('2026-03-02'), hours: 2, amount: 60, rateUsed: 30,
      status: 'submitted', source: 'test',
    },
  });
  const m = await worksiteMargin(worksiteId);
  assert.ok(m);
  assert.equal(m!.labour.length, 1, 'les deux pointages du même jour/ouvrier sont fusionnés en une ligne');
  assert.equal(m!.labour[0]!.hours, 10);
  assert.equal(m!.labour[0]!.amount, 300);
  assert.equal(m!.labour[0]!.personId, personId);
  assert.equal(m!.labour[0]!.pending, true, 'un pointage encore "submitted" -> ligne signalée à valider');
  await prisma.timeEntry.deleteMany({ where: { worksiteId, status: 'submitted' } });
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

test('worksiteMargin : une facture "Non Payé" ne doit pas compter comme payée ("Non Payé" contient "Payé")', async () => {
  await prisma.ledgerEntry.create({
    data: {
      direction: 'sale', worksiteId, ht: 55000, paymentStatus: 'Non Payé',
      date: new Date('2026-03-10'), source: 'test',
    },
  });
  const m = await worksiteMargin(worksiteId);
  assert.ok(m);
  assert.equal(m!.paidHt, 0, '"Non Payé" ne doit pas être compté dans le CA encaissé');
  assert.equal(m!.invoicedHt, 55000, 'mais reste bien compté dans le CA facturé');
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

test('worksiteMargin : "Crédit auto" est un financement, pas une dépense — exclu du coût matériaux', async () => {
  const before = (await worksiteMargin(worksiteId))!.materialCost;
  await prisma.ledgerEntry.create({
    data: {
      direction: 'purchase', worksiteId, ht: 38000, categoryRaw: 'Crédit auto', supplierName: 'BMW Financial services',
      date: new Date('2026-03-11'), source: 'test',
    },
  });
  const m = await worksiteMargin(worksiteId);
  assert.ok(m);
  assert.equal(m!.materialCost, before, 'le crédit/leasing auto ne doit pas gonfler le coût matériaux');
});

test('worksiteMargin : une facture « payée partiellement » compte au prorata dans le CA encaissé (un mouvement d’argent existe)', async () => {
  const before = (await worksiteMargin(worksiteId))!;
  const doc = await prisma.document.create({
    data: { kind: 'invoice', direction: 'sale', number: 'F-PARTIAL-T', status: 'partial', worksiteId, totalHt: 1000, totalVat: 60, totalTtc: 1060, paidAmount: 530, source: 'test', issuedOn: new Date('2026-04-01'), lockedAt: new Date('2026-04-01') },
  });
  await prisma.ledgerEntry.create({
    data: { direction: 'sale', worksiteId, ht: 1000, ttc: 1060, paymentStatus: 'Non payé', documentId: doc.id, docNumber: 'F-PARTIAL-T', date: new Date('2026-04-01'), source: 'test' },
  });
  const m = (await worksiteMargin(worksiteId))!;
  assert.equal(Math.round((m.invoicedHt - before.invoicedHt) * 100) / 100, 1000, 'facturée en entier');
  assert.equal(Math.round((m.paidHt - before.paidHt) * 100) / 100, 500, 'encaissée pour la moitié (530 € sur 1 060 € TTC)');
  await prisma.ledgerEntry.deleteMany({ where: { documentId: doc.id } });
  await prisma.document.delete({ where: { id: doc.id } });
});
