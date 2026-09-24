'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, apiUpload } from '@/lib/api';
import { ContactPicker } from './ContactPicker';
import { formatEur } from '@/lib/ui';

export interface StockUnit { id?: string; name: string; factor: number }
export interface StockSupplierLink {
  id: string; contactId: string; supplierRef: string | null; unitName: string | null; price: number | null;
  preferred: boolean; note: string | null; contact: { id: string; name: string };
}
export interface StockItemFull {
  id: string; ref: string | null; name: string; brand: string | null; model: string | null; note: string | null; unit: string;
  category: string | null; minQty: number | null; qty: number; avgCost: number | null; value: number; low: boolean; active: boolean;
  photoUrl: string | null; photoThumbUrl: string | null;
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
  const [photo, setPhoto] = useState<File | null>(null);
  const photoPreview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  // « 1 palette = 45 sac » : `per` = unité de référence (vide = unité de base), le facteur final est calculé à l'envoi
  const [units, setUnits] = useState<{ name: string; qty: string; per: string | null }[]>(
    (item?.units ?? []).map((u) => ({ name: u.name, qty: String(u.factor), per: '' })),
  );
  const [suppliers, setSuppliers] = useState<{ contactId: string; supplierRef: string; unitName: string; price: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  const set = (k: keyof typeof v, val: string) => setV((p) => ({ ...p, [k]: val }));
  const num = (x: string) => Number(String(x).replace(',', '.'));

  /** Unité de référence d'une ligne : celle choisie, sinon (auto) la ligne précédente — « 1 palette = 42 sac » — ou l'unité de base pour la 1re. */
  const perOf = (u: { per: string | null }, i: number) => (u.per ?? (i > 0 ? units[i - 1]!.name.trim() : ''));

  /** Facteur vers l'unité de base de chaque ligne d'unité (1 palette = 45 sacs = 1125 kg). */
  function factorsByName(): Map<string, number> {
    const m = new Map<string, number>();
    units.forEach((u, i) => {
      const name = u.name.trim();
      if (!name) return;
      const per = perOf(u, i);
      const ref = per ? m.get(per.toLowerCase()) ?? 1 : 1;
      m.set(name.toLowerCase(), num(u.qty) * ref);
    });
    return m;
  }
  const factors = factorsByName();
  const factorOfUnit = (name: string) => (name ? factors.get(name.trim().toLowerCase()) ?? 1 : 1);
  const unitNames = units.map((u) => u.name.trim()).filter(Boolean);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const base = v.unit.trim().toLowerCase();
    const seen = new Set<string>();
    for (const [i, u] of units.entries()) {
      const n = u.name.trim().toLowerCase();
      if (!n) continue;
      if (n === base) { setErr(`« ${u.name.trim()} » est déjà l’unité de stock : choisissez plutôt le sac (ou la palette) comme conditionnement, et l’unité de stock en kg.`); return; }
      if (perOf(u, i).toLowerCase() === n) { setErr(`« ${u.name.trim()} » ne peut pas être défini par lui-même.`); return; }
      if (seen.has(n)) { setErr(`Le conditionnement « ${u.name.trim()} » est en double.`); return; }
      if (!(num(u.qty) > 0)) { setErr(`Indiquez combien contient 1 ${u.name.trim()}.`); return; }
      seen.add(n);
    }
    setBusy(true);
    try {
      const body = {
        name: v.name, unit: v.unit, brand: v.brand || null, model: v.model || null, category: v.category || null, note: v.note || null,
        minQty: v.minQty === '' ? null : Number(v.minQty),
        ...(v.ref.trim() ? { ref: v.ref.trim() } : {}),
        units: units.filter((u) => u.name.trim()).map((u) => ({ name: u.name.trim(), factor: factorOfUnit(u.name) })),
        ...(item ? {} : {
          suppliers: suppliers.filter((x) => x.contactId).map((x, i) => ({
            contactId: x.contactId, supplierRef: x.supplierRef || null, unitName: x.unitName || null,
            price: x.price === '' ? null : num(x.price), preferred: i === 0,
          })),
        }),
      };
      const r = await api<{ item: StockItemFull }>(item ? `/api/stock/items/${item.id}` : '/api/stock/items', { method: item ? 'PATCH' : 'POST', body });
      let saved = r.item;
      if (photo) {
        try {
          const form = new FormData();
          form.append('file', photo);
          const up = await apiUpload<{ photoUrl: string; photoThumbUrl: string }>(`/api/stock/items/${r.item.id}/photo`, form);
          saved = { ...saved, photoUrl: up.photoUrl, photoThumbUrl: up.photoThumbUrl };
        } catch (e3) {
          // l'article est créé : on ne bloque pas, la photo pourra être ajoutée depuis sa fiche
          alert(`Article enregistré, mais la photo n’a pas pu être envoyée : ${(e3 as Error).message}`);
        }
      }
      onSaved(saved);
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
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Photo du produit <span className="muted" style={{ fontWeight: 400 }}>— facultative, visible dans la liste, le scan et les préparations</span></label>
            <div className="row" style={{ gap: '0.8rem', alignItems: 'center', flexWrap: 'nowrap' }}>
              <div style={{ width: 84, height: 84, borderRadius: 10, overflow: 'hidden', background: 'var(--surface-2)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {photoPreview || item?.photoThumbUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={photoPreview ?? item!.photoThumbUrl!} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ fontSize: 28 }}>📷</span>}
              </div>
              <label className="btn" style={{ cursor: 'pointer' }}>
                {photoPreview || item?.photoUrl ? 'Changer l’image' : 'Choisir une image'}
                <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setPhoto(f); e.target.value = ''; }} />
              </label>
              {photo && <button type="button" className="btn ghost" onClick={() => setPhoto(null)}>Annuler</button>}
            </div>
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
            <span className="muted" style={{ fontSize: '0.75rem' }}>Le plus petit que vous comptez : kg pour un sac de 25 kg</span>
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
            <label>Conditionnements (sac, palette…) <span className="muted" style={{ fontWeight: 400 }}>— ex. 1 sac = 25 kg, puis 1 palette = 42 sac</span></label>
            {units.map((u, i) => (
              <div key={i} className="row" style={{ gap: '0.5rem', marginBottom: '0.4rem', flexWrap: 'nowrap', alignItems: 'center' }}>
                <span className="muted" style={{ whiteSpace: 'nowrap' }}>1</span>
                <input className="input" style={{ flex: 1 }} list="si-units" placeholder="sac, palette, pcs…" value={u.name} aria-label="Nom du conditionnement"
                  onChange={(e) => {
                    const old = u.name.trim();
                    // les lignes qui s'appuient sur ce nom suivent son renommage
                    setUnits(units.map((x, j) => (j === i ? { ...x, name: e.target.value } : old && x.per === old ? { ...x, per: e.target.value.trim() } : x)));
                  }} />
                <span className="muted" style={{ whiteSpace: 'nowrap' }}>=</span>
                <input className="input" style={{ width: 100 }} type="number" step="any" min="0" placeholder="25" value={u.qty} onChange={(e) => setUnits(units.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
                <select className="select" style={{ width: 120 }} value={perOf(u, i)} onChange={(e) => setUnits(units.map((x, j) => (j === i ? { ...x, per: e.target.value } : x)))} aria-label="Unité de référence">
                  <option value="">{v.unit || 'base'}</option>
                  {units.slice(0, i).filter((x) => x.name.trim()).map((x) => <option key={x.name} value={x.name.trim()}>{x.name}</option>)}
                </select>
                <span className="muted" style={{ whiteSpace: 'nowrap', fontSize: '0.78rem' }}>{u.name.trim() && num(u.qty) > 0 && perOf(u, i) ? `= ${factorOfUnit(u.name)} ${v.unit || 'base'}` : ''}</span>
                <button type="button" className="btn ghost" aria-label="Retirer l’unité" onClick={() => setUnits(units.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setUnits([...units, { name: '', qty: '', per: null }])}>+ Ajouter un conditionnement</button>
            {units.length > 0 && <span className="muted" style={{ fontSize: '0.78rem' }}>Le stock est compté en <strong>{v.unit || 'unité de base'}</strong>. Chaque ligne se définit par rapport à l’unité choisie à droite : « 1 palette = 42 sac » se règle en choisissant « sac ».</span>}
          </div>

          {!item && (
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>Fournisseurs &amp; prix <span className="muted" style={{ fontWeight: 400 }}>— plusieurs possibles, un prix par conditionnement (souvent moins cher à la palette)</span></label>
              {suppliers.map((sp, i) => {
                const f = factorOfUnit(sp.unitName);
                return (
                  <div key={i} className="row" style={{ gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'nowrap', alignItems: 'center' }}>
                    <div style={{ flex: 1.4, minWidth: 0 }}>
                      <ContactPicker typeFilter="supplier" value={sp.contactId} onChange={(cid) => setSuppliers(suppliers.map((x, j) => (j === i ? { ...x, contactId: cid } : x)))} />
                    </div>
                    <input className="input" style={{ flex: 1, minWidth: 0 }} placeholder="Réf. chez lui" value={sp.supplierRef} onChange={(e) => setSuppliers(suppliers.map((x, j) => (j === i ? { ...x, supplierRef: e.target.value } : x)))} />
                    <select className="select" style={{ width: 120 }} value={sp.unitName} onChange={(e) => setSuppliers(suppliers.map((x, j) => (j === i ? { ...x, unitName: e.target.value } : x)))} aria-label="Conditionnement">
                      <option value="">{v.unit || 'base'}</option>
                      {unitNames.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <div style={{ width: 120 }}>
                      <input className="input" type="number" step="any" min="0" placeholder="Prix HT" value={sp.price} onChange={(e) => setSuppliers(suppliers.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} aria-label="Prix HT du conditionnement" />
                      {sp.price !== '' && f !== 1 && f > 0 && <div className="muted" style={{ fontSize: '0.7rem' }}>≈ {formatEur(num(sp.price) / f)} / {v.unit || 'base'}</div>}
                    </div>
                    <button type="button" className="btn ghost" aria-label="Retirer le fournisseur" onClick={() => setSuppliers(suppliers.filter((_, j) => j !== i))}>✕</button>
                  </div>
                );
              })}
              <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setSuppliers([...suppliers, { contactId: '', supplierRef: '', unitName: '', price: '' }])}>+ Ajouter un fournisseur</button>
              {suppliers.length > 0 && <span className="muted" style={{ fontSize: '0.78rem' }}>Le 1er fournisseur est le préféré. Pour un prix à la palette chez le même fournisseur, ajoutez une 2ᵉ ligne avec « palette ».</span>}
            </div>
          )}

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
