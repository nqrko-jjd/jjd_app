/**
 * Rapport en LECTURE SEULE (aucune écriture) — étape 2 de la fusion Contact/Immeuble
 * (voir le plan "Fusion Contact ACP / Immeuble en une seule fiche"). Avant de lancer le
 * backfill (`merge-buildings-into-contacts.ts`), il faut que chaque `Building` n'ait
 * plus qu'UN SEUL contact ACP candidat pour absorber ses données — ce script liste les
 * cas ambigus à résoudre à la main (fusion de doublons via `DELETE /api/contacts/:id`,
 * déjà garde-fouée) avant de continuer.
 *
 *   npm run report:acp-duplicates
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const orphanBuildings = await prisma.building.findMany({
    where: { clientId: null },
    select: { id: true, name: true },
  });
  console.log(`\n== Immeubles sans client facturé (${orphanBuildings.length}) ==`);
  for (const b of orphanBuildings) {
    const candidates = await prisma.contact.findMany({
      where: { buildingId: b.id },
      select: { id: true, name: true, kind: true },
    });
    const acpCandidates = candidates.filter((c) => c.kind === 'acp' || c.kind === 'developer');
    if (acpCandidates.length === 1) {
      console.log(`  OK — ${b.name} (${b.id}) -> survivant automatique : ${acpCandidates[0]!.name}`);
    } else {
      console.log(`  À TRAITER — ${b.name} (${b.id}) : ${acpCandidates.length} candidat(s) ACP/Promoteur`);
      for (const c of candidates) console.log(`      - ${c.name} (${c.kind ?? '—'}, ${c.id})`);
    }
  }

  const buildings = await prisma.building.findMany({ select: { id: true, name: true, clientId: true } });
  console.log(`\n== Immeubles avec plusieurs contacts liés (${buildings.length} immeubles au total) ==`);
  let ambiguous = 0;
  for (const b of buildings) {
    const linked = await prisma.contact.findMany({
      where: { buildingId: b.id },
      select: { id: true, name: true, kind: true },
    });
    if (linked.length <= 1) continue;
    const acpLike = linked.filter((c) => c.kind === 'acp' || c.kind === 'developer' || c.kind === 'company');
    const residents = linked.filter((c) => c.kind === 'individual');
    if (acpLike.length > 1) {
      ambiguous++;
      console.log(`\n  DOUBLON PROBABLE — ${b.name} (client facturé actuel : ${b.clientId ?? '—'})`);
      for (const c of acpLike) console.log(`      - ${c.name} (${c.kind}, ${c.id})${c.id === b.clientId ? '  <- client facturé actuel' : ''}`);
      if (residents.length) console.log(`      (+ ${residents.length} résident(s) individuel(s), laissés tels quels)`);
    } else if (residents.length) {
      console.log(`  OK — ${b.name} : ${residents.length} résident(s) individuel(s) lié(s), pas un doublon.`);
    }
  }

  console.log(`\n${ambiguous} immeuble(s) avec doublon(s) probable(s) à fusionner à la main avant le backfill.`);
  console.log('Pour fusionner un doublon : réassigner ses chantiers/devis/factures/achats au contact');
  console.log('survivant (via les PATCH existants), puis DELETE /api/contacts/:id sur le doublon vidé');
  console.log('(le garde-fou 409 refuse tant qu\'il reste des références) — même geste que Poincoin/Poincon.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
