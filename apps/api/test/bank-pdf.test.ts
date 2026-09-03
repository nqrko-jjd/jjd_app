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
