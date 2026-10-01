/**
 * « Boîte IA » — lit la boîte mail principale (ex. info@/david@) et propose une action pour
 * chaque mail qui en mérite une : nouvelle demande client, rendez-vous à planifier, note à
 * tracer sur un chantier, rappel de paiement, ou "autre" en secours. RIEN n'est créé
 * automatiquement — chaque suggestion reste "à vérifier" (MailSuggestion.status='pending')
 * jusqu'à validation explicite côté app (voir routes/mail-suggestions.ts), qui seule crée le
 * vrai enregistrement (CrmOpportunity, PlanningEvent, message de fil de chantier…).
 *
 * Boîte perso/pro de l'utilisateur : on ne la modifie JAMAIS (pas de \Seen, pas de
 * déplacement) — le suivi "déjà vu" vit entièrement côté base (MailSuggestion, table
 * `ProcessedEmail` conservée pour ne pas perdre l'historique), identifié par Message-ID.
 *
 * Dégradation silencieuse si non configuré : `mailSuggestionsConfigured()` renvoie false et le
 * sync ne se lance jamais (voir index.ts) — l'app fonctionne normalement sans.
 */
import Anthropic from '@anthropic-ai/sdk';
import { ImapFlow, type FetchMessageObject } from 'imapflow';
import { simpleParser, type Attachment } from 'mailparser';
import { env } from '../env.js';
import { prisma } from '../db.js';
import { insensitive } from './search.js';

export function mailSuggestionsConfigured(): boolean {
  const m = env.leadsMailbox;
  return !!m.host && !!m.user && !!m.password;
}

const AI_MODEL = 'claude-sonnet-5';
const aiClient = env.anthropicApiKey ? new Anthropic({ apiKey: env.anthropicApiKey }) : null;

export const MAIL_SUGGESTION_KINDS = ['lead', 'appointment', 'worksite_note', 'payment_reminder', 'other'] as const;
export type MailSuggestionKind = (typeof MAIL_SUGGESTION_KINDS)[number];

const PROMPT = `Tu tries les mails reçus sur la boîte principale d'une entreprise belge de rénovation/construction (JJD Consult), pour proposer une action à un humain — RIEN n'est créé automatiquement, seulement une suggestion à valider ou rejeter. Le mail peut être en français ou en néerlandais. Si une pièce jointe (PDF/image) est fournie avec le texte, analyse-la aussi (ex. un rappel de paiement en PDF, un plan joint à une demande).

Catégories ("kind") :
- "lead" : une DEMANDE D'INTERVENTION CLIENT (un particulier, syndic ou promoteur demande un devis, signale un problème, ou demande une visite/intervention) — un NOUVEAU dossier, pas un chantier déjà en cours.
- "appointment" : un RENDEZ-VOUS à planifier — une date/heure (même approximative) mentionnée pour une visite, réunion de chantier, rendez-vous client/fournisseur/architecte.
- "worksite_note" : une INFORMATION utile à tracer sur un chantier DÉJÀ EN COURS (mise à jour, consigne, problème signalé, décision prise, personne à contacter, coordination d'intervention...) — pas de rendez-vous précis à planifier. IMPORTANT : une réponse dans un fil déjà engagé ("Re:"/"Fwd:", plusieurs personnes en copie) N'EST PAS automatiquement exclue — si elle contient une info concrète sur un chantier (même mineure : confirmation d'un détail technique, mise à jour de statut, qui s'occupe de quoi...), classe-la en "worksite_note". N'exclus que les réponses réellement vides de contenu nouveau.
- "payment_reminder" : un RAPPEL DE PAIEMENT — un fournisseur réclame un paiement en retard, ou un client informe d'un paiement effectué/à venir/en retard.
- "other" : mérite l'attention d'un humain mais ne rentre dans aucune case ci-dessus.
- null (isActionable=false) : rien à proposer — newsletter/publicité, spam, accusé de réception pur sans aucune info nouvelle ("merci", "bien reçu", signature seule, transfert sans commentaire ni contenu), candidature d'emploi, mail purement administratif/interne sans rien à tracer.

Réponds UNIQUEMENT avec un objet JSON valide (aucun texte avant/après, aucun bloc markdown) :
{
  "isActionable": boolean,
  "kind": "lead" | "appointment" | "worksite_note" | "payment_reminder" | "other" | null,
  "summary": string | null,
  "requesterName": string | null,
  "requesterPhone": string | null,
  "companyOrWorksiteHint": string | null,
  "problemType": "fuite" | "electricite" | "chauffage" | "porte" | "peinture" | "toiture" | "autre" | null,
  "urgent": boolean,
  "proposedDate": string | null,
  "proposedLocation": string | null,
  "amount": number | null,
  "reference": string | null
}

- "kind" doit être null si isActionable est false, et vice-versa.
- "summary" : résumé en une phrase, en français, jamais vide si isActionable=true.
- "requesterName" : la personne qui écrit/demande (pas la signature de l'entreprise si mail interne).
- "companyOrWorksiteHint" : nom de société, de chantier, ou adresse mentionnée — pour retrouver le bon dossier/chantier.
- "problemType" : uniquement pertinent pour "lead".
- "urgent" : true seulement si le mail exprime explicitement une urgence (dégât en cours, sécurité...).
- "proposedDate" : uniquement pour "appointment" — ISO 8601 si une date/heure est identifiable, sinon null.
- "amount"/"reference" : uniquement pour "payment_reminder" — montant en euros et n° de facture/dossier cités.
- N'invente jamais une information absente — null plutôt qu'une supposition.`;

