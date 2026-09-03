'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';

const LINKS: { href: string; label: string; roles?: string[] }[] = [
  { href: '/', label: 'Dashboard' },
  { href: '/chantiers', label: 'Chantiers' },
  { href: '/planning', label: 'Planning' },
  { href: '/pointage', label: 'Pointage' },
  { href: '/crm', label: 'CRM / Pipeline' },
  { href: '/immeubles', label: 'Immeubles / ACP' },
  { href: '/contacts', label: 'Contacts' },
  { href: '/equipe', label: 'Équipe' },
  { href: '/flotte', label: 'Flotte' },
  { href: '/controle', label: 'File de contrôle', roles: ['admin', 'office'] },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  const links = LINKS.filter((l) => !l.roles || (user && l.roles.includes(user.role)));
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));
  const current = links.find((l) => isActive(l.href))?.label ?? 'JJD App';

  return (
    <div className="shell">
      {/* Barre mobile */}
      <header className="topbar">
        <button className="burger" aria-label="Menu" onClick={() => setOpen(true)}>≡</button>
        <span className="topbar-title">{current}</span>
        <span className="brand-mini">JJD<b>·</b>App</span>
      </header>

      {/* Sidebar / drawer */}
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <nav className={`sidebar${open ? ' open' : ''}`}>
        <div className="brand">JJD<b>·</b>App</div>
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`navlink${isActive(l.href) ? ' active' : ''}`}
            onClick={() => setOpen(false)}
          >
            <span className="dot" />
            {l.label}
          </Link>
        ))}
        <div className="foot">
          <div className="muted" style={{ fontSize: '0.78rem', wordBreak: 'break-all' }}>{user?.email}</div>
          <button className="btn" style={{ marginTop: '0.5rem', width: '100%' }} onClick={logout}>
            Déconnexion
          </button>
        </div>
      </nav>

      <main className="main">{children}</main>
    </div>
  );
}
