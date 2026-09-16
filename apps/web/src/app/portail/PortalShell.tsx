'use client';
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { usePortal } from '@/lib/portal';
import { LayoutGrid, Building2, Wrench, FileText, CalendarDays, FolderOpen, type LucideIcon } from 'lucide-react';

type NavItem = { href: string; label: string; ic: LucideIcon; full?: boolean };

const NAV: NavItem[] = [
  { href: '/portail/accueil', label: 'Accueil', ic: LayoutGrid },
  { href: '/portail/immeubles', label: 'Immeubles & projets', ic: Building2 },
  { href: '/portail/interventions', label: 'Interventions', ic: Wrench },
  { href: '/portail/devis', label: 'Devis', ic: FileText, full: true },
  { href: '/portail/planning', label: 'Planning', ic: CalendarDays },
  { href: '/portail/documents', label: 'Documents', ic: FolderOpen, full: true },
];

export function PortalShell({
  title, subtitle, action, children,
}: { title?: string; subtitle?: string; action?: ReactNode; children: ReactNode }) {
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
          <span className="mk">J</span> <span className="lbl">JD Consult</span>
        </Link>
        <div className="p-org-card">
          <span className="av">{initials}</span>
          <div>
            <div className="nm">{me?.label}</div>
            <div className="rl">{me?.isSyndic ? 'Syndic / Promoteur' : 'Client'}</div>
          </div>
        </div>
        <nav className="p-nav">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={pathname.startsWith(n.href) ? 'active' : ''}
              onClick={() => setMobileOpen(false)}
            >
              <span className="ic"><n.ic size={17} strokeWidth={2} /></span> <span className="lbl">{n.label}</span>
            </Link>
          ))}
        </nav>
        <button className="p-collapse" onClick={() => setCollapsed((v) => !v)}>
          <span className="ic">{collapsed ? '›' : '‹'}</span> <span className="lbl">Réduire le menu</span>
        </button>
      </aside>

      <div className="p-content">
        <div className="p-topbar">
          <button className="p-moburger" onClick={() => setMobileOpen(true)}>≡</button>
          {title ? (
            <div className="greet">
              <h1>{title}</h1>
              {subtitle && <p>{subtitle}</p>}
              {me?.access === 'limited' && (
                <p style={{ fontSize: '0.78rem', color: 'var(--p-gold)', fontWeight: 700 }}>
                  Accès résident{me.scopeLabel ? ` · ${me.scopeLabel}` : ''} — suivi, photos et messages
                </p>
              )}
            </div>
          ) : me?.access === 'limited' ? (
            <p style={{ fontSize: '0.78rem', color: 'var(--p-gold)', fontWeight: 700 }}>
              Accès résident{me.scopeLabel ? ` · ${me.scopeLabel}` : ''} — suivi, photos et messages
            </p>
          ) : <span />}
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
