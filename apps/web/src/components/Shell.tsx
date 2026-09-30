'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutGrid, Building2, CalendarDays, ListChecks, Clock, TrendingUp, FileText, Wallet,
  BarChart3, Euro, Warehouse, Contact, Users, Truck, Wrench, Package, ScanLine, Flag, Settings, ExternalLink,
  MessageSquare, ClipboardList, Search, ChevronDown, X, Menu, type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/use-api';
import { CompanionLauncher } from './CompanionLauncher';
import { AssistantChat } from './AssistantChat';

type Item = { href: string; label: string; ic: LucideIcon; roles?: string[]; ext?: boolean; noBottomTab?: boolean };
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
      { href: '/app/materiel', label: 'Outils & consommables', ic: Wrench },
      { href: '/app/stock', label: 'Stock matériaux', ic: Package, noBottomTab: true },
      { href: '/app/messagerie', label: 'Messagerie', ic: MessageSquare },
    ],
  },
];

// Espace filtré (comme la maquette) : coordonner sa propre équipe/ses propres chantiers,
// pas gérer l'administratif de toute l'entreprise (devis, finances, achats…).
const STOREKEEPER_NAV: Group[] = [
  {
    title: 'Magasin',
    items: [
      { href: '/app/stock/preparations', label: 'Préparations', ic: ClipboardList },
      { href: '/app/stock/commandes', label: 'Réceptions (commandes)', ic: Truck },
      { href: '/app/stock/scan', label: 'Scan libre (entrée / sortie)', ic: ScanLine },
      { href: '/app/stock', label: 'Stock matériaux', ic: Package },
      { href: '/app/materiel', label: 'Outils & consommables', ic: Wrench },
    ],
  },
];

