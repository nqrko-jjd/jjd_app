import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextWorksiteStatus, type StatusSignals, type StatusTrigger } from './worksite-status.js';

const sig = (over: Partial<StatusSignals>): StatusSignals => ({
  status: 'in_progress', quotes: { accepted: 0, sent: 0, declined: 0 }, quotedHt: 0, invoicedHt: 0, invoices: 0, creditNotes: 0, allPaid: false,
  futureIntervention: false, startedIntervention: false, anyIntervention: false, hasTimesheet: false, ...over,
});
const to = (over: Partial<StatusSignals>, trigger: StatusTrigger) => nextWorksiteStatus(sig(over), trigger)?.to ?? null;

test('devis accepté : demande / devis à faire → à planifier', () => {
  assert.equal(to({ status: 'lead', quotes: { accepted: 1, sent: 0, declined: 0 } }, 'document'), 'to_plan');
  assert.equal(to({ status: 'quote_needed', quotes: { accepted: 1, sent: 0, declined: 0 } }, 'document'), 'to_plan');
  assert.equal(to({ status: 'in_progress', quotes: { accepted: 1, sent: 0, declined: 0 } }, 'document'), null);
});

test('devis accepté alors qu’une intervention est déjà planifiée : directement « Planifié »', () => {
  assert.equal(to({ status: 'quote_needed', quotes: { accepted: 1, sent: 0, declined: 0 }, futureIntervention: true, anyIntervention: true }, 'document'), 'scheduled');
});

test('devis refusé (seul devis, rien de commencé) : refusé ; pas s’il reste un autre devis ou une facture', () => {
  assert.equal(to({ status: 'quote_needed', quotes: { accepted: 0, sent: 0, declined: 1 } }, 'document'), 'refused');
  assert.equal(to({ status: 'quote_needed', quotes: { accepted: 0, sent: 1, declined: 1 } }, 'document'), null);
  assert.equal(to({ status: 'to_plan', quotes: { accepted: 0, sent: 0, declined: 1 }, invoices: 1, invoicedHt: 100 }, 'document'), null);
  assert.equal(to({ status: 'in_progress', quotes: { accepted: 0, sent: 0, declined: 1 } }, 'document'), null);
});

test('refusé repart si un devis est finalement accepté ; abandonné jamais', () => {
  assert.equal(to({ status: 'refused', quotes: { accepted: 1, sent: 0, declined: 1 } }, 'document'), 'to_plan');
  assert.equal(to({ status: 'cancelled', quotes: { accepted: 1, sent: 0, declined: 0 }, futureIntervention: true }, 'document'), null);
  assert.equal(to({ status: 'cancelled', startedIntervention: true }, 'event'), null);
});

test('planning : intervention à venir → planifié ; démarrée → en cours ; RDV ne compte pas (non fourni)', () => {
  assert.equal(to({ status: 'to_plan', futureIntervention: true, anyIntervention: true }, 'event'), 'scheduled');
  assert.equal(to({ status: 'to_plan', startedIntervention: true, anyIntervention: true }, 'event'), 'in_progress');
  assert.equal(to({ status: 'scheduled', startedIntervention: true, anyIntervention: true }, 'sweep'), 'in_progress');
  assert.equal(to({ status: 'in_progress', futureIntervention: true, anyIntervention: true }, 'event'), null);
});

test('dernière intervention supprimée avant de commencer : planifié → à planifier', () => {
  assert.equal(to({ status: 'scheduled' }, 'event'), 'to_plan');
  assert.equal(to({ status: 'scheduled', futureIntervention: true, anyIntervention: true }, 'event'), null);
});

test('en observation : reprend seulement par une intervention planifiée ou un pointage', () => {
  assert.equal(to({ status: 'on_hold', futureIntervention: true, anyIntervention: true }, 'event'), 'scheduled');
  assert.equal(to({ status: 'on_hold', startedIntervention: true, anyIntervention: true }, 'event'), 'in_progress');
  assert.equal(to({ status: 'on_hold', hasTimesheet: true }, 'timesheet'), 'in_progress');
  assert.equal(to({ status: 'on_hold', startedIntervention: true, anyIntervention: true }, 'sweep'), null);
  assert.equal(to({ status: 'on_hold', startedIntervention: true, anyIntervention: true }, 'document'), null);
});

