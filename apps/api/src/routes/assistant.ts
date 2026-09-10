/**
 * Assistant IA (chat) — Bureau uniquement. Crée des BROUILLONS (devis en statut
 * "draft", créneau de planning / tâche marqués source: "ai-draft") que David /
 * Julien / Melvina valident ensuite à la main — l'assistant ne finalise jamais
 * rien tout seul (pas d'envoi de devis, pas de sync Google Agenda, pas de
 * clôture de tâche).
 *
 * Désactivé tant que ANTHROPIC_API_KEY n'est pas configurée (env.anthropicApiKey).
 */
import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { prisma, nextCounter } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, OFFICE } from '../lib/auth.js';
import { buildLineRows, refreshDocTotals } from '../lib/documents.js';
import { env } from '../env.js';

export const assistantRouter = Router();

const MODEL = 'claude-sonnet-5';
const MAX_TOOL_ROUNDS = 6;

const client = env.anthropicApiKey ? new Anthropic({ apiKey: env.anthropicApiKey }) : null;

assistantRouter.get(
  '/status',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    res.json({ enabled: !!client });
  }),
);

interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface DraftAction { kind: 'devis' | 'planning' | 'task'; id: string; label: string; href: string }

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_worksites',
    description: "Cherche des chantiers par référence (ex. « R-523 ») ou par nom pour retrouver leur id.",
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Texte à chercher (référence ou nom du chantier)' } },
      required: ['query'],
    },
  },
  {
    name: 'search_contacts',
    description: 'Cherche un client ou un fournisseur par nom pour retrouver son id.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        type: { type: 'string', enum: ['client', 'supplier'], description: 'Filtre optionnel sur le type de contact' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_people',
    description: "Cherche un ouvrier de l'équipe par nom pour retrouver son id.",
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'create_devis_draft',
    description:
      "Crée un BROUILLON de devis (statut « draft », jamais numéroté ni envoyé automatiquement). "
      + "David/Julien/Melvina le complètent et le valident ensuite dans l'app. "
      + 'Utilise search_worksites / search_contacts avant pour retrouver les ids.',
    input_schema: {
      type: 'object',
      properties: {
        worksiteId: { type: 'string', description: 'id du chantier (optionnel)' },
        contactId: { type: 'string', description: 'id du client (optionnel)' },
        title: { type: 'string' },
        lines: {
          type: 'array',
          description: 'Lignes du devis (au moins une si les montants sont connus, sinon liste vide)',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              qty: { type: 'number', description: 'Quantité (défaut 1)' },
              unit: { type: 'string', description: 'ex. "m²", "h", "forfait"' },
              unitPriceHt: { type: 'number', description: 'Prix unitaire HT en euros' },
            },
            required: ['label', 'unitPriceHt'],
          },
        },
      },
      required: ['lines'],
    },
  },
  {
    name: 'create_planning_draft',
    description:
      "Propose un créneau de planning (marqué « proposé par l'IA — à valider », pas synchronisé sur "
      + "l'agenda Google tant que non validé). Nécessite un chantier existant.",
    input_schema: {
      type: 'object',
      properties: {
        worksiteId: { type: 'string' },
        title: { type: 'string' },
        startAt: { type: 'string', description: 'Date/heure de début, format ISO 8601' },
        endAt: { type: 'string', description: 'Date/heure de fin, format ISO 8601' },
        personIds: { type: 'array', items: { type: 'string' } },
        note: { type: 'string' },
      },
      required: ['worksiteId', 'startAt', 'endAt'],
    },
  },
  {
    name: 'create_task_draft',
    description: "Propose une tâche sur un chantier (marquée « proposée par l'IA — à valider »). Nécessite un chantier existant.",
    input_schema: {
      type: 'object',
      properties: {
        worksiteId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        dueOn: { type: 'string', description: 'Échéance, format ISO 8601 (optionnel)' },
      },
      required: ['worksiteId', 'title'],
    },
  },
];

const SYSTEM_PROMPT = `Tu es l'assistant interne de JJD Consult, entreprise belge de rénovation/construction.
Tu aides le bureau (David, Julien, Melvina) à préparer rapidement des devis, des créneaux de planning et des tâches.

Règles impératives :
- Tout ce que tu crées est un BROUILLON qui doit être validé manuellement dans l'app ensuite — ne dis jamais qu'un devis a été "envoyé" ou qu'un créneau est "confirmé".
- Avant de créer un devis/planning/tâche lié à un chantier, un client ou un ouvrier nommé, utilise search_worksites / search_contacts / search_people pour retrouver son id réel. Si aucun résultat ne correspond clairement, demande une précision plutôt que de deviner.
- Réponds en français, de façon concise et concrète.
- Si les informations manquent pour créer quelque chose de correct (ex. aucun montant pour un devis), pose la question au lieu de créer un brouillon vide ou inventé.`;

