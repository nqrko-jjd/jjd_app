'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export interface MentionCandidate { id: string; name: string }

/** Détecte un "@partiel" en cours de saisie dans un champ texte et propose les coéquipiers
 *  correspondants — insère le nom complet à la position du @ quand on en choisit un. */
export function useMentionInput(text: string, setText: (v: string) => void) {
  const [candidates, setCandidates] = useState<MentionCandidate[]>([]);
  const [query, setQuery] = useState<string | null>(null); // null = menu fermé
  const [matchStart, setMatchStart] = useState(0);

  useEffect(() => {
    api<{ items: MentionCandidate[] }>('/api/push/mentionable').then((r) => setCandidates(r.items)).catch(() => {});
  }, []);

  function onChange(value: string, cursor: number) {
    setText(value);
    const upToCursor = value.slice(0, cursor);
    const m = upToCursor.match(/(?:^|\s)@([\p{L}0-9._-]*)$/u);
    if (m) {
      setQuery(m[1] ?? '');
      setMatchStart(cursor - (m[1]?.length ?? 0) - 1);
    } else {
      setQuery(null);
    }
  }

  function pick(c: MentionCandidate) {
    if (query === null) return;
    const before = text.slice(0, matchStart);
    const after = text.slice(matchStart + 1 + query.length);
    setText(`${before}@${c.name} ${after}`);
    setQuery(null);
  }

  const options = query === null ? [] : candidates.filter((c) => c.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6);

  return { open: query !== null && options.length > 0, options, onChange, pick, close: () => setQuery(null) };
}

/** Découpe un texte en segments {text} / {text, mention:true} pour surligner les "@Nom"
 *  déjà confirmés côté serveur (mentionedNames) — jamais un "@" isolé qui ne correspond à
 *  personne. */
export function splitMentions(body: string, names: string[]): { text: string; mention: boolean }[] {
  if (!names.length) return [{ text: body, mention: false }];
  const sorted = [...names].sort((a, b) => b.length - a.length);
  const escaped = sorted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`@(?:${escaped.join('|')})\\b`, 'giu');
  const parts: { text: string; mention: boolean }[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (m.index > last) parts.push({ text: body.slice(last, m.index), mention: false });
    parts.push({ text: m[0], mention: true });
    last = m.index + m[0].length;
  }
  if (last < body.length) parts.push({ text: body.slice(last), mention: false });
  return parts;
}
