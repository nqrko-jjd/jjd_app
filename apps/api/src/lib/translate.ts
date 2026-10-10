/**
 * Traduction des messages du fil : chacun lit la discussion dans SA langue (compte `locale` : fr | en | pt-BR).
 * Passe par DeepL (comme Bricoloc) : pas d'IA facturée au jeton, offre gratuite = 500 000 caractères / mois.
 * Seuls les messages écrits par quelqu'un d'une autre langue sont traduits ; chaque traduction est gardée en base (une seule fois par langue).
 * Sans clé DeepL ou en cas d'erreur : le message s'affiche simplement dans sa langue d'origine.
 */
import { prisma } from '../db.js';
import { env } from '../env.js';

export const LOCALES = ['fr', 'en', 'pt-BR'] as const;
export type Locale = (typeof LOCALES)[number];
export const normalizeLocale = (v: unknown): Locale => (LOCALES as readonly string[]).includes(String(v)) ? (v as Locale) : 'fr';
const TARGET: Record<Locale, string> = { fr: 'FR', en: 'EN-GB', 'pt-BR': 'PT-BR' };
const SOURCE: Record<Locale, string> = { fr: 'FR', en: 'EN', 'pt-BR': 'PT' };
const MAX_CHARS = 1500;

interface Msg { id: string; kind: string; body: string | null; author?: { locale?: string | null } | null }

async function deepl(texts: string[], source: Locale, target: Locale): Promise<string[]> {
  const body = new URLSearchParams();
  for (const t of texts) body.append('text', t);
  body.set('source_lang', SOURCE[source]);
  body.set('target_lang', TARGET[target]);
  const res = await fetch(`${env.deeplApiHost}/v2/translate`, {
    method: 'POST',
    headers: { Authorization: `DeepL-Auth-Key ${env.deeplApiKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`DeepL ${res.status}`);
  return ((await res.json()) as { translations: { text: string }[] }).translations.map((t) => t.text);
}

/** Renvoie { idMessage: texte traduit } pour les messages qui ne sont pas déjà dans la langue du lecteur. */
export async function translateFor(messages: Msg[], viewer: Locale): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  // Langue d'un message = langue du compte de son auteur ; sans compte (WhatsApp, import) on considère le français.
  const todo = messages.filter((m) => m.kind === 'text' && m.body && m.body.trim().length > 1 && normalizeLocale(m.author?.locale) !== viewer);
  if (!todo.length) return out;
  try {
    const cached = await prisma.messageTranslation.findMany({ where: { messageId: { in: todo.map((m) => m.id) }, locale: viewer } });
    for (const c of cached) out[c.messageId] = c.body;
    const missing = todo.filter((m) => !(m.id in out)).slice(0, 40);
    if (!missing.length || !env.deeplApiKey) return out;
    for (const source of LOCALES) {
      const group = missing.filter((m) => normalizeLocale(m.author?.locale) === source);
      if (!group.length) continue;
      const done = await deepl(group.map((m) => m.body!.slice(0, MAX_CHARS)), source, viewer);
      for (const [i, m] of group.entries()) {
        const text = done[i];
        if (!text?.trim()) continue;
        out[m.id] = text;
        await prisma.messageTranslation.upsert({ where: { messageId_locale: { messageId: m.id, locale: viewer } }, create: { messageId: m.id, locale: viewer, body: text }, update: { body: text } });
      }
    }
  } catch { /* tant pis : on montre l'original */ }
  return out;
}

/** Ajoute `bodyTranslated` (si différent de l'original) à des messages déjà prêts à être renvoyés. */
export async function withTranslations<T extends Msg>(rows: T[], viewerLocale: unknown): Promise<(T & { bodyTranslated?: string })[]> {
  const viewer = normalizeLocale(viewerLocale);
  const map = await translateFor(rows, viewer);
  return rows.map((m) => (map[m.id] && map[m.id] !== m.body ? { ...m, bodyTranslated: map[m.id] } : m));
}
