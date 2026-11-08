/**
 * Connecteur Claude (protocole MCP, transport HTTP « streamable » avec réponses JSON) — lecture, plus brouillons, envoi de mail et tâches sur demande de David.
 *
 * Adresse : POST {PUBLIC_API_URL}/mcp/<CLAUDE_MCP_TOKEN>  (en production : https://new.jjd-consult.be/jjd-api/mcp/<jeton>).
 * Le jeton dans l'adresse sert de mot de passe : l'adresse ne se partage pas. Tant que CLAUDE_MCP_TOKEN
 * n'est pas défini (32 caractères minimum), le connecteur est éteint et répond 404.
 *
 * Il agit au nom de CLAUDE_MCP_USER_EMAIL (défaut : david@jjd-consult.be), qui doit faire partie de la
 * direction. Chiffres, chantiers, planning, tâches et mails en consultation. Écritures possibles, toujours à la
 * demande de David : save_mail_draft (brouillon), send_mail (envoi, confirmedByDavid obligatoire),
 * complete_task et create_task (tâches). Rien d'autre n'est validé ni modifié dans l'appli (devis, factures…).
 */
import { Router, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { z, ZodError } from 'zod';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { HttpError } from '../lib/http.js';
import { insensitive } from '../lib/search.js';
import { DATA_TOOLS, DATA_TOOL_NAMES } from '../lib/assistant-data.js';
import { isDirection } from '../lib/assistant-quota.js';
import { runTool } from './assistant.js';
import type { AuthUser } from '../lib/auth.js';
import { todaySiteArrivals } from '../lib/site-arrivals.js';
import { boxConfigured, boxesStatus, boxAddress, listFolders, listInbox, readMail, saveDraft, sendMail } from '../lib/mail-desk.js';

export const claudeMcpRouter = Router();

const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_TEXT = 12000;
const RATE_PER_MINUTE = 120;

type JsonSchema = { type: 'object'; properties?: Record<string, unknown>; required?: string[] };
interface McpTool { name: string; description: string; inputSchema: JsonSchema }

const SEARCH_TOOLS: McpTool[] = [
  { name: 'search_worksites', description: 'Cherche des chantiers par référence (ex. « R-523 ») ou par nom pour retrouver leur id.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Référence ou nom du chantier (2 caractères minimum)' } }, required: ['query'] } },
  { name: 'search_contacts', description: 'Cherche un client ou un fournisseur par nom pour retrouver son id.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, type: { type: 'string', enum: ['client', 'supplier'] } }, required: ['query'] } },
  { name: 'search_people', description: "Cherche une personne de l'équipe par nom pour retrouver son id.",
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
];

const EXTRA_TOOLS: McpTool[] = [
  { name: 'list_worksites', description: "Liste les chantiers par statut (défaut : en cours). Statuts : lead, quote_needed, quote_sent, to_plan, scheduled, in_progress, on_hold, done, to_invoice. Filtre texte facultatif. 50 résultats maximum.",
    inputSchema: { type: 'object', properties: { status: { type: 'string' }, query: { type: 'string' }, limit: { type: 'integer', description: '1 à 50 (défaut 30)' } } } },
  { name: 'open_tasks', description: "Tâches non terminées (générales ou par chantier), triées par priorité puis échéance. Filtres facultatifs : worksiteId, priority (low|normal|high|urgent). 60 résultats maximum.",
    inputSchema: { type: 'object', properties: { worksiteId: { type: 'string' }, priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] }, limit: { type: 'integer', description: '1 à 60 (défaut 40)' } } } },
  { name: 'mail_suggestions', description: "Mails analysés par la Boîte IA : demandes de devis, rendez-vous, notes de chantier, rappels de paiement. Par défaut ceux en attente de traitement. Donne sujet, expéditeur, date, résumé et chantier probable.",
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['pending', 'applied', 'dismissed', 'all'] }, kind: { type: 'string', enum: ['lead', 'appointment', 'worksite_note', 'payment_reminder', 'other'] }, limit: { type: 'integer', description: '1 à 50 (défaut 25)' } } } },
  { name: 'worksite_mails', description: "Derniers mails et notes classés sur UN chantier (id obtenu avec search_worksites) : sujet, expéditeur, date et début du texte.",
    inputSchema: { type: 'object', properties: { worksiteId: { type: 'string' }, limit: { type: 'integer', description: '1 à 20 (défaut 10)' } }, required: ['worksiteId'] } },
  { name: 'mail_folders', description: "Les boîtes mail de JJD (info@, david@, invoices@) et leurs dossiers, avec le nombre de mails et de non lus. Sans box : l'état des trois boîtes.",
    inputSchema: { type: 'object', properties: { box: { type: 'string', enum: ['info', 'david', 'invoices'], description: 'Boîte : info (défaut, info@), david (david@) ou invoices (factures fournisseurs)' } } } },
  { name: 'inbox_recent', description: "Derniers mails d'une boîte (info par défaut) et d'un dossier (INBOX par défaut ; noms des dossiers avec mail_folders), du plus récent au plus ancien : expéditeur, sujet, date, lu ou non, extrait. Lecture seule, ne marque rien comme lu. Filtres : days (1 à 365, défaut 3), unreadOnly, query (mot cherché dans sujet, expéditeur ou texte), limit (1 à 30, défaut 20).",
    inputSchema: { type: 'object', properties: { box: { type: 'string', enum: ['info', 'david', 'invoices'], description: 'Boîte : info (défaut, info@), david (david@) ou invoices (factures fournisseurs)' }, folder: { type: 'string' }, days: { type: 'integer' }, unreadOnly: { type: 'boolean' }, query: { type: 'string' }, limit: { type: 'integer' } } } },
  { name: 'read_mail', description: "Texte complet d'un mail (messageId, box et folder obtenus avec inbox_recent ; sans folder, cherche dans tous les dossiers), avec destinataires et liste des pièces jointes. Lecture seule.",
    inputSchema: { type: 'object', properties: { messageId: { type: 'string' }, box: { type: 'string', enum: ['info', 'david', 'invoices'], description: 'Boîte : info (défaut, info@), david (david@) ou invoices (factures fournisseurs)' }, folder: { type: 'string' } }, required: ['messageId'] } },
  { name: 'save_mail_draft', description: "PRÉPARE un mail sans l'envoyer : l'enregistre comme brouillon dans le dossier Brouillons de la boîte choisie (box, celle du mail d'origine), qui le relit et l'envoie lui-même depuis son webmail. Pour répondre, donne replyToMessageId (destinataire, objet « Re: » et citation remplis automatiquement ; replyAll pour garder les personnes en copie). Pour un nouveau mail, donne to et subject. body = texte du mail uniquement, signé « David ». Ne l'utilise que si David a demandé de préparer une réponse.",
    inputSchema: { type: 'object', properties: { box: { type: 'string', enum: ['info', 'david', 'invoices'], description: 'Boîte : info (défaut, info@), david (david@) ou invoices (factures fournisseurs)' }, replyToMessageId: { type: 'string' }, replyAll: { type: 'boolean' }, to: { type: 'string' }, cc: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['body'] } },
  { name: 'send_mail', description: "ENVOIE VRAIMENT un mail depuis la boîte choisie (box) (copie rangée dans Envoyés). À n'utiliser QUE si David vient de relire le texte exact et a dit de l'envoyer (« envoie », bouton Envoyer) : sinon utilise save_mail_draft. confirmedByDavid doit valoir true. Mêmes champs que save_mail_draft.",
    inputSchema: { type: 'object', properties: { box: { type: 'string', enum: ['info', 'david', 'invoices'], description: 'Boîte : info (défaut, info@), david (david@) ou invoices (factures fournisseurs)' }, replyToMessageId: { type: 'string' }, replyAll: { type: 'boolean' }, to: { type: 'string' }, cc: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, confirmedByDavid: { type: 'boolean', description: 'true seulement si David a validé ce texte et demandé l’envoi' } }, required: ['body', 'confirmedByDavid'] } },
  { name: 'site_arrivals', description: "Arrivées sur chantier aujourd'hui : pour chaque intervention planifiée, chantier, début prévu, équipe, véhicule, heure d'arrivée et de départ d'après le GPS du véhicule, et statut (sur_place, reparti, en_retard = pas arrivé 30 min après le début prévu, prevu, sans_gps). retardMinutes indique un retard. Lecture seule.",
    inputSchema: { type: 'object', properties: {} } },
  { name: 'complete_task', description: "Marque une tâche de l'appli JJD comme faite (taskId obtenu avec open_tasks). Seulement si David le demande.",
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] } },
  { name: 'create_task', description: "Crée une tâche dans l'appli JJD (générale, ou sur un chantier via worksiteId). Seulement si David le demande. priority : low|normal|high|urgent ; dueOn : AAAA-MM-JJ.",
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, worksiteId: { type: 'string' }, priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] }, dueOn: { type: 'string' } }, required: ['title'] } },
];
const WRITE_TOOLS = new Set(['save_mail_draft', 'send_mail', 'complete_task', 'create_task']);

