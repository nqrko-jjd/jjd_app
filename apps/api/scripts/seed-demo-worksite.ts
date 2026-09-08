/**
 * Crée un chantier de démonstration entièrement peuplé (devis/factures, dépenses,
 * pointages, rapport signé, fil de chantier, tâches, stock…) pour tester toutes
 * les fonctionnalités sans devoir chercher un vrai chantier qui les a toutes.
 *
 *   npm run seed:demo   (ou : docker compose … run --rm api sh -c "cd apps/api && npx tsx scripts/seed-demo-worksite.ts")
 *
 * Idempotent : relancer supprime d'abord tout ce qui porte déjà ref="DEMO-1"
 * (et son fil / rapports / tâches / mouvements de stock) puis recrée.
 *
 * IMPORTANT — tout ce qui alimenterait les rapports financiers agrégés
 * (Document, LedgerEntry, TimeEntry, Worksite) est marqué `source: 'demo'` :
 * le tableau de bord, l'Analyse, le P&L consolidé et le partage de bénéfices
 * l'excluent explicitement (voir lib/dashboard.ts, consolidated.ts, analytics.ts).
 * Ne JAMAIS retirer ce marquage sans vérifier ces exclusions.
 */
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import { nanoid } from 'nanoid';
import { normalizeName, computeDocTotals, belgianStructuredComm } from '@jjd/shared';

// Stockage local, dupliqué en miniature de lib/media.ts plutôt qu'importé : ce script tourne
// via `tsx` dans le conteneur de PRODUCTION, où seul le code compilé (dist/) est présent —
// un import relatif vers ../src/lib/… n'y existe pas (contrairement à un environnement de dev).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(root, 'uploads');

