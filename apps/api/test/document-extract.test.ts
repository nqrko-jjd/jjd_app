import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDocumentText, findWorksiteRefCandidates } from '../src/lib/document-extract.js';

test('parseDocumentText : facture — type, date, TVA et totaux détectés', () => {
  const text = `
    SANIMAT WAVRE
    TVA : BE 0746.980.568

    FACTURE N° 351682
    Date : 09/07/2026

    Client : JJD CONSULT
    TVA : BE1003823997

    Total HTVA        1 498,17
    TVA 21%             314,62
    Total TVAC        1 812,79
  `;
  const r = parseDocumentText(text);
  assert.equal(r.kind, 'invoice');
  assert.equal(r.issuedOn, '2026-07-09');
  assert.equal(r.docNumber, '351682');
  assert.equal(r.totalHt, 1498.17);
  assert.equal(r.totalVat, 314.62);
  assert.equal(r.totalTtc, 1812.79);
  assert.equal(r.vatRate, 0.21);
  assert.deepEqual(r.vatNumbersFound.sort(), ['BE0746980568', 'BE1003823997']);
});

test('parseDocumentText : note de crédit détectée avant "facture" même si le mot apparaît ailleurs', () => {
  const text = 'NOTE DE CRÉDIT n° 205112\nSuite à notre facture du 01/09/2025\nTotal TTC 218,56';
  const r = parseDocumentText(text);
  assert.equal(r.kind, 'credit_note');
  assert.equal(r.docNumber, '205112');
  assert.equal(r.totalTtc, 218.56);
});

test('parseDocumentText : devis détecté', () => {
  const text = 'DEVIS N° 2026-014\nDate du devis : 03/03/2026\nNet à payer : 4 072,97';
  const r = parseDocumentText(text);
  assert.equal(r.kind, 'quote');
  assert.equal(r.issuedOn, '2026-03-03');
  assert.equal(r.docNumber, '2026-014');
  assert.equal(r.totalTtc, 4072.97);
});

test('parseDocumentText : facture en tableau (en-têtes de colonnes puis valeurs sur la ligne suivante)', () => {
  // reproduit un vrai cas remonté : facture "No-Doc." style ERP, date sur 2 chiffres,
  // aucun montant/n° adjacent à un libellé sur la même ligne (mise en page en colonnes)
  const text = [
    ' BV JJD CONSULT',
    ' GIETERIJSTRAAT 49',
    ' B-1601 RUISBROEK (BT.)',
    'Tél: 0470/69.37.65',
    ' Date No-Tva No-Cl. No-Doc. FACTURE',
    ' 09/09/26 BE 1003.823.997 3958 20/358741',
    ' Article Libellé Qté UV PV-Brut %-Rem PV-Net Montant C',
    ' 197224 RAD. HENRAD 8 TROUS 600X1800 T22 3118W 1. PC 647.12 -65. % 226.49 226.49 3',
    ' Votre référence:: R069',
    ' De 09/09/26 ONTVANGEN MC/BC/C.CARD 395.05 EUR',
    'C Tot-Marchandise Base Taxable %-TVA Total Tva Total A PAYER',
    '3 326.49 326.49 21. 68.56 395.05 EUR',
    'DATE D\'ECHEANCE: 09/09/26 ACOMPTE: 395.05 EUR',
  ].join('\n');

  const r = parseDocumentText(text);
  // le tout premier motif "chiffre/chiffre/chiffre" du texte est un n° de tél (0470/69.37 ->
  // 69 invalide comme mois) : ne doit pas faire échouer toute la détection de date
  assert.equal(r.issuedOn, '2026-09-09');
  assert.equal(r.docNumber, '20/358741');
  assert.equal(r.totalTtc, 395.05);

  const refs = findWorksiteRefCandidates(text);
  assert.deepEqual(refs, ['R-69']);
});

