import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchCandidates, type MatchEntry } from './expense-pdf-match.js';

const e = (id: string, o: Partial<MatchEntry>): MatchEntry => ({ id, date: new Date('2026-09-08T00:00:00Z'), docNumber: null, supplier: 'Proshop', contactId: 'c1', ht: 891, ttc: 1078.11, worksiteRef: 'E-01', worksiteKind: 'overhead', ...o });
const ex = { issuedOn: '2026-09-08', docNumber: 'F-26049464', totalHt: 891, totalTtc: 1078.11, contactId: 'c1', contactName: 'Proshop ( Lambert & Tradinex )' };

test('PDF → dépense : montant + date + fournisseur, ou n° de facture ; jamais une simple date ou un simple fournisseur', () => {
  const entries = [
    e('exact', {}),
    e('autre-montant', { ht: 100, ttc: 121 }),
    e('autre-fournisseur-meme-montant', { supplier: 'Amazon', contactId: 'c2' }),
    e('meme-fournisseur-meme-jour-autre-montant', { ht: 12, ttc: 14.5 }),
    e('numero', { ht: 10, ttc: 12.1, docNumber: 'f 26049464', date: new Date('2026-08-01T00:00:00Z') }),
  ];
  const r = matchCandidates(ex, entries);
  assert.equal(r[0]!.id, 'exact');
  assert.ok(r[0]!.score >= 8 && r[0]!.reasons.includes('même fournisseur'));
  const ids = r.map((c) => c.id);
  assert.ok(ids.includes('numero'), 'le n° de facture suffit même si montant et date diffèrent');
  assert.ok(!ids.includes('autre-montant') && !ids.includes('meme-fournisseur-meme-jour-autre-montant'), 'ni numéro ni montant : jamais proposé');
});

test('montant TTC ou HT inversé entre le PDF et la saisie (tolérance 2 cts) et valeurs absolues pour une note de crédit', () => {
  const r = matchCandidates({ issuedOn: null, docNumber: null, totalHt: null, totalTtc: 121, contactId: null, contactName: null }, [e('a', { ht: 121, ttc: null }), e('b', { ht: -100, ttc: -121 })]);
  assert.deepEqual(r.map((c) => c.id).sort(), ['a', 'b']);
});
