import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PageHero, SectionHead, CtaBand, Eyebrow, Cta } from '../_components/blocks';
import { Figure } from '../_components/Figure';

const em = (chunks: React.ReactNode) => <span className="s-em">{chunks}</span>;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'renovation' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

export default async function RenovationPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'renovation' });

  const POSTES = [
    { title: t('p1Title'), text: t('p1Text') },
    { title: t('p2Title'), text: t('p2Text') },
    { title: t('p3Title'), text: t('p3Text') },
    { title: t('p4Title'), text: t('p4Text') },
  ];

  return (
    <>
      <PageHero
        eyebrow={t('heroEyebrow')}
        title={t.rich('heroTitle', { em })}
        lead={t('heroLead')}
        image="/site/hero-renovation.jpg"
      />

      <section className="s-section">
        <div className="s-wrap">
          <div className="s-split middle">
            <div>
              <Eyebrow>{t('introEyebrow')}</Eyebrow>
              <h2 style={{ margin: '1rem 0 1.3rem' }}>{t.rich('introTitle', { em })}</h2>
              <p className="s-lead" style={{ maxWidth: '46ch', marginBottom: '1.1rem' }}>
                {t('introLead')}
              </p>
              <p style={{ color: 'var(--s-ink-soft)' }}>{t('introText')}</p>
            </div>
            <Figure src="/site/renovation-chantier.jpg" alt="Chantier de rénovation" ratio="5 / 4" label={t('introFigureLabel')} />
          </div>
        </div>
      </section>

      <section className="s-section cream2">
        <div className="s-wrap">
          <SectionHead eyebrow={t('postesEyebrow')} title={t.rich('postesTitle', { em })} />
          <div className="s-grid cols-2">
            {POSTES.map((p, i) => (
              <div key={p.title} className="s-card">
                <span className="s-num">{String(i + 1).padStart(2, '0')}</span>
                <h3>{p.title}</h3>
                <p>{p.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="s-section">
        <div className="s-wrap">
          <div className="s-split">
            <div>
              <Eyebrow>{t('chantierEyebrow')}</Eyebrow>
              <h2 style={{ margin: '1rem 0 1.3rem' }}>{t.rich('chantierTitle', { em })}</h2>
              <p className="s-lead" style={{ maxWidth: '46ch' }}>{t('chantierLead')}</p>
              <div style={{ marginTop: '1.8rem' }}>
                <Cta href="/portail" variant="dark">{t('chantierCta')}</Cta>
              </div>
            </div>
            <ul className="s-list">
              <li>{t('chantierPoint1')}</li>
              <li>{t('chantierPoint2')}</li>
              <li>{t('chantierPoint3')}</li>
              <li>{t('chantierPoint4')}</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="s-section dark">
        <div className="s-wrap">
          <div className="s-split">
            <div>
              <Eyebrow>{t('standingEyebrow')}</Eyebrow>
              <h2 style={{ margin: '1rem 0 1.3rem' }}>{t.rich('standingTitle', { em })}</h2>
              <p className="s-lead">{t('standingLead')}</p>
            </div>
            <ul className="s-list">
              <li>{t('standingPoint1')}</li>
              <li>{t('standingPoint2')}</li>
              <li>{t('standingPoint3')}</li>
              <li>{t('standingPoint4')}</li>
            </ul>
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
