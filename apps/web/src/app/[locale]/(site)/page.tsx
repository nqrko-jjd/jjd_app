import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Eyebrow, SectionHead, Cta, NumberCard, Steps, CtaBand } from './_components/blocks';
import { Figure, HeroImage } from './_components/Figure';

const em = (chunks: React.ReactNode) => <span className="s-em">{chunks}</span>;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'home' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'home' });

  const SERVICES = [
    {
      n: '01', tag: t('service1Tag'), title: t('service1Title'), baseline: t('service1Baseline'), text: t('service1Text'),
      points: [t('service1Point1'), t('service1Point2'), t('service1Point3'), t('service1Point4')], href: '/maintenance',
    },
    {
      n: '02', tag: t('service2Tag'), title: t('service2Title'), baseline: t('service2Baseline'), text: t('service2Text'),
      points: [t('service2Point1'), t('service2Point2'), t('service2Point3'), t('service2Point4')], href: '/renovation',
    },
    {
      n: '03', tag: t('service3Tag'), title: t('service3Title'), baseline: t('service3Baseline'), text: t('service3Text'),
      points: [t('service3Point1'), t('service3Point2'), t('service3Point3'), t('service3Point4')], href: '/projets',
    },
  ];

  const AUDIENCES = [
    { title: t('aud1Title'), text: t('aud1Text') },
    { title: t('aud2Title'), text: t('aud2Text') },
    { title: t('aud3Title'), text: t('aud3Text') },
    { title: t('aud4Title'), text: t('aud4Text') },
  ];

  return (
    <>
      {/* Hero */}
      <section className="s-hero">
        <HeroImage src="/site/jjd-villa-exterior.webp" alt="Propriété contemporaine rénovée avec terrasse et piscine" />
        <div className="s-hero-inner">
          <Eyebrow>{t('heroEyebrow')}</Eyebrow>
          <h1>{t.rich('heroTitle', { em })}</h1>
          <p className="s-lead">{t('heroLead')}</p>
          <div className="s-hero-actions">
            <Cta href="/contact">{t('heroCta')}</Cta>
            <a href="tel:+3228879239" className="tel">+32 2 887 92 39</a>
          </div>
          <div className="s-hero-stats">
            <div className="s-stat"><b>20+</b><span>{t('stat1')}</span></div>
            <div className="s-stat"><b>01</b><span>{t('stat2')}</span></div>
            <div className="s-stat"><b>360°</b><span>{t('stat3')}</span></div>
          </div>
        </div>
      </section>

      {/* Intro */}
      <section className="s-section">
        <div className="s-wrap">
          <div className="s-split middle">
            <div>
              <Eyebrow>{t('introEyebrow')}</Eyebrow>
              <h2 style={{ margin: '1rem 0 1.4rem' }}>{t.rich('introTitle', { em })}</h2>
              <p className="s-lead" style={{ maxWidth: '48ch' }}>{t('introLead')}</p>
            </div>
            <p style={{ color: 'var(--s-ink-soft)' }}>{t('introText')}</p>
          </div>
        </div>
      </section>

      {/* Services */}
      <section className="s-section dark">
        <div className="s-wrap">
          <SectionHead eyebrow={t('servicesEyebrow')} title={t.rich('servicesTitle', { em })} />
          <div className="s-grid cols-3">
            {SERVICES.map((s) => (
              <Link key={s.n} href={s.href} className="s-card s-service">
                <span className="s-num">{s.n}</span>
                <div className="tag">{s.tag}</div>
                <h3>{s.title}</h3>
                <p style={{ fontWeight: 500, color: '#f4f1e9' }}>{s.baseline}</p>
                <p>{s.text}</p>
                <ul>{s.points.map((p) => <li key={p}>{p}</li>)}</ul>
                <span className="s-link">{t('servicesLink')} <span>↗</span></span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Reference — Rhode-Saint-Genèse */}
      <section className="s-section">
        <div className="s-wrap">
          <div className="s-split middle">
            <Figure src="/site/jjd-interior-hall.webp" alt="Intérieur haut de gamme rénové avec matériaux naturels" ratio="16 / 11" label={t('refLabel')} />
            <div>
              <Eyebrow>{t('refEyebrow')}</Eyebrow>
              <h2 style={{ margin: '1rem 0 1.4rem' }}>{t.rich('refTitle', { em })}</h2>
              <p className="s-lead" style={{ marginBottom: '1.6rem' }}>{t('refLead')}</p>
              <ul className="s-list">
                <li>{t('refPoint1')}</li>
                <li>{t('refPoint2')}</li>
                <li>{t('refPoint3')}</li>
              </ul>
              <div style={{ marginTop: '2rem' }}>
                <Cta href="/contact" variant="dark">{t('refCta')}</Cta>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Méthode */}
      <section className="s-section cream2">
        <div className="s-wrap">
          <SectionHead eyebrow={t('methodEyebrow')} title={t.rich('methodTitle', { em })} />
          <Steps
            items={[
              { title: t('step1Title'), text: t('step1Text') },
              { title: t('step2Title'), text: t('step2Text') },
              { title: t('step3Title'), text: t('step3Text') },
              { title: t('step4Title'), text: t('step4Text') },
            ]}
          />
        </div>
      </section>

      {/* Audiences */}
      <section className="s-section">
        <div className="s-wrap">
          <SectionHead eyebrow={t('audEyebrow')} title={t.rich('audTitle', { em })} lead={t('audLead')} />
          <div className="s-grid cols-2">
            {AUDIENCES.map((a) => (
              <div key={a.title} className="s-card">
                <h3>{a.title}</h3>
                <p>{a.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* JJD Projets — décider avant de construire */}
      <section className="s-section dark">
        <div className="s-wrap">
          <div className="s-split middle">
            <div>
              <Eyebrow>{t('projEyebrow')}</Eyebrow>
              <h2 style={{ margin: '1rem 0 1.4rem' }}>{t.rich('projTitle', { em })}</h2>
              <p className="s-lead">{t('projLead')}</p>
              <div style={{ marginTop: '2rem' }}>
                <Cta href="/projets">{t('projCta')}</Cta>
              </div>
            </div>
            <Figure src="/site/jjd-project-team.webp" alt="Étude et préparation d’un projet de rénovation" ratio="4 / 3" label={t('projLabel')} />
          </div>
        </div>
      </section>

      {/* Espace client */}
      <section className="s-section cream2">
        <div className="s-wrap">
          <div className="s-split middle">
            <div>
              <Eyebrow>{t('clientEyebrow')}</Eyebrow>
              <h2 style={{ margin: '1rem 0 1.4rem' }}>{t.rich('clientTitle', { em })}</h2>
              <p className="s-lead">{t('clientLead')}</p>
              <div style={{ marginTop: '2rem' }}>
                <Cta href="/portail" variant="dark">{t('clientCta')}</Cta>
              </div>
            </div>
            <ul className="s-list" style={{ fontSize: '1rem' }}>
              <li>{t('clientPoint1')}</li>
              <li>{t('clientPoint2')}</li>
              <li>{t('clientPoint3')}</li>
              <li>{t('clientPoint4')}</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Pourquoi */}
      <section className="s-section">
        <div className="s-wrap">
          <SectionHead eyebrow={t('whyEyebrow')} title={t.rich('whyTitle', { em })} />
          <div className="s-grid cols-4">
            <NumberCard n="01" title={t('why1Title')}><p>{t('why1Text')}</p></NumberCard>
            <NumberCard n="02" title={t('why2Title')}><p>{t('why2Text')}</p></NumberCard>
            <NumberCard n="03" title={t('why3Title')}><p>{t('why3Text')}</p></NumberCard>
            <NumberCard n="04" title={t('why4Title')}><p>{t('why4Text')}</p></NumberCard>
          </div>
        </div>
      </section>

      <CtaBand
        eyebrow={t('ctaEyebrow')}
        title={t.rich('ctaTitle', { em })}
        text={t('ctaText')}
        primary={{ href: '/contact', label: t('ctaPrimary') }}
        secondary={{ href: 'tel:+3228879239', label: t('ctaSecondary') }}
      />
    </>
  );
}
