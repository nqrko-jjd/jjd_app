'use client';
import { useEffect, useState } from 'react';
import { AddressAutocomplete } from './AddressAutocomplete';
import { ContactPicker } from './ContactPicker';
import { BuildingPicker } from './BuildingPicker';
import { ClientOrBuildingPicker } from './ClientOrBuildingPicker';

export interface FieldDef {
  name: string;
  label: string;
  type?: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'tags' | 'checkbox' | 'address' | 'contact' | 'building' | 'client-or-building';
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  full?: boolean;
  /** Bouton à côté du champ (ex. "Rechercher") : lit la valeur actuelle du champ, renvoie un
   *  ensemble de valeurs à fusionner dans le formulaire (ex. nom/adresse trouvés via un n° de TVA). */
  action?: {
    label: string;
    run: (value: string) => Promise<Record<string, unknown>>;
  };
  /** Pour un champ `type: 'address'` : noms des autres champs du formulaire à préremplir
   *  quand une suggestion est choisie (code postal / ville). Si absent, ce champ reçoit
   *  l'adresse complète en une ligne (cas d'un formulaire sans champs séparés). */
  addressFill?: { postalCode?: string; city?: string };
  /** Pour un champ `type: 'contact'` : restreint la recherche/création aux contacts client ou
   *  fournisseur. Par défaut 'client'. */
  contactTypeFilter?: 'client' | 'supplier';
  /** Pour un champ `type: 'client-or-building'` : nom de l'autre champ du formulaire où
   *  stocker le `buildingId` dérivé en même temps que ce champ pose le `clientId`. */
  buildingField?: string;
}

