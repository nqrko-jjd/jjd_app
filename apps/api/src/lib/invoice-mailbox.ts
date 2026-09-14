/**
 * Import automatique des factures fournisseurs reçues sur une boîte mail dédiée (ex.
 * invoices@jjd-consult.be) — alternative à Ponto qui ne nécessite qu'un mot de passe IMAP
 * classique. Chaque PDF reçu est passé dans le même extracteur que l'upload manuel
 * (`extractDocumentInfo`, voir document-extract.ts) puis crée une dépense `source: 'email'`
 * — jamais confirmée automatiquement, l'extraction texte n'étant pas fiable à 100 % : la
 * dépense apparaît « à vérifier » dans Achats (même logique que les factures envoyées
 * depuis le fil de chantier, `source: 'chat'`, voir routes/thread.ts).
 *
 * Dégradation silencieuse : sans configuration, `invoiceMailboxConfigured()` renvoie false
 * et le sync ne se lance jamais (voir index.ts) — l'app fonctionne normalement sans.
 */
import { ImapFlow, type FetchMessageObject } from 'imapflow';
import { simpleParser } from 'mailparser';
import { env } from '../env.js';
import { prisma } from '../db.js';
import { storeFile } from './media.js';
import { extractDocumentInfo } from './document-extract.js';

const PROCESSED_MAILBOX = 'Traité par JJD App';

export function invoiceMailboxConfigured(): boolean {
  const m = env.invoicesMailbox;
  return !!m.host && !!m.user && !!m.password;
}

function deriveYM(date: Date) {
  const m = date.getMonth() + 1;
  return { year: date.getFullYear(), month: String(m), quarter: `T${Math.ceil(m / 3)}` };
}

/** Construit les données d'une dépense à partir d'un PDF extrait — pure, testable sans IMAP. */
export async function buildExpenseFromPdf(buffer: Buffer, originalName: string) {
  const extraction = await extractDocumentInfo(buffer, 'application/pdf', ['supplier', 'both']);
  const date = extraction.issuedOn ? new Date(extraction.issuedOn) : new Date();
  const ht = extraction.totalHt
    ?? (extraction.totalTtc != null ? Math.round((extraction.totalTtc / (1 + (extraction.vatRate ?? 0.21))) * 100) / 100 : 0);
  const pdfPath = storeFile(buffer, originalName || 'facture.pdf', 'expenses');
  return {
    data: {
      ...deriveYM(date),
      date,
      dueDate: extraction.dueOn ? new Date(extraction.dueOn) : null,
      direction: 'purchase' as const,
      docType: "Facture d'achat",
      docNumber: extraction.docNumber,
      worksiteId: extraction.worksiteId,
      worksiteRef: extraction.worksiteRef,
      contactId: extraction.contactId,
      supplierName: extraction.contactName,
      ht,
      ttc: extraction.totalTtc,
      vatRate: extraction.vatRate,
      pdfPath,
      paymentStatus: 'Non payé',
      source: 'email' as const,
    },
    extraction,
  };
}

interface SyncStats {
  messagesSeen: number;
  pdfsImported: number;
  errors: string[];
}

/**
 * Se connecte à la boîte, traite les messages non lus de INBOX (pièces jointes PDF ->
 * dépense « à vérifier »), puis déplace le message traité dans `PROCESSED_MAILBOX` (créé si
 * besoin) pour ne jamais le retraiter. Un message sans PDF est juste marqué lu (laissé dans
 * INBOX) — David le verra passer sans qu'on perde la trace d'un mail non exploité.
 */
export async function syncInvoiceMailbox(): Promise<SyncStats> {
  const stats: SyncStats = { messagesSeen: 0, pdfsImported: 0, errors: [] };
  if (!invoiceMailboxConfigured()) return stats;

  const client = new ImapFlow({
    host: env.invoicesMailbox.host,
    port: env.invoicesMailbox.port,
    secure: true,
    auth: { user: env.invoicesMailbox.user, pass: env.invoicesMailbox.password },
    logger: false,
  });

  await client.connect();
  try {
    const list = await client.list();
    if (!list.some((m) => m.path === `INBOX.${PROCESSED_MAILBOX}` || m.path === PROCESSED_MAILBOX)) {
      await client.mailboxCreate([PROCESSED_MAILBOX]);
    }

    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      for (const uid of uids as number[]) {
        stats.messagesSeen++;
        let importedAny = false;
        try {
          const msg = (await client.fetchOne(String(uid), { source: true }, { uid: true })) as FetchMessageObject | false;
          if (!msg || !msg.source) continue;
          const parsed = await simpleParser(msg.source);
          for (const att of parsed.attachments) {
            if (att.contentType !== 'application/pdf') continue;
            const { data } = await buildExpenseFromPdf(att.content, att.filename || 'facture.pdf');
            await prisma.ledgerEntry.create({ data: { ...data, createdById: null } });
            stats.pdfsImported++;
            importedAny = true;
          }
        } catch (e) {
          stats.errors.push(`uid ${uid} : ${(e as Error).message}`);
        }
        await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
        if (importedAny) await client.messageMove(uid, PROCESSED_MAILBOX, { uid: true });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
  return stats;
}
