/**
 * Lecture d'un ticket ou d'une facture photographiés : fournisseur, date, montants, TVA, catégorie probable.
 * L'IA ne fait que PROPOSER des valeurs pré-remplies, toujours vérifiables et corrigeables avant l'enregistrement.
 * Réservé à la direction (budget IA de l'assistant) ; sans IA, la saisie reste manuelle.
 */
import { z } from 'zod';
import { prisma } from '../db.js';
import { insensitive } from './search.js';
import type { AuthUser } from './auth.js';
import { aiGenerateJson, type AiImage } from './ai-generate.js';

export const receiptSchema = z.object({
  supplier: z.string().trim().max(120).nullish(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  totalTtc: z.coerce.number().nullish(),
  totalHt: z.coerce.number().nullish(),
  vatRate: z.coerce.number().nullish(),
  docNumber: z.string().trim().max(60).nullish(),
  categoryCode: z.string().trim().max(40).nullish(),
});
export type Receipt = z.infer<typeof receiptSchema>;

const SYSTEM = `Tu lis un ticket de caisse ou une facture photographiés pour une entreprise belge de rénovation (TVA belge : 21 %, 12 %, 6 % ou 0 %).
Réponds UNIQUEMENT par un objet JSON : {"supplier": "nom du magasin ou fournisseur", "date": "AAAA-MM-JJ", "totalTtc": nombre, "totalHt": nombre ou null, "vatRate": 0.21 | 0.12 | 0.06 | 0 ou null, "docNumber": "n° du ticket ou de la facture" ou null, "categoryCode": "code choisi dans la liste fournie" ou null}.
Règles : n'invente rien ; une valeur illisible vaut null ; les montants sont en euros avec un point décimal ; la date est celle du ticket (pas celle d'aujourd'hui) ; totalTtc est le TOTAL À PAYER ; categoryCode doit être EXACTEMENT un des codes de la liste, ou null en cas de doute.`;

/** Valeurs lues → même forme que l'extraction des PDF (voir document-extract.ts), complétée de la TVA et d'un fournisseur reconnu. */
export function receiptToExtraction(r: Receipt) {
  const vatRate = r.vatRate != null && [0, 0.06, 0.12, 0.21].includes(Math.round(r.vatRate * 100) / 100) ? Math.round(r.vatRate * 100) / 100 : null;
  const ttc = r.totalTtc != null && r.totalTtc > 0 ? Math.round(r.totalTtc * 100) / 100 : null;
  const ht = r.totalHt != null && r.totalHt > 0 ? Math.round(r.totalHt * 100) / 100 : ttc != null && vatRate != null ? Math.round((ttc / (1 + vatRate)) * 100) / 100 : null;
  return { supplierName: r.supplier?.trim() || null, issuedOn: r.date ?? null, totalTtc: ttc, totalHt: ht, totalVat: ttc != null && ht != null ? Math.round((ttc - ht) * 100) / 100 : null, vatRate, docNumber: r.docNumber?.trim() || null };
}

export async function readReceipt(user: AuthUser, image: AiImage) {
  const cats = await prisma.category.findMany({ where: { active: true, kind: 'expense' }, select: { code: true, label: true }, orderBy: { label: 'asc' } });
  const res = await aiGenerateJson(user, {
    system: SYSTEM,
    prompt: `Catégories possibles :\n${cats.map((c) => `${c.code} = ${c.label}`).join('\n')}\n\nLis ce document.`,
    schema: receiptSchema, maxOutput: 400, image,
  });
  if (!res.ok) return { ok: false as const, reason: res.reason };
  const extraction = receiptToExtraction(res.data);
  const cat = res.data.categoryCode ? cats.find((c) => c.code === res.data.categoryCode) : null;
  // fournisseur déjà connu : on le retrouve par son nom (et sa catégorie habituelle prime si elle est nette)
  const contact = extraction.supplierName ? await prisma.contact.findFirst({ where: { name: { equals: extraction.supplierName, ...insensitive }, OR: [{ type: 'supplier' }, { type: 'both' }] }, select: { id: true, name: true } }) : null;
  return { ok: true as const, extraction: { ...extraction, contactId: contact?.id ?? null, contactName: contact?.name ?? null }, suggestedCategory: cat ? { code: cat.code, label: cat.label, source: 'ai' as const } : null };
}