export function FormModal({
  title,
  fields: fieldsProp,
  initial,
  onClose,
  onSubmit,
}: {
  title: string;
  /** Liste fixe, ou fonction des valeurs actuelles — pour un formulaire dont les champs
   *  affichés dépendent d'un choix fait ailleurs dans le même formulaire (ex. le type de
   *  contact change les champs pertinents). */
  fields: FieldDef[] | ((values: Record<string, unknown>) => FieldDef[]);
  initial?: Record<string, unknown>;
  onClose: () => void;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
}) {
  const [v, setV] = useState<Record<string, unknown>>(() => ({ ...initial }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const fields = typeof fieldsProp === 'function' ? fieldsProp(v) : fieldsProp;

  async function runAction(f: FieldDef) {
    if (!f.action) return;
    setActionErr(null);
    setActionBusy(f.name);
    try {
      const patch = await f.action.run(String(v[f.name] ?? ''));
      setV((prev) => ({ ...prev, ...patch }));
    } catch (e) {
      setActionErr((e as Error).message ?? 'Erreur');
    } finally {
      setActionBusy(null);
    }
  }

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const clean: Record<string, unknown> = {};
      for (const f of fields) {
        let val = v[f.name];
        if (f.type === 'number') val = val === '' || val == null ? null : Number(val);
        if (f.type === 'date') val = val ? new Date(val as string).toISOString() : null;
        if (f.type === 'tags') val = typeof val === 'string' ? (val as string).split(',').map((s) => s.trim()).filter(Boolean) : val ?? [];
        if (f.type === 'checkbox') { clean[f.name] = !!val; continue; }
        if (val === '') val = null;
        clean[f.name] = val;
        if (f.type === 'client-or-building' && f.buildingField) clean[f.buildingField] = v[f.buildingField] ?? null;
      }
      await onSubmit(clean);
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
          <h2>{title}</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="modal-body">
          {fields.map((f) => (
            <div className="field" key={f.name} style={f.full ? { gridColumn: '1 / -1' } : undefined}>
              <label htmlFor={f.name}>{f.label}{f.required && ' *'}</label>
              {f.type === 'checkbox' ? (
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 400, fontSize: '0.9rem', color: 'var(--ink)' }}>
                  <input id={f.name} type="checkbox" checked={v[f.name] === undefined ? true : !!v[f.name]} onChange={(e) => setV({ ...v, [f.name]: e.target.checked })} />
                  {f.placeholder ?? 'Oui'}
                </label>
              ) : f.type === 'textarea' ? (
                <textarea id={f.name} className="input" rows={3} value={(v[f.name] as string) ?? ''} onChange={(e) => setV({ ...v, [f.name]: e.target.value })} placeholder={f.placeholder} />
              ) : f.type === 'select' ? (
                <select id={f.name} className="select" value={(v[f.name] as string) ?? ''} onChange={(e) => setV({ ...v, [f.name]: e.target.value })}>
                  <option value="">—</option>
                  {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : f.type === 'address' ? (
                <AddressAutocomplete
                  id={f.name}
                  value={(v[f.name] as string) ?? ''}
                  onChange={(val) => setV((prev) => ({ ...prev, [f.name]: val }))}
                  onSelect={(hit) => {
                    if (f.addressFill) {
                      setV((prev) => ({
                        ...prev,
                        [f.name]: hit.street,
                        ...(f.addressFill!.postalCode ? { [f.addressFill!.postalCode]: hit.postalCode } : {}),
                        ...(f.addressFill!.city ? { [f.addressFill!.city]: hit.city } : {}),
                      }));
                    } else {
                      setV((prev) => ({ ...prev, [f.name]: [hit.street, [hit.postalCode, hit.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') }));
                    }
                  }}
                  placeholder={f.placeholder}
                  required={f.required}
                />
              ) : f.type === 'contact' ? (
                <ContactPicker
                  id={f.name}
                  value={(v[f.name] as string) ?? ''}
                  typeFilter={f.contactTypeFilter ?? 'client'}
                  onChange={(cid) => setV((prev) => ({ ...prev, [f.name]: cid }))}
                  placeholder={f.placeholder}
                  required={f.required}
                />
              ) : f.type === 'building' ? (
                <BuildingPicker
                  id={f.name}
                  value={(v[f.name] as string) ?? ''}
                  onChange={(bid) => setV((prev) => ({ ...prev, [f.name]: bid }))}
                  placeholder={f.placeholder}
                  required={f.required}
                />
              ) : f.type === 'client-or-building' ? (
                <ClientOrBuildingPicker
                  id={f.name}
                  clientId={(v[f.name] as string) ?? ''}
                  buildingId={(v[f.buildingField!] as string) ?? null}
                  onChange={({ clientId, buildingId }) => setV((prev) => ({ ...prev, [f.name]: clientId, [f.buildingField!]: buildingId }))}
                  placeholder={f.placeholder}
                  required={f.required}
                />
              ) : f.action ? (
                <div className="row" style={{ gap: '0.4rem' }}>
                  <input
                    id={f.name}
                    className="input"
                    style={{ flex: 1 }}
                    type="text"
                    value={(v[f.name] as string) ?? ''}
                    onChange={(e) => setV({ ...v, [f.name]: e.target.value })}
                    placeholder={f.placeholder}
                    required={f.required}
                  />
                  <button
                    type="button"
                    className="btn"
                    disabled={actionBusy === f.name || !(v[f.name] as string)?.trim()}
                    onClick={() => runAction(f)}
                  >
                    {actionBusy === f.name ? '…' : f.action.label}
                  </button>
                </div>
              ) : (
                <input
                  id={f.name}
                  className="input"
                  type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                  step={f.type === 'number' ? 'any' : undefined}
                  value={(v[f.name] as string) ?? ''}
                  onChange={(e) => setV({ ...v, [f.name]: e.target.value })}
                  placeholder={f.placeholder}
                  required={f.required}
                />
              )}
            </div>
          ))}
        </div>
        {actionErr && <div className="badge crit" style={{ margin: '0 1.15rem 0.7rem', padding: '0.4rem 0.7rem' }}>{actionErr}</div>}
        {err && <div className="badge crit" style={{ margin: '0 1.15rem', padding: '0.4rem 0.7rem' }}>{err}</div>}
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
        </div>
      </form>
    </div>
  );
}

export function toDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}
