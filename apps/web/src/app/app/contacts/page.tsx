'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, Avatar } from '@/lib/ui';
import { FormModal } from '@/components/FormModal';
import { ContextMenu, useContextMenu, openActions, type MenuItem } from '@/components/ContextMenu';
import { PaginationBar } from '@/components/PaginationBar';
import { ViewToggle, useViewMode } from '@/components/ViewToggle';
import { useSort, useColumnFilter, SortTh } from '@/lib/sort';
import { rowNav } from '@/lib/rowNav';
import { CONTACT_FIELDS } from '@/lib/forms';
import { CLIENT_KIND_LABEL, formatVat } from '@jjd/shared';

const CONTACT_TYPE_LABEL: Record<string, string> = { client: 'Client', supplier: 'Fournisseur', both: 'Client + Fournisseur' };

interface Contact {
  id: string; name: string; type: string; kind: string | null;
  email: string | null; phone: string | null; vat: string | null; city: string | null;
  syndic: { name: string } | null;
  building: { id: string; name: string } | null;
  _count: { worksites: number };
}

export default function ContactsPage() {
  return (
    <Suspense fallback={<div className="empty">Chargement…</div>}>
      <ContactsInner />
    </Suspense>
  );
}

function ContactsInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [type, setType] = useState('all');
  const [creating, setCreating] = useState(sp.get('new') === '1');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [mode, setMode] = useViewMode('contacts');
  const ctx = useContextMenu<Contact>();

  useEffect(() => { setPage(1); }, [q, type]);

  const params = new URLSearchParams({ type });
  if (q) params.set('q', q);
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  const { data, loading, reload } = useApi<{ items: Contact[]; page: number; pageSize: number; totalPages: number; totalCount: number }>(`/api/contacts?${params}`);
  const { data: pick } = useApi<{ buildings: { id: string; name: string }[]; syndics: { id: string; name: string }[] }>('/api/meta/pickers');

  async function patch(id: string, body: Record<string, unknown>) {
    await api(`/api/contacts/${id}`, { method: 'PATCH', body });
    reload();
  }

  function rowMenu(c: Contact): MenuItem[] {
    return [
      ...openActions(`/app/contacts/${c.id}`, (h) => router.push(h)),
      'separator',
      ...(c.phone ? [{ label: `Appeler ${c.phone}`, onClick: () => { window.location.href = `tel:${c.phone}`; } }] : []),
      ...(c.email ? [{ label: 'Envoyer un e-mail', onClick: () => { window.location.href = `mailto:${c.email}`; } }] : []),
      ...(c.phone || c.email ? ['separator' as const] : []),
      {
        label: 'Type',
        items: (['client', 'supplier', 'both'] as const).map((t) => ({
          label: CONTACT_TYPE_LABEL[t],
          check: c.type === t,
          disabled: c.type === t,
          onClick: () => patch(c.id, { type: t }),
        })),
      },
    ];
  }

  const contactAccessors = {
    name: (c: Contact) => c.name,
    kind: (c: Contact) => (c.kind ? CLIENT_KIND_LABEL[c.kind as keyof typeof CLIENT_KIND_LABEL] : c.type === 'supplier' ? 'Fournisseur' : ''),
    city: (c: Contact) => c.city,
    vat: (c: Contact) => c.vat,
    contact: (c: Contact) => c.email ?? c.phone,
    worksites: (c: Contact) => c._count.worksites,
  };
  const colFilter = useColumnFilter<Contact>(data?.items ?? [], contactAccessors);
  const sort = useSort<Contact>(colFilter.rows, contactAccessors);

  return (
    <>
      {ctx.menu && <ContextMenu x={ctx.menu.x} y={ctx.menu.y} items={rowMenu(ctx.menu.row)} onClose={ctx.close} />}
      {creating && (
        <FormModal
          title="Nouveau contact"
          fields={CONTACT_FIELDS(type !== 'all' ? type : 'client', pick?.buildings ?? [], pick?.syndics ?? [])}
          initial={{ type: type !== 'all' ? type : 'client' }}
          onClose={() => setCreating(false)}
          onSubmit={async (v) => { await api('/api/contacts', { method: 'POST', body: v }); reload(); }}
        />
      )}
      <PageHead
        title="Contacts"
        sub={data ? `${data.totalCount} contacts · page ${data.page}/${data.totalPages} · clic droit pour les actions rapides` : undefined}
        action={<button className="btn primary" onClick={() => setCreating(true)}>+ Nouveau contact</button>}
      />
      <div className="row" style={{ marginBottom: '1rem' }}>
        <input className="input" style={{ maxWidth: 280 }} placeholder="Nom, ville, TVA…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" style={{ maxWidth: 180 }} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">Tous</option>
          <option value="client">Clients</option>
          <option value="supplier">Fournisseurs</option>
        </select>
        <ViewToggle mode={mode} onChange={setMode} />
      </div>
      {loading && <div className="empty">Chargement…</div>}
      {data && mode === 'gallery' && (
        <div className="gallery-grid">
          {sort.rows.map((c) => (
            <Link key={c.id} href={`/app/contacts/${c.id}`} className="card gallery-card">
              <div className="gallery-thumb" style={{ borderRadius: '10px 10px 0 0' }}>
                <Avatar label={c.name} size={56} />
              </div>
              <div className="gallery-body">
                <div className="gallery-title">{c.name}</div>
                <div className="gallery-sub">
                  {c.kind ? CLIENT_KIND_LABEL[c.kind as keyof typeof CLIENT_KIND_LABEL] : c.type === 'supplier' ? 'Fournisseur' : '—'}
                  {c.city && ` · ${c.city}`}
                </div>
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
                <SortTh k="name" sort={sort} filter={colFilter}>Nom</SortTh>
                <SortTh k="kind" sort={sort} filter={colFilter}>Type</SortTh>
                <SortTh k="city" sort={sort} filter={colFilter}>Ville</SortTh>
                <SortTh k="vat" sort={sort} filter={colFilter}>TVA</SortTh>
                <SortTh k="contact" sort={sort} filter={colFilter}>Contact</SortTh>
                <SortTh k="worksites" sort={sort} align="right" filter={colFilter}>Chantiers</SortTh>
              </tr>
            </thead>
            <tbody>
              {sort.rows.map((c) => (
                <tr
                  key={c.id}
                  className={`row-link${ctx.menu?.row.id === c.id ? ' ctx-target' : ''}`}
                  onClick={rowNav(`/app/contacts/${c.id}`, (h) => router.push(h))}
                  onContextMenu={(e) => ctx.open(e, c)}
                >
                  <td>
                    <Link href={`/app/contacts/${c.id}`}>{c.name}</Link>
                    {c.syndic && <div className="muted" style={{ fontSize: '0.78rem' }}>c/o {c.syndic.name}</div>}
                    {c.building && <div className="muted" style={{ fontSize: '0.78rem' }}>ACP : {c.building.name}</div>}
                  </td>
                  <td>{c.kind ? CLIENT_KIND_LABEL[c.kind as keyof typeof CLIENT_KIND_LABEL] : c.type === 'supplier' ? 'Fournisseur' : '—'}</td>
                  <td>{c.city ?? '—'}</td>
                  <td className="mono" style={{ fontSize: '0.82rem' }}>{formatVat(c.vat) ?? '—'}</td>
                  <td>{c.email ?? c.phone ?? '—'}</td>
                  <td style={{ textAlign: 'right' }} className="tnum">{c._count.worksites || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <PaginationBar page={data.page} totalPages={data.totalPages} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />
      )}
    </>
  );
}
