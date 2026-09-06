'use client';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';

export type SortDir = 'asc' | 'desc';
type SortVal = string | number | Date | null | undefined;
type Accessor<T> = (row: T) => SortVal;

function compare(a: SortVal, b: SortVal): number {
  const ae = a == null || a === '';
  const be = b == null || b === '';
  if (ae && be) return 0;
  if (ae) return 1;
  if (be) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return String(a).localeCompare(String(b), 'fr', { numeric: true, sensitivity: 'base' });
}

/**
 * Tri de tableau côté client. `accessors` associe une clé de colonne à la
 * valeur à comparer ; les colonnes sans accessor ne sont pas triables.
 */
export function useSort<T>(
  rows: T[],
  accessors: Record<string, Accessor<T>>,
  initial?: [string, SortDir],
) {
  const [sortKey, setSortKey] = useState<string | null>(initial?.[0] ?? null);
  const [sortDir, setSortDir] = useState<SortDir>(initial?.[1] ?? 'asc');

  const sorted = useMemo(() => {
    const acc = sortKey ? accessors[sortKey] : null;
    if (!acc) return rows;
    const mult = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((x, y) => compare(acc(x), acc(y)) * mult);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortKey, sortDir]);

  function toggle(k: string) {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir('asc');
    }
  }

  return { rows: sorted, sortKey, sortDir, toggle };
}

type SortState = { sortKey: string | null; sortDir: SortDir; toggle: (k: string) => void };

/** En-tête de colonne cliquable pour trier. `k` doit exister dans les accessors. */
export function SortTh({
  k,
  children,
  sort,
  align,
  style,
}: {
  k: string;
  children: ReactNode;
  sort: SortState;
  align?: 'right' | 'center';
  style?: CSSProperties;
}) {
  const active = sort.sortKey === k;
  return (
    <th
      className="sortable"
      onClick={() => sort.toggle(k)}
      aria-sort={active ? (sort.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      style={{ textAlign: align, ...style }}
      title={active ? (sort.sortDir === 'asc' ? 'Trié A→Z — cliquer pour inverser' : 'Trié Z→A — cliquer pour inverser') : 'Cliquer pour trier'}
    >
      {children}
      <span className="sort-ind" aria-hidden>{active ? (sort.sortDir === 'asc' ? '▲' : '▼') : '↕'}</span>
    </th>
  );
}
