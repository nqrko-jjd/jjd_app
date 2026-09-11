'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { api, apiUpload, apiBlobUrl } from '@/lib/api';
import { PageHead, Money, formatDateBE } from '@/lib/ui';
import { useSort, useColumnFilter, SortTh } from '@/lib/sort';
import { rowNav } from '@/lib/rowNav';
import { ContextMenu, useContextMenu, type MenuItem } from '@/components/ContextMenu';
import { PaginationBar } from '@/components/PaginationBar';
import { ComboBox } from '@/components/ComboBox';
import { FileDrop } from '@/components/FileDrop';
import { downloadCsv, pickAndImportCsv, summarizeImport } from '@/lib/csvIO';

interface Expense {
  id: string;
  date: string | null;
  dueDate: string | null;
  direction: string;
  docNumber: string | null;
  supplier: string | null;
  supplierName: string | null;
  contactId: string | null;
  categoryRaw: string | null;
  categoryCode: string | null;
  categoryLabel: string | null;
  worksiteId: string | null;
  worksite: { id: string; ref: string; title: string } | null;
  ht: number;
  vatRecup: number | null;
  ttc: number | null;
  vatRate: number | null;
  notes: string | null;
  paymentStatus: string | null;
  paidOn: string | null;
  paid: boolean;
  hasPdf: boolean;
  editable: boolean;
  source: string | null;
}
interface Meta {
  categories: { code: string; label: string; kind: string }[];
  rawCategories: string[];
  suppliers: { id: string; name: string }[];
  worksites: { id: string; name: string }[];
  years: number[];
}

interface BankTx {
  id: string; bookingDate: string | null; amount: number | null;
  bank: string | null; counterpartyName: string | null; communication: string | null;
  nameMatch?: boolean;
}

function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

export default function AchatsPage() {
  return (
    <Suspense fallback={<div className="empty">Chargement…</div>}>
      <AchatsInner />
    </Suspense>
  );
}

