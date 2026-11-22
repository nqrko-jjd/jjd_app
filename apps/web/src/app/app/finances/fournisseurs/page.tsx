'use client';
import { tr } from '@/lib/ui-language';
import { Fragment, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CalendarClock, Wallet, Scale, Layers } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { PageHead, Money, Kpi, formatDateBE } from '@/lib/ui';
import { SkeletonRows, ErrorState } from '@/components/States';

interface Supplier {
  id: string; contactId: string | null; name: string; openTtc: number; overdue: number; overdueNet?: number; dueSoon: number;
  credits: number; unallocatedTotal: number; balance: number; nextDue: string | null;
  invoices: { id: string; number: string | null; date: string | null; dueDate: string | null; total: number; paid: number; remaining: number }[];
  advances: { id: string; date: string | null; bank: string | null; amount: number; remaining: number }[];
}
export default function SuppliersPage() {
  const { data, loading, error, reload } = useApi<{ items: Supplier[] }>('/api/finance/suppliers');
  const { data: pal } = useApi<{ items: { contactId: string | null; supplier: string; net: number; valueHt: number; lastDate: string | null; byType: { type: string; net: number }[] }[] }>('/api/contacts/pallets/overview');
  const palToReturn = (pal?.items ?? []).filter((p) => p.net > 0);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('open');
  const [expanded, setExpanded] = useState<string | null>(null);
  const all = data?.items ?? [];
  const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const rows = all.filter(s => normalize(s.name).includes(normalize(query)) && (filter === 'all' || filter === 'overdue' ? filter === 'all' || s.overdue > 0 : filter === 'credit' ? s.balance < 0 : s.openTtc > 0 || s.unallocatedTotal > 0 || s.credits > 0));
  const sum = (fn: (s: Supplier) => number) => all.reduce((n,s) => n + fn(s), 0);
  return <>
    <PageHead eyebrow="Finances" title="Comptes fournisseurs" sub="Factures, échéances et acomptes disponibles chez vos fournisseurs" action={<div className="row"><Link className="btn" href="/app/achats">Achats / Dépenses</Link><Link className="btn" href="/app/finances/banque">Répartir les paiements</Link><Link className="btn" href="/app/finances">Finances</Link></div>} />
    {loading ? <SkeletonRows /> : error ? <ErrorState message={error} onRetry={reload} /> : <>
      <div className="kpis" style={{ marginBottom: '1.2rem' }}>
        <Kpi ic={Scale} label="Soldes à régler" value={<Money value={sum(s => Math.max(0,s.balance))} />} sub="Après acomptes et notes de crédit" />
        <Kpi ic={AlertTriangle} label="Échu à payer" value={<Money value={sum(s => s.overdueNet ?? s.overdue)} />} warn={sum(s => s.overdueNet ?? s.overdue) > 0} sub="Notes de crédit et acomptes déduits" />
        <Kpi ic={CalendarClock} label="Échéances sous 30 jours" value={<Money value={sum(s => s.dueSoon)} />} sub="Factures encore ouvertes" />
        <Kpi ic={Wallet} label="Acomptes disponibles" value={<Money value={sum(s => s.unallocatedTotal)} />} sub="Paiements à répartir sur les factures" />
        <Kpi ic={Layers} label="Palettes à rendre" value={palToReturn.reduce((n, p) => n + p.net, 0)} warn={palToReturn.length > 0} sub={`Caution : ${new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' }).format(palToReturn.reduce((n, p) => n + p.valueHt, 0))} HTVA`} />
      </div>
      {palToReturn.length > 0 && (
        <div className="card card-pad" style={{ marginBottom: '1.2rem' }}>
          <h3 style={{ marginTop: 0 }}>Palettes consignées à rendre</h3>
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Fournisseur</th><th>Palettes</th><th>Détail</th><th>Caution HTVA</th><th>Dernière facturée</th></tr></thead><tbody>
            {palToReturn.map((p) => <tr key={p.contactId ?? p.supplier}>
              <td>{p.contactId ? <Link href={`/app/contacts/${p.contactId}`}><strong>{p.supplier}</strong></Link> : <strong>{p.supplier}</strong>}</td>
              <td className="tnum"><span className="badge warn">{p.net}</span></td>
              <td className="muted">{p.byType.filter((b) => b.net > 0).map((b) => `${b.net} ${b.type.toLowerCase()}`).join(', ')}</td>
              <td className="tnum"><Money value={p.valueHt} /></td>
              <td>{formatDateBE(p.lastDate)}</td>
            </tr>)}
          </tbody></table></div>
          <p className="muted" style={{ margin: '0.6rem 0 0', fontSize: '0.82rem' }}>Compté sur les lignes des factures (+) et des notes de crédit (−) : une palette rendue revient à zéro dès que la note de crédit est encodée.</p>
        </div>
      )}
      <div className="row" style={{ marginBottom: '1rem', flexWrap: 'wrap' }}>
        <label>{tr("Fournisseur")}<input className="input" value={query} onChange={e => setQuery(e.target.value)} placeholder="CF Group, BigMat…" /></label>
        <label>Afficher<select className="select" value={filter} onChange={e => setFilter(e.target.value)}><option value="open">Comptes avec un solde ou crédit</option><option value="overdue">Factures échues</option><option value="credit">Crédit chez le fournisseur</option><option value="all">Tous les fournisseurs</option></select></label>
      </div>
      <div className="card tbl-wrap"><table className="tbl"><thead><tr><th>{tr("Fournisseur")}</th><th>Factures ouvertes</th><th>Échues</th><th>Prochaine échéance</th><th>Acomptes / NC</th><th>Solde net</th><th>{tr("Détail")}</th></tr></thead><tbody>
        {rows.length === 0 && <tr><td colSpan={7} className="muted">Aucun fournisseur pour ces critères.</td></tr>}
        {rows.map(s => <Fragment key={s.id}><tr>
          <td>{s.contactId ? <Link href={`/app/contacts/${s.contactId}`}><strong>{s.name}</strong></Link> : <strong>{s.name}</strong>}</td>
          <td className="tnum"><Money value={s.openTtc} /></td><td className="tnum">{(s.overdueNet ?? s.overdue) > 0 ? <span className="badge warn"><Money value={s.overdueNet ?? s.overdue} /></span> : '—'}</td>
          <td>{s.nextDue ? formatDateBE(s.nextDue) : s.invoices.some(i => i.remaining > 0 && !i.dueDate) ? 'Échéance à renseigner' : '—'}</td>
          <td className="tnum"><Money value={s.unallocatedTotal + s.credits} /></td>
          <td className="tnum"><strong><Money value={Math.abs(s.balance)} /></strong><div className="muted">{s.balance < 0 ? 'Crédit chez le fournisseur' : s.balance > 0 ? 'À régler' : 'Compte soldé'}</div></td>
          <td><button className="btn" aria-expanded={expanded === s.id} onClick={() => setExpanded(expanded === s.id ? null : s.id)}>{expanded === s.id ? tr("Fermer") : 'Voir le compte'}</button></td>
        </tr>{expanded === s.id && <tr><td colSpan={7} style={{ background: 'var(--surface-2)', padding: '1rem' }}>
          <h3>Factures de {s.name}</h3><div className="tbl-wrap"><table className="tbl"><thead><tr><th>{tr("Facture")}</th><th>{tr("Date")}</th><th>Échéance</th><th>Total</th><th>Affecté</th><th>Reste à régler</th></tr></thead><tbody>
            {s.invoices.map(i => <tr key={i.id}><td><Link href={`/app/achats?q=${encodeURIComponent(i.number ?? s.name)}`}>{i.number ?? 'Voir la facture'}</Link></td><td>{formatDateBE(i.date)}</td><td>{i.dueDate ? formatDateBE(i.dueDate) : 'À renseigner'}</td><td><Money value={i.total} /></td><td><Money value={i.paid} /></td><td><Money value={i.remaining} /></td></tr>)}
          </tbody></table></div>
          <h3>Acomptes disponibles : <Money value={s.unallocatedTotal} /></h3>
          {s.advances.map(t => <div className="row" key={t.id} style={{ marginBottom: '.5rem', flexWrap: 'wrap' }}><span>{formatDateBE(t.date)} · {t.bank} · paiement de <Money value={t.amount} /> · disponible : <strong><Money value={t.remaining} /></strong></span><Link className="btn" href={`/app/finances/banque?transactionId=${t.id}`}>Répartir cet acompte</Link></div>)}
          {s.credits > 0 && <p>Notes de crédit disponibles : <Money value={s.credits} /></p>}
        </td></tr>}</Fragment>)}
      </tbody></table></div>
    </>}
  </>;
}
