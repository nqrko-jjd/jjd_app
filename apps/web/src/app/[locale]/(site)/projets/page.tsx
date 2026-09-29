import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PageHero, SectionHead, Steps, CtaBand, Eyebrow } from '../_components/blocks';
import { Figure } from '../_components/Figure';

const em = (chunks: React.ReactNode) => <span className="s-em">{chunks}</span>;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'projets' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

export default async function ProjetsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'projets' });

  return (
    <>
      <PageHero
        eyebrow={t('heroEyebrow')}
        title={t.rich('heroTitle', { em })}
        lead={t('heroLead')}
        image="/site/hero-projets.jpg"
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
            <Figure src="/site/projets-etude.jpg" alt="Étude de projet" ratio="5 / 4" label={t('introFigureLabel')} />
          </div>
        </div>
      </section>

      <section className="s-section cream2">
        <div className="s-wrap">
          <SectionHead eyebrow={t('stepsEyebrow')} title={t.rich('stepsTitle', { em })} />
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

      <section className="s-section dark">
        <div className="s-wrap">
          <div className="s-split">
            <div>
              <Eyebrow>{t('caseEyebrow')}</Eyebrow>
              <h2 style={{ margin: '1rem 0 1.3rem' }}>{t.rich('caseTitle', { em })}</h2>
              <p className="s-lead">{t('caseLead')}</p>
            </div>
            <div className="s-panel">
              <div className="row"><b>150 m²</b><span>{t('caseStat1Label')}</span></div>
              <div className="row"><b>140 m²</b><span>{t('caseStat2Label')}</span></div>
              <div className="row"><b>2</b><span>{t('caseStat3Label')}</span></div>
            </div>
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
