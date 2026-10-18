'use client';
import { tr } from '@/lib/ui-language';
import { SkeletonRows, ErrorState, EmptyState } from '@/components/States';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api, apiBlobUrl, apiUpload } from '@/lib/api';
import { Truck, ReceiptText } from 'lucide-react';
import { PageHead, Money, formatDateBE, formatEur, Thumb } from '@/lib/ui';

interface Fine {
  id: string; date: string | null; time: string | null; reference: string | null; payTo: string | null; street: string | null; postalCode: string | null;
  type: string | null; amount: number | null; status: string | null; paidOn: string | null; plateRaw: string | null; note: string | null;
  reminder1On: string | null; reminder2On: string | null; driverPersonId: string | null; driverName: string | null; hasPdf: boolean;
  planned: { drivers: string[]; team: string[] };
  vehicle: { id: string; brand: string | null; model: string | null; plate: string | null; photoThumbUrl: string | null } | null;
}
interface VehicleOpt { id: string; brand: string | null; model: string | null; plate: string | null; name: string | null }
const TYPES = ['Stationnement', 'Excès de vitesse', 'Feu rouge', 'Zone basse émission (LEZ)', 'Téléphone au volant', 'Taxe de circulation', 'Autre'];
const dayInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
const vLabel = (v: { brand: string | null; model: string | null; plate: string | null; name?: string | null }) => [v.name ?? [v.brand, v.model].filter(Boolean).join(' '), v.plate].filter(Boolean).join(' · ') || 'Véhicule';
const late = (f: Fine) => f.status !== 'Payé' && [f.reminder1On, f.reminder2On].some((d) => d && new Date(d) < new Date());

