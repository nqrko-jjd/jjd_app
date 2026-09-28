/**
 * Recherche, dans le texte des factures d'achat déjà reçues, les références produit déjà
 * enregistrées sur nos articles de stock (StockSupplier.supplierRef) — sert à retrouver la
 * récurrence d'achat d'un article sans dépendre d'un parsing générique des tableaux de factures
 * (mise en page trop hétérogène d'un fournisseur à l'autre : voir document-extract.ts).
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '../db.js';
import { UPLOADS_DIR } from './media.js';
import { pdfToRawText, pdftotextAvailable } from './bank-pdf.js';

function resolveUpload(rel: string): string {
  const clean = rel.replace(/^\/?uploads\//, '').replace(/\\/g, '/');
  return path.join(UPLOADS_DIR, path.normalize(clean));
}

const normRef = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export interface RefCandidate { stockItemId: string; supplierRef: string }

/** Logique pure (testable sans PDF réel) : quelles réf. fournisseur apparaissent dans ce texte de
 *  facture ? Réf. de moins de 3 caractères ignorées — sinon un « 01 » ou un « 3 » matcherait
 *  n'importe où (montant, numéro de page…). */
export function findRefMatches(rawText: string, candidates: RefCandidate[]): RefCandidate[] {
  const text = normRef(rawText);
  return candidates.filter((c) => c.supplierRef.trim().length >= 3 && text.includes(normRef(c.supplierRef)));
}

/** Scanne une facture (déjà en base, avec pièce jointe) pour les réf. fournisseur connues de son contact. */
export async function scanEntryForRefs(entryId: string): Promise<number> {
  const entry = await prisma.ledgerEntry.findUnique({
    where: { id: entryId },
    select: { id: true, contactId: true, pdfPath: true, direction: true },
  });
  if (!entry || entry.direction !== 'purchase' || !entry.contactId || !entry.pdfPath) return 0;
  const file = resolveUpload(entry.pdfPath);
  if (!existsSync(file)) return 0;

  const links = await prisma.stockSupplier.findMany({
    where: { contactId: entry.contactId, supplierRef: { not: null } },
    select: { stockItemId: true, supplierRef: true },
  });
  const candidates: RefCandidate[] = links
    .filter((l): l is { stockItemId: string; supplierRef: string } => !!l.supplierRef)
    .map((l) => ({ stockItemId: l.stockItemId, supplierRef: l.supplierRef }));
  if (!candidates.length) return 0;
  if (!(await pdftotextAvailable())) return 0;

  let text: string;
  try {
    text = await pdfToRawText(await readFile(file));
  } catch {
    return 0;
  }

  const matches = findRefMatches(text, candidates);
  for (const m of matches) {
    await prisma.purchaseRefSighting.upsert({
      where: { ledgerEntryId_stockItemId: { ledgerEntryId: entry.id, stockItemId: m.stockItemId } },
      create: { ledgerEntryId: entry.id, stockItemId: m.stockItemId, supplierRef: m.supplierRef },
      update: {},
    });
  }
  return matches.length;
}

/** Rattrapage : scanne toutes les factures d'achat déjà en base (utile après l'ajout d'une
 *  nouvelle réf. fournisseur sur un article, pour retrouver son historique d'achat passé). */
export async function scanAllEntriesForRefs(): Promise<{ scanned: number; matched: number }> {
  const entries = await prisma.ledgerEntry.findMany({
    where: { direction: 'purchase', pdfPath: { not: null }, contactId: { not: null } },
    select: { id: true },
  });
  let matched = 0;
  for (const e of entries) matched += await scanEntryForRefs(e.id);
  return { scanned: entries.length, matched };
}
