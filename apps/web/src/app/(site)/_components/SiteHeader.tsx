'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/maintenance', label: 'Maintenance' },
  { href: '/renovation', label: 'Rénovation' },
  { href: '/projets', label: 'Projets' },
  { href: '/realisations', label: 'Réalisations' },
  { href: '/a-propos', label: 'Qui sommes-nous ?' },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="s-nav">
      <div className="s-nav-inner">
        <Link href="/" className="s-brand" onClick={() => setOpen(false)}>
          <b>JJD</b> <span>Consult</span>
        </Link>
        <button className="s-burger" aria-label="Menu" onClick={() => setOpen((v) => !v)}>≡</button>
        <nav className={`s-nav-links${open ? ' open' : ''}`}>
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={pathname.startsWith(l.href) ? 'active' : ''}
              onClick={() => setOpen(false)}
            >
              {l.label}
            </Link>
          ))}
          <a href="/portail" className="s-nav-portal" onClick={() => setOpen(false)}>
            Espace client
          </a>
          <Link href="/contact" className="s-btn-dark s-nav-cta" onClick={() => setOpen(false)}>
            Nous contacter <span className="arr">↗</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
