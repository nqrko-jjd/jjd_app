/**
 * Vocabulaire métier JJD Consult, tiré du fichier de rentabilité et de TrustUp.
 * Chaque enum a un helper `label` FR (les traductions NL/EN de l'UI passent par
 * les fichiers de messages, pas ici).
 */

/* ------------------------------------------------------------------ Rôles */

export const ROLES = ['admin', 'office', 'foreman', 'worker', 'client'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrateur',
  office: 'Bureau',
  foreman: 'Chef de chantier',
  worker: 'Ouvrier',
  client: 'Client',
};

/** Accès « interne » (tout sauf le client). */
export const INTERNAL_ROLES: Role[] = ['admin', 'office', 'foreman', 'worker'];

/* ------------------------------------------------------ Entité d'attribution */
/**
 * jjd    = chantier JJD Consult
 * tonton = chantier apporté par GT Light Concept (« Tonton ») → part de 33 %
 * m7     = ancien associé, parti en 2024 — historique seulement
 */
export const ENTITIES = ['jjd', 'tonton', 'm7'] as const;
export type Entity = (typeof ENTITIES)[number];

export const ENTITY_LABEL: Record<Entity, string> = {
  jjd: 'JJD',
  tonton: 'Tonton (GT Light Concept)',
  m7: 'M7 (historique)',
};

/** Part des bénéfices reversée à l'apporteur selon l'entité. */
export const ENTITY_PROFIT_SHARE: Record<Entity, number> = {
  jjd: 0, // partagé 50/50 David & Julien, hors de ce calcul
  tonton: 1 / 3, // 33 % à GT Light Concept
  m7: 0,
};

/* ------------------------------------------------------- Statut de chantier */
/**
 * Cycle de vie interne. Le texte d'origine (souvent composé, ex. « Terminé,
 * A facturer ») est conservé à part dans `statusRaw` + `statusTags`.
 */
export const WORKSITE_STATUSES = [
  'lead', // demande / devis pas encore accepté
  'to_plan', // accepté, à planifier
  'scheduled', // planifié
  'in_progress', // en cours
  'on_hold', // en attente (client, météo, matériel…)
  'done', // terminé sur le terrain
  'to_invoice', // terminé, à facturer
  'invoiced', // facturé
  'closed', // facturé + payé, clôturé
  'cancelled', // abandonné
] as const;
export type WorksiteStatus = (typeof WORKSITE_STATUSES)[number];

export const WORKSITE_STATUS_LABEL: Record<WorksiteStatus, string> = {
  lead: 'Demande',
  to_plan: 'À planifier',
  scheduled: 'Planifié',
  in_progress: 'En cours',
  on_hold: 'En attente',
  done: 'Terminé',
  to_invoice: 'À facturer',
  invoiced: 'Facturé',
  closed: 'Clôturé',
  cancelled: 'Abandonné',
};

export const WORKSITE_STATUS_OPEN: WorksiteStatus[] = [
  'lead', 'to_plan', 'scheduled', 'in_progress', 'on_hold', 'done', 'to_invoice',
];

/** Devine un statut propre à partir du texte libre du fichier Excel / TrustUp. */
export function guessWorksiteStatus(raw: string | null | undefined): WorksiteStatus {
  const s = (raw ?? '').toLowerCase().trim();
  if (!s || s === '/' || s === '-') return 'to_plan';
  if (s.includes('abandon')) return 'cancelled';
  const facture = s.includes('factur');
  const termine = s.includes('termin') || s.includes('fini') || s.includes('clôtur') || s.includes('cloctur');
  if (termine && facture && (s.includes('payé') || s.includes('paye'))) return 'closed';
  if (facture && s.includes('a factur')) return 'to_invoice';
  if (termine && s.includes('a factur')) return 'to_invoice';
  if (facture) return 'invoiced';
  if (termine) return 'done';
  if (s.includes('en cours')) return 'in_progress';
  if (s.includes('planif') || s.includes('rdv') || s.includes('accepté') || s.includes('accepte')) return 'scheduled';
  if (s.includes('devis')) return 'lead';
  if (s.includes('attente')) return 'on_hold';
  return 'to_plan';
}

