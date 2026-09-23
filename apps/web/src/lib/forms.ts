import type { FieldDef } from '@/components/FormModal';
import { api } from '@/lib/api';
import {
  CLIENT_KIND_LABEL, CLIENT_KINDS, CONTACT_TYPES,
  PERSON_ROLE_LABEL, PERSON_ROLES, WORKER_CONTRACT_LABEL, WORKER_CONTRACT_TYPES,
  LEGAL_DOC_LABEL, LEGAL_DOC_TYPES, VEHICLE_DOC_LABEL, VEHICLE_DOC_TYPES,
} from '@jjd/shared';

interface VatLookupResult { vatNumber: string; name: string | null; address: string | null; postalCode: string | null; city: string | null }

/** Cherche l'entreprise sur VIES (gratuit, officiel UE) à partir du n° de TVA saisi et
 *  préremplit nom/adresse — seules les infos trouvées sont écrasées. */
async function vatLookupAction(value: string): Promise<Record<string, unknown>> {
  const r = await api<VatLookupResult>(`/api/contacts/vat-lookup?vat=${encodeURIComponent(value)}`);
  const patch: Record<string, unknown> = { vat: r.vatNumber };
  if (r.name) patch.name = r.name;
  if (r.address) patch.address = r.address;
  if (r.postalCode) patch.postalCode = r.postalCode;
  if (r.city) patch.city = r.city;
  return patch;
}

/** « Jean-Pierre Dupont » -> { firstName: 'Jean-Pierre', lastName: 'Dupont' } — heuristique
 *  simple (1er mot = prénom) pour préremplir Prénom/Nom en édition à partir du nom existant ;
 *  imprécis pour les noms composés, mais les deux champs restent librement modifiables. */
export function splitContactName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return { firstName: name.trim(), lastName: '' };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(' ') };
}

/** Pour un contact « Particulier », le formulaire affiche Prénom/Nom séparément (cf.
 *  CONTACT_FIELDS) mais l'API attend un seul champ `name` — recompose avant l'appel. Sans
 *  effet si le formulaire affichait déjà un seul champ Nom (autres catégories). */
export function composeContactPayload(v: Record<string, unknown>): Record<string, unknown> {
  if (!v.firstName && !v.lastName) return v;
  const { firstName, lastName, ...rest } = v;
  return { ...rest, name: [firstName, lastName].filter(Boolean).join(' ').trim() };
}

/**
 * Champs différents selon le type de contact (`forType`, le type au moment où le formulaire
 * s'ouvre — un client a une « Catégorie », un fournisseur non ; les personnes de contact et
 * l'historique d'achats d'un fournisseur sont gérés à part sur sa fiche, pas dans ce formulaire)
 * ET selon la « Catégorie » (`kind`) choisie en direct dans le formulaire : un particulier a
 * Prénom/Nom séparés (cf. `composeContactPayload`, à appeler dans `onSubmit`) plutôt qu'un
 * seul champ Nom ; une ACP/Promoteur EST son propre immeuble/projet (fusion Contact/Immeuble —
 * digicode, lots, contacts clés directement sur cette fiche, cf. `app/immeubles`) ; le Syndic
 * (adresse de facturation « c/o ») reste propre aux ACP, un promoteur n'en a pas. Le n° de TVA
 * disparaît pour un particulier. Le lien "rattaché à une ACP" (un résident/propriétaire lié à
 * SON immeuble) reste possible via `buildingId` pour les autres catégories (individual/company).
 */
