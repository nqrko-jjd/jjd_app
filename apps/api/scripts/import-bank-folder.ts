/**
 * Import de tous les CSV bancaires d'un dossier, avec contrôle fichier par fichier.
 *   tsx scripts/import-bank-folder.ts <dossier>            -> simulation (aucune écriture)
 *   tsx scripts/import-bank-folder.ts <dossier> --apply    -> importe, puis compare la base au résultat attendu
 * La banque est déduite de l'IBAN du compte (dans le nom du fichier ou la 1re colonne) : Belfius BE31 0689 4940 0055, ING BE64 3632 5469 4152.
 * Même mécanisme d'import que l'écran « Importer un relevé » (doublons : ré-import et recoupements écartés, opérations identiques conservées).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/db.js';
import { parseBankCsv, decodeCsvBuffer } from '../src/lib/bank-csv.js';
import { insertBankRows } from '../src/routes/finance.js';

const dir = process.argv[2]!;
const APPLY = process.argv.includes('--apply');
const BANKS: [RegExp, string][] = [[/BE31\s?0689\s?4940\s?0055/i, 'Belfius'], [/BE64\s?3632\s?5469\s?4152/i, 'ING']];
const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : '—');
const r2 = (n: number) => Math.round(n * 100) / 100;

async function run() {
  const files = readdirSync(dir).filter((f) => /\.csv$/i.test(f)).sort();
  type F = { file: string; bank: string; rows: ReturnType<typeof parseBankCsv>['rows']; min: Date; max: Date };
  const parsed: F[] = [];
  for (const file of files) {
    const text = decodeCsvBuffer(readFileSync(path.join(dir, file)));
    const bank = BANKS.find(([re]) => re.test(file) || re.test(text.slice(0, 3000)))?.[1];
    if (!bank) { console.log('!! banque non reconnue, fichier ignoré:', file); continue; }
    const rows = parseBankCsv(text).rows;
    const dates = rows.map((r) => r.bookingDate!).filter(Boolean).sort((a, b) => a.getTime() - b.getTime());
    if (!rows.length) { console.log('!! aucune ligne lue:', file); continue; }
    parsed.push({ file, bank, rows, min: dates[0]!, max: dates.at(-1)! });
  }
  const expected: Record<string, { ids: Set<string>; sum: number }> = {};
  for (const bank of ['Belfius', 'ING']) {
    const fs = parsed.filter((f) => f.bank === bank).sort((a, b) => a.min.getTime() - b.min.getTime());
    if (!fs.length) continue;
    console.log(`\n=== ${bank} : ${fs.length} fichier(s)`);
    const e = (expected[bank] = { ids: new Set<string>(), sum: 0 });
    let covered = fs[0]!.min; let lastMax = new Date(0);
    for (const f of fs) {
      const own = new Set(f.rows.map((r) => r.externalId));
      const overlap = [...own].filter((id) => e.ids.has(id)).length;
      own.forEach((id) => e.ids.add(id));
      const gap = lastMax.getTime() ? Math.round((f.min.getTime() - lastMax.getTime()) / 86400000) : 0;
      console.log(`${f.file.slice(0, 60).padEnd(60)} ${String(f.rows.length).padStart(5)} lignes | ${d(f.min)} → ${d(f.max)} | ${overlap} déjà vues dans un fichier précédent${gap > 7 ? ` | ⚠ TROU de ${gap} jours avant ce fichier` : ''}`);
      if (f.max > lastMax) lastMax = f.max;
    }
    const all = new Map<string, number>();
    for (const f of fs) for (const r of f.rows) all.set(r.externalId, r.amount ?? 0);
    e.sum = r2([...all.values()].reduce((s, a) => s + a, 0));
    console.log(`→ ${bank}: ${e.ids.size} lignes uniques attendues | ${d(covered)} → ${d(lastMax)} | solde net des mouvements ${e.sum}`);
  }
  if (!APPLY) { console.log('\nSIMULATION — rien n\'a été écrit.'); await prisma.$disconnect(); return; }

  for (const f of [...parsed].sort((a, b) => a.min.getTime() - b.min.getTime())) {
    const { imported, duplicates } = await insertBankRows(f.rows, f.bank, 'csv');
    console.log(`importé ${f.file.slice(0, 55).padEnd(55)} +${imported} | écartées comme déjà présentes: ${duplicates}`);
  }
  console.log('\n=== Contrôle final (base vs attendu)');
  for (const [bank, e] of Object.entries(expected)) {
    const agg = await prisma.bankTransaction.aggregate({ where: { bank }, _count: true, _sum: { amount: true } });
    const ok = agg._count === e.ids.size && Math.abs(r2(agg._sum.amount ?? 0) - e.sum) < 0.01;
    console.log(`${bank}: base ${agg._count} lignes / solde net ${r2(agg._sum.amount ?? 0)} | attendu ${e.ids.size} / ${e.sum} → ${ok ? 'OK' : '⚠ ÉCART'}`);
  }
  await prisma.$disconnect();
}
run().catch((e) => { console.error(e); process.exit(1); });
