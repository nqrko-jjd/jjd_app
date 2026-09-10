'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, Money, Avatar } from '@/lib/ui';
import { FormModal } from '@/components/FormModal';
import { ContextMenu, useContextMenu, openActions, type MenuItem } from '@/components/ContextMenu';
import { ViewToggle, useViewMode } from '@/components/ViewToggle';
import { useSort, SortTh } from '@/lib/sort';
import { rowNav } from '@/lib/rowNav';
import { PERSON_FIELDS } from '@/lib/forms';
import { downloadCsv, pickAndImportCsv, summarizeImport } from '@/lib/csvIO';
import { PERSON_ROLE_LABEL, PERSON_ROLES, WORKER_CONTRACT_LABEL } from '@jjd/shared';

interface Person {
  id: string; firstName: string; lastName: string | null; displayName: string | null;
  role: string; contractType: string; hourlyRate: number | null; phone: string | null;
  active: boolean; languages: string[] | null; specialties: string[] | null; photoThumbUrl: string | null;
  _count: { legalDocs: number; timeEntries: number };
}

export default function EquipePage() {
  return (
    <Suspense fallback={<div className="empty">Chargement…</div>}>
      <EquipeInner />
    </Suspense>
  );
}

function EquipeInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [role, setRole] = useState('');
  const [active, setActive] = useState('1');
  const [creating, setCreating] = useState(false);
  const [mode, setMode] = useViewMode('equipe');
  const ctx = useContextMenu<Person>();
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (role) params.set('role', role);
  if (active) params.set('active', active);
  const { data, loading, reload } = useApi<{ items: Person[] }>(`/api/people?${params}`);
  const name = (p: Person) => p.displayName || `${p.firstName} ${p.lastName ?? ''}`.trim();

  async function patch(id: string, body: Record<string, unknown>) {
    await api(`/api/people/${id}`, { method: 'PATCH', body });
    reload();
  }

  function rowMenu(p: Person): MenuItem[] {
    return [
      ...openActions(`/app/equipe/${p.id}`, (h) => router.push(h)),
      ...(p.phone ? ['separator' as const, { label: `Appeler ${p.phone}`, onClick: () => { window.location.href = `tel:${p.phone}`; } }] : []),
      'separator',
      {
        label: 'Rôle',
        items: PERSON_ROLES.map((r) => ({
          label: PERSON_ROLE_LABEL[r],
          check: p.role === r,
          disabled: p.role === r,
          onClick: () => patch(p.id, { role: r }),
        })),
      },
      p.active
        ? { label: 'Marquer comme ancien', onClick: () => patch(p.id, { active: false }) }
        : { label: 'Réactiver', onClick: () => patch(p.id, { active: true }) },
    ];
  }
  function exportCsv() {
    downloadCsv(`/api/people/export.csv?${params}`, `equipe-${new Date().toISOString().slice(0, 10)}.csv`);
  }
  function importCsv() {
    pickAndImportCsv(
      '/api/people/import',
      (r) => { alert(summarizeImport(r)); reload(); },
      (msg) => alert(`Échec de l’import : ${msg}`),
    );
  }
  const sort = useSort<Person>(data?.items ?? [], {
    name,
    role: (p) => PERSON_ROLE_LABEL[p.role as keyof typeof PERSON_ROLE_LABEL] ?? p.role,
    contract: (p) => WORKER_CONTRACT_LABEL[p.contractType as keyof typeof WORKER_CONTRACT_LABEL] ?? p.contractType,
    rate: (p) => p.hourlyRate,
    languages: (p) => (p.languages ?? []).join(' '),
    specialties: (p) => (p.specialties ?? []).join(' '),
    docs: (p) => p._count.legalDocs,
    entries: (p) => p._count.timeEntries,
  });

  return (
    <>
      {ctx.menu && <ContextMenu x={ctx.menu.x} y={ctx.menu.y} items={rowMenu(ctx.menu.row)} onClose={ctx.close} />}
      {creating && (
        <FormModal
          title="Nouvelle personne"
          fields={PERSON_FIELDS}
          initial={{ role: 'worker', contractType: 'employee', active: true }}
          onClose={() => setCreating(false)}
          onSubmit={async (v) => { await api('/api/people', { method: 'POST', body: v }); reload(); }}
        />
      )}
      <PageHead
        title="Équipe"
        sub={data ? `${data.items.filter((p) => p.active).length} actifs · clic droit sur une ligne pour les actions rapides` : undefined}
        action={
          <div className="row">
            <button className="btn" onClick={exportCsv} title="Exporter la liste filtrée en CSV (éditable dans Excel)">⇩ Exporter CSV</button>
            <button className="btn" onClick={importCsv} title="Réimporter un CSV/Excel corrigé (met à jour par id, crée les nouvelles fiches)">⇧ Importer</button>
            <button className="btn primary" onClick={() => setCreating(true)}>+ Nouvelle personne</button>
          </div>
        }
      />
      <div className="row" style={{ marginBottom: '1rem' }}>
        <input className="input" style={{ maxWidth: 260 }} placeholder="Nom…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" style={{ maxWidth: 200 }} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Tous rôles</option>
          {PERSON_ROLES.map((r) => <option key={r} value={r}>{PERSON_ROLE_LABEL[r]}</option>)}
        </select>
        <select className="select" style={{ maxWidth: 160 }} value={active} onChange={(e) => setActive(e.target.value)}>
          <option value="1">Actifs</option>
          <option value="0">Anciens</option>
          <option value="">Tous</option>
        </select>
        <ViewToggle mode={mode} onChange={setMode} />
      </div>
      {loading && <div className="empty">Chargement…</div>}
      {data && mode === 'gallery' && (
        <div className="gallery-grid">
          {sort.rows.map((p) => (
            <Link key={p.id} href={`/app/equipe/${p.id}`} className="card gallery-card" style={p.active ? undefined : { opacity: 0.6 }}>
              <div className="gallery-thumb">
                {p.photoThumbUrl ? <img src={p.photoThumbUrl} alt="" /> : <Avatar label={name(p)} size={56} />}
              </div>
              <div className="gallery-body">
                <div className="gallery-title">{name(p)}{!p.active && <span className="badge plain" style={{ marginLeft: 6 }}>Ancien</span>}</div>
                <div className="gallery-sub">{PERSON_ROLE_LABEL[p.role as keyof typeof PERSON_ROLE_LABEL] ?? p.role}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
      {data && mode === 'list' && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <SortTh k="name" sort={sort}>Nom</SortTh>
                <SortTh k="role" sort={sort}>Rôle</SortTh>
                <SortTh k="specialties" sort={sort}>Spécialités</SortTh>
                <SortTh k="contract" sort={sort}>Contrat</SortTh>
                <SortTh k="rate" sort={sort} align="right">Taux</SortTh>
                <SortTh k="languages" sort={sort}>Langues</SortTh>
                <SortTh k="docs" sort={sort}>Docs</SortTh>
                <SortTh k="entries" sort={sort}>Pointages</SortTh>
              </tr>
            </thead>
            <tbody>
              {sort.rows.map((p) => (
                <tr
                  key={p.id}
                  style={p.active ? undefined : { opacity: 0.5 }}
                  className={`row-link${ctx.menu?.row.id === p.id ? ' ctx-target' : ''}`}
                  onClick={rowNav(`/app/equipe/${p.id}`, (h) => router.push(h))}
                  onContextMenu={(e) => ctx.open(e, p)}
                >
                  <td>
                    <Avatar src={p.photoThumbUrl} label={p.displayName || `${p.firstName} ${p.lastName ?? ''}`} />
                    <Link href={`/app/equipe/${p.id}`}>{p.displayName || `${p.firstName} ${p.lastName ?? ''}`.trim()}</Link>
                    {!p.active && <span className="badge plain" style={{ marginLeft: 6 }}>Ancien</span>}
                  </td>
                  <td>{PERSON_ROLE_LABEL[p.role as keyof typeof PERSON_ROLE_LABEL] ?? p.role}</td>
                  <td style={{ fontSize: '0.82rem' }}>{(p.specialties ?? []).join(', ') || '—'}</td>
                  <td>{WORKER_CONTRACT_LABEL[p.contractType as keyof typeof WORKER_CONTRACT_LABEL] ?? p.contractType}</td>
                  <td style={{ textAlign: 'right' }}>{p.hourlyRate != null ? <Money value={p.hourlyRate} /> : <span className="badge warn">à définir</span>}</td>
                  <td className="mono" style={{ fontSize: '0.8rem' }}>{(p.languages ?? []).join(' ') || '—'}</td>
                  <td className="tnum">{p._count.legalDocs || ''}</td>
                  <td className="tnum">{p._count.timeEntries || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
