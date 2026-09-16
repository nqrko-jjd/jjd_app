'use client';
import { useMemo, useState } from 'react';

type Worksite = { id: string; ref: string; title: string; city: string | null; client: { name: string } | null };

const RECENT_KEY = 'jjd_materiel_recent';
export function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
}
export function pushRecent(id: string) {
  try {
    const cur = loadRecent().filter((x) => x !== id);
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...cur].slice(0, 5)));
  } catch {}
}

/** Étape 2 du parcours : « pour quel chantier ? » — suggestions récentes + recherche, pas de longue liste déroulante. */
export function WorksitePicker({
  worksites, label, onPick, onCancel,
}: {
  worksites: Worksite[]; label: string; onPick: (w: Worksite) => void; onCancel: () => void;
}) {
  const [q, setQ] = useState('');
  const recentIds = useMemo(() => loadRecent(), []);
  const recent = useMemo(
    () => recentIds.map((id) => worksites.find((w) => w.id === id)).filter((w): w is Worksite => !!w),
    [recentIds, worksites],
  );
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return worksites
      .filter((w) => `${w.ref} ${w.title} ${w.city ?? ''} ${w.client?.name ?? ''}`.toLowerCase().includes(s))
      .slice(0, 8);
  }, [worksites, q]);

  return (
    <div style={{ display: 'grid', gap: 10, padding: '0.7rem', background: 'var(--surface-2)', borderRadius: 10 }}>
      <div style={{ fontWeight: 650, fontSize: '0.85rem' }}>{label}</div>
      {!q && recent.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {recent.map((w) => (
            <button key={w.id} type="button" className="badge primary" style={{ cursor: 'pointer' }} onClick={() => onPick(w)}>
              {w.ref} — {w.title}
            </button>
          ))}
        </div>
      )}
      <input
        className="input"
        autoFocus
        placeholder="Chercher un chantier (réf, client, ville…)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {q && (
        <div style={{ display: 'grid', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
          {matches.length === 0 && <div className="muted" style={{ fontSize: '0.82rem' }}>Aucun chantier trouvé.</div>}
          {matches.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => onPick(w)}
              className="btn"
              style={{ textAlign: 'left', justifyContent: 'flex-start' }}
            >
              <span className="mono" style={{ marginRight: 6 }}>{w.ref}</span>
              {w.title}{w.city ? ` (${w.city})` : ''}
            </button>
          ))}
        </div>
      )}
      <button type="button" className="btn" onClick={onCancel}>Annuler</button>
    </div>
  );
}

/** Retour au dépôt : on scanne (ou tape) l'étiquette de la zone/étagère où l'outil est physiquement remis. */
export function LocationPicker({
  suggestions, label, onConfirm, onCancel,
}: {
  suggestions: string[]; label: string; onConfirm: (loc: string) => void; onCancel: () => void;
}) {
  const [loc, setLoc] = useState('');

  function submit() {
    const v = loc.trim();
    if (v) onConfirm(v);
  }

  return (
    <div style={{ display: 'grid', gap: 10, padding: '0.7rem', background: 'var(--surface-2)', borderRadius: 10 }}>
      <div style={{ fontWeight: 650, fontSize: '0.85rem' }}>{label}</div>
      {suggestions.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {suggestions.map((s) => (
            <button key={s} type="button" className="badge primary" style={{ cursor: 'pointer' }} onClick={() => onConfirm(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      <input
        className="input"
        autoFocus
        placeholder="Scanner l’étiquette de zone ou taper l’emplacement (ex. Étagère A3)"
        value={loc}
        onChange={(e) => setLoc(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn primary" disabled={!loc.trim()} onClick={submit}>Confirmer le retour</button>
        <button type="button" className="btn" onClick={onCancel}>Annuler</button>
      </div>
    </div>
  );
}
