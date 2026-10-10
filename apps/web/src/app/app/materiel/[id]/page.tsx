'use client';
import { tr } from '@/lib/ui-language';
import { Wrench, Boxes, Warehouse, Building2, Truck } from 'lucide-react';
import { SkeletonRows, EmptyState, ErrorState } from '@/components/States';
import { use, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { formatDateBE, Kpi } from '@/lib/ui';
import { WorksitePicker, LocationPicker } from '@/components/MaterielPickers';

interface Unit {
  assetTag: string; state: string; storageLocation: string | null;
  chantier: { name: string; ref: string | null; since: string } | null;
}
interface Product {
  id: string; slug: string; name: string; kind: string; brand: string | null; model: string | null;
  image: string | null; category: string | null; shortDescription: string | null; description: string | null;
  specs: Record<string, string>; manualUrl: string | null; documents: { label: string; url: string }[];
  total: number; available: number; onSite: number; rented: number; units: Unit[];
}
type Worksite = { id: string; ref: string; title: string; city: string | null; client: { name: string } | null };

const STATE_LABEL: Record<string, string> = {
  AVAILABLE: 'Au dépôt', ON_SITE: 'Sur chantier', RENTED: 'Loué (client Bricoloc)',
  MAINTENANCE: 'En entretien', DAMAGED: 'Endommagé', RETIRED: 'Réformé',
};

function unitLoc(u: Unit): string {
  if (u.chantier) return `${u.chantier.name} · depuis le ${formatDateBE(u.chantier.since)}`;
  if (u.state === 'AVAILABLE') return u.storageLocation ? `Dépôt Bricoloc · ${u.storageLocation}` : 'Dépôt Bricoloc';
  return STATE_LABEL[u.state] ?? u.state;
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="info-cell">
      <div className="k">{label}</div>
      <div className="v">{value}</div>
    </div>
  );
}

