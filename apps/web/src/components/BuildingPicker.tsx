'use client';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { SearchCreateSelect, type PickerItem } from './SearchCreateSelect';
import { FormModal } from './FormModal';
import { BUILDING_FIELDS } from '@/lib/forms';

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
  return (
    <FormModal
      title="Nouvel immeuble / projet"
      fields={BUILDING_FIELDS(pick?.syndics ?? [])}
      initial={{ name: initialName }}
      onClose={onCancel}
      onSubmit={async (v) => {
        const { building } = await api<{ building: { id: string; name: string } }>('/api/buildings', { method: 'POST', body: v });
        onCreated({ id: building.id, name: building.name });
      }}
    />
  );
}
