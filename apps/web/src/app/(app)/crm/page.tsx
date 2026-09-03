'use client';
import { useState } from 'react';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, Money, formatDateBE, stageLabel } from '@/lib/ui';
import { CRM_STAGES } from '@jjd/shared';

interface Opp {
  id: string; title: string; stage: string; estimatedValue: number | null;
  source: string | null; nextActionOn: string | null; nextActionNote: string | null;
  contact: { name: string } | null;
  building: { name: string } | null;
}

export default function CrmPage() {
  const { data, loading, reload } = useApi<{ columns: { stage: string; items: Opp[] }[] }>('/api/crm');
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await api('/api/crm', { method: 'POST', body: { title: title.trim(), stage: 'new' } });
    setTitle('');
    setCreating(false);
    reload();
  }

  async function move(id: string, stage: string) {
    await api(`/api/crm/${id}`, { method: 'PATCH', body: { stage } });
    reload();
  }

  const stages = CRM_STAGES.filter((s) => s !== 'won' && s !== 'lost');

  return (
    <>
      <PageHead
        title="CRM / Pipeline"
        sub="Suivi des demandes jusqu'au devis"
        action={<button className="btn primary" onClick={() => setCreating((v) => !v)}>+ Opportunité</button>}
      />
      {creating && (
        <form className="card card-pad row" style={{ marginBottom: '1rem' }} onSubmit={create}>
          <input className="input" style={{ maxWidth: 360 }} placeholder="Objet de la demande…" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          <button className="btn primary" type="submit">Créer</button>
        </form>
      )}
      {loading && <div className="empty">Chargement…</div>}
      {data && (
        <div className="kanban">
          {data.columns.map((col) => (
            <div key={col.stage} className="kanban-col">
              <h3>{stageLabel(col.stage)}<span>{col.items.length}</span></h3>
              {col.items.map((o) => {
                const idx = stages.indexOf(col.stage as (typeof stages)[number]);
                const overdue = o.nextActionOn && new Date(o.nextActionOn).getTime() < Date.now();
                return (
                  <div key={o.id} className="kanban-card">
                    <div className="title">{o.title}</div>
                    <div className="meta">
                      <span>{o.contact?.name ?? o.building?.name ?? '—'}</span>
                      {o.estimatedValue != null && <span><Money value={o.estimatedValue} /></span>}
                    </div>
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
          ))}
        </div>
      )}
    </>
  );
}
