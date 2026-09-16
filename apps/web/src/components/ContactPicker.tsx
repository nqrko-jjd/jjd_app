'use client';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { SearchCreateSelect, type PickerItem } from './SearchCreateSelect';
import { FormModal } from './FormModal';
import { CONTACT_FIELDS, composeContactPayload, splitContactName } from '@/lib/forms';

/** Cherche un contact existant (`GET /api/contacts?type=...&q=...`) ou en crée un à la volée
 *  (formulaire adaptatif par catégorie déjà en place) — pour ne jamais bloquer un formulaire
 *  parce que le client n'existe pas encore dans la liste. */
export function ContactPicker({
  id,
  value,
  onChange,
  typeFilter = 'client',
  kindFilter,
  placeholder,
  required,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (id: string, label: string) => void;
  typeFilter?: 'client' | 'supplier';
  /** Restreint la recherche (pas la création) à une ou plusieurs catégories, ex. `['acp',
   *  'developer']` pour ne proposer que des immeubles/projets existants. */
  kindFilter?: string[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  async function search(q: string): Promise<PickerItem[]> {
    const kindParam = kindFilter?.length ? `&kind=${kindFilter.join(',')}` : '';
    const r = await api<{ items: { id: string; name: string; city: string | null }[] }>(
      `/api/contacts?type=${typeFilter}&q=${encodeURIComponent(q)}${kindParam}&pageSize=20`,
    );
    return r.items.slice(0, 8).map((c) => ({ id: c.id, name: c.name, sub: c.city ?? undefined }));
  }
  async function resolveLabel(cid: string): Promise<string | null> {
    try {
      const r = await api<{ contact: { name: string } }>(`/api/contacts/${cid}`);
      return r.contact?.name ?? null;
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
      createLabel="Créer un contact"
      placeholder={placeholder ?? (typeFilter === 'supplier' ? 'Nom du fournisseur…' : 'Nom du client…')}
      required={required}
      disabled={disabled}
      renderCreate={(query, onCreated, onCancel) => (
        <ContactQuickCreate initialName={query} typeFilter={typeFilter} defaultKind={kindFilter?.length === 1 ? kindFilter[0] : undefined} onCreated={onCreated} onCancel={onCancel} />
      )}
    />
  );
}

function ContactQuickCreate({
  initialName,
  typeFilter,
  defaultKind,
  onCreated,
  onCancel,
}: {
  initialName: string;
  typeFilter: 'client' | 'supplier';
  defaultKind?: string;
  onCreated: (item: PickerItem) => void;
  onCancel: () => void;
}) {
  const { data: pick } = useApi<{ syndics: { id: string; name: string }[] }>('/api/meta/pickers');
  return (
    <FormModal
      title="Nouveau contact"
      fields={CONTACT_FIELDS(typeFilter, pick?.syndics ?? [])}
      initial={{ name: initialName, ...splitContactName(initialName), type: typeFilter, kind: defaultKind ?? 'individual' }}
      onClose={onCancel}
      onSubmit={async (v) => {
        const { contact } = await api<{ contact: { id: string; name: string } }>('/api/contacts', { method: 'POST', body: composeContactPayload(v) });
        onCreated({ id: contact.id, name: contact.name });
      }}
    />
  );
}
