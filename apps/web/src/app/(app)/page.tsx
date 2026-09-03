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

  return (
    <>
      <PageHead title="Dashboard bureau" sub="Vue d'ensemble du mois et alertes à traiter" />
      {loading && <div className="empty">Chargement…</div>}
      {data && (
        <div className="grid" style={{ gap: '1.4rem' }}>
          <div className="kpis">
            <Kpi label="Facturé ce mois" value={<Money value={data.kpis.invoicedMonth} />} />
            <Kpi label="Encaissé ce mois" value={<Money value={data.kpis.paidMonth} />} />
            <Kpi label="Impayés" value={<Money value={data.kpis.overdueAmount} />} note={`${data.kpis.overdueCount} factures`} />
            <Kpi label="Chantiers ouverts" value={data.kpis.openWorksites} />
            <Kpi label="Heures pointées (7 j)" value={data.kpis.hoursWeek} />
          </div>

          <section>
            <h2 style={{ marginBottom: '0.7rem' }}>Alertes</h2>
            {data.alerts.length === 0 && <div className="card card-pad muted">Rien à signaler. 👍</div>}
            <div className="alert-list">
              {data.alerts.map((a) => (
                <Link key={a.kind} href={a.href} className={`alert ${a.severity}`}>
                  <span className="sev" />
                  <span>{a.label}</span>
                  {a.amount != null && <span className="amount"><Money value={a.amount} /></span>}
                  <span className="count">{a.count}</span>
                </Link>
              ))}
            </div>
          </section>

          {data.expiringDocs.length > 0 && (
            <section>
              <h2 style={{ marginBottom: '0.7rem' }}>Documents légaux qui expirent</h2>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr><th>Personne</th><th>Document</th><th>Échéance</th></tr>
                  </thead>
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
            </section>
          )}
        </div>
      )}
    </>
  );
}

function Kpi({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {note && <div className="muted" style={{ fontSize: '0.76rem' }}>{note}</div>}
    </div>
  );
}
