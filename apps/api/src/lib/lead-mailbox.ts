/**
 * Détecte les demandes clients arrivées sur la boîte mail principale (ex. info@/david@) et crée
 * une piste Pipeline "à vérifier" — jamais confirmée automatiquement, l'extraction par IA
 * n'étant pas fiable à 100 % (même principe que les dépenses `source: 'email'`, voir
 * invoice-mailbox.ts). Contrairement à la boîte factures, celle-ci est la boîte perso/pro de
 * l'utilisateur : on ne la modifie JAMAIS (pas de \Seen, pas de déplacement) — le suivi "déjà
 * vu" vit entièrement côté base (ProcessedEmail), identifié par Message-ID.
 *
 * Dégradation silencieuse si non configuré : `leadMailboxConfigured()` renvoie false et le
 * sync ne se lance jamais (voir index.ts) — l'app fonctionne normalement sans.
 */
import Anthropic from '@anthropic-ai/sdk';
import { ImapFlow, type FetchMessageObject } from 'imapflow';
import { simpleParser } from 'mailparser';
import { env } from '../env.js';
import { prisma } from '../db.js';

export function leadMailboxConfigured(): boolean {
  const m = env.leadsMailbox;
  return !!m.host && !!m.user && !!m.password;
}

const AI_MODEL = 'claude-sonnet-5';
const aiClient = env.anthropicApiKey ? new Anthropic({ apiKey: env.anthropicApiKey }) : null;

const PROMPT = `Tu tries les mails reçus par une entreprise belge de rénovation/construction (JJD Consult) pour repérer une DEMANDE D'INTERVENTION CLIENT (un particulier, syndic ou promoteur qui demande un devis, signale un problème à réparer, ou demande une visite/intervention). Le mail peut être en français ou en néerlandais.

N'EST PAS une demande client : une facture reçue d'un fournisseur, une newsletter/publicité, une réponse à un fil de discussion déjà en cours (accusé de réception, "merci", signature seule), un mail purement administratif/interne, un spam, une candidature d'emploi.

Réponds UNIQUEMENT avec un objet JSON valide (aucun texte avant/après, aucun bloc markdown) :
{
  "isLead": boolean,
  "requesterName": string | null,
  "requesterPhone": string | null,
  "problemType": "fuite" | "electricite" | "chauffage" | "porte" | "peinture" | "toiture" | "autre" | null,
  "summary": string | null,
  "address": string | null,
  "urgent": boolean
}

- "isLead" false pour tout ce qui n'est pas une demande client — dans ce cas, toutes les autres clés à null/false.
- "requesterName" : nom de la personne qui demande (pas la signature de l'entreprise si c'est un mail interne).
- "summary" : résumé en une phrase de ce qui est demandé, en français, jamais vide si isLead=true.
- "urgent" : true seulement si le mail exprime explicitement une urgence (dégât en cours, sécurité...).
- N'invente jamais une information absente — null plutôt qu'une supposition.`;

interface Extraction {
  isLead: boolean;
  requesterName: string | null;
  requesterPhone: string | null;
  problemType: string | null;
  summary: string | null;
  address: string | null;
  urgent: boolean;
}

async function extractLead(subject: string, from: string, body: string): Promise<Extraction | null> {
  if (!aiClient) return null;
  try {
    const response = await aiClient.messages.create({
      model: AI_MODEL,
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      messages: [{
        role: 'user',
        content: `${PROMPT}\n\n---\nDe : ${from}\nSujet : ${subject}\n\n${body.slice(0, 6000)}`,
      }],
    });
    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
    const raw = textBlock?.text.match(/\{[\s\S]*\}/)?.[0];
    if (!raw) return null;
    return JSON.parse(raw) as Extraction;
  } catch {
    return null; // clé absente, quota, JSON illisible... on saute ce mail, retenté au prochain sync
  }
}

interface SyncStats {
  messagesSeen: number;
  leadsCreated: number;
  errors: string[];
}

/**
 * Ne regarde que les messages des `sinceDays` derniers jours (IMAP SEARCH SINCE) — pas tout
 * l'historique à chaque passage. Chaque message est identifié par son Message-ID (unique,
 * stable) : un message déjà dans ProcessedEmail (piste créée ou non) n'est jamais réanalysé.
 */
export async function syncLeadMailbox(sinceDays = 3): Promise<SyncStats> {
  const stats: SyncStats = { messagesSeen: 0, leadsCreated: 0, errors: [] };
  if (!leadMailboxConfigured()) return stats;

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
          if (await prisma.processedEmail.findUnique({ where: { messageId } })) continue;
          stats.messagesSeen++;

          const parsed = await simpleParser(msg.source);
          const from = parsed.from?.text ?? '';
          const subject = parsed.subject ?? '';
          const body = (parsed.text || parsed.html || '').toString();
          const extraction = body.trim() ? await extractLead(subject, from, body) : null;

          if (extraction?.isLead) {
            const fromEmailMatch = from.match(/<([^>]+)>/);
            const fromEmail = fromEmailMatch ? fromEmailMatch[1] : (from.includes('@') ? from : null);
            const contact = fromEmail ? await prisma.contact.findFirst({ where: { email: fromEmail } }) : null;
            const opp = await prisma.crmOpportunity.create({
              data: {
                title: extraction.summary ? extraction.summary.slice(0, 120) : `Demande reçue par mail — ${extraction.requesterName ?? from}`,
                stage: 'new',
                // tag distinct de l'option "E-mail" du formulaire manuel (choisie par le bureau pour
                // une origine confirmée) — celui-ci marque une piste générée par l'IA, à vérifier.
                source: 'email-ia',
                contactId: contact?.id ?? null,
                problemType: extraction.problemType,
                urgent: extraction.urgent,
                urgency: extraction.urgent ? 'urgent' : null,
                onSiteContactName: extraction.requesterName,
                onSiteContactPhone: extraction.requesterPhone,
                accessNotes: extraction.address,
                note: `📧 Piste créée automatiquement depuis un mail — à vérifier.\nDe : ${from}\nSujet : ${subject}${fromEmail && !contact ? `\n(aucun contact existant avec l'adresse ${fromEmail})` : ''}`,
              },
            });
            await prisma.processedEmail.create({ data: { messageId, subject, becameLead: true, opportunityId: opp.id } });
            stats.leadsCreated++;
          } else {
            await prisma.processedEmail.create({ data: { messageId, subject, becameLead: false } });
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
