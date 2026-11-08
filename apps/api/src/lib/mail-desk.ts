/**
 * Bureau des mails du connecteur Claude : lire les boîtes de JJD (info, david, invoices), leurs dossiers,
 * et y PRÉPARER des réponses.
 *
 * Identifiants déjà configurés sur le serveur : info = LEADS_IMAP_*, invoices = INVOICES_IMAP_*, david = DAVID_IMAP_*
 * (hôte par défaut : celui de info). Aucune reconnexion côté Claude. Lecture en BODY.PEEK, dossiers ouverts en
 * lecture seule : aucun \Seen posé, rien n'est déplacé. Écritures possibles : un BROUILLON dans le dossier
 * Brouillons, et l'envoi quand David clique lui-même sur « Envoyer » (sendMail).
 */
import { ImapFlow, type FetchMessageObject } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../env.js';
import { mailPlainText } from './mail-render.js';

export const BOXES = ['info', 'david', 'invoices'] as const;
export type BoxKey = (typeof BOXES)[number];
interface BoxCfg { host: string; port: number; user: string; password: string }
function cfg(box: BoxKey): BoxCfg {
  if (box === 'invoices') return env.invoicesMailbox;
  if (box === 'david') return { ...env.davidMailbox, host: env.davidMailbox.host || env.leadsMailbox.host };
  return env.leadsMailbox;
}
export const boxConfigured = (box: BoxKey) => { const c = cfg(box); return !!(c.host && c.user && c.password); };
export const mailDeskConfigured = () => BOXES.some(boxConfigured);
export const boxAddress = (box: BoxKey) => cfg(box).user;
export function boxesStatus() { return BOXES.map((b) => ({ boite: b, adresse: boxConfigured(b) ? cfg(b).user : null, configuree: boxConfigured(b) })); }

function client(box: BoxKey) {
  const c = cfg(box);
  return new ImapFlow({ host: c.host, port: c.port, secure: c.port !== 1143, auth: { user: c.user, pass: c.password }, logger: false }); // 1143 : serveur de test local sans TLS
}
async function withClient<T>(box: BoxKey, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  if (!boxConfigured(box)) throw new Error(`La boîte « ${box} » n’est pas configurée sur le serveur.`);
  const c = client(box);
  await c.connect();
  try { return await fn(c); } finally { await c.logout().catch(() => c.close()); }
}

const snippet = (t: string, n: number) => t.replace(/\s+/g, ' ').trim().slice(0, n);
const SKIP_RE = /^(trash|deleted|deleted items|deleted messages|corbeille|prullenbak|junk|spam|ind[ée]sirables?)$/i;

/** Dossiers d'une boîte, avec le nombre de mails et de non lus. */
export async function listFolders(box: BoxKey) {
  return withClient(box, async (c) => {
    const list = await c.list({ statusQuery: { messages: true, unseen: true } });
    return list.filter((m) => !m.flags?.has('\\Noselect')).map((m) => ({ dossier: m.path, role: m.specialUse ?? null, mails: m.status?.messages ?? null, nonLus: m.status?.unseen ?? null }));
  });
}

export interface InboxItem {
  messageId: string; date: string | null; from: string; to: string; subject: string;
  lu: boolean; pieceJointe: boolean; extrait: string; boite: BoxKey; dossier: string;
}

/** Derniers mails d'un dossier (INBOX par défaut), du plus récent au plus ancien, lecture seule. */
export async function listInbox(opts: { box?: BoxKey; folder?: string; days: number; limit: number; unreadOnly: boolean; query?: string }): Promise<InboxItem[]> {
  const box = opts.box ?? 'info', folder = opts.folder || 'INBOX';
  return withClient(box, async (c) => {
    const lock = await c.getMailboxLock(folder, { readOnly: true });
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
          boite: box, dossier: folder,
        });
      }
      return out;
    } finally { lock.release(); }
  });
}

/** Retrouve un mail par Message-ID : dans le dossier donné, sinon INBOX puis tous les dossiers (hors corbeille et spam). */
async function findMessage(c: ImapFlow, messageId: string, folder?: string): Promise<{ parsed: ParsedMail; folder: string } | null> {
  const tryFolder = async (path: string) => {
    const lock = await c.getMailboxLock(path, { readOnly: true }).catch(() => null);
    if (!lock) return null;
    try {
      const uids = (await c.search({ header: { 'message-id': messageId } }, { uid: true })) as number[];
      if (!uids[0]) return null;
      const msg = (await c.fetchOne(String(uids[0]), { source: true }, { uid: true })) as FetchMessageObject | false;
      return msg && msg.source ? { parsed: await simpleParser(msg.source), folder: path } : null;
    } finally { lock.release(); }
  };
  if (folder) return tryFolder(folder);
  const first = await tryFolder('INBOX');
  if (first) return first;
  const all = (await c.list()).filter((m) => !m.flags?.has('\\Noselect') && m.path !== 'INBOX' && !SKIP_RE.test(m.path.split(/[./]/).pop() ?? ''));
  for (const m of all.slice(0, 40)) { const r = await tryFolder(m.path); if (r) return r; }
  return null;
}

