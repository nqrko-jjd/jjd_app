'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';

const LINKS: { href: string; label: string; roles?: string[] }[] = [
  { href: '/', label: 'Dashboard' },
  { href: '/chantiers', label: 'Chantiers' },
  { href: '/crm', label: 'CRM / Pipeline' },
  { href: '/immeubles', label: 'Immeubles / ACP' },
  { href: '/contacts', label: 'Contacts' },
  { href: '/equipe', label: 'Équipe' },
  { href: '/controle', label: 'File de contrôle', roles: ['admin', 'office'] },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <nav className="sidebar">
      <div className="brand">JJD<b>·</b>App</div>
      {LINKS.filter((l) => !l.roles || (user && l.roles.includes(user.role))).map((l) => {
        const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} className={`navlink${active ? ' active' : ''}`}>
            <span className="dot" />
            {l.label}
          </Link>
        );
      })}
      <div className="foot">
        <div>{user?.email}</div>
        <button className="btn" style={{ marginTop: '0.5rem', width: '100%' }} onClick={logout}>
          Déconnexion
        </button>
      </div>
    </nav>
  );
}
