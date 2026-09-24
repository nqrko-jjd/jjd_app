'use client';
import { useState } from 'react';
import Link from 'next/link';
import { MapPin } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHead } from '@/lib/ui';
import { SkeletonRows, EmptyState } from '@/components/States';

interface Rack { code: string; id: string | null; label: string | null; itemCount: number }

/** Racks / étagères du dépôt : liste, ajout, impression des étiquettes QR (format « BRZ-… » comme Bricoloc). */
export default function RacksPage() {
  const { user } = useAuth();
  const canManage = user?.role === 'admin' || user?.role === 'office' || user?.role === 'storekeeper';
  const { data, loading, reload } = useApi<{ items: Rack[] }>('/api/stock/locations');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const racks = data?.items ?? [];
  const pickedCodes = racks.filter((r) => picked[r.code]).map((r) => r.code);

  async function add() {
    const codes = text.split(/[\n,;]+/).map((c) => c.trim()).filter(Boolean);
    if (!codes.length) return;
    setBusy(true);
    setErr(null);
    try {
      await api('/api/stock/locations', { method: 'POST', body: { codes } });
      setText('');
      reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(code: string) {
    if (!confirm(`Retirer le rack ${code} de la liste ? Les articles qui y sont rangés gardent leur emplacement.`)) return;
    await api(`/api/stock/locations/${encodeURIComponent(code)}`, { method: 'DELETE' });
    reload();
  }

  return (
    <>
      <PageHead
        eyebrow="Magasin"
        title="Racks & emplacements"
        sub="Une étiquette QR par rack : on la scanne pendant une entrée pour dire où l’article est rangé"
        action={<Link href="/app/stock" className="btn">← Stock</Link>}
      />

      {canManage && (
        <div className="card card-pad" style={{ marginBottom: '1.2rem', maxWidth: 760 }}>
          <div className="eyebrow" style={{ marginBottom: '0.6rem' }}>Ajouter des racks</div>
          <div className="row" style={{ gap: '0.7rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: 1, minWidth: 260 }}>
              <label htmlFor="rk-new">Codes (séparés par une virgule ou un retour à la ligne)</label>
              <textarea id="rk-new" className="input" rows={2} placeholder="R-01-A, R-01-B, R-02-A" value={text} onChange={(e) => setText(e.target.value)} />
            </div>
            <button className="btn primary" disabled={busy || !text.trim()} onClick={add}>{busy ? 'Ajout…' : 'Ajouter'}</button>
          </div>
          {err && <div className="badge crit" style={{ display: 'block', marginTop: '0.6rem', padding: '0.4rem 0.7rem' }}>{err}</div>}
          <div className="muted" style={{ fontSize: '0.82rem', marginTop: '0.6rem' }}>
            Les racks des étiquettes Bricoloc (BRZ-…) sont reconnus tels quels. Un rack scanné à l’entrée est aussi ajouté automatiquement à cette liste.
          </div>
        </div>
      )}

      {loading && !data && <SkeletonRows />}
      {data && racks.length === 0 && (
        <EmptyState icon={MapPin} title="Aucun rack" text="Ajoutez vos racks ci-dessus, puis imprimez leurs étiquettes." />
      )}
      {racks.length > 0 && (
        <>
          <div className="row" style={{ gap: '0.6rem', marginBottom: '0.8rem', alignItems: 'center' }}>
            <a className="btn primary" target="_blank" rel="noreferrer" href={`/imprimer/etiquettes?racks=${pickedCodes.length ? encodeURIComponent(pickedCodes.join(',')) : 'all'}`}>
              Imprimer {pickedCodes.length ? `${pickedCodes.length} étiquette${pickedCodes.length > 1 ? 's' : ''}` : 'toutes les étiquettes'}
            </a>
            <span className="muted" style={{ fontSize: '0.82rem' }}>Cochez des racks pour n’imprimer que ceux-là.</span>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th style={{ width: 36 }} /><th>Rack</th><th>Étiquette à scanner</th><th style={{ textAlign: 'right' }}>Articles rangés</th><th /></tr></thead>
              <tbody>
                {racks.map((r) => (
                  <tr key={r.code}>
                    <td><input type="checkbox" checked={!!picked[r.code]} onChange={(e) => setPicked((p) => ({ ...p, [r.code]: e.target.checked }))} aria-label={`Sélectionner ${r.code}`} /></td>
                    <td style={{ fontWeight: 700 }}>{r.code}</td>
                    <td className="mono" style={{ fontSize: '0.82rem' }}>BRZ-{r.code}</td>
                    <td style={{ textAlign: 'right' }} className="tnum">{r.itemCount}</td>
                    <td style={{ textAlign: 'right' }}>{canManage && r.id && <button className="btn ghost" onClick={() => remove(r.code)} aria-label={`Retirer ${r.code}`}>✕</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
