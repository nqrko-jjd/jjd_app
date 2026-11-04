/**
 * Lecture d'un PV / amende (PDF ou photo) par Claude : renvoie les champs du formulaire PV, jamais d'invention
 * (null si introuvable). Sans clé Anthropic ou en cas d'erreur, renvoie null et l'utilisateur remplit à la main.
 */
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../env.js';

const AI_MODEL = 'claude-sonnet-5';
const aiClient = env.anthropicApiKey ? new Anthropic({ apiKey: env.anthropicApiKey, maxRetries: 1, timeout: 60_000 }) : null;

export interface FineExtraction {
  plate: string | null; date: string | null; time: string | null; reference: string | null; payTo: string | null;
  street: string | null; postalCode: string | null; type: string | null; amount: number | null; dueOn: string | null; note: string | null;
}

const PROMPT = `Tu lis un PV, une amende ou une demande de paiement belge (police, commune, SPW, zone de stationnement, taxe de circulation, LEZ…), en français ou en néerlandais. Le destinataire est une société (JJD Consult) : ignore-le.

Lis TOUTES les pages : les infos sont réparties (courrier d'accompagnement avec référence et délai, puis copie du PV avec le lieu, l'heure, la plaque, la vitesse mesurée…). Si les pages se contredisent, prends la date/heure/lieu du PV lui-même.
Ce document peut être une « vraie » amende (avec un montant à payer) OU une demande d'identification du conducteur (« vraag om inlichtingen » / demande de renseignements) sans montant : dans ce cas "amount" = null (ne reprends JAMAIS un montant de menace type « minimum 500 € »), "dueOn" = la date limite pour identifier le conducteur (date d'envoi + délai indiqué, ex. 15 jours), et "note" commence par « Identification du conducteur à faire avant le JJ/MM/AAAA ».
Si tu as pris le n° de système comme "reference", ajoute le n° de PV (ex. « PV BR.95.C8.651610/2026 ») dans "note".
Pour un excès de vitesse, ajoute dans "note" la vitesse mesurée/retenue et la limite.

Réponds UNIQUEMENT avec un objet JSON valide (aucun texte avant/après, aucun bloc markdown), avec exactement ces clés :
{
  "plate": string | null,        // plaque du véhicule, ex. "1-ABC-123"
  "date": "YYYY-MM-DD" | null,   // date de l'INFRACTION (pas la date d'envoi du courrier)
  "time": "HH:MM" | null,        // heure de l'infraction
  "reference": string | null,    // référence de la lettre : s'il y a un « Systeemnummer » / « numéro de système » (ex. PPBXL/26CB741520), recopie-le EXACTEMENT comme sur le document, avec son "/" (PPBXL/26CB741520), sans le modifier ; sinon le n° de PV ou de dossier
  "payTo": string | null,        // qui encaisse (ville, police, SPF, société de stationnement)
  "street": string | null,       // lieu de l'infraction (rue)
  "postalCode": string | null,   // code postal et commune du lieu, ex. "7100 La Louvière"
  "type": "Stationnement" | "Excès de vitesse" | "Feu rouge" | "Zone basse émission (LEZ)" | "Téléphone au volant" | "Taxe de circulation" | "Autre" | null,
  "amount": number | null,       // montant à payer en euros, séparateur décimal "."
  "dueOn": "YYYY-MM-DD" | null,  // date limite de paiement
  "note": string | null          // communication structurée ou précision utile, sinon null
}
Mets null pour toute valeur introuvable — n'invente rien.`;

export async function extractFine(buf: Buffer, mimetype: string): Promise<FineExtraction | null> {
  if (!aiClient) return null;
  const data = buf.toString('base64');
  const media = mimetype === 'application/pdf'
    ? ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } } as const)
    : /^image\/(jpeg|png|webp)$/.test(mimetype)
      ? ({ type: 'image', source: { type: 'base64', media_type: mimetype as 'image/jpeg' | 'image/png' | 'image/webp', data } } as const)
      : null;
  if (!media) return null;
  try {
    const response = await aiClient.messages.create({
      model: AI_MODEL,
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content: [media, { type: 'text', text: PROMPT }] }],
    });
    const text = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
    const raw = text?.match(/\{[\s\S]*\}/)?.[0];
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<FineExtraction>;
    const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null);
    const day = (x: unknown) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
    const amount = typeof p.amount === 'number' && p.amount > 0 && p.amount < 100000 ? p.amount : null;
    return {
      plate: str(p.plate), date: day(p.date), time: typeof p.time === 'string' && /^\d{1,2}:\d{2}$/.test(p.time) ? p.time : null,
      reference: str(p.reference), payTo: str(p.payTo), street: str(p.street), postalCode: str(p.postalCode),
      type: str(p.type), amount, dueOn: day(p.dueOn), note: str(p.note),
    };
  } catch {
    return null;
  }
}
