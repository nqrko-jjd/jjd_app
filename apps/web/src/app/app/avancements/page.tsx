'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { PageHead, formatEur, formatDateBE } from '@/lib/ui';
import { SkeletonRows, ErrorState, EmptyState } from '@/components/States';
import { ListChecks } from 'lucide-react';

interface Row {
  id: string; number: string; status: 'draft' | 'validated'; createdAt: string; totalHt: number;
  quote: { id: string; number: string | null; draftRef: string | null; title: string | null; worksite: { id: string; ref: string; title: string } | null; contact: { name: string } | null };
}

/** États d'avancement pas encore facturés, tous devis confondus. */
export default function ProgressListPage() {
  const router = useRouter();
  const { data, error, loading, reload } = useApi<{ items: Row[] }>('/api/progress');
  return (
    <>
      <PageHead eyebrow="Facturation" title="États d’avancement non facturés" sub={data ? `${data.items.length} état${data.items.length > 1 ? 's' : ''} à facturer` : 'Facturation à l’avancement, ligne par ligne'} />
      {loading && !data && <SkeletonRows />}
      {error && !loading && <ErrorState message={error} onRetry={reload} />}
      {data && data.items.length === 0 && <EmptyState icon={ListChecks} title="Rien à facturer à l’avancement" text="Les états d’avancement se créent depuis un devis émis : menu Actions → États d’avancement." />}
      {data && data.items.length > 0 && (
        <div className="panel doc-list">
          {data.items.map((r) => (
            <div key={r.id} className="doc-item" onClick={() => router.push(`/app/documents/${r.quote.id}/avancement`)} style={{ cursor: 'pointer' }}>
              <div className="doc-item-body">
                <div className="doc-item-top" style={{ flexWrap: 'wrap' }}>
                  <Link href={`/app/documents/${r.quote.id}/avancement`} className="mono doc-item-num">{r.number}</Link>
                  <span className="chip">Devis {r.quote.number ?? r.quote.draftRef}</span>
                  {r.quote.worksite && <span className="chip">🏗 {r.quote.worksite.ref}</span>}
                  <span className={`badge ${r.status === 'validated' ? 'ok' : 'plain'}`}>{r.status === 'validated' ? 'Validé' : 'Brouillon'}</span>
                  <span className="doc-item-amount" style={{ marginLeft: 'auto' }}>{formatEur(r.totalHt)} HT</span>
                </div>
                <div className="doc-item-title">{r.quote.title ?? 'Devis'}</div>
                <div className="doc-item-meta"><span>{r.quote.contact?.name ?? '—'}</span><span>Créé le {formatDateBE(r.createdAt)}</span></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
