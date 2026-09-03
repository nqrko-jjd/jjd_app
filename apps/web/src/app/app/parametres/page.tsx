'use client';
import { useEffect, useState } from 'react';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHead, Money } from '@/lib/ui';
import type { Company } from '@/lib/doc-ui';
import { VAT_RATES } from '@jjd/shared';

interface PriceItem {
  id: string; ref: string | null; label: string; description: string | null;
  unit: string | null; unitPriceHt: number; vatRate: number; category: string | null;
}

export default function ParametresPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'company' | 'library' | 'pointage' | 'depot'>('company');
  const admin = user?.role === 'admin';
  return (
    <>
      <PageHead title="Paramètres" sub="Société, bibliothèque de prix, dépôt, pointage" />
      <div className="row" style={{ marginBottom: '1rem', gap: '0.4rem' }}>
        <button className={`btn${tab === 'company' ? ' primary' : ''}`} onClick={() => setTab('company')}>Société</button>
        <button className={`btn${tab === 'depot' ? ' primary' : ''}`} onClick={() => setTab('depot')}>Dépôt</button>
        <button className={`btn${tab === 'library' ? ' primary' : ''}`} onClick={() => setTab('library')}>Bibliothèque de prix</button>
        <button className={`btn${tab === 'pointage' ? ' primary' : ''}`} onClick={() => setTab('pointage')}>Pointage</button>
      </div>
      {tab === 'company' ? <CompanyForm canEdit={admin} />
        : tab === 'depot' ? <DepotForm canEdit={admin} />
        : tab === 'library' ? <PriceLibrary />
        : <GeoForm canEdit={admin} />}
    </>
  );
}

interface Depot {
  label: string; address: string; postalCode: string; city: string;
  lat: number | null; lng: number | null; roadFactor: number; workDaysPerYear: number;
}

function DepotForm({ canEdit }: { canEdit: boolean }) {
  const { data } = useApi<{ depot: Depot }>('/api/settings/depot');
  const [f, setF] = useState<Depot | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setF(data.depot); }, [data]);
  if (!f) return <div className="empty">Chargement…</div>;

  const save = async () => {
    setBusy(true); setMsg(null);
    try { await api('/api/settings/depot', { method: 'PUT', body: f }); setMsg('Enregistré.'); }
    finally { setBusy(false); }
  };
  const geocode = async () => {
    setBusy(true); setMsg(null);
    try {
      await api('/api/settings/depot', { method: 'PUT', body: f }); // sauve l'adresse d'abord
      const r = await api<{ depot: Depot; matched: string }>('/api/settings/depot/geocode', { method: 'POST' });
      setF(r.depot);
      setMsg(`Point GPS fixé : ${r.matched}`);
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  };

  const upd = (k: keyof Depot, v: string | number) => { setF({ ...f, [k]: v }); setMsg(null); };

  return (
    <div className="card card-pad" style={{ maxWidth: 620 }}>
      <div className="section-title">Dépôt de l’entreprise</div>
      <p className="muted" style={{ fontSize: '0.88rem', marginTop: 0 }}>
        Point de départ des véhicules. Sert à estimer le <strong>coût véhicule</strong> de chaque chantier :
        chaque jour où un véhicule est planifié sur un chantier, on impute aux charges un aller-retour dépôt ↔ chantier
        (carburant + usure) <strong>et</strong> une quote-part des coûts fixes du véhicule (assurance, financement, taxe,
        parking…) = coût mensuel ÷ jours ouvrés par mois.
      </p>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <label className="field" style={{ gridColumn: '1 / -1' }}><span>Adresse</span>
          <input className="input" disabled={!canEdit} value={f.address} onChange={(e) => upd('address', e.target.value)} /></label>
        <label className="field"><span>Code postal</span>
          <input className="input" disabled={!canEdit} value={f.postalCode} onChange={(e) => upd('postalCode', e.target.value)} /></label>
        <label className="field"><span>Ville</span>
          <input className="input" disabled={!canEdit} value={f.city} onChange={(e) => upd('city', e.target.value)} /></label>
        <label className="field"><span>Facteur routier (vol d’oiseau → route)</span>
          <input className="input" type="number" step={0.05} min={1} max={2.5} disabled={!canEdit}
            value={f.roadFactor} onChange={(e) => upd('roadFactor', Number(e.target.value))} /></label>
        <label className="field"><span>Jours ouvrés / an</span>
          <input className="input" type="number" step={1} min={120} max={365} disabled={!canEdit}
            value={f.workDaysPerYear} onChange={(e) => upd('workDaysPerYear', Number(e.target.value))} /></label>
      </div>
      <p className="muted" style={{ fontSize: '0.84rem', marginTop: '0.6rem' }}>
        {f.lat != null && f.lng != null
          ? <>Point GPS : <a href={`https://www.google.com/maps?q=${f.lat},${f.lng}`} target="_blank" rel="noreferrer">{f.lat.toFixed(5)}, {f.lng.toFixed(5)}</a></>
          : 'Aucun point GPS — clique « Géolocaliser » après avoir renseigné l’adresse.'}
      </p>
      {canEdit && (
        <div className="row" style={{ marginTop: '0.9rem', gap: '0.5rem' }}>
          <button className="btn primary" disabled={busy} onClick={save}>Enregistrer</button>
          <button className="btn" disabled={busy || !f.address} onClick={geocode}>Géolocaliser l’adresse</button>
          {msg && <span className="muted">{msg}</span>}
        </div>
      )}
    </div>
  );
}

