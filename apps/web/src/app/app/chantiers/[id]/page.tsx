'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, StatusBadge, PriorityBadge, EntityBadge, Money, formatDateBE } from '@/lib/ui';
import { FormModal, toDateInput, type FieldDef } from '@/components/FormModal';
import { ChantierThread } from '@/components/ChantierThread';
import { WorksiteTasks } from '@/components/WorksiteTasks';
import { WORKSITE_STATUSES, WORKSITE_STATUS_LABEL, WORKSITE_PRIORITIES, WORKSITE_PRIORITY_LABEL, ENTITIES, ENTITY_LABEL, type WorksiteMargin } from '@jjd/shared';

interface Detail {
  worksite: {
    id: string; ref: string; title: string; status: string; priority: string; statusRaw: string | null;
    entity: string; address: string | null; city: string | null; billTo: string | null;
    lat: number | null; lng: number | null; geoSetAt: string | null;
    startedOn: string | null; endedOn: string | null; quotedHt: number | null; description: string | null;
    client: { id: string; name: string } | null;
    building: { id: string; name: string; syndic: { name: string } | null } | null;
    manager: { displayName: string | null; firstName: string } | null;
    documents: { id: string; kind: string; number: string | null; draftRef: string | null; totalHt: number; status: string; issuedOn: string | null }[];
    events: { id: string; startAt: string; endAt: string; vehicle: { plate: string | null } | null; assignments: { person: { displayName: string | null; firstName: string } }[] }[];
    reports: {
      id: string; date: string; authorName: string; workDone: string | null; status: string;
      clientName: string | null; signedAt: string | null;
      photos: { id: string; thumbUrl: string | null; url: string }[];
    }[];
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
    { name: 'priority', label: 'Priorité', type: 'select', options: WORKSITE_PRIORITIES.map((p) => ({ value: p, label: WORKSITE_PRIORITY_LABEL[p] })) },
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
            title: w.title, entity: w.entity, status: w.status, priority: w.priority,
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
            <Link href="/app/chantiers" className="btn">← Chantiers</Link>
          </div>
        }
      />

      <div className="row" style={{ marginBottom: '1.2rem' }}>
        <StatusBadge status={w.status} />
        <PriorityBadge priority={w.priority} />
        <EntityBadge entity={w.entity} />
        {w.statusRaw && w.statusRaw !== w.status && <span className="chip">{w.statusRaw}</span>}
      </div>

      <div className="info-grid" style={{ marginBottom: '1.5rem' }}>
        <Info label="Client" value={w.client ? <Link href={`/app/contacts/${w.client.id}`}>{w.client.name}</Link> : '—'} />
        <Info label="Immeuble / ACP" value={w.building ? <Link href={`/app/immeubles/${w.building.id}`}>{w.building.name}{w.building.syndic ? ` · ${w.building.syndic.name}` : ''}</Link> : '—'} />
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

      <div className="section-title">Tâches</div>
      <div style={{ marginBottom: '1.5rem' }}><WorksiteTasks worksiteId={w.id} /></div>

      <div className="section-title">Localisation <span className="hint">carte &amp; contrôle de pointage</span></div>
      <LocationSection w={w} onChange={reload} />

