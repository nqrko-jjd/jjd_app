import type { WorksiteStatus } from '@jjd/shared';

/** Les statuts de chantier rangés par étape — pour les menus et listes déroulantes (les données et l'automatisation ne changent pas). */
export const WORKSITE_STATUS_GROUPS: { label: string; statuses: WorksiteStatus[] }[] = [
  { label: 'Avant les travaux', statuses: ['lead', 'quote_needed', 'to_plan', 'scheduled'] },
  { label: 'Travaux', statuses: ['in_progress', 'on_hold'] },
  { label: 'Après les travaux', statuses: ['done', 'to_invoice', 'invoiced', 'closed'] },
  { label: 'Sans suite', statuses: ['refused', 'cancelled'] },
];
