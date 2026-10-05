import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/db.js';
import { mergeContacts, contactReferences } from '../src/lib/contact-merge.js';
import { normalizeName } from '@jjd/shared';

const made: string[] = [];
const mk = async (name: string, extra: Record<string, unknown> = {}) => {
  const c = await prisma.contact.create({ data: { name, normalizedName: normalizeName(name), type: 'client', ...extra } });
  made.push(c.id);
  return c;
};
after(async () => {
  await prisma.document.deleteMany({ where: { contactId: { in: made } } });
  await prisma.ledgerEntry.deleteMany({ where: { contactId: { in: made } } });
  await prisma.contact.deleteMany({ where: { id: { in: made } } });
});

test('les références vers Contact sont découvertes dans le schéma (devis, grand livre, chantiers…)', () => {
  const refs = contactReferences().map((r) => `${r.model}.${r.field}`);
  for (const k of ['Document.contactId', 'LedgerEntry.contactId', 'Worksite.clientId', 'PurchaseOrder.contactId', 'User.contactId']) assert.ok(refs.includes(k), k);
});

test('fusion : tout est rattaché à la fiche conservée, champs complétés, type « both », doublons supprimés', async () => {
  const keep = await mk('BV SX TEST', { vat: null });
  const a = await mk('SX TEST', { type: 'supplier', vat: 'BE0847775446', email: 'sx@example.be' });
  const b = await mk('SPRL SX TEST');
  await prisma.ledgerEntry.create({ data: { direction: 'purchase', ht: 100, ttc: 100, supplierName: 'SX TEST', contactId: a.id, source: 'test' } });
  await prisma.ledgerEntry.create({ data: { direction: 'sale', ht: 50, ttc: 50, supplierName: 'SPRL SX TEST', contactId: b.id, source: 'test' } });
  await prisma.document.create({ data: { kind: 'invoice', direction: 'sale', status: 'draft', draftRef: 'BROUILLON-TEST-MERGE', contactId: b.id, source: 'test' } });

  const r = await mergeContacts(keep.id, [a.id, b.id], { name: 'SX SRL TEST' });
  assert.equal(r.removed, 2);
  assert.equal(await prisma.contact.count({ where: { id: { in: [a.id, b.id] } } }), 0);
  const k = await prisma.contact.findUniqueOrThrow({ where: { id: keep.id } });
  assert.equal(k.name, 'SX SRL TEST');
  assert.equal(k.vat, 'BE0847775446');
  assert.equal(k.email, 'sx@example.be');
  assert.equal(k.type, 'both');
  const led = await prisma.ledgerEntry.findMany({ where: { contactId: keep.id } });
  assert.equal(led.length, 2);
  assert.ok(led.every((l) => l.supplierName === 'SX SRL TEST'));
  assert.equal(await prisma.document.count({ where: { contactId: keep.id } }), 1);
  await prisma.document.deleteMany({ where: { draftRef: 'BROUILLON-TEST-MERGE' } });
});

test('fusion : refuse sans doublon à fusionner ou avec une fiche inconnue', async () => {
  const keep = await mk('Seul TEST');
  await assert.rejects(() => mergeContacts(keep.id, [keep.id]));
  await assert.rejects(() => mergeContacts(keep.id, ['inconnu']));
});