test('premier pointage : à planifier / planifié → en cours', () => {
  assert.equal(to({ status: 'scheduled', hasTimesheet: true }, 'timesheet'), 'in_progress');
  assert.equal(to({ status: 'to_plan', hasTimesheet: true }, 'timesheet'), 'in_progress');
  assert.equal(to({ status: 'done', hasTimesheet: true }, 'timesheet'), null);
});

test('facture finale émise (tout le marché facturé, pas encore payée) → facturé', () => {
  assert.equal(to({ status: 'in_progress', quotedHt: 10000, invoicedHt: 10000, invoices: 1 }, 'document'), 'invoiced');
  assert.equal(to({ status: 'to_invoice', quotedHt: 10000, invoicedHt: 9990, invoices: 2 }, 'document'), 'invoiced'); // tolérance d'arrondi
});

test('acompte seul émis : le chantier ne change pas (sauf demande / devis à faire → à planifier)', () => {
  assert.equal(to({ status: 'in_progress', quotedHt: 10000, invoicedHt: 3000, invoices: 1 }, 'document'), null);
  assert.equal(to({ status: 'scheduled', quotedHt: 10000, invoicedHt: 3000, invoices: 1 }, 'document'), null);
  assert.equal(to({ status: 'quote_needed', quotedHt: 10000, invoicedHt: 3000, invoices: 1 }, 'document'), 'to_plan');
});

test('tout facturé ET tout payé → clôturé ; solde payé mais reste à facturer → inchangé', () => {
  assert.equal(to({ status: 'invoiced', quotedHt: 10000, invoicedHt: 10000, invoices: 2, allPaid: true }, 'document'), 'closed');
  assert.equal(to({ status: 'in_progress', quotedHt: 10000, invoicedHt: 10000, invoices: 2, allPaid: true }, 'document'), 'closed');
  assert.equal(to({ status: 'to_invoice', quotedHt: 10000, invoicedHt: 3000, invoices: 1, allPaid: true }, 'document'), null);
  assert.equal(to({ status: 'invoiced', quotedHt: 10000, invoicedHt: 10000, invoices: 2, allPaid: false }, 'document'), null);
});

test('paiement partiel : la facture reste « facturé »', () => {
  assert.equal(to({ status: 'invoiced', quotedHt: 10000, invoicedHt: 10000, invoices: 1, allPaid: false }, 'document'), null);
});

test('« Clôturé » est définitif pour l’automatisme (historique importé trop peu fiable pour rouvrir seul) ; facturé + note de crédit ne recule pas non plus', () => {
  assert.equal(to({ status: 'closed', quotedHt: 10000, invoicedHt: 10000, invoices: 2, allPaid: false }, 'document'), null);
  assert.equal(to({ status: 'closed', quotedHt: 10000, invoicedHt: 6000, invoices: 1, creditNotes: 1, allPaid: true }, 'document'), null);
  assert.equal(to({ status: 'invoiced', quotedHt: 10000, invoicedHt: 6000, invoices: 1, creditNotes: 1 }, 'document'), null);
});

test('terminé sur le terrain (fil clôturé) : à facturer ; déjà tout facturé → facturé ; tout payé → clôturé', () => {
  assert.equal(to({ status: 'done', quotedHt: 10000, invoicedHt: 3000, invoices: 1 }, 'field-done'), 'to_invoice');
  assert.equal(to({ status: 'done' }, 'field-done'), 'to_invoice');
  assert.equal(to({ status: 'done', quotedHt: 10000, invoicedHt: 10000, invoices: 1 }, 'field-done'), 'invoiced');
  assert.equal(to({ status: 'done', quotedHt: 10000, invoicedHt: 10000, invoices: 1, allPaid: true }, 'field-done'), 'closed');
});

test('sans devis connu : facture émise sur un travail fini → facturé ; en cours → inchangé', () => {
  assert.equal(to({ status: 'to_invoice', invoicedHt: 2500, invoices: 1 }, 'document'), 'invoiced');
  assert.equal(to({ status: 'in_progress', invoicedHt: 2500, invoices: 1 }, 'document'), null);
});

test('un événement du planning ne réveille pas la facturation (statut manuel conservé)', () => {
  assert.equal(to({ status: 'done', quotedHt: 10000, invoicedHt: 3000, invoices: 1 }, 'event'), null);
  assert.equal(to({ status: 'invoiced', quotedHt: 10000, invoicedHt: 10000, invoices: 1, allPaid: true }, 'event'), null);
});