/** Découpe « Terminé, A vérifier, Relance » -> ['Terminé','A vérifier','Relance']. */
export function parseStatusTags(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(/[,;/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/* ---------------------------------------------------------- Pipeline CRM */

export const CRM_STAGES = [
  'new', // demande reçue (portail, site, téléphone)
  'to_qualify', // à qualifier / rappeler
  'visit_scheduled', // visite technique planifiée
  'quote_sent', // devis envoyé
  'follow_up', // relancé, en attente de réponse
  'won', // gagné -> devient chantier
  'lost', // perdu
] as const;
export type CrmStage = (typeof CRM_STAGES)[number];

export const CRM_STAGE_LABEL: Record<CrmStage, string> = {
  new: 'Nouvelle demande',
  to_qualify: 'À qualifier',
  visit_scheduled: 'Visite planifiée',
  quote_sent: 'Devis envoyé',
  follow_up: 'Relancé',
  won: 'Gagné',
  lost: 'Perdu',
};

export const CRM_LOST_REASONS = [
  'prix', 'delai', 'sans_reponse', 'concurrent', 'projet_annule', 'hors_zone', 'autre',
] as const;
export type CrmLostReason = (typeof CRM_LOST_REASONS)[number];

export const CRM_LOST_REASON_LABEL: Record<CrmLostReason, string> = {
  prix: 'Prix',
  delai: 'Délai',
  sans_reponse: 'Sans réponse',
  concurrent: 'Parti à la concurrence',
  projet_annule: 'Projet annulé',
  hors_zone: 'Hors zone',
  autre: 'Autre',
};

/* ---------------------------------------------------- Contacts & fournisseurs */

export const CONTACT_TYPES = ['client', 'supplier', 'both'] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export const CLIENT_KINDS = ['individual', 'company', 'acp', 'syndic', 'public'] as const;
export type ClientKind = (typeof CLIENT_KINDS)[number];

export const CLIENT_KIND_LABEL: Record<ClientKind, string> = {
  individual: 'Particulier',
  company: 'Société',
  acp: 'ACP / Copropriété',
  syndic: 'Syndic',
  public: 'Pouvoir public',
};

/* --------------------------------------------------------- Devis / Factures */

export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'declined', 'expired'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'partial', 'overdue', 'credited'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const DOC_KINDS = ['quote', 'invoice', 'credit_note', 'deposit_invoice'] as const;
export type DocKind = (typeof DOC_KINDS)[number];

/* ------------------------------------------------------------- Pointage */

export const TIME_ENTRY_STATUSES = ['running', 'submitted', 'approved', 'rejected'] as const;
export type TimeEntryStatus = (typeof TIME_ENTRY_STATUSES)[number];

export const WORKER_CONTRACT_TYPES = ['employee', 'subcontractor', 'interim'] as const;
export type WorkerContractType = (typeof WORKER_CONTRACT_TYPES)[number];

export const WORKER_CONTRACT_LABEL: Record<WorkerContractType, string> = {
  employee: 'Salarié',
  subcontractor: 'Sous-traitant',
  interim: 'Intérim',
};

/** Types de documents légaux suivis sur une fiche personne (avec échéance). */
export const LEGAL_DOC_TYPES = [
  'id_card', 'work_permit', 'a1', 'limosa', 'vca', 'driving_license', 'medical', 'contract', 'other',
] as const;
export type LegalDocType = (typeof LEGAL_DOC_TYPES)[number];

export const LEGAL_DOC_LABEL: Record<LegalDocType, string> = {
  id_card: "Carte d'identité",
  work_permit: 'Permis de travail',
  a1: 'Document A1',
  limosa: 'Déclaration Limosa',
  vca: 'VCA / sécurité',
  driving_license: 'Permis de conduire',
  medical: 'Visite médicale',
  contract: 'Contrat',
  other: 'Autre',
};

/** Rôles d'un contact rattaché à un immeuble / ACP. */
export const BUILDING_CONTACT_ROLES = [
  'concierge', 'president', 'council', 'syndic_manager', 'contact', 'owner_rep', 'other',
] as const;
export type BuildingContactRole = (typeof BUILDING_CONTACT_ROLES)[number];

export const BUILDING_CONTACT_ROLE_LABEL: Record<BuildingContactRole, string> = {
  concierge: 'Concierge',
  president: "Président d'assemblée",
  council: 'Membre du conseil',
  syndic_manager: 'Gestionnaire syndic',
  contact: 'Contact',
  owner_rep: 'Représentant des copropriétaires',
  other: 'Autre',
};

export const OCCUPANT_KINDS = ['owner', 'tenant', 'unknown'] as const;
export type OccupantKind = (typeof OCCUPANT_KINDS)[number];

export const OCCUPANT_KIND_LABEL: Record<OccupantKind, string> = {
  owner: 'Propriétaire',
  tenant: 'Locataire',
  unknown: 'Inconnu',
};

/* --------------------------------------------------------- Compta / TVA */

export const CATEGORY_KINDS = ['revenue', 'expense', 'salary', 'vat', 'tax', 'credit_note', 'internal'] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const DOC_DIRECTIONS = ['sale', 'purchase', 'credit_note'] as const;
export type DocDirection = (typeof DOC_DIRECTIONS)[number];
