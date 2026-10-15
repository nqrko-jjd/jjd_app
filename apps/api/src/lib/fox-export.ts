import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { HttpError } from './http.js';
import { UPLOADS_DIR } from './media.js';

type FoxEntry = { id: string; direction: string; categoryRaw: string | null; pdfPath: string | null; docNumber: string | null; supplierName: string | null; contactId: string | null; contact: { name: string; vat: string | null } | null };
const normalize = (value: string) => value.normalize('NFKC').trim().toUpperCase().replace(/\s+/g, '');
export function foxEligible(e: Pick<FoxEntry, 'direction' | 'categoryRaw'>) {
  return e.direction === 'purchase' || (e.direction === 'credit_note' && !/vente|dit auto/i.test(e.categoryRaw ?? ''));
}
/** All-or-nothing: never silently omit a selected document or export duplicate PDFs. */
export async function prepareFoxZip(items: FoxEntry[]) {
  const root = await realpath(UPLOADS_DIR);
  const files: Record<string, Uint8Array> = {};
  const hashes = new Set<string>(), references = new Set<string>();
  let size = 0;
  for (const e of items) {
    const label = e.docNumber || e.id;
    if (!foxEligible(e)) throw new HttpError(422, label + ' : seules les factures et notes de crédit d’achat sont exportables vers Fox.');
    if (!e.pdfPath || !/\.pdf$/i.test(e.pdfPath)) throw new HttpError(422, label + ' : PDF manquant. Ajoutez le PDF avant l’export Fox.');
    const candidate = path.resolve(root, e.pdfPath.replace(/^\/?uploads\//, ''));
    const relative = path.relative(root, candidate);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new HttpError(422, 'Chemin de pièce jointe invalide.');
    const file = await realpath(candidate).catch(() => null);
    if (!file || path.relative(root, file).startsWith('..')) throw new HttpError(422, label + ' : PDF introuvable.');
    size += (await stat(file)).size;
    if (size > 100 * 1024 * 1024) throw new HttpError(422, 'Lot trop volumineux (100 Mo maximum). Réduisez la sélection.');
    const bytes = await readFile(file);
    if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new HttpError(422, label + ' : pièce jointe PDF invalide.');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const supplier = e.contact?.vat ? 'vat:' + normalize(e.contact.vat).replace(/[^A-Z0-9]/g, '') : e.contactId ? 'id:' + e.contactId : normalize(e.supplierName ?? '');
    const ref = supplier && e.docNumber ? [supplier, e.direction, normalize(e.docNumber)].join('|') : '';
    if (hashes.has(hash) || (ref && references.has(ref))) throw new HttpError(409, label + ' : doublon possible dans la sélection. Vérifiez les achats avant l’export Fox.');
    hashes.add(hash); if (ref) references.add(ref);
    const safe = (value: string) => value.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 90);
    files[safe(e.contact?.name || e.supplierName || 'Fournisseur') + '_' + safe(label) + '_' + e.id + '.pdf'] = bytes;
  }
  return Buffer.from(zipSync(files, { level: 0 }));
}
