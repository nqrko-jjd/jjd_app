'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, Money, formatDateBE } from '@/lib/ui';
import { DocStatusBadge, DOC_KIND_LABEL } from '@/lib/doc-ui';

interface Row {
  id: string; kind: string; number: string | null; draftRef: string | null; status: string;
  title: string | null; issuedOn: string | null; dueOn: string | null; totalTtc: number; paidAmount: number;
  originalPdf: string | null;
  worksite: { ref: string } | null; contact: { name: string } | null;
}

const TABS: { key: string; label: string; kind?: string; scope?: string }[] = [
  { key: 'quotes', label: 'Devis', kind: 'quote' },
  { key: 'invoices', label: 'Factures', kind: 'invoice' },
  { key: 'credit', label: 'Notes de crédit', kind: 'credit_note' },
  { key: 'drafts', label: 'Brouillons', scope: 'drafts' },
];

export default function DocumentsPage() {
  const router = useRouter();
  const [tab, setTab] = useState('quotes');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const active = TABS.find((t) => t.key === tab)!;
  const params = new URLSearchParams();
  if (active.kind) params.set('kind', active.kind);
  if (active.scope) params.set('scope', active.scope);
  if (q) params.set('q', q);
  const { data, loading } = useApi<{ items: Row[] }>(`/api/documents?${params}`);

  async function create(kind: string) {
    setBusy(true);
    try {
      const { document } = await api<{ document: { id: string } }>('/api/documents', { method: 'POST', body: { kind } });
      router.push(`/documents/${document.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead
        title="Devis & factures"
        sub="Création, émission, suivi des paiements"
        action={
          <div className="row">
            <button className="btn" disabled={busy} onClick={() => create('quote')}>+ Devis</button>
            <button className="btn primary" disabled={busy} onClick={() => create('invoice')}>+ Facture</button>
          </div>
        }
      />

      <div className="row" style={{ marginBottom: '1rem', gap: '0.4rem' }}>
        {TABS.map((t) => (
          <button key={t.key} className={`btn${tab === t.key ? ' primary' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
        <input
          className="input"
          style={{ maxWidth: 240, marginLeft: 'auto' }}
          placeholder="N°, client, chantier…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {loading && <div className="empty">Chargement…</div>}
      {data && data.items.length === 0 && <div className="empty">Aucun document.</div>}
      {data && data.items.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>N°</th><th>Objet</th><th>Client</th><th>Chantier</th>
                <th>Émis</th><th>Échéance</th><th>Statut</th><th style={{ textAlign: 'right' }}>TTC</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((d) => (
                <tr key={d.id}>
                  <td className="mono">
                    <Link href={`/documents/${d.id}`}>{d.number ?? d.draftRef ?? '—'}</Link>
                    {d.originalPdf && <span title="PDF d’origine disponible" style={{ marginLeft: 6 }}>📄</span>}
                    {!d.number && <span className="badge plain" style={{ marginLeft: 6 }}>{DOC_KIND_LABEL[d.kind]}</span>}
                  </td>
                  <td>{d.title ?? '—'}</td>
                  <td>{d.contact?.name ?? '—'}</td>
                  <td className="mono">{d.worksite?.ref ?? '—'}</td>
                  <td className="tnum">{d.issuedOn ? formatDateBE(d.issuedOn) : '—'}</td>
                  <td className="tnum">{d.dueOn ? formatDateBE(d.dueOn) : '—'}</td>
                  <td><DocStatusBadge status={d.status} /></td>
                  <td style={{ textAlign: 'right' }}><Money value={d.totalTtc} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
