/**
 * Scan rétroactif de la boîte mail factures — voir lib/invoice-mailbox.ts. Ne modifie
 * jamais les mails (pas de \Seen, pas de déplacement, le classement par fournisseur reste
 * intact) ; ne crée une dépense que si aucune correspondance n'est trouvée dans le grand
 * livre existant (n° de document, sinon montant + date proche).
 *
 *   npm run scan:invoice-mailbox                          -> tous les dossiers
 *   npm run scan:invoice-mailbox -- INBOX "INBOX.Cebeo"    -> dossiers précis
 */
import { scanInvoiceMailboxHistory, invoiceMailboxConfigured } from '../src/lib/invoice-mailbox.js';
import { prisma } from '../src/db.js';

async function main() {
  if (!invoiceMailboxConfigured()) throw new Error('Boîte mail non configurée (INVOICES_IMAP_*)');
  const folders = process.argv.slice(2);
  console.log(folders.length ? `Scan de : ${folders.join(', ')}` : 'Scan de tous les dossiers…');
  const stats = await scanInvoiceMailboxHistory(folders.length ? folders : undefined);
  console.log('\nRésultat :');
  console.log('  dossiers scannés      ', stats.folders);
  console.log('  messages examinés     ', stats.messagesScanned);
  console.log('  PDF trouvés           ', stats.pdfsFound);
  console.log('  déjà dans le système  ', stats.alreadyInSystem);
  console.log('  nouvelles dépenses    ', stats.created, `(dont ${stats.unreliableExtraction} extraction incomplète, à vérifier davantage)`);
  if (stats.errors.length) {
    console.log(`  erreurs (${stats.errors.length}) :`);
    for (const e of stats.errors.slice(0, 30)) console.log('   -', e);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
