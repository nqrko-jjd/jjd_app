'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, StatusBadge, PriorityBadge, EntityBadge, Money, formatDateBE } from '@/lib/ui';
import { FormModal, toDateInput, type FieldDef } from '@/components/FormModal';
import { ChantierThread } from '@/components/ChantierThread';
import { WorksiteTasks } from '@/components/WorksiteTasks';
import { CollapsibleSection } from '@/components/CollapsibleSection';
import { Donut } from '@/lib/charts';
import { WORKSITE_STATUSES, WORKSITE_STATUS_LABEL, WORKSITE_PRIORITIES, WORKSITE_PRIORITY_LABEL, ENTITIES, ENTITY_LABEL, formatHours, type WorksiteMargin } from '@jjd/shared';

interface Detail {
  worksite: {
    id: string; ref: string; title: string; status: string; priority: string; statusRaw: string | null;
    entity: string; address: string | null; city: string | null; billTo: string | null;
    lat: number | null; lng: number | null; geoSetAt: string | null;
    startedOn: string | null; endedOn: string | null; quotedHt: number | null; description: string | null;
    client: { id: string; name: string } | null;
    building: { id: string; name: string; syndic: { name: string } | null } | null;
    manager: { id: string; displayName: string | null; firstName: string } | null;
    documents: { id: string; kind: string; number: string | null; draftRef: string | null; totalHt: number; status: string; issuedOn: string | null }[];
    events: { id: string; startAt: string; endAt: string; vehicle: { plate: string | null } | null; assignments: { person: { displayName: string | null; firstName: string } }[] }[];
    reports: {
      id: string; date: string; authorName: string; workDone: string | null; status: string;
      clientName: string | null; signedAt: string | null;
      photos: { id: string; thumbUrl: string | null; url: string }[];
    }[];
  };
  margin: (WorksiteMargin & {
    transport: {
      cost: number; fuelCost: number; fixedCost: number; note: string | null; oneWayKm: number | null;
      trips: { date: string; vehicleLabel: string; roundTripKm: number; fuelCost: number; fixedCost: number; cost: number }[];
    };
    labour: { date: string; personId: string; personName: string; hours: number; amount: number; pending: boolean }[];
  }) | null;
}

