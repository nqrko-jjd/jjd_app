'use client';
import { useMemo, useState } from 'react';
import { SkeletonRows, ErrorState, EmptyState } from '@/components/States';
import { useApi } from '@/lib/use-api';
import { PageHead } from '@/lib/ui';
import { ClipboardList } from 'lucide-react';

interface Row { id: string; at: string; who: string; whoId: string | null; role: string | null; action: string; entity: string; entityId: string | null; meta: { method?: string; path?: string; status?: number; fields?: string[] } | null }
interface Resp { items: Row[]; actors: { id: string; name: string }[]; entities: string[] }

const ENTITY: Record<string, string> = {
  worksites: 'Chantier', contacts: 'Contact', buildings: 'Immeuble', people: 'Personne', crm: 'Pipeline', documents: 'Devis / facture', progress: 'État d’avancement', reminders: 'Relance',
  vehicles: 'Flotte', equipment: 'Matériel', consumables: 'Consommables', planning: 'Planning', teams: 'Équipe', absences: 'Absence', timesheet: 'Pointage', statements: 'Décompte',
  finance: 'Finances', stock: 'Stock', 'stock-orders': 'Commande fournisseur', purchasing: 'Achats', 'purchase-lists': 'Liste d’achat', settings: 'Paramètres', users: 'Comptes',
  messagerie: 'Messagerie', reports: 'Rapport', tasks: 'Tâche', phases: 'Phase', materiel: 'Matériel', pv: 'PV', cdc: 'Cahier des charges', 'quote-tools': 'Outils devis', 'price-items': 'Bibliothèque de prix', imports: 'Import', worksite: 'Chantier',
};
const VERB: Record<string, string> = { POST: 'Ajout / action', PUT: 'Modification', PATCH: 'Modification', DELETE: 'Suppression' };
const label = (r: Row) => ENTITY[r.entity] ?? r.entity;
const isId = (s: string) => /^c[a-z0-9]{20,}$/.test(s) || /^\d+$/.test(s);
/** « Ajout / action · Pointage · approve » : le dernier mot du chemin (sauf identifiant) dit l'action précise. */
function what(r: Row) {
  if (r.action !== 'http') return `${r.action.replace(/[._]/g, ' ')} · ${label(r)}`;
  const segs = (r.meta?.path ?? '').split('/').filter(Boolean).slice(2).filter((s) => !isId(s));
  const verb = VERB[r.meta?.method ?? ''] ?? 'Action';
  return `${verb} · ${label(r)}${segs.length ? ` · ${segs.join(' / ')}` : ''}`;
}
const when = (iso: string) => new Intl.DateTimeFormat('fr-BE', { timeZone: 'Europe/Brussels', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** Journal d'activité : qui a fait quoi dans le logiciel (réservé à David). */
export default function JournalPage() {
  const [days, setDays] = useState(7);
  const [actorId, setActorId] = useState('');
  const [entity, setEntity] = useState('');
  const [q, setQ] = useState('');
  const qs = useMemo(() => new URLSearchParams({ days: String(days), ...(actorId ? { actorId } : {}), ...(entity ? { entity } : {}) }).toString(), [days, actorId, entity]);
  const { data, loading, error, reload } = useApi<Resp>(`/api/journal?${qs}`);
  const rows = (data?.items ?? []).filter((r) => !q.trim() || `${r.who} ${what(r)} ${(r.meta?.fields ?? []).join(' ')} ${r.meta?.path ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <>
      <PageHead eyebrow="Administration" title="Journal d’activité" sub="Qui a fait quoi dans le logiciel : ajouts, modifications, suppressions. Visible par toi seul." />
      <div className="row" style={{ gap: '0.7rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'center' }}>
        <select className="select" style={{ width: 'auto' }} value={actorId} onChange={(e) => setActorId(e.target.value)} aria-label="Personne">
          <option value="">Tout le monde</option>
          {(data?.actors ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select className="select" style={{ width: 'auto' }} value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Domaine">
          <option value="">Tous les domaines</option>
          {(data?.entities ?? []).map((x) => <option key={x} value={x}>{ENTITY[x] ?? x}</option>)}
        </select>
        <select className="select" style={{ width: 'auto' }} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Période">
          <option value={1}>Aujourd’hui</option><option value={7}>7 jours</option><option value={31}>31 jours</option><option value={90}>90 jours</option>
        </select>
        <input className="input" style={{ maxWidth: 240 }} placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="hint">{rows.length} action{rows.length > 1 ? 's' : ''}{(data?.items.length ?? 0) >= 1000 ? ' (les 1000 plus récentes)' : ''}</span>
      </div>
      {loading && !data && <SkeletonRows />}
      {error && !loading && <ErrorState message={error} onRetry={reload} />}
      {data && rows.length === 0 && <EmptyState icon={ClipboardList} title="Rien à afficher" text="Aucune action enregistrée pour ces filtres. Le journal se remplit à partir de sa mise en service." />}
      {rows.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Quand</th><th>Qui</th><th>Quoi</th><th>Champs modifiés</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} title={r.meta?.path}>
                  <td className="tnum" style={{ whiteSpace: 'nowrap' }}>{when(r.at)}</td>
                  <td>{r.who}{r.role ? <span className="muted" style={{ fontSize: '0.74rem' }}> · {r.role}</span> : null}</td>
                  <td>{what(r)}</td>
                  <td className="muted" style={{ fontSize: '0.78rem' }}>{r.meta?.fields?.join(', ') ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
