'use client';
import { useRef, useState } from 'react';
import { api, apiUpload } from '@/lib/api';

/**
 * Bandeau photo réutilisable (fiche véhicule, fiche personne).
 * `basePath` = ex. `/api/vehicles/<id>` → POST/DELETE `<basePath>/photo`.
 */
export function PhotoHeader({
  basePath,
  photoUrl,
  alt,
  fallback,
  shape = 'wide',
  editable = true,
  onChange,
}: {
  basePath: string;
  photoUrl: string | null;
  alt: string;
  fallback?: string; // initiales / emoji si pas de photo
  shape?: 'wide' | 'round';
  editable?: boolean;
  onChange?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pick(file: File) {
    setBusy(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append('file', file);
      await apiUpload(`${basePath}/photo`, form);
      onChange?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm('Supprimer la photo ?')) return;
    setBusy(true);
    try {
      await api(`${basePath}/photo`, { method: 'DELETE' });
      onChange?.();
    } finally {
      setBusy(false);
    }
  }

  const round = shape === 'round';
  const box: React.CSSProperties = round
    ? { width: 92, height: 92, borderRadius: '50%' }
    : { width: '100%', maxWidth: 460, aspectRatio: '16 / 10', borderRadius: 14 };

  return (
    <div className={round ? 'row' : ''} style={round ? { gap: '1rem', marginBottom: '1.2rem', alignItems: 'center' } : { marginBottom: '1.3rem' }}>
      <div
        style={{
          ...box,
          overflow: 'hidden',
          background: 'var(--surface-2)',
          border: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt={alt} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontSize: round ? 30 : 40, color: 'var(--ink-3)', fontWeight: 700 }}>{fallback ?? '📷'}</span>
        )}
      </div>
      {editable && (
        <div className="row" style={{ gap: '0.4rem', marginTop: round ? 0 : '0.6rem' }}>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ''; }}
          />
          <button className="btn" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? '…' : photoUrl ? 'Changer la photo' : 'Ajouter une photo'}
          </button>
          {photoUrl && <button className="btn ghost" disabled={busy} onClick={remove}>Retirer</button>}
          {err && <span className="badge crit">{err}</span>}
        </div>
      )}
    </div>
  );
}
