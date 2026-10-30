'use client';
import dynamic from 'next/dynamic';
const PurchaseReception = dynamic(() => import('@/components/PurchaseReception'));
import { tr } from '@/lib/ui-language';
import { vehicleName } from '@/lib/vehicle';
import { SkeletonRows, ErrorState, EmptyState } from '@/components/States';
import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { api, apiUpload, apiBlobUrl } from '@/lib/api';
import { PageHead, Money, formatDateBE, formatEur, Kpi } from '@/lib/ui';
import { Wallet, AlertTriangle, Receipt, Truck, CreditCard } from 'lucide-react';
import { useSort, useColumnFilter, SortTh } from '@/lib/sort';
import { rowNav } from '@/lib/rowNav';
import { ContextMenu, useContextMenu, type MenuItem } from '@/components/ContextMenu';
import { PaginationBar } from '@/components/PaginationBar';
import { ComboBox } from '@/components/ComboBox';
import { FileDrop } from '@/components/FileDrop';

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
  vehicleId: string | null;
  vehicle: { id: string; code: string | null; plate: string | null; name: string | null; brand: string | null; model: string | null } | null;
  ht: number;
  vatRecup: number | null;
  ttc: number | null;
  vatRate: number | null;
  notes: string | null;
  paymentStatus: string | null;
  paidOn: string | null;
  paid: boolean;
  paidAmount: number;
  remainingAmount: number;
  hasPdf: boolean;
  receipts: {id:string;source:string;xmlPath:string|null}[];
  foxExportedAt: string | null;
  foxTransmittedAt: string | null;
  editable: boolean;
  /** supprimable : saisie manuelle, ou écriture de l'import Excel qui a un doublon */
  deletable?: boolean;
  duplicateIds?: string[];
  duplicateAdvice?: 'delete' | 'keep' | null;
  /** répartissable entre plusieurs chantiers : toutes les factures d'achat / notes de crédit, import Excel et fiches transmises à Fox comprises */
  splittable?: boolean;
  /** autres lignes de la MÊME facture (même fournisseur, même n°) : à fusionner en une seule fiche */
  siblingIds?: string[];
  /** répartition enregistrée sur la fiche : une part (HT) par chantier */
  allocations?: { worksiteId: string; ht: number; worksite: { ref: string; title: string } }[];
  /** vue d'un chantier : HT de la fiche entière (ht = la part de ce chantier) */
  partOfHt?: number;
  source: string | null;
  // bordereau (direction "delivery_slip") -> facture reçue ensuite, une fois reliée
  linkedInvoiceId: string | null;
  linkedInvoice: { id: string; docNumber: string | null; date: string | null } | null;
  // facture (direction "purchase") -> nombre de bordereaux qui pointent vers elle
  _count: { bordereaux: number } | null;
  /** bordereaux reliés à cette facture (une seule dépense avec elle) */
  bordereaux?: { id: string; docNumber: string | null; date: string | null; ht: number; ttc: number | null; pdfPath?: string | null; worksite?: { ref: string } | null }[];
  /** répartition par chantier calculée d'après les bordereaux reliés (coût de chaque bordereau sur son chantier) */
  worksiteAllocation?: { worksiteId: string | null; ref: string | null; ht: number }[];
}
interface Meta {
  categories: { code: string; label: string; kind: string }[];
  rawCategories: string[];
  suppliers: { id: string; name: string }[];
  worksites: { id: string; name: string }[];
  vehicles: { id: string; name: string }[];
  years: number[];
}

interface BankTx {
  id: string; bookingDate: string | null; amount: number | null;
  bank: string | null; counterpartyName: string | null; communication: string | null;
  nameMatch?: boolean;
  description?: string | null;
  matchedTo?: string[];
}
interface BankMatch extends BankTx { matchId: string; allocatedAmount: number }
interface PurchaseCandidate {
  code: string; description: string; contactId: string; contactName: string;
  occurrences: { ledgerEntryId: string; date: string | null; docNumber: string | null; qty: number }[];
}

function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

const isOverdue = (e: Expense) => !e.paid && !!e.dueDate && new Date(e.dueDate) < new Date();

export default function AchatsPage() {
  return (
    <Suspense fallback={<SkeletonRows />}>
      <AchatsInner />
    </Suspense>
  );
}

