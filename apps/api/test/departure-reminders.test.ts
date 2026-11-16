import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planReminder, reminderText } from '../src/lib/departure-reminders.js';

const at = (hhmm: string) => new Date(`2026-11-17T${hhmm}:00.000Z`);
const base = { start: at('13:30'), departureAt: null, hasPrevious: true };

test('trajet connu : pas de rappel trop tôt', () => {
  assert.equal(planReminder({ ...base, now: at('12:30'), travelMin: 35 }).due, false);
});

test('trajet connu : rappel à (heure − trajet − marge) = 12h45 pour 13h30 avec 35 min', () => {
  const p = planReminder({ ...base, now: at('12:45'), travelMin: 35 });
  assert.equal(p.due, true);
  assert.equal(p.kind, 'leave');
  assert.equal(p.remindAt.toISOString(), '2026-11-17T12:45:00.000Z');
});

test('trajet connu : « risque de retard » quand le trajet ne tient plus dans le temps restant', () => {
  const p = planReminder({ ...base, now: at('12:56'), travelMin: 35 });
  assert.equal(p.due, true);
  assert.equal(p.kind, 'late');
});

test('trajet connu : plus de rappel longtemps après le début', () => {
  assert.equal(planReminder({ ...base, now: at('13:41'), travelMin: 35 }).due, false);
});

test('trajet inconnu : heure de départ du dépôt pour la 1re intervention', () => {
  const departureAt = at('07:30');
  assert.equal(planReminder({ now: at('07:10'), start: at('08:00'), travelMin: null, departureAt, hasPrevious: false }).due, false);
  const p = planReminder({ now: at('07:15'), start: at('08:00'), travelMin: null, departureAt, hasPrevious: false });
  assert.equal(p.due, true);
  assert.equal(p.kind, 'depot');
});

test('trajet inconnu : rappel simple 45 min avant', () => {
  assert.equal(planReminder({ now: at('12:44'), start: at('13:30'), travelMin: null, departureAt: null, hasPrevious: false }).due, false);
  const p = planReminder({ now: at('12:45'), start: at('13:30'), travelMin: null, departureAt: null, hasPrevious: false });
  assert.equal(p.due, true);
  assert.equal(p.kind, 'heads-up');
});

test('trajet inconnu avec chantier précédent : on ignore l’heure du dépôt', () => {
  assert.equal(planReminder({ now: at('07:15'), start: at('08:00'), travelMin: null, departureAt: at('07:30'), hasPrevious: true }).kind, 'heads-up');
});

test('le texte ne contient ni adresse ni client', () => {
  const t = reminderText('leave', '13h30', 35);
  assert.equal(t.title, 'Heure de partir');
  assert.equal(t.body, 'Prochaine intervention à 13h30 : partez maintenant (trajet estimé 35 min).');
});
