/**
 * Parsing d'un export de discussion WhatsApp (.txt).
 * Utilisé par le script CLI `import:whatsapp` (dossiers sur le serveur) et par
 * l'import direct depuis le fil de chantier (zip uploadé, cf. routes/thread.ts).
 */
import { normalizeName } from '@jjd/shared';

export interface WhatsAppMsg { at: Date; author: string | null; body: string; attach: string | null }

const LINE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{2}),\s(\d{1,2}):(\d{2})\s[-–]\s(.*)$/;
const ATTACH_RE = /^‎?(.+?\.(jpe?g|png|webp|mp4|mov|3gp|opus|m4a|aac|pdf|vcf|docx?|xlsx?))\s*\((fichier joint|file attached)\)$/i;
const MARKS_RE = /[‎‏⁦-⁩]/g;

export const WHATSAPP_SKIP_BODY = new Set([
  'null', 'Ce message a été supprimé.', 'This message was deleted.',
  '<Médias omis>', '<Media omitted>',
  'Vous avez supprimé ce message.', 'You deleted this message.',
]);

/** Lignes système WhatsApp (création de groupe, ajout/départ de membres, chiffrement…). */
const SYSTEM_RE = /^(Les messages et les appels|Vous avez (créé|ajouté|retiré|expulsé|changé|modifié|supprimé le sujet|activé|désactivé)|Vous êtes maintenant|Vous avez rejoint|.{0,60}\b(a créé le groupe|a ajouté|a été ajouté|a quitté|a retiré|a expulsé|a changé|a modifié|a rejoint|ont rejoint|est maintenant admin|a supprimé|a été expulsé|a activé le verrouillage|a désactivé))/i;

/** Parse un export .txt WhatsApp (formats FR/EN, iOS/Android) en messages chronologiques. */
export function parseWhatsAppChat(text: string): WhatsAppMsg[] {
  const out: WhatsAppMsg[] = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const m = LINE_RE.exec(raw);
    if (!m) {
      if (out.length) out[out.length - 1]!.body += `\n${raw}`;
      continue;
    }
    const [, d, mo, y, hh, mm, restRaw] = m;
    const rest = restRaw!.replace(MARKS_RE, '');
    const at = new Date(Date.UTC(2000 + Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm)));
    if (SYSTEM_RE.test(rest)) { out.push({ at, author: null, body: '', attach: null }); continue; }
    const colon = rest.indexOf(': ');
    let author: string | null = null;
    let body = rest;
    if (colon > 0 && colon < 42) { author = rest.slice(0, colon).trim(); body = rest.slice(colon + 2); }
    const a = ATTACH_RE.exec(body.trim());
    out.push({ at, author, body: a ? '' : body, attach: a ? a[1]! : null });
  }
  return out;
}

/** « Julien Sweert 😁 » -> « Julien Sweert » ; retire emoji + marques directionnelles. */
export function cleanWhatsAppName(n: string): string {
  return n
    .replace(/[‎‏⁦-⁩]/g, '')
    .replace(/[\u{1F000}-\u{1FAFF}☀-➿️]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface PersonLike { id: string; firstName: string; lastName?: string | null; displayName: string | null }

/** Construit une fonction de rapprochement « nom WhatsApp -> fiche personne connue » (si trouvée). */
export function buildWhatsAppAuthorMatcher(people: PersonLike[]) {
  const personByToken = new Map<string, { id: string; label: string }>();
  for (const p of people) {
    const label = p.displayName || p.firstName;
    if (/[/&+]|,/.test(label)) continue; // pas les fiches composites « Julien / Pascal »
    const keys = [normalizeName(label), normalizeName(`${p.firstName} ${p.lastName ?? ''}`.trim())];
    if (/^[A-Za-zÀ-ÿ]+$/.test(p.firstName)) keys.push(normalizeName(p.firstName));
    for (const k of keys) if (k && !personByToken.has(k)) personByToken.set(k, { id: p.id, label });
  }
  return (waName: string): { label: string; personId: string | null } => {
    const clean = cleanWhatsAppName(waName);
    const words = clean.split(' ').filter(Boolean);
    for (const cand of [normalizeName(clean), ...words.map((w) => normalizeName(w))]) {
      const hit = personByToken.get(cand);
      if (hit) return { label: hit.label, personId: hit.id };
    }
    return { label: words[0] ? words.slice(0, 2).join(' ') : clean, personId: null };
  };
}
