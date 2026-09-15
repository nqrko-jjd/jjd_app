'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { portalApi, portalBlobUrl, usePortalGuard } from '@/lib/portal';
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

export default function PortalDocuments() {
  const { me, loading } = usePortalGuard();
  const [items, setItems] = useState<Doc[] | null>(null);
  const [kind, setKind] = useState('');

  useEffect(() => {
    if (me) portalApi<{ items: Doc[] }>(`/documents?${kind ? `kind=${kind}` : ''}`).then((r) => setItems(r.items)).catch(() => {});
  }, [me, kind]);

  if (loading || !me) return null;
  if (me.access === 'limited') {
    return <PortalShell title="Documents"><div className="p-empty">Les devis et factures sont gérés par le syndic de votre immeuble.</div></PortalShell>;
  }

  async function openPdf(id: string) {
    try { window.open(await portalBlobUrl(`/documents/${id}/pdf`), '_blank'); } catch { /* */ }
  }

  const groups = new Map<string, Doc[]>();
  for (const doc of items ?? []) {
    const key = doc.building ?? 'Autres';
    groups.set(key, [...(groups.get(key) ?? []), doc]);
  }

  return (
    <PortalShell title="Documents" subtitle="Devis, factures et notes de crédit">
      <div className="p-seg">
        {TABS.map((t) => (
          <button key={t.k || 'all'} className={t.k === kind ? 'on' : ''} onClick={() => setKind(t.k)}>{t.label}</button>
        ))}
      </div>
      {!items ? <div className="p-empty">Chargement…</div> : items.length === 0 ? <div className="p-empty">Aucun document.</div> : (
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
