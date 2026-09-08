import type { FieldDef } from '@/components/FormModal';
import {
  CLIENT_KIND_LABEL, CLIENT_KINDS, CONTACT_TYPES,
  PERSON_ROLE_LABEL, PERSON_ROLES, WORKER_CONTRACT_LABEL, WORKER_CONTRACT_TYPES,
  LEGAL_DOC_LABEL, LEGAL_DOC_TYPES,
} from '@jjd/shared';

/**
 * Champs différents selon le type de contact (`forType`, le type au moment où le formulaire
 * s'ouvre — un client a une « Catégorie » et un immeuble/ACP éventuel, un fournisseur non ;
 * les personnes de contact et l'historique d'achats d'un fournisseur sont gérés à part sur sa
 * fiche, pas dans ce formulaire). Si le type change pendant l'édition, les champs affichés ne
 * se recalculent pas en direct — acceptable, le type change rarement après coup.
 */
export const CONTACT_FIELDS = (forType?: string, buildings: { id: string; name: string }[] = []): FieldDef[] => {
  const isSupplierOnly = forType === 'supplier';
  return [
    { name: 'name', label: 'Nom', required: true, full: true },
    { name: 'type', label: 'Type', type: 'select', options: CONTACT_TYPES.map((t) => ({ value: t, label: t === 'client' ? 'Client' : t === 'supplier' ? 'Fournisseur' : 'Les deux' })) },
    ...(!isSupplierOnly ? [{ name: 'kind', label: 'Catégorie', type: 'select' as const, options: CLIENT_KINDS.map((k) => ({ value: k, label: CLIENT_KIND_LABEL[k] })) }] : []),
    ...(!isSupplierOnly ? [{ name: 'buildingId', label: 'Immeuble / ACP', type: 'select' as const, options: buildings.map((b) => ({ value: b.id, label: b.name })), full: true }] : []),
    { name: 'email', label: 'E-mail' },
    { name: 'phone', label: 'Téléphone' },
    { name: 'vat', label: 'N° TVA' },
    { name: 'address', label: 'Adresse', full: true },
    { name: 'postalCode', label: 'Code postal' },
    { name: 'city', label: 'Ville' },
    { name: 'note', label: 'Note', type: 'textarea', full: true },
  ];
};

export const PERSON_FIELDS: FieldDef[] = [
  { name: 'firstName', label: 'Prénom', required: true },
  { name: 'lastName', label: 'Nom' },
  { name: 'displayName', label: 'Nom affiché (terrain)', full: true, placeholder: 'nom court utilisé dans le pointage' },
  { name: 'role', label: 'Rôle', type: 'select', options: PERSON_ROLES.map((r) => ({ value: r, label: PERSON_ROLE_LABEL[r] })) },
  { name: 'specialties', label: 'Spécialités (séparées par des virgules)', type: 'tags', full: true, placeholder: 'maçon, carreleur, électricien…' },
  { name: 'contractType', label: 'Contrat', type: 'select', options: WORKER_CONTRACT_TYPES.map((c) => ({ value: c, label: WORKER_CONTRACT_LABEL[c] })) },
  { name: 'hourlyRate', label: 'Taux horaire (€)', type: 'number' },
  { name: 'dailyHours', label: 'Heures payées par jour presté', type: 'number', placeholder: '10' },
  { name: 'phone', label: 'Téléphone' },
  { name: 'email', label: 'E-mail' },
  { name: 'address', label: 'Adresse', full: true },
  { name: 'languages', label: 'Langues (séparées par des virgules)', type: 'tags', full: true, placeholder: 'fr, nl, pt' },
  { name: 'emergencyContact', label: "Contact d'urgence", full: true },
  { name: 'active', label: 'Statut', type: 'checkbox', placeholder: 'Actif (décocher pour un ancien — les données sont conservées)', full: true },
  { name: 'note', label: 'Note', type: 'textarea', full: true },
];

export const LEGAL_DOC_FIELDS: FieldDef[] = [
  { name: 'type', label: 'Type', type: 'select', required: true, options: LEGAL_DOC_TYPES.map((t) => ({ value: t, label: LEGAL_DOC_LABEL[t] })) },
  { name: 'label', label: 'Libellé (optionnel)', placeholder: 'ex. VCA de base' },
  { name: 'number', label: 'Numéro' },
  { name: 'issuedOn', label: 'Délivré le', type: 'date' },
  { name: 'expiresOn', label: 'Expire le', type: 'date' },
];

export const BUILDING_FIELDS: FieldDef[] = [
  { name: 'name', label: "Nom de l'immeuble / ACP", required: true, full: true },
  { name: 'address', label: 'Adresse', full: true },
  { name: 'postalCode', label: 'Code postal' },
  { name: 'city', label: 'Ville' },
  { name: 'note', label: 'Note', type: 'textarea', full: true },
];