const TOOLS: McpTool[] = [
  ...SEARCH_TOOLS,
  ...DATA_TOOLS.map((t) => ({ name: t.name, description: t.description ?? '', inputSchema: t.input_schema as JsonSchema })),
  ...EXTRA_TOOLS,
];
const SEARCH_NAMES = new Set(SEARCH_TOOLS.map((t) => t.name));

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

async function runExtraTool(name: string, raw: Record<string, unknown>, who: { id: string; name: string }): Promise<unknown> {
  switch (name) {
    case 'list_worksites': {
      const i = z.object({ status: z.string().trim().max(20).optional(), query: z.string().trim().min(1).max(100).optional(), limit: z.number().int().min(1).max(50).optional() }).strict().parse(raw);
      const rows = await prisma.worksite.findMany({
        where: {
          archived: false, kind: 'project', status: i.status ?? 'in_progress',
          ...(i.query ? { OR: [{ ref: { contains: i.query, ...insensitive } }, { title: { contains: i.query, ...insensitive } }, { city: { contains: i.query, ...insensitive } }] } : {}),
        },
        orderBy: { updatedAt: 'desc' }, take: i.limit ?? 30,
        select: { id: true, ref: true, title: true, status: true, priority: true, city: true, entity: true, quotedHt: true, startedOn: true, client: { select: { name: true } }, manager: { select: { displayName: true, firstName: true } } },
      });
      return { nombre: rows.length, chantiers: rows.map((w) => ({ id: w.id, ref: w.ref, titre: w.title, statut: w.status, priorite: w.priority, ville: w.city, entite: w.entity, client: w.client?.name ?? null, responsable: w.manager?.displayName || w.manager?.firstName || null, deviseHt: w.quotedHt, debut: day(w.startedOn) })) };
    }
    case 'open_tasks': {
      const i = z.object({ worksiteId: z.string().min(1).max(60).optional(), priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(), limit: z.number().int().min(1).max(60).optional() }).strict().parse(raw);
      const rows = await prisma.worksiteTask.findMany({
        where: { status: { not: 'done' }, ...(i.worksiteId ? { worksiteId: i.worksiteId } : {}), ...(i.priority ? { priority: i.priority } : {}) },
        take: 200,
        select: { id: true, title: true, status: true, priority: true, dueOn: true, source: true, worksite: { select: { ref: true, title: true } }, assignees: { select: { person: { select: { displayName: true, firstName: true } } } } },
      });
      const sorted = rows.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) || (a.dueOn?.getTime() ?? Infinity) - (b.dueOn?.getTime() ?? Infinity)).slice(0, i.limit ?? 40);
      return { nombre: rows.length, taches: sorted.map((t) => ({ id: t.id, titre: t.title, statut: t.status, priorite: t.priority, echeance: day(t.dueOn), chantier: t.worksite?.ref ?? null, chantierTitre: t.worksite?.title ?? null, assignes: t.assignees.map((a) => a.person.displayName || a.person.firstName), proposeeParIa: t.source === 'ai-draft' })) };
    }
    case 'mail_suggestions': {
      const i = z.object({ status: z.enum(['pending', 'applied', 'dismissed', 'all']).optional(), kind: z.enum(['lead', 'appointment', 'worksite_note', 'payment_reminder', 'other']).optional(), limit: z.number().int().min(1).max(50).optional() }).strict().parse(raw);
      const status = i.status ?? 'pending';
      const rows = await prisma.mailSuggestion.findMany({
        where: { kind: i.kind ?? { not: null }, ...(status === 'all' ? {} : { status }) },
        orderBy: { receivedAt: 'desc' }, take: i.limit ?? 25,
        select: { subject: true, fromAddress: true, receivedAt: true, kind: true, status: true, summary: true, worksite: { select: { ref: true, title: true } } },
      });
      return { nombre: rows.length, mails: rows.map((m) => ({ sujet: m.subject, de: m.fromAddress, recu: m.receivedAt?.toISOString() ?? null, type: m.kind, statut: m.status, resume: m.summary, chantier: m.worksite?.ref ?? null, chantierTitre: m.worksite?.title ?? null })) };
    }
    case 'worksite_mails': {
      const i = z.object({ worksiteId: z.string().min(1).max(60), limit: z.number().int().min(1).max(20).optional() }).strict().parse(raw);
      const ws = await prisma.worksite.findUnique({ where: { id: i.worksiteId }, select: { ref: true, title: true } });
      if (!ws) return { erreur: 'Chantier introuvable — utilise search_worksites.' };
      const rows = await prisma.worksiteMail.findMany({
        where: { worksiteId: i.worksiteId }, orderBy: { receivedAt: 'desc' }, take: i.limit ?? 10,
        select: { kind: true, subject: true, fromAddress: true, toAddress: true, receivedAt: true, bodyText: true, note: true },
      });
      return { chantier: ws.ref, titre: ws.title, mails: rows.map((m) => ({ type: m.kind, sujet: m.subject, de: m.fromAddress, a: m.toAddress, recu: m.receivedAt?.toISOString() ?? null, extrait: (m.bodyText ?? '').replace(/\s+/g, ' ').trim().slice(0, 1200), note: m.note })) };
    }
    case 'mail_folders': {
      const i = z.object({ box: z.enum(['info', 'david', 'invoices']).optional() }).strict().parse(raw);
      if (!i.box) return { boites: boxesStatus() };
      if (!boxConfigured(i.box)) return { erreur: `La boîte « ${i.box} » n’est pas configurée sur le serveur.`, boites: boxesStatus() };
      return { boite: i.box, adresse: boxAddress(i.box), dossiers: await listFolders(i.box) };
    }
    case 'inbox_recent': {
      const i = z.object({ box: z.enum(['info', 'david', 'invoices']).optional(), folder: z.string().trim().min(1).max(200).optional(), days: z.number().int().min(1).max(365).optional(), unreadOnly: z.boolean().optional(), query: z.string().trim().min(2).max(80).optional(), limit: z.number().int().min(1).max(30).optional() }).strict().parse(raw);
      const box = i.box ?? 'info';
      if (!boxConfigured(box)) return { erreur: `La boîte « ${box} » n’est pas configurée sur le serveur.`, boites: boxesStatus() };
      const mails = await listInbox({ box, folder: i.folder, days: i.days ?? 3, limit: i.limit ?? 20, unreadOnly: i.unreadOnly ?? false, query: i.query });
      return { boite: box, dossier: i.folder ?? 'INBOX', nombre: mails.length, mails };
    }
    case 'read_mail': {
      const i = z.object({ messageId: z.string().min(3).max(300), box: z.enum(['info', 'david', 'invoices']).optional(), folder: z.string().trim().min(1).max(200).optional() }).strict().parse(raw);
      const box = i.box ?? 'info';
      if (!boxConfigured(box)) return { erreur: `La boîte « ${box} » n’est pas configurée sur le serveur.` };
      return (await readMail(i.messageId, box, i.folder)) ?? { erreur: 'Mail introuvable dans cette boîte.' };
    }
    case 'save_mail_draft': {
      const i = z.object({ box: z.enum(['info', 'david', 'invoices']).optional(), replyToMessageId: z.string().min(3).max(300).optional(), replyAll: z.boolean().optional(), to: z.string().max(500).optional(), cc: z.string().max(500).optional(), subject: z.string().max(250).optional(), body: z.string().min(1).max(20000) }).strict()
        .refine((v) => v.replyToMessageId || (v.to && v.subject), { message: 'replyToMessageId, ou bien to et subject' }).parse(raw);
      if (!boxConfigured(i.box ?? 'info')) return { erreur: `La boîte « ${i.box ?? 'info'} » n’est pas configurée sur le serveur.` };
      const r = await saveDraft(i);
      return { ok: true, envoye: false, note: 'Brouillon enregistré, rien n’a été envoyé. David le relit et l’envoie depuis son webmail.', ...r };
    }
    case 'send_mail': {
      const i = z.object({ box: z.enum(['info', 'david', 'invoices']).optional(), replyToMessageId: z.string().min(3).max(300).optional(), replyAll: z.boolean().optional(), to: z.string().max(500).optional(), cc: z.string().max(500).optional(), subject: z.string().max(250).optional(), body: z.string().min(1).max(20000), confirmedByDavid: z.boolean() }).strict()
        .refine((v) => v.replyToMessageId || (v.to && v.subject), { message: 'replyToMessageId, ou bien to et subject' }).parse(raw);
      if (!boxConfigured(i.box ?? 'info')) return { erreur: `La boîte « ${i.box ?? 'info'} » n’est pas configurée sur le serveur.` };
      if (i.confirmedByDavid !== true) return { erreur: 'Envoi refusé : David doit relire le texte et demander l’envoi. Utilise save_mail_draft en attendant.' };
      const { confirmedByDavid: _c, ...mail } = i;
      return { ok: true, ...(await sendMail(mail)) };
    }
    case 'site_arrivals': {
      z.object({}).strict().parse(raw);
      const r = await todaySiteArrivals();
      return { gpsConfigure: r.gps, nombre: r.arrivees.length, arrivees: r.arrivees };
    }
    case 'complete_task': {
      const i = z.object({ taskId: z.string().min(1).max(60) }).strict().parse(raw);
      const t = await prisma.worksiteTask.findUnique({ where: { id: i.taskId }, select: { id: true, title: true, status: true } });
      if (!t) return { erreur: 'Tâche introuvable — utilise open_tasks.' };
      if (t.status === 'done') return { ok: true, deja: true, titre: t.title };
      await prisma.worksiteTask.update({ where: { id: t.id }, data: { status: 'done', doneAt: new Date(), doneByName: who.name } });
      return { ok: true, titre: t.title, statut: 'done' };
    }
    case 'create_task': {
      const i = z.object({ title: z.string().trim().min(2).max(200), description: z.string().trim().max(2000).optional(), worksiteId: z.string().min(1).max(60).optional(), priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(), dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict().parse(raw);
      if (i.worksiteId && !(await prisma.worksite.findUnique({ where: { id: i.worksiteId }, select: { id: true } }))) return { erreur: 'Chantier introuvable — utilise search_worksites.' };
      const t = await prisma.worksiteTask.create({ data: { title: i.title, description: i.description, worksiteId: i.worksiteId ?? null, priority: i.priority ?? 'normal', dueOn: i.dueOn ? new Date(`${i.dueOn}T12:00:00Z`) : null, createdById: who.id, source: 'claude' } });
      return { ok: true, id: t.id, titre: t.title };
    }
    default:
      return { erreur: `Outil inconnu : ${name}` };
  }
}

