'use client';
import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, Link2, Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { DocStatusBadge, DOC_KIND_LABEL } from '@/lib/doc-ui';
import { formatEur, formatDateBE } from '@/lib/ui';

/** Le document dont on part : une note de crédit (on choisit la facture qu'elle annule) ou une facture (on choisit une note de crédit à lui rattacher). */
export interface LinkSubject {
  id: string; kind: string; number: string | null; draftRef: string | null; totalTtc: number;
  contact: { id: string; name: string } | null;
}

interface Candidate {
  id: string; kind: string; number: string | null; draftRef: string | null; status: string; totalTtc: number; issuedOn: string | null;
  worksite: { ref: string } | null; contact: { id: string; name: string } | null;
  parent: { id: string; number: string | null } | null;
  children: { totalTtc: number; lockedAt: string | null }[];
}

const label = (d: { number: string | null; draftRef: string | null }) => d.number ?? d.draftRef ?? 'sans n°';

/**
 * Rattache une note de crédit à la facture qu'elle annule (après coup : notes importées de TrustUp ou créées « libres »).
 * N'envoie que `parentId` : aucun montant, ligne ni statut n'est modifié ; seule la facture entièrement couverte passe « créditée ».
 */
export function CreditLinkModal({ subject, onClose, onLinked }: { subject: LinkSubject; onClose: () => void; onLinked: (message: string) => void }) {
  const titleId = useId();
  const search = useRef<HTMLInputElement>(null);
  const saving = useRef(false);
  const pickInvoice = subject.kind === 'credit_note';
  const [allClients, setAllClients] = useState(!subject.contact);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => { const t = setTimeout(() => setDebounced(query.trim()), 250); return () => clearTimeout(t); }, [query]);
  const params = new URLSearchParams({ kind: pickInvoice ? 'invoice' : 'credit_note', scope: 'issued', pageSize: '300' });
  if (subject.contact && !allClients) params.set('contactId', subject.contact.id);
  if (debounced) params.set('q', debounced);
  const { data, loading, error, reload } = useApi<{ items: Candidate[]; totalCount: number }>(`/api/documents?${params}`);
  // côté « facture » : seules les notes de crédit pas encore rattachées à une facture
  const items = (data?.items ?? []).filter((d) => d.id !== subject.id && (pickInvoice || !d.parent));
  const selected = items.find((d) => d.id === selectedId);

  useEffect(() => {
    const overflow = window.document.body.style.overflow;
    window.document.body.style.overflow = 'hidden';
    search.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving.current) onClose(); };
    window.document.addEventListener('keydown', onKey);
    return () => { window.document.removeEventListener('keydown', onKey); window.document.body.style.overflow = overflow; };
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || saving.current) return;
    saving.current = true; setBusy(true); setSaveError(null);
    try {
      const [noteId, invoiceId] = pickInvoice ? [subject.id, selected.id] : [selected.id, subject.id];
      await api(`/api/documents/${noteId}`, { method: 'PATCH', body: { parentId: invoiceId } });
      onLinked(pickInvoice ? `${label(subject)} rattachée à la facture ${label(selected)}.` : `${label(selected)} rattachée à ${label(subject)}.`);
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Impossible de rattacher. Réessayez.');
    } finally { saving.current = false; setBusy(false); }
  }

  const credited = (d: Candidate) => Math.round(d.children.filter((c) => c.lockedAt).reduce((s, c) => s + Math.abs(c.totalTtc ?? 0), 0) * 100) / 100;

  return (
    <div className="modal-scrim" onClick={() => { if (!busy) onClose(); }}>
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()} onSubmit={submit} style={{ width: '100%', maxWidth: 680 }}>
        <div className="modal-head">
          <div className="modal-heading">
            <span className="modal-eyebrow">Note de crédit ↔ facture</span>
            <h2 id={titleId}>{pickInvoice ? 'Quelle facture cette note de crédit annule-t-elle ?' : 'Rattacher une note de crédit à cette facture'}</h2>
          </div>
          <button className="btn ghost" type="button" onClick={onClose} disabled={busy} aria-label="Fermer"><X size={18} /></button>
        </div>
        <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 14 }}>
          <div style={{ overflowWrap: 'anywhere' }}>
            <strong>{DOC_KIND_LABEL[subject.kind]} {label(subject)}</strong> · {formatEur(Math.abs(subject.totalTtc))} TTC
            {subject.contact && <div className="muted">{subject.contact.name}</div>}
          </div>
          <label style={{ position: 'relative' }}>
            <Search size={17} aria-hidden="true" style={{ position: 'absolute', left: 13, top: 15 }} />
            <input ref={search} className="input" aria-label="Rechercher" placeholder="N°, client, chantier ou objet…" value={query} disabled={busy} onChange={(e) => { setQuery(e.target.value); setSelectedId(''); }} style={{ paddingLeft: 39, width: '100%' }} />
          </label>
          {subject.contact && (
            <label className="row" style={{ gap: 8, fontSize: '0.88rem' }}>
              <input type="checkbox" checked={allClients} onChange={(e) => { setAllClients(e.target.checked); setSelectedId(''); }} disabled={busy} />
              Chercher chez tous les clients <span className="muted">(par défaut : seulement {subject.contact.name})</span>
            </label>
          )}
          {loading ? <p role="status">Chargement…</p> : error ? <div role="alert"><p>{error}</p><button type="button" className="btn" onClick={reload}>Réessayer</button></div> : (
            <div style={{ maxHeight: 'min(40vh, 340px)', overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 12 }}>
              {items.length === 0 && <p className="muted" style={{ padding: 14 }}>{pickInvoice ? 'Aucune facture trouvée.' : 'Aucune note de crédit non rattachée trouvée.'}{subject.contact && !allClients ? ' Essayez « tous les clients ».' : ''}</p>}
              {items.map((d) => {
                const done = credited(d);
                return (
                  <button key={d.id} type="button" aria-pressed={selectedId === d.id} disabled={busy} onClick={() => { setSelectedId(d.id); setSaveError(null); }}
                    style={{ display: 'flex', gap: 12, alignItems: 'center', width: '100%', padding: '11px 14px', textAlign: 'left', border: 0, borderBottom: '1px solid var(--line)', background: selectedId === d.id ? 'var(--primary-soft)' : 'var(--surface)', color: 'var(--ink)', cursor: 'pointer', minHeight: 56 }}>
                    <Link2 size={17} aria-hidden="true" style={{ flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                      <strong className="mono">{label(d)}</strong>{' '}<span className="muted">{d.issuedOn ? formatDateBE(d.issuedOn) : ''}</span>
                      <small className="muted" style={{ display: 'block', marginTop: 2 }}>{[d.contact?.name, d.worksite?.ref].filter(Boolean).join(' · ') || '—'}{done > 0.01 ? ` · déjà crédité ${formatEur(done)}` : ''}</small>
                    </span>
                    <DocStatusBadge status={d.status} />
                    <span style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{formatEur(Math.abs(d.totalTtc))}</span>
                    {selectedId === d.id && <Check size={18} aria-hidden="true" style={{ flexShrink: 0 }} />}
                  </button>
                );
              })}
            </div>
          )}
          {data && data.totalCount > 300 && <small className="muted">{data.totalCount} résultats : affinez la recherche pour voir les autres.</small>}
          {selected && pickInvoice && Math.abs(subject.totalTtc) > Math.abs(selected.totalTtc) - credited(selected) + 0.02 && (
            <p className="badge warn" style={{ whiteSpace: 'normal' }}>Cette note ({formatEur(Math.abs(subject.totalTtc))}) dépasse ce qu’il reste à créditer sur la facture ({formatEur(Math.max(0, Math.abs(selected.totalTtc) - credited(selected)))}). Le rattachement reste possible, par exemple si la note couvre deux factures.</p>
          )}
          {saveError && <p className="badge crit" role="alert" style={{ whiteSpace: 'normal' }}>{saveError}</p>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Annuler</button>
          <button type="submit" className="btn primary" disabled={!selected || busy || loading || !!error}>{busy ? 'Enregistrement…' : 'Rattacher'}</button>
        </div>
      </form>
    </div>
  );
}

/** Encadré bien visible dans la fiche d'une note de crédit (facture annulée) ou d'une facture (notes de crédit rattachées). */
export function CreditLinkCard({ doc, onChanged }: {
  doc: {
    id: string; kind: string; number: string | null; draftRef: string | null; totalTtc: number; paidAmount: number; lockedAt: string | null;
    contact: { id: string; name: string } | null;
    parent: { id: string; kind: string; number: string | null; draftRef: string | null; status?: string; totalTtc?: number; issuedOn?: string | null } | null;
    children: { id: string; kind: string; number: string | null; draftRef: string | null; status: string; totalTtc?: number; issuedOn?: string | null; lockedAt?: string | null }[];
  };
  onChanged: (message?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isNote = doc.kind === 'credit_note';
  const isInvoice = doc.kind === 'invoice' || doc.kind === 'deposit_invoice';
  const notes = doc.children.filter((c) => c.kind === 'credit_note');
  if (!isNote && !(isInvoice && (notes.length > 0 || doc.lockedAt))) return null;

  async function unlink(noteId: string, text: string) {
    if (!window.confirm(text)) return;
    setBusy(true); setErr(null);
    try { await api(`/api/documents/${noteId}`, { method: 'PATCH', body: { parentId: null } }); onChanged('Rattachement retiré.'); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const subject = { id: doc.id, kind: doc.kind, number: doc.number, draftRef: doc.draftRef, totalTtc: doc.totalTtc, contact: doc.contact };
  const modal = open && <CreditLinkModal subject={subject} onClose={() => setOpen(false)} onLinked={(m) => onChanged(m)} />;
  const box = (tone: 'ok' | 'warn'): React.CSSProperties => ({ marginBottom: '1rem', borderLeft: `4px solid var(--${tone === 'ok' ? 'primary' : 'warn'})` });

  if (isNote) {
    return (
      <div className="card card-pad" style={box(doc.parent ? 'ok' : 'warn')}>
        {modal}
        {doc.parent ? (
          <div className="row" style={{ justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <div className="muted" style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Cette note de crédit annule</div>
              <div style={{ fontSize: '1.05rem' }}>
                <Link href={`/app/documents/${doc.parent.id}`} className="mono"><strong>{doc.parent.number ?? doc.parent.draftRef}</strong></Link>
                {doc.parent.totalTtc != null && <span> · {formatEur(Math.abs(doc.parent.totalTtc))} TTC</span>}
                {doc.parent.issuedOn && <span className="muted"> · du {formatDateBE(doc.parent.issuedOn)}</span>}{' '}
                {doc.parent.status && <DocStatusBadge status={doc.parent.status} />}
              </div>
            </div>
            <div className="row" style={{ gap: '0.5rem' }}>
              <button type="button" className="btn" disabled={busy} onClick={() => setOpen(true)}>Changer de facture</button>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => unlink(doc.id, 'Retirer le rattachement à la facture ? La note de crédit reste, mais ne sera plus liée à aucune facture.')}>Délier</button>
            </div>
          </div>
        ) : (
          <div className="row" style={{ justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div><strong>Cette note de crédit n’est liée à aucune facture.</strong><div className="muted" style={{ fontSize: '0.88rem' }}>Rattachez-la à la facture qu’elle annule pour que celle-ci apparaisse « créditée » et que les listes se recoupent.</div></div>
            <button type="button" className="btn primary" disabled={busy} onClick={() => setOpen(true)}><Link2 size={16} /> Lier à une facture…</button>
          </div>
        )}
        {err && <p className="badge crit" style={{ marginTop: 8 }}>{err}</p>}
      </div>
    );
  }

  const credited = Math.round(notes.filter((c) => c.lockedAt).reduce((s, c) => s + Math.abs(c.totalTtc ?? 0), 0) * 100) / 100;
  const remaining = Math.round((Math.abs(doc.totalTtc) - credited) * 100) / 100;
  return (
    <div className="card card-pad" style={box(notes.length ? 'ok' : 'warn')}>
      {modal}
      <div className="row" style={{ justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="muted" style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Notes de crédit sur cette facture</div>
        {doc.lockedAt && <button type="button" className="btn" disabled={busy} onClick={() => setOpen(true)}><Link2 size={16} /> Lier une note de crédit existante…</button>}
      </div>
      {notes.length === 0 && <p className="muted" style={{ margin: '0.4rem 0 0' }}>Aucune note de crédit rattachée à cette facture.</p>}
      {notes.map((c) => (
        <div key={c.id} className="row" style={{ gap: '0.7rem', alignItems: 'center', padding: '0.3rem 0', flexWrap: 'wrap' }}>
          <Link href={`/app/documents/${c.id}`} className="mono"><strong>{c.number ?? c.draftRef}</strong></Link>
          {c.issuedOn && <span className="muted">{formatDateBE(c.issuedOn)}</span>}
          {!c.lockedAt && <span className="badge plain">brouillon</span>}
          <span style={{ marginLeft: 'auto', fontWeight: 600 }}>− {formatEur(Math.abs(c.totalTtc ?? 0))}</span>
          <button type="button" className="btn ghost" style={{ padding: '0.1rem 0.5rem' }} disabled={busy} title="Détacher cette note de crédit" onClick={() => unlink(c.id, `Détacher ${c.number ?? 'cette note de crédit'} de cette facture ?`)}>✕</button>
        </div>
      ))}
      {credited > 0 && (
        <div className="muted" style={{ fontSize: '0.86rem', marginTop: 6 }}>
          Crédité {formatEur(credited)} sur {formatEur(Math.abs(doc.totalTtc))}{remaining > 0.01 ? ` · reste ${formatEur(remaining)}` : ' · intégralement'}
          {doc.paidAmount > 0.01 ? ` · payé ${formatEur(doc.paidAmount)}` : ''}
          {doc.paidAmount - remaining > 0.01 ? ` · trop-perçu ${formatEur(doc.paidAmount - remaining)} à rembourser ou à imputer sur une autre facture` : ''}
        </div>
      )}
      {err && <p className="badge crit" style={{ marginTop: 8 }}>{err}</p>}
    </div>
  );
}
