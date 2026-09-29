import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PageHero, SectionHead, CtaBand } from '../_components/blocks';
import { Figure } from '../_components/Figure';

const em = (chunks: React.ReactNode) => <span className="s-em">{chunks}</span>;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'realisations' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

export default async function RealisationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'realisations' });

  const PROJETS = [
    { img: 'real-1', tag: t('proj1Tag'), title: t('proj1Title'), text: t('proj1Text') },
    { img: 'real-2', tag: t('proj2Tag'), title: t('proj2Title'), text: t('proj2Text') },
    { img: 'real-3', tag: t('proj3Tag'), title: t('proj3Title'), text: t('proj3Text') },
    { img: 'real-4', tag: t('proj4Tag'), title: t('proj4Title'), text: t('proj4Text') },
    { img: 'real-5', tag: t('proj5Tag'), title: t('proj5Title'), text: t('proj5Text') },
    { img: 'real-6', tag: t('proj6Tag'), title: t('proj6Title'), text: t('proj6Text') },
    { img: 'real-7', tag: t('proj7Tag'), title: t('proj7Title'), text: t('proj7Text') },
    { img: 'real-8', tag: t('proj8Tag'), title: t('proj8Title'), text: t('proj8Text') },
  ];

  return (
    <>
      <PageHero
        eyebrow={t('heroEyebrow')}
        title={t.rich('heroTitle', { em })}
        lead={t('heroLead')}
        image="/site/hero-realisations.jpg"
      />

      <section className="s-section">
        <div className="s-wrap">
          <SectionHead eyebrow={t('selectionEyebrow')} title={t.rich('selectionTitle', { em })} />
          <div className="s-grid cols-3">
            {PROJETS.map((p) => (
              <article key={p.title} className="s-real">
                <Figure src={`/site/${p.img}.jpg`} alt={p.title} ratio="4 / 3" label={p.title} className="s-real-fig" />
                <div className="bd">
                  <span className="tag">{p.tag}</span>
                  <h3>{p.title}</h3>
                  <p>{p.text}</p>
                </div>
              </article>
            ))}
          </div>
          <p className="s-form-note" style={{ marginTop: '2.5rem' }}>
            {t('confidentialityNote')}
          </p>
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
