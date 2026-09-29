import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PageHero, SectionHead, CtaBand, Eyebrow, NumberCard } from '../_components/blocks';
import { Figure } from '../_components/Figure';

const em = (chunks: React.ReactNode) => <span className="s-em">{chunks}</span>;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'aPropos' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

export default async function AProposPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'aPropos' });

  return (
    <>
      <PageHero
        eyebrow={t('heroEyebrow')}
        title={t.rich('heroTitle', { em })}
        lead={t('heroLead')}
        image="/site/hero-a-propos.jpg"
      />

      <section className="s-section">
        <div className="s-wrap">
          <div className="s-split middle">
            <div>
              <Eyebrow>{t('histoireEyebrow')}</Eyebrow>
              <h2 style={{ margin: '1rem 0 1.3rem' }}>{t.rich('histoireTitle', { em })}</h2>
              <p className="s-lead" style={{ maxWidth: '46ch', marginBottom: '1.1rem' }}>
                {t('histoireLead')}
              </p>
              <div style={{ display: 'grid', gap: '1rem', color: 'var(--s-ink-soft)' }}>
                <p>{t('histoirePara1')}</p>
                <p>{t('histoirePara2')}</p>
              </div>
            </div>
            <Figure src="/site/a-propos-equipe.jpg" alt="L’équipe JJD Consult" ratio="4 / 5" label={t('figureLabel')} />
          </div>
        </div>
      </section>

      <section className="s-section cream2">
        <div className="s-wrap">
          <SectionHead eyebrow={t('valeursEyebrow')} title={t.rich('valeursTitle', { em })} />
          <div className="s-grid cols-4">
            <NumberCard n="01" title={t('valeur1Title')}><p>{t('valeur1Text')}</p></NumberCard>
            <NumberCard n="02" title={t('valeur2Title')}><p>{t('valeur2Text')}</p></NumberCard>
            <NumberCard n="03" title={t('valeur3Title')}><p>{t('valeur3Text')}</p></NumberCard>
            <NumberCard n="04" title={t('valeur4Title')}><p>{t('valeur4Text')}</p></NumberCard>
          </div>
        </div>
      </section>

      <section className="s-section dark">
        <div className="s-wrap">
          <div className="s-split">
            <div>
              <Eyebrow>{t('structureEyebrow')}</Eyebrow>
              <h2 style={{ margin: '1rem 0 1.3rem' }}>{t.rich('structureTitle', { em })}</h2>
            </div>
            <p className="s-lead">{t('structureLead')}</p>
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
