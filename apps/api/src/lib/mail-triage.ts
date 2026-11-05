/**
 * Économie de tokens pour la « Boîte IA » (lib/lead-mailbox.ts) : avant d'envoyer un mail à
 * Claude Sonnet, on écarte d'abord sans IA ce qui ne mérite jamais d'action (réponses
 * automatiques, retours d'erreur, newsletters, simples « merci / bien reçu »), puis un tri
 * rapide par un petit modèle (Haiku, texte seul) décide si le mail mérite l'analyse complète et
 * si la pièce jointe est utile. Sonnet ne voit donc que les mails retenus, et la pièce jointe
 * (le plus coûteux) seulement quand elle compte.
 *
 * Toujours prudent : au moindre signe d'une demande, d'un rappel ou d'un chantier, le mail
 * passe. En cas d'échec du tri (clé, quota, modèle indisponible), on retombe sur l'analyse
 * complète d'avant : on peut payer un peu plus, jamais rater un mail.
 */
import type Anthropic from '@anthropic-ai/sdk';

export type NoiseReason = 'auto_reply' | 'bounce' | 'bulk' | 'acknowledgement';

export const NOISE_LABEL: Record<NoiseReason, string> = {
  auto_reply: 'réponse automatique',
  bounce: 'retour d’erreur de messagerie',
  bulk: 'newsletter ou envoi groupé',
  acknowledgement: 'simple accusé de réception',
};

/** Mots qui signalent un mail potentiellement utile (FR/NL) : s'ils apparaissent, aucun filtre sans IA ne s'applique. */
const KEEP = /(devis|offre de prix|offerte|demande|aanvraag|intervention|interventie|rendez-vous|afspraak|visite|bezoek|rappel|relance|herinnering|aanmaning|impay|achterstal|factur|paiement|betaling|urgent|dringend|fuite|\blek\b|panne|d[ée]g[âa]t|sinistre|schade|chantier|\bwerf|travaux|werken|r[ée]novation|renovatie|toiture|\bdak\b|chauffage|verwarming|humidit|vocht|infiltration)/i;

const AUTO_REPLY_SUBJECT = /^\s*(r[ée]ponse automatique|automatic reply|auto(matic)?[- ]?reply|autoreply|out of (the )?office|absent|absence du bureau|absence|afwezig|automatisch antwoord|abwesenheit)/i;
const BOUNCE_SUBJECT = /(undeliverable|undelivered mail|non remis|delivery status notification|mail delivery (failed|subsystem)|returned mail|onbestelbaar|niet afgeleverd)/i;
const BOUNCE_FROM = /(mailer-daemon|postmaster)@/i;
/** Mots d'un pur accusé de réception (avec formules de politesse). Le mail n'est écarté que s'il ne contient RIEN d'autre (hormis le nom de l'expéditeur). */
const ACK_WORDS = new Set(['merci', 'beaucoup', 'bien', 'reçu', 'recu', 'ok', 'okay', 'parfait', 'super', 'top', 'nickel', 'noté', 'note', 'c\'est',
  'thanks', 'thank', 'you', 'bedankt', 'dank', 'je', 'u', 'goed', 'ontvangen', 'prima', 'bonne', 'journée', 'soirée', 'cordialement',
  'salutations', 'bien à vous', 'à', 'vous', 'bientôt', 'mvg', 'groeten', 'met', 'vriendelijke', 'regards', 'kind', 'best', 'bonjour', 'hello', 'dag', 'beste']);
