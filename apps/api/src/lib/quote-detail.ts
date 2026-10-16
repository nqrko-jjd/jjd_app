/**
 * Le détail d'un poste de devis est dans sa description (HTML simple : « Démontage plafond<br />Pose de 2 portes… »).
 * On en tire les points de travail, un par ligne, pour en faire la check-list d'une tâche et le détail d'un créneau de planning.
 */
const ENTITIES: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&euro;': '€', '&rsquo;': '’', '&lsquo;': '‘' };

export function descriptionPoints(description: string | null | undefined, max = 40): string[] {
  if (!description) return [];
  const text = description
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&[#a-z0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? ' ');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^[\s\-–—•*·▪►>]+/, '').replace(/\s+/g, ' ').trim();
    if (line.length < 2) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line.length > 200 ? `${line.slice(0, 197)}…` : line);
    if (out.length >= max) break;
  }
  return out;
}
