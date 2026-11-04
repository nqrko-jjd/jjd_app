'use client';
import { tr } from '@/lib/ui-language';
import { SkeletonRows, ErrorState, EmptyState } from '@/components/States';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DocScanner, type ScannedDoc } from '@/components/DocScanner';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api, apiBlobUrl, apiUpload } from '@/lib/api';
import { FileDrop } from '@/components/FileDrop';
import { Truck, ReceiptText } from 'lucide-react';
import { PageHead, Money, formatDateBE, formatEur, Thumb } from '@/lib/ui';

interface Fine {
  id: string; date: string | null; time: string | null; reference: string | null; payTo: string | null; street: string | null; postalCode: string | null;
  type: string | null; amount: number | null; status: string | null; paidOn: string | null; plateRaw: string | null; note: string | null;
  dueOn: string | null; reminder1On: string | null; reminder2On: string | null; driverPersonId: string | null; driverName: string | null; hasPdf: boolean;
  planned: { drivers: string[]; team: string[] };
  vehicle: { id: string; brand: string | null; model: string | null; plate: string | null; photoThumbUrl: string | null } | null;
}
interface VehicleOpt { id: string; brand: string | null; model: string | null; plate: string | null; name: string | null }
const TYPES = ['Stationnement', 'Excès de vitesse', 'Feu rouge', 'Zone basse émission (LEZ)', 'Téléphone au volant', 'Taxe de circulation', 'Autre'];
const dayInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
const vLabel = (v: { brand: string | null; model: string | null; plate: string | null; name?: string | null }) => [v.name ?? [v.brand, v.model].filter(Boolean).join(' '), v.plate].filter(Boolean).join(' · ') || 'Véhicule';
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Brussels' }).format(new Date());
const late = (f: Fine) => f.status !== 'Payé' && [f.dueOn, f.reminder1On, f.reminder2On].some((d) => d && d.slice(0, 10) < today());

