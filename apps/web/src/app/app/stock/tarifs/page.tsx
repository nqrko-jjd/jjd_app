'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { api, apiUpload } from '@/lib/api';
import { PageHead, formatEur, formatDateBE } from '@/lib/ui';
import { ContactPicker } from '@/components/ContactPicker';
import { SkeletonRows } from '@/components/States';

interface SupplierRow { id: string; name: string; customerNumber: string | null; onAccount: boolean; productCount: number; updatedAt: string | null }
interface Product {
  id: string; ref: string; label: string; unit: string | null; priceHt: number; grossPrice: number | null; discountPct: number | null;
  linked: { id: string; name: string; ref: string | null } | null;
}
interface ImportResult { imported: number; created: number; updated: number; unchanged: number; pricesSynced: number; sheet: string | null; sheets: string[] }

export default function TarifsPage() {
  const router = useRouter();
  const { data: suppliers, reload: reloadSuppliers } = useApi<{ items: SupplierRow[] }>('/api/purchasing/catalog/suppliers');
  const [contactId, setContactId] = useState('');
  const [contactName, setContactName] = useState('');
  const [sheet, setSheet] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const catalogUrl = contactId ? `/api/purchasing/catalog?contactId=${contactId}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}` : null;
  const { data: catalog, loading, reload: reloadCatalog } = useApi<{ items: Product[]; total: number }>(catalogUrl);

  async function importFile(file: File) {
    setBusy(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('contactId', contactId);
      if (sheet.trim()) fd.append('sheet', sheet.trim());
      const r = await apiUpload<ImportResult>('/api/purchasing/catalog/import', fd);
      setResult({
        ok: true,
        text: `${r.imported} article(s) lus${r.sheet ? ` (feuille « ${r.sheet} »)` : ''} : ${r.created} nouveau(x), ${r.updated} prix/libellé mis à jour, ${r.unchanged} inchangé(s)${r.pricesSynced ? `, ${r.pricesSynced} prix d’article(s) de stock actualisé(s)` : ''}.`,
      });
      reloadSuppliers();
      reloadCatalog();
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function createArticle(p: Product) {
    try {
      const r = await api<{ item: { id: string } }>(`/api/purchasing/catalog/${p.id}/create-article`, { method: 'POST', body: {} });
      router.push(`/app/stock/${r.item.id}`);
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    }
  }

  return (
    <>
      <PageHead
        eyebrow="Magasin"
        title="Tarifs fournisseurs"
        sub="Importez la liste de prix d’un fournisseur (Excel ou CSV), puis créez vos articles de stock en un clic"
        action={<Link href="/app/stock/commandes" className="btn">← Commandes</Link>}
      />

      {(suppliers?.items.length ?? 0) > 0 && (
        <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          {suppliers!.items.map((s) => (
            <button key={s.id} className={`btn${contactId === s.id ? ' primary' : ''}`} onClick={() => { setContactId(s.id); setContactName(s.name); setQ(''); }}>
              {s.name} <span className="muted" style={{ marginLeft: 4, color: contactId === s.id ? 'inherit' : undefined }}>· {s.productCount}</span>
            </button>
          ))}
        </div>
      )}

      <div className="card card-pad" style={{ marginBottom: '1.2rem' }}>
        <div className="eyebrow" style={{ marginBottom: '0.6rem' }}>Importer / mettre à jour un tarif</div>
        <div className="row" style={{ gap: '0.7rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ minWidth: 280, flex: 1 }}>
            <label>Fournisseur</label>
            <ContactPicker typeFilter="supplier" value={contactId} onChange={(id, label) => { setContactId(id); setContactName(label); }} />
          </div>
          <div className="field" style={{ width: 220 }}>
            <label htmlFor="tf-sheet">Feuille (si plusieurs)</label>
            <input id="tf-sheet" className="input" placeholder="auto : nom du fournisseur" value={sheet} onChange={(e) => setSheet(e.target.value)} />
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.csv,.tsv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); }} />
          <button className="btn primary" disabled={!contactId || busy} onClick={() => fileRef.current?.click()}>{busy ? 'Import…' : 'Choisir le fichier…'}</button>
        </div>
        <div className="muted" style={{ fontSize: '0.82rem', marginTop: '0.6rem' }}>
          Colonnes reconnues automatiquement : n° d’article, libellé, unité de vente (U.V), prix (brut / remise / net). Réimporter le même fichier met les prix à jour, y compris sur les articles déjà liés.
        </div>
        {result && <div className={`badge ${result.ok ? 'ok' : 'crit'}`} style={{ marginTop: '0.7rem', padding: '0.45rem 0.8rem', display: 'block' }}>{result.text}</div>}
      </div>

      {contactId && (
        <>
          <div className="section-title">
            Tarif {contactName}
            {catalog && <span className="hint">{catalog.total} article{catalog.total > 1 ? 's' : ''}{catalog.total > catalog.items.length ? ` · ${catalog.items.length} affichés` : ''}</span>}
          </div>
          <input className="input" style={{ maxWidth: 320, marginBottom: '0.8rem' }} placeholder="Chercher un libellé ou un n° d’article…" value={q} onChange={(e) => setQ(e.target.value)} />
          {loading && !catalog && <SkeletonRows />}
          {catalog && catalog.items.length === 0 && <div className="card card-pad muted">Aucun tarif pour ce fournisseur — importez son fichier ci-dessus.</div>}
          {catalog && catalog.items.length > 0 && (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>N° article</th><th>Libellé</th><th>U.V</th><th style={{ textAlign: 'right' }}>Prix HT</th><th /></tr></thead>
                <tbody>
                  {catalog.items.map((p) => (
                    <tr key={p.id}>
                      <td className="mono" style={{ fontSize: '0.82rem' }}>{p.ref.startsWith('-') ? '—' : p.ref}</td>
                      <td>{p.label}</td>
                      <td>{p.unit ?? '—'}</td>
                      <td style={{ textAlign: 'right' }} className="tnum">
                        {formatEur(p.priceHt)}
                        {p.discountPct != null && p.grossPrice != null && <div className="muted" style={{ fontSize: '0.72rem' }}>brut {formatEur(p.grossPrice)} − {p.discountPct} %</div>}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {p.linked
                          ? <Link className="badge ok" href={`/app/stock/${p.linked.id}`}>{p.linked.ref ?? 'article'} ✓</Link>
                          : <button className="btn" style={{ padding: '0.2rem 0.55rem', fontSize: '0.78rem' }} onClick={() => createArticle(p)}>Créer l’article</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {!contactId && suppliers && suppliers.items.length === 0 && (
        <div className="card card-pad muted">Aucun tarif importé pour l’instant. Choisissez un fournisseur puis son fichier de prix.</div>
      )}
      {suppliers && suppliers.items.length > 0 && !contactId && (
        <div className="muted" style={{ fontSize: '0.85rem' }}>Choisissez un fournisseur ci-dessus pour consulter son tarif.
          {suppliers.items[0]?.updatedAt ? ` Dernière mise à jour : ${formatDateBE(suppliers.items[0].updatedAt)}.` : ''}</div>
      )}
    </>
  );
}
