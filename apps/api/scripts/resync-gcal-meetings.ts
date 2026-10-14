/**
 * Repousse vers Google Agenda les rendez-vous d'affaire récents et à venir (couleur jaune, titre et détail à jour).
 * Sert à rattraper les fiches importées de Google dont la mise à jour échouait (identifiant « …@google.com » mal pris en compte).
 * Ne touche pas à la base JJD, seulement à l'agenda Google. Sans --apply : simulation (liste seulement).
 */
import { prisma } from '../src/db.js';
import { syncToGoogle } from '../src/routes/planning.js';
import { gcalEnabled } from '../src/lib/gcal.js';

const APPLY = process.argv.includes('--apply');

async function run() {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const events = await prisma.planningEvent.findMany({
    where: { kind: 'meeting', googleEventId: { not: null }, startAt: { gte: since } },
    select: { id: true, startAt: true, source: true, googleEventId: true, worksite: { select: { ref: true, title: true } } },
    orderBy: { startAt: 'asc' },
  });
  console.log(APPLY ? 'MODE APPLY' : 'SIMULATION', '| Google Agenda actif:', gcalEnabled(), '| rendez-vous à repousser:', events.length);
  for (const e of events) console.log(e.startAt.toISOString().slice(0, 16), e.worksite.ref, e.worksite.title.slice(0, 50), e.source === 'agenda-import' ? '(importé de Google)' : '');
  if (!APPLY) { await prisma.$disconnect(); return; }
  if (!gcalEnabled()) { console.log('Google Agenda n’est pas configuré : rien à faire.'); await prisma.$disconnect(); return; }
  let ok = 0;
  for (const e of events) { if (await syncToGoogle(e.id)) ok++; }
  console.log('Rendez-vous repoussés vers Google :', ok);
  await prisma.$disconnect();
}
run().catch((e) => { console.error(e); process.exit(1); });
