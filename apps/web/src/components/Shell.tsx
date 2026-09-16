'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutGrid, Building2, CalendarDays, ListChecks, Clock, TrendingUp, FileText, Wallet,
  BarChart3, Euro, Warehouse, Contact, Users, Truck, Wrench, Package, ScanLine, Flag, Settings, ExternalLink,
  MessageSquare, type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/use-api';
import { AssistantChat } from './AssistantChat';

type Item = { href: string; label: string; ic: LucideIcon; roles?: string[]; ext?: boolean };
type Group = { title: string; items: Item[] };

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administration', office: 'Bureau', foreman: 'Chef de chantier', worker: 'Ouvrier', client: 'Client',
};

const WORKER_NAV: Group[] = [
  {
    title: 'Terrain',
    items: [
      { href: '/app', label: 'Aujourd’hui', ic: Clock },
      { href: '/app/mes-chantiers', label: 'Mes chantiers', ic: Building2 },
      { href: '/app/mes-heures', label: 'Mes heures', ic: ListChecks },
      { href: '/app/materiel', label: 'Matériel', ic: Wrench },
    ],
  },
];

const NAV: Group[] = [
  {
    title: 'Votre activité',
    items: [
      { href: '/app', label: 'Vue d’ensemble', ic: LayoutGrid },
      { href: '/app/chantiers', label: 'Chantiers', ic: Building2 },
      { href: '/app/planning', label: 'Planning', ic: CalendarDays },
      { href: '/app/taches', label: 'Tâches', ic: ListChecks },
      { href: '/app/pointage', label: 'Pointage', ic: Clock },
      { href: '/app/messagerie', label: 'Messagerie', ic: MessageSquare },
    ],
  },
  {
    title: 'Commercial & finances',
    items: [
      { href: '/app/crm', label: 'Pipeline', ic: TrendingUp },
      { href: '/app/documents', label: 'Devis & factures', ic: FileText, roles: ['admin', 'office'] },
      { href: '/app/achats', label: 'Achats / Dépenses', ic: Wallet, roles: ['admin', 'office'] },
      { href: '/app/analyse', label: 'Analyse', ic: BarChart3, roles: ['admin', 'office'] },
      { href: '/app/finances', label: 'Finances', ic: Euro, roles: ['admin', 'office'] },
    ],
  },
  {
    title: 'Répertoires',
    items: [
      { href: '/app/immeubles', label: 'Immeubles / Projets', ic: Warehouse },
      { href: '/app/contacts', label: 'Contacts', ic: Contact },
      { href: '/app/equipe', label: 'Équipe', ic: Users },
      { href: '/app/flotte', label: 'Flotte', ic: Truck },
      { href: '/app/materiel', label: 'Matériel', ic: Wrench },
      { href: '/app/stock', label: 'Stock matériaux', ic: Package },
      { href: '/app/stock/scan', label: 'Scan & mouvements', ic: ScanLine },
    ],
  },
  {
    title: 'Administration',
    items: [
      { href: '/app/controle', label: 'File de contrôle', ic: Flag, roles: ['admin', 'office'] },
      { href: '/app/parametres', label: 'Paramètres', ic: Settings, roles: ['admin', 'office'] },
      { href: '/portail', label: 'Portail client', ic: ExternalLink, ext: true },
    ],
  },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const bureau = user?.role === 'admin' || user?.role === 'office';
  const { data: assistant } = useApi<{ enabled: boolean }>(bureau ? '/api/assistant/status' : null);
  const isStaff = !!user && user.role !== 'client';
  const { data: unread, reload: reloadUnread } = useApi<{ internal: number; client: number }>(isStaff ? '/api/messagerie/unread-count' : null);
  const unreadTotal = (unread?.internal ?? 0) + (unread?.client ?? 0);
  useEffect(() => {
    if (!isStaff) return;
    const t = setInterval(reloadUnread, 20000);
    return () => clearInterval(t);
  }, [isStaff, reloadUnread]);

  const visible = (i: Item) => !i.roles || (user && i.roles.includes(user.role));
  const isWorker = user?.role === 'worker';
  const nav = isWorker ? WORKER_NAV : NAV;
  const bestMatch = nav
    .flatMap((g) => g.items)
    .map((i) => i.href)
    .filter((href) => (href === '/app' ? pathname === '/app' : pathname === href || pathname.startsWith(`${href}/`)))
    .sort((a, b) => b.length - a.length)[0];
  const isActive = (href: string) => href === bestMatch;
  const current =
    nav.flatMap((g) => g.items).find((i) => isActive(i.href))?.label ?? 'JJD App';

  return (
    <div className="shell">
      <header className="topbar">
        <button className="burger" aria-label="Menu" onClick={() => setOpen(true)}>≡</button>
        <span className="topbar-title">{current}</span>
        <span className="brand-mini"><span className="mark">J</span>JD</span>
      </header>

      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <nav className={`sidebar${open ? ' open' : ''}`}>
        <div className="brand"><span className="mark">J</span>JD Consult</div>
        <div className="org-card">
          <span className="mark">J</span>
          <div>
            <div className="org-name">JJD Consult SRL</div>
            <div className="org-role">{user ? (ROLE_LABEL[user.role] ?? user.role) : '—'}</div>
          </div>
        </div>
        {nav.map((g) => {
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
                    <span className="ic"><i.ic size={16} strokeWidth={2} /></span>
                    {i.label}
                    <ExternalLink size={13} style={{ marginLeft: 'auto', opacity: 0.5 }} />
                  </a>
                ) : (
                  <Link
                    key={i.href}
                    href={i.href}
                    className={`navlink${isActive(i.href) ? ' active' : ''}`}
                    onClick={() => setOpen(false)}
                  >
                    <span className="ic"><i.ic size={16} strokeWidth={2} /></span>
                    {i.label}
                    {i.href === '/app/messagerie' && unreadTotal > 0 && <span className="nav-badge">{unreadTotal}</span>}
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

      <main className={`main${isWorker ? ' has-bottom-tabs' : ''}`}>{children}</main>

      {isWorker && (
        <nav className="bottom-tabs worker">
          {WORKER_NAV[0]!.items.map((i) => (
            <Link key={i.href} href={i.href} className={`bottom-tab${isActive(i.href) ? ' active' : ''}`}>
              <span className="ic"><i.ic size={20} strokeWidth={2} /></span>
              {i.label}
            </Link>
          ))}
        </nav>
      )}

      {assistant?.enabled && !chatOpen && (
        <button type="button" className="assistant-fab" title="Assistant IA" aria-label="Ouvrir l'assistant IA" onClick={() => setChatOpen(true)}>
          ✨
        </button>
      )}
      {assistant?.enabled && <AssistantChat open={chatOpen} onClose={() => setChatOpen(false)} />}
    </div>
  );
}