      <div className="section-title">Rapports d’intervention <span className="hint">{w.reports.length}</span></div>
      {w.reports.length === 0 ? (
        <div className="card card-pad muted" style={{ marginBottom: '1.5rem' }}>Aucun rapport. Les ouvriers les créent depuis l’app mobile.</div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', marginBottom: '1.5rem' }}>
          {w.reports.map((r) => (
            <div key={r.id} className="card card-pad">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{formatDateBE(r.date)}</strong>
                {r.status === 'signed'
                  ? <span className="badge ok">Signé{r.clientName ? ` · ${r.clientName}` : ''}</span>
                  : <span className="badge warn">Brouillon</span>}
              </div>
              <div className="muted" style={{ fontSize: '0.82rem' }}>par {r.authorName}</div>
              {r.workDone && <p style={{ fontSize: '0.88rem', margin: '0.4rem 0 0', whiteSpace: 'pre-wrap' }}>{r.workDone.slice(0, 160)}</p>}
              {r.photos.length > 0 && (
                <div style={{ display: 'flex', gap: 4, marginTop: '0.5rem', flexWrap: 'wrap' }}>
                  {r.photos.slice(0, 4).map((p) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={p.id} src={p.thumbUrl ?? p.url} alt="" style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--line)' }} />
                  ))}
                  {r.photos.length > 4 && <span className="muted" style={{ fontSize: '0.8rem', alignSelf: 'center' }}>+{r.photos.length - 4}</span>}
                </div>
              )}
              <a className="btn" style={{ marginTop: '0.6rem', padding: '0.25rem 0.6rem', fontSize: '0.78rem' }} href={`/rapport/${r.id}`} target="_blank" rel="noreferrer">Voir / imprimer →</a>
            </div>
          ))}
        </div>
      )}

      <div className="section-title">Fil de chantier</div>
      <div style={{ marginBottom: '1.5rem' }}><ChantierThread worksiteId={w.id} /></div>

      <div className="section-title">
        Devis &amp; factures <span className="hint">{w.documents.length}</span>
        <Link href="/app/documents" className="btn" style={{ marginLeft: 'auto', padding: '0.2rem 0.6rem', fontSize: '0.78rem' }}>Tous les documents →</Link>
      </div>
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
                  <td className="mono"><Link href={`/app/documents/${d.id}`}>{d.number ?? d.draftRef ?? '—'}</Link></td>
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

function LocationSection({ w, onChange }: { w: Detail['worksite']; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const hasAddr = !!(w.address || w.city);

  async function geocode() {
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ matched: string }>(`/api/worksites/${w.id}/geocode`, { method: 'POST' });
      setMsg(`Adresse trouvée : ${r.matched}`);
      onChange();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const bbox = w.lat != null && w.lng != null
    ? `${w.lng - 0.004},${w.lat - 0.002},${w.lng + 0.004},${w.lat + 0.002}`
    : null;

  return (
    <div className="card card-pad" style={{ marginBottom: '1.5rem' }}>
      {bbox && (
        <iframe
          title="Carte du chantier"
          style={{ width: '100%', height: 260, border: '1px solid var(--line)', borderRadius: 10, marginBottom: '0.8rem' }}
          src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${w.lat},${w.lng}`}
        />
      )}
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.6rem' }}>
        <div>
          {w.lat != null && w.lng != null ? (
            <>
              <div>Point GPS {w.geoSetAt ? `— ${formatDateBE(w.geoSetAt)}` : ''} · <a href={`https://www.google.com/maps?q=${w.lat},${w.lng}`} target="_blank" rel="noreferrer">{w.lat.toFixed(5)}, {w.lng.toFixed(5)}</a></div>
              <div className="muted" style={{ fontSize: '0.82rem' }}>Sert de référence au contrôle de pointage.</div>
            </>
          ) : (
            <div className="muted" style={{ fontSize: '0.88rem' }}>Aucun point GPS. Géolocalise l’adresse, ou il sera fixé au premier pointage sur place.</div>
          )}
          {msg && <div style={{ fontSize: '0.82rem', marginTop: '0.4rem', color: 'var(--ink-2)' }}>{msg}</div>}
        </div>
        <div className="row" style={{ gap: '0.4rem' }}>
          <button className="btn" disabled={busy || !hasAddr} onClick={geocode} style={{ padding: '0.25rem 0.7rem', fontSize: '0.8rem' }}>
            {busy ? '…' : 'Géolocaliser l’adresse'}
          </button>
          {w.lat != null && (
            <button className="btn ghost" style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }}
              onClick={async () => { if (confirm('Réinitialiser le point GPS ?')) { await api(`/api/worksites/${w.id}/geo`, { method: 'PATCH', body: { clear: true } }); onChange(); } }}>
              Réinitialiser
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

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
