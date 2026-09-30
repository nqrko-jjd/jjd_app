import { z } from 'zod';
export const REQUEST_GOALS = { stop_damage: 'Mesures conservatoires', find_cause: 'Recherche de l’origine', repair: 'Réparation', quote: 'Devis de remise en état', report: 'Rapport d’intervention', moisture: 'Relevés d’humidité', photos: 'Photos après passage' } as const;
export const REQUEST_ROLES = { unknown: 'À confirmer', owner: 'Propriétaire', tenant: 'Locataire', concierge: 'Concierge', manager: 'Gestionnaire', other: 'Autre interlocuteur' } as const;
export const REQUEST_LOCATIONS = { affected: 'Zone touchée', suspected_origin: 'Origine signalée · à vérifier', access: 'Accès nécessaire', other: 'Autre zone' } as const;
export const requestBriefInput = z.object({
  units: z.array(z.object({ label: z.string().trim().min(1).max(160), purpose: z.enum(['affected','suspected_origin','access','other']) })).max(20).default([]),
  contacts: z.array(z.object({ contactId: z.string().nullish(), name: z.string().trim().min(1).max(200), phone: z.string().max(100).default(''), phone2: z.string().max(100).default(''), email: z.string().email().or(z.literal('')).default(''), role: z.enum(['unknown','owner','tenant','concierge','manager','other']).default('unknown'), unitLabel: z.string().max(160).default('') })).max(20).default([]),
  repeated: z.boolean().default(false),
  history: z.string().max(5000).default(''),
  measures: z.string().max(3000).default(''),
  relatedWorksiteId: z.string().nullish(),
  goals: z.array(z.enum(['stop_damage','find_cause','repair','quote','report','moisture','photos'])).max(7).default([]),
  clientReference: z.string().max(160).default(''),
  attachments: z.array(z.object({ url: z.string().max(3000), name: z.string().max(255), mime: z.literal('application/pdf'), token: z.string().max(4000).optional() })).max(8).default([]),
});
export type RequestBrief = z.infer<typeof requestBriefInput>;
