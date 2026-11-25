import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayBasedAmounts, personDayAmount } from './paid-time.js';

test('un jour = le montant du jour, réparti au prorata des heures', () => {
  const m = dayBasedAmounts([
    { id: 'a', date: '2026-11-10', hours: 6, amount: 120 },
    { id: 'b', date: '2026-11-10', hours: 6, amount: 120 },
    { id: 'c', date: '2026-11-11', hours: 12, amount: 240 },
    { id: 'd', date: '2025-01-05', hours: 9, amount: 155, source: 'xlsx' },
  ], 200);
  assert.deepEqual([...m.entries()].sort(), [['a', 100], ['b', 100], ['c', 200], ['d', 155]]);
});
test('montant journalier', () => {
  assert.equal(personDayAmount({ payoutPerDay: 160, hourlyRate: 17.78, dailyHours: 10 }), 160);
  assert.equal(personDayAmount({ hourlyRate: 20, dailyHours: 10 }), 200);
  assert.equal(personDayAmount({}), null);
});
