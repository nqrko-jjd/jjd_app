'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { api, apiBlobUrl, apiUpload } from '@/lib/api';
import { PageHead, Money, formatDateBE } from '@/lib/ui';
import { DocStatusBadge, DOC_KIND_LABEL } from '@/lib/doc-ui';
import { ContextMenu, useContextMenu, openActions, type MenuItem } from '@/components/ContextMenu';
import { PaginationBar } from '@/components/PaginationBar';
import { useSort, SortTh } from '@/lib/sort';
import { rowNav } from '@/lib/rowNav';
import { DOC_STATUS_LABEL } from '@jjd/shared';

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
  return (
    <Suspense fallback={<div className="empty">Chargement…</div>}>
      <DocumentsInner />
    </Suspense>
  );
}

const STATUS_BY_KIND: Record<string, string[]> = {
  quote: ['draft', 'sent', 'accepted', 'declined', 'expired'],
  invoice: ['draft', 'sent', 'partial', 'paid', 'overdue', 'credited'],
  credit_note: ['draft', 'sent', 'paid'],
};

function DocumentsInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const initialTab = TABS.find((t) => t.kind === sp.get('kind'))?.key ?? 'quotes';
  const [tab, setTab] = useState(initialTab);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(sp.get('statut') ?? '');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const active = TABS.find((t) => t.key === tab)!;

  // revient à la 1ère page à chaque changement de filtre/onglet
  useEffect(() => { setPage(1); }, [tab, status, q]);

  const params = new URLSearchParams();
  if (active.kind) params.set('kind', active.kind);
  if (active.scope) params.set('scope', active.scope);
  if (status && active.kind) params.set('status', status);
  if (q) params.set('q', q);
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  const { data, loading, reload } = useApi<{ items: Row[]; page: number; pageSize: number; totalPages: number; totalCount: number }>(`/api/documents?${params}`);
  const ctx = useContextMenu<Row>();
  const statusOptions = active.kind ? (STATUS_BY_KIND[active.kind] ?? []) : [];

  async function post(url: string, body: Record<string, unknown>, navigate = false) {
    const r = await api<{ document?: { id: string } }>(url, { method: 'POST', body });
    if (navigate && r.document) router.push(`/app/documents/${r.document.id}`);
    else reload();
  }

  function rowMenu(d: Row): MenuItem[] {
    const isQuote = d.kind === 'quote';
    const isInvoice = d.kind === 'invoice' || d.kind === 'deposit_invoice' || d.kind === 'credit_note';
    return [
      ...openActions(`/app/documents/${d.id}`, (h) => router.push(h)),
      'separator',
      { label: 'Dupliquer', onClick: () => post(`/api/documents/${d.id}/duplicate`, {}, true) },
      ...(isQuote ? [{ label: 'Convertir en facture', onClick: () => post(`/api/documents/${d.id}/convert`, {}, true) }] : []),
      ...(isQuote && d.status === 'sent'
        ? [
            { label: 'Marquer accepté', onClick: () => post(`/api/documents/${d.id}/status`, { status: 'accepted' }) },
            { label: 'Marquer refusé', onClick: () => post(`/api/documents/${d.id}/status`, { status: 'declined' }) },
          ]
        : []),
      ...(isInvoice && d.status !== 'paid'
        ? [{ label: 'Marquer payée', onClick: () => post(`/api/documents/${d.id}/mark-paid`, {}) }]
        : []),
      ...(d.status === 'draft'
        ? [
            'separator' as const,
            {
              label: 'Supprimer le brouillon',
              danger: true,
              onClick: async () => { await api(`/api/documents/${d.id}`, { method: 'DELETE' }); reload(); },
            },
          ]
        : []),
    ];
  }
  const sort = useSort<Row>(data?.items ?? [], {
    number: (d) => d.number ?? d.draftRef,
    title: (d) => d.title,
    contact: (d) => d.contact?.name,
    worksite: (d) => d.worksite?.ref,
    issuedOn: (d) => (d.issuedOn ? new Date(d.issuedOn) : null),
    dueOn: (d) => (d.dueOn ? new Date(d.dueOn) : null),
    status: (d) => DOC_STATUS_LABEL[d.status] ?? d.status,
    totalTtc: (d) => d.totalTtc,
  });

  async function create(kind: string) {
    setBusy(true);
    try {
      const { document } = await api<{ document: { id: string } }>('/api/documents', { method: 'POST', body: { kind } });
      router.push(`/app/documents/${document.id}`);
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File) {
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await apiUpload<{
        document: { id: string };
        extraction: {
          contactName: string | null; contactConfidence: 'vat' | 'name' | null;
          worksiteRef: string | null; totalTtc: number | null; textExtracted: boolean;
        };
      }>('/api/documents/import', fd);
      const ex = r.extraction;
      const lines: string[] = [];
      if (!ex.textExtracted) {
        lines.push('PDF sans texte lisible (scan/photo) — à compléter à la main.');
      } else {
        lines.push(ex.contactName ? `Client détecté : ${ex.contactName}${ex.contactConfidence === 'name' ? ' (à vérifier)' : ''}` : 'Client non détecté — à sélectionner sur la fiche.');
        if (ex.worksiteRef) lines.push(`Chantier détecté : ${ex.worksiteRef}`);
        lines.push(ex.totalTtc != null ? `Montant détecté : ${ex.totalTtc.toFixed(2)} € TTC (à vérifier)` : 'Montant non détecté — à saisir à la main.');
      }
      alert(lines.join('\n'));
      router.push(`/app/documents/${r.document.id}`);
    } catch (e) {
      alert(`Échec de l’import : ${(e as Error).message}`);
    } finally {
      setImporting(false);
    }
  }

  function toggleSelected(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    const rows = sort.rows;
    setSelected((s) => (s.size === rows.length ? new Set() : new Set(rows.map((d) => d.id))));
  }
  async function exportZip() {
    if (!selected.size) return;
    setExporting(true);
    try {
      const url = await apiBlobUrl(`/api/documents/export.zip?ids=${[...selected].join(',')}`);
      const a = document.createElement('a');
      a.href = url;
      a.download = `documents-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
    } catch (e) {
      alert(`Échec de l’export : ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      {ctx.menu && <ContextMenu x={ctx.menu.x} y={ctx.menu.y} items={rowMenu(ctx.menu.row)} onClose={ctx.close} />}
      <PageHead
        title="Devis & factures"
        sub={data ? `${data.totalCount} document${data.totalCount > 1 ? 's' : ''} · page ${data.page}/${data.totalPages} · clic droit pour les actions rapides` : 'Création, émission, suivi des paiements'}
        action={
          <div className="row">
            {selected.size > 0 && (
              <button className="btn" disabled={exporting} onClick={exportZip} title="PDF de chaque document sélectionné, dans un seul .zip">
                📦 Exporter {selected.size} document{selected.size > 1 ? 's' : ''} (zip)
              </button>
            )}
            <input
              ref={importInputRef}
              type="file"
              accept="application/pdf"
              hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ''; }}
            />
            <button className="btn" disabled={importing} onClick={() => importInputRef.current?.click()} title="Importer un PDF externe — client, chantier et montant pré-remplis quand c’est possible">
              {importing ? 'Import…' : '⬆ Importer un PDF'}
            </button>
            <button className="btn" disabled={busy} onClick={() => create('quote')}>+ Devis</button>
            <button className="btn primary" disabled={busy} onClick={() => create('invoice')}>+ Facture</button>
          </div>
        }
      />

      <div className="row" style={{ marginBottom: '1rem', gap: '0.4rem' }}>
        {TABS.map((t) => (
          <button key={t.key} className={`btn${tab === t.key ? ' primary' : ''}`} onClick={() => { setTab(t.key); setStatus(''); setSelected(new Set()); }}>
            {t.label}
          </button>
        ))}
        {statusOptions.length > 0 && (
          <select className="select" style={{ maxWidth: 180 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Tous les statuts</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>{DOC_STATUS_LABEL[s] ?? s}</option>
            ))}
          </select>
        )}
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
                <th style={{ width: 28 }}>
                  <input
                    type="checkbox"
                    checked={sort.rows.length > 0 && selected.size === sort.rows.length}
                    onChange={toggleAll}
                    aria-label="Tout sélectionner"
                  />
                </th>
                <SortTh k="number" sort={sort}>N°</SortTh>
                <SortTh k="title" sort={sort}>Objet</SortTh>
                <SortTh k="contact" sort={sort}>Client</SortTh>
                <SortTh k="worksite" sort={sort}>Chantier</SortTh>
                <SortTh k="issuedOn" sort={sort}>Émis</SortTh>
                <SortTh k="dueOn" sort={sort}>Échéance</SortTh>
                <SortTh k="status" sort={sort}>Statut</SortTh>
                <SortTh k="totalTtc" sort={sort} align="right">TTC</SortTh>
              </tr>
            </thead>
            <tbody>
              {sort.rows.map((d) => (
                <tr
                  key={d.id}
                  className={`row-link${ctx.menu?.row.id === d.id ? ' ctx-target' : ''}`}
                  onClick={rowNav(`/app/documents/${d.id}`, (h) => router.push(h))}
                  onContextMenu={(e) => ctx.open(e, d)}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleSelected(d.id)} aria-label="Sélectionner" />
                  </td>
                  <td className="mono">
                    <Link href={`/app/documents/${d.id}`}>{d.number ?? d.draftRef ?? '—'}</Link>
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

      {data && (
        <PaginationBar page={data.page} totalPages={data.totalPages} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />
      )}
    </>
  );
}
