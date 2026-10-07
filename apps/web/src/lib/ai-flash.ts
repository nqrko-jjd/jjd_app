export type AiInfo = { used: boolean; reason?: string; costEuro?: number } | undefined;

/** Phrase affichée après une génération : l'IA a-t-elle rédigé le document, ou pourquoi la version de base a été utilisée. */
export function aiNote(ai: AiInfo): string | null {
  if (!ai) return null;
  if (ai.used) return `✨ Rédigé par l’IA${ai.costEuro ? ` (coût ≈ ${ai.costEuro.toFixed(2).replace('.', ',')} €)` : ''} — à relire avant de valider.`;
  return `L’IA n’a pas été utilisée : ${ai.reason ?? 'indisponible'} Version de base générée.`;
}
/** Message transmis à la page suivante (la page d'édition s'ouvre juste après la génération). */
export function setFlash(text: string | null) { try { if (text) sessionStorage.setItem('jjd-flash', text); } catch { /* sans stockage : pas de message */ } }
export function takeFlash(): string | null {
  try { const t = sessionStorage.getItem('jjd-flash'); if (t) sessionStorage.removeItem('jjd-flash'); return t; } catch { return null; }
}
export const AI_WAIT = 'Préparation en cours : l’IA rédige le document, cela peut prendre jusqu’à une minute…';
