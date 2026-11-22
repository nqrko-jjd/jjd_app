import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPalletLine, palletType, palletBalances } from './pallets-pure.js';

test('lignes palettes', () => {
  for (const l of ['PALETTE GARANTIE EURO', '01PAL9 PALETTE REMACLE', 'CAUTION PALETTE BLOC BETON ROOSENS', 'PALETTE GARANTIE PLAQUE DE PLATRE']) assert.equal(isPalletLine(l), true, l);
  for (const l of ['PALUX PALETTE A SILICONE', 'PALUX PALETTE MULTI.JOINTS', 'TRANSPALETTE MANUELLE', 'CAUTION']) assert.equal(isPalletLine(l), false, l);
});
test('types', () => {
  assert.equal(palletType('PALETTE GARANTIE NEW EURO'), 'Euro');
  assert.equal(palletType('PALETTE GARANTIE PLAQUE DE PLATRE'), 'Plaques de plâtre');
  assert.equal(palletType('PALETTE YTONG 400'), 'Ytong');
});
test('solde : facturées − rendues', () => {
  const m = (qty: number, type = 'Euro', p = 25) => ({ entryId: 'x', date: null, docNumber: null, credit: qty < 0, label: '', type, qty, unitPriceHt: p, totalHt: qty * p });
  const r = palletBalances([m(10), m(-4), m(2, 'Plaques de plâtre', 60)]);
  assert.deepEqual(r.byType.map((b) => [b.type, b.out, b.back, b.net, b.valueHt]), [['Euro', 10, 4, 6, 150], ['Plaques de plâtre', 2, 0, 2, 120]]);
  assert.equal(r.net, 8); assert.equal(r.valueHt, 270);
});
