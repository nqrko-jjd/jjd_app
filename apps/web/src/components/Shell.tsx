'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';

type Item = { href: string; label: string; ic: string; roles?: string[] };
type Group = { title: string; items: Item[] };

const NAV: Group[] = [
  {
    title: 'Pilotage',
    items: [
      { href: '/', label: 'Tableau de bord', ic: '◧' },
      { href: '/chantiers', label: 'Chantiers', ic: '▤' },
      { href: '/planning', label: 'Planning', ic: '▦' },
      { href: '/pointage', label: 'Pointage', ic: '◷' },
      { href: '/crm', label: 'Pipeline', ic: '⇗' },
      { href: '/finances', label: 'Finances', ic: '€', roles: ['admin', 'office'] },
    ],
  },
  {
    title: 'Répertoires',
    items: [
      { href: '/immeubles', label: 'Immeubles / ACP', ic: '⌂' },
      { href: '/contacts', label: 'Contacts', ic: '☰' },
      { href: '/equipe', label: 'Équipe', ic: '☺' },
      { href: '/flotte', label: 'Flotte', ic: '⛟' },
    ],
  },
  {
    title: 'Administration',
    items: [{ href: '/controle', label: 'File de contrôle', ic: '⚑', roles: ['admin', 'office'] }],
  },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));
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
                <Link
                  key={i.href}
                  href={i.href}
                  className={`navlink${isActive(i.href) ? ' active' : ''}`}
                  onClick={() => setOpen(false)}
                >
                  <span className="ic">{i.ic}</span>
                  {i.label}
                </Link>
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
