/**
 * Repère les articles achetés souvent mais pas encore suivis en stock — best-effort, à partir
 * des factures déjà reçues. Contrairement à purchase-ref-scan.ts (qui cherche une réf. déjà
 * connue), ici on tente de LIRE les lignes d'article directement dans le texte de la facture :
 * ça ne marche que pour les factures dont le tableau suit un motif reconnaissable
 * (code article en début de ligne, comme chez Sani Mat Wavre) — les autres mises en page ne
 * remontent simplement rien, plutôt que de risquer une lecture fausse. Le résultat est un
 * aperçu à vérifier avant de créer un article, jamais une création automatique.
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

// code article (3-8 chiffres) en tout début de ligne, puis un libellé (commence par une
// majuscule/chiffre), puis un nombre qui ressemble à une quantité — motif d'export ERP vu chez
// Sani Mat Wavre ("198356 PLAQUETTE FIXATION PANN.ISOLANT 5*70 ZN 2. PC 22.89…"), probablement
// partagé par d'autres grossistes du bâtiment qui utilisent un logiciel similaire.
// la quantité doit être un nombre isolé (borné par un espace ou une fin de ligne) — sinon un
// « 5*70 » (dimension dans le libellé, ex. "PANN.ISOLANT 5*70 ZN") matcherait sur son "5" et
// tronquerait le libellé prématurément.
const LINE_RE = /^[ \t]*(\d{3,8})[ \t]+([A-ZÀ-Ÿ0-9][A-Za-zÀ-ÿ0-9.,''"*/+()\-\s]{3,70}?)[ \t]+(\d+[.,]?\d*)(?=[ \t]|$)[ \t]*(PC|PCE|PCS|U|UN|KG|L|M2|M²|M3|M³|SAC|ML|H)?\b/im;

export interface LineCandidate { code: string; description: string; qty: number }

/** Logique pure (testable sans PDF réel) : quelles lignes de ce texte de facture ressemblent à un article commandé ? */
export function findLineCandidates(rawText: string): LineCandidate[] {
  const out: LineCandidate[] = [];
  for (const raw of rawText.split('\n')) {
    const m = raw.match(LINE_RE);
    if (!m) continue;
    const qty = Number(m[3]!.replace(',', '.').replace(/\.$/, ''));
    if (!qty || qty <= 0) continue;
    out.push({ code: m[1]!, description: m[2]!.trim().replace(/\s+/g, ' '), qty });
  }
  return out;
}

/** Un même code peut matcher plusieurs fois sur UNE MÊME facture (plusieurs lots livrés…) — pour
 *  la récurrence (qui compte des factures, pas des lignes), on ne garde qu'une entrée par code,
 *  quantités additionnées. */
export function collapseByCode(matches: LineCandidate[]): Map<string, { description: string; qty: number }> {
  const out = new Map<string, { description: string; qty: number }>();
  for (const c of matches) {
    const prev = out.get(c.code);
    out.set(c.code, { description: c.description, qty: (prev?.qty ?? 0) + c.qty });
  }
  return out;
}

export interface PurchaseCandidate {
  code: string;
  description: string;
  contactId: string;
  contactName: string;
  occurrences: { ledgerEntryId: string; date: string | null; docNumber: string | null; qty: number }[];
}

/**
 * Rattrapage : relit les factures d'achat déjà en base, cherche des lignes d'article
 * reconnaissables, regroupe par (fournisseur, code) et ne garde que ce qui revient au moins deux
 * fois et n'est pas déjà suivi (aucun article de stock n'a déjà cette réf. chez ce fournisseur).
 */
export async function findPurchaseCandidates(): Promise<PurchaseCandidate[]> {
  if (!(await pdftotextAvailable())) return [];
  const entries = await prisma.ledgerEntry.findMany({
    where: { direction: 'purchase', pdfPath: { not: null }, contactId: { not: null } },
    select: { id: true, date: true, docNumber: true, pdfPath: true, contactId: true, contact: { select: { name: true } } },
  });

  const known = await prisma.stockSupplier.findMany({ where: { supplierRef: { not: null } }, select: { contactId: true, supplierRef: true } });
  const knownKeys = new Set(known.map((k) => `${k.contactId}::${k.supplierRef}`));

  const groups = new Map<string, PurchaseCandidate>();
  for (const e of entries) {
    if (!e.pdfPath || !e.contactId) continue;
    const file = resolveUpload(e.pdfPath);
    if (!existsSync(file)) continue;
    let text: string;
    try {
      text = await pdfToRawText(await readFile(file));
    } catch {
      continue;
    }
    for (const [code, c] of collapseByCode(findLineCandidates(text))) {
      const key = `${e.contactId}::${code}`;
      if (knownKeys.has(key)) continue; // déjà un article de stock suivi pour cette réf.
      const g = groups.get(key) ?? {
        code, description: c.description, contactId: e.contactId, contactName: e.contact?.name ?? '—', occurrences: [],
      };
      g.occurrences.push({ ledgerEntryId: e.id, date: e.date?.toISOString() ?? null, docNumber: e.docNumber, qty: c.qty });
      groups.set(key, g);
    }
  }

  return [...groups.values()]
    .filter((g) => g.occurrences.length >= 2)
    .sort((a, b) => b.occurrences.length - a.occurrences.length)
    .slice(0, 50);
}
