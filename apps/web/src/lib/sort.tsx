'use client';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';

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

function cellText(val: SortVal): string {
  return String(val instanceof Date ? val.toLocaleDateString('fr-BE') : (val ?? ''));
}

/**
 * Filtre de colonne côté client — se branche sur les mêmes `accessors` que `useSort`. À
 * composer avant le tri : `useSort(filter.rows, accessors)`. Deux modes par colonne :
 * - texte (`setFilter`) : sous-chaîne, insensible à la casse — pour les colonnes libres.
 * - multi (`toggleValue`) : valeurs exactes cochées, façon filtre Excel — pour les colonnes
 *   à choix fermé (statut, entité…), voir `filterOptions` sur `SortTh`.
 */
export function useColumnFilter<T>(rows: T[], accessors: Record<string, Accessor<T>>) {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [multi, setMulti] = useState<Record<string, Set<string>>>({});

  const filtered = useMemo(() => {
    const textActive = Object.entries(filters).filter(([, v]) => v.trim());
    const multiActive = Object.entries(multi).filter(([, v]) => v.size > 0);
    if (!textActive.length && !multiActive.length) return rows;
    return rows.filter(
      (r) =>
        textActive.every(([k, v]) => {
          const acc = accessors[k];
          if (!acc) return true;
          return cellText(acc(r)).toLowerCase().includes(v.trim().toLowerCase());
        }) &&
        multiActive.every(([k, v]) => {
          const acc = accessors[k];
          if (!acc) return true;
          return v.has(cellText(acc(r)));
        }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filters, multi]);

  return {
    rows: filtered,
    filters,
    multi,
    setFilter: (k: string, v: string) => setFilters((f) => ({ ...f, [k]: v })),
    toggleValue: (k: string, val: string) =>
      setMulti((m) => {
        const s = new Set(m[k] ?? []);
        if (s.has(val)) s.delete(val);
        else s.add(val);
        return { ...m, [k]: s };
      }),
    clearValue: (k: string) => setMulti((m) => ({ ...m, [k]: new Set() })),
    active: Object.values(filters).some((v) => v.trim()) || Object.values(multi).some((v) => v.size > 0),
    clear: () => { setFilters({}); setMulti({}); },
  };
}

type ColumnFilter = {
  filters: Record<string, string>;
  multi: Record<string, Set<string>>;
  setFilter: (k: string, v: string) => void;
  toggleValue: (k: string, val: string) => void;
  clearValue: (k: string) => void;
};

/** Menu déroulant à cases à cocher (façon filtre Excel) pour une colonne à choix fermé. */
function MultiFilterMenu({ options, checked, onToggle, onClear, onClose }: {
  options: string[];
  checked: Set<string>;
  onToggle: (v: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="ctx-menu col-filter-menu" role="menu" onClick={(e) => e.stopPropagation()}>
      {options.map((o) => (
        <button key={o} type="button" role="menuitemcheckbox" aria-checked={checked.has(o)} className="ctx-item" onClick={() => onToggle(o)}>
          <span className="ctx-check">{checked.has(o) ? '✓' : ''}</span>
          <span>{o}</span>
        </button>
      ))}
      {checked.size > 0 && (
        <>
          <div className="ctx-sep" />
          <button type="button" className="ctx-item" onClick={onClear}>Tout afficher</button>
        </>
      )}
    </div>
  );
}

/**
 * En-tête de colonne cliquable pour trier, avec filtre optionnel (`filter`, depuis
 * useColumnFilter). `k` doit exister dans les accessors. Passer `filterOptions` (liste de
 * valeurs possibles) pour un filtre à cases à cocher façon Excel plutôt qu'un champ texte —
 * adapté aux colonnes à choix fermé (statut, entité…).
 */
export function SortTh({
  k,
  children,
  sort,
  align,
  style,
  filter,
  filterPlaceholder,
  filterOptions,
}: {
  k: string;
  children: ReactNode;
  sort: SortState;
  align?: 'right' | 'center';
  style?: CSSProperties;
  filter?: ColumnFilter;
  filterPlaceholder?: string;
  filterOptions?: string[];
}) {
  const active = sort.sortKey === k;
  const [menuOpen, setMenuOpen] = useState(false);
  const checked = filter?.multi[k] ?? new Set<string>();
  return (
    <th
      className="sortable"
      aria-sort={active ? (sort.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      style={{ textAlign: align, position: 'relative', ...style }}
    >
      <div
        onClick={() => sort.toggle(k)}
        style={{ cursor: 'pointer' }}
        title={active ? (sort.sortDir === 'asc' ? 'Trié A→Z — cliquer pour inverser' : 'Trié Z→A — cliquer pour inverser') : 'Cliquer pour trier'}
      >
        {children}
        <span className="sort-ind" aria-hidden>{active ? (sort.sortDir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </div>
      {filter && filterOptions && (
        <>
          <button
            type="button"
            className={`col-filter-btn${checked.size ? ' on' : ''}`}
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
            title="Filtrer par valeur"
          >
            ▾ {checked.size > 0 ? `${checked.size} sélectionné${checked.size > 1 ? 's' : ''}` : 'Filtrer'}
          </button>
          {menuOpen && (
            <MultiFilterMenu
              options={filterOptions}
              checked={checked}
              onToggle={(v) => filter.toggleValue(k, v)}
              onClear={() => filter.clearValue(k)}
              onClose={() => setMenuOpen(false)}
            />
          )}
        </>
      )}
      {filter && !filterOptions && (
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