/** PV / amendes de la flotte : ajouter, modifier, marquer payé, joindre le scan, retrouver qui conduisait (planning), supprimer. */
export default function PvPage() {
  const [unpaid, setUnpaid] = useState(true);
  const [q, setQ] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const qs = useMemo(() => new URLSearchParams({ ...(unpaid ? { unpaid: '1' } : {}), ...(q.trim() ? { q: q.trim() } : {}), ...(vehicleId ? { vehicleId } : {}) }).toString(), [unpaid, q, vehicleId]);
  const { data, loading, error, reload } = useApi<{ items: Fine[] }>(`/api/vehicles/fines${qs ? `?${qs}` : ''}`);
  const { data: vehData } = useApi<{ items: VehicleOpt[] }>('/api/vehicles');
  const { data: pick } = useApi<{ people: { id: string; name: string }[] }>('/api/meta/pickers');
  const [edit, setEdit] = useState<Fine | 'new' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const items = data?.items ?? [];
  const total = items.reduce((s, f) => s + (f.amount ?? 0), 0);
  const dueNow = items.filter(late).length;

  async function run(fn: () => Promise<unknown>, ok: string) {
    setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); reload(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  }
  const setPaid = (f: Fine, paid: boolean) => run(() => api(`/api/vehicles/fines/${f.id}`, { method: 'PATCH', body: { status: paid ? 'Payé' : null } }), paid ? 'PV marqué payé.' : 'PV remis en impayé.');
  const remove = (f: Fine) => { if (window.confirm(`Supprimer le PV ${f.reference ?? ''} (${f.amount != null ? formatEur(f.amount) : 'sans montant'}) ? Cette action est définitive.`)) run(() => api(`/api/vehicles/fines/${f.id}`, { method: 'DELETE' }), 'PV supprimé.'); };
  const openFile = async (f: Fine) => { try { window.open(await apiBlobUrl(`/api/vehicles/fines/${f.id}/file`), '_blank'); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } };

  return (
    <>
      <PageHead
        title="PV / amendes"
        sub={data ? `${items.length} PV · ${formatEur(total)}${dueNow ? ` · ${dueNow} rappel${dueNow > 1 ? 's' : ''} dépassé${dueNow > 1 ? 's' : ''}` : ''}` : undefined}
        action={<div className="row"><Link href="/app/flotte" className="btn">← Flotte</Link><button className="btn primary" onClick={() => setEdit('new')}>+ Nouveau PV</button></div>}
      />
      {msg && <div className={`badge ${msg.ok ? 'ok' : 'crit'}`} style={{ marginBottom: '1rem', padding: '0.5rem 0.8rem' }}>{msg.text}</div>}
      <div className="row" style={{ marginBottom: '1rem', gap: '0.8rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <label className="row" style={{ gap: '0.4rem' }}><input type="checkbox" checked={unpaid} onChange={(e) => setUnpaid(e.target.checked)} /> Impayés uniquement</label>
        <input className="input" style={{ maxWidth: 240 }} placeholder="Référence, plaque, lieu, type…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" style={{ width: 'auto', maxWidth: 260 }} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} aria-label="Véhicule">
          <option value="">Tous les véhicules</option>
          {(vehData?.items ?? []).map((v) => <option key={v.id} value={v.id}>{vLabel(v)}</option>)}
        </select>
      </div>
      {loading && !data && <SkeletonRows />}
      {error && !loading && <ErrorState message={error} onRetry={reload} />}
      {data && items.length === 0 && <EmptyState icon={ReceiptText} title="Aucun PV" text={unpaid ? 'Aucun PV impayé. Décochez « Impayés uniquement » pour voir tout l’historique, ou ajoutez-en un.' : 'Aucun PV ne correspond.'} action={<button className="btn primary" onClick={() => setEdit('new')}>+ Nouveau PV</button>} />}
      {data && items.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>{tr("Date")}</th><th>{tr("Véhicule")}</th><th>Type</th><th>À payer à</th><th>Réf</th><th>Conducteur</th><th style={{ textAlign: 'right' }}>Montant</th><th>Statut</th><th /></tr>
            </thead>
            <tbody>
              {items.map((f) => (
                <tr key={f.id} onDoubleClick={() => setEdit(f)} style={{ cursor: 'pointer' }}>
                  <td className="tnum">{formatDateBE(f.date)}{f.time ? ` ${f.time}` : ''}</td>
                  <td>
                    {f.vehicle ? (
                      <>
                        <Thumb src={f.vehicle.photoThumbUrl} size={28} icon={Truck} />
                        <Link href={`/app/flotte/${f.vehicle.id}`}>{vLabel(f.vehicle)}</Link>
                      </>
                    ) : (f.plateRaw ?? '—')}
                  </td>
                  <td>{f.type ?? '—'}{f.street ? <div className="muted" style={{ fontSize: '0.76rem' }}>{f.street}{f.postalCode ? `, ${f.postalCode}` : ''}</div> : null}</td>
                  <td>{f.payTo ?? '—'}</td>
                  <td className="mono" style={{ fontSize: '0.78rem' }}>{f.reference ?? '—'}</td>
                  <td>{f.driverName ?? (f.planned.drivers.length ? <span className="muted" title="D’après le planning ce jour-là">{f.planned.drivers.join(', ')} ?</span> : '—')}</td>
                  <td style={{ textAlign: 'right' }}><Money value={f.amount} /></td>
                  <td>
                    {f.status === 'Payé' ? <span className="badge ok" title={f.paidOn ? `Payé le ${formatDateBE(f.paidOn)}` : undefined}>{tr("Payé")}</span> : <span className="badge crit">{tr("Impayé")}</span>}
                    {late(f) && <span className="badge warn" style={{ marginLeft: 4 }} title="Un rappel est dépassé">rappel</span>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn ghost" onClick={() => setEdit(f)}>Modifier</button>
                    <button className="btn ghost" onClick={() => setPaid(f, f.status !== 'Payé')}>{f.status === 'Payé' ? 'Impayé' : 'Payé'}</button>
                    {f.hasPdf && <button className="btn ghost" onClick={() => openFile(f)}>Scan</button>}
                    <button className="btn ghost" style={{ color: 'var(--crit)' }} onClick={() => remove(f)} aria-label="Supprimer">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <FineModal fine={edit === 'new' ? null : edit} vehicles={vehData?.items ?? []} people={pick?.people ?? []} onClose={() => setEdit(null)} onSaved={(text) => { setEdit(null); setMsg({ ok: true, text }); reload(); }} />}
    </>
  );
}

function FineModal({ fine, vehicles, people, onClose, onSaved }: { fine: Fine | null; vehicles: VehicleOpt[]; people: { id: string; name: string }[]; onClose: () => void; onSaved: (text: string) => void }) {
  const [v, setV] = useState({
    vehicleId: fine?.vehicle?.id ?? '', plateRaw: fine?.plateRaw ?? '', date: dayInput(fine?.date ?? null), time: fine?.time ?? '', reference: fine?.reference ?? '', payTo: fine?.payTo ?? '',
    street: fine?.street ?? '', postalCode: fine?.postalCode ?? '', type: fine?.type ?? '', amount: fine?.amount != null ? String(fine.amount) : '', reminder1On: dayInput(fine?.reminder1On ?? null),
    reminder2On: dayInput(fine?.reminder2On ?? null), paid: fine?.status === 'Payé', paidOn: dayInput(fine?.paidOn ?? null), driverPersonId: fine?.driverPersonId ?? '', note: fine?.note ?? '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof v, val: string | boolean) => setV((s) => ({ ...s, [k]: val }));

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const body = {
        vehicleId: v.vehicleId || null, plateRaw: v.plateRaw || null, date: v.date || null, time: v.time || null, reference: v.reference || null, payTo: v.payTo || null,
        street: v.street || null, postalCode: v.postalCode || null, type: v.type || null, amount: v.amount === '' ? null : Number(v.amount.replace(',', '.')),
        reminder1On: v.reminder1On || null, reminder2On: v.reminder2On || null, status: v.paid ? 'Payé' : null, paidOn: v.paid && v.paidOn ? v.paidOn : null, driverPersonId: v.driverPersonId || null, note: v.note || null,
      };
      const r = fine ? await api<{ fine: { id: string } }>(`/api/vehicles/fines/${fine.id}`, { method: 'PATCH', body }) : await api<{ fine: { id: string } }>('/api/vehicles/fines', { method: 'POST', body });
      if (file) { const fd = new FormData(); fd.append('file', file); await apiUpload(`/api/vehicles/fines/${r.fine.id}/file`, fd); }
      onSaved(fine ? 'PV modifié.' : 'PV ajouté.');
    } catch (e2) { setErr((e2 as Error).message); setBusy(false); }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <form className="modal" style={{ maxWidth: 700, maxHeight: '92vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head"><h2>{fine ? 'Modifier le PV' : 'Nouveau PV / amende'}</h2><button type="button" className="btn ghost" onClick={onClose} aria-label={tr("Fermer")}>✕</button></div>
        <div className="modal-body">
          <div className="field"><label>Véhicule</label>
            <select className="select" value={v.vehicleId} onChange={(e) => set('vehicleId', e.target.value)}>
              <option value="">— choisir, ou saisir la plaque —</option>
              {vehicles.map((x) => <option key={x.id} value={x.id}>{vLabel(x)}</option>)}
            </select>
          </div>
          <div className="field"><label>Plaque (si le véhicule n’est pas dans la liste)</label><input className="input" value={v.plateRaw} onChange={(e) => set('plateRaw', e.target.value)} placeholder="1-ABC-123" /></div>
          <div className="field"><label>Date de l’infraction</label><input className="input" type="date" value={v.date} onChange={(e) => set('date', e.target.value)} /></div>
          <div className="field"><label>Heure</label><input className="input" type="time" value={v.time} onChange={(e) => set('time', e.target.value)} /></div>
          <div className="field"><label>Type</label><input className="input" list="pv-types" value={v.type} onChange={(e) => set('type', e.target.value)} /><datalist id="pv-types">{TYPES.map((t) => <option key={t} value={t} />)}</datalist></div>
          <div className="field"><label>Montant (€)</label><input className="input" inputMode="decimal" value={v.amount} onChange={(e) => set('amount', e.target.value)} /></div>
          <div className="field"><label>Lieu (rue)</label><input className="input" value={v.street} onChange={(e) => set('street', e.target.value)} /></div>
          <div className="field"><label>Code postal</label><input className="input" value={v.postalCode} onChange={(e) => set('postalCode', e.target.value)} /></div>
          <div className="field"><label>À payer à</label><input className="input" value={v.payTo} onChange={(e) => set('payTo', e.target.value)} placeholder="Ville, police, SPF…" /></div>
          <div className="field"><label>Référence / communication</label><input className="input" value={v.reference} onChange={(e) => set('reference', e.target.value)} /></div>
          <div className="field"><label>1er rappel</label><input className="input" type="date" value={v.reminder1On} onChange={(e) => set('reminder1On', e.target.value)} /></div>
          <div className="field"><label>2e rappel</label><input className="input" type="date" value={v.reminder2On} onChange={(e) => set('reminder2On', e.target.value)} /></div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Conducteur</label>
            <select className="select" value={v.driverPersonId} onChange={(e) => set('driverPersonId', e.target.value)}>
              <option value="">— inconnu —</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {fine && (fine.planned.drivers.length > 0 || fine.planned.team.length > 0) && (
              <span className="muted" style={{ fontSize: '0.82rem' }}>Planning ce jour-là : {fine.planned.drivers.length ? `conducteur du véhicule : ${fine.planned.drivers.join(', ')}` : 'pas de conducteur renseigné'}{fine.planned.team.length ? ` · équipe : ${fine.planned.team.join(', ')}` : ''}</span>
            )}
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}><label>Note</label><textarea className="input" rows={2} value={v.note} onChange={(e) => set('note', e.target.value)} /></div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}><input type="checkbox" checked={v.paid} onChange={(e) => set('paid', e.target.checked)} /> Payé</label>
            {v.paid && <input className="input" type="date" style={{ maxWidth: 200 }} value={v.paidOn} onChange={(e) => set('paidOn', e.target.value)} aria-label="Date de paiement" />}
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Scan ou photo du PV (PDF ou image){fine?.hasPdf ? ' — un fichier est déjà joint, en choisir un nouveau le remplace' : ''}</label>
            <input className="input" type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
        </div>
        {err && <div className="badge crit" style={{ margin: '0 1.2rem', padding: '0.4rem 0.7rem' }}>{err}</div>}
        <div className="modal-foot"><button type="button" className="btn" onClick={onClose}>{tr("Annuler")}</button><button type="submit" className="btn primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button></div>
      </form>
    </div>
  );
}