export interface MailExtraction {
  isActionable: boolean;
  kind: MailSuggestionKind | null;
  summary: string | null;
  requesterName: string | null;
  requesterPhone: string | null;
  companyOrWorksiteHint: string | null;
  problemType: string | null;
  urgent: boolean;
  proposedDate: string | null;
  proposedLocation: string | null;
  amount: number | null;
  reference: string | null;
}

interface PickedAttachment { buffer: Buffer; mimeType: string; kind: 'document' | 'image' }

/**
 * Au plus une pièce jointe analysée par mail (borne le coût/la taille de la requête) — PDF en
 * priorité (rappel de paiement, devis joint...), sinon une image significative. Les petites
 * images en pièce jointe "inline" (logo de signature, pixel de tracking) sont ignorées : elles
 * ne sont jamais le propos du mail et pollueraient l'analyse.
 */
function pickAttachment(attachments: Attachment[]): PickedAttachment | null {
  const pdf = attachments.find((a) => a.contentType === 'application/pdf');
  if (pdf) return { buffer: pdf.content as Buffer, mimeType: 'application/pdf', kind: 'document' };
  const img = attachments.find((a) =>
    /^image\/(png|jpe?g|webp)$/.test(a.contentType) && a.contentDisposition !== 'inline' && (a.size ?? 0) > 8000);
  if (img) return { buffer: img.content as Buffer, mimeType: img.contentType, kind: 'image' };
  return null;
}

async function extractSuggestion(subject: string, from: string, body: string, attachment: PickedAttachment | null): Promise<MailExtraction | null> {
  if (!aiClient) return null;
  try {
    const content: Anthropic.MessageParam['content'] = [];
    if (attachment) {
      content.push(
        attachment.kind === 'document'
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: attachment.buffer.toString('base64') } }
          : { type: 'image', source: { type: 'base64', media_type: attachment.mimeType as 'image/png' | 'image/jpeg' | 'image/webp', data: attachment.buffer.toString('base64') } },
      );
    }
    content.push({ type: 'text', text: `${PROMPT}\n\n---\nDe : ${from}\nSujet : ${subject}\n\n${body.slice(0, 6000)}` });
    const response = await aiClient.messages.create({
      model: AI_MODEL,
      max_tokens: 1280,
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content }],
    });
    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
    const raw = textBlock?.text.match(/\{[\s\S]*\}/)?.[0];
    if (!raw) return null;
    return JSON.parse(raw) as MailExtraction;
  } catch {
    return null; // clé absente, quota, JSON illisible... on saute ce mail, retenté au prochain sync
  }
}

/** Best-effort : retrouve un chantier existant à partir du nom/adresse cité dans le mail. Sert
 *  uniquement à pré-remplir la suggestion — jamais imposé, toujours corrigeable à la validation. */
async function guessWorksiteId(hint: string | null): Promise<string | null> {
  if (!hint || hint.trim().length < 3) return null;
  const w = await prisma.worksite.findFirst({
    where: {
      archived: false,
      OR: [
        { title: { contains: hint, ...insensitive } },
        { ref: { contains: hint, ...insensitive } },
        { client: { name: { contains: hint, ...insensitive } } },
      ],
    },
    select: { id: true },
  });
  return w?.id ?? null;
}

interface SyncStats {
  messagesSeen: number;
  suggestionsCreated: number;
  errors: string[];
}

/**
 * Ne regarde que les messages des `sinceDays` derniers jours (IMAP SEARCH SINCE) — pas tout
 * l'historique à chaque passage. Chaque message est identifié par son Message-ID (unique,
 * stable) : un message déjà dans MailSuggestion (suggestion créée ou non) n'est jamais réanalysé.
 */
export async function syncMailSuggestions(sinceDays = 3): Promise<SyncStats> {
  const stats: SyncStats = { messagesSeen: 0, suggestionsCreated: 0, errors: [] };
  if (!mailSuggestionsConfigured()) return stats;

  const client = new ImapFlow({
    host: env.leadsMailbox.host,
    port: env.leadsMailbox.port,
    secure: true,
    auth: { user: env.leadsMailbox.user, pass: env.leadsMailbox.password },
    logger: false,
  });

  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - sinceDays * 86400000);
      const uids = await client.search({ since }, { uid: true });
      for (const uid of uids as number[]) {
        try {
          const msg = (await client.fetchOne(String(uid), { source: true, envelope: true }, { uid: true })) as FetchMessageObject | false;
          if (!msg || !msg.source) continue;
          const messageId = msg.envelope?.messageId || `uid-${uid}-${env.leadsMailbox.host}`;
          if (await prisma.mailSuggestion.findUnique({ where: { messageId } })) continue;
          stats.messagesSeen++;

          const parsed = await simpleParser(msg.source);
          const from = parsed.from?.text ?? '';
          const subject = parsed.subject ?? '';
          const body = (parsed.text || parsed.html || '').toString();
          const attachment = pickAttachment(parsed.attachments ?? []);
          const extraction = body.trim() || attachment ? await extractSuggestion(subject, from, body, attachment) : null;

          if (extraction?.isActionable && extraction.kind) {
            const worksiteId = await guessWorksiteId(extraction.companyOrWorksiteHint);
            await prisma.mailSuggestion.create({
              data: {
                messageId, subject, fromAddress: from, receivedAt: parsed.date ?? null,
                kind: extraction.kind,
                summary: extraction.summary,
                extracted: extraction as unknown as object,
                worksiteId,
                status: 'pending',
                becameLead: extraction.kind === 'lead',
              },
            });
            stats.suggestionsCreated++;
          } else {
            await prisma.mailSuggestion.create({ data: { messageId, subject, fromAddress: from, receivedAt: parsed.date ?? null } });
          }
        } catch (e) {
          stats.errors.push(`uid ${uid} : ${(e as Error).message}`);
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
