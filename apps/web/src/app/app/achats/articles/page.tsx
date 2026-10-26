'use client';
import { Fragment, Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { SkeletonRows, ErrorState, EmptyState } from '@/components/States';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, Money, formatDateBE, formatEur } from '@/lib/ui';
import { PaginationBar } from '@/components/PaginationBar';

interface Stats { pdfCount: number; remaining: number; withLines: number; unreadable: number; noLines: number; lineCount: number }
interface Article {
  key: string; label: string; code: string | null; unit: string | null; purchases: number; qty: number; totalHt: number;
  minPrice: number; maxPrice: number; lastPrice: number; lastDate: string | null; suppliers: string[];
  supplierRefs: { id: string | null; name: string }[];
}
interface Occurrence {
  id: string; entryId: string; contactId: string | null; date: string | null; docNumber: string | null; slip: boolean; supplier: string; worksiteRef: string | null;
  qty: number; unit: string | null; unitPriceHt: number; discountPct: number | null; totalHt: number;
}
interface Hidden { articles: { key: string; label: string }[]; suppliers: { id: string; name: string }[] }
interface ScanResult { scanned: number; linesFound: number; unreadable: number; remaining: number; total: number }

export default function ArticlesAchetesPage() {
  return <Suspense fallback={<SkeletonRows />}><Inner /></Suspense>;
}

const qty = (n: number) => n.toLocaleString('fr-BE', { maximumFractionDigits: 2 });

