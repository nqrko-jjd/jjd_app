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
  const [tab, setTab] = useState<'company' | 'library'>('company');
  return (
    <>
      <PageHead title="Paramètres" sub="Coordonnées société & bibliothèque de prix" />
      <div className="row" style={{ marginBottom: '1rem', gap: '0.4rem' }}>
        <button className={`btn${tab === 'company' ? ' primary' : ''}`} onClick={() => setTab('company')}>Société</button>
        <button className={`btn${tab === 'library' ? ' primary' : ''}`} onClick={() => setTab('library')}>Bibliothèque de prix</button>
      </div>
      {tab === 'company' ? <CompanyForm canEdit={user?.role === 'admin'} /> : <PriceLibrary />}
    </>
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
