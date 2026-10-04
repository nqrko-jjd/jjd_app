import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCardStatement } from '../src/lib/bank-pdf.js';

// Sortie réelle de `pdftotext -raw` sur un « État des dépenses » Belfius.
const RAW = `Belfius Banque SA
Date de clôture 13/08/2026
Transactions du 14/07/2026 au 13/08/2026
ETAT DES DÉPENSES
Titulaire de la carte
David Scott
JJD CONSULT CARTE 2
Référence client 7771574410
Chargements & Déchargements - Numéro de carte 4569 58XX XXXX 8307 - David Scott
DESCRIPTION MONTANT
15/07 15/07 Votre chargement 100,00 EUR+
04/08 04/08 Votre chargement 400,00 EUR+
Transactions - Numéro de carte 4569 58XX XXXX 8307 - David Scott
DESCRIPTION MONTANT
13/07 14/07 LOXAM DROGENBOS Drogenbos BE 350,00 EUR -
13/07 14/07 Facq Anderlecht Bruxelles BE 70,23 EUR -
15/07 16/07 BRICO 3444 UCCLE ST-JOB UCCLE BE 20,96 EUR -
04/08 05/08 IKEA ZAVENTEM-STORE ZAVENTEM BE 427,99 EUR -
12/08 13/08 BRICO MATERIAUX BRUXELLES BE 53,51 EUR -
Total des dépenses au 13/08/2026 1.233,71 EUR -
Page : 2-2`;

test('parseCardStatement : n’extrait que la section Transactions', () => {
  const st = parseCardStatement(RAW);
  assert.equal(st.cardRef, '7771574410');
  assert.equal(st.period, '14/07/2026 au 13/08/2026');
  assert.equal(st.total, -1233.71);
  assert.equal(st.rows.length, 5, 'chargements exclus');

  const loxam = st.rows[0]!;
  assert.equal(loxam.amount, -350);
  assert.equal(loxam.counterpartyName, 'LOXAM DROGENBOS Drogenbos');
  assert.equal(loxam.bookingDate?.toISOString().slice(0, 10), '2026-07-14'); // date de comptabilisation
});

test('parseCardStatement : dates DD/MM + année du relevé', () => {
  const st = parseCardStatement(RAW);
  assert.equal(st.rows[0]!.bookingDate?.toISOString().slice(0, 10), '2026-07-14');
  assert.equal(st.rows[3]!.counterpartyName, 'IKEA ZAVENTEM-STORE ZAVENTEM');
  assert.equal(st.rows[3]!.amount, -427.99);
});

test('parseCardStatement : externalId stable (ré-import idempotent)', () => {
  const a = parseCardStatement(RAW).rows[0]!.externalId;
  const b = parseCardStatement(RAW).rows[0]!.externalId;
  assert.equal(a, b);
  assert.ok(a.startsWith('pdf-'));
});

import { parseVisaStatement } from '../src/lib/bank-pdf.js';

test('parseVisaStatement : carte prépayée avec chargements, achats et total qui concorde', () => {
  const text = [
    'Date de clôture 13/03/2025', 'Transactions du 14/02/2025 au 13/03/2025', 'ETAT DES DÉPENSES', 'Référence client 7771574436',
    'Chargements & Déchargements - Numéro de carte 4569 58XX XXXX 8820 - David Scott',
    'DATE CHARGEMENT', '19/02 19/02 Votre chargement 250,00 EUR+', '25/02 25/02 Votre chargement 350,00 EUR+',
    'Transactions - Numéro de carte 4569 58XX XXXX 8820 - David Scott',
    '18/02 19/02 CARON BRUXELLES BE 46,60 EUR -', '19/02 20/02 BRICO MATERIAUX BRUXELLES BE 59,52 EUR -', '19/02 20/02 BRICO MATERIAUX BRUXELLES BE 59,52 EUR -',
    'Total des dépenses au 13/03/2025 165,64 EUR -',
  ].join('\n');
  const s = parseVisaStatement(text);
  assert.equal(s.cardLast4, '8820');
  assert.equal(s.clientRef, '7771574436');
  assert.equal(s.closeDate?.toISOString().slice(0, 10), '2025-03-13');
  assert.equal(s.loads.length, 2);
  assert.equal(s.loads[0]!.amount, 250);
  assert.equal(s.purchases.length, 3);
  assert.equal(s.sumPurchases, 165.64);
  assert.equal(s.total, 165.64);
  assert.equal(new Set(s.purchases.map((p) => p.externalId)).size, 3); // les deux achats identiques gardent chacun leur identifiant
  assert.equal(s.purchases[0]!.bookingDate?.toISOString().slice(0, 10), '2025-02-19');
});

test('parseVisaStatement : carte à débit différé, date de débit et complément « (Via …) »', () => {
  const text = [
    'Date de clôture 25/01/2025', 'Date de débit 03/02/2025', 'Transactions du 26/12/2024 au 25/01/2025', 'Référence client 7701909272',
    'Transactions - Numéro de carte 4569 59XX XXXX 4960 - David Scott',
    '28/12 28/12 OBAT FRANCE NANTES FR 109,00 EUR -', '(Via OBAT FRANCE)', '22/01 23/01 SIXT9515801944 BRUESSEL BE 1.618,98 EUR -',
    'Total 1.727,98 EUR -',
  ].join('\n');
  const s = parseVisaStatement(text);
  assert.equal(s.cardLast4, '4960');
  assert.equal(s.debitDate?.toISOString().slice(0, 10), '2025-02-03');
  assert.equal(s.purchases[0]!.description, 'OBAT FRANCE NANTES FR (Via OBAT FRANCE)');
  assert.equal(s.purchases[0]!.bookingDate?.toISOString().slice(0, 10), '2024-12-28'); // passage d'année
  assert.equal(s.sumPurchases, 1727.98);
  assert.equal(s.total, 1727.98);
});
