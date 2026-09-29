import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PageHero, SectionHead, CtaBand, Eyebrow, Cta } from '../_components/blocks';
import { Figure } from '../_components/Figure';

const em = (chunks: React.ReactNode) => <span className="s-em">{chunks}</span>;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'maintenance' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

export default async function MaintenancePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'maintenance' });

  const INTERVENTIONS = [
    { title: t('int1Title'), text: t('int1Text') },
    { title: t('int2Title'), text: t('int2Text') },
    { title: t('int3Title'), text: t('int3Text') },
    { title: t('int4Title'), text: t('int4Text') },
  ];

  return (
    <>
      <PageHero
        eyebrow={t('heroEyebrow')}
        title={t.rich('heroTitle', { em })}
        lead={t('heroLead')}
        image="/site/hero-maintenance.jpg"
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
            <Figure src="/site/maintenance-intervention.jpg" alt="Intervention de maintenance" ratio="5 / 4" label={t('introFigureLabel')} />
          </div>
        </div>
      </section>

      <section className="s-section cream2">
        <div className="s-wrap">
          <SectionHead eyebrow={t('intervEyebrow')} title={t.rich('intervTitle', { em })} />
          <div className="s-grid cols-2">
            {INTERVENTIONS.map((it, i) => (
              <div key={it.title} className="s-card">
                <span className="s-num">{String(i + 1).padStart(2, '0')}</span>
                <h3>{it.title}</h3>
                <p>{it.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="s-section">
        <div className="s-wrap">
          <SectionHead eyebrow={t('methodEyebrow')} title={t.rich('methodTitle', { em })} />
          <ul className="s-list" style={{ fontSize: '1.05rem' }}>
            <li>{t('method1')}</li>
            <li>{t('method2')}</li>
            <li>{t('method3')}</li>
            <li>{t('method4')}</li>
            <li>{t('method5')}</li>
          </ul>
        </div>
      </section>

      <section className="s-section dark">
        <div className="s-wrap">
          <div className="s-split">
            <div>
              <Eyebrow>{t('portalEyebrow')}</Eyebrow>
              <h2 style={{ margin: '1rem 0 1.3rem' }}>{t.rich('portalTitle', { em })}</h2>
              <p className="s-lead" style={{ maxWidth: '46ch' }}>{t('portalLead')}</p>
              <div style={{ marginTop: '1.8rem' }}>
                <Cta href="/portail">{t('portalCta')}</Cta>
              </div>
            </div>
            <div className="s-panel">
              <div className="row"><b>·</b><div><strong>{t('panel1Title')}</strong><br />{t('panel1Text')}</div></div>
              <div className="row"><b>·</b><div><strong>{t('panel2Title')}</strong><br />{t('panel2Text')}</div></div>
              <div className="row"><b>·</b><div><strong>{t('panel3Title')}</strong><br />{t('panel3Text')}</div></div>
              <div className="row"><b>·</b><div><strong>{t('panel4Title')}</strong><br />{t('panel4Text')}</div></div>
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
