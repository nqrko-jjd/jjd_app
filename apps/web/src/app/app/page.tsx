'use client';
import { tr, dateLocale } from '@/lib/ui-language';
import PreparationsPage from './stock/preparations/page';
import { SkeletonRows, ErrorState, EmptyState } from '@/components/States';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { DashboardMyTasks } from '@/components/DashboardMyTasks';
import { PageHead, Money, formatDateBE, Avatar, ProgressCell, Kpi } from '@/lib/ui';
import { rowNav } from '@/lib/rowNav';
import { LEGAL_DOC_LABEL, WORKSITE_STATUS_LABEL, WORKSITE_PROGRESS_PCT, type WorksiteStatus } from '@jjd/shared';
import {
  BarChart3, Wallet, Building2, Flag, FileText, Clock, MessageSquare, Users,
  Eye, Search, Bell, ChevronRight, AlertTriangle, Receipt, Mail, Phone, ShieldAlert, ShieldCheck, Truck, HardHat, CreditCard, TrendingUp, type LucideIcon,
} from 'lucide-react';

interface TodayEv {
  id: string; startAt: string; endAt: string;
  worksite: { id: string; ref: string; title: string; city: string | null; acp: { photoThumbUrl: string | null } | null };
}
interface Running { id: string; startedAt: string; worksite: { ref: string; title: string } | null }
interface TimerResp { running: Running | null; linked?: boolean }
interface WorkerTask { id: string; title: string; status: string; assignees: { id: string; name: string }[] }

function elapsed(fromIso: string): string {
  const ms = Math.max(0, Date.now() - new Date(fromIso).getTime());
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { timeout: 5000 },
    );
  });
}