/** Sert de garde-fou de taille : le résultat est renvoyé au modèle, il doit rester lisible. */
function asText(value: unknown): string {
  const json = JSON.stringify(value);
  if (json.length <= MAX_TEXT) return json;
  return JSON.stringify({ tronque: true, note: 'Résultat trop long, tronqué : affine la demande (filtre, période plus courte).', debut: json.slice(0, MAX_TEXT) });
}

function tokenMatches(given: string): boolean {
  const expected = env.claudeMcpToken;
  if (!expected || expected.length < 32) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function connectorUser(): Promise<AuthUser | null> {
  const u = await prisma.user.findUnique({ where: { email: env.claudeMcpUserEmail.toLowerCase() } });
  if (!u || !u.active) return null;
  const user: AuthUser = { id: u.id, email: u.email, role: u.role as AuthUser['role'], isPartner: u.isPartner, entityScope: u.entityScope ?? null, personId: u.personId, contactId: u.contactId, locale: u.locale };
  return isDirection(user) ? user : null;
}

const hits: number[] = [];
function rateLimited(now = Date.now()): boolean {
  while (hits.length && now - hits[0]! > 60_000) hits.shift();
  if (hits.length >= RATE_PER_MINUTE) return true;
  hits.push(now);
  return false;
}

type RpcMessage = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
const rpcError = (id: RpcMessage['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

export async function handleRpc(msg: RpcMessage, user: AuthUser): Promise<object | null> {
  if (!msg || typeof msg !== 'object' || typeof msg.method !== 'string') return rpcError(msg?.id, -32600, 'Requête invalide');
  const isNotification = msg.id === undefined || msg.id === null;
  if (isNotification) return null;
  const id = msg.id;
  switch (msg.method) {
    case 'initialize': {
      const asked = String(msg.params?.protocolVersion ?? '');
      return { jsonrpc: '2.0', id, result: {
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'jjd-consult', title: 'JJD Consult', version: '1.0.0' },
        instructions: "Données de gestion de JJD Consult (rénovation, Bruxelles et Brabant wallon) et boîte mail de David. Tout est en lecture seule, sauf : save_mail_draft (brouillon), send_mail (envoi, seulement quand David a relu et demandé l'envoi), complete_task et create_task (tâches, sur demande de David). Commence par search_worksites pour retrouver l'id d'un chantier. Montants en euros, HT sauf mention. R-069 et R-152 sont des dépenses privées des associés, à exclure des analyses de l'entreprise.",
      } };
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: TOOLS.map((t) => ({ ...t, annotations: { readOnlyHint: !WRITE_TOOLS.has(t.name), destructiveHint: false, idempotentHint: !WRITE_TOOLS.has(t.name), openWorldHint: false } })) } };
    case 'tools/call': {
      const name = String(msg.params?.name ?? '');
      const args = (msg.params?.arguments && typeof msg.params.arguments === 'object' ? msg.params.arguments : {}) as Record<string, unknown>;
      if (!TOOLS.some((t) => t.name === name)) return rpcError(id, -32602, `Outil inconnu : ${name}`);
      try {
        let result: unknown;
        if (SEARCH_NAMES.has(name) || DATA_TOOL_NAMES.has(name)) result = (await runTool(name, args, user.id)).result;
        else result = await runExtraTool(name, args, { id: user.id, name: 'David (via Claude)' });
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: asText(result) }] } };
      } catch (e) {
        const text = e instanceof ZodError ? `Paramètres invalides : ${e.issues.map((x) => `${x.path.join('.') || 'arguments'} ${x.message}`).join(' ; ')}`
          : e instanceof HttpError ? e.message : 'Erreur pendant la lecture des données.';
        if (!(e instanceof ZodError) && !(e instanceof HttpError)) console.error('[claude-mcp]', e); // eslint-disable-line no-console
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: true } };
      }
    }
    default:
      return rpcError(id, -32601, `Méthode non prise en charge : ${msg.method}`);
  }
}

