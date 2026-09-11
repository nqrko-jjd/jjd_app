'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHead, Money, formatDateBE } from '@/lib/ui';
import { useSort, useColumnFilter, SortTh } from '@/lib/sort';
import { rowNav } from '@/lib/rowNav';
import { LEGAL_DOC_LABEL, WORKSITE_STATUS_LABEL } from '@jjd/shared';

interface TodayEv {
  id: string; startAt: string; endAt: string;
  worksite: { id: string; ref: string; title: string; city: string | null };
}
interface Running { id: string; startedAt: string; worksite: { ref: string; title: string } | null }
interface TimerResp { running: Running | null; linked?: boolean }

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
      <PageHead title={`Bonjour ${person?.displayName || person?.firstName || ''}`} sub={now.toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' })} />

      {!linked && (
        <div className="card card-pad" style={{ borderColor: 'var(--warn)', borderWidth: 2 }}>
          <div className="muted">Ton compte n’est pas encore lié à ta fiche ouvrier. Demande au bureau de le faire (Équipe → « Lier à un compte »). En attendant, tu ne peux pas pointer.</div>
        </div>
      )}

      {linked && (running ? (
        <div className="card card-pad" style={{ borderColor: 'var(--ok)', borderWidth: 2, marginBottom: '1.2rem' }}>
          <div className="muted" style={{ textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em' }}>Compteur en cours</div>
          <div style={{ fontWeight: 700, fontSize: '1.1rem', margin: '0.2rem 0' }}>{running.worksite?.ref} — {running.worksite?.title}</div>
          <div className="mono" style={{ fontSize: '2.2rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', margin: '0.3rem 0' }}>{elapsed(running.startedAt)}</div>
          <div className="row" style={{ gap: '0.6rem' }}>
            <button className="btn" style={{ background: 'var(--crit)', color: '#fff', borderColor: 'var(--crit)' }} onClick={stop}>Arrêter</button>
            <Link href="/app/mes-heures" className="btn">Mon récap →</Link>
          </div>
        </div>
      ) : (
        <div className="card card-pad muted" style={{ marginBottom: '1.2rem' }}>Aucun compteur actif. Choisis un chantier ci-dessous pour démarrer.</div>
      ))}

      <div className="section-title">Mes chantiers du jour</div>
      {(plan?.items.length ?? 0) === 0 && <div className="card card-pad muted">Rien de planifié aujourd’hui.</div>}
      {plan?.items.map((e) => (
        <div key={e.id} className="card card-pad" style={{ marginBottom: '0.7rem' }}>
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
      ))}
    </>
  );
}

interface Dashboard {
  kpis: {
    invoicedMonth: number; paidMonth: number; overdueAmount: number;
    overdueCount: number; openWorksites: number;
    receivableAmount: number; quotesPendingAmount: number; quotesPendingCount: number;
  };
  alerts: { kind: string; severity: string; label: string; count: number; amount?: number; href: string }[];
  inProgress: { id: string; ref: string; title: string; city: string | null; status: string; client: string | null; manager: string | null }[];
  expiringDocs: { id: string; person: string; type: string; label: string | null; expiresOn: string | null }[];
}

function QuickActions() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function newDoc(kind: 'quote' | 'invoice') {
    setBusy(true);
    try {
      const { document } = await api<{ document: { id: string } }>('/api/documents', { method: 'POST', body: { kind } });
      router.push(`/app/documents/${document.id}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="quick-actions">
      <button className="qa" disabled={busy} onClick={() => newDoc('quote')}><span className="qa-ic">▧</span>Nouveau devis</button>
      <button className="qa" disabled={busy} onClick={() => newDoc('invoice')}><span className="qa-ic">€</span>Nouvelle facture</button>
      <Link className="qa" href="/app/chantiers?new=1"><span className="qa-ic">▤</span>Nouveau chantier</Link>
      <Link className="qa" href="/app/contacts?new=1"><span className="qa-ic">☰</span>Nouveau contact</Link>
      <Link className="qa" href="/app/crm?new=1"><span className="qa-ic">⇗</span>Nouvelle opportunité</Link>
      <Link className="qa" href="/app/planning"><span className="qa-ic">▦</span>Planifier</Link>
    </div>
  );
}

const WS_STATUS_TONE: Record<string, string> = { scheduled: 'primary', in_progress: 'ok', on_hold: 'warn' };

type InProgressRow = Dashboard['inProgress'][number];

function InProgressTable({ rows }: { rows: InProgressRow[] }) {
  const router = useRouter();
  const wsAccessors = {
    ref: (w: InProgressRow) => w.ref,
    title: (w: InProgressRow) => w.title,
    client: (w: InProgressRow) => w.client,
    manager: (w: InProgressRow) => w.manager,
    status: (w: InProgressRow) => WORKSITE_STATUS_LABEL[w.status as keyof typeof WORKSITE_STATUS_LABEL] ?? w.status,
  };
  const colFilter = useColumnFilter<InProgressRow>(rows, wsAccessors);
  const sort = useSort<InProgressRow>(colFilter.rows, wsAccessors);
  return (
    <>
      <div className="section-title">Chantiers en cours <span className="hint">{rows.length} — clique pour ouvrir le dossier</span></div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <SortTh k="ref" sort={sort} filter={colFilter}>Réf</SortTh>
              <SortTh k="title" sort={sort} filter={colFilter}>Chantier</SortTh>
              <SortTh k="client" sort={sort} filter={colFilter}>Client</SortTh>
              <SortTh k="manager" sort={sort} filter={colFilter}>Chef</SortTh>
              <SortTh k="status" sort={sort} filter={colFilter}>Statut</SortTh>
            </tr>
          </thead>
          <tbody>
            {sort.rows.map((w) => (
              <tr key={w.id} className="row-link" onClick={rowNav(`/app/chantiers/${w.id}`, (h) => router.push(h))}>
                <td className="mono">{w.ref}</td>
                <td>
                  <Link href={`/app/chantiers/${w.id}`}>{w.title}</Link>
                  {w.city && <div className="muted" style={{ fontSize: '0.78rem' }}>{w.city}</div>}
                </td>
                <td>{w.client ?? '—'}</td>
                <td>{w.manager ?? '—'}</td>
                <td><span className={`badge ${WS_STATUS_TONE[w.status] ?? ''}`}>{WORKSITE_STATUS_LABEL[w.status as keyof typeof WORKSITE_STATUS_LABEL] ?? w.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { data, loading } = useApi<Dashboard>(user?.role === 'worker' ? null : '/api/dashboard');
  const now = new Date().toLocaleDateString('fr-BE', { month: 'long', year: 'numeric' });

  if (user?.role === 'worker') return <WorkerToday />;

  return (
    <>
      <PageHead title="Tableau de bord" sub={`Vue d'ensemble — ${now}`} />

      <QuickActions />

      {loading && <div className="empty">Chargement…</div>}
      {data && (
        <>
          <div className="kpis">
            <Kpi ic="€" label="Facturé ce mois" value={<Money value={data.kpis.invoicedMonth} />} />
            <Kpi ic="✓" label="Encaissé ce mois" value={<Money value={data.kpis.paidMonth} />} />
            <Kpi ic="!" label="Impayés" value={<Money value={data.kpis.overdueAmount} />} sub={`${data.kpis.overdueCount} factures en retard`} />
            <Kpi ic="◷" label="À encaisser" value={<Money value={data.kpis.receivableAmount} />} sub="factures émises non payées" />
            <Kpi ic="▤" label="Chantiers en cours" value={data.kpis.openWorksites} />
            <Kpi ic="⇗" label="Devis en attente" value={<Money value={data.kpis.quotesPendingAmount} />} sub={`${data.kpis.quotesPendingCount} devis envoyés`} />
          </div>

          <div className="section-title">À traiter <span className="hint">trié par urgence</span></div>
          {data.alerts.length === 0 ? (
            <div className="card card-pad muted">Rien à signaler. 👍</div>
          ) : (
            <div className="alert-list">
              {data.alerts.map((a) => (
                <Link key={a.kind} href={a.href} className={`alert ${a.severity}`}>
                  <span className="sev" />
                  <span className="label">{a.label}</span>
                  {a.amount != null && <span className="amount"><Money value={a.amount} /></span>}
                  <span className="count">{a.count}</span>
                </Link>
              ))}
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

function Kpi({ ic, label, value, sub }: { ic: string; label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="kpi">
      <span className="ic">{ic}</span>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
