'use client';
import { use } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { PageHead, Money, formatDateBE } from '@/lib/ui';

interface Detail {
  vehicle: {
    id: string; code: string | null; brand: string | null; model: string | null; plate: string | null;
    type: string | null; fuel: string | null; vin: string | null; km: string | null;
    firstRegistration: string | null; nextInspection: string | null; status: string;
    circulationTax: number | null; biv: number | null; driver: string | null; equipment: string | null; depot: string | null;
    acquisitionMode: string | null; purchaseDate: string | null; purchasePriceHt: number | null;
    financedAmount: number | null; monthlyPayment: number | null; downPayment: number | null;
    residualValue: number | null; financeMonths: number | null; financeEndOn: string | null;
    financeCompany: string | null; financeContract: string | null;
    insurances: { provider: string | null; contractNumber: string | null; monthlyAmount: number | null; annualAmount: number | null; paymentMode: string | null }[];
    fines: { id: string; date: string | null; type: string | null; amount: number | null; status: string | null }[];
    payments: { id: string; dueOn: string | null; amount: number | null; principal: number | null; interest: number | null; balance: number | null }[];
  };
}

export default function VehicleDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, loading } = useApi<Detail>(`/api/vehicles/${id}`);
  if (loading) return <div className="empty">Chargement…</div>;
  if (!data) return <div className="empty">Véhicule introuvable.</div>;
  const v = data.vehicle;
  const ins = v.insurances[0];
  const nextPay = v.payments.find((p) => p.dueOn && new Date(p.dueOn).getTime() >= Date.now());

  return (
    <>
      <PageHead
        title={[v.brand, v.model].filter(Boolean).join(' ')}
        sub={`${v.plate ?? 'sans plaque'} · ${v.code ?? ''} · ${v.type ?? ''}`}
        action={<Link href="/flotte" className="btn">← Flotte</Link>}
      />
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginBottom: '1.4rem' }}>
        <Info label="Conducteur" value={v.driver ?? '—'} />
        <Info label="Carburant" value={v.fuel ?? '—'} />
        <Info label="Km" value={v.km ?? '—'} />
        <Info label="1re mise en circ." value={formatDateBE(v.firstRegistration)} />
        <Info label="Contrôle technique" value={formatDateBE(v.nextInspection)} />
        <Info label="VIN" value={<span className="mono" style={{ fontSize: '0.8rem' }}>{v.vin ?? '—'}</span>} />
        <Info label="Taxe circ. / BIV" value={`${v.circulationTax ? `${v.circulationTax} €` : '—'} / ${v.biv ? `${v.biv} €` : '—'}`} />
        <Info label="Équipements" value={v.equipment ?? '—'} />
        <Info label="Dépôt" value={v.depot ?? '—'} />
      </div>

      <section className="card card-pad" style={{ marginBottom: '1.4rem' }}>
        <h2 style={{ marginBottom: '0.6rem' }}>Assurance</h2>
        {ins ? (
          <div className="row" style={{ gap: '2rem' }}>
            <span>{ins.provider} <span className="muted">· contrat {ins.contractNumber ?? '—'}</span></span>
            <span><Money value={ins.monthlyAmount} />/mois</span>
            <span className="muted"><Money value={ins.annualAmount} />/an · {ins.paymentMode ?? ''}</span>
          </div>
        ) : <span className="muted">Aucune assurance enregistrée.</span>}
      </section>

      <section className="card card-pad" style={{ marginBottom: '1.4rem' }}>
        <h2 style={{ marginBottom: '0.6rem' }}>Acquisition — {v.acquisitionMode ?? '?'}</h2>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <Info label="Date d'achat" value={formatDateBE(v.purchaseDate)} />
          <Info label="Prix HTVA" value={<Money value={v.purchasePriceHt} />} />
          <Info label="Montant financé" value={<Money value={v.financedAmount} />} />
          <Info label="Mensualité" value={<Money value={v.monthlyPayment} />} />
          <Info label="Acompte" value={<Money value={v.downPayment} />} />
          <Info label="Valeur résiduelle" value={<Money value={v.residualValue} />} />
          <Info label="Durée / Fin" value={`${v.financeMonths ?? '—'} mois · ${formatDateBE(v.financeEndOn)}`} />
          <Info label="Organisme" value={`${v.financeCompany ?? '—'} ${v.financeContract ? `(${v.financeContract})` : ''}`} />
        </div>
      </section>

      {v.payments.length > 0 && (
        <section style={{ marginBottom: '1.4rem' }}>
          <h2 style={{ marginBottom: '0.7rem' }}>Échéancier ({v.payments.length}) {nextPay && <span className="muted" style={{ fontSize: '0.82rem' }}>· prochaine : {formatDateBE(nextPay.dueOn)}</span>}</h2>
          <div className="tbl-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table className="tbl">
              <thead><tr><th>Échéance</th><th style={{ textAlign: 'right' }}>Mensualité</th><th style={{ textAlign: 'right' }}>Capital</th><th style={{ textAlign: 'right' }}>Intérêts</th><th style={{ textAlign: 'right' }}>Solde</th></tr></thead>
              <tbody>
                {v.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="tnum">{formatDateBE(p.dueOn)}</td>
                    <td style={{ textAlign: 'right' }}><Money value={p.amount} /></td>
                    <td style={{ textAlign: 'right' }}><Money value={p.principal} /></td>
                    <td style={{ textAlign: 'right' }}><Money value={p.interest} /></td>
                    <td style={{ textAlign: 'right' }}><Money value={p.balance} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {v.fines.length > 0 && (
        <section>
          <h2 style={{ marginBottom: '0.7rem' }}>PV récents ({v.fines.length})</h2>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Date</th><th>Type</th><th style={{ textAlign: 'right' }}>Montant</th><th>Statut</th></tr></thead>
              <tbody>
                {v.fines.map((f) => (
                  <tr key={f.id}>
                    <td className="tnum">{formatDateBE(f.date)}</td>
                    <td>{f.type ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}><Money value={f.amount} /></td>
                    <td>{f.status === 'Payé' ? <span className="badge ok">Payé</span> : <span className="badge crit">Impayé</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="info-cell">
      <div className="k">{label}</div>
      <div className="v">{value}</div>
    </div>
  );
}
