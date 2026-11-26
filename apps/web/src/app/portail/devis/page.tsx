'use client';
import { dateLocale } from '@/lib/ui-language';
import Link from 'next/link';
import { useState } from 'react';
import { FileText } from 'lucide-react';
import { portalDownload, usePortalApi, usePortalGuard } from '@/lib/portal';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/States';
import { PortalShell } from '../PortalShell';

interface Quote {
  id: string; number: string; title: string | null; status: string; hasPdf: boolean;
  totalHt: number; totalTtc: number; issuedOn: string | null; dueOn: string | null;
  worksiteId: string | null; worksiteRef: string | null; building: string | null;
}
const fdate = (s: string | null) => (s ? new Date(s).toLocaleDateString(dateLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
const eur = (n: number) => `${n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const TONE: Record<string, string> = { sent: 'gold', accepted: 'ok', declined: 'crit', expired: 'grey' };
const LABEL: Record<string, string> = { sent: 'À valider', accepted: 'Accepté', declined: 'Décliné', expired: 'Expiré', draft: 'Brouillon' };

export default function PortalQuotes() {
  const { me, loading } = usePortalGuard();
  const { data, error, reload } = usePortalApi<{ items: Quote[] }>(me && me.access !== 'limited' ? '/quotes' : null);
  const all = data?.items ?? null;
  // onglets : ce qui attend le client d'abord, puis l'historique
  const [tab, setTab] = useState<'todo' | 'accepted' | 'other' | 'all' | null>(null);

  if (loading || !me) return null;
  if (me.access === 'limited') {
    return <PortalShell title="Devis"><EmptyState icon={FileText} title="Devis gérés par votre syndic" text="Les devis de votre immeuble sont validés par le syndic. Vous suivez l’avancement des interventions depuis « Interventions »." action={<Link href="/portail/interventions" className="btn primary">Voir les interventions</Link>} /></PortalShell>;
  }
  const toValidate = (all ?? []).filter((q) => q.status === 'sent').length;
  const current = tab ?? (toValidate > 0 ? 'todo' : 'all');
  const TABS: [typeof current, string, (q: Quote) => boolean][] = [
    ['todo', 'À valider', (q) => q.status === 'sent'],
    ['accepted', 'Acceptés', (q) => q.status === 'accepted'],
    ['other', 'Refusés / expirés', (q) => q.status === 'declined' || q.status === 'expired'],
    ['all', 'Tous', () => true],
  ];
  const items = all ? all.filter(TABS.find((t) => t[0] === current)![2]) : null;

  async function openPdf(id: string) {
    try { await portalDownload(`/documents/${id}/pdf`); } catch { /* */ }
  }

  return (
    <PortalShell title="Devis" subtitle={toValidate > 0 ? `${toValidate} en attente de votre validation` : 'Tous vos devis'}>
      {all && all.length > 0 && (
        <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          {TABS.map(([k, label, f]) => {
            const n = all.filter(f).length;
            return <button key={k} className={current === k ? 'p-btn-primary' : 'p-btn-line'} style={{ padding: '0.35rem 0.8rem', fontSize: '0.82rem' }} onClick={() => setTab(k)}>{label} ({n})</button>;
          })}
        </div>
      )}
      {error ? <ErrorState message={error} onRetry={reload} /> : !items ? <SkeletonRows rows={4} height={96} /> : items.length === 0 && all && all.length > 0 ? <EmptyState icon={FileText} title={current === 'todo' ? 'Aucun devis à valider' : 'Aucun devis ici'} text={current === 'todo' ? 'Tout est à jour : aucun devis n’attend votre décision.' : 'Rien dans cette catégorie.'} /> : items.length === 0 ? <EmptyState icon={FileText} title="Aucun devis pour l’instant" text="Dès que JJD Consult vous envoie un devis, il apparaît ici et vous pouvez le valider ou le décliner." action={<Link href="/portail/demande" className="btn primary">Nouvelle demande</Link>} secondary={<Link href="/portail/interventions" className="btn">Voir les interventions</Link>} /> : (
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