test('parseDocumentText : facture Brico — "Montant de la facture" et "Numéro … du document"', () => {
  // reproduit un vrai cas remonté : le fournisseur était bien détecté (TVA) mais ni le n° de
  // document ni le montant, car ce fournisseur n'utilise ni "Facture n°" ni "Total TTC/TVAC"
  const text = [
    '358400126252103329412367',
    'Facture',
    'Informations de paiement',
    'Numéro/date du document 2218828616/ 09.09.2026',
    'Numéro/date 1218817077 / 10.09.2026',
    'Numéro de réf./date 358400180005106 / 09.09.2026',
    "Votre numéro d'identification fiscale BE1003823997",
    'Client 9903683425',
    'Email jjdconsult1@gmail.com',
    'Devise EUR',
    'Montant de la facture 24,99',
    'Brico Belgium S.A. / N.V.',
    'JJD CONSULT SRL',
    '49 Gieterijstraat',
    '1601 Sint-Pieters-Leeuw',
    ' BE1003823997',
    'Détails de la facture',
    "Item No. N° article Désignation Quantité Prix à l'unité Total Réduction Vente nette TVA% TVA",
    '000010 5167042 20 VIS HI FORCE WIROX 6X140 1 24,99 24,99 0,00 24,99 21% 4,34',
    'Sous-total 24,99 0,00 24,99',
    'Total 24,99 0,00 24,99',
    'TVA% Total hors TVA Total TVA Total TVA comprise',
    '21% 20,65 4,34 24,99',
    'Total 20,65 4,34 24,99',
    'Montant de la facture - VINGT-QUATRE EURO et QUATRE-VINGT-DIX-NEUF CENTIMES',
    'Payé',
    'TVA/BTW : BE0427572733 IBAN : BE25 3101 1395 5282 BIC : BBRUBEBB',
  ].join('\n');

  const r = parseDocumentText(text);
  assert.equal(r.kind, 'invoice');
  assert.equal(r.issuedOn, '2026-09-09');
  assert.equal(r.dueOn, null, 'pas d’échéance sur cette facture (déjà payée)');
  assert.equal(r.docNumber, '2218828616');
  assert.equal(r.totalTtc, 24.99);
});

test('parseDocumentText : facture Apok — "Montant de vente(À payer)" prime sur le "à payer" (0,00) plus bas car déjà réglée', () => {
  // reproduit un vrai cas remonté : le montant réel (411,98) n'était pas détecté ; le document
  // contient PLUS BAS un second repère "Total à payer 0,00" (reste dû, puisque déjà payée) qui
  // aurait fait extraire 0,00 comme montant si le mauvais repère est utilisé en premier
  const text = [
    'Page 1 / 2',
    'Facture Copy',
    'Destinataire facture 1111418',
    'JJD CONSULT',
    'GIETERIJSTRAAT 49',
    '1601 SINT-PIETERS-LEEUW',
    'Belgique',
    'Numéro du document 91840598',
    'Date du document 10.09.2026',
    'Numéro de TVA BE1003823997',
    'N°ID fiscale',
    "Date d'échéance 10.09.2026",
    'IN0091840598',
    'Article Quantité Prix Montant',
    'Division : P104 - Apok Anderlecht',
    'SIGNATURE',
    'Montant de vente(À payer) 411,98 EUR',
    'Bancontact 412,00 EUR',
    'Total payé 412,00 EUR',
    'À payer (hors escompte) 0,00 EUR',
    'Page 2 / 2',
    'Facture Copy',
    'Numéro du document 91840598',
    'Date du document 10.09.2026',
    "Date d'échéance 10.09.2026",
    'Total sans TVA 340,48 EUR',
    'TVA 21,00% Base TVA 340,48 EUR 71,50 EUR',
    'Total 411,98 EUR',
    'Total à payer 0,00 EUR',
    'Communication à mentionner avec paiement:1111418 91840598',
  ].join('\n');

  const r = parseDocumentText(text);
  assert.equal(r.kind, 'invoice');
  assert.equal(r.issuedOn, '2026-09-10');
  assert.equal(r.dueOn, '2026-09-10');
  assert.equal(r.docNumber, '91840598');
  assert.equal(r.totalHt, 340.48);
  assert.equal(r.totalTtc, 411.98, 'doit prendre le montant réel, pas le reste à payer (0,00) déjà réglé');
  assert.equal(r.vatRate, 0.21, 'taux avec décimales ("21,00%") reconnu');
});

test('findWorksiteRefCandidates : plusieurs chantiers cités (facture qui couvre plusieurs chantiers)', () => {
  const refs = findWorksiteRefCandidates('Livraison pour R-69 et complément pour R123 (bon E07 joint)');
  assert.deepEqual(refs, ['R-69', 'R-123', 'E-7']);
});

test('parseDocumentText : texte sans repère connu -> tout à null, pas d’erreur', () => {
  const r = parseDocumentText('Bonjour,\nVeuillez trouver ci-joint le document demandé.\nCordialement.');
  assert.equal(r.kind, null);
  assert.equal(r.issuedOn, null);
  assert.equal(r.totalTtc, null);
  assert.deepEqual(r.vatNumbersFound, []);
});
