'use client';
import { useState } from 'react';
import Link from 'next/link';
import { FileText } from 'lucide-react';
import { portalBlobUrl, usePortalApi, usePortalGuard } from '@/lib/portal';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/States';
import { PortalShell } from '../PortalShell';

interface Doc {
  id: string; kind: string; kindLabel: string; number: string; title: string | null;
  status: string; totalTtc: number; issuedOn: string | null; hasPdf: boolean;
  worksiteId: string | null; building: string | null;
}
const fdate = (s: string | null) => (s ? new Date(s).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
const eur = (n: number) => `${n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

const TABS = [
  { k: '', label: 'Tous' },
  { k: 'quote', label: 'Devis' },
  { k: 'invoice', label: 'Factures' },
  { k: 'credit_note', label: 'Notes de crédit' },
];

/** Même logique d'étiquette que la fiche chantier (chantier/[id]/page.tsx) — gardée identique
 *  pour que "payé"/"en retard"/"à payer" veuille dire la même chose partout dans le portail. */
function statusTag(doc: Doc) {
  if (doc.kind === 'quote') {
    return doc.status === 'accepted' ? <span className="p-tag ok">Accepté</span>
      : doc.status === 'declined' ? <span className="p-tag crit">Décliné</span>
      : null;
  }
  if (doc.kind === 'invoice') {
    return (
      <span className={`p-tag ${doc.status === 'paid' ? 'ok' : doc.status === 'overdue' ? 'crit' : 'gold'}`}>
        {doc.status === 'paid' ? 'Payée' : doc.status === 'overdue' ? 'En retard' : 'À payer'}
      </span>
    );
  }
  return null;
}

export default function PortalDocuments() {
  const { me, loading } = usePortalGuard();
  const [kind, setKind] = useState('');
  const [paidFilter, setPaidFilter] = useState<'' | 'paid' | 'unpaid'>('');
  const { data, error, reload } = usePortalApi<{ items: Doc[] }>(me && me.access !== 'limited' ? `/documents?${kind ? `kind=${kind}` : ''}` : null);
  const items = data?.items ?? null;

  const visible = (items ?? []).filter((doc) => {
    if (!paidFilter) return true;
    if (doc.kind !== 'invoice') return false;
    return paidFilter === 'paid' ? doc.status === 'paid' : doc.status !== 'paid';
  });

  if (loading || !me) return null;
  if (me.access === 'limited') {
    return <PortalShell title="Documents"><EmptyState icon={FileText} title="Documents gérés par votre syndic" text="Les devis et factures de votre immeuble sont adressés au syndic. Vous suivez l’avancement des interventions depuis « Interventions »." action={<Link href="/portail/interventions" className="btn primary">Voir les interventions</Link>} /></PortalShell>;
  }

  async function openPdf(id: string) {
    try { window.open(await portalBlobUrl(`/documents/${id}/pdf`), '_blank'); } catch { /* */ }
  }

  const groups = new Map<string, Doc[]>();
  for (const doc of visible) {
    const key = doc.building ?? 'Autres';
    groups.set(key, [...(groups.get(key) ?? []), doc]);
  }
  // n'a de sens que si des factures sont potentiellement visibles
  const showPaidFilter = kind === '' || kind === 'invoice';

  return (
    <PortalShell title="Documents" subtitle="Devis, factures et notes de crédit">
      <div className="p-seg">
        {TABS.map((t) => (
          <button key={t.k || 'all'} className={t.k === kind ? 'on' : ''} onClick={() => setKind(t.k)}>{t.label}</button>
        ))}
      </div>
      {showPaidFilter && (
        <div className="p-seg" style={{ marginTop: '0.5rem' }}>
          <button className={paidFilter === '' ? 'on' : ''} onClick={() => setPaidFilter('')}>Toutes les factures</button>
          <button className={paidFilter === 'unpaid' ? 'on' : ''} onClick={() => setPaidFilter('unpaid')}>Impayées</button>
          <button className={paidFilter === 'paid' ? 'on' : ''} onClick={() => setPaidFilter('paid')}>Payées</button>
        </div>
      )}
      {error ? <ErrorState message={error} onRetry={reload} /> : !items ? <SkeletonRows rows={5} height={72} /> : visible.length === 0 ? <EmptyState icon={FileText} title="Aucun document" text={paidFilter || kind ? 'Aucun document ne correspond à ce filtre. Élargissez la sélection pour retrouver vos devis et factures.' : 'Vos devis, factures et notes de crédit apparaissent ici dès qu’ils sont émis.'} action={paidFilter || kind ? <button type="button" className="btn primary" onClick={() => { setKind(''); setPaidFilter(''); }}>Afficher tous les documents</button> : <Link href="/portail/interventions" className="btn primary">Voir les interventions</Link>} /> : (
        <div style={{ display: 'grid', gap: '1rem' }}>
          {[...groups.entries()].map(([building, docs]) => (
            <div key={building} className="p-panel">
              <h2 style={{ marginBottom: '0.6rem' }}>{building}</h2>
              {docs.map((doc) => (
                <div key={doc.id} className="p-doc-row">
                  <span className="p-tag">{doc.kindLabel}</span>
                  <span className="n">{doc.number}</span>
                  <span className="p-note">{fdate(doc.issuedOn)}</span>
                  <span className="amt">{eur(doc.totalTtc)}</span>
                  {statusTag(doc)}
                  {doc.worksiteId && <Link href={`/portail/chantier/${doc.worksiteId}`} className="p-btn-line" style={{ padding: '0.3rem 0.6rem', fontSize: '0.78rem' }}>Voir</Link>}
                  {doc.hasPdf && <button className="p-btn-line" style={{ padding: '0.3rem 0.6rem', fontSize: '0.78rem' }} onClick={() => openPdf(doc.id)}>PDF</button>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </PortalShell>
  );
}
