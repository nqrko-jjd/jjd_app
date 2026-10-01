'use client';
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { portalApi, usePortal } from '@/lib/portal';
import { LayoutGrid, Building2, Wrench, FileText, CalendarDays, FolderOpen, MessageSquare, Menu, X, LogOut, type LucideIcon } from 'lucide-react';

type NavItem = { href: string; label: string; ic: LucideIcon; full?: boolean; portfolio?: boolean };

const NAV: NavItem[] = [
  { href: '/portail/accueil', label: 'Accueil', ic: LayoutGrid },
  // portfolio : n'a de sens que pour qui gère plusieurs immeubles (syndic) — un client
  // particulier avec son propre projet en direct n'en a pas besoin (comme la maquette).
  { href: '/portail/immeubles', label: 'Immeubles & projets', ic: Building2, portfolio: true },
  { href: '/portail/interventions', label: 'Interventions', ic: Wrench },
  { href: '/portail/devis', label: 'Devis', ic: FileText, full: true },
  { href: '/portail/planning', label: 'Planning', ic: CalendarDays, portfolio: true },
  { href: '/portail/documents', label: 'Documents', ic: FolderOpen, full: true },
  { href: '/portail/messages', label: 'Messages', ic: MessageSquare },
];

export function PortalShell({
  title, subtitle, action, children,
}: { title?: string; subtitle?: string; action?: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const { me, signOut } = usePortal();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const initials = (me?.label ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
  const portfolio = me?.scope === 'syndic' || me?.scope === 'promoter';
  const profileLabel = me?.access === 'limited' ? 'Résident' : me?.scope === 'syndic' ? 'Syndic' : me?.scope === 'promoter' ? 'Promoteur' : 'Particulier';
  const nav = NAV.filter((n) => (!n.full || me?.access !== 'limited') && (!n.portfolio || portfolio)).map(n => ({...n,label: n.portfolio && me?.scope === 'promoter' && n.href.endsWith('immeubles') ? 'Mes projets' : n.label}));
  const primary = nav.filter(n => ['/portail/accueil', '/portail/immeubles', '/portail/interventions', '/portail/messages'].includes(n.href));
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!me) return;
    const check = () => portalApi<{ items: { unread: number }[] }>('/messages').then((r) => setUnread(r.items.reduce((s, t) => s + t.unread, 0))).catch(() => {});
    check();
    const t = setInterval(check, 20000);
    return () => clearInterval(t);
  }, [me]);

  return (
    <div className={`p-shell p-profile-${me?.scope ?? 'client'}${me?.access === 'limited' ? ' p-limited' : ''}`}>
      {mobileOpen && <div className="p-scrim" onClick={() => setMobileOpen(false)} />}
      <aside id="portal-navigation" aria-label="Navigation du portail" className={`p-side${collapsed ? ' collapsed' : ''}${mobileOpen ? ' open' : ''}`}>
        <button className="p-nav-close" aria-label="Fermer le menu" onClick={() => setMobileOpen(false)}><X size={20}/></button>
        <Link href="/portail/accueil" className="brand" onClick={() => setMobileOpen(false)}>
          <span className="mk"><img src="/brand/icon-white.png" alt="" /></span> <span className="lbl">JJD Consult</span>
        </Link>
        <div className="p-org-card">
          <span className="av">{initials}</span>
          <div>
            <div className="nm">{me?.label}</div>
            <div className="rl">{profileLabel}</div>
          </div>
        </div>
        <nav className="p-nav">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={pathname.startsWith(n.href) ? 'page' : undefined}
              title={collapsed ? n.label : undefined}
              className={pathname.startsWith(n.href) ? 'active' : ''}
              onClick={() => setMobileOpen(false)}
            >
              <span className="ic"><n.ic size={17} strokeWidth={2} /></span> <span className="lbl">{n.label}</span>
              {n.href === '/portail/messages' && unread > 0 && <span className="p-nav-badge">{unread}</span>}
            </Link>
          ))}
        </nav>
        <button className="p-collapse" onClick={() => setCollapsed((v) => !v)}>
          <span className="ic">{collapsed ? '›' : '‹'}</span> <span className="lbl">Réduire le menu</span>
        </button>
      <button className="p-side-signout" onClick={signOut} title="Se déconnecter"><LogOut size={16}/><span className="lbl">Se déconnecter</span></button>
      </aside>

      <div className="p-content">
        <div className="p-topbar">
          <button className="p-moburger" aria-label="Ouvrir le menu" aria-expanded={mobileOpen} aria-controls="portal-navigation" onClick={() => setMobileOpen(true)}><Menu size={20}/></button>
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
                <span className="rl"> · {profileLabel}</span>
                <br />
                <button onClick={signOut}>Se déconnecter</button>
              </span>
            </div>
            {action}
          </div>
        </div>
        <div className="p-body">{children}</div>
      </div>
      <nav className="p-bottom-tabs" aria-label="Navigation mobile client">{primary.map(n=><Link key={n.href} href={n.href} className={pathname.startsWith(n.href)?'active':''} aria-current={pathname.startsWith(n.href)?'page':undefined}><n.ic size={20}/><span>{n.href==='/portail/immeubles'?(me?.scope==='promoter'?'Projets':'Immeubles'):n.label}</span>{n.href==='/portail/messages' && unread>0 && <b>{unread}</b>}</Link>)}<button aria-label="Autres pages du portail" aria-expanded={mobileOpen} onClick={()=>setMobileOpen(true)}><Menu size={20}/><span>Plus</span></button></nav>
    </div>
  );
}
