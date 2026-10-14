'use client';
import { tr } from '@/lib/ui-language';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutGrid, Building2, CalendarDays, ListChecks, Clock, TrendingUp, FileText, Wallet,
  BarChart3, Euro, Warehouse, Contact, Users, UserRound, Truck, Wrench, Package, ScanLine, Flag, Settings, ExternalLink,
  MessageSquare, ClipboardList, BellRing, Search, ChevronDown, ChevronLeft, ChevronRight, X, Menu, LogOut, Sparkles, type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/use-api';
import { loginLabel } from '@jjd/shared';
import dynamic from 'next/dynamic';
const CompanionLauncher = dynamic(() => import('./CompanionLauncher').then(module => module.CompanionLauncher), { ssr: false });

type Item = { href: string; label: string; ic: LucideIcon; roles?: string[]; ext?: boolean; noBottomTab?: boolean };
type Group = { title: string; ic?: LucideIcon; items: Item[] };

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
  { title: 'Au quotidien', ic: LayoutGrid, items: [
    { href: '/app', label: 'Vue d’ensemble', ic: LayoutGrid },
    { href: '/app/taches', label: 'Tâches', ic: ListChecks },
    { href: '/app/messagerie', label: 'Messagerie', ic: MessageSquare },
  ] },
  { title: 'Chantiers & clients', ic: Building2, items: [
    { href: '/app/chantiers', label: 'Chantiers', ic: Building2 },
    { href: '/app/immeubles', label: 'Immeubles / Projets', ic: Warehouse },
    { href: '/app/contacts', label: 'Contacts', ic: Contact },
    { href: '/app/rapports', label: 'Rapports à valider', ic: FileText, roles: ['admin', 'office'] },
  ] },
  { title: 'Équipe & temps', ic: Users, items: [
    { href: '/app/equipe', label: 'Équipe', ic: Users },
    { href: '/app/planning', label: 'Planning', ic: CalendarDays },
    { href: '/app/pointage', label: 'Pointage', ic: Clock },
    { href: '/app/pointage/decomptes', label: 'Décomptes du mois', ic: ClipboardList, roles: ['admin', 'office'] },
  ] },
  { title: 'Commercial', ic: TrendingUp, items: [
    { href: '/app/crm', label: 'Pipeline', ic: TrendingUp },
    { href: '/app/documents', label: 'Devis & factures', ic: FileText, roles: ['admin', 'office'] },
    { href: '/app/avancements', label: 'États d’avancement', ic: ListChecks, roles: ['admin', 'office'] },
    { href: '/app/relances/devis', label: 'Devis sans réponse', ic: BellRing, roles: ['admin', 'office'] },
    { href: '/app/relances/avis', label: 'Demandes d’avis', ic: BellRing, roles: ['admin', 'office'] },
  ] },
  { title: 'Finances', ic: Euro, items: [
    { href: '/app/achats', label: 'Achats / Dépenses', ic: Wallet, roles: ['admin', 'office'] },
    { href: '/app/finances', label: 'Finances', ic: Euro, roles: ['admin', 'office'] },
    { href: '/app/finances/fournisseurs', label: 'Comptes fournisseurs', ic: Contact, roles: ['admin', 'office'] },
    { href: '/app/finances/banque', label: 'Rapprochement bancaire', ic: Wallet, roles: ['admin', 'office'] },
    { href: '/app/relances', label: 'Relances de paiement', ic: BellRing, roles: ['admin', 'office'] },
    { href: '/app/analyse', label: 'Analyse', ic: BarChart3, roles: ['admin', 'office'] },
  ] },
  { title: 'Matériel & logistique', ic: Package, items: [
    { href: '/app/materiel', label: 'Outils & consommables', ic: Wrench },
    { href: '/app/stock', label: 'Stock matériaux', ic: Package },
    { href: '/app/stock/preparations', label: 'Préparations', ic: ClipboardList, roles: ['admin', 'office'] },
    { href: '/app/stock/commandes', label: 'Commandes fournisseurs', ic: Truck, roles: ['admin', 'office'] },
    { href: '/app/stock/scan', label: 'Scan & mouvements', ic: ScanLine },
    { href: '/app/flotte', label: 'Flotte', ic: Truck },
    { href: '/app/flotte/suivi', label: 'Suivi GPS', ic: Truck, roles: ['admin', 'office'] },
  ] },
  { title: 'Administration', ic: Settings, items: [
    { href: '/app/boite-ia', label: 'Boîte IA', ic: Sparkles, roles: ['admin', 'office'] },
    { href: '/app/controle', label: 'File de contrôle', ic: Flag, roles: ['admin', 'office'] },
    { href: '/app/parametres', label: 'Paramètres', ic: Settings, roles: ['admin', 'office'] },
    { href: '/portail', label: 'Portail client', ic: ExternalLink, ext: true },
  ] },
];

