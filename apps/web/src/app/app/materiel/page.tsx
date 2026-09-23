'use client';
import { SkeletonRows, EmptyState } from '@/components/States';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { PageHead, Thumb, Kpi } from '@/lib/ui';
import { PaginationBar, PAGE_SIZE_ALL } from '@/components/PaginationBar';
import { ViewToggle, useViewMode } from '@/components/ViewToggle';
import { WorksitePicker, LocationPicker, pushRecent } from '@/components/MaterielPickers';
import { Wrench, CircleCheck, Building2, Truck } from 'lucide-react';

interface Unit {
  assetTag: string;
  state: string;
  storageLocation: string | null;
  chantier: { name: string; ref: string | null; since: string } | null;
}
interface Product {
  id: string;
  slug: string;
  name: string;
  kind: string;
  brand: string | null;
  model: string | null;
  image: string | null;
  category: string | null;
  shortDescription: string | null;
  description: string | null;
  specs: Record<string, string>;
  manualUrl: string | null;
  documents: { label: string; url: string }[];
  total: number;
  available: number;
  onSite: number;
  rented: number;
  units: Unit[];
}
interface Consumable {
  id: string;
  slug: string;
  name: string;
  stockQty: number | null;
  shortDescription: string | null;
}
type Worksite = { id: string; ref: string; title: string; city: string | null; client: { name: string } | null };

