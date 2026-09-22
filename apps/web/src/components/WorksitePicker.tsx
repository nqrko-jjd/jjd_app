'use client';
import { useEffect, useRef, useState } from 'react';

export interface WsPickerOption { id: string; ref: string; title: string; city: string | null }

/**
 * Sélecteur de chantier « chercher dans la liste », stylé (remplace le champ natif
 * `<input list>` peu lisible sur mobile comme sur desktop) : filtre localement dans les
 * options fournies (pas d'appel réseau — la liste des chantiers est déjà chargée par la page),
 * réf en gras + titre + ville sur une ligne dédiée.
 */
export function WorksitePicker({
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  options: WsPickerOption[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.id === value);
  const label = (w: WsPickerOption) => `${w.ref} · ${w.title}`;

  useEffect(() => { setQuery(current ? label(current) : ''); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = (q.length === 0
    ? options
    : options.filter((w) => w.ref.toLowerCase().includes(q) || w.title.toLowerCase().includes(q) || (w.city ?? '').toLowerCase().includes(q))
  ).slice(0, 40);

  function pick(w: WsPickerOption) {
    onChange(w.id);
    setQuery(label(w));
    setOpen(false);
  }

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <input
        className="input"
        type="text"
        autoComplete="off"
        value={query}
        placeholder={placeholder ?? 'Chercher un chantier (réf ou nom)…'}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(-1);
          if (e.target.value.trim() === '') onChange('');
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, filtered.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0 && filtered[active]) pick(filtered[active]!); }
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && (
        <ul
          style={{
            position: 'absolute', zIndex: 30, top: 'calc(100% + 2px)', left: 0, right: 0,
            margin: 0, padding: '0.25rem', listStyle: 'none',
            background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '8px',
            boxShadow: '0 6px 20px rgba(0,0,0,0.15)', maxHeight: '280px', overflowY: 'auto',
          }}
        >
          {filtered.length === 0 && (
            <li style={{ padding: '0.5rem 0.6rem', fontSize: '0.85rem', color: 'var(--ink-3)' }}>Aucun chantier trouvé.</li>
          )}
          {filtered.map((w, i) => (
            <li
              key={w.id}
              onMouseDown={(e) => { e.preventDefault(); pick(w); }}
              onMouseEnter={() => setActive(i)}
              style={{
                padding: '0.45rem 0.6rem', borderRadius: '6px', cursor: 'pointer',
                background: i === active ? 'var(--surface-2)' : (w.id === value ? 'var(--primary-soft)' : 'transparent'),
              }}
            >
              <div style={{ fontWeight: 700, fontSize: '0.87rem' }}>
                {w.ref} <span style={{ fontWeight: 400, color: 'var(--ink-2)' }}>· {w.title}</span>
              </div>
              {w.city && <div className="muted" style={{ fontSize: '0.76rem' }}>{w.city}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
