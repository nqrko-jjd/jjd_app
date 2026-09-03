'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, StatusBadge, EntityBadge, Money, formatDateBE } from '@/lib/ui';
import { FormModal, toDateInput, type FieldDef } from '@/components/FormModal';
import { WORKSITE_STATUSES, WORKSITE_STATUS_LABEL, ENTITIES, ENTITY_LABEL, type WorksiteMargin } from '@jjd/shared';

interface Detail {
  worksite: {
    id: string; ref: string; title: string; status: string; statusRaw: string | null;
    entity: string; address: string | null; city: string | null; billTo: string | null;
    startedOn: string | null; endedOn: string | null; quotedHt: number | null; description: string | null;
    client: { id: string; name: string } | null;
    building: { id: string; name: string; syndic: { name: string } | null } | null;
    manager: { displayName: string | null; firstName: string } | null;
    documents: { id: string; kind: string; number: string; totalHt: number; status: string; issuedOn: string | null }[];
    events: { id: string; startAt: string; endAt: string; vehicle: { plate: string | null } | null; assignments: { person: { displayName: string | null; firstName: string } }[] }[];
  };
  margin: WorksiteMargin | null;
}

export default function ChantierDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, loading, reload } = useApi<Detail>(`/api/worksites/${id}`);
  const [editing, setEditing] = useState(false);

  if (loading) return <div className="empty">Chargement…</div>;
  if (!data) return <div className="empty">Chantier introuvable.</div>;
  const w = data.worksite;

  const editFields: FieldDef[] = [
    { name: 'title', label: 'Intitulé', required: true, full: true },
    { name: 'entity', label: 'Entité', type: 'select', options: ENTITIES.map((e) => ({ value: e, label: ENTITY_LABEL[e] })) },
    { name: 'status', label: 'Statut', type: 'select', options: WORKSITE_STATUSES.map((s) => ({ value: s, label: WORKSITE_STATUS_LABEL[s] })) },
    { name: 'address', label: 'Adresse', full: true },
    { name: 'postalCode', label: 'Code postal' },
    { name: 'city', label: 'Ville' },
    { name: 'startedOn', label: 'Début', type: 'date' },
    { name: 'endedOn', label: 'Fin', type: 'date' },
    { name: 'quotedHt', label: 'Total devisé HT', type: 'number' },
    { name: 'description', label: 'Description', type: 'textarea', full: true },
  ];

  return (
    <>
      {editing && (
        <FormModal
          title={`Modifier ${w.ref}`}
          fields={editFields}
          initial={{
            title: w.title, entity: w.entity, status: w.status,
            address: w.address, city: w.city,
            startedOn: toDateInput(w.startedOn), endedOn: toDateInput(w.endedOn),
            quotedHt: w.quotedHt, description: w.description,
          }}
          onClose={() => setEditing(false)}
          onSubmit={async (v) => { await api(`/api/worksites/${id}`, { method: 'PATCH', body: v }); reload(); }}
        />
      )}
      <PageHead
        title={w.title}
        sub={`${w.ref} · ${[w.address, w.city].filter(Boolean).join(', ') || 'adresse non renseignée'}`}
        action={
          <div className="row">
            <button className="btn" onClick={() => setEditing(true)}>Modifier</button>
            <Link href="/chantiers" className="btn">← Chantiers</Link>
          </div>
        }
      />

      <div className="row" style={{ marginBottom: '1.2rem' }}>
        <StatusBadge status={w.status} />
        <EntityBadge entity={w.entity} />
        {w.statusRaw && w.statusRaw !== w.status && <span className="chip">{w.statusRaw}</span>}
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', marginBottom: '1.4rem' }}>
        <Info label="Client" value={w.client ? <Link href={`/contacts/${w.client.id}`}>{w.client.name}</Link> : '—'} />
        <Info label="Immeuble / ACP" value={w.building ? <Link href={`/immeubles/${w.building.id}`}>{w.building.name}{w.building.syndic ? ` · ${w.building.syndic.name}` : ''}</Link> : '—'} />
        <Info label="Chef de chantier" value={w.manager?.displayName ?? w.manager?.firstName ?? '—'} />
        <Info label="Facturé à" value={w.billTo ?? '—'} />
        <Info label="Début" value={formatDateBE(w.startedOn)} />
        <Info label="Fin" value={formatDateBE(w.endedOn)} />
      </div>

      {data.margin && (
        <section className="card card-pad" style={{ marginBottom: '1.4rem' }}>
          <h2 style={{ marginBottom: '0.8rem' }}>Rentabilité <span className="muted" style={{ fontSize: '0.78rem' }}>— temps réel, main-d'œuvre incluse</span></h2>
          <div className="kpis">
            <MiniKpi label="Devisé HT" value={<Money value={data.margin.quotedHt} />} />
            <MiniKpi label="Facturé HT" value={<Money value={data.margin.invoicedHt} />} />
            <MiniKpi label="Encaissé HT" value={<Money value={data.margin.paidHt} />} />
            <MiniKpi label="Coût matériaux" value={<Money value={data.margin.materialCost} />} />
            <MiniKpi label="Coût main-d'œuvre" value={<Money value={data.margin.labourCost} />} />
            <MiniKpi label="Marge réelle" value={<Money value={data.margin.realMargin} sign />} note={data.margin.realMarginPct != null ? `${data.margin.realMarginPct} %` : undefined} />
            <MiniKpi label="Reste à facturer" value={<Money value={data.margin.leftToInvoice} />} />
            {data.margin.partnerShare > 0 && <MiniKpi label="Part GT (33 %)" value={<Money value={data.margin.partnerShare} />} />}
          </div>
        </section>
      )}

      {w.description && (
        <section className="card card-pad" style={{ marginBottom: '1.4rem' }}>
          <div className="eyebrow" style={{ marginBottom: '0.4rem' }}>Description</div>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{w.description}</p>
        </section>
      )}

      <section style={{ marginBottom: '1.4rem' }}>
        <h2 style={{ marginBottom: '0.7rem' }}>Documents ({w.documents.length})</h2>
        {w.documents.length === 0 ? (
          <div className="card card-pad muted">Aucun devis / facture rattaché (import TrustUp à venir).</div>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Type</th><th>Numéro</th><th>Date</th><th style={{ textAlign: 'right' }}>HT</th><th>Statut</th></tr></thead>
              <tbody>
                {w.documents.map((d) => (
                  <tr key={d.id}>
                    <td>{d.kind}</td><td className="mono">{d.number}</td><td className="tnum">{formatDateBE(d.issuedOn)}</td>
                    <td style={{ textAlign: 'right' }}><Money value={d.totalHt} /></td><td>{d.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="card card-pad">
      <div className="eyebrow">{label}</div>
      <div style={{ marginTop: '0.3rem', fontWeight: 500 }}>{value}</div>
    </div>
  );
}
function MiniKpi({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value" style={{ fontSize: '1.05rem' }}>{value}</div>
      {note && <div className="muted" style={{ fontSize: '0.74rem' }}>{note}</div>}
    </div>
  );
}
