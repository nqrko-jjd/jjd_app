/**
 * Bureau des mails du connecteur Claude : lire la boîte principale et y PRÉPARER des réponses.
 *
 * Même boîte et mêmes identifiants que la Boîte IA (LEADS_IMAP_*), déjà configurés sur le serveur :
 * aucune reconnexion côté Claude. Lecture en BODY.PEEK (aucun \Seen posé, rien n'est déplacé).
 * La seule écriture possible est l'ajout d'un BROUILLON dans le dossier Brouillons : rien n'est
 * jamais envoyé. David relit le brouillon dans son webmail et l'envoie lui-même.
 */
import { ImapFlow, type FetchMessageObject } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import { env } from '../env.js';
import { mailSuggestionsConfigured, fetchMailSource } from './lead-mailbox.js';
import { mailPlainText } from './mail-render.js';

export const mailDeskConfigured = mailSuggestionsConfigured;

function client() {
  return new ImapFlow({
    host: env.leadsMailbox.host, port: env.leadsMailbox.port, secure: env.leadsMailbox.port !== 1143, // 1143 : serveur de test local sans TLS
    auth: { user: env.leadsMailbox.user, pass: env.leadsMailbox.password }, logger: false,
  });
}

async function withClient<T>(fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  const c = client();
  await c.connect();
  try { return await fn(c); } finally { await c.logout().catch(() => c.close()); }
}

const snippet = (t: string, n: number) => t.replace(/\s+/g, ' ').trim().slice(0, n);

export interface InboxItem {
  messageId: string; date: string | null; from: string; to: string; subject: string;
  lu: boolean; pieceJointe: boolean; extrait: string;
}

/** Derniers mails de la boîte de réception (du plus récent au plus ancien), lecture seule. */
export async function listInbox(opts: { days: number; limit: number; unreadOnly: boolean; query?: string }): Promise<InboxItem[]> {
  return withClient(async (c) => {
    const lock = await c.getMailboxLock('INBOX', { readOnly: true });
    try {
      const since = new Date(Date.now() - opts.days * 86400000);
      const criteria: Record<string, unknown> = { since };
      if (opts.unreadOnly) criteria.seen = false;
      if (opts.query) criteria.or = [{ subject: opts.query }, { from: opts.query }, { body: opts.query }];
      const uids = ((await c.search(criteria, { uid: true })) as number[]).sort((a, b) => b - a).slice(0, opts.limit);
      const out: InboxItem[] = [];
      for (const uid of uids) {
        const msg = (await c.fetchOne(String(uid), { source: true, envelope: true, flags: true }, { uid: true })) as FetchMessageObject | false;
        if (!msg || !msg.source) continue;
        const parsed = await simpleParser(msg.source);
        out.push({
          messageId: msg.envelope?.messageId || parsed.messageId || `uid-${uid}`,
          date: (() => { const d = parsed.date ?? msg.envelope?.date; return d ? new Date(d).toISOString() : null; })(),
          from: parsed.from?.text ?? '',
          to: parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map((t) => t.text).join(', ') : parsed.to.text) : '',
          subject: parsed.subject ?? '',
          lu: !!msg.flags?.has('\\Seen'),
          pieceJointe: (parsed.attachments ?? []).some((a) => !a.contentId),
          extrait: snippet(mailPlainText(parsed.text, typeof parsed.html === 'string' ? parsed.html : ''), 280),
        });
      }
      return out;
    } finally { lock.release(); }
  });
}

/** Un mail complet (texte, destinataires, liste des pièces jointes), lecture seule. */
export async function readMail(messageId: string) {
  const m = await fetchMailSource(messageId);
  if (!m) return null;
  return { sujet: m.subject, de: m.from, a: m.to, recu: m.receivedAt?.toISOString() ?? null, texte: m.text.slice(0, 12000), piecesJointes: m.attachments.map((a) => ({ nom: a.filename, type: a.contentType, taille: a.size })) };
}

async function draftsPath(c: ImapFlow): Promise<string> {
  const boxes = await c.list();
  const special = boxes.find((b) => b.specialUse === '\\Drafts');
  if (special) return special.path;
  const byName = boxes.find((b) => /^(inbox[./])?(drafts|brouillons|concepten)$/i.test(b.path));
  if (byName) return byName.path;
  throw new Error('Dossier Brouillons introuvable dans la boîte.');
}

/** Construit le message brut (RFC 822) en mémoire : le transport « stream » ne contacte aucun serveur et n'envoie rien. */
const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
async function buildRaw(mail: Record<string, unknown>): Promise<Buffer> {
  const info = await composer.sendMail(mail);
  return info.message as Buffer;
}

/**
 * Enregistre un brouillon (réponse à un mail existant, ou nouveau mail) dans le dossier Brouillons.
 * N'envoie rien. Retourne le dossier utilisé.
 */
export async function saveDraft(input: { replyToMessageId?: string; replyAll?: boolean; to?: string; cc?: string; subject?: string; body: string }) {
  const me = env.leadsMailbox.user;
  let to = input.to ?? '', cc = input.cc ?? '', subject = input.subject ?? '', inReplyTo: string | undefined, references: string[] | undefined, quote = '';
  if (input.replyToMessageId) {
    const original = await withClient(async (c) => {
      const lock = await c.getMailboxLock('INBOX', { readOnly: true });
      try {
        const uids = (await c.search({ header: { 'message-id': input.replyToMessageId! } }, { uid: true })) as number[];
        if (!uids[0]) return null;
        const msg = (await c.fetchOne(String(uids[0]), { source: true }, { uid: true })) as FetchMessageObject | false;
        return msg && msg.source ? simpleParser(msg.source) : null;
      } finally { lock.release(); }
    });
    if (!original) throw new Error('Mail d’origine introuvable dans la boîte de réception.');
    const addr = (v: unknown) => (Array.isArray(v) ? v : v ? [v] : []).flatMap((x: { value?: { address?: string }[] }) => x.value ?? []).map((x) => x.address ?? '').filter(Boolean);
    const replyTo = addr(original.replyTo).length ? addr(original.replyTo) : addr(original.from);
    if (!to) to = replyTo.join(', ');
    if (input.replyAll && !cc) cc = [...addr(original.to), ...addr(original.cc)].filter((a) => a.toLowerCase() !== me.toLowerCase() && !replyTo.includes(a)).join(', ');
    if (!subject) subject = /^(re|tr|fwd?)\s*:/i.test(original.subject ?? '') ? original.subject ?? '' : `Re: ${original.subject ?? ''}`;
    inReplyTo = original.messageId;
    const prev = Array.isArray(original.references) ? original.references : original.references ? [original.references] : [];
    references = [...prev, ...(original.messageId ? [original.messageId] : [])];
    const when = original.date ? original.date.toLocaleString('fr-BE', { timeZone: 'Europe/Brussels' }) : '';
    quote = `\n\n${when ? `Le ${when}, ` : ''}${original.from?.text ?? ''} a écrit :\n` + mailPlainText(original.text, typeof original.html === 'string' ? original.html : '').split('\n').slice(0, 80).map((l) => `> ${l}`).join('\n');
  }
  if (!to) throw new Error('Destinataire manquant.');
  const raw = await buildRaw({ from: me, to, cc: cc || undefined, subject, text: input.body + quote, inReplyTo, references, date: new Date() });
  return withClient(async (c) => {
    const path = await draftsPath(c);
    await c.append(path, raw, ['\\Draft', '\\Seen']);
    return { dossier: path, a: to, cc: cc || null, sujet: subject };
  });
}
