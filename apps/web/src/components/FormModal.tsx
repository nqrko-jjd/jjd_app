'use client';
import { useEffect, useState } from 'react';

export interface FieldDef {
  name: string;
  label: string;
  type?: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'tags';
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  full?: boolean;
}

export function FormModal({
  title,
  fields,
  initial,
  onClose,
  onSubmit,
}: {
  title: string;
  fields: FieldDef[];
  initial?: Record<string, unknown>;
  onClose: () => void;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
}) {
  const [v, setV] = useState<Record<string, unknown>>(() => ({ ...initial }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const clean: Record<string, unknown> = {};
      for (const f of fields) {
        let val = v[f.name];
        if (f.type === 'number') val = val === '' || val == null ? null : Number(val);
        if (f.type === 'date') val = val ? new Date(val as string).toISOString() : null;
        if (f.type === 'tags') val = typeof val === 'string' ? (val as string).split(',').map((s) => s.trim()).filter(Boolean) : val ?? [];
        if (val === '') val = null;
        clean[f.name] = val;
      }
      await onSubmit(clean);
      onClose();
    } catch (e2) {
      setErr((e2 as Error).message ?? 'Erreur');
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="modal-body">
          {fields.map((f) => (
            <div className="field" key={f.name} style={f.full ? { gridColumn: '1 / -1' } : undefined}>
              <label htmlFor={f.name}>{f.label}{f.required && ' *'}</label>
              {f.type === 'textarea' ? (
                <textarea id={f.name} className="input" rows={3} value={(v[f.name] as string) ?? ''} onChange={(e) => setV({ ...v, [f.name]: e.target.value })} placeholder={f.placeholder} />
              ) : f.type === 'select' ? (
                <select id={f.name} className="select" value={(v[f.name] as string) ?? ''} onChange={(e) => setV({ ...v, [f.name]: e.target.value })}>
                  <option value="">—</option>
                  {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input
                  id={f.name}
                  className="input"
                  type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                  step={f.type === 'number' ? 'any' : undefined}
                  value={(v[f.name] as string) ?? ''}
                  onChange={(e) => setV({ ...v, [f.name]: e.target.value })}
                  placeholder={f.placeholder}
                  required={f.required}
                />
              )}
            </div>
          ))}
        </div>
        {err && <div className="badge crit" style={{ margin: '0 1.15rem', padding: '0.4rem 0.7rem' }}>{err}</div>}
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
        </div>
      </form>
    </div>
  );
}

export function toDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}