const ACK_START = /^(merci|bien re[çc]u|re[çc]u|ok|okay|parfait|not[ée]|thanks|thank you|bedankt|dank|goed ontvangen|ontvangen|prima)\b/i;
function isPureAck(fresh: string, from: string): boolean {
  if (fresh.length > 120 || /\d/.test(fresh) || !ACK_START.test(fresh)) return false;
  const name = new Set(from.toLowerCase().replace(/<[^>]*>/g, ' ').split(/[^\p{L}']+/u).filter(Boolean));
  const words = fresh.toLowerCase().split(/[^\p{L}']+/u).filter(Boolean);
  return words.every((w) => ACK_WORDS.has(w) || name.has(w));
}

/** Une ligne d'en-tête brute (`parsed.headerLines` de mailparser), sans le nom ni les « : ». */
function header(lines: readonly { key: string; line: string }[], name: string): string | null {
  const h = lines.find((l) => l.key.toLowerCase() === name);
  if (!h) return null;
  const i = h.line.indexOf(':');
  return (i >= 0 ? h.line.slice(i + 1) : h.line).trim();
}

/** Le texte nouveau d'une réponse : coupe la partie citée et la signature. */
export function newContent(text: string): string {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*>/.test(line)) break;
    if (/^\s*(le .+ a [ée]crit|on .+ wrote|op .+ schreef|am .+ schrieb)\s*:?\s*$/i.test(line)) break;
    if (/^\s*-{2,}\s*(original|message d'origine|oorspronkelijk|forwarded|message transf[ée]r[ée])/i.test(line)) break;
    if (/^\s*(de|from|van|envoy[ée]|sent|verzonden)\s*:/i.test(line) && out.length) break;
    if (/^--\s*$/.test(line)) break;
    out.push(line);
  }
  return out.join('\n').trim();
}

/**
 * Raison d'écarter le mail sans aucun appel à l'IA, ou null s'il doit être analysé.
 * Volontairement étroit : seuls les cas sans ambiguïté sont écartés.
 */
export function noiseReason(mail: {
  headerLines: readonly { key: string; line: string }[];
  from: string;
  subject: string;
  body: string;
  hasAttachment: boolean;
}): NoiseReason | null {
  const { headerLines, from, subject, body, hasAttachment } = mail;
  const autoSubmitted = (header(headerLines, 'auto-submitted') ?? '').toLowerCase();

  if (BOUNCE_FROM.test(from) || BOUNCE_SUBJECT.test(subject)) return 'bounce';
  if (AUTO_REPLY_SUBJECT.test(subject) || autoSubmitted.startsWith('auto-replied')
    || header(headerLines, 'x-autoreply') !== null || header(headerLines, 'x-autorespond') !== null) return 'auto_reply';

  // Seul le texte nouveau compte : un « merci » en réponse à un devis reste un simple « merci ».
  const fresh = newContent(body);
  if (KEEP.test(subject) || KEEP.test(fresh.slice(0, 2000))) return null;

  const precedence = (header(headerLines, 'precedence') ?? '').toLowerCase();
  if (header(headerLines, 'list-unsubscribe') !== null || header(headerLines, 'list-id') !== null
    || ['bulk', 'list', 'junk'].includes(precedence) || autoSubmitted.startsWith('auto-generated')) return 'bulk';

  if (!hasAttachment && isPureAck(fresh, from)) return 'acknowledgement';
  return null;
}

export interface TriageResult { actionable: boolean; needsAttachment: boolean }

const TRIAGE_PROMPT = `Tu fais un premier tri rapide des mails reçus par une entreprise belge de rénovation/construction (JJD Consult). Le mail peut être en français ou en néerlandais.
Question 1 — "actionable" : le mail mérite-t-il qu'un humain agisse ? true pour : une demande de client (devis, intervention, problème, visite), un rendez-vous à planifier, une information concrète sur un chantier en cours, un rappel de paiement ou une information de paiement, ou tout autre mail qui demande l'attention de l'entreprise. false pour : publicité, newsletter, spam, notification sans contenu, accusé de réception sans information nouvelle, candidature d'emploi, mail interne sans rien à tracer. DANS LE DOUTE, réponds true.
Question 2 — "needsAttachment" : true si l'information utile se trouve probablement dans la pièce jointe (rappel de paiement ou facture en PDF, plan, devis joint, mail presque vide avec une pièce jointe). false s'il n'y a pas de pièce jointe ou si le texte suffit.
Réponds UNIQUEMENT avec ce JSON : {"actionable": boolean, "needsAttachment": boolean}`;

/**
 * Tri par un petit modèle, texte seul (jamais la pièce jointe). null si le tri échoue :
 * l'appelant fait alors l'analyse complète comme avant.
 */
export async function triageMail(
  client: Anthropic | null,
  model: string,
  m: { from: string; subject: string; body: string; attachments: { filename: string; contentType: string }[] },
): Promise<TriageResult | null> {
  if (!client) return null;
  try {
    const list = m.attachments.length ? m.attachments.map((a) => `- ${a.filename} (${a.contentType})`).join('\n') : 'aucune';
    const response = await client.messages.create({
      model,
      max_tokens: 60,
      messages: [{ role: 'user', content: `${TRIAGE_PROMPT}\n\n---\nDe : ${m.from}\nSujet : ${m.subject}\nPièces jointes :\n${list}\n\n${m.body.slice(0, 3000)}` }],
    });
    const text = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? '';
    const raw = text.match(/\{[\s\S]*\}/)?.[0];
    if (!raw) return null;
    const j = JSON.parse(raw) as Partial<TriageResult>;
    if (typeof j.actionable !== 'boolean') return null;
    return { actionable: j.actionable, needsAttachment: j.needsAttachment !== false };
  } catch {
    return null;
  }
}
