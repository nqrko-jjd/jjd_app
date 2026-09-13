'use client';
import { useRef, useState } from 'react';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { SearchCreateSelect, type PickerItem } from './SearchCreateSelect';
import { FormModal } from './FormModal';
import { CONTACT_FIELDS, BUILDING_FIELDS, composeContactPayload, splitContactName } from '@/lib/forms';

interface ContactHit { id: string; name: string; city: string | null; kind: string | null; building: { id: string } | null }
interface BuildingHit { id: string; name: string; city: string | null; clientId: string | null }

/**
 * Cherche un client OU un immeuble/projet en une seule liste et pose les DEUX liens
 * (`clientId` + `buildingId`) d'un coup, toujours synchronisés — un chantier ACP facturé au
 * contact mais jamais lié à son immeuble (ou l'inverse) reste invisible sur la moitié des
 * fiches concernées (bug déjà rencontré et corrigé une fois en données, cf. backfill
 * worksite-building). Un seul champ élimine la désynchronisation à la source plutôt que de la
 * rattraper après coup.
 */
export function ClientOrBuildingPicker({
  id,
  clientId,
  buildingId,
  onChange,
  placeholder,
  required,
  disabled,
}: {
  id?: string;
  clientId: string;
  buildingId: string | null;
  onChange: (v: { clientId: string; buildingId: string | null }) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  async function search(q: string): Promise<PickerItem[]> {
    const [contacts, buildings] = await Promise.all([
      api<{ items: ContactHit[] }>(`/api/contacts?type=client&q=${encodeURIComponent(q)}&pageSize=20`),
      api<{ items: BuildingHit[] }>(`/api/buildings?q=${encodeURIComponent(q)}`),
    ]);
    const fromContacts = contacts.items.slice(0, 6).map((c) => ({
      id: c.id,
      name: c.name,
      sub: c.city ?? undefined,
      meta: { clientId: c.id, buildingId: c.building?.id ?? null },
    }));
    // Évite le doublon quand le même immeuble ressort déjà via son contact (cas normal ACP).
    const linkedBuildingIds = new Set(fromContacts.map((c) => c.meta.buildingId).filter(Boolean));
    const fromBuildings = buildings.items
      .filter((b) => !linkedBuildingIds.has(b.id))
      .slice(0, 6)
      .map((b) => ({
        id: `b:${b.id}`,
        name: b.name,
        sub: 'Immeuble / Projet' + (b.city ? ` · ${b.city}` : ''),
        meta: { clientId: b.clientId ?? '', buildingId: b.id },
      }));
    return [...fromContacts, ...fromBuildings];
  }

  async function resolveLabel(v: string): Promise<string | null> {
    try {
      if (v.startsWith('b:')) {
        const r = await api<{ building: { name: string } }>(`/api/buildings/${v.slice(2)}`);
        return r.building?.name ?? null;
      }
      const r = await api<{ contact: { name: string } }>(`/api/contacts/${v}`);
      return r.contact?.name ?? null;
    } catch {
      return null;
    }
  }

  const value = clientId || (buildingId ? `b:${buildingId}` : '');

  return (
    <SearchCreateSelect
      id={id}
      value={value}
      onChange={(_id, _label, meta) => {
        const m = meta as { clientId: string; buildingId: string | null } | undefined;
        onChange(m ? { clientId: m.clientId, buildingId: m.buildingId } : { clientId: '', buildingId: null });
      }}
      search={search}
      resolveLabel={resolveLabel}
      createLabel="Créer un client"
      placeholder={placeholder ?? "Nom du client ou de l'immeuble…"}
      required={required}
      disabled={disabled}
      renderCreate={(query, onCreated, onCancel) => (
        <ClientQuickCreate initialName={query} onCreated={onCreated} onCancel={onCancel} />
      )}
    />
  );
}

function ClientQuickCreate({
  initialName,
  onCreated,
  onCancel,
}: {
  initialName: string;
  onCreated: (item: PickerItem) => void;
  onCancel: () => void;
}) {
  const { data: pick } = useApi<{ syndics: { id: string; name: string }[] }>('/api/meta/pickers');
  const [pendingBuilding, setPendingBuilding] = useState<{ id: string; name: string } | null>(null);
  const submittedRef = useRef(false);

  if (pendingBuilding) {
    return (
      <BuildingForClientStep
        contact={pendingBuilding}
        onDone={(buildingId) => onCreated({ id: pendingBuilding.id, name: pendingBuilding.name, meta: { clientId: pendingBuilding.id, buildingId } })}
      />
    );
  }

  return (
    <FormModal
      title="Nouveau client"
      fields={CONTACT_FIELDS('client', pick?.syndics ?? [])}
      initial={{ name: initialName, ...splitContactName(initialName), type: 'client' }}
      onClose={() => { if (!submittedRef.current) onCancel(); }}
      onSubmit={async (v) => {
        const { contact } = await api<{ contact: { id: string; name: string; kind: string | null } }>('/api/contacts', {
          method: 'POST',
          body: composeContactPayload(v),
        });
        submittedRef.current = true;
        if (contact.kind === 'acp' || contact.kind === 'developer') {
          setPendingBuilding({ id: contact.id, name: contact.name });
        } else {
          onCreated({ id: contact.id, name: contact.name, meta: { clientId: contact.id, buildingId: null } });
        }
      }}
    />
  );
}

/** Après la création d'un client ACP/Promoteur, propose de créer l'immeuble/projet lié tout
 *  de suite (nom préreempli) — "Annuler" saute cette étape sans annuler la création du client,
 *  déjà faite. */
function BuildingForClientStep({
  contact,
  onDone,
}: {
  contact: { id: string; name: string };
  onDone: (buildingId: string | null) => void;
}) {
  const { data: pick } = useApi<{ syndics: { id: string; name: string }[] }>('/api/meta/pickers');
  return (
    <FormModal
      title={`Immeuble / projet lié à « ${contact.name} » ?`}
      fields={BUILDING_FIELDS(pick?.syndics ?? [])}
      initial={{ name: contact.name, clientId: contact.id }}
      onClose={() => onDone(null)}
      onSubmit={async (v) => {
        const { building } = await api<{ building: { id: string } }>('/api/buildings', { method: 'POST', body: v });
        onDone(building.id);
      }}
    />
  );
}
