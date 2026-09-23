'use client';
import { SkeletonRows, ErrorState, EmptyState } from '@/components/States';
import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, Money, formatDateBE } from '@/lib/ui';
import { DOC_KIND_LABEL } from '@/lib/doc-ui';

interface Match {
  id: string; docNumber: string | null; date: string | null; ht: number; ttc: number | null;
  paymentStatus: string | null; source: string | null;
}
interface GapItem {
  id: string; kind: string; number: string | null; issuedOn: string | null; totalTtc: number; status: string;
  worksiteRef: string | null; contactName: string | null; match: Match | null;
}

export default function GrandLivrePage() {
  const { data, loading, error, reload } = useApi<{ items: GapItem[]; missingCount: number; matchableCount: number }>('/api/finance/ledger-sync/gaps');
  const [busy, setBusy] = useState<string | null>(null);

  async function create(id: string) {
    setBusy(id);
    try { await api(`/api/finance/ledger-sync/gaps/${id}/create`, { method: 'POST' }); await reload(); }
    finally { setBusy(null); }
  }
  async function link(id: string, ledgerEntryId: string) {
    setBusy(id);
    try { await api(`/api/finance/ledger-sync/gaps/${id}/link`, { method: 'POST', body: { ledgerEntryId } }); await reload(); }
    finally { setBusy(null); }
  }
  async function createAllMissing() {
    if (!data) return;
    const missing = data.items.filter((i) => !i.match);
    if (!missing.length) return;
    if (!window.confirm(`Créer ${missing.length} écriture(s) manquante(s) dans le grand livre ?`)) return;
    setBusy('all');
    try {
      for (const it of missing) await api(`/api/finance/ledger-sync/gaps/${it.id}/create`, { method: 'POST' });
      await reload();
    } finally { setBusy(null); }
  }

  return (
    <>
      <PageHead
        eyebrow="Comptabilité"
        title="Rapprochement grand livre"
        sub={data ? `${data.items.length} document${data.items.length > 1 ? 's' : ''} émis sans écriture — ${data.matchableCount} à lier, ${data.missingCount} à créer` : undefined}
        action={<Link href="/app/finances" className="btn">← Finances</Link>}
      />
      <p className="muted" style={{ marginBottom: '1rem', maxWidth: '70ch' }}>
        Émettre ou encaisser une facture dans l’appli crée/actualise désormais automatiquement l’écriture
        correspondante dans le grand livre. Cette page liste les devis/factures/notes de crédit émis qui n’ont
        pas (encore) d’écriture — à corriger une fois ; tout ce qui est émis après reste synchronisé tout seul.
      </p>

      {loading && <SkeletonRows />}
      {error && !loading && <ErrorState message={error} onRetry={reload} />}
      {data && data.items.length === 0 && (
        <EmptyState
          icon={CheckCircle2}
          title="Rien à rattraper"
          text="Tous les devis/factures/notes de crédit émis ont une écriture correspondante dans le grand livre."
        />
      )}
      {data && data.items.length > 0 && (
        <>
          {data.missingCount > 0 && (
            <div className="row" style={{ marginBottom: '1rem' }}>
              <button className="btn primary" disabled={busy === 'all'} onClick={createAllMissing}>
                {busy === 'all' ? 'Création…' : `Créer les ${data.missingCount} écriture(s) manquante(s)`}
              </button>
            </div>
          )}
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Document</th><th>Client</th><th>Chantier</th><th>Émis</th>
                  <th style={{ textAlign: 'right' }}>TTC</th><th>Grand livre</th><th></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((it) => (
                  <tr key={it.id}>
                    <td className="mono">
                      <Link href={`/app/documents/${it.id}`}>{it.number}</Link>{' '}
                      <span className="badge plain">{DOC_KIND_LABEL[it.kind] ?? it.kind}</span>
                    </td>
                    <td>{it.contactName ?? '—'}</td>
                    <td className="mono">{it.worksiteRef ?? '—'}</td>
                    <td className="tnum">{formatDateBE(it.issuedOn)}</td>
                    <td style={{ textAlign: 'right' }}><Money value={it.totalTtc} /></td>
                    <td style={{ fontSize: '0.8rem' }}>
                      {it.match ? (
                        <span className="muted">
                          écriture existante ({it.match.source ?? '—'}) · <Money value={it.match.ttc} /> · {it.match.paymentStatus ?? '—'}
                        </span>
                      ) : <span className="muted">aucune</span>}
                    </td>
                    <td>
                      {it.match ? (
                        <button className="btn" disabled={busy === it.id} style={{ padding: '0.2rem 0.5rem', fontSize: '0.76rem' }} onClick={() => link(it.id, it.match!.id)}>
                          {busy === it.id ? '…' : 'Lier'}
                        </button>
                      ) : (
                        <button className="btn" disabled={busy === it.id} style={{ padding: '0.2rem 0.5rem', fontSize: '0.76rem' }} onClick={() => create(it.id)}>
                          {busy === it.id ? '…' : 'Créer'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
