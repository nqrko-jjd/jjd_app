/**
 * Signature électronique simple d'un devis par lien personnel (sans compte).
 *
 * À l'envoi, le PDF du devis est FIGÉ (copie + empreinte SHA-256) : ce que le client voit et signe est exactement ce qui a été envoyé,
 * même si le devis est modifié ensuite. À la signature on conserve la preuve : nom saisi, date et heure, adresse IP, navigateur, empreinte du PDF.
 * Signature électronique « simple » (preuve par faisceau d'indices), pas une signature qualifiée (itsme / carte d'identité).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { formatDateBE } from '@jjd/shared';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { UPLOADS_DIR } from './media.js';
import { HttpError } from './http.js';
import { getCompany } from './documents.js';
import { refreshWorksiteStatus } from './worksite-status.js';
import { sendEmailWithPdf, emailConfigured } from './doc-mail.js';

const DIR = path.join(UPLOADS_DIR, 'signatures');
export const SIGN_VALID_DAYS = 30;
export const signUrl = (token: string) => `${env.webUrl}/signer/${token}`;
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const NOT_SIGNABLE = ['accepted', 'declined', 'expired', 'cancelled'];

/** Texte ajouté à la fin du message envoyé au client. */
export function signLinkBlock(url: string, expiresAt: Date) {
  return `\n\nPour accepter et signer ce devis en ligne (valable jusqu'au ${formatDateBE(expiresAt)}) :\n${url}`;
}

/** Crée la demande de signature (annule les demandes en attente précédentes pour ce devis) et fige le PDF. */
export async function createSignatureRequest(documentId: string, userId: string, pdf: { buffer: Buffer }, sentTo: string[]) {
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { id: true, kind: true, lockedAt: true, status: true, number: true } });
  if (!doc) throw new HttpError(404, 'Document introuvable');
  if (doc.kind !== 'quote') throw new HttpError(422, 'Seuls les devis peuvent être signés en ligne.');
  if (!doc.lockedAt) throw new HttpError(409, 'Émettez le devis avant de l’envoyer à la signature.');
  if (NOT_SIGNABLE.includes(doc.status)) throw new HttpError(409, 'Ce devis est déjà accepté, refusé ou expiré : plus de signature possible.');
  mkdirSync(DIR, { recursive: true });
  const file = `${nanoid(18)}.pdf`;
  writeFileSync(path.join(DIR, file), pdf.buffer);
  await prisma.quoteSignature.updateMany({ where: { documentId, status: 'pending' }, data: { status: 'revoked' } });
  const expiresAt = new Date(Date.now() + SIGN_VALID_DAYS * 86_400_000);
  const request = await prisma.quoteSignature.create({
    data: { documentId, token: nanoid(32), status: 'pending', pdfFile: file, pdfHash: sha256(pdf.buffer), sentTo: sentTo.join(', '), expiresAt, createdById: userId },
  });
  return { request, url: signUrl(request.token), expiresAt };
}

export async function revokeSignature(id: string) {
  await prisma.quoteSignature.updateMany({ where: { id, status: 'pending' }, data: { status: 'revoked' } });
}

const byToken = (token: string) => (token.length >= 16 && token.length <= 64 ? prisma.quoteSignature.findFirst({ where: { token } }) : Promise.resolve(null));

export async function publicSignatureView(token: string) {
  const r = await byToken(token);
  if (!r || r.status === 'revoked') throw new HttpError(404, 'Lien introuvable ou annulé. Demandez-en un nouveau à JJD Consult.');
  const [doc, co] = await Promise.all([
    prisma.document.findUnique({ where: { id: r.documentId }, select: { number: true, title: true, issuedOn: true, validUntil: true, totalHt: true, totalTtc: true, billingName: true, contact: { select: { name: true } }, worksite: { select: { title: true, city: true } } } }),
    getCompany(),
  ]);
  if (!doc) throw new HttpError(404, 'Devis introuvable.');
  const expired = r.status === 'pending' && r.expiresAt.getTime() < Date.now();
  return {
    status: expired ? 'expired' : r.status as 'pending' | 'signed' | 'declined',
    expiresAt: r.expiresAt, signedAt: r.signedAt, signerName: r.signerName, declinedComment: r.status === 'declined' ? r.signerComment : null,
    document: { number: doc.number, title: doc.title, issuedOn: doc.issuedOn, validUntil: doc.validUntil, totalHt: doc.totalHt, totalTtc: doc.totalTtc, clientName: doc.billingName ?? doc.contact?.name ?? null, worksite: doc.worksite },
    company: { name: co.name, email: co.email, phone: co.phone },
  };
}

export async function publicSignaturePdf(token: string): Promise<{ buffer: Buffer; filename: string }> {
  const r = await byToken(token);
  if (!r || r.status === 'revoked') throw new HttpError(404, 'Lien introuvable ou annulé.');
  const file = path.join(DIR, path.basename(r.pdfFile));
  if (!existsSync(file)) throw new HttpError(404, 'PDF introuvable.');
  const doc = await prisma.document.findUnique({ where: { id: r.documentId }, select: { number: true } });
  return { buffer: readFileSync(file), filename: `${(doc?.number ?? 'devis').replace(/[/\\]/g, '-')}.pdf` };
}

