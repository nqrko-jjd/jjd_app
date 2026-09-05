import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { CATEGORY_SEED } from './categories.js';

// Autonome (pas d'import de src/) pour tourner aussi dans l'image Docker de prod.
const hashPassword = (pw: string) => bcrypt.hash(pw, 10);

const prisma = new PrismaClient();

async function main() {
  // ── Catégories comptables
  for (const c of CATEGORY_SEED) {
    await prisma.category.upsert({
      where: { code: c.code },
      create: { code: c.code, label: c.label, kind: c.kind, entity: c.entity ?? null },
      update: { label: c.label, kind: c.kind, entity: c.entity ?? null },
    });
    // Les chantiers "frais généraux" (E-xx) portent le même intitulé que leur catégorie —
    // corrige les titres déjà importés si le libellé source (categories.ts) a changé depuis.
    if (c.code.startsWith('E-')) {
      await prisma.worksite.updateMany({ where: { ref: c.code, kind: 'overhead' }, data: { title: c.label } });
    }
  }

  // ── Paramètres société
  await prisma.setting.upsert({
    where: { key: 'company' },
    create: {
      key: 'company',
      value: {
        name: 'JJD Consult',
        email: 'info@jjd-consult.be',
        website: 'https://www.jjd-consult.be',
        vat: '',
        entities: ['jjd', 'tonton'],
        partnerShareTonton: 1 / 3,
      },
    },
    update: {},
  });

  // ── Comptes de démarrage (mot de passe : "jjd" — à changer)
  const pw = await hashPassword('jjd');
  const demo: { email: string; role: string; isPartner: boolean }[] = [
    { email: 'david@jjd-consult.be', role: 'admin', isPartner: true },
    { email: 'julien@jjd-consult.be', role: 'admin', isPartner: true },
    { email: 'melvina@jjd-consult.be', role: 'office', isPartner: false },
    { email: 'chef@jjd-consult.be', role: 'foreman', isPartner: false },
    { email: 'ouvrier@jjd-consult.be', role: 'worker', isPartner: false },
  ];
  for (const u of demo) {
    await prisma.user.upsert({
      where: { email: u.email },
      create: { email: u.email, passwordHash: pw, role: u.role, isPartner: u.isPartner },
      update: { role: u.role, isPartner: u.isPartner },
    });
  }

  // ── Compteur R- : démarre au-dessus du plus haut numéro connu (~780)
  await prisma.counter.upsert({
    where: { name: 'worksite' },
    create: { name: 'worksite', value: 780 },
    update: {},
  });

  const counts = {
    categories: await prisma.category.count(),
    users: await prisma.user.count(),
  };
  console.log('Seed OK', counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
