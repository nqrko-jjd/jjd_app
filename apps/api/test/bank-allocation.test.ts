import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { signToken } from '../src/lib/auth.js';
import { allocateLines } from '../src/lib/bank-allocation.js';
import { purchaseRemaining } from '../src/lib/payment-tolerance.js';

test('purchase rounding tolerance: two cents settled only after a payment; three cents remain payable', () => {
  assert.equal(purchaseRemaining(28.75, 28.74), 0);
  assert.equal(purchaseRemaining(28.75, 28.73), 0);
  assert.equal(purchaseRemaining(28.75, 28.72), 0.03);
  assert.equal(purchaseRemaining(0.02, 0), 0.02);
});

test('legacy allocations cap each invoice and share a payment without losing its advance', () => {
  const result = allocateLines([
    { id: 'a', transactionId: '5k', transactionTotal: 5000, invoiceId: 'fv758', invoiceTotal: 565.52, amount: null },
    { id: 'b', transactionId: '5k', transactionTotal: 5000, invoiceId: 'fv840', invoiceTotal: 1908.19, amount: null },
    { id: 'c', transactionId: '10k', transactionTotal: 10000, invoiceId: 'fv794', invoiceTotal: 6373.63, amount: null },
  ]);
  assert.equal(result.transactions.get('5k'), 2473.71);
  assert.equal(result.transactions.get('10k'), 6373.63);
  assert.equal(result.invoices.get('fv840'), 1908.19);
});