function WorkerToday() {
  const { person } = useAuth();
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  const { data: plan, loading: planLoading, error: planError, reload: reloadPlan } = useApi<{ items: TodayEv[] }>(
    person ? `/api/planning?from=${from}&to=${to}&personId=${person.id}` : null,
  );
  const { data: timer, loading: timerLoading, error: timerError, reload: reloadTimer } = useApi<TimerResp>('/api/timesheet/timer');
  const [timerBusy, setTimerBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force((x) => x + 1), 1000); return () => clearInterval(t); }, []);

  // Un seul chantier aujourd'hui : on peut mettre en avant ses raccourcis (rapport, équipe,
  // tâches) directement ici, comme la maquette — avec plusieurs chantiers, ambigu, on laisse
  // l'ouvrier ouvrir la fiche du chantier concerné.
  const singleWs = plan?.items.length === 1 ? plan.items[0]!.worksite : null;
  const { data: taskData, reload: reloadTasks } = useApi<{ items: WorkerTask[] }>(singleWs ? `/api/worksites/${singleWs.id}/tasks` : null);
  const [taskBusy, setTaskBusy] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState<'all' | 'todo' | 'done'>('all');
  const tasks = taskData?.items ?? [];
  const tasksDone = tasks.filter((t) => t.status === 'done').length;
  const visibleTasks = tasks.filter((t) => taskFilter === 'all' || (taskFilter === 'done' ? t.status === 'done' : t.status !== 'done'));

  async function toggleTask(t: WorkerTask) {
    setTaskBusy(t.id);
    try { await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { status: t.status === 'done' ? 'todo' : 'done' } }); await reloadTasks(); }
    catch(e) { setActionError(e instanceof Error ? e.message : 'La tâche n’a pas pu être enregistrée.'); }
    finally { setTaskBusy(null); }
  }

  async function start(worksiteId: string) {
    if (timerBusy) return;
    setTimerBusy(true); setActionError(null);
    try {
    const pos = await currentPosition();
    const r = await api<{ geoFlag?: boolean; geoDistance?: number; geoInit?: boolean }>('/api/timesheet/timer/start', {
      method: 'POST',
      body: { worksiteId, startedAt: new Date().toISOString(), lat: pos?.lat ?? null, lng: pos?.lng ?? null },
    });
    reloadTimer();
    if (!pos) {
      alert('Position non transmise (géolocalisation refusée ou indisponible) — le pointage n’a pas pu être vérifié.');
    } else if (r.geoInit) {
      alert('Aucun point de référence n’était encore enregistré pour ce chantier : ta position actuelle vient de le devenir.');
    } else if (r.geoFlag) {
      alert(`Pointage hors zone : tu es à environ ${r.geoDistance} m du chantier. Le pointage est enregistré mais sera vérifié par le bureau.`);
    }
    } catch(e) { setActionError(e instanceof Error ? e.message : 'Le pointage n’a pas pu démarrer.'); }
    finally { setTimerBusy(false); }
  }
  async function stop() {
    if (timerBusy) return;
    setTimerBusy(true); setActionError(null);
    try { await api('/api/timesheet/timer/stop', { method: 'POST', body: { endedAt: new Date().toISOString() } }); reloadTimer(); reloadPlan(); }
    catch(e) { setActionError(e instanceof Error ? e.message : 'Le pointage n’a pas pu être arrêté.'); }
    finally { setTimerBusy(false); }
  }

  const running = timer?.running ?? null;
  const linked = timer?.linked !== false;

  return (
    <>
      <PageHead eyebrow={tr("Mon espace ouvrier")} title={`Bonjour ${person?.displayName || person?.firstName || ''},`} sub={now.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })} />

      {actionError && <p className="banner crit" role="alert">{actionError}</p>}
      {timerError && <ErrorState message={timerError} onRetry={reloadTimer}/>}
      {planError && <ErrorState message={planError} onRetry={reloadPlan}/>}
      {timerLoading && !timer && <SkeletonRows rows={1} height={180}/>}
      {!timerLoading && !timerError && !linked && (
        <div className="card card-pad" style={{ borderColor: 'var(--warn)', borderWidth: 2 }}>
          <div className="muted">Ton compte n’est pas encore lié à ta fiche ouvrier. Demande au bureau de le faire (Équipe → « Lier à un compte »). En attendant, tu ne peux pas pointer.</div>
        </div>
      )}

      {timer && linked && !timerError && (running ? (
        <div className="detail-hero worker-clock" style={{ marginBottom: '1.2rem' }}>
          <div className="eyebrow"><span className="worker-live-dot" /> {tr("Sur chantier")}</div>
          <div style={{ fontWeight: 700, fontSize: '1.1rem', margin: '0.2rem 0', color: '#fff' }}>{running.worksite?.ref} — {running.worksite?.title}</div>
          <div className="mono" style={{ fontSize: '2.6rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', margin: '0.4rem 0', color: '#fff' }}>{elapsed(running.startedAt)}</div>
          <div className="row" style={{ gap: '0.6rem' }}>
            <button className="btn" style={{ background: 'var(--crit)', color: '#fff', borderColor: 'var(--crit)' }} disabled={timerBusy} onClick={stop}>{timerBusy ? tr("Enregistrement…") : tr("Je quitte le chantier")}</button>
            <Link href="/app/mes-heures" className="btn" style={{ background: 'rgba(255,255,255,0.1)', borderColor: 'rgba(255,255,255,0.25)', color: '#fff' }}>{tr("Mes heures →")}</Link>
          </div>
        </div>
      ) : (
        <div className="detail-hero worker-clock" style={{ marginBottom: '1.2rem' }}>
          <div className="eyebrow">{singleWs ? tr("Prêt pour le chantier") : tr("Mon pointage")}</div>
          <div className="mono" style={{ fontSize: '2.6rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', margin: '0.4rem 0', color: '#fff' }}>00:00:00</div>
          {linked && singleWs ? (
            <>
              <div className="sub">{singleWs.ref} · {singleWs.title}</div>
              <button className="btn gold" style={{ marginTop: '0.8rem' }} disabled={timerBusy} onClick={() => start(singleWs.id)}> {tr("Je suis arrivé sur chantier")} </button>
            </>
          ) : (
            <div className="sub">{plan?.items.length ? tr("Pointe à ton arrivée sur le chantier, puis à ton départ.") : tr("Aucun chantier prévu aujourd’hui. Retrouve tes affectations dans Mes chantiers.")}</div>
          )}
        </div>
      ))}

      <div className="section-title">{tr("Mes chantiers du jour")}</div>
      {planLoading && !plan && <SkeletonRows rows={2} height={100}/>}
      {!planLoading && !planError && plan?.items.length === 0 && <div className="card card-pad worker-day-empty"><span className="worker-empty-icon"><HardHat size={24} /></span><strong>{tr("Pas de chantier prévu aujourd’hui")}</strong><p className="muted">{tr("Si ton affectation a changé, vérifie tes chantiers ou contacte le bureau.")}</p><Link className="btn" href="/app/mes-chantiers">{tr("Voir mes chantiers")} <ChevronRight size={16}/></Link></div>}
      {plan?.items.map((e) => (
        <div key={e.id} className="card worker-mission" style={{ marginBottom: '0.7rem', overflow: 'hidden' }}>
          {e.worksite.acp?.photoThumbUrl && (
            <div style={{ height: 160 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={e.worksite.acp.photoThumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          )}
          <div className="card-pad">
            <div className="eyebrow">{e.worksite.ref}</div><h2 className="worker-mission-title">{e.worksite.title}</h2>
            {e.worksite.city && <div className="muted">{e.worksite.city}</div>}
            <div className="muted">
              {new Date(e.startAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })} – {new Date(e.endAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div className="row" style={{ gap: '0.5rem', marginTop: '0.6rem' }}>
              {linked && !running && (
                <button className="btn primary" style={{ flex: 1 }} disabled={timerBusy} onClick={() => start(e.worksite.id)}>{tr("Je suis arrivé")}</button>
              )}
              <Link href={`/app/fiche/${e.worksite.id}`} className="btn" style={{ flex: 1, textAlign: 'center' }}>{tr("Fiche du jour ›")}</Link>
            </div>
          </div>
        </div>
      ))}

      {singleWs && (
        <div className="quick-actions">
          <Link href={`/app/fiche/${singleWs.id}/rapport`} className="quick-action">
            <span className="ic"><FileText size={20} strokeWidth={2} /></span>
            <span>
              <strong>{tr("Faire mon rapport")}</strong>
              <small>{tr("Travaux, photos et remarques")}</small>
            </span>
          </Link>
          <Link href={`/app/fiche/${singleWs.id}#fil-chantier`} className="quick-action">
            <span className="ic"><MessageSquare size={20} strokeWidth={2} /></span>
            <span>
              <strong>{tr("Contacter l’équipe")}</strong>
              <small>{tr("Échanger sur ce chantier")}</small>
            </span>
          </Link>
        </div>
      )}

      {singleWs && tasks.length > 0 && (
        <>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div className="section-title" style={{ marginBottom: 0 }}>{tr("Mes tâches du jour")}</div>
            <span className="muted" style={{ fontSize: '0.82rem' }}>{tasksDone} / {tasks.length} terminées</span>
          </div>
          <div className="row" style={{ gap: '0.4rem', margin: '0.5rem 0 0.7rem' }}>
            {([['all', 'Toutes'], ['todo', 'À faire'], ['done', 'Terminées']] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`btn${taskFilter === key ? ' primary' : ''}`}
                style={{ borderRadius: 999, padding: '0.3rem 0.8rem', fontSize: '0.82rem' }}
                onClick={() => setTaskFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="card card-pad" style={{ marginBottom: '1.2rem' }}>
            {visibleTasks.length === 0 && <div className="muted" style={{ padding: '0.4rem 0' }}>Rien ici.</div>}
            {visibleTasks.map((t) => (
              <div
                key={t.id}
                onClick={() => taskBusy !== t.id && toggleTask(t)}
                style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.45rem 0', cursor: 'pointer', opacity: taskBusy === t.id ? 0.5 : 1 }}
              >
                <span style={{
                  width: 20, height: 20, borderRadius: 5, border: `2px solid ${t.status === 'done' ? 'var(--ok)' : 'var(--line)'}`,
                  background: t.status === 'done' ? 'var(--ok)' : 'transparent', color: '#fff', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 800, flexShrink: 0,
                }}>
                  {t.status === 'done' ? '✓' : ''}
                </span>
                <span style={{ textDecoration: t.status === 'done' ? 'line-through' : 'none', color: t.status === 'done' ? 'var(--ink-3)' : 'var(--ink)' }}>
                  {t.title}{t.assignees.length > 0 ? ` · ${t.assignees.map((a) => a.name).join(', ')}` : ''}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

interface ForemanWorksite {
  id: string; ref: string; title: string; city: string | null; status: string;
  building: { name: string } | null;
}
interface TeamMember { id: string; name: string; worksite: { id: string; ref: string; title: string } }
interface ReviewReport { id: string; reviewStatus: string }

function ForemanToday() {
  const router = useRouter();
  const { person } = useAuth();
  const { data: ws } = useApi<{ items: ForemanWorksite[] }>('/api/worksites?status=to_plan,scheduled,in_progress&pageSize=100');
  const { data: team } = useApi<{ items: TeamMember[] }>('/api/people/team');
  const { data: pending } = useApi<{ items: unknown[] }>('/api/timesheet/pending');
  const { data: reports } = useApi<{ items: ReviewReport[] }>('/api/reports/review-queue');
  const worksites = ws?.items ?? [];
  const teamItems = team?.items ?? [];
  const chantiersAujourdhui = new Set(teamItems.map((t) => t.worksite.id)).size;
  const pendingCount = pending?.items.length ?? 0;
  const reportsToReview = (reports?.items ?? []).filter((r) => r.reviewStatus !== 'approved').length;

  return (
    <>
      <div className="eyebrow" style={{ marginBottom: '0.3rem' }}>Espace chef de chantier</div>
      <PageHead title={`Bonjour ${person?.displayName || person?.firstName || ''},`} sub="L’essentiel pour coordonner votre équipe." />

      <div className="kpis">
        <Kpi
          ic={Users}
          label="Sur le terrain"
          value={`${teamItems.length} personne${teamItems.length > 1 ? 's' : ''}`}
          sub={chantiersAujourdhui > 0 ? `${chantiersAujourdhui} chantier${chantiersAujourdhui > 1 ? 's' : ''} aujourd’hui` : 'Rien de planifié aujourd’hui'}
          hero
        />
        <Kpi ic={FileText} label="Rapports à valider" value={reportsToReview} sub="Retours des ouvriers" warn={reportsToReview > 0} />
        <Kpi ic={Clock} label="Pointages à valider" value={pendingCount} sub="Heures de la semaine" warn={pendingCount > 0} />
      </div>

      <div className="quick-actions">
        <Link href="/app/mon-equipe" className="quick-action">
          <span className="ic"><Users size={20} strokeWidth={2} /></span>
          <span><strong>{tr("Mon équipe")}</strong><small>Affectations du jour</small></span>
        </Link>
        <Link href="/app/rapports" className="quick-action">
          <span className="ic"><FileText size={20} strokeWidth={2} /></span>
          <span><strong>Valider les rapports</strong><small>Suivi du terrain</small></span>
        </Link>
        <Link href="/app/pointage" className="quick-action">
          <span className="ic"><Clock size={20} strokeWidth={2} /></span>
          <span><strong>Vérifier les heures</strong><small>Relevé des collaborateurs</small></span>
        </Link>
      </div>

      <div className="row" style={{ justifyContent: 'space-between', margin: '1.8rem 0 0.8rem' }}>
        <div className="section-title" style={{ margin: 0 }}>{tr("Mes chantiers")} <span className="hint">{worksites.length}</span></div>
        <Link href="/app/planning" className="hint">Voir le planning →</Link>
      </div>
      {worksites.length === 0 ? (
        <div className="card card-pad muted">Aucun chantier ne vous est assigné pour le moment.</div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>{tr("Chantier")}</th>
                <th>Statut</th>
                <th>Avancement</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {worksites.map((w) => (
                <tr key={w.id} className="row-link" onClick={rowNav(`/app/chantiers/${w.id}`, (h) => router.push(h))}>
                  <td>
                    <Link href={`/app/chantiers/${w.id}`}>{w.title}</Link>
                    <div className="muted" style={{ fontSize: '0.78rem' }}>{w.ref}{w.city ? ` · ${w.city}` : ''}{w.building ? ` · ${w.building.name}` : ''}</div>
                  </td>
                  <td><span className={`badge ${WS_STATUS_TONE[w.status] ?? ''}`}>{WORKSITE_STATUS_LABEL[w.status as keyof typeof WORKSITE_STATUS_LABEL] ?? w.status}</span></td>
                  <td><ProgressCell pct={WORKSITE_PROGRESS_PCT[w.status as WorksiteStatus] ?? 0} /></td>
                  <td className="muted">→</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

interface Dashboard {
  kpis: {
    invoicedMonth: number; invoicedPrevMonth: number; paidMonth: number; overdueAmount: number;
    overdueCount: number; supplierOverdueAmount: number; supplierOverdueCount: number;
    openWorksites: number; onHoldWorksites: number; teamsOnSiteToday: number;
    receivableAmount: number; quotesPendingAmount: number; quotesPendingCount: number;
    forecastAmount: number; forecastCount: number;
  };
  alerts: { kind: string; severity: string; label: string; count: number; amount?: number; href: string }[];
  inProgress: { id: string; ref: string; title: string; city: string | null; status: string; client: string | null; manager: string | null; photoThumbUrl: string | null }[];
  expiringDocs: { id: string; person: string; type: string; label: string | null; expiresOn: string | null }[];
  fieldToday: FieldEvent[];
}

interface FieldEvent {
  id: string; startAt: string; endAt: string; allDay: boolean; tentative: boolean;
  worksite: { id: string; ref: string; title: string; city: string | null };
  team: string | null;
  people: { id: string; name: string; state: 'running' | 'done' | 'none' }[];
}

const ALERT_KIND_ICON: Record<string, LucideIcon> = {
  forecast_to_invoice: Receipt,
  overdue_invoices: AlertTriangle, overdue_supplier_invoices: CreditCard, to_invoice: Receipt, quotes_follow: Mail,
  crm_due: Phone, expiring_docs: ShieldAlert, ct_expiring: Truck, on_hold: Eye, planned_time: Clock,
};

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });

/** Barre d'en-tête 76px du tableau de bord bureau : recherche, notifications, compte. */
function DashBar() {
  const router = useRouter();
  const { user, person } = useAuth();
  const [q, setQ] = useState('');
  const { data: unread } = useApi<{ internal: number; client: number }>('/api/messagerie/unread-count');
  const unreadTotal = (unread?.internal ?? 0) + (unread?.client ?? 0);
  const name = person?.displayName || person?.firstName || (user?.email?.split('@')[0] ?? '').replace(/^./, (c) => c.toUpperCase());
  const role = user?.role === 'admin' ? 'Administration' : 'Bureau';
  return (
    <div className="dash-bar">
      <form
        className="dash-search"
        role="search"
        onSubmit={(e) => { e.preventDefault(); const t = q.trim(); if (t) router.push(`/app/chantiers?q=${encodeURIComponent(t)}`); }}
      >
        <Search size={17} strokeWidth={2} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un chantier (réf, titre, ville)…" aria-label="Rechercher un chantier" />
      </form>
      <span className="spacer" />
      <Link href="/app/messagerie" className="dash-bell" aria-label={unreadTotal > 0 ? `${unreadTotal} message(s) non lu(s)` : 'Messagerie'} title="Messagerie">
        <Bell size={18} strokeWidth={2} />
        {unreadTotal > 0 && <span className="dot">{unreadTotal}</span>}
      </Link>
      <div className="dash-account">
        <span className="av">{(name[0] ?? '?').toUpperCase()}</span>
        <span className="who"><strong>{name}</strong><span>{role}</span></span>
      </div>
    </div>
  );
}

/** État de pointage résumé d'une affectation du jour. */
function fieldStateBadge(ev: FieldEvent): { tone: string; label: string } {
  const running = ev.people.filter((p) => p.state === 'running').length;
  const done = ev.people.filter((p) => p.state === 'done').length;
  if (ev.people.length === 0) return { tone: 'plain', label: 'Aucun ouvrier affecté' };
  if (running > 0) return { tone: 'ok', label: `${running}/${ev.people.length} en cours` };
  if (done === ev.people.length) return { tone: 'ok', label: 'Pointé' };
  if (new Date(ev.startAt).getTime() > Date.now()) return { tone: 'plain', label: 'À venir' };
  return { tone: 'warn', label: done > 0 ? `${done}/${ev.people.length} pointé` : 'Pas encore pointé' };
}

/** « Sur le terrain aujourd'hui » : horaire, chantier, équipe, état de pointage. */
function FieldToday({ items }: { items: FieldEvent[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, 2);
  return (
    <section className="panel dashboard-day">
      <div className="panelhead">
        <h2>{tr("Aujourd’hui")} <span className="hint">{items.length}</span></h2>
        <Link href="/app/planning" className="hint">Ouvrir le planning →</Link>
      </div>
      {items.length === 0 ? (
        <div className="panel-empty">
          <p className="muted">Aucune affectation prévue aujourd’hui.</p>
        </div>
      ) : (
        <div className="field-list">
          {visible.map((ev) => {
            const st = fieldStateBadge(ev);
            return (
              <div key={ev.id} className="field-row">
                <div className="when">
                  {ev.allDay ? tr("Journée") : `${hhmm(ev.startAt)} – ${hhmm(ev.endAt)}`}
                  {ev.tentative && <small>{tr("À confirmer")}</small>}
                </div>
                <div className="ws">
                  <Link href={`/app/chantiers/${ev.worksite.id}`}>{ev.worksite.title}</Link>
                  <div className="sub">{ev.worksite.ref}{ev.worksite.city ? ` · ${ev.worksite.city}` : ''}</div>
                </div>
                <div className="field-state"><span className={`badge ${st.tone}`}>{st.label}</span></div>
                <details className="crew"><summary>{ev.team || 'Équipe'} · {ev.people.length} personne{ev.people.length !== 1 ? 's' : ''}</summary><div className="dashboard-crew-detail">
                  {ev.team && <span className="badge plain">{ev.team}</span>}
                  {ev.people.map((p) => (
                    <span key={p.id} className="who" title={p.state === 'running' ? 'Compteur en cours' : p.state === 'done' ? 'A pointé sur ce chantier' : 'Pas encore pointé'}>
                      {p.state === 'running' ? '● ' : p.state === 'done' ? '✓ ' : '○ '}{p.name}
                    </span>
                  ))}
                </div></details>
              </div>
            );
          })}
        </div>
      )}
      {items.length > 2 && <button className="dashboard-show-more" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? 'Réduire' : `Voir les ${items.length} affectations`}</button>}
    </section>
  );
}

/** Chantiers en cours : dossiers compacts, titres complets et accès direct. */
function InProgressBand({ rows, total }: { rows: InProgressRow[]; total: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', margin: '1.8rem 0 0.8rem' }}>
        <div className="section-title" style={{ margin: 0 }}>Chantiers en cours <span className="hint">{total}</span></div>
        <Link href="/app/chantiers?statut=in_progress" className="hint">Tous les chantiers →</Link>
      </div>
      <div className="dashboard-sites">
        {(expanded ? rows : rows.slice(0, 4)).map((w) => (
          <Link key={w.id} href={`/app/chantiers/${w.id}`} className="dashboard-site" title={`${w.title}${w.manager ? ` · ${w.manager}` : ''}`}>
            <Avatar src={w.photoThumbUrl} label={w.title} size={40} />
            <span className="dashboard-site-copy"><small>{w.ref}</small><strong>{w.title}</strong>{(w.city || w.client) && <span>{[w.city, w.client].filter(Boolean).join(' · ')}</span>}</span>
            <ChevronRight size={17} />
          </Link>
        ))}
      </div>
      {rows.length > 4 && <button className="dashboard-show-more" style={{ borderRadius: 12, marginTop: 10 }} onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? 'Réduire' : 'Afficher plus de chantiers'}</button>}
    </>
  );
}

const WS_STATUS_TONE: Record<string, string> = { scheduled: 'primary', in_progress: 'ok', on_hold: 'warn' };

type InProgressRow = Dashboard['inProgress'][number];

/** Variation en % vs le mois précédent, masquée si la base précédente est trop faible pour être parlante. */
function monthTrend(cur: number, prev: number): string | undefined {
  if (prev < 1000) return undefined;
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (Math.abs(pct) > 300) return undefined;
  const prevMonthLabel = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toLocaleDateString(dateLocale(), { month: 'long' });
  return `${pct >= 0 ? '↗' : '↘'} ${pct >= 0 ? '+' : ''}${pct} % par rapport à ${prevMonthLabel}`;
}

export default function DashboardPage() {
  const { user, person } = useAuth();
  const { data, loading, error, reload } = useApi<Dashboard>(user?.role === 'worker' || user?.role === 'foreman' || user?.role === 'storekeeper' ? null : '/api/dashboard');
  const [showAllPriorities, setShowAllPriorities] = useState(false);
  const priorities = (data?.alerts ?? []).filter(a => !['overdue_invoices', 'overdue_supplier_invoices', 'quotes_follow', 'expiring_docs'].includes(a.kind));
  if (data && data.kpis.forecastAmount > 0) priorities.unshift({
    kind: 'forecast_to_invoice', severity: 'info', label: 'Reste à facturer sur devis acceptés',
    count: data.kpis.forecastCount, amount: data.kpis.forecastAmount, href: '/app/finances#previsionnel',
  });
  const today = new Date();
  const eyebrow = today.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
  const name = person?.displayName || person?.firstName || (user?.email?.split('@')[0] ?? '').replace(/^./, (c) => c.toUpperCase());

  if (user?.role === 'storekeeper') return <PreparationsPage />;
  if (user?.role === 'worker') return <WorkerToday />;
  if (user?.role === 'foreman') return <ForemanToday />;

  return (
    <>
      <DashBar />
      <div className="dash-title">
        <div className="eyebrow" style={{ marginBottom: '0.3rem' }}>{eyebrow}</div>
        <PageHead
          title={`Bonjour ${name},`}
          sub="Voici les priorités de votre journée."
        />
      </div>

      {loading && <SkeletonRows />}

      {error && !loading && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <>
          <div className="dashboard-summary">
            <Kpi ic={BarChart3} label="Facturé ce mois · HT" href="/app/documents?kind=invoice&dashboard=invoiced" value={<Money value={data.kpis.invoicedMonth} />} hero />
            <div className="dashboard-receivable">
              <Kpi ic={Wallet} label="Clients à encaisser · TTC" href="/app/documents?kind=invoice&dashboard=receivable" value={<Money value={data.kpis.receivableAmount} />} />
              <Link className="dashboard-overdue" href="/app/documents?kind=invoice&dashboard=overdue">En retard : <Money value={data.kpis.overdueAmount} /> · {data.kpis.overdueCount}</Link>
            </div>
            <Kpi ic={CreditCard} label="Fournisseurs échus · TTC" href="/app/achats?paid=0&overdue=1" value={<Money value={data.kpis.supplierOverdueAmount} />} sub={`${data.kpis.supplierOverdueCount} factures à régler`} warn={data.kpis.supplierOverdueCount > 0} />
            <Kpi ic={FileText} label="Devis en attente · HT" href="/app/documents?kind=quote&dashboard=quotes" value={<Money value={data.kpis.quotesPendingAmount} />} sub={`${data.kpis.quotesPendingCount} devis envoyés`} />
          </div>

          <div className="split dashboard-focus" style={{ margin: '1.2rem 0 0.8rem' }}>
            <section className="panel dashboard-priorities">
              <DashboardMyTasks />
              <div className="panelhead">
                <h2>À traiter en priorité <span className="hint">{priorities.length}</span></h2>
                <small>actions à suivre</small>
              </div>
              {priorities.length === 0 ? (
                <div className="panel-empty">
                  <p className="dashboard-clear"><ShieldCheck size={19}/>Pas d’autre action urgente.</p>
                </div>
              ) : (
                <div className="alert-list">
                  {(showAllPriorities ? priorities : priorities.slice(0, 4)).map((a) => {
                    const AlertIc = ALERT_KIND_ICON[a.kind] ?? AlertTriangle;
                    return (
                      <Link key={a.kind} href={a.href} className={`alert ${a.severity}`}>
                        <span className="sev"><AlertIc size={17} strokeWidth={2} /></span>
                        <span className="label">{a.label}<span className="n" style={a.kind === 'forecast_to_invoice' ? { display: 'block', marginLeft: 0 } : undefined}>{a.kind === 'forecast_to_invoice' ? <><Money value={a.amount ?? 0} /> HT · {a.count} dossier{a.count > 1 ? 's' : ''}</> : <>{a.count} {tr("élément")}{a.count > 1 ? 's' : ''}</>}</span></span>
                        {a.amount != null && a.kind !== 'forecast_to_invoice' && <span className="amount"><Money value={a.amount} /></span>}
                        <ChevronRight size={18} strokeWidth={2} className="chev" />
                      </Link>
                    );
                  })}
                </div>
              )}
              {priorities.length > 4 && <button className="dashboard-show-more" aria-expanded={showAllPriorities} onClick={() => setShowAllPriorities(!showAllPriorities)}>{showAllPriorities ? 'Réduire' : `Voir les ${priorities.length} priorités`}</button>}
            </section>

            <FieldToday items={data.fieldToday ?? []} />
          </div>

          <div className="dashboard-pipeline"><Link href="/app/analyse">Voir l’analyse financière <ChevronRight size={15}/></Link></div>

          {data.inProgress.length > 0 && <InProgressBand rows={data.inProgress} total={data.kpis.openWorksites} />}

          {data.expiringDocs.length > 0 && (
            <>
              <div className="section-title" style={{ marginTop: '1.8rem' }}>Documents légaux à renouveler <Link href="/app/equipe" className="hint">Voir l’équipe →</Link></div>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>Personne</th><th>Document</th><th>Échéance</th></tr></thead>
                  <tbody>
                    {data.expiringDocs.map((d) => (
                      <tr key={d.id}>
                        <td>{d.person}</td>
                        <td>{d.label || LEGAL_DOC_LABEL[d.type as keyof typeof LEGAL_DOC_LABEL] || d.type}</td>
                        <td className="tnum">{formatDateBE(d.expiresOn)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
