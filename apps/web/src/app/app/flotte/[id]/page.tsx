'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, Money, formatDateBE, VehicleStatusBadge } from '@/lib/ui';
import { PhotoHeader } from '@/components/PhotoHeader';
import { FormModal, toDateInput, type FieldDef } from '@/components/FormModal';
import { VEHICLE_STATUSES, VEHICLE_STATUS_LABEL } from '@jjd/shared';

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
    circulationTax: number | null; biv: number | null; driver: string | null; equipment: string | null; depot: string | null; note: string | null;
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
  const [editing, setEditing] = useState(false);
  if (loading) return <div className="empty">Chargement…</div>;
  if (!data) return <div className="empty">Véhicule introuvable.</div>;
  const v = data.vehicle;
  const ins = v.insurances[0];
  const nextPay = v.payments.find((p) => p.dueOn && new Date(p.dueOn).getTime() >= Date.now());

  const editFields: FieldDef[] = [
    { name: 'brand', label: 'Marque' },
    { name: 'model', label: 'Modèle' },
    { name: 'plate', label: 'Plaque' },
    { name: 'type', label: 'Type', placeholder: 'Camionette, Moto, Clark, Voiture…' },
    { name: 'status', label: 'Statut', type: 'select', required: true, options: VEHICLE_STATUSES.map((s) => ({ value: s, label: VEHICLE_STATUS_LABEL[s] })) },
    { name: 'fuel', label: 'Carburant' },
    { name: 'driver', label: 'Conducteur' },
    { name: 'depot', label: 'Dépôt' },
    { name: 'km', label: 'Kilométrage' },
    { name: 'vin', label: 'VIN' },
    { name: 'firstRegistration', label: '1re mise en circulation', type: 'date' },
    { name: 'nextInspection', label: 'Contrôle technique', type: 'date' },
    { name: 'circulationTax', label: 'Taxe de circulation', type: 'number' },
    { name: 'biv', label: 'BIV', type: 'number' },
    { name: 'equipment', label: 'Équipements', full: true },
    { name: 'note', label: 'Note', type: 'textarea', full: true },
    { name: 'fuelConsoL100', label: 'Consommation (L/100 km)', type: 'number' },
    { name: 'fuelPricePerL', label: 'Prix carburant (€/L)', type: 'number' },
    { name: 'costPerKmExtra', label: 'Coût/km supplémentaire (€)', type: 'number', placeholder: 'pneus, entretien…' },
    { name: 'parkingMonthly', label: 'Parking / garage (€/mois)', type: 'number' },
    { name: 'otherMonthly', label: 'Autres frais fixes (€/mois)', type: 'number', placeholder: 'GPS, télépéage…' },
  ];

  return (
    <>
      {editing && (
        <FormModal
          title={`Modifier ${[v.brand, v.model].filter(Boolean).join(' ') || v.code || 'le véhicule'}`}
          fields={editFields}
          initial={{
            brand: v.brand, model: v.model, plate: v.plate, type: v.type, status: v.status,
            fuel: v.fuel, driver: v.driver, depot: v.depot, km: v.km, vin: v.vin,
            firstRegistration: toDateInput(v.firstRegistration), nextInspection: toDateInput(v.nextInspection),
            circulationTax: v.circulationTax, biv: v.biv, equipment: v.equipment, note: v.note,
            fuelConsoL100: v.fuelConsoL100, fuelPricePerL: v.fuelPricePerL, costPerKmExtra: v.costPerKmExtra,
            parkingMonthly: v.parkingMonthly, otherMonthly: v.otherMonthly,
          }}
          onClose={() => setEditing(false)}
          onSubmit={async (body) => { await api(`/api/vehicles/${v.id}`, { method: 'PATCH', body }); reload(); }}
        />
      )}
      <PageHead
        title={[v.brand, v.model].filter(Boolean).join(' ')}
        sub={`${v.plate ?? 'sans plaque'} · ${v.code ?? ''} · ${v.type ?? ''}`}
        action={
          <div className="row">
            <button className="btn" onClick={() => setEditing(true)}>Modifier</button>
            <Link href="/app/flotte" className="btn">← Flotte</Link>
          </div>
        }
      />
      <PhotoHeader
        basePath={`/api/vehicles/${v.id}`}
        photoUrl={v.photoUrl}
        alt={[v.brand, v.model].filter(Boolean).join(' ')}
        fallback="🚐"
        onChange={reload}
      />
      <div className="row" style={{ marginBottom: '1rem' }}>
        <VehicleStatusBadge status={v.status} />
      </div>
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

      <CostSection v={v} />

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

function CostSection({ v }: { v: Detail['vehicle'] }) {
  const conso = v.fuelConsoL100 ?? 0;
  const price = v.fuelPricePerL ?? 0;
  const extra = v.costPerKmExtra ?? 0;
  const perKm = conso > 0 && price > 0 ? (conso / 100) * price + extra : extra > 0 ? extra : null;
  const b = v.costBreakdown;
  const configured = v.fuelConsoL100 != null || v.fuelPricePerL != null || v.costPerKmExtra != null
    || v.parkingMonthly != null || v.otherMonthly != null;

  return (
    <section className="card card-pad" style={{ marginBottom: '1.4rem' }}>
      <h2 style={{ marginBottom: '0.3rem' }}>Coût de revient — imputé aux chantiers</h2>
      <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
        Les jours où ce véhicule est planifié sur un chantier, on impute : un aller-retour dépôt ↔ chantier
        (carburant + usure) + une quote-part journalière des coûts fixes. Réglages dans « Modifier ».
      </p>

      {!configured && <p className="muted" style={{ fontSize: '0.85rem' }}>Pas encore réglé — clique « Modifier » ci-dessus.</p>}

      <div className="info-grid" style={{ marginTop: '0.6rem' }}>
        <Info label="Consommation" value={v.fuelConsoL100 != null ? `${v.fuelConsoL100} L/100 km` : '—'} />
        <Info label="Prix carburant" value={v.fuelPricePerL != null ? `${v.fuelPricePerL} €/L` : '—'} />
        <Info label="Coût/km supplémentaire" value={v.costPerKmExtra != null ? <Money value={v.costPerKmExtra} /> : '—'} />
        <Info label="Parking / garage" value={v.parkingMonthly != null ? <><Money value={v.parkingMonthly} />/mois</> : '—'} />
        <Info label="Autres frais fixes" value={v.otherMonthly != null ? <><Money value={v.otherMonthly} />/mois</> : '—'} />
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
