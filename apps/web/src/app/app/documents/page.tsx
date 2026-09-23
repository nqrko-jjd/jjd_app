'use client';
import { SkeletonRows, ErrorState, EmptyState } from '@/components/States';
import { FileText } from 'lucide-react';
import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { api, apiBlobUrl, apiUpload } from '@/lib/api';
import { PageHead, Money, formatEur, formatDateBE } from '@/lib/ui';
import { DocStatusBadge, DOC_KIND_LABEL } from '@/lib/doc-ui';
import { ContextMenu, useContextMenu, openActions, type MenuItem } from '@/components/ContextMenu';
import { PaginationBar } from '@/components/PaginationBar';
import { rowNav } from '@/lib/rowNav';
import { DOC_STATUS_LABEL } from '@jjd/shared';

interface Row {
  id: string; kind: string; number: string | null; draftRef: string | null; status: string;
  title: string | null; issuedOn: string | null; dueOn: string | null; totalTtc: number; paidAmount: number;
  originalPdf: string | null; source: string | null;
  worksite: { ref: string } | null; contact: { name: string } | null;
}

const TABS: { key: string; label: string; kind?: string; scope?: string }[] = [
  { key: 'quotes', label: 'Devis', kind: 'quote' },
  { key: 'invoices', label: 'Factures', kind: 'invoice' },
  { key: 'credit', label: 'Notes de crédit', kind: 'credit_note' },
  { key: 'drafts', label: 'Brouillons', scope: 'drafts' },
];

const SORTS: { key: string; label: string }[] = [
  { key: '', label: 'Trier : plus récents' },
  { key: 'number_desc', label: 'N° (décroissant)' },
  { key: 'number_asc', label: 'N° (croissant)' },
  { key: 'contact_asc', label: 'Client (A→Z)' },
  { key: 'worksite_asc', label: 'Chantier (A→Z)' },
  { key: 'dueOn_asc', label: 'Échéance (proche d’abord)' },
  { key: 'totalTtc_desc', label: 'Montant (élevé d’abord)' },
  { key: 'totalTtc_asc', label: 'Montant (faible d’abord)' },
];

