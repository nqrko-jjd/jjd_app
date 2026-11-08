'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Listes paginées par le serveur : le tri et les filtres de colonnes se font côté navigateur, donc sur la seule page affichée.
 * Quand `enabled` (un tri ou un filtre de colonne est actif), ce hook charge TOUTES les lignes qui correspondent aux
 * filtres du serveur (recherche, année…) — par blocs de 5000 — pour que tri et filtres portent sur l'ensemble, pas sur 100 lignes.
 * `qs` = paramètres du serveur SANS page ni pageSize ; `refreshKey` = valeur qui change quand les données changent (recharge).
 */
export function useFullRows<T>(endpoint: string, qs: string, enabled: boolean, refreshKey: string) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [loading, setLoading] = useState(false);
  const token = useRef(0);
  useEffect(() => {
    if (!enabled) { setRows(null); return; }
    const mine = ++token.current;
    setLoading(true);
    (async () => {
      const all: T[] = [];
      for (let p = 1; p <= 40; p++) {
        const r = await api<{ items: T[]; totalPages?: number }>(`${endpoint}?${qs}${qs ? '&' : ''}page=${p}&pageSize=5000`);
        if (mine !== token.current) return;
        all.push(...r.items);
        if (p >= (r.totalPages ?? 1)) break;
      }
      setRows(all);
    })()
      .catch(() => { if (mine === token.current) setRows(null); })
      .finally(() => { if (mine === token.current) setLoading(false); });
  }, [enabled, endpoint, qs, refreshKey]);
  return { rows: enabled ? rows : null, loading: enabled && loading };
}
