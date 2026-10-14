/**
 * Rattache aux devis les factures importées dont l'intitulé cite UN numéro de devis (voir lib/link-invoices-quotes.ts).
 * Sauvegarde JSON des rattachements avant d'écrire. Sans --apply : simulation (aucune écriture).
 */
import { writeFileSync } from 'node:fs';
import { prisma } from '../src/db.js';
import { planInvoiceQuoteLinks, applyInvoiceQuoteLinks } from '../src/lib/link-invoices-quotes.js';

const APPLY = process.argv.includes('--apply');
const BACKUP = '/tmp/rattachements-factures-devis.json';
const eur = (n: number) => n.toLocaleString('fr-BE', { style: 'currency', currency: 'EUR' });

async function run() {
  const plan = await planInvoiceQuoteLinks();
  console.log(APPLY ? 'MODE APPLY' : 'SIMULATION', '| factures à rattacher:', plan.links.length, '| à faire à la main (plusieurs devis cités):', plan.ambiguous.length, '| devis cité introuvable:', plan.unknownQuote.length);
  console.log('\n— Par devis (HT) —');
  for (const q of plan.perQuote.sort((a, b) => a.quoteNumber.localeCompare(b.quoteNumber))) {
    console.log(`${q.quoteNumber}  devis ${eur(q.totalHt)}  déjà lié ${eur(q.alreadyBilledHt)}  + ${eur(q.addedHt)}  → ${q.afterPct} % facturé${q.afterPct > 102 ? '  ⚠ DÉPASSE LE DEVIS' : ''}`);
  }
  console.log('\n— Factures rattachées —');
  for (const l of plan.links) console.log(`${l.invoiceNumber ?? '(brouillon)'}  → ${l.quoteNumber}  ${eur(l.netHt)}`);
  if (plan.review.length) { console.log('
— À vérifier (NON rattachées : devis dépassé ou total nul/négatif) —'); for (const r of plan.review) console.log(`${r.quoteNumber}  devis ${eur(r.totalHt)}  factures ${eur(r.addedHt)} (${r.afterPct} %)  ${r.invoices.join(', ')}`); }
  if (plan.ambiguous.length) { console.log('\n— À rattacher à la main (plusieurs devis cités ou chantier différent) —'); for (const a of plan.ambiguous) console.log(`${a.invoiceNumber ?? '(brouillon)'}  ${a.quotes.join(' / ')}  « ${a.title} »`); }
  if (plan.unknownQuote.length) { console.log('\n— Devis cité introuvable dans l’appli —'); for (const a of plan.unknownQuote) console.log(`${a.invoiceNumber ?? '(brouillon)'}  ${a.quote}  « ${a.title} »`); }
  if (!APPLY || !plan.links.length) { await prisma.$disconnect(); return; }

  writeFileSync(BACKUP, JSON.stringify({ exportedAt: new Date(), links: plan.links.map((l) => ({ invoiceId: l.invoiceId, invoiceNumber: l.invoiceNumber, parentIdBefore: null, parentIdAfter: l.quoteId })) }, null, 1));
  console.log('\nSauvegarde :', BACKUP);
  console.log('Factures rattachées :', await applyInvoiceQuoteLinks(plan));
  await prisma.$disconnect();
}
run().catch((e) => { console.error(e); process.exit(1); });
