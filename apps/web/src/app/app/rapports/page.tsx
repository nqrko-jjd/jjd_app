'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead } from '@/lib/ui';
import { REPORT_REVIEW_STATUS_LABEL, type ReportReviewStatus } from '@jjd/shared';

interface ReportRow {
  id: string;
  authorName: string;
  date: string;
  workDone: string | null;
  notes: string | null;
  clientName: string | null;
  reviewStatus: ReportReviewStatus;
  reviewNote: string | null;
  worksite: { id: string; ref: string; title: string };
}

const TABS: { key: 'all' | ReportReviewStatus; label: string }[] = [
  { key: 'all', label: 'Tous' },
  { key: 'pending', label: 'À valider' },
  { key: 'approved', label: 'Validé' },
  { key: 'needs_info', label: 'À compléter' },
];

const TONE: Record<ReportReviewStatus, string> = { pending: 'warn', approved: 'ok', needs_info: 'crit' };

function ReviewCard({ r, reload }: { r: ReportRow; reload: () => void }) {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function approve() {
    setBusy(true);
    try {
      await api(`/api/reports/${r.id}/review`, { method: 'POST', body: { decision: 'approved' } });
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function askInfo() {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await api(`/api/reports/${r.id}/review`, { method: 'POST', body: { decision: 'needs_info', note } });
      setAsking(false);
      setNote('');
      await reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card-pad" style={{ marginBottom: '0.7rem' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700 }}>{r.worksite.ref} · {r.authorName}</div>
          <div className="muted" style={{ fontSize: '0.82rem' }}>
            {new Date(r.date).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' })} · {new Date(r.date).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
        <span className={`badge ${TONE[r.reviewStatus]}`}>{REPORT_REVIEW_STATUS_LABEL[r.reviewStatus]}</span>
      </div>

      {r.workDone && <p style={{ margin: '0.6rem 0 0' }}>{r.workDone}</p>}
      {r.reviewStatus === 'needs_info' && r.reviewNote && (
        <div className="muted" style={{ marginTop: '0.5rem', fontStyle: 'italic' }}>« {r.reviewNote} »</div>
      )}

      <div className="row" style={{ gap: '0.5rem', marginTop: '0.7rem' }}>
        <Link href={`/app/chantiers/${r.worksite.id}`} className="hint">{r.worksite.title} →</Link>
      </div>

      {r.reviewStatus !== 'approved' && (
        <div className="row" style={{ gap: '0.5rem', marginTop: '0.7rem' }}>
          <button type="button" className="btn primary" disabled={busy} onClick={approve}>Valider le rapport</button>
          <button type="button" className="btn" disabled={busy} onClick={() => setAsking((a) => !a)}>Demander un complément</button>
        </div>
      )}

      {asking && (
        <div style={{ marginTop: '0.7rem' }}>
          <textarea
            className="input" rows={2} placeholder="Ce qui manque (photos, précisions…)"
            value={note} onChange={(e) => setNote(e.target.value)}
          />
          <div className="row" style={{ gap: '0.5rem', marginTop: '0.5rem' }}>
            <button type="button" className="btn primary" disabled={busy || !note.trim()} onClick={askInfo}>Envoyer</button>
            <button type="button" className="btn ghost" onClick={() => setAsking(false)}>Annuler</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RapportsAValiderPage() {
  const [tab, setTab] = useState<'all' | ReportReviewStatus>('pending');
  const { data, reload } = useApi<{ items: ReportRow[] }>('/api/reports/review-queue');
  const items = useMemo(() => {
    const all = data?.items ?? [];
    return tab === 'all' ? all : all.filter((r) => r.reviewStatus === tab);
  }, [data, tab]);

  return (
    <>
      <PageHead eyebrow="Chef de chantier" title="Rapports d’intervention" sub="Vérifier, valider ou demander une précision." />

      <div className="row" style={{ gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`btn${tab === t.key ? ' primary' : ''}`}
            style={{ borderRadius: 999 }}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {data && items.length === 0 && <div className="card card-pad muted">Rien à afficher ici.</div>}
      {items.map((r) => <ReviewCard key={r.id} r={r} reload={reload} />)}
    </>
  );
}
