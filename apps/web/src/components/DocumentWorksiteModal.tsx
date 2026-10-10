'use client';
import { tr } from '@/lib/ui-language';
import { useEffect, useId, useRef, useState } from 'react';
import { Building2, Check, Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface WorksiteOption { id: string; name: string; city?: string | null }
interface LinkDocument {
  id: string; number: string | null; draftRef: string | null; title: string | null;
  worksite: { id: string; ref: string; title: string } | null;
}
const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Quick association only: never submits lines, prices, client or document status. */
export function DocumentWorksiteModal({ document: doc, onClose, onLinked }: {
  document: LinkDocument; onClose: () => void; onLinked: (name: string) => void;
}) {
  const titleId = useId();
  const form = useRef<HTMLFormElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const saving = useRef(false);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { data, loading, error, reload } = useApi<{ worksites: WorksiteOption[] }>('/api/meta/pickers');
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  const matching = (data?.worksites ?? []).filter((w) => words.every((word) => normalize(`${w.name} ${w.city ?? ''}`).includes(word)));
  const visible = matching.slice(0, 50);
  const selected = data?.worksites.find((w) => w.id === selectedId);
  const unchanged = selectedId === doc.worksite?.id;

  useEffect(() => {
    const previous = window.document.activeElement as HTMLElement | null;
    const overflow = window.document.body.style.overflow;
    window.document.body.style.overflow = 'hidden';
    search.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); if (!saving.current) onClose(); }
      if (event.key !== 'Tab') return;
      const nodes = form.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])');
      if (!nodes?.length) return;
      const first = nodes[0]!; const last = nodes[nodes.length - 1]!;
      if (event.shiftKey && window.document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.document.addEventListener('keydown', onKey);
    return () => {
      window.document.removeEventListener('keydown', onKey);
      window.document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [onClose]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || unchanged || saving.current) return;
    saving.current = true; setBusy(true); setSaveError(null);
    try {
      await api(`/api/documents/${doc.id}`, { method: 'PATCH', body: { worksiteId: selected.id } });
      onLinked(selected.name);
      onClose();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Impossible de lier le document. Réessayez.');
    } finally { saving.current = false; setBusy(false); }
  }

  return <div className="modal-scrim" onClick={() => { if (!busy) onClose(); }}>
    <form ref={form} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()} onSubmit={submit} style={{ width: '100%', maxWidth: 620 }}>
      <div className="modal-head">
        <div className="modal-heading"><span className="modal-eyebrow">{tr("Devis & factures")}</span><h2 id={titleId}>{doc.worksite ? 'Changer le chantier lié' : 'Lier à un chantier'}</h2></div>
        <button className="btn ghost" type="button" onClick={onClose} disabled={busy} aria-label={tr("Fermer")}><X size={18}/></button>
      </div>
      <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 14 }}>
        <div style={{ overflowWrap: 'anywhere' }}><strong>{doc.number ?? doc.draftRef ?? 'Document'}</strong>{doc.title && <div className="muted">{doc.title}</div>}
          {doc.worksite && <div className="muted" style={{ marginTop: 6 }}>Chantier actuel : {doc.worksite.ref} · {doc.worksite.title}</div>}
        </div>
        <label style={{ position: 'relative' }}><Search size={17} aria-hidden="true" style={{ position: 'absolute', left: 13, top: 15 }}/><input ref={search} className="input" aria-label="Rechercher un chantier" placeholder="Référence, nom ou ville du chantier…" value={query} disabled={busy} onChange={(e) => { setQuery(e.target.value); setSelectedId(''); setSaveError(null); }} style={{ paddingLeft: 39, width: '100%' }}/></label>
        {loading ? <p role="status">Chargement des chantiers…</p> : error ? <div role="alert"><p>{error}</p><button type="button" className="btn" onClick={reload}>Réessayer</button></div> : <>
          <div style={{ maxHeight: 'min(32vh, 290px)', overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 12 }} aria-label="Chantiers disponibles">
            {visible.length === 0 && <p className="muted" style={{ padding: 14 }}>Aucun chantier trouvé.</p>}
            {visible.map((w) => <button key={w.id} type="button" aria-pressed={selectedId === w.id} disabled={busy} onClick={() => { setSelectedId(w.id); setSaveError(null); }} style={{ display: 'flex', gap: 12, alignItems: 'center', width: '100%', padding: '12px 14px', textAlign: 'left', border: 0, borderBottom: '1px solid var(--line)', background: selectedId === w.id ? 'var(--primary-soft)' : 'var(--surface)', color: 'var(--ink)', cursor: 'pointer', minHeight: 52 }}>
              <Building2 size={18} aria-hidden="true" style={{ flexShrink: 0 }}/><span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}><strong>{w.name}</strong>{w.city && <small className="muted" style={{ display: 'block', marginTop: 3 }}>{w.city}</small>}</span>{selectedId === w.id && <Check size={18} aria-hidden="true" style={{ flexShrink: 0 }}/>}
            </button>)}
          </div>
          {matching.length > visible.length && <small className="muted">{matching.length} chantiers correspondent. Affinez la recherche pour voir les suivants.</small>}
        </>}
        {selected && <div role="status" style={{ overflowWrap: 'anywhere' }}><strong>{unchanged ? 'Déjà lié à ce chantier' : 'Chantier sélectionné'}</strong><div className="muted">{selected.name}</div></div>}
        {saveError && <p className="badge crit" role="alert" style={{ whiteSpace: 'normal' }}>{saveError}</p>}
      </div>
      <div className="modal-foot"><button type="button" className="btn" onClick={onClose} disabled={busy}>{tr("Annuler")}</button><button type="submit" className="btn primary" disabled={!selected || unchanged || busy || loading || !!error}>{busy ? tr("Enregistrement…") : 'Lier au chantier'}</button></div>
    </form>
  </div>;
}
