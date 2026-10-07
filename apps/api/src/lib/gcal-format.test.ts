import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeGcalEvent, joinNames, type GcalEventSource } from './gcal-format.js';

const base: GcalEventSource = {
  kind: 'intervention', title: 'App 2.2 - Silicone douche + plinthes', allDay: false,
  meetingOnSite: true, meetingAddress: null, meetingBox: null, meetingPostalCode: null, meetingCity: null,
  tasksNote: 'SAV salle de douche :\n- Dépose de l’ancien joint silicone entre tub de douche et faïence\nNettoyage complet du support\n• Fourniture et pose d’une nouvelle plinthe',
  accessNote: 'Appartement 2.2 – Résidence Condor –',
  materialsNote: 'pistolet à cartouche, petit matériel de finition',
  note: 'RDV pris mais client pas dispo\nContact sur place : Javier Demolder',
  departureAt: null, departureFrom: null,
  worksite: { ref: 'R-654', title: 'Wavre - Matexi - Condor', address: 'Avenue René Magritte 4', box: null, postalCode: '1300', city: 'Wavre', manager: { displayName: null, firstName: 'Julien' }, acp: null },
  team: null,
  vehicles: [{ vehicle: { plate: null, model: 'Peugeot', brand: null, code: null }, driver: null }],
  assignments: [{ person: { displayName: 'Eduardo', firstName: 'Eduardo' } }, { person: { displayName: null, firstName: 'Coco' } }],
  equipment: [{ equipment: { name: 'Cutter' } }, { equipment: { name: 'Grattoir joint' } }],
  consumables: [{ qty: 2, consumable: { name: 'Silicone', unit: 'cartouche' } }],
};

test('joinNames : « A, B et C »', () => {
  assert.equal(joinNames(['Eduardo', 'Coco']), 'Eduardo et Coco');
  assert.equal(joinNames(['A', 'B', 'C']), 'A, B et C');
  assert.equal(joinNames(['A']), 'A');
  assert.equal(joinNames([]), '');
});

test('fiche Google Agenda : titre complet et blocs avec icônes, comme les anciennes fiches', () => {
  const r = composeGcalEvent(base);
  assert.equal(r.summary, 'R-654 - Wavre - Matexi - Condor - App 2.2 - Silicone douche + plinthes');
  assert.equal(r.location, 'Avenue René Magritte 4, 1300 Wavre');
  assert.equal(r.description, [
    '🏢 Accès / Étage : Appartement 2.2 – Résidence Condor –',
    '📞 Contact sur place : RDV pris mais client pas dispo\nJavier Demolder',
    '🛠 Mission :\n– SAV salle de douche :\n– Dépose de l’ancien joint silicone entre tub de douche et faïence\n– Nettoyage complet du support\n– Fourniture et pose d’une nouvelle plinthe',
    '👥 Ouvriers : Eduardo et Coco',
    '🔧 Matériel : Cutter, Grattoir joint, Silicone (2 cartouche), pistolet à cartouche, petit matériel de finition',
    '🚐 Véhicule : Peugeot',
    '👤 Gestionnaire : Julien',
  ].join('\n\n'));
});

test('titre : pas de doublon quand le titre du créneau est déjà dans celui du chantier ; RDV préfixé', () => {
  assert.equal(composeGcalEvent({ ...base, title: 'Wavre - Matexi' }).summary, 'R-654 - Wavre - Matexi - Condor');
  assert.equal(composeGcalEvent({ ...base, title: null }).summary, 'R-654 - Wavre - Matexi - Condor');
  assert.match(composeGcalEvent({ ...base, kind: 'meeting', title: 'Visite architecte' }).summary, /^RDV - Wavre/);
});

test('blocs vides absents : un créneau sans détail ne produit pas de lignes vides ni d’icônes seules', () => {
  const r = composeGcalEvent({ ...base, tasksNote: null, accessNote: null, materialsNote: null, note: null, assignments: [], equipment: [], consumables: [], vehicles: [], worksite: { ...base.worksite, manager: null } });
  assert.equal(r.description, '');
});

