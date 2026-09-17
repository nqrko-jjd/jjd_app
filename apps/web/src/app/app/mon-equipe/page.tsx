'use client';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { PageHead, Avatar } from '@/lib/ui';
import { PERSON_ROLE_LABEL } from '@jjd/shared';

interface TeamMember {
  id: string; name: string; role: string; photoUrl: string | null; phone: string | null;
  worksite: { id: string; ref: string; title: string; status: string };
}

export default function MonEquipePage() {
  const { data } = useApi<{ items: TeamMember[] }>('/api/people/team');
  const items = data?.items ?? [];

  return (
    <>
      <PageHead eyebrow="Chef de chantier" title="Mon équipe" sub="Affectations et suivi du jour." />
      {data && items.length === 0 && <div className="card card-pad muted">Personne n’est affecté sur vos chantiers aujourd’hui.</div>}
      {items.map((m) => (
        <div key={m.id} className="card card-pad" style={{ marginBottom: '0.7rem' }}>
          <div className="row" style={{ gap: '0.7rem', alignItems: 'center' }}>
            <Avatar src={m.photoUrl} label={m.name} size={44} />
            <div>
              <div style={{ fontWeight: 700 }}>{m.name}</div>
              <div className="muted">{PERSON_ROLE_LABEL[m.role as keyof typeof PERSON_ROLE_LABEL] ?? m.role}</div>
            </div>
            <span className="badge ok" style={{ marginLeft: 'auto' }}>Sur chantier</span>
          </div>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: '0.7rem', paddingTop: '0.6rem', borderTop: '1px solid var(--line)' }}>
            <div className="muted">{m.worksite.ref} · {m.worksite.title}</div>
            {m.phone && <a href={`tel:${m.phone.replace(/\s/g, '')}`} className="muted">{m.phone}</a>}
          </div>
          <Link href={`/app/chantiers/${m.worksite.id}`} className="btn" style={{ marginTop: '0.7rem', display: 'block', textAlign: 'center' }}>
            Ouvrir le chantier →
          </Link>
        </div>
      ))}
    </>
  );
}
