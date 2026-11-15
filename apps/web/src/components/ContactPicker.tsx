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
  browse,
}: {
  id?: string;
  value: string;
  onChange: (id: string, label: string, meta?: PickerItem['meta']) => void;
  typeFilter?: 'client' | 'supplier' | 'all';
  /** Restreint la recherche (pas la création) à une ou plusieurs catégories, ex. `['acp',
   *  'developer']` pour ne proposer que des immeubles/projets existants. */
  kindFilter?: string[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  /** affiche la liste dès le clic dans le champ vide */
  browse?: boolean;
}) {
  async function search(q: string): Promise<PickerItem[]> {
    const kindParam = kindFilter?.length ? `&kind=${kindFilter.join(',')}` : '';
    const r = await api<{ items: { id: string; name: string; city: string | null; syndic?: { name: string } | null; matchedPersons?: { id: string; name: string; role: string | null; email: string | null; phone: string | null }[] }[] }>(
      `/api/contacts?type=${typeFilter}&q=${encodeURIComponent(q)}${kindParam}&pageSize=20`,
    );
    return r.items.slice(0, q.trim() ? 8 : 20).flatMap((c): PickerItem[] => [
      // personne de contact d'une société (gestionnaire chez un syndic, comptabilité d'un fournisseur…) : trouvée par son nom
      ...(c.matchedPersons ?? []).map((p) => ({
        id: c.id, key: `${c.id}:${p.id}`, name: p.name,
        sub: `${p.role ? `${p.role} · ` : ''}chez ${c.name}`,
        meta: { person: p, companyName: c.name },
      })),
      { id: c.id, name: c.name, sub: [c.syndic ? `c/o ${c.syndic.name}` : null, c.city].filter(Boolean).join(' · ') || undefined },
    ]);
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
      browseOnFocus={browse}
      renderCreate={(query, onCreated, onCancel) => (
        <ContactQuickCreate initialName={query} typeFilter={typeFilter === 'all' ? 'client' : typeFilter}defaultKind={kindFilter?.length === 1 ? kindFilter[0] : undefined} onCreated={onCreated} onCancel={onCancel} />
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
