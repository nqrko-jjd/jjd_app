'use client';
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { usePortal } from '@/lib/portal';

const NAV = [
  { href: '/portail/accueil', label: 'Vue d’ensemble', ic: '◈' },
  { href: '/portail/immeubles', label: 'Immeubles', ic: '⌂' },
  { href: '/portail/interventions', label: 'Interventions', ic: '⚒' },
  { href: '/portail/devis', label: 'Devis', ic: '▤', full: true },
  { href: '/portail/planning', label: 'Planning', ic: '▦' },
  { href: '/portail/documents', label: 'Documents', ic: '🗀', full: true },
];

export function PortalShell({
  title, subtitle, action, children,
}: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const { me, signOut } = usePortal();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const initials = (me?.label ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
  const nav = NAV.filter((n) => !n.full || me?.access !== 'limited');

  return (
    <div className="p-shell">
      {mobileOpen && <div className="p-scrim" onClick={() => setMobileOpen(false)} />}
      <aside className={`p-side${collapsed ? ' collapsed' : ''}${mobileOpen ? ' open' : ''}`}>
        <Link href="/portail/accueil" className="brand" onClick={() => setMobileOpen(false)}>
          <span className="mk">JJD</span> <span>Consult</span>
        </Link>
        <nav className="p-nav">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={pathname.startsWith(n.href) ? 'active' : ''}
              onClick={() => setMobileOpen(false)}
            >
              <span className="ic">{n.ic}</span> <span>{n.label}</span>
            </Link>
          ))}
        </nav>
        <button className="p-collapse" onClick={() => setCollapsed((v) => !v)}>
          <span className="ic">{collapsed ? '›' : '‹'}</span> <span>Réduire le menu</span>
        </button>
      </aside>

      <div className="p-content">
        <div className="p-topbar">
          <button className="p-moburger" onClick={() => setMobileOpen(true)}>≡</button>
          <div className="greet">
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
            {me?.access === 'limited' && (
              <p style={{ fontSize: '0.78rem', color: 'var(--p-gold)', fontWeight: 700 }}>
                Accès résident{me.scopeLabel ? ` · ${me.scopeLabel}` : ''} — suivi, photos et messages
              </p>
            )}
          </div>
          <div className="actions">
            <div className="p-user">
              <span className="av">{initials}</span>
              <span>
                <span className="nm">{me?.label}</span>
                <span className="rl"> · {me?.isSyndic ? 'Syndic' : 'Client'}</span>
                <br />
                <button onClick={signOut}>Se déconnecter</button>
              </span>
            </div>
            {action}
          </div>
        </div>
        <div className="p-body">{children}</div>
      </div>
    </div>
  );
}