function Inner() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [includeSlips, setIncludeSlips] = useState(false);
  const [sort, setSort] = useState('total');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [selected, setSelected] = useState<Map<string, string>>(new Map()); // clé → libellé des articles cochés
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [hideBusy, setHideBusy] = useState(false);

  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setPage(1); setOpen(null); }, [debounced, from, to, includeSlips, sort, dir]);
  useEffect(() => { setSelected(new Map()); }, [debounced, from, to, includeSlips, sort, dir, page]);

  const filters = new URLSearchParams();
  if (debounced) filters.set('q', debounced);
  if (from) filters.set('from', from);
  if (to) filters.set('to', to);
  if (includeSlips) filters.set('includeSlips', '1');
  const listQs = new URLSearchParams(filters);
  listQs.set('sort', sort); listQs.set('dir', dir); listQs.set('page', String(page)); listQs.set('pageSize', '50');

  const { data: stats, reload: reloadStats } = useApi<Stats>('/api/finance/expenses/lines/stats');
  const { data: hidden, reload: reloadHidden } = useApi<Hidden>('/api/finance/expenses/lines/hidden');
  const { data, loading, error, reload } = useApi<{ items: Article[]; page: number; totalPages: number; totalCount: number; totals: { articles: number; spendHt: number } }>(`/api/finance/expenses/lines/articles?${listQs}`);

  async function readPdfs(rescan: boolean) {
    if (rescan && !window.confirm('Relire tous les PDF depuis le début ? Les lignes déjà lues sont remplacées par la nouvelle lecture.')) return;
    setScanning(true); setProgress('Lecture en cours…');
    try {
      let r = await api<ScanResult>('/api/finance/expenses/scan-lines', { method: 'POST', body: rescan ? { rescan: true } : {} });
      let lines = r.linesFound;
      setProgress(`${r.total - r.remaining} / ${r.total} PDF lus · ${lines} lignes trouvées`);
      // un lot dure ~20 s : on enchaîne jusqu'à la fin (le serveur web coupe les requêtes trop longues)
      while (r.remaining > 0 && r.scanned > 0) {
        r = await api<ScanResult>('/api/finance/expenses/scan-lines', { method: 'POST', body: {} });
        lines += r.linesFound;
        setProgress(`${r.total - r.remaining} / ${r.total} PDF lus · ${lines} nouvelles lignes`);
      }
      setProgress(`Terminé : ${r.total} PDF traités.`);
      reloadStats(); reload();
    } catch (e) {
      setProgress(`Interrompu : ${(e as Error).message}. Relancez : la lecture reprend où elle s'était arrêtée.`);
      reloadStats(); reload();
    } finally { setScanning(false); }
  }

  /** Masque / réaffiche des articles ou des fournisseurs entiers : rien n'est supprimé, seulement caché de cette page. */
  async function hide(body: { articles?: { key: string; label: string }[]; suppliers?: { id: string; name: string }[]; show?: boolean }) {
    setHideBusy(true);
    try { await api('/api/finance/expenses/lines/hide', { method: 'POST', body }); setSelected(new Map()); setOpen(null); reload(); reloadHidden(); }
    catch (e) { setProgress(`Impossible de masquer : ${(e as Error).message}`); }
    finally { setHideBusy(false); }
  }
  function toggleSel(a: Article) { setSelected((m) => { const n = new Map(m); if (n.has(a.key)) n.delete(a.key); else n.set(a.key, a.label); return n; }); }
  const hiddenCount = (hidden?.articles.length ?? 0) + (hidden?.suppliers.length ?? 0);

  function sortBy(key: string) { if (sort === key) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSort(key); setDir(key === 'label' ? 'asc' : 'desc'); } }
  const arrow = (key: string) => (sort === key ? (dir === 'asc' ? ' ▲' : ' ▼') : '');
  const done = stats ? stats.pdfCount - stats.remaining : 0;

  return (
    <>
      <PageHead
        eyebrow="Achats"
        title="Articles achetés"
        sub="Ce que vous achetez, article par article, lu dans les PDF des factures d'achat"
        action={<Link href="/app/achats" className="btn ghost">← Dépenses</Link>}
      />

      <div className="card card-pad" style={{ marginBottom: '1rem' }}>
        {stats ? (
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '0.92rem' }}>
              <strong>{stats.lineCount.toLocaleString('fr-BE')} lignes d'article</strong> lues dans {stats.withLines.toLocaleString('fr-BE')} PDF
              <span className="muted"> · {stats.pdfCount.toLocaleString('fr-BE')} PDF d'achat au total
                {stats.unreadable > 0 ? ` · ${stats.unreadable.toLocaleString('fr-BE')} sans texte lisible (scans, photos)` : ''}
                {stats.noLines > 0 ? ` · ${stats.noLines.toLocaleString('fr-BE')} sans ligne d'article reconnue (forfaits, factures sans détail…)` : ''}
              </span>
              {stats.remaining > 0 && <div style={{ marginTop: 4 }}><span className="badge warn">{stats.remaining.toLocaleString('fr-BE')} PDF pas encore lus</span></div>}
            </div>
            <div className="row" style={{ gap: '0.5rem' }}>
              <button className="btn primary" disabled={scanning} onClick={() => readPdfs(false)}>{scanning ? 'Lecture…' : stats.remaining > 0 ? `Lire les ${stats.remaining.toLocaleString('fr-BE')} PDF restants` : 'Lire les nouveaux PDF'}</button>
              {stats.pdfCount > 0 && stats.remaining === 0 && <button className="btn ghost" disabled={scanning} onClick={() => readPdfs(true)} title="Repart de zéro avec la lecture actuelle">Tout relire</button>}
            </div>
          </div>
        ) : <span className="muted">Chargement…</span>}
        {scanning && stats && stats.pdfCount > 0 && (
          <div style={{ marginTop: 10, height: 6, borderRadius: 3, background: 'var(--line)' }}><div style={{ width: `${Math.min(100, Math.round((done / stats.pdfCount) * 100))}%`, height: '100%', borderRadius: 3, background: 'var(--primary)', transition: 'width .4s' }} /></div>
        )}
        {progress && <div className="muted" style={{ marginTop: 8, fontSize: '0.85rem' }}>{progress}</div>}
        <div className="muted" style={{ marginTop: 8, fontSize: '0.8rem' }}>
          Une ligne n'est retenue que si quantité × prix (remise comprise) retombe sur son total : aucune ligne lue de travers. Seules les factures dont le PDF a du texte sont lues ; les achats sans PDF n'apparaissent pas ici.
        </div>
      </div>

      <div className="row" style={{ marginBottom: '1rem', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="input" style={{ maxWidth: 300 }} placeholder="Article, référence…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher un article" />
        <label className="row" style={{ gap: 6, alignItems: 'center' }}><span className="muted">du</span><input className="input" type="date" style={{ maxWidth: 160 }} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="Date de début" /></label>
        <label className="row" style={{ gap: 6, alignItems: 'center' }}><span className="muted">au</span><input className="input" type="date" style={{ maxWidth: 160 }} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="Date de fin" /></label>
        {(from || to) && <button className="btn ghost" onClick={() => { setFrom(''); setTo(''); }}>✕ Effacer les dates</button>}
        <label className="row" style={{ gap: 6, alignItems: 'center', fontSize: '0.88rem' }} title="Un bordereau d'enlèvement est repris par la facture qui le suit : les compter aussi double les quantités"><input type="checkbox" checked={includeSlips} onChange={(e) => setIncludeSlips(e.target.checked)} /> Inclure les bordereaux</label>
        <span className="row" style={{ marginLeft: 'auto', gap: '0.6rem', alignItems: 'center' }}>
          {data && <span className="muted" style={{ fontSize: '0.85rem' }}>{data.totals.articles.toLocaleString('fr-BE')} articles · {formatEur(data.totals.spendHt)} HT</span>}
          {hiddenCount > 0 && <button type="button" className="btn ghost" onClick={() => setHiddenOpen((v) => !v)}>{hiddenOpen ? 'Fermer' : `Masqués (${hiddenCount})`}</button>}
        </span>
      </div>
      {hiddenOpen && hidden && (
        <div className="card card-pad" style={{ marginBottom: '1rem' }}>
          <strong>Masqués de cette page</strong> <span className="muted" style={{ fontSize: '0.84rem' }}>— rien n'est supprimé : réaffichez à tout moment.</span>
          {hidden.suppliers.map((f) => (
            <div key={f.id} className="row" style={{ gap: '0.6rem', alignItems: 'center', padding: '0.25rem 0' }}><span className="badge plain">fournisseur</span><span>{f.name}</span><button type="button" className="btn ghost" style={{ marginLeft: 'auto' }} disabled={hideBusy} onClick={() => hide({ suppliers: [f], show: true })}>Réafficher</button></div>
          ))}
          {hidden.articles.map((a) => (
            <div key={a.key} className="row" style={{ gap: '0.6rem', alignItems: 'center', padding: '0.25rem 0' }}><span className="badge plain">article</span><span>{a.label}</span><button type="button" className="btn ghost" style={{ marginLeft: 'auto' }} disabled={hideBusy} onClick={() => hide({ articles: [a], show: true })}>Réafficher</button></div>
          ))}
        </div>
      )}
      {selected.size > 0 && (
        <div className="card card-pad row" style={{ marginBottom: '1rem', gap: '0.8rem', alignItems: 'center', borderLeft: '4px solid var(--primary)' }}>
          <strong>{selected.size} article{selected.size > 1 ? 's' : ''} sélectionné{selected.size > 1 ? 's' : ''}</strong>
          <button type="button" className="btn primary" disabled={hideBusy} onClick={() => hide({ articles: [...selected].map(([key, label]) => ({ key, label })) })}>{hideBusy ? 'Masquage…' : 'Masquer la sélection'}</button>
          <button type="button" className="btn ghost" onClick={() => setSelected(new Map())}>Annuler</button>
          <span className="muted" style={{ fontSize: '0.82rem' }}>Ils ne seront plus affichés ni comptés dans le total (réversible).</span>
        </div>
      )}

      {loading && <SkeletonRows />}
      {error && !loading && <ErrorState message={error} onRetry={reload} />}
      {data && data.items.length === 0 && !loading && (
        <EmptyState title="Aucun article" text={stats && stats.lineCount === 0 ? 'Cliquez sur « Lire les PDF » : les lignes des factures seront lues et regroupées ici.' : 'Aucun article ne correspond à ces filtres.'} />
      )}
      {data && data.items.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 34 }}><input type="checkbox" aria-label="Tout sélectionner" checked={data.items.length > 0 && data.items.every((a) => selected.has(a.key))} onChange={(e) => setSelected(e.target.checked ? new Map(data.items.map((a) => [a.key, a.label])) : new Map())} /></th>
                <th style={{ cursor: 'pointer' }} onClick={() => sortBy('label')}>Article{arrow('label')}</th>
                <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => sortBy('purchases')}>Achats{arrow('purchases')}</th>
                <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => sortBy('qty')}>Quantité{arrow('qty')}</th>
                <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => sortBy('total')}>Dépensé HT{arrow('total')}</th>
                <th style={{ textAlign: 'right' }}>Prix unitaire (mini – maxi)</th>
                <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => sortBy('last')}>Dernier achat{arrow('last')}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((a) => (
                <Fragment key={a.key}>
                  <tr onClick={() => setOpen(open === a.key ? null : a.key)} style={{ cursor: 'pointer' }}>
                    <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Sélectionner ${a.label}`} checked={selected.has(a.key)} onChange={() => toggleSel(a)} /></td>
                    <td>
                      <strong>{a.label}</strong>
                      <div className="muted" style={{ fontSize: '0.78rem' }}>{[a.code && `réf. ${a.code}`, a.suppliers.join(' · ')].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td style={{ textAlign: 'right' }} className="tnum">{a.purchases}</td>
                    <td style={{ textAlign: 'right' }} className="tnum">{qty(a.qty)}{a.unit ? ` ${a.unit.toLowerCase()}` : ''}</td>
                    <td style={{ textAlign: 'right' }}><Money value={a.totalHt} /></td>
                    <td style={{ textAlign: 'right' }} className="tnum">{a.minPrice === a.maxPrice ? formatEur(a.minPrice) : `${formatEur(a.minPrice)} – ${formatEur(a.maxPrice)}`}</td>
                    <td style={{ textAlign: 'right' }} className="tnum">{a.lastDate ? formatDateBE(a.lastDate) : '—'}<div className="muted" style={{ fontSize: '0.78rem' }}>{formatEur(a.lastPrice)}</div></td>
                  </tr>
                  {open === a.key && (
                    <tr><td colSpan={7} style={{ background: 'var(--surface-2, rgba(0,0,0,0.03))', padding: '0.6rem 1rem' }}>
                      <div className="row" style={{ gap: '0.5rem', marginBottom: 8, flexWrap: 'wrap' }}>
                        <button type="button" className="btn ghost" disabled={hideBusy} onClick={() => hide({ articles: [{ key: a.key, label: a.label }] })}>Masquer cet article</button>
                        {a.supplierRefs.filter((f) => f.id).map((f) => (
                          <button key={f.id} type="button" className="btn ghost" disabled={hideBusy} title="Cache tous les articles lus chez ce fournisseur (ex. sous-traitant, forfaits, services)" onClick={() => { if (window.confirm(`Masquer tous les articles de « ${f.name} » ?`)) hide({ suppliers: [{ id: f.id!, name: f.name }] }); }}>Masquer tout « {f.name} »</button>
                        ))}
                      </div>
                      <Occurrences articleKey={a.key} filters={filters} />
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.totalPages > 1 && <PaginationBar page={data.page} totalPages={data.totalPages} pageSize={50} onPage={setPage} onPageSize={() => undefined} />}
    </>
  );
}

function Occurrences({ articleKey, filters }: { articleKey: string; filters: URLSearchParams }) {
  const qs = new URLSearchParams(filters); qs.delete('q'); qs.set('key', articleKey);
  const { data, loading, error } = useApi<{ items: Occurrence[] }>(`/api/finance/expenses/lines/article?${qs}`);
  if (loading) return <span className="muted">Chargement…</span>;
  if (error || !data) return <span className="muted">{error ?? 'Indisponible'}</span>;
  return (
    <table className="tbl" style={{ margin: 0 }}>
      <thead><tr><th>Date</th><th>Fournisseur</th><th>N°</th><th>Chantier</th><th style={{ textAlign: 'right' }}>Quantité</th><th style={{ textAlign: 'right' }}>Prix unitaire</th><th style={{ textAlign: 'right' }}>Total HT</th></tr></thead>
      <tbody>
        {data.items.map((o) => (
          <tr key={o.id}>
            <td className="tnum">{o.date ? formatDateBE(o.date) : '—'}</td>
            <td>{o.supplier}{o.slip && <span className="badge plain" style={{ marginLeft: 6 }}>bordereau</span>}</td>
            <td className="mono" style={{ fontSize: '0.82rem' }}>{o.docNumber ?? '—'}</td>
            <td>{o.worksiteRef ?? '—'}</td>
            <td style={{ textAlign: 'right' }} className="tnum">{qty(o.qty)}{o.unit ? ` ${o.unit.toLowerCase()}` : ''}</td>
            <td style={{ textAlign: 'right' }} className="tnum">{formatEur(o.unitPriceHt)}{o.discountPct ? <span className="muted"> (−{qty(o.discountPct)} %)</span> : null}</td>
            <td style={{ textAlign: 'right' }}><Money value={o.totalHt} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