type ColKey = 'date' | 'vehicle' | 'type' | 'payTo' | 'ref' | 'driver' | 'amount' | 'dueOn' | 'status';
const COLS: { key: ColKey; label: string; right?: boolean }[] = [
  { key: 'date', label: 'Date' }, { key: 'vehicle', label: 'Véhicule' }, { key: 'type', label: 'Type' }, { key: 'payTo', label: 'À payer à' }, { key: 'ref', label: 'Réf' },
  { key: 'driver', label: 'Conducteur' }, { key: 'amount', label: 'Montant', right: true }, { key: 'dueOn', label: 'Échéance' }, { key: 'status', label: 'Statut' },
];
/** Texte de chaque colonne : sert au filtre (« contient »). */
const CELL: Record<ColKey, (f: Fine) => string> = {
  date: (f) => `${formatDateBE(f.date)} ${f.time ?? ''}`,
  vehicle: (f) => (f.vehicle ? vLabel(f.vehicle) : (f.plateRaw ?? '')),
  type: (f) => [f.type, f.street, f.postalCode].filter(Boolean).join(' '),
  payTo: (f) => f.payTo ?? '',
  ref: (f) => f.reference ?? '',
  driver: (f) => f.driverName ?? f.planned.drivers.join(', '),
  amount: (f) => (f.amount != null ? String(f.amount).replace('.', ',') : ''),
  dueOn: (f) => formatDateBE(f.dueOn),
  status: (f) => `${f.status === 'Payé' ? 'payé' : 'impayé'}${late(f) ? ' en retard' : ''}`,
};
/** Valeur de tri de chaque colonne (dates en ISO, montant en nombre). */
const SORT: Record<ColKey, (f: Fine) => string | number> = {
  date: (f) => `${f.date?.slice(0, 10) ?? ''} ${f.time ?? ''}`,
  vehicle: (f) => CELL.vehicle(f), type: (f) => CELL.type(f), payTo: (f) => CELL.payTo(f), ref: (f) => CELL.ref(f), driver: (f) => CELL.driver(f),
  amount: (f) => f.amount ?? -1, dueOn: (f) => f.dueOn?.slice(0, 10) ?? '', status: (f) => CELL.status(f),
};
const refKey = (r: string | null) => (r ?? '').toUpperCase().replace(/[\s/\-.]/g, '');
const plateKey = (f: Fine) => (f.vehicle?.plate ?? f.plateRaw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
/** PV en double : même référence (« PPBXL/26… » = « PPBXL-26… »), ou même plaque + même date + même heure. Renvoie id → raison. */
function findDuplicates(list: Fine[]): Map<string, string> {
  const out = new Map<string, string>();
  const groups = (keyOf: (f: Fine) => string, why: string) => {
    const m = new Map<string, Fine[]>();
    for (const f of list) { const k = keyOf(f); if (k) m.set(k, [...(m.get(k) ?? []), f]); }
    for (const g of m.values()) if (g.length > 1) for (const f of g) out.set(f.id, out.get(f.id) ?? why);
  };
  groups((f) => (refKey(f.reference).length >= 6 ? refKey(f.reference) : ''), 'Même référence qu’un autre PV');
  groups((f) => (plateKey(f) && f.date ? `${plateKey(f)}|${f.date.slice(0, 10)}|${f.time ?? ''}` : ''), 'Même plaque, même date et même heure qu’un autre PV');
  return out;
}

/** PV / amendes de la flotte : ajouter, modifier, marquer payé, joindre le scan, retrouver qui conduisait (planning), supprimer. */
export default function PvPage() {
  const [q, setQ] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const qs = useMemo(() => new URLSearchParams({ ...(q.trim() ? { q: q.trim() } : {}), ...(vehicleId ? { vehicleId } : {}) }).toString(), [q, vehicleId]);
  const { data, loading, error, reload } = useApi<{ items: Fine[] }>(`/api/vehicles/fines${qs ? `?${qs}` : ''}`);
  const { data: vehData } = useApi<{ items: VehicleOpt[] }>('/api/vehicles');
  const { data: pick } = useApi<{ people: { id: string; name: string }[] }>('/api/meta/pickers');
  const [edit, setEdit] = useState<Fine | 'new' | null>(null);
  const [dropped, setDropped] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [scanning, setScanning] = useState(false);

  const rawItems = data?.items ?? [];
  // clés des PV déjà connus (+ ceux créés pendant le scan) : un PV scanné deux fois n'est créé qu'une fois
  const knownKeys = useRef(new Set<string>());
  useEffect(() => { for (const f of rawItems) { if (refKey(f.reference).length >= 6) knownKeys.current.add(refKey(f.reference)); if (plateKey(f) && f.date) knownKeys.current.add(`${plateKey(f)}|${f.date.slice(0, 10)}|${f.time ?? ''}`); } }, [rawItems]);

  /** Un document scanné → lecture par l'IA → un PV créé (conducteur à choisir ensuite) avec le scan en pièce jointe. */
  async function scanOne(doc: ScannedDoc): Promise<string> {
    const fd = new FormData();
    fd.append('file', doc.pdf);
    const r = await apiUpload<{ found: { plate: string | null; date: string | null; time: string | null; reference: string | null; payTo: string | null; street: string | null; postalCode: string | null; type: string | null; amount: number | null; dueOn: string | null; note: string | null } | null; vehicleId: string | null }>('/api/vehicles/fines/extract', fd);
    const x = r.found;
    const rk = refKey(x?.reference ?? null);
    const pk = x?.plate && x.date ? `${(x.plate).toUpperCase().replace(/[^A-Z0-9]/g, '')}|${x.date}|${x.time ?? ''}` : '';
    if ((rk.length >= 6 && knownKeys.current.has(rk)) || (pk && knownKeys.current.has(pk))) return `Doublon ignoré : ${x?.reference ?? x?.plate} existe déjà`;
    const created = await api<{ fine: { id: string } }>('/api/vehicles/fines', {
      method: 'POST',
      body: {
        vehicleId: r.vehicleId, plateRaw: x?.plate ?? null, date: x?.date ?? null, time: x?.time ?? null, reference: x?.reference ?? null, payTo: x?.payTo ?? null, street: x?.street ?? null,
        postalCode: x?.postalCode ?? null, type: x?.type ?? null, amount: x?.amount ?? null, dueOn: x?.dueOn ?? null,
        note: x ? (x.note ?? null) : 'Scan non lu automatiquement — à compléter',
      },
    });
    const up = new FormData();
    up.append('file', doc.pdf);
    await apiUpload(`/api/vehicles/fines/${created.fine.id}/file`, up);
    if (rk.length >= 6) knownKeys.current.add(rk);
    if (pk) knownKeys.current.add(pk);
    reload();
    return x ? `PV créé : ${x.reference ?? 'sans référence'} · ${x.plate ?? 'plaque ?'}${x.date ? ` · ${x.date}` : ''}` : 'PV créé, mais illisible : à compléter à la main';
  }
  const [sort, setSort] = useState<{ key: ColKey; dir: 1 | -1 } | null>(null);
  const [cols, setCols] = useState<Partial<Record<ColKey, string>>>({});
  const [dupOnly, setDupOnly] = useState(false);
  const dups = useMemo(() => findDuplicates(rawItems), [rawItems]);
  const items = useMemo(() => {
    const active = (Object.entries(cols) as [ColKey, string][]).filter(([, t]) => t.trim());
    let list = rawItems.filter((f) => (!dupOnly || dups.has(f.id)) && active.every(([k, t]) => CELL[k](f).toLowerCase().includes(t.trim().toLowerCase())));
    if (sort) {
      const { key, dir } = sort;
      list = [...list].sort((a, b) => {
        const x = SORT[key](a), y = SORT[key](b);
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'fr', { numeric: true })) * dir;
      });
    }
    return list;
  }, [rawItems, cols, sort, dupOnly, dups]);
  const total = items.reduce((s, f) => s + (f.amount ?? 0), 0);
  const dueNow = items.filter(late).length;
  const filtered = dupOnly || Object.values(cols).some((t) => t?.trim());

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
        sub={data ? `${items.length} PV · ${formatEur(total)}${dueNow ? ` · ${dueNow} PV en retard` : ''}` : undefined}
        action={<div className="row"><Link href="/app/flotte" className="btn">← Flotte</Link><button className="btn" onClick={() => setScanning(true)}>📷 Scanner des PV</button><button className="btn primary" onClick={() => setEdit('new')}>+ Nouveau PV</button></div>}
      />
      {scanning && <DocScanner title="Scanner des PV" singleDefault={false} handle={scanOne} onClose={() => { setScanning(false); reload(); }} />}
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) { setDropped(f); setEdit('new'); } }}
        style={{ border: `2px dashed ${over ? 'var(--accent, #1f5f46)' : 'var(--line, #cfd8d3)'}`, borderRadius: 12, padding: '0.9rem 1rem', marginBottom: '1rem', textAlign: 'center', fontSize: '0.9rem', background: over ? 'rgba(31,95,70,0.06)' : 'transparent' }}
      >
        Glisse ici le PDF (ou la photo) d’un nouveau PV : il est lu automatiquement et le formulaire se pré-remplit.
      </div>
      {msg && <div className={`badge ${msg.ok ? 'ok' : 'crit'}`} style={{ marginBottom: '1rem', padding: '0.5rem 0.8rem' }}>{msg.text}</div>}
      <div className="row" style={{ marginBottom: '1rem', gap: '0.8rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <label className="row" style={{ gap: '0.4rem' }} title="Même référence, ou même plaque + date + heure."><input type="checkbox" checked={dupOnly} onChange={(e) => setDupOnly(e.target.checked)} /> Doublons uniquement ({dups.size})</label>
        {filtered && <button className="btn ghost" onClick={() => { setCols({}); setDupOnly(false); }}>Effacer les filtres</button>}
        <input className="input" style={{ maxWidth: 240 }} placeholder="Référence, plaque, lieu, type…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" style={{ width: 'auto', maxWidth: 260 }} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} aria-label="Véhicule">
          <option value="">Tous les véhicules</option>
          {(vehData?.items ?? []).map((v) => <option key={v.id} value={v.id}>{vLabel(v)}</option>)}
        </select>
      </div>
      {loading && !data && <SkeletonRows />}
      {error && !loading && <ErrorState message={error} onRetry={reload} />}
      {data && items.length === 0 && filtered && rawItems.length > 0 && <EmptyState icon={ReceiptText} title="Aucun PV" text="Aucun PV ne correspond aux filtres." action={<button className="btn" onClick={() => { setCols({}); setDupOnly(false); }}>Effacer les filtres</button>} />}
      {data && items.length === 0 && !(filtered && rawItems.length > 0) && <EmptyState icon={ReceiptText} title="Aucun PV" text="Aucun PV pour l’instant : ajoutez-en un ou glissez un PDF ci-dessus." action={<button className="btn primary" onClick={() => setEdit('new')}>+ Nouveau PV</button>} />}
      {data && rawItems.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                {COLS.map((c) => (
                  <th key={c.key} style={{ textAlign: c.right ? 'right' : undefined }} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className="btn ghost" style={{ padding: 0, font: 'inherit', fontWeight: 'inherit' }} onClick={() => setSort((s) => (s?.key === c.key ? (s.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 }))}>
                      {tr(c.label)}{sort?.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                    </button>
                  </th>
                ))}
                <th />
              </tr>
              <tr>
                {COLS.map((c) => (
                  <th key={c.key} style={{ fontWeight: 'normal' }}>
                    <input className="input" style={{ width: '100%', minWidth: 60, padding: '0.2rem 0.4rem', fontSize: '0.78rem', textAlign: c.right ? 'right' : undefined }} placeholder="Filtrer" aria-label={`Filtrer : ${c.label}`}
                      value={cols[c.key] ?? ''} onChange={(e) => setCols((s) => ({ ...s, [c.key]: e.target.value }))} />
                  </th>
                ))}
                <th />
              </tr>
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
                  <td className="mono" style={{ fontSize: '0.78rem' }}>{f.reference ?? '—'}{dups.has(f.id) && <span className="badge warn" style={{ marginLeft: 4 }} title={dups.get(f.id)}>doublon ?</span>}</td>
                  <td>{f.driverName ?? (f.planned.drivers.length ? <span className="muted" title="D’après le planning ce jour-là">{f.planned.drivers.join(', ')} ?</span> : '—')}</td>
                  <td style={{ textAlign: 'right' }}><Money value={f.amount} /></td>
                  <td className="tnum">{formatDateBE(f.dueOn)}</td>
                  <td>
                    {f.status === 'Payé' ? <span className="badge ok" title={f.paidOn ? `Payé le ${formatDateBE(f.paidOn)}` : undefined}>{tr("Payé")}</span> : <span className="badge crit">{tr("Impayé")}</span>}
                    {late(f) && <span className="badge warn" style={{ marginLeft: 4 }} title="Échéance ou rappel dépassé">en retard</span>}
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
      {edit && <FineModal key={dropped?.name ?? 'm'} fine={edit === 'new' ? null : edit} initialFile={edit === 'new' ? dropped : null} vehicles={vehData?.items ?? []} people={pick?.people ?? []} onClose={() => { setEdit(null); setDropped(null); }} onSaved={(text) => { setEdit(null); setDropped(null); setMsg({ ok: true, text }); reload(); }} />}
    </>
  );
}

function FineModal({ fine, initialFile, vehicles, people, onClose, onSaved }: { fine: Fine | null; initialFile?: File | null; vehicles: VehicleOpt[]; people: { id: string; name: string }[]; onClose: () => void; onSaved: (text: string) => void }) {
  const [v, setV] = useState({
    vehicleId: fine?.vehicle?.id ?? '', plateRaw: fine?.plateRaw ?? '', date: dayInput(fine?.date ?? null), time: fine?.time ?? '', reference: fine?.reference ?? '', payTo: fine?.payTo ?? '',
    street: fine?.street ?? '', postalCode: fine?.postalCode ?? '', type: fine?.type ?? '', amount: fine?.amount != null ? String(fine.amount) : '', dueOn: dayInput(fine?.dueOn ?? null), reminder1On: dayInput(fine?.reminder1On ?? null),
    reminder2On: dayInput(fine?.reminder2On ?? null), paid: fine?.status === 'Payé', paidOn: dayInput(fine?.paidOn ?? null), driverPersonId: fine?.driverPersonId ?? '', note: fine?.note ?? '',
  });
  const [file, setFile] = useState<File | null>(initialFile ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const set = (k: keyof typeof v, val: string | boolean) => setV((s) => ({ ...s, [k]: val }));

  /** Nouveau PV : lit le fichier déposé et remplit les champs encore vides (rien n'est écrasé). */
  async function readFile(f: File | null) {
    setFile(f);
    if (!f || fine) return;
    setReading('Lecture du PV en cours…');
    try {
      const fd = new FormData();
      fd.append('file', f);
      const r = await apiUpload<{ found: { plate: string | null; date: string | null; time: string | null; reference: string | null; payTo: string | null; street: string | null; postalCode: string | null; type: string | null; amount: number | null; dueOn: string | null; note: string | null } | null; vehicleId: string | null }>('/api/vehicles/fines/extract', fd);
      if (!r.found) { setReading('Lecture automatique impossible : remplis les champs à la main.'); return; }
      const x = r.found;
      setV((s) => ({
        ...s,
        vehicleId: s.vehicleId || r.vehicleId || '', plateRaw: s.plateRaw || x.plate || '', date: s.date || x.date || '', time: s.time || x.time || '',
        reference: s.reference || x.reference || '', payTo: s.payTo || x.payTo || '', street: s.street || x.street || '', postalCode: s.postalCode || x.postalCode || '',
        type: s.type || x.type || '', amount: s.amount || (x.amount != null ? String(x.amount) : ''), dueOn: s.dueOn || x.dueOn || '', note: s.note || x.note || '',
      }));
      setReading('PV lu : vérifie les champs, choisis le conducteur, puis enregistre.');
    } catch (e) { setReading(`Lecture automatique impossible (${(e as Error).message}). Remplis les champs à la main.`); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (initialFile) void readFile(initialFile); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const body = {
        vehicleId: v.vehicleId || null, plateRaw: v.plateRaw || null, date: v.date || null, time: v.time || null, reference: v.reference || null, payTo: v.payTo || null,
        street: v.street || null, postalCode: v.postalCode || null, type: v.type || null, amount: v.amount === '' ? null : Number(v.amount.replace(',', '.')),
        dueOn: v.dueOn || null, reminder1On: v.reminder1On || null, reminder2On: v.reminder2On || null, status: v.paid ? 'Payé' : null, paidOn: v.paid && v.paidOn ? v.paidOn : null, driverPersonId: v.driverPersonId || null, note: v.note || null,
      };
      const r = fine ? await api<{ fine: { id: string } }>(`/api/vehicles/fines/${fine.id}`, { method: 'PATCH', body }) : await api<{ fine: { id: string } }>('/api/vehicles/fines', { method: 'POST', body });
      if (file) { const fd = new FormData(); fd.append('file', file); await apiUpload(`/api/vehicles/fines/${r.fine.id}/file`, fd); }
      onSaved(fine ? 'PV modifié.' : 'PV ajouté.');
    } catch (e2) {
      // « Données invalides » seul ne dit pas quel champ pose problème : on le nomme
      const issues = ((e2 as { body?: { issues?: { path?: (string | number)[]; message?: string }[] } }).body?.issues ?? []);
      const labels: Record<string, string> = { vehicleId: 'Véhicule', plateRaw: 'Plaque', date: 'Date', time: 'Heure (hh:mm)', reference: 'Référence', payTo: 'À payer à', street: 'Lieu', postalCode: 'Code postal', type: 'Type', amount: 'Montant', dueOn: 'Échéance de paiement', reminder1On: '1er rappel', reminder2On: '2e rappel', paidOn: 'Date de paiement', driverPersonId: 'Conducteur', note: 'Note' };
      setErr(issues.length ? issues.map((i) => `${labels[String(i.path?.[0])] ?? String(i.path?.[0] ?? 'Champ')} : ${i.message ?? 'valeur invalide'}`).join(' · ') : (e2 as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim">
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
          <div className="field"><label>Code postal / commune</label><input className="input" value={v.postalCode} onChange={(e) => set('postalCode', e.target.value)} /></div>
          <div className="field"><label>À payer à</label><input className="input" value={v.payTo} onChange={(e) => set('payTo', e.target.value)} placeholder="Ville, police, SPF…" /></div>
          <div className="field"><label>Référence / communication</label><input className="input" value={v.reference} onChange={(e) => set('reference', e.target.value)} /></div>
          <div className="field"><label htmlFor="pv-due-on">Échéance de paiement</label><input id="pv-due-on" className="input" type="date" value={v.dueOn} onChange={(e) => set('dueOn', e.target.value)} /></div>
          <div className="field"><label>1er rappel</label><input className="input" type="date" value={v.reminder1On} onChange={(e) => set('reminder1On', e.target.value)} /></div>
          <div className="field"><label>2e rappel</label><input className="input" type="date" value={v.reminder2On} onChange={(e) => set('reminder2On', e.target.value)} /></div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Conducteur</label>
            <select className="select" value={v.driverPersonId} onChange={(e) => set('driverPersonId', e.target.value)}>
              <option value="">— inconnu —</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {v.driverPersonId && Number(String(v.amount).replace(',', '.')) > 0 && (
              <span className="muted" style={{ fontSize: '0.82rem' }}>Ce PV sera ajouté aux dettes de cette personne (« À retenir » dans le décompte du mois) jusqu’à ce que vous le passiez en « Réglé » sur sa fiche.</span>
            )}
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
            <FileDrop file={file} onFile={(f) => void readFile(f)} disabled={busy} />
            {reading && <span className="muted" style={{ fontSize: '0.82rem' }}>{reading}</span>}
          </div>
        </div>
        {err && <div className="badge crit" style={{ margin: '0 1.2rem', padding: '0.4rem 0.7rem' }}>{err}</div>}
        <div className="modal-foot"><button type="button" className="btn" onClick={onClose}>{tr("Annuler")}</button><button type="submit" className="btn primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button></div>
      </form>
    </div>
  );
}
