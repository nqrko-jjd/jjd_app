'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, Money, formatDateBE, stageLabel } from '@/lib/ui';
import { FormModal, type FieldDef } from '@/components/FormModal';
import { CRM_STAGES } from '@jjd/shared';
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
}

export default function CrmPage() {
  return (
    <Suspense fallback={<div className="empty">Chargement…</div>}>
      <CrmInner />
    </Suspense>
  );
}

function CrmInner() {
  const sp = useSearchParams();
  const { data, loading, reload } = useApi<{ columns: { stage: string; items: Opp[] }[] }>('/api/crm');
  const [creating, setCreating] = useState(sp.get('new') === '1');

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
      {loading && <div className="empty">Chargement…</div>}
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
                  <div key={o.id} className="kanban-card">
                    {(o.contact?.name ?? o.acp?.name) && <div className="eyebrow-mini">{o.contact?.name ?? o.acp?.name}</div>}
                    <div className="title">{o.title}</div>
                    {o.estimatedValue != null && <div className="amount"><Money value={o.estimatedValue} /></div>}
                    {o.nextActionOn && (
                      <div className={overdue ? 'badge crit' : 'badge'} style={{ marginTop: '0.4rem', fontSize: '0.7rem' }}>
                        {formatDateBE(o.nextActionOn)}{o.nextActionNote ? ` · ${o.nextActionNote}` : ''}
                      </div>
                    )}
                    <div className="row" style={{ marginTop: '0.5rem', gap: '0.3rem' }}>
                      {idx > 0 && <button className="btn" style={{ padding: '0.2rem 0.4rem', fontSize: '0.75rem' }} onClick={() => move(o.id, stages[idx - 1]!)}>←</button>}
                      {idx < stages.length - 1 && <button className="btn" style={{ padding: '0.2rem 0.4rem', fontSize: '0.75rem' }} onClick={() => move(o.id, stages[idx + 1]!)}>→</button>}
                      <button className="btn" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={() => move(o.id, 'won')}>Gagné</button>
                      <button className="btn" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={() => move(o.id, 'lost')}>Perdu</button>
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