function GeoForm({ canEdit }: { canEdit: boolean }) {
  const { data } = useApi<{ radiusM: number }>('/api/settings/geo');
  const [m, setM] = useState<number | ''>('');
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (data) setM(data.radiusM); }, [data]);
  return (
    <div className="card card-pad" style={{ maxWidth: 560 }}>
      <div className="section-title">Contrôle du lieu de pointage</div>
      <p className="muted" style={{ fontSize: '0.88rem', marginTop: 0 }}>
        Quand un ouvrier démarre son compteur, l’app enregistre sa position. Le <strong>1<sup>er</sup> pointage</strong> sur
        un chantier fixe le point de référence. Les pointages suivants faits à plus du rayon ci-dessous sont
        <strong> acceptés mais signalés « hors zone »</strong> dans la file de validation (mode souple, jamais bloquant).
      </p>
      <label className="field" style={{ maxWidth: 200 }}>
        <span>Rayon toléré (mètres)</span>
        <input className="input" type="number" min={50} max={5000} step={50} disabled={!canEdit}
          value={m} onChange={(e) => { setM(e.target.value === '' ? '' : Number(e.target.value)); setSaved(false); }} />
      </label>
      {canEdit && (
        <div className="row" style={{ marginTop: '0.9rem' }}>
          <button className="btn primary" onClick={async () => { await api('/api/settings/geo', { method: 'PUT', body: { radiusM: m } }); setSaved(true); }}>Enregistrer</button>
          {saved && <span className="muted">Enregistré.</span>}
        </div>
      )}
      <p className="hint" style={{ marginTop: '0.9rem' }}>
        Le point GPS d’un chantier se corrige sur sa fiche (section « Localisation »).
      </p>
    </div>
  );
}

const FIELDS: { name: keyof Company; label: string; full?: boolean; area?: boolean }[] = [
  { name: 'name', label: 'Raison sociale' },
  { name: 'vat', label: 'N° TVA' },
  { name: 'address', label: 'Adresse', full: true },
  { name: 'postalCode', label: 'Code postal' },
  { name: 'city', label: 'Ville' },
  { name: 'iban', label: 'IBAN' },
  { name: 'phone', label: 'Téléphone' },
  { name: 'email', label: 'E-mail' },
  { name: 'website', label: 'Site web' },
  { name: 'quoteTerms', label: 'Conditions — devis', full: true, area: true },
  { name: 'invoiceTerms', label: 'Conditions — factures', full: true, area: true },
];

