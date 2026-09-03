'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { PageHead, formatDateBE } from '@/lib/ui';

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
  image: string | null;
  category: string | null;
  total: number;
  available: number;
  onSite: number;
  rented: number;
  units: Unit[];
}
type Worksite = { id: string; ref: string; title: string; city: string | null };

const STATE_LABEL: Record<string, string> = {
  AVAILABLE: 'Au dépôt',
  ON_SITE: 'Sur chantier',
  RENTED: 'Loué (client Bricoloc)',
  MAINTENANCE: 'En entretien',
  DAMAGED: 'Endommagé',
  RETIRED: 'Réformé',
};

function unitLoc(u: Unit): string {
  if (u.chantier) return `${u.chantier.name} · depuis le ${formatDateBE(u.chantier.since)}`;
  if (u.state === 'AVAILABLE') return u.storageLocation ? `Dépôt Bricoloc · ${u.storageLocation}` : 'Dépôt Bricoloc';
  return STATE_LABEL[u.state] ?? u.state;
}

export default function MaterielPage() {
  const { data: status } = useApi<{ enabled: boolean }>('/api/materiel/status');
  const { data: wsData } = useApi<{ items: Worksite[] }>('/api/materiel/worksites');
  const { data: stock, reload, loading } = useApi<{ products: Product[] }>('/api/materiel/stock');

  const [worksiteId, setWorksiteId] = useState('');
  const [search, setSearch] = useState('');
  const [scan, setScan] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const s = localStorage.getItem('jjd_materiel_ws');
      if (s) setWorksiteId(s);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem('jjd_materiel_ws', worksiteId);
    } catch {}
  }, [worksiteId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const products = stock?.products ?? [];
  const worksites = wsData?.items ?? [];
  const wsLabel = worksites.find((w) => w.id === worksiteId);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products
      .filter((p) => p.total > 0)
      .filter((p) => !q || `${p.name} ${p.brand ?? ''} ${p.category ?? ''}`.toLowerCase().includes(q));
  }, [products, search]);

  const open = products.find((p) => p.id === openId) ?? null;

  async function resolveScan(code: string) {
    const v = code.trim();
    if (!v) return;
    try {
      const info = await api<{ product: { id: string } }>(`/api/materiel/units/${encodeURIComponent(v)}`);
      // rafraîchit puis ouvre la fiche du produit correspondant
      await reload();
      setOpenId(info.product.id);
      setScan('');
    } catch (e) {
      setToast({ text: e instanceof ApiError ? e.message : 'Outil introuvable', ok: false });
    }
  }

  async function move(assetTag: string, dir: 'out' | 'in') {
    setBusy(true);
    setToast(null);
    try {
      if (dir === 'out') {
        if (!worksiteId) {
          setToast({ text: 'Choisissez d’abord un chantier de travail en haut.', ok: false });
          setBusy(false);
          return;
        }
        await api('/api/materiel/loans', { method: 'POST', body: { code: assetTag, worksiteId } });
        setToast({ text: `${assetTag} → ${wsLabel?.ref ?? 'chantier'}`, ok: true });
      } else {
        await api('/api/materiel/returns', { method: 'POST', body: { code: assetTag } });
        setToast({ text: `${assetTag} rentré au dépôt`, ok: true });
      }
      await reload();
    } catch (e) {
      setToast({ text: e instanceof ApiError ? e.message : 'Échec', ok: false });
    } finally {
      setBusy(false);
    }
  }

  if (status && !status.enabled) {
    return (
      <>
        <PageHead title="Matériel" />
        <div className="card card-pad">
          Le parc partagé avec Bricoloc n’est pas configuré (<code>BRICOLOC_API_KEY</code> dans{' '}
          <code>apps/api/.env</code>).
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Matériel"
        sub={
          stock
            ? `${products.reduce((a, p) => a + p.available, 0)} au dépôt · ${products.reduce((a, p) => a + p.onSite, 0)} sur chantier`
            : 'Parc partagé avec Bricoloc'
        }
      />

      {/* Barre d'action */}
      <div className="card card-pad" style={{ marginBottom: '1rem', display: 'grid', gap: 12 }}>
        <div className="field">
          <label>Chantier de travail — les outils sortent vers celui-ci</label>
          <select className="select" value={worksiteId} onChange={(e) => setWorksiteId(e.target.value)}>
            <option value="">— choisir un chantier —</option>
            {worksites.map((w) => (
              <option key={w.id} value={w.id}>
                {w.ref} — {w.title}
                {w.city ? ` (${w.city})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
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
        </div>
      </div>

      {toast && (
        <div className={`badge ${toast.ok ? 'ok' : 'crit'}`} style={{ marginBottom: 12 }}>
          {toast.text}
        </div>
      )}

      {loading && !stock && <div className="empty">Chargement du parc…</div>}

      {/* Grille d'outils */}
      <div
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        }}
      >
        {filtered.map((p) => (
          <button
            key={p.id}
            onClick={() => setOpenId(p.id)}
            className="card"
            style={{
              padding: 0,
              textAlign: 'left',
              cursor: 'pointer',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ aspectRatio: '4 / 3', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {p.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              ) : (
                <span className="muted" style={{ fontSize: '0.75rem' }}>
                  pas de photo
                </span>
              )}
            </div>
            <div style={{ padding: '0.6rem 0.7rem', display: 'grid', gap: 4 }}>
              <div style={{ fontWeight: 650, fontSize: '0.9rem', lineHeight: 1.25 }}>{p.name}</div>
              {p.brand && <div className="muted" style={{ fontSize: '0.75rem' }}>{p.brand}</div>}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                <span className={`badge plain ${p.available > 0 ? 'ok' : ''}`} style={{ fontSize: '0.68rem' }}>
                  {p.available} dispo
                </span>
                {p.onSite > 0 && (
                  <span className="badge plain warn" style={{ fontSize: '0.68rem' }}>
                    {p.onSite} chantier
                  </span>
                )}
                {p.rented > 0 && (
                  <span className="badge plain" style={{ fontSize: '0.68rem' }}>
                    {p.rented} loué
                  </span>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>

      {!loading && filtered.length === 0 && <div className="empty">Aucun outil.</div>}

      {/* Fiche outil */}
      {open && (
        <div className="modal-scrim" onClick={() => setOpenId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="modal-head">
              <b>{open.name}</b>
              <button className="btn" onClick={() => setOpenId(null)}>
                Fermer
              </button>
            </div>
            <div className="modal-body" style={{ display: 'grid', gap: 14 }}>
              <div style={{ display: 'flex', gap: 14 }}>
                {open.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={open.image}
                    alt=""
                    style={{ width: 120, height: 90, objectFit: 'contain', background: 'var(--surface-2)', borderRadius: 8, flexShrink: 0 }}
                  />
                )}
                <div className="muted" style={{ fontSize: '0.85rem' }}>
                  {open.brand ? `${open.brand} · ` : ''}
                  {open.category ?? ''}
                  <br />
                  {open.total} exemplaire{open.total > 1 ? 's' : ''} · {open.available} au dépôt
                </div>
              </div>

              {!worksiteId && (
                <div className="badge warn">
                  Choisissez un « chantier de travail » en haut pour pouvoir sortir un outil.
                </div>
              )}

              <div style={{ display: 'grid', gap: 8 }}>
                {open.units.map((u) => (
                  <div
                    key={u.assetTag}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '0.5rem 0.6rem',
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="mono" style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                        {u.assetTag}
                      </div>
                      <div className="muted" style={{ fontSize: '0.75rem' }}>
                        {unitLoc(u)}
                      </div>
                    </div>
                    {u.state === 'AVAILABLE' && (
                      <button
                        className="btn primary"
                        disabled={busy || !worksiteId}
                        onClick={() => move(u.assetTag, 'out')}
                      >
                        Sortir → {wsLabel?.ref ?? 'chantier'}
                      </button>
                    )}
                    {u.state === 'ON_SITE' && (
                      <button className="btn" disabled={busy} onClick={() => move(u.assetTag, 'in')}>
                        Rentrer au dépôt
                      </button>
                    )}
                    {u.state !== 'AVAILABLE' && u.state !== 'ON_SITE' && (
                      <span className="muted" style={{ fontSize: '0.75rem' }}>
                        {STATE_LABEL[u.state] ?? u.state}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
