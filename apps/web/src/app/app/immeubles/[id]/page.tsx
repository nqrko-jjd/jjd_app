'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, StatusBadge, Money, formatDateBE } from '@/lib/ui';
import { FormModal, type FieldDef } from '@/components/FormModal';
import {
  BUILDING_CONTACT_ROLES, BUILDING_CONTACT_ROLE_LABEL, OCCUPANT_KINDS, OCCUPANT_KIND_LABEL,
} from '@jjd/shared';

interface BContact {
  id: string; role: string; name: string; phone: string | null; email: string | null; note: string | null;
  contact: { id: string; name: string } | null;
}
interface BUnit {
  id: string; label: string; floor: string | null; door: string | null;
  occupantName: string | null; occupantPhone: string | null; occupantEmail: string | null;
  occupantKind: string | null; note: string | null;
}
interface Detail {
  building: {
    id: string; name: string; address: string | null; postalCode: string | null; city: string | null; note: string | null;
    reference: string | null; lotCount: number | null; digicode: string | null; accessNote: string | null;
    syndic: { id: string; name: string; email: string | null; phone: string | null } | null;
    client: { id: string; name: string } | null;
    contacts: BContact[];
    units: BUnit[];
    worksites: {
      id: string; ref: string; title: string; status: string; quotedHt: number | null; endedOn: string | null;
      manager: { firstName: string; displayName: string | null } | null;
      documents: { id: string; kind: string; number: string | null; status: string; totalTtc: number }[];
    }[];
  };
}

const buildingFields = (
  syndics: { id: string; name: string }[],
  clients: { id: string; name: string }[],
): FieldDef[] => [
  { name: 'name', label: 'Nom de l’immeuble / ACP', required: true, full: true },
  { name: 'syndicId', label: 'Syndic', type: 'select', options: syndics.map((s) => ({ value: s.id, label: s.name })) },
  { name: 'clientId', label: 'Client / ACP (contact)', type: 'select', options: clients.map((c) => ({ value: c.id, label: c.name })) },
  { name: 'address', label: 'Adresse', full: true },
  { name: 'postalCode', label: 'Code postal' },
  { name: 'city', label: 'Ville' },
  { name: 'reference', label: 'Référence dossier (syndic / ACP)' },
  { name: 'lotCount', label: 'Nombre de lots', type: 'number' },
  { name: 'digicode', label: 'Digicode' },
  { name: 'accessNote', label: 'Accès (clés, badges, parking…)', type: 'textarea', full: true },
  { name: 'note', label: 'Note', type: 'textarea', full: true },
];

const CONTACT_FIELDS: FieldDef[] = [
  { name: 'role', label: 'Rôle', type: 'select', options: BUILDING_CONTACT_ROLES.map((r) => ({ value: r, label: BUILDING_CONTACT_ROLE_LABEL[r] })) },
  { name: 'name', label: 'Nom', required: true, full: true },
  { name: 'phone', label: 'Téléphone' },
  { name: 'email', label: 'E-mail' },
  { name: 'note', label: 'Note', type: 'textarea', full: true },
];

const UNIT_FIELDS: FieldDef[] = [
  { name: 'label', label: 'Lot / appartement', required: true, placeholder: 'C1, Lot 12, 2A…' },
  { name: 'floor', label: 'Étage', placeholder: '1er étage, RdC…' },
  { name: 'door', label: 'Porte / précision', placeholder: 'App C, porte gauche…' },
  { name: 'occupantName', label: 'Occupant', full: true, placeholder: 'Mme Pinto' },
  { name: 'occupantPhone', label: 'Téléphone' },
  { name: 'occupantEmail', label: 'E-mail' },
  { name: 'occupantKind', label: 'Statut', type: 'select', options: OCCUPANT_KINDS.map((k) => ({ value: k, label: OCCUPANT_KIND_LABEL[k] })) },
  { name: 'note', label: 'Note', type: 'textarea', full: true },
];

