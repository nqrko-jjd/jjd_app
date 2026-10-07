import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workforceCategory, isFieldWorker, PERSON_ROLES, PERSON_ROLE_LABEL } from '../src/index.js';

test('catégories du personnel : seuls les ouvriers comptent dans l’effectif terrain', () => {
  assert.equal(workforceCategory({ role: 'worker', contractType: 'employee' }), 'ouvrier');
  assert.equal(workforceCategory({ role: 'foreman', contractType: 'employee' }), 'ouvrier');
  assert.equal(workforceCategory({ role: 'qualified_worker', contractType: 'interim' }), 'ouvrier');
  assert.equal(workforceCategory({ role: 'worker', contractType: 'subcontractor' }), 'sous_traitant');
  assert.equal(workforceCategory({ role: 'manager', contractType: 'employee' }), 'gestionnaire');
  assert.equal(workforceCategory({ role: 'office', contractType: 'employee' }), 'bureau');
  // le rôle prime sur le contrat : un gestionnaire ou le bureau n'est jamais compté comme sous-traitant
  assert.equal(workforceCategory({ role: 'manager', contractType: 'subcontractor' }), 'gestionnaire');
  assert.deepEqual(
    [{ role: 'worker' }, { role: 'worker', contractType: 'subcontractor' }, { role: 'manager' }, { role: 'office' }].map(isFieldWorker),
    [true, false, false, false],
  );
});

test('le rôle « gestionnaire de chantier » est proposé dans les formulaires', () => {
  assert.ok(PERSON_ROLES.includes('manager'));
  assert.equal(PERSON_ROLE_LABEL.manager, 'Gestionnaire de chantier');
});
