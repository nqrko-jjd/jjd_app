/**
 * Envoi d'un devis / d'une facture / d'une note de crédit par e-mail, PDF en pièce jointe, depuis la boîte JJD (SMTP).
 * Distinct de `sendMail` (mail.ts), qui ne fait que journaliser : cette fonction-ci envoie VRAIMENT ou échoue, sans rien marquer « envoyé ».
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { z } from 'zod';
import { DOC_KIND_LABEL, formatEur, formatDateBE } from '@jjd/shared';
import { env } from '../env.js';
import { HttpError } from './http.js';

export const emailConfigured = () => !!(env.smtp.host && env.smtp.user && env.smtp.password);
const fromAddress = () => env.smtp.from || `JJD Consult <${env.smtp.user}>`;

let transport: Transporter | null = null;
function getTransport(): Transporter {
  transport ??= nodemailer.createTransport({
    host: env.smtp.host, port: env.smtp.port, secure: env.smtp.port === 465, requireTLS: env.smtp.port === 587,
    auth: { user: env.smtp.user, pass: env.smtp.password },
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
  });
  return transport;
}
/** Tests : remplace le transport SMTP (ex. nodemailer jsonTransport). */
export function setMailTransportForTests(t: Transporter | null) { transport = t; }

export const emailInput = z.object({
  to: z.array(z.string().trim().email()).min(1).max(5),
  subject: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(5000),
  copyToSelf: z.boolean().default(true),
  /** Devis seulement : ajoute un lien pour accepter et signer en ligne. */
  sign: z.boolean().default(false),
}).strict();
export type EmailInput = z.infer<typeof emailInput>;

const ARTICLE: Record<string, string> = { quote: 'le devis', invoice: 'la facture', deposit_invoice: 'la facture d’acompte', credit_note: 'la note de crédit' };

/** Destinataire, objet et texte proposés (modifiables à l'écran avant l'envoi). */
export function defaultEmail(d: {
  kind: string; number: string | null; draftRef: string | null; totalTtc: number; dueOn: Date | null; structuredComm: string | null;
  billingEmail: string | null; contact: { email: string | null } | null; worksite: { ref: string } | null;
}, company: { name: string; phone: string }) {
  const label = DOC_KIND_LABEL[d.kind] ?? 'Document';
  const ref = d.number ?? d.draftRef ?? '';
  const invoiceLike = d.kind === 'invoice' || d.kind === 'deposit_invoice';
  const lines = [
    'Bonjour,',
    '',
    `Veuillez trouver ci-joint ${ARTICLE[d.kind] ?? 'le document'} ${ref}${d.worksite ? ` (chantier ${d.worksite.ref})` : ''}, d’un montant de ${formatEur(Math.abs(d.totalTtc))} TTC.`,
    ...(invoiceLike && d.dueOn ? [`Échéance : ${formatDateBE(d.dueOn)}${d.structuredComm ? ` — communication structurée : ${d.structuredComm}` : ''}.`] : []),
    ...(d.kind === 'quote' ? ['Il vous suffit de nous le retourner daté et signé avec la mention « Bon pour accord ».'] : []),
    '',
    'N’hésitez pas à nous contacter pour toute question.',
    '',
    'Cordialement,',
    company.name,
    ...(company.phone ? [company.phone] : []),
  ];
  return { to: d.billingEmail ?? d.contact?.email ?? '', subject: `${label} ${ref} — ${company.name}`, message: lines.join('\n') };
}

/** Envoie l'e-mail ; lève une erreur (rien d'enregistré) si le serveur SMTP refuse. */
export async function sendEmailWithPdf(input: Pick<EmailInput, 'to' | 'subject' | 'message' | 'copyToSelf'>, pdf: { buffer: Buffer; filename: string }, withoutAttachment = false): Promise<void> {
  if (!emailConfigured()) throw new HttpError(503, 'Envoi par e-mail non configuré : le serveur d’envoi de la boîte JJD n’est pas encore branché.');
  try {
    await getTransport().sendMail({
      from: fromAddress(), replyTo: fromAddress(), to: input.to, ...(input.copyToSelf ? { bcc: fromAddress() } : {}),
      subject: input.subject, text: input.message,
      ...(withoutAttachment ? {} : { attachments: [{ filename: pdf.filename, content: pdf.buffer, contentType: 'application/pdf' }] }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'erreur inconnue';
    console.error('[email] échec d’envoi :', msg);
    throw new HttpError(502, `L’e-mail n’a pas pu être envoyé (${msg.slice(0, 160)}). Rien n’a été enregistré comme envoyé.`);
  }
}
