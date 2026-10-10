'use client';
import { tr } from '@/lib/ui-language';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { ContactPicker } from './ContactPicker';
import { WORKSITE_CONTACT_ROLES, WORKSITE_CONTACT_ROLE_LABEL, WORKSITE_CONTACT_FOR, WORKSITE_CONTACT_FOR_LABEL, BUILDING_CONTACT_ROLES, BUILDING_CONTACT_ROLE_LABEL } from '@jjd/shared';

export interface RoleContact { contactId?: string | null; role: string; name: string; phone?: string | null; email?: string | null; unitLabel?: string | null; contactFor?: string | null; note?: string | null }
export function ContactRoleEditor({ value, onChange, building = false, onPending }: { value: RoleContact; onChange: (v: RoleContact) => void; building?: boolean; onPending?: (pending: boolean) => void }) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  async function select(id: string) {
    const seq = ++request.current;
    setError('');
    if (!id) { setLoading(false); onChange({ ...value, contactId: null }); return; }
    setLoading(true); onPending?.(true);
    try {
      const { contact } = await api<{ contact: { id: string; name: string; phone: string | null; email: string | null } }>(`/api/contacts/${id}`);
      if (seq === request.current) onChange({ ...value, contactId: contact.id, name: contact.name, phone: contact.phone, email: contact.email });
    } catch (e) { if (seq === request.current) setError((e as Error).message); }
    finally { if (seq === request.current) { setLoading(false); onPending?.(false); } }
  }
  const roles = building ? BUILDING_CONTACT_ROLES : WORKSITE_CONTACT_ROLES;
  const labels: Record<string, string> = building ? BUILDING_CONTACT_ROLE_LABEL : WORKSITE_CONTACT_ROLE_LABEL;
  return <div className="wiz-grid">
    <div className="field full"><label>Personne à joindre</label><ContactPicker value={value.contactId ?? ''} onChange={(id) => void select(id)} placeholder="Chercher ou créer une fiche Contact…" disabled={loading}/></div>
    {loading && <p className="full" role="status">Chargement des coordonnées…</p>}
    {error && <p className="wiz-error full" role="alert">{error}</p>}
    {value.contactId ? <div className="wiz-note full"><strong>{value.name}</strong>{[value.phone, value.email].filter(Boolean).join(' · ') || 'Coordonnées à compléter dans Contacts.'}<div><Link href={`/app/contacts/${value.contactId}`} target="_blank" rel="noreferrer">Ouvrir la fiche Contact</Link></div></div> : value.name ? <div className="wiz-note full"><strong>Coordonnées historiques conservées</strong>{value.name} · {[value.phone, value.email].filter(Boolean).join(' · ')}<div>Choisissez la fiche correspondante ci-dessus pour la rattacher. Aucun rapprochement automatique.</div></div> : null}
    <div className="field"><label>Rôle dans ce dossier</label><select className="select" disabled={loading} value={value.role} onChange={e => onChange({ ...value, role: e.target.value })}>{!roles.includes(value.role as never) && <option value={value.role}>{value.role}</option>}{roles.map(role => <option key={role} value={role}>{labels[role]}</option>)}</select></div>
    {!building && <div className="field full"><label>Appartement / lot concerné</label><input className="input" disabled={loading} value={value.unitLabel ?? ''} onChange={e => onChange({ ...value, unitLabel: e.target.value })} placeholder="Ex. D02 · logement touché, D03 · accès pour recherche"/></div>}
    {!building && <div className="field"><label>À contacter pour</label><select className="select" disabled={loading} value={value.contactFor ?? ''} onChange={e => onChange({ ...value, contactFor: e.target.value })}><option value="">Selon le besoin</option>{value.contactFor && !WORKSITE_CONTACT_FOR.includes(value.contactFor as never) && <option value={value.contactFor}>{value.contactFor}</option>}{WORKSITE_CONTACT_FOR.map(f => <option key={f} value={f}>{WORKSITE_CONTACT_FOR_LABEL[f]}</option>)}</select></div>}
    {building && <div className="field full"><label>Précisions pour cet immeuble</label><textarea className="input" disabled={loading} value={value.note ?? ''} onChange={e => onChange({ ...value, note: e.target.value })}/></div>}
  </div>;
}
export function ContactsDialog({ title, initial, building = false, onClose, onSave }: { title: string; initial: RoleContact[]; building?: boolean; onClose: () => void; onSave: (rows: RoleContact[]) => Promise<void> }) {
  const [rows, setRows] = useState<RoleContact[]>(initial.length ? initial : building ? [{ role: 'concierge', name: '' }] : []);
  const [pending, setPending] = useState<Record<number, boolean>>({});
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  return <div className="modal-scrim"><form className="modal wiz" role="dialog" aria-modal="true" aria-label={title} onSubmit={async e => { e.preventDefault(); e.stopPropagation(); if (busy || Object.values(pending).some(Boolean)) return; if (rows.some(r => !r.name.trim())) { setError('Sélectionnez une personne pour chaque ligne.'); return; } setBusy(true); setError(''); try { await onSave(rows.map(({ contactId, role, name, phone, email, contactFor, note, unitLabel }) => ({ contactId, role, name, phone, email, contactFor, note, unitLabel }))); onClose(); } catch (e) { setError((e as Error).message); setBusy(false); } }}>
    <div className="modal-head"><h2>{title}</h2><button className="btn ghost" type="button" onClick={onClose} aria-label={tr("Fermer")}>✕</button></div>
    <div className="wiz-body"><p className="wiz-hint">Une fiche par personne. Les coordonnées restent gérées dans Contacts ; le rôle dépend de ce dossier. Aucun accès au portail n’est créé ici.</p>{rows.map((row, i) => <section className="wiz-contact" key={i}><ContactRoleEditor onPending={v => setPending(prev => ({ ...prev, [i]: v }))} building={building} value={row} onChange={next => setRows(prev => prev.map((r, j) => j === i ? next : r))}/>{!building && <button className="btn ghost" type="button" disabled={Object.values(pending).some(Boolean)} onClick={() => setRows(prev => prev.filter((_, j) => j !== i))}>Retirer du chantier</button>}</section>)}{!building && <button className="btn" type="button" disabled={Object.values(pending).some(Boolean)} onClick={() => setRows(prev => [...prev, { role: 'sur_place', name: '', contactFor: 'rdv_acces' }])}>Ajouter une personne</button>}{error && <div className="wiz-error" role="alert">{error}</div>}</div>
    <div className="modal-foot"><button className="btn" type="button" onClick={onClose}>{tr("Annuler")}</button><button className="btn primary" disabled={busy || Object.values(pending).some(Boolean)}>{busy ? tr("Enregistrement…") : tr("Enregistrer")}</button></div>
  </form></div>;
}
