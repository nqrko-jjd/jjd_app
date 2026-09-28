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
import { scanEntryForRefs } from './purchase-ref-scan.js';

export const PROCESSED_MAILBOX = 'Traité par JJD App';

// Pièces jointes PDF qui ne sont jamais une facture/note de crédit — conditions générales,
// mentions légales… souvent jointes au même mail que la vraie facture (vu chez Vanlaethem
// Containers : "Algemene voorwaarden - Co…" à côté du PDF de facture). Ignorées avant toute
// tentative d'extraction, pour ne jamais créer une dépense fantôme à partir de ce genre de PDF.
export const NON_INVOICE_ATTACHMENT_RE = /algemene\s*voorwaarden|conditions?\s*g[ée]n[ée]rales?|\bcgv\b|general\s*terms|terms\s*(?:and|&)?\s*conditions|privacy\s*policy|vie\s*priv[ée]e/i;

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
export async function findExistingMatch(extraction: Awaited<ReturnType<typeof extractDocumentInfo>>): Promise<string | null> {
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
 *
 * Chaque pièce jointe PDF est traitée INDÉPENDAMMENT des autres (essentiel quand un mail en
 * contient plusieurs — facture + conditions générales par ex.) : un échec sur l'une d'elles ne
 * doit ni faire perdre les autres, ni faire classer le mail comme traité. Un message n'est
 * marqué lu/déplacé QUE si toutes ses pièces jointes ont été traitées sans erreur (importées ou
 * déjà connues) — sinon il reste non lu en INBOX, retenté au prochain sync ; un dédoublonnage
 * (par n° de document ou montant+date, comme le scan rétroactif) rend cette relecture sûre :
 * la pièce déjà importée n'est jamais recréée, seule celle qui avait échoué est retentée.
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
        let allOk = true;
        let importedAny = false; // ≥1 pièce jointe reconnue comme facture, importée à l'instant ou déjà connue
        try {
          const msg = (await client.fetchOne(String(uid), { source: true }, { uid: true })) as FetchMessageObject | false;
          if (!msg || !msg.source) continue;
          const parsed = await simpleParser(msg.source);
          for (const att of parsed.attachments) {
            if (att.contentType !== 'application/pdf') continue;
            if (att.filename && NON_INVOICE_ATTACHMENT_RE.test(att.filename)) continue;
            try {
              const { data, extraction } = await buildExpenseFromPdf(att.content, att.filename || 'facture.pdf');
              if (await findExistingMatch(extraction)) { importedAny = true; continue; } // déjà importée (relecture après échec d'une autre pièce jointe du même mail)
              const created = await prisma.ledgerEntry.create({ data: { ...data, createdById: null } });
              await scanEntryForRefs(created.id).catch(() => {});
              stats.pdfsImported++;
              importedAny = true;
            } catch (e) {
              allOk = false;
              stats.errors.push(`uid ${uid}, ${att.filename ?? 'pièce jointe'} : ${(e as Error).message}`);
            }
          }
        } catch (e) {
          allOk = false;
          stats.errors.push(`uid ${uid} : ${(e as Error).message}`);
        }
        // pas d'erreur -> lu, laissé en INBOX si rien à en tirer, déplacé sinon ; une erreur sur
        // au moins une pièce jointe laisse le mail non lu, retenté (sans doublon) au prochain sync
        if (allOk) {
          await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
          if (importedAny) await client.messageMove(uid, PROCESSED_MAILBOX, { uid: true });
        }
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
    const allPaths = list.map((m) => m.path);
    const skip = new Set(['Sent', 'Drafts', 'Junk', 'Trash']);
    // un nom de dossier fourni par l'appelant (ex. PROCESSED_MAILBOX) peut différer du chemin
    // IMAP réel selon le séparateur du serveur ("INBOX.Traité par JJD App" chez certains) —
    // on le résout contre la liste réelle (égalité ou suffixe) avant de verrouiller le dossier
    const targets = folders
      ? folders.map((f) => allPaths.find((p) => p === f || p.endsWith(f)) ?? f)
      : allPaths.filter((p) => !skip.has(p) && !p.includes(PROCESSED_MAILBOX));

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
              if (att.filename && NON_INVOICE_ATTACHMENT_RE.test(att.filename)) continue;
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
              const createdEntry = await prisma.ledgerEntry.create({
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
              await scanEntryForRefs(createdEntry.id).catch(() => {});
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