/** Un mail complet (texte, destinataires, liste des pièces jointes), lecture seule. */
export async function readMail(messageId: string, box: BoxKey = 'info', folder?: string) {
  const r = await withClient(box, (c) => findMessage(c, messageId, folder));
  if (!r) return null;
  const m = r.parsed, list = (v: unknown) => (Array.isArray(v) ? v.map((x: { text: string }) => x.text).join(', ') : (v as { text?: string } | undefined)?.text ?? '');
  return {
    sujet: m.subject ?? '', de: m.from?.text ?? '', a: list(m.to), cc: list(m.cc) || null, recu: m.date ? new Date(m.date).toISOString() : null, boite: box, dossier: r.folder,
    texte: mailPlainText(m.text, typeof m.html === 'string' ? m.html : '').slice(0, 12000),
    piecesJointes: (m.attachments ?? []).filter((a) => !a.contentId).map((a) => ({ nom: a.filename ?? 'sans nom', type: a.contentType, taille: a.size })),
  };
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

type ComposeInput = { box?: BoxKey; replyToMessageId?: string; replyAll?: boolean; to?: string; cc?: string; subject?: string; body: string };

/** Prépare le message (destinataires, objet, fil de discussion, citation) sans rien contacter d'autre que la boîte en lecture. */
async function compose(input: ComposeInput) {
  const box = input.box ?? 'info', me = cfg(box).user;
  let to = input.to ?? '', cc = input.cc ?? '', subject = input.subject ?? '', inReplyTo: string | undefined, references: string[] | undefined, quote = '';
  if (input.replyToMessageId) {
    const original = (await withClient(box, (c) => findMessage(c, input.replyToMessageId!)))?.parsed ?? null;
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
  const mail = { from: me, to, cc: cc || undefined, subject, text: input.body + quote, inReplyTo, references, date: new Date() };
  return { mail, to, cc, subject, box };
}

async function folderPath(c: ImapFlow, use: '\\Drafts' | '\\Sent', names: RegExp): Promise<string | null> {
  const boxes = await c.list();
  return boxes.find((b) => b.specialUse === use)?.path ?? boxes.find((b) => names.test(b.path))?.path ?? null;
}

/**
 * Enregistre un brouillon (réponse à un mail existant, ou nouveau mail) dans le dossier Brouillons.
 * N'envoie rien. Retourne le dossier utilisé.
 */
export async function saveDraft(input: ComposeInput) {
  const { mail, to, cc, subject, box } = await compose(input);
  const raw = await buildRaw(mail);
  return withClient(box, async (c) => {
    const path = await draftsPath(c);
    await c.append(path, raw, ['\\Draft', '\\Seen']);
    return { boite: box, dossier: path, a: to, cc: cc || null, sujet: subject };
  });
}

/** SMTP de chaque boîte : même serveur et mêmes identifiants que la lecture, sauf MAIL_DESK_SMTP_HOST/PORT. */
const smtp = new Map<BoxKey, Transporter>();
let testTransport: Transporter | null = null;
function smtpTransport(box: BoxKey): Transporter {
  if (testTransport) return testTransport;
  const port = env.mailDeskSmtp.port, c = cfg(box);
  if (!smtp.has(box)) smtp.set(box, nodemailer.createTransport({
    host: env.mailDeskSmtp.host || c.host, port, secure: port === 465, requireTLS: port === 587,
    auth: { user: c.user, pass: c.password }, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
  }));
  return smtp.get(box)!;
}
/** Tests : remplace le transport SMTP. */
export function setMailDeskTransportForTests(t: Transporter | null) { testTransport = t; }

/**
 * ENVOIE un mail depuis la boîte de David, puis en range une copie dans « Envoyés ».
 * Uniquement sur demande explicite de David (bouton « Envoyer » du QG, ou « envoie-le » dans une conversation).
 */
export async function sendMail(input: ComposeInput) {
  const { mail, to, cc, subject, box } = await compose(input);
  const info = await smtpTransport(box).sendMail(mail);
  let rangeDans: string | null = null;
  try {
    const raw = await buildRaw({ ...mail, messageId: info.messageId });
    rangeDans = await withClient(box, async (c) => {
      const path = await folderPath(c, '\\Sent', /^(inbox[./])?(sent|sent items|sent messages|envoy[ée]s|[ée]l[ée]ments envoy[ée]s|verzonden)$/i);
      if (path) await c.append(path, raw, ['\\Seen']);
      return path;
    });
  } catch { /* le mail est parti : la copie dans Envoyés est un plus */ }
  return { envoye: true, boite: box, de: cfg(box).user, a: to, cc: cc || null, sujet: subject, messageId: info.messageId, copieDans: rangeDans };
}
