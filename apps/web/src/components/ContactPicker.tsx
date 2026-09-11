'use client';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { SearchCreateSelect, type PickerItem } from './SearchCreateSelect';
import { FormModal } from './FormModal';
import { CONTACT_FIELDS } from '@/lib/forms';

/** Cherche un contact existant (`GET /api/contacts?type=...&q=...`) ou en crée un à la volée
 *  (formulaire adaptatif par catégorie déjà en place) — pour ne jamais bloquer un formulaire
 *  parce que le client n'existe pas encore dans la liste. */
export function ContactPicker({
  id,
  value,
  onChange,
  typeFilter = 'client',
  placeholder,
  required,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (id: string, label: string) => void;
  typeFilter?: 'client' | 'supplier';
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  async function search(q: string): Promise<PickerItem[]> {
    const r = await api<{ items: { id: string; name: string; city: string | null }[] }>(
      `/api/contacts?type=${typeFilter}&q=${encodeURIComponent(q)}&pageSize=20`,
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
        <ContactQuickCreate initialName={query} typeFilter={typeFilter} onCreated={onCreated} onCancel={onCancel} />
      )}
    />
  );
}

function ContactQuickCreate({
  initialName,
  typeFilter,
  onCreated,
  onCancel,
}: {
  initialName: string;
  typeFilter: 'client' | 'supplier';
  onCreated: (item: PickerItem) => void;
  onCancel: () => void;
}) {
  const { data: pick } = useApi<{ syndics: { id: string; name: string }[] }>('/api/meta/pickers');
  return (
    <FormModal
      title="Nouveau contact"
      fields={CONTACT_FIELDS(typeFilter, pick?.syndics ?? [])}
      initial={{ name: initialName, type: typeFilter }}
      onClose={onCancel}
      onSubmit={async (v) => {
        const { contact } = await api<{ contact: { id: string; name: string } }>('/api/contacts', { method: 'POST', body: v });
        onCreated({ id: contact.id, name: contact.name });
      }}
    />
  );
}
