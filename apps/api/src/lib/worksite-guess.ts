/**
 * Retrouve le chantier auquel se rapporte un mail (sujet, résumé, nom cité par l'IA). Ne sert qu'à PRÉ-REMPLIR la suggestion de la Boîte IA :
 * jamais imposé, toujours corrigeable. En cas de doute (plusieurs chantiers aussi plausibles), on ne propose rien plutôt que de se tromper.
 */
import { prisma } from '../db.js';

export interface WsCandidate { id: string; ref: string; text: string }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// mots trop courants dans les mails et les titres de chantier pour désigner un chantier précis
const STOP = new Set([
  'fwd', 'tr', 'fw', 'acp', 'fuite', 'fuites', 'appartement', 'etage', 'cave', 'garage', 'avenue', 'boulevard', 'chaussee', 'place', 'demande', 'devis', 'facture',
  'merci', 'bonjour', 'travaux', 'urgent', 'urgente', 'suite', 'pour', 'dans', 'avec', 'chez', 'comme', 'sont', 'plus', 'cette', 'votre', 'notre', 'vous', 'nous',
  'baltimo', 'syndic', 'copropriete', 'concept', 'light', 'mail', 'message', 'intervention', 'chantier', 'contact', 'contacter', 'sujet', 'object', 'objet',
  'monsieur', 'madame', 'cordialement', 'prendre', 'eventuellement', 'concernant', 'immeuble', 'residence', 'locataire', 'proprietaire',
]);

/** Mots distinctifs d'un texte : noms propres, codes, rues… Sans accents, en minuscules. */
export function distinctiveTokens(texts: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const t of texts) {
    for (const w of norm(t ?? '').split(/[^a-z0-9]+/)) {
      if (!w || STOP.has(w)) continue;
      if (w.length >= 4 || (w.length >= 3 && /\d/.test(w))) out.add(w);
    }
  }
  return [...out].slice(0, 16);
}

/** Meilleur chantier parmi les candidats : un mot long ou contenant un chiffre pèse 2, un mot court 1 ; il faut au moins 3 points et devancer le suivant. */
export function pickWorksite(texts: (string | null | undefined)[], candidates: WsCandidate[]): string | null {
  const joined = texts.filter(Boolean).join(' ');
  const explicit = /\bR-(\d{3,4})\b/i.exec(joined);
  if (explicit) {
    const hit = candidates.find((c) => c.ref.toUpperCase() === `R-${explicit[1]}`);
    if (hit) return hit.id;
  }
  const tokens = distinctiveTokens(texts);
  if (!tokens.length) return null;
  const scored = candidates.map((c) => {
    const hay = norm(c.text);
    const score = tokens.reduce((s, t) => (hay.includes(t) ? s + (t.length >= 7 || /\d/.test(t) ? 2 : 1) : s), 0);
    return { c, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || b.c.ref.localeCompare(a.c.ref));
  const [best, next] = scored;
  if (!best || best.score < 3) return null;
  if (next && next.score >= best.score) return null;
  return best.c.id;
}

let cache: { at: number; rows: WsCandidate[] } | null = null;
async function candidates(): Promise<WsCandidate[]> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.rows;
  const ws = await prisma.worksite.findMany({
    where: { archived: false, kind: 'project' },
    select: { id: true, ref: true, title: true, address: true, unitLabel: true, client: { select: { name: true } }, acp: { select: { name: true } } },
  });
  cache = { at: Date.now(), rows: ws.map((w) => ({ id: w.id, ref: w.ref, text: [w.ref, w.title, w.address, w.unitLabel, w.client?.name, w.acp?.name].filter(Boolean).join(' ') })) };
  return cache.rows;
}

export async function guessWorksiteFromText(texts: (string | null | undefined)[]): Promise<string | null> {
  return pickWorksite(texts, await candidates());
}
