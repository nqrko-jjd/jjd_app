'use client';
import { Truck } from 'lucide-react';
import { SkeletonRows, EmptyState, ErrorState } from '@/components/States';
import { use, useRef, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api, apiBlobUrl, apiUpload } from '@/lib/api';
import { PageHead, Money, formatDateBE, VehicleStatusBadge, PlateBE } from '@/lib/ui';
import { PhotoHeader } from '@/components/PhotoHeader';
import { FormModal, toDateInput, type FieldDef } from '@/components/FormModal';
import { DocWithFileModal } from '@/components/DocWithFileModal';
import { VEHICLE_STATUSES, VEHICLE_STATUS_LABEL, VEHICLE_DOC_LABEL, VEHICLE_DOC_TYPES } from '@jjd/shared';

interface Detail {
  vehicle: {
    id: string; code: string | null; brand: string | null; model: string | null; plate: string | null;
    photoUrl: string | null;
    type: string | null; seats: number | null; fuel: string | null; vin: string | null; km: string | null;
    firstRegistration: string | null; nextInspection: string | null; status: string; excludedFromPlanning: boolean;
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
    docs: { id: string; type: string; label: string | null; number: string | null; expiresOn: string | null; fileUrl: string | null }[];
    repairs: Repair[];
    ledgerEntries: { id: string; date: string | null; docNumber: string | null; supplierName: string | null; ht: number; ttc: number | null; pdfPath: string | null; categoryRaw: string | null }[];
  };
}

interface Purchase { id: string; docNumber: string | null; supplierName: string | null; date: string | null; ttc: number | null; ht: number; direction?: string; vehicleId?: string | null; pdfPath?: string | null; hasPdf?: boolean }
interface Repair { ledgerEntryId?: string | null; ledgerEntry?: Purchase | null; id: string; date: string | null; description: string | null; garage: string | null; amount: number | null; km: string | null }

const REPAIR_FIELDS: FieldDef[] = [
  { name: 'date', label: 'Date', type: 'date' },
  { name: 'description', label: 'Réparation / entretien', placeholder: 'Plaquettes de frein, courroie…' },
  { name: 'garage', label: 'Garage / fournisseur' },
  { name: 'amount', label: 'Montant (€)', type: 'number' },
  { name: 'km', label: 'Kilométrage' },
];

