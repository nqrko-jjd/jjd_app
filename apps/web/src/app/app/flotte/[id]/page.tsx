'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, Money, formatDateBE } from '@/lib/ui';
import { PhotoHeader } from '@/components/PhotoHeader';

interface Detail {
  vehicle: {
    id: string; code: string | null; brand: string | null; model: string | null; plate: string | null;
    photoUrl: string | null;
    type: string | null; fuel: string | null; vin: string | null; km: string | null;
    firstRegistration: string | null; nextInspection: string | null; status: string;
    fuelConsoL100: number | null; fuelPricePerL: number | null; costPerKmExtra: number | null; costPerKm: number | null;
    parkingMonthly: number | null; otherMonthly: number | null;
    costBreakdown: {
      fixed: { insurance: number; financing: number; tax: number; parking: number; other: number; monthly: number; perDay: number };
      fuelPerKm: number | null; workDaysPerYear: number;
    } | null;
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
  const { data, loading, reload } = useApi<Detail>(`/api/vehicles/${id}`);
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
        action={<Link href="/app/flotte" className="btn">← Flotte</Link>}
      />
      <PhotoHeader
        basePath={`/api/vehicles/${v.id}`}
        photoUrl={v.photoUrl}
        alt={[v.brand, v.model].filter(Boolean).join(' ')}
        fallback="🚐"
        onChange={reload}
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

      <CostSection v={v} onSaved={reload} />

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

function CostSection({ v, onSaved }: { v: Detail['vehicle']; onSaved: () => void }) {
  const init = () => ({
    fuelConsoL100: v.fuelConsoL100?.toString() ?? '',
    fuelPricePerL: v.fuelPricePerL?.toString() ?? '',
    costPerKmExtra: v.costPerKmExtra?.toString() ?? '',
    parkingMonthly: v.parkingMonthly?.toString() ?? '',
    otherMonthly: v.otherMonthly?.toString() ?? '',
  });
  const [f, setF] = useState(init);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setF(init()); setSaved(false); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [v.id, v.fuelConsoL100, v.fuelPricePerL, v.costPerKmExtra, v.parkingMonthly, v.otherMonthly]);

  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
  const conso = num(f.fuelConsoL100) ?? 0;
  const price = num(f.fuelPricePerL) ?? 0;
  const extra = num(f.costPerKmExtra) ?? 0;
  const perKm = conso > 0 && price > 0 ? (conso / 100) * price + extra : extra > 0 ? extra : null;
  const b = v.costBreakdown;

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => { setF({ ...f, [k]: e.target.value }); setSaved(false); };
  async function save() {
    await api(`/api/vehicles/${v.id}`, {
      method: 'PATCH',
      body: {
        fuelConsoL100: num(f.fuelConsoL100), fuelPricePerL: num(f.fuelPricePerL), costPerKmExtra: num(f.costPerKmExtra),
        parkingMonthly: num(f.parkingMonthly), otherMonthly: num(f.otherMonthly),
      },
    });
    setSaved(true);
    onSaved();
  }

  return (
    <section className="card card-pad" style={{ marginBottom: '1.4rem' }}>
      <h2 style={{ marginBottom: '0.3rem' }}>Coût de revient — imputé aux chantiers</h2>
      <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
        Les jours où ce véhicule est planifié sur un chantier, on impute : un aller-retour dépôt ↔ chantier
        (carburant + usure) + une quote-part journalière des coûts fixes ci-dessous.
      </p>

      <div className="eyebrow" style={{ marginTop: '0.6rem' }}>Carburant &amp; usure (au km)</div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <label className="field"><span>Consommation (L/100 km)</span>
          <input className="input" type="number" step={0.1} min={0} value={f.fuelConsoL100} onChange={set('fuelConsoL100')} placeholder="ex. 8,5" /></label>
        <label className="field"><span>Prix carburant (€/L)</span>
          <input className="input" type="number" step={0.01} min={0} value={f.fuelPricePerL} onChange={set('fuelPricePerL')} placeholder="ex. 1,75" /></label>
        <label className="field"><span>Coût/km supplémentaire (€)</span>
          <input className="input" type="number" step={0.01} min={0} value={f.costPerKmExtra} onChange={set('costPerKmExtra')} placeholder="pneus, entretien…" /></label>
      </div>

      <div className="eyebrow" style={{ marginTop: '0.9rem' }}>Coûts fixes mensuels</div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <label className="field"><span>Parking / garage (€/mois)</span>
          <input className="input" type="number" step={1} min={0} value={f.parkingMonthly} onChange={set('parkingMonthly')} /></label>
        <label className="field"><span>Autres frais (€/mois)</span>
          <input className="input" type="number" step={1} min={0} value={f.otherMonthly} onChange={set('otherMonthly')} placeholder="GPS, télépéage…" /></label>
      </div>

      <div className="row" style={{ marginTop: '0.9rem', gap: '1rem', alignItems: 'baseline' }}>
        <button className="btn primary" onClick={save}>Enregistrer</button>
        {saved && <span className="muted">enregistré</span>}
      </div>

      {b && (
        <div className="info-grid" style={{ marginTop: '1rem' }}>
          <Info label="Assurance /mois" value={<Money value={b.fixed.insurance} />} />
          <Info label="Financement /mois" value={<Money value={b.fixed.financing} />} />
          <Info label="Taxe + BIV /mois" value={<Money value={b.fixed.tax} />} />
          <Info label="Parking + autres /mois" value={<Money value={b.fixed.parking + b.fixed.other} />} />
          <Info label="Total fixe /mois" value={<strong><Money value={b.fixed.monthly} /></strong>} />
          <Info label="Coût fixe / jour de chantier" value={<strong><Money value={b.fixed.perDay} /></strong>} />
          <Info label="Carburant + usure" value={perKm != null ? `${perKm.toFixed(3)} €/km` : '—'} />
          <Info label="Base de répartition" value={`${b.workDaysPerYear} j ouvrés / an`} />
        </div>
      )}
    </section>
  );
}