test('CF Group: two payments per invoice, balances, edits, settled search and legacy preservation', async () => {
  const user = await prisma.user.create({ data: { email: `bank-${Date.now()}@test.local`, passwordHash: 'unused', role: 'admin' } });
  const contact = await prisma.contact.create({ data: { name: 'CF Group allocation test', normalizedName: 'cf group allocation test', type: 'supplier', source: 'test' } });
  const server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  const address = server.address();
  const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  const headers = { authorization: `Bearer ${signToken(user.id)}`, 'content-type': 'application/json' };
  const call = async (path: string, method = 'GET', body?: unknown) => {
    const r = await fetch(base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, body: await r.json() };
  };
  const txIds: string[] = [];
  const docIds: string[] = [];
  try {
    const invoice = async (docNumber: string, ttc: number) => prisma.ledgerEntry.create({ data: { contactId: contact.id, supplierName: contact.name, direction: 'purchase', docNumber, ht: ttc, ttc, source: 'test', paymentStatus: 'Non payé', dueDate: new Date('2020-01-01') } });
    const a = await invoice('FV760010758', 565.52), b = await invoice('FV760010840', 1908.19), c = await invoice('FV760010794', 6373.63), split = await invoice('FV760011187', 8285.29);
    const small = await prisma.bankTransaction.create({ data: { amount: -5000, side: 'out' } });
    const large = await prisma.bankTransaction.create({ data: { amount: -10000, side: 'out' } });
    txIds.push(small.id, large.id);
    await prisma.bankTransactionMatch.createMany({ data: [{ bankTransactionId: small.id, ledgerEntryId: a.id }, { bankTransactionId: small.id, ledgerEntryId: b.id }, { bankTransactionId: large.id, ledgerEntryId: c.id }] });
    const search = await call(`/api/finance/bank/${large.id}/suggestions?q=FV76001`);
    assert.equal(search.status, 200);
    assert.equal(search.body.remaining, 3626.37);
    assert.ok(!search.body.items.some((i: { id: string }) => i.id === b.id || i.id === a.id));
    let suppliers = (await call('/api/finance/suppliers')).body.items;
    let account = suppliers.find((i: { contactId: string }) => i.contactId === contact.id);
    assert.equal(account.unallocatedTotal, 6152.66);
    assert.equal(account.openTtc, 8285.29);
    assert.equal(account.balance, 2132.63);
    assert.equal((await call(`/api/finance/bank/${large.id}/matches`, 'POST', { ledgerId: b.id, amount: 1 })).status, 409);
    assert.equal((await call(`/api/finance/bank/${small.id}/matches`, 'POST', { ledgerId: split.id, amount: 2526.29 })).status, 201);
    const expenses = (await call(`/api/finance/expenses?contactId=${contact.id}&paid=0&overdue=1`)).body;
    assert.equal(expenses.items.length, 1);
    assert.equal(expenses.items[0].id, split.id);
    assert.equal(expenses.items[0].paymentStatus, 'Partiel');
    assert.equal(expenses.items[0].paidAmount, 2526.29);
    assert.equal(expenses.items[0].remainingAmount, 5759);
    assert.equal(expenses.totals.unpaidTtc, 5759);
    assert.equal(expenses.totals.overdueTtc, 5759);
    const expenseDetail = (await call(`/api/finance/expenses/${split.id}`)).body.expense;
    assert.equal(expenseDetail.bankMatches[0].allocatedAmount, 2526.29);
    assert.equal(expenseDetail.remainingAmount, 5759);
    assert.equal((await call(`/api/finance/expenses/${split.id}`, 'PATCH', { notes: 'Partially paid invoice edited', paymentStatus: 'Non payé' })).status, 200);
    assert.equal((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: split.id } })).paymentStatus, 'Partiel');
    const search2 = await call(`/api/finance/bank/${large.id}/suggestions?q=FV760011187`);
    assert.equal(search2.body.items.find((i: { id: string }) => i.id === split.id).amount, 5759);
    assert.equal((await call(`/api/finance/bank/${large.id}/matches`, 'POST', { ledgerId: split.id, amount: 3626.38 })).status, 409);
    assert.equal((await call(`/api/finance/bank/${large.id}/matches`, 'POST', { ledgerId: split.id, amount: 3626.37 })).status, 201);
    const links = await prisma.bankTransactionMatch.findMany({ where: { ledgerEntryId: split.id } });
    const link = links.find(m => m.bankTransactionId === large.id)!;
    assert.equal((await call(`/api/finance/bank/${large.id}/matches/${link.id}`, 'PATCH', { amount: 3000 })).status, 200);
    assert.equal((await call(`/api/finance/bank/${large.id}/matches/${link.id}`, 'PATCH', { amount: -1 })).status, 422);
    assert.equal((await call(`/api/finance/bank/${large.id}/matches/${link.id}`, 'DELETE')).status, 200);
    assert.equal((await prisma.ledgerEntry.findUnique({ where: { id: split.id } }))!.paymentStatus, 'Partiel');
    assert.equal((await call(`/api/finance/bank/${large.id}/suggestions?q=FV760011187`)).body.items[0].amount, 5759);
    const final = await prisma.bankTransaction.create({ data: { amount: -5759, side: 'out', contactId: contact.id } }); txIds.push(final.id);
    assert.equal((await call(`/api/finance/bank/${final.id}/matches`, 'POST', { ledgerId: split.id, amount: 5759 })).status, 201);
    assert.equal((await call(`/api/finance/bank/${large.id}/suggestions?q=FV760011187`)).body.items.length, 0);
    assert.equal((await prisma.ledgerEntry.findUnique({ where: { id: split.id } }))!.paymentStatus, 'Payé');
    account = (await call('/api/finance/suppliers')).body.items.find((i: { contactId: string }) => i.contactId === contact.id);
    assert.equal(account.openTtc, 0);
    assert.equal(account.balance, -3626.37);
    const detail = (await call(`/api/contacts/${contact.id}`)).body.contact;
    assert.equal(detail.purchaseSummary.balance, -3626.37);
    assert.equal(detail.supplierAccount.unallocatedTotal, 3626.37);
    assert.equal((await call(`/api/finance/bank/${small.id}`, 'PATCH', { amount: -100 })).status, 409);
    // The same allocation rules must also preserve the sales document and client account.
    const sale = await prisma.document.create({ data: { kind: 'invoice', number: 'BANK-TEST-SALE', status: 'sent', contactId: contact.id, source: 'test', totalHt: 1000, totalTtc: 1000, issuedOn: new Date(), lockedAt: new Date() } }); docIds.push(sale.id);
    const deposit = await prisma.bankTransaction.create({ data: { amount: 300, side: 'in', contactId: contact.id } });
    const rest = await prisma.bankTransaction.create({ data: { amount: 700, side: 'in', contactId: contact.id } }); txIds.push(deposit.id, rest.id);
    assert.equal((await call(`/api/finance/bank/${deposit.id}/matches`, 'POST', { documentId: sale.id, amount: 300 })).status, 201);
    assert.equal((await prisma.document.findUnique({ where: { id: sale.id } }))!.paidAmount, 300);
    assert.equal((await prisma.document.findUnique({ where: { id: sale.id } }))!.status, 'partial');
    assert.equal((await call(`/api/finance/bank/${rest.id}/suggestions?q=BANK-TEST-SALE`)).body.items[0].amount, 700);
    assert.equal((await call(`/api/finance/bank/${rest.id}/matches`, 'POST', { documentId: sale.id, amount: 700 })).status, 201);
    assert.equal((await prisma.document.findUnique({ where: { id: sale.id } }))!.status, 'paid');
    const depositMatch = await prisma.bankTransactionMatch.findFirstOrThrow({ where: { bankTransactionId: deposit.id } });
    assert.equal((await call(`/api/finance/bank/${deposit.id}/matches/${depositMatch.id}`, 'DELETE')).status, 200);
    assert.equal((await prisma.document.findUnique({ where: { id: sale.id } }))!.paidAmount, 700);
    assert.equal((await prisma.document.findUnique({ where: { id: sale.id } }))!.status, 'partial');
    const clientBalance = (await call(`/api/contacts/${contact.id}`)).body.contact.clientAccount;
    assert.equal(clientBalance.openTtc, 300);
    assert.equal(clientBalance.unallocatedTotal, 300);
    assert.equal(clientBalance.balance, 0);
    // A settled two-cent residual must not remain payable on the supplier contact.
    const penny = await invoice('BANK-TEST-PENNY', 28.75);
    const pennyTx = await prisma.bankTransaction.create({ data: { amount: -28.73, side: 'out', contactId: contact.id } });
    txIds.push(pennyTx.id);
    assert.equal((await call(`/api/finance/bank/${pennyTx.id}/matches`, 'POST', { ledgerId: penny.id, amount: 28.73 })).status, 201);
    assert.equal((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: penny.id } })).paymentStatus, 'Payé');
    const pennyAccount = (await call('/api/finance/suppliers')).body.items.find((i: { contactId: string }) => i.contactId === contact.id);
    assert.equal(pennyAccount.invoices.find((i: { id: string }) => i.id === penny.id).remaining, 0);
    const pennyExpense = (await call(`/api/finance/expenses/${penny.id}`)).body.expense;
    assert.equal(pennyExpense.paid, true);
    assert.equal(pennyExpense.remainingAmount, 0);
    const excess = await invoice('BANK-TEST-PENNY-EXCESS', 28.75);
    const excessTx = await prisma.bankTransaction.create({ data: { amount: -28.77, side: 'out', contactId: contact.id } });
    txIds.push(excessTx.id);
    assert.equal((await call(`/api/finance/bank/${excessTx.id}/matches`, 'POST', { ledgerId: excess.id, amount: 28.75 })).status, 201);
    let roundedAccount = (await call('/api/finance/suppliers')).body.items.find((i: { contactId: string }) => i.contactId === contact.id);
    assert.equal(roundedAccount.unallocatedTotal, pennyAccount.unallocatedTotal);
    const tinyAdvance = await prisma.bankTransaction.create({ data: { amount: -0.02, side: 'out', contactId: contact.id } });
    txIds.push(tinyAdvance.id);
    roundedAccount = (await call('/api/finance/suppliers')).body.items.find((i: { contactId: string }) => i.contactId === contact.id);
    assert.equal(roundedAccount.unallocatedTotal, Math.round((pennyAccount.unallocatedTotal + 0.02) * 100) / 100);
  } finally {
    await prisma.bankTransaction.deleteMany({ where: { id: { in: txIds } } });
    await prisma.ledgerEntry.deleteMany({ where: { contactId: contact.id } });
    await prisma.document.deleteMany({ where: { id: { in: docIds } } });
    await prisma.contact.delete({ where: { id: contact.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  }
});

test('confirmed supplier statement absorbs only named historical credits and advances', async () => {
  const { supplierAccounts } = await import('../src/lib/supplier-account.js');
  const c = await prisma.contact.create({ data: { name: 'Statement settlement test', normalizedName: 'statement settlement test', type: 'supplier' } });
  try {
    await prisma.ledgerEntry.createMany({ data: [
      { contactId: c.id, direction: 'purchase', ht: 1332.04, ttc: 1332.04, source: 'test' },
      { id: c.id + '-old-credit', contactId: c.id, direction: 'credit_note', ht: 10, ttc: 10, source: 'test' },
      { contactId: c.id, direction: 'credit_note', ht: 464.89, ttc: -464.89, source: 'test' },
    ] });
    const old = await prisma.bankTransaction.create({ data: { contactId: c.id, amount: -322.3, side: 'out' } });
    await prisma.auditLog.create({ data: { action: 'supplier_statement_reconciled', entity: 'Contact', entityId: c.id, meta: { accountSettlement: { settledCreditIds: [c.id + '-old-credit'], absorbedAdvances: [{ id: old.id, amount: 322.3 }] } } } });
    let a = (await supplierAccounts()).find(a => a.contactId === c.id)!;
    assert.equal(a.balance, 867.15);
    assert.equal(a.credits, 464.89);
    assert.equal(a.unallocatedTotal, 0);
    const { allocationSnapshot } = await import('../src/lib/bank-allocation.js');
    assert.equal((await allocationSnapshot()).transactions.get(old.id), 322.3);
    await prisma.bankTransaction.create({ data: { contactId: c.id, amount: -100, side: 'out' } });
    a = (await supplierAccounts()).find(a => a.contactId === c.id)!;
    assert.equal(a.balance, 767.15);
    assert.equal(a.unallocatedTotal, 100);
  } finally {
    await prisma.auditLog.deleteMany({ where: { entityId: c.id } });
    await prisma.bankTransaction.deleteMany({ where: { contactId: c.id } });
    await prisma.ledgerEntry.deleteMany({ where: { contactId: c.id } });
    await prisma.contact.delete({ where: { id: c.id } });
  }
});
