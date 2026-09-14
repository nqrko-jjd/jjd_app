/**
 * Étape 3 de la fusion Contact/Immeuble (voir le plan "Fusion Contact ACP / Immeuble en
 * une seule fiche") — additif et ré-exécutable sans risque : ne touche AUCUNE ligne
 * `Building`, se contente de copier ses données sur le contact ACP qui l'absorbe et de
 * remplir les nouvelles colonnes "fantômes" (`acpId`/`linkedAcpId`/`residentOfId`) sans
 * jamais toucher aux anciennes colonnes `buildingId`/`building` — l'app continue de
 * fonctionner exactement comme avant pendant toute cette étape.
 *
 * À lancer seulement après `report-acp-duplicates.ts` (aucun doublon restant).
 *
 *   npm run merge:buildings-into-contacts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const buildings = await prisma.building.findMany();
  console.log(`${buildings.length} immeuble(s) à traiter.\n`);

  const mapping: { buildingId: string; buildingName: string; contactId: string | null; contactName: string | null }[] = [];
  let copied = 0;
  let conflicts = 0;
  let unresolved = 0;

  for (const b of buildings) {
    let survivorId = b.clientId;
    if (!survivorId) {
      const candidates = await prisma.contact.findMany({
        where: { buildingId: b.id, kind: { in: ['acp', 'developer'] } },
        select: { id: true, name: true },
      });
      if (candidates.length === 1) survivorId = candidates[0]!.id;
    }

    if (!survivorId) {
      console.log(`  [À TRAITER À LA MAIN] ${b.name} (${b.id}) — pas de client facturé et pas exactement 1 contact ACP candidat.`);
      mapping.push({ buildingId: b.id, buildingName: b.name, contactId: null, contactName: null });
      unresolved++;
      continue;
    }

    const survivor = await prisma.contact.findUnique({ where: { id: survivorId } });
    if (!survivor) {
      console.log(`  [ERREUR] ${b.name} (${b.id}) — clientId ${survivorId} ne correspond à aucun contact.`);
      unresolved++;
      continue;
    }

    // Copie les champs de Building sur le Contact survivant, sans jamais écraser une
    // valeur déjà présente côté Contact.
    const fieldsToCopy: (keyof typeof b)[] = ['reference', 'lotCount', 'digicode', 'accessNote', 'photoUrl', 'photoThumbUrl', 'address', 'postalCode', 'city', 'syndicId', 'note'];
    const updateData: Record<string, unknown> = {};
    for (const f of fieldsToCopy) {
      const buildingValue = b[f];
      const contactValue = (survivor as Record<string, unknown>)[f];
      if (buildingValue != null && contactValue == null) {
        updateData[f] = buildingValue;
      } else if (buildingValue != null && contactValue != null && String(buildingValue) !== String(contactValue)) {
        console.log(`  [conflit ${f}] ${survivor.name} : contact="${contactValue}" vs immeuble="${buildingValue}" — valeur du contact conservée.`);
        conflicts++;
      }
    }
    if (Object.keys(updateData).length) await prisma.contact.update({ where: { id: survivor.id }, data: updateData });

    // Repointe les colonnes fantômes vers le survivant.
    const [ws, opp, u, bc, bu] = await Promise.all([
      prisma.worksite.updateMany({ where: { buildingId: b.id }, data: { acpId: survivor.id } }),
      prisma.crmOpportunity.updateMany({ where: { buildingId: b.id }, data: { acpId: survivor.id } }),
      prisma.user.updateMany({ where: { buildingId: b.id }, data: { residentOfId: survivor.id } }),
      prisma.buildingContact.updateMany({ where: { buildingId: b.id }, data: { acpId: survivor.id } }),
      prisma.buildingUnit.updateMany({ where: { buildingId: b.id }, data: { acpId: survivor.id } }),
    ]);

    // Les autres contacts (résidents, ou doublons non résolus) qui pointaient sur cet
    // immeuble via leur propre `buildingId` — repointés vers le survivant, sauf le
    // survivant lui-même (une ACP ne référence pas sa propre fiche comme "son immeuble").
    const linkedContacts = await prisma.contact.findMany({ where: { buildingId: b.id }, select: { id: true } });
    let residentsLinked = 0;
    for (const lc of linkedContacts) {
      if (lc.id === survivor.id) continue;
      await prisma.contact.update({ where: { id: lc.id }, data: { linkedAcpId: survivor.id } });
      residentsLinked++;
    }

    console.log(`  [ok] ${b.name} -> ${survivor.name} (chantiers:${ws.count} opportunités:${opp.count} résidents-portail:${u.count} contacts-clés:${bc.count} lots:${bu.count} contacts-liés:${residentsLinked})`);
    mapping.push({ buildingId: b.id, buildingName: b.name, contactId: survivor.id, contactName: survivor.name });
    copied++;
  }

  console.log(`\n${copied} immeuble(s) fusionné(s) dans leur contact, ${conflicts} conflit(s) de champ (valeur du contact conservée), ${unresolved} à traiter à la main.`);
  console.log('\nTable de correspondance Building -> Contact :');
  console.table(mapping.map((m) => ({ building: m.buildingName, buildingId: m.buildingId, contact: m.contactName ?? '—', contactId: m.contactId ?? '—' })));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