export default function DocumentsPage() {
  return (
    <Suspense fallback={<SkeletonRows />}>
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
  const [sort, setSort] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const active = TABS.find((t) => t.key === tab)!;

  // revient à la 1ère page à chaque changement de filtre/onglet
  useEffect(() => { setPage(1); }, [tab, status, q, sort]);

  const params = new URLSearchParams();
  if (active.kind) params.set('kind', active.kind);
  if (active.scope) params.set('scope', active.scope);
  if (status && active.kind) params.set('status', status);
  if (q) params.set('q', q);
  if (sort) {
    const [sortKey, sortDir] = sort.split('_');
    params.set('sort', sortKey);
    params.set('dir', sortDir);
  }
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  const { data, loading, error, reload } = useApi<{ items: Row[]; page: number; pageSize: number; totalPages: number; totalCount: number }>(`/api/documents?${params}`);
  const { data: dash } = useApi<{ kpis: { invoicedMonth: number; receivableAmount: number; overdueAmount: number; quotesPendingAmount: number } }>('/api/dashboard');
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
          worksiteRef: string | null; otherWorksiteRefs: string[]; totalTtc: number | null; textExtracted: boolean;
        };
      }>('/api/documents/import', fd);
      const ex = r.extraction;
      const lines: string[] = [];
      if (!ex.textExtracted) {
        lines.push('PDF sans texte lisible (scan/photo) — à compléter à la main.');
      } else {
        lines.push(ex.contactName ? `Client détecté : ${ex.contactName}${ex.contactConfidence === 'name' ? ' (à vérifier)' : ''}` : 'Client non détecté — à sélectionner sur la fiche.');
        if (ex.worksiteRef) lines.push(`Chantier détecté : ${ex.worksiteRef}`);
        if (ex.otherWorksiteRefs.length) lines.push(`Autres chantiers cités dans le document (non préremplis) : ${ex.otherWorksiteRefs.join(', ')}`);
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
    const rows = data?.items ?? [];
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
        eyebrow="Facturation"
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

      {dash && (active.kind === 'quote' || active.kind === 'invoice') && (
        <div className="panel doc-stats" style={{ marginBottom: '1rem' }}>
          {active.kind === 'quote' && (
            <>
              <div className="doc-stat"><span className="label">Devis en attente</span><span className="value">{formatEur(dash.kpis.quotesPendingAmount)}</span></div>
              <div className="doc-stat"><span className="label">Facturé ce mois</span><span className="value">{formatEur(dash.kpis.invoicedMonth)}</span></div>
            </>
          )}
          {active.kind === 'invoice' && (
            <>
              <div className="doc-stat"><span className="label">Facturé ce mois</span><span className="value">{formatEur(dash.kpis.invoicedMonth)}</span></div>
              <div className="doc-stat"><span className="label">À encaisser</span><span className="value">{formatEur(dash.kpis.receivableAmount)}</span></div>
              <div className="doc-stat"><span className="label">En retard</span><span className="value crit">{formatEur(dash.kpis.overdueAmount)}</span></div>
            </>
          )}
        </div>
      )}

      <div className="row" style={{ marginBottom: '1rem', gap: '0.4rem', flexWrap: 'wrap' }}>
        <div className="seg">
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => { setTab(t.key); setStatus(''); setSelected(new Set()); }}>
              {t.label}{tab === t.key && data ? ` · ${data.totalCount}` : ''}
            </button>
          ))}
        </div>
        {statusOptions.length > 0 && (
          <select className="select" style={{ maxWidth: 180 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Tous les statuts</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>{DOC_STATUS_LABEL[s] ?? s}</option>
            ))}
          </select>
        )}
        <select className="select" style={{ maxWidth: 220 }} value={sort} onChange={(e) => setSort(e.target.value)}>
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
        <input
          className="input"
          style={{ maxWidth: 240, marginLeft: 'auto' }}
          placeholder="N°, client, chantier…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {data && data.items.length > 0 && (
          <button type="button" className="btn" onClick={toggleAll}>
            {selected.size === data.items.length ? 'Tout désélectionner' : 'Tout sélectionner'}
          </button>
        )}
      </div>

      {loading && <SkeletonRows />}

      {error && !loading && <ErrorState message={error} onRetry={reload} />}
      {data && data.items.length === 0 && <EmptyState
          icon={FileText}
          title="Aucun document"
          text="Aucun devis ni facture ne correspond à ce filtre. Créez-en un, ou importez un PDF existant : client, chantier et montant sont pré-remplis quand c’est possible."
          action={<button className="btn primary" disabled={busy} onClick={() => create('invoice')}>+ Facture</button>}
          secondary={<button className="btn" disabled={busy} onClick={() => create('quote')}>+ Devis</button>}
        />}
      {data && data.items.length > 0 && (
        <div className="panel doc-list">
          {data.items.map((d) => (
            <div
              key={d.id}
              className={`doc-item${ctx.menu?.row.id === d.id ? ' ctx-target' : ''}`}
              onClick={rowNav(`/app/documents/${d.id}`, (h) => router.push(h))}
              onContextMenu={(e) => ctx.open(e, d)}
            >
              <input
                type="checkbox"
                className="doc-item-check"
                checked={selected.has(d.id)}
                onChange={() => toggleSelected(d.id)}
                onClick={(e) => e.stopPropagation()}
                aria-label="Sélectionner"
              />
              <div className="doc-item-body">
                <div className="doc-item-top">
                  <Link href={`/app/documents/${d.id}`} className="mono doc-item-num">{d.number ?? d.draftRef ?? '—'}</Link>
                  {d.originalPdf && <span title="PDF d’origine disponible">📄</span>}
                  {!d.number && <span className="badge plain">{DOC_KIND_LABEL[d.kind]}</span>}
                  {d.source === 'ai-draft' && <span className="badge warn" title="Créé par l'assistant IA — à vérifier avant validation">✨ IA</span>}
                  <DocStatusBadge status={d.status} />
                  <span className="doc-item-amount"><Money value={d.totalTtc} /></span>
                  <button
                    type="button"
                    className="doc-item-more"
                    onClick={(e) => ctx.open(e, d)}
                    aria-label="Actions"
                    title="Actions"
                  >
                    …
                  </button>
                </div>
                <div className="doc-item-title">{d.title || DOC_KIND_LABEL[d.kind]}</div>
                <div className="doc-item-meta">
                  <span>{[d.contact?.name, d.worksite?.ref].filter(Boolean).join(' · ') || '—'}</span>
                  <span>Échéance : {d.dueOn ? formatDateBE(d.dueOn) : '—'}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {data && (
        <PaginationBar page={data.page} totalPages={data.totalPages} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />
      )}
    </>
  );
}
