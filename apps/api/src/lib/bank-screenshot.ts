/**
 * Import d'un relevé de carte à partir d'une CAPTURE D'ÉCRAN (photo de l'appli banque), pour les
 * cartes dont on n'a qu'un relevé PDF officiel une fois par mois — la capture permet de
 * rapprocher les dépenses bien avant que le PDF n'arrive. Lecture par IA (vision Claude), même
 * dégradation silencieuse que document-extract.ts : sans clé Anthropic configurée, ne renvoie
 * simplement rien (voir screenshotImportAvailable côté route, qui refuse alors la requête avec un
 * message clair plutôt que de prétendre avoir importé 0 transaction).
 */
import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../env.js';
import type { ParsedBankRow } from './bank-csv.js';

const AI_MODEL = 'claude-sonnet-5';
const aiClient = env.anthropicApiKey ? new Anthropic({ apiKey: env.anthropicApiKey }) : null;

export function screenshotImportAvailable(): boolean {
  return !!aiClient;
}

const PROMPT = `Tu lis une capture d'écran de l'historique de transactions d'une carte bancaire prépayée (application mobile belge/française). Ignore tout ce qui n'est pas une DÉPENSE COMMERÇANT réelle : les lignes "Votre chargement" (rechargement de la carte) et tout ce qui est marqué "Réservé" (autorisation pas encore débitée définitivement) doivent être IGNORÉES.

Réponds UNIQUEMENT avec un tableau JSON valide (aucun texte avant/après, aucun bloc markdown), un objet par dépense :
[{ "date": "YYYY-MM-DD", "merchant": string, "amount": number }]

- "date" : la date affichée à côté de la transaction. L'année n'est pas toujours visible dans l'image — dans ce cas, déduis-la du contexte donné (date du jour fournie ci-dessous).
- "merchant" : le nom du commerçant tel qu'affiché.
- "amount" : le montant en euros, toujours positif (nombre, pas de texte, séparateur décimal "."). Ce sont toujours des dépenses, jamais des crédits.
- Si l'image ne montre aucune transaction exploitable, réponds avec un tableau vide [].`;

interface AiTransaction { date?: string | null; merchant?: string | null; amount?: number | null }

const stableId = (parts: (string | number | null)[]) =>
  'shot-' + crypto.createHash('sha1').update(parts.map((p) => String(p ?? '')).join('|')).digest('hex').slice(0, 22);

/**
 * Lit une ou plusieurs captures d'écran (JPEG/PNG) et en tire des lignes de relevé — même forme
 * que l'import CSV/PDF (ParsedBankRow), pour réutiliser exactement le même pipeline d'insertion
 * et de dédoublonnage (insertBankRows, voir routes/finance.ts). Une image illisible ou dont la
 * réponse IA n'est pas un JSON exploitable est simplement ignorée, pas fatale pour les autres.
 */
export async function parseScreenshots(images: { buffer: Buffer; mimetype: string }[]): Promise<ParsedBankRow[]> {
  if (!aiClient) return [];
  const today = new Date().toISOString().slice(0, 10);
  const rows: ParsedBankRow[] = [];
  for (const img of images) {
    let parsed: AiTransaction[];
    try {
      const response = await aiClient.messages.create({
        model: AI_MODEL,
        max_tokens: 4096, // marge au-delà du JSON attendu : le thinking adaptatif partage le même budget
        thinking: { type: 'adaptive' },
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: (img.mimetype === 'image/png' ? 'image/png' : 'image/jpeg'), data: img.buffer.toString('base64') },
            },
            { type: 'text', text: `Nous sommes le ${today}.\n\n${PROMPT}` },
          ],
        }],
      });
      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
      const raw = textBlock?.text.match(/\[[\s\S]*\]/)?.[0];
      parsed = raw ? (JSON.parse(raw) as AiTransaction[]) : [];
    } catch {
      continue;
    }
    for (const t of parsed) {
      if (!t.date || t.amount == null || !(t.amount > 0)) continue;
      const bookingDate = new Date(`${t.date}T00:00:00Z`);
      if (Number.isNaN(bookingDate.getTime())) continue;
      rows.push({
        externalId: stableId([t.date, t.amount, t.merchant ?? null]),
        bookingDate,
        valueDate: bookingDate,
        amount: -Math.abs(t.amount), // dépense carte = toujours un débit
        currency: 'EUR',
        counterpartyName: t.merchant?.trim() || null,
        counterpartyAccount: null,
        description: t.merchant?.trim() || null,
        communication: null,
      });
    }
  }
  return rows;
}
