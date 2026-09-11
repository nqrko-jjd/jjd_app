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

/**
 * Filtre de colonne côté client (sous-chaîne, insensible à la casse) — se branche sur les
 * mêmes `accessors` que `useSort`. À composer avant le tri : `useSort(filter.rows, accessors)`.
 */
export function useColumnFilter<T>(rows: T[], accessors: Record<string, Accessor<T>>) {
  const [filters, setFilters] = useState<Record<string, string>>({});

  const filtered = useMemo(() => {
    const active = Object.entries(filters).filter(([, v]) => v.trim());
    if (!active.length) return rows;
    return rows.filter((r) =>
      active.every(([k, v]) => {
        const acc = accessors[k];
        if (!acc) return true;
        const val = acc(r);
        return String(val instanceof Date ? val.toLocaleDateString('fr-BE') : (val ?? '')).toLowerCase().includes(v.trim().toLowerCase());
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filters]);

  return {
    rows: filtered,
    filters,
    setFilter: (k: string, v: string) => setFilters((f) => ({ ...f, [k]: v })),
    active: Object.values(filters).some((v) => v.trim()),
    clear: () => setFilters({}),
  };
}

type ColumnFilter = { filters: Record<string, string>; setFilter: (k: string, v: string) => void };

/** En-tête de colonne cliquable pour trier, avec filtre optionnel (`filter`, depuis useColumnFilter). `k` doit exister dans les accessors. */
export function SortTh({
  k,
  children,
  sort,
  align,
  style,
  filter,
  filterPlaceholder,
}: {
  k: string;
  children: ReactNode;
  sort: SortState;
  align?: 'right' | 'center';
  style?: CSSProperties;
  filter?: ColumnFilter;
  filterPlaceholder?: string;
}) {
  const active = sort.sortKey === k;
  return (
    <th
      className="sortable"
      aria-sort={active ? (sort.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      style={{ textAlign: align, ...style }}
    >
      <div
        onClick={() => sort.toggle(k)}
        style={{ cursor: 'pointer' }}
        title={active ? (sort.sortDir === 'asc' ? 'Trié A→Z — cliquer pour inverser' : 'Trié Z→A — cliquer pour inverser') : 'Cliquer pour trier'}
      >
        {children}
        <span className="sort-ind" aria-hidden>{active ? (sort.sortDir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </div>
      {filter && (
        <input
          className="col-filter"
          value={filter.filters[k] ?? ''}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => filter.setFilter(k, e.target.value)}
          placeholder={filterPlaceholder ?? 'Filtrer…'}
        />
      )}
    </th>
  );
}
