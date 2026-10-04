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

test('export Belfius officiel : le libellé est la colonne « Transaction », pas « Numéro de transaction »', () => {
  const csv = [
    'Date de comptabilisation à partir de;18/09/2026',
    "Date de comptabilisation jusqu'au;05/10/2026",
    '',
    "Compte;Date de comptabilisation;Numéro d'extrait;Numéro de transaction;Compte contrepartie;Nom contrepartie contient;Rue et numéro;Code postal et ville;Transaction;Date valeur;Montant;Devise;BIC;Code pays;Communications",
    'BE31 0689 4940 0055;05/10/2026;;;BE93 9679 5593 5467;Venilson Heleno Gabriel;;;VIREMENT INSTANTANE BELFIUS MOBILE VERS   BE93 9679 5593 5467 Venilson Heleno Gabriel   Astire01fr/26   REF. : 09054033A3547 VAL. 03-10;03/10/2026;-2875,00;EUR;TRWIBEB1;;Astire01fr/26',
  ].join('\n');
  const r = parseBankCsv(csv);
  assert.equal(r.rows.length, 1);
  const row = r.rows[0]!;
  assert.match(row.description ?? '', /REF\. : 09054033A3547 VAL\. 03-10/);
  assert.equal(row.counterpartyAccount, 'BE93 9679 5593 5467');
  assert.equal(row.counterpartyName, 'Venilson Heleno Gabriel');
  assert.equal(row.communication, 'Astire01fr/26');
  assert.equal(row.amount, -2875);
  assert.equal(row.bookingDate?.toISOString().slice(0, 10), '2026-10-05');
});

test('export ING : le libellé est la colonne « Libellés » (I), pas « Détails du mouvement »', () => {
  const csv = [
    'Numéro de compte;Nom du compte;Compte contrepartie;Numéro de mouvement;Date comptable;Date valeur;Montant;Devise;Libellés;Détails du mouvement;Message',
    'BE64363254694152;JJD CONSULT SRL;BE29433117044164;976;21/09/2026;21/09/2026;625,00;EUR;Instantoverschrijving in euro Van: BAITA VZW - BE29433117044164 Instant op 21/09 - 11:09:03 Mededeling: DEVIS D2026-280 DE 31/07/2026;;',
  ].join('\n');
  const row = parseBankCsv(csv).rows[0]!;
  assert.match(row.description ?? '', /BAITA VZW.*DEVIS D2026-280/);
  assert.equal(row.counterpartyAccount, 'BE29433117044164');
  assert.equal(row.amount, 625);
  assert.equal(row.bookingDate?.toISOString().slice(0, 10), '2026-09-21');
});

test('ING : deux opérations identiques le même jour gardent deux identifiants stables (rien n’est perdu, ré-import idempotent)', () => {
  const head = 'Numéro de compte;Nom du compte;Compte contrepartie;Numéro de mouvement;Date comptable;Date valeur;Montant;Devise;Libellés;Détails du mouvement;Message';
  const line = (n: number) => `BE64363254694152;JJD CONSULT SRL;BE24310160025838;${n};07/04/2026;07/04/2026;-560,90;EUR;Domiciliëring in euro (SEPA) ING Equipment Lease Belgium Bericht als bijlage;DEBET VOOR EEN DOMICILIERING;`;
  const csv = [head, line(408), line(409), 'BE64363254694152;JJD CONSULT SRL;;410;08/04/2026;08/04/2026;-37,00;EUR;Betaling Bancontact PARKING BRUSSEL;;'].join('\n');
  const a = parseBankCsv(csv).rows, b = parseBankCsv(csv).rows;
  assert.equal(a.length, 3);
  assert.equal(new Set(a.map((r) => r.externalId)).size, 3);
  assert.deepEqual(a.map((r) => r.externalId), b.map((r) => r.externalId));
  // un fichier qui recoupe le précédent (même jour) redonne les mêmes identifiants
  const overlap = parseBankCsv([head, line(0), line(1)].join('\n')).rows.map((r) => r.externalId);
  assert.deepEqual(overlap, a.slice(0, 2).map((r) => r.externalId));
});