export default function VehicleDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, loading, error, reload } = useApi<Detail>(`/api/vehicles/${id}`);
  const [editing, setEditing] = useState(false);
  const [addingDoc, setAddingDoc] = useState(false);
  const [repairModal, setRepairModal] = useState<'new' | Repair | null>(null);
  if (loading) return <SkeletonRows />;
  if (!data) {
    return error
      ? <ErrorState message={error} onRetry={reload} />
      : <EmptyState icon={Truck} title="Véhicule introuvable" text="Ce véhicule n’existe plus ou a été supprimé. Retournez à la flotte." action={<Link href="/app/flotte" className="btn primary">Retour à la flotte</Link>} />;
  }
  const v = data.vehicle;

  const nextPay = v.payments.find((p) => p.dueOn && new Date(p.dueOn).getTime() >= Date.now());

  async function removeDoc(docId: string) {
    if (!confirm('Supprimer ce document ?')) return;
    await api(`/api/vehicles/${id}/docs/${docId}`, { method: 'DELETE' });
    reload();
  }
  async function viewDocFile(docId: string) {
    const url = await apiBlobUrl(`/api/vehicles/${id}/docs/${docId}/file`);
    window.open(url, '_blank');
  }
  async function removeRepair(repairId: string) {
    if (!confirm('Supprimer cette réparation ?')) return;
    await api(`/api/vehicles/${id}/repairs/${repairId}`, { method: 'DELETE' });
    reload();
  }
  async function viewExpensePdf(entryId: string) {
    const url = await apiBlobUrl(`/api/finance/expenses/${entryId}/pdf`);
    window.open(url, '_blank');
  }
  const totalRepairs = v.repairs.reduce((s, r) => s + (r.amount ?? 0), 0);

  const editFields: FieldDef[] = [
    { name: 'brand', label: 'Marque' },
    { name: 'model', label: 'Modèle' },
    { name: 'plate', label: 'Plaque' },
    { name: 'type', label: 'Type', placeholder: 'Camionette, Moto, Clark, Voiture…' },
    { name: 'seats', label: 'Nombre de places', type: 'number' },
    { name: 'status', label: 'Statut', type: 'select', required: true, options: VEHICLE_STATUSES.map((s) => ({ value: s, label: VEHICLE_STATUS_LABEL[s] })) },
    { name: 'fuel', label: 'Carburant' },
    { name: 'driver', label: 'Conducteur' },
    { name: 'depot', label: 'Dépôt' },
    { name: 'excludedFromPlanning', label: 'Hors planning (véhicule personnel, chariot élévateur… pas affecté aux chantiers)', type: 'checkbox' },
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
      {addingDoc && (
        <DocWithFileModal
          title="Nouveau document"
          typeOptions={VEHICLE_DOC_TYPES.map((t) => ({ value: t, label: VEHICLE_DOC_LABEL[t] }))}
          onClose={() => setAddingDoc(false)}
          onSubmit={async (v, file) => {
            const { doc } = await api<{ doc: { id: string } }>(`/api/vehicles/${id}/docs`, {
              method: 'POST',
              body: {
                type: v.type,
                label: v.label || null,
                number: v.number || null,
                issuedOn: v.issuedOn || null,
                expiresOn: v.expiresOn || null,
              },
            });
            if (file) {
              const fd = new FormData();
              fd.append('file', file);
              await apiUpload(`/api/vehicles/${id}/docs/${doc.id}/file`, fd);
            }
            reload();
          }}
        />
      )}
      {repairModal && (
        <RepairInvoiceModal vehicleId={id} repair={repairModal} onClose={() => setRepairModal(null)} onSaved={reload} />
      )}
      {editing && (
        <FormModal
          title={`Modifier ${[v.brand, v.model].filter(Boolean).join(' ') || v.code || 'le véhicule'}`}
          fields={editFields}
          initial={{
            brand: v.brand, model: v.model, plate: v.plate, type: v.type, seats: v.seats, status: v.status,
            fuel: v.fuel, driver: v.driver, depot: v.depot, excludedFromPlanning: v.excludedFromPlanning, km: v.km, vin: v.vin,
            firstRegistration: toDateInput(v.firstRegistration), nextInspection: toDateInput(v.nextInspection),
            circulationTax: v.circulationTax, biv: v.biv, equipment: v.equipment, note: v.note,
            fuelConsoL100: v.fuelConsoL100, fuelPricePerL: v.fuelPricePerL, costPerKmExtra: v.costPerKmExtra,
            parkingMonthly: v.parkingMonthly, otherMonthly: v.otherMonthly,
          }}
          onClose={() => setEditing(false)}
          onSubmit={async (body) => { await api(`/api/vehicles/${v.id}`, { method: 'PATCH', body }); reload(); }}
        />
      )}
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.9rem', flexWrap: 'wrap' }}>
        <Link href="/app/flotte" className="btn ghost">← Flotte</Link>
        <button className="btn" onClick={() => setEditing(true)}>Modifier</button>
      </div>

      <div className="vehicle-sheet">
      <section className="vehicle-cover">
        <div className="vehicle-cover-copy">
          <div className="eyebrow">Flotte · fiche véhicule</div>
          <h1>{[v.brand, v.model].filter(Boolean).join(' ') || v.code || 'Véhicule'}</h1>
          <div className="vehicle-identity">
            {v.plate && <PlateBE plate={v.plate} size={78} />}
            {[v.code, v.type].filter(Boolean).join(' · ')}
          </div>
          <div className="row"><VehicleStatusBadge status={v.status} />{v.excludedFromPlanning && <span className="badge plain">Hors planning</span>}</div>
          <div className="vehicle-essentials">
            {present(v.driver) && <Info label="Conducteur habituel" value={v.driver} />}
            {present(v.seats) && <Info label="Capacité" value={`${v.seats} places`} />}
            {present(v.depot) && <Info label="Dépôt" value={v.depot} />}
            {present(v.km) && <Info label="Kilométrage" value={`${v.km} km`} />}
          </div>
        </div>
        <div className="vehicle-photo"><PhotoHeader
          basePath={`/api/vehicles/${v.id}`} photoUrl={v.photoUrl}
          alt={[v.brand, v.model].filter(Boolean).join(' ')}
          fallback={<Truck size={64} strokeWidth={1.2} />} onChange={reload}
        /></div>
      </section>
      <div className="vehicle-actions">
        <button className="btn primary" onClick={() => setRepairModal('new')}>+ Enregistrer un entretien</button>
        <button className="btn" onClick={() => setAddingDoc(true)}>+ Ajouter un document</button>
        <Link href="/app/achats" className="btn ghost">Achats & dépenses ↗</Link>
      </div>
      <div className="vehicle-overview">
        <section className="vehicle-panel">
          <div className="eyebrow">Au quotidien</div><h2>Repères du véhicule</h2>
          <div className="vehicle-facts">
            {present(v.nextInspection) && <Info label="Prochain contrôle technique" value={<span className={new Date(v.nextInspection!).getTime() < Date.now() + 30 * 86400000 ? 'badge crit' : ''}>{formatDateBE(v.nextInspection)}</span>} />}
            {present(v.fuel) && <Info label="Carburant" value={v.fuel} />}
            {present(v.firstRegistration) && <Info label="Première mise en circulation" value={formatDateBE(v.firstRegistration)} />}
            {present(v.vin) && <Info label="Numéro de châssis (VIN)" value={v.vin} />}
            {present(v.equipment) && <Info label="Équipements à bord" value={v.equipment} />}
          </div>
          {v.note && <div className="vehicle-note"><strong>À savoir</strong><p>{v.note}</p></div>}
          {![v.nextInspection, v.fuel, v.firstRegistration, v.vin, v.equipment, v.note].some(present) && <button className="btn ghost" onClick={() => setEditing(true)}>Compléter les informations</button>}
        </section>
        <CostSection v={v} />
      </div>
      {(v.insurances.some(i => Object.values(i).some(present)) || [v.acquisitionMode,v.purchaseDate,v.purchasePriceHt,v.financedAmount,v.monthlyPayment,v.downPayment,v.residualValue,v.financeMonths,v.financeEndOn,v.financeCompany,v.financeContract,v.circulationTax,v.biv].some(present)) &&
      <details className="vehicle-fold">
        <summary><span><strong>Assurance & financement</strong><small>Contrats, acquisition et taxes</small></span><span className="vehicle-fold-hint">Détails</span></summary>
        <div className="vehicle-fold-body">
          {v.insurances.filter(i => Object.values(i).some(present)).map((ins, index) => <section key={index} className="vehicle-subsection"><h3>Assurance{ins.provider ? ` · ${ins.provider}` : ''}</h3><div className="vehicle-facts">
            {present(ins.contractNumber) && <Info label="Contrat" value={ins.contractNumber} />}
            {present(ins.monthlyAmount) && <Info label="Mensualité" value={<Money value={ins.monthlyAmount} />} />}
            {present(ins.annualAmount) && <Info label="Montant annuel" value={<Money value={ins.annualAmount} />} />}
            {present(ins.paymentMode) && <Info label="Paiement" value={ins.paymentMode} />}
          </div></section>)}
          <div className="vehicle-facts">
            {present(v.acquisitionMode) && <Info label="Acquisition" value={v.acquisitionMode} />}
            {present(v.purchaseDate) && <Info label="Date d’achat" value={formatDateBE(v.purchaseDate)} />}
            {([['Prix HTVA',v.purchasePriceHt],['Montant financé',v.financedAmount],['Mensualité',v.monthlyPayment],['Acompte',v.downPayment],['Valeur résiduelle',v.residualValue],['Taxe de circulation',v.circulationTax],['BIV',v.biv]] as const).filter(([,value]) => present(value)).map(([label,value]) => <Info key={label} label={label} value={<Money value={value} />} />)}
            {present(v.financeMonths) && <Info label="Durée" value={`${v.financeMonths} mois`} />}
            {present(v.financeEndOn) && <Info label="Fin du financement" value={formatDateBE(v.financeEndOn)} />}
            {present(v.financeCompany) && <Info label="Organisme" value={v.financeCompany} />}
            {present(v.financeContract) && <Info label="Référence du contrat" value={v.financeContract} />}
          </div>
        </div>
      </details>}

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

      {v.docs.length > 0 && (
      <section style={{ marginBottom: '1.4rem' }}>
        <div className="section-title">
          Documents
          <button className="btn primary" style={{ marginLeft: 'auto', padding: '0.2rem 0.7rem', fontSize: '0.8rem' }} onClick={() => setAddingDoc(true)}>+ Ajouter</button>
        </div>
        {v.docs.length === 0 ? (
          <div className="card card-pad muted">Aucun document enregistré (certificat d’immatriculation, assurance, contrôle technique…).</div>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Type</th><th>Numéro</th><th>Échéance</th><th>Pièce jointe</th><th /></tr></thead>
              <tbody>
                {v.docs.map((d) => {
                  const soon = d.expiresOn && new Date(d.expiresOn).getTime() < Date.now() + 30 * 86400000;
                  return (
                    <tr key={d.id}>
                      <td>{d.label || VEHICLE_DOC_LABEL[d.type as keyof typeof VEHICLE_DOC_LABEL] || d.type}</td>
                      <td className="mono">{d.number ?? '—'}</td>
                      <td className="tnum">{d.expiresOn ? <span className={soon ? 'badge crit' : ''}>{formatDateBE(d.expiresOn)}</span> : '—'}</td>
                      <td><VehicleDocFile vehicleId={id} docId={d.id} hasFile={!!d.fileUrl} onView={() => viewDocFile(d.id)} onUploaded={reload} /></td>
                      <td style={{ textAlign: 'right' }}><button className="btn ghost" onClick={() => removeDoc(d.id)} aria-label="Supprimer">✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      )}

      {v.repairs.length > 0 && (
      <section style={{ marginBottom: '1.4rem' }}>
        <div className="section-title">
          Réparations{v.repairs.length > 0 && ` — ${totalRepairs.toLocaleString('fr-BE', { maximumFractionDigits: 0 })} €`}
          <button className="btn primary" style={{ marginLeft: 'auto', padding: '0.2rem 0.7rem', fontSize: '0.8rem' }} onClick={() => setRepairModal('new')}>+ Ajouter</button>
        </div>
        {v.repairs.length === 0 ? (
          <div className="card card-pad muted">Aucune réparation enregistrée pour l’instant.</div>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Date</th><th>Réparation</th><th>Garage</th><th>Facture d’achat</th><th>Km</th><th style={{ textAlign: 'right' }}>Montant</th><th /></tr></thead>
              <tbody>
                {v.repairs.map((r) => (
                  <tr key={r.id}>
                    <td className="tnum">{formatDateBE(r.date)}</td>
                    <td>{r.description ?? '—'}</td>
                    <td>{r.garage ?? '—'}</td>
                    <td>{r.ledgerEntry ? <div><Link href={`/app/achats?q=${encodeURIComponent(r.ledgerEntry.docNumber || r.ledgerEntry.supplierName || '')}`} className="link">{r.ledgerEntry.docNumber || 'Facture liée'}</Link><div className="muted">{r.ledgerEntry.supplierName}</div>{(r.ledgerEntry.pdfPath || r.ledgerEntry.hasPdf) && <button className="btn ghost" onClick={() => viewExpensePdf(r.ledgerEntry!.id)}>Voir le PDF</button>}</div> : <button className="btn ghost" onClick={() => setRepairModal(r)}>Lier une facture</button>}</td>
                    <td className="tnum">{r.km ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}><Money value={r.amount} /></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn ghost" style={{ padding: '0.15rem 0.45rem', fontSize: '0.75rem' }} onClick={() => setRepairModal(r)}>Modifier</button>
                      <button className="btn ghost" style={{ padding: '0.15rem 0.45rem', fontSize: '0.75rem' }} onClick={() => removeRepair(r.id)} aria-label="Supprimer">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      )}

      {v.ledgerEntries.length > 0 && (
      <section style={{ marginBottom: '1.4rem' }}>
        <div className="section-title">
          Factures liées (Achats)
          <Link href="/app/achats" className="btn" style={{ marginLeft: 'auto', padding: '0.2rem 0.7rem', fontSize: '0.8rem' }}>+ Ajouter une facture</Link>
        </div>
        {v.ledgerEntries.length === 0 ? (
          <div className="card card-pad muted">
            Aucune facture/dépense liée à ce véhicule pour l’instant. Depuis Achats & dépenses, indique ce véhicule sur une facture (réparation, entretien…) pour qu’elle apparaisse ici, avec son PDF.
          </div>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Date</th><th>Fournisseur</th><th>N° facture</th><th>Catégorie</th><th style={{ textAlign: 'right' }}>Montant</th><th /></tr></thead>
              <tbody>
                {v.ledgerEntries.map((e) => (
                  <tr key={e.id}>
                    <td className="tnum">{formatDateBE(e.date)}</td>
                    <td>{e.supplierName ?? '—'}</td>
                    <td className="mono" style={{ fontSize: '0.82rem' }}>{e.docNumber ?? '—'}</td>
                    <td>{e.categoryRaw ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}><Money value={e.ttc ?? e.ht} /></td>
                    <td style={{ textAlign: 'right' }}>
                      {e.pdfPath
                        ? <button className="btn ghost" style={{ padding: '0.15rem 0.45rem', fontSize: '0.75rem' }} onClick={() => viewExpensePdf(e.id)}>📎 PDF</button>
                        : <span className="muted" style={{ fontSize: '0.75rem' }}>Pas de PDF</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
      </div>
    </>
  );
}

function VehicleDocFile({ vehicleId, docId, hasFile, onView, onUploaded }: { vehicleId: string; docId: string; hasFile: boolean; onView: () => void; onUploaded: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload(f: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      await apiUpload(`/api/vehicles/${vehicleId}/docs/${docId}/file`, fd);
      onUploaded();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row" style={{ gap: '0.4rem', alignItems: 'center' }}>
      <input ref={inputRef} type="file" accept="application/pdf,image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
      {hasFile && <button className="btn" style={{ padding: '0.15rem 0.5rem', fontSize: '0.76rem' }} onClick={onView}>Voir 📎</button>}
      <button className="btn" style={{ padding: '0.15rem 0.5rem', fontSize: '0.76rem' }} disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? 'Envoi…' : hasFile ? 'Remplacer' : 'Joindre'}
      </button>
    </div>
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

function present(value: unknown) { return value !== null && value !== undefined && value !== ''; }

function CostSection({ v }: { v: Detail['vehicle'] }) {
  const conso = v.fuelConsoL100 ?? 0;
  const price = v.fuelPricePerL ?? 0;
  const extra = v.costPerKmExtra ?? 0;
  const perKm = conso > 0 && price > 0 ? (conso / 100) * price + extra : extra > 0 ? extra : null;
  const b = v.costBreakdown;
  const configured = [v.fuelConsoL100,v.fuelPricePerL,v.costPerKmExtra,v.parkingMonthly,v.otherMonthly].some(present) || (b?.fixed.monthly ?? 0) > 0;
  if (!configured) return null;
  return <section className="vehicle-panel vehicle-cost">
    <div className="eyebrow">Budget véhicule</div><h2>Coût de revient</h2>
    <div className="vehicle-cost-totals">
      {b && <div><span>Frais fixes / mois</span><strong><Money value={b.fixed.monthly} /></strong></div>}
      {perKm != null && <div><span>Carburant + usure</span><strong>{perKm.toFixed(3)} <small>€/km</small></strong></div>}
    </div>
    {b && <p className="vehicle-cost-caption">Soit <strong><Money value={b.fixed.perDay} /></strong> de frais fixes par jour de chantier.</p>}
    <details className="vehicle-cost-detail"><summary>Comprendre le calcul</summary>
      <p className="muted">Chaque jour planifié : un aller-retour dépôt–chantier (carburant et usure), plus la quote-part des frais fixes. Réglages dans « Modifier ».</p>
      <div className="vehicle-facts">
        {present(v.fuelConsoL100) && <Info label="Consommation" value={`${v.fuelConsoL100} L/100 km`} />}
        {present(v.fuelPricePerL) && <Info label="Prix carburant" value={`${v.fuelPricePerL} €/L`} />}
        {present(v.costPerKmExtra) && <Info label="Supplément / km" value={<Money value={v.costPerKmExtra} />} />}
        {present(v.parkingMonthly) && <Info label="Parking / mois" value={<Money value={v.parkingMonthly} />} />}
        {present(v.otherMonthly) && <Info label="Autres frais / mois" value={<Money value={v.otherMonthly} />} />}
        {b && <><Info label="Assurance / mois" value={<Money value={b.fixed.insurance} />} /><Info label="Financement / mois" value={<Money value={b.fixed.financing} />} /><Info label="Taxe + BIV / mois" value={<Money value={b.fixed.tax} />} /><Info label="Base de répartition" value={`${b.workDaysPerYear} jours ouvrés / an`} /></>}
      </div>
    </details>
  </section>;
}

function RepairInvoiceModal({vehicleId, repair, onClose, onSaved}: {vehicleId: string; repair: 'new' | Repair; onClose: () => void; onSaved: () => void}) {
  const [query, setQuery] = useState('');
  const {data, loading, error} = useApi<{items: Purchase[]}>(`/api/finance/expenses?q=${encodeURIComponent(query)}&pageSize=100`);
  const current = repair === 'new' ? null : repair.ledgerEntry;
  const choices = [...(current ? [current] : []), ...(data?.items || [])].filter((e,i,all) => all.findIndex(x=>x.id===e.id)===i && (!e.direction || e.direction==='purchase') && (!e.vehicleId || e.vehicleId===vehicleId));
  return <FormModal title={repair === 'new' ? 'Enregistrer un entretien' : 'Modifier l’entretien'}
    fields={[...REPAIR_FIELDS.map(f => f.name === 'amount' ? {...f,label:'Coût de cet entretien (€ TTC)'} : f),
      {name:'invoiceSearch',label:'Rechercher une facture d’achat',placeholder:'Fournisseur ou numéro de facture',full:true,action:{label:'Rechercher',run:async value=>{setQuery(value);return {}}}},
      {name:'ledgerEntryId',label:error ? 'Factures indisponibles — réessayez la recherche' : loading ? 'Chargement des factures…' : `Facture liée (facultatif) · ${choices.length} résultat(s)`,type:'select',full:true,
       options:[{value:'',label:'Sans facture pour le moment'},...choices.map(e=>({value:e.id,label:[e.docNumber,e.supplierName,formatDateBE(e.date),`${(e.ttc ?? e.ht).toLocaleString('fr-BE')} € TTC`].filter(Boolean).join(' · ')}))],
       action:{label:'Reprendre fournisseur et montant',run:async value=>{const e=choices.find(e=>e.id===value);if(!e)throw Error('Choisissez une facture.');return {garage:e.supplierName,amount:e.ttc ?? e.ht};}}}
    ]}
    initial={repair==='new'?{}:{...repair,date:toDateInput(repair.date)}} onClose={onClose}
    onSubmit={async values=>{const {invoiceSearch,...body}=values;await api(`/api/vehicles/${vehicleId}/repairs${repair==='new'?'':`/${repair.id}`}`,{method:repair==='new'?'POST':'PATCH',body});onSaved();}} />;
}
