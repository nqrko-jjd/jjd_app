'use client';
import { SkeletonRows, ErrorState } from '@/components/States';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHead, Money, formatDateBE, Avatar, ProgressCell, Kpi } from '@/lib/ui';
import { useSort, SortTh } from '@/lib/sort';
import { rowNav } from '@/lib/rowNav';
import { LEGAL_DOC_LABEL, WORKSITE_STATUS_LABEL, WORKSITE_PROGRESS_PCT, type WorksiteStatus } from '@jjd/shared';
import { BarChart3, Wallet, Building2, Flag, FileText, Clock, MessageSquare, Users } from 'lucide-react';

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
  const { data: plan, reload: reloadPlan } = useApi<{ items: TodayEv[] }>(
    person ? `/api/planning?from=${from}&to=${to}&personId=${person.id}` : null,
  );
  const { data: timer, reload: reloadTimer } = useApi<TimerResp>('/api/timesheet/timer');
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
    await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { status: t.status === 'done' ? 'todo' : 'done' } });
    await reloadTasks();
    setTaskBusy(null);
  }

  async function start(worksiteId: string) {
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
  }
  async function stop() {
    await api('/api/timesheet/timer/stop', { method: 'POST', body: { endedAt: new Date().toISOString() } });
    reloadTimer();
    reloadPlan();
  }

  const running = timer?.running ?? null;
  const linked = timer?.linked !== false;

  return (
    <>
      <div className="eyebrow" style={{ marginBottom: '0.3rem' }}>Mon espace ouvrier</div>
      <PageHead title={`Bonjour ${person?.displayName || person?.firstName || ''},`} sub="Bonne journée sur le terrain." />

      {!linked && (
        <div className="card card-pad" style={{ borderColor: 'var(--warn)', borderWidth: 2 }}>
          <div className="muted">Ton compte n’est pas encore lié à ta fiche ouvrier. Demande au bureau de le faire (Équipe → « Lier à un compte »). En attendant, tu ne peux pas pointer.</div>
        </div>
      )}

      {linked && (running ? (
        <div className="detail-hero" style={{ marginBottom: '1.2rem' }}>
          <div className="eyebrow">Compteur en cours</div>
          <div style={{ fontWeight: 700, fontSize: '1.1rem', margin: '0.2rem 0', color: '#fff' }}>{running.worksite?.ref} — {running.worksite?.title}</div>
          <div className="mono" style={{ fontSize: '2.6rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', margin: '0.4rem 0', color: '#fff' }}>{elapsed(running.startedAt)}</div>
          <div className="row" style={{ gap: '0.6rem' }}>
            <button className="btn" style={{ background: 'var(--crit)', color: '#fff', borderColor: 'var(--crit)' }} onClick={stop}>Arrêter</button>
            <Link href="/app/mes-heures" className="btn" style={{ background: 'rgba(255,255,255,0.1)', borderColor: 'rgba(255,255,255,0.25)', color: '#fff' }}>Mon récap →</Link>
          </div>
        </div>
      ) : (
        <div className="detail-hero" style={{ marginBottom: '1.2rem' }}>
          <div className="eyebrow">Prêt pour la journée</div>
          <div className="mono" style={{ fontSize: '2.6rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', margin: '0.4rem 0', color: '#fff' }}>00:00:00</div>
          {linked && singleWs ? (
            <>
              <div className="sub">{singleWs.ref} · {singleWs.title}</div>
              <button className="btn gold" style={{ marginTop: '0.8rem' }} onClick={() => start(singleWs.id)}>
                Commencer le pointage
              </button>
            </>
          ) : (
            <div className="sub">Aucun compteur actif. Choisis un chantier ci-dessous pour démarrer.</div>
          )}
        </div>
      ))}

      <div className="section-title">Mes chantiers du jour</div>
      {(plan?.items.length ?? 0) === 0 && <div className="card card-pad muted">Rien de planifié aujourd’hui.</div>}
      {plan?.items.map((e) => (
        <div key={e.id} className="card" style={{ marginBottom: '0.7rem', overflow: 'hidden' }}>
          {e.worksite.acp?.photoThumbUrl && (
            <div style={{ height: 160 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={e.worksite.acp.photoThumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          )}
          <div className="card-pad">
            <div style={{ fontWeight: 700 }}>{e.worksite.ref} — {e.worksite.title}</div>
            {e.worksite.city && <div className="muted">{e.worksite.city}</div>}
            <div className="muted">
              {new Date(e.startAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })} – {new Date(e.endAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div className="row" style={{ gap: '0.5rem', marginTop: '0.6rem' }}>
              {linked && !running && (
                <button className="btn primary" style={{ flex: 1 }} onClick={() => start(e.worksite.id)}>Démarrer le compteur</button>
              )}
              <Link href={`/app/fiche/${e.worksite.id}`} className="btn" style={{ flex: 1, textAlign: 'center' }}>Fiche du jour ›</Link>
            </div>
          </div>
        </div>
      ))}

      {singleWs && (
        <div className="quick-actions">
          <Link href={`/app/fiche/${singleWs.id}/rapport`} className="quick-action">
            <span className="ic"><FileText size={20} strokeWidth={2} /></span>
            <span>
              <strong>Faire mon rapport</strong>
              <small>Travaux, photos et remarques</small>
            </span>
          </Link>
          <Link href={`/app/fiche/${singleWs.id}#fil-chantier`} className="quick-action">
            <span className="ic"><MessageSquare size={20} strokeWidth={2} /></span>
            <span>
              <strong>Contacter l’équipe</strong>
              <small>Échanger sur ce chantier</small>
            </span>
          </Link>
        </div>
      )}

      {singleWs && tasks.length > 0 && (
        <>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div className="section-title" style={{ marginBottom: 0 }}>Mes tâches du jour</div>
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
          <span><strong>Mon équipe</strong><small>Affectations du jour</small></span>
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
        <div className="section-title" style={{ margin: 0 }}>Mes chantiers <span className="hint">{worksites.length}</span></div>
        <Link href="/app/planning" className="hint">Voir le planning →</Link>
      </div>
      {worksites.length === 0 ? (
        <div className="card card-pad muted">Aucun chantier ne vous est assigné pour le moment.</div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Chantier</th>
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
    overdueCount: number; openWorksites: number; teamsOnSiteToday: number;
    receivableAmount: number; quotesPendingAmount: number; quotesPendingCount: number;
  };
  alerts: { kind: string; severity: string; label: string; count: number; amount?: number; href: string }[];
  inProgress: { id: string; ref: string; title: string; city: string | null; status: string; client: string | null; manager: string | null; photoThumbUrl: string | null }[];
  expiringDocs: { id: string; person: string; type: string; label: string | null; expiresOn: string | null }[];
}

/** Les deux actions les plus fréquentes, mises en avant à côté du titre (comme la maquette). */
function QuickActionsPrimary() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function newQuote() {
    setBusy(true);
    try {
      const { document } = await api<{ document: { id: string } }>('/api/documents', { method: 'POST', body: { kind: 'quote' } });
      router.push(`/app/documents/${document.id}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className="btn primary" disabled={busy} onClick={newQuote}>+ Nouveau devis</button>
      <Link className="btn" href="/app/chantiers?new=1">+ Nouveau chantier</Link>
    </>
  );
}

const WS_STATUS_TONE: Record<string, string> = { scheduled: 'primary', in_progress: 'ok', on_hold: 'warn' };
const ALERT_ICON: Record<string, string> = { critical: '!', warning: '✎', info: '✓' };

type InProgressRow = Dashboard['inProgress'][number];

function InProgressTable({ rows }: { rows: InProgressRow[] }) {
  const router = useRouter();
  const wsAccessors = {
    title: (w: InProgressRow) => w.title,
    manager: (w: InProgressRow) => w.manager,
    status: (w: InProgressRow) => WORKSITE_STATUS_LABEL[w.status as keyof typeof WORKSITE_STATUS_LABEL] ?? w.status,
  };
  const sort = useSort<InProgressRow>(rows, wsAccessors);
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', margin: '1.8rem 0 0.8rem' }}>
        <div className="section-title" style={{ margin: 0 }}>Chantiers en cours <span className="hint">{rows.length}</span></div>
        <Link href="/app/chantiers" className="hint">Tous les chantiers →</Link>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <SortTh k="title" sort={sort}>Chantier</SortTh>
              <SortTh k="manager" sort={sort}>Responsable</SortTh>
              <SortTh k="status" sort={sort}>Statut</SortTh>
              <th>Avancement</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sort.rows.map((w) => (
              <tr key={w.id} className="row-link" onClick={rowNav(`/app/chantiers/${w.id}`, (h) => router.push(h))}>
                <td>
                  <Avatar src={w.photoThumbUrl} label={w.title} />
                  <Link href={`/app/chantiers/${w.id}`}>{w.title}</Link>
                  <div className="muted" style={{ fontSize: '0.78rem' }}>{w.ref}{w.city ? ` · ${w.city}` : ''}</div>
                </td>
                <td>{w.manager ? <><Avatar label={w.manager} size={22} />{w.manager}</> : '—'}</td>
                <td><span className={`badge ${WS_STATUS_TONE[w.status] ?? ''}`}>{WORKSITE_STATUS_LABEL[w.status as keyof typeof WORKSITE_STATUS_LABEL] ?? w.status}</span></td>
                <td><ProgressCell pct={WORKSITE_PROGRESS_PCT[w.status as WorksiteStatus] ?? 0} /></td>
                <td className="muted">→</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Variation en % vs le mois précédent, masquée si la base précédente est trop faible pour être parlante. */
function monthTrend(cur: number, prev: number): string | undefined {
  if (prev < 1000) return undefined;
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (Math.abs(pct) > 300) return undefined;
  const prevMonthLabel = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toLocaleDateString('fr-BE', { month: 'long' });
  return `${pct >= 0 ? '↗' : '↘'} ${pct >= 0 ? '+' : ''}${pct} % par rapport à ${prevMonthLabel}`;
}

export default function DashboardPage() {
  const { user, person } = useAuth();
  const { data, loading, error, reload } = useApi<Dashboard>(user?.role === 'worker' || user?.role === 'foreman' ? null : '/api/dashboard');
  const today = new Date();
  const eyebrow = today.toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' });
  const name = person?.displayName || person?.firstName || user?.email?.split('@')[0] || '';

  if (user?.role === 'worker') return <WorkerToday />;
  if (user?.role === 'foreman') return <ForemanToday />;

  return (
    <>
      <div className="eyebrow" style={{ marginBottom: '0.3rem' }}>{eyebrow}</div>
      <PageHead
        title={`Bonjour ${name},`}
        sub="Voici les priorités de votre journée."
        action={
          <div className="row">
            <QuickActionsPrimary />
          </div>
        }
      />

      {loading && <SkeletonRows />}

      {error && !loading && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <>
          <div className="kpis">
            <Kpi
              ic={BarChart3}
              label="Facturé ce mois"
              value={<Money value={data.kpis.invoicedMonth} />}
              sub={monthTrend(data.kpis.invoicedMonth, data.kpis.invoicedPrevMonth) ?? 'Pas encore assez d’historique pour comparer'}
              hero
            />
            <Kpi
              ic={Wallet}
              label="Encaissé ce mois"
              value={<Money value={data.kpis.paidMonth} />}
              sub={data.kpis.invoicedMonth > 0 ? `${Math.round((data.kpis.paidMonth / data.kpis.invoicedMonth) * 100)} % du montant facturé` : 'Aucune facture ce mois-ci'}
            />
            <Kpi
              ic={Building2}
              label="Chantiers en cours"
              value={data.kpis.openWorksites}
              sub={data.kpis.teamsOnSiteToday > 0 ? `${data.kpis.teamsOnSiteToday} équipe${data.kpis.teamsOnSiteToday > 1 ? 's' : ''} sur le terrain aujourd’hui` : 'Aucune équipe sur le terrain aujourd’hui'}
            />
            <Kpi ic={Flag} label="Impayés" value={<Money value={data.kpis.overdueAmount} />} sub={`${data.kpis.overdueCount} facture${data.kpis.overdueCount > 1 ? 's' : ''} en retard`} warn />
            <Kpi ic={FileText} label="Devis en attente" value={<Money value={data.kpis.quotesPendingAmount} />} sub={`${data.kpis.quotesPendingCount} devis envoyés`} />
            <Kpi ic={Clock} label="À encaisser" value={<Money value={data.kpis.receivableAmount} />} sub="factures émises non payées" />
          </div>

          <div className="row" style={{ justifyContent: 'space-between', margin: '1.8rem 0 0.8rem' }}>
            <div className="section-title" style={{ margin: 0 }}>À traiter en priorité <span className="hint">{data.alerts.length}</span></div>
            <span className="hint">trié par urgence</span>
          </div>
          {data.alerts.length === 0 ? (
            <div className="card card-pad muted">Rien à signaler. 👍</div>
          ) : (
            <div className="alert-card">
              <div className="alert-list">
                {data.alerts.map((a) => (
                  <Link key={a.kind} href={a.href} className={`alert ${a.severity}`}>
                    <span className="sev">{ALERT_ICON[a.severity] ?? '•'}</span>
                    <span className="label">{a.label}<span className="n">{a.count} élément{a.count > 1 ? 's' : ''}</span></span>
                    {a.amount != null && <span className="amount"><Money value={a.amount} /></span>}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {data.inProgress.length > 0 && <InProgressTable rows={data.inProgress} />}

          {data.expiringDocs.length > 0 && (
            <>
              <div className="section-title">Documents légaux qui expirent</div>
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

