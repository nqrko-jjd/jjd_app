import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, parseLineItems, articleKey } from './purchase-line-parse.js';

test('grossiste avec code article, remise et prix net (mise en page Sani Mat)', () => {
  const l = parseLine('107818 SILENT PP COUDE 45¡ AVEC MANCHON D50 6. PC 3.55 −40. % 2.13 12.78 3')!;
  assert.equal(l.code, '107818');
  assert.equal(l.label, 'SILENT PP COUDE 45¡ AVEC MANCHON D50');
  assert.equal(l.qty, 6); assert.equal(l.unit, 'PC');
  assert.equal(l.totalHt, 12.78); assert.equal(l.unitPriceHt, 2.13); assert.equal(l.discountPct, 40);
});

test('ligne numérotée avec unité, remise négative sans % et TVA en fin de ligne (mise en page Proshop)', () => {
  const a = parseLine('2 TRIMETAL ROLLACRYL SUPERLATEX MAT S1 9010 EN 10 L P 1 81,30 81,30 21%')!;
  assert.equal(a.code, null); assert.equal(a.label, 'TRIMETAL ROLLACRYL SUPERLATEX MAT S1 9010 EN 10 L'); assert.equal(a.qty, 1); assert.equal(a.totalHt, 81.3);
  const b = parseLine('3 FLEX ABRASIF JAUNE WS702VE GR 180 311987 P 3 3,56 10,68 21%')!;
  assert.equal(b.qty, 3); assert.equal(b.unitPriceHt, 3.56); assert.equal(b.totalHt, 10.68);
  const c = parseLine('10 MAGNACRYL PRESTIGE MAT BASE AW EN 5 L P 1 139,68 -35 90,79 21%')!;
  assert.equal(c.totalHt, 90.79); assert.equal(c.discountPct, 35);
  const d = parseLine('8 CG PREM PINCEAU ROND S4500 N° 8 P 1 3,43 -15 2,92 21%')!;
  assert.equal(d.totalHt, 2.92); assert.equal(d.label, 'CG PREM PINCEAU ROND S4500 N° 8');
});

test('prestations de sous-traitants : quantité, prix unitaire et total en euros, séparateur de milliers', () => {
  const t = parseLine('Overijse - Linkebeek - Woluwe - Nivelles 7 € 200,00 1.400,00 €')!;
  assert.equal(t.label, 'Overijse - Linkebeek - Woluwe - Nivelles'); assert.equal(t.qty, 7); assert.equal(t.unitPriceHt, 200); assert.equal(t.totalHt, 1400);
  const g = parseLine('Prestations de service 1 € 15 000,00 € 15 000,00 MC')!;
  assert.equal(g.label, 'Prestations de service'); assert.equal(g.totalHt, 15000);
});

test('rien d’inventé : totaux, en-têtes, adresses et lignes dont les chiffres ne se recoupent pas sont ignorés', () => {
  for (const l of [
    'Total à payer € 15 000,00', 'Total HTVA 7800,00€', 'TVA 0% 0,00€', 'Total 36.737,25 €',
    'Tél: 0470/69.37.65', 'Date : 30.09.2026 Date d\' éch. : 15.10.2026', '3 12.78 12.78 21. 2.68 15.46 15.46 EUR',
    'Rue de la Loi 16 1000 Bruxelles', 'PRODUIT TEST 2 10,00 99,00',
  ]) assert.equal(parseLine(l), null, l);
});

test('texte complet : seules les lignes d’article sont gardées', () => {
  const lines = parseLineItems('FACTURE 123\nTél: 0470/69.37.65\n2 TRIMETAL ROLLACRYL P 1 81,30 81,30 21%\nTotal HTVA 81,30\n');
  assert.equal(lines.length, 1);
});

test('clé d’article : code propre au fournisseur, sinon libellé normalisé', () => {
  assert.equal(articleKey({ code: '107818', label: 'X' }, 'c1'), 'C:c1:107818');
  assert.equal(articleKey({ code: null, label: 'Pinceau  rond – N° 8' }, 'c1'), 'L:PINCEAU ROND N 8');
});

test('prix à 3 décimales avec un point (grossiste) : 516.619 = 516,619 €, pas 516 619 €', () => {
  const c = parseLine('180003 CABLE XVB 5G 10MM GRIS 50M 1. PC 516.619 516.619 21.')!;
  assert.equal(c.qty, 1); assert.equal(c.unitPriceHt, 516.62); assert.equal(c.totalHt, 516.62);
  const r = parseLine('100501 RUG TRAPPE ALUPLANA 60X60CM 12.5 HYDRO 3. PC 47.921 -20. % 38.337 115.01')!;
  assert.equal(r.qty, 3); assert.equal(r.discountPct, 20); assert.equal(r.totalHt, 115.01);
  // avec une virgule dans la ligne, le point reste un séparateur de milliers
  assert.equal(parseLine('Prestation chantier 7 € 200,00 1.400,00 €')!.totalHt, 1400);
});
