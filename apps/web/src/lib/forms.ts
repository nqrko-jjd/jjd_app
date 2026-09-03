import type { FieldDef } from '@/components/FormModal';
import {
  CLIENT_KIND_LABEL, CLIENT_KINDS, CONTACT_TYPES,
  ROLE_LABEL, WORKER_CONTRACT_LABEL, WORKER_CONTRACT_TYPES,
} from '@jjd/shared';

export const CONTACT_FIELDS: FieldDef[] = [
  { name: 'name', label: 'Nom', required: true, full: true },
  { name: 'type', label: 'Type', type: 'select', options: CONTACT_TYPES.map((t) => ({ value: t, label: t === 'client' ? 'Client' : t === 'supplier' ? 'Fournisseur' : 'Les deux' })) },
  { name: 'kind', label: 'Catégorie', type: 'select', options: CLIENT_KINDS.map((k) => ({ value: k, label: CLIENT_KIND_LABEL[k] })) },
  { name: 'email', label: 'E-mail' },
  { name: 'phone', label: 'Téléphone' },
  { name: 'vat', label: 'N° TVA' },
  { name: 'address', label: 'Adresse', full: true },
  { name: 'postalCode', label: 'Code postal' },
  { name: 'city', label: 'Ville' },
  { name: 'note', label: 'Note', type: 'textarea', full: true },
];

export const PERSON_FIELDS: FieldDef[] = [
  { name: 'firstName', label: 'Prénom', required: true },
  { name: 'lastName', label: 'Nom' },
  { name: 'displayName', label: 'Nom affiché (terrain)', full: true, placeholder: 'nom court utilisé dans le pointage' },
  { name: 'role', label: 'Rôle', type: 'select', options: (['foreman', 'worker'] as const).map((r) => ({ value: r, label: ROLE_LABEL[r] })) },
  { name: 'contractType', label: 'Contrat', type: 'select', options: WORKER_CONTRACT_TYPES.map((c) => ({ value: c, label: WORKER_CONTRACT_LABEL[c] })) },
  { name: 'hourlyRate', label: 'Taux horaire (€)', type: 'number' },
  { name: 'phone', label: 'Téléphone' },
  { name: 'email', label: 'E-mail' },
  { name: 'address', label: 'Adresse', full: true },
  { name: 'languages', label: 'Langues (séparées par des virgules)', type: 'tags', full: true, placeholder: 'fr, nl, pt' },
  { name: 'emergencyContact', label: "Contact d'urgence", full: true },
  { name: 'active', label: 'Statut', type: 'checkbox', placeholder: 'Actif (décocher pour un ancien — les données sont conservées)', full: true },
  { name: 'note', label: 'Note', type: 'textarea', full: true },
];

export const BUILDING_FIELDS: FieldDef[] = [
  { name: 'name', label: "Nom de l'immeuble / ACP", required: true, full: true },
  { name: 'address', label: 'Adresse', full: true },
  { name: 'postalCode', label: 'Code postal' },
  { name: 'city', label: 'Ville' },
  { name: 'note', label: 'Note', type: 'textarea', full: true },
];
