import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeWorksiteMargin, parseAmount, parseLooseDate, excelSerialToDate,
  normalizeName, guessWorksiteStatus, htFromTtc, formatVat,
} from '../src/index.js';

test('parseAmount gère les formats belges et Excel', () => {
  assert.equal(parseAmount('26 166,00 €'), 26166);
  assert.equal(parseAmount('1.713,23'), 1713.23);
  assert.equal(parseAmount('245.565'), 245.565);
  assert.equal(parseAmount(2150), 2150);
  assert.equal(parseAmount('?'), null);
  assert.equal(parseAmount('-'), null);
});

test('excelSerialToDate : 45376 -> 2024-03-25', () => {
  const d = excelSerialToDate(45376);
  assert.equal(d.getUTCFullYear(), 2024);
  assert.equal(d.getUTCMonth(), 2); // mars (0-indexé)
  assert.equal(d.getUTCDate(), 25);
  // ancre connue : 45292 = 1er janvier 2024
  const anchor = excelSerialToDate(45292);
  assert.equal(anchor.toISOString().slice(0, 10), '2024-01-01');
});

test('parseLooseDate accepte texte et série', () => {
  assert.equal(parseLooseDate('16/12/2024')?.getUTCFullYear(), 2024);
  assert.equal(parseLooseDate('45376.0')?.getUTCMonth(), 2);
  assert.equal(parseLooseDate('Pas facturé'), null);
});

test('normalizeName rapproche les doublons', () => {
  assert.equal(normalizeName(' JJD '), 'jjd');
  assert.equal(normalizeName('ACP Les mésanges (c/o Baltimo)'), normalizeName('ACP Les mesanges (c/o Baltimo)'));
});

test('guessWorksiteStatus lit le texte libre', () => {
  assert.equal(guessWorksiteStatus('Abandonné'), 'cancelled');
  assert.equal(guessWorksiteStatus('Terminé, Facturé'), 'invoiced');
  assert.equal(guessWorksiteStatus('En cours'), 'in_progress');
  assert.equal(guessWorksiteStatus('Devis Envoyé'), 'lead');
  assert.equal(guessWorksiteStatus('/'), 'to_plan');
});

test('marge chantier : réel = payé - matériaux - main d’œuvre', () => {
  // R-069 du fichier : payé 0, matériaux 59064.08, MO 30045.70
  const m = computeWorksiteMargin({
    entity: 'jjd', quotedHt: 0, invoicedHt: 0, paidHt: 0,
    materialCost: 59064.08, labourCost: 30045.7,
  });
  assert.equal(m.totalCost, 89109.78);
  assert.equal(m.realMargin, -89109.78);
  assert.equal(m.realMarginPct, null); // pas de division par 0
  assert.equal(m.partnerShare, 0);
});

test('marge Tonton : part apporteur = 1/3 du bénéfice positif', () => {
  const m = computeWorksiteMargin({
    entity: 'tonton', quotedHt: 30000, invoicedHt: 30000, paidHt: 30000,
    materialCost: 12000, labourCost: 6000,
  });
  assert.equal(m.realMargin, 12000);
  assert.equal(m.partnerShare, 4000);
  assert.equal(m.netForJjd, 8000);
});

test('htFromTtc 6% rénovation', () => {
  assert.equal(htFromTtc(1060, 0.06), 1000);
});

test('formatVat', () => {
  assert.equal(formatVat('BE0850775221'), 'BE 0850.775.221');
  assert.equal(formatVat('foo'), null);
});
