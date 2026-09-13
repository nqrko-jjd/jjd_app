'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface PickerItem {
  id: string;
  name: string;
  sub?: string; // ex. ville, sous-titre affiché en petit sous le nom
  /** Données additionnelles portées par ce résultat (ex. l'immeuble lié à un contact) —
   *  transmises telles quelles au 3e argument de `onChange` quand ce résultat est choisi. */
  meta?: Record<string, unknown>;
}

/**
 * Sélecteur "chercher ou créer" générique : recherche au fil de la frappe dans une liste
 * fournie par l'appelant (`search`), avec un item final "+ Créer « texte tapé »" qui ouvre
 * une mini-modale de création (`renderCreate`) — pour ne jamais bloquer sur "pas encore dans
 * la liste". Contrôlé par un id (`value`), pas par le texte affiché : `resolveLabel` permet
 * de retrouver le libellé d'un id déjà connu (ex. en édition, sans tout recharger).
 */
export function SearchCreateSelect({
  id,
  value,
  onChange,
  search,
  resolveLabel,
  createLabel,
  renderCreate,
  placeholder,
  required,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (id: string, label: string, meta?: PickerItem['meta']) => void;
  search: (q: string) => Promise<PickerItem[]>;
  resolveLabel?: (id: string) => Promise<string | null>;
  createLabel: string;
  renderCreate: (query: string, onCreated: (item: PickerItem) => void, onCancel: () => void) => ReactNode;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<PickerItem[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);
  const pickedRef = useRef(false);
  const resolvedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!value) { resolvedFor.current = null; setQuery(''); return; }
    if (resolvedFor.current === value) return;
    resolvedFor.current = value;
    if (!resolveLabel) return;
    resolveLabel(value).then((label) => { if (label) setQuery(label); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, []);

  function runSearch(q: string) {
    if (timer.current) clearTimeout(timer.current);
    abort.current?.abort();
    if (q.trim().length < 2) {
      setItems([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(async () => {
      const ctrl = new AbortController();
      abort.current = ctrl;
      setBusy(true);
      try {
        const r = await search(q);
        setItems(r);
        setOpen(true);
        setActive(-1);
      } catch {
        /* recherche annulée ou en échec — l'utilisateur peut réessayer ou créer */
      } finally {
        setBusy(false);
      }
    }, 300);
  }

  function pick(item: PickerItem) {
    pickedRef.current = true;
    onChange(item.id, item.name, item.meta);
    setQuery(item.name);
    setOpen(false);
    setItems([]);
  }

  function clear() {
    onChange('', '');
    setQuery('');
    setItems([]);
    setOpen(false);
  }

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <div className="row" style={{ gap: '0.3rem' }}>
        <input
          id={id}
          className="input"
          style={{ flex: 1 }}
          type="text"
          autoComplete="off"
          value={query}
          placeholder={placeholder ?? 'Rechercher…'}
          required={required}
          disabled={disabled}
          onChange={(e) => {
            pickedRef.current = false;
            setQuery(e.target.value);
            runSearch(e.target.value);
          }}
          onFocus={() => { if (items.length > 0 && !pickedRef.current) setOpen(true); }}
          onKeyDown={(e) => {
            if (!open) return;
            const optCount = items.length + 1; // +1 = ligne "+ Créer"
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, optCount - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
            else if (e.key === 'Enter') {
              e.preventDefault();
              if (active === items.length) { setCreating(true); setOpen(false); }
              else if (active >= 0) pick(items[active]);
            } else if (e.key === 'Escape') setOpen(false);
          }}
        />
        {value && !disabled && (
          <button type="button" className="btn ghost" style={{ padding: '0.3rem 0.55rem' }} onClick={clear} title="Retirer">✕</button>
        )}
      </div>
      {open && (
        <ul
          style={{
            position: 'absolute', zIndex: 30, top: 'calc(100% + 2px)', left: 0, right: 0,
            margin: 0, padding: '0.25rem', listStyle: 'none',
            background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '8px',
            boxShadow: '0 6px 20px rgba(0,0,0,0.15)', maxHeight: '260px', overflowY: 'auto',
          }}
        >
          {items.map((it, i) => (
            <li
              key={it.id}
              onMouseDown={(e) => { e.preventDefault(); pick(it); }}
              onMouseEnter={() => setActive(i)}
              style={{
                padding: '0.4rem 0.55rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.87rem',
                color: 'var(--ink)', background: i === active ? 'var(--surface-2)' : 'transparent',
              }}
            >
              {it.name}
              {it.sub && <span className="muted" style={{ marginLeft: '0.4em' }}>{it.sub}</span>}
            </li>
          ))}
          {!busy && (
            <li
              onMouseDown={(e) => { e.preventDefault(); setCreating(true); setOpen(false); }}
              onMouseEnter={() => setActive(items.length)}
              style={{
                padding: '0.4rem 0.55rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.87rem',
                color: 'var(--primary)', fontWeight: 600,
                background: active === items.length ? 'var(--surface-2)' : 'transparent',
              }}
            >
              + {createLabel}{query.trim() ? ` « ${query.trim()} »` : ''}
            </li>
          )}
        </ul>
      )}
      {creating && typeof document !== 'undefined' && createPortal(
        // Portail vers <body> : la mini-modale de création (elle-même un <form>) ne doit pas
        // se retrouver imbriquée dans le <form> du champ qui l'a ouverte.
        renderCreate(
          query.trim(),
          (item) => { setCreating(false); pick(item); },
          () => setCreating(false),
        ),
        document.body,
      )}
    </div>
  );
}
