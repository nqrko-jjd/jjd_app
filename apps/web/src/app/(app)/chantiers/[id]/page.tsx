'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, StatusBadge, EntityBadge, Money, formatDateBE } from '@/lib/ui';
import { FormModal, toDateInput, type FieldDef } from '@/components/FormModal';
import { ChantierThread } from '@/components/ChantierThread';
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

      <div className="info-grid" style={{ marginBottom: '1.5rem' }}>
        <Info label="Client" value={w.client ? <Link href={`/contacts/${w.client.id}`}>{w.client.name}</Link> : '—'} />
        <Info label="Immeuble / ACP" value={w.building ? <Link href={`/immeubles/${w.building.id}`}>{w.building.name}{w.building.syndic ? ` · ${w.building.syndic.name}` : ''}</Link> : '—'} />
        <Info label="Chef de chantier" value={w.manager?.displayName ?? w.manager?.firstName ?? '—'} />
        <Info label="Facturé à" value={w.billTo ?? '—'} />
        <Info label="Début" value={formatDateBE(w.startedOn)} />
        <Info label="Fin" value={formatDateBE(w.endedOn)} />
      </div>

      {data.margin && (
        <>
          <div className="section-title">Rentabilité <span className="hint">temps réel, main-d'œuvre incluse</span></div>
          <div className="kpis" style={{ marginBottom: '1.5rem' }}>
            <MiniKpi label="Devisé HT" value={<Money value={data.margin.quotedHt} />} />
            <MiniKpi label="Facturé HT" value={<Money value={data.margin.invoicedHt} />} />
            <MiniKpi label="Encaissé HT" value={<Money value={data.margin.paidHt} />} />
            <MiniKpi label="Coût matériaux" value={<Money value={data.margin.materialCost} />} />
            <MiniKpi label="Coût main-d'œuvre" value={<Money value={data.margin.labourCost} />} />
            <MiniKpi label="Marge réelle" value={<Money value={data.margin.realMargin} sign />} note={data.margin.realMarginPct != null ? `${data.margin.realMarginPct} %` : undefined} />
            <MiniKpi label="Reste à facturer" value={<Money value={data.margin.leftToInvoice} />} />
            {data.margin.partnerShare > 0 && <MiniKpi label="Part GT (33 %)" value={<Money value={data.margin.partnerShare} />} />}
          </div>
        </>
      )}

      {w.description && (
        <section className="card card-pad" style={{ marginBottom: '1.5rem' }}>
          <div className="eyebrow" style={{ marginBottom: '0.4rem' }}>Description</div>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{w.description}</p>
        </section>
      )}

      <div className="section-title">Fil de chantier</div>
      <div style={{ marginBottom: '1.5rem' }}><ChantierThread worksiteId={w.id} /></div>

      <div className="section-title">Devis &amp; factures <span className="hint">{w.documents.length}</span></div>
      {w.documents.length === 0 ? (
        <div className="card card-pad muted">Aucun devis / facture rattaché.</div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Type</th><th>Numéro</th><th>Date</th><th style={{ textAlign: 'right' }}>HT</th><th>Statut</th></tr></thead>
            <tbody>
              {w.documents.map((d) => (
                <tr key={d.id}>
                  <td>{DOC_KIND[d.kind] ?? d.kind}</td>
                  <td className="mono">{d.number}</td>
                  <td className="tnum">{formatDateBE(d.issuedOn)}</td>
                  <td style={{ textAlign: 'right' }}><Money value={d.totalHt} /></td>
                  <td><span className={`badge ${DOC_TONE[d.status] ?? ''}`}>{DOC_STATUS[d.status] ?? d.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

const DOC_KIND: Record<string, string> = { quote: 'Devis', invoice: 'Facture', credit_note: 'Note de crédit', deposit_invoice: 'Acompte' };
const DOC_STATUS: Record<string, string> = {
  draft: 'Brouillon', sent: 'Envoyé', accepted: 'Accepté', declined: 'Décliné', expired: 'Expiré',
  paid: 'Payé', partial: 'Partiel', overdue: 'En retard', credited: 'Annulé',
};
const DOC_TONE: Record<string, string> = {
  paid: 'ok', accepted: 'ok', sent: 'primary', overdue: 'crit', declined: 'crit', partial: 'warn',
};

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="info-cell">
      <div className="k">{label}</div>
      <div className="v">{value}</div>
    </div>
  );
}
function MiniKpi({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value" style={{ fontSize: '1.1rem' }}>{value}</div>
      {note && <div className="sub">{note}</div>}
    </div>
  );
}
