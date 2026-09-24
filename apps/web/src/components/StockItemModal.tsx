'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export interface StockUnit { id?: string; name: string; factor: number }
export interface StockSupplierLink {
  id: string; contactId: string; supplierRef: string | null; unitName: string | null; price: number | null;
  preferred: boolean; note: string | null; contact: { id: string; name: string };
}
export interface StockItemFull {
  id: string; ref: string | null; name: string; brand: string | null; model: string | null; note: string | null; unit: string;
  category: string | null; minQty: number | null; qty: number; avgCost: number | null; value: number; low: boolean; active: boolean;
  units: StockUnit[]; suppliers: StockSupplierLink[];
  barcodes: { id: string; code: string; unitName: string | null; note: string | null }[];
}

export const COMMON_UNITS = ['kg', 'u', 'm²', 'm³', 'ml', 'm', 'L', 'sac', 'pcs', 'h', 'lot'];

/** Création / modification d'un article : identité, unité de base, unités alternatives (sac, pcs, palette…). */
export function StockItemModal({ item, onClose, onSaved }: { item?: StockItemFull; onClose: () => void; onSaved: (it: StockItemFull) => void }) {
  const [v, setV] = useState({
    name: item?.name ?? '', ref: item?.ref ?? '', brand: item?.brand ?? '', model: item?.model ?? '', category: item?.category ?? '',
    unit: item?.unit ?? '', minQty: item?.minQty != null ? String(item.minQty) : '', note: item?.note ?? '',
  });
  const [units, setUnits] = useState<{ name: string; factor: string }[]>(
    (item?.units ?? []).map((u) => ({ name: u.name, factor: String(u.factor) })),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  const set = (k: keyof typeof v, val: string) => setV((p) => ({ ...p, [k]: val }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const body = {
        name: v.name, unit: v.unit, brand: v.brand || null, model: v.model || null, category: v.category || null, note: v.note || null,
        minQty: v.minQty === '' ? null : Number(v.minQty),
        ...(v.ref.trim() ? { ref: v.ref.trim() } : {}),
        units: units.filter((u) => u.name.trim()).map((u) => ({ name: u.name.trim(), factor: Number(String(u.factor).replace(',', '.')) })),
      };
      const r = await api<{ item: StockItemFull }>(item ? `/api/stock/items/${item.id}` : '/api/stock/items', { method: item ? 'PATCH' : 'POST', body });
      onSaved(r.item);
      onClose();
    } catch (e2) {
      setErr((e2 as Error).message ?? 'Erreur');
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <h2>{item ? `Modifier ${item.name}` : 'Nouvel article'}</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="modal-body">
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="si-name">Nom complet * <span className="muted" style={{ fontWeight: 400 }}>— comme sur les factures</span></label>
            <input id="si-name" className="input" required value={v.name} onChange={(e) => set('name', e.target.value)} placeholder="KNAUF MP75 25KG" />
          </div>
          <div className="field">
            <label htmlFor="si-brand">Marque</label>
            <input id="si-brand" className="input" value={v.brand} onChange={(e) => set('brand', e.target.value)} placeholder="Knauf" />
          </div>
          <div className="field">
            <label htmlFor="si-model">Réf. fabricant</label>
            <input id="si-model" className="input" value={v.model} onChange={(e) => set('model', e.target.value)} placeholder="MP75" />
          </div>
          <div className="field">
            <label htmlFor="si-ref">Référence interne</label>
            <input id="si-ref" className="input" value={v.ref} onChange={(e) => set('ref', e.target.value)} placeholder={item ? '' : 'automatique (ART-0001…)'} />
          </div>
          <div className="field">
            <label htmlFor="si-unit">Unité de stock (de base) *</label>
            <input id="si-unit" className="input" required list="si-units" value={v.unit} onChange={(e) => set('unit', e.target.value)} placeholder="kg, m², u, L…" />
            <datalist id="si-units">{COMMON_UNITS.map((u) => <option key={u} value={u} />)}</datalist>
          </div>
          <div className="field">
            <label htmlFor="si-min">Seuil d’alerte (en {v.unit || 'unité de base'})</label>
            <input id="si-min" className="input" type="number" step="any" value={v.minQty} onChange={(e) => set('minQty', e.target.value)} />
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="si-cat">Catégorie</label>
            <input id="si-cat" className="input" value={v.category} onChange={(e) => set('category', e.target.value)} placeholder="Plâtrerie, Peinture…" />
          </div>

          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Autres unités (achat, comptage) <span className="muted" style={{ fontWeight: 400 }}>— ex. 1 sac = 25 {v.unit || 'kg'}</span></label>
            {units.map((u, i) => (
              <div key={i} className="row" style={{ gap: '0.5rem', marginBottom: '0.4rem', flexWrap: 'nowrap' }}>
                <input className="input" style={{ flex: 1 }} list="si-units" placeholder="sac, pcs, palette…" value={u.name} onChange={(e) => setUnits(units.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <span className="muted" style={{ whiteSpace: 'nowrap' }}>1 = </span>
                <input className="input" style={{ width: 110 }} type="number" step="any" min="0" placeholder="25" value={u.factor} onChange={(e) => setUnits(units.map((x, j) => (j === i ? { ...x, factor: e.target.value } : x)))} />
                <span className="muted" style={{ whiteSpace: 'nowrap' }}>{v.unit || 'base'}</span>
                <button type="button" className="btn ghost" aria-label="Retirer l’unité" onClick={() => setUnits(units.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setUnits([...units, { name: '', factor: '' }])}>+ Ajouter une unité</button>
          </div>

          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="si-note">Note</label>
            <textarea id="si-note" className="input" rows={2} value={v.note} onChange={(e) => set('note', e.target.value)} />
          </div>
        </div>
        {err && <div className="badge crit" style={{ margin: '0 1.15rem', padding: '0.4rem 0.7rem' }}>{err}</div>}
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
        </div>
      </form>
    </div>
  );
}
