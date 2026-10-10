'use client';
import { tr } from '@/lib/ui-language';
import { SkeletonRows, ErrorState } from '@/components/States';
import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { PageHead, Money, formatEur } from '@/lib/ui';
import { TrendTile, MonthBars, HBars } from '@/lib/charts';
import { DashboardExplorer } from '@/components/DashboardExplorer';
import { ENTITY_LABEL } from '@jjd/shared';

interface Analytics {
  range: { months: number; from: string };
  entity: string | null;
  monthly: { month: string; revenue: number; expenses: number; result: number; collected: number; hours: number; labourCost: number; invoiced: number; expenseBreakdown?: { purchases: number; payroll: number; other: number } }[];
  totals: { revenue: number; expenses: number; result: number; collected: number; hours: number; marginPct: number | null };
  prev: { revenue: number; expenses: number; result: number; collected: number; hours: number; marginPct: number | null };
  expenseSections: { key: string; label: string; total: number }[];
  topWorksites: { ref: string; title: string; entity: string; paidHt: number; margin: number }[];
  topClients: { name: string; revenue: number; invoices: number }[];
  quotes: { sent: number; accepted: number; declined: number; pending: number; pipelineHt: number; acceptRate: number | null };
}

/** Variation en %, masquée si la base précédente est trop faible (historique incomplet). */
const pct = (cur: number, prev: number, minBase = 5000) => {
  if (Math.abs(prev) < minBase) return null;
  const v = ((cur - prev) / Math.abs(prev)) * 100;
  return Math.abs(v) > 250 ? null : Math.round(v * 10) / 10;
};

export default function AnalysePage() {
  const { user } = useAuth();
  const [months, setMonths] = useState(12);
  const [entity, setEntity] = useState('');
  const qs = new URLSearchParams({ months: String(months) });
  if (entity) qs.set('entity', entity);
  const { data, loading, error, reload } = useApi<Analytics>(`/api/finance/analytics?${qs}`);

  return (
    <>
      <PageHead
        eyebrow="Pilotage"
        title={tr("Analyse")}
        sub="Activité facturée, encaissements et coûts sur la période sélectionnée"
        action={
          <div className="row">
            <select className="select" value={entity} onChange={(e) => setEntity(e.target.value)} style={{ maxWidth: 150 }}>
              <option value="">Toutes entités</option>
              <option value="jjd">{ENTITY_LABEL.jjd}</option>
              <option value="tonton">{ENTITY_LABEL.tonton}</option>
            </select>
            <select className="select" value={months} onChange={(e) => setMonths(Number(e.target.value))} style={{ maxWidth: 130 }}>
              <option value={6}>6 mois</option>
              <option value={12}>12 mois</option>
              <option value={24}>24 mois</option>
            </select>
          </div>
        }
      />

      {loading && <SkeletonRows />}

      {error && !loading && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <>
          <div className="chart-tiles">
            <TrendTile label={tr("CA net")} value={formatEur(data.totals.revenue)} delta={pct(data.totals.revenue, data.prev.revenue)} deltaSuffix="%" sub={`${data.range.months} mois`} />
            <TrendTile label="Résultat calculé" value={formatEur(data.totals.result)} delta={pct(data.totals.result, data.prev.result)} deltaSuffix="%" />
            <TrendTile
              label={tr("Marge")}
              value={data.totals.marginPct != null ? `${data.totals.marginPct} %` : '—'}
              delta={data.totals.marginPct != null && data.prev.marginPct != null ? data.totals.marginPct - data.prev.marginPct : null}
              deltaSuffix=" pt"
            />
            <TrendTile label={tr("Encaissé")} value={formatEur(data.totals.collected)} delta={pct(data.totals.collected, data.prev.collected)} deltaSuffix="%" />
            <TrendTile label={tr("Heures pointées")} value={data.totals.hours.toLocaleString('fr-BE')} delta={pct(data.totals.hours, data.prev.hours)} deltaSuffix="%" />
          </div>

          <div className="analysis-guide">
            <div><strong>{tr("Facturé")}</strong><p>Le chiffre d’affaires n’est pas le solde disponible en banque.</p></div>
            <div><strong>{tr("Encaissé")}</strong><p>Les règlements sont à contrôler dans le <Link href="/app/finances/banque">rapprochement bancaire</Link>.</p></div>
            <div><strong>Par chantier</strong><p>Retrouvez les heures, achats et marges dans la <Link href="/app/chantiers">fiche du chantier</Link>.</p></div>
          </div>

          <DashboardExplorer key={`${entity}-${months}`} monthly={data.monthly} />

          <div className="chart-2col">
            <div className="card card-pad">
              <div className="eyebrow" style={{ marginBottom: '0.8rem' }}>{tr("Répartition des dépenses")}</div>
              {data.expenseSections.length === 0 ? <div className="muted">{tr("Aucune dépense sur la période.")}</div>
                : <HBars rows={data.expenseSections.map((s) => ({ label: s.label, value: s.total }))} />}
            </div>
            <div className="card card-pad">
              <div className="eyebrow" style={{ marginBottom: '0.8rem' }}>{tr("Top chantiers · marge réelle")}</div>
              {data.topWorksites.length === 0 ? <div className="muted">{tr("Rien à afficher.")}</div>
                : <HBars rows={data.topWorksites.map((w) => ({ label: `${w.ref} · ${w.title}`, value: w.margin }))} />}
            </div>
          </div>

          <div className="chart-2col" style={{ marginTop: '1.4rem' }}>
            <div className="card card-pad">
              <div className="eyebrow" style={{ marginBottom: '0.8rem' }}>{tr("Heures pointées")} <span className="muted">/ mois</span></div>
              <MonthBars data={data.monthly.map((m) => ({ month: m.month, value: m.hours }))} color="var(--primary)" unit="h" />
            </div>
            <div className="card card-pad">
              <div className="eyebrow" style={{ marginBottom: '0.8rem' }}>Top clients · CA</div>
              {data.topClients.length === 0 ? <div className="muted">{tr("Rien à afficher.")}</div> : (
                <table className="tbl" style={{ width: '100%' }}>
                  <tbody>
                    {data.topClients.map((c) => (
                      <tr key={c.name}>
                        <td>{c.name}</td>
                        <td className="tnum" style={{ textAlign: 'right' }}>{c.invoices} fact.</td>
                        <td style={{ textAlign: 'right' }}><Money value={c.revenue} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="section-title">{tr("Devis")}</div>
          <div className="chart-tiles">
            <TrendTile label={tr("Émis")} value={String(data.quotes.sent)} sub={`${data.quotes.pending} en attente`} />
            <TrendTile label={tr("Acceptés")} value={String(data.quotes.accepted)} sub={`${data.quotes.declined} déclinés / expirés`} />
            <TrendTile label="Taux d'acceptation" value={data.quotes.acceptRate != null ? `${data.quotes.acceptRate} %` : '—'} />
            <TrendTile label="Pipeline (devis envoyés)" value={formatEur(data.quotes.pipelineHt)} sub="HT, non tranchés" />
          </div>

          {user?.isPartner && (
            <p className="hint" style={{ marginTop: '1.5rem' }}>
              Partage des bénéfices entre associés : <Link href="/app/finances">Finances → cartes « Partage »</Link>.
            </p>
          )}
        </>
      )}
    </>
  );
}