function AchatsInner() {
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [paid, setPaid] = useState('');
  const [worksiteId, setWorksiteId] = useState('');
  const [contactId, setContactId] = useState('');
  const [category, setCategory] = useState('');
  const [year, setYear] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [edit, setEdit] = useState<Expense | 'new' | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const ctx = useContextMenu<Expense>();

  // revient à la 1ère page à chaque changement de filtre (sinon on peut se retrouver
  // sur une page qui n'existe plus après un filtrage plus restrictif)
  useEffect(() => { setPage(1); }, [q, paid, worksiteId, contactId, category, year]);

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (paid) params.set('paid', paid);
  if (worksiteId) params.set('worksiteId', worksiteId);
  if (contactId) params.set('contactId', contactId);
  if (category) params.set('category', category);
  if (year) params.set('year', year);
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  const { data, loading, reload } = useApi<{
    items: Expense[];
    totals: { count: number; ht: number; ttc: number; unpaidTtc: number };
    page: number;
    pageSize: number;
    totalPages: number;
  }>(`/api/finance/expenses?${params}`);
  const { data: meta } = useApi<Meta>('/api/finance/expenses/meta');

  const expenseAccessors = {
    date: (e: Expense) => (e.date ? new Date(e.date) : null),
    supplier: (e: Expense) => e.supplier,
    docNumber: (e: Expense) => e.docNumber,
    worksite: (e: Expense) => e.worksite?.ref,
    category: (e: Expense) => e.categoryLabel,
    ht: (e: Expense) => e.ht,
    ttc: (e: Expense) => e.ttc ?? e.ht,
    status: (e: Expense) => (e.paid ? 1 : 0),
  };
  const colFilter = useColumnFilter<Expense>(data?.items ?? [], expenseAccessors);
  const sort = useSort<Expense>(colFilter.rows, expenseAccessors);

  const total = data?.totals.ttc ?? 0;
  const unpaidTotal = data?.totals.unpaidTtc ?? 0;

  async function setPaidStatus(e: Expense, val: boolean) {
    await api(`/api/finance/expenses/${e.id}/paid`, { method: 'POST', body: { paid: val } });
    reload();
  }
  async function viewPdf(id: string) {
    const url = await apiBlobUrl(`/api/finance/expenses/${id}/pdf`);
    window.open(url, '_blank');
  }
  async function remove(e: Expense) {
    if (!window.confirm(`Supprimer la dépense ${e.docNumber ?? ''} (${e.supplier ?? ''}) ?`)) return;
    await api(`/api/finance/expenses/${e.id}`, { method: 'DELETE' });
    reload();
  }

  function toggleSelected(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    const withPdf = sort.rows.filter((e) => e.hasPdf);
    setSelected((s) => (s.size === withPdf.length && withPdf.every((e) => s.has(e.id)) ? new Set() : new Set(withPdf.map((e) => e.id))));
  }
  async function exportZip() {
    if (!selected.size) return;
    setExporting(true);
    try {
      const url = await apiBlobUrl(`/api/finance/expenses/export.zip?ids=${[...selected].join(',')}`);
      const a = document.createElement('a');
      a.href = url;
      a.download = `depenses-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
    } catch (e) {
      alert(`Échec de l’export : ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  }

  function exportCsv() {
    downloadCsv(`/api/finance/expenses/export.csv?${params}`, `achats-${new Date().toISOString().slice(0, 10)}.csv`);
  }
  function importCsv() {
    pickAndImportCsv(
      '/api/finance/expenses/import',
      (r) => { alert(summarizeImport(r)); reload(); },
      (msg) => alert(`Échec de l’import : ${msg}`),
    );
  }

  function rowMenu(e: Expense): MenuItem[] {
    return [
      { label: 'Ouvrir / modifier', onClick: () => setEdit(e) },
      ...(e.hasPdf ? [{ label: 'Voir la pièce jointe', onClick: () => viewPdf(e.id) }] : []),
      'separator',
      e.paid
        ? { label: 'Marquer non payé', onClick: () => setPaidStatus(e, false) }
        : { label: 'Marquer payé', onClick: () => setPaidStatus(e, true) },
      ...(e.editable
        ? ['separator' as const, { label: 'Supprimer', danger: true, onClick: () => remove(e) }]
        : []),
    ];
  }

  return (
    <>
      {ctx.menu && <ContextMenu x={ctx.menu.x} y={ctx.menu.y} items={rowMenu(ctx.menu.row)} onClose={ctx.close} />}
      {edit && meta && (
        <ExpenseModal
          expense={edit === 'new' ? null : edit}
          meta={meta}
          onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); reload(); }}
        />
      )}

      <PageHead
        title="Achats / Dépenses"
        sub={data ? `${data.totals.count} factures d'achat · page ${data.page}/${data.totalPages} · clic droit pour les actions rapides` : undefined}
        action={
          <div className="row">
            {selected.size > 0 && (
              <button className="btn" disabled={exporting} onClick={exportZip} title="Pièce jointe de chaque dépense sélectionnée, dans un seul .zip">
                📦 Exporter {selected.size} pièce{selected.size > 1 ? 's' : ''} jointe{selected.size > 1 ? 's' : ''} (zip)
              </button>
            )}
            <button className="btn" onClick={exportCsv} title="Exporter la liste filtrée en CSV (éditable dans Excel)">⇩ Exporter CSV</button>
            <button className="btn" onClick={importCsv} title="Réimporter un CSV/Excel corrigé (met à jour par id, crée les nouvelles lignes)">⇧ Importer</button>
            <button className="btn primary" onClick={() => setEdit('new')}>+ Nouvelle dépense</button>
          </div>
        }
      />

      <div className="kpis" style={{ marginBottom: '1.2rem' }}>
        <div className="kpi"><span className="ic">Σ</span><div className="label">Total dépenses (TTC)</div><div className="value"><Money value={total} /></div></div>
        <div className="kpi"><span className="ic">!</span><div className="label">Reste à payer</div><div className="value"><Money value={unpaidTotal} /></div></div>
      </div>

      <div className="row" style={{ marginBottom: '1rem', flexWrap: 'wrap', gap: '0.4rem' }}>
        <input className="input" style={{ maxWidth: 240 }} placeholder="Fournisseur, n°, notes…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" style={{ maxWidth: 150 }} value={paid} onChange={(e) => setPaid(e.target.value)}>
          <option value="">Payé & non payé</option>
          <option value="0">Non payé</option>
          <option value="1">Payé</option>
        </select>
        <ComboBox
          style={{ maxWidth: 220 }}
          placeholder="Tous les chantiers"
          value={worksiteId}
          onChange={setWorksiteId}
          options={(meta?.worksites ?? []).map((w) => ({ value: w.id, label: w.name }))}
        />
        <ComboBox
          style={{ maxWidth: 200 }}
          placeholder="Tous les fournisseurs"
          value={contactId}
          onChange={setContactId}
          options={(meta?.suppliers ?? []).map((s) => ({ value: s.id, label: s.name }))}
        />
        <select className="select" style={{ maxWidth: 180 }} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Toutes catégories</option>
          {(meta?.rawCategories ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="select" style={{ maxWidth: 110 }} value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="">Toutes années</option>
          {(meta?.years ?? []).map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {loading && <div className="empty">Chargement…</div>}
      {data && data.items.length === 0 && <div className="empty">Aucune dépense.</div>}
      {data && data.items.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 28 }}>
                  <input
                    type="checkbox"
                    checked={sort.rows.some((e) => e.hasPdf) && sort.rows.filter((e) => e.hasPdf).every((e) => selected.has(e.id))}
                    onChange={toggleAll}
                    aria-label="Tout sélectionner (pièces jointes disponibles)"
                  />
                </th>
                <SortTh k="date" sort={sort} filter={colFilter}>Date</SortTh>
                <SortTh k="supplier" sort={sort} filter={colFilter}>Fournisseur</SortTh>
                <SortTh k="docNumber" sort={sort} filter={colFilter}>N°</SortTh>
                <SortTh k="worksite" sort={sort} filter={colFilter}>Chantier</SortTh>
                <SortTh k="category" sort={sort} filter={colFilter}>Catégorie</SortTh>
                <SortTh k="ht" sort={sort} align="right" filter={colFilter}>HT</SortTh>
                <SortTh k="ttc" sort={sort} align="right" filter={colFilter}>TTC</SortTh>
                <SortTh k="status" sort={sort}>Statut</SortTh>
                <th />
              </tr>
            </thead>
            <tbody>
              {sort.rows.map((e) => (
                <tr
                  key={e.id}
                  className={`row-link${ctx.menu?.row.id === e.id ? ' ctx-target' : ''}`}
                  onClick={rowNav('', () => setEdit(e))}
                  onContextMenu={(ev) => ctx.open(ev, e)}
                >
                  <td onClick={(ev) => ev.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(e.id)}
                      disabled={!e.hasPdf}
                      title={e.hasPdf ? undefined : 'Aucune pièce jointe à exporter'}
                      onChange={() => toggleSelected(e.id)}
                      aria-label="Sélectionner"
                    />
                  </td>
                  <td className="tnum">{formatDateBE(e.date)}</td>
                  <td>
                    {e.supplier ?? '—'}
                    {e.direction === 'credit_note' && <span className="badge warn" style={{ marginLeft: 6 }}>NC</span>}
                    {e.source === 'chat' && <span className="badge plain" style={{ marginLeft: 6 }} title="Envoyée depuis le fil de chantier — à vérifier">📎 Fil de chantier</span>}
                  </td>
                  <td className="mono" style={{ fontSize: '0.82rem' }}>{e.docNumber ?? '—'}</td>
                  <td className="mono">{e.worksite?.ref ?? '—'}</td>
                  <td>{e.categoryLabel ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}><Money value={e.ht} /></td>
                  <td style={{ textAlign: 'right' }}><Money value={e.ttc ?? e.ht} /></td>
                  <td><span className={`badge ${e.paid ? 'ok' : 'warn'}`}>{e.paid ? 'Payé' : 'Non payé'}</span></td>
                  <td style={{ textAlign: 'center' }}>{e.hasPdf ? '📎' : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={7}>Total (tout le filtre)</td><td style={{ textAlign: 'right' }}><Money value={total} /></td><td colSpan={2} /></tr>
            </tfoot>
          </table>
        </div>
      )}

      {data && (
        <PaginationBar page={data.page} totalPages={data.totalPages} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />
      )}
    </>
  );
}

/* ------------------------------------------------------------- modale créer / éditer */

function ExpenseModal({
  expense,
  meta,
  onClose,
  onSaved,
}: {
  expense: Expense | null;
  meta: Meta;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [v, setV] = useState({
    date: toDateInput(expense?.date ?? new Date().toISOString()),
    dueDate: toDateInput(expense?.dueDate ?? null),
    direction: (expense?.direction === 'credit_note' ? 'credit_note' : 'purchase') as 'purchase' | 'credit_note',
    supplierName: expense?.contactId ? '' : (expense?.supplierName ?? ''),
    contactId: expense?.contactId ?? '',
    docNumber: expense?.docNumber ?? '',
    categoryCode: expense?.categoryCode ?? '',
    categoryRaw: expense?.categoryRaw ?? '',
    worksiteId: expense?.worksiteId ?? '',
    ht: expense?.ht != null ? String(expense.ht) : '',
    vatRecup: expense?.vatRecup != null ? String(expense.vatRecup) : '',
    ttc: expense?.ttc != null ? String(expense.ttc) : '',
    notes: expense?.notes ?? '',
    paymentStatus: (expense?.paid ? 'Payé' : 'Non payé') as 'Payé' | 'Non payé',
  });
  // Une facture peut couvrir plusieurs chantiers (ex. sous-traitant intervenu sur
  // plusieurs R-) : au-delà d'une ligne, le chantier unique + montant HT global sont
  // remplacés par une répartition manuelle, HT par chantier (uniquement à la création —
  // une dépense existante reste liée à un seul chantier, modifiable comme avant).
  const [splits, setSplits] = useState<{ worksiteId: string; ht: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractNote, setExtractNote] = useState<string | null>(null);
  const [bankMatch, setBankMatch] = useState<BankTx | null>(null);
  const [bankSug, setBankSug] = useState<BankTx[] | null>(null);

  // à la création seulement : lit le PDF déposé pour préremplir le formulaire
  // (fournisseur, chantier, montants…) — l'utilisateur corrige ensuite si besoin
  async function handleFile(f: File | null) {
    setPendingFile(f);
    setExtractNote(null);
    if (!f || expense) return;
    setExtracting(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const r = await apiUpload<{
        extraction: {
          kind: string | null; docNumber: string | null; issuedOn: string | null; dueOn: string | null;
          totalHt: number | null; totalTtc: number | null; vatRate: number | null;
          contactId: string | null; worksiteId: string | null; worksiteRef: string | null;
          otherWorksiteRefs: string[]; textExtracted: boolean;
        };
      }>('/api/finance/expenses/extract', fd);
      const ex = r.extraction;
      if (!ex.textExtracted) { setExtractNote('PDF sans texte lisible (scan/photo) — à compléter à la main.'); return; }
      const ht = ex.totalHt ?? (ex.totalTtc != null ? Math.round((ex.totalTtc / (1 + (ex.vatRate ?? 0.21))) * 100) / 100 : null);
      // la TVA récupérable = TTC − HT, calculée à partir des montants déjà résolus ci-dessus
      // plutôt que lue telle quelle dans le PDF (le repère de montant de TVA isolé est peu
      // fiable — souvent noyé dans un tableau — alors que HT et TTC sont vérifiés)
      const vatRecup = ht != null && ex.totalTtc != null ? Math.round((ex.totalTtc - ht) * 100) / 100 : null;
      setV((prev) => ({
        ...prev,
        direction: ex.kind === 'credit_note' ? 'credit_note' : prev.direction,
        date: ex.issuedOn || prev.date,
        dueDate: prev.dueDate || ex.dueOn || '',
        docNumber: prev.docNumber || ex.docNumber || '',
        worksiteId: prev.worksiteId || ex.worksiteId || '',
        contactId: prev.contactId || ex.contactId || '',
        ht: prev.ht || (ht != null ? String(ht) : ''),
        vatRecup: prev.vatRecup || (vatRecup != null ? String(vatRecup) : ''),
        ttc: prev.ttc || (ex.totalTtc != null ? String(ex.totalTtc) : ''),
      }));
      if (ex.otherWorksiteRefs.length) {
        const refs = [ex.worksiteRef, ...ex.otherWorksiteRefs].filter(Boolean) as string[];
        setExtractNote(`Plusieurs chantiers détectés dans ce document (${refs.join(', ')}) — une ligne de répartition a été ajoutée par chantier, choisis-les et indique le montant HT de chacun.`);
        setSplits(refs.map((_, i) => ({ worksiteId: i === 0 ? (ex.worksiteId ?? '') : '', ht: '' })));
      }
    } catch {
      // best-effort : en cas d'échec le fichier reste joint, saisie à la main
    } finally {
      setExtracting(false);
    }
  }

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  useEffect(() => {
    if (expense?.hasPdf) apiBlobUrl(`/api/finance/expenses/${expense.id}/pdf`).then(setPdfUrl).catch(() => {});
    if (expense) {
      api<{ expense: { bankMatch: BankTx | null } }>(`/api/finance/expenses/${expense.id}`)
        .then((r) => setBankMatch(r.expense.bankMatch))
        .catch(() => {});
    }
  }, [expense]);

  async function searchPayment() {
    if (!expense) return;
    const r = await api<{ items: BankTx[] }>(`/api/finance/expenses/${expense.id}/bank-suggestions`);
    setBankSug(r.items);
  }
  async function linkPayment(txId: string | null) {
    if (!expense) return;
    await api(`/api/finance/bank/${txId ?? bankMatch?.id}/match`, {
      method: 'POST',
      body: { ledgerId: txId ? expense.id : null },
    });
    setBankSug(null);
    onSaved();
    onClose();
  }

  // auto-calcule TTC quand HT + TVA récup sont saisis et TTC vide
  function set(k: string, val: string) {
    setV((prev) => {
      const next = { ...prev, [k]: val };
      if ((k === 'ht' || k === 'vatRecup') && next.ht && !prev.ttc) {
        const ht = Number(next.ht);
        const vat = Number(next.vatRecup || 0);
        if (!Number.isNaN(ht)) next.ttc = String(Math.round((ht + (vat || ht * 0.21)) * 100) / 100);
      }
      return next;
    });
  }

  async function attachFile(expenseId: string) {
    if (!pendingFile) return;
    const fd = new FormData();
    fd.append('file', pendingFile);
    await apiUpload(`/api/finance/expenses/${expenseId}/pdf`, fd);
  }

  function commonBody() {
    return {
      date: v.date,
      dueDate: v.dueDate || null,
      direction: v.direction,
      supplierName: v.contactId ? null : (v.supplierName || null),
      contactId: v.contactId || null,
      docNumber: v.docNumber || null,
      categoryCode: v.categoryCode || null,
      notes: v.notes || null,
      paymentStatus: v.paymentStatus,
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (splits && splits.length > 1) {
        if (splits.some((s) => !s.worksiteId || !(Number(s.ht) > 0))) {
          throw new Error('Chaque ligne de répartition doit avoir un chantier et un montant HT > 0.');
        }
        const totalHt = splits.reduce((sum, s) => sum + Number(s.ht), 0);
        const totalTtc = v.ttc === '' ? null : Number(v.ttc);
        const totalVat = v.vatRecup === '' ? null : Number(v.vatRecup);
        for (const s of splits) {
          const share = Number(s.ht) / totalHt;
          const saved = await api<{ expense: { id: string } }>('/api/finance/expenses', {
            method: 'POST',
            body: {
              ...commonBody(),
              worksiteId: s.worksiteId,
              ht: Number(s.ht),
              ttc: totalTtc != null ? Math.round(totalTtc * share * 100) / 100 : null,
              vatRecup: totalVat != null ? Math.round(totalVat * share * 100) / 100 : null,
            },
          });
          await attachFile(saved.expense.id);
        }
        onSaved();
        return;
      }

      const body = {
        ...commonBody(),
        worksiteId: v.worksiteId || null,
        ht: Number(v.ht || 0),
        vatRecup: v.vatRecup === '' ? null : Number(v.vatRecup),
        ttc: v.ttc === '' ? null : Number(v.ttc),
      };
      const saved = expense
        ? await api<{ expense: { id: string } }>(`/api/finance/expenses/${expense.id}`, { method: 'PATCH', body })
        : await api<{ expense: { id: string } }>('/api/finance/expenses', { method: 'POST', body });
      await attachFile(saved.expense.id);
      onSaved();
    } catch (e2) {
      setErr((e2 as Error).message ?? 'Erreur');
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <form className="modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <h2>{expense ? 'Modifier la dépense' : 'Nouvelle dépense'}</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>Date *</label>
            <input className="input" type="date" required value={v.date} onChange={(e) => set('date', e.target.value)} />
          </div>
          <div className="field">
            <label>Échéance</label>
            <input className="input" type="date" value={v.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
          </div>
          <div className="field">
            <label>Type</label>
            <select className="select" value={v.direction} onChange={(e) => set('direction', e.target.value)}>
              <option value="purchase">Facture d’achat</option>
              <option value="credit_note">Note de crédit fournisseur</option>
            </select>
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Fournisseur</label>
            <ComboBox
              allowFree
              placeholder="chercher ou saisir un nom"
              value={v.contactId || v.supplierName}
              onChange={(val) => {
                const isId = meta.suppliers.some((s) => s.id === val);
                setV((p) => ({ ...p, contactId: isId ? val : '', supplierName: isId ? '' : val }));
              }}
              options={meta.suppliers.map((s) => ({ value: s.id, label: s.name }))}
            />
          </div>
          <div className="field">
            <label>N° de facture</label>
            <input className="input" value={v.docNumber} onChange={(e) => set('docNumber', e.target.value)} />
          </div>
          <div className="field">
            <label>Catégorie</label>
            <select className="select" value={v.categoryCode} onChange={(e) => set('categoryCode', e.target.value)}>
              <option value="">{v.categoryRaw || '—'}</option>
              {meta.categories.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </div>
          {splits ? (
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>
                Répartition par chantier
                <span className="muted" style={{ fontWeight: 400, fontSize: '0.8rem' }}> — une facture, plusieurs chantiers : indique le HT de chacun</span>
              </label>
              <div className="grid" style={{ gap: '0.4rem' }}>
                {splits.map((s, i) => (
                  <div key={i} className="row" style={{ gap: '0.4rem' }}>
                    <ComboBox
                      style={{ flex: 1 }}
                      placeholder="Chantier"
                      value={s.worksiteId}
                      onChange={(val) => setSplits((prev) => prev!.map((x, j) => (j === i ? { ...x, worksiteId: val } : x)))}
                      options={meta.worksites.map((w) => ({ value: w.id, label: w.name }))}
                    />
                    <input
                      className="input"
                      style={{ maxWidth: 130 }}
                      type="number"
                      step="any"
                      placeholder="HT"
                      value={s.ht}
                      onChange={(e) => setSplits((prev) => prev!.map((x, j) => (j === i ? { ...x, ht: e.target.value } : x)))}
                    />
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => setSplits((prev) => (prev!.length > 1 ? prev!.filter((_, j) => j !== i) : null))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <div className="row" style={{ gap: '0.6rem', marginTop: '0.4rem', alignItems: 'center' }}>
                <button type="button" className="btn" onClick={() => setSplits((prev) => [...(prev ?? []), { worksiteId: '', ht: '' }])}>+ Chantier</button>
                <span className="muted" style={{ fontSize: '0.8rem' }}>
                  Total réparti : {splits.reduce((sum, s) => sum + (Number(s.ht) || 0), 0)} €
                </span>
              </div>
            </div>
          ) : (
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>
                Chantier
                {!expense && (
                  <button
                    type="button"
                    className="btn ghost"
                    style={{ marginLeft: 8, padding: '0.05rem 0.4rem', fontSize: '0.72rem' }}
                    onClick={() => setSplits([{ worksiteId: v.worksiteId, ht: v.ht }, { worksiteId: '', ht: '' }])}
                  >
                    + plusieurs chantiers
                  </button>
                )}
              </label>
              <ComboBox
                placeholder="— (frais général / non affecté)"
                value={v.worksiteId}
                onChange={(val) => set('worksiteId', val)}
                options={meta.worksites.map((w) => ({ value: w.id, label: w.name }))}
              />
            </div>
          )}
          <div className="field">
            <label>Montant HT *{splits && <span className="muted" style={{ fontWeight: 400, fontSize: '0.8rem' }}> (total réparti)</span>}</label>
            <input
              className="input"
              type="number"
              step="any"
              required={!splits}
              disabled={!!splits}
              value={splits ? splits.reduce((sum, s) => sum + (Number(s.ht) || 0), 0) : v.ht}
              onChange={(e) => set('ht', e.target.value)}
            />
          </div>
          <div className="field">
            <label>TVA récupérable</label>
            <input className="input" type="number" step="any" value={v.vatRecup} onChange={(e) => set('vatRecup', e.target.value)} />
          </div>
          <div className="field">
            <label>Montant TTC</label>
            <input className="input" type="number" step="any" value={v.ttc} onChange={(e) => set('ttc', e.target.value)} />
          </div>
          <div className="field">
            <label>Statut</label>
            <select className="select" value={v.paymentStatus} onChange={(e) => set('paymentStatus', e.target.value)}>
              <option value="Non payé">Non payé</option>
              <option value="Payé">Payé</option>
            </select>
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Notes</label>
            <textarea className="input" rows={2} value={v.notes} onChange={(e) => set('notes', e.target.value)} />
          </div>

          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>
              Pièce jointe (PDF ou photo)
              {!expense && <span className="muted" style={{ fontWeight: 400, fontSize: '0.8rem' }}> — un PDF texte préremplit le formulaire</span>}
              {extracting && <span className="muted" style={{ fontSize: '0.8rem' }}> · lecture en cours…</span>}
            </label>
            <FileDrop file={pendingFile} onFile={handleFile} existingUrl={pdfUrl} />
            {extractNote && <p className="muted" style={{ fontSize: '0.8rem', marginTop: '0.4rem', marginBottom: 0 }}>{extractNote}</p>}
          </div>

          {expense && (
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>Paiement (rapprochement bancaire)</label>
              {bankMatch ? (
                <div className="row" style={{ gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="badge ok">Rapproché</span>
                  <span>{formatDateBE(bankMatch.bookingDate)} · <Money value={bankMatch.amount} sign /> · {bankMatch.bank ?? '—'}</span>
                  {bankMatch.counterpartyName && <span className="muted">{bankMatch.counterpartyName}</span>}
                  <button type="button" className="btn" onClick={() => linkPayment(null)}>Délier</button>
                </div>
              ) : bankSug ? (
                bankSug.length === 0 ? (
                  <span className="muted">Aucune transaction bancaire non rapprochée ne correspond (montant ± 1 €, ± 2 mois).</span>
                ) : (
                  <div className="grid" style={{ gap: '0.35rem' }}>
                    <span className="muted" style={{ fontSize: '0.8rem' }}>Vérifie le nom : « fournisseur ✓ » = la contrepartie du paiement correspond au fournisseur.</span>
                    {bankSug.map((t) => (
                      <button key={t.id} type="button" className="btn" style={{ justifyContent: 'space-between' }} onClick={() => linkPayment(t.id)}>
                        <span>
                          <span className={`badge ${t.nameMatch ? 'ok' : 'plain'}`} style={{ marginRight: 6 }}>
                            {t.nameMatch ? 'fournisseur ✓' : 'montant seul'}
                          </span>
                          {formatDateBE(t.bookingDate)} · {t.counterpartyName ?? ((t.communication ?? '').slice(0, 30) || '—')} · {t.bank ?? ''}
                        </span>
                        <Money value={t.amount} sign />
                      </button>
                    ))}
                    <button type="button" className="btn ghost" onClick={() => setBankSug(null)}>Annuler</button>
                  </div>
                )
              ) : (
                <button type="button" className="btn" onClick={searchPayment}>Rechercher le paiement dans la banque</button>
              )}
            </div>
          )}
        </div>
        {err && <div className="badge crit" style={{ margin: '0 1.15rem', padding: '0.4rem 0.7rem' }}>{err}</div>}
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
        </div>
      </form>
    </div>
  );
}
