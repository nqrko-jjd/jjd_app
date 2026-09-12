/**
 * Rattrapage ponctuel, en 2 parties, pour des faux positifs dans la file de contrôle :
 *
 * 1. Postes de frais (E-xx) manquants : `categories.ts` ne listait pas E-11 (PV/parking),
 *    E-13 (Mam's), E-15 (assurances auto) et E-16 (charges auto) — sans catégorie, aucun
 *    chantier "frais généraux" n'était créé pour ces codes, donc les écritures du grand
 *    livre qui les référencent ne pouvaient pas se rattacher et remontaient en
 *    "Écriture sur réf inconnue". Crée les catégories + chantiers manquants (additif —
 *    jamais de suppression), relie les écritures déjà en base, résout les signalements
 *    devenus obsolètes.
 * 2. Codes de pointage A / C / CP (Absent(e) / Congé / Congé public) : ce sont des codes
 *    d'absence volontaires, pas des erreurs — mais l'import les signalait comme
 *    "réf non standard" faute de les reconnaître. Résout ces signalements existants.
 *    (Le script d'import lui-même est aussi corrigé pour ne plus les signaler à l'avenir.)
 *
 *   npm run fix:overhead-labor-codes
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const NEW_E_CODES: { code: string; label: string }[] = [
  { code: 'E-11', label: 'PV / Parking' },
  { code: 'E-13', label: "Mam's" },
  { code: 'E-15', label: 'Assurances auto' },
  { code: 'E-16', label: 'Charges auto' },
];

async function fixOverheadCodes() {
  for (const { code, label } of NEW_E_CODES) {
    await prisma.category.upsert({
      where: { code },
      create: { code, label, kind: 'expense' },
      update: { label },
    });
    const ws = await prisma.worksite.upsert({
      where: { ref: code },
      create: { ref: code, title: label, kind: 'overhead', status: 'in_progress', source: 'xlsx' },
      update: {},
    });
    const relinked = await prisma.ledgerEntry.updateMany({
      where: { worksiteRef: code, worksiteId: null },
      data: { worksiteId: ws.id },
    });
    const resolved = await prisma.importIssue.updateMany({
      where: { entity: 'ledger', resolved: false, message: { contains: `réf inconnue ${code}` } },
      data: { resolved: true, resolvedNote: `Poste de frais ${code} (${label}) créé — écritures reliées.` },
    });
    console.log(`  ${code} (${label}) : ${relinked.count} écriture(s) reliée(s), ${resolved.count} signalement(s) résolu(s)`);
  }
}

const LABOR_CODES: Record<string, string> = { A: 'Absent(e)', C: 'Congé', CP: 'Congé public' };

async function resolveLaborCodes() {
  let total = 0;
  for (const [code, label] of Object.entries(LABOR_CODES)) {
    const r = await prisma.importIssue.updateMany({
      where: { entity: 'time_entry', resolved: false, message: { contains: `réf non standard « ${code} »` } },
      data: { resolved: true, resolvedNote: `${label} — code d'absence volontaire, pas une erreur.` },
    });
    total += r.count;
    console.log(`  ${code} (${label}) : ${r.count} signalement(s) résolu(s)`);
  }
  console.log(`${total} signalement(s) de pointage résolus au total.`);
}

async function main() {
  console.log('1. Postes de frais (E-xx) manquants :');
  await fixOverheadCodes();
  console.log('\n2. Codes de pointage A/C/CP :');
  await resolveLaborCodes();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
