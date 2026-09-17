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
import { readFileSync, existsSync } from 'node:fs';
// alias distinct de la variable locale "path" (nom de dossier mail) utilisée plus bas dans ce
// fichier, pour ne laisser planer aucune ambiguïté entre les deux.
import nodePath from 'node:path';
import { ImapFlow, type FetchMessageObject } from 'imapflow';
import { simpleParser } from 'mailparser';
import { env } from '../env.js';
import { prisma } from '../db.js';
import { storeFile, UPLOADS_DIR } from './media.js';
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
 * Cherche une écriture déjà existante correspondant à une extraction PDF — sert au scan
 * rétroactif pour ne jamais dupliquer une facture déjà connue (import Excel, TrustUp, saisie
 * manuelle...). D'abord par n° de document exact (fiable s'il est présent), sinon par
 * montant TTC (± 2 c) et date proche (± 5 j). Amounts à 0/absents = extraction peu fiable,
 * jamais utilisés comme clé (risque de faux positif entre plusieurs factures à 0 €).
 */
async function findExistingMatch(extraction: Awaited<ReturnType<typeof extractDocumentInfo>>): Promise<string | null> {
  if (extraction.docNumber) {
    const byDoc = await prisma.ledgerEntry.findFirst({
      where: { direction: 'purchase', docNumber: extraction.docNumber },
      select: { id: true },
    });
    if (byDoc) return byDoc.id;
  }
  if (extraction.totalTtc) {
    const where: Record<string, unknown> = {
      direction: 'purchase',
      ttc: { gte: extraction.totalTtc - 0.02, lte: extraction.totalTtc + 0.02 },
    };
    if (extraction.issuedOn) {
      const d = new Date(extraction.issuedOn);
      where.date = { gte: new Date(d.getTime() - 5 * 86400000), lte: new Date(d.getTime() + 5 * 86400000) };
    }
    const byAmount = await prisma.ledgerEntry.findFirst({ where, select: { id: true } });
    if (byAmount) return byAmount.id;
  }
  return null;
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

interface ScanStats {
  folders: number;
  messagesScanned: number;
  pdfsFound: number;
  alreadyInSystem: number;
  created: number;
  unreliableExtraction: number; // créées quand même (à vérifier), mais sans clé de dédoublonnage fiable
  errors: string[];
}

/**
 * Scan rétroactif (historique) : passe en revue TOUS les messages (lus ou non) des dossiers
 * donnés — par défaut, tous les dossiers de la boîte sauf Sent/Drafts/Junk/Trash et le
 * dossier de traitement de `syncInvoiceMailbox()`. Contrairement au sync courant, ne
 * modifie JAMAIS le mail (pas de \Seen, pas de déplacement) : le classement existant par
 * fournisseur reste intact, on ne fait qu'y piocher. Chaque PDF déjà retrouvé dans le grand
 * livre (`findExistingMatch`) est ignoré ; les nouveaux deviennent des dépenses « à
 * vérifier » comme le sync courant (`source: 'email'`).
 */
export async function scanInvoiceMailboxHistory(folders?: string[]): Promise<ScanStats> {
  const stats: ScanStats = { folders: 0, messagesScanned: 0, pdfsFound: 0, alreadyInSystem: 0, created: 0, unreliableExtraction: 0, errors: [] };
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
    const skip = new Set(['Sent', 'Drafts', 'Junk', 'Trash']);
    const targets = folders ?? list.map((m) => m.path).filter((p) => !skip.has(p) && !p.includes(PROCESSED_MAILBOX));

    for (const path of targets) {
      const lock = await client.getMailboxLock(path).catch(() => null);
      if (!lock) { stats.errors.push(`dossier introuvable : ${path}`); continue; }
      stats.folders++;
      try {
        const uids = await client.search({ all: true }, { uid: true });
        for (const uid of uids as number[]) {
          stats.messagesScanned++;
          try {
            const msg = (await client.fetchOne(String(uid), { source: true, envelope: true }, { uid: true })) as FetchMessageObject | false;
            if (!msg || !msg.source) continue;
            const parsed = await simpleParser(msg.source);
            for (const att of parsed.attachments) {
              if (att.contentType !== 'application/pdf') continue;
              stats.pdfsFound++;
              const extraction = await extractDocumentInfo(att.content, 'application/pdf', ['supplier', 'both']);
              // le n° de document est une clé fiable même sans montant détecté (findExistingMatch
              // ignore déjà, en interne, la piste montant quand totalTtc est vide/nul) — donc
              // toujours tenter la correspondance, seul le compteur "extraction incomplète" en
              // dessous dépend des montants
              const reliable = !!(extraction.totalTtc || extraction.totalHt);
              const existingId = await findExistingMatch(extraction);
              if (existingId) { stats.alreadyInSystem++; continue; }
              const date = extraction.issuedOn ? new Date(extraction.issuedOn) : new Date(msg.envelope?.date ?? Date.now());
              const ht = extraction.totalHt
                ?? (extraction.totalTtc != null ? Math.round((extraction.totalTtc / (1 + (extraction.vatRate ?? 0.21))) * 100) / 100 : 0);
              const pdfPath = storeFile(att.content, att.filename || 'facture.pdf', 'expenses');
              await prisma.ledgerEntry.create({
                data: {
                  ...deriveYM(date),
                  date,
                  dueDate: extraction.dueOn ? new Date(extraction.dueOn) : null,
                  direction: 'purchase',
                  docType: "Facture d'achat",
                  docNumber: extraction.docNumber,
                  worksiteId: extraction.worksiteId,
                  contactId: extraction.contactId,
                  supplierName: extraction.contactName,
                  ht,
                  ttc: extraction.totalTtc,
                  vatRate: extraction.vatRate,
                  pdfPath,
                  paymentStatus: 'Non payé',
                  source: 'email',
                  notes: `Retrouvée dans le dossier mail « ${path} »`,
                  createdById: null,
                },
              });
              stats.created++;
              if (!reliable) stats.unreliableExtraction++;
            }
          } catch (e) {
            stats.errors.push(`${path} uid ${uid} : ${(e as Error).message}`);
          }
        }
      } finally {
        lock.release();
      }
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
  return stats;
}

export interface ReprocessStats {
  scanned: number;
  updated: number;
  unchanged: number;
  errors: string[];
}

/**
 * Reprend les dépenses `source: 'email'` déjà créées avec une extraction incomplète (montant à
 * 0, fournisseur ou n° de document absents) et les repasse dans `extractDocumentInfo` — utile
 * après une amélioration de l'extracteur (voir document-extract.ts) : corriger les PDF déjà
 * importés, pas seulement les futurs. Ne touche jamais un champ déjà rempli (une correction
 * manuelle faite entre-temps par le bureau n'est jamais écrasée).
 */
export async function reprocessEmailEntries(): Promise<ReprocessStats> {
  const stats: ReprocessStats = { scanned: 0, updated: 0, unchanged: 0, errors: [] };
  const candidates = await prisma.ledgerEntry.findMany({
    where: {
      source: 'email',
      pdfPath: { not: null },
      OR: [{ supplierName: null }, { ht: 0 }, { docNumber: null }, { ttc: null }],
    },
  });
  stats.scanned = candidates.length;

  for (const entry of candidates) {
    try {
      const rel = entry.pdfPath!.replace(/^\/?uploads\//, '');
      const filePath = nodePath.join(UPLOADS_DIR, rel);
      if (!existsSync(filePath)) { stats.errors.push(`${entry.id} : pièce jointe introuvable`); continue; }
      const buffer = readFileSync(filePath);
      const extraction = await extractDocumentInfo(buffer, 'application/pdf', ['supplier', 'both']);

      const ht = extraction.totalHt
        ?? (extraction.totalTtc != null ? Math.round((extraction.totalTtc / (1 + (extraction.vatRate ?? 0.21))) * 100) / 100 : null);

      const data: Record<string, unknown> = {};
      if (!entry.docNumber && extraction.docNumber) data.docNumber = extraction.docNumber;
      if (!entry.supplierName && extraction.contactName) data.supplierName = extraction.contactName;
      if (!entry.contactId && extraction.contactId) data.contactId = extraction.contactId;
      if (!entry.worksiteId && extraction.worksiteId) { data.worksiteId = extraction.worksiteId; data.worksiteRef = extraction.worksiteRef; }
      if (!entry.ht && ht) data.ht = ht;
      if (entry.ttc == null && extraction.totalTtc != null) data.ttc = extraction.totalTtc;
      if (entry.vatRate == null && extraction.vatRate != null) data.vatRate = extraction.vatRate;

      if (Object.keys(data).length === 0) { stats.unchanged++; continue; }
      await prisma.ledgerEntry.update({ where: { id: entry.id }, data });
      stats.updated++;
    } catch (e) {
      stats.errors.push(`${entry.id} : ${(e as Error).message}`);
    }
  }
  return stats;
}
