/**
 * Démo commerciale — remplit une base DÉDIÉE (jjd_demo, voir docker-compose.demo.yml) avec une entreprise de
 * rénovation complète et 100 % fictive : clients particuliers (FR / NL / EN), syndics et immeubles, architecte,
 * promoteur, fournisseurs, équipe, flotte, ~35 chantiers à tous les stades (demande → clôturé) avec devis,
 * factures, paiements, achats, pointages, planning, rapports signés, fil de chantier et comptes du portail client.
 *
 * Garde-fous : refuse de tourner ailleurs que sur la base de démo (JJD_DEMO=1 + base « jjd_demo ») et sur une base
 * qui contient déjà des données sans le marqueur de démo. Ne touche jamais aux données réelles.
 *
 *   JJD_DEMO=1 DEMO_PASSWORD=… DATABASE_URL=…/jjd_demo npx tsx scripts/seed-sales-demo.ts
 * Relancer : ne refait rien si la démo existe déjà ; `--reset` vide la base de démo et la recrée (dates recalées sur aujourd'hui).
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { normalizeName, computeDocTotals, belgianStructuredComm, formatDocNumber } from '@jjd/shared';
import { CATEGORY_SEED } from '../prisma/categories.js';
import { readFileSync } from 'node:fs';

if (process.env.JJD_DEMO !== '1' || !/\/jjd_demo(?:\?|$)/.test(process.env.DATABASE_URL ?? '') || (process.env.DEMO_PASSWORD ?? '').length < 8) {
  throw new Error('Démo : base dédiée « jjd_demo », JJD_DEMO=1 et DEMO_PASSWORD (8 caractères min.) obligatoires.');
}
const prisma = new PrismaClient();
const RESET = process.argv.includes('--reset');
const MARK = 'sales_demo_fixture';

// ----------------------------------------------------------------------------------------------- outils
let seed = 20261126;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!;
const between = (a: number, b: number) => Math.round(a + rnd() * (b - a));
const r2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86_400_000;
const today = new Date(); today.setHours(0, 0, 0, 0);
const d = (offsetDays: number, h = 0) => new Date(today.getTime() + offsetDays * DAY + h * 3_600_000);
const isWeekday = (x: Date) => x.getDay() !== 0 && x.getDay() !== 6;
const workdays = (from: number, to: number) => { const out: number[] = []; for (let i = from; i <= to; i++) if (isWeekday(d(i))) out.push(i); return out; };
const S = 'manual';

async function wipe() {
  // ordre : enfants d'abord. Base de démo uniquement (vérifié plus haut).
  const tables = await prisma.$queryRawUnsafe<{ tablename: string }[]>(`SELECT tablename::text AS tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

async function main() {
  const marker = await prisma.setting.findUnique({ where: { key: MARK } }).catch(() => null);
  if (marker && !RESET) { console.log('Démo déjà en place (relancer avec --reset pour la recréer).'); return; }
  if (!marker && !RESET && ((await prisma.worksite.count()) > 0 || (await prisma.contact.count()) > 0)) {
    throw new Error('Base non vide et sans marqueur de démo : refus (ce n’est pas la base de démo ?)');
  }
  if (RESET) { await wipe(); console.log('Base de démo vidée.'); }

  // ------------------------------------------------------------------------------------------- société
  for (const c of CATEGORY_SEED) {
    await prisma.category.create({ data: { code: c.code, label: c.label, kind: c.kind, entity: c.entity ?? null } });
    if (c.code.startsWith('E-')) await prisma.worksite.create({ data: { ref: c.code, title: c.label, kind: 'overhead', status: 'in_progress', source: S } });
  }
  await prisma.setting.create({ data: { key: 'company', value: { name: 'JJD Consult', email: 'info@jjd-consult.be', website: 'https://www.jjd-consult.be', vat: 'BE 0000.000.000', entities: ['jjd'], demo: true } } });

  // ------------------------------------------------------------------------------------------- équipe
  const team = [
    ['Marc', 'Lejeune', 'foreman', 'Chef de chantier', ['fr', 'nl'], ['gros œuvre', 'coordination'], 28, null],
    ['Pieter', 'Wouters', 'team_leader', 'Chef d’équipe', ['nl', 'fr', 'en'], ['carreleur', 'chape'], 26, null],
    ['Rui', 'Ferreira', 'qualified_worker', '', ['pt', 'fr'], ['maçon', 'carreleur'], 24, 220],
    ['Andrei', 'Popescu', 'qualified_worker', '', ['ro', 'fr'], ['plafonneur', 'peintre'], 23, 210],
    ['Karim', 'Benali', 'qualified_worker', '', ['fr', 'ar'], ['électricien'], 27, null],
    ['Tom', 'Peeters', 'qualified_worker', '', ['nl', 'en'], ['sanitaire', 'chauffage'], 27, null],
    ['João', 'Silva', 'worker', '', ['pt'], ['manœuvre', 'démolition'], 19, 170],
    ['Lucas', 'Mertens', 'worker', '', ['nl', 'fr'], ['menuisier'], 22, null],
    ['Bogdan', 'Ionescu', 'qualified_worker', '', ['ro', 'en'], ['couvreur', 'zinguerie'], 25, 200],
    ['Youssef', 'El Amrani', 'worker', '', ['fr', 'ar'], ['peintre'], 20, 180],
    ['Jan', 'De Smet', 'qualified_worker', '', ['nl'], ['façadier', 'isolation'], 25, null],
    ['Diego', 'Costa', 'worker', '', ['pt', 'es'], ['manœuvre'], 18, 160],
  ] as const;
  const people: { id: string; name: string; rate: number }[] = [];
  for (const [first, last, role, , languages, specialties, rate, payout] of team) {
    const p = await prisma.person.create({
      data: {
        firstName: first, lastName: last, displayName: first, normalizedName: normalizeName(`${first} ${last}`), role, contractType: payout ? 'subcontractor' : 'employee',
        hourlyRate: rate, payoutPerDay: payout, dailyHours: 9, languages: [...languages], specialties: [...specialties], phone: `+32 47${between(0, 9)} ${between(10, 99)} ${between(10, 99)} ${between(10, 99)}`,
        active: true, source: S,
      },
    });
    people.push({ id: p.id, name: first, rate });
  }
  const office = await prisma.person.create({ data: { firstName: 'Nathalie', lastName: 'Dubois', displayName: 'Nathalie', normalizedName: 'nathalie dubois', role: 'office', active: true, source: S } });

  // ------------------------------------------------------------------------------------------- flotte
  const fleet = [
    ['V01', '1-ABC-123', 'Renault', 'Master', 'Camionette', 3], ['V02', '2-DEF-456', 'Ford', 'Transit Custom', 'Camionette', 3],
    ['V03', '2-GHI-789', 'Volkswagen', 'Crafter', 'Camionette', 3], ['V04', '1-JKL-321', 'Mercedes', 'Vito', 'Camionette', 3],
    ['V05', '2-MNO-654', 'Peugeot', 'Partner', 'Camionette', 2], ['V06', '1-PQR-987', 'Tesla', 'Model Y', 'Voiture', 5],
  ] as const;
  const vehicles: string[] = [];
  for (const [code, plate, brand, model, type, seats] of fleet) {
    const v = await prisma.vehicle.create({ data: { code, plate, brand, model, name: `${brand} ${model}`, type, seats, fuel: brand === 'Tesla' ? 'Électrique' : 'Diesel', depot: 'Overijse', status: 'active', nextInspection: d(between(30, 300)), acquisitionMode: pick(['Leasing', 'Crédit', 'Comptant']), monthlyPayment: between(320, 690), source: S } });
    vehicles.push(v.id);
  }

  // ------------------------------------------------------------------------------------------- contacts
  const mk = (data: Record<string, unknown>) => prisma.contact.create({ data: { normalizedName: normalizeName(String(data.name)), source: S, ...data } as never });
  // syndic = fiche « Syndic » (portefeuille d'immeubles, compte portail) + sa fiche contact kind='syndic' — même mécanique que l'appli
  const syndicData = [
    { name: 'Immo Syndic Bruxelles', email: 'gestion@immosyndic-demo.be', phone: '+32 2 640 12 34', address: 'Avenue Louise 250', postalCode: '1050', city: 'Ixelles', vat: 'BE 0712.345.678' },
    { name: 'Syndicus Rand bv', email: 'beheer@syndicusrand-demo.be', phone: '+32 2 767 45 67', address: 'Brusselsesteenweg 12', postalCode: '3080', city: 'Tervuren', vat: 'BE 0723.456.789' },
    { name: 'Gestion Brabant SRL', email: 'info@gestionbrabant-demo.be', phone: '+32 10 22 33 44', address: 'Place Alphonse Bosch 8', postalCode: '1300', city: 'Wavre', vat: 'BE 0734.567.890' },
  ];
  const syndics = [];
  for (const sd of syndicData) {
    const org = await prisma.syndic.create({ data: { name: sd.name, normalizedName: normalizeName(sd.name), email: sd.email, phone: sd.phone, address: sd.address, city: sd.city } });
    await mk({ ...sd, kind: 'syndic', syndicId: org.id });
    syndics.push(org);
  }
  const gestionnaires = [
    await mk({ name: 'Sophie Lambert', kind: 'individual', jobTitle: 'Gestionnaire', email: 'sophie.lambert@immosyndic-demo.be', phone: '+32 470 11 22 33', syndicId: syndics[0]!.id }),
    await mk({ name: 'Pieter Janssens', kind: 'individual', jobTitle: 'Beheerder', email: 'pieter.janssens@syndicusrand-demo.be', phone: '+32 475 44 55 66', syndicId: syndics[1]!.id }),
    await mk({ name: 'Olivier Renard', kind: 'individual', jobTitle: 'Gestionnaire', email: 'olivier.renard@gestionbrabant-demo.be', phone: '+32 478 77 88 99', syndicId: syndics[2]!.id }),
  ];
  void gestionnaires;
  const acpData = [
    ['ACP Résidence Les Tilleuls', 'Rue du Bailli 42', '1050', 'Ixelles', 0, 24], ['ACP Résidence Parc Léopold', 'Rue Belliard 120', '1040', 'Etterbeek', 0, 36],
    ['ACP Résidence Belvédère', 'Avenue Brugmann 310', '1180', 'Uccle', 0, 18], ['VME Residentie Zonnehof', 'Naamsesteenweg 88', '3000', 'Leuven', 1, 30],
    ['VME Residentie Ter Kameren', 'Tervurenlaan 190', '3080', 'Tervuren', 1, 22], ['ACP Résidence Le Cèdre', 'Avenue des Déportés 15', '1300', 'Wavre', 2, 16],
    ['ACP Résidence Les Érables', 'Chaussée de Bruxelles 210', '1310', 'La Hulpe', 2, 12],
  ] as const;
  const acps = [];
  for (const [name, address, postalCode, city, si, lots] of acpData) {
    acps.push(await mk({ name, kind: 'acp', address, postalCode, city, syndicId: syndics[si]!.id, lotCount: lots, reference: `ACP-${between(100, 999)}`, accessNote: 'Clés chez le concierge, badge parking au rez.' }));
  }
  const langOf = new Map<string, 'fr' | 'nl' | 'en'>(); // langue du client → titres des chantiers, devis et factures
  for (const a of acps) if (/^VME /.test(a.name)) langOf.set(a.id, 'nl');
  const privates = [
    ['Famille Dupont', 'Avenue de Fré 55', '1180', 'Uccle', 'fr'], ['Marie et Luc Peeters', 'Kastanjedreef 7', '3080', 'Tervuren', 'nl'],
    ['Sarah Van den Broeck', 'Rue de la Station 14', '3090', 'Overijse', 'nl'], ['Thomas Martin', 'Drève de Mérode 3', '1410', 'Waterloo', 'fr'],
    ['Emma Claes', 'Wezembeeklaan 40', '1950', 'Kraainem', 'nl'], ['John & Kate Miller', 'Avenue du Lycée Français 9', '1640', 'Rhode-Saint-Genèse', 'en'],
    ['Lucas Janssens', 'Rue de Namur 66', '1300', 'Wavre', 'fr'], ['Isabelle Lemaire', 'Avenue Reine Astrid 22', '1310', 'La Hulpe', 'fr'],
    ['Anna & Mark Thompson', 'Avenue de Tervueren 400', '1150', 'Woluwe-Saint-Pierre', 'en'], ['Koen Vermeulen', 'Bergstraat 18', '1970', 'Wezembeek-Oppem', 'nl'],
    ['Julie Moreau', 'Rue Vanderkindere 101', '1180', 'Uccle', 'fr'], ['David & Laura Cohen', 'Avenue Molière 77', '1190', 'Forest', 'en'],
  ] as const;
  const clients = [];
  for (const [name, address, postalCode, city, lang] of privates) {
    const slug = normalizeName(name).replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '');
    const client = await mk({ name, kind: 'individual', address, postalCode, city, email: `${slug}@example.com`, phone: `+32 4${between(70, 99)} ${between(10, 99)} ${between(10, 99)} ${between(10, 99)}` });
    clients.push(client); langOf.set(client.id, lang);
  }
  const architect = await mk({ name: 'Atelier d’architecture Lumen', kind: 'company', email: 'projets@lumen-demo.be', phone: '+32 2 512 00 11', address: 'Rue Haute 140', postalCode: '1000', city: 'Bruxelles', vat: 'BE 0745.111.222' });
  const promoterOrg = await prisma.promoter.create({ data: { name: 'Brabant Living SA', normalizedName: normalizeName('Brabant Living SA'), email: 'projets@brabantliving-demo.be', phone: '+32 10 45 67 89', address: 'Boulevard de Lauzelle 65', city: 'Louvain-la-Neuve' } });
  await mk({ name: 'Brabant Living SA', kind: 'promoter', promoterId: promoterOrg.id, email: 'projets@brabantliving-demo.be', phone: '+32 10 45 67 89', address: 'Boulevard de Lauzelle 65', postalCode: '1348', city: 'Louvain-la-Neuve', vat: 'BE 0756.222.333' });
  // le projet (kind='developer') rattaché au promoteur : c'est lui qui porte les chantiers
  const promoter = await mk({ name: 'Résidence Les Jardins d’Ottignies', kind: 'developer', promoterId: promoterOrg.id, email: 'projets@brabantliving-demo.be', phone: '+32 10 45 67 89', address: 'Avenue des Combattants 12', postalCode: '1340', city: 'Ottignies' });
  const resto = await mk({ name: 'Restaurant Le Petit Sablon', kind: 'company', email: 'gerance@petitsablon-demo.be', phone: '+32 2 511 22 33', address: 'Rue de la Régence 31', postalCode: '1000', city: 'Bruxelles', vat: 'BE 0767.333.444' });
  const suppliersData = [
    ['Matériaux Dewaele', 'Matériaux de construction'], ['Sanitaire Center Wavre', 'Sanitaire & chauffage'], ['Peinture Pro Brussels', 'Peintures'],
    ['Bois & Panneaux Soignies', 'Bois'], ['Électro Groupe Zaventem', 'Électricité'], ['Toitures & Zinc Brabant', 'Toiture'], ['Location Machines Plus', 'Location'],
  ] as const;
  const suppliers = [];
  for (const [name, note] of suppliersData) suppliers.push(await mk({ name, type: 'supplier', kind: 'company', note, email: `commandes@${normalizeName(name).replace(/[^a-z]+/g, '')}-demo.be`, onAccount: true }));

  // ------------------------------------------------------------------------------------------- comptes
  const hash = await bcrypt.hash(process.env.DEMO_PASSWORD!, 12);
  const marcUser = { personId: people[0]!.id };
  const users = [
    { email: 'direction@demo.jjd-consult.be', role: 'admin', locale: 'fr', isPartner: true },
    { email: 'bureau@demo.jjd-consult.be', role: 'office', locale: 'fr', personId: office.id },
    { email: 'office.nl@demo.jjd-consult.be', role: 'office', locale: 'nl' },
    { email: 'office.en@demo.jjd-consult.be', role: 'office', locale: 'en' },
    { email: 'chef@demo.jjd-consult.be', role: 'foreman', locale: 'fr', ...marcUser },
    { email: 'ouvrier@demo.jjd-consult.be', role: 'worker', locale: 'fr', personId: people[2]!.id },
    // portail client
    { email: 'client@demo.jjd-consult.be', role: 'client', locale: 'fr', contactId: clients[0]!.id },
    { email: 'klant@demo.jjd-consult.be', role: 'client', locale: 'nl', contactId: clients[1]!.id },
    { email: 'customer@demo.jjd-consult.be', role: 'client', locale: 'en', contactId: clients[5]!.id },
    { email: 'syndic@demo.jjd-consult.be', role: 'client', locale: 'fr', syndicId: syndics[0]!.id },
    { email: 'syndicus@demo.jjd-consult.be', role: 'client', locale: 'nl', syndicId: syndics[1]!.id },
    { email: 'resident@demo.jjd-consult.be', role: 'client', locale: 'fr', residentOfId: acps[0]!.id, portalAccess: 'limited' },
    { email: 'promoteur@demo.jjd-consult.be', role: 'client', locale: 'fr', promoterId: promoterOrg.id },
  ];
  const userIds: Record<string, string> = {};
  for (const u of users) userIds[u.email] = (await prisma.user.create({ data: { passwordHash: hash, ...u } as never })).id;
  const adminId = userIds['direction@demo.jjd-consult.be']!;

  // ------------------------------------------------------------------------------------------- chantiers
  type Line = { kind?: string; label: string; description?: string; qty?: number; unit?: string; unitPriceHt?: number; vatRate?: number };
  const TEMPLATES: { title: string; brief: string; vat: number; lines: Line[]; tasks: string[]; trades: string[] }[] = [
    { title: 'Rénovation salle de bain', brief: 'Démolition, plomberie, carrelage sol/murs, douche à l’italienne, meuble vasque.', vat: 0.06, trades: ['sanitaire', 'carreleur'],
      lines: [{ kind: 'section', label: 'Démolition' }, { label: 'Démolition carrelage et sanitaires existants, évacuation', qty: 1, unit: 'forfait', unitPriceHt: 1450 },
        { kind: 'section', label: 'Sanitaire' }, { label: 'Alimentations et décharges encastrées', qty: 1, unit: 'forfait', unitPriceHt: 2350 }, { label: 'Douche à l’italienne avec caniveau', qty: 1, unit: 'pc', unitPriceHt: 1890 },
        { kind: 'section', label: 'Carrelage' }, { label: 'Étanchéité sous carrelage', qty: 14, unit: 'm²', unitPriceHt: 38 }, { label: 'Pose carrelage grand format', qty: 32, unit: 'm²', unitPriceHt: 72 }],
      tasks: ['Démolition et évacuation', 'Plomberie encastrée', 'Étanchéité', 'Pose carrelage', 'Installation sanitaires', 'Joints silicone et nettoyage'] },
    { title: 'Cuisine sur mesure', brief: 'Dépose ancienne cuisine, adaptation électricité et arrivées d’eau, pose cuisine, crédence.', vat: 0.06, trades: ['menuisier', 'électricien'],
      lines: [{ label: 'Dépose et évacuation cuisine existante', qty: 1, unit: 'forfait', unitPriceHt: 650 }, { label: 'Adaptation circuits électriques (CE, prises, éclairage)', qty: 1, unit: 'forfait', unitPriceHt: 1780 },
        { label: 'Pose meubles de cuisine et plan de travail', qty: 1, unit: 'forfait', unitPriceHt: 2950 }, { label: 'Crédence céramique', qty: 6, unit: 'm²', unitPriceHt: 95 }],
      tasks: ['Dépose', 'Électricité', 'Arrivées d’eau', 'Pose des meubles', 'Crédence', 'Réception client'] },
    { title: 'Réfection de toiture', brief: 'Toiture plate : dépose ancienne étanchéité, isolation PIR 12 cm, EPDM, rives alu.', vat: 0.06, trades: ['couvreur'],
      lines: [{ label: 'Dépose étanchéité existante', qty: 85, unit: 'm²', unitPriceHt: 14 }, { label: 'Isolation PIR 120 mm', qty: 85, unit: 'm²', unitPriceHt: 46 },
        { label: 'Membrane EPDM collée', qty: 85, unit: 'm²', unitPriceHt: 39 }, { label: 'Rives et profils aluminium', qty: 38, unit: 'mct', unitPriceHt: 32 }, { label: 'Échafaudage et sécurité', qty: 1, unit: 'forfait', unitPriceHt: 980 }],
      tasks: ['Montage échafaudage', 'Dépose ancienne étanchéité', 'Isolation', 'EPDM', 'Rives', 'Démontage et nettoyage'] },
    { title: 'Peinture des parties communes', brief: 'Cage d’escalier 5 étages : préparation, enduit, 2 couches, mains courantes.', vat: 0.06, trades: ['peintre'],
      lines: [{ label: 'Protection et préparation des supports', qty: 1, unit: 'forfait', unitPriceHt: 1150 }, { label: 'Enduisage et ponçage', qty: 420, unit: 'm²', unitPriceHt: 8.5 },
        { label: 'Peinture murs 2 couches', qty: 420, unit: 'm²', unitPriceHt: 12 }, { label: 'Laquage mains courantes et portes', qty: 1, unit: 'forfait', unitPriceHt: 1380 }],
      tasks: ['Protections', 'Enduisage', 'Première couche', 'Deuxième couche', 'Laquage', 'Réception syndic'] },
    { title: 'Infiltration en façade', brief: 'Recherche de fuite, réparation joints et rejointoyage, hydrofuge, réparation plafond du lot touché.', vat: 0.21, trades: ['façadier', 'plafonneur'],
      lines: [{ label: 'Recherche de fuite et rapport', qty: 1, unit: 'forfait', unitPriceHt: 420 }, { label: 'Nacelle (journée)', qty: 2, unit: 'jour', unitPriceHt: 390 },
        { label: 'Rejointoyage façade', qty: 36, unit: 'm²', unitPriceHt: 58 }, { label: 'Hydrofuge incolore', qty: 120, unit: 'm²', unitPriceHt: 11 }, { label: 'Réparation plafond lot 3B', qty: 1, unit: 'forfait', unitPriceHt: 640 }],
      tasks: ['Recherche de fuite', 'Rejointoyage', 'Hydrofuge', 'Réparation intérieure', 'Rapport au syndic'] },
    { title: 'Rénovation complète appartement', brief: 'Plafonnage, électricité, sols, peinture, salle de douche — appartement 2 chambres.', vat: 0.06, trades: ['plafonneur', 'électricien', 'peintre'],
      lines: [{ kind: 'section', label: 'Gros œuvre' }, { label: 'Démolition cloisons et évacuation', qty: 1, unit: 'forfait', unitPriceHt: 2600 }, { label: 'Plafonnage murs et plafonds', qty: 240, unit: 'm²', unitPriceHt: 24 },
        { kind: 'section', label: 'Techniques' }, { label: 'Électricité complète + conformité', qty: 1, unit: 'forfait', unitPriceHt: 7400 }, { label: 'Salle de douche complète', qty: 1, unit: 'forfait', unitPriceHt: 8900 },
        { kind: 'section', label: 'Finitions' }, { label: 'Parquet contrecollé chêne', qty: 68, unit: 'm²', unitPriceHt: 64 }, { label: 'Peinture 2 couches', qty: 310, unit: 'm²', unitPriceHt: 11 }],
      tasks: ['Démolition', 'Électricité (saignées, tubage)', 'Plafonnage', 'Salle de douche', 'Parquet', 'Peinture', 'Contrôle électrique', 'Réception'] },
    { title: 'Remplacement des châssis', brief: 'Châssis PVC triple vitrage, dépose, pose, finitions intérieures, PEB.', vat: 0.06, trades: ['menuisier'],
      lines: [{ label: 'Châssis PVC triple vitrage (fourniture)', qty: 9, unit: 'pc', unitPriceHt: 890 }, { label: 'Dépose et pose', qty: 9, unit: 'pc', unitPriceHt: 260 }, { label: 'Finitions intérieures (plafonnage, tablettes)', qty: 1, unit: 'forfait', unitPriceHt: 1450 }],
      tasks: ['Mesures', 'Commande', 'Dépose / pose', 'Finitions', 'Réception'] },
    { title: 'Terrasse et aménagement extérieur', brief: 'Terrasse en bois exotique 40 m², fondations plots, éclairage encastré.', vat: 0.21, trades: ['menuisier', 'manœuvre'],
      lines: [{ label: 'Terrassement et plots béton', qty: 40, unit: 'm²', unitPriceHt: 42 }, { label: 'Structure et lames ipé', qty: 40, unit: 'm²', unitPriceHt: 155 }, { label: 'Éclairage encastré', qty: 8, unit: 'pc', unitPriceHt: 85 }],
      tasks: ['Terrassement', 'Plots', 'Structure', 'Lames', 'Éclairage'] },
    { title: 'Sol chauffant et chape', brief: 'Sol chauffant basse température, chape fluide, isolation, raccord PAC.', vat: 0.06, trades: ['sanitaire', 'chape'],
      lines: [{ label: 'Isolation de sol PUR projetée', qty: 75, unit: 'm²', unitPriceHt: 21 }, { label: 'Sol chauffant (tubes, collecteur)', qty: 75, unit: 'm²', unitPriceHt: 39 }, { label: 'Chape fluide anhydrite', qty: 75, unit: 'm²', unitPriceHt: 26 }],
      tasks: ['Isolation projetée', 'Pose tubes', 'Test pression', 'Chape fluide', 'Mise en chauffe'] },
    { title: 'Mise en conformité électrique', brief: 'Nouveau tableau, différentiels, circuits séparés, contrôle par organisme agréé.', vat: 0.21, trades: ['électricien'],
      lines: [{ label: 'Tableau électrique complet', qty: 1, unit: 'pc', unitPriceHt: 1650 }, { label: 'Circuits et points lumineux', qty: 24, unit: 'pc', unitPriceHt: 68 }, { label: 'Contrôle organisme agréé', qty: 1, unit: 'forfait', unitPriceHt: 240 }],
      tasks: ['Tableau', 'Circuits', 'Contrôle', 'Schémas unifilaires'] },
  ];
  // [modèle, client, statut, jours depuis la demande, ACP ?]
  type Plan = [number, string, string, number];
  const all: { id: string; kind: string; name: string; city: string; address: string; postalCode: string }[] = [
    ...clients.map((c) => ({ id: c.id, kind: 'individual', name: c.name, city: c.city!, address: c.address!, postalCode: c.postalCode! })),
    ...acps.map((c) => ({ id: c.id, kind: 'acp', name: c.name, city: c.city!, address: c.address!, postalCode: c.postalCode! })),
    { id: architect.id, kind: 'company', name: architect.name, city: 'Bruxelles', address: 'Rue Haute 140', postalCode: '1000' },
    { id: promoter.id, kind: 'developer', name: promoter.name, city: 'Ottignies', address: 'Avenue des Combattants 12', postalCode: '1340' },
    { id: resto.id, kind: 'company', name: resto.name, city: 'Bruxelles', address: resto.address!, postalCode: resto.postalCode! },
  ];
  const byName = (n: string) => all.find((a) => a.name === n)!;
  const plans: Plan[] = [
    [0, 'Famille Dupont', 'in_progress', 45], [5, 'Marie et Luc Peeters', 'in_progress', 70], [2, 'ACP Résidence Les Tilleuls', 'in_progress', 40],
    [3, 'ACP Résidence Parc Léopold', 'scheduled', 30], [4, 'VME Residentie Zonnehof', 'in_progress', 25], [1, 'Sarah Van den Broeck', 'to_plan', 20],
    [6, 'Thomas Martin', 'quote_sent', 12], [7, 'John & Kate Miller', 'quote_sent', 9], [8, 'Emma Claes', 'scheduled', 28], [9, 'Lucas Janssens', 'done', 60],
    [0, 'Isabelle Lemaire', 'to_invoice', 75], [4, 'ACP Résidence Belvédère', 'invoiced', 95], [3, 'VME Residentie Ter Kameren', 'closed', 160],
    [2, 'ACP Résidence Le Cèdre', 'closed', 140], [5, 'Atelier d’architecture Lumen', 'in_progress', 90], [5, 'Résidence Les Jardins d’Ottignies', 'scheduled', 55],
    [1, 'Restaurant Le Petit Sablon', 'invoiced', 110], [6, 'Anna & Mark Thompson', 'lead', 3], [0, 'Koen Vermeulen', 'quote_needed', 6],
    [8, 'Julie Moreau', 'refused', 50], [9, 'David & Laura Cohen', 'closed', 190], [4, 'ACP Résidence Les Érables', 'on_hold', 35],
    [7, 'Famille Dupont', 'closed', 220], [3, 'ACP Résidence Les Tilleuls', 'invoiced', 120], [2, 'Résidence Les Jardins d’Ottignies', 'to_plan', 18],
    [9, 'Marie et Luc Peeters', 'quote_sent', 14], [4, 'ACP Résidence Parc Léopold', 'closed', 260], [1, 'Thomas Martin', 'closed', 300],
    [6, 'Emma Claes', 'lead', 2], [0, 'Sarah Van den Broeck', 'quote_needed', 4], [8, 'Isabelle Lemaire', 'cancelled', 80],
    [5, 'Restaurant Le Petit Sablon', 'in_progress', 50], [3, 'VME Residentie Zonnehof', 'quote_sent', 10], [9, 'Lucas Janssens', 'closed', 330],
  ];

  let refN = 1001;
  const counters: Record<string, number> = {};
  const nextNo = (kind: string, date: Date) => { const y = date.getFullYear(); const k = `${kind}:${y}`; counters[k] = (counters[k] ?? 0) + 1; return formatDocNumber(kind, y, counters[k]!); };
  let commN = 410_000;
  const plannedSites: { id: string; ref: string; crew: string[]; vehicle: string; tasks: string[]; status: string; title: string }[] = [];

  const TITLES: Record<string, [string, string]> = {
    'Rénovation salle de bain': ['Renovatie badkamer', 'Bathroom renovation'],
    'Cuisine sur mesure': ['Keuken op maat', 'Custom kitchen'],
    'Réfection de toiture': ['Dakherstelling', 'Roof repair'],
    'Peinture des parties communes': ['Schilderwerken gemeenschappelijke delen', 'Painting of common areas'],
    'Infiltration en façade': ['Waterinsijpeling gevel', 'Façade water leak'],
    'Rénovation complète appartement': ['Volledige renovatie appartement', 'Full apartment renovation'],
    'Remplacement des châssis': ['Vervanging ramen', 'Window replacement'],
    'Terrasse et aménagement extérieur': ['Terras en buitenaanleg', 'Terrace and landscaping'],
    'Sol chauffant et chape': ['Vloerverwarming en chape', 'Underfloor heating and screed'],
    'Mise en conformité électrique': ['Elektrische keuring en aanpassing', 'Electrical compliance upgrade'],
  };
  const titleFor = (fr: string, contactId: string) => { const l = langOf.get(contactId); return l === 'nl' ? TITLES[fr]?.[0] ?? fr : l === 'en' ? TITLES[fr]?.[1] ?? fr : fr; };

  for (const [ti, clientName, status, age] of plans) {
    const t = TEMPLATES[ti]!;
    const c = byName(clientName);
    const isAcp = c.kind === 'acp';
    const created = d(-age);
    const ref = `R-${refN++}`;
    const crew = [...people].sort(() => rnd() - 0.5).slice(0, between(2, 4)).map((p) => p.id);
    const started = ['in_progress', 'done', 'to_invoice', 'invoiced', 'closed', 'on_hold'].includes(status);
    const ws = await prisma.worksite.create({
      data: {
        ref, title: `${titleFor(t.title, c.id)} — ${c.name.replace(/^(ACP|VME) /, '')}`, kind: 'project', entity: 'jjd', status, priority: status === 'in_progress' && rnd() < 0.3 ? 'high' : 'normal',
        clientId: c.id, acpId: isAcp ? c.id : null, managerId: people[0]!.id, address: c.address, postalCode: c.postalCode, city: c.city,
        siteBrief: t.brief, description: t.brief, partType: isAcp ? pick(['commun', 'privatif']) : null, requestKind: isAcp ? pick(['ponctuelle', 'sav', 'renovation']) : 'renovation',
        billingMode: 'devis', billingCadence: 'acompte_avancement_solde', accessNotes: isAcp ? 'Clés chez le concierge (8h–12h). Prévenir le syndic 48 h avant.' : 'Client présent le matin, se garer dans l’allée.',
        startedOn: started ? d(-age + between(10, 25)) : null, endedOn: ['done', 'to_invoice', 'invoiced', 'closed'].includes(status) ? d(-between(5, Math.max(6, age - 30))) : null,
        lat: 50.85 + (rnd() - 0.5) * 0.25, lng: 4.4 + (rnd() - 0.5) * 0.35, source: S, createdAt: created,
      },
    });

    // devis
    const lines = t.lines.map((l) => ({ kind: l.kind ?? 'item', label: l.label, description: l.description ?? null, qty: l.qty ?? 1, unit: l.unit ?? null, unitPriceHt: r2((l.unitPriceHt ?? 0) * (0.9 + rnd() * 0.3)), discountPct: 0, vatRate: isAcp ? 0.21 : t.vat }));
    const totals = computeDocTotals(lines);
    const qStatus = ['lead', 'quote_needed'].includes(status) ? (status === 'quote_needed' ? 'draft' : null) : status === 'quote_sent' ? 'sent' : status === 'refused' ? 'declined' : status === 'cancelled' ? 'expired' : 'accepted';
    await prisma.worksite.update({ where: { id: ws.id }, data: { quotedHt: qStatus ? totals.totalHt : null } });
    const qDate = d(-age + between(2, 6));
    let quoteId: string | null = null;
    if (qStatus) {
      const q = await prisma.document.create({
        data: {
          kind: 'quote', direction: 'sale', number: qStatus === 'draft' ? null : nextNo('quote', qDate), draftRef: qStatus === 'draft' ? `BROUILLON-${ref}` : null,
          worksiteId: ws.id, contactId: c.id, status: qStatus, title: ws.title, intro: 'Suite à notre visite, nous avons le plaisir de vous remettre notre meilleure offre.',
          terms: 'Acompte de 30 % à la commande, 40 % à l’avancement, solde à la réception. Validité 30 jours.', issuedOn: qDate, validUntil: d(-age + 36),
          acceptedOn: qStatus === 'accepted' ? d(-age + between(8, 14)) : null, totalHt: totals.totalHt, totalVat: totals.totalVat, totalTtc: totals.totalTtc, vatRate: isAcp ? 0.21 : t.vat,
          billingName: c.name, billingAddress: `${c.address}, ${c.postalCode} ${c.city}`, lockedAt: qStatus === 'draft' ? null : qDate, source: S,
          lines: { create: lines.map((l, i) => ({ ...l, position: i, totalHt: r2(l.qty * l.unitPriceHt) })) },
        },
      });
      quoteId = q.id;
    }

    // factures (acompte 30 %, avancement 40 %, solde 30 %)
    if (quoteId && qStatus === 'accepted' && status !== 'to_plan') {
      const lg = langOf.get(c.id) ?? 'fr';
      const L = { fr: ['Acompte 30 % à la commande', 'Facture d’avancement 40 %', 'Facture de solde'], nl: ['Voorschot 30 % bij bestelling', 'Vorderingsfactuur 40 %', 'Saldofactuur'], en: ['30% deposit on order', '40% progress invoice', 'Final invoice'] }[lg];
      const steps: [string, number, number][] = [[L[0], 0.3, -age + 15]];
      if (['in_progress', 'done', 'to_invoice', 'invoiced', 'closed', 'on_hold'].includes(status) && age > 30) steps.push([L[1], 0.4, -age + 35]);
      if (['invoiced', 'closed'].includes(status)) steps.push([L[2], 0.3, -between(8, 30)]);
      for (const [i, [label, pct, when]] of steps.entries()) {
        const issued = d(Math.min(when, -1));
        const ht = r2(totals.totalHt * pct);
        const vat = r2(ht * (isAcp ? 0.21 : t.vat));
        const ttc = r2(ht + vat);
        const last = i === steps.length - 1;
        const paid = status === 'closed' || !last ? ttc : status === 'invoiced' && rnd() < 0.4 ? r2(ttc * 0.5) : 0;
        const due = new Date(issued.getTime() + 15 * DAY);
        const st = paid >= ttc ? 'paid' : paid > 0 ? 'partial' : due < today ? 'overdue' : 'sent';
        const inv = await prisma.document.create({
          data: {
            kind: i === 0 ? 'deposit_invoice' : 'invoice', direction: 'sale', number: nextNo(i === 0 ? 'deposit_invoice' : 'invoice', issued), worksiteId: ws.id, contactId: c.id, parentId: quoteId,
            status: st, title: `${label} — ${ws.title}`, issuedOn: issued, dueOn: due, totalHt: ht, totalVat: vat, totalTtc: ttc, vatRate: isAcp ? 0.21 : t.vat, paidAmount: paid, paidOn: paid >= ttc ? new Date(issued.getTime() + between(4, 14) * DAY) : null,
            billingName: c.name, billingAddress: `${c.address}, ${c.postalCode} ${c.city}`, structuredComm: belgianStructuredComm(commN++), lockedAt: issued, sentAt: issued, source: S,
            lines: { create: [{ kind: 'item', label, qty: 1, unitPriceHt: ht, vatRate: isAcp ? 0.21 : t.vat, position: 0, totalHt: ht }] },
          },
        });
        await prisma.ledgerEntry.create({
          data: {
            date: issued, year: issued.getFullYear(), month: String(issued.getMonth() + 1), direction: 'sale', docType: 'Facture de vente', docNumber: inv.number, documentId: inv.id,
            worksiteId: ws.id, worksiteRef: ref, contactId: c.id, ht, ttc, vatRate: isAcp ? 0.21 : t.vat, paymentStatus: st === 'paid' ? 'Payé' : st === 'partial' ? 'Partiel' : 'Non payé', paidOn: inv.paidOn, dueDate: due, source: S,
          },
        });
      }
    }

    // achats chantier
    if (started) {
      for (let k = 0; k < between(2, 5); k++) {
        const sup = pick(suppliers);
        const when = d(-age + between(12, Math.max(13, age - 2)));
        const ht = between(180, 2400);
        const paidAp = rnd() < 0.7;
        await prisma.ledgerEntry.create({
          data: {
            date: when, year: when.getFullYear(), month: String(when.getMonth() + 1), direction: 'purchase', docType: 'Facture d’achat', docNumber: `${between(20, 24)}/${between(100000, 999999)}`,
            worksiteId: ws.id, worksiteRef: ref, contactId: sup.id, supplierName: sup.name, categoryRaw: 'Matériel - Général', ht, vatRecup: r2(ht * 0.21), ttc: r2(ht * 1.21), vatRate: 0.21,
            paymentStatus: paidAp ? 'Payé' : 'Non payé', paidOn: paidAp ? new Date(when.getTime() + 20 * DAY) : null, dueDate: new Date(when.getTime() + 30 * DAY), source: S,
          },
        });
      }
    }

    // pointages (jours ouvrés passés du chantier)
    if (started) {
      const from = -age + between(10, 25);
      const to = ['in_progress', 'on_hold'].includes(status) ? -1 : Math.min(-5, from + between(6, 20));
      const days = workdays(from, to);
      for (const day of days) {
        for (const pid of crew) {
          if (rnd() < 0.15) continue;
          const p = people.find((x) => x.id === pid)!;
          const hours = pick([8, 8.5, 9, 9, 9.5, 10]);
          const recent = day >= -3 && status === 'in_progress';
          await prisma.timeEntry.create({
            data: {
              personId: pid, worksiteId: ws.id, worksiteRef: ref, date: d(day), hours, amount: r2(hours * p.rate), rateUsed: p.rate, task: pick(t.tasks),
              startedAt: d(day, 7.5), endedAt: d(day, 7.5 + hours + 0.5), status: recent ? 'submitted' : 'approved', approvedById: recent ? null : adminId, source: S,
            },
          });
        }
      }
    }

    // tâches
    const doneCount = status === 'closed' || status === 'invoiced' || status === 'to_invoice' || status === 'done' ? t.tasks.length : status === 'in_progress' ? between(1, t.tasks.length - 2) : 0;
    await prisma.worksiteTask.createMany({ data: t.tasks.map((title, i) => ({ worksiteId: ws.id, title, position: i, status: i < doneCount ? 'done' : i === doneCount && status === 'in_progress' ? 'doing' : 'todo' })) });

    // fil de chantier
    if (started || status === 'scheduled') {
      const thread = await prisma.thread.create({ data: { worksiteId: ws.id } });
      const msgs = [
        [people[0]!.name, 'Planning confirmé avec le client, démarrage comme prévu.'],
        [people[1]!.name, 'Matériel livré sur place, tout est conforme à la commande.'],
        [c.name, isAcp ? 'Merci de prévenir les occupants du 3e étage avant les travaux bruyants.' : 'Parfait, merci pour le suivi régulier !'],
        [people[0]!.name, 'Photos de l’avancement ajoutées. On termine la phase en cours cette semaine.'],
      ];
      for (const [i, [who, body]] of msgs.entries()) await prisma.message.create({ data: { threadId: thread.id, authorName: who, kind: 'text', body, source: S, createdAt: d(-Math.max(1, age - 10 - i * 4), 9 + i) } });
    }

    // rapports
    if (['done', 'to_invoice', 'invoiced', 'closed'].includes(status)) {
      await prisma.worksiteReport.create({ data: { worksiteId: ws.id, authorName: people[0]!.name, date: d(-between(6, 30)), workDone: `Travaux terminés : ${t.tasks.join(', ').toLowerCase()}. Chantier nettoyé, déchets évacués.`, notes: 'Client satisfait. Garantie et fiches techniques remises.', status: 'signed', clientName: c.name, signedAt: d(-between(5, 25)) } });
    } else if (status === 'in_progress') {
      await prisma.worksiteReport.create({ data: { worksiteId: ws.id, authorName: people[0]!.name, date: d(-2), workDone: `Avancement : ${t.tasks.slice(0, Math.max(1, doneCount)).join(', ').toLowerCase()}.`, notes: 'Prochaine étape planifiée en début de semaine prochaine.', status: 'draft' } });
    }

    if (['in_progress', 'scheduled', 'to_plan', 'on_hold'].includes(status)) plannedSites.push({ id: ws.id, ref, crew, vehicle: pick(vehicles), tasks: t.tasks, status, title: ws.title });
  }

  // ------------------------------------------------------------------------------------------- planning (passé proche + 3 semaines)
  for (const site of plannedSites) {
    const range = site.status === 'in_progress' ? workdays(-5, 18) : site.status === 'scheduled' ? workdays(between(2, 8), 20) : site.status === 'to_plan' ? [] : workdays(-10, -6);
    let i = 0;
    for (const day of range) {
      if (site.status !== 'in_progress' && rnd() < 0.35) continue;
      const ev = await prisma.planningEvent.create({
        data: {
          worksiteId: site.id, title: site.tasks[i % site.tasks.length], startAt: d(day, 7.5), endAt: d(day, 17), status: day > 10 && rnd() < 0.3 ? 'tentative' : 'confirmed',
          leadPersonId: site.crew[0], driverPersonId: site.crew[0], departureAt: d(day, 7), departureFrom: 'Dépôt Overijse', tasksNote: site.tasks[i % site.tasks.length], source: S,
          assignments: { create: site.crew.map((personId) => ({ personId })) },
          vehicles: { create: [{ vehicleId: site.vehicle, driverPersonId: site.crew[0] }] },
        } as never,
      });
      void ev; i++;
    }
  }
  // rendez-vous commerciaux
  for (const [day, title, wsi] of [[1, 'Visite technique — devis cuisine', 0], [3, 'Réunion de chantier avec l’architecte', 14], [6, 'Assemblée générale ACP — présentation devis', 2]] as const) {
    const site = await prisma.worksite.findFirst({ where: { ref: `R-${1001 + wsi}` } });
    if (site) await prisma.planningEvent.create({ data: { worksiteId: site.id, title, kind: 'meeting', startAt: d(day, 10), endAt: d(day, 11.5), status: 'confirmed', assignments: { create: [{ personId: people[0]!.id }] }, source: S } as never });
  }

  await prisma.setting.create({ data: { key: MARK, value: { version: 1, createdAt: new Date().toISOString(), worksites: plans.length } } });
  // traductions anglaises de l'interface déjà en cache : la démo s'affiche en anglais d'emblée, sans attendre DeepL
  const en = JSON.parse(readFileSync(new URL('./demo-ui-en.json', import.meta.url), 'utf8')) as Record<string, string>;
  await prisma.uiTranslation.createMany({ data: Object.entries(en).map(([source, body]) => ({ locale: 'en', source, body })), skipDuplicates: true });

  console.log('Démo commerciale prête :', { chantiers: plans.length, clients: clients.length + acps.length + 3, equipe: people.length, comptes: users.map((u) => u.email) });
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
