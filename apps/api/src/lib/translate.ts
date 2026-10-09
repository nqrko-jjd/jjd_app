/**
 * Traduction des messages du fil : chacun lit la discussion dans SA langue (compte `locale` : fr | en | pt-BR).
 * Seuls les messages écrits par quelqu'un d'une autre langue sont traduits ; chaque traduction est gardée en base (une seule fois par langue).
 * Passe par le budget IA des réglages : si l'IA n'est pas activée ou en cas d'erreur, le message s'affiche simplement dans sa langue d'origine.
 */
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { configuration, ready, cost } from './assistant-quota.js';

export const LOCALES = ['fr', 'en', 'pt-BR'] as const;
export type Locale = (typeof LOCALES)[number];
export const normalizeLocale = (v: unknown): Locale => (LOCALES as readonly string[]).includes(String(v)) ? (v as Locale) : 'fr';
const NAME: Record<Locale, string> = { fr: 'French', en: 'English', 'pt-BR': 'Brazilian Portuguese' };
const MAX_CHARS = 1500;

interface Msg { id: string; kind: string; body: string | null; author?: { locale?: string | null } | null }

/** Renvoie { idMessage: texte traduit } pour les messages qui ne sont pas déjà dans la langue du lecteur. */
export async function translateFor(messages: Msg[], viewer: Locale): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  // Langue d'un message = langue du compte de son auteur ; sans compte (WhatsApp, import) on considère le français.
  const todo = messages.filter((m) => m.kind === 'text' && m.body && m.body.trim().length > 1 && normalizeLocale(m.author?.locale) !== viewer && !(viewer === 'fr' && !m.author?.locale));
  if (!todo.length) return out;
  try {
    const cached = await prisma.messageTranslation.findMany({ where: { messageId: { in: todo.map((m) => m.id) }, locale: viewer } });
    for (const c of cached) out[c.messageId] = c.body;
    const missing = todo.filter((m) => !(m.id in out)).slice(0, 40);
    if (!missing.length || !env.anthropicApiKey) return out;
    const config = await configuration();
    if (!ready(config) || !config.pricing) return out;
    const client = new Anthropic({ apiKey: env.anthropicApiKey, maxRetries: 0, timeout: 40_000 });
    const items = missing.map((m) => ({ id: m.id, text: m.body!.slice(0, MAX_CHARS) }));
    const r = await client.messages.create({
      model: config.pricing.model,
      max_tokens: 4000,
      system: `You translate short construction-site chat messages into ${NAME[viewer]}. Keep names, numbers, units, references like R-123 and emojis unchanged. If a message is already in ${NAME[viewer]}, return it unchanged. Reply ONLY with a JSON array: [{"id":"...","text":"..."}] covering every input id.`,
      messages: [{ role: 'user', content: JSON.stringify(items) }],
    });
    const txt = r.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
    const a = txt.indexOf('['), b = txt.lastIndexOf(']');
    const parsed = JSON.parse(txt.slice(a, b + 1)) as { id: string; text: string }[];
    const ids = new Set(missing.map((m) => m.id));
    for (const row of parsed) {
      if (!ids.has(row.id) || typeof row.text !== 'string' || !row.text.trim()) continue;
      out[row.id] = row.text;
      await prisma.messageTranslation.upsert({ where: { messageId_locale: { messageId: row.id, locale: viewer } }, create: { messageId: row.id, locale: viewer, body: row.text }, update: { body: row.text } });
    }
    await prisma.auditLog.create({ data: { action: 'translate.cost', entity: 'Message', entityId: missing[0]!.id, meta: { microEuro: cost(config.pricing, r.usage.input_tokens, r.usage.output_tokens), messages: missing.length, locale: viewer } } }).catch(() => undefined);
  } catch { /* tant pis : on montre l'original */ }
  return out;
}

/** Ajoute `bodyTranslated` (si différent de l'original) à des messages déjà prêts à être renvoyés. */
export async function withTranslations<T extends Msg>(rows: T[], viewerLocale: unknown): Promise<(T & { bodyTranslated?: string })[]> {
  const viewer = normalizeLocale(viewerLocale);
  const map = await translateFor(rows, viewer);
  return rows.map((m) => (map[m.id] && map[m.id] !== m.body ? { ...m, bodyTranslated: map[m.id] } : m));
}
