import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBankCsv, decodeCsvBuffer } from '../src/lib/bank-csv.js';

test('CSV belge point-virgule, en-têtes FR, montants belges', () => {
  const csv = [
    'Date de comptabilisation;Nom contrepartie;Montant;Communication',
    '15/05/2026;COLRUYT BRUXELLES;-84,20;Achat carte',
    '16/05/2026;"CLIENT SPRL";1.210,00;+++084/2613/66074+++',
  ].join('\n');
  const r = parseBankCsv(csv);
  assert.equal(r.rows.length, 2);
  assert.ok(r.mapped.includes('amount') && r.mapped.includes('bookingDate'));
  assert.equal(r.rows[0]!.amount, -84.2);
  assert.equal(r.rows[0]!.counterpartyName, 'COLRUYT BRUXELLES');
  assert.equal(r.rows[0]!.bookingDate?.toISOString().slice(0, 10), '2026-05-15');
  assert.equal(r.rows[1]!.amount, 1210);
  assert.equal(r.rows[1]!.communication, '+++084/2613/66074+++');
});

test('CSV virgule, en-têtes EN, date ISO', () => {
  const csv = 'Booking date,Merchant,Amount,Currency\n2026-04-01,AWS EMEA,-312.55,EUR\n';
  const r = parseBankCsv(csv);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0]!.amount, -312.55);
  assert.equal(r.rows[0]!.counterpartyName, 'AWS EMEA');
  assert.equal(r.rows[0]!.bookingDate?.getUTCFullYear(), 2026);
});

test('externalId stable = ré-import idempotent', () => {
  const csv = 'Datum;Naam;Bedrag\n10/03/2026;TOTAL ENERGIES;-72,00\n';
  const a = parseBankCsv(csv).rows[0]!;
  const b = parseBankCsv(csv).rows[0]!;
  assert.equal(a.externalId, b.externalId);
  assert.ok(a.externalId.startsWith('csv-'));
});

test('en-têtes non reconnues -> rows vide + diagnostic', () => {
  const r = parseBankCsv('col1;col2;col3\na;b;c\n');
  assert.equal(r.rows.length, 0);
  assert.deepEqual(r.headers, ['col1', 'col2', 'col3']);
});

test('export "recherche" Belfius : préambule de critères avant le vrai en-tête -> quand même exploitable', () => {
  // reproduit un vrai cas remonté : le CSV exporté depuis la recherche de transactions
  // Belfius commence par ~12 lignes de critères ("Date de comptabilisation à partir
  // de;24/08/2026"…) avant la vraie ligne d'en-têtes ; l'ancien code prenait la 1ère
  // ligne du fichier pour des en-têtes et ne trouvait donc jamais de colonne montant
  const csv = [
    'Date de comptabilisation à partir de;24/08/2026',
    "Date de comptabilisation jusqu'au;10/09/2026",
    'Montant à partir de;',
    "Montant jusqu'à;",
    "Numéro d'extrait à partir de;",
    "Numéro d'extrait jusqu'au;",
    'Communication;',
    'Nom contrepartie contient;',
    'Compte contrepartie;',
    'Dernier solde;69.462,74 EUR',
    'Date/heure du dernier solde;10/09/2026 10:23:44',
    ';',
    "Compte;Date de comptabilisation;Numéro d'extrait;Numéro de transaction;Compte contrepartie;Nom contrepartie contient;Rue et numéro;Code postal et localité;Transaction;Date valeur;Montant;Devise;BIC;Code pays;Communications",
    'BE31 0689 4940 0055;10/09/2026;;;;PARKEREN ST GILLIS;;9051 GENT;BANCONTACT - ACHAT - PARKEREN ST GILLIS;10/09/2026;-19,00;EUR;;BE;BANCONTACT - ACHAT - PARKEREN ST GILLIS',
    'BE31 0689 4940 0055;09/09/2026;;;BE97 7785 9868 3449;ACP RES. LE BOSQUET;RUE MURILLO 11/132;1000 BRUXELLES;VERSEMENT F2026-345;09/09/2026;1299,56;EUR;GKCCBEBB;BE;F2026-345',
  ].join('\n');

  const r = parseBankCsv(csv);
  assert.equal(r.rows.length, 2, `2 lignes attendues, colonnes détectées : ${r.headers.join(', ')} / reconnues : ${r.mapped.join(', ')}`);
  assert.ok(r.mapped.includes('amount') && r.mapped.includes('bookingDate'));
  assert.equal(r.rows[0]!.amount, -19);
  assert.equal(r.rows[0]!.counterpartyName, 'PARKEREN ST GILLIS');
  assert.equal(r.rows[0]!.bookingDate?.toISOString().slice(0, 10), '2026-09-10');
  assert.equal(r.rows[1]!.amount, 1299.56);
  assert.equal(r.rows[1]!.counterpartyName, 'ACP RES. LE BOSQUET');
});

test('decodeCsvBuffer : bascule en latin1 quand l’UTF-8 produit des caractères de remplacement', () => {
  const original = 'Numéro d\'extrait à partir de';
  const latin1Buf = Buffer.from(original, 'latin1');
  assert.equal(decodeCsvBuffer(latin1Buf), original);

  const utf8Buf = Buffer.from(original, 'utf8');
  assert.equal(decodeCsvBuffer(utf8Buf), original);
});
