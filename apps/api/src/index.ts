import os from 'node:os';
import { createApp } from './app.js';
import { env } from './env.js';
import { prisma } from './db.js';
import { invoiceMailboxConfigured, syncInvoiceMailbox } from './lib/invoice-mailbox.js';
import { markOverdueInvoices } from './lib/documents.js';

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces ?? []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  return out;
}

/**
 * Rattrapage messagerie interne/client : avant la séparation par `audience`,
 * le fil client et le fil interne partageaient les mêmes messages. Seul un
 * message texte posté par le client via le portail n'a ni `authorId` (aucun
 * compte User) ni `source` (pas un import WhatsApp) — bascule ces messages
 * historiques en `audience: 'client'`. Idempotent : les messages créés après
 * ce changement posent déjà leur `audience` explicitement, donc plus rien ne
 * matche ce filtre une fois le rattrapage fait — sûr à rejouer à chaque démarrage.
 */
async function backfillMessageAudience() {
  const r = await prisma.message.updateMany({
    where: { audience: 'internal', authorId: null, source: null, kind: 'text' },
    data: { audience: 'client' },
  });
  if (r.count) {
    // eslint-disable-next-line no-console
    console.log(`[backfill] ${r.count} message(s) historique(s) du portail basculé(s) en audience "client"`);
  }
}

/**
 * Un chantier clôturé doit être archivé (sinon il continue d'encombrer les listes —
 * chantiers, messagerie…) : ce lien n'existait pas avant, rattrape les chantiers déjà
 * clôturés dans l'historique. Idempotent : plus aucun chantier ne matche une fois
 * rattrapé, sûr à rejouer à chaque démarrage.
 */
async function backfillArchivedClosed() {
  const r = await prisma.worksite.updateMany({
    where: { status: 'closed', archived: false },
    data: { archived: true },
  });
  if (r.count) {
    // eslint-disable-next-line no-console
    console.log(`[backfill] ${r.count} chantier(s) clôturé(s) archivé(s)`);
  }
}

await backfillMessageAudience();
await backfillArchivedClosed();

/**
 * Factures envoyées/partielles dont l'échéance est dépassée -> "En retard".
 * Repasse au démarrage puis toutes les heures (le statut affiché reste donc
 * à jour à une heure près, sans avoir à recalculer à chaque lecture).
 */
async function runMarkOverdue() {
  const count = await markOverdueInvoices();
  if (count) {
    // eslint-disable-next-line no-console
    console.log(`[overdue] ${count} facture(s) passée(s) en retard`);
  }
}
await runMarkOverdue();
setInterval(() => { runMarkOverdue().catch((e) => console.error('[overdue] échec :', e.message)); }, 60 * 60_000);

createApp().listen(env.port, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log('JJD API');
  console.log(`  local  : http://localhost:${env.port}   (health: /health)`);
  for (const ip of lanAddresses()) {
    // eslint-disable-next-line no-console
    console.log(`  réseau : http://${ip}:${env.port}`);
  }
});

/**
 * Boîte mail factures (invoices@…) : sans config, `invoiceMailboxConfigured()` renvoie
 * false et rien ne se lance — voir lib/invoice-mailbox.ts. Une passe au démarrage (délai
 * court pour laisser le serveur finir de démarrer) puis toutes les 20 minutes.
 */
if (invoiceMailboxConfigured()) {
  const runSync = () => {
    syncInvoiceMailbox()
      .then((stats) => {
        if (stats.pdfsImported || stats.errors.length) {
          // eslint-disable-next-line no-console
          console.log(`[invoices-mailbox] ${stats.messagesSeen} message(s), ${stats.pdfsImported} facture(s) importée(s)${stats.errors.length ? `, ${stats.errors.length} erreur(s) : ${stats.errors.join(' | ')}` : ''}`);
        }
      })
      .catch((e) => console.error('[invoices-mailbox] échec de synchronisation :', e.message));
  };
  setTimeout(runSync, 15_000);
  setInterval(runSync, 20 * 60_000);
}
