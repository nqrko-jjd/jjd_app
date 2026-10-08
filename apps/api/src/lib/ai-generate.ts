/**
 * Génération structurée par Claude (cahier des charges, liste d'achats) — passe par le MÊME budget que l'assistant :
 * budgets direction / global et tarifs fixés par David, provision avant l'appel, coût réel enregistré après.
 * Réservé à la direction. Toujours « essayer puis retomber sur la génération de base » : aucune erreur ici ne doit empêcher de créer le document.
 */
import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import type { ZodType, ZodTypeDef } from 'zod';
import { env } from '../env.js';
import { HttpError } from './http.js';
import type { AuthUser } from './auth.js';
import { isDirection, configuration, ready, begin, reserve, settle, finish, cost, EURO } from './assistant-quota.js';

export type AiResult<T> = { ok: true; data: T; costEuro: number } | { ok: false; reason: string };
const MAX_INPUT_TOKENS = 24_000;

/** Extrait le premier objet JSON d'une réponse (tolère les clôtures ```json). */
export function extractJson(text: string): unknown {
  const t = text.replace(/```(?:json)?/gi, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('Aucun JSON dans la réponse');
  return JSON.parse(t.slice(a, b + 1));
}

export interface AiImage { mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; data: string }

export async function aiGenerateJson<T>(user: AuthUser, o: { system: string; prompt: string; schema: ZodType<T, ZodTypeDef, unknown>; maxOutput: number; image?: AiImage }): Promise<AiResult<T>> {
  if (!env.anthropicApiKey) return { ok: false, reason: 'L’IA n’est pas configurée sur le serveur.' };
  if (!isDirection(user)) return { ok: false, reason: 'La génération par l’IA est réservée à la direction pour le moment.' };
  if (!ready(await configuration())) return { ok: false, reason: 'L’IA est en attente d’activation : les budgets sont à confirmer dans les réglages.' };

  const client = new Anthropic({ apiKey: env.anthropicApiKey, maxRetries: 0, timeout: 170_000 });
  const id = randomUUID();
  let pricing;
  try {
    const started = await begin(user, id, [{ system: o.system, prompt: o.prompt }]);
    if (started.replay || !started.pricing) return { ok: false, reason: 'Demande IA déjà traitée.' };
    pricing = started.pricing;
  } catch (e) {
    return { ok: false, reason: e instanceof HttpError ? e.message : 'L’IA est indisponible pour le moment.' };
  }

  let done = false;
  const close = async (reply?: string) => { if (!done) { done = true; await finish(user, id, reply).catch(() => undefined); } };
  try {
    const content: Anthropic.MessageParam['content'] = o.image
      ? [{ type: 'image', source: { type: 'base64', media_type: o.image.mediaType, data: o.image.data } }, { type: 'text', text: o.prompt }]
      : o.prompt;
    const request = { model: pricing.model, system: o.system, messages: [{ role: 'user' as const, content }] };
    const counted = await client.messages.countTokens(request);
    if (counted.input_tokens > MAX_INPUT_TOKENS) { await close(); return { ok: false, reason: 'Ce devis est trop volumineux pour la génération par l’IA.' }; }
    await reserve(user, id, Math.max(1, cost(pricing, Math.ceil(counted.input_tokens * 1.2) + 256, o.maxOutput)));
    let response: Anthropic.Message;
    try { response = await client.messages.create({ ...request, max_tokens: o.maxOutput }); }
    catch { await settle(user, id, null); await close(); return { ok: false, reason: 'Le service IA n’a pas répondu à temps (le coût éventuel reste provisionné).' }; }
    const u = response.usage;
    if ((u.cache_creation_input_tokens || 0) > 0 || (u.cache_read_input_tokens || 0) > 0) { await settle(user, id, null); await close(); return { ok: false, reason: 'Réponse IA inattendue.' }; }
    const micro = cost(pricing, u.input_tokens, u.output_tokens);
    await settle(user, id, micro);
    await close('ok');
    const text = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
    try {
      const parsed = o.schema.safeParse(extractJson(text));
      if (!parsed.success) return { ok: false, reason: 'La réponse de l’IA n’avait pas le bon format (coût comptabilisé) : génération de base utilisée.' };
      return { ok: true, data: parsed.data, costEuro: micro / EURO };
    } catch { return { ok: false, reason: 'La réponse de l’IA était illisible ou tronquée (coût comptabilisé) : génération de base utilisée.' }; }
  } catch (e) {
    await close();
    return { ok: false, reason: e instanceof HttpError ? e.message : 'L’IA est indisponible pour le moment.' };
  }
}
