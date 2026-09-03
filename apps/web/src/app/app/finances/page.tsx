'use client';
import { Fragment, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { PageHead, Money } from '@/lib/ui';

interface Pnl {
  revenue: { total: number; byEntity: Record<string, number>; creditNotes: number; net: number };
  expenses: { total: number; sections: { key: string; label: string; total: number; lines: { label: string; amount: number }[] }[] };
  labour: number;
  result: number;
  margin: number | null;
}
interface Share {
  jjd: { worksites: number; profit: number; david: number; julien: number };
  tonton: { worksites: number; profit: number; partGt: number; resteJjd: number };
  m7: { worksites: number; profit: number };
}
const MONTHS = ['—', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const ENT_LABEL: Record<string, string> = { jjd: 'JJD', tonton: 'Tonton (GT)', m7: 'M7', autre: 'Non attribué' };

export default function FinancesPage() {
  const { user } = useAuth();
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [entity, setEntity] = useState('');
  const { data: yearsData } = useApi<{ years: number[] }>('/api/finance/years');
  const qs = new URLSearchParams();
  if (year) qs.set('year', year);
  if (month) qs.set('month', month);
  if (entity) qs.set('entity', entity);
  const { data } = useApi<Pnl>(`/api/finance/consolidated?${qs}`);
  const { data: share } = useApi<Share>(user?.isPartner ? '/api/finance/profit-share' : null);
  const [openSec, setOpenSec] = useState<string | null>(null);

  return (
    <>
      <PageHead
        title="Finances"
        sub="Compte de résultat consolidé"
        action={<Link href="/app/finances/banque" className="btn">Rapprochement bancaire →</Link>}
      />

      <div className="row" style={{ marginBottom: '1.3rem' }}>
        <select className="select" style={{ maxWidth: 130 }} value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="">Toutes années</option>
          {(yearsData?.years ?? []).map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select className="select" style={{ maxWidth: 150 }} value={month} onChange={(e) => setMonth(e.target.value)} disabled={!year}>
          <option value="">Toute l'année</option>
          {MONTHS.slice(1).map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <select className="select" style={{ maxWidth: 160 }} value={entity} onChange={(e) => setEntity(e.target.value)}>
          <option value="">Toutes entités</option>
          <option value="jjd">JJD</option>
          <option value="tonton">Tonton (GT)</option>
          <option value="m7">M7</option>
        </select>
      </div>

      {!data ? <div className="empty">Chargement…</div> : (
        <>
          <div className="card card-pad muted" style={{ marginBottom: '1.3rem', fontSize: '0.85rem', borderLeft: '3px solid var(--warn)' }}>
            Le chiffre d'affaires par entité correspond exactement au fichier Excel. La <strong>ventilation des dépenses</strong>
            reste à affiner avec le comptable (certaines catégories du grand livre — crédits, notes de crédit — sont à reclasser).
          </div>
          <div className="kpis" style={{ marginBottom: '1.6rem' }}>
            <div className="kpi"><span className="ic">↑</span><div className="label">Chiffre d'affaires net</div><div className="value"><Money value={data.revenue.net} /></div></div>
            <div className="kpi"><span className="ic">↓</span><div className="label">Dépenses</div><div className="value"><Money value={data.expenses.total} /></div></div>
            <div className="kpi"><span className="ic">=</span><div className="label">Résultat</div><div className={`value${data.result < 0 ? ' neg' : ''}`}><Money value={data.result} /></div></div>
            <div className="kpi"><span className="ic">%</span><div className="label">Marge</div><div className={`value${(data.margin ?? 0) < 0 ? ' neg' : ''}`}>{data.margin != null ? `${data.margin} %` : '—'}</div></div>
          </div>

          <div className="section-title">Chiffre d'affaires par entité</div>
          <div className="tbl-wrap" style={{ marginBottom: '1.6rem' }}>
            <table className="tbl">
              <tbody>
                {Object.entries(data.revenue.byEntity).filter(([, v]) => v !== 0).map(([k, v]) => (
                  <tr key={k}><td>{ENT_LABEL[k] ?? k}</td><td style={{ textAlign: 'right' }}><Money value={v} /></td></tr>
                ))}
                {data.revenue.creditNotes !== 0 && (
                  <tr><td className="muted">Notes de crédit vente</td><td style={{ textAlign: 'right' }}><Money value={data.revenue.creditNotes} /></td></tr>
                )}
              </tbody>
              <tfoot><tr><td>CA net</td><td style={{ textAlign: 'right' }}><Money value={data.revenue.net} /></td></tr></tfoot>
            </table>
          </div>

          <div className="section-title">Dépenses <span className="hint">cliquer pour le détail</span></div>
          <div className="tbl-wrap" style={{ marginBottom: '1.6rem' }}>
            <table className="tbl">
              <tbody>
                {data.expenses.sections.map((s) => (
                  <Fragment key={s.key}>
                    <tr onClick={() => setOpenSec(openSec === s.key ? null : s.key)} style={{ cursor: 'pointer' }}>
                      <td>{openSec === s.key ? '▾' : '▸'} {s.label}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}><Money value={s.total} /></td>
                    </tr>
                    {openSec === s.key && s.lines.map((l) => (
                      <tr key={l.label} style={{ background: 'var(--surface-2)' }}>
                        <td style={{ paddingLeft: '2rem' }} className="muted">{l.label}</td>
                        <td style={{ textAlign: 'right' }} className="muted"><Money value={l.amount} /></td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
              <tfoot><tr><td>Total dépenses</td><td style={{ textAlign: 'right' }}><Money value={data.expenses.total} /></td></tr></tfoot>
            </table>
          </div>

          {user?.isPartner && share && (
            <>
              <div className="section-title">Partage des bénéfices <span className="hint">réservé aux associés · marges réelles par chantier</span></div>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', marginBottom: '2rem' }}>
                <div className="card card-pad">
                  <div className="eyebrow">JJD — {share.jjd.worksites} chantiers</div>
                  <div className="value" style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0.3rem 0 0.6rem' }}><Money value={share.jjd.profit} /></div>
                  <div className="row" style={{ justifyContent: 'space-between' }}><span>David</span><strong><Money value={share.jjd.david} /></strong></div>
                  <div className="row" style={{ justifyContent: 'space-between' }}><span>Julien</span><strong><Money value={share.jjd.julien} /></strong></div>
                </div>
                <div className="card card-pad">
                  <div className="eyebrow">Tonton — {share.tonton.worksites} chantiers</div>
                  <div className="value" style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0.3rem 0 0.6rem' }}><Money value={share.tonton.profit} /></div>
                  <div className="row" style={{ justifyContent: 'space-between' }}><span>Part GT (⅓)</span><strong><Money value={share.tonton.partGt} /></strong></div>
                  <div className="row" style={{ justifyContent: 'space-between' }}><span>Reste JJD</span><strong><Money value={share.tonton.resteJjd} /></strong></div>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
