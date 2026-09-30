'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Package, ClipboardList, Truck, ScanLine, Wrench } from 'lucide-react';
import { useAuth } from '@/lib/auth';

/** Visual frame only. Existing pages own their API calls, forms and authorizations. */
export function DepotFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const role = user?.role;
  const manage = role === 'admin' || role === 'office' || role === 'storekeeper';
  const prepare = manage || role === 'foreman';
  const links = [
    { href: '/app/stock', label: 'Stock', icon: Package, visible: true },
    { href: '/app/stock/preparations', label: 'Préparations', icon: ClipboardList, visible: prepare },
    { href: '/app/stock/commandes', label: 'Commandes fournisseurs', icon: Truck, visible: manage },
    { href: '/app/stock/scan', label: 'Scan & mouvements', icon: ScanLine, visible: manage || role === 'foreman' || role === 'worker' },
    { href: '/app/materiel', label: 'Matériel', icon: Wrench, visible: true },
  ].filter(x => x.visible);
  const active = links.filter(x => pathname === x.href || pathname.startsWith(`${x.href}/`)).sort((a,b)=>b.href.length-a.href.length)[0]?.href;
  return <div className="depot-ui"><nav className="depot-ui-nav" aria-label="Stock et logistique">{links.map(({href,label,icon:Icon})=><Link href={href} key={href} aria-current={href===active?'page':undefined}><Icon size={20}/><span>{label}</span></Link>)}</nav><div className="depot-ui-content">{children}</div></div>;
}