export async function runTool(name: string, input: Record<string, unknown>, userId: string): Promise<{ result: unknown; action?: DraftAction }> {
  switch (name) {
    case 'search_worksites': {
      const q = String(input.query ?? '');
      const items = await prisma.worksite.findMany({
        where: { OR: [{ ref: { contains: q } }, { title: { contains: q } }] },
        take: 10,
        select: { id: true, ref: true, title: true },
      });
      return { result: items };
    }
    case 'search_contacts': {
      const q = String(input.query ?? '');
      const type = input.type === 'client' || input.type === 'supplier' ? input.type : undefined;
      const items = await prisma.contact.findMany({
        where: { name: { contains: q }, ...(type ? { OR: [{ type }, { type: 'both' }] } : {}) },
        take: 10,
        select: { id: true, name: true, type: true },
      });
      return { result: items };
    }
    case 'search_people': {
      const q = String(input.query ?? '');
      const items = await prisma.person.findMany({
        where: { active: true, OR: [{ firstName: { contains: q } }, { lastName: { contains: q } }, { displayName: { contains: q } }] },
        take: 10,
        select: { id: true, firstName: true, lastName: true, displayName: true },
      });
      return { result: items };
    }
    case 'create_devis_draft': {
      const lines = Array.isArray(input.lines) ? (input.lines as Record<string, unknown>[]) : [];
      const seq = await nextCounter('doc:draft');
      const doc = await prisma.document.create({
        data: {
          kind: 'quote',
          direction: 'sale',
          draftRef: `BROUILLON-${seq}`,
          status: 'draft',
          worksiteId: (input.worksiteId as string) ?? null,
          contactId: (input.contactId as string) ?? null,
          title: (input.title as string) ?? null,
          source: 'ai-draft',
          createdById: userId,
        },
      });
      if (lines.length) {
        await prisma.documentLine.createMany({
          data: buildLineRows(doc.id, lines.map((l) => ({
            kind: 'item' as const,
            label: String(l.label ?? ''),
            description: null,
            qty: typeof l.qty === 'number' ? l.qty : 1,
            unit: (l.unit as string) ?? null,
            unitPriceHt: typeof l.unitPriceHt === 'number' ? l.unitPriceHt : 0,
            discountPct: 0,
            vatRate: 0.21,
            priceItemId: null,
          }))),
        });
        await refreshDocTotals(doc.id);
      }
      const action: DraftAction = { kind: 'devis', id: doc.id, label: `Brouillon devis ${doc.draftRef}`, href: `/app/documents/${doc.id}` };
      return { result: { id: doc.id, draftRef: doc.draftRef, status: 'draft' }, action };
    }
    case 'create_planning_draft': {
      const worksiteId = input.worksiteId as string;
      const ws = await prisma.worksite.findUnique({ where: { id: worksiteId }, select: { ref: true, title: true } });
      if (!ws) throw new HttpError(422, 'Chantier introuvable — cherche-le d’abord avec search_worksites.');
      const personIds = Array.isArray(input.personIds) ? (input.personIds as string[]) : [];
      const ev = await prisma.planningEvent.create({
        data: {
          worksiteId,
          title: (input.title as string) ?? null,
          startAt: new Date(input.startAt as string),
          endAt: new Date(input.endAt as string),
          note: (input.note as string) ?? null,
          source: 'ai-draft',
          createdById: userId,
          assignments: { create: personIds.map((personId) => ({ personId })) },
        },
      });
      const action: DraftAction = {
        kind: 'planning', id: ev.id,
        label: `Brouillon planning — ${ws.ref} · ${ev.startAt.toLocaleDateString('fr-BE')}`,
        href: `/app/planning?worksiteId=${worksiteId}`,
      };
      return { result: { id: ev.id, startAt: ev.startAt, endAt: ev.endAt }, action };
    }
    case 'create_task_draft': {
      const worksiteId = input.worksiteId as string;
      const ws = await prisma.worksite.findUnique({ where: { id: worksiteId }, select: { ref: true } });
      if (!ws) throw new HttpError(422, 'Chantier introuvable — cherche-le d’abord avec search_worksites.');
      const count = await prisma.worksiteTask.count({ where: { worksiteId } });
      const task = await prisma.worksiteTask.create({
        data: {
          worksiteId,
          title: String(input.title ?? ''),
          description: (input.description as string) ?? null,
          dueOn: input.dueOn ? new Date(input.dueOn as string) : null,
          position: count,
          source: 'ai-draft',
          createdById: userId,
        },
      });
      const action: DraftAction = {
        kind: 'task', id: task.id, label: `Brouillon tâche — ${ws.ref} · ${task.title}`, href: `/app/chantiers/${worksiteId}`,
      };
      return { result: { id: task.id, title: task.title }, action };
    }
    default:
      return { result: { error: `Outil inconnu : ${name}` } };
  }
}

assistantRouter.post(
  '/chat',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    if (!client) throw new HttpError(503, "Assistant IA non configuré (clé Anthropic absente).");
    const history = Array.isArray(req.body?.messages) ? (req.body.messages as ChatMessage[]) : [];
    if (!history.length) throw new HttpError(422, 'Aucun message');

    const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));
    const actions: DraftAction[] = [];
    let finalText = '';

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages,
        tools: TOOLS,
      });

      const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
      finalText = textBlocks.map((b) => b.text).join('\n\n');

      if (response.stop_reason !== 'tool_use') break;

      messages.push({ role: 'assistant', content: response.content });
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        try {
          const { result, action } = await runTool(block.name, block.input as Record<string, unknown>, req.user!.id);
          if (action) actions.push(action);
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
        } catch (e) {
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, is_error: true, content: (e as Error).message ?? 'Erreur' });
        }
      }
      messages.push({ role: 'user', content: toolResults });
    }

    res.json({ reply: finalText, actions });
  }),
);
