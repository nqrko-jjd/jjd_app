'use client';
import { useEffect, useState } from 'react';

export type ViewMode = 'list' | 'gallery';

/** Mémorise le choix liste/galerie par page (localStorage, par viewer). */
export function useViewMode(key: string, defaultMode: ViewMode = 'list') {
  const [mode, setMode] = useState<ViewMode>(defaultMode);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`view:${key}`);
      if (saved === 'list' || saved === 'gallery') setMode(saved);
    } catch {
      /* mode privé */
    }
  }, [key]);
  function set(m: ViewMode) {
    setMode(m);
    try {
      localStorage.setItem(`view:${key}`, m);
    } catch {
      /* mode privé */
    }
  }
  return [mode, set] as const;
}

export function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <div className="row" style={{ gap: '0.2rem' }}>
      <button
        type="button"
        className={`btn${mode === 'list' ? ' primary' : ''}`}
        style={{ padding: '0.35rem 0.6rem' }}
        onClick={() => onChange('list')}
        title="Vue liste"
        aria-label="Vue liste"
        aria-pressed={mode === 'list'}
      >
        ☰
      </button>
      <button
        type="button"
        className={`btn${mode === 'gallery' ? ' primary' : ''}`}
        style={{ padding: '0.35rem 0.6rem' }}
        onClick={() => onChange('gallery')}
        title="Vue galerie"
        aria-label="Vue galerie"
        aria-pressed={mode === 'gallery'}
      >
        ▦
      </button>
    </div>
  );
}
