import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeParts, mainWorksite, expandAllocations } from './ledger-allocation.js';

test('parts : somme = HT de la facture, même chantier cumulé, moins de deux chantiers = pas de répartition', () => {
  assert.deepEqual(normalizeParts(1000, [{ worksiteId: 'a', ht: 600 }, { worksiteId: 'b', ht: 400 }]), [{ worksiteId: 'a', ht: 600 }, { worksiteId: 'b', ht: 400 }]);
  assert.deepEqual(normalizeParts(1000, [{ worksiteId: 'a', ht: 300 }, { worksiteId: 'b', ht: 400 }, { worksiteId: 'a', ht: 300 }]), [{ worksiteId: 'a', ht: 600 }, { worksiteId: 'b', ht: 400 }]);
  assert.deepEqual(normalizeParts(1000, [{ worksiteId: 'a', ht: 1000 }]), [], 'un seul chantier : pas de répartition');
  assert.throws(() => normalizeParts(1000, [{ worksiteId: 'a', ht: 600 }, { worksiteId: 'b', ht: 300 }]), { status: 422, message: /doit égaler le HT/ });
  assert.throws(() => normalizeParts(1000, [{ worksiteId: '', ht: 600 }, { worksiteId: 'b', ht: 400 }]), { status: 422 });
  assert.throws(() => normalizeParts(1000, [{ worksiteId: 'a', ht: 0 }, { worksiteId: 'b', ht: 1000 }]), { status: 422 });
});

test('parts : le signe suit l’écriture (note de crédit négative) et l’écart d’arrondi va sur la plus grosse part', () => {
  const nc = normalizeParts(-1000, [{ worksiteId: 'a', ht: 600 }, { worksiteId: 'b', ht: 400 }]);
  assert.deepEqual(nc, [{ worksiteId: 'a', ht: -600 }, { worksiteId: 'b', ht: -400 }]);
  const parts = normalizeParts(100, [{ worksiteId: 'a', ht: 33.33 }, { worksiteId: 'b', ht: 33.33 }, { worksiteId: 'c', ht: 33.33 }]);
  assert.equal(Math.round(parts.reduce((s, p) => s + p.ht, 0) * 100) / 100, 100, 'somme exacte');
});

test('chantier principal et écritures virtuelles par chantier', () => {
  assert.equal(mainWorksite([{ worksiteId: 'a', ht: 100 }, { worksiteId: 'b', ht: 900 }]), 'b');
  assert.equal(mainWorksite([]), null);
  const rows = [
    { id: 1, worksiteId: 'a', ht: 1000, allocations: [{ worksiteId: 'a', ht: 600 }, { worksiteId: 'b', ht: 400 }] },
    { id: 2, worksiteId: 'c', ht: 50, allocations: [] as { worksiteId: string; ht: number }[] },
  ];
  const out = expandAllocations(rows);
  assert.deepEqual(out.map((r) => [r.id, r.worksiteId, r.ht]), [[1, 'a', 600], [1, 'b', 400], [2, 'c', 50]]);
  assert.equal(out.reduce((s, r) => s + r.ht, 0), 1050, 'le total ne change pas');
});
