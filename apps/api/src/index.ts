import os from 'node:os';
import { createApp } from './app.js';
import { env } from './env.js';
import { prisma } from './db.js';
import { invoiceMailboxConfigured, syncInvoiceMailbox } from './lib/invoice-mailbox.js';
import { mailSuggestionsConfigured, syncMailSuggestions } from './lib/lead-mailbox.js';
import { markOverdueInvoices, renumberFaDepositInvoices } from './lib/documents.js';
import { backfillBankMatches } from './lib/bank-match.js';
import { backfillWorksiteGeo } from './lib/worksite-geo.js';
import { pontoConfigured } from './lib/ponto.js';
import { syncPonto } from './lib/ponto-sync.js';
import { sweepWorksiteStatuses } from './lib/worksite-status.js';
import { refreshPendingPeppol } from './lib/peppol.js';

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
{
  const n = await backfillBankMatches();
  // eslint-disable-next-line no-console
  if (n) console.log(`[backfill] ${n} rapprochement(s) bancaire(s) migré(s) vers BankTransactionMatch`);
}
{
  const n = await renumberFaDepositInvoices();
  // eslint-disable-next-line no-console
  if (n) console.log(`[backfill] ${n} facture(s) d'acompte renumérotée(s) dans la série F`);
}

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
// connexion bancaire Ponto : synchro automatique (3 par jour : la banque limite les accès sans client présent), puis rapprochement
if (pontoConfigured()) {
  const runPonto = () => syncPonto()
    .then((r) => { if (r.imported) console.log(`[ponto] ${r.imported} nouvelle(s) transaction(s), rapprochement : ${JSON.stringify(r.match)}`); })
    .catch((e) => console.error('[ponto] synchro automatique échouée :', e.message));
  setTimeout(runPonto, 90_000);
  setInterval(runPonto, 8 * 3600_000);
}
// chantier dont une intervention démarre aujourd'hui : « À planifier » / « Planifié » → « En cours »
const runStatusSweep = () => sweepWorksiteStatuses().then((n) => { if (n) console.log(`[statuts] ${n} chantier(s) passé(s) « En cours »`); }).catch((e) => console.error('[statuts] échec :', e.message));
setTimeout(runStatusSweep, 60_000);
setInterval(runStatusSweep, 60 * 60_000);
// statut de livraison des factures transmises par Peppol (sans effet tant que la clé n'est pas installée)
setInterval(() => { refreshPendingPeppol().then((n) => { if (n) console.log(`[peppol] ${n} statut(s) de livraison mis à jour`); }).catch((e) => console.error('[peppol] échec :', e.message)); }, 30 * 60_000);
// chantiers actifs sans point GPS : géolocalisés en arrière-plan à partir de leur adresse (1 requête/seconde max, voir lib/geocode.ts)
setTimeout(() => { backfillWorksiteGeo().then((n) => { if (n) console.log(`[geo] ${n} chantier(s) géolocalisé(s) d'après leur adresse`); }).catch(() => {}); }, 45_000);
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

/**
 * Boîte mail principale (info@/david@…) : sans config, `mailSuggestionsConfigured()` renvoie
 * false et rien ne se lance — voir lib/lead-mailbox.ts. Ne modifie jamais la boîte
 * (pas de \Seen, pas de déplacement) : décalage de démarrage différent de la boîte factures
 * pour ne pas les faire démarrer à la même seconde.
 */
if (mailSuggestionsConfigured()) {
  const runMailSync = () => {
    syncMailSuggestions()
      .then((stats) => {
        if (stats.suggestionsCreated || stats.errors.length) {
          // eslint-disable-next-line no-console
          console.log(`[mail-suggestions] ${stats.messagesSeen} message(s) analysé(s), ${stats.suggestionsCreated} suggestion(s) créée(s)${stats.errors.length ? `, ${stats.errors.length} erreur(s) : ${stats.errors.join(' | ')}` : ''}`);
        }
      })
      .catch((e) => console.error('[mail-suggestions] échec de synchronisation :', e.message));
  };
  setTimeout(runMailSync, 30_000);
  setInterval(runMailSync, 20 * 60_000);
}
