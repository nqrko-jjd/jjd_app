'use client';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';

export interface LinkGroup { key: string; label: string; count: number; blocking: boolean; items: { label: string; href?: string }[] }
export interface LinksData { total: number; blocking: number; groups: LinkGroup[] }

/** Une liste de rattachements : un bloc par type (chantiers, factures, virements…), déroulable, avec des exemples cliquables. */
export function LinkGroups({ groups, open = false }: { groups: LinkGroup[]; open?: boolean }) {
  return (
    <div style={{ display: 'grid', gap: '0.45rem' }}>
      {groups.map((g) => (
        <details key={g.key} open={open} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '0.45rem 0.7rem', background: 'var(--surface)' }}>
          <summary style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: '0.6rem', fontWeight: 600, fontSize: '0.88rem' }}>
            <span>{g.label}</span>
            <span className={`badge ${g.blocking ? 'warn' : ''}`}>{g.count}</span>
          </summary>
          {g.items.length > 0 && (
            <ul style={{ listStyle: 'none', margin: '0.4rem 0 0.1rem', padding: 0, display: 'grid', gap: '0.25rem', fontSize: '0.84rem' }}>
              {g.items.map((it, i) => (
                <li key={i}>{it.href ? <Link href={it.href}>{it.label}</Link> : <span>{it.label}</span>}</li>
              ))}
              {g.count > g.items.length && <li className="muted">… et {g.count - g.items.length} autre{g.count - g.items.length > 1 ? 's' : ''}</li>}
            </ul>
          )}
        </details>
      ))}
    </div>
  );
}

/** Section « Rattachements » d'une fiche contact : à quoi elle est liée, donc pourquoi on ne peut pas la supprimer. */
export function ContactLinks({ id, refreshKey }: { id: string; refreshKey?: number }) {
  const { data } = useApi<LinksData>(`/api/contacts/${id}/links?k=${refreshKey ?? 0}`);
  if (!data) return null;
  return (
    <section id="contact-links" style={{ marginBottom: '1.4rem' }}>
      <div className="section-title">
        Rattachements <span className="hint">{data.total}</span>
      </div>
      {data.groups.length === 0 ? (
        <div className="card card-pad muted">Cette fiche n’est rattachée à rien : elle peut être supprimée sans risque.</div>
      ) : (
        <>
          <p className="muted" style={{ margin: '0 0 0.6rem', fontSize: '0.84rem' }}>
            {data.blocking > 0
              ? 'Tant que cette fiche est utilisée par ces éléments, elle ne peut pas être supprimée (fusionne-la dans une autre fiche pour tout y déplacer).'
              : 'Ces éléments partiront avec la fiche.'}
          </p>
          <LinkGroups groups={data.groups} />
        </>
      )}
    </section>
  );
}