export const CONTACT_FIELDS = (
  forType?: string,
  syndics: { id: string; name: string }[] = [],
) => {
  const isSupplierOnly = forType === 'supplier';
  return (values: Record<string, unknown>): FieldDef[] => {
    const kind = (values.kind as string) || (isSupplierOnly ? undefined : 'individual');
    const isIndividual = !isSupplierOnly && kind === 'individual';
    const isAcp = !isSupplierOnly && kind === 'acp';
    const isDeveloper = !isSupplierOnly && kind === 'developer';
    const isAcpOrDeveloper = isAcp || isDeveloper;
    const showVat = isSupplierOnly || kind !== 'individual';
    return [
      { name: 'type', label: 'Type', type: 'select', options: CONTACT_TYPES.map((t) => ({ value: t, label: t === 'client' ? 'Client' : t === 'supplier' ? 'Fournisseur' : 'Les deux' })) },
      ...(!isSupplierOnly ? [{ name: 'kind', label: 'Catégorie', type: 'select' as const, options: CLIENT_KINDS.map((k) => ({ value: k, label: CLIENT_KIND_LABEL[k] })) }] : []),
      ...(isIndividual ? [
        { name: 'firstName', label: 'Prénom', required: true },
        { name: 'lastName', label: 'Nom' },
      ] : [{ name: 'name', label: 'Nom', required: true, full: true }]),
      ...(isAcp ? [{ name: 'syndicId', label: 'Syndic (adresse de facturation "c/o")', type: 'select' as const, options: syndics.map((s) => ({ value: s.id, label: s.name })) }] : []),
      ...(!isAcpOrDeveloper ? [{ name: 'buildingId', label: 'Immeuble / ACP rattaché(e)', type: 'contact' as const, contactKindFilter: ['acp', 'developer'], placeholder: 'Nom de l’immeuble / ACP…', full: true }] : []),
      { name: 'email', label: 'E-mail' },
      { name: 'phone', label: 'Téléphone' },
      ...(showVat ? [{ name: 'vat', label: 'N° TVA', placeholder: 'BE0123456789', action: { label: 'Rechercher', run: vatLookupAction } }] : []),
      { name: 'address', label: 'Adresse', full: true, type: 'address' as const, addressFill: { postalCode: 'postalCode', city: 'city' } },
      ...(isAcpOrDeveloper ? [
        { name: 'reference', label: 'Référence dossier (syndic / ACP)' },
        { name: 'lotCount', label: 'Nombre de lots', type: 'number' as const },
        { name: 'digicode', label: 'Digicode' },
        { name: 'accessNote', label: 'Accès (clés, badges, parking…)', type: 'textarea' as const, full: true },
      ] : []),
      { name: 'postalCode', label: 'Code postal' },
      { name: 'city', label: 'Ville' },
      { name: 'note', label: 'Note', type: 'textarea', full: true },
    ];
  };
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
  { name: 'address', label: 'Adresse', full: true, type: 'address' },
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

export const VEHICLE_DOC_FIELDS: FieldDef[] = [
  { name: 'type', label: 'Type', type: 'select', required: true, options: VEHICLE_DOC_TYPES.map((t) => ({ value: t, label: VEHICLE_DOC_LABEL[t] })) },
  { name: 'label', label: 'Libellé (optionnel)', placeholder: 'ex. Assurance omnium' },
  { name: 'number', label: 'Numéro' },
  { name: 'issuedOn', label: 'Délivré le', type: 'date' },
  { name: 'expiresOn', label: 'Expire le', type: 'date' },
];

/** Un immeuble/ACP/projet EST directement un Contact (fusion Contact/Immeuble) — ce formulaire
 *  crée/édite ce même Contact, juste avec les champs pertinents pour "le dossier immeuble"
 *  (pas de champ "client facturé" séparé : c'est cette fiche elle-même). */
export const BUILDING_FIELDS = (syndics: { id: string; name: string }[] = []): FieldDef[] => [
  { name: 'name', label: "Nom de l'immeuble / ACP / projet", required: true, full: true },
  { name: 'kind', label: 'Catégorie', type: 'select', options: [{ value: 'acp', label: 'ACP / Copropriété' }, { value: 'developer', label: 'Promoteur' }] },
  { name: 'syndicId', label: 'Syndic (si ACP)', type: 'select', options: syndics.map((s) => ({ value: s.id, label: s.name })) },
  { name: 'address', label: 'Adresse', full: true, type: 'address', addressFill: { postalCode: 'postalCode', city: 'city' } },
  { name: 'postalCode', label: 'Code postal' },
  { name: 'city', label: 'Ville' },
  { name: 'reference', label: 'Référence dossier (syndic / ACP)' },
  { name: 'lotCount', label: 'Nombre de lots', type: 'number' },
  { name: 'digicode', label: 'Digicode' },
  { name: 'accessNote', label: 'Accès (clés, badges, parking…)', type: 'textarea', full: true },
  { name: 'note', label: 'Note', type: 'textarea', full: true },
];