const FOREMAN_NAV: Group[] = [
  {
    title: 'Sur le terrain',
    items: [
      { href: '/app', label: 'Vue d’ensemble', ic: LayoutGrid },
      { href: '/app/mon-equipe', label: 'Mon équipe', ic: Users },
      { href: '/app/planning', label: 'Planning', ic: CalendarDays },
      { href: '/app/chantiers', label: 'Mes chantiers', ic: Building2 },
      { href: '/app/rapports', label: 'Rapports à valider', ic: FileText },
      { href: '/app/pointage', label: 'Pointages à valider', ic: Clock },
      { href: '/app/messagerie', label: 'Messagerie', ic: MessageSquare },
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
      { href: '/app/rapports', label: 'Rapports à valider', ic: FileText, roles: ['admin', 'office'] },
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
      { href: '/app/materiel', label: 'Outils & consommables', ic: Wrench },
      { href: '/app/stock', label: 'Stock matériaux', ic: Package },
      { href: '/app/stock/preparations', label: 'Préparations', ic: ClipboardList, roles: ['admin', 'office'] },
      { href: '/app/stock/commandes', label: 'Commandes fournisseurs', ic: Truck, roles: ['admin', 'office'] },
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

export function Shell({ children, navigationPaths }: { children: React.ReactNode; navigationPaths?: string[] }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [navQuery, setNavQuery] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  useEffect(() => { setOpen(false); setNavQuery(''); setExpandedGroups({}); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open]);
  const bureau = user?.role === 'admin' || user?.role === 'office';
  const { data: assistant } = useApi<{ enabled: boolean }>(bureau ? '/api/assistant/status' : null);
  const isStaff = !!user && user.role !== 'client' && user.role !== 'storekeeper';
  const { data: unread, reload: reloadUnread } = useApi<{ internal: number; client: number }>(isStaff ? '/api/messagerie/unread-count' : null);
  const unreadTotal = (unread?.internal ?? 0) + (unread?.client ?? 0);
  useEffect(() => {
    if (!isStaff) return;
    const t = setInterval(reloadUnread, 20000);
    return () => clearInterval(t);
  }, [isStaff, reloadUnread]);

  const visible = (i: Item) => (!navigationPaths || navigationPaths.includes(i.href)) && (!i.roles || !!(user && i.roles.includes(user.role)));
  const isWorker = user?.role === 'worker';
  const isForeman = user?.role === 'foreman';
  const isStorekeeper = user?.role === 'storekeeper';
  const nav = isWorker ? WORKER_NAV : isForeman ? FOREMAN_NAV : isStorekeeper ? STOREKEEPER_NAV : NAV;
  const bestMatch = nav
    .flatMap((g) => g.items)
    .map((i) => i.href)
    .filter((href) => (href === '/app' ? pathname === '/app' : pathname === href || pathname.startsWith(`${href}/`)))
    .sort((a, b) => b.length - a.length)[0];
  const isActive = (href: string) => href === bestMatch;
  const current =
    nav.flatMap((g) => g.items).find((i) => isActive(i.href))?.label ?? 'JJD App';

  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const matchesQuery = (item: Item) => normalize(item.label).includes(normalize(navQuery.trim()));
  const hasResults = nav.some(group => group.items.some(item => visible(item) && matchesQuery(item)));

  return (
    <div className="shell">
      <header className="topbar">
        <button className="burger" aria-label="Ouvrir le menu" aria-expanded={open} aria-controls="app-navigation" onClick={() => setOpen(true)}><Menu size={20} /></button>
        <span className="topbar-title">{current}</span>
        <span className="brand-mini"><span className="mark"><img src="/brand/icon-white.png" alt="" /></span>JJD</span>
      </header>

      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <nav id="app-navigation" aria-label="Navigation principale" className={`sidebar${open ? ' open' : ''}`}>
        <button className="nav-close" aria-label="Fermer le menu" onClick={() => setOpen(false)}><X size={20} /></button>
        <div className="brand"><span className="mark"><img src="/brand/icon-white.png" alt="" /></span>JJD Consult</div>
        <div className="org-card">
          <span className="mark"><img src="/brand/icon-white.png" alt="" /></span>
          <div>
            <div className="org-name">JJD Consult SRL</div>
            <div className="org-role">{user ? (ROLE_LABEL[user.role] ?? user.role) : '—'}</div>
          </div>
        </div>
        <label className="nav-search">
          <Search size={16} aria-hidden="true" />
          <input aria-label="Rechercher une page" placeholder="Rechercher une page…" value={navQuery} onChange={event => setNavQuery(event.target.value)} />
        </label>
        {!hasResults && <p className="nav-empty" role="status">Aucune page trouvée.</p>}
        {nav.map((g, index) => {
          const items = g.items.filter(visible).filter(matchesQuery);
          const expanded = !!navQuery.trim() || (expandedGroups[g.title] ?? (items.some(item => isActive(item.href)) || index === 0));
          if (!items.length) return null;
          return (
            <div key={g.title}>
              <button type="button" className="sect nav-group-toggle" aria-expanded={expanded} aria-controls={`nav-group-${index}`} onClick={() => setExpandedGroups(previous => ({ ...previous, [g.title]: !expanded }))}>
                {g.title}<ChevronDown size={14} className={expanded ? 'expanded' : ''} />
              </button>
              <div id={`nav-group-${index}`} hidden={!expanded}>
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
                    aria-current={isActive(i.href) ? 'page' : undefined}
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
            </div>
          );
        })}
        <div className="foot">
          <div className="who">{user?.email}</div>
          <button className="logout" onClick={logout}>Déconnexion</button>
        </div>
      </nav>

      <main className={`main${(isWorker || bureau) ? ' has-bottom-tabs' : ''}${pathname==='/app/messagerie'?' messaging-main':''}`}>{children}</main>

      {isWorker && (
        <nav className="bottom-tabs worker">
          {WORKER_NAV[0]!.items.filter((i) => !i.noBottomTab).map((i) => (
            <Link key={i.href} href={i.href} className={`bottom-tab${isActive(i.href) ? ' active' : ''}`}>
              <span className="ic">
                <i.ic size={20} strokeWidth={2} />
                {i.href === '/app/messagerie' && unreadTotal > 0 && <span className="nav-badge">{unreadTotal}</span>}
              </span>
              {i.label}
            </Link>
          ))}
        </nav>
      )}

      {bureau && <nav className="bottom-tabs worker admin" aria-label="Navigation mobile administration">
        {[{href:'/app',label:'Accueil',ic:LayoutGrid},{href:'/app/chantiers',label:'Chantiers',ic:Building2},{href:'/app/planning',label:'Planning',ic:CalendarDays},{href:'/app/messagerie',label:'Messages',ic:MessageSquare}].filter(visible).map(i=><Link key={i.href} href={i.href} aria-current={isActive(i.href)?'page':undefined} className={`bottom-tab${isActive(i.href)?' active':''}`}><i.ic size={20}/>{i.label}</Link>)}
        <button className="bottom-tab" aria-expanded={open} aria-controls="app-navigation" onClick={()=>setOpen(true)}><Menu size={20}/>Plus</button>
      </nav>}

      {user && user.role!=='client' && !chatOpen && <CompanionLauncher onOpenConnected={assistant?.enabled ? () => setChatOpen(true) : undefined} />}
      {assistant?.enabled && <AssistantChat open={chatOpen} onClose={() => setChatOpen(false)} />}
    </div>
  );
}
