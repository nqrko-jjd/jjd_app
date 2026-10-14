/**
 * Chantiers archivés restés « À facturer » alors qu'il n'y a rien à facturer (aucun devis accepté, aucune facture) :
 * ils passent en « Refusé » (leurs devis sont refusés ou sans réponse). Sauvegarde JSON avant d'écrire. Sans --apply : simulation.
 */
import { writeFileSync } from 'node:fs';
import { prisma } from '../src/db.js';

const APPLY = process.argv.includes('--apply');
const BACKUP = '/tmp/chantiers-a-facturer-archives.json';

async function run() {
  const ws = await prisma.worksite.findMany({
    where: { kind: 'project', status: 'to_invoice', archived: true },
    select: { id: true, ref: true, title: true, status: true, archived: true },
    orderBy: { ref: 'asc' },
  });
  const docs = await prisma.document.findMany({ where: { worksiteId: { in: ws.map((w) => w.id) } }, select: { worksiteId: true, kind: true, status: true, number: true } });
  type Row = (typeof ws)[number] & { quotes: string; accepted: number; invoices: number };
  const fixable: Row[] = [], kept: Row[] = [];
  for (const w of ws) {
    const mine = docs.filter((d) => d.worksiteId === w.id);
    const accepted = mine.filter((d) => d.kind === 'quote' && d.status === 'accepted').length;
    const invoices = mine.filter((d) => ['invoice', 'deposit_invoice'].includes(d.kind)).length;
    (accepted === 0 && invoices === 0 ? fixable : kept).push({ ...w, quotes: mine.filter((d) => d.kind === 'quote').map((d) => `${d.number}:${d.status}`).join(' '), accepted, invoices });
  }
  console.log(APPLY ? 'MODE APPLY' : 'SIMULATION', '| archivés « À facturer »:', ws.length, '| à passer en Refusé:', fixable.length, '| laissés tels quels (devis accepté ou facture):', kept.length);
  for (const w of fixable) console.log('→ refused ', w.ref, w.title.slice(0, 50), '|', w.quotes);
  for (const w of kept) console.log('  laissé    ', w.ref, w.title.slice(0, 50), '| devis acceptés:', w.accepted, '| factures:', w.invoices);
  if (!APPLY || !fixable.length) { await prisma.$disconnect(); return; }
  writeFileSync(BACKUP, JSON.stringify({ exportedAt: new Date(), worksites: fixable.map((w) => ({ id: w.id, ref: w.ref, statusBefore: w.status })) }, null, 1));
  const r = await prisma.worksite.updateMany({ where: { id: { in: fixable.map((w) => w.id) }, status: 'to_invoice', archived: true }, data: { status: 'refused' } });
  console.log('Sauvegarde :', BACKUP, '| chantiers modifiés :', r.count);
  await prisma.$disconnect();
}
run().catch((e) => { console.error(e); process.exit(1); });