export default function MaterielPage() {
  const router = useRouter();
  const { data: status } = useApi<{ enabled: boolean }>('/api/materiel/status');
  const { data: wsData } = useApi<{ items: Worksite[] }>('/api/materiel/worksites');
  const { data: stock, reload, loading } = useApi<{ products: Product[] }>('/api/materiel/stock');
  const { data: consData, reload: reloadCons } = useApi<{ consumables: Consumable[] }>('/api/materiel/consumables');

  const [tab, setTab] = useState<'outils' | 'consommables'>('outils');
  const [mode, setMode] = useViewMode('materiel', 'gallery');
  const [search, setSearch] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [scan, setScan] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  // Sortie en cours : exemplaire scanné directement depuis cette page.
  const [scanPending, setScanPending] = useState<{ assetTag: string; productName: string } | null>(null);
  // Retour en cours : il faut scanner/indiquer la zone où l'outil est remis avant de valider.
  const [scanReturnPending, setScanReturnPending] = useState<{ assetTag: string; productName: string } | null>(null);
  // Retrait de consommable en cours.
  const [consumeTarget, setConsumeTarget] = useState<string | null>(null);
  const [consumeQty, setConsumeQty] = useState(1);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const products = stock?.products ?? [];
  const consumables = consData?.consumables ?? [];
  const worksites = wsData?.items ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products
      .filter((p) => p.total > 0)
      .filter((p) => !onlyAvailable || p.available > 0)
      .filter((p) => !q || `${p.name} ${p.brand ?? ''} ${p.category ?? ''}`.toLowerCase().includes(q));
  }, [products, search, onlyAvailable]);

  // pagination côté client : le parc Bricoloc est chargé d'un coup (pas d'API paginée côté partenaire)
  const [matPage, setMatPage] = useState(1);
  const [matPageSize, setMatPageSize] = useState(50);
  useEffect(() => { setMatPage(1); }, [search, onlyAvailable]);
  const matTotalPages = Math.max(1, Math.ceil(filtered.length / matPageSize));
  const paged = filtered.slice((matPage - 1) * matPageSize, matPage * matPageSize);

  const filteredCons = useMemo(() => {
    const q = search.trim().toLowerCase();
    return consumables.filter((c) => !q || `${c.name} ${c.shortDescription ?? ''}`.toLowerCase().includes(q));
  }, [consumables, search]);

  // Emplacements déjà utilisés au dépôt — proposés en un tap plutôt que de tout retaper.
  const knownLocations = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) for (const u of p.units) if (u.storageLocation) set.add(u.storageLocation);
    return [...set].sort().slice(0, 12);
  }, [products]);

  async function resolveScan(code: string) {
    const v = code.trim();
    if (!v) return;
    try {
      const info = await api<{ unit: { assetTag: string; state: string }; product: { id: string; name: string } }>(
        `/api/materiel/units/${encodeURIComponent(v)}`,
      );
      setScan('');
      if (info.unit.state === 'AVAILABLE') {
        // Chemin rapide : on sait déjà quel exemplaire, il ne reste qu'à dire pour quel chantier.
        setScanPending({ assetTag: info.unit.assetTag, productName: info.product.name });
      } else if (info.unit.state === 'ON_SITE') {
        // Retour : il faut encore dire dans quelle zone l'outil est remis.
        setScanReturnPending({ assetTag: info.unit.assetTag, productName: info.product.name });
      } else {
        router.push(`/app/materiel/${info.product.id}`);
      }
    } catch (e) {
      setToast({ text: e instanceof ApiError ? e.message : 'Outil introuvable', ok: false });
    }
  }

  async function checkout(assetTag: string, w: Worksite) {
    setBusy(true);
    setToast(null);
    try {
      await api('/api/materiel/loans', { method: 'POST', body: { code: assetTag, worksiteId: w.id } });
      pushRecent(w.id);
      setToast({ text: `${assetTag} → ${w.ref}`, ok: true });
      setScanPending(null);
      await reload();
    } catch (e) {
      setToast({ text: e instanceof ApiError ? e.message : 'Échec', ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function returnUnit(assetTag: string, storageLocation: string) {
    setBusy(true);
    setToast(null);
    try {
      await api('/api/materiel/returns', { method: 'POST', body: { code: assetTag, storageLocation } });
      setToast({ text: `${assetTag} rentré au dépôt · ${storageLocation}`, ok: true });
      setScanReturnPending(null);
      await reload();
    } catch (e) {
      setToast({ text: e instanceof ApiError ? e.message : 'Échec', ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function consume(consumableId: string, label: string, qty: number, w: Worksite) {
    setBusy(true);
    setToast(null);
    try {
      await api('/api/materiel/consumption', { method: 'POST', body: { productId: consumableId, quantity: qty, worksiteId: w.id } });
      pushRecent(w.id);
      setToast({ text: `${qty} × ${label} → ${w.ref}`, ok: true });
      setConsumeTarget(null);
      setConsumeQty(1);
      await reloadCons();
    } catch (e) {
      setToast({ text: e instanceof ApiError ? e.message : 'Échec', ok: false });
    } finally {
      setBusy(false);
    }
  }

  if (status && !status.enabled) {
    return (
      <>
        <PageHead eyebrow="Ressources" title="Matériel" />
        <div className="card card-pad">
          Le parc partagé avec Bricoloc n’est pas configuré (<code>BRICOLOC_API_KEY</code> dans{' '}
          <code>apps/api/.env</code>).
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead eyebrow="Ressources" title="Matériel" sub="Parc partagé avec Bricoloc — scan à la sortie et au retour" />

      <div className="seg" style={{ marginBottom: '1rem' }}>
        <button className={tab === 'outils' ? 'on' : ''} onClick={() => setTab('outils')}>Outils</button>
        <button className={tab === 'consommables' ? 'on' : ''} onClick={() => setTab('consommables')}>Consommables</button>
      </div>

      {tab === 'outils' && stock && (
        <div className="kpis" style={{ marginBottom: '1.4rem' }}>
          <Kpi ic={Wrench} label="Équipements" value={products.length} sub={`${products.reduce((a, p) => a + p.total, 0)} exemplaires`} hero />
          <Kpi ic={CircleCheck} label="Au dépôt" value={products.reduce((a, p) => a + p.available, 0)} sub="Disponibles maintenant" />
          <Kpi ic={Building2} label="Sur chantier" value={products.reduce((a, p) => a + p.onSite, 0)} sub="En cours d'utilisation" />
          <Kpi ic={Truck} label="Loué" value={products.reduce((a, p) => a + p.rented, 0)} sub="Client Bricoloc" />
        </div>
      )}

      {tab === 'outils' && (
        <div className="msg-filter-chips" style={{ marginBottom: '1rem' }}>
          <button className={!onlyAvailable ? 'on' : ''} onClick={() => setOnlyAvailable(false)}>Tous</button>
          <button className={onlyAvailable ? 'on' : ''} onClick={() => setOnlyAvailable(true)}>Disponible maintenant</button>
        </div>
      )}

      {tab === 'outils' && (
        <div className="card card-pad" style={{ marginBottom: '1rem', display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: '1 1 200px' }}>
              <label>Rechercher un outil</label>
              <input className="input" placeholder="perceuse, Makita, ponçage…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="field" style={{ flex: '0 1 220px' }}>
              <label>Scanner un n° d’exemplaire</label>
              <input
                ref={scanRef}
                className="input"
                placeholder="ex. BRL-0142"
                value={scan}
                onChange={(e) => setScan(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && resolveScan(scan)}
              />
            </div>
            <ViewToggle mode={mode} onChange={setMode} />
          </div>
          {scanPending && (
            <WorksitePicker
              worksites={worksites}
              label={`Sortir ${scanPending.assetTag} (${scanPending.productName}) → pour quel chantier ?`}
              onPick={(w) => checkout(scanPending.assetTag, w)}
              onCancel={() => setScanPending(null)}
            />
          )}
          {scanReturnPending && (
            <LocationPicker
              suggestions={knownLocations}
              label={`Retour ${scanReturnPending.assetTag} (${scanReturnPending.productName}) → dans quelle zone ?`}
              onConfirm={(loc) => returnUnit(scanReturnPending.assetTag, loc)}
              onCancel={() => setScanReturnPending(null)}
            />
          )}
        </div>
      )}

      {tab === 'consommables' && (
        <div className="card card-pad" style={{ marginBottom: '1rem' }}>
          <div className="field">
            <label>Rechercher un consommable</label>
            <input className="input" placeholder="ciment, vis, gants…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      )}

      {toast && (
        <div className={`badge ${toast.ok ? 'ok' : 'crit'}`} style={{ marginBottom: 12 }}>
          {toast.text}
        </div>
      )}

      {tab === 'outils' && (
        <>
          {loading && !stock && <SkeletonRows />}

          {mode === 'gallery' && (
            <div className="gallery-grid">
              {paged.map((p) => (
                <div
                  key={p.id}
                  className="card gallery-card"
                  style={{ cursor: 'pointer' }}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(`/app/materiel/${p.id}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/app/materiel/${p.id}`); }}
                >
                  <div className="gallery-thumb">
                    {p.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.image} alt="" />
                    ) : <Wrench size={22} strokeWidth={1.6} />}
                  </div>
                  <div className="gallery-body">
                    <div className="gallery-title">{p.name}</div>
                    <div className="gallery-sub">{p.brand ? `${p.brand}${p.model ? ` ${p.model}` : ''}` : (p.category ?? '—')}</div>
                  </div>
                  <div className="row" style={{ padding: '0 0.85rem 0.7rem', gap: 6, flexWrap: 'wrap' }}>
                    <span className={`badge plain ${p.available > 0 ? 'ok' : ''}`} style={{ fontSize: '0.68rem' }}>{p.available} dispo</span>
                    {p.onSite > 0 && <span className="badge plain warn" style={{ fontSize: '0.68rem' }}>{p.onSite} chantier</span>}
                    {p.rented > 0 && <span className="badge plain" style={{ fontSize: '0.68rem' }}>{p.rented} loué</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {mode === 'list' && (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr><th></th><th>Outil</th><th>Catégorie</th><th style={{ textAlign: 'right' }}>Dépôt</th><th style={{ textAlign: 'right' }}>Chantier</th><th style={{ textAlign: 'right' }}>Loué</th></tr>
                </thead>
                <tbody>
                  {paged.map((p) => (
                    <tr key={p.id} className="row-link" onClick={() => router.push(`/app/materiel/${p.id}`)}>
                      <td style={{ width: 48 }}><Thumb src={p.image} /></td>
                      <td>
                        <div style={{ fontWeight: 650 }}>{p.name}</div>
                        {p.brand && <div className="muted" style={{ fontSize: '0.78rem' }}>{p.brand}{p.model ? ` ${p.model}` : ''}</div>}
                      </td>
                      <td>{p.category ?? '—'}</td>
                      <td style={{ textAlign: 'right' }} className="tnum">
                        <span className={`badge plain ${p.available > 0 ? 'ok' : ''}`}>{p.available}</span>
                      </td>
                      <td style={{ textAlign: 'right' }} className="tnum">{p.onSite > 0 ? <span className="badge plain warn">{p.onSite}</span> : '—'}</td>
                      <td style={{ textAlign: 'right' }} className="tnum">{p.rented > 0 ? <span className="badge plain">{p.rented}</span> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && filtered.length === 0 && <EmptyState
            icon={Wrench}
            title="Aucun outil"
            text="Aucun outil ne correspond à cette recherche ou à ce filtre. Réinitialisez-les pour revoir tout le parc."
            action={<button className="btn primary" onClick={() => { setSearch(''); setOnlyAvailable(false); }}>Réinitialiser les filtres</button>}
          />}

          <PaginationBar page={matPage} totalPages={matTotalPages} pageSize={matPageSize} onPage={setMatPage} onPageSize={(s) => { setMatPageSize(s); setMatPage(1); }} sizes={[24, 50, 100, PAGE_SIZE_ALL]} />
        </>
      )}

      {tab === 'consommables' && (
        <div style={{ display: 'grid', gap: 8 }}>
          {filteredCons.length === 0 && <EmptyState
            icon={Wrench}
            title="Aucun consommable"
            text="Aucun consommable ne correspond à cette recherche. Effacez-la pour revoir toute la liste."
            action={<button className="btn primary" onClick={() => setSearch('')}>Effacer la recherche</button>}
          />}
          {filteredCons.map((c) => (
            <div key={c.id} className="card card-pad" style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 650 }}>{c.name}</div>
                  {c.shortDescription && <div className="muted" style={{ fontSize: '0.8rem' }}>{c.shortDescription}</div>}
                  <span className={`badge plain ${(c.stockQty ?? 0) > 0 ? 'ok' : 'crit'}`} style={{ fontSize: '0.68rem', marginTop: 4 }}>
                    {c.stockQty ?? '—'} en stock
                  </span>
                </div>
                {consumeTarget !== c.id && (
                  <button className="btn primary" disabled={busy} onClick={() => { setConsumeTarget(c.id); setConsumeQty(1); }}>
                    Retirer…
                  </button>
                )}
              </div>
              {consumeTarget === c.id && (
                <>
                  <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                    <label className="muted" style={{ fontSize: '0.82rem' }}>Quantité</label>
                    <input
                      className="input" type="number" min={1} step="any" style={{ width: 90 }}
                      value={consumeQty}
                      onChange={(e) => setConsumeQty(Math.max(1, Number(e.target.value)))}
                    />
                  </div>
                  <WorksitePicker
                    worksites={worksites}
                    label={`Retirer ${consumeQty} × ${c.name} → pour quel chantier ?`}
                    onPick={(w) => consume(c.id, c.name, consumeQty, w)}
                    onCancel={() => setConsumeTarget(null)}
                  />
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
