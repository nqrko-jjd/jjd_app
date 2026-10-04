/**
 * Import des « États des dépenses » VISA (PDF) d'un dossier, regroupés par numéro de carte, avec contrôles :
 *  - somme des achats = total du relevé (sinon le relevé n'est pas importé) ;
 *  - carte à débit différé : le total du relevé se retrouve-t-il en « VISA RELEVE » sur le compte courant ?
 *  - carte prépayée : chaque chargement/déchargement du relevé se retrouve-t-il sur le compte courant ?
 *   tsx scripts/import-visa-folder.ts <dossier>           -> simulation
 *   tsx scripts/import-visa-folder.ts <dossier> --apply   -> importe les achats (banque « VISA ••1234 », source pdf-visa)
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/db.js';
import { pdfToRawText, parseVisaStatement, type VisaStatement } from '../src/lib/bank-pdf.js';
import { insertBankRows } from '../src/routes/finance.js';

const dir = process.argv[2]!;
const APPLY = process.argv.includes('--apply');
const fr = (d: Date | null) => (d ? d.toISOString().slice(0, 10).split('-').reverse().join('/') : '—');
const r2 = (n: number) => Math.round(n * 100) / 100;
const dayN = (d: Date) => Math.round(d.getTime() / 86400000);

async function run() {
  const stmts: (VisaStatement & { file: string })[] = [];
  for (const file of readdirSync(dir).filter((f) => /\.pdf$/i.test(f)).sort()) {
    const st = parseVisaStatement(await pdfToRawText(readFileSync(path.join(dir, file))));
    if (!st.cardLast4 || !st.closeDate) { console.log('!! relevé illisible (carte ou date de clôture) :', file); continue; }
    stmts.push({ ...st, file });
  }
  const bel = await prisma.bankTransaction.findMany({ where: { bank: 'Belfius' }, select: { id: true, bookingDate: true, amount: true, description: true, communication: true } });
  const norm = (s: string | null) => (s ?? '').replace(/\s+/g, ' ');
  const releves = bel.filter((t) => /VISA RELEVE|RELEVE NUMERO/i.test(t.description ?? ''));

  const byCard = new Map<string, typeof stmts>();
  for (const s of stmts) byCard.set(s.cardLast4!, [...(byCard.get(s.cardLast4!) ?? []), s]);
  const toImport: { label: string; st: (typeof stmts)[number] }[] = [];
  const relink: { txId: string; text: string }[] = [];
  for (const [card, list] of [...byCard.entries()].sort()) {
    list.sort((a, b) => a.closeDate!.getTime() - b.closeDate!.getTime());
    const deferred = list.some((s) => s.debitDate);
    const label = `VISA ••${card}`;
    let badSum = 0, nPurch = 0, sumPurch = 0, loadsOk = 0, loadsKo: string[] = [], relOk = 0, relKo: string[] = [], gaps: string[] = [];
    list.forEach((s, i) => {
      if (i > 0) { const g = dayN(s.closeDate!) - dayN(list[i - 1]!.closeDate!); if (g > 40) gaps.push(`${fr(list[i - 1]!.closeDate)} → ${fr(s.closeDate)} (${g} j)`); }
      const sumOk = s.total != null && Math.abs(s.total - s.sumPurchases) < 0.01;
      if (!sumOk) { badSum++; console.log(`!! ${label} relevé du ${fr(s.closeDate)} : total ${s.total} ≠ somme des achats ${s.sumPurchases} — non importé (${s.file})`); return; }
      nPurch += s.purchases.length; sumPurch += s.sumPurchases;
      const note = `Relevé VISA ••${card} du ${fr(s.closeDate)}${s.debitDate ? ` · débité le ${fr(s.debitDate)}` : ''}`;
      s.purchases.forEach((p) => { p.communication = note; });
      toImport.push({ label, st: s });
      if (s.debitDate) { // carte à débit différé : retrouver le prélèvement
        const hit = releves.filter((t) => Math.abs(Math.abs(t.amount ?? 0) - s.total!) < 0.011 && t.bookingDate && Math.abs(dayN(t.bookingDate) - dayN(s.debitDate!)) <= 4);
        if (hit.length >= 1) { relOk++; relink.push({ txId: hit[0]!.id, text: `${note} · ${s.purchases.length} achats · ${String(s.total).replace('.', ',')} €` }); }
        else relKo.push(`${fr(s.closeDate)} (débit ${fr(s.debitDate)}) ${s.total} €`);
      }
      for (const l of s.loads) { // carte prépayée : chargements/déchargements
        const hit = bel.filter((t) => /CHARGEMENT/i.test(t.description ?? '') && norm(t.description).includes(`**** ${card}`) && Math.abs(Math.abs(t.amount ?? 0) - Math.abs(l.amount)) < 0.011 && t.bookingDate && l.date && Math.abs(dayN(t.bookingDate) - dayN(l.date)) <= 4);
        if (hit.length) loadsOk++; else loadsKo.push(`${fr(l.date)} ${l.amount}`);
      }
    });
    console.log(`\n=== ${label} (${deferred ? 'carte à débit différé' : 'carte prépayée'}) : ${list.length} relevés, ${fr(list[0]!.closeDate)} → ${fr(list.at(-1)!.closeDate)}`);
    console.log(`   ${nPurch} achats importables, total ${r2(sumPurch)} € | relevés dont la somme ≠ total: ${badSum}`);
    if (deferred) console.log(`   prélèvements retrouvés sur le compte courant: ${relOk}/${list.length}${relKo.length ? ' | manquants: ' + relKo.join('; ') : ''}`);
    else console.log(`   chargements/déchargements retrouvés sur le compte courant: ${loadsOk}/${loadsOk + loadsKo.length}${loadsKo.length ? ' | non retrouvés: ' + loadsKo.slice(0, 6).join('; ') : ''}`);
    if (gaps.length) console.log('   ⚠ mois sans relevé dans le dossier:', gaps.join(' ; '));
  }
  if (!APPLY) { console.log('\nSIMULATION — rien n\'a été écrit.'); await prisma.$disconnect(); return; }

  let imported = 0, dup = 0;
  for (const { label, st } of toImport) { const r = await insertBankRows(st.purchases, label, 'pdf-visa'); imported += r.imported; dup += r.duplicates; }
  console.log(`\nAchats importés: ${imported} | écartés comme déjà présents: ${dup}`);
  let linked = 0;
  for (const l of relink) { const t = await prisma.bankTransaction.findUnique({ where: { id: l.txId }, select: { communication: true } }); if (t && !t.communication) { await prisma.bankTransaction.update({ where: { id: l.txId }, data: { communication: l.text } }); linked++; } }
  console.log('Prélèvements « VISA RELEVE » annotés avec leur relevé:', linked);
  console.log('=== Contrôle final (base vs attendu)');
  for (const [card, list] of [...byCard.entries()].sort()) {
    const exp = toImport.filter((x) => x.label === `VISA ••${card}`);
    const n = exp.reduce((s, x) => s + x.st.purchases.length, 0), sum = r2(-exp.reduce((s, x) => s + x.st.sumPurchases, 0));
    const agg = await prisma.bankTransaction.aggregate({ where: { bank: `VISA ••${card}` }, _count: true, _sum: { amount: true } });
    console.log(`VISA ••${card}: base ${agg._count} achats / ${r2(agg._sum.amount ?? 0)} € | attendu ${n} / ${sum} → ${agg._count === n && Math.abs(r2(agg._sum.amount ?? 0) - sum) < 0.01 ? 'OK' : '⚠ ÉCART'}`);
  }
  await prisma.$disconnect();
}
run().catch((e) => { console.error(e); process.exit(1); });
