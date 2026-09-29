'use client';
import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';

const LOCALE_LABEL: Record<string, string> = { fr: 'FR', en: 'EN', nl: 'NL' };

export function SiteHeader() {
  const t = useTranslations('nav');
  const locale = useLocale();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const LINKS = [
    { href: '/maintenance', label: t('maintenance') },
    { href: '/renovation', label: t('renovation') },
    { href: '/projets', label: t('projets') },
    { href: '/realisations', label: t('realisations') },
    { href: '/a-propos', label: t('aPropos') },
  ];

  return (
    <header className="s-nav">
      <div className="s-nav-inner">
        <Link href="/" className="s-brand" onClick={() => setOpen(false)}>
          <img src="/brand/icon-mono.png" alt="" className="s-brand-mark" />
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
            {t('espaceClient')}
          </a>
          <div className="s-lang-switch">
            {routing.locales.map((l) => (
              <Link key={l} href={pathname} locale={l} className={l === locale ? 'active' : ''}>
                {LOCALE_LABEL[l]}
              </Link>
            ))}
          </div>
          <Link href="/contact" className="s-btn-dark s-nav-cta" onClick={() => setOpen(false)}>
            {t('contact')} <span className="arr">↗</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