export function Shell({ children, navigationPaths }: { children: React.ReactNode; navigationPaths?: string[] }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const navigationRef = useRef<HTMLElement>(null);
  const [navQuery, setNavQuery] = useState('');
  const [companionOpen, setCompanionOpen] = useState(false);
  const [companionLoaded, setCompanionLoaded] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try { return localStorage.getItem('jjd-nav-collapsed') === '1'; } catch { return false; }
  });
  useEffect(() => { setOpen(false); setNavQuery(''); setExpandedGroups({}); }, [pathname]);
  useEffect(() => {
    document.body.classList.toggle('nav-collapsed', collapsed);
    try { localStorage.setItem('jjd-nav-collapsed', collapsed ? '1' : '0'); } catch { /* stockage indisponible — pas bloquant */ }
    return () => { document.body.classList.remove('nav-collapsed'); };
  }, [collapsed]);
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    navigationRef.current?.querySelector<HTMLButtonElement>('.nav-close')?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
      if (event.key !== 'Tab') return;
      const focusable = Array.from(navigationRef.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled])') ?? []).filter(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('keydown', close);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open]);
  const bureau = user?.role === 'admin' || user?.role === 'office';
  const { data: assistant } = useApi<{ enabled: boolean; previewAllowed: boolean }>(user ? '/api/assistant/status' : null);
  const isStaff = !!user && user.role !== 'client' && user.role !== 'storekeeper';
  const { data: unread, reload: reloadUnread } = useApi<{ internal: number; client: number }>(isStaff ? '/api/messagerie/unread-count' : null);
  const unreadTotal = (unread?.internal ?? 0) + (unread?.client ?? 0);
  const { data: mailBox } = useApi<{ total: number }>(bureau ? '/api/mail-suggestions/counts' : null);
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
    pathname === '/app/profil' ? tr('Mon profil') : tr(nav.flatMap((g) => g.items).find((i) => isActive(i.href))?.label ?? 'JJD App');

  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const matchesQuery = (item: Item) => normalize(`${tr(item.label)} ${item.label} ${item.href === '/app/equipe' ? 'ouvriers personnel collaborateurs workers equipe' : ''}`).includes(normalize(navQuery.trim()));
  const hasResults = nav.some(group => group.items.some(item => visible(item) && matchesQuery(item)));

  return (
    <div className={`shell ux-shell profile-${user?.role ?? 'guest'}`}>
      <a href="#app-content" className="skip-content">{tr("Aller au contenu")}</a>
      <header className="topbar">
        <button className="burger" aria-label="Ouvrir le menu" aria-expanded={open} aria-controls="app-navigation" onClick={() => setOpen(true)}><Menu size={20} /></button>
        <span className="topbar-title">{current}</span>
        <Link href="/app/profil" className="btn ghost" aria-label={tr('Mon profil')} title={tr('Mon profil')} style={{ color: 'inherit', padding: '0.5rem' }}><UserRound size={19} /></Link>
        <span className="brand-mini"><span className="mark"><img src="/brand/icon-white.png" alt="" /></span>JJD</span>
      </header>

      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <nav ref={navigationRef} id="app-navigation" aria-label="Navigation principale" className={`sidebar${open ? ' open' : ''}`}>
        <button className="nav-close" aria-label="Fermer le menu" onClick={() => setOpen(false)}><X size={20} /></button>
        <Link className="org-card" href={bureau ? '/app/parametres' : '/app'} onClick={() => setOpen(false)} aria-label={bureau ? 'Ouvrir la fiche société JJD Consult SRL' : 'Revenir à l’accueil JJD Consult'}>
          <span className="mark"><img src="/brand/icon-white.png" alt="" /></span>
          <div>
            <div className="org-name">JJD Consult SRL</div>
            <div className="org-role">{user ? tr(ROLE_LABEL[user.role] ?? user.role) : '—'}</div>
          </div>
        </Link>
        <label className="nav-search">
          <Search size={16} aria-hidden="true" />
          <input aria-label={tr("Rechercher une page")} placeholder={tr("Rechercher une page…")} value={navQuery} onChange={event => setNavQuery(event.target.value)} />
        </label>
        {!hasResults && <p className="nav-empty" role="status">{tr("Aucune page trouvée.")}</p>}
        {nav.map((g, index) => {
          const items = g.items.filter(visible).filter(matchesQuery);
          const expanded = !!navQuery.trim() || (expandedGroups[g.title] ?? (items.some(item => isActive(item.href)) || index === 0));
          const GroupIcon = g.ic ?? LayoutGrid;
          if (!items.length) return null;
          return (
            <div key={g.title} className={`nav-group${items.some(item => isActive(item.href)) ? ' current' : ''}`}>
              <button type="button" className="sect nav-group-toggle" aria-expanded={expanded} aria-controls={`nav-group-${index}`} title={tr(g.title)} aria-label={tr(g.title)} onClick={() => { if (collapsed) setCollapsed(false); setExpandedGroups(Object.fromEntries(nav.map(group => [group.title, group.title === g.title ? collapsed || !expanded : group === nav[0]]))); }}>
                <GroupIcon size={17} className="nav-group-icon" /><span className="nav-group-label">{tr(g.title)}</span>{!expanded && items.some(item => item.href === '/app/boite-ia') && !!mailBox?.total && <span className="nav-badge">{mailBox.total}</span>}<ChevronDown size={14} className={expanded ? 'expanded' : ''} />
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
                    aria-label={tr(i.label)} title={tr(i.label)}
                    onClick={() => setOpen(false)}
                  >
                    <span className="ic"><i.ic size={16} strokeWidth={2} /></span>
                    <span className="lbl">{tr(i.label)}</span>
                    <ExternalLink size={13} className="lbl" style={{ marginLeft: 'auto', opacity: 0.5 }} />
                  </a>
                ) : (
                  <Link
                    key={i.href}
                    href={i.href}
                    aria-current={isActive(i.href) ? 'page' : undefined}
                    className={`navlink${isActive(i.href) ? ' active' : ''}`}
                    onClick={() => setOpen(false)}
                    aria-label={tr(i.label)} title={collapsed ? tr(i.label) : undefined}
                  >
                    <span className="ic"><i.ic size={16} strokeWidth={2} /></span>
                    <span className="lbl">{tr(i.label)}</span>
                    {i.href === '/app/messagerie' && unreadTotal > 0 && <span className="nav-badge">{unreadTotal}</span>}
                    {i.href === '/app/boite-ia' && !!mailBox?.total && <span className="nav-badge">{mailBox.total}</span>}
                  </Link>
                )
              ))}
              </div>
            </div>
          );
        })}
        {assistant?.previewAllowed && pathname !== '/app/messagerie' && (
          <button
            type="button"
            className="navlink"
            aria-expanded={companionOpen}
            aria-controls="jjd-companion"
            title={collapsed ? 'Compagnon IA' : undefined}
            onClick={() => { setOpen(false); setCompanionLoaded(true); setCompanionOpen((v) => !v); }}
          >
            <span className="ic"><Sparkles size={16} strokeWidth={2} /></span>
            <span className="lbl">Compagnon IA</span>
          </button>
        )}
        <button
          type="button"
          className="nav-collapse"
          onClick={() => setCollapsed((v) => !v)}
          aria-pressed={collapsed}
          title={collapsed ? 'Agrandir le menu' : 'Réduire le menu'}
        >
          <span className="ic">{collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}</span>
          <span className="lbl">Réduire le menu</span>
        </button>
        <div className="foot">
          <Link href="/app/profil" className={`navlink${pathname === '/app/profil' ? ' active' : ''}`} title={tr('Mon profil')} onClick={() => setOpen(false)} aria-current={pathname === '/app/profil' ? 'page' : undefined}><span className="ic"><UserRound size={16} /></span><span className="lbl">{tr('Mon profil')}</span></Link>
          <div className="who">{loginLabel(user?.email)}</div>
          <button className="logout" onClick={logout} title={collapsed ? 'Déconnexion' : undefined}>
            <LogOut size={15} /> <span className="lbl">{tr("Déconnexion")}</span>
          </button>
        </div>
      </nav>

      <main id="app-content" tabIndex={-1} className={`main${(isWorker || isForeman || isStorekeeper || bureau) ? ' has-bottom-tabs' : ''}${pathname==='/app/messagerie'?' messaging-main':''}`}>{children}</main>

      {isWorker && (
        <nav className="bottom-tabs worker">
          {WORKER_NAV[0]!.items.filter((i) => !i.noBottomTab).map((i) => (
            <Link key={i.href} href={i.href} className={`bottom-tab${isActive(i.href) ? ' active' : ''}`}>
              <span className="ic">
                <i.ic size={20} strokeWidth={2} />
                {i.href === '/app/messagerie' && unreadTotal > 0 && <span className="nav-badge">{unreadTotal}</span>}
              </span>
              {i.href === '/app/materiel' ? tr("Outils") : i.href === '/app/mes-chantiers' ? tr("Chantiers") : i.href === '/app/messagerie' ? tr("Messages") : i.label}
            </Link>
          ))}
        </nav>
      )}

      {(isForeman || isStorekeeper) && <nav className="bottom-tabs worker admin" aria-label="Navigation mobile terrain">
        {(isForeman ? [{href:'/app',label:'Accueil',ic:LayoutGrid},{href:'/app/chantiers',label:'Chantiers',ic:Building2},{href:'/app/planning',label:'Planning',ic:CalendarDays},{href:'/app/messagerie',label:'Messages',ic:MessageSquare}] : [{href:'/app/stock/preparations',label:'Préparer',ic:ClipboardList},{href:'/app/stock/commandes',label:'Réceptions',ic:Truck},{href:'/app/stock/scan',label:'Scanner',ic:ScanLine},{href:'/app/materiel',label:'Outils',ic:Wrench}]).filter(visible).map(i=><Link key={i.href} href={i.href} aria-current={isActive(i.href)?'page':undefined} className={`bottom-tab${isActive(i.href)?' active':''}`}><i.ic size={20}/>{tr(i.label)}</Link>)}
        <button className="bottom-tab" aria-expanded={open} aria-controls="app-navigation" onClick={()=>setOpen(true)}><Menu size={20}/>{tr("Plus")}</button>
      </nav>}

      {bureau && <nav className="bottom-tabs worker admin" aria-label="Navigation mobile administration">
        {[{href:'/app',label:'Accueil',ic:LayoutGrid},{href:'/app/chantiers',label:'Chantiers',ic:Building2},{href:'/app/planning',label:'Planning',ic:CalendarDays},{href:'/app/messagerie',label:'Messages',ic:MessageSquare}].filter(visible).map(i=><Link key={i.href} href={i.href} aria-current={isActive(i.href)?'page':undefined} className={`bottom-tab${isActive(i.href)?' active':''}`}><i.ic size={20}/>{tr(i.label)}</Link>)}
        <button className="bottom-tab" aria-expanded={open} aria-controls="app-navigation" onClick={()=>setOpen(true)}><Menu size={20}/>{tr("Plus")}</button>
      </nav>}

      {/* Le Compagnon IA s'ouvre depuis le menu latéral (plus de bulle flottante : elle bloquait des boutons) */}
      {companionLoaded && assistant?.previewAllowed && pathname !== '/app/messagerie' && <CompanionLauncher open={companionOpen} onClose={() => setCompanionOpen(false)} />}
    </div>
  );
}

