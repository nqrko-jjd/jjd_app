import type { ReactNode } from 'react';
import Link from 'next/link';

export function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="s-eyebrow">{children}</span>;
}

export function SectionHead({
  eyebrow, title, lead, center,
}: { eyebrow?: string; title: ReactNode; lead?: ReactNode; center?: boolean }) {
  return (
    <div className={`s-head${center ? ' center' : ''}`}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2>{title}</h2>
      {lead && <p className="s-lead">{lead}</p>}
    </div>
  );
}

export function Cta({ href, children, variant = 'gold' }: { href: string; children: ReactNode; variant?: 'gold' | 'ghost' | 'dark' }) {
  const cls = variant === 'ghost' ? 's-btn-ghost' : variant === 'dark' ? 's-btn-dark' : 's-btn';
  const external = href.startsWith('mailto:') || href.startsWith('tel:');
  if (external) return <a href={href} className={cls}>{children} <span className="arr">↗</span></a>;
  return <Link href={href} className={cls}>{children} <span className="arr">↗</span></Link>;
}

export function NumberCard({
  n, title, children, links,
}: { n: string; title: string; children?: ReactNode; links?: { href: string; label: string } }) {
  return (
    <div className="s-card">
      <span className="s-num">{n}</span>
      <h3>{title}</h3>
      {children}
      {links && <Link className="s-link" href={links.href}>{links.label} <span>↗</span></Link>}
    </div>
  );
}

export function PageHero({ eyebrow, title, lead }: { eyebrow: string; title: ReactNode; lead: string }) {
  return (
    <section className="s-hero">
      <div className="s-hero-inner" style={{ paddingBottom: 'clamp(3rem, 7vw, 5rem)' }}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 style={{ margin: '1.4rem 0 1.3rem', maxWidth: '18ch' }}>{title}</h1>
        <p className="s-lead">{lead}</p>
      </div>
    </section>
  );
}

export function Steps({ items }: { items: { title: string; text: string }[] }) {
  return (
    <div className="s-steps">
      {items.map((s, i) => (
        <div className="s-step" key={i}>
          <b>{String(i + 1).padStart(2, '0')}</b>
          <div>
            <h4>{s.title}</h4>
            <p>{s.text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function CtaBand({
  eyebrow, title, text, primary, secondary, dark = true,
}: {
  eyebrow?: string; title: ReactNode; text?: string;
  primary: { href: string; label: string }; secondary?: { href: string; label: string }; dark?: boolean;
}) {
  return (
    <section className={`s-section tight ${dark ? 'dark' : 'cream2'}`}>
      <div className="s-wrap">
        <div className="s-cta">
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          <h2>{title}</h2>
          {text && <p className="s-lead" style={{ maxWidth: '46ch' }}>{text}</p>}
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', justifyContent: 'center', marginTop: '0.4rem' }}>
            <Cta href={primary.href} variant={dark ? 'gold' : 'dark'}>{primary.label}</Cta>
            {secondary && <Cta href={secondary.href} variant="ghost">{secondary.label}</Cta>}
          </div>
        </div>
      </div>
    </section>
  );
}
