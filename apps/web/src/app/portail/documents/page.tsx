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

  async function openPdf(id: string) {
    try { window.open(await portalBlobUrl(`/documents/${id}/pdf`), '_blank'); } catch { /* */ }
  }

  return (
    <PortalShell title="Documents" subtitle="Devis, factures et notes de crédit">
      <div className="p-filters">
        {TABS.map((t) => (
          <button key={t.k} className={t.k === kind ? 'p-btn-primary' : 'p-btn-line'} onClick={() => setKind(t.k)}>{t.label}</button>
        ))}
      </div>
      {!items ? <div className="p-empty">Chargement…</div> : items.length === 0 ? <div className="p-empty">Aucun document.</div> : (
        <div className="p-docs" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {items.map((d) => (
            <div key={d.id} className="p-doc">
              <span className="ico">▤</span>
              <div className="meta">
                <b>{d.kindLabel} {d.number}</b>
                <span>{d.building ?? ''} · {fdate(d.issuedOn)} · {eur(d.totalTtc)}</span>
              </div>
              {d.worksiteId && <Link href={`/portail/chantier/${d.worksiteId}`} className="p-note" style={{ fontSize: '0.75rem' }}>voir →</Link>}
              {d.hasPdf && <button onClick={() => openPdf(d.id)} aria-label="Télécharger">⤓</button>}
            </div>
          ))}
        </div>
      )}
    </PortalShell>
  );
}
