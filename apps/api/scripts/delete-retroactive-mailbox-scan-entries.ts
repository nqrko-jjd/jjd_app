/**
 * Supprime TOUTES les dépenses créées par le scan rétroactif de la boîte mail (voir
 * scan-invoice-mailbox-history.ts) — reconnues par leur note "Retrouvée dans le dossier
 * mail « … »". L'extraction s'est révélée trop peu fiable sur l'historique (fournisseur
 * mal identifié sur plusieurs lignes, ex. dossier Vector 3) : mieux vaut n'avoir aucune
 * ligne que des lignes trompeuses. Ne touche PAS aux dépenses créées par la synchro
 * courante (mails non lus d'INBOX, au jour le jour) — celles-ci n'ont pas cette note.
 * Supprime aussi le PDF stocké de chaque ligne effacée.
 *
 *   npm run delete:retroactive-mailbox-scan-entries
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
  const where = { source: 'email', notes: { startsWith: 'Retrouvée dans le dossier mail' } } as const;

  const rows = await prisma.ledgerEntry.findMany({ where, select: { id: true, pdfPath: true } });
  console.log(`${rows.length} dépense(s) issue(s) du scan rétroactif à supprimer.`);

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

  const remaining = await prisma.ledgerEntry.count({ where: { source: 'email' } });
  console.log(`Reste en base (source 'email', synchro courante uniquement) : ${remaining}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
