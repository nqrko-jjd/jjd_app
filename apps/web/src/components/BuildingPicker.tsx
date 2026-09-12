'use client';
import { useRef, useState } from 'react';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { SearchCreateSelect, type PickerItem } from './SearchCreateSelect';
import { FormModal } from './FormModal';
import { BUILDING_FIELDS } from '@/lib/forms';
import { BUILDING_CONTACT_ROLES, BUILDING_CONTACT_ROLE_LABEL } from '@jjd/shared';

/** Cherche un immeuble/projet existant (`GET /api/buildings?q=...`) ou en crée un à la volée
 *  — pour le cas « demande sur un nouveau bâtiment, pas encore de fiche ». */
export function BuildingPicker({
  id,
  value,
  onChange,
  placeholder,
  required,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (id: string, label: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  async function search(q: string): Promise<PickerItem[]> {
    const r = await api<{ items: { id: string; name: string; city: string | null }[] }>(`/api/buildings?q=${encodeURIComponent(q)}`);
    return r.items.slice(0, 8).map((b) => ({ id: b.id, name: b.name, sub: b.city ?? undefined }));
  }
  async function resolveLabel(bid: string): Promise<string | null> {
    try {
      const r = await api<{ building: { name: string } }>(`/api/buildings/${bid}`);
      return r.building?.name ?? null;
    } catch {
      return null;
    }
  }

  return (
    <SearchCreateSelect
      id={id}
      value={value}
      onChange={onChange}
      search={search}
      resolveLabel={resolveLabel}
      createLabel="Créer un immeuble"
      placeholder={placeholder ?? 'Nom du bâtiment / projet…'}
      required={required}
      disabled={disabled}
      renderCreate={(query, onCreated, onCancel) => (
        <BuildingQuickCreate initialName={query} onCreated={onCreated} onCancel={onCancel} />
      )}
    />
  );
}

function BuildingQuickCreate({
  initialName,
  onCreated,
  onCancel,
}: {
  initialName: string;
  onCreated: (item: PickerItem) => void;
  onCancel: () => void;
}) {
  const { data: pick } = useApi<{ syndics: { id: string; name: string }[] }>('/api/meta/pickers');
  const [created, setCreated] = useState<PickerItem | null>(null);
  // FormModal ferme (appelle onClose) juste après un onSubmit réussi — sans ce garde-fou,
  // ça remonterait jusqu'à onCancel et démonterait toute l'étape "contacts clés" qui suit.
  // Un ref (pas un state) car onClose s'exécute juste après, avant le prochain rendu.
  const submittedRef = useRef(false);

  if (created) {
    return <BuildingKeyContactsStep building={created} onDone={() => onCreated(created)} />;
  }
  return (
    <FormModal
      title="Nouvel immeuble / projet"
      fields={BUILDING_FIELDS(pick?.syndics ?? [])}
      initial={{ name: initialName }}
      onClose={() => { if (!submittedRef.current) onCancel(); }}
      onSubmit={async (v) => {
        const { building } = await api<{ building: { id: string; name: string } }>('/api/buildings', { method: 'POST', body: v });
        submittedRef.current = true;
        setCreated({ id: building.id, name: building.name });
      }}
    />
  );
}

/** Juste après la création d'un immeuble, propose d'ajouter ses contacts clés (concierge,
 *  gestionnaire syndic…) tout de suite — pour ne pas devoir y retourner depuis la fiche
 *  immeuble juste après. Facultatif, "Terminer" ferme sans rien ajouter. */
function BuildingKeyContactsStep({ building, onDone }: { building: PickerItem; onDone: () => void }) {
  const [role, setRole] = useState('concierge');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [added, setAdded] = useState<{ role: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api(`/api/buildings/${building.id}/contacts`, {
        method: 'POST',
        body: { role, name: name.trim(), phone: phone.trim() || null, email: email.trim() || null },
      });
      setAdded((a) => [...a, { role, name: name.trim() }]);
      setName(''); setPhone(''); setEmail('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim" onClick={onDone}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Contacts clés — {building.name}</h2>
          <button type="button" className="btn ghost" onClick={onDone} aria-label="Fermer">✕</button>
        </div>
        <div className="modal-body">
          <p className="muted" style={{ marginTop: 0, fontSize: '0.88rem' }}>
            Immeuble créé. Concierge, président, gestionnaire syndic… ajoute-les maintenant si tu les as sous la main —
            sinon tu pourras toujours les ajouter plus tard depuis la fiche immeuble.
          </p>
          {added.length > 0 && (
            <ul style={{ margin: '0 0 1rem', paddingLeft: '1.1rem' }}>
              {added.map((a, i) => (
                <li key={i}>{BUILDING_CONTACT_ROLE_LABEL[a.role as keyof typeof BUILDING_CONTACT_ROLE_LABEL] ?? a.role} — {a.name}</li>
              ))}
            </ul>
          )}
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.7rem' }}>
            <div className="field">
              <label>Rôle</label>
              <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
                {BUILDING_CONTACT_ROLES.map((r) => <option key={r} value={r}>{BUILDING_CONTACT_ROLE_LABEL[r]}</option>)}
              </select>
            </div>
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>Nom</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="M. Da Silva" />
            </div>
            <div className="field">
              <label>Téléphone</label>
              <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="field">
              <label>E-mail</label>
              <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onDone}>Terminer</button>
          <button type="button" className="btn primary" disabled={busy || !name.trim()} onClick={add}>
            {busy ? '…' : '+ Ajouter ce contact'}
          </button>
        </div>
      </div>
    </div>
  );
}