async function storeImage(buffer: Buffer): Promise<{ url: string; thumbUrl: string }> {
  const now = new Date();
  const rel = path.join('media', String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'));
  const dir = path.join(UPLOADS_DIR, rel);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const id = nanoid(14);
  const img = sharp(buffer, { failOn: 'none' }).rotate();
  await img.clone().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toFile(path.join(dir, `${id}.webp`));
  await img.clone().resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).webp({ quality: 72 }).toFile(path.join(dir, `${id}_t.webp`));
  const base = `/uploads/${rel.replace(/\\/g, '/')}`;
  return { url: `${base}/${id}.webp`, thumbUrl: `${base}/${id}_t.webp` };
}
function storeFile(buffer: Buffer, originalName: string, subdir = 'files'): string {
  const now = new Date();
  const rel = path.join(subdir, String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'));
  const dir = path.join(UPLOADS_DIR, rel);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const ext = (originalName.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase();
  const name = `${nanoid(14)}${ext}`;
  writeFileSync(path.join(dir, name), buffer);
  return `/uploads/${rel.replace(/\\/g, '/')}/${name}`;
}

const prisma = new PrismaClient();
const REF = 'DEMO-1';

// mini PNG 1×1 valide (photo de rapport / fil de chantier)
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
// mini PDF valide (pièce jointe de dépense)
const PDF_MINI = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\n0000000000 65535 f \n' +
    'trailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF',
  'utf8',
);

async function wipeExisting() {
  const ws = await prisma.worksite.findUnique({ where: { ref: REF } });
  if (!ws) return;
  const thread = await prisma.thread.findUnique({ where: { worksiteId: ws.id } });
  if (thread) {
    await prisma.message.deleteMany({ where: { threadId: thread.id } });
    await prisma.threadParticipant.deleteMany({ where: { threadId: thread.id } });
    await prisma.thread.delete({ where: { id: thread.id } });
  }
  const reports = await prisma.worksiteReport.findMany({ where: { worksiteId: ws.id }, select: { id: true } });
  await prisma.reportPhoto.deleteMany({ where: { reportId: { in: reports.map((r) => r.id) } } });
  await prisma.worksiteReport.deleteMany({ where: { worksiteId: ws.id } });
  await prisma.worksiteTask.deleteMany({ where: { worksiteId: ws.id } });
  await prisma.documentLine.deleteMany({ where: { document: { worksiteId: ws.id } } });
  await prisma.document.deleteMany({ where: { worksiteId: ws.id } });
  await prisma.ledgerEntry.deleteMany({ where: { worksiteId: ws.id } });
  await prisma.timeEntry.deleteMany({ where: { worksiteId: ws.id } });
  await prisma.stockMovement.deleteMany({ where: { worksiteId: ws.id } });
  await prisma.worksite.delete({ where: { id: ws.id } });
  console.log('  (ancien chantier démo supprimé, recréation…)');
}

async function main() {
  await wipeExisting();

  // ---- client + ouvrier de démo -----------------------------------------
  const client = await prisma.contact.create({
    data: {
      name: '🧪 Client Démo', normalizedName: normalizeName('Client Démo'), type: 'client', kind: 'individual',
      email: 'client-demo@example.com', phone: '0470 00 00 00',
      address: 'Avenue des Tests 42', postalCode: '1050', city: 'Ixelles', source: 'demo',
    },
  });
  const worker = await prisma.person.upsert({
    where: { id: 'demo-worker-seed' }, // id fixe fictif -> upsert simple si jamais relancé sans wipe complet des Person
    update: {},
    create: {
      id: 'demo-worker-seed', firstName: 'Ouvrier', lastName: 'Démo', displayName: '🧪 Ouvrier Démo',
      normalizedName: normalizeName('Ouvrier Démo'), role: 'worker', contractType: 'employee',
      hourlyRate: 22, active: true, source: 'demo',
    },
  });

  // ---- chantier -----------------------------------------------------------
  const worksite = await prisma.worksite.create({
    data: {
      ref: REF, title: '🧪 DÉMO — Rénovation complète (exemple)', kind: 'project',
      entity: 'jjd', status: 'in_progress', priority: 'normal',
      address: 'Rue de la Démo 1', postalCode: '1000', city: 'Bruxelles',
      lat: 50.8503, lng: 4.3517, geoSetAt: new Date(),
      quotedHt: 8500, source: 'demo', archived: true, // archived: n'apparaît jamais dans le tableau de bord / listes par défaut
      clientId: client.id,
      description: 'Chantier fictif généré pour tester toutes les fonctionnalités de JJD App (devis, factures, dépenses, pointage, rapports, fil de chantier, stock…). Sans impact sur les vrais chiffres — exclu de tous les rapports agrégés.',
    },
  });
  await prisma.contact.update({ where: { id: client.id }, data: {} }); // no-op, garde la relation cohérente

  // ---- devis & factures (Document) ----------------------------------------
  async function makeDoc(opts: {
    kind: 'quote' | 'invoice' | 'deposit_invoice' | 'credit_note';
    status: string; issuedOn: Date; dueOn?: Date; title: string; intro?: string;
    lines: { kind?: string; label: string; description?: string; qty?: number; unit?: string; unitPriceHt?: number; discountPct?: number; vatRate?: number }[];
    paidAmount?: number;
  }) {
    const lines = opts.lines.map((l) => ({
      kind: l.kind ?? 'item', label: l.label, description: l.description ?? null,
      qty: l.qty ?? 1, unit: l.unit ?? null, unitPriceHt: l.unitPriceHt ?? 0,
      discountPct: l.discountPct ?? 0, vatRate: l.vatRate ?? 0.21,
    }));
    const totals = computeDocTotals(lines.map((l) => ({ kind: l.kind, qty: l.qty, unitPriceHt: l.unitPriceHt, discountPct: l.discountPct, vatRate: l.vatRate })));
    const seq = Math.floor(Math.random() * 9000) + 1000;
    const numberPrefix = opts.kind === 'quote' ? 'DEMO-D' : opts.kind === 'credit_note' ? 'DEMO-NC' : 'DEMO-F';
    const doc = await prisma.document.create({
      data: {
        kind: opts.kind, direction: opts.kind === 'credit_note' ? 'credit_note' : 'sale',
        number: `${numberPrefix}-${seq}`, worksiteId: worksite.id, contactId: client.id,
        status: opts.status, title: opts.title, intro: opts.intro ?? null,
        issuedOn: opts.issuedOn, dueOn: opts.dueOn ?? null,
        totalHt: totals.totalHt, totalVat: totals.totalVat, totalTtc: totals.totalTtc,
        paidAmount: opts.paidAmount ?? 0,
        billingName: client.name, billingAddress: `${client.address}, ${client.postalCode} ${client.city}`,
        structuredComm: opts.kind === 'invoice' || opts.kind === 'deposit_invoice' ? belgianStructuredComm(seq) : null,
        lockedAt: opts.status === 'draft' ? null : new Date(),
        source: 'demo',
      },
    });
    await prisma.documentLine.createMany({ data: lines.map((l, i) => ({ ...l, documentId: doc.id, position: i, totalHt: round2((l.qty ?? 1) * (l.unitPriceHt ?? 0) * (1 - (l.discountPct ?? 0) / 100)) })) });
    return doc;
  }
  function round2(n: number) { return Math.round(n * 100) / 100; }

  const monthAgo = (n: number) => new Date(Date.now() - n * 30 * 86400000);

  await makeDoc({
    kind: 'quote', status: 'sent', issuedOn: monthAgo(2), title: 'Rénovation salle de bain + peinture',
    intro: 'Suite à notre visite du chantier, voici notre proposition détaillée.',
    lines: [
      { kind: 'section', label: 'Salle de bain' },
      { label: 'Démolition carrelage existant', description: 'Sol + murs, évacuation incluse', qty: 12, unit: 'm²', unitPriceHt: 35 },
      { label: 'Pose carrelage neuf', qty: 12, unit: 'm²', unitPriceHt: 60, discountPct: 5, vatRate: 0.06 },
      { kind: 'section', label: 'Peinture' },
      { label: 'Peinture 2 couches, murs + plafond', qty: 45, unit: 'm²', unitPriceHt: 18 },
      { kind: 'text', label: 'Matériel de robinetterie fourni par le client.' },
    ],
  });

  const invoice = await makeDoc({
    kind: 'invoice', status: 'partial', issuedOn: monthAgo(1), dueOn: monthAgo(-0.03), title: 'Rénovation salle de bain + peinture — facture',
    lines: [
      { label: 'Démolition carrelage existant', qty: 12, unit: 'm²', unitPriceHt: 35 },
      { label: 'Pose carrelage neuf', qty: 12, unit: 'm²', unitPriceHt: 60, discountPct: 5, vatRate: 0.06 },
      { label: 'Peinture 2 couches, murs + plafond', qty: 45, unit: 'm²', unitPriceHt: 18 },
    ],
    paidAmount: 2000,
  });

  await makeDoc({
    kind: 'deposit_invoice', status: 'paid', issuedOn: monthAgo(3), title: 'Acompte',
    lines: [{ label: 'Acompte 30% à la commande', qty: 1, unitPriceHt: 2550 }],
    paidAmount: 3085.5,
  });

  await makeDoc({
    kind: 'credit_note', status: 'sent', issuedOn: monthAgo(0.5), title: 'Avoir — remise commerciale',
    lines: [{ label: 'Remise commerciale geste commercial', qty: 1, unitPriceHt: 150 }],
  });

  // ---- écriture au grand livre (alimente Rentabilité / Avancement du chantier) ----
  await prisma.ledgerEntry.create({
    data: {
      date: monthAgo(1), year: new Date(monthAgo(1)).getFullYear(), month: String(new Date(monthAgo(1)).getMonth() + 1),
      direction: 'sale', docType: 'Facture de vente', docNumber: invoice.number,
      worksiteId: worksite.id, worksiteRef: REF, contactId: client.id,
      ht: invoice.totalHt, ttc: invoice.totalTtc, vatRate: 0.21,
      paymentStatus: 'Non payé', source: 'demo',
    },
  });

  // ---- dépenses (Achats) ---------------------------------------------------
  const pdfPath1 = storeFile(PDF_MINI, 'facture-fournisseur-demo.pdf', 'expenses');
  await prisma.ledgerEntry.create({
    data: {
      date: monthAgo(1.5), year: new Date(monthAgo(1.5)).getFullYear(), month: String(new Date(monthAgo(1.5)).getMonth() + 1),
      direction: 'purchase', docType: "Facture d'achat", docNumber: 'DEMO-ACH-1',
      worksiteId: worksite.id, worksiteRef: REF, supplierName: '🧪 Fournisseur Démo SA',
      categoryRaw: 'Matériel - Général', ht: 620, ttc: 750.2, vatRate: 0.21,
      paymentStatus: 'Payé', paidOn: monthAgo(1.2), pdfPath: pdfPath1, source: 'demo',
    },
  });
  await prisma.ledgerEntry.create({
    data: {
      date: monthAgo(0.4), year: new Date(monthAgo(0.4)).getFullYear(), month: String(new Date(monthAgo(0.4)).getMonth() + 1),
      direction: 'purchase', docType: "Facture d'achat", docNumber: 'DEMO-ACH-2',
      worksiteId: worksite.id, worksiteRef: REF, supplierName: '🧪 Fournisseur Démo SA',
      categoryRaw: 'Matériel - Général', ht: 210, ttc: 254.1, vatRate: 0.21,
      paymentStatus: 'Non payé', dueDate: monthAgo(-0.6), source: 'demo',
    },
  });

  // ---- pointage -------------------------------------------------------------
  for (const [daysAgo, hours, status] of [[3, 8, 'approved'], [2, 7.5, 'approved'], [1, 4, 'submitted']] as const) {
    const date = new Date(Date.now() - daysAgo * 86400000);
    await prisma.timeEntry.create({
      data: {
        personId: worker.id, worksiteId: worksite.id, worksiteRef: REF, date,
        hours, amount: round2(hours * (worker.hourlyRate ?? 20)), rateUsed: worker.hourlyRate,
        task: 'Carrelage salle de bain', status, source: 'demo',
      },
    });
  }

  // ---- rapport d'intervention (signé, avec photo) ----------------------------
  const photo = await storeImage(PNG_1PX);
  const report = await prisma.worksiteReport.create({
    data: {
      worksiteId: worksite.id, authorName: '🧪 Ouvrier Démo', date: monthAgo(1),
      workDone: 'Démolition du carrelage existant terminée. Préparation des surfaces pour la pose du nouveau carrelage. RAS.',
      notes: 'Prévoir un passage supplémentaire pour la réception du carrelage.',
      status: 'signed', clientName: '🧪 Client Démo', signatureUrl: photo.url, signedAt: monthAgo(1),
    },
  });
  await prisma.reportPhoto.create({ data: { reportId: report.id, url: photo.url, thumbUrl: photo.thumbUrl, caption: 'Avant démolition' } });
  await prisma.worksiteReport.create({
    data: { worksiteId: worksite.id, authorName: '🧪 Ouvrier Démo', date: new Date(), workDone: 'Pose du carrelage en cours.', status: 'draft' },
  });

  // ---- fil de chantier --------------------------------------------------------
  const thread = await prisma.thread.create({ data: { worksiteId: worksite.id } });
  await prisma.message.create({ data: { threadId: thread.id, authorName: '🧪 Ouvrier Démo', kind: 'text', body: 'Démolition terminée, on attaque la pose demain.', source: 'demo', createdAt: monthAgo(1) } });
  await prisma.message.create({ data: { threadId: thread.id, authorName: '🧪 Client Démo', kind: 'text', body: 'Parfait, merci pour l’avancement !', source: 'demo', createdAt: monthAgo(0.9) } });
  await prisma.message.create({ data: { threadId: thread.id, authorName: '🧪 Ouvrier Démo', kind: 'photo', fileUrl: photo.url, thumbUrl: photo.thumbUrl, body: 'Avant/après démolition', source: 'demo', createdAt: monthAgo(0.8) } });
  await prisma.message.create({ data: { threadId: thread.id, kind: 'status', body: 'Chantier signalé terminé', source: 'demo', createdAt: monthAgo(0.1) } });

  // ---- tâches ------------------------------------------------------------------
  const tasks = [
    { title: 'Démolition carrelage existant', status: 'done' },
    { title: 'Préparation des surfaces', status: 'done' },
    { title: 'Pose du carrelage', status: 'doing' },
    { title: 'Peinture murs et plafond', status: 'todo' },
    { title: 'Nettoyage final + réception client', status: 'todo' },
  ];
  await prisma.worksiteTask.createMany({ data: tasks.map((t, i) => ({ ...t, worksiteId: worksite.id, position: i })) });

  // ---- stock (facultatif, sans risque pour les rapports financiers) -----------
  const stockItem = await prisma.stockItem.upsert({
    where: { id: 'demo-stock-item-seed' }, update: {},
    create: { id: 'demo-stock-item-seed', name: '🧪 Carrelage 30x30 (démo)', unit: 'm²', category: 'Carrelage', minQty: 20, qty: 0 },
  });
  await prisma.stockMovement.create({ data: { stockItemId: stockItem.id, type: 'in', qty: 50, unitCost: 22 } });
  await prisma.stockItem.update({ where: { id: stockItem.id }, data: { qty: 50, avgCost: 22 } });
  await prisma.stockMovement.create({ data: { stockItemId: stockItem.id, type: 'out', qty: 12, worksiteId: worksite.id, requestedByName: '🧪 Ouvrier Démo' } });
  await prisma.stockItem.update({ where: { id: stockItem.id }, data: { qty: 38 } });

  console.log('Chantier démo créé :', worksite.ref, worksite.id);
  console.log(`URL : /app/chantiers/${worksite.id}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
