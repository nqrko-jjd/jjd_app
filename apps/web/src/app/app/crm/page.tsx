'use client';
import { SkeletonRows, ErrorState } from '@/components/States';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, Money, formatDateBE, stageLabel } from '@/lib/ui';
import { FormModal, type FieldDef } from '@/components/FormModal';
import { CRM_STAGES, INTERVENTION_PROBLEM_TYPES, INTERVENTION_PROBLEM_TYPE_LABEL } from '@jjd/shared';
import { Plus } from 'lucide-react';

const CRM_SOURCE_OPTIONS = [
  { value: 'Appel', label: 'Appel' },
  { value: 'E-mail', label: 'E-mail' },
  { value: 'Client existant', label: 'Client existant' },
  { value: 'Recommandation', label: 'Recommandation' },
  { value: 'Site internet', label: 'Site internet' },
];

interface Opp {
  id: string; title: string; stage: string; estimatedValue: number | null;
  source: string | null; nextActionOn: string | null; nextActionNote: string | null;
  contact: { name: string } | null;
  acp: { name: string } | null;
  problemType: string | null; unitLabel: string | null; urgent: boolean;
  onSiteContactName: string | null; onSiteContactPhone: string | null;
  accessNotes: string | null; visitPreference: string | null;
  note: string | null;
  photos: { id: string; url: string; thumbUrl: string | null }[];
}

export default function CrmPage() {
  return (
    <Suspense fallback={<SkeletonRows />}>
      <CrmInner />
    </Suspense>
  );
}

