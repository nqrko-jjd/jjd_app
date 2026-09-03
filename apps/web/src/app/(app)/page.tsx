'use client';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { PageHead, Money, formatDateBE } from '@/lib/ui';
import { LEGAL_DOC_LABEL } from '@jjd/shared';

interface Dashboard {
  kpis: {
    invoicedMonth: number; paidMonth: number; overdueAmount: number;
    overdueCount: number; openWorksites: number; hoursWeek: number;
  };
  alerts: { kind: string; severity: string; label: string; count: number; amount?: number; href: string }[];
  expiringDocs: { id: string; person: string; type: string; label: string | null; expiresOn: string | null }[];
}

export default function DashboardPage() {
  const { data, loading } = useApi<Dashboard>('/api/dashboard');
  const now = new Date().toLocaleDateString('fr-BE', { month: 'long', year: 'numeric' });

  return (
    <>
      <PageHead title="Tableau de bord" sub={`Vue d'ensemble — ${now}`} />
      {loading && <div className="empty">Chargement…</div>}
      {data && (
        <>
          <div className="kpis">
            <Kpi ic="€" label="Facturé ce mois" value={<Money value={data.kpis.invoicedMonth} />} />
            <Kpi ic="✓" label="Encaissé ce mois" value={<Money value={data.kpis.paidMonth} />} />
            <Kpi ic="!" label="Impayés" value={<Money value={data.kpis.overdueAmount} />} sub={`${data.kpis.overdueCount} factures en retard`} />
            <Kpi ic="▤" label="Chantiers ouverts" value={data.kpis.openWorksites} />
            <Kpi ic="◷" label="Heures pointées (7 j)" value={data.kpis.hoursWeek} />
          </div>

          <div className="section-title">À traiter <span className="hint">trié par urgence</span></div>
          {data.alerts.length === 0 ? (
            <div className="card card-pad muted">Rien à signaler. 👍</div>
          ) : (
            <div className="alert-list">
              {data.alerts.map((a) => (
                <Link key={a.kind} href={a.href} className={`alert ${a.severity}`}>
                  <span className="sev" />
                  <span className="label">{a.label}</span>
                  {a.amount != null && <span className="amount"><Money value={a.amount} /></span>}
                  <span className="count">{a.count}</span>
                </Link>
              ))}
            </div>
          )}

          {data.expiringDocs.length > 0 && (
            <>
              <div className="section-title">Documents légaux qui expirent</div>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>Personne</th><th>Document</th><th>Échéance</th></tr></thead>
                  <tbody>
                    {data.expiringDocs.map((d) => (
                      <tr key={d.id}>
                        <td>{d.person}</td>
                        <td>{d.label || LEGAL_DOC_LABEL[d.type as keyof typeof LEGAL_DOC_LABEL] || d.type}</td>
                        <td className="tnum">{formatDateBE(d.expiresOn)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

function Kpi({ ic, label, value, sub }: { ic: string; label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="kpi">
      <span className="ic">{ic}</span>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
