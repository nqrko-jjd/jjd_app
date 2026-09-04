'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';

type Item = { href: string; label: string; ic: string; roles?: string[]; ext?: boolean };
type Group = { title: string; items: Item[] };

const NAV: Group[] = [
  {
    title: 'Pilotage',
    items: [
      { href: '/app', label: 'Tableau de bord', ic: '◧' },
      { href: '/app/chantiers', label: 'Chantiers', ic: '▤' },
      { href: '/app/planning', label: 'Planning', ic: '▦' },
      { href: '/app/pointage', label: 'Pointage', ic: '◷' },
      { href: '/app/crm', label: 'Pipeline', ic: '⇗' },
      { href: '/app/documents', label: 'Devis & factures', ic: '▧', roles: ['admin', 'office'] },
      { href: '/app/analyse', label: 'Analyse', ic: '▨', roles: ['admin', 'office'] },
      { href: '/app/finances', label: 'Finances', ic: '€', roles: ['admin', 'office'] },
    ],
  },
  {
    title: 'Répertoires',
    items: [
      { href: '/app/immeubles', label: 'Immeubles / ACP', ic: '⌂' },
      { href: '/app/contacts', label: 'Contacts', ic: '☰' },
      { href: '/app/equipe', label: 'Équipe', ic: '☺' },
      { href: '/app/flotte', label: 'Flotte', ic: '⛟' },
      { href: '/app/materiel', label: 'Matériel', ic: '⚒' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { href: '/app/controle', label: 'File de contrôle', ic: '⚑', roles: ['admin', 'office'] },
      { href: '/app/parametres', label: 'Paramètres', ic: '⚙', roles: ['admin', 'office'] },
      { href: '/portail', label: 'Portail client', ic: '⧉', ext: true },
    ],
  },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) => (href === '/app' ? pathname === '/app' : pathname.startsWith(href));
  const visible = (i: Item) => !i.roles || (user && i.roles.includes(user.role));
  const current =
    NAV.flatMap((g) => g.items).find((i) => isActive(i.href))?.label ?? 'JJD App';

  return (
    <div className="shell">
      <header className="topbar">
        <button className="burger" aria-label="Menu" onClick={() => setOpen(true)}>≡</button>
        <span className="topbar-title">{current}</span>
        <span className="brand-mini"><span className="mark">J</span>JD</span>
      </header>

      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <nav className={`sidebar${open ? ' open' : ''}`}>
        <div className="brand"><span className="mark">J</span> JD Consult</div>
        {NAV.map((g) => {
          const items = g.items.filter(visible);
          if (!items.length) return null;
          return (
            <div key={g.title}>
              <div className="sect">{g.title}</div>
              {items.map((i) => (
                i.ext ? (
                  <a
                    key={i.href}
                    href={i.href}
                    target="_blank"
                    rel="noreferrer"
                    className="navlink"
                    onClick={() => setOpen(false)}
                  >
                    <span className="ic">{i.ic}</span>
                    {i.label}
                    <span className="ic" style={{ marginLeft: 'auto', opacity: 0.5, fontSize: '0.75rem' }}>↗</span>
                  </a>
                ) : (
                  <Link
                    key={i.href}
                    href={i.href}
                    className={`navlink${isActive(i.href) ? ' active' : ''}`}
                    onClick={() => setOpen(false)}
                  >
                    <span className="ic">{i.ic}</span>
                    {i.label}
                  </Link>
                )
              ))}
            </div>
          );
        })}
        <div className="foot">
          <div className="who">{user?.email}</div>
          <button className="logout" onClick={logout}>Déconnexion</button>
        </div>
      </nav>

      <main className="main">{children}</main>
    </div>
  );
}