function AchatsInner() {
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [paid, setPaid] = useState(sp.get('paid') ?? '');
  const [worksiteId, setWorksiteId] = useState(sp.get('worksiteId') ?? '');
  const [contactId, setContactId] = useState('');
  const [category, setCategory] = useState('');
  const [year, setYear] = useState('');
  const [type, setType] = useState(sp.get('type') ?? ''); // '' | purchase | sale | credit_note | delivery_slip
  const [linked, setLinked] = useState(''); // '' | 0 | 1 — ne s'applique qu'aux bordereaux
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [edit, setEdit] = useState<Expense | 'new' | { prefillFrom: Expense } | null>(null);
  const [linking, setLinking] = useState<Expense | null>(null);
  const [merging, setMerging] = useState<Expense | null>(null);
  const [showCandidates, setShowCandidates] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [receptionOpen,setReceptionOpen]=useState(false);
  const [fox, setFox] = useState('');
  const [foxNotice, setFoxNotice] = useState('');
  const [foxBusy, setFoxBusy] = useState(false);
  const ctx = useContextMenu<Expense>();

  // revient à la 1ère page à chaque changement de filtre (sinon on peut se retrouver
  // sur une page qui n'existe plus après un filtrage plus restrictif)
  useEffect(() => { setPage(1); }, [q, paid, worksiteId, contactId, category, year, type, linked, fox]);
  useEffect(() => { setSelected(new Set()); }, [q, paid, worksiteId, contactId, category, year, type, linked, fox, page, pageSize]);

  const params = new URLSearchParams();
  if (sp.get('overdue') === '1') params.set('overdue', '1');
  if (fox) params.set('fox', fox);
  if (q) params.set('q', q);
  if (paid) params.set('paid', paid);
  if (worksiteId) params.set('worksiteId', worksiteId);
  if (contactId) params.set('contactId', contactId);
  if (category) params.set('category', category);
  if (year) params.set('year', year);
  if (type) params.set('type', type);
  if (linked) params.set('linked', linked);
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  const { data, loading, error, reload } = useApi<{
    items: Expense[];
    receiptsToReview: number;
    totals: { count: number; ht: number; ttc: number; unpaidTtc: number; pendingSlips: number; overdueCount: number; overdueTtc: number };
    page: number;
    pageSize: number;
    totalPages: number;
  }>(`/api/finance/expenses?${params}`);
  const { data: meta } = useApi<Meta>('/api/finance/expenses/meta');
  const { data: mailbox } = useApi<{ configured: boolean }>('/api/finance/expenses/mailbox-status');
  const [syncingMailbox, setSyncingMailbox] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [scanningProcessed, setScanningProcessed] = useState(false);
  const [scanningRefs, setScanningRefs] = useState(false);

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
  async function openById(id: string) {
    const r = await api<{ expense: Expense }>(`/api/finance/expenses/${id}`);
    setEdit(r.expense);
  }
  async function refreshOpen() {
    if (edit && typeof edit === 'object' && 'id' in edit) await openById(edit.id);
    reload();
  }
  async function viewPdf(id: string) {
    const url = await apiBlobUrl(`/api/finance/expenses/${id}/pdf`);
    window.open(url, '_blank');
  }
  async function remove(e: Expense) {
    const imported = !e.editable; // ligne de l'import historique Excel
    const twin = !!e.duplicateIds?.length;
    const siblings = !!e.siblingIds?.length;
    const text = !imported ? `Supprimer la dépense ${e.docNumber ?? ''} (${e.supplier ?? ''}) ?`
      : twin ? `Supprimer ce doublon (${e.docNumber ?? ''}, ${e.supplier ?? ''}) ? L’autre exemplaire reste en place.`
      : siblings ? `Supprimer cette ligne de l’import Excel (${e.docNumber ?? ''}, ${e.supplier ?? ''}) ? Les autres lignes de la même facture restent en place.\n\nPour regrouper plusieurs lignes en une seule fiche, utilisez plutôt « Fusionner les lignes de cette facture ».`
      : `Cette ligne vient de l’import historique Excel et n’a ni doublon ni autre ligne de la même facture.\n\nLa supprimer retire cette dépense (${e.docNumber ?? ''}, ${e.supplier ?? ''}) des comptes. Elle est conservée dans le journal.\n\nSupprimer quand même ?`;
    if (!window.confirm(text)) return;
    try { await api(`/api/finance/expenses/${e.id}${imported ? '?force=1' : ''}`, { method: 'DELETE' }); reload(); } catch (err) { window.alert((err as Error).message); }
  }
  async function unlinkSlip(e: Expense) {
    if (!window.confirm(`Délier ce bordereau de la facture ${e.linkedInvoice?.docNumber ?? ''} ?`)) return;
    await api(`/api/finance/expenses/${e.id}/link`, { method: 'POST', body: { invoiceId: null } });
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


  const foxEligible = (e: Expense) => e.direction === 'purchase' || (e.direction === 'credit_note' && !/vente|dit auto/i.test(e.categoryRaw ?? ''));
  const selectedExpenses = (data?.items ?? []).filter(e => selected.has(e.id));
  const foxSelection = selectedExpenses.length === selected.size && selectedExpenses.length > 0 && selectedExpenses.every(foxEligible);
  async function exportFox() {
    if (!foxSelection) return;
    if (selectedExpenses.some(e => e.foxTransmittedAt) && !window.confirm('La sélection contient des factures déjà marquées transmises à Fox. Les télécharger à nouveau ?')) return;
    setFoxBusy(true); setFoxNotice('');
    try {
      const url = await apiBlobUrl('/api/finance/expenses/fox-export', { method: 'POST', body: { ids: [...selected] } });
      const a = document.createElement('a');
      a.href = url; a.download = 'fox-' + new Date().toISOString().slice(0, 10) + '.zip'; a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      setFoxNotice('ZIP préparé. Extrayez les PDF, glissez-les dans Fox, puis confirmez ci-dessous le dépôt réussi. Aucune facture n’est encore marquée transmise.');
      reload();
    } catch (e) { setFoxNotice((e as Error).message); }
    finally { setFoxBusy(false); }
  }
  async function confirmFox(transmitted: boolean, ids = [...selected]) {
    if (!ids.length || !window.confirm(transmitted
      ? 'Confirmer que ces ' + ids.length + ' facture(s) ont bien été déposées dans Fox ? Le téléchargement seul ne suffit pas.'
      : 'Remettre ces factures dans « À transmettre à Fox » ?')) return;
    setFoxBusy(true);
    try {
      await api('/api/finance/expenses/fox-transmission', { method: 'POST', body: { ids, transmitted } });
      setFoxNotice(transmitted ? 'Dépôt dans Fox confirmé. La date de transmission est enregistrée.' : 'Factures remises à transmettre.');
      setSelected(new Set()); reload();
    } catch (e) { setFoxNotice((e as Error).message); }
    finally { setFoxBusy(false); }
  }

  async function syncMailbox() {
    setSyncingMailbox(true);
    try {
      const r = await api<{ messagesSeen: number; pdfsImported: number; errors: string[] }>('/api/finance/expenses/sync-mailbox', { method: 'POST' });
      alert(`${r.pdfsImported} document(s) reçu(s), dont ceux à vérifier dans le panneau Réception, sur ${r.messagesSeen} mail(s) vérifié(s).${r.errors.length ? `\n${r.errors.length} erreur(s).` : ''}`);
      reload();
    } catch (e) {
      alert(`Échec de la synchronisation : ${(e as Error).message}`);
    } finally {
      setSyncingMailbox(false);
    }
  }

  async function reprocessMailbox() {
    setReprocessing(true);
    try {
      const r = await api<{ scanned: number; updated: number; unchanged: number; errors: string[] }>('/api/finance/expenses/reprocess-email', { method: 'POST' });
      alert(`${r.updated} facture(s) corrigée(s) sur ${r.scanned} vérifiée(s).${r.errors.length ? `\n${r.errors.length} erreur(s).` : ''}`);
      reload();
    } catch (e) {
      alert(`Échec du retraitement : ${(e as Error).message}`);
    } finally {
      setReprocessing(false);
    }
  }

  async function scanProcessedMailbox() {
    setScanningProcessed(true);
    try {
      const r = await api<{ messagesScanned: number; pdfsFound: number; alreadyInSystem: number; created: number; errors: string[] }>(
        '/api/finance/expenses/scan-processed-mailbox', { method: 'POST' },
      );
      alert(
        `${r.created} facture(s) retrouvée(s) et importée(s) sur ${r.pdfsFound} PDF vu(s) dans ${r.messagesScanned} mail(s) déjà classés « Traité par JJD App »`
        + ` (${r.alreadyInSystem} déjà connue(s)).${r.errors.length ? `\n${r.errors.length} erreur(s).` : ''}`,
      );
      reload();
    } catch (e) {
      alert(`Échec de la recherche : ${(e as Error).message}`);
    } finally {
      setScanningProcessed(false);
    }
  }

  async function scanPurchaseRefs() {
    setScanningRefs(true);
    try {
      const r = await api<{ scanned: number; matched: number }>('/api/finance/expenses/scan-purchase-refs', { method: 'POST' });
      alert(`${r.matched} correspondance(s) de référence trouvée(s) sur ${r.scanned} facture(s) d’achat analysée(s).`);
    } catch (e) {
      alert(`Échec de la recherche : ${(e as Error).message}`);
    } finally {
      setScanningRefs(false);
    }
  }


  function rowMenu(e: Expense): MenuItem[] {
    // Écriture de vente historique isolée (visible ici seulement via le filtre "Factures de
    // vente", pour la retrouver depuis la file de contrôle) : ce formulaire est pensé pour les
    // achats (fournisseur, catégories d'achat…) — pas encore de vraie fiche pour ces lignes, on
    // évite donc d'ouvrir un formulaire qui ré-enregistrerait la ligne en "achat" par erreur.
    if (e.direction === 'sale') {
      return [
        ...(e.hasPdf ? [{ label: 'Voir la pièce jointe', onClick: () => viewPdf(e.id) }] : []),
        { label: 'Écriture de vente historique — non éditable depuis ce tableau', onClick: () => {}, disabled: true },
      ];
    }
    const slipActions: MenuItem[] = e.direction === 'delivery_slip'
      ? e.linkedInvoiceId
        ? [{ label: `Délier de la facture ${e.linkedInvoice?.docNumber ?? ''}`, onClick: () => unlinkSlip(e) }]
        : [
            { label: 'Facture reçue…', onClick: () => setEdit({ prefillFrom: e }) },
            { label: 'Lier à une facture existante…', onClick: () => setLinking(e) },
          ]
      : [];
    return [
      { label: 'Ouvrir / modifier', onClick: () => setEdit(e) },
      ...(foxEligible(e) && e.foxTransmittedAt ? [{ label: 'Remettre à transmettre à Fox', onClick: () => confirmFox(false, [e.id]) }] : []),
      ...(e.hasPdf ? [{ label: 'Voir la pièce jointe', onClick: () => viewPdf(e.id) }] : []),
      ...(slipActions.length ? ['separator' as const, ...slipActions] : []),
      'separator',
      e.paid
        ? { label: 'Marquer non payé', onClick: () => setPaidStatus(e, false) }
        : { label: 'Marquer payé', onClick: () => setPaidStatus(e, true) },
      ...(e.siblingIds?.length ? [{ label: `Fusionner les lignes de cette facture (${e.siblingIds.length + 1})…`, onClick: () => setMerging(e) }] : []),
      ...(e.editable || e.deletable
        ? ['separator' as const, { label: e.editable ? 'Supprimer' : e.duplicateIds?.length ? 'Supprimer ce doublon' : 'Supprimer (import Excel)', danger: true, onClick: () => remove(e) }]
        : []),
    ];
  }

  return (
    <>
      {ctx.menu && <ContextMenu x={ctx.menu.x} y={ctx.menu.y} items={rowMenu(ctx.menu.row)} onClose={ctx.close} />}
      {edit && meta && (
        <ExpenseModal
          key={typeof edit === 'object' && edit && 'id' in edit ? edit.id : typeof edit === 'object' && edit && 'prefillFrom' in edit ? 'prefill' : 'new'}
          expense={edit === 'new' || (typeof edit === 'object' && 'prefillFrom' in edit) ? null : edit}
          prefillFrom={typeof edit === 'object' && edit && 'prefillFrom' in edit ? edit.prefillFrom : null}
          meta={meta}
          onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); reload(); }}
          onOpenOther={openById}
          onChanged={refreshOpen}
          onMerge={(x) => { setEdit(null); setMerging(x); }}
        />
      )}
      {merging && <MergeModal expense={merging} onClose={() => setMerging(null)} onMerged={() => { setMerging(null); reload(); }} />}
      {linking && (
        <LinkSlipModal
          slip={linking}
          onClose={() => setLinking(null)}
          onLinked={() => { setLinking(null); reload(); }}
        />
      )}
      {showCandidates && <PurchaseCandidatesModal onClose={() => setShowCandidates(false)} />}

      <PageHead
        eyebrow="Comptabilité"
        title="Achats / Dépenses"
        sub={data ? `${data.totals.count} ligne${data.totals.count > 1 ? 's' : ''} · page ${data.page}/${data.totalPages} · clic droit pour les actions rapides` : undefined}
        action={
          <div className="row">
            {selected.size > 0 && (
              <button className="btn" disabled={exporting} onClick={exportZip} title="Pièce jointe de chaque dépense sélectionnée, dans un seul .zip">
                📦 Exporter {selected.size} pièce{selected.size > 1 ? 's' : ''} jointe{selected.size > 1 ? 's' : ''} (zip)
              </button>
            )}
            <Link className="btn" href="/app/achats/sans-chantier" title="Poste E-01 « Matériel sans chantier » : voir les chantiers actifs le jour de l’achat et imputer chaque dépense">Imputer les dépenses E-01</Link>
            <details className="page-tools" onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}>
              <summary className="btn">{tr('Imports & outils')} <span aria-hidden="true">⌄</span></summary>
              <div className="page-tools-panel">
            <Link className="btn" href="/app/achats/importer-pdf" title="Déposer des PDF : JJD les rattache aux dépenses qui n’ont pas encore de pièce jointe">Importer des PDF dans les dépenses</Link>
            {mailbox?.configured && (
              <button className="btn" disabled={syncingMailbox} onClick={syncMailbox} title="Vérifie la boîte mail factures et importe les nouveaux PDF reçus">
                {syncingMailbox ? 'Synchronisation…' : 'Synchroniser la boîte mail'}
              </button>
            )}
            <button className="btn" disabled={reprocessing} onClick={reprocessMailbox} title="Relit les factures boîte mail déjà importées dont le montant, le n° ou le fournisseur n'avaient pas été trouvés">
              {reprocessing ? 'Retraitement…' : 'Retraiter les imports mail'}
            </button>
            {mailbox?.configured && (
              <button
                className="btn"
                disabled={scanningProcessed}
                onClick={scanProcessedMailbox}
                title="Un mail avec plusieurs pièces jointes (facture + conditions générales…) pouvait être classé « traité » sans que la facture soit importée — recherche celles qui manquent dans ce dossier"
              >
                {scanningProcessed ? 'Recherche…' : 'Retrouver des factures manquées'}
              </button>
            )}
            <button
              className="btn"
              disabled={scanningRefs}
              onClick={scanPurchaseRefs}
              title="Recherche dans les PDF déjà reçus les références produit déjà enregistrées sur vos articles de stock — alimente l'historique d'achat de chaque article"
            >
              {scanningRefs ? 'Recherche…' : 'Détecter les réf. produits'}
            </button>
            <Link href="/app/achats/articles" className="btn" title="Ce que vous achetez, article par article, lu dans les PDF des factures (quantités, montants, prix)">
              Articles achetés
            </Link>
            <button
              className="btn"
              onClick={() => setShowCandidates(true)}
              title="Repère les articles qui reviennent souvent sur vos factures mais n'ont pas encore de fiche stock"
            >
              Articles récurrents non suivis
            </button>
              </div>
            </details>
            <button className="btn primary" onClick={() => setEdit('new')}>+ Nouvelle dépense</button>
          </div>
        }
      />

      <details className="card fox-export-panel" style={{ padding: 16, marginBottom: 16 }} onToggle={e=>setReceptionOpen(e.currentTarget.open)}>
        <summary style={{cursor:'pointer',fontWeight:600}}>Réception Peppol / mails · documents à vérifier {data?.receiptsToReview ? <span className="badge warn">{data.receiptsToReview}</span> : null}</summary>
        {receptionOpen && <PurchaseReception onImported={reload}/>}
      </details>
      <details id="fox-export" className="card fox-export-panel" style={{ padding: 16, marginBottom: 16 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Export pour Fox</summary>
        <p>Sélectionnez les factures, téléchargez le ZIP et extrayez ses PDF avant de les glisser dans Fox. Confirmez ensuite le dépôt réussi.</p>
        <p className="muted">Le suivi commence ici : les anciens dépôts dans Fox ne sont pas connus automatiquement. Vous pouvez les sélectionner puis les marquer comme transmis.</p>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn" onClick={() => { setFox('pending'); setType(''); }}>Voir les factures à transmettre</button>
          <button className="btn" onClick={() => setSelected(new Set(sort.rows.filter(e => foxEligible(e) && e.hasPdf && !e.foxTransmittedAt).slice(0, 300).map(e => e.id)))}>Sélectionner les PDF à transmettre de cette page</button>
          <button className="btn primary" disabled={!foxSelection || foxBusy || selected.size > 300} onClick={exportFox}>{foxBusy ? 'Traitement…' : 'Télécharger pour Fox (' + selected.size + ')'}</button>
          <button className="btn" disabled={!foxSelection || foxBusy || selected.size > 300} onClick={() => confirmFox(true)}>Marquer comme transmis à Fox</button>
        </div>
        <p className="muted">300 documents / 100 Mo maximum par lot. Les doublons possibles dans le lot bloquent l’export pour vérification.</p>
      </details>
      {foxNotice && <div role="status" className="card" style={{ padding: 16, marginBottom: 16 }}>{foxNotice}</div>}

      {sp.get('overdue') === '1' && <div className="worksite-context-banner"><strong>Factures fournisseurs échues et non payées</strong><Link href="/app" className="btn ghost">Retour au dashboard</Link><Link href="/app/achats" className="btn ghost">Retirer le filtre</Link></div>}
      <div className="kpis" style={{ marginBottom: '1.2rem' }}>
        <Kpi
          ic={Wallet}
          label="Total dépenses (TTC)"
          value={<Money value={total} />}
          sub={data ? `${data.totals.count} facture${data.totals.count > 1 ? 's' : ''} d'achat` : undefined}
          hero
        />
        <Kpi
          ic={AlertTriangle}
          label="Reste à payer"
          value={<Money value={unpaidTotal} />}
          sub={total > 0 ? `${Math.round((unpaidTotal / total) * 100)} % du total` : 'Rien à payer'}
          warn={unpaidTotal > 0}
        />
        <div role="button" tabIndex={0} style={{ cursor: 'pointer' }} title="Filtrer sur les factures non payées" onClick={() => setPaid('0')}>
          <Kpi
            ic={CreditCard}
            label={tr("En retard")}
            value={<Money value={data?.totals.overdueTtc ?? 0} />}
            sub={(data?.totals.overdueCount ?? 0) > 0 ? `${data?.totals.overdueCount} facture${(data?.totals.overdueCount ?? 0) > 1 ? 's' : ''} échue${(data?.totals.overdueCount ?? 0) > 1 ? 's' : ''}` : 'Rien en retard'}
            warn={(data?.totals.overdueCount ?? 0) > 0}
          />
        </div>
        <div
          role="button"
          tabIndex={0}
          style={{ cursor: 'pointer' }}
          title="Filtrer sur les bordereaux en attente de facture"
          onClick={() => { setType('delivery_slip'); setLinked('0'); }}
        >
          <Kpi
            ic={Truck}
            label="Bordereaux en attente"
            value={String(data?.totals.pendingSlips ?? 0)}
            sub="Enlèvement/paiement sans facture reçue"
            warn={(data?.totals.pendingSlips ?? 0) > 0}
          />
        </div>
      </div>

      <div className="row list-filters" style={{ marginBottom: '1rem', flexWrap: 'wrap', gap: '0.4rem' }}>
        <select className="select" aria-label="Transmission Fox" value={fox} onChange={e => setFox(e.target.value)}>
          <option value="">Fox : tous</option>
          <option value="pending">Fox : à transmettre</option>
          <option value="sent">Fox : transmis</option>
        </select>
        <input className="input" style={{ maxWidth: 240 }} placeholder="Fournisseur, n°, notes…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" style={{ maxWidth: 150 }} value={paid} onChange={(e) => setPaid(e.target.value)}>
          <option value="">Payé & non payé</option>
          <option value="0">À régler (dont partiel)</option>
          <option value="1">{tr("Payé")}</option>
        </select>
        <select className="select" style={{ maxWidth: 180 }} value={type} onChange={(e) => { setType(e.target.value); if (e.target.value !== 'delivery_slip') setLinked(''); }}>
          <option value="">Tous les types</option>
          <option value="purchase">Factures d’achat</option>
          <option value="sale">Factures de vente (écritures isolées)</option>
          <option value="credit_note">Notes de crédit (achat + vente)</option>
          <option value="delivery_slip">Bordereaux</option>
        </select>
        {type === 'delivery_slip' && (
          <select className="select" style={{ maxWidth: 170 }} value={linked} onChange={(e) => setLinked(e.target.value)}>
            <option value="">Reliés & en attente</option>
            <option value="0">En attente de facture</option>
            <option value="1">Reliés</option>
          </select>
        )}
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

      {loading && <SkeletonRows />}

      {error && !loading && <ErrorState message={error} onRetry={reload} />}
      {data && data.items.length === 0 && (
        <EmptyState
          icon={Receipt}
          title="Aucune dépense"
          text="Aucune facture d’achat ne correspond à ces filtres. Élargissez la recherche ou enregistrez une nouvelle dépense."
          action={<button className="btn primary" onClick={() => setEdit('new')}>+ Nouvelle dépense</button>}
        />
      )}
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
                <SortTh k="date" sort={sort} filter={colFilter}>{tr("Date")}</SortTh>
                <SortTh k="supplier" sort={sort} filter={colFilter}>{tr("Fournisseur")}</SortTh>
                <SortTh k="docNumber" sort={sort} filter={colFilter}>N°</SortTh>
                <SortTh k="worksite" sort={sort} filter={colFilter}>{tr("Chantier")}</SortTh>
                <SortTh k="category" sort={sort} filter={colFilter}>{tr("Catégorie")}</SortTh>
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
                  onClick={rowNav('', () => { if (e.direction !== 'sale') setEdit(e); })}
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
                    {!!e.duplicateIds?.length && (e.duplicateAdvice === 'keep'
                      ? <span className="badge plain" style={{ marginLeft: 6 }} title="Cette facture est en double ; celle-ci est la bonne (elle a les paiements). Supprimez l'autre.">doublon · à garder</span>
                      : <span className="badge crit" style={{ marginLeft: 6 }} title="Même fournisseur, même n° et même montant qu'une autre dépense : clic droit → supprimer ce doublon">{e.duplicateAdvice === 'delete' ? 'doublon · à supprimer (aucun paiement)' : 'doublon ?'}</span>)}
                    {e.direction === 'delivery_slip' && (
                      e.linkedInvoiceId
                        ? <span className="badge ok" style={{ marginLeft: 6 }} title={`Relié à la facture ${e.linkedInvoice?.docNumber ?? ''}`}>📦 Bordereau · relié</span>
                        : <span className="badge warn" style={{ marginLeft: 6 }} title="Preuve d’enlèvement/paiement — la facture n’est pas encore arrivée">📦 Bordereau · en attente</span>
                    )}
                    {e.direction === 'purchase' && !!e.worksiteAllocation?.length && (e.worksiteAllocation.length > 1 || e.worksiteAllocation[0]!.worksiteId !== e.worksiteId) && (
                      <span className="badge plain" style={{ marginLeft: 6 }} title={e.worksiteAllocation!.map((a) => `${a.ref ?? 'Sans chantier'} : ${formatEur(a.ht)} HT`).join('\n')}>
                        ↔ {e.worksiteAllocation!.length > 1 ? `${e.worksiteAllocation!.length} chantiers` : (e.worksiteAllocation![0]!.ref ?? 'chantier des bordereaux')}
                      </span>
                    )}
                    {!!e.allocations && e.allocations.length > 1 && (
                      <span className="badge plain" style={{ marginLeft: 6 }} title={e.allocations.map((a) => `${a.worksite.ref} : ${formatEur(a.ht)} HT`).join('\n')}>
                        ⇆ {e.allocations.length} chantiers{e.partOfHt != null ? ` · part de ${formatEur(e.partOfHt)} HT` : ''}
                      </span>
                    )}
                    {!!e.siblingIds?.length && (
                      <span className="badge warn" style={{ marginLeft: 6, cursor: 'pointer' }} title="Même fournisseur et même n° que d’autres lignes : clic droit → Fusionner les lignes de cette facture" onClick={(ev) => { ev.stopPropagation(); setMerging(e); }}>
                        {e.siblingIds.length + 1} lignes · à fusionner
                      </span>
                    )}
                    {e.direction === 'purchase' && !!e._count?.bordereaux && (
                      <span className="badge plain" style={{ marginLeft: 6 }} title={`Bordereau(x) relié(s) à cette facture, payés avec elle : ${(e.bordereaux ?? []).map((b) => b.docNumber ?? 'sans n°').join(', ')}`}>
                        📦 {e._count.bordereaux} bordereau{e._count.bordereaux > 1 ? 'x' : ''}
                      </span>
                    )}
                    {(e.source==='peppol' || e.receipts?.length>0) && <span className="badge plain" style={{marginLeft:6}}>Peppol</span>}
                    {e.receipts?.some(r=>r.xmlPath) && <button className="btn small" onClick={async ev=>{ev.stopPropagation();const r=e.receipts.find(r=>r.xmlPath)!;const url=await apiBlobUrl('/api/finance/expenses/receipts/'+r.id+'/xml');const a=document.createElement('a');a.href=url;a.download='peppol.xml';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}}>XML</button>}
                    {e.source === 'chat' && <span className="badge plain" style={{ marginLeft: 6 }} title="Envoyée depuis le fil de chantier — à vérifier">📎 Fil de chantier</span>}
                    {e.source === 'email' && <span className="badge plain" style={{ marginLeft: 6 }} title="Reçue sur la boîte mail factures — à vérifier">✉️ Boîte mail</span>}
                  </td>
                  <td className="mono" style={{ fontSize: '0.82rem' }}>{e.docNumber ?? '—'}
                    {foxEligible(e) && <div className="muted" style={{ fontSize: '0.72rem', marginTop: 4 }} title={e.foxTransmittedAt ? 'Dépôt confirmé manuellement dans JJD' : 'Le téléchargement ne confirme pas le dépôt dans Fox'}>
                      {e.foxTransmittedAt ? 'Fox : transmis le ' + formatDateBE(e.foxTransmittedAt) : e.foxExportedAt ? 'Fox : ZIP préparé · dépôt à confirmer' : 'Fox : à transmettre'}
                    </div>}
                  </td>
                  <td className="mono">{e.allocations && e.allocations.length > 1 ? `${e.worksite?.ref ?? e.allocations[0]!.worksite.ref} +${e.allocations.length - 1}` : (e.worksite?.ref ?? (e.vehicle ? `🚗 ${vehicleName(e.vehicle)}` : '—'))}</td>
                  <td>{e.categoryLabel ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}><Money value={e.ht} /></td>
                  <td style={{ textAlign: 'right' }}><Money value={e.ttc ?? e.ht} /></td>
                  <td>
                    <span className={`badge ${e.paid ? 'ok' : isOverdue(e) ? 'crit' : 'warn'}`}>
                      {e.paid ? tr("Payé") : e.paidAmount > 0 ? tr("Partiellement payé") : isOverdue(e) ? tr("En retard") : tr("Non payé")}
                    </span>
                    {e.paidAmount > 0 && !e.paid && <div style={{ fontSize: '0.78rem', marginTop: 4 }}>Payé : <Money value={e.paidAmount} /><br />Reste : <Money value={e.remainingAmount} /></div>}
                    {!e.paid && e.dueDate && (
                      <div className="muted" style={{ fontSize: '0.72rem', marginTop: 2, whiteSpace: 'nowrap' }}>
                        {isOverdue(e) ? 'Solde en retard · ' : 'éch. '}{formatDateBE(e.dueDate)}
                      </div>
                    )}
                  </td>
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

/* ------------------------------------------------------------- avoir imputé sur une facture */

interface CreditInfo { role: 'credit' | 'invoice' | null; total: number; remaining: number; applications: { id: string; amount: number; appliedOn: string; other: { id: string; docNumber: string | null; date: string | null } }[]; candidates: { id: string; docNumber: string | null; date: string | null; worksiteRef: string | null; remaining: number }[] }

/**
 * Dans la fiche d'un avoir ou d'une facture d'achat : imputer le crédit de l'avoir sur une facture que le fournisseur a réglée avec ce crédit
 * (sans virement). La facture passe « payée » à hauteur du montant, et le crédit restant de l'avoir diminue d'autant.
 */
function CreditApplications({ expense, onChanged }: { expense: Expense; onChanged: () => void }) {
  const [info, setInfo] = useState<CreditInfo | null>(null);
  const [other, setOther] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = () => api<CreditInfo>(`/api/finance/expenses/${expense.id}/credit-applications`).then(setInfo).catch(() => setInfo(null));
  useEffect(() => { void load(); }, [expense.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!info || !info.role) return null;
  const isCredit = info.role === 'credit';
  if (!info.applications.length && !info.candidates.length) return null; // rien à imputer, rien d'imputé : on n'encombre pas la fiche
  const cand = info.candidates.find((c) => c.id === other);
  const defaultAmount = cand ? Math.min(cand.remaining, isCredit ? info.remaining : cand.remaining) : 0;
  async function apply() {
    setBusy(true); setErr(null);
    try {
      await api(`/api/finance/expenses/${expense.id}/apply-credit`, { method: 'POST', body: { otherId: other, amount: Number((amount || String(defaultAmount)).replace(',', '.')) } });
      setOther(''); setAmount(''); await load(); onChanged();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function unapply(id: string) {
    if (!window.confirm('Annuler cette imputation ? Le crédit de l’avoir est rendu et la facture redevient à payer.')) return;
    setBusy(true); setErr(null);
    try { await api(`/api/finance/expenses/credit-applications/${id}`, { method: 'DELETE' }); await load(); onChanged(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="banner" style={{ margin: '0 1.2rem 0.6rem', display: 'block' }}>
      <strong>{isCredit ? '🧾 Imputation de l’avoir sur des factures' : '🧾 Avoir imputé sur cette facture'}</strong>
      <div className="muted" style={{ fontSize: '0.84rem', margin: '0.2rem 0 0.4rem' }}>
        {isCredit
          ? `Crédit restant : ${formatEur(info.remaining)} sur ${formatEur(info.total)}. Quand le fournisseur règle une facture avec cet avoir (sans virement), imputez-la ici : elle passe « payée » et le crédit diminue.`
          : `Reste à payer sur cette facture : ${formatEur(info.remaining)}. Si le fournisseur l'a réglée avec un avoir, imputez-le ici.`}
      </div>
      {info.applications.map((a) => (
        <div key={a.id} style={{ display: 'flex', gap: '0.7rem', alignItems: 'center', fontSize: '0.88rem', padding: '0.15rem 0' }}>
          <span className="mono">{a.other.docNumber ?? 'sans n°'}</span>
          <span className="muted">{formatDateBE(a.appliedOn)}</span>
          <span style={{ marginLeft: 'auto' }}>{formatEur(a.amount)}</span>
          <button type="button" className="btn ghost" style={{ padding: '0.1rem 0.4rem' }} disabled={busy} onClick={() => unapply(a.id)} title="Annuler cette imputation">✕</button>
        </div>
      ))}
      {info.candidates.length > 0 && (
        <div className="row" style={{ gap: '0.5rem', marginTop: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <select className="select" style={{ width: 'auto', maxWidth: 320 }} value={other} onChange={(e) => { setOther(e.target.value); setAmount(''); }} aria-label={isCredit ? 'Facture' : 'Avoir'}>
            <option value="">{isCredit ? '— facture à régler avec cet avoir —' : '— avoir à imputer —'}</option>
            {info.candidates.map((c) => <option key={c.id} value={c.id}>{[c.docNumber ?? 'sans n°', c.date && formatDateBE(c.date), c.worksiteRef, `${formatEur(c.remaining)} ${isCredit ? 'à payer' : 'de crédit'}`].filter(Boolean).join(' · ')}</option>)}
          </select>
          {other && <input className="input" inputMode="decimal" style={{ width: 120 }} value={amount || String(defaultAmount)} onChange={(e) => setAmount(e.target.value)} aria-label="Montant TTC imputé" />}
          <button type="button" className="btn primary" disabled={busy || !other} onClick={apply}>Imputer</button>
        </div>
      )}
      {err && <div className="badge crit" style={{ marginTop: 4 }}>{err}</div>}
    </div>
  );
}

/* ------------------------------------------------------------- bordereaux reliés à une facture */

/**
 * Dans la fiche d'une facture d'achat : les bordereaux reliés (cliquables), ce qu'il reste à couvrir (la facture est saisie à son total,
 * on relie ensuite les bordereaux jusqu'à tout couvrir), la répartition par chantier calculée, et les bordereaux du fournisseur encore à relier.
 */
function LinkedSlips({ expense, onOpen, onChanged }: { expense: Expense; onOpen: (id: string) => void; onChanged: () => void }) {
  const slips = expense.bordereaux ?? [];
  const coveredHt = Math.round(slips.reduce((a, b) => a + b.ht, 0) * 100) / 100;
  const coveredTtc = Math.round(slips.reduce((a, b) => a + (b.ttc ?? b.ht), 0) * 100) / 100;
  const remainingHt = Math.round((expense.ht - coveredHt) * 100) / 100;
  const remainingTtc = expense.ttc != null ? Math.round((expense.ttc - coveredTtc) * 100) / 100 : null;
  const [pending, setPending] = useState<Expense[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const qs = new URLSearchParams({ type: 'delivery_slip', linked: '0', pageSize: '200' });
    if (expense.contactId) qs.set('contactId', expense.contactId); else if (expense.supplier) qs.set('q', expense.supplier);
    api<{ items: Expense[] }>(`/api/finance/expenses?${qs.toString()}`).then((r) => setPending(r.items)).catch(() => setPending([]));
  }, [open, expense.id, expense.contactId, expense.supplier, slips.length]);

  async function link(slipId: string, invoiceId: string | null) {
    setBusy(slipId); setErr(null);
    try { await api(`/api/finance/expenses/${slipId}/link`, { method: 'POST', body: { invoiceId } }); onChanged(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }
  async function openPdf(id: string) { window.open(await apiBlobUrl(`/api/finance/expenses/${id}/pdf`), '_blank'); }

  const status = !slips.length ? null
    : Math.abs(remainingHt) <= 0.05 ? { cls: 'ok', text: '✓ Tous les bordereaux sont reliés : la facture est entièrement couverte.' }
      : remainingHt > 0 ? { cls: 'warn', text: `Il reste ${formatEur(remainingHt)} HT${remainingTtc != null ? ` (${formatEur(remainingTtc)} TTC)` : ''} à couvrir : bordereaux manquants.` }
        : { cls: 'crit', text: `Les bordereaux dépassent la facture de ${formatEur(-remainingHt)} HT : vérifiez les montants.` };

  return (
    <div className="banner" style={{ margin: '0 1.2rem 0.6rem', display: 'block' }}>
      <strong>📦 {slips.length ? `${slips.length} bordereau${slips.length > 1 ? 'x' : ''} relié${slips.length > 1 ? 's' : ''} à cette facture` : 'Aucun bordereau relié'}</strong>
      <div className="muted" style={{ fontSize: '0.84rem', margin: '0.2rem 0 0.4rem' }}>
        Ils ne forment qu’une seule dépense avec la facture : leur paiement est celui de la facture, et ils ne sont pas comptés en plus dans les totaux.
      </div>
      {slips.length > 0 && (
        <div style={{ fontSize: '0.88rem', marginBottom: '0.4rem' }}>
          Bordereaux reliés : <strong>{formatEur(coveredHt)} HT</strong> sur <strong>{formatEur(expense.ht)} HT</strong> de facture
          {status && <div className={`badge ${status.cls}`} style={{ marginTop: 4, padding: '0.3rem 0.6rem', display: 'inline-block' }}>{status.text}</div>}
        </div>
      )}
      {!!expense.worksiteAllocation?.length && (
        <div style={{ margin: '0.3rem 0 0.5rem', padding: '0.5rem 0.6rem', background: 'var(--surface)', borderRadius: 8 }}>
          <strong style={{ fontSize: '0.88rem' }}>Répartition par chantier (automatique, d’après les bordereaux)</strong>
          {!!expense.worksiteId && <div className="muted" style={{ fontSize: '0.8rem' }}>Cette facture est rattachée à un chantier : le reste non couvert par un bordereau lui revient. Pour qu’elle n’en ait aucun en propre, videz le champ « Chantier » ci-dessous.</div>}
          {expense.worksiteAllocation.map((a, i) => (
            <div key={i} style={{ display: 'flex', gap: '0.8rem', fontSize: '0.88rem', padding: '0.1rem 0' }}>
              <span className="mono">{a.ref ?? 'Sans chantier'}</span>
              <span className="muted">{a.worksiteId === expense.worksiteId ? 'reste de la facture (non couvert par un bordereau)' : 'bordereaux de ce chantier'}</span>
              <span style={{ marginLeft: 'auto' }}>{formatEur(a.ht)} HT</span>
            </div>
          ))}
        </div>
      )}
      {slips.map((b) => (
        <div key={b.id} style={{ display: 'flex', gap: '0.7rem', alignItems: 'center', fontSize: '0.88rem', padding: '0.2rem 0' }}>
          <button type="button" className="btn ghost" style={{ padding: '0.1rem 0.4rem' }} onClick={() => onOpen(b.id)} title="Ouvrir ce bordereau">
            <span className="mono">{b.docNumber ?? 'sans n°'}</span>
          </button>
          <span>{b.date ? formatDateBE(b.date) : ''}</span>
          <span className="muted">{b.worksite?.ref ?? 'sans chantier'}</span>
          <span style={{ marginLeft: 'auto' }}>{formatEur(b.ttc ?? b.ht)}</span>
          {b.pdfPath && <button type="button" className="btn ghost" style={{ padding: '0.1rem 0.4rem' }} onClick={() => openPdf(b.id)} title="Voir le PDF du bordereau">PDF</button>}
          <button type="button" className="btn ghost" style={{ padding: '0.1rem 0.4rem' }} disabled={busy === b.id} onClick={() => link(b.id, null)} title="Délier de cette facture">✕</button>
        </div>
      ))}
      <div style={{ marginTop: '0.4rem' }}>
        <button type="button" className="btn" onClick={() => setOpen((o) => !o)}>{open ? 'Masquer' : '+ Relier un bordereau'}</button>
      </div>
      {open && (
        <div style={{ marginTop: '0.4rem', borderTop: '1px solid var(--line)', paddingTop: '0.4rem' }}>
          {pending === null ? <span className="muted">Chargement…</span> : pending.length === 0
            ? <span className="muted" style={{ fontSize: '0.86rem' }}>Aucun bordereau en attente pour ce fournisseur.</span>
            : pending.map((b) => (
              <div key={b.id} style={{ display: 'flex', gap: '0.7rem', alignItems: 'center', fontSize: '0.88rem', padding: '0.2rem 0' }}>
                <span className="mono">{b.docNumber ?? 'sans n°'}</span>
                <span>{b.date ? formatDateBE(b.date) : ''}</span>
                <span className="muted">{b.worksite?.ref ?? 'sans chantier'}</span>
                <span style={{ marginLeft: 'auto' }}>{formatEur(b.ttc ?? b.ht)}</span>
                <button type="button" className="btn primary" disabled={busy === b.id} onClick={() => link(b.id, expense.id)}>Relier</button>
              </div>
            ))}
        </div>
      )}
      {err && <div className="badge crit" style={{ marginTop: 4 }}>{err}</div>}
    </div>
  );
}

/* ------------------------------------------------------------- modale créer / éditer */

function ExpenseModal({
  expense,
  prefillFrom,
  meta,
  onClose,
  onSaved,
  onOpenOther,
  onChanged,
  onMerge,
}: {
  expense: Expense | null;
  /** fusionne les lignes de la même facture */
  onMerge?: (e: Expense) => void;
  /** Bordereau d'origine : « Facture reçue… » depuis un bordereau — préremplit fournisseur/chantier,
   *  et la facture créée est reliée automatiquement au bordereau une fois enregistrée. */
  prefillFrom?: Expense | null;
  meta: Meta;
  onClose: () => void;
  onSaved: () => void;
  /** ouvre une autre dépense (un bordereau relié) à la place de celle-ci */
  onOpenOther: (id: string) => void;
  /** la facture a changé (bordereau relié / délié) : recharge-la sans fermer la fenêtre */
  onChanged: () => void;
}) {
  const [v, setV] = useState({
    date: toDateInput(expense?.date ?? new Date().toISOString()),
    dueDate: toDateInput(expense?.dueDate ?? null),
    direction: (prefillFrom ? 'purchase' : expense?.direction === 'credit_note' ? 'credit_note' : expense?.direction === 'delivery_slip' ? 'delivery_slip' : expense?.direction === 'sale' ? 'sale' : 'purchase') as 'purchase' | 'sale' | 'credit_note' | 'delivery_slip',
    supplierName: (expense ?? prefillFrom)?.contactId ? '' : ((expense ?? prefillFrom)?.supplierName ?? ''),
    contactId: (expense ?? prefillFrom)?.contactId ?? '',
    docNumber: expense?.docNumber ?? '',
    categoryCode: (expense ?? prefillFrom)?.categoryCode ?? '',
    categoryRaw: (expense ?? prefillFrom)?.categoryRaw ?? '',
    // « Facture reçue… » depuis un bordereau : la facture n'a pas de chantier propre (elle ne fait que regrouper des bordereaux) ;
    // son coût suit le chantier de chaque bordereau relié
    worksiteId: expense ? (expense.worksiteId ?? '') : '',
    vehicleId: (expense ?? prefillFrom)?.vehicleId ?? '',
    // « Facture reçue… » depuis un bordereau : on part des montants du bordereau (à remplacer par ceux de la facture si elle en regroupe plusieurs)
    ht: expense?.ht != null ? String(expense.ht) : prefillFrom?.ht ? String(prefillFrom.ht) : '',
    vatRecup: expense?.vatRecup != null ? String(expense.vatRecup) : prefillFrom?.ttc != null && prefillFrom.ht ? String(Math.round((prefillFrom.ttc - prefillFrom.ht) * 100) / 100) : '',
    ttc: expense?.ttc != null ? String(expense.ttc) : prefillFrom?.ttc != null ? String(prefillFrom.ttc) : '',
    // taux de TVA (en %) : sert à calculer TVA et TTC depuis le HT, ou HT et TVA depuis le TTC
    vatRate: initialVatRate(expense ?? (prefillFrom ? { vatRate: null, ht: prefillFrom.ht ?? 0, ttc: prefillFrom.ttc ?? null, vatRecup: null } : null)),
    notes: expense?.notes ?? (prefillFrom ? `Bordereau ${prefillFrom.docNumber ?? ''}`.trim() : ''),
    paymentStatus: (expense?.paid ? 'Payé' : 'Non payé') as 'Payé' | 'Non payé',
  });
  // Une facture peut couvrir plusieurs chantiers (ex. sous-traitant intervenu sur
  // plusieurs R-) : au-delà d'une ligne, le chantier unique + montant HT global sont
  // remplacés par une répartition manuelle, HT par chantier. Sur une dépense existante, la 1re ligne
  // met à jour la dépense en place (son rapprochement bancaire éventuel y reste attaché) et les
  // suivantes créent les autres parts, avec le même PDF.
  const [splits, setSplits] = useState<{ worksiteId: string; ht: string }[] | null>(
    expense?.allocations && expense.allocations.length > 1 ? expense.allocations.map((a) => ({ worksiteId: a.worksiteId, ht: String(Math.abs(a.ht)) })) : null,
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractNote, setExtractNote] = useState<string | null>(null);
  const [bankMatches, setBankMatches] = useState<BankMatch[]>([]);
  const [bankSug, setBankSug] = useState<BankTx[] | null>(null);
  // recherche libre d'un paiement : texte (libellé, contrepartie, communication), montant, dates, paiements déjà rapprochés compris
  const [payOpen, setPayOpen] = useState(false);
  const [pay, setPay] = useState({ q: '', amount: '', from: '', to: '', all: false });
  const [payRes, setPayRes] = useState<BankTx[] | null>(null);
  const [payBusy, setPayBusy] = useState(false);

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
        suggestedCategory: { code: string; label: string; source: 'supplier' | 'ai' } | null;
        extraction: {
          kind: string | null; docNumber: string | null; issuedOn: string | null; dueOn: string | null;
          totalHt: number | null; totalTtc: number | null; totalVat: number | null; vatRate: number | null;
          contactId: string | null; worksiteId: string | null; worksiteRef: string | null;
          otherWorksiteRefs: string[]; textExtracted: boolean;
        };
      }>('/api/finance/expenses/extract', fd);
      const ex = r.extraction;
      const sug = r.suggestedCategory;
      const sugNote = sug ? `Catégorie proposée : ${sug.label} (${sug.source === 'supplier' ? 'd’après les factures précédentes de ce fournisseur' : 'lecture du PDF'}) — à vérifier.` : '';
      if (sug) setV((prev) => ({ ...prev, categoryCode: prev.categoryCode || sug.code }));
      if (!ex.textExtracted) { setExtractNote(`PDF sans texte lisible (scan/photo) — à compléter à la main. ${sugNote}`.trim()); return; }
      if (sugNote) setExtractNote(sugNote);
      const ht = ex.totalHt ?? (ex.totalTtc != null ? Math.round((ex.totalTtc / (1 + (ex.vatRate ?? 0.21))) * 100) / 100 : null);
      // la TVA récupérable = le montant de TVA lu tel quel dans le PDF quand il a été trouvé de
      // façon fiable (le repère isolé "TVA 21% …" est peu sûr — souvent noyé dans un tableau —
      // mais un montant retrouvé par recoupement structurel, ex. dans un tableau HT/TVA/TTC où
      // HT + TVA retombe exactement sur le TTC, l'est) ; sinon TTC − HT en repli.
      const vatRecup = ex.totalVat ?? (ht != null && ex.totalTtc != null ? Math.round((ex.totalTtc - ht) * 100) / 100 : null);
      setV((prev) => ({
        ...prev,
        direction: ex.kind === 'credit_note' ? 'credit_note' : ex.kind === 'delivery_slip' ? 'delivery_slip' : prev.direction,
        date: ex.issuedOn || prev.date,
        dueDate: prev.dueDate || ex.dueOn || '',
        docNumber: prev.docNumber || ex.docNumber || '',
        worksiteId: prev.worksiteId || ex.worksiteId || '',
        contactId: prev.contactId || ex.contactId || '',
        ht: prev.ht || (ht != null ? String(ht) : ''),
        vatRecup: prev.vatRecup || (vatRecup != null ? String(vatRecup) : ''),
        ttc: prev.ttc || (ex.totalTtc != null ? String(ex.totalTtc) : ''),
        vatRate: prev.ht || prev.ttc ? prev.vatRate
          : ex.vatRate != null && (VAT_RATES as readonly string[]).includes(String(r2(ex.vatRate * 100))) ? String(r2(ex.vatRate * 100))
          : guessVatRate(ht, vatRecup),
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
      api<{ expense: { bankMatches: BankMatch[] } }>(`/api/finance/expenses/${expense.id}`)
        .then((r) => setBankMatches(r.expense.bankMatches))
        .catch(() => {});
    }
  }, [expense]);

  async function searchPayment() {
    if (!expense) return;
    const r = await api<{ items: BankTx[] }>(`/api/finance/expenses/${expense.id}/bank-suggestions`);
    setBankSug(r.items);
  }
  async function runPaymentSearch() {
    if (!expense) return;
    setPayBusy(true);
    try {
      const qs = new URLSearchParams();
      if (pay.q.trim()) qs.set('q', pay.q.trim());
      if (pay.amount.trim()) qs.set('amount', pay.amount.trim());
      if (pay.from) qs.set('from', pay.from);
      if (pay.to) qs.set('to', pay.to);
      if (pay.all) qs.set('all', '1');
      const r = await api<{ items: BankTx[] }>(`/api/finance/expenses/${expense.id}/bank-suggestions?${qs}`);
      setPayRes(r.items);
    } finally {
      setPayBusy(false);
    }
  }
  async function linkPayment(txId: string) {
    if (!expense) return;
    await api(`/api/finance/bank/${txId}/matches`, { method: 'POST', body: { ledgerId: expense.id } });
    setBankSug(null);
    onSaved();
    onClose();
  }
  async function unlinkPayment(m: BankMatch) {
    await api(`/api/finance/bank/${m.id}/matches/${m.matchId}`, { method: 'DELETE' });
    onSaved();
    onClose();
  }

  // Montants liés : HT + taux → TVA et TTC ; TTC + taux → HT et TVA ; TVA saisie à la main → TTC = HT + TVA.
  // On retient le dernier montant tapé (HT ou TTC) pour savoir dans quel sens recalculer quand on change le taux.
  const [anchor, setAnchor] = useState<'ht' | 'ttc'>('ht');
  const splitsHt = splits ? r2(splits.reduce((sum, s) => sum + (Number(s.ht) || 0), 0)) : null;
  function recalc(next: typeof v, from: 'ht' | 'ttc' | 'vat'): typeof v {
    const ht = splitsHt ?? Number(next.ht);
    const ttc = Number(next.ttc);
    if (from === 'vat') {
      const vat = Number(next.vatRecup);
      if (next.vatRecup !== '' && Number.isFinite(vat) && next.ht !== '' && Number.isFinite(ht)) return { ...next, ttc: String(r2(ht + vat)), vatRate: guessVatRate(ht, vat) };
      return next;
    }
    if (next.vatRate === 'mix') {
      // plusieurs taux : on garde la TVA saisie et on boucle HT ↔ TTC avec elle
      const vat = Number(next.vatRecup || 0);
      if (from === 'ht' && next.ht !== '' && Number.isFinite(ht)) return { ...next, ttc: String(r2(ht + vat)) };
      if (from === 'ttc' && next.ttc !== '' && Number.isFinite(ttc) && splitsHt == null && next.ht !== '') return { ...next, vatRecup: String(r2(ttc - Number(next.ht))) };
      return next;
    }
    const rate = Number(next.vatRate) / 100;
    if (from === 'ht' || splitsHt != null) {
      if ((splitsHt == null && next.ht === '') || !Number.isFinite(ht)) return next;
      if (from === 'ttc' && splitsHt != null) return next.ttc === '' ? next : { ...next, vatRecup: String(r2(ttc - ht)) };
      const vat = r2(ht * rate);
      return { ...next, vatRecup: String(vat), ttc: String(r2(ht + vat)) };
    }
    if (next.ttc === '' || !Number.isFinite(ttc)) return next;
    const newHt = r2(ttc / (1 + rate));
    return { ...next, ht: String(newHt), vatRecup: String(r2(ttc - newHt)) };
  }
  function set(k: string, val: string) {
    if (k === 'ht' || k === 'ttc') setAnchor(k);
    setV((prev) => {
      const next = { ...prev, [k]: val };
      if (k === 'ht' || k === 'ttc') return recalc(next, k);
      if (k === 'vatRecup') return recalc(next, 'vat');
      if (k === 'vatRate') return recalc(next, anchor);
      return next;
    });
  }
  // répartition sur plusieurs chantiers : le HT est la somme des parts, TVA et TTC suivent
  // (pas à l'ouverture : une dépense existante garde ses montants tant qu'on ne touche pas aux parts)
  const lastSplitsHt = useRef(splitsHt);
  useEffect(() => {
    if (splitsHt == null || splitsHt === lastSplitsHt.current) return;
    lastSplitsHt.current = splitsHt;
    setV((prev) => recalc(prev, 'ht'));
  }, [splitsHt]); // eslint-disable-line react-hooks/exhaustive-deps

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
        const totalHt = Math.round(splits.reduce((sum, s) => sum + Number(s.ht), 0) * 100) / 100;
        // Sur une dépense existante, on ne change pas le montant global par mégarde : la somme doit rester égale.
        if (expense && Math.abs(totalHt - expense.ht) > 0.01) {
          throw new Error(`La somme des parts (${totalHt.toFixed(2)} €) doit égaler le HT de la facture (${expense.ht.toFixed(2)} €).`);
        }
        // UNE seule fiche (un PDF, un paiement, un rapprochement) : la répartition est enregistrée avec elle
        const body = {
          ...commonBody(),
          worksiteId: splits[0]!.worksiteId,
          ht: totalHt,
          ttc: v.ttc === '' ? null : Number(v.ttc),
          vatRecup: v.vatRecup === '' ? null : Number(v.vatRecup),
          vatRate: v.vatRate === 'mix' ? null : Number(v.vatRate) / 100,
          allocations: splits.map((s) => ({ worksiteId: s.worksiteId, ht: Number(s.ht) })),
        };
        const saved = expense
          ? await api<{ expense: { id: string } }>(`/api/finance/expenses/${expense.id}`, { method: 'PATCH', body })
          : await api<{ expense: { id: string } }>('/api/finance/expenses', { method: 'POST', body });
        await attachFile(saved.expense.id);
        onSaved();
        return;
      }

      const body = {
        ...commonBody(),
        worksiteId: v.worksiteId || null,
        ht: Number(v.ht || 0),
        vatRecup: v.vatRecup === '' ? null : Number(v.vatRecup),
        ttc: v.ttc === '' ? null : Number(v.ttc),
        vatRate: v.vatRate === 'mix' ? null : Number(v.vatRate) / 100,
        // la fiche était répartie et on revient à un seul chantier : on efface la répartition
        ...(expense?.allocations && expense.allocations.length > 1 ? { allocations: [] as { worksiteId: string; ht: number }[] } : {}),
      };
      const saved = expense
        ? await api<{ expense: { id: string } }>(`/api/finance/expenses/${expense.id}`, { method: 'PATCH', body })
        : await api<{ expense: { id: string } }>('/api/finance/expenses', { method: 'POST', body });
      await attachFile(saved.expense.id);
      // « Facture reçue… » depuis un bordereau : la nouvelle facture est reliée dès sa création
      if (!expense && prefillFrom) {
        await api(`/api/finance/expenses/${prefillFrom.id}/link`, { method: 'POST', body: { invoiceId: saved.expense.id } });
      }
      onSaved();
    } catch (e2) {
      setErr((e2 as Error).message ?? 'Erreur');
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim">
      <form className="modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <h2>{expense ? 'Modifier la dépense' : prefillFrom ? `Facture reçue — bordereau ${prefillFrom.docNumber ?? ''}` : tr("Nouvelle dépense")}</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label={tr("Fermer")}>✕</button>
        </div>
        {!!expense?.siblingIds?.length && onMerge && (
          <div className="banner warn" style={{ margin: '0 1.2rem 0.6rem', display: 'block' }}>
            <strong>Cette facture a {expense.siblingIds.length} autre{expense.siblingIds.length > 1 ? 's' : ''} ligne{expense.siblingIds.length > 1 ? 's' : ''}</strong> (même fournisseur, même n°).
            <div className="muted" style={{ fontSize: '0.84rem', margin: '0.2rem 0 0.4rem' }}>Une seule fiche avec une répartition par chantier évite les doubles saisies : un PDF, un paiement, un rapprochement.</div>
            <button type="button" className="btn" onClick={() => onMerge(expense)}>Fusionner les lignes de cette facture…</button>
          </div>
        )}
        {expense?.direction === 'purchase' && <LinkedSlips expense={expense} onOpen={onOpenOther} onChanged={onChanged} />}
        {(expense?.direction === 'purchase' || expense?.direction === 'credit_note') && <CreditApplications expense={expense} onChanged={onChanged} />}
        {prefillFrom && (
          <div className="banner success" style={{ margin: '0 1.2rem 0.6rem' }}>
            <span className="txt">Reliée automatiquement au bordereau {prefillFrom.docNumber ?? ''} ({prefillFrom.supplier ?? 'fournisseur'}) à l’enregistrement. Les montants du bordereau sont repris : remplacez-les par ceux de la facture si elle regroupe plusieurs bordereaux. La facture n’a pas de chantier propre : son coût suit le chantier de chaque bordereau relié.</span>
          </div>
        )}
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
            <select className="select" value={v.direction} disabled={!!prefillFrom} onChange={(e) => set('direction', e.target.value)}>
              <option value="purchase">Facture d’achat</option>
              <option value="credit_note">Note de crédit fournisseur</option>
              <option value="delivery_slip">Bordereau (en attente de facture)</option>
            </select>
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>{tr("Fournisseur")}</label>
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
            <label>{v.direction === 'delivery_slip' ? 'N° de bordereau' : v.direction === 'credit_note' ? 'N° de note de crédit' : 'N° de facture'}</label>
            <input className="input" value={v.docNumber} onChange={(e) => set('docNumber', e.target.value)} />
          </div>
          <div className="field">
            <label>{tr("Catégorie")}</label>
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
                      placeholder={tr("Chantier")}
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
                  {expense && <> · HT de la facture : {expense.ht} € (la somme doit être identique) · une seule fiche : un PDF, un paiement</>}
                </span>
              </div>
            </div>
          ) : (
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label> {tr("Chantier")} {(!expense || expense.splittable !== false) && (
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
            <label>Taux de TVA</label>
            <select className="select" value={v.vatRate} onChange={(e) => set('vatRate', e.target.value)}>
              <option value="21">21 %</option>
              <option value="12">12 %</option>
              <option value="6">6 %</option>
              <option value="0">0 % (autoliquidation / exonéré)</option>
              <option value="mix">Plusieurs taux (TVA à saisir)</option>
            </select>
          </div>
          <div className="field">
            <label>Montant TVA</label>
            <input className="input" type="number" step="any" value={v.vatRecup} onChange={(e) => set('vatRecup', e.target.value)} title="Calculé d’après le taux ; modifiable pour un arrondi ou une facture à plusieurs taux" />
          </div>
          <div className="field">
            <label>{tr("Montant TTC")}</label>
            <input className="input" type="number" step="any" value={v.ttc} onChange={(e) => set('ttc', e.target.value)} />
          </div>
          <div className="field">
            <label>Statut</label>
            {bankMatches.length > 0 ? <div className="muted">{expense?.paymentStatus ?? 'Rapproché'} — calculé d’après les paiements liés</div> : <select className="select" value={v.paymentStatus} onChange={(e) => set('paymentStatus', e.target.value)}>
              <option value="Non payé">{tr("Non payé")}</option>
              <option value="Payé">{tr("Payé")}</option>
            </select>}
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
              {expense.paidAmount > 0 && <p>Payé : <Money value={expense.paidAmount} /> · Reste à payer : <Money value={expense.remainingAmount} /></p>}
              {bankMatches.length > 0 && (
                <div className="grid" style={{ gap: '0.4rem', marginBottom: '0.5rem' }}>
                  {bankMatches.map((m) => (
                    <div key={m.matchId} className="row" style={{ gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className="badge ok">Rapproché</span>
                      <span>{formatDateBE(m.bookingDate)} · <Money value={m.allocatedAmount} /> affectés à cette facture · {m.bank ?? '—'}</span>
                      {m.counterpartyName && <span className="muted">{m.counterpartyName}</span>}
                      <button type="button" className="btn" onClick={() => unlinkPayment(m)}>Délier</button>
                    </div>
                  ))}
                </div>
              )}
              {bankSug && bankSug.length > 0 && !payOpen && (
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
                </div>
              )}
              {bankSug && bankSug.length === 0 && !payOpen && bankMatches.length === 0 && (
                <span className="muted">Aucune transaction bancaire non rapprochée ne correspond (montant ± 1 €, ± 2 mois) — utilise « Chercher dans la banque » pour chercher autrement.</span>
              )}
              {payOpen && (
                <div className="card card-pad" style={{ display: 'grid', gap: '0.5rem', background: 'var(--surface-2)' }}>
                  <div className="muted" style={{ fontSize: '0.8rem' }}>
                    Cherche dans tous les mouvements de la banque : un mot du libellé, de la contrepartie ou de la communication (plusieurs mots = tous doivent y être), un montant (± 0,50 €), une période.
                  </div>
                  <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.5rem' }}>
                    <input className="input" placeholder="Texte (ex. vector, REF, n° facture…)" value={pay.q} onChange={(e) => setPay({ ...pay, q: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runPaymentSearch(); } }} />
                    <input className="input" placeholder="Montant (ex. 120,50)" inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runPaymentSearch(); } }} />
                    <input className="input" type="date" aria-label="Du" value={pay.from} onChange={(e) => setPay({ ...pay, from: e.target.value })} />
                    <input className="input" type="date" aria-label="Au" value={pay.to} onChange={(e) => setPay({ ...pay, to: e.target.value })} />
                  </div>
                  <label className="row" style={{ gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem' }}>
                    <input type="checkbox" checked={pay.all} onChange={(e) => setPay({ ...pay, all: e.target.checked })} />
                    Inclure les paiements déjà rapprochés à une autre facture
                  </label>
                  <div className="row" style={{ gap: '0.5rem' }}>
                    <button type="button" className="btn primary" disabled={payBusy} onClick={runPaymentSearch}>{payBusy ? tr("Recherche…") : tr("Chercher")}</button>
                    <button type="button" className="btn ghost" onClick={() => { setPayOpen(false); setPayRes(null); }}>{tr("Fermer")}</button>
                  </div>
                  {payRes && (payRes.length === 0 ? (
                    <span className="muted">Aucun mouvement ne correspond à cette recherche.</span>
                  ) : (
                    <div className="grid" style={{ gap: '0.35rem', maxHeight: 320, overflowY: 'auto' }}>
                      {payRes.map((t) => (
                        <button key={t.id} type="button" className="btn" style={{ justifyContent: 'space-between', textAlign: 'left', height: 'auto', padding: '0.4rem 0.6rem' }} onClick={() => linkPayment(t.id)}>
                          <span style={{ minWidth: 0 }}>
                            {t.nameMatch && <span className="badge ok" style={{ marginRight: 6 }}>fournisseur ✓</span>}
                            {t.matchedTo && t.matchedTo.length > 0 && <span className="badge warn" style={{ marginRight: 6 }}>déjà lié : {t.matchedTo.slice(0, 2).join(', ')}{t.matchedTo.length > 2 ? '…' : ''}</span>}
                            {formatDateBE(t.bookingDate)} · {t.counterpartyName ?? '—'} · {t.bank ?? ''}
                            <span className="muted" style={{ display: 'block', fontSize: '0.76rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {(t.description ?? t.communication ?? '').replace(/\s+/g, ' ').slice(0, 120)}
                            </span>
                          </span>
                          <Money value={t.amount} sign />
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              {!payOpen && (
                <div className="row" style={{ gap: '0.5rem', marginTop: bankSug || bankMatches.length ? '0.5rem' : 0, flexWrap: 'wrap' }}>
                  {!bankSug && bankMatches.length === 0 && <button type="button" className="btn" onClick={searchPayment}>Proposer les paiements au même montant</button>}
                  <button type="button" className="btn" onClick={() => { setPayOpen(true); setPayRes(null); }}>{bankMatches.length > 0 ? 'Ajouter un paiement' : 'Chercher dans la banque'}</button>
                </div>
              )}
            </div>
          )}
        </div>
        {err && <div className="badge crit" style={{ margin: '0 1.15rem', padding: '0.4rem 0.7rem' }}>{err}</div>}
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>{tr("Annuler")}</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? tr("Enregistrement…") : tr("Enregistrer")}</button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------- modale lier un bordereau à une facture existante */

/**
 * Cas d'un fournisseur qui consolide plusieurs bordereaux sur une seule facture reçue : la
 * facture existe déjà côté app (créée pour un 1er bordereau via « Facture reçue… », ou saisie
 * normalement) — on cherche parmi les factures d'achat déjà enregistrées, filtrées d'abord sur
 * le même fournisseur.
 */
/** Taux de TVA proposés dans le formulaire de dépense (en %), « mix » = plusieurs taux / montant saisi à la main. */
const VAT_RATES = ['21', '12', '6', '0'] as const;
const r2 = (n: number) => Math.round(n * 100) / 100;
/** Taux standard le plus proche d'un HT/TVA donnés, sinon « mix » (taux multiples, arrondis du fournisseur…). */
function guessVatRate(ht: number | null | undefined, vat: number | null | undefined): string {
  if (!ht || vat == null || !Number.isFinite(ht) || !Number.isFinite(vat)) return '21';
  const pct = (Math.abs(vat) / Math.abs(ht)) * 100;
  return VAT_RATES.find((r) => Math.abs(Number(r) - pct) < 0.15) ?? 'mix';
}
function initialVatRate(e: { vatRate: number | null; ht: number; ttc: number | null; vatRecup: number | null } | null | undefined): string {
  if (!e) return '21';
  if (e.vatRate != null) { const pct = String(r2(e.vatRate * 100)); return (VAT_RATES as readonly string[]).includes(pct) ? pct : 'mix'; }
  return guessVatRate(e.ht, e.vatRecup ?? (e.ttc != null ? e.ttc - e.ht : null));
}

interface MergePreview { survivorId: string; docNumber: string | null; ht: number; ttc: number | null; vatRecup: number | null; removed: string[]; parts: { worksiteId: string; ref: string | null; ht: number }[]; warnings: string[] }

/** Fusionne les lignes d'une même facture en une seule fiche répartie par chantier : on montre d'abord le résultat, puis on confirme. */
function MergeModal({ expense, onClose, onMerged }: { expense: Expense; onClose: () => void; onMerged: () => void }) {
  const ids = [expense.id, ...(expense.siblingIds ?? [])];
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<{ preview: MergePreview }>('/api/finance/expenses/merge', { method: 'POST', body: { ids, dryRun: true } })
      .then((r) => setPreview(r.preview)).catch((e) => setErr((e as Error).message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function confirm() {
    setBusy(true); setErr(null);
    try { await api('/api/finance/expenses/merge', { method: 'POST', body: { ids } }); onMerged(); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  }
  return (
    <div className="modal-scrim" onClick={() => { if (!busy) onClose(); }}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>Fusionner les lignes de la facture {expense.docNumber ?? ''}</h2><button type="button" className="btn ghost" onClick={onClose} disabled={busy} aria-label="Fermer">✕</button></div>
        <div className="modal-body" style={{ display: 'grid', gap: 12 }}>
          <div className="muted">{expense.supplier ?? '—'} · {ids.length} lignes deviennent <strong>une seule fiche</strong>, répartie entre leurs chantiers. Un seul PDF, un seul paiement, un seul rapprochement bancaire.</div>
          {!preview && !err && <p role="status">Calcul du résultat…</p>}
          {preview && (
            <>
              <div className="card card-pad">
                <div><strong>Total : {formatEur(preview.ht)} HT</strong>{preview.ttc != null && <span className="muted"> · {formatEur(preview.ttc)} TTC</span>}</div>
                {preview.parts.map((p) => <div key={p.worksiteId} className="row" style={{ justifyContent: 'space-between' }}><span>{p.ref ?? 'Chantier'}</span><span className="tnum">{formatEur(p.ht)} HT</span></div>)}
              </div>
              {preview.warnings.map((w) => <p key={w} className="badge warn" style={{ whiteSpace: 'normal' }}>{w}</p>)}
              <div className="muted" style={{ fontSize: '0.82rem' }}>Les {preview.removed.length} autre{preview.removed.length > 1 ? 's' : ''} ligne{preview.removed.length > 1 ? 's sont supprimées' : ' est supprimée'} (conservée{preview.removed.length > 1 ? 's' : ''} dans le journal) ; leurs paiements rapprochés sont repris par la fiche restante.</div>
            </>
          )}
          {err && <p className="badge crit" role="alert" style={{ whiteSpace: 'normal' }}>{err}</p>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Annuler</button>
          <button type="button" className="btn primary" onClick={confirm} disabled={busy || !preview}>{busy ? 'Fusion…' : 'Fusionner'}</button>
        </div>
      </div>
    </div>
  );
}

function LinkSlipModal({ slip, onClose, onLinked }: { slip: Expense; onClose: () => void; onLinked: () => void }) {
  const [q, setQ] = useState('');
  const [sameSupplierOnly, setSameSupplierOnly] = useState(!!slip.contactId);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const params = new URLSearchParams({ type: 'purchase', pageSize: '30' });
  if (q.trim()) params.set('q', q.trim());
  if (sameSupplierOnly && slip.contactId) params.set('contactId', slip.contactId);
  const { data, loading } = useApi<{ items: Expense[] }>(`/api/finance/expenses?${params}`);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  async function link(invoiceId: string) {
    setBusy(invoiceId);
    setErr(null);
    try {
      await api(`/api/finance/expenses/${slip.id}/link`, { method: 'POST', body: { invoiceId } });
      onLinked();
    } catch (e) {
      setErr((e as Error).message ?? 'Erreur');
      setBusy(null);
    }
  }

  return (
    <div className="modal-scrim">
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Lier le bordereau {slip.docNumber ?? ''} à une facture</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label={tr("Fermer")}>✕</button>
        </div>
        <div className="modal-body" style={{ gridTemplateColumns: '1fr' }}>
          <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
            <input className="input" style={{ flex: 1, minWidth: 200 }} autoFocus placeholder="N° de facture, fournisseur…" value={q} onChange={(e) => setQ(e.target.value)} />
            {slip.contactId && (
              <label className="row" style={{ gap: '0.35rem', fontSize: '0.82rem', alignItems: 'center' }}>
                <input type="checkbox" checked={sameSupplierOnly} onChange={(e) => setSameSupplierOnly(e.target.checked)} />
                {slip.supplier} uniquement
              </label>
            )}
          </div>
          {loading && <p className="muted">{tr("Recherche…")}</p>}
          {!loading && data && data.items.length === 0 && <p className="muted">Aucune facture d’achat ne correspond.</p>}
          {!loading && data && data.items.length > 0 && (
            <div style={{ display: 'grid', gap: '0.4rem', maxHeight: 320, overflowY: 'auto' }}>
              {data.items.map((inv) => (
                <button
                  key={inv.id}
                  type="button"
                  className="btn"
                  style={{ justifyContent: 'space-between' }}
                  disabled={!!busy}
                  onClick={() => link(inv.id)}
                >
                  <span>{formatDateBE(inv.date)} · {inv.docNumber ?? 'sans n°'} · {inv.supplier ?? '—'}{inv.worksite ? ` · ${inv.worksite.ref}` : ''}</span>
                  <Money value={inv.ttc ?? inv.ht} />
                </button>
              ))}
            </div>
          )}
          {err && <div className="badge crit" style={{ padding: '0.4rem 0.7rem' }}>{err}</div>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>{tr("Annuler")}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Articles achetés souvent mais pas encore suivis en stock — lecture best-effort des factures
 * déjà reçues (voir lib/purchase-candidates.ts côté API) : juste un repère à vérifier, rien n'est
 * créé automatiquement.
 */
function PurchaseCandidatesModal({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<PurchaseCandidate[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<{ items: PurchaseCandidate[] }>('/api/finance/expenses/purchase-candidates')
      .then((r) => setItems(r.items))
      .catch((e) => setErr((e as Error).message));
  }, []);

  return (
    <div className="modal-scrim">
      <div className="modal" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Articles récurrents non suivis</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label={tr("Fermer")}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'block', maxHeight: '70vh', overflowY: 'auto' }}>
          <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
            Lecture des factures déjà reçues, uniquement celles dont la mise en page est reconnaissable — une mise en page inconnue
            ne remonte simplement rien, plutôt que de risquer une lecture fausse. Vérifiez la facture avant de créer l’article.
          </p>
          {err && <div className="badge crit" style={{ padding: '0.5rem 0.7rem' }}>{err}</div>}
          {!items && !err ? (
            <SkeletonRows />
          ) : items && items.length === 0 ? (
            <p className="muted">Rien détecté pour l’instant — revenez après avoir reçu plus de factures, ou vérifiez que le fournisseur en question a une mise en page de facture avec un code article en début de ligne.</p>
          ) : items ? (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>{tr("Article")}</th><th>{tr("Fournisseur")}</th><th>Réf.</th><th style={{ textAlign: 'right' }}>{tr("Factures")}</th><th></th></tr></thead>
                <tbody>
                  {items.map((c) => (
                    <tr key={`${c.contactId}-${c.code}`}>
                      <td>{c.description}</td>
                      <td>{c.contactName}</td>
                      <td className="mono">{c.code}</td>
                      <td style={{ textAlign: 'right' }}>{c.occurrences.length}</td>
                      <td>
                        <a
                          href={`/app/achats?q=${encodeURIComponent(c.occurrences[0]!.docNumber ?? c.code)}`}
                          target="_blank" rel="noreferrer" className="hint"
                        >
                          Voir →
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>{tr("Fermer")}</button>
        </div>
      </div>
    </div>
  );
}