export default function MaterielDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: stock, reload, loading, error } = useApi<{ products: Product[] }>('/api/materiel/stock');
  const { data: wsData } = useApi<{ items: Worksite[] }>('/api/materiel/worksites');
  const worksites = wsData?.items ?? [];
  const p = stock?.products.find((x) => x.id === id) ?? null;

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [checkoutTarget, setCheckoutTarget] = useState<string | null>(null);
  const [returnTarget, setReturnTarget] = useState<string | null>(null);

  const knownLocations = (() => {
    const set = new Set<string>();
    for (const u of p?.units ?? []) if (u.storageLocation) set.add(u.storageLocation);
    return [...set].sort().slice(0, 12);
  })();

  async function checkout(assetTag: string, w: Worksite) {
    setBusy(true);
    setToast(null);
    try {
      await api('/api/materiel/loans', { method: 'POST', body: { code: assetTag, worksiteId: w.id } });
      setToast({ text: `${assetTag} → ${w.ref}`, ok: true });
      setCheckoutTarget(null);
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
      setReturnTarget(null);
      await reload();
    } catch (e) {
      setToast({ text: e instanceof ApiError ? e.message : 'Échec', ok: false });
    } finally {
      setBusy(false);
    }
  }

  if (loading && !stock) return <SkeletonRows />;
  if (!p) {
    return error
      ? <ErrorState message={error} onRetry={reload} />
      : <EmptyState icon={Wrench} title="Outil introuvable" text="Cet outil n’existe plus ou a été retiré du parc. Retournez à la liste des outils." action={<Link href="/app/materiel" className="btn primary">Retour aux outils</Link>} />;
  }

  const specs = Object.entries(p.specs ?? {});
  const docs = p.documents ?? [];

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.9rem', flexWrap: 'wrap' }}>
        <Link href="/app/materiel" className="btn ghost">← Outils & consommables</Link>
      </div>

      <div className="detail-hero">
        <div className="eyebrow">{p.category ?? 'Outil'}</div>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'nowrap', gap: '1rem' }}>
          <h1>{p.name}</h1>
          <span className={`badge ${p.available > 0 ? 'ok' : 'crit'}`}>{p.available > 0 ? 'Disponible' : 'Indisponible'}</span>
        </div>
        <div className="sub">{[p.brand, p.model].filter(Boolean).join(' ') || 'Parc Bricoloc'}</div>
      </div>

      <div className="card card-pad tool-summary" style={{ marginBottom: '1.4rem' }}>
        <div className="tool-summary-media">
          {p.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : <Wrench size={28} strokeWidth={1.6} className="muted" />}
        </div>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          {(p.shortDescription || p.description) && <p style={{ margin: '0 0 0.8rem' }}>{p.shortDescription || p.description}</p>}
          {(p.manualUrl || docs.length > 0) && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {p.manualUrl && <a href={p.manualUrl} target="_blank" rel="noreferrer" className="btn" style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem' }}>📄 Fiche technique</a>}
              {docs.map((d) => (
                <a key={d.url} href={d.url} target="_blank" rel="noreferrer" className="btn" style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem' }}>{d.label}</a>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="kpis" style={{ marginBottom: '1.4rem' }}>
        <Kpi ic={Boxes} label="Exemplaires" value={p.total} sub="Toutes situations" hero />
        <Kpi ic={Warehouse} label="Au dépôt" value={p.available} sub="Disponibles maintenant" />
        <Kpi ic={Building2} label={tr("Sur chantier")} value={p.onSite} sub="En cours d'utilisation" />
        <Kpi ic={Truck} label="Loué" value={p.rented} sub="Client Bricoloc" />
      </div>

      <div className="info-grid" style={{ marginBottom: '1.4rem' }}>
        <Info label={tr("Catégorie")} value={p.category ?? '—'} />
        <Info label="Marque / modèle" value={[p.brand, p.model].filter(Boolean).join(' ') || '—'} />
      </div>

      {specs.length > 0 && (
        <section className="card card-pad" style={{ marginBottom: '1.4rem' }}>
          <h2 style={{ marginBottom: '0.6rem' }}>Caractéristiques</h2>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem' }}>
            <tbody>
              {specs.map(([k, v]) => (
                <tr key={k}>
                  <td className="muted" style={{ padding: '3px 8px 3px 0', whiteSpace: 'nowrap' }}>{k}</td>
                  <td style={{ padding: '3px 0' }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {toast && <div className={`badge ${toast.ok ? 'ok' : 'crit'}`} style={{ marginBottom: 12 }}>{toast.text}</div>}

      <section>
        <h2 style={{ marginBottom: '0.7rem' }}>Exemplaires ({p.units.length})</h2>
        <div className="tool-units">
          {p.units.map((u) => (
            <article className="tool-unit" key={u.assetTag}>
              <header><span className="mono">{u.assetTag}</span><span className={`badge ${u.state === 'AVAILABLE' ? 'ok' : u.state === 'ON_SITE' ? 'primary' : 'warn'}`}>{STATE_LABEL[u.state] ?? u.state}</span></header>
              <div className="sub">{unitLoc(u)}</div>
              {u.state === 'AVAILABLE' && <button className="btn primary" disabled={busy} onClick={() => setCheckoutTarget(u.assetTag)}>Affecter à un chantier</button>}
              {u.state === 'ON_SITE' && <button className="btn" disabled={busy} onClick={() => setReturnTarget(u.assetTag)}>Retour au dépôt</button>}
            </article>
          ))}
        </div>
        {p.units.map((u) => (
          <div key={`pickers-${u.assetTag}`}>
            {checkoutTarget === u.assetTag && (
              <div style={{ marginTop: 10 }}>
                <WorksitePicker
                  worksites={worksites}
                  label={`${u.assetTag} → pour quel chantier ?`}
                  onPick={(w) => checkout(u.assetTag, w)}
                  onCancel={() => setCheckoutTarget(null)}
                />
              </div>
            )}
            {returnTarget === u.assetTag && (
              <div style={{ marginTop: 10 }}>
                <LocationPicker
                  suggestions={knownLocations}
                  label={`${u.assetTag} → dans quelle zone est-il remis ?`}
                  onConfirm={(loc) => returnUnit(u.assetTag, loc)}
                  onCancel={() => setReturnTarget(null)}
                />
              </div>
            )}
          </div>
        ))}
      </section>
    </>
  );
}
