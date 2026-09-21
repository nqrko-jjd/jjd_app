/**
 * Parsing d'un export de discussion WhatsApp (.txt).
 * Utilisé par le script CLI `import:whatsapp` (dossiers sur le serveur) et par
 * l'import direct depuis le fil de chantier (zip uploadé, cf. routes/thread.ts).
 */
import { normalizeName } from '@jjd/shared';

export interface WhatsAppMsg { at: Date; author: string | null; body: string; attach: string | null }

// Android : « 8/09/26, 10:31 - Nom: message » — iPhone : « [8/09/26 10:31:29] Nom: message »
// (marque gauche-droite éventuelle en tête de ligne, année sur 2 ou 4 chiffres, secondes en option).
const LINE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{2}),\s(\d{1,2}):(\d{2})\s[-–]\s(.*)$/;
const IOS_LINE_RE = /^[‎‏]?\[(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4}),?\s(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s(.*)$/;
// « < pièce jointe : fichier.jpg > » en fin de message, avec ou sans légende avant.
const IOS_ATTACH_RE = /<\s*(?:pièce jointe|piece jointe|attached)\s*:\s*(.+?)\s*>\s*$/i;
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
    const ios = IOS_LINE_RE.exec(raw);
    const m = ios ?? LINE_RE.exec(raw);
    if (!m) {
      if (out.length) out[out.length - 1]!.body += `\n${raw}`;
      continue;
    }
    const [, d, mo, y, hh, mm] = m;
    const secs = ios ? Number(m[6] ?? 0) : 0;
    const restRaw = ios ? m[7]! : m[6]!;
    const year = y!.length === 4 ? Number(y) : 2000 + Number(y);
    const rest = restRaw.replace(MARKS_RE, '');
    const at = new Date(Date.UTC(year, Number(mo) - 1, Number(d), Number(hh), Number(mm), secs));
    if (SYSTEM_RE.test(rest)) { out.push({ at, author: null, body: '', attach: null }); continue; }
    const colon = rest.indexOf(': ');
    let author: string | null = null;
    let body = rest;
    if (colon > 0 && colon < 42) { author = rest.slice(0, colon).trim(); body = rest.slice(colon + 2); }
    // iPhone : les lignes système (création du groupe, chiffrement…) portent le nom du groupe comme
    // « auteur » — on les reconnaît sur le corps du message, pas seulement sur la ligne entière.
    if (author && SYSTEM_RE.test(body.trim())) { out.push({ at, author: null, body: '', attach: null }); continue; }
    const trimmed = body.trim();
    const a = ATTACH_RE.exec(trimmed);
    const ia = a ? null : IOS_ATTACH_RE.exec(trimmed);
    const attach = a ? a[1]! : ia ? ia[1]! : null;
    // légende iPhone (« texte < pièce jointe : … > ») : le texte reste dans `body`
    const caption = ia ? trimmed.slice(0, ia.index).trim() : '';
    out.push({ at, author, body: attach ? caption : body, attach });
  }
  return out;
}

/** « Julien Sweert 😁 » -> « Julien Sweert » ; retire emoji + marques directionnelles. */
export function cleanWhatsAppName(n: string): string {
  return n
    .replace(/[‎‏⁦-⁩]/g, '')
    .replace(/[\u{1F000}-\u{1FAFF}☀-➿️]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^~\s*/, ''); // iPhone : « ~ Nom » pour un contact absent du carnet d'adresses
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