async function guard(req: Request, res: Response): Promise<AuthUser | null> {
  if (!tokenMatches(String(req.params.token ?? ''))) { res.status(404).json({ error: 'Introuvable' }); return null; }
  if (rateLimited()) { res.status(429).json({ error: 'Trop de demandes, réessaie dans une minute.' }); return null; }
  const user = await connectorUser();
  if (!user) { res.status(503).json({ error: 'Compte du connecteur introuvable ou hors direction.' }); return null; }
  return user;
}

claudeMcpRouter.post('/:token', (req, res, next) => {
  (async () => {
    const user = await guard(req, res);
    if (!user) return;
    const body = req.body as RpcMessage | RpcMessage[];
    const batch = Array.isArray(body) ? body : [body];
    const out: object[] = [];
    for (const m of batch) { const r = await handleRpc(m, user); if (r) out.push(r); }
    if (!out.length) { res.status(202).end(); return; }
    res.json(Array.isArray(body) ? out : out[0]);
  })().catch(next);
});
// Pas de flux serveur → client ni de session à fermer : seules les requêtes POST sont acceptées.
claudeMcpRouter.get('/:token', (req, res) => { if (!tokenMatches(String(req.params.token ?? ''))) return res.status(404).json({ error: 'Introuvable' }); res.set('Allow', 'POST').status(405).end(); });
claudeMcpRouter.delete('/:token', (req, res) => { if (!tokenMatches(String(req.params.token ?? ''))) return res.status(404).json({ error: 'Introuvable' }); res.status(405).end(); });
