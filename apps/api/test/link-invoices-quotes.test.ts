import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/db.js';
import { quoteBillings } from '../src/lib/quote-billing.js';
import { planInvoiceQuoteLinks, applyInvoiceQuoteLinks } from '../src/lib/link-invoices-quotes.js';

const ids: string[] = []; let ws = ''; let ws2 = '';
after(async () => {
  await prisma.document.deleteMany({ where: { id: { in: ids } } });
  await prisma.worksite.deleteMany({ where: { id: { in: [ws, ws2].filter(Boolean) } } });
});
const doc = async (data: Record<string, unknown>) => { const d = await prisma.document.create({ data: { direction: 'sale', status: 'paid', totalVat: 0, totalTtc: 0, source: 'test-link', ...data } as never }); ids.push(d.id); return d; };

test('rattachement des factures importées aux devis cités dans leur intitulé', async () => {
  ws = (await prisma.worksite.create({ data: { ref: 'R-LINK-1', title: 'Chantier lien', source: 'test' } })).id;
  ws2 = (await prisma.worksite.create({ data: { ref: 'R-LINK-2', title: 'Autre chantier', source: 'test' } })).id;
  const q = await doc({ kind: 'quote', number: 'D9999-001', status: 'accepted', totalHt: 1000, worksiteId: ws });
  const q2 = await doc({ kind: 'quote', number: 'D9999-002', status: 'accepted', totalHt: 500, worksiteId: ws });
  const acompte = await doc({ kind: 'invoice', number: 'F9999-001', totalHt: 200, worksiteId: ws, title: 'Facture d’acompte pour devis D9999-001' });
  const situation = await doc({ kind: 'invoice', number: 'F9999-002', totalHt: 400, worksiteId: ws, title: 'Etat d’avancement n° 1 suivant devis D9999-001' });
  const multi = await doc({ kind: 'invoice', number: 'F9999-003', totalHt: 100, worksiteId: ws, title: 'Acompte devis D9999-001 / D9999-002' });
  const otherWs = await doc({ kind: 'invoice', number: 'F9999-004', totalHt: 100, worksiteId: ws2, title: 'Facture devis D9999-002' });
  const unknown = await doc({ kind: 'invoice', number: 'F9999-005', totalHt: 100, worksiteId: ws, title: 'Facture devis D9999-777' });
  const already = await doc({ kind: 'invoice', number: 'F9999-006', totalHt: 50, worksiteId: ws, title: 'Acompte devis D9999-002', parentId: q2.id });

  const plan = await planInvoiceQuoteLinks();
  const mine = plan.links.filter((l) => ids.includes(l.invoiceId));
  assert.deepEqual(mine.map((l) => l.invoiceNumber).sort(), ['F9999-001', 'F9999-002']);
  assert.ok(plan.ambiguous.some((a) => a.invoiceNumber === 'F9999-003'), 'deux devis cités : à la main');
  assert.ok(plan.ambiguous.some((a) => a.invoiceNumber === 'F9999-004'), 'chantier différent : à la main');
  assert.ok(plan.unknownQuote.some((a) => a.invoiceNumber === 'F9999-005'));
  assert.ok(!plan.links.some((l) => l.invoiceId === already.id), 'déjà lié : ignoré');
  const pq = plan.perQuote.find((p) => p.quoteNumber === 'D9999-001')!;
  assert.equal(pq.addedHt, 600); assert.equal(pq.afterPct, 60);

  // la simulation n'écrit rien
  assert.equal((await prisma.document.findUnique({ where: { id: acompte.id } }))?.parentId, null);
  assert.equal(await applyInvoiceQuoteLinks({ ...plan, links: mine }), 2);
  assert.equal((await prisma.document.findUnique({ where: { id: situation.id } }))?.parentId, q.id);
  assert.equal(await applyInvoiceQuoteLinks({ ...plan, links: mine }), 0, 'idempotent');

  // le devis affiche maintenant le pourcentage facturé
  const b = (await quoteBillings([{ id: q.id, totalHt: 1000 }])).get(q.id)!;
  assert.equal(b.billedPct, 60); assert.equal(b.remainingHt, 400); assert.equal(b.invoices.length, 2);
  void multi; void otherWs; void unknown;
});
