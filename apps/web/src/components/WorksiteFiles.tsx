'use client';
import { tr } from '@/lib/ui-language';
import { useRef, useState } from 'react';
import { api, apiBlobUrl, apiUpload } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { formatDateBE } from '@/lib/ui';

export interface WorksiteFileItem {
  id: string; label: string; category: string | null; originalName: string | null; mimeType: string | null;
  size: number; createdAt: string; uploadedBy: string | null; downloadPath: string;
}
interface FilesResponse { items: WorksiteFileItem[]; categories: string[]; maxBytes: number }

const sizeLabel = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);
const iconFor = (f: WorksiteFileItem) => {
  const n = (f.originalName ?? '').toLowerCase();
  if (n.endsWith('.pdf')) return '📕';
  if (/\.(jpe?g|png|webp|gif|heic)$/.test(n)) return '🖼️';
  if (/\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/.test(n)) return '🎞️';
  if (/\.(mp3|m4a|wav|ogg|opus)$/.test(n)) return '🎧';
  if (/\.(xlsx?|csv|ods)$/.test(n)) return '📊';
  if (/\.(docx?|odt|rtf|txt)$/.test(n)) return '📝';
  if (/\.(dwg|dxf)$/.test(n)) return '📐';
  return '📎';
};

/** Onglet « Documents » d'un chantier : fiches techniques, plans, offres fournisseurs, certificats… */
export function WorksiteFiles({ worksiteId, onChanged }: { worksiteId: string; onChanged?: () => void }) {
  const { user } = useAuth();
  const canEdit = !!user && ['admin', 'office'].includes(user.role);
  const { data, reload, loading } = useApi<FilesResponse>(`/api/worksites/${worksiteId}/files`);
  const [category, setCategory] = useState('Fiche technique');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const maxBytes = data?.maxBytes ?? 300 * 1024 * 1024;
  const categories = data?.categories ?? ['Fiche technique', 'Plan', 'Offre / devis fournisseur', 'Certificat / garantie', 'Photo', 'Vidéo', 'Autre'];

  async function upload(files: FileList | File[] | null) {
    const list = files ? Array.from(files) : [];
    if (!list.length) return;
    setBusy(true);
    const out: string[] = [];
    for (const f of list) {
      if (f.size > maxBytes) { out.push(`✗ ${f.name} : trop lourd (${sizeLabel(f.size)}, ${sizeLabel(maxBytes)} maximum).`); continue; }
      try {
        const fd = new FormData();
        fd.append('file', f);
        fd.append('category', category);
        await apiUpload(`/api/worksites/${worksiteId}/files`, fd);
        out.push(`✓ ${f.name}`);
      } catch (e) {
        out.push(`✗ ${f.name} : ${(e as Error).message}`);
      }
    }
    setMsgs(out);
    setBusy(false);
    reload();
    onChanged?.();
  }
  async function open(f: WorksiteFileItem) {
    try { window.open(await apiBlobUrl(f.downloadPath), '_blank', 'noopener'); } catch (e) { setMsgs([`✗ ${(e as Error).message}`]); }
  }
  async function saveEdit(f: WorksiteFileItem, patch: { label?: string; category?: string | null }) {
    await api(`/api/worksites/${worksiteId}/files/${f.id}`, { method: 'PATCH', body: patch });
    setEditing(null);
    reload();
  }
  async function remove(f: WorksiteFileItem) {
    if (!confirm(`Supprimer « ${f.label} » ? Le fichier sera effacé définitivement.`)) return;
    await api(`/api/worksites/${worksiteId}/files/${f.id}`, { method: 'DELETE' });
    reload();
    onChanged?.();
  }

  const items = (data?.items ?? []).filter((f) => !filter || f.category === filter);
  const used = [...new Set((data?.items ?? []).map((f) => f.category).filter(Boolean))] as string[];

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="modal-head" style={{ borderBottom: '1px solid var(--line)' }}>
        <div>
          <strong>Documents du chantier</strong>{' '}
          <span className="muted" style={{ fontSize: '0.8rem' }}>fiches techniques, plans, offres fournisseurs, certificats…</span>
        </div>
        {used.length > 0 && (
          <select className="select" style={{ maxWidth: 220 }} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrer par type">
            <option value="">Tous les types ({data?.items.length ?? 0})</option>
            {used.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {canEdit && (
        <div style={{ padding: '0.9rem 1.15rem', borderBottom: '1px solid var(--line)', display: 'grid', gap: '0.6rem' }}>
          <div className="row" style={{ gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <label htmlFor="wf-cat" style={{ fontSize: '0.85rem' }}>Type des fichiers déposés</label>
            <select id="wf-cat" className="select" style={{ maxWidth: 260 }} value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div
            className={`filedrop${over ? ' over' : ''}${busy ? ' disabled' : ''}`}
            onDragOver={(e) => { if (busy) return; e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) upload(e.dataTransfer.files); }}
            onClick={() => !busy && inputRef.current?.click()}
            role="button" tabIndex={0}
            onKeyDown={(e) => { if (!busy && (e.key === 'Enter' || e.key === ' ')) inputRef.current?.click(); }}
          >
            <input ref={inputRef} type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
            <div className="filedrop-row filedrop-empty">
              <span className="filedrop-ic">{busy ? '⏳' : '⬆'}</span>
              <div>
                <strong>{busy ? 'Envoi en cours… (une vidéo peut prendre quelques minutes, ne fermez pas la page)' : 'Glisser des fichiers ici (PDF, photos, vidéos MP4…)'}</strong>
                <div className="muted" style={{ fontSize: '0.8rem' }}>ou cliquer pour parcourir · plusieurs fichiers possibles · {sizeLabel(maxBytes)} maximum par fichier</div>
              </div>
            </div>
          </div>
          {msgs.length > 0 && (
            <div role="status" style={{ fontSize: '0.84rem', display: 'grid', gap: '0.15rem' }}>
              {msgs.map((m, i) => <span key={i} style={{ color: m.startsWith('✗') ? 'var(--crit)' : undefined }}>{m}</span>)}
            </div>
          )}
        </div>
      )}

      {loading && !data ? (
        <div className="muted" style={{ padding: '1rem 1.15rem' }}>Chargement…</div>
      ) : items.length === 0 ? (
        <div className="muted" style={{ padding: '1.2rem 1.15rem' }}>
          {data?.items.length ? 'Aucun fichier de ce type.' : canEdit ? 'Aucun document pour ce chantier. Déposez la première fiche technique ci-dessus.' : 'Aucun document pour ce chantier.'}
        </div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Document</th><th>Type</th><th>Taille</th><th>Ajouté</th><th /></tr></thead>
            <tbody>
              {items.map((f) => (
                <tr key={f.id}>
                  <td>
                    {editing === f.id ? (
                      <form className="row" style={{ gap: '0.4rem' }} onSubmit={(e) => { e.preventDefault(); if (editLabel.trim()) saveEdit(f, { label: editLabel.trim() }); }}>
                        <input className="input" autoFocus value={editLabel} onChange={(e) => setEditLabel(e.target.value)} />
                        <button className="btn primary" type="submit">OK</button>
                        <button className="btn ghost" type="button" onClick={() => setEditing(null)}>{tr("Annuler")}</button>
                      </form>
                    ) : (
                      <button type="button" className="linklike" style={{ textAlign: 'left', background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'inherit' }} onClick={() => open(f)}>
                        <span style={{ marginRight: 6 }}>{iconFor(f)}</span><strong>{f.label}</strong>
                        {f.originalName && f.originalName.replace(/\.[^.]+$/, '') !== f.label && <span className="muted" style={{ fontSize: '0.76rem' }}> · {f.originalName}</span>}
                      </button>
                    )}
                  </td>
                  <td>
                    {canEdit ? (
                      <select className="select" style={{ maxWidth: 190 }} value={f.category ?? ''} onChange={(e) => saveEdit(f, { category: e.target.value || null })} aria-label="Type">
                        <option value="">—</option>
                        {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    ) : (f.category ?? '—')}
                  </td>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>{sizeLabel(f.size)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDateBE(f.createdAt)}{f.uploadedBy && <span className="muted" style={{ fontSize: '0.76rem' }}> · {f.uploadedBy}</span>}</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button className="btn" onClick={() => open(f)}>{tr("Ouvrir")}</button>
                    {canEdit && <>
                      {' '}<button className="btn ghost" onClick={() => { setEditing(f.id); setEditLabel(f.label); }}>Renommer</button>
                      {' '}<button className="btn ghost" onClick={() => remove(f)} aria-label={tr("Supprimer")}>🗑</button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
