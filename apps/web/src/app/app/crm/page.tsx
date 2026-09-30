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
  // posée automatiquement par la détection IA sur la boîte mail — jamais choisie à la main ;
  // listée ici pour que le formulaire d'édition l'affiche correctement (pas de valeur "orpheline").
  { value: 'email-ia', label: '🤖 Détectée par mail (IA)' },
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
  const [actionError, setActionError] = useState('');
  const [moving, setMoving] = useState<string | null>(null);

  async function move(id: string, stage: string) {
    if(moving)return;
    setMoving(id);setActionError('');
    try { await api(`/api/crm/${id}`, { method: 'PATCH', body: { stage } }); reload(); }
    catch(e){setActionError(e instanceof Error?e.message:'Impossible de changer l’étape.');}
    finally{setMoving(null);}
  }

  const stages = CRM_STAGES.filter((s) => s !== 'won' && s !== 'lost');

  const oppFields: FieldDef[] = [
    { name: 'title', label: 'Objet de la demande', required: true, full: true, placeholder: 'ex. Rénover une salle de bains' },
    { name: 'contactId', label: 'Client', type: 'contact', contactTypeFilter: 'client', placeholder: 'Nom du client…' },
    { name: 'acpId', label: 'Immeuble / ACP / projet (optionnel)', type: 'contact', contactTypeFilter: 'client', contactKindFilter: ['acp', 'developer'], placeholder: 'Nom de l’immeuble…' },
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
      {actionError && <p className="state error" role="alert">{actionError}</p>}
      {error && !loading && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <div className="kanban crm-board">
          {data.columns.map((col) => {
            const total = col.items.reduce((s, o) => s + (o.estimatedValue ?? 0), 0);
            return (
            <div key={col.stage} className="kanban-col">
              <h3>{stageLabel(col.stage)}<span>{col.items.length}</span></h3>
              {total > 0 && <div className="total"><Money value={total} /></div>}
              {col.items.map((o) => {
                const overdue = o.nextActionOn && new Date(o.nextActionOn).getTime() < Date.now();
                return (
                  <div key={o.id} className="kanban-card" aria-busy={moving===o.id}>
                    {(o.contact?.name ?? o.acp?.name) && <div className="eyebrow-mini">{o.contact?.name ?? o.acp?.name}</div>}
                    <button type="button" className="crm-card-title" onClick={() => setEditing(o)}>{o.title}</button>
                    {o.source === 'email-ia' && (
                      <span className="badge plain" style={{ fontSize: '0.68rem', marginTop: '0.2rem' }} title="Créée automatiquement depuis un mail par l'IA — à vérifier avant de la traiter comme confirmée">
                        🤖 Détectée par mail, à vérifier
                      </span>
                    )}
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
                    <label className="crm-stage-label">Étape<select className="select" aria-label={`Étape : ${o.title}`} disabled={moving!==null} value={o.stage} onChange={e=>move(o.id,e.target.value)}>{CRM_STAGES.map(stage=><option key={stage} value={stage}>{stageLabel(stage)}</option>)}</select></label>
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
