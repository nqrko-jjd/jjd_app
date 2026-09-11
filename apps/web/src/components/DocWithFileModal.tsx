'use client';
import { useState } from 'react';
import { FileDrop } from './FileDrop';

export interface DocTypeOption { value: string; label: string }

/**
 * Création d'un document (type/libellé/numéro/dates) avec la pièce jointe
 * directement dans le même formulaire — plutôt que créer d'abord la fiche puis
 * chercher un bouton « Joindre » séparé sur la ligne, pas évident à trouver.
 */
export function DocWithFileModal({
  title,
  typeOptions,
  onClose,
  onSubmit,
}: {
  title: string;
  typeOptions: DocTypeOption[];
  onClose: () => void;
  onSubmit: (
    values: { type: string; label: string; number: string; issuedOn: string; expiresOn: string },
    file: File | null,
  ) => Promise<void>;
}) {
  const [type, setType] = useState('');
  const [label, setLabel] = useState('');
  const [number, setNumber] = useState('');
  const [issuedOn, setIssuedOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!type) { setErr('Choisis un type.'); return; }
    setBusy(true);
    setErr(null);
    try {
      await onSubmit({ type, label, number, issuedOn, expiresOn }, file);
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
          <div className="field">
            <label htmlFor="doc-type">Type *</label>
            <select id="doc-type" className="select" required value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">—</option>
              {typeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="doc-label">Libellé (optionnel)</label>
            <input id="doc-label" className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="doc-number">Numéro</label>
            <input id="doc-number" className="input" value={number} onChange={(e) => setNumber(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="doc-issued">Délivré le</label>
            <input id="doc-issued" className="input" type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="doc-expires">Expire le</label>
            <input id="doc-expires" className="input" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Pièce jointe (PDF ou photo)</label>
            <FileDrop file={file} onFile={setFile} />
          </div>
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