export default function ImmeubleDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, loading, reload } = useApi<Detail>(`/api/buildings/${id}`);
  const { data: pick } = useApi<{ syndics: { id: string; name: string }[]; clients: { id: string; name: string }[] }>('/api/meta/pickers');
  const [modal, setModal] = useState<null | { kind: 'building' | 'contact' | 'unit'; row?: BContact | BUnit }>(null);

  if (loading) return <div className="empty">Chargement…</div>;
  if (!data) return <div className="empty">Immeuble introuvable.</div>;
  const b = data.building;

  const closeAndReload = () => { setModal(null); reload(); };

  return (
    <>
      <PageHead
        title={b.name}
        sub={[b.address, [b.postalCode, b.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || undefined}
        action={
          <div className="row">
            <button className="btn" onClick={() => setModal({ kind: 'building' })}>Modifier</button>
            <Link href="/app/immeubles" className="btn">← Immeubles</Link>
          </div>
        }
      />

      <div className="info-grid" style={{ marginBottom: '1.6rem' }}>
        {b.syndic && <Info label="Syndic" value={<>{b.syndic.name}<br /><span className="muted" style={{ fontSize: '0.8rem' }}>{b.syndic.email ?? b.syndic.phone ?? ''}</span></>} />}
        {b.client && <Info label="Client / ACP" value={<Link href={`/app/contacts/${b.client.id}`}>{b.client.name}</Link>} />}
        {b.reference && <Info label="Référence" value={b.reference} />}
        {b.lotCount != null && <Info label="Lots" value={String(b.lotCount)} />}
        {b.digicode && <Info label="Digicode" value={b.digicode} />}
        <Info label="Interventions" value={String(b.worksites.length)} />
      </div>
      {b.accessNote && (
        <div className="card card-pad" style={{ marginBottom: '1.6rem' }}>
          <div className="section-title">Accès</div>
          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{b.accessNote}</p>
        </div>
      )}

      {/* Contacts clés */}
      <div className="section-title">
        Contacts clés <span className="hint">{b.contacts.length}</span>
        <button className="btn" style={{ marginLeft: 'auto', padding: '0.2rem 0.6rem', fontSize: '0.78rem' }} onClick={() => setModal({ kind: 'contact' })}>+ Ajouter</button>
      </div>
      {b.contacts.length === 0 ? (
        <div className="card card-pad muted" style={{ marginBottom: '1.6rem' }}>Aucun contact (concierge, président d’assemblée, gestionnaire…).</div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', marginBottom: '1.6rem' }}>
          {b.contacts.map((c) => (
            <div key={c.id} className="card card-pad">
              <div className="eyebrow">{BUILDING_CONTACT_ROLE_LABEL[c.role as keyof typeof BUILDING_CONTACT_ROLE_LABEL] ?? c.role}</div>
              <div style={{ fontWeight: 700, margin: '0.2rem 0' }}>{c.name}</div>
              {c.phone && <div><a href={`tel:${c.phone}`}>{c.phone}</a></div>}
              {c.email && <div className="muted" style={{ fontSize: '0.85rem' }}>{c.email}</div>}
              {c.note && <div className="muted" style={{ fontSize: '0.82rem', marginTop: '0.3rem' }}>{c.note}</div>}
              <div className="row" style={{ marginTop: '0.5rem', gap: '0.3rem' }}>
                <button className="btn ghost" style={mini} onClick={() => setModal({ kind: 'contact', row: c })}>Modifier</button>
                <button className="btn ghost" style={mini} onClick={async () => { if (confirm('Supprimer ?')) { await api(`/api/buildings/${id}/contacts/${c.id}`, { method: 'DELETE' }); reload(); } }}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lots & occupants */}
      <div className="section-title">
        Lots &amp; occupants <span className="hint">{b.units.length}</span>
        <button className="btn" style={{ marginLeft: 'auto', padding: '0.2rem 0.6rem', fontSize: '0.78rem' }} onClick={() => setModal({ kind: 'unit' })}>+ Ajouter</button>
      </div>
      {b.units.length === 0 ? (
        <div className="card card-pad muted" style={{ marginBottom: '1.6rem' }}>Aucun lot renseigné. Ex. « C1 — Mme Pinto — 1<sup>er</sup> étage — App C ».</div>
      ) : (
        <div className="tbl-wrap" style={{ marginBottom: '1.6rem' }}>
          <table className="tbl">
            <thead><tr><th>Lot</th><th>Étage</th><th>Porte</th><th>Occupant</th><th>Contact</th><th>Statut</th><th></th></tr></thead>
            <tbody>
              {b.units.map((u) => (
                <tr key={u.id}>
                  <td className="mono">{u.label}</td>
                  <td>{u.floor ?? '—'}</td>
                  <td>{u.door ?? '—'}</td>
                  <td>{u.occupantName ?? '—'}</td>
                  <td>
                    {u.occupantPhone && <a href={`tel:${u.occupantPhone}`}>{u.occupantPhone}</a>}
                    {u.occupantPhone && u.occupantEmail && <br />}
                    {u.occupantEmail && <span className="muted" style={{ fontSize: '0.82rem' }}>{u.occupantEmail}</span>}
                    {!u.occupantPhone && !u.occupantEmail && '—'}
                  </td>
                  <td>{u.occupantKind ? OCCUPANT_KIND_LABEL[u.occupantKind as keyof typeof OCCUPANT_KIND_LABEL] : '—'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn ghost" style={mini} onClick={() => setModal({ kind: 'unit', row: u })}>Modifier</button>
                    <button className="btn ghost" style={mini} onClick={async () => { if (confirm('Supprimer ?')) { await api(`/api/buildings/${id}/units/${u.id}`, { method: 'DELETE' }); reload(); } }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Interventions */}
      <div className="section-title">Interventions <span className="hint">{b.worksites.length}</span></div>
      {b.worksites.length === 0 ? (
        <div className="card card-pad muted">Aucune intervention.</div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Réf</th><th>Objet</th><th>Chef</th><th>Statut</th><th>Devis / factures</th><th style={{ textAlign: 'right' }}>Devisé</th><th>Fin</th></tr></thead>
            <tbody>
              {b.worksites.map((w) => (
                <tr key={w.id}>
                  <td className="mono">{w.ref}</td>
                  <td><Link href={`/app/chantiers/${w.id}`}>{w.title}</Link></td>
                  <td>{w.manager?.displayName ?? w.manager?.firstName ?? '—'}</td>
                  <td><StatusBadge status={w.status} /></td>
                  <td>
                    {w.documents.length === 0 ? <span className="muted">—</span> : w.documents.map((doc) => (
                      <Link key={doc.id} href={`/app/documents/${doc.id}`} className="mono" style={{ display: 'inline-block', marginRight: 10, fontSize: '0.8rem' }}>{doc.number}</Link>
                    ))}
                  </td>
                  <td style={{ textAlign: 'right' }}><Money value={w.quotedHt} /></td>
                  <td className="tnum">{w.endedOn ? formatDateBE(w.endedOn) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal?.kind === 'building' && (
        <FormModal
          title="Modifier l’immeuble"
          fields={buildingFields(pick?.syndics ?? [], pick?.clients ?? [])}
          initial={{ ...(b as unknown as Record<string, unknown>), syndicId: b.syndic?.id, clientId: b.client?.id }}
          onClose={() => setModal(null)}
          onSubmit={async (v) => { await api(`/api/buildings/${id}`, { method: 'PATCH', body: v }); closeAndReload(); }}
        />
      )}
      {modal?.kind === 'contact' && (
        <FormModal
          title={modal.row ? 'Modifier le contact' : 'Nouveau contact'}
          fields={CONTACT_FIELDS}
          initial={(modal.row as unknown as Record<string, unknown>) ?? { role: 'concierge' }}
          onClose={() => setModal(null)}
          onSubmit={async (v) => {
            const path = modal.row ? `/api/buildings/${id}/contacts/${(modal.row as BContact).id}` : `/api/buildings/${id}/contacts`;
            await api(path, { method: modal.row ? 'PATCH' : 'POST', body: v });
            closeAndReload();
          }}
        />
      )}
      {modal?.kind === 'unit' && (
        <FormModal
          title={modal.row ? 'Modifier le lot' : 'Nouveau lot'}
          fields={UNIT_FIELDS}
          initial={(modal.row as unknown as Record<string, unknown>) ?? {}}
          onClose={() => setModal(null)}
          onSubmit={async (v) => {
            const path = modal.row ? `/api/buildings/${id}/units/${(modal.row as BUnit).id}` : `/api/buildings/${id}/units`;
            await api(path, { method: modal.row ? 'PATCH' : 'POST', body: v });
            closeAndReload();
          }}
        />
      )}
    </>
  );
}

const mini: React.CSSProperties = { padding: '0.15rem 0.45rem', fontSize: '0.75rem', minWidth: 0 };

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="info-cell">
      <div className="k">{label}</div>
      <div className="v">{value}</div>
    </div>
  );
}