export default function ChantierDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, loading, reload } = useApi<Detail>(`/api/worksites/${id}`);
  const { data: pick } = useApi<{
    clients: { id: string; name: string }[];
    buildings: { id: string; name: string }[];
    people: { id: string; name: string }[];
  }>('/api/meta/pickers');
  const [editing, setEditing] = useState(false);
  const [invoicing, setInvoicing] = useState<string | null>(null);

  if (loading) return <div className="empty">Chargement…</div>;
  if (!data) return <div className="empty">Chantier introuvable.</div>;
  const w = data.worksite;

  /** Raccourci « Facturer » depuis un rapport signé : ouvre une facture pré-remplie
   * (chantier, client, texte de départ repris du rapport) — le bureau chiffre les lignes. */
  async function invoiceFromReport(r: Detail['worksite']['reports'][number]) {
    setInvoicing(r.id);
    try {
      const { document } = await api<{ document: { id: string } }>('/api/documents', { method: 'POST', body: { kind: 'invoice' } });
      await api(`/api/documents/${document.id}`, {
        method: 'PATCH',
        body: {
          worksiteId: w.id,
          contactId: w.client?.id ?? null,
          title: `Intervention du ${formatDateBE(r.date)}`,
          intro: r.workDone ?? undefined,
        },
      });
      router.push(`/app/documents/${document.id}`);
    } finally {
      setInvoicing(null);
    }
  }

  const editFields: FieldDef[] = [
    { name: 'title', label: 'Intitulé', required: true, full: true },
    { name: 'clientId', label: 'Client', type: 'select', options: (pick?.clients ?? []).map((c) => ({ value: c.id, label: c.name })) },
    { name: 'buildingId', label: 'Immeuble / ACP', type: 'select', options: (pick?.buildings ?? []).map((b) => ({ value: b.id, label: b.name })) },
    { name: 'managerId', label: 'Chef de chantier', type: 'select', options: (pick?.people ?? []).map((p) => ({ value: p.id, label: p.name })) },
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
            title: w.title, clientId: w.client?.id ?? '', buildingId: w.building?.id ?? '', managerId: w.manager?.id ?? '',
            entity: w.entity, status: w.status, priority: w.priority,
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
            {data.margin && (
              <a href={`/imprimer/chantier/${id}`} target="_blank" rel="noreferrer" className="btn">
                Résumé facturation →
              </a>
            )}
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
            <MiniKpi
              label="Coût véhicule"
              value={<Money value={data.margin.vehicleCost} />}
              note={data.margin.transport.trips.length
                ? `${data.margin.transport.trips.length} j · fixe ${data.margin.transport.fixedCost.toFixed(0)} € + route ${data.margin.transport.fuelCost.toFixed(0)} €`
                : undefined}
            />
            <MiniKpi label="Marge réelle" value={<Money value={data.margin.realMargin} sign />} note={data.margin.realMarginPct != null ? `${data.margin.realMarginPct} %` : undefined} />
            <MiniKpi label="Marge hypothétique" value={<Money value={data.margin.forecastMargin} sign />} note="devisé − coûts engagés" />
            <MiniKpi label="Reste à facturer" value={<Money value={data.margin.leftToInvoice} />} />
            {data.margin.partnerShare > 0 && <MiniKpi label="Part GT (33 %)" value={<Money value={data.margin.partnerShare} />} />}
          </div>
          <TransportDetail t={data.margin.transport} />
          <LabourDetail rows={data.margin.labour} />
          <div className="row" style={{ gap: '1.2rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
            {data.margin.totalCost > 0 && (
              <div className="card card-pad" style={{ maxWidth: 420 }}>
                <div className="eyebrow" style={{ marginBottom: '0.6rem' }}>Répartition des coûts</div>
                <Donut
                  data={[
                    { label: 'Matériaux', total: data.margin.materialCost },
                    { label: "Main-d'œuvre", total: data.margin.labourCost },
                    { label: 'Véhicule', total: data.margin.vehicleCost },
                  ].filter((d) => d.total > 0)}
                />
              </div>
            )}
            {data.margin.quotedHt > 0 && (
              <div className="card card-pad" style={{ maxWidth: 420 }}>
                <div className="eyebrow" style={{ marginBottom: '0.6rem' }}>
                  Avancement <span className="hint">{Math.round((data.margin.invoicedHt / data.margin.quotedHt) * 100)}% facturé</span>
                </div>
                <Donut
                  data={[
                    { label: 'Facturé', total: data.margin.invoicedHt },
                    { label: 'Reste à facturer', total: Math.max(0, data.margin.leftToInvoice) },
                  ].filter((d) => d.total > 0)}
                />
              </div>
            )}
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
              <div className="row" style={{ gap: '0.4rem', marginTop: '0.6rem' }}>
                <a className="btn" style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }} href={`/rapport/${r.id}`} target="_blank" rel="noreferrer">Voir / imprimer →</a>
                {r.status === 'signed' && (
                  <button
                    className="btn primary"
                    style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }}
                    disabled={invoicing === r.id}
                    onClick={() => invoiceFromReport(r)}
                    title="Ouvre une nouvelle facture pré-remplie (chantier, client) pour ce chantier"
                  >
                    {invoicing === r.id ? 'Création…' : 'Facturer →'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="section-title">Fil de chantier</div>
      <div style={{ marginBottom: '1.5rem' }}><ChantierThread worksiteId={w.id} /></div>

      <CollapsibleSection
        title="Devis & factures"
        summary={w.documents.length ? `${w.documents.length} · ${formatEuro(w.documents.reduce((s, d) => s + d.totalHt, 0))} HT` : 'Aucun'}
      >
        {data.margin && data.margin.quotedHt > 0 && (
          <InvoicedProgress invoicedHt={data.margin.invoicedHt} quotedHt={data.margin.quotedHt} />
        )}
        {w.documents.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Aucun devis / facture rattaché.</p>
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
        <Link href="/app/documents" className="btn" style={{ marginTop: '0.7rem', padding: '0.2rem 0.6rem', fontSize: '0.78rem' }}>Tous les documents →</Link>
      </CollapsibleSection>

      <WorksiteExpenses worksiteId={w.id} />
    </>
  );
}

/** Barre « facturé vs devisé », sous la table Devis & factures (le donut « Avancement » en résume l'essentiel plus haut). */
function InvoicedProgress({ invoicedHt, quotedHt }: { invoicedHt: number; quotedHt: number }) {
  const pct = Math.max(0, Math.round((invoicedHt / quotedHt) * 100));
  return (
    <div style={{ marginBottom: '1rem' }}>
      <div className="row" style={{ justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.3rem' }}>
        <span className="muted">Facturé à ce jour</span>
        <strong>{formatEuro(invoicedHt)} / {formatEuro(quotedHt)} devisé · {pct}%</strong>
      </div>
      <div className="progress-bar">
        <div className={`progress-fill${pct > 100 ? ' over' : ''}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

interface WsExpense {
  id: string; date: string | null; docNumber: string | null; supplier: string | null;
  categoryLabel: string | null; ht: number; ttc: number | null; paid: boolean; hasPdf: boolean;
}

function WorksiteExpenses({ worksiteId }: { worksiteId: string }) {
  const { data } = useApi<{ items: WsExpense[]; totals: { ht: number; ttc: number; unpaidTtc: number } }>(
    `/api/finance/expenses?worksiteId=${worksiteId}`,
  );
  return (
    <CollapsibleSection
      title="Dépenses"
      summary={data ? `${data.items.length} · ${formatEuro(data.totals.ht)} HT` : undefined}
    >
      {!data ? <p className="muted" style={{ margin: 0 }}>Chargement…</p>
        : data.items.length === 0 ? <p className="muted" style={{ margin: 0 }}>Aucune facture d’achat rattachée à ce chantier.</p>
        : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Date</th><th>Fournisseur</th><th>Catégorie</th><th style={{ textAlign: 'right' }}>HT</th><th style={{ textAlign: 'right' }}>TTC</th><th>Statut</th></tr></thead>
              <tbody>
                {data.items.map((e) => (
                  <tr key={e.id}>
                    <td className="tnum">{formatDateBE(e.date)}</td>
                    <td>{e.supplier ?? '—'} {e.hasPdf && '📎'}</td>
                    <td>{e.categoryLabel ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}><Money value={e.ht} /></td>
                    <td style={{ textAlign: 'right' }}><Money value={e.ttc ?? e.ht} /></td>
                    <td><span className={`badge ${e.paid ? 'ok' : 'warn'}`}>{e.paid ? 'Payé' : 'Non payé'}</span></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={3}>Total</td><td style={{ textAlign: 'right' }}><Money value={data.totals.ht} /></td><td style={{ textAlign: 'right' }}><Money value={data.totals.ttc} /></td><td /></tr></tfoot>
            </table>
          </div>
        )}
      <Link href="/app/achats" className="btn" style={{ marginTop: '0.7rem', padding: '0.2rem 0.6rem', fontSize: '0.78rem' }}>Toutes les dépenses →</Link>
    </CollapsibleSection>
  );
}

function formatEuro(n: number): string {
  return new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
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
  const [manual, setManual] = useState(false);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
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

  function useMyPosition() {
    if (!navigator.geolocation) { setMsg('Géolocalisation non disponible sur cet appareil.'); return; }
    setBusy(true); setMsg(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await api(`/api/worksites/${w.id}/geo`, {
            method: 'PATCH',
            body: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          });
          setMsg('Point GPS enregistré à partir de ta position actuelle.');
          onChange();
        } catch (e) {
          setMsg((e as Error).message);
        } finally {
          setBusy(false);
        }
      },
      (e) => { setMsg(`Position refusée ou indisponible (${e.message}).`); setBusy(false); },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function saveManual() {
    const la = Number(lat.replace(',', '.'));
    const lo = Number(lng.replace(',', '.'));
    if (!Number.isFinite(la) || !Number.isFinite(lo)) { setMsg('Coordonnées invalides.'); return; }
    setBusy(true); setMsg(null);
    try {
      await api(`/api/worksites/${w.id}/geo`, { method: 'PATCH', body: { lat: la, lng: lo } });
      setMsg('Point GPS enregistré.');
      setManual(false); setLat(''); setLng('');
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
            <div className="muted" style={{ fontSize: '0.88rem' }}>
              Aucun point GPS. Géolocalise l’adresse, enregistre ta position, ou il sera fixé au premier pointage sur place.
            </div>
          )}
          {msg && <div style={{ fontSize: '0.82rem', marginTop: '0.4rem', color: 'var(--ink-2)' }}>{msg}</div>}
        </div>
        <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
          <button className="btn" disabled={busy} onClick={useMyPosition} style={{ padding: '0.25rem 0.7rem', fontSize: '0.8rem' }}>
            {busy ? '…' : '📍 Utiliser ma position actuelle'}
          </button>
          <button className="btn" disabled={busy || !hasAddr} onClick={geocode} style={{ padding: '0.25rem 0.7rem', fontSize: '0.8rem' }}>
            {busy ? '…' : 'Géolocaliser l’adresse'}
          </button>
          <button className="btn ghost" disabled={busy} onClick={() => setManual((v) => !v)} style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }}>
            {manual ? 'Annuler' : 'Saisir des coordonnées'}
          </button>
          {w.lat != null && (
            <button className="btn ghost" style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }}
              onClick={async () => { if (confirm('Réinitialiser le point GPS ?')) { await api(`/api/worksites/${w.id}/geo`, { method: 'PATCH', body: { clear: true } }); onChange(); } }}>
              Réinitialiser
            </button>
          )}
        </div>
      </div>
      {manual && (
        <div className="row" style={{ marginTop: '0.7rem', gap: '0.4rem', alignItems: 'center' }}>
          <input className="input" style={{ maxWidth: 160 }} placeholder="Latitude" value={lat} onChange={(e) => setLat(e.target.value)} />
          <input className="input" style={{ maxWidth: 160 }} placeholder="Longitude" value={lng} onChange={(e) => setLng(e.target.value)} />
          <button className="btn primary" disabled={busy || !lat || !lng} onClick={saveManual} style={{ padding: '0.25rem 0.7rem', fontSize: '0.8rem' }}>Enregistrer</button>
        </div>
      )}
    </div>
  );
}

function TransportDetail({ t }: { t: NonNullable<Detail['margin']>['transport'] }) {
  if (!t.trips.length) {
    return t.note
      ? <p className="hint" style={{ marginTop: '-0.8rem', marginBottom: '1.5rem' }}>Transport : {t.note}</p>
      : null;
  }
  return (
    <CollapsibleSection
      icon="🚐"
      title="Détail transport"
      hint={t.note ?? undefined}
      summary={`${t.trips.length} trajet${t.trips.length > 1 ? 's' : ''} · ${new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(t.cost)}`}
    >
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Date</th><th>Véhicule</th><th style={{ textAlign: 'right' }}>Km A/R</th><th style={{ textAlign: 'right' }}>Route</th><th style={{ textAlign: 'right' }}>Fixe/jour</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
          <tbody>
            {t.trips.map((tr, i) => (
              <tr key={i}>
                <td className="tnum">{formatDateBE(tr.date)}</td>
                <td>{tr.vehicleLabel}</td>
                <td className="tnum" style={{ textAlign: 'right' }}>{tr.roundTripKm || '—'}</td>
                <td style={{ textAlign: 'right' }}><Money value={tr.fuelCost} /></td>
                <td style={{ textAlign: 'right' }}><Money value={tr.fixedCost} /></td>
                <td style={{ textAlign: 'right' }}><Money value={tr.cost} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleSection>
  );
}

function LabourDetail({ rows }: { rows: NonNullable<Detail['margin']>['labour'] }) {
  if (!rows.length) return null;
  const totalHours = rows.reduce((s, r) => s + r.hours, 0);
  const totalAmount = rows.reduce((s, r) => s + r.amount, 0);
  const days = new Set(rows.map((r) => r.date)).size;
  return (
    <CollapsibleSection
      icon="👷"
      title="Détail main-d'œuvre"
      summary={`${days} jour${days > 1 ? 's' : ''} · ${formatHours(totalHours)} · ${new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(totalAmount)}`}
    >
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Date</th><th>Ouvrier</th><th style={{ textAlign: 'right' }}>Heures</th><th style={{ textAlign: 'right' }}>Montant</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.date}|${r.personId}`}>
                <td className="tnum">{formatDateBE(r.date)}</td>
                <td>{r.personName}</td>
                <td className="tnum" style={{ textAlign: 'right' }}>{formatHours(r.hours)}</td>
                <td style={{ textAlign: 'right' }}><Money value={r.amount} /></td>
                <td>{r.pending && <span className="badge warn" style={{ fontSize: '0.72rem' }}>à valider</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleSection>
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
