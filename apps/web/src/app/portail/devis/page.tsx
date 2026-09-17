'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { portalApi, portalBlobUrl, usePortalGuard } from '@/lib/portal';
import { PortalShell } from '../PortalShell';

interface Quote {
  id: string; number: string; title: string | null; status: string; hasPdf: boolean;
  totalHt: number; totalTtc: number; issuedOn: string | null; dueOn: string | null;
  worksiteId: string | null; worksiteRef: string | null; building: string | null;
}
const fdate = (s: string | null) => (s ? new Date(s).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
const eur = (n: number) => `${n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const TONE: Record<string, string> = { sent: 'gold', accepted: 'ok', declined: 'crit', expired: 'grey' };
const LABEL: Record<string, string> = { sent: 'À valider', accepted: 'Accepté', declined: 'Décliné', expired: 'Expiré', draft: 'Brouillon' };

export default function PortalQuotes() {
  const { me, loading } = usePortalGuard();
  const [items, setItems] = useState<Quote[] | null>(null);

  useEffect(() => {
    if (me) portalApi<{ items: Quote[] }>('/quotes').then((r) => setItems(r.items)).catch(() => {});
  }, [me]);

  if (loading || !me) return null;
  if (me.access === 'limited') {
    return <PortalShell title="Devis"><div className="p-empty">Les devis sont gérés par le syndic de votre immeuble.</div></PortalShell>;
  }
  const toValidate = (items ?? []).filter((q) => q.status === 'sent').length;

  async function openPdf(id: string) {
    try { window.open(await portalBlobUrl(`/documents/${id}/pdf`), '_blank'); } catch { /* */ }
  }

  return (
    <PortalShell title="Devis" subtitle={toValidate > 0 ? `${toValidate} en attente de votre validation` : 'Tous vos devis'}>
      {!items ? <div className="p-empty">Chargement…</div> : items.length === 0 ? <div className="p-empty">Aucun devis.</div> : (
        <div style={{ display: 'grid', gap: '0.8rem' }}>
          {items.map((q) => (
            <div key={q.id} className="p-card p-card-pad">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.6rem' }}>
                <span className="p-note" style={{ fontFamily: 'IBM Plex Mono, monospace' }}>{q.number}</span>
                <span className={`p-tag ${TONE[q.status] ?? 'grey'}`}>{LABEL[q.status] ?? q.status}</span>
              </div>
              <div style={{ marginTop: '0.35rem', fontWeight: 700 }}>
                {q.worksiteId ? <Link href={`/portail/chantier/${q.worksiteId}`}>{q.title ?? 'Devis'}</Link> : (q.title ?? 'Devis')}
              </div>
              <div className="p-note" style={{ marginTop: '0.2rem' }}>
                {q.building ?? q.worksiteRef ?? '—'} · reçu le {fdate(q.issuedOn)}
              </div>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: '0.7rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <strong>{eur(q.totalHt)} HT</strong>
                <div className="row" style={{ gap: '0.5rem' }}>
                  {q.hasPdf && <button className="p-btn-line" style={{ padding: '0.3rem 0.6rem', fontSize: '0.78rem' }} onClick={() => openPdf(q.id)}>PDF</button>}
                  {q.status === 'sent' && q.worksiteId && <Link href={`/portail/chantier/${q.worksiteId}`} className="p-btn-primary p-btn-gold" style={{ padding: '0.3rem 0.7rem', fontSize: '0.78rem' }}>Valider</Link>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </PortalShell>
  );
}