function CompanyForm({ canEdit }: { canEdit: boolean }) {
  const { data } = useApi<{ company: Company }>('/api/settings/company');
  const [form, setForm] = useState<Company | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (data) setForm(data.company); }, [data]);
  if (!form) return <div className="empty">Chargement…</div>;

  return (
    <div className="card card-pad" style={{ maxWidth: 720 }}>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        {FIELDS.map((f) => (
          <label key={f.name} className="field" style={f.full ? { gridColumn: '1 / -1' } : undefined}>
            <span>{f.label}</span>
            {f.area ? (
              <textarea className="input" rows={2} disabled={!canEdit} value={form[f.name]} onChange={(e) => { setForm({ ...form, [f.name]: e.target.value }); setSaved(false); }} />
            ) : (
              <input className="input" disabled={!canEdit} value={form[f.name]} onChange={(e) => { setForm({ ...form, [f.name]: e.target.value }); setSaved(false); }} />
            )}
          </label>
        ))}
      </div>
      {canEdit ? (
        <div className="row" style={{ marginTop: '1rem' }}>
          <button className="btn primary" onClick={async () => { await api('/api/settings/company', { method: 'PUT', body: form }); setSaved(true); }}>Enregistrer</button>
          {saved && <span className="muted">Enregistré — utilisé sur les PDF de devis et factures.</span>}
        </div>
      ) : (
        <p className="hint" style={{ marginTop: '1rem' }}>Seul un administrateur peut modifier ces informations.</p>
      )}
    </div>
  );
}

function PriceLibrary() {
  const [q, setQ] = useState('');
  const { data, reload } = useApi<{ items: PriceItem[]; categories: string[] }>(`/api/price-items?${q ? `q=${encodeURIComponent(q)}` : ''}`);
  const [draft, setDraft] = useState<Partial<PriceItem>>({ vatRate: 0.21 });

  async function add() {
    if (!draft.label) return;
    await api('/api/price-items', { method: 'POST', body: { ...draft, unitPriceHt: Number(draft.unitPriceHt) || 0 } });
    setDraft({ vatRate: 0.21 });
    reload();
  }

  return (
    <>
      <div className="card card-pad" style={{ marginBottom: '1rem' }}>
        <div className="section-title">Ajouter un ouvrage</div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
          <label className="field"><span>Libellé</span><input className="input" value={draft.label ?? ''} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></label>
          <label className="field"><span>Catégorie</span><input className="input" value={draft.category ?? ''} onChange={(e) => setDraft({ ...draft, category: e.target.value })} /></label>
          <label className="field"><span>Unité</span><input className="input" value={draft.unit ?? ''} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} /></label>
          <label className="field"><span>P.U. HT</span><input className="input" type="number" value={draft.unitPriceHt ?? ''} onChange={(e) => setDraft({ ...draft, unitPriceHt: Number(e.target.value) })} /></label>
          <label className="field"><span>TVA</span>
            <select className="select" value={draft.vatRate} onChange={(e) => setDraft({ ...draft, vatRate: Number(e.target.value) })}>
              {VAT_RATES.map((r) => <option key={r} value={r}>{Math.round(r * 100)}%</option>)}
            </select>
          </label>
          <div className="field"><span>&nbsp;</span><button className="btn primary" onClick={add}>Ajouter</button></div>
        </div>
      </div>

      <input className="input" style={{ maxWidth: 260, marginBottom: '1rem' }} placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} />
      {!data ? <div className="empty">Chargement…</div> : data.items.length === 0 ? (
        <div className="empty">Bibliothèque vide.</div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Catégorie</th><th>Libellé</th><th>Unité</th><th style={{ textAlign: 'right' }}>P.U. HT</th><th>TVA</th><th></th></tr></thead>
            <tbody>
              {data.items.map((it) => (
                <tr key={it.id}>
                  <td>{it.category ?? '—'}</td>
                  <td>{it.label}</td>
                  <td>{it.unit ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}><Money value={it.unitPriceHt} /></td>
                  <td>{Math.round(it.vatRate * 100)}%</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn ghost" style={{ padding: '0.15rem 0.4rem', fontSize: '0.75rem' }} onClick={async () => { await api(`/api/price-items/${it.id}`, { method: 'DELETE' }); reload(); }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
