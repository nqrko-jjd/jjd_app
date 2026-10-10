'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * « Un dernier coup d'œil ? » avant l'émission : contrôles du document. Les erreurs bloquent l'émission ; les recommandations avertissent
 * sans bloquer. L'émission verrouille les lignes et attribue le numéro définitif.
 */
export function IssueModal({ docId, kindLabel, onConfirm, onClose, busy }: { docId: string; kindLabel: string; onConfirm: () => void; onClose: () => void; busy: boolean }) {
  const [checks, setChecks] = useState<{ errors: string[]; recommendations: string[] } | null>(null);
  useEffect(() => { api<{ errors: string[]; recommendations: string[] }>(`/api/documents/${docId}/checks`).then(setChecks).catch(() => setChecks({ errors: [], recommendations: [] })); }, [docId]);
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);
  const blocked = !!checks?.errors.length;
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>Un dernier coup d’œil ?</h2><button type="button" className="btn ghost" onClick={onClose} aria-label="Fermer">✕</button></div>
        <div className="modal-body" style={{ display: 'block' }}>
          <p style={{ marginTop: 0 }}>Vous allez émettre {kindLabel} : un numéro définitif sera attribué et les lignes seront verrouillées.</p>
          {!checks && <p className="muted">Vérification en cours…</p>}
          {checks?.errors.map((e) => <div key={e} className="badge crit" style={{ display: 'block', margin: '0.3rem 0', padding: '0.4rem 0.7rem' }}>⛔ {e}</div>)}
          {checks?.recommendations.map((r) => <div key={r} className="badge warn" style={{ display: 'block', margin: '0.3rem 0', padding: '0.4rem 0.7rem', whiteSpace: 'normal' }}>💡 {r}</div>)}
          {checks && !checks.errors.length && !checks.recommendations.length && <div className="badge ok" style={{ padding: '0.4rem 0.7rem' }}>✓ Tout est en ordre.</div>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Continuer à modifier</button>
          <button type="button" className="btn primary" disabled={busy || blocked || !checks} onClick={onConfirm}>{busy ? 'Émission…' : 'Émettre'}</button>
        </div>
      </div>
    </div>
  );
}
