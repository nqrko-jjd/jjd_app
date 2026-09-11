'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

export interface AddressHit {
  label: string;
  street: string;
  postalCode: string;
  city: string;
  lat: number;
  lng: number;
}

/**
 * Champ adresse avec suggestions au fil de la frappe (style Google Maps), pour éviter les
 * adresses mal tapées qui font ensuite échouer la géolocalisation. Contrôlé comme un <input>
 * classique (`value`/`onChange`) ; `onSelect` reçoit en plus le détail complet (rue, code
 * postal, ville, lat/lng) quand l'utilisateur choisit une suggestion, pour préremplir les
 * champs voisins.
 */
export function AddressAutocomplete({
  id,
  value,
  onChange,
  onSelect,
  placeholder,
  required,
  disabled,
  className = 'input',
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  onSelect: (hit: AddressHit) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [items, setItems] = useState<AddressHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);
  const pickedRef = useRef(false);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, []);

  function search(q: string) {
    if (timer.current) clearTimeout(timer.current);
    abort.current?.abort();
    if (q.trim().length < 3) {
      setItems([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(async () => {
      const ctrl = new AbortController();
      abort.current = ctrl;
      try {
        const r = await api<{ items: AddressHit[] }>(`/api/geocode/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        setItems(r.items);
        setOpen(r.items.length > 0);
        setActive(-1);
      } catch {
        /* recherche annulée ou en échec — pas grave, l'utilisateur peut continuer à taper à la main */
      }
    }, 400);
  }

  function pick(hit: AddressHit) {
    pickedRef.current = true;
    onChange(hit.street);
    onSelect(hit);
    setOpen(false);
    setItems([]);
  }

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <input
        id={id}
        className={className}
        type="text"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        onChange={(e) => {
          pickedRef.current = false;
          onChange(e.target.value);
          search(e.target.value);
        }}
        onFocus={() => { if (items.length > 0 && !pickedRef.current) setOpen(true); }}
        onKeyDown={(e) => {
          if (!open || items.length === 0) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, items.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(items[active]); }
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && items.length > 0 && (
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
              key={`${it.lat},${it.lng},${i}`}
              onMouseDown={(e) => { e.preventDefault(); pick(it); }}
              onMouseEnter={() => setActive(i)}
              style={{
                padding: '0.4rem 0.55rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.87rem',
                color: 'var(--ink)', background: i === active ? 'var(--surface-2)' : 'transparent',
              }}
            >
              {it.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