function CrmInner() {
  const sp = useSearchParams();
  const { data, loading, error, reload } = useApi<{ columns: { stage: string; items: Opp[] }[] }>('/api/crm');
  const [creating, setCreating] = useState(sp.get('new') === '1');
  const [editing, setEditing] = useState<Opp | null>(null);

  async function move(id: string, stage: string) {
    await api(`/api/crm/${id}`, { method: 'PATCH', body: { stage } });
    reload();
  }

  const stages = CRM_STAGES.filter((s) => s !== 'won' && s !== 'lost');

  const oppFields: FieldDef[] = [
    { name: 'title', label: 'Objet de la demande', required: true, full: true, placeholder: 'ex. Rénover une salle de bains' },
    { name: 'contactId', label: 'Client', type: 'contact', contactTypeFilter: 'client', placeholder: 'Nom du client…' },
    { name: 'acpId', label: 'Immeuble / ACP (si syndic)', type: 'contact', contactTypeFilter: 'client', contactKindFilter: ['acp', 'developer'], placeholder: 'Nom de l’immeuble…' },
    { name: 'estimatedValue', label: 'Budget estimé HT (€)', type: 'number', placeholder: 'si connu' },
    { name: 'source', label: 'Origine', type: 'select', options: CRM_SOURCE_OPTIONS },
    { name: 'stage', label: 'Étape', type: 'select', options: stages.map((s) => ({ value: s, label: stageLabel(s) })) },
    { name: 'nextActionOn', label: 'Date de prochaine action', type: 'date' },
    { name: 'nextActionNote', label: 'Prochaine action', placeholder: 'ex. Rappeler pour confirmer le rendez-vous' },
    { name: 'note', label: 'Besoin et points à clarifier', type: 'textarea', full: true },
    { name: 'problemType', label: 'Type de problème', type: 'select', options: INTERVENTION_PROBLEM_TYPES.map((t) => ({ value: t, label: INTERVENTION_PROBLEM_TYPE_LABEL[t] })) },
    { name: 'unitLabel', label: 'Lot / appartement / zone' },
    { name: 'urgent', label: 'Urgent', type: 'checkbox' },
    { name: 'onSiteContactName', label: 'Contact sur place' },
    { name: 'onSiteContactPhone', label: 'Téléphone sur place' },
    { name: 'accessNotes', label: 'Consignes d’accès', type: 'textarea' },
    { name: 'visitPreference', label: 'Préférence de passage' },
  ];

  return (
    <>
      <PageHead
        eyebrow="Commercial"
        title="CRM / Pipeline"
        sub="Suivi des demandes jusqu'au devis"
        action={<button className="btn primary" onClick={() => setCreating(true)}><Plus size={15} strokeWidth={2} /> Nouvelle opportunité</button>}
      />
      {creating && (
        <FormModal
          title="Nouvelle opportunité"
          fields={oppFields}
          initial={{ stage: 'new' }}
          onClose={() => setCreating(false)}
          onSubmit={async (v) => {
            await api('/api/crm', { method: 'POST', body: v });
            reload();
          }}
        />
      )}
      {editing && (
        <FormModal
          title={editing.title}
          fields={oppFields}
          initial={editing as unknown as Record<string, unknown>}
          onClose={() => setEditing(null)}
          onSubmit={async (v) => {
            await api(`/api/crm/${editing.id}`, { method: 'PATCH', body: v });
            reload();
          }}
        />
      )}
      {loading && <SkeletonRows />}
      {error && !loading && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <div className="kanban">
          {data.columns.map((col) => {
            const total = col.items.reduce((s, o) => s + (o.estimatedValue ?? 0), 0);
            return (
            <div key={col.stage} className="kanban-col">
              <h3>{stageLabel(col.stage)}<span>{col.items.length}</span></h3>
              {total > 0 && <div className="total"><Money value={total} /></div>}
              {col.items.map((o) => {
                const idx = stages.indexOf(col.stage as (typeof stages)[number]);
                const overdue = o.nextActionOn && new Date(o.nextActionOn).getTime() < Date.now();
                return (
                  <div key={o.id} className="kanban-card" style={{ cursor: 'pointer' }} onClick={() => setEditing(o)}>
                    {(o.contact?.name ?? o.acp?.name) && <div className="eyebrow-mini">{o.contact?.name ?? o.acp?.name}</div>}
                    <div className="title">{o.title}</div>
                    {(o.urgent || o.problemType || o.unitLabel) && (
                      <div className="row" style={{ gap: '0.3rem', flexWrap: 'wrap', marginTop: '0.3rem' }}>
                        {o.urgent && <span className="badge crit" style={{ fontSize: '0.68rem' }}>Urgent</span>}
                        {o.problemType && (
                          <span className="badge" style={{ fontSize: '0.68rem' }}>
                            {INTERVENTION_PROBLEM_TYPE_LABEL[o.problemType as keyof typeof INTERVENTION_PROBLEM_TYPE_LABEL] ?? o.problemType}
                          </span>
                        )}
                        {o.unitLabel && <span className="badge" style={{ fontSize: '0.68rem' }}>{o.unitLabel}</span>}
                      </div>
                    )}
                    {o.estimatedValue != null && <div className="amount"><Money value={o.estimatedValue} /></div>}
                    {o.nextActionOn && (
                      <div className={overdue ? 'badge crit' : 'badge'} style={{ marginTop: '0.4rem', fontSize: '0.7rem' }}>
                        {formatDateBE(o.nextActionOn)}{o.nextActionNote ? ` · ${o.nextActionNote}` : ''}
                      </div>
                    )}
                    {o.photos.length > 0 && (
                      <div className="row" style={{ gap: '0.3rem', marginTop: '0.4rem' }}>
                        {o.photos.slice(0, 3).map((p) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={p.id} src={p.thumbUrl ?? p.url} alt="" style={{ width: 30, height: 30, borderRadius: 6, objectFit: 'cover', border: '1px solid var(--line)' }} />
                        ))}
                        {o.photos.length > 3 && <span className="muted" style={{ fontSize: '0.72rem', alignSelf: 'center' }}>+{o.photos.length - 3}</span>}
                      </div>
                    )}
                    <div className="row" style={{ marginTop: '0.5rem', gap: '0.3rem' }}>
                      {idx > 0 && <button className="btn" style={{ padding: '0.2rem 0.4rem', fontSize: '0.75rem' }} onClick={(e) => { e.stopPropagation(); move(o.id, stages[idx - 1]!); }}>←</button>}
                      {idx < stages.length - 1 && <button className="btn" style={{ padding: '0.2rem 0.4rem', fontSize: '0.75rem' }} onClick={(e) => { e.stopPropagation(); move(o.id, stages[idx + 1]!); }}>→</button>}
                      <button className="btn" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={(e) => { e.stopPropagation(); move(o.id, 'won'); }}>Gagné</button>
                      <button className="btn" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={(e) => { e.stopPropagation(); move(o.id, 'lost'); }}>Perdu</button>
                    </div>
                  </div>
                );
              })}
            </div>
            );
          })}
        </div>
      )}
    </>
  );
}
