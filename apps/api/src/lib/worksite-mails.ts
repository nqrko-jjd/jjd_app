/**
 * Suivi des e-mails d'un chantier : copie lisible d'un mail (corps nettoyé, pièces jointes enregistrées) rangée dans WorksiteMail.
 * Réservé au bureau. Les pièces jointes vivent sous UPLOADS_DIR/_private (jamais servi en statique : voir app.ts) et sortent par une route authentifiée.
 */
import { mkdirSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { ParsedMail } from 'mailparser';
import { prisma } from '../db.js';
import { UPLOADS_DIR } from './media.js';
import { fetchParsedMail } from './lead-mailbox.js';
import { inlineCidImages, mailPlainText, sanitizeMailHtml, type InlinePart } from './mail-render.js';

export const PRIVATE_DIR = path.join(UPLOADS_DIR, '_private');
const MAX_ATTACHMENT = 25 * 1024 * 1024;
const MAX_TOTAL = 80 * 1024 * 1024;

export interface StoredAttachment { filename: string; contentType: string; size: number; file?: string; skipped?: string }

const safeExt = (name: string) => (/\.[a-z0-9]{1,8}$/i.exec(name)?.[0] ?? '').toLowerCase();

/** Chemin absolu d'un fichier rangé (refuse tout ce qui sortirait du dossier privé). */
export function privateFilePath(rel: string): string | null {
  const abs = path.resolve(PRIVATE_DIR, rel);
  return abs.startsWith(PRIVATE_DIR + path.sep) ? abs : null;
}

function storeAttachment(content: Buffer, filename: string): string {
  const now = new Date();
  const rel = path.join('worksite-mails', String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), `${nanoid(16)}${safeExt(filename)}`);
  const abs = path.join(PRIVATE_DIR, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return rel.replace(/\\/g, '/');
}

export function removeStoredFiles(attachments: unknown) {
  if (!Array.isArray(attachments)) return;
  for (const a of attachments as StoredAttachment[]) {
    const abs = a?.file ? privateFilePath(a.file) : null;
    if (abs && existsSync(abs)) { try { unlinkSync(abs); } catch { /* fichier déjà parti */ } }
  }
}

/** Copie lisible d'un mail analysé : en-têtes, texte, HTML nettoyé (images incorporées comprises) et pièces jointes enregistrées. */
export function buildMailSnapshot(parsed: ParsedMail) {
  const atts = parsed.attachments ?? [];
  const inline: InlinePart[] = atts.filter((a) => a.contentId && a.contentDisposition !== 'attachment').map((a) => ({ cid: a.contentId!, contentType: a.contentType, content: a.content }));
  const rawHtml = typeof parsed.html === 'string' ? parsed.html : '';
  const bodyHtml = rawHtml ? sanitizeMailHtml(inlineCidImages(rawHtml, inline)) : null;
  // une image incorporée dans le corps n'est pas une « pièce jointe » (comme dans Outlook)
  const shownInBody = new Set(rawHtml ? inline.filter((p) => rawHtml.includes(`cid:${p.cid.replace(/^<|>$/g, '')}`)).map((p) => p.cid) : []);
  const stored: StoredAttachment[] = [];
  let total = 0;
  atts.forEach((a, i) => {
    if (a.contentId && shownInBody.has(a.contentId)) return;
    const filename = (a.filename ?? `pièce-jointe-${i + 1}`).replace(/[\u0000-\u001f"\\/]/g, '_');
    const base = { filename, contentType: a.contentType || 'application/octet-stream', size: a.size ?? a.content.length };
    if (a.content.length > MAX_ATTACHMENT) { stored.push({ ...base, skipped: 'trop volumineuse (plus de 25 Mo)' }); return; }
    if (total + a.content.length > MAX_TOTAL) { stored.push({ ...base, skipped: 'limite de taille du mail atteinte' }); return; }
    total += a.content.length;
    stored.push({ ...base, file: storeAttachment(a.content, filename) });
  });
  return {
    subject: parsed.subject ?? null,
    fromAddress: parsed.from?.text ?? null,
    toAddress: parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map((t) => t.text).join(', ') : parsed.to.text) : null,
    receivedAt: parsed.date ?? null,
    bodyText: mailPlainText(parsed.text, rawHtml) || null,
    bodyHtml,
    attachments: stored,
  };
}

/**
 * Range un mail (ou, à défaut, ses seules références) dans le suivi du chantier. Si la boîte mail est injoignable, la fiche est quand même créée
 * avec l'objet, l'expéditeur et le résumé : on ne perd jamais la note.
 */
export async function recordWorksiteMail(opts: {
  worksiteId: string; messageId?: string | null; subject?: string | null; fromAddress?: string | null; receivedAt?: Date | null;
  summary?: string | null; note?: string | null; userId?: string | null;
}) {
  let snap: ReturnType<typeof buildMailSnapshot> | null = null;
  if (opts.messageId) {
    try { const parsed = await fetchParsedMail(opts.messageId); if (parsed) snap = buildMailSnapshot(parsed); } catch { snap = null; }
  }
  return prisma.worksiteMail.create({
    data: {
      worksiteId: opts.worksiteId, kind: 'mail', messageId: opts.messageId ?? null,
      subject: snap?.subject ?? opts.subject ?? null, fromAddress: snap?.fromAddress ?? opts.fromAddress ?? null, toAddress: snap?.toAddress ?? null,
      receivedAt: snap?.receivedAt ?? opts.receivedAt ?? null,
      bodyText: snap?.bodyText ?? opts.summary ?? null, bodyHtml: snap?.bodyHtml ?? null,
      note: opts.note?.trim() || null, attachments: (snap?.attachments ?? []) as unknown as object, createdById: opts.userId ?? null,
    },
  });
}
