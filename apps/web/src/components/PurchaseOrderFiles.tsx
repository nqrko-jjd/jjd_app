'use client';
import { tr } from '@/lib/ui-language';
import { useRef, useState } from 'react';
import { api, apiBlobUrl, apiUpload } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateBE } from '@/lib/ui';

export interface OrderFileItem { id: string; label: string; originalName: string | null; size: number; createdAt: string }

export const ORDER_FILE_MAX_BYTES = 14 * 1024 * 1024;
export const ORDER_FILE_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.gif,.doc,.docx,.xls,.xlsx,.odt,.ods,.rtf,.txt,.csv,.eml,.msg,.zip';
export const sizeLabel = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);

const iconFor = (name: string | null) => {
  const n = (name ?? '').toLowerCase();
  if (n.endsWith('.pdf')) return '📕';
  if (/\.(jpe?g|png|webp|gif|heic)$/.test(n)) return '🖼️';
  if (/\.(xlsx?|csv|ods)$/.test(n)) return '📊';
  if (/\.(docx?|odt|rtf|txt)$/.test(n)) return '📝';
  return '📎';
};

/** Documents joints à une commande fournisseur (PDF du bon de commande, devis reçu, confirmation…). */
export function PurchaseOrderFiles({ orderId, files, onChanged }: { orderId: string; files: OrderFileItem[]; onChanged: () => void }) {
  const { user } = useAuth();
  const canEdit = !!user && ['admin', 'office'].includes(user.role);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [msgs, setMsgs] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(list: FileList | File[] | null) {
    const picked = list ? Array.from(list) : [];
    if (!picked.length) return;
    setBusy(true);
    const out: string[] = [];
    for (const f of picked) {
      if (f.size > ORDER_FILE_MAX_BYTES) { out.push(`✗ ${f.name} : trop lourd (${sizeLabel(f.size)}, ${sizeLabel(ORDER_FILE_MAX_BYTES)} maximum).`); continue; }
      try {
        const fd = new FormData();
        fd.append('file', f);
        await apiUpload(`/api/purchasing/orders/${orderId}/files`, fd);
        out.push(`✓ ${f.name}`);
      } catch (e) {
        out.push(`✗ ${f.name} : ${(e as Error).message}`);
      }
    }
    setMsgs(out);
    setBusy(false);
    onChanged();
  }
  async function open(f: OrderFileItem) {
    try { window.open(await apiBlobUrl(`/api/purchasing/orders/${orderId}/files/${f.id}/download`), '_blank', 'noopener'); } catch (e) { setMsgs([`✗ ${(e as Error).message}`]); }
  }
  async function remove(f: OrderFileItem) {
    if (!confirm(`Supprimer « ${f.label} » ? Le fichier sera effacé définitivement.`)) return;
    try { await api(`/api/purchasing/orders/${orderId}/files/${f.id}`, { method: 'DELETE' }); onChanged(); } catch (e) { setMsgs([`✗ ${(e as Error).message}`]); }
  }

  if (!canEdit && files.length === 0) return null;
  return (
    <div className="card" style={{ overflow: 'hidden', margin: '0 0 1.4rem' }}>
      <div className="modal-head" style={{ borderBottom: files.length || canEdit ? '1px solid var(--line)' : undefined }}>
        <div>
          <strong>Documents de la commande</strong>{' '}
          <span className="muted" style={{ fontSize: '0.8rem' }}>bon de commande PDF, devis reçu, confirmation…</span>
        </div>
      </div>
      {files.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <tbody>
              {files.map((f) => (
                <tr key={f.id}>
                  <td>
                    <button type="button" style={{ textAlign: 'left', background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'inherit' }} onClick={() => open(f)}>
                      <span style={{ marginRight: 6 }}>{iconFor(f.originalName)}</span><strong>{f.label}</strong>
                      {f.originalName && f.originalName.replace(/\.[^.]+$/, '') !== f.label && <span className="muted" style={{ fontSize: '0.76rem' }}> · {f.originalName}</span>}
                    </button>
                  </td>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>{sizeLabel(f.size)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDateBE(f.createdAt)}</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button className="btn" onClick={() => open(f)}>{tr("Ouvrir")}</button>
                    {canEdit && <>{' '}<button className="btn ghost" onClick={() => remove(f)} aria-label={tr("Supprimer")}>🗑</button></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && (
        <div style={{ padding: '0.9rem 1.15rem', display: 'grid', gap: '0.5rem' }}>
          <div
            className={`filedrop${over ? ' over' : ''}${busy ? ' disabled' : ''}`}
            onDragOver={(e) => { if (busy) return; e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) upload(e.dataTransfer.files); }}
            onClick={() => !busy && inputRef.current?.click()}
            role="button" tabIndex={0}
            onKeyDown={(e) => { if (!busy && (e.key === 'Enter' || e.key === ' ')) inputRef.current?.click(); }}
          >
            <input ref={inputRef} type="file" multiple hidden accept={ORDER_FILE_ACCEPT} onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
            <div className="filedrop-row filedrop-empty">
              <span className="filedrop-ic">{busy ? '⏳' : '⬆'}</span>
              <div>
                <strong>{busy ? 'Envoi en cours…' : 'Glisser le PDF de la commande ici'}</strong>
                <div className="muted" style={{ fontSize: '0.8rem' }}>ou cliquer pour parcourir · {sizeLabel(ORDER_FILE_MAX_BYTES)} maximum par fichier</div>
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
    </div>
  );
}
