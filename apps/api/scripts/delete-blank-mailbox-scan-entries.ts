/**
 * Supprime les dépenses créées par le scan rétroactif de la boîte mail (voir
 * scan-invoice-mailbox-history.ts) dont l'extraction n'a RIEN trouvé (ni fournisseur, ni
 * n° de document, ni montant) — juste un PDF + une date, sans valeur exploitable dans
 * Achats. Supprime aussi le PDF stocké. Ne touche à rien d'autre (les entrées avec au
 * moins un élément identifiable, ou un montant, sont conservées).
 *
 *   npm run delete:blank-mailbox-scan-entries
 */
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/db.js';
import { UPLOADS_DIR } from '../src/lib/media.js';

function resolveUpload(rel: string): string {
  const clean = rel.replace(/^\/?uploads\//, '').replace(/\\/g, '/');
  return path.join(UPLOADS_DIR, path.normalize(clean));
}

async function main() {
  const where = {
    source: 'email',
    notes: { startsWith: 'Retrouvée dans le dossier mail' },
    ht: 0,
    ttc: null,
    docNumber: null,
    supplierName: null,
  } as const;

  const rows = await prisma.ledgerEntry.findMany({ where, select: { id: true, pdfPath: true } });
  console.log(`${rows.length} dépense(s) vide(s) à supprimer.`);

  let filesDeleted = 0;
  for (const r of rows) {
    if (!r.pdfPath) continue;
    try {
      await unlink(resolveUpload(r.pdfPath));
      filesDeleted++;
    } catch {
      // fichier déjà absent — pas bloquant
    }
  }

  const result = await prisma.ledgerEntry.deleteMany({ where });
  console.log(`Supprimé : ${result.count} dépense(s), ${filesDeleted} fichier(s) PDF.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