test('contact sur place : champ du formulaire recopié ; à défaut les contacts du chantier ; RDV = « Avec »', () => {
  const noNote = { ...base, note: null, worksite: { ...base.worksite, contacts: [{ role: 'proprietaire', name: 'Mme Dupont', phone: '0470 11 22 33' }, { role: 'sur_place', name: 'Javier Demolder', phone: null }] } };
  assert.match(composeGcalEvent(noNote).description, /📞 Contact sur place : Javier Demolder \/ Mme Dupont – 0470 11 22 33/);
  assert.match(composeGcalEvent({ ...base, note: 'Contact sur place : M. Martin 0475 00 00 00' }).description, /📞 Contact sur place : M\. Martin 0475 00 00 00/);
  assert.match(composeGcalEvent({ ...base, kind: 'meeting', note: 'Architecte Vanderlinden' }).description, /🤝 Avec : Architecte Vanderlinden/);
});

test('couleur Google : rendez-vous en jaune (id 5), intervention sans couleur (celle de l’agenda)', () => {
  assert.equal(composeGcalEvent({ ...base, kind: 'meeting' }).colorId, '5');
  assert.equal(composeGcalEvent(base).colorId, undefined);
});

test('RDV hors chantier : sa propre adresse ; départ affiché en heure de Bruxelles', () => {
  const r = composeGcalEvent({ ...base, kind: 'meeting', meetingOnSite: false, meetingAddress: 'Rue Royale 1', meetingPostalCode: '1000', meetingCity: 'Bruxelles', departureAt: new Date('2026-02-12T06:30:00Z'), departureFrom: 'Dépôt' });
  assert.equal(r.location, 'Rue Royale 1, 1000 Bruxelles');
  assert.match(r.description, /🕗 Départ : 07h30 · Dépôt/);
});

test('une seule fiche par chantier et par jour : créneaux fusionnés, détail AM / PM dans la description', async () => {
  const { composeGcalGroup } = await import('./gcal-format.js');
  const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 7, h - 2, m)); // heure de Bruxelles (UTC+2 en octobre)
  const person = (n: string) => ({ person: { displayName: n, firstName: n } });
  const journee = { ...base, title: null, startAt: at(8, 30), endAt: at(17), tasksNote: 'Pose des pavés', assignments: [person('Eduardo'), person('Patrick')], note: null };
  const matin = { ...base, title: null, startAt: at(8, 30), endAt: at(12, 30), tasksNote: 'Pose des pavés', assignments: [person('Aitor')], note: null };
  const aprem = { ...base, title: null, startAt: at(12, 30), endAt: at(17), tasksNote: 'Passage tuyaux', assignments: [person('Coco'), person('Rom')], note: null };
  const r = composeGcalGroup([aprem, journee, matin]);
  assert.equal(r.summary, 'R-654 - Wavre - Matexi - Condor');
  assert.equal(r.start.getTime(), at(8, 30).getTime());
  assert.equal(r.end.getTime(), at(17).getTime());
  assert.match(r.description, /👥 Ouvriers :\n– Eduardo et Patrick\n– Aitor \(AM\)\n– Coco et Rom \(PM\)/);
  assert.match(r.description, /🛠 Mission :\n(– Pose des pavés\n– Passage tuyaux|– Pose des pavés\nPM : – Passage tuyaux|[^]*Passage tuyaux)/);
  // un seul créneau : fiche identique à composeGcalEvent
  const one = composeGcalGroup([journee]);
  assert.equal(one.description, composeGcalEvent(journee).description);
  // deux équipes sur le même horaire : pas d'étiquette AM/PM
  const same = composeGcalGroup([journee, { ...journee, assignments: [person('Coco')] }]);
  assert.match(same.description, /👥 Ouvriers :\n– Eduardo et Patrick\n– Coco$/m);
});