async function notify(subject: string, text: string, to: string[], r: { pdfFile: string }, doc: { number: string | null }, withPdf: boolean) {
  if (!emailConfigured() || !to.length) return;
  try {
    const file = path.join(DIR, path.basename(r.pdfFile));
    const buffer = withPdf && existsSync(file) ? readFileSync(file) : Buffer.from('');
    await sendEmailWithPdf({ to, subject, message: text, copyToSelf: false }, { buffer, filename: `${(doc.number ?? 'devis').replace(/[/\\]/g, '-')}.pdf` }, !withPdf || !buffer.length);
  } catch (e) { console.error('[signature] notification non envoyée :', e instanceof Error ? e.message : e); }
}

interface Evidence { ip: string; agent: string }

export async function signQuote(token: string, input: { name: string; accepted: boolean }, ev: Evidence) {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!input.accepted) throw new HttpError(422, 'Cochez la case pour accepter le devis et les conditions générales.');
  if (name.length < 3 || name.length > 120) throw new HttpError(422, 'Saisissez votre nom et prénom pour signer.');
  const r = await byToken(token);
  if (!r || r.status === 'revoked') throw new HttpError(404, 'Lien introuvable ou annulé.');
  if (r.status === 'signed') throw new HttpError(409, 'Ce devis est déjà signé.');
  if (r.status !== 'pending') throw new HttpError(409, 'Ce devis ne peut plus être signé.');
  if (r.expiresAt.getTime() < Date.now()) throw new HttpError(410, 'Ce lien a expiré. Demandez-en un nouveau à JJD Consult.');
  const doc = await prisma.document.findUnique({ where: { id: r.documentId } });
  if (!doc || doc.kind !== 'quote') throw new HttpError(404, 'Devis introuvable.');
  if (NOT_SIGNABLE.includes(doc.status)) throw new HttpError(409, 'Ce devis a déjà été traité : contactez JJD Consult.');
  const now = new Date();
  const claimed = await prisma.quoteSignature.updateMany({ where: { id: r.id, status: 'pending' }, data: { status: 'signed', signerName: name, signedAt: now, signerIp: ev.ip.slice(0, 64), signerAgent: ev.agent.slice(0, 300) } });
  if (claimed.count !== 1) throw new HttpError(409, 'Ce devis est déjà signé.');
  await prisma.document.update({ where: { id: doc.id }, data: { status: 'accepted', acceptedOn: now } });
  await refreshWorksiteStatus(doc.worksiteId, 'document'); // devis accepté : le chantier avance
  await prisma.auditLog.create({ data: { action: 'sign', entity: 'document', entityId: doc.id, meta: { by: name, ip: ev.ip, pdfHash: r.pdfHash, signatureId: r.id } } }).catch(() => undefined);
  const co = await getCompany();
  const when = `${formatDateBE(now)} à ${now.toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })}`;
  const recipients = (r.sentTo ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  await notify(`Devis ${doc.number} signé — ${co.name}`, `Bonjour,\n\nLe devis ${doc.number} a été accepté et signé électroniquement par ${name} le ${when}.\nVous trouverez ci-joint le devis tel qu'il a été signé.\n\nEmpreinte du document (SHA-256) : ${r.pdfHash}\n\nCordialement,\n${co.name}`, recipients, r, doc, true);
  await notify(`✍️ Devis ${doc.number} signé par ${name}`, `Le devis ${doc.number} vient d'être signé électroniquement par ${name} le ${when} (IP ${ev.ip}).\nEmpreinte SHA-256 : ${r.pdfHash}`, co.email ? [co.email] : [], r, doc, true);
  return { ok: true as const, signedAt: now, signerName: name };
}

export async function declineQuote(token: string, comment: string, ev: Evidence) {
  const r = await byToken(token);
  if (!r || r.status === 'revoked') throw new HttpError(404, 'Lien introuvable ou annulé.');
  if (r.status !== 'pending') throw new HttpError(409, 'Ce devis a déjà été traité.');
  if (r.expiresAt.getTime() < Date.now()) throw new HttpError(410, 'Ce lien a expiré.');
  const doc = await prisma.document.findUnique({ where: { id: r.documentId } });
  if (!doc || NOT_SIGNABLE.includes(doc.status)) throw new HttpError(409, 'Ce devis a déjà été traité : contactez JJD Consult.');
  const claimed = await prisma.quoteSignature.updateMany({ where: { id: r.id, status: 'pending' }, data: { status: 'declined', signerComment: comment || null, signedAt: new Date(), signerIp: ev.ip.slice(0, 64), signerAgent: ev.agent.slice(0, 300) } });
  if (claimed.count !== 1) throw new HttpError(409, 'Ce devis a déjà été traité.');
  await prisma.document.update({ where: { id: doc.id }, data: { status: 'declined', declinedReason: comment || 'Refusé par le client en ligne' } });
  await refreshWorksiteStatus(doc.worksiteId, 'document');
  const co = await getCompany();
  await notify(`Devis ${doc.number} refusé par le client`, `Le client a refusé le devis ${doc.number} en ligne.\nCommentaire : ${comment || '(aucun)'}`, co.email ? [co.email] : [], r, doc, false);
  return { ok: true as const };
}

export async function latestSignatureForDocument(documentId: string) {
  const r = await prisma.quoteSignature.findFirst({ where: { documentId, status: { not: 'revoked' } }, orderBy: { createdAt: 'desc' } });
  if (!r) return null;
  const expired = r.status === 'pending' && r.expiresAt.getTime() < Date.now();
  return { id: r.id, status: expired ? 'expired' : r.status, sentTo: r.sentTo, expiresAt: r.expiresAt, createdAt: r.createdAt, signedAt: r.signedAt, signerName: r.signerName, signerComment: r.signerComment, url: r.status === 'pending' && !expired ? signUrl(r.token) : null };
}
