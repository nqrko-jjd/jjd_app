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
  const toValidate = (items ?? []).filter((q) => q.status === 'sent').length;

  async function openPdf(id: string) {
    try { window.open(await portalBlobUrl(`/documents/${id}/pdf`), '_blank'); } catch { /* */ }
  }

  return (
    <PortalShell title="Devis" subtitle={toValidate > 0 ? `${toValidate} en attente de votre validation` : 'Tous vos devis'}>
      {!items ? <div className="p-empty">Chargement…</div> : items.length === 0 ? <div className="p-empty">Aucun devis.</div> : (
        <div className="p-panel" style={{ padding: '0.4rem 1rem' }}>
          <table className="p-tbl">
            <thead><tr><th>N°</th><th>Objet</th><th>Immeuble</th><th>Reçu</th><th style={{ textAlign: 'right' }}>Montant HT</th><th>Statut</th><th></th></tr></thead>
            <tbody>
              {items.map((q) => (
                <tr key={q.id}>
                  <td className="p-note" style={{ fontFamily: 'IBM Plex Mono, monospace' }}>{q.number}</td>
                  <td>{q.worksiteId ? <Link href={`/portail/chantier/${q.worksiteId}`} style={{ fontWeight: 600 }}>{q.title ?? 'Devis'}</Link> : (q.title ?? 'Devis')}</td>
                  <td className="p-note">{q.building ?? q.worksiteRef ?? '—'}</td>
                  <td className="p-note">{fdate(q.issuedOn)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{eur(q.totalHt)}</td>
                  <td><span className={`p-tag ${TONE[q.status] ?? 'grey'}`}>{LABEL[q.status] ?? q.status}</span></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {q.hasPdf && <button className="p-btn-line" style={{ padding: '0.3rem 0.6rem', fontSize: '0.78rem' }} onClick={() => openPdf(q.id)}>PDF</button>}
                    {q.status === 'sent' && q.worksiteId && <Link href={`/portail/chantier/${q.worksiteId}`} className="p-btn-primary p-btn-gold" style={{ padding: '0.3rem 0.7rem', fontSize: '0.78rem', marginLeft: 6 }}>Valider</Link>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PortalShell>
  );
}
